// Decides when the GelatoBoy and the CRT are linked, and where things cross
// between them. Everything is judged by what the camera sees: the screens
// are flattened onto the camera's picture ("view space": NDC with x scaled
// by the aspect ratio), so depth doesn't matter. If the screens look like
// they touch they're linked, even when the GB is much closer than the TV,
// and when the GB covers part of the TV picture things can step out of the
// GB into the middle of the TV (and walk back into it).
//
// Screen coordinates are normalised picture coordinates: u 0 (left) .. 1
// (right), v 0 (top) .. 1 (bottom).
import * as THREE from 'three';
import { GB, CRT } from './scene.js';
import { DIR } from './link.js';

const SIDE = (GB.half.x - GB.screenHalf.x) / (2 * GB.screenHalf.x);
// The GB's body around its screen, in GB screen coordinates.
export const BODY = {
  u0: -SIDE,
  u1: 1 + SIDE,
  v0: -(GB.half.y - GB.screenCenter.y - GB.screenHalf.y) / (2 * GB.screenHalf.y),
  v1: 1 + (GB.half.y + GB.screenCenter.y - GB.screenHalf.y) / (2 * GB.screenHalf.y),
};
const ASPECT = GB.screenHalf.y / GB.screenHalf.x;   // GB v units -> GB screen widths
const TOL = 0.3;     // how far apart the screens may look and still link, in GB screen widths
const EPS = 0.002;
const FLIGHT = 8, FLIGHT_STEP = 0.01;   // how far (view units) projectiles are followed between screens

// CRT barrel distortion, matching the screen shader: glass uv -> picture uv.
export function crtCurve(u, v) {
  let x = u * 2 - 1, y = v * 2 - 1;
  const ox = Math.abs(y) / 6.0, oy = Math.abs(x) / 4.8;
  x += x * ox * ox;
  y += y * oy * oy;
  return [x * 0.5 + 0.5, y * 0.5 + 0.5];
}

// Picture uv -> glass uv.
export function crtUncurve(u, v) {
  let gu = u, gv = v;
  for (let i = 0; i < 8; i++) {
    const [cu, cv] = crtCurve(gu, gv);
    gu += u - cu;
    gv += v - cv;
  }
  return [gu, gv];
}

export const inside = (q) => q.u >= 0 && q.u <= 1 && q.v >= 0 && q.v <= 1;
const clamp01 = (q) => ({ u: Math.min(1, Math.max(0, q.u)), v: Math.min(1, Math.max(0, q.v)) });

// The geometry, given a way to put screen points into view space and back.
// Subclasses provide toView(which, u, v) -> {x, y}, fromView(which, p) -> {u, v}
// ('gb' or 'crt'), usable() and worldPoint(which, u, v).
export class ScreenLink {
  constructor() {
    this.linked = false;
    this.enabled = true;   // the link cable joins the GB and the GelatoStation
  }

