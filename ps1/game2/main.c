/*
 * Game 2 "Vanilla Fighter II.5 (...)", GelatoStation half. On the PS1 the fighters are
 * 3D models, slower and heavier than the GelatoBoy's, with a longer reach:
 * Cross punches, Square blocks, Cross in the air is a flying kick; down,
 * forward + Cross throws a big, slow Gelato Blast. Up, forward, down, back +
 * Cross (either way round) is the backflip, landing in a clap that stuns.
 */
#include <stdint.h>
#include <stdio.h>
#include <psxapi.h>
#include <psxgpu.h>
#include <psxgte.h>
#include <psxpad.h>
#include "../common/gfx.h"
#include "../common/cone.h"
#include "../common/sfx.h"
#include "../common/music.h"
#include "../common/boot.h"
#include "../../shared/link.h"
#include "../../shared/fight.h"
#include "../../shared/game2.h"

#define ARENA_W 320
#define WORLD(u) ((u) * 7)   /* arena units -> world units */
#define FLOOR_Y 200          /* the camera maps arena (x, y) to screen (x, FLOOR_Y - y) */

static const move_t punch = { 4, 3, 9, 30, 30, 52, 6, 36, 0, 0 };
static const move_t blast = { 12, 1, 22, 0, 0, 0, 0, 0, 0, PROJ_POLY };
static const move_t flying_kick = { 4, 8, 10, 40, 0, 30, 8, 48, 0, 0 };
static const fight_cfg_t cfg = {
    ARENA_W, 24, 60,
    40, 150, 8,
    { 0, 96, 64 },   /* the GelatoBoy's Gelato Blast is quick, the GelatoStation's slow (and it hits harder) */
    { 0, 5, 10 },
    6,
    { &punch, &blast, &flying_kick },
};

static int loaded, intro, frozen, match_over, banner_timer;
static const char *banner = "";
static int yaw[2];

static void draw_floor(void)
{
    gfx_floor(-10, 10, -4, 6, 160, 90, 110, 200, 200, 210, 250);
}

static void draw_backdrop(int t)
{
    MATRIX m;
    for (int i = 0; i < 2; i++) {
        int x = i ? 900 : -900;
        /* the team's scoops and cherry (common/cone.h, no cone), standing on the
         * floor at 1.6x (their drips reach 44 below the origin): 1130 tall */
        gfx_matrix(&m, 0, 0, 0, x, -70, 700);
        gfx_object(&m);
        gfx_mesh(&cone_mesh, CONE_SCOOPS, CONE_TRIS - CONE_SCOOPS, 6554);
    }
}

static void fighter_colors(guy_t *g, int i)
{
    if (i == 0) { g->shirt_r = 236; g->shirt_g = 96; g->shirt_b = 140; g->pants_r = 60; g->pants_g = 80; g->pants_b = 200; }
    else {
        g->shirt_r = 110; g->shirt_g = 220; g->shirt_b = 160; g->pants_r = 70; g->pants_g = 50; g->pants_b = 40;
        g->tint_r = 120; g->tint_g = 190; g->tint_b = 230;   /* the CPU: a cold blue twin */
    }
}

static void draw_fighter(int i, int t)
{
    fighter_t *f = &fighters[i];
    guy_t g = { 0 };
    int target;
    if (!f->present) return;
    target = f->facing_left ? 1024 : -1024;
    yaw[i] += (target - yaw[i]) / 3;
    g.x = WORLD((f->x >> 4) - ARENA_W / 2);
    g.y = -WORLD(f->y >> 4);
    g.yaw = yaw[i];
    g.scale = 30;
    fighter_colors(&g, i);
    g.airborne = f->y > 0;
    switch (f->state) {
    case FS_WALK: f->anim++; g.walk_phase = f->anim * 220; break;
    case FS_JUMP: g.airborne = 1; break;
    case FS_ATTACK: {
        /* the pose while it comes out and hits, then straight back */
        const move_t *mv = cfg.moves[f->move];
        if (f->move == MOVE_PUNCH) {
            /* a punch is animated all the way through: how far into it (1-255) */
            int len = mv->startup + mv->active + mv->recovery;
            g.punch = (uint8_t)(1 + (f->timer >= len ? 254 : f->timer * 254 / len));
            break;
        }
        if (f->timer > mv->startup + mv->active + 2 && f->move != MOVE_BLAST) break;
        if (f->move == MOVE_KICK) g.kick = 1;
        else g.throw_ = 1;
        break;
    }
    case FS_BLOCK: g.block = 1; break;
    case FS_HURT: g.hurt = 1; break;
    case FS_KO: g.ko = 1; break;
    case FS_WIN: g.wave = (t & 63) + 1; break;
    case FS_FLIP: g.airborne = 1; g.flip = f->spin * 16; break;
    /* stunned: stands there clapping, swaying, seeing stars */
    case FS_STUN: g.clap = (f->timer & 63) + 1; g.yaw += (isin(t * 90) * 160) >> 12; break;
    }
    gfx_guy(&g);
    /* stunned: stars going round his head */
    if (f->state == FS_STUN) {
        for (int k = 0; k < 3; k++) {
            MATRIX m;
            int a = t * 70 + k * 1365;
            gfx_matrix(&m, 0, t * 40, 0, g.x + ((icos(a) * 170) >> 12), g.y - 640, (isin(a) * 170) >> 12);
            gfx_object(&m);
            gfx_pyramid(55, 60, 255, 240, 120);
        }
    }
}

