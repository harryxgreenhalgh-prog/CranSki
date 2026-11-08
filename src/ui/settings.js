// Settings panel: Controls (rebinding), Graphics, Camera, Sound, Stats.
import { settings, saveSettings, resetSection } from '../settings.js';
import { BINDINGS } from '../input.js';

const $ = (id) => document.getElementById(id);

const KEY_LABELS = {
  left: 'Carve left / spin left',
  right: 'Carve right / spin right',
  tuck: 'Tuck / frontflip',
  brake: 'Brake / backflip',
  rollLeft: 'Roll left',
  rollRight: 'Roll right',
  up: 'Rodeo / misty modifier',
  pop: 'Pop (hold to load) / rail hop',
  grab1: 'Grab slot 1',
  grab2: 'Grab slot 2',
  grab3: 'Grab slot 3',
  butter: 'Butter',
  restart: 'Restart from the top (hold)',
  skipLift: 'Skip lift',
  pause: 'Pause / back',
  confirm: 'Confirm',
};

const PAD_LABELS = {
  pop: 'Pop / rail hop',
  up: 'Rodeo / misty modifier',
  grab1: 'Grab slot 1',
  grab2: 'Grab slot 2',
  grab3: 'Grab slot 3',
  tuck: 'Tuck / frontflip',
  tuckAlt: 'Tuck / frontflip (alt)',
  brake: 'Brake / backflip',
  butter: 'Butter',
  restart: 'Restart (hold)',
  skipLift: 'Skip lift',
  pause: 'Pause',
};

// Standard Gamepad button names (Xbox labels).
export const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L-stick', 'R-stick', 'D-up', 'D-down', 'D-left', 'D-right', 'Home'];

const NICE = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', ShiftLeft: 'Shift', ShiftRight: 'R Shift', ControlLeft: 'Ctrl', ControlRight: 'R Ctrl', AltLeft: 'Alt', AltRight: 'R Alt', Escape: 'Esc', Space: 'Space', Enter: 'Enter' };
function keyName(code) {
  if (!code) return '—';
  return NICE[code] || code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
}

// A controller drawn in SVG; buttons light up as you press them.
const PAD_SVG = `
<svg viewBox="0 0 200 120" class="padpic" aria-label="Controller">
  <path d="M40 30 Q100 18 160 30 Q190 36 194 80 Q196 108 172 106 Q156 104 146 84 L54 84 Q44 104 28 106 Q4 108 6 80 Q10 36 40 30 Z" fill="#1d2a40" stroke="#5a6f8e"/>
  <rect data-b="4" x="34" y="20" width="30" height="8" rx="4"/><rect data-b="5" x="136" y="20" width="30" height="8" rx="4"/>
  <rect data-b="6" x="36" y="6" width="24" height="12" rx="5"/><rect data-b="7" x="140" y="6" width="24" height="12" rx="5"/>
  <circle data-b="10" cx="58" cy="52" r="11"/><circle data-b="11" cx="124" cy="74" r="11"/>
  <rect data-b="12" x="70" y="62" width="8" height="9" rx="1"/><rect data-b="13" x="70" y="79" width="8" height="9" rx="1"/>
  <rect data-b="14" x="61" y="71" width="9" height="8" rx="1"/><rect data-b="15" x="78" y="71" width="9" height="8" rx="1"/>
  <circle data-b="0" cx="152" cy="62" r="7"/><circle data-b="1" cx="166" cy="49" r="7"/><circle data-b="2" cx="138" cy="49" r="7"/><circle data-b="3" cx="152" cy="36" r="7"/>
  <rect data-b="8" x="84" y="42" width="10" height="6" rx="3"/><rect data-b="9" x="106" y="42" width="10" height="6" rx="3"/>
  <circle data-b="16" cx="100" cy="30" r="5"/>
  <text x="152" y="65" font-size="7" text-anchor="middle">A</text><text x="166" y="52" font-size="7" text-anchor="middle">B</text>
  <text x="138" y="52" font-size="7" text-anchor="middle">X</text><text x="152" y="39" font-size="7" text-anchor="middle">Y</text>
</svg>`;

