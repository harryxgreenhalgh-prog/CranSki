// Replay cameras: Broadcast, Cinematic, Follow, Action cam, Helmet, Drone, Free.
import * as THREE from 'three';
import { ChaseCam } from '../render/camera.js';

export const CAMERAS = ['Broadcast', 'Cinematic', 'Follow', 'Action cam', 'Helmet', 'Drone', 'Free'];

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class ReplayDirector {
  constructor(camera, terrain, replay) {
    this.camera = camera;
    this.terrain = terrain;
    this.replay = replay;
    this.mode = 0;
    this.chase = new ChaseCam(camera, terrain);
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.first = true;
    this.station = null;
    this.free = { pos: new THREE.Vector3(), yaw: 0, pitch: -0.2, track: true, keys: new Set() };
    this.freeze = false;
    this.orbit = 0;
    // Broadcast stations beside each big jump: frame the trick against the sky.
    this.stations = replay.airs
      .filter((a) => a.time > 0.8)
      .map((a) => {
        const mid = a.p0.clone().lerp(a.p1, 0.5);
        const dir = _v.copy(a.p1).sub(a.p0).setY(0).normalize();
        const side = new THREE.Vector3(-dir.z, 0, dir.x);
        const pos = mid.clone().addScaledVector(side, 18 + a.time * 3);
        pos.y = Math.max(terrain.height(pos.x, pos.z) + 2, Math.min(a.apex.y, mid.y) - 2);
        return { t0: a.t0 - 2, t1: a.t1 + 1.5, pos };
      });
  }

  get name() {
    return CAMERAS[this.mode];
  }

  next() {
    this.mode = (this.mode + 1) % CAMERAS.length;
    this.first = true;
    this.chase.snap();
    if (this.name === 'Free') {
      this.free.pos.copy(this.camera.position);
    }
  }

  // Slow motion near the top of each air in the Cinematic camera.
  rate(t) {
    if (this.name !== 'Cinematic') return 1;
    for (const a of this.replay.airs) {
      if (a.time > 1 && Math.abs(t - a.apexT) < 0.6) return 0.35;
    }
    return 1;
  }

  // v: rider-like view of the current frame; pivot: model centre; quat: model orientation.
  update(t, v, vel, pivot, quat, dt) {
    const cam = this.camera;
    const terrain = this.terrain;
    const name = this.freeze ? 'Cinematic' : this.name;
    let fov = 60;
    if (name === 'Follow') {
      this.chase.update({ vel, mode: v.mode, air: v.mode === 'air' ? { clearance: v.clearance } : null, pos: v.pos }, pivot, dt);
      return;
    }
    if (name === 'Helmet') {
      this.chase.firstPerson(pivot, quat, dt, v.speed);
      return;
    }
    const travel = _w.copy(vel).setY(0);
    if (travel.lengthSq() < 0.01) travel.set(0, 0, -1);
    travel.normalize();
    let want = _v;
    let lookAt = pivot;
    let k = 3;
    if (name === 'Broadcast') {
      const st = this.stations.find((s) => t >= s.t0 && t <= s.t1);
      if (st) want.copy(st.pos);
      else {
        // Trackside cameras every 70 m down the line, cutting as you pass.
        const s = -pivot.z;
        const ks = Math.floor((s + 20) / 70) * 70 + 50;
        const side = Math.floor(ks / 70) % 2 ? 1 : -1;
        const x = terrain.center(ks) + side * (terrain.cross.hw + 4);
        want.set(x, terrain.height(x, -ks) + 3, -ks);
      }
      const cut = !this.station || this.station.distanceTo(want) > 1;
      if (cut) {
        this.station = want.clone();
        this.first = true;
      }
      k = 0;
      fov = 42;
    } else if (name === 'Cinematic') {
      this.orbit += dt * (this.freeze ? 0.6 : 0.25);
      const r = 8 + Math.sin(t * 0.2) * 2;
      want.set(pivot.x + Math.cos(this.orbit) * r, pivot.y + 2 + Math.sin(t * 0.37) * 1.5, pivot.z + Math.sin(this.orbit) * r);
      k = 2;
      fov = 50;
    } else if (name === 'Action cam') {
      // Close, human height, swapping sides every few seconds.
      const side = Math.floor(t / 5) % 2 ? 1 : -1;
      want.copy(pivot).addScaledVector(travel, -2.6);
      want.x += -travel.z * 2 * side;
      want.z += travel.x * 2 * side;
      want.y = pivot.y + 0.7;
      lookAt = _w.copy(pivot).addScaledVector(travel, 3);
      k = 8;
      fov = 75;
    } else if (name === 'Drone') {
      want.copy(pivot).addScaledVector(travel, -15);
      want.y = pivot.y + 12;
      k = 1.5;
      fov = 55;
    } else if (name === 'Free') {
      const f = this.free;
      const fwd = new THREE.Vector3(Math.sin(f.yaw) * -1, 0, -Math.cos(f.yaw));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const sp = 18 * dt;
      if (f.keys.has('KeyW')) f.pos.addScaledVector(fwd, sp);
      if (f.keys.has('KeyS')) f.pos.addScaledVector(fwd, -sp);
      if (f.keys.has('KeyA')) f.pos.addScaledVector(right, -sp);
      if (f.keys.has('KeyD')) f.pos.addScaledVector(right, sp);
      if (f.keys.has('KeyE')) f.pos.y += sp;
      if (f.keys.has('KeyQ')) f.pos.y -= sp;
      const g = terrain.height(f.pos.x, f.pos.z) + 0.5;
      if (f.pos.y < g) f.pos.y = g;
      cam.position.copy(f.pos);
      if (f.track) cam.lookAt(pivot);
      else cam.lookAt(f.pos.x + fwd.x * 10, f.pos.y + Math.tan(f.pitch) * 10, f.pos.z + fwd.z * 10);
      this._fov(60, dt);
      return;
    }
    const g = terrain.height(want.x, want.z) + 1;
    if (want.y < g) want.y = g;
    if (this.first || k === 0) {
      this.pos.copy(want);
      this.look.copy(lookAt);
      this.first = false;
    } else {
      this.pos.lerp(want, 1 - Math.exp(-dt * k));
      this.look.lerp(lookAt, 1 - Math.exp(-dt * 8));
    }
    if (name === 'Broadcast') this.look.copy(lookAt);
    cam.position.copy(this.pos);
    cam.lookAt(this.look);
    this._fov(fov, dt);
  }

  _fov(f, dt) {
    if (Math.abs(this.camera.fov - f) > 0.1) {
      this.camera.fov += (f - this.camera.fov) * Math.min(1, dt * 4);
      this.camera.updateProjectionMatrix();
    }
  }
}
