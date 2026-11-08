// Builds a park scene from simple shapes: snow, features, forest, gates, lift, sky.
import * as THREE from 'three';
import { mulberry32 } from '../sim/rng.js';
import { Sky } from './sky.js';
import { buildLift } from './lift.js';

export const BLUE = 0x1e7bff;
const CHUNK = 120; // terrain chunk length along s (m)

let _cordTex = null;
function corduroyTexture() {
  if (_cordTex) return _cordTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 4) {
    g.fillStyle = y % 8 === 0 ? 'rgba(170,190,215,0.35)' : 'rgba(255,255,255,0.0)';
    g.fillRect(0, y, 64, 2);
  }
  const rnd = mulberry32(7);
  for (let i = 0; i < 500; i++) {
    g.fillStyle = `rgba(160,180,210,${0.08 + rnd() * 0.1})`;
    g.fillRect(rnd() * 64, rnd() * 256, 1 + rnd() * 2, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _cordTex = tex;
  return tex;
}

export function textTexture(text, { w = 1024, h = 128, bg = '#1e7bff', fg = '#ffffff', font = 'italic 900 88px Impact, "Arial Black", sans-serif' } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function crossExtent(terrain) {
  const c = terrain.cross;
  if (c.type === 'powder') return c.rockStart + 30;
  if (c.type === 'street') return c.hw + c.curb + c.walk + 50;
  return c.hw + 60;
}

// Rows along the run: regular steps plus fine rows around feature edges.
function terrainRows(terrain, step) {
  const park = terrain.park;
  const set = new Set();
  const s0 = -40;
  const s1 = park.endS + 40;
  for (let s = s0; s <= s1; s += step) set.add(+s.toFixed(3));
  const fine = (a, b, st) => {
    for (let s = a; s <= b; s += st) set.add(+s.toFixed(3));
  };
  for (const [s] of park.slopePoints) fine(s - 1, s + 1, 0.25);
  if (park.profileKicker) fine(park.profileKicker.faceS, park.profileKicker.lipS + 5, 0.25);
  for (const f of terrain.features) {
    if (f.visualOnly) continue;
    if (f.kicker) {
      fine(f.s - 1, f.s + f.lipAlong + 3, Math.min(step, 0.4));
      fine(f.s + f.lipAlong + 3, f.s + f.len, Math.min(step, 1));
    } else if (f.type === 'block' || f.type === 'cliff') {
      fine(f.s + f.a0 - 1, f.s + f.a1 + 1, Math.min(step, 0.5));
    } else {
      fine(f.s + f.a0, f.s + f.a1, Math.min(step, 1));
    }
  }
  return [...set].filter((s) => s >= s0 && s <= s1).sort((a, b) => a - b);
}

function terrainCols(terrain, perf) {
  const c = terrain.cross;
  const max = crossExtent(terrain);
  const inner = c.type === 'pipe' ? c.hw + 1 : c.type === 'street' ? c.hw + c.curb + c.walk + 2 : c.hw + 6;
  const fine = c.type === 'pipe' ? (perf ? 0.75 : 0.5) : perf ? 1.5 : 1;
  const coarse = perf ? 4 : 3;
  const cols = new Set();
  for (let u = -inner; u <= inner + 1e-6; u += fine) cols.add(+u.toFixed(3));
  for (let u = inner; u <= max; u += coarse) {
    cols.add(+u.toFixed(3));
    cols.add(-u.toFixed(3));
  }
  if (c.type === 'pipe') {
    for (const sgn of [-1, 1]) for (const d of [-0.15, -0.05, 0, 0.1]) cols.add(+(sgn * (c.lipU + d)).toFixed(3));
  }
  return [...cols].sort((a, b) => a - b);
}

function buildTerrain(terrain, group, quality) {
  const perf = quality === 'performance';
  const rows = terrainRows(terrain, perf ? 2 : quality === 'ultra' ? 1 : 1.25);
  const cols = terrainCols(terrain, perf);
  const W = cols.length;
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, map: corduroyTexture() });
  const c = new THREE.Color();
  const n = { x: 0, y: 1, z: 0 };
  const isPipe = terrain.cross.type === 'pipe';
  const pipeU = isPipe ? terrain.cross.lipU + 0.2 : 0;

  let start = 0;
  while (start < rows.length - 1) {
    let end = start;
    while (end < rows.length - 1 && rows[end] - rows[start] < CHUNK) end++;
    const R = end - start + 1;
    const pos = new Float32Array(R * W * 3);
    const uv = new Float32Array(R * W * 2);
    const col = new Float32Array(R * W * 3);
    let k = 0;
    for (let i = start; i <= end; i++) {
      const s = rows[i];
      const cx = terrain.center(s);
      for (let j = 0; j < W; j++) {
        const u = cols[j];
        const x = cx + u;
        const y = terrain.height(x, -s);
        pos[k * 3] = x;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = -s;
        uv[k * 2] = u / 6;
        uv[k * 2 + 1] = s / 6;
        terrain.normal(x, -s, n);
        const pw = terrain.powder(x, -s);
        const steep = n.y < 0.55 && !(isPipe && Math.abs(u) < pipeU);
        if (steep) c.setRGB(0.32, 0.33, 0.36);
        else if (pw > 0.5) c.setRGB(0.93, 0.96, 1.0);
        else {
          const bank = Math.min(1, Math.max(0, (Math.abs(u) - terrain.cross.hw) / 14));
          c.setRGB(1 - bank * 0.1, 1 - bank * 0.06, 1);
        }
        col[k * 3] = c.r;
        col[k * 3 + 1] = c.g;
        col[k * 3 + 2] = c.b;
        k++;
      }
    }
    const idx = [];
    for (let i = 0; i < R - 1; i++) {
      for (let j = 0; j < W - 1; j++) {
        const a = i * W + j;
        const b = a + 1;
        const d = a + W;
        const e = d + 1;
        idx.push(a, b, d, b, e, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = !perf;
    group.add(mesh);
    start = end;
  }
}

// A ribbon of paint lying on the snow along a polyline of [x, z] points.
function paintRibbon(terrain, pts, width, color = BLUE) {
  const pos = [];
  const idx = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i];
    const [x0, z0] = pts[Math.max(0, i - 1)];
    const [x1, z1] = pts[Math.min(pts.length - 1, i + 1)];
    let dx = x1 - x0;
    let dz = z1 - z0;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    // perpendicular in the ground plane
    const px = -dz * (width / 2);
    const pz = dx * (width / 2);
    for (const sgn of [-1, 1]) {
      const xx = x + px * sgn;
      const zz = z + pz * sgn;
      pos.push(xx, terrain.height(xx, zz) + 0.05, zz);
    }
    if (i < pts.length - 1) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
}

function lineAcross(terrain, s, halfW) {
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const u = -halfW + (2 * halfW * i) / 16;
    pts.push([terrain.center(s) + u, -s]);
  }
  return pts;
}

function buildPaint(terrain, group) {
  for (const line of terrain.lipLines()) {
    // Lines across the run are drawn as ribbons across; their polyline runs across.
    group.add(paintRibbon(terrain, line.pts, line.width));
  }
  const pk = terrain.park.profileKicker;
  if (pk) {
    group.add(paintRibbon(terrain, lineAcross(terrain, pk.faceS + 2, terrain.cross.hw + 2), 0.25));
    group.add(paintRibbon(terrain, lineAcross(terrain, pk.knuckleS, terrain.cross.hw + 2), 0.35));
  }
  // Blue edges up the sides of each kicker face so they read at speed.
  for (const f of terrain.features) {
    if (!f.kicker) continue;
    for (const sgn of [-1, 1]) {
      const pts = [];
      for (let a = 0; a <= f.lipAlong; a += f.lipAlong / 8) {
        const p = terrain.featurePoint(f, a, sgn * (f.halfW - 0.15));
        pts.push([p.x, p.z]);
      }
      group.add(paintRibbon(terrain, pts, 0.3));
    }
  }
}

function buildTrees(terrain, group, quality) {
  const trees = terrain.trees;
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6);
  trunkGeo.translate(0, 1.2, 0);
  const leafGeo = new THREE.ConeGeometry(2.6, 7.5, 7);
  leafGeo.translate(0, 6, 0);
  const leafGeo2 = new THREE.ConeGeometry(1.9, 5, 7);
  leafGeo2.translate(0, 9.2, 0);
  const mats = [new THREE.MeshLambertMaterial({ color: 0x5a3b26 }), new THREE.MeshLambertMaterial({ color: 0x1f5a3a }), new THREE.MeshLambertMaterial({ color: 0x2c7048 })];
  const geos = [trunkGeo, leafGeo, leafGeo2];
  // One instanced batch per 200 m so far forest can be culled.
  const byChunk = new Map();
  for (const t of trees) {
    const key = Math.floor(t.s / 200);
    if (!byChunk.has(key)) byChunk.set(key, []);
    byChunk.get(key).push(t);
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const p = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const chunks = [];
  for (const [key, list] of byChunk) {
    const g = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const im = new THREE.InstancedMesh(geos[k], mats[k], list.length);
      list.forEach((t, i) => {
        p.set(t.x, terrain.height(t.x, -t.s) - 0.2, -t.s);
        q.setFromAxisAngle(yAxis, t.rot);
        sc.set(t.scale, t.scale, t.scale);
        m.compose(p, q, sc);
        im.setMatrixAt(i, m);
      });
      im.castShadow = quality === 'ultra';
      im.computeBoundingSphere();
      g.add(im);
    }
    g.userData.s = key * 200 + 100;
    group.add(g);
    chunks.push(g);
  }
  return chunks;
}

