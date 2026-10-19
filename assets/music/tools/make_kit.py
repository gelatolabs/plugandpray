#!/usr/bin/env python3
"""Synthesises the PS1 instrument kit (ours: no third-party samples):

  kit/<Name>.wav        pitched instruments, 16-bit mono, with a `smpl`
                        chunk (root note + loop) so Logic's Quick Sampler and
                        the PS1 converter both know how to play them
  kit/Drums/<drum>.wav  one-shot drums
  kit/kit.json          per instrument: file, root, loop, envelope (seconds),
                        volume; and the drum map (GM note -> drum)

Sustained sounds loop seamlessly: every partial in the loop does a whole
number of cycles in it (the sample rate is picked to make that exact), the
loop is a whole number of 28-sample ADPCM blocks, and nothing changes in it
but what repeats. The envelopes (attack, decay, release) are the SPU's.

    python3 assets/music/tools/make_kit.py
"""
import json
import os
import struct

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.join(HERE, '..', 'kit')
BLOCK = 28
rng = np.random.default_rng(60)


def midi_hz(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def write_wav(path, x, rate, root=None, loop=None):
    """x: float -1..1. loop: (start, end) samples (end exclusive)."""
    pcm = np.clip(np.round(x * 32767), -32768, 32767).astype('<i2')
    fmt = struct.pack('<HHIIHH', 1, 1, int(round(rate)), int(round(rate)) * 2, 2, 16)
    chunks = b'fmt ' + struct.pack('<I', len(fmt)) + fmt
    if root is not None:
        loops = [] if loop is None else [struct.pack('<IIIIII', 0, 0, loop[0], loop[1] - 1, 0, 0)]
        smpl = struct.pack('<IIIIIIIII', 0, 0, int(1e9 / rate), root, 0, 0, 0, len(loops), 0) + b''.join(loops)
        chunks += b'smpl' + struct.pack('<I', len(smpl)) + smpl
    data = pcm.tobytes()
    chunks += b'data' + struct.pack('<I', len(data)) + data
    with open(path, 'wb') as f:
        f.write(b'RIFF' + struct.pack('<I', 4 + len(chunks)) + b'WAVE' + chunks)


class Looper:
    """A loop of whole ADPCM blocks at about `rate` Hz, `seconds` long, in which
    a note `root` does a whole number of cycles: hz(k) is the frequency that
    does k cycles in the loop, so anything built from those repeats exactly."""
    def __init__(self, root, seconds, rate=22050):
        f0 = midi_hz(root)
        self.blocks = max(1, round(seconds * rate / BLOCK))
        self.n = len_ = self.blocks * BLOCK
        self.cycles = max(1, round(f0 * len_ / rate))   # cycles of the root in the loop
        self.rate = f0 * len_ / self.cycles
        self.f0 = f0

    def hz(self, cycles):
        return cycles * self.rate / self.n

    def k(self, ratio):
        """The whole number of cycles nearest ratio x the root."""
        return max(1, round(ratio * self.cycles))


def biquad(x, kind, f, rate, q=0.707):
    """A simple filter (RBJ cookbook)."""
    w = 2 * np.pi * f / rate
    a = np.sin(w) / (2 * q)
    c = np.cos(w)
    if kind == 'lp':
        b = [(1 - c) / 2, 1 - c, (1 - c) / 2]
    elif kind == 'hp':
        b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]
    else:   # band-pass, peak 0 dB
        b = [a, 0, -a]
    a0, a1, a2 = 1 + a, -2 * c, 1 - a
    b0, b1, b2 = (v / a0 for v in b)
    a1, a2 = a1 / a0, a2 / a0
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, v, y1, o
        y[i] = o
    return y


def saw(phase, harmonics):
    """A band-limited saw from its harmonics (phase in cycles)."""
    return sum(np.sin(2 * np.pi * h * phase) / h for h in range(1, harmonics + 1)) * (2 / np.pi)


def normalise(x, peak=0.89):
    return x * (peak / np.max(np.abs(x)))


def fade_in(n, length):
    e = np.ones(n)
    e[:length] = np.linspace(0, 1, length) ** 2
    return e


