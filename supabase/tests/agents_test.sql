-- Agents who hand out free points (spec appendix س).
\set QUIET on
begin;
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),   -- owner
  ('00000000-0000-0000-0000-0000000000b1'),   -- master agent
  ('00000000-0000-0000-0000-0000000000c1'),   -- sub-agent
  ('00000000-0000-0000-0000-0000000000d1'),   -- player
  ('00000000-0000-0000-0000-0000000000d2');   -- player

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

create function pg_temp.no(uid text) returns bigint language sql as $$
  select player_no from public.profiles where user_id = uid::uuid $$;
create function pg_temp.avail(uid text) returns bigint language sql as $$
  select available from public.wallet_accounts where user_id = uid::uuid $$;
create function pg_temp.allow(uid text) returns bigint language sql as $$
  select allowance from public.agents where user_id = uid::uuid $$;

select pg_temp.session('00000000-0000-0000-0000-0000000000a1', 'o1', 'owner-laptop-key-0001');
select public.complete_join('ward', true, true);
do $$ begin perform public.claim_ownership(); end $$;
select pg_temp.session('00000000-0000-0000-0000-0000000000b1', 'b1', 'master-phone-key-0001');
select public.complete_join('master', true, true);
select pg_temp.session('00000000-0000-0000-0000-0000000000c1', 'c1', 'sub-phone-key-00001');
select public.complete_join('sub', true, true);
select pg_temp.session('00000000-0000-0000-0000-0000000000d1', 'd1', 'player-one-key-0001');
select public.complete_join('player one', true, true);
select pg_temp.session('00000000-0000-0000-0000-0000000000d2', 'd2', 'player-two-key-0001');
select public.complete_join('player two', true, true);

-- Every member has a distinct short player number.
do $$ begin
  if (select count(distinct player_no) from public.profiles) <> 5 or (select min(player_no) from public.profiles) < 1001 then
    raise exception 'player numbers';
  end if;
end $$;

-- ---------- owner creates a master agent and grants an allowance ----------
select pg_temp.session('00000000-0000-0000-0000-0000000000a1', 'o1', 'owner-laptop-key-0001');
select public.owner_add_agent(pg_temp.no('00000000-0000-0000-0000-0000000000b1'), null, 'صديق من الجامعة');
select pg_temp.expect_fail(format('select public.owner_add_agent(%s)', pg_temp.no('00000000-0000-0000-0000-0000000000b1')), 'ALREADY_AGENT');
select pg_temp.expect_fail(format('select public.owner_add_agent(%s)', pg_temp.no('00000000-0000-0000-0000-0000000000a1')), 'OWNER_ACCOUNT');
select pg_temp.expect_fail('select public.owner_add_agent(999999)', 'PLAYER_NOT_FOUND');
select pg_temp.expect_fail($$select public.owner_add_agent(1001, '00000000-0000-0000-0000-0000000000d1')$$, 'NOT_MASTER');

do $$
declare v jsonb;
begin
  v := public.owner_grant_allowance('00000000-0000-0000-0000-0000000000b1', 500000, 'grant-key-0001', 'حصة الأسبوع');
  if (v ->> 'to_after')::bigint <> 500000 or (v ->> 'duplicate')::boolean then raise exception 'grant %', v; end if;
  if v ->> 'ref' !~ '^RZ-[0-9A-F]{10}$' then raise exception 'ref %', v; end if;
  -- the same request again changes nothing
  v := public.owner_grant_allowance('00000000-0000-0000-0000-0000000000b1', 500000, 'grant-key-0001');
  if not (v ->> 'duplicate')::boolean then raise exception 'replay %', v; end if;
  if pg_temp.allow('00000000-0000-0000-0000-0000000000b1') <> 500000 then raise exception 'double grant'; end if;
end $$;
select pg_temp.expect_fail($$select public.owner_grant_allowance('00000000-0000-0000-0000-0000000000b1', 100000, 'grant-key-0001')$$, 'KEY_REUSED');
select pg_temp.expect_fail($$select public.owner_grant_allowance('00000000-0000-0000-0000-0000000000b1', 150, 'grant-key-0002')$$, 'BAD_AMOUNT');
select pg_temp.expect_fail($$select public.owner_grant_allowance('00000000-0000-0000-0000-0000000000b1', -100, 'grant-key-0003')$$, 'BAD_AMOUNT');
select pg_temp.expect_fail($$select public.owner_grant_allowance('00000000-0000-0000-0000-0000000000b1', 100, 'short')$$, 'BAD_KEY');
select pg_temp.expect_fail($$select public.owner_grant_allowance('00000000-0000-0000-0000-0000000000d1', 100, 'grant-key-0004')$$, 'NOT_AGENT');

