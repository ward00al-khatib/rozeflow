-- Behavioural checks for the core schema. Run with psql -v ON_ERROR_STOP=1.
\set QUIET on
begin;

insert into auth.users values ('00000000-0000-0000-0000-000000000001');
insert into public.profiles (user_id, display_name, role, age_confirmed_at, terms_accepted_at)
  values ('00000000-0000-0000-0000-000000000001', 'ward', 'owner', now(), now());
insert into public.wallet_accounts (user_id, available) values ('00000000-0000-0000-0000-000000000001', 100000);
insert into public.wallet_ledger (user_id, type, amount, available_after, reserved_after, idempotency_key)
  values ('00000000-0000-0000-0000-000000000001', 'SIGNUP_GRANT', 100000, 100000, 0, 'signup:1');

-- invariant holds
do $$ begin
  if exists (select 1 from public.wallet_invariant_violations()) then raise exception 'unexpected violation'; end if;
end $$;

-- helper: expect a statement to fail
create function pg_temp.expect_fail(stmt text, label text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok: % (%)', label, sqlerrm;
    return;
  end;
  raise exception 'expected failure: %', label;
end $$;

select pg_temp.expect_fail($$update public.wallet_ledger set amount = 1$$, 'ledger is append-only (update)');
select pg_temp.expect_fail($$delete from public.wallet_ledger$$, 'ledger is append-only (delete)');
select pg_temp.expect_fail($$update public.wallet_accounts set available = -1$$, 'no negative balance');
select pg_temp.expect_fail($$insert into public.wallet_ledger (user_id, type, amount, available_after, reserved_after, idempotency_key)
  values ('00000000-0000-0000-0000-000000000001', 'SIGNUP_GRANT', 1, 1, 0, 'signup:1')$$, 'idempotency key is unique');
select pg_temp.expect_fail($$insert into public.wallet_ledger (user_id, type, amount, available_after, reserved_after, idempotency_key)
  values ('00000000-0000-0000-0000-000000000001', 'ADMIN_ADJUSTMENT', 5, 5, 0, 'adj:1')$$, 'admin adjustment needs reason and actor');

-- drifted balance is detected
update public.wallet_accounts set available = 99999;
do $$ begin
  if not exists (select 1 from public.wallet_invariant_violations()) then raise exception 'violation not detected'; end if;
end $$;
\echo 'all core schema checks passed'
rollback;
