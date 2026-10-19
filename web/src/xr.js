// WebXR (VR headsets). A button in the top right enters VR. Your head moves
// the view; tracked controllers point (a ray from each). Without them (Vision
// Pro hands web pages its controllers only as gamepads), you point with your
// head (a ring in the middle of the view) or by gaze and pinch:
//   trigger  = the left mouse button (click: pick up, use)
//   grip     = right-click (drop, put away, take off)
//   left stick + A/B/X/Y = the consoles (there's no Start)
//   right stick = walk (walls still stop you)
// A regular gamepad works too, laid out like the controllers (see Gamepads.vrPad).
import * as THREE from 'three';
import { pushOut } from './controls.js';

const STICK = 0.5;   // how far a thumbstick has to go to count as a d-pad press
const TURN_SPEED = 2.2;   // rad/s turning on a stick at full tilt (wearing the Virtualato)

// What the XR controllers' gamepads (xr-standard mapping) do this frame:
// {keys: Set of key codes, move: {x, y}, turn}. Wearing the Virtualato (vb),
// the left stick walks and the right one turns instead. Exported for tests.
export function xrInput(sources, vb = false) {
  const keys = new Set(), move = { x: 0, y: 0 };
  let turn = 0;
  for (const s of sources) {
    const gp = s.gamepad;
    if (!gp) continue;
    const ax = gp.axes[2] ?? 0, ay = gp.axes[3] ?? 0;
    const down = (i) => !!gp.buttons[i]?.pressed;
    if (down(4)) keys.add('KeyZ');   // A / X
    if (down(5)) keys.add('KeyX');   // B / Y
    if (vb) {
      if (s.handedness === 'left') { move.x += Math.abs(ax) > 0.15 ? ax : 0; move.y += Math.abs(ay) > 0.15 ? ay : 0; }
      else turn += Math.abs(ax) > 0.15 ? ax : 0;
    } else if (s.handedness === 'left') {
      if (ay < -STICK) keys.add('ArrowUp');
      if (ay > STICK) keys.add('ArrowDown');
      if (ax < -STICK) keys.add('ArrowLeft');
      if (ax > STICK) keys.add('ArrowRight');
    } else {
      move.x += Math.abs(ax) > 0.15 ? ax : 0;
      move.y += Math.abs(ay) > 0.15 ? ay : 0;
    }
  }
  return { keys, move, turn };
}

// A pointer in a controller's hand: a short handle and a ray.
function controllerModel() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.1), new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.6 }));
  body.position.z = 0.04;
  g.add(body);
  const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.6 }));
  ray.scale.z = 3;
  g.add(ray);
  return g;
}

