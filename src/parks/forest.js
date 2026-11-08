// FOREST LINE: a rail park through the pines. Stepped start, doubles, a stair
// handrail and a giant black ball up top; a knoll hit, side-by-side gaps, twin
// jumps, blue pipes and a 38 m gap onto a rainbow rail on a tall block below.
import { jump, bump, block, stairs, hold, forestTrees, rail } from './helpers.js';

const slopePoints = [
  [0, -2],
  [14, -2],
  [15, -35], // stepped start: three terraces
  [16.5, -35],
  [17, -3],
  [32, -3],
  [33, -35],
  [34.5, -35],
  [35, -3],
  [50, -3],
  [51, -35],
  [52.5, -35],
  [53, -3],
  [70, -3],
  [100, -12],
  ...hold(110, 980, -12),
  [995, -26], // stair set with handrail
  ...hold(1000, 1040, -26),
  [1055, -12],
  ...hold(1065, 2850, -12),
  [2880, -7], // blue pipes
  ...hold(2890, 2990, -7),
  [3020, -13],
  ...hold(3040, 3680, -13),
  [3730, -3],
  [3760, 0],
  [3850, 0],
];

export const park = {
  id: 'forest',
  name: 'FOREST LINE',
  lift: { type: 'gondola', side: -1, offset: 30 },
  sky: 'day',
  slopePoints,
  center: [
    [0, 0],
    [200, 0],
    [700, 16],
    [1300, -12],
    [1900, 18],
    [2600, -14],
    [3300, 10],
    [3850, 0],
  ],
  cross: { type: 'banks', hw: 22, bankK: 0.07, bankMax: 24 },
  features: [
    // Doubles: two jumps in sequence.
    jump(500, -6, 's'),
    jump(540, -6, 's'),
    jump(1300, 6, 'm'),
    jump(1350, 6, 'm'),
    stairs(1000, -9, 40, 10),
    // Bottom: a big hit off a knoll.
    bump(1920, 0, 20, 30, 6),
    jump(1900, 0, 'l'),
    // Two side-by-side gaps.
    jump(2150, -9, 'l', { width: 10 }),
    jump(2150, 9, 'l', { width: 10 }),
    // Three twin jumps.
    jump(2450, -8, 'm', { width: 8 }),
    jump(2450, 8, 'm', { width: 8 }),
    jump(2560, -8, 'm', { width: 8 }),
    jump(2560, 8, 'm', { width: 8 }),
    jump(2670, -8, 'm', { width: 8 }),
    jump(2670, 8, 'm', { width: 8 }),
    // 38 m gap onto a tall snow block with the rainbow rail.
    jump(3180, 0, 'l', { gap: 0, lip: 32 }),
    block(3233, 0, 22, 6.5, 7, 7), // undershoot rides up the ramped front instead of hitting a wall
    jump(3450, 0, 'm'),
  ],
  rails: [
    // 1. Stepped start: a low rail down each step.
    rail(8, -7, 11, 'rail', { lip: false, h: 0.45, endH: 0.45 }),
    rail(26, 7, 11, 'rail', { lip: false, h: 0.45, endH: 0.45 }),
    rail(44, -7, 11, 'rail', { lip: false, h: 0.45, endH: 0.45 }),
    // 2. Rails off gentle ramps.
    rail(300, -8, 16, 'rail', { lipAngle: 15 }),
    rail(302, 0, 14, 'box', { lipAngle: 14 }),
    rail(300, 8, 16, 'rail', { lipAngle: 15 }),
    // 3. Snake rail into the doubles.
    rail(440, -6, 28, 'snake'),
    // 4. Stair handrail.
    rail(1001, -3.4, 38, 'follow', { h: 0.9 }),
    // 5.
    rail(1600, -7, 18, 'kink'),
    rail(1602, 7, 14, 'box', { lipAngle: 16 }),
    // 6. Three blue pipes.
    rail(2905, -9, 22, 'pipe'),
    rail(2905, 0, 22, 'pipe'),
    rail(2905, 9, 22, 'pipe'),
    // 7. Rainbow rail on the tall snow block after the 38 m gap.
    rail(3236, 0, 16, 'rainbow', { lip: false, h: 0.45, arc: 1.2 }),
    // 8.
    rail(3550, -6, 18, 'rail'),
    rail(3552, 6, 14, 'box', { lipAngle: 16 }),
  ],
  obstacles: [{ type: 'ball', s: 780, u: 9, r: 3.2, ring: true }],
  trees: forestTrees(22, { perRow: 3, minU: 25, spacing: 3 }),
  startS: 6,
  finishS: 3740,
  endS: 3820,
};
