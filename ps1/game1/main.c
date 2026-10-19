/*
 * Game 1 "Rocky Road Trip", GelatoStation half: the same tile levels as the
 * GelatoBoy, rendered as lit 3D blocks with the character as a GTE model.
 */
#include <stdint.h>
#include <stdio.h>
#include <string.h>
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
#include "../../shared/plat.h"
#include "../../shared/game1.h"
#define LEVELS_PS1
#include "../../shared/levels1.h"

#define COLS   12
#define UNIT   8          /* world units per level pixel (tile = 128) */
#define HALF_D 64         /* half depth of a block */

static int level = -1;
static int frozen, won, banner_timer, hint;
static const char *banner = "";
static int yaw;

static int wx(int px) { return (px - COLS * 8) * UNIT; }
static int wy(int py) { return (py - 72) * UNIT; }

static void draw_gelato(int x, int y, int t, int scale)
{
    MATRIX m;
    /* the team's cone (common/cone.h: 1085 units tall, its tip 420 below its
     * origin): 180 units tall at scale 16 (it's slim: as tall as the block it
     * sits in, it'd be a sliver), its tip standing on the block's floor, 58
     * below (x, y) */
    int k = (680 * scale) >> 4;
    gfx_matrix(&m, 0, t * 24, 0, x, y + ((58 * scale) >> 4) - ((420 * k) >> 12), 0);
    gfx_object(&m);
    gfx_mesh(&cone_mesh, 0, CONE_TRIS, k);
}

static void draw_level(int t)
{
    MATRIX m;
    gfx_matrix(&m, 0, 0, 0, 0, 0, 0);
    for (int r = 0; r < PLAT_ROWS; r++) {
        for (int c = 0; c < COLS; c++) {
            char k = plat_map[r][c];
            int x0 = wx(c * 16), y0 = wy(r * 16);
            if (k == '#') {
                int top = r == 0 || plat_map[r - 1][c] != '#';
                /* skip faces hidden against neighbouring blocks */
                int sides = BOX_FRONT
                    | (c == 0 || plat_map[r][c - 1] != '#' ? BOX_LEFT : 0)
                    | (c == COLS - 1 || plat_map[r][c + 1] != '#' ? BOX_RIGHT : 0);
                gfx_object(&m);
                if (top) {
                    gfx_box_faces(x0, y0, -HALF_D, x0 + 128, y0 + 28, HALF_D, 140, 230, 190, sides | BOX_TOP);   /* mint icing */
                    gfx_box_faces(x0, y0 + 28, -HALF_D, x0 + 128, y0 + 128, HALF_D, 130, 80, 60, sides);        /* chocolate */
                } else {
                    gfx_box_faces(x0, y0, -HALF_D, x0 + 128, y0 + 128, HALF_D,
                                  (r + c) & 1 ? 130 : 115, (r + c) & 1 ? 80 : 70, 60, sides);
                }
            } else if (k == '^') {
                for (int i = 0; i < 2; i++) {
                    MATRIX sm;
                    gfx_matrix(&sm, 0, 512, 0, x0 + 32 + i * 64, y0 + 128, 0);
                    gfx_object(&sm);
                    gfx_pyramid(26, 70, 200, 200, 215);
                }
            } else if (k == 'G') {
                draw_gelato(x0 + 64, y0 + 70, t, 16);
            }
        }
    }
}

static void draw_player(void)
{
    guy_t g = { 0 };
    int target;
    if (!pl.active) return;
    target = pl.moving ? (pl.facing_left ? 1024 : -1024) : 0;
    yaw += (target - yaw) / 3;
    g.x = wx((pl.x >> 4) + PLAT_W / 2);
    g.y = wy((pl.y >> 4) + PLAT_H);
    g.z = 0;
    g.yaw = yaw;
    g.scale = 11;
    g.walk_phase = pl.anim * 200;
    g.airborne = !pl.on_ground;
    g.shirt_r = 236; g.shirt_g = 96; g.shirt_b = 140;
    g.pants_r = 60; g.pants_g = 80; g.pants_b = 200;
    gfx_guy(&g);
}

static void load_level(int n)
{
    level = n;
    frozen = 0;
    won = 0;
    banner_timer = 0;
    if (n != 0) hint = 0;
    plat_load(levels_ps1[n], COLS);
    plat_pit = 1;   /* gaps in the TV's floor drop into the void */
    plat_publish_map(&link_port.state[ST_MAP]);
    link_port.state[ST_LEVEL] = n;
}

static void handle_messages(void)
{
    uint8_t msg[LINK_MSG_LEN];
    while (link_recv(msg)) {
        if (msg[0] == MSG_LOAD && msg[1] < LEVEL_COUNT) {
            load_level(msg[1]);
        } else if (msg[0] == MSG_ENTER) {
            plat_place(msg[1], msg[2], (int8_t)msg[3], msg[4], msg[5]);
            frozen = 0;
        } else if (msg[0] == MSG_TAKE) {
            pl.active = 0;
        } else if (msg[0] == MSG_HINT) {
            hint = msg[1];
        } else if (msg[0] == MSG_GOAL) {
            banner = "GELATO ACQUIRED!";
            banner_timer = 90;
        } else if (msg[0] == MSG_WIN) {
            won = 1;
            pl.active = 0;
        }
    }
}

