/*
 * The GelatoStation's boot screens, before each game (a nod to a certain
 * other console's): a white screen where the Gelato Labs icon zooms in to a
 * sparkle and a big chord, over GELATO / LABS, then black, where a big G
 * stands up and an S lies back behind it to a deep swell and a chime, over
 * the GelatoStation name (unlicensed). The host can cut it short
 * (ctrl[CTRL_SKIPBOOT]: the tests don't sit through it).
 */
#include <stdint.h>
#include <psxgpu.h>
#include <psxgte.h>
#include "gfx.h"
#include "sfx.h"
#include "boot.h"
#include "font5x7.h"
#include "gelato_icon.h"
#include "../../shared/link.h"

#define WHITE_FRAMES 170
#define ICON_X 768          /* where the icon's texture lives in VRAM (16-bit; after Signsign's) */
#define ICON_Y 0
#define BLACK_FRAMES 200

static const uint8_t *glyph(char c)
{
    for (int i = 0; font5x7_chars[i]; i++)
        if (font5x7_chars[i] == c) return font5x7[i];
    return 0;
}

/* Text in square pixels of size px, centred on x, its top at y. */
static void pixel_text(int x, int y, const char *s, int px, int r, int g, int b)
{
    int n = 0;
    while (s[n]) n++;
    x -= (n * 6 - 1) * px / 2;
    for (; *s; s++, x += 6 * px) {
        const uint8_t *rows = glyph(*s);
        if (!rows) continue;
        for (int row = 0; row < 7; row++)
            for (int col = 0; col < 5; col++)
                if (rows[row] & (0x10 >> col))
                    gfx_rect(x + col * px, y + row * px, x + col * px + px, y + row * px + px, r, g, b);
    }
}

/* The icon, size pixels square, centred on (x, y), its colour scaled by k/128. */
static void icon(int x, int y, int size, int k)
{
    POLY_FT4 *p = (POLY_FT4 *)gfx_nextpri;
    setPolyFT4(p);
    setXYWH(p, x - size / 2, y - size / 2, size, size);
    setUVWH(p, 0, 0, GELATO_ICON - 1, GELATO_ICON - 1);
    p->tpage = getTPage(2, 0, ICON_X, ICON_Y);
    setRGB0(p, k, k, k);
    addPrim(gfx_ot, p);
    gfx_nextpri += sizeof(POLY_FT4);
}

/* A letter as a slab of blocks, size u each, in the current object's x/y plane
 * (y down), centred; rows go along -z instead if flat. */
static void block_letter(char c, int u, int flat, int r, int g, int b)
{
    const uint8_t *rows = glyph(c);
    if (!rows) return;
    for (int row = 0; row < 7; row++)
        for (int col = 0; col < 5; col++) {
            if (!(rows[row] & (0x10 >> col))) continue;
            int x = (col - 2) * u - u / 2, v = (row - 3) * u - u / 2;
            /* a little darker towards the bottom, for some shape */
            int k = 255 - row * 12;
            if (flat) gfx_box(x, -u / 2, -v - u, x + u, u / 2, -v, r * k >> 8, g * k >> 8, b * k >> 8);
            else gfx_box(x, v, -u / 2, x + u, v + u, u / 2, r * k >> 8, g * k >> 8, b * k >> 8);
        }
}

static int ease(int t, int n) { int f = t >= n ? 4096 : t * 4096 / n; return 4096 - ((4096 - f) * (4096 - f) >> 12); }

