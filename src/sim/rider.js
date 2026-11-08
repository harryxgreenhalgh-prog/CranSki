// Rider controller: fixed-timestep, deterministic (no randomness, no wall clock).
// Same inputs in, same run out, so replays and server re-rides can come later.

import { Vector3, Quaternion, Matrix4 } from 'three';
import { DT, PHYS, AIR, LAND, CRASH } from './constants.js';
import { OFF_AXIS } from './tricks.js';

const DEG = Math.PI / 180;
const UP = new Vector3(0, 1, 0);
const GRAB_SLOTS = ['mute', 'tail', 'japan'];

// Scratch objects (avoid garbage every step).
const _n = new Vector3();
const _f = new Vector3();
const _r = new Vector3();
const _g = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _prev = new Vector3();

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Orientation whose forward (-Z) is `forward` and up (+Y) is `up` (assumed orthogonal).
function basisQuat(forward, up, out) {
  _r.crossVectors(forward, up).normalize();
  _b.copy(forward).negate();
  _m.makeBasis(_r, up, _b);
  return out.setFromRotationMatrix(_m);
}

// Project v onto the plane with normal n and normalise; returns false if degenerate.
function projectOnPlane(v, n, out) {
  out.copy(v).addScaledVector(n, -v.dot(n));
  const l = out.length();
  if (l < 1e-5) return false;
  out.multiplyScalar(1 / l);
  return true;
}

export const EMPTY_INPUT = Object.freeze({
  steer: 0, // -1 left (A) .. +1 right (D)
  tuck: false, // W
  brake: false, // S
  roll: 0, // -1 left arrow .. +1 right arrow
  up: false, // up arrow (rodeo / misty modifier)
  pop: false, // Space held
  grab: [false, false, false],
});

export class Rider {
  constructor(terrain) {
    this.terrain = terrain;
    this.pos = new Vector3();
    this.vel = new Vector3();
    this.q = new Quaternion();
    this.omega = new Vector3(); // body-frame angular velocity, deg/s (x = flip, y = spin, z = roll)
    this.events = [];
    this.reset();
  }

  reset() {
    const t = this.terrain;
    const s = t.park.startS;
    this.pos.set(0, t.height(0, -s), -s);
    this.vel.set(0, 0, -1.5);
    this.yaw = 0; // heading of the skis on snow; 0 = straight downhill
    this.mode = 'ground'; // 'ground' | 'air' | 'crash'
    this.switchStance = false;
    this.load = 0;
    this.windup = 0;
    this.pendingPop = 0;
    this.pendingPopTimer = 0;
    this.prevPop = false;
    this.prevGrab = [false, false, false];
    this.lean = 0; // visual carve lean, -1..1
    this.tucking = false;
    this.braking = false;
    this.straighten = 0; // seconds of quick straightening after a sideways landing
    this.omega.set(0, 0, 0);
    this.air = null;
    this.crash = null;
    this.time = 0;
    this.groundTime = 0;
    this.events.length = 0;
    this._groundOrientation();
  }

  get speed() {
    return this.vel.length();
  }

  forward(out) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  _groundOrientation() {
    this.terrain.normal(this.pos.x, this.pos.z, _n);
    this.forward(_a);
    projectOnPlane(_a, _n, _f);
    basisQuat(_f, _n, this.q);
  }

  step(input) {
    this.time += DT;
    if (this.mode === 'ground') this._stepGround(input);
    else if (this.mode === 'air') this._stepAir(input);
    else this._stepCrash(input);
    this.prevPop = input.pop;
    for (let i = 0; i < 3; i++) this.prevGrab[i] = input.grab[i];
  }

