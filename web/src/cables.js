// Cables: the GelatoBoy's link cable to the GelatoStation, the GelatoStation's
// AV cable to the CRT, and both power cords down to the wall outlet.
//
// Each cable is a chain of particles ~1.5 cm apart, simulated with Verlet
// integration: gravity, fixed segment lengths, a little bending stiffness,
// and friction where it rests on something. Particles collide with the desk,
// the devices (including the GB wherever it's being held), the walls and the
// floor. Both ends are held by plugs, and the first segment leaves each plug
// straight, like a strain relief. Cables are drawn as tubes rebuilt from the
// particles every frame.
//
// Plugs can be pulled out (clicking one) and then dangle on the end of their
// cable; clicking a loose plug picks it up, and clicking a free socket of the
// right kind that the cable reaches pushes it in.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { OBB } from './collision.js';
import { DESK_TOP, ROOM, GB, CRT, STATION_W } from './scene.js';

const SPACING = 0.015;
const SUBSTEPS = 4;
const ITERATIONS = 12;
const GRAVITY = new THREE.Vector3(0, -9.8, 0);
const DAMPING = 0.985;
const MU_STATIC = 1.2;   // contact friction: sticks while sliding less than this x the push out of a surface
const MU_KINETIC = 0.7;  // and loses this x the push of its slide when it does move
const RELIEF = 3;        // bend links next to a plug that get extra stiffness

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...opts });
const BLACK = mat(0x1a1a1c, { roughness: 0.45 });

class Particle {
  constructor(pos, radius) {
    this.x = pos.clone();
    this.prev = pos.clone();
    this.last = pos.clone();   // where it was at the start of this substep
    this.r = radius;
    this.pinned = false;
  }
}

// Where a cable end is held: a point on a device and the direction the cable
// leaves it in, both following the device around.
class Anchor {
  constructor(object, local, dir) {
    this.object = object;
    this.local = local;
    this.dir = dir.normalize();
  }

  world(offset = 0) {
    return this.local.clone().addScaledVector(this.dir, offset).applyMatrix4(this.object.matrixWorld);
  }
}

// Somewhere a plug can go: a point on a device, the direction the cable leaves
// it in, and which kind of plug fits.
export class Socket {
  constructor(name, kind, object, local, dir) {
    this.name = name;
    this.kind = kind;
    this.anchor = new Anchor(object, local.clone(), dir.clone());
    this.plug = null;   // the End plugged in
  }

  world() { return this.anchor.world(); }

  // World rotation of a plug sitting in it (plug space: cable end at the origin, cable along -z).
  quaternion() {
    const q = this.anchor.object.getWorldQuaternion(new THREE.Quaternion());
    return q.multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), this.anchor.dir));
  }
}

// One end of a cable: its plug model and the socket it's in (or null: loose).
export class End {
  constructor(name, kind, plug, { fixed = false } = {}) {
    this.name = name;
    this.kind = kind;
    this.plug = plug;
    this.fixed = fixed;   // can't be pulled out (the CRT's power cord)
    this.socket = null;
    this.cable = null;
    this.index = 0;       // which particle of the cable
    this.anim = null;     // plugging in
    // how far the plug reaches from the end of its cable to the tip of its nose
    plug.updateMatrixWorld(true);
    const box = new THREE.Box3();
    plug.traverse((o) => { if (o.isMesh) box.union(new THREE.Box3().setFromObject(o)); });
    this.length = box.isEmpty() ? 0 : box.max.z;
    this.thick = box.isEmpty() ? 0 : Math.min(box.max.x - box.min.x, box.max.y - box.min.y) / 2;
  }

  get plugged() { return !!this.socket; }
}

// Catmull-Rom point between p1 and p2 (p0, p3 their neighbours) at t.
function catmull(out, p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const a = -0.5 * t3 + t2 - 0.5 * t, b = 1.5 * t3 - 2.5 * t2 + 1, c = -1.5 * t3 + 2 * t2 + 0.5 * t, d = 0.5 * t3 - 0.5 * t2;
  return out.set(a * p0.x + b * p1.x + c * p2.x + d * p3.x, a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    a * p0.z + b * p1.z + c * p2.z + d * p3.z);
}

// A tube along a chain of points, smoothed into `sub` rings per segment and
// updated in place.
class Tube {
  constructor(points, radius, material, radial = 12, sub = 3) {
    this.sub = sub;
    this.smooth = Array.from({ length: (points - 1) * sub + 1 }, () => new THREE.Vector3());
    const count = this.smooth.length;
    this.count = count;
    this.radius = radius;
    this.radial = radial;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(count * radial * 3);
    this.nrm = new Float32Array(count * radial * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3));
    const idx = [];
    for (let i = 0; i < count - 1; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * radial + j, b = i * radial + (j + 1) % radial;
        idx.push(a, a + radial, b, b, a + radial, b + radial);
      }
    }
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.n = new THREE.Vector3(0, 1, 0);
  }

  update(chain) {
    const last = chain.length - 1, sub = this.sub;
    const e0 = new THREE.Vector3().subVectors(chain[0], chain[1]).add(chain[0]);
    const e1 = new THREE.Vector3().subVectors(chain[last], chain[last - 1]).add(chain[last]);
    for (let i = 0; i < last; i++) {
      const p0 = i > 0 ? chain[i - 1] : e0, p3 = i + 2 <= last ? chain[i + 2] : e1;
      for (let k = 0; k < sub; k++) catmull(this.smooth[i * sub + k], p0, chain[i], chain[i + 1], p3, k / sub);
    }
    this.smooth[last * sub].copy(chain[last]);
    const points = this.smooth;
    const t = new THREE.Vector3(), n = this.n.clone(), b = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i < this.count; i++) {
      const p = points[i];
      t.subVectors(points[Math.min(i + 1, this.count - 1)], points[Math.max(i - 1, 0)]).normalize();
      // parallel transport the normal along the tube so it doesn't twist
      n.addScaledVector(t, -n.dot(t));
      if (n.lengthSq() < 1e-8) n.set(t.y, -t.x, 0).addScaledVector(t, -0.5);
      n.normalize();
      b.crossVectors(t, n);
      for (let j = 0; j < this.radial; j++) {
        const a = (j / this.radial) * Math.PI * 2;
        v.copy(n).multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
        const k = (i * this.radial + j) * 3;
        this.nrm[k] = v.x; this.nrm[k + 1] = v.y; this.nrm[k + 2] = v.z;
        this.pos[k] = p.x + v.x * this.radius; this.pos[k + 1] = p.y + v.y * this.radius; this.pos[k + 2] = p.z + v.z * this.radius;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.normal.needsUpdate = true;
  }
}

