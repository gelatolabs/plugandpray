/*
 * Levels for game 1 ("Rocky Road Trip"). Each level is one GelatoBoy screen
 * (10x9 tiles) and one GelatoStation screen (12x9 tiles).
 *
 * The screens link wherever they *look* like they touch from where the
 * player stands. Walking off an open GB edge drops the character into the
 * TV picture just beside the GB, wherever that is (even the middle of the
 * TV); walking into the GB on the TV brings him back in through the GB edge
 * he touched. While he's inside, moving the GB carries him around.
 *
 *   .  empty   #  solid   ^  spikes   G  goal   S  start
 */
#ifndef GELATO_LEVELS1_H
#define GELATO_LEVELS1_H

#define LEVEL_COUNT 6

#ifdef LEVELS_GB
static const char *const levels_gb[LEVEL_COUNT][9] = {
    { /* 1: step out - hold the GB over the TV and walk off its edge */
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        ".S........",
        "##########",
    },
    { /* 2: hop in - bring the GB to the pit and walk into it */
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "........G.",
        "##########",
    },
    { /* 3: lift - ride the GB up to the ledge */
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "##########",
    },
    { /* 4: trapdoor - fall in through the top, drop out through the floor */
        "#........#",
        "#........#",
        "#........#",
        "#........#",
        "#........#",
        "#........#",
        "#........#",
        "#........#",
        "####..####",
    },
    { /* 5: spike ledge - the only way out is the way you came in */
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "###.......",
        "###^^^^^^^",
        "##########",
    },
    { /* 6: round trip - the goal room only opens to the left */
        "..........",
        "######....",
        ".....#....",
        "..G..#....",
        "######....",
        "..........",
        "..........",
        "..........",
        "##########",
    },
};
#endif

#ifdef LEVELS_PS1
static const char *const levels_ps1[LEVEL_COUNT][9] = {
    { /* 1 */
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        "............",
        ".......G....",
        "############",
    },
    { /* 2: stuck in a pit three blocks deep */
        "............",
        "............",
        "............",
        "............",
        "............",
        "#####..#####",
        "#####..#####",
        "#####S.#####",
        "############",
    },
    { /* 3: the goal ledge is on a pillar too tall to climb */
        "............",
        "............",
        ".........G..",
        "........####",
        "........#...",
        "........#...",
        "........#...",
        ".S......#...",
        "############",
    },
    { /* 4: a spike floor with one safe spot, too far to jump to */
        "............",
        ".S..........",
        "###.........",
        "............",
        "............",
        "............",
        "............",
        "^^^^^^^^^^G^",
        "############",
    },
    { /* 5: two platforms over spikes, too far apart to jump */
        "............",
        "............",
        "............",
        "............",
        "............",
        ".S........G.",
        "###......###",
        "^^^^^^^^^^^^",
        "############",
    },
    { /* 6: hardly any floor - the GB has to catch him straight away */
        "............",
        "............",
        "............",
        "..####......",
        "............",
        "............",
        "............",
        "...........S",
        "...........#",
    },
};
#endif

#endif
