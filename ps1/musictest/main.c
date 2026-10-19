/* A GelatoStation program that only plays the music (song 1, forever): for
 * listening to a song (assets/music/tools/preview.mjs --ps1) and for the
 * music's tests. With no host it plays out loud; a host can mute it and move
 * it like in the games. */
#include <stdint.h>
#include <psxapi.h>
#include <psxgpu.h>
#include "../common/gfx.h"
#include "../common/sfx.h"
#include "../common/music.h"
#include "../../shared/link.h"

#define MUSICTEST_ID 0xEE

int main(void)
{
    link_init(MUSICTEST_ID);
    gfx_init();
    sfx_init();
    music_init();
    link_port.ctrl[CTRL_MUSIC_ON] = 1;     /* (until a host says otherwise) */
    link_port.ctrl[CTRL_MUSIC_SONG] = 1;
    while (1) {
        link_port.frame++;
        music_frame();
        gfx_sky(20, 10, 40, 60, 30, 90);
        gfx_display();
    }
    return 0;
}
