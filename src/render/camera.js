// Chase camera: low and close behind the rider on snow, pulls back on big airs,
// widens FOV with speed. Every value comes from Settings → Camera.
import * as THREE from 'three';
import { settings } from '../settings.js';

const DEG = Math.PI / 180;

export class ChaseCam {
  constructor(camera, terrain) {
    this.camera = camera;
    this.terrain = terrain;
    this.dir = new THREE.Vector3(0, 0, -1); // smoothed horizontal travel direction
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.dist = 6;
    this.height = 2.2;
    this.first = true;
    this._h = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._l = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._y = new THREE.Vector3(0, 1, 0);
  }

  snap() {
    this.first = true;
  }

  update(rider, pivot, dt) {
    const c = settings.camera;
    const stiff = c.stiffness;
    const v = rider.vel;
    const h = this._h.set(v.x, 0, v.z);
    const sp = v.length();
    if (this.terrain.cross.type === 'pipe') {
      // In the pipe, look down the pipe rather than at the wall you're climbing.
      const s = -rider.pos.z;
      h.set(this.terrain.centerSlope(s), 0, -1).multiplyScalar(4);
      h.x += v.x * 0.15;
    }
    if (h.lengthSq() > 1) {
      h.normalize();
      const k = (rider.mode === 'air' ? 1.2 : 3.5) * stiff;
      this.dir.lerp(h, 1 - Math.exp(-dt * k)).normalize();
    }

    // Pull back on big airs so the landing is in view.
    let wantDist = c.distance + Math.min(sp, 50) * 0.03;
    let wantHeight = c.height;
    if (rider.mode === 'air' && rider.air) {
      const cl = rider.air.clearance;
      wantDist += Math.min(6, cl * 0.2);
      wantHeight += Math.min(4, cl * 0.12);
    }
    if (rider.mode === 'crash') {
      wantDist = c.distance + 1.5;
      wantHeight = c.height + 1;
    }
    const kd = 1 - Math.exp(-dt * 2.5 * stiff);
    this.dist += (wantDist - this.dist) * kd;
    this.height += (wantHeight - this.height) * kd;

    // Orbit angle around the rider.
    const back = this._l.copy(this.dir).negate();
    if (c.angle) back.applyQuaternion(this._q.setFromAxisAngle(this._y, c.angle * DEG));
    const target = this._t.copy(pivot).addScaledVector(back, this.dist);
    target.y = pivot.y + this.height;
    if (this.terrain.cross.type === 'pipe') {
      // Stay near the middle of the pipe so the walls frame the rider.
      const s = -target.z;
      const cx = this.terrain.center(s);
      target.x = cx + (pivot.x - cx) * 0.45;
      target.y = Math.max(target.y, this.terrain.profile(s) + 4);
    }
    const ground = this.terrain.height(target.x, target.z) + 1.0;
    if (target.y < ground) target.y = ground;

    const lookAt = pivot.clone().addScaledVector(this.dir, 4);
    lookAt.y = pivot.y + 0.3 - Math.tan(c.tilt * DEG) * 4;
    if (rider.mode === 'air') lookAt.y -= Math.min(4, rider.air ? rider.air.clearance * 0.12 : 0);

    if (this.first) {
      this.pos.copy(target);
      this.look.copy(lookAt);
      this.first = false;
    } else {
      const kp = 1 - Math.exp(-dt * 10 * stiff);
      this.pos.lerp(target, kp);
      this.look.lerp(lookAt, 1 - Math.exp(-dt * 12 * stiff));
    }
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    this.setFov(c.speedFov ? c.fov - 4 + Math.min(1, sp / 50) * 18 : c.fov, dt);
  }

  // Helmet cam: the view turns with the rider, flips and all.
  firstPerson(pivot, quat, dt, speed) {
    const c = settings.camera;
    this.camera.position.copy(pivot).add(this._t.set(0, 0.78, -0.12).applyQuaternion(quat));
    this.camera.quaternion.copy(quat);
    this.camera.rotateX(-0.12 - c.tilt * DEG);
    this.setFov(c.speedFov ? c.fov + Math.min(1, speed / 50) * 14 : c.fov, dt);
    this.first = true;
  }

  setFov(fov, dt) {
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 3));
      this.camera.updateProjectionMatrix();
    }
  }
}
