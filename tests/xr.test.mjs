// WebXR controller mapping (the immersive session itself can't run headless).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xrInput } from '../web/src/xr.js';

const pad = (axes, pressed = []) => ({ axes, buttons: Array.from({ length: 6 }, (_, i) => ({ pressed: pressed.includes(i) })) });

test('xr: left stick is the d-pad, A/B/X/Y are Z/X (a stick click does nothing: there is no Start), right stick walks', () => {
  const r = xrInput([
    { handedness: 'left', gamepad: pad([0, 0, -0.9, 0.8], [4, 3]) },
    { handedness: 'right', gamepad: pad([0, 0, 0.3, -1], [5]) },
  ]);
  assert.deepEqual([...r.keys].sort(), ['ArrowDown', 'ArrowLeft', 'KeyX', 'KeyZ'].sort());
  assert.deepEqual(r.move, { x: 0.3, y: -1 });
});

test('xr: small stick movements are ignored', () => {
  const r = xrInput([{ handedness: 'left', gamepad: pad([0, 0, 0.3, -0.2]) }, { handedness: 'right', gamepad: pad([0, 0, 0.1, 0.05]) }]);
  assert.equal(r.keys.size, 0);
  assert.deepEqual(r.move, { x: 0, y: 0 });
});
