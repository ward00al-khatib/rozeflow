-- Behavioural checks for server-side Dice rounds, seeds and owner controls.
\set QUIET on
begin;
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2');

-- Signs in as uid on one session and device (spec appendix ط: game calls need an approved device).
create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'session_id', 'sess-' || uid, 'aal', 'aal2')::text, true);
  -- a test transaction has one now(), so every round looks simultaneous: lift the rate limit
  insert into public.site_settings (key, value) values ('round_rate_limit', '1000000')
  on conflict (key) do update set value = excluded.value;
  if uid <> '' then perform public.register_device('device-key-' || replace(uid, '-', ''), 'test'); end if;
end $$;

create function pg_temp.expect_fail(stmt text, label text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then raise notice 'ok: % (%)', label, sqlerrm; return; end;
  raise exception 'expected failure: %', label;
end $$;

-- 1. The SQL RNG equals src/lib/fairness/rng.ts (vectors produced by the TypeScript code).
do $$
declare v record;
begin
  for v in select * from (values
('0000000000000000000000000000000000000000000000000000000000000000', 'abc', 0, 7889, 19, 58155, '05b4283ea4e932503c49de2904f187ca61093a1a051ecb6bb90a21216d1b71ce'),
('0000000000000000000000000000000000000000000000000000000000000000', 'بذرة العميل', 7, 7231, 31, 8577, '4a317ca617c6b7d1cd23282072c8953b7fa72b41054af3a22890d9009e3e6e88'),
('0000000000000000000000000000000000000000000000000000000000000000', 'x', 123456789, 9710, 15, 24909, '756c93b87cf2b91f77be2f0b4bc3d8b71382da3c5a0438f4cc71381afdec9554'),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'abc', 0, 997, 27, 410, 'f376061f94114f482538e0ae49bb702b4df4136095c8a670a16591d1a86bc30c'),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'بذرة العميل', 7, 2050, 11, 12180, 'd88e0aadbe9fd2a22dd3b493524ba7149b8b7e883a550ba625f049fe868412ad'),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'x', 123456789, 9223, 14, 48488, 'd4a049f6604239376abfb5c643e5996140fa7dcda39545ba9497797e03b95754'),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'abc', 0, 2497, 27, 65552, 'bebdd7cdf722db30f1d757883894de3be8c6a8a926b0e3504323ae3eb3f28d4c'),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'بذرة العميل', 7, 4363, 13, 34247, 'd6c8967d6ff79a1b9110b1d7d0b8ce5eb21ed11034c3a6ce44941aa43203bc83'),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'x', 123456789, 7965, 34, 52024, '6021b52ff308405aec62cc9763a574142ae130baab2293f383bec6c20a54b0df')
  ) as t(seed, client, nonce, dice, u37, u70k, block3)
  loop
    if public.fair_integer(v.seed, v.client, v.nonce, 'rozeflow:v1:dice', 10000) <> v.dice
       or public.fair_integer(v.seed, v.client, v.nonce, 'rozeflow:v1:roulette', 37) <> v.u37
       or public.fair_integer(v.seed, v.client, v.nonce, 'rozeflow:v1:x', 70000) <> v.u70k
       or encode(public.fair_block(v.seed, v.client, v.nonce, 'rozeflow:v1:dice', 3), 'hex') <> v.block3 then
      raise exception 'RNG mismatch for seed % client % nonce %', v.seed, v.client, v.nonce;
    end if;
  end loop;
end $$;

-- 2. Members
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.complete_join('ward', true, true);
do $$ begin perform public.claim_ownership(); end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select public.complete_join('friend', true, true);

-- 3. Bad requests leave no trace
select pg_temp.expect_fail($$select public.play_dice(999, 5000, 'under', 'key-00000001')$$, 'stake below minimum');
select pg_temp.expect_fail($$select public.play_dice(100001, 5000, 'under', 'key-00000002')$$, 'stake above maximum');
select pg_temp.expect_fail($$select public.play_dice(1000, 99, 'under', 'key-00000003')$$, 'chance too low');
select pg_temp.expect_fail($$select public.play_dice(1000, 400, 'over', 'key-00000004')$$, 'chance too high');
select pg_temp.expect_fail($$select public.play_dice(1000, 5000, 'sideways', 'key-00000005')$$, 'unknown direction');
select pg_temp.expect_fail($$select public.play_dice(1000, 5000, 'under', 'short')$$, 'idempotency key required');
do $$ begin
  if exists (select 1 from public.game_rounds) or (select count(*) from public.wallet_ledger) <> 2 then
    raise exception 'rejected bets must not write anything';
  end if;
