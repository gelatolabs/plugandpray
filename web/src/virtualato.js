// The Virtualato: a Virtual Boy headset, unlocked by beating License to Chill.
// Click it to put it on (it comes up to your face, and the view fades into
// its own), right-click to take it off (the view fades back, it's pushed out
// in front of you, turns round and drops onto the floor or the desk). Worn, you see the room through it as a green wireframe (Beetle VB's green palette, not a real VB's red): a
// program (vb/vision) running in a real VB emulator draws boxes for the room,
// the desk and everything on it, and the maze behind the front wall that you
// can't see without it. It's magically wireless.
import * as THREE from 'three';
import { RemoteEmu } from './remote.js';
import { coreUrl, rom, OPTIONS } from './systems.js';
import { VBOX, MAX_BOXES } from './vblink.js';
import { CRT, GB, DESK_TOP, ROOM, STATION_W, decal } from './scene.js';
import { pushOut } from './controls.js';

// where it lands on the desk: the front right, clear of the GelatoBoy
const HOME = new THREE.Vector3(0.63, DESK_TOP, 0.0);
const home = () => HOME.clone();
const FOCAL = 194;   // 60 degrees across the VB's 224 rows, like the camera

// The headset on its stand; the origin is where the stand meets the surface.
// From the Virtualato model (assets/character.blend: the headset on
// its tripod, its origin in the middle of the headset, the eyecups towards -z):
// 0.22 m across, standing on the origin. Returns the group and how high the
// headset's middle is.
function fromModel(model) {
  const g = new THREE.Group();
  const box = new THREE.Box3().setFromObject(model), s = 0.22 / (box.max.x - box.min.x);
  model.scale.setScalar(s);
  model.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
  g.add(model);
  // its logo, small, on the left end of its front (the side away from the eyecups)
  const logo = decal('Virtualato™', 0.06, 0.012, { fg: '#16300f', font: 'bold italic 40px sans-serif' });
  logo.position.set(box.min.x * s + model.position.x + 0.04, model.position.y + 0.012, box.max.z * s + model.position.z + 0.0015);
  g.add(logo);
  return { model: g, headY: model.position.y };
}

// A box for the VB to draw, from a Box3.
const fromBox3 = (b, bright = 3, type = VBOX.BOX) => {
  const c = b.getCenter(new THREE.Vector3()), h = b.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  return { c: c.toArray(), h: h.toArray(), yaw: 0, pitch: 0, type, bright };
};

