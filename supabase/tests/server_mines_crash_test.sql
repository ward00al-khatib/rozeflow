-- Behavioural checks for server-side Mines and Crash (rounds that stay open between calls).
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

-- Gives the current user a fresh seed pair with a known seed (test only; members cannot write this table).
create function pg_temp.use_seed(p_seed text, p_client text, p_nonce bigint) returns void language plpgsql as $$
begin
  update public.seed_pairs set status = 'revealed', server_seed_revealed = server_seed_enc, revealed_at = now()
   where user_id = auth.uid() and status = 'active';
  insert into public.seed_pairs (user_id, server_seed_enc, server_seed_hash, client_seed, next_nonce)
  values (auth.uid(), p_seed, encode(sha256(decode(p_seed, 'hex')), 'hex'), p_client, p_nonce);
end $$;

-- Moves the open round's start back in time, as if p_seconds had passed.
create function pg_temp.age_round(p_seconds numeric) returns void language sql as $$
  update public.game_rounds set created_at = clock_timestamp() - make_interval(secs => p_seconds::double precision)
   where user_id = auth.uid() and status = 'RUNNING';
$$;

create function pg_temp.check_wallets(label text) returns void language plpgsql as $$
begin
  if exists (select 1 from public.wallet_invariant_violations()) then raise exception 'invariant violated: %', label; end if;
end $$;

