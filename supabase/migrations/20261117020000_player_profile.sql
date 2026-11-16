-- Player profile (spec appendix ك): summary for any member, full round history for the player and the owner.

create or replace function public.player_profile(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.require_profile();
  v_p public.profiles;
  v_sum jsonb;
  v_games jsonb;
  v_best jsonb;
  v_fav jsonb;
begin
  select * into v_p from public.profiles where user_id = p_user and status = 'active';
  if not found then
    raise exception 'PLAYER_NOT_FOUND' using errcode = '22023';
  end if;

  select jsonb_build_object(
           'rounds', count(*), 'wagered', coalesce(sum(stake), 0)::bigint,
           'paid', coalesce(sum(gross_payout), 0)::bigint, 'net', coalesce(sum(net_result), 0)::bigint,
           'wins', count(*) filter (where net_result > 0),
           'best_multiplier_bp', coalesce(max(gross_payout * 10000 / stake) filter (where gross_payout > 0), 0)::bigint,
           'first_round_at', min(settled_at), 'last_round_at', max(settled_at))
    into v_sum
    from public.game_rounds where user_id = p_user and status = 'SETTLED';

  select coalesce(jsonb_agg(x order by x.rounds desc, x.game_id), '[]'::jsonb) into v_games
  from (
    select r.game_id, g.name_ar, count(*) as rounds, sum(r.stake)::bigint as wagered,
           sum(r.net_result)::bigint as net, count(*) filter (where r.net_result > 0) as wins,
           coalesce(max(r.gross_payout * 10000 / r.stake) filter (where r.gross_payout > 0), 0)::bigint as best_multiplier_bp
    from public.game_rounds r join public.games g on g.id = r.game_id
    where r.user_id = p_user and r.status = 'SETTLED'
    group by r.game_id, g.name_ar
  ) x;
  v_fav := v_games -> 0;

  select to_jsonb(x) into v_best
  from (
    select r.game_id, g.name_ar, r.stake, r.gross_payout as gross, r.net_result as net,
           (r.gross_payout * 10000 / r.stake)::bigint as multiplier_bp, r.settled_at as at
    from public.game_rounds r join public.games g on g.id = r.game_id
    where r.user_id = p_user and r.status = 'SETTLED' and r.net_result > 0
    order by r.net_result desc, r.settled_at
    limit 1
  ) x;

  return jsonb_build_object(
    'user_id', v_p.user_id, 'display_name', v_p.display_name, 'role', v_p.role, 'joined_at', v_p.created_at,
    'me', p_user = v_uid, 'can_see_history', p_user = v_uid or public.is_owner(),
    'summary', v_sum, 'games', v_games, 'favourite', v_fav, 'biggest_win', v_best);
end $$;

-- Settled rounds, newest first, in pages. Only the player and the owner may read them.
create or replace function public.player_rounds(p_user uuid, p_offset int default 0,
                                                p_game text default null, p_limit int default 50)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.require_profile();
begin
  if p_user <> v_uid and not public.is_owner() then
    raise exception 'HISTORY_PRIVATE' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(x order by x.at desc, x.round_id), '[]'::jsonb)
    from (
      select r.id as round_id, r.game_id, g.name_ar, r.stake, r.gross_payout as gross, r.net_result as net,
             (r.gross_payout * 10000 / r.stake)::bigint as multiplier_bp, r.settled_at as at, r.nonce,
             r.outcome ->> 'rtp_bp' as rtp_bp
      from public.game_rounds r join public.games g on g.id = r.game_id
      where r.user_id = p_user and r.status = 'SETTLED'
        and (p_game is null or r.game_id = p_game)
      order by r.settled_at desc, r.id
      limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
    ) x);
end $$;

create index if not exists game_rounds_user_settled_idx on public.game_rounds (user_id, settled_at desc) where status = 'SETTLED';

revoke all on function public.player_profile(uuid) from public, anon;
revoke all on function public.player_rounds(uuid, int, text, int) from public, anon;
grant execute on function public.player_profile(uuid) to authenticated;
grant execute on function public.player_rounds(uuid, int, text, int) to authenticated;
