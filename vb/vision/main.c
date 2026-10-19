/*
 * The Virtualato's AR program: draws the boxes the host puts in the mailbox
 * as a wireframe (in the VB's one colour; the emulator shows it green on black), from the wearer's point of view, for each eye.
 *
 * The VIP's own drawing is switched off; the program draws straight into the
 * framebuffers (384 columns of 256 pixels, 2 bits each, column by column)
 * that aren't on display, then swaps them in.
 */
#include <stdint.h>
#include "../../shared/vblink.h"

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
#define NEAR 0.05f
#define EYE 32.0f        /* half the distance between the eyes, mm */

vblink_t vblink;

/* framebuffer pair p (0/1), eye e (0 left, 1 right) */
static uint8_t *fb(int p, int e) { return (uint8_t *)(p * 0x8000 + e * 0x10000); }

static void clear(uint8_t *f)
{
    uint32_t *w = (uint32_t *)f;
    int i;
    for (i = 0; i < W * 64 / 4; i++) w[i] = 0;
}

/* Cohen-Sutherland outcode against the screen */
static int code(float x, float y)
{
    return (x < 0) | ((x > W - 1) << 1) | ((y < 0) << 2) | ((y > H - 1) << 3);
}

static void line(uint8_t *f, float x0, float y0, float x1, float y1, uint8_t v)
{
    int c0 = code(x0, y0), c1 = code(x1, y1);
    int ix0, iy0, ix1, iy1, dx, dy, sx, sy, err;
    while (c0 | c1) {
        float x, y;
        int c;
        if (c0 & c1) return;
        c = c0 ? c0 : c1;
        if (c & 8)      { x = x0 + (x1 - x0) * (H - 1 - y0) / (y1 - y0); y = H - 1; }
        else if (c & 4) { x = x0 + (x1 - x0) * (0 - y0) / (y1 - y0); y = 0; }
        else if (c & 2) { y = y0 + (y1 - y0) * (W - 1 - x0) / (x1 - x0); x = W - 1; }
        else            { y = y0 + (y1 - y0) * (0 - x0) / (x1 - x0); x = 0; }
        if (c == c0) { x0 = x; y0 = y; c0 = code(x0, y0); }
        else { x1 = x; y1 = y; c1 = code(x1, y1); }
    }
    ix0 = (int)x0; iy0 = (int)y0; ix1 = (int)x1; iy1 = (int)y1;
    dx = ix1 > ix0 ? ix1 - ix0 : ix0 - ix1;
    dy = iy1 > iy0 ? iy1 - iy0 : iy0 - iy1;
    /* one loop along whichever way the line is longer, stepping a pointer
     * through the framebuffer's columns (64 bytes each, 4 pixels to a byte) */
    if (dx >= dy) {
        uint8_t *col;
        if (ix0 > ix1) { int t = ix0; ix0 = ix1; ix1 = t; t = iy0; iy0 = iy1; iy1 = t; }
        sy = iy1 >= iy0 ? 1 : -1;
        err = dx >> 1;
        col = f + ix0 * 64;
        for (; ix0 <= ix1; ix0++, col += 64) {
            col[iy0 >> 2] |= v << ((iy0 & 3) << 1);
            if ((err -= dy) < 0) { iy0 += sy; err += dx; }
        }
    } else {
        uint8_t *col;
        if (iy0 > iy1) { int t = ix0; ix0 = ix1; ix1 = t; t = iy0; iy0 = iy1; iy1 = t; }
        sx = ix1 >= ix0 ? 64 : -64;
        err = dy >> 1;
        col = f + ix0 * 64;
        for (; iy0 <= iy1; iy0++) {
            col[iy0 >> 2] |= v << ((iy0 & 3) << 1);
            if ((err -= dx) < 0) { col += sx; err += dy; }
        }
    }
}

