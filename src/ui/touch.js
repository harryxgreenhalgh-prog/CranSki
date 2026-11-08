// Touch controls for phones and tablets, plus the layout editor.
//
// Left thumb: a floating (or fixed) stick for carve, tuck, spin and flip.
// Right thumb: POP (hold to load), GRAB, TAIL, JAPAN, BUTTER, RODEO, MISTY, ROLL.
// Sliding from one button to another without lifting presses the new one.
import { settings, saveSettings } from '../settings.js';

const $ = (id) => document.getElementById(id);

export const BUTTONS = [
  { id: 'pop', label: 'POP', big: true },
  { id: 'grab', label: 'GRAB' },
  { id: 'tail', label: 'TAIL' },
  { id: 'japan', label: 'JAPAN' },
  { id: 'butter', label: 'BUTTER' },
  { id: 'rodeo', label: 'RODEO' },
  { id: 'misty', label: 'MISTY' },
  { id: 'roll', label: 'ROLL' },
];

// Default layout, positions in % of the screen (button centres).
export function defaultLayout() {
  return {
    size: 'm',
    opacity: 0.75,
    mirror: false,
    stick: { mode: 'follow', x: 16, y: 72 },
    buttons: {
      pop: { x: 86, y: 74, s: 1, hidden: false },
      grab: { x: 74, y: 84, s: 1, hidden: false },
      tail: { x: 72, y: 68, s: 1, hidden: false },
      japan: { x: 78, y: 54, s: 1, hidden: false },
      butter: { x: 92, y: 50, s: 1, hidden: false },
      rodeo: { x: 62, y: 80, s: 1, hidden: false },
      misty: { x: 62, y: 62, s: 1, hidden: false },
      roll: { x: 88, y: 34, s: 1, hidden: false },
    },
  };
}

const SIZE = { s: 52, m: 64, l: 80 };

export function touchSettings() {
  if (!settings.touch || !Array.isArray(settings.touch.layouts)) {
    settings.touch = { mode: 'auto', active: 0, layouts: [defaultLayout(), defaultLayout(), defaultLayout()] };
  }
  return settings.touch;
}

export function activeLayout() {
  const t = touchSettings();
  return t.layouts[t.active] || (t.layouts[t.active] = defaultLayout());
}

export function isTouchDevice() {
  const t = touchSettings();
  if (t.mode === 'on') return true;
  if (t.mode === 'off') return false;
  return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}

// Screen position of a layout item (mirrored for left-handed play).
function place(L, x, y) {
  return { x: (L.mirror ? 100 - x : x) / 100, y: y / 100 };
}

