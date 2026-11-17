-- Behavioural checks for server-side Roulette and Plinko.
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

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.complete_join('ward', true, true);
do $$ begin perform public.claim_ownership(); end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select public.complete_join('friend', true, true);

-- 1. Outcomes equal the TypeScript games for known seeds (vectors from playPlinko at 95% and playRoulette).
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
do $$ begin perform public.set_game_rtp('plinko', 9500, 'اختبار'); end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
do $$
declare v record; r jsonb; path text; i int := 0;
begin
  perform public.my_seed_state();
  for v in select * from (values
('0000000000000000000000000000000000000000000000000000000000000000', 'abc', 0, '1010100001011000', 6951, 19),
('0000000000000000000000000000000000000000000000000000000000000000', 'بذرة', 7, '0111010111111101', 39334, 14),
('0000000000000000000000000000000000000000000000000000000000000000', 'x', 123456789, '0110001010000011', 6951, 15),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'abc', 0, '1000101011000110', 2351, 27),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'بذرة', 7, '0010111000101110', 269, 31),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'x', 123456789, '1100001011100011', 269, 14),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'abc', 0, '0101110001101001', 269, 27),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'بذرة', 7, '1010010010001010', 6951, 5),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'x', 123456789, '0100100100000110', 17071, 34)
  ) as t(seed, client, nonce, path, mult, pocket)
  loop
    i := i + 1;
    -- a fresh pair per vector, so (seed pair, nonce) never repeats
    update public.seed_pairs set status = 'revealed', server_seed_revealed = public.seed_plain(server_seed_enc), revealed_at = now()
     where user_id = auth.uid() and status = 'active';
    insert into public.seed_pairs (user_id, server_seed_enc, server_seed_hash, client_seed, next_nonce)
    values (auth.uid(), v.seed, encode(sha256(decode(v.seed, 'hex')), 'hex'), v.client, v.nonce);
    r := public.play_plinko(1000, 16, 'high', 'key-vec-plinko-' || i);
    select string_agg(x, '') into path from jsonb_array_elements_text(r->'path') x;
    if path <> v.path or (r->>'multiplier')::int <> v.mult or (r->>'gross')::bigint <> (1000 * v.mult) / 10000 then
      raise exception 'plinko mismatch %: %', i, r;
    end if;
    update public.seed_pairs set next_nonce = v.nonce where user_id = auth.uid() and status = 'active';
    update public.seed_pairs set status = 'revealed', server_seed_revealed = public.seed_plain(server_seed_enc), revealed_at = now()
     where user_id = auth.uid() and status = 'active';
    insert into public.seed_pairs (user_id, server_seed_enc, server_seed_hash, client_seed, next_nonce)
    values (auth.uid(), v.seed, encode(sha256(decode(v.seed, 'hex')), 'hex'), v.client, v.nonce);
    r := public.play_roulette('[{"kind":"red","amount":1000}]', 'key-vec-roulette-' || i);
    if (r->>'pocket')::int <> v.pocket then raise exception 'roulette mismatch %: %', i, r; end if;
  end loop;
end $$;

-- 2. Every roulette bet kind pays exactly as the TypeScript rules say, for every pocket
do $$
declare
  red jsonb := '[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]';
  p int; n int;
begin
  for p in 0 .. 36 loop
    select count(*) into n from (values ('red', null::int), ('black', null), ('odd', null), ('even', null), ('low', null), ('high', null)) k(kind, v)
     where public.roulette_bet_wins(k.kind, k.v, p, red);
    if n <> (3 * sign(p))::int then raise exception 'even-money bets wrong at %', p; end if;
    select count(*) into n from generate_series(1, 3) v where public.roulette_bet_wins('dozen', v, p, red);
    if n <> sign(p)::int then raise exception 'dozen wrong at %', p; end if;
    select count(*) into n from generate_series(1, 3) v where public.roulette_bet_wins('column', v, p, red);
    if n <> sign(p)::int then raise exception 'column wrong at %', p; end if;
    select count(*) into n from generate_series(0, 36) v where public.roulette_bet_wins('straight', v, p, red);
    if n <> 1 then raise exception 'straight wrong at %', p; end if;
  end loop;
  if not public.roulette_bet_wins('dozen', 2, 13, red) or not public.roulette_bet_wins('dozen', 2, 24, red)
     or public.roulette_bet_wins('dozen', 2, 25, red) or not public.roulette_bet_wins('column', 3, 36, red)
     or not public.roulette_bet_wins('column', 1, 34, red) or not public.roulette_bet_wins('red', null, 32, red)
     or public.roulette_bet_wins('red', null, 33, red) then
    raise exception 'roulette spot checks failed';
  end if;
end $$;

