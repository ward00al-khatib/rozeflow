-- Advertiser coupons (spec appendix ف), at the owner's request.
-- The owner adds advertisers and their discount coupons in /admin. Members get coupons for FREE: either any member
-- claims one copy, or the owner awards a coupon to the weekly leaderboard's top players or to one player.
-- By design there is no link between coupons and points: no price column, no wallet access, no ledger entry.
-- Points cannot be bought, sold, withdrawn or exchanged for anything, and a coupon is never paid for with points.

create table public.advertisers (
  id         bigint generated always as identity primary key,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  logo_url   text check (logo_url is null or (logo_url ~ '^https://' and char_length(logo_url) <= 500)),
  link_url   text check (link_url is null or (link_url ~ '^https://' and char_length(link_url) <= 500)),
  status     text not null default 'active' check (status in ('active', 'hidden')),
  created_by uuid not null references public.profiles (user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.coupons (
  id            bigint generated always as identity primary key,
  advertiser_id bigint not null references public.advertisers (id),
  offer         text not null check (char_length(btrim(offer)) between 1 and 200),
  code          text not null check (char_length(btrim(code)) between 1 and 60),
  audience      text not null check (audience in ('all', 'award')),  -- all: any member claims; award: owner gives
  quantity      int not null check (quantity between 1 and 100000),
  expires_at    timestamptz not null,
  status        text not null default 'active' check (status in ('active', 'paused')),
  created_by    uuid not null references public.profiles (user_id),
  created_at    timestamptz not null default now()
);

-- One coupon per member, ever. Rows are never changed or deleted.
create table public.coupon_claims (
  coupon_id  bigint not null references public.coupons (id),
  user_id    uuid not null references public.profiles (user_id),
  source     text not null check (source in ('claim', 'award')),
  awarded_by uuid references public.profiles (user_id),
  note       text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  primary key (coupon_id, user_id),
  check ((source = 'award') = (awarded_by is not null))
);
create trigger coupon_claims_append_only before update or delete on public.coupon_claims
  for each row execute function public.forbid_mutation();

-- Everything goes through the functions below.
alter table public.advertisers enable row level security;
alter table public.coupons enable row level security;
alter table public.coupon_claims enable row level security;
revoke all on public.advertisers, public.coupons, public.coupon_claims from anon, authenticated;

create or replace function public.coupon_remaining(p_coupon bigint) returns int
language sql stable security definer set search_path = public as $$
  select c.quantity - (select count(*)::int from public.coupon_claims k where k.coupon_id = c.id)
  from public.coupons c where c.id = p_coupon
$$;

-- ---------- members ----------

-- Coupons a member can still claim (no code shown) and the coupons they hold (with the code).
create or replace function public.my_coupons() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.require_profile();
begin
  if public.is_agent(v_uid) then
    return jsonb_build_object('agent', true, 'available', '[]'::jsonb, 'mine', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'agent', false,
    'available', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', c.id, 'offer', c.offer, 'expires_at', c.expires_at,
               'remaining', public.coupon_remaining(c.id), 'quantity', c.quantity,
               'advertiser', a.name, 'logo_url', a.logo_url, 'link_url', a.link_url) order by c.expires_at), '[]'::jsonb)
      from public.coupons c join public.advertisers a on a.id = c.advertiser_id
      where c.audience = 'all' and c.status = 'active' and a.status = 'active' and c.expires_at > now()
        and public.coupon_remaining(c.id) > 0
        and not exists (select 1 from public.coupon_claims k where k.coupon_id = c.id and k.user_id = v_uid)),
    'mine', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', c.id, 'offer', c.offer, 'code', c.code, 'expires_at', c.expires_at,
               'expired', c.expires_at <= now(), 'source', k.source, 'note', k.note, 'got_at', k.created_at,
               'advertiser', a.name, 'logo_url', a.logo_url, 'link_url', a.link_url) order by k.created_at desc), '[]'::jsonb)
      from public.coupon_claims k
      join public.coupons c on c.id = k.coupon_id
      join public.advertisers a on a.id = c.advertiser_id
      where k.user_id = v_uid));
end $$;

