#include <gb/gb.h>
#include <gb/hardware.h>
#include "music.h"
#include "../../shared/link.h"

extern uint8_t sfx_busy[4];   /* (gb/sfx.h) */

#define CH_SQ1 0
#define CH_SQ2 1
#define CH_WAVE 2
#define CH_NOISE 3
#define TICKS_PER_BAR 192

/* 11-bit frequency values for the squares, MIDI 36 (C2) to 108 (C8): 2048 - 131072 / Hz.
 * The wave channel runs an octave lower for the same value: its note n uses entry n + 12. */
#define NOTE_LO 36
#define NOTE_HI 108
static const uint16_t freqs[NOTE_HI - NOTE_LO + 1] = {
      44,  157,  263,  363,  457,  547,  631,  711,  786,  856,  923,  986,
    1046, 1102, 1155, 1205, 1253, 1297, 1339, 1379, 1417, 1452, 1486, 1517,
    1547, 1575, 1602, 1627, 1650, 1673, 1694, 1714, 1732, 1750, 1767, 1783,
    1798, 1812, 1825, 1837, 1849, 1860, 1871, 1881, 1890, 1899, 1907, 1915,
    1923, 1930, 1936, 1943, 1949, 1954, 1959, 1964, 1969, 1974, 1978, 1982,
    1985, 1989, 1992, 1995, 1998, 2001, 2004, 2006, 2009, 2011, 2013, 2015,
    2017,
};

/* the wave channel's shapes (CC 13): 32 4-bit samples each */
static const uint8_t shapes[4][16] = {
    { 0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF, 0xFE, 0xDC, 0xBA, 0x98, 0x76, 0x54, 0x32, 0x10 },   /* triangle */
    { 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF },   /* saw */
    { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 },   /* square */
    { 0x8B, 0xDE, 0xFF, 0xFF, 0xFF, 0xFE, 0xDB, 0x98, 0x74, 0x21, 0x00, 0x00, 0x00, 0x01, 0x24, 0x67 },   /* bass: a soft square */
};

/* the drums (noise): NR43 (shift << 4 | short << 3 | divider) and the envelope pace;
 * 1 kick, 2 snare, 3 closed hat, 4 open hat, 5 crash, 6 another hit */
static const uint8_t drum_poly[7] = { 0, 0x62, 0x31, 0x18, 0x10, 0x22, 0x44 };
static const uint8_t drum_pace[7] = { 0, 1, 2, 1, 3, 5, 2 };

static const song_t *song;
static const uint8_t *ptr[4];        /* each channel's next event (its op byte) */
static uint16_t next[4];             /* ... and when it's due, in ticks */
static uint8_t param[4];             /* duty / wave shape */
static uint8_t loaded_shape = 0xFF;  /* what's in wave RAM */
static uint16_t tick, frac;
static uint8_t audible, last_seq, last_song;

static uint8_t free_ch(uint8_t ch)
{
    return ch == CH_WAVE || !sfx_busy[ch];
}

static void silence(uint8_t ch)
{
    if (!free_ch(ch)) return;
    /* the channel's DAC off: silent (at volume 0 with the DAC on, a GB channel sits at full offset) */
    switch (ch) {
    case CH_SQ1: NR12_REG = 0x00; break;
    case CH_SQ2: NR22_REG = 0x00; break;
    case CH_WAVE: NR30_REG = 0x00; break;
    default: NR42_REG = 0x00; break;
    }
}

static void load_shape(uint8_t s)
{
    uint8_t i;
    volatile uint8_t *ram = (volatile uint8_t *)0xFF30;
    if (s == loaded_shape) return;
    NR30_REG = 0x00;   /* (wave RAM can only be written with the channel off) */
    for (i = 0; i < 16; i++) ram[i] = shapes[s][i];
    loaded_shape = s;
}

