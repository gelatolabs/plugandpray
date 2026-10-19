// The title screen's background: the end room's GB-screen walls (maze.js
// gbWave), flat on the screen. Big pixels with faint shadows, the grid between
// them glowing (slowly brighter and dimmer), with a black hole punched through
// it behind "Click to start" (and the loading bar): a rectangle of cells, and
// cells knocked out at random round it, like a hole in a brick wall, its edges
// glowing green inside. Which cells are gone is worked out here (holeCells) and
// handed to the shader, so the text can sit in the middle of the solid black
// block (the rectangle and whatever whole rows or columns beside it are gone
// too); the bar sits in the middle of the rectangle. Both are on the grid, not
// quite the middle of the screen. Plain WebGL (three.js isn't up yet); without
// it, the title's own green shows.
const GRID_W = 64, GRID_H = 32;   // the cells the hole can reach (counted from the middle one: -32 .. 31 by -16 .. 15)

const hash = (x, y) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
// How many cells (x, y) (y up) is beyond a rectangle of half-size (hx, hy) round the middle (0: inside it).
const ring = (x, y, hx, hy) => Math.max(-x - hx, x + 1 - hx, -y - hy, y + 1 - hy, 0);
// Whether it's gone: inside, or out round the edge at random, less often further out.
const gone = (x, y, hx, hy, odds) => { const r = ring(x, y, hx, hy); return r === 0 || hash(x, y) < (odds[r - 1] ?? 0); };

