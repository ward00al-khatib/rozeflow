-- Agents bring in new players with invite links (spec appendix س).
\set QUIET on
begin;
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),   -- owner
  ('00000000-0000-0000-0000-0000000000b1'),   -- agent
  ('00000000-0000-0000-0000-0000000000d1'),   -- player
  ('00000000-0000-0000-0000-0000000000e1');   -- new friend

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
select pg_temp.session('00000000-0000-0000-0000-0000000000b1', 'b1', 'agent-phone-key-00001');
select public.complete_join('agent', true, true);
select pg_temp.session('00000000-0000-0000-0000-0000000000d1', 'd1', 'player-one-key-0001');
select public.complete_join('player', true, true);

-- A member who is not an agent cannot make links.
select pg_temp.expect_fail($$select public.agent_create_invite_link(null, 3)$$, 'NOT_AGENT');
select pg_temp.expect_fail($$select public.agent_list_invite_links()$$, 'NOT_AGENT');

select pg_temp.session('00000000-0000-0000-0000-0000000000a1', 'o1', 'owner-laptop-key-0001');
select public.owner_add_agent((select player_no from public.profiles where user_id = '00000000-0000-0000-0000-0000000000b1'));

-- The agent makes links; days 1..7; at most 10 open.
select pg_temp.session('00000000-0000-0000-0000-0000000000b1', 'b1', 'agent-phone-key-00001');
do $$
declare v jsonb; i int;
begin
  v := public.agent_create_invite_link('لابن خالي', 3);
  insert into codes values ('a', v ->> 'code', (v ->> 'id')::bigint);
  v := public.agent_create_invite_link(null, 7);
  insert into codes values ('b', v ->> 'code', (v ->> 'id')::bigint);
  for i in 3..10 loop perform public.agent_create_invite_link(null, 1); end loop;
  if jsonb_array_length(public.agent_list_invite_links()) <> 10 then raise exception 'agent list'; end if;
end $$;
select pg_temp.expect_fail($$select public.agent_create_invite_link(null, 1)$$, 'TOO_MANY_LINKS');
select pg_temp.expect_fail($$select public.agent_create_invite_link(null, 8)$$, 'BAD_DAYS');
select public.agent_revoke_invite_link((select id from codes where k = 'b'));
select pg_temp.expect_fail($$select public.agent_revoke_invite_link((select id from codes where k = 'b'))$$, 'LINK_NOT_OPEN');

-- Someone else's link cannot be revoked by the agent.
select pg_temp.session('00000000-0000-0000-0000-0000000000a1', 'o1', 'owner-laptop-key-0001');
do $$ declare v jsonb := public.create_invite_link('owner link', 7);
begin insert into codes values ('o', v ->> 'code', (v ->> 'id')::bigint); end $$;
do $$ declare v jsonb := public.list_invite_links();
begin
  if not exists (select 1 from jsonb_array_elements(v) e where (e ->> 'by_agent')::boolean and e ->> 'created_by_name' = 'agent') then
    raise exception 'owner list does not show agent links';
  end if;
end $$;
select pg_temp.session('00000000-0000-0000-0000-0000000000b1', 'b1', 'agent-phone-key-00001');
select pg_temp.expect_fail($$select public.agent_revoke_invite_link((select id from codes where k = 'o'))$$, 'LINK_NOT_OPEN');

-- The join function accepts the agent's link once.
do $$ begin
  if not public.check_invite_code((select code from codes where k = 'a')) then raise exception 'agent link should be good'; end if;
end $$;
set local role service_role;
do $$
declare v_id bigint;
begin
  v_id := public.reserve_invite_code((select code from codes where k = 'a'));
  perform public.finish_invite_code(v_id, '00000000-0000-0000-0000-0000000000e1');
end $$;
select pg_temp.expect_fail($$select public.reserve_invite_code((select code from codes where k = 'a'))$$, 'INVITE_INVALID');
reset role;
select pg_temp.session('00000000-0000-0000-0000-0000000000b1', 'b1', 'agent-phone-key-00001');
do $$ begin
  if not exists (select 1 from jsonb_array_elements(public.agent_list_invite_links()) e where e ->> 'status' = 'used') then
    raise exception 'used status';
  end if;
end $$;

-- A frozen agent's open links stop working, and come back when unfrozen.
select pg_temp.session('00000000-0000-0000-0000-0000000000b1', 'b1', 'agent-phone-key-00001');
insert into codes select 'c', (public.agent_create_invite_link(null, 1)) ->> 'code', null;
select pg_temp.session('00000000-0000-0000-0000-0000000000a1', 'o1', 'owner-laptop-key-0001');
select public.set_agent_status('00000000-0000-0000-0000-0000000000b1', 'frozen');
set local role anon;
do $$ begin
  if public.check_invite_code((select code from codes where k = 'c')) then raise exception 'frozen agent link works'; end if;
  if not public.check_invite_code((select code from codes where k = 'o')) then raise exception 'owner link broken'; end if;
end $$;
reset role;
set local role service_role;
select pg_temp.expect_fail($$select public.reserve_invite_code((select code from codes where k = 'c'))$$, 'INVITE_INVALID');
reset role;
select pg_temp.session('00000000-0000-0000-0000-0000000000b1', 'b1', 'agent-phone-key-00001');
select pg_temp.expect_fail($$select public.agent_create_invite_link(null, 1)$$, 'AGENT_FROZEN');
select pg_temp.session('00000000-0000-0000-0000-0000000000a1', 'o1', 'owner-laptop-key-0001');
select public.set_agent_status('00000000-0000-0000-0000-0000000000b1', 'active');
set local role anon;
do $$ begin
  if not public.check_invite_code((select code from codes where k = 'c')) then raise exception 'unfrozen link'; end if;
end $$;
select pg_temp.expect_fail($$select public.agent_create_invite_link(null, 1)$$, 'permission denied for function agent_create_invite_link');
reset role;

do $$ begin raise notice 'agent_invites_test: all checks passed'; end $$;
rollback;
