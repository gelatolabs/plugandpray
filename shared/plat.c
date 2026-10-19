#include "plat.h"
#include "link.h"

#define FP        4
#define WALK      24     /* 1.5 px/frame */
#define JUMP_VEL  (-72)  /* about two and a half tiles */
#define GRAVITY   4
#define MAX_FALL  64

char plat_map[PLAT_ROWS][PLAT_MAXCOL];
uint8_t plat_cols;
plat_player_t pl;
uint16_t plat_exits[4];
uint8_t plat_exit_dir, plat_exit_x, plat_exit_y;
uint8_t plat_pit;

void plat_load(const char *const *rows, uint8_t cols)
{
    uint8_t r, c;
    plat_cols = cols;
    pl.active = 0;
    for (r = 0; r < PLAT_ROWS; r++) {
        for (c = 0; c < cols; c++) {
            char t = rows[r][c];
            if (t == 'S') {
                pl.active = 1;
                pl.x = (int16_t)(c * PLAT_TILE + (PLAT_TILE - PLAT_W) / 2) << FP;
                pl.y = (int16_t)(r * PLAT_TILE + PLAT_TILE - PLAT_H) << FP;
                pl.vy = 0;
                pl.on_ground = 1;
                pl.facing_left = c * 2 >= cols;   /* (facing the open side) */
                pl.auto_walk = 0;
                t = '.';
            }
            plat_map[r][c] = t;
        }
    }
}

void plat_publish_map(volatile uint8_t *dst)
{
    uint8_t r, c;
    for (r = 0; r < PLAT_ROWS; r++) {
        uint16_t m = 0;
        for (c = 0; c < plat_cols; c++)
            if (plat_map[r][c] == '#') m |= (uint16_t)1 << c;
        dst[r * 2] = m & 0xFF;
        dst[r * 2 + 1] = m >> 8;
    }
}

/* Tile at pixel coordinates. Above the screen is open air; the other edges
 * are walls except where plat_exits opens them (or, with plat_pit, below the
 * screen is a bottomless pit). */
static char tile_at(int16_t px, int16_t py)
{
    int16_t c, r;
    if (py < 0) return '.';
    r = py >> 4;
    if (r >= PLAT_ROWS) {
        if (px < 0) return '#';
        c = px >> 4;
        return plat_pit || (c < plat_cols && ((plat_exits[PLAT_E_BOTTOM] >> c) & 1)) ? '.' : '#';
    }
    if (px < 0) return (plat_exits[PLAT_E_LEFT] >> r) & 1 ? '.' : '#';
    c = px >> 4;
    if (c >= plat_cols) return (plat_exits[PLAT_E_RIGHT] >> r) & 1 ? '.' : '#';
    return plat_map[r][c];
}

static uint8_t solid_at(int16_t px, int16_t py) { return tile_at(px, py) == '#'; }

/* Is any part of the box at pixel position (bx, by) inside a solid tile? */
static uint8_t box_solid(int16_t bx, int16_t by)
{
    return solid_at(bx, by) || solid_at(bx + PLAT_W - 1, by)
        || solid_at(bx, by + PLAT_H - 1) || solid_at(bx + PLAT_W - 1, by + PLAT_H - 1)
        || solid_at(bx, by + 7) || solid_at(bx + PLAT_W - 1, by + 7);
}

static uint8_t box_touches(int16_t bx, int16_t by, char t)
{
    /* slightly shrunk so grazing a tile corner doesn't count */
    return tile_at(bx + 2, by + 3) == t || tile_at(bx + PLAT_W - 3, by + 3) == t
        || tile_at(bx + 2, by + PLAT_H - 2) == t || tile_at(bx + PLAT_W - 3, by + PLAT_H - 2) == t;
}

void plat_place(uint8_t cx, uint8_t feet, int8_t vy, uint8_t facing_left, uint8_t auto_walk)
{
    pl.active = 1;
    pl.facing_left = facing_left;
    pl.x = (int16_t)(cx - PLAT_W / 2) << FP;
    pl.y = (int16_t)(feet - PLAT_H) << FP;
    pl.vy = vy;
    pl.on_ground = 0;
    pl.auto_walk = auto_walk;
}

static uint8_t clamp8(int16_t v) { return v < 0 ? 0 : v > 255 ? 255 : (uint8_t)v; }

