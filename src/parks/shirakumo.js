// SHIRAKUMO: freeride. A groomed piste zigzags down at APEX speed with deep powder
// both sides, black rock walls, three steep chutes off the turns, and eight narrow
// forest trails with powder kickers, pillows and cliff drops.
import { jump, bump, cliff, chute, hold } from './helpers.js';
import { smoothstep } from '../sim/terrain.js';

const HW = 16;

// Eight trails: [u, s0, s1]
const TRAILS = [
  [-52, 150, 420],
  [56, 170, 440],
  [-60, 480, 760],
  [50, 460, 720],
  [-50, 820, 1080],
  [60, 840, 1100],
  [-56, 1120, 1380],
  [52, 1130, 1390],
];

const trailFeatures = [];
TRAILS.forEach(([u, s0, s1], i) => {
  const L = s1 - s0;
  trailFeatures.push(jump(s0 + L * 0.12, u, 'xs', { width: 7 }));
  trailFeatures.push(bump(s0 + L * 0.28, u - 2, 2.5, 3, 1.4));
  trailFeatures.push(bump(s0 + L * 0.33, u + 2, 2.8, 3.2, 1.6));
  trailFeatures.push(bump(s0 + L * 0.38, u - 1, 2.4, 3, 1.3));
  trailFeatures.push(cliff(s0 + L * 0.55, u, 4 + (i % 3), 10, 22));
  trailFeatures.push(jump(s0 + L * 0.82, u, 'xs', { width: 7, lip: 26, face: 5 }));
});

function inTrail(u, s) {
  for (const [tu, s0, s1] of TRAILS) {
    if (s > s0 - 10 && s < s1 + 10 && Math.abs(u - tu) < 6) return true;
  }
  return false;
}

const CHUTES = [300, 660, 1020];

export const park = {
  id: 'shirakumo',
  name: 'SHIRAKUMO',
  lift: { type: 'ropeway', worldX: 88 },
  sky: 'sunrise',
  leaderboard: false,
  slopePoints: [[0, -2], [16, -2], [50, -16], ...hold(70, 1400, -16), [1450, -4], [1475, 0], [1540, 0]],
  center: [
    [0, 0],
    [120, 0],
    [300, 40],
    [480, -38],
    [660, 40],
    [840, -38],
    [1020, 38],
    [1200, -28],
    [1380, 0],
    [1540, 0],
  ],
  cross: { type: 'powder', hw: HW, rockStart: 92, rockK: 0.08, rockMax: 48 },
  powder: (u) => smoothstep(HW, HW + 3, Math.abs(u)),
  features: [...CHUTES.map((s, i) => chute(s, -40, 110, 9 + (i % 2), 10)), ...trailFeatures],
  trees: {
    spacing: 3,
    perRow: 4,
    minU: HW + 4,
    maxU: 92,
    seed: 77,
    allowed: (u, s) => !inTrail(u, s) && !CHUTES.some((c) => s > c - 10 && s < c + 120 && Math.abs(u + 40) < 9),
  },
  trails: TRAILS,
  startS: 8,
  finishS: 1460,
  endS: 1520,
};
