# Plug and Pray

## Building

```sh
make setup   # once: GBDK-2020, rgbds, a mipsel-none-elf GCC, PSn00bSDK,
             #       v810-gcc (+ mawk to build it), SameBoy, PCSX ReARMed,
             #       Beetle VB, npm
make         # emulator cores (emu/build.sh), ROMs (gb/, vb/, ps1/),
             #       web game -> dist/
make dev     # Vite dev server on all interfaces (port 5260)
make cert    # HTTPS for the dev server via mkcert (WebXR on a headset
             #       needs HTTPS)
make test    # headless ROM tests + headless-Chrome end-to-end tests
```

Needs Emscripten (`emcc`), CMake, Ninja, Python 3, Node 22 and Google Chrome
(for tests). `dist/` is a static site; host it anywhere.

## Layout

```
emu/frontend.c      tiny libretro frontend; linked with each core into
                    web/public/emu/*.mjs
emu/build.sh        compiles SameBoy, PCSX ReARMed and Beetle VB with emcc
shared/link.{h,c}   "link cable": message rings + state/ctrl bytes in ROM RAM,
                    found by the host via a magic string
shared/plat.c       game 1 platformer physics (compiled by both SDCC and GCC)
shared/fight.c      game 2 fighting core (per-system movesets)
shared/zap.c        game 3 enemies
shared/levels1.h    game 1 levels (GB 10x9, PS1 12x9)
gb/gameN/           GBDK-2020 ROMs; gen_assets.py turns ASCII art into tiles
ps1/gameN/          PSn00bSDK executables (GTE-rendered); ps1/common/gfx.c
                    shared rendering
gb/ending/          the GB ROM after escaping: "You escaped reality!" and the
                    credits
vb/vision/          the Virtualato's program (v810-gcc): draws the boxes the
                    host sends as a wireframe, straight into the framebuffers;
                    vb/crt0.s + vb/vb.ld lay out the ROM
shared/vblink.h     the Virtualato's mailbox (camera + boxes)
ps1/credits/        the credits disc
ps1/common/signsign.h
                    the GelatoStation's character (Signsign): generated from
                    assets/character.blend by `blender -b assets/character.blend
                    --python assets/export_signsign.py`; drawn (textured,
                    rigidly skinned, posed from code) by gfx_guy() in
                    ps1/common/gfx.c
web/public/models/signsign.glb
                    the character in 3D (web/src/guy.js), from the same .blend
                    by `blender -b assets/character.blend --python
                    assets/export_signsign_glb.py`
web/public/models/{crt_base,crt_screen,gelatostation,gelatostation_disc,
virtualto_headset_base}.glb
                    the TV, the GelatoStation (gelatostation.glb: body + lid)
                    and the Virtualato, textured from assets/textures/
                    (Substance Painter), by `blender -b assets/character.blend
                    --python assets/export_props.py`; scene.js, items.js and
                    virtualato.js fit them to the game's sizes
web/public/models/desk.glb
                    the desk: exported from assets/desk.blend by `blender -b
                    assets/desk.blend --python assets/export_desk.py`; scene.js
                    fits it to the desk's footprint
web/src/app.js      the game: room, consoles, media, mode switching
web/src/modes/      host-side logic per game (routing between screens, scores,
                    CPU AI, waves)
web/src/linkgeo.js  flattens both screens into the camera's view: when they link
                    and where things cross
web/src/cables.js   simulated link, AV and power cables (Verlet particle chains
                    with collisions)
web/src/screens.js  reflective DMG LCD + shadow-mask CRT shaders
web/src/items.js    cartridges, discs, zapper, display stand
web/src/hardware.js power and signal from the cables and the GB's switch; the
                    CRT's power animation
web/src/virtualato.js
                    the VB headset: wearing it, its view, the boxes it's sent
web/src/maze.js     the maze, the end room and its port, the GB-screen wave over
                    the walls
web/src/guy.js      the platformer character in 3D (the ending)
web/src/audio.js    positional sound: the consoles' audio, the AV jack routing,
                    synthesised effects
web/src/touch.js    touch controls
web/src/xr.js       WebXR: controllers, walking, the Virtualato's screen in the
                    headset
web/src/gamepad.js  gamepads
tests/              node:test suites: ROMs headless (with the real host modes) +
                    browser e2e
```

## License

ISC (see LICENSE). The emulator cores keep their own licenses, so the built game
is GPLv2:

- [SameBoy](https://github.com/LIJI32/SameBoy): MIT
- [PCSX ReARMed](https://github.com/libretro/pcsx_rearmed): GPLv2
- [Beetle VB](https://github.com/libretro/beetle-vb-libretro): GPLv2
- emu/libretro.h: MIT
