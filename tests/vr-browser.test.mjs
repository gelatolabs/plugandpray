// End-to-end tests of the cables, power, the Virtualato, the maze and the
// ending, in headless Chrome.
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

async function open(t, save = { unlocked: 3, vb: true }) {
  const ctx = await launch(url, { ready: () => window.__app?.mode });
  t.after(() => ctx.browser.close());
  await ctx.page.evaluate((s) => localStorage.setItem('gelatolabs-ld60', JSON.stringify(s)), save);
  await ctx.page.reload();
  await ctx.page.waitForFunction(() => window.__app?.mode, null, { timeout: 60000 });
  await clickCenter(ctx.page);
  return ctx;
}

const setCamera = (page, pos, yaw, pitch) => page.evaluate(([pos, yaw, pitch]) => {
  const a = window.__app;
  a.camera.position.set(...pos);
  a.fp.yaw = yaw;
  a.fp.pitch = pitch;
}, [pos, yaw, pitch]);

// Looks at a plug (by end name) and clicks it: plugged in, it comes out;
// loose, it's picked up and then pushed into the nearest socket it fits (or
// `socket`, if given). A loose plug may have fallen anywhere (off the desk,
// under it): it's looked at from just in front of it.
async function clickPlug(page, name, socket = null) {
  const loose = await page.evaluate((n) => !window.__app.cables.ends[n].socket, name);
  await clickPlugOnce(page, name);
  if (!loose) return;
  const s = await page.evaluate(([n, want]) => {
    const a = window.__app, c = a.cables, e = c.ends[n];
    const target = want ? c.sockets[want] : c.reachable(e)[0];
    const p = target.world();
    // stand back from the socket a little, along the way it faces
    const out = target.anchor.dir.clone().transformDirection(target.anchor.object.matrixWorld);
    a.camera.position.copy(p).addScaledVector(out, 0.35).setY(Math.max(0.3, p.y + 0.15));
    return p.toArray();
  }, [name, socket]);
  await aimAt(page, s);
  await page.waitForTimeout(300);
  await clickCenter(page);
}

async function clickPlugOnce(page, name) {
  const p = await page.evaluate((n) => {
    const a = window.__app, e = a.cables.ends[n];
    const p = e.plug.getWorldPosition(new a.camera.position.constructor());
    if (!e.socket) {
      a.camera.position.set(p.x, Math.max(0.3, p.y + 0.3), p.z + 0.35);
      window.__pushOut(a.camera.position, a.wallBlockers(), 0.05);
    }
    return p.toArray();
  }, name);
  await aimAt(page, p);
  await page.waitForTimeout(100);
  await clickCenter(page);
}

const at = (page, name) => page.evaluate((n) => window.__app.cables.at(n), name);

test('cables: plugs come out and go back in; power and picture follow them; the GB has a power switch', async (t) => {
  const { page, errors } = await open(t);
  await page.waitForFunction(() => window.__app.ps1.emu && window.__app.gb.emu, null, { timeout: 20000 });
  // the GelatoStation's power cord, from behind it (over the back of the desk)
  await setCamera(page, [0.42, 1.0, -0.58], Math.PI, -0.9);
  await page.waitForTimeout(200);
  await clickPlug(page, 'ps-iec');
  await page.waitForFunction(() => !window.__app.cables.ends['ps-iec'].socket, null, { timeout: 3000 });
  assert.equal(await page.evaluate(() => window.__app.ps1.emu), null, 'GelatoStation off');
  await page.waitForFunction(() => window.__app.world.crt.screen.material.uniforms.snow.value === 1, null, { timeout: 2000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: SNAP + 'vr-unplugged.png' });
  // (it may have fallen down the gap behind the desk: picking plugs up off the
  // floor has its own test, so here it's just put in hand, and plugged back in)
  await page.evaluate(() => { const c = window.__app.cables; c.hold(c.ends['ps-iec']); });
  await clickPlug(page, 'ps-iec', 'ps-iec');
  await page.waitForFunction(() => window.__app.cables.at('ps-iec') === 'ps-iec', null, { timeout: 5000 });
  await page.waitForFunction(() => window.__app.ps1.emu && window.__app.modeGame === 1, null, { timeout: 20000 });

  // the AV cable: either end loses the picture
  await page.waitForFunction(() => window.__app.world.crt.screen.material.uniforms.snow.value === 0, null, { timeout: 5000 });
  await page.evaluate(() => window.__app.cables.unplug(window.__app.cables.ends['rca-y']));
  await page.waitForFunction(() => window.__app.world.crt.screen.material.uniforms.snow.value === 1, null, { timeout: 2000 });
  assert.equal(await page.evaluate(() => window.__app.cables.plugIn(window.__app.cables.ends['rca-y'])), true);
  await page.waitForFunction(() => window.__app.cables.at('rca-y') === 'crt-y', null, { timeout: 3000 });

  // the TV's power cord comes out of the wall (not out of the TV)
  assert.equal(await page.evaluate(() => window.__app.cables.ends['crt-cord'].fixed), true);
  await page.evaluate(() => window.__app.cables.unplug(window.__app.cables.ends['crt-mains']));
  // (until it has: a slow machine runs few frames)
  await page.waitForFunction(() => window.__app.world.crt.screen.material.uniforms.squash.value.y < 0.5, null, { timeout: 3000 }).catch(() => {});
  const collapsing = await page.evaluate(() => window.__app.world.crt.screen.material.uniforms.squash.value.y);
  assert.ok(collapsing < 0.5, `the picture collapses (${collapsing})`);
  await page.waitForFunction(() => window.__app.world.crt.screen.material.uniforms.power.value === 0, null, { timeout: 8000 });
  await page.evaluate(() => window.__app.cables.plugIn(window.__app.cables.ends['crt-mains']));
  await page.waitForFunction(() => window.__app.cables.at('crt-mains'), null, { timeout: 3000 });
  await page.waitForFunction(() => window.__app.world.crt.screen.material.uniforms.squash.value.x > 0.5, null, { timeout: 2000 });
  await page.waitForFunction(() => window.__app.world.crt.screen.material.uniforms.power.value === 1, null, { timeout: 8000 });

  // the GB's power switch
  await setCamera(page, [0.3, 1.0, 0.3], 0, -1.0);
  await page.waitForTimeout(200);
  const sw = await page.evaluate(() => window.__app.world.gb.powerSwitch.getWorldPosition(new window.__app.camera.position.constructor()).toArray());
  await aimAt(page, sw);
  assert.equal(await page.evaluate(() => window.__app.target()?.label), 'Power off', 'the reticle says what clicking does');
  await clickCenter(page);
  assert.equal(await page.evaluate(() => window.__app.hw.gbOn), false);
  assert.equal(await page.evaluate(() => window.__app.gb.emu), null);
  await clickCenter(page);
  await page.waitForFunction(() => window.__app.gb.emu && window.__app.modeGame === 1, null, { timeout: 20000 });
  assert.deepEqual(errors, []);
});

