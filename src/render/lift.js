// Lifts: gondola, ropeway or T-bar from the finish area back up to the start gate.
// Provides moving cabins for the scenery and a path for the lift ride.
import * as THREE from 'three';

const KIND = {
  gondola: { spacing: 140, towerH: 15, hang: 3.2, cabinGap: 70, speed: 6, duration: 14 },
  ropeway: { spacing: 420, towerH: 40, hang: 5, cabinGap: 0, speed: 10, duration: 14 },
  tbar: { spacing: 45, towerH: 6.5, hang: 0, cabinGap: 18, speed: 3.5, duration: 12 },
};

class Polyline {
  constructor(points) {
    this.points = points;
    this.cum = [0];
    for (let i = 1; i < points.length; i++) this.cum.push(this.cum[i - 1] + points[i].distanceTo(points[i - 1]));
    this.length = this.cum[this.cum.length - 1];
  }
  sample(d, outPos, outDir) {
    d = Math.max(0, Math.min(this.length, d));
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < d) i++;
    const a = this.points[i - 1];
    const b = this.points[i];
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const t = (d - this.cum[i - 1]) / seg;
    outPos.lerpVectors(a, b, t);
    if (outDir) outDir.subVectors(b, a).normalize();
    return outPos;
  }
}

export function buildLift(terrain, scene) {
  const park = terrain.park;
  const spec = park.lift || { type: 'gondola', side: 1, offset: 30 };
  const k = KIND[spec.type];
  const cross = terrain.cross;
  const sBottom = park.finishS + 30;
  const sTop = Math.max(-6, park.startS - 14);

  const baseU = cross.type === 'pipe' ? cross.lipU : cross.type === 'street' ? cross.hw + cross.curb + cross.walk : cross.hw;
  const xAt = (s, extra = 0) => {
    if (spec.worldX !== undefined) return spec.worldX + extra;
    const side = spec.side ?? 1;
    return terrain.center(s) + side * (baseU + (spec.offset ?? 30) + extra);
  };

  // Tower positions along s, bottom to top.
  const towers = [];
  const n = Math.max(2, Math.ceil((sBottom - sTop) / k.spacing));
  for (let i = 0; i <= n; i++) {
    const s = sBottom + ((sTop - sBottom) * i) / n;
    const x = xAt(s);
    const g = terrain.height(x, -s);
    towers.push({ s, x, g });
  }

  const group = new THREE.Group();
  const steel = new THREE.MeshLambertMaterial({ color: 0x5b6670 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2b3138 });
  const side = spec.side ?? 1;

  // Cable lines (up and down), hung from tower tops.
  const up = [];
  const down = [];
  for (const t of towers) {
    up.push(new THREE.Vector3(t.x, t.g + k.towerH, -t.s));
    down.push(new THREE.Vector3(t.x + side * 4, t.g + k.towerH, -t.s));
  }
  // T-bars ride on the snow: the rider's path is the ground under the up-cable.
  for (const t of towers) {
    const h = k.towerH;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, h, 8), steel);
    pole.position.set(t.x + side * 2, t.g + h / 2, -t.s);
    pole.castShadow = true;
    group.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(6, 0.4, 0.5), dark);
    arm.position.set(t.x + side * 2, t.g + h, -t.s);
    group.add(arm);
  }
  for (const line of [up, down]) {
    const geo = new THREE.BufferGeometry().setFromPoints(line);
    group.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x222222 })));
  }

  // Stations.
  for (const t of [towers[0], towers[towers.length - 1]]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(12, k.towerH * 0.6 + 4, 10), new THREE.MeshLambertMaterial({ color: 0x9aa7b4 }));
    st.position.set(t.x + side * 2, t.g + (k.towerH * 0.6 + 4) / 2, -t.s);
    st.castShadow = true;
    group.add(st);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(13, 0.6, 11), new THREE.MeshLambertMaterial({ color: 0x1e7bff }));
    roof.position.set(t.x + side * 2, t.g + k.towerH * 0.6 + 4.3, -t.s);
    group.add(roof);
  }

  const upLine = new Polyline(up);
  const downLine = new Polyline(down);
  const loop = upLine.length + downLine.length;

  // Moving carriers.
  let carriers = null;
  let count = 0;
  if (spec.type === 'ropeway') {
    count = 2;
  } else {
    count = Math.max(2, Math.floor(loop / k.cabinGap));
  }
  let carrierGeo;
  if (spec.type === 'tbar') {
    carrierGeo = new THREE.BoxGeometry(1.2, 0.12, 0.12);
    carrierGeo.translate(0, -4.2, 0);
    const stem = new THREE.BoxGeometry(0.08, 4.2, 0.08);
    stem.translate(0, -2.1, 0);
    carrierGeo = mergeSimple([carrierGeo, stem]);
  } else {
    const big = spec.type === 'ropeway';
    const body = new THREE.BoxGeometry(big ? 6 : 2.2, big ? 3.2 : 2.2, big ? 9 : 2.2);
    body.translate(0, -k.hang, 0);
    const hanger = new THREE.BoxGeometry(0.15, k.hang - (big ? 1.6 : 1.1), 0.15);
    hanger.translate(0, -(k.hang - (big ? 1.6 : 1.1)) / 2, 0);
    carrierGeo = mergeSimple([body, hanger]);
  }
  carriers = new THREE.InstancedMesh(carrierGeo, new THREE.MeshLambertMaterial({ color: spec.type === 'tbar' ? 0x3a3f46 : 0xff5a36 }), count);
  carriers.castShadow = spec.type !== 'tbar';
  carriers.frustumCulled = false;
  group.add(carriers);
  scene.add(group);

  const _p = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _one = new THREE.Vector3(1, 1, 1);
  const _yAxis = new THREE.Vector3(0, 1, 0);

  function placeOnLoop(d) {
    d = ((d % loop) + loop) % loop;
    if (d < upLine.length) upLine.sample(d, _p, _d);
    else downLine.sample(loop - d, _p, _d).add(_d.set(0, 0, 0));
    return _p;
  }

  function update(time) {
    for (let i = 0; i < count; i++) {
      const d = time * k.speed + (i * loop) / count;
      placeOnLoop(d);
      _q.setFromAxisAngle(_yAxis, 0);
      _m.compose(_p, _q, _one);
      carriers.setMatrixAt(i, _m);
    }
    carriers.instanceMatrix.needsUpdate = true;
  }
  update(0);

  // Lift ride for the player: bottom station to top station.
  const ride = {
    type: spec.type,
    duration: k.duration,
    // Where the player's carrier is at fraction t (0..1); for a T-bar, on the snow.
    sample(t, outPos, outDir) {
      upLine.sample(t * upLine.length, outPos, outDir);
      if (spec.type === 'tbar') {
        outPos.y = terrain.height(outPos.x, outPos.z);
      } else {
        outPos.y -= k.hang;
      }
      return outPos;
    },
  };

  return { group, update, ride };
}

// Merge non-indexed copies of a few BoxGeometries into one BufferGeometry.
function mergeSimple(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
