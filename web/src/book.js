// The manual: "How to Operate Your Gelato", a little booklet lying on the
// left of the desk in front of the display stand, with a hint on every page.
// Click the cover to open it; then the right-hand page turns on to the next,
// the left-hand one back (the inside of the cover closes it). It won't open
// with the Virtualato sitting on it.
import * as THREE from 'three';
import { DESK_TOP } from './scene.js';
import { OBB } from './collision.js';

const W = 0.105, H = 0.148;              // A6
const BOARD = 0.0012, SHEET = 0.0004;    // the covers' card, a page's paper
const TURN = 0.5;                        // s to turn a page
const SEGS = 16;                         // a leaf bends at this many places as it turns
const LAG = { paper: 0.2, card: 0.03 };  // how far (of the turn) the spine end lags behind the free edge
const LIFT = 0.4;                        // s to pick it up to read, or put it down
const UPRIGHT = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));   // lying flat -> facing the camera
const RES = 2;                           // the pages' pictures are drawn at this many times PX, to read up close
const PX = [384, 541];                   // a page's picture
// (in the cover's style: white, black type and rules, its logo's green)
const PAPER = '#ffffff', INK = '#111111', GREY = '#666666', ACCENT = '#53fe00';
// where it lies: its middle (closed), in front of the display stand with room
// on its left to open, and turned a little towards you
export const BOOK_AT = new THREE.Vector3(-0.58, DESK_TOP, 0.06);
const YAW = 0.12;

// The booklet's text: the warning inside the front cover, then the pages,
// each [section, title, text] (no title: the section's name is the title too).
// In the text, a blank line starts a paragraph, "1. " a numbered step,
// <s>…</s> and <bi>…</bi> strike through and bold-italicise, and ICON is the
// power symbol. Text too long for a page carries on over the next.
const ICON = '\u23FB';
const WARNING = ['Warning!!!', 'Thank you for choosing Gelato.\n\nFor maximum enjoyment of your Gelato products:\n'
  + '1. Connect your input device of choice (mouse+keyboard, gamepad, or touchscreen).\n2. Enter fullscreen or WebXR.\n3. Close this booklet.\n\n'
  + 'Should you experience confusion, technical difficulties, or lack of common sense while operating your Gelato, please re-open this booklet and read on.'];
