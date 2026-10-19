#!/bin/bash
# Builds every GelatoStation PS-EXE into web/public/roms/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$ROOT/tools/mipsel-none-elf/bin:$PATH"
BUILD="$ROOT/build/ps1"
# the music: assets/music/song.mid (or demo.mid) and the kit -> common/song.c, song.h
python3 -I "$ROOT/assets/music/tools/midi_ps1.py"
cmake -S "$ROOT/ps1" -B "$BUILD" -G Ninja -DCMAKE_BUILD_TYPE=Release -Wno-dev \
  -DCMAKE_TOOLCHAIN_FILE="$ROOT/tools/psn00bsdk/lib/libpsn00b/cmake/sdk.cmake" >/dev/null
cmake --build "$BUILD"
mkdir -p "$ROOT/web/public/roms"
for exe in "$BUILD"/*.exe; do
  cp "$exe" "$ROOT/web/public/roms/$(basename "$exe")"
done
