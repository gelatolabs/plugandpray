#include "link.h"

volatile link_t link_port;

void link_init(uint8_t game)
{
    uint8_t i;
    volatile uint8_t *p = (volatile uint8_t *)&link_port;
    for (i = 0; i < sizeof(link_t); i++) p[i] = 0;
    link_port.game = game;
    /* magic last, byte by byte, so the host never matches a half-initialised
     * link or a copy of the string in the program image */
    link_port.magic[0] = 'G'; link_port.magic[1] = 'E'; link_port.magic[2] = 'L'; link_port.magic[3] = 'A';
    link_port.magic[4] = 'T'; link_port.magic[5] = 'O'; link_port.magic[6] = 'L'; link_port.magic[7] = 'K';
}

uint8_t link_send(uint8_t type, uint8_t a, uint8_t b, uint8_t c, uint8_t d, uint8_t e)
{
    return link_send7(type, a, b, c, d, e, 0, 0);
}

uint8_t link_send7(uint8_t type, uint8_t a, uint8_t b, uint8_t c, uint8_t d, uint8_t e, uint8_t f, uint8_t g)
{
    uint8_t w = link_port.out_w;
    uint8_t next = (w + 1) & (LINK_RING - 1);
    volatile uint8_t *m;
    if (next == link_port.out_r) return 0;
    m = link_port.out[w];
    m[0] = type; m[1] = a; m[2] = b; m[3] = c; m[4] = d; m[5] = e; m[6] = f; m[7] = g;
    link_port.out_w = next;
    return 1;
}

uint8_t link_recv(uint8_t *msg)
{
    uint8_t r = link_port.in_r, i;
    if (r == link_port.in_w) return 0;
    for (i = 0; i < LINK_MSG_LEN; i++) msg[i] = link_port.in[r][i];
    link_port.in_r = (r + 1) & (LINK_RING - 1);
    return 1;
}
