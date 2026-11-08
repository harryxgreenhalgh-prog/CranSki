import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idleReason, IDLE_LIMITS, COUNTDOWN } from '../src/ui/idle.js';

test('idle rules: 1 min paused, 2 min no input, 10 min in a replay', () => {
  assert.equal(IDLE_LIMITS.paused, 60);
  assert.equal(IDLE_LIMITS.input, 120);
  assert.equal(IDLE_LIMITS.replay, 600);
  assert.ok(COUNTDOWN > 0);
  assert.equal(idleReason('paused', 59), null);
  assert.equal(idleReason('paused', 60), 'paused');
  assert.equal(idleReason('riding', 119), null);
  assert.equal(idleReason('riding', 120), 'input');
  assert.equal(idleReason('lift', 120), 'input');
  assert.equal(idleReason('basecamp', 121), 'input');
  assert.equal(idleReason('replay', 599), null);
  assert.equal(idleReason('replay', 120), null); // a replay you're watching isn't "no input"
  assert.equal(idleReason('replay', 600), 'replay');
});
