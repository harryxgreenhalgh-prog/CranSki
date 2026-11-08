// Deterministic maths for the simulation.
//
// JavaScript only promises exact results for + - * / and sqrt. Math.sin, cos,
// tan, atan2, exp, log, pow and hypot are "implementation-approximated": Chrome,
// Firefox, Safari and the server can each return a slightly different last
// digit, and over thousands of physics steps that can change a landing.
// Leaderboard runs are re-simulated on the server and must match to the last
// bit, so the simulation uses these versions instead, built only from basic
// arithmetic. They follow the classic fdlibm algorithms and agree with Math.*
// to within a couple of units in the last place.

const PIO2_1 = 1.57079632673412561417e0; // first 33 bits of pi/2
const PIO2_1T = 6.07710050650619224932e-11; // pi/2 - PIO2_1
const INVPIO2 = 6.36619772367581382433e-1;
const PIO4 = 7.85398163397448278999e-1;
const PI = 3.14159265358979311600e0;
const PI_LO = 1.22464679914735317720e-16;

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

function kSin(x, y) {
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

function kCos(x, y) {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const hz = 0.5 * z;
  const w = 1 - hz;
  return w + (1 - w - hz + (z * r - x * y));
}

// x = n * pi/2 + (y0 + y1), |y0 + y1| <= pi/4. Accurate for the angles a
// physics step meets (well under a million radians).
let rn = 0;
let ry0 = 0;
let ry1 = 0;
function reduce(x) {
  const n = Math.round(x * INVPIO2);
  const r = x - n * PIO2_1;
  const w = n * PIO2_1T;
  ry0 = r - w;
  ry1 = r - ry0 - w;
  rn = n & 3;
}

export function sin(x) {
  if (!(x === x) || x === Infinity || x === -Infinity) return NaN;
  if (x > -PIO4 && x < PIO4) return kSin(x, 0);
  reduce(x);
  if (rn === 0) return kSin(ry0, ry1);
  if (rn === 1) return kCos(ry0, ry1);
  if (rn === 2) return -kSin(ry0, ry1);
  return -kCos(ry0, ry1);
}

export function cos(x) {
  if (!(x === x) || x === Infinity || x === -Infinity) return NaN;
  if (x > -PIO4 && x < PIO4) return kCos(x, 0);
  reduce(x);
  if (rn === 0) return kCos(ry0, ry1);
  if (rn === 1) return -kSin(ry0, ry1);
  if (rn === 2) return -kCos(ry0, ry1);
  return kSin(ry0, ry1);
}

export function tan(x) {
  if (!(x === x) || x === Infinity || x === -Infinity) return NaN;
  let s;
  let c;
  if (x > -PIO4 && x < PIO4) {
    s = kSin(x, 0);
    c = kCos(x, 0);
  } else {
    reduce(x);
    const a = kSin(ry0, ry1);
    const b = kCos(ry0, ry1);
    if (rn === 0) [s, c] = [a, b];
    else if (rn === 1) [s, c] = [b, -a];
    else if (rn === 2) [s, c] = [-a, -b];
    else [s, c] = [-b, a];
  }
  return s / c;
}

const ATANHI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800e0];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.11111104054623557880e-1, 9.09088713343650656196e-2,
  -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2, 4.97687799461593236017e-2, -3.65315727442169155270e-2,
  1.62858201153657823623e-2,
];

export function atan(x) {
  if (!(x === x)) return NaN;
  const neg = x < 0;
  let a = neg ? -x : x;
  if (a >= 7.378697629483821e19) return neg ? -ATANHI[3] - ATANLO[3] : ATANHI[3] + ATANLO[3]; // >= 2^66
  let id;
  if (a < 0.4375) {
    if (a < 7.450580596923828e-9) return x; // < 2^-27
    id = -1;
  } else if (a < 1.1875) {
    if (a < 0.6875) {
      id = 0;
      a = (2 * a - 1) / (2 + a);
    } else {
      id = 1;
      a = (a - 1) / (a + 1);
    }
  } else if (a < 2.4375) {
    id = 2;
    a = (a - 1.5) / (1 + 1.5 * a);
  } else {
    id = 3;
    a = -1 / a;
  }
  const z = a * a;
  const w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const r = ATANHI[id] - (a * (s1 + s2) - ATANLO[id] - a);
  return neg ? -r : r;
}

