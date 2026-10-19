/* Game 2 ("Vanilla Fighter II.5 ...") message types and link layout. */
#ifndef GELATO_GAME2_H
#define GELATO_GAME2_H

#define GAME2_ID 2

/* MSG_LOAD  host->ROM [round, present] present: bit0 = P1 starts here, bit1 = CPU starts here
 * MSG_ENTER host->ROM [dir, h, kind, who, owner, x, vy] (dir: edge it came through, or 0)
 * MSG_EXIT  ROM->host [dir, h, kind, who, owner, x, vy] (dir: DIR_LEFT/RIGHT/PORTAL)
 *   kind 0: fighter (who = 1 player / 2 cpu); kind 1: projectile (who = type, owner = 1/2)
 *   h: centre height above the floor, 64 = one fighter height; x: 0-255 across the arena
 *   vy: fighters: vertical speed in % of a jump (signed); projectiles: 1 = flying left */
#define MSG_HIT      16  /* ROM->host [victim, damage, attacker, blocked] */
#define MSG_ROUND    17  /* host->ROM [winner 1/2] round over: show KO */
#define MSG_MATCH    18  /* host->ROM [winner 1/2] match over */
#define MSG_REMATCH  19  /* ROM->host: player pressed A (Cross) after the match */
#define MSG_STUN     20  /* ROM->host [victim 1/2] a backflip landed while the victim is on the other screen;
                          * host->ROM [victim] passed on to the screen he's on: he's stunned there */

#define KIND_FIGHTER 0
#define KIND_PROJ    1
#define PROJ_BIT     1   /* the GelatoBoy's Gelato Blast (a pixel cube) */
#define PROJ_POLY    2   /* the GelatoStation's Gelato Blast (a polygon) */

/* generic fighter input bits (P1 from the pad, CPU from ctrl) */
#define IN_LEFT  1
#define IN_RIGHT 2
#define IN_UP    4
#define IN_DOWN  8
#define IN_A     16
#define IN_B     32
#define IN_C     64
#define IN_D     128

/* ctrl[] (host->ROM) */
#define C2_HP1      2    /* player health 0-100 */
#define C2_HP2      3    /* cpu health */
#define C2_WINS     4    /* low nibble: player round wins, high nibble: cpu */
#define C2_CPU_IN   5    /* cpu input bits */
#define C2_BAND     8    /* 4 bytes: open height band (lo, hi) of the left edge, then the right */
#define C2_PORTAL   12   /* 4 bytes: x0, x1, h0, h1 of the box where things go into the GelatoBoy (x1 <= x0: none) */

/* state[] (ROM->host) */
#define S2_PRESENT  0    /* bit0 player here, bit1 cpu here */
#define S2_P1X      1    /* positions as 0-255 fractions of the screen width */
#define S2_P1Y      2    /* height, 64 = fighter height */
#define S2_P2X      3
#define S2_P2Y      4
#define S2_P1ST     5    /* fighter state (FS_*) */
#define S2_P2ST     6
#define S2_PROJ     7    /* bit0: a player projectile is on screen, bit1: a cpu one */
#define S2_FACE     8    /* bit0 player faces left, bit1 cpu faces left */
#define S2_THREAT   9    /* distance to the nearest projectile about to hit the cpu (255: none) */

#endif
