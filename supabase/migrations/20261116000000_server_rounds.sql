-- Server-side rounds, starting with Dice (spec 4.3, 5, 6, appendix ح).
-- A whole round is one SQL function call = one transaction: validate, reserve, draw, settle, record.
-- The owner sets the RTP per game from the control panel; a change is a new config version that takes
-- effect at once and applies to new rounds only. Odds stay global per config version, never per player.

-- ---------- config versions: the owner's change is immediate (replaces the 72h notice) ----------

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.game_config_versions'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%effective_at%'
  loop
    execute format('alter table public.game_config_versions drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.game_config_versions add constraint config_announced_before_effective
  check (status not in ('SCHEDULED', 'ACTIVE')
         or (announced_at is not null and effective_at is not null and effective_at >= announced_at));

alter table public.game_config_versions add column if not exists change_reason text;

-- Games, their live config and the version history are public: that is the transparency rule (spec 2.5),
-- and the demo pages show the live RTP to visitors too.
drop policy if exists games_readable on public.games;
create policy games_readable on public.games for select using (true);
drop policy if exists configs_readable on public.game_config_versions;
create policy configs_readable on public.game_config_versions for select
  using (status in ('SCHEDULED', 'ACTIVE', 'RETIRED'));
grant select on public.games, public.game_config_versions to anon, authenticated;

create policy owner_reads_rounds on public.game_rounds for select using (public.is_owner());
create policy owner_reads_ledger on public.wallet_ledger for select using (public.is_owner());

-- ---------- fairness RNG in SQL: must match src/lib/fairness/rng.ts byte for byte ----------

-- One HMAC-SHA-256 block over encode(domain, client_seed, nonce, counter); each field is u32be(len) || bytes.
create or replace function public.fair_block(p_seed_hex text, p_client_seed text, p_nonce bigint, p_domain text, p_counter bigint)
returns bytea
language sql immutable strict set search_path = public, extensions as $$
  select hmac(
    int4send(octet_length(convert_to(p_domain, 'UTF8'))) || convert_to(p_domain, 'UTF8')
    || int4send(octet_length(convert_to(p_client_seed, 'UTF8'))) || convert_to(p_client_seed, 'UTF8')
    || int4send(8) || int8send(p_nonce)
    || int4send(8) || int8send(p_counter),
    decode(p_seed_hex, 'hex'),
    'sha256');
$$;

-- First uniform integer in [0, upper) of the round's stream, by rejection sampling (no modulo bias).
create or replace function public.fair_integer(p_seed_hex text, p_client_seed text, p_nonce bigint, p_domain text, p_upper int)
returns int
language plpgsql immutable strict set search_path = public, extensions as $$
declare
  v_bits int := 0;
  v_n int := p_upper - 1;
  v_nbytes int;
  v_buf bytea := ''::bytea;
  v_pos int := 0;
  v_counter bigint := 0;
  v_x bigint;
begin
  if p_upper < 1 or p_upper > 16777216 then
    raise exception 'upper out of range' using errcode = '22023';
  end if;
  if p_seed_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'server seed must be 32 bytes hex' using errcode = '22023';
  end if;
  if p_upper = 1 then return 0; end if;
  while v_n > 0 loop v_bits := v_bits + 1; v_n := v_n >> 1; end loop;
  v_nbytes := (v_bits + 7) / 8;
  loop
    while octet_length(v_buf) < v_pos + v_nbytes loop
      v_buf := v_buf || public.fair_block(p_seed_hex, p_client_seed, p_nonce, p_domain, v_counter);
      v_counter := v_counter + 1;
    end loop;
    v_x := 0;
    for i in 0 .. v_nbytes - 1 loop
      v_x := v_x * 256 + get_byte(v_buf, v_pos + i);
    end loop;
    v_pos := v_pos + v_nbytes;
    v_x := v_x % (1::bigint << v_bits);
    if v_x < p_upper then return v_x::int; end if;
  end loop;
end $$;

-- ---------- seed pairs ----------
-- The server seed lives in seed_pairs.server_seed_enc. That table has no select policy and no grants,
-- so only these SECURITY DEFINER functions can read it. (Spec 6.2 asks for encryption with a key held
-- outside the database; that hardening is tracked in appendix ح and does not change any outcome.)

revoke all on public.seed_pairs from anon, authenticated;

create or replace function public.ensure_seed_pair(p_uid uuid, p_client_seed text default null)
returns public.seed_pairs
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_pair public.seed_pairs;
  v_seed text;
begin
  select * into v_pair from public.seed_pairs where user_id = p_uid and status = 'active' for update;
  if found then return v_pair; end if;
  v_seed := encode(gen_random_bytes(32), 'hex');
  insert into public.seed_pairs (user_id, server_seed_enc, server_seed_hash, client_seed)
  values (p_uid, v_seed, encode(sha256(decode(v_seed, 'hex')), 'hex'),
          coalesce(p_client_seed, encode(gen_random_bytes(8), 'hex')))
  returning * into v_pair;
  return v_pair;
end $$;

create or replace function public.require_member() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles where user_id = v_uid and status = 'active') then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;
  return v_uid;
