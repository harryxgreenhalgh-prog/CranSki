import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { handle } from '../supabase/functions/delete-account/handler.js';

const req = (body, token = 'good') =>
  new Request('https://x.test/functions/v1/delete-account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

function fakeAuth() {
  const deleted = [];
  return { deleted, userFromToken: async (t) => (t === 'good' ? 'user-1' : null), deleteUser: async (uid) => deleted.push(uid) };
}

test('delete-account deletes only the signed-in rider, and only when confirmed', async () => {
  const a = fakeAuth();
  assert.equal((await handle(req({}), a)).status, 400);
  assert.equal((await handle(req({ confirm: 'DELETE' }, 'stranger'), a)).status, 401);
  assert.deepEqual(a.deleted, []);
  const ok = await handle(req({ confirm: 'DELETE', user: 'someone-else' }), a);
  assert.equal(ok.status, 200);
  assert.deepEqual(a.deleted, ['user-1']);
});

// Deleting the auth user must take every row about the rider with it.
test('every table that stores rider data is removed with the account', () => {
  const sql = readdirSync('supabase/migrations')
    .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
    .join('\n');
  const tables = [...sql.matchAll(/create table if not exists ([\w.]+) \(([\s\S]*?)\n\);/g)];
  assert.ok(tables.length >= 7);
  for (const [, name, body] of tables) {
    // No rider data: word lists, seasons and the item catalogue.
    if (['private.blocked_name_terms', 'public.seasons', 'public.item_sets', 'public.items', 'public.pass_rewards'].includes(name)) continue;
    // Tables that list players in an array are cleared by a delete trigger.
    if (name === 'public.matches') {
      assert.match(sql, /create trigger forget_matches after delete on public\.profiles/);
      continue;
    }
    assert.match(body, /on delete cascade/, `${name} must be deleted along with the account`);
  }
});
