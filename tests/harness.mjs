// Boots ROMs headlessly for tests.
import { readFileSync, mkdirSync } from 'node:fs';
import { Emulator, RETRO } from '../web/src/emulator.js';
import { Link } from '../web/src/link.js';
import { writePng } from './png.mjs';
import createSameBoy from '../web/public/emu/sameboy.mjs';
import createPCSX from '../web/public/emu/pcsx.mjs';

export const ROOT = new URL('..', import.meta.url).pathname;
export const SNAP = ROOT + 'build/test-snapshots/';
mkdirSync(SNAP, { recursive: true });
export { RETRO };

export const GB_OPTIONS = { sameboy_model: 'Game Boy', sameboy_mono_palette: 'lime' };
export const PS1_OPTIONS = { pcsx_rearmed_show_bios_bootlogo: 'disabled' };

class System {
  constructor(emu, link) { this.emu = emu; this.link = link; this.mask = 0; }
  run(n = 1, mask = 0) {
    this.emu.setInput(mask);
    for (let i = 0; i < n; i++) this.emu.run();
    this.emu.setInput(0);
  }
  // Runs frame by frame until pred() is truthy; returns its value or null.
  until(pred, max = 600, mask = 0) {
    for (let i = 0; i < max; i++) {
      this.run(1, mask);
      const v = pred();
      if (v) return v;
    }
    return null;
  }
  snap(name) { writePng(SNAP + name, this.emu.frame(), this.emu.width, this.emu.height); }
}

// noLink: for a program that doesn't use the link (the credits disc): just let it start.
// bootScreens: sit through the GelatoStation's boot screens (normally skipped).
export async function boot(kind, rom, { noLink = false, bootScreens = false } = {}) {
  const gb = kind === 'gb';
  const emu = await Emulator.create(gb ? createSameBoy : createPCSX, {
    romName: rom, romBytes: readFileSync(ROOT + 'web/public/roms/' + rom),
    options: gb ? GB_OPTIONS : PS1_OPTIONS,
  });
  const link = new Link(emu, gb ? 1 : 4);
  const sys = new System(emu, link);
  if (noLink) sys.run(300);
  else if (!sys.until(() => link.locate(), 900)) throw new Error(`${rom}: link not found`);
  if (!noLink && !bootScreens) link.setCtrl(31, 1);   // CTRL_SKIPBOOT: straight past the GelatoStation's boot screens
  sys.run(2);
  return sys;
}

// Byte helpers for 16-bit LE ctrl/state values.
export const state16 = (link, i) => link.state(i) | (link.state(i + 1) << 8);
export function setCtrl16(link, i, v) { link.setCtrl(i, v & 0xff); link.setCtrl(i + 1, v >> 8); }
