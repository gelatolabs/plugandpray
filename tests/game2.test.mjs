import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RETRO } from './harness.mjs';
import { makeHost } from './host.mjs';
import { Game2 } from '../web/src/modes/game2.js';

const S = { PRESENT: 0, P1X: 1, P1ST: 5, P2ST: 6, PROJ: 7 };
const bit = (b) => 1 << b;
// the GB held over the top left of the TV picture (FlatLink units: the picture is 4 x 3)
const OVER_TV = { x: 0.6, y: 0.3, w: 0.6 };
// lower down, its screen within jumping reach of the TV's floor
const LOW = { x: 0.6, y: 0.9, w: 0.6 };
// smaller and higher up: too high for the CPU to jump into
const HIGH = { x: 0.6, y: 0.1, w: 0.3 };
// Steps through a list of [frames, gbMask, ps1Mask].
const play = (h, seq) => { for (const [n, a, b] of seq) h.run(n, a, b); };
// down, right + A on the GB: Gelato Blast to the right
const BLAST_RIGHT = [[4, bit(RETRO.DOWN), 0], [3, bit(RETRO.RIGHT), 0], [2, bit(RETRO.RIGHT) | bit(RETRO.A), 0]];

test('game 2: round starts with the player on the GB and the CPU on the PS1', async () => {
  const h = await makeHost(Game2, 2);
  h.run(100);
  assert.equal(h.gb.link.state(S.PRESENT), 1);
  assert.equal(h.ps1.link.state(S.PRESENT), 2);
  h.gb.snap('g2-gb-start.png');
  h.ps1.snap('g2-ps1-start.png');
});

test('game 2: fighters and projectiles drop out of the GB into the TV; unlinked edges are walls', async () => {
  const h = await makeHost(Game2, 2);
  h.run(100);
  // unlinked: walking right on the GB stops at the edge
  h.run(150, bit(RETRO.RIGHT));
  assert.equal(h.mode.where[1], 'gb');
  assert.equal(h.gb.link.state(S.PRESENT) & 1, 1);
  // hold the GB over the TV and throw a Gelato Blast out of its right side
  h.app.linkGeo.place(OVER_TV);
  h.run(5);
  play(h, BLAST_RIGHT);
  const crossed = h.until(() => h.msgs.some(([s, m]) => s === 'gb' && m[0] === 2 && m[3] === 1), 200);
  assert.ok(crossed, 'projectile left the GB');
  h.run(3);
  h.ps1.snap('g2-ps1-bit-blast.png');
  // and walk across
  const walked = h.until(() => h.mode.where[1] === 'ps1', 300, () => [bit(RETRO.RIGHT), 0]);
  assert.ok(walked, 'player crossed to the PS1');
  h.run(2);
  const x = h.ps1.link.state(S.P1X);
  assert.ok(x > 90 && x < 140, `dropped into the TV just right of the GB (x=${x})`);
  h.run(40);
  assert.equal(h.ps1.link.state(S.PRESENT) & 1, 1);
  assert.equal(h.ps1.link.state(2), 0, 'fell to the floor');
  h.ps1.snap('g2-ps1-both.png');
});

test('game 2: jumping up into the GB from the TV', async () => {
  const h = await makeHost(Game2, 2, { gb: HIGH });
  h.run(100);
  assert.ok(h.until(() => h.mode.where[1] === 'ps1', 300, () => [bit(RETRO.RIGHT), 0]));
  h.run(40);
  assert.equal(h.mode.portal.h0 > 118, true, 'out of reach up there');
  // putting the GB down right over him doesn't pick him up
  const px = h.ps1.link.state(S.P1X) / 256 * 4;
  h.app.linkGeo.place({ x: px - 0.3, y: 2.0, w: 0.6 });
  h.run(20);
  assert.ok(h.mode.portal.h0 <= 32, `covers him (${JSON.stringify(h.mode.portal)})`);
  assert.equal(h.mode.where[1], 'ps1', 'not scooped up');
  assert.equal(h.ps1.link.state(S.PRESENT) & 1, 1);
  // bring the GB down over him and jump
  h.app.linkGeo.place(LOW);
  h.run(2);
  const mid = (h.mode.portal.x0 + h.mode.portal.x1) / 2;
  h.until(() => Math.abs(h.ps1.link.state(S.P1X) - mid) < 6, 120,
    () => [0, bit(h.ps1.link.state(S.P1X) < mid ? RETRO.RIGHT : RETRO.LEFT)]);
  const x = h.ps1.link.state(S.P1X);
  assert.ok(x >= h.mode.portal.x0 && x <= h.mode.portal.x1, `under the GB (x=${x}, ${JSON.stringify(h.mode.portal)})`);
  const inGb = h.until(() => h.mode.where[1] === 'gb', 120, () => [0, bit(RETRO.UP)]);
  assert.ok(inGb, 'jumped up into the GB');
  h.run(40);
  assert.equal(h.gb.link.state(S.PRESENT) & 1, 1);
  h.gb.snap('g2-gb-jumped-in.png');
});

