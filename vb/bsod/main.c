/*
 * The Virtualato's error screen, run instead of its AR program (vision) when a
 * game cartridge or disc has been put in it: a Windows 8 style blue screen
 * saying it doesn't play games, on black, its ":(" a wireframe spinning in 3D
 * (each eye's own view of it), over its text, laid out and drawn here from a
 * font (font.h: the GB games' 5x7 letters, at double size), each frame into
 * the framebuffers not on display, which are then swapped in.
 */
#include <stdint.h>
#include "font.h"

#define VIP ((volatile uint16_t *)0x0005F800)
#define INTPND (0x00 / 2)
#define INTENB (0x02 / 2)
#define INTCLR (0x04 / 2)
#define DPCTRL (0x22 / 2)
#define BRTA   (0x24 / 2)
#define BRTB   (0x26 / 2)
#define BRTC   (0x28 / 2)
#define REST   (0x2A / 2)
#define FRMCYC (0x2E / 2)
#define XPCTRL (0x42 / 2)
#define FRAMESTART 0x0010

#define W 384
#define H 224
#define CX 72           /* where the ":(" is on the screen (its middle), above the text on the left */
#define CY 54
#define DIST 260        /* how far away it is, and the lens */
#define FOCAL 260
#define PARALLAX 10     /* how far apart the eyes see it, for the 3D */

/* framebuffer pair p (0/1), eye e (0 left, 1 right) */
static uint8_t *fb(int p, int e) { return (uint8_t *)(p * 0x8000 + e * 0x10000); }

/* sine, 4096 to 1, of a (4096 a turn), from a table: whole numbers only (the
 * FPU traps on something here, restarting the ROM: no floats at all) */
static const int16_t SIN[256] = { 0, 101, 201, 301, 401, 501, 601, 700, 799, 897, 995, 1092, 1189, 1285, 1380, 1474, 1567, 1660, 1751, 1842, 1931, 2019, 2106, 2191, 2276, 2359, 2440, 2520, 2598, 2675, 2751, 2824, 2896, 2967, 3035, 3102, 3166, 3229, 3290, 3349, 3406, 3461, 3513, 3564, 3612, 3659, 3703, 3745, 3784, 3822, 3857, 3889, 3920, 3948, 3973, 3996, 4017, 4036, 4052, 4065, 4076, 4085, 4091, 4095, 4096, 4095, 4091, 4085, 4076, 4065, 4052, 4036, 4017, 3996, 3973, 3948, 3920, 3889, 3857, 3822, 3784, 3745, 3703, 3659, 3612, 3564, 3513, 3461, 3406, 3349, 3290, 3229, 3166, 3102, 3035, 2967, 2896, 2824, 2751, 2675, 2598, 2520, 2440, 2359, 2276, 2191, 2106, 2019, 1931, 1842, 1751, 1660, 1567, 1474, 1380, 1285, 1189, 1092, 995, 897, 799, 700, 601, 501, 401, 301, 201, 101, 0, -101, -201, -301, -401, -501, -601, -700, -799, -897, -995, -1092, -1189, -1285, -1380, -1474, -1567, -1660, -1751, -1842, -1931, -2019, -2106, -2191, -2276, -2359, -2440, -2520, -2598, -2675, -2751, -2824, -2896, -2967, -3035, -3102, -3166, -3229, -3290, -3349, -3406, -3461, -3513, -3564, -3612, -3659, -3703, -3745, -3784, -3822, -3857, -3889, -3920, -3948, -3973, -3996, -4017, -4036, -4052, -4065, -4076, -4085, -4091, -4095, -4096, -4095, -4091, -4085, -4076, -4065, -4052, -4036, -4017, -3996, -3973, -3948, -3920, -3889, -3857, -3822, -3784, -3745, -3703, -3659, -3612, -3564, -3513, -3461, -3406, -3349, -3290, -3229, -3166, -3102, -3035, -2967, -2896, -2824, -2751, -2675, -2598, -2520, -2440, -2359, -2276, -2191, -2106, -2019, -1931, -1842, -1751, -1660, -1567, -1474, -1380, -1285, -1189, -1092, -995, -897, -799, -700, -601, -501, -401, -301, -201, -101 };
static int isin(int a) { return SIN[(a >> 4) & 255]; }
static int icos(int a) { return SIN[((a >> 4) + 64) & 255]; }

static void plot(uint8_t *f, int x, int y)
{
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    f[x * 64 + (y >> 2)] |= 3 << ((y & 3) << 1);
}

static void line(uint8_t *f, int x0, int y0, int x1, int y1)
{
    int dx = x1 > x0 ? x1 - x0 : x0 - x1, dy = y1 > y0 ? y1 - y0 : y0 - y1;
    int sx = x1 > x0 ? 1 : -1, sy = y1 > y0 ? 1 : -1, err = dx - dy;
    for (;;) {
        int e2;
        plot(f, x0, y0);
        if (x0 == x1 && y0 == y1) return;
        e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
    }
}

/* The text: in capitals (the font has no small letters), wrapped at words. */
static const char TEXT[] = "VIRTUALATO IS NOT COMPATIBLE WITH GELATO GAME CARTRIDGES OR DISCS. PLEASE REMOVE THE GAME AND TRY AGAIN.";
#define TX 32           /* its left, its first line's top, and the space a letter and a line take (doubled 5x7) */
#define TY 108
#define ADV 12
#define LEAD 20
#define COLS ((W - 2 * TX) / ADV)