end $$;

-- 4. A round: outcome equals the RNG, the wallet and ledger agree, the replay returns the same round
do $$
declare
  st jsonb := public.my_seed_state();
  r jsonb; r2 jsonb; seed text; roll int; expect_gross bigint; bal bigint; n int;
begin
  if (st->>'nonce')::int <> 0 or st ? 'server_seed' then raise exception 'bad seed state %', st; end if;
  r := public.play_dice(2000, 5000, 'under', 'key-round-0001');
  select server_seed_enc into seed from public.seed_pairs where id = (st->>'seed_pair_id')::uuid;
  -- stored sealed (spec appendix م): never the plain seed
  if seed not like 'v1:%' or position(public.seed_plain(seed) in seed) > 0 then raise exception 'seed stored in the clear'; end if;
  seed := public.seed_plain(seed);
  if length(seed) <> 64 then raise exception 'seed_plain must give the 32-byte hex seed'; end if;
  roll := public.fair_integer(seed, st->>'client_seed', 0, 'rozeflow:v1:dice', 10000);
  if (r->>'roll')::int <> roll then raise exception 'roll % <> %', r->>'roll', roll; end if;
  if (r->>'multiplier')::int <> 19800 then raise exception 'multiplier %', r->>'multiplier'; end if;
  expect_gross := case when roll < 5000 then 3960 else 0 end;
  if (r->>'gross')::bigint <> expect_gross or (r->>'win')::boolean <> (roll < 5000) then raise exception 'payout %', r; end if;
  if r->>'server_seed_hash' <> encode(sha256(decode(seed, 'hex')), 'hex') then raise exception 'commitment mismatch'; end if;
  select available into bal from public.wallet_accounts where user_id = auth.uid();
  if bal <> 100000 - 2000 + expect_gross or (r->>'available')::bigint <> bal then raise exception 'balance %', bal; end if;

  r2 := public.play_dice(2000, 5000, 'under', 'key-round-0001');
  if r2->>'round_id' <> r->>'round_id' or not (r2->>'replay')::boolean then raise exception 'replay must return the same round'; end if;
  select count(*) into n from public.game_rounds;
  if n <> 1 then raise exception 'replay created a round'; end if;
  if (select available from public.wallet_accounts where user_id = auth.uid()) <> bal then raise exception 'replay moved points'; end if;
  if (public.my_seed_state()->>'nonce')::int <> 1 then raise exception 'nonce must advance once'; end if;
end $$;

-- 5. Many rounds keep every invariant; then the balance runs out cleanly
do $$
declare i int; r jsonb; staked bigint := 0; paid bigint := 0; bal bigint;
begin
  for i in 1 .. 60 loop
    r := public.play_dice(1000, 500 + (i * 150), case when i % 2 = 0 then 'under' else 'over' end, 'key-many-' || lpad(i::text, 4, '0'));
    staked := staked + 1000; paid := paid + (r->>'gross')::bigint;
  end loop;
  select available into bal from public.wallet_accounts where user_id = auth.uid();
  if bal <> (select 100000 + sum(net_result) from public.game_rounds where user_id = auth.uid()) then
    raise exception 'balance does not equal grant + net results';
  end if;
  if exists (select 1 from public.wallet_invariant_violations()) then raise exception 'invariant violated'; end if;
  if exists (select 1 from public.game_rounds where status <> 'SETTLED') then raise exception 'open round left'; end if;
end $$;

do $$
declare bal bigint; spent boolean := false; i int := 0;
begin
  loop
    i := i + 1;
    select available into bal from public.wallet_accounts where user_id = auth.uid();
    exit when bal < 100000 or i > 400;
    perform public.play_dice(100000, 100, 'under', 'key-drain-' || lpad(i::text, 4, '0'));
  end loop;
  begin
    perform public.play_dice(100000, 100, 'under', 'key-drain-last');
  exception when others then
    if sqlerrm <> 'INSUFFICIENT_BALANCE' then raise; end if;
    spent := true;
  end;
  if not spent then raise exception 'expected INSUFFICIENT_BALANCE'; end if;
  if exists (select 1 from public.wallet_invariant_violations()) then raise exception 'invariant violated after drain'; end if;
end $$;

