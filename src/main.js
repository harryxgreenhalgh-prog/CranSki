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
import { settings, saveSettings, looksLowEnd, onSettings } from './settings.js';
import { SettingsUI, StatsOverlay } from './ui/settings.js';
import { TouchControls, TouchEditor, isTouchDevice } from './ui/touch.js';
import { Recorder, SIM_VERSION } from './replay/record.js';
import { replayDB } from './replay/db.js';
import { Ghost } from './replay/player.js';
import { ReplayView } from './ui/replayUI.js';
import { Locker } from './ui/locker.js';
import { DEFAULT_LOOK } from './render/riderModel.js';
import { startAudio } from './audio/engine.js';
import { Sfx } from './audio/sfx.js';
import { Music } from './audio/music.js';
import { LoadingScreen } from './ui/loading.js';
import { loadAssets, ASSETS, preloadScenes, sceneCopy, modelBounds } from './render/assets.js';
import { placeRider, poseFor } from './render/pose.js';
import { account, resumeAccount, displayName, signOut } from './online/account.js';
import { mountAccount, addAccountSection, esc } from './ui/accountUI.js';
import { cloud, cloudStatusText } from './online/cloud.js';
import { friends, onFriends, setLocation } from './online/friends.js';
import { mountFriends } from './ui/friendsUI.js';
import { canPost, submitRun, submitPacked } from './online/leaderboard.js';
import { mountBoard } from './ui/boardUI.js';
import { LiveRoom } from './online/rooms.js';
import { LOCAL } from './online/net.js';
import { REALTIME_BUDGET } from './online/config.js';
import { RemoteRiders } from './render/remoteRiders.js';
import { Roster } from './ui/roster.js';
import { IdleWatch } from './ui/idle.js';
import { ChatChannel, mutedRiders, setMuted, REPORT_REASONS } from './online/chat.js';
import { ChatUI } from './ui/chatUI.js';
import { party } from './online/party.js';
import { ranked, ServerMatch, RANKED_PARK } from './online/ranked.js';
import { mountRanked } from './ui/rankedUI.js';
import { DuelSession, DUEL_PARKS, CHALLENGE_TIMEOUT, validPose } from './online/duel.js';
import { Snapshots } from './online/rooms.js';
import { Reel } from './render/reel.js';
import { packRuns } from './replay/record.js';
import { frameRider, STRIDE } from './render/pose.js';

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
    $('loading').classList.add('hidden');
    return;
  }

  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Filmic tone mapping: bright snow keeps its detail instead of clipping to white.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

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
  const look = () => ({ ...DEFAULT_LOOK, ...profile.look });
  const model = new RiderModel(look());
  const ghostModel = new RiderModel(look());
  ghostModel.makeGhost();
  const recorder = new Recorder();
  let ghost = null;
  let lastReplay = null;
  const input = new Input(window);
  const music = new Music();
  const sfx = new Sfx();
  const loadingScreen = new LoadingScreen();
  loadingScreen.show(music.track.name);
  loadingScreen.set(0.1, 'Building Basecamp…');
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

  async function loadPark(id, progress = () => {}) {
    if (loaded && loaded.id === id) return loaded;
    if (loading && loading.id === id) return loading.promise;
    const meta = parkMeta(id);
    const promise = (async () => {
      const mod = await meta.load(); // each park is its own chunk, fetched when picked
      progress(0.35, 'Loading scenery…');
      await preloadScenes(['mountain', 'finish', 'hut']).catch((e) => console.error('scenery models', e));
      progress(0.45, `Shaping ${meta.name}…`);
      await new Promise((r) => setTimeout(r, 0));
      const terrain = new Terrain(mod.park);
      progress(0.6, 'Planting the forest…');
      await new Promise((r) => setTimeout(r, 0));
      const world = buildWorld(terrain, { quality: settings.graphics, renderer });
      if (loaded) loaded.world.dispose();
      const run = new Run(terrain);
      const chase = new ChaseCam(camera, terrain);
      const spray = new Spray(world.scene);
      const hud = new Hud(terrain);
      progress(0.85, 'Warming up shaders…');
      await new Promise((r) => setTimeout(r, 0));
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
      else if (tab === 'replays') openReplays();
      else if (tab === 'locker') openLocker();
      else if (tab === 'leaderboard') openBoard();
      else openPage('online');
    },
    onPage: (p) => openPage(p),
    onAccount: () => openAccount(),
    onFriends: () => openFriends(),
    onMode: (m) => setPlayMode(m),
    onGear: () => openSettings(),
    onMusic: () => {
      $('musicpop').classList.toggle('hidden');
      $('music-btn').classList.toggle('on', !$('musicpop').classList.contains('hidden'));
    },
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
    endLift();
    state = 'basecamp';
    showOverlay(null);
    $('finishcard').classList.add('hidden');
    $('liftbar').classList.add('hidden');
    $('ghosttag').classList.add('hidden');
    if (loaded) loaded.hud.show(false);
    if (duel) leaveDuel();
    if (live) live.leaveRoom();
    remotes.clear();
    roster.hide();
    placeModel(basecampScene.scene);
    model.root.position.set(0, COM_HEIGHT, 0);
    model.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI - 0.35);
    model.root.visible = true;
    basecamp.show();
    maybeWelcome();
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
        // The sign-in session lived in that storage too: sign out properly.
        if (account.signedIn) signOut().catch(() => {});
        basecamp.refresh();
      });
      $('privacy-account')?.addEventListener('click', () => openAccount());
    }
  }

  // ------------------------------------------------------------ account (Phase 3)
  function openAccount() {
    openModal('Account', '<div class="acct" id="acct"></div>');
    mountAccount($('acct'), { onPrivacy: () => openPage('privacy') });
  }
  function toast(text, ms = 6000) {
    $('toast-text').textContent = text;
    $('toast-btn').classList.add('hidden');
    $('toast').classList.remove('hidden');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => {
      $('toast').classList.add('hidden');
      $('toast-btn').classList.remove('hidden');
    }, ms);
  }
  // Back from a sign-in link: welcome, or ask for a gamertag first.
  function maybeWelcome() {
    if (state !== 'basecamp' || !$('modal').classList.contains('hidden')) return;
    if (account.notice) openAccount();
    else if (account.justSignedIn) {
      account.justSignedIn = false;
      if (account.ready) toast(`Signed in as ${account.gamertag}`);
      else openAccount();
    } else if (account.signedIn && !account.profile && !maybeWelcome.asked) {
      maybeWelcome.asked = true;
      openAccount();
    }
  }
  account.onChange(() => {
    basecamp.refreshAccount();
    maybeWelcome();
  });
  // Friends (Phase 3 step 3).
  function openFriends() {
    openModal('Friends', '<div class="acct friends" id="friends-panel"></div>');
    mountFriends($('friends-panel'), { onAccount: () => openAccount(), onPartyGo: () => partyGo() });
  }
  onFriends(() => basecamp.refreshFriends(friends));
  basecamp.partyInvites = () => party.invites.length;
  // Tell friends where you are: Basecamp, a lift, a run or a replay.
  function reportLocation() {
    const park = loaded ? loaded.id : parkId;
    if (state === 'lift') setLocation('lift', parkId);
    else if (state === 'riding' || state === 'paused' || state === 'finish' || state === 'results') setLocation('riding', park);
    else if (state === 'replay') setLocation('replay', park);
    else if (state !== 'loading' && state !== 'boot') setLocation('basecamp');
    const where = { lift: 'lift', riding: 'riding', paused: 'paused', finish: 'results', results: 'results', replay: 'replay', duel: 'duel', duelover: 'duel', reel: 'duel' }[state] || 'basecamp';
    if (state !== 'loading' && state !== 'boot') party.setWhere(where, where === 'basecamp' ? null : park);
  }

  // ------------------------------------------------------------ live rooms (Phase 4)
  let playMode = 'solo'; // solo | live
  let live = null; // LiveRoom while in live mode
  const remotes = new RemoteRiders();
  const roster = new Roster({ onAction: (act, uid) => onRosterAction(act, uid) });
  const rosterActions = {}; // filled in by chat (mute/report) and duels (1V1)
  function onRosterAction(act, uid) {
    rosterActions[act]?.(uid);
    roster.render();
  }
  // Who you are online. With ?localnet (testing in several tabs) a made-up rider.
  function identity() {
    if (account.ready) return { uid: account.user.id, tag: account.gamertag };
    if (LOCAL) {
      let id = sessionStorage.getItem('cranski.localid');
      if (!id) sessionStorage.setItem('cranski.localid', (id = 'local-' + Math.random().toString(36).slice(2, 8)));
      return { uid: id, tag: `${profile.name} ${id.slice(6, 9).toUpperCase()}` };
    }
    return null;
  }
  const MODE_NOTE = {
    solo: 'Ride alone, race your ghost, never timed out.',
    live: 'Ride with up to 30 riders. Hold Tab for the roster.',
  };
  async function setPlayMode(m) {
    if (m === 'ranked') {
      openRanked();
      return;
    }
    if (m === playMode) return;
    if (m === 'live') {
      const me = identity();
      if (!me) {
        openAccount();
        toast(account.signedIn ? 'Pick a gamertag to ride in live rooms.' : 'Sign in to ride in live rooms.');
        return;
      }
      playMode = 'live';
      basecamp.setMode('live', MODE_NOTE.live);
      const lk = look();
      live = new LiveRoom({
        me: { ...me, look: lk, board: lk.ride === 'board' },
        budget: REALTIME_BUDGET,
        onChange: () => onRoomChange(),
        onTrick: (r) => remotes.showTrick(r),
        onEvent: (e, m2) => roomEvents[e]?.(m2),
      });
      live.openLobby().catch((err) => {
        console.warn(err);
        toast("Couldn't reach the live rooms. Back to solo.");
        setPlayMode('solo');
      });
    } else {
      playMode = 'solo';
      basecamp.setMode('solo', MODE_NOTE.solo);
      const l = live;
      live = null;
      remotes.clear();
      roster.hide();
      updateRoomBadge();
      if (l) await l.close();
    }
  }
  const roomEvents = {}; // room broadcast events by name, for later features

  // Chat (Phase 4 step 3): filtered and signed by the chat Edge Function.
  const chatUI = new ChatUI({
    onSend: (t) => chatFor(chatUI.target)?.send(t),
    onPhrase: (i) => chatFor(chatUI.target)?.sendPhrase(i),
  });
  let chat = null; // room chat
  let partyChat = null;
  const chatFor = (target) => (target === 'party' ? partyChat : chat) || chat || partyChat;
  function chatTopicFor() {
    if (!live || !live.room) return null;
    return live.privateKey ? null : `chat:${live.park}:${live.number}`;
  }
  // Room chat while in a public room; party chat while in a party.
  // One sync at a time, so overlapping calls never open a channel twice.
  let chatSync = Promise.resolve();
  function syncChat() {
    chatSync = chatSync.then(syncChatNow, syncChatNow);
    return chatSync;
  }
  async function syncChatNow() {
    const me = identity();
    const roomTopic = chatTopicFor();
    const partyTopic = party.info && account.ready ? `pchat:${party.info.id}` : null;
    if (me && LOCAL) sessionStorage.setItem('cranski.localme', JSON.stringify(me));
    const want = async (cur, topic, from) => {
      if (!topic || !me) {
        if (cur) await cur.detach();
        return null;
      }
      const c = cur || new ChatChannel({ me, onMessage: (m) => chatUI.message(m, m.u === me.uid, from), onSystem: (t) => chatUI.system(t) });
      if (c.topic !== topic) {
        try {
          await c.attach(topic);
        } catch (e) {
          console.warn('chat', e);
          chatUI.system("Chat isn't available right now.");
        }
      }
      return c;
    };
    chat = await want(chat, roomTopic, 'room');
    partyChat = await want(partyChat, partyTopic, 'party');
    const targets = [chat && 'room', partyChat && 'party'].filter(Boolean);
    chatUI.setTargets(targets);
    if (!targets.length) chatUI.clear();
    chatUI.setEnabled(targets.length > 0);
  }
  onSettings(() => chatUI.setEnabled(!!(chat?.topic || partyChat?.topic)));
  // T opens chat (Enter too while riding).
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || chatUI.isOpen || !chatUI.enabled) return;
    if (!['riding', 'lift', 'results', 'finish', 'basecamp', 'duel', 'duelover'].includes(state) || !$('modal').classList.contains('hidden')) return;
    if (e.code === 'KeyT' || (e.code === 'Enter' && state === 'riding')) {
      e.preventDefault();
      chatUI.open();
    }
  });
  // Mute and report from the roster.
  roster.actions.push((r) => {
    const muted = mutedRiders().has(r.uid);
    return `<button class="btn sm" data-ract="${muted ? 'unmute' : 'mute'}" data-uid="${r.uid}">${muted ? 'Unmute' : 'Mute'}</button> <button class="btn sm" data-ract="report" data-uid="${r.uid}">Report</button>`;
  });
  rosterActions.mute = (uid) => setMuted(uid, true);
  rosterActions.unmute = (uid) => setMuted(uid, false);
  rosterActions.report = (uid) => openReport(uid);
  function openReport(uid) {
    const r = live?.remotes.get(uid);
    const tag = r ? r.tag : 'this rider';
    roster.hide();
    openModal(
      'Report a rider',
      `<p>Report <b>${esc(tag)}</b>. Your report includes the last 10 minutes of this room's chat, checked by the server, so a moderator can see what happened. It's kept until a moderator has reviewed it.</p>
      <form id="report-form" class="report-form">
        ${REPORT_REASONS.map(([id, label], i) => `<label class="choice"><input type="radio" name="reason" value="${id}" ${i === 0 ? 'checked' : ''}/><b>${label}</b></label>`).join('')}
        <textarea name="note" maxlength="300" rows="2" placeholder="Anything else? (optional)"></textarea>
        <p class="acct-row"><button class="btn primary" type="submit">Send report</button><label class="fcheck"><input type="checkbox" name="mute" checked /> Also mute them</label></p>
        <p class="acct-msg" id="report-msg"></p>
      </form>`
    );
    const form = $('report-form');
    form.note.addEventListener('keydown', (e) => e.stopPropagation());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      if (form.mute.checked) setMuted(uid, true);
      const res = chat ? await chat.report(uid, form.reason.value, form.note.value) : { error: 'not_in_room' };
      $('report-msg').className = `acct-msg ${res?.ok ? 'good' : 'bad'}`;
      $('report-msg').textContent = res?.ok ? 'Thanks. Your report was sent to the moderators.' : res?.error === 'slow_down' ? "You've sent a lot of reports. Try again later." : "Couldn't send the report. Try again later.";
      if (!res?.ok) btn.disabled = false;
    });
  }

  // ------------------------------------------------------------ duels (Phase 4 step 4)
  let duel = null; // DuelSession
  let duelRun = false; // riding one of my duel runs
  let duelOpp = null; // { model, snaps, score, camPos }
  let countdown = null; // { until, mine }
  let pendingChallenge = null; // challenge I sent
  let incoming = null; // challenge I received
  let reel = null;
  let verifyMod = null;
  let oppGone = false;
  const duelFrameBuf = new Float32Array(STRIDE);
  const duelView = {};
  const cards = {}; // kind -> { big, small, buttons, count }
  const CARD_ORDER = ['conn', 'opp', 'challenge', 'partygo', 'rankask', 'leave', 'still', 'count'];
  function setCard(kind, card) {
    if (card) cards[kind] = card;
    else delete cards[kind];
    const top = CARD_ORDER.find((k) => cards[k]);
    const el = $('duelcard');
    if (!top) {
      el.classList.add('hidden');
      el.dataset.kind = '';
      return;
    }
    const c = cards[top];
    el.classList.toggle('count', top === 'count');
    el.classList.remove('hidden');
    $('dc-big').textContent = c.big || '';
    $('dc-small').textContent = c.small || '';
    if (el.dataset.kind !== top || c.rebuild) {
      el.dataset.kind = top;
      c.rebuild = false;
      $('dc-buttons').innerHTML = (c.buttons || []).map((b, i) => `<button class="btn ${i === 0 ? 'primary' : ''}" data-dc="${i}">${b.label}</button>`).join('');
      $('dc-buttons').querySelectorAll('[data-dc]').forEach((b) => b.addEventListener('click', () => c.buttons[Number(b.dataset.dc)].fn()));
    }
  }
  const PARK_NAME = (id) => parkMeta(id).name;
  const duelParkOk = (id) => DUEL_PARKS.includes(id);

  // Challenge someone in your room (V, or 1V1 in the roster).
  function challenge(uid) {
    if (!live || !live.room || duel) return;
    if (!duelParkOk(live.park)) {
      toast('Duels are on APEX, BIG AIR, FOREST LINE, ASPEN PIPE and BELLEVUE.');
      return;
    }
    const r = live.remotes.get(uid);
    if (!r) return;
    pendingChallenge = { id: crypto.randomUUID(), to: uid, tag: r.tag, until: performance.now() + CHALLENGE_TIMEOUT * 1000 };
    live.sendEvent('challenge', { to: uid, id: pendingChallenge.id, park: live.park, tag: live.me.tag });
    toast(`Challenge sent to ${r.tag}…`, 4000);
  }
  roomEvents.challenge = (m) => {
    const me = identity();
    if (!me || m.to !== me.uid || duel || incoming || m.park !== live?.park) return;
    incoming = { from: m.u, tag: String(m.tag || 'A rider').slice(0, 18), id: m.id, park: m.park, until: performance.now() + CHALLENGE_TIMEOUT * 1000 };
    setCard('challenge', {
      big: `${incoming.tag} challenges you`,
      small: `Friendly 1v1 on ${PARK_NAME(m.park)}: 2 runs each, best run wins.`,
      buttons: [
        { label: 'Accept <kbd>Y</kbd>', fn: () => answerChallenge(true) },
        { label: 'No thanks <kbd>N</kbd>', fn: () => answerChallenge(false) },
      ],
      rebuild: true,
    });
  };
  function answerChallenge(yes) {
    const c = incoming;
    incoming = null;
    setCard('challenge', null);
    if (!c || !live) return;
    live.sendEvent(yes ? 'accept' : 'decline', { to: c.from, id: c.id });
    if (yes) startDuel({ id: c.id, opp: { uid: c.from, tag: c.tag }, host: false, park: c.park });
  }
  roomEvents.accept = (m) => {
    const me = identity();
    if (!me || m.to !== me.uid || !pendingChallenge || pendingChallenge.id !== m.id || duel) return;
    const p = pendingChallenge;
    pendingChallenge = null;
    startDuel({ id: p.id, opp: { uid: p.to, tag: p.tag }, host: true, park: live.park });
  };
  roomEvents.decline = (m) => {
    const me = identity();
    if (!me || m.to !== me.uid || !pendingChallenge || pendingChallenge.id !== m.id) return;
    toast(`${pendingChallenge.tag} said no thanks.`, 4000);
    pendingChallenge = null;
  };
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (incoming && (e.code === 'KeyY' || e.code === 'KeyN')) {
      e.preventDefault();
      answerChallenge(e.code === 'KeyY');
      return;
    }
    // V: challenge the nearest rider (or pick from the roster).
    if (e.code === 'KeyV' && live && live.room && !duel && ['riding', 'lift', 'results', 'finish'].includes(state)) {
      e.preventDefault();
      if (!duelParkOk(live.park)) {
        toast('Duels are on APEX, BIG AIR, FOREST LINE, ASPEN PIPE and BELLEVUE.');
        return;
      }
      let best = null;
      for (const [uid, en] of remotes.entries) if (en.group.visible && en.dist < 60 && (!best || en.dist < best.d)) best = { uid, d: en.dist };
      if (best) challenge(best.uid);
      else roster.show(live, true);
    }
  });
  roster.actions.push((r, room) => (duelParkOk(room.park) && !duel ? `<button class="btn sm primary" data-ract="duel" data-uid="${r.uid}">1V1</button>` : ''));
  rosterActions.duel = (uid) => {
    roster.hide();
    challenge(uid);
  };

  // Re-ride the opponent's inputs ourselves to get their score.
  function verifyRecord(rec) {
    if (!verifyMod || !rec) return null;
    const r = verifyMod.rerun({ park: rec.park, version: rec.version, steps: rec.steps, inputs: rec.inputs, marks: rec.marks || [], grabSlots: rec.grabSlots, board: !!rec.board, claimed: { total: -1 } });
    return r.results ? r.results.total : 0;
  }

  async function startDuel({ id, opp, host, park, session = null }) {
    const me = identity();
    if (!me || duel) return;
    try {
      if (!verifyMod) verifyMod = await import('./sim/verify.js');
      const lk = live?.remotes.get(opp.uid)?.look;
      const hooks = {
          onTurn: (uid, run) => duelTurn(uid, run),
          onCountdown: (uid) => {
            countdown = { until: performance.now() + 3600, mine: uid === me.uid, uid };
            if (uid !== me.uid && duelOpp) {
              duelOpp.snaps = new Snapshots();
              dressOpp(uid);
            }
          },
          onOppPose: (m) => {
            if (!duelOpp || !validPose(m)) return;
            duelOpp.snaps.push(m.t, m.f, performance.now());
            duelOpp.score = Number(m.sc) || 0;
          },
          onOppDone: (total, run, uid = opp.uid) => {
            const n = duelRiders().length;
            const each = duel ? duel.order.length / n : 2;
            toast(each > 1 ? `${duelTag(uid)}: run ${Math.floor(run / n) + 1} scored ${fmt(total)}` : `${duelTag(uid)} scored ${fmt(total)}`, 4000);
          },
          onOver: (res) => duelOver(res),
          onRestart: (p) => duelRestart(p),
          onOppLeft: () => duelOppLeft(),
          onOppPresence: (here) => {
            oppGone = !here;
            if (here) setCard('opp', null);
          },
          onConnection: (ok) => setCard('conn', ok ? null : { big: 'RECONNECTING…', small: 'Lost the connection to the duel. Trying again.' }),
          onProposal: (p) => duelProposal(p),
          onError: (msg) => toast(msg, 6000),
      };
      if (session) {
        // Ranked: the server is the referee.
        duel = session;
        duel.h = hooks;
      } else duel = new DuelSession({ id, me, opp, host, park, verify: verifyRecord, hooks });
      await duel.connect();
      const model = new RiderModel({ ...DEFAULT_LOOK, ...(lk || {}) });
      if (ASSETS.ready) {
        model.upgrade(ASSETS.parts);
        model.applyLook({ ...DEFAULT_LOOK, ...(lk || {}) });
      }
      model.root.visible = false;
      duelOpp = { model, snaps: new Snapshots(), score: 0, camPos: null, prev: new THREE.Vector3() };
      if (session?.teamPlay) {
        const mine = duelRiders().filter((p) => p.team === duel.myTeam && p.uid !== me.uid).map((p) => p.tag);
        const them = duelRiders().filter((p) => p.team !== duel.myTeam).map((p) => p.tag);
        toast(`Ranked ${duel.mode} on ${PARK_NAME(park)}: you and ${mine.join(', ')} vs ${them.join(' and ')}!`, 5000);
      } else toast(session ? `Ranked ${duel.mode} on ${PARK_NAME(park)} vs ${opp.tag}!` : `Duel with ${opp.tag} on ${PARK_NAME(park)}!`, 4000);
      enterDuelLobby();
    } catch (e) {
      console.warn(e);
      toast("Couldn't start the duel.");
      duel = null;
    }
  }

  // Everyone in the duel or ranked match: [{ uid, tag, team }].
  function duelRiders() {
    if (!duel) return [];
    return duel.players || [
      { uid: duel.me.uid, tag: duel.me.tag, team: 0 },
      { uid: duel.opp.uid, tag: duel.opp.tag, team: 1 },
    ];
  }
  function duelTag(uid) {
    if (duel && uid === duel.me.uid) return duel.me.tag;
    return duelRiders().find((p) => p.uid === uid)?.tag || 'Rider';
  }
  const duelBest = (u) => Math.max(0, ...((duel && duel.scores[u]) || []));
  // Teams: each rider's run added up per team.
  function teamTotals() {
    const t = [0, 0];
    for (const p of duelRiders()) t[p.team] += duelBest(p.uid);
    return t;
  }
  // Put the rider we're about to watch in their own Locker look.
  function dressOpp(uid) {
    if (!duelOpp) return;
    const lk = duel?.looks?.[uid] || live?.remotes.get(uid)?.look;
    try {
      duelOpp.model.applyLook({ ...DEFAULT_LOOK, ...(lk || {}) });
    } catch {
      duelOpp.model.applyLook(DEFAULT_LOOK);
    }
  }

  function enterDuelLobby() {
    const L = loaded;
    if (!L || !duel) return;
    blurMenus();
    endLift();
    showOverlay(null);
    $('duelover').classList.add('hidden');
    $('finishcard').classList.add('hidden');
    $('liftbar').classList.add('hidden');
    L.run.reset();
    L.hud.show(false);
    duelRun = false;
    countdown = null;
    state = 'duel';
    if (duelOpp && duelOpp.model.root.parent !== L.world.scene) L.world.scene.add(duelOpp.model.root);
    updateDuelHud();
    duel.ready();
  }

  function duelTurn(uid, run) {
    const L = loaded;
    if (!L) return;
    state = 'duel';
    L.run.reset();
    L.hud.show(false);
    updateDuelHud();
    if (uid === duel.me.uid) setTimeout(() => duel && duel.turn === uid && duel.run === run && duel.go(), 1500);
  }

  function beginDuelRun() {
    startRun();
    duelRun = true;
    duel.startRun();
    updateDuelHud();
  }

  function endDuelRun(reason) {
    const L = loaded;
    if (!duel || !duelRun) return;
    duelRun = false;
    const res = L.run.results();
    const data = recorder.data();
    const record = { version: SIM_VERSION, park: L.id, steps: data.steps, inputs: packRuns(data.runs), marks: data.marks, grabSlots: L.run.rider.grabSlots.slice(), board: L.run.rider.board };
    setCard('still', null);
    if (state === 'paused') showOverlay(null);
    state = 'duel';
    L.hud.show(false);
    const n = (duel.scores[duel.me.uid]?.length || 0) + 1;
    toast(`Your run${duel.teamPlay ? '' : ` ${n}`}: ${fmt(res.total)}${reason === 'cap' ? ' (out of pause time)' : ''}`, 4000);
    duel.finishRun(res.total, record);
  }

  // During my duel run: stream my pose; pausing or standing still uses up the 30 s.
  function duelTick(L, dt) {
    if (!duel || !duelRun) return;
    const r = L.run.rider;
    duel.pose(r, L.run.score.total);
    let why = null;
    if (state === 'paused') why = 'PAUSED';
    else if (state === 'riding' && r.mode === 'ground' && r.speed < 0.6 && L.run.time > 2.5) why = 'STANDING STILL';
    if (why) {
      const left = duel.addPause(dt);
      setCard('still', { big: why, small: `${Math.ceil(left)} s of pause time left in this duel` });
      if (left <= 0) endDuelRun('cap');
    } else if (cards.still) setCard('still', null);
  }

  function updateDuelHud() {
    const el = $('duelhud');
    if (!duel) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    const total = duel.order.length;
    const runTxt = duel.over ? 'FINAL' : `RUN ${duel.run + 1}/${total}`;
    $('dh-title').textContent = `${duel.ranked ? `RANKED ${duel.mode.toUpperCase()}` : 'DUEL'} · ${PARK_NAME(duel.park)} · ${runTxt}`;
    if (duel.teamPlay) {
      const t = teamTotals();
      $('dh-score').innerHTML = `Your team <b>${fmt(t[duel.myTeam])}</b> · Them <b>${fmt(t[1 - duel.myTeam])}</b>`;
    } else $('dh-score').innerHTML = `${esc(duel.me.tag)} <b>${fmt(duelBest(duel.me.uid))}</b> · ${esc(duel.opp.tag)} <b>${fmt(duelBest(duel.opp.uid))}</b>`;
  }

  function duelOver(res) {
    setCard('still', null);
    countdown = null;
    setCard('count', null);
    state = 'duelover';
    updateDuelHud();
    const me = duel.me;
    const opp = duel.opp;
    if (duel.teamPlay) {
      const myTeam = duel.myTeam;
      $('do-title').textContent = res.winnerTeam === null || res.winnerTeam === undefined ? 'DRAW' : res.winnerTeam === myTeam ? 'YOUR TEAM WINS!' : 'THEY WIN';
      const t = teamTotals();
      const side = (team, label) =>
        duelRiders()
          .filter((p) => p.team === team)
          .map((p) => `<tr${p.uid === me.uid ? ' class="me"' : ''}><td><b>${esc(p.tag)}</b></td><td class="muted">${label}</td><td>${duel.scores[p.uid]?.length ? fmt(duelBest(p.uid)) : '—'}</td></tr>`)
          .join('') + `<tr><td></td><td class="muted">Total</td><td><b>${fmt(t[team])}</b></td></tr>`;
      $('do-table').innerHTML = `<tr><td></td><td class="muted">Team</td><td class="muted">Run</td></tr>${side(myTeam, 'Yours')}${side(1 - myTeam, 'Theirs')}`;
    } else {
      $('do-title').textContent = res.winner === null ? 'DRAW' : res.winner === me.uid ? 'YOU WIN!' : `${opp.tag.toUpperCase()} WINS`;
      const row = (u, tag) => `<tr><td><b>${esc(tag)}</b></td>${[0, 1].map((i) => `<td>${duel.scores[u][i] !== undefined ? fmt(duel.scores[u][i]) : '—'}</td>`).join('')}<td><b>${fmt(res.best[u] ?? duelBest(u))}</b></td></tr>`;
      $('do-table').innerHTML = `<tr><td></td><td class="muted">Run 1</td><td class="muted">Run 2</td><td class="muted">Best</td></tr>${row(me.uid, me.tag)}${row(opp.uid, opp.tag)}`;
    }
    $('do-msg').textContent = '';
    $('do-msg').className = 'acct-msg';
    $('do-parks').classList.add('hidden');
    $('duelover').classList.remove('hidden');
    $('duelover').querySelector('[data-dact=rematch]').disabled = false;
    $('duelover').querySelector('[data-dact=map]').disabled = false;
    // Ranked: rating change, and look for another match instead of a rematch.
    const rk = !!duel.ranked;
    $('duelover').querySelector('[data-dact=rematch]').textContent = rk ? 'Find another match' : 'Rematch';
    $('duelover').querySelector('[data-dact=map]').classList.toggle('hidden', rk);
    $('duelover').querySelector('[data-dact=leave]').textContent = rk ? 'Back to Basecamp' : 'Leave duel';
    if (rk) {
      const c = res.changes?.[me.uid];
      if (res.reason === 'no_show' || duel.view?.status === 'cancelled') $('do-msg').textContent = 'Match called off.';
      else if (c) {
        const d = c.after - c.before;
        const lost = res.reason === 'left' || res.reason === 'timeout';
        const why = lost ? (res.winnerTeam === duel.myTeam ? ' · the other side left' : ' · your side left') : '';
        $('do-msg').textContent = `Rating ${c.before} → ${c.after} (${d >= 0 ? '+' : ''}${d})${c.placements < 5 ? ` · placement ${c.placements}/5` : ` · ${c.tier}`}${why}`;
        $('do-msg').className = `acct-msg ${d >= 0 ? 'good' : 'bad'}`;
      }
    }
  }

  function duelProposal(park) {
    if (!duel || state !== 'duelover') return;
    const mine = duel.again[duel.me.uid];
    if (mine === park) return; // about to restart
    const what = park === duel.park ? `${duel.opp.tag} wants a rematch on ${PARK_NAME(park)}.` : `${duel.opp.tag} wants to change map to ${PARK_NAME(park)}.`;
    $('do-msg').innerHTML = `${esc(what)} <button class="btn sm primary" id="do-accept">Accept</button>`;
    $('do-accept').addEventListener('click', () => duel.proposeAgain(park));
  }

  async function duelRestart(park) {
    $('duelover').classList.add('hidden');
    const L = loaded;
    if (!L || L.id !== park) {
      state = 'loading';
      parkId = park;
      profile.park = park;
      try {
        await loadPark(park, (p, t) => loadingScreen.set(p, t));
      } catch (e) {
        console.warn(e);
        toast("Couldn't load the duel park.");
        leaveDuel();
        toBasecamp();
        return;
      }
      if (live) await live.join(park).catch(() => {});
    }
    enterDuelLobby();
  }

  function duelOppLeft() {
    if (!duel) return;
    toast(`${duel.opp.tag} left the duel.`, 5000);
    if (!duel.over) {
      while (!duel.over) {
        if (duel.turn === duel.opp.uid) duel.forfeitTurn();
        else {
          duel.scores[duel.me.uid].push(0);
          duel.run++;
        }
      }
      duelOver(duel.result());
    }
    // Leaving forfeits: whoever stayed wins.
    $('do-title').textContent = 'YOU WIN!';
    $('do-msg').textContent = `${duel.opp.tag} left the duel, so you win by forfeit.`;
    $('duelover').querySelector('[data-dact=rematch]').disabled = true;
    $('duelover').querySelector('[data-dact=map]').disabled = true;
    setCard('opp', null);
  }

  // The other rider has dropped out: their pause time runs down.
  function watchOpponent(dt) {
    let gone = null;
    if (duel && !duel.over) gone = duel.absent ? (duel.absent.has(duel.turn) ? duel.turn : null) : oppGone ? duel.opp.uid : null;
    if (!gone) {
      if (cards.opp) setCard('opp', null);
      return;
    }
    if (duel.ranked) {
      // The server's clock decides: the side whose rider is gone forfeits after 4 minutes on one turn.
      const left = Math.max(0, 240 - duel.turnAge);
      const mate = duel.teamPlay && duelRiders().find((p) => p.uid === gone)?.team === duel.myTeam;
      setCard('opp', { big: 'NOT RESPONDING', small: `${duelTag(gone)} has dropped out · ${mate ? 'your team forfeits' : 'their side forfeits'} in ${Math.floor(left / 60)}:${String(Math.ceil(left % 60)).padStart(2, '0')} unless they're back` });
      if (left <= 0 && !mate) duel.forfeitTurn();
      return;
    }
    duel.pauseUsed[gone] += dt;
    const left = duel.pauseLeft(gone);
    setCard('opp', { big: 'NOT RESPONDING', small: `${duelTag(gone)} has dropped out · ${Math.ceil(left)} s of their pause time left` });
    if (left <= 0) {
      if (duel.turn === gone) duel.forfeitTurn();
      if (state === 'duel' || state === 'duelover') updateDuelHud();
    }
  }

  async function leaveDuel() {
    const d = duel;
    if (!d) return;
    duel = null;
    duelRun = false;
    countdown = null;
    incoming = null;
    for (const k of Object.keys(cards)) setCard(k, null);
    $('duelover').classList.add('hidden');
    $('duelhud').classList.add('hidden');
    if (reel) {
      reel.dispose();
      reel = null;
    }
    if (duelOpp) {
      duelOpp.model.root.parent?.remove(duelOpp.model.root);
      duelOpp = null;
    }
    await d.leave();
  }

  $('duelover').addEventListener('click', (e) => {
    const act = e.target.closest('[data-dact]')?.dataset.dact;
    if (!act || !duel) return;
    if (duel.ranked && (act === 'rematch' || act === 'leave')) {
      const mode = duel.mode;
      leaveDuel();
      toBasecamp();
      if (act === 'rematch') findMatch(mode);
      return;
    }
    if (act === 'rematch') {
      duel.proposeAgain(duel.park);
      $('do-msg').textContent = `Waiting for ${duel.opp.tag} to accept…`;
    } else if (act === 'map') {
      const el = $('do-parks');
      el.innerHTML = DUEL_PARKS.filter((id) => id !== duel.park).map((id) => `<button data-dpark="${id}">${PARK_NAME(id)}</button>`).join('');
      el.classList.remove('hidden');
      el.querySelectorAll('[data-dpark]').forEach((b) =>
        b.addEventListener('click', () => {
          duel.proposeAgain(b.dataset.dpark);
          el.classList.add('hidden');
          $('do-msg').textContent = `Asked ${duel.opp.tag} to ride ${PARK_NAME(b.dataset.dpark)}…`;
        })
      );
    } else if (act === 'reel') startReel();
    else if (act === 'leave') {
      leaveDuel();
      startLift();
    }
  });

  // Side-by-side highlight reel of both riders' best runs.
  function startReel() {
    const L = loaded;
    if (!duel || !L) return;
    const bestRec = (u) => {
      const sc = duel.scores[u];
      let i = sc.indexOf(Math.max(...sc));
      if (!duel.records[u][i]) i = duel.records[u].findIndex(Boolean);
      return i >= 0 ? duel.records[u][i] : null;
    };
    const mine = bestRec(duel.me.uid);
    const myTeam = duelRiders().find((p) => p.uid === duel.me.uid)?.team ?? 0;
    const rival = duelRiders().filter((p) => p.team !== myTeam).sort((a, b) => duelBest(b.uid) - duelBest(a.uid))[0] || duel.opp;
    const theirs = bestRec(rival.uid);
    if (!mine && !theirs) {
      toast('No runs to show.');
      return;
    }
    $('duelover').classList.add('hidden');
    $('duelhud').classList.add('hidden');
    model.root.visible = false;
    if (duelOpp) duelOpp.model.root.visible = false;
    try {
      reel = new Reel({
        renderer,
        world: L.world,
        terrain: L.terrain,
        sides: [
          { record: mine, look: look(), tag: duel.me.tag },
          { record: theirs, look: duel.looks?.[rival.uid] || live?.remotes.get(rival.uid)?.look, tag: rival.tag },
        ],
      });
      state = 'reel';
    } catch (e) {
      console.warn(e);
      toast("Couldn't play the highlight reel.");
      $('duelover').classList.remove('hidden');
    }
  }
  function endReel() {
    if (reel) reel.dispose();
    reel = null;
    if (duel) {
      state = 'duelover';
      updateDuelHud();
      $('duelover').classList.remove('hidden');
    }
  }
  $('rl-skip').addEventListener('click', () => endReel());

  // Draw the duel screens: waiting at the gate, spectating, results, reel.
  const spectateLook = new THREE.Vector3();
  function duelFrame(L, dt) {
    placeModel(L.world.scene);
    const now = performance.now();
    if (state === 'reel' && reel) {
      if (!reel.frame(dt, L.time)) endReel();
      liveFrame(L, dt);
      return;
    }
    if (countdown) {
      const left = (countdown.until - now) / 1000;
      if (left > 0.6) setCard('count', { big: String(Math.ceil(left - 0.6)), small: countdown.mine ? 'Your run' : `${duelTag(countdown.uid || duel?.opp.uid)}'s run` });
      else if (left > 0) setCard('count', { big: 'GO!', small: '' });
      else {
        const mine = countdown.mine;
        countdown = null;
        setCard('count', null);
        if (mine && duel) {
          beginDuelRun();
          return;
        }
      }
    }
    watchOpponent(dt);
    const r = L.run.rider;
    const spectating = duel && !duel.myTurn && !duel.over && state === 'duel';
    let focus = null;
    if (spectating && duelOpp) {
      model.root.visible = false;
      const delay = 140;
      if (duelOpp.snaps.sample(now, delay, duelFrameBuf)) {
        const v = frameRider(duelFrameBuf, 0, duelView);
        const m = duelOpp.model;
        m.root.visible = true;
        placeRider(v, L.terrain, v.pos, v.q, m.root.position, m.root.quaternion);
        m.update(poseFor(v), dt);
        focus = m.root.position;
        // Follow the rider from behind their direction of travel.
        const dir = tmp.subVectors(focus, duelOpp.prev);
        duelOpp.prev.copy(focus);
        dir.y = 0;
        if (dir.lengthSq() > 1e-5) duelOpp.dir = (duelOpp.dir || new THREE.Vector3()).copy(dir).normalize();
        const d = duelOpp.dir || tmp2.set(0, 0, -1);
        const want = tmp2.copy(focus).addScaledVector(d, -6.5);
        want.y = Math.max(focus.y + 2.3, L.terrain.height(want.x, want.z) + 1.2);
        if (!duelOpp.camPos) duelOpp.camPos = want.clone();
        duelOpp.camPos.lerp(want, 1 - Math.exp(-dt * 4));
        camera.position.copy(duelOpp.camPos);
        spectateLook.copy(focus);
        spectateLook.y += 0.4;
        camera.lookAt(spectateLook);
        const who = duelRiders().find((p) => p.uid === duel.turn);
        const side = duel.teamPlay && who ? (who.team === duel.myTeam ? ' (your team)' : ' (other team)') : '';
        $('dh-score').innerHTML = `Watching ${esc(duelTag(duel.turn))}${side} · <b>${fmt(duelOpp.score)}</b>`;
      } else {
        // Not started yet: look at the start gate.
        if (duelOpp.model) duelOpp.model.root.visible = false;
        placeRider(r, L.terrain, r.pos, r.q, pivot, model.root.quaternion);
        focus = pivot;
        L.chase.update(r, pivot, dt);
      }
    } else {
      if (duelOpp) duelOpp.model.root.visible = false;
      model.root.visible = true;
      placeRider(r, L.terrain, r.pos, r.q, model.root.position, model.root.quaternion);
      model.update({ ...IDLE, crouch: 0.05 + 0.04 * Math.sin(L.time * 1.6) }, dt);
      pivot.copy(model.root.position);
      focus = pivot;
      L.chase.update(r, pivot, dt);
    }
    L.world.update(L.time, focus, camera);
    liveFrame(L, dt);
    renderer.render(L.world.scene, camera);
  }

  // ------------------------------------------------------------ ranked (Phase 5)
  const rq = { mode: null, waited: 0, timer: 0, matchId: null, checkingIn: false, partner: null };
  function openRanked() {
    openModal('Ranked', '<div class="acct" id="ranked-panel"></div>');
    mountRanked($('ranked-panel'), {
      queue: () => (rq.mode ? { mode: rq.mode, waited: rq.waited, partnerTag: rq.partner ? partnerTag(rq.partner) : null, partnerReady: rq.partnerReady } : null),
      onFind: (mode, partner) => findMatch(mode, partner),
      onCancel: () => cancelSearch(),
      onAccount: () => openAccount(),
      partnerOptions: () => (party.info ? party.members.filter((m) => m.id !== account.user?.id) : []),
    });
  }
  const partnerTag = (uid) => party.members.find((m) => m.id === uid)?.gamertag || 'your partner';
  function updateQueueBar() {
    const el = $('queuebar');
    if (!rq.mode || duel) {
      el.classList.add('hidden');
      return;
    }
    const t = rq.waited || 0;
    const clock = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    $('qb-text').textContent = rq.matchId
      ? `Ranked ${rq.mode} · match found, getting ready…`
      : rq.partner && !rq.partnerReady
        ? `Ranked ${rq.mode} · waiting for ${partnerTag(rq.partner)} to queue with you · ${clock}`
        : `Searching ranked ${rq.mode}${rq.partner ? ` with ${partnerTag(rq.partner)}` : ''} · ${clock}`;
    $('qb-cancel').classList.toggle('hidden', !!rq.matchId);
    el.classList.remove('hidden');
  }
  $('qb-cancel').addEventListener('click', () => cancelSearch());
  async function findMatch(mode, partner = null) {
    if (!account.ready) {
      openAccount();
      return;
    }
    if (duel) {
      toast('Finish your duel first.');
      return;
    }
    try {
      const r = await ranked.join(mode, partner || null);
      if (r?.status === 'penalty') {
        const s = Math.max(0, Math.ceil((Date.parse(r.until) - Date.now()) / 1000));
        toast(`You left a ranked match recently. You can queue again in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.`, 6000);
        return;
      }
      if (r?.status !== 'queued' && r?.status !== 'in_match') {
        const why = {
          no_gamertag: 'Pick a gamertag first.',
          partner_too_far: 'Teammates need to be within 500 rating of each other. Queue solo instead.',
          bad_partner: "Couldn't queue with that rider.",
        };
        toast(why[r?.status] || "Couldn't join the queue.", 6000);
        return;
      }
      setCard('rankask', null);
      // Ask my partner (in my party) to queue with me, unless they already have.
      if (mode === '2v2' && partner && rq.askedBy !== partner) party.askRanked(partner, mode);
      rq.askedBy = null;
      rq.mode = mode;
      rq.partner = partner;
      rq.partnerReady = false;
      rq.waited = 0;
      clearInterval(rq.timer);
      rq.timer = setInterval(queueTick, 2000);
      queueTick();
      updateQueueBar();
    } catch (e) {
      toast(e.message);
    }
  }
  async function cancelSearch() {
    clearInterval(rq.timer);
    rq.mode = null;
    rq.matchId = null;
    updateQueueBar();
    await ranked.leaveQueue().catch(() => {});
  }
  async function queueTick() {
    if (!rq.mode) return;
    let r;
    try {
      r = await ranked.poll();
    } catch {
      return;
    }
    if (r.status === 'queued') {
      if (rq.matchId) {
        // Called off: someone didn't show. We're back at the front of the queue.
        toast("Your opponent didn't show up. You're back in the queue.", 5000);
        rq.matchId = null;
        setCard('count', null);
        if (state === 'duel' && !duel) toBasecamp();
      }
      rq.waited = r.waited || 0;
      rq.partnerReady = !!r.partner_ready;
    } else if (r.status === 'match') await onMatchView(r.match);
    else if (r.status === 'idle' || r.status === 'ended') {
      if (rq.matchId && r.match?.status === 'cancelled') {
        toast("The match was called off: you didn't check in in time.", 6000);
        if (state === 'duel' && !duel) toBasecamp();
      }
      clearInterval(rq.timer);
      rq.mode = null;
      rq.matchId = null;
    }
    updateQueueBar();
  }
  async function onMatchView(v) {
    if (v.status === 'checkin') {
      if (rq.matchId !== v.id) {
        rq.matchId = v.id;
        closeModal();
        toast(`Match found! Ranked ${v.mode} on ${PARK_NAME(v.park)}. ${v.mode === '2v2' ? 'Your opponents are' : 'Your opponent is'} revealed at the start.`, 6000);
        await checkInFor(v);
      }
      setCard('count', { big: 'MATCH FOUND', small: `Waiting for everyone to arrive · ${Math.ceil(v.checkin_left)} s` });
    } else if (v.status === 'live' && !duel) {
      clearInterval(rq.timer);
      setCard('count', null);
      rq.mode = null;
      rq.matchId = null;
      updateQueueBar();
      const me = { ...identity(), look: look() };
      const session = new ServerMatch({ view: v, me, submit: (rec, total, matchId) => submitPacked(rec, total, matchId) });
      await startDuel({ id: v.id, opp: session.opp, host: session.host, park: v.park, session });
    }
  }
  // Load APEX, stand at the gate, and tell the server I'm here.
  async function checkInFor(v) {
    if (rq.checkingIn) return;
    rq.checkingIn = true;
    try {
      if (live && live.room) await live.leaveRoom();
      if (!loaded || loaded.id !== v.park) {
        basecamp.hide();
        showOverlay(null);
        state = 'loading';
        loadingScreen.show(music.track.name);
        parkId = v.park;
        await loadPark(v.park, (p, t) => loadingScreen.set(p, t));
        loadingScreen.hide();
      }
      endLift();
      basecamp.hide();
      showOverlay(null);
      loaded.run.reset();
      loaded.hud.show(false);
      state = 'duel';
      await ranked.checkin(v.id);
    } catch (e) {
      console.warn(e);
      toast("Couldn't get to the match.");
    } finally {
      rq.checkingIn = false;
    }
  }

  // ------------------------------------------------------------ parties (Phase 4 step 5)
  // Leader: head to the party's park (in its private room if switched on),
  // then tell everyone, who get a GO / STAY prompt.
  async function partyGo() {
    if (!party.info || !party.isLeader) return;
    if (playMode !== 'live') await setPlayMode('live');
    if (!live) return;
    const park = party.info.park || parkId;
    if (!party.info.park) await party.set(park, null).catch(() => {});
    closeModal();
    if (duel) leaveDuel();
    parkId = park;
    profile.park = park;
    goRide({ privateKey: party.info.private_room ? party.info.id : null, announce: true, force: true });
  }
  party.h.onRankedAsk = (m) => {
    if (duel || (rq.mode === m.mode && rq.partner === m.u)) return;
    const tag = String(m.tag || 'A party member').slice(0, 18);
    setCard('rankask', {
      big: `${tag} wants to play ranked 2v2 with you`,
      small: 'You queue together as a team on APEX.',
      buttons: [
        {
          label: 'QUEUE',
          fn: () => {
            setCard('rankask', null);
            rq.askedBy = m.u;
            if (rq.mode) cancelSearch().then(() => findMatch('2v2', m.u));
            else findMatch('2v2', m.u);
          },
        },
        { label: 'No thanks', fn: () => setCard('rankask', null) },
      ],
      rebuild: true,
    });
    clearTimeout(rq.askTimer);
    rq.askTimer = setTimeout(() => setCard('rankask', null), 45000);
  };
  party.h.onGo = (m) => {
    if (!m || !m.park) return;
    const priv = m.priv ? ' (private room)' : '';
    setCard('partygo', {
      big: `${String(m.tag || 'Your leader').slice(0, 18)} is heading to ${PARK_NAME(m.park)}${priv}`,
      small: duel ? 'Going leaves your duel.' : 'Ride with your party?',
      buttons: [
        {
          label: 'GO',
          fn: async () => {
            setCard('partygo', null);
            if (playMode !== 'live') await setPlayMode('live');
            if (!live) return;
            if (duel) leaveDuel();
            closeModal();
            parkId = m.park;
            profile.park = m.park;
            goRide({ room: m.priv ? null : m.room, privateKey: m.priv ? m.party : null, force: true });
          },
        },
        { label: 'STAY', fn: () => setCard('partygo', null) },
      ],
      rebuild: true,
    });
  };
  const leftParty = (id, removed) => {
    if (removed) toast('The leader removed you from the party. You can rejoin in 10 minutes.', 8000);
    if (live && live.privateKey && live.privateKey === id) {
      toast('You left the party, so you left its private room.', 6000);
      toBasecamp();
    }
    syncChat();
  };
  party.h.onRemoved = (id) => leftParty(id, true);
  party.h.onLeft = (id) => leftParty(id, false);
  const seenInvites = new Set();
  party.onChange(() => {
    for (const i of party.invites)
      if (!seenInvites.has(i.party)) {
        seenInvites.add(i.party);
        toast(`${i.inviter} invited you to ${i.leader}'s party. Open Friends to join.`, 7000);
      }
    basecamp.refreshFriends(friends);
    syncChat();
  });

  function onRoomChange() {
    syncChat();
    updateRoomBadge();
    roster.render();
    if (parkMap.isOpen) parkMap.select(parkMap.sel);
  }
  function updateRoomBadge() {
    const el = $('roombadge');
    if (!live || !live.room) {
      el.classList.add('hidden');
      return;
    }
    const where = live.privateKey ? 'PRIVATE ROOM' : `ROOM ${live.number}`;
    el.textContent = `${where} · ${live.riders} rider${live.riders === 1 ? '' : 's'} · Tab`;
    el.classList.remove('hidden');
  }
  parkMap.riderCount = (id) => (live && live.lobby ? live.parkCount(id) : null);
  // Leaving to Basecamp, or signing out, takes you out of the room.
  account.onChange(() => {
    if (playMode === 'live' && !identity()) setPlayMode('solo');
  });
  async function joinRoomFor(id, opts = {}) {
    if (!live) return;
    try {
      const n = await live.join(id, { room: opts.room || null, privateKey: opts.privateKey || null });
      toast(opts.privateKey ? `${parkMeta(id).name} · Private party room` : `${parkMeta(id).name} · Room ${n}`, 3000);
      if (opts.announce) party.go({ park: id, room: n, priv: !!opts.privateKey });
    } catch (e) {
      console.warn(e);
      toast(e.message && /full/i.test(e.message) ? e.message : "Couldn't join a live room. Riding solo for now.");
    }
  }
  const STATUS_OF = { lift: 'lift', riding: 'riding', paused: 'paused', finish: 'results', results: 'results', replay: 'replay', duel: 'duel', duelover: 'duel', reel: 'duel' };
  // Send your state and place everyone else, every frame you're in a park.
  function liveFrame(L, dt) {
    if (!live || !live.room || live.park !== L.id) {
      if (remotes.entries.size) remotes.clear();
      L.hud.others = null;
      duelTick(L, dt);
      return;
    }
    duelTick(L, dt);
    live.tick(L.run.rider, STATUS_OF[state] || 'lift');
    remotes.attach(L.world.scene);
    remotes.update(live, dt, camera, L.terrain);
    if (duel) remotes.hideUid(duel.opp.uid);
    L.hud.others = remotes.dots();
    if (roster.isOpen) {
      rosterTimer -= dt;
      if (rosterTimer <= 0) {
        roster.render();
        rosterTimer = 1;
      }
    }
  }
  let rosterTimer = 0;
  // Idle in a live room: countdown, then back to Basecamp (solo never times out).
  const idle = new IdleWatch({
    onTimeout: () => {
      if (state === 'replay' && replayView.isOpen) replayView.close();
      toBasecamp();
      toast('Back in Basecamp: you were idle in a live room.', 8000);
    },
  });
  // Hold Tab for the roster.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Tab' || !live || !live.room || e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    if (!e.repeat && !roster.pinned) roster.show(live);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Tab' && !roster.pinned) roster.hide();
  });

  // Leaderboards (Phase 3 step 4).
  function openBoard() {
    openModal('Leaderboard', '<div class="boardwrap" id="board-panel"></div>');
    mountBoard($('board-panel'), { park: loaded ? loaded.id : parkId, onAccount: () => openAccount() });
  }
  const fmtN = (n) => Math.round(n).toLocaleString('en-US');
  // Every finished run on a leaderboard park is posted while signed in; the
  // server re-rides it and only counts it if the score comes out the same.
  async function postRun(rec) {
    const el = $('res-board');
    const name = parkMeta(rec.park).name;
    if (!canPost(rec)) {
      el.textContent = '';
      return;
    }
    if (!account.ready) {
      el.innerHTML = `<button class="btn sm" data-post="signin">${account.signedIn ? 'Pick a gamertag' : 'Sign in'}</button> to post this run to the ${name} leaderboard`;
      el.querySelector('[data-post]').addEventListener('click', () => openAccount());
      return;
    }
    if (rec.posting || rec.posted) return;
    rec.posting = true;
    el.textContent = 'Checking your run on the server…';
    const r = await submitRun(rec);
    rec.posting = false;
    if (lastReplay !== rec) return;
    if (r.ok) {
      rec.posted = true;
      el.innerHTML = `✓ Checked by the server · <b>#${r.rank}</b> on ${name}${r.improved ? ' · new leaderboard best' : ` · your board best is ${fmtN(r.best)}`}`;
    } else {
      el.textContent = r.message + (r.error === 'mismatch' && r.serverTotal != null ? ` (Server got ${fmtN(r.serverTotal)}.)` : '');
      if (r.error === 'network' || r.error === 'server_error') {
        el.insertAdjacentHTML('beforeend', ' <button class="btn sm" data-post="retry">Try again</button>');
        el.querySelector('[data-post]').addEventListener('click', () => postRun(rec));
      }
    }
  }
  account.onChange(() => {
    if (state === 'results' && lastReplay && account.ready && !lastReplay.posted && !lastReplay.posting) postRun(lastReplay);
  });

  // Cloud saves (Phase 3 step 2): show the status, and apply what arrives.
  addAccountSection(() => `<h3>CLOUD SAVE</h3><p class="muted">${esc(cloudStatusText())}</p>`);
  cloud.onApplied = (changed) => {
    if (changed.look && state !== 'locker') model.applyLook(look());
    if (basecamp.visible) basecamp.refresh();
  };
  resumeAccount();

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
    if (state === 'lift') lift.d = lift.ride.length;
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

  // ------------------------------------------------------------ music
  function musicUI() {
    $('mp-name').textContent = music.track.name;
    $('pm-name').textContent = music.track.name;
    $('mp-play').textContent = music.playing ? 'Pause' : 'Play';
    $('pm-play').textContent = music.playing ? 'Pause' : 'Play';
  }
  music.onChange(() => {
    musicUI();
    if (state === 'riding' && loaded) loaded.hud.hint(`♪ ${music.track.name}`, 2.5);
  });
  musicUI();
  $('mp-play').addEventListener('click', () => music.toggle());
  $('mp-skip').addEventListener('click', () => music.skip());
  $('mp-vol').addEventListener('click', () => {
    $('musicpop').classList.add('hidden');
    openSettings('sound');
  });
  // A soft click on every menu button.
  document.addEventListener('click', (e) => {
    if (e.target.closest('button')) sfx.ui();
  });

  // Look around on the lift: drag with the mouse or a finger.
  {
    let drag = null;
    $('game').addEventListener('pointerdown', (e) => {
      if (state === 'lift') drag = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointerup', () => (drag = null));
    window.addEventListener('pointermove', (e) => {
      if (!drag || state !== 'lift' || !lift) return;
      lift.yaw += (e.clientX - drag.x) * 0.006;
      lift.pitch = Math.max(-0.4, Math.min(1.2, lift.pitch - (e.clientY - drag.y) * 0.004));
      drag = { x: e.clientX, y: e.clientY };
    });
  }

  // ------------------------------------------------------------ locker
  let lockerYaw = 0;
  const locker = new Locker({
    model,
    onClose: () => {
      ghostModel.applyLook(look());
      toBasecamp();
    },
  });
  function openLocker() {
    blurMenus();
    basecamp.hide();
    showOverlay(null);
    state = 'locker';
    lockerYaw = 0;
    locker.open();
  }
  {
    let drag = null;
    $('game').addEventListener('pointerdown', (e) => {
      if (state === 'locker') drag = e.clientX;
    });
    window.addEventListener('pointerup', () => (drag = null));
    window.addEventListener('pointermove', (e) => {
      if (drag === null || state !== 'locker') return;
      lockerYaw += (e.clientX - drag) * 0.01;
      drag = e.clientX;
    });
  }

  // ------------------------------------------------------------ replays
  let replayReturn = 'basecamp';
  const replayView = new ReplayView({
    renderer,
    camera,
    model,
    onExit: () => {
      ghostModel.root.visible = false;
      if (replayReturn === 'results') {
        state = 'results';
        showOverlay('results');
        loaded.hud.show(false);
      } else toBasecamp();
    },
  });

  async function watchReplay(record, from, thenClip = false) {
    replayReturn = from;
    if (!loaded || loaded.id !== record.park) {
      basecamp.hide();
      showOverlay(null);
      state = 'loading';
      $('liftbar').classList.remove('hidden');
      $('lift-name').textContent = 'LOADING';
      await loadPark(record.park);
      $('liftbar').classList.add('hidden');
    }
    basecamp.hide();
    showOverlay(null);
    $('finishcard').classList.add('hidden');
    placeModel(loaded.world.scene);
    ghostModel.root.visible = false;
    const err = replayView.open(record, loaded);
    if (err) {
      openModal('Replay', `<p>${err}</p>`);
      return;
    }
    state = 'replay';
    if (thenClip) replayView.openClip();
  }

  async function openReplays() {
    const list = await replayDB.all();
    const rows = list.length
      ? list
          .map(
            (r) => `<tr><td><b>${parkMeta(r.park).name}</b><br><span class="muted">${new Date(r.date).toLocaleString()}</span></td><td>${r.total.toLocaleString('en-US')}<br><span class="muted">${r.bestTrick || '—'}</span></td><td>${r.version === SIM_VERSION ? `<button class="btn sm" data-watch="${r.id}">Watch</button> <button class="btn sm" data-clip="${r.id}">Clip</button>` : '<span class="muted">older version</span>'} ${account.ready && canPost(r) ? `<button class="btn sm" data-post="${r.id}">Post</button>` : ''} <button class="btn sm" data-keep="${r.id}">${r.saved ? 'Kept ★' : 'Keep'}</button> <button class="btn sm" data-del="${r.id}">Delete</button></td></tr>`
          )
          .join('')
      : '<tr><td class="muted">No replays yet. Your last 5 runs are saved here automatically.</td></tr>';
    openModal('Replays', `<p class="muted">Your last 5 runs are kept automatically; Keep a replay to hold on to it. Your best run on each park is saved as a ghost you race next time. Replays stay in this browser; Post sends a run's inputs to the leaderboard server to be checked.</p><table class="rlist">${rows}</table>`);
    const body = $('modal-body');
    body.querySelectorAll('[data-watch]').forEach((b) => b.addEventListener('click', async () => watchReplay(await replayDB.get(Number(b.dataset.watch)), 'basecamp')));
    body.querySelectorAll('[data-clip]').forEach((b) => b.addEventListener('click', async () => watchReplay(await replayDB.get(Number(b.dataset.clip)), 'basecamp', true)));
    body.querySelectorAll('[data-post]').forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true;
        b.textContent = 'Checking…';
        const r = await submitRun(await replayDB.get(Number(b.dataset.post)));
        b.textContent = r.ok ? `#${r.rank} ✓` : 'Not posted';
        b.title = r.ok ? 'Checked by the server and posted' : r.message;
        if (!r.ok) b.insertAdjacentHTML('afterend', `<br><span class="muted small">${esc(r.message)}</span>`);
      })
    );
    body.querySelectorAll('[data-keep]').forEach((b) =>
      b.addEventListener('click', async () => {
        const r = await replayDB.get(Number(b.dataset.keep));
        await replayDB.setSaved(r.id, !r.saved);
        openReplays();
      })
    );
    body.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        await replayDB.remove(Number(b.dataset.del));
        openReplays();
      })
    );
  }

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

  // opts: { room, privateKey, announce, force } for parties.
  async function goRide(opts = {}) {
    blurMenus();
    $('musicpop').classList.add('hidden');
    $('music-btn').classList.remove('on');
    basecamp.hide();
    showOverlay(null);
    state = 'loading';
    const fresh = !loaded || loaded.id !== parkId;
    if (fresh) {
      loadingScreen.show(music.track.name);
      loadingScreen.set(0.2, `Loading ${parkMeta(parkId).name}…`);
    }
    try {
      await loadPark(parkId, (p, s) => loadingScreen.set(p, s));
    } catch (e) {
      console.error(e);
      loadingScreen.set(0.2, 'Could not load the park. Check your connection.');
      $('ld-reload').classList.remove('hidden');
      return;
    }
    loadingScreen.hide();
    if (live && (opts.force || live.park !== parkId || !live.room)) joinRoomFor(parkId, opts);
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
    const ride = L.world.lift.ride;
    ride.start();
    lift = { d: 0, ride, cam: null, look: null, yaw: 0, pitch: 0 };
    state = 'lift';
    const names = { gondola: 'GONDOLA', ropeway: 'ROPEWAY', tbar: 'T-BAR' };
    $('lift-name').textContent = names[ride.type];
    $('liftbar').classList.remove('hidden');
  }

  function endLift() {
    if (lift) lift.ride.stop();
    lift = null;
  }

  function startRun() {
    blurMenus();
    endLift();
    const L = loaded;
    placeModel(L.world.scene);
    L.run.reset();
    const lk = look();
    L.run.rider.grabSlots = lk.grabs.slice();
    L.run.rider.board = lk.ride === 'board';
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
    recorder.reset();
    ghost = null;
    $('ghosttag').classList.add('hidden');
    placeModel(L.world.scene);
    if (ghostModel.root.parent !== L.world.scene) L.world.scene.add(ghostModel.root);
    ghostModel.root.visible = false;
    const runId = L.run;
    if (playMode !== 'live') replayDB.ghost(L.id).then((g) => {
      if (!g || g.version !== SIM_VERSION || loaded !== L || L.run !== runId || state !== 'riding') return;
      // Catch the ghost up to where you are now, so it starts with you.
      ghost = new Ghost(L.terrain, g);
      for (let i = 0; i < recorder.steps; i++) ghost.advance();
      $('ghosttag').textContent = `GHOST · best ${g.total.toLocaleString('en-US')}`;
      $('ghosttag').classList.remove('hidden');
    });
  }

  function pause(on) {
    if (on && state === 'riding') {
      state = 'paused';
      $('pause-roster').classList.toggle('hidden', !(live && live.room));
      showOverlay('pause');
    } else if (!on && state === 'paused') {
      state = 'riding';
      showOverlay(null);
      $('pause-help').classList.add('hidden');
      last = performance.now();
    }
  }

  function startFinish() {
    if (duel && duelRun) {
      endDuelRun('finish');
      return;
    }
    const L = loaded;
    const res = L.run.results();
    finish = { t: 0, res, face: 0, dir: null };
    state = 'finish';
    $('ghosttag').classList.add('hidden');
    ghostModel.root.visible = false;
    lastReplay = {
      id: Date.now(),
      park: L.id,
      date: Date.now(),
      version: SIM_VERSION,
      total: res.total,
      bestTrick: res.bestTrick?.name || null,
      name: displayName(profile.name),
      inputs: recorder.data(),
      grabSlots: L.run.rider.grabSlots.slice(),
      board: L.run.rider.board,
      saved: false,
    };
    replayDB.add(lastReplay);
    replayDB.offerGhost(lastReplay);
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
    if (lastReplay) postRun(lastReplay);
    else $('res-board').textContent = '';
    $('finishcard').classList.add('hidden');
    state = 'results';
    showOverlay('results');
  }

  $('pause').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'resume') pause(false);
    if (act === 'reset') {
      recorder.mark('reset');
      loaded.run.resetPosition();
      prevPos.copy(loaded.run.rider.pos);
      prevQ.copy(loaded.run.rider.q);
      loaded.chase.snap();
      pause(false);
    }
    if ((act === 'restart' || act === 'map') && duel) {
      toast("Not during a duel. Use Back to Basecamp to leave it.");
      return;
    }
    if (act === 'restart') startRun();
    if (act === 'map') openMap('paused');
    if (act === 'roster' && live && live.room) roster.show(live, true);
    if (act === 'settings') openSettings();
    if (act === 'help') $('pause-help').classList.toggle('hidden');
    if (act === 'basecamp') toBasecamp();
    if (act === 'mplay') music.toggle();
    if (act === 'mskip') music.skip();
  });
  $('results').addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'replay' && lastReplay) watchReplay(lastReplay, 'results');
    if (act === 'clip' && lastReplay) watchReplay(lastReplay, 'results', true);
    if (act === 'save' && lastReplay) {
      const ok = await replayDB.setSaved(lastReplay.id, true);
      if (ok) {
        lastReplay.saved = true;
        e.target.textContent = 'Saved ★';
      }
    }
    if (act === 'again') startLift();
    if (act === 'map') openMap('results');
  });

  // Esc steps back one menu level.
  function back() {
    if (state === 'reel') {
      endReel();
      return;
    }
    if (state === 'duel' && duel) {
      if (cards.leave) setCard('leave', null);
      else
        setCard('leave', {
          big: duel.ranked ? 'Leave the match?' : 'Leave the duel?',
          small: duel.ranked ? 'Leaving a ranked match loses it, and you get a cooldown before you can queue again.' : `${duel.opp.tag} will win the runs you don't ride.`,
          buttons: [
            { label: 'Stay', fn: () => setCard('leave', null) },
            {
              label: 'Leave',
              fn: () => {
                const rk = !!duel?.ranked;
                setCard('leave', null);
                leaveDuel();
                if (rk) toBasecamp();
                else startLift();
              },
            },
          ],
          rebuild: true,
        });
      return;
    }
    if (state === 'locker') {
      locker.close(false);
      return;
    }
    if (state === 'replay') {
      if (!$('clip').classList.contains('hidden')) replayView.closeClip();
      else if (!replayView.exporting) replayView.close();
      return;
    }
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
  let reportedState = null;
  let lastVy = 0;
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
    idle.update(dt, { active: !!(live && live.room) && !duel, state });
    if (state !== reportedState) {
      reportedState = state;
      reportLocation();
    }
    {
      const R = loaded?.run?.rider;
      const live = (state === 'riding' || state === 'finish') && R;
      sfx.update(
        live
          ? { mode: R.mode, speed: R.speed, powder: R.powder, braking: R.braking, butter: !!R.butter, active: true }
          : state === 'replay' && replayView.isOpen
            ? { mode: replayView.v.mode, speed: replayView.v.speed, active: true }
            : { mode: 'none', speed: 0, active: false, lift: state === 'lift' },
        dt
      );
    }
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
      else if (state === 'replay') replayView.toggle();
      else if (state === 'map') parkMap.onRide(parkMap.currentId);
      else if (state === 'results') startLift();
      else if (state === 'finish' && finish.t > 0.8) showResultsScreen();
      else if (state === 'lift') lift.d = lift.ride.length;
    } else if (state === 'lift' && input.wasPressed('skipLift')) lift.d = lift.ride.length;

    if (state === 'boot') {
      input.endFrame();
      return;
    }

    // -------------------------------------------- Basecamp and map: the lobby scene
    const inLobby = state === 'basecamp' || state === 'map' || state === 'locker' || (state === 'loading' && !loaded);
    if (inLobby) {
      placeModel(basecampScene.scene);
      model.root.visible = true;
      model.root.position.set(0, COM_HEIGHT, 0);
      model.root.quaternion.setFromAxisAngle(tmp.set(0, 1, 0), Math.PI - 0.35 + (state === 'locker' ? lockerYaw + 0.35 : 0));
      model.update({ ...IDLE, crouch: 0.05 + 0.05 * Math.sin(time * 1.6) }, dt);
      basecampScene.frameCamera(camera, camera.aspect, state === 'locker' ? (locker.focus === 'full' ? 'locker' : locker.focus) : 'full', dt);
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

    // -------------------------------------------- duel screens
    if (state === 'duel' || state === 'duelover' || state === 'reel') {
      duelFrame(L, dt);
      input.endFrame();
      return;
    }

    // -------------------------------------------- replay viewer
    if (state === 'replay') {
      placeModel(L.world.scene);
      if (live && live.room) live.tick(L.run.rider, 'replay');
      replayView.frame(dt, L.time);
      input.endFrame();
      return;
    }

    // -------------------------------------------- lift ride (third person, real lift speed)
    if (state === 'lift' || state === 'loading') {
      placeModel(L.world.scene);
      if (state === 'loading' || !lift) {
        L.world.update(L.time, camera.position, camera);
        renderer.render(L.world.scene, camera);
        input.endFrame();
        return;
      }
      const ride = lift.ride;
      lift.d += ride.speed * dt;
      if (lift.d >= ride.length) {
        startRun();
        input.endFrame();
        return;
      }
      liveFrame(L, dt);
      const feet = ride.place(lift.d, L.time, liftPos, liftDir);
      const left = (ride.length - lift.d) / ride.speed;
      $('lift-time').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')} to the top`;
      // Rider: standing in the cabin, or on the snow holding the T-bar.
      const fwd = tmp.set(liftDir.x, 0, liftDir.z).normalize();
      model.root.visible = true;
      model.root.position.set(feet.x, feet.y + COM_HEIGHT, feet.z);
      model.root.quaternion.setFromUnitVectors(tmp2.set(0, 0, -1), fwd);
      model.update({ ...IDLE, crouch: ride.type === 'tbar' ? 0.22 : 0.05 + 0.03 * Math.sin(L.time * 1.4) }, dt);
      // Third-person camera behind and beside, smoothed; drag to look around.
      const tbar = ride.type === 'tbar';
      const dist = tbar ? 6.5 : ride.type === 'ropeway' ? 16 : 9.5;
      const up = tbar ? 2.3 : ride.type === 'ropeway' ? 5 : 3.2;
      const back = tmp2.copy(fwd).negate().applyAxisAngle(new THREE.Vector3(0, 1, 0), lift.yaw);
      const want = new THREE.Vector3().copy(feet).addScaledVector(back, dist);
      want.x += -fwd.z * (tbar ? 1.2 : 2.5);
      want.z += fwd.x * (tbar ? 1.2 : 2.5);
      want.y = feet.y + up + lift.pitch * 4;
      const gy = L.terrain.height(want.x, want.z) + 1.2;
      if (want.y < gy) want.y = gy;
      const look = new THREE.Vector3().copy(feet).addScaledVector(fwd, tbar ? 6 : 8);
      look.y = feet.y + (tbar ? 1.1 : 0.8);
      if (!lift.cam) {
        lift.cam = want.clone();
        lift.look = look.clone();
      } else {
        lift.cam.lerp(want, 1 - Math.exp(-dt * 2.5));
        lift.look.lerp(look, 1 - Math.exp(-dt * 4));
      }
      camera.position.copy(lift.cam);
      camera.lookAt(lift.look);
      if (camera.fov !== 60) {
        camera.fov = 60;
        camera.updateProjectionMatrix();
      }
      L.world.update(L.time, feet, camera);
      renderer.render(L.world.scene, camera);
      input.endFrame();
      return;
    }

    // -------------------------------------------- simulation
    if (state === 'riding' || state === 'finish') {
      if (state === 'riding') {
        if (input.restartHeld() && !duelRun) {
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
        lastVy = r.vel.y;
        if (state === 'riding') {
          recorder.push(inp);
          run.step(inp);
          if (ghost) ghost.advance();
        }
        else run.coast(r.speed > 0.5 && r.mode === 'ground' ? coastInput : EMPTY_INPUT);
        acc -= DT;
        steps++;
        if (r.mode !== prevMode) {
          if (r.mode === 'air' || prevMode === 'air') touch.haptic(); // tick on every pop and landing
          if (r.mode === 'air') sfx.pop();
          else if (prevMode === 'air' && r.mode === 'crash') sfx.crash();
          else if (prevMode === 'air' && r.mode === 'ground') sfx.land(Math.abs(lastVy));
          else if (r.mode === 'rail') sfx.tick();
          else if (r.mode === 'crash') sfx.crash();
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
        else if (m.type === 'ring') sfx.ring(m.speed);
        else if (m.type === 'bump') sfx.thud(0.25, 140, 0.12);
        else {
          if (m.type === 'railTrick') sfx.tick();
          L.hud.message(m);
          if (live && m.type === 'trick' && m.name) live.sendTrick(m.name, m.points);
        }
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
    const pose = poseFor(r, { absorb, riding: state === 'riding' });
    if (state === 'finish') pose.look = 0;
    model.update(pose, dt);

    // Ghost: your best run on this park.
    if (ghost && state === 'riding' && !ghost.done) {
      const g = ghost.rider;
      placeRider(g, L.terrain, g.pos, g.q, ghostModel.root.position, ghostModel.root.quaternion);
      ghostModel.update(poseFor(g), dt);
      ghostModel.root.visible = true;
    } else ghostModel.root.visible = false;

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
    liveFrame(L, dt);
    renderer.render(L.world.scene, camera);
    input.endFrame();
  }

  // Boot: build Basecamp, warm its shaders, preload your last park, then wait
  // for a tap or key (needed to start sound) before showing Basecamp.
  state = 'boot';
  (async () => {
    loadingScreen.set(0.15, 'Loading models…');
    try {
      await loadAssets((p) => loadingScreen.set(0.15 + p * 0.1, 'Loading models…'));
      model.upgrade(ASSETS.parts);
      ghostModel.upgrade(ASSETS.parts);
      ghostModel.makeGhost();
      await preloadScenes(['hut']);
      basecampScene.setLodge(sceneCopy('hut'), modelBounds);
    } catch (e) {
      console.error('Models failed to load; using simple shapes', e);
    }
    loadingScreen.set(0.25, 'Warming up shaders…');
    await new Promise((r) => setTimeout(r, 0));
    placeModel(basecampScene.scene);
    renderer.compile(basecampScene.scene, camera);
    try {
      await loadPark(parkId, (p, s) => loadingScreen.set(0.3 + p * 0.65, s));
    } catch (e) {
      console.error(e); // the park loads again when picked
    }
    loadingScreen.ready(() => {
      startAudio();
      music.play();
      toBasecamp();
    });
  })();
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
    get lastReplay() {
      return lastReplay;
    },
    get live() {
      return live;
    },
    remotes,
    idle,
    get duel() {
      return duel;
    },
    party,
    get chat() {
      return { enabled: chatUI.enabled, open: chatUI.isOpen, topic: chat?.topic || null };
    },
    get lift() {
      return lift;
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
