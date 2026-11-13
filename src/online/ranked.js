// Ranked 1v1 and 2v2 on APEX (DESIGN.md, Modes). The database does the
// matchmaking, decides who rides when, records each run only after the
// submit-run Edge Function has re-ridden it, and settles the result and
// ratings (supabase/migrations/*_ranked.sql). The game just asks and shows.
//
// ServerMatch looks like a duel session (online/duel.js) to the duel screens in
// main.js: same turns, 3-2-1, spectating and results, but the server is the
// referee.
import { getClient } from './client.js';
import { openChannel } from './net.js';
import { packPose } from './rooms.js';
import { OnlineError, notSetUp } from './account.js';
import { PAUSE_CAP } from './duel.js';

export const RANKED_PARK = 'apex';
export const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];
export const PLACEMENTS = 5;

async function rpc(name, args) {
  const sb = await getClient();
  const { data, error } = await sb.rpc(name, args);
  if (error) {
    console.warn(name, error);
    throw new OnlineError(notSetUp(error) ? "Ranked isn't set up on the server yet." : "Couldn't reach the ranked server.");
  }
  return data;
}

export const ranked = {
  me: () => rpc('my_ranked'),
  join: (mode, partner = null) => rpc('ranked_join', { p_mode: mode, p_partner: partner }),
  leaveQueue: () => rpc('ranked_leave_queue'),
  poll: () => rpc('ranked_poll'),
  checkin: (id) => rpc('ranked_checkin', { p_match: id }),
  forfeit: (id) => rpc('ranked_forfeit', { p_match: id }),
  claim: (id) => rpc('ranked_claim', { p_match: id }),
  board: (mode) => rpc('ranked_board', { p_mode: mode }),
};

export class ServerMatch {
  /**
   * view: a match as ranked_poll returns it; me: { uid, tag };
   * submit(record, total, matchId) -> { ok, match } | { ok: false, message }
   */
  constructor({ view, me, submit, api = ranked, open = openChannel }) {
    this.ranked = true;
    this.me = me;
    this.submit = submit;
    this.api = api;
    this.open = open;
    this.h = {};
    this.ch = null;
    this.records = {};
    this.pauseUsed = {};
    this.again = {};
    this.phase = 'lobby';
    this.closed = false;
    this.view = null;
    this.apply(view, true);
    for (const p of this.players) {
      this.records[p.uid] = [];
      this.pauseUsed[p.uid] = 0;
    }
  }

  get id() {
    return this.view.id;
  }
  get mode() {
    return this.view.mode;
  }
  get park() {
    return this.view.park;
  }
  get players() {
    return this.view.players.map((p) => ({ uid: p.id, tag: p.tag || 'Opponent', team: p.team }));
  }
  get myTeam() {
    return this.view.players[this.view.me].team;
  }
  // The opponent (1v1), or the first rider on the other team (2v2).
  get opp() {
    return this.players.find((p) => p.team !== this.myTeam);
  }
  get host() {
    return this.view.me === 0;
  }
  get order() {
    const out = [];
    for (let i = 0; i < this.view.runs_each; i++) for (const p of this.view.players) out.push(p.id);
    return out;
  }
  get run() {
    return this.view.run_index;
  }
  get turn() {
    return this.order[this.run] || null;
  }
  get myTurn() {
    return this.turn === this.me.uid;
  }
  get over() {
    return this.view.status === 'done' || this.view.status === 'cancelled';
  }
  get scores() {
    const out = {};
    for (const p of this.view.players) out[p.id] = (this.view.scores && this.view.scores[p.id]) || [];
    return out;
  }

  // { winner: uid of a winning rider (or null for a draw), winnerTeam, best: uid -> best, changes }
  result() {
    const r = this.view.result || {};
    const team = r.winner_team ?? null;
    const winner = team === null ? null : team === this.myTeam ? this.me.uid : this.opp?.uid;
    return { winner, winnerTeam: team, best: r.best || {}, changes: r.changes || {}, reason: r.reason, teamTotals: r.team_totals };
  }

