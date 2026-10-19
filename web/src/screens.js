// Screen materials: a reflective DMG-style LCD and a shadow-mask CRT. Both
// take an emulator framebuffer (RGBA, top row first) via a DataTexture and do
// persistence (LCD ghosting / phosphor decay) on the CPU before upload.
import * as THREE from 'three';

const COMMON_GLSL = /* glsl */ `
  vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
`;

export class EmuScreen {
  constructor(width, height, persistence) {
    this.persistence = persistence; // fraction of the previous frame kept
    this.resize(width, height);
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.accum = new Float32Array(width * height * 3);
    this.pixels = new Uint8Array(width * height * 4);
    if (this.texture) this.texture.dispose();
    this.texture = new THREE.DataTexture(this.pixels, width, height, THREE.RGBAFormat);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
  }

  // Blends a new RGBA frame into the persistent image and uploads it; with
  // fresh, it replaces it outright (nothing of the old picture left).
  update(frame, width, height, fresh = false) {
    if (width !== this.width || height !== this.height) {
      this.resize(width, height);
      this.onResize?.(this.texture);
    }
    const k = fresh ? 0 : this.persistence, a = this.accum, out = this.pixels;
    for (let i = 0, j = 0; i < frame.length; i += 4, j += 3) {
      // persistence works on light emitted, so decay towards the new value only when darker
      for (let c = 0; c < 3; c++) {
        const v = frame[i + c];
        const prev = a[j + c];
        a[j + c] = v >= prev ? v * (1 - k * 0.5) + prev * k * 0.5 : v * (1 - k) + prev * k;
        out[i + c] = a[j + c];
      }
      out[i + 3] = 255;
    }
    this.texture.needsUpdate = true;
  }
}

