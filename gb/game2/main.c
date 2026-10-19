/*
 * Game 2 "Vanilla Fighter II.5 (...)", GelatoBoy half. On the GB the fighters are
 * sprites, quicker and lighter than the GelatoStation's: A punches, B blocks,
 * A in the air is a flying kick; down, forward + A throws a quick Gelato
 * Blast. Up, forward, down, back + A (either way round) is the backflip,
 * landing in a clap that stuns.
 */
#include <gb/gb.h>
#include <stdint.h>
#include "assets.h"
#include "../sfx.h"
#include "../music/music.h"
#include "../../shared/link.h"
#include "../../shared/fight.h"
#include "../../shared/game2.h"

#define FLOOR_Y 128

static const move_t punch = { 2, 3, 6, 12, 12, 24, 4, 24, 0, 0 };
static const move_t blast = { 6, 1, 16, 0, 0, 0, 0, 0, 0, PROJ_BIT };
static const move_t flying_kick = { 3, 6, 8, 12, 0, 14, 7, 32, 0, 0 };
static const fight_cfg_t cfg = {
    160, 12, 28,
    20, 72, 4,
    { 0, 40, 28 },   /* the GelatoBoy's Gelato Blast is quick, the GelatoStation's slow (and it hits harder) */
    { 0, 5, 10 },
    3,
    { &punch, &blast, &flying_kick },
};

static uint8_t loaded, intro, frozen, match_over;
static uint8_t last_hp1 = 255, last_hp2 = 255, last_wins = 255;

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
    fill_bkg_rect(0, 6, 20, 1, BG_BLANK);
    if (s[0]) {
        uint8_t n = 0;
        while (s[n]) n++;
        draw_text((20 - n) / 2, 6, s);
    }
}

static void draw_bar(uint8_t x, uint8_t hp, uint8_t right_to_left)
{
    uint8_t px = (uint8_t)(((uint16_t)hp * 56) / 100), i;
    for (i = 0; i < 7; i++) {
        uint8_t seg = right_to_left ? 6 - i : i;
        uint8_t fill = px > seg * 8 ? (px - seg * 8 > 8 ? 8 : px - seg * 8) : 0;
        set_bkg_tile_xy(x + i, 0, BG_BAR + fill);
    }
}

static void draw_hud(void)
{
    uint8_t hp1 = link_port.ctrl[C2_HP1], hp2 = link_port.ctrl[C2_HP2];
    uint8_t wins = link_port.ctrl[C2_WINS];
    if (hp1 != last_hp1) { draw_bar(2, hp1, 0); last_hp1 = hp1; }
    if (hp2 != last_hp2) { draw_bar(10, hp2, 1); last_hp2 = hp2; }
    if (wins != last_wins) {
        set_bkg_tile_xy(2, 1, (wins & 15) >= 1 ? BG_FONT + 43 : BG_BLANK);   /* '+' marks a round win */
        set_bkg_tile_xy(3, 1, (wins & 15) >= 2 ? BG_FONT + 43 : BG_BLANK);
        set_bkg_tile_xy(16, 1, (wins >> 4) >= 1 ? BG_FONT + 43 : BG_BLANK);
        set_bkg_tile_xy(15, 1, (wins >> 4) >= 2 ? BG_FONT + 43 : BG_BLANK);
        last_wins = wins;
    }
}

static void build_arena(void)
{
    uint8_t x;
    fill_bkg_rect(0, 0, 32, 32, BG_BLANK);
    for (x = 0; x < 20; x += 2) {
        set_bkg_tile_xy(x, 16, BG_FLOOR);
        set_bkg_tile_xy(x + 1, 16, BG_FLOOR + 1);
        set_bkg_tile_xy(x, 17, BG_FLOOR + 2);
        set_bkg_tile_xy(x + 1, 17, BG_FLOOR + 3);
    }
    for (x = 9; x < 16; x++) {
        set_bkg_tile_xy(3, x, BG_PILLAR);
        set_bkg_tile_xy(4, x, BG_PILLAR + 1);
        set_bkg_tile_xy(15, x, BG_PILLAR);
        set_bkg_tile_xy(16, x, BG_PILLAR + 1);
    }
    draw_text(0, 0, "P1");
    draw_text(17, 0, "CPU");
    last_hp1 = last_hp2 = last_wins = 255;
}

static void hide(uint8_t first, uint8_t n)
{
    uint8_t i;
    for (i = 0; i < n; i++) move_sprite(first + i, 0, 0);
}

