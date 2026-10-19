#include "fight.h"
#include "game2.h"
#include "link.h"

#define FP 4
#define FLIP_SPIN   9     /* how far round the backflip turns a frame (of 256): all the way in about a hop */
#define STUN_FRAMES 110
#define STUN_GUARD  150   /* after a stun wears off, this long before a backflip can stun him again */

fighter_t fighters[2];
proj_t projs[MAX_PROJ];
fight_event_t fight_events[8];
uint8_t fight_event_count;
fight_link_t fight_link;

static const fight_cfg_t *cfg;
/* each fighter's position last frame (x 0-255, centre height), for noticing
 * when he moves into the GelatoBoy's box */
static uint8_t last_x[2], last_h[2], last_ok[2];

static void event(uint8_t type, uint8_t a, uint8_t b, uint8_t c, uint8_t d, uint8_t e, uint8_t f, uint8_t g)
{
    fight_event_t *ev;
    if (fight_event_count >= 8) return;
    ev = &fight_events[fight_event_count++];
    ev->type = type; ev->a = a; ev->b = b; ev->c = c; ev->d = d; ev->e = e; ev->f = f; ev->g = g;
}

void fight_read_link(void)
{
    fight_link.open = link_port.ctrl[CTRL_EDGES];
    fight_link.lo[0] = link_port.ctrl[C2_BAND];
    fight_link.hi[0] = link_port.ctrl[C2_BAND + 1];
    fight_link.lo[1] = link_port.ctrl[C2_BAND + 2];
    fight_link.hi[1] = link_port.ctrl[C2_BAND + 3];
    fight_link.px0 = link_port.ctrl[C2_PORTAL];
    fight_link.px1 = link_port.ctrl[C2_PORTAL + 1];
    fight_link.ph0 = link_port.ctrl[C2_PORTAL + 2];
    fight_link.ph1 = link_port.ctrl[C2_PORTAL + 3];
}

static uint8_t edge_open(uint8_t side, uint8_t h)
{
    return ((fight_link.open >> side) & 1) && h >= fight_link.lo[side] && h <= fight_link.hi[side];
}

static uint8_t in_portal(uint8_t x, uint8_t h)
{
    return fight_link.px1 > fight_link.px0 && x >= fight_link.px0 && x <= fight_link.px1
        && h >= fight_link.ph0 && h <= fight_link.ph1;
}

static uint8_t to_x256(int16_t x)
{
    int16_t v = (int16_t)(((int32_t)(x >> 4) * 256) / cfg->width);
    return v < 0 ? 0 : v > 255 ? 255 : (uint8_t)v;
}

void fight_init(const fight_cfg_t *c)
{
    cfg = c;
}

void fight_reset(uint8_t present_mask)
{
    uint8_t i;
    for (i = 0; i < 2; i++) {
        fighter_t *f = &fighters[i];
        f->present = (present_mask >> i) & 1;
        /* player starts on the left third, cpu on the right third */
        f->x = (i == 0 ? cfg->width / 3 : cfg->width - cfg->width / 3) << FP;
        f->y = 0;
        f->vx = f->vy = 0;
        f->facing_left = i;
        f->state = FS_IDLE;
        f->timer = 0;
        f->auto_walk = 0;
        f->air_used = 0;
        f->spin = 0;
        f->guard = 0;
        last_ok[i] = 0;
    }
    for (i = 0; i < MAX_PROJ; i++) projs[i].active = 0;
}

static uint8_t to_h64(int16_t y)
{
    int16_t h = (int16_t)(((int32_t)(y >> FP) * 64) / cfg->body_h);
    return h < 0 ? 0 : h > 255 ? 255 : (uint8_t)h;
}

static int16_t from_h64(uint8_t h)
{
    return (int16_t)(((int32_t)h * cfg->body_h / 64) << FP);
}

static void spawn_proj(uint8_t type, uint8_t owner, int16_t x, int16_t y, uint8_t left)
{
    uint8_t i;
    for (i = 0; i < MAX_PROJ; i++) {
        proj_t *p = &projs[i];
        if (p->active) continue;
        p->active = 1;
        p->type = type;
        p->owner = owner;
        p->x = x;
        p->y = y;
        p->vx = left ? -cfg->proj_speed[type] : cfg->proj_speed[type];
        return;
    }
}

