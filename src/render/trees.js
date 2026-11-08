// Pine trees in tiers, some dusted with snow. One merged geometry per variant
// with vertex colours, so a whole forest is a handful of instanced draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
      // A cap of snow on the top of each tier.
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

let cache = null;
export function pineGeometries() {
  if (!cache) cache = { snowy: pine('snowy', 8), dark: pine('dark', 8), far: pine('snowy', 6) };
  return cache;
}

export function treeMaterial() {
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}
