import * as THREE from 'three';
import { DT } from './sim/constants.js';
import { Terrain } from './sim/terrain.js';
import { Run } from './sim/run.js';
import { EMPTY_INPUT } from './sim/rider.js';
import { Input } from './input.js';
import { buildWorld } from './render/world.js';
import { RiderModel, COM_HEIGHT } from './render/riderModel.js';
import { ChaseCam } from './render/camera.js';
import { Spray } from './render/spray.js';
import { Hud, showResults, CONTROLS_HTML } from './ui/hud.js';
import { PARKS, parkMeta } from './parks/index.js';

const $ = (id) => document.getElementById(id);

function hasWebGL2() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage blocked: just don't persist */
    }
  },
};

function boot() {
  $('controls-help').innerHTML = CONTROLS_HTML;
  $('pause-help').innerHTML = CONTROLS_HTML;
  if (!hasWebGL2()) {
    $('title').classList.add('hidden');
    $('nogl').classList.remove('hidden');
    return;
  }

  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 6000);
  const model = new RiderModel();
  const input = new Input(window);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ------------------------------------------------------------ park loading
  let parkId = store.get('cranski.park', 'bigair');
  let loaded = null; // { id, terrain, run, world, chase, spray, hud }
  let loading = null;

  async function loadPark(id) {
    if (loaded && loaded.id === id) return loaded;
    if (loading && loading.id === id) return loading.promise;
    const meta = parkMeta(id);
    const promise = (async () => {
      const mod = await meta.load();
      const terrain = new Terrain(mod.park);
      const world = buildWorld(terrain, { quality: 'high' });
      if (loaded) {
        loaded.world.scene.remove(model.root);
        loaded.world.dispose();
      }
      const run = new Run(terrain);
      const chase = new ChaseCam(camera, terrain);
      const spray = new Spray(world.scene);
      const hud = new Hud(terrain);
      world.scene.add(model.root);
      renderer.compile(world.scene, camera);
      loaded = { id, meta, terrain, run, world, chase, spray, hud, time: 0 };
      return loaded;
    })();
    loading = { id, promise };
    try {
      return await promise;
    } finally {
      loading = null;
    }
  }

  // ------------------------------------------------------------ menus
  function renderParkList() {
    const list = $('park-list');
    list.replaceChildren(
      ...PARKS.map((p) => {
        const b = document.createElement('button');
        b.className = p.id === parkId ? 'sel' : '';
        const best = store.get(`cranski.best.${p.id}`, 0);
        b.innerHTML = `<div class="pname">${p.name}</div><div class="pmeta">${p.length} · ${p.features}</div><div class="pmeta">${p.lift}${best ? ` · best ${best.toLocaleString('en-US')}` : ''}</div>`;
        b.addEventListener('click', () => {
          parkId = p.id;
          store.set('cranski.park', parkId);
          renderParkList();
        });
        b.addEventListener('dblclick', () => goRide());
        return b;
      })
    );
  }
  renderParkList();

  // ------------------------------------------------------------ state
  let state = 'title'; // title | loading | lift | riding | paused | results
  let acc = 0;
  let last = performance.now();
  let restartHold = 0;
  let resultsDelay = 0;
  let absorb = 0;
  let prevMode = 'ground';
  let lift = null; // { t, duration }
  const prevPos = new THREE.Vector3();
  const prevQ = new THREE.Quaternion();

  function setOverlay(id) {
    for (const o of ['title', 'pause', 'results']) $(o).classList.toggle('hidden', o !== id);
  }

  function blurMenus() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  async function goRide() {
    blurMenus();
    state = 'loading';
    $('ride').textContent = 'LOADING…';
    try {
      await loadPark(parkId);
    } finally {
      $('ride').innerHTML = 'RIDE <kbd>Enter</kbd>';
    }
    startLift();
  }

  function startLift() {
    const L = loaded;
    L.run.reset();
    L.hud.clearTrick();
    setOverlay(null);
    L.hud.show(true);
    L.hud.show(false);
    lift = { t: 0, duration: L.world.lift.ride.duration };
    state = 'lift';
    const names = { gondola: 'GONDOLA', ropeway: 'ROPEWAY', tbar: 'T-BAR' };
    $('lift-name').textContent = names[L.world.lift.ride.type];
    $('liftbar').classList.remove('hidden');
  }

  function startRun() {
    blurMenus();
    const L = loaded;
    L.run.reset();
    prevPos.copy(L.run.rider.pos);
    prevQ.copy(L.run.rider.q);
    prevMode = L.run.rider.mode;
    L.chase.snap();
    L.hud.clearTrick();
    $('liftbar').classList.add('hidden');
    state = 'riding';
    setOverlay(null);
    L.hud.show(true);
    acc = 0;
    restartHold = 0;
    resultsDelay = 0;
    L.hud.hint(`${L.meta.name} · W tuck · Space pop`, 3);
  }

  function pause(on) {
    if (on && state === 'riding') {
      state = 'paused';
      setOverlay('pause');
    } else if (!on && state === 'paused') {
      state = 'riding';
      setOverlay(null);
      last = performance.now();
    }
  }

  function toTitle() {
    state = 'title';
    if (loaded) loaded.hud.show(false);
    $('liftbar').classList.add('hidden');
    renderParkList();
    setOverlay('title');
  }

  function finish() {
    const L = loaded;
    const res = L.run.results();
    res.parkName = L.meta.name;
    const key = `cranski.best.${L.id}`;
    const best = store.get(key, 0);
    const isNew = res.total > best;
    if (isNew) store.set(key, res.total);
    showResults(res, Math.max(best, res.total), isNew);
    state = 'results';
    setOverlay('results');
  }

  $('ride').addEventListener('click', goRide);
  $('pause').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'resume') pause(false);
    if (act === 'restart') startRun();
    if (act === 'help') $('pause-help').classList.toggle('hidden');
  });
  $('results').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'again') startLift();
    if (act === 'map') toTitle();
  });

  // ------------------------------------------------------------ loop
  const pivot = new THREE.Vector3();
  const renderPos = new THREE.Vector3();
  const renderQ = new THREE.Quaternion();
  const n = { x: 0, y: 1, z: 0 };
  const leanQ = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const xAxis = new THREE.Vector3(1, 0, 0);
  const liftPos = new THREE.Vector3();
  const liftDir = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const titleCam = { pos: new THREE.Vector3(), look: new THREE.Vector3() };

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    input.pollFrame();

    if (state === 'title') {
      if (input.wasPressed('confirm')) goRide();
    } else if (state === 'results') {
      if (input.wasPressed('confirm')) startLift();
    } else if (state === 'lift') {
      if (input.wasPressed('skipLift') || input.wasPressed('confirm')) lift.t = lift.duration;
    } else if (state === 'paused') {
      if (input.wasPressed('pause')) pause(false);
    } else if (state === 'riding') {
      if (input.wasPressed('pause')) pause(true);
    }

    const L = loaded;
    if (!L) {
      renderer.setClearColor(0x9fd3ff);
      renderer.clear();
      input.endFrame();
      return;
    }
    L.time += dt;
    const run = L.run;
    const r = run.rider;

    if (state === 'lift') {
      lift.t += dt;
      if (lift.t >= lift.duration) startRun();
    }

    if (state === 'riding') {
      if (input.restartHeld()) {
        restartHold += dt;
        if (restartHold >= 2) {
          restartHold = 0;
          startRun();
        }
      } else restartHold = 0;
      L.hud.setRestart(Math.min(1, restartHold / 2));

      acc += dt;
      let steps = 0;
      const inp = run.finished ? EMPTY_INPUT : input.sample();
      while (acc >= DT && steps < 12) {
        prevPos.copy(r.pos);
        prevQ.copy(r.q);
        run.step(inp);
        acc -= DT;
        steps++;
        if (r.mode !== prevMode) {
          if (r.mode === 'air') L.spray.burst(r.pos, r.vel, 40, 3);
          if (prevMode === 'air') {
            L.spray.burst(r.pos, r.vel, r.mode === 'crash' ? 120 : 80, r.mode === 'crash' ? 6 : 4);
            absorb = 0.35;
          }
          prevMode = r.mode;
        }
      }
      if (steps >= 12) acc = 0;

      for (const m of run.messages) {
        if (m.type === 'finish') resultsDelay = 1.6;
        else L.hud.message(m);
      }
      run.messages.length = 0;
      if (resultsDelay > 0) {
        resultsDelay -= dt;
        if (resultsDelay <= 0) finish();
      }
      L.hud.update(run, dt);
    }

    // ------------------------------------------------ draw
    if (state === 'lift') {
      const ride = L.world.lift.ride;
      const t = Math.min(1, lift.t / lift.duration);
      ride.sample(t, liftPos, liftDir);
      if (ride.type === 'tbar') {
        // Rider stands on the snow, pulled up the track.
        model.root.visible = true;
        L.terrain.normal(liftPos.x, liftPos.z, n);
        model.root.position.set(liftPos.x, liftPos.y + COM_HEIGHT, liftPos.z);
        tmp.set(liftDir.x, 0, liftDir.z).normalize();
        model.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), tmp);
        model.update({ crouch: 0.2, tuck: 0, legsUp: 0, lean: 0, look: 0, armsOut: 0, grab: null, grabSide: 1 }, dt);
        camera.position.copy(liftPos).addScaledVector(tmp, -7).add(tmp.set(0, 3, 0));
        camera.lookAt(liftPos.x + liftDir.x * 20, liftPos.y + liftDir.y * 20 + 1, liftPos.z + liftDir.z * 20);
      } else {
        model.root.visible = false;
        camera.position.copy(liftPos).addScaledVector(liftDir, -9).add(tmp.set(4, 3.5, 0));
        camera.lookAt(liftPos.x + liftDir.x * 30, liftPos.y + liftDir.y * 30, liftPos.z + liftDir.z * 30);
      }
      if (Math.abs(camera.fov - 65) > 0.1) {
        camera.fov = 65;
        camera.updateProjectionMatrix();
      }
      L.world.update(L.time, liftPos, camera);
      renderer.render(L.world.scene, camera);
      input.endFrame();
      return;
    }

    model.root.visible = true;
    const alpha = state === 'riding' ? acc / DT : 1;
    renderPos.lerpVectors(prevPos, r.pos, alpha);
    renderQ.slerpQuaternions(prevQ, r.q, alpha);
    if (state === 'title' || state === 'loading') {
      renderPos.copy(r.pos);
      renderQ.copy(r.q);
    }

    if (r.mode === 'crash') {
      L.terrain.normal(renderPos.x, renderPos.z, n);
      pivot.set(renderPos.x + n.x * 0.25, renderPos.y + n.y * 0.25, renderPos.z + n.z * 0.25);
    } else if (r.mode === 'ground') {
      L.terrain.normal(renderPos.x, renderPos.z, n);
      const h = COM_HEIGHT - r.sink; // sink into powder
      pivot.set(renderPos.x + n.x * h, renderPos.y + n.y * h, renderPos.z + n.z * h);
      if (r.powder > 0.5 && r.speed > 4 && state === 'riding') L.spray.burst(r.pos, r.vel, 2, 1.5 + r.speed * 0.05);
    } else if (r.mode === 'rail') {
      pivot.set(renderPos.x, renderPos.y + COM_HEIGHT, renderPos.z);
    } else {
      pivot.set(renderPos.x, renderPos.y + COM_HEIGHT, renderPos.z);
    }
    model.root.position.copy(pivot);
    model.root.quaternion.copy(renderQ);
    if (r.mode === 'ground') {
      leanQ.setFromAxisAngle(zAxis, -model.pose.lean * 0.45);
      model.root.quaternion.multiply(leanQ);
      if (r.butter) {
        // Tip onto the nose or tail of the skis.
        const k = Math.min(1, r.butter.time / 0.15);
        const ang = (r.butter.kind === 'nose' ? -1 : 1) * (r.butter.deep ? 36 : 24) * (Math.PI / 180) * k;
        model.root.quaternion.multiply(leanQ.setFromAxisAngle(xAxis, ang));
        model.root.position.y += 0.25 * k;
      }
    }

    absorb = Math.max(0, absorb - dt);
    const a = r.air;
    model.update(
      {
        crouch: r.mode === 'ground' ? Math.max(r.load, absorb > 0 ? 0.9 : 0) : r.mode === 'air' ? 0.25 : r.mode === 'rail' ? 0.35 : 0.6,
        press: r.mode === 'rail' && r.rail.press ? 1 : 0,
        wide: r.mode === 'rail' ? 1 : 0,
        tuck: r.mode === 'ground' && r.tucking ? 1 : 0,
        legsUp: r.mode === 'air' ? 0.35 : 0,
        lean: r.mode === 'ground' ? r.lean : 0,
        look: r.switchStance && r.mode !== 'crash' ? 1 : 0,
        armsOut: r.mode === 'air' && r.omega.length() > 120 ? 1 : r.mode === 'air' ? 0.4 : 0,
        grab: r.activeGrab,
        grabSide: a && a.spin < 0 ? 1 : -1,
      },
      dt
    );

    L.spray.update(dt);
    if (state === 'title') {
      // Slow orbit around the start gate behind the menu.
      const ang = L.time * 0.08;
      titleCam.pos.set(pivot.x + Math.sin(ang) * 14, pivot.y + 5, pivot.z + Math.cos(ang) * 14);
      camera.position.copy(titleCam.pos);
      camera.lookAt(pivot);
    } else {
      L.chase.update(r, pivot, dt);
    }
    L.world.update(L.time, pivot, camera);
    renderer.render(L.world.scene, camera);
    input.endFrame();
  }

  // Show the last-picked park behind the menu.
  loadPark(parkId).catch((e) => console.error(e));

  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });

  // Small debug handle for automated checks in the console.
  window.__cranski = {
    get run() {
      return loaded?.run;
    },
    get terrain() {
      return loaded?.terrain;
    },
    camera,
    pivot,
    get state() {
      return state;
    },
    startRun,
    goRide,
    selectPark(id) {
      parkId = id;
    },
  };
}

boot();