static void draw_projectiles(int t)
{
    for (int i = 0; i < MAX_PROJ; i++) {
        proj_t *p = &projs[i];
        MATRIX m;
        if (!p->active) continue;
        gfx_matrix(&m, t * 90, t * 60, 0, WORLD((p->x >> 4) - ARENA_W / 2), -WORLD(p->y >> 4), 0);
        gfx_object(&m);
        if (p->type == PROJ_BIT) {
            /* the GelatoBoy's projectile: a chunky green pixel */
            gfx_box(-40, -40, -40, 40, 40, 40, 150, 190, 30);
        } else {
            gfx_pyramid(50, 60, 255, 110, 200);
            gfx_box(-30, -30, -30, 30, 30, 30, 255, 200, 240);
        }
    }
}

static void draw_hud(void)
{
    int hp1 = link_port.ctrl[C2_HP1], hp2 = link_port.ctrl[C2_HP2], wins = link_port.ctrl[C2_WINS];
    /* primitives added later to the same OT slot are drawn first: fill, then its frame */
    gfx_rect(16, 24, 16 + hp1 * 120 / 100, 30, 255, 210, 60);
    gfx_rect(304 - hp2 * 120 / 100, 24, 304, 30, 255, 210, 60);
    gfx_rect(14, 22, 138, 32, 20, 20, 30);
    gfx_rect(182, 22, 306, 32, 20, 20, 30);
    for (int i = 0; i < 2; i++) {
        if ((wins & 15) > i) gfx_rect(16 + i * 10, 36, 22 + i * 10, 42, 255, 120, 170);
        if ((wins >> 4) > i) gfx_rect(298 - i * 10, 36, 304 - i * 10, 42, 120, 230, 170);
    }
    FntPrint(-1, "PLAYER 1                           CPU");
}

static void say(const char *s, int frames)
{
    banner = s;
    banner_timer = frames;
}

static void handle_messages(void)
{
    uint8_t msg[LINK_MSG_LEN];
    while (link_recv(msg)) {
        switch (msg[0]) {
        case MSG_LOAD:
            fight_reset(msg[2]);
            loaded = 1;
            match_over = 0;
            frozen = 1;
            intro = 90;
            say(msg[1] == 0 ? "ROUND 1/3" : msg[1] == 1 ? "ROUND 2/3" : "FINAL ROUND", 60);
            break;
        case MSG_ENTER:
            fight_enter(msg[1], msg[2], msg[3], msg[4], msg[5], msg[6], (int8_t)msg[7]);
            break;
        case MSG_STUN:
            fight_stun(msg[1]);
            break;
        case MSG_ROUND:
            frozen = 1;
            if (fighters[msg[1] - 1].present) fight_set_state(msg[1], FS_WIN);
            if (fighters[2 - msg[1]].present) fight_set_state(3 - msg[1], FS_KO);
            say("K.O.", 120);
            break;
        case MSG_MATCH:
            frozen = 1;
            match_over = 1;
            say(msg[1] == 1 ? "YOU WIN!" : "YOU LOSE - PRESS A", 100000);
            break;
        }
    }
}

