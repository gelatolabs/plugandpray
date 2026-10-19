// Gamepads (standard mapping), turned into the same controls as the keyboard
// and mouse: left stick walks, right stick looks, the d-pad and face buttons
// play the consoles, the right trigger is the left mouse button (hold it to
// carry things), the left trigger is right-click, Y jumps.
const DEAD = 0.15;
const LOOK_SPEED = 2.6;   // rad/s at full tilt

// buttons -> key codes they stand for
const KEYS = {
  0: 'KeyZ',        // A: GB A / PS1 Cross / platformer jump
  1: 'KeyX',        // B   (X does nothing)
  3: 'Space',       // Y: jump (you, not the games)
  12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight',
};
const TRIGGER_R = 7, TRIGGER_L = 6, SELECT = 8;

const dead = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

export class Gamepads {
  constructor() {
    this.prev = new Set();     // buttons held last time, as "pad:button"
    this.keys = new Set();     // key codes held on any pad
    this.move = { x: 0, y: 0 };
  }

  // Reads every pad. Returns what changed: { pressed: [key codes], fire, release, alt, select, any }.
  // In VR (vr) they're laid out like the VR controllers instead (see vrPad);
  // with tracked controllers there (tracked), the same controllers listed as
  // gamepads too ("xr-standard") are left to WebXR, so nothing happens twice.
  // (wearing the Virtualato in VR, vb: the left stick walks and the right one turns, via look)
  poll(dt, look, vr = false, tracked = false, vb = false) {
    const pads = navigator.getGamepads?.() ?? [];
    const held = new Set(), keys = new Set(), out = { pressed: [], fire: false, release: false, alt: false, select: false, any: false };
    this.move = { x: 0, y: 0 };
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      if (vr && tracked && pad.mapping === 'xr-standard') continue;
      if (vr) { this.vrPad(pad, held, keys, out, vb ? (x) => look((x * LOOK_SPEED * dt) / 0.004, 0) : null); continue; }
      pad.buttons.forEach((b, i) => {
        if (!(b.pressed || b.value > 0.5)) return;
        const id = `${pad.index}:${i}`;
        held.add(id);
        const fresh = !this.prev.has(id);
        if (fresh) out.any = true;
        if (KEYS[i]) { keys.add(KEYS[i]); if (fresh) out.pressed.push(KEYS[i]); }
        if (fresh && i === TRIGGER_R) out.fire = true;
        if (fresh && i === TRIGGER_L) out.alt = true;
        if (fresh && i === SELECT) out.select = true;
      });
      const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
      this.move.x += dead(lx);
      this.move.y += dead(ly);
      // the look callback takes mouse-like deltas (FirstPerson.look turns 0.004 rad per unit)
      const dx = dead(rx), dy = dead(ry);
      if (dx || dy) look((dx * LOOK_SPEED * dt) / 0.004, (dy * LOOK_SPEED * dt) / 0.004);
    }
    for (const id of this.prev) if (!held.has(id) && id.endsWith(`:${vr ? 'fire' : TRIGGER_R}`)) out.release = true;
    this.prev = held;
    this.keys = keys;
    return out;
  }

  // A pad in VR, laid out like the VR controllers (some headsets hand their
  // controllers to the page as plain gamepads, with no pose): the left stick
  // is the d-pad and the right stick walks, the face buttons are the consoles'
  // A and B (no jumping), the triggers click and right-click. A controller
  // with the XR layout ("xr-standard") is one hand's: its stick and buttons
  // are that hand's (which hand, from its name).
  vrPad(pad, held, keys, out, turn) {
    const press = (name, key, flag) => {
      const id = `${pad.index}:${name}`;
      held.add(id);
      const fresh = !this.prev.has(id);
      if (fresh) out.any = true;
      if (key) { keys.add(key); if (fresh) out.pressed.push(key); }
      if (fresh && flag) out[flag] = true;
    };
    const down = (i) => !!(pad.buttons[i]?.pressed || pad.buttons[i]?.value > 0.5);
    const dpad = (x, y) => {
      if (y < -0.5) press('up', 'ArrowUp');
      if (y > 0.5) press('down', 'ArrowDown');
      if (x < -0.5) press('left', 'ArrowLeft');
      if (x > 0.5) press('right', 'ArrowRight');
    };
    if (pad.mapping === 'xr-standard') {
      const left = /left|\(l\)|\bl\b/i.test(pad.id), x = pad.axes[2] ?? 0, y = pad.axes[3] ?? 0;
      if (down(0)) press('fire', null, 'fire');      // trigger
      if (down(1)) press('alt', null, 'alt');        // grip
      if (down(4)) press('a', 'KeyZ');
      if (down(5)) press('b', 'KeyX');
      if (turn) { if (left) { this.move.x += dead(x); this.move.y += dead(y); } else if (dead(x)) turn(dead(x)); }
      else if (left) dpad(x, y);
      else { this.move.x += dead(x); this.move.y += dead(y); }
      return;
    }
    const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
    if (turn) {
      this.move.x += dead(lx);
      this.move.y += dead(ly);
      if (dead(rx)) turn(dead(rx));
    } else {
      dpad(lx, ly);
      this.move.x += dead(rx);
      this.move.y += dead(ry);
    }
    if (down(0) || down(3)) press('a', 'KeyZ');
    if (down(1)) press('b', 'KeyX');
    for (const [i, k] of [[12, 'ArrowUp'], [13, 'ArrowDown'], [14, 'ArrowLeft'], [15, 'ArrowRight']]) if (down(i)) press(`d${i}`, k);
    if (down(TRIGGER_R)) press('fire', null, 'fire');
    if (down(TRIGGER_L)) press('alt', null, 'alt');
    if (down(SELECT)) press('select', null, 'select');
  }
}