export const PAGES = [
  ['Getting Started', 'Turning it on and on again', 'Before you can begin your Gelato experience, you will need to power on your Gelato systems.\n\n'
    + `1. Press the ${ICON} power button on the top of your GelatoStation™, near the front-left.\n2. Press the power switch on the top of your GelatoBoy™, near the left.\n\n`
    + 'You can use the - and + buttons on your GelatoVision™ to adjust the volume.'],
  ['Getting Started', 'Controlling yourself and your Gelato', 'Please refer to the complimentary poster included with your Gelato purchase for controls.\n\n'
    + 'This digital poster updates automatically to show the controls for your current input device. Just another remarkable innovation from Gelato Labs.\n\n'
    + 'You can move yourself around the room, as well as moving the player character in various Gelato games.\n\n'
    + 'Exercise caution: using the wrong movement controls may result in injury.'],
  ['Link Cable', 'The Gelato Link Cable', 'Each Gelato game includes one GelatoBoy™ cartridge and one GelatoStation™ disc. Remember to keep the matching games inserted, and the Link Cable connected, to play.\n\n'
    + 'Our advanced Link Cable technology allows your GelatoVision™ display to track the relative position of your GelatoBoy™ system.\n\n'
    + 'By holding your GelatoBoy™ in front of the GelatoVision™, your player character may walk in between the two displays.'],
  ['Rocky Road Trip', null, 'In this puzzle platformer, you must guide your hero to the tasty Gelato treat in each level.\n\n'
    + 'Hold your GelatoBoy™ in front of the GelatoVision™ such that two platforms are aligned, from your own perspective. Your hero can then walk across the platforms to move between the GelatoBoy™\'s display and the GelatoVision™.\n\n'
    + 'Try moving the GelatoBoy™ to different positions in order to solve the puzzles.\n\n'
    + 'Completing all 6 levels will reward you with the next Gelato game in the collection.'],
  ['Vanilla Fighter II.5', null, 'In this fighting game, you can take the fight between the GelatoBoy™ and GelatoVision™ to maneuver around your opponent.\n\n'
    + 'Please refer to the poster included with Vanilla Fighter II.5 for a full list of moves.\n\n'
    + 'Gelato Blast fires a projectile which can travel between the displays, even across a gap.\n\n'
    + 'Executing a perfect backflip will no doubt leave your opponent stunned in amazement. This can be a good opportunity to move between screens.\n\n'
    + 'Winning 2/3 rounds will reward you with the next Gelato game in the collection.'],
  ['License to Chill', null, 'In this shooter, you must defend both displays from waves of enemies.\n\n'
    + 'Pick up the GelatoBlaster™ (found on the left side of your desk) and shoot the START button on your GelatoVision™ to play.\n\n'
    + 'Surviving all 5 waves will reward you with the very latest in Gelato display technology.'],
  ['Virtualato', 'The Gelato Virtualato™ Head-Mounted Display', 'This experimental and highly <s>dangerous</s> entertaining augmented reality system allows you to experience your world in glorious Gelato Green wireframe.\n\n'
    + 'It can even see through walls! Who knows what you\'ll find?\n\n'
    + 'Please remove your Virtualato™ before operating your other Gelato systems.'],
  ['Virtualato', 'Escaping Reality', 'Some customers have expressed such love for the Gelato ecosystem that they wish to live inside it.\n\n'
    + 'At Gelato Labs, we believe customer satisfaction is even more important than health, safety, and physics.\n\n'
    + 'We have therefore upgraded the Gelato Link Cable to interface with the fabric of reality itself. Simply bring your GelatoBoy™ to a reality port, then <bi>Plug and Pray</bi>!'],
  ['Troubleshooting', 'No power', 'Should your GelatoStation™ refuse to power on, please ensure its power cord is connected from the round socket on its back to the wall outlet.\n\n'
    + 'Your GelatoVision™ requires its own connection to the wall outlet.'],
  ['Troubleshooting', 'No picture', 'Your GelatoStation™ sends its picture to the GelatoVision™ through the AV cable, from the back of the GelatoStation™ to the jacks on the side of the GelatoVision™.\n\n'
    + 'The YELLOW plug carries the picture. Please ensure it is in the YELLOW jack.'],
  ['Troubleshooting', 'Unusual sounds', 'Should the left and right of your sound appear to be swapped, please swap the WHITE and RED plugs.\n\n'
    + 'Should you hear a loud buzzing, the YELLOW plug is in a sound jack. Gelato Labs recommends against listening to pictures.'],
  ['Troubleshooting', '"CONNECT GELATOBOY"', 'Gelato games require both systems. Please ensure the Link Cable is connected from the right side of your GelatoBoy™ to the port on the front-left of your GelatoStation™.\n\n'
    + 'Disconnecting the Link Cable while playing will stop the game until it is reconnected.'],
  ['Troubleshooting', 'Catastrophe', 'Wires tangled beyond repair? Dropped your GelatoStation™ off the table and now your GelatoBoy™ doesn\'t reach the screen?\n\n'
    + 'Press the Reset button, conveniently located under the GelatoStation™, to put things back in place.\n\n'
    + 'If all else fails, refresh the page.'],
  ['Cheats', null, 'Gelato Labs does not condone cheating.\n\n'
    + 'However, should you enter ↑ ↑ ↓ ↓ ← → ← → B A, all Gelato games and peripherals will be unlocked.\n\n'
    + 'Your own progress will be restored when you reload the page.'],
];

function canvas() {
  const c = document.createElement('canvas');
  c.width = PX[0] * RES;
  c.height = PX[1] * RES;
  return c;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const TITLE = '"Times New Roman", Times, serif';   // (the cover's title)
const SERIF = 'Georgia, "DejaVu Serif", serif';    // (its list)
const M = 40;                                      // the cover's margins
const RULE_TOP = 62, RULE_FOOT = 470;

const TEXT_TOP = 162, TEXT_BOTTOM = RULE_FOOT - 18;   // where a page's text goes (baselines)

// Styles in the text: <s>struck through</s> and <bi>bold italic</bi> (they can
// run over a line break). A line of it as runs [{ text, style }], from the
// style it starts in, and the style it ends in.
const STYLE_TAG = /<(\/?)(s|bi)>/g;
function runs(text, style = '') {
  const out = [];
  let at = 0;
  for (const m of text.matchAll(STYLE_TAG)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index), style });
    style = m[1] ? '' : m[2];
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), style });
  return { runs: out, style };
}
const fontFor = (style, size) => `${style === 'bi' ? 'italic 700' : '400'} ${size}px ${SERIF}`;

// A line's width at size (starting in style), with its power symbols (each a square of the font's size).
function measure(g, text, size, style = '') {
  let w = 0;
  for (const r of runs(text, style).runs) {
    g.font = fontFor(r.style, size);
    const parts = r.text.split(ICON);
    w += parts.reduce((a, part) => a + g.measureText(part).width, 0) + (parts.length - 1) * size;
  }
  g.font = fontFor('', size);
  return w;
}