static void draw_fighter(uint8_t i)
{
    fighter_t *f = &fighters[i];
    uint8_t base = i * 4, frame, x, y, prop, fx, fy, k;
    const move_t *mv;
    if (!f->present) { hide(base, 4); hide(12 + i * 2, 2); return; }
    fy = 0;
    switch (f->state) {
    case FS_WALK: f->anim++; frame = (f->anim >> 3) & 1 ? SPR_WALK1 : SPR_WALK2; break;
    case FS_JUMP: frame = SPR_JUMP; break;
    case FS_ATTACK:
        /* the pose while it comes out and hits, then straight back */
        mv = cfg.moves[f->move];
        if (f->move == MOVE_BLAST) frame = SPR_THROW;
        else if (f->timer > mv->startup + mv->active + 2) frame = f->y ? SPR_JUMP : SPR_IDLE;
        else if (f->move == MOVE_KICK) frame = SPR_KICK;
        else frame = SPR_PUNCH;
        break;
    case FS_BLOCK: frame = SPR_BLOCK; break;
    case FS_HURT: frame = SPR_HURT; break;
    case FS_KO: frame = SPR_KO; break;
    case FS_WIN: frame = SPR_JUMP; break;
    /* the backflip: upside down for the middle of it */
    case FS_FLIP: frame = SPR_JUMP; fy = f->spin >= 64 && f->spin < 192; break;
    /* stunned: clapping, arms out and in */
    case FS_STUN: frame = (f->timer / 5) & 1 ? SPR_IDLE : SPR_THROW; break;
    default: frame = SPR_IDLE; break;
    }
    x = (uint8_t)(f->x >> 4);                     /* body centre; OAM x has an 8px offset */
    y = (uint8_t)(FLOOR_Y - 32 - (f->y >> 4) + 16);
    prop = i ? S_PALETTE : 0;                     /* CPU uses OBP1 */
    /* facing left is mirrored; upside down is turned round (mirrored both ways) */
    fx = f->facing_left ^ fy;
    if (fx) prop |= S_FLIPX;
    if (fy) prop |= S_FLIPY;
    for (k = 0; k < 4; k++) {
        uint8_t col = (k & 1) ^ fx, row = (k >> 1) ^ fy;
        set_sprite_tile(base + k, frame + row * 4 + col * 2);
        set_sprite_prop(base + k, prop);
        move_sprite(base + k, x + (k & 1) * 8, y + (k >> 1) * 16);
    }
    /* stunned: two stars going round his head */
    if (f->state == FS_STUN) {
        static const int8_t orbit[8] = { 0, 5, 7, 5, 0, -5, -7, -5 };
        uint8_t a = (uint8_t)(link_port.frame >> 2);
        for (k = 0; k < 2; k++) {
            uint8_t ph = (a + k * 4) & 7;
            set_sprite_tile(12 + i * 2 + k, SPR_BIT);
            set_sprite_prop(12 + i * 2 + k, prop & S_PALETTE);
            move_sprite(12 + i * 2 + k, x + 4 + orbit[ph], y - 12 + (orbit[(ph + 2) & 7] >> 2) + 8);
        }
    } else {
        hide(12 + i * 2, 2);
    }
}

static void draw_projectiles(void)
{
    uint8_t i;
    for (i = 0; i < MAX_PROJ; i++) {
        proj_t *p = &projs[i];
        uint8_t s = 8 + i;
        if (!p->active) { move_sprite(s, 0, 0); continue; }
        set_sprite_tile(s, p->type == PROJ_POLY ? SPR_POLY : SPR_BIT);
        set_sprite_prop(s, p->owner == 2 ? S_PALETTE : 0);
        move_sprite(s, (uint8_t)((p->x >> 4) - 4 + 8), (uint8_t)(FLOOR_Y - (p->y >> 4) - 4 + 16));
    }
}

static void handle_messages(void)
{
    uint8_t msg[LINK_MSG_LEN];
    while (link_recv(msg)) {
        switch (msg[0]) {
        case MSG_LOAD:
            if (!loaded) build_arena();   /* (clears the title) */
            fight_reset(msg[2]);
            loaded = 1;
            match_over = 0;
            frozen = 1;
            intro = 90;
            message(msg[1] == 0 ? "ROUND 1/3" : msg[1] == 1 ? "ROUND 2/3" : "FINAL ROUND");
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
            message("K.O.");
            break;
        case MSG_MATCH:
            frozen = 1;
            match_over = 1;
            message(msg[1] == 1 ? "YOU WIN!" : "YOU LOSE - PRESS A");
            break;
        }
    }
}

