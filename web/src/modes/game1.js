// Host logic for game 1 "Rocky Road Trip". The character crosses between the
// GelatoBoy and the TV wherever the screens look like they touch (see
// linkgeo.js): out of any open GB edge into the TV picture beside the GB,
// and from the TV back into the GB by walking (or falling, or jumping) into
// it. Moving the GB over him doesn't pick him up. The host knows both screens' tiles, so it only opens an edge
// where there's room on the other side, and tells the ROM exactly where the
// character lands.
import { MSG, DIR, CTRL } from '../link.js';

const M = { GOAL: 16, DIED: 17, TAKE: 19, HINT: 20 };
// Level 1's hint, if he hasn't got onto the TV this long (s) after the first button press: its first part, then all of it.
const HINT_AFTER = [20, 30];
const ST = { LEVEL: 0, PRESENT: 1, LEVELS: 6, X: 7, Y: 8, VY: 9, FACE: 10, MAP: 16 };
const C = { EXIT_L: 2, EXIT_R: 4, EXIT_T: 6, EXIT_B: 8 };
const BOX_W = 10, BOX_H = 14, ROWS = 9, H = ROWS * 16;
const SCREENS = { gb: { cols: 10, geo: 'gb', other: 'ps1' }, ps1: { cols: 12, geo: 'crt', other: 'gb' } };
const s8 = (b) => (b << 24) >> 24;

function c16(link, i, v) { link.setCtrl(i, v & 0xff); link.setCtrl(i + 1, (v >> 8) & 0xff); }

// Nudges tried when placing the character, cheapest first: mostly up (onto a floor), a little sideways.
const cost = ([dx, dy]) => Math.abs(dx) * 2 + (dy < 0 ? -dy : dy * 3);
const NUDGES = [];
for (let dy = -20; dy <= 6; dy++) for (let dx = -8; dx <= 8; dx++) NUDGES.push([dx, dy]);
NUDGES.sort((a, b) => cost(a) - cost(b));

// A screen's tiles, as published by its ROM.
export class TileMap {
  constructor(link, cols) {
    this.cols = cols;
    this.width = cols * 16;
    this.rows = Array.from({ length: ROWS }, (_, r) => link.state(ST.MAP + r * 2) | (link.state(ST.MAP + r * 2 + 1) << 8));
  }

  // Same rules as tile_at() in shared/plat.c with every edge closed.
  solid(px, py) {
    if (py < 0) return false;
    const r = Math.floor(py / 16), c = Math.floor(px / 16);
    if (r >= ROWS || c < 0 || c >= this.cols) return true;
    return (this.rows[r] >> c) & 1;
  }

  boxFree(bx, by) {
    const x1 = bx + BOX_W - 1;
    return by >= 0 && ![[bx, by], [x1, by], [bx, by + BOX_H - 1], [x1, by + BOX_H - 1], [bx, by + 7], [x1, by + 7]]
      .some(([x, y]) => this.solid(x, y));
  }

  // The free spot nearest to centre x / feet y, or null.
  place(cx, feet) {
    for (const [dx, dy] of NUDGES) {
      const x = Math.round(cx + dx), f = Math.round(feet + dy);
      if (this.boxFree(x - BOX_W / 2, f - BOX_H)) return { x, feet: f };
    }
    return null;
  }
}

export class Game1 {
  constructor(app) {
    this.app = app;
    this.level = 0;        // always from level 1 when the game starts up
    this.pending = null;   // {t, action}
    this.won = false;
    this.where = 'gb';
    this.transit = 0;      // frames until the character's new screen should report him
    this.prev = null;      // last position of the character on the TV, {x, y} in its pixels
    this.hint = 0;         // how much of level 1's hint is showing (see updateHint)
    this.load(this.level);
  }

  // where the music's heard (see music.js): wherever he is
  get musicOn() { return this.won ? 'ps1' : this.where; }   // (the win screen's on the TV)

  get levels() { return this.app.gb.link.state(ST.LEVELS) || 6; }
  sys(name) { return name === 'gb' ? this.app.gb : this.app.ps1; }
  map(name) { return new TileMap(this.sys(name).link, SCREENS[name].cols); }

