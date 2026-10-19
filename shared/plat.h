/*
 * Tile platformer core shared by the GelatoBoy and GelatoStation builds of
 * game 1, so the character feels identical on both systems. Units are
 * "pixels" where one tile is 16; positions are 12.4 fixed point.
 */
#ifndef GELATO_PLAT_H
#define GELATO_PLAT_H
#include <stdint.h>

#define PLAT_ROWS   9
#define PLAT_MAXCOL 12
#define PLAT_TILE   16
#define PLAT_W      10   /* player box */
#define PLAT_H      14

#define PL_LEFT  1
#define PL_RIGHT 2
#define PL_JUMP  4   /* edge-triggered */

#define PLAT_EV_NONE       0
#define PLAT_EV_EXIT       1   /* left the screen: see plat_exit_* */
#define PLAT_EV_GOAL       3
#define PLAT_EV_DIED       4

/* plat_exits[]: which edge cells are open (bit per row for left/right, per column for top/bottom) */
#define PLAT_E_LEFT   0
#define PLAT_E_RIGHT  1
#define PLAT_E_TOP    2
#define PLAT_E_BOTTOM 3

typedef struct {
    int16_t x, y;          /* top-left of the box, 12.4 fixed point */
    int16_t vy;
    uint8_t on_ground, facing_left, anim, auto_walk, active, moving;
} plat_player_t;

extern char plat_map[PLAT_ROWS][PLAT_MAXCOL];
extern uint8_t plat_cols;
extern plat_player_t pl;
extern uint16_t plat_exits[4];
extern uint8_t plat_exit_dir;     /* DIR_* of the last PLAT_EV_EXIT */
extern uint8_t plat_exit_x, plat_exit_y;   /* box centre when it left, clamped to 0-255 */
extern uint8_t plat_pit;          /* below the screen is a bottomless pit, not a wall */

/* Copies a level screen into plat_map; spawns the player if it has an 'S'. */
void plat_load(const char *const *rows, uint8_t cols);
/* Writes the solid tiles as 9 little-endian 16-bit row masks (18 bytes). */
void plat_publish_map(volatile uint8_t *dst);
/* Puts the player at centre x `cx`, feet `feet` (pixels), moving vertically at vy. */
void plat_place(uint8_t cx, uint8_t feet, int8_t vy, uint8_t facing_left, uint8_t auto_walk);
/* Steps the player one frame; edges are walls unless open in plat_exits. */
uint8_t plat_update(uint8_t input);

#endif
