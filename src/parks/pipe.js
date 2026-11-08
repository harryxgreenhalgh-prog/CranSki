// ASPEN PIPE: a superpipe with 10.5 m walls in the forest.
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
    [34, -17], // drop in, then the pipe at 17 degrees
    [500, -17],
    [530, -4],
    [560, 0],
    [620, 0],
  ],
  cross: { type: 'pipe', floor: 9, wall: 10.5, deck: 8, bankK: 0.05, bankMax: 16 },
  features: [],
  trees: forestTrees(30, { minU: 34, maxU: 75, perRow: 2 }),
  startS: 8,
  finishS: 545,
  endS: 600,
};
