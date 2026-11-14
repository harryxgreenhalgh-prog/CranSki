-- CranSki · Phase 5 · Step 3: private party matches and the CRANSKI CUP.
--
-- A party's riders run their private 2v2 / free-for-all matches and the
-- CRANSKI CUP over the party's own Realtime channel 'pmatch:<party id>':
-- who's in, GO, each finished run's recorded inputs (which every rider re-rides
-- to check the score) and the turn-by-turn pose of whoever is riding. The
-- result isn't stored and changes no rating, so there are no new tables.
--
-- This only widens the party channel check so that 'pmatch:<id>' is, like
-- 'party:<id>', open to that party's members and nobody else.
create or replace function public.in_party_topic(t text, include_chat boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.party_members m
    where m.user_id = (select auth.uid())
      and m.party_id::text = coalesce(
        substring(t from '^party:([0-9a-f-]{36})$'),
        substring(t from '^pmatch:([0-9a-f-]{36})$'),
        case when include_chat then substring(t from '^pchat:([0-9a-f-]{36})$') end,
        substring(t from '^room:[a-z]+:p([0-9a-f-]{36})$')
      )
  )
$$;
revoke all on function public.in_party_topic(text, boolean) from public, anon;
grant execute on function public.in_party_topic(text, boolean) to authenticated;
