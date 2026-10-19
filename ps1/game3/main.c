/*
 * Game 3 "License to Chill", GelatoStation half: 3D brain-freeze ghosts over a
 * night skyline. Zapper shots arrive as MSG_SHOT; like a real light gun the
 * screen goes black with white target boxes for a frame when you fire.
 */
#include <stdint.h>
#include <stdio.h>
#include <psxapi.h>
#include <psxgpu.h>
#include <psxgte.h>
#include <psxpad.h>
#include "../common/gfx.h"
#include "../common/sfx.h"
#include "../common/music.h"
#include "../common/boot.h"
#include "../common/enemy.h"
#include "../common/heart.h"
#include "../../shared/link.h"
#include "../../shared/zap.h"
#include "../../shared/game3.h"

#define CAM_Z 768
#define WX(px) (((px) - SCREEN_W / 2) * CAM_Z / (SCREEN_W / 2))
#define WY(py) (((py) - SCREEN_H / 2) * CAM_Z / (SCREEN_W / 2))

static const zap_cfg_t cfg = { 320, 240, 20, 28, 22 };

static int loaded, flash, phase, banner_timer;
static const char *banner = "";

static void say(const char *s, int frames) { banner = s; banner_timer = frames; }

/* The title's START button (screen pixels), and how much slack a shot gets round it. */
#define BTN_X0 116
#define BTN_Y0 126
#define BTN_X1 196
#define BTN_Y1 154
#define BTN_SLACK 6

static int on_button(int x, int y)
{
    return x >= BTN_X0 - BTN_SLACK && x < BTN_X1 + BTN_SLACK && y >= BTN_Y0 - BTN_SLACK && y < BTN_Y1 + BTN_SLACK;
}

/* The title: the name, the START button to shoot, and (until it's in your hand) where the gun is. */
static void draw_title(int t)
{
    int glow = 200 + ((isin(t * 60) * 55) >> 12);
    /* primitives added later to the same OT slot are drawn first: the face, then its frame */
    gfx_rect(BTN_X0 + 3, BTN_Y0 + 3, BTN_X1 - 3, BTN_Y1 - 3, 50, glow, 70);   /* (green, glowing) */
    gfx_rect(BTN_X0, BTN_Y0, BTN_X1, BTN_Y1, 255, 240, 220);
    gfx_rect(BTN_X0 + 2, BTN_Y0 + 4, BTN_X1 + 2, BTN_Y1 + 4, 20, 10, 30);   /* its shadow */
    FntPrint(-1, "\n\n\n\n\n\n\n           LICENSE TO CHILL\n\n\n\n\n\n\n\n\n                START");   /* row 16, col 16: the button's middle */
    if (!link_port.ctrl[C3_ZAPPER]) FntPrint(-1, "\n\n\n\n\n\n  PICK UP THE GELATOBLASTER TO PLAY");
}

static void draw_city(int t)
{
    MATRIX m;
    static const int heights[10] = { 500, 800, 650, 1100, 700, 950, 600, 1200, 750, 550 };
    gfx_matrix(&m, 0, 0, 0, 0, 0, 0);
    gfx_object(&m);
    for (int i = 0; i < 10; i++) {
        int x0 = -2200 + i * 440;
        gfx_box(x0, 1400 - heights[i], 1600, x0 + 400, 1400, 1900, 40, 40, 70 + i * 6);
    }
    /* twinkling stars */
    for (int i = 0; i < 24; i++) {
        int sx = (i * 97 + 13) % SCREEN_W, sy = (i * 53 + 7) % 120 + 4;
        int b = ((t + i * 11) >> 3) & 7 ? 200 : 90;
        gfx_rect(sx, sy, sx + 2, sy + 2, b, b, b);
    }
}

/* The team's enemies (common/enemy.h): the body facing us,
 * swaying a little from side to side, and its wings flapping about their
 * shoulders (the fast one's faster). Hit, it tumbles as it falls. */
