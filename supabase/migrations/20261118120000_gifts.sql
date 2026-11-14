-- CranSki · Phase 5 · Step 7: gifting to friends.
--
-- Buy one of today's Shop items for a friend, with your FROST. To keep it
-- friendly and hard to abuse:
--   - 5 gifts a day per sender (UTC);
--   - only to friends you've had for 2+ days;
--   - your account (from when you picked your gamertag) must be a week old,
--     with 20 finished runs the server re-rode (counted from the FROST ledger);
--   - anyone can turn gifts off in Settings, and nobody can send them one then;
--   - they can't already own it, and gifts can't be returned.
-- Everything is checked and done here; riders can't write these tables.

create table if not exists public.gift_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  accept boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.gift_settings enable row level security;
revoke all on public.gift_settings from public, anon, authenticated;
grant select on public.gift_settings to authenticated;
drop policy if exists "Riders see their own gift setting" on public.gift_settings;
create policy "Riders see their own gift setting" on public.gift_settings
  for select to authenticated using (user_id = (select auth.uid()));

create table if not exists public.gifts (
  id bigserial primary key,
  sender uuid references public.profiles (id) on delete set null,
  recipient uuid not null references public.profiles (id) on delete cascade,
  item_id text not null references public.items (id),
  price integer not null,
  sent_at timestamptz not null default now(),
  seen_at timestamptz
);
create index if not exists gifts_sender_day on public.gifts (sender, sent_at desc);
create index if not exists gifts_recipient on public.gifts (recipient, sent_at desc);
alter table public.gifts enable row level security;
revoke all on public.gifts from public, anon, authenticated;
grant select on public.gifts to authenticated;
drop policy if exists "Riders see gifts they sent or got" on public.gifts;
create policy "Riders see gifts they sent or got" on public.gifts
  for select to authenticated using ((select auth.uid()) in (sender, recipient));

create or replace function private.gift_rules() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"per_day": 5, "friend_days": 2, "account_days": 7, "runs_needed": 20}'::jsonb
$$;

-- Finished runs the server re-rode for this rider (each one is in the FROST ledger once).
create or replace function private.verified_runs(p_user uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from private.frost_ledger where user_id = p_user and reason = 'run'
$$;

create or replace function private.accepts_gifts(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select accept from public.gift_settings where user_id = p_user), true)
$$;

create or replace function private.gifts_today(p_user uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.gifts
  where sender = p_user and sent_at >= (private.shop_day())::timestamp at time zone 'utc'
$$;

-- When two riders became friends (null if they aren't).
create or replace function private.friends_since(a uuid, b uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select coalesce(accepted_at, created_at) from public.friendships
  where status = 'accepted' and ((requester = a and addressee = b) or (requester = b and addressee = a))
  limit 1
$$;

-- Can I send gifts, and to which friends? (For the gift screen.)
create or replace function public.gift_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  rules jsonb := private.gift_rules();
  age_days integer;
  runs integer;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then
    return jsonb_build_object('status', 'no_gamertag');
  end if;
  select floor(extract(epoch from now() - created_at) / 86400)::integer into age_days from public.profiles where id = me;
  runs := private.verified_runs(me);
  return jsonb_build_object(
    'status', 'ok',
    'rules', rules,
    'account_days', age_days,
    'runs', runs,
    'sent_today', private.gifts_today(me),
    'gifts_left', greatest(0, (rules ->> 'per_day')::integer - private.gifts_today(me)),
    'can_send', age_days >= (rules ->> 'account_days')::integer and runs >= (rules ->> 'runs_needed')::integer,
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'gamertag', p.gamertag,
        'friends_days', floor(extract(epoch from now() - coalesce(f.accepted_at, f.created_at)) / 86400)::integer,
        'accepts', private.accepts_gifts(p.id)) order by p.gamertag)
      from public.friendships f
      join public.profiles p on p.id = case when f.requester = me then f.addressee else f.requester end
      where f.status = 'accepted' and me in (f.requester, f.addressee)
    ), '[]'::jsonb)
  );
end
$$;

