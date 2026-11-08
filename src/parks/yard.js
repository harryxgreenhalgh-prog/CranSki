// THE YARD: open-session all-rounder, ~4 km, 15 jumps and 5 rail zones,
// with a day-night cycle and warm floodlights at night.
import { jump, hold, forestTrees } from './helpers.js';

const slopePoints = [
  [0, -2],
  [20, -2], // small flat start platform under the gondola
  [55, -13],
  ...hold(70, 560, -13),
  [600, -8], // rail zone 1 is flatter
  ...hold(620, 760, -8),
  [800, -14],
  ...hold(820, 1200, -14),
  [1230, -8],
  ...hold(1240, 1340, -8),
  [1380, -15],
  ...hold(1400, 1800, -15),
  [1830, -8],
  ...hold(1840, 1950, -8),
  [1990, -14],
  ...hold(2010, 2450, -14),
  [2480, -8],
  ...hold(2490, 2600, -8),
  [2640, -15],
  ...hold(2660, 3100, -15),
  [3130, -8],
  ...hold(3140, 3250, -8),
  [3290, -14],
  ...hold(3310, 3780, -14),
  [3850, -3],
  [3900, 0],
  [4000, 0],
];

export const park = {
  id: 'yard',
  name: 'THE YARD',
  lift: { type: 'gondola', side: -1, offset: 36 },
  sky: 'daynight',
  floodlights: true,
  slopePoints,
  cross: { type: 'banks', hw: 30, bankK: 0.05, bankMax: 26 },
  features: [
    // Line A: small / medium / large side by side.
    jump(260, -17, 's'),
    jump(250, 0, 'm'),
    jump(240, 17, 'l'),
    // Line B
    jump(900, -11, 'm'),
    jump(890, 11, 'l'),
    // Line C: the big one, plus a small side hit.
    jump(1480, 0, 'xl'),
    jump(1500, -22, 's'),
    // Line D
    jump(2160, -17, 's'),
    jump(2150, 0, 'm'),
    jump(2140, 17, 'l'),
    // Line E
    jump(2780, -11, 'l'),
    jump(2790, 12, 'm'),
    // Line F
    jump(3420, 0, 'xl'),
    jump(3440, 20, 'm'),
    jump(3440, -20, 's'),
  ],
  trees: forestTrees(30, { perRow: 2, spacing: 4.2 }),
  startS: 8,
  finishS: 3880,
  endS: 3960,
};
