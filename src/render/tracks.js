// Ski tracks in the corduroy that fade after about 4 minutes (Ultra only).
import * as THREE from 'three';

const MAX = 3000; // track segments kept (two skis each)
const FADE = 240; // seconds until a track has faded away

export class SkiTracks {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 2 * 4 * 3); // 2 skis × quad (4 verts) × xyz
    this.col = new Float32Array(MAX * 2 * 4 * 4); // rgba
    this.birth = new Float32Array(MAX);
    const idx = new Uint32Array(MAX * 2 * 6);
    for (let q = 0; q < MAX * 2; q++) {
      const v = q * 4;
      idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], q * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo = geo;
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.next = 0;
    this.last = null;
    this.fadeTimer = 0;
  }

  // Lay a short piece of track from the last point to the rider's feet.
  add(time, rider, terrain) {
    if (rider.mode !== 'ground') {
      this.last = null;
      return;
    }
    const p = rider.pos;
    if (this.last && Math.hypot(p.x - this.last.x, p.z - this.last.z) < 0.6) return;
    const right = { x: -rider.skiDir.z, z: rider.skiDir.x };
    const rl = Math.hypot(right.x, right.z) || 1;
    right.x /= rl;
    right.z /= rl;
    const cur = { x: p.x, z: p.z, rx: right.x, rz: right.z };
    if (this.last && Math.hypot(p.x - this.last.x, p.z - this.last.z) < 4) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      this.birth[i] = time;
      for (let ski = 0; ski < 2; ski++) {
        const off = ski ? 0.14 : -0.14;
        const q = (i * 2 + ski) * 4;
        const pts = [
          [this.last.x + this.last.rx * (off - 0.045), this.last.z + this.last.rz * (off - 0.045)],
          [this.last.x + this.last.rx * (off + 0.045), this.last.z + this.last.rz * (off + 0.045)],
          [cur.x + cur.rx * (off - 0.045), cur.z + cur.rz * (off - 0.045)],
          [cur.x + cur.rx * (off + 0.045), cur.z + cur.rz * (off + 0.045)],
        ];
        pts.forEach(([x, z], k) => {
          this.pos.set([x, terrain.height(x, z) + 0.02, z], (q + k) * 3);
          this.col.set([0.62, 0.72, 0.86, 0.55], (q + k) * 4);
        });
      }
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
    }
    this.last = cur;
  }

  // Fade older tracks (cheap: once a second).
  update(time, dt) {
    this.fadeTimer += dt;
    if (this.fadeTimer < 1) return;
    this.fadeTimer = 0;
    for (let i = 0; i < MAX; i++) {
      if (!this.birth[i]) continue;
      const a = Math.max(0, 1 - (time - this.birth[i]) / FADE) * 0.55;
      for (let k = 0; k < 8; k++) this.col[(i * 8 + k) * 4 + 3] = a;
    }
    this.geo.attributes.color.needsUpdate = true;
  }
}
