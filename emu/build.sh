#!/bin/bash
# Builds SameBoy, PCSX ReARMed and Beetle VB (libretro cores) + frontend.c
# into ES6 WebAssembly modules under web/public/emu/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TP="$ROOT/third_party"
OUT="$ROOT/web/public/emu"
OBJ="$ROOT/build/emu"
export EM_CACHE="$ROOT/.cache/emscripten"
export TMPDIR="$ROOT/.cache/tmp"
mkdir -p "$TMPDIR"
JOBS=$(sysctl -n hw.ncpu 2>/dev/null || nproc)
mkdir -p "$OUT" "$OBJ/sameboy"

LDFLAGS=(-O2 -sMODULARIZE=1 -sEXPORT_ES6=1 -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1
  -sENVIRONMENT=web,node -sINITIAL_MEMORY=64MB -sSTACK_SIZE=1MB
  -sEXPORTED_FUNCTIONS=_malloc,_free
  -sEXPORTED_RUNTIME_METHODS=FS,HEAPU8,HEAP16,HEAPU32,ccall,cwrap)

build_sameboy() {
  local SB="$TP/SameBoy"
  if [ ! -f "$SB/build/bin/BootROMs/dmg_boot.bin" ]; then
    make -C "$SB" bootroms RGBDS="$ROOT/tools/rgbds/"
  fi
  for b in agb cgb cgb0 mgb dmg sgb sgb2; do
    local c="$OBJ/sameboy/${b}_boot.c"
    { echo "const unsigned char ${b}_boot[] = {"
      hexdump -v -e '/1 "0x%02x, "' "$SB/build/bin/BootROMs/${b}_boot.bin"
      echo "};"
      echo "const unsigned ${b}_boot_length = sizeof(${b}_boot);"; } > "$c"
  done
  local CFLAGS=(-O2 -std=gnu11 -D_GNU_SOURCE -D__LIBRETRO__ -DGB_INTERNAL -DGB_DISABLE_TIMEKEEPING
    -DGB_DISABLE_REWIND -DGB_DISABLE_DEBUGGER -DGB_DISABLE_CHEATS -DGB_VERSION=\"1.0\"
    -DGB_COPYRIGHT_YEAR=\"2026\" -I"$SB" -Wno-everything)
  local srcs=(gb sgb apu memory mbc timing display camera sm83_cpu joypad save_state random rumble)
  local objs=()
  for s in "${srcs[@]}"; do
    emcc "${CFLAGS[@]}" -c "$SB/Core/$s.c" -o "$OBJ/sameboy/$s.o" &
    objs+=("$OBJ/sameboy/$s.o")
  done
  for b in agb cgb cgb0 mgb dmg sgb sgb2; do
    emcc -O2 -c "$OBJ/sameboy/${b}_boot.c" -o "$OBJ/sameboy/${b}_boot.o" &
    objs+=("$OBJ/sameboy/${b}_boot.o")
  done
  emcc "${CFLAGS[@]}" -c "$SB/libretro/libretro.c" -o "$OBJ/sameboy/libretro.o" &
  objs+=("$OBJ/sameboy/libretro.o")
  wait
  emcc "${LDFLAGS[@]}" -sEXPORT_NAME=createSameBoy -I"$ROOT/emu" "$ROOT/emu/frontend.c" \
    "${objs[@]}" -o "$OUT/sameboy.mjs"
}

build_pcsx() {
  local PC="$TP/pcsx_rearmed"
  emmake make -C "$PC" -f Makefile.libretro platform=emscripten CC=emcc CXX=em++ AR=emar -j"$JOBS" >/dev/null
  # the core's "static library" is an ar archive despite its .bc name
  cp "$PC/pcsx_rearmed_libretro_emscripten.bc" "$OBJ/libpcsx_rearmed.a"
  emcc "${LDFLAGS[@]}" -sUSE_ZLIB=1 -sEXPORT_NAME=createPCSX -I"$ROOT/emu" "$ROOT/emu/frontend.c" \
    "$OBJ/libpcsx_rearmed.a" -o "$OUT/pcsx.mjs"
}

build_vb() {
  local VB="$TP/beetle-vb"
  emmake make -C "$VB" platform=emscripten CC=emcc CXX=em++ AR=emar HAVE_VR=0 -j"$JOBS" >/dev/null
  cp "$VB/mednafen_vb_libretro_emscripten.bc" "$OBJ/libbeetle_vb.a"
  emcc "${LDFLAGS[@]}" -sDEFAULT_TO_CXX -sEXPORT_NAME=createBeetleVB -I"$ROOT/emu" "$ROOT/emu/frontend.c" \
    "$OBJ/libbeetle_vb.a" -o "$OUT/beetle_vb.mjs"
}

case "${1:-all}" in
  sameboy) build_sameboy ;;
  pcsx) build_pcsx ;;
  vb) build_vb ;;
  all) build_sameboy; build_pcsx; build_vb ;;
esac
ls -la "$OUT"
