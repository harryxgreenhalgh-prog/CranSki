// Phase 5's rule: FROST, XP, ratings and items are only ever changed by Edge
// Functions or database functions, never by the game directly. Check the SQL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const sql = readdirSync('supabase/migrations')
  .sort()
  .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
  .join('\n');

test('every public table has row level security on', () => {
  const tables = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
  assert.ok(tables.length > 10);
  for (const t of tables) assert.match(sql, new RegExp(`alter table (public\\.\\w+, )*public\\.${t}( |,|;)[^;]*enable row level security`), `public.${t} needs row level security`);
});

test('riders get no write access to FROST, XP, ratings, items or purchases', () => {
  const locked = ['wallets', 'season_pass', 'ratings', 'inventory', 'purchases', 'gifts', 'gift_settings', 'matches', 'leaderboard', 'items', 'pass_rewards', 'seasons', 'season_podiums', 'season_records'];
  for (const t of locked) {
    // Every grant on the table to anon/authenticated is select-only...
    for (const m of sql.matchAll(new RegExp(`grant ([^;]+) on ((?:public\\.\\w+, )*public\\.${t}(?:, public\\.\\w+)*) to ([^;]+);`, 'g'))) {
      if (/anon|authenticated/.test(m[3])) assert.equal(m[1].trim(), 'select', `public.${t}: riders may only read (${m[0]})`);
    }
    // ...and there's no insert/update/delete policy.
    assert.doesNotMatch(sql, new RegExp(`create policy [^;]+ on public\\.${t}\\s+for (insert|update|delete|all)`), `public.${t} must not have a write policy`);
  }
});

test('the functions that pay or spend can only be called where they should be', () => {
  // Paying for runs: only the Edge Function (service role).
  assert.match(sql, /grant execute on function public\.reward_run\(uuid, text, integer, text\) to service_role;/);
  assert.doesNotMatch(sql, /grant execute on function public\.reward_run[^;]+(anon|authenticated)/);
  assert.match(sql, /grant execute on function public\.ranked_record_run\(uuid, uuid, text, integer\) to service_role;/);
  // The private helpers are never callable by riders.
  for (const fn of ['add_frost', 'grant_pass', 'end_season']) assert.match(sql, new RegExp(`revoke all on function private\\.${fn}\\([^)]*\\) from public, anon, authenticated;`), fn);
  assert.match(sql, /revoke all on function public\.season_tick\(\) from public, anon, authenticated;/);
});
