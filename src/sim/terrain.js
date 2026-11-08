// Course terrain built from a park definition (see src/parks/).
// Pure module (no rendering) so the simulation, replays and tests share it.
//
// World axes: x = across the slope, y = up, downhill = -z.
// "s" is the distance down the course (s = -z) and "u" the offset from the
// course centre line, so a park can curve (u = x - center(s)).
//
// height = profile(s) + crossSection(u, s) + features(u, s)

import { mulberry32 } from './rng.js';

const DEG = Math.PI / 180;
const PSTEP = 0.05; // profile sample step (m)
const FSTEP = 0.1; // feature table step (m)
const BUCKET = 20; // feature lookup bucket size along s (m)

export function smoothstep(e0, e1, x) {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

// Integrate eased slope-angle control points into a height table.
function integrateProfile(points, endS) {
  const n = Math.ceil(endS / PSTEP) + 2;
  const h = new Float32Array(n);
  const slope = new Float32Array(n);
  let seg = 0;
  let y = 0;
  for (let i = 0; i < n; i++) {
    const s = i * PSTEP;
    while (seg < points.length - 2 && s > points[seg + 1][0]) seg++;
    const [s0, a0] = points[seg];
    const [s1, a1] = points[Math.min(seg + 1, points.length - 1)];
    let t = s1 > s0 ? (s - s0) / (s1 - s0) : 1;
    t = Math.min(1, Math.max(0, t));
    const e = 0.5 - 0.5 * Math.cos(Math.PI * t);
    const g = Math.tan((a0 + (a1 - a0) * e) * DEG);
    slope[i] = g;
    if (i > 0) y += 0.5 * (slope[i - 1] + g) * PSTEP;
    h[i] = y;
  }
  return { h, slope, n };
}

// Relative height table for a jump: kicker face, optional table (gap), knuckle and landing.
export function buildJumpTable(f) {
  const out = [0];
  let h = 0;
  const nFace = Math.max(1, Math.round(f.face / FSTEP));
  const curve = f.curve ?? 1.4;
  for (let i = 1; i <= nFace; i++) {
    const a = f.lip * DEG * Math.pow(i / nFace, curve);
    h += Math.tan(a) * FSTEP;
    out.push(h);
  }
  const lipH = h;
  const lipAlong = nFace * FSTEP;
  const gap = f.gap ?? 0;
  const tableH = gap > 0 ? lipH * (f.table ?? 0.85) : 0;
  const back = Math.tan((f.back ?? 50) * DEG) * FSTEP;
  while (h > tableH + 1e-6) {
    h = Math.max(tableH, h - back);
    out.push(h);
  }
  const tableStart = out.length * FSTEP;
  for (let i = 0; i < Math.round(gap / FSTEP); i++) out.push(h);
  const knuckleAlong = out.length * FSTEP;
  if (h > 0) {
    const land = (f.land ?? 22) * DEG;
    const K = f.knuckle ?? 5;
    const T = f.trans ?? 8;
    const nK = Math.round(K / FSTEP);
    for (let i = 1; i <= nK && h > 0; i++) {
      h = Math.max(0, h - Math.tan((land * i) / nK) * FSTEP);
      out.push(h);
    }
    const hTrans = T * Math.tan(land) * 0.5;
    while (h > hTrans) {
      h -= Math.tan(land) * FSTEP;
      out.push(h);
    }
    const nT = Math.round(T / FSTEP);
    for (let i = 1; i <= nT && h > 0; i++) {
      h = Math.max(0, h - Math.tan(land * (1 - i / nT)) * FSTEP);
      out.push(h);
    }
    while (h > 0) {
      h = Math.max(0, h - 0.01);
      out.push(h);
    }
  }
  out.push(0);
  return { table: Float32Array.from(out), lipAlong, lipH, tableH, tableStart, knuckleAlong, len: (out.length - 1) * FSTEP };
}

function sampleTable(table, along) {
  const f = along / FSTEP;
  const i = Math.floor(f);
  if (i < 0 || i >= table.length - 1) return 0;
  const t = f - i;
  return table[i] * (1 - t) + table[i + 1] * t;
}

// Resolve a feature definition into a fast evaluator with an along/across extent.
function resolveFeature(def, index) {
  const f = { ...def, index };
  const dir = (def.dir ?? 0) * DEG;
  f.sin = Math.sin(dir);
  f.cos = Math.cos(dir);
  f.u = def.u ?? 0;
  switch (def.type) {
    case 'jump': {
      const j = buildJumpTable(def);
      Object.assign(f, j);
      f.halfW = (def.width ?? 12) / 2;
      f.side = def.side ?? 3;
      f.a0 = 0;
      f.a1 = j.len;
      f.rel = (a) => sampleTable(j.table, a);
      f.kicker = true;
      break;
    }
    case 'bump': {
      f.halfW = def.rx;
      f.side = 0;
      f.a0 = -def.rs;
      f.a1 = def.rs;
      break;
    }
    case 'cliff': {
      const run = def.run ?? 30;
      f.halfW = (def.width ?? 14) / 2;
      f.side = def.side ?? 3;
      f.a0 = -2.5;
      f.a1 = 1.6 + run;
      f.rel = (a) => {
        if (a < 0) return 0.35 * Math.sin((Math.PI * (a + 2.5)) / 2.5);
        if (a < 1.6) return -def.drop * smoothstep(0, 1.6, a);
        return -def.drop * (1 - smoothstep(1.6, 1.6 + run, a));
      };
      break;
    }
    case 'chute': {
      f.halfW = (def.width ?? 10) / 2;
      f.side = def.side ?? 6;
      f.a0 = 0;
      f.a1 = def.len;
      f.rel = (a) => -def.depth * Math.sin((Math.PI * a) / def.len);
      break;
    }
    case 'block': {
      const e = def.edge ?? 1.5;
      f.halfW = (def.width ?? 6) / 2;
      f.side = def.side ?? 1.2;
      f.a0 = -e;
      f.a1 = def.len + e;
      f.rel = (a) => def.h * smoothstep(-e, 0, a) * smoothstep(def.len + e, def.len, a);
      break;
    }
    default: {
      // Visual-only features (stairs, decorations) add no height.
      f.halfW = (def.width ?? 6) / 2;
      f.side = 0;
      f.a0 = 0;
      f.a1 = def.len ?? 0;
      f.visualOnly = true;
    }
  }
  return f;
}

export class Terrain {
  constructor(park) {
    this.park = park;
    const prof = integrateProfile(park.slopePoints, park.endS + 60);
    this.h = prof.h;
    this.slope = prof.slope;
    this.n = prof.n;

    // Centre line, sampled every metre.
    const cpts = park.center && park.center.length ? park.center : [[0, 0]];
    const nC = Math.ceil(park.endS + 60) + 2;
    this.cx = new Float32Array(nC);
    let seg = 0;
    for (let i = 0; i < nC; i++) {
      while (seg < cpts.length - 2 && i > cpts[seg + 1][0]) seg++;
      const [s0, u0] = cpts[seg];
      const [s1, u1] = cpts[Math.min(seg + 1, cpts.length - 1)];
      let t = s1 > s0 ? (i - s0) / (s1 - s0) : 1;
      t = Math.min(1, Math.max(0, t));
      this.cx[i] = u0 + (u1 - u0) * (0.5 - 0.5 * Math.cos(Math.PI * t));
    }

    this.cross = { type: 'banks', hw: 20, bankK: 0.06, bankMax: 30, ...(park.cross || {}) };
    if (this.cross.type === 'pipe') {
      const c = this.cross;
      c.R = c.wall / (1 - Math.cos(85 * DEG));
      c.aMax = c.R * Math.sin(85 * DEG);
      c.lipU = c.floor + c.aMax; // coping
      c.hw = c.lipU + c.deck;
    }

    // Rails bring their own blue-painted lips (small kickers) as features.
    const railDefs = park.rails || [];
    const lipDefs = [];
    railDefs.forEach((r, i) => {
      if (!r.lip) return;
      const gap = r.lipGap ?? 1.2;
      const face = r.lipFace ?? 4.5;
      lipDefs.push({ type: 'jump', s: r.s - gap - face, u: r.u ?? 0, face, lip: r.lipAngle ?? 20, gap: 0, width: 3.2, side: 1.5, back: 35, railLip: i });
    });

    // Features in lookup buckets along s.
    this.features = [...(park.features || []), ...lipDefs].map(resolveFeature);
    this.buckets = [];
    for (const f of this.features) {
      if (f.visualOnly) continue;
      const ext = f.halfW + f.side;
      let sMin = Infinity;
      let sMax = -Infinity;
      for (const a of [f.a0, f.a1]) {
        for (const c of [-ext, ext]) {
          // s = s0 + along*cos - across*sin
          const s = f.s + a * f.cos - c * f.sin;
          sMin = Math.min(sMin, s);
          sMax = Math.max(sMax, s);
        }
      }
      for (let b = Math.floor(sMin / BUCKET); b <= Math.floor(sMax / BUCKET); b++) {
        if (b < 0) continue;
        (this.buckets[b] ||= []).push(f);
      }
    }

    this.lipHeight = park.profileKicker ? this.profile(park.profileKicker.lipS) : 0;
    this._buildRails(railDefs);
    this._buildTrees();
    this._buildObstacles();
  }

  get startS() {
    return this.park.startS;
  }
  get finishS() {
    return this.park.finishS;
  }

  profile(s) {
    const f = Math.min(Math.max(s, 0), (this.n - 1) * PSTEP) / PSTEP;
    const i = Math.min(Math.floor(f), this.n - 2);
    const t = f - i;
    return this.h[i] * (1 - t) + this.h[i + 1] * t;
  }

  center(s) {
    const n = this.cx.length;
    const f = Math.min(Math.max(s, 0), n - 1.001);
    const i = Math.floor(f);
    const t = f - i;
    return this.cx[i] * (1 - t) + this.cx[i + 1] * t;
  }

  // dx/ds of the centre line.
  centerSlope(s) {
    return this.center(s + 0.5) - this.center(s - 0.5);
  }

  crossSection(u, s) {
    const c = this.cross;
    const au = Math.abs(u);
    switch (c.type) {
      case 'pipe': {
        const a = au - c.floor;
        if (a <= 0) return 0;
        if (a < c.aMax) return c.R - Math.sqrt(c.R * c.R - a * a);
        const top = c.wall;
        const b = au - c.hw;
        if (b <= 0) return top;
        return top + c.bankMax * (1 - Math.exp((-c.bankK * b * b) / c.bankMax));
      }
      case 'street': {
        const a = au - c.hw;
        if (a <= 0) return 0;
        const curb = c.curb * smoothstep(0, 1.2, a);
        const b = a - 1.2 - c.walk;
        if (b <= 0) return curb;
        return curb + c.bankMax * (1 - Math.exp((-c.bankK * b * b) / c.bankMax));
      }
      case 'powder': {
        const a = au - c.hw;
        if (a <= 0) return 0;
        // Untracked powder: rolling, gently rising, then black rock walls.
        const roll = 0.7 * Math.sin(s / 23 + u / 11) * Math.sin(u / 17 + s / 41) * smoothstep(0, 8, a);
        let h = 0.04 * a + roll;
        const r = au - c.rockStart;
        if (r > 0) h += c.rockMax * (1 - Math.exp((-c.rockK * r * r) / c.rockMax));
        return h;
      }
      default: {
        const a = au - c.hw;
        if (a <= 0) return 0;
        return c.bankMax * (1 - Math.exp((-c.bankK * a * a) / c.bankMax));
      }
    }
  }

  featureHeight(u, s) {
    const b = Math.floor(s / BUCKET);
    const list = b >= 0 ? this.buckets[b] : null;
    if (!list) return 0;
    let h = 0;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const du = u - f.u;
      const ds = s - f.s;
      const along = du * f.sin + ds * f.cos;
      if (along < f.a0 || along > f.a1) continue;
      const across = du * f.cos - ds * f.sin;
      const ac = Math.abs(across);
      if (f.type === 'bump') {
        const q = (across / f.rx) ** 2 + (along / f.rs) ** 2;
        if (q < 1) h += f.h * (1 - q) * (1 - q);
        continue;
      }
      if (ac > f.halfW + f.side) continue;
      const m = f.side > 0 ? smoothstep(f.halfW + f.side, f.halfW, ac) : 1;
      h += f.rel(along) * m;
    }
    return h;
  }

  height(x, z) {
    const s = -z;
    const u = x - this.center(s);
    return this.profile(s) + this.crossSection(u, s) + this.featureHeight(u, s);
  }

  // Unit surface normal at (x, z), written into out ({x,y,z}).
  normal(x, z, out) {
    const e = 0.06;
    const hx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    const hz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    const len = Math.hypot(hx, 1, hz);
    out.x = -hx / len;
    out.y = 1 / len;
    out.z = -hz / len;
    return out;
  }

  // 0..1: how deep the snow is here (powder slows you and you sink in).
  powder(x, z) {
    if (!this.park.powder) return 0;
    const s = -z;
    return this.park.powder(x - this.center(s), s, this);
  }

  // True on a kicker face, where an early pop is held until take-off.
  onKickerFace(x, z) {
    const s = -z;
    const pk = this.park.profileKicker;
    if (pk && s >= pk.faceS - 6 && s <= pk.lipS + 0.5) return true;
    const b = Math.floor(s / BUCKET);
    const list = b >= 0 ? this.buckets[b] : null;
    if (!list) return false;
    const u = x - this.center(s);
    for (const f of list) {
      if (!f.kicker) continue;
      const du = u - f.u;
      const ds = s - f.s;
      const along = du * f.sin + ds * f.cos;
      const across = du * f.cos - ds * f.sin;
      if (along > f.lipAlong - 12 && along < f.lipAlong + 0.3 && Math.abs(across) < f.halfW + 1) return true;
    }
    return false;
  }

  // Convert a feature-local (along, across) point to world x, z.
  featurePoint(f, along, across) {
    const u = f.u + along * f.sin + across * f.cos;
    const s = f.s + along * f.cos - across * f.sin;
    return { x: this.center(s) + u, z: -s, s, u };
  }

  // Lines of blue paint: kicker lips (and the pipe coping).
  lipLines() {
    const lines = [];
    const pk = this.park.profileKicker;
    if (pk) {
      const hw = this.cross.hw + 2;
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const u = -hw + (2 * hw * i) / 16;
        const s = pk.lipS - 0.35;
        pts.push([this.center(s) + u, -s]);
      }
      lines.push({ pts, width: 0.6 });
    }
    for (const f of this.features) {
      if (!f.kicker) continue;
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const across = -f.halfW + (2 * f.halfW * i) / 10;
        const p = this.featurePoint(f, f.lipAlong - 0.25, across);
        pts.push([p.x, p.z]);
      }
      lines.push({ pts, width: Math.min(0.5, f.lipAlong * 0.05) });
    }
    if (this.cross.type === 'pipe') {
      for (const side of [-1, 1]) {
        const pts = [];
        for (let s = this.park.startS; s <= this.park.endS; s += 4) {
          pts.push([this.center(s) + side * (this.cross.lipU + 0.25), -s]);
        }
        lines.push({ pts, width: 0.45, along: true });
      }
    }
    return lines;
  }

  // Rails become polylines of world points along their top.
  _buildRails(defs) {
    this.rails = [];
    this.railBuckets = [];
    defs.forEach((d, i) => {
      const kind = d.kind || 'rail';
      const u0 = d.u ?? 0;
      const len = d.len;
      const lipF = this.features.find((f) => f.railLip === i);
      const startH = d.h ?? (lipF ? lipF.lipH + 0.35 : 0.35);
      const endH = d.endH ?? (kind === 'box' && !lipF ? 0.35 : Math.min(startH, 1.1));
      const n = kind === 'rainbow' || kind === 'snake' ? 24 : kind === 'kink' ? 4 : kind === 'follow' ? Math.max(4, Math.ceil(len / 2)) : 2;
      const pts = [];
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        const s = d.s + t * len;
        let u = u0;
        if (kind === 'snake') u += 1.6 * Math.sin(t * Math.PI * 2);
        const x = this.center(s) + u;
        let y;
        if (kind === 'kink') {
          // flat - down - flat, following the snow at the kinks
          y = this.height(x, -s) + startH + (endH - startH) * t;
        } else if (kind === 'follow') {
          y = this.height(x, -s) + startH;
        } else {
          y = null; // straight between the end heights, filled in below
        }
        if (kind === 'rainbow') y = this.height(x, -s) + startH + (d.arc ?? 1.4) * Math.sin(Math.PI * t);
        pts.push({ x, y, z: -s, s });
      }
      if (pts[0].y === null) {
        const a = pts[0];
        const b = pts[pts.length - 1];
        const ya = this.height(a.x, a.z) + startH;
        const yb = this.height(b.x, b.z) + endH;
        pts.forEach((p, k) => (p.y = ya + ((yb - ya) * k) / (pts.length - 1)));
      }
      // Cumulative length.
      const cum = [0];
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1];
        const b = pts[k];
        cum.push(cum[k - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
      }
      const rail = { index: i, kind, pts, cum, length: cum[cum.length - 1], radius: kind === 'pipe' ? 0.35 : kind === 'box' ? 0.2 : 0.05, lip: lipF || null, def: d };
      this.rails.push(rail);
      for (let b = Math.floor((d.s - 2) / BUCKET); b <= Math.floor((d.s + len + 2) / BUCKET); b++) {
        if (b >= 0) (this.railBuckets[b] ||= []).push(rail);
      }
    });
  }

  railsNear(s) {
    const b = Math.floor(s / BUCKET);
    return b >= 0 ? this.railBuckets[b] || null : null;
  }

  // Point and unit direction on a rail at distance d along it.
  railPoint(rail, d, outPos, outDir) {
    d = Math.max(0, Math.min(rail.length, d));
    let k = 1;
    while (k < rail.cum.length - 1 && rail.cum[k] < d) k++;
    const a = rail.pts[k - 1];
    const b = rail.pts[k];
    const seg = rail.cum[k] - rail.cum[k - 1] || 1;
    const t = (d - rail.cum[k - 1]) / seg;
    outPos.x = a.x + (b.x - a.x) * t;
    outPos.y = a.y + (b.y - a.y) * t;
    outPos.z = a.z + (b.z - a.z) * t;
    if (outDir) {
      outDir.x = (b.x - a.x) / seg;
      outDir.y = (b.y - a.y) / seg;
      outDir.z = (b.z - a.z) / seg;
    }
    return outPos;
  }

  // Closest point on a rail to (x, z) in plan view: { d, dist, y }.
  railNearest(rail, x, z) {
    let best = null;
    for (let k = 1; k < rail.pts.length; k++) {
      const a = rail.pts[k - 1];
      const b = rail.pts[k];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l2 = dx * dx + dz * dz || 1;
      let t = ((x - a.x) * dx + (z - a.z) * dz) / l2;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      const dist = Math.hypot(x - px, z - pz);
      if (!best || dist < best.dist) {
        best = { d: rail.cum[k - 1] + (rail.cum[k] - rail.cum[k - 1]) * t, dist, y: a.y + (b.y - a.y) * t, t, k };
      }
    }
    return best;
  }

  // The rail whose lip face you're on, if any.
  railLipAt(x, z) {
    const s = -z;
    const b = Math.floor(s / BUCKET);
    const list = b >= 0 ? this.buckets[b] : null;
    if (!list) return null;
    const u = x - this.center(s);
    for (const f of list) {
      if (f.railLip === undefined) continue;
      const along = (u - f.u) * f.sin + (s - f.s) * f.cos;
      const across = (u - f.u) * f.cos - (s - f.s) * f.sin;
      if (along > -4 && along < f.lipAlong + 0.2 && Math.abs(across) < 3) return { rail: this.rails[f.railLip], across };
    }
    return null;
  }

  _buildTrees() {
    const park = this.park;
    const spec = park.trees || {};
    const rnd = mulberry32(spec.seed ?? 1234);
    const spacing = spec.spacing ?? 3.4;
    const perRow = spec.perRow ?? 2;
    const maxU = spec.maxU ?? this.cross.hw + 45;
    const minU = spec.minU ?? this.cross.hw + 5;
    const allowed = spec.allowed || (() => true);
    const trees = [];
    for (let s = -40; s < park.endS + 50; s += spacing) {
      for (let k = 0; k < perRow * 2; k++) {
        const side = k % 2 ? 1 : -1;
        const u = side * (minU + rnd() * (maxU - minU));
        const ss = s + rnd() * spacing;
        const scale = 0.7 + rnd() * 0.8;
        const rot = rnd() * 6.283;
        if (!allowed(u, ss, this)) continue;
        trees.push({ x: this.center(ss) + u, s: ss, u, scale, rot });
      }
    }
    for (const t of spec.extra || []) trees.push({ ...t, x: this.center(t.s) + t.u, scale: t.scale ?? 1, rot: 0 });
    this.trees = trees;
    // Bucket trees for collision checks.
    this.treeBuckets = [];
    for (const t of trees) {
      const b = Math.floor(t.s / 10);
      if (b >= 0) (this.treeBuckets[b] ||= []).push(t);
    }
  }

  _buildObstacles() {
    this.obstacles = [];
    for (const o of this.park.obstacles || []) {
      const x = this.center(o.s) + (o.u ?? 0);
      const z = -o.s;
      if (o.type === 'ball') {
        const y = this.height(x, z) + o.r * 0.8;
        this.obstacles.push({ ...o, x, y, z });
      } else if (o.type === 'house') {
        const y = this.height(x, z);
        this.obstacles.push({ ...o, x, y, z, minX: x - o.w / 2, maxX: x + o.w / 2, minZ: z - o.l / 2, maxZ: z + o.l / 2 });
      }
    }
  }

  // Trees near (x, s) for collision.
  treesNear(s) {
    const b = Math.floor(s / 10);
    return [this.treeBuckets[b - 1], this.treeBuckets[b], this.treeBuckets[b + 1]];
  }
}
