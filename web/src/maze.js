// Behind the room's front wall: a maze you can only see through the
// Virtualato, and at the end of it a real room with a link port in the far
// wall. You walk into the maze through the front wall where its entrance is.
//
// Walls are described three ways: 2D rectangles that stop the camera, boxes
// for the cables and the carried GB to bump into, and boxes the Virtualato
// draws as a wireframe.
import * as THREE from 'three';
import { ROOM, surface } from './scene.js';
import { OBB } from './collision.js';

export const MAZE = { x0: -2.4, z0: ROOM.maxZ, cell: 0.8, cols: 6, rows: 8, entrance: 3, exit: 2 };
MAZE.x1 = MAZE.x0 + MAZE.cols * MAZE.cell;
MAZE.z1 = MAZE.z0 + MAZE.rows * MAZE.cell;
export const END_ROOM = { minX: -1.5, maxX: 1.5, minZ: MAZE.z1, maxZ: MAZE.z1 + 2.5, height: ROOM.height };
const T = 0.05;           // wall thickness
const DOOR_H = 1.6;   // (well below the 2.6 m ceiling, so the doorways stand out)
const TRAY_Y = 0.912;   // the tray beside the port (and the slot it comes out of)
export const PORT_Y = TRAY_Y;   // the port, level with it

// The maze, from above as you walk in from the room: the entrance at the
// bottom, the way out to the end room at the top, and (so it reads the way
// you see it walking in) the room's +x on the left. Picked from a batch of
// generated ones for its long, turning route with deep dead ends off it.
const LAYOUT = `
+--+--+--+  +--+--+
|                 |
+  +--+--+--+--+--+
|        |        |
+--+  +  +  +--+--+
|  |  |  |  |     |
+  +  +  +  +  +--+
|     |     |     |
+--+--+--+  +--+  +
|  |              |
+  +  +--+--+--+  +
|  |     |     |  |
+  +--+--+--+  +  +
|  |        |     |
+  +  +--+--+--+  +
|                 |
+--+--+  +--+--+--+
`;

// walls[c][r] = { e, n }: whether cell (c, r) has a wall on its east (+x) and
// north (+z) sides, read from LAYOUT (where column c is drawn cols - 1 - c
// from the left, and row r is rows - 1 - r from the top).
function parse(layout) {
  const { cols, rows } = MAZE, lines = layout.trim().split('\n');
  return Array.from({ length: cols }, (_, c) => Array.from({ length: rows }, (_, r) => {
    const k = cols - 1 - c, top = lines[(rows - 1 - r) * 2], mid = lines[(rows - 1 - r) * 2 + 1];
    // (east of c is the west of the cell drawn to its left)
    return { e: c < cols - 1 && mid[k * 3] === '|', n: top[k * 3 + 1] === '-' };
  }));
}

// Open neighbours of a cell.
function neighbours(walls, c, r) {
  const { cols, rows } = MAZE, out = [];
  if (c + 1 < cols && !walls[c][r].e) out.push([c + 1, r]);
  if (c > 0 && !walls[c - 1][r].e) out.push([c - 1, r]);
  if (r + 1 < rows && !walls[c][r].n) out.push([c, r + 1]);
  if (r > 0 && !walls[c][r - 1].n) out.push([c, r - 1]);
  return out;
}

// How good a maze is: the route's length, and how many times along it you
// have to choose between ways that go somewhere (at least a few cells).
export function mazeStats(walls) {
  const { rows } = MAZE, key = (c, r) => c * rows + r;
  const prev = new Map([[key(MAZE.entrance, 0), null]]), q = [[MAZE.entrance, 0]];
  while (q.length) {
    const [c, r] = q.shift();
    for (const [x, y] of neighbours(walls, c, r)) if (!prev.has(key(x, y))) { prev.set(key(x, y), [c, r]); q.push([x, y]); }
  }
  const path = [];
  for (let at = [MAZE.exit, rows - 1]; at; at = prev.get(key(...at))) path.unshift(at);
  const onPath = new Set(path.map(([c, r]) => key(c, r)));
  // cells reachable from (c, r) without going back onto the route
  const branchSize = (c, r) => {
    const seen = new Set([key(c, r)]), st = [[c, r]];
    while (st.length && seen.size < 12) {
      const [x, y] = st.pop();
      for (const [u, v] of neighbours(walls, x, y)) if (!onPath.has(key(u, v)) && !seen.has(key(u, v))) { seen.add(key(u, v)); st.push([u, v]); }
    }
    return seen.size;
  };
  let choices = 0;
  for (const [c, r] of path) {
    const side = neighbours(walls, c, r).filter(([x, y]) => !onPath.has(key(x, y)));
    choices += side.filter(([x, y]) => branchSize(x, y) >= 3).length;
  }
  return { path, choices };
}

