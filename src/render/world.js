// Builds the BIG AIR scene from simple shapes: snow, kicker, forest, gates, sky.
import * as THREE from 'three';

const BLUE = 0x1e7bff;

function mulberry32(seed) {
  // Seeded random for scenery placement only (never used by the simulation).
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function corduroyTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 4) {
    g.fillStyle = y % 8 === 0 ? 'rgba(170,190,215,0.35)' : 'rgba(255,255,255,0.0)';
    g.fillRect(0, y, 64, 2);
  }
  const rnd = mulberry32(7);
  for (let i = 0; i < 500; i++) {
    g.fillStyle = `rgba(160,180,210,${0.08 + rnd() * 0.1})`;
    g.fillRect(rnd() * 64, rnd() * 256, 1 + rnd() * 2, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function textTexture(text, { w = 1024, h = 128, bg = '#1e7bff', fg = '#ffffff', font = 'italic 900 88px Impact, "Arial Black", sans-serif' } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildTerrainMesh(terrain) {
  const park = terrain.park;
  // Rows along the run: every metre plus extra rows at sharp edges (the lip).
  const rowSet = new Set();
  for (let s = 0; s <= park.endS; s += 1) rowSet.add(s);
  for (const [s] of park.slopePoints) {
    for (const d of [-0.5, -0.2, 0, 0.06, 0.3]) {
      const v = +(s + d).toFixed(3);
      if (v >= 0 && v <= park.endS) rowSet.add(v);
    }
  }
  for (let s = park.kickerStartS; s <= park.lipS; s += 0.25) rowSet.add(s);
  const rows = [...rowSet].sort((a, b) => a - b);

  const cols = [];
  for (let x = -48; x <= 48; x += 2) cols.push(x);

  const nv = rows.length * cols.length;
  const pos = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const col = new Float32Array(nv * 3);
  const c = new THREE.Color();
  let k = 0;
  for (let i = 0; i < rows.length; i++) {
    const s = rows[i];
    for (let j = 0; j < cols.length; j++) {
      const x = cols[j];
      const y = terrain.height(x, -s);
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = -s;
      uv[k * 2] = x / 6;
      uv[k * 2 + 1] = s / 6;
      // Groomed piste is bright; banks get a cooler, shaded tone.
      const bank = Math.min(1, Math.max(0, (Math.abs(x) - park.halfWidth) / 14));
      c.setRGB(1 - bank * 0.12, 1 - bank * 0.08, 1);
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
      k++;
    }
  }
  const idx = [];
  const W = cols.length;
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < W - 1; j++) {
      const a = i * W + j;
      const b = a + 1;
      const d = a + W;
      const e = d + 1;
      idx.push(a, b, d, b, e, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, map: corduroyTexture() });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

// A strip of blue paint lying on the snow across the run at distance s.
function paintLine(terrain, s, width, thickness, color = BLUE) {
  const segs = 24;
  const geo = new THREE.BufferGeometry();
  const pos = [];
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const x = -width / 2 + (width * i) / segs;
    pos.push(x, terrain.height(x, -(s - thickness / 2)) + 0.03, -(s - thickness / 2));
    pos.push(x, terrain.height(x, -(s + thickness / 2)) + 0.03, -(s + thickness / 2));
    if (i < segs) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
}

function buildTrees(terrain, scene) {
  const park = terrain.park;
  const rnd = mulberry32(1234);
  const spots = [];
  for (let s = -30; s < park.endS + 40; s += 3.2) {
    for (const side of [-1, 1]) {
      const n = s < park.lipS ? 3 : 2; // denser forest along the inrun
      for (let i = 0; i < n; i++) {
        const x = side * (park.halfWidth + 6 + rnd() * 34);
        const ss = s + rnd() * 3;
        spots.push([x, ss, 0.7 + rnd() * 0.8]);
      }
    }
  }
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6);
  trunkGeo.translate(0, 1.2, 0);
  const leafGeo = new THREE.ConeGeometry(2.6, 7.5, 7);
  leafGeo.translate(0, 6, 0);
  const leafGeo2 = new THREE.ConeGeometry(1.9, 5, 7);
  leafGeo2.translate(0, 9.2, 0);
  const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5a3b26 }), spots.length);
  const leaf = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0x1f5a3a }), spots.length);
  const leaf2 = new THREE.InstancedMesh(leafGeo2, new THREE.MeshLambertMaterial({ color: 0x2c7048 }), spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const p = new THREE.Vector3();
  spots.forEach(([x, s, k], i) => {
    p.set(x, terrain.height(x, -s) - 0.2, -s);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
    sc.set(k, k * (0.9 + rnd() * 0.3), k);
    m.compose(p, q, sc);
    trunk.setMatrixAt(i, m);
    leaf.setMatrixAt(i, m);
    leaf2.setMatrixAt(i, m);
  });
  for (const im of [trunk, leaf, leaf2]) {
    im.castShadow = false;
    scene.add(im);
  }
}

function buildSky(scene) {
  const geo = new THREE.SphereGeometry(1800, 32, 16);
  const colors = [];
  const top = new THREE.Color(0x2f7fe0);
  const mid = new THREE.Color(0x9fd3ff);
  const low = new THREE.Color(0xfff1d6);
  const p = geo.attributes.position;
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 1800;
    if (y > 0.15) c.copy(mid).lerp(top, Math.min(1, (y - 0.15) / 0.6));
    else c.copy(low).lerp(mid, Math.max(0, (y + 0.1) / 0.25));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }));
  sky.renderOrder = -1;
  scene.add(sky);
  return sky;
}

