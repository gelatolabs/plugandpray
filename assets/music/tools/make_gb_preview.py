#!/usr/bin/env python3
"""The GelatoBoy's sounds as WAV samples, for previewing in Logic's Quick
Sampler while composing (assets/music/gb-preview/): the squares at each duty,
the wave channel's shapes (the same 32-step tables as gb/music/music.c) and
the noise drums (the same settings as the driver's). The pitched ones are C4
(MIDI 60), loop seamlessly, and carry their root and loop in a "smpl" chunk.

    python3 assets/music/tools/make_gb_preview.py
"""
import os
import struct

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'gb-preview')
RATE = 44100
C4 = 440 * 2 ** ((60 - 69) / 12)

# (from gb/music/music.c)
SHAPES = {
    'triangle': '0123456789ABCDEFFEDCBA9876543210',
    'saw': '00112233445566778899AABBCCDDEEFF',
    'square': 'FFFFFFFFFFFFFFFF0000000000000000',
    'bass': '8BDEFFFFFFFEDB98742100000001246' + '7',
}
DRUMS = {   # name: (NR43, envelope pace)
    'kick': (0x62, 1), 'snare': (0x31, 2), 'hat_closed': (0x18, 1), 'hat_open': (0x10, 3), 'crash': (0x22, 5),
}


def write(name, x, loop=None):
    pcm = (np.clip(x, -1, 1) * 0.5 * 32767).astype('<i2').tobytes()
    chunks = b'fmt ' + struct.pack('<IHHIIHH', 16, 1, 1, RATE, RATE * 2, 2, 16)
    chunks += b'data' + struct.pack('<I', len(pcm)) + pcm
    if loop:
        # smpl: manufacturer, product, period (ns), unity note, pitch fraction, SMPTE x2, 1 loop; the loop
        smpl = struct.pack('<9I', 0, 0, round(1e9 / RATE), 60, 0, 0, 0, 1, 0)
        smpl += struct.pack('<6I', 0, 0, loop[0], loop[1] - 1, 0, 0)
        chunks += b'smpl' + struct.pack('<I', len(smpl)) + smpl
    with open(os.path.join(OUT, name + '.wav'), 'wb') as f:
        f.write(b'RIFF' + struct.pack('<I', 4 + len(chunks)) + b'WAVE' + chunks)


def periodic(table, seconds=2.0, cycles_per=None):
    """A looping tone at C4 from a one-cycle table of levels (-1..1): an exact
    whole number of cycles, so the loop is seamless."""
    k = round(seconds * C4)
    n = round(k * RATE / C4)
    f = k * RATE / n
    phase = (np.arange(n) * f / RATE) % 1.0
    x = np.asarray(table)[(phase * len(table)).astype(int)]
    x = x - x.mean()   # (the GB's DAC has a high-pass: no DC)
    return x, (0, n)


def pulses():
    for name, duty in (('pulse12', 1), ('pulse25', 2), ('pulse50', 4), ('pulse75', 6)):
        table = [1.0] * duty + [-1.0] * (8 - duty)
        x, loop = periodic(table)
        write(name, x * 0.7, loop)


def waves():
    for name, hexes in SHAPES.items():
        table = [int(c, 16) / 7.5 - 1 for c in hexes]
        x, loop = periodic(table)
        write('wave_' + name, x * 0.8, loop)


def noise(poly, pace, vol=15):
    shift, short, div = poly >> 4, (poly >> 3) & 1, poly & 7
    clock = 524288 / (div if div else 0.5) / 2 ** (shift + 1)
    length = vol * pace / 64 + 0.02
    n = int(length * RATE)
    lfsr, out, acc = 0x7FFF, np.empty(n), 0.0
    level = 1.0
    for i in range(n):
        acc += clock / RATE
        while acc >= 1:
            acc -= 1
            bit = (lfsr ^ (lfsr >> 1)) & 1
            lfsr = (lfsr >> 1) | (bit << 14)
            if short:
                lfsr = (lfsr & ~0x40) | (bit << 6)
            level = -1.0 if lfsr & 1 else 1.0
        v = max(0, vol - int(i / RATE / (pace / 64)))   # the envelope: a step down every pace/64 s
        out[i] = level * v / 15
    return out - out.mean()


def drums():
    for name, (poly, pace) in DRUMS.items():
        write('noise_' + name, noise(poly, pace) * 0.8)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    pulses()
    waves()
    drums()
    print('wrote', sorted(os.listdir(OUT)))
