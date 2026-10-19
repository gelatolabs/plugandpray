// A console: an emulator core running whatever ROM is inserted, its link
// port, and the screen texture it draws into. Swapping media reboots it.
import { RemoteEmu } from './remote.js';
import { loading, fetchBytes } from './loading.js';

const asset = (p) => new URL(p, document.baseURI).href;
const romCache = {};

const CORES = { gb: 'emu/sameboy.mjs', ps1: 'emu/pcsx.mjs', vb: 'emu/beetle_vb.mjs' };
// about how big each core's WebAssembly is, until the server says (for the loading bar)
const CORE_BYTES = { gb: 220000, ps1: 880000, vb: 135000 };
const wasms = {};

// A core's WebAssembly, downloaded here (so its progress shows) and handed to the core.
export function wasm(kind) {
  if (!wasms[kind]) {
    const url = asset(CORES[kind].replace(/\.mjs$/, '.wasm'));
    loading.expect(url, CORE_BYTES[kind]);
    wasms[kind] = fetchBytes(url);
  }
  return wasms[kind];
}

// A core's module (the emulator threads load it).
export const coreUrl = (kind) => asset(CORES[kind]);

export async function rom(name) {
  if (!romCache[name]) {
    const url = asset('roms/' + name);
    loading.expect(url, 80000);
    romCache[name] = fetchBytes(url).then((b) => b.buffer);
  }
  return new Uint8Array(await romCache[name]);
}

export const OPTIONS = {
  vb: { vb_3dmode: 'side-by-side', vb_sidebyside_separation: '0', vb_vr: 'disabled', vb_color_mode: 'black & green' },
  gb: { sameboy_model: 'Game Boy', sameboy_mono_palette: 'lime' },
  ps1: { pcsx_rearmed_show_bios_bootlogo: 'disabled', pcsx_rearmed_dithering: 'enabled' },
};

export class System {
  constructor(kind, screen) {
    this.kind = kind;
    this.screen = screen;     // EmuScreen
    this.emu = null;
    this.link = null;
    this.romName = null;
    this.acc = 0;
    this.input = 0;
    this.booting = null;
    this.blank();
  }

  get ready() { return !!this.emu && this.link.found; }
  get game() { return this.ready ? this.link.game : 0; }

  // An empty screen: black on the TV, the bare LCD on the GB.
  blank() {
    const px = new Uint8Array(this.screen.width * this.screen.height * 4);
    if (this.kind === 'gb') for (let i = 0; i < px.length; i += 4) { px[i] = 198; px[i + 1] = 222; px[i + 2] = 140; }
    this.screen.update(px, this.screen.width, this.screen.height, true);   // (switched off: no ghost of the last picture)
  }

  // Boots the given ROM (or powers off with null). The core runs on its own
  // thread (see remote.js).
  async insert(romName) {
    const token = {};
    this.booting = token;
    this.emu?.terminate();
    this.emu = null;
    this.link = null;
    this.romName = romName;
    this.blank();
    if (!romName) return;
    const [bytes, wasmBinary] = await Promise.all([rom(romName), wasm(this.kind)]);
    if (this.booting !== token) return;
    const emu = await RemoteEmu.create({ core: coreUrl(this.kind), wasmBinary, romName, romBytes: bytes,
      options: OPTIONS[this.kind], align: this.kind === 'gb' ? 1 : 4 });
    if (this.booting !== token) { emu.terminate(); return; } // superseded by another insert
    this.emu = emu;
    this.link = emu.link;
    this.acc = 0;
  }

  // Shows the frames the emulator ran since last time (calling onFrame once
  // they're in), then asks for as many as are due now.
  step(dt, onFrame) {
    const emu = this.emu;
    if (!emu) return;
    const done = emu.take();
    if (done) {
      this.frames = (this.frames ?? 0) + done.n;   // (for the debug menu's frame rates)
      // under automation (tests), straight past the GelatoStation's boot screens (CTRL_SKIPBOOT)
      if (navigator.webdriver) this.link.setCtrl(31, 1);
      onFrame?.(this);
      this.screen.update(done.frame, done.width, done.height);
      emu.recycle(done.frame);
    }
    this.acc = Math.min(this.acc + dt, 4 / emu.fps);
    const n = Math.floor(this.acc * emu.fps + 1e-6);
    if (n > 0 && emu.run(n, this.input)) this.acc -= n / emu.fps;
  }
}
