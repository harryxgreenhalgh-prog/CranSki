// Idle rules for live rooms (DESIGN.md, Fair-play rules): 1 minute paused,
// 2 minutes with no input, or 10 minutes in an untouched replay sends you back
// to Basecamp after a countdown, so idle riders don't hold room places.
// Solo is never timed out.

export const IDLE_LIMITS = { paused: 60, input: 120, replay: 600 }; // seconds
export const COUNTDOWN = 10;

// Which rule applies, if any. state: the game state; idle: seconds since the
// last input (or since pausing, whichever is later).
export function idleReason(state, idle) {
  if (state === 'paused') return idle >= IDLE_LIMITS.paused ? 'paused' : null;
  if (state === 'replay') return idle >= IDLE_LIMITS.replay ? 'replay' : null;
  return idle >= IDLE_LIMITS.input ? 'input' : null;
}

const WHY = {
  paused: "You've been paused for a minute.",
  input: 'No input for 2 minutes.',
  replay: 'This replay has been untouched for 10 minutes.',
};

const $ = (id) => document.getElementById(id);

export class IdleWatch {
  constructor({ onTimeout }) {
    this.onTimeout = onTimeout;
    this.last = performance.now();
    this.counting = null; // { reason, left }
    this.lastState = null;
    this.padSeen = '';
    const poke = () => this.activity();
    for (const ev of ['keydown', 'pointerdown', 'wheel', 'touchstart']) window.addEventListener(ev, poke, { passive: true, capture: true });
    let lastMove = 0;
    window.addEventListener(
      'pointermove',
      () => {
        const t = performance.now();
        if (t - lastMove > 500) {
          lastMove = t;
          poke();
        }
      },
      { passive: true }
    );
    $('idle-stay').addEventListener('click', poke);
  }

  activity() {
    this.last = performance.now();
    if (this.counting) {
      this.counting = null;
      $('idlecard').classList.add('hidden');
    }
  }

  // Gamepads don't send events: any held button or tilted stick counts.
  _pollPads() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let sig = '';
    for (const p of pads) {
      if (!p) continue;
      p.buttons.forEach((b, i) => {
        if (b.pressed) sig += 'b' + i;
      });
      p.axes.forEach((a, i) => {
        if (Math.abs(a) > 0.35) sig += 'a' + i + (a > 0 ? '+' : '-');
      });
    }
    if (sig && sig !== this.padSeen) this.activity();
    this.padSeen = sig;
  }

  // active: in a live room (solo never times out).
  update(dt, { active, state }) {
    if (!active) {
      this.last = performance.now();
      if (this.counting) this.activity();
      this.lastState = state;
      return;
    }
    // Pausing starts the paused clock afresh.
    if (state !== this.lastState) {
      if (state === 'paused' || this.lastState === 'paused') this.last = performance.now();
      this.lastState = state;
    }
    this._pollPads();
    const idle = (performance.now() - this.last) / 1000;
    if (!this.counting) {
      const reason = idleReason(state, idle);
      if (!reason) return;
      this.counting = { reason, until: performance.now() + COUNTDOWN * 1000 };
      $('idle-why').textContent = WHY[reason];
      $('idlecard').classList.remove('hidden');
    }
    // Counted on the wall clock, so a slow device still gets 10 real seconds.
    const left = (this.counting.until - performance.now()) / 1000;
    $('idle-count').textContent = Math.max(0, Math.ceil(left));
    if (left <= 0) {
      const reason = this.counting.reason;
      this.counting = null;
      $('idlecard').classList.add('hidden');
      this.last = performance.now();
      this.onTimeout(reason);
    }
  }
}
