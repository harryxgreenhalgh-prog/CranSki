// Lifts: gondola, ropeway or T-bar from below the finish back up to the start.
// Moving carriers for the scenery, and a third-person ride for the player at real
// lift speed.
import * as THREE from 'three';
import { ASSETS, partMaterials } from './assets.js';

class Path {
  constructor(points) {
    this.p = points.map((q) => new THREE.Vector3(q.x, q.y, q.z));
    this.cum = [0];
    for (let i = 1; i < this.p.length; i++) this.cum.push(this.cum[i - 1] + this.p[i].distanceTo(this.p[i - 1]));
    this.length = this.cum[this.cum.length - 1];
  }

  // Position at distance d, and a smoothed travel direction (looks ±4 m).
  sample(d, outPos, outDir) {
    this._at(d, outPos);
    if (outDir) {
      const a = this._at(d - 4, new THREE.Vector3());
      const b = this._at(d + 4, new THREE.Vector3());
      outDir.subVectors(b, a).normalize();
    }
    return outPos;
  }

  _at(d, out) {
    d = Math.max(0, Math.min(this.length, d));
    let lo = 0;
    let hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] < d) lo = mid;
      else hi = mid;
    }
    const seg = this.cum[hi] - this.cum[lo] || 1;
    return out.lerpVectors(this.p[lo], this.p[hi], (d - this.cum[lo]) / seg);
  }
}

function std(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, ...extra });
}

let cabinMats = null;
// A gondola cabin with glass all round so you can see who's riding.
function makeCabin(big, glassOpacity = 0.28) {
  const part = ASSETS.ready && ASSETS.parts.cabin;
  if (part) {
    cabinMats ||= {
      cabinBody: new THREE.MeshStandardMaterial({ color: 0xff5a36, roughness: 0.35, metalness: 0.1 }),
      cabinFrame: new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.35, metalness: 0.4 }),
      darkSteel: new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.45, metalness: 0.6 }),
    };
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fd0ff, transparent: true, opacity: glassOpacity, roughness: 0.05, metalness: 0.3, depthWrite: false });
    const m = new THREE.Mesh(part.geometry, partMaterials(part, { ...cabinMats, cabinGlass: glass }, cabinMats.cabinBody));
    m.castShadow = true;
    const g = new THREE.Group();
    g.add(m);
    const k = big ? 2.6 : 1;
    m.scale.setScalar(k);
    g.userData.height = 3.4 * k;
    return g;
  }
  const g = new THREE.Group();
  const w = big ? 5.6 : 2.1;
  const h = big ? 3.0 : 2.3;
  const l = big ? 8.4 : 2.1;
  const body = std(0xff5a36);
  const frame = std(0xf2f4f7, { roughness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fd0ff, transparent: true, opacity: glassOpacity, roughness: 0.05, metalness: 0.4, depthWrite: false });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, l), body);
  floor.position.y = 0.25;
  g.add(floor);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.35, l + 0.1), body);
  roof.position.y = h - 0.15;
  g.add(roof);
  const glassBox = new THREE.Mesh(new THREE.BoxGeometry(w - 0.06, h - 0.85, l - 0.06), glass);
  glassBox.position.y = 0.5 + (h - 0.85) / 2;
  glassBox.renderOrder = 2;
  g.add(glassBox);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, h - 0.6, 0.1), frame);
      post.position.set((sx * w) / 2, h / 2, (sz * l) / 2);
      g.add(post);
    }
  }
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, big ? 3 : 1.4, 0.14), std(0x6b737c));
  arm.position.y = h + (big ? 1.5 : 0.7);
  g.add(arm);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, big ? 1.4 : 0.6), std(0x3a3f46));
  grip.position.y = h + (big ? 3 : 1.4);
  g.add(grip);
  g.traverse((o) => {
    if (o.isMesh && o.material !== glass) o.castShadow = true;
  });
  g.userData.height = h + (big ? 3 : 1.4);
  return g;
}

