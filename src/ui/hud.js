// DOM HUD over the canvas: speed, minimap, trick readout, restart ring, results.
import { describeTrick } from '../sim/tricks.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

export const CONTROLS_HTML = `
  <div>
    <h3>ON SNOW</h3>
    <table>
      <tr><td>A / D</td><td>Carve</td></tr>
      <tr><td>W</td><td>Tuck for speed (poles on flats)</td></tr>
      <tr><td>S</td><td>Brake / powerslide</td></tr>
      <tr><td>Space</td><td>Hold to load, release to pop. A/D while loading winds up a spin</td></tr>
      <tr><td>Hold R</td><td>Restart from the top</td></tr>
      <tr><td>F</td><td>Skip the lift</td></tr>
      <tr><td>Esc / P</td><td>Pause</td></tr>
    </table>
  </div>
  <div>
    <h3>IN THE AIR</h3>
    <table>
      <tr><td>A / D</td><td>Spin</td></tr>
      <tr><td>W / S</td><td>Frontflip / backflip</td></tr>
      <tr><td>← / →</td><td>Sideflip, or flatspin with a spin</td></tr>
      <tr><td>↑ + spin + S/W</td><td>Rodeo / misty</td></tr>
      <tr><td>Spin + S / W</td><td>Cork / bio (within 0.25 s of the lip)</td></tr>
      <tr><td>Shift / Q / E</td><td>Mute / Tail / Japan grab</td></tr>
    </table>
  </div>
  <ul class="tips">
    <li>BIG AIR: tuck the whole inrun for max speed; full speed lands near the orange 225 m board.</li>
    <li>Keep holding S with a cork spin for doubles and triples.</li>
    <li><b>Release everything before touchdown</b> so the skis line up. Holding keys into the snow is a bail.</li>
    <li>Controller: left stick carve/spin, A pop, RT tuck/frontflip, LT backflip, right stick roll, B rodeo/misty, LB/X/Y grabs.</li>
  </ul>
`;

export class Hud {
  constructor(terrain) {
    this.terrain = terrain;
    this.el = {
      hud: $('hud'),
      speed: $('speed-num'),
      score: $('score-num'),
      live: $('live'),
      trick: $('trick'),
      name: $('trick-name'),
      points: $('trick-points'),
      bonuses: $('trick-bonuses'),
      landing: $('trick-landing'),
      line: $('line'),
      ring: $('ring'),
      ringFill: $('ring-fill'),
      hint: $('hint'),
      minimap: $('minimap'),
    };
    this.trickTimer = 0;
    this.hintTimer = 0;
    this.lastSpeed = -1;
    this.lastScore = -1;
    this.lastLive = '';
    this._buildMinimapBackground();
  }

  show(on) {
    this.el.hud.classList.toggle('hidden', !on);
  }

  hint(text, seconds = 3) {
    this.el.hint.textContent = text;
    this.el.hint.classList.add('show');
    this.hintTimer = seconds;
  }

  _buildMinimapBackground() {
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = 96;
    const g = c.getContext('2d');
    const t = this.terrain;
    const park = t.park;
    const top = t.profile(0);
    const bottom = t.profile(park.endS);
    this.map = { sx: 228 / park.endS, sy: 80 / (top - bottom), top };
    g.beginPath();
    g.moveTo(6, 96);
    for (let s = 0; s <= park.endS; s += 2) {
      g.lineTo(6 + s * this.map.sx, 8 + (top - t.profile(s)) * this.map.sy);
    }
    g.lineTo(234, 96);
    g.closePath();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fill();
    const mark = (s, color) => {
      const x = 6 + s * this.map.sx;
      const y = 8 + (top - t.profile(s)) * this.map.sy;
      g.fillStyle = color;
      g.fillRect(x - 1.5, y - 10, 3, 10);
    };
    if (park.profileKicker) mark(park.profileKicker.lipS, '#1e7bff');
    for (const f of t.features) if (f.kicker && !f.paint) mark(f.s + f.lipAlong, '#1e7bff');
    mark(park.finishS, '#ff7a2f');
    this.mapBg = c;
  }

