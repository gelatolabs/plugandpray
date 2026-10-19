#!/bin/bash
# Builds a mipsel-none-elf GCC toolchain for PSn00bSDK into tools/mipsel-none-elf.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/tools/src"
BUILD="$ROOT/tools/build"
PREFIX="$ROOT/tools/mipsel-none-elf"
BINUTILS=binutils-2.43.1
GCC=gcc-14.2.0
JOBS=$(sysctl -n hw.ncpu 2>/dev/null || nproc)
export MAKEINFO=true
mkdir -p "$SRC" "$BUILD" "$PREFIX"
cd "$SRC"
[ -f $BINUTILS.tar.xz ] || curl -sSfLO https://ftp.gnu.org/gnu/binutils/$BINUTILS.tar.xz
[ -f $GCC.tar.xz ] || curl -sSfLO https://ftp.gnu.org/gnu/gcc/$GCC/$GCC.tar.xz
[ -d $BINUTILS ] || tar xf $BINUTILS.tar.xz
[ -d $GCC ] || tar xf $GCC.tar.xz
(cd $GCC && [ -d gmp ] || ./contrib/download_prerequisites --no-isl)

mkdir -p "$BUILD/binutils" && cd "$BUILD/binutils"
"$SRC/$BINUTILS/configure" --prefix="$PREFIX" --target=mipsel-none-elf \
  --disable-docs --disable-nls --disable-werror --with-float=soft --with-system-zlib
make -j"$JOBS" && make install-strip

export PATH="$PREFIX/bin:$PATH"
mkdir -p "$BUILD/gcc" && cd "$BUILD/gcc"
"$SRC/$GCC/configure" --prefix="$PREFIX" --target=mipsel-none-elf \
  --disable-docs --disable-nls --disable-werror --disable-libada --disable-libssp \
  --disable-libquadmath --disable-threads --disable-libgomp --disable-libstdcxx-pch \
  --disable-hosted-libstdcxx --enable-languages=c,c++ --without-isl --without-headers \
  --with-float=soft --with-gnu-as --with-gnu-ld --with-system-zlib
make -j"$JOBS" all-gcc all-target-libgcc
make install-strip-gcc install-strip-target-libgcc
echo "TOOLCHAIN OK"
