// Rider controller: fixed-timestep, deterministic (no randomness, no wall clock).
// Same inputs in, same run out, so replays and server re-rides can come later.

import { Vector3, Quaternion, Matrix4 } from 'three';
import { DT, PHYS, AIR, LAND, CRASH, RAIL, BUTTER, POWDER, PIPE } from './constants.js';
import { OFF_AXIS } from './tricks.js';

const DEG = Math.PI / 180;
const DEFAULT_GRABS = ['mute', 'tail', 'japan'];

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
const _p = new Vector3();
const _d = new Vector3();
const UPV = new Vector3(0, 1, 0);

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
  butter: false, // B held (with S = tail butter)
});

export class Rider {
  constructor(terrain) {
    this.terrain = terrain;
    this.pos = new Vector3();
    this.vel = new Vector3();
    this.q = new Quaternion();
    this.omega = new Vector3(); // body-frame angular velocity, deg/s (x = flip, y = spin, z = roll)
    this.skiDir = new Vector3(0, 0, -1); // where the ski tips point, kept on the snow plane
    this.grabSlots = DEFAULT_GRABS.slice(); // which grab sits on each of the 3 grab buttons (Locker)
    this.board = false; // riding a snowboard: tricks add FS / BS / Cab
    this.events = [];
    this.reset();
  }

  reset() {
    const t = this.terrain;
    const s = t.park.startS;
    const x = t.center(s);
    this.pos.set(x, t.height(x, -s), -s);
    this.courseDir(s, this.skiDir);
    this.vel.copy(this.skiDir).multiplyScalar(1.5);
    this.mode = 'ground'; // 'ground' | 'air' | 'crash'
    this.switchStance = false;
    this.load = 0;
    this.windup = 0;
    this.pendingPop = 0;
    this.pendingPopTimer = 0;
    this.prevPop = false;
    this.prevGrab = [false, false, false];
    this.prevSteer = 0;
    this.prevButter = false;
    this.rail = null; // on a rail: { rail, d, dir, speed, stance, ... }
    this.railCooldown = 0;
    this.lastRail = -1;
    this.butter = null; // pressing a butter: { kind, time, turned, carry, deep, fromLanding }
    this.butterCooldown = 0;
    this.powder = 0; // 0..1 depth of snow underfoot
    this.sink = 0; // how far the rider has sunk into powder (m), for the renderer
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
    return out.copy(this.skiDir);
  }

  // Horizontal direction straight down the course at distance s.
  courseDir(s, out) {
    return out.set(this.terrain.centerSlope(s), 0, -1).normalize();
  }

  _groundOrientation() {
    const n = this.terrain.normal(this.pos.x, this.pos.z, _n);
    if (!projectOnPlane(this.skiDir, n, _f)) {
      if (!projectOnPlane(this.vel, n, _f)) projectOnPlane(this.courseDir(-this.pos.z, _a), n, _f);
    }
    this.skiDir.copy(_f);
    basisQuat(_f, n, this.q);
  }

  // Push the rider back onto the snow along the surface normal (works on steep pipe walls).
  _snapToSurface() {
    const t = this.terrain;
    for (let k = 0; k < 3; k++) {
      const gy = t.height(this.pos.x, this.pos.z);
      const dy = gy - this.pos.y;
      if (Math.abs(dy) < 1e-4) break;
      const n = t.normal(this.pos.x, this.pos.z, _a);
      const d = dy * n.y;
      this.pos.x += n.x * d;
      this.pos.z += n.z * d;
      this.pos.y += n.y * d;
    }
    const gy = t.height(this.pos.x, this.pos.z);
    if (this.pos.y < gy) this.pos.y = gy;
  }