// A text laid out at size, PX[0] - 2M wide: [{ y, x, text, num }] (y from the
// first baseline; num: a numbered step's number, hanging left of its text),
// and how tall it is. Its paragraphs are kept apart, for splitting it.
function layout(g, text, size) {
  g.font = `400 ${size}px ${SERIF}`;
  const lead = Math.round(size * 1.4), width = PX[0] - 2 * M, paras = [];
  let y = 0;
  for (const para of text.split('\n\n')) {
    const rows = [];
    for (const item of para.split('\n')) {
      const m = item.match(/^(\d+\.) (.*)$/), num = m ? m[1] : null, body = m ? m[2] : item;
      const indent = num ? measure(g, `${num} `, size) : 0;
      let line = '', first = true, style = '';
      const push = () => {
        rows.push({ y, x: indent, text: line, num: first ? num : null, style });
        style = runs(line, style).style;   // (the next line starts in the style this one ends in)
        y += lead;
        first = false;
      };
      for (const word of body.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (line && measure(g, next, size, style) > width - indent) { push(); line = word; } else line = next;
      }
      push();
      y += Math.round(lead * 0.15);   // (a little between numbered steps)
    }
    paras.push(rows);
    y += Math.round(lead * 0.35);
  }
  const all = paras.flat();
  return { size, paras, height: all.length ? all.at(-1).y : 0 };
}

// The text cut into pages, each `room` tall: as big as fits on one (down to
// 18px; a single page, down to 14), or else at 18px over as many as it takes,
// breaking between paragraphs. Each page: { size, rows: [{ y, x, text, num }] }.
function paginate(g, text, room, single = false, biggest = 22) {
  for (let size = biggest; size >= (single ? 14 : 18); size--) {
    const l = layout(g, text, size);
    if (l.height <= room) return [{ size, rows: l.paras.flat() }];
  }
  const l = layout(g, text, 18), pages = [];
  let rows = [], base = null;
  for (const para of l.paras) {
    // a paragraph that won't fit under what's on this page starts the next
    if (rows.length && para.at(-1).y - base > room) { pages.push({ size: 18, rows }); rows = []; base = null; }
    for (const r of para) {
      if (base === null) base = r.y;
      if (r.y - base > room) { pages.push({ size: 18, rows }); rows = []; base = r.y; }   // (a paragraph taller than a page)
      rows.push({ ...r, y: r.y - base });
    }
  }
  pages.push({ size: 18, rows });
  return pages;
}

// A page's title: on one line, as big as fits (from 40px down to 30), or else
// on two lines at 30px. { size, lines }
function titled(g, title) {
  const width = PX[0] - 2 * M + 4;
  for (let size = 40; size >= 30; size -= 2) {
    g.font = `400 ${size}px ${TITLE}`;
    g.letterSpacing = '-1px';
    const fits = g.measureText(title).width <= width;
    g.letterSpacing = '0px';
    if (fits) return { size, lines: [title] };
  }
  g.font = `400 30px ${TITLE}`;
  const words = title.split(' '), lines = [''];
  for (const w of words) {
    const next = lines.at(-1) ? `${lines.at(-1)} ${w}` : w;
    if (lines.at(-1) && g.measureText(next).width > width) lines.push(w); else lines[lines.length - 1] = next;
  }
  return { size: 30, lines };
}
const TITLE_LEAD = 32;   // between a two-line title's lines

// The power symbol, size high, its left at x on the baseline y.
function drawIcon(g, x, y, size) {
  const r = size * 0.32, cx = x + size / 2, cy = y - size * 0.34;
  g.save();
  g.strokeStyle = INK;
  g.lineWidth = Math.max(1.5, size * 0.09);
  g.lineCap = 'round';
  g.beginPath();
  g.arc(cx, cy, r, -Math.PI / 2 + 0.75, 1.5 * Math.PI - 0.75);
  g.stroke();
  g.beginPath();
  g.moveTo(cx, cy - r * 1.25);
  g.lineTo(cx, cy - r * 0.15);
  g.stroke();
  g.restore();
}

// A page's text, its first baseline at y.
function drawText(g, { size, rows }, y) {
  g.fillStyle = INK;
  g.font = `400 ${size}px ${SERIF}`;
  for (const r of rows) {
    if (r.num) g.fillText(r.num, M, y + r.y);
    let x = M + r.x;
    for (const run of runs(r.text, r.style).runs) {
      g.font = fontFor(run.style, size);
      const x0 = x;
      run.text.split(ICON).forEach((part, i) => {
        if (i) { drawIcon(g, x, y + r.y, size); x += size; }
        g.fillText(part, x, y + r.y);
        x += g.measureText(part).width;
      });
      // struck through: a line across its middle (not its trailing space)
      if (run.style === 's') g.fillRect(x0, y + r.y - size * 0.3, x - x0 - (run.text.endsWith(' ') ? g.measureText(' ').width : 0), Math.max(1.2, size * 0.07));
    }
    g.font = fontFor('', size);
  }
}

