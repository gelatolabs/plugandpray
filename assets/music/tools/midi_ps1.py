#!/usr/bin/env python3
"""MIDI -> the GelatoStation's music: writes ps1/common/song.c and song.h
from the songs (song 1: assets/music/song.mid, or demo.mid without one; then
fighter.mid and shooter.mid) and the instrument kit (assets/music/kit:
its WAVs, encoded here as SPU ADPCM).

- Tracks: "PS1 <kit instrument>" and "PS1 Drums" (by name).
- Voices 8-23 (16) are handed out here, note by note, ahead of time: a voice
  is busy from its note's start until its release has died away (drums: the
  length of the sample). With none free, the oldest note is cut (a warning).
- CC 7 (volume), 10 (pan) and 91 (reverb: on or off per voice, the SPU's
  reverb has no send level) become events; velocity scales each note.
- The kit's envelopes (seconds) become SPU ADSR settings.

    python3 assets/music/tools/midi_ps1.py [song.mid ...]
"""
import json
import math
import os
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import adpcm  # noqa: E402
import midi  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
MUSIC = os.path.join(ROOT, 'assets', 'music')
KIT = os.path.join(MUSIC, 'kit')
OUT_C = os.path.join(ROOT, 'ps1', 'common', 'song.c')
OUT_H = os.path.join(ROOT, 'ps1', 'common', 'song.h')

KIT_ADDR = 0x1800                  # SPU RAM: above the sound effects' waves (sfx.c: 0x1010-0x141f)
REVERB_SIZE = 0xADE0               # the Hall preset's work area, at the top of sound RAM
SPU_RAM = 0x80000
VOICE0, VOICES = 8, 16             # voices 0-7 are the sound effects'
EV_ON, EV_OFF, EV_CC = 1, 2, 3


# --- the SPU's envelope -----------------------------------------------------

def _rate(rate, increase):
    """(step, cycles) for an envelope rate 0-127 (psx-spx: SPU ADSR)."""
    shift, s = rate >> 2, rate & 3
    step = (7 - s) if increase else (-8 + s)
    cycles = 1 << max(0, shift - 11)
    step <<= max(0, 11 - shift)
    return step, cycles


def attack_time(rate):
    """Seconds for a linear attack from 0 to full."""
    step, cycles = _rate(rate, True)
    return math.ceil(32767 / step) * cycles / 44100


def fade_time(rate, floor=33):
    """Seconds for an exponential decrease from full to -60 dB."""
    step, cycles = _rate(rate, False)
    level, n = 32767, 0
    while level > floor:
        d = (step * level) >> 15
        if d == 0:
            return float('inf')
        level += d
        n += cycles
        if n > 44100 * 600:
            return float('inf')
    return n / 44100


def nearest(values, want, fn):
    return min(values, key=lambda r: abs(math.log(max(fn(r), 1e-4)) - math.log(max(want, 1e-4))))


def adsr(envelope):
    """kit.json's envelope (seconds) -> the SPU's ADSR1, ADSR2."""
    ar = nearest(range(128), envelope['attack'], attack_time) if envelope['attack'] > 0.001 else 0
    dr, sl = 0, 15                                   # (no decay: straight to the sustain, full)
    if envelope.get('sustain_fade'):                 # sustaining, it fades (a piano, a bell)
        smode, sdir = 1, 1
        sr = nearest(range(128), envelope['sustain_fade'], fade_time)
    else:                                            # it holds
        smode, sdir, sr = 0, 1, 127
    rmode = 1
    rr = nearest(range(32), envelope['release'], lambda r: fade_time(r * 4)) if envelope['release'] > 0.003 else 0
    adsr1 = (0 << 15) | (ar << 8) | (dr << 4) | sl
    adsr2 = (smode << 15) | (sdir << 14) | (sr << 6) | (rmode << 5) | rr
    return adsr1, adsr2, fade_time(rr * 4)


# --- the kit ------------------------------------------------------------------

def read_wav(path):
    with wave.open(path) as w:
        assert w.getnchannels() == 1 and w.getsampwidth() == 2, f'{path}: needs 16-bit mono'
        return np.frombuffer(w.readframes(w.getnframes()), '<i2'), w.getframerate()


