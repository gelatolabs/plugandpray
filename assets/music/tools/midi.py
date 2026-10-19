"""A small standard MIDI file reader for the music converters (no installs).

    import midi
    song = midi.read('assets/music/demo.mid')
    song.bpm            # the first tempo (later tempo changes are ignored: see song.warnings)
    song.ppq            # the file's pulses per quarter note
    song.tracks         # [Track], in file order (the conductor track too, if it has notes)
    song.end            # where the song ends, in ticks: the last note's bar, rounded up
    song.loop           # where it loops back to, in ticks (0, or a marker named "loop")
    song.warnings       # [str]: things the converters should pass on

    track = song.find('GB Pulse 1')   # by name: case and extra words don't matter (None if absent)
    track.name
    track.notes         # [(tick, length, note, vel, channel)], sorted by tick then note
    track.ccs           # [(tick, cc, value, channel)], sorted by tick

Every time is in **ticks of 1/48 of a beat**: a 16th
is 12, a beat 48, a 4/4 bar 192. Times are rounded to the nearest tick, and a
note is at least one tick long. Formats 0 and 1, running status, and note-on
with velocity 0 as a note-off are all handled.
"""
import struct

TICKS_PER_BEAT = 48
TICKS_PER_BAR = 4 * TICKS_PER_BEAT


class Track:
    def __init__(self, name):
        self.name = name
        self.notes = []
        self.ccs = []

    def __repr__(self):
        return f'Track({self.name!r}, {len(self.notes)} notes, {len(self.ccs)} CCs)'


class Song:
    def __init__(self):
        self.ppq = 480
        self.bpm = 120.0
        self.tracks = []
        self.end = 0
        self.loop = 0
        self.warnings = []

    def find(self, name):
        """The first track whose name contains `name`'s words, ignoring case."""
        want = name.lower().split()
        for t in self.tracks:
            have = t.name.lower().split()
            # the words in order, next to each other (so "GB Pulse 1" doesn't match "GB Pulse 12")
            for i in range(len(have) - len(want) + 1):
                if have[i:i + len(want)] == want:
                    return t
        return None


def _var(data, i):
    n = 0
    while True:
        b = data[i]
        i += 1
        n = (n << 7) | (b & 0x7F)
        if not b & 0x80:
            return n, i


def read(path):
    data = open(path, 'rb').read()
    if data[:4] != b'MThd':
        raise ValueError(f'{path}: not a MIDI file')
    hlen = struct.unpack('>I', data[4:8])[0]
    fmt, ntracks, division = struct.unpack('>HHH', data[8:14])
    if division & 0x8000:
        raise ValueError(f'{path}: SMPTE time division is not supported (export with bars and beats)')
    song = Song()
    song.ppq = division
    i = 8 + hlen
    tempos, markers = [], []
    raw_tracks = []
    for _ in range(ntracks):
        while data[i:i + 4] != b'MTrk':   # (skip unknown chunks)
            if i + 8 > len(data):
                raise ValueError(f'{path}: truncated')
            i += 8 + struct.unpack('>I', data[i + 4:i + 8])[0]
        tlen = struct.unpack('>I', data[i + 4:i + 8])[0]
        j, end = i + 8, i + 8 + tlen
        i = end
        now, status = 0, 0
        name = None
        events = []   # (pulse, kind, ...)
        while j < end:
            delta, j = _var(data, j)
            now += delta
            b = data[j]
            if b == 0xFF:
                kind, j = data[j + 1], j + 2
                n, j = _var(data, j)
                body = data[j:j + n]
                j += n
                if kind == 0x51 and n == 3:
                    tempos.append((now, int.from_bytes(body, 'big')))
                elif kind == 0x03 and name is None:
                    name = body.decode('latin-1').strip()
                elif kind in (0x06, 0x01) and body.decode('latin-1').strip().lower() == 'loop':
                    markers.append(now)
                elif kind == 0x2F:
                    break
                continue
            if b in (0xF0, 0xF7):
                n, j = _var(data, j + 1)
                j += n
                continue
            if b & 0x80:
                status = b
                j += 1
            elif not status:
                raise ValueError(f'{path}: running status with no status')
            hi, ch = status & 0xF0, status & 0x0F
            if hi in (0xC0, 0xD0):
                args = (data[j],)
                j += 1
            else:
                args = (data[j], data[j + 1])
                j += 2
            if hi == 0x90 and args[1] > 0:
                events.append((now, 'on', ch, args[0], args[1]))
            elif hi == 0x80 or (hi == 0x90 and args[1] == 0):
                events.append((now, 'off', ch, args[0]))
            elif hi == 0xB0:
                events.append((now, 'cc', ch, args[0], args[1]))
        raw_tracks.append((name or f'Track {len(raw_tracks) + 1}', events))

    if tempos:
        tempos.sort()
        song.bpm = 60_000_000 / tempos[0][1]
        if any(t[1] != tempos[0][1] for t in tempos[1:]):
            song.warnings.append(f'the tempo changes during the song: using the first, {song.bpm:.1f} BPM')
    else:
        song.warnings.append('no tempo in the file: using 120 BPM')

    def tick(p):
        return round(p * TICKS_PER_BEAT / song.ppq)

    last = 0
    for name, events in raw_tracks:
        t = Track(name)
        sounding = {}   # (ch, note) -> [(start pulse, vel)]
        for ev in sorted(events, key=lambda e: (e[0], 0 if e[1] == 'off' else 1)):
            if ev[1] == 'on':
                sounding.setdefault((ev[2], ev[3]), []).append((ev[0], ev[4]))
            elif ev[1] == 'off':
                starts = sounding.get((ev[2], ev[3]))
                if starts:
                    p0, vel = starts.pop(0)
                    t0, t1 = tick(p0), tick(ev[0])
                    t.notes.append((t0, max(1, t1 - t0), ev[3], vel, ev[2]))
            else:
                t.ccs.append((tick(ev[0]), ev[3], ev[4], ev[2]))
        for (ch, note), starts in sounding.items():
            for p0, vel in starts:
                song.warnings.append(f'{name}: a note {note} with no end: given a beat')
                t.notes.append((tick(p0), TICKS_PER_BEAT, note, vel, ch))
        t.notes.sort(key=lambda n: (n[0], n[2]))
        t.ccs.sort(key=lambda c: c[0])
        if t.notes or t.ccs:
            song.tracks.append(t)
        for n in t.notes:
            last = max(last, n[0] + n[1])
    # the end: the last note's bar, rounded up (an empty song is one bar)
    song.end = max(TICKS_PER_BAR, -(-last // TICKS_PER_BAR) * TICKS_PER_BAR)
    if markers:
        song.loop = min(tick(min(markers)), song.end - 1)
    return song


if __name__ == '__main__':
    import sys
    s = read(sys.argv[1])
    print(f'{s.bpm:.2f} BPM, ppq {s.ppq}, end {s.end} ticks ({s.end // TICKS_PER_BAR} bars), loop {s.loop}')
    for t in s.tracks:
        print(' ', t)
    for w in s.warnings:
        print('  warning:', w)
