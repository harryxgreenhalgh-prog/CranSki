// Other riders in a live room. The nearest few get the full rider model in
// their own Locker look; everyone further away gets a cheap stand-in (a handful
// of plain shapes in their jacket colour). Gamertags float above them, and the
// name of a trick they just landed pops up for a moment.
import * as THREE from 'three';
import { RiderModel, DEFAULT_LOOK, COM_HEIGHT } from './riderModel.js';
import { ASSETS } from './assets.js';
import { STRIDE, frameRider, placeRider, poseFor } from './pose.js';
import { textTexture } from './textTexture.js';

const FULL_MAX = 6; // full models at once
const FULL_DIST = 70; // metres
const TAG_DIST = 180;

const shared = {};
function cheapGeometry() {
  if (!shared.body) {
    shared.body = new THREE.CapsuleGeometry(0.2, 0.55, 3, 8);
    shared.head = new THREE.SphereGeometry(0.15, 10, 8);
    shared.legs = new THREE.CapsuleGeometry(0.11, 0.5, 2, 6);
    shared.ski = new THREE.BoxGeometry(0.1, 0.03, 1.7);
    shared.dark = new THREE.MeshLambertMaterial({ color: 0x1d2633 });
  }
  return shared;
}

function makeCheap(look) {
  const g = cheapGeometry();
  const root = new THREE.Group();
  const jacket = new THREE.MeshLambertMaterial({ color: look.topColor ?? DEFAULT_LOOK.topColor });
  const pants = new THREE.MeshLambertMaterial({ color: look.pants ?? DEFAULT_LOOK.pants });
  const body = new THREE.Mesh(g.body, jacket);
  body.position.y = 0.25;
  const head = new THREE.Mesh(g.head, g.dark);
  head.position.y = 0.78;
  const legs = new THREE.Mesh(g.legs, pants);
  legs.position.y = -0.42;
  root.add(body, head, legs);
  const board = look.ride === 'board';
  for (const x of board ? [0] : [-0.13, 0.13]) {
    const ski = new THREE.Mesh(g.ski, g.dark);
    ski.position.set(x, -COM_HEIGHT + 0.02, 0);
    if (board) ski.scale.set(3, 1, 0.85);
    root.add(ski);
  }
  root.userData.mats = [jacket, pants];
  return root;
}

function makeLabel(text, { bg = 'rgba(9,22,44,0.72)', fg = '#ffffff', w = 512, h = 96, size = 1.6 } = {}) {
  const tex = textTexture(text, { w, h, bg, fg, font: 'italic 900 58px Impact, "Arial Black", sans-serif' });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(size * (w / h) * 0.32, size * 0.32, 1);
  s.renderOrder = 10;
  return s;
}

export class RemoteRiders {
  constructor() {
    this.entries = new Map(); // uid -> entry
    this.scene = null;
    this.frame = new Float32Array(STRIDE);
    this.view = {};
    this._cam = new THREE.Vector3();
  }

  attach(scene) {
    if (scene === this.scene) return;
    for (const e of this.entries.values()) {
      this.scene?.remove(e.group);
      scene.add(e.group);
    }
    this.scene = scene;
  }

  clear() {
    for (const uid of [...this.entries.keys()]) this._drop(uid);
  }

  _drop(uid) {
    const e = this.entries.get(uid);
    if (!e) return;
    this.scene?.remove(e.group);
    e.tag.material.map.dispose();
    e.tag.material.dispose();
    if (e.trick) {
      e.trick.material.map.dispose();
      e.trick.material.dispose();
    }
    for (const m of e.cheap.userData.mats) m.dispose();
    this.entries.delete(uid);
  }

  _entry(r) {
    let e = this.entries.get(r.uid);
    const look = { ...DEFAULT_LOOK, ...(r.look || {}), ride: r.board ? 'board' : (r.look?.ride ?? 'skis') };
    const lookKey = JSON.stringify(look);
    if (e && e.lookKey !== lookKey) {
      this._drop(r.uid);
      e = null;
    }
    if (!e) {
      const group = new THREE.Group();
      const cheap = makeCheap(look);
      const tag = makeLabel(r.tag);
      group.add(cheap, tag);
      e = { group, cheap, full: null, look, lookKey, tag, tagText: r.tag, trick: null, trickAt: 0, visible: false, dist: Infinity };
      this.entries.set(r.uid, e);
      this.scene?.add(group);
    }
    if (e.tagText !== r.tag) {
      e.group.remove(e.tag);
      e.tag.material.map.dispose();
      e.tag = makeLabel(r.tag);
      e.tagText = r.tag;
      e.group.add(e.tag);
    }
    return e;
  }

