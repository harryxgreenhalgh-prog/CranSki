// Loads the Blender-built models (public/models/*.glb, made by
// tools/blender/build_assets.py) and turns each object into a reusable part:
// one geometry (with a group per material) and the material names in order.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// The models are meshopt-compressed (tools/optimize-models.sh).
function gltfLoader() {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}

// Compressed models store some attributes as small integers; turn them back
// into plain floats so parts can be transformed and merged.
function toFloat(attr) {
  if (attr.isInterleavedBufferAttribute || !(attr.array instanceof Float32Array) || attr.normalized) {
    const n = attr.count;
    const k = attr.itemSize;
    const out = new Float32Array(n * k);
    for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) out[i * k + j] = attr.getComponent(i, j);
    return new THREE.BufferAttribute(out, k);
  }
  return attr;
}

export const ASSETS = { ready: false, parts: {}, body: null };

const FILES = ['rider', 'trees', 'lift', 'props'];

function collect(root) {
  const parts = {};
  for (const node of root.children) {
    const meshes = [];
    node.traverse((o) => {
      if (o.isMesh) meshes.push(o);
    });
    if (!meshes.length) continue;
    root.updateMatrixWorld(true);
    const geos = [];
    const mats = [];
    for (const m of meshes) {
      const g = m.geometry.clone();
      for (const name of Object.keys(g.attributes)) g.setAttribute(name, toFloat(g.attributes[name]));
      // Bake every node transform into the geometry: parts are modelled at the
      // origin, and compressed models keep their dequantising scale on the node.
      g.applyMatrix4(m.matrixWorld);
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
  const loader = gltfLoader();
  const base = import.meta.env?.BASE_URL ?? './';
  let done = 0;
  const total = FILES.length + 1;
  await Promise.all([
    ...FILES.map(async (f) => {
      const gltf = await loader.loadAsync(`${base}models/${f}.glb`);
      Object.assign(ASSETS.parts, collect(gltf.scene));
      done++;
      onProgress(done / total);
    }),
    // The skinned body (tools/blender/build_rider_body.py): kept whole, with its skeleton.
    loader.loadAsync(`${base}models/rider-body.glb`).then(
      (gltf) => {
        ASSETS.body = gltf.scene;
        done++;
        onProgress(done / total);
      },
      (e) => console.warn('rider body', e)
    ),
  ]);
  ASSETS.ready = true;
  return ASSETS;
}

// Whole scenes (textured Sketchfab models), loaded on demand and cached.
const scenes = new Map();
export function loadScene(name) {
  if (!scenes.has(name)) {
    const base = import.meta.env?.BASE_URL ?? './';
    scenes.set(
      name,
      gltfLoader().loadAsync(`${base}models/${name}.glb`).then((g) => {
        g.scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        return g.scene;
      })
    );
  }
  return scenes.get(name);
}

const ready = new Map();
export async function preloadScenes(names) {
  await Promise.all(names.map(async (n) => ready.set(n, await loadScene(n))));
}

export function hasScene(name) {
  return ready.has(name);
}

// A copy of a loaded scene (sharing geometry and textures), marked so a park's
// clean-up never disposes the shared data. Null if it isn't loaded.
export function sceneCopy(name) {
  const s = ready.get(name);
  if (!s) return null;
  const c = s.clone(true);
  c.traverse((o) => (o.userData.shared = true));
  return c;
}

// Size and ground offset of a model, for placing it.
export function modelBounds(obj) {
  return new THREE.Box3().setFromObject(obj);
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

// One geometry with each material's colour baked into vertex colours, so a
// many-material part draws in a single call with one vertexColors material.
// colors: material name -> hex (missing names use `fallback`). Cached by key.
const _baked = new Map();
export function bakedPart(name, colors, fallback = 0x888888, key = name) {
  if (_baked.has(key)) return _baked.get(key);
  const part = ASSETS.parts[name];
  if (!part) return null;
  const src = part.geometry;
  const g = src.index ? src.toNonIndexed() : src.clone();
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color();
  // toNonIndexed keeps the groups (now in vertex units).
  const groups = src.groups.length ? src.groups : [{ start: 0, count: src.index ? src.index.count : n, materialIndex: 0 }];
  for (const grp of groups) {
    c.setHex(colors[part.mats[grp.materialIndex]] ?? fallback);
    for (let i = grp.start; i < Math.min(n, grp.start + grp.count); i++) col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  g.clearGroups();
  g.computeBoundingSphere();
  _baked.set(key, g);
  return g;
}

// Every geometry that belongs to the asset set (never disposed with a park).
export function sharedGeometries() {
  return new Set([...Object.values(ASSETS.parts).map((p) => p.geometry), ..._baked.values()]);
}

// Materials for a part, looked up by the names used in Blender.
export function partMaterials(part, byName, fallback) {
  return part.mats.map((n) => byName[n] || fallback);
}
