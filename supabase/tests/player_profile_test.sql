-- Behavioural checks for player profiles (spec appendix ك).
\set QUIET on
begin;
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2'),
  ('00000000-0000-0000-0000-0000000000c3');

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'session_id', 'sess-' || uid, 'aal', 'aal2')::text, true);
  -- a test transaction has one now(), so every round looks simultaneous: lift the rate limit
  insert into public.site_settings (key, value) values ('round_rate_limit', '1000000')
  on conflict (key) do update set value = excluded.value;
  if uid <> '' then perform public.register_device('device-key-' || replace(uid, '-', ''), 'test'); end if;
end $$;

create function pg_temp.expect_fail(stmt text, code text) returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when others then
    if sqlerrm <> code then raise exception 'expected %, got %', code, sqlerrm; end if;
    raise notice 'ok: %', code; return;
  end;
  raise exception 'expected failure: %', code;
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.complete_join('ward', true, true);
do $$ begin perform public.claim_ownership(); end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select public.complete_join('other', true, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select public.complete_join('friend', true, true);

-- friend plays 30 dice rounds and 5 plinko rounds
do $$ begin
  for i in 1..30 loop perform public.play_dice(1000, 3000, 'under', 'prof-dice-' || lpad(i::text, 6, '0')); end loop;
  for i in 1..5 loop perform public.play_plinko(2000, 8, 'low', 'prof-plinko-' || lpad(i::text, 6, '0')); end loop;
end $$;

do $$
declare p jsonb; h jsonb; h2 jsonb; s jsonb;
begin
  p := public.player_profile('00000000-0000-0000-0000-0000000000b2');
  s := p -> 'summary';
  if not (p ->> 'me')::boolean or not (p ->> 'can_see_history')::boolean then raise exception 'own flags wrong'; end if;
  if (s ->> 'rounds')::int <> 35 or (s ->> 'wagered')::bigint <> 40000 then raise exception 'summary wrong: %', s; end if;
  if (s ->> 'net')::bigint <> (select sum(net_result) from public.game_rounds where user_id = auth.uid()) then
    raise exception 'net wrong';
  end if;
  if p -> 'favourite' ->> 'game_id' <> 'dice' or jsonb_array_length(p -> 'games') <> 2 then raise exception 'favourite wrong: %', p; end if;
  if (s ->> 'wins')::int > 0 and (p -> 'biggest_win' ->> 'net')::bigint <> (select max(net_result) from public.game_rounds where user_id = auth.uid()) then
    raise exception 'biggest win wrong: %', p -> 'biggest_win';
  end if;

  h := public.player_rounds('00000000-0000-0000-0000-0000000000b2', 0, null, 20);
  if jsonb_array_length(h) <> 20 then raise exception 'page size wrong'; end if;
  h2 := public.player_rounds('00000000-0000-0000-0000-0000000000b2', 20, null, 50);
  if jsonb_array_length(h2) <> 15 or exists (select 1 from jsonb_array_elements(h) a, jsonb_array_elements(h2) b
                                              where a ->> 'round_id' = b ->> 'round_id') then
    raise exception 'second page wrong';
  end if;
  if jsonb_array_length(public.player_rounds('00000000-0000-0000-0000-0000000000b2', 0, 'plinko', 50)) <> 5 then
    raise exception 'game filter wrong';
  end if;
  if jsonb_array_length(public.player_rounds('00000000-0000-0000-0000-0000000000b2', 0, null, 500)) <> 35 then
    raise exception 'full history wrong';
  end if;
end $$;

-- another member sees the summary but not the history
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
do $$
declare p jsonb;
begin
  p := public.player_profile('00000000-0000-0000-0000-0000000000b2');
  if (p ->> 'me')::boolean or (p ->> 'can_see_history')::boolean then raise exception 'other flags wrong'; end if;
  if (p -> 'summary' ->> 'rounds')::int <> 35 then raise exception 'summary hidden'; end if;
  p := public.player_profile('00000000-0000-0000-0000-0000000000c3');
  if (p -> 'summary' ->> 'rounds')::int <> 0 or p -> 'biggest_win' <> 'null'::jsonb and p -> 'biggest_win' is not null then
    raise exception 'empty profile wrong: %', p;
  end if;
end $$;
select pg_temp.expect_fail($$select public.player_rounds('00000000-0000-0000-0000-0000000000b2')$$, 'HISTORY_PRIVATE');
select pg_temp.expect_fail($$select public.player_profile('00000000-0000-0000-0000-0000000000ff')$$, 'PLAYER_NOT_FOUND');

-- the owner sees the history
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  if jsonb_array_length(public.player_rounds('00000000-0000-0000-0000-0000000000b2')) <> 35 then raise exception 'owner history'; end if;
  if not (public.player_profile('00000000-0000-0000-0000-0000000000b2') ->> 'can_see_history')::boolean then raise exception 'owner flag'; end if;
end $$;

do $$ begin raise notice 'player_profile_test: all checks passed'; end $$;
rollback;