  // Place everyone for this frame.
  update(room, dt, camera, terrain, now = performance.now()) {
    if (!room || !room.room) {
      if (this.entries.size) this.clear();
      return;
    }
    for (const uid of [...this.entries.keys()]) if (!room.remotes.has(uid)) this._drop(uid);
    camera.getWorldPosition(this._cam);
    const shown = [];
    for (const r of room.remotes.values()) {
      const e = this._entry(r);
      const onSlope = r.status === 'riding' || r.status === 'results' || r.status === 'paused';
      const stale = now - r.heard > 6000;
      const delay = Math.max(110, Math.min(600, r.interval * 1.6 + 40));
      if (!onSlope || stale || !r.snaps.sample(now, delay, this.frame)) {
        e.group.visible = false;
        e.dist = Infinity;
        continue;
      }
      const v = frameRider(this.frame, 0, this.view);
      e.group.visible = true;
      e.v = { ...v, pos: v.pos.clone(), q: v.q.clone() };
      e.dist = this._cam.distanceTo(v.pos);
      shown.push(e);
    }
    // Nearest few in full detail.
    shown.sort((a, b) => a.dist - b.dist);
    shown.forEach((e, i) => {
      const full = i < FULL_MAX && e.dist < FULL_DIST && ASSETS.ready;
      if (full && !e.full) {
        e.full = new RiderModel(e.look);
        e.full.upgrade(ASSETS.parts);
        e.full.applyLook(e.look);
        e.full.root.traverse((o) => (o.castShadow = false));
        e.group.add(e.full.root);
      }
      if (e.full) e.full.root.visible = full;
      e.cheap.visible = !full;
      const target = full ? e.full.root : e.cheap;
      placeRider(e.v, terrain, e.v.pos, e.v.q, target.position, target.quaternion);
      if (full) e.full.update(poseFor(e.v), dt);
      e.tag.visible = e.dist < TAG_DIST;
      e.tag.position.set(target.position.x, target.position.y + 1.35, target.position.z);
      const k = Math.max(1, e.dist / 25);
      e.tag.scale.set(0.95 * k * (512 / 96) * 0.32, 0.95 * k * 0.32, 1);
      if (e.trick) {
        const age = (now - e.trickAt) / 1000;
        e.trick.visible = age < 2.5 && e.dist < TAG_DIST;
        e.trick.position.set(target.position.x, target.position.y + 1.75 + age * 0.3, target.position.z);
        e.trick.material.opacity = Math.max(0, 1 - Math.max(0, age - 1.8) / 0.7);
        e.trick.scale.set(1.1 * k * (768 / 96) * 0.32, 1.1 * k * 0.32, 1);
      }
    });
  }

  // A rider landed a trick: pop its name over them.
  showTrick(r) {
    const e = this.entries.get(r.uid);
    if (!e || !r.trick?.name) return;
    if (e.trick) {
      e.group.remove(e.trick);
      e.trick.material.map.dispose();
      e.trick.material.dispose();
    }
    const text = r.trick.points ? `${r.trick.name}  ${r.trick.points.toLocaleString('en-US')}` : r.trick.name;
    e.trick = makeLabel(text, { bg: 'rgba(30,123,255,0.85)', w: 768 });
    e.trickAt = performance.now();
    e.group.add(e.trick);
  }

  // Hide one rider this frame (e.g. your duel opponent, drawn separately).
  hideUid(uid) {
    const e = this.entries.get(uid);
    if (e) e.group.visible = false;
  }

  // Where everyone is, for the minimap: [{ s, y }]
  dots() {
    const out = [];
    for (const e of this.entries.values()) if (e.group.visible && e.v) out.push({ s: -e.v.pos.z, y: e.v.pos.y });
    return out;
  }
}