static void glyph(uint8_t *f, int x, int y, char ch)
{
    int i, r, c;
    for (i = 0; FONT_CHARS[i] && FONT_CHARS[i] != ch; i++) {}
    if (!FONT_CHARS[i] || ch == ' ') return;
    for (r = 0; r < 7; r++)
        for (c = 0; c < 5; c++)
            if (font[i][r] & (16 >> c)) {
                plot(f, x + c * 2, y + r * 2); plot(f, x + c * 2 + 1, y + r * 2);
                plot(f, x + c * 2, y + r * 2 + 1); plot(f, x + c * 2 + 1, y + r * 2 + 1);
            }
}

/* Lays the text out (a line breaks before a word that won't fit) and draws it. */
static void text(uint8_t *f)
{
    int at = 0, line = 0, col = 0;
    while (TEXT[at]) {
        int len = 0, k;
        while (TEXT[at + len] && TEXT[at + len] != ' ') len++;
        if (col && col + len > COLS) { line++; col = 0; }
        for (k = 0; k < len; k++) glyph(f, TX + (col + k) * ADV, TY + line * LEAD, TEXT[at + k]);
        col += len + 1;
        at += len;
        while (TEXT[at] == ' ') at++;
    }
}

/* The ":(" model: its points (x right, y down, z away; about 60 across), and
 * which pairs make its edges. The colon is two cubes; the bracket an arc, made
 * thick (front and back), with its ends closed. */
#define ARC 9
#define NPTS (16 + 4 * ARC)
static int px[NPTS], py[NPTS], pz[NPTS];   /* (in sixteenths) */
static uint8_t edges[96][2];
static int nedges;

static void edge(int a, int b) { edges[nedges][0] = a; edges[nedges][1] = b; nedges++; }

static void build(void)
{
    int i, c, n = 0;
    /* the colon's dots: cubes 10 across */
    for (c = 0; c < 2; c++) {
        int cy = c ? 16 : -16;
        for (i = 0; i < 8; i++) {
            px[n + i] = (-30 + (i & 1 ? 5 : -5)) * 16;
            py[n + i] = (cy + (i & 2 ? 5 : -5)) * 16;
            pz[n + i] = (i & 4 ? 5 : -5) * 16;
        }
        for (i = 0; i < 8; i++) {
            if (!(i & 1)) edge(n + i, n + i + 1);
            if (!(i & 2)) edge(n + i, n + i + 2);
            if (!(i & 4)) edge(n + i, n + i + 4);
        }
        n += 8;
    }
    /* the bracket: an arc round a point to its right, inner and outer edges, front and back */
    for (i = 0; i < ARC; i++) {
        int a = 1024 + 384 + i * (1280 / (ARC - 1));   /* (from up-left, round the left, to down-left) */
        int s = isin(a), co = icos(a);
        for (c = 0; c < 4; c++) {
            int r = c & 1 ? 40 : 32;
            px[n + c] = 40 * 16 + co * r * 16 / 4096;
            py[n + c] = -s * r * 16 / 4096;
            pz[n + c] = (c & 2 ? 5 : -5) * 16;
        }
        if (i) for (c = 0; c < 4; c++) edge(n - 4 + c, n + c);   /* along the arc */
        if (i == 0 || i == ARC - 1) { edge(n, n + 1); edge(n + 2, n + 3); edge(n, n + 2); edge(n + 1, n + 3); }   /* its ends */
        n += 4;
    }
}

/* Draws it turned t about its upright axis (4096 a turn), for eye e (-1 left, 1 right). */
static void draw(uint8_t *f, int t, int e)
{
    static int sx[NPTS], sy[NPTS];
    int s = isin(t), c = icos(t), i;
    for (i = 0; i < NPTS; i++) {
        /* turned (still in sixteenths), then onto the screen: k is the lens over the distance, in 256ths */
        int x = (px[i] * c + pz[i] * s) / 4096, z = (-px[i] * s + pz[i] * c) / 4096;
        int k = FOCAL * 256 * 16 / (DIST * 16 + z);
        sx[i] = CX + x * k / (256 * 16) - e * PARALLAX * z / (DIST * 16);
        sy[i] = CY + py[i] * k / (256 * 16);
    }
    for (i = 0; i < nedges; i++) line(f, sx[edges[i][0]], sy[edges[i][0]], sx[edges[i][1]], sy[edges[i][1]]);
}

int main(void)
{
    int shown = 0, t = 0, e;
    VIP[INTENB] = 0;
    VIP[INTCLR] = 0xFFFF;
    VIP[BRTA] = 32;              /* the shades' brightness (everything is drawn in shade 3: BRTA + BRTB + BRTC) */
    VIP[BRTB] = 64;
    VIP[BRTC] = 32;
    VIP[REST] = 0;
    VIP[FRMCYC] = 0;
    VIP[XPCTRL] = 0;             /* no VIP drawing: the program draws */
    VIP[DPCTRL] = 0x0302;        /* sync, refresh, display on */
    build();
    for (;;) {
        int pair = shown ^ 1;
        for (e = 0; e < 2; e++) {
            uint32_t *f = (uint32_t *)fb(pair, e);
            int j;
            for (j = 0; j < W * 64 / 4; j++) f[j] = 0;
            text((uint8_t *)f);
            draw((uint8_t *)f, t, e ? 1 : -1);
        }
        /* show it at the start of the next frame */
        while (!(VIP[INTPND] & FRAMESTART)) {}
        VIP[INTCLR] = FRAMESTART;
        VIP[XPCTRL] = 1;         /* XPRST: swaps the framebuffer on display */
        shown = pair;
        t += 24;
    }
    return 0;
}