-- Owner powers need two-factor; members cannot use them.
select pg_temp.session('00000000-0000-0000-0000-0000000000a1', 'o2', 'owner-laptop-key-0001', 'aal1');
select pg_temp.expect_fail($$select public.owner_grant_allowance('00000000-0000-0000-0000-0000000000b1', 100, 'grant-key-0005')$$, 'OWNER_ONLY');
select pg_temp.expect_fail($$select public.agent_overview()$$, 'OWNER_ONLY');
select pg_temp.session('00000000-0000-0000-0000-0000000000b1', 'b1', 'master-phone-key-0001');
select pg_temp.expect_fail($$select public.owner_grant_allowance('00000000-0000-0000-0000-0000000000b1', 100, 'grant-key-0006')$$, 'OWNER_ONLY');
select pg_temp.expect_fail(format('select public.owner_add_agent(%s)', pg_temp.no('00000000-0000-0000-0000-0000000000d1')), 'OWNER_ONLY');

-- ---------- master sends to a player ----------
do $$
declare v jsonb;
begin
  v := public.agent_find_player(pg_temp.no('00000000-0000-0000-0000-0000000000d1'));
  if v ->> 'display_name' <> 'player one' or (v ->> 'is_me')::boolean then raise exception 'find %', v; end if;
  v := public.agent_send(pg_temp.no('00000000-0000-0000-0000-0000000000d1'), 100000, 'send-key-0001', 'أهلاً');
  if (v ->> 'allowance')::bigint <> 400000 or (v ->> 'to_after')::bigint <> 200000 then raise exception 'send %', v; end if;
  if pg_temp.avail('00000000-0000-0000-0000-0000000000d1') <> 200000 then raise exception 'wallet'; end if;
  -- double tap: same key, nothing moves twice
  v := public.agent_send(pg_temp.no('00000000-0000-0000-0000-0000000000d1'), 100000, 'send-key-0001');
  if not (v ->> 'duplicate')::boolean or pg_temp.avail('00000000-0000-0000-0000-0000000000d1') <> 200000
     or pg_temp.allow('00000000-0000-0000-0000-0000000000b1') <> 400000 then
    raise exception 'double send %', v;
  end if;
  if not exists (select 1 from public.wallet_ledger where user_id = '00000000-0000-0000-0000-0000000000d1'
                   and type = 'AGENT_GIFT' and amount = 100000 and actor_id = '00000000-0000-0000-0000-0000000000b1'
                   and reason like 'هدية من الوكيل master · RZ-%') then
    raise exception 'ledger row';
  end if;
end $$;
select pg_temp.expect_fail(format('select public.agent_send(%s, 100000, %L)', pg_temp.no('00000000-0000-0000-0000-0000000000d2'), 'send-key-0001'), 'KEY_REUSED');
select pg_temp.expect_fail(format('select public.agent_send(%s, 100, %L)', pg_temp.no('00000000-0000-0000-0000-0000000000b1'), 'send-key-0002'), 'SELF_SEND');
select pg_temp.expect_fail(format('select public.agent_send(%s, 400100, %L)', pg_temp.no('00000000-0000-0000-0000-0000000000d1'), 'send-key-0003'), 'ALLOWANCE_LOW');
select pg_temp.expect_fail(format('select public.agent_send(%s, 50, %L)', pg_temp.no('00000000-0000-0000-0000-0000000000d1'), 'send-key-0004'), 'BAD_AMOUNT');
select pg_temp.expect_fail('select public.agent_send(999999, 100, ''send-key-0005'')', 'PLAYER_NOT_FOUND');

-- ---------- sub-agents ----------
select public.agent_add_sub(pg_temp.no('00000000-0000-0000-0000-0000000000c1'), 'ابن عمي');
select pg_temp.expect_fail(format('select public.agent_add_sub(%s)', pg_temp.no('00000000-0000-0000-0000-0000000000a1')), 'OWNER_ACCOUNT');
select public.agent_pass('00000000-0000-0000-0000-0000000000c1', 100000, 'pass-key-0001');
select pg_temp.expect_fail($$select public.agent_pass('00000000-0000-0000-0000-0000000000d1', 100, 'pass-key-0002')$$, 'NOT_YOUR_SUB');
select pg_temp.expect_fail($$select public.agent_pass('00000000-0000-0000-0000-0000000000c1', 300100, 'pass-key-0003')$$, 'ALLOWANCE_LOW');
do $$
declare v jsonb := public.agent_dashboard();
begin
  if v ->> 'tier' <> 'master' or (v ->> 'allowance')::bigint <> 300000 or jsonb_array_length(v -> 'subs') <> 1
     or (v ->> 'gifted_total')::bigint <> 100000 or (v ->> 'players')::int <> 1 then
    raise exception 'master dashboard %', v;
  end if;