// Wall segments [x0, z0, x1, z1] (axis-aligned lines), merged where they continue.
function segments(walls) {
  const { x0, z0, cell, cols, rows } = MAZE;
  const h = [], v = [];   // horizontal (along x) by z line, vertical (along z) by x line
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const cx = x0 + c * cell, cz = z0 + r * cell;
      // north side; the top row's north is the far boundary, open at the exit and
      // shared with the end room's near wall where they meet
      if (walls[c][r].n && !(r === rows - 1 && c === MAZE.exit)) h.push([cx, cz + cell, cx + cell, cz + cell]);
      if (walls[c][r].e && c < cols - 1) v.push([cx + cell, cz, cx + cell, cz + cell]);
    }
  }
  for (let r = 0; r < rows; r++) {
    v.push([x0, z0 + r * cell, x0, z0 + (r + 1) * cell]);
    v.push([x0 + cols * cell, z0 + r * cell, x0 + cols * cell, z0 + (r + 1) * cell]);
  }
  const merge = (list, along) => {
    const key = (s) => (along === 'x' ? s[1] : s[0]).toFixed(3);
    const groups = {};
    for (const s of list) (groups[key(s)] ??= []).push(s);
    const out = [];
    for (const g of Object.values(groups)) {
      g.sort((a, b) => (along === 'x' ? a[0] - b[0] : a[1] - b[1]));
      let cur = g[0].slice();
      for (const s of g.slice(1)) {
        const end = along === 'x' ? cur[2] : cur[3], start = along === 'x' ? s[0] : s[1];
        if (Math.abs(start - end) < 1e-6) { if (along === 'x') cur[2] = s[2]; else cur[3] = s[3]; } else { out.push(cur); cur = s.slice(); }
      }
      out.push(cur);
    }
    return out;
  };
  return [...merge(h, 'x'), ...merge(v, 'z')];
}

// A wall segment as a rectangle {x0, z0, x1, z1} with thickness.
const rect = ([ax, az, bx, bz], t = T) => ({
  x0: Math.min(ax, bx) - t / 2, x1: Math.max(ax, bx) + t / 2, z0: Math.min(az, bz) - t / 2, z1: Math.max(az, bz) + t / 2,
});
const box3 = (r, y0, y1) => new THREE.Box3(new THREE.Vector3(r.x0, y0, r.z0), new THREE.Vector3(r.x1, y1, r.z1));

// LCD look for walls once the GB is plugged into the port: a wave of GB
// screen spreading out from the port. Patched into the standard material.
export function gbWave(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGbWorld;\nvarying vec3 vGbNormal;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vGbWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vGbNormal = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGbWorld;
        varying vec3 vGbNormal;
        uniform vec3 gbOrigin;
        uniform float gbRadius;
        uniform float gbTime;`)
      // inside the wave the wall is a GB screen: big pixels just visible against
      // the grainy backing, each casting a faint shadow down and to the right.
      // It isn't lit by the room: it glows evenly, as though reality had gone.
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        {
          float gbD = distance(vGbWorld, gbOrigin);
          if (gbD < gbRadius) {
            vec3 gbAn = abs(vGbNormal);
            vec2 gbP = (gbAn.x > gbAn.y && gbAn.x > gbAn.z ? vGbWorld.zy : gbAn.y > gbAn.z ? vGbWorld.xz : vGbWorld.xy) / 0.04;
            vec2 f = fract(gbP);
            float cell = smoothstep(0.0, 0.08, f.x) * smoothstep(0.0, 0.08, f.y) * smoothstep(1.0, 0.92, f.x) * smoothstep(1.0, 0.92, f.y);
            vec2 fs = fract(gbP - vec2(0.12, -0.14));
            float shadowCell = smoothstep(0.0, 0.1, fs.x) * smoothstep(0.0, 0.1, fs.y) * smoothstep(1.0, 0.9, fs.x) * smoothstep(1.0, 0.9, fs.y);
            float resolve = 1.0 - smoothstep(0.6, 1.1, max(fwidth(gbP.x), fwidth(gbP.y)));
            float grain = fract(sin(dot(floor(gbP * 8.0), vec2(41.3, 289.1))) * 45758.5);
            vec3 lit = vec3(0.565, 0.73, 0.26) * (0.96 + 0.04 * grain);   // the screen's lightest shade
            float off = mix(0.06, 0.08 * cell + 0.06 * shadowCell * (1.0 - cell), resolve);
            vec3 lcd = lit * (1.0 - off);
            // the grid between the pixels is alive: pulses of light run out along
            // it from the port, over a slow glow (the pixels themselves stay put)
            float gbPulse = pow(0.5 + 0.5 * sin(gbD * 5.0 - gbTime * 3.5), 6.0);
            float gbGlow = 0.12 + 0.08 * sin(gbTime * 1.3);
            lcd += vec3(0.42, 0.62, 0.12) * (1.0 - cell) * resolve * (gbGlow + 0.75 * gbPulse);
            // the wave front glows as it goes
            lcd += vec3(0.5, 0.6, 0.2) * smoothstep(0.35, 0.0, gbRadius - gbD);
            gl_FragColor.rgb = lcd;
          }
        }`);
  };
  material.needsUpdate = true;
}

