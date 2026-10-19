// How far the game has got loading, for the bar on the title screen: every
// file it's waiting on, by bytes (each with a guess at its size until the
// server says), then the steps after them (parsing each model, building the
// room, compiling its shaders, booting the consoles), which have the last part
// of the bar between them.
const files = new Map();
const steps = { done: 0, total: 0 };
let listener = () => {};

function update() {
  let loaded = 0, total = 0;
  for (const f of files.values()) { loaded += Math.min(f.loaded, f.total); total += f.total; }
  const bytes = total ? loaded / total : 0, after = steps.total ? steps.done / steps.total : 0;
  listener(Math.min(1, bytes * 0.75 + after * 0.25));
}

export const loading = {
  listen(fn) { listener = fn; update(); },
  // a file that's coming, about `guess` bytes
  expect(key, guess) { if (!files.has(key)) { files.set(key, { loaded: 0, total: guess }); update(); } },
  bytes(key, loaded, total) {
    const f = files.get(key) ?? { loaded: 0, total: 0 };
    f.loaded = loaded;
    if (total) f.total = total;
    files.set(key, f);
    update();
  },
  steps(total) { steps.total = total; update(); },
  step() { steps.done++; update(); },
  // a step done, then a frame for the bar to show it (between pieces of work
  // that would otherwise all happen before the page next paints)
  shown() { this.step(); return new Promise((r) => requestAnimationFrame(() => setTimeout(r))); },
};

// Fetches a file's bytes, reporting them as they arrive. (Always asking the
// server whether it's changed: a cached copy of an older ROM or model would
// otherwise be used for a while after a new one goes up.)
export async function fetchBytes(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`couldn't load ${url} (${r.status})`);
  const total = Number(r.headers.get('content-length')) || 0;
  if (!r.body) {
    const b = new Uint8Array(await r.arrayBuffer());
    loading.bytes(url, b.length, b.length);
    return b;
  }
  const reader = r.body.getReader(), parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    loading.bytes(url, got, total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  loading.bytes(url, got, got);
  return out;
}
