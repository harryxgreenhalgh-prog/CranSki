// One run down a park: rider + trick scoring + line banking + finish.
// Pure simulation; the UI reads `messages` and the stats.

import { DT, LAND } from './constants.js';
import { Rider } from './rider.js';
import { describeTrick } from './tricks.js';
import { scoreTrick, Line, RunScore } from './scoring.js';

export class Run {
  constructor(terrain) {
    this.terrain = terrain;
    this.rider = new Rider(terrain);
    this.reset();
  }

  reset() {
    this.rider.reset();
    this.score = new RunScore();
    this.line = new Line();
    this.bankTimer = 0;
    this.time = 0;
    this.topSpeed = 0;
    this.airtime = 0;
    this.finished = false;
    this.messages = []; // drained by the HUD each frame
    this.tricksLanded = 0;
  }

  step(input) {
    if (this.finished) return;
    const r = this.rider;
    r.step(input);
    this.time += DT;
    this.topSpeed = Math.max(this.topSpeed, r.speed);

    for (const ev of r.events) this._onEvent(ev);
    r.events.length = 0;

    // A landed line banks after a moment of riding away on snow.
    if (this.bankTimer > 0 && r.mode === 'ground') {
      this.bankTimer -= DT;
      if (this.bankTimer <= 0) this._bank();
    }

    if (-r.pos.z >= this.terrain.park.finishS && r.mode !== 'air') {
      if (r.mode === 'ground') this._bank();
      this.finished = true;
      this.messages.push({ type: 'finish' });
    }
  }

  _bank() {
    this.bankTimer = 0;
    if (this.line.empty) return;
    const value = this.score.bank(this.line);
    this.messages.push({ type: 'bank', value });
    this.line = new Line();
  }

  _onEvent(ev) {
    if (ev.type === 'takeoff') {
      // Taking off again before the line banked keeps it going.
      return;
    }
    if (ev.type !== 'land') return;
    const L = ev.landing;
    if (L.airTime > 0.2) this.airtime += L.airTime;

    if (L.quality === 'crash') {
      const lost = this.score.lose(this.line);
      this.line = new Line();
      this.bankTimer = 0;
      this.messages.push({ type: 'crash', lost, reason: L.reason });
      return;
    }

    if (!L.scored) {
      // Small hops on flat snow, quick taps and uphill hops score nothing.
      if (!this.line.empty && this.bankTimer <= 0) this.bankTimer = LAND.bankDelay;
      return;
    }

    const a = L.air;
    const grabs = a.grabOrder.map((name) => ({ name, time: a.grabTimes[name] }));
    const trick = describeTrick({
      family: a.family,
      spin: a.spin,
      flip: a.flip,
      roll: a.roll,
      switchStance: a.switchStance,
      grabs,
    });

    let scored = null;
    if (trick) {
      scored = scoreTrick(trick, { airTime: L.airTime, height: L.height }, this.score.history);
      this.line.addTrick(scored, L.keep);
      this.score.remember(trick.key, trick.name, Math.round(scored.points * L.keep));
      this.tricksLanded++;
    }

    let cleanBonus = 0;
    if (L.quality === 'clean' && !this.line.empty) cleanBonus = this.line.addCleanLanding();

    this.messages.push({
      type: 'trick',
      name: trick ? trick.name : null,
      points: scored ? Math.round(scored.points * L.keep) : 0,
      bonuses: scored ? scored.bonuses : [],
      quality: L.quality,
      stomped: L.stomped,
      keep: L.keep,
      cleanBonus,
      lineValue: this.line.value,
      lineMult: this.line.multiplier,
      switchLand: L.switchLand,
    });
    if (!this.line.empty) this.bankTimer = LAND.bankDelay;
  }

  results() {
    const s = this.score;
    return {
      total: s.total,
      tricksAndAir: s.tricksAndAir,
      grabsAndVariety: s.grabsAndVariety,
      landings: s.landings,
      lost: s.lostToCrashes,
      topSpeedKmh: Math.round(this.topSpeed * 3.6),
      airtime: this.airtime,
      bestTrick: s.bestTrick,
      time: this.time,
    };
  }
}
