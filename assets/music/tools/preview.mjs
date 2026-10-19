// Renders a song as the ROMs really play it, in the real emulators: plays the
// music test program on the GelatoBoy (gb/musictest) until it has looped twice
// (and a second more, to hear the wrap), and writes a WAV.
//
//   make roms                                   (converts assets/music/*.mid and builds the test ROMs)
//   node assets/music/tools/preview.mjs         -> assets/music/preview-gb.wav
//   node assets/music/tools/preview.mjs --ps1   -> assets/music/preview-ps1.wav
//   node assets/music/tools/preview.mjs --loops 3
//   node assets/music/tools/preview.mjs --song 2   -> preview-gb-song2.wav (song 2: the fighter's)
//
// Both programs publish where they are (STATE_MUSIC_POS, rows, in the link's
// state), so a loop is counted the same way on either: the position going back.
// (--ps1 boots web/public/roms/musictest.exe: the GelatoStation's own music
// test program, built by ps1/.)
import { writeFileSync } from 'node:fs';
import { boot, state16, ROOT } from '../../../tests/harness.mjs';

const STATE_MUSIC_POS = 46;
const args = process.argv.slice(2);
const ps1 = args.includes('--ps1');
const loops = Number(args[args.indexOf('--loops') + 1]) || 2;
const songArg = args.includes('--song') ? Number(args[args.indexOf('--song') + 1]) : 1;
const out = ROOT + `assets/music/preview-${ps1 ? 'ps1' : 'gb'}${songArg > 1 ? `-song${songArg}` : ''}.wav`;
const CTRL_MUSIC_SONG = 30;

export async function render(kind, { loops = 2, tail = 1, maxSeconds = 600, song = 1 } = {}) {
  const sys = await boot(kind, kind === 'gb' ? 'musictest.gb' : 'musictest.exe');
  if (song !== 1) { sys.link.setCtrl(CTRL_MUSIC_SONG, song); sys.run(2); }
  const emu = sys.emu, rate = emu.sampleRate, fps = kind === 'gb' ? 59.73 : 59.94;
  sys.emu.drainAudio();   // (what played while it started)
  const chunks = [];
  let wraps = 0, last = state16(sys.link, STATE_MUSIC_POS), tailFrames = -1;
  for (let f = 0; f < maxSeconds * fps; f++) {
    sys.run(1);
    chunks.push(emu.drainAudio());
    const pos = state16(sys.link, STATE_MUSIC_POS);
    if (pos < last && ++wraps === loops) tailFrames = Math.round(tail * fps);
    last = pos;
    if (tailFrames >= 0 && tailFrames-- === 0) break;
  }
  const n = chunks.reduce((a, c) => a + c.length, 0), pcm = new Int16Array(n);
  let o = 0;
  for (const c of chunks) { pcm.set(c, o); o += c.length; }
  return { pcm, rate, wraps };
}

export function wav(path, pcm, rate) {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength), h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { pcm, rate, wraps } = await render(ps1 ? 'ps1' : 'gb', { loops, song: songArg });
  wav(out, pcm, rate);
  console.log(`wrote ${out.replace(ROOT, '')}: ${(pcm.length / 2 / rate).toFixed(1)} s, ${wraps} loop(s), ${rate} Hz`);
}
