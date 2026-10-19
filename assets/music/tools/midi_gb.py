#!/usr/bin/env python3
"""Converts the song(s) to GelatoBoy music data: gb/music/song.c, played by
gb/music/music.c. It reads the "GB ..." tracks (see CHANNELS below).

    python3 assets/music/tools/midi_gb.py [song1.mid [song2.mid ...]]

With no arguments, song 1 is assets/music/song.mid, or demo.mid if there isn't one.

Each channel's events are a byte stream:

    [gap] [op ...] [gap] [op ...] ... [gap] FF

- gap: ticks (1/48 beat) since the last event, as a byte; 255 means "255
  more, and read another byte".
- op 00: note off. op 01-7F: note on (the MIDI note; for the noise channel,
  the drum 1-6 instead), then a byte: the volume 1-15. op 80-83: set the
  duty (squares) or the wave shape (wave channel) to 0-3. FF: no more events.

and each bar has a seek entry per channel (where its next event is, when,
and the duty or shape in force), so the driver can jump anywhere quickly.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import midi  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(ROOT, 'gb', 'music', 'song.c')
BAR = midi.TICKS_PER_BAR

CHANNELS = [   # (track name, kind, CC that sets its param, the default param, range)
    ('GB Pulse 1', 'square', 12, 2, (36, 108)),
    ('GB Pulse 2', 'square', 12, 1, (36, 108)),
    ('GB Wave', 'wave', 13, 0, (24, 96)),
    ('GB Noise', 'noise', None, 0, None),
]
# GM drum notes -> the driver's drums (1 kick, 2 snare, 3 closed hat, 4 open hat, 5 crash, 6 other),
# and which wins when two land together
DRUMS = {35: 1, 36: 1, 38: 2, 40: 2, 37: 2, 39: 2, 42: 3, 44: 3, 46: 4, 49: 5, 57: 5, 51: 3, 59: 3}
DRUM_PRIORITY = {5: 5, 2: 4, 1: 3, 4: 2, 6: 1, 3: 0}


def channel_events(song, track, kind, cc, default, rng, warn):
    """(tick, op, arg or None) for one channel, in order."""
    events = []
    if not track:
        return events, []
    # the param changes (CC), as a duty or shape 0-3, only when it changes
    params = [(0, default)]
    if cc is not None:
        for t, c, v, _ in track.ccs:
            if c == cc and t < song.end:
                params.append((t, v // 32))
    params.sort(key=lambda p: p[0])
    p_events, cur = [], default
    for t, v in params:
        if t == 0 and v != default:
            cur = v
            p_events = [(0, 0x80 | v, None)]
        elif v != cur:
            cur = v
            p_events.append((t, 0x80 | v, None))
    if p_events and p_events[0][0] == 0 and default == (p_events[0][1] & 3):
        p_events = p_events[1:]
    # the notes: one at a time
    by_start = {}
    for n in track.notes:
        if n[0] < song.end:
            by_start.setdefault(n[0], []).append(n)
    starts = sorted(by_start)
    chosen, dropped = [], 0
    for t in starts:
        group = by_start[t]
        if kind == 'noise':
            hits = [(DRUMS.get(n[2], 6), n) for n in group]
            hits.sort(key=lambda h: -DRUM_PRIORITY[h[0]])
            drum, n = hits[0]
            chosen.append((t, n[1], drum, n[3]))
        else:
            # the lead plays the top note, the bass the bottom one
            n = max(group, key=lambda n: n[2]) if kind == 'square' else min(group, key=lambda n: n[2])
            note = n[2]
            lo, hi = rng
            if not lo <= note <= hi:
                shifted = note
                while shifted < lo:
                    shifted += 12
                while shifted > hi:
                    shifted -= 12
                warn(f'{track.name}: note {note} at bar {t // BAR + 1} is out of range: played as {shifted}')
                note = shifted
            chosen.append((t, n[1], note, n[3]))
        dropped += len(group) - 1
    if dropped:
        warn(f'{track.name}: {dropped} notes at the same time as another dropped (the GB plays one at a time per channel'
             + (': the drum that matters most is kept' if kind == 'noise' else '') + ')')
    notes = []
    for i, (t, length, note, vel) in enumerate(chosen):
        vol = max(1, min(15, vel // 8))
        notes.append((t, note, vol))
        if kind != 'noise':
            end = min(t + length, song.end)
            nxt = chosen[i + 1][0] if i + 1 < len(chosen) else None
            if nxt is None or end < nxt:
                notes.append((end, 0, None))
    # merged: at the same tick, an off before a param before a note on
    order = lambda e: (e[0], 0 if e[1] == 0 else 1 if e[1] & 0x80 else 2)
    events = sorted([e for e in notes if e[0] < song.end or e[1] == 0] + p_events, key=order)
    events = [e for e in events if e[0] < song.end]
    return events, params


def encode(events):
    """The byte stream, and each event's (offset of its op, tick)."""
    out, where, now = bytearray(), [], 0
    for t, op, arg in events + [(None, 0xFF, None)]:
        gap = 0 if t is None else t - now
        while gap >= 255:
            out.append(255)
            gap -= 255
        out.append(gap)
        if t is not None:
            now = t
        where.append((len(out), now if t is not None else None))
        out.append(op)
        if arg is not None:
            out.append(arg)
    return out, where


