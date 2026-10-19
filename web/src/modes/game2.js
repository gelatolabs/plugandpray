// Host logic for game 2 "Vanilla Fighter II.5 (...)": keeps health and rounds, carries
// fighters and projectiles between the screens, and drives the CPU fighter.
// Wherever the GB looks like it covers the TV picture, fighters can jump up
// into it; walking off the GB's sides drops them back onto the TV. Projectiles
// fly on in a straight line from either screen and cross any gap.
import { MSG, DIR, CTRL } from '../link.js';
import { mulberry } from '../random.js';

const M = { HIT: 16, ROUND: 17, MATCH: 18, REMATCH: 19, STUN: 20 };
const C = { HP1: 2, HP2: 3, WINS: 4, CPU_IN: 5, BAND: 8, PORTAL: 12 };
const S = { PRESENT: 0, P1X: 1, P1Y: 2, P2X: 3, P2Y: 4, P1ST: 5, P2ST: 6, PROJ: 7, FACE: 8, THREAT: 9 };
const IN = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, A: 16, B: 32, C: 64, D: 128 };
const FS = { IDLE: 0, WALK: 1, JUMP: 2, ATTACK: 3, BLOCK: 4, HURT: 5, KO: 6, WIN: 7, FLIP: 8, CLAP: 9, STUN: 10 };
const KIND_FIGHTER = 0, KIND_PROJ = 1;
// projectile speeds in screen widths per frame, by screen and type (fight_cfg_t in the ROMs)
const PROJ_SPEED = { gb: { 1: 40 / 16 / 160, 2: 28 / 16 / 160 }, ps1: { 1: 96 / 16 / 320, 2: 64 / 16 / 320 } };
const MAX_FLIGHT = 90;   // frames
const STAND = 32;        // centre height of a fighter standing on the floor (h64)
const CPU_REACH = 118;   // highest centre height the CPU can jump to on the TV (h64)
const DODGE_AT = 56;     // how close (0-255 across the screen) a projectile gets before the CPU jumps it
const LOST_FRAMES = 45;  // a fighter missing from both screens this long is put back
// how far (centre to centre, in screen widths) the CPU's punches and kicks reach on each screen
const MELEE = { gb: 0.12, ps1: 0.14 };
// The CPU gets better round by round: how often he attacks up close (a frame),
// the wait between his attacks (frames), how often he blocks and dodges, and
// how much his hits hurt.
const LEVELS = [
// (hold: frames the CPU stays on its own screen, trading shots, before it may
// come after a player who's crossed to the other one; chase: then, the chance
// that each new plan is to follow him over)
  { attack: 0.16, wait: 30, block: 0.07, dodge: 0.5, damage: 0.7, hold: 540, chase: 0.2 },
  { attack: 0.24, wait: 24, block: 0.12, dodge: 0.65, damage: 0.85, hold: 420, chase: 0.25 },
  { attack: 0.3, wait: 18, block: 0.16, dodge: 0.8, damage: 1, hold: 300, chase: 0.3 },
];

// Arena coordinates (x 0-255, centre height h64) <-> screen uv, matching the ROMs' cameras.
const ARENA = {
  gb: { geo: 'gb', floor: 128 / 144, body: 28 / 144, half: 6 / 160 },
  ps1: { geo: 'crt', floor: 200 / 240, body: 60 / 240, half: 12 / 320 },
};
const toUv = (sys, x, h) => [x / 256, ARENA[sys].floor - (h / 64) * ARENA[sys].body];
const toH = (sys, v) => Math.round((ARENA[sys].floor - v) / ARENA[sys].body * 64);
const byte = (v) => Math.max(0, Math.min(255, Math.round(v)));

export class Game2 {
  constructor(app) {
    this.app = app;
    this.wins = [0, 0];
    this.round = 0;
    this.pending = null;
    this.over = false;
    this.ai = { cooldown: 60, block: 0, hold: 0, holdBits: 0, rand: mulberry(1234) };
    this.startRound();
  }

  sys(name) { return name === 'gb' ? this.app.gb : this.app.ps1; }

  // where the music's heard (see music.js): wherever the player's fighter is
  get musicOn() { return this.where[1]; }

