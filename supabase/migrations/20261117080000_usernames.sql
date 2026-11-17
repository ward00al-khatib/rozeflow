-- Usernames instead of email for new members (spec appendix ع).
-- Supabase Auth needs an email, so an account made from an invite link gets an internal address
-- <username>@users.rozeflow.com that nothing is ever sent to. The username is its local part, so Auth's own
-- unique email guarantees one account per username; the index below keeps profiles consistent too.

alter table public.profiles add column if not exists username text;
alter table public.profiles add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9_]{3,20}$');
create unique index if not exists profiles_username_key on public.profiles (lower(username));

create or replace function public.username_domain() returns text
language sql immutable as $$ select 'users.rozeflow.com'::text $$;

-- Fills the username when a profile is created for an account with an internal address.
create or replace function public.profiles_set_username() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if new.username is null then
    select lower(email) into v_email from auth.users where id = new.user_id;
    if v_email like '%@' || public.username_domain() then
      new.username := split_part(v_email, '@', 1);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_set_username on public.profiles;
create trigger profiles_set_username before insert on public.profiles
  for each row execute function public.profiles_set_username();

revoke execute on function public.profiles_set_username() from public, anon, authenticated;
