#!/usr/bin/env python3
"""Writes the games' own songs (ours, composed here), with every track the
converters know, like demo.mid (make_demo.py):

  fighter.mid   Vanilla Fighter: A minor, 152 BPM, 16 bars, driving and punchy
  shooter.mid   License to Chill: E minor, 118 BPM, 16 bars, a cool spy-surf groove

    python3 assets/music/tools/make_songs.py
"""
import os
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
MUSIC = os.path.join(HERE, '..')
PPQ = 480
Q = PPQ            # a beat
S = PPQ // 4       # a 16th


def var(n):
    out = bytearray([n & 0x7F])
    n >>= 7
    while n:
        out.insert(0, 0x80 | (n & 0x7F))
        n >>= 7
    return bytes(out)


def at(b, sixteenth=0):
    return b * 4 * Q + sixteenth * S


def write(name, bpm, bars, parts):
    """parts: [(track name, [cc (number, value)], [(time, note, length, velocity)], midi channel)]."""
    def track(tname, ccs, ns, ch):
        ev = [(0, 0, bytes([0xB0 | ch, c, v])) for c, v in ccs]
        for t, n, l, vel in ns:
            ev.append((t, 2, bytes([0x90 | ch, n, vel])))
            ev.append((t + l, 1, bytes([0x80 | ch, n, 0])))
        ev.sort(key=lambda e: (e[0], e[1]))   # (CCs first, then offs before ons at the same time)
        data = bytearray(var(0) + b'\xFF\x03' + var(len(tname)) + tname.encode())
        now = 0
        for t, _, msg in ev:
            data += var(t - now) + msg
            now = t
        data += var(at(bars) - now) + b'\xFF\x2F\x00'
        return b'MTrk' + struct.pack('>I', len(data)) + data
    tempo = 60_000_000 // bpm
    conductor = (var(0) + b'\xFF\x03' + var(5) + b'Tempo' + var(0) + b'\xFF\x51\x03' + tempo.to_bytes(3, 'big')
                 + var(0) + b'\xFF\x58\x04\x04\x02\x18\x08' + var(at(bars)) + b'\xFF\x2F\x00')
    path = os.path.join(MUSIC, name)
    with open(path, 'wb') as f:
        f.write(b'MThd' + struct.pack('>IHHH', 6, 1, len(parts) + 1, PPQ))
        f.write(b'MTrk' + struct.pack('>I', len(conductor)) + conductor)
        for p in parts:
            f.write(track(*p))
    print('wrote', path)


def melody(spec, vel=110, gap=12):
    """spec: (bar, 16th, length in 16ths, note)."""
    return [(at(b, s), n, l * S - gap, vel) for b, s, l, n in spec]


