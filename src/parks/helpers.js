// Building blocks for park layouts.

// Jump sizes: kicker face length, lip angle, table (gap) length, landing angle, width.
export const JUMP = {
  xs: { face: 4, lip: 22, gap: 0, width: 6, side: 2 },
  s: { face: 8, lip: 26, gap: 7, land: 20, width: 8, curve: 1.15, table: 0.95 },
  m: { face: 11, lip: 28, gap: 12, land: 22, width: 10, curve: 1.15, table: 0.95 },
  l: { face: 15, lip: 30, gap: 18, land: 24, width: 12, curve: 1.15, table: 0.95 },
  xl: { face: 20, lip: 31, gap: 26, land: 26, width: 14, curve: 1.15, table: 0.95 },
};

export function jump(s, u, size = 'm', extra = {}) {
  return { type: 'jump', s, u, size, ...JUMP[size], ...extra };
}

export function bump(s, u, rx, rs, h) {
  return { type: 'bump', s, u, rx, rs, h };
}

export function cliff(s, u, drop, width = 14, run = 28) {
  return { type: 'cliff', s, u, drop, width, run };
}

export function block(s, u, len, h, width = 6, edge = 1.5) {
  return { type: 'block', s, u, len, h, width, edge };
}

// A long snow deck with gentle ramps at both ends (for rails on snow decks).
export function deck(s, u, len, h, width = 8) {
  return { type: 'block', s, u, len, h, width, edge: 6, side: 2.5 };
}

export function chute(s, u, len, depth, width = 10) {
  return { type: 'chute', s, u, len, depth, width };
}

export function stairs(s, u, len, width = 10) {
  return { type: 'stairs', s, u, len, width };
}

// A rail (or box, pipe, kink, snake, rainbow, handrail) with optional blue-painted lip.
export function rail(s, u, len, kind = 'rail', extra = {}) {
  return { s, u, len, kind, lip: true, ...extra };
}

// Profile helper: a run of slope points that holds `angle` from s0 to s1.
export function hold(s0, s1, angle) {
  return [
    [s0, angle],
    [s1, angle],
  ];
}

// Groomed park with forest either side.
export function forestTrees(hw, extra = {}) {
  return {
    spacing: 3.6,
    perRow: 2,
    minU: hw + 6,
    maxU: hw + 50,
    ...extra,
  };
}
