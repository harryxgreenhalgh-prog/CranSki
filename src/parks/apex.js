// APEX: pro slopestyle line in permanent sunrise daylight. Four big named kickers,
// two rail zones and a long stair set that rides like a slope.
import { jump, stairs, hold, forestTrees, rail } from './helpers.js';

export const park = {
  id: 'apex',
  name: 'APEX',
  lift: { type: 'gondola', side: 1, offset: 34 },
  sky: 'sunrise',
  slopePoints: [
    [0, -2],
    [18, -2],
    [55, -17],
    ...hold(70, 380, -17),
    [400, -10], // rail zone 1
    ...hold(410, 470, -10),
    [500, -17],
    ...hold(520, 760, -17),
    [790, -10], // rail zone 2
    ...hold(800, 860, -10),
    [890, -17],
    ...hold(900, 1080, -17),
    [1095, -27], // stair set
    ...hold(1100, 1160, -27),
    [1175, -16],
    ...hold(1190, 1480, -16),
    [1540, -3],
    [1570, 0],
    [1650, 0],
  ],
  cross: { type: 'banks', hw: 28, bankK: 0.06, bankMax: 30 },
  features: [
    jump(250, 0, 'xl', { name: 'SUNDIAL' }),
    jump(560, -6, 'l', { name: 'HALO', width: 16 }),
    jump(950, 6, 'xl', { name: 'GRANITE' }),
    jump(1250, 0, 'xl', { name: 'LAST LIGHT', face: 22, gap: 30 }),
    jump(570, 18, 's'),
    stairs(1100, -12, 60, 12),
  ],
  rails: [
    rail(415, -8, 18, 'rail'),
    rail(417, 8, 14, 'box', { lipAngle: 16 }),
    rail(805, 0, 20, 'kink'),
    rail(807, 14, 12, 'box', { lipAngle: 16 }),
    rail(1101, -5.4, 58, 'follow', { h: 0.9 }), // stair handrail
  ],
  trees: forestTrees(28, { perRow: 2 }),
  startS: 8,
  finishS: 1560,
  endS: 1630,
};