# --- Vanilla Fighter ----------------------------------------------------------
# A (bars 0-7): Am F G Em, twice; B (8-15): F G Am Am, F G E E (the E major
# lifting it back to the top).
def fighter():
    A, F, G, Em, E = (57, 60, 64), (53, 57, 60), (55, 59, 62), (52, 55, 59), (52, 56, 59)
    chords = [A, F, G, Em, A, F, G, Em, F, G, A, A, F, G, E, E]
    roots = [45, 41, 43, 40, 45, 41, 43, 40, 41, 43, 45, 45, 41, 43, 40, 40]
    lead = [
        # the riff (twice, the second time up at the end)
        (0, 0, 2, 69), (0, 3, 1, 72), (0, 4, 2, 74), (0, 6, 2, 72), (0, 8, 3, 76), (0, 11, 1, 74), (0, 12, 4, 72),
        (1, 0, 2, 69), (1, 3, 1, 72), (1, 4, 2, 74), (1, 6, 2, 76), (1, 8, 6, 77),
        (2, 0, 2, 79), (2, 3, 1, 77), (2, 4, 2, 76), (2, 6, 2, 74), (2, 8, 3, 74), (2, 11, 1, 76), (2, 12, 4, 79),
        (3, 0, 6, 76), (3, 8, 2, 74), (3, 10, 2, 72), (3, 12, 4, 71),
        (4, 0, 2, 69), (4, 3, 1, 72), (4, 4, 2, 74), (4, 6, 2, 72), (4, 8, 3, 76), (4, 11, 1, 74), (4, 12, 4, 72),
        (5, 0, 2, 69), (5, 3, 1, 72), (5, 4, 2, 74), (5, 6, 2, 76), (5, 8, 6, 77),
        (6, 0, 2, 79), (6, 3, 1, 81), (6, 4, 2, 83), (6, 6, 2, 81), (6, 8, 4, 79), (6, 12, 4, 83),
        (7, 0, 12, 84),
        # B: longer notes, climbing
        (8, 0, 6, 81), (8, 6, 2, 79), (8, 8, 8, 77),
        (9, 0, 6, 79), (9, 6, 2, 77), (9, 8, 8, 74),
        (10, 0, 4, 76), (10, 4, 4, 77), (10, 8, 4, 79), (10, 12, 4, 81),
        (11, 0, 12, 84), (11, 12, 2, 83), (11, 14, 2, 81),
        (12, 0, 6, 81), (12, 6, 2, 79), (12, 8, 8, 77),
        (13, 0, 6, 79), (13, 6, 2, 81), (13, 8, 8, 83),
        (14, 0, 4, 80), (14, 4, 4, 83), (14, 8, 4, 86), (14, 12, 4, 83),
        (15, 0, 8, 88), (15, 8, 2, 86), (15, 10, 2, 83), (15, 12, 2, 80), (15, 14, 2, 76),
    ]
    lead = melody(lead, 112)
    # pulse 2: power-chord stabs on the offbeats (root and fifth, up an octave)
    stabs = []
    for b, ch in enumerate(chords):
        for s in (2, 6, 10, 14):
            stabs.append((at(b, s), ch[0] + 12, S - 20, 70))
    # bass: driving 8ths, octave jumps on the "and" of 4
    bass = []
    for b, r in enumerate(roots):
        for s in range(0, 16, 2):
            bass.append((at(b, s), r + (12 if s == 14 else 0), S * 2 - 40, 112))
    # drums: kick on the beats, snare on 2 and 4, 16th hats, a fill every 4 bars
    drums = []
    for b in range(16):
        for s in range(16):
            drums.append((at(b, s), 42, S // 2, 70 if s % 2 else 90))
        for s in (0, 4, 8, 12) if b % 4 != 3 else (0, 4, 8):
            drums.append((at(b, s), 36, S, 110))
        for s in (4, 12) if b % 4 != 3 else (4,):
            drums.append((at(b, s), 38, S, 108))
        if b % 4 == 3:
            for s in (10, 11, 12, 13, 14, 15):
                drums.append((at(b, s), 38 if s % 2 else 45, S, 100))
        if b % 8 == 0:
            drums.append((at(b), 49, Q, 110))
    strings = []
    for b, ch in enumerate(chords):
        strings += [(at(b), n + 12, 4 * Q - 40, 70) for n in ch]
    write('fighter.mid', 152, 16, [
        ('GB Pulse 1', [(12, 64)], lead, 0),
        ('GB Pulse 2', [(12, 16)], stabs, 1),
        ('GB Wave', [(13, 100)], bass, 2),
        ('GB Noise', [], drums, 3),
        ('PS1 Synth Lead', [(91, 40), (10, 64)], [(t, n, l, v - 10) for t, n, l, v in lead], 4),
        ('PS1 Strings', [(91, 80), (10, 80), (7, 72)], strings, 5),
        ('PS1 Slap Bass', [(91, 10)], bass, 6),
        ('PS1 Drums', [(91, 25)], drums, 9),
    ])


# --- License to Chill -----------------------------------------------------------
# A spy groove in E minor: the line inside the chord falls by half steps
# (E, D#, D, C# over Em) while the bass walks a surf riff; B goes to C and B7.
def shooter():
    inner = [64, 63, 62, 61]          # E4 D#4 D4 C#4: one a bar, over Em
    roots = [40] * 4 + [40] * 4 + [48, 48, 47, 47, 45, 45, 47, 47]   # E E E E E E E E | C C B B A A B B
    chords = {40: (52, 55, 59), 48: (48, 52, 55), 47: (47, 51, 54), 45: (45, 48, 52)}
    lead = [
        # A: a cool, laid-back tune (bars 0-7)
        (0, 0, 3, 76), (0, 4, 2, 79), (0, 6, 6, 78), (0, 12, 4, 76),
        (1, 0, 8, 71), (1, 10, 2, 74), (1, 12, 4, 76),
        (2, 0, 3, 76), (2, 4, 2, 79), (2, 6, 6, 81), (2, 12, 4, 79),
        (3, 0, 12, 78),
        (4, 0, 3, 76), (4, 4, 2, 79), (4, 6, 6, 78), (4, 12, 4, 76),
        (5, 0, 8, 71), (5, 10, 2, 74), (5, 12, 4, 71),
        (6, 0, 4, 69), (6, 4, 4, 71), (6, 8, 4, 74), (6, 12, 4, 71),
        (7, 0, 12, 76),
        # B: up over C and B
        (8, 0, 6, 79), (8, 6, 2, 76), (8, 8, 8, 72),
        (9, 0, 4, 76), (9, 4, 4, 79), (9, 8, 8, 84),
        (10, 0, 6, 83), (10, 6, 2, 78), (10, 8, 8, 75),
        (11, 0, 4, 78), (11, 4, 4, 81), (11, 8, 8, 83),
        (12, 0, 6, 81), (12, 6, 2, 76), (12, 8, 8, 72),
        (13, 0, 4, 76), (13, 4, 4, 81), (13, 8, 8, 84),
        (14, 0, 4, 83), (14, 4, 4, 81), (14, 8, 4, 78), (14, 12, 4, 75),
        (15, 0, 8, 71), (15, 8, 8, 0),
    ]
    lead = melody([n for n in lead if n[3]], 104, gap=20)
    # pulse 2: the falling inner line (A), then the chords as gentle arpeggios (B)
    line = []
    for b in range(8):
        for s in (0, 6, 8, 14):
            line.append((at(b, s), inner[b % 4], S * 2 - 20, 60))
    for b in range(8, 16):
        ch = chords[roots[b]]
        for i, s in enumerate(range(0, 16, 2)):
            line.append((at(b, s), ch[[0, 1, 2, 1][i % 4]] + 12, S * 2 - 30, 52))
    # bass: the surf riff (root, octave, fifth, flat seven), swung a little
    bass = []
    for b, r in enumerate(roots):
        for s, d in ((0, 0), (3, 12), (4, 7), (6, 10), (8, 0), (11, 12), (12, 7), (14, 5)):
            bass.append((at(b, s), r + d, S * 2 - 50, 108))
    drums = []
    for b in range(16):
        for s in range(0, 16, 2):
            drums.append((at(b, s) + (S // 4 if s % 4 == 2 else 0), 42, S // 2, 64))   # (swung hats)
        drums += [(at(b, 0), 36, S, 104), (at(b, 7), 36, S, 80), (at(b, 10), 36, S, 96)]
        drums += [(at(b, 4), 38, S, 96), (at(b, 12), 38, S, 100)]
        if b % 4 == 3:
            drums.append((at(b, 14), 46, S * 2, 80))
        if b % 8 == 0:
            drums.append((at(b), 49, Q, 100))
    bells = []   # a spy sting at the top of each half: E5 G5 B5, D#6
    for b in (0, 8):
        bells += [(at(b, 0), 76, S * 2, 80), (at(b, 2), 79, S * 2, 80), (at(b, 4), 83, S * 2, 84), (at(b, 6), 87, S * 6, 90)]
    pad = []
    for b in range(16):
        ch = chords[roots[b]]
        pad += [(at(b), n + 12, 4 * Q - 40, 60) for n in ch]
    write('shooter.mid', 118, 16, [
        ('GB Pulse 1', [(12, 32)], lead, 0),
        ('GB Pulse 2', [(12, 0)], line, 1),
        ('GB Wave', [(13, 110)], bass, 2),
        ('GB Noise', [], drums, 3),
        ('PS1 Synth Lead', [(91, 60), (10, 64)], [(t, n, l, v - 8) for t, n, l, v in lead], 4),
        ('PS1 EPiano', [(91, 50), (10, 44)], line, 5),
        ('PS1 Pad', [(91, 90), (10, 84), (7, 64)], pad, 6),
        ('PS1 Bells', [(91, 90), (10, 70)], bells, 7),
        ('PS1 Slap Bass', [(91, 10)], bass, 8),
        ('PS1 Drums', [(91, 30)], drums, 9),
    ])


fighter()
shooter()
