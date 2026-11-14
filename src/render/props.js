// Park props from public/models/props.glb (made by tools/blender/build_props.py):
// chalets, floodlight masts, rail legs and pads, and the start and finish areas
// (groomer, ski rack, snowman, event tent, speakers, flags and safety fence).
// Everything here is decoration: the simulation never sees it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ASSETS, partMaterials } from './assets.js';

// One set of materials for every prop, shared across parks (never disposed).
let MATS = null;
function mats() {
  if (MATS) return MATS;
  const std = (color, rough = 0.8, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  MATS = {
    wall: std(0xc98b5a, 0.9),
    roof: std(0x8c2f2f),
    wood: std(0x8a5a36, 0.9),
    woodDark: std(0x4e3220, 0.9),
    stone: std(0x8d8a86, 0.95),
    snow: std(0xf4f7fb, 0.9),
    glass: std(0xbfd8ee, 0.15, 0.2),
    steel: std(0xc9d0d8, 0.3, 0.8),
    dark: std(0x2b2f36, 0.6, 0.3),
    rubber: std(0x16181b, 0.95),
    lamp: new THREE.MeshBasicMaterial({ color: 0x555555 }),
    catBody: std(0xd9362b, 0.5),
    catTrim: std(0xf2f2f2, 0.5),
    brand: std(0x1e7bff, 0.6),
    orange: std(0xff6a1a, 0.7),
    white: std(0xf7f9fc, 0.6),
    carrot: std(0xf07a20, 0.7),
    skiA: std(0xffd23f, 0.4),
    skiB: std(0x22b07d, 0.4),
    skiC: std(0xe0406b, 0.4),
  };
  for (const m of Object.values(MATS)) m.userData.shared = true;
  return MATS;
}

// ---- static batching: many placed props merged into one vertex-coloured mesh
// (one draw call however many there are). Colours come from the prop's own
// materials unless overridden by name.
const _colors = () => Object.fromEntries(Object.entries(mats()).map(([k, m]) => [k, m.color.getHex()]));
export class Batch {
  constructor() {
    this.geos = [];
  }
  // A placed copy of a prop. keep(name) picks which materials to include.
  add(name, matrix, colorOver = {}, keep = () => true) {
    const part = ASSETS.parts[name];
    if (!part) return this;
    const src = part.geometry;
    const g = src.index ? src.toNonIndexed() : src.clone();
    const n = g.attributes.position.count;
    const colors = { ..._colors(), ...colorOver };
    const groups = src.groups.length ? src.groups : [{ start: 0, count: n, materialIndex: 0 }];
    const pos = [];
    const nor = [];
    const col = [];
    const c = new THREE.Color();
    const P = g.attributes.position.array;
    const N = g.attributes.normal.array;
    for (const grp of groups) {
      const mname = part.mats[grp.materialIndex];
      if (!keep(mname)) continue;
      c.setHex(colors[mname] ?? 0x888888);
      for (let i = grp.start; i < Math.min(n, grp.start + grp.count); i++) {
        pos.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        nor.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
        col.push(c.r, c.g, c.b);
      }
    }
    g.dispose();
    if (!pos.length) return this;
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    out.applyMatrix4(matrix);
    this.geos.push(out);
    return this;
  }
  // A plain geometry (positions + normals, and uvs if keepUv), all one colour.
  addGeometry(geo, matrix, hex, keepUv = false) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && !(keepUv && k === 'uv')) g.deleteAttribute(k);
    const n = g.attributes.position.count;
    const c = new THREE.Color(hex);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.applyMatrix4(matrix);
    this.geos.push(g);
    return this;
  }
  mesh(material) {
    if (!this.geos.length) return null;
    const g = mergeGeometries(this.geos);
    for (const x of this.geos) x.dispose();
    this.geos = [];
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

// The vertex-colour materials batches use (shared, never disposed).
let _batchMats = null;
export function batchMaterial(perf) {
  if (!_batchMats) {
    _batchMats = {
      std: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 }),
      lam: new THREE.MeshLambertMaterial({ vertexColors: true }),
    };
    _batchMats.std.userData.shared = _batchMats.lam.userData.shared = true;
  }
  return perf ? _batchMats.lam : _batchMats.std;
}

