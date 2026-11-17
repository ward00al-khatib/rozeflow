-- Minimal stand-in for Supabase's auth schema so migrations can be tested on plain PostgreSQL.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
alter table auth.users add column if not exists email text;

-- Minimal stand-in for Supabase Vault (the real one encrypts secrets with a key kept outside the database).
create schema if not exists vault;
create schema if not exists extensions;  -- Supabase keeps pgcrypto here; locally it is in public
create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique,
                                          secret text not null, description text);
create or replace view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language sql as
$$ insert into vault.secrets (name, secret, description) values (new_name, new_secret, new_description) returning id $$;
