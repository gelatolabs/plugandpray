// End-to-end tests of the game page (dist/index.html) in headless Chrome.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve, launch, aimAt, clickCenter } from './browser-util.mjs';
import { SNAP, ROOT } from './harness.mjs';

let server, url;
before(async () => {
  server = await serve(ROOT + 'dist');
  url = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server.close());

export async function open(t, { save = null } = {}) {
  const ctx = await launch(url + (save ? '' : ''), {
    ready: () => window.__app?.mode,
  });
  t.after(() => ctx.browser.close());
  if (save) {
    await ctx.page.evaluate((s) => localStorage.setItem('gelatolabs-ld60', JSON.stringify(s)), save);
    await ctx.page.reload();
    await ctx.page.waitForFunction(() => window.__app?.mode, null, { timeout: 60000 });
  }
  await clickCenter(ctx.page);
  return ctx;
}

export async function setCamera(page, pos, yaw, pitch) {
  await page.evaluate(([pos, yaw, pitch]) => {
    const a = window.__app;
    a.camera.position.set(...pos);
    a.fp.yaw = yaw;
    a.fp.pitch = pitch;
  }, [pos, yaw, pitch]);
  await page.waitForTimeout(100);
}

// Picks the GB up (a click with it under the reticle), looks at world
// position `to` so the GB is carried in front of it, then puts it down (right-click).
export async function dragGbOver(page, to) {
  const gbPos = await page.evaluate(() => window.__app.world.gb.group.position.toArray());
  await aimAt(page, gbPos);
  await clickCenter(page);
  await page.waitForTimeout(100);
  await aimAt(page, to);
  await page.waitForTimeout(1500);
  await clickCenter(page, 'right');
}

// World position of a point on the TV picture.
const crtPoint = (page, u, v) => page.evaluate(([u, v]) => window.__app.linkGeo.worldPoint('crt', u, v).toArray(), [u, v]);
const linked = (page) => page.evaluate(() => window.__app.linkGeo.linked);
const g1 = (page) => page.evaluate(() => {
  const a = window.__app;
  return { level: a.mode?.level, where: a.mode?.where, gbPresent: a.gb.link.state(1), psPresent: a.ps1.link.state(1) };
});

async function holdUntil(page, key, pred, timeout = 10000) {
  await page.keyboard.down(key);
  try {
    await page.waitForFunction(pred, null, { timeout, polling: 50 });
  } finally {
    await page.keyboard.up(key);
  }
}

test('game 1: GB edges are walls until the GB is held up in front of the TV, then level 1 can be finished', async (t) => {
  const { page, errors } = await open(t);
  assert.equal((await g1(page)).level, 0);
  await page.waitForFunction(() => window.__app.gb.link.state(1) === 1, null, { timeout: 5000 });

  // walking right with the GB on the desk: blocked at the edge
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(2500);
  await page.keyboard.up('ArrowRight');
  assert.equal((await g1(page)).gbPresent, 1, 'still on the GB');
  assert.equal(await linked(page), false);

  // pick the GB up and hold it in front of the left part of the picture
  await setCamera(page, [-0.1, 1.05, 0.6], 0, -0.25);
  await dragGbOver(page, await crtPoint(page, 0.2, 0.55));
  const gbAt = await page.evaluate(() => window.__app.world.gb.group.position.toArray().map((v) => v.toFixed(3)));
  assert.equal(await linked(page), true, `linked (GB at ${gbAt})`);
  await page.screenshot({ path: SNAP + 'game1-linked.png' });

  await holdUntil(page, 'ArrowRight', () => window.__app.ps1.link.state(1) === 1);
  assert.equal((await g1(page)).gbPresent, 0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: SNAP + 'game1-stepped-out.png' });
  await holdUntil(page, 'ArrowRight', () => window.__app.mode.pending !== null, 25000);
  await page.screenshot({ path: SNAP + 'game1-clear.png' });
  await page.waitForFunction(() => window.__app.mode.level === 1, null, { timeout: 20000 });
  assert.deepEqual(errors.filter((e) => !e.includes('404')), []);
});

