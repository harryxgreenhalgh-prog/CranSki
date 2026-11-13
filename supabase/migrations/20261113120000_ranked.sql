-- CranSki · Phase 5 · Ranked 1v1 and 2v2 on APEX (DESIGN.md, Modes and multiplayer).
--
-- Everything here is decided by the database, never by the game:
--   - matchmaking by rating (the window widens the longer you wait);
--   - check-in: both riders must show up within 45 seconds, otherwise the
--     match is called off, the no-show gets a cooldown, and whoever turned up
--     goes straight back to the front of the queue (never penalised);
--   - the opponent stays hidden until the match starts;
--   - runs only count once the submit-run Edge Function has re-ridden them;
--   - results and ratings (Elo), 5 placement matches, then a tier;
--   - leaving: 1v1 cooldowns of 1, 5, then 15 minutes (a match already under
--     way is lost); 2v2 leaving counts as a loss plus 5, 15, then 30 minutes.
-- Riders can read the public ratings board, but can't write any of these
-- tables: every change goes through the functions below.

create table if not exists public.ratings (
  user_id uuid not null references public.profiles (id) on delete cascade,
  mode text not null check (mode in ('1v1', '2v2')),
  rating integer not null default 1000,
  placements integer not null default 0, -- placement matches played (0-5)
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, mode)
);
create index if not exists ratings_board on public.ratings (mode, rating desc) where placements >= 5;

create table if not exists public.ranked_queue (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  mode text not null check (mode in ('1v1', '2v2')),
  rating integer not null,
  partner uuid references public.profiles (id) on delete cascade, -- 2v2: queued as a pair
  queued_at timestamptz not null default now()
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('1v1', '2v2')),
  park text not null default 'apex',
  status text not null default 'checkin' check (status in ('checkin', 'live', 'done', 'cancelled')),
  players uuid[] not null, -- run order: everyone's first run in this order, then again
  teams integer[] not null, -- team (0 or 1) of each player
  queued_at timestamptz[] not null, -- for putting riders back in the queue
  runs_each integer not null,
  checked_in uuid[] not null default '{}',
  scores jsonb not null default '{}'::jsonb, -- uid -> [run totals]
  run_index integer not null default 0,
  turn_started_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  result jsonb
);
create index if not exists matches_open on public.matches (status, created_at);

create table if not exists private.ranked_penalties (
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null,
  level integer not null default 0,
  until timestamptz not null,
  last_at timestamptz not null,
  primary key (user_id, mode)
);

-- Deleting an account deletes the matches it played in (they hold player ids
-- in a list, which a foreign key can't cascade).
create or replace function private.forget_matches() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.matches where old.id = any (players);
  return old;
end
$$;
drop trigger if exists forget_matches on public.profiles;
create trigger forget_matches after delete on public.profiles
  for each row execute function private.forget_matches();

alter table public.ratings enable row level security;
alter table public.ranked_queue enable row level security;
alter table public.matches enable row level security;
revoke all on public.ratings, public.ranked_queue, public.matches from anon, authenticated;
grant select on public.ratings to anon, authenticated;
drop policy if exists "Ratings are public" on public.ratings;
create policy "Ratings are public" on public.ratings for select to anon, authenticated using (true);

-- ------------------------------------------------------------------ helpers
create or replace function private.ranked_rules(p_mode text) returns jsonb
language sql immutable set search_path = '' as $$
  select case p_mode
    when '1v1' then '{"players": 2, "runs_each": 2, "cooldowns": [1, 5, 15], "leave_is_loss_before_start": false}'::jsonb
    else '{"players": 4, "runs_each": 1, "cooldowns": [5, 15, 30], "leave_is_loss_before_start": true}'::jsonb
  end
$$;

create or replace function public.ranked_tier(p_rating integer, p_placements integer) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_placements < 5 then 'Unranked'
    when p_rating >= 1500 then 'Diamond'
    when p_rating >= 1350 then 'Platinum'
    when p_rating >= 1200 then 'Gold'
    when p_rating >= 1050 then 'Silver'
    else 'Bronze' end
$$;

create or replace function private.rating_of(p_user uuid, p_mode text) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select rating from public.ratings where user_id = p_user and mode = p_mode), 1000)
$$;