  get level() { return LEVELS[Math.min(this.round, LEVELS.length - 1)]; }

  startRound() {
    this.hp = [100, 100];
    this.phase = 'fight';
    this.where = { 1: 'gb', 2: 'ps1' };
    this.missing = [0, 0];
    this.flying = [];        // projectiles crossing the gap between the screens
    this.app.gb.link.send(MSG.LOAD, this.round, 1);
    this.app.ps1.link.send(MSG.LOAD, this.round, 2);
    this.ai.cooldown = 120;
  }

  later(t, action) { this.pending = { t, action }; }

  // Where something leaving `from` (through edge `dir`, at x / centre height h)
  // arrives on the other screen: {dir, x, h} for MSG_ENTER, or null.
  route(from, dir, x, h) {
    const g = this.app.linkGeo, to = from === 'gb' ? 'ps1' : 'gb';
    const [u, v] = toUv(from, x, h);
    let q;
    if (dir === DIR.PORTAL) {
      q = g.entry(g.map('crt', 'gb', u, v), null);
    } else {
      q = g.exit(ARENA[from].geo, dir, u, v);
      if (!q) return null;
    }
    if (to === 'gb') {
      // in through the GB's edge (it walks in a little) or from below/above
      const edge = q.u <= 0 ? DIR.LEFT : q.u >= 1 ? DIR.RIGHT : 0;
      return { dir: edge, x: edge === DIR.RIGHT ? 255 : edge === DIR.LEFT ? 0 : byte(q.u * 256), h: byte(toH('gb', q.v)) };
    }
    // out beside the GB, clear of it
    const off = (ARENA.ps1.half + 0.03) * 256;
    return { dir: 0, x: byte(q.u * 256 + (dir === DIR.LEFT ? -off : off)), h: byte(toH('ps1', q.v)) };
  }

  // The open band of centre heights on one edge of a screen: [lo, hi] or null.
  band(sys, dir) {
    let lo = -1, hi = -1;
    for (let h = 0; h < 256; h += 4) {
      const [, v] = toUv(sys, 0, h);
      if (v < 0 || v > 1) continue;
      if (this.app.linkGeo.exit(ARENA[sys].geo, dir, dir === DIR.LEFT ? 0 : 1, v)) {
        if (lo < 0) lo = h;
        hi = Math.min(255, h + 3);
      }
    }
    return lo < 0 ? null : [lo, hi];
  }

  onMessage(from, msg) {
    const otherName = from === 'gb' ? 'ps1' : 'gb';
    switch (msg[0]) {
      case MSG.EXIT: {
        const [, dir, h, kind, who, owner, x, vy] = msg;
        if (kind === KIND_PROJ && dir !== DIR.PORTAL) {
          this.launch(from, dir, h, who, owner, vy);
          break;
        }
        const r = this.route(from, dir, x, h);
        if (!r) {
          // the link moved away at the last moment: a fighter steps back in where
          // he left (a projectile is just lost in between)
          if (kind === KIND_FIGHTER) {
            const edge = dir === DIR.LEFT || dir === DIR.RIGHT ? dir : 0;
            this.sys(from).link.send(MSG.ENTER, edge, h, kind, who, owner, dir === DIR.RIGHT ? 255 : dir === DIR.LEFT ? 0 : x, vy);
          }
          break;
        }
        this.sys(otherName).link.send(MSG.ENTER, r.dir, kind === KIND_PROJ ? h : r.h, kind, who, owner, r.x, vy);
        if (kind === KIND_FIGHTER) this.where[who] = otherName;
        if (from === 'gb') this.portalCooldown = 8;
        break;
      }
      case M.HIT: {
        const [, victim, hit] = msg;
        if (this.phase !== 'fight') break;
        const damage = victim === 1 ? Math.max(1, Math.round(hit * this.level.damage)) : hit;
        this.hp[victim - 1] = Math.max(0, this.hp[victim - 1] - damage);
        if (this.hp[victim - 1] === 0) this.roundOver(3 - victim);
        break;
      }
      case M.REMATCH:
        if (this.over && this.wins[1] === 2) this.rematch();
        break;
      case M.STUN:
        // a backflip landed on one screen with the victim on the other: stun him there
        if (this.phase === 'fight') this.sys(this.where[msg[1]]).link.send(M.STUN, msg[1]);
        break;
      default:
        break;
    }
  }

