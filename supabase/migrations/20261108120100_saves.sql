-- CranSki · Phase 3 · Step 2: cloud saves.
--
-- One row per account holding the things that follow you between devices:
-- settings (camera, sound, stats overlay, key and controller bindings), personal
-- bests per park, and Locker choices. Graphics level, frame cap and the touch
-- layout stay on each device.
--
-- Personal bests here are your own record, not leaderboard scores: only the
-- submit-run Edge Function (step 4) can write leaderboard scores.

create table if not exists public.saves (
  user_id uuid primary key references auth.users (id) on delete cascade,
  settings jsonb,
  settings_at timestamptz,
  locker jsonb,
  locker_at timestamptz,
  bests jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint saves_settings_size check (settings is null or (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 32768)),
  constraint saves_locker_size check (locker is null or (jsonb_typeof(locker) = 'object' and pg_column_size(locker) < 8192)),
  constraint saves_bests_shape check (jsonb_typeof(bests) = 'object' and pg_column_size(bests) < 4096)
);

-- Keep only "park id -> whole number of points" pairs, taking the higher of
-- the two values for each park.
create or replace function private.merge_bests(a jsonb, b jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
  from (
    select k, max(v) as v
    from (
      select key as k, (value #>> '{}')::numeric as v
      from jsonb_each(coalesce(a, '{}'::jsonb) || '{}'::jsonb)
      where key ~ '^[a-z]{2,16}$' and jsonb_typeof(value) = 'number'
      union all
      select key, (value #>> '{}')::numeric
      from jsonb_each(case when jsonb_typeof(b) = 'object' then b else '{}'::jsonb end)
      where key ~ '^[a-z]{2,16}$' and jsonb_typeof(value) = 'number'
    ) x
    where v >= 0 and v <= 100000000
    group by k
    limit 64
  ) y
$$;

-- Row Level Security: you can only ever see and change your own save.
alter table public.saves enable row level security;

revoke all on public.saves from anon, authenticated;
grant select on public.saves to authenticated;

drop policy if exists "Riders read their own save" on public.saves;
create policy "Riders read their own save" on public.saves
  for select to authenticated using ((select auth.uid()) = user_id);

-- Writes go through sync_save, which merges instead of overwriting:
-- settings and Locker keep whichever side changed last, bests keep the
-- higher score for each park. It returns the merged save.
create or replace function public.sync_save(
  p_settings jsonb default null,
  p_settings_at timestamptz default null,
  p_locker jsonb default null,
  p_locker_at timestamptz default null,
  p_bests jsonb default null
) returns public.saves
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  row public.saves;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_settings is not null and jsonb_typeof(p_settings) <> 'object' then p_settings := null; end if;
  if p_locker is not null and jsonb_typeof(p_locker) <> 'object' then p_locker := null; end if;
  -- A clock far in the future can't pin a save forever.
  if p_settings_at > now() + interval '1 day' then p_settings_at := now(); end if;
  if p_locker_at > now() + interval '1 day' then p_locker_at := now(); end if;

  insert into public.saves (user_id) values (me) on conflict (user_id) do nothing;
  select * into row from public.saves s where s.user_id = me for update;

  if p_settings is not null and p_settings_at is not null and (row.settings_at is null or p_settings_at > row.settings_at) then
    row.settings := p_settings;
    row.settings_at := p_settings_at;
  end if;
  if p_locker is not null and p_locker_at is not null and (row.locker_at is null or p_locker_at > row.locker_at) then
    row.locker := p_locker;
    row.locker_at := p_locker_at;
  end if;
  row.bests := private.merge_bests(row.bests, p_bests);
  row.updated_at := now();

  update public.saves s
  set settings = row.settings, settings_at = row.settings_at,
      locker = row.locker, locker_at = row.locker_at,
      bests = row.bests, updated_at = row.updated_at
  where s.user_id = me;
  return row;
end
$$;

revoke all on function public.sync_save(jsonb, timestamptz, jsonb, timestamptz, jsonb) from public, anon;
grant execute on function public.sync_save(jsonb, timestamptz, jsonb, timestamptz, jsonb) to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
