// Builds the room, the desk and the devices from the team's models, adding the
// game's own screens, labels and click boxes.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBB } from './collision.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

export const DESK_TOP = 0.75;
export const STATION_W = 0.216;   // m: the GelatoStation's width (a PSone's tray just fits a 12 cm disc)
export const ROOM = { minX: -2.5, maxX: 2.5, minZ: -0.62, maxZ: 3, height: 2.6 };

// GelatoBoy dimensions (metres) and where its screen sits on the front face.
export const GB = {
  half: new THREE.Vector3(0.045, 0.074, 0.016),
  screenCenter: new THREE.Vector3(0, 0.033, 0.0166),
  screenHalf: new THREE.Vector2(0.0235, 0.02115),
};

export const CRT = {
  half: new THREE.Vector3(0.22, 0.19, 0.2),
  position: new THREE.Vector3(-0.2, DESK_TOP + 0.19, -0.26),
  screenCenter: new THREE.Vector3(0, 0.015, 0.2015), // relative to the CRT centre
  screenHalf: new THREE.Vector2(0.165, 0.124),
  back: -0.32,     // how far back its back is (the power cord comes out there)
  jacks: new THREE.Vector3(0.22, -0.122, 0.1),   // the middle of the RCA jacks' panel on its right side
};

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts });

function labelTexture(text, { w = 256, h = 64, bg = null, fg = '#222', font = 'bold 34px sans-serif' } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = fg;
  g.font = font;
  // smaller if it doesn't fit across
  const fit = (w * 0.96) / Math.max(...text.split('\n').map((l) => g.measureText(l).width));
  if (fit < 1) g.font = font.replace(/(\d+(\.\d+)?)px/, (m, px) => `${(px * fit).toFixed(1)}px`);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // (a line per \n, centred together)
  const lines = text.split('\n'), lh = h / lines.length;
  lines.forEach((line, i) => g.fillText(line, w / 2, lh * (i + 0.5)));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function label(text, width, height, opts) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ map: labelTexture(text, opts), transparent: true, roughness: 0.8 }),
  );
  return m;
}

// A copy of a textured material in a flat colour: the painted colour gone,
// its roughness, normal and AO maps (the shape's relief) kept.
export function blacken(material, color) {
  const m = material.clone();
  m.map = null;
  m.color.set(color);
  m.needsUpdate = true;
  return m;
}

// A small printed logo or label (text on a transparent plane, width x height
// m) for the models: used for the props' ™ logos.
export function decal(text, width, height, opts) { return label(text, width, height, opts); }

function shadowed(obj) {
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return obj;
}

// A tiling surface texture (web/public/img/surfaces/<name>.webp, from
// ld60/extras/handoff/web/placeholders) repeated rx x ry times: one tile a metre.
export function surface(name, rx = 1, ry = 1) {
  const t = new THREE.TextureLoader().load(`./img/surfaces/${name}.webp`);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 8;
  return t;
}

// UVs from where each vertex is, in metres (one tile a metre), projected along
// whichever axis each face looks down: for models whose own UVs don't suit a
// tiling texture. Along x on the top, so wood grain runs along the desk.
function boxUVs(mesh) {
  mesh.updateMatrixWorld(true);
  const g = mesh.geometry = mesh.geometry.clone(), pos = g.attributes.position, nrm = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2), p = new THREE.Vector3(), n = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    n.fromBufferAttribute(nrm, i).applyMatrix3(normalMatrix);
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    const [u, v] = ay >= ax && ay >= az ? [p.x, p.z] : ax >= az ? [p.z, p.y] : [p.x, p.y];
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function buildRoom(scene) {
  const { minX, maxX, minZ, maxZ, height } = ROOM;
  const w = maxX - minX, d = maxZ - minZ;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(0xffffff, { roughness: 0.8, map: surface('floor_boards', w, d) }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  const wallMat = mat(0xffffff, { roughness: 0.95, map: surface('wall_paint', w, height) });
  const sideMat = mat(0xffffff, { roughness: 0.95, map: surface('wall_paint', d, height) });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, height), wallMat);
  back.position.set((minX + maxX) / 2, height / 2, minZ);
  back.receiveShadow = true;
  scene.add(back);
  for (const [x, ry] of [[minX, Math.PI / 2], [maxX, -Math.PI / 2]]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(d, height), sideMat);
    side.position.set(x, height / 2, (minZ + maxZ) / 2);
    side.rotation.y = ry;
    side.receiveShadow = true;
    scene.add(side);
  }
  // seen from both sides: the maze is on the other side of it
  const frontMat = wallMat.clone();
  frontMat.side = THREE.DoubleSide;
  const front = new THREE.Mesh(new THREE.PlaneGeometry(w, height), frontMat);
  front.position.set((minX + maxX) / 2, height / 2, maxZ);
  front.rotation.y = Math.PI;
  scene.add(front);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(0xffffff, { map: surface('ceiling_plaster', w, d) }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set((minX + maxX) / 2, height, (minZ + maxZ) / 2);
  scene.add(ceiling);
  const surfaces = [floor.material, wallMat, sideMat, frontMat, ceiling.material];

  // the Vanilla Fighter move list, above the GelatoStation
  const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.588),
    new THREE.MeshStandardMaterial({ map: fighterPoster(), roughness: 0.85 }));
  poster.position.set(0.34, 1.5, minZ + 0.003);
  poster.receiveShadow = true;
  scene.add(poster);
  // and the Plug and Pray controls, mirroring it on the left (the two spaced evenly across the desk)
  const controlsArt = controlsPoster();
  const controls = new THREE.Mesh(poster.geometry, new THREE.MeshStandardMaterial({ map: controlsArt.texture, roughness: 0.85 }));
  controls.position.set(-0.34, 1.5, minZ + 0.003);
  controls.receiveShadow = true;
  scene.add(controls);
  return { surfaces, fighterPoster: poster, controlsPoster: controlsArt, controlsMesh: controls };
}

