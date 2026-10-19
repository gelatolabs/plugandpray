#include <stdint.h>
#include <psxspu.h>
#include <hwregs_c.h>
#include "music.h"
#include "song.h"
#include "../../shared/link.h"

#define VOICE0  8                       /* the music's voices: 8-23 */
#define MUSIC_VOICES 0x00ffff00u
#define GAIN    120                     /* a note's loudest (velocity, volume and instrument all full): 0x3a98, under the SPU's 0x3fff */
#define REVERB_REG(i) _MMIO16((IOBASE | 0x1dc0) + 2 * (i))

/* The SPU's "Hall" reverb (psx-spx): its 32 registers, 1DC0h-1DFEh. Its work
 * area is 0xADE0 bytes, at the top of sound RAM. */
static const uint16_t hall[32] = {
    0x01A5, 0x0139, 0x6000, 0x5000, 0x4C00, 0xB800, 0xBC00, 0xC000,
    0x6000, 0x5C00, 0x15BA, 0x11BB, 0x14C2, 0x10BD, 0x11BC, 0x0DC1,
    0x11C0, 0x0DC3, 0x0DC0, 0x09C1, 0x0BC4, 0x07C1, 0x0A00, 0x06CD,
    0x09C2, 0x05C1, 0x05C0, 0x041A, 0x0274, 0x013A, 0x8000, 0x8000,
};
/* 2^(n/12) in 1/4096ths */
static const uint16_t semis[12] = { 4096, 4340, 4598, 4871, 5161, 5468, 5793, 6137, 6502, 6889, 7298, 7732 };

static const song_t *song;
static uint32_t pos;                    /* where it is: ticks, 16.16 */
static uint16_t ev;                     /* the next event */
static uint8_t audible, last_seq, last_song;
static uint8_t tvol[MUSIC_TRACKS_MAX], tpan[MUSIC_TRACKS_MAX], trev[MUSIC_TRACKS_MAX];
static uint32_t kon, koff, reverb;      /* voice bits: to key on and off this frame; the voices with reverb */
static uint32_t zeros[256];

static void upload(uint32_t addr, const uint32_t *data, uint32_t size)
{
    SpuSetTransferMode(SPU_TRANSFER_BY_DMA);
    SpuSetTransferStartAddr(addr);
    SpuWrite(data, size);
    SpuIsTransferCompleted(SPU_TRANSFER_WAIT);
}

void music_init(void)
{
    uint32_t a;
    int i;
    upload(MUSIC_KIT_ADDR, (const uint32_t *)music_kit, MUSIC_KIT_BYTES);
    /* the reverb: its work area cleared (or it plays back whatever's there), then on */
    SPU_CTRL &= ~0x0080;
    for (a = MUSIC_REVERB_ADDR; a < 0x80000; a += sizeof(zeros)) upload(a, zeros, sizeof(zeros));
    for (i = 0; i < 32; i++) REVERB_REG(i) = hall[i];
    SPU_REVERB_ADDR = MUSIC_REVERB_ADDR >> 3;
    SPU_REVERB_VOL_L = 0x2400;
    SPU_REVERB_VOL_R = 0x2400;
    SPU_CTRL |= 0x0080;
    SPU_REVERB_ON1 = 0;
    SPU_REVERB_ON2 = 0;
    song = 0;
    last_seq = link_port.ctrl[CTRL_MUSIC_SEQ];
    last_song = 0;
    audible = 0;
}

static void quiet(void)
{
    SpuSetKey(0, MUSIC_VOICES);
    kon = 0;
}

static void reset_tracks(void)
{
    int i;
    for (i = 0; i < MUSIC_TRACKS_MAX; i++) { tvol[i] = 100; tpan[i] = 64; trev[i] = 0; }
}

static uint16_t note_pitch(const music_inst_t *in, int note)
{
    int d, oct, s;
    uint32_t p;
    if (!in->root) return in->pitch;
    d = note - in->root;
    oct = d >= 0 ? d / 12 : -((11 - d) / 12);
    s = d - oct * 12;
    p = ((uint32_t)in->pitch * semis[s]) >> 12;
    p = oct >= 0 ? p << oct : p >> -oct;
    return (uint16_t)(p < 1 ? 1 : p > 0x3fff ? 0x3fff : p);
}

