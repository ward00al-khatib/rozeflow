-- Usernames for members who joined with an invite link (spec appendix ع).
\set QUIET on
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'ward@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'samer_99@users.rozeflow.com');

create function pg_temp.session(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'session_id', 's-' || uid, 'aal', 'aal2')::text, true);
end $$;

select pg_temp.session('00000000-0000-0000-0000-0000000000a1');
select public.complete_join('ward', true, true);
select pg_temp.session('00000000-0000-0000-0000-0000000000b2');
select public.complete_join('سامر', true, true);

do $$ begin
  if (select username from public.profiles where user_id = '00000000-0000-0000-0000-0000000000a1') is not null then
    raise exception 'email members keep no username';
  end if;
  if (select username from public.profiles where user_id = '00000000-0000-0000-0000-0000000000b2') <> 'samer_99' then
    raise exception 'username not set from the internal address';
  end if;
  begin
    update public.profiles set username = 'Samer_99' where user_id = '00000000-0000-0000-0000-0000000000a1';
    raise exception 'format or uniqueness not enforced';
  exception when check_violation or unique_violation then null;
  end;
  begin
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c3', 'x@example.com');
    insert into public.profiles (user_id, display_name, age_confirmed_at, terms_accepted_at, username)
    values ('00000000-0000-0000-0000-0000000000c3', 'copy', now(), now(), 'samer_99');
    raise exception 'duplicate username accepted';
  exception when unique_violation then null;
  end;
  if has_function_privilege('authenticated', 'public.profiles_set_username()', 'execute') then
    raise exception 'trigger function callable by members';
  end if;
end $$;

do $$ begin raise notice 'usernames_test: all checks passed'; end $$;
rollback;