// Rounded rectangle path.
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Drawing for the posters' control lists, on canvas context g (W wide):
// key caps, gamepad buttons (A / B) and d-pads (an arrow lights its arm), each
// returning its width, and a panel of rows of them with what they do.
function posterKit(g, W) {
  const ARMS = { '↑': [0, -1], '↓': [0, 1], '←': [-1, 0], '→': [1, 0] };
  // a key cap, dark with a neon green edge (like the poster's frame); an
  // arrow key gets a drawn arrow (the font's are thin)
  const key = (x, y, text) => {
    g.font = 'bold 24px sans-serif';
    const w = ARMS[text] ? 44 : Math.max(40, g.measureText(text).width + 20);
    roundRect(g, x, y - 20, w, 40, 8);
    g.fillStyle = 'rgba(8,26,10,0.8)';
    g.fill();
    g.strokeStyle = '#5cff2a';
    g.lineWidth = 2.5;
    g.stroke();
    g.fillStyle = '#eaffe0';
    if (ARMS[text]) {
      const [dx, dy] = ARMS[text], cx = x + w / 2;
      g.save();
      g.translate(cx, y);
      g.rotate(Math.atan2(dy, dx));
      g.fillRect(-10, -3, 12, 6);
      g.beginPath();
      g.moveTo(11, 0);
      g.lineTo(0, -9);
      g.lineTo(0, 9);
      g.closePath();
      g.fill();
      g.restore();
      return w;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, x + w / 2, y + 1);
    return w;
  };
  // a thumbstick, L or R
  const stick = (x, y, text) => {
    g.fillStyle = '#5cff2a';
    g.beginPath();
    g.arc(x + 20, y, 20, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(8,26,10,0.95)';
    g.beginPath();
    g.arc(x + 20, y, 17, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2c3a2c';
    g.beginPath();
    g.arc(x + 20, y, 11, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#eaffe0';
    g.font = 'bold 17px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, x + 20, y + 1);
    return 40;
  };
  const pad = (x, y, text) => {
    if (ARMS[text] || text === '+') {
      // a d-pad: a light cross with a dark edge, the pressed arm lit green ('+': none)
      const [dx, dy] = ARMS[text] ?? [0, 0], c = x + 20, a = 13, t = 7;
      // (white, with a dark edge so it reads on a light poster too)
      g.fillStyle = '#1a1a24';
      g.fillRect(c - t - 2, y - a - t - 2, t * 2 + 4, (a + t) * 2 + 4);
      g.fillRect(c - a - t - 2, y - t - 2, (a + t) * 2 + 4, t * 2 + 4);
      g.fillStyle = '#f4f1ea';
      g.fillRect(c - t, y - a - t, t * 2, (a + t) * 2);
      g.fillRect(c - a - t, y - t, (a + t) * 2, t * 2);
      g.fillStyle = '#3ba52a';
      if (dx) g.fillRect(dx > 0 ? c + t : c - a - t, y - t + 2, a - 1, t * 2 - 4);
      else if (dy) g.fillRect(c - t + 2, dy > 0 ? y + t : y - a - t, t * 2 - 4, a - 1);
      g.fillStyle = '#c9c4ba';
      g.beginPath();
      g.arc(c, y, 4, 0, Math.PI * 2);
      g.fill();
      return 40;
    }
    // a round button (A green, B raspberry; a gamepad's X blue, Y yellow)
    const [shade, face] = { A: ['#1f5a16', '#3ba52a'], X: ['#14306a', '#2f63d0'], Y: ['#6a5210', '#d6a820'] }[text] ?? ['#5a1030', '#b8235a'];
    g.fillStyle = shade;
    g.beginPath();
    g.arc(x + 20, y + 2, 20, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = face;
    g.beginPath();
    g.arc(x + 20, y, 19, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.beginPath();
    g.arc(x + 14, y - 7, 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff8e8';
    g.font = 'bold 24px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, x + 20, y + 1);
    return 40;
  };
  // a panel: its title, then a row per [glyphs, what they do] drawn with draw (key or pad)
  const section = (y, title, rows, draw = key, { rowH = 46, nameX = 250, nameSize = 28, accent = '#ffc23d' } = {}) => {
    roundRect(g, 28, y, W - 56, 70 + rows.length * rowH, 18);
    g.fillStyle = 'rgba(20,8,40,0.55)';
    g.fill();
    g.fillStyle = accent;
    g.font = '900 30px "Arial Black", sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(title, 50, y + 32);
    rows.forEach(([glyphs, name], i) => {
      const row = y + 82 + i * rowH;
      let x = 50;
      for (const k of glyphs) x += draw(x, row, k) + 6;
      g.fillStyle = '#fff8e8';
      g.font = `bold ${nameSize}px sans-serif`;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(name, Math.max(nameX, x + 10), row + 1);
    });
  };
  return { key, pad, stick, section };
}

// The Plug and Pray poster, on the wall over the left of the desk: the team's art
// (web/public/img/posters; from assets/images/posters) with the
// controls drawn in its panel, for whatever you're playing with: setMode('keys'),
// 'pad' (a gamepad), 'touch' or 'vr'. Each list is the room's controls, a gap, then the consoles'.
const CONTROLS = {
  keys: [
    [[['W', 'A', 'S', 'D']], 'Walk'],
    [[['Left-click']], 'Pick up / Use'],
    [[['Right-click']], 'Let go'],
    [[['Scroll']], 'Push / Pull'],
    [[['Space']], 'Jump'],
    null,
    [[['↑', '↓', '←', '→']], 'D-pad'],
    [[['Z']], 'A Button'],
    [[['X']], 'B Button'],
  ],
  pad: [
    [[['L'], 'stick'], 'Walk'],
    [[['RT']], 'Pick up / Use'],
    [[['LT']], 'Let go'],
    [[['Y'], 'pad'], 'Jump'],
    null,
    [[['+'], 'pad'], 'D-pad'],
    [[['A'], 'pad'], 'A Button'],
    [[['B'], 'pad'], 'B Button'],
  ],
  // (the touch screen's: dragging on either half, tapping, and its on-screen buttons)
  touch: [
    [[['Drag left']], 'Walk'],
    [[['Drag right']], 'Look'],
    [[['Tap']], 'Pick up / Use'],
    [[['Top button']], 'Let go'],
    null,
    [[['+'], 'pad'], 'D-pad'],
    [[['A'], 'pad'], 'A Button'],
    [[['B'], 'pad'], 'B Button'],
  ],
  vr: [
    [[['R'], 'stick'], 'Walk'],
    [[['Trigger']], 'Pick up / Use'],
    [[['Grip']], 'Let go'],
    null,
    [[['L'], 'stick'], 'D-pad'],
    [[['A', 'X'], 'pad'], 'A Button'],
    [[['B', 'Y'], 'pad'], 'B Button'],
  ],
};
const PANEL = { x0: 55, y0: 332, x1: 546, y1: 748 };   // inside the art's green frame
function controlsPoster() {
  const ART = new Image();
  ART.src = './img/posters/plug_and_pray_controls.webp';
  const W = 600, H = 840;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const kit = posterKit(g, W);
  const draws = { key: kit.key, pad: kit.pad, stick: kit.stick };
  let mode = 'keys';
  const paint = () => {
    if (!ART.complete || !ART.naturalWidth) return;
    g.drawImage(ART, 0, 0, W, H);
    const rows = CONTROLS[mode], ROW = 46, GAP = 24;
    const height = rows.reduce((h, r) => h + (r ? ROW : GAP), 0);
    // the glyphs first, then the names in one column just past the widest row of them
    const placed = [];
    let y = (PANEL.y0 + PANEL.y1) / 2 - height / 2 + ROW / 2, right = 0;
    for (const row of rows) {
      if (!row) { y += GAP; continue; }
      const [[glyphs, kind = 'key'], name] = row;
      let x = PANEL.x0 + 26;
      for (const k of glyphs) x += draws[kind](x, y, k) + 6;
      right = Math.max(right, x - 6);
      placed.push([name, y]);
      y += ROW;
    }
    for (const [name, y] of placed) {
      g.save();
      g.fillStyle = '#f2ffe8';
      g.shadowColor = 'rgba(92,255,42,0.8)';
      g.shadowBlur = 8;
      g.font = 'bold 27px sans-serif';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(name, right + 28, y + 1);
      g.restore();
    }
    t.needsUpdate = true;
  };
  ART.addEventListener('load', paint, { once: true });
  return {
    texture: t,
    setMode(m) { if (m !== mode && CONTROLS[m]) { mode = m; paint(); } },
  };
}

// The Vanilla Fighter poster: the team's art (web/public/img/posters; from
// assets/images/posters) with the controls drawn in front of each
// move's name (its rows' middles, measured on the art). (The image is made
// here, not when the module loads: the tests load it in Node, with no Image.)
function fighterPoster() {
  const FIGHTER_ART = new Image();
  FIGHTER_ART.src = './img/posters/vanilla_fighter_moves.webp';
  const W = 600, H = 840;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const { pad } = posterKit(g, W);
  const rows = [[499, ['A']], [553, ['B']], [606, ['↑', 'A']], [661, ['↓', '→', 'A']], [724, ['↑', '→', '↓', '←', 'A']]];
  const paint = () => {
    g.drawImage(FIGHTER_ART, 0, 0, W, H);
    for (const [y, glyphs] of rows) {
      let x = 300 - glyphs.length * 46;   // (right-aligned, just before the name at x 310)
      for (const k of glyphs) x += pad(x, y, k) + 6;
    }
    t.needsUpdate = true;
  };
  if (FIGHTER_ART.complete && FIGHTER_ART.naturalWidth) paint(); else FIGHTER_ART.addEventListener('load', paint, { once: true });
  return t;
}

// The models buildScene uses (assets/*.blend, exported to web/public/models by
// assets/export_*.py), by file name.
// (onProgress(url, loaded, total) hears how each is coming along: for the loading bar)
export const MODELS = ['desk', 'signsign', 'crt_base', 'crt_screen', 'gelatostation', 'gelatostation_disc', 'virtualto_headset_base', 'cartridge', 'display_stand', 'gelatoboy', 'zapper'];
export async function loadModels(onProgress = () => {}, onLoaded = () => {}) {
  const loader = new GLTFLoader();
  const scenes = await Promise.all(MODELS.map((n) => {
    const url = `./models/${n}.glb`;
    return loader.loadAsync(url, (e) => onProgress(url, e.loaded, e.total)).then((g) => { onLoaded(n); return g.scene; });
  }));
  const models = Object.fromEntries(MODELS.map((n, i) => [n, scenes[i]]));
  // the GelatoStation's body and lid come in one file (sharing their textures):
  // each its own model again, as if loaded on its own
  for (const part of ['body', 'lid']) {
    const mesh = models.gelatostation.getObjectByName(`GelatoStation_${part[0].toUpperCase()}${part.slice(1)}`);
    const g = new THREE.Group();
    g.add(mesh);
    models[`gelatostation_${part}`] = g;
  }
  for (const m of scenes) m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return models;
}

// A model's bounding box in its own frame (glTF: +y up, its front towards +z).
function modelBox(model) {
  model.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(model);
}

// The desk's footprint: 1.6 m wide, 0.8 m deep, its front edge at z = 0.2.
const DESK_SIZE = new THREE.Vector3(1.6, DESK_TOP, 0.8), DESK_CENTRE_Z = -0.2;

// The desk model (assets/desk.blend: a top and four legs), stretched to the
// footprint.
function buildDesk(scene, colliders, model) {
  const desk = new THREE.Group();
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
  model.scale.set(DESK_SIZE.x / size.x, DESK_SIZE.y / size.y, DESK_SIZE.z / size.z);
  model.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2).multiply(model.scale);
  model.position.z += DESK_CENTRE_Z;
  desk.add(model);
  desk.updateMatrixWorld(true);
  const parts = [];
  model.traverse((o) => { if (o.isMesh) parts.push({ mesh: o, box: new THREE.Box3().setFromObject(o) }); });
  // the top is the widest part, the rest are legs
  const area = ({ box: b }) => (b.max.x - b.min.x) * (b.max.z - b.min.z);
  parts.sort((a, b) => area(b) - area(a));
  const top = parts[0].mesh;
  const legs = parts.slice(1).map((p) => p.box);
  for (const p of parts) p.mesh.material.roughness = 0.34;   // a satin finish: the lamp and the TV show in it
  // wood: laid out by position (the model's own UVs are a stretched cube's)
  const woodMap = surface('desk_wood', 1, 1);
  for (const p of parts) {
    boxUVs(p.mesh);
    p.mesh.material.map = woodMap;
    p.mesh.material.color.set(0xffffff);
  }
  scene.add(shadowed(desk));
  colliders.push(OBB.fromBox3(new THREE.Box3().setFromObject(top)));
  return { mesh: top, top: DESK_TOP, legs };
}

// The TV: the CRT model (assets/character.blend) fitted to CRT.half's
// width, standing on its bottom with its front at +half.z, and the picture
// (CRT.screenCenter / screenHalf, set from the model's screen panel) in its
// opening.
function buildCRT(scene, colliders, models) {
  const crt = new THREE.Group();
  const { half } = CRT;
  const solids = [];
  const m = models.crt_base, b = modelBox(m), sb = modelBox(models.crt_screen);
  const s = (half.x * 2) / (b.max.x - b.min.x);
  m.scale.setScalar(s);
  m.position.set(-((b.min.x + b.max.x) / 2) * s, -half.y - b.min.y * s, half.z - b.max.z * s);
  crt.add(m);
  solids.push(m);
  // the screen panel shares the shell's origin, so it's where the opening is
  CRT.screenHalf.set(((sb.max.x - sb.min.x) / 2) * s, ((sb.max.y - sb.min.y) / 2) * s);
  CRT.screenCenter.set(m.position.x + ((sb.min.x + sb.max.x) / 2) * s, m.position.y + ((sb.min.y + sb.max.y) / 2) * s, m.position.z + sb.max.z * s + 0.001);
  CRT.back = m.position.z + b.min.z * s;
  // the jacks go in the middle of the panel set into its right side (where it is in the model)
  CRT.jacks.set(0.252, 0.2285, 0.11).multiplyScalar(s).add(m.position);
  const badge = { y: CRT.screenCenter.y - CRT.screenHalf.y - 0.017, z: half.z + 0.001, fg: '#aaa' };   // on the chin, below the screen
  const brand = label('GelatoVision™', 0.12, 0.02, { fg: badge.fg, font: 'bold italic 40px sans-serif' });
  brand.position.set(0, badge.y - 0.007, badge.z);
  crt.add(brand);
  // volume buttons, - then +, the left edge of - in line with the screen's;
  // each with a bigger invisible box to click
  const screenL = CRT.screenCenter.x - CRT.screenHalf.x, screenR = CRT.screenCenter.x + CRT.screenHalf.x;
  const [volDown, volUp] = ['−', '+'].map((sign, i) => {
    const b = new THREE.Mesh(new RoundedBoxGeometry(0.016, 0.009, 0.004, 2, 0.0018), mat(0x2c2c30, { roughness: 0.45 }));
    b.position.set(screenL + 0.008 + i * 0.022, badge.y - 0.006, badge.z);
    const glyph = label(sign, 0.007, 0.007, { w: 64, h: 64, fg: '#c8c8c8', font: 'bold 56px sans-serif' });
    glyph.position.z = 0.0021;
    b.add(glyph);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.021, 0.015, 0.01), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    b.add(hit);
    crt.add(b);
    return hit;
  });
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.004, 12), new THREE.MeshBasicMaterial({ color: 0x40ff60 }));
  led.position.set(screenR - 0.004, badge.y - 0.0065, badge.z);   // its right edge in line with the screen's, level with the buttons
  crt.add(led);
  // screen: slightly bulged plane so the glass catches reflections
  const sg = new THREE.PlaneGeometry(CRT.screenHalf.x * 2, CRT.screenHalf.y * 2, 16, 12);
  const pos = sg.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / CRT.screenHalf.x, y = pos.getY(i) / CRT.screenHalf.y;
    pos.setZ(i, 0.012 * (1 - 0.5 * (x * x + y * y)));
  }
  sg.computeVertexNormals();
  const screen = new THREE.Mesh(sg);
  screen.position.copy(CRT.screenCenter);
  crt.add(screen);
  crt.position.copy(CRT.position);
  scene.add(shadowed(crt));
  screen.castShadow = false;
  crt.updateMatrixWorld(true);
  for (const o of solids) colliders.push(OBB.fromBox3(new THREE.Box3().setFromObject(o)));
  return { group: crt, screen, led, volDown, volUp };
}

// The GelatoStation: the model's body and lid (which opens, hinged at its back
// edge), PSone-sized: STATION_W wide, so the well under the lid is just bigger
// than a 12 cm disc; standing on y = -0.025 of the group's origin. The
// disc goes on the body, under the middle of the lid. Its two buttons (power on
// the left, eject on the right, at the front corners) get invisible boxes to
// click.
function buildStation(scene, colliders, models) {
  const ps = new THREE.Group();
  const lidPivot = new THREE.Group();
  const body = models.gelatostation_body;
  const lid = models.gelatostation_lid, b = modelBox(body), lb = modelBox(lid);
  const s = STATION_W / (b.max.x - b.min.x);
  const off = new THREE.Vector3(-((b.min.x + b.max.x) / 2) * s, -0.025 - b.min.y * s, -((b.min.z + b.max.z) / 2) * s);
  body.scale.setScalar(s);
  body.position.copy(off);
  ps.add(body);
  lid.scale.setScalar(s);
  lid.position.copy(off);
  ps.add(lid);
  ps.updateMatrixWorld(true);
  // in the model the lid floats a little above the body: down onto its rim, by
  // the smallest gap between the two across the lid (rays up to the lid's
  // underside and down to the body's top)
  const lbox = new THREE.Box3().setFromObject(lid), rc = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0);
  const surface = (obj, x, z, y, dir) => { rc.set(new THREE.Vector3(x, y, z), dir); return rc.intersectObject(obj, true)[0]?.point.y; };
  let gap = Infinity;
  for (let i = 0; i <= 14; i++) {
    for (let k = 0; k <= 14; k++) {
      const x = THREE.MathUtils.lerp(lbox.min.x, lbox.max.x, i / 14), z = THREE.MathUtils.lerp(lbox.min.z, lbox.max.z, k / 14);
      const under = surface(lid, x, z, lbox.min.y - 0.05, up), top = surface(body, x, z, lbox.min.y + 0.0001, down);
      if (under !== undefined && top !== undefined) gap = Math.min(gap, under - top);
    }
  }
  if (gap > 0 && gap < 0.05) lid.position.y -= gap - 0.0003;
  // hinged at its back edge, at the bottom
  const mid = new THREE.Vector3((lbox.min.x + lbox.max.x) / 2, 0, (lbox.min.z + lbox.max.z) / 2);
  lidPivot.position.set(mid.x, lbox.min.y - Math.max(0, gap - 0.0003), lbox.min.z);
  lid.position.sub(lidPivot.position);
  lidPivot.add(lid);
  // a GelatoStation logo printed on the lid, near its front
  const logo = label('GelatoStation™', 0.07, 0.011, { fg: '#111', font: 'bold italic 40px sans-serif' });
  logo.rotation.x = -Math.PI / 2;
  // (the lid's top, after it was lowered onto the rim, in the hinge's frame)
  logo.position.set(mid.x - lidPivot.position.x, lbox.max.y - Math.max(0, gap - 0.0003) - lidPivot.position.y + 0.0004, lbox.max.z - 0.022 - lidPivot.position.z);
  lidPivot.add(logo);
  // the disc lies in the well under the lid
  const floor = surface(body, mid.x, mid.z, lbox.min.y, down) ?? b.max.y * s + off.y;
  const discSpot = new THREE.Vector3(mid.x, floor + 0.0008, mid.z);
  // where the buttons are on the model (glTF axes: x right, +z the front), on its top
  const buttons = [[-0.075, 0.0465], [0.0765, 0.0465]].map(([x, z]) => new THREE.Vector3(x * s + off.x, b.max.y * s + off.y, z * s + off.z));
  ps.add(lidPivot);
  const [power, eject] = buttons.map((at) => {
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.012, 0.026), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.position.copy(at);
    ps.add(hit);
    return hit;
  });
  ps.position.set(0.32, DESK_TOP + 0.025, -0.32);
  scene.add(shadowed(ps));
  ps.updateMatrixWorld(true);
  colliders.push(OBB.fromBox3(new THREE.Box3().setFromObject(body)));

  return { group: ps, lid: lidPivot, discSpot, power, eject };
}

