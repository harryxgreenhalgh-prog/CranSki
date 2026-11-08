// Tunable physics and trick constants. Every value here is a starting point to tune.

export const DT = 1 / 120; // fixed simulation step (s)

export const PHYS = {
  gravity: 13.0, // arcade gravity (m/s^2), a little heavier than real for snappier airs
  dragStand: 0.0026, // air drag coefficient (1/m) standing tall
  dragTuck: 0.0009, // tucked
  dragAir: 0.0008,
  snowFriction: 0.025, // rolling friction as a fraction of normal force
  brakeDecel: 9, // extra deceleration while braking (m/s^2)
  turnRateSlow: 2.4, // carve yaw rate at low speed (rad/s)
  turnRateFast: 0.75, // carve yaw rate at top speed (rad/s)
  turnRateSlide: 2.6, // yaw rate while powersliding (rad/s)
  gripCarve: 9, // how fast sideways slip is scrubbed while carving (1/s)
  gripSlide: 2.2, // sideways slip scrub while powersliding
  carveEfficiency: 0.92, // share of velocity that follows the skis through a carve
  poleAccel: 2.8, // poling push on flats (m/s^2)
  poleMaxSpeed: 7, // poling stops helping above this speed (m/s)
  stickGap: 0.12, // max gap (m) to stay glued to the snow over bumps
  stickNormalSpeed: 1.6, // max speed away from the snow (m/s) to stay glued
  popMin: 2.6, // pop impulse with no load (m/s)
  popMax: 6.2, // pop impulse with a full load (m/s)
  loadTime: 0.45, // seconds to fully load the pop
  popBufferTime: 0.8, // early pop on a kicker face is held this long for the lip
  windupRate: 3.0, // wind-up build rate while loading (1/s)
  windupThrowTime: 0.45, // a full wind-up spins as if A/D were held this long
};

export const AIR = {
  spinRate: 420, // deg/s around the body's vertical axis
  flipRate: 340, // deg/s front/back flips
  rollRate: 340, // deg/s side rolls
  offAxisRate: 430, // deg/s around a tilted (cork/bio/rodeo/misty/flat) axis
  grabSpinBoost: 1.1, // holding a grab speeds up the spin a little
  spinUpRate: 9, // how fast rotation reaches the target rate when a key is held (1/s)
  spinDownRate: 7, // how fast rotation dies after keys are released (1/s)
  comboWindow: 0.25, // spin + flip within this time after take-off makes an off-axis trick
  lateTilt: 0.3, // a spin (or flip) added after the window only tilts the rotation
  alignRate: 260, // deg/s the body lines up for landing once inputs are released
  alignTime: 0.55, // start lining up this long before predicted touchdown
  // Axis tilt from vertical for each off-axis family (deg); holding the flip key adds tilt.
  tilt: { cork: 30, bio: 30, rodeo: 46, misty: 46, flat: 42 },
  tiltMin: 18,
  tiltMax: 52,
  tiltRate: 22, // deg/s of extra tilt while the flip key is held
};

export const LAND = {
  cleanYaw: 25, // skis within this many degrees of the travel line = clean
  sidewaysYaw: 65, // up to here = sideways ride-away keeping 100%..50%
  maxTilt: 50, // body more than this from the slope normal = over-rotated crash
  stompedPitch: 15, // tips/tails first beyond this (still clean) shows STOMPED
  maxSpinHeld: 90, // deg/s: still rotating this fast at touchdown with a key held = crash
  minScoredAir: 0.45, // shorter airs score nothing...
  minScoredHeight: 1.0, // ...unless they got at least this high
  bankDelay: 1.5, // seconds on snow after a landing before the line banks
};

export const CRASH = {
  friction: 0.55, // fraction of gravity used as sliding friction
  minTime: 1.4, // shortest time lying in the snow
  restSpeed: 1.2, // get up once slower than this (m/s)
  getUpTime: 0.6,
};
