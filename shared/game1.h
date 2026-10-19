/* Game 1 ("Rocky Road Trip") message types and link state layout. */
#ifndef GELATO_GAME1_H
#define GELATO_GAME1_H

#define GAME1_ID 1

/* MSG_EXIT  ROM->host [dir, x, y, vy, facing_left] left through an open edge;
 *           x, y: box centre in level pixels (clamped to 0-255), vy: signed
 * MSG_ENTER host->ROM [x, feet, vy, facing_left, auto_walk] arrives at exactly
 *           this spot (the host has checked it's free) */
#define MSG_GOAL    16   /* ROM->host: [level] reached the goal */
#define MSG_DIED    17   /* ROM->host: [level] touched spikes */
#define MSG_TAKE    19   /* host->ROM: the character walked into the GelatoBoy: remove him here */
#define MSG_HINT    20   /* host->ROM: [n] level 1's hint: 0 none, 1 its first part, 2 both */

/* ctrl[] (host->ROM): open edge cells, 2 bytes LE each */
#define CTRL_EXIT_L 2    /* rows where walking off the left edge is allowed */
#define CTRL_EXIT_R 4    /* same for the right edge */
#define CTRL_EXIT_T 6    /* columns where jumping off the top is allowed */
#define CTRL_EXIT_B 8    /* columns where falling off the bottom is allowed */

/* state[] (ROM->host) */
#define ST_LEVEL    0    /* current level, 0xFF before the first MSG_LOAD */
#define ST_PRESENT  1    /* 1 while the character is on this screen */
#define ST_LEVELS   6    /* number of levels */
#define ST_X        7    /* player centre x in level pixels */
#define ST_Y        8    /* player feet y in level pixels */
#define ST_VY       9    /* vertical speed (signed) */
#define ST_FACE     10   /* 1 = facing left */
#define ST_MAP      16   /* 18 bytes: solid tiles, 16-bit row masks */

#endif
