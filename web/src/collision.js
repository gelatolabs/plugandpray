// Oriented-box collision via the separating axis theorem.
import * as THREE from 'three';

export class OBB {
  constructor(center = new THREE.Vector3(), half = new THREE.Vector3(), axes = null) {
    this.center = center;
    this.half = half;
    this.axes = axes ?? [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  }

  static fromBox3(box) {
    return new OBB(box.getCenter(new THREE.Vector3()), box.getSize(new THREE.Vector3()).multiplyScalar(0.5));
  }

  // Box of half-size `half` centred at `offset` in the local space of `matrix`.
  setFromMatrix(matrix, half, offset = new THREE.Vector3()) {
    const e = matrix.elements;
    this.axes[0].set(e[0], e[1], e[2]).normalize();
    this.axes[1].set(e[4], e[5], e[6]).normalize();
    this.axes[2].set(e[8], e[9], e[10]).normalize();
    this.center.copy(offset).applyMatrix4(matrix);
    this.half.copy(half);
    return this;
  }

  // Radius of the box projected onto unit axis L.
  project(L) {
    return Math.abs(this.axes[0].dot(L)) * this.half.x
      + Math.abs(this.axes[1].dot(L)) * this.half.y
      + Math.abs(this.axes[2].dot(L)) * this.half.z;
  }

  toBox3(target = new THREE.Box3()) {
    const ext = new THREE.Vector3(
      this.project(new THREE.Vector3(1, 0, 0)),
      this.project(new THREE.Vector3(0, 1, 0)),
      this.project(new THREE.Vector3(0, 0, 1)),
    );
    return target.set(this.center.clone().sub(ext), this.center.clone().add(ext));
  }
}

const _axes = Array.from({ length: 15 }, () => new THREE.Vector3());
const _d = new THREE.Vector3();

// Returns the minimum translation that pushes `a` out of `b`, or null if they don't overlap.
export function separate(a, b) {
  let n = 0;
  for (let i = 0; i < 3; i++) _axes[n++].copy(a.axes[i]);
  for (let i = 0; i < 3; i++) _axes[n++].copy(b.axes[i]);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const c = _axes[n].crossVectors(a.axes[i], b.axes[j]);
      if (c.lengthSq() > 1e-8) { c.normalize(); n++; }
    }
  }
  _d.subVectors(b.center, a.center);
  let best = Infinity, bestAxis = null, bestSign = 1;
  for (let k = 0; k < n; k++) {
    const L = _axes[k];
    const dist = _d.dot(L);
    const overlap = a.project(L) + b.project(L) - Math.abs(dist);
    if (overlap <= 0) return null;
    if (overlap < best) { best = overlap; bestAxis = L; bestSign = dist > 0 ? -1 : 1; }
  }
  return bestAxis.clone().multiplyScalar(best * bestSign);
}
