// Sound, all positioned in the room (Web Audio panners follow the camera):
//  - the GB's sound (mono) comes from the GB, wherever it is
//  - the GelatoStation's (stereo) comes out of the TV's two speakers, through
//    whatever's plugged into the TV's audio jacks: the white plug carries the
//    left channel and the red the right, so swapping them swaps the channels;
//    the yellow (video) plug in an audio jack makes the harsh buzz of a video
//    signal (60 Hz frame sync + the 15.7 kHz line rate, its tone following how
//    bright the picture is)
//  - sound effects (plugs, switches, media, the tray, the GB-screen wave),
//    synthesised on the spot.
import * as THREE from 'three';

const SFX_GAIN = 1.6;   // the room's sound effects, louder (so they carry over the consoles)

export const TRAY_TIME = 8;   // s the YOU WIN! tray takes to come out (a little longer than the walls take to turn: see App.giveWin)
const LATENCY = 0.08;   // s of emulator audio queued ahead

function panner(ctx, refDistance = 0.4) {
  const p = ctx.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'inverse';
  p.refDistance = refDistance;
  p.rolloffFactor = 1.2;
  return p;
}

const setPos = (p, v, t) => {
  if (p.positionX) { p.positionX.setTargetAtTime(v.x, t, 0.02); p.positionY.setTargetAtTime(v.y, t, 0.02); p.positionZ.setTargetAtTime(v.z, t, 0.02); } else p.setPosition(v.x, v.y, v.z);
};

// The player for an emulator's sound, as an AudioWorklet: samples (already at
// the context's rate) are pushed into a ring buffer and played out from it
// continuously. It waits until a little is queued before it starts (and again
// if it runs dry, fading out rather than clicking), and skips ahead if too
// much piles up.
const WORKLET = `
class EmuStream extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.channels = o.channels;
    this.target = o.target;
    this.size = 1 << 16;
    this.buf = Array.from({ length: this.channels }, () => new Float32Array(this.size));
    this.r = 0;
    this.w = 0;
    this.playing = false;
    this.last = new Float32Array(this.channels);
    this.port.onmessage = (e) => {
      const chunks = e.data, n = chunks[0].length;
      for (let c = 0; c < this.channels; c++) {
        const b = this.buf[c], d = chunks[c];
        for (let i = 0; i < n; i++) b[(this.w + i) & (this.size - 1)] = d[i];
      }
      this.w = (this.w + n) & (this.size - 1);
      if (this.queued() > this.target * 3) this.r = (this.w - this.target) & (this.size - 1);
    };
  }
  queued() { return (this.w - this.r) & (this.size - 1); }
  process(inputs, outputs) {
    const out = outputs[0], n = out[0].length;
    if (!this.playing && this.queued() >= this.target) this.playing = true;
    if (this.playing && this.queued() < n) this.playing = false;
    for (let c = 0; c < this.channels; c++) {
      const b = this.buf[c], o = out[c];
      if (this.playing) {
        for (let i = 0; i < n; i++) o[i] = b[(this.r + i) & (this.size - 1)];
        this.last[c] = o[n - 1];
      } else {
        let v = this.last[c];
        for (let i = 0; i < n; i++) { v *= 0.97; o[i] = v; }
        this.last[c] = v;
      }
    }
    if (this.playing) this.r = (this.r + n) & (this.size - 1);
    return true;
  }
}
registerProcessor('emu-stream', EmuStream);
`;
let workletUrl = null;
const workletModule = () => (workletUrl ??= URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));

// Plays an emulator's samples as they arrive (interleaved stereo Int16), into `out`.
// They're resampled to the context's rate here, continuously from one frame's
// worth to the next (no seams), and played by the worklet above once it's
// loaded (or, without AudioWorklet, as a buffer per frame, queued back to back).
class Stream {
  constructor(ctx, channels, out) {
    this.ctx = ctx;
    this.channels = channels;   // 1: mixed down to mono; 2: kept stereo
    this.out = out;
    this.node = null;
    this.next = 0;
    this.phase = 0;             // where the next output sample falls in the next chunk (in its samples, from -1)
    this.prev = [0, 0];         // the last input sample (left, right)
    this.level = [0, 0];        // recent loudness of each channel (0..1)
  }

