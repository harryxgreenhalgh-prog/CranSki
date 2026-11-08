// The live room roster: hold Tab (or pick Riders in the pause menu) to see who's
// in your room and what they're doing. Later steps add buttons to each row
// (mute, report, challenge).
import { esc } from './accountUI.js';
import { parkMeta } from '../parks/index.js';
import { roomRules } from '../online/rooms.js';

const $ = (id) => document.getElementById(id);

export const STATUS = {
  riding: 'Riding',
  lift: 'On the lift',
  paused: 'Paused',
  results: 'Just finished',
  replay: 'Watching a replay',
  duel: 'In a duel',
};

export class Roster {
  constructor({ onAction = () => {} } = {}) {
    this.onAction = onAction;
    this.actions = []; // (rider, room) => html for that row's buttons
    this.pinned = false;
    $('roster').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ract]');
      if (b) {
        this.onAction(b.dataset.ract, b.dataset.uid);
        return;
      }
      if (e.target.closest('[data-rclose]') || (this.pinned && !e.target.closest('.panel'))) this.hide();
    });
  }

  get isOpen() {
    return !$('roster').classList.contains('hidden');
  }

  show(room, pinned = false) {
    this.room = room;
    this.pinned = pinned;
    $('roster').classList.remove('hidden');
    this.render();
  }

  hide() {
    this.pinned = false;
    $('roster').classList.add('hidden');
  }

  render() {
    if (!this.isOpen || !this.room) return;
    const room = this.room;
    const rules = room.park ? roomRules(room.park) : { max: 30 };
    const name = room.park ? parkMeta(room.park).name : '';
    const where = room.privateKey ? 'PRIVATE ROOM' : `ROOM ${room.number}`;
    $('roster-title').textContent = room.room ? `${where} · ${name} · ${room.riders}/${rules.max}` : 'NOT IN A ROOM';
    $('roster-hint').innerHTML = this.pinned ? '<button class="btn sm" data-rclose>Close</button>' : 'Hold Tab';
    const me = `<tr class="me"><td><b>${esc(room.me.tag)}</b> <span class="muted">(you)</span></td><td class="rstatus muted">${STATUS[room.status] || ''}</td><td></td></tr>`;
    const others = [...room.remotes.values()]
      .sort((a, b) => a.tag.localeCompare(b.tag))
      .map((r) => `<tr><td><b>${esc(r.tag)}</b></td><td class="rstatus muted">${STATUS[r.status] || ''}</td><td>${this.actions.map((fn) => fn(r, room)).join(' ')}</td></tr>`)
      .join('');
    $('roster-list').innerHTML = me + (others || '<tr><td colspan="3" class="muted">No one else here yet. Riders who join this room appear here.</td></tr>');
  }
}