  // A projectile that flew off the side of a screen keeps going in a straight
  // line and, if that line hits the other screen, arrives there once it has
  // crossed the gap, at the same height relative to the fighters.
  launch(from, dir, h, type, owner, left) {
    const to = from === 'gb' ? 'ps1' : 'gb';
    const q = this.app.linkGeo.fly(ARENA[from].geo, dir, toUv(from, 0, h)[1]);
    if (!q) return;
    const speed = PROJ_SPEED[from][type] ?? PROJ_SPEED[from][1];   // screen widths per frame
    const frames = Math.min(MAX_FLIGHT, Math.round(q.gap / (speed * q.width)));
    const x = to === 'gb' ? (q.u < 0.5 ? 0 : 255) : byte(q.u * 256);
    // it keeps its height relative to the fighters (wherever the screens are),
    // so a shot at a fighter's height arrives at a fighter's height
    this.flying.push({ to, frames, msg: [0, h, KIND_PROJ, type, owner, x, left] });
  }

  roundOver(winner) {
    this.phase = 'ko';
    this.wins[winner - 1]++;
    this.app.gb.link.send(M.ROUND, winner);
    this.app.ps1.link.send(M.ROUND, winner);
    this.later(2.5, () => {
      if (this.wins[winner - 1] >= 2) {
        this.phase = 'match';
        this.over = true;
        this.app.gb.link.send(M.MATCH, winner);
        this.app.ps1.link.send(M.MATCH, winner);
        if (winner === 1) this.app.onWin(2);
      } else {
        this.round++;
        this.startRound();
      }
    });
  }

  rematch() {
    this.wins = [0, 0];
    this.round = 0;
    this.over = false;
    this.startRound();
  }

  update(dt) {
    if (this.pending) {
      this.pending.t -= dt;
      if (this.pending.t <= 0) {
        const a = this.pending.action;
        this.pending = null;
        a();
      }
    }
    this.updateLink();
    this.findLost();
    this.flying = this.flying.filter((f) => {
      if (f.frames-- > 0) return true;
      if (this.phase === 'fight') this.sys(f.to).link.send(MSG.ENTER, ...f.msg);
      return false;
    });
    for (const sys of [this.app.gb, this.app.ps1]) {
      sys.link.setCtrl(C.HP1, this.hp[0]);
      sys.link.setCtrl(C.HP2, this.hp[1]);
      sys.link.setCtrl(C.WINS, this.wins[0] | (this.wins[1] << 4));
    }
  }

  // A fighter that's on neither screen for a while (a message lost in transit)
  // drops back into the middle of the screen he was last headed for.
  findLost() {
    for (const who of [1, 2]) {
      const bit = 1 << (who - 1);
      const here = (this.app.gb.link.state(S.PRESENT) | this.app.ps1.link.state(S.PRESENT)) & bit;
      this.missing[who - 1] = here || this.phase !== 'fight' ? 0 : this.missing[who - 1] + 1;
      if (this.missing[who - 1] > LOST_FRAMES) {
        this.missing[who - 1] = 0;
        this.sys(this.where[who]).link.send(MSG.ENTER, 0, STAND + 64, KIND_FIGHTER, who, 0, 128, 0);
      }
    }
  }

  // Tells each ROM where things can leave its screen.
  updateLink() {
    const g = this.app.linkGeo;
    this.bands = {};
    for (const name of ['gb', 'ps1']) {
      const link = this.sys(name).link;
      const l = this.bands[name] = [this.band(name, DIR.LEFT), this.band(name, DIR.RIGHT)];
      link.setCtrl(CTRL.EDGES, (l[0] ? 1 : 0) | (l[1] ? 2 : 0));
      l.forEach((b, i) => { link.setCtrl(C.BAND + i * 2, b ? b[0] : 0); link.setCtrl(C.BAND + i * 2 + 1, b ? b[1] : 0); });
    }
    // the box on the TV where things go into the GB (its screen and bezel, not below)
    if (this.portalCooldown > 0) this.portalCooldown--;
    const r = this.portalCooldown > 0 ? null : g.entryOnCrt();
    this.portal = r && { x0: byte(r.u0 * 256), x1: byte(r.u1 * 256), h0: byte(toH('ps1', r.v1)), h1: byte(toH('ps1', r.v0)) };
    const p = this.portal ?? { x0: 0, x1: 0, h0: 0, h1: 0 };
    const link = this.app.ps1.link;
    [p.x0, p.x1, p.h0, p.h1].forEach((v, i) => link.setCtrl(C.PORTAL + i, v));
    this.app.gb.link.setCtrl(C.PORTAL, 0);
    this.app.gb.link.setCtrl(C.PORTAL + 1, 0);
  }


