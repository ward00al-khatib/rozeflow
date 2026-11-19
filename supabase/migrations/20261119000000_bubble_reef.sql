-- Bubble Reef («شعاب الفقاعات»), a 3×3 slot settled on the server (spec appendix ص).
-- Same shape as play_slots: one call settles the base spin and every free spin, drawing each stop from
-- the round's stream. Free spins: each chest grows the multiplier, three chests add spins (retrigger).
-- The owner-set RTP scales each spin's win by target_rtp / table_rtp (the paytable's exact RTP).

insert into public.games (id, name_ar, status, sort) values ('reef', 'شعاب الفقاعات', 'disabled', 7)
on conflict (id) do nothing;

create or replace function public.play_reef(p_stake bigint, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.require_member();
  v_key text;
  v_wallet public.wallet_accounts;
  v_replay jsonb;
  v_cfg public.game_config_versions;
  v_c jsonb;
  v_fs jsonb;
  v_pair public.seed_pairs;
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
  v_chests int;
  v_line_sym text;
  v_sym text;
  v_ok boolean;
  v_spin_gross bigint;
  -- round
  v_free_mode boolean := false;
  v_left int := 0;
  v_awarded int := 0;
  v_added int;
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

  v_cfg := public.active_game_config('reef');
  v_c := v_cfg.config_json;
  if p_stake is null
     or p_stake < (v_c #>> '{stake_limits,min}')::bigint
     or p_stake > (v_c #>> '{stake_limits,max}')::bigint
     or p_stake % (v_c #>> '{stake_limits,multiple_of}')::bigint <> 0 then
    raise exception 'STAKE_OUT_OF_RANGE' using errcode = '22023';
  end if;
  if v_wallet.available < p_stake then
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
  v_fs := v_c #> '{rules,free_spins}';
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
  v_pair.server_seed_enc := public.seed_plain(v_pair.server_seed_enc);  -- decrypt once for the whole round
  v_mult := (v_fs ->> 'start_multiplier')::int;

  -- The base spin first, then free spins while any are left.
  loop
    -- three stops: unbiased_integer(len) each, one byte per try
    v_stops := '{}';
    for r in 0 .. v_reels - 1 loop
      loop
        if octet_length(v_buf) < v_pos + 1 then
          v_buf := v_buf || public.fair_block(v_pair.server_seed_enc, v_pair.client_seed, v_pair.next_nonce, 'rozeflow:v1:reef', v_counter);
          v_counter := v_counter + 1;
        end if;
        v_x := get_byte(v_buf, v_pos) % (1 << v_bits);
        v_pos := v_pos + 1;
        exit when v_x < v_len;
      end loop;
      v_stops := v_stops || v_x;
    end loop;
    -- lines: every symbol the same, the wild stands in; a chest breaks the line; three wilds pay the wild line
    v_units := 0;
    for l in 0 .. v_nlines - 1 loop
      v_line_sym := null;
      v_ok := true;
      for r in 0 .. v_reels - 1 loop
        v_sym := v_strips[r * v_len + (v_stops[r + 1] + v_lines[l * v_reels + r + 1]) % v_len + 1];
        if v_sym = v_scatter then v_ok := false; exit; end if;
        if v_sym <> v_wild then
          if v_line_sym is null then v_line_sym := v_sym;
          elsif v_line_sym <> v_sym then v_ok := false; exit;
          end if;
        end if;
      end loop;
      if v_ok then
        v_units := v_units + (v_pays ->> coalesce(v_line_sym, v_wild))::bigint;
      end if;
    end loop;
    -- chests anywhere in the window
    v_chests := 0;
    for r in 0 .. v_reels - 1 loop
      for w in 0 .. v_rows - 1 loop
        if v_strips[r * v_len + (v_stops[r + 1] + w) % v_len + 1] = v_scatter then v_chests := v_chests + 1; end if;
      end loop;
    end loop;

    if not v_free_mode then
      v_spin_gross := div(v_line_bet * v_units * v_rtp * v_den, 10000 * v_num)::bigint;
      v_base_gross := v_spin_gross;
      v_base := jsonb_build_object('stops', to_jsonb(v_stops), 'units', v_units, 'chests', v_chests, 'gross', v_spin_gross);
      if v_chests >= (v_fs ->> 'trigger_scatters')::int then
        v_free_mode := true;
        v_left := (v_fs ->> 'spins')::int;
        v_awarded := v_left;
      end if;
    else
      -- pays at the current multiplier; then chests grow it, and enough chests add spins within the limit
      v_spin_gross := div(v_line_bet * v_units * v_mult * v_rtp * v_den, 10000 * v_num)::bigint;
      v_free_gross := v_free_gross + v_spin_gross;
      v_added := case when v_chests >= (v_fs ->> 'retrigger_scatters')::int
                       and v_awarded + (v_fs ->> 'retrigger_spins')::int <= (v_fs ->> 'max_total_spins')::int
                      then (v_fs ->> 'retrigger_spins')::int else 0 end;
      v_free := v_free || jsonb_build_array(jsonb_build_object(
        'stops', to_jsonb(v_stops), 'units', v_units, 'chests', v_chests, 'multiplier', v_mult,
        'added', v_added, 'gross', v_spin_gross));
      v_awarded := v_awarded + v_added;
      v_left := v_left - 1 + v_added;
      v_mult := least(v_mult + (v_fs ->> 'multiplier_step_per_scatter')::int * v_chests, (v_fs ->> 'max_multiplier')::int);
    end if;
    exit when v_left <= 0;
  end loop;

  return public.post_instant_round(v_uid, 'reef', v_cfg, v_pair, p_stake, v_base_gross + v_free_gross,
    jsonb_build_object('stake', p_stake),
    jsonb_build_object('bet_stake', p_stake, 'base', v_base, 'free_spins', v_free,
                       'base_gross', v_base_gross, 'free_gross', v_free_gross, 'rtp_bp', v_rtp::int), v_key);
end $$;

revoke all on function public.play_reef(bigint, text) from public, anon;
grant execute on function public.play_reef(bigint, text) to authenticated;

-- ---------- seed data ----------
-- config/games/reef.json as is. The table's own RTP is 95.84%; the game starts at 96.00% and the owner
-- can set any value from 90% to 99% in /admin (set_game_rtp).

insert into public.game_config_versions (game_id, version, config_json, config_hash, status, theoretical_rtp,
                                         announced_at, effective_at, change_reason)
select 'reef', 1, j, encode(sha256(convert_to(j::text, 'UTF8')), 'hex'), 'ACTIVE', 0.9600, now(), now(), 'الإصدار الأول'
from (select $json$
{
 "game_id": "reef",
 "config_version": 1,
 "ruleset_version": "1.0.0",
 "units": "centi_points",
 "stake_limits": {
  "min": 1000,
  "max": 100000,
  "multiple_of": 10
 },
 "rules": {
  "reels": 3,
  "rows": 3,
  "derivation": "one unbiased_integer(len(strip)) per reel = index of the top visible symbol; rows wrap around. Free spins draw their stops from the same stream, three per spin, after the base spin.",
  "symbols": {
   "high": [
    "puffer",
    "octo",
    "crab"
   ],
   "low": [
    "jelly",
    "star",
    "shell"
   ],
   "wild": "pearl",
   "scatter": "chest"
  },
  "wild_substitutes": "every symbol except the chest; three wilds on a line pay the wild line",
  "strips": [
   [
    "star",
    "crab",
    "jelly",
    "crab",
    "octo",
    "jelly",
    "star",
    "shell",
    "puffer",
    "star",
    "pearl",
    "octo",
    "shell",
    "crab",
    "jelly",
    "chest",
    "octo",
    "puffer",
    "pearl",
    "shell",
    "star",
    "shell",
    "crab",
    "star",
    "chest",
    "shell",
    "star",
    "jelly",
    "shell",
    "jelly"
   ],
   [
    "pearl",
    "shell",
    "star",
    "jelly",
    "crab",
    "chest",
    "crab",
    "shell",
    "jelly",
    "crab",
    "shell",
    "star",
    "shell",
    "jelly",
    "pearl",
    "shell",
    "star",
    "jelly",
    "puffer",
    "star",
    "jelly",
    "puffer",
    "shell",
    "star",
    "octo",
    "chest",
    "octo",
    "crab",
    "star",
    "octo"
   ],
   [
    "octo",
    "star",
    "crab",
    "jelly",
    "puffer",
    "star",
    "jelly",
    "star",
    "pearl",
    "crab",
    "star",
    "jelly",
    "pearl",
    "shell",
    "octo",
    "shell",
    "crab",
    "shell",
    "jelly",
    "puffer",
    "shell",
    "star",
    "octo",
    "chest",
    "star",
    "jelly",
    "shell",
    "crab",
    "shell",
    "chest"
   ]
  ],
  "lines": [
   [
    0,
    0,
    0
   ],
   [
    1,
    1,
    1
   ],
   [
    2,
    2,
    2
   ],
   [
    0,
    1,
    2
   ],
   [
    2,
    1,
    0
   ]
  ],
  "line_rule": "three of the same symbol on a line (wild stands in); a chest on a line breaks it; one win per line",
  "free_spins": {
   "trigger_scatters": 3,
   "spins": 8,
   "start_multiplier": 1,
   "multiplier_step_per_scatter": 1,
   "max_multiplier": 20,
   "retrigger_scatters": 3,
   "retrigger_spins": 5,
   "max_total_spins": 28,
   "same_strips": true,
   "order": "a free spin pays at the current multiplier; then each chest it shows adds the step (up to the maximum), and three chests add retrigger_spins while the total stays within max_total_spins"
  }
 },
 "payout_model": {
  "line_bet": "stake / 5 (all five lines always play)",
  "pays": {
   "pearl": 200,
   "puffer": 50,
   "octo": 25,
   "crab": 18,
   "jelly": 12,
   "star": 7,
   "shell": 5
  },
  "pays_note": "line bets for three of a kind",
  "table_rtp": {
   "num": "445947216355679684440426380288825776438749342374916493597605693",
   "den": "465289094561078067115167389289354105130769312381744384765625000"
  },
  "rtp_scaling": "every spin's win is multiplied by target_rtp / table_rtp and floored to a centi-point",
  "par": {
   "base_rtp": "21137/27000",
   "base_hit_frequency": 0.272704,
   "base_max_line_bet_units": 250,
   "free_spins_one_in": 125,
   "avg_free_spins": 8.33,
   "avg_free_multiplier": 3.36,
   "max_round_line_bet_units": 122750
  },
  "max_gross_payout": 2600000000,
  "target_rtp_bp": 9600,
  "declared_rtp": "0.958430 (exact table_rtp; reefExactRtp in src/lib/games/reef.ts)"
 },
 "fairness": {
  "rng_algorithm_version": "1.0",
  "game_domain": "rozeflow:v1:reef"
 }
}
$json$::jsonb as j) s
on conflict (game_id, version) do nothing;

update public.games set status = 'enabled' where id = 'reef';