  useWorklet() {
    this.node = new AudioWorkletNode(this.ctx, 'emu-stream', {
      numberOfInputs: 0, outputChannelCount: [this.channels],
      processorOptions: { channels: this.channels, target: Math.round(this.ctx.sampleRate * LATENCY) },
    });
    this.node.connect(this.out);
  }

  push(samples, rate) {
    const n = samples.length / 2;
    if (!n || !(rate > 0)) return;
    let sl = 0, sr = 0;
    for (let i = 0; i < n; i++) {
      const l = samples[i * 2] / 32768, r = samples[i * 2 + 1] / 32768;
      sl += l * l;
      sr += r * r;
    }
    this.level = [Math.sqrt(sl / n), Math.sqrt(sr / n)];
    // linear interpolation to the context's rate, carrying on from the last chunk
    const step = rate / this.ctx.sampleRate, prev = this.prev;
    const get = (i, c) => (i < 0 ? prev[c] : samples[i * 2 + c] / 32768);
    const m = Math.max(0, Math.ceil((n - 1 - this.phase) / step));
    const L = new Float32Array(m), R = new Float32Array(m);
    let pos = this.phase;
    for (let k = 0; k < m; k++, pos += step) {
      const i = Math.floor(pos), f = pos - i;
      L[k] = get(i, 0) * (1 - f) + get(i + 1, 0) * f;
      R[k] = get(i, 1) * (1 - f) + get(i + 1, 1) * f;
    }
    this.phase = pos - n;
    this.prev = [samples[(n - 1) * 2] / 32768, samples[(n - 1) * 2 + 1] / 32768];
    if (!m) return;
    const chunks = this.channels > 1 ? [L, R] : [L.map((v, i) => (v + R[i]) / 2)];
    if (this.node) {
      this.node.port.postMessage(chunks, chunks.map((c) => c.buffer));
      return;
    }
    const ctx = this.ctx, buf = ctx.createBuffer(this.channels, m, ctx.sampleRate);
    chunks.forEach((c, i) => buf.copyToChannel(c, i));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.out);
    const now = ctx.currentTime;
    if (this.next < now || this.next > now + LATENCY * 4) this.next = now + LATENCY;
    src.start(this.next);
    this.next += buf.duration;
  }
}

