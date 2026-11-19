-- Behavioural checks for server-side Bubble Reef (3×3 slot).
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

-- Test only: a fresh seed pair with a known seed, and extra points through the ledger.
create function pg_temp.use_seed(p_seed text, p_client text, p_nonce bigint) returns void language plpgsql as $$
begin
  update public.seed_pairs set status = 'revealed', server_seed_revealed = public.seed_plain(server_seed_enc), revealed_at = now()
   where user_id = auth.uid() and status = 'active';
  insert into public.seed_pairs (user_id, server_seed_enc, server_seed_hash, client_seed, next_nonce)
  values (auth.uid(), p_seed, encode(sha256(decode(p_seed, 'hex')), 'hex'), p_client, p_nonce);
end $$;

create function pg_temp.top_up(p_amount bigint) returns void language plpgsql as $$
declare w public.wallet_accounts;
begin
  select * into w from public.wallet_accounts where user_id = auth.uid() for update;
  insert into public.wallet_ledger (user_id, type, amount, available_after, reserved_after, idempotency_key)
  values (auth.uid(), 'RECOVERY_GRANT', p_amount, w.available + p_amount, w.reserved, 'test:' || gen_random_uuid());
  update public.wallet_accounts set available = available + p_amount where user_id = auth.uid();
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.complete_join('ward', true, true);
do $$ begin perform public.claim_ownership(); end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select public.complete_join('friend', true, true);
select pg_temp.top_up(5000000);