// One length of cable between two particles (either may be shared with
// another cable, e.g. at a splitter) or Ends plugged into sockets.
class Cable {
  constructor(sim, { from, to, via = [], length, radius, color, stiffness = 0.06, smooth = 1, edges = false, spacing = SPACING, margin = 0 }) {
    this.radius = radius;
    const isEnd = (e) => e instanceof End;
    // lay it out along the given route to begin with
    const start = isEnd(from) ? from.socket.world() : from.x;
    const end = isEnd(to) ? to.socket.world() : to.x;
    const route = [start];
    if (isEnd(from)) route.push(from.socket.anchor.world(0.02));
    route.push(...via);
    if (isEnd(to)) route.push(to.socket.anchor.world(0.02));
    route.push(end);
    const path = new THREE.CatmullRomCurve3(route, false, 'centripetal');
    const pathLen = path.getLength();
    this.length = Math.max(length, pathLen * 1.02);
    const count = Math.max(4, Math.round(this.length / spacing) + 1);
    this.seg = this.length / (count - 1);
    // extra length beyond the route is laid in as a gentle zig-zag so it starts slack
    this.particles = [];
    for (let i = 0; i < count; i++) {
      const f = i / (count - 1);
      const p = path.getPointAt(Math.min(1, f));
      if (i > 1 && i < count - 2 && this.length > pathLen * 1.05) p.y += 0.004 * Math.sin(i * 1.3);
      this.particles.push(new Particle(p, radius + margin));
    }
    if (!isEnd(from)) this.particles[0] = from;
    if (!isEnd(to)) this.particles[count - 1] = to;
    this.ends = [isEnd(from) ? from : null, isEnd(to) ? to : null];
    this.ends.forEach((e, k) => {
      if (!e) return;
      e.cable = this;
      e.index = k ? count - 1 : 0;
      this.setPinned(e, true);
    });
    this.from = this.ends[0];
    this.to = this.ends[1];
    for (let i = 0; i < count - 1; i++) sim.link(this.particles[i], this.particles[i + 1], this.seg, 1);
    // stiffer for the first few cm out of a plug, so it curves away instead of kinking
    const relief = (i) => (this.from && i < RELIEF) || (this.to && i >= count - 2 - RELIEF);
    for (let i = 0; i < count - 2; i++) sim.link(this.particles[i], this.particles[i + 2], this.seg * 2, relief(i) ? 0.5 : stiffness);
    sim.particles.push(...this.particles.filter((p) => !sim.particles.includes(p)));
    this.tube = new Tube(count, radius, mat(color, { roughness: 0.5 }), smooth > 1 ? 12 : 8, smooth);
    this.segments = edges ? this.particles.slice(1).map((p, i) => [this.particles[i], p]) : [];
    sim.scene.add(this.tube.mesh);
  }

  // The particle at an end and the one next to it.
  pair(e) { return e.index ? [this.particles[e.index], this.particles[e.index - 1]] : [this.particles[0], this.particles[1]]; }

  setPinned(e, on) {
    const [a, b] = this.pair(e);
    a.pinned = b.pinned = on;
  }

  // The other end's particle (a plug or a shared particle like the splitter).
  otherEnd(e) { return this.particles[e.index ? 0 : this.particles.length - 1]; }

  pin() {
    for (const e of this.ends) {
      if (!e) continue;
      const [a, b] = this.pair(e);
      if (e.socket) {
        a.x.copy(e.socket.world());
        b.x.copy(e.socket.anchor.world(this.seg));
      } else if (e.anim) {
        // being pushed in: follow the plug
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(e.plug.quaternion);
        a.x.copy(e.plug.position);
        b.x.copy(e.plug.position).addScaledVector(dir, this.seg);
      } else if (e.held) {
        // in your hand: the cable trails off it
        a.x.copy(e.held);
        b.x.lerp(a.x, 0.5);
        if (b.x.distanceTo(a.x) > this.seg) b.x.sub(a.x).setLength(this.seg).add(a.x);
        a.prev.copy(a.x);
        continue;
      } else continue;
      a.prev.copy(a.x);
      b.prev.copy(b.x);
    }
  }

  draw() {
    // loose plugs hang off the end of the cable, pointing away from it, with
    // the end particle in the middle of the plug (see CableSim.collide for how
    // its nose is kept out of things)
    for (const e of this.ends) {
      if (!e || e.socket || e.anim) continue;
      const [a, b] = this.pair(e);
      if (e.held) {
        // held: pointing along the way you're holding it, out from the cable
        const d = new THREE.Vector3().subVectors(b.x, a.x);
        if (d.lengthSq() > 1e-10) e.plug.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), d.normalize());
        e.plug.position.copy(a.x);
        continue;
      }
      const dir = new THREE.Vector3().subVectors(b.x, a.x);
      if (dir.lengthSq() > 1e-10) e.plug.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir.normalize());
      e.plug.position.copy(a.x).addScaledVector(dir, e.length / 2);
    }
    this.tube.update(this.particles.map((p) => p.x));
  }
}

// Particles are checked against the boxes near their own run of this many along a cable.
const RUN = 8;
// The physics' fixed step (s), and the most steps it'll catch up in one frame.
const STEP = 1 / 60, MAX_STEPS = 3;
// Cables sleep once no particle has moved more than REST (m) a step for QUIET_FRAMES frames.
const REST = 1e-4, QUIET_FRAMES = 45;   // (a resting cable can creep a few hundredths of a mm a frame, forever)

export class CableSim {
  constructor(scene, colliders, dynamic = () => []) {
    this.scene = scene;
    this.colliders = colliders;
    this.dynamic = dynamic;   // extra boxes that move (the GB)
    this.particles = [];
    this.links = [];
    this.cables = [];
    this.sockets = {};
    this.ends = {};
    this.onChange = () => {};
    this.onSound = () => {};   // (name, world position)
    this.raycaster = new THREE.Raycaster();
  }

  // Adds a socket (and shows its dark opening on the device; link ports are
  // shaped like their plugs and outlined in a turning rainbow).
  addSocket(name, kind, object, local, dir, size = null) {
    const frame = size ? socket(object, local.clone().addScaledVector(dir, -size[2]), dir, size[0], size[1], kind.startsWith('link'), PORT_SHAPE[kind]) : null;
    const s = this.sockets[name] = new Socket(name, kind, object, local, dir);
    s.outline = frame;   // (the glowing frame round a link port, if it has one)
    return s;
  }

