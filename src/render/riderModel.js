// Freeskier built from simple shapes, posed with tiny two-bone IK.
// Everything you can change in the Locker (colours, items, skis or board) is
// applied with applyLook().
import * as THREE from 'three';
import { textTexture } from './textTexture.js';

const COM_HEIGHT = 0.9; // pivot for tricks, metres above the feet

export const DEFAULT_LOOK = {
  body: 'man',
  skin: 0xe2b38f,
  hair: 'short',
  hairColor: 0x3b2a20,
  head: 'helmet',
  helmet: 'matte', // helmet item id
  helmetColor: 0x161616,
  beanieColor: 0x1e7bff,
  beanieItem: 'knit',
  lens: 0xffb02e,
  logo: true,
  top: 'shell',
  topColor: 0xff7a2f,
  trimColor: 0xd95c17,
  pants: 0x2f3b4c,
  gloves: 0x202830,
  ride: 'skis',
  skiColor: 0x1e7bff,
  boardColor: 0x22b07d,
  bindings: 0x222222,
  boots: 0x2a2a2a,
  poles: 0xc8ccd2, // or 'none'
  grabs: ['mute', 'tail', 'japan'],
};

// Unlockable helmets (earned in play) and their looks.
export const HELMETS = {
  matte: { name: 'Park Matte', finish: 'matte' },
  halo: { name: 'Halo Shell', finish: 'gloss', color: 0xf4f7fb, need: 75000 },
  summit: { name: 'Summit Gold', finish: 'metal', color: 0xd9a826, need: 100000 },
  nightowl: { name: 'Night Owl', finish: 'metal', color: 0x2a2f6e, need: 150000 },
};

function lambert(color) {
  // Soft fabric: rough, picks up a little of the sky.
  return new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, envMapIntensity: 0.6 });
}

// A unit cylinder along +Y that we stretch between two points.
function limb(radius, mat, radiusBottom = radius) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radiusBottom, 1, 14), mat);
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

// Grab poses: which hand(s) reach where. 'cross' = hand to the other ski,
// 'same' = hand to its own ski, 'both' = both hands to their own skis.
const GRABS = {
  mute: { hand: 'cross', at: [0, 0.08, -0.35], skisX: true },
  tail: { hand: 'same', at: [0.05, 0.08, 0.6], skisX: true },
  japan: { hand: 'cross', at: [0, 0.1, 0.25], japan: true },
  safety: { hand: 'same', at: [0.08, 0.12, 0.05] },
  blunt: { hand: 'same', at: [0, 0.12, 0.74], tailUp: 0.5 },
  rocket: { hand: 'both', at: [0, 0.1, -0.72], skisFwd: true },
  truenose: { hand: 'same', at: [0, 0.1, -0.72], noseUp: 0.3 },
  backscratcher: { hand: 'both', at: [0, 0.1, 0.62], tailUp: 1.0, feetBack: true },
};

export const GRAB_INFO = {
  mute: 'Front hand crosses to the opposite ski, skis cross in an X',
  tail: 'Hand holds the same-side ski tail at the hip, skis crossed',
  japan: 'Stand tall, one knee bent with its ski forward, hand holds the other ski behind the boot',
  safety: 'Hand grabs the ski under the boot on the same side',
  blunt: 'Reach back and cap the ski tail',
  rocket: 'Both hands cap both ski tips',
  truenose: 'One hand caps one ski tip',
  backscratcher: 'Both knees bend back, hands hold the raised tails',
};
export const GRAB_NAMES = { mute: 'Mute', tail: 'Tail', japan: 'Japan', safety: 'Safety', blunt: 'Blunt', rocket: 'Rocket Air', truenose: 'True Nose', backscratcher: 'Backscratcher' };

