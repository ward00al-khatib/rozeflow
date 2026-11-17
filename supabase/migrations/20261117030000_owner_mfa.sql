-- Owner two-factor (spec appendix ل). Owner powers need a session verified with a second factor:
-- the access token's aal claim must be aal2 (Supabase Auth MFA, TOTP app). A stolen password alone
-- (aal1) can still play like a member but cannot read reports, change RTP, approve devices or invite.

create or replace function public.jwt_aal() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', 'aal1');
$$;

-- The owner role, whatever the session's assurance level (for UI and bootstrap).
create or replace function public.is_owner_account() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and role = 'owner' and status = 'active');
$$;

-- Owner powers: the owner role on a two-factor session. Used by every owner function and owner RLS policy.
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner_account() and public.jwt_aal() = 'aal2';
$$;

create or replace function public.claim_ownership() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtext('rozeflow:claim_ownership'));
  if exists (select 1 from public.profiles where role = 'owner') then
    return public.is_owner_account();
  end if;
  update public.profiles set role = 'owner' where user_id = auth.uid();
  if found then
    insert into public.admin_audit_logs (admin_id, action, target, reason)
    values (auth.uid(), 'claim_ownership', auth.uid()::text, 'first owner bootstrap');
  end if;
  return found;
end $$;

revoke all on function public.jwt_aal() from public, anon;
revoke all on function public.is_owner_account() from public, anon;
grant execute on function public.jwt_aal() to authenticated;
grant execute on function public.is_owner_account() to authenticated;