  // A plug, starting out in `socketName`.
  addEnd(name, kind, plugMesh, socketName, opts) {
    const e = new End(name, kind, plugMesh, opts);
    const s = this.sockets[socketName];
    e.socket = s;
    s.plug = e;
    s.anchor.object.add(plugMesh);
    plugMesh.position.copy(s.anchor.local);
    plugMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), s.anchor.dir);
    return (this.ends[name] = e);
  }

  // The plug under the pointer, if any (fixed ones don't count, nor ones
  // hidden behind something else).
  pick(ndc, camera) {
    this.raycaster.setFromCamera(ndc, camera);
    let best = null, bestD = Infinity;
    const ray = this.raycaster.ray, box = new THREE.Box3(), c = new THREE.Vector3(), q = new THREE.Vector3();
    let near = null, nearMiss = Infinity, nearD = Infinity;
    for (const e of Object.values(this.ends)) {
      if (e.fixed || e.anim || e.held) continue;
      const hit = this.raycaster.intersectObject(e.plug, true)[0];
      if (hit && hit.distance < bestD) { best = e; bestD = hit.distance; }
      // plugs are small: a ray passing close by counts too
      box.setFromObject(e.plug).getCenter(c);
      const t = c.clone().sub(ray.origin).dot(ray.direction);
      if (t <= 0) continue;
      const miss = ray.at(t, q).distanceTo(c);
      if (miss < 0.025 && miss < nearMiss) { near = e; nearMiss = miss; nearD = t; }
    }
    if (!best && near) { best = near; bestD = nearD - 0.03; }
    if (!best) return this.pickByCable();
    const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
    // (cables don't count: a plug lying in a coil of its own cable is still clickable)
    const tubes = new Set(this.cables.map((k) => k.tube.mesh));
    const first = this.raycaster.intersectObjects(this.scene.children, true)
      .find((h) => h.object.isMesh && shown(h.object) && !tubes.has(h.object));
    // hidden behind something: maybe the cable it's on is in view instead
    return first && first.distance < bestD - 0.005 ? this.pickByCable() : best;
  }

  // The cables a cable is joined to (through a splitter), itself included.
  connected(cable) {
    const set = new Set([cable]);
    for (let grew = true; grew;) {
      grew = false;
      for (const c of this.cables) {
        if (set.has(c)) continue;
        const ends = [c.particles[0], c.particles[c.particles.length - 1]];
        if ([...set].some((k) => ends.includes(k.particles[0]) || ends.includes(k.particles[k.particles.length - 1]))) { set.add(c); grew = true; }
      }
    }
    return [...set];
  }

  // Pointing at a cable (anywhere you can see it): the loose plug on it (or
  // through its splitter) nearest to where you're pointing, to pull in. So a
  // plug that's fallen somewhere out of sight can still be got back.
  pickByCable() {
    const tubes = new Map(this.cables.map((c) => [c.tube.mesh, c]));
    // (the tubes move every frame: their bounds have to be brought up to date to be hit)
    for (const c of this.cables) c.tube.mesh.geometry.computeBoundingSphere();
    const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
    const hit = this.raycaster.intersectObjects(this.scene.children, true).find((h) => h.object.isMesh && shown(h.object));
    if (!hit || !tubes.has(hit.object)) return null;
    let best = null, bestD = Infinity;
    for (const c of this.connected(tubes.get(hit.object))) {
      for (const e of c.ends) {
        if (!e || e.fixed || e.socket || e.anim || e.held) continue;
        const d = e.plug.position.distanceTo(hit.point);
        if (d < bestD) { best = e; bestD = d; }
      }
    }
    return best;
  }

  // Pulls a plug out of its socket; it drops and dangles.
  unplug(e) {
    if (!e.socket || e.fixed) return;
    const s = e.socket;
    s.plug = null;
    e.socket = null;
    this.scene.attach(e.plug);
    e.cable.setPinned(e, false);
    const end = e.cable.pair(e)[0];
    e.radius = end.r;
    end.r = Math.max(end.r, e.thick);
    // pulled out a little
    const [a, b] = e.cable.pair(e);
    const out = s.anchor.dir.clone().transformDirection(s.anchor.object.matrixWorld).multiplyScalar(0.01);
    for (const p of [a, b]) { p.x.add(out); p.prev.copy(p.x).addScaledVector(out, -0.3); }
    this.onSound('unplug', s.world());
    this.onChange(e);
  }

  // How far a plug can go: from where its cable is held down, along the cable
  // (and through a splitter onto the cable behind it, which comes along too).
  // {from: point, length}.
  reach(e) {
    let cable = e.cable, far = cable.otherEnd(e), length = cable.length;
    for (let hops = 0; hops < 3; hops++) {
      const end = cable.ends.find((x) => x && cable.pair(x)[0] === far);
      if (end) return { from: end.socket ? end.socket.world() : far.x.clone(), length };
      // a shared particle (the AV cable's splitter): carry on along the other cable through it
      const next = this.cables.find((c) => c !== cable && (c.particles[0] === far || c.particles[c.particles.length - 1] === far));
      if (!next) break;
      const otherSide = next.particles[0] === far ? next.particles[next.particles.length - 1] : next.particles[0];
      const held = next.ends.find((x) => x && next.pair(x)[0] === otherSide);
      length += next.length;
      if (held?.socket) return { from: held.socket.world(), length };
      cable = next;
      far = otherSide;
    }
    return { from: far.x.clone(), length };
  }

  // Free sockets a loose plug could go into: the right kind and within reach.
  // Nearest to the plug first.
  reachable(e) {
    const { from, length } = this.reach(e), at = e.plug.position;
    return Object.values(this.sockets)
      .filter((s) => s.kind === e.kind && !s.plug && s.world().distanceTo(from) <= length * 0.95)
      .sort((p, q) => p.world().distanceTo(at) - q.world().distanceTo(at));
  }

  // Pushes a loose plug into the nearest socket it reaches; false if there's none.
  plugIn(e, socket = this.reachable(e)[0]) {
    if (e.socket || e.anim || !socket) return false;
    socket.plug = e;   // reserved
    e.anim = { t: 0, socket, p0: e.plug.position.clone(), q0: e.plug.quaternion.clone() };
    return true;
  }

  // Picking up a loose plug: it follows `at` (a point you're holding it at,
  // kept within reach of the cable's other end) until it's plugged in or dropped.
  hold(e) {
    if (e.socket || e.anim) return;
    this.holding = e;
    e.held = e.plug.position.clone();
    const a = e.cable.pair(e)[0];
    a.pinned = true;
  }

  moveHeld(at) {
    const e = this.holding;
    if (!e) return;
    const { from, length } = this.reach(e), max = length * 0.9;
    const d = at.clone().sub(from);
    if (d.length() > max) d.setLength(max);
    // not too fast, so the cable (and a splitter on it) can keep up, and in
    // small steps that bump into things (no lifting it through the desk)
    const to = from.clone().add(d), step = to.sub(e.held);
    if (step.length() > 0.05) step.setLength(0.05);
    const boxes = [...this.colliders, ...this.dynamic()].filter((b) => {
      b.reach = b.half.length();
      return b.center.distanceTo(e.held) <= b.reach + step.length() + 0.1;
    });
    const n = Math.ceil(step.length() / 0.004);
    step.divideScalar(Math.max(1, n));
    const r = Math.max(e.thick, 0.004);
    for (let i = 0; i < n; i++) {
      const was = e.held.clone();
      e.held.add(step);
      for (const b of boxes) {
        const push = this.penetration(e.held, r, b, was);
        if (push) e.held.add(push);
      }
    }
  }

  drop() {
    const e = this.holding;
    if (!e) return;
    this.holding = null;
    e.held = null;
    e.cable.pair(e)[0].pinned = false;
  }

  // The free socket that fits the held plug nearest the ray (within 4 cm of it), if any.
  socketOnRay(ray) {
    const e = this.holding;
    if (!e) return null;
    const q = new THREE.Vector3();
    let best = null, bestMiss = 0.04;
    for (const s of this.reachable(e)) {
      const p = s.world(), t = p.clone().sub(ray.origin).dot(ray.direction);
      if (t <= 0) continue;
      const miss = ray.at(t, q).distanceTo(p);
      if (miss < bestMiss) { best = s; bestMiss = miss; }
    }
    return best;
  }

  // Plugs the held plug into a socket.
  plugHeld(socket) {
    const e = this.holding;
    if (!e || !socket) return false;
    this.drop();
    return this.plugIn(e, socket);
  }

  // Animates plugs going in.
  animate(dt) {
    for (const e of Object.values(this.ends)) {
      const a = e.anim;
      if (!a) continue;
      a.t = Math.min(1, a.t + dt / 0.35);
      const f = a.t * a.t * (3 - 2 * a.t);
      const to = a.socket.world();
      // come in along the socket's axis for the last bit
      const approach = to.clone().addScaledVector(a.socket.anchor.dir.clone().transformDirection(a.socket.anchor.object.matrixWorld), 0.03 * (1 - f));
      e.plug.position.lerpVectors(a.p0, approach, f);
      e.plug.quaternion.slerpQuaternions(a.q0, a.socket.quaternion(), Math.min(1, f * 1.5));
      if (a.t < 1) continue;
      e.anim = null;
      e.socket = a.socket;
      a.socket.anchor.object.attach(e.plug);
      e.plug.position.copy(a.socket.anchor.local);
      e.plug.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), a.socket.anchor.dir);
      e.cable.setPinned(e, true);
      if (e.radius) e.cable.pair(e)[0].r = e.radius;
      this.onSound('plugIn', a.socket.world());
      this.onChange(e);
    }
  }

  // Where a plug is: the name of its socket, or null.
  at(endName) { return this.ends[endName]?.socket?.name ?? null; }

  link(a, b, rest, k) { this.links.push({ a, b, rest, k }); }

  add(opts) {
    const c = new Cable(this, opts);
    this.cables.push(c);
    return c;
  }

  // Remembers how everything is now (each plug's socket, each cable's shape),
  // for reset().
  snapshot() {
    this.saved = {
      ends: Object.fromEntries(Object.values(this.ends).map((e) => [e.name, e.socket?.name ?? null])),
      cables: this.cables.map((c) => c.particles.map((p) => [p.x.clone(), p.prev.clone(), p.r])),
    };
  }

  // Back to the snapshot: every plug straight into the socket it started in
  // (out of wherever it is now), and every cable as it was.
  reset() {
    if (!this.saved) return;
    this.drop();
    for (const e of Object.values(this.ends)) {
      const want = this.saved.ends[e.name] && this.sockets[this.saved.ends[e.name]];
      if (e.anim) { e.anim.socket.plug = null; e.anim = null; }
      if (e.socket === want) continue;
      if (e.socket) { e.socket.plug = null; e.socket = null; }
      if (!want) continue;
      if (want.plug && want.plug !== e) { want.plug.socket = null; this.scene.attach(want.plug.plug); }
      e.socket = want;
      want.plug = e;
      want.anchor.object.add(e.plug);
      e.plug.position.copy(want.anchor.local);
      e.plug.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), want.anchor.dir);
      e.cable.setPinned(e, true);
    }
    this.cables.forEach((c, i) => c.particles.forEach((p, j) => {
      const [x, prev, r] = this.saved.cables[i][j];
      p.x.copy(x); p.prev.copy(prev); p.r = r;
    }));
    for (const e of Object.values(this.ends)) this.onChange(e);
    this.draw();
  }

  // Runs the simulation for a while so the cables start out settled.
  settle(seconds = 4) {
    for (let t = 0; t < seconds; t += 1 / 60) this.step(1 / 60);
    this.draw();
  }

  update(dt) {
    // the link ports' outlines turn and pulse
    this.time = (this.time ?? 0) + dt;
    OUTLINE.uniforms.time.value = this.time;
    this.animate(dt);
    // cables at rest sleep (no physics, nothing to redraw) until something
    // that can move them does: worth it, since they're at rest nearly always
    if (!this.still()) this.quiet = 0;
    if (this.quiet >= QUIET_FRAMES) { this.acc = 0; return; }
    // the physics runs in fixed steps, however long the frame was: Verlet
    // integration with steps of different lengths keeps putting energy in
    // (browsers' frames vary), and the cables would jiggle for ever
    this.acc = Math.min((this.acc ?? 0) + dt, STEP * MAX_STEPS);
    if (this.acc < STEP) return;
    // where everything was, to see how far it got this frame (not within a
    // substep: resting on something, gravity and the push back jitter there)
    const before = this.before ?? (this.before = new Float32Array(this.particles.length * 3));
    this.particles.forEach((p, i) => { before[i * 3] = p.x.x; before[i * 3 + 1] = p.x.y; before[i * 3 + 2] = p.x.z; });
    let steps = 0;
    while (this.acc >= STEP) {
      this.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    this.draw();
    let moved = 0;   // the most any particle moved a step, this frame (squared)
    this.particles.forEach((p, i) => {
      const dx = p.x.x - before[i * 3], dy = p.x.y - before[i * 3 + 1], dz = p.x.z - before[i * 3 + 2];
      moved = Math.max(moved, dx * dx + dy * dy + dz * dz);
    });
    this.quiet = moved / (steps * steps) < REST * REST ? (this.quiet ?? 0) + 1 : 0;
  }

  // Whether nothing that moves the cables has moved since last frame: the
  // plugged-in ends (with whatever they're plugged into) and the GB's box, and
  // no plug in hand or going in.
  still() {
    if (this.holding || Object.values(this.ends).some((e) => e.anim || e.held)) return false;
    const where = [];
    for (const e of Object.values(this.ends)) if (e.socket) where.push(...e.socket.world().toArray());
    for (const b of this.dynamic()) where.push(b.center.x, b.center.y, b.center.z);
    const was = this.where;
    this.where = where;
    return !!was && was.length === where.length && where.every((v, i) => Math.abs(v - was[i]) < 1e-6);
  }

  draw() { for (const c of this.cables) c.draw(); }

  step(dt) {
    // each particle only bothers with the boxes near its own stretch of cable
    // (a link cable reaching into the maze would otherwise drag every wall of
    // it into every particle's checks)
    const boxes = this.nearBoxes();
    const h = dt / SUBSTEPS;
    const g = GRAVITY.clone().multiplyScalar(h * h);
    const v = new THREE.Vector3(), d = new THREE.Vector3();
    for (let s = 0; s < SUBSTEPS; s++) {
      for (const c of this.cables) c.pin();
      for (const p of this.particles) {
        p.last.copy(p.x);
        if (p.pinned) continue;
        v.subVectors(p.x, p.prev).multiplyScalar(DAMPING);
        p.prev.copy(p.x);
        p.x.add(v).add(g);
      }
      for (let it = 0; it < ITERATIONS; it++) {
        for (const { a, b, rest, k } of this.links) {
          d.subVectors(b.x, a.x);
          const len = d.length();
          if (len < 1e-9) continue;
          const wa = a.pinned ? 0 : 1, wb = b.pinned ? 0 : 1;
          if (wa + wb === 0) continue;
          const corr = ((len - rest) / len) * k / (wa + wb);
          a.x.addScaledVector(d, corr * wa);
          b.x.addScaledVector(d, -corr * wb);
        }
        // every iteration, so a strongly pulled cable can't be dragged through the
        // thin desk top; friction only once a substep, so a pull still travels
        // along the cable (slack hanging off the desk gets pulled up onto it)
        this.collide(boxes, it === ITERATIONS - 1, it === ITERATIONS - 1);
      }
    }
  }

  // For each run of RUN particles along each cable, the boxes within 0.3 m of
  // where it is (and its particles point at that list: p.boxes); returns them all.
  nearBoxes() {
    const all = [...this.colliders, ...this.dynamic()];
    for (const b of all) b.reach = b.half.length();
    const lo = new THREE.Vector3(), hi = new THREE.Vector3(), used = new Set();
    for (const c of this.cables) {
      const ps = c.particles;
      for (let i = 0; i < ps.length; i += RUN) {
        const run = ps.slice(i, i + RUN + 1);
        lo.set(Infinity, Infinity, Infinity);
        hi.set(-Infinity, -Infinity, -Infinity);
        for (const p of run) { lo.min(p.x); hi.max(p.x); }
        lo.subScalar(0.3);
        hi.addScalar(0.3);
        const near = all.filter((b) => {
          const q = b.center;
          const dx = Math.max(lo.x - q.x, 0, q.x - hi.x), dy = Math.max(lo.y - q.y, 0, q.y - hi.y), dz = Math.max(lo.z - q.z, 0, q.z - hi.z);
          return dx * dx + dy * dy + dz * dz <= b.reach * b.reach;
        });
        for (const p of run) p.boxes = near;
        for (const b of near) used.add(b);
      }
    }
    return [...used];
  }

  collide(boxes, segments = false, friction = true) {
    const n = this._n ?? (this._n = new THREE.Vector3());
    const t = this._t ?? (this._t = new THREE.Vector3());
    for (const p of this.particles) {
      if (p.pinned) continue;
      let depth = 0;
      n.set(0, 0, 0);
      for (const box of p.boxes ?? boxes) {
        const push = this.penetration(p.x, p.r, box, p.last);
        if (!push) continue;
        p.x.add(push);
        n.add(push);
        depth += push.length();
      }
      if (depth === 0 || !friction) continue;
      // friction in proportion to how hard it's pressed against the surface:
      // it holds still (a cable over the desk edge doesn't creep off it under
      // the weight of the part hanging down) until it's pulled hard enough
      n.normalize();
      t.subVectors(p.x, p.last);
      t.addScaledVector(n, -t.dot(n));
      const slide = t.length();
      if (slide < MU_STATIC * depth) p.x.sub(t);
      else p.x.addScaledVector(t, -Math.min(1, (MU_KINETIC * depth) / slide));
    }
    // loose plugs: the tip of the nose too, so no part of a plug sinks into the
    // desk or a console (and hides there)
    const tip = new THREE.Vector3(), dir = new THREE.Vector3();
    for (const e of Object.values(this.ends)) {
      if (e.socket || e.anim || !e.cable) continue;
      const [a, b] = e.cable.pair(e);
      dir.subVectors(a.x, b.x);
      if (dir.lengthSq() < 1e-10) continue;
      tip.copy(a.x).addScaledVector(dir.normalize(), e.length / 2);
      for (const box of a.boxes ?? boxes) {
        const push = this.penetration(tip, e.thick, box, tip);
        if (push) { a.x.add(push); tip.add(push); }
      }
    }
    // the midpoints of segments too, so a cable bent over an edge (or pulled
    // taut across one) doesn't cut through the corner between two particles
    if (!segments) return;
    const m = new THREE.Vector3(), ml = new THREE.Vector3();
    for (const c of this.cables) {
      for (const [a, b] of c.segments) {
        if (a.pinned && b.pinned) continue;
        m.addVectors(a.x, b.x).multiplyScalar(0.5);
        ml.addVectors(a.last, b.last).multiplyScalar(0.5);
        for (const box of a.boxes ?? boxes) {
          const push = this.penetration(m, a.r, box, ml);
          if (!push) continue;
          const wa = a.pinned ? 0 : 1, wb = b.pinned ? 0 : 1;
          // moved without gaining speed, so it doesn't bounce off again
          push.multiplyScalar(2 / (wa + wb));
          if (wa) { a.x.add(push); a.prev.add(push); }
          if (wb) { b.x.add(push); b.prev.add(push); }
          m.addVectors(a.x, b.x).multiplyScalar(0.5);
        }
      }
    }
  }

  // The push that gets a sphere at x out of a box, or null. Near an edge or
  // corner it's away from the closest point of the box, so the cable slides
  // smoothly round it. A centre that has got inside the box backs out the
  // side it came in through if it was outside at `from` (so a fast-moving
  // cable can't tunnel through the thin desk top), otherwise the shortest way.
  penetration(x, r, box, from) {
    const d = this._d ?? (this._d = new THREE.Vector3());
    const f = this._f ?? (this._f = new THREE.Vector3());
    const push = this._push ?? (this._push = new THREE.Vector3());
    d.subVectors(x, box.center);
    if (d.lengthSq() > (box.reach + r) ** 2) return null;
    const l = [0, 0, 0];
    let outside = 0;
    push.set(0, 0, 0);
    for (let i = 0; i < 3; i++) {
      l[i] = d.dot(box.axes[i]);
      const h = box.half.getComponent(i), over = Math.abs(l[i]) - h;
      if (over >= r) return null;
      if (over > 0) {
        push.addScaledVector(box.axes[i], over * Math.sign(l[i]));
        outside += over * over;
      }
    }
    if (outside > 0) {
      // the centre is outside the box but within r of it
      const dist = Math.sqrt(outside);
      if (dist >= r) return null;
      return push.multiplyScalar((r - dist) / dist);
    }
    f.subVectors(from, box.center);
    let best = Infinity, axis = -1, sign = 1, came = Infinity, cAxis = -1, cSign = 1;
    for (let i = 0; i < 3; i++) {
      const lf = f.dot(box.axes[i]);
      const half = box.half.getComponent(i) + r;
      const pen = half - Math.abs(l[i]);
      if (pen < best) { best = pen; axis = i; sign = l[i] < 0 ? -1 : 1; }
      if (Math.abs(lf) >= box.half.getComponent(i)) {
        // it was outside on this axis: the push back out to that side
        const back = half - l[i] * Math.sign(lf);
        if (back < came) { came = back; cAxis = i; cSign = Math.sign(lf); }
      }
    }
    if (cAxis >= 0) { best = came; axis = cAxis; sign = cSign; }
    return push.copy(box.axes[axis]).multiplyScalar(best * sign);
  }
}

