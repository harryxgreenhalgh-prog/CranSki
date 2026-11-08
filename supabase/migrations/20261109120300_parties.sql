-- CranSki · Phase 4 · Step 5: parties of up to 4 friends.
--
-- INVITE / JOIN: members invite their accepted friends; an invited rider joins.
-- The leader picks the park and can switch to a private room; when the leader
-- heads off, everyone else gets a GO / STAY prompt. Party chat goes through
-- the chat Edge Function like room chat. The leader can remove someone, who
-- then can't rejoin that party for 10 minutes.
--
-- Everything is read and written through the functions below, which act as
-- the signed-in rider (auth.uid()).

create table if not exists public.parties (
  id uuid primary key default gen_random_uuid(),
  leader uuid not null references public.profiles (id) on delete cascade,
  park text check (park is null or park ~ '^[a-z]{2,16}$'),
  private_room boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.party_members (
  party_id uuid not null references public.parties (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (party_id, user_id)
);
-- A rider is in at most one party.
create unique index if not exists party_members_one_party on public.party_members (user_id);

create table if not exists public.party_invites (
  party_id uuid not null references public.parties (id) on delete cascade,
  invitee uuid not null references public.profiles (id) on delete cascade,
  inviter uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (party_id, invitee)
);

create table if not exists public.party_bans (
  party_id uuid not null references public.parties (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  until timestamptz not null,
  primary key (party_id, user_id)
);

alter table public.parties enable row level security;
alter table public.party_members enable row level security;
alter table public.party_invites enable row level security;
alter table public.party_bans enable row level security;
revoke all on public.parties, public.party_members, public.party_invites, public.party_bans from anon, authenticated;

-- ------------------------------------------------------------------ helpers
create or replace function private.my_party() returns uuid
language sql stable security definer set search_path = '' as $$
  select party_id from public.party_members where user_id = (select auth.uid())
$$;

create or replace function private.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted' and ((f.requester = a and f.addressee = b) or (f.requester = b and f.addressee = a))
  )
$$;

-- Used by the chat Edge Function (secret key) for party chat.
create or replace function public.party_has_member(p_party uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.party_members where party_id = p_party and user_id = p_user)
$$;

-- Leave whatever party I'm in. The next member becomes leader; an empty party
-- is deleted.
create or replace function private.leave_my_party(me uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  pid uuid;
  next_leader uuid;
begin
  select party_id into pid from public.party_members where user_id = me;
  if pid is null then return; end if;
  delete from public.party_members where party_id = pid and user_id = me;
  select user_id into next_leader from public.party_members where party_id = pid order by joined_at limit 1;
  if next_leader is null then
    delete from public.parties where id = pid;
  else
    update public.parties set leader = next_leader where id = pid and leader = me;
  end if;
end
$$;

-- ------------------------------------------------------------------ riders' functions

-- Start a party (or get the one I'm already in).
create or replace function public.create_party() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  pid uuid;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then
    raise exception 'pick a gamertag first' using errcode = '42501';
  end if;
  pid := private.my_party();
  if pid is not null then return pid; end if;
  insert into public.parties (leader) values (me) returning id into pid;
  insert into public.party_members (party_id, user_id) values (pid, me);
  return pid;
end
$$;

-- Invite an accepted friend. 'invited' | 'not_friends' | 'full' | 'already' | 'no_party'
create or replace function public.invite_to_party(friend uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  pid uuid := private.my_party();
begin
  if pid is null then return 'no_party'; end if;
  if not private.are_friends(me, friend) then return 'not_friends'; end if;
  if exists (select 1 from public.party_members where party_id = pid and user_id = friend) then return 'already'; end if;
  if (select count(*) from public.party_members where party_id = pid) >= 4 then return 'full'; end if;
  insert into public.party_invites (party_id, invitee, inviter) values (pid, friend, me)
  on conflict (party_id, invitee) do update set inviter = excluded.inviter, created_at = now();
  return 'invited';
end
$$;

-- Join a party I've been invited to (leaving any other party).
-- 'joined' | 'not_invited' | 'full' | 'removed' | 'gone'
create or replace function public.join_party(p_party uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.parties where id = p_party) then
    delete from public.party_invites where party_id = p_party and invitee = me;
    return 'gone';
  end if;
  if exists (select 1 from public.party_members where party_id = p_party and user_id = me) then return 'joined'; end if;
  if exists (select 1 from public.party_bans where party_id = p_party and user_id = me and until > now()) then return 'removed'; end if;
  if not exists (select 1 from public.party_invites where party_id = p_party and invitee = me) then return 'not_invited'; end if;
  if (select count(*) from public.party_members where party_id = p_party) >= 4 then return 'full'; end if;
  perform private.leave_my_party(me);
  insert into public.party_members (party_id, user_id) values (p_party, me);
  delete from public.party_invites where party_id = p_party and invitee = me;
  return 'joined';
end
$$;

create or replace function public.decline_party_invite(p_party uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.party_invites where party_id = p_party and invitee = (select auth.uid())
$$;

create or replace function public.leave_party() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.leave_my_party(auth.uid());
end
$$;

-- Leader only: remove someone; they can't rejoin for 10 minutes.
-- 'removed' | 'not_leader' | 'not_member'
create or replace function public.remove_from_party(member uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  pid uuid := private.my_party();
begin
  if pid is null or not exists (select 1 from public.parties where id = pid and leader = me) then return 'not_leader'; end if;
  if member = me then return 'not_member'; end if;
  delete from public.party_members where party_id = pid and user_id = member;
  if not found then return 'not_member'; end if;
  delete from public.party_invites where party_id = pid and invitee = member;
  insert into public.party_bans (party_id, user_id, until) values (pid, member, now() + interval '10 minutes')
  on conflict (party_id, user_id) do update set until = excluded.until;
  return 'removed';
end
$$;

-- Leader only: pick the park and switch the private room on or off.
create or replace function public.set_party(p_park text, p_private boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  pid uuid := private.my_party();
begin
  if pid is null or not exists (select 1 from public.parties where id = pid and leader = me) then return 'not_leader'; end if;
  if p_park is not null and p_park !~ '^[a-z]{2,16}$' then return 'bad_park'; end if;
  update public.parties set park = coalesce(p_park, park), private_room = coalesce(p_private, private_room) where id = pid;
  return 'ok';
end
$$;

-- My party: { id, leader, park, private_room, members: [{ id, gamertag }] } or null.
create or replace function public.my_party() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'leader', p.leader, 'park', p.park, 'private_room', p.private_room,
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'gamertag', pr.gamertag) order by m.joined_at), '[]'::jsonb)
                from public.party_members m join public.profiles pr on pr.id = m.user_id where m.party_id = p.id)
  )
  from public.parties p
  where p.id = private.my_party()
$$;

-- Invites waiting for me: [{ party, inviter, leader, members }]
create or replace function public.my_party_invites()
returns table (party uuid, inviter text, leader text, members integer)
language sql stable security definer set search_path = '' as $$
  select i.party_id, ip.gamertag, lp.gamertag, (select count(*)::integer from public.party_members m where m.party_id = i.party_id)
  from public.party_invites i
  join public.parties p on p.id = i.party_id
  join public.profiles ip on ip.id = i.inviter
  join public.profiles lp on lp.id = p.leader
  where i.invitee = (select auth.uid()) and i.created_at > now() - interval '1 day'
  order by i.created_at desc
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.create_party()', 'public.invite_to_party(uuid)', 'public.join_party(uuid)',
    'public.decline_party_invite(uuid)', 'public.leave_party()', 'public.remove_from_party(uuid)',
    'public.set_party(text, boolean)', 'public.my_party()', 'public.my_party_invites()'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end
$$;
revoke all on function public.party_has_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.party_has_member(uuid, uuid) to service_role;
revoke all on all functions in schema private from public, anon, authenticated;

-- ------------------------------------------------------------------ party channels
-- 'party:<id>'          the party's own channel (who's online, GO, removals);
-- 'pchat:<id>'          party chat (listen only; sent by the chat function);
-- 'room:<park>:p<id>'   the party's private room.
-- Only that party's members may use them. (A function, because riders can't
-- read the members table directly.)
create or replace function public.in_party_topic(t text, include_chat boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.party_members m
    where m.user_id = (select auth.uid())
      and m.party_id::text = coalesce(
        substring(t from '^party:([0-9a-f-]{36})$'),
        case when include_chat then substring(t from '^pchat:([0-9a-f-]{36})$') end,
        substring(t from '^room:[a-z]+:p([0-9a-f-]{36})$')
      )
  )
$$;
revoke all on function public.in_party_topic(text, boolean) from public, anon;
grant execute on function public.in_party_topic(text, boolean) to authenticated;

drop policy if exists "cranski: party members listen" on realtime.messages;
create policy "cranski: party members listen" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.in_party_topic((select realtime.topic()), true)
  );

drop policy if exists "cranski: party members send" on realtime.messages;
create policy "cranski: party members send" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.in_party_topic((select realtime.topic()), false)
  );
