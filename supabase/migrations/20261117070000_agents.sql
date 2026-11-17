-- Agents who hand out FREE points (spec appendix س).
-- The owner names trusted members as agents and gives each a points allowance. An agent sends points from that
-- allowance to a player's wallet by the player's number. A master agent can add sub-agents and pass part of their
-- allowance down. Nothing here has a price: points cannot be bought, sold, withdrawn or exchanged (spec 1, 2).
-- There is no player → agent transfer, no withdrawal and no commission. Every movement is one row in the
-- append-only agent_transfers log (sender, receiver, time, unique reference) and gifts are also wallet_ledger rows.

-- ---------- player number ----------
-- A short number a player can tell their agent, instead of the internal account id.
alter table public.profiles add column if not exists player_no bigint generated always as identity (start with 1001);
alter table public.profiles add constraint profiles_player_no_key unique (player_no);

-- ---------- ledger type ----------
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.wallet_ledger'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%SIGNUP_GRANT%';
  execute format('alter table public.wallet_ledger drop constraint %I', c);
end $$;
alter table public.wallet_ledger add constraint wallet_ledger_type_check check (type in (
  'SIGNUP_GRANT', 'STAKE_RESERVE', 'STAKE_CONSUME', 'PAYOUT', 'STAKE_RELEASE',
  'RECOVERY_GRANT', 'ADMIN_ADJUSTMENT', 'REVERSAL', 'DAILY_BONUS', 'AGENT_GIFT'));

-- ---------- tables ----------

create table public.agents (
  user_id    uuid primary key references public.profiles (user_id),
  parent_id  uuid references public.agents (user_id),          -- null: master agent; set: sub-agent of that master
  status     text not null default 'active' check (status in ('active', 'frozen', 'closed')),
  allowance  bigint not null default 0 check (allowance >= 0),  -- centi-points still to hand out
  note       text check (char_length(note) <= 200),
  created_by uuid not null references public.profiles (user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> user_id)
);
create index agents_parent_idx on public.agents (parent_id);

create table public.agent_transfers (
  id              bigint generated always as identity primary key,
  ref             text not null unique,                 -- reference shown to people, e.g. RZ-4F09A1C2D7
  kind            text not null check (kind in ('GRANT', 'REVOKE', 'PASS', 'RECLAIM', 'GIFT')),
  actor_id        uuid not null references public.profiles (user_id),
  from_agent      uuid references public.agents (user_id),
  to_agent        uuid references public.agents (user_id),
  to_player       uuid references public.profiles (user_id),
  amount          bigint not null check (amount > 0 and amount % 100 = 0),
  from_after      bigint check (from_after >= 0),       -- sender's allowance after
  to_after        bigint check (to_after >= 0),         -- receiver's allowance (or wallet) after
  note            text check (char_length(note) <= 200),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 80),
  created_at      timestamptz not null default now(),
  unique (actor_id, idempotency_key),
  check (case kind
           when 'GRANT'   then from_agent is null and to_agent is not null and to_player is null
           when 'REVOKE'  then from_agent is not null and to_agent is null and to_player is null
           when 'PASS'    then from_agent is not null and to_agent is not null and to_player is null
           when 'RECLAIM' then from_agent is not null and to_agent is not null and to_player is null
           when 'GIFT'    then from_agent is not null and to_agent is null and to_player is not null
         end)
);
create index agent_transfers_from_idx on public.agent_transfers (from_agent, id desc);
create index agent_transfers_to_idx on public.agent_transfers (to_agent, id desc);
create index agent_transfers_player_idx on public.agent_transfers (to_player, id desc);
create index agent_transfers_actor_time_idx on public.agent_transfers (actor_id, created_at desc);

create trigger agent_transfers_append_only before update or delete on public.agent_transfers
  for each row execute function public.forbid_mutation();
create trigger agents_no_delete before delete on public.agents
  for each row execute function public.forbid_mutation();

alter table public.agents enable row level security;
alter table public.agent_transfers enable row level security;
revoke all on public.agents, public.agent_transfers from public, anon, authenticated;
grant select on public.agents to authenticated;
create policy own_agent on public.agents for select using (user_id = auth.uid());
create policy owner_reads_agents on public.agents for select using (public.is_owner());
-- agent_transfers: read only through agent_dashboard() and agent_overview().

