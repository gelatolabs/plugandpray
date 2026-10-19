import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// `make cert` makes an HTTPS certificate (mkcert); with one the dev server uses HTTPS
const certs = resolve(import.meta.dirname, '../.cache/certs');
const https = existsSync(`${certs}/dev.pem`)
  ? { cert: readFileSync(`${certs}/dev.pem`), key: readFileSync(`${certs}/dev-key.pem`) }
  : undefined;

export default defineConfig({
  base: './',
  // reachable from other devices on the network (a phone, a VR headset) by any name
  server: { port: 5260, host: '0.0.0.0', allowedHosts: true, https },
  // (the emulator threads are module workers: they import their cores)
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
      },
    },
  },
});
