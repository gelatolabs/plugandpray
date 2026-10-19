#include <psxapi.h>
#include <inline_c.h>
#include "gfx.h"

#define PACKET_LEN 98304

typedef struct {
    DISPENV disp;
    DRAWENV draw;
    uint32_t ot[OT_LEN];
    uint8_t p[PACKET_LEN];
} DB;

static DB db[2];
static int db_active;
uint32_t *gfx_ot;
uint8_t *gfx_nextpri;

static MATRIX cam_mtx;
static MATRIX color_mtx = { ONE, 0, 0, ONE, 0, 0, ONE, 0, 0 };
static MATRIX light_dir = { -1600, 2400, 2400, 0, 0, 0, 0, 0, 0 };
static uint8_t pad_buff[2][34];

void gfx_init(void)
{
    ResetGraph(0);
    SetDefDispEnv(&db[0].disp, 0, 0, SCREEN_W, SCREEN_H);
    SetDefDrawEnv(&db[0].draw, 0, SCREEN_H, SCREEN_W, SCREEN_H);
    SetDefDispEnv(&db[1].disp, 0, SCREEN_H, SCREEN_W, SCREEN_H);
    SetDefDrawEnv(&db[1].draw, 0, 0, SCREEN_W, SCREEN_H);
    for (int i = 0; i < 2; i++) {
        setRGB0(&db[i].draw, 0, 0, 0);
        db[i].draw.isbg = 1;
        db[i].draw.dtd = 1;
        ClearOTagR(db[i].ot, OT_LEN);
    }
    PutDrawEnv(&db[0].draw);
    gfx_ot = db[0].ot;
    gfx_nextpri = db[0].p;

    InitGeom();
    gte_SetGeomOffset(SCREEN_W / 2, SCREEN_H / 2);
    gte_SetGeomScreen(SCREEN_W / 2);
    gte_SetBackColor(150, 150, 160);
    gte_SetColorMatrix(&color_mtx);

    FntLoad(960, 0);
    FntOpen(8, 8, SCREEN_W - 16, SCREEN_H - 16, 0, 256);
}

void gfx_display(void)
{
    FntFlush(-1);
    DrawSync(0);
    VSync(0);
    db_active ^= 1;
    gfx_ot = db[db_active].ot;
    gfx_nextpri = db[db_active].p;
    ClearOTagR(gfx_ot, OT_LEN);
    PutDrawEnv(&db[db_active].draw);
    PutDispEnv(&db[db_active].disp);
    SetDispMask(1);
    DrawOTag(db[1 - db_active].ot + (OT_LEN - 1));
}

void gfx_camera(int x, int y, int z, int tilt)
{
    SVECTOR rot = { tilt, 0, 0 };
    VECTOR neg = { -x, -y, -z }, t;
    RotMatrix(&rot, &cam_mtx);
    ApplyMatrixLV(&cam_mtx, &neg, &t);
    TransMatrix(&cam_mtx, &t);
}

void gfx_matrix(MATRIX *m, int rx, int ry, int rz, int x, int y, int z)
{
    SVECTOR r = { rx, ry, rz };
    VECTOR t = { x, y, z };
    RotMatrix(&r, m);
    TransMatrix(m, &t);
}

void gfx_object(MATRIX *m)
{
    MATRIX view, light;
    CompMatrixLV(&cam_mtx, m, &view);
    MulMatrix0(&light_dir, m, &light);
    gte_SetRotMatrix(&view);
    gte_SetTransMatrix(&view);
    gte_SetLightMatrix(&light);
}

void gfx_sky(int r0, int g0, int b0, int r1, int g1, int b1)
{
    POLY_G4 *pol = (POLY_G4 *)gfx_nextpri;
    setPolyG4(pol);
    setXY4(pol, 0, 0, SCREEN_W, 0, 0, SCREEN_H, SCREEN_W, SCREEN_H);
    setRGB0(pol, r0, g0, b0);
    setRGB1(pol, r0, g0, b0);
    setRGB2(pol, r1, g1, b1);
    setRGB3(pol, r1, g1, b1);
    addPrim(gfx_ot + OT_LEN - 1, pol);
    gfx_nextpri += sizeof(POLY_G4);
}

