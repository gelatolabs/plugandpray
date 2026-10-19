import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHost } from './host.mjs';
import { Game3 } from '../web/src/modes/game3.js';

const S = { COUNT: 0, ENEMIES: 1, ALIVE: 13 };

// Normalised position of the first shootable enemy on a system, or null.
function target(sys) {
  const alive = sys.link.state(S.ALIVE);
  for (let i = 0; i < 6; i++) {
    const u = sys.link.state(S.ENEMIES + i * 2) / 256, v = sys.link.state(S.ENEMIES + i * 2 + 1) / 256;
    if (alive & (1 << i) && v > 0.1 && u > 0.05 && u < 0.95) return [u, v];
  }
  return null;
}

// The START button's middle on the TV (u, v).
const START = { ps1: [156 / 320, 140 / 240] };

// The game past its title: the START button on the TV shot.
async function started(opts) {
  const h = await makeHost(Game3, 3, opts);
  h.run(30);
  h.mode.time += 1;
  h.mode.onShot('ps1', ...START.ps1);
  assert.ok(h.until(() => h.mode.phase !== 'title', 120), 'shooting START starts it');
  return h;
}

test('game 3: a title on both screens, until START is shot (a miss does nothing)', async () => {
  const h = await makeHost(Game3, 3);
  h.run(60);
  assert.equal(h.mode.phase, 'title');
  h.gb.snap('g3-gb-title.png');
  h.ps1.snap('g3-ps1-title.png');
  assert.equal(h.gb.link.state(0) + h.ps1.link.state(0), 0, 'no enemies yet');
  // a miss
  h.mode.time += 1;
  h.mode.onShot('ps1', 0.5, 0.2);
  h.run(30);
  assert.equal(h.mode.phase, 'title', 'missing START does nothing');
  // the GelatoBoy has no START button: shooting it does nothing
  h.mode.time += 1;
  h.mode.onShot('gb', 0.5, 0.4);
  h.run(30);
  assert.equal(h.mode.phase, 'title', 'shooting the GB on the title does nothing');
  // START on the TV starts it
  h.mode.time += 1;
  h.mode.onShot('ps1', ...START.ps1);
  assert.ok(h.until(() => h.mode.phase !== 'title', 120), 'START on the TV starts it');
  assert.ok(h.until(() => h.gb.link.state(0) > 0 || h.ps1.link.state(0) > 0, 900), 'then enemies come');
});

test('game 3: waves spawn enemies on both screens', async () => {
  const h = await started();
  assert.ok(h.until(() => h.gb.link.state(S.COUNT) > 0 && h.ps1.link.state(S.COUNT) > 0, 900));
  h.gb.snap('g3-gb-enemies.png');
  h.ps1.snap('g3-ps1-enemies.png');
});

test('game 3: zapper shots hit and kill enemies on either screen, and flash the screen', async () => {
  const h = await started();
  for (const name of ['gb', 'ps1']) {
    const sys = h[name];
    assert.ok(h.until(() => target(sys), 900), `an enemy on the ${name}`);
    h.run(4);
    const before = h.mode.score;
    const [u, v] = target(sys);
    h.mode.time += 1;
    h.mode.onShot(name, u, v);
    h.step();
    sys.snap(`g3-${name}-flash.png`);
    h.run(3);
    assert.ok(h.mode.score > before, `${name}: score went up (${h.mode.score})`);
  }
  // a shot at empty sky misses
  const before = h.mode.hits;
  h.mode.time += 1;
  h.mode.onShot('ps1', 0.02, 0.98);
  h.run(3);
  assert.equal(h.mode.hits, before);
});

test('game 3: the screens are never linked, and escaping enemies cost lives', async () => {
  const h = await started({ gb: { x: 3.2, y: 0.5, w: 0.6 } });
  const escaped = h.until(() => h.mode.lives < 5, 60 * 30);
  assert.ok(escaped, 'an enemy got away');
  assert.ok(!h.msgs.some(([, m]) => m[0] === 2), 'nothing crossed between the screens');
});

test('game 3: shooting everything clears all waves and wins', async () => {
  const h = await started();
  let frames = 0;
  while (h.mode.phase !== 'won' && frames < 60 * 240) {
    h.step();
    frames++;
    if (frames % 6) continue;
    for (const name of ['gb', 'ps1']) {
      const t = target(h[name]);
      if (t) { h.mode.time += 1; h.mode.onShot(name, t[0], t[1]); }
    }
  }
  assert.equal(h.mode.phase, 'won', `reached wave ${h.mode.wave + 1}, lives ${h.mode.lives}`);
  assert.deepEqual(h.app.wins, [3]);
  assert.equal(h.mode.lives, 5, 'perfect play loses no lives');
  h.run(30);
  h.ps1.snap('g3-ps1-win.png');
  h.gb.snap('g3-gb-win.png');
});

test('game 3: the GelatoBoy keeps up with a screenful of enemies (so they flee and fly as soon as the GelatoStation\'s)', async () => {
  const h = await started();
  h.run(200);
  for (let i = 0; i < 6; i++) { h.gb.link.send(16, i % 3, 60 + i * 20, 1 + (i % 3)); h.run(2); }
  h.run(20);
  const g0 = h.gb.link.frame, p0 = h.ps1.link.frame;
  h.run(120);
  const loops = (sys, f0) => (h[sys].link.frame - f0 + 256) % 256;
  assert.ok(loops('gb', g0) >= 115, `GB game loops in 120 frames: ${loops('gb', g0)}`);
  assert.ok(loops('ps1', p0) >= 115, `PS1 game loops in 120 frames: ${loops('ps1', p0)}`);
});