test('game 1: level 2 - hold the GB above the character in the pit and jump into it', async (t) => {
  const { page } = await open(t);
  await page.waitForFunction(() => window.__app.gb.link.state(1) === 1 && window.__app.ps1.link.found, null, { timeout: 10000 });
  await page.evaluate(() => window.__app.mode.load(1));
  await page.waitForFunction(() => window.__app.gb.link.state(0) === 1 && window.__app.ps1.link.state(0) === 1, null, { timeout: 5000 });
  assert.equal((await g1(page)).level, 1);
  await page.waitForFunction(() => window.__app.ps1.link.state(1) === 1, null, { timeout: 5000 });
  await setCamera(page, [-0.1, 1.05, 0.6], 0, -0.25);
  // hold the GB so the bottom of its screen is a little above his head, within jumping reach
  const fit = () => page.evaluate(() => {
    const a = window.__app, l = a.ps1.link, g = a.linkGeo;
    const b = g.map('gb', 'crt', 0.5, 1);
    return { want: [l.state(7) / 192, (l.state(8) - 14 - 16) / 144], got: [b.u, b.v] };
  });
  let aim = (await fit()).want;
  for (let pass = 0; pass < 3; pass++) {
    await dragGbOver(page, await crtPoint(page, aim[0], aim[1]));
    const f = await fit();
    const du = f.want[0] - f.got[0], dv = f.want[1] - f.got[1];
    if (!(Math.abs(du) < 0.5 && Math.abs(dv) < 0.5)) continue;   // not facing the TV yet: try again
    aim = [aim[0] + du, aim[1] + dv];
  }
  const f = await fit();
  assert.ok(await linked(page) && Math.abs(f.got[1] - f.want[1]) * 144 < 6 && Math.abs(f.got[0] - f.want[0]) * 192 < 8, JSON.stringify(f));
  assert.equal(await page.evaluate(() => window.__app.gb.link.state(1)), 0, 'not scooped up by moving the GB');
  await page.keyboard.down('KeyZ');
  await page.waitForFunction(() => window.__app.gb.link.state(1) === 1, null, { timeout: 3000 }).finally(() => page.keyboard.up('KeyZ'));
  await page.screenshot({ path: SNAP + 'game1-l2-jumped-in.png' });
  await holdUntil(page, 'ArrowRight', () => window.__app.mode.pending !== null, 25000);
  // (headless Chrome renders in software at a few frames a second, and game time runs slow with it)
  await page.waitForFunction(() => window.__app.mode.level === 2, null, { timeout: 15000 });
});

// Carries an item (by index in app.items.items): a click picks it up, then
// with the pointer over a world point (its console) another click puts it in;
// waits for pred().
async function dragItem(page, index, targetFn, pred) {
  const pos = await page.evaluate((i) => window.__app.items.items[i].object.getWorldPosition(new window.__app.camera.position.constructor()).toArray(), index);
  await aimAt(page, pos);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(() => window.__app.items.held, null, { timeout: 3000 });
  const to = await page.evaluate(targetFn);
  await aimAt(page, to);
  await page.waitForTimeout(600);
  const over = await page.evaluate(() => window.__app.items.held && window.__app.items.dropTarget(window.__app.items.held));
  if (!over) {
    await page.screenshot({ path: SNAP + 'drag-miss.png' });
    const hits = await page.evaluate(() => {
      const a = window.__app, rc = a.items.raycaster;
      rc.setFromCamera(a.items.ndc, a.camera);
      return rc.intersectObjects(a.scene.children, true).slice(0, 4).map((h) => `${h.object.type}:${h.object.name}:${h.distance.toFixed(3)}:${h.object.parent?.type}`);
    });
    assert.fail(`reticle not over the console: ${hits.join(' | ')}`);
  }
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(pred, null, { timeout: 8000 });
}

const itemIndex = (page, kind, game) => page.evaluate(([k, g]) => window.__app.items.items.findIndex((it) => it.kind === k && it.game === g), [kind, game]);

