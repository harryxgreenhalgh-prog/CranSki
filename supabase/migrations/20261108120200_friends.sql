-- CranSki · Phase 3 · Step 3: friends and online status.
--
-- Rules (DESIGN.md, Safety): friends see your location only once you've
-- accepted each other. Pending requests show a gamertag and nothing else.
--
-- The tables are read and written only through the functions below, which
-- always act as the signed-in rider (auth.uid()).

-- ------------------------------------------------------------------ friendships
create table if not exists public.friendships (
  requester uuid not null references public.profiles (id) on delete cascade,
  addressee uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (requester, addressee),
  constraint friendships_not_self check (requester <> addressee)
);
-- One row per pair, whichever way round the request went.
create unique index if not exists friendships_pair
  on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index if not exists friendships_addressee on public.friendships (addressee);

alter table public.friendships enable row level security;
revoke all on public.friendships from anon, authenticated;
grant select on public.friendships to authenticated;

drop policy if exists "Riders see their own friendships" on public.friendships;
create policy "Riders see their own friendships" on public.friendships
  for select to authenticated
  using ((select auth.uid()) in (requester, addressee));

-- ------------------------------------------------------------------ presence
-- Where each signed-in rider is right now. Nobody can read this table
-- directly except for their own row: friends get it through my_friends(),
-- which only includes accepted friends.
create table if not exists public.presence (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  location text not null check (location in ('basecamp', 'lift', 'riding', 'replay')),
  park text check (park ~ '^[a-z]{2,16}$'),
  seen_at timestamptz not null default now()
);

alter table public.presence enable row level security;
revoke all on public.presence from anon, authenticated;
grant select on public.presence to authenticated;

drop policy if exists "Riders see only their own presence row" on public.presence;
create policy "Riders see only their own presence row" on public.presence
  for select to authenticated using ((select auth.uid()) = user_id);

-- Fast "gamertag starts with" search.
create index if not exists profiles_gamertag_prefix on public.profiles (gamertag_key text_pattern_ops);

-- ------------------------------------------------------------------ functions

-- Find riders by gamertag (ignoring case, spaces and dashes). Signed-in only.
create or replace function public.search_riders(q text)
returns table (id uuid, gamertag text, relation text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.gamertag,
    coalesce((
      select case
        when f.status = 'accepted' then 'friend'
        when f.requester = (select auth.uid()) then 'outgoing'
        else 'incoming' end
      from public.friendships f
      where (f.requester = (select auth.uid()) and f.addressee = p.id)
         or (f.requester = p.id and f.addressee = (select auth.uid()))
    ), 'none')
  from public.profiles p
  where (select auth.uid()) is not null
    and char_length(private.tag_key(q)) >= 2
    and p.gamertag_key like private.tag_key(q) || '%'
    and p.id <> (select auth.uid())
  order by (p.gamertag_key = private.tag_key(q)) desc, char_length(p.gamertag_key), p.gamertag_key
  limit 10
$$;

-- Ask someone to be friends. If they already asked you, you're now friends.
-- Returns 'requested' | 'accepted' | 'friends' | 'self' | 'unknown' |
-- 'no_gamertag' | 'too_many'.
create or replace function public.send_friend_request(target uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  existing public.friendships;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if target = me then return 'self'; end if;
  if not exists (select 1 from public.profiles where id = me) then return 'no_gamertag'; end if;
  if not exists (select 1 from public.profiles where id = target) then return 'unknown'; end if;

  select * into existing from public.friendships f
  where (f.requester = me and f.addressee = target) or (f.requester = target and f.addressee = me);
  if found then
    if existing.status = 'accepted' then return 'friends'; end if;
    if existing.requester = me then return 'requested'; end if;
    update public.friendships set status = 'accepted', accepted_at = now()
    where requester = target and addressee = me;
    return 'accepted';
  end if;

  if (select count(*) from public.friendships where requester = me and status = 'pending') >= 50
     or (select count(*) from public.friendships where me in (requester, addressee) and status = 'accepted') >= 200 then
    return 'too_many';
  end if;
  insert into public.friendships (requester, addressee) values (me, target);
  return 'requested';
exception when unique_violation then
  return 'requested';
end
$$;

-- Accept or decline a request someone sent you. Returns 'friends' |
-- 'declined' | 'gone'.
create or replace function public.respond_friend_request(other uuid, accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if accept then
    update public.friendships set status = 'accepted', accepted_at = now()
    where requester = other and addressee = me and status = 'pending';
    return case when found then 'friends' else 'gone' end;
  end if;
  delete from public.friendships where requester = other and addressee = me and status = 'pending';
  return case when found then 'declined' else 'gone' end;
end
$$;

-- Cancel a request you sent, or unfriend someone.
create or replace function public.remove_friend(other uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from public.friendships
  where (requester = me and addressee = other) or (requester = other and addressee = me);
  return case when found then 'removed' else 'gone' end;
end
$$;

-- Your friends and requests. Online status and location are only filled in
-- for accepted friends who were seen in the last 90 seconds.
create or replace function public.my_friends()
returns table (id uuid, gamertag text, relation text, online boolean, location text, park text, since timestamptz)
language sql stable security definer set search_path = '' as $$
  with mine as (
    select f.*, case when f.requester = (select auth.uid()) then f.addressee else f.requester end as other
    from public.friendships f
    where (select auth.uid()) in (f.requester, f.addressee)
  )
  select p.id, p.gamertag,
    case when m.status = 'accepted' then 'friend'
         when m.addressee = (select auth.uid()) then 'incoming'
         else 'outgoing' end as relation,
    coalesce(m.status = 'accepted' and pr.seen_at > now() - interval '90 seconds', false) as online,
    case when m.status = 'accepted' and pr.seen_at > now() - interval '90 seconds' then pr.location end,
    case when m.status = 'accepted' and pr.seen_at > now() - interval '90 seconds' then pr.park end,
    coalesce(m.accepted_at, m.created_at)
  from mine m
  join public.profiles p on p.id = m.other
  left join public.presence pr on pr.user_id = m.other
  order by relation, online desc, p.gamertag_key
$$;

-- "I'm here": called when your location changes and every ~45 s while the
-- game is open. Does nothing until you have a gamertag.
create or replace function public.heartbeat(p_location text, p_park text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then
    return;
  end if;
  if p_location is null or p_location not in ('basecamp', 'lift', 'riding', 'replay') then
    p_location := 'basecamp';
  end if;
  if p_park is not null and p_park !~ '^[a-z]{2,16}$' then
    p_park := null;
  end if;
  insert into public.presence (user_id, location, park, seen_at)
  values (me, p_location, case when p_location = 'basecamp' then null else p_park end, now())
  on conflict (user_id) do update
    set location = excluded.location, park = excluded.park, seen_at = excluded.seen_at;
end
$$;

-- Appear offline / signing out.
create or replace function public.go_offline() returns void
language sql security definer set search_path = '' as $$
  delete from public.presence where user_id = (select auth.uid())
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.search_riders(text)',
    'public.send_friend_request(uuid)',
    'public.respond_friend_request(uuid, boolean)',
    'public.remove_friend(uuid)',
    'public.my_friends()',
    'public.heartbeat(text, text)',
    'public.go_offline()'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end
$$;
revoke all on all functions in schema private from public, anon, authenticated;
