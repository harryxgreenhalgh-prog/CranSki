// Snow puffs on take-off, landing and crashes. Visual only.
import * as THREE from 'three';

const MAX = 400;

export class Spray {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo = geo;
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.22, transparent: true, opacity: 0.85, depthWrite: false });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.seed = 1;
  }

  _rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  burst(at, vel, count = 60, power = 4) {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      this.pos[i * 3] = at.x + (this._rnd() - 0.5) * 0.8;
      this.pos[i * 3 + 1] = at.y + 0.1;
      this.pos[i * 3 + 2] = at.z + (this._rnd() - 0.5) * 0.8;
      this.vel[i * 3] = vel.x * 0.3 + (this._rnd() - 0.5) * power;
      this.vel[i * 3 + 1] = this._rnd() * power * 0.8 + 1;
      this.vel[i * 3 + 2] = vel.z * 0.3 + (this._rnd() - 0.5) * power;
      this.life[i] = 0.6 + this._rnd() * 0.6;
    }
  }

  update(dt) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -1e5;
        continue;
      }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 9 * dt;
      const drag = Math.exp(-dt * 2.5);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}
