import * as THREE from 'three';
import { DT } from './sim/constants.js';
import { Terrain, BIG_AIR } from './sim/terrain.js';
import { Run } from './sim/run.js';
import { EMPTY_INPUT } from './sim/rider.js';
import { Input } from './input.js';
import { buildWorld } from './render/world.js';
import { RiderModel, COM_HEIGHT } from './render/riderModel.js';
import { ChaseCam } from './render/camera.js';
import { Spray } from './render/spray.js';
import { Hud, showResults, CONTROLS_HTML } from './ui/hud.js';

const $ = (id) => document.getElementById(id);
const BEST_KEY = 'cranski.best.bigair';

function hasWebGL2() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

function loadBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(v) {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    /* storage blocked: bests just don't persist */
  }
}

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

  const terrain = new Terrain(BIG_AIR);
  const run = new Run(terrain);
  const { scene, follow } = buildWorld(terrain);
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 4000);
  const chase = new ChaseCam(camera, terrain);
  const model = new RiderModel();
  scene.add(model.root);
  const spray = new Spray(scene);
  const input = new Input(window);
  const hud = new Hud(terrain);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ------------------------------------------------------------ state
  let state = 'title'; // title | riding | paused | results
  let acc = 0;
  let last = performance.now();
  let restartHold = 0;
  let resultsDelay = 0;
  let best = loadBest();
  let absorb = 0;
  let prevMode = run.rider.mode;
  const prevPos = new THREE.Vector3().copy(run.rider.pos);
  const prevQ = new THREE.Quaternion().copy(run.rider.q);

  function setOverlay(id) {
    for (const o of ['title', 'pause', 'results']) $(o).classList.toggle('hidden', o !== id);
  }

  function startRun() {
    // Drop focus from any menu button so Space/Enter go to the game, not the button.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    run.reset();
    prevPos.copy(run.rider.pos);
    prevQ.copy(run.rider.q);
    prevMode = run.rider.mode;
    chase.snap();
    hud.clearTrick();
    state = 'riding';
    setOverlay(null);
    hud.show(true);
    acc = 0;
    hud.hint('Hold W to tuck down the inrun · Space to pop at the lip', 4);
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

  function finish() {
    const res = run.results();
    const isNew = res.total > best;
    if (isNew) {
      best = res.total;
      saveBest(best);
    }
    showResults(res, best, isNew);
    state = 'results';
    setOverlay('results');
  }

  $('ride').addEventListener('click', startRun);
  $('pause').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'resume') pause(false);
    if (act === 'restart') startRun();
    if (act === 'help') $('pause-help').classList.toggle('hidden');
  });
  $('results').addEventListener('click', (e) => {
    if (e.target.closest('[data-act]')?.dataset.act === 'again') startRun();
  });

  // ------------------------------------------------------------ loop
  const pivot = new THREE.Vector3();
  const renderPos = new THREE.Vector3();
  const renderQ = new THREE.Quaternion();
  const n = { x: 0, y: 1, z: 0 };
  const leanQ = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    input.pollFrame();

    if (state === 'title' || state === 'results') {
      if (input.wasPressed('confirm')) startRun();
    } else if (state === 'paused') {
      if (input.wasPressed('pause')) pause(false);
    } else if (state === 'riding') {
      if (input.wasPressed('pause')) pause(true);
    }

    if (state === 'riding') {
      // Hold R for 2 s to restart from the top.
      if (input.restartHeld()) {
        restartHold += dt;
        if (restartHold >= 2) {
          restartHold = 0;
          startRun();
        }
      } else restartHold = 0;
      hud.setRestart(Math.min(1, restartHold / 2));

      acc += dt;
      let steps = 0;
      const inp = run.finished ? EMPTY_INPUT : input.sample();
      while (acc >= DT && steps < 12) {
        prevPos.copy(run.rider.pos);
        prevQ.copy(run.rider.q);
        run.step(inp);
        acc -= DT;
        steps++;
        const r = run.rider;
        if (r.mode !== prevMode) {
          if (r.mode === 'air') spray.burst(r.pos, r.vel, 40, 3);
          if (prevMode === 'air') {
            spray.burst(r.pos, r.vel, r.mode === 'crash' ? 120 : 80, r.mode === 'crash' ? 6 : 4);
            absorb = 0.35;
          }
          prevMode = r.mode;
        }
      }
      if (steps >= 12) acc = 0;

      for (const m of run.messages) {
        if (m.type === 'finish') resultsDelay = 1.6;
        else hud.message(m);
      }
      run.messages.length = 0;
      if (resultsDelay > 0) {
        resultsDelay -= dt;
        if (resultsDelay <= 0) finish();
      }
      hud.update(run, dt);
    }

    // ------------------------------------------------ draw
    const r = run.rider;
    const alpha = state === 'riding' ? acc / DT : 1;
    renderPos.lerpVectors(prevPos, r.pos, alpha);
    renderQ.slerpQuaternions(prevQ, r.q, alpha);

    if (r.mode === 'crash') {
      terrain.normal(renderPos.x, renderPos.z, n);
      pivot.set(renderPos.x + n.x * 0.25, renderPos.y + n.y * 0.25, renderPos.z + n.z * 0.25);
    } else if (r.mode === 'ground') {
      terrain.normal(renderPos.x, renderPos.z, n);
      pivot.set(renderPos.x + n.x * COM_HEIGHT, renderPos.y + n.y * COM_HEIGHT, renderPos.z + n.z * COM_HEIGHT);
    } else {
      pivot.set(renderPos.x, renderPos.y + COM_HEIGHT, renderPos.z);
    }
    model.root.position.copy(pivot);
    model.root.quaternion.copy(renderQ);
    if (r.mode === 'ground') {
      leanQ.setFromAxisAngle(zAxis, -model.pose.lean * 0.45);
      model.root.quaternion.multiply(leanQ);
    }

    absorb = Math.max(0, absorb - dt);
    const a = r.air;
    model.update(
      {
        crouch: r.mode === 'ground' ? Math.max(r.load, absorb > 0 ? 0.9 : 0) : r.mode === 'air' ? 0.25 : 0.6,
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

    spray.update(dt);
    chase.update(r, pivot, dt);
    follow(pivot);
    renderer.render(scene, camera);
    input.endFrame();
  }

  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });

  // Expose a tiny debug handle for automated checks in the console.
  window.__cranski = { run, camera, pivot, get state() { return state; }, startRun };
}

boot();
