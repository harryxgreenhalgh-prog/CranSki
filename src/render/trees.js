// Pine trees. The Blender-built pines (layered, snow on the branches) are used
// when they've loaded; otherwise simple tiered cones built here.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ASSETS, bakedPart } from './assets.js';

function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// variant: 'snowy' (snow on every tier) or 'dark' (bare green)
function pine(variant, segs) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.2, 0.32, 2.4, 6);
  trunk.translate(0, 1.2, 0);
  parts.push(colored(trunk, 0x4a3324));
  const tiers = [
    [1.4, 2.6, 3.4],
    [3.1, 2.1, 3.1],
    [4.7, 1.6, 2.8],
    [6.2, 1.1, 2.4],
    [7.5, 0.62, 1.9],
  ];
  const greens = [0x173f2b, 0x1c4a32, 0x1a4430, 0x205236, 0x1d4a33];
  tiers.forEach(([y0, r, h], i) => {
    const cone = new THREE.ConeGeometry(r, h, segs, 1);
    cone.rotateY(i * 0.7);
    cone.translate(0, y0 + h / 2, 0);
    parts.push(colored(cone, greens[i]));
    if (variant === 'snowy') {
      const cap = new THREE.ConeGeometry(r * 0.74, h * 0.42, segs, 1);
      cap.rotateY(i * 0.7 + 0.3);
      cap.translate(0, y0 + h * 0.79, 0);
      parts.push(colored(cap, 0xeef3fa));
    }
  });
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

// A tiny distant pine (about 30 triangles): two green cones and a snowy tip.
let _tiny = null;
function tinyPine() {
  if (_tiny) return _tiny;
  const parts = [];
  const a = new THREE.ConeGeometry(2.4, 4.6, 5, 1);
  a.translate(0, 3.6, 0);
  parts.push(colored(a, 0x1a4430));
  const b = new THREE.ConeGeometry(1.6, 3.6, 5, 1);
  b.rotateY(0.6);
  b.translate(0, 6.2, 0);
  parts.push(colored(b, 0x1d4a33));
  const c = new THREE.ConeGeometry(0.9, 1.6, 5, 1);
  c.rotateY(0.3);
  c.translate(0, 7.6, 0);
  parts.push(colored(c, 0xeef3fa));
  _tiny = mergeGeometries(parts);
  _tiny.computeVertexNormals();
  return _tiny;
}

let cache = null;
let mats = null;

// { snowy, dark, far }: each { geometry, material } ready for an InstancedMesh.
export function pineSet() {
  if (cache && cache.fromAssets === ASSETS.ready) return cache;
  const P = ASSETS.parts;
  if (ASSETS.ready && P.pineSnowy) {
    // Colours baked into the vertices: each batch of trees is one draw call.
    mats ||= new THREE.MeshLambertMaterial({ vertexColors: true });
    const colors = { bark: 0x4a3324, needles: 0x1d4c33, needlesDark: 0x123524, snow: 0xf0f4fa };
    const make = (name) => ({ geometry: bakedPart(name, colors, colors.needles), material: mats });
    cache = { fromAssets: true, snowy: make('pineSnowy'), dark: make('pineGreen'), far: make('pineFar'), tiny: { geometry: tinyPine(), material: mats } };
  } else {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    cache = { fromAssets: false, snowy: { geometry: pine('snowy', 8), material }, dark: { geometry: pine('dark', 8), material }, far: { geometry: pine('snowy', 6), material }, tiny: { geometry: tinyPine(), material } };
  }
  return cache;
}
