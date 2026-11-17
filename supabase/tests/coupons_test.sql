-- Advertiser coupons (spec appendix ف): free, one per member, never tied to points.
\set QUIET on
begin;
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),   -- owner
  ('00000000-0000-0000-0000-0000000000b1'),   -- agent
  ('00000000-0000-0000-0000-0000000000d1'),   -- player
  ('00000000-0000-0000-0000-0000000000d2'),   -- player
  ('00000000-0000-0000-0000-0000000000d3');   -- player

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
create function pg_temp.wallets() returns bigint language sql as $$
  select sum(available + reserved)::bigint from public.wallet_accounts $$;
create function pg_temp.ledger_rows() returns bigint language sql as $$
  select count(*) from public.wallet_ledger $$;
create temp table ids (k text primary key, id bigint);
grant all on ids to authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.complete_join('ward', true, true);
do $$ begin perform public.claim_ownership(); end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select public.complete_join('agent', true, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select public.complete_join('player one', true, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select public.complete_join('player two', true, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d3');
select public.complete_join('player three', true, true);

-- This week only d1 and d2 play; d3 does not.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select public.play_dice(1000, 5000, 'under', 'cp-d1-0001');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select public.play_dice(1000, 5000, 'under', 'cp-d2-0001');
select public.play_dice(1000, 5000, 'under', 'cp-d2-0002');

-- ---------- owner sets up an advertiser and coupons ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_fail($$select public.owner_save_advertiser(null, 'Shop', 'http://x.example/logo.png', null)$$, 'URL_NOT_HTTPS');
insert into ids select 'adv', (public.owner_save_advertiser(null, 'متجر الورد', 'https://x.example/logo.png', 'https://x.example')->>'id')::bigint;
select pg_temp.expect_fail($$select public.owner_create_coupon((select id from ids where k='adv'), 'خصم', 'X', 'all', 2, now() - interval '1 day')$$, 'BAD_EXPIRY');
select pg_temp.expect_fail($$select public.owner_create_coupon((select id from ids where k='adv'), 'خصم', 'X', 'some', 2, now() + interval '1 day')$$, 'BAD_AUDIENCE');
insert into ids select 'open', (public.owner_create_coupon((select id from ids where k='adv'), 'خصم 10%', 'ROSE10', 'all', 2, now() + interval '7 days')->>'id')::bigint;
insert into ids select 'prize', (public.owner_create_coupon((select id from ids where k='adv'), 'هدية للمتصدرين', 'TOP-PRIZE', 'award', 5, now() + interval '7 days')->>'id')::bigint;
insert into ids values ('wallets', pg_temp.wallets()), ('ledger', pg_temp.ledger_rows());

-- ---------- members only through functions ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select pg_temp.expect_fail($$select * from public.coupons$$, 'permission denied for table coupons');
select pg_temp.expect_fail($$select public.owner_coupons()$$, 'OWNER_ONLY');
select pg_temp.expect_fail($$select public.owner_create_coupon(1, 'x', 'y', 'all', 1, now() + interval '1 day')$$, 'OWNER_ONLY');
reset role;

-- ---------- a member sees the open coupon without its code, claims it once ----------
do $$
declare v jsonb; o bigint := (select id from ids where k = 'open'); p bigint := (select id from ids where k = 'prize');
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  v := public.my_coupons();
  if jsonb_array_length(v->'available') <> 1 or (v->'available'->0->>'id')::bigint <> o then
    raise exception 'open coupon not listed: %', v; end if;
  if (v->'available'->0) ? 'code' then raise exception 'code shown before claiming'; end if;
  perform pg_temp.expect_fail(format('select public.claim_coupon(%s)', p), 'COUPON_NOT_FOUND');  -- award-only
  v := public.claim_coupon(o);
  if v->>'code' <> 'ROSE10' or (v->>'already')::boolean then raise exception 'claim: %', v; end if;
  v := public.claim_coupon(o);
  if not (v->>'already')::boolean then raise exception 'second claim should be a no-op: %', v; end if;
  v := public.my_coupons();
  if jsonb_array_length(v->'available') <> 0 or v->'mine'->0->>'code' <> 'ROSE10' then raise exception 'after claim: %', v; end if;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
  perform public.claim_coupon(o);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d3');
  if jsonb_array_length(public.my_coupons()->'available') <> 0 then raise exception 'sold-out coupon still listed'; end if;
  perform pg_temp.expect_fail(format('select public.claim_coupon(%s)', o), 'COUPON_SOLD_OUT');
end $$;

-- ---------- agents get no coupons ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.owner_add_agent(pg_temp.no('00000000-0000-0000-0000-0000000000b1'));
do $$
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  if not (public.my_coupons()->>'agent')::boolean then raise exception 'agent flag'; end if;
  perform pg_temp.expect_fail(format('select public.claim_coupon(%s)', (select id from ids where k = 'open')), 'AGENT_NO_COUPONS');
end $$;

-- ---------- owner awards to the weekly top players ----------
do $$
declare v jsonb; p bigint := (select id from ids where k = 'prize'); n int;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  perform pg_temp.expect_fail(format('select public.owner_award_coupon_top(%s, %L, 3)', p, 'previous'), 'NO_PLAYERS');
  v := public.owner_award_coupon_top(p, 'current', 3);
  -- only d1 and d2 played this week; the owner and agents are never ranked
  if jsonb_array_length(v->'given') <> 2 then raise exception 'top award: %', v; end if;
  if exists (select 1 from jsonb_array_elements(v->'given') g where g->>'display_name' in ('ward', 'agent', 'player three')) then
    raise exception 'wrong winners: %', v; end if;
  -- again: everyone already has it, nobody gets a second copy
  v := public.owner_award_coupon_top(p, 'current', 3);
  if jsonb_array_length(v->'given') <> 0 or (v->>'skipped')::int <> 2 then raise exception 'repeat award: %', v; end if;
  -- one player by number
  v := public.owner_award_coupon_player(p, pg_temp.no('00000000-0000-0000-0000-0000000000d3'));
  if v->'given'->0->>'display_name' <> 'player three' then raise exception 'player award: %', v; end if;
  perform pg_temp.expect_fail(format('select public.owner_award_coupon_player(%s, %s)', p, pg_temp.no('00000000-0000-0000-0000-0000000000d3')), 'ALREADY_HAS_COUPON');
  perform pg_temp.expect_fail(format('select public.owner_award_coupon_player(%s, %s)', p, pg_temp.no('00000000-0000-0000-0000-0000000000b1')), 'PLAYER_IS_AGENT');

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d3');
  v := public.my_coupons();
  if not exists (select 1 from jsonb_array_elements(v->'mine') m where m->>'code' = 'TOP-PRIZE' and m->>'source' = 'award') then
    raise exception 'awarded coupon not in mine: %', v; end if;

  -- pausing stops claims and awards
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  perform public.owner_set_coupon_status(p, 'paused');
  perform pg_temp.expect_fail(format('select public.owner_award_coupon_top(%s, %L, 3)', p, 'current'), 'COUPON_PAUSED');

  v := public.owner_coupons();
  select count(*) into n from jsonb_array_elements(v->'coupons') c, jsonb_array_elements(c->'holders');
  if n <> 5 then raise exception 'holders: %', n; end if;
end $$;

-- ---------- coupons never touch points, claims are permanent ----------
do $$
begin
  if pg_temp.wallets() <> (select id from ids where k = 'wallets') then raise exception 'wallets changed'; end if;
  if pg_temp.ledger_rows() <> (select id from ids where k = 'ledger') then raise exception 'ledger changed'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
             and table_name in ('coupons', 'advertisers', 'coupon_claims')
             and (column_name ~ 'price|cost|points|amount')) then
    raise exception 'coupons must not carry a price';
  end if;
  perform pg_temp.expect_fail('delete from public.coupon_claims', 'coupon_claims is append-only');
  if (select count(*) from public.admin_audit_logs where action in ('create_coupon', 'award_coupon', 'save_advertiser')) < 4 then
    raise exception 'audit log missing';
  end if;
end $$;

\echo 'coupons: all checks passed'
rollback;