  // ---------------------------------------------------------------- on snow
  _stepGround(input) {
    const t = this.terrain;
    const n = t.normal(this.pos.x, this.pos.z, _n);
    this.groundTime += DT;
    const speed = this.vel.length();

    // Load the pop while Space is held; A/D winds the chest up for a spin.
    if (input.pop) {
      this.load = Math.min(1, this.load + DT / PHYS.loadTime);
      this.windup = clamp(this.windup - input.steer * PHYS.windupRate * DT, -1, 1);
    }

    this.tucking = input.tuck && !input.pop;
    this.braking = input.brake;

    // Steering: rotate the skis, and carry most of the velocity round with them.
    const speedT = clamp(speed / 45, 0, 1);
    let turnRate = PHYS.turnRateSlow + (PHYS.turnRateFast - PHYS.turnRateSlow) * speedT;
    if (this.braking) turnRate = PHYS.turnRateSlide;
    if (input.pop) turnRate *= 0.5;
    let dYaw = -input.steer * turnRate * DT;
    if (this.straighten > 0) {
      this.straighten -= DT;
    }
    this.yaw += dYaw;
    this.lean += (input.steer * (0.3 + 0.7 * speedT) - this.lean) * Math.min(1, DT * 8);

    // Carve: rotate velocity about the normal by the same yaw change.
    if (dYaw !== 0 && !this.braking) {
      _q.setFromAxisAngle(n, dYaw * PHYS.carveEfficiency);
      this.vel.applyQuaternion(_q);
    }

    // Gravity along the slope.
    _g.set(0, -PHYS.gravity, 0);
    const gn = _g.dot(n);
    _g.addScaledVector(n, -gn);
    this.vel.addScaledVector(_g, DT);
    // Keep velocity in the snow plane.
    this.vel.addScaledVector(n, -this.vel.dot(n));

    // Ski axes on the plane.
    this.forward(_a);
    projectOnPlane(_a, n, _f);
    _r.crossVectors(_f, n).normalize();

    // Grip: scrub sideways slip. Powerslides slip more (and that slip is lost speed).
    const lat = this.vel.dot(_r);
    const grip = this.braking ? PHYS.gripSlide : PHYS.gripCarve;
    this.vel.addScaledVector(_r, -lat * (1 - Math.exp(-grip * DT)));

    // Snap the skis toward the travel line after a sideways landing.
    if (this.straighten > 0 && speed > 2) {
      projectOnPlane(this.vel, n, _b);
      const travelYaw = Math.atan2(-_b.x, -_b.z) + (this.switchStance ? Math.PI : 0);
      let d = travelYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, DT * 7);
    }

    // Friction, drag, brake.
    const sp = this.vel.length();
    if (sp > 1e-4) {
      const drag = (this.tucking ? PHYS.dragTuck : PHYS.dragStand) * sp * sp;
      const fric = PHYS.snowFriction * PHYS.gravity * Math.max(0, -gn / PHYS.gravity);
      let decel = drag + fric + (this.braking ? PHYS.brakeDecel : 0);
      decel = Math.min(decel * DT, sp);
      this.vel.multiplyScalar((sp - decel) / sp);
    }

    // Poling: tuck on flats gives a small push, but never uphill.
    if (this.tucking && this.vel.length() < PHYS.poleMaxSpeed) {
      const travel = this.vel.lengthSq() > 0.01 ? _b.copy(this.vel).normalize() : _b.copy(_f);
      if (this.switchStance && this.vel.lengthSq() > 0.01) {
        // poling works facing forward only
      } else {
        // No poling uphill (so you can't hike back up to repeat a jump).
        if (travel.y < 0.03) {
          this.vel.addScaledVector(_f, PHYS.poleAccel * DT);
        }
      }
    }

    // Switch detection.
    const vf = this.vel.dot(_f);
    if (this.vel.length() > 1.0) this.switchStance = vf < 0;

    // Release pop.
    let popImpulse = 0;
    const released = this.prevPop && !input.pop;
    if (released) {
      popImpulse = PHYS.popMin + (PHYS.popMax - PHYS.popMin) * this.load;
      if (t.onKickerFace(this.pos.z)) {
        // Too early on the kicker: hold the pop for the lip instead of leaving the ramp.
        this.pendingPop = popImpulse;
        this.pendingPopTimer = PHYS.popBufferTime;
        popImpulse = 0;
      }
    }
    if (!input.pop && !released) {
      this.load = Math.max(0, this.load - DT * 4);
      if (this.pendingPopTimer <= 0) this.windup *= Math.exp(-DT * 2);
    }
    if (this.pendingPopTimer > 0) {
      this.pendingPopTimer -= DT;
      if (this.pendingPopTimer <= 0) this.pendingPop = 0;
    }

