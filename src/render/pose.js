// Turns simulation state into what the renderer needs: where the rider model
// stands, how it's oriented, and its pose. Shared by live riding, ghosts and replays.
import * as THREE from 'three';
import { COM_HEIGHT } from './riderModel.js';

const DEG = Math.PI / 180;
const zAxis = new THREE.Vector3(0, 0, 1);
const xAxis = new THREE.Vector3(1, 0, 0);
const _q = new THREE.Quaternion();
const _n = { x: 0, y: 1, z: 0 };
const GRAB_CODE = { mute: 1, tail: 2, japan: 3 };
const GRAB_NAME = [null, 'mute', 'tail', 'japan'];
const MODE_CODE = { ground: 0, air: 1, rail: 2, crash: 3 };
export const MODE_NAME = ['ground', 'air', 'rail', 'crash'];

// A compact per-frame record of everything needed to draw the rider.
export const STRIDE = 22;

export function writeFrame(r, out, o) {
  out[o] = r.pos.x;
  out[o + 1] = r.pos.y;
  out[o + 2] = r.pos.z;
  out[o + 3] = r.q.x;
  out[o + 4] = r.q.y;
  out[o + 5] = r.q.z;
  out[o + 6] = r.q.w;
  out[o + 7] = MODE_CODE[r.mode];
  out[o + 8] = r.load;
  out[o + 9] = r.tucking ? 1 : 0;
  out[o + 10] = r.lean;
  out[o + 11] = r.switchStance ? 1 : 0;
  out[o + 12] = GRAB_CODE[r.activeGrab] || 0;
  out[o + 13] = r.air && r.air.spin < 0 ? 1 : -1;
  out[o + 14] = r.omega.length();
  out[o + 15] = r.rail && r.rail.press ? 1 : 0;
  out[o + 16] = r.butter ? (r.butter.kind === 'nose' ? -1 : 1) : 0;
  out[o + 17] = r.butter ? Math.min(1, r.butter.time / 0.15) : 0;
  out[o + 18] = r.butter && r.butter.deep ? 1 : 0;
  out[o + 19] = r.sink;
  out[o + 20] = r.speed;
  out[o + 21] = r.air ? r.air.clearance : 0;
}

// A view of a frame that looks enough like a rider for the helpers below.
export function frameRider(f, o, out = {}) {
  out.pos = out.pos || new THREE.Vector3();
  out.q = out.q || new THREE.Quaternion();
  out.pos.set(f[o], f[o + 1], f[o + 2]);
  out.q.set(f[o + 3], f[o + 4], f[o + 5], f[o + 6]);
  out.mode = MODE_NAME[f[o + 7]];
  out.load = f[o + 8];
  out.tucking = f[o + 9] > 0.5;
  out.lean = f[o + 10];
  out.switchStance = f[o + 11] > 0.5;
  out.activeGrab = GRAB_NAME[f[o + 12]];
  out.grabSide = f[o + 13];
  out.omegaLen = f[o + 14];
  out.press = f[o + 15] > 0.5;
  out.butterKind = f[o + 16];
  out.butterK = f[o + 17];
  out.deep = f[o + 18] > 0.5;
  out.sink = f[o + 19];
  out.speed = f[o + 20];
  out.clearance = f[o + 21];
  return out;
}

// Pivot (trick centre) and model orientation for a rider-like object.
export function placeRider(v, terrain, pos, q, outPos, outQ) {
  if (v.mode === 'crash') {
    terrain.normal(pos.x, pos.z, _n);
    outPos.set(pos.x + _n.x * 0.25, pos.y + _n.y * 0.25, pos.z + _n.z * 0.25);
  } else if (v.mode === 'ground') {
    terrain.normal(pos.x, pos.z, _n);
    const h = COM_HEIGHT - (v.sink || 0);
    outPos.set(pos.x + _n.x * h, pos.y + _n.y * h, pos.z + _n.z * h);
  } else {
    outPos.set(pos.x, pos.y + COM_HEIGHT, pos.z);
  }
  outQ.copy(q);
  if (v.mode === 'ground') {
    outQ.multiply(_q.setFromAxisAngle(zAxis, -v.lean * 0.45));
    const kind = v.butter ? (v.butter.kind === 'nose' ? -1 : 1) : v.butterKind || 0;
    if (kind) {
      const k = v.butter ? Math.min(1, v.butter.time / 0.15) : v.butterK;
      const deep = v.butter ? v.butter.deep : v.deep;
      outQ.multiply(_q.setFromAxisAngle(xAxis, kind * (deep ? 36 : 24) * DEG * k));
      outPos.y += 0.25 * k;
    }
  }
}

// Pose targets for RiderModel.update.
export function poseFor(v, { absorb = 0, riding = true } = {}) {
  const mode = v.mode;
  const omega = v.omega ? v.omega.length() : v.omegaLen || 0;
  return {
    crouch: mode === 'ground' ? Math.max(v.load, absorb > 0 ? 0.9 : 0) : mode === 'air' ? 0.25 : mode === 'rail' ? 0.35 : 0.6,
    press: mode === 'rail' && (v.rail ? v.rail.press : v.press) ? 1 : 0,
    wide: mode === 'rail' ? 1 : 0,
    tuck: mode === 'ground' && v.tucking && riding ? 1 : 0,
    legsUp: mode === 'air' ? 0.35 : 0,
    lean: mode === 'ground' ? v.lean : 0,
    look: v.switchStance && mode !== 'crash' ? 1 : 0,
    armsOut: mode === 'air' && omega > 120 ? 1 : mode === 'air' ? 0.4 : 0,
    grab: v.activeGrab,
    grabSide: v.air ? (v.air.spin < 0 ? 1 : -1) : v.grabSide || 1,
  };
}
