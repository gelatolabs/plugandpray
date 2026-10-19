#!/usr/bin/env python3
"""Makes the web page's pixel font from the GB games' 5x7 letters (gb/gfx.py):
web/public/fonts/gelatoboy.ttf, a square a pixel (100 units; 800 to the em,
so at 32px a pixel is 4px). It has capitals only: small letters are the same.

    python3 assets/make_webfont.py
"""
import os
import sys

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'gb'))
from gfx import FONT_5x7  # noqa: E402

OUT = os.path.join(HERE, '..', 'web', 'public', 'fonts', 'gelatoboy.ttf')
PX, ADV, EM = 100, 600, 800   # a pixel, a letter's advance (5 and a gap), the em


def glyph(rows):
    pen = TTGlyphPen(None)
    for r, bits in enumerate(rows):
        for c, b in enumerate(bits):
            if b != '1':
                continue
            x, y = c * PX + PX // 2, (6 - r) * PX   # (rows from the top; the baseline under the last; half the gap each side, so a line's centred)
            pen.moveTo((x, y))
            pen.lineTo((x, y + PX))
            pen.lineTo((x + PX, y + PX))
            pen.lineTo((x + PX, y))
            pen.closePath()
    return pen.glyph()


# a few more for the page's messages, in the same style (the GB games don't need them)
EXTRA = {
    ',': ['00000', '00000', '00000', '00000', '00110', '00010', '00100'],
    "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
    '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
    ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
    '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
    ';': ['00000', '00110', '00110', '00000', '00110', '00010', '00100'],
}
FONT_5x7 = {**EXTRA, **FONT_5x7}
names = {ch: ('space' if ch == ' ' else f'g{ord(ch):04X}') for ch in FONT_5x7}
order = ['.notdef'] + sorted(set(names.values()))
glyphs = {'.notdef': TTGlyphPen(None).glyph()}
cmap = {}
for ch, rows in FONT_5x7.items():
    glyphs[names[ch]] = glyph(rows)
    cmap[ord(ch)] = names[ch]
    if ch.isalpha():
        cmap[ord(ch.lower())] = names[ch]   # (small letters: the capitals)
fb = FontBuilder(EM, isTTF=True)
fb.setupGlyphOrder(order)
fb.setupCharacterMap(cmap)
fb.setupGlyf(glyphs)
fb.setupHorizontalMetrics({n: (ADV, 0) for n in order})
fb.setupHorizontalHeader(ascent=EM, descent=-100)
fb.setupNameTable({'familyName': 'GelatoBoy', 'styleName': 'Regular'})
fb.setupOS2(sTypoAscender=EM, sTypoDescender=-100, usWinAscent=EM, usWinDescent=100)
fb.setupPost()
os.makedirs(os.path.dirname(OUT), exist_ok=True)
fb.save(OUT)
print('wrote', OUT, len(FONT_5x7), 'letters')
