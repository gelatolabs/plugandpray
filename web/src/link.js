// Host side of shared/link.h.

const MAGIC = [...'GELATOLK'].map((c) => c.charCodeAt(0));
export const MSG = { NONE: 0, ENTER: 1, EXIT: 2, LOAD: 3, WIN: 4 };
export const DIR = { LEFT: 1, RIGHT: 2, UP: 3, DOWN: 4, PORTAL: 5 };
export const CTRL = { EDGES: 0, PARTNER: 1 };

const O = { game: 8, frame: 9, outW: 10, outR: 11, inW: 12, inR: 13, out: 16, in: 80, state: 144, ctrl: 192 };
const SIZE = 224;
// the parts of the port only the host writes (the rest is the ROM's, but for
// out_r: whoever reads the ROM's messages); see remote.js
export const LINK_SIZE = SIZE;
export const LINK_HOST = [[O.inW, O.inW + 1], [O.in, O.state], [O.ctrl, SIZE]];
const RING = 8, LEN = 8;

export class Link {
  constructor(emu, align = 1) {
    this.emu = emu;
    this.align = align;
    this.offset = -1;
  }

  get found() { return this.offset >= 0; }

  matches(ram, off) {
    for (let i = 0; i < 8; i++) if (ram[off + i] !== MAGIC[i]) return false;
    return true;
  }

  locate() {
    const ram = this.emu.ram();
    if (this.offset >= 0 && this.matches(ram, this.offset)) return true;
    this.offset = -1;
    for (let off = 0; off + SIZE <= ram.length; off += this.align) {
      if (ram[off] === MAGIC[0] && this.matches(ram, off)) {
        this.offset = off;
        return true;
      }
    }
    return false;
  }

  byte(o) { return this.found ? this.emu.ram()[this.offset + o] : 0; }
  get game() { return this.byte(O.game); }
  get frame() { return this.byte(O.frame); }
  state(i) { return this.byte(O.state + i); }
  ctrl(i) { return this.byte(O.ctrl + i); }

  setCtrl(i, v) {
    if (this.found) this.emu.ram()[this.offset + O.ctrl + i] = v & 0xff;
  }

  // Drains ROM->host messages.
  receive() {
    if (!this.found) return [];
    const ram = this.emu.ram(), o = this.offset;
    const msgs = [];
    let r = ram[o + O.outR];
    while (r !== ram[o + O.outW]) {
      const base = o + O.out + r * LEN;
      msgs.push(Array.from(ram.subarray(base, base + LEN)));
      r = (r + 1) & (RING - 1);
    }
    ram[o + O.outR] = r;
    return msgs;
  }

  // Queues a host->ROM message; returns false if the link isn't up or the ring is full.
  send(type, ...args) {
    if (!this.found) return false;
    const ram = this.emu.ram(), o = this.offset;
    const w = ram[o + O.inW];
    const next = (w + 1) & (RING - 1);
    if (next === ram[o + O.inR]) return false;
    const base = o + O.in + w * LEN;
    ram.fill(0, base, base + LEN);
    ram[base] = type;
    args.slice(0, LEN - 1).forEach((v, i) => { ram[base + 1 + i] = v & 0xff; });
    ram[o + O.inW] = next;
    return true;
  }
}
