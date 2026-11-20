-- Behavioural checks for server-side Little Bolt (5×3 slot, ten lines).
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

-- 1. Every stop, multiplier, retrigger and payout equals playBolt in TypeScript, at three RTP settings,
--    for plain spins and spins that start free spins (one of them retriggers).
do $$
declare v record; r jsonb; rtp_now int := 9600; i int := 0; base_stops text; free_stops text; before bigint;
begin
  for v in select * from (values
('0000000000000000000000000000000000000000000000000000000000000000', 'abc', 0, 9600, '12,11,17,0,2', '', 2393, 0),
('0000000000000000000000000000000000000000000000000000000000000000', 'abc', 0, 9000, '12,11,17,0,2', '', 2243, 0),
('0000000000000000000000000000000000000000000000000000000000000000', 'abc', 0, 9900, '12,11,17,0,2', '', 2468, 0),
('0000000000000000000000000000000000000000000000000000000000000000', 'بذرة', 7, 9600, '28,2,15,2,21', '', 0, 0),
('0000000000000000000000000000000000000000000000000000000000000000', 'بذرة', 7, 9000, '28,2,15,2,21', '', 0, 0),
('0000000000000000000000000000000000000000000000000000000000000000', 'بذرة', 7, 9900, '28,2,15,2,21', '', 0, 0),
('0000000000000000000000000000000000000000000000000000000000000000', 'x', 123456789, 9600, '14,27,16,29,13', '', 0, 0),
('0000000000000000000000000000000000000000000000000000000000000000', 'x', 123456789, 9000, '14,27,16,29,13', '', 0, 0),
('0000000000000000000000000000000000000000000000000000000000000000', 'x', 123456789, 9900, '14,27,16,29,13', '', 0, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'abc', 0, 9600, '27,9,6,24,22', '', 0, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'abc', 0, 9000, '27,9,6,24,22', '', 0, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'abc', 0, 9900, '27,9,6,24,22', '', 0, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'بذرة', 7, 9600, '30,1,4,1,17', '', 0, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'بذرة', 7, 9000, '30,1,4,1,17', '', 0, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'بذرة', 7, 9900, '30,1,4,1,17', '', 0, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'x', 123456789, 9600, '0,9,0,14,27', '', 598, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'x', 123456789, 9000, '0,9,0,14,27', '', 560, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'x', 123456789, 9900, '0,9,0,14,27', '', 617, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'abc', 0, 9600, '30,13,2,1,17', '', 2393, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'abc', 0, 9000, '30,13,2,1,17', '', 2243, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'abc', 0, 9900, '30,13,2,1,17', '', 2468, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'بذرة', 7, 9600, '13,6,12,31,12', '', 0, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'بذرة', 7, 9000, '13,6,12,31,12', '', 0, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'بذرة', 7, 9900, '13,6,12,31,12', '', 0, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'x', 123456789, 9600, '2,8,19,8,3', '', 0, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'x', 123456789, 9000, '2,8,19,8,3', '', 0, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'x', 123456789, 9900, '2,8,19,8,3', '', 0, 0),
('abababababababababababababababababababababababababababababababab', 'trigger', 78, 9600, '31,13,14,7,31', '16,31,30,7,22x1+0;5,30,18,28,25x1+0;10,15,9,12,3x2+0;13,6,14,10,6x2+0;28,11,26,26,18x2+0;29,22,24,11,12x4+0;23,18,11,19,14x4+0;2,4,29,16,29x6+0;6,26,17,21,10x8+0;24,15,26,9,14x9+0', 598, 30712),
('abababababababababababababababababababababababababababababababab', 'trigger', 78, 9000, '31,13,14,7,31', '16,31,30,7,22x1+0;5,30,18,28,25x1+0;10,15,9,12,3x2+0;13,6,14,10,6x2+0;28,11,26,26,18x2+0;29,22,24,11,12x4+0;23,18,11,19,14x4+0;2,4,29,16,29x6+0;6,26,17,21,10x8+0;24,15,26,9,14x9+0', 560, 28792),
('abababababababababababababababababababababababababababababababab', 'trigger', 78, 9900, '31,13,14,7,31', '16,31,30,7,22x1+0;5,30,18,28,25x1+0;10,15,9,12,3x2+0;13,6,14,10,6x2+0;28,11,26,26,18x2+0;29,22,24,11,12x4+0;23,18,11,19,14x4+0;2,4,29,16,29x6+0;6,26,17,21,10x8+0;24,15,26,9,14x9+0', 617, 31672),
('abababababababababababababababababababababababababababababababab', 'trigger', 85, 9600, '11,16,22,9,24', '7,19,31,28,16x1+0;24,25,24,26,30x2+0;30,15,17,4,29x3+0;14,19,7,29,24x4+0;9,0,24,31,1x5+0;11,27,25,23,23x5+0;5,0,31,22,5x6+0;1,0,17,27,15x6+0;22,30,15,18,10x7+0;1,27,0,2,2x10+0', 0, 29916),
('abababababababababababababababababababababababababababababababab', 'trigger', 85, 9000, '11,16,22,9,24', '7,19,31,28,16x1+0;24,25,24,26,30x2+0;30,15,17,4,29x3+0;14,19,7,29,24x4+0;9,0,24,31,1x5+0;11,27,25,23,23x5+0;5,0,31,22,5x6+0;1,0,17,27,15x6+0;22,30,15,18,10x7+0;1,27,0,2,2x10+0', 0, 28046),
('abababababababababababababababababababababababababababababababab', 'trigger', 85, 9900, '11,16,22,9,24', '7,19,31,28,16x1+0;24,25,24,26,30x2+0;30,15,17,4,29x3+0;14,19,7,29,24x4+0;9,0,24,31,1x5+0;11,27,25,23,23x5+0;5,0,31,22,5x6+0;1,0,17,27,15x6+0;22,30,15,18,10x7+0;1,27,0,2,2x10+0', 0, 30850),
('abababababababababababababababababababababababababababababababab', 'trigger', 324, 9600, '11,5,14,10,0', '23,5,22,4,5x1+0;2,18,0,15,8x2+0;17,4,19,19,21x3+0;5,16,28,7,24x5+0;18,23,20,31,22x5+0;25,17,13,11,29x5+0;2,7,23,27,19x7+0;29,23,14,9,30x8+0;20,12,18,31,28x9+0;20,24,29,22,24x9+0', 0, 14359),
('abababababababababababababababababababababababababababababababab', 'trigger', 324, 9000, '11,5,14,10,0', '23,5,22,4,5x1+0;2,18,0,15,8x2+0;17,4,19,19,21x3+0;5,16,28,7,24x5+0;18,23,20,31,22x5+0;25,17,13,11,29x5+0;2,7,23,27,19x7+0;29,23,14,9,30x8+0;20,12,18,31,28x9+0;20,24,29,22,24x9+0', 0, 13462),
('abababababababababababababababababababababababababababababababab', 'trigger', 324, 9900, '11,5,14,10,0', '23,5,22,4,5x1+0;2,18,0,15,8x2+0;17,4,19,19,21x3+0;5,16,28,7,24x5+0;18,23,20,31,22x5+0;25,17,13,11,29x5+0;2,7,23,27,19x7+0;29,23,14,9,30x8+0;20,12,18,31,28x9+0;20,24,29,22,24x9+0', 0, 14808),
('abababababababababababababababababababababababababababababababab', 'trigger', 483, 9600, '9,12,24,8,1', '23,10,24,0,20x1+0;24,1,7,16,24x3+0;20,30,8,19,25x3+0;6,19,25,31,23x4+0;4,19,5,21,0x5+0;10,5,10,3,26x5+0;20,13,9,7,2x5+0;10,2,7,8,21x5+0;30,27,26,1,28x6+0;19,25,15,3,2x7+0', 598, 22135),
('abababababababababababababababababababababababababababababababab', 'trigger', 483, 9000, '9,12,24,8,1', '23,10,24,0,20x1+0;24,1,7,16,24x3+0;20,30,8,19,25x3+0;6,19,25,31,23x4+0;4,19,5,21,0x5+0;10,5,10,3,26x5+0;20,13,9,7,2x5+0;10,2,7,8,21x5+0;30,27,26,1,28x6+0;19,25,15,3,2x7+0', 560, 20751),
('abababababababababababababababababababababababababababababababab', 'trigger', 483, 9900, '9,12,24,8,1', '23,10,24,0,20x1+0;24,1,7,16,24x3+0;20,30,8,19,25x3+0;6,19,25,31,23x4+0;4,19,5,21,0x5+0;10,5,10,3,26x5+0;20,13,9,7,2x5+0;10,2,7,8,21x5+0;30,27,26,1,28x6+0;19,25,15,3,2x7+0', 617, 22829),
('abababababababababababababababababababababababababababababababab', 'trigger', 4028, 9600, '9,25,16,9,5', '24,27,13,31,20x1+0;1,14,7,26,21x1+0;6,22,31,9,9x1+0;19,0,15,27,9x2+0;19,8,17,27,24x4+0;0,25,13,13,2x5+0;9,25,2,16,29x5+0;13,12,16,9,31x7+5;28,14,20,10,9x8+0;22,19,16,26,15x9+0;10,14,29,2,14x10+0;1,1,6,1,26x10+0;16,16,2,0,29x10+0;17,14,17,11,11x12+0;26,9,6,10,1x12+0', 0, 199441),
('abababababababababababababababababababababababababababababababab', 'trigger', 4028, 9000, '9,25,16,9,5', '24,27,13,31,20x1+0;1,14,7,26,21x1+0;6,22,31,9,9x1+0;19,0,15,27,9x2+0;19,8,17,27,24x4+0;0,25,13,13,2x5+0;9,25,2,16,29x5+0;13,12,16,9,31x7+5;28,14,20,10,9x8+0;22,19,16,26,15x9+0;10,14,29,2,14x10+0;1,1,6,1,26x10+0;16,16,2,0,29x10+0;17,14,17,11,11x12+0;26,9,6,10,1x12+0', 0, 186975),
('abababababababababababababababababababababababababababababababab', 'trigger', 4028, 9900, '9,25,16,9,5', '24,27,13,31,20x1+0;1,14,7,26,21x1+0;6,22,31,9,9x1+0;19,0,15,27,9x2+0;19,8,17,27,24x4+0;0,25,13,13,2x5+0;9,25,2,16,29x5+0;13,12,16,9,31x7+5;28,14,20,10,9x8+0;22,19,16,26,15x9+0;10,14,29,2,14x10+0;1,1,6,1,26x10+0;16,16,2,0,29x10+0;17,14,17,11,11x12+0;26,9,6,10,1x12+0', 0, 205672)
  ) as t(seed, client, nonce, rtp, base_stops, free_stops, base_gross, free_gross) order by rtp
  loop
    i := i + 1;
    if v.rtp <> rtp_now then
      perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
      perform public.set_game_rtp('bolt', v.rtp);
      rtp_now := v.rtp;
    end if;
    perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
    perform pg_temp.use_seed(v.seed, v.client, v.nonce);
    select available into before from public.wallet_accounts where user_id = auth.uid();
    r := public.play_bolt(2000, 'key-bolt-vec-' || i);
    select string_agg(x, ',' order by o) into base_stops from jsonb_array_elements_text(r#>'{base,stops}') with ordinality a(x, o);
    select coalesce(string_agg((select string_agg(x, ',' order by o) from jsonb_array_elements_text(f->'stops') with ordinality a(x, o))
                               || 'x' || (f->>'multiplier') || '+' || (f->>'added'), ';' order by fo), '') into free_stops
      from jsonb_array_elements(r->'free_spins') with ordinality b(f, fo);
    if base_stops <> v.base_stops or free_stops <> v.free_stops
       or (r->>'base_gross')::bigint <> v.base_gross or (r->>'free_gross')::bigint <> v.free_gross
       or (r->>'gross')::bigint <> v.base_gross + v.free_gross
       or (r->>'rtp_bp')::int <> v.rtp then
      raise exception 'bolt mismatch at vector % (% % % rtp=%): %', i, v.seed, v.client, v.nonce, v.rtp, r;
    end if;
    if (select available from public.wallet_accounts where user_id = auth.uid()) <> before - 2000 + (r->>'gross')::bigint then
      raise exception 'bolt balance wrong at vector %', i;
    end if;
  end loop;
  if i < 42 then raise exception 'expected 42 vectors, ran %', i; end if;
end $$;

-- 2. Rejected requests, replay, invariants, pause
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.expect_fail($$select public.play_bolt(1005, 'key-bolt-bad1')$$, 'stake not a multiple of 10');
select pg_temp.expect_fail($$select public.play_bolt(990, 'key-bolt-bad2')$$, 'stake below minimum');
select pg_temp.expect_fail($$select public.play_bolt(100010, 'key-bolt-bad3')$$, 'stake above maximum');
select pg_temp.expect_fail($$select public.play_bolt(1000, 'short')$$, 'idempotency key too short');
do $$
declare r jsonb; r2 jsonb; n int;
begin
  r := public.play_bolt(1000, 'key-bolt-0001');
  select count(*) into n from public.game_rounds;
  r2 := public.play_bolt(1000, 'key-bolt-0001');
  if r2->>'round_id' <> r->>'round_id' or not (r2->>'replay')::boolean or (select count(*) from public.game_rounds) <> n then
    raise exception 'bolt replay wrong';
  end if;
  for i in 1 .. 300 loop
    perform public.play_bolt(1000, 'key-bolt-many-' || i);
  end loop;
  if exists (select 1 from public.wallet_invariant_violations()) then raise exception 'invariant violated'; end if;
  if exists (select 1 from public.game_rounds where game_id = 'bolt' and status <> 'SETTLED') then raise exception 'open round left'; end if;
  if (select count(*) from public.game_rounds where game_id = 'bolt') < 300 then raise exception 'rounds missing'; end if;
end $$;

-- anonymous visitors cannot play
select pg_temp.as_user('');
select pg_temp.expect_fail($$select public.play_bolt(1000, 'key-bolt-anon')$$, 'visitor');

-- the owner pauses the game
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.set_game_status('bolt', 'paused');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.expect_fail($$select public.play_bolt(1000, 'key-bolt-paused')$$, 'paused game');

\echo 'all little bolt checks passed'
rollback;
