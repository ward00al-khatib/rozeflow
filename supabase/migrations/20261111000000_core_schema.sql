-- ROZEFLOW core schema (spec sections 5, 6, 8, 11).
-- Amounts are BIGINT centi-points (1 point = 100 units). No floats anywhere in money paths.
-- Wallet changes happen only through SECURITY DEFINER functions (added in M2); the app role
-- never gets UPDATE/DELETE on the ledger or audit tables.

create extension if not exists pgcrypto;

-- ---------- members & invites ----------

create table public.profiles (
  user_id        uuid primary key references auth.users (id) on delete restrict,
  display_name   text not null check (char_length(display_name) between 2 and 32),
  role           text not null default 'player' check (role in ('owner', 'player', 'auditor')),
  status         text not null default 'active' check (status in ('active', 'paused', 'self_excluded', 'closed')),
  self_excluded_until timestamptz,
  age_confirmed_at timestamptz not null,
  terms_accepted_at timestamptz not null,
  created_at     timestamptz not null default now()
);

create table public.invites (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,            -- sha256 of the invite token; the token itself is never stored
  note          text,
  created_by    uuid not null references public.profiles (user_id),
  expires_at    timestamptz not null,
  used_by       uuid unique references auth.users (id),
  used_at       timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  check ((used_by is null) = (used_at is null))
);

-- ---------- wallet & ledger ----------

create table public.wallet_accounts (
  user_id     uuid primary key references public.profiles (user_id),
  available   bigint not null default 0 check (available >= 0),
  reserved    bigint not null default 0 check (reserved >= 0),
  version     bigint not null default 0,
  updated_at  timestamptz not null default now()
);

create table public.wallet_ledger (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references public.wallet_accounts (user_id),
  round_id         uuid,
  type             text not null check (type in (
                     'SIGNUP_GRANT', 'STAKE_RESERVE', 'STAKE_CONSUME', 'PAYOUT', 'STAKE_RELEASE',
                     'RECOVERY_GRANT', 'ADMIN_ADJUSTMENT', 'REVERSAL')),
  amount           bigint not null check (amount <> 0),   -- signed effect described by type; see spec 5.2
  available_after  bigint not null check (available_after >= 0),
  reserved_after   bigint not null check (reserved_after >= 0),
  reverses_id      bigint references public.wallet_ledger (id),
  reason           text,
  actor_id         uuid references public.profiles (user_id),
  idempotency_key  text not null unique,
  created_at       timestamptz not null default now(),
  check ((type = 'REVERSAL') = (reverses_id is not null)),
  check (type not in ('ADMIN_ADJUSTMENT', 'REVERSAL') or (reason is not null and actor_id is not null))
);
create index wallet_ledger_user_idx on public.wallet_ledger (user_id, id desc);
create index wallet_ledger_round_idx on public.wallet_ledger (round_id) where round_id is not null;

-- ---------- games & config versions ----------

create table public.games (
  id      text primary key check (id ~ '^[a-z][a-z0-9_-]*$'),
  name_ar text not null,
  status  text not null default 'disabled' check (status in ('enabled', 'paused', 'disabled')),
  sort    int not null default 0
);

create table public.game_config_versions (
  id            uuid primary key default gen_random_uuid(),
  game_id       text not null references public.games (id),
  version       int not null check (version > 0),
  config_json   jsonb not null,
  config_hash   text not null,                     -- sha256 of canonical config JSON, also stored in Git
  status        text not null default 'DRAFT' check (status in (
                  'DRAFT', 'VALIDATED', 'SIMULATED', 'APPROVED', 'SCHEDULED', 'ACTIVE', 'RETIRED', 'REJECTED')),
  theoretical_rtp numeric(7, 6),
  announced_at  timestamptz,
  effective_at  timestamptz,
  created_by    uuid references public.profiles (user_id),
  approved_by   uuid references public.profiles (user_id),
  created_at    timestamptz not null default now(),
  unique (game_id, version),
  check (status not in ('SCHEDULED', 'ACTIVE') or (announced_at is not null and effective_at is not null
         and effective_at >= announced_at + interval '72 hours'))
);
create unique index one_active_config_per_game on public.game_config_versions (game_id) where status = 'ACTIVE';

-- ---------- fairness ----------

create table public.seed_pairs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (user_id),
  server_seed_enc  text not null,                  -- encrypted with a key held outside the database
  server_seed_hash text not null,                  -- public commitment
  server_seed_revealed text,                       -- set only on rotation
  client_seed      text not null check (char_length(client_seed) between 1 and 64),
  next_nonce       bigint not null default 0 check (next_nonce >= 0),
  status           text not null default 'active' check (status in ('active', 'revealed')),
  created_at       timestamptz not null default now(),
  revealed_at      timestamptz,
  check ((status = 'revealed') = (revealed_at is not null and server_seed_revealed is not null))
);
create unique index one_active_seed_pair on public.seed_pairs (user_id) where status = 'active';

-- ---------- rounds ----------