export class Audio {
  constructor(app) {
    this.app = app;
    this.ctx = null;
    this.volume = 1;   // the whole game's, 0..1 (the TV's buttons)
    // a browser may start the context suspended (no sound) if it doesn't count
    // the click that started it: any later click, key or touch wakes it up
    const wake = () => { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); };
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, wake, { capture: true });
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(0.9 * v * v, this.ctx.currentTime, 0.03);   // (squared: it sounds even)
  }

  // Needs a click (or a key) to start.
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain();
    this.master.gain.value = 0.9 * this.volume * this.volume;
    this.master.connect(ctx.destination);
    // the GB's speaker
    this.gbOut = ctx.createGain();
    this.gbPan = panner(ctx, 0.25);
    this.gbOut.connect(this.gbPan).connect(this.master);
    this.gbStream = new Stream(ctx, 1, this.gbOut);
    // the GelatoStation's two channels, routed to the TV's speakers by the plugs
    this.psIn = ctx.createGain();
    const split = ctx.createChannelSplitter(2);
    this.psIn.connect(split);
    this.psChannel = [ctx.createGain(), ctx.createGain()];
    split.connect(this.psChannel[0], 0);
    split.connect(this.psChannel[1], 1);
    this.psStream = new Stream(ctx, 2, this.psIn);
    // the emulators' sound streams through an AudioWorklet where there is one
    // (it needs a secure page); until it's loaded, or without it, buffers are queued
    if (ctx.audioWorklet) {
      ctx.audioWorklet.addModule(workletModule())
        .then(() => { this.gbStream.useWorklet(); this.psStream.useWorklet(); })
        .catch((err) => console.warn('audio worklet:', err));
    }
    // each speaker: a mixer the plugged-in channel (or buzz) goes into
    this.speakers = [0, 1].map(() => {
      const mix = ctx.createGain(), pan = panner(ctx, 0.5);
      mix.connect(pan).connect(this.master);
      return { mix, pan, from: null };
    });
    this.buzz = this.buildBuzz();
    this.routing = null;
  }

  // The sound of a composite video signal fed to a speaker.
  buildBuzz() {
    const ctx = this.ctx;
    const frame = ctx.createOscillator();      // 59.94 Hz frame sync: a buzzy pulse train
    frame.type = 'square';
    frame.frequency.value = 59.94;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 127.5 - 1; curve[i] = Math.tanh(x * 4); }
    shaper.curve = curve;
    const tone = ctx.createBiquadFilter();     // the picture's brightness colours the buzz
    tone.type = 'lowpass';
    tone.frequency.value = 2000;
    tone.Q.value = 3;
    const line = ctx.createOscillator();       // 15.734 kHz line rate: the whine
    line.type = 'sawtooth';
    line.frequency.value = 15734;
    const lineGain = ctx.createGain();
    lineGain.gain.value = 0.06;
    const out = ctx.createGain();
    out.gain.value = 0.18;
    frame.connect(shaper).connect(tone).connect(out);
    line.connect(lineGain).connect(out);
    frame.start();
    line.start();
    return { out, tone, lineGain };
  }

  // Which of the TV's jacks has which plug, and what that means for sound.
  route() {
    const c = this.app.cables, at = (jack) => c.sockets[jack]?.plug?.name ?? null;
    const avIn = !!c.ends.av?.socket;
    // the GelatoStation's channels only reach the plugs if the AV cable is in its back
    const channelOf = { 'rca-w': 0, 'rca-r': 1 };
    const routing = ['crt-w', 'crt-r'].map((jack) => {
      const p = at(jack);
      if (!p || !avIn || !this.app.hw.crtPowered) return null;
      if (p === 'rca-y') return 'buzz';
      return channelOf[p];
    }).join(',');
    if (routing === this.routing) return;
    this.routing = routing;
    this.speakers.forEach((s) => { if (s.from) s.from.disconnect(s.mix); s.from = null; });
    // (the buzz may feed both speakers: disconnect it once from everything)
    this.buzz.out.disconnect();
    routing.split(',').forEach((r, i) => {
      const s = this.speakers[i];
      if (r === 'buzz') { this.buzz.out.connect(s.mix); s.from = null; } else if (r !== '' && r !== 'null') {
        s.from = this.psChannel[+r];
        s.from.connect(s.mix);
      }
    });
  }

  // Each frame: follow the camera and the GB, keep the TV's speakers placed,
  // and play whatever the emulators made.
  update() {
    const ctx = this.ctx;
    if (!ctx) return;
    try { this.updateNow(); } catch (err) {
      if (!this.warned) { console.warn('audio:', err); this.warned = true; }
    }
  }

  updateNow() {
    const ctx = this.ctx;
    const app = this.app, t = ctx.currentTime, L = ctx.listener;
    const head = app.head(), q = app.camera.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q), up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    if (L.positionX) {
      L.positionX.value = head.x; L.positionY.value = head.y; L.positionZ.value = head.z;
      L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z;
      L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z;
    } else {
      L.setPosition(head.x, head.y, head.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
    setPos(this.gbPan, app.world.gb.group.getWorldPosition(new THREE.Vector3()), t);
    const crt = app.world.crt.group;
    crt.updateMatrixWorld();
    [-0.17, 0.17].forEach((x, i) => setPos(this.speakers[i].pan, new THREE.Vector3(x, -0.08, 0.15).applyMatrix4(crt.matrixWorld), t));
    this.route();
    // the buzz's tone follows the brightness of the picture
    const lum = app.crtLum ?? 0.2;
    this.buzz.tone.frequency.setTargetAtTime(400 + lum * 6000, t, 0.05);
    this.buzz.lineGain.gain.setTargetAtTime(0.03 + lum * 0.08, t, 0.05);
  }

  // Emulator audio, after each console has run its frames.
  feed(sys) {
    if (!this.ctx || !sys.emu) return;
    // (sound going wrong must never stop the game)
    try {
      const samples = sys.emu.drainAudio();
      (sys.kind === 'gb' ? this.gbStream : this.psStream).push(samples, sys.emu.sampleRate);
    } catch (err) {
      if (!this.warned) { console.warn('audio:', err); this.warned = true; }
    }
  }

  // Loudness of the GelatoStation's left/right channels just now.
  get psLevel() { return this.psStream?.level ?? [0, 0]; }

  // --- sound effects ----------------------------------------------------------

  // A one-shot at a world position: build(ctx, out, t) wires up its nodes into `out`.
  // (SFX_GAIN: all of them, against the consoles)
  play(at, build, gain = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const out = ctx.createGain(), p = panner(ctx, 0.3);
    out.gain.value = gain * SFX_GAIN;
    out.connect(p).connect(this.master);
    setPos(p, at, ctx.currentTime);
    if (p.positionX) { p.positionX.value = at.x; p.positionY.value = at.y; p.positionZ.value = at.z; }
    build(ctx, out, ctx.currentTime);
  }

  noise(ctx, seconds) {
    const n = Math.ceil(ctx.sampleRate * seconds), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource();
    s.buffer = b;
    return s;
  }

  // a filtered noise burst: clicks, scrapes, thunks
  burst(ctx, out, t, { dur = 0.03, freq = 3000, q = 1, type = 'bandpass', vol = 0.5, attack = 0.001 }) {
    const n = this.noise(ctx, dur + 0.05), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    n.connect(f).connect(g).connect(out);
    n.start(t);
    n.stop(t + dur + 0.05);
  }

  tone(ctx, out, t, { f0, f1 = f0, dur, type = 'sine', vol = 0.3, attack = 0.002 }) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  sfx(name, at) {
    if (!this.ctx || !at) return;
    const S = SFX[name];
    if (S) this.play(at, (ctx, out, t) => S.call(this, ctx, out, t));
  }
}