-- ---------- internal helpers (not callable by members) ----------

create or replace function public.agent_check_amount(p_amount bigint) returns void
language plpgsql immutable as $$
begin
  -- whole points only, at most 1,000,000 points in one movement
  if p_amount is null or p_amount <= 0 or p_amount % 100 <> 0 or p_amount > 100000000 then
    raise exception 'BAD_AMOUNT' using errcode = '22023';
  end if;
end $$;

create or replace function public.agent_check_key(p_key text) returns void
language plpgsql immutable as $$
begin
  if p_key is null or char_length(p_key) not between 8 and 80 then
    raise exception 'BAD_KEY' using errcode = '22023';
  end if;
end $$;

create or replace function public.agent_new_ref() returns text
language sql volatile set search_path = public, extensions as $$
  select 'RZ-' || upper(encode(gen_random_bytes(5), 'hex'))
$$;

create or replace function public.agent_transfer_json(t public.agent_transfers, p_duplicate boolean default false)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ref', t.ref, 'kind', t.kind, 'amount', t.amount, 'from_after', t.from_after, 'to_after', t.to_after,
    'created_at', t.created_at, 'duplicate', p_duplicate,
    'to_name', coalesce((select display_name from public.profiles where user_id = coalesce(t.to_player, t.to_agent)), null),
    'to_player_no', (select player_no from public.profiles where user_id = coalesce(t.to_player, t.to_agent)))
$$;