-- Claim one copy of a coupon open to all members. Free: nothing is taken from the wallet. Calling it again for a
-- coupon the member already holds just returns the code.
create or replace function public.claim_coupon(p_coupon bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_member();
  c public.coupons;
  a public.advertisers;
begin
  if public.is_agent(v_uid) then
    raise exception 'AGENT_NO_COUPONS' using errcode = '42501';
  end if;
  select * into c from public.coupons where id = p_coupon for update;  -- serialises the quantity check
  if not found then
    raise exception 'COUPON_NOT_FOUND' using errcode = '22023';
  end if;
  if exists (select 1 from public.coupon_claims where coupon_id = c.id and user_id = v_uid) then
    return jsonb_build_object('id', c.id, 'code', c.code, 'already', true);
  end if;
  select * into a from public.advertisers where id = c.advertiser_id;
  if c.audience <> 'all' then
    raise exception 'COUPON_NOT_FOUND' using errcode = '22023';
  end if;
  if c.status <> 'active' or a.status <> 'active' then
    raise exception 'COUPON_PAUSED' using errcode = '22023';
  end if;
  if c.expires_at <= now() then
    raise exception 'COUPON_EXPIRED' using errcode = '22023';
  end if;
  if public.coupon_remaining(c.id) <= 0 then
    raise exception 'COUPON_SOLD_OUT' using errcode = '22023';
  end if;
  insert into public.coupon_claims (coupon_id, user_id, source) values (c.id, v_uid, 'claim');
  return jsonb_build_object('id', c.id, 'code', c.code, 'already', false);
end $$;

-- ---------- owner ----------

create or replace function public.owner_save_advertiser(p_id bigint, p_name text, p_logo_url text, p_link_url text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := public.require_owner();
  v_before public.advertisers;
  v public.advertisers;
begin
  p_logo_url := nullif(btrim(coalesce(p_logo_url, '')), '');
  p_link_url := nullif(btrim(coalesce(p_link_url, '')), '');
  if (p_logo_url is not null and p_logo_url !~ '^https://') or (p_link_url is not null and p_link_url !~ '^https://') then
    raise exception 'URL_NOT_HTTPS' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 60 then
    raise exception 'BAD_NAME' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.advertisers (name, logo_url, link_url, created_by)
    values (btrim(p_name), p_logo_url, p_link_url, v_admin) returning * into v;
  else
    select * into v_before from public.advertisers where id = p_id for update;
    if not found then
      raise exception 'ADVERTISER_NOT_FOUND' using errcode = '22023';
    end if;
    update public.advertisers set name = btrim(p_name), logo_url = p_logo_url, link_url = p_link_url, updated_at = now()
     where id = p_id returning * into v;
  end if;
  insert into public.admin_audit_logs (admin_id, action, target, before_json, after_json)
  values (v_admin, 'save_advertiser', 'advertiser:' || v.id,
          case when p_id is null then null else to_jsonb(v_before) - 'created_by' end, to_jsonb(v) - 'created_by');
  return to_jsonb(v) - 'created_by';
end $$;

create or replace function public.owner_set_advertiser_status(p_id bigint, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := public.require_owner();
  v public.advertisers;
  v_before text;
begin
  if p_status not in ('active', 'hidden') then
    raise exception 'BAD_STATUS' using errcode = '22023';
  end if;
  select status into v_before from public.advertisers where id = p_id for update;
  if not found then
    raise exception 'ADVERTISER_NOT_FOUND' using errcode = '22023';
  end if;
  update public.advertisers set status = p_status, updated_at = now() where id = p_id returning * into v;
  if v_before <> p_status then
    insert into public.admin_audit_logs (admin_id, action, target, before_json, after_json)
    values (v_admin, 'set_advertiser_status', 'advertiser:' || p_id,
            jsonb_build_object('status', v_before), jsonb_build_object('status', p_status));
  end if;
  return to_jsonb(v) - 'created_by';
end $$;

-- A coupon's offer and code are fixed once created (members may already hold it); the owner can pause it.
create or replace function public.owner_create_coupon(p_advertiser bigint, p_offer text, p_code text,
                                                      p_audience text, p_quantity int, p_expires_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := public.require_owner();
  v public.coupons;
begin
  if not exists (select 1 from public.advertisers where id = p_advertiser) then
    raise exception 'ADVERTISER_NOT_FOUND' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_offer, ''))) not between 1 and 200 then
    raise exception 'BAD_OFFER' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_code, ''))) not between 1 and 60 then
    raise exception 'BAD_CODE' using errcode = '22023';
  end if;
  if p_audience is null or p_audience not in ('all', 'award') then
    raise exception 'BAD_AUDIENCE' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity not between 1 and 100000 then
    raise exception 'BAD_QUANTITY' using errcode = '22023';
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '366 days' then
    raise exception 'BAD_EXPIRY' using errcode = '22023';
  end if;
  insert into public.coupons (advertiser_id, offer, code, audience, quantity, expires_at, created_by)
  values (p_advertiser, btrim(p_offer), btrim(p_code), p_audience, p_quantity, p_expires_at, v_admin)
  returning * into v;
  insert into public.admin_audit_logs (admin_id, action, target, after_json)
  values (v_admin, 'create_coupon', 'coupon:' || v.id, to_jsonb(v) - 'created_by');
  return to_jsonb(v) - 'created_by';
