-- CranSki · Phase 4 · Step 1: live rooms over Supabase Realtime.
--
-- Riders use private Realtime channels:
--   'lobby'                      who is in which room (presence), for picking a
--                                room and the rider counts on the park map;
--   'room:<park>:<number>'       positions, poses and tricks (broadcast) and the
--                                room's roster (presence).
-- Only signed-in riders with a gamertag may join, listen or send. Nothing sent
-- over these channels is stored.
--
-- Supabase already has Row Level Security switched on for realtime.messages;
-- these policies decide who may use which topics. Party rooms
-- ('room:<park>:p<party>') are opened up to party members in step 5.

drop policy if exists "cranski: riders listen in the lobby and rooms" on realtime.messages;
create policy "cranski: riders listen in the lobby and rooms" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and (
      (select realtime.topic()) = 'lobby'
      or ((select realtime.topic()) ~ '^room:[a-z]+:[0-9]+$')
    )
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()))
  );

drop policy if exists "cranski: riders send in the lobby and rooms" on realtime.messages;
create policy "cranski: riders send in the lobby and rooms" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and (
      (select realtime.topic()) = 'lobby'
      or ((select realtime.topic()) ~ '^room:[a-z]+:[0-9]+$')
    )
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()))
  );
