// Locker: one slot at a time with a close-up preview; saves in one tap.
// Cosmetics change looks only, never speed or handling.
import { DEFAULT_LOOK, HELMETS, GRAB_INFO, GRAB_NAMES } from '../render/riderModel.js';
import { profile } from '../store.js';
import { ALL_ITEMS, KINDS, wear, itemColor } from '../economy/catalog.js';
import { economy } from '../online/economy.js';

const $ = (id) => document.getElementById(id);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

const SKIN = [0xf5d6c0, 0xe2b38f, 0xc68e62, 0x9a6a45, 0x6e4a32, 0x47301f];
const HAIR = [0x1c1410, 0x3b2a20, 0x7a4b2a, 0xc9964a, 0xe8d6a8, 0xb33a2e, 0x2c4fa8, 0xf2f2f2];
const BRIGHT = [0xff7a2f, 0x1e7bff, 0x22b07d, 0xffd23f, 0xe0406b, 0x8e5bff, 0x2fd3e0, 0xf4f7fb, 0x2a2f38, 0x9a6a45, 0x5c7a3a, 0xc9563c];
const DARK = [0x2f3b4c, 0x1d1d1d, 0x4a5a3a, 0x6b4a32, 0x2c4fa8, 0x8c8f96, 0xd8d2c4, 0x7a2b3a];
const LENS = [0xffb02e, 0x2fd3e0, 0xe0406b, 0x8e5bff, 0x22b07d, 0xc9ced6, 0x1a1a1a];

const SLOTS = [
  { id: 'body', name: 'Body', focus: 'full' },
  { id: 'head', name: 'Head', focus: 'close' },
  { id: 'goggles', name: 'Goggles', focus: 'close' },
  { id: 'top', name: 'Jacket / top', focus: 'full' },
  { id: 'pants', name: 'Pants', focus: 'full' },
  { id: 'gloves', name: 'Gloves', focus: 'full' },
  { id: 'ride', name: 'Ride', focus: 'low' },
  { id: 'gear', name: 'Bindings, boots', focus: 'low' },
  { id: 'poles', name: 'Poles', focus: 'full' },
  { id: 'grabs', name: 'Grabs', focus: 'full' },
];

// Your best single run anywhere, for unlocks.
function bestRun() {
  return Math.max(0, ...profile.runs.map((r) => r.total));
}

export class Locker {
  constructor({ model, onClose }) {
    this.model = model;
    this.onClose = onClose;
    this.slot = 'body';
    this.focus = 'full';
    this.yaw = 0;
    $('locker-save').addEventListener('click', () => this.save());
    $('locker-cancel').addEventListener('click', () => this.close(false));
  }

  get isOpen() {
    return !$('locker').classList.contains('hidden');
  }

  open() {
    this.saved = { ...DEFAULT_LOOK, ...profile.look };
    this.draft = JSON.parse(JSON.stringify(this.saved));
    $('locker').classList.remove('hidden');
    $('locker-msg').textContent = '';
    this.show(this.slot);
  }

  close(keep) {
    if (!keep) this.model.applyLook(this.saved);
    $('locker').classList.add('hidden');
    this.onClose();
  }

  save() {
    profile.look = this.draft;
    this.saved = JSON.parse(JSON.stringify(this.draft));
    this.model.applyLook(this.draft);
    $('locker-msg').textContent = 'Saved';
    clearTimeout(this._t);
    this._t = setTimeout(() => ($('locker-msg').textContent = ''), 1500);
  }

  show(slot) {
    this.slot = slot;
    const s = SLOTS.find((x) => x.id === slot);
    this.focus = s.focus;
    $('locker-slots').innerHTML = SLOTS.map((x) => `<button class="${x.id === slot ? 'on' : ''}" data-slot="${x.id}">${x.name}</button>`).join('');
    $('locker-slots').querySelectorAll('[data-slot]').forEach((b) => b.addEventListener('click', () => this.show(b.dataset.slot)));
    $('locker-title').textContent = s.name.toUpperCase();
    $('locker-body').innerHTML = this._owned(slot) + this._options(slot);
    this._wire();
  }

  // Items you own for this slot (Shop, sets, Season Pass, gifts).
  _owned(slot) {
    const mine = ALL_ITEMS.filter((it) => it.slot === slot && economy.owned.has(it.id));
    const any = ALL_ITEMS.some((it) => it.slot === slot);
    if (!any) return '';
    if (!mine.length) return `<p class="muted small">Items for this slot come from the Shop and the Season Pass.</p>`;
    const cur = this.draft.items?.[slot];
    return `<h4>YOUR ITEMS</h4><div class="items lk-items">${mine
      .map((it) => `<button class="item ${cur === it.id ? 'on' : ''}" data-item="${it.id}"><span class="psw" style="background:#${itemColor(it).toString(16).padStart(6, '0')}"></span>${it.name}<small>${KINDS[it.kind].label} · ${it.rarity}</small></button>`)
      .join('')}</div>`;
  }

  _sw(key, colors) {
    const cur = this.draft[key];
    return `<div class="swatches">${colors.map((c) => `<button class="sw ${cur === c ? 'on' : ''}" style="background:${hex(c)}" data-set="${key}" data-val="${c}" aria-label="${hex(c)}"></button>`).join('')}</div>`;
  }

