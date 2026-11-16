-- Device identity and limits (spec appendix ط).
-- A web page cannot read a MAC address, so each browser keeps a random device key in localStorage.
-- The page registers that key once per sign-in session (register_device); the session's JWT session_id
-- is bound to the device, and require_member() refuses game and seed calls from a session whose device
-- the owner has not approved. The key is stored only as a SHA-256 hash.
-- Rules: a member's first device is approved automatically, later ones wait for the owner, the owner
-- sets the most approved devices a member may have, and the owner's own devices are always approved.

create table public.site_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.site_settings (key, value) values ('max_devices', '2');

create table public.devices (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id),
  device_hash text not null check (device_hash ~ '^[0-9a-f]{64}$'),
  label       text not null default '',
  status      text not null check (status in ('approved', 'pending', 'blocked', 'removed')),
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  last_ip     text,
  decided_at  timestamptz,
  unique (user_id, device_hash)
);
create index devices_hash_idx on public.devices (device_hash);

-- One row per sign-in session: the session log the owner sees.
create table public.device_sessions (
  session_id text primary key,
  user_id    uuid not null references auth.users (id),
  device_id  bigint not null references public.devices (id),
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  ip         text,
  user_agent text
);
create index device_sessions_device_idx on public.device_sessions (device_id, last_seen desc);

alter table public.site_settings  enable row level security;
alter table public.devices        enable row level security;
alter table public.device_sessions enable row level security;
create policy member_reads_own_devices on public.devices for select using (user_id = auth.uid());
create policy owner_reads_devices on public.devices for select using (public.is_owner());
create policy owner_reads_device_sessions on public.device_sessions for select using (public.is_owner());
create policy anyone_reads_settings on public.site_settings for select using (true);
revoke all on public.site_settings, public.devices, public.device_sessions from anon, authenticated;
grant select on public.site_settings, public.devices, public.device_sessions to authenticated;

create or replace function public.max_devices() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from public.site_settings where key = 'max_devices'), 2);
$$;

-- The JWT's session id (Supabase puts session_id in every access token).
create or replace function public.jwt_session_id() returns text
language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id', '');
$$;

create or replace function public.request_ip() returns text
language sql stable as $$
  select left(coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip',
                       trim(split_part(h ->> 'x-forwarded-for', ',', 1))), 64)
  from (select nullif(current_setting('request.headers', true), '')::jsonb as h) s;
$$;

-- Called by the page after sign-in. Records the device and binds this session to it.
create or replace function public.register_device(p_device_key text, p_label text default '', p_user_agent text default '')
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_session text := public.jwt_session_id();
  v_hash text;
  v_dev public.devices;
  v_owner boolean;
  v_status text;
  v_ip text := public.request_ip();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if v_session is null then
    raise exception 'NO_SESSION' using errcode = '22023';
  end if;
  if p_device_key is null or p_device_key !~ '^[A-Za-z0-9_-]{16,100}$' then
    raise exception 'BAD_DEVICE_KEY' using errcode = '22023';
  end if;
  v_hash := encode(sha256(convert_to(p_device_key, 'UTF8')), 'hex');
  v_owner := exists (select 1 from public.profiles where user_id = v_uid and role = 'owner' and status = 'active');

  select * into v_dev from public.devices where user_id = v_uid and device_hash = v_hash for update;
  if not found then
    -- Lock the member's devices so two first sign-ins cannot both be auto-approved.
    perform 1 from public.devices where user_id = v_uid for update;
    if v_owner or not exists (select 1 from public.devices where user_id = v_uid and status = 'approved') then
      v_status := 'approved';
    else
      v_status := 'pending';
    end if;
    insert into public.devices (user_id, device_hash, label, status, last_ip, decided_at)
    values (v_uid, v_hash, left(coalesce(p_label, ''), 80), v_status, v_ip,
            case when v_status = 'approved' then now() end)
    returning * into v_dev;
  else
    update public.devices
       set last_seen = now(), last_ip = coalesce(v_ip, last_ip),
           label = case when coalesce(p_label, '') <> '' then left(p_label, 80) else label end,
           -- the owner never locks themselves out; a removed device asks again
           status = case when v_owner and status <> 'approved' then 'approved'
                         when status = 'removed' then 'pending' else status end
     where id = v_dev.id
     returning * into v_dev;
  end if;

  insert into public.device_sessions (session_id, user_id, device_id, ip, user_agent)
  values (v_session, v_uid, v_dev.id, v_ip, left(coalesce(p_user_agent, ''), 300))
  on conflict (session_id) do update
     set device_id = excluded.device_id, last_seen = now(), ip = coalesce(excluded.ip, device_sessions.ip)
   where device_sessions.user_id = v_uid;

  return jsonb_build_object('device_id', v_dev.id, 'status', v_dev.status, 'max_devices', public.max_devices());
end $$;

-- Game and seed calls go through here. Now also checks that this session's device is approved.
create or replace function public.require_member() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_status text;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select role into v_role from public.profiles where user_id = v_uid and status = 'active';
  if not found then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;
  if v_role = 'owner' then
    return v_uid;
  end if;
  select d.status into v_status
    from public.device_sessions s join public.devices d on d.id = s.device_id
   where s.session_id = public.jwt_session_id() and s.user_id = v_uid;
  if v_status is null then
    raise exception 'DEVICE_UNKNOWN' using errcode = '42501';
  elsif v_status = 'blocked' then
    raise exception 'DEVICE_BLOCKED' using errcode = '42501';
  elsif v_status <> 'approved' then
    raise exception 'DEVICE_NOT_APPROVED' using errcode = '42501';
  end if;
  return v_uid;