void gfx_floor(int tx0, int tx1, int tz0, int tz1, int size, int r0, int g0, int b0, int r1, int g1, int b1)
{
    MATRIX m;
    gfx_matrix(&m, 0, 0, 0, 0, 0, 0);
    gfx_object(&m);
    for (int tz = tz0; tz < tz1; tz++) {
        for (int tx = tx0; tx < tx1; tx++) {
            POLY_F4 *pol = (POLY_F4 *)gfx_nextpri;
            SVECTOR a = { tx * size, 0, tz * size }, b = { tx * size + size, 0, tz * size };
            SVECTOR c = { tx * size, 0, tz * size + size }, d = { tx * size + size, 0, tz * size + size };
            int otz;
            gte_ldv3(&c, &d, &a);
            gte_rtpt();
            gte_avsz3();
            gte_stotz(&otz);
            if (otz <= 0 || otz >= OT_LEN) continue;
            setPolyF4(pol);
            gte_stsxy0(&pol->x0);
            gte_stsxy1(&pol->x1);
            gte_stsxy2(&pol->x2);
            gte_ldv0(&b);
            gte_rtps();
            gte_stsxy(&pol->x3);
            if ((tx + tz) & 1) setRGB0(pol, r0, g0, b0);
            else setRGB0(pol, r1, g1, b1);
            addPrim(gfx_ot + OT_LEN - 2, pol);
            gfx_nextpri += sizeof(POLY_F4);
        }
    }
}

static const SVECTOR box_normals[6] = {
    { 0, 0, -ONE }, { 0, 0, ONE }, { 0, -ONE, 0 }, { 0, ONE, 0 }, { -ONE, 0, 0 }, { ONE, 0, 0 },
};
static const uint8_t box_faces[6][4] = {
    { 0, 1, 2, 3 }, { 5, 4, 7, 6 }, { 4, 5, 0, 1 }, { 2, 3, 6, 7 }, { 4, 0, 6, 2 }, { 1, 5, 3, 7 },
};

int gfx_box(int x0, int y0, int z0, int x1, int y1, int z1, int r, int g, int b)
{
    return gfx_box_faces(x0, y0, z0, x1, y1, z1, r, g, b, BOX_ALL);
}

int gfx_box_faces(int x0, int y0, int z0, int x1, int y1, int z1, int r, int g, int b, int mask)
{
    SVECTOR v[8] = {
        { x0, y0, z0 }, { x1, y0, z0 }, { x0, y1, z0 }, { x1, y1, z0 },
        { x0, y0, z1 }, { x1, y0, z1 }, { x0, y1, z1 }, { x1, y1, z1 },
    };
    int depth = -1;
    for (int i = 0; i < 6; i++) {
        const uint8_t *f = box_faces[i];
        POLY_F4 *pol = (POLY_F4 *)gfx_nextpri;
        int nclip, otz;

        if (!(mask & (1 << i))) continue;
        gte_ldv3(&v[f[0]], &v[f[1]], &v[f[2]]);
        gte_rtpt();
        gte_nclip();
        gte_stopz(&nclip);
        if (nclip <= 0) continue;
        gte_avsz3();
        gte_stotz(&otz);
        if (otz <= 0 || otz >= OT_LEN - 2) continue;

        setPolyF4(pol);
        gte_stsxy0(&pol->x0);
        gte_stsxy1(&pol->x1);
        gte_stsxy2(&pol->x2);
        gte_ldv0(&v[f[3]]);
        gte_rtps();
        gte_stsxy(&pol->x3);

        setRGB0(pol, r, g, b);
        gte_ldrgb(&pol->r0);
        gte_ldv0(&box_normals[i]);
        gte_nccs();
        gte_strgb(&pol->r0);

        addPrim(gfx_ot + otz, pol);
        gfx_nextpri += sizeof(POLY_F4);
        depth = otz;
    }
    return depth;
}