// The pages laid out (they need a canvas to measure the text: made once, in
// the browser): [{ section, title, head, text }], with the warning's text, and
// the contents' entries: a section's name, the page it starts on, and where its
// line is on the contents page (canvas pixels: baseline, then the band a click
// on it lands in).
let LAID = null;
const CONTENTS_TOP = 168, CONTENTS_LEAD = 33;   // the contents' first baseline, and the space a line takes
function laid() {
  if (LAID) return LAID;
  const g = canvas().getContext('2d'), pages = [], contents = [];
  const entry = (name, page) => {
    const y = CONTENTS_TOP + contents.length * CONTENTS_LEAD;
    contents.push({ name, page, y, y0: y - 24, y1: y + 8 });
  };
  for (const [section, title, text] of PAGES) {
    if (contents.at(-1)?.name !== section) entry(section, pages.length + 1);
    const t = titled(g, title ?? section), top = TEXT_TOP + (t.lines.length - 1) * TITLE_LEAD;
    // (a text over more than one page says so at the foot of all but its last; room left for that)
    const parts = paginate(g, text, TEXT_BOTTOM - top), split = parts.length > 1 ? paginate(g, text, TEXT_BOTTOM - top - 24) : parts;
    split.forEach((pageText, i) => pages.push({ title: t, head: section.toUpperCase(), top, text: pageText, more: i < split.length - 1 }));
  }
  // the notes and the warranty, last (after a blank page, if the leaves need evening up: see Book)
  entry('Notes & Warranty', pages.length + 1 + (pages.length % 2));
  return (LAID = { pages, contents, warning: paginate(g, WARNING[1], WARN.bottom - WARN.top, true, 28)[0] });
}

// The way back to the contents, in the bottom left corner of the left-hand
// pages: a little house.
const HOME = { x0: 14, y0: PX[1] - 50, x1: 58, y1: PX[1] - 8 };
function drawHome(g) {
  const cx = (HOME.x0 + HOME.x1) / 2, base = HOME.y1 - 10;
  g.fillStyle = ACCENT;
  g.beginPath();
  g.moveTo(cx - 15, base - 13);
  g.lineTo(cx, base - 27);
  g.lineTo(cx + 15, base - 13);
  g.closePath();
  g.fill();
  g.fillRect(cx - 10, base - 14, 20, 14);
  g.fillStyle = PAPER;
  g.fillRect(cx - 3, base - 8, 6, 8);
}

// The cover's logo, cut from its top left corner (where it sits on each page too).
function drawLogoTop(g) {
  if (!COVER.complete || !COVER.naturalWidth) return;
  const k = COVER.naturalWidth / PX[0];
  g.drawImage(COVER, 30 * k, 16 * k, 136 * k, 34 * k, 30, 16, 136, 34);
}

// A thin black rule across the page, like the cover's.
function rule(g, y) {
  g.fillStyle = INK;
  g.fillRect(M, y, PX[0] - 2 * M, 1.5);
}

// A page's paper, the logo and a rule under it, a title, and the foot's rule
// with a line of small type under it (the page number, or the cover's motto).
function frame(g, title, foot, head = '') {
  const [w, h] = PX;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, w, h);
  drawLogoTop(g);
  if (head) {
    g.fillStyle = GREY;
    g.font = `600 12px ${FONT}`;
    g.letterSpacing = '1px';
    g.textAlign = 'right';
    g.fillText(head, w - M, 39);
    g.textAlign = 'left';
    g.letterSpacing = '0px';
  }
  rule(g, RULE_TOP);
  // (a title: a string, or as titled() set it out)
  const t = typeof title === 'string' ? { size: 40, lines: [title] } : title;
  g.fillStyle = INK;
  g.font = `400 ${t.size}px ${TITLE}`;
  g.letterSpacing = '-1px';
  t.lines.forEach((line, i) => g.fillText(line, M - 2, 116 + i * TITLE_LEAD));
  g.letterSpacing = '0px';
  rule(g, RULE_FOOT);
  g.fillStyle = INK;
  g.font = `500 14px ${FONT}`;
  g.textAlign = 'center';
  g.fillText(foot, w / 2, RULE_FOOT + 30);
  g.textAlign = 'left';
}

