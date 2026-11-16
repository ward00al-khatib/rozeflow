-- Slots on the server (spec 4.3 ruleset 2.0, appendices و، ز، ح). One call settles the base spin and any
-- free spins, like the browser version: play_slots draws every stop from the round's stream.
-- The owner-set RTP scales each spin's win by target_rtp / table_rtp (the paytable's exact RTP).

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

revoke all on function public.play_slots(bigint, boolean, text) from public, anon;
grant execute on function public.play_slots(bigint, boolean, text) to authenticated;

-- ---------- seed data ----------
-- config/games/slots.json plus target_rtp_bp. 95.83% is the paytable's own RTP rounded to a basis point.

insert into public.game_config_versions (game_id, version, config_json, config_hash, status, theoretical_rtp,
                                         announced_at, effective_at, change_reason)
select 'slots', 1, j, encode(sha256(convert_to(j::text, 'UTF8')), 'hex'), 'ACTIVE', 0.9583, now(), now(), 'الإصدار الأول'
from (select $json$
{
 "game_id": "slots",
 "config_version": 1,
 "ruleset_version": "2.0.0",
 "units": "centi_points",
 "stake_limits": {
  "min": 1000,
  "max": 100000,
  "multiple_of": 20
 },
 "rules": {
  "reels": 5,
  "rows": 5,
  "derivation": "one unbiased_integer(len(strip)) per reel = index of the top visible symbol; rows wrap around. Free spins draw their stops from the same stream, five per spin, after the base spin.",
  "symbols": {
   "high": [
    "atom",
    "crystal",
    "flask",
    "planet",
    "bolt"
   ],
   "low": [
    "ring",
    "tri",
    "square",
    "diamond"
   ],
   "wild": "wild",
   "scatter": "scatter"
  },
  "wild_substitutes": "every symbol except scatter; appears on reels 2-4 only",
  "strips": [
   [
    "planet",
    "ring",
    "diamond",
    "planet",
    "bolt",
    "crystal",
    "ring",
    "square",
    "diamond",
    "square",
    "tri",
    "diamond",
    "square",
    "diamond",
    "flask",
    "diamond",
    "bolt",
    "bolt",
    "atom",
    "bolt",
    "flask",
    "diamond",
    "ring",
    "tri",
    "square",
    "planet",
    "diamond",
    "tri",
    "bolt",
    "ring",
    "tri",
    "planet",
    "tri",
    "scatter",
    "square",
    "square",
    "flask",
    "crystal",
    "crystal",
    "square",
    "atom",
    "diamond",
    "square",
    "flask",
    "ring",
    "tri",
    "diamond",
    "ring",
    "diamond",
    "tri"
   ],
   [
    "square",
    "tri",
    "wild",
    "square",
    "tri",
    "flask",
    "tri",
    "ring",
    "diamond",
    "wild",
    "bolt",
    "square",
    "crystal",
    "ring",
    "wild",
    "bolt",
    "ring",
    "square",
    "planet",
    "wild",
    "bolt",
    "diamond",
    "wild",
    "bolt",
    "ring",
    "diamond",
    "scatter",
    "tri",
    "flask",
    "flask",
    "planet",
    "diamond",
    "atom",
    "atom",
    "diamond",
    "diamond",
    "ring",
    "tri",
    "ring",
    "square",
    "flask",
    "wild",
    "planet",
    "bolt",
    "crystal",
    "crystal",
    "planet",
    "tri",
    "square",
    "planet"
   ],
   [
    "bolt",
    "wild",
    "atom",
    "flask",
    "bolt",
    "planet",
    "bolt",
    "crystal",
    "wild",
    "tri",
    "square",
    "bolt",
    "wild",
    "bolt",
    "planet",
    "planet",
    "wild",
    "atom",
    "flask",
    "diamond",
    "square",
    "ring",
    "tri",
    "tri",
    "wild",
    "flask",
    "crystal",
    "tri",
    "crystal",
    "ring",
    "flask",
    "tri",
    "square",
    "square",
    "planet",
    "scatter",
    "ring",
    "square",
    "diamond",
    "wild",
    "diamond",
    "planet",
    "ring",
    "square",
    "diamond",
    "diamond",
    "ring",
    "wild",
    "ring",
    "tri"
   ],
   [
    "scatter",
    "square",
    "tri",
    "planet",
    "wild",
    "diamond",
    "square",
    "diamond",
    "diamond",
    "tri",
    "ring",
    "tri",
    "planet",
    "ring",
    "tri",
    "ring",
    "flask",
    "square",
    "diamond",
    "wild",
    "tri",
    "planet",
    "ring",
    "crystal",
    "bolt",
    "planet",
    "bolt",
    "wild",
    "crystal",
    "crystal",
    "wild",
    "ring",
    "square",
    "ring",
    "wild",
    "flask",
    "diamond",
    "square",
    "bolt",
    "square",
    "bolt",
    "flask",
    "planet",
    "flask",
    "atom",
    "wild",
    "diamond",
    "tri",
    "bolt",
    "atom"
   ],
   [
    "square",
    "tri",
    "diamond",
    "ring",
    "diamond",
    "flask",
    "scatter",
    "square",
    "atom",
    "diamond",
    "atom",
    "planet",
    "diamond",
    "bolt",
    "square",
    "crystal",
    "square",
    "bolt",
    "crystal",
    "square",
    "diamond",
    "bolt",
    "crystal",
    "diamond",
    "ring",
    "diamond",
    "planet",
    "ring",
    "ring",
    "tri",
    "square",
    "diamond",
    "square",
    "flask",
    "diamond",
    "square",
    "tri",
    "planet",
    "tri",
    "bolt",
    "diamond",
    "ring",
    "tri",
    "flask",
    "tri",
    "planet",
    "ring",
    "flask",
    "bolt",
    "tri"
   ]
  ],
  "lines": [
   [
    0,
    0,
    0,
    0,
    0
   ],
   [
    1,
    1,
    1,
    1,
    1
   ],
   [
    2,
    2,
    2,
    2,
    2
   ],
   [
    3,
    3,
    3,
    3,
    3
   ],
   [
    4,
    4,
    4,
    4,
    4
   ],
   [
    0,
    1,
    2,
    1,
    0
   ],
   [
    4,
    3,
    2,
    3,
    4
   ],
   [
    1,
    2,
    3,
    2,
    1
   ],
   [
    3,
    2,
    1,
    2,
    3
   ],
   [
    0,
    1,
    0,
    1,
    0
   ],
   [
    4,
    3,
    4,
    3,
    4
   ],
   [
    1,
    0,
    1,
    0,
    1
   ],
   [
    3,
    4,
    3,
    4,
    3
   ],
   [
    2,
    1,
    2,
    1,
    2
   ],
   [
    2,
    3,
    2,
    3,
    2
   ],
   [
    0,
    1,
    2,
    3,
    4
   ],
   [
    4,
    3,
    2,
    1,
    0
   ],
   [
    1,
    2,
    1,
    2,
    1
   ],
   [
    3,
    2,
    3,
    2,
    3
   ],
   [
    2,
    1,
    0,
    1,
    2
   ]
  ],
  "line_rule": "left to right from reel 1, three or more of the same symbol (or wild) in a row; one win per line",
  "free_spins": {
   "scatters_to_spins": {
    "3": 10,
    "4": 15,
    "5": 20
   },
   "start_multiplier": 1,
   "multiplier_step_after_win": 1,
   "retrigger": false,
   "same_strips": true
  },
  "buy_feature": {
   "price_multiplier": 27,
   "spins": 10
  }
 },
 "payout_model": {
  "line_bet": "stake / 20 (all twenty lines always play)",
  "pays": {
   "atom": [
    50,
    250,
    1000
   ],
   "crystal": [
    30,
    100,
    400
   ],
   "flask": [
    20,
    60,
    200
   ],
   "planet": [
    15,
    50,
    150
   ],
   "bolt": [
    10,
    30,
    100
   ],
   "ring": [
    5,
    15,
    30
   ],
   "tri": [
    5,
    15,
    30
   ],
   "square": [
    3,
    8,
    25
   ],
   "diamond": [
    3,
    8,
    25
   ]
  },
  "pays_note": "line bets for 3, 4 and 5 of a kind",
  "declared_rtp": "0.958308 (exact 93584773924094013/97656250000000000, see slots.test.ts and scripts/slots_par.py)",
  "table_rtp": {
   "num": "93584773924094013",
   "den": "97656250000000000"
  },
  "rtp_scaling": "when the owner sets target_rtp_bp, every spin's win is multiplied by target_rtp / table_rtp and floored to a centi-point",
  "declared_buy_rtp": "0.944157 (exact 8298253238143/8789062500000)",
  "par": {
   "base_hits": 174107500,
   "base_spins": 312500000,
   "base_hit_frequency": 0.557144,
   "base_max_line_bet_units": 2060,
   "free_spins_one_in": 116.8
  },
  "max_gross_payout": 2250000000,
  "target_rtp_bp": 9583
 },
 "fairness": {
  "rng_algorithm_version": "1.0",
  "game_domain": "rozeflow:v1:slots"
 }
}
$json$::jsonb as j) s
on conflict (game_id, version) do nothing;

update public.games set status = 'enabled' where id = 'slots';
