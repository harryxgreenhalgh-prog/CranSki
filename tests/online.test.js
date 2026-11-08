import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tagKey, tagProblem, cleanTag, tidyTag } from '../src/online/names.js';

test('gamertags: letters, spaces and dashes only', () => {
  assert.equal(tagProblem('Mad-Dog'), null);
  assert.equal(tagProblem('Søren Ås'), null);
  assert.equal(tagProblem('Bob1'), 'chars');
  assert.equal(tagProblem('Bob_'), 'chars');
  assert.equal(tagProblem('A--B'), 'chars');
  assert.equal(tagProblem('Ab'), 'length');
  assert.equal(tagProblem('A B'), 'length');
  assert.equal(tagProblem('x'.repeat(19)), 'length');
  assert.equal(cleanTag('  Big--Air  1 '), 'Big-Air');
  assert.equal(tidyTag('h@ck3r'), 'hckr');
});

test('gamertags: one rider per name ignoring case and symbols', () => {
  const k = tagKey('Mad-Dog');
  for (const v of ['mad dog', 'MADDOG', 'Mád-Dög', 'M-a-d D-o-g']) assert.equal(tagKey(v), k);
  assert.equal(tagKey('Straße'), 'strasse');
});

test('gamertags: offensive names are blocked without blocking innocent ones', () => {
  assert.equal(tagProblem('Big Ass'), 'blocked');
  assert.equal(tagProblem('CranSki Admin'), 'blocked');
  for (const ok of ['Cassie', 'Yamashita', 'Grape Ape', 'Hitchcock', 'Scunthorpe', 'Therapist']) assert.equal(tagProblem(ok), null, ok);
});

test('the client blocklist matches the database blocklist', () => {
  const js = readFileSync('src/online/names.js', 'utf8');
  const list = (name) => js.match(new RegExp(`const ${name} = '([a-z ]+)'`))[1].split(' ');
  const sqlFile = readdirSync('supabase/migrations').find((f) => f.endsWith('_profiles.sql'));
  const sql = readFileSync(join('supabase/migrations', sqlFile), 'utf8');
  const rows = [...sql.matchAll(/\('([a-z]+)', (true|false)\)/g)];
  assert.deepEqual(rows.filter((r) => r[2] === 'true').map((r) => r[1]).sort(), list('ANYWHERE').sort());
  assert.deepEqual(rows.filter((r) => r[2] === 'false').map((r) => r[1]).sort(), list('WHOLE').sort());
});

// The frontend may only ever hold the publishable key.
test('no secret or service_role key in frontend code', () => {
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|html|css|json)$/.test(f)) files.push(p);
    }
  };
  walk('src');
  files.push('index.html');
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    assert.ok(!/sb_secret_/.test(s), `${f} contains a secret key`);
    assert.ok(!/service_role/i.test(s), `${f} mentions service_role`);
    // Legacy JWT-style keys start with eyJ; none belong in the frontend.
    assert.ok(!/eyJhbGciOi[A-Za-z0-9_-]{20,}/.test(s), `${f} contains a JWT`);
  }
  const cfg = readFileSync('src/online/config.js', 'utf8');
  assert.match(cfg, /sb_publishable_/);
});

test('supabase/setup.sql is all the migrations joined, and up to date', async () => {
  const { combinedSql } = await import('../tools/build-sql.mjs');
  assert.equal(readFileSync('supabase/setup.sql', 'utf8'), combinedSql(), 'run `npm run build:sql` and commit supabase/setup.sql');
});