// DMG LCD: not backlit, so it's lit by the room like any other surface (a
// standard material, so the lamp, the TV's glow, shadows and reflections all
// apply). Each pixel is a layer of ink above a grainy reflective backing:
//  - ink density comes from how dark the emulator's pixel is
//  - the grid between pixels shows the backing
//  - the ink layer casts a soft shadow down and to the right onto the backing
//  - contrast fades when the screen is seen at an angle
//  - the glass on top has a little glare
// Ghosting (slow pixel response) is done on the CPU by EmuScreen.
export function createLcdMaterial(screen) {
  // (filtered: the shader picks sharp pixels itself, evenly sized at any scale)
  screen.texture.magFilter = THREE.LinearFilter;
  const m = new THREE.MeshStandardMaterial({ map: screen.texture, roughness: 0.32, metalness: 0, envMapIntensity: 0.6 });
  // fx: 1 for the full LCD look, 0 for plain pixels (debug toggle)
  m.userData.uniforms = { texSize: { value: new THREE.Vector2(160, 144) }, fx: { value: 1 } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, m.userData.uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>
        uniform vec2 texSize;
        uniform float fx;
        float lcdHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5); }
        // how much ink a pixel has: 0 for the lightest shade, 1 for the darkest
        float lcdInk(vec2 uv) {
          vec3 c = texture2D(map, uv).rgb;
          float l = dot(c, vec3(0.299, 0.587, 0.114));
          return clamp((0.80 - l) / 0.73, 0.0, 1.0);   // lime palette: 0.80, 0.59, 0.33, 0.07
        }`)
      .replace('#include <map_fragment>', `
        vec2 luv = vec2(vMapUv.x, 1.0 - vMapUv.y);   // framebuffer row 0 is the top
        vec2 lp = luv * texSize;
        vec2 lf = fract(lp);
        // sharp pixels without the uneven widths nearest-neighbour gives at an odd
        // scale (which shows as stripes): blended only across their last screen pixel
        vec2 lfw = max(fwidth(lp), vec2(1e-4));
        vec2 lsp = floor(lp - 0.5) + 0.5 + clamp((fract(lp - 0.5) - 0.5) / lfw + 0.5, 0.0, 1.0);
        float ink = lcdInk(lsp / texSize);
        // pixels don't quite fill their cells: the gaps between them show the
        // backing (drawn until the pixels get really small on screen, where
        // it would only shimmer)
        float gw = 0.14;
        float cell = smoothstep(0.0, gw, lf.x) * smoothstep(0.0, gw, lf.y) * smoothstep(1.0, 1.0 - gw, lf.x) * smoothstep(1.0, 1.0 - gw, lf.y);
        // (gone well before a pixel's under ~3 screen pixels: at that size the gaps alias into big bands)
        float resolve = 1.0 - smoothstep(0.22, 0.4, max(lfw.x, lfw.y));
        cell = mix(0.82, cell, resolve);
        // the shadow the ink casts on the backing (offset down-right, blurred)
        vec2 sh = vec2(0.45, 0.55) / texSize;
        float shadow = (lcdInk(luv - sh) * 0.5 + lcdInk(luv - sh * 1.6) * 0.3 + lcdInk(luv - sh * 0.6) * 0.2);
        // at an angle the polariser loses contrast
        float facing = clamp(dot(normalize(vViewPosition), normalize(vNormal)), 0.0, 1.0);   // (vViewPosition points at the eye)
        float contrast = mix(0.45, 1.0, smoothstep(0.1, 0.8, facing));
        float grain = 1.0 - smoothstep(0.3, 0.6, max(fwidth(luv.x), fwidth(luv.y)) * 512.0);   // (fine grain fades when it'd alias)
        vec3 backing = vec3(0.40, 0.52, 0.15) * (0.94 + 0.06 * mix(0.5, lcdHash(floor(luv * 512.0)), grain));
        vec3 inkColor = vec3(0.03, 0.06, 0.03);
        vec3 lcd = backing * (1.0 - shadow * 0.32 * contrast);
        // even switched off, a pixel tints the backing a little: the grid is always faintly there
        lcd = mix(lcd, inkColor, (0.06 + ink * 0.88) * cell * contrast);
        diffuseColor.rgb = fx > 0.5 ? lcd : mix(backing, inkColor, ink * 0.94);`);
  };
  m.customProgramCacheKey = () => 'lcd-dmg';
  return m;
}

// CRT: barrel curvature, Gaussian beam scanlines that widen with brightness,
// an aperture-grille mask, cheap bloom/halation, vignette and glass reflection.
export function createCrtMaterial(screen) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tex: { value: screen.texture },
      texSize: { value: new THREE.Vector2(320, 240) },
      time: { value: 0 },
      power: { value: 1 },
      snow: { value: 0 },                          // no signal: static instead of the picture
      squash: { value: new THREE.Vector2(1, 1) },  // the picture collapsing to a line and a dot (power off)
      flash: { value: 0 },                         // ... which glows white-hot as it does
      env: { value: null },                        // the room, seen from the TV (for reflections in the glass)
      envAmount: { value: 0.1 },                   // how much of it shows (more with the picture off)
      fx: { value: 1 },                            // 0: just the picture (debug toggle)
      bands: { value: 0 },                         // 1: sound in the video jack (faint pulsing bands)
      bandLevel: { value: 0 },                     // ... how loud it is
      osd: { value: new THREE.DataTexture(new Uint8Array(4), 1, 1) },   // the TV's own on-screen display (RGBA, over the picture)
      osdOn: { value: 0 },                         // ... how much of it shows
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vViewPos;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = mv.xyz;
        vNormal = normalize(normalMatrix * normal);
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D osd;
      uniform float osdOn;
      uniform sampler2D tex;
      uniform vec2 texSize;
      uniform float time;
      uniform samplerCube env;
      uniform float envAmount;
      uniform float fx;
      uniform float bands;
      uniform float bandLevel;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      uniform float power;
      uniform float snow;
      uniform vec2 squash;
      uniform float flash;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      varying vec2 vUv;
      varying vec3 vViewPos;
      varying vec3 vNormal;
      ${COMMON_GLSL}
      vec2 curve(vec2 uv) {
        uv = uv * 2.0 - 1.0;
        vec2 off = abs(uv.yx) / vec2(6.0, 4.8);
        uv += uv * off * off;
        return uv * 0.5 + 0.5;
      }
      vec3 picture(vec2 uv) {
        if (bands > 0.5) {
          // an audio signal read as video: no sync, just faint wavering bars
          float y = uv.y * 18.0 + time * (3.0 + bandLevel * 9.0);
          float b = 0.5 + 0.5 * sin(y + sin(uv.y * 5.0 + time * 1.7) * 2.0);
          return vec3(0.015 + b * b * (0.025 + bandLevel * 0.12));
        }
        if (snow > 0.5) {
          // static: noise per (blurry) dot, rolling bands
          vec2 cell = floor(uv * vec2(texSize.x * 0.75, texSize.y));
          float n = hash(cell + floor(time * 60.0) * vec2(17.0, 31.0));
          float band = 0.85 + 0.15 * sin(uv.y * 9.0 - time * 3.0);
          return vec3(n * n * band * 0.8);
        }
        // flip: framebuffer row 0 is the top
        return toLinear(texture2D(tex, vec2(uv.x, 1.0 - uv.y)).rgb);
      }
      // the picture with the TV's on-screen display over it (so it gets the tube's look too)
      vec3 fetch(vec2 uv) {
        vec3 c = picture(uv);
        if (osdOn > 0.0) {
          vec4 o = texture2D(osd, uv);
          c = mix(c, toLinear(o.rgb), o.a * osdOn);
        }
        return c;
      }
      void main() {
        if (fx < 0.5) {
          gl_FragColor = vec4(fetch(vec2(vUv.x, vUv.y)) * power, 1.0);
          #include <colorspace_fragment>
          return;
        }
        vec2 guv = curve(vUv);
        // powering off: the picture is squashed towards the middle of the tube
        vec2 uv = (guv - 0.5) / max(squash, vec2(0.002)) + 0.5;
        float lit = step(abs(guv.x - 0.5), 0.5 * squash.x + 0.002) * step(abs(guv.y - 0.5), 0.5 * squash.y + 0.002);
        vec3 v = normalize(-vViewPos);
        float fres = pow(1.0 - max(dot(v, vNormal), 0.0), 3.0);
        // the glass reflects the room: the tube bulges, so the reflection bends
        // towards the edges (and the reflection is a little soft and greyish)
        vec3 wn = normalize(vWorldNormal + vec3((vUv.x - 0.5) * 0.5, (vUv.y - 0.5) * 0.4, 0.0));
        vec3 wv = normalize(vWorldPos - cameraPosition);
        vec3 r = reflect(wv, wn);
        vec3 room = textureCube(env, vec3(-r.x, r.y, r.z)).rgb;   // (render targets are linear already)
        vec3 glass = vec3(0.025, 0.028, 0.03) + room * (envAmount + 0.5 * fres) + vec3(0.06) * fres;
        // rounded tube corners
        vec2 cq = abs(guv - 0.5) * 2.0;
        vec2 cr = max(cq - (1.0 - 0.06), 0.0) / 0.06;
        float edge = 1.0 - smoothstep(0.85, 1.0, length(cr));
        if (edge <= 0.0) {
          gl_FragColor = vec4(glass, 1.0);
          #include <colorspace_fragment>
          return;
        }
        // horizontal beam softness + slight convergence error
        vec2 dx = vec2(0.6 / texSize.x, 0.0);
        float line = uv.y * texSize.y;
        vec2 suv = vec2(uv.x, (floor(line) + 0.5) / texSize.y);
        vec3 c;
        c.r = (fetch(suv + dx * 0.7).r * 2.0 + fetch(suv - dx + dx * 0.7).r + fetch(suv + dx + dx * 0.7).r) * 0.25;
        c.g = (fetch(suv).g * 2.0 + fetch(suv - dx).g + fetch(suv + dx).g) * 0.25;
        c.b = (fetch(suv - dx * 0.7).b * 2.0 + fetch(suv - dx - dx * 0.7).b + fetch(suv + dx - dx * 0.7).b) * 0.25;
        // Gaussian scanline: brighter lines bloom wider. Fades to its average
        // once a scanline is smaller than ~2 screen pixels, to avoid moire.
        float d = fract(line) - 0.5;
        vec3 width = mix(vec3(18.0), vec3(6.0), sqrt(c));
        float scanAmt = 1.0 - smoothstep(0.3, 0.6, fwidth(line));
        vec3 beam = mix(vec3(0.85), exp(-d * d * width) * 1.35, scanAmt);
        vec3 col = c * beam;
        // aperture grille (vertical RGB stripes), likewise only when resolvable
        float mx = uv.x * texSize.x * 1.5;
        float maskAmt = 0.35 * (1.0 - smoothstep(0.15, 0.35, fwidth(mx)));
        float m = fract(mx);
        vec3 mask = vec3(
          smoothstep(0.0, 0.2, m) * smoothstep(0.45, 0.25, m),
          smoothstep(0.25, 0.45, m) * smoothstep(0.75, 0.55, m),
          max(smoothstep(0.55, 0.75, m), smoothstep(0.2, 0.0, m))
        );
        col *= mix(vec3(1.0), mask * 2.2, maskAmt);
        // halation: wide blur of the surrounding area
        vec3 glow = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.785398;
          glow += fetch(uv + vec2(cos(a), sin(a)) * vec2(3.0, 3.0) / texSize);
        }
        col += glow / 8.0 * 0.18;
        // vignette, flicker and power-on brightness
        // (clamped: a collapsed picture's uv runs far outside 0..1, and pow() of a
        // negative number is NaN, which left a black cross on the switched-off tube)
        vec2 q = max(uv * (1.0 - uv), 0.0);
        col *= pow(q.x * q.y * 16.0, 0.08);
        col *= 1.0 + sin(time * 377.0) * 0.01;
        // a collapsing picture glows hotter and hotter; a dot fades out slowly
        col = mix(col, vec3(1.6, 1.6, 1.7), flash) * lit;
        col *= power * edge;
        col += glass;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    toneMapped: false,
  });
}
