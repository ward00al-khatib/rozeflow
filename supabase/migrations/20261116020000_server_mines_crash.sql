-- Mines and Crash on the server (spec 4.2, 4.3, 9.2, appendix ح): rounds that stay open between calls.
-- Start reserves the stake (STAKE_RESERVE) and opens the round; the end consumes it (STAKE_CONSUME) and
-- pays (PAYOUT). The hidden part of the outcome (mine tiles, crash point) is never stored while the round
-- is open: it is recomputed from the seed inside these functions, and written only when the round ends.

-- ---------- RNG: shuffle and the 52-bit integer, matching rng.ts ----------

-- Fisher–Yates over [0 .. n-1] with unbiased_integer(i + 1) for i = n-1 .. 1 (rng.ts shuffle). n ≤ 256.
create or replace function public.fair_shuffle(p_seed_hex text, p_client_seed text, p_nonce bigint, p_domain text, p_n int)
returns int[]
language plpgsql immutable strict set search_path = public, extensions as $$
declare
  v_a int[];
  v_buf bytea := ''::bytea;
  v_pos int := 0;
  v_counter bigint := 0;
  v_bits int;
  v_m int;
  v_x int;
  v_tmp int;
begin
  if p_n < 1 or p_n > 256 then
    raise exception 'shuffle size out of range' using errcode = '22023';
  end if;
  select array_agg(g order by g) into v_a from generate_series(0, p_n - 1) g;
  for i in reverse p_n - 1 .. 1 loop
    v_bits := 0; v_m := i;
    while v_m > 0 loop v_bits := v_bits + 1; v_m := v_m >> 1; end loop;
    loop
      if octet_length(v_buf) < v_pos + 1 then
        v_buf := v_buf || public.fair_block(p_seed_hex, p_client_seed, p_nonce, p_domain, v_counter);
        v_counter := v_counter + 1;
      end if;
      v_x := get_byte(v_buf, v_pos) % (1 << v_bits);
      v_pos := v_pos + 1;
      exit when v_x < i + 1;
    end loop;
    v_tmp := v_a[i + 1]; v_a[i + 1] := v_a[v_x + 1]; v_a[v_x + 1] := v_tmp;   -- arrays are 1-based
  end loop;
  return v_a;
end $$;

-- The 52-bit integer behind unit_float: the first 7 bytes of the stream, shifted right by 4.
create or replace function public.fair_unit_integer(p_seed_hex text, p_client_seed text, p_nonce bigint, p_domain text)
returns bigint
language plpgsql immutable strict set search_path = public, extensions as $$
declare
  v_block bytea := public.fair_block(p_seed_hex, p_client_seed, p_nonce, p_domain, 0);
  v_x bigint := 0;
begin
  for i in 0 .. 6 loop
    v_x := (v_x << 8) | get_byte(v_block, i);
  end loop;
  return v_x >> 4;
end $$;

-- ---------- open rounds: shared steps ----------

-- Opens a round: balance check, STAKE_RESERVE, round row in RUNNING. The caller holds the wallet lock.
create or replace function public.post_round_start(
  p_uid uuid, p_game_id text, p_cfg public.game_config_versions, p_pair public.seed_pairs,
  p_stake bigint, p_params jsonb, p_key text)
returns public.game_rounds
language plpgsql security definer set search_path = public as $$
declare
  v_wallet public.wallet_accounts;
  v_round public.game_rounds;
  v_round_id uuid := gen_random_uuid();
begin
  select * into v_wallet from public.wallet_accounts where user_id = p_uid for update;
  if exists (select 1 from public.game_rounds where user_id = p_uid and status in ('RESERVED', 'RUNNING', 'RESOLVED')) then
    raise exception 'OPEN_ROUND' using errcode = '55000';
  end if;
  if v_wallet.available < p_stake then
    raise exception 'INSUFFICIENT_BALANCE' using errcode = '22023';
  end if;
  insert into public.wallet_ledger (user_id, round_id, type, amount, available_after, reserved_after, idempotency_key)
  values (p_uid, v_round_id, 'STAKE_RESERVE', p_stake, v_wallet.available - p_stake, v_wallet.reserved + p_stake,
          'round:' || v_round_id || ':reserve');
  update public.wallet_accounts
     set available = available - p_stake, reserved = reserved + p_stake, version = version + 1, updated_at = now()
   where user_id = p_uid;
  insert into public.game_rounds (id, user_id, game_id, config_version_id, seed_pair_id, nonce, stake, player_params,
                                  status, idempotency_key, created_at)
  values (v_round_id, p_uid, p_game_id, p_cfg.id, p_pair.id, p_pair.next_nonce, p_stake, p_params,
          'RUNNING', p_key, clock_timestamp())
  returning * into v_round;
  return v_round;
