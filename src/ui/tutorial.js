// First-time tutorial on BIG AIR: pop, spin, grab, land clean.
//
// It only watches the run (the simulation is untouched, so replays and score
// checks work as normal) and shows one prompt at a time in the corner, with the
// buttons for whatever the player is using: keyboard, controller or touch. Each
// step ticks off the moment it's done; after every landing it says what went
// right or wrong and sends the rider back to the top until all four are done.
import { BINDINGS } from '../input.js';
import { keyName, PAD_NAMES } from './keynames.js';

const STEPS = [
  { id: 'pop', label: 'POP' },
  { id: 'spin', label: 'SPIN' },
  { id: 'grab', label: 'GRAB' },
  { id: 'land', label: 'LAND CLEAN' },
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Button pictures, from the player's own bindings.
const kb = (action) => {
  const code = (BINDINGS.keyboard[action] || [])[0];
  return code ? `<kbd class="tk">${esc(keyName(code))}</kbd>` : '';
};
const pad = (action) => {
  const i = BINDINGS.gamepad[action];
  const name = i >= 0 ? PAD_NAMES[i] || `#${i}` : '?';
  return `<span class="pb pb-${esc(name)}">${esc(name)}</span>`;
};
const stick = '<span class="pb pb-stick">left stick</span>';
const tb = (label) => `<span class="tb">${esc(label)}</span>`;

// Each prompt: words per device, and which touch controls to light up.
const PROMPTS = {
  speed: {
    keyboard: () => `Hold ${kb('tuck')} to tuck and pick up speed`,
    pad: () => `Hold ${pad('tuck')} to tuck and pick up speed`,
    touch: () => `Push the ${tb('stick')} up to tuck and pick up speed`,
    touchIds: ['stick'],
  },
  pop: {
    keyboard: () => `Hold ${kb('pop')} to crouch, then let go at the lip to pop`,
    pad: () => `Hold ${pad('pop')} to crouch, then let go at the lip to pop`,
    touch: () => `Hold ${tb('POP')} to crouch, then let go at the lip to pop`,
    touchIds: ['pop'],
  },
  popHold: {
    keyboard: () => `Keep holding ${kb('pop')}… let go at the lip!`,
    pad: () => `Keep holding ${pad('pop')}… let go at the lip!`,
    touch: () => `Keep holding ${tb('POP')}… let go at the lip!`,
    touchIds: ['pop'],
  },
  popNow: {
    keyboard: () => `LET GO OF ${kb('pop')} NOW!`,
    pad: () => `LET GO OF ${pad('pop')} NOW!`,
    touch: () => `LET GO OF ${tb('POP')} NOW!`,
    touchIds: ['pop'],
    urgent: true,
  },
  spin: {
    keyboard: () => `Hold ${kb('left')} or ${kb('right')} to spin. Let go after a full turn`,
    pad: () => `Push the ${stick} left or right to spin. Let go after a full turn`,
    touch: () => `Push the ${tb('stick')} left or right to spin. Let go after a full turn`,
    touchIds: ['stick'],
  },
  settle: {
    all: () => 'Nice spin! Now let go and wait for it to slow down…',
    touchIds: [],
  },
  grab: {
    keyboard: () => `Hold ${kb('grab1')} to grab your skis`,
    pad: () => `Hold ${pad('grab1')} to grab your skis`,
    touch: () => `Hold ${tb('GRAB')} to grab your skis`,
    touchIds: ['grab'],
  },
  land: {
    all: () => 'Let go of everything before you land, with your skis pointing down the hill',
    touchIds: [],
  },
  letGo: {
    all: () => 'LET GO OF EVERYTHING!',
    touchIds: [],
    urgent: true,
  },
};

// Why a landing went wrong, in plain words.
const CRASH = {
  'held into the snow': 'You were still holding a button when you landed. Let go of everything before touchdown.',
  'over-rotated': 'Too much rotation. Let go of the spin a little sooner.',
  'head first': 'Head first! Let go of the spin and flip sooner so you land on your skis.',
  faceplant: 'Faceplant. Let go of everything before you land.',
  'too deep': 'Tipped too far. Let go of everything before you land.',
};

export class Tutorial {
  // root: the #tutorial element. onDone: all four steps ticked. onSkip: Skip
  // pressed. onBasecamp: Basecamp pressed on the finished card.
  constructor(root, { onDone, onSkip, onBasecamp }) {
    this.root = root;
    this.onDone = onDone;
    root.innerHTML = `
      <div class="tut-card" role="status" aria-live="polite">
        <div class="tut-head"><span>TUTORIAL · BIG AIR</span><button type="button" class="tut-skip">Skip</button></div>
        <ol class="tut-steps">${STEPS.map((s) => `<li data-step="${s.id}"><i></i>${s.label}</li>`).join('')}</ol>
        <div class="tut-prompt"></div>
        <div class="tut-note"></div>
      </div>
      <div class="tut-done hidden" role="dialog" aria-label="Tutorial complete">
        <b>TUTORIAL COMPLETE</b>
        <p>You can pop, spin, grab and land clean. Ride on to the finish, or head back to Basecamp to pick a park.</p>
        <div><button type="button" class="btn primary" data-tut="ride">Keep riding</button><button type="button" class="btn" data-tut="basecamp">Basecamp</button></div>
      </div>`;
    this.el = {
      card: root.querySelector('.tut-card'),
      prompt: root.querySelector('.tut-prompt'),
      note: root.querySelector('.tut-note'),
      done: root.querySelector('.tut-done'),
      steps: Object.fromEntries(STEPS.map((s) => [s.id, root.querySelector(`[data-step="${s.id}"]`)])),
    };
    root.querySelector('.tut-skip').addEventListener('click', () => onSkip());
    root.querySelector('[data-tut="ride"]').addEventListener('click', () => this.closeDone());
    root.querySelector('[data-tut="basecamp"]').addEventListener('click', () => onBasecamp());
    this.active = false;
    this.finished = false;
    this.touchIds = [];
    this._shown = '';
  }

  start() {
    this.active = true;
    this.finished = false;
    this.done = { pop: false, spin: false, grab: false, land: false };
    for (const s of STEPS) this.el.steps[s.id].classList.remove('ok', 'flash');
    this.el.done.classList.add('hidden');
    this.el.card.classList.remove('hidden');
    this.newRun();
  }

  stop() {
    this.active = false;
    this.touchIds = [];
    this.root.classList.add('hidden');
  }

  // Show or hide with the riding view (hidden while paused or in menus).
  show(on) {
    this.root.classList.toggle('hidden', !on || !this.active);
  }

  // A fresh run from the top.
  newRun() {
    this.clock = 0;
    this.load = 0;
    this.wasPop = false;
    this.releasedAt = -9;
    this.restartIn = 0;
    this.feedback = null;
    this.jump = null;
    this.doneTimer = 0;
  }

  closeDone() {
    this.el.done.classList.add('hidden');
    this.stop();
  }

  _tick(id) {
    if (this.done[id]) return;
    this.done[id] = true;
    const li = this.el.steps[id];
    li.classList.add('ok', 'flash');
    setTimeout(() => li.classList.remove('flash'), 900);
  }

  // Once per frame while riding. msgs: the run's messages from this frame.
  // device: 'keyboard' | 'pad' | 'touch'. Returns 'restart' when it's time to
  // send the rider back to the top.
  update(dt, run, inp, device, msgs) {
    if (!this.active) return null;
    const r = run.rider;
    const T = run.terrain;
    const lipS = T.park.profileKicker?.lipS ?? 284;
    const s = -r.pos.z;

    if (this.finished) {
      // The finished card stays a while, then gets out of the way.
      this.doneTimer += dt;
      if (this.doneTimer > 10) this.closeDone();
      this.touchIds = [];
      return null;
    }

    // Pop: Space (or A, or POP) held to load, then let go just before take-off.
    // (A slow frame can hold both the release and the take-off, so the release
    // counts whatever the rider is doing.)
    this.clock += dt;
    if (inp?.pop) {
      if (r.mode === 'ground') this.load = Math.max(this.load, r.load);
    } else if (this.wasPop) this.releasedAt = this.clock;
    else if (r.mode === 'ground' && this.clock - this.releasedAt > 0.8) this.load = 0;
    this.wasPop = !!inp?.pop;

    // Steps done in the air tick off straight away.
    if (r.mode !== 'air') this.jump = null;
    else if (r.air) {
      const a = r.air;
      if (!this.jump) {
        const popped = this.load >= 0.2 && this.clock - this.releasedAt < 0.8;
        this.jump = { s, spin: false, grab: false, popped };
        this.load = 0;
      }
      const offKicker = this.jump.s >= lipS - 30;
      if (this.jump.popped && offKicker) this._tick('pop');
      if (Math.abs(a.spin) >= 170) {
        this.jump.spin = true;
        this._tick('spin');
      }
      if (Object.values(a.grabTimes).some((t) => t >= 0.25)) {
        this.jump.grab = true;
        this._tick('grab');
      }
    }

    // Landings off the kicker (little hops on the way down don't count).
    for (const m of msgs) {
      if (s < lipS - 2 || this.feedback) continue;
      if (m.type === 'crash') this._landed('crash', m.reason);
      else if (m.type === 'trick') this._landed(m.quality, '');
    }
    // Rode away without a judged landing (a tiny hop off the lip): go again.
    if (!this.feedback && r.mode === 'ground' && s > lipS + 25) {
      this.feedback = { good: false, text: 'Missed it! Ride straight at the kicker and pop at the lip.' };
      this.restartIn = 3.2;
    }
    if (this.feedback && !this.restartIn && Object.values(this.done).every(Boolean)) {
      this.finished = true;
      this.el.card.classList.add('hidden');
      this.el.done.classList.remove('hidden');
      this.touchIds = [];
      this.onDone();
      return null;
    }

    let key = null; // null: show how the last landing went
    if (this.feedback) key = null;
    else if (r.mode === 'air') {
      const held = inp && (inp.steer || inp.tuck || inp.brake || inp.roll || inp.grab.some(Boolean));
      const gap = r.pos.y - T.height(r.pos.x, r.pos.z);
      const soon = r.vel.y < 0 && gap / -r.vel.y < 0.8;
      // A grab keeps you turning, so it waits until a spin has slowed down.
      const spinning = Math.abs(r.omega.y) > 90;
      if (soon && held) key = 'letGo';
      else if (!this.done.spin && !this.jump.spin) key = 'spin';
      else if (!this.done.grab && !this.jump.grab) key = spinning && !inp?.grab.some(Boolean) ? 'settle' : 'grab';
      else key = 'land';
    } else if (s < 130) key = 'speed';
    else if (s < lipS + 2) key = inp?.pop ? (s > lipS - 22 ? 'popNow' : 'popHold') : 'pop';
    else key = 'land';

    if (this.restartIn > 0) {
      this.restartIn -= dt;
      if (this.restartIn <= 0) return 'restart';
    }
    this._render(key, device);
    return null;
  }

  _landed(quality, reason) {
    let good = false;
    let text;
    if (quality === 'clean') {
      good = true;
      text = 'Clean landing!';
      this._tick('land');
    } else if (quality === 'crash') text = CRASH[reason] || 'Crashed! Let go of everything before you land.';
    else if (quality === 'sideways') text = 'Sideways landing. Stop the spin with your skis pointing down the hill.';
    else text = 'Saved it! Next time stop the spin with your skis pointing down the hill.';
    this.feedback = { good, text };
    if (!Object.values(this.done).every(Boolean)) this.restartIn = 3.2;
  }

  // key: a prompt, or null to show how the last landing went.
  _render(key, device) {
    let html;
    let note = '';
    let urgent = false;
    if (key) {
      const P = PROMPTS[key];
      html = P.all ? P.all() : (P[device] || P.keyboard)();
      urgent = !!P.urgent;
      this.touchIds = device === 'touch' ? P.touchIds : [];
    } else {
      html = esc(this.feedback.text);
      const left = STEPS.filter((x) => !this.done[x.id]).map((x) => x.label);
      if (left.length) note = `Still to do: ${left.join(', ')}. Back to the top in ${Math.max(1, Math.ceil(this.restartIn))}…`;
      this.touchIds = [];
    }
    const sig = `${key}|${device}|${html}|${note}`;
    if (sig === this._shown) return;
    this._shown = sig;
    this.el.prompt.innerHTML = html;
    this.el.prompt.classList.toggle('urgent', urgent);
    this.el.prompt.classList.toggle('good', !key && !!this.feedback?.good);
    this.el.prompt.classList.toggle('bad', !key && !this.feedback?.good);
    this.el.note.textContent = note;
  }
}
