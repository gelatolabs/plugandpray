// Host logic for the YOU WIN! cartridge (you get it for plugging the GB into
// the port at the end of the maze). The GB runs "You escaped reality!" and the credits; its
// character can walk off either side of the screen into the room, where he's
// the 3D figure (arrows walk, Z jumps), and back into the GB by walking into it.
import * as THREE from 'three';
import { MSG, DIR } from '../link.js';
import { GB } from '../scene.js';
import { GUY_HEIGHT, GUY_RADIUS } from '../guy.js';

const C = { EXIT_L: 2, EXIT_R: 4, EXIT_T: 6, EXIT_B: 8 };
const ST = { PRESENT: 1 };

export class Ending {
  constructor(app) {
    this.app = app;
    this.guy = app.guy;
    this.armed = false;   // he has to step away from the GB before he can walk back in
  }


  onMessage(from, msg) {
    if (from !== 'gb' || msg[0] !== MSG.EXIT) return;
    const [, dir] = msg;
    if (dir !== DIR.LEFT && dir !== DIR.RIGHT) return;
    // out of the GB's side, at the bottom of its screen; he falls from there
    const g = this.app.world.gb.group;
    const side = dir === DIR.LEFT ? -1 : 1;
    const at = new THREE.Vector3(side * (GB.half.x + GUY_RADIUS + 0.01), GB.screenCenter.y - GB.screenHalf.y, 0.02).applyMatrix4(g.matrixWorld);
    const out = new THREE.Vector3(side, 0, 0).transformDirection(g.matrixWorld);
    this.guy.spawn(at, Math.atan2(out.x, out.z));
    this.guy.velocity.set(out.x * 0.4, 0.6, out.z * 0.4);
    this.armed = false;
  }

  // Walking (or jumping) into the GB takes him back in.
  update(dt) {
    const app = this.app, gb = app.gb, link = gb.link;
    if (gb.ready) {
      // both sides of the screen lead out into the room
      for (const [k, v] of [[C.EXIT_L, 0x1ff], [C.EXIT_R, 0x1ff], [C.EXIT_T, 0], [C.EXIT_B, 0]]) {
        link.setCtrl(k, v & 0xff);
        link.setCtrl(k + 1, v >> 8);
      }
    }
    const guy = this.guy;
    if (!guy.active) return;
    const { yaw } = app.view();
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const v = new THREE.Vector3();
    if (app.held.has('ArrowUp')) v.add(fwd);
    if (app.held.has('ArrowDown')) v.sub(fwd);
    if (app.held.has('ArrowRight')) v.add(right);
    if (app.held.has('ArrowLeft')) v.sub(right);
    if (v.lengthSq()) v.normalize();
    guy.update(dt, { x: v.x, z: v.z, jump: app.pressed.has('KeyZ') }, app.solid);

    const g = app.world.gb.group;
    // any part of him, feet to head, up against the GB (where, in the GB's own space)
    const near = [0.05, 0.25, 0.45, 0.65, 0.85].map((f) => g.worldToLocal(guy.position.clone().add(new THREE.Vector3(0, f * GUY_HEIGHT, 0))))
      .find((local) => Math.abs(local.x) < GB.half.x + GUY_RADIUS * 0.8 && Math.abs(local.z) < 0.1 + GUY_RADIUS
        && local.y > -GB.half.y - 0.05 && local.y < GB.half.y);
    if (!near && guy.position.distanceTo(g.position) > 0.2 + GUY_RADIUS) this.armed = true;
    if (this.armed && near && gb.ready && !link.state(ST.PRESENT)) {
      const fromLeft = near.x < 0;
      link.send(MSG.ENTER, fromLeft ? 6 : 154, 128, 0, fromLeft ? 0 : 1, 8);
      guy.hide();
    }
  }

  dispose() { this.guy.hide(); }

  status() {
    return this.app.escaped ? 'YOU ESCAPED REALITY! · Unplug the link cable to go back to normal' : 'YOU WIN!';
  }

  help() {
    return '←/→ walk · Z jump · walk off the side of the GelatoBoy into the room; in the room the arrows walk him around';
  }
}
