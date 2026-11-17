-- Behavioural checks for the social layer (spec appendix ي).
\set QUIET on
begin;
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2'),
  ('00000000-0000-0000-0000-0000000000c3');

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'session_id', 'sess-' || uid, 'aal', 'aal2')::text, true);
  if uid <> '' then perform public.register_device('device-key-' || replace(uid, '-', ''), 'test'); end if;
end $$;

create function pg_temp.expect_fail(stmt text, code text) returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when others then
    if sqlerrm <> code then raise exception 'expected %, got %', code, sqlerrm; end if;
    raise notice 'ok: %', code; return;
  end;
  raise exception 'expected failure: %', code;
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
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select public.complete_join('quiet', true, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select public.complete_join('friend', true, true);

-- 1. Daily bonus: once a day, streak grows on consecutive days, ledger and wallet agree.
do $$
declare s jsonb; r jsonb; before bigint;
begin
  s := public.daily_bonus_state();
  if (s ->> 'claimed_today')::boolean or (s ->> 'next_amount')::bigint <> 5000 or (s ->> 'streak')::int <> 0 then
    raise exception 'fresh state wrong: %', s;
  end if;
  select available into before from public.wallet_accounts where user_id = auth.uid();
  r := public.claim_daily_bonus();
  if (r ->> 'amount')::bigint <> 5000 or (r ->> 'streak')::int <> 1 or (r ->> 'available')::bigint <> before + 5000 then
    raise exception 'first claim wrong: %', r;
  end if;
  s := public.daily_bonus_state();
  if not (s ->> 'claimed_today')::boolean or (s ->> 'streak')::int <> 1 or (s ->> 'next_amount')::bigint <> 6250 then
    raise exception 'state after claim wrong: %', s;
  end if;
end $$;
select pg_temp.expect_fail($$select public.claim_daily_bonus()$$, 'BONUS_ALREADY_CLAIMED');

-- yesterday's claim on another member makes today day 2: 50 × 1.25
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
insert into public.daily_bonus_claims (user_id, day, streak, amount)
values ('00000000-0000-0000-0000-0000000000c3', public.site_today() - 1, 6, 11250);
do $$ declare r jsonb; begin
  r := public.claim_daily_bonus();
  if (r ->> 'streak')::int <> 7 or (r ->> 'amount')::bigint <> 12500 then raise exception 'streak claim wrong: %', r; end if;
  if public.daily_bonus_amount(5000, 30) <> 12500 then raise exception 'streak must cap at 2.5x'; end if;
end $$;
select pg_temp.expect_fail($$update public.daily_bonus_claims set amount = 1$$, 'daily_bonus_claims is append-only');

-- owner setting
select pg_temp.expect_fail($$select public.set_daily_bonus(100)$$, 'OWNER_ONLY');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_fail($$select public.set_daily_bonus(-1)$$, 'BONUS_OUT_OF_RANGE');
select public.set_daily_bonus(0);
select pg_temp.expect_fail($$select public.claim_daily_bonus()$$, 'BONUS_DISABLED');
select public.set_daily_bonus(10000);
do $$ begin
  if (public.claim_daily_bonus() ->> 'amount')::bigint <> 10000 then raise exception 'new base not applied'; end if;
  if (select count(*) from public.admin_audit_logs where action = 'set_daily_bonus') <> 2 then raise exception 'not audited'; end if;
  if ((public.site_report(null) -> 'points' ->> 'granted')::bigint) <> 3 * 100000 + 5000 + 12500 + 10000 then
    raise exception 'site report must count daily bonuses: %', public.site_report(null) -> 'points';
  end if;
end $$;

-- 2. Big wins and leaderboard: friend plays dice at 5% chance until a big win.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.top_up(1000000);
do $$
declare i int := 0; r jsonb;
begin
  loop
    i := i + 1;
    r := public.play_dice(1000, 500, 'under', 'social-key-' || lpad(i::text, 6, '0'));
    exit when (r ->> 'gross')::bigint >= 10000 or i >= 400;
  end loop;
  if (r ->> 'gross')::bigint < 10000 then raise exception 'no big win in 400 rounds'; end if;
end $$;
do $$
declare w jsonb; lb jsonb; me jsonb; st jsonb;
begin
  w := public.recent_big_wins(5);
  if jsonb_array_length(w) <> 1 or w -> 0 ->> 'display_name' <> 'friend' or w -> 0 ->> 'name_ar' is null
     or (w -> 0 ->> 'multiplier_bp')::bigint < 100000 then
    raise exception 'big wins wrong: %', w;
  end if;
  lb := public.leaderboard('week');
  if jsonb_array_length(lb -> 'rows') <> 1 then raise exception 'only players with rounds (and me) are listed: %', lb; end if;
  me := lb -> 'rows' -> 0;
  if not (me ->> 'me')::boolean or (me ->> 'rounds')::int < 1
     or (me ->> 'wagered')::bigint <> (me ->> 'rounds')::bigint * 1000
     or (me ->> 'net')::bigint <> (select sum(net_result) from public.game_rounds where user_id = auth.uid()) then
    raise exception 'leaderboard row wrong: %', me;
  end if;
  st := public.my_stats();
  if (st ->> 'lifetime_wagered')::bigint <> (me ->> 'wagered')::bigint then raise exception 'my_stats wrong: %', st; end if;
  if public.site_week_start() > now() or public.site_week_start() < now() - interval '7 days' then
    raise exception 'week start out of range';
  end if;
end $$;
select pg_temp.expect_fail($$select public.leaderboard('year')$$, 'BAD_PERIOD');

-- the quiet member sees friend's row plus their own empty row
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
do $$ begin
  if jsonb_array_length(public.leaderboard('all') -> 'rows') <> 2 then raise exception 'own row must be listed'; end if;
  if exists (select 1 from public.wallet_invariant_violations()) then raise exception 'wallet invariants broken'; end if;
end $$;

-- signed out: nothing
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.expect_fail($$select public.leaderboard('week')$$, 'ACCOUNT_NOT_ACTIVE');

do $$ begin raise notice 'social_test: all checks passed'; end $$;
rollback;
