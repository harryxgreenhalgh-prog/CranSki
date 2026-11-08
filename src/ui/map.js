// Park map: an illustrated mountain with the seven parks on it.
import { PARKS } from '../parks/index.js';
import { profile } from '../store.js';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

export class ParkMap {
  constructor({ onRide, onBack }) {
    this.onRide = onRide;
    this.onBack = onBack;
    this.sel = 0;
    this.here = null;
    this._draw();
    $('map-ride').addEventListener('click', () => this.onRide(PARKS[this.sel].id));
    $('map-back').addEventListener('click', () => this.onBack());
  }

  _draw() {
    const svg = $('map-svg');
    svg.replaceChildren();
    const defs = el('defs', {}, svg);
    const g = el('linearGradient', { id: 'mtn', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0', 'stop-color': '#ffffff' }, g);
    el('stop', { offset: '1', 'stop-color': '#cfe2f5' }, g);
    // Back range, main peak and its shoulders.
    el('path', { d: 'M0 46 L14 30 L24 38 L38 22 L52 34 L66 18 L80 30 L92 24 L100 32 L100 80 L0 80 Z', fill: '#b7cde4' }, svg);
    el('path', { d: 'M0 80 L0 58 L12 44 L26 34 L40 16 L50 8 L60 14 L72 26 L86 36 L100 48 L100 80 Z', fill: 'url(#mtn)' }, svg);
    el('path', { d: 'M50 8 L46 20 L40 28 M50 8 L56 22 L64 30 M40 16 L34 30', stroke: '#9db7d3', 'stroke-width': 0.5, fill: 'none' }, svg);
    // Forest band.
    for (let i = 0; i < 70; i++) {
      const x = (i * 37) % 100;
      const y = 60 + ((i * 13) % 18);
      el('path', { d: `M${x} ${y} l1.2 -3 l1.2 3 z`, fill: '#2c6b48' }, svg);
    }
    this.markers = [];
    this.summit = { x: 50, y: 9 };
    PARKS.forEach((p, i) => {
      el('path', { d: `M${this.summit.x} ${this.summit.y} Q ${(this.summit.x + p.map.x) / 2 + 6} ${(this.summit.y + p.map.y) / 2} ${p.map.x} ${p.map.y}`, stroke: '#1e7bff', 'stroke-width': 0.5, 'stroke-dasharray': '1.2 1', fill: 'none', opacity: 0.6 }, svg);
    });
    PARKS.forEach((p, i) => {
      const grp = el('g', { class: 'pk', transform: `translate(${p.map.x} ${p.map.y})`, tabindex: 0, role: 'button', 'aria-label': p.name }, svg);
      el('circle', { r: 2.2 }, grp);
      const t = el('text', { x: 3, y: 1.1 }, grp);
      t.textContent = p.name;
      grp.addEventListener('click', () => this.select(i));
      grp.addEventListener('dblclick', () => this.onRide(p.id));
      this.markers.push(grp);
    });
    this.hereTag = el('g', {}, svg);
    el('rect', { x: -9, y: -7.5, width: 18, height: 3.6, rx: 1, fill: '#0b3d91' }, this.hereTag);
    const ht = el('text', { class: 'here', x: 0, y: -4.9, 'text-anchor': 'middle' }, this.hereTag);
    ht.textContent = 'YOU ARE HERE';
  }

  open(currentId, hereId) {
    this.sel = Math.max(0, PARKS.findIndex((p) => p.id === currentId));
    this.here = hereId;
    $('map').classList.remove('hidden');
    this.select(this.sel);
  }

  close() {
    $('map').classList.add('hidden');
  }

  get currentId() {
    return PARKS[this.sel].id;
  }

  get isOpen() {
    return !$('map').classList.contains('hidden');
  }

  select(i) {
    this.sel = (i + PARKS.length) % PARKS.length;
    const p = PARKS[this.sel];
    this.markers.forEach((m, k) => m.classList.toggle('sel', k === this.sel));
    $('map-name').textContent = p.name;
    $('map-purpose').textContent = p.purpose;
    $('map-length').textContent = p.length;
    $('map-features').textContent = p.features;
    $('map-lift').textContent = p.lift;
    const riding = this.riderCount ? this.riderCount(p.id) : null;
    $('map-riders').textContent = riding === null ? 'Just you (solo)' : riding === 0 ? 'No one yet: start a room' : `${riding} riding now`;
    const best = profile.best(p.id);
    $('map-best').textContent = best ? best.toLocaleString('en-US') : '—';
    $('map-board').textContent = p.leaderboard ? 'Yes' : 'No (ghosts only)';
    const here = PARKS.find((q) => q.id === this.here);
    if (here) {
      this.hereTag.setAttribute('transform', `translate(${here.map.x} ${here.map.y})`);
      this.hereTag.style.display = '';
    } else this.hereTag.style.display = 'none';
  }

  // Keyboard: arrows move, Enter rides, Esc goes back.
  key(code) {
    if (code === 'ArrowRight' || code === 'ArrowDown') this.select(this.sel + 1);
    else if (code === 'ArrowLeft' || code === 'ArrowUp') this.select(this.sel - 1);
  }
}
