// Loads the Blender-built models (public/models/*.glb, made by
// tools/blender/build_assets.py) and turns each object into a reusable part:
// one geometry (with a group per material) and the material names in order.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const ASSETS = { ready: false, parts: {} };

const FILES = ['rider', 'trees', 'lift'];

function collect(root) {
  const parts = {};
  for (const node of root.children) {
    const meshes = [];
    node.traverse((o) => {
      if (o.isMesh) meshes.push(o);
    });
    if (!meshes.length) continue;
    node.updateMatrixWorld(true);
    const geos = [];
    const mats = [];
    for (const m of meshes) {
      const g = m.geometry.clone();
      // Bake any node transform below the part's root into the geometry.
      const rel = new THREE.Matrix4().copy(node.matrixWorld).invert().multiply(m.matrixWorld);
      g.applyMatrix4(rel);
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      geos.push(g);
      mats.push(m.material.name);
    }
    // Every primitive needs the same attributes to merge.
    const needUv = geos.some((g) => g.attributes.uv);
    for (const g of geos) {
      if (needUv && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!needUv && g.attributes.uv) g.deleteAttribute('uv');
    }
    const geometry = geos.length === 1 ? geos[0] : mergeGeometries(geos, true);
    if (geos.length === 1) {
      geometry.clearGroups();
      geometry.addGroup(0, geometry.index ? geometry.index.count : geometry.attributes.position.count, 0);
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    parts[node.name] = { geometry, mats };
  }
  return parts;
}

export async function loadAssets(onProgress = () => {}) {
  if (ASSETS.ready) return ASSETS;
  const loader = new GLTFLoader();
  const base = import.meta.env?.BASE_URL ?? './';
  let done = 0;
  await Promise.all(
    FILES.map(async (f) => {
      const gltf = await loader.loadAsync(`${base}models/${f}.glb`);
      Object.assign(ASSETS.parts, collect(gltf.scene));
      done++;
      onProgress(done / FILES.length);
    })
  );
  ASSETS.ready = true;
  return ASSETS;
}

// A geometry normalised to unit length along y and centred, for parts that get
// stretched between two joints (limbs, poles).
export function unitAlongY(geometry) {
  const g = geometry.clone();
  g.computeBoundingBox();
  const b = g.boundingBox;
  const h = b.max.y - b.min.y || 1;
  g.translate(0, -(b.max.y + b.min.y) / 2, 0);
  g.scale(1, 1 / h, 1);
  g.computeBoundingSphere();
  return g;
}

// Materials for a part, looked up by the names used in Blender.
export function partMaterials(part, byName, fallback) {
  return part.mats.map((n) => byName[n] || fallback);
}
