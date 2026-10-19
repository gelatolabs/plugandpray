// An emulator thread: one console's core, run here so emulating it doesn't
// take the main thread's time (see remote.js for the other side).
//
// The main thread asks for n frames at a time, sending the input and the link
// port bytes it owns; this runs them and answers with the last picture, the
// sound, the port bytes the ROM owns and the ROM's messages.
import { Emulator } from './emulator.js';
import { Link } from './link.js';
import { VbLink } from './vblink.js';

const SKIPBOOT = 31;
let emu = null, link = null, opts = null;

async function init(m) {
  opts = m;
  const factory = (await import(/* @vite-ignore */ m.core)).default;
  emu = await Emulator.create(factory, { romName: m.romName, romBytes: m.romBytes, options: m.options, moduleArgs: { wasmBinary: m.wasmBinary } });
  link = m.link === 'vb' ? new VbLink(emu) : new Link(emu, m.align);
  postMessage({ type: 'ready', fps: emu.fps, sampleRate: emu.sampleRate });
}

function run({ n, input, found, host, frame: spare }) {
  const ram = () => emu.ram();
  // the host's side of the port, as the main thread last had it
  if (found && link.locate()) {
    const r = ram();
    for (const [start, bytes] of host) r.set(bytes, link.offset + start);
  }
  const msgs = [];
  emu.setInput(input);
  for (let i = 0; i < n; i++) {
    emu.run();
    if (!link.locate()) continue;
    if (opts.link !== 'vb') {
      msgs.push(...link.receive());
      // under automation (tests), straight past the GelatoStation's boot screens (CTRL_SKIPBOOT)
      if (opts.skipBoot) link.setCtrl(SKIPBOOT, 1);
    }
  }
  const w = emu.width, h = emu.height, src = emu.frame();
  const frame = spare && spare.length === src.length ? spare : new Uint8Array(src.length);
  frame.set(src);
  const block = link.found ? ram().slice(link.offset, link.offset + opts.blockSize) : null;
  const audio = opts.audio ? emu.drainAudio() : null;
  const answer = { type: 'frames', n, width: w, height: h, frameCount: emu.frameCount, frame, block, msgs, audio };
  postMessage(answer, [frame.buffer, ...(audio ? [audio.buffer] : [])]);
}

self.onmessage = ({ data: m }) => {
  try {
    if (m.type === 'init') init(m).catch((err) => postMessage({ type: 'error', message: String(err?.message ?? err) }));
    else if (m.type === 'run') run(m);
  } catch (err) {
    postMessage({ type: 'error', message: String(err?.stack ?? err) });
  }
};