    // Move.
    const prevPos = _prev.copy(this.pos);
    const popped = popImpulse > 0;
    if (popped) this.vel.addScaledVector(n, popImpulse);
    this.pos.addScaledVector(this.vel, DT);

    const gy = t.height(this.pos.x, this.pos.z);
    const gap = this.pos.y - gy;
    const n2 = t.normal(this.pos.x, this.pos.z, _a);
    const away = this.vel.dot(n2);

    if (!popped && gap < PHYS.stickGap && away < PHYS.stickNormalSpeed) {
      this.pos.y = gy;
      this.vel.addScaledVector(n2, -this.vel.dot(n2));
      this._groundOrientation();
    } else if (gap < 0 && !popped) {
      this.pos.y = gy;
    } else {
      // Leaving the snow: a lip, a knuckle or a pop.
      if (!popped && this.pendingPop > 0) {
        this.vel.addScaledVector(n, this.pendingPop);
      }
      this._takeoff(prevPos, n);
    }
    if (this.pos.y < gy) this.pos.y = gy;
  }

  _takeoff(prevPos, n) {
    const t = this.terrain;
    // Uphill hops score nothing: is the snow rising along the direction of travel?
    _b.copy(this.vel);
    _b.y = 0;
    let uphill = false;
    if (_b.lengthSq() > 1e-4) {
      _b.normalize();
      const rise = -(n.x * _b.x + n.z * _b.z) / n.y;
      uphill = rise > 0.05 && !t.onKickerFace(prevPos.z);
    }
    const windSpin = Math.sign(this.windup);
    this.air = {
      time: 0,
      startY: this.pos.y,
      maxHeight: 0, // highest point above the take-off
      clearance: 0, // highest point above the snow below
      switchStance: this.switchStance,
      uphill,
      family: null,
      tilt: 0,
      flipSign: 1,
      rollSign: 1,
      spin: 0,
      flip: 0,
      roll: 0,
      grabTimes: {}, // name -> seconds held
      grabOrder: [],
      activeGrab: null,
      grabStack: [],
      windupTimer: Math.abs(this.windup) * PHYS.windupThrowTime,
      windupSign: windSpin,
      aligning: false,
    };
    this.omega.set(0, 0, 0);
    // A thrown wind-up starts the spin straight away.
    if (windSpin !== 0) this.omega.y = windSpin * AIR.spinRate * Math.min(1, Math.abs(this.windup) * 1.2);
    this.load = 0;
    this.windup = 0;
    this.pendingPop = 0;
    this.pendingPopTimer = 0;
    this.mode = 'air';
    this.events.push({ type: 'takeoff', uphill });
  }

  // ---------------------------------------------------------------- in the air
  _stepAir(input) {
    const t = this.terrain;
    const air = this.air;
    air.time += DT;

    // Ballistic flight with a little drag.
    this.vel.y -= PHYS.gravity * DT;
    const sp = this.vel.length();
    if (sp > 0) this.vel.multiplyScalar(Math.max(0, 1 - PHYS.dragAir * sp * DT));
    this.pos.addScaledVector(this.vel, DT);

    const gy = t.height(this.pos.x, this.pos.z);
    air.clearance = Math.max(air.clearance, this.pos.y - gy);
    air.maxHeight = Math.max(air.maxHeight, this.pos.y - air.startY);

    // Grabs: the last one pressed among those held wins.
    for (let i = 0; i < 3; i++) {
      const name = GRAB_SLOTS[i];
      if (input.grab[i] && !this.prevGrab[i]) {
        air.grabStack = air.grabStack.filter((g) => g !== name);
        air.grabStack.push(name);
      }
      if (!input.grab[i]) air.grabStack = air.grabStack.filter((g) => g !== name);
    }
    air.activeGrab = air.grabStack.length ? air.grabStack[air.grabStack.length - 1] : null;
    if (air.activeGrab) {
      if (!(air.activeGrab in air.grabTimes)) {
        air.grabTimes[air.activeGrab] = 0;
        air.grabOrder.push(air.activeGrab);
      }
      air.grabTimes[air.activeGrab] += DT;
    }

    // Rotation inputs, in body-axis signs: +y spin left, +x backflip, +z roll left.
    let spinIn = -input.steer;
    const flipIn = (input.brake ? 1 : 0) - (input.tuck ? 1 : 0);
    const rollIn = -input.roll;
    if (air.windupTimer > 0) {
      air.windupTimer -= DT;
      if (spinIn === 0) spinIn = air.windupSign;
    }
    const anyRot = spinIn !== 0 || flipIn !== 0 || rollIn !== 0;

    // Decide the trick family. Inside the combo window spin + flip makes an off-axis trick.
    if (air.time <= AIR.comboWindow) {
      let fam = null;
      if (spinIn && input.up && flipIn > 0) fam = 'rodeo';
      else if (spinIn && input.up && flipIn < 0) fam = 'misty';
      else if (spinIn && flipIn > 0) fam = 'cork';
      else if (spinIn && flipIn < 0) fam = 'bio';
      else if (spinIn && rollIn) fam = 'flat';
      else if (spinIn) fam = 'spin';
      else if (flipIn) fam = 'flip';
      else if (rollIn) fam = 'side';
      if (fam && (air.family === null || !OFF_AXIS.has(air.family))) {
        if (fam !== air.family) {
          air.family = fam;
          if (OFF_AXIS.has(fam)) {
            air.tilt = AIR.tilt[fam];
            air.flipSign = fam === 'cork' || fam === 'rodeo' ? 1 : -1;
            air.rollSign = Math.sign(rollIn) || 1;
          }
        }
      }
    } else if (air.family === null && anyRot) {
      air.family = spinIn ? 'spin' : flipIn ? 'flip' : 'side';
    }

    // Target angular velocity for this step.
    const boost = air.activeGrab ? AIR.grabSpinBoost : 1;
    const target = _a.set(0, 0, 0);
    const fam = air.family;
    if (fam && OFF_AXIS.has(fam)) {
      if (fam !== 'flat' && flipIn !== 0) {
        // Same flip key adds tilt (more flips per spin); the opposite key slows the flip.
        air.tilt = clamp(air.tilt + flipIn * air.flipSign * AIR.tiltRate * DT, AIR.tiltMin, AIR.tiltMax);
      }
      if (spinIn) {
        const rate = AIR.offAxisRate * boost;
        const s = Math.sin(air.tilt * DEG) * rate;
        const c = Math.cos(air.tilt * DEG) * rate;
        if (fam === 'flat') target.set(0, spinIn * c, air.rollSign * s);
        else target.set(air.flipSign * s, spinIn * c, 0);
      }
    } else if (fam === 'spin') {
      target.set(flipIn * AIR.flipRate * AIR.lateTilt, spinIn * AIR.spinRate * boost, rollIn * AIR.rollRate * AIR.lateTilt);
    } else if (fam === 'flip') {
      target.set(flipIn * AIR.flipRate, spinIn * AIR.spinRate * AIR.lateTilt * boost, 0);
    } else if (fam === 'side') {
      target.set(0, spinIn * AIR.spinRate * AIR.lateTilt * boost, rollIn * AIR.rollRate);
    }

    const kUp = 1 - Math.exp(-AIR.spinUpRate * DT);
    const kDown = 1 - Math.exp(-AIR.spinDownRate * DT);
    this.omega.x += (target.x - this.omega.x) * (target.x !== 0 ? kUp : kDown);
    this.omega.y += (target.y - this.omega.y) * (target.y !== 0 ? kUp : kDown);
    this.omega.z += (target.z - this.omega.z) * (target.z !== 0 ? kUp : kDown);

    this._rotateBody(this.omega.x * DT, this.omega.y * DT, this.omega.z * DT);

    // Landing help: once everything is released, line the skis up for touchdown.
    air.aligning = false;
    if (!anyRot && this.omega.length() < 150) {
      const tau = AIR.alignTime;
      const px = this.pos.x + this.vel.x * tau;
      const pz = this.pos.z + this.vel.z * tau;
      const py = this.pos.y + this.vel.y * tau - 0.5 * PHYS.gravity * tau * tau;
      if (py < t.height(px, pz) + 0.3 || this.pos.y - gy < 1.2) {
        air.aligning = true;
        this._alignForLanding(px, pz);
      }
    }

    // Touchdown?
    if (this.pos.y <= gy) {
      this.pos.y = gy;
      this._land(input);
    }
  }

  // Rotate the body about its own axes (degrees) and add to the trick record.
  _rotateBody(dx, dy, dz) {
    const ang = Math.hypot(dx, dy, dz);
    if (ang < 1e-9) return;
    _b.set(dx / ang, dy / ang, dz / ang);
    _q.setFromAxisAngle(_b, ang * DEG);
    this.q.multiply(_q).normalize();
    this.air.spin += dy;
    this.air.flip += dx;
    this.air.roll += dz;
  }

  _alignForLanding(px, pz) {
    const n = this.terrain.normal(px, pz, _n);
    // Travel direction along the landing slope.
    if (!projectOnPlane(this.vel, n, _g)) return;
    const fb = _f.set(0, 0, -1).applyQuaternion(this.q);
    const ok = projectOnPlane(fb, n, _r);
    let target;
    if (!ok) {
      target = _g;
    } else {
      const d = _r.dot(_g);
      const sign = d >= 0 ? 1 : -1;
      const folded = Math.acos(clamp(Math.abs(d), 0, 1)) / DEG;
      if (folded < 40) target = _g.multiplyScalar(sign);
      else target = _r; // too far round: just level out, keep the yaw
    }
    basisQuat(target.clone(), n, _q2);
    // Body-frame delta from current to target, limited by the align rate.
    const maxStep = AIR.alignRate * DEG * DT;
    _q.copy(this.q).invert().multiply(_q2); // delta in body frame
    if (_q.w < 0) {
      _q.x = -_q.x;
      _q.y = -_q.y;
      _q.z = -_q.z;
      _q.w = -_q.w;
    }
    const angle = 2 * Math.acos(clamp(_q.w, -1, 1));
    if (angle < 1e-5) return;
    const sinH = Math.sqrt(Math.max(1e-12, 1 - _q.w * _q.w));
    const step = Math.min(angle, maxStep);
    const k = step / DEG;
    this._rotateBody((_q.x / sinH) * k, (_q.y / sinH) * k, (_q.z / sinH) * k);
  }

  _land(input) {
    const t = this.terrain;
    const air = this.air;
    const n = t.normal(this.pos.x, this.pos.z, _n);

    const bodyUp = _a.set(0, 1, 0).applyQuaternion(this.q);
    const tiltErr = Math.acos(clamp(bodyUp.dot(n), -1, 1)) / DEG;

    const fbRaw = _f.set(0, 0, -1).applyQuaternion(this.q);
    const pitchErr = Math.asin(clamp(Math.abs(fbRaw.dot(n)), 0, 1)) / DEG;
    const hasFb = projectOnPlane(fbRaw, n, _r);
    const hasTravel = projectOnPlane(this.vel, n, _g);
    let yawErr = 0;
    if (hasFb && hasTravel) yawErr = Math.acos(clamp(_r.dot(_g), -1, 1)) / DEG;
    const switchLand = yawErr > 90;
    const folded = Math.min(yawErr, 180 - yawErr);

    const scoredAir = !air.uphill && (air.time >= LAND.minScoredAir || air.clearance >= LAND.minScoredHeight);
    const rotHeld =
      (input.steer !== 0 || input.tuck || input.brake || input.roll !== 0) && this.omega.length() > LAND.maxSpinHeld;
    const grabHeld = input.grab[0] || input.grab[1] || input.grab[2];

    let quality;
    let keep = 1;
    let reason = '';
    if (tiltErr > LAND.maxTilt) {
      quality = 'crash';
      reason = bodyUp.dot(n) < 0 ? 'head first' : 'over-rotated';
    } else if (scoredAir && (rotHeld || grabHeld)) {
      quality = 'crash';
      reason = 'held into the snow';
    } else if (folded <= LAND.cleanYaw) {
      quality = 'clean';
    } else if (folded <= LAND.sidewaysYaw) {
      quality = 'sideways';
      keep = 1 - 0.5 * ((folded - LAND.cleanYaw) / (LAND.sidewaysYaw - LAND.cleanYaw));
    } else {
      quality = 'saved';
      keep = 0.5;
    }

    const landing = {
      quality,
      keep,
      reason,
      stomped: quality === 'clean' && pitchErr > LAND.stompedPitch,
      switchLand,
      yawErr: folded,
      tiltErr,
      scored: scoredAir,
      airTime: air.time,
      height: air.maxHeight,
      air,
    };

    // Keep only the along-slope part of the velocity; a flat landing smacks off some speed.
    const into = -this.vel.dot(n);
    this.vel.addScaledVector(n, into);
    if (into > 0) {
      const sp = this.vel.length();
      const loss = Math.min(sp, into * 0.15);
      if (sp > 0) this.vel.multiplyScalar((sp - loss) / sp);
    }

    if (quality === 'crash') {
      this._startCrash(switchLand);
    } else {
      // Ride away: skis take the heading of the body, then straighten onto the travel line.
      if (hasFb) {
        this.yaw = Math.atan2(-_r.x, -_r.z);
      }
      this.switchStance = switchLand;
      this.mode = 'ground';
      this.groundTime = 0;
      this.straighten = quality === 'clean' ? 0.25 : 0.7;
      this.omega.set(0, 0, 0);
      this._groundOrientation();
    }
    this.air = null;
    this.events.push({ type: 'land', landing });
  }

  // ---------------------------------------------------------------- crash
  _startCrash(switchLand) {
    this.mode = 'crash';
    this.crash = { time: 0, onBack: switchLand, getUp: 0 };
    this.omega.set(0, 0, 0);
    this.load = 0;
    this.windup = 0;
    this._crashOrientation();
  }

  _crashOrientation() {
    const n = this.terrain.normal(this.pos.x, this.pos.z, _n);
    if (!projectOnPlane(this.vel, n, _g)) this.forward(_g);
    // Head points down the line of travel; face into the snow (front) or up (back).
    const forward = _f.copy(n).multiplyScalar(this.crash.onBack ? 1 : -1);
    _r.crossVectors(forward, _g).normalize();
    _b.copy(forward).negate();
    _m.makeBasis(_r, _g, _b);
    this.q.setFromRotationMatrix(_m);
  }

  _stepCrash() {
    const t = this.terrain;
    const c = this.crash;
    c.time += DT;
    const n = t.normal(this.pos.x, this.pos.z, _n);
    _g.set(0, -PHYS.gravity, 0);
    const gn = _g.dot(n);
    _g.addScaledVector(n, -gn);
    this.vel.addScaledVector(_g, DT);
    this.vel.addScaledVector(n, -this.vel.dot(n));
    const sp = this.vel.length();
    if (sp > 0) {
      const decel = Math.min(sp, (CRASH.friction * -gn + 0.004 * sp * sp) * DT);
      this.vel.multiplyScalar((sp - decel) / sp);
    }
    this.pos.addScaledVector(this.vel, DT);
    this.pos.y = t.height(this.pos.x, this.pos.z);

    if (c.getUp > 0) {
      c.getUp -= DT;
      if (c.getUp <= 0) this._getUp();
      return;
    }
    if (this.vel.length() > 1) this._crashOrientation();
    if (c.time > CRASH.minTime && this.vel.length() < CRASH.restSpeed) {
      c.getUp = CRASH.getUpTime;
      this.events.push({ type: 'getup' });
    }
  }

  _getUp() {
    this.mode = 'ground';
    this.crash = null;
    this.yaw = 0;
    this.switchStance = false;
    this.vel.set(0, 0, -1);
    this.groundTime = 0;
    this._groundOrientation();
  }

  // Grab and pose info for the renderer.
  get activeGrab() {
    return this.air ? this.air.activeGrab : null;
  }
}