  _items(key, items) {
    const cur = this.draft[key];
    return `<div class="items">${items
      .map(([val, label, need]) => {
        const locked = need && bestRun() < need;
        return `<button class="item ${cur === val ? 'on' : ''} ${locked ? 'locked' : ''}" data-set="${key}" data-val="${val}" ${locked ? 'disabled' : ''}>${label}${need ? `<small>${locked ? '🔒 ' : ''}single run over ${need.toLocaleString('en-US')}</small>` : ''}</button>`;
      })
      .join('')}</div>`;
  }

  _options(slot) {
    const d = this.draft;
    switch (slot) {
      case 'body':
        return `<h4>BODY</h4>${this._items('body', [['man', 'Man'], ['woman', 'Woman']])}<h4>SKIN TONE</h4>${this._sw('skin', SKIN)}<h4>HAIR</h4>${this._items('hair', [['short', 'Short'], ['strands', 'Front strands'], ['braid', 'Braid']])}<h4>HAIR COLOUR</h4>${this._sw('hairColor', HAIR)}`;
      case 'head':
        return `<h4>HEAD</h4>${this._items('head', [['helmet', 'Helmet'], ['beanie', 'Beanie'], ['balaclava', 'Balaclava'], ['none', 'No helmet']])}
          ${d.head === 'helmet' ? `<h4>HELMET</h4>${this._items('helmet', Object.entries(HELMETS).map(([id, h]) => [id, h.name, h.need]))}${d.helmet === 'matte' ? `<h4>COLOUR</h4>${this._sw('helmetColor', [0x161616, ...BRIGHT])}` : ''}` : ''}
          ${d.head === 'beanie' ? `<h4>BEANIE</h4>${this._items('beanieItem', [['knit', 'Park Knit'], ['cloud', 'Cloud Knit', 200000]])}<h4>COLOUR</h4>${this._sw('beanieColor', BRIGHT)}` : ''}`;
      case 'goggles':
        return `<h4>LENS</h4>${this._sw('lens', LENS)}<h4>STRAP LOGO</h4>${this._items('logo', [[true, 'CRANSKI logo on'], [false, 'Plain strap']])}`;
      case 'top':
        return `<h4>STYLE</h4>${this._items('top', [['shell', 'Shell'], ['hoodie', 'Hoodie'], ['tee', 'Tee'], ['longsleeve', 'Long sleeve']])}<h4>MAIN COLOUR</h4>${this._sw('topColor', BRIGHT)}<h4>TRIM</h4>${this._sw('trimColor', [...DARK, ...BRIGHT.slice(0, 4)])}`;
      case 'pants':
        return `<h4>BAGGY PARK PANTS</h4>${this._sw('pants', [...DARK, ...BRIGHT.slice(0, 4)])}`;
      case 'gloves':
        return `<h4>MITTENS</h4>${this._sw('gloves', [0x202830, ...BRIGHT])}`;
      case 'ride':
        return `<h4>RIDE</h4>${this._items('ride', [['skis', 'Twin-tip skis'], ['board', 'Snowboard']])}<p class="muted">A snowboard auto-equips board boots and adds FS / BS / Cab to trick names. Handling is the same.</p>${d.ride === 'skis' ? `<h4>SKI COLOUR</h4>${this._sw('skiColor', BRIGHT)}` : `<h4>BOARD COLOUR</h4>${this._sw('boardColor', BRIGHT)}`}`;
      case 'gear':
        return `<h4>BINDINGS</h4>${this._sw('bindings', [0x222222, ...BRIGHT])}<h4>BOOTS</h4>${this._sw('boots', [0x2a2a2a, ...BRIGHT])}`;
      case 'poles':
        return `<h4>POLES</h4>${this._items('poles', [['none', 'No poles (empty mittens)']])}${this._sw('poles', [0xc8ccd2, 0x222222, ...BRIGHT])}`;
      case 'grabs':
        return `<h4>GRAB BUTTONS</h4><p class="muted">Pick which grab sits on each of the three grab buttons. Every grab mirrors with your spin direction.</p>${[0, 1, 2]
          .map(
            (i) => `<label class="grabpick"><span>Slot ${i + 1}</span><select data-grab="${i}">${Object.keys(GRAB_NAMES)
              .map((g) => `<option value="${g}" ${d.grabs[i] === g ? 'selected' : ''}>${GRAB_NAMES[g]}</option>`)
              .join('')}</select><small>${GRAB_INFO[d.grabs[i]]}</small></label>`
          )
          .join('')}`;
    }
    return '';
  }

  _wire() {
    const body = $('locker-body');
    body.querySelectorAll('[data-set]').forEach((b) =>
      b.addEventListener('click', () => {
        const key = b.dataset.set;
        let val = b.dataset.val;
        if (val === 'true' || val === 'false') val = val === 'true';
        else if (/^\d+$/.test(val)) val = Number(val);
        this.draft[key] = val;
        // Picking your own colour or style takes the slot's item off.
        if (this.draft.items) delete this.draft.items[this.slot];
        if (key === 'helmet' && this.draft.helmet !== 'item') delete this.draft.helmetFinish;
        this.model.applyLook(this.draft);
        this.show(this.slot);
      })
    );
    body.querySelectorAll('[data-item]').forEach((b) =>
      b.addEventListener('click', () => {
        const it = ALL_ITEMS.find((x) => x.id === b.dataset.item);
        if (!it || !economy.owned.has(it.id)) return;
        this.draft = wear(this.draft, it);
        this.model.applyLook(this.draft);
        this.show(this.slot);
      })
    );
    body.querySelectorAll('[data-grab]').forEach((s) =>
      s.addEventListener('change', () => {
        this.draft.grabs[Number(s.dataset.grab)] = s.value;
        this.show(this.slot);
      })
    );
  }
}
