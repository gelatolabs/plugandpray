#!/usr/bin/env python3
"""Paints the power and eject symbols onto the GelatoStation's buttons, in its
colour texture: assets/textures/originals/GelatoStation_Mat_Base_color.png (the
artist's, untouched) -> assets/textures/GelatoStation_Mat_Base_color.png. Then
re-export the props (assets/export_props.py).

Where the buttons are in the texture was measured in Blender (a ray straight
down onto each button of GelatoStation_Base; the game's button spots, scene.js):
the UV there, and how the UV changes per metre to the right (+x) and towards
the front (-y), which also says which way the symbol's up (the back) goes.

    python3 assets/paint_station_symbols.py
"""
import math
import os

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'textures', 'originals', 'GelatoStation_Mat_Base_color.png')
OUT = os.path.join(HERE, 'textures', 'GelatoStation_Mat_Base_color.png')
INK = (34, 40, 36)
SIZE_MM = 7.5
BUTTONS = {
    # uv, d(uv)/dx (per metre, right), d(uv)/d(front) (per metre, towards you)
    'power': ((0.288, 0.0462), (0.0078, 1.7577), (2.3597, 0.0)),
    'eject': ((0.4584, 0.9215), (-1.7384, -0.2597), (-0.3608, 2.3339)),
}


def symbol(kind, s):
    """The symbol, white on transparent, s x s pixels covering SIZE_MM, up the image's up."""
    im = Image.new('L', (s, s), 0)
    d = ImageDraw.Draw(im)
    c, w = s / 2, max(2, round(s * 0.11))
    if kind == 'power':
        r = s * 0.36
        # a ring open at the top, and a bar down through the gap
        d.arc((c - r, c - r + s * 0.04, c + r, c + r + s * 0.04), start=-58, end=238, fill=255, width=w)
        d.line((c, s * 0.08, c, c + s * 0.02), fill=255, width=w)
    else:
        # a triangle pointing up over a bar
        d.polygon([(c, s * 0.12), (s * 0.84, s * 0.58), (s * 0.16, s * 0.58)], fill=255)
        d.rectangle((s * 0.16, s * 0.7, s * 0.84, s * 0.82), fill=255)
    return im


def main():
    tex = Image.open(SRC).convert('RGB')
    W, H = tex.size
    out = np.asarray(tex).astype(np.float32)
    S = 256
    for kind, (uv, ddx, ddf) in BUTTONS.items():
        mask = np.asarray(symbol(kind, S)).astype(np.float32) / 255
        cx, cy = uv[0] * W, (1 - uv[1]) * H
        # image pixels per mm: right (+x) and up (towards the back: -front)
        R = np.array([ddx[0] * W, -ddx[1] * H]) / 1000
        U = -np.array([ddf[0] * W, -ddf[1] * H]) / 1000
        mm = SIZE_MM / S   # mm per symbol pixel
        # each texture pixel near the button, back into the symbol: solve p = c + R sx + U sy
        A = np.linalg.inv(np.array([[R[0], U[0]], [R[1], U[1]]]))
        reach = int(math.ceil(SIZE_MM * max(np.linalg.norm(R), np.linalg.norm(U)))) + 2
        for y in range(int(cy) - reach, int(cy) + reach + 1):
            for x in range(int(cx) - reach, int(cx) + reach + 1):
                # supersampled 4x4 for smooth edges
                cover = 0.0
                for oy in (0.125, 0.375, 0.625, 0.875):
                    for ox in (0.125, 0.375, 0.625, 0.875):
                        sx, sy = A @ np.array([x + ox - cx, y + oy - cy])
                        i, j = int(S / 2 + sx / mm), int(S / 2 - sy / mm)
                        if 0 <= i < S and 0 <= j < S:
                            cover += mask[j, i]
                cover /= 16
                if cover > 0 and 0 <= x < W and 0 <= y < H:
                    out[y, x] = out[y, x] * (1 - cover * 0.9) + np.array(INK) * cover * 0.9
    Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(OUT)
    print('wrote', OUT)


main()
