// Host side of shared/vblink.h: the Virtualato's mailbox in VB work RAM.
const MAGIC = [...'GELATOVB'].map((c) => c.charCodeAt(0));
const O = { frame: 8, count: 9, power: 10, cam: 12, focal: 22, boxes: 24 };
const BOX = 18;   // sizeof(vbox_t)
export const MAX_BOXES = 64;
// the whole mailbox, and the part only the host writes (all but the frame count)
export const VB_SIZE = O.boxes + BOX * MAX_BOXES;
export const VB_HOST = [[O.count, VB_SIZE]];
export const VBOX = { BOX: 0, WALL: 1, LINE: 2, RING: 3, ROUND: 4 };   // (see shared/vblink.h)
const TURN = 4096 / (Math.PI * 2);

export class VbLink {
  constructor(emu) {
    this.emu = emu;
    this.offset = -1;
  }

  get found() { return this.offset >= 0; }

  locate() {
    const ram = this.emu.ram();
    const ok = (o) => MAGIC.every((m, i) => ram[o + i] === m);
    if (this.offset >= 0 && ok(this.offset)) return true;
    this.offset = -1;
    for (let o = 0; o + 24 + BOX * MAX_BOXES <= ram.length; o += 4) {
      if (ram[o] === MAGIC[0] && ok(o)) { this.offset = o; return true; }
    }
    return false;
  }

  get frame() { return this.found ? this.emu.ram()[this.offset + O.frame] : 0; }

  // Writes the view: camera {x, y, z (m), yaw, pitch (rad)}, focal length (px)
  // and boxes [{c: [x, y, z] (m), h: [hx, hy, hz] (m), yaw, pitch, type, bright}].
  write(cam, focal, boxes, power = true) {
    if (!this.found) return;
    const ram = this.emu.ram();
    const dv = new DataView(ram.buffer, ram.byteOffset + this.offset);
    const mm = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 1000)));
    const ang = (a) => ((Math.round(a * TURN) % 4096) + 4096) % 4096;
    dv.setInt16(O.cam, mm(cam.x), true);
    dv.setInt16(O.cam + 2, mm(cam.y), true);
    dv.setInt16(O.cam + 4, mm(cam.z), true);
    dv.setInt16(O.cam + 6, ang(cam.yaw), true);
    dv.setInt16(O.cam + 8, ang(cam.pitch), true);
    dv.setInt16(O.focal, Math.round(focal), true);
    const n = Math.min(boxes.length, MAX_BOXES);
    for (let i = 0; i < n; i++) {
      const b = boxes[i], o = O.boxes + i * BOX;
      for (let k = 0; k < 3; k++) {
        dv.setInt16(o + k * 2, mm(b.c[k]), true);
        dv.setInt16(o + 6 + k * 2, mm(b.h[k]), true);
      }
      dv.setInt16(o + 12, ang(b.yaw ?? 0), true);
      dv.setInt16(o + 14, ang(b.pitch ?? 0), true);
      dv.setUint8(o + 16, b.type ?? VBOX.BOX);
      dv.setUint8(o + 17, b.bright ?? 3);
    }
    dv.setUint8(O.count, n);
    dv.setUint8(O.power, power ? 1 : 0);
  }
}
