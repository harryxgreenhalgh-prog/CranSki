// Keyboard + Gamepad input mapped to abstract actions. Every binding lives in BINDINGS
// so it can be rebound (a Settings screen for this arrives in Phase 2).

export const BINDINGS = {
  keyboard: {
    left: ['KeyA'],
    right: ['KeyD'],
    tuck: ['KeyW'], // tuck on snow, frontflip in the air
    brake: ['KeyS'], // brake on snow, backflip in the air
    rollLeft: ['ArrowLeft'],
    rollRight: ['ArrowRight'],
    up: ['ArrowUp'], // rodeo / misty modifier
    pop: ['Space'],
    grab1: ['ShiftLeft', 'ShiftRight'], // Mute
    grab2: ['KeyQ'], // Tail
    grab3: ['KeyE'], // Japan
    restart: ['KeyR'],
    pause: ['Escape', 'KeyP'],
    confirm: ['Enter'],
  },
  // Standard Gamepad mapping (Xbox labels).
  gamepad: {
    pop: 0, // A
    up: 1, // B
    grab2: 2, // X
    grab3: 3, // Y
    grab1: 4, // LB
    tuckAlt: 5, // RB
    brake: 6, // LT
    tuck: 7, // RT
    restart: 8, // View
    pause: 9, // Menu
  },
};

const GAME_KEYS = new Set(Object.values(BINDINGS.keyboard).flat());

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this.pressed = new Set(); // keys pressed since last poll (for menus)
    this.padIndex = null;
    this.prevPadButtons = [];
    this.padPressed = new Set();

    target.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('gamepadconnected', (e) => {
      // Browsers only expose a pad after its first button press.
      if (this.padIndex === null) this.padIndex = e.gamepad.index;
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.padIndex === e.gamepad.index) this.padIndex = null;
    });
  }

  key(action) {
    return BINDINGS.keyboard[action].some((c) => this.down.has(c));
  }

  wasPressed(action) {
    const kb = BINDINGS.keyboard[action]?.some((c) => this.pressed.has(c));
    const pad = this.padPressed.has(action);
    return kb || pad;
  }

  _pad() {
    if (this.padIndex === null || !navigator.getGamepads) return null;
    const p = navigator.getGamepads()[this.padIndex];
    return p && p.connected ? p : null;
  }

  // Call once per rendered frame, before reading wasPressed().
  pollFrame() {
    this.padPressed.clear();
    const pad = this._pad();
    if (!pad) return;
    const b = pad.buttons.map((x) => x.pressed);
    for (const [action, idx] of Object.entries(BINDINGS.gamepad)) {
      if (b[idx] && !this.prevPadButtons[idx]) this.padPressed.add(action);
    }
    if (b[0] && !this.prevPadButtons[0]) this.padPressed.add('confirm');
    this.prevPadButtons = b;
  }

  // Clear one-shot presses after the frame has used them.
  endFrame() {
    this.pressed.clear();
  }

  // Snapshot of the rider controls for one simulation step.
  sample() {
    let steer = (this.key('right') ? 1 : 0) - (this.key('left') ? 1 : 0);
    let roll = (this.key('rollRight') ? 1 : 0) - (this.key('rollLeft') ? 1 : 0);
    let tuck = this.key('tuck');
    let brake = this.key('brake');
    let up = this.key('up');
    let pop = this.key('pop');
    const grab = [this.key('grab1'), this.key('grab2'), this.key('grab3')];

    const pad = this._pad();
    if (pad) {
      const G = BINDINGS.gamepad;
      const btn = (i) => !!pad.buttons[i] && pad.buttons[i].value > 0.4;
      const dz = (v) => (Math.abs(v) < 0.3 ? 0 : v);
      const lx = dz(pad.axes[0] || 0);
      const ly = dz(pad.axes[1] || 0);
      const rx = dz(pad.axes[2] || 0);
      if (lx) steer = Math.sign(lx); // digital, so tricks read the same as keyboard
      if (ly < -0.6) tuck = true;
      if (ly > 0.6) brake = true;
      if (rx) roll = Math.sign(rx);
      tuck = tuck || btn(G.tuck) || btn(G.tuckAlt);
      brake = brake || btn(G.brake);
      up = up || btn(G.up);
      pop = pop || btn(G.pop);
      grab[0] = grab[0] || btn(G.grab1);
      grab[1] = grab[1] || btn(G.grab2);
      grab[2] = grab[2] || btn(G.grab3);
    }
    return { steer, tuck, brake, roll, up, pop, grab };
  }

  restartHeld() {
    if (this.key('restart')) return true;
    const pad = this._pad();
    return !!(pad && pad.buttons[BINDINGS.gamepad.restart]?.pressed);
  }
}