// A box following an object: its half size in its own space, rotated with it (yaw, then pitch).
const euler = new THREE.Euler();
function fromObject(object, half, bright = 3, offset = null) {
  object.updateMatrixWorld();
  const c = (offset ?? new THREE.Vector3()).clone().applyMatrix4(object.matrixWorld);
  euler.setFromQuaternion(object.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
  return { c: c.toArray(), h: half.toArray(), yaw: euler.y, pitch: euler.x, type: VBOX.BOX, bright };
}

export class Virtualato {
  constructor(app) {
    this.app = app;
    ({ model: this.model, headY: this.headY } = fromModel(app.models.virtualto_headset_base));
    this.model.visible = false;
    app.scene.add(this.model);
    this.state = 'hidden';     // hidden | free | anim | worn | gone
    this.emu = null;
    this.link = null;
    this.booting = null;
    this.acc = 0;
    this.raycaster = new THREE.Raycaster();
    this.buildOverlay();
    this.statics = this.staticBoxes();
  }

  get worn() { return this.state === 'worn'; }

  // What you see through it: the VB's left eye, filling the view, inside the
  // eyecups (in VR each eye gets its own: the right eye's is canvasR).
  buildOverlay() {
    const wrap = this.overlay = document.createElement('div');
    wrap.id = 'virtualato';
    const canvas = this.canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 224;
    wrap.appendChild(canvas);
    const shade = document.createElement('div');
    shade.className = 'cups';
    wrap.appendChild(shade);
    document.body.appendChild(wrap);
    this.ctx = canvas.getContext('2d');
    this.image = this.ctx.createImageData(384, 224);
    this.canvasR = document.createElement('canvas');
    this.canvasR.width = 384;
    this.canvasR.height = 224;
    this.ctxR = this.canvasR.getContext('2d');
    this.imageR = this.ctxR.createImageData(384, 224);
  }

  // Put on the desk's front right corner straight away (unlocked earlier).
  placeHome() { this.setDown(home(this.app), -0.5); }

  // Is it lying on the manual (which can't be opened then)?
  get onBook() {
    const m = this.model;
    return m.visible && this.state === 'free' && m.position.y > DESK_TOP + 0.0005 && this.app.book.under(m.position);
  }

  setDown(at, yaw) {
    this.model.position.copy(at);
    this.model.rotation.set(0, yaw, 0);
    this.model.visible = true;
    this.state = 'free';
  }

  // Unlocked: flies out of the TV picture onto the desk.
  spit() {
    const crt = this.app.world.crt.group;
    const from = new THREE.Vector3(CRT.screenCenter.x, CRT.screenCenter.y, CRT.screenCenter.z + 0.05).applyMatrix4(crt.matrixWorld);
    this.app.effects.burst(from, 0x40ff40, 60, 0.006, 0.4);
    this.model.visible = true;
    this.state = 'anim';
    const t0 = this.app.time;
    this.flight = (now) => {
      const f = Math.min(1, (now - t0) / 1.1), e = f * f * (3 - 2 * f);
      this.model.position.lerpVectors(from, home(this.app), e);
      this.model.position.y += Math.sin(f * Math.PI) * 0.3;
      this.model.rotation.set(0, -0.5 + (1 - e) * Math.PI * 4, 0);
      if (f >= 1) { this.flight = null; this.setDown(home(this.app), -0.5); }
    };
  }

  hits(ndc) {
    if (this.state !== 'free') return false;
    this.raycaster.setFromCamera(ndc, this.app.aim);
    return this.raycaster.intersectObject(this.model, true).length > 0;
  }

  // Where it sits when it's on your face: in front of your eyes, facing the
  // way you're looking (so its eyecups face you).
  facePose() {
    const cam = this.app.camera;
    cam.updateMatrixWorld();
    const q = cam.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    return { pos: cam.localToWorld(new THREE.Vector3(0, -this.headY, -0.09)), quat: q };
  }

  wear() {
    if (this.state !== 'free') return;
    this.state = 'anim';
    this.anim = { kind: 'wear', t: 0, p0: this.model.position.clone(), q0: this.model.quaternion.clone() };
    this.app.audio.sfx('vbOn', this.app.head());
    // a game put in it: it shows an error instead (another ROM), so swap if it's running the wrong one
    const want = this.romWanted;
    if (this.emu && this.rom !== want) { this.emu.terminate(); this.emu = this.link = null; }
    if (this.booting && this.bootingRom !== want) this.booting = null;
    if (!this.emu && !this.booting) this.boot();
  }

  // Its AR program, or (with a cartridge or disc in it) the error screen.
  get romWanted() { return this.app.items.vbItem ? 'bsod.vb' : 'vision.vb'; }

  // Taken off: out in front of you, turned round, and dropped onto whatever's below.
  remove() {
    if (!this.worn) return;
    const { pos, quat } = this.facePose();
    this.model.position.copy(pos);
    this.model.quaternion.copy(quat);
    this.model.visible = true;
    const cam = this.app.head(), { yaw } = this.app.view();
    // out in front of you, but never through a wall: as far along as the way is
    // clear (up to 0.5 m), since pushing a point that's gone past a thin wall out
    // of it would put it on the far side
    const walls = this.app.wallBlockers(), dx = -Math.sin(yaw), dz = -Math.cos(yaw);
    const near = (p) => walls.some((r) => Math.hypot(p.x - THREE.MathUtils.clamp(p.x, r.x0, r.x1), p.z - THREE.MathUtils.clamp(p.z, r.z0, r.z1)) < 0.12);
    const at = new THREE.Vector3(cam.x, 0, cam.z);
    for (let d = 0.02; d <= 0.5 + 1e-6; d += 0.02) {
      const p = new THREE.Vector3(cam.x + dx * d, 0, cam.z + dz * d);
      if (near(p)) break;
      at.copy(p);
    }
    pushOut(at, walls, 0.12);
    const onDesk = Math.abs(at.x) < 0.78 && at.z > ROOM.minZ && at.z < 0.18;
    const out = new THREE.Vector3(at.x, cam.y - this.headY - 0.09, at.z);
    this.app.audio.sfx('vbOff', this.app.head());
    this.state = 'anim';
    // (onto the manual, if that's where it comes down)
    const ground = !onDesk ? 0 : this.app.book.under(at) ? this.app.book.top : DESK_TOP;
    this.anim = { kind: 'remove', t: 0, p0: pos.clone(), q0: quat.clone(), out, ground, yaw, vy: 0 };
  }

  // The view through it: 0 (the room) to 1 (all Virtualato).
  setFade(f) {
    this.fade = f;
    this.overlay.style.opacity = f;
    this.overlay.classList.toggle('on', f > 0);
  }

  animate(dt) {
    const a = this.anim, m = this.model;
    a.t += dt;
    const ease = (x) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
    if (a.kind === 'wear') {
      // up to your face, turning to face you; the view fades in as it gets close
      const f = ease(a.t / 0.7);
      const { pos, quat } = this.facePose();
      m.position.lerpVectors(a.p0, pos, f);
      m.quaternion.slerpQuaternions(a.q0, quat, f);
      this.setFade(ease((a.t - 0.45) / 0.45));
      if (a.t >= 0.9) {
        this.anim = null;
        this.state = 'worn';
        m.visible = false;
        this.setFade(1);
      }
      return;
    }
    // remove: the view fades back while it moves out in front of you...
    this.setFade(1 - ease(a.t / 0.35));
    const up = new THREE.Vector3(0, 1, 0);
    const facing = new THREE.Quaternion().setFromAxisAngle(up, a.yaw + Math.PI);   // level, pointing away
    if (a.t < 0.45) {
      const f = ease(a.t / 0.45);
      m.position.lerpVectors(a.p0, a.out, f);
      m.quaternion.slerpQuaternions(a.q0, facing, f);
      return;
    }
    // ... turns round to face you ...
    if (a.t < 0.8) {
      const f = ease((a.t - 0.45) / 0.35);
      m.position.copy(a.out);
      m.quaternion.setFromAxisAngle(up, a.yaw + Math.PI + Math.PI * f);
      return;
    }
    // ... and drops
    a.vy -= 9.8 * dt;
    m.position.y = Math.max(a.ground, m.position.y + a.vy * dt);
    m.quaternion.setFromAxisAngle(up, a.yaw);
    if (m.position.y <= a.ground) {
      this.anim = null;
      this.setDown(m.position.clone(), a.yaw);
    }
  }

  // Gone (the GB has escaped reality); back() puts it in front of you again.
  vanish() {
    if (this.state === 'hidden') return;
    this.wasWorn = this.worn || this.anim?.kind === 'wear';
    this.anim = null;
    this.setFade(0);
    this.model.visible = false;
    this.state = 'gone';
  }

  back() {
    if (this.state !== 'gone') return;
    if (this.wasWorn) { this.state = 'worn'; this.remove(); } else { this.model.visible = true; this.state = 'free'; }
  }

  async boot() {
    const token = (this.booting = {}), name = (this.bootingRom = this.romWanted);
    const bytes = await rom(name);
    // (on its own thread, like the other consoles: see remote.js)
    const emu = await RemoteEmu.create({ core: coreUrl('vb'), romName: name, romBytes: bytes, options: OPTIONS.vb, link: 'vb', audio: false });
    if (this.booting !== token) { emu.terminate(); return; }
    this.emu = emu;
    this.rom = name;
    this.link = emu.link;
    this.booting = null;
  }

  // The link cable as lines: plugged in at both ends, one between its sockets; in
  // the GelatoBoy only, straight down from it to the floor; otherwise from plug to plug.
  cableLines() {
    const ends = this.app.cables.ends, gb = ends['link-gb'], ps = ends['link-ps'];
    if (!gb || !ps) return [];
    const at = (e) => (e.socket ? e.socket.world() : e.plug.getWorldPosition(new THREE.Vector3()));
    const line = (a, b) => ({ c: a.toArray(), h: b.clone().sub(a).toArray(), yaw: 0, pitch: 0, type: VBOX.LINE, bright: 2 });
    const a = at(gb);
    if (gb.socket && !ps.socket) return [line(a, a.clone().setY(0))];
    return [line(a, at(ps))];
  }

  // Boxes that never move.
  staticBoxes() {
    const w = this.app.world, b = [];
    const { minX, maxX, minZ, maxZ, height } = ROOM;
    b.push({ ...fromBox3(new THREE.Box3(new THREE.Vector3(minX, 0, minZ), new THREE.Vector3(maxX, height, maxZ)), 1), always: true });
    b.push(fromBox3(new THREE.Box3().setFromObject(w.desk.mesh), 2));
    for (const leg of w.desk.legs) b.push(fromBox3(leg, 1));
    b.push(fromObject(w.crt.group, CRT.half, 3));
    b.push(fromBox3(new THREE.Box3().setFromObject(w.stand.group), 2));
    return b;
  }

  // Everything to draw this frame, nearest first, the ones out of view left out.
  boxes() {
    const app = this.app, w = app.world;
    const list = [...this.statics];
    list.push(fromObject(w.station.group, new THREE.Vector3(STATION_W / 2, 0.021, STATION_W * 0.36), 3));
    // the GelatoBoy: its outline, rounded at the bottom
    list.push({ ...fromObject(w.gb.group, GB.half, 3), type: VBOX.ROUND });
    // the posters on the back wall, as flat rectangles
    for (const p of [w.room.controlsMesh, w.room.fighterPoster]) if (p.visible) list.push(fromBox3(new THREE.Box3().setFromObject(p), 2, VBOX.WALL));
    // the link cable: a line from plug to plug (or straight down from the GelatoBoy, the other end loose)
    list.push(...this.cableLines());
    list.push(fromBox3(new THREE.Box3().setFromObject(app.book.group), 2));
    for (const it of app.items.items) {
      if (it.state === 'inserted' || it.state === 'holding' || !it.object.visible) continue;
      // (a disc: a flat ring, across its own x and y)
      if (it.kind === 'disc') list.push({ ...fromObject(it.object, it.half, 1), type: VBOX.RING, h: [it.half.x, it.half.x, 0] });
      else list.push(fromObject(it.object, it.half, 1));
    }
    for (const m of app.maze.wire) {
      if (m.type === 'wall') list.push(fromBox3(m.box, 2, VBOX.WALL));
      else if (m.type === 'door') list.push(fromBox3(m.box, 3, VBOX.WALL));   // doorways stand out
      else if (m.type === 'room') list.push({ ...fromBox3(m.box, 1), always: true });
      else list.push(fromObject(m.object, new THREE.Vector3(0.06, 0.04, 0.01), 3));
    }
    // cull what's behind or well outside the view
    const cam = app.camera;
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse, v = new THREE.Vector3();
    const half = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.9;
    const keep = [];
    for (const b of list) {
      const r = Math.hypot(...b.h);
      v.fromArray(b.c).applyMatrix4(inv);
      const depth = -v.z;
      if (!b.always && (depth < -r || Math.abs(v.x) > (depth + r) * half * 1.4 + r || Math.abs(v.y) > (depth + r) * half + r)) continue;
      keep.push({ b, d: b.always ? -1 : Math.max(0, v.length() - r) });
    }
    keep.sort((p, q) => p.d - q.d);
    // walls fade with distance, so the near ones (and doorways) read clearly
    return keep.slice(0, MAX_BOXES).map(({ b, d }) => {
      if (b.type !== VBOX.WALL) return b;
      const level = d < 1.4 ? 3 : d < 2.8 ? 2 : 1;
      return { ...b, bright: Math.min(b.bright === 3 ? 3 : level, level + (b.bright === 3 ? 1 : 0)) };
    });
  }

  update(dt) {
    this.flight?.(this.app.time);
    if (this.anim) this.animate(dt);
    if (!(this.worn || this.anim?.kind === 'wear') || !this.emu) return;
    // what it ran since last time (on its own thread), then the view for the frames due now
    const emu = this.emu, done = emu.take();
    if (done) this.show(done);
    const cam = this.app.head(), view = this.app.view();
    if (this.rom === 'vision.vb') this.link.write({ x: cam.x, y: cam.y, z: cam.z, yaw: view.yaw, pitch: view.pitch }, FOCAL, this.boxes());
    this.acc = Math.min(this.acc + dt, 3 / emu.fps);
    const n = Math.floor(this.acc * emu.fps + 1e-6);
    if (n > 0 && emu.run(n)) this.acc -= n / emu.fps;
  }

  // Draws a picture from the emulator: the eyes side by side, left then right
  // (the right eye only matters in VR).
  show(done) {
    this.frames = (this.frames ?? 0) + done.n;   // (for the debug menu's frame rates)
    const src = done.frame, w = done.width;
    const eye = (image, ctx, x0) => {
      const out = image.data;
      for (let y = 0; y < 224; y++) out.set(src.subarray((y * w + x0) * 4, (y * w + x0 + 384) * 4), y * 384 * 4);
      for (let i = 3; i < out.length; i += 4) out[i] = 255;
      ctx.putImageData(image, 0, 0);
    };
    eye(this.image, this.ctx, 0);
    if (this.app.xr?.presenting) eye(this.imageR, this.ctxR, w >= 768 ? 384 : 0);
    this.emu.recycle(src);
  }
}
