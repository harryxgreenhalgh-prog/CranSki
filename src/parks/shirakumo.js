// SHIRAKUMO: freeride. A groomed piste zigzags down at APEX speed with deep powder
// both sides, black rock walls, three steep chutes off the turns, and eight
// narrow forest trails with powder kickers, pillows and cliff drops.
import { jump, bump, cliff, chute, hold } from './helpers.js';
import { smoothstep } from '../sim/terrain.js';

const HW = 16;

// Eight trails: [u, s0, s1]
const TRAILS = [
  [-52, 360, 900],
  [58, 420, 1000],
  [-64, 1100, 1700],
  [50, 1060, 1600],
  [-50, 1800, 2400],
  [64, 1850, 2350],
  [-58, 2450, 2950],
  [54, 2500, 3000],
];

const trailFeatures = [];
TRAILS.forEach(([u, s0, s1], i) => {
  const L = s1 - s0;
  trailFeatures.push(jump(s0 + L * 0.15, u, 'xs', { width: 7, paint: true }));
  trailFeatures.push(bump(s0 + L * 0.3, u - 2, 2.5, 3, 1.4));
  trailFeatures.push(bump(s0 + L * 0.34, u + 2, 2.8, 3.2, 1.6));
  trailFeatures.push(bump(s0 + L * 0.38, u - 1, 2.4, 3, 1.3));
  trailFeatures.push(cliff(s0 + L * 0.55, u, 4 + (i % 3), 10, 26));
  trailFeatures.push(jump(s0 + L * 0.8, u, 'xs', { width: 7, lip: 26, face: 5 }));
});

function inTrail(u, s) {
  for (const [tu, s0, s1] of TRAILS) {
    if (s > s0 - 10 && s < s1 + 10 && Math.abs(u - tu) < 6) return true;
  }
  return false;
}

export const park = {
  id: 'shirakumo',
  name: 'SHIRAKUMO',
  lift: { type: 'ropeway', worldX: 88 },
  sky: 'sunrise',
  leaderboard: false,
  slopePoints: [[0, -2], [16, -2], [50, -16], ...hold(70, 3080, -16), [3140, -4], [3170, 0], [3260, 0]],
  center: [
    [0, 0],
    [300, 0],
    [650, 52],
    [1000, -50],
    [1350, 52],
    [1700, -50],
    [2050, 52],
    [2400, -46],
    [2800, 30],
    [3100, 0],
    [3260, 0],
  ],
  cross: { type: 'powder', hw: HW, rockStart: 92, rockK: 0.08, rockMax: 48 },
  powder: (u) => smoothstep(HW, HW + 3, Math.abs(u)),
  features: [
    // Steep chutes off the outside of three turns.
    chute(600, -40, 120, 9, 10),
    chute(1300, -40, 120, 10, 10),
    chute(2000, -40, 120, 9, 10),
    ...trailFeatures,
  ],
  trees: {
    spacing: 3,
    perRow: 4,
    minU: HW + 4,
    maxU: 92,
    seed: 77,
    allowed: (u, s) => !inTrail(u, s) && !(s > 590 && s < 730 && Math.abs(u + 40) < 9) && !(s > 1290 && s < 1430 && Math.abs(u + 40) < 9) && !(s > 1990 && s < 2130 && Math.abs(u + 40) < 9),
  },
  trails: TRAILS,
  startS: 8,
  finishS: 3150,
  endS: 3230,
};
