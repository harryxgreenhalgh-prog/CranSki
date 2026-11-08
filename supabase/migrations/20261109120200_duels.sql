-- CranSki · Phase 4 · Step 4: friendly 1v1 duels.
--
-- The two riders talk over a private Realtime channel 'duel:<random id>'
-- (whose turn it is, the 3-2-1, the live pose of whoever is riding, and each
-- finished run's recorded inputs, which the other rider re-rides to check the
-- score). Only signed-in riders with a gamertag can use duel channels, and the
-- id is random and only shared between the two riders. Nothing is stored.

drop policy if exists "cranski: riders listen in duels" on realtime.messages;
create policy "cranski: riders listen in duels" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select realtime.topic()) ~ '^duel:[0-9a-f-]{36}$'
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()))
  );

drop policy if exists "cranski: riders send in duels" on realtime.messages;
create policy "cranski: riders send in duels" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select realtime.topic()) ~ '^duel:[0-9a-f-]{36}$'
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()))
  );