void fight_enter(uint8_t dir, uint8_t h, uint8_t kind, uint8_t who, uint8_t owner, uint8_t x, int8_t vy)
{
    int16_t px = (int16_t)((((int32_t)x * cfg->width) >> 8) << FP);
    if (x == 255) px = cfg->width << FP;
    if (kind == KIND_PROJ) {
        if (who > 2) return;
        spawn_proj(who, owner, px, from_h64(h), vy & 1);
    } else if (who == 1 || who == 2) {
        fighter_t *f = &fighters[who - 1];
        f->present = 1;
        f->x = px;
        f->y = from_h64(h > 32 ? h - 32 : 0);
        f->vx = 0;
        f->vy = (int16_t)(((int32_t)vy * cfg->jump_vel) / 100);
        f->state = f->y > 0 || f->vy > 0 ? FS_JUMP : FS_IDLE;
        f->timer = 0;
        f->auto_walk = 0;
        f->air_used = 0;
        f->spin = 0;
        last_ok[who - 1] = 0;
        if (dir == DIR_LEFT || dir == DIR_RIGHT) {
            f->facing_left = (dir == DIR_RIGHT);
            f->auto_walk = 12;
        }
    }
}

/* The player's last few direction presses (IN_* bits, newest first) and how
 * many frames ago they were. */
#define HIST 4
static uint8_t combo_dir[HIST], combo_age[HIST] = { 255, 255, 255, 255 }, combo_held;

/* The newest n presses came one after another (and the last just now). */
static uint8_t in_time(uint8_t n)
{
    uint8_t i;
    if (combo_age[0] > COMBO_GAP) return 0;
    for (i = 1; i < n; i++) if (combo_age[i] - combo_age[i - 1] > COMBO_GAP) return 0;
    return 1;
}

uint8_t fight_combo(uint8_t in)
{
    uint8_t dirs = in & (IN_LEFT | IN_RIGHT | IN_UP | IN_DOWN), fresh = dirs & ~combo_held, b, i, fwd, back;
    combo_held = dirs;
    for (i = 0; i < HIST; i++) if (combo_age[i] < 255) combo_age[i]++;
    /* down (and up) before left/right when they land on the same frame */
    for (b = IN_DOWN; b; b >>= 1) {
        if (!(fresh & b)) continue;
        for (i = HIST - 1; i; i--) { combo_dir[i] = combo_dir[i - 1]; combo_age[i] = combo_age[i - 1]; }
        combo_dir[0] = b;
        combo_age[0] = 0;
    }
    if (!(in & (IN_A | IN_B))) return in;
    fwd = combo_dir[0];
    if (fwd != IN_LEFT && fwd != IN_RIGHT) return in;
    back = fwd ^ (IN_LEFT | IN_RIGHT);
    /* up, one way, down, the other way + A: the backflip (whichever way round) */
    if ((in & IN_A) && in_time(4) && combo_dir[1] == IN_DOWN && combo_dir[2] == back && combo_dir[3] == IN_UP) {
        in = (in & ~(IN_A | IN_LEFT | IN_RIGHT | IN_UP | IN_DOWN)) | IN_FLIP;
        for (i = 0; i < HIST; i++) combo_dir[i] = 0;
        return in;
    }
    if (!in_time(2)) return in;
    /* down, forward + A: the Gelato Blast (B is block: no combos on it) */
    if ((in & IN_A) && combo_dir[1] == IN_DOWN) in = (in & ~(IN_A | IN_DOWN)) | IN_C;
    else return in;
    for (i = 0; i < HIST; i++) combo_dir[i] = 0;
    fighters[0].facing_left = fwd == IN_LEFT;
    return in;
}

void fight_set_state(uint8_t who, uint8_t state)
{
    fighter_t *f = &fighters[who - 1];
    f->state = state;
    f->vx = 0;
    f->timer = 0;
}

static uint8_t overlap(int16_t a0, int16_t a1, int16_t b0, int16_t b1)
{
    return a0 < b1 && b0 < a1;
}