export class XR {
  constructor(app) {
    this.app = app;
    const r = this.renderer = app.renderer;
    r.xr.enabled = true;
    r.xr.setReferenceSpaceType('local-floor');
    this.rig = new THREE.Group();   // moves you around; the headset moves the camera inside it
    app.scene.add(this.rig);
    this.presenting = false;
    this.active = null;             // the controller that last pulled its trigger
    this.controllers = [0, 1].map((i) => {
      const c = r.xr.getController(i);
      c.add(controllerModel());
      c.visible = false;
      // (a gaze-and-pinch pointer, as on Vision Pro, is used but not drawn: there's nothing in your hand to draw)
      c.addEventListener('connected', (e) => {
        c.userData.source = e.data;
        c.visible = !!e.data.targetRaySpace;
        c.children[0].visible = e.data.targetRayMode === 'tracked-pointer';
      });
      c.addEventListener('disconnected', () => { c.userData.source = null; c.visible = false; });
      c.addEventListener('selectstart', () => { this.active = c; this.syncAim(); app.click(); });
      c.addEventListener('squeezestart', () => { this.active = c; this.syncAim(); app.rightClick(); });
      this.rig.add(c);
      return c;
    });
    this.keys = new Set();
    this.buildButton();
    // where gamepad triggers aim when there's no controller to point with (the
    // middle of your view): a little ring a metre ahead
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.004, 0.007, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false }));
    this.reticle.position.z = -1;
    this.reticle.renderOrder = 999;
    this.reticle.visible = false;
    app.camera.add(this.reticle);
    // the tooltips under it: what the trigger does, and the right-click action
    const tc = document.createElement('canvas');
    tc.width = 1024;
    tc.height = 160;
    this.tip = { canvas: tc, g: tc.getContext('2d'), texture: new THREE.CanvasTexture(tc), text: null };
    this.tip.texture.colorSpace = THREE.SRGBColorSpace;
    this.tip.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.05), new THREE.MeshBasicMaterial({ map: this.tip.texture, transparent: true, depthTest: false }));
    this.tip.mesh.position.set(0, -0.045, -1);
    this.tip.mesh.renderOrder = 999;
    this.tip.mesh.visible = false;
    this.tip.mesh.raycast = () => {};
    app.camera.add(this.tip.mesh);
    // ?xrdebug: a panel in front of you in VR listing what the controllers send
    if (new URLSearchParams(location.search).has('xrdebug')) this.buildDebug();
  }

  buildDebug() {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 640;
    this.debug = { canvas: c, g: c.getContext('2d'), texture: new THREE.CanvasTexture(c), tick: 0 };
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.4), new THREE.MeshBasicMaterial({ map: this.debug.texture, transparent: true, depthTest: false }));
    panel.position.set(0, -0.08, -0.8);
    panel.renderOrder = 999;
    panel.visible = false;
    this.debug.panel = panel;
    this.app.camera.add(panel);
  }

  // The debug panel's text: every gamepad (id, layout, pressed buttons, sticks)
  // and every XR input source (hand, ray, profiles, its gamepad's buttons).
  updateDebug(session) {
    const d = this.debug;
    d.panel.visible = this.presenting;
    if (!this.presenting || d.tick++ % 6) return;
    const r = (v) => v.toFixed(2);
    const pressed = (gp) => gp.buttons.map((b, i) => (b.pressed || b.value > 0.5 ? i : null)).filter((i) => i !== null).join(',') || '-';
    const lines = ['GAMEPADS'];
    for (const p of navigator.getGamepads?.() ?? []) {
      if (!p) continue;
      lines.push(`#${p.index} ${p.id.slice(0, 48)}`, `   mapping=${p.mapping || '(none)'} buttons ${pressed(p)}  axes ${p.axes.map(r).join(' ')}`);
    }
    lines.push('', 'XR INPUT SOURCES');
    for (const s of session ? [...session.inputSources] : []) {
      lines.push(`${s.handedness} ${s.targetRayMode} [${(s.profiles ?? []).join(', ').slice(0, 50)}]`,
        `   gamepad: ${s.gamepad ? `${s.gamepad.mapping} buttons ${pressed(s.gamepad)} axes ${s.gamepad.axes.map(r).join(' ')}` : 'none'}`);
    }
    const { canvas: c, g } = d;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(0, 0, 0, 0.75)';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#7dff7d';
    g.font = '26px monospace';
    lines.slice(0, 22).forEach((l, i) => g.fillText(l, 16, 34 + i * 28));
    d.texture.needsUpdate = true;
  }

  // The 2D "Enter VR" button, if the browser can do it.
  async buildButton() {
    const ok = await navigator.xr?.isSessionSupported?.('immersive-vr').catch(() => false);
    if (!ok) return;
    const b = this.button = document.createElement('button');
    b.id = 'vr-button';
    b.textContent = 'Enter VR';
    b.addEventListener('click', () => this.start());
    document.getElementById('corner').appendChild(b);
  }

  async start() {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    session.addEventListener('end', () => this.stop());
    const app = this.app, cam = app.camera;
    // stand where the desktop camera was, facing the same way; the headset adds your height
    this.rig.position.set(cam.position.x, 0, cam.position.z);
    this.rig.rotation.set(0, app.fp.yaw, 0);
    this.rig.add(cam);
    cam.position.set(0, 0, 0);
    cam.rotation.set(0, 0, 0);
    await this.renderer.xr.setSession(session);
    this.presenting = true;
    app.items.xr = true;
    if (this.button) this.button.hidden = true;   // (the browser has its own way out)
  }

  stop() {
    const app = this.app, cam = app.camera;
    const head = app.head(), { yaw } = app.view();
    app.scene.add(cam);
    cam.position.set(head.x, app.fp.eye, head.z);
    app.fp.yaw = yaw;
    app.fp.pitch = 0;
    this.presenting = false;
    app.items.xr = false;
    this.active = null;
    if (this.debug) this.debug.panel.visible = false;
    this.reticle.visible = false;
    this.tip.mesh.visible = false;
    if (this.button) this.button.hidden = false;
  }

  // The tooltips in VR (the page's own are on the flat screen): label is what
  // the trigger does now, right what right-click does (the grip, or a gamepad's left trigger).
  setHints(label, right) {
    const t = this.tip, second = right ? `${this.tracked() ? 'Grip' : 'Left trigger'}: ${right}` : '';
    t.mesh.visible = this.presenting && !!(label || second);
    const text = `${label}|${second}`;
    if (!t.mesh.visible || text === t.text) return;
    t.text = text;
    const { canvas: c, g } = t;
    g.clearRect(0, 0, c.width, c.height);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const line = (s, y, size, color) => {
      if (!s) return;
      g.font = `600 ${size}px sans-serif`;
      const w = g.measureText(s).width + size;
      g.fillStyle = 'rgba(16, 16, 24, 0.6)';
      g.fillRect((c.width - w) / 2, y - size * 0.75, w, size * 1.5);
      g.fillStyle = color;
      g.fillText(s, c.width / 2, y);
    };
    line(label, 44, 48, '#ffffff');
    line(second, 120, 38, '#fff8e8');
    t.texture.needsUpdate = true;
  }

  // Whether there are tracked controllers (with a pose and a ray: Quest's, say).
  tracked() {
    return this.controllers.some((c) => c.visible && c.userData.source?.targetRayMode === 'tracked-pointer');
  }

  // The pointer follows the controller that last pulled its trigger (or the right one).
  syncAim() {
    const c = this.active?.visible ? this.active
      : this.controllers.find((k) => k.visible && k.userData.source?.handedness === 'right') ?? this.controllers.find((k) => k.visible);
    if (!c) return false;
    c.updateMatrixWorld(true);
    this.app.aim.matrixWorld.copy(c.matrixWorld);
    this.app.aim.matrixWorldInverse.copy(c.matrixWorld).invert();
    return true;
  }

  // Each frame in VR: buttons for the consoles, walking, and the pointer.
  update(dt) {
    this.keys = new Set();
    if (!this.presenting) return;
    const session = this.renderer.xr.getSession();
    if (this.debug) this.updateDebug(session);
    this.reticle.visible = !this.tracked();
    const vb = this.app.vb.worn;
    const { keys, move, turn } = xrInput(session ? [...session.inputSources] : [], vb);
    this.keys = keys;
    if (turn) this.turn(-turn * TURN_SPEED * dt);
    // a gamepad (in VR it's laid out like the controllers: its right stick walks)
    const pad = this.app.pads.move;
    this.walk(dt, move.x + pad.x, move.y + pad.y);
    return true;
  }

  walk(dt, x, y) {
    if (!x && !y) return;
    const { yaw } = this.app.view();
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const step = fwd.multiplyScalar(-y).addScaledVector(right, x).clampLength(0, 1).multiplyScalar(1.3 * dt);
    const head = this.app.head(), to = head.clone().add(step);
    pushOut(to, this.app.fp.blockers());
    this.rig.position.add(to.sub(head).setY(0));
  }

  turn(angle) { this.rig.rotation.y += angle; }
}