  load(level) {
    this.level = level;
    this.transit = 0;
    this.app.gb.link.send(MSG.LOAD, level);
    this.app.ps1.link.send(MSG.LOAD, level);
  }

  later(t, action) { this.pending = { t, action }; }

  // Where the character lands after leaving screen `from` through edge `dir`
  // with his box centre at (x, y): {to, x, feet} or null.
  route(from, dir, x, y, maps = null) {
    const src = SCREENS[from], to = src.other;
    const q = this.app.linkGeo.exit(src.geo, dir, x / (src.cols * 16), y / H);
    if (!q) return null;
    const map = maps?.[to] ?? this.map(to);
    let cx = q.u * map.width, feet = q.v * H + BOX_H / 2;
    // the whole box goes beyond the point where he crossed
    if (dir === DIR.LEFT) cx -= BOX_W / 2 + 1;
    else if (dir === DIR.RIGHT) cx += BOX_W / 2 + 1;
    else if (dir === DIR.UP) feet = q.v * H;
    else feet = q.v * H + BOX_H;
    const spot = map.place(cx, feet);
    return spot && { to, ...spot };
  }

  // Edge cells of screen `from` that lead somewhere: [left rows, right rows, top cols, bottom cols].
  masks(from, maps) {
    const { cols } = SCREENS[from], w = cols * 16;
    const rows = (dir) => {
      let m = 0;
      for (let r = 0; r < ROWS; r++) if (this.route(from, dir, dir === DIR.LEFT ? 0 : w, r * 16 + 16 - BOX_H / 2, maps)) m |= 1 << r;
      return m;
    };
    const columns = (dir) => {
      let m = 0;
      for (let c = 0; c < cols; c++) if (this.route(from, dir, c * 16 + 8, dir === DIR.UP ? 0 : H, maps)) m |= 1 << c;
      return m;
    };
    return [rows(DIR.LEFT), rows(DIR.RIGHT), columns(DIR.UP), columns(DIR.DOWN)];
  }

  arrive(to, spot, vy, facingLeft, autoWalk) {
    this.sys(to).link.send(MSG.ENTER, spot.x, spot.feet, vy & 0xff, facingLeft ? 1 : 0, autoWalk);
    this.where = to;
    this.transit = 30;
    this.prev = null;
  }

  onMessage(from, msg) {
    switch (msg[0]) {
      case MSG.EXIT: {
        const [, dir, x, y, vy, face] = msg;
        const { cols } = SCREENS[from];
        // the edge was open a moment ago; if the link has just moved, try the middle of that cell
        const r = this.route(from, dir, x, y)
          ?? (dir <= DIR.RIGHT ? this.route(from, dir, x, Math.floor(y / 16) * 16 + 9) : this.route(from, dir, Math.floor(x / 16) * 16 + 8, y));
        if (r) {
          const side = dir === DIR.LEFT || dir === DIR.RIGHT;
          this.arrive(r.to, r, vy, side ? dir === DIR.LEFT : face, side ? 8 : 0);
        } else {
          // nowhere to go after all: step back in
          const map = this.map(from);
          const spot = map.place(Math.min(map.width - BOX_W, Math.max(BOX_W, x)), Math.min(H - 16, Math.max(BOX_H, y + BOX_H / 2)));
          if (spot) this.sys(from).link.send(MSG.ENTER, spot.x, spot.feet, 0, face, 0);
          else this.load(this.level);
        }
        break;
      }
      case M.GOAL:
        if (this.pending) break;
        this.app.gb.link.send(M.GOAL);
        this.app.ps1.link.send(M.GOAL);
        this.later(1.8, () => {
          if (this.level + 1 < this.levels) this.load(this.level + 1);
          else this.win();
        });
        break;
      case M.DIED:
        if (!this.pending) this.later(1.0, () => this.load(this.level));
        break;
      default:
        break;
    }
  }