test('Virtualato: click to wear it and see the room (and the maze) in green; right-click sets it down in front of you', async (t) => {
  const { page, errors } = await open(t);
  await setCamera(page, [0.45, 1.1, 0.5], 0, -0.7);
  await page.waitForTimeout(300);
  const vb = await page.evaluate(() => window.__app.vb.model.position.toArray());
  await aimAt(page, [vb[0], vb[1] + 0.16, vb[2]]);
  await page.waitForFunction(() => document.getElementById('reticle-label').textContent === 'Put on', null, { timeout: 2000 });
  await clickCenter(page);
  // it comes up to your face, and the view fades into its own
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.__app.vb.state), 'anim');
  await page.waitForFunction(() => window.__app.vb.worn, null, { timeout: 20000 });
  await page.waitForFunction(() => window.__app.vb.link?.found && window.__app.vb.link.frame > 5, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  // green lines on black
  const lit = await page.evaluate(() => {
    const d = window.__app.vb.ctx.getImageData(0, 0, 384, 224).data;
    let green = 0, other = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 1] > 60 && d[i] < 40) green++; else if (d[i] > 40 || d[i + 1] > 40) other++; }
    return { green, other };
  });
  assert.ok(lit.green > 500 && lit.other === 0, JSON.stringify(lit));
  await page.screenshot({ path: SNAP + 'vr-worn.png' });
  // the maze, behind you
  await setCamera(page, [0.4, 1.15, 2.6], Math.PI, 0);
  await page.waitForTimeout(800);
  await page.screenshot({ path: SNAP + 'vr-maze.png' });
  await page.waitForFunction(() => document.getElementById('right-hint').textContent === 'Right-click: Remove Virtualato', null, { timeout: 2000 });
  await clickCenter(page, 'right');
  assert.equal(await page.evaluate(() => window.__app.vb.worn), false);
  // out in front, turned round, dropped
  await page.waitForTimeout(500);
  await page.screenshot({ path: SNAP + 'vr-taking-off.png' });
  await page.waitForFunction(() => window.__app.vb.state === 'free', null, { timeout: 90000 });
  const put = await page.evaluate(() => window.__app.vb.model.position.toArray());
  assert.ok(Math.abs(put[2] - 2.6 - 0.5) < 0.1 && put[1] === 0, `set down on the floor in front (${put})`);
  // facing the desk from close up, it goes down on the desk
  await page.evaluate(() => window.__app.vb.state === 'free' && window.__app.vb.wear());
  await page.waitForFunction(() => window.__app.vb.worn, null, { timeout: 20000 });
  await page.evaluate(() => { const a = window.__app; a.camera.position.set(-0.6, 1.15, 1.0); a.fp.yaw = 0; a.fp.pitch = -0.3; a.keys.add('KeyW'); });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__app.keys.delete('KeyW'));
  const close = await page.evaluate(() => window.__app.camera.position.z);
  assert.ok(close < 0.35, `walked up close to the desk (z=${close.toFixed(2)})`);
  await clickCenter(page, 'right');
  await page.waitForFunction(() => window.__app.vb.state === 'free', null, { timeout: 90000 });
  const onDesk = await page.evaluate(() => window.__app.vb.model.position.toArray());
  assert.ok(Math.abs(onDesk[1] - 0.75) < 0.001, `set down on the desk (${onDesk})`);
  assert.deepEqual(errors, []);
});

