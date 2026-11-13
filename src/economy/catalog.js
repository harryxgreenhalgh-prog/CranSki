// Everything you can own (DESIGN.md, Progression and economy): Item Shop items,
// limited-time themed sets and Season Pass rewards, plus the Pass's rules.
//
// This file is the single source: the game reads it to draw and name items,
// and `npm run build:catalog` writes the matching SQL (item ids, prices, pass
// rewards) that the database uses to decide what you own. Items are looks only:
// each is a named set of rider-look values, so other riders' games can draw
// them without knowing the catalogue. Names and designs are CranSki's own.

export const RARITIES = ['rare', 'epic', 'legendary'];

// Item types, which Locker slot they dress, and their Shop price by rarity.
export const KINDS = {
  jacket: { slot: 'top', label: 'Jacket', prices: [800, 1000, 1200] },
  pants: { slot: 'pants', label: 'Pants', prices: [600, 800, 1000] },
  skis: { slot: 'ride', label: 'Skis', prices: [600, 800, 1000] },
  snowboard: { slot: 'ride', label: 'Snowboard', prices: [600, 800, 1000] },
  helmet: { slot: 'head', label: 'Helmet', prices: [600, 800, 1000] },
  beanie: { slot: 'head', label: 'Beanie', prices: [200, 400, 600] },
  bindings: { slot: 'gear', label: 'Bindings', prices: [200, 400, 600] },
  boots: { slot: 'gear', label: 'Boots', prices: [200, 400, 600] },
  poles: { slot: 'poles', label: 'Poles', prices: [200, 400, 600] },
  gloves: { slot: 'gloves', label: 'Gloves', prices: [200, 400, 600] },
  goggles: { slot: 'goggles', label: 'Goggles', prices: [200, 400, 600] },
};

export const priceOf = (kind, rarity) => KINDS[kind].prices[RARITIES.indexOf(rarity)];

// The look values an item sets.
function lookFor(kind, a) {
  switch (kind) {
    case 'jacket':
      return { top: a.style || 'shell', topColor: a.color, trimColor: a.trim ?? a.color };
    case 'pants':
      return { pants: a.color };
    case 'skis':
      return { ride: 'skis', skiColor: a.color };
    case 'snowboard':
      return { ride: 'board', boardColor: a.color };
    case 'helmet':
      return { head: 'helmet', helmet: 'item', helmetFinish: a.finish || 'gloss', helmetColor: a.color };
    case 'beanie':
      return { head: 'beanie', beanieItem: a.style || 'knit', beanieColor: a.color };
    case 'bindings':
      return { bindings: a.color };
    case 'boots':
      return { boots: a.color };
    case 'poles':
      return { poles: a.color };
    case 'gloves':
      return { gloves: a.color };
    case 'goggles':
      return { lens: a.color };
  }
  return {};
}

const item = (id, name, kind, rarity, look, extra = {}) => ({ id, name, kind, rarity, slot: KINDS[kind].slot, look: lookFor(kind, look), ...extra });