  drawMinimap(rider) {
    const c = this.el.minimap;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(this.mapBg, 0, 0);
    const s = -rider.pos.z;
    const x = 6 + s * this.map.sx;
    const y = 8 + (this.map.top - rider.pos.y) * this.map.sy;
    g.fillStyle = '#ff7a2f';
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y - 3, 5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  update(run, dt) {
    const r = run.rider;
    const kmh = Math.round(r.speed * 3.6);
    if (kmh !== this.lastSpeed) {
      this.el.speed.textContent = kmh;
      this.lastSpeed = kmh;
    }
    if (run.score.total !== this.lastScore) {
      this.el.score.textContent = fmt(run.score.total);
      this.lastScore = run.score.total;
    }

    // Live readout of the rotation so far.
    let live = '';
    if (r.mode === 'air' && r.air && r.air.time > 0.2) {
      const a = r.air;
      const d = describeTrick({
        family: a.family,
        spin: a.spin,
        flip: a.flip,
        roll: a.roll,
        switchStance: a.switchStance,
        grabs: a.grabOrder.map((name) => ({ name, time: a.grabTimes[name] })),
      });
      if (d) live = d.name;
    }
    if (live !== this.lastLive) {
      this.el.live.textContent = live;
      this.lastLive = live;
    }

    // Unbanked line.
    const line = run.line;
    this.el.line.textContent = line.empty ? '' : `LINE ${fmt(line.value)}${line.features > 1 ? `  ×${line.multiplier.toFixed(2)}` : ''}`;

    if (this.trickTimer > 0) {
      this.trickTimer -= dt;
      if (this.trickTimer <= 0) this.el.trick.classList.remove('show');
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.el.hint.classList.remove('show');
    }
    this.drawMinimap(r);
  }

  setRestart(frac) {
    this.el.ring.classList.toggle('hidden', frac <= 0);
    this.el.ringFill.style.strokeDashoffset = String(264 * (1 - frac));
  }

  message(m) {
    const e = this.el;
    if (m.type === 'trick') {
      e.trick.classList.remove('crash');
      const quality = {
        clean: m.stomped ? `STOMPED +${fmt(m.cleanBonus)}` : `CLEAN +${fmt(m.cleanBonus)}`,
        sideways: `SIDEWAYS · KEPT ${Math.round(m.keep * 100)}%`,
        saved: 'SAVED IT · KEPT 50%',
      }[m.quality];
      if (!m.name) {
        // A clean landing with nothing to score: say nothing big.
        if (m.quality === 'saved') this._showTrick('SAVED IT', '', [], '', 'saved', 1.4);
        return;
      }
      const sw = m.switchLand ? ' · SWITCH' : '';
      this._showTrick(m.name, `+${fmt(m.points)}`, m.bonuses, quality + sw, m.quality, 2.8);
    } else if (m.type === 'crash') {
      e.trick.classList.add('crash');
      this._showTrick('BAIL LOST', m.lost > 0 ? `−${fmt(m.lost)}` : '', [], m.reason ? m.reason.toUpperCase() : '', 'crash', 2.6);
    } else if (m.type === 'bank') {
      this.hint(`Banked +${fmt(m.value)}`, 1.6);
    }
  }

  _showTrick(name, points, bonuses, landing, quality, seconds) {
    const e = this.el;
    e.name.textContent = name;
    e.points.textContent = points;
    e.bonuses.replaceChildren(
      ...bonuses.map((b) => {
        const s = document.createElement('span');
        s.className = 'chip';
        s.textContent = `${b.label} ${b.value}`;
        return s;
      })
    );
    e.landing.textContent = landing;
    e.landing.className = `q-${quality}`;
    e.trick.classList.add('show');
    this.trickTimer = seconds;
  }

  clearTrick() {
    this.el.trick.classList.remove('show');
    this.trickTimer = 0;
    this.el.live.textContent = '';
    this.lastLive = '';
  }
}

export function showResults(res, best, isNewBest) {
  $('res-total').textContent = fmt(res.total);
  $('res-best').textContent = isNewBest && res.total > 0 ? `NEW PERSONAL BEST on ${res.parkName}` : best > 0 ? `Personal best: ${fmt(best)}` : '';
  $('res-tricks').textContent = fmt(res.tricksAndAir);
  $('res-grabs').textContent = fmt(res.grabsAndVariety);
  $('res-land').textContent = fmt(res.landings);
  $('res-lost').textContent = res.lost > 0 ? `−${fmt(res.lost)}` : '0';
  $('res-speed').textContent = `${res.topSpeedKmh} km/h`;
  $('res-air').textContent = `${res.airtime.toFixed(1)} s`;
  $('res-trick').textContent = res.bestTrick ? `${res.bestTrick.name} (${fmt(res.bestTrick.points)})` : '—';
}