test('you can walk through the front wall into the maze, whose walls stop you even when you can\'t see them', async (t) => {
  const { page } = await open(t);
  await setCamera(page, [0.4, 1.15, 2.6], Math.PI, 0);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);
  await page.keyboard.up('KeyW');
  const p = await page.evaluate(() => window.__app.camera.position.toArray());
  assert.ok(p[2] > 3.2, `went through the entrance (z=${p[2].toFixed(2)})`);
  const blocked = await page.evaluate(() => {
    const a = window.__app;
    // somewhere along the front wall away from the entrance: it stops you
    a.camera.position.set(-1.5, 1.15, 2.7);
    return new Promise((res) => {
      a.keys.add('KeyW');
      setTimeout(() => { a.keys.delete('KeyW'); res(a.camera.position.z); }, 1200);
    });
  });
  assert.ok(blocked < 3, `the rest of the front wall is solid (z=${blocked.toFixed(2)})`);
});

test('carrying the GB off with the link cable plugged in drags the GelatoStation until its cables stop you', async (t) => {
  const { page } = await open(t);
  const start = await page.evaluate(() => window.__app.world.station.group.position.toArray());
  // hold the GB and walk away from the desk
  const r = await page.evaluate(() => new Promise((res) => {
    const a = window.__app;
    a.camera.position.set(0.3, 1.15, 0.7);
    a.fp.yaw = Math.PI;   // facing away from the desk
    a.fp.pitch = -0.3;
    a.gbDragger.start(new a.ndc.constructor(0, -0.3));
    a.keys.add('KeyW');
    setTimeout(() => {
      a.keys.delete('KeyW');
      a.gbDragger.end();
      res({ cam: a.camera.position.toArray(), ps: a.world.station.group.position.toArray(), power: a.hw.psPowered });
    }, 5000);
  }));
  assert.ok(r.ps[2] > start[2] + 0.3, `the GelatoStation was dragged (${start} -> ${r.ps})`);
  assert.ok(r.cam[2] < 2.6, `you were stopped (z=${r.cam[2].toFixed(2)})`);
  assert.equal(r.power, true, 'still plugged in');
  assert.deepEqual(await page.evaluate(() => ['rca-y', 'rca-w', 'rca-r', 'av'].map((n) => window.__app.cables.at(n))),
    ['crt-y', 'crt-w', 'crt-r', 'ps-av'], 'the AV cable stays in too');
  await page.screenshot({ path: SNAP + 'vr-dragged.png' });
});

test('plugging the GB into the port at the end of the maze escapes reality and wins the YOU WIN! cartridge; unplugging puts the room back', async (t) => {
  const { page, errors } = await open(t);
  await page.waitForFunction(() => window.__app.gb.emu, null, { timeout: 20000 });
  // unplug the link cable from the GelatoStation, then bring the GB to the end room
  await page.evaluate(() => window.__app.cables.unplug(window.__app.cables.ends['link-ps']));
  await page.evaluate(() => {
    const a = window.__app, g = a.world.gb.group;
    a.camera.position.set(0, 1.15, a.maze.port.position.z - 1.1);
    a.fp.yaw = Math.PI;   // facing the port
    a.fp.pitch = -0.75;
    g.position.set(0.25, 1.0, a.maze.port.position.z - 0.5);
    g.quaternion.identity();
    g.updateMatrixWorld();
    // the cable comes along with it (as if carried there), then falls
    const at = a.cables.ends['link-gb'].socket.world();
    a.cables.ends['link-gb'].cable.particles.forEach((p, i) => { p.x.copy(at).add(new p.x.constructor(0, 0, i * 0.01)); p.prev.copy(p.x); });
    for (let i = 0; i < 120; i++) a.cables.update(1 / 60);
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: SNAP + 'vr-end-room.png' });
  await clickPlug(page, 'link-ps');
  await page.waitForFunction(() => window.__app.cables.at('link-ps') === 'maze-port', null, { timeout: 3000 });
  assert.equal(await page.evaluate(() => window.__app.escaped), true);
  assert.equal(await page.evaluate(() => window.__app.gb.romName), 'game1.gb', 'the GB keeps running its game');
  // a tray slides out of the wall beside the port with the YOU WIN! cartridge on it
  await page.evaluate(() => { window.__app.time += 30; });   // (it takes its time: skip ahead)
  await page.waitForFunction(() => !window.__app.trayAnim, null, { timeout: 5000 });
  const tray = await page.evaluate(() => {
    const a = window.__app, cart = a.items.items.find((i) => i.game === 'win');
    return { out: a.maze.tray.position.z, wall: a.maze.port.position.z, cart: cart && cart.state, y: cart?.object.position.y };
  });
  assert.ok(tray.out < tray.wall - 0.03 && tray.cart === 'free', JSON.stringify(tray));
  // label up
  assert.ok(await page.evaluate(() => {
    const cart = window.__app.items.items.find((i) => i.game === 'win').object;
    return new cart.position.constructor(0, 0, 1).applyQuaternion(cart.quaternion).y > 0.9;
  }), 'face up');
  await page.screenshot({ path: SNAP + 'vr-tray.png' });
  // put it in the GB
  await page.evaluate(() => { const a = window.__app; a.items.insertCart(a.items.items.find((i) => i.game === 'win')); });
  await page.waitForFunction(() => window.__app.gb.romName === 'ending.gb' && window.__app.modeGame === 'ending', null, { timeout: 20000 });
  await page.waitForTimeout(3000);
  assert.ok(await page.evaluate(() => window.__app.wave.r) > 1, 'the walls are turning into a GB screen');
  assert.equal(await page.evaluate(() => window.__app.vb.state), 'gone');
  await page.screenshot({ path: SNAP + 'vr-escaped.png' });

  // the character walks off the GB's screen into the room
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(() => window.__app.guy.active, null, { timeout: 8000 });
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(1500);
  const g = await page.evaluate(() => ({ p: window.__app.guy.position.toArray(), ground: window.__app.guy.onGround }));
  assert.ok(g.ground && Math.abs(g.p[1]) < 0.01, `landed on the floor (${g.p})`);
  await page.keyboard.press('KeyZ');
  await page.waitForTimeout(150);
  assert.ok(await page.evaluate(() => window.__app.guy.position.y) > 0.05, 'jumps');
  await page.waitForTimeout(800);
  await page.screenshot({ path: SNAP + 'vr-guy.png' });

  // unplug: back to normal
  await page.evaluate(() => window.__app.cables.unplug(window.__app.cables.ends['link-ps']));
  assert.equal(await page.evaluate(() => window.__app.escaped), false);
  assert.equal(await page.evaluate(() => window.__app.guy.active), false);
  assert.equal(await page.evaluate(() => window.__app.gb.romName), 'ending.gb', 'the cartridge stays in');
  assert.notEqual(await page.evaluate(() => window.__app.vb.state), 'gone');
  assert.deepEqual(errors, []);
});

