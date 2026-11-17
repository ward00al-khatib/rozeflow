-- Invite links the owner shares himself (e.g. on WhatsApp), so joining needs no email delivery (spec appendix ن).
-- Only a hash of each code is stored; the code is shown to the owner once, when the link is created.

create table public.invite_links (
  id          bigint generated always as identity primary key,
  code_hash   text not null unique,
  note        text check (char_length(note) <= 200),
  created_by  uuid not null references public.profiles (user_id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  reserved_at timestamptz,               -- set while the join function creates the account
  used_by     uuid references auth.users (id),
  used_at     timestamptz,
  revoked_at  timestamptz
);
alter table public.invite_links enable row level security;  -- no policies: only the functions below touch it

create or replace function public.invite_code_hash(p_code text) returns text
language sql immutable set search_path = public as $$
  select encode(sha256(convert_to(coalesce(p_code, ''), 'UTF8')), 'hex')
$$;

-- Owner: a new one-use link, valid for 1 to 30 days. Returns the code once.
create or replace function public.create_invite_link(p_note text default null, p_days int default 7)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_code text;
  v_link public.invite_links;
begin
  if not public.is_owner() then raise exception 'OWNER_ONLY'; end if;
  if p_days is null or p_days not between 1 and 30 then raise exception 'BAD_DAYS'; end if;
  if (select count(*) from public.invite_links
       where used_at is null and revoked_at is null and expires_at > now()) >= 50 then
    raise exception 'TOO_MANY_LINKS';
  end if;
  v_code := translate(encode(gen_random_bytes(12), 'base64'), '+/', '-_');
  insert into public.invite_links (code_hash, note, created_by, expires_at)
  values (public.invite_code_hash(v_code), nullif(left(btrim(coalesce(p_note, '')), 200), ''), auth.uid(),
          now() + make_interval(days => p_days))
  returning * into v_link;
  insert into public.admin_audit_logs (admin_id, action, target, after_json, reason)
  values (auth.uid(), 'create_invite_link', v_link.id::text,
          jsonb_build_object('expires_at', v_link.expires_at), v_link.note);
  return jsonb_build_object('id', v_link.id, 'code', v_code, 'expires_at', v_link.expires_at);
end $$;

create or replace function public.list_invite_links() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'OWNER_ONLY'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'note', l.note, 'created_at', l.created_at, 'expires_at', l.expires_at,
      'used_at', l.used_at, 'used_by_name', p.display_name, 'revoked_at', l.revoked_at,
      'status', case when l.used_at is not null then 'used'
                     when l.revoked_at is not null then 'revoked'
                     when l.expires_at <= now() then 'expired'
                     else 'open' end)
      order by l.created_at desc)
    from (select * from public.invite_links order by created_at desc limit 100) l
    left join public.profiles p on p.user_id = l.used_by), '[]'::jsonb);
end $$;

create or replace function public.revoke_invite_link(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'OWNER_ONLY'; end if;
  update public.invite_links set revoked_at = now()
   where id = p_id and used_at is null and revoked_at is null;
  if not found then raise exception 'LINK_NOT_OPEN'; end if;
  insert into public.admin_audit_logs (admin_id, action, target)
  values (auth.uid(), 'revoke_invite_link', p_id::text);
end $$;

-- Anyone holding a code may ask whether it is still good (the join page says so before the form).
create or replace function public.check_invite_code(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.invite_links
                  where code_hash = public.invite_code_hash(p_code)
                    and used_at is null and revoked_at is null and expires_at > now()
                    and (reserved_at is null or reserved_at < now() - interval '2 minutes'));
$$;

-- Join function only (service role): hold the link while the account is created, so one code makes one account.
create or replace function public.reserve_invite_code(p_code text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  update public.invite_links set reserved_at = now()
   where code_hash = public.invite_code_hash(p_code)
     and used_at is null and revoked_at is null and expires_at > now()
     and (reserved_at is null or reserved_at < now() - interval '2 minutes')
  returning id into v_id;
  if v_id is null then raise exception 'INVITE_INVALID'; end if;
  return v_id;
end $$;

create or replace function public.finish_invite_code(p_id bigint, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then
    update public.invite_links set reserved_at = null where id = p_id and used_at is null;
  else
    update public.invite_links set used_by = p_user, used_at = now() where id = p_id and used_at is null;
  end if;
end $$;

revoke all on table public.invite_links from public, anon, authenticated;
revoke execute on function public.invite_code_hash(text) from public, anon, authenticated;
revoke execute on function public.create_invite_link(text, int), public.list_invite_links(),
  public.revoke_invite_link(bigint), public.check_invite_code(text),
  public.reserve_invite_code(text), public.finish_invite_code(bigint, uuid) from public, anon;
grant execute on function public.create_invite_link(text, int), public.list_invite_links(),
  public.revoke_invite_link(bigint) to authenticated;
grant execute on function public.check_invite_code(text) to anon, authenticated;
revoke execute on function public.reserve_invite_code(text), public.finish_invite_code(bigint, uuid) from authenticated;
grant execute on function public.reserve_invite_code(text), public.finish_invite_code(bigint, uuid),
  public.invite_code_hash(text) to service_role;
