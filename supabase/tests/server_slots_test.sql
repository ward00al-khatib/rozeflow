-- Behavioural checks for server-side Slots.
\set QUIET on
begin;
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2');

create function pg_temp.as_user(uid text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', uid, true) $$;

create function pg_temp.expect_fail(stmt text, label text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then raise notice 'ok: % (%)', label, sqlerrm; return; end;
  raise exception 'expected failure: %', label;
end $$;

-- Test only: a fresh seed pair with a known seed, and extra points through the ledger.
create function pg_temp.use_seed(p_seed text, p_client text, p_nonce bigint) returns void language plpgsql as $$
begin
  update public.seed_pairs set status = 'revealed', server_seed_revealed = server_seed_enc, revealed_at = now()
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

-- 1. Every stop, multiplier and payout equals playSlots in TypeScript, at three RTP settings,
--    for normal spins, bought free spins and base spins that trigger free spins by themselves.
do $$
declare v record; r jsonb; rtp_now int := 9583; i int := 0; base_stops text; free_stops text; before bigint;
begin
  for v in select * from (values
('0000000000000000000000000000000000000000000000000000000000000000', 'abc', 0, false, 9583, '5,32,17,21,16', '', 0, 0),
('0000000000000000000000000000000000000000000000000000000000000000', 'abc', 0, true, 9583, '', '5,32,17,21,16x1;21,46,20,8,43x1;43,31,12,28,17x2;48,9,38,48,29x2;27,10,25,40,32x3;35,29,26,35,46x3;16,11,19,31,19x3;29,48,7,7,38x3;30,44,40,45,22x3;9,13,14,2,8x4', 0, 12696),
('0000000000000000000000000000000000000000000000000000000000000000', 'abc', 0, true, 9000, '', '5,32,17,21,16x1;21,46,20,8,43x1;43,31,12,28,17x2;48,9,38,48,29x2;27,10,25,40,32x3;35,29,26,35,46x3;16,11,19,31,19x3;29,48,7,7,38x3;30,44,40,45,22x3;9,13,14,2,8x4', 0, 11925),
('0000000000000000000000000000000000000000000000000000000000000000', 'abc', 0, false, 9900, '5,32,17,21,16', '', 0, 0),
('0000000000000000000000000000000000000000000000000000000000000000', 'بذرة', 7, false, 9583, '35,36,38,38,6', '', 0, 0),
('0000000000000000000000000000000000000000000000000000000000000000', 'بذرة', 7, true, 9583, '', '35,36,38,38,6x1;19,22,20,8,14x1;36,25,16,21,20x2;25,48,4,19,23x2;18,22,9,7,14x3;41,45,37,13,36x4;28,9,45,34,11x4;25,34,5,33,5x5;21,19,7,36,9x5;49,2,24,38,10x6', 0, 29394),
('0000000000000000000000000000000000000000000000000000000000000000', 'بذرة', 7, true, 9000, '', '35,36,38,38,6x1;19,22,20,8,14x1;36,25,16,21,20x2;25,48,4,19,23x2;18,22,9,7,14x3;41,45,37,13,36x4;28,9,45,34,11x4;25,34,5,33,5x5;21,19,7,36,9x5;49,2,24,38,10x6', 0, 27609),
('0000000000000000000000000000000000000000000000000000000000000000', 'بذرة', 7, false, 9900, '35,36,38,38,6', '', 0, 0),
('0000000000000000000000000000000000000000000000000000000000000000', 'x', 123456789, false, 9583, '2,32,22,4,22', '', 0, 0),
('0000000000000000000000000000000000000000000000000000000000000000', 'x', 123456789, true, 9583, '', '2,32,22,4,22x1;25,39,32,11,5x1;23,30,40,21,37x1;17,36,24,5,15x1;30,8,19,16,36x1;46,3,16,10,10x1;37,40,11,35,45x1;29,16,45,32,43x2;13,17,37,16,42x3;40,39,31,47,15x4', 0, 51596),
('0000000000000000000000000000000000000000000000000000000000000000', 'x', 123456789, true, 9000, '', '2,32,22,4,22x1;25,39,32,11,5x1;23,30,40,21,37x1;17,36,24,5,15x1;30,8,19,16,36x1;46,3,16,10,10x1;37,40,11,35,45x1;29,16,45,32,43x2;13,17,37,16,42x3;40,39,31,47,15x4', 0, 48458),
('0000000000000000000000000000000000000000000000000000000000000000', 'x', 123456789, false, 9900, '2,32,22,4,22', '', 0, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'abc', 0, false, 9583, '7,11,11,39,25', '', 0, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'abc', 0, true, 9583, '', '7,11,11,39,25x1;38,12,22,44,18x1;12,26,45,9,26x2;21,14,15,13,49x3;18,1,30,7,8x4;39,49,18,11,17x5;20,30,15,40,20x6;18,34,19,9,32x7;41,46,15,0,2x7;6,42,48,42,35x8', 0, 36893),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'abc', 0, true, 9000, '', '7,11,11,39,25x1;38,12,22,44,18x1;12,26,45,9,26x2;21,14,15,13,49x3;18,1,30,7,8x4;39,49,18,11,17x5;20,30,15,40,20x6;18,34,19,9,32x7;41,46,15,0,2x7;6,42,48,42,35x8', 0, 34652),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'abc', 0, false, 9900, '7,11,11,39,25', '', 0, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'بذرة', 7, false, 9583, '41,12,39,43,6', '', 1999, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'بذرة', 7, true, 9583, '', '41,12,39,43,6x1;36,3,22,44,20x2;24,48,47,39,30x2;33,31,17,1,23x3;33,33,0,4,23x3;4,18,30,29,31x3;41,6,15,43,3x4;30,31,26,14,5x4;14,1,24,19,42x4;44,16,35,4,23x5', 0, 25895),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'بذرة', 7, true, 9000, '', '41,12,39,43,6x1;36,3,22,44,20x2;24,48,47,39,30x2;33,31,17,1,23x3;33,33,0,4,23x3;4,18,30,29,31x3;41,6,15,43,3x4;30,31,26,14,5x4;14,1,24,19,42x4;44,16,35,4,23x5', 0, 24322),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'بذرة', 7, false, 9900, '41,12,39,43,6', '', 2066, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'x', 123456789, false, 9583, '12,23,49,18,6', '', 0, 0),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'x', 123456789, true, 9583, '', '12,23,49,18,6x1;46,23,29,20,30x1;12,31,18,40,21x1;11,29,41,6,14x2;27,21,36,43,41x2;17,16,46,16,47x3;49,36,34,31,7x3;34,46,29,9,38x4;19,0,7,47,14x5;15,27,21,36,32x6', 0, 25495),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'x', 123456789, true, 9000, '', '12,23,49,18,6x1;46,23,29,20,30x1;12,31,18,40,21x1;11,29,41,6,14x2;27,21,36,43,41x2;17,16,46,16,47x3;49,36,34,31,7x3;34,46,29,9,38x4;19,0,7,47,14x5;15,27,21,36,32x6', 0, 23946),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'x', 123456789, false, 9900, '12,23,49,18,6', '', 0, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'abc', 0, false, 9583, '28,33,43,25,44', '', 499, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'abc', 0, true, 9583, '', '28,33,43,25,44x1;27,36,1,14,30x2;1,10,32,10,6x3;16,41,48,34,19x3;1,5,34,5,27x4;38,47,42,47,9x4;15,6,30,46,7x5;18,26,9,17,24x5;33,34,13,10,39x5;0,33,41,23,5x5', 0, 8696),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'abc', 0, true, 9000, '', '28,33,43,25,44x1;27,36,1,14,30x2;1,10,32,10,6x3;16,41,48,34,19x3;1,5,34,5,27x4;38,47,42,47,9x4;15,6,30,46,7x5;18,26,9,17,24x5;33,34,13,10,39x5;0,33,41,23,5x5', 0, 8168),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'abc', 0, false, 9900, '28,33,43,25,44', '', 516, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'بذرة', 7, false, 9583, '45,32,23,36,17', '', 599, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'بذرة', 7, true, 9583, '', '45,32,23,36,17x1;19,33,20,43,49x2;10,45,46,20,13x3;19,29,7,16,48x3;5,46,25,32,4x4;13,39,4,5,45x4;12,1,24,24,35x5;3,10,12,32,29x6;47,19,20,28,37x7;44,10,7,6,43x8', 0, 69393),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'بذرة', 7, true, 9000, '', '45,32,23,36,17x1;19,33,20,43,49x2;10,45,46,20,13x3;19,29,7,16,48x3;5,46,25,32,4x4;13,39,4,5,45x4;12,1,24,24,35x5;3,10,12,32,29x6;47,19,20,28,37x7;44,10,7,6,43x8', 0, 65174),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'بذرة', 7, false, 9900, '45,32,23,36,17', '', 619, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'x', 123456789, false, 9583, '35,34,49,32,43', '', 0, 0),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'x', 123456789, true, 9583, '', '35,34,49,32,43x1;30,34,46,16,4x1;45,39,22,35,24x1;7,23,13,2,37x2;21,9,12,35,30x3;48,46,1,14,22x4;44,29,20,2,41x4;5,31,4,21,9x4;48,45,42,37,48x4;44,33,14,47,37x4', 0, 6396),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'x', 123456789, true, 9000, '', '35,34,49,32,43x1;30,34,46,16,4x1;45,39,22,35,24x1;7,23,13,2,37x2;21,9,12,35,30x3;48,46,1,14,22x4;44,29,20,2,41x4;5,31,4,21,9x4;48,45,42,37,48x4;44,33,14,47,37x4', 0, 6008),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'x', 123456789, false, 9900, '35,34,49,32,43', '', 0, 0),
('abababababababababababababababababababababababababababababababab', 'trigger', 9, false, 9583, '15,26,33,49,37', '28,7,42,34,27x1;5,40,22,33,14x1;14,44,36,7,32x2;44,18,30,47,15x2;48,38,27,20,44x3;8,3,14,24,7x3;22,1,24,23,37x4;35,38,38,8,39x5;46,26,3,16,12x6;28,27,7,6,16x6', 0, 35695),
('abababababababababababababababababababababababababababababababab', 'trigger', 102, false, 9583, '29,17,36,47,5', '6,19,48,27,9x1;29,49,47,46,16x2;28,7,25,28,1x2;47,47,34,22,2x3;12,31,26,44,18x3;46,33,13,6,47x3;22,7,39,41,18x4;41,11,36,16,20x5;2,39,14,38,32x6;1,11,19,26,0x7', 999, 47294)
  ) as t(seed, client, nonce, buy, rtp, base_stops, free_stops, base_gross, free_gross) order by rtp
  loop
    i := i + 1;
    if v.rtp <> rtp_now then
      perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
      perform public.set_game_rtp('slots', v.rtp);
      rtp_now := v.rtp;
    end if;
    perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
    perform pg_temp.use_seed(v.seed, v.client, v.nonce);
    select available into before from public.wallet_accounts where user_id = auth.uid();
    r := public.play_slots(2000, v.buy, 'key-slots-vec-' || i);
    select coalesce(string_agg(x, ',' order by o), '') into base_stops
      from jsonb_array_elements_text(case when jsonb_typeof(r->'base') = 'object' then r#>'{base,stops}' else '[]'::jsonb end) with ordinality a(x, o);
    select coalesce(string_agg((select string_agg(x, ',' order by o) from jsonb_array_elements_text(f->'stops') with ordinality a(x, o))
                               || 'x' || (f->>'multiplier'), ';' order by fo), '') into free_stops
      from jsonb_array_elements(r->'free_spins') with ordinality b(f, fo);
    if base_stops <> v.base_stops or free_stops <> v.free_stops
       or (r->>'base_gross')::bigint <> v.base_gross or (r->>'free_gross')::bigint <> v.free_gross
       or (r->>'gross')::bigint <> v.base_gross + v.free_gross
       or (r->>'cost')::bigint <> 2000 + 52000 * v.buy::int
       or (r->>'rtp_bp')::int <> v.rtp then
      raise exception 'slots mismatch at vector % (% % % buy=% rtp=%): %', i, v.seed, v.client, v.nonce, v.buy, v.rtp, r;
    end if;
    if (select available from public.wallet_accounts where user_id = auth.uid())
       <> before - (r->>'cost')::bigint + (r->>'gross')::bigint then
      raise exception 'slots balance wrong at vector %', i;
    end if;
  end loop;
  if i < 38 then raise exception 'expected 38 vectors, ran %', i; end if;
end $$;

-- 2. Rejected requests, replay, invariants
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.expect_fail($$select public.play_slots(1010, false, 'key-slots-bad1')$$, 'stake not a multiple of 20');
select pg_temp.expect_fail($$select public.play_slots(980, false, 'key-slots-bad2')$$, 'stake below minimum');
select pg_temp.expect_fail($$select public.play_slots(100020, false, 'key-slots-bad3')$$, 'stake above maximum');
do $$
declare r jsonb; r2 jsonb; n int;
begin
  r := public.play_slots(1000, false, 'key-slots-0001');
  select count(*) into n from public.game_rounds;
  r2 := public.play_slots(1000, false, 'key-slots-0001');
  if r2->>'round_id' <> r->>'round_id' or not (r2->>'replay')::boolean or (select count(*) from public.game_rounds) <> n then
    raise exception 'slots replay wrong';
  end if;
  for i in 1 .. 60 loop
    perform public.play_slots(1000, i % 20 = 0, 'key-slots-many-' || i);
  end loop;
  if exists (select 1 from public.wallet_invariant_violations()) then raise exception 'invariant violated'; end if;
  if exists (select 1 from public.game_rounds where status <> 'SETTLED') then raise exception 'open round left'; end if;
end $$;

-- a bought feature needs the whole price
do $$
begin
  update public.wallet_accounts set available = available where user_id = auth.uid();
  perform pg_temp.top_up(-(select available - 20000 from public.wallet_accounts where user_id = auth.uid()));
  begin
    perform public.play_slots(1000, true, 'key-slots-poor');   -- costs 27,000
    raise exception 'bought feature without enough points';
  exception when others then
    if sqlerrm <> 'INSUFFICIENT_BALANCE' then raise; end if;
  end;
  perform public.play_slots(1000, false, 'key-slots-ok01');
  if exists (select 1 from public.wallet_invariant_violations()) then raise exception 'invariant violated at the end'; end if;
end $$;

\echo 'all slots checks passed'
rollback;