// ---------------------------------------------------------------- Item Shop
// The daily section picks from these, a different few each UTC day.
export const SHOP_ITEMS = [
  item('glacier-shell', 'Glacier Shell', 'jacket', 'rare', { color: 0x7fd3f0, trim: 0x2a5c7a }),
  item('campfire-hoodie', 'Campfire Hoodie', 'jacket', 'rare', { style: 'hoodie', color: 0xd2552b, trim: 0x3a2418 }),
  item('northern-lights-shell', 'Northern Lights Shell', 'jacket', 'epic', { color: 0x2bd38f, trim: 0x6a3bd8 }),
  item('static-pop-hoodie', 'Static Pop Hoodie', 'jacket', 'epic', { style: 'hoodie', color: 0xff3ea5, trim: 0x1fd6ff }),
  item('molten-core-shell', 'Molten Core Shell', 'jacket', 'legendary', { color: 0x1a1a1a, trim: 0xff5a00 }),
  item('whiteout-parka', 'Whiteout Parka', 'jacket', 'legendary', { color: 0xf6f8fb, trim: 0xbfc6cf }),
  item('slate-cargo', 'Slate Cargo Pants', 'pants', 'rare', { color: 0x5b6470 }),
  item('moss-baggies', 'Moss Baggies', 'pants', 'rare', { color: 0x4f6b3a }),
  item('signal-red-baggies', 'Signal Red Baggies', 'pants', 'epic', { color: 0xd8322a }),
  item('midnight-velvet', 'Midnight Velvet Pants', 'pants', 'legendary', { color: 0x1b1f4a }),
  item('pine-twins', 'Pine Twins', 'skis', 'rare', { color: 0x3f7d4a }),
  item('neon-drift-twins', 'Neon Drift Twins', 'skis', 'epic', { color: 0xc6ff3a }),
  item('comet-twins', 'Comet Twins', 'skis', 'legendary', { color: 0xf2c14e }),
  item('driftwood-deck', 'Driftwood Deck', 'snowboard', 'rare', { color: 0xa77b4f }),
  item('prism-deck', 'Prism Deck', 'snowboard', 'epic', { color: 0x8e5bff }),
  item('solar-flare-deck', 'Solar Flare Deck', 'snowboard', 'legendary', { color: 0xff8c1a }),
  item('chalk-lid', 'Chalk Lid', 'helmet', 'rare', { finish: 'matte', color: 0xe8e4da }),
  item('lagoon-gloss', 'Lagoon Gloss Helmet', 'helmet', 'epic', { finish: 'gloss', color: 0x1fb5a6 }),
  item('chrome-comet', 'Chrome Comet Helmet', 'helmet', 'legendary', { finish: 'metal', color: 0xb8c4d0 }),
  item('lime-straps', 'Lime Straps', 'bindings', 'rare', { color: 0x9be03a }),
  item('coral-straps', 'Coral Straps', 'bindings', 'epic', { color: 0xff6f61 }),
  item('sand-boots', 'Sand Boots', 'boots', 'rare', { color: 0xc9b28a }),
  item('ruby-boots', 'Ruby Boots', 'boots', 'legendary', { color: 0xa3122c }),
  item('birch-poles', 'Birch Poles', 'poles', 'rare', { color: 0xe4d9c2 }),
  item('laser-poles', 'Laser Poles', 'poles', 'epic', { color: 0x2fffd0 }),
  item('mustard-mitts', 'Mustard Mitts', 'gloves', 'rare', { color: 0xd9a52b }),
  item('ice-crystal-mitts', 'Ice Crystal Mitts', 'gloves', 'legendary', { color: 0xbfe9ff }),
  item('rose-lens', 'Rose Lens', 'goggles', 'rare', { color: 0xff8fb0 }),
  item('emerald-lens', 'Emerald Lens', 'goggles', 'epic', { color: 0x1fdc6a }),
  item('mirror-gold-lens', 'Mirror Gold Lens', 'goggles', 'legendary', { color: 0xe8b923 }),
].map((it) => ({ ...it, source: 'shop', price: priceOf(it.kind, it.rarity) }));

export const DAILY_COUNT = 6; // items in the daily section

