-- Social layer (spec appendix ي): daily bonus, weekly leaderboard, recent big wins and member levels.
-- Everything here reads settled rounds; nothing changes odds or outcomes.

-- ---------- daily bonus ----------

do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.wallet_ledger'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%SIGNUP_GRANT%';
  execute format('alter table public.wallet_ledger drop constraint %I', c);
end $$;
alter table public.wallet_ledger add constraint wallet_ledger_type_check check (type in (
  'SIGNUP_GRANT', 'STAKE_RESERVE', 'STAKE_CONSUME', 'PAYOUT', 'STAKE_RELEASE',
  'RECOVERY_GRANT', 'ADMIN_ADJUSTMENT', 'REVERSAL', 'DAILY_BONUS'));

insert into public.site_settings (key, value) values ('daily_bonus', '5000') on conflict (key) do nothing;  -- 50 points

create table public.daily_bonus_claims (
  user_id    uuid not null references public.wallet_accounts (user_id),
  day        date not null,
  streak     int not null check (streak between 1 and 10000),
  amount     bigint not null check (amount > 0),
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);
create trigger daily_bonus_claims_append_only before update or delete on public.daily_bonus_claims
  for each row execute function public.forbid_mutation();
alter table public.daily_bonus_claims enable row level security;
revoke all on public.daily_bonus_claims from anon, authenticated;
grant select on public.daily_bonus_claims to authenticated;
create policy member_reads_own_bonus on public.daily_bonus_claims for select using (user_id = auth.uid());

-- The site's day runs on Damascus time.
create or replace function public.site_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Damascus')::date $$;

create or replace function public.daily_bonus_base() returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::bigint from public.site_settings where key = 'daily_bonus'), 5000);
$$;

-- Day n of an unbroken streak pays base × (1 + 0.25 × (n − 1)), from day 7 on base × 2.5.
create or replace function public.daily_bonus_amount(p_base bigint, p_streak int) returns bigint
language sql immutable as $$ select (p_base * (4 + least(greatest(p_streak, 1) - 1, 6)) / 4)::bigint $$;

create or replace function public.daily_bonus_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_today date := public.site_today();
  v_last public.daily_bonus_claims;
  v_next_streak int;
  v_base bigint := public.daily_bonus_base();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select * into v_last from public.daily_bonus_claims where user_id = v_uid order by day desc limit 1;
  v_next_streak := case when v_last.day = v_today - 1 then v_last.streak + 1
                        when v_last.day = v_today then v_last.streak + 1
                        else 1 end;
  return jsonb_build_object(
    'enabled', v_base > 0,
    'claimed_today', coalesce(v_last.day = v_today, false),
    'streak', case when v_last.day >= v_today - 1 then v_last.streak else 0 end,
    'next_amount', public.daily_bonus_amount(v_base, v_next_streak),
    'base', v_base,
    'next_at', ((v_today + 1)::timestamp at time zone 'Asia/Damascus'));
end $$;

create or replace function public.claim_daily_bonus() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_member();
  v_today date := public.site_today();
  v_base bigint := public.daily_bonus_base();
  v_wallet public.wallet_accounts;
  v_last public.daily_bonus_claims;
  v_streak int;
  v_amount bigint;
begin
  if v_base <= 0 then
    raise exception 'BONUS_DISABLED' using errcode = '22023';
  end if;
  select * into v_wallet from public.wallet_accounts where user_id = v_uid for update;
  if exists (select 1 from public.daily_bonus_claims where user_id = v_uid and day = v_today) then
    raise exception 'BONUS_ALREADY_CLAIMED' using errcode = '22023';
  end if;
  select * into v_last from public.daily_bonus_claims where user_id = v_uid order by day desc limit 1;
  v_streak := case when v_last.day = v_today - 1 then v_last.streak + 1 else 1 end;
  v_amount := public.daily_bonus_amount(v_base, v_streak);

  insert into public.daily_bonus_claims (user_id, day, streak, amount) values (v_uid, v_today, v_streak, v_amount);
  insert into public.wallet_ledger (user_id, type, amount, available_after, reserved_after, idempotency_key, reason)
  values (v_uid, 'DAILY_BONUS', v_amount, v_wallet.available + v_amount, v_wallet.reserved,
          'daily:' || v_uid || ':' || v_today, 'اليوم ' || v_streak || ' من السلسلة');
  update public.wallet_accounts
     set available = available + v_amount, version = version + 1, updated_at = now()
   where user_id = v_uid
   returning * into v_wallet;
  return jsonb_build_object('amount', v_amount, 'streak', v_streak, 'available', v_wallet.available);