// --- connectors -----------------------------------------------------------------

// A plug body: a molded box with a strain relief, its cable end at the origin
// pointing along -z, its nose (into the socket) along +z.
function plug(w, h, len, color = BLACK) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(w, h, len, 2, Math.min(w, h) * 0.2), color);
  body.position.z = 0.006 + len / 2;
  g.add(body);
  const relief = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w, h) * 0.22, Math.min(w, h) * 0.32, 0.012, 12), color);
  relief.rotation.x = Math.PI / 2;
  relief.position.z = 0.002;
  g.add(relief);
  for (const m of g.children) m.castShadow = true;
  return g;
}

// A link-cable plug: a moulded housing, and a nose (into the socket) shaped
// like the port (SHAPES[shape], w by h, nose long), its contacts dark in its face.
function linkPlug(shape, w, h, nose, [hw, hh, hl], color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(hw, hh, hl, 2, Math.min(hw, hh) * 0.25), color);
  body.position.z = 0.006 + hl / 2;
  g.add(body);
  const tip = new THREE.Mesh(new THREE.ExtrudeGeometry(SHAPES[shape](w, h, true), { depth: nose, bevelEnabled: false, curveSegments: 8 }), color);
  tip.position.z = 0.006 + hl;
  g.add(tip);
  const [fw, fh] = shape === 'gb' ? [0.75, 0.85] : [0.94, 0.75];   // (the opening is most of the plug's end: an even rim, ~1 mm)
  const face = new THREE.Mesh(new THREE.ShapeGeometry(SHAPES[shape](w * fw, h * fh, true), 8), BLACK);
  face.position.z = 0.006 + hl + nose + 0.0002;
  g.add(face);
  const relief = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(hw, hh) * 0.22, Math.min(hw, hh) * 0.32, 0.012, 12), color);
  relief.rotation.x = Math.PI / 2;
  relief.position.z = 0.002;
  g.add(relief);
  for (const m of g.children) m.castShadow = true;
  return g;
}

