/* Small rendering/input helpers shared by the GelatoStation ROMs. */
#ifndef GELATO_PS1_GFX_H
#define GELATO_PS1_GFX_H
#include <stdint.h>
#include <psxgpu.h>
#include <psxgte.h>
#include <psxpad.h>

#define SCREEN_W 320
#define SCREEN_H 240
#define OT_LEN   1024

extern uint32_t *gfx_ot;        /* ordering table of the frame being built */
extern uint8_t *gfx_nextpri;

void gfx_init(void);
void gfx_display(void);
/* Camera at pos looking down +z, pitched by tilt (4096 = 360 deg). */
void gfx_camera(int x, int y, int z, int tilt);
void gfx_matrix(MATRIX *m, int rx, int ry, int rz, int x, int y, int z);
/* Loads an object->world matrix (composed with the camera) into the GTE. */
void gfx_object(MATRIX *m);
void gfx_sky(int r0, int g0, int b0, int r1, int g1, int b1);
/* Checkerboard on the y=0 plane, tiles [tx0,tx1) x [tz0,tz1) of size `size`, always behind everything. */
void gfx_floor(int tx0, int tx1, int tz0, int tz1, int size, int r0, int g0, int b0, int r1, int g1, int b1);
/* Lit flat-shaded box in the current object space. Returns the OT depth used, or -1. */
int gfx_box(int x0, int y0, int z0, int x1, int y1, int z1, int r, int g, int b);
/* Same, drawing only the faces whose bit is set in mask (see BOX_*). */
#define BOX_FRONT  1   /* -z, towards the camera */
#define BOX_BACK   2
#define BOX_TOP    4   /* -y */
#define BOX_BOTTOM 8
#define BOX_LEFT   16
#define BOX_RIGHT  32
#define BOX_ALL    63
int gfx_box_faces(int x0, int y0, int z0, int x1, int y1, int z1, int r, int g, int b, int mask);
/* Square pyramid (base on y=0 plane, apex at -h) */
void gfx_pyramid(int half, int h, int r, int g, int b);
/* A flat-coloured mesh (a team model exported to C, e.g. cone.h): vertices in
 * world units, triangles with their colour and outward normal (ONE long). */
typedef struct {
    const int16_t (*v)[3];
    const uint16_t (*f)[3];
    const uint8_t (*rgb)[3];
    const int16_t (*n)[3];
    uint16_t verts, tris;
} mesh_t;
/* Draws triangles first .. first + count - 1 of m at scale (ONE: as it is),
 * with the matrix gfx_object set. */
void gfx_mesh(const mesh_t *m, int first, int count, int scale);
/* Screen position of a point in the current object space. */
void gfx_project(int x, int y, int z, int *sx, int *sy);
/* Semi-transparent additive quad in screen space. */
void gfx_glow(int x0, int y0, int x1, int y1, int r, int g, int b);
void gfx_rect(int x0, int y0, int x1, int y1, int r, int g, int b);
/* a '~' (the debug font has none) in the text cell at (col, row) */
void gfx_tilde(int col, int row);

typedef struct {
    int x, y, z;        /* feet position, world units */
    int yaw;            /* 0 faces the camera (-z) */
    int scale;          /* 16 = 300 units tall */
    int walk_phase;     /* advance while walking */
    uint8_t airborne, wave, kick, block, hurt, ko, throw_;
    uint8_t punch;      /* punching: 1 + how far into it (0-254: wind up, strike, hold, back) */
    uint8_t shirt_r, shirt_g, shirt_b, pants_r, pants_g, pants_b;
    uint8_t tint_r, tint_g, tint_b;   /* colour the character is drawn in; 0, 0, 0 = as it is */
    int flip;           /* a backflip: how far round (4096 = all the way) */
    uint8_t clap;       /* clapping: 1 + the frame of it */
    uint8_t dizzy;      /* stunned: 1 + the frame of it */
} guy_t;

void gfx_guy(const guy_t *g);

/* Pad: returns held buttons (PAD_* bits, 1 = pressed) for port 0/1. */
void pad_init(void);
uint16_t pad_held(int port);

#endif
