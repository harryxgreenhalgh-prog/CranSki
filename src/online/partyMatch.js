// Party matches (DESIGN.md, Modes):
//  - Private 2v2 or free-for-all for a party of 3-4: the leader picks the map,
//    1, 3 or 5 runs each, and best run or round wins. Riders take turns and the
//    others watch, like a friendly duel.
//  - The CRANSKI CUP: up to 5 maps, 2v2 or free-for-all, total score or round
//    wins (each map is a round). On each map everyone drops in together, in
//    the party's private room so you see each other ride.
//
// Friends only and nothing at stake, so (like friendly duels) it runs between
// the riders on the party's own Realtime channel 'pmatch:<party id>'. Every
// rider re-rides everyone else's recorded inputs and uses their own score for
// it, so all games agree on the standings. The party leader (or, if they drop
// out, the first rider still here) is the referee: it starts the match, says
// GO on each Cup map, moves everyone on, and ends the turn of a rider who has
// gone (after their 30 seconds of pause time, as in duels).
import { openChannel } from './net.js';
import { packPose } from './rooms.js';
import { PAUSE_CAP } from './duel.js';
import { standings } from './scoring.js';

export const MATCH_PARKS = ['apex', 'bigair', 'yard', 'forest', 'pipe', 'bellevue'];
export const RUN_CHOICES = [1, 3, 5];
export const CUP_MAX_MAPS = 5;
export const CUP_RUN_LIMIT = 180; // seconds per rider per Cup map
export const JOIN_WAIT = 25; // seconds to answer the leader's invite
export const READY_WAIT = 45; // seconds the referee waits for everyone at the gate
export const GONE_GRACE = 15; // seconds a rider can drop out before the referee stops waiting for them
export const pmatchTopic = (partyId) => `pmatch:${partyId}`;

// Check a config from the leader (it arrives over the network).
export function cleanConfig(c) {
  if (!c || typeof c !== 'object') return null;
  const kind = c.kind === 'cup' ? 'cup' : 'match';
  const teams = c.teams === '2v2' ? '2v2' : 'ffa';
  if (kind === 'match') {
    const park = Array.isArray(c.maps) ? c.maps[0] : c.park;
    if (!MATCH_PARKS.includes(park)) return null;
    const runs = RUN_CHOICES.includes(Number(c.runs)) ? Number(c.runs) : 3;
    return { kind, teams, maps: [park], runs, scoring: c.scoring === 'rounds' ? 'rounds' : 'best' };
  }
  const maps = (Array.isArray(c.maps) ? c.maps : []).filter((m) => MATCH_PARKS.includes(m)).slice(0, CUP_MAX_MAPS);
  if (!maps.length) return null;
  return { kind, teams, maps, runs: 1, scoring: c.scoring === 'rounds' ? 'rounds' : 'total' };
}

// Check a roster: 2-4 riders with gamertags; 2v2 needs two on each team.
export function cleanRoster(list, teams) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const out = [];
  for (const r of list.slice(0, 4)) {
    if (!r || typeof r.uid !== 'string' || seen.has(r.uid)) continue;
    seen.add(r.uid);
    out.push({ uid: r.uid, tag: String(r.tag || 'Rider').slice(0, 24), team: teams === '2v2' ? (r.team === 1 ? 1 : 0) : out.length });
  }
  if (out.length < 2) return null;
  if (teams === '2v2' && (out.filter((r) => r.team === 0).length !== 2 || out.filter((r) => r.team === 1).length !== 2)) return null;
  return out;
}

// Turn order: free-for-all in roster order; 2v2 alternates teams (A1 B1 A2 B2).
export function turnOrder(roster, teams) {
  if (teams !== '2v2') return roster.map((r) => r.uid);
  const a = roster.filter((r) => r.team === 0);
  const b = roster.filter((r) => r.team === 1);
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i].uid);
    if (b[i]) out.push(b[i].uid);
  }
  return out;
}

const PARK_NAMES = { apex: 'APEX', bigair: 'BIG AIR', yard: 'THE YARD', forest: 'FOREST LINE', pipe: 'ASPEN PIPE', bellevue: 'BELLEVUE' };
export function describe(cfg) {
  const teams = cfg.teams === '2v2' ? '2v2' : 'Free-for-all';
  if (cfg.kind === 'cup') {
    return `CRANSKI CUP · ${teams} · ${cfg.maps.map((m) => PARK_NAMES[m] || m).join(', ')} · ${cfg.scoring === 'rounds' ? 'round wins' : 'total score'}`;
  }
  return `Private ${teams} · ${PARK_NAMES[cfg.maps[0]] || cfg.maps[0]} · ${cfg.runs} ${cfg.runs === 1 ? 'run' : 'runs'} each · ${cfg.scoring === 'rounds' ? 'round wins' : 'best run'}`;
}

