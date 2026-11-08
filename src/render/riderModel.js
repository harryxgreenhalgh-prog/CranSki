// Placeholder freeskier built from simple shapes, posed with tiny two-bone IK.
import * as THREE from 'three';

const COM_HEIGHT = 0.9; // pivot for tricks, metres above the feet

const C = {
  jacket: 0xff7a2f,
  jacketDark: 0xd95c17,
  pants: 0x2f3b4c,
  helmet: 0x161616,
  skin: 0xe2b38f,
  ski: 0x1e7bff,
  skiTop: 0xffffff,
  boot: 0x2a2a2a,
  mitt: 0x202830,
  pole: 0xc8ccd2,
};

function lambert(color) {
  return new THREE.MeshLambertMaterial({ color });
}

// A unit cylinder along +Y that we stretch between two points.
function limb(radius, color, radiusBottom = radius) {
  const g = new THREE.CylinderGeometry(radius, radiusBottom, 1, 8);
  const m = new THREE.Mesh(g, lambert(color));
  m.castShadow = true;
  return m;
}

const _y = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
function placeLimb(mesh, a, b) {
  _d.subVectors(b, a);
  const len = _d.length();
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(_y, _d.multiplyScalar(1 / Math.max(len, 1e-6)));
  mesh.scale.set(1, len, 1);
}

const _dir = new THREE.Vector3();
const _perp = new THREE.Vector3();
// Joint position for a two-bone chain from a to target with bend direction hint.
function solveJoint(a, target, l1, l2, hint, out) {
  _dir.subVectors(target, a);
  let d = _dir.length();
  d = Math.min(Math.max(d, 1e-4), l1 + l2 - 1e-3);
  _dir.normalize();
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  _perp.copy(hint).addScaledVector(_dir, -hint.dot(_dir)).normalize();
  return out.copy(a).addScaledVector(_dir, x).addScaledVector(_perp, h);
}

function makeSki() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 1.5), lambert(C.ski));
  body.castShadow = true;
  g.add(body);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.005, 1.3), lambert(C.skiTop));
  top.position.y = 0.018;
  g.add(top);
  // Twin tips turn up at both ends.
  for (const end of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.22), lambert(C.ski));
    tip.position.set(0, 0.04, end * 0.84);
    tip.rotation.x = end * -0.45;
    tip.castShadow = true;
    g.add(tip);
  }
  const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.2, 0.3), lambert(C.boot));
  boot.position.set(0, 0.11, 0.02);
  boot.castShadow = true;
  g.add(boot);
  return g;
}

