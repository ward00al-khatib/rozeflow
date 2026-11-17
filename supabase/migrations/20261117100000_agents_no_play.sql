-- Agents do not play (spec appendix س, addition of 2026-11-17, at the owner's request).
-- An agent account only hands out free points: it cannot start a round, take the daily bonus or receive agent
-- gifts. An agent may cancel their own gift within 10 minutes, only while the player has not played since and still
-- holds the points. There is still no way for anyone to take points out of a player's wallet otherwise:
-- points cannot be withdrawn or exchanged.

create or replace function public.is_agent(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.agents where user_id = p_user and status <> 'closed')
$$;

-- Every new round of every game passes here (play_dice directly, the others through take_nonce).
create or replace function public.round_rate_check(p_uid uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_limit int := coalesce((select (value #>> '{}')::int from public.site_settings where key = 'round_rate_limit'), 40);
begin
  if public.is_agent(p_uid) then
    raise exception 'AGENT_NO_PLAY' using errcode = '42501';
  end if;
  if (select count(*) from public.game_rounds
       where user_id = p_uid and created_at > now() - interval '10 seconds') >= v_limit then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;
end $$;

-- ---------- cancelling a mistaken gift ----------

alter table public.agent_transfers add column if not exists cancels_id bigint unique references public.agent_transfers (id);
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.agent_transfers'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%RECLAIM%GIFT%'
     and pg_get_constraintdef(oid) like '%CASE%';
  execute format('alter table public.agent_transfers drop constraint %I', c);
  select conname into c from pg_constraint
   where conrelid = 'public.agent_transfers'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind = ANY%';
  execute format('alter table public.agent_transfers drop constraint %I', c);
end $$;
alter table public.agent_transfers add constraint agent_transfers_kind_check
  check (kind in ('GRANT', 'REVOKE', 'PASS', 'RECLAIM', 'GIFT', 'CANCEL'));
alter table public.agent_transfers add constraint agent_transfers_shape_check check (case kind
  when 'GRANT'   then from_agent is null and to_agent is not null and to_player is null
  when 'REVOKE'  then from_agent is not null and to_agent is null and to_player is null
  when 'PASS'    then from_agent is not null and to_agent is not null and to_player is null
  when 'RECLAIM' then from_agent is not null and to_agent is not null and to_player is null
  when 'GIFT'    then from_agent is not null and to_agent is null and to_player is not null
  -- the points go back from the player (to_player) to the agent's allowance (to_agent)
  when 'CANCEL'  then from_agent is null and to_agent is not null and to_player is not null and cancels_id is not null
end);

-- Agent: cancel their own gift (by its reference) within 10 minutes, if the player has not played since and still
-- has the points. The points go back to the agent's allowance; the wallet gets a REVERSAL entry.
create or replace function public.agent_cancel_gift(p_ref text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_a public.agents := public.require_agent(true);
  g public.agent_transfers;
  t public.agent_transfers;
  v_wallet public.wallet_accounts;
  v_gift_ledger bigint;
  v_name text;
begin
  select * into g from public.agent_transfers where ref = upper(btrim(coalesce(p_ref, ''))) and kind = 'GIFT'
                                               and from_agent = v_a.user_id;
  if not found then
    raise exception 'GIFT_NOT_FOUND' using errcode = '22023';
  end if;
  select * into t from public.agent_transfers where cancels_id = g.id;
  if found then
    return public.agent_transfer_json(t, true) || jsonb_build_object('allowance', v_a.allowance);
  end if;
  if g.created_at < now() - interval '10 minutes' then
    raise exception 'CANCEL_TOO_LATE' using errcode = '22023';
  end if;
  select * into v_wallet from public.wallet_accounts where user_id = g.to_player for update;
  if v_wallet.available < g.amount
     or exists (select 1 from public.game_rounds where user_id = g.to_player and created_at >= g.created_at) then
    raise exception 'POINTS_USED' using errcode = '22023';
  end if;

  select id into v_gift_ledger from public.wallet_ledger where idempotency_key = 'agent:' || g.ref;
  select display_name into v_name from public.profiles where user_id = v_a.user_id;
  insert into public.wallet_ledger (user_id, type, amount, available_after, reserved_after, reverses_id, actor_id,
                                    reason, idempotency_key)
  values (g.to_player, 'REVERSAL', -g.amount, v_wallet.available - g.amount, v_wallet.reserved, v_gift_ledger, v_a.user_id,
          'إلغاء هدية الوكيل ' || v_name || ' · ' || g.ref, 'agent-cancel:' || g.ref);
  update public.wallet_accounts
     set available = available - g.amount, version = version + 1, updated_at = now()
   where user_id = g.to_player returning * into v_wallet;
  update public.agents set allowance = allowance + g.amount, updated_at = now()
   where user_id = v_a.user_id returning * into v_a;

  insert into public.agent_transfers (ref, kind, actor_id, from_agent, to_agent, to_player, amount, from_after, to_after,
                                      note, idempotency_key, cancels_id)
  values (public.agent_new_ref(), 'CANCEL', v_a.user_id, null, v_a.user_id, g.to_player, g.amount, v_wallet.available,
          v_a.allowance, 'إلغاء ' || g.ref, 'cancel:' || g.ref, g.id)
  returning * into t;
  return public.agent_transfer_json(t) || jsonb_build_object('allowance', v_a.allowance);
end $$;

-- ---------- functions redefined so agents only hand out points ----------

create or replace function public.agent_send(p_player_no bigint, p_amount bigint, p_key text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_a public.agents := public.require_agent(true);
  v_p public.profiles;
  v_name text;
  v_prev jsonb;
  v_wallet public.wallet_accounts;
  v_ref text := public.agent_new_ref();
  t public.agent_transfers;
begin
  perform public.agent_check_amount(p_amount);
  perform public.agent_check_key(p_key);
  v_p := public.player_by_no(p_player_no);
  if v_p.user_id = v_a.user_id then
    raise exception 'SELF_SEND' using errcode = '22023';
  end if;
  if public.is_agent(v_p.user_id) then
    raise exception 'PLAYER_IS_AGENT' using errcode = '22023';
  end if;
  v_prev := public.agent_replay(v_a.user_id, p_key, 'GIFT', p_amount, v_a.user_id, v_p.user_id);
  if v_prev is not null then
    return v_prev || jsonb_build_object('allowance', v_a.allowance);
  end if;
  perform public.agent_rate_check(v_a.user_id);
  if v_a.allowance < p_amount then
    raise exception 'ALLOWANCE_LOW' using errcode = '22023';
  end if;

  update public.agents set allowance = allowance - p_amount, updated_at = now()
   where user_id = v_a.user_id returning * into v_a;

  select * into v_wallet from public.wallet_accounts where user_id = v_p.user_id for update;
  if not found then
    raise exception 'PLAYER_NOT_FOUND' using errcode = '22023';
  end if;
  select display_name into v_name from public.profiles where user_id = v_a.user_id;
  insert into public.wallet_ledger (user_id, type, amount, available_after, reserved_after, actor_id, reason, idempotency_key)
  values (v_p.user_id, 'AGENT_GIFT', p_amount, v_wallet.available + p_amount, v_wallet.reserved, v_a.user_id,
          'هدية من الوكيل ' || v_name || ' · ' || v_ref, 'agent:' || v_ref);
  update public.wallet_accounts
     set available = available + p_amount, version = version + 1, updated_at = now()
   where user_id = v_p.user_id returning * into v_wallet;

  t := public.agent_post('GIFT', v_a.user_id, v_a.user_id, null, v_p.user_id, p_amount, v_a.allowance,
                         v_wallet.available, p_note, p_key, v_ref);
  return public.agent_transfer_json(t) || jsonb_build_object('allowance', v_a.allowance);
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
  if public.is_agent(v_uid) then
    raise exception 'AGENT_NO_PLAY' using errcode = '42501';
  end if;
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

create or replace function public.agent_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.require_profile();
  v_a public.agents;
  v_parent text;
  v_today timestamptz := (public.site_today()::timestamp at time zone 'Asia/Damascus');
begin
  select * into v_a from public.agents where user_id = v_uid;
  if not found or v_a.status = 'closed' then
    return null;
  end if;
  select display_name into v_parent from public.profiles where user_id = v_a.parent_id;
  return jsonb_build_object(
    'tier', case when v_a.parent_id is null then 'master' else 'sub' end,
    'status', v_a.status,
    'parent_active', v_a.parent_id is null or (select status = 'active' from public.agents where user_id = v_a.parent_id),
    'parent_name', v_parent,
    'allowance', v_a.allowance,
    'gifted_today', (select coalesce(sum(case when kind = 'GIFT' then amount else -amount end), 0)::bigint from public.agent_transfers
                      where ((from_agent = v_uid and kind = 'GIFT') or (to_agent = v_uid and kind = 'CANCEL')) and created_at >= v_today),
    'gifted_total', (select coalesce(sum(case when kind = 'GIFT' then amount else -amount end), 0)::bigint from public.agent_transfers
                      where (from_agent = v_uid and kind = 'GIFT') or (to_agent = v_uid and kind = 'CANCEL')),
    'players', (select count(distinct to_player) from public.agent_transfers where from_agent = v_uid and kind = 'GIFT'),
    'subs', case when v_a.parent_id is null then coalesce((
       select jsonb_agg(jsonb_build_object(
                'user_id', s.user_id, 'display_name', p.display_name, 'player_no', p.player_no, 'status', s.status,
                'allowance', s.allowance,
                'gifted_total', (select coalesce(sum(amount), 0)::bigint from public.agent_transfers
                                  where from_agent = s.user_id and kind = 'GIFT'))
              order by s.created_at)
       from public.agents s join public.profiles p on p.user_id = s.user_id
       where s.parent_id = v_uid and s.status <> 'closed'), '[]'::jsonb) else '[]'::jsonb end,
    'transfers', coalesce((
       select jsonb_agg(x order by x.id desc) from (
         select t.id, t.ref, t.kind, t.amount, t.created_at, t.note,
                case when t.from_agent = v_uid then t.from_after else t.to_after end as allowance_after,
                t.from_agent = v_uid as outgoing,
                case when t.from_agent = v_uid then coalesce(tp.display_name, ta.display_name, 'الموقع')
                     else coalesce(fa.display_name, tp.display_name, 'الموقع') end as other_name,
                case when t.from_agent = v_uid then coalesce(tp.player_no, ta.player_no) else coalesce(fa.player_no, tp.player_no) end as other_no,
                exists (select 1 from public.agent_transfers c where c.cancels_id = t.id) as cancelled,
                (t.kind = 'GIFT' and t.from_agent = v_uid and t.created_at > now() - interval '10 minutes'
                 and not exists (select 1 from public.agent_transfers c where c.cancels_id = t.id)) as can_cancel
         from public.agent_transfers t
         left join public.profiles tp on tp.user_id = t.to_player
         left join public.profiles ta on ta.user_id = t.to_agent
         left join public.profiles fa on fa.user_id = t.from_agent
         where t.from_agent = v_uid or t.to_agent = v_uid
         order by t.id desc limit 100) x), '[]'::jsonb));
end $$;

create or replace function public.agent_overview(p_agent uuid default null, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_admin uuid := public.require_owner();
begin
  return jsonb_build_object(
    'totals', (select jsonb_build_object(
        'granted', coalesce(sum(amount) filter (where kind = 'GRANT'), 0)::bigint,
        'revoked', coalesce(sum(amount) filter (where kind = 'REVOKE'), 0)::bigint,
        'gifted', coalesce(sum(amount) filter (where kind = 'GIFT'), 0)::bigint,
        'cancelled', coalesce(sum(amount) filter (where kind = 'CANCEL'), 0)::bigint,
        'players', count(distinct to_player))
      from public.agent_transfers),
    'outstanding', (select coalesce(sum(allowance), 0)::bigint from public.agents),
    'agents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', a.user_id, 'display_name', p.display_name, 'player_no', p.player_no,
               'parent_id', a.parent_id, 'parent_name', pp.display_name, 'status', a.status,
               'allowance', a.allowance, 'note', a.note, 'created_at', a.created_at,
               'granted', (select coalesce(sum(amount), 0)::bigint from public.agent_transfers
                            where to_agent = a.user_id and kind in ('GRANT', 'PASS')),
               'gifted', (select coalesce(sum(case when kind = 'GIFT' then amount else -amount end), 0)::bigint
                           from public.agent_transfers
                           where (from_agent = a.user_id and kind = 'GIFT') or (to_agent = a.user_id and kind = 'CANCEL')),
               'players', (select count(distinct to_player) from public.agent_transfers
                            where from_agent = a.user_id and kind = 'GIFT'),
               'last_gift_at', (select max(created_at) from public.agent_transfers
                                 where from_agent = a.user_id and kind = 'GIFT'))
             order by a.status = 'closed', coalesce(a.parent_id, a.user_id), a.parent_id nulls first, a.created_at)
      from public.agents a
      join public.profiles p on p.user_id = a.user_id
      left join public.profiles pp on pp.user_id = a.parent_id), '[]'::jsonb),
    'transfers', coalesce((
      select jsonb_agg(x order by x.id desc) from (
        select t.id, t.ref, t.kind, t.amount, t.created_at, t.note, t.from_after, t.to_after,
               ac.display_name as actor_name,
               case when t.kind = 'CANCEL' then tp.display_name else fa.display_name end as from_name,
               case when t.kind = 'CANCEL' then tp.player_no else fa.player_no end as from_no,
               case when t.kind = 'CANCEL' then ta.display_name else coalesce(tp.display_name, ta.display_name) end as to_name,
               case when t.kind = 'CANCEL' then ta.player_no else coalesce(tp.player_no, ta.player_no) end as to_no
        from public.agent_transfers t
        join public.profiles ac on ac.user_id = t.actor_id
        left join public.profiles fa on fa.user_id = t.from_agent
        left join public.profiles ta on ta.user_id = t.to_agent
        left join public.profiles tp on tp.user_id = t.to_player
        where p_agent is null or t.from_agent = p_agent or t.to_agent = p_agent
        order by t.id desc
        limit 100 offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb));
end $$;

revoke all on function public.is_agent(uuid) from public, anon, authenticated;
revoke all on function public.agent_cancel_gift(text) from public, anon;
grant execute on function public.agent_cancel_gift(text) to authenticated;