test('beating License to Chill brings the Virtualato out of the TV onto the front right of the desk; it can\'t open the manual lying on it', async (t) => {
  const { page } = await open(t, { unlocked: 3 });
  assert.equal(await page.evaluate(() => window.__app.vb.state), 'hidden');
  await page.evaluate(() => { const b = window.__app.book; b.turn(1); b.turn(1); });
  await page.evaluate(() => window.__app.onWin(3));
  await page.waitForFunction(() => window.__app.vb.state === 'free', null, { timeout: 90000 });
  const [p, turned] = await page.evaluate(() => [window.__app.vb.model.position.toArray(), window.__app.book.turned]);
  assert.equal(turned, 2, 'the manual (on the left of the desk) is left as it was');
  assert.ok(p[0] > 0.5 && p[2] > -0.1 && Math.abs(p[1] - 0.75) < 0.001, `on the desk's front right (${p})`);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('gelatolabs-ld60')).vb), true);
  // put down on the manual, shut, it can't be opened
  await page.evaluate(() => {
    const a = window.__app, b = a.book;
    b.goTo(0);
    a.vb.setDown(b.group.localToWorld(new a.camera.position.constructor(0.05, 0, 0)).setY(b.top), 0);
  });
  await page.waitForFunction(() => !window.__app.book.busy, null, { timeout: 5000 });
  await page.evaluate(() => window.__app.camera.position.set(-0.5, 1.15, 0.4));
  await aimAt(page, await page.evaluate(() => window.__app.book.group.localToWorld(new window.__app.camera.position.constructor(0.02, 0.006, 0.06)).toArray()));
  assert.equal(await page.evaluate(() => window.__app.target()?.label ?? null), null, 'it can\'t be picked up or opened');
});

test('the manual: click it to pick it up and read it; the reticle then works its pages (the cover opens it, the right page turns on, the left back, the contents and the house); right-click puts it down', async (t) => {
  const { page } = await open(t, { unlocked: 1 });
  const label = () => page.evaluate(() => window.__app.target()?.label ?? null);
  const settled = () => page.waitForFunction(() => !window.__app.book.busy && [0, 1].includes(window.__app.book.lift), null, { timeout: 60000 });
  // on the desk: clicking it picks it up
  await page.evaluate(() => window.__app.camera.position.set(-0.55, 1.15, 0.45));
  await aimAt(page, await page.evaluate(() => window.__app.book.group.localToWorld(new window.__app.camera.position.constructor(0.05, 0.006, 0)).toArray()));
  assert.equal(await label(), 'Read booklet');
  await clickCenter(page);
  await settled();
  assert.equal(await page.evaluate(() => window.__app.book.held), true);
  assert.equal(await page.evaluate(() => window.__app.rightAction()?.label), 'Put down booklet');
  // held, the view stays put and the reticle moves instead: over a point on a page
  // (x across the book from its spine, a line's baseline in the page's pixels)
  const H = 0.148;
  const over = (x, py) => page.evaluate(([x, z]) => {
    const a = window.__app, v = a.book.group.localToWorld(new a.camera.position.constructor(x, 0.007, z)).project(a.camera);
    a.aimAt(v.x, v.y);
  }, [x, (py / 541 - 0.5) * H]);
  const yaw = await page.evaluate(() => window.__app.fp.yaw);
  await page.mouse.move(700, 400);
  await page.evaluate(() => window.__app.look(80, 0));
  assert.equal(await page.evaluate(() => window.__app.fp.yaw), yaw, 'looking moves the reticle, not the view');
  assert.ok(await page.evaluate(() => window.__app.ndc.x > 0.05), 'the reticle moved');
  await over(0.05, 270);
  assert.equal(await label(), 'Open booklet');
  await clickCenter(page);
  await settled();
  // the warning on the left, the contents on the right: its entries turn to their pages
  await over(0.05, 110);   // (the contents' title: not an entry)
  assert.equal(await label(), 'Next page');
  await over(0.05, 168 + 7 * 33 - 8);
  assert.equal(await label(), 'Turn to page 18');
  await clickCenter(page);
  await settled();
  assert.equal(await page.evaluate(() => window.__app.book.turned), 10, 'the cheats on the right');
  // ... and the house at the bottom left of the left-hand pages turns back to the contents
  await over(-0.105 * (1 - 36 / 384), 541 - 26);
  assert.equal(await label(), 'Back to contents');
  await clickCenter(page);
  await settled();
  assert.equal(await page.evaluate(() => window.__app.book.turned), 1);
  await over(-0.05, 270);
  assert.equal(await label(), 'Close booklet');
  // right-click: back down on the desk (still open where it was), and the reticle back in the middle
  await page.evaluate(() => window.__app.rightClick());
  await settled();
  assert.deepEqual(await page.evaluate(() => [window.__app.book.held, window.__app.book.turned, window.__app.ndc.toArray()]), [false, 1, [0, 0]]);
});

