#include "zap.h"
#include "game3.h"
#include "link.h"

#define FP 4
#define FPS 60
#define SHOT_LAG 10   /* frames between the picture a shot's aimed at and the shot landing (about) */

enemy_t enemies[MAX_ENEMIES];
zap_event_t zap_events[8];
uint8_t zap_event_count;

static const zap_cfg_t *cfg;
/* 65536 / the screen's width and height: positions as fractions of 256 with
 * a 16-bit multiply (32-bit division is slow on the GelatoBoy) */
static uint16_t scale_x, scale_y;

static const int8_t sine[32] = {
    0, 12, 24, 35, 45, 53, 59, 63, 64, 63, 59, 53, 45, 35, 24, 12,
    0, -12, -24, -35, -45, -53, -59, -63, -64, -63, -59, -53, -45, -35, -24, -12,
};

int8_t zap_sin(uint8_t phase) { return sine[(phase >> 3) & 31]; }

static void event(uint8_t type, uint8_t a, uint8_t b, uint8_t c, uint8_t d)
{
    zap_event_t *ev;
    if (zap_event_count >= 8) return;
    ev = &zap_events[zap_event_count++];
    ev->type = type; ev->a = a; ev->b = b; ev->c = c; ev->d = d;
}

void zap_init(const zap_cfg_t *c)
{
    cfg = c;
    scale_x = (uint16_t)65535u / (uint16_t)c->width;
    scale_y = (uint16_t)65535u / (uint16_t)c->height;
}

void zap_clear(void)
{
    uint8_t i;
    for (i = 0; i < MAX_ENEMIES; i++) enemies[i].state = ES_NONE;
}

static enemy_t *slot(void)
{
    uint8_t i;
    for (i = 0; i < MAX_ENEMIES; i++)
        if (enemies[i].state == ES_NONE) return &enemies[i];
    return 0;
}

static void setup(enemy_t *e, uint8_t type, int16_t x, int16_t y, uint8_t left, uint16_t life)
{
    int16_t s = cfg->speed;
    e->state = ES_FLY;
    e->type = type;
    e->hp = type == EN_BIG ? 2 : 1;
    if (type == EN_ZIPPY) s = s * 3 / 2;
    if (type == EN_BIG) s = s * 2 / 3;
    e->vx = left ? -s : s;
    e->vy = 0;
    e->x = x << FP;
    e->base_y = y << FP;
    e->y = e->base_y;
    e->phase = (uint8_t)(x * 7 + y);
    e->life = life;
    e->timer = 0;
}

/* Keeps enemies inside the play area (below the HUD, above the bottom). */
static int16_t clamp_y(int16_t y)
{
    int16_t top = 20 + cfg->amp, bottom = cfg->height - 24 - cfg->amp;
    return y < top ? top : y > bottom ? bottom : y;
}

void zap_spawn(uint8_t side, uint8_t frac, uint8_t type)
{
    enemy_t *e = slot();
    int16_t y;
    if (!e) return;
    y = clamp_y((int16_t)(((int32_t)frac * cfg->height) >> 8));
    if (side == 1) setup(e, type, 0, y, 0, 9 * FPS);
    else if (side == 2) setup(e, type, cfg->width - 1, y, 1, 9 * FPS);
    else {
        /* from the top: drop in at x = frac, then fly sideways */
        setup(e, type, (int16_t)(((int32_t)frac * cfg->width) >> 8), clamp_y(cfg->height / 3), frac & 1, 9 * FPS);
        e->y = -(16 << FP);
        e->vy = 2 << FP;
    }
}

void zap_enter(uint8_t dir, uint8_t yfrac, uint8_t type, uint8_t life_secs)
{
    enemy_t *e = slot();
    if (!e) return;
    setup(e, type, dir == DIR_LEFT ? 0 : cfg->width - 1,
          clamp_y((int16_t)(((int32_t)yfrac * cfg->height) >> 8)), dir == DIR_RIGHT, (uint16_t)life_secs * FPS + 30);
}

