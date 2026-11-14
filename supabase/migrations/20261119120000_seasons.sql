-- CranSki · Phase 5 · Step 8: seasons.
--
-- A season lasts about a month (30 days). The per-park leaderboards are the
-- season's boards; THE YARD, APEX and BIG AIR are the prize boards. When a
-- season ends, a scheduled job (pg_cron, see SUPABASE_SETUP.md):
--   - keeps each board's top 10 in season_podiums (the hall of fame);
--   - pays the prize boards' top 10: 2,500 / 1,500 / 750 FROST, then 250 for
--     4th-10th. Only accounts 7+ days old with 20+ finished runs can win;
--     places are counted among those riders;
--   - clears every board (and the runs behind them) and starts the next season.
-- Items, FROST and ratings stay. Each season has its own Season Pass, and the
-- game drops ghosts from earlier seasons.
--
-- When someone beats a board's season best, it's logged in season_records and
-- broadcast on the 'records' channel so everyone online sees RECORD. Each
-- board's leader wears a crown in the game.

create table if not exists public.season_podiums (
  season_id integer not null references public.seasons (id),
  park text not null,
  rank integer not null,
  user_id uuid references public.profiles (id) on delete cascade,
  gamertag text not null,
  total integer not null,
  best_trick text,
  prize integer not null default 0,
  primary key (season_id, park, rank)
);
create table if not exists public.season_records (
  id bigserial primary key,
  season_id integer not null references public.seasons (id),
  park text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  total integer not null,
  previous integer not null,
  at timestamptz not null default now()
);
create index if not exists season_records_at on public.season_records (at desc);
alter table public.season_podiums enable row level security;
alter table public.season_records enable row level security;
revoke all on public.season_podiums, public.season_records from public, anon, authenticated;
grant select on public.season_podiums, public.season_records to anon, authenticated;
drop policy if exists "Season results are public" on public.season_podiums;
create policy "Season results are public" on public.season_podiums for select using (true);
drop policy if exists "Season records are public" on public.season_records;
create policy "Season records are public" on public.season_records for select using (true);

-- A prize is paid once.
create unique index if not exists frost_ledger_prize_once on private.frost_ledger (user_id, ref) where reason = 'prize';

create or replace function private.season_rules() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"days": 30, "prize_parks": ["yard", "apex", "bigair"], "prizes": [2500, 1500, 750, 250, 250, 250, 250, 250, 250, 250],
           "account_days": 7, "runs_needed": 20}'::jsonb
$$;

