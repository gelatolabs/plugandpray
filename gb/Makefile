# Builds every GelatoBoy ROM into web/public/roms/.
ROOT := $(abspath ..)
LCC := $(ROOT)/tools/gbdk/bin/lcc
OUT := $(ROOT)/web/public/roms
SHARED := $(ROOT)/shared

ROMS := $(OUT)/game1.gb $(OUT)/game2.gb $(OUT)/game3.gb $(OUT)/ending.gb $(OUT)/musictest.gb
MUSIC := music/music.c music/song.c

all: $(ROMS)

%/assets.c %/assets.h: %/gen_assets.py gfx.py
	cd $* && python3 gen_assets.py

$(OUT)/game1.gb: game1/main.c game1/assets.c game1/assets.h sfx.h $(MUSIC) music/music.h $(SHARED)/link.c $(SHARED)/link.h \
		$(SHARED)/plat.c $(SHARED)/plat.h $(SHARED)/game1.h $(SHARED)/levels1.h
	@mkdir -p $(OUT)
	$(LCC) -Wm-yn"ROCKY ROAD TRIP" -o $@ game1/main.c game1/assets.c $(SHARED)/link.c $(SHARED)/plat.c $(MUSIC)

$(OUT)/game2.gb: game2/main.c game2/assets.c game2/assets.h sfx.h $(MUSIC) music/music.h $(SHARED)/link.c $(SHARED)/link.h \
		$(SHARED)/fight.c $(SHARED)/fight.h $(SHARED)/game2.h
	@mkdir -p $(OUT)
	$(LCC) -Wm-yn"VANILLA FIGHTER" -o $@ game2/main.c game2/assets.c $(SHARED)/link.c $(SHARED)/fight.c $(MUSIC)

$(OUT)/game3.gb: game3/main.c game3/assets.c game3/assets.h sfx.h $(MUSIC) music/music.h $(SHARED)/link.c $(SHARED)/link.h \
		$(SHARED)/zap.c $(SHARED)/zap.h $(SHARED)/game3.h
	@mkdir -p $(OUT)
	$(LCC) -Wm-yn"LICENSE2CHILL" -o $@ game3/main.c game3/assets.c $(SHARED)/link.c $(SHARED)/zap.c $(MUSIC)

$(OUT)/ending.gb: ending/main.c ending/assets.c ending/assets.h sfx.h $(SHARED)/link.c $(SHARED)/link.h \
		$(SHARED)/plat.c $(SHARED)/plat.h $(SHARED)/ending.h $(SHARED)/game1.h
	@mkdir -p $(OUT)
	$(LCC) -Wm-yn"ESCAPED" -o $@ ending/main.c ending/assets.c $(SHARED)/link.c $(SHARED)/plat.c

music/song.c: $(wildcard $(ROOT)/assets/music/*.mid) $(ROOT)/assets/music/tools/midi_gb.py $(ROOT)/assets/music/tools/midi.py
	python3 $(ROOT)/assets/music/tools/midi_gb.py

$(OUT)/musictest.gb: musictest/main.c $(MUSIC) music/music.h sfx.h $(SHARED)/link.c $(SHARED)/link.h
	@mkdir -p $(OUT)
	$(LCC) -Wm-yn"MUSIC TEST" -o $@ musictest/main.c $(MUSIC) $(SHARED)/link.c

clean:
	rm -f $(ROMS) */assets.c */assets.h *.o */*.o *.map *.sym *.ihx *.lst *.asm *.noi

.PHONY: all clean
