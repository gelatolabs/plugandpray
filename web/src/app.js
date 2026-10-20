// The game: a desk with a GelatoBoy, a GelatoStation and a CRT, three
// cartridge + disc pairs to play through, a zapper, and the Virtualato, which
// shows the maze behind the front wall. Plugging the GB into the port at the
// end of the maze escapes reality.
import * as THREE from 'three';
import { buildScene, loadModels, MODELS } from './scene.js';
import { loading } from './loading.js';
import { EmuScreen, createLcdMaterial, createCrtMaterial } from './screens.js';
import { Dragger } from './drag.js';
import { Effects } from './effects.js';
import { System, wasm, rom } from './systems.js';
import { Items } from './items.js';
import { LinkGeometry, crtCurve } from './linkgeo.js';
import { RETRO } from './emulator.js';
import { CTRL } from './link.js';
import { GAMES, LAST_GAME, CREDITS, WIN } from './games.js';
import { createRenderer, FirstPerson, roomBlockers, pushOut } from './controls.js';
import { buildMaze, gbWave, mazeStats } from './maze.js';
import { buildCables, gbBoxFor, LINK_PS_SOCKET } from './cables.js';
import { Hardware } from './hardware.js';
import { Gamepads } from './gamepad.js';
import { XR } from './xr.js';
import { Audio, TRAY_TIME } from './audio.js';
import { Touch, noGestures } from './touch.js';
import { titleBackground } from './title.js';
import { GB, ROOM as ROOM_BOUNDS, DESK_TOP as DESK_TOP_Y, RESET_AT, RESET_CAP_Y } from './scene.js';
import { OBB } from './collision.js';
import { Game1 } from './modes/game1.js';
import { Game2 } from './modes/game2.js';
import { Game3 } from './modes/game3.js';
import { Ending } from './modes/ending.js';
import { Virtualato } from './virtualato.js';
import { Book } from './book.js';
import { Guy } from './guy.js';
import { Music } from './music.js';

const MODES = { 1: Game1, 2: Game2, 3: Game3, ending: Ending };
const ENDING_ID = 4;   // shared/ending.h
const WAVE_MAX = 14;      // m: far enough for the GB screen to cover every wall
const CRT_FRONT = 0.45;   // where the room is pictured from for reflections: this far in front of the TV's middle
const SAVE_KEY = 'gelatolabs-ld60';
const VOL_STEPS = 20;
// the cheat (see the back of the manual): B and A are X and Z, or B and A
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'B', 'A'];
const KONAMI_KEYS = { KeyX: 'B', KeyB: 'B', KeyZ: 'A', KeyA: 'A' };

// The arrows are the d-pad (WASD moves the camera); Z / X are A / B on the GB
// and Cross / Square on the GelatoStation. There's no Start: A starts things over.
// IJKL work as the arrows too.
const ALIASES = { KeyI: 'ArrowUp', KeyK: 'ArrowDown', KeyJ: 'ArrowLeft', KeyL: 'ArrowRight' };
const GB_KEYS = { ArrowUp: RETRO.UP, ArrowDown: RETRO.DOWN, ArrowLeft: RETRO.LEFT, ArrowRight: RETRO.RIGHT,
  KeyZ: RETRO.A, KeyX: RETRO.B, ShiftRight: RETRO.SELECT, ShiftLeft: RETRO.SELECT };
const PS1_KEYS = { ArrowUp: RETRO.UP, ArrowDown: RETRO.DOWN, ArrowLeft: RETRO.LEFT, ArrowRight: RETRO.RIGHT,
  KeyZ: RETRO.B, KeyX: RETRO.Y, ShiftRight: RETRO.SELECT, ShiftLeft: RETRO.SELECT };

function mask(keys, map) {
  let m = 0;
  for (const [code, bit] of Object.entries(map)) if (keys.has(code)) m |= 1 << bit;
  return m;
}

function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) ?? {}; } catch { return {}; }
}

// The nearest point on the edge of the desk top to p (seen from above), at the desk top's height.
const DESK_RECT = { x0: -0.8, x1: 0.8, z0: -0.6, z1: 0.2 };
function deskEdge(p) {
  const r = DESK_RECT;
  let x = Math.min(Math.max(p.x, r.x0), r.x1), z = Math.min(Math.max(p.z, r.z0), r.z1);
  if (x === p.x && z === p.z) {
    // under the desk: out to the nearest side
    const d = [[p.x - r.x0, 'x', r.x0], [r.x1 - p.x, 'x', r.x1], [p.z - r.z0, 'z', r.z0], [r.z1 - p.z, 'z', r.z1]].sort((a, b) => a[0] - b[0])[0];
    if (d[1] === 'x') x = d[2]; else z = d[2];
  }
  return new THREE.Vector3(x, DESK_TOP_Y, z);
}

class App {
  constructor() {
    this.save = { unlocked: 1, ...loadSave() };
    this.keys = new Set();      // keyboard
    this.held = new Set();      // keyboard and gamepads
    this.pressed = new Set();
    this.pads = new Gamepads();
    this.audio = new Audio(this);
    this.audio.volume = this.save.volume ?? 10 / VOL_STEPS;   // (the TV's volume buttons set it; 10 of 20 to start with)
    this.ndc = new THREE.Vector2();
    this.mode = null;
    this.music = new Music(this);
    this.modeGame = 0;
    this.time = 0;
  }