test('game 2: projectiles fly across a gap between the screens', async () => {
  // the GB well off to the left of the picture: not linked, but level with it
  const h = await makeHost(Game2, 2, { gb: { x: -1.6, y: 0.9, w: 0.6 } });
  h.run(100);
  assert.equal(h.app.linkGeo.linked, false);
  h.run(150, bit(RETRO.RIGHT));
  assert.equal(h.mode.where[1], 'gb', 'the edge is still a wall for fighters');
  play(h, BLAST_RIGHT);
  assert.ok(h.until(() => h.mode.flying.length > 0, 200), 'Gelato Blast left the GB');
  const frames = h.mode.flying[0].frames;
  const out = h.msgs.findLast(([s, m]) => s === 'gb' && m[0] === 2 && m[3] === 1)[1];
  assert.equal(h.mode.flying[0].msg[1], out[2], 'arrives at the height it left at (relative to the fighters)');
  assert.ok(frames > 5, `takes a while to cross (${frames} frames)`);
  assert.ok(h.until(() => h.ps1.link.state(S.PROJ) & 1, frames + 10), 'arrived on the TV');
  h.ps1.snap('g2-ps1-across-gap.png');
  // shooting off the left edge of the GB goes nowhere
  h.run(60, bit(RETRO.LEFT));
  play(h, [[4, bit(RETRO.DOWN), 0], [3, bit(RETRO.LEFT), 0], [2, bit(RETRO.LEFT) | bit(RETRO.A), 0]]);
  h.run(120);
  assert.equal(h.mode.flying.length, 0);
});


const thrown = (h, sys) => h[sys].link.state(S.PROJ) & 1;

test('game 2: combos - down, forward + Z throws a Gelato Blast; plain Z punches, X blocks', async () => {
  const h = await makeHost(Game2, 2);
  h.run(100);
  const { LEFT, RIGHT, DOWN, A, B } = RETRO;
  // GB: plain A punches, B blocks
  play(h, [[3, bit(A), 0]]);
  assert.equal(h.gb.link.state(S.P1ST), FS.ATTACK, 'a punch');
  play(h, [[30, 0, 0], [3, bit(B), 0]]);
  assert.equal(h.gb.link.state(S.P1ST), FS.BLOCK, 'blocking');
  play(h, [[30, 0, 0]]);
  assert.equal(thrown(h, 'gb'), 0, 'no projectile from Z or X');
  // down, right, Z: Gelato Blast
  play(h, [[4, bit(DOWN), 0], [3, bit(DOWN) | bit(RIGHT), 0], [3, bit(RIGHT), 0], [2, bit(RIGHT) | bit(A), 0]]);
  assert.ok(h.until(() => thrown(h, 'gb'), 20), 'Gelato Blast');
  h.gb.snap('g2-gb-combo-blast.png');
  h.run(120);
  // back, forward, X: just a block (no specials on X)
  play(h, [[4, bit(LEFT), 0], [3, 0, 0], [3, bit(RIGHT), 0], [2, bit(RIGHT) | bit(B), 0]]);
  assert.equal(h.gb.link.state(S.P1ST), FS.BLOCK, 'blocking');
  assert.equal(thrown(h, 'gb'), 0);
});

