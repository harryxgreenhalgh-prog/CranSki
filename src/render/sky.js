// Sky dome and lighting moods: day, sunrise, a day-night cycle (THE YARD) and a
// sunrise-to-northern-lights ride (BELLEVUE).
import * as THREE from 'three';

const PALETTES = {
  day: { top: 0x2f7fe0, mid: 0x9fd3ff, low: 0xfff1d6, fog: 0xcfe6ff, sun: 0xfff3e0, sunI: 2.0, hemiSky: 0xdcecff, hemiGround: 0x8a9bb0, hemiI: 1.25, night: 0 },
  sunrise: { top: 0x3b5ea8, mid: 0xf2a6a0, low: 0xffd59a, fog: 0xf3d2c4, sun: 0xffc48a, sunI: 1.8, hemiSky: 0xffd8c8, hemiGround: 0x7d7fa8, hemiI: 1.15, night: 0 },
  dusk: { top: 0x1d2a5c, mid: 0x7a5aa0, low: 0xff9a6a, fog: 0x8a7aa8, sun: 0xff9a6a, sunI: 0.9, hemiSky: 0xb9a0d8, hemiGround: 0x4a4a70, hemiI: 0.9, night: 0.4 },
  night: { top: 0x050a1c, mid: 0x0d1838, low: 0x1c2a52, fog: 0x101a36, sun: 0x8fa8ff, sunI: 0.35, hemiSky: 0x5a6fa8, hemiGround: 0x1a2038, hemiI: 0.55, night: 1 },
};

const _c = new THREE.Color();

function mixPalette(a, b, t) {
  const out = {};
  for (const k of Object.keys(a)) {
    if (k === 'sunI' || k === 'hemiI' || k === 'night') out[k] = a[k] + (b[k] - a[k]) * t;
    else out[k] = new THREE.Color(a[k]).lerp(new THREE.Color(b[k]), t).getHex();
  }
  return out;
}

export class Sky {
  constructor(scene, mode, { hemi, sun }) {
    this.scene = scene;
    this.mode = mode;
    this.hemi = hemi;
    this.sun = sun;
    const geo = new THREE.SphereGeometry(3000, 32, 16);
    this.ys = [];
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) this.ys.push(p.getY(i) / 3000);
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(p.count * 3), 3));
    this.dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }));
    this.dome.renderOrder = -2;
    scene.add(this.dome);
    this.fog = new THREE.Fog(0xcfe6ff, 250, 2200);
    scene.fog = this.fog;
    this.night = 0;
    this.stars = null;
    this.aurora = null;
    if (mode === 'daynight' || mode === 'aurora') this._buildStars();
    if (mode === 'aurora') this._buildAurora();
    this.apply(PALETTES[mode === 'sunrise' ? 'sunrise' : 'day']);
  }

  _buildStars() {
    const n = 900;
    const pos = new Float32Array(n * 3);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const th = rnd() * Math.PI * 2;
      const y = 0.08 + rnd() * 0.92;
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(th) * r * 2800;
      pos[i * 3 + 1] = y * 2800;
      pos[i * 3 + 2] = Math.sin(th) * r * 2800;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.renderOrder = -1;
    this.scene.add(this.stars);
  }

  _buildAurora() {
    this.aurora = new THREE.Group();
    const colors = [0x3dffa8, 0x5ad6ff, 0xb46bff];
    for (let i = 0; i < 3; i++) {
      const pts = [];
      for (let k = 0; k <= 40; k++) {
        const a = -0.9 + (k / 40) * 1.8;
        pts.push(new THREE.Vector3(Math.sin(a) * 2400, 700 + i * 120 + Math.sin(k * 0.5 + i) * 60, -Math.cos(a) * 2400));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.TubeGeometry(curve, 80, 90 - i * 20, 4, false);
      geo.scale(1, 2.2, 1);
      const mat = new THREE.MeshBasicMaterial({ color: colors[i], transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = -1;
      this.aurora.add(m);
    }
    this.scene.add(this.aurora);
  }

  apply(pal) {
    const col = this.dome.geometry.attributes.color;
    const top = new THREE.Color(pal.top);
    const mid = new THREE.Color(pal.mid);
    const low = new THREE.Color(pal.low);
    for (let i = 0; i < this.ys.length; i++) {
      const y = this.ys[i];
      if (y > 0.12) _c.copy(mid).lerp(top, Math.min(1, (y - 0.12) / 0.6));
      else _c.copy(low).lerp(mid, Math.max(0, (y + 0.1) / 0.22));
      col.setXYZ(i, _c.r, _c.g, _c.b);
    }
    col.needsUpdate = true;
    this.fog.color.setHex(pal.fog);
    this.sun.color.setHex(pal.sun);
    this.sun.intensity = pal.sunI;
    this.hemi.color.setHex(pal.hemiSky);
    this.hemi.groundColor.setHex(pal.hemiGround);
    this.hemi.intensity = pal.hemiI;
    this.night = pal.night;
    if (this.stars) this.stars.material.opacity = Math.max(0, pal.night - 0.3) * 1.2;
  }

  // time: seconds since the park loaded; progress: 0..1 down the run.
  update(time, progress, cameraPos) {
    this.dome.position.copy(cameraPos);
    if (this.stars) this.stars.position.copy(cameraPos);
    if (this.mode === 'daynight') {
      // One full cycle every 8 minutes: day, dusk, night, dawn.
      const ph = (time / 480 + 0.1) % 1;
      let pal;
      if (ph < 0.4) pal = PALETTES.day;
      else if (ph < 0.5) pal = mixPalette(PALETTES.day, PALETTES.dusk, (ph - 0.4) / 0.1);
      else if (ph < 0.58) pal = mixPalette(PALETTES.dusk, PALETTES.night, (ph - 0.5) / 0.08);
      else if (ph < 0.85) pal = PALETTES.night;
      else if (ph < 0.93) pal = mixPalette(PALETTES.night, PALETTES.sunrise, (ph - 0.85) / 0.08);
      else pal = mixPalette(PALETTES.sunrise, PALETTES.day, (ph - 0.93) / 0.07);
      this._throttled(pal, time);
    } else if (this.mode === 'aurora') {
      const p = Math.min(1, Math.max(0, progress));
      let pal;
      if (p < 0.3) pal = mixPalette(PALETTES.sunrise, PALETTES.day, p / 0.3);
      else if (p < 0.55) pal = mixPalette(PALETTES.day, PALETTES.dusk, (p - 0.3) / 0.25);
      else if (p < 0.75) pal = mixPalette(PALETTES.dusk, PALETTES.night, (p - 0.55) / 0.2);
      else pal = PALETTES.night;
      this._throttled(pal, time);
      if (this.aurora) {
        this.aurora.position.set(cameraPos.x, 0, cameraPos.z);
        const a = Math.max(0, (p - 0.62) / 0.3);
        this.aurora.children.forEach((m, i) => {
          m.material.opacity = Math.min(0.45, a) * (0.7 + 0.3 * Math.sin(time * 0.6 + i * 2));
        });
      }
    }
  }

  _throttled(pal, time) {
    if (this._last !== undefined && time - this._last < 0.25) return;
    this._last = time;
    this.apply(pal);
  }
}
