/*
 * Link port between a game ROM and the web host (the "link cable").
 *
 * The ROM keeps one link_t in RAM. The host finds it by scanning for the
 * magic string and exchanges data with it between emulated frames:
 *  - out[]/in[] are rings of small messages (ROM->host and host->ROM). Each
 *    ring index has exactly one writer, so no locking is needed.
 *  - state[] is continuously published by the ROM, ctrl[] by the host.
 * Offsets must stay in sync with web/src/link.js.
 */
#ifndef GELATO_LINK_H
#define GELATO_LINK_H
#include <stdint.h>

#define LINK_MSG_LEN 8
#define LINK_RING    8
#define LINK_STATE   48
#define LINK_CTRL    32

typedef struct {
    char magic[8];                          /* "GELATOLK", written last */
    uint8_t game;                           /* which game this ROM is */
    uint8_t frame;                          /* ROM heartbeat */
    uint8_t out_w, out_r;                   /* ROM writes out_w, host writes out_r */
    uint8_t in_w, in_r;                     /* host writes in_w, ROM writes in_r */
    uint8_t pad[2];
    uint8_t out[LINK_RING][LINK_MSG_LEN];
    uint8_t in[LINK_RING][LINK_MSG_LEN];
    uint8_t state[LINK_STATE];
    uint8_t ctrl[LINK_CTRL];
} link_t;

extern volatile link_t link_port;

/* Messages common to every game (first byte of a message is its type). */
#define MSG_NONE      0
#define MSG_ENTER     1   /* host->ROM: something arrives from the other screen (layout per game) */
#define MSG_EXIT      2   /* ROM->host: something left through an open edge (layout per game) */
#define MSG_LOAD      3   /* host->ROM: [level/round, ...] (re)start a level or round */
#define MSG_WIN       4   /* host->ROM: the game has been beaten */

#define DIR_LEFT   1
#define DIR_RIGHT  2
#define DIR_UP     3
#define DIR_DOWN   4
#define DIR_PORTAL 5   /* flew into the GelatoBoy where it covers this screen */

/* ctrl[] bytes shared by all games */
#define CTRL_EDGES    0   /* bit0: left edge open, bit1: right, bit2: top, bit3: bottom */
#define CTRL_PARTNER  1   /* game id running on the other system */
#define CTRL_SKIPBOOT 31  /* nonzero: skip the GelatoStation's boot screens (tests don't sit through them) */

/* the background music: the host's controls, and where the ROM is */
#define CTRL_MUSIC_ON   26   /* 0: muted (still counting), 1: audible */
#define CTRL_MUSIC_POS  27   /* 27, 28: a row (a 16th) to be at (low, high) ... */
#define CTRL_MUSIC_SEQ  29   /* ... taken when this changes */
#define CTRL_MUSIC_SONG 30   /* 0: no music, 1: song 1, ... */
#define STATE_MUSIC_POS 46   /* 46, 47: the row it's at (low, high) */

void link_init(uint8_t game);
/* Queues a message; returns 0 if the ring is full. */
uint8_t link_send(uint8_t type, uint8_t a, uint8_t b, uint8_t c, uint8_t d, uint8_t e);
/* Same with all seven argument bytes. */
uint8_t link_send7(uint8_t type, uint8_t a, uint8_t b, uint8_t c, uint8_t d, uint8_t e, uint8_t f, uint8_t g);
/* Copies the next incoming message into msg; returns 0 if there is none. */
uint8_t link_recv(uint8_t *msg);

#endif