  update() {
    this.linked = false;
    if (!this.enabled || !this.usable()) return;
    // the CRT picture as seen from the GB
    const c = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => this.map('crt', 'gb', u, v));
    const tv = TOL / ASPECT;
    this.linked = Math.min(...c.map((q) => q.u)) <= BODY.u1 + TOL && Math.max(...c.map((q) => q.u)) >= BODY.u0 - TOL
      && Math.min(...c.map((q) => q.v)) <= BODY.v1 + tv && Math.max(...c.map((q) => q.v)) >= BODY.v0 - tv;
  }

  map(from, to, u, v) { return this.fromView(to, this.toView(from, u, v)); }

  // Is a point (in GB coordinates) over the GB's body?
  inBody(g, tol = 0) {
    const tv = tol / ASPECT;
    return g.u >= BODY.u0 - tol && g.u <= BODY.u1 + tol && g.v >= BODY.v0 - tv && g.v <= BODY.v1 + tv;
  }

  // Where something leaving screen `from` through edge `dir` (u matters for
  // the top/bottom edges, v for left/right) arrives on the other screen, or null.
  exit(from, dir, u, v) {
    if (!this.linked) return null;
    if (from === 'gb') {
      // come out beside the GelatoBoy's body, not hidden behind it
      if (dir === DIR.LEFT) u = BODY.u0 - EPS;
      else if (dir === DIR.RIGHT) u = BODY.u1 + EPS;
      else if (dir === DIR.UP) v = BODY.v0 - EPS;
      else v = BODY.v1 + EPS;
      const q = this.map('gb', 'crt', u, v);
      if (inside(q)) return q;
      // a small gap between the GB and the picture is fine
      const c = clamp01(q);
      const back = this.map('crt', 'gb', c.u, c.v);
      return Math.abs(back.u - u) <= TOL && Math.abs(back.v - v) * ASPECT <= TOL ? c : null;
    }
    if (dir === DIR.LEFT) u = -EPS;
    else if (dir === DIR.RIGHT) u = 1 + EPS;
    else if (dir === DIR.UP) v = -EPS;
    else v = 1 + EPS;
    const g = this.map('crt', 'gb', u, v);
    return this.inBody(g, TOL) ? clamp01(g) : null;
  }

  // Is a point (in GB coordinates) where walking or jumping onto the GB from
  // the TV takes you in? Its screen and the bezel around it, but not the part
  // of the body below the screen.
  inEntry(g) {
    return g.u >= BODY.u0 && g.u <= BODY.u1 && g.v >= BODY.v0 && g.v <= 1;
  }

  // Something flying out of screen `from` through its left or right edge at
  // height v carries on in a straight line across the camera's view, however
  // big the gap: where it hits the other screen, as {u, v, gap, width} (gap:
  // how far it flew in between and width: the width of screen `from`, both in
  // view units), or null if it misses.
  fly(from, dir, v) {
    if (!this.enabled || !this.usable()) return null;
    const to = from === 'gb' ? 'crt' : 'gb', right = dir === DIR.RIGHT;
    // out from beside the GB's body (not behind it), or from the edge of the TV picture
    const u = from === 'gb' ? (right ? BODY.u1 + EPS : BODY.u0 - EPS) : (right ? 1 + EPS : -EPS);
    const a = this.toView(from, u, v), b = this.toView(from, u + (right ? 0.1 : -0.1), v);
    const l0 = this.toView(from, 0, v), l1 = this.toView(from, 1, v);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > 1e-9)) return null;
    const dx = (b.x - a.x) / len, dy = (b.y - a.y) / len;
    for (let s = 0; s <= FLIGHT; s += FLIGHT_STEP) {
      const q = this.fromView(to, { x: a.x + dx * s, y: a.y + dy * s });
      if (inside(q)) return { ...q, gap: s, width: Math.hypot(l1.x - l0.x, l1.y - l0.y) };
    }
    return null;
  }

  // Something on the CRT moved into the GB's entry area (now at GB coordinates g,
  // last frame at prev): where it comes in on the GB screen.
  entry(g, prev) {
    const e = clamp01(g);
    if (inside(g) && prev) {
      // it skipped over the bezel in one step: use the edge it came through
      if (prev.u < 0) e.u = 0;
      else if (prev.u > 1) e.u = 1;
      else if (prev.v < 0) e.v = 0;
      else if (prev.v > 1) e.v = 1;
    }
    return e;
  }

  // The part of the CRT picture where things go into the GB (see inEntry;
  // bounding box in CRT coordinates), or null.
  entryOnCrt() {
    if (!this.linked) return null;
    const c = [[BODY.u0, BODY.v0], [BODY.u1, BODY.v0], [BODY.u0, 1], [BODY.u1, 1]]
      .map(([u, v]) => this.map('gb', 'crt', u, v));
    const r = {
      u0: Math.max(0, Math.min(...c.map((q) => q.u))), u1: Math.min(1, Math.max(...c.map((q) => q.u))),
      v0: Math.max(0, Math.min(...c.map((q) => q.v))), v1: Math.min(1, Math.max(...c.map((q) => q.v))),
    };
    return r.u0 < r.u1 && r.v0 < r.v1 ? r : null;
  }
}

// The real thing: the screens in the 3D room, seen through the camera.
export class LinkGeometry extends ScreenLink {
  constructor(gbGroup, crtGroup, camera) {
    super();
    this.gb = gbGroup;
    this.crt = crtGroup;
    this.camera = camera;
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane();
  }

  update() {
    this.gb.updateMatrixWorld();
    this.crt.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    super.update();
  }