void gfx_pyramid(int half, int h, int r, int g, int b)
{
    SVECTOR apex = { 0, -h, 0 };
    SVECTOR base[4] = { { -half, 0, -half }, { half, 0, -half }, { half, 0, half }, { -half, 0, half } };
    int len = SquareRoot0(h * h + half * half);
    int nh = (h * ONE) / len, nv = -(half * ONE) / len;
    for (int i = 0; i < 4; i++) {
        POLY_F3 *pol = (POLY_F3 *)gfx_nextpri;
        SVECTOR *a = &base[i], *c = &base[(i + 1) & 3];
        /* outward slanted face normal */
        int dx = (a->vx + c->vx) / (2 * half), dz = (a->vz + c->vz) / (2 * half);
        SVECTOR n = { dx * nh, nv, dz * nh };
        int nclip, otz;
        gte_ldv3(a, &apex, c);
        gte_rtpt();
        gte_nclip();
        gte_stopz(&nclip);
        if (nclip <= 0) continue;
        gte_avsz3();
        gte_stotz(&otz);
        if (otz <= 0 || otz >= OT_LEN - 2) continue;
        setPolyF3(pol);
        gte_stsxy3(&pol->x0, &pol->x1, &pol->x2);
        setRGB0(pol, r, g, b);
        gte_ldrgb(&pol->r0);
        gte_ldv0(&n);
        gte_nccs();
        gte_strgb(&pol->r0);
        addPrim(gfx_ot + otz, pol);
        gfx_nextpri += sizeof(POLY_F3);
    }
}

void gfx_mesh(const mesh_t *m, int first, int count, int scale)
{
    for (int i = first; i < first + count; i++) {
        POLY_F3 *pol = (POLY_F3 *)gfx_nextpri;
        const uint16_t *f = m->f[i];
        SVECTOR a, b, c, n = { m->n[i][0], m->n[i][1], m->n[i][2] };
        int nclip, otz;
        a.vx = (m->v[f[0]][0] * scale) >> 12; a.vy = (m->v[f[0]][1] * scale) >> 12; a.vz = (m->v[f[0]][2] * scale) >> 12;
        b.vx = (m->v[f[1]][0] * scale) >> 12; b.vy = (m->v[f[1]][1] * scale) >> 12; b.vz = (m->v[f[1]][2] * scale) >> 12;
        c.vx = (m->v[f[2]][0] * scale) >> 12; c.vy = (m->v[f[2]][1] * scale) >> 12; c.vz = (m->v[f[2]][2] * scale) >> 12;
        gte_ldv3(&a, &b, &c);
        gte_rtpt();
        gte_nclip();
        gte_stopz(&nclip);
        if (nclip <= 0) continue;   /* facing away */
        gte_avsz3();
        gte_stotz(&otz);
        if (otz <= 0 || otz >= OT_LEN - 2) continue;
        setPolyF3(pol);
        gte_stsxy3(&pol->x0, &pol->x1, &pol->x2);
        setRGB0(pol, m->rgb[i][0], m->rgb[i][1], m->rgb[i][2]);
        gte_ldrgb(&pol->r0);
        gte_ldv0(&n);
        gte_nccs();
        gte_strgb(&pol->r0);
        addPrim(gfx_ot + otz, pol);
        gfx_nextpri += sizeof(POLY_F3);
    }
}

void gfx_project(int x, int y, int z, int *sx, int *sy)
{
    SVECTOR v = { x, y, z };
    int sxy;
    gte_ldv0(&v);
    gte_rtps();
    gte_stsxy(&sxy);
    *sx = (int16_t)(sxy & 0xFFFF);
    *sy = (int16_t)(sxy >> 16);
}

void gfx_glow(int x0, int y0, int x1, int y1, int r, int g, int b)
{
    TILE *t = (TILE *)gfx_nextpri;
    DR_TPAGE *tp;
    setTile(t);
    setSemiTrans(t, 1);
    setXY0(t, x0, y0);
    setWH(t, x1 - x0, y1 - y0);
    setRGB0(t, r, g, b);
    addPrim(gfx_ot + 1, t);
    gfx_nextpri += sizeof(TILE);
    tp = (DR_TPAGE *)gfx_nextpri;
    setDrawTPage(tp, 0, 1, getTPage(0, 1, 0, 0));   /* blend mode 1: additive */
    addPrim(gfx_ot + 1, tp);
    gfx_nextpri += sizeof(DR_TPAGE);
}