int main(void)
{
    uint16_t held = 0, prev, pressed;
    int t = 0;

    link_init(GAME2_ID);
    fight_init(&cfg);
    gfx_init();
    pad_init();
    sfx_init();
    music_init();   /* (the host picks the song and whether it's heard: see web/src/music.js) */
    gfx_boot();   /* the GelatoStation's boot screens first */
    /* level camera, so the fighters' plane maps linearly onto the screen (see FLOOR_Y) */
    gfx_camera(0, -560, -1120, 0);

    while (1) {
        sfx_update();
        music_frame();
        uint8_t in0 = 0, active = 0;
        prev = held;
        held = pad_held(0);
        pressed = held & ~prev;
        link_port.frame++;
        t++;
        handle_messages();

        gfx_sky(60, 30, 90, 240, 150, 120);
        draw_floor();
        draw_backdrop(t);
        if (!loaded) {
            /* each line centred in the 38 columns; the tildes are drawn (the font has none) */
            FntPrint(-1, "\n\n\n\n\n\n\n VANILLA FIGHTER II.5 EX TURBO REMIX\n     EXTRA SCOOP  COLD EDITION '99\n    DIRECTOR'S CUT (GREATEST HITS)\n\n\n          CONNECT GELATOBOY");
            gfx_tilde(4, 8);
            gfx_tilde(16, 8);
            gfx_display();
            continue;
        }
        if (intro) {
            intro--;
            if (intro == 30) { say("FIGHT!", 30); frozen = 0; }
        }

        if (held & PAD_LEFT) in0 |= IN_LEFT;
        if (held & PAD_RIGHT) in0 |= IN_RIGHT;
        if (held & PAD_UP) in0 |= IN_UP;
        if (held & PAD_DOWN) in0 |= IN_DOWN;
        if (pressed & PAD_CROSS) in0 |= IN_A;
        if (held & PAD_SQUARE) in0 |= IN_B;   /* (held: Square blocks for as long as it's down) */
        in0 = fight_combo(in0);
        if (match_over && (pressed & PAD_CROSS)) link_send(MSG_REMATCH, 0, 0, 0, 0, 0);

        fight_read_link();
        fight_update(in0, link_port.ctrl[C2_CPU_IN], frozen);
        for (int i = 0; i < fight_event_count; i++) {
            fight_event_t *ev = &fight_events[i];
            link_send7(ev->type == EV_EXIT ? MSG_EXIT : ev->type == EV_STUN ? MSG_STUN : MSG_HIT, ev->a, ev->b, ev->c, ev->d, ev->e, ev->f, ev->g);
            if (ev->type == EV_HIT) {
                if (ev->d) sfx_play(SFX_NOISE, 6000, 3000, 3, 0x1400, 0);          /* blocked: a tap */
                else { sfx_play(SFX_NOISE, 3000, 400, 8, 0x3000, 0); sfx_play(SFX_SQUARE, 180, 60, 8, 0x1800, 0); }   /* a hit */
            }
        }
        /* attacks, jumps and throws, as they start */
        for (int i = 0; i < 2; i++) {
            static uint8_t was[2];
            fighter_t *f = &fighters[i];
            int pan = f->present ? ((f->x >> 4) - ARENA_W / 2) * 64 / (ARENA_W / 2) : 0;
            if (f->present && f->state != was[i]) {
                if (f->state == FS_JUMP) sfx_play(SFX_SQUARE, 250, 600, 6, 0x1000, pan);
                if (f->state == FS_ATTACK) {
                    if (f->move == MOVE_BLAST) sfx_play(SFX_SQUARE, 1200, 200, 20, 0x1800, pan);   /* Gelato Blast */
                    else sfx_play(SFX_NOISE, 9000 - f->move * 2000, 4000, 4, 0x1000, pan);   /* whoosh */
                }
                if (f->state == FS_KO) sfx_play(SFX_SQUARE, 500, 50, 60, 0x2400, pan);
                if (f->state == FS_FLIP) sfx_play(SFX_SQUARE, 300, 900, 14, 0x1000, pan);           /* whee */
                if (f->state == FS_STUN) sfx_play(SFX_SQUARE, 900, 700, 50, 0x1400, pan);           /* seeing stars */
            }
            if (f->present && f->state == FS_STUN && f->timer % 10 == 0) {
                sfx_play(SFX_NOISE, 12000, 6000, 3, 0x2400, pan);                                   /* clap */
            }
            was[i] = f->present ? f->state : 255;
        }

        link_port.state[S2_PRESENT] = fighters[0].present | (fighters[1].present << 1);
        link_port.state[S2_P1X] = (uint8_t)((fighters[0].x >> 4) * 4 / 5);   /* 320 -> 256 */
        link_port.state[S2_P1Y] = (uint8_t)(((fighters[0].y >> 4) * 64) / 60);
        link_port.state[S2_P2X] = (uint8_t)((fighters[1].x >> 4) * 4 / 5);
        link_port.state[S2_P2Y] = (uint8_t)(((fighters[1].y >> 4) * 64) / 60);
        link_port.state[S2_P1ST] = fighters[0].state;
        link_port.state[S2_P2ST] = fighters[1].state;
        link_port.state[S2_FACE] = fighters[0].facing_left | (fighters[1].facing_left << 1);
        for (int i = 0; i < MAX_PROJ; i++) if (projs[i].active) active |= projs[i].owner;
        link_port.state[S2_PROJ] = active;
        link_port.state[S2_THREAT] = fight_threat();

        draw_fighter(0, t);
        draw_fighter(1, t);
        draw_projectiles(t);
        draw_hud();
        if (banner_timer) {
            banner_timer--;
            int len = 0;
            while (banner[len]) len++;
            FntPrint(-1, "\n\n\n\n\n\n\n\n\n%s%s", "                   " + (len > 38 ? 19 : len / 2), banner);
        }
        gfx_display();
    }
    return 0;
}
