-- Roulette and Plinko on the server (spec 4.3, appendix ح). Same shape as play_dice: one call, one transaction.
-- The steps every instant game shares are helpers here; they are internal and not callable by members.

-- ---------- shared helpers ----------

-- The round a repeated request already produced, or null.
create or replace function public.round_replay(p_key text, p_available bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select r.outcome || jsonb_build_object(
           'round_id', r.id, 'stake', r.stake, 'gross', r.gross_payout, 'net', r.net_result,
           'nonce', r.nonce, 'available', p_available, 'replay', true)
  from public.game_rounds r where r.idempotency_key = p_key;
$$;

create or replace function public.active_game_config(p_game_id text) returns public.game_config_versions
language plpgsql stable security definer set search_path = public as $$
declare v_cfg public.game_config_versions;
begin
  if not exists (select 1 from public.games where id = p_game_id and status = 'enabled') then
    raise exception 'GAME_PAUSED' using errcode = '55000';
  end if;
  select * into v_cfg from public.game_config_versions where game_id = p_game_id and status = 'ACTIVE';
  if not found then
    raise exception 'GAME_PAUSED' using errcode = '55000';
  end if;
  return v_cfg;
end $$;

-- Takes the next nonce of the member's active seed pair. The returned row's next_nonce is the nonce to use.
create or replace function public.take_nonce(p_uid uuid) returns public.seed_pairs
language plpgsql security definer set search_path = public, extensions as $$
declare v_pair public.seed_pairs := public.ensure_seed_pair(p_uid);
begin
  update public.seed_pairs set next_nonce = next_nonce + 1 where id = v_pair.id;
  return v_pair;
end $$;

-- Ledger rows (reserve, consume, payout), wallet update and the settled round, for a round that
-- starts and ends in the same call. The caller holds the wallet row lock and has checked the balance.
create or replace function public.post_instant_round(
  p_uid uuid, p_game_id text, p_cfg public.game_config_versions, p_pair public.seed_pairs,
  p_stake bigint, p_gross bigint, p_params jsonb, p_outcome jsonb, p_key text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_wallet public.wallet_accounts;
  v_round_id uuid := gen_random_uuid();
  v_outcome jsonb;
begin
  select * into v_wallet from public.wallet_accounts where user_id = p_uid for update;
  if v_wallet.available < p_stake then
    raise exception 'INSUFFICIENT_BALANCE' using errcode = '22023';
  end if;
  if p_gross < 0 or p_gross > (p_cfg.config_json #>> '{payout_model,max_gross_payout}')::bigint then
    raise exception 'PAYOUT_ABOVE_MAXIMUM' using errcode = '22023';
  end if;

  insert into public.wallet_ledger (user_id, round_id, type, amount, available_after, reserved_after, idempotency_key)
  values (p_uid, v_round_id, 'STAKE_RESERVE', p_stake, v_wallet.available - p_stake, v_wallet.reserved + p_stake,
          'round:' || v_round_id || ':reserve');
  insert into public.wallet_ledger (user_id, round_id, type, amount, available_after, reserved_after, idempotency_key)
  values (p_uid, v_round_id, 'STAKE_CONSUME', p_stake, v_wallet.available - p_stake, v_wallet.reserved,
          'round:' || v_round_id || ':consume');
  if p_gross > 0 then
    insert into public.wallet_ledger (user_id, round_id, type, amount, available_after, reserved_after, idempotency_key)
    values (p_uid, v_round_id, 'PAYOUT', p_gross, v_wallet.available - p_stake + p_gross, v_wallet.reserved,
            'round:' || v_round_id || ':payout');
  end if;
  update public.wallet_accounts
     set available = available - p_stake + p_gross, version = version + 1, updated_at = now()
   where user_id = p_uid
   returning * into v_wallet;

  v_outcome := p_outcome || jsonb_build_object(
    'config_version', p_cfg.version, 'server_seed_hash', p_pair.server_seed_hash, 'client_seed', p_pair.client_seed);
  insert into public.game_rounds (id, user_id, game_id, config_version_id, seed_pair_id, nonce, stake, player_params,
                                  status, outcome, gross_payout, net_result, idempotency_key, settled_at)
  values (v_round_id, p_uid, p_game_id, p_cfg.id, p_pair.id, p_pair.next_nonce, p_stake, p_params,
          'SETTLED', v_outcome, p_gross, p_gross - p_stake, p_key, now());

  return v_outcome || jsonb_build_object(
    'round_id', v_round_id, 'stake', p_stake, 'gross', p_gross, 'net', p_gross - p_stake,
    'nonce', p_pair.next_nonce, 'available', v_wallet.available, 'replay', false);
end $$;

-- ---------- Roulette ----------

create or replace function public.roulette_bet_wins(p_kind text, p_value int, p_pocket int, p_red jsonb) returns boolean
language sql immutable as $$
  select case
    when p_kind = 'straight' then p_pocket = p_value
    when p_pocket = 0 then false
    when p_kind = 'red' then p_red @> to_jsonb(p_pocket)
    when p_kind = 'black' then not p_red @> to_jsonb(p_pocket)
    when p_kind = 'odd' then p_pocket % 2 = 1
    when p_kind = 'even' then p_pocket % 2 = 0
    when p_kind = 'low' then p_pocket <= 18
    when p_kind = 'high' then p_pocket >= 19
    when p_kind = 'dozen' then (p_pocket + 11) / 12 = p_value
    when p_kind = 'column' then ((p_pocket - 1) % 3) + 1 = p_value
    else false
  end;
$$;

-- p_bets: [{"kind": "red", "amount": 1000}, {"kind": "straight", "value": 17, "amount": 500}, ...]
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
  v_pocket := public.fair_integer(v_pair.server_seed_enc, v_pair.client_seed, v_pair.next_nonce,
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

-- ---------- Plinko ----------

-- The published table for (risk, rows) at the game's current RTP: every multiplier of the base table
-- (built for table_rtp_bp) is scaled by target_rtp_bp / table_rtp_bp and floored. Same rule in plinko.ts.
create or replace function public.plinko_multiplier(p_config jsonb, p_risk text, p_rows int, p_slot int) returns bigint
language sql immutable as $$
  select ((p_config #>> array['payout_model', 'multipliers', p_risk, p_rows::text, p_slot::text])::bigint
          * (p_config #>> '{payout_model,target_rtp_bp}')::bigint)
         / (p_config #>> '{payout_model,table_rtp_bp}')::bigint;
$$;

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
  v_block := public.fair_block(v_pair.server_seed_enc, v_pair.client_seed, v_pair.next_nonce, 'rozeflow:v1:plinko', 0);
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

-- ---------- owner controls: games whose RTP is fixed by their structure ----------

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
  if not found then
    raise exception 'GAME_NOT_ON_SERVER' using errcode = '55000';
  end if;
  if (v_old.config_json #>> '{payout_model,target_rtp_bp}') is null then
    raise exception 'RTP_FIXED' using errcode = '55000';   -- e.g. roulette: 36/37 by the wheel itself
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

-- The report also says when a game's RTP is fixed, and what it is (in basis points, rounded).
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
           'rtp_bp', coalesce((c.config_json #>> '{payout_model,target_rtp_bp}')::int, round(c.theoretical_rtp * 10000)::int),
           'rtp_fixed', c.id is not null and (c.config_json #>> '{payout_model,target_rtp_bp}') is null,
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

revoke all on function public.round_replay(text, bigint) from public, anon, authenticated;
revoke all on function public.active_game_config(text) from public, anon, authenticated;
revoke all on function public.take_nonce(uuid) from public, anon, authenticated;
revoke all on function public.post_instant_round(uuid, text, public.game_config_versions, public.seed_pairs, bigint, bigint, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.play_roulette(jsonb, text) from public, anon;
revoke all on function public.play_plinko(bigint, int, text, text) from public, anon;
grant execute on function public.play_roulette(jsonb, text) to authenticated;
grant execute on function public.play_plinko(bigint, int, text, text) to authenticated;

-- ---------- seed data ----------

insert into public.game_config_versions (game_id, version, config_json, config_hash, status, theoretical_rtp,
                                         announced_at, effective_at, change_reason)
select 'roulette', 1, j, encode(sha256(convert_to(j::text, 'UTF8')), 'hex'), 'ACTIVE', 0.972973, now(), now(), 'الإصدار الأول'
from (select '{
  "game_id": "roulette",
  "config_version": 1,
  "ruleset_version": "1.0.0",
  "units": "centi_points",
  "stake_limits": { "min": 1000, "max": 100000, "min_per_bet": 100 },
  "rules": {
    "wheel": "single_zero",
    "pockets": 37,
    "red": [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36],
    "max_bets_per_round": 50
  },
  "payout_model": {
    "gross_multiplier": {
      "straight": 36,
      "red": 2, "black": 2, "odd": 2, "even": 2, "low": 2, "high": 2,
      "dozen": 3, "column": 3
    },
    "declared_rtp": "36/37",
    "max_gross_payout": 3600000
  },
  "fairness": { "rng_algorithm_version": "1.0", "game_domain": "rozeflow:v1:roulette" }
}'::jsonb as j) s
on conflict (game_id, version) do nothing;

insert into public.game_config_versions (game_id, version, config_json, config_hash, status, theoretical_rtp,
                                         announced_at, effective_at, change_reason)
select 'plinko', 1, j, encode(sha256(convert_to(j::text, 'UTF8')), 'hex'), 'ACTIVE', 0.99, now(), now(), 'الإصدار الأول'
from (select '{
  "game_id": "plinko",
  "config_version": 1,
  "ruleset_version": "1.0.0",
  "units": "centi_points",
  "stake_limits": { "min": 1000, "max": 100000 },
  "rules": {
    "rows": [8, 12, 16],
    "risks": ["low", "medium", "high"],
    "bounce": "one unbiased_integer(2) per row, 1 = right"
  },
  "payout_model": {
    "multiplier_scale": 10000,
    "target_rtp_bp": 9900,
    "table_rtp_bp": 9900,
    "multipliers": {
      "low": {
        "8": [26928, 19124, 13344, 9062, 5890, 9062, 13344, 19124, 26928],
        "12": [38913, 29231, 21783, 16054, 11647, 8257, 5651, 8257, 11647, 16054, 21783, 29231, 38913],
        "16": [49187, 38736, 30375, 23686, 18335, 14054, 10630, 7890, 5700, 7890, 10630, 14054, 18335, 23686, 30375, 38736, 49187]
      },
      "medium": {
        "8": [60626, 32548, 16503, 7334, 2097, 7334, 16503, 32548, 60626],
        "12": [118000, 70259, 40901, 23108, 12324, 5789, 1830, 5789, 12324, 23108, 40901, 70259, 118000],
        "16": [194000, 124000, 78677, 49275, 30306, 18068, 10172, 5078, 1796, 5078, 10172, 18068, 30306, 49275, 78677, 124000, 194000]
      },
      "high": {
        "8": [127000, 47375, 16739, 4956, 427, 4956, 16739, 47375, 127000],
        "12": [391000, 162000, 66537, 26703, 10105, 3190, 315, 3190, 10105, 26703, 66537, 162000, 391000],
        "16": [994000, 451000, 204000, 92034, 40991, 17790, 7244, 2451, 281, 2451, 7244, 17790, 40991, 92034, 204000, 451000, 994000]
      }
    },
    "max_gross_payout": 9940000
  },
  "fairness": { "rng_algorithm_version": "1.0", "game_domain": "rozeflow:v1:plinko" }
}'::jsonb as j) s
on conflict (game_id, version) do nothing;

update public.games set status = 'enabled' where id in ('roulette', 'plinko');
