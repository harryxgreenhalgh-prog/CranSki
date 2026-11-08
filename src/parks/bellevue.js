// BELLEVUE: a 3 km street through an alpine village. Kickers and hips between
// houses, rails on snow decks, gaps onto rails. The sky runs from sunrise to
// northern lights as you ride down.
import { jump, deck, hold, rail } from './helpers.js';
import { mulberry32 } from '../sim/rng.js';

const HW = 13;
const CURB = 1.2;
const WALK = 9;

const houses = [];
const rnd = mulberry32(31);
const COLORS = [0xc9563c, 0xe8d5b0, 0x7b9bb5, 0xd98f3f, 0xf2efe6, 0x8c6e5a, 0xb54848];
for (let s = 40; s < 1030; s += 24) {
  for (const side of [-1, 1]) {
    if (rnd() < 0.18) continue; // gaps between houses
    const w = 7 + rnd() * 3;
    const l = 10 + rnd() * 6;
    houses.push({
      type: 'house',
      s: s + rnd() * 4,
      u: side * (HW + CURB + 1.5 + w / 2),
      w,
      l,
      h: 5 + rnd() * 4,
      color: COLORS[Math.floor(rnd() * COLORS.length)],
      roof: rnd() < 0.5 ? 0x5a3d33 : 0x3d4a5a,
    });
  }
}

export const park = {
  id: 'bellevue',
  name: 'BELLEVUE',
  lift: { type: 'tbar', side: 1, offset: 26 },
  sky: 'aurora',
  slopePoints: [[0, -2], [16, -2], [45, -10], ...hold(60, 990, -10), [1030, -3], [1055, 0], [1110, 0]],
  center: [
    [0, 0],
    [150, 0],
    [400, 14],
    [700, -12],
    [950, 10],
    [1110, 0],
  ],
  cross: { type: 'street', hw: HW, curb: CURB, walk: WALK, bankK: 0.05, bankMax: 22 },
  features: [
    jump(70, 0, 'm'),
    jump(120, -3, 'm', { dir: 16, name: 'hip' }),
    deck(170, 0, 30, 1.2, 8),
    jump(222, 0, 'l'),
    jump(335, 3, 'm', { dir: -16 }),
    jump(385, -5, 'm'),
    jump(392, 6, 's'),
    deck(440, 0, 34, 1.2, 8),
    jump(500, 0, 'l'),
    jump(565, -3, 'm', { dir: 16 }),
    deck(615, -4, 30, 1.4, 8),
    jump(668, 0, 'xl', { width: 12 }),
    jump(815, 0, 'm'),
    deck(865, 3, 32, 1.2, 8),
    jump(920, 3, 'l', { dir: -14 }),
  ],
  rails: [
    // Rails on snow decks.
    rail(173, 0, 24, 'box', { lip: false, h: 0.4, endH: 0.4 }),
    rail(443, 0, 28, 'rail', { lip: false, h: 0.45, endH: 0.45 }),
    rail(618, -4, 24, 'rail', { lip: false, h: 0.45, endH: 0.45 }),
    rail(868, 3, 26, 'box', { lip: false, h: 0.4, endH: 0.4 }),
    // Gaps onto rails.
    rail(290, 6, 26, 'rail', { lipGap: 3.5, lipAngle: 24, lipFace: 5.5, h: 1.6 }),
    rail(755, -5, 36, 'rail', { lipGap: 3.5, lipAngle: 24, lipFace: 5.5, h: 1.6 }), // long
  ],
  obstacles: houses,
  trees: { spacing: 6, perRow: 1, minU: HW + CURB + WALK + 6, maxU: HW + 60, seed: 5 },
  startS: 8,
  finishS: 1040,
  endS: 1095,
};