test('the cheat (up up down down left right left right B A) unlocks everything until the page is reloaded', async (t) => {
  const { page } = await open(t, { unlocked: 1 });
  for (const k of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyX', 'KeyZ']) await page.keyboard.press(k);
  await page.waitForFunction(() => window.__app.vb.state === 'free', null, { timeout: 30000 });
  const got = await page.evaluate(() => window.__app.items.items.map((i) => `${i.kind}${i.game ?? ''}`).sort());
  for (const want of ['cart2', 'cart3', 'disc2', 'disc3', 'zapper']) assert.ok(got.includes(want), `${want} unlocked (${got})`);
  await page.evaluate(() => window.__app.changeVolume(1));   // (saving the volume doesn't save the cheat)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gelatolabs-ld60')));
  assert.equal(saved.unlocked, 1);
  assert.ok(!saved.vb);
  await page.reload();
  await page.waitForFunction(() => window.__app?.mode, null, { timeout: 60000 });
  assert.equal(await page.evaluate(() => [window.__app.save.unlocked, window.__app.vb.state].join()), '1,hidden');
});

test('the cheat works on the touch screen buttons too (and after a slip)', async (t) => {
  const { page } = await open(t, { unlocked: 1 });
  await page.evaluate(() => window.__app.touch.show(true));
  for (const b of ['up', 'up', 'up', 'down', 'down', 'left', 'right', 'left', 'right', 'b', 'a']) {
    await page.evaluate((b) => {
      const el = document.querySelector(`#touch .t-${b}`);
      for (const type of ['pointerdown', 'pointerup']) el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch' }));
    }, b);
  }
  await page.waitForFunction(() => window.__app.vb.state === 'free', null, { timeout: 30000 });
  assert.ok(await page.evaluate(() => !!window.__app.trueSave));
});

test('the maze can be walked from the entrance to the end room', async (t) => {
  const { page } = await open(t);
  const r = await page.evaluate(() => {
    const a = window.__app, M = a.maze.layout;
    const walls = a.maze.walls;
    // breadth-first search over the cells
    const key = (c, r) => c + ',' + r, prev = { [key(M.entrance, 0)]: null }, q = [[M.entrance, 0]];
    while (q.length) {
      const [c, r] = q.shift();
      const nb = [];
      if (c + 1 < M.cols && !walls[c][r].e) nb.push([c + 1, r]);
      if (c > 0 && !walls[c - 1][r].e) nb.push([c - 1, r]);
      if (r + 1 < M.rows && !walls[c][r].n) nb.push([c, r + 1]);
      if (r > 0 && !walls[c][r - 1].n) nb.push([c, r - 1]);
      for (const [x, y] of nb) if (!(key(x, y) in prev)) { prev[key(x, y)] = [c, r]; q.push([x, y]); }
    }
    const path = [];
    for (let at = [M.exit, M.rows - 1]; at; at = prev[key(...at)]) path.unshift(at);
    // walk it: from in front of the entrance, cell centre to cell centre, then into the end room
    const pts = [[M.x0 + (M.entrance + 0.5) * M.cell, 2.6], ...path.map(([c, r]) => [M.x0 + (c + 0.5) * M.cell, M.z0 + (r + 0.5) * M.cell]),
      [M.x0 + (M.exit + 0.5) * M.cell, M.z0 + M.rows * M.cell + 0.8]];
    const cam = a.camera.position;
    cam.set(pts[0][0], 1.15, pts[0][1]);
    const blockers = a.fp.blockers();
    for (const [x, z] of pts.slice(1)) {
      for (let i = 0; i < 400; i++) {
        const dx = x - cam.x, dz = z - cam.z, d = Math.hypot(dx, dz);
        if (d < 0.02) break;
        cam.x += dx / d * Math.min(d, 0.02);
        cam.z += dz / d * Math.min(d, 0.02);
        window.__pushOut(cam, blockers);
      }
      if (Math.hypot(x - cam.x, z - cam.z) > 0.05) return { stuck: [cam.x, cam.z], at: [x, z], cells: path.length };
    }
    return { ok: true, end: [cam.x, cam.z], cells: path.length };
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.cells >= 12, `a proper maze (${r.cells} cells)`);
  const s = await page.evaluate(() => window.__mazeStats(window.__app.maze.walls).choices);
  assert.ok(s >= 5, `choices along the way (${s})`);
});

test('taking the Virtualato off facing a wall up close puts it down on your side of the wall', async (t) => {
  const { page } = await open(t);
  // the ending room's far wall (where the port is), just in front of you
  const wallZ = await page.evaluate(() => Math.max(...window.__app.wallBlockers().filter((r) => r.x0 < 0.6 && r.x1 > 0.6).map((r) => r.z0)));
  await page.evaluate((z) => { const a = window.__app; a.vb.wear(); a.camera.position.set(0.6, 1.5, z - 0.25); a.fp.yaw = Math.PI; a.fp.pitch = 0; }, wallZ);
  await page.waitForFunction(() => window.__app.vb.worn, null, { timeout: 20000 });
  await page.evaluate((z) => { const a = window.__app; a.camera.position.set(0.6, 1.5, z - 0.25); a.fp.yaw = Math.PI; a.vb.remove(); }, wallZ);
  await page.waitForFunction(() => window.__app.vb.state === 'free', null, { timeout: 90000 });
  const at = await page.evaluate(() => window.__app.vb.model.position.toArray());
  assert.ok(at[2] < wallZ - 0.05, `on this side of the wall at z=${wallZ.toFixed(2)} (${at.map((v) => v.toFixed(2))})`);
});

test('wearing the Virtualato you carry the GB like without it (click, right-click puts it down); then right-click takes the Virtualato off', async (t) => {
  const { page } = await open(t);
  await page.evaluate(() => { window.__app.vb.wear(); });
  await page.waitForFunction(() => window.__app.vb.worn, null, { timeout: 20000 });
  await setCamera(page, [0.3, 1.1, 0.5], 0, -0.9);
  const gb = await page.evaluate(() => window.__app.world.gb.group.position.toArray());
  await aimAt(page, gb);
  await clickCenter(page);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__app.gbDragger.dragging), true, 'picked up');
  await page.waitForFunction(() => document.getElementById('right-hint').textContent === 'Right-click: Let go of GelatoBoy', null, { timeout: 2000 });
  await clickCenter(page, 'right');
  assert.equal(await page.evaluate(() => window.__app.gbDragger.dragging), false, 'put down');
  await page.waitForFunction(() => document.getElementById('right-hint').textContent === 'Right-click: Remove Virtualato', null, { timeout: 2000 });
  await clickCenter(page, 'right');
  assert.equal(await page.evaluate(() => window.__app.vb.worn), false, 'taking it off');
  await page.waitForFunction(() => window.__app.vb.state === 'free', null, { timeout: 90000 });
});

