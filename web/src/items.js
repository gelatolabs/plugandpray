// Cartridges, discs and the zapper: things that can be picked up, dropped,
// inserted into the consoles, and that pop out of the CRT when unlocked.
// Cartridges and discs live on the display stand when they're not in a
// console: unlocked, ejected or let go of anywhere else, they go back there.
// The zapper's home is the holster on the side of the stand, and the credits
// disc's is the desk beside the GelatoStation.
import * as THREE from 'three';
import { Dragger } from './drag.js';
import { GB, CRT, DESK_TOP, decal, blacken } from './scene.js';
import { GAMES, CREDITS, WIN } from './games.js';

const GRAVITY = 3.5;
const CART_HALF = new THREE.Vector3(0.0285, 0.0325, 0.004);
const DISC_HALF = new THREE.Vector3(0.06, 0.06, 0.0015);
const ZAPPER_HALF = new THREE.Vector3(0.02, 0.05, 0.09);
const FLAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const LID_OPEN = 1.3;    // rad the GelatoStation's lid opens
const DISC_SPIN = 14;    // rad/s a disc spins in a GelatoStation that's on
// cartridge seated in the slot in the GB's back (GB local space), label facing backwards
const CART_SEATED = { pos: new THREE.Vector3(0, GB.half.y - 0.012, -GB.half.z + 0.0046), rot: new THREE.Euler(0, Math.PI, 0) };

// The Gelato Labs logo, for the labels (drawn once it has loaded).
export const LOGO = new Image();
LOGO.src = './img/gelato.png';

// Draws the logo `width` wide centred on (cx, cy), in one colour.
export function drawLogo(g, color, cx, cy, width) {
  const h = (width * LOGO.naturalHeight) / LOGO.naturalWidth;
  const c = document.createElement('canvas');
  c.width = Math.ceil(width);
  c.height = Math.ceil(h);
  const t = c.getContext('2d');
  t.drawImage(LOGO, 0, 0, width, h);
  t.globalCompositeOperation = 'source-in';
  t.fillStyle = color;
  t.fillRect(0, 0, c.width, c.height);
  g.drawImage(c, cx - width / 2, cy - h / 2);
}

// The team's label art, by file name (loaded once, shared).
const ART = {};
function art(name) {
  if (!ART[name]) { ART[name] = new Image(); ART[name].src = `./img/labels/${name}.webp`; }
  return ART[name];
}

