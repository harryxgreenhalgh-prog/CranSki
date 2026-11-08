// Replay viewer: play / pause, seek, switch camera, freeze on your best air,
// save the replay, and cut a clip.
import * as THREE from 'three';
import { simulateReplay, FRAME_DT } from '../replay/player.js';
import { ReplayDirector } from '../replay/cameras.js';
import { STRIDE, frameRider, placeRider, poseFor } from '../render/pose.js';
import { autoEdit, ClipExporter, pickMime } from '../replay/clip.js';
import { replayDB } from '../replay/db.js';

const $ = (id) => document.getElementById(id);
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export class ReplayView {
  constructor({ renderer, camera, model, onExit }) {
    this.renderer = renderer;
    this.camera = camera;
    this.model = model;
    this.onExit = onExit;
    this.open_ = false;
    this.v = {};
    this.pivot = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.pos = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.q2 = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    $('rp-play').addEventListener('click', () => this.toggle());
    $('rp-cam').addEventListener('click', () => this.nextCam());
    $('rp-freeze').addEventListener('click', () => this.freeze());
    $('rp-save').addEventListener('click', () => this.save());
    $('rp-clip').addEventListener('click', () => this.openClip());
    $('rp-exit').addEventListener('click', () => this.close());
    $('rp-time').addEventListener('input', (e) => {
      this.t = (Number(e.target.value) / 1000) * this.data.duration;
      this.lastEventT = this.t;
    });
    $('clip-close').addEventListener('click', () => this.closeClip());
    $('clip-export').addEventListener('click', () => this.exportClip());
    $('clip-cancel').addEventListener('click', () => this.exporter?.cancel());
    $('clip-whole').addEventListener('change', () => this._renderSegments());
    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    let drag = null;
    $('game').addEventListener('pointerdown', (e) => {
      if (this.open_ && this.director?.name === 'Free') drag = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointerup', () => (drag = null));
    window.addEventListener('pointermove', (e) => {
      if (!drag || !this.director) return;
      const f = this.director.free;
      f.yaw += (e.clientX - drag.x) * 0.005;
      f.pitch = Math.max(-1.2, Math.min(1.2, f.pitch - (e.clientY - drag.y) * 0.005));
      f.track = false;
      drag = { x: e.clientX, y: e.clientY };
    });
  }

  get isOpen() {
    return this.open_;
  }

  get exporting() {
    return !!(this.exporter && !this.exporter.done);
  }

  // record: stored replay; L: the loaded park ({ terrain, world, hud, meta })
  open(record, L) {
    this.record = record;
    this.L = L;
    try {
      this.data = simulateReplay(L.terrain, record);
    } catch (e) {
      return e.message;
    }
    this.director = new ReplayDirector(this.camera, L.terrain, this.data);
    this.t = 0;
    this.lastEventT = 0;
    this.playing = true;
    this.open_ = true;
    $('replaybar').classList.remove('hidden');
    $('rp-cam').innerHTML = `${this.director.name} <kbd>C</kbd>`;
    $('rp-save').textContent = record.saved ? 'Saved ★' : 'Save replay';
    $('rp-title').textContent = `${L.meta.name} · ${record.total.toLocaleString('en-US')} · ${record.name || ''}`;
    L.hud.clearTrick();
    L.hud.show(true);
    return null;
  }

  close() {
    if (!this.open_) return;
    this.exporter?.cancel();
    this.open_ = false;
    $('replaybar').classList.add('hidden');
    $('clip').classList.add('hidden');
    $('exporting').classList.add('hidden');
    this.L.hud.clearTrick();
    this.onExit();
  }

  toggle() {
    if (this.t >= this.data.duration - 0.01) this.t = 0;
    this.playing = !this.playing;
    if (this.director.freeze) this.director.freeze = false;
  }

  nextCam() {
    this.director.next();
    $('rp-cam').innerHTML = `${this.director.name} <kbd>C</kbd>`;
  }

  // Freeze on your best air and orbit the rider.
  freeze() {
    const d = this.director;
    if (d.freeze) {
      d.freeze = false;
      this.playing = true;
      return;
    }
    const best = [...this.data.airs].sort((a, b) => b.points - a.points || b.time - a.time)[0];
    if (!best) return;
    this.t = best.apexT;
    this.lastEventT = this.t;
    this.playing = false;
    d.freeze = true;
  }

  async save() {
    const ok = await replayDB.setSaved(this.record.id, !this.record.saved);
    if (ok) this.record.saved = !this.record.saved;
    $('rp-save').textContent = this.record.saved ? 'Saved ★' : 'Save replay';
  }

  _key(e, down) {
    if (!this.open_ || e.target instanceof HTMLInputElement) return;
    const d = this.director;
    if (d && d.name === 'Free' && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(e.code)) {
      if (down) d.free.keys.add(e.code);
      else d.free.keys.delete(e.code);
      e.stopImmediatePropagation();
      return;
    }
    if (!down) return;
    if (e.code === 'Space') {
      this.toggle();
      e.preventDefault();
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      this.t = Math.max(0, Math.min(this.data.duration, this.t + (e.code === 'ArrowLeft' ? -3 : 3)));
      this.lastEventT = this.t;
      e.preventDefault();
    } else if (e.code === 'KeyC') this.nextCam();
    else if (e.code === 'KeyT' && d?.name === 'Free') d.free.track = !d.free.track;
    else if (e.code === 'KeyF' && d?.name !== 'Free') this.freeze();
  }

  // Put the rider and camera at replay time t and render.
  drawAt(t, dt, time) {
    const D = this.data;
    const f = Math.min(D.count - 1.0001, Math.max(0, t / FRAME_DT));
    const i = Math.floor(f);
    const a = f - i;
    const F = D.frames;
    const o0 = i * STRIDE;
    const o1 = Math.min(D.count - 1, i + 1) * STRIDE;
    const v = frameRider(F, o0, this.v);
    this.pos.set(F[o0] + (F[o1] - F[o0]) * a, F[o0 + 1] + (F[o1 + 1] - F[o0 + 1]) * a, F[o0 + 2] + (F[o1 + 2] - F[o0 + 2]) * a);
    this.q.set(F[o0 + 3], F[o0 + 4], F[o0 + 5], F[o0 + 6]);
    this.q2.set(F[o1 + 3], F[o1 + 4], F[o1 + 5], F[o1 + 6]);
    this.q.slerp(this.q2, a);
    this.vel.set((F[o1] - F[o0]) / FRAME_DT, (F[o1 + 1] - F[o0 + 1]) / FRAME_DT, (F[o1 + 2] - F[o0 + 2]) / FRAME_DT);
    v.pos.copy(this.pos);
    placeRider(v, this.L.terrain, this.pos, this.q, this.pivot, this.quat);
    const m = this.model;
    m.root.visible = this.director.name !== 'Helmet' || this.director.freeze;
    m.root.position.copy(this.pivot);
    m.root.quaternion.copy(this.quat);
    m.update(poseFor(v, { riding: false }), dt);
    this.director.update(t, v, this.vel, this.pivot, this.quat, dt);
    this.L.world.update(time, this.pivot, this.camera);
    this.renderer.render(this.L.world.scene, this.camera);
  }

  // Each display frame while open.
  frame(dt, time) {
    if (this.exporting) {
      this.exporter.tick(dt);
      return;
    }
    if (this.playing) {
      this.t += dt * this.director.rate(this.t);
      if (this.t >= this.data.duration) {
        this.t = this.data.duration;
        this.playing = false;
      }
      // Trick readouts as they happen.
      for (const e of this.data.events) {
        if (e.t > this.lastEventT && e.t <= this.t && e.msg.type !== 'finish') this.L.hud.message(e.msg);
      }
      this.lastEventT = this.t;
    }
    this.L.hud.update({ rider: { speed: this.v.speed || 0, pos: this.pos, mode: this.v.mode }, score: { total: 0 }, line: { empty: true } }, dt, true);
    this.drawAt(this.t, dt, time);
    $('rp-play').textContent = this.playing ? '❚❚' : '▶';
    $('rp-time').value = String(Math.round((this.t / Math.max(0.01, this.data.duration)) * 1000));
    $('rp-clock').textContent = `${clock(this.t)} / ${clock(this.data.duration)}`;
  }

  // ---------------------------------------------------------------- clips
  closeClip() {
    $('clip').classList.add('hidden');
    $('replaybar').classList.remove('hidden');
  }

  openClip() {
    this.playing = false;
    $('replaybar').classList.add('hidden');
    this.segments = autoEdit(this.data);
    $('clip').classList.remove('hidden');
    $('clip-result').innerHTML = '';
    $('clip-mime').textContent = pickMime() ? `Saves as ${pickMime().startsWith('video/mp4') ? 'MP4' : 'WebM'} · 30 fps · rendered on this device` : 'This browser can’t record video.';
    $('clip-whole').checked = this.segments.length === 0;
    this._renderSegments();
  }

  _renderSegments() {
    const whole = $('clip-whole').checked;
    const list = $('clip-segs');
    if (whole || !this.segments.length) {
      list.innerHTML = `<p class="muted">Whole run · ${clock(this.data.duration)}</p>`;
      return;
    }
    list.innerHTML = this.segments
      .map((s, i) => `<label class="check"><input type="checkbox" data-seg="${i}" ${s.on ? 'checked' : ''}/> ${clock(s.t0)}–${clock(s.t1)} · ${s.label}</label>`)
      .join('');
    list.querySelectorAll('[data-seg]').forEach((c) => c.addEventListener('change', () => (this.segments[Number(c.dataset.seg)].on = c.checked)));
  }

  exportClip() {
    const whole = $('clip-whole').checked || !this.segments.length;
    const segs = whole ? [{ t0: 0, t1: this.data.duration }] : this.segments.filter((s) => s.on);
    if (!segs.length) return;
    const vertical = $('clip-format').value === 'vertical';
    const withText = $('clip-text').checked;
    const camName = $('clip-cam').value;
    while (this.director.name !== camName) this.director.next();
    $('rp-cam').innerHTML = `${this.director.name} <kbd>C</kbd>`;
    const r = this.renderer;
    const saved = { w: innerWidth, h: innerHeight, pr: r.getPixelRatio(), aspect: this.camera.aspect };
    const events = this.data.events.filter((e) => e.msg.type === 'trick' || e.msg.type === 'rail' || e.msg.type === 'butter' || e.msg.type === 'crash');
    $('clip').classList.add('hidden');
    $('exporting').classList.remove('hidden');
    $('clip-progress').value = 0;
    let lastT = -1;
    this.exporter = new ClipExporter({
      glCanvas: r.domElement,
      segments: segs,
      vertical,
      withText,
      render: (t, w, h) => {
        if (r.getPixelRatio() !== 1 || r.domElement.width !== w || r.domElement.height !== h) {
          r.setPixelRatio(1);
          r.setSize(w, h, false);
          this.camera.aspect = w / h;
          this.camera.updateProjectionMatrix();
        }
        const jump = lastT < 0 || Math.abs(t - lastT) > 0.2;
        if (jump) this.director.first = true;
        lastT = t;
        this.drawAt(t, 1 / 30, t);
      },
      text: (t) => {
        let best = null;
        for (const e of events) if (e.t <= t && t - e.t < 2.4) best = e;
        if (!best) return null;
        const m = best.msg;
        if (m.type === 'crash') return { name: 'BAIL', points: '' };
        if (!m.name) return null;
        return { name: m.name, points: m.points ? `+${m.points.toLocaleString('en-US')}` : '' };
      },
      onProgress: (p) => ($('clip-progress').value = p),
      onDone: (res) => {
        r.setPixelRatio(saved.pr);
        r.setSize(saved.w, saved.h, false);
        this.camera.aspect = saved.aspect;
        this.camera.updateProjectionMatrix();
        $('exporting').classList.add('hidden');
        $('clip').classList.remove('hidden');
        if (res.error) {
          $('clip-result').textContent = res.error;
          return;
        }
        if (this.exporter?.cancelled) return;
        const url = URL.createObjectURL(res.blob);
        const name = `cranski-${this.L.meta.id}-${new Date(this.record.date).toISOString().slice(0, 10)}.${res.ext}`;
        const mb = (res.blob.size / 1e6).toFixed(1);
        $('clip-result').innerHTML = `<a class="btn primary" href="${url}" download="${name}">Download clip (${mb} MB)</a>`;
      },
    });
    this.exporter.start();
  }
}
