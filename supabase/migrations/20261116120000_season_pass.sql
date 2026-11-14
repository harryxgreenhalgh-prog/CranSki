-- CranSki · Phase 5 · Step 5: seasons, items you own, and the Season Pass.
--
-- Season Pass: 100 levels of 500 XP. Every finished run (re-ridden by the
-- submit-run Edge Function) gives 25 XP plus 1 per 3,000 points. Each day of
-- the season allows 1,500 XP (3 levels) at the full rate; days you miss roll
-- over; past that, runs give 1/5 XP. A free track and a premium track; premium
-- costs 1,500 FROST and pays back 1,500 FROST over its levels. Rewards are
-- granted as soon as you reach their level (premium ones too, when you buy it).
--
-- Riders read their own pass and items; only these functions change them.

-- ------------------------------------------------------------------ seasons
create table if not exists public.seasons (
  id integer primary key,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  ended_at timestamptz
);
alter table public.seasons enable row level security;
revoke all on public.seasons from public, anon, authenticated;
grant select on public.seasons to anon, authenticated;
drop policy if exists "Seasons are public" on public.seasons;
create policy "Seasons are public" on public.seasons for select using (true);
insert into public.seasons (id, name, starts_at, ends_at)
select 1, 'Season 1', date_trunc('day', now()), date_trunc('day', now()) + interval '30 days'
where not exists (select 1 from public.seasons);

