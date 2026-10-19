#!/usr/bin/env python3
"""Tiles for the ending on the GelatoBoy: the font, a floor and the character."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from gfx import FONT_C, FONT_ORDER, GUY, GUY_ORDER, Sheet, font_tile, split, sprite16  # noqa: E402

FLOOR = [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    ".333.333.333.333",
    "3323332333233323",
    "3333333333333333",
    "3333333333333333",
    "3333333333333333",
    "3333333333333333",
]
sheet = Sheet()
bg = [("BG_BLANK", [["........"] * 8])]
bg.append(("BG_FLOOR", split(FLOOR, 16, 16)))
bg.append(("BG_FONT", [font_tile(c) for c in FONT_ORDER]))
sheet.add_group("bg_tiles", bg)
spr = [("SPR_" + n.upper(), sprite16(GUY[n])) for n in GUY_ORDER]
sheet.add_group("spr_tiles", spr)
sheet.write(os.path.dirname(os.path.abspath(__file__)), '#define FONT_CHARS "%s"' % FONT_C)