export class RiderModel {
  constructor(look = DEFAULT_LOOK) {
    const M = (this.mats = {
      top: lambert(0xff7a2f),
      trim: lambert(0xd95c17),
      forearm: lambert(0xd95c17),
      pants: lambert(0x2f3b4c),
      skin: lambert(0xe2b38f),
      face: lambert(0xe2b38f),
      hair: lambert(0x3b2a20),
      helmet: new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.85, metalness: 0 }),
      beanie: lambert(0x1e7bff),
      lens: new THREE.MeshStandardMaterial({ color: 0xffb02e, metalness: 0.9, roughness: 0.15, emissive: 0x442200 }),
      strap: new THREE.MeshLambertMaterial({ color: 0xffffff }),
      mitt: lambert(0x202830),
      ski: lambert(0x1e7bff),
      skiTop: lambert(0xffffff),
      board: lambert(0x22b07d),
      binding: lambert(0x222222),
      boot: lambert(0x2a2a2a),
      pole: lambert(0xc8ccd2),
    });
    this.root = new THREE.Group(); // positioned at the trick pivot
    this.body = new THREE.Group(); // feet origin, offset down from the pivot
    this.body.position.y = -COM_HEIGHT;
    this.root.add(this.body);

    const mesh = (geo, mat, parent = this.body) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // Skis: body, top sheet, twin tips, binding and boot.
    this.skis = [0, 1].map(() => {
      const g = new THREE.Group();
      mesh(new THREE.BoxGeometry(0.095, 0.025, 1.62), M.ski, g);
      mesh(new THREE.BoxGeometry(0.05, 0.005, 1.4), M.skiTop, g).position.y = 0.015;
      for (const end of [-1, 1]) {
        const tip = mesh(new THREE.CylinderGeometry(0.0475, 0.0475, 0.025, 12, 1, false, 0, Math.PI), M.ski, g);
        tip.scale.set(1, 1, 2.6);
        tip.rotation.y = end > 0 ? 0 : Math.PI;
        tip.position.set(0, 0.05, end * 0.84);
        tip.rotation.x = end * -0.45;
      }
      mesh(new THREE.BoxGeometry(0.11, 0.04, 0.36), M.binding, g).position.set(0, 0.03, 0.02);
      mesh(new THREE.BoxGeometry(0.13, 0.2, 0.3), M.boot, g).position.set(0, 0.13, 0.02);
      this.body.add(g);
      return g;
    });

    // Snowboard (sideways stance) with its own chunkier boots.
    this.board = new THREE.Group();
    mesh(new THREE.BoxGeometry(0.28, 0.03, 1.36), M.board, this.board);
    for (const end of [-1, 1]) {
      const tip = mesh(new THREE.BoxGeometry(0.28, 0.03, 0.2), M.board, this.board);
      tip.position.set(0, 0.04, end * 0.75);
      tip.rotation.x = end * -0.4;
    }
    this.boardBoots = [-1, 1].map((sz) => {
      mesh(new THREE.BoxGeometry(0.26, 0.05, 0.16), M.binding, this.board).position.set(0, 0.04, sz * 0.24);
      const b = mesh(new THREE.BoxGeometry(0.3, 0.2, 0.15), M.boot, this.board);
      b.position.set(0, 0.14, sz * 0.24);
      return b;
    });
    this.body.add(this.board);

    this.thigh = [limb(0.12, M.pants, 0.11), limb(0.12, M.pants, 0.11)];
    this.shin = [limb(0.11, M.pants, 0.1), limb(0.11, M.pants, 0.1)];
    this.upperArm = [limb(0.075, M.top), limb(0.075, M.top)];
    this.foreArm = [limb(0.07, M.forearm, 0.065), limb(0.07, M.forearm, 0.065)];
    this.mitts = [0, 1].map(() => mesh(new THREE.SphereGeometry(0.078, 16, 12), M.mitt));
    // Rounded caps at the knees and elbows so the limbs join smoothly.
    this.knees = [0, 1].map(() => mesh(new THREE.SphereGeometry(0.108, 14, 10), M.pants));
    this.elbows = [0, 1].map(() => mesh(new THREE.SphereGeometry(0.068, 12, 8), M.top));
    this.poles = [limb(0.014, M.pole), limb(0.014, M.pole)];
    for (const arr of [this.thigh, this.shin, this.upperArm, this.foreArm, this.poles]) for (const m of arr) this.body.add(m);

    // Torso pivots at the hips.
    this.hips = new THREE.Group();
    this.body.add(this.hips);
    this.torso = mesh(new THREE.CapsuleGeometry(0.2, 0.3, 8, 18), M.top, this.hips);
    this.torso.position.y = 0.33;
    this.hood = mesh(new THREE.BoxGeometry(0.3, 0.1, 0.12), M.trim, this.hips);
    this.hood.position.set(0, 0.62, 0.14);
    this.bigHood = mesh(new THREE.SphereGeometry(0.17, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), M.top, this.hips);
    this.bigHood.position.set(0, 0.6, 0.12);
    this.bigHood.rotation.x = -1.2;
    this.pocket = mesh(new THREE.BoxGeometry(0.3, 0.12, 0.02), M.trim, this.hips);
    this.pocket.position.set(0, 0.16, -0.16);
    this.zip = mesh(new THREE.BoxGeometry(0.03, 0.5, 0.01), M.trim, this.hips);
    this.zip.position.set(0, 0.36, -0.155);
    const pelvis = mesh(new THREE.CapsuleGeometry(0.13, 0.17, 6, 14), M.pants, this.hips);
    pelvis.rotation.z = Math.PI / 2;
    pelvis.scale.set(1, 1, 1.05);

    this.head = new THREE.Group();
    this.head.position.y = 0.76;
    this.hips.add(this.head);
    this.face = mesh(new THREE.SphereGeometry(0.12, 20, 16), M.face, this.head);
    this.hairShort = mesh(new THREE.SphereGeometry(0.128, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), M.hair, this.head);
    this.hairShort.position.y = 0.01;
    this.hairStrands = new THREE.Group();
    for (const sx of [-1, 1]) mesh(new THREE.BoxGeometry(0.05, 0.12, 0.03), M.hair, this.hairStrands).position.set(sx * 0.07, -0.05, -0.1);
    this.head.add(this.hairStrands);
    this.braid = mesh(new THREE.CylinderGeometry(0.035, 0.02, 0.3, 6), M.hair, this.head);
    this.braid.position.set(0, -0.15, 0.12);
    this.braid.rotation.x = 0.3;
    this.helmet = mesh(new THREE.SphereGeometry(0.148, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), M.helmet, this.head);
    this.helmet.position.y = 0.02;
    this.beanie = new THREE.Group();
    mesh(new THREE.SphereGeometry(0.138, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), M.beanie, this.beanie).scale.set(1, 1.15, 1);
    this.pom = mesh(new THREE.SphereGeometry(0.045, 8, 6), M.beanie, this.beanie);
    this.pom.position.y = 0.16;
    this.beanie.position.y = 0.015;
    this.head.add(this.beanie);
    // Oversized wraparound goggles.
    this.goggles = mesh(new THREE.CylinderGeometry(0.142, 0.142, 0.085, 24, 1, true, Math.PI - 1.15, 2.3), M.lens, this.head);
    this.goggles.material.side = THREE.DoubleSide;
    this.goggles.position.set(0, 0.025, 0);
    this.strap = mesh(new THREE.CylinderGeometry(0.142, 0.142, 0.035, 20, 1, true), M.strap, this.head);
    this.strap.position.y = 0.02;
    this.strapTex = textTexture('CRANSKI  CRANSKI  CRANSKI', { w: 512, h: 32, bg: '#ffffff', fg: '#0b3d91', font: 'italic 900 26px Impact, sans-serif' });

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
      tmp: new THREE.Vector3(),
    };
    this.applyLook(look);
  }

  applyLook(look) {
    const L = { ...DEFAULT_LOOK, ...look };
    this.look = L;
    const M = this.mats;
    M.top.color.setHex(L.topColor);
    M.trim.color.setHex(L.trimColor);
    M.forearm.color.setHex(L.top === 'tee' ? L.skin : L.trimColor);
    M.pants.color.setHex(L.pants);
    M.skin.color.setHex(L.skin);
    M.face.color.setHex(L.head === 'balaclava' ? 0x1a1a1a : L.skin);
    M.hair.color.setHex(L.hairColor);
    const h = HELMETS[L.helmet] || HELMETS.matte;
    M.helmet.color.setHex(h.color ?? L.helmetColor);
    M.helmet.roughness = h.finish === 'matte' ? 0.85 : h.finish === 'gloss' ? 0.25 : 0.3;
    M.helmet.metalness = h.finish === 'metal' ? 0.85 : 0;
    const cloud = L.beanieItem === 'cloud' && L.head === 'beanie';
    M.beanie.color.setHex(cloud ? 0xf4f7fb : L.beanieColor);
    this.pom.scale.setScalar(cloud ? 1.8 : 1);
    M.lens.color.setHex(L.lens);
    M.lens.emissive.setHex(new THREE.Color(L.lens).multiplyScalar(0.25).getHex());
    M.strap.map = L.logo ? this.strapTex : null;
    M.strap.needsUpdate = true;
    M.mitt.color.setHex(L.gloves);
    M.ski.color.setHex(L.skiColor);
    M.board.color.setHex(L.boardColor);
    M.binding.color.setHex(L.bindings);
    M.boot.color.setHex(L.boots);
    if (L.poles !== 'none') M.pole.color.setHex(L.poles);

    const board = L.ride === 'board';
    this.isBoard = board;
    for (const s of this.skis) s.visible = !board;
    this.board.visible = board;
    for (const p of this.poles) p.visible = !board && L.poles !== 'none';

    // Body type: a slightly narrower build for Woman.
    const w = L.body === 'woman';
    this.torso.scale.set(1.12 * (w ? 0.88 : 1), 0.9 * (w ? 0.96 : 1), 0.74 * (w ? 0.92 : 1));
    this.shoulder = w ? 0.24 : 0.27;

    // Head items and hair.
    this.helmet.visible = L.head === 'helmet';
    this.beanie.visible = L.head === 'beanie';
    this.strap.visible = L.head === 'helmet' || L.head === 'beanie';
    this.hairShort.visible = L.head === 'none';
    this.hairStrands.visible = L.hair === 'strands' && L.head !== 'balaclava';
    this.braid.visible = L.hair === 'braid' && L.head !== 'balaclava';

    // Tops.
    this.hood.visible = L.top === 'shell';
    this.zip.visible = L.top === 'shell';
    this.bigHood.visible = L.top === 'hoodie';
    this.pocket.visible = L.top === 'hoodie';
  }

  // Ghost: see-through and pale blue.
  makeGhost() {
    const mat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.35, depthWrite: false });
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.material = mat;
        o.castShadow = false;
      }
    });
    this.applyLook = (look) => {
      this.look = { ...DEFAULT_LOOK, ...look };
      const board = this.look.ride === 'board';
      this.isBoard = board;
      for (const s of this.skis) s.visible = !board;
      this.board.visible = board;
      for (const p of this.poles) p.visible = !board && this.look.poles !== 'none';
    };
    this.applyLook(this.look);
  }

  // target: { crouch, tuck, legsUp, lean, look, armsOut, grab(name|null), grabSide, press, wide }
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
    const G = GRABS[this.grabName] || GRABS.mute;
    const side = this.grabSide; // +1 = grab with the right hand
    const board = this.isBoard;
    // On a board the body turns sideways; positions below are rotated by this yaw.
    const yaw = board ? -Math.PI / 2 : 0;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const rot = (vec) => {
      const x = vec.x * cy + vec.z * sy;
      const z = -vec.x * sy + vec.z * cy;
      vec.x = x;
      vec.z = z;
      return vec;
    };

    // Feet and skis (or board).
    const lift = Math.max(p.legsUp, g) * 0.42;
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -1 : 1; // 0 = left, 1 = right
      let fx = sx * (0.14 + 0.1 * p.wide);
      let fy = lift;
      let fz = 0;
      let yawS = sx * 0.3 * p.press; // press: skis cross into an X
      let pitch = 0;
      if (board) {
        fx = 0;
        fz = sx * 0.24;
        yawS = 0;
      } else if (g > 0.01) {
        if (G.skisX) {
          yawS = sx * 0.28 * g;
          fx *= 1 - 0.4 * g;
        } else if (G.japan) {
          const fwd = i === (side > 0 ? 0 : 1);
          fz += (fwd ? -0.25 : 0.25) * g;
          fy += (fwd ? 0.05 : 0.18) * g;
          yawS = sx * -0.15 * g;
        }
        if (G.skisFwd) fz -= 0.2 * g;
        if (G.feetBack) {
          fz += 0.25 * g;
          fy += 0.1 * g;
        }
        if (G.tailUp) pitch = G.tailUp * g;
        if (G.noseUp && i === (side > 0 ? 1 : 0)) pitch = -G.noseUp * g;
      }
      v.foot[i].set(fx, fy, fz);
      if (!board) {
        const ski = this.skis[i];
        ski.position.set(fx, fy, fz);
        ski.rotation.set(pitch, yawS, 0);
      }
    }
    if (board) this.board.position.set(0, lift, 0);

    // Hips drop with crouch and tuck; torso pitches forward.
    const hipY = 0.95 - 0.38 * Math.max(p.crouch, p.tuck * 0.9) + lift * 0.55 - 0.1 * g;
    const hz = 0.06 + 0.1 * p.tuck;
    this.hips.position.copy(rot(v.tmp.set(0, hipY, hz)));
    const pitch = -(0.25 + 0.5 * p.tuck + 0.3 * p.crouch + 0.25 * g + 0.55 * p.press);
    this.hips.rotation.set(0, 0, 0);
    this.hips.rotateY(yaw + p.look * 0.35);
    this.hips.rotateX(pitch);
    this.hips.rotateZ(-p.lean * 0.15);
    this.head.rotation.set(-pitch * 0.6, p.look * 1.6, 0);
    this.hips.updateMatrix();

    // Legs.
    const kneeHint = rot(new THREE.Vector3(0, 0.2, -1));
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -1 : 1;
      rot(v.hip[i].set(sx * 0.12, hipY - 0.05, hz));
      const ankle = v.foot[i].clone();
      ankle.y += board ? 0.22 : 0.18;
      solveJoint(v.hip[i], ankle, 0.46, 0.46, kneeHint, v.knee);
      placeLimb(this.thigh[i], v.hip[i], v.knee);
      this.knees[i].position.copy(v.knee);
      placeLimb(this.shin[i], v.knee, ankle);
    }

    // Arms.
    const m = this.hips.matrix;
    const elbowHint = rot(new THREE.Vector3(0, -0.3, 1));
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -1 : 1;
      v.sh.set(sx * this.shoulder, 0.56, 0).applyMatrix4(m);
      // Default: hands forward and out, holding poles. Tuck: hands in front of the knees.
      const out = 0.38 + 0.25 * p.armsOut;
      const hand = rot(v.hand.set(sx * out, hipY + 0.1 + 0.2 * p.armsOut, -0.32));
      hand.lerp(rot(new THREE.Vector3(sx * 0.18, hipY + 0.05, -0.55)), p.tuck);

      // Grabbing hand(s) reach for the skis.
      const mine = (side > 0 && i === 1) || (side < 0 && i === 0);
      const grabbing = g > 0.01 && (G.hand === 'both' || mine);
      if (grabbing) {
        const foot = G.hand === 'cross' ? v.foot[1 - i] : v.foot[i];
        const off = new THREE.Vector3(G.at[0] * sx, G.at[1], G.at[2]);
        if (board) off.set(sx * 0.12, 0.12, G.at[2] * 0.4);
        hand.lerp(foot.clone().add(off), g);
      }
      const reach = Math.min(0.58, hand.distanceTo(v.sh));
      const dir = hand.clone().sub(v.sh).normalize();
      hand.copy(v.sh).addScaledVector(dir, Math.max(reach, 0.15));
      solveJoint(v.sh, hand, 0.3, 0.3, elbowHint, v.elbow);
      placeLimb(this.upperArm[i], v.sh, v.elbow);
      this.elbows[i].position.copy(v.elbow);
      placeLimb(this.foreArm[i], v.elbow, hand);
      this.mitts[i].position.copy(hand);
      // Poles trail back from the hands.
      v.tip.copy(hand).add(new THREE.Vector3(sx * 0.12, -1.05 + 0.4 * p.tuck, 0.45 + 0.4 * p.tuck));
      placeLimb(this.poles[i], hand, v.tip);
    }
  }
}

export { COM_HEIGHT };
