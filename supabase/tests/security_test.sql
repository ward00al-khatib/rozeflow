-- Security controls and a sweep over every SECURITY DEFINER function (spec appendix م).
\set QUIET on
begin;
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2'),
  ('00000000-0000-0000-0000-0000000000c3');

create function pg_temp.session(uid text, sess text, dev text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'session_id', sess, 'aal', 'aal2')::text, true);
  perform public.register_device(dev, 'Chrome · Android');
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

select pg_temp.session('00000000-0000-0000-0000-0000000000a1', 'o1', 'owner-laptop-key-0001');
select public.complete_join('ward', true, true);
do $$ begin perform public.claim_ownership(); end $$;
select pg_temp.session('00000000-0000-0000-0000-0000000000c3', 'c1', 'third-phone-key-00001');
select public.complete_join('third', true, true);
select pg_temp.session('00000000-0000-0000-0000-0000000000b2', 'b1', 'friend-phone-key-0001');
select public.complete_join('friend', true, true);

-- 1. Rate limit: with a limit of 3 rounds per 10 s, the 4th round in the window is refused.
update public.site_settings set value = '3' where key = 'round_rate_limit';
do $$ begin
  for i in 1..3 loop perform public.play_dice(1000, 5000, 'under', 'rate-dice-' || lpad(i::text, 6, '0')); end loop;
end $$;
select pg_temp.expect_fail($$select public.play_dice(1000, 5000, 'under', 'rate-dice-000004')$$, 'RATE_LIMITED');
select pg_temp.expect_fail($$select public.play_plinko(1000, 8, 'low', 'rate-plinko-00001')$$, 'RATE_LIMITED');
do $$ begin  -- replaying an earlier key is not a new round
  if not (public.play_dice(1000, 5000, 'under', 'rate-dice-000001') ->> 'replay')::boolean then raise exception 'replay'; end if;
end $$;
update public.site_settings set value = '40' where key = 'round_rate_limit';

-- 2. Seeds are sealed at rest and still verifiable.
do $$ declare s text; begin
  select server_seed_enc into s from public.seed_pairs where user_id = auth.uid() and status = 'active';
  if s not like 'v1:%' then raise exception 'seed not sealed'; end if;
  if public.seed_seal('abc') = public.seed_seal('abc') then raise exception 'each seal needs a fresh iv'; end if;
  if public.seed_plain(public.seed_seal('abc')) <> 'abc' then raise exception 'seal round trip'; end if;
end $$;

-- 3. The third member signs in on the friend's phone: shared-device alert. Friend signs in from 4 addresses.
select pg_temp.session('00000000-0000-0000-0000-0000000000c3', 'c2', 'friend-phone-key-0001');
do $$ begin
  for i in 1..4 loop
    insert into public.device_sessions (session_id, user_id, device_id, ip)
    select 'b-ip-' || i, user_id, id, '10.0.0.' || i from public.devices
     where user_id = '00000000-0000-0000-0000-0000000000b2' limit 1;
  end loop;
end $$;

-- 4. Owner controls.
select pg_temp.session('00000000-0000-0000-0000-0000000000b2', 'b1', 'friend-phone-key-0001');
select pg_temp.expect_fail($$select public.security_alerts()$$, 'OWNER_ONLY');
select pg_temp.expect_fail($$select public.set_member_status('00000000-0000-0000-0000-0000000000c3', 'paused')$$, 'OWNER_ONLY');
select pg_temp.session('00000000-0000-0000-0000-0000000000a1', 'o2', 'owner-phone-key-00001');
do $$
declare a jsonb;
begin
  a := public.security_alerts();
  if not exists (select 1 from jsonb_array_elements(a -> 'alerts') x where x ->> 'kind' = 'shared_device' and x -> 'names' ? 'third') then
    raise exception 'shared device alert missing: %', a;
  end if;
  if not exists (select 1 from jsonb_array_elements(a -> 'alerts') x where x ->> 'kind' = 'many_ips' and x ->> 'name' = 'friend') then
    raise exception 'many ips alert missing: %', a;
  end if;
  if jsonb_array_length(a -> 'owner_sessions') <> 2 then raise exception 'owner sessions: %', a -> 'owner_sessions'; end if;

  perform public.set_member_status('00000000-0000-0000-0000-0000000000b2', 'paused', 'اختبار');
  if jsonb_array_length(public.security_alerts() -> 'paused') <> 1 then raise exception 'paused list'; end if;
end $$;
select pg_temp.expect_fail($$select public.set_member_status('00000000-0000-0000-0000-0000000000a1', 'paused')$$, 'OWNER_ACCOUNT');
select pg_temp.expect_fail($$select public.set_member_status('00000000-0000-0000-0000-0000000000b2', 'closed')$$, 'BAD_STATUS');
select pg_temp.expect_fail($$select public.reset_member_devices('00000000-0000-0000-0000-0000000000a1')$$, 'OWNER_ACCOUNT');

-- paused friend cannot play or claim
select pg_temp.session('00000000-0000-0000-0000-0000000000b2', 'b1', 'friend-phone-key-0001');
select pg_temp.expect_fail($$select public.play_dice(1000, 5000, 'under', 'paused-dice-000001')$$, 'ACCOUNT_NOT_ACTIVE');
select pg_temp.expect_fail($$select public.claim_daily_bonus()$$, 'ACCOUNT_NOT_ACTIVE');

-- unfreeze, then reset devices: the phone must be approved again
select pg_temp.session('00000000-0000-0000-0000-0000000000a1', 'o2', 'owner-phone-key-00001');
do $$ begin
  perform public.set_member_status('00000000-0000-0000-0000-0000000000b2', 'active');
  if (public.reset_member_devices('00000000-0000-0000-0000-0000000000b2') ->> 'devices')::int <> 1 then raise exception 'reset count'; end if;
  if (select count(*) from public.admin_audit_logs where action in ('set_member_status', 'reset_member_devices')) <> 3 then
    raise exception 'owner actions must be audited';
  end if;
end $$;
select pg_temp.session('00000000-0000-0000-0000-0000000000b2', 'b3', 'friend-phone-key-0001');
select pg_temp.expect_fail($$select public.play_dice(1000, 5000, 'under', 'reset-dice-000001')$$, 'DEVICE_NOT_APPROVED');

-- 5. Sweep: every SECURITY DEFINER function pins its search_path, none is callable by anon
--    (except check_invite_code, which the signed-out join page needs),
--    and internal helpers are not callable by members either.
do $$
declare bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  if bad is not null then raise exception 'SECURITY DEFINER without search_path: %', bad; end if;

  select string_agg(p.oid::regprocedure::text, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
    and p.proname <> 'check_invite_code';
  if bad is not null then raise exception 'callable by anon: %', bad; end if;

  select string_agg(p.oid::regprocedure::text, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
    and p.proname in ('seed_key', 'seed_seal', 'seed_plain', 'ensure_seed_pair', 'take_nonce', 'round_rate_check',
                      'post_instant_round', 'post_round_start', 'post_round_end', 'round_replay', 'require_owner',
                      'require_profile', 'request_ip', 'mines_advance', 'crash_advance',
                      'reserve_invite_code', 'finish_invite_code', 'invite_code_hash');
  if bad is not null then raise exception 'internal helper callable by members: %', bad; end if;
end $$;

do $$ begin raise notice 'security_test: all checks passed'; end $$;
rollback;