export function atan2(y, x) {
  if (!(x === x) || !(y === y)) return NaN;
  if (y === 0) {
    if (x > 0 || (x === 0 && 1 / x > 0)) return y; // +-0
    return 1 / y > 0 ? PI + PI_LO : -PI - PI_LO;
  }
  if (x === 0) return y > 0 ? ATANHI[3] + ATANLO[3] : -ATANHI[3] - ATANLO[3];
  const z = atan(Math.abs(y / x));
  if (x > 0) return y > 0 ? z : -z;
  return y > 0 ? PI - (z - PI_LO) : z - PI_LO - PI;
}

export function asin(x) {
  if (!(x >= -1 && x <= 1)) return NaN;
  return atan2(x, Math.sqrt((1 - x) * (1 + x)));
}

export function acos(x) {
  if (!(x >= -1 && x <= 1)) return NaN;
  return atan2(Math.sqrt((1 - x) * (1 + x)), x);
}

// 2^k as an exact double, built from its bit pattern.
const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
const HI = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0; // index of the high word
const LO = 1 - HI;
function pow2(k) {
  U32[HI] = ((k + 1023) << 20) >>> 0;
  U32[LO] = 0;
  return F64[0];
}

const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INVLN2 = 1.44269504088896338700e0;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.65339022054652515390e-6;
const P5 = 4.13813679705723846039e-8;

export function exp(x) {
  if (!(x === x)) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  let hi = 0;
  let lo = 0;
  let k = 0;
  const ax = x < 0 ? -x : x;
  if (ax > 0.34657359027997264) {
    k = Math.round(INVLN2 * x);
    hi = x - k * LN2_HI;
    lo = k * LN2_LO;
    x = hi - lo;
  } else if (ax < 3.725290298461914e-9) {
    return 1 + x; // < 2^-28
  }
  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  const y = 1 - (lo - (x * c) / (2 - c) - hi);
  if (k >= -1021) return k > 1023 ? y * 2 * pow2(k - 1) : y * pow2(k);
  return y * pow2(k + 1000) * pow2(-1000);
}

const LG1 = 6.666666666666735130e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;
const SQRT2 = 1.4142135623730951;

export function log(x) {
  if (!(x > 0)) return x === 0 ? -Infinity : NaN;
  if (x === Infinity) return Infinity;
  let k = 0;
  if (x < 2.2250738585072014e-308) {
    x *= 18014398509481984; // 2^54: lift subnormals
    k = -54;
  }
  F64[0] = x;
  k += ((U32[HI] >>> 20) & 0x7ff) - 1023;
  U32[HI] = (U32[HI] & 0x000fffff) | 0x3ff00000; // mantissa in [1, 2)
  let m = F64[0];
  if (m > SQRT2) {
    m *= 0.5;
    k += 1;
  }
  const f = m - 1;
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const R = t2 + t1;
  const hfsq = 0.5 * f * f;
  return k * LN2_HI - (hfsq - (s * (hfsq + R) + k * LN2_LO) - f);
}

// x^y. Whole-number powers multiply exactly; others use exp(y * log(x)).
export function pow(x, y) {
  if (y === 0) return 1;
  if (Number.isInteger(y) && Math.abs(y) <= 64) {
    let r = 1;
    let b = x;
    let e = Math.abs(y);
    while (e > 0) {
      if (e & 1) r *= b;
      b *= b;
      e >>= 1;
    }
    return y < 0 ? 1 / r : r;
  }
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x < 0) return NaN;
  return exp(y * log(x));
}

export function hypot(a, b, c = 0) {
  return Math.sqrt(a * a + b * b + c * c);
}

// THREE.Quaternion.setFromAxisAngle, with deterministic sin and cos.
export function quatAxisAngle(q, axis, angle) {
  const h = angle / 2;
  const s = sin(h);
  return q.set(axis.x * s, axis.y * s, axis.z * s, cos(h));
}
