/*
 * The ending, on the GelatoBoy once it's plugged into the port at the end of
 * the maze: "YOU ESCAPED REALITY!", then the credits roll up the screen. The
 * character stands on the floor at the bottom; he can walk off either side
 * into the room (the host takes him from there) and come back.
 *
 * The credits are on the background layer, which scrolls; the floor is on
 * the window layer, which doesn't.
 */
#include <gb/gb.h>
#include <stdint.h>
#include "assets.h"
#include "../sfx.h"
#include "../../shared/link.h"
#include "../../shared/plat.h"
#include "../../shared/ending.h"

#define SPR_PLAYER 0
#define FLOOR_Y 128        /* the window (floor) starts here */
#define FLOOR_TOP 10       /* the floor tile's empty rows above its ground */
#define HOLD 150           /* frames the title stays before the roll starts */
#define SPEED 3            /* frames per pixel of scrolling */

static const char *const level[PLAT_ROWS] = {
    "..........", "..........", "..........", "..........", "..........",
    "..........", "..........", "..........", "##########",
};

static const char *const credits[] = {
    "", "", "GELATO LABS", "", "PLUG AND PRAY", "MADE FOR", "LUDUM DARE 60", "\"OLD TECH\"", "", "",
    "ROCKY ROAD TRIP", "", "VANILLA FIGHTER II.5", "EX TURBO REMIX", "-EXTRA SCOOP-", "COLD EDITION 99", "DIRECTORS CUT", "GREATEST HITS", "", "LICENSE TO CHILL",
    "", "", "THE GELATO LABS", "\"G-TEAM\" FOR LD60 IS", "",
    "PROGRAMMING:", "KFARWELL", "CLAUDE", "", "3D ART:", "SIGNSEI", "KFARWELL", "", "GB ART:", "LDUSER125", "",
    "2D ART:", "THORNEDMARBLE", "KFARWELL", "", "AUDIO:", "CLAUDE",
    "", "", "MADE WITH:", "", "GBDK-2020", "PSN00BSDK", "V810-GCC", "", "SAMEBOY", "PCSX REARMED", "BEETLE VB", "",
    "EMSCRIPTEN", "THREE.JS", "", "BLENDER", "SUBSTANCE PAINTER", "GIMP", "", "", "THANKS FOR PLAYING!", "", "", "",
    "", "", "",
};
#define CREDITS (sizeof(credits) / sizeof(credits[0]))

static uint8_t tile_for(char ch)
{
    const char *font = FONT_CHARS;
    uint8_t i;
    for (i = 0; font[i]; i++)
        if (font[i] == ch) return BG_FONT + i;
    return BG_BLANK;
}

/* a line of text centred on background row `row` (0-31) */
static void put_line(uint8_t row, const char *s)
{
    uint8_t len = 0, x;
    while (s[len]) len++;
    fill_bkg_rect(0, row, 20, 1, BG_BLANK);
    for (x = (20 - len) / 2; *s; s++, x++) set_bkg_tile_xy(x, row, tile_for(*s));
}

static void draw_player(void)
{
    uint8_t frame, x, y;
    if (!pl.active) {
        move_sprite(SPR_PLAYER, 0, 0);
        move_sprite(SPR_PLAYER + 1, 0, 0);
        return;
    }
    if (!pl.on_ground) frame = SPR_JUMP;
    else if (pl.anim) frame = (pl.anim >> 3) & 1 ? SPR_WALK1 : SPR_WALK2;
    else frame = SPR_IDLE;
    x = (uint8_t)((pl.x >> 4) - 3 + 8);
    /* (10 lower than the floor it stands on: the team's floor tile's ground is 10 rows down it) */
    y = (uint8_t)((pl.y >> 4) - 2 + 16 + FLOOR_TOP);
    set_sprite_tile(SPR_PLAYER, pl.facing_left ? frame + 2 : frame);
    set_sprite_tile(SPR_PLAYER + 1, pl.facing_left ? frame : frame + 2);
    set_sprite_prop(SPR_PLAYER, pl.facing_left ? S_FLIPX : 0);
    set_sprite_prop(SPR_PLAYER + 1, pl.facing_left ? S_FLIPX : 0);
    move_sprite(SPR_PLAYER, x, y);
    move_sprite(SPR_PLAYER + 1, x + 8, y);
}

