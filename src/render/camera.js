// Chase camera: low and close behind the rider on snow, pulls back on big airs,
// widens FOV with speed.
import * as THREE from 'three';

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
    this.speedFov = true;
  }

  snap() {
    this.first = true;
  }

  update(rider, pivot, dt) {
    const v = rider.vel;
    const h = new THREE.Vector3(v.x, 0, v.z);
    const sp = v.length();
    if (h.lengthSq() > 1) {
      h.normalize();
      const k = rider.mode === 'air' ? 1.2 : 3.5;
      this.dir.lerp(h, 1 - Math.exp(-dt * k)).normalize();
    }

    // Pull back on big airs so the landing is in view.
    let wantDist = 5.8 + Math.min(sp, 50) * 0.03;
    let wantHeight = 2.0;
    if (rider.mode === 'air' && rider.air) {
      const c = rider.air.clearance;
      wantDist += Math.min(6, c * 0.2);
      wantHeight += Math.min(4, c * 0.12);
    }
    if (rider.mode === 'crash') {
      wantDist = 7;
      wantHeight = 3;
    }
    const kd = 1 - Math.exp(-dt * 2.5);
    this.dist += (wantDist - this.dist) * kd;
    this.height += (wantHeight - this.height) * kd;

    const target = pivot.clone().addScaledVector(this.dir, -this.dist);
    target.y = pivot.y + this.height;
    const ground = this.terrain.height(target.x, target.z) + 1.0;
    if (target.y < ground) target.y = ground;

    const lookAt = pivot.clone().addScaledVector(this.dir, 4);
    lookAt.y = pivot.y + 0.3;
    if (rider.mode === 'air') lookAt.y -= Math.min(4, rider.air ? rider.air.clearance * 0.12 : 0);

    if (this.first) {
      this.pos.copy(target);
      this.look.copy(lookAt);
      this.first = false;
    } else {
      // Follow tightly along the line of travel so high speed doesn't drag the camera behind.
      const kp = 1 - Math.exp(-dt * 10);
      this.pos.lerp(target, kp);
      this.look.lerp(lookAt, 1 - Math.exp(-dt * 12));
    }
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);

    const fov = this.speedFov ? 62 + Math.min(1, sp / 50) * 18 : 68;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 3));
      this.camera.updateProjectionMatrix();
    }
  }
}