# ---------------------------------------------------------------------------
# the pitched instruments: each returns (signal, rate, loop start, loop end)

def sustained(lp, attack_blocks, body):
    """attack_blocks of attack, then the loop: body(t, steady) for t in samples,
    steady (0..1) going to 1 by the loop's start. Returns signal, loop start, end."""
    a = attack_blocks * BLOCK
    t = np.arange(a + lp.n)
    steady = np.minimum(1, t / max(1, a))
    x = body(t, steady)
    return x, a, a + lp.n


def epiano():
    # FM: a sine carrier, modulated by a sine at the same pitch (the body) and
    # at 14x (the tine's bright ping), both settling down by the loop
    lp = Looper(60, 0.12, 22050)
    kc, k14 = lp.cycles, lp.cycles * 14

    def body(t, s):
        tt = t / lp.rate
        idx = 0.35 + 1.6 * np.exp(-tt * 9) * (1 - s)   # the body's brightness, dying down ...
        ping = 0.9 * np.exp(-tt * 40) * (1 - s)        # ... and the tine's ping, quicker (both settled by the loop)
        ph = t / lp.n
        mod = idx * np.sin(2 * np.pi * kc * ph) + ping * np.sin(2 * np.pi * k14 * ph)
        tone = np.sin(2 * np.pi * kc * ph + mod)
        click = np.exp(-tt * 300) * 0.25 * np.sin(2 * np.pi * kc * 6 * ph)
        return tone + click
    x, ls, le = sustained(lp, 220, body)
    return normalise(x), lp.rate, ls, le


def strings():
    # an ensemble: three saws a few cents apart each side (they beat, slowly, a
    # whole number of times in the loop), softened, an octave above doubled
    lp = Looper(60, 0.75, 22050)
    n = lp.cycles

    def body(t, s):
        ph = t / lp.n
        x = 0
        for d, amp in ((-1, 0.8), (0, 1.0), (1, 0.8), (2, 0.5)):
            x = x + amp * saw((n + d) * ph + rng.random(), 18)
        x = x + 0.3 * saw((2 * n + 1) * ph, 9)
        return x
    x, ls, le = sustained(lp, 4, body)
    # gentle lowpass: a circular one over the loop, so it still joins
    x = soften(x, ls, le, 4500, lp.rate)
    return normalise(x), lp.rate, ls, le


def soften(x, ls, le, f, rate):
    """Lowpass that keeps the loop seamless: filters the loop as a circle (run
    it round twice and keep the second lap), and the attack on its own."""
    loop = x[ls:le]
    twice = biquad(np.concatenate([loop, loop]), 'lp', f, rate)
    head = biquad(x[:ls], 'lp', f, rate) if ls else np.zeros(0)
    return np.concatenate([head, twice[len(loop):]])


def slap_bass():
    # root C2: a plucky saw/square mix through a closing filter, with a slap
    # (a bright transient) on top; the loop is its settled tone
    lp = Looper(36, 0.1, 22050)
    n = lp.cycles

    def body(t, s):
        tt = t / lp.rate
        ph = t / lp.n
        bright = np.round(6 + 30 * np.exp(-tt * 18) * (1 - s)).astype(int)
        x = np.zeros(len(t))
        for h in range(1, 40):
            amp = np.where(h <= bright, 1.0, np.exp(-(h - bright) * 0.6)) / h ** 0.9
            x = x + amp * np.sin(2 * np.pi * n * h * ph)
        slap = np.exp(-tt * 120) * rng.normal(0, 1, len(t)) * 0.6
        return x + np.where(s >= 1, 0, slap)
    x, ls, le = sustained(lp, 150, body)
    return normalise(x), lp.rate, ls, le


def synth_lead():
    # a bright square-ish lead; vibrato fades in, the loop is one vibrato cycle
    lp = Looper(72, 1 / 5.5, 22050)
    n = lp.cycles

    def body(t, s):
        ph = t / lp.n
        # vibrato, one cycle per loop, fading in: phase wobble of `depth` cycles
        # is a pitch wobble of 2 pi depth / n (0.0014 n: about 15 cents)
        depth = 0.0014 * n * s ** 2
        p = n * ph + depth * np.sin(2 * np.pi * ph)
        # (harmonics kept below 10 kHz at its root: none fold over at 22 kHz)
        x = sum(np.sin(2 * np.pi * h * p) / h for h in range(1, 20, 2))         # square
        x = 0.7 * x + 0.3 * saw(p, 19)
        return x
    x, ls, le = sustained(lp, 60, body)
    x = soften(x, ls, le, 6000, lp.rate)
    return normalise(x), lp.rate, ls, le