def load_kit():
    """The kit as SPU instruments: [{name, data (ADPCM), loop (byte offset or None),
    pitch, root, vol, adsr1, adsr2, release (s), oneshot, seconds}], and the drum map."""
    kit = json.load(open(os.path.join(KIT, 'kit.json')))
    insts = []
    for name, d in kit['instruments'].items():
        x, _ = read_wav(os.path.join(KIT, d['file']))
        ls, le = d['loop']
        data, _ = adpcm.encode(x[:le], ls)
        a1, a2, rel = adsr(d['envelope'])
        insts.append(dict(name=name, data=data, loop=ls // 28 * 16, rate=d['rate'], root=d['root'],
                          vol=d['volume'], adsr1=a1, adsr2=a2, release=rel, oneshot=False, seconds=None))
    drums = {}
    for name, d in kit['drums'].items():
        x, rate = read_wav(os.path.join(KIT, d['file']))
        data, _ = adpcm.encode(x)
        a1, a2, _ = adsr(dict(attack=0, sustain_fade=0, release=0.05))
        drums[name] = len(insts)
        insts.append(dict(name=name, data=data, loop=None, rate=d['rate'], root=0, vol=d['volume'],
                          adsr1=a1, adsr2=a2, release=0, oneshot=True, seconds=len(x) / rate))
    drum_map = {int(n): drums[name] for n, name in kit['drum_map'].items()}
    return insts, drum_map


# --- the song ----------------------------------------------------------------

def match_track(name, insts):
    """'PS1 Slap Bass (verse)' -> the kit instrument it names, 'drums', or None."""
    words = name.lower().split()
    if not words or words[0] != 'ps1':
        return None
    rest = words[1:]
    names = sorted([i['name'] for i in insts if not i['oneshot']] + ['Drums'], key=len, reverse=True)
    for n in names:
        w = n.lower().split()
        for i in range(len(rest) - len(w) + 1):
            if rest[i:i + len(w)] == w:
                return 'drums' if n == 'Drums' else n
    return None


def convert(path, insts, drum_map, warn):
    song = midi.read(path)
    for w in song.warnings:
        warn(w)
    by_name = {i['name']: k for k, i in enumerate(insts)}
    tps = song.bpm * midi.TICKS_PER_BEAT / 60          # ticks a second
    tracks, notes = [], []                             # notes: (start, end, busy, track, inst, note, vel)
    for t in song.tracks:
        kind = match_track(t.name, insts)
        if kind is None:
            if t.name.lower().startswith('ps1'):
                warn(f'"{t.name}": no instrument by that name in the kit: left out')
            continue
        ti = len(tracks)
        tracks.append((t.name, t.ccs))
        for tick, length, note, vel, _ in t.notes:
            if kind == 'drums':
                inst = drum_map.get(note)
                if inst is None:
                    warn(f'"{t.name}": no drum on note {note}: left out')
                    continue
                busy = tick + max(length, math.ceil(insts[inst]['seconds'] * tps))
            else:
                inst = by_name[kind]
                busy = tick + length + math.ceil(min(insts[inst]['release'], 4) * tps)
            notes.append((tick, tick + length, busy, ti, inst, note, vel))
    notes.sort(key=lambda n: (n[0], n[5]))

    # the voices: free the longest, or else the oldest note's (cut short)
    free_at = [0] * VOICES
    started = [-1] * VOICES
    owner = [None] * VOICES
    assigned, cut = [], 0
    for k, (start, end, busy, ti, inst, note, vel) in enumerate(notes):
        free = [v for v in range(VOICES) if free_at[v] <= start]
        if free:
            v = min(free, key=lambda v: free_at[v])
        else:
            v = min(range(VOICES), key=lambda v: started[v])
            cut += 1
        free_at[v], started[v], owner[v] = busy, start, k
        assigned.append(v)
    if cut:
        warn(f'{cut} note(s) cut short: more than {VOICES} at once')

    last = song.end - 1
    events = []   # (tick, order, type, voice, inst, note, vel, track)
    for ti, (_, ccs) in enumerate(tracks):
        for tick, cc, value, _ in ccs:
            if cc in (7, 10, 91):
                events.append((min(tick, last), 0, EV_CC, 0, 0, cc, value, ti))
    # a note's off, unless its voice has been given to another note by then
    next_on = {}
    for k in range(len(notes) - 1, -1, -1):
        v = assigned[k]
        start, end, busy, ti, inst, note, vel = notes[k]
        nxt = next_on.get(v)
        events.append((min(start, last), 2, EV_ON, VOICE0 + v, inst, note, vel, ti))
        if not insts[inst]['oneshot'] and (nxt is None or nxt >= end):
            events.append((min(end, last), 1, EV_OFF, VOICE0 + v, 0, 0, 0, ti))
        next_on[v] = start
    events.sort(key=lambda e: (e[0], e[1]))
    loop_event = next((i for i, e in enumerate(events) if e[0] >= song.loop), len(events))
    return song, tracks, events, loop_event


def c_array(name, data, ctype='uint8_t', per_line=24, attrs=''):
    lines = [f'const {ctype} {name}[{len(data)}]{attrs} = {{']
    for i in range(0, len(data), per_line):
        lines.append('    ' + ', '.join(str(b) for b in data[i:i + per_line]) + ',')
    lines.append('};')
    return '\n'.join(lines)