static void draw_wing(MATRIX *body, const mesh_t *wing, const int16_t *hinge, int flap)
{
    MATRIX local, m;
    /* the body's matrix, then the hinge and the flap (about the front-back axis) */
    gfx_matrix(&local, 0, 0, flap, hinge[0], hinge[1], hinge[2]);
    CompMatrixLV(body, &local, &m);
    gfx_object(&m);
    gfx_mesh(wing, 0, wing->tris, ONE);
}

static void draw_enemy(enemy_t *e, int t)
{
    const enemy_model_t *em = &enemy_models[(e->type == EN_ZIPPY || e->type == EN_BIG ? e->type : EN_BASIC) - 1];
    MATRIX m;
    int x = WX(e->x >> 4), y = WY(e->y >> 4);
    int spin = e->state == ES_DIE ? e->timer * 140 : 0;
    int sway = (isin(t * 24 + (int)(e - enemies) * 700) * 170) >> 12;   /* +-15 degrees (4096: a whole turn) */
    /* turned to face the camera (off to the side, it'd show its side): atan(x / CAM_Z),
     * as u / (1 + 0.28 u^2) radians, 652 of the GTE's units each */
    int u = x * 4096 / CAM_Z, face = u * 652 / (4096 + ((u * u) >> 12) * 28 / 100);
    /* tips from 9 degrees down to 30 up (a left wing's tip rises turning +, a right one's -) */
    int flap = 120 + ((isin(t * (e->type == EN_ZIPPY ? 400 : 250)) * 220) >> 12);
    gfx_matrix(&m, spin, face + sway + spin / 3, spin / 2, x, y, 0);
    gfx_object(&m);
    gfx_mesh(em->body, 0, em->body->tris, ONE);
    draw_wing(&m, em->wing_l, em->hinge_l, flap);
    draw_wing(&m, em->wing_r, em->hinge_r, -flap);
}

/* The score, the wave, and the lives: hearts in the top right, spinning (each
 * a little behind the last), the ones lost dark and still. */
static void draw_hud(int t)
{
    int score = link_port.ctrl[C3_SCORE] | (link_port.ctrl[C3_SCORE + 1] << 8);
    int lives = link_port.ctrl[C3_LIVES];
    FntPrint(-1, "SCORE %d     WAVE %d/5", score * 10, link_port.ctrl[C3_WAVE] + 1);
    for (int i = 0; i < 5; i++) {
        MATRIX m;
        int x = 302 - i * 16;
        gfx_matrix(&m, 0, i < lives ? t * 40 + i * 400 : 0, 0, WX(x), WY(14), 0);
        gfx_object(&m);
        gfx_mesh(i < lives ? &heart_life : &heart_lost, 0, HEART_TRIS, ONE * 3 / 4);   /* (about 9 pixels across) */
    }
}

/* The light gun's detection frame: black screen, white boxes where targets are. */
static void draw_flash(void)
{
    if (phase == PH_TITLE) gfx_rect(BTN_X0, BTN_Y0, BTN_X1, BTN_Y1, 255, 255, 255);
    for (int i = 0; i < MAX_ENEMIES; i++) {
        enemy_t *e = &enemies[i];
        int x, y;
        if (e->state != ES_FLY && e->state != ES_FLEE) continue;
        x = e->x >> 4;
        y = e->y >> 4;
        gfx_rect(x - 16, y - 16, x + 16, y + 16, 255, 255, 255);
    }
    gfx_rect(0, 0, SCREEN_W, SCREEN_H, 0, 0, 0);
}