test('beating a game unlocks the next pair from the CRT; inserting them switches games; zapper shoots', async (t) => {
  const { page, errors } = await open(t);
  await setCamera(page, [0.0, 1.1, 0.62], 0, -0.5);
  // finish ROCKY ROAD TRIP
  await page.evaluate(() => window.__app.mode.win());
  await page.waitForFunction(() => window.__app.items.items.filter((i) => i.game === 2).length === 2, null, { timeout: 6000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: SNAP + 'unlock-flying.png' });
  await page.waitForFunction(() => window.__app.items.items.filter((i) => i.game === 2 && i.state === 'free' && i.settled).length === 2, null, { timeout: 8000 });
  // they landed on the display stand
  const onStand = await page.evaluate(() => window.__app.items.items.filter((i) => i.game === 2)
    .map((i) => i.object.position.distanceTo(window.__app.items.home(i).pos) < 0.002));
  assert.deepEqual(onStand, [true, true]);
  await page.screenshot({ path: SNAP + 'unlock-landed.png' });

  // drag cartridge 2 into the GelatoBoy and disc 2 into the GelatoStation
  const cart2 = await itemIndex(page, 'cart', 2);
  await dragItem(page, cart2, () => window.__app.world.gb.group.position.toArray(),
    () => window.__app.items.cart?.game === 2);
  const disc2 = await itemIndex(page, 'disc', 2);
  await dragItem(page, disc2, () => window.__app.items.discSlotWorld().toArray(),
    () => window.__app.items.disc?.game === 2);
  await page.waitForFunction(() => window.__app.modeGame === 2, null, { timeout: 30000 });
  await page.screenshot({ path: SNAP + 'game2-running.png' });
  await page.waitForTimeout(1200);
  const ejected = await page.evaluate(() => window.__app.items.items.filter((i) => i.game === 1)
    .map((i) => `${i.state} ${i.object.position.distanceTo(window.__app.items.home(i).pos) < 0.002 ? 'home' : 'away'}`));
  assert.deepEqual(ejected, ['free home', 'free home'], 'game 1 media popped out onto the stand');

  // win the fight: game 3 and the zapper come out
  await page.evaluate(() => window.__app.onWin(2));
  await page.waitForFunction(() => window.__app.items.zapper && window.__app.items.zapper.state === 'free'
    && window.__app.items.zapper.settled, null, { timeout: 30000 });
  for (const kind of ['cart', 'disc']) {
    const i = await itemIndex(page, kind, 3);
    await page.waitForFunction((i) => window.__app.items.items[i].settled, i, { timeout: 5000 });
    await dragItem(page, i, kind === 'cart' ? () => window.__app.world.gb.group.position.toArray() : () => window.__app.items.discSlotWorld().toArray(),
      kind === 'cart' ? () => window.__app.items.cart?.game === 3 : () => window.__app.items.disc?.game === 3);
  }
  await page.waitForFunction(() => window.__app.modeGame === 3, null, { timeout: 30000 });

  // the zapper is in its holster
  assert.ok(await page.evaluate(() => {
    const z = window.__app.items.zapper;
    return z.object.position.distanceTo(window.__app.items.home(z).pos) < 0.002;
  }), 'zapper holstered');
  // pick up the zapper and shoot an enemy on the CRT
  const zp = await page.evaluate(() => window.__app.items.zapper.object.position.toArray());
  await aimAt(page, zp);
  await clickCenter(page);
  assert.equal(await page.evaluate(() => window.__app.items.holdingZapper), true);
  // it starts on its title: shoot the START button on the TV
  await page.waitForFunction(() => window.__app.mode.phase === 'title', null, { timeout: 30000 });
  for (let i = 0; i < 10 && await page.evaluate(() => window.__app.mode.phase === 'title'); i++) {
    await aimAt(page, await page.evaluate(() => window.__app.linkGeo.screenPoint('crt', 156 / 320, 140 / 240).toArray()));
    await clickCenter(page);
    await page.waitForTimeout(1500);
  }
  assert.notEqual(await page.evaluate(() => window.__app.mode.phase), 'title', 'shooting START starts it');
  await page.waitForFunction(() => window.__app.ps1.link.state(13) !== 0, null, { timeout: 60000 });
  let score = 0;
  for (let i = 0; i < 40 && score === 0; i++) {
    const aim = await page.evaluate(() => {
      const a = window.__app, l = a.ps1.link;
      const alive = l.state(13);
      for (let k = 0; k < 6; k++) {
        const u = l.state(1 + k * 2) / 256, v = l.state(2 + k * 2) / 256;
        if (alive & (1 << k) && v > 0.1 && u > 0.08 && u < 0.92) return a.linkGeo.screenPoint('crt', u, v).toArray();
      }
      return null;
    });
    if (aim) {
      await aimAt(page, aim);
      await clickCenter(page);
    }
    await page.waitForTimeout(250);
    score = await page.evaluate(() => window.__app.mode.score);
  }
  assert.ok(score > 0, 'zapper hit an enemy on the CRT');
  await page.screenshot({ path: SNAP + 'game3-zapper.png' });
  // right-click puts it back in the holster
  await clickCenter(page, 'right');
  await page.waitForFunction(() => {
    const z = window.__app.items.zapper;
    return z.state === 'free' && z.object.position.distanceTo(window.__app.items.home(z).pos) < 0.002;
  }, null, { timeout: 15000 });

  // the credits disc plays on the GelatoStation
  const credits = await itemIndex(page, 'disc', 'credits');
  await dragItem(page, credits, () => window.__app.items.discSlotWorld().toArray(), () => window.__app.items.disc?.game === 'credits');
  await page.waitForFunction(() => window.__app.ps1.emu && window.__app.modeGame === 0, null, { timeout: 15000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: SNAP + 'credits.png' });
  assert.deepEqual(errors.filter((e) => !e.includes('404')), []);
});
