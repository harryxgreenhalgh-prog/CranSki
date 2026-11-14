// The season leader's crown: a small gold band with five points and a gem on
// each, drawn above (or on) a rider's head.
import * as THREE from 'three';

let shared = null;
function parts() {
  if (shared) return shared;
  const gold = new THREE.MeshStandardMaterial({ color: 0xffc93c, metalness: 0.85, roughness: 0.28, emissive: 0x4a3200, emissiveIntensity: 0.6 });
  const gem = new THREE.MeshStandardMaterial({ color: 0xff3b6b, metalness: 0.2, roughness: 0.2, emissive: 0x5a0018, emissiveIntensity: 0.8 });
  shared = {
    gold,
    gem,
    band: new THREE.CylinderGeometry(0.11, 0.1, 0.06, 20, 1, true),
    point: new THREE.ConeGeometry(0.026, 0.07, 6),
    stone: new THREE.SphereGeometry(0.014, 8, 6),
  };
  return shared;
}

export function makeCrown(scale = 1) {
  const p = parts();
  const g = new THREE.Group();
  const band = new THREE.Mesh(p.band, p.gold);
  band.material.side = THREE.DoubleSide;
  g.add(band);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const pt = new THREE.Mesh(p.point, p.gold);
    pt.position.set(Math.cos(a) * 0.105, 0.06, Math.sin(a) * 0.105);
    g.add(pt);
    const st = new THREE.Mesh(p.stone, p.gem);
    st.position.set(Math.cos(a) * 0.11, 0.0, Math.sin(a) * 0.11);
    g.add(st);
  }
  g.scale.setScalar(scale);
  g.name = 'crown';
  return g;
}