static void handle_messages(void)
{
    uint8_t msg[LINK_MSG_LEN];
    while (link_recv(msg)) {
        switch (msg[0]) {
        case MSG_LOAD:
            zap_clear();
            loaded = 1;
            phase = PH_PLAY;
            say(msg[1] == 4 ? "FINAL WAVE" : msg[1] == 0 ? "WAVE 1/5" : msg[1] == 1 ? "WAVE 2/5" : msg[1] == 2 ? "WAVE 3/5" : "WAVE 4/5", 90);
            break;
        case MSG_SPAWN:
            zap_spawn(msg[1], msg[2], msg[3]);
            break;
        case MSG_ENTER:
            zap_enter(msg[1], msg[2], msg[3], msg[4]);
            break;
        case MSG_SHOT: {
            uint8_t res;
            flash = 1;
            if (phase == PH_TITLE) {
                if (on_button(msg[1] | (msg[2] << 8), msg[3])) { link_send(MSG_START, 0, 0, 0, 0, 0); sfx_play(SFX_SQUARE, 523, 1046, 20, 0x2000, 0); }
                break;
            }
            res = zap_shoot(msg[1] | (msg[2] << 8), msg[3]);
            link_send(MSG_RESULT, res ? 1 : 0, res, 0, 0, 0);
            if (res & ZAP_KILLED) { sfx_play(SFX_NOISE, 5000, 200, 18, 0x3000, 0); sfx_play(SFX_SQUARE, 900, 1800, 10, 0x1800, 0); }
            else if (res) sfx_play(SFX_SQUARE, 600, 300, 6, 0x1800, 0);   /* hit, not down yet */
            break;
        }
        case MSG_PHASE:
            phase = msg[1];
            if (phase == PH_TITLE) { zap_clear(); loaded = 1; banner_timer = 0; }
            if (phase == PH_CLEAR) { say("WAVE CLEAR!", 90); sfx_play(SFX_SQUARE, 523, 1046, 30, 0x2000, 0); }
            if (phase == PH_OVER) { zap_clear(); say("GAME OVER - PRESS A", 1 << 30); }
            if (phase == PH_WIN) { zap_clear(); say("YOU WIN!", 1 << 30); }
            break;
        }
    }
}

int main(void)
{
    uint16_t held = 0, prev;
    int t = 0;

    link_init(GAME3_ID);
    zap_init(&cfg);
    gfx_init();
    pad_init();
    sfx_init();
    music_init();   /* (the host picks the song and whether it's heard: see web/src/music.js) */
    gfx_boot();   /* the GelatoStation's boot screens first */
    gfx_camera(0, 0, -CAM_Z, 0);

    while (1) {
        sfx_update();
        music_frame();
        prev = held;
        held = pad_held(0);
        link_port.frame++;
        t++;
        handle_messages();

        gfx_sky(10, 10, 40, 70, 40, 110);
        draw_city(t);
        if (!loaded) {
            FntPrint(-1, "\n\n\n\n\n\n\n\n\n           LICENSE TO CHILL\n\n          CONNECT GELATOBOY");
            gfx_display();
            continue;
        }
        if (phase == PH_OVER && (held & ~prev & PAD_CROSS)) link_send(MSG_PHASE, PH_OVER, 0, 0, 0, 0);

        zap_update(link_port.ctrl[CTRL_EDGES]);
        for (int i = 0; i < zap_event_count; i++) {
            zap_event_t *ev = &zap_events[i];
            if (ev->type == ZEV_EXIT) link_send(MSG_EXIT, ev->a, ev->b, ev->c, ev->d, 0);
            else link_send(MSG_ESCAPE, ev->a, 0, 0, 0, 0);
        }
        zap_publish();

        if (flash) {
            draw_flash();
            flash--;
        } else if (phase == PH_TITLE) {
            draw_title(t);
        } else {
            for (int i = 0; i < MAX_ENEMIES; i++)
                if (enemies[i].state != ES_NONE) draw_enemy(&enemies[i], t);
            draw_hud(t);
            if (phase == PH_WIN) {
                guy_t g = { 0 };
                g.y = 420; g.scale = 10; g.wave = (t & 63) + 1;
                g.shirt_r = 236; g.shirt_g = 96; g.shirt_b = 140;
                g.pants_r = 60; g.pants_g = 80; g.pants_b = 200;
                gfx_guy(&g);
            }
            if (banner_timer) {
                int len = 0;
                banner_timer--;
                while (banner[len]) len++;
                FntPrint(-1, "\n\n\n\n\n\n\n\n\n%s%s", "                   " + (len > 38 ? 19 : len / 2), banner);
            }
        }
        gfx_display();
    }
    return 0;
}