void gfx_boot(void)
{
    MATRIX m;
    RECT r = { ICON_X, ICON_Y, GELATO_ICON, GELATO_ICON };
    DrawSync(0);
    LoadImage(&r, (const uint32_t *)gelato_icon);
    DrawSync(0);
    for (int t = 0; t < WHITE_FRAMES + BLACK_FRAMES; t++) {
        sfx_update();
        link_port.frame++;
        if (link_port.ctrl[CTRL_SKIPBOOT]) break;
        if (t < WHITE_FRAMES) {
            /* white, the icon zooming in, then everything fading to black */
            int fade = t > WHITE_FRAMES - 30 ? (WHITE_FRAMES - t) * 255 / 30 : 255;
            int size = 84 * ease(t, 40) >> 12, cx = SCREEN_W / 2, cy = 84;
            /* the chime, cinematic: a build-up while the icon zooms in (a whoosh
             * swelling louder and brighter, two voices gliding up an octave into
             * the chord, sparkles rising), then as it lands the whole C major
             * chord at once, a sub-bass boom under it and a shimmer over it,
             * ringing out in a long fade */
            if (t == 0) {
                sfx_note(SFX_NOISE, 600, 10000, 40, 0x0800, 0, 38, 3);    /* whoosh */
                sfx_note(SFX_SQUARE, 196, 392, 40, 0x0700, -20, 38, 2);   /* G3 up to G4 */
                sfx_note(SFX_SQUARE, 262, 523, 40, 0x0700, 20, 38, 2);    /* C4 up to C5 */
            }
            if (t >= 22 && t <= 37 && (t - 22) % 5 == 0) {
                static const int run[4] = { 1568, 2093, 2637, 3136 };
                int k = (t - 22) / 5;
                sfx_note(SFX_SQUARE, run[k], run[k], 24, 0x0500, k & 1 ? 36 : -36, 0, 20);
            }
            if (t == 40) {
                sfx_note(SFX_SQUARE, 65, 49, 70, 0x1c00, 0, 0, 64);        /* the boom: C2, sinking */
                sfx_note(SFX_SQUARE, 131, 131, 125, 0x1500, 0, 2, 110);    /* C3 */
                sfx_note(SFX_SQUARE, 196, 196, 125, 0x1100, -28, 2, 110);  /* G3 */
                sfx_note(SFX_SQUARE, 262, 262, 125, 0x0f00, 28, 2, 110);   /* C4 */
                sfx_note(SFX_SQUARE, 330, 330, 125, 0x0e00, -44, 2, 110);  /* E4 */
                sfx_note(SFX_SQUARE, 392, 392, 125, 0x0d00, 44, 2, 110);   /* G4 */
                sfx_note(SFX_SQUARE, 523, 523, 125, 0x0b00, 0, 2, 110);    /* C5 */
                sfx_note(SFX_SQUARE, 1047, 1052, 120, 0x0600, 0, 12, 100); /* C6, the shimmer */
            }
            gfx_sky(fade, fade, fade, fade, fade, fade);
            if (size > 1) icon(cx, cy, size, 128 * fade >> 8);
            if (t > 40) {
                int ink = 255 - fade + (fade * 30 >> 8);   /* black text on white, fading into the black */
                pixel_text(cx, 140, "GELATO", 4, ink, ink, ink);
                pixel_text(cx, 178, "LABS", 3, ink, ink, ink);
            }
        } else {
            /* black: the G stands up, the S lies down behind it */
            int b = t - WHITE_FRAMES;
            int g = ease(b, 70), s = ease(b - 25, 70);
            /* a deep swell rising out of the dark, then, as the letters settle,
             * a bright A major chime over the bass, ringing out */
            if (b == 0) {
                sfx_note(SFX_SQUARE, 55, 55, 150, 0x1800, 0, 60, 60);      /* A1 */
                sfx_note(SFX_SQUARE, 82, 82, 150, 0x1000, 0, 60, 60);      /* E2 */
                sfx_note(SFX_NOISE, 300, 900, 120, 0x0600, 0, 50, 70);     /* the wind */
            }
            if (b == 72) {
                sfx_note(SFX_SQUARE, 110, 110, 120, 0x1200, 0, 2, 100);    /* A2 */
                sfx_note(SFX_SQUARE, 440, 440, 120, 0x0c00, -30, 2, 100);  /* A4 */
                sfx_note(SFX_SQUARE, 554, 554, 120, 0x0a00, 30, 2, 100);   /* C#5 */
                sfx_note(SFX_SQUARE, 659, 659, 120, 0x0900, -15, 2, 100);  /* E5 */
                sfx_note(SFX_SQUARE, 880, 880, 120, 0x0700, 15, 2, 100);   /* A5 */
            }
            gfx_sky(0, 0, 0, 0, 0, 0);
            gfx_camera(0, -950, -1250, 470);   /* from above enough that the lying S reads */
            gfx_matrix(&m, 0, -700 + (g * 700 >> 12), 0, -200, -290 - ((4096 - g) * 300 >> 12), 0);
            gfx_object(&m);
            block_letter('G', 80, 0, 255, 150, 200);
            if (b >= 25) {
                /* lying back, its far end raised a little towards you (lying fully flat, it would read too skewed) */
                gfx_matrix(&m, 130, 900 - (s * 900 >> 12), 0, 290, 0, 260 + ((4096 - s) * 600 >> 12));
                gfx_object(&m);
                block_letter('S', 80, 1, 150, 255, 210);
            }
            if (b > 80) FntPrint(-1, "\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n            GelatoStation\n\n\n\n      UNLICENSED BY GELATO LABS");
        }
        gfx_display();
    }
    sfx_update();
}
