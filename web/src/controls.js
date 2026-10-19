// Renderer setup and the first-person camera (WASD + drag to look), which
// walks into walls rather than through them.
import * as THREE from 'three';
import { ROOM } from './scene.js';

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  container.appendChild(renderer.domElement);
  return renderer;
}

// The walls of the starting room and the desk, as rectangles in the floor
// plane that the camera can't enter. The front wall leaves out `gap` (the
// way into the maze) unless it's null.
export function roomBlockers(gap, desk = true) {
  const { minX, maxX, minZ, maxZ } = ROOM;
  const r = [
    { x0: minX - 1, x1: minX, z0: minZ - 1, z1: maxZ + 0.05 },
    { x0: maxX, x1: maxX + 1, z0: minZ - 1, z1: maxZ + 0.05 },
    { x0: minX - 1, x1: maxX + 1, z0: minZ - 1, z1: minZ },
  ];
  // the desk (0.8 m either side, front edge at z = 0.2): you can get within 10 cm of it
  if (desk) r.push({ x0: -0.7, x1: 0.7, z0: minZ - 1, z1: 0.1 });
  if (gap) {
    r.push({ x0: minX - 1, x1: gap.x0, z0: maxZ - 0.05, z1: maxZ + 0.05 });
    r.push({ x0: gap.x1, x1: maxX + 1, z0: maxZ - 0.05, z1: maxZ + 0.05 });
  } else r.push({ x0: minX - 1, x1: maxX + 1, z0: maxZ - 0.05, z1: maxZ + 0.05 });
  return r;
}

const RADIUS = 0.2;   // how close the camera gets to a wall

// Pushes a point in the floor plane out of rectangles, keeping RADIUS away.
export function pushOut(p, rects, radius = RADIUS) {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const r of rects) {
      const cx = Math.min(Math.max(p.x, r.x0), r.x1), cz = Math.min(Math.max(p.z, r.z0), r.z1);
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      moved = true;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        p.x = cx + (dx / d) * radius;
        p.z = cz + (dz / d) * radius;
      } else {
        // inside: out the nearest side
        const opts = [[r.x0 - radius - p.x, 0], [r.x1 + radius - p.x, 0], [0, r.z0 - radius - p.z], [0, r.z1 + radius - p.z]];
        opts.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
        p.x += opts[0][0];
        p.z += opts[0][1];
      }
    }
    if (!moved) break;
  }
}

export class FirstPerson {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pitch = -0.42;
    this.blockers = () => roomBlockers(null);
    this.velocity = new THREE.Vector3();   // what it moved by last frame (m)
    this.eye = 1.15;   // eye height standing on the floor
    this.vy = 0;       // jumping (Space; just for fun)
    camera.rotation.order = 'YXZ';
    camera.position.set(0.05, 1.15, 0.72);
  }

  look(dx, dy) {
    this.yaw -= dx * 0.004;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.004, -1.4, 1.4);
  }

  // stick: a gamepad's left stick {x, y} (-1..1, y down is backwards), if any
  update(dt, keys, stick = null) {
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const v = new THREE.Vector3();
    if (keys.has('KeyW')) v.add(fwd);
    if (keys.has('KeyS')) v.sub(fwd);
    if (keys.has('KeyD')) v.add(right);
    if (keys.has('KeyA')) v.sub(right);
    if (stick) v.addScaledVector(fwd, -stick.y).addScaledVector(right, stick.x);
    const p = this.camera.position;
    const before = p.clone();
    if (v.lengthSq() > 1e-6) {
      // in steps, so walls can't be skipped over (a half-tilted stick walks slower)
      const step = v.clampLength(0, 1).multiplyScalar(1.3 * dt);
      const n = Math.ceil(step.length() / 0.05);
      step.divideScalar(n);
      const rects = this.blockers();
      for (let i = 0; i < n; i++) {
        p.add(step);
        pushOut(p, rects);
      }
    }
    // Space jumps
    const grounded = p.y <= this.eye + 1e-6;
    if (grounded && keys.has('Space')) this.vy = 3.2;
    if (this.vy !== 0 || !grounded) {
      this.vy -= 9.8 * dt;
      p.y = Math.max(this.eye, p.y + this.vy * dt);
      if (p.y <= this.eye) { if (this.vy < 0) this.landed = -this.vy; this.vy = 0; }   // (landed: how hard, for the lamp's swing)
    }
    this.velocity.subVectors(p, before);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
