// Picking up and carrying things (the GelatoBoy, cartridges, discs) with the
// mouse. While held an object turns to face the camera and follows the cursor
// at a fixed distance; it is swept in small steps and pushed out of solid
// boxes so it can't pass through them. When released it stays where it is
// (the caller decides whether it then falls).
import * as THREE from 'three';
import { OBB, separate } from './collision.js';

const MAX_SPEED = 2.5;   // m/s the GB can travel towards the cursor
const TURN_SPEED = 7;    // rad/s
const SPIN_TIME = 1.4;   // s for a pickup twirl (spin())
const SUBSTEP = 0.004;   // max sweep step (m)
const MIN_DIST = 0.22, MAX_DIST = 0.9, LIFT_DIST = 0.42;

export class Dragger {
  // camera: where you're looking from (it turns to face it); aim: what points
  // at it (the camera itself, or a VR controller)
  constructor(object, camera, colliders, half, liftDist = LIFT_DIST, aim = camera) {
    this.gb = object;
    this.half = half;
    this.liftDist = liftDist;
    this.camera = camera;
    this.aim = aim;
    this.colliders = colliders;
    this.obb = new OBB();
    this.dragging = false;
    this.distance = liftDist;
    this.target = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.turns = 0;
  }

  // Picked up, it also twirls round this many times (about the view's vertical, showing its back).
  spin(turns) { this.turns = turns; }

  // Returns true if the pointer (NDC) is over the GB.
  hits(ndc) {
    this.raycaster.setFromCamera(ndc, this.aim);
    return this.raycaster.intersectObject(this.gb, true).length > 0;
  }

  start(ndc) {
    this.dragging = true;
    const d = new THREE.Vector3().setFromMatrixPosition(this.aim.matrixWorld).distanceTo(this.gb.position);
    this.distance = THREE.MathUtils.clamp(Math.min(d, this.liftDist), MIN_DIST, MAX_DIST);
    this.face = this.gb.quaternion.clone();   // where it's turning to face the camera, before the spin
    this.spinT = this.turns ? 0 : SPIN_TIME;
    this.move(ndc);
  }

  move(ndc) {
    this.pointer.copy(ndc);
  }

  wheel(delta) {
    this.distance = THREE.MathUtils.clamp(this.distance + delta, MIN_DIST, MAX_DIST);
  }

  end() { this.dragging = false; }

  updateObb() {
    this.gb.updateMatrixWorld();
    return this.obb.setFromMatrix(this.gb.matrixWorld, this.half);
  }

  // Pushes the GB out of every collider (near enough to matter); returns the
  // total correction applied.
  resolve() {
    const total = new THREE.Vector3();
    const colliders = this.nearby ?? this.colliders;
    for (let iter = 0; iter < 6; iter++) {
      let moved = false;
      for (const c of colliders) {
        const mtv = separate(this.updateObb(), c);
        if (mtv) {
          mtv.multiplyScalar(1.0001).addScaledVector(mtv.clone().normalize(), 1e-5);
          this.gb.position.add(mtv);
          total.add(mtv);
          moved = true;
        }
      }
      if (!moved) break;
    }
    return total;
  }

  penetrating() {
    this.updateObb();
    return this.colliders.some((c) => separate(this.obb, c));
  }

  update(dt) {
    if (!this.dragging) return;
    // face the camera
    const m = new THREE.Matrix4().lookAt(this.camera.getWorldPosition(new THREE.Vector3()), this.gb.position, this.camera.up);
    const want = new THREE.Quaternion().setFromRotationMatrix(m);
    this.face.rotateTowards(want, TURN_SPEED * dt);
    this.gb.quaternion.copy(this.face);
    if (this.spinT < SPIN_TIME) {
      // what's left of `turns` full turns twirling about your view's vertical,
      // like a coin spun on its edge (its back comes round), slowing to a stop facing you
      this.spinT = Math.min(SPIN_TIME, this.spinT + dt);
      const e = 1 - (1 - this.spinT / SPIN_TIME) ** 3, a = (1 - e) * Math.PI * 2 * this.turns;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
      this.gb.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(up, a));
    }
    this.resolve();

    // follow the cursor
    this.raycaster.setFromCamera(this.pointer, this.aim);
    this.target.copy(this.raycaster.ray.origin).addScaledVector(this.raycaster.ray.direction, this.distance);
    const delta = this.target.clone().sub(this.gb.position);
    const maxMove = MAX_SPEED * dt;
    if (delta.length() > maxMove) delta.setLength(maxMove);
    // only boxes it could reach this frame
    const reach = this.half.length() + delta.length() + 0.05;
    this.nearby = this.colliders.filter((c) => c.center.distanceTo(this.gb.position) <= reach + (c.reach ?? (c.reach = c.half.length())));
    const steps = Math.max(1, Math.ceil(delta.length() / SUBSTEP));
    delta.divideScalar(steps);
    for (let i = 0; i < steps; i++) {
      this.gb.position.add(delta);
      this.resolve();
    }
    this.nearby = null;
  }
}