function buildMountains(scene, terrain) {
  const rnd = mulberry32(99);
  const mat = new THREE.MeshLambertMaterial({ color: 0xdfe9f5, flatShading: true });
  const rock = new THREE.MeshLambertMaterial({ color: 0x7d8ea3, flatShading: true });
  const base = terrain.profile(terrain.park.endS);
  const cz = -terrain.park.endS / 2; // ring of peaks centred on the park
  for (let i = 0; i < 26; i++) {
    const ang = (i / 26) * Math.PI * 2;
    const r = 1050 + rnd() * 350;
    const h = 320 + rnd() * 420;
    const geo = new THREE.ConeGeometry(160 + rnd() * 200, h, 5 + Math.floor(rnd() * 3));
    const m = new THREE.Mesh(geo, rnd() > 0.3 ? mat : rock);
    m.position.set(Math.cos(ang) * r, base - 80 + h / 2, cz + Math.sin(ang) * r);
    m.rotation.y = rnd() * 3;
    scene.add(m);
  }
}

function post(scene, x, y, z, h, color, r = 0.12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 8), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  scene.add(m);
  return m;
}

function banner(scene, text, x, y, z, w, h, opts) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: textTexture(text, opts), side: THREE.DoubleSide }));
  m.position.set(x, y, z);
  scene.add(m);
  return m;
}

function netTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(30,123,255,0.9)';
  g.lineWidth = 3;
  for (let i = 0; i <= 64; i += 16) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 64);
    g.moveTo(0, i);
    g.lineTo(64, i);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function buildGates(terrain, scene) {
  const park = terrain.park;
  // Start gate: two posts and a banner on the platform.
  const s0 = park.startS - 3;
  const y0 = terrain.height(0, -s0);
  post(scene, -5, y0, -s0, 4.2, 0xffffff, 0.18);
  post(scene, 5, y0, -s0, 4.2, 0xffffff, 0.18);
  banner(scene, 'CRANSKI · BIG AIR', 0, y0 + 4.0, -s0, 10.4, 1.3);
  // Start hut.
  const hut = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 3), new THREE.MeshLambertMaterial({ color: 0xd0473a }));
  hut.position.set(-9, y0 + 1.5, -s0 + 2);
  hut.castShadow = true;
  scene.add(hut);

  // Finish line: blue line, tall side markers, netting and a banner.
  const sf = park.finishS;
  const yf = terrain.height(0, -sf);
  scene.add(paintLine(terrain, sf, park.halfWidth * 2, 0.8));
  for (const side of [-1, 1]) {
    const x = side * (park.halfWidth - 1);
    post(scene, x, terrain.height(x, -sf), -sf, 9, BLUE, 0.3);
    const net = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 3),
      new THREE.MeshBasicMaterial({ map: netTexture(), transparent: true, side: THREE.DoubleSide })
    );
    net.material.map.repeat.set(20, 1.5);
    net.rotation.y = Math.PI / 2;
    net.position.set(side * (park.halfWidth + 1), yf + 1.5, -(sf + 20));
    scene.add(net);
  }
  banner(scene, 'FINISH', 0, yf + 8, -sf, park.halfWidth * 2 - 2, 2.4);
}

function buildFeatureMarkings(terrain, scene) {
  const park = terrain.park;
  const W = park.halfWidth * 2 + 6;
  // Blue lip line so the kicker reads at speed, plus a thinner line at the start of the face.
  scene.add(paintLine(terrain, park.lipS - 0.35, W, 0.6));
  scene.add(paintLine(terrain, park.kickerStartS + 2, W, 0.25));
  // Knuckle line on the deck.
  scene.add(paintLine(terrain, park.knuckleS, W, 0.35));
  // Blue edge rails along the kicker sides so its shape reads from the inrun.
  for (const side of [-1, 1]) {
    const x = side * (park.halfWidth + 0.5);
    const pts = [];
    for (let s = park.kickerStartS; s <= park.lipS + 4.5; s += 0.5) {
      pts.push(new THREE.Vector3(x, terrain.profile(s) + 0.6, -s));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.12, 6), new THREE.MeshBasicMaterial({ color: BLUE }));
    scene.add(tube);
  }
  // Distance boards along the landing.
  for (let d = 150; d <= 300; d += 25) {
    const s = park.lipS + d;
    for (const side of [-1, 1]) {
      const x = side * (park.halfWidth + 2.5);
      const y = terrain.height(x, -s);
      const b = banner(scene, `${d} m`, x, y + 1.4, -s, 3, 0.9, { w: 256, h: 80, font: 'italic 900 56px Impact, sans-serif', bg: d === 225 ? '#ff5a36' : '#1e7bff' });
      b.rotation.y = side * -Math.PI / 2;
      post(scene, x, y, -s, 0.9, 0x223344, 0.05);
    }
  }
}

export function buildWorld(terrain) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xcfe6ff, 250, 2200);

  buildSky(scene);
  buildMountains(scene, terrain);

  const hemi = new THREE.HemisphereLight(0xdcecff, 0x8a9bb0, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.0);
  sun.position.set(-40, 80, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -30;
  sc.right = 30;
  sc.top = 30;
  sc.bottom = -30;
  sc.near = 1;
  sc.far = 250;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  scene.add(sun.target);

  scene.add(buildTerrainMesh(terrain));
  buildFeatureMarkings(terrain, scene);
  buildTrees(terrain, scene);
  buildGates(terrain, scene);

  // Keep the sun's shadow box centred on the rider.
  const sunOffset = sun.position.clone();
  function follow(target) {
    sun.target.position.copy(target);
    sun.position.copy(target).add(sunOffset);
  }

  return { scene, follow };
}