export class PartyMatch {
  /**
   * id: random match id; partyId; cfg (cleanConfig); roster: the riders invited;
   * me: { uid, tag, look }; leader: the uid that set it up.
   * verify(record) -> score (re-rides a run) or null.
   */
  constructor({ id, partyId, cfg, roster, me, leader, open = openChannel, verify = null, hooks = {}, now = () => Date.now() }) {
    this.party = true;
    this.id = id;
    this.partyId = partyId;
    this.cfg = cfg;
    this.invited = roster;
    this.roster = null; // final riders, once the referee says 'begin'
    this.me = me;
    this.leader = leader;
    this.open = open;
    this.verify = verify;
    this.h = hooks;
    this.now = now;
    this.ch = null;
    this.closed = false;
    this.status = 'joining'; // joining | lobby | playing | over | cancelled
    this.phase = 'lobby'; // lobby | waiting | countdown | run | over (the duel screens' view)
    this.answers = new Map([[me.uid, 'in']]);
    this.present = new Set([me.uid]);
    this.missingSince = new Map(); // uid -> when they dropped out of Presence
    this.left = new Set();
    this.looks = {};
    this.scores = {};
    this.records = {};
    this.pauseUsed = {};
    this.again = {};
    this.run = 0; // turn-based: index into the order; Cup: map index
    this.readyFor = new Set();
    this.done = new Set(); // Cup: riders finished on this map
    this.createdAt = now();
    this.stageAt = now();
    this.goAt = 0;
    this._lastSent = 0;
  }

  // ------------------------------------------------------------ who and what
  get cup() {
    return this.cfg.kind === 'cup';
  }
  get teamPlay() {
    return this.cfg.teams === '2v2';
  }
  get label() {
    return this.cup ? 'CRANSKI CUP' : `PARTY ${this.teamPlay ? '2V2' : 'FFA'}`;
  }
  get players() {
    return this.roster || this.invited;
  }
  get myTeam() {
    return this.players.find((p) => p.uid === this.me.uid)?.team ?? 0;
  }
  get opp() {
    const p = this.players.find((r) => r.uid !== this.me.uid && r.team !== this.myTeam) || this.players.find((r) => r.uid !== this.me.uid);
    return p ? { uid: p.uid, tag: p.tag } : { uid: null, tag: 'Rider' };
  }
  get host() {
    return this.referee === this.me.uid;
  }
  get park() {
    return this.cfg.maps[Math.min(this.cup ? this.run : 0, this.cfg.maps.length - 1)];
  }
  get rounds() {
    return this.cup ? this.cfg.maps.length : this.cfg.runs;
  }
  get order() {
    if (this.cup) return [];
    const one = turnOrder(this.players, this.cfg.teams);
    const out = [];
    for (let i = 0; i < this.cfg.runs; i++) out.push(...one);
    return out;
  }
  get turn() {
    return this.cup ? null : this.order[this.run] || null;
  }
  get myTurn() {
    return !this.cup && this.turn === this.me.uid;
  }
  get over() {
    return this.status === 'over' || this.status === 'cancelled';
  }
  // Riders who have gone: dropped out (Presence) or left.
  get absent() {
    return new Set(this.players.filter((p) => p.uid !== this.me.uid && (!this.present.has(p.uid) || this.left.has(p.uid))).map((p) => p.uid));
  }
  // The leader if still here, else the first rider still here.
  get referee() {
    const here = (u) => (u === this.me.uid || this.present.has(u)) && !this.left.has(u);
    if (here(this.leader)) return this.leader;
    return this.players.map((p) => p.uid).find(here) || this.me.uid;
  }
  tagOf(uid) {
    return uid === this.me.uid ? this.me.tag : this.players.find((p) => p.uid === uid)?.tag || 'Rider';
  }
  // Riders still taking part: here (or only just dropped out) and not left.
  _active(now = this.now()) {
    const recent = (u) => this.missingSince.has(u) && now - this.missingSince.get(u) < GONE_GRACE * 1000;
    return this.players.filter((p) => !this.left.has(p.uid) && (p.uid === this.me.uid || this.present.has(p.uid) || recent(p.uid)));
  }

  standings() {
    return standings({ riders: this.players, scores: this.scores, teams: this.cfg.teams, scoring: this.cfg.scoring, rounds: this.over ? this.rounds : null });
  }
  // The duel screens' result: who won (a rider, or the first rider of the winning team).
  result() {
    const st = this.standings();
    const w = st.winner;
    return { standings: st, winner: w ? w.members[0].uid : null, winnerTeam: w ? w.team : null, best: {}, changes: {} };
  }