test('Space jumps', async (t) => {
  const { page } = await open(t);
  const y0 = await page.evaluate(() => window.__app.camera.position.y);
  await page.keyboard.down('Space');
  await page.waitForTimeout(200);
  await page.keyboard.up('Space');
  const y1 = await page.evaluate(() => window.__app.camera.position.y);
  assert.ok(y1 > y0 + 0.05, `up (${y0} -> ${y1})`);
  await page.waitForFunction((y) => window.__app.camera.position.y === y, y0, { timeout: 5000 });
});

test('gamepad: sticks walk and look, A and the d-pad play, the right trigger picks things up, the left trigger is right-click', async (t) => {
  const { page } = await open(t);
  // a fake standard-mapping pad the test can push buttons and sticks on
  await page.evaluate(() => {
    const pad = window.__pad = { index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    navigator.getGamepads = () => [pad];
  });
  const set = (fn) => page.evaluate(fn);
  const before = await page.evaluate(() => ({ p: window.__app.camera.position.toArray(), yaw: window.__app.fp.yaw }));
  await set(() => { window.__pad.axes = [0, -1, 0.8, 0]; });   // forward, turning right
  // until it has turned and walked (a slow machine runs fewer, capped frames)
  await page.waitForFunction((b) => {
    const a = window.__app, p = a.camera.position;
    return a.fp.yaw < b.yaw - 0.2 && Math.hypot(p.x - b.p[0], p.z - b.p[2]) > 0.1;
  }, before, { timeout: 10000 }).catch(() => {});
  await set(() => { window.__pad.axes = [0, 0, 0, 0]; });
  const after = await page.evaluate(() => ({ p: window.__app.camera.position.toArray(), yaw: window.__app.fp.yaw }));
  assert.ok(after.yaw < before.yaw - 0.2, `looked right (${before.yaw} -> ${after.yaw})`);
  assert.ok(Math.hypot(after.p[0] - before.p[0], after.p[2] - before.p[2]) > 0.1, 'walked');
  // A and the d-pad reach the GB
  await set(() => { window.__pad.buttons[0].pressed = true; window.__pad.buttons[15].pressed = true; });
  await page.waitForTimeout(100);
  const mask = await page.evaluate(() => window.__app.gb.input);
  await set(() => { window.__pad.buttons[0].pressed = false; window.__pad.buttons[15].pressed = false; });
  assert.equal(mask, (1 << 8) | (1 << 7), 'A + right on the GB');
  // the right trigger picks up a cartridge (it stays in hand), the left trigger drops it
  await page.evaluate(() => { const a = window.__app; a.camera.position.set(-0.3, 1.1, 0.4); });
  const cart = await page.evaluate(() => window.__app.items.items.find((i) => i.kind === 'cart' && i.game === 2).object.getWorldPosition(new window.__app.camera.position.constructor()).toArray());
  await aimAt(page, cart);
  await set(() => { window.__pad.buttons[7].pressed = true; });
  await page.waitForFunction(() => window.__app.items.held, null, { timeout: 2000 });
  await set(() => { window.__pad.buttons[7].pressed = false; });
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => !!window.__app.items.held), 'still in hand');
  await set(() => { window.__pad.buttons[6].pressed = true; });
  await page.waitForFunction(() => !window.__app.items.held, null, { timeout: 2000 });
  await set(() => { window.__pad.buttons[6].pressed = false; });
  // the left trigger takes the Virtualato off
  await page.evaluate(() => window.__app.vb.state === 'free' && window.__app.vb.wear());
  await page.waitForFunction(() => window.__app.vb.worn, null, { timeout: 20000 });
  await set(() => { window.__pad.buttons[6].pressed = true; });
  await page.waitForFunction(() => !window.__app.vb.worn, null, { timeout: 2000 });
  await set(() => { window.__pad.buttons[6].pressed = false; });
});

