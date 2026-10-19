/* A GelatoBoy ROM that only plays the music (song 1, forever): for listening
 * to a song (assets/music/tools/preview.mjs) and for the music's tests. With no
 * host it plays out loud; a host can mute it and move it like in the games. */
#include <gb/gb.h>
#include <stdint.h>
#include "../sfx.h"
#include "../music/music.h"
#include "../../shared/link.h"

#define MUSICTEST_ID 0xEE

void main(void)
{
    link_init(MUSICTEST_ID);
    sfx_init();
    music_init();
    link_port.ctrl[CTRL_MUSIC_ON] = 1;     /* (until a host says otherwise) */
    link_port.ctrl[CTRL_MUSIC_SONG] = 1;
    while (1) {
        wait_vbl_done();
        link_port.frame++;
        music_frame();
    }
}