uint8_t fight_threat(void)
{
    fighter_t *f = &fighters[1];
    uint8_t i, best = 255;
    int16_t s = cfg->proj_size, fx = f->x >> FP, fy = f->y >> FP;
    if (!f->present) return 255;
    for (i = 0; i < MAX_PROJ; i++) {
        proj_t *p = &projs[i];
        int16_t px = p->x >> FP, py = p->y >> FP, dx = fx - px;
        uint8_t d;
        if (!p->active || p->owner == 2) continue;
        if ((dx > 0) != (p->vx > 0) || !overlap(py - s, py + s, fy, fy + cfg->body_h)) continue;
        d = to_x256((dx < 0 ? -dx : dx) << FP);
        if (d < best) best = d;
    }
    return best;
}

/* Damages fighter v; returns 1 if it was blocked. */
static uint8_t hurt(uint8_t vi, uint8_t damage, int16_t knock, int16_t launch, uint8_t from_left, uint8_t attacker)
{
    fighter_t *v = &fighters[vi];
    uint8_t blocked = v->state == FS_BLOCK && v->facing_left == from_left;
    if (v->state == FS_KO || v->state == FS_WIN) return 0;
    if (v->state == FS_STUN) {
        /* still seeing stars: knocked about, but each hit brings him round a bit sooner */
        v->vx = from_left ? knock : -knock;
        v->timer = v->timer > 25 ? v->timer - 25 : 1;
    } else if (blocked) {
        damage = damage >= 4 ? damage / 4 : 1;
        v->vx = from_left ? knock / 2 : -knock / 2;
    } else {
        v->state = FS_HURT;
        v->timer = 18;
        v->vx = from_left ? knock : -knock;
        if (launch) v->vy = launch;
    }
    event(EV_HIT, vi + 1, damage, attacker, blocked, 0, 0, 0);
    return blocked;
}

static void exit_fighter(uint8_t i, uint8_t dir, uint8_t h)
{
    fighter_t *f = &fighters[i];
    int16_t vyn = (int16_t)(((int32_t)f->vy * 100) / cfg->jump_vel);
    if (vyn > 127) vyn = 127;
    if (vyn < -127) vyn = -127;
    event(EV_EXIT, dir, h, KIND_FIGHTER, i + 1, 0, to_x256(f->x), (uint8_t)(int8_t)vyn);
    f->present = 0;
}

/* Up and backwards into a backflip (the clap comes when he lands). */
static void start_flip(fighter_t *f)
{
    f->state = FS_FLIP;
    f->vy = cfg->jump_vel * 3 / 4;
    f->vx = f->facing_left ? cfg->walk / 2 : -cfg->walk / 2;
    f->spin = 1;
    f->timer = 0;
    f->air_used = 1;
}

/* Stuns a fighter (unless he's just got over a stun, or the round's over for
 * him): he claps, and can't do anything. In the air, he falls as he claps. */
static void stun(fighter_t *o)
{
    if (o->guard || o->state == FS_KO || o->state == FS_WIN || o->state == FS_STUN) return;
    o->state = FS_STUN;
    o->timer = STUN_FRAMES;
    o->vx = 0;
    o->spin = 0;
}

/* Landing a backflip stuns the other fighter, wherever he is: on this screen
 * straight away, on the other one by way of the host (MSG_STUN). */
static void stun_other(uint8_t i)
{
    fighter_t *o = &fighters[1 - i];
    if (o->present) stun(o);
    else event(EV_STUN, 2 - i, 0, 0, 0, 0, 0, 0);
}

void fight_stun(uint8_t who)
{
    if (who >= 1 && who <= 2 && fighters[who - 1].present) stun(&fighters[who - 1]);
}