  // After every TV frame: has the character walked into the GelatoBoy?
  onFrame(sys) {
    if (sys.kind !== 'ps1') return;
    const g = this.app.linkGeo, l = sys.link;
    if (this.transit > 0 || this.pending || !g.linked || !l.state(ST.PRESENT) || l.state(ST.LEVEL) !== this.level) {
      this.prev = null;
      return;
    }
    const x = l.state(ST.X), y = l.state(ST.Y) - BOX_H / 2;
    const last = this.prev;
    this.prev = { x, y };
    if (!last) return;
    // only his own movement counts (both points are judged against where the
    // GB is now, so moving the GB over him doesn't pick him up): in through the
    // screen or the bezel around it; below the screen he's just behind the GB
    const p = g.map('crt', 'gb', x / 192, y / H);
    const was = g.map('crt', 'gb', last.x / 192, last.y / H);
    if (g.inEntry(was) || !g.inEntry(p)) return;
    const e = g.entry(p, was);
    let cx = e.u * 160, feet = e.v * H + BOX_H / 2;
    if (e.u <= 0) cx = BOX_W / 2 + 1;
    else if (e.u >= 1) cx = 160 - BOX_W / 2 - 1;
    if (e.v <= 0) feet = BOX_H + 1;
    else if (e.v >= 1) feet = H;
    const spot = this.map('gb').place(cx, feet);
    if (!spot) return;   // that side of the GB is a wall: he's just behind it
    l.send(M.TAKE);
    const side = e.u <= 0 || e.u >= 1;
    this.arrive('gb', spot, s8(l.state(ST.VY)), side ? e.u >= 1 : l.state(ST.FACE), side ? 6 : 0);
  }

  win() {
    this.won = true;
    this.app.gb.link.send(MSG.WIN);
    this.app.ps1.link.send(MSG.WIN);
    this.app.onWin(1);
  }

  update(dt) {
    const { gb, ps1 } = this.app;
    if (this.pending) {
      this.pending.t -= dt;
      if (this.pending.t <= 0) {
        const a = this.pending.action;
        this.pending = null;
        a();
      }
    }
    const ready = !this.pending && !this.won && gb.link.state(ST.LEVEL) === this.level && ps1.link.state(ST.LEVEL) === this.level;
    const maps = ready && this.app.linkGeo.linked ? { gb: this.map('gb'), ps1: this.map('ps1') } : null;
    for (const name of ['gb', 'ps1']) {
      const link = this.sys(name).link;
      const m = maps ? this.masks(name, maps) : [0, 0, 0, 0];
      m.forEach((v, i) => c16(link, C.EXIT_L + i * 2, v));
      link.setCtrl(CTRL.EDGES, m.some(Boolean) ? 1 : 0);
    }
    if (this.transit > 0) {
      this.transit--;
      if (this.sys(this.where).link.state(ST.PRESENT)) this.transit = 0;
    } else if (gb.link.state(ST.PRESENT)) this.where = 'gb';
    else if (ps1.link.state(ST.PRESENT)) this.where = 'ps1';
    this.updateHint(dt);
  }

  // Level 1's hint, on both screens. The clock starts at the first button
  // pressed on either console; getting him onto the TV ends it for good.
  updateHint(dt) {
    const { gb, ps1 } = this.app;
    let want = 0;
    if (this.where === 'ps1') this.onTv = true;
    if (this.level === 0 && !this.onTv) {
      if (this.hintClock === undefined) { if (gb.input || ps1.input) this.hintClock = 0; } else this.hintClock += dt;
      want = HINT_AFTER.filter((t) => this.hintClock >= t).length;
    }
    if (want !== this.hint) {
      this.hint = want;
      gb.link.send(M.HINT, want);
      ps1.link.send(M.HINT, want);
    }
  }


  status() {
    if (this.won) return 'ROCKY ROAD TRIP complete! Something is coming out of the TV…';
    const at = this.where === 'gb' ? 'GelatoBoy' : 'TV';
    return `Level ${this.level + 1}/${this.levels} · character on the ${at}`;
  }

  help() {
    return '←/→ walk · Z jump · Hold the GelatoBoy so it looks like it touches the TV picture: '
      + 'walk off its edge into the TV, walk or jump into it from the TV, and move it to carry him';
  }
}
