// Where each park's lift runs: a straight line from the bottom station (below the
// finish) to the top station (above the start gate), towers along it, and a
// sagging cable between tower tops. Pure data, shared by the simulation (to clear
// trees out of the lift line) and the renderer.

// Real-world speeds: a gondola runs at about 6 m/s, an aerial ropeway about
// 10 m/s, and a T-bar drag lift about 3 m/s.
export const LIFT_KIND = {
  gondola: { spacing: 150, towerH: 16, hang: 3.6, cabinGap: 60, speed: 6, clear: 10 },
  ropeway: { spacing: 420, towerH: 42, hang: 6, cabinGap: 0, speed: 10, clear: 14 },
  tbar: { spacing: 60, towerH: 7.5, hang: 0, cabinGap: 22, speed: 3, clear: 7 },
};

export function liftLayout(terrain) {
  const park = terrain.park;
  const spec = park.lift || { type: 'gondola', side: 1, offset: 30 };
  const k = LIFT_KIND[spec.type];
  const cross = terrain.cross;
  const sBottom = park.finishS + 30;
  const sTop = Math.max(-8, park.startS - 16);
  const side = spec.side ?? 1;
  const baseU = cross.type === 'pipe' ? cross.lipU : cross.type === 'street' ? cross.hw + cross.curb + cross.walk : cross.hw;
  const xAt = (s) => (spec.worldX !== undefined ? spec.worldX : terrain.center(s) + side * (baseU + (spec.offset ?? 30)));
  // A real lift line is straight: from the bottom station to the top station.
  const x0 = xAt(sBottom);
  const x1 = xAt(sTop);
  const lineX = (s) => x0 + ((x1 - x0) * (s - sBottom)) / (sTop - sBottom);

  const n = Math.max(2, Math.ceil((sBottom - sTop) / k.spacing));
  const towers = [];
  for (let i = 0; i <= n; i++) {
    const s = sBottom + ((sTop - sBottom) * i) / n;
    const x = lineX(s);
    towers.push({ s, x, z: -s, g: terrain.height(x, -s) });
  }

  // Cable points every ~2 m with a little sag between towers.
  const cable = (offsetX) => {
    const pts = [];
    for (let i = 0; i < towers.length - 1; i++) {
      const a = towers[i];
      const b = towers[i + 1];
      const span = Math.hypot(b.s - a.s, b.g - a.g);
      const sag = spec.type === 'tbar' ? span * 0.01 : span * 0.025;
      const steps = Math.max(2, Math.ceil(span / 2));
      for (let j = 0; j < steps; j++) {
        const t = j / steps;
        const s = a.s + (b.s - a.s) * t;
        const y = a.g + k.towerH + (b.g - a.g) * t - sag * 4 * t * (1 - t);
        pts.push({ x: lineX(s) + offsetX, y, z: -s });
      }
    }
    const last = towers[towers.length - 1];
    pts.push({ x: last.x + offsetX, y: last.g + k.towerH, z: last.z });
    return pts;
  };

  // T-bar riders are dragged along a smoothed track on the snow under the cable.
  let track = null;
  if (spec.type === 'tbar') {
    const raw = [];
    for (let s = sBottom; s >= sTop; s -= 2) raw.push({ s, x: lineX(s), y: terrain.height(lineX(s), -s), z: -s });
    track = raw.map((p, i) => {
      let y = 0;
      let w = 0;
      for (let j = -3; j <= 3; j++) {
        const q = raw[Math.max(0, Math.min(raw.length - 1, i + j))];
        y += q.y;
        w++;
      }
      return { x: p.x, y: Math.max(p.y, y / w), z: p.z };
    });
  }

  return {
    type: spec.type,
    kind: k,
    side,
    sBottom,
    sTop,
    lineX,
    towers,
    up: cable(0),
    down: cable(side * 4.5),
    track,
    // Is (x, s) inside the cleared lift line (no trees)?
    inCorridor(x, s) {
      if (s > sBottom + 25 || s < sTop - 25) return false;
      const d = x - lineX(s);
      return d > -k.clear - (side < 0 ? 4.5 : 0) && d < k.clear + (side > 0 ? 4.5 : 0);
    },
  };
}