// A DC barrel plug: a round moulded body and the metal sleeve that goes in the jack.
function barrel() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.018, 16), BLACK);
  body.rotation.x = Math.PI / 2;
  body.position.z = 0.006 + 0.009;
  g.add(body);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 0.01, 16), mat(0xc8c8c0, { metalness: 0.9, roughness: 0.3 }));
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.z = 0.024 + 0.005;
  g.add(sleeve);
  const relief = new THREE.Mesh(new THREE.CylinderGeometry(0.0024, 0.0036, 0.012, 12), BLACK);
  relief.rotation.x = Math.PI / 2;
  relief.position.z = 0.002;
  g.add(relief);
  for (const m of g.children) m.castShadow = true;
  return g;
}

function rca(tip) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.022, 16), BLACK);
  body.rotation.x = Math.PI / 2;
  body.position.z = 0.017;
  g.add(body);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.0048, 0.0048, 0.006, 16), mat(tip));
  ring.rotation.x = Math.PI / 2;
  ring.position.z = 0.03;
  g.add(ring);
  const relief = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0035, 0.01, 10), BLACK);
  relief.rotation.x = Math.PI / 2;
  relief.position.z = 0.003;
  g.add(relief);
  return g;
}

// Outlines of the link ports and plugs, centred, w wide and h tall: the PSone's
// controller port (wider at the top, its lower corners cut away, all rounded)
// and the Game Boy's link port: a long rounded rectangle with the two corners
// of one long side cut off at 45 degrees (at +x, or at -x if flipped: a plug
// faces the other way from its socket).
function roundedShape(pts, r) {
  const s = new THREE.Shape(), n = pts.length, V = (p) => new THREE.Vector2(p[0], p[1]);
  for (let i = 0; i < n; i++) {
    const p = V(pts[i]), a = V(pts[(i + n - 1) % n]), c = V(pts[(i + 1) % n]);
    const p0 = p.clone().add(a.sub(p).setLength(Math.min(r, a.length() / 2)));
    const p1 = p.clone().add(c.sub(p).setLength(Math.min(r, c.length() / 2)));
    if (i === 0) s.moveTo(p0.x, p0.y); else s.lineTo(p0.x, p0.y);
    s.quadraticCurveTo(p.x, p.y, p1.x, p1.y);
  }
  s.closePath();
  return s;
}
const SHAPES = {
  ps: (w, h) => roundedShape([[-w / 2, h / 2], [w / 2, h / 2], [w / 2, -h * 0.05], [w * 0.38, -h / 2], [-w * 0.38, -h / 2], [-w / 2, -h * 0.05]], h * 0.22),
  gb: (w, h, flip = false) => {
    const c = w * 0.27, f = flip ? -1 : 1;
    const pts = [[-w / 2, h / 2], [w / 2 - c, h / 2], [w / 2, h / 2 - c], [w / 2, -h / 2 + c], [w / 2 - c, -h / 2], [-w / 2, -h / 2]];
    return roundedShape(pts.map(([x, y]) => [x * f, y]), w * 0.12);
  },
};
SHAPES.round = (w) => new THREE.Shape().absarc(0, 0, w / 2, 0, Math.PI * 2, false);
const PORT_SHAPE = { 'link-ps': 'ps', 'link-gb': 'gb', barrel: 'round' };

