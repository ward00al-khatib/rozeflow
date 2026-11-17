-- Server seeds encrypted at rest (spec appendix م). Until now seed_pairs.server_seed_enc held the seed in
-- plain hex in a table no member can read. Now it holds AES-256 ciphertext; the key lives in Supabase Vault
-- (encrypted by a root key that Supabase keeps outside the database), so a copy of the tables or a backup
-- does not reveal unrevealed seeds. Format: 'v1:' || hex(iv) || ':' || hex(ciphertext).
-- Outcomes do not change: the functions decrypt and feed the same seed to the same RNG.

do $$
begin
  create extension if not exists supabase_vault with schema vault;
exception when others then
  raise notice 'supabase_vault not created here (%), using the existing vault schema', sqlerrm;
end $$;

do $$
begin
  perform set_config('search_path', 'public, extensions', true);  -- pgcrypto lives in extensions on Supabase
  if not exists (select 1 from vault.decrypted_secrets where name = 'rozeflow_seed_key') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'rozeflow_seed_key',
                                'AES-256 key for server seeds (seed_pairs.server_seed_enc)');
  end if;
end $$;

create or replace function public.seed_key() returns bytea
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_hex text;
begin
  select decrypted_secret into v_hex from vault.decrypted_secrets where name = 'rozeflow_seed_key';
  if v_hex is null or length(v_hex) <> 64 then
    raise exception 'SEED_KEY_MISSING' using errcode = '55000';
  end if;
  return decode(v_hex, 'hex');
end $$;

create or replace function public.seed_seal(p_seed text) returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_iv bytea := gen_random_bytes(16);
begin
  return 'v1:' || encode(v_iv, 'hex') || ':' ||
         encode(encrypt_iv(convert_to(p_seed, 'UTF8'), public.seed_key(), v_iv, 'aes-cbc/pad:pkcs'), 'hex');
end $$;

-- Plain seeds written before this migration pass through unchanged (they are re-sealed below).
create or replace function public.seed_plain(p_stored text) returns text
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_parts text[];
begin
  if p_stored not like 'v1:%' then
    return p_stored;
  end if;
  v_parts := string_to_array(p_stored, ':');
  return convert_from(decrypt_iv(decode(v_parts[3], 'hex'), public.seed_key(), decode(v_parts[2], 'hex'),
                                 'aes-cbc/pad:pkcs'), 'UTF8');
end $$;

-- Seal every seed stored so far (revealed pairs keep their public copy in server_seed_revealed).
update public.seed_pairs set server_seed_enc = public.seed_seal(server_seed_enc) where server_seed_enc not like 'v1:%';

-- ---------- the same functions, now reading seeds through seed_plain / writing through seed_seal ----------

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
  values (p_uid, public.seed_seal(v_seed), encode(sha256(decode(v_seed, 'hex')), 'hex'),
          coalesce(p_client_seed, encode(gen_random_bytes(8), 'hex')))
  returning * into v_pair;
  return v_pair;
end $$;

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
  if exists (select 1 from public.game_rounds where user_id = v_uid and status in ('RESERVED', 'RUNNING', 'RESOLVED')) then
    raise exception 'OPEN_ROUND' using errcode = '55000';
  end if;
  select * into v_old from public.seed_pairs where user_id = v_uid and status = 'active' for update;
  if found then
    update public.seed_pairs
       set status = 'revealed', server_seed_revealed = public.seed_plain(server_seed_enc), revealed_at = now()
     where id = v_old.id;
  end if;
  v_new := public.ensure_seed_pair(v_uid, coalesce(p_client_seed, v_old.client_seed));
  return jsonb_build_object(
    'revealed', case when v_old.id is null then null else jsonb_build_object(
      'seed_pair_id', v_old.id, 'server_seed', public.seed_plain(v_old.server_seed_enc), 'server_seed_hash', v_old.server_seed_hash,
      'client_seed', v_old.client_seed, 'rounds', v_old.next_nonce) end,
    'seed_pair_id', v_new.id, 'server_seed_hash', v_new.server_seed_hash,
    'client_seed', v_new.client_seed, 'nonce', v_new.next_nonce);