void main(void)
{
    uint8_t keys = 0, prev, in0, i;

    link_init(GAME2_ID);
    sfx_init();
    music_init();   /* (the host picks the song and whether it's heard: see web/src/music.js) */
    fight_init(&cfg);
    DISPLAY_OFF;
    BGP_REG = 0xE4;
    OBP0_REG = 0xE4;
    /* the CPU (and what it throws): drawn a shade lighter than the player, its
     * black lines dark (3 -> 2, 2 -> 1), so the two fighters stay apart */
    OBP1_REG = 0x94;
    set_bkg_data(0, BG_TILES_COUNT, bg_tiles);
    set_sprite_data(0, SPR_TILES_COUNT, spr_tiles);
    SPRITES_8x16;
    build_arena();
    draw_text(0, 4, "VANILLA FIGHTER II.5");   /* the title, until the disc's in */
    message("CONNECT");
    draw_text(3, 7, "GELATOSTATION");
    SHOW_BKG;
    SHOW_SPRITES;
    DISPLAY_ON;

    while (1) {
        wait_vbl_done();
        music_frame();
        link_port.frame++;
        prev = keys;
        keys = joypad();
        handle_messages();
        if (!loaded) continue;
        draw_hud();

        if (intro) {
            intro--;
            if (intro == 30) { message("FIGHT!"); frozen = 0; }
            if (intro == 0) message("");
        }
        in0 = 0;
        if (keys & J_LEFT) in0 |= IN_LEFT;
        if (keys & J_RIGHT) in0 |= IN_RIGHT;
        if (keys & J_UP) in0 |= IN_UP;
        if (keys & J_DOWN) in0 |= IN_DOWN;
        if ((keys & ~prev) & J_A) in0 |= IN_A;
        if (keys & J_B) in0 |= IN_B;   /* (held: B blocks for as long as it's down) */
        in0 = fight_combo(in0);
        if (match_over && ((keys & ~prev) & J_A)) link_send(MSG_REMATCH, 0, 0, 0, 0, 0);

        fight_read_link();
        fight_update(in0, link_port.ctrl[C2_CPU_IN], frozen);
        for (i = 0; i < fight_event_count; i++) {
            fight_event_t *ev = &fight_events[i];
            link_send7(ev->type == EV_EXIT ? MSG_EXIT : ev->type == EV_STUN ? MSG_STUN : MSG_HIT, ev->a, ev->b, ev->c, ev->d, ev->e, ev->f, ev->g);
            if (ev->type == EV_HIT) {
                if (ev->d) sfx_noise(0x51, 0x24);      /* blocked */
                else sfx_noise(0xC2, 0x46);            /* hit */
            }
        }
        /* attacks, jumps and throws, as they start */
        for (i = 0; i < 2; i++) {
            static uint8_t was[2];
            fighter_t *f = &fighters[i];
            if (f->present && f->state != was[i]) {
                if (f->state == FS_JUMP) sfx_sweep(0x16, 0x61, 1500);
                if (f->state == FS_ATTACK) {
                    if (f->move == MOVE_BLAST) sfx_sweep(0x2E, 0xA3, 1900);   /* Gelato Blast: a falling zap */
                    else sfx_noise(0x61, 0x13 + f->move);                     /* whoosh */
                }
                if (f->state == FS_KO) sfx_sweep(0x7F, 0xF7, 1800);
                if (f->state == FS_FLIP) sfx_sweep(0x17, 0x81, 1500);     /* whee */
                if (f->state == FS_STUN) sfx_sweep(0x7A, 0xC4, 1900);     /* seeing stars */
            }
            if (f->present && f->state == FS_STUN && f->timer % 10 == 0) sfx_noise(0x81, 0x10);   /* clap */
            was[i] = f->present ? f->state : 255;
        }

        link_port.state[S2_PRESENT] = fighters[0].present | (fighters[1].present << 1);
        link_port.state[S2_P1X] = (uint8_t)((fighters[0].x >> 4) * 8 / 5);   /* 160 -> 256 */
        link_port.state[S2_P1Y] = (uint8_t)(((fighters[0].y >> 4) * 64) / 28);
        link_port.state[S2_P2X] = (uint8_t)((fighters[1].x >> 4) * 8 / 5);
        link_port.state[S2_P2Y] = (uint8_t)(((fighters[1].y >> 4) * 64) / 28);
        link_port.state[S2_P1ST] = fighters[0].state;
        link_port.state[S2_P2ST] = fighters[1].state;
        link_port.state[S2_FACE] = fighters[0].facing_left | (fighters[1].facing_left << 1);
        in0 = 0;
        for (i = 0; i < MAX_PROJ; i++) if (projs[i].active) in0 |= projs[i].owner;
        link_port.state[S2_PROJ] = in0;
        link_port.state[S2_THREAT] = fight_threat();

        draw_fighter(0);
        draw_fighter(1);
        draw_projectiles();
    }
}
