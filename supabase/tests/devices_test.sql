-- Behavioural checks for device identity and limits (spec appendix ط).
\set QUIET on
begin;
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2'),
  ('00000000-0000-0000-0000-0000000000c3');

-- Signs in as uid on a given session, without registering a device.
create function pg_temp.session(uid text, sess text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'session_id', sess)::text, true);
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

create function pg_temp.reg(key text) returns text language sql as
$$ select public.register_device(key, 'Chrome · Windows', 'test-agent') ->> 'status' $$;

-- Owner joins on laptop; friend joins on phone.
select pg_temp.session('00000000-0000-0000-0000-0000000000a1', 'owner-1');
select public.complete_join('ward', true, true);
do $$ begin perform public.claim_ownership(); end $$;
do $$ begin
  if pg_temp.reg('owner-laptop-key-0001') <> 'approved' then raise exception 'owner device must be approved'; end if;
end $$;

select pg_temp.session('00000000-0000-0000-0000-0000000000b2', 'friend-1');
select public.complete_join('friend', true, true);
select pg_temp.expect_fail($$select public.my_seed_state()$$, 'DEVICE_UNKNOWN');
select pg_temp.expect_fail($$select public.register_device('short', '')$$, 'BAD_DEVICE_KEY');
do $$ begin
  if pg_temp.reg('friend-phone-key-0001') <> 'approved' then raise exception 'first device must be approved'; end if;
  perform public.my_seed_state();   -- allowed now
  -- the same device again in the same session keeps its status
  if pg_temp.reg('friend-phone-key-0001') <> 'approved' then raise exception 'repeat register changed status'; end if;
end $$;

-- Second device: waits for the owner and cannot play.
select pg_temp.session('00000000-0000-0000-0000-0000000000b2', 'friend-2');
do $$ begin
  if pg_temp.reg('friend-tablet-key-001') <> 'pending' then raise exception 'second device must wait'; end if;
end $$;
select pg_temp.expect_fail($$select public.my_seed_state()$$, 'DEVICE_NOT_APPROVED');
select pg_temp.expect_fail($$select public.play_dice(1000, 5000, 'under', 'device-key-0001')$$, 'DEVICE_NOT_APPROVED');
select pg_temp.expect_fail($$select public.device_overview()$$, 'OWNER_ONLY');
select pg_temp.expect_fail($$select public.set_device_status(1, 'approved')$$, 'OWNER_ONLY');

-- The first session still plays.
select pg_temp.session('00000000-0000-0000-0000-0000000000b2', 'friend-1');
do $$ begin perform public.my_seed_state(); end $$;

-- A third member signs in on the friend's phone: shared-device alert.
select pg_temp.session('00000000-0000-0000-0000-0000000000c3', 'third-1');
select public.complete_join('third', true, true);
do $$ begin
  if pg_temp.reg('friend-phone-key-0001') <> 'approved' then raise exception 'own first device'; end if;
end $$;

-- Owner view and decisions.
select pg_temp.session('00000000-0000-0000-0000-0000000000a1', 'owner-2');
do $$
declare
  v jsonb;
  v_tablet bigint;
  v_phone bigint;
begin
  if pg_temp.reg('owner-phone-key-00001') <> 'approved' then raise exception 'owner devices are always approved'; end if;
  perform public.my_seed_state();
  v := public.device_overview();
  if (v ->> 'max_devices')::int <> 2 then raise exception 'default limit is 2'; end if;
  if jsonb_array_length(v -> 'devices') <> 5 then raise exception 'expected 5 devices, got %', v -> 'devices'; end if;
  if (v -> 'devices' -> 0 ->> 'status') <> 'pending' then raise exception 'pending devices come first'; end if;
  select (d ->> 'id')::bigint into v_tablet from jsonb_array_elements(v -> 'devices') d
   where d ->> 'display_name' = 'friend' and d ->> 'status' = 'pending';
  select (d ->> 'id')::bigint into v_phone from jsonb_array_elements(v -> 'devices') d
   where d ->> 'display_name' = 'friend' and d ->> 'status' = 'approved';
  if not exists (select 1 from jsonb_array_elements(v -> 'devices') d
                  where d ->> 'display_name' = 'friend' and d -> 'shared_with' ? 'third') then
    raise exception 'shared device not flagged';
  end if;
  if exists (select 1 from jsonb_array_elements(v -> 'devices') d
              where d ->> 'display_name' = 'friend' and d ->> 'status' = 'pending'
                and jsonb_array_length(d -> 'shared_with') > 0) then
    raise exception 'tablet is not shared';
  end if;

  -- limit 1: approving the tablet is refused while the phone is approved
  perform public.set_max_devices(1);
  begin
    perform public.set_device_status(v_tablet, 'approved');
    raise exception 'limit not enforced';
  exception when others then
    if sqlerrm <> 'DEVICE_LIMIT' then raise; end if;
  end;
  perform public.set_max_devices(2);
  perform public.set_device_status(v_tablet, 'approved');
  perform public.set_device_status(v_phone, 'blocked');
  if (select count(*) from public.admin_audit_logs where action in ('set_device_status', 'set_max_devices')) <> 4 then
    raise exception 'owner decisions must be audited';
  end if;
end $$;
select pg_temp.expect_fail($$select public.set_max_devices(0)$$, 'MAX_DEVICES_OUT_OF_RANGE');
select pg_temp.expect_fail($$select public.set_max_devices(11)$$, 'MAX_DEVICES_OUT_OF_RANGE');
select pg_temp.expect_fail($$select public.set_device_status((select id from public.devices where device_hash = encode(sha256(convert_to('owner-phone-key-00001', 'UTF8')), 'hex')), 'blocked')$$, 'OWNER_DEVICE');

-- The tablet session now plays; the blocked phone does not, even after registering again.
select pg_temp.session('00000000-0000-0000-0000-0000000000b2', 'friend-2');
do $$ begin perform public.my_seed_state(); end $$;
select pg_temp.session('00000000-0000-0000-0000-0000000000b2', 'friend-1');
do $$ begin
  if pg_temp.reg('friend-phone-key-0001') <> 'blocked' then raise exception 'blocked must stay blocked'; end if;
end $$;
select pg_temp.expect_fail($$select public.my_seed_state()$$, 'DEVICE_BLOCKED');

-- A removed device asks again on its next sign-in.
select pg_temp.session('00000000-0000-0000-0000-0000000000a1', 'owner-2');
do $$ begin
  perform public.set_device_status((select id from public.devices d join public.profiles p using (user_id)
                                     where p.display_name = 'friend' and d.status = 'approved'), 'removed');
end $$;
select pg_temp.session('00000000-0000-0000-0000-0000000000b2', 'friend-3');
do $$ begin
  if pg_temp.reg('friend-tablet-key-001') <> 'pending' then raise exception 'removed device must ask again'; end if;
end $$;

-- Members see only their own devices; no session row of anyone is readable to them.
set local role authenticated;
do $$ begin
  if (select count(*) from public.devices) <> 2 then raise exception 'member must see only own devices'; end if;
  if exists (select 1 from public.device_sessions) then raise exception 'sessions are owner-only'; end if;
end $$;
reset role;

do $$ begin raise notice 'devices_test: all checks passed'; end $$;
rollback;