const _m4 = new THREE.Matrix4();
const _q4 = new THREE.Quaternion();
const _e4 = new THREE.Euler();
export function placeMatrix(x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) {
  return _m4.compose(new THREE.Vector3(x, y, z), _q4.setFromEuler(_e4.set(0, ry, 0)), new THREE.Vector3(sx, sy, sz)).clone();
}

export function propsReady() {
  return !!(ASSETS.ready && ASSETS.parts.chalet);
}

// A mesh of one prop (materials can be overridden by name).
export function prop(name, over = {}) {
  const part = ASSETS.parts[name];
  if (!part) return null;
  const M = { ...mats(), ...over };
  const m = new THREE.Mesh(part.geometry, partMaterials(part, M, M.dark));
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.shared = true; // geometry and materials belong to the asset set
  return m;
}

// Many copies of one prop: [{ x, y, z, ry, sx, sy, sz }].
export function props(name, list) {
  const part = ASSETS.parts[name];
  if (!part || !list.length) return null;
  const M = mats();
  const im = new THREE.InstancedMesh(part.geometry, partMaterials(part, M, M.dark), list.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  list.forEach((o, i) => {
    q.setFromEuler(e.set(0, o.ry || 0, 0));
    m4.compose(p.set(o.x, o.y, o.z), q, s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1));
    im.setMatrixAt(i, m4);
  });
  im.castShadow = true;
  im.receiveShadow = true;
  im.userData.shared = true;
  return im;
}

// The lamp material, switched on at night by the world.
export function lampMaterial() {
  return mats().lamp;
}

// Start area: the groomer parked beside the hut, a ski rack, a snowman and flags
// (all merged into one mesh).
export function startArea(terrain, group, s0, c0, rot, perf = false) {
  const at = (dx, dz) => {
    const x = c0 + dx;
    const z = -s0 + dz;
    return { x, y: terrain.height(x, z), z };
  };
  const b = new Batch();
  const place = (name, p, ry, dy = -0.05) => b.add(name, placeMatrix(p.x, p.y + dy, p.z, ry));
  const hw = Math.min(terrain.cross.hw ?? 12, 22);
  place('snowcat', at(hw + 7, 6), rot + 0.5);
  place('skiRack', at(-hw + 1, 3), rot + Math.PI / 2);
  place('snowman', at(-hw - 2, -4), rot + 0.4);
  for (const p of [at(-6.5, 1.5), at(6.5, 1.5)]) place('flag', p, rot, 0);
  const m = b.mesh(batchMaterial(perf));
  if (m) {
    m.name = 'startArea';
    group.add(m);
  }
}

// Finish area: tent and speakers off to one side, flags and safety fence along
// the run-out (all merged into one mesh).
export function finishArea(terrain, group, sf, hw, perf = false) {
  const cAt = (s) => terrain.center(s);
  const pt = (s, u) => {
    const x = cAt(s) + u;
    return { x, y: terrain.height(x, -s), z: -s };
  };
  const yaw = (s) => Math.atan2(cAt(s + 1) - cAt(s - 1), 2);
  const b = new Batch();
  const place = (name, p, ry) => b.add(name, placeMatrix(p.x, p.y, p.z, ry));
  place('tent', pt(sf + 14, hw + 6), yaw(sf + 14));
  place('speakers', pt(sf + 22, hw + 6), yaw(sf + 22) + Math.PI / 2);
  for (const side of [-1, 1]) for (const d of [-8, 4]) place('flag', pt(sf + d, side * (hw + 1.5)), yaw(sf + d));
  // Fence sections either side of the run-out.
  for (const side of [-1, 1]) {
    for (let d = 6; d <= 46; d += 4) place('fence', pt(sf + d, side * (hw + 0.5)), Math.PI / 2 + yaw(sf + d));
  }
  const m = b.mesh(batchMaterial(perf));
  if (m) {
    m.name = 'finishArea';
    group.add(m);
  }
}