end $$;

create or replace function public.set_daily_bonus(p_amount bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := public.require_owner();
  v_before bigint := public.daily_bonus_base();
begin
  if p_amount is null or p_amount < 0 or p_amount > 100000 then
    raise exception 'BONUS_OUT_OF_RANGE' using errcode = '22023';
  end if;
  insert into public.site_settings (key, value) values ('daily_bonus', to_jsonb(p_amount))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  if v_before <> p_amount then
    insert into public.admin_audit_logs (admin_id, action, target, before_json, after_json)
    values (v_admin, 'set_daily_bonus', 'site', jsonb_build_object('daily_bonus', v_before),
            jsonb_build_object('daily_bonus', p_amount));
  end if;
  return jsonb_build_object('daily_bonus', p_amount);
end $$;

-- ---------- leaderboard, big wins, member stats ----------

create or replace function public.require_profile() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where user_id = auth.uid() and status = 'active') then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- Start of the current week (Saturday 00:00 Damascus time, the local week).
create or replace function public.site_week_start() returns timestamptz
language sql stable as $$
  select ((public.site_today() - ((extract(dow from public.site_today())::int + 1) % 7))::timestamp
          at time zone 'Asia/Damascus')
$$;

-- Per-member totals for the week (or all time), with lifetime wagering for levels.
create or replace function public.leaderboard(p_period text default 'week') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.require_profile();
  v_since timestamptz;
  v_rows jsonb;
begin
  if p_period not in ('week', 'all') then
    raise exception 'BAD_PERIOD' using errcode = '22023';
  end if;
  v_since := case when p_period = 'week' then public.site_week_start() else '-infinity'::timestamptz end;
  select coalesce(jsonb_agg(x order by x.net desc), '[]'::jsonb) into v_rows
  from (
    select p.user_id, p.display_name,
           count(r.id) filter (where r.settled_at >= v_since) as rounds,
           coalesce(sum(r.stake) filter (where r.settled_at >= v_since), 0)::bigint as wagered,
           coalesce(sum(r.gross_payout - r.stake) filter (where r.settled_at >= v_since), 0)::bigint as net,
           coalesce(max(r.gross_payout * 10000 / r.stake) filter (where r.settled_at >= v_since and r.gross_payout > 0), 0)::bigint as best_multiplier_bp,
           coalesce(sum(r.stake), 0)::bigint as lifetime_wagered,
           (p.user_id = v_uid) as me
    from public.profiles p
    left join public.game_rounds r on r.user_id = p.user_id and r.status = 'SETTLED'
    where p.status = 'active'
    group by p.user_id, p.display_name
  ) x
  where x.rounds > 0 or x.me;
  return jsonb_build_object('period', p_period, 'since', v_since, 'rows', v_rows);
end $$;

-- Recent wins of 10x or more among members, newest first.
create or replace function public.recent_big_wins(p_limit int default 20) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.require_profile();
begin
  return (
    select coalesce(jsonb_agg(x order by x.at desc), '[]'::jsonb)
    from (
      select p.display_name, r.game_id, g.name_ar, r.stake, r.gross_payout as gross,
             (r.gross_payout * 10000 / r.stake)::bigint as multiplier_bp, r.settled_at as at
      from public.game_rounds r
      join public.profiles p on p.user_id = r.user_id
      join public.games g on g.id = r.game_id
      where r.status = 'SETTLED' and r.gross_payout >= 10 * r.stake and r.settled_at > now() - interval '7 days'
      order by r.settled_at desc
      limit least(greatest(coalesce(p_limit, 20), 1), 50)
    ) x);
