#include <stdint.h>
#include <psxspu.h>
#include <hwregs_c.h>
#include "sfx.h"

#define VOICES   8          /* voices 0-7 for effects */
#define SQ_ADDR  0x1010     /* sound RAM: one block of square wave... */
#define NZ_ADDR  0x1020     /* ... then 64 blocks of noise */
#define NZ_BLOCKS 64
#define BASE_HZ(w) ((w) == SFX_SQUARE ? 44100 / 28 : 44100)   /* the waves' pitch at 0x1000 */

typedef struct {
    int f0, f1, frames, t, active;
    int vol, pan, attack, release;   /* (an envelope: see sfx_note) */
} note_t;

static note_t notes[VOICES];
static int next_voice;
static uint32_t buf[NZ_BLOCKS * 4];

/* One 16-byte ADPCM block: filter 0, `shift`, flags, 28 4-bit samples. */
static void block(uint8_t *b, int shift, int flags, const int8_t *s)
{
    int i;
    b[0] = (uint8_t)shift;
    b[1] = (uint8_t)flags;
    for (i = 0; i < 14; i++) b[2 + i] = (uint8_t)((s[i * 2] & 15) | ((s[i * 2 + 1] & 15) << 4));
}

static void upload(uint32_t addr, const uint32_t *data, int size)
{
    SpuSetTransferMode(SPU_TRANSFER_BY_IO);
    SpuSetTransferStartAddr(addr);
    SpuWrite(data, size);
    SpuIsTransferCompleted(SPU_TRANSFER_WAIT);
}

void sfx_init(void)
{
    int8_t s[28];
    int i, j;
    uint32_t seed = 0x1234567;
    SpuInit();
    SPU_MASTER_VOL_L = 0x3fff;
    SPU_MASTER_VOL_R = 0x3fff;
    /* square: half high, half low, looping on itself (flags: start + repeat + end) */
    for (i = 0; i < 28; i++) s[i] = i < 14 ? 6 : -6;
    block((uint8_t *)buf, 1, 7, s);
    upload(SQ_ADDR, buf, 16);
    /* noise: random samples, the whole run looping */
    for (j = 0; j < NZ_BLOCKS; j++) {
        for (i = 0; i < 28; i++) { seed = seed * 1103515245 + 12345; s[i] = (int8_t)((seed >> 16) & 15) - 8; }
        block((uint8_t *)buf + j * 16, 1, j == 0 ? 4 : j == NZ_BLOCKS - 1 ? 3 : 0, s);
    }
    upload(NZ_ADDR, buf, NZ_BLOCKS * 16);
}

static uint16_t pitch(int wave, int hz)
{
    int p = (int)(((int32_t)hz * 4096) / BASE_HZ(wave));
    return (uint16_t)(p < 1 ? 1 : p > 0x3fff ? 0x3fff : p);
}

static void set_vol(int v, int vol, int pan)
{
    SPU_CH_VOL_L(v) = (uint16_t)(vol * (64 - pan) / 128);
    SPU_CH_VOL_R(v) = (uint16_t)(vol * (64 + pan) / 128);
}

void sfx_play(int wave, int f0, int f1, int frames, int vol, int pan)
{
    sfx_note(wave, f0, f1, frames, vol, pan, 0, 0);
}

void sfx_note(int wave, int f0, int f1, int frames, int vol, int pan, int attack, int release)
{
    int v = next_voice;
    next_voice = (next_voice + 1) % VOICES;
    notes[v].f0 = f0;
    notes[v].f1 = f1;
    notes[v].frames = frames < 1 ? 1 : frames;
    notes[v].t = 0;
    notes[v].active = 1;
    notes[v].f0 = (notes[v].f0 & 0xffff) | (wave << 16);
    notes[v].vol = vol;
    notes[v].pan = pan;
    notes[v].attack = attack;
    notes[v].release = release;
    set_vol(v, attack ? 0 : vol, pan);
    SPU_CH_FREQ(v) = pitch(wave, f0);
    SPU_CH_ADDR(v) = (wave == SFX_SQUARE ? SQ_ADDR : NZ_ADDR) >> 3;
    SPU_CH_ADSR1(v) = 0x00ff;   /* fast attack, full sustain level */
    SPU_CH_ADSR2(v) = 0x000a;   /* quick release */
    SpuSetKey(1, 1 << v);
}

void sfx_update(void)
{
    int v;
    for (v = 0; v < VOICES; v++) {
        note_t *n = &notes[v];
        int wave, f0;
        if (!n->active) continue;
        wave = n->f0 >> 16;
        f0 = n->f0 & 0xffff;
        n->t++;
        SPU_CH_FREQ(v) = pitch(wave, f0 + (n->f1 - f0) * n->t / n->frames);
        if (n->attack || n->release) {
            /* the envelope: up over the first `attack` frames, down over the last `release` */
            int k = 256, left = n->frames - n->t;
            if (n->attack && n->t < n->attack) k = n->t * 256 / n->attack;
            if (n->release && left < n->release && left * 256 / n->release < k) k = left * 256 / n->release;
            set_vol(v, n->vol * k >> 8, n->pan);
        }
        if (n->t >= n->frames) {
            n->active = 0;
            SpuSetKey(0, 1 << v);
        }
    }
}