end $$;

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

  perform public.round_rate_check(v_uid);
  v_pair := public.ensure_seed_pair(v_uid);
  v_nonce := v_pair.next_nonce;
  update public.seed_pairs set next_nonce = next_nonce + 1 where id = v_pair.id;

  v_roll := public.fair_integer(public.seed_plain(v_pair.server_seed_enc), v_pair.client_seed, v_nonce, 'rozeflow:v1:dice', v_space);
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

create or replace function public.play_roulette(p_bets jsonb, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.require_member();
  v_key text;
  v_wallet public.wallet_accounts;
  v_replay jsonb;
  v_cfg public.game_config_versions;
  v_pair public.seed_pairs;
  v_mults jsonb;
  v_red jsonb;
  v_bet jsonb;
  v_kind text;
  v_value int;
  v_amount bigint;
  v_total bigint := 0;
  v_seen text[] := '{}';
  v_spot text;
  v_clean jsonb := '[]'::jsonb;
  v_pocket int;
  v_wins jsonb := '[]'::jsonb;
  v_win boolean;
  v_gross bigint := 0;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 80 then
    raise exception 'BAD_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  v_key := v_uid::text || ':' || p_idempotency_key;
  select * into v_wallet from public.wallet_accounts where user_id = v_uid for update;
  if not found then raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501'; end if;
  v_replay := public.round_replay(v_key, v_wallet.available);
  if v_replay is not null then return v_replay; end if;

  v_cfg := public.active_game_config('roulette');
  v_mults := v_cfg.config_json #> '{payout_model,gross_multiplier}';
  v_red := v_cfg.config_json #> '{rules,red}';

  if p_bets is null or jsonb_typeof(p_bets) <> 'array' or jsonb_array_length(p_bets) = 0
     or jsonb_array_length(p_bets) > (v_cfg.config_json #>> '{rules,max_bets_per_round}')::int then
    raise exception 'BAD_BET' using errcode = '22023';
  end if;
  for v_bet in select * from jsonb_array_elements(p_bets) loop
    if jsonb_typeof(v_bet) <> 'object' or jsonb_typeof(v_bet->'amount') is distinct from 'number'
       or (v_bet ? 'value' and jsonb_typeof(v_bet->'value') not in ('number', 'null')) then
      raise exception 'BAD_BET' using errcode = '22023';
    end if;
    v_kind := v_bet->>'kind';
    if v_kind is null or not v_mults ? v_kind then
      raise exception 'BAD_BET' using errcode = '22023';
    end if;
    if (v_bet->>'amount')::numeric <> trunc((v_bet->>'amount')::numeric)
       or (v_bet->>'value' is not null and (v_bet->>'value')::numeric <> trunc((v_bet->>'value')::numeric)) then
      raise exception 'BAD_BET' using errcode = '22023';
    end if;
    v_amount := (v_bet->>'amount')::bigint;
    v_value := (v_bet->>'value')::int;
    if v_kind = 'straight' then
      if v_value is null or v_value < 0 or v_value > 36 then raise exception 'BAD_BET' using errcode = '22023'; end if;
    elsif v_kind in ('dozen', 'column') then
      if v_value is null or v_value not in (1, 2, 3) then raise exception 'BAD_BET' using errcode = '22023'; end if;
    else
      v_value := null;
    end if;
    if v_amount < (v_cfg.config_json #>> '{stake_limits,min_per_bet}')::bigint then
      raise exception 'STAKE_OUT_OF_RANGE' using errcode = '22023';
    end if;
    v_spot := v_kind || ':' || coalesce(v_value::text, '');
    if v_spot = any (v_seen) then raise exception 'BAD_BET' using errcode = '22023'; end if;
    v_seen := v_seen || v_spot;
    v_total := v_total + v_amount;
    v_clean := v_clean || jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object('kind', v_kind, 'value', v_value, 'amount', v_amount)));
  end loop;
  if v_total < (v_cfg.config_json #>> '{stake_limits,min}')::bigint
     or v_total > (v_cfg.config_json #>> '{stake_limits,max}')::bigint then
    raise exception 'STAKE_OUT_OF_RANGE' using errcode = '22023';
  end if;
  if v_wallet.available < v_total then
    raise exception 'INSUFFICIENT_BALANCE' using errcode = '22023';
  end if;

  v_pair := public.take_nonce(v_uid);
  v_pocket := public.fair_integer(public.seed_plain(v_pair.server_seed_enc), v_pair.client_seed, v_pair.next_nonce,
                                  'rozeflow:v1:roulette', (v_cfg.config_json #>> '{rules,pockets}')::int);
  for v_bet in select * from jsonb_array_elements(v_clean) loop
    v_win := public.roulette_bet_wins(v_bet->>'kind', (v_bet->>'value')::int, v_pocket, v_red);
    v_wins := v_wins || to_jsonb(v_win);
    if v_win then
      v_gross := v_gross + (v_bet->>'amount')::bigint * (v_mults->>(v_bet->>'kind'))::bigint;
    end if;
  end loop;

  return public.post_instant_round(v_uid, 'roulette', v_cfg, v_pair, v_total, v_gross,
    jsonb_build_object('bets', v_clean),
    jsonb_build_object('pocket', v_pocket, 'wins', v_wins, 'bets', v_clean), v_key);
end $$;

create or replace function public.play_plinko(p_stake bigint, p_rows int, p_risk text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.require_member();
  v_key text;
  v_wallet public.wallet_accounts;
  v_replay jsonb;
  v_cfg public.game_config_versions;
  v_pair public.seed_pairs;
  v_block bytea;
  v_path jsonb := '[]'::jsonb;
  v_bit int;
  v_slot int := 0;
  v_mult bigint;
  v_gross bigint;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 80 then
    raise exception 'BAD_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  v_key := v_uid::text || ':' || p_idempotency_key;
  select * into v_wallet from public.wallet_accounts where user_id = v_uid for update;
  if not found then raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501'; end if;
  v_replay := public.round_replay(v_key, v_wallet.available);
  if v_replay is not null then return v_replay; end if;

  v_cfg := public.active_game_config('plinko');
  if p_stake is null
     or p_stake < (v_cfg.config_json #>> '{stake_limits,min}')::bigint
     or p_stake > (v_cfg.config_json #>> '{stake_limits,max}')::bigint then
    raise exception 'STAKE_OUT_OF_RANGE' using errcode = '22023';
  end if;
  if p_rows is null or p_risk is null
     or not (v_cfg.config_json #> '{rules,rows}') @> to_jsonb(p_rows)
     or not (v_cfg.config_json #> '{rules,risks}') @> to_jsonb(p_risk)
     or p_rows > 32 then
    raise exception 'BAD_BET' using errcode = '22023';
  end if;
  if v_wallet.available < p_stake then
    raise exception 'INSUFFICIENT_BALANCE' using errcode = '22023';
  end if;

  v_pair := public.take_nonce(v_uid);
  -- One unbiased_integer(2) per row = one byte per row, low bit (1 = right). 32 rows fit in block 0.
  v_block := public.fair_block(public.seed_plain(v_pair.server_seed_enc), v_pair.client_seed, v_pair.next_nonce, 'rozeflow:v1:plinko', 0);
  for i in 0 .. p_rows - 1 loop
    v_bit := get_byte(v_block, i) & 1;
    v_path := v_path || to_jsonb(v_bit);
    v_slot := v_slot + v_bit;
  end loop;
  v_mult := public.plinko_multiplier(v_cfg.config_json, p_risk, p_rows, v_slot);
  v_gross := (p_stake * v_mult) / (v_cfg.config_json #>> '{payout_model,multiplier_scale}')::bigint;

  return public.post_instant_round(v_uid, 'plinko', v_cfg, v_pair, p_stake, v_gross,
    jsonb_build_object('rows', p_rows, 'risk', p_risk),
    jsonb_build_object('path', v_path, 'slot', v_slot, 'multiplier', v_mult, 'rows', p_rows, 'risk', p_risk,
                       'rtp_bp', (v_cfg.config_json #>> '{payout_model,target_rtp_bp}')::int), v_key);
end $$;

create or replace function public.mines_advance(p_round public.game_rounds, p_cash boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_cfg public.game_config_versions;
  v_pair public.seed_pairs;
  v_mines int := (p_round.player_params->>'mines')::int;
  v_picks int[];
  v_k int;
  v_tiles int[];
  v_mine_tiles int[];
  v_mult bigint := 0;
  v_gross bigint := 0;
  v_status text := 'playing';
  v_round public.game_rounds := p_round;
begin
  select * into v_cfg from public.game_config_versions where id = p_round.config_version_id;
  select * into v_pair from public.seed_pairs where id = p_round.seed_pair_id;
  select coalesce(array_agg((payload->>'tile')::int order by seq), '{}') into v_picks
    from public.round_actions where round_id = p_round.id and action = 'pick';
  v_k := coalesce(array_length(v_picks, 1), 0);
  v_tiles := public.fair_shuffle(public.seed_plain(v_pair.server_seed_enc), v_pair.client_seed, p_round.nonce, 'rozeflow:v1:mines',
                                 (v_cfg.config_json #>> '{rules,tiles}')::int);
  select array_agg(t order by t) into v_mine_tiles from unnest(v_tiles[1:v_mines]) t;

  if v_k > 0 and v_picks[v_k] = any (v_mine_tiles) then
    v_status := 'busted';
  elsif v_k > 0 and (p_cash or v_k >= public.mines_max_picks(v_cfg.config_json, v_mines)) then
    v_status := 'cashed';
    v_mult := public.mines_multiplier(v_cfg.config_json, v_mines, v_k);
    v_gross := (p_round.stake * v_mult) / (v_cfg.config_json #>> '{payout_model,multiplier_scale}')::bigint;
  elsif p_cash then
    raise exception 'NOTHING_TO_CASH' using errcode = '55000';
  end if;

  if v_status = 'playing' then
    return public.round_view(p_round, jsonb_build_object(
      'status', 'playing', 'mines_count', v_mines, 'picks', to_jsonb(v_picks),
      'multiplier', case when v_k > 0 then public.mines_multiplier(v_cfg.config_json, v_mines, v_k) else 0 end));
  end if;
  v_round := public.post_round_end(p_round, v_gross, jsonb_build_object(
    'status', v_status, 'mines_count', v_mines, 'mines', to_jsonb(v_mine_tiles), 'picks', to_jsonb(v_picks),
    'multiplier', v_mult));
  return public.round_view(v_round);
end $$;

create or replace function public.crash_advance(p_round public.game_rounds, p_cash boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_cfg public.game_config_versions;
  v_pair public.seed_pairs;
  v_auto int := (p_round.player_params->>'auto_cashout')::int;
  v_ms numeric := extract(epoch from (clock_timestamp() - p_round.created_at)) * 1000;
  v_now int;
  v_crash int;
  v_at int;
  v_gross bigint := 0;
  v_round public.game_rounds;
begin
  select * into v_cfg from public.game_config_versions where id = p_round.config_version_id;
  select * into v_pair from public.seed_pairs where id = p_round.seed_pair_id;
  v_now := public.crash_multiplier_at(v_cfg.config_json, v_ms);
  v_crash := public.crash_point(v_cfg.config_json,
    public.fair_unit_integer(public.seed_plain(v_pair.server_seed_enc), v_pair.client_seed, p_round.nonce, 'rozeflow:v1:crash'));

  if v_auto <= v_crash and v_now >= v_auto then
    v_at := v_auto;                                   -- the automatic target was reached first
  elsif p_cash and v_now <= v_crash then
    v_at := v_now;                                    -- manual press in time
  elsif v_now > v_crash or p_cash then
    v_at := null;                                     -- crashed before any cash-out
  else
    return public.round_view(p_round, jsonb_build_object(
      'status', 'flying', 'auto_cashout', v_auto, 'elapsed_ms', floor(v_ms), 'multiplier', v_now));
  end if;

  if v_at is not null then
    v_gross := (p_round.stake * v_at) / 100;
  end if;
  v_round := public.post_round_end(p_round, v_gross, jsonb_build_object(
    'status', case when v_at is null then 'crashed' else 'cashed' end,
    'crash_point', v_crash, 'cashed_at', v_at, 'auto_cashout', v_auto, 'elapsed_ms', floor(v_ms)));
  return public.round_view(v_round);
end $$;

create or replace function public.play_slots(p_stake bigint, p_buy boolean, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.require_member();
  v_key text;
  v_wallet public.wallet_accounts;
  v_replay jsonb;
  v_cfg public.game_config_versions;
  v_c jsonb;
  v_pair public.seed_pairs;
  v_buy boolean := coalesce(p_buy, false);
  v_cost bigint;
  v_strips text[];          -- flattened: reel r (from 0), position i (from 0) is element r * v_len + i + 1
  v_len int;
  v_reels int;
  v_rows int;
  v_lines int[];            -- flattened: line l, reel r is element l * v_reels + r + 1 (the row it crosses)
  v_nlines int;
  v_pays jsonb;
  v_scatter text;
  v_wild text;
  v_line_bet bigint;
  v_num numeric;
  v_den numeric;
  v_rtp numeric;
  -- stream
  v_buf bytea := ''::bytea;
  v_pos int := 0;
  v_counter bigint := 0;
  v_bits int := 0;
  v_m int;
  v_x int;
  -- one spin
  v_stops int[];
  v_units bigint;
  v_scatters int;
  v_first text;
  v_sym text;
  v_count int;
  v_spin_gross bigint;
  -- round
  v_i int;
  v_spins int;
  v_mult int;
  v_base jsonb := null;
  v_free jsonb := '[]'::jsonb;
  v_base_gross bigint := 0;
  v_free_gross bigint := 0;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 80 then
    raise exception 'BAD_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  v_key := v_uid::text || ':' || p_idempotency_key;
  select * into v_wallet from public.wallet_accounts where user_id = v_uid for update;
  if not found then raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501'; end if;
  v_replay := public.round_replay(v_key, v_wallet.available);
  if v_replay is not null then return v_replay; end if;

  v_cfg := public.active_game_config('slots');
  v_c := v_cfg.config_json;
  if p_stake is null
     or p_stake < (v_c #>> '{stake_limits,min}')::bigint
     or p_stake > (v_c #>> '{stake_limits,max}')::bigint
     or p_stake % (v_c #>> '{stake_limits,multiple_of}')::bigint <> 0 then
    raise exception 'STAKE_OUT_OF_RANGE' using errcode = '22023';
  end if;
  v_cost := case when v_buy then p_stake * (v_c #>> '{rules,buy_feature,price_multiplier}')::bigint else p_stake end;
  if v_wallet.available < v_cost then
    raise exception 'INSUFFICIENT_BALANCE' using errcode = '22023';
  end if;

  v_reels := (v_c #>> '{rules,reels}')::int;
  v_rows := (v_c #>> '{rules,rows}')::int;
  v_len := jsonb_array_length(v_c #> '{rules,strips,0}');
  select array_agg(s.sym order by r.ord, s.ord) into v_strips
    from jsonb_array_elements(v_c #> '{rules,strips}') with ordinality r(strip, ord),
         jsonb_array_elements_text(r.strip) with ordinality s(sym, ord);
  v_nlines := jsonb_array_length(v_c #> '{rules,lines}');
  select array_agg(c.row_no::int order by l.ord, c.ord) into v_lines
    from jsonb_array_elements(v_c #> '{rules,lines}') with ordinality l(line, ord),
         jsonb_array_elements_text(l.line) with ordinality c(row_no, ord);
  if array_length(v_strips, 1) <> v_reels * v_len or array_length(v_lines, 1) <> v_nlines * v_reels then
    raise exception 'BAD_CONFIG' using errcode = '55000';
  end if;
  v_pays := v_c #> '{payout_model,pays}';
  v_scatter := v_c #>> '{rules,symbols,scatter}';
  v_wild := v_c #>> '{rules,symbols,wild}';
  v_line_bet := p_stake / v_nlines;
  v_num := (v_c #>> '{payout_model,table_rtp,num}')::numeric;
  v_den := (v_c #>> '{payout_model,table_rtp,den}')::numeric;
  v_rtp := (v_c #>> '{payout_model,target_rtp_bp}')::numeric;
  v_m := v_len - 1;
  while v_m > 0 loop v_bits := v_bits + 1; v_m := v_m >> 1; end loop;
  if v_bits > 8 then raise exception 'BAD_CONFIG' using errcode = '55000'; end if;

  v_pair := public.take_nonce(v_uid);
  v_pair.server_seed_enc := public.seed_plain(v_pair.server_seed_enc);  -- decrypt once for the whole spin
  v_spins := case when v_buy then (v_c #>> '{rules,buy_feature,spins}')::int else 0 end;
  v_mult := (v_c #>> '{rules,free_spins,start_multiplier}')::int;

  -- Spin 0 is the base spin (skipped when the feature is bought); spins 1 .. v_spins are free spins.
  v_i := case when v_buy then 1 else 0 end;
  while v_i <= v_spins loop
    -- five stops: unbiased_integer(len) each, one byte per try
    v_stops := '{}';
    for r in 0 .. v_reels - 1 loop
      loop
        if octet_length(v_buf) < v_pos + 1 then
          v_buf := v_buf || public.fair_block(v_pair.server_seed_enc, v_pair.client_seed, v_pair.next_nonce, 'rozeflow:v1:slots', v_counter);
          v_counter := v_counter + 1;
        end if;
        v_x := get_byte(v_buf, v_pos) % (1 << v_bits);
        v_pos := v_pos + 1;
        exit when v_x < v_len;
      end loop;
      v_stops := v_stops || v_x;
    end loop;
    -- lines: left to right from reel 1, three or more of the first symbol, wild substitutes
    v_units := 0;
    for l in 0 .. v_nlines - 1 loop
      v_first := v_strips[(v_stops[1] + v_lines[l * v_reels + 1]) % v_len + 1];
      if v_first <> v_wild and v_first <> v_scatter then
        v_count := 1;
        while v_count < v_reels loop
          v_sym := v_strips[v_count * v_len + (v_stops[v_count + 1] + v_lines[l * v_reels + v_count + 1]) % v_len + 1];
          exit when v_sym <> v_first and v_sym <> v_wild;
          v_count := v_count + 1;
        end loop;
        if v_count >= 3 then
          v_units := v_units + (v_pays -> v_first ->> (v_count - 3))::bigint;
        end if;
      end if;
    end loop;
    -- scatters anywhere in the window
    v_scatters := 0;
    for r in 0 .. v_reels - 1 loop
      for w in 0 .. v_rows - 1 loop
        if v_strips[r * v_len + (v_stops[r + 1] + w) % v_len + 1] = v_scatter then v_scatters := v_scatters + 1; end if;
      end loop;
    end loop;

    if v_i = 0 then
      v_spin_gross := div(v_line_bet * v_units * v_rtp * v_den, 10000 * v_num)::bigint;
      v_base_gross := v_spin_gross;
      v_base := jsonb_build_object('stops', to_jsonb(v_stops), 'units', v_units, 'scatters', v_scatters, 'gross', v_spin_gross);
      v_spins := coalesce((v_c #>> array['rules', 'free_spins', 'scatters_to_spins', least(v_scatters, 5)::text])::int, 0);
    else
      v_spin_gross := div(v_line_bet * v_units * v_mult * v_rtp * v_den, 10000 * v_num)::bigint;
      v_free_gross := v_free_gross + v_spin_gross;
      v_free := v_free || jsonb_build_array(jsonb_build_object(
        'stops', to_jsonb(v_stops), 'units', v_units, 'scatters', v_scatters, 'multiplier', v_mult, 'gross', v_spin_gross));
      if v_units > 0 then
        v_mult := v_mult + (v_c #>> '{rules,free_spins,multiplier_step_after_win}')::int;
      end if;
    end if;
    v_i := v_i + 1;
  end loop;

  return public.post_instant_round(v_uid, 'slots', v_cfg, v_pair, v_cost, v_base_gross + v_free_gross,
    jsonb_build_object('stake', p_stake, 'buy', v_buy),
    jsonb_build_object('bet_stake', p_stake, 'buy', v_buy, 'base', v_base, 'free_spins', v_free,
                       'base_gross', v_base_gross, 'free_gross', v_free_gross, 'cost', v_cost,
                       'rtp_bp', v_rtp::int), v_key);
end $$;

revoke all on function public.seed_key() from public, anon, authenticated;
revoke all on function public.seed_seal(text) from public, anon, authenticated;
revoke all on function public.seed_plain(text) from public, anon, authenticated;
