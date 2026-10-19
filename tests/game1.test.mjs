// Game 1 "Rocky Road Trip" with the real host mode (web/src/modes/game1.js) and a
// flat stand-in for the camera's view: the TV picture is 4 x 3 units (y down)
// and the GB screen is a rectangle {x, y, w} placed over it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RETRO } from './harness.mjs';
import { makeHost } from './host.mjs';
import { Game1 } from '../web/src/modes/game1.js';

const ST = { LEVEL: 0, PRESENT: 1, LEVELS: 6, X: 7, Y: 8, MAP: 16 };
const MSG_GOAL = 16, MSG_DIED = 17;
const W = 0.6;   // GB screen width in view units used throughout

const KEY = { left: 1 << RETRO.LEFT, right: 1 << RETRO.RIGHT, none: 0 };
const JUMP = { gb: 1 << RETRO.A, ps1: 1 << RETRO.B };

async function level(n, gb = null) {
  const h = await makeHost(Game1, 1, { gb });
  h.run(10);
  if (n) {
    h.mode.load(n);
    h.run(10);
  }
  assert.equal(h.gb.link.state(ST.LEVEL), n);
  assert.equal(h.ps1.link.state(ST.LEVEL), n);
  return h;
}

const pos = (h, sys) => [h[sys].link.state(ST.X), h[sys].link.state(ST.Y)];
const got = (h, type) => h.msgs.some(([, m]) => m[0] === type);
const place = (h, x, y) => h.app.linkGeo.place({ x, y, w: W });

// Holds a direction (the same keys go to both consoles, like the keyboard)
// until pred() is true; jumpWhen(x, y, sys) adds a jump press.
function hold(h, dir, pred, { max = 900, jumpWhen = () => false } = {}) {
  let jumped = false;
  for (let i = 0; i < max; i++) {
    const sys = h.mode.where;
    const [x, y] = pos(h, sys);
    const jump = !jumped && jumpWhen(x, y, sys);
    jumped = jump;
    const k = KEY[dir];
    h.step(k | (jump ? JUMP.gb : 0), k | (jump ? JUMP.ps1 : 0));
    if (pred()) return true;
  }
  return false;
}

test('game 1: both halves load levels and publish their tiles', async () => {
  const h = await level(0);
  assert.equal(h.gb.link.state(ST.LEVELS), 6);
  assert.equal(h.gb.link.state(ST.PRESENT), 1, 'level 1 starts on the GB');
  assert.equal(h.ps1.link.state(ST.PRESENT), 0);
  const row = (sys, r) => h[sys].link.state(ST.MAP + r * 2) | (h[sys].link.state(ST.MAP + r * 2 + 1) << 8);
  assert.equal(row('gb', 8), 0x3ff, 'GB floor is solid');
  assert.equal(row('gb', 7), 0);
  assert.equal(row('ps1', 8), 0xfff);
  h.gb.snap('g1-gb-l1.png');
  h.run(30);
  h.ps1.snap('g1-ps1-l1.png');
});

test('game 1 level 1: edges are walls until the GB touches the TV, then he steps out into the middle of it', async () => {
  const h = await level(0);
  assert.equal(hold(h, 'right', () => got(h, 2), { max: 240 }), false, 'no exit while unlinked');
  assert.equal(h.gb.link.state(ST.PRESENT), 1);
  assert.ok(pos(h, 'gb')[0] >= 150, 'walked up to the right edge');
  // hold the GB over the left half of the picture
  place(h, 0.5, 0.5);
  h.run(3);
  h.gb.snap('g1-gb-linked.png');
  assert.ok(hold(h, 'right', () => h.ps1.link.state(ST.PRESENT) === 1, { max: 120 }), 'stepped onto the TV');
  const [x] = pos(h, 'ps1');
  assert.ok(x > 50 && x < 100, `arrived beside the GB, in the middle of the TV (x=${x})`);
  h.run(20);
  h.ps1.snap('g1-ps1-entered.png');
  assert.ok(hold(h, 'right', () => got(h, MSG_GOAL), { max: 600 }), 'reached the goal');
  h.run(10);
  h.ps1.snap('g1-ps1-goal.png');
  h.run(120);
  assert.equal(h.mode.level, 1, 'next level loaded');
});