-- The season now under way (there's always one).
create or replace function private.current_season() returns public.seasons
language plpgsql security definer set search_path = '' as $$
declare
  s public.seasons;
begin
  select * into s from public.seasons where ended_at is null order by id desc limit 1;
  if not found then
    insert into public.seasons (id, name, starts_at, ends_at)
    select coalesce(max(id), 0) + 1, 'Season ' || (coalesce(max(id), 0) + 1), date_trunc('day', now()), date_trunc('day', now()) + interval '30 days'
    from public.seasons
    returning * into s;
  end if;
  return s;
end
$$;

-- ------------------------------------------------------------------ the catalogue
-- Filled from src/economy/catalog.js by the generated *_catalog.sql migration.
create table if not exists public.item_sets (
  id text primary key,
  name text not null,
  set_group integer not null,
  price integer not null check (price > 0),
  blurb text not null default ''
);
create table if not exists public.items (
  id text primary key,
  name text not null,
  kind text not null,
  slot text not null,
  rarity text not null check (rarity in ('rare', 'epic', 'legendary')),
  source text not null check (source in ('shop', 'set', 'pass')),
  price integer check (price is null or price > 0),
  set_id text references public.item_sets (id),
  look jsonb not null default '{}'::jsonb
);
create table if not exists public.pass_rewards (
  level integer not null check (level between 1 and 100),
  track text not null check (track in ('free', 'premium')),
  item_id text references public.items (id),
  frost integer check (frost is null or frost > 0),
  primary key (level, track),
  check ((item_id is null) <> (frost is null))
);
alter table public.item_sets enable row level security;
alter table public.items enable row level security;
alter table public.pass_rewards enable row level security;
revoke all on public.item_sets, public.items, public.pass_rewards from public, anon, authenticated;
grant select on public.item_sets, public.items, public.pass_rewards to anon, authenticated;
drop policy if exists "Catalogue is public" on public.item_sets;
create policy "Catalogue is public" on public.item_sets for select using (true);
drop policy if exists "Catalogue is public" on public.items;
create policy "Catalogue is public" on public.items for select using (true);
drop policy if exists "Catalogue is public" on public.pass_rewards;
create policy "Catalogue is public" on public.pass_rewards for select using (true);

-- ------------------------------------------------------------------ what riders own
create table if not exists public.inventory (
  user_id uuid not null references public.profiles (id) on delete cascade,
  item_id text not null references public.items (id),
  source text not null check (source in ('shop', 'set', 'pass', 'gift')),
  price_paid integer not null default 0,
  bought_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
alter table public.inventory enable row level security;
revoke all on public.inventory from public, anon, authenticated;
grant select on public.inventory to authenticated;
drop policy if exists "Riders see their own items" on public.inventory;
create policy "Riders see their own items" on public.inventory
  for select to authenticated using (user_id = (select auth.uid()));

-- ------------------------------------------------------------------ the pass
create table if not exists public.season_pass (
  user_id uuid not null references public.profiles (id) on delete cascade,
  season_id integer not null references public.seasons (id),
  xp integer not null default 0 check (xp >= 0),
  full_xp integer not null default 0, -- XP earned at the full rate this season
  premium boolean not null default false,
  free_paid integer not null default 0, -- free rewards granted up to this level
  premium_paid integer not null default 0, -- premium rewards granted up to this level
  updated_at timestamptz not null default now(),
  primary key (user_id, season_id)
);
alter table public.season_pass enable row level security;
revoke all on public.season_pass from public, anon, authenticated;
grant select on public.season_pass to authenticated;
drop policy if exists "Riders see their own pass" on public.season_pass;
create policy "Riders see their own pass" on public.season_pass
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function private.pass_rules() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"levels": 100, "xp_per_level": 500, "xp_per_run": 25, "points_per_xp": 3000,
           "full_xp_per_day": 1500, "reduced_divisor": 5, "premium_price": 1500}'::jsonb
$$;

create or replace function private.pass_level(p_xp integer) returns integer
language sql immutable set search_path = '' as $$
  select least(100, greatest(0, p_xp) / 500)
$$;

-- Full-rate XP still available (1,500 a day since the season began, minus what's used).
create or replace function private.full_xp_left(p_season public.seasons, p_full_xp integer) returns integer
language sql stable set search_path = '' as $$
  select greatest(0, 1500 * (floor(extract(epoch from (now() - p_season.starts_at)) / 86400)::integer + 1) - p_full_xp)
$$;

-- Grant every reward the rider has reached and not yet received. Returns what was granted.
create or replace function private.grant_pass(p_user uuid, p_season integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sp public.season_pass;
  lvl integer;
  r public.pass_rewards;
  out jsonb := '[]'::jsonb;
begin
  select * into sp from public.season_pass where user_id = p_user and season_id = p_season for update;
  if not found then return out; end if;
  lvl := private.pass_level(sp.xp);
  for r in
    select * from public.pass_rewards pr
    where (pr.track = 'free' and pr.level > sp.free_paid and pr.level <= lvl)
       or (pr.track = 'premium' and sp.premium and pr.level > sp.premium_paid and pr.level <= lvl)
    order by pr.level, pr.track
  loop
    if r.item_id is not null then
      insert into public.inventory (user_id, item_id, source) values (p_user, r.item_id, 'pass') on conflict do nothing;
    else
      perform private.add_frost(p_user, r.frost, 'pass', format('season:%s:%s:%s', p_season, r.level, r.track));
    end if;
    out := out || jsonb_build_object('level', r.level, 'track', r.track, 'item', r.item_id, 'frost', r.frost);
  end loop;
  update public.season_pass set free_paid = greatest(free_paid, lvl),
    premium_paid = case when premium then greatest(premium_paid, lvl) else premium_paid end,
    updated_at = now()
  where user_id = p_user and season_id = p_season;
  return out;
end
$$;

-- A finished, re-ridden run: FROST (step 4) and now Season Pass XP. Called only
-- by the submit-run Edge Function (secret key). The same run pays once.
create or replace function public.reward_run(p_user uuid, p_park text, p_total integer, p_run_key text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  rules jsonb := private.frost_rules();
  today integer;
  give integer;
  bal integer;
  season public.seasons;
  sp public.season_pass;
  raw integer;
  left_full integer;
  full_part integer;
  gain integer;
  granted jsonb;
begin
  if p_run_key is null or length(p_run_key) < 16 then raise exception 'bad_run_key'; end if;
  insert into public.wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  perform 1 from public.wallets where user_id = p_user for update; -- one reward at a time per rider
  season := private.current_season();
  insert into public.season_pass (user_id, season_id) values (p_user, season.id) on conflict do nothing;
  if exists (select 1 from private.frost_ledger where user_id = p_user and reason = 'run' and ref = p_run_key) then
    select * into sp from public.season_pass where user_id = p_user and season_id = season.id;
    return jsonb_build_object(
      'frost', jsonb_build_object('awarded', 0, 'duplicate', true, 'balance', (select frost from public.wallets where user_id = p_user),
        'today', private.run_frost_today(p_user), 'cap', rules -> 'daily_cap'),
      'xp', jsonb_build_object('gained', 0, 'duplicate', true, 'xp', sp.xp, 'level', private.pass_level(sp.xp), 'premium', sp.premium,
        'full_left', private.full_xp_left(season, sp.full_xp), 'season', season.id, 'granted', '[]'::jsonb));
  end if;

  -- FROST: 10 + 1 per 10,000 points, capped per day.
  today := private.run_frost_today(p_user);
  give := least((rules ->> 'per_run')::integer + greatest(0, p_total) / (rules ->> 'per_points')::integer,
                greatest(0, (rules ->> 'daily_cap')::integer - today));
  bal := private.add_frost(p_user, give, 'run', p_run_key);

  -- XP: 25 + 1 per 3,000 points; full rate while today's (rolled-over) allowance lasts, then 1/5.
  select * into sp from public.season_pass where user_id = p_user and season_id = season.id for update;
  raw := 25 + greatest(0, p_total) / 3000;
  left_full := private.full_xp_left(season, sp.full_xp);
  full_part := least(raw, left_full);
  gain := full_part + (raw - full_part) / 5;
  update public.season_pass set xp = xp + gain, full_xp = full_xp + full_part, updated_at = now()
  where user_id = p_user and season_id = season.id returning * into sp;
  granted := private.grant_pass(p_user, season.id);
  return jsonb_build_object(
    'frost', jsonb_build_object('awarded', give, 'duplicate', false,
      'balance', (select frost from public.wallets where user_id = p_user), 'today', today + give, 'cap', rules -> 'daily_cap'),
    'xp', jsonb_build_object('gained', gain, 'reduced', full_part < raw, 'xp', sp.xp, 'level', private.pass_level(sp.xp),
      'premium', sp.premium, 'full_left', left_full - full_part, 'season', season.id, 'granted', granted));
end
$$;

-- Buy the premium track for this season: 1,500 FROST, and its rewards so far straight away.
create or replace function public.buy_premium_pass() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  season public.seasons;
  sp public.season_pass;
  bal integer;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then
    return jsonb_build_object('status', 'no_gamertag');
  end if;
  season := private.current_season();
  insert into public.season_pass (user_id, season_id) values (me, season.id) on conflict do nothing;
  select * into sp from public.season_pass where user_id = me and season_id = season.id for update;
  if sp.premium then return jsonb_build_object('status', 'owned'); end if;
  begin
    bal := private.add_frost(me, -(private.pass_rules() ->> 'premium_price')::integer, 'pass', 'premium:' || season.id);
  exception when others then
    if sqlerrm = 'not_enough_frost' then return jsonb_build_object('status', 'not_enough_frost'); end if;
    raise;
  end;
  update public.season_pass set premium = true, updated_at = now() where user_id = me and season_id = season.id;
  return jsonb_build_object('status', 'ok', 'granted', private.grant_pass(me, season.id),
    'balance', (select frost from public.wallets where user_id = me));
end
$$;

-- My pass this season.
create or replace function public.my_pass() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  season public.seasons := private.current_season();
  sp public.season_pass;
begin
  select * into sp from public.season_pass where user_id = me and season_id = season.id;
  return jsonb_build_object(
    'season', jsonb_build_object('id', season.id, 'name', season.name, 'starts_at', season.starts_at, 'ends_at', season.ends_at),
    'xp', coalesce(sp.xp, 0), 'level', private.pass_level(coalesce(sp.xp, 0)), 'premium', coalesce(sp.premium, false),
    'full_left', private.full_xp_left(season, coalesce(sp.full_xp, 0)));
end
$$;

-- What I own.
create or replace function public.my_inventory() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('item', i.item_id, 'source', i.source, 'at', i.bought_at, 'paid', i.price_paid) order by i.bought_at), '[]'::jsonb)
  from public.inventory i where i.user_id = (select auth.uid())
$$;

revoke all on function private.current_season() from public, anon, authenticated;
revoke all on function private.grant_pass(uuid, integer) from public, anon, authenticated;
revoke all on function private.full_xp_left(public.seasons, integer) from public, anon, authenticated;
revoke all on function public.reward_run(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.reward_run(uuid, text, integer, text) to service_role;
revoke all on function public.buy_premium_pass() from public, anon;
grant execute on function public.buy_premium_pass() to authenticated;
revoke all on function public.my_pass() from public, anon;
grant execute on function public.my_pass() to authenticated;
revoke all on function public.my_inventory() from public, anon;
grant execute on function public.my_inventory() to authenticated;
