/*
 * Game 3 "License to Chill", GelatoBoy half: brain-freeze ghosts flutter
 * across the skyline. The host turns zapper shots into MSG_SHOT messages.
 */
#include <gb/gb.h>
#include <stdint.h>
#include "assets.h"
#include "../sfx.h"
#include "../music/music.h"
#include "../../shared/link.h"
#include "../../shared/zap.h"
#include "../../shared/game3.h"

static const zap_cfg_t cfg = { 160, 144, 28, 16, 12 };   /* (a shot hits within 28 pixels of an enemy's middle, the strong one 42: over 3x the 16 px sprite each way; the screen's small) */

static uint8_t flash, msg_timer, phase, loaded, hint = 255;
static uint8_t last_lives = 255;
static uint16_t last_score = 0xFFFF;

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

static void message(const char *s)
{
    uint8_t n = 0;
    fill_bkg_rect(0, 7, 20, 1, BG_BLANK);
    while (s[n]) n++;
    if (n) draw_text((20 - n) / 2, 7, s);
}

/* The title, over the skyline: the name (draw_hint adds where the gun is; the
 * START button to shoot is on the TV). */
static void draw_title(void)
{
    fill_bkg_rect(0, 0, 20, 11, BG_BLANK);   /* (the tallest roofs are on row 11) */
    draw_text(2, 4, "LICENSE TO CHILL");
}

static void draw_hint(uint8_t show)
{
    fill_bkg_rect(0, 9, 20, 2, BG_BLANK);
    if (!show) return;
    draw_text(4, 9, "PICK UP THE");
    draw_text(3, 10, "GELATOBLASTER");
}

static void draw_number(uint8_t x, uint8_t y, uint16_t v, uint8_t digits)
{
    while (digits--) {
        set_bkg_tile_xy(x + digits, y, BG_FONT + 27 + (uint8_t)(v % 10));
        v /= 10;
    }
}

static void build_city(void)
{
    uint8_t x, y, h;
    static const uint8_t heights[20] = { 3, 3, 5, 5, 5, 2, 4, 4, 6, 6, 3, 3, 3, 5, 5, 2, 2, 4, 4, 4 };
    fill_bkg_rect(0, 0, 32, 32, BG_BLANK);
    for (x = 0; x < 20; x++) {
        h = heights[x];
        set_bkg_tile_xy(x, 18 - h - 1, BG_ROOF);
        for (y = 18 - h; y < 18; y++) set_bkg_tile_xy(x, y, (x + y) & 1 ? BG_WALL : BG_WALL2);
    }
    for (x = 0; x < 20; x += 3) set_bkg_tile_xy(x, 3 + (x * 7) % 5, (x & 1) ? BG_STAR : BG_STAR2);
    last_lives = 255;
    last_score = 0xFFFF;
}

static void draw_hud(void)
{
    uint8_t lives = link_port.ctrl[C3_LIVES], i;
    uint16_t score = link_port.ctrl[C3_SCORE] | ((uint16_t)link_port.ctrl[C3_SCORE + 1] << 8);
    if (score != last_score) {
        draw_number(0, 0, score, 4);
        set_bkg_tile_xy(4, 0, BG_FONT + 27);   /* scores are multiples of 10 */
        last_score = score;
    }
    if (lives != last_lives) {
        for (i = 0; i < 5; i++) set_bkg_tile_xy(19 - i, 0, i < lives ? BG_HEART : BG_BLANK);
        last_lives = lives;
    }
}

static void draw_enemies(uint8_t t)
{
    uint8_t i;
    for (i = 0; i < MAX_ENEMIES; i++) {
        enemy_t *e = &enemies[i];
        uint8_t s = i * 2, tile, x, y;
        if (e->state == ES_NONE || flash) { move_sprite(s, 0, 0); move_sprite(s + 1, 0, 0); continue; }
        if (e->state == ES_DIE) tile = SPR_POP;
        else if (e->type == EN_ZIPPY) tile = (t >> 2) & 1 ? SPR_ZIPPY1 : SPR_ZIPPY2;
        else if (e->type == EN_BIG) tile = SPR_BIG;
        else tile = (t >> 3) & 1 ? SPR_GHOST1 : SPR_GHOST2;
        x = (uint8_t)((e->x >> 4) - 8 + 8);
        y = (uint8_t)((e->y >> 4) - 8 + 16);
        set_sprite_tile(s, tile);
        set_sprite_tile(s + 1, tile + 2);
        set_sprite_prop(s, e->type == EN_BIG ? S_PALETTE : 0);
        set_sprite_prop(s + 1, e->type == EN_BIG ? S_PALETTE : 0);
        move_sprite(s, x, y);
        move_sprite(s + 1, x + 8, y);
    }
}

