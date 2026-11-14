-- CranSki · Phase 5 · Step 6: the Item Shop.
--
-- Everything is priced in FROST, which is earned only by riding: there is
-- nothing to buy with real money anywhere. The daily section shows 6 Shop
-- items, a different 6 every UTC day (the database picks them, so every
-- player sees the same ones). Limited-time themed sets are on sale for one
-- season at a time, their groups taking turns. Anything bought can be
-- returned within 24 hours for a full refund, up to 3 returns per account.
--
-- Buying and returning only happen through these functions, which check the
-- day's stock, take or refund the FROST and change what you own in one go.

create table if not exists public.purchases (
  id bigserial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('item', 'set')),
  ref text not null, -- item id or set id
  price integer not null check (price > 0),
  bought_at timestamptz not null default now(),
  returned_at timestamptz
);
create index if not exists purchases_user on public.purchases (user_id, bought_at desc);
alter table public.purchases enable row level security;
revoke all on public.purchases from public, anon, authenticated;
grant select on public.purchases to authenticated;
drop policy if exists "Riders see their own purchases" on public.purchases;
create policy "Riders see their own purchases" on public.purchases
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function private.shop_rules() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"daily_count": 6, "return_hours": 24, "max_returns": 3}'::jsonb
$$;

create or replace function private.shop_day() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'utc')::date
$$;

-- Today's daily section (stable for the whole UTC day).
create or replace function private.daily_items(p_day date) returns setof text
language sql stable security definer set search_path = '' as $$
  select id from public.items where source = 'shop'
  order by md5(p_day::text || ':' || id) limit 6
$$;

-- Sets on sale this season.
create or replace function private.sets_on_sale() returns setof text
language sql security definer set search_path = '' as $$
  select s.id from public.item_sets s
  where s.set_group = ((greatest(1, (select (private.current_season()).id)) - 1) % 2) + 1
  order by s.id
$$;

-- What's in the Shop right now (anyone can look).
create or replace function public.shop_today() returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'day', private.shop_day(),
    'ends_at', (private.shop_day() + 1)::timestamp at time zone 'utc',
    'daily', (select coalesce(jsonb_agg(d), '[]'::jsonb) from private.daily_items(private.shop_day()) d),
    'sets', (select coalesce(jsonb_agg(s), '[]'::jsonb) from private.sets_on_sale() s),
    'season_ends_at', (select (private.current_season()).ends_at)
  )
$$;