-- Send a friend one of today's daily Shop items.
create or replace function public.send_gift(p_friend uuid, p_item text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  rules jsonb := private.gift_rules();
  it public.items;
  since timestamptz;
  bal integer;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then return jsonb_build_object('status', 'no_gamertag'); end if;
  if p_friend = me then return jsonb_build_object('status', 'not_friends'); end if;
  -- One gift at a time per sender, so the daily limit holds.
  insert into public.wallets (user_id) values (me) on conflict (user_id) do nothing;
  perform 1 from public.wallets where user_id = me for update;
  if (select created_at from public.profiles where id = me) > now() - make_interval(days => (rules ->> 'account_days')::integer) then
    return jsonb_build_object('status', 'account_too_new');
  end if;
  if private.verified_runs(me) < (rules ->> 'runs_needed')::integer then return jsonb_build_object('status', 'not_enough_runs'); end if;
  since := private.friends_since(me, p_friend);
  if since is null then return jsonb_build_object('status', 'not_friends'); end if;
  if since > now() - make_interval(days => (rules ->> 'friend_days')::integer) then return jsonb_build_object('status', 'friends_too_new'); end if;
  if not private.accepts_gifts(p_friend) then return jsonb_build_object('status', 'gifts_off'); end if;
  if private.gifts_today(me) >= (rules ->> 'per_day')::integer then return jsonb_build_object('status', 'daily_limit'); end if;
  select * into it from public.items where id = p_item and source = 'shop';
  if not found or not exists (select 1 from private.daily_items(private.shop_day()) d where d = p_item) then
    return jsonb_build_object('status', 'not_in_shop');
  end if;
  if exists (select 1 from public.inventory where user_id = p_friend and item_id = p_item) then return jsonb_build_object('status', 'already_owned'); end if;
  begin
    bal := private.add_frost(me, -it.price, 'gift_out', 'gift:' || it.id || ':' || p_friend);
  exception when others then
    if sqlerrm = 'not_enough_frost' then return jsonb_build_object('status', 'not_enough_frost'); end if;
    raise;
  end;
  insert into public.inventory (user_id, item_id, source, price_paid) values (p_friend, it.id, 'gift', 0);
  insert into public.gifts (sender, recipient, item_id, price) values (me, p_friend, it.id, it.price);
  return jsonb_build_object('status', 'ok', 'balance', bal, 'gifts_left', greatest(0, (rules ->> 'per_day')::integer - private.gifts_today(me)));
end
$$;

-- Gifts I've received (newest first), and how many I haven't seen yet.
create or replace function public.my_gifts() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'unseen', (select count(*) from public.gifts where recipient = (select auth.uid()) and seen_at is null),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'item', g.item_id, 'from', coalesce(p.gamertag, 'A former rider'),
        'sent_at', g.sent_at, 'seen', g.seen_at is not null) order by g.sent_at desc)
      from (select * from public.gifts where recipient = (select auth.uid()) order by sent_at desc limit 30) g
      left join public.profiles p on p.id = g.sender
    ), '[]'::jsonb))
$$;

create or replace function public.mark_gifts_seen() returns void
language sql security definer set search_path = '' as $$
  update public.gifts set seen_at = now() where recipient = (select auth.uid()) and seen_at is null
$$;

-- The opt-out (Settings): turn gifts from friends on or off.
create or replace function public.set_accept_gifts(p_accept boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then return null; end if;
  insert into public.gift_settings (user_id, accept, updated_at) values (me, coalesce(p_accept, true), now())
  on conflict (user_id) do update set accept = excluded.accept, updated_at = now();
  return coalesce(p_accept, true);
end
$$;

create or replace function public.my_gift_setting() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.accepts_gifts((select auth.uid()))
$$;

revoke all on function private.verified_runs(uuid) from public, anon, authenticated;
revoke all on function private.accepts_gifts(uuid) from public, anon, authenticated;
revoke all on function private.gifts_today(uuid) from public, anon, authenticated;
revoke all on function private.friends_since(uuid, uuid) from public, anon, authenticated;
revoke all on function public.gift_status() from public, anon;
grant execute on function public.gift_status() to authenticated;
revoke all on function public.send_gift(uuid, text) from public, anon;
grant execute on function public.send_gift(uuid, text) to authenticated;
revoke all on function public.my_gifts() from public, anon;
grant execute on function public.my_gifts() to authenticated;
revoke all on function public.mark_gifts_seen() from public, anon;
grant execute on function public.mark_gifts_seen() to authenticated;
revoke all on function public.set_accept_gifts(boolean) from public, anon;
grant execute on function public.set_accept_gifts(boolean) to authenticated;
revoke all on function public.my_gift_setting() from public, anon;
grant execute on function public.my_gift_setting() to authenticated;