end $$;

select pg_temp.session('00000000-0000-0000-0000-0000000000c1', 'c1', 'sub-phone-key-00001');
select public.agent_send(pg_temp.no('00000000-0000-0000-0000-0000000000d2'), 50000, 'sub-send-0001');
select pg_temp.expect_fail(format('select public.agent_add_sub(%s)', pg_temp.no('00000000-0000-0000-0000-0000000000d1')), 'MASTER_ONLY');
select pg_temp.expect_fail($$select public.agent_pass('00000000-0000-0000-0000-0000000000d1', 100, 'sub-pass-0001')$$, 'NOT_YOUR_SUB');
select pg_temp.expect_fail($$select public.set_agent_status('00000000-0000-0000-0000-0000000000b1', 'frozen')$$, 'NOT_YOUR_SUB');
do $$
declare v jsonb := public.agent_dashboard();
begin
  if v ->> 'tier' <> 'sub' or v ->> 'parent_name' <> 'master' or (v ->> 'allowance')::bigint <> 50000
     or jsonb_array_length(v -> 'transfers') <> 2 then
    raise exception 'sub dashboard %', v;
  end if;
  if pg_temp.avail('00000000-0000-0000-0000-0000000000d2') <> 150000 then raise exception 'p2 wallet'; end if;
end $$;

-- A player who is not an agent has no panel and cannot send.
select pg_temp.session('00000000-0000-0000-0000-0000000000d1', 'd1', 'player-one-key-0001');
do $$ begin if public.agent_dashboard() is not null then raise exception 'player dashboard'; end if; end $$;
select pg_temp.expect_fail(format('select public.agent_send(%s, 100, %L)', pg_temp.no('00000000-0000-0000-0000-0000000000d2'), 'p-send-0001'), 'NOT_AGENT');
select pg_temp.expect_fail('select public.agent_find_player(1001)', 'NOT_AGENT');
select pg_temp.expect_fail($$select public.set_agent_status('00000000-0000-0000-0000-0000000000c1', 'frozen')$$, 'NOT_AGENT');

-- ---------- master freezes the sub, then takes the rest back ----------
select pg_temp.session('00000000-0000-0000-0000-0000000000b1', 'b1', 'master-phone-key-0001');
select public.set_agent_status('00000000-0000-0000-0000-0000000000c1', 'frozen');
select pg_temp.expect_fail($$select public.set_agent_status('00000000-0000-0000-0000-0000000000c1', 'closed')$$, 'OWNER_ONLY');
select pg_temp.expect_fail($$select public.agent_pass('00000000-0000-0000-0000-0000000000c1', 100, 'pass-key-0004')$$, 'AGENT_FROZEN');
select pg_temp.session('00000000-0000-0000-0000-0000000000c1', 'c1', 'sub-phone-key-00001');
select pg_temp.expect_fail(format('select public.agent_send(%s, 100, %L)', pg_temp.no('00000000-0000-0000-0000-0000000000d2'), 'sub-send-0002'), 'AGENT_FROZEN');
select pg_temp.session('00000000-0000-0000-0000-0000000000b1', 'b1', 'master-phone-key-0001');
do $$
declare v jsonb := public.agent_reclaim('00000000-0000-0000-0000-0000000000c1', null, 'reclaim-key-0001');
begin
  if (v ->> 'amount')::bigint <> 50000 or (v ->> 'allowance')::bigint <> 350000
     or pg_temp.allow('00000000-0000-0000-0000-0000000000c1') <> 0 then raise exception 'reclaim %', v; end if;
end $$;
select pg_temp.expect_fail($$select public.agent_reclaim('00000000-0000-0000-0000-0000000000c1', null, 'reclaim-key-0002')$$, 'NOTHING_TO_RECLAIM');
select public.set_agent_status('00000000-0000-0000-0000-0000000000c1', 'active');
select public.agent_pass('00000000-0000-0000-0000-0000000000c1', 10000, 'pass-key-0005');

-- ---------- rate limit: at most 30 movements a minute per agent ----------
do $$
declare i int; n int := 0;
begin
  for i in 1..40 loop
    begin
      perform public.agent_send(pg_temp.no('00000000-0000-0000-0000-0000000000d1'), 100, 'burst-key-' || lpad(i::text, 4, '0'));
      n := n + 1;
    exception when others then
      if sqlerrm <> 'RATE_LIMITED' then raise; end if;
      exit;
    end;
  end loop;
  if (select count(*) from public.agent_transfers where actor_id = '00000000-0000-0000-0000-0000000000b1') <> 30 then
    raise exception 'rate limit after % sends', n;
  end if;
end $$;