-- 6. Seed rotation reveals the old seed, and every old round verifies against it
do $$
declare rot jsonb; bad int; pairs jsonb;
begin
  rot := public.rotate_seed('my new seed');
  if rot->>'client_seed' <> 'my new seed' or (rot->>'nonce')::int <> 0 then raise exception 'rotation state %', rot; end if;
  if encode(sha256(decode(rot#>>'{revealed,server_seed}', 'hex')), 'hex') <> rot#>>'{revealed,server_seed_hash}' then
    raise exception 'revealed seed does not match its commitment';
  end if;
  select count(*) into bad from public.game_rounds g
   where g.seed_pair_id = (rot#>>'{revealed,seed_pair_id}')::uuid
     and (g.outcome->>'roll')::int <> public.fair_integer(rot#>>'{revealed,server_seed}', g.outcome->>'client_seed', g.nonce, 'rozeflow:v1:dice', 10000);
  if bad <> 0 then raise exception '% rounds do not verify', bad; end if;
  pairs := public.my_seed_pairs();
  if jsonb_array_length(pairs) <> 2 or pairs->0->>'server_seed' is not null or pairs->1->>'server_seed' is null then
    raise exception 'seed pair list wrong: %', pairs;
  end if;
end $$;

-- 7. Owner controls: only the owner, bounded, immediate, new rounds only
select pg_temp.expect_fail($$select public.set_game_rtp('dice', 9500)$$, 'player cannot set RTP');
select pg_temp.expect_fail($$select public.set_game_status('dice', 'paused')$$, 'player cannot pause');
select pg_temp.expect_fail($$select public.site_report()$$, 'player cannot read the site report');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_fail($$select public.set_game_rtp('dice', 8999)$$, 'RTP below bound');
select pg_temp.expect_fail($$select public.set_game_rtp('dice', 9901)$$, 'RTP above bound');
select pg_temp.expect_fail($$select public.set_game_rtp('chess', 9500)$$, 'unknown game');
do $$
declare old_rounds int; r jsonb; rep jsonb;
begin
  select count(*) into old_rounds from public.game_rounds where outcome->>'rtp_bp' = '9900';
  r := public.set_game_rtp('dice', 9500, 'اختبار');
  if not (r->>'changed')::boolean or (r->>'version')::int <> 2 then raise exception 'rtp change %', r; end if;
  if (select count(*) from public.game_config_versions where game_id = 'dice' and status = 'ACTIVE') <> 1
     or (select status from public.game_config_versions where game_id = 'dice' and version = 1) <> 'RETIRED' then
    raise exception 'version states wrong';
  end if;
  r := public.play_dice(1000, 5000, 'under', 'key-owner-0001');
  if (r->>'multiplier')::int <> 19000 or (r->>'rtp_bp')::int <> 9500 or (r->>'config_version')::int <> 2 then
    raise exception 'new round must use the new RTP: %', r;
  end if;
  if (select count(*) from public.game_rounds where outcome->>'rtp_bp' = '9900') <> old_rounds then
    raise exception 'old rounds changed';
  end if;
  if not exists (select 1 from public.admin_audit_logs where action = 'set_game_rtp' and target = 'dice') then
    raise exception 'RTP change not audited';
  end if;

  perform public.set_game_status('dice', 'paused');
  begin
    perform public.play_dice(1000, 5000, 'under', 'key-owner-0002');
    raise exception 'paused game accepted a round';
  exception when others then
    if sqlerrm <> 'GAME_PAUSED' then raise; end if;
  end;
  perform public.set_game_status('dice', 'enabled');

  rep := public.site_report();
  if (rep#>>'{totals,wagered}')::bigint <> (select sum(stake) from public.game_rounds)
     or (rep#>>'{totals,net}')::bigint <> (select sum(stake) - sum(gross_payout) from public.game_rounds)
     or (rep#>>'{points,in_wallets}')::bigint <> 200000 - (rep#>>'{totals,net}')::bigint then
    raise exception 'site report does not add up: %', rep;
  end if;
end $$;

-- 8. A paused account cannot play; not signed in cannot play
update public.profiles set status = 'paused' where user_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.expect_fail($$select public.play_dice(1000, 5000, 'under', 'key-paused-01')$$, 'paused account');
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.expect_fail($$select public.play_dice(1000, 5000, 'under', 'key-anon-0001')$$, 'requires sign-in');

do $$ begin
  if exists (select 1 from public.wallet_invariant_violations()) then raise exception 'invariant violated'; end if;
end $$;
\echo 'all server round checks passed'
rollback;