test('game 2: combos on the PS1', async () => {
  const h = await makeHost(Game2, 2, { gb: HIGH });
  h.run(100);
  assert.ok(h.until(() => h.mode.where[1] === 'ps1', 400, () => [bit(RETRO.RIGHT), 0]));
  h.mode.think = () => 0;   // (the CPU stands still: it's on the TV too, and would punch him out of it)
  h.run(30);
  const { RIGHT, DOWN } = RETRO;
  // back off out of the CPU's reach first (the slow Gelato Blast can be punched out of)
  h.run(30, 0, bit(RETRO.LEFT));
  play(h, [[4, 0, bit(DOWN)], [3, 0, bit(DOWN) | bit(RIGHT)], [3, 0, bit(RIGHT)], [2, 0, bit(RIGHT) | bit(RETRO.B)]]);
  assert.ok(h.until(() => thrown(h, 'ps1'), 20), 'Gelato Blast');
  h.ps1.snap('g2-ps1-combo-blast.png');
});

test('game 2: the CPU jumps over projectiles', async () => {
  const h = await makeHost(Game2, 2, { gb: HIGH });
  h.run(100);
  // the player stays on the GB; the CPU hangs back (rather than shooting, which
  // would cancel the projectiles out)
  h.mode.ai.plan = { kind: 'wait', t: 1e9, stalls: 0 };
  // projectiles flying at the CPU from across the screen (as if thrown from the GB)
  let dodged = 0;
  for (let k = 0; k < 10; k++) {
    h.run(30);
    const cx = h.ps1.link.state(3), fromRight = cx < 128;
    const hp = h.mode.hp[1];
    h.ps1.link.send(1, 0, 40, 1, 2, 1, fromRight ? 250 : 5, fromRight ? 1 : 0);
    let jumped = false;
    h.until(() => {
      if (h.ps1.link.state(S.P2ST) === 2) jumped = true;
      return !thrown(h, 'ps1');
    }, 200);
    if (jumped && h.mode.hp[1] === hp) dodged++;
  }
  assert.ok(dodged >= 3, `CPU jumped over projectiles (${dodged} of 10)`);   // (half the time, in round 1)
});

test('game 2: moving the GB away just as the player walks off it puts him back on the GB', async () => {
  const h = await makeHost(Game2, 2, { gb: OVER_TV });
  h.run(100);
  // the link goes away between the GB leaving him out and the host routing him
  const onMessage = h.mode.onMessage.bind(h.mode);
  h.mode.onMessage = (from, m) => {
    if (from === 'gb' && m[0] === 2 && m[3] === 0) h.app.linkGeo.place(null);
    onMessage(from, m);
  };
  assert.ok(h.until(() => h.msgs.some(([s, m]) => s === 'gb' && m[0] === 2 && m[3] === 0), 300, () => [bit(RETRO.RIGHT), 0]),
    'walked off the GB');
  h.run(30);
  assert.equal(h.mode.where[1], 'gb');
  assert.equal(h.gb.link.state(S.PRESENT) & 1, 1, 'back on the GB');
  // and he can still walk around (the edge is a wall again)
  h.run(60, bit(RETRO.LEFT));
  assert.ok(h.gb.link.state(S.P1X) < 200, 'walks back left');
});

test('game 2: a fighter missing from both screens is put back', async () => {
  const h = await makeHost(Game2, 2);
  h.run(100);
  h.mode.where[1] = 'gb';
  // a lost message: the GB's player vanishes without anything arriving anywhere
  h.mode.onMessage = () => {};
  h.app.linkGeo.place(OVER_TV);
  assert.ok(h.until(() => !(h.gb.link.state(S.PRESENT) & 1), 300, () => [bit(RETRO.RIGHT), 0]));
  h.app.linkGeo.place(null);
  assert.ok(h.until(() => h.gb.link.state(S.PRESENT) & 1, 120), 'respawned on the GB');
});

