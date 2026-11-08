// One run down a park: rider + trick scoring + line banking + finish.
// Pure simulation; the UI reads `messages` and the stats.

import { DT, LAND } from './constants.js';
import { Rider } from './rider.js';
import { describeTrick } from './tricks.js';
import { scoreTrick, Line, RunScore, railPoints, butterPoints, SCORE } from './scoring.js';

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

    if (-r.pos.z >= this.terrain.park.finishS && r.mode !== 'air' && r.mode !== 'rail') {
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
    if (ev.type === 'railOn') {
      this.bankTimer = 0;
      return;
    }
    if (ev.type === 'railTrick') {
      this.messages.push({ type: 'railTrick', what: ev.what, points: SCORE.railTrick });
      return;
    }
    if (ev.type === 'railOff') {
      const points = railPoints(ev.time, ev.swaps, ev.hops);
      const KIND = { rail: 'RAIL', box: 'BOX', pipe: 'PIPE', rainbow: 'RAINBOW', kink: 'KINK', snake: 'SNAKE', follow: 'HANDRAIL' };
      let name = `${KIND[ev.kind] || 'RAIL'} SLIDE`;
      if (ev.press > 0.3) name += ' PRESS';
      if (ev.swaps) name += ` · ${ev.swaps} SWAP${ev.swaps > 1 ? 'S' : ''}`;
      if (ev.hops) name += ` · ${ev.hops} HOP${ev.hops > 1 ? 'S' : ''}`;
      this.line.addRail(points);
      this.score.remember(`rail|${ev.kind}|${ev.swaps}|${ev.hops}`, name, points);
      this.messages.push({ type: 'rail', name, points, time: ev.time, lineValue: this.line.value, lineMult: this.line.multiplier });
      return;
    }
    if (ev.type === 'butter') {
      if (this.score.butters >= SCORE.buttersPerRun) return; // only the first 4 per run
      const pts = butterPoints(ev.time, ev.turned);
      if (pts <= 0) return;
      this.score.butters++;
      const t = Math.abs(ev.turned);
      let name = t >= 330 ? 'BUTTER 360' : t >= 150 ? 'BUTTER 180' : ev.kind === 'nose' ? 'NOSE BUTTER' : 'TAIL BUTTER';
      if (ev.deep) name = 'DEEP ' + name;
      this.line.addButter(pts);
      this.score.remember(`butter|${name}`, name, pts);
      this.messages.push({ type: 'butter', name, points: pts, lineValue: this.line.value });
      if (this.rider.mode === 'ground') this.bankTimer = LAND.bankDelay;
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
      fromRail: a.fromRail,
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
      butter: L.butter,
      deep: L.deep,
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
