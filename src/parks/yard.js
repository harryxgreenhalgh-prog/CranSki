// THE YARD: open-session all-rounder with a day-night cycle and warm floodlights
// at night. 15 jumps and 5 rail zones packed close together so a run flows.
import { jump, hold, forestTrees, rail } from './helpers.js';

// Each rail zone is led by a pop-on rail: a low kicker throws you over a gap onto a raised bar.
const railZone = (s, variant = 0) =>
  [
    [
      rail(s, -10, 22, 'rail', { lipFace: 6, lipAngle: 26, lipGap: 2.5, h: 1.7 }),
      rail(s + 2, 0, 30, 'box', { lipFace: 3.5, lipAngle: 16, lipGap: 0.6 }),
      rail(s, 10, 24, 'kink'),
    ],
    [
      rail(s, -10, 24, 'rail', { lipFace: 6, lipAngle: 26, lipGap: 2.5, h: 1.7 }),
      rail(s + 2, 0, 26, 'box', { lipFace: 3.5, lipAngle: 16, lipGap: 0.6 }),
      rail(s - 4, 11, 40, 'rail'), // long rail
    ],
    [
      rail(s, -10, 22, 'rail', { lipFace: 6, lipAngle: 26, lipGap: 2.5, h: 1.7 }),
      rail(s, 2, 36, 'box', { lipAngle: 16 }), // long box
      rail(s + 2, 13, 26, 'kink'),
    ],
  ][variant];

export const park = {
  id: 'yard',
  name: 'THE YARD',
  lift: { type: 'gondola', side: -1, offset: 36 },
  sky: 'daynight',
  floodlights: true,
  slopePoints: [
    [0, -2],
    [20, -2], // small flat start platform under the gondola
    [55, -11],
    ...hold(70, 130, -10), // rail zone 1
    [145, -14],
    ...hold(150, 285, -14), // lines A and B
    [295, -10],
    ...hold(300, 350, -10), // rail zone 2
    [362, -15],
    ...hold(368, 440, -15), // line C
    [452, -10],
    ...hold(456, 505, -10), // rail zone 3
    [518, -14],
    ...hold(522, 585, -14), // line D
    [595, -10],
    ...hold(600, 650, -10), // rail zone 4
    [662, -14],
    ...hold(666, 728, -14), // line E
    [738, -10],
    ...hold(742, 795, -10), // rail zone 5
    [808, -15],
    ...hold(812, 885, -15), // line F
    [920, -3],
    [945, 0],
    [1010, 0],
  ],
  cross: { type: 'banks', hw: 30, bankK: 0.05, bankMax: 26 },
  features: [
    // Line A: small / medium / large side by side.
    jump(158, -17, 's'),
    jump(150, 0, 'm'),
    jump(150, 17, 'l'),
    // Line B, straight after.
    jump(228, -11, 'm'),
    jump(222, 11, 'l'),
    // Line C: the big one, plus a small side hit.
    jump(370, 0, 'xl'),
    jump(385, -22, 's'),
    // Line D
    jump(530, -17, 's'),
    jump(524, 0, 'm'),
    jump(522, 17, 'l'),
    // Line E
    jump(668, -11, 'l'),
    jump(676, 12, 'm'),
    // Line F
    jump(814, 0, 'xl'),
    jump(828, 20, 'm'),
    jump(832, -20, 's'),
  ],
  rails: [...railZone(88, 0), ...railZone(305, 1), ...railZone(460, 2), ...railZone(604, 0), ...railZone(746, 1)],
  trees: forestTrees(30, { perRow: 2, spacing: 4.2 }),
  startS: 8,
  finishS: 930,
  endS: 990,
};
