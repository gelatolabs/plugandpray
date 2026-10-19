#!/usr/bin/env python3
"""Makes the home screen and tab icons (web/public/icons/) from the Gelato Labs
logo's round mark (web/public/img/gelato.png, its left 238 px): the home screen's
green on black, square, with a margin (iOS rounds the corners; Android may crop
to a circle); the tab's on a transparent background.

    python3 assets/make_icons.py
"""
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(HERE, '..', 'web', 'public')
mark = Image.open(os.path.join(PUB, 'img', 'gelato.png')).convert('RGBA').crop((0, 0, 238, 238))
os.makedirs(os.path.join(PUB, 'icons'), exist_ok=True)
for size in (180, 192, 512):
    icon = Image.new('RGBA', (size, size), (0, 0, 0, 255))
    m = round(size * 0.14)
    icon.alpha_composite(mark.resize((size - 2 * m, size - 2 * m), Image.LANCZOS), (m, m))
    icon.convert('RGB').save(os.path.join(PUB, 'icons', f'icon-{size}.png'), optimize=True)
# the tab's icon: just the mark, on nothing (64 px, for sharp screens)
mark.resize((64, 64), Image.LANCZOS).save(os.path.join(PUB, 'icons', 'favicon.png'), optimize=True)
print('wrote', os.path.join(PUB, 'icons'))