/* One event; `sound`: play its notes (not while muted, nor catching up) */
static void apply(const music_event_t *e, int sound)
{
    const music_inst_t *in;
    uint32_t bit, vol;
    switch (e->type) {
    case MUSIC_CC:
        if (e->note == 7) tvol[e->track] = e->vel;
        else if (e->note == 10) tpan[e->track] = e->vel;
        else if (e->note == 91) trev[e->track] = e->vel;
        break;
    case MUSIC_ON:
        if (!sound) break;
        in = &music_insts[e->inst];
        bit = 1u << e->voice;
        vol = ((uint32_t)e->vel * tvol[e->track] * in->vol) >> 14;   /* 0-125 */
        vol *= GAIN;
        SPU_CH_VOL_L(e->voice) = (uint16_t)(vol * (127 - tpan[e->track]) / 127);
        SPU_CH_VOL_R(e->voice) = (uint16_t)(vol * tpan[e->track] / 127);
        SPU_CH_FREQ(e->voice) = note_pitch(in, e->note);
        SPU_CH_ADDR(e->voice) = (uint16_t)(in->addr >> 3);
        SPU_CH_ADSR1(e->voice) = in->adsr1;
        SPU_CH_ADSR2(e->voice) = in->adsr2;
        if (trev[e->track]) reverb |= bit; else reverb &= ~bit;
        kon |= bit;
        koff &= ~bit;
        break;
    case MUSIC_OFF:   /* (the converter gives one-shots none) */
        bit = 1u << e->voice;
        koff |= bit;
        kon &= ~bit;
        break;
    }
}

/* To tick t (silently: what should be sounding starts at its next note) */
static void seek(uint16_t t)
{
    quiet();
    reset_tracks();
    for (ev = 0; ev < song->nevents && song->events[ev].tick < t; ev++)
        if (song->events[ev].type == MUSIC_CC) apply(&song->events[ev], 0);
    pos = (uint32_t)t << 16;
}

void music_play(const song_t *s)
{
    song = s;
    seek(0);
    /* (events at tick 0 go on the first frame, with the clock just past them) */
    pos = 0;
}

void music_stop(void)
{
    if (song) quiet();
    song = 0;
}

uint16_t music_pos(void)
{
    return song ? (uint16_t)((pos >> 16) / 12) : 0;
}

void music_frame(void)
{
    uint8_t s, on, seq;
    uint16_t now, row;
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
        if (!on) quiet();
    }
    seq = link_port.ctrl[CTRL_MUSIC_SEQ];
    if (seq != last_seq) {
        uint16_t t = (uint16_t)((link_port.ctrl[CTRL_MUSIC_POS] | (link_port.ctrl[CTRL_MUSIC_POS + 1] << 8)) * 12);
        last_seq = seq;
        if (t >= song->end) t %= song->end;
        seek(t);
    }

    /* the clock, and what's due */
    kon = koff = 0;
    pos += song->tpf;
    now = (uint16_t)(pos >> 16);
    if (now >= song->end) {
        while (ev < song->nevents) apply(&song->events[ev++], audible);
        pos -= (uint32_t)(song->end - song->loop) << 16;
        now = (uint16_t)(pos >> 16);
        ev = song->loop_event;
    }
    while (ev < song->nevents && song->events[ev].tick <= now) apply(&song->events[ev++], audible);
    SPU_REVERB_ON1 = (uint16_t)reverb;
    SPU_REVERB_ON2 = (uint16_t)(reverb >> 16);
    if (koff) SpuSetKey(0, koff);
    if (kon) SpuSetKey(1, kon);

    row = now / 12;
    link_port.state[STATE_MUSIC_POS] = (uint8_t)row;
    link_port.state[STATE_MUSIC_POS + 1] = (uint8_t)(row >> 8);
}
