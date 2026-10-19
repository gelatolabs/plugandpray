// The platformer character in 3D: Signsign (assets/character.blend,
// exported to web/public/models/signsign.glb), the same figure the
// GelatoStation draws (ps1/common/gfx.c, gfx_guy), walking and jumping around
// the room once he's left the GelatoBoy in the ending. Like gfx_guy, he's
// posed from code: the model's skeleton is a T-pose.
import * as THREE from 'three';

// (three times the GelatoBoy's little hero: his speed, jump and step scaled with him)
export const GUY_HEIGHT = 0.9;          // metres
export const GUY_RADIUS = 0.15;
const RADIUS = GUY_RADIUS, WALK = 1.8, JUMP = 2.2 * Math.sqrt(3), GRAVITY = 7, STEP = 0.12;
const ARM_DOWN = 1.32;                  // rad: the T-pose's arms lowered to his sides (gfx.c's SIGN_ARM_DOWN)
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const BONES = ['Hips', 'Arm_L', 'Arm_R', 'Elbow_L', 'Elbow_R', 'Knee_L', 'Knee_R', 'Leg_L', 'Leg_R'];

export class Guy {
  // model: the glTF scene (he faces +z, his left is +x, his feet at y = 0)
  constructor(scene, model) {
    this.object = new THREE.Group();
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    model.scale.setScalar(GUY_HEIGHT / (box.max.y - box.min.y));
    model.position.y = -box.min.y * model.scale.y;
    model.traverse((o) => {
      if (!o.isMesh) return;
      // the material comes out of Blender as alpha-blended (its alpha is wired up, though the
      // texture is opaque), and three draws blended things without depth: his back and
      // insides showed through his front. He's solid.
      for (const m of [].concat(o.material)) {
        m.transparent = false; m.depthWrite = true; m.alphaTest = 0;
        // and a little of his own colour as glow, like the GelatoStation's strong ambient light:
        // he stays himself (pink hoodie, black stockings) even in the dim end room
        m.emissive = new THREE.Color(0xffffff);
        m.emissiveMap = m.map;
        m.emissiveIntensity = 0.4;
      }
      o.castShadow = true;
      o.frustumCulled = false;   // a skinned mesh's bounds don't follow the pose
    });
    this.object.add(model);
    // each bone's rest pose: its local rotation and its orientation in the model
    model.updateMatrixWorld(true);
    const inModel = model.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.bones = {};
    for (const name of BONES) {
      const bone = model.getObjectByName(name);
      const world = inModel.clone().multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
      this.bones[name] = { bone, rest: bone.quaternion.clone(), world, inv: world.clone().invert() };
    }
    this.object.visible = false;
    scene.add(this.object);
    this.velocity = new THREE.Vector3();
    this.onGround = false;
    this.phase = 0;
    this.facing = 0;
  }

  // Turns a bone by `q`, a rotation in the model's frame (as if nothing above it were posed;
  // its parents' turns then carry it round with them).
  pose(name, q) {
    const b = this.bones[name];
    b.bone.quaternion.copy(b.rest).multiply(b.inv.clone().multiply(q).multiply(b.world));
  }

  get position() { return this.object.position; }
  get active() { return this.object.visible; }

  spawn(position, facing) {
    this.object.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.facing = facing;
    this.object.rotation.y = facing;
    this.object.visible = true;
    this.onGround = false;
  }

  hide() { this.object.visible = false; }

  // Highest surface (top of a box, or the floor) under him, from OBBs treated as AABBs.
  ground(colliders) {
    const p = this.position;
    let g = -Infinity;
    for (const box of colliders) {
      const b = box.toBox3();
      if (p.x + RADIUS < b.min.x || p.x - RADIUS > b.max.x || p.z + RADIUS < b.min.z || p.z - RADIUS > b.max.z) continue;
      if (b.max.y <= p.y + STEP && b.max.y > g) g = b.max.y;
    }
    return g;
  }

  // input: {x, z} world-space direction (unit or zero), jump.
  update(dt, input, colliders) {
    if (!this.active) return;
    const p = this.position;
    const moving = input.x !== 0 || input.z !== 0;
    if (moving) {
      this.facing = Math.atan2(input.x, input.z);
      p.x += input.x * WALK * dt;
      p.z += input.z * WALK * dt;
    }
    let d = this.facing - this.object.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.object.rotation.y += d * Math.min(1, dt * 12);
    // bump into anything taller than a step
    for (const box of colliders) {
      const b = box.toBox3();
      if (b.max.y <= p.y + STEP || b.min.y >= p.y + GUY_HEIGHT) continue;
      const cx = THREE.MathUtils.clamp(p.x, b.min.x, b.max.x), cz = THREE.MathUtils.clamp(p.z, b.min.z, b.max.z);
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= RADIUS * RADIUS) continue;
      if (d2 > 1e-10) {
        const k = Math.sqrt(d2);
        p.x = cx + (dx / k) * RADIUS;
        p.z = cz + (dz / k) * RADIUS;
      } else {
        const o = [[b.min.x - RADIUS - p.x, 0], [b.max.x + RADIUS - p.x, 0], [0, b.min.z - RADIUS - p.z], [0, b.max.z + RADIUS - p.z]];
        o.sort((a, c) => Math.abs(a[0] + a[1]) - Math.abs(c[0] + c[1]));
        p.x += o[0][0];
        p.z += o[0][1];
      }
    }
    if (input.jump && this.onGround) { this.velocity.y = JUMP; this.onGround = false; }
    const g = this.ground(colliders);
    this.velocity.y -= GRAVITY * dt;
    p.y += this.velocity.y * dt;
    if (p.y <= g) { p.y = g; this.velocity.y = 0; this.onGround = true; } else if (p.y > g + 0.002) this.onGround = false;
    if (p.y < -2) this.velocity.y = 0;   // fell out of the world: stop

    // swing the arms and legs like gfx_guy
    if (moving && this.onGround) this.phase += dt * 9;
    const air = !this.onGround, swing = air ? -0.75 : moving ? Math.sin(this.phase) * 0.9 : 0;
    const rot = (axis, a) => new THREE.Quaternion().setFromAxisAngle(axis, a);
    // legs swing about his left-right axis; the knees bend (shins back) on the way forward, and tuck in the air
    const bend = (s) => (air ? 1.1 : moving ? 0.15 + Math.max(0, -s) * 0.7 : 0);
    this.pose('Knee_L', rot(X, swing));
    this.pose('Knee_R', rot(X, -swing));
    this.pose('Leg_L', rot(X, bend(swing)));
    this.pose('Leg_R', rot(X, bend(-swing)));
    // arms: down from the T-pose, then swinging opposite the legs (up over his head in a jump);
    // the elbows bend forwards a little (about the vertical, as the T-pose's arms point sideways)
    const armL = air ? -2.7 : -swing, armR = air ? -2.7 : swing;
    this.pose('Arm_L', rot(X, armL).multiply(rot(Z, -ARM_DOWN)));
    this.pose('Arm_R', rot(X, armR).multiply(rot(Z, ARM_DOWN)));
    this.pose('Elbow_L', rot(Y, -0.35));
    this.pose('Elbow_R', rot(Y, 0.35));
    this.pose('Hips', rot(X, moving && !air ? 0.08 : 0));
  }
}
