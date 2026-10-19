// Touch controls, shown when there's a touch screen and no keyboard or gamepad
// in use (and not in VR):
//  - an on-screen d-pad, A and B for the consoles
//  - drag on the left half (away from the buttons): an analog stick appears
//    where you put your finger down, and walks you around
//  - drag on the right half: turns the camera
//  - tap anywhere (with any finger, even while another is dragging): does
//    whatever the reticle says; what you pick up stays in your hand until you
//    put it down (the button at the top) or it goes in somewhere
//  - the right-click action becomes a button at the top of the screen
const TAP_MS = 300, TAP_PX = 12, STICK_R = 60;

// the d-pad's arrows are drawn (some phones show the arrow characters as emoji)
const arrow = (deg) => `<svg viewBox="0 0 24 24" style="transform: rotate(${deg}deg)"><path d="M12 4 L21 19 H3 Z"/></svg>`;
const BUTTONS = [
  ['up', 'ArrowUp', arrow(0)], ['down', 'ArrowDown', arrow(180)], ['left', 'ArrowLeft', arrow(-90)], ['right', 'ArrowRight', arrow(90)],
  ['a', 'KeyZ', 'A'], ['b', 'KeyX', 'B'],
];

// iOS Safari ignores cancelled pointer events: a long press still brings up the
// text magnifier (and a double tap zooms) unless the touches themselves are
// cancelled. (The pointer events still come.)
export function noGestures(el) {
  const stop = (e) => { if (e.cancelable) e.preventDefault(); };
  for (const type of ['touchstart', 'touchmove', 'touchend']) el.addEventListener(type, stop, { passive: false });
}

export class Touch {
  constructor(app) {
    this.app = app;
    this.keys = new Set();          // console buttons held on screen
    this.move = { x: 0, y: 0 };     // the floating stick
    this.fingers = new Map();       // pointerId -> {kind, x0, y0, x, y, t0}
    this.active = false;
    this.build();
    const seen = () => this.show(true);
    window.addEventListener('touchstart', seen, { passive: true });
    // a real keyboard or gamepad takes over
    window.addEventListener('keydown', () => this.show(false));
    window.addEventListener('gamepadconnected', () => this.show(false));
  }

  build() {
    const el = this.el = document.createElement('div');
    el.id = 'touch';
    el.hidden = true;
    for (const [name, key, text] of BUTTONS) {
      const b = document.createElement('div');
      b.className = `tbtn t-${name}`;
      b.innerHTML = text;
      const down = (e) => { e.preventDefault(); e.stopPropagation(); this.keys.add(key); this.app.pressed.add(key); this.app.cheatKey(key); b.classList.add('on'); };
      const up = (e) => { e.preventDefault(); this.keys.delete(key); b.classList.remove('on'); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      el.appendChild(b);
    }
    this.stick = document.createElement('div');
    this.stick.className = 'tstick';
    this.knob = document.createElement('div');
    this.knob.className = 'tknob';
    this.stick.appendChild(this.knob);
    el.appendChild(this.stick);
    this.rightBtn = document.createElement('div');
    this.rightBtn.className = 'tright';
    this.rightBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.app.rightClick(); });
    el.appendChild(this.rightBtn);
    noGestures(el);
    document.body.appendChild(el);
  }

  show(on) {
    if (on && this.app.xr?.presenting) on = false;
    this.active = on;
    this.el.hidden = !on;
    document.body.classList.toggle('touching', on);
    if (!on) { this.keys.clear(); this.move = { x: 0, y: 0 }; this.fingers.clear(); this.stick.style.display = 'none'; }
  }

  // Touches on the canvas (the buttons stop their own).
  down(e) {
    this.show(true);
    const left = e.clientX < this.app.viewSize().w / 2;
    const f = { kind: left ? 'stick' : 'look', x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now() };
    this.fingers.set(e.pointerId, f);
    // reading the book, a finger on the notes draws where it is
    const app = this.app;
    if (app.book.held) {
      app.aimAtPx(e.clientX, e.clientY);
      const t = app.target();
      if (t?.label === 'Draw') { t.act(); f.kind = 'pen'; return; }
    }
    if (left && ![...this.fingers.values()].some((o) => o !== f && o.kind === 'stick')) {
      this.stick.style.display = 'block';
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.knob.style.transform = 'translate(-50%, -50%)';
    } else if (left) f.kind = 'none';
  }

  moveTo(e) {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    const dx = e.clientX - f.x, dy = e.clientY - f.y;
    f.x = e.clientX;
    f.y = e.clientY;
    if (f.kind === 'look') this.app.look(dx * 1.4, dy * 1.4);
    if (f.kind === 'pen') this.app.aimAtPx(f.x, f.y);
    if (f.kind === 'stick') {
      let sx = f.x - f.x0, sy = f.y - f.y0;
      const d = Math.hypot(sx, sy);
      if (d > STICK_R) { sx *= STICK_R / d; sy *= STICK_R / d; }
      this.move = { x: sx / STICK_R, y: sy / STICK_R };
      this.knob.style.transform = `translate(calc(-50% + ${sx}px), calc(-50% + ${sy}px))`;
    }
  }

  up(e) {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    this.fingers.delete(e.pointerId);
    if (f.kind === 'stick') { this.move = { x: 0, y: 0 }; this.stick.style.display = 'none'; }
    if (f.kind === 'pen') { this.app.book.penUp(); return; }
    const tap = performance.now() - f.t0 < TAP_MS && Math.hypot(f.x - f.x0, f.y - f.y0) < TAP_PX;
    if (!tap) return;
    const app = this.app;
    // reading the book, a tap is on the page where it lands
    if (app.book.held) app.aimAtPx(f.x, f.y);
    app.click();
  }

  // Each frame: keep the right-click button up to date.
  update() {
    if (!this.active) return;
    const r = this.app.rightAction();
    const text = r ? r.label : '';
    if (this.rightBtn.textContent !== text) this.rightBtn.textContent = text;
    this.rightBtn.style.display = text ? 'block' : 'none';
  }
}