static void update_fighter(uint8_t i, uint8_t in)
{
    fighter_t *f = &fighters[i];
    fighter_t *o = &fighters[1 - i];
    int16_t half = cfg->body_w / 2;
    uint8_t airborne = f->y > 0 || f->vy > 0;
    uint8_t open_l, open_r, h, x8;
    const move_t *mv;

    if (f->auto_walk) {
        f->auto_walk--;
        in = f->facing_left ? IN_LEFT : IN_RIGHT;
    }
    if (f->guard && f->state != FS_STUN) f->guard--;

    /* face the opponent when both are on this screen */
    if (o->present && (f->state == FS_IDLE || f->state == FS_WALK || f->state == FS_BLOCK) && !f->auto_walk)
        f->facing_left = o->x < f->x;

    switch (f->state) {
    case FS_IDLE:
    case FS_WALK:
    case FS_BLOCK:
        f->vx = 0;
        if ((in & IN_FLIP) == IN_FLIP) { start_flip(f); break; }
        /* B (or down) blocks; A punches; the Gelato Blast and the backflip are A combos */
        if (in & (IN_B | IN_DOWN)) { f->state = FS_BLOCK; break; }
        f->state = FS_IDLE;
        mv = 0;
        if (in & IN_A) { mv = cfg->moves[MOVE_PUNCH]; f->move = MOVE_PUNCH; }
        else if (in & IN_C) { mv = cfg->moves[MOVE_BLAST]; f->move = MOVE_BLAST; }
        if (mv) { f->state = FS_ATTACK; f->timer = 0; f->hit_done = 0; break; }
        if ((in & IN_UP) && !airborne) { f->vy = cfg->jump_vel; f->state = FS_JUMP; f->air_used = 0; }
        if (in & IN_LEFT) { f->vx = -cfg->walk; if (!o->present || f->auto_walk) f->facing_left = 1; }
        else if (in & IN_RIGHT) { f->vx = cfg->walk; if (!o->present || f->auto_walk) f->facing_left = 0; }
        if (f->state == FS_IDLE && f->vx) f->state = FS_WALK;
        break;
    case FS_JUMP:
        if (in & IN_LEFT) f->vx = -cfg->walk;
        else if (in & IN_RIGHT) f->vx = cfg->walk;
        if ((in & IN_FLIP) == IN_FLIP) { start_flip(f); break; }
        /* A in the air: a flying kick (one a jump) */
        if (!f->air_used && (in & IN_A)) {
            f->move = MOVE_KICK;
            f->state = FS_ATTACK;
            f->timer = 0;
            f->hit_done = 0;
            f->air_used = 1;
        }
        break;
    case FS_FLIP:
        if (f->spin) f->spin = f->spin > 255 - FLIP_SPIN ? 255 : f->spin + FLIP_SPIN;
        break;
    case FS_STUN:
        f->vx = f->vx * 7 / 8;
        if (f->timer) f->timer--;
        if (!f->timer && !airborne) { f->state = FS_IDLE; f->guard = STUN_GUARD; }
        break;
    case FS_ATTACK:
        mv = cfg->moves[f->move];
        if (!airborne) f->vx = 0;
        f->timer++;
        if (mv->proj && f->timer == mv->startup) {
            spawn_proj(mv->proj, i + 1, f->x + (f->facing_left ? -half : half) * (1 << FP),
                       f->y + ((cfg->body_h * 5 / 8) << FP), f->facing_left);
        }
        if (f->timer >= mv->startup + mv->active + mv->recovery) f->state = airborne ? FS_JUMP : FS_IDLE;
        break;
    case FS_HURT:
        if (f->timer) f->timer--;
        f->vx = f->vx * 7 / 8;
        if (!f->timer && !airborne) f->state = FS_IDLE;
        break;
    case FS_KO:
        f->vx = f->vx * 7 / 8;
        break;
    default:
        f->vx = 0;
        break;
    }

    /* physics */
    f->x += f->vx;
    if (airborne || f->vy) {
        f->vy -= cfg->gravity;
        f->y += f->vy;
        if (f->y <= 0) {
            f->y = 0;
            f->vy = 0;
            /* an air attack ends as he lands; landing a backflip stuns the other one, wherever he is */
            if (f->state == FS_JUMP || (f->state == FS_ATTACK && f->move == MOVE_KICK)) f->state = FS_IDLE;
            else if (f->state == FS_FLIP) { f->state = FS_IDLE; f->spin = 0; f->vx = 0; stun_other(i); }
        }
    }

    /* edges are walls except where they're open, and then walking off hands over;
     * the edge he just came in through stays open while he walks in */
    h = to_h64(f->y) + 32;
    if (h < 32) h = 255;
    open_l = edge_open(0, h) || (f->auto_walk && !f->facing_left);
    open_r = edge_open(1, h) || (f->auto_walk && f->facing_left);
    if ((f->x >> FP) < 0 && open_l && !f->auto_walk) { exit_fighter(i, DIR_LEFT, h); return; }
    if ((f->x >> FP) >= cfg->width && open_r && !f->auto_walk) { exit_fighter(i, DIR_RIGHT, h); return; }
    if (!open_l && (f->x >> FP) < half) { f->x = half << FP; f->vx = 0; }
    if (!open_r && (f->x >> FP) > cfg->width - half) { f->x = (cfg->width - half) << FP; f->vx = 0; }
    /* jumped (or walked) into the GelatoBoy where it covers this screen; only
     * his own movement counts, so moving the GB over him doesn't pick him up */
    x8 = to_x256(f->x);
    if (last_ok[i] && in_portal(x8, h) && !in_portal(last_x[i], last_h[i])) { exit_fighter(i, DIR_PORTAL, h); return; }
    last_x[i] = x8;
    last_h[i] = h;
    last_ok[i] = 1;

    /* melee hit */
    if (f->state == FS_ATTACK && o->present && !f->hit_done) {
        mv = cfg->moves[f->move];
        if (!mv->proj && f->timer >= mv->startup && f->timer < mv->startup + mv->active) {
            int16_t x = f->x >> FP, y = f->y >> FP, ox = o->x >> FP, oy = o->y >> FP;
            int16_t h0 = f->facing_left ? x - half - mv->reach : x + half - 2;
            int16_t h1 = f->facing_left ? x - half + 2 : x + half + mv->reach;
            if (overlap(h0, h1, ox - half, ox + half) && overlap(y + mv->low, y + mv->high, oy, oy + cfg->body_h)) {
                f->hit_done = 1;
                hurt(1 - i, mv->damage, mv->knock, mv->launch, !f->facing_left, i + 1);
            }
        }
    }
}