  localPoint(which, u, v) {
    if (which === 'gb') {
      return new THREE.Vector3(GB.screenCenter.x + (u * 2 - 1) * GB.screenHalf.x,
        GB.screenCenter.y + (1 - v * 2) * GB.screenHalf.y, GB.screenCenter.z + 0.0006);
    }
    const [gu, gv] = crtUncurve(u, v);
    const x = gu * 2 - 1, y = 1 - gv * 2;
    return new THREE.Vector3(CRT.screenCenter.x + x * CRT.screenHalf.x, CRT.screenCenter.y + y * CRT.screenHalf.y,
      CRT.screenCenter.z + 0.012 * (1 - 0.5 * (x * x + y * y)));
  }

  group(which) { return which === 'gb' ? this.gb : this.crt; }

  worldPoint(which, u, v) {
    return this.localPoint(which, u, v).applyMatrix4(this.group(which).matrixWorld);
  }

  // The same as worldPoint, under the name the browser tests use.
  screenPoint(which, u, v) { return this.worldPoint(which, u, v); }

  toView(which, u, v) {
    const p = this.worldPoint(which, u, v).project(this.camera);
    return { x: p.x * this.camera.aspect, y: p.y };
  }

  fromView(which, p) {
    const g = this.group(which);
    this.ray.setFromCamera(new THREE.Vector2(p.x / this.camera.aspect, p.y), this.camera);
    const normal = new THREE.Vector3().setFromMatrixColumn(g.matrixWorld, 2).normalize();
    const local = new THREE.Vector3();
    let z = which === 'gb' ? GB.screenCenter.z + 0.0006 : CRT.screenCenter.z + 0.012;
    // the CRT glass bulges: refine the plane depth a couple of times
    for (let i = 0; i < (which === 'gb' ? 1 : 3); i++) {
      const on = new THREE.Vector3(0, 0, z).applyMatrix4(g.matrixWorld);
      this.plane.setFromNormalAndCoplanarPoint(normal, on);
      const hit = this.ray.ray.intersectPlane(this.plane, new THREE.Vector3());
      if (!hit) return { u: -99, v: -99 };
      local.copy(g.worldToLocal(hit));
      if (which === 'crt') {
        const x = (local.x - CRT.screenCenter.x) / CRT.screenHalf.x, y = (local.y - CRT.screenCenter.y) / CRT.screenHalf.y;
        z = CRT.screenCenter.z + 0.012 * (1 - 0.5 * Math.min(2, x * x + y * y));
      }
    }
    if (which === 'gb') {
      return { u: ((local.x - GB.screenCenter.x) / GB.screenHalf.x + 1) / 2, v: (1 - (local.y - GB.screenCenter.y) / GB.screenHalf.y) / 2 };
    }
    const gu = ((local.x - CRT.screenCenter.x) / CRT.screenHalf.x + 1) / 2;
    const gv = (1 - (local.y - CRT.screenCenter.y) / CRT.screenHalf.y) / 2;
    const [u, v] = crtCurve(gu, gv);
    return { u, v };
  }

  // Both screens face the camera, and the GB isn't behind the TV.
  usable() {
    const cam = this.camera.getWorldPosition(new THREE.Vector3());
    const fwd = this.camera.getWorldDirection(new THREE.Vector3());
    const depth = {};
    for (const which of ['gb', 'crt']) {
      const g = this.group(which);
      const c = this.worldPoint(which, 0.5, 0.5);
      const n = new THREE.Vector3().setFromMatrixColumn(g.matrixWorld, 2).normalize();
      if (n.dot(cam.clone().sub(c).normalize()) < 0.3) return false;
      depth[which] = c.sub(cam).dot(fwd);
    }
    return depth.gb < depth.crt;
  }
}

// A flat stand-in for tests: the CRT picture fills view x 0..4, y 0..3 (y
// down) and the GB screen is the rectangle {x, y, w} (or null: not linked).
export class FlatLink extends ScreenLink {
  constructor(gb = null) {
    super();
    this.gb = gb;
    this.update();
  }

  place(gb) { this.gb = gb; this.update(); }

  toView(which, u, v) {
    if (which === 'crt') return { x: u * 4, y: v * 3 };
    const h = this.gb.w * ASPECT;
    return { x: this.gb.x + u * this.gb.w, y: this.gb.y + v * h };
  }

  fromView(which, p) {
    if (which === 'crt') return { u: p.x / 4, v: p.y / 3 };
    const h = this.gb.w * ASPECT;
    return { u: (p.x - this.gb.x) / this.gb.w, v: (p.y - this.gb.y) / h };
  }

  usable() { return !!this.gb; }
  worldPoint() { return new THREE.Vector3(); }
  screenPoint() { return new THREE.Vector3(); }
}