export class RiderModel {
  constructor() {
    this.root = new THREE.Group(); // positioned at the trick pivot
    this.body = new THREE.Group(); // feet origin, offset down from the pivot
    this.body.position.y = -COM_HEIGHT;
    this.root.add(this.body);

    this.skis = [makeSki(), makeSki()];
    for (const s of this.skis) this.body.add(s);

    this.thigh = [limb(0.12, C.pants, 0.11), limb(0.12, C.pants, 0.11)];
    this.shin = [limb(0.11, C.pants, 0.1), limb(0.11, C.pants, 0.1)];
    this.upperArm = [limb(0.075, C.jacket), limb(0.075, C.jacket)];
    this.foreArm = [limb(0.07, C.jacketDark, 0.065), limb(0.07, C.jacketDark, 0.065)];
    this.mitts = [0, 1].map(() => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), lambert(C.mitt));
      m.castShadow = true;
      return m;
    });
    this.poles = [limb(0.014, C.pole), limb(0.014, C.pole)];
    for (const arr of [this.thigh, this.shin, this.upperArm, this.foreArm, this.mitts, this.poles]) for (const m of arr) this.body.add(m);

    // Torso pivots at the hips.
    this.hips = new THREE.Group();
    this.body.add(this.hips);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 0.3), lambert(C.jacket));
    torso.position.y = 0.33;
    torso.castShadow = true;
    this.hips.add(torso);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.12), lambert(C.jacketDark));
    hood.position.set(0, 0.62, 0.14);
    this.hips.add(hood);
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.28), lambert(C.pants));
    pelvis.position.y = 0.0;
    pelvis.castShadow = true;
    this.hips.add(pelvis);

    this.head = new THREE.Group();
    this.head.position.y = 0.76;
    this.hips.add(this.head);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), lambert(C.skin));
    this.head.add(face);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.145, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), lambert(C.helmet));
    helmet.position.y = 0.02;
    helmet.castShadow = true;
    this.head.add(helmet);
    const goggles = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.08, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xffb02e, metalness: 0.9, roughness: 0.15, emissive: 0x442200 })
    );
    goggles.position.set(0, 0.02, -0.12);
    this.head.add(goggles);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.012, 6, 20), lambert(0xffffff));
    strap.rotation.x = Math.PI / 2;
    strap.position.y = 0.02;
    this.head.add(strap);

    // Pose state (smoothed each frame).
    this.pose = { crouch: 0, tuck: 0, grab: 0, legsUp: 0, lean: 0, look: 0, armsOut: 0, press: 0, wide: 0 };
    this.grabName = null;
    this.grabSide = 1;

    this._v = {
      hip: [new THREE.Vector3(), new THREE.Vector3()],
      foot: [new THREE.Vector3(), new THREE.Vector3()],
      knee: new THREE.Vector3(),
      sh: new THREE.Vector3(),
      hand: new THREE.Vector3(),
      elbow: new THREE.Vector3(),
      tip: new THREE.Vector3(),
    };
  }

  // target: { crouch, tuck, legsUp, lean, look, armsOut, grab(name|null), grabSide }
  update(target, dt) {
    const p = this.pose;
    const k = 1 - Math.exp(-dt * 14);
    p.crouch += (target.crouch - p.crouch) * k;
    p.tuck += (target.tuck - p.tuck) * k;
    p.legsUp += (target.legsUp - p.legsUp) * k;
    p.lean += (target.lean - p.lean) * k;
    p.look += (target.look - p.look) * (1 - Math.exp(-dt * 6));
    p.armsOut += (target.armsOut - p.armsOut) * k;
    p.press += ((target.press || 0) - p.press) * k;
    p.wide += ((target.wide || 0) - p.wide) * k;
    const grabOn = target.grab ? 1 : 0;
    p.grab += (grabOn - p.grab) * (1 - Math.exp(-dt * 18));
    if (target.grab) {
      this.grabName = target.grab;
      this.grabSide = target.grabSide;
    }
    this._layout();
  }

  _layout() {
    const p = this.pose;
    const v = this._v;
    const g = p.grab;
    const name = this.grabName;
    const side = this.grabSide; // +1 = grab with the right hand

    // Feet and skis.
    const lift = Math.max(p.legsUp, g) * 0.42;
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -1 : 1; // 0 = left, 1 = right
      let fx = sx * (0.14 + 0.1 * p.wide);
      let fy = lift;
      let fz = 0;
      let yaw = sx * 0.3 * p.press; // press: skis cross into an X
      if (g > 0.01) {
        if (name === 'mute' || name === 'tail') {
          yaw = sx * 0.28 * g; // skis cross into an X
          fx *= 1 - 0.4 * g;
        } else if (name === 'japan') {
          const fwd = i === (side > 0 ? 0 : 1);
          fz += (fwd ? -0.25 : 0.25) * g;
          fy += (fwd ? 0.05 : 0.18) * g;
          yaw = sx * -0.15 * g;
        }
      }
      v.foot[i].set(fx, fy, fz);
      const ski = this.skis[i];
      ski.position.set(fx, fy, fz);
      ski.rotation.set(0, yaw, 0);
    }

    // Hips drop with crouch and tuck; torso pitches forward.
    const hipY = 0.95 - 0.38 * Math.max(p.crouch, p.tuck * 0.9) + lift * 0.55 - 0.1 * g;
    this.hips.position.set(0, hipY, 0.06 + 0.1 * p.tuck);
    const pitch = -(0.25 + 0.5 * p.tuck + 0.3 * p.crouch + 0.25 * g + 0.55 * p.press);
    this.hips.rotation.set(pitch, p.look * 0.35, -p.lean * 0.15);
    this.head.rotation.set(-pitch * 0.6, p.look * 1.6, 0);
    this.hips.updateMatrix();

    // Legs.
    const kneeHint = new THREE.Vector3(0, 0.2, -1);
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -1 : 1;
      v.hip[i].set(sx * 0.12, hipY - 0.05, 0.06 + 0.1 * p.tuck);
      const ankle = v.knee.copy(v.foot[i]);
      ankle.y += 0.18;
      const top = ankle.clone();
      solveJoint(v.hip[i], top, 0.46, 0.46, kneeHint, v.knee);
      placeLimb(this.thigh[i], v.hip[i], v.knee);
      placeLimb(this.shin[i], v.knee, top);
    }

    // Arms.
    const m = this.hips.matrix;
    const elbowHint = new THREE.Vector3(0, -0.3, 1);
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -1 : 1;
      v.sh.set(sx * 0.27, 0.56, 0).applyMatrix4(m);
      // Default: hands forward and out, holding poles. Tuck: hands in front of the knees.
      const out = 0.38 + 0.25 * p.armsOut;
      const hand = v.hand.set(sx * out, hipY + 0.1 + 0.2 * p.armsOut, -0.32);
      hand.lerp(new THREE.Vector3(sx * 0.18, hipY + 0.05, -0.55), p.tuck);

      // Grabbing hand reaches for its ski.
      const grabbing = g > 0.01 && ((side > 0 && i === 1) || (side < 0 && i === 0));
      if (grabbing) {
        const target = new THREE.Vector3();
        if (name === 'mute') target.copy(v.foot[1 - i]).add(new THREE.Vector3(0, 0.08, -0.35));
        else if (name === 'tail') target.copy(v.foot[i]).add(new THREE.Vector3(sx * 0.05, 0.08, 0.6));
        else target.copy(v.foot[1 - i]).add(new THREE.Vector3(0, 0.1, 0.25)); // japan
        hand.lerp(target, g);
      }
      const reach = Math.min(0.58, hand.distanceTo(v.sh));
      const dir = hand.clone().sub(v.sh).normalize();
      hand.copy(v.sh).addScaledVector(dir, Math.max(reach, 0.15));
      solveJoint(v.sh, hand, 0.3, 0.3, elbowHint, v.elbow);
      placeLimb(this.upperArm[i], v.sh, v.elbow);
      placeLimb(this.foreArm[i], v.elbow, hand);
      this.mitts[i].position.copy(hand);
      // Poles trail back from the hands.
      v.tip.copy(hand).add(new THREE.Vector3(sx * 0.12, -1.05 + 0.4 * p.tuck, 0.45 + 0.4 * p.tuck));
      placeLimb(this.poles[i], hand, v.tip);
    }
  }
}

export { COM_HEIGHT };