  // Saves progress (once cheated, only the volume: what the cheat unlocked
  // goes when the page reloads, and so does anything won after it).
  persist() {
    const save = this.trueSave ? { ...this.trueSave, volume: this.save.volume } : this.save;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* private mode etc. */ }
  }

  // Watches for the cheat: unlocks every game, the zapper and the Virtualato,
  // out of the TV as if they'd been won.
  // (fed every key, button and touch button press, in order)
  cheatKey(code) {
    const k = KONAMI_KEYS[code] ?? code;
    if (!KONAMI.includes(k)) return;   // (other keys, like walking, don't break it)
    // the last presses (so a slip, like a third ↑, only needs the rest again)
    const last = this.konami = [...(this.konami ?? []), k].slice(-KONAMI.length);
    if (last.join() !== KONAMI.join()) return;
    this.konami = [];
    if (this.trueSave) return;
    this.trueSave = { ...this.save };
    this.audio.sfx('cheat', this.head());
    this.flash('EVERYTHING UNLOCKED!');
    const next = [];
    for (let g = this.save.unlocked + 1; g <= LAST_GAME; g++) {
      next.push(this.items.add('cart', g), this.items.add('disc', g));
      if (g === 3) next.push(this.items.add('zapper'));
    }
    this.save.unlocked = LAST_GAME;
    if (next.length) setTimeout(() => { this.items.spit(next); this.unrollPoster(); }, 600);
    if (!this.save.vb) {
      this.save.vb = true;
      // (out of reality, it waits until you're back, like everything else)
      if (this.escaped) { this.vb.placeHome(); this.vb.vanish(); } else setTimeout(() => this.vb.spit(), 600 + next.length * 250 + 800);
    }
  }

  // Loads and starts everything; progress(f) hears how far it's got (0..1).
  async start(progress = () => {}) {
    // the loading bar: everything there is to download (all at once, from the
    // start), then the models set up and the two consoles booted
    loading.listen(progress);
    // (each model parsed, the room built in five pieces, its shaders compiled, and the two consoles)
    loading.steps(MODELS.length + 6 + 2);
    for (const n of MODELS) loading.expect(`./models/${n}.glb`, n === 'virtualto_headset_base' || n === 'zapper' || n === 'gelatoboy' ? 300000 : 100000);
    for (const kind of ['gb', 'ps1']) wasm(kind).catch(() => {});
    rom(GAMES[1].gb).catch(() => {});
    rom(GAMES[1].ps1).catch(() => {});
    this.renderer = createRenderer(document.getElementById('app'));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x101018);
    this.camera = new THREE.PerspectiveCamera(60, this.viewSize().w / this.viewSize().h, 0.01, 20);
    this.scene.add(this.camera);
    this.fp = new FirstPerson(this.camera);
    // what you point at things with: the middle of the view, or a VR controller
    this.aim = new THREE.PerspectiveCamera();
    this.aim.matrixAutoUpdate = false;
    this.models = await loadModels((url, got, size) => loading.bytes(url, got, size), () => loading.step());
    this.world = buildScene(this.scene, this.models);
    this.effects = new Effects(this.scene);
    this.linkGeo = new LinkGeometry(this.world.gb.group, this.world.crt.group, this.camera);

    this.lcd = new EmuScreen(160, 144, 0.68);   // a DMG's pixels are slow to change: strong ghosting
    this.crt = new EmuScreen(320, 240, 0.25);
    this.world.gb.screen.material = createLcdMaterial(this.lcd);
    this.world.crt.screen.material = createCrtMaterial(this.crt);
    this.crt.onResize = (tex) => {
      this.world.crt.screen.material.uniforms.tex.value = tex;
      this.world.crt.screen.material.uniforms.texSize.value.set(this.crt.width, this.crt.height);
    };
    this.gb = new System('gb', this.lcd);
    this.ps1 = new System('ps1', this.crt);
    await loading.shown();

    this.cables = buildCables(this.scene, this.world, gbBoxFor(this.world.gb.group));
    this.solid = [...this.world.colliders, ...this.world.roomColliders];
    this.buildMaze();
    await loading.shown();
    this.cables.onSound = (name, at) => this.audio.sfx(name, at);
    this.hw = new Hardware(this);
    this.gbDragger = new Dragger(this.world.gb.group, this.camera, this.solid, GB.half, undefined, this.aim);
    this.items = new Items({
      scene: this.scene, camera: this.camera, aim: this.aim, world: this.world, colliders: this.solid, effects: this.effects,
      onInsert: (sys, game) => this.onInsert(sys, game),
      onSound: (name, at) => this.audio.sfx(name, at),
    });

    // media: game 1 starts inserted; anything unlocked earlier waits on the display stand
    this.items.seatCart(this.items.add('cart', 1));
    this.items.seatDisc(this.items.add('disc', 1));
    for (let g = 2; g <= Math.min(this.save.unlocked, LAST_GAME); g++) {
      this.items.dock(this.items.add('cart', g), false);
      this.items.dock(this.items.add('disc', g), false);
    }
    if (this.save.unlocked >= 3) this.items.dock(this.items.add('zapper'), false);
    this.items.dock(this.items.add('disc', CREDITS), false);
    // the Vanilla Fighter poster goes up once the fighter's unlocked
    this.poster = this.world.room.fighterPoster;
    this.poster.visible = this.save.unlocked >= 2;
    // the manual, where the Virtualato comes to rest (on top of it)
    this.book = new Book(this.scene, () => this.vb.onBook, this.camera, () => !this.xr?.presenting);
    this.cables.colliders.push(this.book.pad());
    this.book.onTurn = (what) => this.audio.sfx(what === 'page' ? 'page' : 'book', this.book.group.getWorldPosition(new THREE.Vector3()));
    this.vb = new Virtualato(this);
    this.items.vbModel = () => (this.vb.state === 'free' ? this.vb.model : null);
    if (this.save.vb) this.vb.placeHome();
    this.guy = new Guy(this.scene, this.models.signsign);
    // the YOU WIN! cartridge lives on the tray in the end room
    this.items.stow = (item) => this.stowWin(item);
    this.items.homes[WIN] = () => ({
      pos: this.maze.traySpot().add(new THREE.Vector3(0, 0.004, 0)),
      // lying flat, label up, reading from the room
      quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, Math.PI, 0, 'YXZ')),
    });
    this.escaped = false;
    this.wave = { r: 0, dir: 0 };
    this.stationFall = 0;
    await loading.shown();

    this.bindInput();
    this.xr = new XR(this);
    this.buildVbScreen();
    this.captureRoom();
    await loading.shown();
    // the walking guy's shaders, shadows' too, made now (with the room's
    // reflections in), not on the frame he first walks out: that took over a
    // second on a slow GPU. (The title screen hides this frame.)
    const cam = this.camera.clone();
    cam.position.set(0, 1.15, 0.8);
    cam.lookAt(0, DESK_TOP_Y, 0);
    this.guy.spawn(new THREE.Vector3(0, DESK_TOP_Y, 0), 0);
    this.renderer.render(this.scene, cam);
    this.guy.hide();
    await loading.shown();
    // and everything else's, so the first frame doesn't stop to make them
    await this.renderer.compileAsync(this.scene, this.camera).catch(() => {});
    await loading.shown();
    // both consoles start switched off (game 1 in them): just their downloads
    // to finish, so switching on is quick
    this.world.gb.setPower(this.hw.gbOn);
    await Promise.all([
      Promise.all([wasm('gb'), rom(GAMES[1].gb)]).then(() => this.gb.insert(this.hw.gbOn ? GAMES[1].gb : null)).then(() => loading.step()),
      Promise.all([wasm('ps1'), rom(GAMES[1].ps1)]).then(() => this.ps1.insert(this.hw.psPowered ? GAMES[1].ps1 : null)).then(() => loading.step()),
    ]);
    document.getElementById('status').textContent = '';
    document.body.classList.remove('loading');
    this.snapshotProps();
    this.last = performance.now();
    // (an animation loop rather than requestAnimationFrame: WebXR needs it)
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  // A button in the top right corner for fullscreen, where the browser can do it
  // (not on an iPhone), gone while it's fullscreen (the browser has its own
  // way out). (The Enter VR button goes under it.)
  fullscreenButton() {
    const el = document.documentElement;
    const request = el.requestFullscreen ?? el.webkitRequestFullscreen;
    if (!request || !(document.fullscreenEnabled ?? document.webkitFullscreenEnabled)) {
      // an iPhone can't make a page fullscreen; added to the home screen, though, it
      // opens as an app with nothing round it (see index.html): the button says how
      if ('standalone' in navigator && !navigator.standalone) {
        const b = document.createElement('button');
        b.id = 'fs-button';
        b.textContent = 'Fullscreen';
        b.addEventListener('click', () => {
          this.flash('For fullscreen on iPhone: tap Share, then Add to Home Screen, and play it from there.');
          b.blur();
        });
        document.getElementById('corner').appendChild(b);
      }
      return;
    }
    const current = () => document.fullscreenElement ?? document.webkitFullscreenElement;
    const b = document.createElement('button');
    b.id = 'fs-button';
    b.textContent = 'Fullscreen';
    const shown = () => { b.hidden = !!current(); };
    b.addEventListener('click', () => {
      request.call(el)?.catch?.(() => {});
      b.blur();   // (so Space doesn't press it again)
    });
    document.addEventListener('fullscreenchange', shown);
    document.addEventListener('webkitfullscreenchange', shown);
    document.getElementById('corner').appendChild(b);
  }

  // Has the GelatoStation been moved off the reset button (hidden under it)?
  resetUncovered() {
    const p = this.world.station.group.position;
    return Math.hypot(p.x - RESET_AT.x, p.z - RESET_AT.z) > 0.13 || p.y < RESET_AT.y - 0.01;
  }

  // How the props start out (for the reset button): the GelatoBoy and the
  // GelatoStation where they are, and the cables as they've settled.
  snapshotProps() {
    const w = this.world;
    this.propStart = [w.gb.group, w.station.group].map((o) => [o, o.position.clone(), o.quaternion.clone()]);
    this.cables.snapshot();
  }

  // The reset button: everything you can move back where it started: the
  // GelatoBoy, the GelatoStation, every plug and cable, the cartridges, discs
  // and zapper lying about (what's in a console stays in), the Virtualato and
  // the manual. What's been unlocked stays unlocked.
  resetProps() {
    const cap = this.world.reset.cap;
    cap.position.y = RESET_CAP_Y - 0.002;   // (pressed in, for a moment)
    setTimeout(() => { cap.position.y = RESET_CAP_Y; }, 180);
    this.audio.sfx('resetButton', cap.getWorldPosition(new THREE.Vector3()));
    if (this.gbDragger.dragging) this.gbDragger.end();
    if (this.items.held) this.items.drop();
    if (this.items.holdingZapper) this.items.dropZapper();
    for (const [o, pos, quat] of this.propStart) { o.position.copy(pos); o.quaternion.copy(quat); o.updateMatrixWorld(true); }
    this.stationFall = 0;
    this.cables.reset();
    for (const it of this.items.items) if (it.state !== 'inserted' && it.state !== 'holding' && it.game !== WIN) this.items.dock(it);
    if (this.vb.state === 'free' && this.save.vb && !this.escaped) this.vb.placeHome();
    this.putDownBook();
    this.book.close();
  }

  // The maze behind the front wall and the room at its end. Its walls stop the
  // camera, the cables and the GB; the GB-coloured wave can reach every wall.
  buildMaze() {
    const maze = this.maze = buildMaze(this.scene);
    this.mazeOpen = true;
    const front = this.world.roomColliders.front;
    const slabs = this.cables.colliders;
    slabs.splice(slabs.indexOf(front), 1);
    this.solid.splice(this.solid.indexOf(front), 1);
    // the front wall either side of the way in, and a floor under the maze
    const { minX, maxX, maxZ, height } = { ...ROOM_BOUNDS };
    const e = maze.entranceRect;
    const extra = [
      new THREE.Box3(new THREE.Vector3(minX - 1, -1, maxZ), new THREE.Vector3(e.x0, height + 1, maxZ + 0.1)),
      new THREE.Box3(new THREE.Vector3(e.x1, -1, maxZ), new THREE.Vector3(maxX + 1, height + 1, maxZ + 0.1)),
      new THREE.Box3(new THREE.Vector3(minX - 1, -1, maxZ), new THREE.Vector3(maxX + 1, 0, maze.layout.z1 + 0.2)),
    ].map((b) => OBB.fromBox3(b));
    for (const c of [...extra, ...maze.solids]) { slabs.push(c); this.solid.push(c); }
    this.cables.addSocket('maze-port', 'link-ps', maze.port, new THREE.Vector3(0, 0, 0.03), new THREE.Vector3(0, 0, 1), LINK_PS_SOCKET);
    for (const m of this.world.room.surfaces) gbWave(m, maze.waveUniforms);
    // walls only (things you put down can go on the desk), and walls plus the desk (you)
    const gap = () => (this.mazeOpen ? maze.entranceRect : null);
    const mazeWalls = () => [...maze.blockers, ...(this.doorSealed ? [maze.doorRect] : [])];
    this.wallBlockers = () => [...roomBlockers(gap(), false), ...mazeWalls()];
    this.fp.blockers = () => [...roomBlockers(gap()), ...mazeWalls()];
  }

  onInsert(sys, game) {
    const system = sys === 'gb' ? this.gb : this.ps1;
    system.insert(this.powered(sys) && game ? this.romFor(sys) : null);
  }

  // Is this console switched on (and plugged in)?
  powered(sys) { return sys === 'gb' ? this.hw.gbOn : this.hw.psPowered; }

  // The ROM a console runs with what's in it now.
  romFor(sys) {
    const item = sys === 'gb' ? this.items.cart : this.items.disc;
    return item && item.state === 'inserted' ? GAMES[item.game][sys] ?? null : null;
  }

  // The GelatoStation's power cord was pulled out or plugged back in. Back on,
  // it boots its disc again, and the GB restarts too if it has the matching game.
  powerPs(on) {
    this.ps1.insert(on ? this.romFor('ps1') : null);
    if (on && this.hw.gbOn && this.items.cart?.game === this.items.disc?.game) this.gb.insert(this.romFor('gb'));
  }

  // The GB's power switch.
  powerGb(on) {
    this.world.gb.setPower(on);
    this.gb.insert(on ? this.romFor('gb') : null);
  }

  // The link cable has moved: into the port at the end of the maze escapes
  // reality, and out of it puts everything back.
  onLinkChange(now, was) {
    if (now === 'maze') this.escape();
    else if (was === 'maze') this.unescape();
  }

  escape() {
    this.escaped = true;
    this.wave = { r: 0, dir: 1, origin: this.maze.port.getWorldPosition(new THREE.Vector3()) };
    this.maze.waveUniforms.gbOrigin.value.copy(this.wave.origin);
    this.vb.vanish();
    // no more wandering into the maze (from either end, if you're in the end room)
    this.mazeOpen = false;
    this.doorSealed = this.head().z > this.maze.doorRect.z1;
    this.maze.door.visible = this.doorSealed;
    this.audio.sfx('waveIn', this.wave.origin);
    this.giveWin();
  }

  // Escaping reality: a tray slides out of the wall beside the port (over
  // TRAY_TIME: a little longer than the walls take to turn), with the YOU WIN!
  // cartridge on it the first time since loading the game.
  giveWin() {
    if (!this.won) {
      this.won = true;
      this.items.dock(this.items.add('cart', WIN), false);
    }
    this.moveTray(true);
  }

  // Putting the YOU WIN! cartridge away while the tray's in the wall: it waits
  // over where the tray comes out, the tray opens, it goes down onto it, and
  // the tray takes it back in. (Hooked into Items.dock.)
  stowWin(item) {
    if (item.game !== WIN || this.trayOpen) return false;
    const spot = this.maze.traySpotOut().add(new THREE.Vector3(0, 0.004, 0)), quat = this.items.home(item).quat;
    this.items.fly(item, spot.clone().add(new THREE.Vector3(0, 0.1, 0)), quat, 0, () => {
      this.moveTray(true, () => this.items.fly(item, spot, quat, 0, () => {
        this.items.dock(item, false);
        this.moveTray(false);
      }, 0));
    });
    return true;
  }

  // The tray sliding out of the wall, or back in (from wherever it's got to);
  // the YOU WIN! cartridge rides along if it's lying on it, and goes in with
  // it. done() once it's there.
  moveTray(out, done) {
    this.trayOpen = out;
    const tray = this.maze.tray, from = tray.position.z, to = out ? this.maze.trayOut : this.maze.trayIn;
    const time = TRAY_TIME * Math.abs(to - from) / Math.abs(this.maze.trayOut - this.maze.trayIn);
    if (time <= 0) { done?.(); return; }
    const cart = this.items.items.find((i) => i.game === WIN);
    const riding = cart && cart.state === 'free' && cart.object.position.distanceTo(this.items.home(cart).pos) < 0.02;
    tray.visible = true;
    this.maze.slot.visible = true;
    if (riding) cart.object.visible = true;
    this.audio.sfx('tray', tray.getWorldPosition(new THREE.Vector3()));
    const t0 = this.time;
    this.trayAnim = () => {
      const f = Math.min(1, (this.time - t0) / time), e = f * f * (3 - 2 * f);
      tray.position.z = from + (to - from) * e;
      if (riding && cart.state === 'free') this.items.dock(cart, false);
      if (f < 1) return;
      this.trayAnim = null;
      if (out) { done?.(); return; }
      // in: out of sight, cartridge and all
      tray.visible = false;
      this.maze.slot.visible = false;
      if (riding && cart.state === 'free') cart.object.visible = false;
      done?.();
    };
  }

  unescape() {
    this.escaped = false;
    this.wave.dir = -1;
    this.audio.sfx('waveOut', this.head());
    this.vb.back();
    this.mazeOpen = true;
    this.doorSealed = false;
    this.maze.door.visible = false;
    this.guy.hide();
    if (this.won) this.moveTray(false);   // the tray goes back into the wall
  }

  // The link cable doesn't stretch. Carrying the GB away drags the
  // GelatoStation after it (off the desk, if it comes to that) until its power
  // cord or AV cable is taut, and then you can't go any further.
  tether(dt) {
    const c = this.cables, gbEnd = c.ends['link-gb'], psEnd = c.ends['link-ps'];
    const station = this.world.station.group;
    if (gbEnd.socket && psEnd.socket) {
      const L = gbEnd.cable.length * 0.9;
      const over = gbEnd.socket.world().distanceTo(psEnd.socket.world()) - L;
      if (over > 0 && psEnd.socket.name === 'ps-link') {
        const pull = gbEnd.socket.world().sub(psEnd.socket.world());
        pull.y = 0;
        if (pull.lengthSq() > 1e-10) station.position.add(pull.setLength(over));
        // held back by its power cord, if that's plugged into the wall, and by
        // the AV cable, if that's plugged into the TV (neither comes out)
        const tied = [];
        const iec = c.ends['ps-iec'], mains = c.ends['ps-mains'];
        if (iec.socket?.name === 'ps-iec' && mains.socket) tied.push([iec.socket, mains.socket, iec.cable.length]);
        const av = c.ends.av, rca = ['rca-y', 'rca-w', 'rca-r'].map((n) => c.ends[n]).filter((e) => e.socket);
        if (av.socket?.name === 'ps-av') {
          for (const e of rca) tied.push([av.socket, e.socket, av.cable.length + e.cable.length]);
        }
        this.stationHang = -Infinity;
        // a few rounds, so the cables settle together rather than taking turns
        for (let round = 0; round < 4; round++) {
          for (const [on, to, length] of tied) {
            station.updateMatrixWorld();
            const S = on.world(), O = to.world(), L = length * 0.9;
            // below the desk top with the other end up on it, the cable has to go
            // round the nearest edge of the desk: it reaches less far
            if (S.y < DESK_TOP_Y && O.y > DESK_TOP_Y) {
              const E = deskEdge(S);
              const viaEdge = S.distanceTo(E) + E.distanceTo(O);
              const toEdge = E.clone().sub(S);
              toEdge.y = 0;
              const h = toEdge.length();
              if (viaEdge > L && h > 1e-9) station.position.add(toEdge.setLength(Math.min(h, viaEdge - L)));
              if (round === 0) this.stationHang = Math.max(this.stationHang, DESK_TOP_Y - Math.max(0, L - E.distanceTo(O)) - (S.y - station.position.y));
              continue;
            }
            // as far out as the cable reaches at this height (never past what's needed)
            const v = Math.abs(O.y - S.y), back = O.clone().sub(S);
            back.y = 0;
            const h = back.length(), reach = Math.sqrt(Math.max(0, L * L - v * v));
            if (h > reach && h > 1e-9) station.position.add(back.setLength(h - reach));
            // a cable too short to reach the floor leaves it hanging
            if (round === 0) this.stationHang = Math.max(this.stationHang, O.y - L - (S.y - station.position.y));
          }
        }
        // and, however it lies, by how much cable there really is: pulled tight, a
        // cable (round the back of the desk, say) holds the GelatoStation back
        for (const name of ['ps-iec', 'av']) {
          const e = c.ends[name];
          if (e.socket?.anchor.object !== station || !(name === 'av' ? rca.length : mains.socket)) continue;
          const ps = e.cable.particles;
          let len = 0;
          for (let i = 1; i < ps.length; i++) len += ps[i].x.distanceTo(ps[i - 1].x);
          const over = len - e.cable.length * 1.04;
          if (over <= 0) continue;
          const toward = ps[e.index ? e.index - 3 : 3].x.clone().sub(e.socket.world());
          toward.y = 0;
          if (toward.lengthSq() > 1e-10) station.position.add(toward.setLength(Math.min(over, 0.02)));
        }
        // it can't go through walls
        const p = new THREE.Vector3(station.position.x, 0, station.position.z);
        pushOut(p, this.wallBlockers(), 0.14);
        station.position.x = p.x;
        station.position.z = p.z;
      }
      // whatever's left over: the GB (and you, holding it) can't go further;
      // being pulled back takes neither of you into the desk or a wall
      const G = gbEnd.socket.world(), P = psEnd.socket.world(), left = G.distanceTo(P) - L;
      if (left > 0) {
        const back = P.sub(G).setLength(left);
        this.world.gb.group.position.add(back);
        if (this.gbDragger.dragging) {
          this.gbDragger.resolve();
          back.y = 0;
          this.moveBody(back, true);
        }
      }
    }
    // the GelatoStation sits on the desk, or drops to the floor once it's off
    // it; once down there it stays there, even if it's pulled back under the desk
    const overDesk = Math.abs(station.position.x) < 0.8 && station.position.z > -0.6 && station.position.z < 0.2;
    const onDesk = overDesk && station.position.y > DESK_TOP_Y;
    const ground = Math.max((onDesk ? DESK_TOP_Y : 0) + 0.025, this.stationHang ?? -Infinity);
    if (station.position.y > ground + 1e-4) {
      this.stationFall += 9.8 * dt;
      station.position.y = Math.max(ground, station.position.y - this.stationFall * dt);
    } else {
      station.position.y = ground;
      this.stationFall = 0;
    }
  }

  // A mode finished its game: unlock the next pair (and the zapper after game 2).
  onWin(game) {
    if (game >= LAST_GAME) {
      if (this.save.vb) return;
      this.save.vb = true;
      this.persist();
      setTimeout(() => this.vb.spit(), 2500);
      return;
    }
    if (this.save.unlocked > game) return;
    this.save.unlocked = game + 1;
    this.persist();
    setTimeout(() => {
      const next = [this.items.add('cart', game + 1), this.items.add('disc', game + 1)];
      if (game + 1 === 3) next.push(this.items.add('zapper'));
      this.items.spit(next);
      if (game + 1 === 2) this.unrollPoster();
    }, 2500);
  }

  // The Vanilla Fighter poster unrolling down the wall (from its top edge,
  // with a bounce and a sway as it settles).
  unrollPoster() {
    if (this.poster.visible) return;
    this.poster.visible = true;
    this.posterT = 0;
    this.posterTop ??= this.poster.position.y + 0.294;
    this.audio.sfx('page', this.poster.position);
  }

  animatePoster(dt) {
    if (this.posterT === undefined || this.posterT >= 1) return;
    const t = this.posterT = Math.min(1, this.posterT + dt / 1.1), p = this.poster;
    const s = 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;   // (ease out, overshooting a little)
    p.scale.y = Math.max(0.001, s);
    p.position.y = this.posterTop - 0.294 * p.scale.y;
    p.rotation.z = Math.sin(t * 18) * 0.05 * (1 - t) ** 2;
  }

  // How far along you are (the debug menu): 1 at the start, 2 with the
  // fighter, 3 with the shooter and the GelatoBlaster, 4 with the Virtualato.
  progress() { return this.save.vb ? LAST_GAME + 1 : Math.min(this.save.unlocked, LAST_GAME); }

  // Steps the progress (debug): forward as if the last game unlocked had been
  // won, back by saving the earlier progress and reloading the page.
  stepProgress(dir) {
    const p = this.progress();
    if (dir > 0) { if (p <= LAST_GAME) this.onWin(p); return; }
    if (p <= 1) return;
    this.trueSave = null;   // (over a cheat too)
    this.save = { ...this.save, unlocked: Math.min(p - 1, LAST_GAME), vb: p - 1 > LAST_GAME };
    this.persist();
    location.reload();
  }

  flash(text) {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 7000);
  }

  // Mouselook: clicking locks the pointer (Esc lets it go) and the mouse turns
  // the view. Everything you do is aimed with the reticle: in the middle of the
  // screen (this.ndc at (0, 0)), except while reading the book, when it moves over the pages.
  bindInput() {
    const canvas = this.renderer.domElement;
    window.addEventListener('keydown', (e) => {
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      const code = ALIASES[e.code] ?? e.code;
      this.inputKind = 'keys';
      if (!this.keys.has(code)) { this.pressed.add(code); this.cheatKey(code); }
      this.keys.add(code);
      if (e.code === 'Backquote') { const hud = document.getElementById('hud'); hud.hidden = !hud.hidden; }
      // with the debug menu open, the number keys toggle effects and Q/E step the progress
      if (!document.getElementById('hud').hidden) {
        if (/^Digit[1-9]$/.test(e.code)) this.toggleFx(+e.code.slice(5) - 1);
        if (e.code === 'KeyQ' && !e.repeat) this.stepProgress(-1);
        if (e.code === 'KeyE' && !e.repeat) this.stepProgress(1);
      } else if (e.code === 'KeyQ' && !this.book.held) this.items.dropZapper();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(ALIASES[e.code] ?? e.code));
    window.addEventListener('blur', () => this.keys.clear());

    const locked = () => document.pointerLockElement === canvas;
    const lock = () => {
      // not under automation (tests): Chrome on macOS would grab the real mouse even when headless
      if (navigator.webdriver) return;
      try { canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* not allowed here */ }
    };
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.touch = new Touch(this);
    this.fullscreenButton();
    canvas.style.touchAction = 'none';
    noGestures(canvas);
    canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') this.touch.moveTo(e); });
    canvas.addEventListener('pointercancel', (e) => { if (e.pointerType === 'touch') this.touch.up(e); });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') { this.inputKind = 'touch'; this.touch.down(e); return; }
      this.inputKind = 'keys';
      if (!locked()) lock();
      if (e.button === 2) { this.rightClick(); return; }
      if (e.button !== 0) return;
      this.click();
    });
    document.addEventListener('mousemove', (e) => {
      if (locked()) this.look(e.movementX * 0.75, e.movementY * 0.75);
    });
    // (what's picked up stays in your hand until it's put down: right-click)
    canvas.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch') this.touch.up(e); else if (e.button === 0) this.book.penUp(); });
    canvas.addEventListener('wheel', (e) => {
      if (this.gbDragger.dragging) this.gbDragger.wheel(-e.deltaY * 0.0005);
      else if (this.items.held) this.items.wheel(-e.deltaY * 0.0005);
      else return;
      e.preventDefault();
    }, { passive: false });
    // the view fills #app (fixed over the whole screen); sized from it, not
    // window.innerHeight, which an iPhone's home screen app started in landscape
    // gets wrong (too short) until it's turned round
    const fit = () => {
      const { w, h } = this.viewSize();
      if (!w || !h || this.renderer.xr.isPresenting) return;   // (WebXR sizes it itself)
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
      this.aimAt(this.ndc.x, this.ndc.y);   // (the reticle, in pixels)
    };
    new ResizeObserver(fit).observe(document.getElementById('app'));
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', () => setTimeout(fit, 300));
    window.visualViewport?.addEventListener('resize', fit);
  }

  // The view's size in CSS pixels.
  viewSize() {
    const el = document.getElementById('app');
    return { w: el.clientWidth || window.innerWidth, h: el.clientHeight || window.innerHeight };
  }

  // Mouse, stick or finger movement: turns the view, or (reading the book)
  // moves the reticle over it instead.
  look(dx, dy) {
    if (!this.book.held) { this.fp.look(dx, dy); return; }
    const { w, h } = this.viewSize(), k = 1 / (h * 0.4);
    this.aimAt(this.ndc.x + dx * k * (h / w), this.ndc.y - dy * k);
  }

  // The reticle to a point on the screen (CSS pixels).
  aimAtPx(x, y) {
    const { w, h } = this.viewSize();
    this.aimAt((x / w) * 2 - 1, 1 - (y / h) * 2);
  }

  // The reticle (and what it points at) to (x, y), -1..1 across the view.
  aimAt(x, y) {
    this.ndc.set(Math.min(1, Math.max(-1, x)), Math.min(1, Math.max(-1, y)));
    const r = document.getElementById('reticle').style, { w, h } = this.viewSize();
    r.left = `${(this.ndc.x + 1) * 0.5 * w}px`;   // (in pixels: the view can be bigger than the page, see fitScreen)
    r.top = `${(1 - this.ndc.y) * 0.5 * h}px`;
  }

  // Turning the held book's pages from the keys or a stick: a press (or a push
  // of a stick over to the side, from the middle) turns one.
  pageKeys(stick) {
    const b = this.book;
    let dir = 0;
    for (const k of this.pressed) {
      if (k === 'KeyA' || k === 'ArrowLeft') dir = -1;
      if (k === 'KeyD' || k === 'ArrowRight') dir = 1;
    }
    const sx = stick.x;
    if (Math.abs(sx) > 0.6 && !this.pageStick) { dir = Math.sign(sx); this.pageStick = true; }
    if (Math.abs(sx) < 0.3) this.pageStick = false;
    if (dir && !b.queue.length) b.turn(dir);
  }

  putDownBook() {
    this.book.putDown();
    this.aimAt(0, 0);
  }

  // What a click on whatever's under the reticle would do: { label, act } or null.
  target() {
    this.syncAim();
    // reading the book, it's all there is
    if (this.book.held) {
      const rc = new THREE.Raycaster();
      rc.setFromCamera(this.ndc, this.aim);
      return this.book.target(rc);
    }
    // wearing the Virtualato, all you can do is pick up the GelatoBoy (to carry it through the maze)
    if (this.vb.worn) {
      if (this.gbDragger.dragging || !this.gbDragger.hits(this.ndc)) return null;
      return { label: 'Pick up', act: () => this.gbDragger.start(this.ndc) };
    }
    if (this.items.holdingZapper) return { label: '', act: () => this.shoot() };
    if (this.gbDragger.dragging) return null;
    // a cartridge or disc in hand goes in when it's over its console
    if (this.items.held) return { label: '', act: () => this.items.insertHeld() };
    // holding a plug: point it at a socket it fits
    if (this.cables.holding) {
      const rc = new THREE.Raycaster();
      rc.setFromCamera(this.ndc, this.aim);
      const s = this.cables.socketOnRay(rc.ray);
      return s ? { label: 'Plug in', act: () => this.cables.plugHeld(s) } : null;
    }
    // what's nearest along the ray wins: anything behind the GelatoBoy (when
    // you're looking at it) loses to picking it up. Things on it (its switch,
    // its link plug) are as near as it is.
    const gbD = this.hitDistance(this.world.gb.group);
    const near = (obj) => { const d = this.hitDistance(obj); return d < Infinity && d <= gbD + 0.003; };
    const end = this.cables.pick(this.ndc, this.aim);
    // (a plug is small: the ray only needs to pass close by, or along its cable)
    if (end && (gbD === Infinity || near(end.plug))) {
      if (end.socket) return { label: 'Unplug', act: () => this.cables.unplug(end) };
      return { label: 'Pick up', act: () => this.cables.hold(end) };
    }
    if (near(this.world.gb.powerSwitch)) return { label: this.hw.gbOn ? 'Power off' : 'Power on', act: () => this.hw.toggleGb() };
    const crt = this.world.crt;
    if (near(crt.volDown)) return { label: 'Volume −', act: () => this.changeVolume(-1) };
    if (near(crt.volUp)) return { label: 'Volume +', act: () => this.changeVolume(1) };
    const st = this.world.station;
    if (near(st.power)) return { label: this.hw.psOn ? 'Power off' : 'Power on', act: () => this.hw.togglePs() };
    if (this.resetUncovered() && near(this.world.reset.hit)) return { label: 'Press button', act: () => this.resetProps() };
    if (near(st.eject)) return { label: this.items.lidOpen ? 'Close lid' : 'Open lid', act: () => this.items.toggleLid() };
    const item = this.items.pick(this.ndc);
    // (what's in the Virtualato comes out, rather than it going on)
    if (item && item === this.items.vbItem && near(item.object)) return { label: 'Take out', act: () => this.items.startDrag(item, this.ndc) };
    if (this.vb.hits(this.ndc) && near(this.vb.model)) return { label: 'Put on', act: () => this.vb.wear() };
    if (item && near(item.object)) return { label: 'Pick up', act: () => this.items.startDrag(item, this.ndc) };
    const rc = new THREE.Raycaster();
    rc.setFromCamera(this.ndc, this.aim);
    const page = near(this.book.group) && this.book.target(rc);
    if (page) return page;
    if (this.gbDragger.hits(this.ndc)) {
      return { label: 'Pick up', act: () => this.gbDragger.start(this.ndc) };
    }
    return null;
  }

  click() { this.target()?.act(); }

  // Gamepads: their buttons join the keyboard's, the triggers click.
  pollPads(dt) {
    // in VR the right stick turns you (your head does the rest)
    const p = this.pads.poll(dt, (dx, dy) => (this.xr.presenting ? this.xr.turn(-dx * 0.004) : this.look(dx, dy)),
      this.xr.presenting, this.xr.presenting && this.xr.tracked(), this.vb.worn);
    this.held = new Set([...this.keys, ...this.pads.keys, ...this.xr.keys, ...(this.touch?.keys ?? [])]);
    for (const k of p.pressed) { this.pressed.add(k); this.cheatKey(k); }
    // (the Plug and Pray poster shows the controls for what you're using)
    if (p.any || this.pads.move.x || this.pads.move.y) this.inputKind = 'pad';
    this.world.room.controlsPoster.setMode(this.xr.presenting ? 'vr' : this.inputKind ?? 'keys');
    if (p.fire) this.click();
    if (p.release) this.book.penUp();   // (the trigger let go: the pen up)
    if (p.alt) this.rightClick();
    if (p.select) { const hud = document.getElementById('hud'); hud.hidden = !hud.hidden; }
  }

  // What right-click does now (shown at the bottom of the screen): { label, act } or null.
  rightAction() {
    if (this.book.held) return { label: 'Put down booklet', act: () => this.putDownBook() };
    if (this.cables.holding) return { label: 'Drop plug', act: () => this.cables.drop() };
    if (this.items.held) return { label: `Put away ${this.items.held.kind === 'disc' ? 'disc' : 'cartridge'}`, act: () => this.items.drop() };
    if (this.gbDragger.dragging) return { label: 'Let go of GelatoBoy', act: () => this.gbDragger.end() };
    if (this.items.holdingZapper) return { label: 'Put away GelatoBlaster', act: () => this.items.dropZapper() };
    if (this.vb.worn) return { label: 'Remove Virtualato', act: () => this.vb.remove() };
    return null;
  }

  rightClick() { this.syncAim(); this.rightAction()?.act(); }

  // The reticle's label and the right-click hint. Looking for a target means
  // ray casts, so not every frame.
  updateHints() {
    if ((this.hintTick = (this.hintTick ?? 0) + 1) % 4) return;
    let label = this.target()?.label ?? '';
    if (this.items.held) label = this.items.dropTarget(this.items.held) ? `Insert ${this.items.held.kind === 'disc' ? 'disc' : 'cartridge'}` : '';
    const right = this.rightAction();
    const rl = document.getElementById('reticle-label'), hb = document.getElementById('right-hint');
    if (rl.textContent !== label) rl.textContent = label;
    const r = right ? `Right-click: ${right.label}` : '';
    if (hb.textContent !== r) hb.textContent = r;
    document.getElementById('reticle').classList.toggle('active', !!label);
    this.xr.setHints(label, right?.label ?? '');
  }

  // How far along the pointer ray obj is (Infinity: not on it).
  hitDistance(obj) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(this.ndc, this.aim);
    return rc.intersectObject(obj, true)[0]?.distance ?? Infinity;
  }

  // Fires the zapper along the pointer ray; hits on a screen go to the mode as screen coordinates.
  shoot() {
    this.items.recoil();
    const ray = this.items.aimRay(this.ndc);
    const rc = new THREE.Raycaster(ray.origin, ray.direction);
    const targets = [this.world.gb.screen, this.world.crt.screen];
    const blockers = [this.world.gb.group, this.world.crt.group, this.world.station.group];
    // a screen counts unless something's really in front of it (the models' own
    // screen faces lie flush with it, and would otherwise catch a third of the shots)
    const first = rc.intersectObjects(blockers, true)[0];
    const hit = rc.intersectObjects(targets, false)[0];
    const muzzle = this.items.zapper.object.localToWorld(new THREE.Vector3(0, 0.02, 0.11));
    this.audio.sfx('zap', muzzle);
    this.zapGlow = 1;   // its round front flashes green (see updateZap)
    if (!hit || (first && first.distance < hit.distance - 0.003)) return null;
    let u = hit.uv.x, v = 1 - hit.uv.y;
    const sys = hit.object === this.world.gb.screen ? 'gb' : 'ps1';
    if (sys === 'ps1') [u, v] = crtCurve(u, v);
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    this.mode?.onShot?.(sys, u, v);
    return { sys, u, v };
  }

  // Starts/stops the host logic for whichever game both consoles agree on.
  syncMode() {
    const g = this.gb.game, p = this.ps1.game;
    // the YOU WIN! cartridge runs on its own; the games need both halves
    // (and the link cable between them: without it they can't talk)
    const want = g === ENDING_ID ? 'ending' : g && g === p && MODES[g] && this.hw.link === 'ps1' ? g : 0;
    if (want !== this.modeGame) {
      this.mode?.dispose?.();
      this.mode = want ? new MODES[want](this) : null;
      this.modeGame = want;
    }
    // tell each ROM what its partner is running
    if (this.gb.ready) this.gb.link.setCtrl(CTRL.PARTNER, p);
    if (this.ps1.ready) this.ps1.link.setCtrl(CTRL.PARTNER, g);
  }

  frame(now) {
    // (never backwards: the first frame's timestamp can be from before start() set last,
    // and a negative dt would run every countdown, like the zapper's glow, the wrong way)
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    this.xr.update(dt);
    this.pollPads(dt);
    const stick = this.touch?.active ? { x: this.pads.move.x + this.touch.move.x, y: this.pads.move.y + this.touch.move.y } : this.pads.move;
    // reading the book, nothing else answers: no walking, jumping or playing (only
    // the reticle moves); left and right (A/D, the arrows, a stick pushed over) turn its pages
    const reading = this.book.held, held = reading ? new Set() : this.held;
    if (reading) {
      this.pageKeys(stick);
      // drawing on the notes: the pen follows the reticle while it's down
      if (this.book.pen) {
        this.syncAim();
        const rc = new THREE.Raycaster();
        rc.setFromCamera(this.ndc, this.aim);
        this.book.penTo(rc);
      }
    }
    if (!this.xr.presenting) this.fp.update(dt, held, reading ? { x: 0, y: 0 } : stick);
    // landing from a jump jolts the floor: the light bulb swings
    if (this.fp.landed) { this.world.lampSwing.kick(this.camera.position, this.fp.landed); this.fp.landed = 0; }
    this.world.lampSwing.update(dt);
    this.syncAim();
    this.gbDragger.update(dt);
    // a plug in your hand: a little way in front of you, along where you're pointing
    if (this.cables.holding) {
      const rc = new THREE.Raycaster();
      rc.setFromCamera(this.ndc, this.aim);
      this.cables.moveHeld(rc.ray.at(this.xr.presenting ? 0.05 : 0.3, new THREE.Vector3()));
    }
    this.tether(dt);
    this.items.update(dt, this.ndc);
    this.animatePoster(dt);
    this.items.spinDisc(dt, this.hw.psPowered);
    if (!this.cablesPaused) this.cables.update(dt);
    this.linkGeo.enabled = this.hw.link === 'ps1';
    this.linkGeo.update();

    this.gb.input = mask(held, GB_KEYS);
    this.ps1.input = mask(held, PS1_KEYS);
    this.syncMode();
    this.music.update();
    const onFrame = (sys) => {
      for (const msg of sys.link.receive()) this.mode?.onMessage(sys.kind, msg);
      this.mode?.onFrame?.(sys);
    };
    // wearing the Virtualato, the GB and the GelatoStation are paused: the
    // Virtual Boy emulator needs all the time it can get
    const vbOnly = this.vb.worn;
    if (!vbOnly) {
      this.gb.step(dt, onFrame);
      this.ps1.step(dt, onFrame);
      this.mode?.update(dt);
      this.audio.feed(this.gb);
      this.audio.feed(this.ps1);
    }
    this.renderer.shadowMap.autoUpdate = !vbOnly;
    this.effects.update(dt);
    this.pressed.clear();

    this.world.crt.screen.material.uniforms.time.value = this.time;
    this.updateOsd(dt);
    this.updateZap(dt);
    this.world.gb.update(this.time);
    // a console's link port only glows while it's on
    const sk = this.cables.sockets;
    if (sk['gb-ext'].outline) sk['gb-ext'].outline.visible = this.hw.gbOn;
    if (sk['ps-link'].outline) sk['ps-link'].outline.visible = this.hw.psPowered;
    this.hw.update(dt);
    this.updateWave(dt);
    this.trayAnim?.();
    this.book.update(dt);
    this.vb.update(dt);
    if (!vbOnly) this.updateGlow();
    this.audio.update();
    this.updateHud();
    this.updateHints();
    this.touch?.update();
    // wearing the Virtualato, all you see is what it draws
    if (!this.vb.worn || this.xr.presenting) this.render();
  }

  // Where your eyes are (in the world), and which way you're looking.
  head() { return this.camera.getWorldPosition(new THREE.Vector3()); }

  view() {
    const e = new THREE.Euler().setFromQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
    return { yaw: e.y, pitch: e.x };
  }

  // The TV's volume buttons: the whole game's volume, in 20 steps (kept with
  // the save), shown on the TV like a TV of the time would.
  changeVolume(step) {
    const n = Math.max(0, Math.min(VOL_STEPS, Math.round(this.audio.volume * VOL_STEPS) + step));
    this.audio.setVolume(n / VOL_STEPS);
    this.save.volume = n / VOL_STEPS;
    this.persist();
    const btn = step < 0 ? this.world.crt.volDown : this.world.crt.volUp;
    this.audio.sfx('button', btn.getWorldPosition(new THREE.Vector3()));
    this.drawOsd(n);
    this.osdTime = 2.5;
  }

  // The volume display: VOLUME and a row of bars, green with a black edge, low on the screen.
  drawOsd(n) {
    if (!this.osd) {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 240;
      this.osd = { canvas: c, g: c.getContext('2d'), texture: new THREE.CanvasTexture(c) };
      this.world.crt.screen.material.uniforms.osd.value = this.osd.texture;
    }
    const { canvas: c, g, texture } = this.osd;
    g.clearRect(0, 0, c.width, c.height);
    const x0 = 44, y = 196;
    g.font = 'bold 16px monospace';
    g.textBaseline = 'alphabetic';
    const text = (s, x, yy) => {
      g.fillStyle = '#000';
      g.fillText(s, x + 2, yy + 2);
      g.fillStyle = '#4dff4d';
      g.fillText(s, x, yy);
    };
    text('VOLUME', x0, y - 8);
    text(String(n).padStart(2, ' '), x0 + VOL_STEPS * 11 + 6, y + 13);
    for (let i = 0; i < VOL_STEPS; i++) {
      const x = x0 + i * 11;
      g.fillStyle = '#000';
      g.fillRect(x + 2, y + 2, 7, 14);
      g.fillStyle = i < n ? '#4dff4d' : '#123d12';
      g.fillRect(x, y, 7, 14);
    }
    texture.needsUpdate = true;
  }

  // The zapper's round front glows green when it fires, fading out quickly.
  updateZap(dt) {
    const tip = this.items.zapper?.object.userData.tip;
    if (!tip) return;
    this.zapGlow = Math.max(0, (this.zapGlow ?? 0) - dt / 0.3);
    tip.material.emissive.setHex(0x4dff4d);
    tip.material.emissiveIntensity = 3 * this.zapGlow * this.zapGlow;
  }

  // The volume display fades a couple of seconds after the last press (it's
  // the TV's, so only there while the TV's on).
  updateOsd(dt) {
    const u = this.world.crt.screen.material.uniforms;
    this.osdTime = Math.max(0, (this.osdTime ?? 0) - dt);
    u.osdOn.value = Math.min(1, this.osdTime / 0.25) * (this.hw.crtLit > 0.5 ? 1 : 0);
  }

  // Moves you; with collide, not into the desk or a wall.
  moveBody(d, collide = false) {
    const body = this.xr.presenting ? this.xr.rig.position : this.camera.position;
    body.add(d);
    if (!collide) return;
    const head = this.head(), p = head.clone();
    pushOut(p, this.fp.blockers());
    body.x += p.x - head.x;
    body.z += p.z - head.z;
  }

  // The pointer: the middle of the view, or (in VR) the controller in use.
  syncAim() {
    if (this.xr.presenting && this.xr.syncAim()) return;
    this.camera.updateMatrixWorld();
    this.aim.matrixWorld.copy(this.camera.matrixWorld);
    this.aim.matrixWorldInverse.copy(this.camera.matrixWorldInverse);
    // (and its lens: reading the book, the reticle isn't always in the middle)
    this.aim.projectionMatrix.copy(this.camera.projectionMatrix);
    this.aim.projectionMatrixInverse.copy(this.camera.projectionMatrixInverse);
  }

  // A picture of the room from in front of the TV, for reflections: sharp in
  // the TV's glass, blurred (prefiltered) for everything else's subtle sheen.
  captureRoom() {
    const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    const cam = new THREE.CubeCamera(0.05, 20, rt);
    this.world.crt.group.updateMatrixWorld();
    cam.position.copy(new THREE.Vector3(0, 0, CRT_FRONT).applyMatrix4(this.world.crt.group.matrixWorld));
    this.scene.add(cam);
    cam.update(this.renderer, this.scene);
    this.scene.remove(cam);
    this.world.crt.screen.material.uniforms.env.value = rt.texture;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromCubemap(rt.texture).texture;
    this.scene.environmentIntensity = 0.3;
    pmrem.dispose();
  }

  // In VR the Virtualato's picture is in front of your eyes (on the desktop
  // it's the page overlay), over a black hood that shuts out the room, and in
  // stereo like the real thing: a screen for each eye, the left one on layer 1
  // and the right on layer 2 (WebXR's left and right eye cameras each add
  // their own); the hood is on layer 3.
  buildVbScreen() {
    const top = { depthTest: false, depthWrite: false, transparent: true };
    const hood = this.vbHood = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshBasicMaterial({ color: 0, side: THREE.BackSide, ...top }));
    hood.renderOrder = 998;
    hood.raycast = () => {};   // never in the way of pointing at things
    hood.layers.set(3);
    hood.visible = false;
    this.vbTextures = [this.vb.canvas, this.vb.canvasR].map((canvas) => {
      const t = new THREE.CanvasTexture(canvas);
      t.magFilter = THREE.NearestFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });
    this.vbScreens = this.vbTextures.map((map, i) => {
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7), new THREE.MeshBasicMaterial({ map, ...top }));
      screen.position.z = -0.25;
      screen.scale.setScalar(0.5);
      screen.renderOrder = 999;
      screen.visible = false;
      screen.raycast = () => {};
      screen.layers.set(i + 1);
      return screen;
    });
    this.camera.layers.enable(3);
    this.camera.add(hood, ...this.vbScreens);
  }

  // The room, then the zapper if you're holding it, on top of everything
  // (like a weapon in a shooter), so the GB never hides it.
  render() {
    if (this.xr.presenting) {
      // VR: the Virtualato's screen (if it's on), and the zapper in the controller's hand
      const f = this.vb.fade ?? 0;
      this.vbHood.visible = f > 0;
      this.vbHood.material.opacity = f;
      for (const s of this.vbScreens) { s.visible = f > 0; s.material.opacity = f; }
      // all the way in, only the Virtualato is drawn (the hood, and each eye its own screen)
      this.camera.layers.set(f >= 1 ? 3 : 0);
      if (f < 1) this.camera.layers.enable(3);
      if (f > 0) for (const t of this.vbTextures) t.needsUpdate = true;
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.vbHood.visible = false;
    for (const s of this.vbScreens) s.visible = false;
    // (back from VR all the way inside the Virtualato: the room again)
    if (!this.camera.layers.isEnabled(0)) { this.camera.layers.set(0); this.camera.layers.enable(3); }
    const z = this.items.zapper, held = this.items.holdingZapper;
    if (!this.viewScene) {
      this.viewScene = new THREE.Scene();
      const sun = new THREE.DirectionalLight(0xfff0dd, 1.6);
      sun.position.set(1.2, 2.4, 1.6);
      this.viewScene.add(new THREE.HemisphereLight(0xdfe6ff, 0x3a2a20, 0.6), sun);
    }
    if (z && held && z.object.parent !== this.viewScene) this.viewScene.add(z.object);
    if (z && !held && z.object.parent === this.viewScene) this.scene.add(z.object);
    this.renderer.render(this.scene, this.camera);
    if (!held) return;
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.viewScene, this.camera);
    this.renderer.autoClear = true;
  }

  // The GB screen spreading over the walls from the port (or shrinking back).
  updateWave(dt) {
    const w = this.wave;
    this.maze.waveUniforms.gbTime.value = this.time;   // (the screen's grid pulses)
    if (!w.dir) return;
    // creeping out at 0.8 m/s; back quickly (from no further than the far
    // corner of the starting room, about 13.5 m from the port)
    w.r = Math.max(0, Math.min(WAVE_MAX, w.r + w.dir * (w.dir > 0 ? 0.8 : 6) * dt));
    this.maze.waveUniforms.gbRadius.value = w.r;
    if (w.r === 0) w.dir = 0;
  }

  // The TV lights the room with what's on it: the screen's average colour,
  // as bright as the picture (static when there's no signal).
  updateGlow() {
    const glow = this.world.crtGlow, u = this.world.crt.screen.material.uniforms;
    let r, g, b;
    if (u.snow.value) { r = g = b = 0.32; } else {
      const px = this.crt.pixels;
      let n = 0;
      r = g = b = 0;
      for (let i = 0; i < px.length; i += 4 * 61) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
      // to linear light
      [r, g, b] = [r, g, b].map((v) => (v / n / 255) ** 2.2);
    }
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    this.crtLum = lum;
    if (lum > 1e-4) glow.color.setRGB(r / lum, g / lum, b / lum).multiplyScalar(0.33);
    glow.intensity = 38 * lum * this.hw.crtLit;
  }

  // Effects the debug menu can switch off (number keys while it's open), to see
  // what each one costs: [name, on?, set(on)].
  fxList() {
    if (this.fx) return this.fx;
    const w = this.world, r = this.renderer, env = () => this.scene.environment;
    const recompile = () => this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    let savedEnv = null;
    const lcdP = this.lcd.persistence, crtP = this.crt.persistence;
    this.fx = [
      ['Shadows', () => r.shadowMap.enabled, (on) => { r.shadowMap.enabled = on; recompile(); }],
      ['Lamp light', () => w.lamp.visible, (on) => { w.lamp.visible = w.bounce.visible = on; }],
      ['Reflections', () => !!env(), (on) => {
        if (!on) { savedEnv = env(); this.scene.environment = null; } else this.scene.environment = savedEnv;
        w.crt.screen.material.uniforms.envAmount.value = on ? 0.1 : 0;
        this.noCrtReflections = !on;
      }],
      ['TV light', () => w.crtGlow.visible, (on) => { w.crtGlow.visible = on; }],
      ['CRT shader', () => w.crt.screen.material.uniforms.fx.value > 0.5, (on) => { w.crt.screen.material.uniforms.fx.value = on ? 1 : 0; }],
      ['LCD shader', () => w.gb.screen.material.userData.uniforms.fx.value > 0.5, (on) => { w.gb.screen.material.userData.uniforms.fx.value = on ? 1 : 0; }],
      ['Ghosting', () => this.lcd.persistence > 0, (on) => { this.lcd.persistence = on ? lcdP : 0; this.crt.persistence = on ? crtP : 0; }],
      ['Cable physics', () => !this.cablesPaused, (on) => { this.cablesPaused = !on; }],
      ['Full resolution', () => r.getPixelRatio() > 1 || window.devicePixelRatio <= 1, (on) => { r.setPixelRatio(on ? Math.min(window.devicePixelRatio, 2) : 1); }],
    ];
    return this.fx;
  }

  toggleFx(i) {
    const f = this.fxList()[i];
    if (f) f[2](!f[1]());
  }

  // The debug menu (`): what's in which console, the frame rates (the page's and
  // each emulator's), and the effect toggles.
  updateHud() {
    const now = performance.now();
    this.fpsFrames = (this.fpsFrames ?? 0) + 1;
    if (!this.fpsSince || now - this.fpsSince > 500) {
      const s = (now - this.fpsSince) / 1000, emus = { gb: this.gb, ps1: this.ps1, vb: this.vb };
      this.fps = this.fpsSince ? this.fpsFrames / s : 0;
      this.emuFps ??= {};
      this.emuFrames ??= {};
      for (const [k, e] of Object.entries(emus)) {
        const n = e?.frames ?? 0;
        this.emuFps[k] = this.fpsSince ? (n - (this.emuFrames[k] ?? n)) / s : 0;
        this.emuFrames[k] = n;
      }
      this.fpsSince = now;
      this.fpsFrames = 0;
    }
    if (document.getElementById('hud').hidden) return;
    const title = (sys) => {
      const item = sys === 'gb' ? this.items.cart : this.items.disc;
      return item && item.state === 'inserted' ? GAMES[item.game].title : '—';
    };
    const f = (k) => (this.emuFps?.[k] ?? 0).toFixed(0);
    const lines = [`GelatoBoy: ${title('gb')} · GelatoStation: ${title('ps1')}`,
      `${this.fps.toFixed(0)} fps · GelatoBoy ${f('gb')} · GelatoStation ${f('ps1')} · Virtualato ${f('vb')}`,
      `Progress ${this.progress()}/${LAST_GAME + 1} (Q back, E forward)`, ''];
    this.fxList().forEach(([name, on], i) => lines.push(`${i + 1}  ${on() ? '■' : '□'} ${name}`));
    const text = lines.join('\n');
    if (text !== this.hudText) {
      this.hudText = text;
      document.getElementById('info').textContent = text;
    }
  }
}

