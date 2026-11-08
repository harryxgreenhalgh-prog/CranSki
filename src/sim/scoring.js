// Scoring rules from the design brief (Scoring section).
//
//   base  = 1500 x turns^2
//   trick = base x grab x flip x switch x repeat + airtime

export const SCORE = {
  basePerTurn2: 1500,
  invertBonus: 1.15, // per flip (flatspins use the trick's own, smaller bonus)
  grabMax: 1.25, // grab multiplier reached at 1 s held
  grabFullTime: 1.0,
  variety: { 2: 1.3, 3: 1.35 },
  grabOnly: 300,
  switchBonus: 1.25,
  repeat: [1, 0.75, 0.55, 0.4], // by how many of the last 3 airs were the same trick
  repeatWindow: 3,
  airPerSecond: 135,
  airPerMetre: 36,
  lineStep: 0.25,
  cleanFlat: 450,
  cleanLineShare: 0.15,
  sidewaysKeepMin: 0.5,
  railPerSecond: 750,
  railTrick: 450, // per swap or hop
  butter: { hold: 150, 180: 300, 360: 600 },
  buttersPerRun: 4,
};

export function railPoints(time, swaps, hops) {
  return Math.round(SCORE.railPerSecond * time + SCORE.railTrick * (swaps + hops));
}

// Held press (0.25 s+) = 150, a 180 = 300, a 360 = 600.
export function butterPoints(time, turned) {
  const t = Math.abs(turned);
  if (t >= 330) return SCORE.butter[360];
  if (t >= 150) return SCORE.butter[180];
  if (time >= 0.25) return SCORE.butter.hold;
  return 0;
}

export function grabMultiplier(grabCount, longestGrab) {
  if (grabCount <= 0) return 1;
  if (grabCount >= 2) return SCORE.variety[Math.min(grabCount, 3)];
  const t = Math.min(longestGrab, SCORE.grabFullTime) / SCORE.grabFullTime;
  return 1 + (SCORE.grabMax - 1) * t;
}

export function repeatFactor(key, history) {
  const recent = history.slice(-SCORE.repeatWindow);
  const n = recent.filter((k) => k === key).length;
  return SCORE.repeat[Math.min(n, SCORE.repeat.length - 1)];
}

export function airtimePoints(airTime, height) {
  return Math.round(SCORE.airPerSecond * airTime + SCORE.airPerMetre * Math.max(0, height));
}

/**
 * Score one landed trick.
 * @param {object} trick result of describeTrick
 * @param {{airTime:number,height:number}} air
 * @param {string[]} history keys of previous airs, oldest first
 */
export function scoreTrick(trick, air, history = []) {
  const bonuses = [];
  const airtime = airtimePoints(air.airTime, air.height);
  const repeat = repeatFactor(trick.key, history);

  let base;
  let grab = 1;
  let flip = 1;
  let sw = 1;

  if (trick.turns > 0) {
    base = SCORE.basePerTurn2 * trick.turns * trick.turns;
    grab = grabMultiplier(trick.grabs.length, trick.longestGrab);
    flip = Math.pow(trick.invertBonus ?? SCORE.invertBonus, trick.inversions);
    sw = trick.switchStance ? SCORE.switchBonus : 1;
  } else {
    base = SCORE.grabOnly; // a grab with no spin or flip
  }

  const withoutGrab = base * flip * sw * repeat;
  const total = withoutGrab * grab;

  if (grab > 1) bonuses.push({ label: trick.grabs.length >= 2 ? `${trick.grabs.length} grabs` : 'grab', value: `×${grab.toFixed(2)}` });
  if (flip > 1) bonuses.push({ label: 'inverted', value: `×${flip.toFixed(2)}` });
  if (sw > 1) bonuses.push({ label: 'switch', value: `×${sw.toFixed(2)}` });
  if (repeat < 1) bonuses.push({ label: 'repeat', value: `${Math.round(repeat * 100)}%` });
  if (airtime > 0) bonuses.push({ label: 'airtime', value: `+${airtime}` });

  return {
    points: Math.round(total + airtime),
    trickPart: withoutGrab + airtime, // rotation + airtime
    grabPart: total - withoutGrab, // what the grabs and variety added
    base,
    mults: { grab, flip, switch: sw, repeat },
    airtime,
    bonuses,
  };
}

// A line is every feature since the last bank. It banks once you ride away on snow.
export class Line {
  constructor() {
    this.trickPts = 0;
    this.grabPts = 0;
    this.landingPts = 0;
    this.railPts = 0;
    this.features = 0;
  }

  get multiplier() {
    return 1 + SCORE.lineStep * Math.max(0, this.features - 1);
  }

  get value() {
    return Math.round((this.trickPts + this.grabPts + this.railPts) * this.multiplier + this.landingPts);
  }

  get empty() {
    return this.features === 0 && this.trickPts === 0;
  }

  addRail(points) {
    this.railPts += points;
    this.features += 1;
  }

  // Butters add points but don't count as a jump or rail for the line multiplier.
  addButter(points) {
    this.trickPts += points;
  }

  addTrick(scored, keep = 1) {
    this.trickPts += scored.trickPart * keep;
    this.grabPts += scored.grabPart * keep;
    this.features += 1;
  }

  // Clean landing: +450 plus 15% of the line.
  addCleanLanding() {
    const bonus = Math.round(SCORE.cleanFlat + SCORE.cleanLineShare * this.value);
    this.landingPts += bonus;
    return bonus;
  }
}

export class RunScore {
  constructor() {
    this.total = 0;
    this.tricksAndAir = 0;
    this.grabsAndVariety = 0;
    this.landings = 0;
    this.lostToCrashes = 0;
    this.history = []; // trick keys, for the repeat rule
    this.bestTrick = null; // { name, points }
    this.butters = 0;
  }

  bank(line) {
    if (line.empty) return 0;
    const m = line.multiplier;
    const a = Math.round(line.trickPts * m);
    const b = Math.round(line.grabPts * m);
    const c = Math.round(line.landingPts + line.railPts * m);
    this.tricksAndAir += a;
    this.grabsAndVariety += b;
    this.landings += c;
    this.total += a + b + c;
    return a + b + c;
  }

  lose(line) {
    const value = line.value;
    this.lostToCrashes += value;
    return value;
  }

  remember(key, name, points) {
    this.history.push(key);
    if (this.history.length > 10) this.history.shift();
    if (!this.bestTrick || points > this.bestTrick.points) this.bestTrick = { name, points };
  }
}
