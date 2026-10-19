// Short-lived particle bursts (media going in and out, the Virtualato flying out of the TV).
import * as THREE from 'three';

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
  }

  burst(position, color, count = 40, size = 0.004, speed = 0.25) {
    const pos = new Float32Array(count * 3);
    const vel = [];
    for (let i = 0; i < count; i++) {
      pos.set([position.x, position.y, position.z], i * 3);
      vel.push(new THREE.Vector3().randomDirection().multiplyScalar(speed * (0.3 + Math.random())));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color, size, transparent: true, depthWrite: false });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.items.push({
      obj: points, life: 0.6, age: 0,
      update: (dt, t) => {
        const a = geo.attributes.position;
        for (let i = 0; i < count; i++) {
          vel[i].y -= dt * 0.4;
          a.setXYZ(i, a.getX(i) + vel[i].x * dt, a.getY(i) + vel[i].y * dt, a.getZ(i) + vel[i].z * dt);
        }
        a.needsUpdate = true;
        mat.opacity = 1 - t;
      },
    });
  }

  update(dt) {
    this.items = this.items.filter((it) => {
      it.age += dt;
      const t = Math.min(1, it.age / it.life);
      it.update(dt, t);
      if (t >= 1) {
        this.scene.remove(it.obj);
        if (it.extra) this.scene.remove(it.extra);
        return false;
      }
      return true;
    });
  }
}
