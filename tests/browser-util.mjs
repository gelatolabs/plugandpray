// Helpers for driving the built game in headless Chrome.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from 'playwright-core';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.gb': 'application/octet-stream', '.exe': 'application/octet-stream' };

export function serve(root) {
  const server = createServer((req, res) => {
    let p = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
    if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
    res.end(readFileSync(p));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

export async function launch(url, { width = 1280, height = 800, ready = () => window.__app?.mode } = {}) {
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // the game's title screen: click through it on every (re)load, then (once
  // it's started: the title's gone) switch on both consoles, which start off
  page.on('load', () => page.click('#title', { timeout: 5000 })
    .then(() => page.waitForFunction(() => window.__app?.hw && !document.getElementById('title'), null, { timeout: 120000 }))
    .then(() => page.evaluate(() => { const a = window.__app; if (!a.hw.gbOn) a.hw.toggleGb(); if (!a.hw.psOn) a.hw.togglePs(); }))
    .catch(() => {}));
  await page.goto(url);
  await page.waitForFunction(ready, null, { timeout: 60000 });
  return { browser, page, errors };
}

// Turns the game camera to look straight at a world point, so it's under the reticle.
export const aimAt = (page, p) => page.evaluate((p) => {
  const a = window.__app, c = a.camera.position;
  const dx = p[0] - c.x, dy = p[1] - c.y, dz = p[2] - c.z;
  a.fp.yaw = Math.atan2(-dx, -dz);
  a.fp.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  a.camera.rotation.set(a.fp.pitch, a.fp.yaw, 0);
  a.camera.updateMatrixWorld();
}, p);

// Clicks in the middle of the screen (where the reticle is), so a captured
// mouse doesn't turn the view.
export async function clickCenter(page, button = 'left') {
  const { width, height } = page.viewportSize();
  await page.mouse.click(width / 2, height / 2, { button });
}