test('a Fullscreen button in the top right, and under it an Enter VR button when the browser can do VR', async (t) => {
  const ctx = await launch(url, { ready: () => window.__app?.mode });
  t.after(() => ctx.browser.close());
  const { page } = ctx;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'xr', { value: { isSessionSupported: async () => true, requestSession: async () => { throw new Error('no headset'); } } });
  });
  await page.reload();
  await page.waitForFunction(() => window.__app?.mode && document.getElementById('vr-button'), null, { timeout: 60000 });
  const [fs, vr] = await page.evaluate(() => ['fs-button', 'vr-button'].map((id) => {
    const el = document.getElementById(id), r = el.getBoundingClientRect();
    return { text: el.textContent, right: window.innerWidth - r.right, top: r.top, bottom: r.bottom };
  }));
  assert.equal(fs.text, 'Fullscreen');
  assert.equal(vr.text, 'Enter VR');
  assert.ok(fs.right < 30 && fs.top < 30, JSON.stringify(fs));
  assert.ok(vr.right < 30 && vr.top > fs.bottom && vr.top < fs.bottom + 20, JSON.stringify(vr));
});

test('AV jacks: any RCA plug in any jack; swapped white/red swap the channels; yellow in an audio jack buzzes; red in the video jack shows bands', async (t) => {
  const { page } = await open(t);
  await page.waitForFunction(() => window.__app.ps1.emu && window.__app.audio.ctx, null, { timeout: 20000 });
  const r = await page.evaluate(async () => {
    const a = window.__app, c = a.cables, wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const settle = async () => { for (let i = 0; i < 40 && Object.values(c.ends).some((e) => e.anim); i++) await wait(100); await wait(200); };
    const out = {};
    out.normal = a.audio.routing;
    for (const n of ['rca-w', 'rca-r']) c.unplug(c.ends[n]);
    for (let i = 0; i < 30 && a.audio.routing !== ','; i++) await wait(100);   // (it changes on the next frame)
    out.unplugged = a.audio.routing;
    c.plugIn(c.ends['rca-w'], c.sockets['crt-r']);
    c.plugIn(c.ends['rca-r'], c.sockets['crt-w']);
    await settle();
    out.swapped = a.audio.routing;
    // yellow into the left audio jack
    c.unplug(c.ends['rca-r']);
    c.unplug(c.ends['rca-y']);
    await wait(200);
    c.plugIn(c.ends['rca-y'], c.sockets['crt-w']);
    await settle();
    out.buzz = a.audio.routing;
    out.noPicture = a.world.crt.screen.material.uniforms.snow.value;
    // red into the video jack
    c.plugIn(c.ends['rca-r'], c.sockets['crt-y']);
    await settle();
    out.bands = a.world.crt.screen.material.uniforms.bands.value;
    return out;
  });
  assert.equal(r.normal, '0,1', 'white left, red right');
  assert.equal(r.unplugged, ',', 'both speakers quiet');
  assert.equal(r.swapped, '1,0', 'swapped');
  assert.equal(r.buzz, 'buzz,0');
  assert.equal(r.noPicture, 1, 'no video without the yellow plug in the video jack');
  assert.equal(r.bands, 1, 'audio in the video jack shows bands');
  await page.screenshot({ path: SNAP + 'vr-av-bands.png' });
});

