// BIG AIR: steep forest inrun, a sharp ~35 degree lip, a wide knuckle and a long landing.
import { forestTrees } from './helpers.js';

export const park = {
  id: 'bigair',
  name: 'BIG AIR',
  lift: { type: 'gondola', side: 1, offset: 34 },
  sky: 'day',
  slopePoints: [
    [0, -2],
    [14, -2], // start gate platform
    [40, -38], // roll-in to the steep forest inrun
    [215, -38],
    [252, -7], // transition out of the inrun
    [264, -7], // short approach
    [284, 35], // kicker face curls up to a sharp ~35 degree lip
    [284.05, -42], // back of the kicker drops onto the deck
    [288.5, -42],
    [288.55, -3], // long, wide deck: undershoot lands here
    [450, -3],
    [500, -40], // wide knuckle rolls into a steep landing
    [585, -40],
    [655, -10], // long landing eases out
    [700, 0], // run-out
    [800, 0],
  ],
  cross: { type: 'banks', hw: 20, bankK: 0.06, bankMax: 40 },
  profileKicker: { faceS: 264, lipS: 284, knuckleS: 455 },
  features: [],
  trees: forestTrees(20, { perRow: 3 }),
  boards: { from: 284, every: 25, start: 150, end: 300, highlight: 225 },
  startS: 6,
  finishS: 745,
  endS: 795,
};
