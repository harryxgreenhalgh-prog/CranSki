import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHOP_ITEMS, SETS, PASS, PASS_ITEMS, PASS_REWARDS, ALL_ITEMS, KINDS, priceOf, passLevel, nextReward, setGroupFor, wear, itemById } from '../src/economy/catalog.js';
import { DEFAULT_LOOK } from '../src/render/riderModel.js';
import { catalogSql, CATALOG_FILE } from '../tools/build-catalog.mjs';

test('Shop prices follow the price table', () => {
  const table = { jacket: [800, 1000, 1200], pants: [600, 800, 1000], skis: [600, 800, 1000], snowboard: [600, 800, 1000], helmet: [600, 800, 1000], bindings: [200, 400, 600], poles: [200, 400, 600], gloves: [200, 400, 600], boots: [200, 400, 600], goggles: [200, 400, 600] };
  for (const [kind, prices] of Object.entries(table)) assert.deepEqual(KINDS[kind].prices, prices, kind);
  for (const it of SHOP_ITEMS) assert.equal(it.price, priceOf(it.kind, it.rarity), it.id);
  for (const s of SETS) assert.ok(s.price >= 1200 && s.price <= 1600, `${s.id} is about 1,400`);
});

test('every item has a unique id and name, and only sets look values the rider has', () => {
  const ids = new Set();
  const names = new Set();
  const allowed = new Set([...Object.keys(DEFAULT_LOOK), 'helmetFinish']);
  for (const it of ALL_ITEMS) {
    assert.ok(!ids.has(it.id), `duplicate id ${it.id}`);
    assert.ok(!names.has(it.name), `duplicate name ${it.name}`);
    ids.add(it.id);
    names.add(it.name);
    for (const k of Object.keys(it.look)) assert.ok(allowed.has(k), `${it.id} sets unknown look key ${k}`);
    assert.ok(Object.keys(it.look).length > 0, it.id);
  }
  // Wearing an item records which item dresses the slot.
  const look = wear(DEFAULT_LOOK, itemById('chrome-comet'));
  assert.equal(look.helmet, 'item');
  assert.equal(look.helmetFinish, 'metal');
  assert.equal(look.items.head, 'chrome-comet');
});

test('Season Pass: 100 levels of 500 XP; premium pays back exactly its 1,500 FROST', () => {
  assert.equal(PASS.levels, 100);
  assert.equal(PASS.xpPerLevel, 500);
  const premiumFrost = PASS_REWARDS.filter((r) => r.track === 'premium' && r.frost).reduce((a, r) => a + r.frost, 0);
  assert.equal(premiumFrost, PASS.premiumPrice);
  assert.equal(PASS_REWARDS.filter((r) => r.track === 'premium').length, 100);
  for (const r of PASS_REWARDS) {
    assert.ok(r.level >= 1 && r.level <= 100);
    if (r.item) assert.ok(itemById(r.item), r.item);
    else assert.equal(r.frost, PASS.frostTile);
  }
  assert.equal(PASS_ITEMS.length, PASS_REWARDS.filter((r) => r.item).length);
  assert.deepEqual(passLevel(0), { level: 0, into: 0, need: 500 });
  assert.deepEqual(passLevel(1234), { level: 2, into: 234, need: 500 });
  assert.equal(passLevel(999999).level, 100);
  assert.equal(nextReward(0, 'free').level, 2);
  assert.equal(nextReward(100, 'premium'), null);
});

test('limited-time sets take turns by season', () => {
  assert.deepEqual([1, 2, 3, 4].map(setGroupFor), [1, 2, 1, 2]);
  for (const g of [1, 2]) assert.ok(SETS.filter((s) => s.group === g).length >= 1);
});

test('the database catalogue is generated from this one and up to date', () => {
  assert.equal(readFileSync(CATALOG_FILE, 'utf8'), catalogSql(), 'run `npm run build:catalog` (or build:sql)');
});