-- 3. A multi-bet roulette round: payout, ledger and replay
do $$
declare r jsonb; r2 jsonb; p int; expect bigint; before bigint; bal bigint;
begin
  select available into before from public.wallet_accounts where user_id = auth.uid();
  r := public.play_roulette('[{"kind":"straight","value":17,"amount":500},{"kind":"red","amount":1000},{"kind":"dozen","value":2,"amount":300},{"kind":"column","value":2,"amount":200}]', 'key-roulette-multi');
  p := (r->>'pocket')::int;
  expect := case when p = 17 then 500 * 36 else 0 end
          + case when public.roulette_bet_wins('red', null, p, '[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]') then 2000 else 0 end
          + case when p between 13 and 24 then 900 else 0 end
          + case when p > 0 and p % 3 = 2 then 600 else 0 end;
  if (r->>'stake')::bigint <> 2000 or (r->>'gross')::bigint <> expect or jsonb_array_length(r->'wins') <> 4 then
    raise exception 'roulette round wrong: %', r;
  end if;
  select available into bal from public.wallet_accounts where user_id = auth.uid();
  if bal <> before - 2000 + expect then raise exception 'roulette balance wrong'; end if;
  r2 := public.play_roulette('[{"kind":"red","amount":1000}]', 'key-roulette-multi');
  if r2->>'round_id' <> r->>'round_id' or not (r2->>'replay')::boolean then raise exception 'roulette replay'; end if;
end $$;

select pg_temp.expect_fail($$select public.play_roulette('[]', 'key-bad-000001')$$, 'no bets');
select pg_temp.expect_fail($$select public.play_roulette('[{"kind":"red","amount":999}]', 'key-bad-000002')$$, 'total below minimum');
select pg_temp.expect_fail($$select public.play_roulette('[{"kind":"red","amount":1000},{"kind":"red","amount":1000}]', 'key-bad-000003')$$, 'duplicate spot');
select pg_temp.expect_fail($$select public.play_roulette('[{"kind":"straight","value":37,"amount":1000}]', 'key-bad-000004')$$, 'pocket out of range');
select pg_temp.expect_fail($$select public.play_roulette('[{"kind":"split","value":1,"amount":1000}]', 'key-bad-000005')$$, 'unknown kind');
select pg_temp.expect_fail($$select public.play_roulette('[{"kind":"red","amount":1000.5}]', 'key-bad-000006')$$, 'fractional amount');
select pg_temp.expect_fail($$select public.play_roulette('[{"kind":"red","amount":1000},{"kind":"black","amount":50}]', 'key-bad-000007')$$, 'bet below per-bet minimum');
select pg_temp.expect_fail($$select public.play_roulette('[{"kind":"red","amount":-1000},{"kind":"black","amount":3000}]', 'key-bad-000008')$$, 'negative amount');
select pg_temp.expect_fail($$select public.play_roulette('[{"kind":"red","amount":100001}]', 'key-bad-000009')$$, 'total above maximum');
select pg_temp.expect_fail($$select public.play_plinko(1000, 10, 'high', 'key-bad-000010')$$, 'rows not offered');
select pg_temp.expect_fail($$select public.play_plinko(1000, 12, 'extreme', 'key-bad-000011')$$, 'risk not offered');
select pg_temp.expect_fail($$select public.play_plinko(500, 12, 'low', 'key-bad-000012')$$, 'stake below minimum');

-- 4. Many plinko rounds keep the invariants
do $$
declare i int; r jsonb;
begin
  for i in 1 .. 40 loop
    r := public.play_plinko(1000, (array[8, 12, 16])[1 + i % 3], (array['low', 'medium', 'high'])[1 + i % 3], 'key-plinko-' || lpad(i::text, 4, '0'));
    if jsonb_array_length(r->'path') <> (r->>'rows')::int
       or (r->>'slot')::int <> (select sum(x::int) from jsonb_array_elements_text(r->'path') x) then
      raise exception 'plinko path wrong: %', r;
    end if;
  end loop;
  if exists (select 1 from public.wallet_invariant_violations()) then raise exception 'invariant violated'; end if;
  if (select available from public.wallet_accounts where user_id = auth.uid())
     <> (select 100000 + sum(net_result) from public.game_rounds where user_id = auth.uid()) then
    raise exception 'balance does not equal grant + net results';
  end if;
end $$;

-- 5. Roulette RTP is fixed; the report says so
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_fail($$select public.set_game_rtp('roulette', 9500)$$, 'roulette RTP is fixed');
do $$
declare rep jsonb; g jsonb;
begin
  rep := public.site_report();
  select x into g from jsonb_array_elements(rep->'games') x where x->>'game_id' = 'roulette';
  if not (g->>'rtp_fixed')::boolean or (g->>'rtp_bp')::int <> 9730 or not (g->>'on_server')::boolean then
    raise exception 'roulette report row wrong: %', g;
  end if;
  select x into g from jsonb_array_elements(rep->'games') x where x->>'game_id' = 'plinko';
  if (g->>'rtp_fixed')::boolean or (g->>'rtp_bp')::int <> 9500 or (g->>'rounds')::int <> 49 then
    raise exception 'plinko report row wrong: %', g;
  end if;
end $$;

\echo 'all roulette and plinko checks passed'
rollback;