def bells():
    # FM bell: modulator at 3.5x (inharmonic), index dying away; the loop holds
    # its ring (the SPU's envelope does the long decay)
    lp = Looper(72, 0.2, 22050)
    if lp.cycles % 2:
        lp.cycles += 1
        lp.rate = lp.f0 * lp.n / lp.cycles
    n = lp.cycles

    def body(t, s):
        tt = t / lp.rate
        ph = t / lp.n
        idx = 0.5 + 3 * np.exp(-tt * 6) * (1 - s)
        m = idx * np.sin(2 * np.pi * (n * 7 // 2) * ph)
        return np.sin(2 * np.pi * n * ph + m) + 0.25 * np.sin(2 * np.pi * 2 * n * ph)
    x, ls, le = sustained(lp, 300, body)
    return normalise(x), lp.rate, ls, le


def pad():
    # warm: detuned triangle-ish voices an octave apart, slow shimmer
    lp = Looper(60, 1.0, 16000)
    n = lp.cycles

    def body(t, s):
        ph = t / lp.n
        x = 0
        for k, amp in ((n - 1, 1), (n + 1, 1), (2 * n, 0.4), (2 * n + 3, 0.3), (n // 2 if n % 2 == 0 else n, 0.0)):
            p = k * ph + rng.random()
            x = x + amp * sum(np.sin(2 * np.pi * h * p) * (1 / h ** 2) * (-1) ** ((h - 1) // 2) for h in range(1, 12, 2))
        return x
    x, ls, le = sustained(lp, 4, body)
    x = soften(x, ls, le, 2500, lp.rate)
    return normalise(x), lp.rate, ls, le


INSTRUMENTS = {
    # name: (builder, root, envelope, volume)
    'EPiano': (epiano, 60, dict(attack=0.002, decay=0.0, sustain=1.0, sustain_fade=3.5, release=0.25), 0.8),
    'Strings': (strings, 60, dict(attack=0.25, decay=0.0, sustain=1.0, sustain_fade=0, release=0.45), 0.6),
    'Slap Bass': (slap_bass, 36, dict(attack=0.0, decay=0.0, sustain=1.0, sustain_fade=1.6, release=0.06), 0.9),
    'Synth Lead': (synth_lead, 72, dict(attack=0.008, decay=0.0, sustain=1.0, sustain_fade=0, release=0.12), 0.7),
    'Bells': (bells, 72, dict(attack=0.0, decay=0.0, sustain=1.0, sustain_fade=2.5, release=0.9), 0.6),
    'Pad': (pad, 60, dict(attack=0.6, decay=0.0, sustain=1.0, sustain_fade=0, release=0.9), 0.55),
}


# ---------------------------------------------------------------------------
# drums (one-shots: they play out whatever the note's length)

def env(n, rate, tau):
    return np.exp(-np.arange(n) / rate / tau)


def kick(rate=22050):
    n = int(0.35 * rate)
    t = np.arange(n) / rate
    f = 48 + 110 * np.exp(-t * 28)
    ph = np.cumsum(f) / rate
    x = np.sin(2 * np.pi * ph) * env(n, rate, 0.12)
    x += 0.4 * np.exp(-t * 400) * rng.normal(0, 1, n)
    return np.tanh(x * 1.6), rate


def snare(rate=22050):
    n = int(0.26 * rate)
    t = np.arange(n) / rate
    tone = np.sin(2 * np.pi * 185 * t) * env(n, rate, 0.05) + 0.5 * np.sin(2 * np.pi * 330 * t) * env(n, rate, 0.03)
    noise = biquad(rng.normal(0, 1, n), 'bp', 3500, rate, 0.6) * env(n, rate, 0.08) * 2
    return tone * 0.8 + noise, rate


def clap(rate=22050):
    n = int(0.3 * rate)
    t = np.arange(n) / rate
    burst = np.zeros(n)
    for d in (0.0, 0.011, 0.022):
        i = int(d * rate)
        burst[i:] += np.exp(-(t[:n - i]) * 180)
    burst += 0.6 * np.exp(-np.maximum(0, t - 0.03) * 14) * (t > 0.03)
    return biquad(rng.normal(0, 1, n), 'bp', 1300, rate, 1.2) * burst * 3, rate


def metal(n, rate):
    """808-style metal: six square waves at odd frequencies."""
    t = np.arange(n) / rate
    x = sum(np.sign(np.sin(2 * np.pi * f * t)) for f in (205.3, 304.4, 369.6, 522.7, 540, 800))
    return biquad(x + 0.6 * rng.normal(0, 1, n), 'hp', 7000, rate, 0.7)


def closed_hat(rate=32000):
    n = int(0.07 * rate)
    return metal(n, rate) * env(n, rate, 0.018), rate


def open_hat(rate=32000):
    n = int(0.42 * rate)
    return metal(n, rate) * env(n, rate, 0.12), rate


def tom(f0, rate=22050):
    n = int(0.42 * rate)
    t = np.arange(n) / rate
    f = f0 * (1 + 0.5 * np.exp(-t * 20))
    x = np.sin(2 * np.pi * np.cumsum(f) / rate) * env(n, rate, 0.14)
    return x + 0.15 * np.exp(-t * 200) * rng.normal(0, 1, n), rate


def crash(rate=32000):
    n = int(1.1 * rate)
    x = metal(n, rate) * 0.6 + biquad(rng.normal(0, 1, n), 'hp', 4500, rate) * 0.8
    e = env(n, rate, 0.35) * fade_in(n, int(0.002 * rate))
    return x * e, rate


DRUMS = {
    # name: (builder, GM notes, volume)
    'Kick': (kick, [35, 36], 1.0),
    'Snare': (snare, [38, 40], 0.85),
    'Clap': (clap, [39], 0.8),
    'Closed Hat': (closed_hat, [42, 44], 0.5),
    'Open Hat': (open_hat, [46], 0.5),
    'Low Tom': (lambda: tom(98), [41, 43, 45], 0.8),
    'High Tom': (lambda: tom(165), [47, 48, 50], 0.8),
    'Crash': (crash, [49, 52, 55, 57], 0.55),
}


def end_fade(x, ms, rate):
    """One-shots end at silence (the SPU stops them dead at their last block)."""
    n = int(ms / 1000 * rate)
    x = x.copy()
    x[-n:] *= np.linspace(1, 0, n) ** 2
    return x


def main():
    os.makedirs(os.path.join(KIT, 'Drums'), exist_ok=True)
    kit = {'instruments': {}, 'drums': {}, 'drum_map': {}}
    for name, (build, root, envelope, vol) in INSTRUMENTS.items():
        x, rate, ls, le = build()
        x = x[:le]
        assert np.max(np.abs(x)) < 0.9 and ls % BLOCK == 0 and le % BLOCK == 0
        file = f'{name}.wav'
        write_wav(os.path.join(KIT, file), x, rate, root, (ls, le))
        kit['instruments'][name] = {'file': file, 'root': root, 'rate': rate, 'loop': [ls, le],
                                    'envelope': envelope, 'volume': vol}
        print(f'{name:11s} {rate:8.1f} Hz  {le / rate:5.2f} s  loop {ls}-{le}')
    for name, (build, notes, vol) in DRUMS.items():
        x, rate = build()
        x = end_fade(normalise(x), 8, rate)
        file = f'Drums/{name}.wav'
        write_wav(os.path.join(KIT, file), x, rate, 60)
        kit['drums'][name] = {'file': file, 'rate': rate, 'volume': vol}
        for n in notes:
            kit['drum_map'][str(n)] = name
        print(f'{name:11s} {rate:8.1f} Hz  {len(x) / rate:5.2f} s')
    with open(os.path.join(KIT, 'kit.json'), 'w') as f:
        json.dump(kit, f, indent=1)


if __name__ == '__main__':
    main()
