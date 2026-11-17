-- Invite links shared by the owner (spec appendix ن).
\set QUIET on
begin;
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2'),
  ('00000000-0000-0000-0000-0000000000c3');

create function pg_temp.session(uid text, sess text, dev text, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'session_id', sess, 'aal', aal)::text, true);
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

create temp table codes (k text primary key, code text, id bigint);
grant all on codes to authenticated, anon, service_role;

select pg_temp.session('00000000-0000-0000-0000-0000000000a1', 'o1', 'owner-laptop-key-0001');
select public.complete_join('ward', true, true);
do $$ begin perform public.claim_ownership(); end $$;

-- Owner creates links; the code is returned once and only its hash is stored.
do $$
declare v jsonb;
begin
  v := public.create_invite_link('لسامر', 7);
  if length(v ->> 'code') <> 16 or (v ->> 'code') !~ '^[A-Za-z0-9_-]+$' then raise exception 'bad code %', v; end if;
  insert into codes values ('a', v ->> 'code', (v ->> 'id')::bigint);
  v := public.create_invite_link(null, 1);
  insert into codes values ('b', v ->> 'code', (v ->> 'id')::bigint);
  if exists (select 1 from public.invite_links where code_hash = (select code from codes where k = 'a')) then
    raise exception 'code stored in plain text';
  end if;
  if jsonb_array_length(public.list_invite_links()) <> 2 then raise exception 'list'; end if;
end $$;
select pg_temp.expect_fail($$select public.create_invite_link(null, 0)$$, 'BAD_DAYS');
select pg_temp.expect_fail($$select public.create_invite_link(null, 31)$$, 'BAD_DAYS');

-- Without two-factor, or as a member, the owner functions are refused.
select pg_temp.session('00000000-0000-0000-0000-0000000000a1', 'o2', 'owner-laptop-key-0001', 'aal1');
select pg_temp.expect_fail($$select public.create_invite_link(null, 7)$$, 'OWNER_ONLY');
select pg_temp.session('00000000-0000-0000-0000-0000000000b2', 'b1', 'friend-phone-key-0001');
select public.complete_join('friend', true, true);
select pg_temp.expect_fail($$select public.list_invite_links()$$, 'OWNER_ONLY');
select pg_temp.expect_fail($$select public.revoke_invite_link(1)$$, 'OWNER_ONLY');

-- Anyone can check a code; members and visitors cannot reserve one or read the table.
set local role anon;
do $$ begin
  if not public.check_invite_code((select code from codes where k = 'a')) then raise exception 'code a should be good'; end if;
  if public.check_invite_code('not-a-real-code-00') then raise exception 'bad code accepted'; end if;
end $$;
select pg_temp.expect_fail($$select public.reserve_invite_code('x')$$, 'permission denied for function reserve_invite_code');
select pg_temp.expect_fail($$select count(*) from public.invite_links$$, 'permission denied for table invite_links');
reset role;
set local role authenticated;
select pg_temp.expect_fail($$select public.finish_invite_code(1, null)$$, 'permission denied for function finish_invite_code');
reset role;

-- The join function (service role): reserve, fail and release, then reserve again and finish. One use only.
set local role service_role;
do $$
declare v_id bigint;
begin
  v_id := public.reserve_invite_code((select code from codes where k = 'a'));
  if v_id <> (select id from codes where k = 'a') then raise exception 'wrong link'; end if;
  begin
    perform public.reserve_invite_code((select code from codes where k = 'a'));
    raise exception 'double reserve';
  exception when others then if sqlerrm <> 'INVITE_INVALID' then raise; end if;
  end;
  perform public.finish_invite_code(v_id, null);            -- account creation failed: release
  v_id := public.reserve_invite_code((select code from codes where k = 'a'));
  perform public.finish_invite_code(v_id, '00000000-0000-0000-0000-0000000000c3');
end $$;
select pg_temp.expect_fail($$select public.reserve_invite_code((select code from codes where k = 'a'))$$, 'INVITE_INVALID');
reset role;

-- Owner revokes the second link; it can no longer be used.
select pg_temp.session('00000000-0000-0000-0000-0000000000a1', 'o1', 'owner-laptop-key-0001');
select public.revoke_invite_link((select id from codes where k = 'b'));
select pg_temp.expect_fail($$select public.revoke_invite_link((select id from codes where k = 'b'))$$, 'LINK_NOT_OPEN');
do $$
declare v jsonb := public.list_invite_links();
begin
  if not public.check_invite_code((select code from codes where k = 'b')) is false then raise exception 'revoked still good'; end if;
  if not exists (select 1 from jsonb_array_elements(v) e where e ->> 'status' = 'used') then raise exception 'used status'; end if;
  if not exists (select 1 from jsonb_array_elements(v) e where e ->> 'status' = 'revoked') then raise exception 'revoked status'; end if;
  if (select count(*) from public.admin_audit_logs where action in ('create_invite_link', 'revoke_invite_link')) <> 3 then
    raise exception 'audit';
  end if;
end $$;

-- Expired links are refused.
update public.invite_links set expires_at = now() - interval '1 second', used_at = null, used_by = null, reserved_at = null
 where id = (select id from codes where k = 'a');
set local role service_role;
select pg_temp.expect_fail($$select public.reserve_invite_code((select code from codes where k = 'a'))$$, 'INVITE_INVALID');
reset role;

do $$ begin raise notice 'invite_links_test: all checks passed'; end $$;
rollback;