export class TouchControls {
  constructor({ onPause }) {
    this.root = $('touch');
    this.onPause = onPause;
    this.pressed = new Set();
    this.pointers = new Map(); // pointerId -> { kind: 'stick'|'button', id, ox, oy }
    this.stick = { x: 0, y: 0, active: false, cx: 0, cy: 0 };
    this.enabled = false;
    this.root.addEventListener('pointerdown', (e) => this._down(e));
    this.root.addEventListener('pointermove', (e) => this._move(e));
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) this.root.addEventListener(ev, (e) => this._up(e));
    $('touch-pause').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.onPause();
    });
    this.build();
  }

  build() {
    const L = activeLayout();
    const size = SIZE[L.size] || SIZE.m;
    this.root.querySelectorAll('.tbtn').forEach((b) => b.remove());
    this.els = {};
    for (const b of BUTTONS) {
      const conf = L.buttons[b.id];
      const el = document.createElement('div');
      el.className = 'tbtn' + (b.big ? ' big' : '');
      el.textContent = b.label;
      const d = size * conf.s * (b.big ? 1.3 : 1);
      const p = place(L, conf.x, conf.y);
      Object.assign(el.style, { width: `${d}px`, height: `${d}px`, left: `calc(${p.x * 100}% - ${d / 2}px)`, top: `calc(${p.y * 100}% - ${d / 2}px)`, opacity: L.opacity, display: conf.hidden ? 'none' : '' });
      this.root.appendChild(el);
      this.els[b.id] = { el, r: d / 2, conf, p };
    }
    const sb = $('stick-base');
    sb.style.opacity = L.opacity;
    this._placeStickHome();
  }

  _placeStickHome() {
    const L = activeLayout();
    const p = place(L, L.stick.x, L.stick.y);
    this.stick.cx = p.x * innerWidth;
    this.stick.cy = p.y * innerHeight;
    this._drawStick();
  }

  show(on) {
    this.enabled = on;
    this.root.classList.toggle('hidden', !on);
    if (!on) this._releaseAll();
  }

  _hit(x, y) {
    for (const [id, b] of Object.entries(this.els)) {
      if (b.conf.hidden) continue;
      const cx = b.p.x * innerWidth;
      const cy = b.p.y * innerHeight;
      if (Math.hypot(x - cx, y - cy) <= b.r * 1.08) return id;
    }
    return null;
  }

  _down(e) {
    if (!this.enabled) return;
    e.preventDefault();
    const L = activeLayout();
    const id = this._hit(e.clientX, e.clientY);
    if (id) {
      this.pointers.set(e.pointerId, { kind: 'button', id });
      this._press(id, true);
      return;
    }
    const leftSide = L.mirror ? e.clientX > innerWidth * 0.5 : e.clientX < innerWidth * 0.5;
    if (leftSide && !this.stick.active) {
      this.pointers.set(e.pointerId, { kind: 'stick' });
      this.stick.active = true;
      if (L.stick.mode === 'follow') {
        this.stick.cx = e.clientX;
        this.stick.cy = e.clientY;
      }
      this._stickTo(e.clientX, e.clientY);
    }
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (p.kind === 'stick') this._stickTo(e.clientX, e.clientY);
    else {
      // Sliding onto another button presses it instead.
      const id = this._hit(e.clientX, e.clientY);
      if (id && id !== p.id) {
        this._press(p.id, false);
        p.id = id;
        this._press(id, true);
      }
    }
  }

  _up(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (p.kind === 'stick') {
      this.stick.active = false;
      this.stick.x = this.stick.y = 0;
      if (activeLayout().stick.mode === 'follow') this._placeStickHome();
      this._drawStick();
    } else this._press(p.id, false);
  }

  _releaseAll() {
    for (const id of [...this.pressed]) this._press(id, false);
    this.pointers.clear();
    this.stick.active = false;
    this.stick.x = this.stick.y = 0;
  }

  _press(id, on) {
    if (on) this.pressed.add(id);
    else this.pressed.delete(id);
    this.els[id]?.el.classList.toggle('on', on);
  }

  _stickTo(x, y) {
    const R = 60;
    let dx = x - this.stick.cx;
    let dy = y - this.stick.cy;
    const l = Math.hypot(dx, dy);
    if (l > R) {
      dx *= R / l;
      dy *= R / l;
    }
    this.stick.x = dx / R;
    this.stick.y = dy / R;
    this._drawStick();
  }

  _drawStick() {
    const base = $('stick-base');
    const knob = $('stick-knob');
    base.style.left = `${this.stick.cx - 70}px`;
    base.style.top = `${this.stick.cy - 70}px`;
    knob.style.transform = `translate(${this.stick.x * 60}px, ${this.stick.y * 60}px)`;
  }

  // Merge into the rider input for this step.
  apply(inp) {
    if (!this.enabled) return inp;
    const s = this.stick;
    const P = this.pressed;
    if (Math.abs(s.x) > 0.35) inp.steer = Math.sign(s.x);
    if (s.y < -0.45 || P.has('misty')) inp.tuck = true;
    if (s.y > 0.45 || P.has('rodeo')) inp.brake = true;
    if (P.has('rodeo') || P.has('misty')) inp.up = true;
    if (P.has('roll')) inp.roll = s.x < -0.35 ? -1 : 1;
    if (P.has('pop')) inp.pop = true;
    if (P.has('grab')) inp.grab[0] = true;
    if (P.has('tail')) inp.grab[1] = true;
    if (P.has('japan')) inp.grab[2] = true;
    if (P.has('butter')) inp.butter = true;
    return inp;
  }

  // Haptic tick on every pop and landing.
  haptic(ms = 12) {
    if (this.enabled && navigator.vibrate) navigator.vibrate(ms);
  }
}

// ------------------------------------------------------------------ editor
export class TouchEditor {
  constructor({ onDone }) {
    this.onDone = onDone;
    this.root = $('touch-editor');
    this.sel = null;
    this.drag = null;
    this.root.addEventListener('pointerdown', (e) => this._down(e));
    this.root.addEventListener('pointermove', (e) => this._move(e));
    this.root.addEventListener('pointerup', () => (this.drag = null));
    this.root.addEventListener('pointercancel', () => (this.drag = null));
  }

  open() {
    this.root.classList.remove('hidden');
    this.render();
  }

  close() {
    this.root.classList.add('hidden');
    saveSettings();
    this.onDone();
  }

  get isOpen() {
    return !this.root.classList.contains('hidden');
  }

