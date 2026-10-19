#!/usr/bin/env python3
"""Writes demo.mid: our own 8-bar example loop, in F major at 132 BPM, with
every track the converters know (the GB four and a PS1 arrangement). It's song 1
(the platformer's) and the converters' test song.

    python3 assets/music/tools/make_demo.py
"""
import os
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'demo.mid')
PPQ, BPM, BARS = 480, 132, 8
Q = PPQ            # a beat
S = PPQ // 4       # a 16th

F, Dm, Bb, C = (53, 57, 60), (50, 53, 57), (46, 50, 53), (48, 52, 55)   # chords (F3 A3 C4 ...)
CHORDS = [F, Dm, Bb, C, F, Dm, Bb, C]
ROOTS = [41, 38, 46, 36, 41, 38, 46, 36]   # bass roots (F2 D2 Bb2 C2)

# the tune: (bar, 16th, length in 16ths, note)
MELODY = [
    (0, 0, 2, 72), (0, 2, 2, 74), (0, 4, 4, 77), (0, 10, 2, 74), (0, 12, 4, 72),
    (1, 0, 3, 69), (1, 4, 2, 72), (1, 6, 2, 74), (1, 8, 6, 77), (1, 14, 2, 76),
    (2, 0, 4, 74), (2, 4, 2, 72), (2, 6, 2, 70), (2, 8, 4, 72), (2, 12, 4, 74),
    (3, 0, 6, 76), (3, 8, 2, 79), (3, 10, 2, 77), (3, 12, 4, 76),
    (4, 0, 2, 72), (4, 2, 2, 74), (4, 4, 4, 77), (4, 10, 2, 79), (4, 12, 4, 81),
    (5, 0, 3, 81), (5, 4, 2, 79), (5, 6, 2, 77), (5, 8, 6, 74), (5, 14, 2, 72),
    (6, 0, 4, 74), (6, 4, 4, 77), (6, 8, 4, 79), (6, 12, 4, 76),
    (7, 0, 12, 77),
]


def bar(b, sixteenth=0):
    return b * 4 * Q + sixteenth * S


def var(n):
    out = bytearray([n & 0x7F])
    n >>= 7
    while n:
        out.insert(0, 0x80 | (n & 0x7F))
        n >>= 7
    return bytes(out)


def track(name, events, ch=0):
    """events: (time, kind, a, b) with kind 'on'/'cc'; 'on' is (time, 'on', note, (vel, length))."""
    ev = []
    for t, kind, a, b in events:
        if kind == 'on':
            vel, length = b
            ev.append((t, 1, bytes([0x90 | ch, a, vel])))
            ev.append((t + length, 0, bytes([0x80 | ch, a, 0])))
        else:
            ev.append((t, 2, bytes([0xB0 | ch, a, b])))
    ev.sort(key=lambda e: (e[0], e[1]))   # (offs before ons at the same time; CCs first of all)
    data = bytearray(var(0) + b'\xFF\x03' + var(len(name)) + name.encode())
    now = 0
    for t, _, msg in ev:
        data += var(t - now) + msg
        now = t
    data += var(bar(BARS) - now) + b'\xFF\x2F\x00'
    return b'MTrk' + struct.pack('>I', len(data)) + data


def notes(spec, vel=100, ch=0):
    return [(t, 'on', n, (vel, l)) for t, n, l in spec]


lead = [(bar(b, s), n, l * S - 10) for b, s, l, n in MELODY]
arp = []   # pulse 2: the chord as a running 16th arpeggio, up an octave
for b, ch in enumerate(CHORDS):
    for i in range(16):
        arp.append((bar(b, i), ch[[0, 1, 2, 1][i % 4]] + 12, S - 20))
bass = []
for b, r in enumerate(ROOTS):
    for s, oct_ in ((0, 0), (3, 12), (6, 0), (8, 0), (11, 12), (14, 0)):
        bass.append((bar(b, s), r + oct_, S * 2 - 30))
drums = []
for b in range(BARS):
    for s in range(0, 16, 2):
        drums.append((bar(b, s), 42, S // 2))          # closed hats on 8ths
    for s in (0, 6, 8):
        drums.append((bar(b, s), 36, S))                # kick
    for s in (4, 12):
        drums.append((bar(b, s), 38, S))                # snare
drums.append((bar(0), 49, Q))                           # a crash at the top
epiano = []
for b, ch in enumerate(CHORDS):
    for s in (0, 6, 10):                                # a syncopated comp
        epiano += [(bar(b, s), n, S * 3 - 20) for n in ch]
strings = []
for b, ch in enumerate(CHORDS):
    strings += [(bar(b), n + 12, 4 * Q - 40) for n in ch]

tracks = [
    track('GB Pulse 1', [(0, 'cc', 12, 64)] + notes(lead, 112)),
    track('GB Pulse 2', [(0, 'cc', 12, 32)] + notes(arp, 64)),
    track('GB Wave', [(0, 'cc', 13, 100)] + notes(bass, 112)),
    track('GB Noise', notes(drums, 96)),
    track('PS1 Synth Lead', [(0, 'cc', 91, 50), (0, 'cc', 10, 64)] + notes(lead, 100)),
    track('PS1 EPiano', [(0, 'cc', 91, 40), (0, 'cc', 10, 44)] + notes(epiano, 80)),
    track('PS1 Strings', [(0, 'cc', 91, 80), (0, 'cc', 10, 84), (0, 'cc', 7, 70)] + notes(strings, 70)),
    track('PS1 Slap Bass', [(0, 'cc', 91, 10)] + notes(bass, 104)),
    track('PS1 Drums', [(0, 'cc', 91, 30)] + notes(drums, 100, ch=9), ch=9),
]
tempo = 60_000_000 // BPM
conductor = (var(0) + b'\xFF\x03' + var(5) + b'Tempo' + var(0) + b'\xFF\x51\x03' + tempo.to_bytes(3, 'big')
             + var(0) + b'\xFF\x58\x04\x04\x02\x18\x08' + var(bar(BARS)) + b'\xFF\x2F\x00')
with open(OUT, 'wb') as f:
    f.write(b'MThd' + struct.pack('>IHHH', 6, 1, len(tracks) + 1, PPQ))
    f.write(b'MTrk' + struct.pack('>I', len(conductor)) + conductor)
    for t in tracks:
        f.write(t)
print('wrote', OUT)