// The GelatoBoy: the team's model (assets/import_fbx.py), with the game's own
// screen (the emulator's picture), power light, power switch (it slides) and
// logo in place of the model's.
function buildGelatoBoy(scene, model) {
  const gb = new THREE.Group();
  const { half } = GB;
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.0016, 12), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
  led.position.set(-0.031, GB.screenCenter.y + 0.006, half.z + 0.0012);
  gb.add(led);
  // the power switch on the top edge, left of the cartridge slot: slides left for ON
  const sw = new THREE.Mesh(new RoundedBoxGeometry(0.011, 0.005, 0.007, 2, 0.0015), mat(0x8a8a92, { roughness: 0.5 }));
  sw.position.set(-0.032, half.y + 0.0015, 0.007);
  gb.add(sw);
  const swSlot = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.003), mat(0x2a2a2e));
  swSlot.rotation.x = -Math.PI / 2;
  swSlot.position.set(-0.03, half.y + 0.0002, 0.007);
  gb.add(swSlot);
  // what you click: the whole slot, wherever the switch is in it
  const swHit = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.01, 0.014), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  swHit.position.set(-0.03, half.y + 0.002, 0.007);
  gb.add(swHit);
  const name = label('GelatoBoy™', 0.05, 0.008, { fg: '#111', font: 'bold italic 40px sans-serif' });
  name.position.set(-0.008, GB.screenCenter.y - 0.034, half.z + 0.0002);
  gb.add(name);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(GB.screenHalf.x * 2, GB.screenHalf.y * 2));
  screen.position.copy(GB.screenCenter).setZ(GB.screenCenter.z + 0.0006);
  gb.add(screen);
  // theirs are stand-ins for ours (and the screen shows the game's picture)
  // (by name: three loads "Power switch" as "Power_switch")
  model.traverse((o) => {
    const name = o.name.toLowerCase().replace(/[\s_]/g, '');
    if (['screen', 'logo', 'powerswitch'].includes(name)) o.visible = false;
    // the face buttons black and the bezel grey, over the painted green (its relief kept)
    if (o.isMesh && ['a', 'b', 'dpad'].includes(name.replace('-', ''))) o.material = blacken(o.material, 0x1a1a1e);
    if (o.isMesh && name === 'bezel') o.material = blacken(o.material, 0x6c6c72);
  });
  gb.add(model);
  // "A" and "B" printed in green on the face of their buttons
  gb.updateMatrixWorld(true);
  const inGb = new THREE.Matrix4().copy(gb.matrixWorld).invert();
  for (const key of ['A', 'B']) {
    const btn = model.getObjectByName(key);
    if (!btn) continue;
    const box = new THREE.Box3().setFromObject(btn).applyMatrix4(inGb), mid = box.getCenter(new THREE.Vector3());
    const size = Math.min(box.max.x - box.min.x, box.max.y - box.min.y) * 0.62;
    const letter = label(key, size, size, { w: 64, h: 64, fg: '#68c860', font: 'bold 56px sans-serif' });
    letter.position.set(mid.x, mid.y, box.max.z + 0.0002);
    gb.add(letter);
  }
  // their bezel stands 1 mm proud of the front: the picture and the light in front of it
  const bezelFront = new THREE.Box3().setFromObject(model.getObjectByName('Bezel') ?? model).max.z;
  screen.position.z = Math.max(screen.position.z, bezelFront + 0.0002);
  led.position.z = Math.max(led.position.z, bezelFront + 0.0002);
  shadowed(gb);
  screen.castShadow = false;
  // starts lying face-up on the desk, top pointing away from the player
  gb.rotation.x = -Math.PI / 2;
  gb.position.set(0.3, DESK_TOP + half.z + 0.0005, 0.02);
  scene.add(gb);
  let powered = false;
  return {
    group: gb, screen, led, powerSwitch: swHit,
    setPower(on) {
      powered = on;
      sw.position.x = on ? -0.034 : -0.026;
      if (!on) led.material.color.set(0x2a2a2e);
    },
    // Each frame: the power light runs round the rainbow while it's on (once every 4 s).
    update(time) {
      if (powered) led.material.color.setHSL((time / 4) % 1, 1, 0.55);
    },
  };
}

