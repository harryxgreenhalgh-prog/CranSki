// Friendly 1v1 duels (DESIGN.md, Modes): challenge someone in your room on
// APEX, BIG AIR, FOREST LINE, ASPEN PIPE or BELLEVUE; alternate drops (the
// other rider watches live), 2 runs each, best run wins; rematch or change map.
//
// Both riders follow the same schedule, so neither needs to be "in charge":
// run order is challenger, challenged, challenger, challenged. A run starts when
// the rider whose turn it is says "go" (everyone sees a 3-2-1), and ends when
// they send "done" with the run's recorded inputs. The other side re-rides
// those inputs with the same deterministic simulation and uses the score it
// gets, so a duel can't be won by typing in a number.
//
// Fair play: pausing or standing still during your run is capped at 30 seconds
// in total per duel, then the run ends. Supabase Realtime presence (the server)
// says who has dropped out.
import { openChannel } from './net.js';
import { packPose } from './rooms.js';
import { STRIDE } from '../render/pose.js';

export const DUEL_PARKS = ['apex', 'bigair', 'forest', 'pipe', 'bellevue'];
export const RUNS_EACH = 2;
export const PAUSE_CAP = 30; // seconds per rider per duel
export const CHALLENGE_TIMEOUT = 20; // seconds to answer

export const duelTopic = (id) => `duel:${id}`;

// Who rides each run: challenger first, then alternate.
export function runOrder(hostUid, guestUid) {
  const out = [];
  for (let i = 0; i < RUNS_EACH; i++) out.push(hostUid, guestUid);
  return out;
}

// Winner from each rider's run totals: best run wins.
export function decide(scores, a, b) {
  const best = (u) => Math.max(0, ...(scores[u] || []));
  const ba = best(a);
  const bb = best(b);
  return { winner: ba === bb ? null : ba > bb ? a : b, best: { [a]: ba, [b]: bb } };
}

export class DuelSession {
  /**
   * @param {{ id: string, me: {uid,tag}, opp: {uid,tag}, host: boolean, park: string,
   *   open?: Function, verify?: (done: object) => number|null, hooks?: object }} o
   * verify(done) re-rides a finished run and returns its score (or null).
   */
  constructor({ id, me, opp, host, park, open = openChannel, verify = null, hooks = {} }) {
    this.id = id;
    this.me = me;
    this.opp = opp;
    this.host = host;
    this.park = park;
    this.open = open;
    this.verify = verify;
    this.h = hooks;
    this.ch = null;
    this.reset(park);
    this.oppHere = false;
    this.connected = false;
    this.pauseUsed = { [me.uid]: 0, [opp.uid]: 0 };
    this.closed = false;
  }

  reset(park) {
    this.park = park;
    this.scores = { [this.me.uid]: [], [this.opp.uid]: [] };
    this.records = { [this.me.uid]: [], [this.opp.uid]: [] };
    this.run = 0; // index of the current run (0..3); 4 = over
    this.phase = 'lobby'; // lobby | countdown | run | over
    this.readyFor = new Set(); // uids ready on this.park
    this.again = {}; // uid -> park
  }

  get order() {
    const [h, g] = this.host ? [this.me.uid, this.opp.uid] : [this.opp.uid, this.me.uid];
    return runOrder(h, g);
  }

  get turn() {
    return this.order[this.run] || null;
  }

  get myTurn() {
    return this.turn === this.me.uid;
  }

  get over() {
    return this.run >= this.order.length;
  }

  result() {
    return decide(this.scores, this.me.uid, this.opp.uid);
  }

  async connect() {
    this.ch = await this.open(duelTopic(this.id), {
      key: this.me.uid,
      onBroadcast: {
        ready: (m) => this._ready(m),
        go: (m) => this._go(m),
        p: (m) => m?.u === this.opp.uid && this.h.onOppPose?.(m),
        done: (m) => this._done(m),
        pause: (m) => {
          if (m?.u === this.opp.uid) this.pauseUsed[this.opp.uid] = Math.max(this.pauseUsed[this.opp.uid], Number(m.used) || 0);
        },
        again: (m) => this._again(m),
        leave: (m) => m?.u === this.opp.uid && this._oppLeft(),
      },
      onPresence: (members) => {
        const here = members.some((m) => (m.u || m.key) === this.opp.uid);
        if (here !== this.oppHere) {
          this.oppHere = here;
          this.h.onOppPresence?.(here);
        }
      },
      onStatus: (s) => {
        const ok = s === 'SUBSCRIBED';
        if (ok !== this.connected) {
          this.connected = ok;
          this.h.onConnection?.(ok);
        }
      },
    });
    this.connected = true;
    await this.ch.track({ u: this.me.uid, tag: this.me.tag });
  }

