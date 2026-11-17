-- Agents do not play; an agent may cancel a mistaken gift within 10 minutes (spec appendix س).
\set QUIET on
begin;
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),   -- owner
  ('00000000-0000-0000-0000-0000000000b1'),   -- agent
  ('00000000-0000-0000-0000-0000000000b2'),   -- second agent
  ('00000000-0000-0000-0000-0000000000d1'),   -- player
  ('00000000-0000-0000-0000-0000000000d2');   -- player

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'session_id', 'sess-' || uid, 'aal', 'aal2')::text, true);
  insert into public.site_settings (key, value) values ('round_rate_limit', '1000000')
  on conflict (key) do update set value = excluded.value;
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

create function pg_temp.no(uid text) returns bigint language sql as $$
  select player_no from public.profiles where user_id = uid::uuid $$;
create function pg_temp.avail(uid text) returns bigint language sql as $$
  select available from public.wallet_accounts where user_id = uid::uuid $$;
create function pg_temp.allow(uid text) returns bigint language sql as $$
  select allowance from public.agents where user_id = uid::uuid $$;
create temp table refs (k text primary key, ref text);

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.complete_join('ward', true, true);
do $$ begin perform public.claim_ownership(); end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select public.complete_join('agent', true, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select public.complete_join('agent two', true, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select public.complete_join('player one', true, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select public.complete_join('player two', true, true);

-- Before becoming an agent, the member can play.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select public.play_dice(1000, 5000, 'under', 'before-agent-0001');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.owner_add_agent(pg_temp.no('00000000-0000-0000-0000-0000000000b1'));
select public.owner_add_agent(pg_temp.no('00000000-0000-0000-0000-0000000000b2'));
select public.owner_grant_allowance('00000000-0000-0000-0000-0000000000b1', 100000, 'grant-key-0001');

-- ---------- agents do not play ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect_fail($$select public.play_dice(1000, 5000, 'under', 'agent-dice-0001')$$, 'AGENT_NO_PLAY');
select pg_temp.expect_fail($$select public.play_roulette('[{"kind":"red","amount":1000}]'::jsonb, 'agent-roul-0001')$$, 'AGENT_NO_PLAY');
select pg_temp.expect_fail($$select public.claim_daily_bonus()$$, 'AGENT_NO_PLAY');
-- and receive no gifts
select pg_temp.expect_fail(format('select public.agent_send(%s, 100, %L)', pg_temp.no('00000000-0000-0000-0000-0000000000b2'), 'to-agent-0001'), 'PLAYER_IS_AGENT');

-- ---------- cancel a mistaken gift ----------
do $$
declare v jsonb;
begin
  v := public.agent_send(pg_temp.no('00000000-0000-0000-0000-0000000000d1'), 20000, 'gift-key-0001');
  insert into refs values ('a', v ->> 'ref');
  v := public.agent_send(pg_temp.no('00000000-0000-0000-0000-0000000000d2'), 10000, 'gift-key-0002');
  insert into refs values ('b', v ->> 'ref');
  if pg_temp.avail('00000000-0000-0000-0000-0000000000d1') <> 120000 then raise exception 'gift'; end if;

  v := public.agent_cancel_gift(lower((select ref from refs where k = 'a')));
  if v ->> 'kind' <> 'CANCEL' or (v ->> 'allowance')::bigint <> 90000 then raise exception 'cancel %', v; end if;
  if pg_temp.avail('00000000-0000-0000-0000-0000000000d1') <> 100000 then raise exception 'wallet after cancel'; end if;
  if not exists (select 1 from public.wallet_ledger where user_id = '00000000-0000-0000-0000-0000000000d1'
                   and type = 'REVERSAL' and amount = -20000 and reverses_id is not null) then
    raise exception 'reversal row';
  end if;
  -- again: nothing moves twice
  v := public.agent_cancel_gift((select ref from refs where k = 'a'));
  if not (v ->> 'duplicate')::boolean or pg_temp.avail('00000000-0000-0000-0000-0000000000d1') <> 100000 then
    raise exception 'double cancel %', v;
  end if;
  v := public.agent_dashboard();
  if (v ->> 'gifted_total')::bigint <> 10000 then raise exception 'net gifted %', v ->> 'gifted_total'; end if;
end $$;
select pg_temp.expect_fail($$select public.agent_cancel_gift('RZ-0000000000')$$, 'GIFT_NOT_FOUND');

-- The player played after the gift: it cannot be cancelled.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select public.play_dice(1000, 5000, 'under', 'player-dice-0001');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect_fail($$select public.agent_cancel_gift((select ref from refs where k = 'b'))$$, 'POINTS_USED');

-- Another agent cannot cancel it.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.owner_grant_allowance('00000000-0000-0000-0000-0000000000b2', 100000, 'grant-key-0002');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.expect_fail($$select public.agent_cancel_gift((select ref from refs where k = 'b'))$$, 'GIFT_NOT_FOUND');

-- After 10 minutes it is too late.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
do $$ declare v jsonb := public.agent_send(pg_temp.no('00000000-0000-0000-0000-0000000000d1'), 5000, 'gift-key-0003');
begin insert into refs values ('c', v ->> 'ref'); end $$;
alter table public.agent_transfers disable trigger agent_transfers_append_only;
update public.agent_transfers set created_at = now() - interval '11 minutes' where ref = (select ref from refs where k = 'c');
alter table public.agent_transfers enable trigger agent_transfers_append_only;
select pg_temp.expect_fail($$select public.agent_cancel_gift((select ref from refs where k = 'c'))$$, 'CANCEL_TOO_LATE');

-- A closed agent plays again.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.set_agent_status('00000000-0000-0000-0000-0000000000b2', 'closed');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select public.play_dice(1000, 5000, 'under', 'after-close-0001');

-- Books.
do $$
declare v jsonb;
begin
  if exists (select 1 from public.agent_allowance_violations()) then raise exception 'allowance books'; end if;
  if exists (select 1 from public.wallet_invariant_violations()) then raise exception 'wallet books'; end if;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  v := public.agent_overview();
  if (v -> 'totals' ->> 'granted')::bigint - (v -> 'totals' ->> 'revoked')::bigint - (v -> 'totals' ->> 'gifted')::bigint
     + (v -> 'totals' ->> 'cancelled')::bigint <> (v ->> 'outstanding')::bigint then
    raise exception 'points do not add up %', v -> 'totals';
  end if;
  if not exists (select 1 from jsonb_array_elements(v -> 'transfers') e
                  where e ->> 'kind' = 'CANCEL' and e ->> 'from_name' = 'player one' and e ->> 'to_name' = 'agent') then
    raise exception 'cancel row names';
  end if;
end $$;

do $$ begin raise notice 'agents_no_play_test: all checks passed'; end $$;
rollback;