def convert(path, n):
    song = midi.read(path)
    warnings = list(song.warnings)
    warn = warnings.append
    streams, seeks = [], []
    bars = song.end // BAR
    for name, kind, cc, default, rng in CHANNELS:
        track = song.find(name)
        if not track:
            warn(f'no "{name}" track: that channel stays quiet')
        events, params = channel_events(song, track, kind, cc, default, rng, warn)
        data, where = encode(events)
        streams.append(data)
        # per bar: the first event at or after it, and the param in force there
        entries = []
        for b in range(bars):
            t0 = b * BAR
            idx = next((i for i, e in enumerate(events) if e[0] >= t0), len(events))
            off, tick = where[idx]
            p = default
            for e in events:
                if e[0] < t0 and e[1] & 0x80 and e[1] != 0xFF:
                    p = e[1] & 3
            entries.append((off, tick if tick is not None else 0xFFFF, p))
        seeks.append(entries)
    tpf = round(song.bpm * 48 / 3600 * 4096)
    lines = []
    for ch, data in enumerate(streams):
        body = ', '.join(f'0x{b:02X}' for b in data)
        lines.append(f'static const uint8_t song{n}_ch{ch}[{len(data)}] = {{ {body} }};')
    seek_rows = []
    for b in range(bars):
        seek_rows.append('    ' + ', '.join(f'{{ {seeks[ch][b][0]}, {seeks[ch][b][1]}, {seeks[ch][b][2]} }}' for ch in range(4)) + ',')
    lines.append(f'static const music_seek_t song{n}_seek[{bars * 4}] = {{\n' + '\n'.join(seek_rows) + '\n};')
    lines.append(f'static const song_t song{n} = {{ {tpf}, {song.end}, {song.loop}, {bars}, '
                 f'{{ song{n}_ch0, song{n}_ch1, song{n}_ch2, song{n}_ch3 }}, song{n}_seek }};')
    size = sum(len(d) for d in streams) + bars * 4 * 5
    return '\n'.join(lines), size, song, warnings


def main(paths):
    if not paths:
        # song 1 (the platformer's), then the fighter's and the shooter's (make_songs.py)
        music = os.path.join(ROOT, 'assets', 'music')
        own = os.path.join(music, 'song.mid')
        paths = [own if os.path.exists(own) else os.path.join(music, 'demo.mid')]
        paths += [p for p in (os.path.join(music, 'fighter.mid'), os.path.join(music, 'shooter.mid')) if os.path.exists(p)]
    parts = []
    for i, p in enumerate(paths, 1):
        text, size, song, warnings = convert(p, i)
        rel = os.path.relpath(p, ROOT)
        print(f'song {i}: {rel}: {song.bpm:g} BPM, {song.end // BAR} bars, {size} bytes')
        for w in warnings:
            print('  warning:', w)
        parts.append(f'/* song {i}: {rel} */\n' + text)
    names = ', '.join(f'&song{i}' for i in range(1, len(paths) + 1))
    with open(OUT, 'w') as f:
        f.write('/* Generated by assets/music/tools/midi_gb.py: do not edit. */\n#include "music.h"\n\n')
        f.write('\n\n'.join(parts))
        f.write(f'\n\nconst song_t *const music_songs[] = {{ {names} }};\nconst uint8_t music_song_count = {len(paths)};\n')
    print('wrote', os.path.relpath(OUT, ROOT))


if __name__ == '__main__':
    main(sys.argv[1:])