end $$;

-- The member's current commitment: hash, client seed and next nonce. Never the seed itself.
create or replace function public.my_seed_state() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.require_member();
  v_pair public.seed_pairs := public.ensure_seed_pair(v_uid);
begin
  return jsonb_build_object('seed_pair_id', v_pair.id, 'server_seed_hash', v_pair.server_seed_hash,
                            'client_seed', v_pair.client_seed, 'nonce', v_pair.next_nonce);
end $$;

-- Reveals the current server seed and commits to a new one. Rounds played on the old pair become verifiable.
create or replace function public.rotate_seed(p_client_seed text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.require_member();
  v_old public.seed_pairs;
  v_new public.seed_pairs;
begin
  p_client_seed := nullif(btrim(coalesce(p_client_seed, '')), '');
  if p_client_seed is not null and char_length(p_client_seed) > 64 then
    raise exception 'CLIENT_SEED_TOO_LONG' using errcode = '22023';
  end if;
  perform 1 from public.wallet_accounts where user_id = v_uid for update;  -- serialise with rounds
  select * into v_old from public.seed_pairs where user_id = v_uid and status = 'active' for update;
  if found then
    update public.seed_pairs
       set status = 'revealed', server_seed_revealed = server_seed_enc, revealed_at = now()
     where id = v_old.id;
  end if;
  v_new := public.ensure_seed_pair(v_uid, coalesce(p_client_seed, v_old.client_seed));
  return jsonb_build_object(
    'revealed', case when v_old.id is null then null else jsonb_build_object(
      'seed_pair_id', v_old.id, 'server_seed', v_old.server_seed_enc, 'server_seed_hash', v_old.server_seed_hash,
      'client_seed', v_old.client_seed, 'rounds', v_old.next_nonce) end,
    'seed_pair_id', v_new.id, 'server_seed_hash', v_new.server_seed_hash,
    'client_seed', v_new.client_seed, 'nonce', v_new.next_nonce);
end $$;

-- The member's seed pairs; the server seed appears only for revealed pairs.
create or replace function public.my_seed_pairs() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'seed_pair_id', s.id, 'server_seed_hash', s.server_seed_hash, 'client_seed', s.client_seed,
           'status', s.status, 'server_seed', s.server_seed_revealed, 'rounds', s.next_nonce,
           'created_at', s.created_at, 'revealed_at', s.revealed_at) order by (s.status = 'active') desc, s.revealed_at desc, s.created_at desc), '[]'::jsonb)
  from public.seed_pairs s where s.user_id = auth.uid();
$$;

-- ---------- Dice round ----------