create table public.game_rounds (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (user_id),
  game_id            text not null references public.games (id),
  config_version_id  uuid not null references public.game_config_versions (id),
  seed_pair_id       uuid not null references public.seed_pairs (id),
  nonce              bigint not null check (nonce >= 0),
  stake              bigint not null check (stake > 0),
  player_params      jsonb not null default '{}',
  status             text not null check (status in (
                       'CREATED', 'RESERVED', 'RUNNING', 'RESOLVED', 'SETTLED', 'VOID', 'REJECTED')),
  outcome            jsonb,
  gross_payout       bigint check (gross_payout >= 0),
  net_result         bigint,
  void_reason        text,
  idempotency_key    text not null unique,
  created_at         timestamptz not null default now(),
  settled_at         timestamptz,
  unique (seed_pair_id, nonce),
  check (status <> 'SETTLED' or (gross_payout is not null and net_result = gross_payout - stake and settled_at is not null)),
  check (status <> 'VOID' or void_reason is not null)
);
create index game_rounds_user_idx on public.game_rounds (user_id, created_at desc);
-- spec 4.2: one open multi-step round per player
create unique index one_open_round_per_user on public.game_rounds (user_id)
  where status in ('RESERVED', 'RUNNING', 'RESOLVED');

create table public.round_actions (
  round_id     uuid not null references public.game_rounds (id),
  seq          int not null check (seq >= 0),
  action       text not null,
  payload      jsonb not null default '{}',
  server_time  timestamptz not null default clock_timestamp(),
  primary key (round_id, seq)
);

-- ---------- recovery ----------

create table public.recovery_claims (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (user_id),
  amount           bigint not null check (amount > 0),
  window_start     timestamptz not null,
  claimed_at       timestamptz not null default now(),
  next_eligible_at timestamptz not null check (next_eligible_at > claimed_at),
  unique (user_id, window_start)
);

-- ---------- audit ----------

create table public.admin_audit_logs (
  id          bigint generated always as identity primary key,
  admin_id    uuid not null references public.profiles (user_id),
  action      text not null,
  target      text,
  before_json jsonb,
  after_json  jsonb,
  reason      text,
  created_at  timestamptz not null default now()
);

-- ---------- append-only guards (spec 5.7) ----------

create or replace function public.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end $$;

create trigger wallet_ledger_append_only before update or delete on public.wallet_ledger
  for each row execute function public.forbid_mutation();
create trigger admin_audit_append_only before update or delete on public.admin_audit_logs
  for each row execute function public.forbid_mutation();
create trigger round_actions_append_only before update or delete on public.round_actions
  for each row execute function public.forbid_mutation();

-- settled / void rounds are final (spec 9.4)
create or replace function public.forbid_final_round_change() returns trigger
language plpgsql as $$
begin
  if old.status in ('SETTLED', 'VOID', 'REJECTED') then
    raise exception 'round % is final (%)', old.id, old.status using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'rounds cannot be deleted' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger game_rounds_final before update or delete on public.game_rounds
  for each row execute function public.forbid_final_round_change();

-- ---------- invariant check (spec 5.4), run nightly ----------

create or replace function public.wallet_invariant_violations()
returns table (user_id uuid, problem text)
language sql stable as $$
  -- reserved must equal open stakes
  select w.user_id, 'reserved <> open stakes'
  from public.wallet_accounts w
  left join (
    select r.user_id, sum(r.stake) as open_stake
    from public.game_rounds r
    where r.status in ('RESERVED', 'RUNNING', 'RESOLVED')
    group by r.user_id
  ) o on o.user_id = w.user_id
  where w.reserved <> coalesce(o.open_stake, 0)
  union all
  -- balances must equal the last ledger entry
  select w.user_id, 'balance <> last ledger entry'
  from public.wallet_accounts w
  left join lateral (
    select l.available_after, l.reserved_after
    from public.wallet_ledger l where l.user_id = w.user_id
    order by l.id desc limit 1
  ) last on true
  where (w.available, w.reserved) is distinct from (coalesce(last.available_after, 0), coalesce(last.reserved_after, 0));
$$;

-- ---------- row level security ----------
-- Members can read only their own rows. All writes go through server-side functions.

alter table public.profiles            enable row level security;
alter table public.invites             enable row level security;
alter table public.wallet_accounts     enable row level security;
alter table public.wallet_ledger       enable row level security;
alter table public.games               enable row level security;
alter table public.game_config_versions enable row level security;
alter table public.seed_pairs          enable row level security;
alter table public.game_rounds         enable row level security;
alter table public.round_actions       enable row level security;
alter table public.recovery_claims     enable row level security;
alter table public.admin_audit_logs    enable row level security;

create policy own_profile on public.profiles for select using (user_id = auth.uid());
create policy own_wallet on public.wallet_accounts for select using (user_id = auth.uid());
create policy own_ledger on public.wallet_ledger for select using (user_id = auth.uid());
create policy own_rounds on public.game_rounds for select using (user_id = auth.uid());
create policy own_recovery on public.recovery_claims for select using (user_id = auth.uid());
create policy games_readable on public.games for select using (auth.uid() is not null);
-- published configs (announced or active) are public to members: that is the transparency rule (spec 2.5)
create policy configs_readable on public.game_config_versions for select
  using (auth.uid() is not null and status in ('SCHEDULED', 'ACTIVE', 'RETIRED'));
create policy own_actions on public.round_actions for select
  using (exists (select 1 from public.game_rounds r where r.id = round_id and r.user_id = auth.uid()));
-- seed_pairs: no direct select; the encrypted seed never leaves the server. Exposed via a view later.

-- ---------- seed data ----------

insert into public.games (id, name_ar, sort) values
  ('dice', 'النرد', 1),
  ('roulette', 'الروليت', 2),
  ('plinko', 'بلينكو', 3),
  ('mines', 'الألغام', 4),
  ('crash', 'كراش', 5),
  ('slots', 'السلوتس', 6);