// A stepped display stand left of the CRT: one tier per game (front: game 1),
// each holding that game's cartridge on the left and its disc on the right,
// leaning back; and a holster for the zapper on its left side.
const STAND = { x: -0.62, z: -0.17, width: 0.22, depth: 0.058, rise: 0.06, base: 0.012, lean: 0.26 };

// The team's stand model (assets/export_ours.py). What bumps into it is boxes
// the shape of its tiers and its holster; the media sit on the tiers by
// STAND's numbers.
function buildStand(scene, colliders, model) {
  const group = new THREE.Group();
  group.position.set(STAND.x, DESK_TOP, STAND.z);
  group.add(model);
  scene.add(shadowed(group));
  group.updateMatrixWorld(true);
  const solid = (x0, y0, z0, x1, y1, z1) => colliders.push(OBB.fromBox3(new THREE.Box3(
    group.localToWorld(new THREE.Vector3(x0, y0, z0)), group.localToWorld(new THREE.Vector3(x1, y1, z1)))));
  // each tier, from the desk up to its top
  for (let i = 0; i < 3; i++) solid(-STAND.width / 2, 0, -STAND.depth * (i + 1), STAND.width / 2, STAND.base + i * STAND.rise, -STAND.depth * i);
  // the holster: an open-topped sleeve the zapper stands in, barrel down, on the stand's left side
  const holster = new THREE.Vector3(-STAND.width / 2 - 0.023, 0, -0.087);
  const HW = 0.042, HD = 0.046, HH = 0.08;
  solid(holster.x - HW / 2, 0, holster.z - HD / 2, holster.x + HW / 2 + 0.005, HH, holster.z + HD / 2);
  // barrel straight down into the sleeve, grip to the front
  const holstered = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, Math.PI, 0, 'YXZ'));
  const lean = new THREE.Quaternion().setFromEuler(new THREE.Euler(-STAND.lean, 0, 0));
  return {
    group,
    // Where a game's cartridge or disc (of half-size `half`) sits: {pos, quat} in world space.
    slot(kind, game, half) {
      const i = Math.min(2, Math.max(0, game - 1));
      const top = STAND.base + i * STAND.rise;
      const x = kind === 'cart' ? -0.065 : 0.042;
      // bottom edge just behind the lip, tipped back
      const c = new THREE.Vector3(0, half.y, -half.z).applyQuaternion(lean);
      const pos = new THREE.Vector3(x, top + 0.001, -STAND.depth * i - 0.007).add(c);
      const quat = group.getWorldQuaternion(new THREE.Quaternion()).multiply(lean);
      return { pos: group.localToWorld(pos), quat };
    },
    // Where the zapper stands in its holster.
    holster() {
      const pos = holster.clone().add(new THREE.Vector3(0, 0.118, 0.02));
      return { pos: group.localToWorld(pos), quat: group.getWorldQuaternion(new THREE.Quaternion()).multiply(holstered) };
    },
  };
}

