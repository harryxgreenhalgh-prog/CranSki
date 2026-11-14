// Every model the game ships is listed, with its licence, on the Credits page
// and in public/models/CREDITS.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

test('every model file is credited on the Credits page and in CREDITS.md', () => {
  const models = readdirSync('public/models').filter((f) => f.endsWith('.glb'));
  assert.ok(models.length >= 8);
  const page = readFileSync('src/ui/pages.js', 'utf8');
  const md = readFileSync('public/models/CREDITS.md', 'utf8');
  for (const f of models) {
    assert.ok(page.includes(f), `${f} is missing from the Credits page`);
    assert.ok(md.includes(f), `${f} is missing from public/models/CREDITS.md`);
  }
  // Only these two kinds of licence are used for models.
  assert.match(md, /Made for CranSki/);
  assert.match(md, /Creative Commons Attribution 4\.0/);
});
