# Builds the Virtualato's ROMs into web/public/roms/: its AR program (vision)
# and the error screen it shows with a game put in it (bsod).
ROOT := $(abspath ..)
BIN := $(ROOT)/tools/v810-gcc/bin
OUT := $(ROOT)/web/public/roms
CFLAGS := -O2 -Wall -std=gnu99 -fno-builtin -ffreestanding

all: $(OUT)/vision.vb $(OUT)/bsod.vb

$(OUT)/vision.vb: crt0.s vb.ld vision/main.c $(ROOT)/shared/vblink.h
	@mkdir -p $(OUT) $(ROOT)/build/vb
	$(BIN)/v810-gcc $(CFLAGS) -c vision/main.c -o $(ROOT)/build/vb/vision.o
	$(BIN)/v810-as crt0.s -o $(ROOT)/build/vb/crt0.o
	$(BIN)/v810-gcc -nostdlib -T vb.ld -o $(ROOT)/build/vb/vision.elf $(ROOT)/build/vb/crt0.o $(ROOT)/build/vb/vision.o -lgcc
	$(BIN)/v810-objcopy -O binary --gap-fill 0xFF $(ROOT)/build/vb/vision.elf $@

$(OUT)/bsod.vb: crt0.s vb.ld bsod/main.c bsod/font.h
	@mkdir -p $(OUT) $(ROOT)/build/vb
	$(BIN)/v810-gcc $(CFLAGS) -c bsod/main.c -o $(ROOT)/build/vb/bsod.o
	$(BIN)/v810-as crt0.s -o $(ROOT)/build/vb/crt0.o
	$(BIN)/v810-gcc -nostdlib -T vb.ld -o $(ROOT)/build/vb/bsod.elf $(ROOT)/build/vb/crt0.o $(ROOT)/build/vb/bsod.o -lgcc
	$(BIN)/v810-objcopy -O binary --gap-fill 0xFF $(ROOT)/build/vb/bsod.elf $@

clean:
	rm -f $(OUT)/vision.vb $(OUT)/bsod.vb

.PHONY: all clean