/* sin/cos of an angle in 4096ths of a turn */
static float sinf_(int a)
{
    float x, x2;
    int neg = 0;
    a &= 4095;
    if (a >= 2048) { a -= 2048; neg = 1; }
    if (a > 1024) a = 2048 - a;
    x = a * (3.14159265f / 2048.0f);
    x2 = x * x;
    x = x * (1.0f - x2 / 6.0f * (1.0f - x2 / 20.0f * (1.0f - x2 / 42.0f)));
    return neg ? -x : x;
}
static float cosf_(int a) { return sinf_(a + 1024); }

typedef struct { float x, y, z; } v3;

/* the camera: world -> eye space for each eye */
static float cx, cy, cz, cyw, syw, cpt, spt, focal;

/* world -> camera space (between the eyes: each eye is just shifted along x) */
static v3 to_cam(float x, float y, float z)
{
    v3 r;
    float dx = x - cx, dy = y - cy, dz = z - cz;
    float x1 = dx * cyw - dz * syw, z1 = dx * syw + dz * cyw;
    r.x = x1;
    r.y = dy * cpt + z1 * spt;
    r.z = -dy * spt + z1 * cpt;   /* looking down -z */
    return r;
}

static void edge(uint8_t *f, v3 a, v3 b, float eye, uint8_t v)
{
    a.x -= eye;
    b.x -= eye;
    float da = -a.z * 0.001f, db = -b.z * 0.001f;   /* depth in metres */
    if (da < NEAR && db < NEAR) return;
    if (da < NEAR || db < NEAR) {   /* clip to the near plane */
        float t = (NEAR - da) / (db - da);
        v3 m;
        m.x = a.x + (b.x - a.x) * t;
        m.y = a.y + (b.y - a.y) * t;
        m.z = -NEAR * 1000.0f;
        if (da < NEAR) { a = m; da = NEAR; } else { b = m; db = NEAR; }
    }
    line(f, W / 2 + focal * a.x * 0.001f / da, H / 2 - focal * a.y * 0.001f / da,
         W / 2 + focal * b.x * 0.001f / db, H / 2 - focal * b.y * 0.001f / db, v);
}

/* The other shapes (VBOX_LINE, _RING, _ROUND): their points in the shape's own
 * space, turned (pitch about x, then yaw about y), into camera space; their
 * edges drawn for each eye, clipped. */
static v3 shape_pt(volatile vbox_t *b, float x, float y, float z, float sy_, float cy_, float sp, float cp)
{
    float y1 = y * cp - z * sp, z1 = y * sp + z * cp;
    float x2 = x * cy_ + z1 * sy_, z2 = -x * sy_ + z1 * cy_;
    return to_cam(b->c[0] + x2, b->c[1] + y1, b->c[2] + z2);
}

static void both(uint8_t *f0, uint8_t *f1, v3 a, v3 c, uint8_t v)
{
    edge(f0, a, c, -EYE, v);
    edge(f1, a, c, EYE, v);
}

