// Host logic for game 3 "License to Chill": runs the waves and sends zapper
// shots to whichever screen was hit. The two screens aren't linked here:
// each just has its own targets. It starts on a title with a START button on
// each screen, which you have to shoot.
import { MSG, CTRL } from '../link.js';
import { mulberry } from '../random.js';

const M = { SPAWN: 16, SHOT: 17, RESULT: 18, ESCAPE: 19, PHASE: 20, START: 21 };
const PH = { PLAY: 0, CLEAR: 1, OVER: 2, WIN: 3, TITLE: 4 };
const C = { LIVES: 2, SCORE: 3, WAVE: 5, ZAPPER: 6 };
const S = { COUNT: 0 };
const KILLED = 0x10;
const POINTS = { 1: 100, 2: 200, 3: 300 };
const SIZE = { gb: [160, 144], ps1: [320, 240] };

export const WAVES = [
  { count: 5, every: 2.2, types: [1] },
  { count: 7, every: 1.9, types: [1, 1, 2] },
  { count: 8, every: 1.7, types: [1, 2, 3] },
  { count: 10, every: 1.5, types: [1, 2, 2, 3] },
  { count: 12, every: 1.3, types: [1, 2, 3, 3] },
];

export class Game3 {
  constructor(app) {
    this.app = app;
    this.rand = mulberry(77);
    this.score = 0;
    this.shots = 0;
    this.hits = 0;
    this.lastShot = -1;
    this.shotOn = 'ps1';   // the screen the last shot hit (the music's heard there)
    this.time = 0;
    this.restart();
  }

  // Back to the title: the START button has to be shot to begin.
  restart() {
    this.lives = 5;
    this.score = 0;
    this.wave = 0;
    this.phase = 'title';
    this.setPhase(PH.TITLE);
  }

  startWave(n) {
    this.wave = n;
    this.spawned = 0;
    this.phase = 'intro';
    this.timer = 2.0;
    this.next = 'gb';
    this.app.gb.link.send(MSG.LOAD, n);
    this.app.ps1.link.send(MSG.LOAD, n);
  }

  setPhase(p) {
    this.app.gb.link.send(M.PHASE, p);
    this.app.ps1.link.send(M.PHASE, p);
  }

  get musicOn() { return this.shotOn; }

  sys(name) { return name === 'gb' ? this.app.gb : this.app.ps1; }

  // The zapper hit a screen at normalised (u, v), v measured from the top.
  onShot(sys, u, v) {
    if (this.time - this.lastShot < 0.2) return;
    this.lastShot = this.time;
    this.shotOn = sys;
    const [w, h] = SIZE[sys];
    const x = Math.round(u * w), y = Math.round(v * h);
    this.shots++;
    this.sys(sys).link.send(M.SHOT, x & 0xff, x >> 8, y);
  }

  onMessage(from, msg) {
    switch (msg[0]) {
      case M.RESULT: {
        const [, hit, res] = msg;
        if (!hit) break;
        this.hits++;
        if (res & KILLED) this.score += POINTS[res & 0xf] ?? 100;
        break;
      }
      case M.ESCAPE:
        if (this.phase !== 'play' && this.phase !== 'intro') break;
        this.lives = Math.max(0, this.lives - 1);
        if (this.lives === 0) {
          this.phase = 'over';
          this.setPhase(PH.OVER);
        }
        break;
      case M.PHASE:
        if (msg[1] === PH.OVER && this.phase === 'over') this.restart();
        break;
      case M.START:
        if (this.phase === 'title') this.startWave(0);
        break;
      default:
        break;
    }
  }

  spawn() {
    const w = WAVES[this.wave];
    const type = w.types[Math.floor(this.rand() * w.types.length)];
    const side = Math.floor(this.rand() * 3);
    const frac = 40 + Math.floor(this.rand() * 150);
    this.sys(this.next).link.send(M.SPAWN, side, frac, type);
    this.next = this.next === 'gb' ? 'ps1' : 'gb';
    this.spawned++;
  }

  update(dt) {
    this.time += dt;
    for (const sys of [this.app.gb, this.app.ps1]) {
      sys.link.setCtrl(CTRL.EDGES, 0);
      sys.link.setCtrl(C.LIVES, this.lives);
      const sc = Math.floor(this.score / 10);
      sys.link.setCtrl(C.SCORE, sc & 0xff);
      sys.link.setCtrl(C.SCORE + 1, sc >> 8);
      sys.link.setCtrl(C.WAVE, this.wave);
      sys.link.setCtrl(C.ZAPPER, this.app.items?.holdingZapper ? 1 : 0);
    }

    this.timer -= dt;
    const w = WAVES[this.wave];
    switch (this.phase) {
      case 'intro':
        if (this.timer <= 0) { this.phase = 'play'; this.timer = 0; }
        break;
      case 'play':
        if (this.spawned < w.count && this.timer <= 0) {
          this.spawn();
          this.timer = w.every;
        }
        if (this.spawned >= w.count && this.timer <= -1
            && this.app.gb.link.state(S.COUNT) === 0 && this.app.ps1.link.state(S.COUNT) === 0) {
          if (this.wave + 1 < WAVES.length) {
            this.phase = 'clear';
            this.timer = 2.5;
            this.setPhase(PH.CLEAR);
          } else {
            this.phase = 'won';
            this.setPhase(PH.WIN);
            this.app.onWin(3);
          }
        }
        break;
      case 'clear':
        if (this.timer <= 0) this.startWave(this.wave + 1);
        break;
      default:
        break;
    }
  }


  status() {
    if (this.phase === 'won') return `You saved the gelato! Final score ${this.score}.`;
    if (this.phase === 'over') return `Game over — score ${this.score}. Press A to try again.`;
    if (this.phase === 'title') return 'Shoot START to play';
    return `Wave ${this.wave + 1}/${WAVES.length} · score ${this.score} · lives ${this.lives}`;
  }

  help() {
    return this.app.items?.holdingZapper ? 'Shoot the brain-freeze ghosts on both screens before they fly off'
      : 'Pick up the GelatoBlaster (click it) to shoot';
  }
}