function buildMountains(terrain, group) {
  const rnd = mulberry32(99);
  const mat = new THREE.MeshLambertMaterial({ color: 0xdfe9f5, flatShading: true });
  const rock = new THREE.MeshLambertMaterial({ color: 0x7d8ea3, flatShading: true });
  const park = terrain.park;
  const base = terrain.profile(park.endS);
  const top = terrain.profile(0);
  const cz = -park.endS / 2;
  const R = Math.max(1300, park.endS * 0.75);
  for (let i = 0; i < 30; i++) {
    const ang = (i / 30) * Math.PI * 2;
    const r = R + rnd() * 500;
    const h = (top - base) * 0.6 + 350 + rnd() * 500;
    const m = new THREE.Mesh(new THREE.ConeGeometry(220 + rnd() * 260, h, 5 + Math.floor(rnd() * 3)), rnd() > 0.3 ? mat : rock);
    m.position.set(Math.cos(ang) * r, base - 100 + h / 2, cz + Math.sin(ang) * r);
    m.rotation.y = rnd() * 3;
    group.add(m);
  }
}

function post(group, x, y, z, h, color, r = 0.12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 8), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  group.add(m);
  return m;
}

function banner(group, text, x, y, z, w, h, opts, rotY = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: textTexture(text, opts), side: THREE.DoubleSide }));
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  group.add(m);
  return m;
}

function netTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(30,123,255,0.9)';
  g.lineWidth = 3;
  for (let i = 0; i <= 64; i += 16) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 64);
    g.moveTo(0, i);
    g.lineTo(64, i);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function courseYaw(terrain, s) {
  // Rotation about y so a plane faces up the course at s.
  return Math.atan2(terrain.centerSlope(s), 1);
}

function buildGates(terrain, group) {
  const park = terrain.park;
  const hw = terrain.cross.type === 'pipe' ? terrain.cross.floor + 2 : Math.min(terrain.cross.hw, 22);
  // Start gate: posts and a banner just below the start, plus a start hut.
  const s0 = park.startS + 5;
  const c0 = terrain.center(s0);
  const y0 = terrain.height(c0, -s0);
  const rot0 = courseYaw(terrain, s0);
  post(group, c0 - 5, y0, -s0, 5.4, 0xffffff, 0.18);
  post(group, c0 + 5, y0, -s0, 5.4, 0xffffff, 0.18);
  banner(group, `CRANSKI · ${park.name}`, c0, y0 + 5.2, -s0, 10.4, 1.3, undefined, rot0);
  const hut = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 3), new THREE.MeshLambertMaterial({ color: 0xd0473a }));
  hut.position.set(c0 - 9, terrain.height(c0 - 9, -s0 + 8) + 1.5, -s0 + 8);
  hut.castShadow = true;
  group.add(hut);

  // Finish line: blue line, tall side markers, netting and a banner.
  const sf = park.finishS;
  const cf = terrain.center(sf);
  const yf = terrain.height(cf, -sf);
  const rotF = courseYaw(terrain, sf);
  group.add(paintRibbon(terrain, lineAcross(terrain, sf, hw), 0.8));
  const net = netTexture();
  for (const side of [-1, 1]) {
    const x = cf + side * (hw - 0.5);
    post(group, x, terrain.height(x, -sf), -sf, 9, BLUE, 0.3);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(40, 3), new THREE.MeshBasicMaterial({ map: net, transparent: true, side: THREE.DoubleSide }));
    m.material.map.repeat.set(20, 1.5);
    m.rotation.y = Math.PI / 2;
    const zn = -(sf + 20);
    const xn = terrain.center(sf + 20) + side * (hw + 1);
    m.position.set(xn, terrain.height(xn, zn) + 1.5, zn);
    group.add(m);
  }
  banner(group, 'FINISH', cf, yf + 8, -sf, hw * 2 - 1, 2.4, undefined, rotF);
}