test('game 1 level 2 (hop in): hold the GB over the pit and jump up into it', async () => {
  const h = await level(1);
  assert.equal(h.ps1.link.state(ST.PRESENT), 1, 'starts in the pit on the TV');
  assert.equal(hold(h, 'right', () => got(h, 2) || h.gb.link.state(ST.PRESENT), { max: 120, jumpWhen: () => true }), false,
    'stuck in the pit');
  h.run(60);           // land
  const [x, y] = pos(h, 'ps1');
  // moving the GB right over him doesn't pick him up
  place(h, (x - 14) / 48, (y - 20) / 48);
  h.run(10);
  assert.equal(h.ps1.link.state(ST.PRESENT), 1, 'not scooped up');
  assert.equal(h.gb.link.state(ST.PRESENT), 0);
  // GB held just above his head: jump into it
  place(h, (x - 14) / 48, (y - 14 - 20 - 26) / 48);
  h.run(3);
  assert.equal(h.ps1.link.state(ST.PRESENT), 1);
  assert.ok(h.until(() => h.gb.link.state(ST.PRESENT) === 1, 60, (i) => [0, i < 20 ? JUMP.ps1 : 0]), 'jumped up into the GB');
  assert.equal(h.ps1.link.state(ST.PRESENT), 0);
  h.gb.snap('g1-l2-gb-in.png');
  assert.ok(hold(h, 'right', () => got(h, MSG_GOAL), { max: 300 }), 'reached the goal on the GB');
});

test('game 1 level 3 (lift): ride the GB up to the ledge', async () => {
  const h = await level(2);
  place(h, 1.2, 2.066);
  assert.ok(hold(h, 'right', () => h.gb.link.state(ST.PRESENT) === 1, { max: 300 }), 'walked into the GB');
  h.run(10);
  assert.equal(pos(h, 'gb')[1], 128, 'standing on the GB floor');
  place(h, 2.226, 0.4);
  h.run(2);
  assert.ok(hold(h, 'right', () => got(h, MSG_GOAL), { max: 300 }), 'stepped out onto the ledge and the goal');
  h.ps1.snap('g1-l3-ps1-goal.png');
});

test('game 1 level 4 (trapdoor): fall in through the top, drop out through the floor', async () => {
  const h = await level(3);
  place(h, 1.2, 1.0);
  assert.ok(hold(h, 'right', () => h.gb.link.state(ST.PRESENT) === 1, { max: 300 }), 'fell into the GB');
  assert.ok(!got(h, MSG_DIED));
  h.run(40);
  const [x, y] = pos(h, 'gb');
  assert.equal(y, 128, `landed on the GB floor (x=${x})`);
  assert.ok(x < 64, 'beside the trapdoor');
  h.gb.snap('g1-l4-gb-in.png');
  // carry him over the goal, then walk into the hole
  place(h, 3.23, 0.8);
  h.run(2);
  assert.ok(hold(h, 'right', () => pos(h, 'gb')[0] >= 72 || !h.gb.link.state(ST.PRESENT), { max: 200 }));
  assert.ok(h.until(() => got(h, MSG_GOAL) || got(h, MSG_DIED), 200), 'dropped out of the GB');
  assert.ok(got(h, MSG_GOAL) && !got(h, MSG_DIED), 'landed on the goal, not the spikes');
  h.ps1.snap('g1-l4-ps1-goal.png');
});

test('game 1 level 4: dropping out over the spikes kills', async () => {
  const h = await level(3);
  place(h, 1.2, 1.0);
  hold(h, 'right', () => h.gb.link.state(ST.PRESENT) === 1, { max: 300 });
  h.run(40);
  place(h, 2.2, 0.8);
  h.run(2);
  hold(h, 'right', () => pos(h, 'gb')[0] >= 72 || !h.gb.link.state(ST.PRESENT), { max: 200 });
  assert.ok(h.until(() => got(h, MSG_DIED), 200), 'spikes');
  h.run(90);
  assert.equal(h.mode.level, 3, 'level restarts');
  assert.equal(h.ps1.link.state(ST.PRESENT), 1);
});

