-- CranSki · Phase 3 · Step 1: rider profiles and gamertags.
--
-- Accounts themselves live in Supabase Auth (auth.users): an email address and
-- nothing else; sign-in is by emailed link, there are no passwords. This file
-- adds the public gamertag each rider picks, with the name rules from
-- DESIGN.md (Safety):
--   * letters, spaces and dashes;
--   * one rider per name, ignoring case and symbols;
--   * offensive names blocked.
-- src/online/names.js mirrors these rules for instant feedback; this is the
-- one that counts.

-- Helpers live in a schema the Data API doesn't expose.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ROT13 of a lower-case a-z string (the blocklist is stored ROT13-encoded so
-- the repository doesn't spell the words out).
create or replace function private.rot13(s text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select translate(s, 'abcdefghijklmnopqrstuvwxyz', 'nopqrstuvwxyzabcdefghijklm')
$$;

-- The uniqueness key: lower case, Latin-1 accents folded, letters a-z only.
-- "Mad-Dog", "mad dog" and "MÁDDOG" all become "maddog".
create or replace function private.tag_key(name text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select regexp_replace(
    translate(
      replace(replace(replace(replace(replace(coalesce(name, ''), 'ß', 'ss'), 'Æ', 'ae'), 'æ', 'ae'), 'Þ', 'th'), 'þ', 'th'),
      'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝàáâãäåçèéêëìíîïðñòóôõöøùúûüýÿABCDEFGHIJKLMNOPQRSTUVWXYZ',
      'aaaaaaceeeeiiiidnoooooouuuuyaaaaaaceeeeiiiidnoooooouuuuyyabcdefghijklmnopqrstuvwxyz'),
    '[^a-z]', '', 'g')
$$;

-- Blocked words. anywhere = blocked inside any name; otherwise only as a whole
-- word (so innocent names that happen to contain them still work). Reserved
-- names that could impersonate staff are in here too.
create table if not exists private.blocked_name_terms (
  term_rot13 text primary key,
  anywhere boolean not null
);
alter table private.blocked_name_terms enable row level security;

insert into private.blocked_name_terms (term_rot13, anywhere) values
  ('shpx', true),
  ('avttre', true),
  ('avttn', true),
  ('snttbg', true),
  ('ergneq', true),
  ('jrgonpx', true),
  ('enturnq', true),
  ('gbjryurnq', true),
  ('uvgyre', true),
  ('crqbcuvyr', true),
  ('cnrqbcuvyr', true),
  ('cravf', true),
  ('intvan', true),
  ('qvpxurnq', true),
  ('pbpxfhpxre', true),
  ('ovgpu', true),
  ('juber', true),
  ('fyhg', true),
  ('nffubyr', true),
  ('nefrubyr', true),
  ('onfgneq', true),
  ('jnaxre', true),
  ('cbea', true),
  ('wvmm', true),
  ('qvyqb', true),
  ('zvys', true),
  ('vaprfg', true),
  ('ohyyfuvg', true),
  ('fuvgurnq', true),
  ('zbgureshpxre', true),
  ('nqzva', true),
  ('zbqrengbe', true),
  ('penafxv', true),
  ('fuvg', false),
  ('phag', false),
  ('snt', false),
  ('xvxr', false),
  ('puvax', false),
  ('fcvp', false),
  ('genaal', false),
  ('cnxv', false),
  ('pbba', false),
  ('tbbx', false),
  ('ornare', false),
  ('anmv', false),
  ('urvy', false),
  ('xxx', false),
  ('encr', false),
  ('encvfg', false),
  ('crqb', false),
  ('cnrqb', false),
  ('qvpx', false),
  ('pbpx', false),
  ('chffl', false),
  ('nff', false),
  ('nefr', false),
  ('jnax', false),
  ('gjng', false),
  ('frk', false),
  ('phz', false),
  ('gvgf', false),
  ('nany', false),
  ('ubeal', false),
  ('xlf', false),
  ('bssvpvny', false),
  ('fgnss', false),
  ('fhccbeg', false)
on conflict (term_rot13) do update set anywhere = excluded.anywhere;

-- null when the name is fine, else 'length' | 'chars' | 'blocked'.
create or replace function private.tag_problem(name text) returns text
language plpgsql stable set search_path = '' as $$
declare
  k text;
  words text[];
begin
  if name is null or char_length(name) < 3 or char_length(name) > 18 then
    return 'length';
  end if;
  if name !~ '^[A-Za-zÀ-ÖØ-öø-ÿ]+([ -][A-Za-zÀ-ÖØ-öø-ÿ]+)*$' then
    return 'chars';
  end if;
  k := private.tag_key(name);
  if char_length(k) < 3 then
    return 'length';
  end if;
  select array_agg(private.rot13(private.tag_key(w))) into words
  from regexp_split_to_table(name, '[ -]+') as w;
  if exists (
    select 1 from private.blocked_name_terms b
    where (b.anywhere and strpos(private.rot13(k), b.term_rot13) > 0)
       or b.term_rot13 = private.rot13(k)
       or b.term_rot13 = any (words)
  ) then
    return 'blocked';
  end if;
  return null;
end
$$;

-- ------------------------------------------------------------------ profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  gamertag text not null,
  gamertag_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_gamertag_key on public.profiles (gamertag_key);

-- Every insert or rename is checked and gets its key here, whoever sends it.
create or replace function private.profiles_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  problem text;
begin
  new.gamertag := regexp_replace(btrim(new.gamertag), '\s+', ' ', 'g');
  problem := private.tag_problem(new.gamertag);
  if problem is not null then
    raise exception 'gamertag_%', problem using errcode = 'check_violation';
  end if;
  new.gamertag_key := private.tag_key(new.gamertag);
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists profiles_before_write on public.profiles;
create trigger profiles_before_write
  before insert or update on public.profiles
  for each row execute function private.profiles_before_write();

-- Row Level Security: gamertags are public (leaderboards, friend search);
-- you can only create and rename your own; nobody deletes through the API
-- (deleting the account removes the profile).
alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant insert (id, gamertag), update (gamertag) on public.profiles to authenticated;

drop policy if exists "Gamertags are public" on public.profiles;
create policy "Gamertags are public" on public.profiles
  for select to anon, authenticated using (true);

drop policy if exists "Riders create their own profile" on public.profiles;
create policy "Riders create their own profile" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);

drop policy if exists "Riders rename only themselves" on public.profiles;
create policy "Riders rename only themselves" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Live availability check while typing:
-- 'ok' | 'yours' | 'taken' | 'length' | 'chars' | 'blocked'.
create or replace function public.gamertag_status(name text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  tag text := regexp_replace(btrim(coalesce(name, '')), '\s+', ' ', 'g');
  problem text;
  owner uuid;
begin
  problem := private.tag_problem(tag);
  if problem is not null then
    return problem;
  end if;
  select p.id into owner from public.profiles p where p.gamertag_key = private.tag_key(tag);
  if owner is null then
    return 'ok';
  elsif owner = auth.uid() then
    return 'yours';
  end if;
  return 'taken';
end
$$;

revoke all on function public.gamertag_status(text) from public;
grant execute on function public.gamertag_status(text) to anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
