-- M1: membership, signup grant and owner bootstrap (spec 2.2, 5.2, 5.6, 8.3).
-- Invites are sent with Supabase Auth's own invite flow from the invite-member Edge Function,
-- so the custom invites table from the core schema is not needed.

drop table if exists public.invites;

-- Amounts in centi-points. Changing these values is a migration, i.e. a reviewed change in Git (spec 8.2).
create or replace function public.signup_grant_amount() returns bigint
language sql immutable as $$ select 100000::bigint $$;  -- 1,000 points (spec 16)

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and role = 'owner' and status = 'active');
$$;

-- Called once by an invited user after they set their password on /join.
-- Creates the profile and wallet and posts SIGNUP_GRANT, all in one transaction. Safe to call twice.
create or replace function public.complete_join(p_display_name text, p_age_confirmed boolean, p_terms_accepted boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_grant bigint := public.signup_grant_amount();
  v_wallet public.wallet_accounts;
  v_inserted boolean;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not coalesce(p_age_confirmed, false) or not coalesce(p_terms_accepted, false) then
    raise exception 'age confirmation and terms acceptance are required' using errcode = '22023';
  end if;
  p_display_name := btrim(coalesce(p_display_name, ''));
  if char_length(p_display_name) not between 2 and 32 then
    raise exception 'display name must be 2-32 characters' using errcode = '22023';
  end if;

  insert into public.profiles (user_id, display_name, age_confirmed_at, terms_accepted_at)
  values (v_uid, p_display_name, now(), now())
  on conflict (user_id) do nothing;

  insert into public.wallet_accounts (user_id) values (v_uid) on conflict (user_id) do nothing;

  select * into v_wallet from public.wallet_accounts where user_id = v_uid for update;

  insert into public.wallet_ledger (user_id, type, amount, available_after, reserved_after, idempotency_key)
  values (v_uid, 'SIGNUP_GRANT', v_grant, v_wallet.available + v_grant, v_wallet.reserved, 'signup:' || v_uid)
  on conflict (idempotency_key) do nothing
  returning true into v_inserted;

  if coalesce(v_inserted, false) then
    update public.wallet_accounts
       set available = available + v_grant, version = version + 1, updated_at = now()
     where user_id = v_uid
     returning * into v_wallet;
  end if;

  return jsonb_build_object('available', v_wallet.available, 'reserved', v_wallet.reserved, 'granted', coalesce(v_inserted, false));
end $$;

-- First member to call this becomes the owner; afterwards it does nothing.
-- Only invited users can have accounts, and ward is the first account in the project.
create or replace function public.claim_ownership() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtext('rozeflow:claim_ownership'));
  if exists (select 1 from public.profiles where role = 'owner') then
    return public.is_owner();
  end if;
  update public.profiles set role = 'owner' where user_id = auth.uid();
  if found then
    insert into public.admin_audit_logs (admin_id, action, target, reason)
    values (auth.uid(), 'claim_ownership', auth.uid()::text, 'first owner bootstrap');
  end if;
  return found;
end $$;

-- Owner can see all members and the audit log (spec 8.3).
create policy owner_reads_profiles on public.profiles for select using (public.is_owner());
create policy owner_reads_wallets on public.wallet_accounts for select using (public.is_owner());
create policy owner_reads_audit on public.admin_audit_logs for select using (public.is_owner());

revoke all on function public.complete_join(text, boolean, boolean) from public, anon;
revoke all on function public.claim_ownership() from public, anon;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.complete_join(text, boolean, boolean) to authenticated;
grant execute on function public.claim_ownership() to authenticated;
grant execute on function public.is_owner() to authenticated;