-- ---------- owner freezes the master: master and sub both stop ----------
select pg_temp.session('00000000-0000-0000-0000-0000000000a1', 'o1', 'owner-laptop-key-0001');
select public.set_agent_status('00000000-0000-0000-0000-0000000000b1', 'frozen', 'مراجعة');
select pg_temp.session('00000000-0000-0000-0000-0000000000c1', 'c1', 'sub-phone-key-00001');
select pg_temp.expect_fail(format('select public.agent_send(%s, 100, %L)', pg_temp.no('00000000-0000-0000-0000-0000000000d2'), 'sub-send-0003'), 'AGENT_FROZEN');
do $$ begin if (public.agent_dashboard() ->> 'parent_active')::boolean then raise exception 'parent_active'; end if; end $$;

-- Owner takes back part of the master's allowance, then closes both agents.
select pg_temp.session('00000000-0000-0000-0000-0000000000a1', 'o1', 'owner-laptop-key-0001');
select public.owner_revoke_allowance('00000000-0000-0000-0000-0000000000b1', 100000, 'revoke-key-0001', 'تخفيض');
select pg_temp.expect_fail($$select public.set_agent_status('00000000-0000-0000-0000-0000000000b1', 'closed')$$, 'HAS_SUBS');
select public.set_agent_status('00000000-0000-0000-0000-0000000000c1', 'closed');
do $$
declare v jsonb;
begin
  v := public.agent_overview();
  if jsonb_array_length(v -> 'agents') <> 2 or (v -> 'totals' ->> 'granted')::bigint <> 500000
     or (v -> 'totals' ->> 'players')::int <> 2 then
    raise exception 'overview %', v -> 'totals';
  end if;
  if (v -> 'totals' ->> 'granted')::bigint - (v -> 'totals' ->> 'revoked')::bigint - (v -> 'totals' ->> 'gifted')::bigint
     <> (v ->> 'outstanding')::bigint then
    raise exception 'points do not add up %', v;
  end if;
end $$;
select public.set_agent_status('00000000-0000-0000-0000-0000000000b1', 'closed');
do $$ begin
  if pg_temp.allow('00000000-0000-0000-0000-0000000000b1') <> 0 or pg_temp.allow('00000000-0000-0000-0000-0000000000c1') <> 0 then
    raise exception 'closing keeps allowance';
  end if;
end $$;
select pg_temp.expect_fail($$select public.set_agent_status('00000000-0000-0000-0000-0000000000b1', 'active')$$, 'AGENT_CLOSED');
select pg_temp.session('00000000-0000-0000-0000-0000000000b1', 'b1', 'master-phone-key-0001');
do $$ begin if public.agent_dashboard() is not null then raise exception 'closed dashboard'; end if; end $$;
select pg_temp.expect_fail('select public.agent_find_player(1001)', 'NOT_AGENT');

-- A closed agent can be named again.
select pg_temp.session('00000000-0000-0000-0000-0000000000a1', 'o1', 'owner-laptop-key-0001');
select public.owner_add_agent(pg_temp.no('00000000-0000-0000-0000-0000000000b1'));

-- ---------- books balance; logs cannot be changed; internals are closed to members ----------
do $$ begin
  if exists (select 1 from public.agent_allowance_violations()) then raise exception 'allowance books'; end if;
  if exists (select 1 from public.wallet_invariant_violations()) then raise exception 'wallet books'; end if;
  if (select count(*) from public.admin_audit_logs where action in ('add_agent', 'set_agent_status')) < 6 then
    raise exception 'audit';
  end if;
end $$;
select pg_temp.expect_fail($$update public.agent_transfers set amount = 1$$, 'agent_transfers is append-only');
select pg_temp.expect_fail($$delete from public.agents$$, 'agents is append-only');

set local role authenticated;
select pg_temp.session('00000000-0000-0000-0000-0000000000d1', 'd1', 'player-one-key-0001');
select pg_temp.expect_fail($$select count(*) from public.agent_transfers$$, 'permission denied for table agent_transfers');
select pg_temp.expect_fail($$select public.require_agent(true)$$, 'permission denied for function require_agent');
select pg_temp.expect_fail($$select public.agent_post('GIFT', null, null, null, null, 100, 0, 0, null, 'xxxxxxxx')$$,
                           'permission denied for function agent_post');
select pg_temp.expect_fail($$update public.agents set allowance = 999999$$, 'permission denied for table agents');
do $$ begin
  if (select count(*) from public.agents) <> 0 then raise exception 'player sees other agents'; end if;
end $$;
reset role;
set local role anon;
select pg_temp.expect_fail($$select public.agent_dashboard()$$, 'permission denied for function agent_dashboard');
reset role;

do $$ begin raise notice 'agents_test: all checks passed'; end $$;
rollback;