#define RING 8
#define ARCS 4   /* the GelatoBoy's half circle, in this many pieces */
static void draw_shape(uint8_t *f0, uint8_t *f1, volatile vbox_t *b)
{
    uint8_t v = b->bright ? b->bright : 3;
    float hx = b->h[0], hy = b->h[1], hz = b->h[2];
    float sy_ = sinf_(b->yaw), cy_ = cosf_(b->yaw), sp = sinf_(b->pitch), cp = cosf_(b->pitch);
    v3 c = to_cam(b->c[0], b->c[1], b->c[2]);
    int i, s;
    if (b->type == VBOX_LINE) {
        both(f0, f1, c, to_cam(b->c[0] + hx, b->c[1] + hy, b->c[2] + hz), v);
        return;
    }
    if (-c.z + hx + hy + hz < NEAR * 1000.0f) return;   /* behind you */
    if (b->type == VBOX_RING) {
        v3 p0 = shape_pt(b, hx, 0, 0, sy_, cy_, sp, cp), p = p0;
        for (i = 1; i <= RING; i++) {
            v3 q = i == RING ? p0 : shape_pt(b, hx * cosf_(i * 4096 / RING), hx * sinf_(i * 4096 / RING), 0, sy_, cy_, sp, cp);
            both(f0, f1, p, q, v);
            p = q;
        }
        return;
    }
    /* VBOX_ROUND: the outline (top, the two sides down to the half circle, the
     * half circle round the bottom), front and back, and lines between them at
     * the top corners and the bottom */
    {
        v3 o[2][ARCS + 4];
        float base = -hy + hx;   /* the half circle's middle */
        for (s = 0; s < 2; s++) {
            float z = s ? hz : -hz;
            int n = 0;
            o[s][n++] = shape_pt(b, -hx, hy, z, sy_, cy_, sp, cp);
            o[s][n++] = shape_pt(b, hx, hy, z, sy_, cy_, sp, cp);
            for (i = 0; i <= ARCS; i++) {
                int a = -1024 * i / ARCS;   /* (from the right side round under to the left) */
                o[s][n++] = shape_pt(b, hx * cosf_(a * 2), base + hx * sinf_(a * 2), z, sy_, cy_, sp, cp);
            }
            for (i = 0; i < n; i++) both(f0, f1, o[s][i], o[s][(i + 1) % n], v);
        }
        both(f0, f1, o[0][0], o[1][0], v);
        both(f0, f1, o[0][1], o[1][1], v);
        both(f0, f1, o[0][2 + ARCS / 2], o[1][2 + ARCS / 2], v);
    }
}

static const uint8_t EDGES[12][2] = {
    { 0, 1 }, { 1, 3 }, { 3, 2 }, { 2, 0 }, { 4, 5 }, { 5, 7 }, { 7, 6 }, { 6, 4 },
    { 0, 4 }, { 1, 5 }, { 2, 6 }, { 3, 7 },
};

/* A box into both eyes' framebuffers (f0 left, f1 right): its corners into
 * camera space once, skipped altogether if it's behind you or out of view. */
