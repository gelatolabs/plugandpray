/*
 * Game 1 "Rocky Road Trip", GelatoBoy half. The level's GB screen is drawn here; the
 * shared platformer core moves the character, and the host carries him to
 * the GelatoStation when the GB looks like it touches the TV picture.
 */
#include <gb/gb.h>
#include <stdint.h>
#include "assets.h"
#include "../sfx.h"
#include "../music/music.h"
#include "../../shared/link.h"
#include "../../shared/plat.h"
#include "../../shared/game1.h"
#define LEVELS_GB
#include "../../shared/levels1.h"

#define SPR_PLAYER 0   /* hardware sprites 0-1 */

static uint8_t level = 0xFF;
static uint8_t frozen;      /* goal reached / died: wait for the host */
static uint8_t won;

static void draw_text(uint8_t x, uint8_t y, const char *s)
{
    const char *font = FONT_CHARS;
    for (; *s; s++, x++) {
        uint8_t t = BG_FONT, i;
        for (i = 0; font[i]; i++)
            if (font[i] == *s) { t = BG_FONT + i; break; }
        set_bkg_tile_xy(x, y, t);
    }
}

/* Text along the top row, leaving out letters that would land on a solid cell. */
static void draw_label(uint8_t x, const char *s)
{
    const char *font = FONT_CHARS;
    for (; *s; s++, x++) {
        uint8_t t = BG_FONT, i;
        if (plat_map[0][x >> 1] == '#') continue;
        for (i = 0; font[i]; i++)
            if (font[i] == *s) { t = BG_FONT + i; break; }
        set_bkg_tile_xy(x, 0, t);
    }
}

static void clear_row(uint8_t y)
{
    fill_bkg_rect(0, y, 20, 1, BG_BLANK);
}

static void draw_level(void)
{
    uint8_t r, c, t;
    for (r = 0; r < PLAT_ROWS; r++) {
        for (c = 0; c < plat_cols; c++) {
            char m = plat_map[r][c];
            if (m == '#') t = BG_BRICK;
            else if (m == 'G') t = BG_GOAL;
            else if (m == '^') t = BG_SPIKES;
            else {
                fill_bkg_rect(c * 2, r * 2, 2, 2, BG_BLANK);
                continue;
            }
            set_bkg_tile_xy(c * 2, r * 2, t);
            set_bkg_tile_xy(c * 2 + 1, r * 2, t + 1);
            set_bkg_tile_xy(c * 2, r * 2 + 1, t + 2);
            set_bkg_tile_xy(c * 2 + 1, r * 2 + 1, t + 3);
        }
    }
    /* the label goes in the top row's empty cells only, so it never cuts into a wall */
    {
        char label[] = "LEVEL 0/0";
        label[6] = '1' + level;
        label[8] = '0' + LEVEL_COUNT;
        draw_label(2, label);
    }
}

static void hide_player(void)
{
    move_sprite(SPR_PLAYER, 0, 0);
    move_sprite(SPR_PLAYER + 1, 0, 0);
}

static void draw_player(void)
{
    uint8_t frame, x, y;
    if (!pl.active) { hide_player(); return; }
    if (!pl.on_ground) frame = SPR_JUMP;
    else if (pl.anim) frame = (pl.anim >> 3) & 1 ? SPR_WALK1 : SPR_WALK2;
    else frame = SPR_IDLE;
    /* the 16px sprite is centred on the 10px box */
    x = (uint8_t)((pl.x >> 4) - 3 + 8);
    y = (uint8_t)((pl.y >> 4) - 2 + 16);
    if (pl.facing_left) {
        set_sprite_tile(SPR_PLAYER, frame + 2);
        set_sprite_tile(SPR_PLAYER + 1, frame);
        set_sprite_prop(SPR_PLAYER, S_FLIPX);
        set_sprite_prop(SPR_PLAYER + 1, S_FLIPX);
    } else {
        set_sprite_tile(SPR_PLAYER, frame);
        set_sprite_tile(SPR_PLAYER + 1, frame + 2);
        set_sprite_prop(SPR_PLAYER, 0);
        set_sprite_prop(SPR_PLAYER + 1, 0);
    }
    move_sprite(SPR_PLAYER, x, y);
    move_sprite(SPR_PLAYER + 1, x + 8, y);
}