function labelTexture(game, w, h, round = false) {
  const info = GAMES[game];
  const file = info.art?.[round ? 'disc' : 'cart'];
  if (file) {
    // their picture, stretched over the label (a disc's is the whole round face, hole and all)
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    const img = art(file), draw = () => { c.getContext('2d').drawImage(img, 0, 0, w, h); t.needsUpdate = true; };
    if (img.complete && img.naturalWidth) draw(); else img.addEventListener('load', draw, { once: true });
    return t;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (round) {
    const grad = g.createRadialGradient(w / 2, h / 2, w * 0.1, w / 2, h / 2, w / 2);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, info.color);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#d8d8e0';
    g.beginPath();
    g.arc(w / 2, h / 2, w * 0.13, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#222';
    g.beginPath();
    g.arc(w / 2, h / 2, w * 0.06, 0, Math.PI * 2);
    g.fill();
  } else {
    g.fillStyle = info.color;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff8e8';
    g.fillRect(8, 8, w - 16, h * 0.55);
  }
  g.fillStyle = round ? '#1a1a2a' : '#1a1a2a';
  g.textAlign = 'center';
  // the title wrapped into the label's area, as big as it'll go
  const box = round ? { y: h * 0.17, w: w * 0.62, h: h * 0.2 } : { y: h * 0.07, w: w - 32, h: h * 0.5 };
  let size = h * (round ? 0.075 : 0.16), lines;
  for (;; size *= 0.92) {
    g.font = `bold ${Math.round(size)}px sans-serif`;
    lines = [];
    for (const word of info.title.split(' ')) {
      const line = lines.length ? `${lines[lines.length - 1]} ${word}` : word;
      if (lines.length && g.measureText(line).width <= box.w) lines[lines.length - 1] = line; else lines.push(word);
    }
    if ((lines.length * size * 1.08 <= box.h && lines.every((l) => g.measureText(l).width <= box.w)) || size < 6) break;
  }
  g.textBaseline = 'top';
  lines.forEach((line, i) => g.fillText(line, w / 2, box.y + i * size * 1.08 + (box.h - lines.length * size * 1.08) / 2));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  // and the Gelato Labs logo below it: dark on a disc, cream on a cartridge's colour
  const logo = () => {
    drawLogo(g, round ? '#1a1a2a' : '#fff8e8', w / 2, round ? h * 0.8 : h * 0.8, round ? w * 0.36 : w * 0.7);
    t.needsUpdate = true;
  };
  if (LOGO.complete && LOGO.naturalWidth) logo(); else LOGO.addEventListener('load', logo, { once: true });
  return t;
}

// The biggest flat part of a mesh facing the front (+z): its box.
function frontFace(geometry) {
  const pos = geometry.attributes.position, idx = geometry.index, levels = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  const tris = idx ? idx.count / 3 : pos.count / 3;
  for (let i = 0; i < tris; i++) {
    const [ia, ib, ic] = [0, 1, 2].map((k) => (idx ? idx.getX(i * 3 + k) : i * 3 + k));
    a.fromBufferAttribute(pos, ia); b.fromBufferAttribute(pos, ib); c.fromBufferAttribute(pos, ic);
    n.subVectors(c, b).cross(e.subVectors(a, b));
    if (n.length() === 0 || n.z < 0.9 * n.length()) continue;
    const z = Math.round(a.z * 1e4), level = levels.get(z) ?? { area: 0, box: new THREE.Box3() };
    level.area += n.length() / 2;
    level.box.expandByPoint(a).expandByPoint(b).expandByPoint(c);
    levels.set(z, level);
  }
  return [...levels.values()].sort((p, q) => q.area - p.area)[0]?.box ?? null;
}

// A cartridge: the team's model (assets/export_cartridge.py), the game's label
// on its "Label" faces and the GelatoBoy logo printed on its "Logo plate".
function makeCart(game, model) {
  const g = model.clone();
  g.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material.name === 'Label') {
      // drawn the shape of the label's face, 512 across
      const face = frontFace(o.geometry), size = face ? face.getSize(new THREE.Vector3()) : new THREE.Vector3(256, 212, 0);
      const map = labelTexture(game, 512, Math.round(512 * size.y / size.x));
      map.flipY = false;   // (glTF's UVs run from the top)
      o.material = o.material.clone();
      o.material.map = map;
      o.material.color.set(0xffffff);
    } else if (o.material.name === 'Logo plate') {
      // the logo on the plate's face (the rest of what's shiny is the arrow)
      const plate = frontFace(o.geometry);
      if (!plate) return;
      const size = plate.getSize(new THREE.Vector3()), mid = plate.getCenter(new THREE.Vector3());
      const w = Math.min(size.x * 0.85, size.y * 0.8 * 6.25);
      const logo = decal('GelatoBoy™', w, w / 6.25, { fg: '#111', font: 'bold italic 40px sans-serif' });
      logo.position.set(mid.x, mid.y, plate.max.z + 0.0002);
      o.parent.add(logo);
    }
  });
  return g;
}

// A disc: the disc model (its shiny underside and rim), with the game's label
// on top. Its face (+z) is the label side, the text's up
// is +y, and it's centred on its thickness.
function makeDisc(game, model) {
  const g = new THREE.Group();
  const label = new THREE.MeshStandardMaterial({ map: labelTexture(game, 512, 512, true), roughness: 0.4, transparent: true });
  const m = model.clone();
  const box = new THREE.Box3().setFromObject(m), r = (box.max.x - box.min.x) / 2;
  // the model lies flat (its top up, +y): stood on its edge, top towards +z
  m.rotation.x = Math.PI / 2;
  m.position.z = -(box.min.y + box.max.y) / 2;
  g.add(m);
  // the label over its top: a whole circle (its texture paints the hub and the hole), so the
  // disc can be clicked anywhere, even dead centre where the model has a real hole
  const top = new THREE.Mesh(new THREE.CircleGeometry(r * 0.97, 64), label);
  top.position.z = (box.max.y - box.min.y) / 2 + 0.0002;
  g.add(top);
  return g;
}