end $$;

create or replace function public.owner_set_coupon_status(p_id bigint, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := public.require_owner();
  v public.coupons;
  v_before text;
begin
  if p_status not in ('active', 'paused') then
    raise exception 'BAD_STATUS' using errcode = '22023';
  end if;
  select status into v_before from public.coupons where id = p_id for update;
  if not found then
    raise exception 'COUPON_NOT_FOUND' using errcode = '22023';
  end if;
  update public.coupons set status = p_status where id = p_id returning * into v;
  if v_before <> p_status then
    insert into public.admin_audit_logs (admin_id, action, target, before_json, after_json)
    values (v_admin, 'set_coupon_status', 'coupon:' || p_id,
            jsonb_build_object('status', v_before), jsonb_build_object('status', p_status));
  end if;
  return to_jsonb(v) - 'created_by';
end $$;

-- Gives one copy to each member in p_users (in order) who is an active non-agent player without it, while copies
-- remain. Returns who got it.
create or replace function public.coupon_award_to(p_admin uuid, c public.coupons, p_users uuid[], p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_left int := public.coupon_remaining(c.id);
  v_given jsonb := '[]'::jsonb;
  v_skipped int := 0;
  u uuid;
begin
  if c.status <> 'active' then
    raise exception 'COUPON_PAUSED' using errcode = '22023';
  end if;
  if c.expires_at <= now() then
    raise exception 'COUPON_EXPIRED' using errcode = '22023';
  end if;
  foreach u in array p_users loop
    if exists (select 1 from public.coupon_claims where coupon_id = c.id and user_id = u)
       or public.is_agent(u)
       or not exists (select 1 from public.profiles where user_id = u and status = 'active') then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    if v_left <= 0 then
      raise exception 'COUPON_SOLD_OUT' using errcode = '22023';  -- all or nothing: no half-awarded list
    end if;
    insert into public.coupon_claims (coupon_id, user_id, source, awarded_by, note)
    values (c.id, u, 'award', p_admin, p_note);
    v_left := v_left - 1;
    v_given := v_given || jsonb_build_object('user_id', u,
      'display_name', (select display_name from public.profiles where user_id = u),
      'player_no', (select player_no from public.profiles where user_id = u));
  end loop;
  insert into public.admin_audit_logs (admin_id, action, target, after_json, reason)
  values (p_admin, 'award_coupon', 'coupon:' || c.id,
          jsonb_build_object('given', v_given, 'skipped', v_skipped), p_note);
  return jsonb_build_object('given', v_given, 'skipped', v_skipped, 'remaining', v_left);
end $$;

-- Award a coupon to the top p_top players of this week's or last week's leaderboard (net points won, then points
-- wagered). Players who already hold the coupon are skipped and not replaced. The owner and agents are not ranked.
create or replace function public.owner_award_coupon_top(p_coupon bigint, p_week text, p_top int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := public.require_owner();
  c public.coupons;
  v_from timestamptz;
  v_to timestamptz;
  v_users uuid[];
begin
  if p_week not in ('current', 'previous') then
    raise exception 'BAD_PERIOD' using errcode = '22023';
  end if;
  if p_top is null or p_top not between 1 and 50 then
    raise exception 'BAD_TOP' using errcode = '22023';
  end if;
  select * into c from public.coupons where id = p_coupon for update;
  if not found then
    raise exception 'COUPON_NOT_FOUND' using errcode = '22023';
  end if;
  v_from := public.site_week_start() - case when p_week = 'previous' then interval '7 days' else interval '0' end;
  v_to := v_from + interval '7 days';
  select array_agg(user_id order by net desc, wagered desc, player_no) into v_users
  from (
    select p.user_id, p.player_no, sum(r.gross_payout - r.stake) as net, sum(r.stake) as wagered
    from public.game_rounds r
    join public.profiles p on p.user_id = r.user_id
    where r.status = 'SETTLED' and r.settled_at >= v_from and r.settled_at < v_to
      and p.status = 'active' and p.role <> 'owner' and not public.is_agent(p.user_id)
    group by p.user_id, p.player_no
    order by net desc, wagered desc, p.player_no
    limit p_top
  ) x;
  if v_users is null then
    raise exception 'NO_PLAYERS' using errcode = '22023';
  end if;
  return public.coupon_award_to(v_admin, c, v_users,
    'أفضل ' || p_top || ' في لوحة ' || case when p_week = 'previous' then 'الأسبوع الماضي' else 'هذا الأسبوع' end);
end $$;

-- Award a coupon to one player by player number.
create or replace function public.owner_award_coupon_player(p_coupon bigint, p_player_no bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := public.require_owner();
  c public.coupons;
  v_p public.profiles;
  v jsonb;
begin
  select * into c from public.coupons where id = p_coupon for update;
  if not found then
    raise exception 'COUPON_NOT_FOUND' using errcode = '22023';
  end if;
  select * into v_p from public.profiles where player_no = p_player_no and status = 'active';
  if not found then
    raise exception 'PLAYER_NOT_FOUND' using errcode = '22023';
  end if;
  if public.is_agent(v_p.user_id) then
    raise exception 'PLAYER_IS_AGENT' using errcode = '22023';
  end if;
  if exists (select 1 from public.coupon_claims where coupon_id = c.id and user_id = v_p.user_id) then
    raise exception 'ALREADY_HAS_COUPON' using errcode = '22023';
  end if;
  v := public.coupon_award_to(v_admin, c, array[v_p.user_id], 'هدية من المالك');
  return v;
end $$;

-- Owner overview: advertisers, coupons with counts, and who holds each coupon.
create or replace function public.owner_coupons() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_admin uuid := public.require_owner();
begin
  return jsonb_build_object(
    'advertisers', (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'logo_url', a.logo_url,
               'link_url', a.link_url, 'status', a.status) order by a.status, a.name), '[]'::jsonb)
      from public.advertisers a),
    'coupons', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', c.id, 'advertiser_id', c.advertiser_id, 'advertiser', a.name, 'offer', c.offer, 'code', c.code,
               'audience', c.audience, 'quantity', c.quantity, 'expires_at', c.expires_at, 'status', c.status,
               'expired', c.expires_at <= now(), 'created_at', c.created_at,
               'holders', (
                 select coalesce(jsonb_agg(jsonb_build_object('display_name', p.display_name, 'player_no', p.player_no,
                          'source', k.source, 'at', k.created_at) order by k.created_at desc), '[]'::jsonb)
                 from public.coupon_claims k join public.profiles p on p.user_id = k.user_id
                 where k.coupon_id = c.id)) order by c.created_at desc), '[]'::jsonb)
      from public.coupons c join public.advertisers a on a.id = c.advertiser_id));