/* Level 1's hint, in its empty sky: n parts of it (0 clears it). */
static void draw_hint(uint8_t n)
{
    static const char *const lines[6] = {
        "TRY POSITIONING YOUR", "GELATOBOY IN FRONT", "OF THE GELATOVISION",
        "...THEN WALK ACROSS", "THE EDGE OF THE", "SCREEN",
    };
    uint8_t i, len;
    if (level != 0) return;
    fill_bkg_rect(0, 4, 20, 7, BG_BLANK);
    for (i = 0; i < n * 3; i++) {
        for (len = 0; lines[i][len]; len++) {}
        draw_text((20 - len) / 2, 4 + i + (i >= 3), lines[i]);
    }
}

static void load_level(uint8_t n)
{
    level = n;
    frozen = 0;
    won = 0;
    plat_load(levels_gb[n], 10);
    /* VRAM is only writable outside of active display; blank it while redrawing */
    DISPLAY_OFF;
    clear_row(2);     /* the last level's GELATO ACQUIRED! / OUCH! (before the level is drawn over it) */
    draw_level();
    DISPLAY_ON;
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
            draw_hint(msg[1]);
        } else if (msg[0] == MSG_GOAL) {
            draw_text(2, 2, "GELATO ACQUIRED!");
        } else if (msg[0] == MSG_WIN) {
            won = 1;
            pl.active = 0;
            hide_player();
            DISPLAY_OFF;
            fill_bkg_rect(0, 0, 20, 18, BG_BLANK);
            draw_text(5, 6, "YOU WIN!");
            DISPLAY_ON;
        }
    }
}

void main(void)
{
    uint8_t keys = 0, prev, pressed, input, ev, i;

    link_init(GAME1_ID);
    sfx_init();
    music_init();   /* (the host picks the song and whether it's heard: see web/src/music.js) */
    link_port.state[ST_LEVEL] = 0xFF;
    link_port.state[ST_LEVELS] = LEVEL_COUNT;

    DISPLAY_OFF;
    BGP_REG = 0xE4;
    OBP0_REG = 0xE4;
    set_bkg_data(0, BG_TILES_COUNT, bg_tiles);
    set_sprite_data(0, SPR_TILES_COUNT, spr_tiles);
    SPRITES_8x16;
    fill_bkg_rect(0, 0, 32, 32, BG_BLANK);
    draw_text(2, 7, "ROCKY ROAD TRIP");
    draw_text(6, 9, "CONNECT");
    draw_text(3, 10, "GELATOSTATION");
    SHOW_BKG;
    SHOW_SPRITES;
    DISPLAY_ON;

    while (1) {
        wait_vbl_done();
        music_frame();
        link_port.frame++;
        prev = keys;
        keys = joypad();
        pressed = keys & ~prev;
        handle_messages();
        if (level == 0xFF || won) continue;

        for (i = 0; i < 4; i++)
            plat_exits[i] = link_port.ctrl[CTRL_EXIT_L + i * 2] | ((uint16_t)link_port.ctrl[CTRL_EXIT_L + i * 2 + 1] << 8);

        input = 0;
        if (keys & J_LEFT) input |= PL_LEFT;
        if (keys & J_RIGHT) input |= PL_RIGHT;
        if (pressed & J_A) input |= PL_JUMP;

        if (!frozen) {
            uint8_t was_ground = pl.on_ground, was_active = pl.active;
            ev = plat_update(input);
            if (was_active && was_ground && !pl.on_ground && pl.vy < 0) sfx_sweep(0x17, 0x81, 1600);   /* jump: a rising blip */
            if (was_active && !was_ground && pl.on_ground) sfx_noise(0x41, 0x5F);                      /* landing */
            if (ev == PLAT_EV_EXIT) {
                link_send(MSG_EXIT, plat_exit_dir, plat_exit_x, plat_exit_y, (uint8_t)pl.vy, pl.facing_left);
            } else if (ev == PLAT_EV_GOAL) {
                frozen = 1;
                link_send(MSG_GOAL, level, 0, 0, 0, 0);
                draw_text(2, 2, "GELATO ACQUIRED!");
                sfx_sweep(0x15, 0xC4, 1750);
                sfx_beep(0, 0xA4, 1840);
            } else if (ev == PLAT_EV_DIED) {
                frozen = 1;
                link_send(MSG_DIED, level, 0, 0, 0, 0);
                draw_text(6, 2, "OUCH!");
                sfx_noise(0xF4, 0x57);
                sfx_sweep(0x1F, 0xA5, 1500);
            }
        }
        link_port.state[ST_PRESENT] = pl.active;
        link_port.state[ST_X] = (uint8_t)((pl.x >> 4) + PLAT_W / 2);
        link_port.state[ST_Y] = (uint8_t)((pl.y >> 4) + PLAT_H);
        link_port.state[ST_VY] = (uint8_t)pl.vy;
        link_port.state[ST_FACE] = pl.facing_left;
        draw_player();
    }
}
