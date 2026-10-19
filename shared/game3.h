/* Game 3 ("License to Chill") message types and link layout. */
#ifndef GELATO_GAME3_H
#define GELATO_GAME3_H

#define GAME3_ID 3

/* MSG_LOAD  host->ROM [wave] start a wave (clears the screen)
 * MSG_ENTER host->ROM [dir, yfrac, type, life_secs] an enemy flies in through an edge
 * MSG_EXIT  ROM->host [dir, yfrac, type, life_secs] an enemy flew off a linked edge */
#define MSG_SPAWN   16   /* host->ROM [side 0 top/1 left/2 right, frac, type] */
#define MSG_SHOT    17   /* host->ROM [x lo, x hi, y] the zapper fired at this pixel */
#define MSG_RESULT  18   /* ROM->host [hit, type | ZAP_KILLED if it went down] */
#define MSG_ESCAPE  19   /* ROM->host [type] an enemy got away */
#define MSG_PHASE   20   /* host->ROM [phase] see PH_* */
#define MSG_START   21   /* ROM->host: the START button was shot (PH_TITLE) */

#define PH_PLAY     0
#define PH_CLEAR    1
#define PH_OVER     2
#define PH_WIN      3
#define PH_TITLE    4    /* the title, with a START button to shoot */

#define EN_BASIC    1    /* slow drifter */
#define EN_ZIPPY    2    /* fast zig-zagger */
#define EN_BIG      3    /* needs two hits */

/* ctrl[] (host->ROM) */
#define C3_LIVES    2
#define C3_SCORE    3    /* 2 bytes LE, score / 10 */
#define C3_WAVE     5
#define C3_ZAPPER   6    /* 1 while the GelatoBlaster is in your hand */

/* state[] (ROM->host) */
#define S3_COUNT    0    /* enemies currently on this screen */
#define S3_ENEMIES  1    /* per enemy slot: x, y as 0-255 screen fractions */
#define S3_ALIVE    13   /* bit per slot: shootable enemy */

#endif
