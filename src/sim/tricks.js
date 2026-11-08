// Trick recogniser: names a trick from the rotation actually completed in the air,
// never from the keys that were held.

export const GRAB_MIN_TIME = 0.25; // a grab counts after this long held

// Off-axis families rotate around a tilted axis; the flip part comes from the tilt.
export const OFF_AXIS = new Set(['cork', 'bio', 'rodeo', 'misty', 'flat']);

const FAMILY_NAME = {
  cork: 'CORK',
  bio: 'BIO',
  rodeo: 'RODEO',
  misty: 'MISTY',
  flat: 'FLATSPIN',
};

const MULTI = ['', '', 'DOUBLE ', 'TRIPLE ', 'QUAD '];

const GRAB_DISPLAY = { rocket: 'ROCKET AIR', truenose: 'TRUE NOSE' };
function multiWord(n) {
  return n < MULTI.length ? MULTI[n] : `${n}X `;
}

// Spin degrees rounded to the nearest 180; a quick tap (under 150 deg) is nothing.
export function roundSpin(deg) {
  const a = Math.abs(deg);
  if (a < 150) return 0;
  return Math.round(a / 180) * 180;
}

// Whole flips from accumulated flip-axis degrees. ~235+ deg counts as a flip (the
// landing alignment finishes the rest), so 3 full flips can never read as 5.
export function countFlips(deg) {
  return Math.floor(Math.abs(deg) / 360 + 0.35);
}

/**
 * Describe a completed air.
 * @param {object} air
 *   family: null | 'spin' | 'flip' | 'side' | 'cork' | 'bio' | 'rodeo' | 'misty' | 'flat'
 *   spin, flip, roll: signed degrees accumulated around the body's up, right and forward axes
 *   switchStance: took off riding backwards
 *   grabs: [{ name, time }] in the order first pressed
 * @returns {object|null} null when nothing scoreable happened
 */
export function describeTrick(air) {
  const { family, spin = 0, flip = 0, roll = 0, switchStance = false, fromRail = false } = air;
  const grabs = (air.grabs || []).filter((g) => g.time >= GRAB_MIN_TIME);

  let spinDeg = 0;
  let flips = 0;
  let sideflips = 0;
  let offAxis = null;
  let flipDir = 0;

  if (family && OFF_AXIS.has(family) && family !== 'flat') {
    spinDeg = roundSpin(Math.hypot(spin, flip));
    flips = countFlips(flip);
    flipDir = Math.sign(flip);
    offAxis = family;
  } else if (family === 'flat') {
    spinDeg = roundSpin(Math.hypot(spin, roll));
    flips = countFlips(roll);
    flipDir = Math.sign(roll);
    offAxis = 'flat';
  } else {
    spinDeg = roundSpin(spin);
    flips = countFlips(flip);
    sideflips = countFlips(roll);
    flipDir = flips ? Math.sign(flip) : Math.sign(roll);
  }

  // An off-axis family that never really left the vertical is just a spin.
  if (offAxis && spinDeg < 360 && flips === 0) offAxis = null;

  const spinDir = spinDeg ? Math.sign(offAxis === 'flat' ? spin || roll : spin) : 0;

  let name = '';
  let turns = 0;
  let inversions = 0;
  let invertBonus = 1.15;

  if (offAxis) {
    // Only the spin counts as turns; the flip bonus applies on top.
    turns = spinDeg / 360;
    inversions = flips;
    if (offAxis === 'flat') invertBonus = 1.075; // ranks below a cork at equal rotation
    name = flips > 0 ? `${multiWord(flips)}${FAMILY_NAME[offAxis]} ${spinDeg}` : `${FAMILY_NAME[offAxis]} ${spinDeg}`;
  } else if (flips > 0) {
    // Straight flips: each flip counts as one turn (a late spin only tilts it).
    const dir = flip < 0 ? 'FRONTFLIP' : 'BACKFLIP';
    name = `${multiWord(flips)}${dir}${spinDeg ? ' ' + spinDeg : ''}`;
    turns = flips + spinDeg / 360;
    inversions = flips;
  } else if (sideflips > 0) {
    name = `${multiWord(sideflips)}SIDEFLIP${spinDeg ? ' ' + spinDeg : ''}`;
    turns = sideflips + spinDeg / 360;
    inversions = sideflips;
  } else if (fromRail && Math.abs(spin) >= 70) {
    // Off the end of a rail, spins count in quarter turns: 90 OUT, 270 OUT...
    const out = Math.round(Math.abs(spin) / 90) * 90;
    name = `${out} OUT`;
    turns = out / 360;
    spinDeg = out;
  } else if (spinDeg > 0) {
    name = `${spinDeg}`;
    turns = spinDeg / 360;
  }

  if (!name && grabs.length === 0) return null;

  const grabNames = [];
  for (const g of grabs) if (!grabNames.includes(g.name)) grabNames.push(g.name);

  const parts = [];
  if (air.board && name && spinDeg > 0) {
    // Snowboard: direction too. Regular stance: spinning left is frontside.
    const fs = spinDir > 0;
    if (switchStance) parts.push(fs ? 'CAB' : 'SWITCH BS');
    else parts.push(fs ? 'FS' : 'BS');
  } else if (switchStance && name) parts.push('SWITCH');
  if (name) parts.push(name);
  parts.push(...grabNames.map((g) => GRAB_DISPLAY[g] || g.toUpperCase()));

  const longestGrab = grabs.reduce((m, g) => Math.max(m, g.time), 0);

  // Same trick for repeat purposes: grabs don't change it; direction, switch and flips do.
  const key = [
    switchStance && name ? 'S' : 'R',
    offAxis || (flips ? 'flip' : sideflips ? 'side' : spinDeg ? 'spin' : 'grab'),
    spinDeg,
    spinDir,
    flips || sideflips,
    flipDir,
  ].join('|');

  return {
    name: parts.join(' '),
    key,
    spinDeg,
    flips: flips || sideflips,
    inversions,
    invertBonus,
    offAxis,
    turns,
    switchStance: switchStance && turns > 0,
    grabs: grabNames,
    longestGrab,
  };
}