static void handle_messages(void)
{
    uint8_t msg[LINK_MSG_LEN], res;
    while (link_recv(msg)) {
        switch (msg[0]) {
        case MSG_LOAD:
            zap_clear();
            if (phase == PH_TITLE || !loaded) build_city();   /* the title's gone */
            loaded = 1;
            phase = PH_PLAY;
            message(msg[1] == 0 ? "WAVE 1/5" : msg[1] == 1 ? "WAVE 2/5" : msg[1] == 2 ? "WAVE 3/5" : msg[1] == 3 ? "WAVE 4/5" : "FINAL WAVE");
            msg_timer = 90;
            break;
        case MSG_SPAWN:
            zap_spawn(msg[1], msg[2], msg[3]);
            break;
        case MSG_ENTER:
            zap_enter(msg[1], msg[2], msg[3], msg[4]);
            break;
        case MSG_SHOT:
            flash = 2;
            if (phase == PH_TITLE) break;   /* (nothing to shoot here: START is on the TV) */
            res = zap_shoot(msg[1] | (msg[2] << 8), msg[3]);
            link_send(MSG_RESULT, res ? 1 : 0, res, 0, 0, 0);
            if (res & ZAP_KILLED) { sfx_noise(0xD3, 0x35); sfx_sweep(0x15, 0x92, 1850); }
            else if (res) sfx_beep(40, 0x82, 1700);
            break;
        case MSG_PHASE:
            phase = msg[1];
            if (phase == PH_TITLE) { zap_clear(); loaded = 1; msg_timer = 0; build_city(); draw_title(); hint = 255; }
            if (phase == PH_CLEAR) { message("WAVE CLEAR!"); msg_timer = 90; sfx_sweep(0x15, 0xC4, 1750); }
            if (phase == PH_OVER) { zap_clear(); message("GAME OVER - PRESS A"); msg_timer = 0; }
            if (phase == PH_WIN) { zap_clear(); message("YOU WIN!"); msg_timer = 0; }
            break;
        }
    }
}

void main(void)
{
    uint8_t t = 0, i, keys = 0, prev;

    link_init(GAME3_ID);
    sfx_init();
    music_init();   /* (the host picks the song and whether it's heard: see web/src/music.js) */
    zap_init(&cfg);
    DISPLAY_OFF;
    BGP_REG = 0xE4;
    OBP0_REG = 0xE4;
    OBP1_REG = 0x9C;
    set_bkg_data(0, BG_TILES_COUNT, bg_tiles);
    set_sprite_data(0, SPR_TILES_COUNT, spr_tiles);
    SPRITES_8x16;
    build_city();
    draw_text(2, 5, "LICENSE TO CHILL");   /* the title, until the disc's in */
    message("CONNECT");
    draw_text(3, 8, "GELATOSTATION");
    SHOW_BKG;
    SHOW_SPRITES;
    DISPLAY_ON;

    while (1) {
        wait_vbl_done();
        music_frame();
        link_port.frame++;
        t++;
        prev = keys;
        keys = joypad();
        handle_messages();
        if (!loaded) continue;
        if (phase == PH_TITLE) {
            uint8_t want = !link_port.ctrl[C3_ZAPPER];
            if (want != hint) draw_hint(hint = want);
            if (flash) { BGP_REG = flash == 2 ? 0xFF : 0xE4; flash--; }
            continue;
        }
        draw_hud();
        if (phase == PH_OVER && (keys & ~prev & J_A)) link_send(MSG_PHASE, PH_OVER, 0, 0, 0, 0);
        if (msg_timer && !--msg_timer) message("");

        zap_update(link_port.ctrl[CTRL_EDGES]);
        for (i = 0; i < zap_event_count; i++) {
            zap_event_t *ev = &zap_events[i];
            if (ev->type == ZEV_EXIT) link_send(MSG_EXIT, ev->a, ev->b, ev->c, ev->d, 0);
            else link_send(MSG_ESCAPE, ev->a, 0, 0, 0, 0);
        }
        zap_publish();

        /* light-gun flash: one black frame like a real zapper's detection pass */
        if (flash) {
            BGP_REG = flash == 2 ? 0xFF : 0xE4;
            flash--;
        }
        draw_enemies(t);
    }
}
