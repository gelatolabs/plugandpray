/*
 * The Virtualato's mailbox in Virtual Boy work RAM. The host finds it by its
 * magic and writes, every frame, where the wearer's head is and a list of
 * boxes around them; the ROM draws them as a wireframe.
 *
 * Distances are millimetres, angles 4096 to a turn. World axes are the
 * room's: x right, y up, z towards the wearer when they face the desk.
 */
#ifndef GELATO_VBLINK_H
#define GELATO_VBLINK_H
#include <stdint.h>

#define VB_MAX_BOXES 64

#define VBOX_BOX  0   /* all 12 edges */
#define VBOX_WALL 1   /* a flat wall: the rectangle across its two longest sides */
#define VBOX_LINE 2   /* a line from c to c + h (not turned) */
#define VBOX_RING 3   /* a flat polygon (8 sides) of radius h[0], across its own x and y */
#define VBOX_ROUND 4  /* a box (h) seen as its front and back outlines, its bottom a half circle (the GelatoBoy) */

typedef struct {
    int16_t c[3];         /* centre */
    int16_t h[3];         /* half size along the box's own axes */
    int16_t yaw, pitch;   /* rotation: yaw about y, then pitch about x */
    uint8_t type, bright; /* VBOX_*, brightness 1-3 */
} vbox_t;

typedef struct {
    char magic[8];                /* "GELATOVB" */
    volatile uint8_t frame;       /* ROM: frames drawn */
    volatile uint8_t count;       /* host: boxes in use */
    volatile uint8_t power;       /* host: 0 shows nothing */
    volatile uint8_t pad;
    volatile int16_t cam[5];      /* host: eye position x, y, z; yaw; pitch */
    volatile int16_t focal;       /* host: focal length in pixels */
    volatile vbox_t boxes[VB_MAX_BOXES];
} vblink_t;

#endif
