import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeTrick, roundSpin, countFlips } from '../src/sim/tricks.js';

const name = (air) => describeTrick(air)?.name ?? null;

test('spins are named in 180s; a quick tap is nothing', () => {
  assert.equal(name({ family: 'spin', spin: 100 }), null);
  assert.equal(name({ family: 'spin', spin: 175 }), '180');
  assert.equal(name({ family: 'spin', spin: -540 }), '540');
  assert.equal(name({ family: 'spin', spin: 1450 }), '1440');
  assert.equal(roundSpin(149), 0);
});

test('flips and sideflips', () => {
  assert.equal(name({ family: 'flip', flip: 360 }), 'BACKFLIP');
  assert.equal(name({ family: 'flip', flip: -360 }), 'FRONTFLIP');
  assert.equal(name({ family: 'flip', flip: -720 }), 'DOUBLE FRONTFLIP');
  assert.equal(name({ family: 'flip', flip: 360, spin: 180 }), 'BACKFLIP 180');
  assert.equal(name({ family: 'side', roll: 360 }), 'SIDEFLIP');
});

test('off-axis families', () => {
  assert.equal(name({ family: 'cork', spin: 620, flip: 360 }), 'CORK 720');
  assert.equal(name({ family: 'cork', spin: 800, flip: 720 }), 'DOUBLE CORK 1080');
  assert.equal(name({ family: 'cork', spin: 950, flip: 1080 }), 'TRIPLE CORK 1440');
  assert.equal(name({ family: 'bio', spin: 470, flip: -270 }), 'BIO 540');
  assert.equal(name({ family: 'rodeo', spin: 500, flip: 500 }), 'RODEO 720');
  assert.equal(name({ family: 'misty', spin: 380, flip: -380 }), 'MISTY 540');
  assert.equal(name({ family: 'flat', spin: 380, roll: 380 }), 'FLATSPIN 540');
});

test('a fast tumble counts each flip once', () => {
  assert.equal(countFlips(1080), 3);
  assert.equal(countFlips(1100), 3);
  assert.notEqual(name({ family: 'misty', spin: 1000, flip: -1100 }).startsWith('5X'), true);
});

test('switch and grabs are added to the name', () => {
  assert.equal(name({ family: 'spin', spin: 1080, switchStance: true, grabs: [{ name: 'japan', time: 0.5 }] }), 'SWITCH 1080 JAPAN');
  assert.equal(name({ family: 'spin', spin: 720, grabs: [{ name: 'mute', time: 0.3 }, { name: 'tail', time: 0.3 }] }), '720 MUTE TAIL');
});

test('ranking at equal rotation: double cork > cork > flatspin', () => {
  const inv = (air) => {
    const d = describeTrick(air);
    return Math.pow(d.invertBonus, d.inversions);
  };
  const dc = inv({ family: 'cork', spin: 800, flip: 720 });
  const c = inv({ family: 'cork', spin: 1000, flip: 450 });
  const f = inv({ family: 'flat', spin: 1000, roll: 450 });
  assert.ok(dc > c && c > f);
});

test('snowboard tricks add FS / BS / Cab', () => {
  assert.equal(name({ family: 'spin', spin: 720, board: true }), 'FS 720');
  assert.equal(name({ family: 'spin', spin: -540, board: true }), 'BS 540');
  assert.equal(name({ family: 'spin', spin: 1080, board: true, switchStance: true }), 'CAB 1080');
  assert.equal(name({ family: 'cork', spin: -800, flip: 720, board: true }), 'BS DOUBLE CORK 1080');
});

test('every Locker grab has a display name', () => {
  assert.equal(name({ family: 'spin', spin: 360, grabs: [{ name: 'rocket', time: 0.5 }] }), '360 ROCKET AIR');
  assert.equal(name({ family: 'spin', spin: 360, grabs: [{ name: 'truenose', time: 0.5 }] }), '360 TRUE NOSE');
  assert.equal(name({ family: null, grabs: [{ name: 'backscratcher', time: 0.5 }] }), 'BACKSCRATCHER');
});