test('game 1 level 5 (spike ledge): in from the left, carried across, out to the left again', async () => {
  const h = await level(4);
  place(h, 1.074, 1.52);
  assert.ok(hold(h, 'right', () => h.gb.link.state(ST.PRESENT) === 1, { max: 300 }), 'walked into the GB');
  h.run(20);
  assert.equal(pos(h, 'gb')[1], 96, 'standing on the GB ledge');
  assert.ok(!got(h, MSG_DIED));
  // the right side of the GB is all spikes: carry the GB to the right of the goal platform
  place(h, 3.874, 1.52);
  h.run(2);
  assert.ok(hold(h, 'left', () => got(h, MSG_GOAL) || got(h, MSG_DIED), { max: 300 }));
  assert.ok(got(h, MSG_GOAL), 'stepped out onto the goal platform');
  h.ps1.snap('g1-l5-ps1-goal.png');
});

test('game 1 level 6 (round trip): caught by the GB, up to the ledge, then back in through its goal room door', async () => {
  const h = await level(5);
  // there's hardly any floor: walking left without the GB drops him into the pit
  {
    const k = await level(5);
    assert.ok(hold(k, 'left', () => got(k, MSG_DIED), { max: 200 }), 'fell into the pit');
  }
  place(h, 2.8, 2.066);
  assert.ok(hold(h, 'left', () => h.gb.link.state(ST.PRESENT) === 1, { max: 300 }), 'walked into the GB');
  h.run(10);
  // the goal room can't be reached from inside: ride up to the TV's ledge
  place(h, 1.474, 0.4);
  h.run(2);
  assert.ok(hold(h, 'left', () => h.ps1.link.state(ST.PRESENT) === 1, { max: 300 }), 'out onto the ledge');
  h.run(30);
  assert.equal(pos(h, 'ps1')[1], 48, 'standing on the ledge');
  h.ps1.snap('g1-l6-ps1-ledge.png');
  // GB to his right, its goal room door level with him
  place(h, 1.774, 0.64);
  h.run(2);
  assert.ok(hold(h, 'right', () => got(h, MSG_GOAL), { max: 400 }), 'walked in through the door to the goal');
  h.gb.snap('g1-l6-gb-goal.png');
});

test('game 1 level 1: a hint 20 s after the first button press if he is still on the GB, more of it 10 s later', async () => {
  const h = await makeHost(Game1, 1);
  h.run(60 * 25);
  assert.equal(h.mode.hint ?? 0, 0, 'no clock before a button is pressed');
  h.run(10, 1 << RETRO.RIGHT);
  h.run(60 * 19);
  assert.equal(h.mode.hint, 0, 'not yet');
  h.run(60 * 2);
  assert.equal(h.mode.hint, 1, 'its first part');
  h.gb.snap('g1-gb-hint1.png');
  h.ps1.snap('g1-ps1-hint1.png');
  h.run(60 * 10);
  assert.equal(h.mode.hint, 2, 'then all of it');
  h.gb.snap('g1-gb-hint2.png');
  h.ps1.snap('g1-ps1-hint2.png');
  // gone on the next level
  h.mode.load(1);
  h.run(10);
  assert.equal(h.mode.hint, 0);
});

test('game 1: always starts from level 1', async () => {
  const h = await makeHost(Game1, 1, { save: { level1: 4 } });
  h.run(10);
  assert.equal(h.mode.level, 0);
  assert.equal(h.gb.link.state(ST.LEVEL), 0);
});

test('game 1: winning shows the win screens and unlocks game 2', async () => {
  const h = await level(5);
  h.mode.win();
  h.run(60);
  assert.deepEqual(h.app.wins, [1]);
  h.gb.snap('g1-gb-win.png');
  h.ps1.snap('g1-ps1-win.png');
});