end $$;

create or replace function public.my_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.require_profile();
begin
  return (
    select jsonb_build_object('rounds', count(*), 'lifetime_wagered', coalesce(sum(stake), 0)::bigint)
    from public.game_rounds where user_id = v_uid and status = 'SETTLED');
end $$;

-- Owner report: grants now include daily bonuses.
create or replace function public.site_report(p_days int default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_since timestamptz := case when p_days is null then '-infinity'::timestamptz else now() - make_interval(days => p_days) end;
  v_games jsonb;
  v_totals jsonb;
  v_points jsonb;
begin
  if not public.is_owner() then
    raise exception 'OWNER_ONLY' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'game_id', g.id, 'name_ar', g.name_ar, 'status', g.status,
           'on_server', c.id is not null,
           'rtp_bp', coalesce((c.config_json #>> '{payout_model,target_rtp_bp}')::int, round(c.theoretical_rtp * 10000)::int),
           'rtp_fixed', c.id is not null and (c.config_json #>> '{payout_model,target_rtp_bp}') is null,
           'config_version', c.version,
           'rounds', coalesce(r.rounds, 0), 'players', coalesce(r.players, 0),
           'wagered', coalesce(r.wagered, 0), 'paid', coalesce(r.paid, 0),
           'net', coalesce(r.wagered, 0) - coalesce(r.paid, 0)) order by g.sort), '[]'::jsonb)
    into v_games
    from public.games g
    left join public.game_config_versions c on c.game_id = g.id and c.status = 'ACTIVE'
    left join (
      select game_id, count(*) as rounds, count(distinct user_id) as players,
             sum(stake)::bigint as wagered, sum(gross_payout)::bigint as paid
      from public.game_rounds
      where status = 'SETTLED' and settled_at >= v_since
      group by game_id
    ) r on r.game_id = g.id;

  select jsonb_build_object(
           'rounds', count(*), 'players', count(distinct user_id),
           'wagered', coalesce(sum(stake), 0)::bigint, 'paid', coalesce(sum(gross_payout), 0)::bigint,
           'net', (coalesce(sum(stake), 0) - coalesce(sum(gross_payout), 0))::bigint)
    into v_totals
    from public.game_rounds where status = 'SETTLED' and settled_at >= v_since;

  select jsonb_build_object(
           'members', (select count(*) from public.profiles),
           'in_wallets', (select coalesce(sum(available + reserved), 0)::bigint from public.wallet_accounts),
           'granted', (select coalesce(sum(amount), 0)::bigint from public.wallet_ledger
                        where type in ('SIGNUP_GRANT', 'RECOVERY_GRANT', 'DAILY_BONUS')))
    into v_points;

  return jsonb_build_object('days', p_days, 'games', v_games, 'totals', v_totals, 'points', v_points);
end $$;

-- ---------- grants ----------

revoke all on function public.site_today() from public, anon;
revoke all on function public.daily_bonus_base() from public, anon;
revoke all on function public.daily_bonus_state() from public, anon;
revoke all on function public.claim_daily_bonus() from public, anon;
revoke all on function public.set_daily_bonus(bigint) from public, anon;
revoke all on function public.require_profile() from public, anon, authenticated;
revoke all on function public.site_week_start() from public, anon;
revoke all on function public.leaderboard(text) from public, anon;
revoke all on function public.recent_big_wins(int) from public, anon;
revoke all on function public.my_stats() from public, anon;
grant execute on function public.site_today() to authenticated;
grant execute on function public.daily_bonus_base() to authenticated;
grant execute on function public.daily_bonus_state() to authenticated;
grant execute on function public.claim_daily_bonus() to authenticated;
grant execute on function public.set_daily_bonus(bigint) to authenticated;
grant execute on function public.site_week_start() to authenticated;
grant execute on function public.leaderboard(text) to authenticated;
grant execute on function public.recent_big_wins(int) to authenticated;
grant execute on function public.my_stats() to authenticated;
