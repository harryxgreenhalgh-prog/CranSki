// Basecamp: a sunny plaza at the foot of the mountain where your rider stands.
import * as THREE from 'three';
import { Sky } from './sky.js';
import { mulberry32 } from '../sim/rng.js';
import { textTexture } from './world.js';

export function buildBasecamp() {
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xdcecff, 0x8a9bb0, 1.3);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
  sun.position.set(-6, 12, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 40 });
  scene.add(sun);
  const sky = new Sky(scene, 'day', { hemi, sun });
  sky.fog.near = 60;
  sky.fog.far = 900;

  const snow = new THREE.Mesh(new THREE.CircleGeometry(400, 48), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  snow.rotation.x = -Math.PI / 2;
  snow.receiveShadow = true;
  scene.add(snow);

  // Lodge behind the rider.
  const lodge = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(14, 5, 7), new THREE.MeshLambertMaterial({ color: 0x8c5a3c }));
  wall.position.y = 2.5;
  lodge.add(wall);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 6, 15, 3, 1), new THREE.MeshLambertMaterial({ color: 0xf2f6fb }));
  roof.rotation.z = Math.PI / 2;
  roof.rotation.y = Math.PI / 2;
  roof.scale.set(0.6, 1, 1);
  roof.position.y = 6.2;
  lodge.add(roof);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1), new THREE.MeshBasicMaterial({ map: textTexture('BASECAMP') }));
  sign.position.set(0, 4.1, 3.52);
  lodge.add(sign);
  for (const x of [-4.5, 4.5]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.6), new THREE.MeshBasicMaterial({ color: 0xffd58a }));
    win.position.set(x, 2.4, 3.52);
    lodge.add(win);
  }
  lodge.position.set(2, 0, -14);
  scene.add(lodge);

  // Ski rack and a few trees.
  const rnd = mulberry32(3);
  const leaf = new THREE.MeshLambertMaterial({ color: 0x1f5a3a });
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 18 + rnd() * 60;
    const x = Math.cos(a) * r;
    const z = -Math.abs(Math.sin(a) * r) - 6;
    const t = new THREE.Mesh(new THREE.ConeGeometry(2 + rnd(), 7 + rnd() * 4, 7), leaf);
    t.position.set(x, 3.5, z);
    scene.add(t);
  }
  const mountMat = new THREE.MeshLambertMaterial({ color: 0xe6eef8, flatShading: true });
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(160 + rnd() * 120, 260 + rnd() * 260, 6), mountMat);
    m.position.set(-500 + i * 125, 100, -600 - rnd() * 200);
    scene.add(m);
  }
  // Lift pass kiosk flag.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 6), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
  pole.position.set(-3.5, 2, -2);
  scene.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), new THREE.MeshBasicMaterial({ color: 0x1e7bff, side: THREE.DoubleSide }));
  flag.position.set(-2.7, 3.5, -2);
  scene.add(flag);

  const anchor = new THREE.Group(); // the rider stands here
  scene.add(anchor);

  function frameCamera(camera, aspect, focus = 'full') {
    // Rider slightly left of centre so the lift pass card fits beside them.
    const close = focus === 'close';
    const dist = close ? 2.6 : aspect < 0.8 ? 6.2 : 4.6;
    camera.position.set(close ? 0.4 : 0.9, close ? 1.4 : 1.25, dist);
    camera.lookAt(close ? 0.4 : 0.6, close ? 1.15 : 1.0, 0);
  }

  function update(time, camera) {
    sky.update(time, 0, camera.position);
    flag.rotation.y = Math.sin(time * 1.3) * 0.2;
  }

  return { scene, anchor, frameCamera, update };
}
