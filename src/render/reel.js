// Duel highlight reel: both riders' best runs, re-ridden from their recorded
// inputs and played side by side (two cameras, one park), with their names
// and the tricks they land.
import * as THREE from 'three';
import { simulateReplay, FRAME_DT } from '../replay/player.js';
import { frameRider, placeRider, poseFor, STRIDE } from './pose.js';
import { RiderModel, DEFAULT_LOOK } from './riderModel.js';
import { ASSETS } from './assets.js';
import { unpackRuns, SIM_VERSION } from '../replay/record.js';

const $ = (id) => document.getElementById(id);

// A duel record ({ steps, inputs (packed), marks, grabSlots, board }) as replay data.
export function replayData(rec) {
  return {
    version: rec.version ?? SIM_VERSION,
    inputs: { runs: typeof rec.inputs === 'string' ? unpackRuns(rec.inputs) : rec.inputs, steps: rec.steps, marks: rec.marks || [] },
    grabSlots: rec.grabSlots,
    board: !!rec.board,
  };
}

export class Reel {
  /**
   * sides: [{ record, look, tag }, { record, look, tag }] (left, right)
   */
  constructor({ renderer, world, terrain, sides }) {
    this.renderer = renderer;
    this.world = world;
    this.terrain = terrain;
    this.t = 0;
    this._lastT = -1;
    this.sides = sides.map((s) => {
      const rep = s.record ? simulateReplay(terrain, replayData(s.record)) : null;
      const model = new RiderModel({ ...DEFAULT_LOOK, ...(s.look || {}) });
      if (ASSETS.ready) {
        model.upgrade(ASSETS.parts);
        model.applyLook({ ...DEFAULT_LOOK, ...(s.look || {}) });
      }
      world.scene.add(model.root);
      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 6000);
      return { ...s, rep, model, camera, view: {}, pos: new THREE.Vector3(), prev: new THREE.Vector3(), camPos: null, trickAt: -9, trick: '' };
    });
    this.duration = Math.max(...this.sides.map((s) => (s.rep ? s.rep.duration : 0)), 1);
    this.size = new THREE.Vector2();
    this.frameBuf = new Float32Array(STRIDE);
    this.lookAt = new THREE.Vector3();
    $('rl-l-name').textContent = sides[0].tag;
    $('rl-r-name').textContent = sides[1].tag;
    $('reel').classList.remove('hidden');
  }

  get done() {
    return this.t >= this.duration + 1.5;
  }

  _place(s, t, dt) {
    if (!s.rep) {
      s.model.root.visible = false;
      return;
    }
    const i = Math.min(s.rep.count - 1, Math.floor(t / FRAME_DT));
    const f = s.rep.frames;
    for (let k = 0; k < STRIDE; k++) this.frameBuf[k] = f[i * STRIDE + k];
    const v = frameRider(this.frameBuf, 0, s.view);
    s.model.root.visible = true;
    placeRider(v, this.terrain, v.pos, v.q, s.model.root.position, s.model.root.quaternion);
    s.model.update(poseFor(v), dt);
    // Follow camera: behind the direction of travel, a little above.
    s.prev.copy(s.pos);
    s.pos.copy(s.model.root.position);
    const dir = new THREE.Vector3().subVectors(s.pos, s.prev);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.y = 0;
    dir.normalize();
    const want = new THREE.Vector3().copy(s.pos).addScaledVector(dir, -7).add(new THREE.Vector3(0, 2.6, 0));
    const ground = this.terrain.height(want.x, want.z) + 1.2;
    want.y = Math.max(want.y, ground);
    if (!s.camPos) s.camPos = want.clone();
    s.camPos.lerp(want, 1 - Math.exp(-dt * 4));
    s.camera.position.copy(s.camPos);
    this.lookAt.copy(s.pos);
    this.lookAt.y += 0.4;
    s.camera.lookAt(this.lookAt);
    // Trick names as they land.
    for (const e of s.rep.events) {
      if (e.t > this._lastT && e.t <= t && e.msg.type === 'trick' && e.msg.name) {
        s.trick = `${e.msg.name}  ${e.msg.points.toLocaleString('en-US')}`;
        s.trickAt = t;
      } else if (e.t > this._lastT && e.t <= t && e.msg.type === 'crash') {
        s.trick = 'BAIL';
        s.trickAt = t;
      }
    }
  }

  frame(dt, time) {
    this._lastT = this.t;
    this.t += dt;
    const [L, R] = this.sides;
    this._place(L, this.t, dt);
    this._place(R, this.t, dt);
    $('rl-l-trick').textContent = this.t - L.trickAt < 2.2 ? L.trick : '';
    $('rl-r-trick').textContent = this.t - R.trickAt < 2.2 ? R.trick : '';
    const r = this.renderer;
    r.getSize(this.size);
    const w = this.size.x;
    const h = this.size.y;
    const half = Math.floor(w / 2);
    this.world.update(time, L.pos, L.camera);
    r.setScissorTest(true);
    for (const [i, s] of [L, R].entries()) {
      const x = i === 0 ? 0 : half;
      const vw = i === 0 ? half : w - half;
      s.camera.aspect = vw / h;
      s.camera.updateProjectionMatrix();
      r.setViewport(x, 0, vw, h);
      r.setScissor(x, 0, vw, h);
      r.render(this.world.scene, s.camera);
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    return !this.done;
  }

  dispose() {
    for (const s of this.sides) this.world.scene.remove(s.model.root);
    $('reel').classList.add('hidden');
  }
}