-- Saving a verified score (as in Phase 3), and now: a new season best on a
-- board is a RECORD. (Same signature, so submit-run doesn't change.)
create or replace function public.record_score(
  p_user uuid,
  p_park text,
  p_total integer,
  p_time real,
  p_best_trick text,
  p_top_speed integer,
  p_airtime real,
  p_sim_version integer,
  p_steps integer,
  p_inputs text,
  p_marks jsonb,
  p_grab_slots jsonb,
  p_board boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  old_total integer;
  prior_best integer;
  mine public.leaderboard;
  improved boolean;
  is_record boolean := false;
  place bigint;
  season public.seasons;
begin
  -- One score at a time per board, so two riders can't both take the record.
  perform pg_advisory_xact_lock(hashtext('cranski-board:' || p_park));
  select max(total) into prior_best from public.leaderboard where park = p_park;
  select total into old_total from public.leaderboard where park = p_park and user_id = p_user for update;
  improved := old_total is null or p_total > old_total;
  if improved then
    insert into public.leaderboard (park, user_id, total, run_time, best_trick, top_speed, airtime, sim_version, achieved_at)
    values (p_park, p_user, p_total, p_time, left(p_best_trick, 80), p_top_speed, p_airtime, p_sim_version, now())
    on conflict (park, user_id) do update set
      total = excluded.total, run_time = excluded.run_time, best_trick = excluded.best_trick,
      top_speed = excluded.top_speed, airtime = excluded.airtime, sim_version = excluded.sim_version,
      achieved_at = excluded.achieved_at;
    insert into public.leaderboard_runs (park, user_id, steps, inputs, marks, grab_slots, board, sim_version)
    values (p_park, p_user, p_steps, p_inputs, coalesce(p_marks, '[]'::jsonb), p_grab_slots, p_board, p_sim_version)
    on conflict (park, user_id) do update set
      steps = excluded.steps, inputs = excluded.inputs, marks = excluded.marks,
      grab_slots = excluded.grab_slots, board = excluded.board, sim_version = excluded.sim_version;
    -- The season best fell (the first score of a season sets it; it isn't a record).
    if prior_best is not null and p_total > prior_best then
      is_record := true;
      season := private.current_season();
      insert into public.season_records (season_id, park, user_id, total, previous) values (season.id, p_park, p_user, p_total, prior_best);
      begin
        perform realtime.send(
          jsonb_build_object('park', p_park, 'user_id', p_user, 'total', p_total, 'previous', prior_best,
            'gamertag', (select gamertag from public.profiles where id = p_user), 'season', season.id),
          'record', 'records', true);
      exception when others then
        null; -- Realtime from the database isn't available: the game also checks every minute
      end;
    end if;
  end if;
  select * into mine from public.leaderboard where park = p_park and user_id = p_user;
  select 1 + count(*) into place from public.leaderboard l
  where l.park = p_park and (l.total > mine.total or (l.total = mine.total and l.achieved_at < mine.achieved_at));
  return jsonb_build_object('best', mine.total, 'improved', improved, 'rank', place, 'record', is_record);
end
$$;
revoke all on function public.record_score(uuid, text, integer, real, text, integer, real, integer, integer, text, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.record_score(uuid, text, integer, real, text, integer, real, integer, integer, text, jsonb, jsonb, boolean) to service_role;

-- End the season if it's due (or now, with p_force): archive, pay prizes, reset boards, start the next.
create or replace function private.end_season(p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  rules jsonb := private.season_rules();
  s public.seasons;
  pk text;
  r record;
  i integer;
  amount integer;
  paid jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('cranski-season-end'));
  select * into s from public.seasons where ended_at is null order by id desc limit 1 for update;
  if not found then
    s := private.current_season();
    return jsonb_build_object('status', 'started', 'season', s.id);
  end if;
  if s.ends_at > now() and not p_force then
    return jsonb_build_object('status', 'not_yet', 'season', s.id, 'ends_at', s.ends_at);
  end if;
  -- Boards are locked while they're archived and cleared.
  perform pg_advisory_xact_lock(hashtext('cranski-board:' || x)) from unnest(array['bigair', 'yard', 'apex', 'forest', 'pipe', 'bellevue']) x;

  -- 1. Hall of fame: each board's top 10.
  insert into public.season_podiums (season_id, park, rank, user_id, gamertag, total, best_trick)
  select s.id, ranked.park, ranked.place, ranked.user_id, ranked.gamertag, ranked.total, ranked.best_trick
  from (
    select l.park, l.user_id, p.gamertag, l.total, l.best_trick,
      row_number() over (partition by l.park order by l.total desc, l.achieved_at) as place
    from public.leaderboard l join public.profiles p on p.id = l.user_id
  ) ranked
  where ranked.place <= 10
  on conflict do nothing;

  -- 2. Prizes on the prize boards, by place among riders who can win.
  for pk in select jsonb_array_elements_text(rules -> 'prize_parks') loop
    i := 0;
    for r in
      select l.user_id, l.total from public.leaderboard l join public.profiles p on p.id = l.user_id
      where l.park = pk
        and p.created_at <= now() - make_interval(days => (rules ->> 'account_days')::integer)
        and private.verified_runs(l.user_id) >= (rules ->> 'runs_needed')::integer
      order by l.total desc, l.achieved_at
      limit 10
    loop
      i := i + 1;
      amount := (rules -> 'prizes' ->> (i - 1))::integer;
      perform private.add_frost(r.user_id, amount, 'prize', format('season:%s:%s:%s', s.id, pk, i));
      update public.season_podiums set prize = amount where season_id = s.id and park = pk and user_id = r.user_id;
      paid := paid || jsonb_build_object('park', pk, 'place', i, 'user_id', r.user_id, 'frost', amount);
    end loop;
  end loop;

  -- 3. Fresh boards (the runs behind them go too), and the next season.
  delete from public.leaderboard;
  update public.seasons set ended_at = now() where id = s.id;
  insert into public.seasons (id, name, starts_at, ends_at)
  values (s.id + 1, 'Season ' || (s.id + 1), date_trunc('day', now()), date_trunc('day', now()) + make_interval(days => (rules ->> 'days')::integer));
  return jsonb_build_object('status', 'ended', 'season', s.id, 'next', s.id + 1, 'prizes', paid);
end
$$;

-- What the scheduled job runs (hourly): ends the season once it's due.
create or replace function public.season_tick() returns jsonb
language sql security definer set search_path = '' as $$
  select private.end_season(false)
$$;

-- This season, its prize rules, the last season's winners and (signed in) what I won.
create or replace function public.season_info() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.seasons := private.current_season();
  last public.seasons;
  me uuid := auth.uid();
begin
  select * into last from public.seasons where ended_at is not null order by id desc limit 1;
  return jsonb_build_object(
    'season', jsonb_build_object('id', s.id, 'name', s.name, 'starts_at', s.starts_at, 'ends_at', s.ends_at),
    'rules', private.season_rules(),
    'last', case when last.id is null then null else jsonb_build_object(
      'id', last.id, 'name', last.name,
      'podiums', (select coalesce(jsonb_agg(jsonb_build_object('park', park, 'rank', rank, 'gamertag', gamertag, 'total', total, 'prize', prize) order by park, rank), '[]'::jsonb)
                  from public.season_podiums where season_id = last.id and rank <= 3),
      'mine', case when me is null then null else (
        select coalesce(jsonb_agg(jsonb_build_object('park', split_part(ref, ':', 3), 'place', split_part(ref, ':', 4)::integer, 'frost', delta)), '[]'::jsonb)
        from private.frost_ledger where user_id = me and reason = 'prize' and ref like 'season:' || last.id || ':%') end
    ) end);
end
$$;

-- Each board's season leader (they wear the crown).
create or replace function public.season_leaders() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(t.park, jsonb_build_object('user_id', t.user_id, 'gamertag', t.gamertag, 'total', t.total)), '{}'::jsonb)
  from (
    select distinct on (l.park) l.park, l.user_id, p.gamertag, l.total
    from public.leaderboard l join public.profiles p on p.id = l.user_id
    order by l.park, l.total desc, l.achieved_at
  ) t
$$;

-- Records set since a moment (the game checks every minute, in case it missed a broadcast).
create or replace function public.recent_records(p_since timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'park', r.park, 'user_id', r.user_id, 'gamertag', p.gamertag,
    'total', r.total, 'previous', r.previous, 'at', r.at, 'season', r.season_id) order by r.at), '[]'::jsonb)
  from (select * from public.season_records where at > greatest(p_since, now() - interval '1 hour') order by at desc limit 20) r
  join public.profiles p on p.id = r.user_id
$$;

-- The 'records' channel: anyone can listen; only the database broadcasts on it.
drop policy if exists "cranski: everyone hears records" on realtime.messages;
create policy "cranski: everyone hears records" on realtime.messages
  for select to anon, authenticated
  using (realtime.messages.extension = 'broadcast' and (select realtime.topic()) = 'records');

revoke all on function private.end_season(boolean) from public, anon, authenticated;
revoke all on function public.season_tick() from public, anon, authenticated;
revoke all on function public.season_info() from public;
grant execute on function public.season_info() to anon, authenticated;
revoke all on function public.season_leaders() from public;
grant execute on function public.season_leaders() to anon, authenticated;
revoke all on function public.recent_records(timestamptz) from public;
grant execute on function public.recent_records(timestamptz) to anon, authenticated;

-- The scheduled job (once pg_cron is turned on: see SUPABASE_SETUP.md, then run this file again).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('cranski-season-end', '7 * * * *', 'select public.season_tick()');
  end if;
end
$$;