function buildObstacles(terrain, group, sky) {
  const night = sky.mode === 'aurora';
  const roofMats = new Map();
  for (const o of terrain.obstacles) {
    if (o.type === 'ball') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(o.r, 28, 20), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.25, metalness: 0.6 }));
      m.position.set(o.x, o.y, o.z);
      m.castShadow = true;
      group.add(m);
    } else if (o.type === 'house') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.l), new THREE.MeshLambertMaterial({ color: o.color }));
      body.position.set(o.x, o.y + o.h / 2 - 0.5, o.z);
      body.castShadow = true;
      group.add(body);
      if (!roofMats.has(o.roof)) roofMats.set(o.roof, new THREE.MeshLambertMaterial({ color: o.roof }));
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, o.w * 0.75, o.l + 1, 3, 1), roofMats.get(o.roof));
      roof.rotation.x = Math.PI / 2;
      roof.scale.set(1, 1, 0.55);
      roof.position.set(o.x, o.y + o.h - 0.5 + o.w * 0.2, o.z);
      group.add(roof);
      // Snow on the roof and lit windows.
      const win = new THREE.MeshBasicMaterial({ color: night ? 0xffd27a : 0x9fc4e8 });
      for (let k = 0; k < 2; k++) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), win);
        const side = Math.sign(-(o.x - terrain.center(-o.z))) || 1;
        w.position.set(o.x + side * (o.w / 2 + 0.02), o.y + o.h * 0.55, o.z + (k ? 2.5 : -2.5));
        w.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        group.add(w);
      }
    }
  }
}

function buildStairs(terrain, group) {
  const mat = new THREE.MeshLambertMaterial({ color: 0x9a9fa6 });
  for (const f of terrain.features) {
    if (f.type !== 'stairs') continue;
    const n = Math.floor(f.len / 0.6);
    const geo = new THREE.BoxGeometry(f.width, 0.3, 0.6);
    const im = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const s = f.s + i * 0.6 + 0.3;
      const x = terrain.center(s) + f.u;
      m.makeTranslation(x, terrain.height(x, -s) - 0.08, -s);
      im.setMatrixAt(i, m);
    }
    im.receiveShadow = true;
    group.add(im);
  }
}

function buildBoards(terrain, group) {
  const b = terrain.park.boards;
  if (!b) return;
  for (let d = b.start; d <= b.end; d += b.every) {
    const s = b.from + d;
    for (const side of [-1, 1]) {
      const x = terrain.center(s) + side * (terrain.cross.hw + 2.5);
      const y = terrain.height(x, -s);
      banner(group, `${d} m`, x, y + 1.4, -s, 3, 0.9, { w: 256, h: 80, font: 'italic 900 56px Impact, sans-serif', bg: d === b.highlight ? '#ff5a36' : '#1e7bff' }, (side * -Math.PI) / 2);
      post(group, x, y, -s, 0.9, 0x223344, 0.05);
    }
  }
}

