// Thin wrapper around a libretro core compiled with emu/frontend.c.
// Works in both the browser and node (for tests).

export const RETRO = {
  B: 0, Y: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7,
  A: 8, X: 9, L: 10, R: 11,
};
const MEMORY_SYSTEM_RAM = 2;

export class Emulator {
  // factory: the emscripten module factory (createSameBoy / createPCSX / createBeetleVB)
  static async create(factory, { romName, romBytes, options = {}, moduleArgs = {} }) {
    const mod = await factory({ print: () => {}, printErr: () => {}, ...moduleArgs });
    return new Emulator(mod, romName, romBytes, options);
  }

  constructor(mod, romName, romBytes, options) {
    this.mod = mod;
    mod._fe_init();
    for (const [k, v] of Object.entries(options)) {
      mod.ccall('fe_set_option', null, ['string', 'string'], [k, v]);
    }
    mod.FS.mkdirTree('/system');
    mod.FS.writeFile('/' + romName, romBytes);
    if (!mod.ccall('fe_load', 'number', ['string'], ['/' + romName])) {
      throw new Error(`core failed to load ${romName}`);
    }
    this.fps = mod._fe_fps();
    this.sampleRate = mod._fe_sample_rate();
    this.audioBuf = mod._malloc(4096 * 4);
  }

  setInput(mask, port = 0) { this.mod._fe_set_input(port, mask); }
  run() { this.mod._fe_run(); }
  reset() { this.mod._fe_reset(); }
  get width() { return this.mod._fe_width(); }
  get height() { return this.mod._fe_height(); }
  get frameCount() { return this.mod._fe_frame_count(); }

  // RGBA view of the current frame (valid until the next run / memory growth).
  frame() {
    const w = this.width, h = this.height;
    return new Uint8Array(this.mod.HEAPU8.buffer, this.mod._fe_frame(), w * h * 4);
  }

  // Live view of the core's main RAM (GB WRAM / PS1 2MB main RAM).
  ram() {
    const ptr = this.mod._fe_memory(MEMORY_SYSTEM_RAM);
    const size = this.mod._fe_memory_size(MEMORY_SYSTEM_RAM);
    return new Uint8Array(this.mod.HEAPU8.buffer, ptr, size);
  }

  // Returns interleaved stereo Int16 samples queued since the last call.
  drainAudio() {
    const n = this.mod._fe_audio_read(this.audioBuf, 4096);
    return new Int16Array(this.mod.HEAP16.buffer, this.audioBuf, n * 2).slice();
  }
}