uint8_t plat_update(uint8_t input)
{
    int16_t bx, by, nx, ny, cx, cy;
    if (!pl.active) return PLAT_EV_NONE;

    if (pl.auto_walk) {
        /* just arrived: keep walking away from where he came in for a moment */
        pl.auto_walk--;
        input = (input & PL_JUMP) | (pl.facing_left ? PL_LEFT : PL_RIGHT);
    }

    /* horizontal */
    pl.moving = 0;
    bx = pl.x >> FP;
    by = pl.y >> FP;
    if (input & PL_LEFT) { pl.facing_left = 1; pl.moving = 1; nx = pl.x - WALK; }
    else if (input & PL_RIGHT) { pl.facing_left = 0; pl.moving = 1; nx = pl.x + WALK; }
    else nx = pl.x;
    if (nx != pl.x) {
        if (!box_solid(nx >> FP, by)) {
            pl.x = nx;
        } else if (nx < pl.x) {
            /* snap against the wall on the left */
            pl.x = ((((bx) >> 4) << 4) << FP);
            while (box_solid(pl.x >> FP, by)) pl.x += 1 << FP;
        } else {
            pl.x = ((((bx + PLAT_W - 1) >> 4) << 4) + PLAT_TILE - PLAT_W) << FP;
            while (box_solid(pl.x >> FP, by)) pl.x -= 1 << FP;
        }
    }
    bx = pl.x >> FP;

    /* vertical */
    if ((input & PL_JUMP) && pl.on_ground) { pl.vy = JUMP_VEL; pl.on_ground = 0; }
    pl.vy += GRAVITY;
    if (pl.vy > MAX_FALL) pl.vy = MAX_FALL;
    ny = pl.y + pl.vy;
    if (!box_solid(bx, ny >> FP)) {
        pl.y = ny;
        pl.on_ground = 0;
    } else if (pl.vy > 0) {
        /* land on top of the tile below */
        pl.y = ((((((ny >> FP) + PLAT_H - 1) >> 4) << 4) - PLAT_H) << FP);
        while (box_solid(bx, pl.y >> FP)) pl.y -= 1 << FP;
        pl.vy = 0;
        pl.on_ground = 1;
    } else {
        /* bump head */
        pl.y = (((((ny >> FP) >> 4) + 1) << 4) << FP);
        while (box_solid(bx, pl.y >> FP)) pl.y += 1 << FP;
        pl.vy = 0;
    }
    by = pl.y >> FP;
    /* standing on something? (a fall step may not cross a whole pixel) */
    if (pl.vy >= 0 && box_solid(bx, by + 1)) {
        pl.on_ground = 1;
        pl.vy = 0;
        pl.y = by << FP;
    }
    pl.anim = pl.moving && pl.on_ground ? pl.anim + 1 : 0;

    /* left the screen through an open edge? */
    cx = bx + PLAT_W / 2;
    cy = by + PLAT_H / 2;
    plat_exit_dir = 0;
    if (cx < 0) plat_exit_dir = DIR_LEFT;
    else if (cx >= plat_cols * PLAT_TILE) plat_exit_dir = DIR_RIGHT;
    else if (cy >= PLAT_ROWS * PLAT_TILE) {
        /* fell into the pit, unless the GelatoBoy is there to catch him */
        if (plat_pit && !((plat_exits[PLAT_E_BOTTOM] >> (cx >> 4)) & 1)) return PLAT_EV_DIED;
        plat_exit_dir = DIR_DOWN;
    }
    else if (cy < 0 && ((plat_exits[PLAT_E_TOP] >> (cx >> 4)) & 1)) plat_exit_dir = DIR_UP;
    if (plat_exit_dir) {
        plat_exit_x = clamp8(cx);
        plat_exit_y = clamp8(cy);
        pl.active = 0;
        return PLAT_EV_EXIT;
    }
    if (box_touches(bx, by, 'G')) return PLAT_EV_GOAL;
    /* spikes only fill the bottom half of their tile: check the feet */
    if (((by + PLAT_H - 1) & 15) >= 8
        && (tile_at(bx + 2, by + PLAT_H - 1) == '^' || tile_at(bx + PLAT_W - 3, by + PLAT_H - 1) == '^'))
        return PLAT_EV_DIED;
    return PLAT_EV_NONE;
}