void gfx_rect(int x0, int y0, int x1, int y1, int r, int g, int b)
{
    TILE *t = (TILE *)gfx_nextpri;
    setTile(t);
    setXY0(t, x0, y0);
    setWH(t, x1 - x0, y1 - y0);
    setRGB0(t, r, g, b);
    addPrim(gfx_ot, t);
    gfx_nextpri += sizeof(TILE);
}

/* The debug font has no '~': one drawn in pixels, in the cell at (col, row)
 * of a text stream opened at (8, 8) with 8x8 characters. */
void gfx_tilde(int col, int row)
{
    static const signed char px[][2] = { { 1, 3 }, { 2, 3 }, { 5, 3 }, { 0, 4 }, { 3, 4 }, { 4, 4 } };
    int x = 8 + col * 8, y = 8 + row * 8;
    for (unsigned i = 0; i < sizeof(px) / sizeof(px[0]); i++)
        gfx_rect(x + px[i][0], y + px[i][1], x + px[i][0] + 1, y + px[i][1] + 1, 220, 220, 220);
}

/* The character: Signsign, exported from Blender (assets/export_signsign.py).
 * A textured, rigidly skinned mesh: each bone gets a matrix from the pose,
 * its vertices are transformed by it, then the triangles are lit (with the
 * normal on their bone) and drawn. The pose is set as angles: limbs hanging
 * down, swung about x, raised about z. */
#include "signsign.h"

#define SIGN_TEX_X 640    /* where the texture lives in VRAM (16-bit) */
#define SIGN_TEX_Y 0
#define SIGN_ARM_DOWN 860 /* the model's arms are out straight: lowered to the sides first */

static int sign_loaded;
static int32_t sign_sxy[SIGN_VERTS];
static int32_t sign_sz[SIGN_VERTS];

static void sign_load(void)
{
    RECT r = { SIGN_TEX_X, SIGN_TEX_Y, SIGN_TEX, SIGN_TEX };
    DrawSync(0);
    LoadImage(&r, (const uint32_t *)sign_tex);
    DrawSync(0);
    sign_loaded = 1;
}

