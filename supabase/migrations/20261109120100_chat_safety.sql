-- CranSki · Phase 4 · Step 3: chat, with the Safety rules from DESIGN.md.
--
-- Chat messages are never stored. Riders can't send on chat channels at all:
-- every message goes through the chat Edge Function, which filters it, signs it
-- and broadcasts it to the room over Realtime. The database only keeps:
--   - each rider's strike count and mute time (no message text);
--   - reports, with the last 10 minutes of that room's messages, for
--     moderators (read them in the dashboard's Table Editor -> reports).

-- ------------------------------------------------------------------ strikes and mutes
create table if not exists private.chat_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  strikes integer not null default 0,
  strikes_at timestamptz,
  muted_until timestamptz,
  window_start timestamptz,
  window_count integer not null default 0
);

-- Before sending: muted? sending too fast (more than 5 messages in 8 seconds)?
create or replace function public.chat_gate(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  st private.chat_state;
begin
  insert into private.chat_state (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into st from private.chat_state where user_id = p_user for update;
  if st.muted_until is not null and st.muted_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'muted', 'until', st.muted_until);
  end if;
  if st.window_start is null or st.window_start < now() - interval '8 seconds' then
    update private.chat_state set window_start = now(), window_count = 1 where user_id = p_user;
  else
    if st.window_count >= 5 then
      return jsonb_build_object('ok', false, 'reason', 'slow');
    end if;
    update private.chat_state set window_count = window_count + 1 where user_id = p_user;
  end if;
  return jsonb_build_object('ok', true);
end
$$;

-- A filtered message adds a strike (a hate word adds 2). 3 strikes within 15
-- minutes mutes that rider's chat for 15 minutes.
create or replace function public.chat_strike(p_user uuid, p_weight integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  st private.chat_state;
begin
  insert into private.chat_state (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into st from private.chat_state where user_id = p_user for update;
  if st.strikes_at is null or st.strikes_at < now() - interval '15 minutes' then
    st.strikes := 0;
  end if;
  st.strikes := st.strikes + greatest(0, least(p_weight, 3));
  st.strikes_at := now();
  if st.strikes >= 3 then
    st.muted_until := now() + interval '15 minutes';
    st.strikes := 0;
  end if;
  update private.chat_state set strikes = st.strikes, strikes_at = st.strikes_at, muted_until = st.muted_until where user_id = p_user;
  return jsonb_build_object('muted_until', case when st.muted_until > now() then st.muted_until end);
end
$$;

-- So the game can show "you can chat again in N minutes".
create or replace function public.my_chat_mute() returns timestamptz
language sql stable security definer set search_path = '' as $$
  select muted_until from private.chat_state
  where user_id = (select auth.uid()) and muted_until > now()
$$;

-- ------------------------------------------------------------------ reports
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  reporter uuid not null references auth.users (id) on delete cascade,
  reported uuid not null references auth.users (id) on delete cascade,
  topic text not null,
  reason text not null check (reason in ('hate', 'bullying', 'sexual', 'spam', 'name', 'cheating', 'other')),
  note text,
  messages jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at timestamptz not null default now()
);
create index if not exists reports_open on public.reports (status, created_at);

-- Only moderators (the dashboard) can read reports; riders can't read or write
-- them directly.
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;

-- Called by the chat Edge Function with the messages it has verified.
-- At most 10 reports an hour per rider.
create or replace function public.submit_report(
  p_reporter uuid, p_reported uuid, p_topic text, p_reason text, p_note text, p_messages jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.reports where reporter = p_reporter and created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'slow_down');
  end if;
  insert into public.reports (reporter, reported, topic, reason, note, messages)
  values (p_reporter, p_reported, p_topic, p_reason, nullif(p_note, ''), coalesce(p_messages, '[]'::jsonb));
  return jsonb_build_object('ok', true);
end
$$;

revoke all on function public.chat_gate(uuid) from public, anon, authenticated;
revoke all on function public.chat_strike(uuid, integer) from public, anon, authenticated;
revoke all on function public.submit_report(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.chat_gate(uuid) to service_role;
grant execute on function public.chat_strike(uuid, integer) to service_role;
grant execute on function public.submit_report(uuid, uuid, text, text, text, jsonb) to service_role;
revoke all on function public.my_chat_mute() from public, anon;
grant execute on function public.my_chat_mute() to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

-- ------------------------------------------------------------------ chat channels
-- Riders in rooms may LISTEN on 'chat:<park>:<room>'. There is deliberately no
-- insert policy: only the chat Edge Function (secret key) can send there.
drop policy if exists "cranski: riders listen to room chat" on realtime.messages;
create policy "cranski: riders listen to room chat" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) ~ '^chat:[a-z]+:[0-9]+$'
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()))
  );