  send(event, payload) {
    this.ch?.send(event, { ...payload, u: this.me.uid });
  }

  // I've loaded the duel park and I'm at the top.
  ready() {
    this.readyFor.add(this.me.uid);
    this.send('ready', { park: this.park });
    this._maybeStart();
  }

  _ready(m) {
    if (m?.u !== this.opp.uid || m.park !== this.park) return;
    const had = this.readyFor.has(this.opp.uid);
    this.readyFor.add(this.opp.uid);
    if (!had) this.send('ready', { park: this.park }); // make sure they've heard ours
    this._maybeStart();
  }

  _maybeStart() {
    if (this.phase === 'lobby' && this.readyFor.has(this.me.uid) && this.readyFor.has(this.opp.uid)) {
      this.phase = 'waiting';
      this.h.onTurn?.(this.turn, this.run);
    }
  }

  // My turn: start the 3-2-1 for both of us.
  go() {
    if (!this.myTurn || this.phase === 'countdown' || this.phase === 'run') return;
    this.phase = 'countdown';
    this.send('go', { run: this.run });
    this.h.onCountdown?.(this.me.uid, this.run);
  }

  _go(m) {
    if (m?.u !== this.opp.uid || m.run !== this.run || this.turn !== this.opp.uid) return;
    this.phase = 'countdown';
    this.h.onCountdown?.(this.opp.uid, this.run);
  }

  startRun() {
    this.phase = 'run';
  }

  // During my run: my pose and live score for the other rider to watch.
  pose(rider, score, now = performance.now()) {
    if (now - (this._lastPose || 0) < 1000 / 15) return;
    this._lastPose = now;
    this.send('p', { t: Math.round(now), f: packPose(rider), sc: score });
  }

  addPause(seconds) {
    const used = (this.pauseUsed[this.me.uid] += seconds);
    if (Math.floor(used) !== Math.floor(used - seconds)) this.send('pause', { used });
    return Math.max(0, PAUSE_CAP - used);
  }

  pauseLeft(uid = this.me.uid) {
    return Math.max(0, PAUSE_CAP - this.pauseUsed[uid]);
  }

  // My run is over: send the score and the inputs behind it.
  finishRun(total, record) {
    if (!this.myTurn) return;
    const run = this.run;
    this.scores[this.me.uid].push(total);
    this.records[this.me.uid].push(record);
    this.send('done', { run, total, record });
    this._advance();
  }

  _done(m) {
    if (m?.u !== this.opp.uid || m.run !== this.run || this.turn !== this.opp.uid) return;
    // Re-ride their inputs; trust our own simulation's score over theirs.
    let total = Number(m.total) || 0;
    if (this.verify && m.record) {
      const checked = this.verify(m.record);
      if (checked !== null && checked !== undefined) total = checked;
    }
    this.scores[this.opp.uid].push(total);
    this.records[this.opp.uid].push(m.record || null);
    this.h.onOppDone?.(total, m.run);
    this._advance();
  }

  // Their time ran out while they were gone: their run ends at 0.
  forfeitTurn() {
    if (this.turn !== this.opp.uid) return;
    this.scores[this.opp.uid].push(0);
    this.records[this.opp.uid].push(null);
    this._advance();
  }

  _advance() {
    this.run++;
    if (this.over) {
      this.phase = 'over';
      this.h.onOver?.(this.result());
    } else {
      this.phase = 'waiting';
      this.h.onTurn?.(this.turn, this.run);
    }
  }

  // Rematch (same park) or change map: both riders have to pick the same.
  proposeAgain(park) {
    this.again[this.me.uid] = park;
    this.send('again', { park });
    this._checkAgain();
  }

  _again(m) {
    if (m?.u !== this.opp.uid || !DUEL_PARKS.includes(m.park)) return;
    this.again[this.opp.uid] = m.park;
    this.h.onProposal?.(m.park);
    this._checkAgain();
  }

  _checkAgain() {
    const a = this.again[this.me.uid];
    const b = this.again[this.opp.uid];
    if (a && a === b) {
      this.reset(a);
      this.pauseUsed = { [this.me.uid]: 0, [this.opp.uid]: 0 };
      this.h.onRestart?.(a);
    }
  }

  _oppLeft() {
    if (this.closed) return;
    this.h.onOppLeft?.();
  }

  async leave() {
    if (this.closed) return;
    this.closed = true;
    this.send('leave', {});
    const ch = this.ch;
    this.ch = null;
    if (ch) await ch.close().catch(() => {});
  }
}

// Pose packet check (for the spectator's buffer).
export const validPose = (m) => Array.isArray(m?.f) && m.f.length === STRIDE && typeof m.t === 'number';