/* Sounds a note (vol 1-15). */
static void note_on(uint8_t ch, uint8_t note, uint8_t vol)
{
    vol = (uint8_t)((vol * 5 + 7) / 8);   /* (the music a little under the sound effects, so they stand out) */
    uint16_t x;
    if (!audible || !free_ch(ch)) return;
    if (ch == CH_NOISE) {
        if (note > 6) note = 6;
        NR41_REG = 0x00;
        NR42_REG = (uint8_t)((vol << 4) | drum_pace[note]);
        NR43_REG = drum_poly[note];
        NR44_REG = 0x80;
        return;
    }
    if (ch == CH_WAVE) note += 12;
    if (note < NOTE_LO) note = NOTE_LO;
    if (note > NOTE_HI) note = NOTE_HI;
    x = freqs[note - NOTE_LO];
    if (ch == CH_SQ1) {
        NR10_REG = 0x00;
        NR11_REG = (uint8_t)(param[ch] << 6);
        NR12_REG = (uint8_t)(vol << 4);
        NR13_REG = (uint8_t)x;
        NR14_REG = 0x80 | (uint8_t)(x >> 8);
    } else if (ch == CH_SQ2) {
        NR21_REG = (uint8_t)(param[ch] << 6);
        NR22_REG = (uint8_t)(vol << 4);
        NR23_REG = (uint8_t)x;
        NR24_REG = 0x80 | (uint8_t)(x >> 8);
    } else {
        load_shape(param[ch]);
        NR30_REG = 0x80;
        /* NR32: 1 = full, 2 = half, 3 = quarter */
        NR32_REG = (uint8_t)((vol >= 12 ? 1 : vol >= 6 ? 2 : 3) << 5);
        NR33_REG = (uint8_t)x;
        NR34_REG = 0x80 | (uint8_t)(x >> 8);
    }
}

/* Plays (or, while seeking, just steps over) a channel's next event and finds when
 * the one after it is due. play: 0 = silent seek. */
static void step(uint8_t ch, uint8_t play)
{
    const uint8_t *p = ptr[ch];
    uint8_t op = *p++, d;
    if (op == 0xFF) { next[ch] = 0xFFFF; ptr[ch] = p - 1; return; }   /* the end of its events */
    if (op & 0x80) param[ch] = op & 3;
    else if (op == 0) { if (play) silence(ch); }
    else {
        uint8_t vol = *p++;
        if (play) note_on(ch, op, vol);
    }
    /* the gap to the next one: a byte, 255 meaning "255 more, and read on" */
    while ((d = *p++) == 255) next[ch] += 255;
    next[ch] += d;
    ptr[ch] = p;
}

/* Goes to `target` (ticks) without playing anything on the way: each channel
 * from the bar's seek entry, stepping over the events before it. */
static void seek(uint16_t target)
{
    uint8_t ch, bar = (uint8_t)(target / TICKS_PER_BAR);
    if (bar >= song->bars) bar = song->bars - 1;
    for (ch = 0; ch < 4; ch++) {
        const music_seek_t *e = &song->seek[bar * 4 + ch];
        ptr[ch] = song->stream[ch] + e->off;
        next[ch] = e->tick;
        param[ch] = e->param;
        while (next[ch] < target) step(ch, 0);
        silence(ch);
    }
    tick = target;
}

void music_init(void)
{
    song = 0;
    last_seq = link_port.ctrl[CTRL_MUSIC_SEQ];
    last_song = 0;
    audible = 0;
}

void music_play(const song_t *s)
{
    song = s;
    frac = 0;
    seek(0);
}

void music_stop(void)
{
    uint8_t ch;
    for (ch = 0; ch < 4; ch++) silence(ch);
    song = 0;
}

uint16_t music_pos(void)
{
    return tick / 12;
}

void music_frame(void)
{
    uint8_t ch, s, on, seq;
    /* the channels the effects have had: theirs for a few more frames */
    for (ch = 0; ch < 4; ch++) if (sfx_busy[ch]) sfx_busy[ch]--;

    /* the host: which song, muted or not, and where to be */
    s = link_port.ctrl[CTRL_MUSIC_SONG];
    if (s != last_song) {
        last_song = s;
        if (s && s <= music_song_count) music_play(music_songs[s - 1]);
        else music_stop();
    }
    if (!song) return;
    on = link_port.ctrl[CTRL_MUSIC_ON] ? 1 : 0;
    if (on != audible) {
        audible = on;
        if (!on) for (ch = 0; ch < 4; ch++) silence(ch);
    }
    seq = link_port.ctrl[CTRL_MUSIC_SEQ];
    if (seq != last_seq) {
        uint16_t row = link_port.ctrl[CTRL_MUSIC_POS] | ((uint16_t)link_port.ctrl[CTRL_MUSIC_POS + 1] << 8);
        uint16_t t = row * 12;
        last_seq = seq;
        if (t >= song->end) t %= song->end;
        frac = 0;
        seek(t);
    }

    /* the clock */
    frac += song->tpf;
    while (frac >= 4096) { frac -= 4096; tick++; }
    if (tick >= song->end) {
        uint16_t over = tick - song->end;
        seek(song->loop);
        tick = song->loop + over;
    }
    /* what's due */
    for (ch = 0; ch < 4; ch++)
        while (next[ch] <= tick) step(ch, 1);

    {
        uint16_t row = tick / 12;
        link_port.state[STATE_MUSIC_POS] = (uint8_t)row;
        link_port.state[STATE_MUSIC_POS + 1] = (uint8_t)(row >> 8);
    }
}
