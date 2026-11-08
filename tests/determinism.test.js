import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as dm from '../src/sim/dmath.js';
import { mulberry32 } from '../src/sim/rng.js';

// dmath must agree closely with Math.* (so the physics feel is unchanged).
function close(name, got, want, tol = 4e-16) {
  const err = Math.abs(got - want) / Math.max(1, Math.abs(want));
  assert.ok(err <= tol, `${name}: got ${got}, want ${want} (rel err ${err})`);
}

test('deterministic sin, cos and tan match Math to the last digit or two', () => {
  const rnd = mulberry32(1);
  for (let i = 0; i < 20000; i++) {
    const x = (rnd() - 0.5) * (i % 2 ? 8 : 400);
    close(`sin(${x})`, dm.sin(x), Math.sin(x));
    close(`cos(${x})`, dm.cos(x), Math.cos(x));
    if (Math.abs(Math.cos(x)) > 1e-3) close(`tan(${x})`, dm.tan(x), Math.tan(x), 2e-15);
  }
  assert.equal(dm.sin(0), 0);
  assert.equal(dm.cos(0), 1);
});

test('deterministic atan2, asin and acos match Math', () => {
  const rnd = mulberry32(2);
  for (let i = 0; i < 20000; i++) {
    const y = (rnd() - 0.5) * 20;
    const x = (rnd() - 0.5) * 20;
    close(`atan2(${y}, ${x})`, dm.atan2(y, x), Math.atan2(y, x));
    const u = rnd() * 2 - 1;
    close(`asin(${u})`, dm.asin(u), Math.asin(u), 2e-15);
    close(`acos(${u})`, dm.acos(u), Math.acos(u), 2e-15);
  }
  for (const [y, x] of [[0, 1], [0, -1], [1, 0], [-1, 0], [-0, -1], [0, 0]]) assert.equal(dm.atan2(y, x), Math.atan2(y, x));
  assert.equal(dm.acos(1), 0);
});

test('deterministic exp, log and pow match Math', () => {
  const rnd = mulberry32(3);
  for (let i = 0; i < 20000; i++) {
    const x = (rnd() - 0.5) * 100;
    close(`exp(${x})`, dm.exp(x), Math.exp(x), 6e-16);
    const p = Math.exp((rnd() - 0.5) * 60);
    close(`log(${p})`, dm.log(p), Math.log(p), 6e-16);
    const b = rnd() * 3;
    const e = rnd() * 4;
    close(`pow(${b}, ${e})`, dm.pow(b, e), Math.pow(b, e), 1e-14);
  }
  assert.equal(dm.pow(1.5, 3), 3.375);
  assert.equal(dm.exp(0), 1);
  assert.equal(dm.exp(-800), 0);
});

// Anything the simulation calls must be exact arithmetic or dmath.
test('the simulation never uses engine-dependent maths', () => {
  const banned = [
    /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|expm1|log|log2|log10|log1p|pow|hypot|cbrt|random)\(/,
    /[\w)\]]\s*\*\*\s*[\w(]/, // the exponent operator is engine-approximated too
    /\.(setFromAxisAngle|setFromEuler|slerp|slerpQuaternions|angleTo|rotateTowards|applyAxisAngle|applyEuler|makeRotationAxis|makeRotationX|makeRotationY|makeRotationZ|setFromSphericalCoords|setFromCylindricalCoords)\(/,
    /\b(Date\.now|performance\.now)\(/,
  ];
  const files = [
    ...readdirSync('src/sim').filter((f) => f !== 'dmath.js').map((f) => `src/sim/${f}`),
    ...readdirSync('src/parks').map((f) => `src/parks/${f}`),
    'src/replay/record.js',
  ];
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      for (const re of banned) {
        const m = code.match(re);
        assert.equal(m, null, `${f}:${i + 1} uses ${m && m[0]}`);
      }
    });
  }
});