def main(paths):
    warnings = []

    def warn(w):
        warnings.append(w)
        print('warning:', w, file=sys.stderr)

    insts, drum_map = load_kit()
    # the kit in sound RAM: one blob, each sample 16-byte aligned (whole ADPCM blocks)
    blob = bytearray()
    for i in insts:
        i['addr'] = KIT_ADDR + len(blob)
        blob += i['data']
    blob += bytes((-len(blob)) % 64)                    # (DMA moves 64-byte blocks)
    top = KIT_ADDR + len(blob)
    assert top <= SPU_RAM - REVERB_SIZE, f'the kit ({len(blob)} bytes) runs into the reverb area'

    if not paths:
        # song 1 (the platformer's), then the fighter's and the shooter's (make_songs.py)
        song = os.path.join(MUSIC, 'song.mid')
        paths = [song if os.path.exists(song) else os.path.join(MUSIC, 'demo.mid')]
        paths += [p for p in (os.path.join(MUSIC, 'fighter.mid'), os.path.join(MUSIC, 'shooter.mid')) if os.path.exists(p)]
    songs = [convert(p, insts, drum_map, warn) for p in paths]

    c = ['/* Generated by assets/music/tools/midi_ps1.py from ' + ', '.join(os.path.relpath(p, ROOT) for p in paths)
         + ' and assets/music/kit: do not edit. */',
         '#include "music.h"', '#include "song.h"', '']
    c.append(c_array('music_kit', blob, 'uint8_t', attrs=' __attribute__((aligned(8)))'))
    c.append('')
    c.append(f'const music_inst_t music_insts[{len(insts)}] = {{')
    for i in insts:
        pitch = min(0x3FFF, round(i['rate'] * 4096 / 44100))
        loop = 0 if i['loop'] is None else i['addr'] + i['loop']
        c.append(f'    {{ 0x{i["addr"]:05x}, 0x{loop:05x}, {pitch}, {i["root"]}, {round(i["vol"] * 127)}, '
                 f'0x{i["adsr1"]:04x}, 0x{i["adsr2"]:04x}, {int(i["oneshot"])} }},   /* {i["name"]} */')
    c.append('};')
    c.append('')
    for n, (song, tracks, events, loop_event) in enumerate(songs, 1):
        tpf = round(song.bpm * 48 / 3600 * 65536)
        c.append(f'/* {os.path.basename(paths[n - 1])}: {song.bpm:.2f} BPM, {song.end // midi.TICKS_PER_BAR} bars, '
                 f'loops from tick {song.loop}; tracks: ' + ', '.join(t[0] for t in tracks) + ' */')
        c.append(f'static const music_event_t song{n}_events[{max(1, len(events))}] = {{')
        for e in events:
            c.append(f'    {{ {e[0]}, {e[2]}, {e[3]}, {e[4]}, {e[5]}, {e[6]}, {e[7]} }},')
        if not events:
            c.append('    { 0, 0, 0, 0, 0, 0, 0 },')
        c.append('};')
        c.append(f'static const song_t song{n} = {{ {tpf}, {song.end}, {song.loop}, {len(events)}, {loop_event}, '
                 f'{len(tracks)}, song{n}_events }};')
        c.append('')
    c.append(f'const song_t *const music_songs[{len(songs)}] = {{ ' + ', '.join(f'&song{n}' for n in range(1, len(songs) + 1)) + ' };')
    c.append(f'const uint8_t music_song_count = {len(songs)};')
    open(OUT_C, 'w').write('\n'.join(c) + '\n')

    h = ['/* Generated by assets/music/tools/midi_ps1.py: do not edit. */',
         '#ifndef GELATO_PS1_SONG_H', '#define GELATO_PS1_SONG_H', '#include <stdint.h>', '',
         f'#define MUSIC_KIT_ADDR   0x{KIT_ADDR:05x}   /* where the kit goes in sound RAM */',
         f'#define MUSIC_KIT_BYTES  {len(blob)}',
         f'#define MUSIC_INSTS      {len(insts)}',
         f'#define MUSIC_REVERB_ADDR 0x{SPU_RAM - REVERB_SIZE:05x}   /* the reverb\'s work area: the top of sound RAM */',
         f'#define MUSIC_TRACKS_MAX {max(1, max(len(s[1]) for s in songs))}',
         '', '#endif']
    open(OUT_H, 'w').write('\n'.join(h) + '\n')
    for (song, tracks, events, _), p in zip(songs, paths):
        print(f'{os.path.relpath(p, ROOT)}: {len(tracks)} PS1 tracks, {len(events)} events, kit {len(blob)} bytes '
              f'(sound RAM 0x{KIT_ADDR:05x}-0x{top:05x})')


if __name__ == '__main__':
    main(sys.argv[1:])