test('game 2: hits on the PS1 reduce health and a KO ends the round', async () => {
  const h = await makeHost(Game2, 2, { gb: HIGH });
  h.run(100);
  assert.ok(h.until(() => h.mode.where[1] === 'ps1', 400, () => [bit(RETRO.RIGHT), 0]));
  // close in on the CPU and mash punch
  const hit = h.until(() => h.mode.hp[1] < 100, 900, (n) => {
    const toward = h.ps1.link.state(3) < h.ps1.link.state(1) ? RETRO.LEFT : RETRO.RIGHT;
    return [0, (n % 8 < 3 ? bit(RETRO.B) : 0) | (n % 8 > 3 ? bit(toward) : 0)];
  });
  assert.ok(hit, 'player landed a hit on the PS1');
  h.ps1.snap('g2-ps1-fight.png');
  h.mode.hp[1] = 1;
  const ko = h.until(() => h.mode.phase === 'ko', 900, (n) => {
    const toward = h.ps1.link.state(3) < h.ps1.link.state(1) ? RETRO.LEFT : RETRO.RIGHT;
    return [0, (n % 8 < 3 ? bit(RETRO.B) : 0) | (n % 8 > 3 ? bit(toward) : 0)];
  });
  assert.ok(ko);
  assert.deepEqual(h.mode.wins, [1, 0]);
  h.run(40);
  h.ps1.snap('g2-ps1-ko.png');
  h.run(200);
  assert.equal(h.mode.round, 1, 'round 2 started');
  assert.equal(h.mode.hp[1], 100);
});

test('game 2: the CPU comes looking for the player and fights back', async () => {
  const h = await makeHost(Game2, 2, { gb: LOW });
  h.run(100);
  // the player idles on the GB; the CPU holds its own screen a while, then
  // should jump up into it and attack
  const came = h.until(() => h.mode.where[2] === 'gb', 3600);
  assert.ok(came, 'CPU crossed to the GB');
  const hurt = h.until(() => h.mode.hp[0] < 100, 1200);
  assert.ok(hurt, 'CPU damaged the player');
  h.gb.snap('g2-gb-cpu.png');
});

test('game 2: winning two rounds wins the match and unlocks the next game', async () => {
  const h = await makeHost(Game2, 2);
  h.run(100);
  for (let round = 0; round < 2; round++) {
    h.mode.hp[1] = 0;
    h.mode.roundOver(1);
    h.run(200);
  }
  assert.equal(h.mode.over, true);
  assert.deepEqual(h.app.wins, [2]);
  h.run(30);
  h.gb.snap('g2-gb-win.png');
});

// up, right, down, left + A: the backflip (frames per step)
const FLIP = (a) => [[3, bit(RETRO.UP)], [4, bit(RETRO.RIGHT)], [4, bit(RETRO.DOWN)], [4, bit(RETRO.LEFT)], [2, bit(RETRO.LEFT) | bit(a)]];
const FS = { IDLE: 0, JUMP: 2, ATTACK: 3, BLOCK: 4, FLIP: 8, CLAP: 9, STUN: 10 };

test('game 2: A in the air is a flying kick, once a jump (B does nothing up there)', async () => {
  const h = await makeHost(Game2, 2);
  h.run(100);
  const { UP, A, B } = RETRO;
  h.run(6, bit(UP));
  assert.equal(h.gb.link.state(S.P1ST), FS.JUMP);
  h.run(2, bit(B));
  assert.equal(h.gb.link.state(S.P1ST), FS.JUMP, 'no block in the air');
  h.run(4, bit(A));
  assert.equal(h.gb.link.state(S.P1ST), FS.ATTACK, 'a flying kick');
  assert.ok(h.gb.link.state(2) > 0, 'still in the air');
  h.gb.snap('g2-gb-air-kick.png');
  assert.ok(h.until(() => h.gb.link.state(S.P1ST) === FS.JUMP, 60), 'back to falling');
  h.run(2, bit(A));
  assert.notEqual(h.gb.link.state(S.P1ST), FS.ATTACK, 'only one a jump');
  assert.ok(h.until(() => h.gb.link.state(2) === 0 && h.gb.link.state(S.P1ST) === 0, 60), 'lands standing');
});