const app = new App();
window.__app = app;
window.__pushOut = pushOut;   // for tests
window.__mazeStats = mazeStats;
// An iPhone's home screen app started in landscape has a page shorter than the
// screen (a black bar below it) until it's turned round: there, the view and
// the title are sized to the screen itself instead (screen.width is always the
// short side on iOS).
const fitScreen = () => {
  const root = document.documentElement;
  if (!navigator.standalone) return;
  const a = Math.min(screen.width, screen.height), b = Math.max(screen.width, screen.height);
  const land = window.innerWidth > window.innerHeight;
  root.classList.add('standalone');
  root.style.setProperty('--screen-w', `${land ? b : a}px`);
  root.style.setProperty('--screen-h', `${land ? a : b}px`);
};
fitScreen();
window.addEventListener('resize', fitScreen);
window.addEventListener('orientationchange', () => setTimeout(fitScreen, 300));

// The title screen: nothing loads until it's clicked (or tapped, or a
// gamepad's A is pressed: not a key). Then it's a loading bar, and once
// everything's loaded the game comes on like a CRT.
const title = document.getElementById('title');
const stopBackground = titleBackground(title);
const begin = () => {
  if (title.classList.contains('loading')) return;
  title.classList.add('loading');
  app.audio.start();   // (sound can only start on a click or a press)
  document.body.classList.add('loading');   // (no reticle until it's running)
  const bar = title.querySelector('.bar > div');
  // (the loading starts once the hole round the bar has opened: loading holds up the page's drawing)
  stopBackground.opened().then(() => app.start((f) => { bar.style.width = `${Math.round(f * 100)}%`; })).then(() => {
    title.remove();
    stopBackground();
    const view = document.getElementById('app');
    view.classList.add('crt-on');
    view.addEventListener('animationend', () => view.classList.remove('crt-on'), { once: true });
    app.audio.sfx('crtOn', app.head());
  }).catch((err) => {
    console.error(err);
    title.remove();
    stopBackground();
    document.body.classList.remove('loading');
    document.getElementById('status').textContent = `Failed to start: ${err.message}`;
  });
};
title.addEventListener('pointerdown', begin);
const padWait = () => {
  if (title.classList.contains('loading')) return;
  if ([...(navigator.getGamepads?.() ?? [])].some((p) => p?.buttons[0]?.pressed)) begin();   // A
  else requestAnimationFrame(padWait);
};
requestAnimationFrame(padWait);