// A page: its section and title, its text, and the page number. (Page n is
// the (n + 2)th surface: the odd ones are on the left, with the way home.)
function drawPage(g, { title, head, top, text, more }, n) {
  frame(g, title, String(n), head);
  drawText(g, text, top);
  if (more) {
    g.fillStyle = GREY;
    g.font = `italic 400 15px ${SERIF}`;
    g.textAlign = 'right';
    g.fillText('(Continued on next page)', PX[0] - M, RULE_FOOT - 12);
    g.textAlign = 'left';
  }
  if (n % 2 === 1) drawHome(g);
}

// The inside of the front cover: the warning, on its own (no logo, rules or
// page number), so its text can be bigger. (Its title's baseline, then the
// text's first and last.)
const WARN = { title: 84, top: 134, bottom: PX[1] - 44 };
function drawWarning(g) {
  const [w, h] = PX;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, w, h);
  g.fillStyle = INK;
  g.font = `400 44px ${TITLE}`;
  g.letterSpacing = '-1px';
  g.fillText(WARNING[0], M - 2, WARN.title);
  g.letterSpacing = '0px';
  drawText(g, laid().warning, WARN.top);
}

// The covers: the team's art (web/public/img/book; from assets/images/book).
const COVER = new Image(), BACK = new Image();
COVER.src = './img/book/cover.webp';
BACK.src = './img/book/back_cover.webp';
function drawArt(g, img) {
  const [w, h] = PX;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  if (img.complete && img.naturalWidth) g.drawImage(img, 0, 0, w, h);
}
function drawCover(g) { drawArt(g, COVER); }

// Facing the warning: what's in it.
function drawContents(g) {
  const w = PX[0];
  frame(g, 'Contents', 'Thank you for choosing Gelato!');
  g.fillStyle = INK;
  g.font = `400 20px ${SERIF}`;
  for (const { name, page, y } of laid().contents) {
    g.fillText(name, M, y);
    g.textAlign = 'right';
    g.fillText(String(page), w - M, y);
    g.textAlign = 'left';
  }
}

// A page left for your own notes.
// Where you can write on it (page pixels), and the pen's ink.
const NOTES = { x0: M, x1: PX[0] - M, y0: 140, y1: RULE_FOOT - 8 };
const PEN = { color: '#1d2a6b', width: 2.2 };
function drawNotes(g, left = true, n = '') {
  frame(g, 'Notes', String(n));
  g.strokeStyle = '#d4d4d4';
  g.lineWidth = 1.5;
  for (let y = 172; y < RULE_FOOT - 20; y += 34) {
    g.beginPath();
    g.moveTo(M, y);
    g.lineTo(PX[0] - M, y);
    g.stroke();
  }
  if (left) drawHome(g);
}

// A page left blank (to even up the leaves), saying so.
function drawBlank(g, left) {
  const [w, h] = PX;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, w, h);
  g.fillStyle = GREY;
  g.font = `italic 400 16px ${SERIF}`;
  g.textAlign = 'center';
  g.fillText('This page intentionally left blank.', w / 2, h / 2);
  g.textAlign = 'left';
  if (left) drawHome(g);
}

// The inside of the back cover: the small print.
function drawWarranty(g, n = '') {
  frame(g, 'Warranty', String(n));
  drawText(g, paginate(g, 'Gelato Labs is not responsible for defects, damages, injury, death, or Gelato Labs employees eating the gelato in your freezer while you were distracting playing our video games.\n\n'
    + 'Do not insert GelatoBoy™ cartridges or GelatoStation™ discs into the Virtualato™. Do not insert the GelatoBoy™ into yourself.\n\n'
    + 'Warranty void if read.', TEXT_BOTTOM - TEXT_TOP, true)[0], TEXT_TOP);
}

function drawBack(g) { drawArt(g, BACK); }

// A surface's picture. ink: a canvas of what's been drawn on it (the notes),
// put back over it whenever it's repainted. spine: which edge is at the spine
// ('left' for a right-hand page, 'right' for a left-hand one): a soft shadow
// there, the seam between the open pages.
function texture(draw, ink = null, spine = null) {
  const c = canvas(), tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.userData.canvas = c;
  const paint = () => {
    const g = c.getContext('2d');
    g.setTransform(RES, 0, 0, RES, 0, 0);
    draw(g);
    if (ink) { g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(ink, 0, 0); }
    if (spine) {
      g.setTransform(RES, 0, 0, RES, 0, 0);
      const wide = 16, x0 = spine === 'left' ? 0 : PX[0] - wide;
      const shade = g.createLinearGradient(spine === 'left' ? 0 : PX[0], 0, spine === 'left' ? wide : PX[0] - wide, 0);
      shade.addColorStop(0, 'rgba(0, 0, 0, 0.22)');
      shade.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.fillStyle = shade;
      g.fillRect(x0, 0, wide, PX[1]);
    }
    tex.needsUpdate = true;
  };
  paint();
  // (repainted as the pictures it may use arrive)
  for (const img of [COVER, BACK]) if (!img.complete) img.addEventListener('load', paint);
  return tex;
}