void main(void)
{
    uint8_t keys = 0, prev, pressed, input, ev, i, x;
    uint16_t t = 0, scroll = 0, next = 0;
    uint8_t written = 0;   /* rows written since the roll started (every other one is blank) */

    link_init(ENDING_ID);
    sfx_init();
    DISPLAY_OFF;
    BGP_REG = 0xE4;
    OBP0_REG = 0xE4;
    set_bkg_data(0, BG_TILES_COUNT, bg_tiles);
    set_sprite_data(0, SPR_TILES_COUNT, spr_tiles);
    SPRITES_8x16;
    fill_bkg_rect(0, 0, 32, 32, BG_BLANK);
    put_line(6, "YOU ESCAPED");
    put_line(8, "REALITY!");
    /* the floor, on the window */
    for (x = 0; x < 20; x += 2) {
        set_win_tile_xy(x, 0, BG_FLOOR);
        set_win_tile_xy(x + 1, 0, BG_FLOOR + 1);
        set_win_tile_xy(x, 1, BG_FLOOR + 2);
        set_win_tile_xy(x + 1, 1, BG_FLOOR + 3);
    }
    move_win(7, FLOOR_Y);
    plat_load(level, 10);
    plat_place(80, FLOOR_Y, 0, 0, 0);
    SHOW_BKG;
    SHOW_WIN;
    SHOW_SPRITES;
    DISPLAY_ON;

    while (1) {
        wait_vbl_done();
        link_port.frame++;
        t++;
        /* roll the credits: each new row coming up from behind the floor gets the next line */
        if (t > HOLD && (t % SPEED) == 0) {
            scroll++;
            SCY_REG = (uint8_t)scroll;
            if ((scroll & 7) == 0) {
                /* the row just behind the floor, about to scroll up into view */
                uint8_t row = (uint8_t)(((scroll >> 3) + 16) & 31);
                if (written & 1) fill_bkg_rect(0, row, 20, 1, BG_BLANK);
                else { put_line(row, credits[next]); next = (next + 1) % CREDITS; }
                written++;
            }
        }

        prev = keys;
        keys = joypad();
        pressed = keys & ~prev;
        { /* messages: the character coming back in from the room */
            uint8_t msg[LINK_MSG_LEN];
            while (link_recv(msg)) {
                if (msg[0] == MSG_ENTER) plat_place(msg[1], msg[2], (int8_t)msg[3], msg[4], msg[5]);
                else if (msg[0] == MSG_TAKE) pl.active = 0;
            }
        }
        for (i = 0; i < 4; i++)
            plat_exits[i] = link_port.ctrl[CTRL_EXIT_L + i * 2] | ((uint16_t)link_port.ctrl[CTRL_EXIT_L + i * 2 + 1] << 8);
        input = 0;
        if (keys & J_LEFT) input |= PL_LEFT;
        if (keys & J_RIGHT) input |= PL_RIGHT;
        if (pressed & J_A) input |= PL_JUMP;
        if (pl.active) {
            uint8_t was_ground = pl.on_ground;
            ev = plat_update(input);
            if (was_ground && !pl.on_ground && pl.vy < 0) sfx_sweep(0x17, 0x81, 1600);
            if (!was_ground && pl.on_ground) sfx_noise(0x41, 0x5F);
            if (ev == PLAT_EV_EXIT)
                link_send(MSG_EXIT, plat_exit_dir, plat_exit_x, plat_exit_y, (uint8_t)pl.vy, pl.facing_left);
        }
        link_port.state[ST_PRESENT] = pl.active;
        link_port.state[ST_X] = (uint8_t)((pl.x >> 4) + PLAT_W / 2);
        link_port.state[ST_Y] = (uint8_t)((pl.y >> 4) + PLAT_H);
        link_port.state[ST_FACE] = pl.facing_left;
        draw_player();
    }
}
