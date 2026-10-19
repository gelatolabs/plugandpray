/* Enemy logic for game 3, shared by both systems (screen-pixel units). */
#ifndef GELATO_ZAP_H
#define GELATO_ZAP_H
#include <stdint.h>

#define MAX_ENEMIES 6

#define ES_NONE   0
#define ES_FLY    1
#define ES_DIE    2
#define ES_FLEE   3

typedef struct {
    int16_t width, height;   /* screen size in pixels */
    int16_t radius;          /* hit radius */
    int16_t speed;           /* base horizontal speed, 12.4 */
    int16_t amp;             /* vertical bob amplitude, pixels */
} zap_cfg_t;

typedef struct {
    int16_t x, y, base_y;    /* 12.4 */
    int16_t vx, vy;
    uint8_t state, type, hp, phase, timer;
    uint16_t life;           /* frames left before it flees */
} enemy_t;

#define ZEV_EXIT   1
#define ZEV_ESCAPE 2
typedef struct { uint8_t type, a, b, c, d; } zap_event_t;

extern enemy_t enemies[MAX_ENEMIES];
extern zap_event_t zap_events[8];
extern uint8_t zap_event_count;

void zap_init(const zap_cfg_t *cfg);
void zap_clear(void);
void zap_spawn(uint8_t side, uint8_t frac, uint8_t type);
void zap_enter(uint8_t dir, uint8_t yfrac, uint8_t type, uint8_t life_secs);
/* edges: bit0 left linked, bit1 right linked */
void zap_update(uint8_t edges);
/* Returns the type of the enemy hit at (x, y) (| ZAP_KILLED if that finished it), 0 if none. */
#define ZAP_KILLED 0x10
uint8_t zap_shoot(int16_t x, int16_t y);
uint8_t zap_count(void);
/* Writes enemy positions/alive mask into the link state (S3_*). */
void zap_publish(void);
int8_t zap_sin(uint8_t phase);

#endif