int main(void)
{
    uint16_t held = 0, prev, pressed;
    int t = 0;

    link_init(GAME1_ID);
    link_port.state[ST_LEVEL] = 0xFF;
    link_port.state[ST_LEVELS] = LEVEL_COUNT;
    gfx_init();
    pad_init();
    sfx_init();
    music_init();   /* (the host picks the song and whether it's heard: see web/src/music.js) */
    gfx_boot();   /* the GelatoStation's boot screens first */
    /* the character plane (z = 0) exactly fills the screen: 1 level pixel = 5/3 screen pixels */
    gfx_camera(0, 0, -768, 0);

    while (1) {
        sfx_update();
        music_frame();
        prev = held;
        held = pad_held(0);
        pressed = held & ~prev;
        link_port.frame++;
        t++;
        handle_messages();

        gfx_sky(30, 40, 110, 180, 120, 200);
        if (level < 0) {
            FntPrint(-1, "\n\n\n\n\n\n\n\n\n           ROCKY ROAD TRIP\n\n          CONNECT GELATOBOY");
            draw_gelato(0, 300, t, 24);
        } else if (won) {
            guy_t g = { 0 };
            FntPrint(-1, "\n\n            GELATO ACQUIRED!\n\n               YOU WIN!\n\n          THANKS FOR PLAYING");
            g.y = 380; g.scale = 12; g.wave = (t & 63) + 1;
            g.shirt_r = 236; g.shirt_g = 96; g.shirt_b = 140;
            g.pants_r = 60; g.pants_g = 80; g.pants_b = 200;
            gfx_guy(&g);
            draw_gelato(-420, 150, t, 20);
            draw_gelato(420, 150, -t, 20);
        } else {
            for (int i = 0; i < 4; i++)
                plat_exits[i] = link_port.ctrl[CTRL_EXIT_L + i * 2] | (link_port.ctrl[CTRL_EXIT_L + i * 2 + 1] << 8);

            if (!frozen) {
                uint8_t input = 0, ev;
                if (held & PAD_LEFT) input |= PL_LEFT;
                if (held & PAD_RIGHT) input |= PL_RIGHT;
                if (pressed & PAD_CROSS) input |= PL_JUMP;
                {
                    int was_ground = pl.on_ground, was_active = pl.active;
                    ev = plat_update(input);
                    if (was_active && was_ground && !pl.on_ground && pl.vy < 0) sfx_play(SFX_SQUARE, 300, 900, 8, 0x1800, 0);   /* jump */
                    if (was_active && !was_ground && pl.on_ground) sfx_play(SFX_NOISE, 2000, 600, 3, 0x1000, 0);           /* landing */
                }
                if (ev == PLAT_EV_EXIT) {
                    link_send(MSG_EXIT, plat_exit_dir, plat_exit_x, plat_exit_y, (uint8_t)pl.vy, pl.facing_left);
                } else if (ev == PLAT_EV_GOAL) {
                    frozen = 1;
                    link_send(MSG_GOAL, level, 0, 0, 0, 0);
                    banner = "GELATO ACQUIRED!";
                    banner_timer = 90;
                    sfx_play(SFX_SQUARE, 523, 1046, 30, 0x2000, -20);
                    sfx_play(SFX_SQUARE, 659, 1318, 30, 0x1800, 20);
                } else if (ev == PLAT_EV_DIED) {
                    frozen = 1;
                    link_send(MSG_DIED, level, 0, 0, 0, 0);
                    banner = "OUCH!";
                    banner_timer = 90;
                    sfx_play(SFX_NOISE, 8000, 500, 25, 0x2400, 0);
                    sfx_play(SFX_SQUARE, 400, 80, 30, 0x1800, 0);
                }
            }
            link_port.state[ST_PRESENT] = pl.active;
            link_port.state[ST_X] = (uint8_t)((pl.x >> 4) + PLAT_W / 2);
            link_port.state[ST_Y] = (uint8_t)((pl.y >> 4) + PLAT_H);
            link_port.state[ST_VY] = (uint8_t)pl.vy;
            link_port.state[ST_FACE] = pl.facing_left;

            draw_level(t);
            draw_player();
            {
                /* the text, a row at a time: LEVEL on row 0, level 1's hint on rows 2-3 and 5-6, the banner on row 7 */
                static char text[320];
                int n = sprintf(text, "LEVEL %d/%d", level + 1, LEVEL_COUNT), row = 0;
                if (hint && level == 0) {
                    n += sprintf(text + n, "\n\n    TRY POSITIONING YOUR GELATOBOY\n     IN FRONT OF THE GELATOVISION");
                    row = 3;
                    if (hint > 1) {
                        n += sprintf(text + n, "\n\n     ...THEN WALK ACROSS THE EDGE\n            OF THE SCREEN");
                        row = 6;
                    }
                }
                if (banner_timer) {
                    banner_timer--;
                    while (row++ < 7) text[n++] = '\n';
                    /* centred in the 38 columns (by hand: psn00bsdk's sprintf has no %*s) */
                    for (int pad = (38 - (int)strlen(banner)) / 2; pad > 0; pad--) text[n++] = ' ';
                    n += sprintf(text + n, "%s", banner);
                }
                FntPrint(-1, "%s", text);
            }
        }
        gfx_display();
    }
    return 0;
}