// The zapper: the team's textured model (assets/import_fbx.py). Its muzzle
// glows when it fires (App.updateZap: userData.tip).
function makeZapper(model) {
  const g = model.clone();
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    // the muzzle: black (the texture's relief kept), and its own, as it glows when it fires
    if (o.name === 'Muzzle') {
      o.material = blacken(o.material, 0x18181c);
      g.userData.tip = o;
    }
  });
  const logo = decal('GelatoBlaster™', 0.09, 0.009, { fg: '#111', font: 'bold italic 40px sans-serif' });
  logo.rotation.y = Math.PI / 2;
  logo.position.set(0.0132, 0.029, 0.03);
  g.add(logo);
  return g;
}

class Item {
  constructor(kind, game, object, half) {
    this.kind = kind;
    this.game = game;
    this.object = object;
    this.half = half;
    this.state = 'free';
    this.vel = new THREE.Vector3();
    this.settled = false;
  }
}

export class Items {
  constructor({ scene, camera, aim, world, colliders, effects, onInsert, onSound = () => {} }) {
    this.onSound = onSound;
    this.scene = scene;
    this.camera = camera;
    this.aim = aim ?? camera;   // what points at things: the camera, or a VR controller
    this.xr = false;
    this.world = world;
    this.colliders = colliders;
    this.effects = effects;
    this.onInsert = onInsert;
    this.items = [];
    this.tweens = [];
    this.homes = {};    // game -> () => {pos, quat}: homes away from the display stand
    this.cart = null;   // item seated in the GB
    this.disc = null;   // item in the GelatoStation
    this.vbItem = null; // a cartridge or disc put in the Virtualato (it doesn't play them)
    this.vbModel = () => null;   // the Virtualato, when it can take one (lying free): set by the app
    this.zapper = null;
    this.held = null;   // item being dragged
    this.dragger = null;
    this.raycaster = new THREE.Raycaster();
  }

  add(kind, game) {
    const object = kind === 'cart' ? makeCart(game, this.world.models.cartridge) : kind === 'disc' ? makeDisc(game, this.world.models.gelatostation_disc) : makeZapper(this.world.models.zapper);
    object.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const half = kind === 'cart' ? CART_HALF : kind === 'disc' ? DISC_HALF : ZAPPER_HALF;
    const item = new Item(kind, game, object, half);
    this.scene.add(object);
    this.items.push(item);
    if (kind === 'zapper') this.zapper = item;
    return item;
  }