export class SettingsUI {
  constructor({ onClose, onTouchEditor }) {
    this.onClose = onClose;
    this.onTouchEditor = onTouchEditor;
    this.tab = 'controls';
    this.waitKey = null; // action waiting for a key
    this.waitPad = null; // action waiting for a pad button
    this.prevPad = [];
    $('settings-close').addEventListener('click', () => this.close());
    document.querySelectorAll('#settings .stabs button').forEach((b) => b.addEventListener('click', () => this.show(b.dataset.stab)));
    // Capture the next key for rebinding before the game sees it.
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.waitKey) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.code !== 'Escape') {
          // A key can only do one job: take it off any other action.
          for (const k of Object.keys(settings.keys)) settings.keys[k] = settings.keys[k].filter((c) => c !== e.code || k === this.waitKey);
          settings.keys[this.waitKey] = [e.code];
          saveSettings();
        }
        this.waitKey = null;
        this.render();
      },
      true
    );
  }

  get isOpen() {
    return !$('settings').classList.contains('hidden');
  }

  get capturing() {
    return !!(this.waitKey || this.waitPad);
  }

  open(tab) {
    $('settings').classList.remove('hidden');
    this.show(tab || this.tab);
  }

  close() {
    this.waitKey = this.waitPad = null;
    $('settings').classList.add('hidden');
    this.onClose();
  }

  show(tab) {
    this.tab = tab;
    document.querySelectorAll('#settings .stabs button').forEach((b) => b.classList.toggle('on', b.dataset.stab === tab));
    this.render();
  }

  render() {
    const body = $('settings-body');
    const t = this.tab;
    if (t === 'controls') body.innerHTML = this._controls();
    else if (t === 'graphics') body.innerHTML = this._graphics();
    else if (t === 'camera') body.innerHTML = this._camera();
    else if (t === 'sound') body.innerHTML = this._sound();
    else body.innerHTML = this._stats();
    this._wire(body);
  }

  _controls() {
    const keys = Object.keys(KEY_LABELS)
      .map((a) => {
        const waiting = this.waitKey === a;
        const cur = (BINDINGS.keyboard[a] || []).map(keyName).join(' / ');
        return `<tr><td>${KEY_LABELS[a]}</td><td><kbd>${waiting ? 'press a key…' : cur}</kbd></td><td><button class="btn sm" data-rebind-key="${a}">${waiting ? 'Cancel' : 'Rebind'}</button></td></tr>`;
      })
      .join('');
    const pad = Object.keys(PAD_LABELS)
      .map((a) => {
        const waiting = this.waitPad === a;
        const b = BINDINGS.gamepad[a];
        const cur = b === undefined || b < 0 ? '—' : PAD_NAMES[b] || `#${b}`;
        return `<tr><td>${PAD_LABELS[a]}</td><td><kbd>${waiting ? 'press a button…' : cur}</kbd></td><td><button class="btn sm" data-rebind-pad="${a}">${waiting ? 'Cancel' : 'Rebind'}</button></td></tr>`;
      })
      .join('');
    return `
      <div class="setgrid">
        <div>
          <h3>KEYBOARD</h3>
          <table class="bind">${keys}</table>
          <button class="btn sm" data-reset="keys">Reset keyboard</button>
        </div>
        <div>
          <h3>CONTROLLER</h3>
          ${PAD_SVG}
          <p class="muted">Press any button on your controller: it lights up here. Left stick carves and spins, right stick rolls.</p>
          <table class="bind">${pad}</table>
          <button class="btn sm" data-reset="pad">Reset controller</button>
          <h3>TOUCH</h3>
          <button class="btn sm" data-touch-editor>Edit touch layout</button>
        </div>
      </div>`;
  }

  _graphics() {
    const lv = (id, name, desc) =>
      `<label class="choice ${settings.graphics === id ? 'on' : ''}"><input type="radio" name="gfx" value="${id}" ${settings.graphics === id ? 'checked' : ''}/><b>${name}</b><span>${desc}</span></label>`;
    return `
      <h3>QUALITY</h3>
      ${lv('ultra', 'Ultra', 'Corduroy snow with fading ski tracks, fine snow spray, goggle reflections, sharp shadows, trees cast shadows, longest draw distance.')}
      ${lv('high', 'High', 'Grooming lines, reflections and shadows.')}
      ${lv('performance', 'Performance', 'No shadows, closer tree draw distance, lighter terrain, and dynamic resolution that drops to hold the frame rate. Best for Chromebooks and phones.')}
      <h3>FRAME CAP</h3>
      <label class="choice inline ${!settings.frameCap ? 'on' : ''}"><input type="radio" name="cap" value="0" ${!settings.frameCap ? 'checked' : ''}/><b>Uncapped</b></label>
      <label class="choice inline ${settings.frameCap === 30 ? 'on' : ''}"><input type="radio" name="cap" value="30" ${settings.frameCap === 30 ? 'checked' : ''}/><b>30 fps</b></label>
      <p class="muted">Quality changes rebuild the park scene when you close Settings.</p>`;
  }

  _camera() {
    const c = settings.camera;
    const slider = (k, label, min, max, step, unit = '') =>
      `<label class="slider"><span>${label}</span><input type="range" data-cam="${k}" min="${min}" max="${max}" step="${step}" value="${c[k]}"/><output>${c[k]}${unit}</output></label>`;
    return `
      <label class="check"><input type="checkbox" data-camcheck="speedFov" ${c.speedFov ? 'checked' : ''}/> Widen the view with speed</label>
      ${slider('fov', 'Field of view', 50, 95, 1, '°')}
      ${slider('stiffness', 'Stiffness', 0.4, 2.5, 0.1)}
      ${slider('tilt', 'Tilt', -10, 25, 1, '°')}
      ${slider('distance', 'Distance', 3, 12, 0.1, ' m')}
      ${slider('height', 'Height', 0.8, 5, 0.1, ' m')}
      ${slider('angle', 'Angle', -40, 40, 1, '°')}
      <label class="check"><input type="checkbox" data-camcheck="firstPerson" ${c.firstPerson ? 'checked' : ''}/> First person (helmet cam: flips turn the whole view)</label>
      <button class="btn sm" data-reset="camera">Reset camera</button>`;
  }

  _sound() {
    const s = settings.sound;
    const slider = (k, label) => `<label class="slider"><span>${label}</span><input type="range" data-snd="${k}" min="0" max="100" step="1" value="${s[k]}"/><output>${s[k]}</output></label>`;
    return `${slider('music', 'Music volume')}${slider('effects', 'Effects volume')}`;
  }

  _stats() {
    const o = (id, name, desc) =>
      `<label class="choice ${settings.stats === id ? 'on' : ''}"><input type="radio" name="stats" value="${id}" ${settings.stats === id ? 'checked' : ''}/><b>${name}</b><span>${desc}</span></label>`;
    return `${o('off', 'Off', 'No overlay.')}${o('basic', 'FPS and ping', 'Frames per second and network ping (solo play has no network).')}${o('detailed', 'Detailed panel', 'Frame time, 1% lows, network, draw calls, triangles and GPU.')}`;
  }

  _wire(body) {
    body.querySelectorAll('[data-rebind-key]').forEach((b) =>
      b.addEventListener('click', () => {
        const a = b.dataset.rebindKey;
        this.waitKey = this.waitKey === a ? null : a;
        this.waitPad = null;
        this.render();
      })
    );
    body.querySelectorAll('[data-rebind-pad]').forEach((b) =>
      b.addEventListener('click', () => {
        const a = b.dataset.rebindPad;
        this.waitPad = this.waitPad === a ? null : a;
        this.waitKey = null;
        this.render();
      })
    );
    body.querySelectorAll('[data-reset]').forEach((b) =>
      b.addEventListener('click', () => {
        resetSection(b.dataset.reset);
        this.render();
      })
    );
    body.querySelector('[data-touch-editor]')?.addEventListener('click', () => this.onTouchEditor());
    body.querySelectorAll('input[name=gfx]').forEach((i) =>
      i.addEventListener('change', () => {
        settings.graphics = i.value;
        saveSettings();
        this.render();
      })
    );
    body.querySelectorAll('input[name=cap]').forEach((i) =>
      i.addEventListener('change', () => {
        settings.frameCap = Number(i.value);
        saveSettings();
        this.render();
      })
    );
    body.querySelectorAll('input[name=stats]').forEach((i) =>
      i.addEventListener('change', () => {
        settings.stats = i.value;
        saveSettings();
        this.render();
      })
    );
    body.querySelectorAll('[data-cam]').forEach((i) =>
      i.addEventListener('input', () => {
        settings.camera[i.dataset.cam] = Number(i.value);
        i.nextElementSibling.textContent = i.value;
        saveSettings();
      })
    );
    body.querySelectorAll('[data-camcheck]').forEach((i) =>
      i.addEventListener('change', () => {
        settings.camera[i.dataset.camcheck] = i.checked;
        saveSettings();
      })
    );
    body.querySelectorAll('[data-snd]').forEach((i) =>
      i.addEventListener('input', () => {
        settings.sound[i.dataset.snd] = Number(i.value);
        i.nextElementSibling.textContent = i.value;
        saveSettings();
      })
    );
  }

  // Called every frame while open: light up pad buttons and catch pad rebinding.
  tick(pad) {
    if (!this.isOpen || this.tab !== 'controls') return;
    const pressed = pad ? pad.buttons.map((b) => b.pressed) : [];
    document.querySelectorAll('#settings .padpic [data-b]').forEach((el) => el.classList.toggle('lit', !!pressed[Number(el.dataset.b)]));
    if (this.waitPad && pad) {
      const i = pressed.findIndex((p, k) => p && !this.prevPad[k]);
      if (i >= 0) {
        for (const k of Object.keys(settings.pad)) if (settings.pad[k] === i && k !== this.waitPad) settings.pad[k] = -1;
        settings.pad[this.waitPad] = i;
        saveSettings();
        this.waitPad = null;
        this.render();
      }
    }
    this.prevPad = pressed;
  }
}

