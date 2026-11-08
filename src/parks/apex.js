// APEX: pro slopestyle line in permanent sunrise daylight. Four big named kickers
// back to back, two rail zones and a long stair set that rides like a slope.
import { jump, stairs, hold, forestTrees, rail } from './helpers.js';

export const park = {
  id: 'apex',
  name: 'APEX',
  lift: { type: 'gondola', side: 1, offset: 34 },
  sky: 'sunrise',
  slopePoints: [
    [0, -2],
    [18, -2],
    [50, -12],
    ...hold(60, 125, -11), // rail zone 1
    [138, -17],
    ...hold(142, 285, -17), // SUNDIAL and HALO
    [296, -11],
    ...hold(300, 350, -11), // rail zone 2
    [362, -17],
    ...hold(366, 438, -17), // GRANITE
    [448, -27], // stair set
    ...hold(452, 510, -27),
    [522, -17],
    ...hold(528, 615, -17), // LAST LIGHT
    [660, -3],
    [690, 0],
    [740, 0],
  ],
  cross: { type: 'banks', hw: 28, bankK: 0.06, bankMax: 30 },
  features: [
    jump(145, 0, 'xl', { name: 'SUNDIAL' }),
    jump(226, -6, 'l', { name: 'HALO', width: 16 }),
    jump(236, 18, 's'),
    jump(368, 6, 'xl', { name: 'GRANITE' }),
    jump(530, 0, 'xl', { name: 'LAST LIGHT', face: 22, gap: 30 }),
    stairs(452, -12, 58, 12),
  ],
  rails: [
    rail(78, -8, 36, 'rail'), // long rail
    rail(80, 8, 30, 'box', { lipAngle: 16 }),
    rail(303, 0, 32, 'kink'),
    rail(301, 14, 40, 'box', { lipAngle: 16 }), // long box
    rail(453, -5.4, 56, 'follow', { h: 0.9 }), // stair handrail
  ],
  trees: forestTrees(28, { perRow: 2 }),
  startS: 8,
  finishS: 670,
  endS: 730,
};