// The reset button: a flat red button on a dark round base, hidden on the
// desk right under where the GelatoStation starts (only there to be found once
// it's been moved), with "Reset positions" printed in front of it. Clicking it puts every
// prop back where it started (App.resetProps), the GelatoStation over it again.
export const RESET_AT = new THREE.Vector3(0.32, DESK_TOP, -0.32);
export const RESET_CAP_Y = 0.006;
function buildResetButton(scene) {
  const g = new THREE.Group();
  g.position.copy(RESET_AT);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.021, 0.004, 24), mat(0x1c1c22, { roughness: 0.5 }));
  base.position.y = 0.002;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.014, 0.004, 24), mat(0xd8242e, { roughness: 0.35 }));
  cap.position.y = RESET_CAP_Y;
  const text = label('Reset\npositions', 0.044, 0.022, { w: 256, h: 128, fg: '#e8e2d6', font: 'bold 56px sans-serif' });
  text.rotation.x = -Math.PI / 2;
  text.position.set(0, 0.0003, 0.035);
  // what you click: a bit bigger than the button
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.06), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hit.position.set(0, 0.012, 0.008);
  g.add(base, cap, text, hit);
  for (const m of [base, cap]) { m.castShadow = true; m.receiveShadow = true; }
  scene.add(g);
  return { group: g, cap, hit };
}

