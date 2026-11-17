-- Owner powers need a two-factor session (spec appendix ل).
\set QUIET on
begin;
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2');

create function pg_temp.session(uid text, aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'session_id', 'sess-' || uid, 'aal', aal)::text, true);
  perform public.register_device('device-key-' || replace(uid, '-', ''), 'test');
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

-- Supabase grants table reads to authenticated by default; RLS decides the rows.
grant select on public.wallet_accounts, public.profiles to authenticated;

-- bootstrap works on a password-only session
select pg_temp.session('00000000-0000-0000-0000-0000000000a1', 'aal1');
select public.complete_join('ward', true, true);
do $$ begin
  if not public.claim_ownership() then raise exception 'claim must succeed on aal1'; end if;
  if not public.claim_ownership() then raise exception 'repeat claim reports owner'; end if;
  if not public.is_owner_account() then raise exception 'owner account'; end if;
  if public.is_owner() then raise exception 'aal1 must not have owner powers'; end if;
end $$;
select pg_temp.session('00000000-0000-0000-0000-0000000000b2', 'aal2');
select public.complete_join('friend', true, true);
do $$ begin
  if public.is_owner() or public.is_owner_account() then raise exception 'friend is not owner, even with aal2'; end if;
end $$;

-- password-only owner: every owner function refuses, owner RLS reads see only own rows
select pg_temp.session('00000000-0000-0000-0000-0000000000a1', 'aal1');
select pg_temp.expect_fail($$select public.site_report(7)$$, 'OWNER_ONLY');
select pg_temp.expect_fail($$select public.set_game_rtp('dice', 9500)$$, 'OWNER_ONLY');
select pg_temp.expect_fail($$select public.set_game_status('dice', 'paused')$$, 'OWNER_ONLY');
select pg_temp.expect_fail($$select public.device_overview()$$, 'OWNER_ONLY');
select pg_temp.expect_fail($$select public.set_max_devices(3)$$, 'OWNER_ONLY');
select pg_temp.expect_fail($$select public.set_daily_bonus(100)$$, 'OWNER_ONLY');
do $$ begin perform public.my_seed_state(); end $$;   -- still plays like a member
set local role authenticated;
do $$ begin
  if (select count(*) from public.wallet_accounts) <> 1 then raise exception 'aal1 owner must see only own wallet'; end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'aal1 owner must see only own profile'; end if;
end $$;
reset role;

-- two-factor owner: powers back
select pg_temp.session('00000000-0000-0000-0000-0000000000a1', 'aal2');
do $$ begin
  if not public.is_owner() then raise exception 'aal2 owner'; end if;
  perform public.site_report(7);
  perform public.device_overview();
end $$;
set local role authenticated;
do $$ begin
  if (select count(*) from public.wallet_accounts) <> 2 then raise exception 'aal2 owner reads all wallets'; end if;
end $$;
reset role;

do $$ begin raise notice 'owner_mfa_test: all checks passed'; end $$;
rollback;