end $$;

-- ---------- owner ----------

create or replace function public.require_owner() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then
    raise exception 'OWNER_ONLY' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- Approve, block or remove a device. Approving respects the per-member limit.
create or replace function public.set_device_status(p_device_id bigint, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := public.require_owner();
  v_dev public.devices;
  v_approved int;
  v_target_owner boolean;
begin
  if p_status not in ('approved', 'blocked', 'removed') then
    raise exception 'BAD_STATUS' using errcode = '22023';
  end if;
  select * into v_dev from public.devices where id = p_device_id for update;
  if not found then
    raise exception 'DEVICE_NOT_FOUND' using errcode = '22023';
  end if;
  v_target_owner := exists (select 1 from public.profiles where user_id = v_dev.user_id and role = 'owner');
  if v_target_owner and p_status <> 'approved' then
    raise exception 'OWNER_DEVICE' using errcode = '22023';
  end if;
  if v_dev.status = p_status then
    return jsonb_build_object('device_id', v_dev.id, 'status', v_dev.status);
  end if;
  if p_status = 'approved' and not v_target_owner then
    perform 1 from public.devices where user_id = v_dev.user_id for update;
    select count(*) into v_approved from public.devices where user_id = v_dev.user_id and status = 'approved';
    if v_approved >= public.max_devices() then
      raise exception 'DEVICE_LIMIT' using errcode = '22023';
    end if;
  end if;
  update public.devices set status = p_status, decided_at = now() where id = v_dev.id;
  insert into public.admin_audit_logs (admin_id, action, target, before_json, after_json)
  values (v_admin, 'set_device_status', v_dev.user_id::text || ':' || v_dev.id,
          jsonb_build_object('status', v_dev.status, 'label', v_dev.label),
          jsonb_build_object('status', p_status));
  return jsonb_build_object('device_id', v_dev.id, 'status', p_status);
end $$;

create or replace function public.set_max_devices(p_max int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := public.require_owner();
  v_before int := public.max_devices();
begin
  if p_max is null or p_max < 1 or p_max > 10 then
    raise exception 'MAX_DEVICES_OUT_OF_RANGE' using errcode = '22023';
  end if;
  insert into public.site_settings (key, value) values ('max_devices', to_jsonb(p_max))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  if v_before <> p_max then
    insert into public.admin_audit_logs (admin_id, action, target, before_json, after_json)
    values (v_admin, 'set_max_devices', 'site', jsonb_build_object('max_devices', v_before),
            jsonb_build_object('max_devices', p_max));
  end if;
  return jsonb_build_object('max_devices', p_max);
end $$;

-- Everything the admin page shows: devices per member, recent sessions, and devices shared between accounts.
create or replace function public.device_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_admin uuid := public.require_owner();
  v_devices jsonb;
begin
  select coalesce(jsonb_agg(x order by x.pending desc, x.last_seen desc), '[]'::jsonb) into v_devices
  from (
    select d.id, d.user_id, coalesce(p.display_name, '') as display_name, coalesce(p.role, '') as role,
           d.label, d.status, d.first_seen, d.last_seen, d.last_ip,
           (d.status = 'pending') as pending,
           (select coalesce(jsonb_agg(distinct coalesce(p2.display_name, '?')), '[]'::jsonb)
              from public.devices d2 left join public.profiles p2 on p2.user_id = d2.user_id
             where d2.device_hash = d.device_hash and d2.user_id <> d.user_id) as shared_with,
           (select count(*) from public.device_sessions s where s.device_id = d.id) as sessions,
           (select coalesce(jsonb_agg(jsonb_build_object('at', s.created_at, 'last_seen', s.last_seen, 'ip', s.ip)
                                       order by s.created_at desc), '[]'::jsonb)
              from (select * from public.device_sessions s where s.device_id = d.id
                    order by s.created_at desc limit 5) s) as recent_sessions
    from public.devices d left join public.profiles p on p.user_id = d.user_id
  ) x;
  return jsonb_build_object('max_devices', public.max_devices(), 'devices', v_devices);
end $$;

-- ---------- grants ----------

revoke all on function public.max_devices() from public, anon;
revoke all on function public.jwt_session_id() from public, anon;
revoke all on function public.request_ip() from public, anon, authenticated;
revoke all on function public.register_device(text, text, text) from public, anon;
revoke all on function public.require_owner() from public, anon, authenticated;
revoke all on function public.set_device_status(bigint, text) from public, anon;
revoke all on function public.set_max_devices(int) from public, anon;
revoke all on function public.device_overview() from public, anon;
grant execute on function public.max_devices() to authenticated;
grant execute on function public.jwt_session_id() to authenticated;
grant execute on function public.register_device(text, text, text) to authenticated;
grant execute on function public.set_device_status(bigint, text) to authenticated;
grant execute on function public.set_max_devices(int) to authenticated;
grant execute on function public.device_overview() to authenticated;