function buildNamedSigns(terrain, group) {
  for (const f of terrain.features) {
    if (!f.kicker || !f.name || f.name === 'hip') continue;
    const p = terrain.featurePoint(f, f.lipAlong - 6, f.halfW + 3.5);
    const y = terrain.height(p.x, p.z);
    post(group, p.x, y, p.z, 3.2, 0x223344, 0.08);
    banner(group, f.name, p.x, y + 3.6, p.z, 5, 1, { w: 512, h: 100, font: 'italic 900 72px Impact, sans-serif' });
  }
}

function buildFloodlights(terrain, group) {
  const poles = [];
  const lampMat = new THREE.MeshBasicMaterial({ color: 0x555555 });
  for (let s = 40; s < terrain.park.endS; s += 90) {
    for (const side of [-1, 1]) {
      const x = terrain.center(s) + side * (terrain.cross.hw + 3);
      const y = terrain.height(x, -s);
      post(group, x, y, -s, 14, 0x3a3f46, 0.18);
      const head = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 1), lampMat);
      head.position.set(x - side * 0.8, y + 14, -s);
      group.add(head);
      poles.push(head);
    }
  }
  return lampMat;
}

export function buildWorld(terrain, { quality = 'high' } = {}) {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);

  const hemi = new THREE.HemisphereLight(0xdcecff, 0x8a9bb0, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.0);
  sun.position.set(-40, 80, 30);
  sun.castShadow = quality !== 'performance';
  sun.shadow.mapSize.set(quality === 'ultra' ? 2048 : 1024, quality === 'ultra' ? 2048 : 1024);
  const sc = sun.shadow.camera;
  sc.left = -30;
  sc.right = 30;
  sc.top = 30;
  sc.bottom = -30;
  sc.near = 1;
  sc.far = 250;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  scene.add(sun.target);

  const park = terrain.park;
  const sky = new Sky(scene, park.sky || 'day', { hemi, sun });

  buildMountains(terrain, group);
  buildTerrain(terrain, group, quality);
  buildPaint(terrain, group);
  const treeChunks = buildTrees(terrain, group, quality);
  buildGates(terrain, group);
  buildObstacles(terrain, group, sky);
  buildStairs(terrain, group);
  buildBoards(terrain, group);
  buildNamedSigns(terrain, group);
  const lampMat = park.floodlights ? buildFloodlights(terrain, group) : null;
  const lift = buildLift(terrain, scene);

  // Floodlit nights: a warm light that follows the rider.
  const flood = new THREE.PointLight(0xffc98a, 0, 90, 1.2);
  scene.add(flood);

  const drawDist = quality === 'performance' ? 450 : quality === 'ultra' ? 1100 : 800;
  const sunOffset = sun.position.clone();
  const _v = new THREE.Vector3();

  function update(time, rider, camera) {
    const s = -rider.z;
    const progress = (s - park.startS) / (park.finishS - park.startS);
    sky.update(time, progress, camera.position);
    lift.update(time);
    sun.target.position.copy(rider);
    sun.position.copy(rider).add(sunOffset);
    if (lampMat) {
      const on = sky.night > 0.5;
      lampMat.color.setHex(on ? 0xfff2c4 : 0x555555);
      flood.intensity = on ? 220 * sky.night : 0;
      flood.position.copy(rider).add(_v.set(0, 14, 6));
    }
    const camS = -camera.position.z;
    for (const g of treeChunks) g.visible = Math.abs(g.userData.s - camS) < drawDist;
  }

  function dispose() {
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.map && m.map !== _cordTex) m.map.dispose();
          m.dispose();
        }
      }
    });
  }

  return { scene, update, dispose, lift, sky, fogFar: drawDist };
}