// Stats overlay: FPS and ping, or a detailed panel.
export class StatsOverlay {
  constructor(renderer) {
    this.renderer = renderer;
    this.el = $('stats');
    this.frames = [];
    this.acc = 0;
    this.gpu = '';
    try {
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      this.gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    } catch {
      this.gpu = 'unknown';
    }
  }

  update(dt) {
    const mode = settings.stats;
    this.el.classList.toggle('hidden', mode === 'off');
    if (mode === 'off') return;
    this.frames.push(dt);
    if (this.frames.length > 300) this.frames.shift();
    this.acc += dt;
    if (this.acc < 0.25) return;
    this.acc = 0;
    const avg = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
    const fps = 1 / avg;
    let html = `<b>${fps.toFixed(0)}</b> FPS · ping — (solo)`;
    if (mode === 'detailed') {
      const sorted = [...this.frames].sort((a, b) => b - a);
      const worst = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.01)));
      const low = 1 / (worst.reduce((a, b) => a + b, 0) / worst.length);
      const info = this.renderer.info.render;
      const pr = this.renderer.getPixelRatio();
      html += `<br>Frame ${(avg * 1000).toFixed(1)} ms · 1% low ${low.toFixed(0)} FPS<br>Network: offline (solo)<br>Draw calls ${info.calls} · triangles ${(info.triangles / 1000).toFixed(0)}k<br>Resolution ×${pr.toFixed(2)}<br>GPU: ${this.gpu}`;
    }
    this.el.innerHTML = html;
  }
}