create or replace function public.play_dice(p_stake bigint, p_target int, p_direction text, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.require_member();
  v_key text;
  v_wallet public.wallet_accounts;
  v_round public.game_rounds;
  v_cfg public.game_config_versions;
  v_pair public.seed_pairs;
  v_space int;
  v_rtp bigint;
  v_wc int;
  v_roll int;
  v_win boolean;
  v_mult bigint;
  v_gross bigint;
  v_nonce bigint;
  v_round_id uuid := gen_random_uuid();
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 80 then
    raise exception 'BAD_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  v_key := v_uid::text || ':' || p_idempotency_key;

  -- The wallet row lock serialises everything this member does.
  select * into v_wallet from public.wallet_accounts where user_id = v_uid for update;
  if not found then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;

  -- Same request sent twice: answer with the round that already happened.
  select * into v_round from public.game_rounds where idempotency_key = v_key;
  if found then
    return v_round.outcome || jsonb_build_object(
      'round_id', v_round.id, 'stake', v_round.stake, 'gross', v_round.gross_payout, 'net', v_round.net_result,
      'nonce', v_round.nonce, 'available', v_wallet.available, 'replay', true);
  end if;

  if not exists (select 1 from public.games where id = 'dice' and status = 'enabled') then
    raise exception 'GAME_PAUSED' using errcode = '55000';
  end if;
  select * into v_cfg from public.game_config_versions where game_id = 'dice' and status = 'ACTIVE';
  if not found then
    raise exception 'GAME_PAUSED' using errcode = '55000';
  end if;

  v_space := (v_cfg.config_json #>> '{rules,outcome_space}')::int;
  v_rtp := (v_cfg.config_json #>> '{payout_model,target_rtp_bp}')::bigint;

  if p_stake is null
     or p_stake < (v_cfg.config_json #>> '{stake_limits,min}')::bigint
     or p_stake > (v_cfg.config_json #>> '{stake_limits,max}')::bigint then
    raise exception 'STAKE_OUT_OF_RANGE' using errcode = '22023';
  end if;
  if p_direction is null or p_direction not in ('under', 'over') or p_target is null then
    raise exception 'BAD_BET' using errcode = '22023';
  end if;
  v_wc := case when p_direction = 'under' then p_target else v_space - p_target end;
  if v_wc < (v_cfg.config_json #>> '{rules,win_count_bounds,min}')::int
     or v_wc > (v_cfg.config_json #>> '{rules,win_count_bounds,max}')::int then
    raise exception 'BAD_BET' using errcode = '22023';
  end if;
  if v_wallet.available < p_stake then
    raise exception 'INSUFFICIENT_BALANCE' using errcode = '22023';
  end if;

  v_pair := public.ensure_seed_pair(v_uid);
  v_nonce := v_pair.next_nonce;
  update public.seed_pairs set next_nonce = next_nonce + 1 where id = v_pair.id;

  v_roll := public.fair_integer(v_pair.server_seed_enc, v_pair.client_seed, v_nonce, 'rozeflow:v1:dice', v_space);
  v_win := case when p_direction = 'under' then v_roll < p_target else v_roll >= p_target end;
  v_mult := (v_rtp * 10000) / v_wc;
  v_gross := case when v_win then (p_stake * v_mult) / 10000 else 0 end;
  if v_gross > (v_cfg.config_json #>> '{payout_model,max_gross_payout}')::bigint then
    raise exception 'PAYOUT_ABOVE_MAXIMUM' using errcode = '22023';
  end if;

  -- Ledger (spec 5.2): reserve, consume, then pay.
  insert into public.wallet_ledger (user_id, round_id, type, amount, available_after, reserved_after, idempotency_key)
  values (v_uid, v_round_id, 'STAKE_RESERVE', p_stake, v_wallet.available - p_stake, v_wallet.reserved + p_stake,
          'round:' || v_round_id || ':reserve');
  insert into public.wallet_ledger (user_id, round_id, type, amount, available_after, reserved_after, idempotency_key)
  values (v_uid, v_round_id, 'STAKE_CONSUME', p_stake, v_wallet.available - p_stake, v_wallet.reserved,
          'round:' || v_round_id || ':consume');
  if v_gross > 0 then
    insert into public.wallet_ledger (user_id, round_id, type, amount, available_after, reserved_after, idempotency_key)
    values (v_uid, v_round_id, 'PAYOUT', v_gross, v_wallet.available - p_stake + v_gross, v_wallet.reserved,
            'round:' || v_round_id || ':payout');
  end if;
  update public.wallet_accounts
     set available = available - p_stake + v_gross, version = version + 1, updated_at = now()
   where user_id = v_uid
   returning * into v_wallet;

  insert into public.game_rounds (id, user_id, game_id, config_version_id, seed_pair_id, nonce, stake, player_params,
                                  status, outcome, gross_payout, net_result, idempotency_key, settled_at)
  values (v_round_id, v_uid, 'dice', v_cfg.id, v_pair.id, v_nonce, p_stake,
          jsonb_build_object('target', p_target, 'direction', p_direction),
          'SETTLED',
          jsonb_build_object('roll', v_roll, 'win', v_win, 'multiplier', v_mult, 'target', p_target,
                             'direction', p_direction, 'rtp_bp', v_rtp, 'config_version', v_cfg.version,
                             'server_seed_hash', v_pair.server_seed_hash, 'client_seed', v_pair.client_seed),
          v_gross, v_gross - p_stake, v_key, now())
  returning * into v_round;

  return v_round.outcome || jsonb_build_object(
    'round_id', v_round.id, 'stake', p_stake, 'gross', v_gross, 'net', v_gross - p_stake,
    'nonce', v_nonce, 'available', v_wallet.available, 'replay', false);
end $$;

-- ---------- owner controls ----------

-- Sets a game's RTP in basis points (9000–9900). Creates a new config version that is live at once;
-- rounds already settled keep the version they were played on.
create or replace function public.set_game_rtp(p_game_id text, p_rtp_bp int, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_old public.game_config_versions;
  v_new public.game_config_versions;
  v_json jsonb;
begin
  if not public.is_owner() then
    raise exception 'OWNER_ONLY' using errcode = '42501';
  end if;
  if p_rtp_bp is null or p_rtp_bp < 9000 or p_rtp_bp > 9900 then
    raise exception 'RTP_OUT_OF_RANGE' using errcode = '22023';
  end if;
  select * into v_old from public.game_config_versions
   where game_id = p_game_id and status = 'ACTIVE' for update;
  if not found or (v_old.config_json #>> '{payout_model,target_rtp_bp}') is null then
    raise exception 'GAME_NOT_ON_SERVER' using errcode = '55000';
  end if;
  if (v_old.config_json #>> '{payout_model,target_rtp_bp}')::int = p_rtp_bp then
    return jsonb_build_object('game_id', p_game_id, 'version', v_old.version, 'rtp_bp', p_rtp_bp, 'changed', false);
  end if;

  v_json := jsonb_set(jsonb_set(v_old.config_json, '{payout_model,target_rtp_bp}', to_jsonb(p_rtp_bp)),
                      '{config_version}', to_jsonb(v_old.version + 1));
  update public.game_config_versions set status = 'RETIRED' where id = v_old.id;
  insert into public.game_config_versions (game_id, version, config_json, config_hash, status, theoretical_rtp,
                                           announced_at, effective_at, created_by, approved_by, change_reason)
  values (p_game_id, v_old.version + 1, v_json, encode(sha256(convert_to(v_json::text, 'UTF8')), 'hex'), 'ACTIVE',
          p_rtp_bp / 10000.0, now(), now(), auth.uid(), auth.uid(), nullif(btrim(coalesce(p_reason, '')), ''))
  returning * into v_new;

  insert into public.admin_audit_logs (admin_id, action, target, before_json, after_json, reason)
  values (auth.uid(), 'set_game_rtp', p_game_id,
          jsonb_build_object('version', v_old.version, 'rtp_bp', (v_old.config_json #>> '{payout_model,target_rtp_bp}')::int),
          jsonb_build_object('version', v_new.version, 'rtp_bp', p_rtp_bp), v_new.change_reason);
  return jsonb_build_object('game_id', p_game_id, 'version', v_new.version, 'rtp_bp', p_rtp_bp, 'changed', true);
end $$;

create or replace function public.set_game_status(p_game_id text, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_before text;
begin
  if not public.is_owner() then
    raise exception 'OWNER_ONLY' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('enabled', 'paused') then
    raise exception 'BAD_STATUS' using errcode = '22023';
  end if;
  select status into v_before from public.games where id = p_game_id for update;
  if not found then
    raise exception 'UNKNOWN_GAME' using errcode = '22023';
  end if;
  if v_before <> p_status then
    update public.games set status = p_status where id = p_game_id;
    insert into public.admin_audit_logs (admin_id, action, target, before_json, after_json)
    values (auth.uid(), 'set_game_status', p_game_id, jsonb_build_object('status', v_before),
            jsonb_build_object('status', p_status));
  end if;
  return jsonb_build_object('game_id', p_game_id, 'status', p_status);
end $$;

-- Site ledger for the owner: per game and overall. "net" is the site's side: wagered − paid.
-- p_days = null means all time.
create or replace function public.site_report(p_days int default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_since timestamptz := case when p_days is null then '-infinity'::timestamptz else now() - make_interval(days => p_days) end;
  v_games jsonb;
  v_totals jsonb;
  v_points jsonb;
begin
  if not public.is_owner() then
    raise exception 'OWNER_ONLY' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'game_id', g.id, 'name_ar', g.name_ar, 'status', g.status,
           'on_server', c.id is not null,
           'rtp_bp', (c.config_json #>> '{payout_model,target_rtp_bp}')::int,
           'config_version', c.version,
           'rounds', coalesce(r.rounds, 0), 'players', coalesce(r.players, 0),
           'wagered', coalesce(r.wagered, 0), 'paid', coalesce(r.paid, 0),
           'net', coalesce(r.wagered, 0) - coalesce(r.paid, 0)) order by g.sort), '[]'::jsonb)
    into v_games
    from public.games g
    left join public.game_config_versions c on c.game_id = g.id and c.status = 'ACTIVE'
    left join (
      select game_id, count(*) as rounds, count(distinct user_id) as players,
             sum(stake)::bigint as wagered, sum(gross_payout)::bigint as paid
      from public.game_rounds
      where status = 'SETTLED' and settled_at >= v_since
      group by game_id
    ) r on r.game_id = g.id;

  select jsonb_build_object(
           'rounds', count(*), 'players', count(distinct user_id),
           'wagered', coalesce(sum(stake), 0)::bigint, 'paid', coalesce(sum(gross_payout), 0)::bigint,
           'net', (coalesce(sum(stake), 0) - coalesce(sum(gross_payout), 0))::bigint)
    into v_totals
    from public.game_rounds where status = 'SETTLED' and settled_at >= v_since;

  select jsonb_build_object(
           'members', (select count(*) from public.profiles),
           'in_wallets', (select coalesce(sum(available + reserved), 0)::bigint from public.wallet_accounts),
           'granted', (select coalesce(sum(amount), 0)::bigint from public.wallet_ledger
                        where type in ('SIGNUP_GRANT', 'RECOVERY_GRANT')))
    into v_points;

  return jsonb_build_object('days', p_days, 'games', v_games, 'totals', v_totals, 'points', v_points);
end $$;

-- ---------- grants ----------

revoke all on function public.fair_block(text, text, bigint, text, bigint) from public, anon;
revoke all on function public.fair_integer(text, text, bigint, text, int) from public, anon;
revoke all on function public.ensure_seed_pair(uuid, text) from public, anon, authenticated;
revoke all on function public.require_member() from public, anon;
revoke all on function public.my_seed_state() from public, anon;
revoke all on function public.rotate_seed(text) from public, anon;
revoke all on function public.my_seed_pairs() from public, anon;
revoke all on function public.play_dice(bigint, int, text, text) from public, anon;
revoke all on function public.set_game_rtp(text, int, text) from public, anon;
revoke all on function public.set_game_status(text, text) from public, anon;
revoke all on function public.site_report(int) from public, anon;
grant execute on function public.fair_block(text, text, bigint, text, bigint) to authenticated;
grant execute on function public.fair_integer(text, text, bigint, text, int) to authenticated;
grant execute on function public.require_member() to authenticated;
grant execute on function public.my_seed_state() to authenticated;
grant execute on function public.rotate_seed(text) to authenticated;
grant execute on function public.my_seed_pairs() to authenticated;
grant execute on function public.play_dice(bigint, int, text, text) to authenticated;
grant execute on function public.set_game_rtp(text, int, text) to authenticated;
grant execute on function public.set_game_status(text, text) to authenticated;
grant execute on function public.site_report(int) to authenticated;

-- ---------- seed data: Dice goes live on the server ----------

insert into public.game_config_versions (game_id, version, config_json, config_hash, status, theoretical_rtp,
                                         announced_at, effective_at, change_reason)
select 'dice', 1, j, encode(sha256(convert_to(j::text, 'UTF8')), 'hex'), 'ACTIVE', 0.99, now(), now(), 'الإصدار الأول'
from (select '{
  "game_id": "dice",
  "config_version": 1,
  "ruleset_version": "1.0.0",
  "units": "centi_points",
  "stake_limits": { "min": 1000, "max": 100000 },
  "rules": {
    "outcome_space": 10000,
    "win_count_bounds": { "min": 100, "max": 9500 },
    "directions": ["under", "over"]
  },
  "payout_model": {
    "target_rtp_bp": 9900,
    "multiplier_formula": "floor(target_rtp_bp * 10000 / win_count) / 10000",
    "max_gross_payout": 9900000,
    "multiplier_scale": 10000,
    "rounding": "floor_to_centi_point"
  },
  "fairness": { "rng_algorithm_version": "1.0", "game_domain": "rozeflow:v1:dice" }
}'::jsonb as j) s
on conflict (game_id, version) do nothing;

update public.games set status = 'enabled' where id = 'dice';
