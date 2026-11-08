-- CranSki · Phase 3 · Step 4: per-park leaderboards, checked by the server.
--
-- A run is submitted as its recorded inputs. The submit-run Edge Function
-- re-rides those inputs through the same deterministic simulation the game
-- uses, and only if its score matches what the player saw does it save a
-- score, and the score it saves is the one it calculated itself.
--
-- Riders can read the boards (signed in or not) but can never write to them:
-- only the Edge Function, using the project's secret key on Supabase's
-- servers, can call record_score.

-- One row per rider per park: their best verified run.
create table if not exists public.leaderboard (
  park text not null check (park in ('bigair', 'yard', 'apex', 'forest', 'pipe', 'bellevue')),
  user_id uuid not null references public.profiles (id) on delete cascade,
  total integer not null check (total >= 0),
  run_time real,
  best_trick text,
  top_speed integer,
  airtime real,
  sim_version integer not null,
  achieved_at timestamptz not null default now(),
  primary key (park, user_id)
);
create index if not exists leaderboard_rank on public.leaderboard (park, total desc, achieved_at);

-- The inputs behind each leaderboard run, kept so a run can be re-checked or
-- watched later. Not readable through the API.
create table if not exists public.leaderboard_runs (
  park text not null,
  user_id uuid not null,
  steps integer not null,
  inputs text not null,
  marks jsonb not null default '[]'::jsonb,
  grab_slots jsonb not null,
  board boolean not null,
  sim_version integer not null,
  primary key (park, user_id),
  foreign key (park, user_id) references public.leaderboard (park, user_id) on delete cascade
);

-- Submissions per rider, for a simple rate limit.
create table if not exists private.submissions (
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists submissions_user_at on private.submissions (user_id, at);

-- ------------------------------------------------------------------ access
alter table public.leaderboard enable row level security;
alter table public.leaderboard_runs enable row level security;

revoke all on public.leaderboard from anon, authenticated;
revoke all on public.leaderboard_runs from anon, authenticated;
grant select on public.leaderboard to anon, authenticated;

drop policy if exists "Leaderboards are public" on public.leaderboard;
create policy "Leaderboards are public" on public.leaderboard
  for select to anon, authenticated using (true);
-- No insert/update/delete policies: riders can't write scores at all.

-- ------------------------------------------------------------------ server-only functions

-- Count a submission; false if this rider has sent too many recently.
create or replace function public.note_submission(p_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.submissions where at < now() - interval '1 day';
  if (select count(*) from private.submissions where user_id = p_user and at > now() - interval '10 minutes') >= 30 then
    return false;
  end if;
  insert into private.submissions (user_id) values (p_user);
  return true;
end
$$;

-- Save a verified score (keeping the rider's best) and return
-- { best, improved, rank }.
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
  mine public.leaderboard;
  improved boolean;
  place bigint;
begin
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
  end if;
  select * into mine from public.leaderboard where park = p_park and user_id = p_user;
  select 1 + count(*) into place from public.leaderboard l
  where l.park = p_park and (l.total > mine.total or (l.total = mine.total and l.achieved_at < mine.achieved_at));
  return jsonb_build_object('best', mine.total, 'improved', improved, 'rank', place);
end
$$;

revoke all on function public.note_submission(uuid) from public, anon, authenticated;
revoke all on function public.record_score(uuid, text, integer, real, text, integer, real, integer, integer, text, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.note_submission(uuid) to service_role;
grant execute on function public.record_score(uuid, text, integer, real, text, integer, real, integer, integer, text, jsonb, jsonb, boolean) to service_role;

-- ------------------------------------------------------------------ reading the boards

-- Top of a board, with gamertags.
create or replace function public.leaderboard_top(p_park text, p_limit integer default 50)
returns table (rank bigint, user_id uuid, gamertag text, total integer, best_trick text, achieved_at timestamptz)
language sql stable set search_path = '' as $$
  select row_number() over (order by l.total desc, l.achieved_at), l.user_id, p.gamertag, l.total, l.best_trick, l.achieved_at
  from public.leaderboard l join public.profiles p on p.id = l.user_id
  where l.park = p_park
  order by l.total desc, l.achieved_at
  limit least(greatest(p_limit, 1), 100)
$$;

-- Your own place on a board (null row if you haven't posted there).
create or replace function public.leaderboard_me(p_park text)
returns table (rank bigint, total integer, best_trick text, achieved_at timestamptz)
language sql stable set search_path = '' as $$
  select 1 + (select count(*) from public.leaderboard o
              where o.park = l.park and (o.total > l.total or (o.total = l.total and o.achieved_at < l.achieved_at))),
         l.total, l.best_trick, l.achieved_at
  from public.leaderboard l
  where l.park = p_park and l.user_id = (select auth.uid())
$$;

-- You and your accepted friends on a board, with your places on the full board.
create or replace function public.leaderboard_friends(p_park text)
returns table (rank bigint, user_id uuid, gamertag text, total integer, best_trick text, achieved_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with ranked as (
    select l.*, row_number() over (order by l.total desc, l.achieved_at) as place
    from public.leaderboard l where l.park = p_park
  )
  select r.place, r.user_id, p.gamertag, r.total, r.best_trick, r.achieved_at
  from ranked r join public.profiles p on p.id = r.user_id
  where r.user_id = (select auth.uid())
     or exists (
       select 1 from public.friendships f
       where f.status = 'accepted'
         and ((f.requester = (select auth.uid()) and f.addressee = r.user_id)
           or (f.addressee = (select auth.uid()) and f.requester = r.user_id)))
  order by r.place
  limit 200
$$;

revoke all on function public.leaderboard_top(text, integer) from public;
revoke all on function public.leaderboard_me(text) from public;
revoke all on function public.leaderboard_friends(text) from public, anon;
grant execute on function public.leaderboard_top(text, integer) to anon, authenticated;
grant execute on function public.leaderboard_me(text) to authenticated;
grant execute on function public.leaderboard_friends(text) to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
