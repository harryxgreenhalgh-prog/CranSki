// Sky dome and lighting moods: day, sunrise, a day-night cycle (THE YARD) and a
// sunrise-to-northern-lights ride (BELLEVUE).
import * as THREE from 'three';

const PALETTES = {
  day: { top: 0x2f7fe0, mid: 0x9fd3ff, low: 0xfff1d6, fog: 0xcfe6ff, sun: 0xfff3e0, sunI: 2.0, hemiSky: 0xdcecff, hemiGround: 0x8a9bb0, hemiI: 1.25, night: 0 },
  sunrise: { top: 0x3b5ea8, mid: 0xf2a6a0, low: 0xffd59a, fog: 0xf3d2c4, sun: 0xffc48a, sunI: 1.8, hemiSky: 0xffd8c8, hemiGround: 0x7d7fa8, hemiI: 1.15, night: 0 },
  dusk: { top: 0x1d2a5c, mid: 0x7a5aa0, low: 0xff9a6a, fog: 0x8a7aa8, sun: 0xff9a6a, sunI: 0.9, hemiSky: 0xb9a0d8, hemiGround: 0x4a4a70, hemiI: 0.9, night: 0.4 },
  night: { top: 0x050a1c, mid: 0x0d1838, low: 0x1c2a52, fog: 0x101a36, sun: 0x8fa8ff, sunI: 0.35, hemiSky: 0x5a6fa8, hemiGround: 0x1a2038, hemiI: 0.55, night: 1 },
};

// Sky dome shader: colour gradient, a sun with glow, and drifting clouds.
const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = `
uniform vec3 top;
uniform vec3 mid;
uniform vec3 low;
uniform vec3 sunCol;
uniform vec3 sunDir;
uniform float time;
uniform float clouds;
uniform float night;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col = y > 0.12 ? mix(mid, top, clamp((y - 0.12) / 0.6, 0.0, 1.0)) : mix(low, mid, clamp((y + 0.1) / 0.22, 0.0, 1.0));
  float sd = max(dot(d, normalize(sunDir)), 0.0);
  float day = 1.0 - night;
  col += sunCol * (pow(sd, 900.0) * 6.0 + pow(sd, 18.0) * 0.35 + pow(sd, 3.0) * 0.12) * day;
  if (y > 0.0) {
    vec2 uv = d.xz / (y + 0.12) * 0.55 + vec2(time * 0.006, time * 0.002);
    float c = smoothstep(0.48, 0.82, fbm(uv * 1.3)) * clouds * smoothstep(0.0, 0.18, y);
    float lit = 0.75 + 0.25 * fbm(uv * 2.6 + 3.0);
    vec3 cc = mix(vec3(1.0), sunCol, 0.3) * lit * (0.25 + 0.75 * day) + vec3(0.04, 0.05, 0.09) * night;
    col = mix(col, cc, c * 0.9);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

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
    const geo = new THREE.SphereGeometry(3000, 48, 24);
    this.uniforms = {
      top: { value: new THREE.Color() },
      mid: { value: new THREE.Color() },
      low: { value: new THREE.Color() },
      sunCol: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(-0.4, 0.55, 0.3) },
      time: { value: 0 },
      clouds: { value: mode === 'sunrise' ? 0.55 : 0.7 },
      night: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.frustumCulled = false;
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
    const U = this.uniforms;
    U.top.value.setHex(pal.top);
    U.mid.value.setHex(pal.mid);
    U.low.value.setHex(pal.low);
    U.sunCol.value.setHex(pal.sun);
    U.night.value = pal.night;
    U.sunDir.value.set(-40, 80, 30).normalize(); // matches the sun light's direction
    this.fog.color.setHex(pal.fog);
    this.sun.color.setHex(pal.sun);
    // Stronger sun, softer bluish fill: sunlit snow pops and shaded slopes go blue.
    this.sun.intensity = pal.sunI * 1.4;
    this.hemi.color.setHex(pal.hemiSky);
    this.hemi.groundColor.setHex(pal.hemiGround);
    this.hemi.groundColor.lerp(new THREE.Color(0x5f7fb8), 0.35);
    this.hemi.intensity = pal.hemiI * 0.72;
    this.night = pal.night;
    if (this.stars) this.stars.material.opacity = Math.max(0, pal.night - 0.3) * 1.2;
  }

  // time: seconds since the park loaded; progress: 0..1 down the run.
  update(time, progress, cameraPos) {
    this.dome.position.copy(cameraPos);
    this.uniforms.time.value = time;
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
