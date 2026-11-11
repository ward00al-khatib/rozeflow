-- Behavioural checks for M1 membership functions. Run with psql -v ON_ERROR_STOP=1.
\set QUIET on
begin;
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2');

create function pg_temp.as_user(uid text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', uid, true) $$;

create function pg_temp.expect_fail(stmt text, label text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then raise notice 'ok: % (%)', label, sqlerrm; return; end;
  raise exception 'expected failure: %', label;
end $$;

-- first user joins and gets exactly one grant, even when called twice
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_fail($$select public.complete_join('ward', false, true)$$, 'age confirmation required');
select pg_temp.expect_fail($$select public.complete_join('x', true, true)$$, 'name too short');
select public.complete_join('ward', true, true);
select public.complete_join('ward', true, true);
do $$ declare a bigint; n int; begin
  select available into a from public.wallet_accounts where user_id = '00000000-0000-0000-0000-0000000000a1';
  select count(*) into n from public.wallet_ledger where user_id = '00000000-0000-0000-0000-0000000000a1';
  if a <> 100000 or n <> 1 then raise exception 'grant wrong: available %, entries %', a, n; end if;
end $$;

-- first caller becomes owner; second member cannot take over
do $$ begin if not public.claim_ownership() then raise exception 'first claim should succeed'; end if; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select public.complete_join('friend', true, true);
do $$ begin if public.claim_ownership() then raise exception 'second claim must fail'; end if; end $$;
do $$ begin if public.is_owner() then raise exception 'friend is not owner'; end if; end $$;

-- not signed in
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.expect_fail($$select public.complete_join('anon', true, true)$$, 'requires sign-in');

do $$ begin
  if exists (select 1 from public.wallet_invariant_violations()) then raise exception 'invariant violated'; end if;
end $$;
\echo 'all membership checks passed'
rollback;