  // ------------------------------------------------------------ connection
  async connect() {
    this.ch = await this.open(pmatchTopic(this.partyId), {
      key: this.me.uid,
      onBroadcast: {
        in: (m) => {
          if (!this._mine(m)) return;
          this._answer(m.u, 'in');
          // They missed the start: tell them again.
          if (this.status === 'playing' && this.host && this.roster.some((r) => r.uid === m.u)) this._send('begin', { roster: this.roster });
        },
        begin: (m) => this._mine(m) && m.u === this.referee && this._begin(m),
        cancel: (m) => this._mine(m) && m.u === this.referee && this._cancel(m.why),
        start: (m) => this._mine(m) && m.u === this.referee && this._start(),
        ready: (m) => this._mine(m) && this._ready(m),
        go: (m) => this._mine(m) && this._go(m),
        p: (m) => this._mine(m) && !this.cup && m.u === this.turn && m.u !== this.me.uid && this.h.onOppPose?.(m),
        done: (m) => this._mine(m) && this._done(m),
        pause: (m) => {
          if (this._mine(m) && m.u in this.pauseUsed) this.pauseUsed[m.u] = Math.max(this.pauseUsed[m.u], Number(m.used) || 0);
        },
        skip: (m) => this._mine(m) && m.u === this.referee && this._skip(m.run),
        next: (m) => this._mine(m) && m.u === this.referee && this._next(m.k),
        leave: (m) => this._mine(m) && this._left(m.u),
      },
      onPresence: (list) => {
        this.present = new Set([this.me.uid, ...list.map((p) => p.u || p.key).filter(Boolean)]);
        const t = this.now();
        for (const p of this.players) {
          if (this.present.has(p.uid)) this.missingSince.delete(p.uid);
          else if (!this.missingSince.has(p.uid)) this.missingSince.set(p.uid, t);
        }
        for (const p of list) if (p.u && p.look && typeof p.look === 'object') this.looks[p.u] = p.look;
        const gone = this.absent.size > 0;
        if (gone !== this._gone) {
          this._gone = gone;
          this.h.onOppPresence?.(!gone);
        }
        this.h.onChange?.();
      },
      onStatus: (s) => this.h.onConnection?.(s === 'SUBSCRIBED'),
    });
    await this.ch.track({ u: this.me.uid, tag: this.me.tag, look: this.me.look || null });
    this._timer = setInterval(() => this.tick(), 1000);
    this._send('in', {});
  }

  _mine(m) {
    return m && m.id === this.id && typeof m.u === 'string' && !this.closed;
  }

  _send(event, payload) {
    this.ch?.send(event, { ...payload, id: this.id, u: this.me.uid });
  }

  // Once a second: resend what might have been missed, and do the referee's jobs.
  tick(now = this.now()) {
    if (this.closed || this.over) return;
    const resend = now - this._lastSent > 3000;
    if (resend) this._lastSent = now;
    if (this.status === 'joining') {
      if (resend) this._send('in', {});
      if (this.host && (this.invited.every((r) => this.answers.has(r.uid)) || now - this.createdAt > JOIN_WAIT * 1000)) this._decideBegin();
      else if (!this.host && now - this.createdAt > (JOIN_WAIT + 20) * 1000) this._cancel('The leader went quiet, so the match was called off.');
      return;
    }
    if (this.phase === 'lobby' && this.readyFor.has(this.me.uid) && resend) this._send('ready', { k: this.run });
    if (!this.host) return;
    const active = this._active(now);
    if (this.phase === 'lobby') {
      const allReady = active.every((p) => this.readyFor.has(p.uid));
      const waited = now - this.stageAt > READY_WAIT * 1000;
      if (this.readyFor.has(this.me.uid) && (allReady || waited)) {
        if (this.cup) {
          this._send('go', { k: this.run });
          this._go({ u: this.me.uid, k: this.run });
        } else {
          this._send('start', {});
          this._start();
        }
      }
    } else if (this.cup && (this.phase === 'countdown' || this.phase === 'run' || this.phase === 'waiting')) {
      const allDone = active.every((p) => this.done.has(p.uid));
      if (allDone || now - this.goAt > (CUP_RUN_LIMIT + 25) * 1000) {
        this._send('next', { k: this.run });
        this._next(this.run);
      }
    } else if (!this.cup && this.turn && this.turn !== this.me.uid && this.left.has(this.turn)) {
      this.forfeitTurn();
    }
  }