end $$;

-- ---------- grants ----------

revoke all on function public.coupon_remaining(bigint) from public, anon, authenticated;
revoke all on function public.coupon_award_to(uuid, public.coupons, uuid[], text) from public, anon, authenticated;
revoke all on function public.my_coupons() from public, anon;
revoke all on function public.claim_coupon(bigint) from public, anon;
revoke all on function public.owner_save_advertiser(bigint, text, text, text) from public, anon;
revoke all on function public.owner_set_advertiser_status(bigint, text) from public, anon;
revoke all on function public.owner_create_coupon(bigint, text, text, text, int, timestamptz) from public, anon;
revoke all on function public.owner_set_coupon_status(bigint, text) from public, anon;
revoke all on function public.owner_award_coupon_top(bigint, text, int) from public, anon;
revoke all on function public.owner_award_coupon_player(bigint, bigint) from public, anon;
revoke all on function public.owner_coupons() from public, anon;
grant execute on function public.my_coupons() to authenticated;
grant execute on function public.claim_coupon(bigint) to authenticated;
grant execute on function public.owner_save_advertiser(bigint, text, text, text) to authenticated;
grant execute on function public.owner_set_advertiser_status(bigint, text) to authenticated;
grant execute on function public.owner_create_coupon(bigint, text, text, text, int, timestamptz) to authenticated;
grant execute on function public.owner_set_coupon_status(bigint, text) to authenticated;
grant execute on function public.owner_award_coupon_top(bigint, text, int) to authenticated;
grant execute on function public.owner_award_coupon_player(bigint, bigint) to authenticated;
grant execute on function public.owner_coupons() to authenticated;