// A T-bar: crossbar on a sprung stem up to the cable.
function makeTbar() {
  const g = new THREE.Group();
  const mat = std(0x3a3f46);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 8), std(0xffd23f));
  bar.rotation.z = Math.PI / 2;
  g.add(bar);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6), mat);
  g.add(stem);
  g.userData = { bar, stem };
  return g;
}

export function buildLift(terrain, scene) {
  const layout = terrain.lift;
  const k = layout.kind;
  const group = new THREE.Group();
  const steel = std(0x8a939c, { metalness: 0.6, roughness: 0.4 });
  const dark = std(0x3a3f46, { metalness: 0.5 });

  // Towers with a crossarm and sheave wheels.
  const towerPart = ASSETS.ready && ASSETS.parts.tower && layout.type !== 'tbar' ? ASSETS.parts.tower : null;
  const towerMats = towerPart ? { steel, darkSteel: dark } : null;
  for (const t of layout.towers) {
    const h = k.towerH;
    if (towerPart) {
      const m = new THREE.Mesh(towerPart.geometry, partMaterials(towerPart, towerMats, steel));
      const sx = layout.type === 'ropeway' ? 1.6 : 1;
      m.scale.set(sx, h / 16, sx);
      m.position.set(t.x + (layout.side * 4.5) / 2, t.g, t.z);
      m.castShadow = true;
      group.add(m);
      continue;
    }
    const r = layout.type === 'ropeway' ? 0.9 : layout.type === 'tbar' ? 0.22 : 0.4;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r, h, 10), steel);
    pole.position.set(t.x + (layout.side * 4.5) / 2, t.g + h / 2, t.z);
    pole.castShadow = true;
    group.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(7, 0.45, 0.6), dark);
    arm.position.set(t.x + (layout.side * 4.5) / 2, t.g + h + 0.2, t.z);
    group.add(arm);
    for (const off of [0, layout.side * 4.5]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.2, 12), dark);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(t.x + off, t.g + h + 0.05, t.z);
      group.add(wheel);
    }
  }

  // Cables as thin tubes (they read better than 1-pixel lines).
  const cableMat = std(0x2a2d31, { metalness: 0.7 });
  for (const line of [layout.up, layout.down]) {
    const pts = line.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    const path = new THREE.CurvePath();
    for (let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(path, pts.length, layout.type === 'ropeway' ? 0.08 : 0.04, 4, false), cableMat));
  }

  // Stations at both ends, with the big bullwheel.
  const ends = [layout.towers[0], layout.towers[layout.towers.length - 1]];
  for (const t of ends) {
    const H = Math.max(6, k.towerH * 0.55);
    const cx = t.x + (layout.side * 4.5) / 2;
    const st = new THREE.Mesh(new THREE.BoxGeometry(14, H, 12), std(0xb8c2cc, { roughness: 0.8 }));
    st.position.set(cx, t.g + H / 2, t.z);
    st.castShadow = true;
    st.receiveShadow = true;
    group.add(st);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(15, 0.7, 13), std(0x1e7bff));
    roof.position.set(cx, t.g + H + 0.35, t.z);
    group.add(roof);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.18, 8, 24), dark);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(cx, t.g + k.towerH, t.z);
    group.add(wheel);
  }

  const upPath = new Path(layout.up);
  const downPath = new Path([...layout.down].reverse());
  const loop = upPath.length + downPath.length;
  const trackPath = layout.track ? new Path(layout.track) : null;
  const rideLength = trackPath ? trackPath.length : upPath.length;

  // Moving carriers.
  const big = layout.type === 'ropeway';
  const count = big ? 2 : Math.max(2, Math.floor(loop / k.cabinGap));
  const carriers = [];
  for (let i = 0; i < count; i++) {
    const c = layout.type === 'tbar' ? makeTbar() : makeCabin(big, 0.55);
    group.add(c);
    carriers.push(c);
  }
  scene.add(group);

  // The player's own cabin (glass so you can see yourself) or T-bar.
  const playerCarrier = layout.type === 'tbar' ? makeTbar() : makeCabin(big);
  playerCarrier.visible = false;
  scene.add(playerCarrier);

  const _p = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _yaw = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);

  // Hang a cabin under a cable point, facing along the cable, swaying gently.
  function hangCabin(obj, cablePos, dir, time, phase) {
    _yaw.set(dir.x, 0, dir.z).normalize();
    obj.quaternion.setFromUnitVectors(_d.set(0, 0, -1), _yaw);
    const sway = 0.035 * Math.sin(time * 1.15 + phase) + 0.015 * Math.sin(time * 2.7 + phase * 2);
    obj.quaternion.multiply(_q.setFromAxisAngle(Z, sway));
    obj.position.copy(cablePos);
    obj.position.y -= obj.userData.height || k.hang;
  }

  function placeTbar(obj, cablePos, groundY, dir, loaded) {
    // Bar hangs to hip height when someone's riding, higher when empty.
    const barY = loaded ? groundY + 0.75 : Math.max(groundY + 1.6, cablePos.y - 3.2);
    _yaw.set(dir.x, 0, dir.z).normalize();
    obj.position.set(cablePos.x, barY, cablePos.z);
    obj.quaternion.setFromUnitVectors(_d.set(0, 0, -1), _yaw);
    const { stem } = obj.userData;
    const len = cablePos.y - barY;
    stem.scale.y = Math.max(0.1, len);
    stem.position.y = len / 2;
  }

  let riding = null; // { d } while the player is on the lift

  function update(time) {
    const playerD = riding ? riding.d : -1;
    if (big) {
      // Two cabins shuttling in opposite directions, like a real aerial ropeway.
      const f = riding ? riding.d / upPath.length : 0.5 - 0.5 * Math.cos((time / (upPath.length / k.speed)) * Math.PI);
      upPath.sample(f * upPath.length, _p, _d);
      hangCabin(carriers[0], _p, _d, time, 0);
      carriers[0].visible = !riding;
      downPath.sample(f * downPath.length, _p, _d);
      hangCabin(carriers[1], _p, _d, time, 2);
      return;
    }
    for (let i = 0; i < count; i++) {
      let d = (time * k.speed + (i * loop) / count) % loop;
      const onUp = d < upPath.length;
      const c = carriers[i];
      // Hide the one that would overlap the player's own carrier.
      c.visible = !(riding && onUp && Math.abs(d - playerD) < (loop / count) * 0.6);
      if (!c.visible) continue;
      if (onUp) upPath.sample(d, _p, _d);
      else downPath.sample(d - upPath.length, _p, _d);
      if (layout.type === 'tbar') {
        placeTbar(c, _p, terrain.height(_p.x, _p.z), _d, false);
      } else hangCabin(c, _p, _d, time, i);
    }
  }
  update(0);

  const ride = {
    type: layout.type,
    speed: k.speed,
    length: rideLength,
    duration: rideLength / k.speed,
    start() {
      riding = { d: 0 };
      playerCarrier.visible = true;
    },
    stop() {
      riding = null;
      playerCarrier.visible = false;
    },
    // Move the player's carrier to distance d; returns where the rider stands
    // (feet) and which way they face.
    place(d, time, outFeet, outDir) {
      riding.d = d;
      if (trackPath) {
        trackPath.sample(d, outFeet, outDir);
        // The cable is overhead: find its height here for the T-bar stem.
        upPath.sample(Math.min(upPath.length, d), _p, _d);
        _p.set(outFeet.x, Math.max(_p.y, outFeet.y + 3), outFeet.z);
        placeTbar(playerCarrier, _p, outFeet.y, outDir, true);
        return outFeet;
      }
      upPath.sample(d, _p, outDir);
      hangCabin(playerCarrier, _p, outDir, time, 0);
      // Rider stands on the cabin floor.
      outFeet.copy(playerCarrier.position);
      outFeet.y += 0.5;
      return outFeet;
    },
    cabin: playerCarrier,
  };

  return { group, update, ride };
}