uint8_t zap_count(void)
{
    uint8_t i, n = 0;
    for (i = 0; i < MAX_ENEMIES; i++) if (enemies[i].state != ES_NONE) n++;
    return n;
}

void zap_update(uint8_t edges)
{
    uint8_t i;
    zap_event_count = 0;
    for (i = 0; i < MAX_ENEMIES; i++) {
        enemy_t *e = &enemies[i];
        int16_t px, py;
        switch (e->state) {
        case ES_FLY:
            e->phase += e->type == EN_ZIPPY ? 12 : 5;
            e->x += e->vx;
            if (e->vy) {
                /* dropping in from the top */
                e->y += e->vy;
                if (e->y >= e->base_y) { e->y = e->base_y; e->vy = 0; }
            } else {
                e->y = e->base_y + (int16_t)zap_sin(e->phase) * cfg->amp / 4;
            }
            if (e->life) e->life--;
            if (!e->life) { e->state = ES_FLEE; e->vy = -(2 << FP); }
            px = e->x >> FP;
            if (px < 0 || px >= cfg->width) {
                uint8_t left = px < 0;
                if (edges & (left ? 1 : 2)) {
                    uint8_t yfrac = (uint8_t)(((int32_t)(e->y >> FP) << 8) / cfg->height);
                    event(ZEV_EXIT, left ? DIR_LEFT : DIR_RIGHT, yfrac, e->type, (uint8_t)(e->life / FPS));
                    e->state = ES_NONE;
                } else {
                    e->vx = -e->vx;
                    e->x += e->vx;
                }
            }
            break;
        case ES_FLEE:
            e->x += e->vx / 2;
            e->y += e->vy;
            if ((e->y >> FP) < -16 || (e->x >> FP) < -16 || (e->x >> FP) > cfg->width + 16) {
                event(ZEV_ESCAPE, e->type, 0, 0, 0);
                e->state = ES_NONE;
            }
            break;
        case ES_DIE:
            e->timer++;
            e->y += (int16_t)e->timer * 3;
            py = e->y >> FP;
            if (py > cfg->height + 16) e->state = ES_NONE;
            break;
        default:
            break;
        }
    }
}

uint8_t zap_shoot(int16_t x, int16_t y)
{
    uint8_t i;
    int16_t r = cfg->radius;
    for (i = 0; i < MAX_ENEMIES; i++) {
        enemy_t *e = &enemies[i];
        int16_t dx, dy, lag;
        if (e->state != ES_FLY && e->state != ES_FLEE) continue;
        dx = (e->x >> FP) - x;
        dy = (e->y >> FP) - y;
        if (e->type == EN_BIG) r = cfg->radius * 3 / 2; else r = cfg->radius;
        /* the box reaches back along its path to where it was SHOT_LAG frames
           ago: the picture the shot was aimed at is that old by the time it lands */
        lag = (e->state == ES_FLEE ? e->vx / 2 : e->vx) * SHOT_LAG >> FP;
        if (dy > -r && dy < r && ((lag >= 0 && dx > -r && dx - lag < r) || (lag < 0 && dx < r && dx - lag > -r))) {
            if (--e->hp == 0) { e->state = ES_DIE; e->timer = 0; return e->type | ZAP_KILLED; }
            return e->type;
        }
    }
    return 0;
}

void zap_publish(void)
{
    uint8_t i, alive = 0;
    for (i = 0; i < MAX_ENEMIES; i++) {
        enemy_t *e = &enemies[i];
        int16_t x = e->x >> FP, y = e->y >> FP;
        if (e->state == ES_FLY || e->state == ES_FLEE) alive |= 1 << i;
        link_port.state[S3_ENEMIES + i * 2] = x < 0 ? 0 : x >= cfg->width ? 255 : (uint8_t)(((uint16_t)x * scale_x) >> 8);
        link_port.state[S3_ENEMIES + i * 2 + 1] = y < 0 ? 0 : y >= cfg->height ? 255 : (uint8_t)(((uint16_t)y * scale_y) >> 8);
    }
    link_port.state[S3_ALIVE] = alive;
    link_port.state[S3_COUNT] = zap_count();
}
