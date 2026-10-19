// The emulators on their own threads (web/src/remote.js, emu.worker.js), as
// the game runs them: the link port copied across and the ROMs' messages read
// there, against the real cores and ROMs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker } from './webworker.mjs';
import { ROOT, GB_OPTIONS, PS1_OPTIONS } from './harness.mjs';

globalThis.Worker = Worker;
Object.defineProperty(globalThis.navigator, 'webdriver', { value: true, configurable: true });   // (straight past the boot screens)
const { RemoteEmu } = await import('../web/src/remote.js');
const { Game3 } = await import('../web/src/modes/game3.js');

const core = (name) => new URL(`../web/public/emu/${name}.mjs`, import.meta.url).href;
const CORES = { gb: 'sameboy', ps1: 'pcsx', vb: 'beetle_vb' };
const OPTIONS = { gb: GB_OPTIONS, ps1: PS1_OPTIONS, vb: { vb_3dmode: 'side-by-side', vb_sidebyside_separation: '0' } };

function start(kind, rom, extra = {}) {
  return RemoteEmu.create({
    core: core(CORES[kind]), wasmBinary: readFileSync(`${ROOT}web/public/emu/${CORES[kind]}.wasm`),
    romName: rom, romBytes: readFileSync(ROOT + 'web/public/roms/' + rom), options: OPTIONS[kind],
    align: kind === 'gb' ? 1 : 4, ...extra,
  });
}

const tick = () => new Promise((r) => setTimeout(r, 1));
// The next answer from each emulator.
async function answers(remotes) {
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    if (remotes.every((r) => r.answer)) return remotes.map((r) => r.take());
    await tick();
  }
  throw new Error('no answer');
}

test('remote: both consoles boot on their own threads, frames, sound and the link port come back', async () => {
  const [gb, ps1] = await Promise.all([start('gb', 'game1.gb'), start('ps1', 'game1.exe')]);
  try {
    let got = null;
    for (let i = 0; i < 600 && !(gb.link.found && ps1.link.found && gb.link.game && ps1.link.game); i++) {
      gb.run(1); ps1.run(1);
      got = await answers([gb, ps1]);
    }
    assert.ok(gb.link.found && ps1.link.found, 'the link ports were found');
    assert.equal(gb.link.game, 1);
    assert.equal(ps1.link.game, 1);
    // several frames in one go
    gb.run(3); ps1.run(3);
    got = await answers([gb, ps1]);
    assert.equal(got[0].n, 3);
    assert.equal(got[1].width * got[1].height * 4, got[1].frame.length, 'a whole picture');
    assert.ok(got[1].frame.some((v) => v), 'something on the TV');
    assert.ok(ps1.drainAudio() instanceof Int16Array);
  } finally { gb.terminate(); ps1.terminate(); }
});

test('remote: game 3 over the threads: shooting START (host->ROM) gets its reply (ROM->host), then enemies (ROM state)', async () => {
  const [gb, ps1] = await Promise.all([start('gb', 'game3.gb'), start('ps1', 'game3.exe')]);
  try {
    const sys = { gb: { kind: 'gb', link: gb.link }, ps1: { kind: 'ps1', link: ps1.link } };
    const app = { ...sys, wins: [], onWin(g) { this.wins.push(g); } };
    let mode = null;
    const frame = async () => {
      gb.run(1); ps1.run(1);
      await answers([gb, ps1]);
      for (const s of Object.values(sys)) {
        if (!s.link.found) continue;
        s.link.setCtrl(31, 1);
        for (const m of s.link.receive()) mode?.onMessage(s.kind, m);
      }
      mode?.update(1 / 60);
    };
    for (let i = 0; i < 600 && !(gb.link.game === 3 && ps1.link.game === 3); i++) await frame();
    mode = new Game3(app);
    for (let i = 0; i < 60; i++) await frame();
    assert.equal(mode.phase, 'title');
    mode.time += 1;
    mode.onShot('ps1', 156 / 320, 140 / 240);
    for (let i = 0; i < 120 && mode.phase === 'title'; i++) await frame();
    assert.notEqual(mode.phase, 'title', 'the ROM got the shot and answered START');
    let i = 0;
    for (; i < 900 && !(gb.link.state(0) || ps1.link.state(0)); i++) await frame();
    assert.ok(i < 900, 'enemies came');
  } finally { gb.terminate(); ps1.terminate(); }
});

test('remote: the Virtualato on its own thread draws the view written to its mailbox', async () => {
  const { VBOX } = await import('../web/src/vblink.js');
  const vb = await start('vb', 'vision.vb', { link: 'vb', audio: false });
  try {
    const boxes = [{ c: [0, 1, -1], h: [0.3, 0.3, 0.3], yaw: 0.4, type: VBOX.BOX, bright: 3 }];
    let lit = 0, frames0 = -1;
    for (let i = 0; i < 400; i++) {
      vb.link.write({ x: 0, y: 1, z: 0, yaw: 0, pitch: 0 }, 300, boxes);
      vb.run(1);
      const [a] = await answers([vb]);
      if (vb.link.found && frames0 < 0) frames0 = vb.link.frame;
      lit = a.frame.reduce((n, v, j) => n + (j % 4 === 0 && v > 40 ? 1 : 0), 0);
      if (vb.link.found && lit > 200 && vb.link.frame !== frames0) break;
    }
    assert.ok(vb.link.found, 'its mailbox was found');
    assert.notEqual(vb.link.frame, frames0, 'it drew pictures');
    assert.ok(lit > 200, `the box shows (${lit} lit pixels)`);
  } finally { vb.terminate(); }
});