// A face of a leaf lying on the right: a plane facing up (front) or down
// (back), reading the right way round from the front of the desk once it's
// turned over onto the left.
function face(tex, y, back, surface) {
  const geo = new THREE.PlaneGeometry(W, H, SEGS, 1).rotateX(-Math.PI / 2);
  if (back) geo.rotateZ(Math.PI);
  geo.translate(W / 2, y, 0);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: back === 'cover' ? 0.5 : 0.85 }));
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.surface = surface;
  return mesh;
}

// Bends a leaf into an arc: total turns it through `by` radians from the spine
// to the free edge (0 lays it flat again). Each vertex at x along the leaf,
// y off its middle, goes to the same distance along the arc and off it.
function bend(leaf, by) {
  const k = by / W;
  for (const m of leaf.meshes) {
    const flat = m.userData.flat, pos = m.geometry.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const x = flat[v * 3], y = flat[v * 3 + 1], a = k * x;
      const px = Math.abs(k) < 1e-6 ? x : Math.sin(a) / k, py = Math.abs(k) < 1e-6 ? 0 : (1 - Math.cos(a)) / k;
      pos.setXY(v, px - y * Math.sin(a), py + y * Math.cos(a));
    }
    pos.needsUpdate = true;
    m.geometry.computeVertexNormals();
    m.geometry.computeBoundingSphere();
  }
}

export class Book {
  // blocked(): whether something's lying on it (it won't open then). camera:
  // who reads it; canHold(): whether it can be picked up to read (not in VR,
  // where it's read where it lies).
  constructor(scene, blocked = () => false, camera = null, canHold = () => false) {
    this.blocked = blocked;
    this.camera = camera;
    this.canHold = canHold;
    this.held = false;
    this.lift = 0;    // 0 on the desk .. 1 held up to read
    this.slide = 0;   // how far it's moved across, held, so what's showing is in the middle
    this.group = new THREE.Group();
    this.group.rotation.y = YAW;
    const right = new THREE.Vector3(Math.cos(YAW), 0, -Math.sin(YAW));
    this.group.position.copy(BOOK_AT).addScaledVector(right, -W / 2);   // (its origin is the spine)
    // every surface in order, paired into leaves (front, back): the cover, the
    // warning inside it facing the contents, the pages, a blank page if the leaves
    // need evening up, the notes, then the warranty and the back cover
    const { pages } = laid();
    const surfaces = [drawCover, drawWarning, drawContents, ...pages.map((p, i) => (g) => drawPage(g, p, i + 1))];
    // one page of notes, to draw on (the home on it if it's on the left: the odd
    // surfaces are), after a blank page if the leaves need evening up
    if (pages.length % 2 === 1) surfaces.push((g) => drawBlank(g, surfaces.length % 2 === 1));
    const firstNote = surfaces.length;
    // (numbered on from the pages: surface i is page i - 2)
    const notes = [(g) => drawNotes(g, firstNote % 2 === 1, firstNote - 2)];
    surfaces.push(...notes);
    this.inks = new Map(notes.map((_, i) => [firstNote + i, canvas()]));
    const warranty = surfaces.length;
    surfaces.push((g) => drawWarranty(g, warranty - 2), drawBack);
    const sides = [];
    for (let i = 0; i < surfaces.length; i += 2) sides.push([surfaces[i], surfaces[i + 1]]);
    const n = sides.length, thick = sides.map((_, i) => (i === 0 || i === n - 1 ? BOARD : SHEET));
    const below = (i) => thick.slice(i + 1).reduce((a, b) => a + b, 0), above = (i) => thick.slice(0, i).reduce((a, b) => a + b, 0);
    this.thickness = thick.reduce((a, b) => a + b, 0);
    const cardMat = new THREE.MeshStandardMaterial({ color: 0x1b1836, roughness: 0.5 });
    const paperMat = new THREE.MeshStandardMaterial({ color: 0xf4f3ee, roughness: 0.9 });
    this.leaves = sides.map(([front, back], i) => {
      const t = thick[i], card = i === 0 || i === n - 1;
      // lying on the right it's at yR, turned over onto the left at yL: turning
      // about the spine halfway between, the leaf sits d above that
      const yR = below(i) + t / 2, yL = above(i) + t / 2, d = (yR - yL) / 2;
      const pivot = new THREE.Group();
      pivot.position.y = (yR + yL) / 2 + 0.0002;
      const edge = new THREE.Mesh(new THREE.BoxGeometry(W, t * 0.9, H, SEGS).translate(W / 2, d, 0), card ? cardMat : paperMat);
      edge.castShadow = edge.receiveShadow = true;
      // (the pages' insides meet at the spine: the outsides of the covers don't)
      const top = face(texture(front, this.inks.get(i * 2), i === 0 ? null : 'left'), d + t / 2, false, i * 2);
      const bottom = face(texture(back, this.inks.get(i * 2 + 1), i === n - 1 ? null : 'right'), d - t / 2, card ? 'cover' : true, i * 2 + 1);
      if (i === 0) top.material.roughness = 0.5;
      pivot.add(edge, top, bottom);
      this.group.add(pivot);
      const leaf = { i, pivot, angle: 0, from: 0, to: 0, t: 1, meshes: [edge, top, bottom], lag: card ? LAG.card : LAG.paper };
      for (const m of leaf.meshes) {
        m.userData.leaf = leaf;
        m.userData.flat = m.geometry.attributes.position.array.slice();
      }
      return leaf;
    });
    // the left-hand pages after the contents (the pages, and the notes) have the way home
    this.homes = (n) => n % 2 === 1 && n >= 3 && n <= surfaces.length - 3;
    this.turned = 0;   // leaves turned over onto the left
    this.queue = [];
    scene.add(this.group);
    this.desk = { pos: this.group.position.clone(), quat: this.group.quaternion.clone() };
  }