  // Trees, houses and the ball push you away instead of throwing you.
  _collide() {
    const t = this.terrain;
    const p = this.pos;
    const s = -p.z;
    for (const list of t.treesNear(s)) {
      if (!list) continue;
      for (const tr of list) {
        const dx = p.x - tr.x;
        const dz = p.z + tr.s;
        const r = 0.45 * tr.scale + 0.35;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const nz = dz / d;
        p.x += nx * (r - d);
        p.z += nz * (r - d);
        const into = this.vel.x * nx + this.vel.z * nz;
        if (into < 0) {
          this.vel.x -= into * nx * 1.3;
          this.vel.z -= into * nz * 1.3;
          this.vel.multiplyScalar(0.8);
          this.events.push({ type: 'bump', what: 'tree', speed: -into });
        }
      }
    }
    for (const o of t.obstacles) {
      if (o.type === 'house') {
        if (p.x < o.minX - 0.4 || p.x > o.maxX + 0.4 || p.z < o.minZ - 0.4 || p.z > o.maxZ + 0.4) continue;
        if (p.y > o.y + o.h) continue;
        const pen = [p.x - (o.minX - 0.4), o.maxX + 0.4 - p.x, p.z - (o.minZ - 0.4), o.maxZ + 0.4 - p.z];
        const i = pen.indexOf(Math.min(...pen));
        if (i === 0) {
          p.x = o.minX - 0.4;
          if (this.vel.x > 0) this.vel.x *= -0.3;
        } else if (i === 1) {
          p.x = o.maxX + 0.4;
          if (this.vel.x < 0) this.vel.x *= -0.3;
        } else if (i === 2) {
          p.z = o.minZ - 0.4;
          if (this.vel.z > 0) this.vel.z *= -0.3;
        } else {
          p.z = o.maxZ + 0.4;
          if (this.vel.z < 0) this.vel.z *= -0.3;
        }
        this.events.push({ type: 'bump', what: 'house', speed: this.vel.length() });
      } else if (o.type === 'ball') {
        const cx = p.x - o.x;
        const cy = p.y + 0.9 - o.y;
        const cz = p.z - o.z;
        const r = o.r + 0.5;
        const d2 = cx * cx + cy * cy + cz * cz;
        if (d2 >= r * r || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const nx = cx / d;
        const ny = cy / d;
        const nz = cz / d;
        p.x += nx * (r - d);
        p.z += nz * (r - d);
        if (this.mode === 'air') p.y += ny * (r - d);
        const into = this.vel.x * nx + this.vel.y * ny + this.vel.z * nz;
        if (into < 0) {
          this.vel.x -= into * nx * 1.4;
          this.vel.y -= this.mode === 'air' ? into * ny * 1.4 : 0;
          this.vel.z -= into * nz * 1.4;
          if (o.ring) this.events.push({ type: 'ring', speed: -into });
        }
      }
    }
  }

  step(input) {
    this.time += DT;
    if (this.railCooldown > 0) this.railCooldown -= DT;
    if (this.butterCooldown > 0) this.butterCooldown -= DT;
    if (this.mode === 'ground') this._stepGround(input);
    else if (this.mode === 'air') this._stepAir(input);
    else if (this.mode === 'rail') this._stepRail(input);
    else this._stepCrash(input);
    if (this.mode !== 'rail') this._collide();
    this.prevPop = input.pop;
    this.prevSteer = input.steer;
    this.prevButter = !!input.butter;
    for (let i = 0; i < 3; i++) this.prevGrab[i] = input.grab[i];
  }

  // ---------------------------------------------------------------- on snow
  _stepGround(input) {
    const t = this.terrain;
    const n = t.normal(this.pos.x, this.pos.z, _n);
    this.groundTime += DT;
    const speed = this.vel.length();
    // Deep snow: you sink in (less as you plane at speed) and it slows you.
    const pw = t.powder(this.pos.x, this.pos.z);
    this.powder = pw;
    const sinkTarget = pw * POWDER.sink * (1 - 0.5 * Math.min(1, speed / 25));
    this.sink += (sinkTarget - this.sink) * Math.min(1, DT * 5);

    // Load the pop while Space is held; A/D winds the chest up for a spin.
    if (input.pop) {
      this.load = Math.min(1, this.load + DT / PHYS.loadTime);
      this.windup = clamp(this.windup - input.steer * PHYS.windupRate * DT, -1, 1);
    }

    // Butters: B arms a nose press, B + S a tail press.
    if (!this.butter && input.butter && !this.prevButter && this.butterCooldown <= 0 && !input.pop) {
      this.butter = { kind: input.brake ? 'tail' : 'nose', time: 0, turned: 0, carry: 0, deep: false, fromLanding: false };
    }
    const B = this.butter;
    this.tucking = input.tuck && !input.pop && !B;
    this.braking = input.brake && !B;

    // Steering: rotate the skis, and carry most of the velocity round with them.
    const speedT = clamp(speed / 45, 0, 1);
    let turnRate = PHYS.turnRateSlow + (PHYS.turnRateFast - PHYS.turnRateSlow) * speedT;
    if (this.braking) turnRate = PHYS.turnRateSlide;
    turnRate *= 1 - (1 - POWDER.turnFactor) * pw;
    if (input.pop) turnRate *= 0.5;
    let dYaw = B ? 0 : -input.steer * turnRate * DT;
    if (this.straighten > 0) {
      this.straighten -= DT;
    }
    let butterYaw = 0;
    if (B) {
      B.time += DT;
      // A/D turns the press (up to a half turn); a butter landing carries its spin.
      B.carry *= Math.exp(-2.2 * DT);
      let rate = -input.steer * BUTTER.turnRate + B.carry;
      const limit = B.fromLanding ? 400 : BUTTER.maxTurn;
      if (Math.abs(B.turned + rate * DT) > limit) rate = 0;
      butterYaw = rate * DT;
      B.turned += butterYaw;
    }
    if (!projectOnPlane(this.skiDir, n, _f)) projectOnPlane(this.vel, n, _f);
    this.skiDir.copy(_f);
    if (dYaw !== 0 || butterYaw !== 0) {
      _q.setFromAxisAngle(n, dYaw + butterYaw * DEG);
      this.skiDir.applyQuaternion(_q);
    }
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
    const grip = this.braking || B ? PHYS.gripSlide : PHYS.gripCarve;
    this.vel.addScaledVector(_r, -lat * (1 - Math.exp(-grip * DT)));

    // Snap the skis toward the travel line after a sideways landing.
    if (this.straighten > 0 && speed > 2) {
      if (projectOnPlane(this.vel, n, _b)) {
        if (this.switchStance) _b.negate();
        this.skiDir.lerp(_b, Math.min(1, DT * 7)).normalize();
      }
    }

    // Friction, drag, brake.
    const sp = this.vel.length();
    if (sp > 1e-4) {
      const drag = (this.tucking ? PHYS.dragTuck : PHYS.dragStand) * sp * sp;
      const fric = PHYS.snowFriction * PHYS.gravity * Math.max(0, -gn / PHYS.gravity);
      let decel = drag + fric + (this.braking ? PHYS.brakeDecel : 0) + (B ? BUTTER.drag : 0);
      decel += pw * (POWDER.drag + POWDER.dragQuad * sp * sp);
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

    // End of a butter: release early to rebound; it lasts at most 1.5 s.
    let rebound = 0;
    if (B && (!input.butter || B.time >= BUTTER.maxTime)) {
      if (!input.butter && B.time < BUTTER.maxTime && B.time > 0.2) rebound = BUTTER.rebound;
      this.events.push({ type: 'butter', kind: B.kind, time: B.time, turned: B.turned, deep: B.deep, fromLanding: B.fromLanding });
      this.butter = null;
      this.butterCooldown = BUTTER.cooldown;
      this.straighten = 0.4;
    }

    // Release pop.
    let popImpulse = 0;
    const released = this.prevPop && !input.pop;
    if (released) {
      popImpulse = PHYS.popMin + (PHYS.popMax - PHYS.popMin) * this.load;
      if (t.onKickerFace(this.pos.x, this.pos.z)) {
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
    if (rebound > 0) popImpulse = rebound;
    const popped = popImpulse > 0;
    if (popped) this.vel.addScaledVector(n, popImpulse);
    this.pos.addScaledVector(this.vel, DT);

    const gy = t.height(this.pos.x, this.pos.z);
    const n2 = t.normal(this.pos.x, this.pos.z, _a);
    const gap = (this.pos.y - gy) * n2.y; // distance from the snow along its normal
    const away = this.vel.dot(n2);

    // Superpipe: riding out over the coping always launches you (the top is vertical).
    let overCoping = false;
    if (t.cross.type === 'pipe') {
      const uPrev = Math.abs(prevPos.x - t.center(-prevPos.z));
      const uNow = Math.abs(this.pos.x - t.center(-this.pos.z));
      overCoping = uPrev < t.cross.lipU - 0.02 && uNow >= t.cross.lipU - 0.02;
    }

    if (!popped && !overCoping && gap < PHYS.stickGap && away < PHYS.stickNormalSpeed) {
      this._snapToSurface();
      const n3 = t.normal(this.pos.x, this.pos.z, _a);
      this.vel.addScaledVector(n3, -this.vel.dot(n3));
      this._groundOrientation();
    } else if (gap < 0 && !popped && !overCoping) {
      this._snapToSurface();
    } else {
      // Leaving the snow: a lip, a knuckle or a pop.
      if (!popped && this.pendingPop > 0) {
        this.vel.addScaledVector(n, this.pendingPop);
      }
      this._takeoff(prevPos, n);
      return;
    }
    // Ride onto a box or rail from the snow.
    this._tryRail();

    // A lined-up rail lip guides you onto the bar.
    const lip = t.railLipAt(this.pos.x, this.pos.z);
    if (lip && this.mode === 'ground') this._lipAssist(lip.rail);
  }

  _lipAssist(rail) {
    const t = this.terrain;
    t.railPoint(rail, 0, _p, _d);
    _d.y = 0;
    _d.normalize();
    const hv = _b.set(this.vel.x, 0, this.vel.z);
    const sp = hv.length();
    if (sp < 2) return;
    hv.multiplyScalar(1 / sp);
    const ang = Math.acos(clamp(hv.dot(_d), -1, 1)) / DEG;
    if (ang > RAIL.lipAssistAngle) return; // aim away and you pass by
    // Sideways offset from the rail line, removed smoothly.
    const ox = this.pos.x - _p.x;
    const oz = this.pos.z - _p.z;
    const along = ox * _d.x + oz * _d.z;
    const lx = ox - _d.x * along;
    const lz = oz - _d.z * along;
    const k = Math.min(1, RAIL.lipAssist * DT);
    this.pos.x -= lx * k;
    this.pos.z -= lz * k;
    // Turn travel toward the rail direction too.
    const vy = this.vel.y;
    _b.copy(_d).multiplyScalar(sp);
    this.vel.x += (_b.x - this.vel.x) * k;
    this.vel.z += (_b.z - this.vel.z) * k;
    this.vel.y = vy;
  }

  // Catch a rail from the air (or from the snow for low boxes).
  _tryRail() {
    const t = this.terrain;
    const list = t.railsNear(-this.pos.z);
    if (!list) return false;
    const inAir = this.mode === 'air';
    for (const rail of list) {
      if (rail.index === this.lastRail && this.railCooldown > 0) continue;
      const near = t.railNearest(rail, this.pos.x, this.pos.z);
      if (near.dist > (inAir ? RAIL.captureAir : RAIL.captureGround)) continue;
      const dy = this.pos.y - near.y;
      if (inAir) {
        if (dy < -0.45 || dy > 1.2 || this.vel.y > 2.5) continue;
        _a.set(0, 1, 0).applyQuaternion(this.q);
        if (_a.y < 0.6) continue;
      } else if (dy < -0.6 || dy > 0.5) continue;
      if (near.d >= rail.length - 0.3) continue;
      t.railPoint(rail, near.d, _p, _d);
      const along = this.vel.dot(_d);
      if (Math.abs(along) < 2) continue;
      if (this.butter) continue; // no butters on rails or boxes
      this._enterRail(rail, near.d, Math.sign(along), Math.abs(along));
      return true;
    }
    return false;
  }

  _enterRail(rail, d, dir, speed) {
    // Stance: body yaw relative to the rail, snapped to quarter turns.
    const t = this.terrain;
    t.railPoint(rail, d, _p, _d);
    _d.multiplyScalar(dir);
    const fb = _f.set(0, 0, -1).applyQuaternion(this.q);
    fb.y = 0;
    _d.y = 0;
    let stance = 0;
    if (fb.lengthSq() > 1e-4 && _d.lengthSq() > 1e-4) {
      fb.normalize();
      _d.normalize();
      const cross = _d.z * fb.x - _d.x * fb.z; // + when the body is turned left of travel
      stance = Math.round((Math.atan2(cross, _d.dot(fb)) / DEG) / 90) * 90;
    }
    if (stance <= -180) stance += 360;
    if (stance > 180) stance -= 360;
    const fromAir = this.mode === 'air' ? this.air : null;
    this.rail = { rail, d, dir, speed, stance, stanceVis: stance, swaps: 0, hops: 0, time: 0, hopY: 0, hopV: 0, popTime: 0, press: false, pressTime: 0, fromAir };
    this.mode = 'rail';
    this.air = null;
    this.butter = null;
    this.omega.set(0, 0, 0);
    this.load = 0;
    this.windup = 0;
    this.events.push({ type: 'railOn', kind: rail.kind, stance });
    this._railOrientation();
  }

  _railOrientation() {
    const R = this.rail;
    this.terrain.railPoint(R.rail, R.d, _p, _d);
    _d.multiplyScalar(R.dir);
    _d.y = 0;
    if (_d.lengthSq() < 1e-6) _d.set(0, 0, -1);
    _d.normalize();
    _q.setFromAxisAngle(UPV, R.stanceVis * DEG);
    _d.applyQuaternion(_q);
    basisQuat(_d, UPV, this.q);
    this.skiDir.copy(_d);
  }

  // ---------------------------------------------------------------- on a rail
  _stepRail(input) {
    const t = this.terrain;
    const R = this.rail;
    R.time += DT;
    t.railPoint(R.rail, R.d, _p, _d);
    // Rails keep your speed; downhill rails add speed.
    R.speed += (-PHYS.gravity * _d.y * R.dir - RAIL.friction) * DT;
    if (R.speed < 0.8) {
      this._exitRail(input, 0);
      return;
    }
    R.d += R.dir * R.speed * DT;

    // A/D locks a quarter-turn swap (two per rail).
    if (input.steer !== 0 && this.prevSteer === 0 && R.swaps < RAIL.maxSwaps && R.hopY === 0) {
      R.stance += input.steer < 0 ? 90 : -90;
      if (R.stance > 180) R.stance -= 360;
      if (R.stance <= -180) R.stance += 360;
      R.swaps++;
      this.events.push({ type: 'railTrick', what: 'SWAP' });
    }
    let dv = R.stance - R.stanceVis;
    dv = ((dv + 540) % 360) - 180;
    R.stanceVis += dv * Math.min(1, DT / RAIL.swapTime);

    // Space: tap to hop, hold to press. A hop near the end pops you off.
    if (input.pop) {
      R.popTime += DT;
      R.press = R.popTime >= RAIL.pressTime && R.hopY === 0;
      if (R.press) R.pressTime += DT;
    } else if (this.prevPop) {
      if (R.popTime < RAIL.pressTime && R.hopY === 0) {
        const remaining = R.dir > 0 ? R.rail.length - R.d : R.d;
        if (remaining < RAIL.endZone) {
          this._exitRail(input, RAIL.endPop);
          return;
        }
        R.hopV = RAIL.hopSpeed;
        R.hops++;
        this.events.push({ type: 'railTrick', what: 'HOP' });
      }
      R.popTime = 0;
      R.press = false;
    }
    if (R.hopV !== 0 || R.hopY > 0) {
      R.hopY += R.hopV * DT;
      R.hopV -= PHYS.gravity * DT;
      if (R.hopY <= 0) {
        R.hopY = 0;
        R.hopV = 0;
      }
    }

    if (R.d >= R.rail.length || R.d <= 0) {
      R.d = Math.max(0, Math.min(R.rail.length, R.d));
      this._exitRail(input, 0);
      return;
    }
    t.railPoint(R.rail, R.d, _p, _d);
    this.pos.set(_p.x, _p.y + R.hopY, _p.z);
    this.vel.copy(_d).multiplyScalar(R.dir * R.speed);
    this.vel.y += R.hopV;
    this._railOrientation();
  }

  _exitRail(input, pop) {
    const R = this.rail;
    this.events.push({ type: 'railOff', kind: R.rail.kind, time: R.time, swaps: R.swaps, hops: R.hops, press: R.pressTime, stance: R.stance });
    this.lastRail = R.rail.index;
    this.railCooldown = 0.5;
    this.vel.y += RAIL.exitPop + pop;
    this.rail = null;
    this.switchStance = Math.abs(R.stance) > 90;
    this._takeoff(this.pos, UPV, { fromRail: true, stance: R.stance });
    // Spin carries off the end; W/S held off a kick-up starts a flip.
    const air = this.air;
    if (input.steer) {
      air.family = 'spin';
      this.omega.y = -input.steer * AIR.spinRate;
    } else if (input.tuck || input.brake) {
      air.family = 'flip';
      this.omega.x = ((input.brake ? 1 : 0) - (input.tuck ? 1 : 0)) * AIR.flipRate * 0.7;
    }
  }

  _takeoff(prevPos, n, opts = {}) {
    const t = this.terrain;
    // Uphill hops score nothing: is the snow rising along the direction of travel?
    _b.copy(this.vel);
    _b.y = 0;
    let uphill = false;
    if (_b.lengthSq() > 1e-4) {
      _b.normalize();
      const rise = -(n.x * _b.x + n.z * _b.z) / n.y;
      uphill = rise > 0.05 && rise < 1.2 && !t.onKickerFace(prevPos.x, prevPos.z);
    }
    if (opts.fromRail) uphill = false;
    // Superpipe: the top of the wall is vertical, so whatever speed carries you
    // out over the coping turns into height and you come back down into the pipe.
    if (t.cross.type === 'pipe') {
      const u = this.pos.x - t.center(-this.pos.z);
      if (Math.abs(u) > t.cross.floor + 2) {
        const out = Math.sign(u);
        const vOut = this.vel.x * out;
        if (vOut > -0.6) {
          this.vel.y = Math.hypot(Math.max(0, this.vel.y), Math.max(0, vOut) * 0.95);
          this.vel.x = -out * 0.6;
        }
        uphill = false;
      }
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
      fromRail: !!opts.fromRail,
      railStance: opts.stance || 0,
    };
    this.omega.set(0, 0, 0);
    // A thrown wind-up starts the spin straight away.
    if (windSpin !== 0) this.omega.y = windSpin * AIR.spinRate * Math.min(1, Math.abs(this.windup) * 1.2);
    this.load = 0;
    this.windup = 0;
    this.pendingPop = 0;
    this.pendingPopTimer = 0;
    this.mode = 'air';
    this.butter = null;
    this.events.push({ type: 'takeoff', uphill, fromRail: !!opts.fromRail });
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
      const name = this.grabSlots[i];
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
    let flipIn = (input.brake ? 1 : 0) - (input.tuck ? 1 : 0);
    if (input.butter) {
      // Holding B for a butter landing: W/S tip the skis forward/back instead of flipping.
      air.deepPitch = clamp((air.deepPitch || 0) + flipIn * 70 * DT, -55, 55);
      flipIn = 0;
    }
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
        this._alignForLanding(px, pz, input.butter ? air.deepPitch || 0 : 0);
      }
    }

    // Catch a rail on the way down.
    if (this._tryRail()) return;

    // Touchdown?
    if (this.pos.y <= gy) {
      this._snapToSurface();
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

  _alignForLanding(px, pz, pitch = 0) {
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
      // More help lining up on a pipe wall, where the travel line bends a lot in the air.
      const help = this.terrain.cross.type === 'pipe' && n.y < PIPE.wallSlope ? 65 : 40;
      if (folded < help) target = _g.multiplyScalar(sign);
      else target = _r; // too far round: just level out, keep the yaw
    }
    basisQuat(target.clone(), n, _q2);
    if (pitch) _q2.multiply(_q.setFromAxisAngle(_a.set(1, 0, 0), pitch * DEG));
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
    // Landing a low grab in powder releases it on touch.
    const inPowder = t.powder(this.pos.x, this.pos.z) > 0.5;
    const grabHeld = !inPowder && (input.grab[0] || input.grab[1] || input.grab[2]);
    const butterLand = !!input.butter && scoredAir;
    const impact = -this.vel.dot(n);

    let quality;
    let keep = 1;
    let reason = '';
    if (butterLand && impact > BUTTER.faceplantImpact) {
      quality = 'crash';
      reason = 'faceplant';
    } else if (butterLand && pitchErr > BUTTER.deepMax) {
      quality = 'crash';
      reason = 'too deep';
    } else if (butterLand && !grabHeld && tiltErr <= LAND.maxTilt) {
      // Landing into a butter keeps the spin going; sideways is fine.
      quality = folded <= LAND.sidewaysYaw ? 'clean' : 'saved';
      keep = quality === 'clean' ? 1 : 0.5;
    } else if (tiltErr > LAND.maxTilt) {
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
      stomped: quality === 'clean' && pitchErr > LAND.stompedPitch && !butterLand,
      butter: butterLand && quality !== 'crash',
      deep: butterLand && pitchErr >= BUTTER.deepMin,
      switchLand,
      yawErr: folded,
      tiltErr,
      scored: scoredAir,
      airTime: air.time,
      height: air.maxHeight,
      air,
    };

    // Keep only the along-slope part of the velocity; a flat landing smacks off some speed.
    const speedIn = this.vel.length();
    const into = -this.vel.dot(n);
    this.vel.addScaledVector(n, into);
    const wall = t.cross.type === 'pipe' && n.y < PIPE.wallSlope;
    if (wall && quality !== 'crash' && this.vel.lengthSq() > 1e-6) {
      // Superpipe: wall landings keep speed, so good hits climb higher.
      const keepSpeed = speedIn * (quality === 'clean' ? PIPE.cleanKeep : PIPE.sidewaysKeep);
      this.vel.setLength(keepSpeed);
      landing.wall = true;
    } else if (into > 0) {
      const sp = this.vel.length();
      const loss = Math.min(sp, into * (inPowder ? POWDER.landingLoss : 0.15));
      if (sp > 0) this.vel.multiplyScalar((sp - loss) / sp);
    }

    if (quality === 'crash') {
      this._startCrash(switchLand);
    } else {
      // Ride away: skis take the heading of the body, then straighten onto the travel line.
      if (hasFb) this.skiDir.copy(_r);
      this.switchStance = switchLand;
      this.mode = 'ground';
      this.groundTime = 0;
      this.straighten = quality === 'clean' ? 0.25 : 0.7;
      if (butterLand) {
        // Into a butter: nose if the tips were down, tail if they were up.
        this.butter = {
          kind: fbRaw.dot(n) < 0 ? 'nose' : 'tail',
          time: 0,
          turned: 0,
          carry: this.omega.y,
          deep: pitchErr >= BUTTER.deepMin,
          fromLanding: true,
        };
        this.straighten = 0;
      }
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
    this._snapToSurface();

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
    this.courseDir(-this.pos.z, this.skiDir);
    this.switchStance = false;
    this.vel.copy(this.skiDir);
    this.groundTime = 0;
    this._groundOrientation();
  }

  // Pause menu "reset position": back on the piste where you are, standing still.
  resetPosition() {
    const t = this.terrain;
    const s = Math.max(t.park.startS, Math.min(t.park.finishS - 5, -this.pos.z));
    const x = t.center(s);
    this.pos.set(x, t.height(x, -s), -s);
    this.courseDir(s, this.skiDir);
    this.vel.copy(this.skiDir).multiplyScalar(0.5);
    this.mode = 'ground';
    this.air = this.rail = this.butter = this.crash = null;
    this.omega.set(0, 0, 0);
    this.switchStance = false;
    this.load = this.windup = 0;
    this._groundOrientation();
  }

  // Grab and pose info for the renderer.
  get activeGrab() {
    return this.air ? this.air.activeGrab : null;
  }
}