-- 1. SQL equals the TypeScript games: mine tiles, crash points, multiplier tables, growth curve
do $$
declare v record; cfg_m jsonb; cfg_c jsonb; tiles int[]; x bigint;
begin
  select config_json into cfg_m from public.game_config_versions where game_id = 'mines' and status = 'ACTIVE';
  select config_json into cfg_c from public.game_config_versions where game_id = 'crash' and status = 'ACTIVE';
  for v in select * from (values
('0000000000000000000000000000000000000000000000000000000000000000', 'abc', 0, '{1,5,6,7,15,18,24}', 367, 345),
('0000000000000000000000000000000000000000000000000000000000000000', 'بذرة', 7, '{0,4,7,11,12,20,22}', 342, 321),
('0000000000000000000000000000000000000000000000000000000000000000', 'x', 123456789, '{2,3,5,9,10,11,19}', 160, 150),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'abc', 0, '{1,2,3,13,18,20,23}', 4088, 3840),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'بذرة', 7, '{1,7,8,13,14,17,22}', 340, 319),
('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'x', 123456789, '{1,5,6,8,10,15,21}', 162, 152),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'abc', 0, '{2,4,5,7,8,10,21}', 236, 222),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'بذرة', 7, '{1,4,7,8,11,16,22}', 144, 136),
('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'x', 123456789, '{3,4,5,7,11,17,18}', 723, 679)
  ) as t(seed, client, nonce, mines, crash, crash93)
  loop
    select array_agg(t order by t) into tiles
      from unnest((public.fair_shuffle(v.seed, v.client, v.nonce, 'rozeflow:v1:mines', 25))[1:7]) t;
    if tiles <> v.mines::int[] then raise exception 'mine tiles mismatch: % vs %', tiles, v.mines; end if;
    x := public.fair_unit_integer(v.seed, v.client, v.nonce, 'rozeflow:v1:crash');
    if public.crash_point(cfg_c, x) <> v.crash
       or public.crash_point(jsonb_set(cfg_c, '{payout_model,target_rtp_bp}', '9300'), x) <> v.crash93 then
      raise exception 'crash point mismatch for % % %', v.seed, v.client, v.nonce;
    end if;
  end loop;
  for v in select * from (values
(9900, 1, 24, 10312, 247500),
(9900, 2, 23, 10760, 2970000),
(9900, 3, 21, 11250, 5692500),
(9900, 4, 19, 11785, 8349000),
(9900, 5, 17, 12375, 9392625),
(9900, 6, 15, 13026, 8349000),
(9900, 7, 13, 13750, 6008750),
(9900, 8, 12, 14558, 8319807),
(9900, 9, 10, 15468, 4041049),
(9900, 10, 9, 16500, 4041049),
(9900, 11, 8, 17678, 3565631),
(9900, 12, 8, 19038, 8319807),
(9900, 13, 7, 20625, 6008750),
(9900, 14, 6, 22500, 3795000),
(9900, 15, 6, 24750, 8349000),
(9900, 16, 5, 27500, 4174500),
(9900, 17, 5, 30937, 9392625),
(9900, 18, 4, 35357, 3578142),
(9900, 19, 4, 41250, 8349000),
(9900, 20, 3, 49500, 2277000),
(9900, 21, 3, 61875, 5692500),
(9900, 22, 2, 82500, 990000),
(9900, 23, 2, 123750, 2970000),
(9900, 24, 1, 247500, 247500),
(9300, 1, 24, 9687, 232500),
(9300, 2, 23, 10108, 2790000),
(9300, 3, 21, 10568, 5347500),
(9300, 4, 19, 11071, 7843000),
(9300, 5, 17, 11625, 8823375),
(9300, 6, 15, 12236, 7843000),
(9300, 7, 13, 12916, 5644583),
(9300, 8, 12, 13676, 7815576),
(9300, 9, 11, 14531, 9490343),
(9300, 10, 9, 15500, 3796137),
(9300, 11, 9, 16607, 9490343),
(9300, 12, 8, 17884, 7815576),
(9300, 13, 7, 19375, 5644583),
(9300, 14, 6, 21136, 3565000),
(9300, 15, 6, 23250, 7843000),
(9300, 16, 5, 25833, 3921500),
(9300, 17, 5, 29062, 8823375),
(9300, 18, 4, 33214, 3361285),
(9300, 19, 4, 38750, 7843000),
(9300, 20, 3, 46500, 2139000),
(9300, 21, 3, 58125, 5347500),
(9300, 22, 2, 77500, 930000),
(9300, 23, 2, 116250, 2790000),
(9300, 24, 1, 232500, 232500)
  ) as t(rtp, mines, maxk, first, top)
  loop
    cfg_m := jsonb_set(cfg_m, '{payout_model,target_rtp_bp}', to_jsonb(v.rtp));
    if public.mines_max_picks(cfg_m, v.mines) <> v.maxk or public.mines_multiplier(cfg_m, v.mines, 1) <> v.first
       or public.mines_multiplier(cfg_m, v.mines, v.maxk) <> v.top then
      raise exception 'mines table mismatch at rtp % mines %', v.rtp, v.mines;
    end if;
  end loop;
  for v in select * from (values
(0, 100),
(1, 100),
(999, 108),
(5000, 149),
(8664, 199),
(20000, 495),
(57565, 10000),
(86000, 97262)
  ) as t(ms, mult)
  loop
    if abs(public.crash_multiplier_at(cfg_c, v.ms) - v.mult) > 1 then raise exception 'growth curve mismatch at % ms', v.ms; end if;
  end loop;
  if public.crash_point(cfg_c, 0) <> 100 or public.crash_point(cfg_c, 4503599627370495) <> 100000 then
    raise exception 'crash point bounds wrong';
  end if;
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.complete_join('ward', true, true);
do $$ begin perform public.claim_ownership(); end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select public.complete_join('friend', true, true);

-- 2. Mines: start, safe picks, cash out. Seed 00.., client abc, nonce 0 → mines at {1,5,6,7,15,18,24}
select pg_temp.expect_fail($$select public.mines_pick(3)$$, 'pick without a round');
select pg_temp.expect_fail($$select public.mines_start(1000, 0, 'key-mines-bad1')$$, 'zero mines');
select pg_temp.expect_fail($$select public.mines_start(1000, 25, 'key-mines-bad2')$$, 'too many mines');
select pg_temp.expect_fail($$select public.mines_start(100, 3, 'key-mines-bad3')$$, 'stake below minimum');
select pg_temp.use_seed(repeat('00', 32), 'abc', 0);
do $$
declare r jsonb; w public.wallet_accounts; cfg jsonb; m bigint;
begin
  select config_json into cfg from public.game_config_versions where game_id = 'mines' and status = 'ACTIVE';
  r := public.mines_start(2000, 7, 'key-mines-0001');
  select * into w from public.wallet_accounts where user_id = auth.uid();
  if w.available <> 98000 or w.reserved <> 2000 or (r->>'available')::bigint <> 98000 then raise exception 'reserve wrong'; end if;
  if r ? 'mines' or r->>'status' <> 'playing' or not (r->>'open')::boolean then raise exception 'open view leaks or wrong: %', r; end if;
  if (select outcome from public.game_rounds where id = (r->>'round_id')::uuid) is not null then raise exception 'open round stores an outcome'; end if;
  perform pg_temp.check_wallets('mines open');
  if (public.mines_start(2000, 7, 'key-mines-0001'))->>'round_id' <> r->>'round_id' then raise exception 'start replay'; end if;
  perform pg_temp.expect_fail('select public.mines_start(1000, 3, ''key-mines-0002'')', 'second round while one is open');
  perform pg_temp.expect_fail('select public.crash_start(1000, 200, ''key-crash-0000'')', 'crash while mines is open');
  perform pg_temp.expect_fail('select public.rotate_seed()', 'seed reveal while a round is open');
  perform pg_temp.expect_fail('select public.mines_cashout()', 'cash out before the first pick');
  perform pg_temp.expect_fail('select public.mines_pick(25)', 'tile out of range');
  r := public.mines_pick(0);
  r := public.mines_pick(2);
  perform pg_temp.expect_fail('select public.mines_pick(2)', 'tile already open');
  r := public.mines_pick(3);
  m := public.mines_multiplier(cfg, 7, 3);
  if r->>'status' <> 'playing' or (r->>'multiplier')::bigint <> m or r->'picks' <> '[0,2,3]' or r ? 'mines' then raise exception 'playing view wrong: %', r; end if;
  if (public.my_open_round())->>'round_id' <> r->>'round_id' then raise exception 'open round not found for resume'; end if;
  r := public.mines_cashout();
  if r->>'status' <> 'cashed' or (r->>'gross')::bigint <> (2000 * m) / 10000 or r->'mines' <> '[1,5,6,7,15,18,24]'
     or (r->>'open')::boolean then
    raise exception 'cash out wrong: %', r;
  end if;
  select * into w from public.wallet_accounts where user_id = auth.uid();
  if w.available <> 98000 + (2000 * m) / 10000 or w.reserved <> 0 then raise exception 'wallet after cash out wrong'; end if;
  if public.my_open_round() is not null then raise exception 'round still open'; end if;
  perform pg_temp.check_wallets('mines cashed');
end $$;

-- 3. Mines: hitting a mine loses the stake and reveals the tiles
select pg_temp.use_seed(repeat('00', 32), 'abc', 0);
do $$
declare r jsonb; before bigint;
begin
  select available into before from public.wallet_accounts where user_id = auth.uid();
  perform public.mines_start(1000, 7, 'key-mines-0003');
  perform public.mines_pick(0);
  r := public.mines_pick(5);
  if r->>'status' <> 'busted' or (r->>'gross')::bigint <> 0 or r->'mines' <> '[1,5,6,7,15,18,24]' or r->'picks' <> '[0,5]' then
    raise exception 'bust wrong: %', r;
  end if;
  if (select available from public.wallet_accounts where user_id = auth.uid()) <> before - 1000 then raise exception 'bust balance wrong'; end if;
  perform pg_temp.expect_fail('select public.mines_pick(9)', 'pick after the round ended');
  perform pg_temp.check_wallets('mines busted');
end $$;

-- 4. Mines: with 24 mines the only safe tile ends the round by itself
select pg_temp.use_seed(repeat('00', 32), 'abc', 0);
do $$
declare r jsonb; safe int;
begin
  select t into safe from generate_series(0, 24) t
   where t <> all ((public.fair_shuffle(repeat('00', 32), 'abc', 0, 'rozeflow:v1:mines', 25))[1:24]);
  perform public.mines_start(1000, 24, 'key-mines-0004');
  r := public.mines_pick(safe);
  if r->>'status' <> 'cashed' or (r->>'multiplier')::bigint <> 247500 or (r->>'gross')::bigint <> 24750 then
    raise exception 'auto cash at the last safe tile wrong: %', r;
  end if;
  perform pg_temp.check_wallets('mines auto cash');
end $$;

-- 5. Crash. Seed 00.., abc, nonce 0 → crash point 3.67x
select pg_temp.expect_fail($$select public.crash_start(1000, 100, 'key-crash-bad1')$$, 'auto cash-out below 1.01x');
select pg_temp.expect_fail($$select public.crash_step(true)$$, 'cash out without a flight');
select pg_temp.use_seed(repeat('00', 32), 'abc', 0);
do $$
declare r jsonb; before bigint;
begin
  select available into before from public.wallet_accounts where user_id = auth.uid();
  r := public.crash_start(1000, 200, 'key-crash-0001');
  if r->>'status' <> 'flying' or r ? 'crash_point' or not (r->>'open')::boolean then raise exception 'flight view leaks or wrong: %', r; end if;
  r := public.crash_step(false);
  if r->>'status' <> 'flying' then raise exception 'should still fly: %', r; end if;
  perform pg_temp.check_wallets('crash open');
  perform pg_temp.age_round(10);   -- 2.22x on the clock, past the 2.00x target
  r := public.crash_step(false);
  if r->>'status' <> 'cashed' or (r->>'cashed_at')::int <> 200 or (r->>'gross')::bigint <> 2000 or (r->>'crash_point')::int <> 367 then
    raise exception 'automatic cash-out wrong: %', r;
  end if;
  if (select available from public.wallet_accounts where user_id = auth.uid()) <> before + 1000 then raise exception 'crash win balance wrong'; end if;
end $$;

select pg_temp.use_seed(repeat('00', 32), 'abc', 0);
do $$
declare r jsonb;
begin
  perform public.crash_start(1000, 1000, 'key-crash-0002');
  perform pg_temp.age_round(10);
  r := public.crash_step(true);     -- manual press at about 2.22x, before the 3.67x crash
  if r->>'status' <> 'cashed' or (r->>'cashed_at')::int not between 220 and 226
     or (r->>'gross')::bigint <> (1000 * (r->>'cashed_at')::int) / 100 then
    raise exception 'manual cash-out wrong: %', r;
  end if;
end $$;

select pg_temp.use_seed(repeat('00', 32), 'abc', 0);
do $$
declare r jsonb; before bigint;
begin
  select available into before from public.wallet_accounts where user_id = auth.uid();
  perform public.crash_start(1000, 1000, 'key-crash-0003');
  perform pg_temp.age_round(20);    -- 4.95x on the clock, the flight crashed at 3.67x
  r := public.crash_step(true);     -- pressing late does not help
  if r->>'status' <> 'crashed' or (r->>'gross')::bigint <> 0 or r->>'cashed_at' is not null or (r->>'crash_point')::int <> 367 then
    raise exception 'late press must lose: %', r;
  end if;
  if (select available from public.wallet_accounts where user_id = auth.uid()) <> before - 1000 then raise exception 'crash loss balance wrong'; end if;
end $$;

-- a flight left behind is settled by the clock when the next one starts
select pg_temp.use_seed(repeat('00', 32), 'abc', 0);
do $$
declare r jsonb; old_id uuid; before bigint;
begin
  select available into before from public.wallet_accounts where user_id = auth.uid();
  old_id := ((public.crash_start(1000, 300, 'key-crash-0004'))->>'round_id')::uuid;
  perform pg_temp.age_round(60);
  r := public.crash_start(1000, 150, 'key-crash-0005');
  if (select status from public.game_rounds where id = old_id) <> 'SETTLED'
     or (select gross_payout from public.game_rounds where id = old_id) <> 3000 then
    raise exception 'left-behind flight not settled at its automatic target';
  end if;
  if r->>'status' <> 'flying' or (r->>'round_id')::uuid = old_id then raise exception 'new flight not started: %', r; end if;
  perform pg_temp.age_round(100);
  r := public.my_open_round();      -- resuming also settles by the clock
  if r->>'status' not in ('cashed', 'crashed') or public.my_open_round() is not null then raise exception 'resume did not settle: %', r; end if;
  perform pg_temp.check_wallets('crash settled');
end $$;

-- 6. Seeds can be revealed again once nothing is open, and every round then verifies
do $$
declare rot jsonb; bad int;
begin
  rot := public.rotate_seed();
  select count(*) into bad from public.game_rounds g join public.game_config_versions c on c.id = g.config_version_id
   where g.seed_pair_id = (rot#>>'{revealed,seed_pair_id}')::uuid and g.game_id = 'crash'
     and (g.outcome->>'crash_point')::int <> public.crash_point(c.config_json,
           public.fair_unit_integer(rot#>>'{revealed,server_seed}', g.outcome->>'client_seed', g.nonce, 'rozeflow:v1:crash'));
  if bad <> 0 then raise exception '% crash rounds do not verify', bad; end if;
end $$;

-- 7. The owner's RTP change applies to new rounds; the site report counts settled rounds only
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
do $$ begin perform public.set_game_rtp('mines', 9300); perform public.set_game_rtp('crash', 9300); end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.use_seed(repeat('00', 32), 'abc', 0);
do $$
declare r jsonb;
begin
  perform public.mines_start(1000, 24, 'key-mines-0005');
  r := public.mines_pick((select t from generate_series(0, 24) t
        where t <> all ((public.fair_shuffle(repeat('00', 32), 'abc', 0, 'rozeflow:v1:mines', 25))[1:24])));
  if (r->>'multiplier')::bigint <> 232500 or (r->>'rtp_bp')::int <> 9300 then raise exception 'mines must use the new RTP: %', r; end if;
  perform public.mines_start(1000, 3, 'key-mines-0006');   -- left open on purpose
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
do $$
declare rep jsonb;
begin
  rep := public.site_report();
  if (rep#>>'{totals,rounds}')::int <> (select count(*) from public.game_rounds where status = 'SETTLED')
     or (rep#>>'{points,in_wallets}')::bigint <> 200000 - (rep#>>'{totals,net}')::bigint then
    raise exception 'site report does not add up: %', rep;
  end if;
  perform pg_temp.check_wallets('end');
end $$;

\echo 'all mines and crash checks passed'
rollback;