// ---------------------------------------------------------------- themed sets
// Sold whole, for a limited time: each season has its group, and the groups take turns.
const setItems = (setId, list) => list.map((it) => ({ ...it, source: 'set', set: setId }));
export const SETS = [
  {
    id: 'pumpkin-patch',
    name: 'Pumpkin Patch',
    group: 1,
    price: 1400,
    blurb: 'A spooky-season set: glowing orange, midnight black and a dash of purple.',
    items: setItems('pumpkin-patch', [
      item('pumpkin-patch-hoodie', 'Pumpkin Patch Hoodie', 'jacket', 'epic', { style: 'hoodie', color: 0xff7518, trim: 0x1a1a1a }),
      item('pumpkin-patch-pants', 'Pumpkin Patch Pants', 'pants', 'epic', { color: 0x2b2b2b }),
      item('jack-o-lid', "Jack-o'-Lid", 'helmet', 'epic', { finish: 'gloss', color: 0xff7518 }),
      item('spooky-mitts', 'Spooky Mitts', 'gloves', 'epic', { color: 0x6a2c91 }),
    ]),
  },
  {
    id: 'park-baggy',
    name: 'Park Baggy',
    group: 1,
    price: 1400,
    blurb: 'Oversized tee, wide-leg pants, a bright beanie and white twins.',
    items: setItems('park-baggy', [
      item('baggy-tee', 'Baggy Tee', 'jacket', 'epic', { style: 'tee', color: 0xf4f7fb, trim: 0x2a2f38 }),
      item('baggy-wide-legs', 'Baggy Wide-Legs', 'pants', 'epic', { color: 0x6b7a8f }),
      item('baggy-beanie', 'Baggy Beanie', 'beanie', 'epic', { color: 0xffd23f }),
      item('jib-twins', 'Jib Twins', 'skis', 'epic', { color: 0xf4f7fb }),
    ]),
  },
  {
    id: 'aurora-night',
    name: 'Aurora Night',
    group: 2,
    price: 1400,
    blurb: 'Deep navy with northern-lights green and violet.',
    items: setItems('aurora-night', [
      item('aurora-shell', 'Aurora Shell', 'jacket', 'legendary', { color: 0x0b1d3a, trim: 0x2bd38f }),
      item('aurora-pants', 'Aurora Pants', 'pants', 'epic', { color: 0x0b1d3a }),
      item('aurora-lens', 'Aurora Lens', 'goggles', 'epic', { color: 0x2bd38f }),
      item('aurora-deck', 'Aurora Deck', 'snowboard', 'epic', { color: 0x6a3bd8 }),
    ]),
  },
  {
    id: 'spring-slush',
    name: 'Spring Slush',
    group: 2,
    price: 1400,
    blurb: 'Sunny spring-park pastels.',
    items: setItems('spring-slush', [
      item('slush-long-sleeve', 'Slush Long Sleeve', 'jacket', 'epic', { style: 'longsleeve', color: 0xffd1dc, trim: 0x7fd3f0 }),
      item('slush-pants', 'Slush Pants', 'pants', 'epic', { color: 0xa8e6cf }),
      item('slush-mitts', 'Slush Mitts', 'gloves', 'epic', { color: 0xffe066 }),
      item('slush-poles', 'Slush Poles', 'poles', 'epic', { color: 0xff8fb0 }),
    ]),
  },
];
export const SET_GROUPS = 2;
// Which group of sets is on sale in a season (1, 2, 1, 2, ...).
export const setGroupFor = (seasonId) => ((Math.max(1, seasonId) - 1) % SET_GROUPS) + 1;

// ---------------------------------------------------------------- Season Pass
export const PASS = {
  levels: 100,
  xpPerLevel: 500,
  xpPerRun: 25,
  pointsPerXp: 3000, // +1 XP per 3,000 points
  fullLevelsPerDay: 3, // full XP for 1,500 XP a day; missed days roll over
  reducedDivisor: 5, // past that, runs give 1/5 XP
  premiumPrice: 1500,
  frostTile: 25,
};

// Pass-only items: original colourways across every item type.
const PASS_NAMES = ['Aspen', 'Basalt', 'Cinder', 'Drift', 'Ember', 'Flint', 'Glint', 'Halo', 'Iris', 'Juniper', 'Lumen', 'Mica', 'Nimbus', 'Opal', 'Pebble', 'Quartz', 'Rime', 'Sable', 'Tundra', 'Umber', 'Vapor', 'Willow', 'Yonder', 'Zephyr', 'Cobalt', 'Fern', 'Garnet', 'Hazel', 'Indigo', 'Jade', 'Kelp', 'Lilac', 'Maple', 'Nectar', 'Ochre', 'Plum', 'Russet', 'Saffron', 'Teal', 'Verdant', 'Wisteria', 'Amber', 'Birch', 'Cedar', 'Dune', 'Echo', 'Frostline', 'Gale', 'Harbor', 'Isle'];
const PASS_COLORS = [0xe4572e, 0x29335c, 0xf3a712, 0x669bbc, 0xa8c686, 0xdb5461, 0x8e7dbe, 0x2ec4b6, 0xffbf69, 0x3d5a80, 0xee6c4d, 0x98c1d9, 0x6a994e, 0xbc4749, 0xf2e8cf, 0x386641, 0x9b5de5, 0xf15bb5, 0xfee440, 0x00bbf9, 0x00f5d4, 0x8338ec, 0xff006e, 0xfb5607, 0x3a86ff];
const PASS_NOUN = { jacket: 'Shell', pants: 'Pants', skis: 'Twins', snowboard: 'Deck', helmet: 'Lid', beanie: 'Beanie', bindings: 'Straps', boots: 'Boots', poles: 'Poles', gloves: 'Mitts', goggles: 'Lens' };
const PASS_KIND_CYCLE = ['jacket', 'goggles', 'pants', 'gloves', 'skis', 'helmet', 'poles', 'snowboard', 'boots', 'beanie', 'bindings'];