-- 1. Every stop, multiplier, retrigger and payout equals playReef in TypeScript, at three RTP settings,
--    for plain spins and spins that start free spins (one of them retriggers).
do $$
declare v record; r jsonb; rtp_now int := 9600; i int := 0; base_stops text; free_stops text; before bigint;
begin
  for v in select * from (values
('0000000000000000000000000000000000000000000000000000000000000000', 'abc', 0, 9600, '2,24,14', '', 0, 0),
('0000000000000000000000000000000000000000000000000000000000000000', 'abc', 0, 9000, '2,24,14', '', 0, 0),
('0000000000000000000000000000000000000000000000000000000000000000', 'abc', 0, 9900, '2,24,14', '', 0, 0),
('0000000000000000000000000000000000000000000000000000000000000000', 'بذرة', 7, 9600, '12,0,15', '', 4006, 0),
('0000000000000000000000000000000000000000000000000000000000000000', 'بذرة', 7, 9000, '12,0,15', '', 3756, 0),
('0000000000000000000000000000000000000000000000000000000000000000', 'بذرة', 7, 9900, '12,0,15', '', 4131, 0),
('0000000000000000000000000000000000000000000000000000000000000000', 'x', 123456789, 9600, '7,13,15', '', 2003, 0),
('0000000000000000000000000000000000000000000000000000000000000000', 'x', 123456789, 9000, '7,13,15', '', 1878, 0),
('0000000000000000000000000000000000000000000000000000000000000000', 'x', 123456789, 9900, '7,13,15', '', 2065, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'abc', 0, 9600, '6,19,17', '', 20032, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'abc', 0, 9000, '6,19,17', '', 18780, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'abc', 0, 9900, '6,19,17', '', 20658, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'بذرة', 7, 9600, '8,25,24', '', 0, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'بذرة', 7, 9000, '8,25,24', '', 0, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'بذرة', 7, 9900, '8,25,24', '', 0, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'x', 123456789, 9600, '18,1,14', '', 0, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'x', 123456789, 9000, '18,1,14', '', 0, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'x', 123456789, 9900, '18,1,14', '', 0, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'abc', 0, 9600, '16,3,2', '', 7211, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'abc', 0, 9000, '16,3,2', '', 6761, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'abc', 0, 9900, '16,3,2', '', 7437, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'بذرة', 7, 9600, '25,6,10', '', 6811, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'بذرة', 7, 9000, '25,6,10', '', 6385, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'بذرة', 7, 9900, '25,6,10', '', 7023, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'x', 123456789, 9600, '4,13,21', '', 2804, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'x', 123456789, 9000, '4,13,21', '', 2629, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'x', 123456789, 9900, '4,13,21', '', 2892, 0),
('abababababababababababababababababababababababababababababababab', 'trigger', 213, 9600, '24,24,27', '14,14,24x1+0;21,6,6x2+0;22,26,1x2+0;5,2,10x3+0;9,14,27x3+0;11,18,2x4+0;26,15,6x4+0;14,21,17x4+0', 0, 35656),
('abababababababababababababababababababababababababababababababab', 'trigger', 213, 9000, '24,24,27', '14,14,24x1+0;21,6,6x2+0;22,26,1x2+0;5,2,10x3+0;9,14,27x3+0;11,18,2x4+0;26,15,6x4+0;14,21,17x4+0', 0, 33429),
('abababababababababababababababababababababababababababababababab', 'trigger', 245, 9600, '24,4,23', '18,8,11x1+0;12,8,9x1+0;5,10,18x1+0;21,15,21x1+0;14,25,17x2+0;0,1,8x4+0;22,8,18x4+0;18,27,10x5+0', 0, 48877),
('abababababababababababababababababababababababababababababababab', 'trigger', 245, 9000, '24,4,23', '18,8,11x1+0;12,8,9x1+0;5,10,18x1+0;21,15,21x1+0;14,25,17x2+0;0,1,8x4+0;22,8,18x4+0;18,27,10x5+0', 0, 45823),
('abababababababababababababababababababababababababababababababab', 'trigger', 598, 9600, '13,3,28', '5,15,11x1+0;0,29,9x1+0;27,17,27x1+0;23,26,12x2+0;18,23,0x3+0;7,27,17x4+0;4,15,19x4+0;6,6,25x4+0', 0, 10817),
('abababababababababababababababababababababababababababababababab', 'trigger', 598, 9000, '13,3,28', '5,15,11x1+0;0,29,9x1+0;27,17,27x1+0;23,26,12x2+0;18,23,0x3+0;7,27,17x4+0;4,15,19x4+0;6,6,25x4+0', 0, 10141),
('abababababababababababababababababababababababababababababababab', 'trigger', 2591, 9600, '15,3,23', '3,10,10x1+0;6,20,26x1+0;13,2,10x1+0;28,3,19x2+0;24,17,27x3+0;14,25,28x5+5;7,5,14x8+0;1,20,9x9+0;20,15,6x9+0;9,13,29x9+0;3,19,22x10+0;12,7,9x11+0;14,27,27x11+0', 0, 145436),
('abababababababababababababababababababababababababababababababab', 'trigger', 2591, 9000, '15,3,23', '3,10,10x1+0;6,20,26x1+0;13,2,10x1+0;28,3,19x2+0;24,17,27x3+0;14,25,28x5+5;7,5,14x8+0;1,20,9x9+0;20,15,6x9+0;9,13,29x9+0;3,19,22x10+0;12,7,9x11+0;14,27,27x11+0', 0, 136346)
  ) as t(seed, client, nonce, rtp, base_stops, free_stops, base_gross, free_gross) order by rtp
  loop
    i := i + 1;
    if v.rtp <> rtp_now then
      perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
      perform public.set_game_rtp('reef', v.rtp);
      rtp_now := v.rtp;
    end if;
    perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
    perform pg_temp.use_seed(v.seed, v.client, v.nonce);
    select available into before from public.wallet_accounts where user_id = auth.uid();
    r := public.play_reef(2000, 'key-reef-vec-' || i);
    select string_agg(x, ',' order by o) into base_stops from jsonb_array_elements_text(r#>'{base,stops}') with ordinality a(x, o);
    select coalesce(string_agg((select string_agg(x, ',' order by o) from jsonb_array_elements_text(f->'stops') with ordinality a(x, o))
                               || 'x' || (f->>'multiplier') || '+' || (f->>'added'), ';' order by fo), '') into free_stops
      from jsonb_array_elements(r->'free_spins') with ordinality b(f, fo);
    if base_stops <> v.base_stops or free_stops <> v.free_stops
       or (r->>'base_gross')::bigint <> v.base_gross or (r->>'free_gross')::bigint <> v.free_gross
       or (r->>'gross')::bigint <> v.base_gross + v.free_gross
       or (r->>'rtp_bp')::int <> v.rtp then
      raise exception 'reef mismatch at vector % (% % % rtp=%): %', i, v.seed, v.client, v.nonce, v.rtp, r;
    end if;
    if (select available from public.wallet_accounts where user_id = auth.uid()) <> before - 2000 + (r->>'gross')::bigint then
      raise exception 'reef balance wrong at vector %', i;
    end if;
  end loop;
  if i < 35 then raise exception 'expected 35 vectors, ran %', i; end if;
end $$;

-- 2. Rejected requests, replay, invariants, pause
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.expect_fail($$select public.play_reef(1005, 'key-reef-bad1')$$, 'stake not a multiple of 10');
select pg_temp.expect_fail($$select public.play_reef(990, 'key-reef-bad2')$$, 'stake below minimum');
select pg_temp.expect_fail($$select public.play_reef(100010, 'key-reef-bad3')$$, 'stake above maximum');
select pg_temp.expect_fail($$select public.play_reef(1000, 'short')$$, 'idempotency key too short');
do $$
declare r jsonb; r2 jsonb; n int;
begin
  r := public.play_reef(1000, 'key-reef-0001');
  select count(*) into n from public.game_rounds;
  r2 := public.play_reef(1000, 'key-reef-0001');
  if r2->>'round_id' <> r->>'round_id' or not (r2->>'replay')::boolean or (select count(*) from public.game_rounds) <> n then
    raise exception 'reef replay wrong';
  end if;
  for i in 1 .. 300 loop
    perform public.play_reef(1000, 'key-reef-many-' || i);
  end loop;
  if exists (select 1 from public.wallet_invariant_violations()) then raise exception 'invariant violated'; end if;
  if exists (select 1 from public.game_rounds where game_id = 'reef' and status <> 'SETTLED') then raise exception 'open round left'; end if;
  if (select count(*) from public.game_rounds where game_id = 'reef') < 300 then raise exception 'rounds missing'; end if;
end $$;

-- anonymous visitors cannot play
select pg_temp.as_user('');
select pg_temp.expect_fail($$select public.play_reef(1000, 'key-reef-anon')$$, 'visitor');

-- the owner pauses the game
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.set_game_status('reef', 'paused');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.expect_fail($$select public.play_reef(1000, 'key-reef-paused')$$, 'paused game');

\echo 'all bubble reef checks passed'
rollback;
