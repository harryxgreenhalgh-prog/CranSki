// ASPEN PIPE: a 600 m superpipe with 10.5 m walls in the forest.
import { forestTrees } from './helpers.js';

export const park = {
  id: 'pipe',
  name: 'ASPEN PIPE',
  lift: { type: 'tbar', side: 1, offset: 4 },
  sky: 'day',
  pipe: true,
  slopePoints: [
    [0, -3],
    [18, -3],
    [34, -17], // drop in, then a 600 m pipe at 17 degrees
    [640, -17],
    [670, -4],
    [700, 0],
    [760, 0],
  ],
  cross: { type: 'pipe', floor: 9, wall: 10.5, deck: 8, bankK: 0.05, bankMax: 16 },
  features: [],
  trees: forestTrees(30, { minU: 34, maxU: 75, perRow: 2 }),
  startS: 8,
  finishS: 680,
  endS: 740,
};