// (a rainbow going round it, turning, and pulsing: unlit, so it glows)
const OUTLINE = new THREE.ShaderMaterial({
  uniforms: { time: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vP;
    void main() {
      vP = position.xy;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float time;
    varying vec2 vP;
    vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
    void main() {
      float h = atan(vP.y, vP.x) / 6.28318 + time * 0.4;
      float pulse = 0.8 + 0.2 * sin(time * 3.2);
      gl_FragColor = vec4(hue(fract(h)) * pulse, 1.0);
    }`,
});
// A dark socket face on a device, centred at `local`, facing `normal`, a
// rectangle or one of SHAPES; `outline` puts a glowing, turning rainbow frame round it.
export function socket(object, local, normal, w, h, outline = false, shape = null) {
  const geo = shape ? new THREE.ShapeGeometry(SHAPES[shape](w, h), 8) : new THREE.PlaneGeometry(w, h);
  const m = new THREE.Mesh(geo, mat(0x101012, { roughness: 0.8 }));
  m.position.copy(local).addScaledVector(normal, 0.0006);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  object.add(m);
  if (!outline) return null;
  const t = shape === 'gb' ? 0.002 : 0.0045;   // (all outside the opening, so it shows round a plug; the GB's is small)
  let frameShape;
  if (shape) {
    frameShape = SHAPES[shape](w + 2 * t, h + 2 * t);
    frameShape.holes.push(SHAPES[shape](w, h));
  } else {
    frameShape = new THREE.Shape();
    frameShape.moveTo(-w / 2 - t, -h / 2 - t).lineTo(w / 2 + t, -h / 2 - t).lineTo(w / 2 + t, h / 2 + t).lineTo(-w / 2 - t, h / 2 + t).closePath();
    const hole = new THREE.Path();
    hole.moveTo(-w / 2, -h / 2).lineTo(-w / 2, h / 2).lineTo(w / 2, h / 2).lineTo(w / 2, -h / 2).closePath();
    frameShape.holes.push(hole);
  }
  const frame = new THREE.Mesh(new THREE.ShapeGeometry(frameShape, 8), OUTLINE);
  frame.position.copy(local).addScaledVector(normal, 0.0008);
  frame.quaternion.copy(m.quaternion);
  object.add(frame);
  return frame;
}

function buildOutlet(scene) {
  const g = new THREE.Group();
  const white = mat(0xf2efe6, { roughness: 0.4 });
  const plate = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.115, 0.006, 2, 0.004), white);
  g.add(plate);
  for (const y of [0.026, -0.026]) {
    const face = new THREE.Mesh(new RoundedBoxGeometry(0.034, 0.04, 0.006, 2, 0.008), mat(0xe8e4d8, { roughness: 0.35 }));
    face.position.set(0, y, 0.004);
    g.add(face);
    for (const x of [-0.006, 0.006]) {
      const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.0022, 0.009), mat(0x111111));
      slot.position.set(x, y + 0.004, 0.0072);
      g.add(slot);
    }
  }
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.002, 12), mat(0xc8c8c0, { metalness: 0.6 }));
  screw.rotation.x = Math.PI / 2;
  screw.position.z = 0.0045;
  g.add(screw);
  g.position.set(0.24, 0.32, ROOM.minZ + 0.003);
  scene.add(g);
  g.updateMatrixWorld(true);
  return g;
}

// The PS1 end's socket (the station's port and the maze's): w, h and how far out the plug sits.
export const LINK_PS_SOCKET = [0.042, 0.0115, 0.02];

// How far out along normal (±z, in obj's frame) obj's surface comes over a w
// by h patch centred on local's x and y (its outermost point), if it's there.
function surfaceOf(obj, local, w = 0, h = 0, normal = 1) {
  let out = null;
  for (const [dx, dy] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const x = local.x + (dx * w) / 2, y = local.y + (dy * h) / 2;
    const from = obj.localToWorld(new THREE.Vector3(x, y, local.z + 0.2 * normal));
    const dir = obj.localToWorld(new THREE.Vector3(x, y, local.z)).sub(from).normalize();
    const hit = new THREE.Raycaster(from, dir, 0, 0.4).intersectObject(obj, true).find((h) => h.object.visible && !h.object.material?.transparent);
    if (hit) out = Math.max(out ?? -Infinity, obj.worldToLocal(hit.point.clone()).z * normal);
  }
  return out === null ? null : out * normal;
}

// Builds all the cables. `world` comes from buildScene(); the GB's box is
// passed in as a function since it moves.
export function buildCables(scene, world, gbBox) {
  const { gb, station, crt } = world;
  const sim = new CableSim(scene, [...world.colliders, ...world.roomColliders], () => [gbBox()]);
  for (const g of [gb.group, station.group, crt.group]) g.updateMatrixWorld(true);
  const outlet = buildOutlet(scene);
  const Z = new THREE.Vector3(0, 0, 1), X = new THREE.Vector3(1, 0, 0);
  const deskY = DESK_TOP + 0.004;

  // link cable: GB EXT port on its right side -> a port on the front of the GelatoStation
  const gbPort = new THREE.Vector3(GB.half.x, GB.half.y - 0.03, 0);
  // the opening runs the same way as the plug: narrow across the GB's thickness, tall along its side
  sim.addSocket('gb-ext', 'link-gb', gb.group, gbPort.clone().add(new THREE.Vector3(0.02, 0, 0)), X, [0.0055, 0.0115, 0.02]);
  // the left of the two controller ports on its front, at the face of the model there
  // (turned a little outward, to the left, like the console's corner it's in)
  const k = STATION_W / 0.27;   // (these were placed on a 0.27 m station)
  const linkPort = new THREE.Vector3(-0.043 * k, -0.016 * k, 0.095);
  linkPort.z = surfaceOf(station.group, linkPort, LINK_PS_SOCKET[0] + 0.004, LINK_PS_SOCKET[1] + 0.004) ?? linkPort.z;
  const linkDir = Z.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.1);
  sim.addSocket('ps-link', 'link-ps', station.group, linkPort.clone().addScaledVector(linkDir, 0.02), linkDir, LINK_PS_SOCKET);
  const grey = mat(0x9a9aa2);
  const linkGb = sim.addEnd('link-gb', 'link-gb', linkPlug('gb', 0.0047, 0.0107, 0.005, [0.0085, 0.0145, 0.012], grey), 'gb-ext');
  const linkPs = sim.addEnd('link-ps', 'link-ps', linkPlug('ps', 0.039, 0.0098, 0.008, [0.044, 0.015, 0.012], grey), 'ps-link');
  sim.add({
    from: linkGb, to: linkPs, length: 1.1, radius: 0.0026, color: 0x8c8c94, stiffness: 0.08, smooth: 3, edges: true, margin: 0.0015,
    // (its slack round the front of the GB and back past the TV's corner: clear of the Virtualato on the right)
    via: [new THREE.Vector3(0.42, deskY, 0.1), new THREE.Vector3(0.3, deskY, 0.15), new THREE.Vector3(0.12, deskY, 0.1),
      new THREE.Vector3(0.12, deskY, -0.1), new THREE.Vector3(0.22, deskY, -0.18)],
  });

  // AV cable: multi-out on the back of the GelatoStation -> a splitter -> three RCA plugs in the side of the CRT
  // on the back: the AV multi-out right of the middle (seen from the front), the power jack left of it
  const avPort = new THREE.Vector3(0.055 * k, -0.012, -0.095);   // (halfway up its back)
  avPort.z = surfaceOf(station.group, avPort, 0.034, 0.014, -1) ?? avPort.z;
  sim.addSocket('ps-av', 'av', station.group, avPort.clone().add(new THREE.Vector3(0, 0, -0.024)), Z.clone().negate(), [0.03, 0.01, 0.024]);
  const avEnd = sim.addEnd('av', 'av', plug(0.03, 0.011, 0.018), 'ps-av');
  const splitter = new Particle(new THREE.Vector3(0.1, deskY + 0.005, -0.22), 0.007);
  sim.add({
    from: avEnd, to: splitter, length: 1.2, radius: 0.0032, color: 0x1c1c1e, stiffness: 0.1, edges: true, margin: 0.001,
    via: [new THREE.Vector3(0.2, deskY, -0.5), new THREE.Vector3(0.1, deskY, -0.45)],
  });
  [['y', 0xf2d21b], ['w', 0xf4f4f0], ['r', 0xd8252a]].forEach(([c, tip], i) => {
    const jack = CRT.jacks.clone().add(new THREE.Vector3(0, 0.022 - i * 0.022, 0));   // yellow on top
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.004, 16), mat(tip, { roughness: 0.3 }));
    ring.rotation.z = Math.PI / 2;
    ring.position.copy(jack).add(new THREE.Vector3(0.001, 0, 0));
    crt.group.add(ring);
    // the jacks all take any RCA plug (so they can be mixed up)
    sim.addSocket(`crt-${c}`, 'rca', crt.group, jack.clone().add(new THREE.Vector3(0.035, 0, 0)), X);
    const end = sim.addEnd(`rca-${c}`, 'rca', rca(tip), `crt-${c}`);
    sim.add({ from: splitter, to: end, length: 0.24, radius: 0.0022, color: 0x1c1c1e, stiffness: 0.08, edges: true, margin: 0.001 });
  });

  // power cords down the back of the desk to the outlet
  const psPower = new THREE.Vector3(-0.035 * k, -0.012, -0.095);
  psPower.z = surfaceOf(station.group, psPower, 0.014, 0.014, -1) ?? psPower.z;
  sim.addSocket('ps-iec', 'barrel', station.group, psPower.clone().add(new THREE.Vector3(0, 0, -0.026)), Z.clone().negate(), [0.009, 0.009, 0.026]);
  const crtPower = new THREE.Vector3(0.09, -0.08, CRT.back);
  sim.addSocket('crt-cord', 'cord', crt.group, crtPower.clone().add(new THREE.Vector3(0, 0, -0.012)), Z.clone().negate());
  const grommet = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.009, 0.014, 12), BLACK);
  grommet.rotation.x = Math.PI / 2;
  grommet.position.copy(crtPower).add(new THREE.Vector3(0, 0, -0.005));
  crt.group.add(grommet);
  const wallZ = ROOM.minZ + 0.012;
  sim.addSocket('outlet-top', 'mains', outlet, new THREE.Vector3(0, 0.026, 0.036), Z);
  sim.addSocket('outlet-bottom', 'mains', outlet, new THREE.Vector3(0, -0.026, 0.036), Z);
  sim.add({
    from: sim.addEnd('ps-iec', 'barrel', barrel(), 'ps-iec'),
    to: sim.addEnd('ps-mains', 'mains', plug(0.026, 0.03, 0.022), 'outlet-top'),
    length: 1.25, radius: 0.0036, color: 0x161618, stiffness: 0.14, edges: true, margin: 0.001,
    via: [new THREE.Vector3(0.42, deskY, -0.52), new THREE.Vector3(0.36, DESK_TOP + 0.01, wallZ), new THREE.Vector3(0.33, 0.45, wallZ)],
  });
  sim.add({
    from: sim.addEnd('crt-cord', 'cord', new THREE.Group(), 'crt-cord', { fixed: true }),
    to: sim.addEnd('crt-mains', 'mains', plug(0.026, 0.03, 0.022), 'outlet-bottom'),
    length: 1.15, radius: 0.0036, color: 0x161618, stiffness: 0.14,
    via: [new THREE.Vector3(-0.11, DESK_TOP + 0.04, wallZ), new THREE.Vector3(-0.05, 0.5, wallZ), new THREE.Vector3(0.12, 0.25, wallZ)],
  });

  sim.settle();
  return sim;
}

// The GB's collision box, for cables to drape over it.
export function gbBoxFor(group) {
  const box = new OBB();
  return () => {
    group.updateMatrixWorld();
    return box.setFromMatrix(group.matrixWorld, GB.half);
  };
}
