/*
 * Fighting core shared by both halves of game 2. Each system runs it with
 * its own arena size and moveset; the host moves fighters and projectiles
 * between the screens and keeps score.
 */
#ifndef GELATO_FIGHT_H
#define GELATO_FIGHT_H
#include <stdint.h>

#define FS_IDLE   0
#define FS_WALK   1
#define FS_JUMP   2
#define FS_ATTACK 3
#define FS_BLOCK  4
#define FS_HURT   5
#define FS_KO     6
#define FS_WIN    7
#define FS_FLIP   8   /* the backflip, in the air */
#define FS_CLAP   9   /* (unused: the stunned fighter claps) */
#define FS_STUN   10  /* stunned by the other fighter landing a backflip: claps, can't do anything */

#define MAX_PROJ 4

typedef struct {
    uint8_t startup, active, recovery;
    int16_t reach;          /* hitbox extends this far in front of the body */
    uint8_t low, high;      /* hitbox vertical band, from the floor */
    uint8_t damage;
    int16_t knock;          /* knockback speed (12.4) */
    int16_t launch;         /* upward speed given to the victim (12.4) */
    uint8_t proj;           /* projectile type thrown at the end of startup, 0 = melee */
} move_t;

/* the moves (fight_cfg_t.moves); B blocks, and the backflip is its own state */
#define MOVE_PUNCH 0   /* A */
#define MOVE_BLAST 1   /* down, forward + A: the Gelato Blast */
#define MOVE_KICK  2   /* A in the air: the flying kick */

typedef struct {
    int16_t width;          /* arena width (units) */
    int16_t body_w, body_h;
    int16_t walk, jump_vel, gravity;   /* 12.4 */
    int16_t proj_speed[3];  /* by projectile type (12.4) */
    uint8_t proj_damage[3];
    int16_t proj_size;
    const move_t *moves[3]; /* by MOVE_* */
} fight_cfg_t;

typedef struct {
    int16_t x, y;           /* x: body centre, y: height above floor; 12.4 */
    int16_t vx, vy;
    uint8_t present, facing_left, state, timer, move, hit_done, anim, auto_walk;
    uint8_t air_used;       /* this jump's air attack is spent */
    uint8_t spin;           /* how far round the backflip is (0-255), 0 = not flipping */
    uint8_t guard;          /* frames left in which a clap can't stun him again */
} fighter_t;

typedef struct {
    int16_t x, y, vx;       /* 12.4 */
    uint8_t active, type, owner;
} proj_t;

#define EV_EXIT 1   /* [dir, h, kind, who, owner, x, vy] like MSG_EXIT */
#define EV_HIT  2
#define EV_STUN 3   /* [victim 1/2] like MSG_STUN */
typedef struct {
    uint8_t type, a, b, c, d, e, f, g;
} fight_event_t;

/* Where things can leave this screen (filled in from ctrl[] by the ROM).
 * Heights are centre heights in h64 units, x is 0-255 across the arena. */
typedef struct {
    uint8_t open;               /* bit0: left edge, bit1: right edge */
    uint8_t lo[2], hi[2];       /* per edge: the band of heights that's open */
    uint8_t px0, px1, ph0, ph1; /* things go into the GelatoBoy in this box; px1 <= px0: nowhere */
} fight_link_t;

extern fighter_t fighters[2];
extern proj_t projs[MAX_PROJ];
extern fight_event_t fight_events[8];
extern uint8_t fight_event_count;
extern fight_link_t fight_link;

void fight_init(const fight_cfg_t *cfg);
void fight_reset(uint8_t present_mask);
/* Brings a fighter (kind 0) or projectile (kind 1) in at x (0-255), centre
 * height h. dir: the edge it came through (it walks in a little), or 0. vy:
 * fighters' vertical speed in % of a jump, projectiles' 1 = flying left. */
void fight_enter(uint8_t dir, uint8_t h, uint8_t kind, uint8_t who, uint8_t owner, uint8_t x, int8_t vy);
/* One frame. in0/in1: IN_* bits for the player and the CPU. */
void fight_update(uint8_t in0, uint8_t in1, uint8_t frozen);
/* Reads fight_link from the link ctrl bytes (see game2.h). */
void fight_read_link(void);
void fight_set_state(uint8_t who, uint8_t state);
/* Stuns fighter who (1/2) if he's here (MSG_STUN: a backflip landed on the other screen). */
void fight_stun(uint8_t who);
/* Turns the player's input into special moves: down, forward + A is the
 * Gelato Blast (IN_C; forward: the way the last press points); up, one way,
 * down, the other way + A is the backflip (IN_FLIP).
 * Call once a frame with the raw IN_* bits (A/B only when pressed). */
#define COMBO_GAP 18   /* frames allowed between the steps */
#define IN_FLIP (IN_C | IN_D)
uint8_t fight_combo(uint8_t in);
/* How far (0-255 across the arena) the nearest projectile flying at the CPU
 * is, if it would hit him where he is now; 255 if none. */
uint8_t fight_threat(void);

#endif