  // Picks it up to read: it comes up in front of the camera, facing it.
  hold() { this.held = true; }

  // Puts it down where it was (open at the same page).
  putDown() {
    this.held = false;
    this.penUp();
  }

  get busy() { return this.leaves.some((l) => l.t < 1) || this.queue.length > 0; }

  // Up to read or down on the desk, part way between as it goes: held, it's in
  // front of the camera, as close as lets the open book fit the view.
  updateLift(dt) {
    const was = this.lift;
    this.lift = Math.min(1, Math.max(0, this.lift + (this.held ? dt : -dt) / LIFT));
    if (!this.lift && !was) return;
    const cam = this.camera;
    cam.updateMatrixWorld();
    // what shows in the middle: the cover (the book lies right of its spine), the
    // open pages (either side of it), or the back (left of it)
    const want = this.turned === 0 ? -W / 2 : this.turned === this.leaves.length ? W / 2 : 0;
    this.slide += (want - this.slide) * Math.min(1, dt * 8);
    const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const d = Math.max(H / (0.72 * 2 * tan), (2 * W) / (0.8 * 2 * tan * cam.aspect));   // (filling most of the view, not all)
    const pos = new THREE.Vector3(this.slide, 0, -d).applyMatrix4(cam.matrixWorld);
    const quat = cam.getWorldQuaternion(new THREE.Quaternion()).multiply(UPRIGHT);
    const e = this.lift * this.lift * (3 - 2 * this.lift);
    this.group.position.lerpVectors(this.desk.pos, pos, e);
    this.group.quaternion.slerpQuaternions(this.desk.quat, quat, e);
  }
  get open() { return this.turned > 0; }
  // the top of it closed (where the Virtualato sits)
  get top() { return BOOK_AT.y + this.thickness + 0.0002; }

  // Is p (seen from above) on it, open or closed?
  under(p) {
    const q = this.group.worldToLocal(p.clone());
    return q.x > (this.open ? -W : 0) && q.x < W && Math.abs(q.z) < H / 2;
  }

  // A slab over everywhere it lies, open or shut, for the cables to rest on.
  pad() {
    this.group.updateMatrixWorld();
    const t = this.thickness + 0.0004;
    return new OBB().setFromMatrix(this.group.matrixWorld, new THREE.Vector3(W, t / 2, H / 2), new THREE.Vector3(0, t / 2, 0));
  }