  // ------------------------------------------------------------ joining
  _answer(uid, a) {
    if (!this.invited.some((r) => r.uid === uid)) return;
    this.answers.set(uid, a);
    if (a === 'in') this.present.add(uid);
    this.h.onChange?.();
  }

  // A rider said no (over the party channel).
  answer(uid, a) {
    this._answer(uid, a === 'in' ? 'in' : 'out');
  }

  _decideBegin() {
    const roster = this.invited.filter((r) => this.answers.get(r.uid) === 'in');
    const ok = this.teamPlay ? cleanRoster(roster, '2v2') : roster.length >= 2 ? roster : null;
    if (!ok) {
      const why = this.teamPlay ? '2v2 needs all four riders, so the match was called off.' : 'Not enough riders joined, so the match was called off.';
      this._send('cancel', { why });
      this._cancel(why);
      return;
    }
    this._send('begin', { roster: ok });
    this._begin({ roster: ok });
  }

  _begin(m) {
    if (this.status !== 'joining') return;
    const roster = this.teamPlay ? cleanRoster(m.roster, '2v2') : cleanRoster(m.roster, 'ffa');
    if (!roster) return;
    // The roster keeps the invite's teams (FFA: each rider is their own side).
    const byUid = new Map(this.invited.map((r) => [r.uid, r]));
    this.roster = roster.filter((r) => byUid.has(r.uid)).map((r, i) => ({ ...byUid.get(r.uid), team: this.teamPlay ? byUid.get(r.uid).team : i }));
    if (!this.roster.some((r) => r.uid === this.me.uid)) {
      this._cancel('The match started without you.');
      return;
    }
    for (const r of this.roster) {
      if (!this.present.has(r.uid) && !this.missingSince.has(r.uid)) this.missingSince.set(r.uid, this.now());
      this.scores[r.uid] = [];
      this.records[r.uid] = [];
      this.pauseUsed[r.uid] = 0;
    }
    this.status = 'playing';
    this.phase = 'lobby';
    this.run = 0;
    this.stageAt = this.now();
    this.h.onBegin?.(this);
  }

  _cancel(why) {
    if (this.over) return;
    this.status = 'cancelled';
    this.phase = 'over';
    this._stop();
    this.h.onCancel?.(why);
  }

  // ------------------------------------------------------------ at the gate
  // I've loaded the park (this map, in the Cup) and I'm at the top.
  ready() {
    if (this.status !== 'playing') return;
    this.readyFor.add(this.me.uid);
    this._send('ready', { k: this.run });
    this.tick();
  }

  _ready(m) {
    if (this.status !== 'playing' || !this.players.some((p) => p.uid === m.u)) return;
    // Someone is already at the next Cup map: I missed the referee's 'next'.
    if (this.cup && m.k === this.run + 1 && this.phase !== 'lobby' && m.u === this.referee) this._next(this.run);
    if (m.k !== this.run) return;
    if (this.phase !== 'lobby' && this.host) {
      // They missed the start or the GO: say it again.
      if (this.cup) this._send('go', { k: this.run });
      else this._send('start', {});
      return;
    }
    this.readyFor.add(m.u);
    this.h.onChange?.();
  }

  // Turn-based: the referee says everyone's here; the first turn begins.
  _start() {
    if (this.cup || this.phase !== 'lobby' || this.status !== 'playing') return;
    this.phase = 'waiting';
    this.h.onTurn?.(this.turn, this.run);
  }

  // ------------------------------------------------------------ riding
  // Turn-based: my turn, start the 3-2-1 for everyone. (Cup: the referee does.)
  go() {
    if (this.cup || !this.myTurn || this.phase !== 'waiting') return;
    this.phase = 'countdown';
    this._send('go', { run: this.run });
    this.h.onCountdown?.(this.me.uid, this.run);
  }

  _go(m) {
    if (this.status !== 'playing') return;
    if (this.cup) {
      if (m.u !== this.referee || m.k !== this.run || this.phase !== 'lobby') return;
      this.phase = 'countdown';
      this.goAt = this.now();
      this.h.onCountdown?.(null, this.run);
      return;
    }
    if (m.u !== this.turn || m.run !== this.run || m.u === this.me.uid) return;
    if (this.phase === 'lobby') this._start(); // missed the referee's start
    if (this.phase !== 'waiting') return;
    this.phase = 'countdown';
    this.h.onCountdown?.(m.u, this.run);
  }

  startRun() {
    this.phase = 'run';
  }

  pose(rider, score, now = performance.now()) {
    if (this.cup) return; // the Cup's private room carries everyone's pose
    if (now - (this._lastPose || 0) < 1000 / 15) return;
    this._lastPose = now;
    this._send('p', { t: Math.round(now), f: packPose(rider), sc: score });
  }

