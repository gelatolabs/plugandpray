import * as THREE from 'three';
// Power and signal: whether each console is on, whether the TV has power and
// a picture, and where the link cable goes. Driven by the cables (plugs
// pulled out or pushed back in) and the GelatoBoy's power switch.
//
// The CRT has a power-off animation like the real thing: the picture
// collapses to a white-hot line, then to a dot that fades away; powering on
// it springs back open and warms up.

const OFF = [ // [duration, squash x, squash y, flash, brightness] keyframes
  [0.0, 1, 1, 0, 1],
  [0.09, 1, 0.012, 0.8, 1.2],
  [0.22, 0.01, 0.008, 1, 1.4],
  [1.2, 0.006, 0.006, 1, 0],
];
const ON = [
  [0.0, 0.01, 0.006, 1, 0.6],
  [0.08, 1, 0.01, 0.9, 1],
  [0.2, 1, 1, 0.3, 0.55],
  [1.6, 1, 1, 0, 1],
];

function sample(keys, t) {
  let i = 1;
  while (i < keys.length - 1 && t > keys[i][0]) i++;
  const a = keys[i - 1], b = keys[i];
  const f = Math.min(1, Math.max(0, (t - a[0]) / Math.max(1e-6, b[0] - a[0])));
  return a.map((v, k) => v + (b[k] - v) * f);
}

export class Hardware {
  constructor(app) {
    this.app = app;
    this.cables = app.cables;
    this.gbOn = false;     // both start switched off
    this.psOn = false;     // the GelatoStation's power button
    this.tube = { keys: null, t: 0, value: [0, 1, 1, 0, 1] };
    this.was = this.read();
    this.cables.onChange = () => this.changed();
  }

  get psPowered() { return this.psOn && this.cables.at('ps-iec') === 'ps-iec' && !!this.cables.at('ps-mains'); }
  get crtPowered() { return !!this.cables.at('crt-mains'); }
  // what's in the TV's video jack: the picture (the yellow plug, with the AV
  // cable in the GelatoStation), 'audio' (white or red: sound as video), or null
  get video() {
    const p = this.cables.sockets['crt-y'].plug?.name;
    if (!p || !this.cables.ends.av.plugged) return null;
    return p === 'rca-y' ? 'picture' : 'audio';
  }

  get av() { return this.video === 'picture'; }
  // where the link cable goes from the GB: 'ps1', 'maze' or null
  get link() {
    if (this.cables.at('link-gb') !== 'gb-ext') return null;
    const s = this.cables.at('link-ps');
    return s === 'ps-link' ? 'ps1' : s === 'maze-port' ? 'maze' : null;
  }

  read() { return { ps: this.psPowered, crt: this.crtPowered, link: this.link }; }

  changed() {
    const now = this.read(), was = this.was;
    this.was = now;
    const sound = (n, obj) => this.app.audio.sfx(n, obj.getWorldPosition(new THREE.Vector3()));
    if (now.ps !== was.ps) { this.app.powerPs(now.ps); sound(now.ps ? 'psOn' : 'psOff', this.app.world.station.group); }
    if (now.crt !== was.crt) { this.tube = { keys: now.crt ? ON : OFF, t: 0, value: this.tube.value }; sound(now.crt ? 'crtOn' : 'crtOff', this.app.world.crt.group); }
    if (now.link !== was.link) this.app.onLinkChange(now.link, was.link);
  }

  toggleGb() {
    this.gbOn = !this.gbOn;
    this.app.audio.sfx('gbSwitch', this.app.world.gb.powerSwitch.getWorldPosition(new THREE.Vector3()));
    this.app.powerGb(this.gbOn);
  }

  togglePs() {
    this.psOn = !this.psOn;
    this.app.audio.sfx('button', this.app.world.station.power.getWorldPosition(new THREE.Vector3()));
    this.changed();
  }

  // Updates the TV's tube.
  update(dt) {
    const tb = this.tube;
    if (tb.keys) {
      tb.t += dt;
      tb.value = sample(tb.keys, tb.t);
      if (tb.t > tb.keys[tb.keys.length - 1][0]) tb.keys = null;
    } else {
      tb.value = this.crtPowered ? [0, 1, 1, 0, 1] : [0, 0.006, 0.006, 1, 0];
    }
    const [, sx, sy, flash, bright] = tb.value;
    const u = this.app.world.crt.screen.material.uniforms;
    u.squash.value.set(sx, sy);
    u.flash.value = flash;
    u.power.value = bright;
    // the room shows in the glass, much more so with the picture off
    u.envAmount.value = this.app.noCrtReflections ? 0 : 0.05 + 0.5 * (1 - Math.min(1, bright));
    this.app.world.crt.led.material.color.set(this.crtPowered ? 0x40ff60 : 0x163a1c);
    // a powered TV with nothing coming in shows static; sound in the video
    // jack shows as faint bands that pulse with it
    const audioAsVideo = this.crtPowered && this.video === 'audio' && this.app.ps1.emu;
    u.snow.value = this.crtPowered && !audioAsVideo && !(this.av && this.app.ps1.emu) ? 1 : 0;
    u.bands.value = audioAsVideo ? 1 : 0;
    if (audioAsVideo) {
      const ch = this.cables.sockets['crt-y'].plug.name === 'rca-w' ? 0 : 1;
      u.bandLevel.value += (Math.min(1, this.app.audio.psLevel[ch] * 4) - u.bandLevel.value) * 0.5;
    }
  }

  // Is the TV showing anything (for the room's glow)?
  get crtLit() { return this.tube.value[4]; }
}
