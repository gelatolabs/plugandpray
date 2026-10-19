cmake_minimum_required(VERSION 3.21)

project(gelatostation LANGUAGES C ASM)

set(SHARED ${CMAKE_CURRENT_LIST_DIR}/../shared)

psn00bsdk_add_executable(game1 GPREL game1/main.c common/gfx.c common/sfx.c common/music.c common/song.c common/boot.c ${SHARED}/link.c ${SHARED}/plat.c)
psn00bsdk_add_executable(game2 GPREL game2/main.c common/gfx.c common/sfx.c common/music.c common/song.c common/boot.c ${SHARED}/link.c ${SHARED}/fight.c)
psn00bsdk_add_executable(game3 GPREL game3/main.c common/gfx.c common/sfx.c common/music.c common/song.c common/boot.c ${SHARED}/link.c ${SHARED}/zap.c)
psn00bsdk_add_executable(credits GPREL credits/main.c common/gfx.c common/sfx.c common/music.c common/song.c common/boot.c ${SHARED}/link.c)
psn00bsdk_add_executable(musictest GPREL musictest/main.c common/gfx.c common/sfx.c common/music.c common/song.c common/boot.c ${SHARED}/link.c)