  addPause(seconds) {
    const used = (this.pauseUsed[this.me.uid] = (this.pauseUsed[this.me.uid] || 0) + seconds);
    if (Math.floor(used) !== Math.floor(used - seconds)) this._send('pause', { used });
    return this.pauseLeft();
  }

  pauseLeft(uid = this.me.uid) {
    return Math.max(0, PAUSE_CAP - (this.pauseUsed[uid] || 0));
  }

  _checked(record, claimed) {
    if (!record || record.park !== this.park) return 0;
    let total = Math.max(0, Number(claimed) || 0);
    if (this.verify) {
      const v = this.verify(record);
      if (v !== null && v !== undefined) total = v;
    }
    return total;
  }

  // My run is over (finish line, out of pause time, or the Cup's time limit).
  finishRun(total, record) {
    if (this.status !== 'playing') return;
    if (this.cup) {
      if (this.done.has(this.me.uid) || this.phase === 'lobby') return;
      this.scores[this.me.uid][this.run] = total;
      this.records[this.me.uid][this.run] = record;
      this.done.add(this.me.uid);
      this.phase = 'waiting';
      this._send('done', { k: this.run, total, record });
      this.h.onRiderDone?.(this.me.uid, this.run, total);
      this.tick();
      return;
    }
    if (!this.myTurn) return;
    this.scores[this.me.uid].push(total);
    this.records[this.me.uid].push(record);
    this._send('done', { run: this.run, total, record });
    this._advance();
  }

  _done(m) {
    if (this.status !== 'playing' || m.u === this.me.uid || !(m.u in this.scores)) return;
    if (this.cup) {
      if (m.k !== this.run || this.done.has(m.u) || this.phase === 'lobby') return;
      const total = this._checked(m.record, m.total);
      this.scores[m.u][this.run] = total;
      this.records[m.u][this.run] = m.record || null;
      this.done.add(m.u);
      this.h.onRiderDone?.(m.u, this.run, total);
      this.h.onOppDone?.(total, this.run, m.u);
      return;
    }
    if (m.u !== this.turn || m.run !== this.run) return;
    if (this.phase === 'lobby') this._start();
    const total = this._checked(m.record, m.total);
    this.scores[m.u].push(total);
    this.records[m.u].push(m.record || null);
    this.h.onOppDone?.(total, m.run, m.u);
    this._advance();
  }

  // Turn-based: the rider up has gone (left, or out of pause time while away).
  // Only the referee calls it, so every game skips the same turn.
  forfeitTurn() {
    if (this.cup || !this.host || this.over || this.phase === 'lobby') return;
    const run = this.run;
    if (this.turn === this.me.uid) return;
    this._send('skip', { run });
    this._skip(run);
  }

  _skip(run) {
    if (this.cup || run !== this.run || this.over || this.status !== 'playing') return;
    if (this.phase === 'lobby') this._start();
    const u = this.turn;
    this.scores[u].push(0);
    this.records[u].push(null);
    this.h.onSkipped?.(u, run);
    this._advance();
  }

  _advance() {
    this.run++;
    if (this.run >= this.order.length) this._finish();
    else {
      this.phase = 'waiting';
      this.h.onTurn?.(this.turn, this.run);
    }
  }

  // Cup: the referee moves everyone on; anyone without a run on this map scores 0.
  _next(k) {
    if (!this.cup || k !== this.run || this.status !== 'playing' || this.phase === 'lobby') return;
    for (const p of this.players) if (this.scores[p.uid][k] === undefined) this.scores[p.uid][k] = 0;
    this.h.onMapDone?.(k);
    this.run++;
    this.readyFor.clear();
    this.done.clear();
    if (this.run >= this.cfg.maps.length) this._finish();
    else {
      this.phase = 'lobby';
      this.stageAt = this.now();
      this.h.onMap?.(this.run, this.park);
    }
  }

  _finish() {
    this.status = 'over';
    this.phase = 'over';
    this._stop();
    this.h.onOver?.(this.result());
  }

  _left(uid) {
    if (uid === this.me.uid || this.left.has(uid) || !this.players.some((p) => p.uid === uid)) return;
    this.left.add(uid);
    this.h.onRiderLeft?.(uid);
    this.tick();
  }

  proposeAgain() {}

  _stop() {
    clearInterval(this._timer);
  }

  async leave() {
    if (this.closed) return;
    this._send('leave', {});
    this.closed = true;
    this._stop();
    const ch = this.ch;
    this.ch = null;
    if (ch) await ch.close().catch(() => {});
  }
}
