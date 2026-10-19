/*
 * The credits disc: the credits roll up the screen over a spinning cone and
 * a waving gelato fan. It uses the link only so the host can skip the
 * boot screens; it runs whatever cartridge is in the GelatoBoy.
 */
#include <stdint.h>
#include <psxapi.h>
#include <psxgpu.h>
#include <psxgte.h>
#include "../common/gfx.h"
#include "../common/cone.h"
#include "../common/sfx.h"
#include "../common/boot.h"
#include "../../shared/link.h"

#define CREDITS_ID 5   /* (its link is only for the boot screens: the host can skip them) */

#define COLS 38          /* characters across the text area */
#define ROWS 28          /* text rows on screen */
#define STEP 30          /* frames per row of scrolling (half a second) */

static const char *const lines[] = {
    "GELATO LABS",
    "PRESENTS",
    "",
    "",
    "PLUG AND PRAY",
    "MADE FOR LUDUM DARE 60 \"OLD TECH\"",
    "",
    "",
    /* the list is padded to one width, so it lines up when centred */
    "1  ROCKY ROAD TRIP              ",
    "2  VANILLA FIGHTER II.5 EX TURBO",
    "   REMIX ~EXTRA SCOOP~ COLD     ",
    "   EDITION '99 - DIRECTOR'S CUT ",
    "   (GREATEST HITS)              ",
    "3  LICENSE TO CHILL             ",
    "",
    "",
    "THE GELATO LABS \"G-TEAM\" FOR LD60 IS:",
    "",
    "PROGRAMMING:",
    "KFARWELL",
    "CLAUDE",
    "",
    "3D ART:",
    "SIGNSEI",
    "KFARWELL",
    "",
    "GB ART:",
    "LDUSER125",
    "",
    "2D ART:",
    "THORNEDMARBLE",
    "KFARWELL",
    "",
    "AUDIO:",
    "CLAUDE",
    "",
    "",
    "MADE WITH:",
    "",
    "GBDK-2020",
    "PSN00BSDK",
    "V810-GCC",
    "",
    "SAMEBOY",
    "PCSX REARMED",
    "BEETLE VB",
    "",
    "EMSCRIPTEN",
    "THREE.JS",
    "",
    "BLENDER",
    "SUBSTANCE PAINTER",
    "GIMP",
    "",
    "",
    "SOME GELATO WAS HARMED",
    "IN THE MAKING OF THIS GAME",
    "",
    "",
    "THANKS FOR PLAYING!",
};
#define LINES ((int)(sizeof(lines) / sizeof(lines[0])))

static char text[2048];

static void draw_cone(int t)
{
    MATRIX m;
    int bob = (isin(t * 40) * 30) >> 12;
    /* the team's cone (common/cone.h), its origin where the cone meets the scoops */
    gfx_matrix(&m, 0, t * 16, 0, 0, 260 + bob, 0);
    gfx_object(&m);
    gfx_mesh(&cone_mesh, 0, CONE_TRIS, ONE);
}

int main(void)
{
    int t = 0, font;

    link_init(CREDITS_ID);
    gfx_init();
    sfx_init();
    gfx_boot();   /* the GelatoStation's boot screens first */
    gfx_camera(0, -100, -1400, 0);
    /* a stream big enough for a screenful of centred text */
    font = FntOpen(8, 8, SCREEN_W - 16, SCREEN_H - 16, 0, sizeof(text));

    while (1) {
        int scroll, row, n = 0;
        guy_t g = { 0 };
        t++;
        sfx_update();   /* (the boot's last notes ending) */
        link_port.frame++;
        gfx_sky(16, 8, 40, 110, 40, 90);
        draw_cone(t);
        g.x = -780; g.y = 480; g.z = -400; g.yaw = 1748; g.scale = 34;   /* facing us, turned a little towards the cone */
        g.wave = (t & 63) + 1;
        g.shirt_r = 236; g.shirt_g = 96; g.shirt_b = 140;
        g.pants_r = 60; g.pants_g = 80; g.pants_b = 200;
        gfx_guy(&g);

        /* the roll starts below the screen and loops once it has gone by */
        scroll = (t / STEP) % (LINES + ROWS);
        for (row = 0; row < ROWS; row++) {
            int i = row + scroll - ROWS;
            if (i >= 0 && i < LINES) {
                const char *s = lines[i];
                int len = 0, pad;
                while (s[len]) len++;
                for (pad = (COLS - len) / 2; pad > 0 && n < (int)sizeof(text) - 64; pad--) text[n++] = ' ';
                for (int col = (COLS - len) / 2; *s && n < (int)sizeof(text) - 64; s++, col++) {
                    if (*s == '~') gfx_tilde(col, row);   /* the font has none: drawn instead */
                    text[n++] = *s == '~' ? ' ' : *s;
                }
            }
            text[n++] = '\n';
        }
        text[n] = 0;
        FntPrint(font, "%s", text);
        FntFlush(font);
        gfx_display();
    }
    return 0;
}
