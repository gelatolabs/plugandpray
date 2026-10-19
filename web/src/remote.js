// A console's emulator on its own thread (emu.worker.js), so the main thread
// keeps its time for the room. Ask it to run() some frames; take() the
// answer on a later frame (it's a frame behind: it runs while the room draws).
//
// Its link port is a copy of the ROM's, with a Link (or VbLink) over it that
// the modes use as usual: the bytes only the host writes go to the ROM with
// each request, the ROM's come back with each answer, and the ROM's messages
// are read on the emulator thread (so none are missed between answers).
import { Link, LINK_SIZE, LINK_HOST } from './link.js';
import { VbLink, VB_SIZE, VB_HOST } from './vblink.js';

export class RemoteEmu {
  // core: the core's module URL; link: 'link' (the GB and the GelatoStation)
  // or 'vb' (the Virtualato's mailbox); audio: whether to send its sound back.
  static create({ core, wasmBinary, romName, romBytes, options, link = 'link', align = 1, audio = true }) {
    const worker = new Worker(new URL('./emu.worker.js', import.meta.url), { type: 'module' });
    const remote = new RemoteEmu(worker, link);
    return new Promise((resolve, reject) => {
      worker.onmessage = ({ data: m }) => {
        if (m.type === 'ready') {
          remote.fps = m.fps;
          remote.sampleRate = m.sampleRate;
          worker.onmessage = ({ data }) => remote.receive(data);
          resolve(remote);
        } else if (m.type === 'error') {
          worker.terminate();
          reject(new Error(m.message));
        }
      };
      worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message)); };
      const skipBoot = !!navigator.webdriver;
      const blockSize = link === 'vb' ? VB_SIZE : LINK_SIZE;
      worker.postMessage({ type: 'init', core, wasmBinary, romName, romBytes, options, link, align, audio, skipBoot, blockSize });
    });
  }

  constructor(worker, kind) {
    this.worker = worker;
    this.width = 0;
    this.height = 0;
    this.frameCount = 0;
    this.busy = false;
    this.answer = null;
    this.spare = null;
    this.sound = [];
    this.msgs = [];
    const size = kind === 'vb' ? VB_SIZE : LINK_SIZE;
    this.host = kind === 'vb' ? VB_HOST : LINK_HOST;
    // the ROM's parts: everything between the host's
    this.rom = [];
    let at = 0;
    for (const [a, b] of this.host) { if (a > at) this.rom.push([at, a]); at = b; }
    if (at < size) this.rom.push([at, size]);
    this.block = new Uint8Array(size);
    const copy = { ram: () => this.block };
    this.link = kind === 'vb' ? new VbLink(copy) : new Link(copy);
    this.link.locate = () => this.link.found;   // (the emulator thread finds it)
    this.link.receive = () => { const m = this.msgs; this.msgs = []; return m; };
  }

  // Asks for n frames with these buttons held; false if it's still busy.
  run(n, input = 0) {
    if (this.busy) return false;
    this.busy = true;
    const host = this.host.map(([a, b]) => [a, this.block.slice(a, b)]);
    const spare = this.spare;
    this.spare = null;
    this.worker.postMessage({ type: 'run', n, input, found: this.link.found, host, frame: spare }, spare ? [spare.buffer] : []);
    return true;
  }

  receive(m) {
    if (m.type === 'error') {
      if (!this.warned) { console.warn('emulator:', m.message); this.warned = true; }
      this.busy = false;   // (and try again next time)
      return;
    }
    this.answer = m;
  }

  // The latest answer, or null: {n (frames run), width, height, frame (RGBA)}.
  // Its link port and messages are in this.link by then.
  take() {
    const a = this.answer;
    if (!a) return null;
    this.answer = null;
    this.busy = false;
    this.width = a.width;
    this.height = a.height;
    this.frameCount = a.frameCount;
    // (just found: all of it as the ROM set it up; after that, only the ROM's parts)
    if (a.block && !this.link.found) this.block.set(a.block);
    else if (a.block) for (const [s, e] of this.rom) this.block.set(a.block.subarray(s, e), s);
    this.link.offset = a.block ? 0 : -1;
    this.msgs.push(...a.msgs);
    if (a.audio?.length) this.sound.push(a.audio);
    return a;
  }

  // Hands a taken frame's pixels back to be drawn into again.
  recycle(frame) { this.spare = frame; }

  // Interleaved stereo Int16 samples since the last call.
  drainAudio() {
    if (this.sound.length === 1) return this.sound.pop();
    const out = new Int16Array(this.sound.reduce((n, s) => n + s.length, 0));
    let at = 0;
    for (const s of this.sound) { out.set(s, at); at += s.length; }
    this.sound = [];
    return out;
  }

  terminate() { this.worker.terminate(); }
}