  // What a click on it does now: { label, act } or null.
  target(raycaster) {
    const hit = raycaster.intersectObject(this.group, true)[0];
    if (!hit || this.busy || this.blocked()) return null;
    const leaf = hit.object.userData.leaf, last = this.leaves.length - 1;
    if (!this.held && this.canHold()) return { label: 'Read booklet', act: () => this.hold() };
    if (!this.open) return { label: 'Open booklet', act: () => this.turn(1) };
    const surface = hit.object.userData.surface, x = hit.uv && hit.uv.x * PX[0], y = hit.uv && (1 - hit.uv.y) * PX[1];
    // held, the notes can be drawn on (press, and move, and let go)
    if (this.held && this.inks.has(surface) && (leaf.i === this.turned || leaf.i === this.turned - 1) && this.onNotes(x, y)) {
      return { label: 'Draw', act: () => this.penDown(hit.object, x, y) };
    }
    if (leaf.i === this.turned && surface === 2 && x != null && x > 14 && x < PX[0] - 14) {
      // the contents (on the right, facing the warning): an entry
      const entry = laid().contents.find((e) => y > e.y0 && y < e.y1);
      // page n is the (n + 2)th surface: on the leaf that many over, halved, rounded up
      if (entry) return { label: `Turn to page ${entry.page}`, act: () => this.goTo(Math.ceil((entry.page + 2) / 2)) };
    }
    if (leaf.i === this.turned - 1) {
      // on the left: the way home, or back a page
      if (this.homes(surface) && x > HOME.x0 && x < HOME.x1 && y > HOME.y0 && y < HOME.y1) return { label: 'Back to contents', act: () => this.goTo(1) };
      return { label: this.turned === 1 ? 'Close booklet' : 'Previous page', act: () => this.turn(-1) };
    }
    if (leaf.i === this.turned && leaf.i < last) return { label: 'Next page', act: () => this.turn(1) };
    return null;
  }

  onNotes(x, y) { return x != null && x > NOTES.x0 && x < NOTES.x1 && y > NOTES.y0 && y < NOTES.y1; }

  // Drawing on the notes: penDown on a page (its mesh), penTo as it moves
  // (from a ray: where on that page it is now), penUp when it's let go.
  penDown(mesh, x, y) {
    this.pen = { mesh, x, y };
    this.penTo(null, x, y);
  }

  penTo(raycaster, x, y) {
    const pen = this.pen;
    if (!pen) return;
    if (raycaster) {
      const hit = raycaster.intersectObject(pen.mesh, false)[0];
      if (!hit?.uv) return;
      x = hit.uv.x * PX[0];
      y = (1 - hit.uv.y) * PX[1];
    }
    x = Math.min(NOTES.x1, Math.max(NOTES.x0, x));
    y = Math.min(NOTES.y1, Math.max(NOTES.y0, y));
    const ink = this.inks.get(pen.mesh.userData.surface), tex = pen.mesh.material.map;
    // on the ink (kept), and straight onto the page's picture
    for (const c of [ink, tex.userData.canvas]) {
      const g = c.getContext('2d');
      g.setTransform(RES, 0, 0, RES, 0, 0);
      g.strokeStyle = PEN.color;
      g.lineWidth = PEN.width;
      g.lineCap = g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(pen.x, pen.y);
      g.lineTo(x + (x === pen.x && y === pen.y ? 0.01 : 0), y);   // (a dot, pressed and let go)
      g.stroke();
    }
    tex.needsUpdate = true;
    pen.x = x;
    pen.y = y;
  }

  penUp() { this.pen = null; }

  // Turns a leaf on (+1) or back (-1).
  turn(dir, time = TURN) {
    const leaf = dir > 0 ? this.leaves[this.turned] : this.leaves[this.turned - 1];
    if (!leaf || (dir > 0 && leaf.i === this.leaves.length - 1)) return;
    this.turned += dir;
    Object.assign(leaf, { from: leaf.angle, to: dir > 0 ? Math.PI : 0, t: 0, time });
    this.onTurn?.(this.turned === 1 && dir > 0 ? 'open' : this.turned === 0 ? 'close' : 'page');
  }

  // Turns quickly, a leaf after another, until that many are turned over.
  goTo(turned) {
    const n = turned - this.turned;
    this.queue = Array.from({ length: Math.abs(n) }, () => Math.sign(n));
    this.gap = 0;
  }

  // Closes it (quickly, a leaf after another), then done().
  close(done) {
    this.queue = Array.from({ length: this.turned }, () => -1);
    this.closed = done;
    this.gap = 0;
    if (!this.turned) { this.queue = []; this.closed = null; done?.(); }
  }

  update(dt) {
    this.updateLift(dt);
    for (const l of this.leaves) {
      if (l.t >= 1) continue;
      l.t = Math.min(1, l.t + dt / l.time);
      // the free edge leads the whole way over, the spine end following on, so
      // the leaf bends in the middle of the turn (and lies flat at either end)
      const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
      const edge = ease(l.t / (1 - l.lag)), spine = ease((l.t - l.lag) / (1 - l.lag));
      l.angle = l.from + (l.to - l.from) * spine;
      l.pivot.rotation.z = l.angle;
      bend(l, (l.to - l.from) * (edge - spine));
    }
    if (this.queue.length) {
      this.gap -= dt;
      if (this.gap <= 0) { this.turn(this.queue.shift(), 0.28); this.gap = 0.1; }
    } else if (this.closed && !this.busy) {
      const done = this.closed;
      this.closed = null;
      done();
    }
  }
}
