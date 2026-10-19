#!/bin/bash
# Fetches and builds every toolchain/dependency into this directory (tools/,
# third_party/, .cache/). Safe to re-run; finished steps are skipped.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="$ROOT/tools"
TP="$ROOT/third_party"
mkdir -p "$TOOLS" "$TP"

GBDK_VERSION=4.5.0
RGBDS_VERSION=v1.0.4
SAMEBOY_COMMIT=26a56bd
PCSX_COMMIT=c881679
PSN00BSDK_COMMIT=5d9aa2d
BEETLE_VB_COMMIT=d5ae54c
V810_GCC_COMMIT=7d37f0e

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) GBDK_PKG=gbdk-macos-arm64.tar.gz ;;
  Darwin-*) GBDK_PKG=gbdk-macos.tar.gz ;;
  Linux-aarch64) GBDK_PKG=gbdk-linux-arm64.tar.gz ;;
  *) GBDK_PKG=gbdk-linux64.tar.gz ;;
esac

if [ ! -x "$TOOLS/gbdk/bin/lcc" ]; then
  echo "== GBDK-2020 $GBDK_VERSION"
  curl -sSfL "https://github.com/gbdk-2020/gbdk-2020/releases/download/$GBDK_VERSION/$GBDK_PKG" | tar xz -C "$TOOLS"
fi

if [ ! -x "$TOOLS/rgbds/rgbasm" ]; then
  echo "== rgbds $RGBDS_VERSION (SameBoy's boot ROMs)"
  if [ "$(uname -s)" = Darwin ]; then
    curl -sSfL -o "$TOOLS/rgbds.zip" "https://github.com/gbdev/rgbds/releases/download/$RGBDS_VERSION/rgbds-macos.zip"
    mkdir -p "$TOOLS/rgbds" && unzip -q -o "$TOOLS/rgbds.zip" -d "$TOOLS/rgbds" && rm "$TOOLS/rgbds.zip"
  else
    mkdir -p "$TOOLS/rgbds"
    curl -sSfL "https://github.com/gbdev/rgbds/releases/download/$RGBDS_VERSION/rgbds-linux-x86_64.tar.xz" | tar xJ -C "$TOOLS/rgbds"
  fi
fi
[ "$(uname -s)" = Darwin ] && xattr -dr com.apple.quarantine "$TOOLS/gbdk" "$TOOLS/rgbds" 2>/dev/null || true

clone() { # dir url commit
  if [ ! -d "$TP/$1" ]; then
    git clone -q "$2" "$TP/$1"
    git -C "$TP/$1" checkout -q "$3"
    git -C "$TP/$1" submodule update -q --init --recursive
  fi
}
echo "== sources"
clone SameBoy https://github.com/LIJI32/SameBoy.git "$SAMEBOY_COMMIT"
clone pcsx_rearmed https://github.com/libretro/pcsx_rearmed.git "$PCSX_COMMIT"
clone PSn00bSDK https://github.com/Lameguy64/PSn00bSDK.git "$PSN00BSDK_COMMIT"
clone beetle-vb https://github.com/libretro/beetle-vb-libretro.git "$BEETLE_VB_COMMIT"

# GCC 4.9's build scripts need mawk or gawk (macOS's awk makes broken option tables)
MAWK_VERSION=1.3.4-20240905
if [ ! -x "$TOOLS/mawk/bin/mawk" ]; then
  echo "== mawk $MAWK_VERSION (for building v810-gcc)"
  mkdir -p "$TOOLS/src" "$ROOT/.cache/tmp"
  curl -sSfL "https://invisible-island.net/archives/mawk/mawk-$MAWK_VERSION.tgz" | tar xz -C "$TOOLS/src"
  (cd "$TOOLS/src/mawk-$MAWK_VERSION" && TMPDIR="$ROOT/.cache/tmp" ./configure --prefix="$TOOLS/mawk" >/dev/null &&
    make >/dev/null && make install >/dev/null)
fi

if [ ! -x "$TOOLS/v810-gcc/bin/v810-gcc" ]; then
  echo "== v810-gcc (Virtual Boy; takes a while)"
  mkdir -p "$TOOLS/src" "$ROOT/.cache/tmp"
  [ -d "$TOOLS/src/v810-gcc" ] || git clone -q https://github.com/jbrandwood/v810-gcc.git "$TOOLS/src/v810-gcc"
  (cd "$TOOLS/src/v810-gcc" && git checkout -q "$V810_GCC_COMMIT" &&
    PATH="$TOOLS/mawk/bin:$PATH" TMPDIR="$ROOT/.cache/tmp" ./build_compiler.sh &&
    [ -x v810-gcc/bin/v810-gcc ] && rm -rf "$TOOLS/v810-gcc" && mv v810-gcc "$TOOLS/v810-gcc")
fi

if [ ! -x "$TOOLS/mipsel-none-elf/bin/mipsel-none-elf-gcc" ]; then
  echo "== mipsel-none-elf GCC (takes a while)"
  "$ROOT/scripts/build-mips-toolchain.sh"
fi

if [ ! -f "$TOOLS/psn00bsdk/lib/libpsn00b/cmake/sdk.cmake" ]; then
  echo "== PSn00bSDK"
  export PATH="$TOOLS/mipsel-none-elf/bin:$PATH"
  (cd "$TP/PSn00bSDK" && rm -rf build &&
    cmake --preset default . --install-prefix "$TOOLS/psn00bsdk" -DSKIP_EXAMPLES=ON -DCMAKE_BUILD_TYPE=Release >/dev/null &&
    cmake --build ./build && cmake --install ./build >/dev/null)
fi

echo "== npm packages"
(cd "$ROOT" && npm install --no-audit --no-fund)
echo "setup done"