  render() {
    const t = touchSettings();
    const L = activeLayout();
    const size = SIZE[L.size] || SIZE.m;
    const items = BUTTONS.map((b) => {
      const c = L.buttons[b.id];
      const d = size * c.s * (b.big ? 1.3 : 1);
      const p = place(L, c.x, c.y);
      return `<div class="tbtn ed ${this.sel === b.id ? 'sel' : ''} ${c.hidden ? 'ghost' : ''}" data-id="${b.id}" style="width:${d}px;height:${d}px;left:calc(${p.x * 100}% - ${d / 2}px);top:calc(${p.y * 100}% - ${d / 2}px);opacity:${c.hidden ? 0.25 : L.opacity}">${b.label}</div>`;
    }).join('');
    const sp = place(L, L.stick.x, L.stick.y);
    const selBox = this.sel
      ? this.sel === 'stick'
        ? `<div class="edsel"><b>STICK</b> <button class="btn sm" data-stickmode="fixed" ${L.stick.mode === 'fixed' ? 'disabled' : ''}>Fixed</button><button class="btn sm" data-stickmode="follow" ${L.stick.mode === 'follow' ? 'disabled' : ''}>Follow thumb</button></div>`
        : `<div class="edsel"><b>${BUTTONS.find((b) => b.id === this.sel).label}</b> <button class="btn sm" data-scale="-1">Smaller</button><button class="btn sm" data-scale="1">Bigger</button><button class="btn sm" data-hide>${L.buttons[this.sel].hidden ? 'Show' : 'Hide'}</button></div>`
      : '<div class="edsel muted">Drag buttons and the stick to move them. Tap one to resize or hide it.</div>';
    this.root.innerHTML = `
      <div class="edbar">
        <span class="edgroup">${[0, 1, 2].map((i) => `<button class="btn sm ${t.active === i ? 'on' : ''}" data-slot="${i}">Layout ${i + 1}</button>`).join('')}</span>
        <span class="edgroup">${['s', 'm', 'l'].map((s) => `<button class="btn sm ${L.size === s ? 'on' : ''}" data-size="${s}">${s.toUpperCase()}</button>`).join('')}</span>
        <label class="edgroup">Opacity <input type="range" min="0.2" max="1" step="0.05" value="${L.opacity}" data-opacity></label>
        <label class="edgroup"><input type="checkbox" data-mirror ${L.mirror ? 'checked' : ''}> Left-handed</label>
        <span class="edgroup"><button class="btn sm" data-reset>Reset</button><button class="btn sm primary-sm" data-done>Done</button></span>
        ${selBox}
      </div>
      <div class="tstick ed ${this.sel === 'stick' ? 'sel' : ''}" data-id="stick" style="left:calc(${sp.x * 100}% - 70px);top:calc(${sp.y * 100}% - 70px);opacity:${L.opacity}"><div class="knob"></div><span>${L.stick.mode === 'follow' ? 'FOLLOWS THUMB' : 'FIXED'}</span></div>
      ${items}`;
    this._wire();
  }

  _wire() {
    const t = touchSettings();
    const L = activeLayout();
    const q = (sel) => this.root.querySelectorAll(sel);
    q('[data-slot]').forEach((b) => b.addEventListener('click', () => ((t.active = Number(b.dataset.slot)), this.render())));
    q('[data-size]').forEach((b) => b.addEventListener('click', () => ((L.size = b.dataset.size), this.render())));
    q('[data-opacity]').forEach((i) => i.addEventListener('input', () => ((L.opacity = Number(i.value)), this.render())));
    q('[data-mirror]').forEach((i) => i.addEventListener('change', () => ((L.mirror = i.checked), this.render())));
    q('[data-reset]').forEach((b) => b.addEventListener('click', () => ((t.layouts[t.active] = defaultLayout()), (this.sel = null), this.render())));
    q('[data-done]').forEach((b) => b.addEventListener('click', () => this.close()));
    q('[data-scale]').forEach((b) =>
      b.addEventListener('click', () => {
        const c = L.buttons[this.sel];
        c.s = Math.max(0.6, Math.min(1.8, c.s + Number(b.dataset.scale) * 0.15));
        this.render();
      })
    );
    q('[data-hide]').forEach((b) => b.addEventListener('click', () => ((L.buttons[this.sel].hidden = !L.buttons[this.sel].hidden), this.render())));
    q('[data-stickmode]').forEach((b) => b.addEventListener('click', () => ((L.stick.mode = b.dataset.stickmode), this.render())));
  }

  _down(e) {
    const el = e.target.closest('.ed');
    if (!el) return;
    e.preventDefault();
    this.sel = el.dataset.id;
    this.drag = { id: el.dataset.id, moved: false };
    this.root.setPointerCapture(e.pointerId);
    this.render();
  }

  _move(e) {
    if (!this.drag) return;
    const L = activeLayout();
    let x = (e.clientX / innerWidth) * 100;
    const y = Math.max(8, Math.min(95, (e.clientY / innerHeight) * 100));
    if (L.mirror) x = 100 - x;
    x = Math.max(4, Math.min(96, x));
    const item = this.drag.id === 'stick' ? L.stick : L.buttons[this.drag.id];
    item.x = x;
    item.y = y;
    this.render();
  }
}
