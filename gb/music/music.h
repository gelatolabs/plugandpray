/* The background music on the GelatoBoy's own sound hardware:
 * square 1 (lead), square 2 (harmony), the wave
 * channel (bass) and noise (drums), from a song converted from MIDI by
 * assets/music/tools/midi_gb.py into song.c. It plays in step with the
 * GelatoStation's version; the host mutes whichever one the player isn't on,
 * and nudges it through the link's ctrl bytes. */
#ifndef GELATO_GB_MUSIC_H
#define GELATO_GB_MUSIC_H
#include <stdint.h>

/* Where each channel's events are at the start of a bar (for seeking). */
typedef struct {
    uint16_t off;     /* the offset in its stream of the first event at or after the bar */
    uint16_t tick;    /* that event's tick */
    uint8_t param;    /* the duty (squares) or wave shape (wave) in force at the bar */
} music_seek_t;

typedef struct {
    uint16_t tpf;                 /* ticks (1/48 beat) a frame, in 1/4096ths */
    uint16_t end, loop;           /* in ticks: where it ends, and where it starts again */
    uint8_t bars;                 /* rows in seek[] */
    const uint8_t *stream[4];     /* per channel: see midi_gb.py for the format */
    const music_seek_t *seek;     /* bars x 4 */
} song_t;

extern const song_t *const music_songs[];   /* (song.c) song 1, 2, ... */
extern const uint8_t music_song_count;

void music_init(void);              /* after sfx_init */
void music_play(const song_t *s);   /* from the top */
void music_stop(void);
void music_frame(void);             /* once a frame: plays what's due, reads the link */
uint16_t music_pos(void);           /* in rows (a row = 12 ticks = a 16th) */

#endif
