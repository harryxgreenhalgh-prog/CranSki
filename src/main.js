import * as THREE from 'three';
import { DT } from './sim/constants.js';
import { Terrain } from './sim/terrain.js';
import { Run } from './sim/run.js';
import { EMPTY_INPUT } from './sim/rider.js';
import { Input } from './input.js';
import { buildWorld } from './render/world.js';
import { buildBasecamp } from './render/basecampScene.js';
import { RiderModel, COM_HEIGHT } from './render/riderModel.js';
import { ChaseCam } from './render/camera.js';
import { Spray } from './render/spray.js';
import { Hud, showResults, CONTROLS_HTML } from './ui/hud.js';
import { Basecamp } from './ui/basecamp.js';
import { ParkMap } from './ui/map.js';
import { PAGES, pageHtml } from './ui/pages.js';
import { parkMeta } from './parks/index.js';
import { profile, load } from './store.js';
import { settings, saveSettings, looksLowEnd } from './settings.js';
import { SettingsUI, StatsOverlay } from './ui/settings.js';
import { TouchControls, TouchEditor, isTouchDevice } from './ui/touch.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

function hasWebGL2() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

function boot() {
  $('pause-help').innerHTML = CONTROLS_HTML;
  if (!hasWebGL2()) {
    $('nogl').classList.remove('hidden');
    return;
  }

  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // First visit on a phone or weaker machine: start in Performance, with an Undo.
  if (load('settings', null) === null && looksLowEnd()) {
    settings.graphics = 'performance';
    saveSettings();
    $('toast-text').textContent = 'Graphics set to Performance for this device.';
    $('toast').classList.remove('hidden');
    $('toast-btn').onclick = () => {
      settings.graphics = 'high';
      saveSettings();
      applyQuality();
      $('toast').classList.add('hidden');
    };
    setTimeout(() => $('toast').classList.add('hidden'), 9000);
  }

  let dynRes = 1; // Performance mode scales the resolution to hold the frame rate
  function applyQuality() {
    const q = settings.graphics;
    renderer.shadowMap.enabled = q !== 'performance';
    const dpr = window.devicePixelRatio || 1;
    const base = q === 'ultra' ? Math.min(dpr, 2) : q === 'high' ? Math.min(dpr, 1.5) : Math.min(dpr, 1);
    renderer.setPixelRatio(base * (q === 'performance' ? dynRes : 1));
  }
  applyQuality();

  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 6000);
  const model = new RiderModel();
  const input = new Input(window);
  const basecampScene = buildBasecamp();

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
  let parkId = profile.park;
  let loaded = null; // { id, meta, terrain, run, world, chase, spray, hud, time }
  let loading = null;

  async function loadPark(id) {
    if (loaded && loaded.id === id) return loaded;
    if (loading && loading.id === id) return loading.promise;
    const meta = parkMeta(id);
    const promise = (async () => {
      const mod = await meta.load(); // each park is its own chunk, fetched when picked
      const terrain = new Terrain(mod.park);
      const world = buildWorld(terrain, { quality: settings.graphics, renderer });
      if (loaded) loaded.world.dispose();
      const run = new Run(terrain);
      const chase = new ChaseCam(camera, terrain);
      const spray = new Spray(world.scene);
      const hud = new Hud(terrain);
      renderer.compile(world.scene, camera); // warm shaders so the first run never hitches
      loaded = { id, meta, terrain, run, world, chase, spray, hud, time: 0, quality: settings.graphics };
      return loaded;
    })();
    loading = { id, promise };
    try {
      return await promise;
    } finally {
      loading = null;
    }
  }

  // Graphics level changed: rebuild the park scene around the current run.
  function rebuildWorld() {
    if (!loaded || loaded.quality === settings.graphics) return;
    const L = loaded;
    const holder = model.root.parent === L.world.scene;
    L.world.dispose();
    L.world = buildWorld(L.terrain, { quality: settings.graphics, renderer });
    L.spray = new Spray(L.world.scene);
    L.quality = settings.graphics;
    if (holder) L.world.scene.add(model.root);
  }

  // ------------------------------------------------------------ state
  // basecamp | map | loading | lift | riding | paused | finish | results
  let state = 'basecamp';
  let acc = 0;
  let last = performance.now();
  let restartHold = 0;
  let absorb = 0;
  let prevMode = 'ground';
  let lift = null;
  let finish = null;
  let modalReturn = null;
  let mapReturn = 'basecamp';
  let time = 0;
  const prevPos = new THREE.Vector3();
  const prevQ = new THREE.Quaternion();

  const OVERLAYS = ['pause', 'results', 'map', 'modal', 'settings'];
  function showOverlay(id) {
    for (const o of OVERLAYS) $(o).classList.toggle('hidden', o !== id);
  }
  function blurMenus() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }
  function placeModel(scene) {
    if (model.root.parent !== scene) scene.add(model.root);
  }

  // ------------------------------------------------------------ screens
  const basecamp = new Basecamp({
    onRide: () => openMap('basecamp'),
    onTab: (tab) => {
      if (tab === 'ride') openMap('basecamp');
      else if (tab === 'updates') openPage('updates');
      else if (tab === 'locker' || tab === 'replays') openSoon(tab === 'locker' ? 'Locker' : 'Replays');
      else openPage('online');
    },
    onPage: (p) => openPage(p),
    onGear: () => openSettings(),
    onMusic: () => openSoon('Music player'),
  });

  const parkMap = new ParkMap({
    onRide: (id) => {
      parkId = id;
      profile.park = id;
      parkMap.close();
      goRide();
    },
    onBack: () => closeMap(),
  });

  function toBasecamp() {
    blurMenus();
    state = 'basecamp';
    showOverlay(null);
    $('finishcard').classList.add('hidden');
    $('liftbar').classList.add('hidden');
    if (loaded) loaded.hud.show(false);
    placeModel(basecampScene.scene);
    model.root.position.set(0, COM_HEIGHT, 0);
    model.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI - 0.35);
    model.root.visible = true;
    basecamp.show();
  }

  function openMap(from) {
    blurMenus();
    mapReturn = from;
    state = 'map';
    showOverlay('map');
    $('finishcard').classList.add('hidden');
    parkMap.open(parkId, loaded ? loaded.id : null);
  }

  function closeMap() {
    parkMap.close();
    if (mapReturn === 'results') {
      state = 'results';
      showOverlay('results');
    } else if (mapReturn === 'paused') {
      state = 'paused';
      showOverlay('pause');
    } else toBasecamp();
  }

  function openPage(id) {
    openModal(PAGES[id].title, pageHtml(id));
    if (id === 'privacy') {
      $('wipe-data')?.addEventListener('click', () => {
        try {
          for (const k of Object.keys(localStorage)) if (k.startsWith('cranski.')) localStorage.removeItem(k);
          indexedDB.deleteDatabase('cranski');
        } catch {
          /* nothing stored */
        }
        $('wipe-data').textContent = 'Deleted';
        basecamp.refresh();
      });
    }
  }

  let settingsReturn = null;
  const settingsUI = new SettingsUI({
    onClose: () => {
      const r = settingsReturn || { state: 'basecamp', overlay: null };
      settingsReturn = null;
      applyQuality();
      rebuildWorld();
      showOverlay(r.overlay);
      state = r.state;
    },
    onTouchEditor: () => {
      $('settings').classList.add('hidden');
      touchEditor.open();
    },
  });
  const touch = new TouchControls({ onPause: () => back() });
  const touchEditor = new TouchEditor({
    onDone: () => {
      touch.build();
      $('settings').classList.remove('hidden');
      settingsUI.render();
    },
  });
  // Tap the lift bar to skip; tap the finish card for results.
  $('liftbar').addEventListener('click', () => {
    if (state === 'lift') lift.t = lift.duration;
  });
  $('finishcard').addEventListener('click', () => {
    if (state === 'finish') showResultsScreen();
  });
  function openSettings(tab) {
    settingsReturn = { state, overlay: OVERLAYS.find((o) => o !== 'settings' && !$(o).classList.contains('hidden')) || null };
    showOverlay('settings');
    settingsUI.open(tab);
  }
  const stats = new StatsOverlay(renderer);

  function openSoon(what) {
    openModal(what, `<p>${what} arrives in a later Phase 2 step.</p>`);
  }

  function openModal(title, html) {
    modalReturn = { state, overlay: OVERLAYS.find((o) => o !== 'modal' && !$(o).classList.contains('hidden')) || null };
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = html;
    showOverlay('modal');
  }

  function closeModal() {
    const r = modalReturn || { state: 'basecamp', overlay: null };
    modalReturn = null;
    showOverlay(r.overlay);
    state = r.state;
  }
  $('modal-close').addEventListener('click', closeModal);

  async function goRide() {
    blurMenus();
    basecamp.hide();
    showOverlay(null);
    state = 'loading';
    $('liftbar').classList.remove('hidden');
    $('lift-name').textContent = 'LOADING';
    try {
      await loadPark(parkId);
    } catch (e) {
      console.error(e);
      $('lift-name').textContent = 'COULD NOT LOAD PARK';
      setTimeout(toBasecamp, 1500);
      return;
    }
    startLift();
  }

  function startLift() {
    const L = loaded;
    placeModel(L.world.scene);
    L.run.reset();
    L.hud.clearTrick();
    L.hud.show(false);
    showOverlay(null);
    $('finishcard').classList.add('hidden');
    lift = { t: 0, duration: L.world.lift.ride.duration };
    state = 'lift';
    const names = { gondola: 'GONDOLA', ropeway: 'ROPEWAY', tbar: 'T-BAR' };
    $('lift-name').textContent = names[L.world.lift.ride.type];
    $('liftbar').classList.remove('hidden');
  }

  function startRun() {
    blurMenus();
    const L = loaded;
    placeModel(L.world.scene);
    L.run.reset();
    prevPos.copy(L.run.rider.pos);
    prevQ.copy(L.run.rider.q);
    prevMode = L.run.rider.mode;
    L.chase.snap();
    L.hud.clearTrick();
    $('liftbar').classList.add('hidden');
    $('finishcard').classList.add('hidden');
    state = 'riding';
    showOverlay(null);
    L.hud.show(true);
    acc = 0;
    restartHold = 0;
    finish = null;
    L.hud.hint(`${L.meta.name} · W tuck · Space pop`, 3);
  }

  function pause(on) {
    if (on && state === 'riding') {
      state = 'paused';
      showOverlay('pause');
    } else if (!on && state === 'paused') {
      state = 'riding';
      showOverlay(null);
      $('pause-help').classList.add('hidden');
      last = performance.now();
    }
  }

  function startFinish() {
    const L = loaded;
    const res = L.run.results();
    finish = { t: 0, res, face: 0, dir: null };
    state = 'finish';
    L.hud.show(false);
    $('fc-park').textContent = L.meta.name;
    $('fc-total').textContent = fmt(res.total);
    $('fc-best').textContent = res.bestTrick ? `Best: ${res.bestTrick.name}` : 'Clean run';
    $('fc-speed').textContent = `Top speed ${res.topSpeedKmh} km/h · ${res.airtime.toFixed(1)} s air`;
  }

  function showResultsScreen() {
    const L = loaded;
    const res = finish.res;
    res.parkName = L.meta.name;
    const best = profile.best(L.id);
    const isNew = res.total > best;
    if (isNew) profile.setBest(L.id, res.total);
    const frost = profile.awardFrost(res.total);
    profile.addRun({ park: L.id, total: res.total, date: Date.now(), best: res.bestTrick?.name || null });
    showResults(res, Math.max(best, res.total), isNew);
    $('res-frost').textContent = frost > 0 ? `+${frost} FROST earned` : 'Daily FROST cap reached (100 a day)';
    $('finishcard').classList.add('hidden');
    state = 'results';
    showOverlay('results');
  }

  $('pause').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'resume') pause(false);
    if (act === 'reset') {
      loaded.run.resetPosition();
      prevPos.copy(loaded.run.rider.pos);
      prevQ.copy(loaded.run.rider.q);
      loaded.chase.snap();
      pause(false);
    }
    if (act === 'restart') startRun();
    if (act === 'map') openMap('paused');
    if (act === 'settings') openSettings();
    if (act === 'help') $('pause-help').classList.toggle('hidden');
    if (act === 'basecamp') toBasecamp();
  });
  $('results').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'again') startLift();
    if (act === 'map') openMap('results');
  });

  // Esc steps back one menu level.
  function back() {
    if (touchEditor.isOpen) touchEditor.close();
    else if (settingsUI.isOpen) settingsUI.close();
    else if (!$('modal').classList.contains('hidden')) closeModal();
    else if (state === 'map') closeMap();
    else if (state === 'paused') {
      if (!$('pause-help').classList.contains('hidden')) $('pause-help').classList.add('hidden');
      else pause(false);
    } else if (state === 'riding') pause(true);
    else if (state === 'results') toBasecamp();
    else if (state === 'finish') showResultsScreen();
    else if (state === 'lift') toBasecamp();
  }

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (state === 'map' && $('modal').classList.contains('hidden')) parkMap.key(e.code);
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
  const tmp2 = new THREE.Vector3();
  const faceQ = new THREE.Quaternion();
  const coastInput = { ...EMPTY_INPUT, brake: true, grab: [false, false, false] };
  const IDLE = { crouch: 0.05, tuck: 0, legsUp: 0, lean: 0, look: 0, armsOut: 0, grab: null, grabSide: 1 };

  let lastDraw = 0;
  let slowFrames = 0;
  let fastFrames = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    // 30 fps cap: skip this display frame if it's too soon.
    if (settings.frameCap === 30 && now - lastDraw < 1000 / 30 - 2) return;
    lastDraw = now;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    time += dt;
    input.pollFrame();
    stats.update(dt);
    const wantTouch = state === 'riding' && isTouchDevice() && !touchEditor.isOpen;
    if (wantTouch !== touch.enabled) {
      touch.show(wantTouch);
      document.body.classList.toggle('touching', wantTouch);
    }
    if (settingsUI.isOpen) settingsUI.tick(input.pad());

    // Performance mode: dynamic resolution to hold the frame rate.
    if (settings.graphics === 'performance') {
      const target = settings.frameCap === 30 ? 1 / 28 : 1 / 50;
      if (dt > target * 1.15) slowFrames++;
      else if (dt < target * 0.8) fastFrames++;
      if (slowFrames > 20 && dynRes > 0.6) {
        dynRes = Math.max(0.6, dynRes - 0.1);
        applyQuality();
        slowFrames = fastFrames = 0;
      } else if (fastFrames > 120 && dynRes < 1) {
        dynRes = Math.min(1, dynRes + 0.1);
        applyQuality();
        slowFrames = fastFrames = 0;
      }
    }

    if (input.wasPressed('pause') && !settingsUI.capturing) back();
    else if (input.wasPressed('confirm') && $('modal').classList.contains('hidden') && !settingsUI.isOpen) {
      if (state === 'basecamp') openMap('basecamp');
      else if (state === 'map') parkMap.onRide(parkMap.currentId);
      else if (state === 'results') startLift();
      else if (state === 'finish' && finish.t > 0.8) showResultsScreen();
      else if (state === 'lift') lift.t = lift.duration;
    } else if (state === 'lift' && input.wasPressed('skipLift')) lift.t = lift.duration;

    // -------------------------------------------- Basecamp and map: the lobby scene
    const inLobby = state === 'basecamp' || state === 'map' || (state === 'loading' && !loaded);
    if (inLobby) {
      placeModel(basecampScene.scene);
      model.root.visible = true;
      model.update({ ...IDLE, crouch: 0.05 + 0.05 * Math.sin(time * 1.6) }, dt);
      basecampScene.frameCamera(camera, camera.aspect);
      basecampScene.update(time, camera);
      if (camera.fov !== 50) {
        camera.fov = 50;
        camera.updateProjectionMatrix();
      }
      renderer.render(basecampScene.scene, camera);
      input.endFrame();
      return;
    }

    const L = loaded;
    if (!L) {
      input.endFrame();
      return;
    }
    L.time += dt;
    const run = L.run;
    const r = run.rider;

    // -------------------------------------------- lift ride
    if (state === 'lift' || state === 'loading') {
      if (state === 'lift') {
        lift.t += dt;
        if (lift.t >= lift.duration) {
          startRun();
          input.endFrame();
          return;
        }
      }
      placeModel(L.world.scene);
      const ride = L.world.lift.ride;
      const t = state === 'lift' ? Math.min(1, lift.t / lift.duration) : 0;
      ride.sample(t, liftPos, liftDir);
      if (ride.type === 'tbar') {
        model.root.visible = true;
        model.root.position.set(liftPos.x, liftPos.y + COM_HEIGHT, liftPos.z);
        tmp.set(liftDir.x, 0, liftDir.z).normalize();
        model.root.quaternion.setFromUnitVectors(tmp2.set(0, 0, -1), tmp);
        model.update({ ...IDLE, crouch: 0.2 }, dt);
        camera.position.copy(liftPos).addScaledVector(tmp, -7).add(tmp2.set(0, 3, 0));
        camera.lookAt(liftPos.x + liftDir.x * 20, liftPos.y + liftDir.y * 20 + 1, liftPos.z + liftDir.z * 20);
      } else {
        model.root.visible = false;
        camera.position.copy(liftPos).addScaledVector(liftDir, -9).add(tmp.set(4, 3.5, 0));
        camera.lookAt(liftPos.x + liftDir.x * 30, liftPos.y + liftDir.y * 30, liftPos.z + liftDir.z * 30);
      }
      if (camera.fov !== 65) {
        camera.fov = 65;
        camera.updateProjectionMatrix();
      }
      L.world.update(L.time, liftPos, camera);
      renderer.render(L.world.scene, camera);
      input.endFrame();
      return;
    }

    // -------------------------------------------- simulation
    if (state === 'riding' || state === 'finish') {
      if (state === 'riding') {
        if (input.restartHeld()) {
          restartHold += dt;
          if (restartHold >= 2) {
            restartHold = 0;
            startRun();
          }
        } else restartHold = 0;
        L.hud.setRestart(Math.min(1, restartHold / 2));
      }

      acc += dt;
      let steps = 0;
      const inp = state === 'riding' ? touch.apply(input.sample()) : null;
      while (acc >= DT && steps < 12) {
        prevPos.copy(r.pos);
        prevQ.copy(r.q);
        if (state === 'riding') run.step(inp);
        else run.coast(r.speed > 0.5 && r.mode === 'ground' ? coastInput : EMPTY_INPUT);
        acc -= DT;
        steps++;
        if (r.mode !== prevMode) {
          if (r.mode === 'air' || prevMode === 'air') touch.haptic(); // tick on every pop and landing
          if (r.mode === 'air') L.spray.burst(r.pos, r.vel, settings.graphics === 'ultra' ? 70 : 40, 3);
          if (prevMode === 'air') {
            L.spray.burst(r.pos, r.vel, r.mode === 'crash' ? 120 : 80, r.mode === 'crash' ? 6 : 4);
            absorb = 0.35;
          }
          prevMode = r.mode;
        }
        if (state !== 'riding' && state !== 'finish') break;
      }
      if (steps >= 12) acc = 0;

      for (const m of run.messages) {
        if (m.type === 'finish') startFinish();
        else L.hud.message(m);
      }
      run.messages.length = 0;
      if (state === 'riding') L.hud.update(run, dt);
      if (state === 'finish') {
        finish.t += dt;
        if (finish.t > 1.0) $('finishcard').classList.remove('hidden');
        if (finish.t > 6) showResultsScreen();
      }
    }

    // -------------------------------------------- draw the park
    placeModel(L.world.scene);
    model.root.visible = true;
    const alpha = state === 'riding' || state === 'finish' ? acc / DT : 1;
    renderPos.lerpVectors(prevPos, r.pos, alpha);
    renderQ.slerpQuaternions(prevQ, r.q, alpha);

    if (r.mode === 'crash') {
      L.terrain.normal(renderPos.x, renderPos.z, n);
      pivot.set(renderPos.x + n.x * 0.25, renderPos.y + n.y * 0.25, renderPos.z + n.z * 0.25);
    } else if (r.mode === 'ground') {
      L.terrain.normal(renderPos.x, renderPos.z, n);
      const h = COM_HEIGHT - r.sink; // sink into powder
      pivot.set(renderPos.x + n.x * h, renderPos.y + n.y * h, renderPos.z + n.z * h);
      if (r.powder > 0.5 && r.speed > 4 && state === 'riding') L.spray.burst(r.pos, r.vel, 2, 1.5 + r.speed * 0.05);
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

    // Finish: once stopped, turn to face the cameras.
    if (state === 'finish' && r.speed < 1.5) {
      tmp.set(camera.position.x - pivot.x, 0, camera.position.z - pivot.z).normalize();
      faceQ.setFromUnitVectors(tmp2.set(0, 0, -1), tmp);
      finish.face = Math.min(1, finish.face + dt * 1.5);
      model.root.quaternion.slerp(faceQ, finish.face);
    }

    absorb = Math.max(0, absorb - dt);
    const a = r.air;
    model.update(
      {
        crouch: r.mode === 'ground' ? Math.max(r.load, absorb > 0 ? 0.9 : 0) : r.mode === 'air' ? 0.25 : r.mode === 'rail' ? 0.35 : 0.6,
        press: r.mode === 'rail' && r.rail.press ? 1 : 0,
        wide: r.mode === 'rail' ? 1 : 0,
        tuck: r.mode === 'ground' && r.tucking && state === 'riding' ? 1 : 0,
        legsUp: r.mode === 'air' ? 0.35 : 0,
        lean: r.mode === 'ground' ? r.lean : 0,
        look: r.switchStance && r.mode !== 'crash' && state !== 'finish' ? 1 : 0,
        armsOut: r.mode === 'air' && r.omega.length() > 120 ? 1 : r.mode === 'air' ? 0.4 : 0,
        grab: r.activeGrab,
        grabSide: a && a.spin < 0 ? 1 : -1,
      },
      dt
    );

    L.spray.update(dt);
    if (state === 'finish') {
      // Swing round in front of the rider.
      if (!finish.dir) {
        finish.dir = new THREE.Vector3(r.vel.x, 0, r.vel.z);
        if (finish.dir.lengthSq() < 0.01) finish.dir.set(0, 0, -1);
        finish.dir.normalize();
      }
      const d = finish.dir;
      const want = tmp2.copy(pivot).addScaledVector(d, 6 + r.speed * 0.4);
      want.x += d.z * 2.5;
      want.z -= d.x * 2.5;
      const gy = L.terrain.height(want.x, want.z) + 1.4;
      want.y = Math.max(pivot.y + 0.6, gy);
      camera.position.lerp(want, 1 - Math.exp(-dt * 2.2));
      camera.lookAt(pivot.x, pivot.y + 0.2, pivot.z);
    } else if (settings.camera.firstPerson && r.mode !== 'crash') {
      model.root.visible = false;
      L.chase.firstPerson(pivot, model.root.quaternion, dt, r.speed);
    } else {
      L.chase.update(r, pivot, dt);
    }
    L.world.update(L.time, pivot, camera, state === 'riding' ? r : null);
    renderer.render(L.world.scene, camera);
    input.endFrame();
  }

  toBasecamp();
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
    openMap,
    selectPark(id) {
      parkId = id;
    },
  };
}

boot();