export function buildMaze(scene) {
  const walls = parse(LAYOUT);
  const segs = segments(walls);
  const H = ROOM.height;
  const blockers = segs.map((s) => rect(s));     // stop the camera
  const solids = blockers.map((r) => OBB.fromBox3(box3(r, 0, H)));
  // (drawn, the far wall is one piece straight across the exit, so its ends
  // don't make lines either side of the doorway: the door's frame shows the way)
  const far = segs.filter(([, az, , bz]) => Math.abs(az - MAZE.z1) < 1e-6 && Math.abs(bz - MAZE.z1) < 1e-6);
  const drawn = [...segs.filter((s) => !far.includes(s)),
    [Math.min(...far.map((s) => s[0])), MAZE.z1, Math.max(...far.map((s) => s[2])), MAZE.z1]];
  const wire = drawn.map((s) => ({ type: 'wall', box: box3(rect(s, 0.001), 0, H) }));

  // the end room: real, lit, visible with or without the Virtualato
  const R = END_ROOM;
  const group = new THREE.Group();
  const waveUniforms = { gbOrigin: { value: new THREE.Vector3() }, gbRadius: { value: 0 }, gbTime: { value: 0 } };
  // the same walls, floor and ceiling as the room you came from (one tile a metre: see plane)
  const wallMat = new THREE.MeshStandardMaterial({ map: surface('wall_paint'), roughness: 0.95, side: THREE.DoubleSide });
  const floorMat = new THREE.MeshStandardMaterial({ map: surface('floor_boards'), roughness: 0.8 });
  const ceilMat = new THREE.MeshStandardMaterial({ map: surface('ceiling_plaster'), side: THREE.DoubleSide });
  for (const m of [wallMat, floorMat, ceilMat]) gbWave(m, waveUniforms);
  const w = R.maxX - R.minX, d = R.maxZ - R.minZ, cx = (R.minX + R.maxX) / 2, cz = (R.minZ + R.maxZ) / 2;
  const plane = (pw, ph, m, pos, rot) => {
    const geo = new THREE.PlaneGeometry(pw, ph), uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * pw, uv.getY(i) * ph);   // (UVs in metres)
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  plane(w, d, floorMat, [cx, 0, cz], [-Math.PI / 2, 0, 0]);
  plane(w, d, ceilMat, [cx, H, cz], [Math.PI / 2, 0, 0]);
  plane(w, H, wallMat, [cx, H / 2, R.maxZ], [0, Math.PI, 0]);
  plane(d, H, wallMat, [R.minX, H / 2, cz], [0, Math.PI / 2, 0]);
  plane(d, H, wallMat, [R.maxX, H / 2, cz], [0, -Math.PI / 2, 0]);
  // near wall with a doorway where the maze comes in
  const dx0 = MAZE.x0 + MAZE.exit * MAZE.cell + 0.1, dx1 = dx0 + MAZE.cell - 0.2;
  plane(dx0 - R.minX, H, wallMat, [(R.minX + dx0) / 2, H / 2, R.minZ], [0, 0, 0]);
  plane(R.maxX - dx1, H, wallMat, [(dx1 + R.maxX) / 2, H / 2, R.minZ], [0, 0, 0]);
  plane(dx1 - dx0, H - DOOR_H, wallMat, [(dx0 + dx1) / 2, (H + DOOR_H) / 2, R.minZ], [0, 0, 0]);
  // ... which seals once the GB has escaped reality
  const door = plane(dx1 - dx0, DOOR_H, wallMat, [(dx0 + dx1) / 2, DOOR_H / 2, R.minZ], [0, 0, 0]);
  door.visible = false;
  const lamp = new THREE.PointLight(0xfff0e0, 1.2, 6, 1.5);
  lamp.position.set(cx, H - 0.3, cz);
  group.add(lamp);

  // the port: a panel on the far wall
  const port = new THREE.Group();
  port.position.set(0, PORT_Y, R.maxZ - 0.01);
  port.rotation.y = Math.PI;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.02), new THREE.MeshStandardMaterial({ color: 0x9a9aa2, roughness: 0.5 }));
  port.add(panel);
  group.add(port);
  // a tray beside the port, inside the wall until you've escaped reality
  const trayMat = new THREE.MeshStandardMaterial({ color: 0x9a9aa2, roughness: 0.5 });
  const tray = new THREE.Group();
  const trayIn = R.maxZ + 0.07, trayOut = R.maxZ - 0.065;
  tray.position.set(0.3, TRAY_Y, trayIn);   // (low enough in the slot that the cartridge on it clears its top)
  tray.visible = false;   // nothing to see of it until it comes out
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.008, 0.13), trayMat);
  tray.add(base);
  for (const sx of [-1, 1]) {
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.012, 0.13), trayMat);
    lip.position.set(sx * 0.048, 0.008, 0);
    tray.add(lip);
  }
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.016, 0.004), trayMat);
  front.position.set(0, 0.004, -0.063);
  tray.add(front);
  group.add(tray);
  const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.03), new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 0.9 }));
  slot.position.set(0.3, TRAY_Y + 0.007, R.maxZ - 0.002);
  slot.rotation.y = Math.PI;
  slot.visible = false;
  group.add(slot);
  scene.add(group);
  group.updateMatrixWorld(true);

  // end room walls stop the camera too (leaving the doorway)
  const roomRects = [
    { x0: R.minX, x1: R.maxX, z0: R.maxZ, z1: R.maxZ + 0.1 },
    { x0: R.minX - 0.1, x1: R.minX, z0: R.minZ, z1: R.maxZ },
    { x0: R.maxX, x1: R.maxX + 0.1, z0: R.minZ, z1: R.maxZ },
    { x0: R.minX, x1: dx0, z0: R.minZ - T / 2, z1: R.minZ + T / 2 },
    { x0: dx1, x1: R.maxX, z0: R.minZ - T / 2, z1: R.minZ + T / 2 },
  ];
  blockers.push(...roomRects);
  solids.push(...roomRects.map((r) => OBB.fromBox3(box3(r, 0, H))));
  solids.push(OBB.fromBox3(new THREE.Box3(new THREE.Vector3(R.minX, -1, R.minZ), new THREE.Vector3(R.maxX, 0, R.maxZ))));
  solids.push(OBB.fromBox3(new THREE.Box3().setFromObject(panel)));
  wire.push({ type: 'room', box: new THREE.Box3(new THREE.Vector3(R.minX, 0, R.minZ), new THREE.Vector3(R.maxX, H, R.maxZ)) });
  wire.push({ type: 'box', object: panel });
  const doorRect = { x0: dx0, x1: dx1, z0: R.minZ - T / 2, z1: R.minZ + T / 2 };

  // the gap in the room's front wall you walk through into the maze
  const ex0 = MAZE.x0 + MAZE.entrance * MAZE.cell + 0.1, ex1 = ex0 + MAZE.cell - 0.2;
  const entranceRect = { x0: ex0, x1: ex1, z0: ROOM.maxZ - 0.05, z1: ROOM.maxZ + 0.05 };
  // ... and both doorways, as frames the Virtualato draws
  const frame = (x0, x1, z) => ({ type: 'door', box: box3({ x0, x1, z0: z - 0.0005, z1: z + 0.0005 }, 0, DOOR_H) });
  wire.push(frame(ex0, ex1, ROOM.maxZ), frame(dx0, dx1, R.minZ));

  return {
    group, port, door, doorRect, entranceRect, blockers, solids, wire, waveUniforms,
    tray, trayIn, trayOut, slot,
    // Where the cartridge sits on the tray.
    traySpot() {
      tray.updateMatrixWorld();
      return tray.localToWorld(new THREE.Vector3(0, 0.004 + 0.004, 0.005));
    },
    // ... and where that is with the tray all the way out
    traySpotOut() {
      group.updateMatrixWorld();
      return group.localToWorld(new THREE.Vector3(tray.position.x, tray.position.y + 0.008, trayOut + 0.005));
    },
    walls, segs, layout: MAZE,
    // Is a point inside the maze or the end room (i.e. out of the starting room)?
    contains(p) { return p.z > ROOM.maxZ; },
  };
}