export function buildScene(scene, models) {
  const colliders = [];
  const room = buildRoom(scene);
  const desk = buildDesk(scene, colliders, models.desk);
  const crt = buildCRT(scene, colliders, models);
  const station = buildStation(scene, colliders, models);
  const gb = buildGelatoBoy(scene, models.gelatoboy);
  const stand = buildStand(scene, colliders, models.display_stand);

  // room bounds as thick slabs so the GB can't be pushed through walls
  const slab = (min, max) => OBB.fromBox3(new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)));
  const { minX, maxX, minZ, maxZ, height } = ROOM;
  const roomColliders = [
    slab([minX - 1, -1, minZ - 1], [maxX + 1, 0, maxZ + 1]),
    slab([minX - 1, height, minZ - 1], [maxX + 1, height + 1, maxZ + 1]),
    slab([minX - 1, -1, minZ - 1], [maxX + 1, height + 1, minZ]),
    slab([minX - 1, -1, maxZ], [maxX + 1, height + 1, maxZ + 0.1]),
    slab([minX - 1, -1, minZ - 1], [minX, height + 1, maxZ + 1]),
    slab([maxX, -1, minZ - 1], [maxX + 1, height + 1, maxZ + 1]),
  ];

  // lighting: an evening room lit by a bare bulb hanging over the front of the
  // desk (warm, soft shadows), the light it throws round the room, and the TV's
  // own glow (a screen-shaped light coloured by what's on it; see App.updateGlow)
  scene.add(new THREE.HemisphereLight(0xc8d2ff, 0x2a1e18, 0.25));
  const LAMP = new THREE.Vector3(0, ROOM.height - 0.36, 0.45);
  const lamp = new THREE.SpotLight(0xffe2b8, 4.5, 0, 1.2, 0.9, 2);
  lamp.position.copy(LAMP);
  lamp.target.position.set(0, DESK_TOP, -0.2);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  // a tight depth range: the bias is a fraction of it, and a loose one hides
  // the shadows of things lying close to a surface
  lamp.shadow.camera.near = 0.4;
  lamp.shadow.camera.far = 4;
  lamp.shadow.bias = -0.0004;
  lamp.shadow.normalBias = 0.008;   // (less, and the stand and the media leaning on it get stripes of shadow acne)
  lamp.shadow.radius = 4;
  scene.add(lamp.target);
  // the bare bulb lights the ceiling and walls too (nothing shades it)
  const bounce = new THREE.PointLight(0xffe8cc, 0.9, 0, 2);
  // the bulb itself: round, on a socket hanging from the ceiling by its cord.
  // All of it (and its two lights) hangs from where the cord meets the ceiling,
  // so it can swing: the spotlight stays aimed at the desk.
  const rig = new THREE.Group();
  rig.position.set(LAMP.x, ROOM.height, LAMP.z);
  const drop = LAMP.y - ROOM.height;   // (the bulb, below the ceiling)
  lamp.position.set(0, drop, 0);
  bounce.position.set(0, drop + 0.05, 0);
  const top = LAMP.y + 0.085;   // where the socket starts
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, ROOM.height - top, 6), mat(0x1a1a1a));
  cord.position.set(0, (top - ROOM.height) / 2, 0);
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.019, 0.04, 16), mat(0x2a2420, { roughness: 0.4 }));
  socket.position.set(0, top - 0.02 - ROOM.height, 0);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 24, 18), new THREE.MeshBasicMaterial({ color: 0xfff1d6 }));
  bulb.position.set(0, drop, 0);
  rig.add(lamp, bounce, cord, socket, bulb);
  scene.add(rig);
  const lampSwing = swing(rig, -drop);

  // the TV's screen as a light
  RectAreaLightUniformsLib.init();
  const crtGlow = new THREE.RectAreaLight(0x8090ff, 0, CRT.screenHalf.x * 2, CRT.screenHalf.y * 2);
  crtGlow.position.copy(CRT.screenCenter).add(new THREE.Vector3(0, 0, 0.02));
  crtGlow.rotation.y = Math.PI;   // area lights shine along their -z: turn it to face out of the screen
  crt.group.add(crtGlow);

  roomColliders.front = roomColliders[3];
  const reset = buildResetButton(scene);
  return { colliders, roomColliders, room, desk, crt, station, gb, stand, reset, crtGlow, lamp, bounce, lampSwing, models };
}

// A hanging thing (rig, hanging from its origin, `length` m down to its
// weight) swinging like a pendulum, a little damped, side to side along x
// (parallel to the desk). kick(from, speed): the floor jolted by a landing at
// `from`, pushing it away from there (either way, from straight under it),
// harder the faster the landing. update(dt) moves it.
function swing(rig, length) {
  const w = Math.sqrt(9.8 / length), DAMP = 0.45;   // rad/s; 1/s
  let a = 0, v = 0;   // its tilt (about z; + swings it towards +x), and how fast
  return {
    kick(from, speed) {
      const dx = rig.position.x - from.x;
      const dir = Math.abs(dx) > 0.05 ? Math.sign(dx) : (Math.random() < 0.5 ? -1 : 1);
      v += dir * Math.min(speed, 6) * 0.11;
    },
    update(dt) {
      if (!a && !v) return;
      v += (-w * w * a - 2 * DAMP * v) * dt;
      a += v * dt;
      if (Math.abs(a) < 1e-4 && Math.abs(v) < 1e-4) a = v = 0;
      rig.rotation.z = a;
    },
  };
}