end $$;

-- Ends an open round: STAKE_CONSUME, PAYOUT if any, round row to SETTLED with its full outcome.
create or replace function public.post_round_end(p_round public.game_rounds, p_gross bigint, p_outcome jsonb)
returns public.game_rounds
language plpgsql security definer set search_path = public as $$
declare
  v_wallet public.wallet_accounts;
  v_cfg public.game_config_versions;
  v_pair public.seed_pairs;
  v_round public.game_rounds;
begin
  select * into v_wallet from public.wallet_accounts where user_id = p_round.user_id for update;
  select * into v_cfg from public.game_config_versions where id = p_round.config_version_id;
  select * into v_pair from public.seed_pairs where id = p_round.seed_pair_id;
  if p_gross < 0 or p_gross > (v_cfg.config_json #>> '{payout_model,max_gross_payout}')::bigint then
    raise exception 'PAYOUT_ABOVE_MAXIMUM' using errcode = '22023';
  end if;
  insert into public.wallet_ledger (user_id, round_id, type, amount, available_after, reserved_after, idempotency_key)
  values (p_round.user_id, p_round.id, 'STAKE_CONSUME', p_round.stake, v_wallet.available, v_wallet.reserved - p_round.stake,
          'round:' || p_round.id || ':consume');
  if p_gross > 0 then
    insert into public.wallet_ledger (user_id, round_id, type, amount, available_after, reserved_after, idempotency_key)
    values (p_round.user_id, p_round.id, 'PAYOUT', p_gross, v_wallet.available + p_gross, v_wallet.reserved - p_round.stake,
            'round:' || p_round.id || ':payout');
  end if;
  update public.wallet_accounts
     set available = available + p_gross, reserved = reserved - p_round.stake, version = version + 1, updated_at = now()
   where user_id = p_round.user_id;
  update public.game_rounds
     set status = 'SETTLED', gross_payout = p_gross, net_result = p_gross - stake, settled_at = clock_timestamp(),
         outcome = p_outcome || jsonb_build_object(
           'rtp_bp', (v_cfg.config_json #>> '{payout_model,target_rtp_bp}')::int, 'config_version', v_cfg.version,
           'server_seed_hash', v_pair.server_seed_hash, 'client_seed', v_pair.client_seed)
   where id = p_round.id
   returning * into v_round;
  return v_round;
end $$;

-- What the member sees of a round: everything once settled, only the public part while open.
create or replace function public.round_view(p_round public.game_rounds, p_live jsonb default '{}') returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(p_round.outcome, '{}'::jsonb) || p_live || jsonb_build_object(
           'round_id', p_round.id, 'game', p_round.game_id, 'open', p_round.status <> 'SETTLED',
           'stake', p_round.stake, 'gross', p_round.gross_payout, 'nonce', p_round.nonce,
           'server_seed_hash', s.server_seed_hash, 'client_seed', s.client_seed,
           'rtp_bp', (c.config_json #>> '{payout_model,target_rtp_bp}')::int, 'config_version', c.version,
           'available', (select available from public.wallet_accounts where user_id = p_round.user_id))
  from public.seed_pairs s, public.game_config_versions c
  where s.id = p_round.seed_pair_id and c.id = p_round.config_version_id;
$$;

-- A seed must not be revealed while a round that depends on it is still open.
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

-- ---------- Mines ----------

create or replace function public.binomial(p_n int, p_k int) returns numeric
language plpgsql immutable as $$
declare v_r numeric := 1;
begin
  if p_k < 0 or p_k > p_n then return 0; end if;
  for i in 0 .. p_k - 1 loop
    v_r := div(v_r * (p_n - i), i + 1);
  end loop;
  return v_r;
end $$;

-- Cash-out multiplier after k safe picks, in ten-thousandths: floor(rtp_bp × C(tiles, k) / C(tiles − mines, k)).
create or replace function public.mines_multiplier(p_config jsonb, p_mines int, p_k int) returns bigint
language sql immutable as $$
  select div((p_config #>> '{payout_model,target_rtp_bp}')::numeric * public.binomial((p_config #>> '{rules,tiles}')::int, p_k),
             public.binomial((p_config #>> '{rules,tiles}')::int - p_mines, p_k))::bigint;
$$;

-- Most safe picks allowed: all safe tiles, but never past the multiplier cap.
create or replace function public.mines_max_picks(p_config jsonb, p_mines int) returns int
language plpgsql immutable as $$
declare
  v_k int := 0;
  v_safe int := (p_config #>> '{rules,tiles}')::int - p_mines;
  v_cap bigint := (p_config #>> '{payout_model,max_multiplier}')::bigint;
begin
  while v_k < v_safe and public.mines_multiplier(p_config, p_mines, v_k + 1) <= v_cap loop
    v_k := v_k + 1;
  end loop;
  return v_k;
end $$;

-- Internal: the state of a mines round after its recorded picks, settling it when it is over.
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
  v_tiles := public.fair_shuffle(v_pair.server_seed_enc, v_pair.client_seed, p_round.nonce, 'rozeflow:v1:mines',
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

create or replace function public.mines_start(p_stake bigint, p_mines int, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.require_member();
  v_key text;
  v_round public.game_rounds;
  v_cfg public.game_config_versions;
  v_pair public.seed_pairs;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 80 then
    raise exception 'BAD_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  v_key := v_uid::text || ':' || p_idempotency_key;
  perform 1 from public.wallet_accounts where user_id = v_uid for update;
  if not found then raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501'; end if;
  select * into v_round from public.game_rounds where idempotency_key = v_key;
  if found then
    if v_round.status = 'SETTLED' then return public.round_view(v_round); end if;
    return public.mines_advance(v_round, false);
  end if;

  v_cfg := public.active_game_config('mines');
  if p_stake is null
     or p_stake < (v_cfg.config_json #>> '{stake_limits,min}')::bigint
     or p_stake > (v_cfg.config_json #>> '{stake_limits,max}')::bigint then
    raise exception 'STAKE_OUT_OF_RANGE' using errcode = '22023';
  end if;
  if p_mines is null
     or p_mines < (v_cfg.config_json #>> '{rules,mines,min}')::int
     or p_mines > (v_cfg.config_json #>> '{rules,mines,max}')::int then
    raise exception 'BAD_BET' using errcode = '22023';
  end if;
  if exists (select 1 from public.game_rounds where user_id = v_uid and status in ('RESERVED', 'RUNNING', 'RESOLVED')) then
    raise exception 'OPEN_ROUND' using errcode = '55000';
  end if;
  if (select available from public.wallet_accounts where user_id = v_uid) < p_stake then
    raise exception 'INSUFFICIENT_BALANCE' using errcode = '22023';
  end if;
  v_pair := public.take_nonce(v_uid);
  v_round := public.post_round_start(v_uid, 'mines', v_cfg, v_pair, p_stake, jsonb_build_object('mines', p_mines), v_key);
  return public.mines_advance(v_round, false);
end $$;

create or replace function public.mines_pick(p_tile int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.require_member();
  v_round public.game_rounds;
  v_seq int;
begin
  perform 1 from public.wallet_accounts where user_id = v_uid for update;
  select * into v_round from public.game_rounds
   where user_id = v_uid and game_id = 'mines' and status = 'RUNNING' for update;
  if not found then
    raise exception 'NO_OPEN_ROUND' using errcode = '55000';
  end if;
  if p_tile is null or p_tile < 0 or p_tile > 24
     or exists (select 1 from public.round_actions where round_id = v_round.id and action = 'pick' and (payload->>'tile')::int = p_tile) then
    raise exception 'BAD_BET' using errcode = '22023';
  end if;
  select coalesce(max(seq) + 1, 0) into v_seq from public.round_actions where round_id = v_round.id;
  insert into public.round_actions (round_id, seq, action, payload)
  values (v_round.id, v_seq, 'pick', jsonb_build_object('tile', p_tile));
  return public.mines_advance(v_round, false);
end $$;

create or replace function public.mines_cashout() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.require_member();
  v_round public.game_rounds;
begin
  perform 1 from public.wallet_accounts where user_id = v_uid for update;
  select * into v_round from public.game_rounds
   where user_id = v_uid and game_id = 'mines' and status = 'RUNNING' for update;
  if not found then
    raise exception 'NO_OPEN_ROUND' using errcode = '55000';
  end if;
  return public.mines_advance(v_round, true);
end $$;

-- ---------- Crash ----------

-- Crash point in hundredths: min(cap, max(100, floor(100 × rtp × 2^52 / (2^52 − X)))).
create or replace function public.crash_point(p_config jsonb, p_x bigint) returns int
language sql immutable as $$
  select greatest(100, least((p_config #>> '{payout_model,max_multiplier}')::numeric,
           div(100::numeric * (p_config #>> '{payout_model,target_rtp_bp}')::numeric * 4503599627370496::numeric,
               10000::numeric * (4503599627370496::numeric - p_x))))::int;
$$;

-- Multiplier after p_ms milliseconds of flight, in hundredths: floor(100 × e^(rate × seconds)).
create or replace function public.crash_multiplier_at(p_config jsonb, p_ms numeric) returns int
language sql immutable as $$
  select floor(100 * exp((p_config #>> '{rules,growth_rate_per_second}')::numeric * least(greatest(p_ms, 0), 120000) / 1000))::int;
$$;

-- Internal: where a crash round stands at the server's clock. Settles it when it is over:
-- the earlier of the automatic target and the manual press wins if it is not past the crash point.
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
    public.fair_unit_integer(v_pair.server_seed_enc, v_pair.client_seed, p_round.nonce, 'rozeflow:v1:crash'));

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

create or replace function public.crash_start(p_stake bigint, p_auto_cashout int, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.require_member();
  v_key text;
  v_round public.game_rounds;
  v_cfg public.game_config_versions;
  v_pair public.seed_pairs;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 80 then
    raise exception 'BAD_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  v_key := v_uid::text || ':' || p_idempotency_key;
  perform 1 from public.wallet_accounts where user_id = v_uid for update;
  if not found then raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501'; end if;
  select * into v_round from public.game_rounds where idempotency_key = v_key;
  if found then
    if v_round.status = 'SETTLED' then return public.round_view(v_round); end if;
    return public.crash_advance(v_round, false);
  end if;

  -- A flight left behind (closed tab) is settled by the clock before a new one starts.
  select * into v_round from public.game_rounds
   where user_id = v_uid and game_id = 'crash' and status = 'RUNNING' for update;
  if found then
    perform public.crash_advance(v_round, false);
  end if;

  v_cfg := public.active_game_config('crash');
  if p_stake is null
     or p_stake < (v_cfg.config_json #>> '{stake_limits,min}')::bigint
     or p_stake > (v_cfg.config_json #>> '{stake_limits,max}')::bigint then
    raise exception 'STAKE_OUT_OF_RANGE' using errcode = '22023';
  end if;
  if p_auto_cashout is null
     or p_auto_cashout < (v_cfg.config_json #>> '{rules,auto_cashout,min}')::int
     or p_auto_cashout > (v_cfg.config_json #>> '{rules,auto_cashout,max}')::int then
    raise exception 'BAD_BET' using errcode = '22023';
  end if;
  if exists (select 1 from public.game_rounds where user_id = v_uid and status in ('RESERVED', 'RUNNING', 'RESOLVED')) then
    raise exception 'OPEN_ROUND' using errcode = '55000';
  end if;
  if (select available from public.wallet_accounts where user_id = v_uid) < p_stake then
    raise exception 'INSUFFICIENT_BALANCE' using errcode = '22023';
  end if;
  v_pair := public.take_nonce(v_uid);
  v_round := public.post_round_start(v_uid, 'crash', v_cfg, v_pair, p_stake,
                                     jsonb_build_object('auto_cashout', p_auto_cashout), v_key);
  return public.round_view(v_round, jsonb_build_object(
    'status', 'flying', 'auto_cashout', p_auto_cashout, 'elapsed_ms', 0, 'multiplier', 100));
end $$;

-- p_cash = true is the player's cash-out press; false only asks where the flight stands.
create or replace function public.crash_step(p_cash boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.require_member();
  v_round public.game_rounds;
begin
  perform 1 from public.wallet_accounts where user_id = v_uid for update;
  select * into v_round from public.game_rounds
   where user_id = v_uid and game_id = 'crash' and status = 'RUNNING' for update;
  if not found then
    raise exception 'NO_OPEN_ROUND' using errcode = '55000';
  end if;
  return public.crash_advance(v_round, coalesce(p_cash, false));
end $$;

-- The member's open round, if any, so a page reload can pick it up. Null when nothing is open.
create or replace function public.my_open_round() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.require_member();
  v_round public.game_rounds;
begin
  perform 1 from public.wallet_accounts where user_id = v_uid for update;
  select * into v_round from public.game_rounds
   where user_id = v_uid and status = 'RUNNING' for update;
  if not found then return null; end if;
  if v_round.game_id = 'mines' then return public.mines_advance(v_round, false); end if;
  if v_round.game_id = 'crash' then return public.crash_advance(v_round, false); end if;
  return null;
end $$;

-- ---------- grants ----------

revoke all on function public.fair_shuffle(text, text, bigint, text, int) from public, anon;
revoke all on function public.fair_unit_integer(text, text, bigint, text) from public, anon;
grant execute on function public.fair_shuffle(text, text, bigint, text, int) to authenticated;
grant execute on function public.fair_unit_integer(text, text, bigint, text) to authenticated;
revoke all on function public.post_round_start(uuid, text, public.game_config_versions, public.seed_pairs, bigint, jsonb, text) from public, anon, authenticated;
revoke all on function public.post_round_end(public.game_rounds, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.round_view(public.game_rounds, jsonb) from public, anon, authenticated;
revoke all on function public.mines_advance(public.game_rounds, boolean) from public, anon, authenticated;
revoke all on function public.crash_advance(public.game_rounds, boolean) from public, anon, authenticated;
revoke all on function public.mines_start(bigint, int, text) from public, anon;
revoke all on function public.mines_pick(int) from public, anon;
revoke all on function public.mines_cashout() from public, anon;
revoke all on function public.crash_start(bigint, int, text) from public, anon;
revoke all on function public.crash_step(boolean) from public, anon;
revoke all on function public.my_open_round() from public, anon;
grant execute on function public.mines_start(bigint, int, text) to authenticated;
grant execute on function public.mines_pick(int) to authenticated;
grant execute on function public.mines_cashout() to authenticated;
grant execute on function public.crash_start(bigint, int, text) to authenticated;
grant execute on function public.crash_step(boolean) to authenticated;
grant execute on function public.my_open_round() to authenticated;

-- ---------- seed data ----------

insert into public.game_config_versions (game_id, version, config_json, config_hash, status, theoretical_rtp,
                                         announced_at, effective_at, change_reason)
select 'mines', 1, j, encode(sha256(convert_to(j::text, 'UTF8')), 'hex'), 'ACTIVE', 0.99, now(), now(), 'الإصدار الأول'
from (select '{
  "game_id": "mines",
  "config_version": 1,
  "ruleset_version": "1.0.0",
  "units": "centi_points",
  "stake_limits": { "min": 1000, "max": 100000 },
  "rules": {
    "tiles": 25,
    "mines": { "min": 1, "max": 24 },
    "derivation": "shuffle([0..24]); the first `mines` entries are the mine tiles",
    "cashout_before_first_pick": false,
    "auto_cashout": "when every safe tile is open, or when the next pick would pass max_multiplier"
  },
  "payout_model": {
    "target_rtp_bp": 9900,
    "multiplier_scale": 10000,
    "multiplier_formula": "floor(target_rtp_bp * C(25, k) / C(25 - mines, k))",
    "max_multiplier": 10000000,
    "max_gross_payout": 100000000
  },
  "fairness": { "rng_algorithm_version": "1.0", "game_domain": "rozeflow:v1:mines" }
}'::jsonb as j) s
on conflict (game_id, version) do nothing;

insert into public.game_config_versions (game_id, version, config_json, config_hash, status, theoretical_rtp,
                                         announced_at, effective_at, change_reason)
select 'crash', 1, j, encode(sha256(convert_to(j::text, 'UTF8')), 'hex'), 'ACTIVE', 0.99, now(), now(), 'الإصدار الأول'
from (select '{
  "game_id": "crash",
  "config_version": 1,
  "ruleset_version": "1.0.0",
  "units": "centi_points",
  "mode": "single_player",
  "stake_limits": { "min": 1000, "max": 100000 },
  "rules": {
    "auto_cashout": { "min": 101, "max": 100000 },
    "growth": "multiplier(t) = floor(100 * e^(0.08 * seconds)) / 100",
    "growth_rate_per_second": 0.08
  },
  "payout_model": {
    "target_rtp_bp": 9900,
    "crash_point_formula": "min(max_multiplier, max(100, floor(100 * rtp * 2^52 / (2^52 - X)))) hundredths, X = 52-bit unit_float numerator",
    "max_multiplier": 100000,
    "max_gross_payout": 100000000
  },
  "fairness": { "rng_algorithm_version": "1.0", "game_domain": "rozeflow:v1:crash" }
}'::jsonb as j) s
on conflict (game_id, version) do nothing;

update public.games set status = 'enabled' where id in ('mines', 'crash');
