// Park props from public/models/props.glb (made by tools/blender/build_props.py):
// chalets, floodlight masts, rail legs and pads, and the start and finish areas
// (groomer, ski rack, snowman, event tent, speakers, flags and safety fence).
// Everything here is decoration: the simulation never sees it.
import * as THREE from 'three';
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

// A chalet sized to a house obstacle (w across, h to the eaves, l along the run).
export function chalet(o, colorMats) {
  const m = prop('chalet', colorMats);
  if (!m) return null;
  m.scale.set(o.w / 8, o.h / 4.5, o.l / 10);
  m.position.set(o.x, o.y - 0.5, o.z);
  return m;
}

const _house = new Map();
export function houseMaterials(color, roof) {
  const key = `${color}:${roof}`;
  if (!_house.has(key)) {
    const wall = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    const r = new THREE.MeshStandardMaterial({ color: roof, roughness: 0.8 });
    const lit = new THREE.MeshBasicMaterial({ color: 0xffd27a }); // windows at night
    wall.userData.shared = r.userData.shared = lit.userData.shared = true;
    _house.set(key, { wall, roof: r, lit });
  }
  return _house.get(key);
}

// Start area: the groomer parked beside the hut, a ski rack, a snowman and flags.
export function startArea(terrain, group, s0, c0, rot) {
  const at = (dx, dz) => {
    const x = c0 + dx;
    const z = -s0 + dz;
    return { x, y: terrain.height(x, z), z };
  };
  const place = (m, p, ry) => {
    if (!m) return;
    m.position.set(p.x, p.y - 0.05, p.z);
    m.rotation.y = ry;
    group.add(m);
  };
  const hw = Math.min(terrain.cross.hw ?? 12, 22);
  place(prop('snowcat'), at(hw + 7, 6), rot + 0.5);
  place(prop('skiRack'), at(-hw + 1, 3), rot + Math.PI / 2);
  place(prop('snowman'), at(-hw - 2, -4), rot + 0.4);
  const flags = [at(-6.5, 1.5), at(6.5, 1.5)].map((p) => ({ ...p, ry: rot }));
  const f = props('flag', flags);
  if (f) group.add(f);
}

// Finish area: tent and speakers off to one side, flags and safety fence along the run-out.
export function finishArea(terrain, group, sf, hw) {
  const cAt = (s) => terrain.center(s);
  const pt = (s, u) => {
    const x = cAt(s) + u;
    return { x, y: terrain.height(x, -s), z: -s };
  };
  const yaw = (s) => Math.atan2(cAt(s + 1) - cAt(s - 1), 2);
  const t = pt(sf + 14, hw + 6);
  const tent = prop('tent');
  if (tent) {
    tent.position.set(t.x, t.y, t.z);
    tent.rotation.y = yaw(sf + 14);
    group.add(tent);
  }
  const sp = pt(sf + 22, hw + 6);
  const spk = prop('speakers');
  if (spk) {
    spk.position.set(sp.x, sp.y, sp.z);
    spk.rotation.y = yaw(sf + 22) + Math.PI / 2;
    group.add(spk);
  }
  const flags = [];
  for (const side of [-1, 1]) for (const d of [-8, 4]) flags.push({ ...pt(sf + d, side * (hw + 1.5)), ry: yaw(sf + d) });
  const f = props('flag', flags);
  if (f) group.add(f);
  // Fence sections either side of the run-out.
  const fence = [];
  for (const side of [-1, 1]) {
    for (let d = 6; d <= 46; d += 4) {
      const p = pt(sf + d, side * (hw + 0.5));
      fence.push({ ...p, ry: Math.PI / 2 + yaw(sf + d) });
    }
  }
  const fm = props('fence', fence);
  if (fm) group.add(fm);
}