// The effects. `this` is the Audio.
const SFX = {
  // a plug pushed home: a scrape, then a firm click
  plugIn(ctx, out, t) {
    this.burst(ctx, out, t, { dur: 0.07, freq: 1800, q: 0.7, vol: 0.12, attack: 0.03 });
    this.burst(ctx, out, t + 0.07, { dur: 0.025, freq: 4200, q: 2, vol: 0.6 });
    this.tone(ctx, out, t + 0.07, { f0: 180, f1: 90, dur: 0.05, vol: 0.25 });
  },
  // pulled out: a short pop and a slide
  unplug(ctx, out, t) {
    this.burst(ctx, out, t, { dur: 0.02, freq: 2600, q: 1.5, vol: 0.5 });
    this.burst(ctx, out, t + 0.01, { dur: 0.09, freq: 1400, q: 0.6, vol: 0.1, attack: 0.01 });
  },
  // the TV coming on: a relay clack, the degauss thump and hum, the line whine rising
  crtOn(ctx, out, t) {
    this.burst(ctx, out, t, { dur: 0.03, freq: 900, q: 1, vol: 0.6 });
    this.tone(ctx, out, t + 0.02, { f0: 120, f1: 60, dur: 0.6, type: 'sawtooth', vol: 0.22, attack: 0.03 });
    this.tone(ctx, out, t + 0.02, { f0: 60, dur: 0.9, type: 'sine', vol: 0.18, attack: 0.05 });
    this.tone(ctx, out, t + 0.3, { f0: 15734, dur: 2.5, vol: 0.02, attack: 0.6 });
  },
  // off: the click and a soft fall
  crtOff(ctx, out, t) {
    this.burst(ctx, out, t, { dur: 0.03, freq: 800, q: 1, vol: 0.5 });
    this.tone(ctx, out, t, { f0: 15734, f1: 15000, dur: 0.5, vol: 0.015 });
    this.burst(ctx, out, t + 0.02, { dur: 0.35, freq: 300, type: 'lowpass', vol: 0.15, attack: 0.02 });
  },
  // the GelatoStation: a plasticky power click and its drive spinning up/down
  psOn(ctx, out, t) {
    this.burst(ctx, out, t, { dur: 0.02, freq: 2500, q: 2, vol: 0.4 });
    this.tone(ctx, out, t + 0.05, { f0: 80, f1: 420, dur: 1.4, type: 'triangle', vol: 0.05, attack: 0.3 });
  },
  psOff(ctx, out, t) {
    this.burst(ctx, out, t, { dur: 0.02, freq: 2200, q: 2, vol: 0.35 });
    this.tone(ctx, out, t, { f0: 400, f1: 60, dur: 1.0, type: 'triangle', vol: 0.04 });
  },
  // the reset button: a chunky arcade-button clunk, and a little rising chime
  resetButton(ctx, out, t) {
    this.burst(ctx, out, t, { dur: 0.03, freq: 1600, q: 1.2, vol: 0.5 });
    this.tone(ctx, out, t + 0.01, { f0: 140, f1: 70, dur: 0.06, vol: 0.25 });
    this.tone(ctx, out, t + 0.08, { f0: 660, dur: 0.09, type: 'square', vol: 0.05 });
    this.tone(ctx, out, t + 0.16, { f0: 990, dur: 0.14, type: 'square', vol: 0.05 });
  },
  // the GB's slide switch
  gbSwitch(ctx, out, t) {
    this.burst(ctx, out, t, { dur: 0.04, freq: 3500, q: 1, vol: 0.12, attack: 0.02 });
    this.burst(ctx, out, t + 0.04, { dur: 0.015, freq: 5000, q: 3, vol: 0.5 });
  },
  // a cartridge sliding into the GB
  cartIn(ctx, out, t) {
    this.burst(ctx, out, t, { dur: 0.12, freq: 1200, q: 0.5, vol: 0.12, attack: 0.05 });
    this.burst(ctx, out, t + 0.12, { dur: 0.03, freq: 3000, q: 2, vol: 0.5 });
    this.tone(ctx, out, t + 0.12, { f0: 260, f1: 140, dur: 0.06, vol: 0.18 });
  },
  cartOut(ctx, out, t) {
    this.burst(ctx, out, t, { dur: 0.025, freq: 2800, q: 2, vol: 0.4 });
    this.burst(ctx, out, t + 0.02, { dur: 0.1, freq: 1100, q: 0.5, vol: 0.1, attack: 0.02 });
  },
  // the lid, the disc dropping on the spindle
  discIn(ctx, out, t) {
    this.burst(ctx, out, t, { dur: 0.04, freq: 1600, q: 1, vol: 0.3 });
    this.tone(ctx, out, t + 0.05, { f0: 900, f1: 700, dur: 0.08, type: 'triangle', vol: 0.06 });
  },
  // the GelatoStation's lid popping up on its spring, and snapping shut
  lidOpen(ctx, out, t) {
    this.burst(ctx, out, t, { dur: 0.02, freq: 3000, q: 2, vol: 0.4 });
    this.tone(ctx, out, t + 0.01, { f0: 420, f1: 260, dur: 0.12, type: 'triangle', vol: 0.06 });
  },
  lidClose(ctx, out, t) {
    this.burst(ctx, out, t, { dur: 0.03, freq: 2200, q: 2, vol: 0.45 });
    this.tone(ctx, out, t, { f0: 170, f1: 90, dur: 0.06, vol: 0.2 });
  },
  // a console's button: a short tick
  button(ctx, out, t) {
    this.burst(ctx, out, t, { dur: 0.015, freq: 4500, q: 2, vol: 0.35 });
    this.tone(ctx, out, t, { f0: 260, f1: 180, dur: 0.03, vol: 0.12 });
  },
  discOut(ctx, out, t) {
    this.burst(ctx, out, t, { dur: 0.03, freq: 2000, q: 2, vol: 0.4 });
    this.tone(ctx, out, t + 0.03, { f0: 700, f1: 900, dur: 0.1, type: 'triangle', vol: 0.05 });
  },
  // the tray sliding out of the wall: a motor whirring, a clunk at the end
  tray(ctx, out, t) {
    this.tone(ctx, out, t, { f0: 140, f1: 180, dur: TRAY_TIME, type: 'sawtooth', vol: 0.05, attack: 0.5 });
    this.burst(ctx, out, t, { dur: TRAY_TIME, freq: 600, q: 2, vol: 0.05, attack: 0.5 });
    this.burst(ctx, out, t + TRAY_TIME, { dur: 0.05, freq: 500, q: 1, vol: 0.5 });
  },
  // reality turning into a GB screen: a rising arpeggio of square waves
  waveIn(ctx, out, t) {
    [262, 330, 392, 523, 659, 784, 1047].forEach((f, i) => this.tone(ctx, out, t + i * 0.09, { f0: f, dur: 0.5, type: 'square', vol: 0.05 }));
    this.tone(ctx, out, t, { f0: 60, f1: 30, dur: 2.5, type: 'sine', vol: 0.25, attack: 0.3 });
  },
  // and back: falling
  waveOut(ctx, out, t) {
    [1047, 784, 659, 523, 392, 330, 262].forEach((f, i) => this.tone(ctx, out, t + i * 0.06, { f0: f, dur: 0.35, type: 'square', vol: 0.045 }));
  },
  // the zapper's trigger: a spring click and a plasticky clack
  zap(ctx, out, t) {
    this.burst(ctx, out, t, { dur: 0.015, freq: 5000, q: 3, vol: 0.9 });
    this.burst(ctx, out, t + 0.02, { dur: 0.05, freq: 1500, q: 1, vol: 0.65 });
  },
  // putting the Virtualato on / taking it off
  vbOn(ctx, out, t) {
    this.burst(ctx, out, t, { dur: 0.2, freq: 700, q: 0.4, vol: 0.12, attack: 0.08 });
    this.tone(ctx, out, t + 0.4, { f0: 880, dur: 0.15, type: 'square', vol: 0.04 });
  },
  vbOff(ctx, out, t) {
    this.burst(ctx, out, t, { dur: 0.2, freq: 700, q: 0.4, vol: 0.12, attack: 0.05 });
  },
  // the manual: a page swishing over, and its cover opening or closing (a soft flap)
  page(ctx, out, t) {
    this.burst(ctx, out, t, { dur: 0.22, freq: 3200, q: 0.5, vol: 0.07, attack: 0.08 });
    this.burst(ctx, out, t + 0.2, { dur: 0.04, freq: 1800, q: 0.8, vol: 0.08 });
  },
  book(ctx, out, t) {
    this.burst(ctx, out, t, { dur: 0.18, freq: 2400, q: 0.5, vol: 0.06, attack: 0.06 });
    this.burst(ctx, out, t + 0.2, { dur: 0.05, freq: 500, q: 0.8, vol: 0.3 });
  },
  // the cheat going in: a quick bright arpeggio
  cheat(ctx, out, t) {
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this.tone(ctx, out, t + i * 0.05, { f0: f, dur: 0.18, type: 'square', vol: 0.04 }));
  },
};
