-- Agents bring in new players with one-use invite links (spec appendix س, addition of 2026-11-17).
-- Same links as the owner's (appendix ن): the friend picks their own username and password, so the agent never
-- learns it. A link works only while whoever made it is the owner or an active agent.

-- True for the owner account, or an agent who is active and whose master (if any) is active.
create or replace function public.invite_creator_ok(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = p_user and role = 'owner' and status = 'active')
      or exists (select 1 from public.agents a
                  join public.profiles p on p.user_id = a.user_id and p.status = 'active'
                  left join public.agents m on m.user_id = a.parent_id
                  where a.user_id = p_user and a.status = 'active' and (a.parent_id is null or m.status = 'active'));
$$;

create or replace function public.check_invite_code(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.invite_links
                  where code_hash = public.invite_code_hash(p_code)
                    and used_at is null and revoked_at is null and expires_at > now()
                    and (reserved_at is null or reserved_at < now() - interval '2 minutes')
                    and public.invite_creator_ok(created_by));
$$;

create or replace function public.reserve_invite_code(p_code text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  update public.invite_links set reserved_at = now()
   where code_hash = public.invite_code_hash(p_code)
     and used_at is null and revoked_at is null and expires_at > now()
     and (reserved_at is null or reserved_at < now() - interval '2 minutes')
     and public.invite_creator_ok(created_by)
  returning id into v_id;
  if v_id is null then raise exception 'INVITE_INVALID'; end if;
  return v_id;
end $$;

-- Owner list now says who made each link (the owner or an agent).
create or replace function public.list_invite_links() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'OWNER_ONLY'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'note', l.note, 'created_at', l.created_at, 'expires_at', l.expires_at,
      'used_at', l.used_at, 'used_by_name', p.display_name, 'revoked_at', l.revoked_at,
      'by_agent', c.role <> 'owner', 'created_by_name', c.display_name,
      'status', case when l.used_at is not null then 'used'
                     when l.revoked_at is not null then 'revoked'
                     when l.expires_at <= now() then 'expired'
                     else 'open' end)
      order by l.created_at desc)
    from (select * from public.invite_links order by created_at desc limit 100) l
    join public.profiles c on c.user_id = l.created_by
    left join public.profiles p on p.user_id = l.used_by), '[]'::jsonb);
end $$;

-- Agent: a new one-use link, valid 1 to 7 days. At most 10 open links and 20 new links a day per agent.
create or replace function public.agent_create_invite_link(p_note text default null, p_days int default 3)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_a public.agents := public.require_agent(true);
  v_code text;
  v_link public.invite_links;
begin
  if p_days is null or p_days not between 1 and 7 then raise exception 'BAD_DAYS'; end if;
  if (select count(*) from public.invite_links
       where created_by = v_a.user_id and used_at is null and revoked_at is null and expires_at > now()) >= 10 then
    raise exception 'TOO_MANY_LINKS';
  end if;
  if (select count(*) from public.invite_links
       where created_by = v_a.user_id and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'RATE_LIMITED';
  end if;
  v_code := translate(encode(gen_random_bytes(12), 'base64'), '+/', '-_');
  insert into public.invite_links (code_hash, note, created_by, expires_at)
  values (public.invite_code_hash(v_code), nullif(left(btrim(coalesce(p_note, '')), 200), ''), v_a.user_id,
          now() + make_interval(days => p_days))
  returning * into v_link;
  insert into public.admin_audit_logs (admin_id, action, target, after_json, reason)
  values (v_a.user_id, 'agent_create_invite_link', v_link.id::text,
          jsonb_build_object('expires_at', v_link.expires_at), v_link.note);
  return jsonb_build_object('id', v_link.id, 'code', v_code, 'expires_at', v_link.expires_at);
end $$;

-- Agent: their own links, newest first, with who joined through each.
create or replace function public.agent_list_invite_links() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.require_profile();
begin
  if not exists (select 1 from public.agents where user_id = v_uid and status <> 'closed') then
    raise exception 'NOT_AGENT';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'note', l.note, 'created_at', l.created_at, 'expires_at', l.expires_at,
      'used_at', l.used_at, 'used_by_name', p.display_name, 'used_by_no', p.player_no, 'revoked_at', l.revoked_at,
      'status', case when l.used_at is not null then 'used'
                     when l.revoked_at is not null then 'revoked'
                     when l.expires_at <= now() then 'expired'
                     else 'open' end)
      order by l.created_at desc)
    from (select * from public.invite_links where created_by = v_uid order by created_at desc limit 50) l
    left join public.profiles p on p.user_id = l.used_by), '[]'::jsonb);
end $$;

create or replace function public.agent_revoke_invite_link(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.require_member();
begin
  update public.invite_links set revoked_at = now()
   where id = p_id and created_by = v_uid and used_at is null and revoked_at is null;
  if not found then raise exception 'LINK_NOT_OPEN'; end if;
  insert into public.admin_audit_logs (admin_id, action, target)
  values (v_uid, 'agent_revoke_invite_link', p_id::text);
end $$;

revoke all on function public.invite_creator_ok(uuid) from public, anon, authenticated;
revoke all on function public.agent_create_invite_link(text, int), public.agent_list_invite_links(),
  public.agent_revoke_invite_link(bigint) from public, anon;
grant execute on function public.agent_create_invite_link(text, int), public.agent_list_invite_links(),
  public.agent_revoke_invite_link(bigint) to authenticated;
grant execute on function public.check_invite_code(text) to anon, authenticated;
revoke execute on function public.reserve_invite_code(text) from public, anon, authenticated;
grant execute on function public.reserve_invite_code(text) to service_role;