-- The same request sent twice (same actor and key) returns the first result instead of moving points again.
-- A key reused for a different movement is refused.
create or replace function public.agent_replay(p_actor uuid, p_key text, p_kind text, p_amount bigint,
                                               p_from uuid, p_to uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t public.agent_transfers;
begin
  select * into t from public.agent_transfers where actor_id = p_actor and idempotency_key = p_key;
  if not found then
    return null;
  end if;
  if t.kind <> p_kind or (p_amount is not null and t.amount <> p_amount)
     or t.from_agent is distinct from p_from or coalesce(t.to_player, t.to_agent) is distinct from p_to then
    raise exception 'KEY_REUSED' using errcode = '22023';
  end if;
  return public.agent_transfer_json(t, true);
end $$;

create or replace function public.agent_rate_check(p_actor uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if (select count(*) from public.agent_transfers
       where actor_id = p_actor and created_at > now() - interval '60 seconds') >= 30 then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;
end $$;

create or replace function public.player_by_no(p_player_no bigint) returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare v public.profiles;
begin
  select * into v from public.profiles where player_no = p_player_no and status = 'active';
  if not found then
    raise exception 'PLAYER_NOT_FOUND' using errcode = '22023';
  end if;
  return v;
end $$;

-- The calling member's agent row, locked when p_lock. Refuses a frozen agent or one whose master is not active.
create or replace function public.require_agent(p_lock boolean default true) returns public.agents
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_member();
  v_a public.agents;
  v_parent_status text;
begin
  if p_lock then
    select * into v_a from public.agents where user_id = v_uid for update;
  else
    select * into v_a from public.agents where user_id = v_uid;
  end if;
  if not found or v_a.status = 'closed' then
    raise exception 'NOT_AGENT' using errcode = '42501';
  end if;
  if v_a.status <> 'active' then
    raise exception 'AGENT_FROZEN' using errcode = '42501';
  end if;
  if v_a.parent_id is not null then
    select status into v_parent_status from public.agents where user_id = v_a.parent_id;
    if v_parent_status <> 'active' then
      raise exception 'AGENT_FROZEN' using errcode = '42501';
    end if;
  end if;
  return v_a;
end $$;

-- Moves allowance between agents or out of the system and writes the log row. Caller holds the row locks.
create or replace function public.agent_post(p_kind text, p_actor uuid, p_from uuid, p_to_agent uuid, p_to_player uuid,
                                             p_amount bigint, p_from_after bigint, p_to_after bigint,
                                             p_note text, p_key text, p_ref text default null)
returns public.agent_transfers
language plpgsql security definer set search_path = public as $$
declare t public.agent_transfers;
begin
  insert into public.agent_transfers (ref, kind, actor_id, from_agent, to_agent, to_player, amount,
                                      from_after, to_after, note, idempotency_key)
  values (coalesce(p_ref, public.agent_new_ref()), p_kind, p_actor, p_from, p_to_agent, p_to_player, p_amount,
          p_from_after, p_to_after, nullif(left(btrim(coalesce(p_note, '')), 200), ''), p_key)
  returning * into t;
  return t;
end $$;

-- Creates (or reopens a closed) agent row for a member. Shared by the owner and by master agents.
create or replace function public.agent_enlist(p_actor uuid, p_player_no bigint, p_parent uuid, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_p public.profiles := public.player_by_no(p_player_no);
  v_a public.agents;
begin
  if v_p.role = 'owner' then
    raise exception 'OWNER_ACCOUNT' using errcode = '22023';
  end if;
  if v_p.user_id = p_parent then
    raise exception 'SELF_SEND' using errcode = '22023';
  end if;
  select * into v_a from public.agents where user_id = v_p.user_id for update;
  if found and v_a.status <> 'closed' then
    raise exception 'ALREADY_AGENT' using errcode = '22023';
  end if;
  -- a master with sub-agents cannot become someone's sub-agent (two tiers only)
  if p_parent is not null and exists (select 1 from public.agents where parent_id = v_p.user_id and status <> 'closed') then
    raise exception 'HAS_SUBS' using errcode = '22023';
  end if;
  if found then
    update public.agents
       set parent_id = p_parent, status = 'active', note = nullif(left(btrim(coalesce(p_note, '')), 200), ''),
           created_by = p_actor, updated_at = now()
     where user_id = v_p.user_id returning * into v_a;
  else
    insert into public.agents (user_id, parent_id, note, created_by)
    values (v_p.user_id, p_parent, nullif(left(btrim(coalesce(p_note, '')), 200), ''), p_actor)
    returning * into v_a;
  end if;
  insert into public.admin_audit_logs (admin_id, action, target, after_json, reason)
  values (p_actor, 'add_agent', v_p.user_id::text,
          jsonb_build_object('player_no', v_p.player_no, 'parent_id', p_parent), v_a.note);
  return jsonb_build_object('user_id', v_p.user_id, 'player_no', v_p.player_no, 'display_name', v_p.display_name,
                            'tier', case when p_parent is null then 'master' else 'sub' end);
end $$;

-- ---------- agent actions ----------

-- Looks up a player by number so the agent can check the name before sending.
create or replace function public.agent_find_player(p_player_no bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_a public.agents := public.require_agent(false);
  v_p public.profiles := public.player_by_no(p_player_no);
begin
  return jsonb_build_object('player_no', v_p.player_no, 'display_name', v_p.display_name, 'is_me', v_p.user_id = v_a.user_id);
end $$;

-- Sends free points from the agent's allowance to a player's wallet, in one transaction.
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

-- Master agent: name a member as one of their sub-agents (at most 50 open sub-agents).
create or replace function public.agent_add_sub(p_player_no bigint, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_a public.agents := public.require_agent(true);
begin
  if v_a.parent_id is not null then
    raise exception 'MASTER_ONLY' using errcode = '42501';
  end if;
  if (select count(*) from public.agents where parent_id = v_a.user_id and status <> 'closed') >= 50 then
    raise exception 'TOO_MANY_SUBS' using errcode = '22023';
  end if;
  return public.agent_enlist(v_a.user_id, p_player_no, v_a.user_id, p_note);
end $$;

-- Master agent: pass part of their allowance to one of their active sub-agents.
create or replace function public.agent_pass(p_sub uuid, p_amount bigint, p_key text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_a public.agents := public.require_agent(true);
  v_s public.agents;
  v_prev jsonb;
  t public.agent_transfers;
begin
  perform public.agent_check_amount(p_amount);
  perform public.agent_check_key(p_key);
  select * into v_s from public.agents where user_id = p_sub and parent_id = v_a.user_id for update;
  if not found then
    raise exception 'NOT_YOUR_SUB' using errcode = '42501';
  end if;
  v_prev := public.agent_replay(v_a.user_id, p_key, 'PASS', p_amount, v_a.user_id, p_sub);
  if v_prev is not null then
    return v_prev || jsonb_build_object('allowance', v_a.allowance);
  end if;
  if v_s.status <> 'active' then
    raise exception 'AGENT_FROZEN' using errcode = '22023';
  end if;
  perform public.agent_rate_check(v_a.user_id);
  if v_a.allowance < p_amount then
    raise exception 'ALLOWANCE_LOW' using errcode = '22023';
  end if;
  update public.agents set allowance = allowance - p_amount, updated_at = now() where user_id = v_a.user_id returning * into v_a;
  update public.agents set allowance = allowance + p_amount, updated_at = now() where user_id = p_sub returning * into v_s;
  t := public.agent_post('PASS', v_a.user_id, v_a.user_id, p_sub, null, p_amount, v_a.allowance, v_s.allowance, null, p_key);
  return public.agent_transfer_json(t) || jsonb_build_object('allowance', v_a.allowance);
end $$;

-- Master agent: take back unspent allowance from a sub-agent (all of it when p_amount is null).
create or replace function public.agent_reclaim(p_sub uuid, p_amount bigint, p_key text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_a public.agents := public.require_agent(true);
  v_s public.agents;
  v_amount bigint;
  v_prev jsonb;
  t public.agent_transfers;
begin
  perform public.agent_check_key(p_key);
  select * into v_s from public.agents where user_id = p_sub and parent_id = v_a.user_id for update;
  if not found then
    raise exception 'NOT_YOUR_SUB' using errcode = '42501';
  end if;
  v_prev := public.agent_replay(v_a.user_id, p_key, 'RECLAIM', p_amount, p_sub, v_a.user_id);
  if v_prev is not null then
    return v_prev || jsonb_build_object('allowance', v_a.allowance);
  end if;
  v_amount := coalesce(p_amount, v_s.allowance);
  if v_amount = 0 then
    raise exception 'NOTHING_TO_RECLAIM' using errcode = '22023';
  end if;
  perform public.agent_check_amount(v_amount);
  if v_s.allowance < v_amount then
    raise exception 'ALLOWANCE_LOW' using errcode = '22023';
  end if;
  update public.agents set allowance = allowance - v_amount, updated_at = now() where user_id = p_sub returning * into v_s;
  update public.agents set allowance = allowance + v_amount, updated_at = now() where user_id = v_a.user_id returning * into v_a;
  t := public.agent_post('RECLAIM', v_a.user_id, p_sub, v_a.user_id, null, v_amount, v_s.allowance, v_a.allowance, null, p_key);
  return public.agent_transfer_json(t) || jsonb_build_object('allowance', v_a.allowance);
end $$;

-- Freeze or unfreeze an agent: the owner for any agent, a master agent for their own sub-agents.
-- Closing (owner only) ends the agent role and returns the unspent allowance to the site.
create or replace function public.set_agent_status(p_agent uuid, p_status text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_owner boolean := public.is_owner();
  v_actor uuid;
  v_a public.agents;
  v_before text;
  t public.agent_transfers;
begin
  if p_status not in ('active', 'frozen', 'closed') then
    raise exception 'BAD_STATUS' using errcode = '22023';
  end if;
  if v_owner then
    v_actor := auth.uid();
  else
    v_actor := (public.require_agent(true)).user_id;
    if p_status = 'closed' then
      raise exception 'OWNER_ONLY' using errcode = '42501';
    end if;
  end if;
  select * into v_a from public.agents where user_id = p_agent for update;
  if not found or (not v_owner and v_a.parent_id is distinct from v_actor) then
    raise exception 'NOT_YOUR_SUB' using errcode = '42501';
  end if;
  if v_a.status = 'closed' then
    raise exception 'AGENT_CLOSED' using errcode = '22023';
  end if;
  v_before := v_a.status;
  if v_before = p_status then
    return jsonb_build_object('user_id', p_agent, 'status', p_status);
  end if;
  if p_status = 'closed' and exists (select 1 from public.agents where parent_id = p_agent and status <> 'closed') then
    raise exception 'HAS_SUBS' using errcode = '22023';
  end if;
  if p_status = 'closed' and v_a.allowance > 0 then
    t := public.agent_post('REVOKE', v_actor, p_agent, null, null, v_a.allowance, 0, null, 'إنهاء الوكالة',
                           'close:' || p_agent || ':' || extract(epoch from clock_timestamp())::text);
    update public.agents set allowance = 0 where user_id = p_agent;
  end if;
  update public.agents set status = p_status, updated_at = now() where user_id = p_agent;
  insert into public.admin_audit_logs (admin_id, action, target, before_json, after_json, reason)
  values (v_actor, 'set_agent_status', p_agent::text, jsonb_build_object('status', v_before),
          jsonb_build_object('status', p_status), nullif(btrim(coalesce(p_reason, '')), ''));
  return jsonb_build_object('user_id', p_agent, 'status', p_status);
end $$;

-- The agent's own panel: allowance, totals, sub-agents and recent movements. Null for a member who is not an agent.
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
    'gifted_today', (select coalesce(sum(amount), 0)::bigint from public.agent_transfers
                      where from_agent = v_uid and kind = 'GIFT' and created_at >= v_today),
    'gifted_total', (select coalesce(sum(amount), 0)::bigint from public.agent_transfers where from_agent = v_uid and kind = 'GIFT'),
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
                     else coalesce(fa.display_name, 'الموقع') end as other_name,
                case when t.from_agent = v_uid then coalesce(tp.player_no, ta.player_no) else fa.player_no end as other_no
         from public.agent_transfers t
         left join public.profiles tp on tp.user_id = t.to_player
         left join public.profiles ta on ta.user_id = t.to_agent
         left join public.profiles fa on fa.user_id = t.from_agent
         where t.from_agent = v_uid or t.to_agent = v_uid
         order by t.id desc limit 100) x), '[]'::jsonb));
end $$;

-- ---------- owner actions ----------

create or replace function public.owner_add_agent(p_player_no bigint, p_parent uuid default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := public.require_owner();
  v_parent public.agents;
begin
  if p_parent is not null then
    select * into v_parent from public.agents where user_id = p_parent;
    if not found or v_parent.parent_id is not null or v_parent.status = 'closed' then
      raise exception 'NOT_MASTER' using errcode = '22023';
    end if;
  end if;
  return public.agent_enlist(v_admin, p_player_no, p_parent, p_note);
end $$;

-- Owner: add free points to an agent's allowance. Creates points; nothing is paid for them.
create or replace function public.owner_grant_allowance(p_agent uuid, p_amount bigint, p_key text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := public.require_owner();
  v_a public.agents;
  v_prev jsonb;
  t public.agent_transfers;
begin
  perform public.agent_check_amount(p_amount);
  perform public.agent_check_key(p_key);
  select * into v_a from public.agents where user_id = p_agent for update;
  if not found or v_a.status = 'closed' then
    raise exception 'NOT_AGENT' using errcode = '22023';
  end if;
  v_prev := public.agent_replay(v_admin, p_key, 'GRANT', p_amount, null, p_agent);
  if v_prev is not null then
    return v_prev;
  end if;
  update public.agents set allowance = allowance + p_amount, updated_at = now() where user_id = p_agent returning * into v_a;
  t := public.agent_post('GRANT', v_admin, null, p_agent, null, p_amount, null, v_a.allowance, p_note, p_key);
  return public.agent_transfer_json(t);
end $$;

-- Owner: take back unspent allowance from any agent (all of it when p_amount is null). The points cease to exist.
create or replace function public.owner_revoke_allowance(p_agent uuid, p_amount bigint, p_key text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := public.require_owner();
  v_a public.agents;
  v_amount bigint;
  v_prev jsonb;
  t public.agent_transfers;
begin
  perform public.agent_check_key(p_key);
  select * into v_a from public.agents where user_id = p_agent for update;
  if not found then
    raise exception 'NOT_AGENT' using errcode = '22023';
  end if;
  v_prev := public.agent_replay(v_admin, p_key, 'REVOKE', p_amount, p_agent, null);
  if v_prev is not null then
    return v_prev;
  end if;
  v_amount := coalesce(p_amount, v_a.allowance);
  if v_amount = 0 then
    raise exception 'NOTHING_TO_RECLAIM' using errcode = '22023';
  end if;
  perform public.agent_check_amount(v_amount);
  if v_a.allowance < v_amount then
    raise exception 'ALLOWANCE_LOW' using errcode = '22023';
  end if;
  update public.agents set allowance = allowance - v_amount, updated_at = now() where user_id = p_agent returning * into v_a;
  t := public.agent_post('REVOKE', v_admin, p_agent, null, null, v_amount, v_a.allowance, null, p_note, p_key);
  return public.agent_transfer_json(t);
end $$;

-- Owner: every agent with totals, and the full movement log (newest first, optionally for one agent).
create or replace function public.agent_overview(p_agent uuid default null, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_admin uuid := public.require_owner();
begin
  return jsonb_build_object(
    'totals', (select jsonb_build_object(
        'granted', coalesce(sum(amount) filter (where kind = 'GRANT'), 0)::bigint,
        'revoked', coalesce(sum(amount) filter (where kind = 'REVOKE'), 0)::bigint,
        'gifted', coalesce(sum(amount) filter (where kind = 'GIFT'), 0)::bigint,
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
               'gifted', (select coalesce(sum(amount), 0)::bigint from public.agent_transfers
                           where from_agent = a.user_id and kind = 'GIFT'),
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
               fa.display_name as from_name, fa.player_no as from_no,
               coalesce(tp.display_name, ta.display_name) as to_name, coalesce(tp.player_no, ta.player_no) as to_no
        from public.agent_transfers t
        join public.profiles ac on ac.user_id = t.actor_id
        left join public.profiles fa on fa.user_id = t.from_agent
        left join public.profiles ta on ta.user_id = t.to_agent
        left join public.profiles tp on tp.user_id = t.to_player
        where p_agent is null or t.from_agent = p_agent or t.to_agent = p_agent
        order by t.id desc
        limit 100 offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb));
end $$;

-- Allowance must equal what came in minus what went out, for every agent (checked by the SQL tests).
create or replace function public.agent_allowance_violations()
returns table (user_id uuid, allowance bigint, expected bigint)
language sql stable security definer set search_path = public as $$
  select a.user_id, a.allowance, x.expected
  from public.agents a
  cross join lateral (
    select coalesce(sum(case when t.to_agent = a.user_id then t.amount else 0 end), 0)
         - coalesce(sum(case when t.from_agent = a.user_id then t.amount else 0 end), 0) as expected
    from public.agent_transfers t
    where t.to_agent = a.user_id or t.from_agent = a.user_id
  ) x
  where a.allowance <> x.expected;
$$;

-- Owner report: points granted now include agent gifts.
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
                        where type in ('SIGNUP_GRANT', 'RECOVERY_GRANT', 'DAILY_BONUS', 'AGENT_GIFT')))
    into v_points;

  return jsonb_build_object('days', p_days, 'games', v_games, 'totals', v_totals, 'points', v_points);
end $$;

-- ---------- grants ----------

revoke all on function public.agent_check_amount(bigint), public.agent_check_key(text), public.agent_new_ref(),
  public.agent_transfer_json(public.agent_transfers, boolean), public.agent_replay(uuid, text, text, bigint, uuid, uuid),
  public.agent_rate_check(uuid), public.player_by_no(bigint), public.require_agent(boolean),
  public.agent_post(text, uuid, uuid, uuid, uuid, bigint, bigint, bigint, text, text, text),
  public.agent_enlist(uuid, bigint, uuid, text), public.agent_allowance_violations()
  from public, anon, authenticated;
revoke all on function public.agent_find_player(bigint), public.agent_send(bigint, bigint, text, text),
  public.agent_add_sub(bigint, text), public.agent_pass(uuid, bigint, text), public.agent_reclaim(uuid, bigint, text),
  public.set_agent_status(uuid, text, text), public.agent_dashboard(),
  public.owner_add_agent(bigint, uuid, text), public.owner_grant_allowance(uuid, bigint, text, text),
  public.owner_revoke_allowance(uuid, bigint, text, text), public.agent_overview(uuid, int)
  from public, anon;
grant execute on function public.agent_find_player(bigint), public.agent_send(bigint, bigint, text, text),
  public.agent_add_sub(bigint, text), public.agent_pass(uuid, bigint, text), public.agent_reclaim(uuid, bigint, text),
  public.set_agent_status(uuid, text, text), public.agent_dashboard(),
  public.owner_add_agent(bigint, uuid, text), public.owner_grant_allowance(uuid, bigint, text, text),
  public.owner_revoke_allowance(uuid, bigint, text, text), public.agent_overview(uuid, int)
  to authenticated;
