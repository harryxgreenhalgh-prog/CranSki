// BIG AIR park terrain: a height profile along the run plus side banks.
// Pure module (no rendering) so the simulation and tests can share it.
//
// World axes: x = across the slope, y = up, downhill = -z.
// "s" is the horizontal distance down the course, s = -z.

const DEG = Math.PI / 180;

// Slope angle control points (s in metres, angle in degrees; negative = downhill).
// Angles are eased between points with a cosine blend, then integrated into heights.
// Two points at almost the same s make a sharp edge (the lip).
export const BIG_AIR = {
  name: 'BIG AIR',
  halfWidth: 20, // groomed width either side of the centre line
  slopePoints: [
    [0, -2],
    [14, -2], // start gate platform
    [40, -38], // roll-in to the steep forest inrun
    [215, -38],
    [252, -7], // transition out of the inrun
    [264, -7], // short approach
    [284, 35], // kicker face curls up to a sharp ~35 degree lip
    [284.05, -42], // back of the kicker drops onto the deck
    [288.5, -42],
    [288.55, -3], // long, wide deck: undershoot lands here
    [450, -3],
    [500, -40], // wide knuckle rolls into a steep landing
    [585, -40],
    [655, -10], // long landing eases out
    [700, 0], // run-out
    [800, 0],
  ],
  startS: 6,
  kickerStartS: 264,
  lipS: 284,
  knuckleS: 455,
  finishS: 745,
  endS: 795,
};

const STEP = 0.05;

function buildProfile(park) {
  const pts = park.slopePoints;
  const n = Math.ceil(park.endS / STEP) + 2;
  const h = new Float32Array(n);
  const slope = new Float32Array(n);
  let seg = 0;
  let y = 0;
  for (let i = 0; i < n; i++) {
    const s = i * STEP;
    while (seg < pts.length - 2 && s > pts[seg + 1][0]) seg++;
    const [s0, a0] = pts[seg];
    const [s1, a1] = pts[Math.min(seg + 1, pts.length - 1)];
    let t = s1 > s0 ? (s - s0) / (s1 - s0) : 1;
    t = Math.min(1, Math.max(0, t));
    const e = 0.5 - 0.5 * Math.cos(Math.PI * t);
    const ang = (a0 + (a1 - a0) * e) * DEG;
    const g = Math.tan(ang);
    slope[i] = g;
    if (i > 0) y += 0.5 * (slope[i - 1] + g) * STEP;
    h[i] = y;
  }
  return { h, slope, n };
}

export class Terrain {
  constructor(park = BIG_AIR) {
    this.park = park;
    const { h, slope, n } = buildProfile(park);
    this.h = h;
    this.slope = slope;
    this.n = n;
    this.lipHeight = this.profile(park.lipS);
  }

  // Height of the centre line at distance s.
  profile(s) {
    const f = Math.min(Math.max(s, 0), (this.n - 1) * STEP) / STEP;
    const i = Math.min(Math.floor(f), this.n - 2);
    const t = f - i;
    return this.h[i] * (1 - t) + this.h[i + 1] * t;
  }

  profileSlope(s) {
    const f = Math.min(Math.max(s, 0), (this.n - 1) * STEP) / STEP;
    const i = Math.min(Math.floor(f), this.n - 2);
    const t = f - i;
    return this.slope[i] * (1 - t) + this.slope[i + 1] * t;
  }

  // Side banks keep riders inside the park: flat in the middle, curling up at the edges.
  bank(x) {
    const ax = Math.abs(x) - this.park.halfWidth;
    if (ax <= 0) return 0;
    return 0.06 * ax * ax;
  }

  bankSlope(x) {
    const ax = Math.abs(x) - this.park.halfWidth;
    if (ax <= 0) return 0;
    return 0.12 * ax * Math.sign(x);
  }

  height(x, z) {
    return this.profile(-z) + this.bank(x);
  }

  // Unit surface normal at (x, z), written into out ({x,y,z}).
  normal(x, z, out) {
    const dYdx = this.bankSlope(x);
    const dYdz = -this.profileSlope(-z); // dY/dz = -dY/ds
    const nx = -dYdx;
    const ny = 1;
    const nz = -dYdz;
    const len = Math.hypot(nx, ny, nz);
    out.x = nx / len;
    out.y = ny / len;
    out.z = nz / len;
    return out;
  }

  // True on the kicker face, where an early pop is held until take-off.
  onKickerFace(z) {
    const s = -z;
    return s >= this.park.kickerStartS - 6 && s <= this.park.lipS + 0.5;
  }
}
