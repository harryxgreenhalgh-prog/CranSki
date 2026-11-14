-- CranSki · Phase 5 · Step 4: FROST, earned only by riding.
--
-- FROST is the only currency and there are no real-money purchases anywhere.
-- A finished run earns 10 FROST plus 1 per 10,000 points, at most 100 a day
-- (UTC). Only the submit-run Edge Function pays it, after it has re-ridden the
-- run from its inputs, and only once per run.
--
-- Riders can read their own balance and nothing else. Every change goes
-- through private.add_frost(), called only by database functions that the
-- Edge Functions (secret key) or the game's own checked actions call, and is
-- written to a private ledger.

create table if not exists public.wallets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  frost integer not null default 0 check (frost >= 0),
  updated_at timestamptz not null default now()
);
alter table public.wallets enable row level security;
revoke all on public.wallets from public, anon, authenticated;
grant select on public.wallets to authenticated;
drop policy if exists "Riders see their own wallet" on public.wallets;
create policy "Riders see their own wallet" on public.wallets
  for select to authenticated using (user_id = (select auth.uid()));

create table if not exists private.frost_ledger (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default ((now() at time zone 'utc')::date),
  delta integer not null,
  reason text not null, -- run | pass | shop | return | gift_in | gift_out | prize
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists frost_ledger_user on private.frost_ledger (user_id, created_at desc);
create index if not exists frost_ledger_day on private.frost_ledger (user_id, day) where reason = 'run';
-- A run pays out once, however often it's sent.
create unique index if not exists frost_ledger_run_once on private.frost_ledger (user_id, ref) where reason = 'run';

-- Rules in one place (also read by the game for its help text).
create or replace function private.frost_rules() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"per_run": 10, "per_points": 10000, "daily_cap": 100}'::jsonb
$$;

-- Add (or take, with a negative delta) FROST. Locks the wallet row so two
-- changes at once can't both spend the same FROST. Raises 'not_enough_frost'.
create or replace function private.add_frost(p_user uuid, p_delta integer, p_reason text, p_ref text default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  bal integer;
begin
  insert into public.wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  select frost into bal from public.wallets where user_id = p_user for update;
  if bal + p_delta < 0 then raise exception 'not_enough_frost'; end if;
  insert into private.frost_ledger (user_id, delta, reason, ref) values (p_user, p_delta, p_reason, p_ref);
  update public.wallets set frost = frost + p_delta, updated_at = now() where user_id = p_user returning frost into bal;
  return bal;
end
$$;

-- FROST earned from runs today (UTC).
create or replace function private.run_frost_today(p_user uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(delta), 0)::integer from private.frost_ledger
  where user_id = p_user and reason = 'run' and day = (now() at time zone 'utc')::date
$$;

-- Called by the submit-run Edge Function (secret key) once it has re-ridden a
-- finished run. p_run_key identifies the run (a hash of its inputs), so the
-- same run never pays twice. Returns what was paid and the new balance.
-- (Phase 5 step 5 adds Season Pass XP here.)
create or replace function public.reward_run(p_user uuid, p_park text, p_total integer, p_run_key text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  rules jsonb := private.frost_rules();
  today integer;
  give integer;
  bal integer;
begin
  if p_run_key is null or length(p_run_key) < 16 then raise exception 'bad_run_key'; end if;
  insert into public.wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  -- One reward at a time per rider, so the daily cap holds.
  perform 1 from public.wallets where user_id = p_user for update;
  if exists (select 1 from private.frost_ledger where user_id = p_user and reason = 'run' and ref = p_run_key) then
    return jsonb_build_object('frost', jsonb_build_object('awarded', 0, 'duplicate', true,
      'balance', (select frost from public.wallets where user_id = p_user),
      'today', private.run_frost_today(p_user), 'cap', rules -> 'daily_cap'));
  end if;
  today := private.run_frost_today(p_user);
  give := least((rules ->> 'per_run')::integer + greatest(0, p_total) / (rules ->> 'per_points')::integer,
                greatest(0, (rules ->> 'daily_cap')::integer - today));
  -- Recorded even when the cap is reached (as 0), so the run still counts once.
  bal := private.add_frost(p_user, give, 'run', p_run_key);
  return jsonb_build_object('frost', jsonb_build_object('awarded', give, 'duplicate', false,
    'balance', bal, 'today', today + give, 'cap', rules -> 'daily_cap'));
end
$$;

-- My balance, today's run FROST, and my last few changes.
create or replace function public.my_wallet() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'frost', coalesce((select frost from public.wallets where user_id = (select auth.uid())), 0),
    'today', private.run_frost_today((select auth.uid())),
    'cap', private.frost_rules() -> 'daily_cap',
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('delta', l.delta, 'reason', l.reason, 'at', l.created_at) order by l.created_at desc)
      from (select * from private.frost_ledger where user_id = (select auth.uid()) and delta <> 0 order by created_at desc limit 10) l
    ), '[]'::jsonb)
  )
$$;

revoke all on function private.add_frost(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function private.run_frost_today(uuid) from public, anon, authenticated;
revoke all on function public.reward_run(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.reward_run(uuid, text, integer, text) to service_role;
revoke all on function public.my_wallet() from public, anon;
grant execute on function public.my_wallet() to authenticated;
