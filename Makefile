# Gelato Labs · LD60 "Plug and Pray"
#   make setup   fetch + build toolchains into tools/ and third_party/ (once)
#   make         build emulator cores, ROMs and the web game into dist/
#   make dev     run the Vite dev server
#   make test    headless ROM tests + browser end-to-end tests

export EM_CACHE := $(CURDIR)/.cache/emscripten

all: emu roms web

setup:
	./scripts/setup.sh

emu:
	./emu/build.sh

roms:
	$(MAKE) -C gb
	$(MAKE) -C vb
	./ps1/build.sh

web:
	npx vite build web --outDir ../dist --emptyOutDir

dev:
	npx vite web

# HTTPS certificate for the dev server (WebXR needs HTTPS away from localhost),
# signed by your mkcert CA, for this machine's names and LAN address
cert:
	@mkdir -p .cache/certs
	mkcert -cert-file .cache/certs/dev.pem -key-file .cache/certs/dev-key.pem \
		$$(hostname) $$(hostname -s).local localhost 127.0.0.1 ::1 $$(ipconfig getifaddr en0 2>/dev/null) $$(ipconfig getifaddr en1 2>/dev/null)

test: web
	node --test --test-concurrency=1 tests/*.test.mjs

clean:
	$(MAKE) -C gb clean
	rm -rf build dist web/public/emu web/public/roms

.PHONY: all setup emu roms web dev cert test clean