void gfx_guy(const guy_t *g)
{
    int s = g->scale;
    int swing = g->airborne ? -500 : (isin(g->walk_phase) * 600) >> 12;
    int leg_l = swing, leg_r = -swing;
    int arm_l = -swing, arm_r = swing, roll_l = 0, roll_r = 0;
    int lean = 0, shin_l = 0, shin_r = 0, fore_l = 0, fore_r = 0, twist = 0;
    SVECTOR rot[SIGN_BONES];
    MATRIX world[SIGN_BONES];
    int b, i, tr = g->tint_r ? g->tint_r : 176, tg = g->tint_r ? g->tint_g : 176, tb = g->tint_r ? g->tint_b : 176;
    uint16_t tpage = getTPage(2, 0, SIGN_TEX_X, SIGN_TEX_Y);

    if (!sign_loaded) sign_load();
    /* (l and r here are the other way round from the model's bone names: r is the +x side) */
    /* in the air: knees up, fists up (elbows bent, one higher than the other: two
     * straight arms up would read as one raised arm from the side) */
    if (g->airborne) { arm_l = -700; arm_r = -1300; fore_l = 900; fore_r = 1100; shin_l = shin_r = 600; }
    if (g->wave) { arm_r = 0; roll_r = 1700 + ((isin(g->wave * 300) * 300) >> 12); fore_r = 500; }
    if (g->punch) {
        /* wind up (fist back by the chin, shoulder back), snap it out (arm
         * straight, shoulder and weight forward, front foot stepping in, the
         * other fist up guarding), hold, and ease back to rest */
        static const int16_t key[4][9] = {
            /* arm_r fore_r arm_l fore_l lean twist leg_l leg_r   at */
            {     0,     0,    0,     0,   0,    0,    0,    0,    0 },
            {  -500,  1500, -700,  1200, -60,  220,  -90,   70,   70 },
            { -1080,    40, -850,  1350, 150, -260, -190,  130,  100 },
            { -1080,    40, -850,  1350, 150, -260, -190,  130,  150 },
        };
        const int16_t *s0, *s1;
        int p = g->punch - 1, k = 0, u, j, a[8];
        if (p >= 150) { s0 = key[3]; s1 = key[0]; u = ((p - 150) * 4096) / 104; }
        else {
            while (k < 2 && p >= key[k + 1][8]) k++;
            s0 = key[k]; s1 = key[k + 1];
            u = ((p - key[k][8]) * 4096) / (key[k + 1][8] - key[k][8]);
        }
        if (u < 0) u = 0; else if (u > 4096) u = 4096;
        u = ((u * u) >> 12) * (3 * 4096 - 2 * u) >> 12;   /* eased in and out */
        for (j = 0; j < 8; j++) a[j] = s0[j] + (((s1[j] - s0[j]) * u) >> 12);
        arm_r = a[0]; fore_r = a[1]; arm_l = a[2]; fore_l = a[3]; lean = a[4]; twist = a[5];
        leg_l = a[6]; leg_r = a[7];
    }
    /* the flying kick: the front leg out straight, forward and down at the
     * opponent, the other tucked up under him, leaning back into it, fists up */
    if (g->kick) { leg_r = -560; shin_r = 0; leg_l = -1000; shin_l = 1600; lean = -90; arm_l = -600; fore_l = 1300; arm_r = 300; fore_r = 900; }
    /* blocking: both arms out in front, bent straight up at the elbows (a wall of forearms) */
    if (g->block) { arm_l = arm_r = -880; fore_l = fore_r = 1100; }
    if (g->hurt) { lean = -300; arm_l = arm_r = -600; }
    if (g->throw_) { arm_l = arm_r = -1024; lean = 100; }
    if (g->ko) { lean = -1024; leg_l = leg_r = 0; arm_l = arm_r = -1800; }
    /* clapping: both arms out in front, the hands meeting every few frames */
    if (g->clap) {
        int shut = ((g->clap - 1) / 5) & 1 ? 0 : 330;
        arm_l = arm_r = -1150; fore_l = fore_r = 300; roll_r = shut - 150; roll_l = -roll_r; lean = 60;
    }
    /* stunned: slumped, arms hanging, swaying */
    if (g->dizzy) { lean = -200 + ((isin(g->dizzy * 120) * 120) >> 12); arm_l = arm_r = -200; roll_l = roll_r = 0; }
    if (!g->airborne && swing) { shin_l = leg_l < 0 ? -leg_l / 2 : 0; shin_r = leg_r < 0 ? -leg_r / 2 : 0; }

    for (b = 0; b < SIGN_BONES; b++) rot[b].vx = rot[b].vy = rot[b].vz = 0;
    rot[SB_HIPS].vx = lean - g->flip;   /* (a backflip turns him over backwards about his hips) */
    rot[SB_CHEST].vy = twist;           /* the shoulders turning into a punch */
    rot[SB_ARM_L].vx = arm_r;  rot[SB_ARM_L].vz = -roll_r;   /* +x side */
    rot[SB_ARM_R].vx = arm_l;  rot[SB_ARM_R].vz = roll_l;
    /* elbows bend about their y (their x runs along the forearm: turning
     * about it only twists it); fore > 0 bends the fist forward/up */
    rot[SB_ELBOW_L].vy = fore_r;
    rot[SB_ELBOW_R].vy = -fore_l;
    rot[SB_KNEE_L].vx = leg_r;
    rot[SB_KNEE_R].vx = leg_l;
    rot[SB_LEG_L].vx = shin_r;
    rot[SB_LEG_R].vx = shin_l;

    /* the pose: each bone's matrix from its parent's, scaled to s / 16 */
    for (b = 0; b < SIGN_BONES; b++) {
        MATRIX local;
        int p = sign_skel[b][0];
        int ox = (sign_skel[b][1] * s) >> 4, oy = (sign_skel[b][2] * s) >> 4, oz = (sign_skel[b][3] * s) >> 4;
        gfx_matrix(&local, rot[b].vx, rot[b].vy, rot[b].vz, ox, oy, oz);
        if (b == SB_ARM_L || b == SB_ARM_R) {
            MATRIX down, m;
            gfx_matrix(&down, 0, 0, b == SB_ARM_L ? SIGN_ARM_DOWN : -SIGN_ARM_DOWN, 0, 0, 0);
            CompMatrixLV(&local, &down, &m);
            local = m;
        }
        if (p < 0) {
            /* the root stands at the feet (lying on its back when knocked out) */
            MATRIX root;
            gfx_matrix(&root, 0, g->yaw, 0, g->x, g->y + (g->ko ? ((-sign_skel[0][2] - 40) * s) >> 4 : 0), g->z);
            CompMatrixLV(&root, &local, &world[b]);
        } else {
            CompMatrixLV(&world[p], &local, &world[b]);
        }
    }

    /* every vertex onto the screen, with its bone's matrix */
    for (b = 0; b < SIGN_BONES; b++) {
        int first = sign_runs[b][0], n = sign_runs[b][1];
        if (!n) continue;
        gfx_object(&world[b]);
        for (i = first; i < first + n; i++) {
            SVECTOR v = { (sign_verts[i][0] * s) >> 4, (sign_verts[i][1] * s) >> 4, (sign_verts[i][2] * s) >> 4 };
            gte_ldv0(&v);
            gte_rtps();
            gte_stsxy(&sign_sxy[i]);
            gte_stsz(&sign_sz[i]);
        }
    }

    /* the triangles: facing the camera, lit with their bone's orientation */
    for (b = 0; b < SIGN_BONES; b++) {
        int first = sign_fruns[b][0], n = sign_fruns[b][1];
        /* the head a good deal darker: lit from the front, its pale skin and
         * the eyes' whites would blow out to plain white */
        int hr = b == SB_HEAD ? tr * 11 / 16 : tr, hg = b == SB_HEAD ? tg * 11 / 16 : tg, hb = b == SB_HEAD ? tb * 11 / 16 : tb;
        if (!n) continue;
        gfx_object(&world[b]);
        for (i = first; i < first + n; i++) {
            const uint16_t *f = sign_faces[i];
            const uint8_t *uv = sign_uvs[i];
            int32_t a = sign_sxy[f[0]], c = sign_sxy[f[1]], d = sign_sxy[f[2]];
            int ax = (int16_t)a, ay = a >> 16, cx = (int16_t)c, cy = c >> 16, dx = (int16_t)d, dy = d >> 16;
            int nclip = (cx - ax) * (dy - ay) - (dx - ax) * (cy - ay);
            int otz = (sign_sz[f[0]] + sign_sz[f[1]] + sign_sz[f[2]]) / 12;
            POLY_FT3 *pol = (POLY_FT3 *)gfx_nextpri;
            SVECTOR nrm = { sign_normals[i][0], sign_normals[i][1], sign_normals[i][2] };
            if (nclip <= 0) continue;   /* back-facing */
            if (otz <= 0 || otz >= OT_LEN - 2) continue;
            setPolyFT3(pol);
            setXY3(pol, ax, ay, cx, cy, dx, dy);
            setUV3(pol, uv[0], uv[1], uv[2], uv[3], uv[4], uv[5]);
            pol->tpage = tpage;
            pol->clut = 0;
            setRGB0(pol, hr, hg, hb);
            gte_ldrgb(&pol->r0);
            gte_ldv0(&nrm);
            gte_nccs();
            gte_strgb(&pol->r0);
            addPrim(gfx_ot + otz, pol);
            gfx_nextpri += sizeof(POLY_FT3);
        }
    }
}

void pad_init(void)
{
    InitPAD(pad_buff[0], 34, pad_buff[1], 34);
    StartPAD();
    ChangeClearPAD(0);
}

uint16_t pad_held(int port)
{
    PADTYPE *pad = (PADTYPE *)pad_buff[port & 1];
    return pad->stat == 0 ? (uint16_t)~pad->btn : 0;
}