test('game 2: up, forward, down, back + A backflips; landing it stuns the CPU, clapping (once in a while)', async () => {
  const h = await makeHost(Game2, 2, { gb: HIGH });
  h.run(100);
  // over to the CPU on the TV
  assert.ok(h.until(() => h.mode.where[1] === 'ps1', 400, () => [bit(RETRO.RIGHT), 0]));
  assert.ok(h.until(() => h.ps1.link.state(2) === 0, 60));
  h.mode.think = () => 0;   // (the CPU stands still: it can backflip away itself)
  const seq = FLIP(RETRO.B).flatMap(([n, m]) => Array(n).fill(m));
  const seen = new Set();
  for (const m of seq) { h.step(0, m); seen.add(h.ps1.link.state(S.P1ST)); }
  assert.ok(h.until(() => h.ps1.link.state(S.P1ST) === FS.FLIP, 10), 'flipping');
  h.run(10);
  h.ps1.snap('g2-ps1-backflip.png');
  assert.ok(h.until(() => h.ps1.link.state(S.P2ST) === FS.STUN, 120), 'the CPU is stunned as he lands');
  assert.notEqual(h.ps1.link.state(S.P1ST), FS.FLIP, 'landed');
  h.run(10);
  h.ps1.snap('g2-ps1-clap.png');
  h.run(30);
  h.ps1.snap('g2-ps1-stunned.png');
  assert.equal(h.ps1.link.state(S.P2ST), FS.STUN, 'for a while');
  // once it wears off, another backflip straight away doesn't stun him again
  assert.ok(h.until(() => h.ps1.link.state(S.P2ST) !== FS.STUN, 200), 'it wears off');
  for (const m of seq) h.step(0, m);
  assert.ok(h.until(() => h.ps1.link.state(S.P1ST) === FS.FLIP, 20), 'flipping again');
  assert.ok(h.until(() => h.ps1.link.state(S.P1ST) !== FS.FLIP, 120), 'landed again');
  h.run(5);
  assert.notEqual(h.ps1.link.state(S.P2ST), FS.STUN, 'not stunned again so soon');
});

test('game 2: a backflip stuns the CPU from the other screen, however far away (by way of the host)', async () => {
  const h = await makeHost(Game2, 2);
  h.run(100);
  assert.equal(h.mode.where[1], 'gb');
  assert.equal(h.mode.where[2], 'ps1');
  h.mode.think = () => 0;
  for (const m of FLIP(RETRO.A).flatMap(([n, m]) => Array(n).fill(m))) h.step(m, 0);
  assert.ok(h.until(() => h.gb.link.state(S.P1ST) === FS.FLIP, 10), 'flipping on the GB');
  assert.ok(h.until(() => h.ps1.link.state(S.P2ST) === FS.STUN, 120), 'the CPU, on the TV, is stunned as he lands');
  assert.ok(h.msgs.some(([s, m]) => s === 'gb' && m[0] === 20 && m[1] === 2), 'the GB told the host');
});

test('game 2: the backflip on the GB, upside down halfway', async () => {
  const h = await makeHost(Game2, 2);
  h.run(100);
  const seq = FLIP(RETRO.A).flatMap(([n, m]) => Array(n).fill(m));
  for (const m of seq) h.step(m, 0);
  assert.ok(h.until(() => h.gb.link.state(S.P1ST) === FS.FLIP, 10), 'flipping');
  h.run(12);
  h.gb.snap('g2-gb-backflip.png');
  assert.ok(h.until(() => h.gb.link.state(S.P1ST) !== FS.FLIP, 200), 'lands');
});

test('game 2: on the GelatoStation Cross punches (wind up, out, back) and Square blocks', async () => {
  const h = await makeHost(Game2, 2, { gb: HIGH });
  h.run(100);
  assert.ok(h.until(() => h.mode.where[1] === 'ps1', 400, () => [bit(RETRO.RIGHT), 0]));
  h.mode.think = () => 0;
  h.run(40, 0, bit(RETRO.LEFT));
  h.run(20);
  h.run(2, 0, bit(RETRO.B));
  assert.equal(h.ps1.link.state(S.P1ST), FS.ATTACK, 'a punch');
  h.run(4);
  h.ps1.snap('g2-ps1-punch.png');
  assert.ok(h.until(() => h.ps1.link.state(S.P1ST) === FS.IDLE, 60), 'and back');
  h.run(3, 0, bit(RETRO.Y));
  assert.equal(h.ps1.link.state(S.P1ST), FS.BLOCK, 'blocking');
});