  // A new view from the server: work out what changed and tell the screens.
  apply(view, first = false) {
    if (!view || (this.view && view.id !== this.view.id)) return;
    const before = this.view;
    this.view = view;
    if (first) return;
    if (view.run_index > before.run_index) {
      const prevTurn = this.order[before.run_index];
      if (prevTurn !== this.me.uid) {
        const s = this.scores[prevTurn] || [];
        this.h.onOppDone?.(s[s.length - 1] || 0, before.run_index, prevTurn);
      }
    }
    if (this.over && !(before.status === 'done' || before.status === 'cancelled')) {
      this.phase = 'over';
      this._stop();
      this.h.onOver?.(this.result());
    } else if (!this.over && view.run_index > before.run_index) {
      this.phase = 'waiting';
      this.h.onTurn?.(this.turn, this.run);
    }
  }

  async connect() {
    this.ch = await this.open(`match:${this.id}`, {
      key: this.me.uid,
      onBroadcast: {
        p: (m) => m?.u === this.turn && m.u !== this.me.uid && this.h.onOppPose?.(m),
        go: (m) => m?.u === this.turn && m.run === this.run && m.u !== this.me.uid && this._countdown(m.u),
        rec: (m) => m?.u && m.record && this.records[m.u]?.push(m.record),
      },
      onPresence: (list) => {
        const here = new Set(list.map((p) => p.u || p.key));
        const gone = this.players.some((p) => p.uid !== this.me.uid && !here.has(p.uid));
        if (gone !== this._gone) {
          this._gone = gone;
          this.h.onOppPresence?.(!gone);
        }
      },
      onStatus: (s) => this.h.onConnection?.(s === 'SUBSCRIBED'),
    });
    await this.ch.track({ u: this.me.uid, tag: this.me.tag });
    this._timer = setInterval(() => this.refresh(), 2500);
  }

  async refresh() {
    if (this.closed) return;
    try {
      const r = await this.api.poll();
      if (r?.match && r.match.id === this.id) this.apply(r.match);
    } catch {
      /* try again next time */
    }
  }

  ready() {
    this.phase = 'waiting';
    this.h.onTurn?.(this.turn, this.run);
  }

  go() {
    if (!this.myTurn || this.phase === 'countdown' || this.phase === 'run') return;
    this.ch?.send('go', { u: this.me.uid, run: this.run });
    this._countdown(this.me.uid);
  }

  _countdown(uid) {
    this.phase = 'countdown';
    this.h.onCountdown?.(uid, this.run);
  }

  startRun() {
    this.phase = 'run';
  }

  pose(rider, score, now = performance.now()) {
    if (now - (this._lastPose || 0) < 1000 / 15) return;
    this._lastPose = now;
    this.ch?.send('p', { u: this.me.uid, t: Math.round(now), f: packPose(rider), sc: score });
  }

  addPause(seconds) {
    this.pauseUsed[this.me.uid] += seconds;
    return this.pauseLeft();
  }

  pauseLeft(uid = this.me.uid) {
    return Math.max(0, PAUSE_CAP - (this.pauseUsed[uid] || 0));
  }

  // My run is over: the server re-rides it and records its own score.
  async finishRun(total, record) {
    if (!this.myTurn) return;
    this.phase = 'submitting';
    this.records[this.me.uid].push(record);
    this.ch?.send('rec', { u: this.me.uid, record });
    const r = await this.submit(record, total, this.id);
    if (r?.ok && r.match) this.apply(r.match);
    else {
      this.h.onError?.(r?.message || "The server couldn't check that run.");
      this.refresh();
    }
  }

  // The rider whose turn it is has gone quiet: ask the server (it decides).
  forfeitTurn() {
    if (this._claiming || this.closed) return;
    this._claiming = true;
    this.api
      .claim(this.id)
      .then((v) => v && this.apply(v))
      .catch(() => {})
      .finally(() => setTimeout(() => (this._claiming = false), 10000));
  }

  proposeAgain() {}

  _stop() {
    clearInterval(this._timer);
  }

  async leave() {
    if (this.closed) return;
    this.closed = true;
    this._stop();
    if (!this.over) await this.api.forfeit(this.id).catch(() => {});
    const ch = this.ch;
    this.ch = null;
    if (ch) await ch.close().catch(() => {});
  }
}