  // Called after every emulated frame of either system: decides the CPU's buttons.
  onFrame(sys) {
    const name = sys.kind;
    if (this.where[2] !== name) { sys.link.setCtrl(C.CPU_IN, 0); return; }
    sys.link.setCtrl(C.CPU_IN, this.phase === 'fight' ? this.think(name, sys.link) : 0);
  }

  // Buttons are held for a few frames: a single-frame press can fall between the ROM's input reads.
  press(bits) {
    this.ai.hold = 2;
    this.ai.holdBits = bits;
    return bits;
  }

  // A simple, beatable opponent.
  think(name, link) {
    const ai = this.ai;
    const r = ai.rand;
    if (ai.hold > 0) { ai.hold--; return ai.holdBits; }
    if (ai.cooldown > 0) ai.cooldown--;
    const present = link.state(S.PRESENT);
    const cx = link.state(S.P2X) / 256;
    const cpuState = link.state(S.P2ST);
    if ([FS.HURT, FS.KO, FS.STUN, FS.FLIP, FS.CLAP].includes(cpuState)) return 0;
    const gb = name === 'gb';
    const shoot = IN.C;
    const lv = this.level;

    // jump over projectiles (most of the time: decided once per projectile)
    const threat = link.state(S.THREAT);
    if (threat === 255) ai.dodge = null;
    else if (threat <= DODGE_AT) {
      ai.dodge ??= r() < lv.dodge;
      if (ai.dodge && (cpuState === FS.IDLE || cpuState === FS.WALK || cpuState === FS.BLOCK)) {
        // up and away from it, so it has further to go before it reaches him
        ai.dodge = false;
        ai.hold = 6;
        ai.holdBits = IN.UP | (link.state(S.FACE) & 2 ? IN.RIGHT : IN.LEFT);
        return ai.holdBits;
      }
    }

    if (present & 1) {
      ai.plan = null;
      // same screen as the player
      const px = link.state(S.P1X) / 256;
      const dx = px - cx, dist = Math.abs(dx);
      const toward = dx < 0 ? IN.LEFT : IN.RIGHT;
      const away = dx < 0 ? IN.RIGHT : IN.LEFT;
      const playerAttacking = link.state(S.P1ST) === FS.ATTACK;
      if (playerAttacking && dist < 0.3 && r() < lv.block) { ai.hold = 18; ai.holdBits = IN.B; return IN.B; }
      // in the air near him: a flying kick on the way down
      if (cpuState === FS.JUMP) return dist < MELEE[name] * 1.3 && r() < 0.2 ? this.press(IN.A) : 0;
      if (dist < MELEE[name]) {
        if (ai.cooldown === 0 && r() < lv.attack) {
          ai.cooldown = lv.wait + Math.floor(r() * 20);
          const pick = r();
          return this.press(pick < 0.85 ? IN.A : IN.C | IN.D);   // a punch, now and then a backflip
        }
        if (r() < 0.02) { ai.hold = 12; ai.holdBits = away; }
        return 0;
      }
      if (dist > 0.4 && ai.cooldown === 0 && r() < 0.03) { ai.cooldown = 70; return this.press(shoot); }
      if (r() < 0.006) return this.press(toward | IN.UP);
      return toward;
    }

    // the player is on the other screen: hang back for a bit, or stay put and
    // shoot at the other screen, or come after him (and always come in the end)
    if (!ai.plan || ai.plan.t-- <= 0) ai.plan = this.plan(ai.plan);
    if (ai.plan.kind === 'wait') return r() < 0.01 ? this.press(r() < 0.5 ? IN.LEFT : IN.RIGHT) : 0;
    if (ai.plan.kind === 'snipe') {
      const g = this.app.linkGeo;
      if (!g.usable()) return 0;
      const target = gb ? g.map('crt', 'gb', 0.5, 0.5).u : g.map('gb', 'crt', 0.5, 0.5).u;
      const dir = target < cx ? IN.LEFT : IN.RIGHT;
      if ((link.state(S.FACE) & 2 ? IN.LEFT : IN.RIGHT) !== dir) return this.press(dir);
      if (ai.cooldown === 0 && r() < 0.05) { ai.cooldown = 50 + Math.floor(r() * 50); return this.press(shoot); }
      return 0;
    }

    // chasing: on the TV, jump up into the GB if it's within reach; otherwise
    // head for an edge that's open at floor level
    const p = this.portal;
    if (!gb && p && p.h0 <= CPU_REACH) {
      const mid = (p.x0 + p.x1) / 2 / 256, half = Math.max(0.01, (p.x1 - p.x0) / 512 * 0.6);
      const dx = mid - cx;
      // already standing inside it (the GB was moved over him): step out, then walk back in
      if (p.h0 <= STAND && cx * 256 >= p.x0 && cx * 256 <= p.x1) return dx > 0 ? IN.LEFT : IN.RIGHT;
      if (Math.abs(dx) > half) return dx < 0 ? IN.LEFT : IN.RIGHT;
      return p.h0 > STAND + 8 ? this.press(IN.UP) : (dx < 0 ? IN.LEFT : IN.RIGHT);
    }
    const bands = this.bands?.[name] ?? [];
    const opens = (b) => b && b[0] <= STAND && b[1] >= STAND;
    const edge = opens(bands[0]) && opens(bands[1]) ? (cx < 0.5 ? IN.LEFT : IN.RIGHT)
      : opens(bands[0]) ? IN.LEFT : opens(bands[1]) ? IN.RIGHT : 0;
    if (!edge) return r() < 0.01 ? IN.UP : 0;
    const facingEdge = (link.state(S.FACE) & 2 ? IN.LEFT : IN.RIGHT) === edge;
    if (facingEdge && ai.cooldown === 0 && r() < 0.02) { ai.cooldown = 90; return this.press(shoot); }
    return edge;
  }