test('touch: a stick on the left walks, the right side looks, a tap picks things up and the button at the top drops them', async (t) => {
  const { page } = await open(t);
  const r = await page.evaluate(async () => {
    const a = window.__app, T = a.touch, wait = (ms) => new Promise((res) => setTimeout(res, ms));
    T.show(true);
    const ev = (id, x, y) => ({ pointerId: id, clientX: x, clientY: y });
    const shown = !document.getElementById('touch').hidden;
    const p0 = a.camera.position.clone(), yaw0 = a.fp.yaw;
    T.down(ev(1, 150, 500));
    T.moveTo(ev(1, 150, 440));          // stick pushed forward
    T.down(ev(2, 1000, 400));
    T.moveTo(ev(2, 1060, 400));         // and look right
    await wait(800);
    const walked = a.camera.position.distanceTo(p0), turned = yaw0 - a.fp.yaw;
    T.up(ev(1, 150, 440));
    T.up(ev(2, 1060, 400));
    // aim at a cartridge on the stand and tap
    a.camera.position.set(-0.3, 1.1, 0.4);
    const cart = a.items.items.find((i) => i.kind === 'cart' && i.game === 2).object.getWorldPosition(new a.camera.position.constructor());
    const c = a.camera.position, dx = cart.x - c.x, dy = cart.y - c.y, dz = cart.z - c.z;
    a.fp.yaw = Math.atan2(-dx, -dz); a.fp.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    await wait(300);
    T.down(ev(3, 900, 300)); T.up(ev(3, 900, 300));
    const held = !!a.items.held;
    await wait(300);
    // the button at the top drops it
    T.update();
    T.rightBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await wait(300);
    return { shown, walked, turned, held, after: !!a.items.held };
  });
  assert.ok(r.shown, 'controls shown');
  assert.ok(r.walked > 0.1, `walked (${r.walked})`);
  assert.ok(r.turned > 0.05, `turned (${r.turned})`);
  assert.ok(r.held && !r.after, JSON.stringify(r));
});

test('RCA plugs dropped on the floor (with the splitter) can be picked up and plugged back into the TV', async (t) => {
  const { page } = await open(t);
  await page.evaluate(async () => {
    const c = window.__app.cables, wait = (ms) => new Promise((res) => setTimeout(res, ms));
    for (const n of ['rca-y', 'rca-w', 'rca-r']) c.unplug(c.ends[n]);
    // the AV cable pulled off the front of the desk: from the GelatoStation's
    // back, over the front edge, the splitter and the plugs down on the floor
    const av = c.ends.av.cable, start = c.ends.av.socket.world();
    const V = start.constructor, edge = new V(0.2, 0.77, 0.24), floor = new V(0.25, 0.02, 0.45);
    av.particles.forEach((p, i) => {
      const f = i / (av.particles.length - 1);
      p.x.copy(f < 0.6 ? start.clone().lerp(edge, f / 0.6) : edge.clone().lerp(floor, (f - 0.6) / 0.4));
      p.prev.copy(p.x);
    });
    for (const n of ['rca-y', 'rca-w', 'rca-r']) {
      c.ends[n].cable.particles.forEach((p, i) => { p.x.copy(floor).add(new V(i * 0.01, 0, 0.02)); p.prev.copy(p.x); });
    }
    await wait(3000);
  });
  const low = await page.evaluate(() => ['rca-y', 'rca-w', 'rca-r'].map((n) => +window.__app.cables.ends[n].plug.position.y.toFixed(2)));
  assert.ok(low.every((y) => y < 0.6), `fell off the desk (${low})`);
  // pick up whichever plug the click gets (they're in a heap), and put it in its own jack
  const jackFor = { 'rca-y': 'crt-y', 'rca-w': 'crt-w', 'rca-r': 'crt-r' };
  for (let k = 0; k < 3; k++) {
    const loose = await page.evaluate(() => ['rca-y', 'rca-w', 'rca-r'].find((n) => !window.__app.cables.ends[n].socket));
    await clickPlugOnce(page, loose);
    if (!(await page.evaluate(() => window.__app.cables.holding))) {
      // out of sight (under the desk, say): pull it in by its cable where the cable shows, on the desk
      const p = await page.evaluate(() => {
        const a = window.__app, av = a.cables.ends.av.cable;
        const on = av.particles.filter((q) => q.x.y > 0.75 && q.x.z > -0.3).sort((m, n) => n.x.z - m.x.z)[0] ?? av.particles[3];
        a.camera.position.set(on.x.x, on.x.y + 0.4, on.x.z + 0.1);   // looking down on it
        return on.x.toArray();
      });
      await aimAt(page, p);
      await page.waitForTimeout(200);
      await clickCenter(page);
    }
    const held = await page.evaluate(() => window.__app.cables.holding?.name);
    assert.ok(held, `picked a plug up (try ${k}, aiming at ${loose}: ${await page.evaluate((n) => { const a = window.__app; return JSON.stringify({ target: a.target()?.label, plug: a.cables.ends[n].plug.position.toArray().map((v) => +v.toFixed(2)), cam: a.camera.position.toArray().map((v) => +v.toFixed(2)) }); }, loose)})`);
    const p = await page.evaluate((jack) => {
      const a = window.__app, target = a.cables.sockets[jack], p = target.world();
      const out = target.anchor.dir.clone().transformDirection(target.anchor.object.matrixWorld);
      a.camera.position.copy(p).addScaledVector(out, 0.35).setY(p.y + 0.15);
      return p.toArray();
    }, jackFor[held]);
    await aimAt(page, p);
    await page.waitForTimeout(400);
    await clickCenter(page);
    await page.waitForFunction((n) => window.__app.cables.at(n), held, { timeout: 8000 }).catch(() => {});
    assert.equal(await page.evaluate((n) => window.__app.cables.at(n), held), jackFor[held], `${held} back in its jack`);
  }
});