create or replace function private.returns_used(p_user uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.purchases where user_id = p_user and returned_at is not null
$$;

-- Buy one item from today's daily section.
create or replace function public.buy_item(p_item text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  it public.items;
  bal integer;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then return jsonb_build_object('status', 'no_gamertag'); end if;
  select * into it from public.items where id = p_item and source = 'shop';
  if not found or not exists (select 1 from private.daily_items(private.shop_day()) d where d = p_item) then
    return jsonb_build_object('status', 'not_in_shop');
  end if;
  if exists (select 1 from public.inventory where user_id = me and item_id = p_item) then return jsonb_build_object('status', 'owned'); end if;
  begin
    bal := private.add_frost(me, -it.price, 'shop', 'item:' || it.id);
  exception when others then
    if sqlerrm = 'not_enough_frost' then return jsonb_build_object('status', 'not_enough_frost'); end if;
    raise;
  end;
  insert into public.inventory (user_id, item_id, source, price_paid) values (me, it.id, 'shop', it.price);
  insert into public.purchases (user_id, kind, ref, price) values (me, 'item', it.id, it.price);
  return jsonb_build_object('status', 'ok', 'balance', bal);
end
$$;

-- Buy a whole themed set (only while it's on sale).
create or replace function public.buy_set(p_set text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  s public.item_sets;
  bal integer;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then return jsonb_build_object('status', 'no_gamertag'); end if;
  select * into s from public.item_sets where id = p_set;
  if not found or not exists (select 1 from private.sets_on_sale() x where x = p_set) then return jsonb_build_object('status', 'not_in_shop'); end if;
  if not exists (select 1 from public.items i where i.set_id = p_set and not exists (select 1 from public.inventory v where v.user_id = me and v.item_id = i.id)) then
    return jsonb_build_object('status', 'owned');
  end if;
  begin
    bal := private.add_frost(me, -s.price, 'shop', 'set:' || s.id);
  exception when others then
    if sqlerrm = 'not_enough_frost' then return jsonb_build_object('status', 'not_enough_frost'); end if;
    raise;
  end;
  insert into public.inventory (user_id, item_id, source, price_paid)
  select me, i.id, 'set', 0 from public.items i where i.set_id = p_set
  on conflict do nothing;
  insert into public.purchases (user_id, kind, ref, price) values (me, 'set', s.id, s.price);
  return jsonb_build_object('status', 'ok', 'balance', bal);
end
$$;

-- Return something bought in the last 24 hours, for all its FROST back (3 returns per account).
create or replace function public.return_purchase(p_purchase bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  pu public.purchases;
  rules jsonb := private.shop_rules();
  bal integer;
begin
  select * into pu from public.purchases where id = p_purchase and user_id = me for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if pu.returned_at is not null then return jsonb_build_object('status', 'already_returned'); end if;
  if pu.bought_at < now() - make_interval(hours => (rules ->> 'return_hours')::integer) then return jsonb_build_object('status', 'too_late'); end if;
  if private.returns_used(me) >= (rules ->> 'max_returns')::integer then return jsonb_build_object('status', 'no_returns_left'); end if;
  -- Take back exactly what this purchase gave (a gift sent on to someone else can't be returned).
  if pu.kind = 'item' then
    if not exists (select 1 from public.inventory where user_id = me and item_id = pu.ref and source = 'shop') then
      return jsonb_build_object('status', 'not_owned');
    end if;
    delete from public.inventory where user_id = me and item_id = pu.ref and source = 'shop';
  else
    delete from public.inventory v using public.items i where v.user_id = me and v.item_id = i.id and i.set_id = pu.ref and v.source = 'set';
  end if;
  update public.purchases set returned_at = now() where id = pu.id;
  bal := private.add_frost(me, pu.price, 'return', pu.kind || ':' || pu.ref);
  return jsonb_build_object('status', 'ok', 'balance', bal, 'returns_left', (rules ->> 'max_returns')::integer - private.returns_used(me));
end
$$;

-- My recent purchases, with whether each can still be returned.
create or replace function public.my_purchases() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'returns_left', greatest(0, (private.shop_rules() ->> 'max_returns')::integer - private.returns_used((select auth.uid()))),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'ref', p.ref, 'price', p.price, 'bought_at', p.bought_at,
        'returned_at', p.returned_at,
        'returnable_until', case when p.returned_at is null then p.bought_at + interval '24 hours' end) order by p.bought_at desc)
      from (select * from public.purchases where user_id = (select auth.uid()) and bought_at > now() - interval '7 days' order by bought_at desc limit 30) p
    ), '[]'::jsonb)
  )
$$;

revoke all on function private.daily_items(date) from public, anon, authenticated;
revoke all on function private.sets_on_sale() from public, anon, authenticated;
revoke all on function private.returns_used(uuid) from public, anon, authenticated;
revoke all on function public.shop_today() from public;
grant execute on function public.shop_today() to anon, authenticated;
revoke all on function public.buy_item(text) from public, anon;
grant execute on function public.buy_item(text) to authenticated;
revoke all on function public.buy_set(text) from public, anon;
grant execute on function public.buy_set(text) to authenticated;
revoke all on function public.return_purchase(bigint) from public, anon;
grant execute on function public.return_purchase(bigint) to authenticated;
revoke all on function public.my_purchases() from public, anon;
grant execute on function public.my_purchases() to authenticated;