  // What the CPU does next while the player is on the other screen: wait,
  // snipe or chase. Just after he's gone over it holds its ground (a fight
  // across the two screens is the point), and only now and then follows;
  // never putting it off more than four times in a row.
  plan(last) {
    const r = this.ai.rand, lv = this.level;
    if (!last) return { kind: 'snipe', t: lv.hold + Math.floor(r() * 120), stalls: 0 };
    const stalls = last.kind !== 'chase' ? last.stalls + 1 : 0;
    const pick = stalls >= 4 ? 1 : r();
    if (pick < (1 - lv.chase) * 0.35) return { kind: 'wait', t: 60 + Math.floor(r() * 120), stalls };
    if (pick < 1 - lv.chase) return { kind: 'snipe', t: 150 + Math.floor(r() * 180), stalls };
    return { kind: 'chase', t: 180 + Math.floor(r() * 240), stalls: 0 };
  }

  status() {
    const at = this.where[1] === 'gb' ? 'GelatoBoy' : 'GelatoStation';
    if (this.over) return this.wins[0] === 2 ? 'You won VANILLA FIGHTER II.5! Watch the TV…' : 'You lost. Press A for a rematch.';
    return `Round ${this.round + 1}/3 · You ${this.hp[0]} HP · CPU ${this.hp[1]} HP · rounds ${this.wins[0]}-${this.wins[1]} · you're on the ${at}`;
  }

  help() {
    return 'Z punch · X block · Z in the air: flying kick · ↓→ Z Gelato Blast · ↑→↓← Z backflip (landing next to the other fighter stuns them) (→ = toward your opponent)\n'
      + '←/→ walk · ↑ jump · hold the GB over the TV and jump up into it; walk off its side to drop back down';
  }
}
