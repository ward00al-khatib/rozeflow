-- Little Bolt («بُرغي الصغير»), a 5×3 slot with ten lines settled on the server (spec appendix ق).
-- Same shape as play_reef: one call settles the base spin and every free spin, drawing each stop from
-- the round's stream. Lines pay 3, 4 or 5 in a row from the left. Free spins: every robot (wild) charges
-- the multiplier, three cores add spins (retrigger). The owner-set RTP scales each spin's win by
-- target_rtp / table_rtp (the paytable's exact RTP).

insert into public.games (id, name_ar, status, sort) values ('bolt', 'بُرغي الصغير', 'disabled', 8)
on conflict (id) do nothing;

create or replace function public.play_bolt(p_stake bigint, p_idempotency_key text) returns jsonb
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
  v_strips text[];          -- flattened (every strip has the same length): reel r (from 0), position i (from 0) is element r * v_len + i + 1
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
  v_cores int;
  v_wilds int;
  v_wr int;
  v_n int;
  v_first text;
  v_pay bigint;
  v_best bigint;
  v_lsyms text[];
  v_sym text;
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

  v_cfg := public.active_game_config('bolt');
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
    -- one stop per reel: unbiased_integer(len) each, one byte per try
    v_stops := '{}';
    for r in 0 .. v_reels - 1 loop
      loop
        if octet_length(v_buf) < v_pos + 1 then
          v_buf := v_buf || public.fair_block(v_pair.server_seed_enc, v_pair.client_seed, v_pair.next_nonce, 'rozeflow:v1:bolt', v_counter);
          v_counter := v_counter + 1;
        end if;
        v_x := get_byte(v_buf, v_pos) % (1 << v_bits);
        v_pos := v_pos + 1;
        exit when v_x < v_len;
      end loop;
      v_stops := v_stops || v_x;
    end loop;
    -- lines, from the left: the larger of the leading wild run and the first symbol's run (wild stands in);
    -- a scatter ends a run; 3, 4 or 5 in a row pay pays[symbol][count - 3]
    v_units := 0;
    for l in 0 .. v_nlines - 1 loop
      v_lsyms := '{}';
      for r in 0 .. v_reels - 1 loop
        v_lsyms := v_lsyms || v_strips[r * v_len + (v_stops[r + 1] + v_lines[l * v_reels + r + 1]) % v_len + 1];
      end loop;
      v_wr := 0;
      while v_wr < v_reels and v_lsyms[v_wr + 1] = v_wild loop v_wr := v_wr + 1; end loop;
      v_best := case when v_wr >= 3 then (v_pays -> v_wild ->> (v_wr - 3))::bigint else 0 end;
      if v_wr < v_reels and v_lsyms[v_wr + 1] <> v_scatter then
        v_first := v_lsyms[v_wr + 1];
        v_n := v_wr;
        while v_n < v_reels and (v_lsyms[v_n + 1] = v_first or v_lsyms[v_n + 1] = v_wild) loop v_n := v_n + 1; end loop;
        if v_n >= 3 then
          v_pay := (v_pays -> v_first ->> (v_n - 3))::bigint;
          if v_pay > v_best then v_best := v_pay; end if;
        end if;
      end if;
      v_units := v_units + v_best;
    end loop;
    -- wilds and scatters anywhere in the window
    v_cores := 0;
    v_wilds := 0;
    for r in 0 .. v_reels - 1 loop
      for w in 0 .. v_rows - 1 loop
        v_sym := v_strips[r * v_len + (v_stops[r + 1] + w) % v_len + 1];
        if v_sym = v_scatter then v_cores := v_cores + 1; end if;
        if v_sym = v_wild then v_wilds := v_wilds + 1; end if;
      end loop;
    end loop;

    if not v_free_mode then
      v_spin_gross := div(v_line_bet * v_units * v_rtp * v_den, 10000 * v_num)::bigint;
      v_base_gross := v_spin_gross;
      v_base := jsonb_build_object('stops', to_jsonb(v_stops), 'units', v_units, 'wilds', v_wilds, 'cores', v_cores, 'gross', v_spin_gross);
      if v_cores >= (v_fs ->> 'trigger_scatters')::int then
        v_free_mode := true;
        -- 3 / 4 / 5 scatters: spins_by_scatters, the largest listed count for more
        select (v_fs -> 'spins_by_scatters' ->> k)::int into v_left
          from jsonb_object_keys(v_fs -> 'spins_by_scatters') k
         where k::int <= v_cores order by k::int desc limit 1;
        v_awarded := v_left;
      end if;
    else
      -- pays at the current multiplier; then every wild charges it, and enough scatters add spins within the limit
      v_spin_gross := div(v_line_bet * v_units * v_mult * v_rtp * v_den, 10000 * v_num)::bigint;
      v_free_gross := v_free_gross + v_spin_gross;
      v_added := case when v_cores >= (v_fs ->> 'retrigger_scatters')::int
                       and v_awarded + (v_fs ->> 'retrigger_spins')::int <= (v_fs ->> 'max_total_spins')::int
                      then (v_fs ->> 'retrigger_spins')::int else 0 end;
      v_free := v_free || jsonb_build_array(jsonb_build_object(
        'stops', to_jsonb(v_stops), 'units', v_units, 'wilds', v_wilds, 'cores', v_cores, 'multiplier', v_mult,
        'added', v_added, 'gross', v_spin_gross));
      v_awarded := v_awarded + v_added;
      v_left := v_left - 1 + v_added;
      v_mult := least(v_mult + (v_fs ->> 'multiplier_step_per_wild')::int * v_wilds, (v_fs ->> 'max_multiplier')::int);
    end if;
    exit when v_left <= 0;
  end loop;

  return public.post_instant_round(v_uid, 'bolt', v_cfg, v_pair, p_stake, v_base_gross + v_free_gross,
    jsonb_build_object('stake', p_stake),
    jsonb_build_object('bet_stake', p_stake, 'base', v_base, 'free_spins', v_free,
                       'base_gross', v_base_gross, 'free_gross', v_free_gross, 'rtp_bp', v_rtp::int), v_key);
end $$;

revoke all on function public.play_bolt(bigint, text) from public, anon;
grant execute on function public.play_bolt(bigint, text) to authenticated;

-- ---------- seed data ----------
-- config/games/bolt.json as is. The table's own RTP is 96.27%; the game starts at 96.00% and the owner
-- can set any value from 90% to 99% in /admin (set_game_rtp).

insert into public.game_config_versions (game_id, version, config_json, config_hash, status, theoretical_rtp,
                                         announced_at, effective_at, change_reason)
select 'bolt', 1, j, encode(sha256(convert_to(j::text, 'UTF8')), 'hex'), 'ACTIVE', 0.9600, now(), now(), 'الإصدار الأول'
from (select $json$
{
 "game_id": "bolt",
 "config_version": 1,
 "ruleset_version": "1.0.0",
 "units": "centi_points",
 "stake_limits": {
  "min": 1000,
  "max": 100000,
  "multiple_of": 10
 },
 "rules": {
  "reels": 5,
  "rows": 3,
  "derivation": "one unbiased_integer(len(strip)) per reel = index of the top visible symbol; rows wrap around. Free spins draw their stops from the same stream, five per spin, after the base spin.",
  "symbols": {
   "high": [
    "rocket",
    "magnet",
    "bulb"
   ],
   "low": [
    "gear",
    "nut",
    "spring"
   ],
   "wild": "bot",
   "scatter": "core"
  },
  "wild_substitutes": "every symbol except the core; a run of wilds from the left pays the wild line when that is larger",
  "strips": [
   [
    "gear",
    "nut",
    "spring",
    "bulb",
    "spring",
    "rocket",
    "nut",
    "bulb",
    "nut",
    "nut",
    "spring",
    "core",
    "magnet",
    "spring",
    "gear",
    "nut",
    "gear",
    "rocket",
    "spring",
    "spring",
    "magnet",
    "rocket",
    "gear",
    "bot",
    "gear",
    "spring",
    "bulb",
    "bot",
    "nut",
    "gear",
    "bulb",
    "magnet"
   ],
   [
    "gear",
    "nut",
    "magnet",
    "spring",
    "bot",
    "gear",
    "bulb",
    "spring",
    "nut",
    "spring",
    "spring",
    "bot",
    "rocket",
    "spring",
    "gear",
    "nut",
    "magnet",
    "core",
    "gear",
    "magnet",
    "rocket",
    "nut",
    "nut",
    "gear",
    "nut",
    "spring",
    "bulb",
    "gear",
    "bulb",
    "spring",
    "bulb",
    "rocket"
   ],
   [
    "gear",
    "spring",
    "gear",
    "rocket",
    "bot",
    "spring",
    "gear",
    "bulb",
    "rocket",
    "spring",
    "spring",
    "magnet",
    "gear",
    "magnet",
    "bulb",
    "nut",
    "core",
    "magnet",
    "nut",
    "nut",
    "nut",
    "gear",
    "bulb",
    "bulb",
    "nut",
    "spring",
    "spring",
    "bot",
    "spring",
    "nut",
    "gear",
    "rocket"
   ],
   [
    "nut",
    "spring",
    "gear",
    "nut",
    "gear",
    "bulb",
    "gear",
    "spring",
    "spring",
    "core",
    "gear",
    "spring",
    "gear",
    "magnet",
    "nut",
    "spring",
    "rocket",
    "rocket",
    "rocket",
    "bot",
    "spring",
    "magnet",
    "spring",
    "magnet",
    "nut",
    "bulb",
    "bulb",
    "nut",
    "nut",
    "bot",
    "bulb",
    "gear"
   ],
   [
    "gear",
    "core",
    "rocket",
    "magnet",
    "gear",
    "spring",
    "bulb",
    "nut",
    "rocket",
    "nut",
    "bot",
    "gear",
    "magnet",
    "spring",
    "rocket",
    "gear",
    "nut",
    "spring",
    "nut",
    "bulb",
    "nut",
    "nut",
    "spring",
    "spring",
    "spring",
    "bulb",
    "bulb",
    "gear",
    "spring",
    "gear",
    "magnet",
    "bot"
   ]
  ],
  "lines": [
   [
    1,
    1,
    1,
    1,
    1
   ],
   [
    0,
    0,
    0,
    0,
    0
   ],
   [
    2,
    2,
    2,
    2,
    2
   ],
   [
    0,
    1,
    2,
    1,
    0
   ],
   [
    2,
    1,
    0,
    1,
    2
   ],
   [
    0,
    0,
    1,
    2,
    2
   ],
   [
    2,
    2,
    1,
    0,
    0
   ],
   [
    1,
    0,
    0,
    0,
    1
   ],
   [
    1,
    2,
    2,
    2,
    1
   ],
   [
    0,
    1,
    1,
    1,
    0
   ]
  ],
  "line_rule": "pays from the leftmost reel: 3, 4 or 5 of the same symbol in a row (wild stands in); a core breaks the line; one win per line, the larger of the symbol run and the leading wild run",
  "free_spins": {
   "trigger_scatters": 3,
   "spins_by_scatters": {
    "3": 10,
    "4": 12,
    "5": 15
   },
   "start_multiplier": 1,
   "multiplier_step_per_wild": 1,
   "max_multiplier": 15,
   "retrigger_scatters": 3,
   "retrigger_spins": 5,
   "max_total_spins": 30,
   "same_strips": true,
   "order": "a free spin pays at the current multiplier; then each wild it shows adds the step (up to the maximum), and three or more cores add retrigger_spins while the total stays within max_total_spins"
  }
 },
 "payout_model": {
  "line_bet": "stake / 10 (all ten lines always play)",
  "pays": {
   "bot": [
    40,
    200,
    1000
   ],
   "rocket": [
    20,
    80,
    400
   ],
   "magnet": [
    12,
    50,
    200
   ],
   "bulb": [
    10,
    30,
    120
   ],
   "gear": [
    4,
    12,
    50
   ],
   "nut": [
    3,
    10,
    40
   ],
   "spring": [
    3,
    6,
    25
   ]
  },
  "pays_note": "line bets for 3, 4 and 5 in a row from the left",
  "table_rtp": {
   "num": "169914555848326859442931622132775321308911265714251923401873261887388642647816287293342656082827296142987884568089282219896193003836576817025658004811772286667239038586428326588853696063246660756038235763497231278414257",
   "den": "176500872419263593559319302637789241459459619490723595292712620678918364397574906244117120062201874810681116593642749786132706054117399434226659568030434131651924755717669757535789504530793970482734834967427158147858432"
  },
  "rtp_scaling": "every spin's win is multiplied by target_rtp / table_rtp and floored to a centi-point",
  "par": {
   "base_rtp": "22893441/33554432",
   "base_hit_frequency": 0.432953,
   "base_max_line_bet_units": 1828,
   "free_spins_one_in": 140.36,
   "avg_free_spins": 10.48,
   "avg_free_multiplier": 5.51,
   "max_round_line_bet_units": 824428
  },
  "max_gross_payout": 8500000000,
  "target_rtp_bp": 9600,
  "declared_rtp": "0.962684 (exact table_rtp; boltExactRtp in src/lib/games/bolt.ts)"
 },
 "fairness": {
  "rng_algorithm_version": "1.0",
  "game_domain": "rozeflow:v1:bolt"
 }
}
$json$::jsonb as j) s
on conflict (game_id, version) do nothing;

update public.games set status = 'enabled' where id = 'bolt';