// Levels with a reward: premium items on levels ending 3, 5, 8 or 0 (40 levels),
// 25 FROST on the other 60 (1,500 FROST: premium pays for itself); free items on
// every 10th level and 25 FROST on levels 2, 7, 12, ... (500 FROST).
export function passRewardAt(level, track) {
  if (track === 'premium') return level % 5 === 0 || level % 5 === 3 ? 'item' : 'frost';
  if (level % 10 === 0) return 'item';
  return level % 5 === 2 ? 'frost' : null;
}

function buildPass() {
  const items = [];
  const rewards = [];
  let n = 0;
  for (let level = 1; level <= PASS.levels; level++) {
    for (const track of ['free', 'premium']) {
      const kind = passRewardAt(level, track);
      if (kind === 'frost') rewards.push({ level, track, frost: PASS.frostTile });
      else if (kind === 'item') {
        const k = PASS_KIND_CYCLE[n % PASS_KIND_CYCLE.length];
        const rarity = level <= 33 ? 'rare' : level <= 66 ? 'epic' : 'legendary';
        const color = PASS_COLORS[(n * 7) % PASS_COLORS.length];
        const trim = PASS_COLORS[(n * 7 + 11) % PASS_COLORS.length];
        const name = `${PASS_NAMES[n % PASS_NAMES.length]} ${k === 'jacket' && n % 2 ? 'Hoodie' : PASS_NOUN[k]}`;
        const id = `pass-${level}-${track}`;
        const look = { color, trim, style: k === 'jacket' && n % 2 ? 'hoodie' : undefined, finish: k === 'helmet' ? (rarity === 'legendary' ? 'metal' : 'gloss') : undefined };
        items.push({ ...item(id, name, k, rarity, look), source: 'pass', level, track });
        rewards.push({ level, track, item: id });
        n++;
      }
    }
  }
  return { items, rewards };
}
const built = buildPass();
export const PASS_ITEMS = built.items;
export const PASS_REWARDS = built.rewards;

// ---------------------------------------------------------------- lookups
export const ALL_ITEMS = [...SHOP_ITEMS, ...SETS.flatMap((s) => s.items), ...PASS_ITEMS];
const BY_ID = new Map(ALL_ITEMS.map((it) => [it.id, it]));
export const itemById = (id) => BY_ID.get(id) || null;
export const setById = (id) => SETS.find((s) => s.id === id) || null;

// Level and progress from total XP.
export function passLevel(xp) {
  const level = Math.min(PASS.levels, Math.floor(Math.max(0, xp) / PASS.xpPerLevel));
  const into = level >= PASS.levels ? PASS.xpPerLevel : Math.max(0, xp) - level * PASS.xpPerLevel;
  return { level, into, need: PASS.xpPerLevel };
}

// The next reward on a track after a level (or null when there are none left).
export function nextReward(level, track) {
  return PASS_REWARDS.find((r) => r.track === track && r.level > level) || null;
}

// Put an item on a look (it remembers which item dresses each slot).
export function wear(look, it) {
  return { ...look, ...it.look, items: { ...(look.items || {}), [it.slot]: it.id } };
}

export const hex = (n) => '#' + Number(n).toString(16).padStart(6, '0');
// A swatch colour to show for an item.
export function itemColor(it) {
  const l = it.look;
  return l.topColor ?? l.pants ?? l.skiColor ?? l.boardColor ?? l.helmetColor ?? l.beanieColor ?? l.bindings ?? l.boots ?? l.poles ?? l.gloves ?? l.lens ?? 0x888888;
}
