-- Security controls (spec appendix م): round rate limit, freezing a member, resetting a member's devices,
-- security alerts for the owner, and a sweep that keeps anon away from every SECURITY DEFINER function.

-- ---------- rate limit ----------
-- At most N new rounds per member in any 10 seconds (site setting round_rate_limit, default 40;
-- fast auto-play stays well under it).
insert into public.site_settings (key, value) values ('round_rate_limit', '40') on conflict (key) do nothing;

create or replace function public.round_rate_check(p_uid uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_limit int := coalesce((select (value #>> '{}')::int from public.site_settings where key = 'round_rate_limit'), 40);
begin
  if (select count(*) from public.game_rounds
       where user_id = p_uid and created_at > now() - interval '10 seconds') >= v_limit then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;
end $$;

-- Every game but Dice takes its nonce here; Dice calls round_rate_check itself.
create or replace function public.take_nonce(p_uid uuid) returns public.seed_pairs
language plpgsql security definer set search_path = public, extensions as $$
declare v_pair public.seed_pairs;
begin
  perform public.round_rate_check(p_uid);
  v_pair := public.ensure_seed_pair(p_uid);
  update public.seed_pairs set next_nonce = next_nonce + 1 where id = v_pair.id;
  return v_pair;
end $$;

-- ---------- member controls ----------

create or replace function public.set_member_status(p_user uuid, p_status text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := public.require_owner();
  v_p public.profiles;
begin
  if p_status not in ('active', 'paused') then
    raise exception 'BAD_STATUS' using errcode = '22023';
  end if;
  select * into v_p from public.profiles where user_id = p_user for update;
  if not found then
    raise exception 'PLAYER_NOT_FOUND' using errcode = '22023';
  end if;
  if v_p.role = 'owner' then
    raise exception 'OWNER_ACCOUNT' using errcode = '22023';
  end if;
  if v_p.status not in ('active', 'paused') then
    raise exception 'BAD_STATUS' using errcode = '22023';
  end if;
  if v_p.status <> p_status then
    update public.profiles set status = p_status where user_id = p_user;
    insert into public.admin_audit_logs (admin_id, action, target, before_json, after_json, reason)
    values (v_admin, 'set_member_status', p_user::text, jsonb_build_object('status', v_p.status),
            jsonb_build_object('status', p_status), nullif(btrim(coalesce(p_reason, '')), ''));
  end if;
  return jsonb_build_object('user_id', p_user, 'status', p_status);
end $$;

-- Signs a member out of every device: all their devices become 'removed', so each one must be approved again.
create or replace function public.reset_member_devices(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := public.require_owner();
  v_n int;
begin
  if exists (select 1 from public.profiles where user_id = p_user and role = 'owner') then
    raise exception 'OWNER_ACCOUNT' using errcode = '22023';
  end if;
  update public.devices set status = 'removed', decided_at = now()
   where user_id = p_user and status in ('approved', 'pending');
  get diagnostics v_n = row_count;
  insert into public.admin_audit_logs (admin_id, action, target, after_json)
  values (v_admin, 'reset_member_devices', p_user::text, jsonb_build_object('devices', v_n));
  return jsonb_build_object('user_id', p_user, 'devices', v_n);
end $$;

-- ---------- alerts ----------

create or replace function public.security_alerts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_admin uuid := public.require_owner();
  v_alerts jsonb := '[]'::jsonb;
begin
  -- one device on several accounts
  v_alerts := v_alerts || coalesce((
    select jsonb_agg(jsonb_build_object('kind', 'shared_device', 'level', 'high', 'label', x.label, 'names', x.names, 'at', x.at))
    from (
      select min(d.label) as label, jsonb_agg(distinct p.display_name) as names, max(d.last_seen) as at
      from public.devices d join public.profiles p on p.user_id = d.user_id
      group by d.device_hash having count(distinct d.user_id) > 1
    ) x), '[]'::jsonb);
  -- many addresses for one member in a day
  v_alerts := v_alerts || coalesce((
    select jsonb_agg(jsonb_build_object('kind', 'many_ips', 'level', 'medium', 'name', x.display_name, 'count', x.n, 'at', x.at))
    from (
      select p.display_name, count(distinct s.ip) as n, max(s.last_seen) as at
      from public.device_sessions s join public.profiles p on p.user_id = s.user_id
      where s.last_seen > now() - interval '24 hours' and s.ip is not null
      group by p.display_name having count(distinct s.ip) >= 4
    ) x), '[]'::jsonb);
  -- several new devices for one member in a day
  v_alerts := v_alerts || coalesce((
    select jsonb_agg(jsonb_build_object('kind', 'many_devices', 'level', 'medium', 'name', x.display_name, 'count', x.n, 'at', x.at))
    from (
      select p.display_name, count(*) as n, max(d.first_seen) as at
      from public.devices d join public.profiles p on p.user_id = d.user_id
      where d.first_seen > now() - interval '24 hours' and p.role <> 'owner'
      group by p.display_name having count(*) >= 3
    ) x), '[]'::jsonb);

  return jsonb_build_object(
    'alerts', v_alerts,
    -- every sign-in to the owner's account in the last 7 days, so a stranger's would stand out
    'owner_sessions', coalesce((
      select jsonb_agg(jsonb_build_object('at', s.created_at, 'last_seen', s.last_seen, 'ip', s.ip, 'label', d.label)
                       order by s.created_at desc)
      from public.device_sessions s join public.devices d on d.id = s.device_id
      where s.user_id = v_admin and s.created_at > now() - interval '7 days'), '[]'::jsonb),
    'paused', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', user_id, 'name', display_name))
      from public.profiles where status = 'paused'), '[]'::jsonb));
end $$;

revoke all on function public.round_rate_check(uuid) from public, anon, authenticated;
revoke all on function public.take_nonce(uuid) from public, anon, authenticated;
revoke all on function public.set_member_status(uuid, text, text) from public, anon;
revoke all on function public.reset_member_devices(uuid) from public, anon;
revoke all on function public.security_alerts() from public, anon;
grant execute on function public.set_member_status(uuid, text, text) to authenticated;
grant execute on function public.reset_member_devices(uuid) to authenticated;
grant execute on function public.security_alerts() to authenticated;

-- ---------- sweep: no SECURITY DEFINER function is callable without signing in ----------
-- Functions that signed-in members already reach through PUBLIC keep that reach through an explicit grant.
do $$
declare f record;
begin
  for f in
    select p.oid, p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    if has_function_privilege('authenticated', f.oid, 'execute') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;
