// FOREST LINE: a rail park through the pines. Stepped start, rails off gentle
// ramps, a snake rail into doubles, a stair handrail and a giant black ball up
// top; a knoll hit, side-by-side gaps, twin jumps, blue pipes and a 38 m gap onto
// a rainbow rail on a tall block below. Everything comes thick and fast.
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
  [90, -11],
  ...hold(95, 295, -12),
  [303, -26], // stair set with handrail
  ...hold(306, 344, -26),
  [354, -12],
  ...hold(360, 645, -12),
  [652, -7], // blue pipes
  ...hold(656, 692, -7),
  [702, -13],
  ...hold(708, 1100, -13),
  [1140, -3],
  [1165, 0],
  [1220, 0],
];

export const park = {
  id: 'forest',
  name: 'FOREST LINE',
  lift: { type: 'gondola', side: -1, offset: 30 },
  sky: 'day',
  slopePoints,
  center: [
    [0, 0],
    [150, 0],
    [400, 12],
    [700, -10],
    [1000, 12],
    [1220, 0],
  ],
  cross: { type: 'banks', hw: 22, bankK: 0.07, bankMax: 24 },
  features: [
    // Doubles: two jumps in sequence after the snake rail.
    jump(190, -6, 's'),
    jump(228, -6, 's'),
    jump(362, 6, 'm'),
    jump(402, 6, 'm'),
    stairs(306, -9, 38, 10),
    // A big hit off a knoll.
    bump(535, 0, 20, 30, 6),
    jump(515, 0, 'l'),
    // Two side-by-side gaps.
    jump(582, -9, 'l', { width: 10 }),
    jump(582, 9, 'l', { width: 10 }),
    // Three twin jumps.
    jump(705, -8, 'm', { width: 8 }),
    jump(705, 8, 'm', { width: 8 }),
    jump(752, -8, 'm', { width: 8 }),
    jump(752, 8, 'm', { width: 8 }),
    jump(799, -8, 'm', { width: 8 }),
    jump(799, 8, 'm', { width: 8 }),
    // 38 m gap onto a tall snow block with the rainbow rail.
    jump(850, 0, 'l', { gap: 0, lip: 32 }),
    block(903, 0, 26, 6.5, 7, 7), // undershoot rides up the ramped front instead of hitting a wall
    jump(1040, 0, 'm'),
  ],
  rails: [
    // 1. Stepped start: a low rail down each step.
    rail(8, -7, 11, 'rail', { lip: false, h: 0.45, endH: 0.45 }),
    rail(26, 7, 11, 'rail', { lip: false, h: 0.45, endH: 0.45 }),
    rail(44, -7, 11, 'rail', { lip: false, h: 0.45, endH: 0.45 }),
    // 2. Rails off gentle ramps.
    rail(100, -8, 26, 'rail', { lipAngle: 15 }),
    rail(102, 0, 20, 'box', { lipAngle: 14 }),
    rail(100, 8, 26, 'rail', { lipAngle: 15 }),
    // 3. Snake rail into the doubles.
    rail(146, -6, 34, 'snake'),
    // 4. Stair handrail.
    rail(307, -3.4, 36, 'follow', { h: 0.9 }),
    // 5. Kink and a long box.
    rail(455, -7, 30, 'kink'),
    rail(457, 7, 38, 'box', { lipAngle: 16 }),
    // 6. Three blue pipes.
    rail(658, -9, 30, 'pipe'),
    rail(658, 0, 30, 'pipe'),
    rail(658, 9, 30, 'pipe'),
    // 7. Rainbow rail on the block after the 38 m gap.
    rail(906, 0, 20, 'rainbow', { lip: false, h: 0.45, arc: 1.3 }),
    // 8. A long rail and a box before the last jump.
    rail(985, -6, 40, 'rail'),
    rail(987, 6, 30, 'box', { lipAngle: 16 }),
  ],
  obstacles: [{ type: 'ball', s: 272, u: 9, r: 3.2, ring: true }],
  trees: forestTrees(22, { perRow: 3, minU: 25, spacing: 3 }),
  startS: 6,
  finishS: 1150,
  endS: 1200,
};