// The cells for the shader (RGBA: gone round the text, gone round the bar, how
// late it goes as the hole opens out), and where the text goes: the middle of the
// solid block, which is the rectangle and any whole rows or columns beside it that
// are gone too (cells: x0 .. x1 by y0 .. y1).
function holeCells(hole, wide) {
  const data = new Uint8Array(GRID_W * GRID_H * 4);
  const at = (x, y) => gone(x, y, hole[0], hole[1], [0.62, 0.3, 0.08]);
  for (let j = 0; j < GRID_H; j++) {
    for (let i = 0; i < GRID_W; i++) {
      const x = i - GRID_W / 2, y = j - GRID_H / 2, k = (j * GRID_W + i) * 4;
      data[k] = at(x, y) ? 255 : 0;
      data[k + 1] = gone(x, y, wide[0], wide[1], [0.8, 0.45, 0.15]) ? 255 : 0;
      data[k + 2] = Math.round(hash(x + 17, y + 17) * 255);
    }
  }
  let x0 = -hole[0], x1 = hole[0] - 1, y0 = -hole[1], y1 = hole[1] - 1;
  const col = (x) => { for (let y = y0; y <= y1; y++) if (!at(x, y)) return false; return true; };
  const row = (y) => { for (let x = x0; x <= x1; x++) if (!at(x, y)) return false; return true; };
  for (let grew = true; grew;) {
    grew = false;
    if (col(x0 - 1)) { x0--; grew = true; }
    if (col(x1 + 1)) { x1++; grew = true; }
    if (row(y0 - 1)) { y0--; grew = true; }
    if (row(y1 + 1)) { y1++; grew = true; }
  }
  return { data, middle: [(x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2] };
}

const FRAG = `
  precision mediump float;
  uniform float time, cellPx;
  uniform vec2 res;
  uniform float open;             // 0 .. 1 as the hole opens out round the loading bar
  uniform sampler2D cells;        // GRID_W x GRID_H cells round the middle: gone round the text, round the bar, and when (see holeCells)
  // How gone cell c (counted from the middle one) is: the hole round the text, and
  // (fading out a cell at a time, at random) the wider one round the loading bar.
  float darkAt(vec2 c) {
    vec2 i = c + vec2(${GRID_W / 2}.0, ${GRID_H / 2}.0);
    if (i.x < 0.0 || i.y < 0.0 || i.x >= ${GRID_W}.0 || i.y >= ${GRID_H}.0) return 0.0;
    vec4 t = texture2D(cells, (i + 0.5) / vec2(${GRID_W}.0, ${GRID_H}.0));
    float wait = t.b * 0.75;
    return max(t.r, t.g * smoothstep(wait, wait + 0.25, open));
  }
  void main() {
    vec2 gbP = gl_FragCoord.xy / cellPx;
    vec2 p = gbP - floor(res * 0.5 / cellPx), c = floor(p);
    float dark = darkAt(c);
    // the hole's edges glow green on the inside (an inset glow: by how near the
    // wall still there is), and not out over the wall
    float spill = 0.0;
    for (int i = -2; i <= 2; i++) {
      for (int j = -2; j <= 2; j++) {
        vec2 n = c + vec2(float(i), float(j));
        float d = length(max(abs(p - n - 0.5) - 0.5, 0.0));
        spill = max(spill, (1.0 - darkAt(n)) * exp(-d * 2.6));
      }
    }
    // the hole is see-through (onto the black behind, and the text and loading bar
    // there), lit green near its edges (premultiplied: the glow's alpha is its strength)
    float a = spill * 0.55;
    vec3 hole = vec3(0.3, 0.85, 0.1) * a;
    if (dark >= 1.0) { gl_FragColor = vec4(hole, a); return; }
    vec2 f = fract(gbP);
    float cell = smoothstep(0.0, 0.08, f.x) * smoothstep(0.0, 0.08, f.y) * smoothstep(1.0, 0.92, f.x) * smoothstep(1.0, 0.92, f.y);
    vec2 fs = fract(gbP - vec2(0.12, -0.14));
    float shadowCell = smoothstep(0.0, 0.1, fs.x) * smoothstep(0.0, 0.1, fs.y) * smoothstep(1.0, 0.9, fs.x) * smoothstep(1.0, 0.9, fs.y);
    float grain = fract(sin(dot(floor(gbP * 8.0), vec2(41.3, 289.1))) * 45758.5);
    vec3 lcd = vec3(0.565, 0.73, 0.26) * (0.96 + 0.04 * grain) * (1.0 - (0.08 * cell + 0.06 * shadowCell * (1.0 - cell)));
    float glow = 0.12 + 0.08 * sin(time * 1.3);
    lcd += vec3(0.42, 0.62, 0.12) * (1.0 - cell) * glow;
    gl_FragColor = vec4(mix(lcd, hole, dark), mix(1.0, a, dark));
  }`;

// Starts it behind everything in `title`; returns a function that stops it,
// with .opened(): a promise that the hole round the loading bar is all open
// (straight away without WebGL).
export function titleBackground(title) {
  const canvas = document.createElement('canvas');
  canvas.className = 'backdrop';
  const gl = canvas.getContext('webgl', { antialias: false, alpha: true, premultipliedAlpha: true });
  const none = () => {};
  none.opened = () => Promise.resolve();
  if (!gl) return none;
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }'));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return none;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);   // (one triangle over the screen)
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const u = (n) => gl.getUniformLocation(prog, n);
  const time = u('time'), cellPx = u('cellPx'), res = u('res'), open = u('open');
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
  for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE);
  let wideNow = -1, middle = [0, 0];
  let opened = 0, last = performance.now(), whenOpen = null;
  title.prepend(canvas);
  title.classList.add('walled');   // (black behind it, for the hole)
  let raf = 0;
  const t0 = performance.now();
  const draw = (now) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.uniform1f(time, (now - t0) / 1000);
    gl.uniform1f(cellPx, 20 * dpr);
    gl.uniform2f(res, w, h);
    // the hole's middle (a corner between cells) from the screen's, in CSS pixels: the text and bar go there
    const cx = Math.floor(w / 2 / (20 * dpr)) * 20 - canvas.clientWidth / 2, cy = canvas.clientHeight / 2 - Math.floor(h / 2 / (20 * dpr)) * 20;
    // round "Click to start" (about 170 px wide), then the loading bar that takes its place (320 px wide, at most 60% of the view)
    const wideX = Math.ceil((Math.min(320, canvas.clientWidth * 0.6) / 2 + 30) / 20);
    if (wideX !== wideNow) {
      const cells = holeCells([5, 2], [wideX, 2]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GRID_W, GRID_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, cells.data);
      middle = cells.middle;
      wideNow = wideX;
    }
    title.style.setProperty('--hole-x', `${cx}px`);
    title.style.setProperty('--hole-y', `${cy}px`);
    title.style.setProperty('--start-x', `${cx + middle[0] * 20}px`);
    title.style.setProperty('--start-y', `${cy - middle[1] * 20}px`);   // (the cells count up; the page, down)
    if (title.classList.contains('loading')) opened = Math.min(1, opened + (now - last) / 500);   // (all open half a second after the click)
    if (opened >= 1 && whenOpen) { whenOpen(); whenOpen = null; }
    last = now;
    gl.uniform1f(open, opened);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  const stop = () => { cancelAnimationFrame(raf); gl.getExtension('WEBGL_lose_context')?.loseContext(); };
  const allOpen = new Promise((r) => { whenOpen = r; });
  stop.opened = () => allOpen;
  return stop;
}