void fight_update(uint8_t in0, uint8_t in1, uint8_t frozen)
{
    uint8_t i, j, h;
    fight_event_count = 0;

    for (i = 0; i < 2; i++) {
        if (!fighters[i].present) continue;
        update_fighter(i, frozen ? 0 : (i ? in1 : in0));
    }

    /* keep the bodies from overlapping */
    if (fighters[0].present && fighters[1].present) {
        fighter_t *a = &fighters[0], *b = &fighters[1];
        int16_t d = (b->x - a->x) >> FP;
        int16_t min = cfg->body_w - 2;
        if (d > -min && d < min && a->y < (cfg->body_h << FP) / 2 && b->y < (cfg->body_h << FP) / 2) {
            int16_t push = (min - (d < 0 ? -d : d)) / 2 + 1;
            if (d >= 0) { a->x -= push << FP; b->x += push << FP; }
            else { a->x += push << FP; b->x -= push << FP; }
        }
    }

    /* projectiles */
    for (i = 0; i < MAX_PROJ; i++) {
        proj_t *p = &projs[i];
        int16_t px, py, s = cfg->proj_size;
        if (!p->active) continue;
        p->x += p->vx;
        px = p->x >> FP;
        py = p->y >> FP;
        h = to_h64(p->y);
        if (px < 0 || px >= cfg->width) {
            /* the host decides whether it flies on into the other screen */
            uint8_t left = px < 0;
            event(EV_EXIT, left ? DIR_LEFT : DIR_RIGHT, h, KIND_PROJ, p->type, p->owner, to_x256(p->x), p->vx < 0);
            p->active = 0;
            continue;
        }
        if (in_portal(to_x256(p->x), h)) {
            event(EV_EXIT, DIR_PORTAL, h, KIND_PROJ, p->type, p->owner, to_x256(p->x), p->vx < 0);
            p->active = 0;
            continue;
        }
        for (j = 0; j < 2; j++) {
            fighter_t *f = &fighters[j];
            int16_t fx = f->x >> FP, fy = f->y >> FP, half = cfg->body_w / 2;
            if (!f->present || p->owner == j + 1 || f->state == FS_KO) continue;
            if (overlap(px - s, px + s, fx - half, fx + half) && overlap(py - s, py + s, fy, fy + cfg->body_h)) {
                hurt(j, cfg->proj_damage[p->type], cfg->proj_speed[p->type], 0, p->vx > 0, p->owner);
                p->active = 0;
                break;
            }
        }
        /* opposing projectiles cancel out */
        for (j = 0; j < MAX_PROJ && p->active; j++) {
            proj_t *q = &projs[j];
            if (j == i || !q->active || q->owner == p->owner) continue;
            if (overlap(px - s, px + s, (q->x >> FP) - s, (q->x >> FP) + s)
                && overlap(py - s, py + s, (q->y >> FP) - s, (q->y >> FP) + s)) {
                p->active = 0;
                q->active = 0;
            }
        }
    }
}
