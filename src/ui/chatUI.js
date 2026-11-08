// Chat on screen: the latest lines top left (fading when quiet), a chat bar
// opened with T (or Enter while riding, or the chat button on touch screens),
// quick phrases, and the chat setting: full, quick phrases only, or off.
import { settings } from '../settings.js';
import { PHRASES, MAX_LENGTH } from '../online/chatFilter.js';
import { esc } from './accountUI.js';

const $ = (id) => document.getElementById(id);
const SHOW_MS = 15000;
const LINES = 7;

export class ChatUI {
  constructor({ onSend, onPhrase }) {
    this.onSend = onSend;
    this.onPhrase = onPhrase;
    this.lines = [];
    this.enabled = false;
    this.targets = ['room'];
    this.target = 'room';
    $('chat-target').addEventListener('click', () => {
      const i = this.targets.indexOf(this.target);
      this.target = this.targets[(i + 1) % this.targets.length];
      this._target();
      $('chat-input').focus();
    });
    $('chat-phrases').innerHTML = PHRASES.map((p, i) => `<button class="btn sm" data-phrase="${i}" title="${i < 9 ? `Key ${i + 1}` : ''}">${esc(p)}</button>`).join('');
    $('chat-phrases').addEventListener('click', (e) => {
      const b = e.target.closest('[data-phrase]');
      if (!b) return;
      this.onPhrase(Number(b.dataset.phrase));
      this.close();
    });
    const input = $('chat-input');
    input.maxLength = MAX_LENGTH;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const t = input.value.trim();
        input.value = '';
        if (t) this.onSend(t);
        this.close();
      } else if (e.key === 'Escape') this.close();
    });
    $('chatbar').addEventListener('keydown', (e) => {
      if (e.target === input) return;
      e.stopPropagation();
      const n = e.key >= '1' && e.key <= '9' ? Number(e.key) - 1 : null;
      if (n !== null && n < PHRASES.length) {
        this.onPhrase(n);
        this.close();
      } else if (e.key === 'Escape' || e.key === 't' || e.key === 'T') this.close();
    });
    $('chat-btn').addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    $('chat-close').addEventListener('click', () => this.close());
    setInterval(() => this._fade(), 1000);
  }

  get mode() {
    return settings.chat || 'full';
  }

  get isOpen() {
    return !$('chatbar').classList.contains('hidden');
  }

  // Where messages can go: ['room'], ['party'] or both (toggle in the bar).
  setTargets(list) {
    this.targets = list.length ? list : ['room'];
    if (!this.targets.includes(this.target)) this.target = this.targets[0];
    this._target();
  }

  _target() {
    const b = $('chat-target');
    b.classList.toggle('hidden', this.targets.length < 2);
    b.textContent = this.target === 'party' ? 'Party' : 'Room';
  }

  // In a room (or party) chat, or not.
  setEnabled(on) {
    this.enabled = on && this.mode !== 'off';
    $('chatlog').classList.toggle('hidden', !this.enabled);
    $('chat-btn').classList.toggle('hidden', !this.enabled);
    if (!this.enabled) this.close();
  }

  clear() {
    this.lines = [];
    this._render();
  }

  open() {
    if (!this.enabled) return;
    const quick = this.mode === 'quick';
    $('chat-input').classList.toggle('hidden', quick);
    $('chat-hint').textContent = quick ? 'Pick a phrase (keys 1–9) · Esc to close' : 'Enter to send · Esc to close · or pick a phrase';
    $('chatbar').classList.remove('hidden');
    document.body.classList.add('chatting');
    setTimeout(() => (quick ? $('chatbar') : $('chat-input')).focus(), 0);
    this._render(true);
  }

  close() {
    $('chatbar').classList.add('hidden');
    document.body.classList.remove('chatting');
    if (document.activeElement && $('chatbar').contains(document.activeElement)) document.activeElement.blur();
    this._render();
  }

  // A message from the room or party: { u, tag, text, q, ts }
  message(m, mine, from = 'room') {
    this.shown = this.shown || new Set();
    if (m.id) {
      if (this.shown.has(m.id)) return;
      this.shown.add(m.id);
      if (this.shown.size > 300) this.shown.delete(this.shown.values().next().value);
    }
    // Quick phrases only: free-typed messages from others aren't shown.
    if (this.mode === 'quick' && (m.q === null || m.q === undefined) && !mine) return;
    this._push({ html: `${from === 'party' ? '<span class="ptag">PARTY</span> ' : ''}<b>${esc(m.tag)}</b> ${esc(m.text)}`, mine });
  }

  system(text) {
    this._push({ html: `<i>${esc(text)}</i>`, system: true });
  }

  _push(line) {
    line.at = Date.now();
    this.lines.push(line);
    while (this.lines.length > 40) this.lines.shift();
    this._render();
  }

  _fade() {
    if (this.lines.length) this._render();
  }

  _render(all = this.isOpen) {
    const now = Date.now();
    const show = (all ? this.lines.slice(-LINES * 2) : this.lines.filter((l) => now - l.at < SHOW_MS)).slice(-LINES);
    $('chatlog').innerHTML = show
      .map((l) => `<div class="cl${l.system ? ' sys' : ''}${l.mine ? ' mine' : ''}${!all && now - l.at > SHOW_MS - 3000 ? ' fading' : ''}">${l.html}</div>`)
      .join('');
  }
}