-- Cooldown for leaving: steps up each time within a day.
create or replace function private.penalize(p_user uuid, p_mode text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  st private.ranked_penalties;
  steps integer[] := array(select jsonb_array_elements_text(private.ranked_rules(p_mode) -> 'cooldowns')::integer);
  lvl integer := 0;
  until_at timestamptz;
begin
  select * into st from private.ranked_penalties where user_id = p_user and mode = p_mode;
  if found and st.last_at > now() - interval '1 day' then
    lvl := least(st.level + 1, array_length(steps, 1) - 1);
  end if;
  until_at := now() + make_interval(mins => steps[lvl + 1]);
  insert into private.ranked_penalties (user_id, mode, level, until, last_at) values (p_user, p_mode, lvl, until_at, now())
  on conflict (user_id, mode) do update set level = excluded.level, until = excluded.until, last_at = excluded.last_at;
  return until_at;
end
$$;

-- Ratings after a finished match. winner: team 0 or 1, or null for a draw.
create or replace function private.apply_result(p_match uuid, p_winner integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches;
  i integer;
  avg0 numeric;
  avg1 numeric;
  mine numeric;
  theirs numeric;
  expected numeric;
  score numeric;
  r public.ratings;
  before_rating integer;
  k integer;
  changes jsonb := '{}'::jsonb;
  totals jsonb := '{}'::jsonb;
begin
  select * into m from public.matches where id = p_match for update;
  if m.status = 'done' then return m.result; end if;
  for i in 1 .. array_length(m.players, 1) loop
    insert into public.ratings (user_id, mode) values (m.players[i], m.mode) on conflict do nothing;
  end loop;
  select avg(rt.rating) into avg0 from public.ratings rt, unnest(m.players, m.teams) as p(uid, team) where rt.user_id = p.uid and rt.mode = m.mode and p.team = 0;
  select avg(rt.rating) into avg1 from public.ratings rt, unnest(m.players, m.teams) as p(uid, team) where rt.user_id = p.uid and rt.mode = m.mode and p.team = 1;
  for i in 1 .. array_length(m.players, 1) loop
    select * into r from public.ratings where user_id = m.players[i] and mode = m.mode for update;
    before_rating := r.rating;
    mine := case when m.teams[i] = 0 then avg0 else avg1 end;
    theirs := case when m.teams[i] = 0 then avg1 else avg0 end;
    expected := 1 / (1 + power(10::numeric, (theirs - mine) / 400));
    score := case when p_winner is null then 0.5 when p_winner = m.teams[i] then 1 else 0 end;
    k := case when r.placements < 5 then 64 else 32 end;
    update public.ratings set
      rating = greatest(100, r.rating + round(k * (score - expected))::integer),
      placements = least(5, r.placements + 1),
      wins = wins + (score = 1)::integer,
      losses = losses + (score = 0)::integer,
      draws = draws + (score = 0.5)::integer,
      updated_at = now()
    where user_id = r.user_id and mode = r.mode
    returning * into r;
    changes := changes || jsonb_build_object(m.players[i]::text, jsonb_build_object(
      'before', before_rating, 'after', r.rating,
      'tier', public.ranked_tier(r.rating, r.placements), 'placements', r.placements));
  end loop;
  -- Best run (1v1) or team total (2v2), for the results screen.
  for i in 1 .. array_length(m.players, 1) loop
    totals := totals || jsonb_build_object(m.players[i]::text, coalesce((select max(v::integer) from jsonb_array_elements_text(m.scores -> m.players[i]::text) v), 0));
  end loop;
  update public.matches set status = 'done', ended_at = now(),
    result = jsonb_build_object('winner_team', p_winner, 'reason', p_reason, 'changes', changes, 'best', totals)
  where id = p_match returning result into changes;
  return changes;
end
$$;

-- Decide a match whose runs are all in.
create or replace function private.finish_match(p_match uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches;
  t0 integer := 0;
  t1 integer := 0;
  i integer;
  best integer;
begin
  select * into m from public.matches where id = p_match;
  for i in 1 .. array_length(m.players, 1) loop
    -- 1v1: each rider's best run; 2v2: each rider's (single) run, summed per team.
    best := coalesce((select max(v::integer) from jsonb_array_elements_text(m.scores -> m.players[i]::text) v), 0);
    if m.mode = '1v1' then
      if m.teams[i] = 0 then t0 := greatest(t0, best); else t1 := greatest(t1, best); end if;
    else
      if m.teams[i] = 0 then t0 := t0 + best; else t1 := t1 + best; end if;
    end if;
  end loop;
  return private.apply_result(p_match, case when t0 = t1 then null when t0 > t1 then 0 else 1 end, 'runs')
    || jsonb_build_object('team_totals', jsonb_build_array(t0, t1));
end
$$;

-- Someone leaves (or vanishes): before the start the match is called off and
-- everyone else goes back to the front of the queue; once under way their team
-- loses. Either way they get a cooldown. 2v2 leaving always counts as a loss.
create or replace function private.leave_match(p_match uuid, p_user uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches;
  i integer;
  idx integer;
  out jsonb;
begin
  select * into m from public.matches where id = p_match for update;
  if m.status not in ('checkin', 'live') then return null; end if;
  idx := array_position(m.players, p_user);
  if idx is null then return null; end if;
  perform private.penalize(p_user, m.mode);
  if m.status = 'checkin' then
    update public.matches set status = 'cancelled', ended_at = now(), result = jsonb_build_object('reason', p_reason, 'left', p_user) where id = p_match;
    if (private.ranked_rules(m.mode) ->> 'leave_is_loss_before_start')::boolean then
      update public.ratings set losses = losses + 1, rating = greatest(100, rating - 16), updated_at = now() where user_id = p_user and mode = m.mode;
    end if;
    -- Never penalise the riders left waiting: straight back in the queue.
    for i in 1 .. array_length(m.players, 1) loop
      if m.players[i] <> p_user then
        insert into public.ranked_queue (user_id, mode, rating, queued_at)
        values (m.players[i], m.mode, private.rating_of(m.players[i], m.mode), m.queued_at[i])
        on conflict (user_id) do nothing;
      end if;
    end loop;
    return jsonb_build_object('cancelled', true);
  end if;
  out := private.apply_result(p_match, 1 - m.teams[idx], p_reason);
  return out;
end
$$;

-- Tidy up: no-shows after 45 s, and matches stuck on someone's turn.
create or replace function private.ranked_cleanup() returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches;
  i integer;
begin
  for m in select * from public.matches where status = 'checkin' and created_at < now() - interval '45 seconds' for update skip locked loop
    -- Everyone who didn't check in is a no-show and gets the cooldown; the
    -- riders who did turn up go straight back to the front of the queue.
    update public.matches set status = 'cancelled', ended_at = now(), result = jsonb_build_object('reason', 'no_show') where id = m.id;
    for i in 1 .. array_length(m.players, 1) loop
      if m.players[i] = any (m.checked_in) then
        insert into public.ranked_queue (user_id, mode, rating, queued_at)
        values (m.players[i], m.mode, private.rating_of(m.players[i], m.mode), m.queued_at[i])
        on conflict (user_id) do nothing;
      else
        perform private.penalize(m.players[i], m.mode);
        if (private.ranked_rules(m.mode) ->> 'leave_is_loss_before_start')::boolean then
          update public.ratings set losses = losses + 1, rating = greatest(100, rating - 16), updated_at = now() where user_id = m.players[i] and mode = m.mode;
        end if;
      end if;
    end loop;
  end loop;
  for m in select * from public.matches where status = 'live' and turn_started_at < now() - interval '10 minutes' for update skip locked loop
    perform private.leave_match(m.id, m.players[m.run_index % array_length(m.players, 1) + 1], 'timeout');
  end loop;
end
$$;

-- Try to make a match that includes p_user (called while they wait).
create or replace function private.ranked_pair(p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me public.ranked_queue;
  other public.ranked_queue;
  waited numeric;
  win integer;
  mid uuid;
  picks public.ranked_queue[];
  cand public.ranked_queue;
  team_a uuid[];
  team_b uuid[];
  ordered uuid[];
  qts timestamptz[];
  ts integer[];
begin
  select * into me from public.ranked_queue where user_id = p_user for update skip locked;
  if not found then return null; end if;
  waited := extract(epoch from now() - me.queued_at);
  win := least(800, 100 + (waited * 8)::integer);

  if me.mode = '1v1' then
    select * into other from public.ranked_queue rq
    where rq.mode = '1v1' and rq.user_id <> p_user and abs(rq.rating - me.rating) <= win
    order by abs(rq.rating - me.rating), rq.queued_at
    limit 1 for update skip locked;
    if not found then return null; end if;
    -- Whoever has waited longer drops first.
    if other.queued_at < me.queued_at then
      ordered := array[other.user_id, p_user];
      qts := array[other.queued_at, me.queued_at];
    else
      ordered := array[p_user, other.user_id];
      qts := array[me.queued_at, other.queued_at];
    end if;
    insert into public.matches (mode, players, teams, queued_at, runs_each)
    values ('1v1', ordered, array[0, 1], qts, 2) returning id into mid;
    delete from public.ranked_queue where user_id in (p_user, other.user_id);
    return mid;
  end if;

  -- 2v2: four riders whose ratings are within 500 of each other (pairs stay
  -- together). Gather candidates near my rating, oldest first.
  picks := array(
    select rq from public.ranked_queue rq
    where rq.mode = '2v2' and abs(rq.rating - me.rating) <= least(500, win)
    order by (rq.user_id = p_user) desc, rq.queued_at
    limit 8 for update skip locked
  );
  team_a := '{}';
  team_b := '{}';
  -- My side first: me and my partner, if I have one waiting.
  team_a := array[p_user];
  if me.partner is not null then
    if not exists (select 1 from unnest(picks) x where x.user_id = me.partner) then return null; end if;
    team_a := team_a || me.partner;
  end if;
  foreach cand in array picks loop
    if cand.user_id = any (team_a) or cand.user_id = any (team_b) then continue; end if;
    if cand.partner is not null then
      -- A pair joins together, on the other team if there's room.
      if not exists (select 1 from unnest(picks) x where x.user_id = cand.partner) then continue; end if;
      if cardinality(team_b) = 0 then team_b := array[cand.user_id, cand.partner];
      elsif cardinality(team_a) = 0 then team_a := array[cand.user_id, cand.partner];
      end if;
    elsif cand.user_id <> me.partner or me.partner is null then
      if cardinality(team_a) < 2 then team_a := team_a || cand.user_id;
      elsif cardinality(team_b) < 2 then team_b := team_b || cand.user_id;
      end if;
    end if;
    exit when cardinality(team_a) = 2 and cardinality(team_b) = 2;
  end loop;
  if cardinality(team_a) <> 2 or cardinality(team_b) <> 2 then return null; end if;
  -- Teammates within 500 of each other.
  if abs(private.rating_of(team_a[1], '2v2') - private.rating_of(team_a[2], '2v2')) > 500
     or abs(private.rating_of(team_b[1], '2v2') - private.rating_of(team_b[2], '2v2')) > 500 then
    return null;
  end if;
  ordered := array[team_a[1], team_b[1], team_a[2], team_b[2]]; -- alternate drops
  ts := array[0, 1, 0, 1];
  qts := array(select coalesce((select rq.queued_at from public.ranked_queue rq where rq.user_id = u), now()) from unnest(ordered) u);
  insert into public.matches (mode, players, teams, queued_at, runs_each)
  values ('2v2', ordered, ts, qts, 1) returning id into mid;
  delete from public.ranked_queue where user_id = any (ordered);
  return mid;
end
$$;

-- A match as a rider sees it. Before it starts the opponents are hidden.
create or replace function private.match_view(p_match uuid, p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', m.id, 'mode', m.mode, 'park', m.park, 'status', m.status,
    'me', array_position(m.players, p_user) - 1,
    'players', (
      select jsonb_agg(jsonb_build_object(
        'id', case when m.status = 'checkin' and p.uid <> p_user and p.team <> m.teams[array_position(m.players, p_user)] then null else p.uid end,
        'tag', case when m.status = 'checkin' and p.uid <> p_user and p.team <> m.teams[array_position(m.players, p_user)] then null else pr.gamertag end,
        'team', p.team,
        'checked_in', p.uid = any (m.checked_in)
      ) order by p.ord)
      from unnest(m.players, m.teams) with ordinality as p(uid, team, ord)
      join public.profiles pr on pr.id = p.uid
    ),
    'runs_each', m.runs_each,
    'run_index', m.run_index,
    'scores', case when m.status = 'checkin' then '{}'::jsonb else m.scores end,
    'turn_age', extract(epoch from now() - coalesce(m.turn_started_at, m.created_at)),
    'checkin_left', greatest(0, 45 - extract(epoch from now() - m.created_at)),
    'result', m.result
  )
  from public.matches m where m.id = p_match
$$;

-- ------------------------------------------------------------------ riders' functions

-- Join the queue. p_partner: (2v2) your partner, who must also be queueing with you.
create or replace function public.ranked_join(p_mode text, p_partner uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  pen private.ranked_penalties;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then
    return jsonb_build_object('status', 'no_gamertag');
  end if;
  if p_mode not in ('1v1', '2v2') then return jsonb_build_object('status', 'bad_mode'); end if;
  select * into pen from private.ranked_penalties where user_id = me and mode = p_mode and until > now();
  if found then return jsonb_build_object('status', 'penalty', 'until', pen.until); end if;
  if exists (select 1 from public.matches where me = any (players) and status in ('checkin', 'live')) then
    return jsonb_build_object('status', 'in_match');
  end if;
  if p_mode = '1v1' then p_partner := null; end if;
  if p_partner = me then p_partner := null; end if;
  insert into public.ranked_queue (user_id, mode, rating, partner)
  values (me, p_mode, private.rating_of(me, p_mode), p_partner)
  on conflict (user_id) do update set mode = excluded.mode, rating = excluded.rating, partner = excluded.partner, queued_at = now();
  return jsonb_build_object('status', 'queued');
end
$$;

create or replace function public.ranked_leave_queue() returns void
language sql security definer set search_path = '' as $$
  delete from public.ranked_queue where user_id = (select auth.uid())
$$;

-- Call every couple of seconds while queued or in a match.
create or replace function public.ranked_poll() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  mid uuid;
  q public.ranked_queue;
begin
  if me is null then return jsonb_build_object('status', 'signed_out'); end if;
  perform private.ranked_cleanup();
  select id into mid from public.matches where me = any (players) and status in ('checkin', 'live') order by created_at desc limit 1;
  if mid is null then
    select * into q from public.ranked_queue where user_id = me;
    if not found then
      -- A match that just ended (or was called off) is still worth showing.
      select id into mid from public.matches where me = any (players) and ended_at > now() - interval '2 minutes' order by ended_at desc limit 1;
      if mid is not null then return jsonb_build_object('status', 'ended', 'match', private.match_view(mid, me)); end if;
      return jsonb_build_object('status', 'idle');
    end if;
    mid := private.ranked_pair(me);
    if mid is null then
      return jsonb_build_object('status', 'queued', 'mode', q.mode, 'waited', extract(epoch from now() - q.queued_at)::integer);
    end if;
  end if;
  return jsonb_build_object('status', 'match', 'match', private.match_view(mid, me));
end
$$;

-- I've loaded the park and I'm ready. Starts the match once everyone is.
create or replace function public.ranked_checkin(p_match uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  m public.matches;
begin
  select * into m from public.matches where id = p_match and me = any (players) for update;
  if not found then return null; end if;
  if m.status = 'checkin' and not (me = any (m.checked_in)) then
    m.checked_in := m.checked_in || me;
    update public.matches set checked_in = m.checked_in where id = p_match;
    if cardinality(m.checked_in) = cardinality(m.players) then
      update public.matches set status = 'live', started_at = now(), turn_started_at = now() where id = p_match;
    end if;
  end if;
  return private.match_view(p_match, me);
end
$$;

-- Leave a match (counts as described at the top).
create or replace function public.ranked_forfeit(p_match uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.leave_match(p_match, auth.uid(), 'left');
  return private.match_view(p_match, auth.uid());
end
$$;

-- The rider whose turn it is hasn't finished within 4 minutes: they've
-- dropped out and their side forfeits. (The server's clock decides.)
create or replace function public.ranked_claim(p_match uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  m public.matches;
  turn uuid;
begin
  select * into m from public.matches where id = p_match and me = any (players);
  if not found or m.status <> 'live' then return private.match_view(p_match, me); end if;
  turn := m.players[m.run_index % array_length(m.players, 1) + 1];
  if turn <> me and m.teams[array_position(m.players, turn)] <> m.teams[array_position(m.players, me)]
     and m.turn_started_at < now() - interval '4 minutes' then
    perform private.leave_match(p_match, turn, 'timeout');
  end if;
  return private.match_view(p_match, me);
end
$$;

-- Called by the submit-run Edge Function (secret key) after it has re-ridden
-- the run: records the server's score for whoever's turn it is.
create or replace function public.ranked_record_run(p_user uuid, p_match uuid, p_park text, p_total integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches;
  turn uuid;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'live' then return jsonb_build_object('error', 'not_live'); end if;
  if p_park <> m.park then return jsonb_build_object('error', 'wrong_park'); end if;
  turn := m.players[m.run_index % array_length(m.players, 1) + 1];
  if turn <> p_user then return jsonb_build_object('error', 'not_your_turn'); end if;
  m.scores := jsonb_set(m.scores, array[p_user::text], coalesce(m.scores -> p_user::text, '[]'::jsonb) || to_jsonb(greatest(0, p_total)));
  update public.matches set scores = m.scores, run_index = run_index + 1, turn_started_at = now() where id = p_match;
  if m.run_index + 1 >= array_length(m.players, 1) * m.runs_each then
    perform private.finish_match(p_match);
  end if;
  return jsonb_build_object('ok', true, 'match', private.match_view(p_match, p_user));
end
$$;

-- My ratings in both modes, any cooldown, and whether I'm queued.
create or replace function public.my_ranked() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'ratings', (select coalesce(jsonb_object_agg(md, jsonb_build_object(
        'rating', coalesce(r.rating, 1000), 'placements', coalesce(r.placements, 0),
        'wins', coalesce(r.wins, 0), 'losses', coalesce(r.losses, 0), 'draws', coalesce(r.draws, 0),
        'tier', public.ranked_tier(coalesce(r.rating, 1000), coalesce(r.placements, 0)))), '{}'::jsonb)
      from unnest(array['1v1', '2v2']) md
      left join public.ratings r on r.user_id = (select auth.uid()) and r.mode = md),
    'penalties', (select coalesce(jsonb_object_agg(mode, until), '{}'::jsonb) from private.ranked_penalties where user_id = (select auth.uid()) and until > now()),
    'queued', (select mode from public.ranked_queue where user_id = (select auth.uid()))
  )
$$;

-- Top 25 (placements done).
create or replace function public.ranked_board(p_mode text)
returns table (rank bigint, user_id uuid, gamertag text, rating integer, tier text, wins integer, losses integer)
language sql stable set search_path = '' as $$
  select row_number() over (order by r.rating desc, r.updated_at), r.user_id, p.gamertag, r.rating,
         public.ranked_tier(r.rating, r.placements), r.wins, r.losses
  from public.ratings r join public.profiles p on p.id = r.user_id
  where r.mode = p_mode and r.placements >= 5
  order by r.rating desc, r.updated_at
  limit 25
$$;

-- Match channels 'match:<id>': only that match's riders, once it has started.
create or replace function public.in_match_topic(t text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.matches m
    where m.id::text = substring(t from '^match:([0-9a-f-]{36})$')
      and (select auth.uid()) = any (m.players)
      and m.status in ('live', 'done')
  )
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.ranked_join(text, uuid)', 'public.ranked_leave_queue()', 'public.ranked_poll()',
    'public.ranked_checkin(uuid)', 'public.ranked_forfeit(uuid)', 'public.ranked_claim(uuid)',
    'public.my_ranked()', 'public.in_match_topic(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end
$$;
revoke all on function public.ranked_record_run(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.ranked_record_run(uuid, uuid, text, integer) to service_role;
grant execute on function public.ranked_board(text) to anon, authenticated;
grant execute on function public.ranked_tier(integer, integer) to anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

drop policy if exists "cranski: match riders listen" on realtime.messages;
create policy "cranski: match riders listen" on realtime.messages
  for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence') and public.in_match_topic((select realtime.topic())));

drop policy if exists "cranski: match riders send" on realtime.messages;
create policy "cranski: match riders send" on realtime.messages
  for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence') and public.in_match_topic((select realtime.topic())));
