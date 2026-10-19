/* Sound effects for the GelatoStation ROMs: little synth notes on the SPU,
 * from two waveforms the ROM builds in sound RAM at start-up (a square wave
 * and noise), so there are no samples to ship. */
#ifndef GELATO_PS1_SFX_H
#define GELATO_PS1_SFX_H

#define SFX_SQUARE 0
#define SFX_NOISE  1

void sfx_init(void);
/* A note: wave SFX_*, frequency from f0 to f1 Hz over `frames` frames,
 * volume 0-0x3fff, panned -64 (left) .. 64 (right). */
void sfx_play(int wave, int f0, int f1, int frames, int vol, int pan);
/* The same, swelling up over its first `attack` frames and fading over its
 * last `release` (0: straight in / straight out). */
void sfx_note(int wave, int f0, int f1, int frames, int vol, int pan, int attack, int release);
/* Call once a frame: sweeps the notes and lets them go when they're done. */
void sfx_update(void);

#endif
