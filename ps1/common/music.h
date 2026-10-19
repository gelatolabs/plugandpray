/* The background music on the GelatoStation's SPU:
 * the PS1-era arrangement of the song the GelatoBoy plays as a chiptune, from
 * MIDI and the instrument kit, converted by assets/music/tools/midi_ps1.py
 * into song.c. Voices 8-23 are the music's (0-7 the sound effects'), handed
 * out ahead of time by the converter. It plays in step with the GelatoBoy's
 * version; the host mutes whichever one the player isn't on, and nudges it
 * through the link's ctrl bytes. */
#ifndef GELATO_PS1_MUSIC_H
#define GELATO_PS1_MUSIC_H
#include <stdint.h>

#define MUSIC_ON  1   /* a note: voice (8-23), instrument, note, velocity, track */
#define MUSIC_OFF 2   /* a note's end (its release): voice */
#define MUSIC_CC  3   /* a track's CC 7 (volume), 10 (pan) or 91 (reverb): track, cc (in note), value (in vel) */

typedef struct {
    uint16_t tick;   /* 1/48 beat, from the top */
    uint8_t type, voice, inst, note, vel, track;
} music_event_t;

typedef struct {
    uint32_t addr, loop;   /* in sound RAM: the sample, and where its loop starts (0: a one-shot) */
    uint16_t pitch;        /* the SPU pitch that plays it at its own rate (at `root`) */
    uint8_t root;          /* the note that is (0: a drum, always at its own pitch) */
    uint8_t vol;           /* 0-127 */
    uint16_t adsr1, adsr2;
    uint8_t oneshot;       /* drums: they play out; note offs don't stop them */
} music_inst_t;

typedef struct {
    uint32_t tpf;                  /* ticks a frame, 16.16 */
    uint16_t end, loop;            /* in ticks: where it ends, and where it starts again */
    uint16_t nevents, loop_event;  /* events, and the first at or after the loop */
    uint8_t ntracks;
    const music_event_t *events;   /* in time order */
} song_t;

extern const song_t *const music_songs[];   /* (song.c) song 1, 2, ... */
extern const uint8_t music_song_count;
extern const music_inst_t music_insts[];
extern const uint8_t music_kit[];

void music_init(void);              /* after sfx_init: loads the kit into sound RAM, sets up the reverb */
void music_play(const song_t *s);   /* from the top */
void music_stop(void);
void music_frame(void);             /* once a frame: plays what's due, reads the link */
uint16_t music_pos(void);           /* in rows (a row = 12 ticks = a 16th) */

#endif