  // Where an item lives when it's not in use: {pos, quat}.
  home(item) {
    if (item.kind === 'zapper') return this.world.stand.holster();
    if (this.homes[item.game]) return this.homes[item.game]();   // e.g. the YOU WIN! cartridge's tray
    if (item.game === CREDITS) {
      return { pos: new THREE.Vector3(0.6, DESK_TOP + DISC_HALF.z, -0.29),
        quat: FLAT.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5)) };
    }
    return this.world.stand.slot(item.kind, item.game, item.half);
  }

  // Puts an item back home: flying there in an arc (spinning a few times if
  // `spin`), or straight away.
  // (stow, if set, gets the first go at an item flying home: it can take it
  // somewhere else first, and returns true if it has)
  dock(item, animate = true, spin = 0) {
    if (animate && this.stow?.(item)) return;
    const { pos, quat } = this.home(item);
    const done = () => {
      item.object.position.copy(pos);
      item.object.quaternion.copy(quat);
      item.state = 'free';
      item.settled = true;
      item.vel.set(0, 0, 0);
    };
    if (!animate) { done(); return; }
    this.fly(item, pos, quat, spin, done);
  }

  // An item flying to pos / quat in an arc (spinning a few times if `spin`); done() when it's there.
  fly(item, pos, quat, spin, done, lift = 0.12 + item.object.position.distanceTo(pos) * 0.3) {
    item.state = 'anim';
    const startP = item.object.position.clone(), startQ = item.object.quaternion.clone();
    const twirl = new THREE.Quaternion();
    this.tween(0.55 + spin * 0.1, (f) => {
      const e = f * f * (3 - 2 * f);
      item.object.position.lerpVectors(startP, pos, e);
      item.object.position.y += Math.sin(f * Math.PI) * lift;
      item.object.quaternion.slerpQuaternions(startQ, quat, e);
      if (spin) item.object.quaternion.multiply(twirl.setFromEuler(new THREE.Euler(0, (1 - e) * Math.PI * 2 * spin, 0)));
    }, done);
  }

  // Seats media at once (at the start, and once insertCart / insertDisc have animated it in).
  seatCart(item) {
    this.world.gb.group.add(item.object);
    item.object.position.copy(CART_SEATED.pos);
    item.object.rotation.copy(CART_SEATED.rot);
    item.state = 'inserted';
    this.cart = item;
  }

  seatDisc(item) {
    this.world.station.group.add(item.object);
    item.object.position.copy(this.world.station.discSpot);
    item.object.quaternion.copy(FLAT);
    item.state = 'inserted';
    this.disc = item;
  }

  // Free item under the pointer, if any.
  pick(ndc) {
    this.raycaster.setFromCamera(ndc, this.aim);
    let best = null, bestD = Infinity;
    for (const it of this.items) {
      // (the disc in the GelatoStation too, while its lid is open)
      const out = (it === this.disc && it.state === 'inserted' && this.lidOpen && !this.inserting)
        || (it === this.vbItem && it.state === 'inserted' && this.vbModel());
      if ((it.state !== 'free' && !out) || !it.object.visible) continue;   // (not one put away out of sight)
      const hit = this.raycaster.intersectObject(it.object, true)[0];
      if (hit && hit.distance < bestD) { best = it; bestD = hit.distance; }
    }
    return best;
  }

  startDrag(item, ndc) {
    if (item.kind === 'zapper') { this.hold(item); return; }
    if (item.state === 'inserted') this.takeOut(item);
    item.state = 'held';
    this.held = item;
    this.dragger = new Dragger(item.object, this.camera, this.colliders, item.half, 0.38, this.aim);
    if (item.kind === 'disc') this.dragger.spin(1);   // a disc twirls round once as you lift it
    this.dragger.start(ndc);
  }

  wheel(d) { this.dragger?.wheel(d); }

  // Carrying a cartridge or disc: a click (startDrag) picks it up and it stays
  // in your hand; a click with it where it looks like it's over its console
  // (however far in front of it) puts it in (insertHeld), and a right-click
  // sends it home (drop).
  insertHeld() {
    const it = this.held;
    if (!it || !this.dropTarget(it)) return false;
    this.endDrag();
    return true;
  }

  drop() {
    const it = this.held;
    if (!it) return;
    this.held = null;
    this.dragger = null;
    it.state = 'free';
    it.vel.set(0, 0, 0);
    this.dock(it);   // back to where it lives
  }

  // Lets go of what's in hand: into its console if it's over it, else home.
  endDrag() {
    if (!this.held) return;
    const it = this.held;
    const target = this.dropTarget(it);
    this.held = null;
    this.dragger = null;
    if (it.state === 'held') { it.state = 'free'; it.settled = false; it.vel.set(0, 0, 0); }
    if (target === 'gb') this.insertCart(it);
    else if (target === 'ps1') this.insertDisc(it);
    else if (target === 'vb') this.insertVb(it);
    else this.dock(it);
  }

  // Which console the pointer is over (or just about) while dragging `it`, if it
  // fits: its own, or the Virtualato (anything fits in that; nothing plays).
  dropTarget(it) {
    if (!this.ndc || (it.kind !== 'cart' && it.kind !== 'disc')) return null;
    this.raycaster.setFromCamera(this.ndc, this.aim);
    const over = (o, pad) => this.raycaster.ray.intersectsBox(new THREE.Box3().setFromObject(o).expandByScalar(pad));
    if (over(it.kind === 'cart' ? this.world.gb.group : this.world.station.group, 0.03)) return it.kind === 'cart' ? 'gb' : 'ps1';
    const vb = this.vbModel();
    return vb && over(vb, 0.02) ? 'vb' : null;
  }

  // Where media sits in the Virtualato (in its own space: its origin's at the
  // middle of its bottom): a cartridge or a disc standing in a slot in its top,
  // part way in.
  vbSeat(item) {
    const vb = this.vbModel() ?? item.object.parent;
    vb.updateMatrixWorld();
    const box = new THREE.Box3().setFromObject(vb).applyMatrix4(vb.matrixWorld.clone().invert());
    const top = box.max.y, z = (box.min.z + box.max.z) / 2;
    return item.kind === 'cart'
      ? { pos: new THREE.Vector3(0, top + item.half.y * 0.2, z), quat: new THREE.Quaternion() }
      : { pos: new THREE.Vector3(0, top, z), quat: new THREE.Quaternion() };   // (standing in a slot, its middle at the top: half in)
  }

  // Putting a cartridge or disc in the Virtualato: any already in it comes out.
  insertVb(item) {
    const vb = this.vbModel();
    if (!vb) { this.dock(item); return; }
    this.endDrag();
    item.state = 'anim';
    const old = this.vbItem;
    this.vbItem = item;
    if (old && old !== item) this.eject(old, 'vb');
    const seat = this.vbSeat(item), startP = item.object.position.clone(), startQ = item.object.quaternion.clone();
    const world = () => ({ p: seat.pos.clone().applyMatrix4(vb.matrixWorld), q: vb.getWorldQuaternion(new THREE.Quaternion()).multiply(seat.quat) });
    this.tween(0.35, (f) => {
      const w = world();
      item.object.position.lerpVectors(startP, w.p.clone().add(new THREE.Vector3(0, 0.04 * (1 - f), 0)), f);
      item.object.quaternion.slerpQuaternions(startQ, w.q, f);
    }, () => {
      vb.add(item.object);
      item.object.position.copy(seat.pos);
      item.object.quaternion.copy(seat.quat);
      item.state = 'inserted';
      this.onSound(item.kind === 'cart' ? 'cartIn' : 'discIn', world().p);
    });
  }

  // --- media slots ------------------------------------------------------------

  cartSlotWorld() {
    return new THREE.Vector3(0, GB.half.y + 0.02, -GB.half.z).applyMatrix4(this.world.gb.group.matrixWorld);
  }

  discSlotWorld() {
    return this.world.station.discSpot.clone().add(new THREE.Vector3(0, 0.03, 0))
      .applyMatrix4(this.world.station.group.matrixWorld);
  }

  eject(item, from) {
    const p = item.object.getWorldPosition(new THREE.Vector3());
    this.onSound(item.kind === 'cart' ? 'cartOut' : 'discOut', p);
    const q = item.object.getWorldQuaternion(new THREE.Quaternion());
    this.scene.add(item.object);
    item.object.position.copy(p);
    item.object.quaternion.copy(q);
    this.effects.burst(p, from === 'gb' ? 0x9bbc0f : 0xc8c8ff, 20, 0.003, 0.15);
    this.dock(item, true, 1);
  }

  insertCart(item) {
    this.tween(0.45, () => {}, () => this.onSound('cartIn', this.cartSlotWorld()));
    this.endDrag();
    item.state = 'anim';
    const old = this.cart;
    this.cart = item;
    if (old) this.eject(old, 'gb');
    this.onInsert('gb', null);
    const gb = this.world.gb.group;
    const startP = item.object.position.clone(), startQ = item.object.quaternion.clone();
    const seatedQ = () => gb.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromEuler(CART_SEATED.rot));
    const above = () => CART_SEATED.pos.clone().add(new THREE.Vector3(0, 0.05, 0)).applyMatrix4(gb.matrixWorld);
    const seated = () => CART_SEATED.pos.clone().applyMatrix4(gb.matrixWorld);
    this.tween(0.25, (f) => {
      item.object.position.lerpVectors(startP, above(), f);
      item.object.quaternion.slerpQuaternions(startQ, seatedQ(), f);
    }, () => this.tween(0.2, (f) => {
      item.object.position.lerpVectors(above(), seated(), f * f);
      item.object.quaternion.copy(seatedQ());
    }, () => {
      this.seatCart(item);
      this.effects.burst(this.cartSlotWorld(), 0x9bbc0f, 16, 0.003, 0.1);
      this.onInsert('gb', item.game);
    }));
  }

  // Putting a disc in the GelatoStation: the lid opens if it's shut (and stays
  // open), any disc that's in it pops out, and this one goes down onto the spindle.
  insertDisc(item) {
    this.onSound('discIn', this.discSlotWorld());
    this.endDrag();
    item.state = 'anim';
    this.inserting = true;
    const old = this.disc;
    this.disc = item;
    this.onInsert('ps1', null);
    const st = this.world.station;
    const startP = item.object.position.clone(), startQ = item.object.quaternion.clone();
    const spot = () => st.discSpot.clone().applyMatrix4(st.group.matrixWorld);
    const above = () => spot().add(new THREE.Vector3(0, 0.06, 0));
    this.setLid(true, () => {
      if (old && old !== item) this.eject(old, 'ps1');
      this.tween(0.3, (f) => {
        item.object.position.lerpVectors(startP, above(), f);
        item.object.quaternion.slerpQuaternions(startQ, FLAT, f);
      }, () => this.tween(0.2, (f) => {
        item.object.position.lerpVectors(above(), spot(), f);
      }, () => {
        this.seatDisc(item);
        this.inserting = false;
        this.onInsert('ps1', item.game);
      }));
    });
  }

  // The lid: the eject button opens and shuts it. done runs once it has got there.
  toggleLid() {
    if (!this.inserting) this.setLid(!this.lidOpen);
  }

  setLid(open, done) {
    const lid = this.world.station.lid, from = lid.rotation.x, to = open ? -LID_OPEN : 0;
    if (open !== this.lidOpen) this.onSound(open ? 'lidOpen' : 'lidClose', this.discSlotWorld());
    this.lidOpen = open;
    const token = this.lidToken = (this.lidToken ?? 0) + 1;   // a newer move takes over from this one
    this.tween(0.25 * Math.abs(to - from) / LID_OPEN, (f) => {
      if (this.lidToken === token) lid.rotation.x = from + (to - from) * f;
    }, () => { if (this.lidToken === token) done?.(); });
  }

  // Taking the disc out of the GelatoStation (with its lid open), or a cartridge or disc out of the Virtualato.
  takeOut(item) {
    const p = item.object.getWorldPosition(new THREE.Vector3()), q = item.object.getWorldQuaternion(new THREE.Quaternion());
    this.scene.add(item.object);
    item.object.position.copy(p);
    item.object.quaternion.copy(q);
    if (item === this.vbItem) {   // (out of the Virtualato)
      this.vbItem = null;
      this.onSound(item.kind === 'cart' ? 'cartOut' : 'discOut', p);
      return;
    }
    this.disc = null;
    this.onSound('discOut', p);
    this.onInsert('ps1', null);
  }

  // A disc in the GelatoStation spins while it's on (you can see it with the lid open).
  spinDisc(dt, on) {
    const d = this.disc, spinning = d?.state === 'inserted';
    this.discSpeed = THREE.MathUtils.damp(this.discSpeed ?? 0, on && spinning ? DISC_SPIN : 0, 1.5, dt);
    if (spinning && this.discSpeed > 0.01) d.object.rotateZ(-this.discSpeed * dt);   // clockwise, seen from the label
  }

  // --- unlock: new things fly out of the CRT --------------------------------

  spit(items) {
    const crt = this.world.crt.group;
    crt.updateMatrixWorld();
    const from = new THREE.Vector3(CRT.screenCenter.x, CRT.screenCenter.y, CRT.screenCenter.z + 0.02).applyMatrix4(crt.matrixWorld);
    this.effects.burst(from, 0xffffff, 60, 0.006, 0.4);
    items.forEach((item, i) => {
      item.state = 'anim';
      item.object.position.copy(from);
      item.object.quaternion.identity();
      item.object.visible = false;
      this.tween(i * 0.25, () => {}, () => {
        item.object.visible = true;
        this.dock(item, true, 2);
      });
    });
  }

  // --- zapper -----------------------------------------------------------------

  hold(item) {
    item.state = 'holding';
    // it flies up into your hand, the way it flies home when it's put away (see fly)
    item.pickup = { t: 0, p0: item.object.position.clone(), q0: item.object.quaternion.clone() };
  }

  get holdingZapper() { return this.zapper?.state === 'holding'; }

  // Back in its holster.
  dropZapper() {
    if (!this.holdingZapper) return;
    this.dock(this.zapper);
  }

  // Ray from the camera through the pointer (for aiming).
  aimRay(ndc) {
    this.raycaster.setFromCamera(ndc, this.aim);
    return this.raycaster.ray;
  }

  recoil() { this.recoilT = 1; }

  // --- per frame --------------------------------------------------------------

  tween(duration, update, done) {
    this.tweens.push({ t: 0, duration, update, done });
  }

  update(dt, ndc) {
    const running = this.tweens;
    this.tweens = [];
    for (const tw of running) {
      tw.t += dt;
      const f = Math.min(1, tw.t / Math.max(tw.duration, 1e-6));
      tw.update(f);
      if (f >= 1) tw.done?.(); else this.tweens.push(tw);
    }

    this.ndc = ndc?.clone();
    if (this.dragger) this.dragger.update(dt);

    for (const it of this.items) {
      if (it.state === 'free' && !it.settled) this.fall(it, dt);
      if (it.state === 'holding') {
        const offset = new THREE.Vector3(0.15, -0.13, -0.38);
        this.recoilT = Math.max(0, (this.recoilT ?? 0) - dt * 6);
        offset.z += this.recoilT * 0.03;
        // in your hand: by the camera, or in a VR controller
        if (this.xr) it.object.position.copy(new THREE.Vector3(0, -0.03, 0.03).applyMatrix4(this.aim.matrixWorld));
        else it.object.position.copy(this.camera.localToWorld(offset));
        const ray = this.aimRay(ndc);
        it.object.lookAt(ray.origin.clone().addScaledVector(ray.direction, 2));
        it.object.rotateX(-this.recoilT * 0.3);
        // still on its way up from where it was picked up: an arc, as in fly()
        const pk = it.pickup;
        if (pk && pk.t < 1) {
          pk.t = Math.min(1, pk.t + dt / 0.55);
          const e = pk.t * pk.t * (3 - 2 * pk.t), lift = 0.12 + pk.p0.distanceTo(it.object.position) * 0.3;
          it.object.position.lerpVectors(pk.p0, it.object.position.clone(), e);
          it.object.position.y += Math.sin(pk.t * Math.PI) * lift;
          it.object.quaternion.slerpQuaternions(pk.q0, it.object.quaternion.clone(), e);
        }
      }
    }
  }

  // Simple drop: turn flat, fall, stop on whatever is below.
  fall(it, dt) {
    const want = it.kind === 'zapper' ? it.object.quaternion : FLAT;
    it.object.quaternion.rotateTowards(want, dt * 6);
    it.vel.y -= GRAVITY * dt;
    it.probe ??= new Dragger(it.object, this.camera, this.colliders, it.half);
    const probe = it.probe;
    const steps = Math.max(1, Math.ceil(it.vel.length() * dt / 0.004));
    for (let i = 0; i < steps; i++) {
      it.object.position.addScaledVector(it.vel, dt / steps);
      const push = probe.resolve();
      if (push.y > 1e-6) {
        it.vel.set(0, 0, 0);
        if (it.object.quaternion.angleTo(want) < 0.01) it.settled = true;
        break;
      }
      if (push.lengthSq() > 0) { it.vel.x = 0; it.vel.z = 0; }
    }
  }
}