static void draw_box(uint8_t *f0, uint8_t *f1, volatile vbox_t *b)
{
    v3 p[8], c;
    int i, e;
    float sy_, cy_, sp, cp, r, d;
    float hx = b->h[0], hy = b->h[1], hz = b->h[2];
    uint8_t v = b->bright ? b->bright : 3;
    float sx_[8], sy__[8], k[8];
    int front = 1;
    if (b->type >= VBOX_LINE) { draw_shape(f0, f1, b); return; }
    if (b->type == VBOX_WALL) {
        /* flatten the thinnest side */
        if (hx < hz) hx = 0; else hz = 0;
    }
    /* a sphere round it (a little generous: no square root) against the view */
    r = hx + hy + hz;
    c = to_cam(b->c[0], b->c[1], b->c[2]);
    d = -c.z;
    if (d + r < NEAR * 1000.0f) return;                                        /* behind you */
    if ((c.x < 0 ? -c.x : c.x) > d * (W / 2) / focal + r * 1.5f + EYE) return;   /* off to a side */
    if ((c.y < 0 ? -c.y : c.y) > d * (H / 2) / focal + r * 1.5f) return;         /* above or below */
    if (b->yaw || b->pitch) {
        sy_ = sinf_(b->yaw); cy_ = cosf_(b->yaw); sp = sinf_(b->pitch); cp = cosf_(b->pitch);
        for (i = 0; i < 8; i++) {
            float x = i & 1 ? hx : -hx, y = i & 2 ? hy : -hy, z = i & 4 ? hz : -hz;
            /* pitch about x, then yaw about y */
            float y1 = y * cp - z * sp, z1 = y * sp + z * cp;
            float x2 = x * cy_ + z1 * sy_, z2 = -x * sy_ + z1 * cy_;
            p[i] = to_cam(b->c[0] + x2, b->c[1] + y1, b->c[2] + z2);
        }
    } else {
        /* (most boxes aren't turned at all: no trigonometry) */
        for (i = 0; i < 8; i++)
            p[i] = to_cam(b->c[0] + (i & 1 ? hx : -hx), b->c[1] + (i & 2 ? hy : -hy), b->c[2] + (i & 4 ? hz : -hz));
    }
    /* each corner onto the screen once (both eyes share its depth: they're just
     * shifted along x), unless it's behind you; then those edges are clipped */
    for (i = 0; i < 8; i++) {
        float dpt = -p[i].z * 0.001f;
        if (dpt < NEAR) { front = 0; continue; }
        k[i] = focal * 0.001f / dpt;
        sx_[i] = W / 2 + k[i] * p[i].x;
        sy__[i] = H / 2 - k[i] * p[i].y;
    }
    for (e = 0; e < 2; e++) {
        uint8_t *f = e ? f1 : f0;
        float eye = e ? EYE : -EYE;
        const uint8_t (*list)[2] = EDGES;
        uint8_t quad[4][2];
        int n = 12, j;
        if (b->type == VBOX_WALL) {
            /* the four corners of the flat side */
            static const uint8_t qz[4] = { 0, 1, 3, 2 }, qx[4] = { 0, 4, 6, 2 };
            const uint8_t *q = hz == 0 ? qz : qx;
            for (j = 0; j < 4; j++) { quad[j][0] = q[j]; quad[j][1] = q[(j + 1) & 3]; }
            list = (const uint8_t (*)[2])quad;
            n = 4;
        }
        for (j = 0; j < n; j++) {
            int a = list[j][0], c2 = list[j][1];
            if (front) line(f, sx_[a] - k[a] * eye, sy__[a], sx_[c2] - k[c2] * eye, sy__[c2], v);
            else edge(f, p[a], p[c2], eye, v);
        }
    }
}

static void init_link(void)
{
    static const char m[8] = { 'G', 'E', 'L', 'A', 'T', 'O', 'V', 'B' };
    int i;
    vblink.count = 0;
    vblink.focal = 194;
    vblink.power = 1;
    for (i = 0; i < 8; i++) vblink.magic[i] = m[i];
}

int main(void)
{
    int shown = 0, i, e;
    VIP[INTENB] = 0;
    VIP[INTCLR] = 0xFFFF;
    VIP[BRTA] = 32;
    VIP[BRTB] = 64;
    VIP[BRTC] = 32;
    VIP[REST] = 0;
    VIP[FRMCYC] = 0;
    VIP[XPCTRL] = 0;             /* no VIP drawing: the program draws */
    VIP[DPCTRL] = 0x0302;        /* sync, refresh, display on */
    for (i = 0; i < 4; i++) clear(fb(i & 1, i >> 1));
    init_link();

    for (;;) {
        int draw = shown ^ 1;
        cx = vblink.cam[0];
        cy = vblink.cam[1];
        cz = vblink.cam[2];
        cyw = cosf_(vblink.cam[3]);
        syw = sinf_(vblink.cam[3]);
        cpt = cosf_(vblink.cam[4]);
        spt = sinf_(vblink.cam[4]);
        focal = vblink.focal;
        for (e = 0; e < 2; e++) clear(fb(draw, e));
        if (vblink.power)
            for (i = 0; i < vblink.count && i < VB_MAX_BOXES; i++)
                draw_box(fb(draw, 0), fb(draw, 1), &vblink.boxes[i]);
        /* show it at the start of the next frame */
        while (!(VIP[INTPND] & FRAMESTART)) {}
        VIP[INTCLR] = FRAMESTART;
        VIP[XPCTRL] = 1;         /* XPRST: swaps the framebuffer on display */
        shown = draw;
        vblink.frame++;
    }
    return 0;
}
