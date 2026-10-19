/* Sound effects for the GelatoBoy ROMs, on the GB's own sound hardware:
 * channel 1 (square wave with a pitch sweep), channel 2 (square wave) and
 * channel 4 (noise). Frequencies are the GB's 11-bit values: 131072 / (2048 - x) Hz. */
#ifndef GELATO_GB_SFX_H
#define GELATO_GB_SFX_H
#include <gb/gb.h>
#include <gb/hardware.h>

/* How many more frames each channel (1-4) is an effect's: the music
 * (gb/music/music.c) leaves a busy channel alone and picks it up again at its
 * next note. (Defined here: sfx.h is included once per ROM, by its main.c.) */
uint8_t sfx_busy[4];

/* An envelope's (NRx2) length in frames: vol steps of pace/64 s; a steady or
 * rising one just gets half a second. */
static uint8_t sfx_frames(uint8_t env)
{
    uint8_t vol = env >> 4, pace = env & 7;
    uint16_t f;
    if (!pace || (env & 8)) return 30;
    f = (uint16_t)vol * pace * 15 / 16 + 2;   /* (vol * pace / 64 s, at 60 frames a second) */
    return f > 255 ? 255 : (uint8_t)f;
}

static void sfx_init(void)
{
    NR52_REG = 0x80;   /* sound on */
    NR50_REG = 0x77;   /* full volume both sides */
    NR51_REG = 0xFF;   /* every channel to both sides */
}

/* ch1: sweep (NR10: time << 4 | down << 3 | shift), envelope (NR12: vol << 4 | up << 3 | pace) */
static void sfx_sweep(uint8_t sweep, uint8_t env, uint16_t x)
{
    NR10_REG = sweep;
    NR11_REG = 0x80;            /* 50% duty */
    NR12_REG = env;
    NR13_REG = (uint8_t)x;
    NR14_REG = 0x80 | ((x >> 8) & 7);
    sfx_busy[0] = sfx_frames(env);
}

/* ch2: a plain beep that stops after (64 - len) / 256 s */
static void sfx_beep(uint8_t len, uint8_t env, uint16_t x)
{
    NR21_REG = 0x80 | (len & 63);
    NR22_REG = env;
    NR23_REG = (uint8_t)x;
    NR24_REG = 0xC0 | ((x >> 8) & 7);
    {
        uint8_t f = sfx_frames(env), l = (uint8_t)((64 - (len & 63)) * 15 / 64 + 2);
        sfx_busy[1] = f < l ? f : l;
    }
}

/* ch4: noise (NR43: shift << 4 | short << 3 | divider) */
static void sfx_noise(uint8_t env, uint8_t poly)
{
    NR41_REG = 0x00;
    NR42_REG = env;
    NR43_REG = poly;
    NR44_REG = 0x80;
    sfx_busy[3] = sfx_frames(env);
}

#endif
