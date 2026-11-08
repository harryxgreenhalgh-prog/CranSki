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

  const camPos = new THREE.Vector3(0.9, 1.25, 4.6);
  const camLook = new THREE.Vector3(0.6, 1.0, 0);
  const wantPos = new THREE.Vector3();
  const wantLook = new THREE.Vector3();
  // focus: full (lobby), close (head and goggles), low (skis and boots), locker (full, centred)
  function frameCamera(camera, aspect, focus = 'full', dt = 1) {
    const narrow = aspect < 0.8;
    if (focus === 'close') {
      wantPos.set(0.15, 1.75, narrow ? 1.6 : 1.25);
      wantLook.set(0.15, 1.6, 0);
    } else if (focus === 'low') {
      wantPos.set(0.5, 1.15, narrow ? 4.2 : 3.3);
      wantLook.set(0.3, 0.5, 0);
    } else if (focus === 'locker') {
      wantPos.set(0.2, 1.2, narrow ? 5.6 : 3.8);
      wantLook.set(0.15, 0.95, 0);
    } else {
      wantPos.set(0.9, 1.25, narrow ? 6.2 : 4.6);
      wantLook.set(0.6, 1.0, 0);
    }
    const k = 1 - Math.exp(-dt * 6);
    camPos.lerp(wantPos, k);
    camLook.lerp(wantLook, k);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
  }

  function update(time, camera) {
    sky.update(time, 0, camera.position);
    flag.rotation.y = Math.sin(time * 1.3) * 0.2;
  }

  // Swap the box lodge for the snowy log cabin model.
  function setLodge(cabin, bounds) {
    if (!cabin) return;
    lodge.visible = false;
    const b = bounds(cabin);
    const k = 1.55;
    cabin.scale.setScalar(k);
    cabin.position.set(1.5, -b.min.y * k - 0.05, -13);
    cabin.rotation.y = 0;
    scene.add(cabin);
    const sign2 = sign.clone();
    sign2.position.set(1.5, (b.max.y - b.min.y) * k * 0.62, -13 + b.max.z * k + 0.3);
    scene.add(sign2);
  }

  return { scene, anchor, frameCamera, update, setLodge };
}
