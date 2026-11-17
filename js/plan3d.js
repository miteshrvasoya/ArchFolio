/* ==========================================================================
   Plan → 3D engine
   1. analysePlan(): reads a floor-plan image in the browser and finds
      walls, door/window openings and enclosed rooms.
   2. createPlanViewer(): turns that analysis into a 3D model in one of
      three modes — massing, 1.2 m cut plan, or full 3D with elements.
   Nothing is uploaded: all processing happens on the visitor's device.
   ========================================================================== */
import * as THREE from 'three';
import { OrbitControls } from '../vendor/addons/OrbitControls.js';

const GRID = 360;                 // analysis cells along the image's long side
const DEG = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ==========================================================================
   1. IMAGE ANALYSIS
   ========================================================================== */

export function rasterise(source, max) {
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  const k = Math.min(1, max / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * k));
  c.height = Math.max(1, Math.round(sh * k));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

/** Connected components of non-zero cells. */
function components(mask, gw, gh, eight) {
  const n = gw * gh;
  const label = new Int32Array(n).fill(-1);
  const size = [], minX = [], minY = [], maxX = [], maxY = [];
  const stack = [];
  for (let s = 0; s < n; s++) {
    if (!mask[s] || label[s] !== -1) continue;
    const id = size.length;
    let c = 0, x0 = gw, y0 = gh, x1 = 0, y1 = 0;
    label[s] = id; stack.push(s);
    while (stack.length) {
      const i = stack.pop(); c++;
      const x = i % gw, y = (i - x) / gw;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= gh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!eight && dx && dy) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= gw) continue;
          const j = yy * gw + xx;
          if (mask[j] && label[j] === -1) { label[j] = id; stack.push(j); }
        }
      }
    }
    size.push(c); minX.push(x0); minY.push(y0); maxX.push(x1); maxY.push(y1);
  }
  return { label, size, minX, minY, maxX, maxY };
}

/** Drop components smaller than a share of the largest one. */
function dropSmall(mask, gw, gh, cleanup) {
  const cc = components(mask, gw, gh, true);
  const biggest = cc.size.reduce((a, b) => Math.max(a, b), 0);
  const min = Math.min(biggest, Math.round(lerp(1, 0.2 * biggest + 40, cleanup * cleanup)));
  for (let i = 0; i < mask.length; i++) if (mask[i] && cc.size[cc.label[i]] < min) mask[i] = 0;
  return cc;
}

/** Min (erode) or max (dilate) filter with a square kernel, separable. */
function morph(mask, gw, gh, r, erode) {
  const tmp = new Uint8Array(mask.length), out = new Uint8Array(mask.length);
  const want = erode ? 0 : 1;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let v = erode ? 1 : 0;
      for (let k = -r; k <= r && v !== want; k++) {
        const xx = x + k;
        const m = xx < 0 || xx >= gw ? 0 : mask[y * gw + xx];
        if (m === want) v = want;
      }
      tmp[y * gw + x] = v;
    }
  }
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let v = erode ? 1 : 0;
      for (let k = -r; k <= r && v !== want; k++) {
        const yy = y + k;
        const m = yy < 0 || yy >= gh ? 0 : tmp[yy * gw + x];
        if (m === want) v = want;
      }
      out[y * gw + x] = v;
    }
  }
  return out;
}

/** Cells in runs of empty space, bounded by wall on both ends, minLen..maxLen long.
    With `cont`, the wall must also carry on for that many cells past each end —
    a real gap sits between two runs of the same wall, not between two walls
    that merely cross the line. */
function runBridges(mask, gw, gh, minLen, maxLen, horizontal, cont = 0) {
  const out = new Uint8Array(mask.length);
  const A = horizontal ? gh : gw, B = horizontal ? gw : gh;
  const at = horizontal ? (a, b) => a * gw + b : (a, b) => b * gw + a;
  for (let a = 0; a < A; a++) {
    let b = 0;
    while (b < B && !mask[at(a, b)]) b++;
    while (b < B) {
      while (b < B && mask[at(a, b)]) b++;
      const s = b;
      while (b < B && !mask[at(a, b)]) b++;
      const len = b - s;
      if (b < B && len >= minLen && len <= maxLen) {
        // at least one end must carry on as the same wall (a door can sit flush
        // against a junction, but a run between two crossing walls is a room)
        let left = true, right = true;
        for (let k = 1; k <= cont; k++) {
          if (left && (s - k < 0 || !mask[at(a, s - k)])) left = false;
          if (right && (b + k - 1 >= B || !mask[at(a, b + k - 1)])) right = false;
        }
        if (!cont || left || right) for (let k = s; k < b; k++) out[at(a, k)] = 1;
      }
    }
  }
  return out;
}

/** Greedy merge of equal non-zero labels into rectangles [x, y, w, h, label]. */
function rectMerge(labels, gw, gh) {
  const used = new Uint8Array(labels.length);
  const rects = [];
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x, L = labels[i];
      if (!L || used[i]) continue;
      let w = 1;
      while (x + w < gw && labels[i + w] === L && !used[i + w]) w++;
      let h = 1;
      grow: while (y + h < gh) {
        const row = (y + h) * gw + x;
        for (let k = 0; k < w; k++) if (labels[row + k] !== L || used[row + k]) break grow;
        h++;
      }
      for (let yy = 0; yy < h; yy++) used.fill(1, (y + yy) * gw + x, (y + yy) * gw + x + w);
      rects.push([x, y, w, h, L]);
    }
  }
  return rects;
}

/** Chamfer distance (in cells) from each `inside` cell to the nearest outside cell. */
function distanceField(inside, gw, gh) {
  const INF = 1e9, d = new Float32Array(inside.length);
  for (let i = 0; i < d.length; i++) d[i] = inside[i] ? INF : 0;
  const pass = (y0, y1, sy, x0, x1, sx) => {
    for (let y = y0; y !== y1; y += sy) {
      for (let x = x0; x !== x1; x += sx) {
        const i = y * gw + x;
        if (!d[i]) continue;
        let v = d[i];
        const px = x - sx, py = y - sy;
        if (px >= 0 && px < gw) v = Math.min(v, d[i - sx] + 1);
        if (py >= 0 && py < gh) {
          v = Math.min(v, d[i - sy * gw] + 1);
          if (px >= 0 && px < gw) v = Math.min(v, d[i - sy * gw - sx] + 1.414);
          const nx = x + sx;
          if (nx >= 0 && nx < gw) v = Math.min(v, d[i - sy * gw + sx] + 1.414);
        }
        d[i] = v;
      }
    }
  };
  pass(0, gh, 1, 0, gw, 1);
  pass(gh - 1, -1, -1, gw - 1, -1, -1);
  return d;
}

/**
 * Options
 *  width        real width of the building's outer walls, metres
 *  sensitivity  0..1 how light a line may be and still count as wall
 *  cleanup      0..1 how aggressively small detached marks are dropped
 *  wallStyle    'solid'    – walls drawn as thick filled strokes
 *               'outlined' – walls drawn as two parallel lines
 *  maxOpening   widest gap (m) that is read as a door/window rather than open space
 *  exterior     'auto' | 'window' | 'door' – how openings in outer walls are read
 */
export function analysePlan(source, o) {
  const small = rasterise(source, GRID);
  const gw = small.width, gh = small.height, n = gw * gh;
  const px = small.getContext('2d').getImageData(0, 0, gw, gh).data;

  // --- threshold ---
  let mean = 0;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    mean += lum[i];
  }
  mean /= n;
  const inverted = mean < 110;                        // blueprint: light lines on dark
  const cut = lerp(70, 215, o.sensitivity);
  let wall = new Uint8Array(n);
  const ink = new Uint8Array(n);                     // any linework at all, for window symbols
  for (let i = 0; i < n; i++) {
    const v = inverted ? 255 - lum[i] : lum[i];
    wall[i] = v < cut ? 1 : 0;
    ink[i] = v < 232 ? 1 : 0;
  }

  // --- first scale estimate from the largest connected drawing (the building) ---
  let cc = components(wall, gw, gh, true);
  if (!cc.size.length) return null;
  let big = 0;
  cc.size.forEach((s, i) => { if (s > cc.size[big]) big = i; });
  const cell0 = o.width / Math.max(8, cc.maxX[big] - cc.minX[big] + 1);

  // --- normalise wall strokes ---
  if (o.wallStyle === 'outlined') {
    // fill the hollow between the two lines of each wall
    const k = Math.max(1, Math.round(0.35 / cell0));
    const hb = runBridges(wall, gw, gh, 1, k, true);
    for (let i = 0; i < n; i++) wall[i] |= hb[i];
    const vb = runBridges(wall, gw, gh, 1, k, false);
    for (let i = 0; i < n; i++) wall[i] |= vb[i];
  } else {
    // remove hairlines: window symbols, hatching, dimension and swing lines
    const r = Math.max(0, Math.round((0.1 / cell0 - 1) / 2));
    if (r > 0) wall = morph(morph(wall, gw, gh, r, true), gw, gh, r, false);
  }
  dropSmall(wall, gw, gh, o.cleanup);

  // --- final scale from the bounding box of the remaining walls ---
  let bx0 = gw, by0 = gh, bx1 = -1, by1 = -1;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    if (!wall[y * gw + x]) continue;
    if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
  }
  if (bx1 < 0) return null;
  const cell = o.width / (bx1 - bx0 + 1);
  const cx = (bx0 + bx1 + 1) / 2, cy = (by0 + by1 + 1) / 2;

  // --- openings: short gaps between wall ends, no deeper than a wall ---
  const minLen = Math.max(2, Math.round(0.45 / cell));
  const maxLen = Math.max(minLen + 1, Math.round(o.maxOpening / cell));
  const maxThick = Math.max(2, Math.round(0.6 / cell));
  const openIdx = new Int32Array(n);              // opening index + 1
  const openings = [];
  [true, false].forEach((horizontal) => {
    const cont = Math.max(3, Math.round(0.2 / cell));
    const br = runBridges(wall, gw, gh, minLen, maxLen, horizontal, cont);
    const bc = components(br, gw, gh, false);
    bc.size.forEach((_, id) => {
      const w = bc.maxX[id] - bc.minX[id] + 1, h = bc.maxY[id] - bc.minY[id] + 1;
      const along = horizontal ? w : h, across = horizontal ? h : w;
      if (across > maxThick || along < minLen) return;
      const x = bc.minX[id], y = bc.minY[id];
      // both faces of a door or window open onto space, not onto more wall
      const sideWall = (fixed) => {
        let c = 0;
        for (let k = 0; k < along; k++) {
          const xx = horizontal ? x + k : fixed, yy = horizontal ? fixed : y + k;
          if (xx >= 0 && yy >= 0 && xx < gw && yy < gh && wall[yy * gw + xx]) c++;
        }
        return c / along;
      };
      const before = horizontal ? y - 1 : x - 1, after = horizontal ? y + h : x + w;
      if (sideWall(before) > 0.5 || sideWall(after) > 0.5) return;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
        if (br[yy * gw + xx] && openIdx[yy * gw + xx]) return;   // overlaps an earlier one
      }
      const idx = openings.length + 1;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
        if (bc.label[yy * gw + xx] === id) openIdx[yy * gw + xx] = idx;
      }
      openings.push({ x, y, w, h, dir: horizontal ? 'h' : 'v', key: `${x},${y},${w},${h}` });
    });
  });

  // --- outside vs rooms ---
  const closed = new Uint8Array(n);
  for (let i = 0; i < n; i++) closed[i] = wall[i] || openIdx[i] ? 1 : 0;
  const outside = new Uint8Array(n);
  const stack = [];
  const seed = (i) => { if (!closed[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
  for (let x = 0; x < gw; x++) { seed(x); seed((gh - 1) * gw + x); }
  for (let y = 0; y < gh; y++) { seed(y * gw); seed(y * gw + gw - 1); }
  while (stack.length) {
    const i = stack.pop(), x = i % gw;
    if (x > 0) seed(i - 1);
    if (x < gw - 1) seed(i + 1);
    if (i >= gw) seed(i - gw);
    if (i < n - gw) seed(i + gw);
  }
  const inner = new Uint8Array(n);
  for (let i = 0; i < n; i++) inner[i] = !closed[i] && !outside[i] ? 1 : 0;
  const rc = components(inner, gw, gh, false);
  const roomOf = new Int32Array(n);                // room id + 1
  const rooms = [];
  const dist = distanceField(inner, gw, gh);
  const minRoom = 0.8 / (cell * cell);
  rc.size.forEach((size, id) => {
    if (size < minRoom) return;
    rooms.push({ id: rooms.length + 1, cells: size, area: size * cell * cell, lx: 0, ly: 0, best: -1 });
  });
  const remap = new Int32Array(rc.size.length);
  let r = 0;
  rc.size.forEach((size, id) => { remap[id] = size < minRoom ? 0 : ++r; });
  for (let i = 0; i < n; i++) {
    if (!inner[i]) continue;
    const id = remap[rc.label[i]];
    roomOf[i] = id;
    if (!id) continue;
    const room = rooms[id - 1];
    if (dist[i] > room.best) { room.best = dist[i]; room.lx = i % gw; room.ly = (i - room.lx) / gw; }
  }

  // --- classify openings ---
  const isOut = (x, y) => x < 0 || y < 0 || x >= gw || y >= gh || outside[y * gw + x];
  const roomAt = (x, y) => (x < 0 || y < 0 || x >= gw || y >= gh ? 0 : roomOf[y * gw + x]);
  openings.forEach((op) => {
    const len = (op.dir === 'h' ? op.w : op.h) * cell;
    op.length = len;
    // sample just beyond both faces of the wall, at the middle of the opening
    const mx = op.x + (op.w >> 1), my = op.y + (op.h >> 1);
    const a = op.dir === 'h' ? [mx, op.y - 2] : [op.x - 2, my];
    const b = op.dir === 'h' ? [mx, op.y + op.h + 1] : [op.x + op.w + 1, my];
    const outA = isOut(...a), outB = isOut(...b);
    op.exterior = outA || outB;
    op.swing = outA ? 1 : outB ? -1 : roomAt(...a) ? -1 : 1;   // -1 → side A, +1 → side B
    // a window is drawn as fine lines across the gap; a doorway is left blank
    let inked = 0;
    for (let yy = op.y; yy < op.y + op.h; yy++) for (let xx = op.x; xx < op.x + op.w; xx++) inked += ink[yy * gw + xx];
    const symbol = inked / (op.w * op.h) > 0.12;
    if (symbol && o.exterior === 'auto') {
      op.type = 'window';
    } else if (op.exterior) {
      op.type = o.exterior === 'window' ? 'window'
        : o.exterior === 'door' ? 'door'
          : len <= 1.1 ? 'door' : 'window';
    } else {
      op.type = len <= 1.35 ? 'door' : 'opening';
    }
  });

  // --- rectangles for geometry ---
  const wallRects = rectMerge(wall, gw, gh);
  const roomRects = rectMerge(roomOf, gw, gh);
  const foot = new Uint8Array(n);
  for (let i = 0; i < n; i++) foot[i] = closed[i] || roomOf[i] ? 1 : 0;
  const footRects = rectMerge(foot, gw, gh);
  let footCells = 0;
  for (let i = 0; i < n; i++) footCells += foot[i];

  let wallCells = 0;
  for (let i = 0; i < n; i++) wallCells += wall[i];

  return {
    gw, gh, cell, cx, cy,
    width: o.width, depth: (by1 - by0 + 1) * cell,
    wall, openIdx, roomOf, outside,
    wallRects, roomRects, footRects, openings, rooms,
    builtUp: footCells * cell * cell,
    carpet: rooms.reduce((s, rm) => s + rm.area, 0),
    coverage: wallCells / n
  };
}

/* ==========================================================================
   2. MATERIALS & GEOMETRY HELPERS
   ========================================================================== */

/** Collects axis-aligned boxes into one geometry with metre-based UVs.
    Group 0 = sides & bottom, group 1 = top faces. */
class BoxBatch {
  constructor() { this.p = []; this.nm = []; this.uv = []; this.c = []; this.side = []; this.top = []; this.v = 0; }
  add(x0, x1, y0, y1, z0, z1, tint = 1) {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
    const face = (corners, normal, u, v, isTop) => {
      corners.forEach(([x, y, z], k) => {
        this.p.push(x, y, z); this.nm.push(...normal);
        this.uv.push(k === 1 || k === 2 ? u : 0, k >= 2 ? v : 0);
        this.c.push(tint, tint, tint);
      });
      const b = this.v, list = isTop ? this.top : this.side;
      list.push(b, b + 1, b + 2, b, b + 2, b + 3);
      this.v += 4;
    };
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], w, h);
    face([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], w, h);
    face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], d, h);
    face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], d, h);
    face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], w, d, true);
    face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], w, d);
  }
  build(materials, opts = {}) {
    if (!this.v) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (opts.colors) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex([...this.side, ...this.top]);
    g.addGroup(0, this.side.length, 0);
    g.addGroup(this.side.length, this.top.length, 1);
    const m = new THREE.Mesh(g, materials);
    m.castShadow = opts.shadow !== false;
    m.receiveShadow = true;
    return m;
  }
}

function canvasTexture(size, paint, repeat) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

let seed = 9;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

const TEX = {
  brick: () => canvasTexture(256, (g, s) => {
    g.fillStyle = '#d9c8b4'; g.fillRect(0, 0, s, s);
    const rows = 16, bh = s / rows, bw = s / 4;
    for (let r = 0; r < rows; r++) for (let k = -1; k < 4; k++) {
      g.fillStyle = `hsl(${18 + rnd() * 6} 55% ${40 + rnd() * 9}%)`;
      g.fillRect(k * bw + (r % 2 ? bw / 2 : 0) + 1.5, r * bh + 1.5, bw - 3, bh - 3);
    }
  }, 1 / 1.2),
  concrete: () => canvasTexture(256, (g, s) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
    for (let r = 0; r < 8; r++) {
      g.fillStyle = `rgba(60,66,54,${0.02 + rnd() * 0.06})`; g.fillRect(0, r * 32, s, 32);
      g.fillStyle = 'rgba(60,66,54,0.16)'; g.fillRect(0, r * 32, s, 1);
    }
    g.fillStyle = 'rgba(60,66,54,0.28)';
    [[64, 80], [192, 80], [64, 208], [192, 208]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 2.4, 0, 7); g.fill(); });
  }, 1 / 1.2),
  planks: () => canvasTexture(256, (g, s) => {
    for (let r = 0; r < 8; r++) {
      g.fillStyle = `hsl(28 ${38 + rnd() * 10}% ${52 + rnd() * 10}%)`; g.fillRect(0, r * 32, s, 32);
      g.fillStyle = 'rgba(60,40,20,0.35)'; g.fillRect(0, r * 32, s, 1.5);
      g.fillRect(rnd() * s, r * 32, 1.5, 32);
    }
  }, 1 / 1.6),
  slabs: () => canvasTexture(256, (g, s) => {
    for (let r = 0; r < 2; r++) for (let k = 0; k < 2; k++) {
      g.fillStyle = `hsl(60 ${6 + rnd() * 6}% ${70 + rnd() * 6}%)`; g.fillRect(k * 128, r * 128, 128, 128);
    }
    g.strokeStyle = 'rgba(60,66,54,0.25)'; g.lineWidth = 2;
    g.strokeRect(0, 0, 128, 128); g.strokeRect(128, 128, 128, 128); g.strokeRect(128, 0, 128, 128); g.strokeRect(0, 128, 128, 128);
  }, 1 / 1.2),
  tiles: () => canvasTexture(256, (g, s) => {
    g.fillStyle = '#efe6d8'; g.fillRect(0, 0, s, s);
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) {
      g.fillStyle = `hsl(22 ${45 + rnd() * 10}% ${58 + rnd() * 6}%)`; g.fillRect(k * 64 + 2, r * 64 + 2, 60, 60);
    }
  }, 1 / 1.2)
};

/** Style presets — wall finish, floor finish and detailing colours. */
export const STYLES = {
  plaster: { label: 'Lime plaster', wall: 0xefebe3, floor: 'planks', floorColor: 0xffffff, poche: 0x6e3511, frame: 0x333b2f, leaf: 0x8a5a3a, roof: 0xdedad2 },
  concrete: { label: 'Exposed concrete', wall: 0xd6d4cd, wallMap: 'concrete', floor: 'slabs', floorColor: 0xffffff, poche: 0x6e3511, frame: 0x2b302a, leaf: 0x7a4f33, roof: 0xc9c7c0 },
  brick: { label: 'Red brick', wall: 0xffffff, wallMap: 'brick', floor: 'tiles', floorColor: 0xffffff, poche: 0x333b2f, frame: 0x5a3a24, leaf: 0x6b4429, roof: 0xd6d3cb },
  card: { label: 'White card model', wall: 0xfbfaf6, floor: null, floorColor: 0xe8dcc4, poche: 0x8b8f86, frame: 0xf2f0ea, leaf: 0xe2d6bd, roof: 0xf4f2ec }
};

/* ==========================================================================
   3. VIEWER
   ========================================================================== */

export function createPlanViewer(canvas, { labelsEl, onPick } = {}) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 3000);
  camera.position.set(20, 20, 20);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reduced;
  controls.dampingFactor = 0.09;
  controls.maxPolarAngle = 88 * DEG;
  controls.screenSpacePanning = true;

  const hemi = new THREE.HemisphereLight(0xffffff, 0xc2c8b8, 1.9);
  const sun = new THREE.DirectionalLight(0xfff3e0, 1.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(hemi, sun, sun.target);

  const root = new THREE.Group();          // everything exported
  scene.add(root);
  let model = null;                         // current generated model group
  let plate = null, plateTex = null;
  let analysis = null, cfg = null;
  const overrides = new Map();              // opening key → type
  const hits = [];                          // invisible pick volumes
  let labelEls = [];
  let size = 12, grow = 1, sunT = 0.35;

  const texCache = {};
  const tex = (name) => (texCache[name] = texCache[name] || TEX[name]());
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });

  const disposeTree = (o) => o.traverse((c) => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) [].concat(c.material).forEach((m) => { if (m !== hitMat) m.dispose(); });
  });

  /* ---------- sun ---------- */
  const setSun = (t) => {
    sunT = t;
    const a = Math.PI * clamp(t, 0.02, 0.98), h = Math.sin(a);
    const dir = new THREE.Vector3(Math.cos(a) * 0.9, h * 0.95 + 0.12, 0.45).normalize();
    sun.position.copy(dir).multiplyScalar(size * 2.5);
    sun.target.position.set(0, 0, 0);
    sun.color.setRGB(1, lerp(0.78, 0.96, h), lerp(0.6, 0.9, h));
    sun.intensity = 0.7 + 1.0 * h;
    hemi.intensity = 1.7 + 0.35 * h;
  };

  /* ---------- model construction ---------- */
  function build() {
    if (model) { root.remove(model); disposeTree(model); }
    hits.length = 0;
    const A = analysis, S = STYLES[cfg.style];
    const cell = A.cell;
    const X = (gx) => (gx - A.cx) * cell, Z = (gy) => (gy - A.cy) * cell;
    model = new THREE.Group();
    model.name = 'plan-model';

    const mode = cfg.mode;
    const storeys = mode === 'cut' ? 1 : cfg.storeys;
    const H = mode === 'cut' ? 1.2 : cfg.wallHeight;
    const SLAB = 0.15;
    const doorH = Math.min(2.1, H - 0.2);
    const sill = 0.9;
    const pocheTop = mode !== 'full';

    const wallMat = new THREE.MeshLambertMaterial({ color: S.wall, map: S.wallMap ? tex(S.wallMap) : null });
    const pocheMat = new THREE.MeshLambertMaterial({ color: S.poche });
    const floorMat = new THREE.MeshLambertMaterial({ color: S.floorColor, map: S.floor ? tex(S.floor) : null, vertexColors: true });
    const frameMat = new THREE.MeshLambertMaterial({ color: S.frame });
    const leafMat = new THREE.MeshLambertMaterial({ color: S.leaf });
    const slabMat = new THREE.MeshLambertMaterial({ color: S.roof });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x9fc4c0, transparent: true, opacity: cfg.style === 'card' ? 0.25 : 0.42, depthWrite: false });
    const arcMat = new THREE.LineBasicMaterial({ color: S.poche });

    const walls = new BoxBatch(), floors = new BoxBatch(), frames = new BoxBatch(), glass = new BoxBatch(), slabs = new BoxBatch();
    const typeOf = (op) => overrides.get(op.key) || op.type;

    for (let s = 0; s < storeys; s++) {
      const y0 = s * (H + SLAB);
      const top = s === storeys - 1;

      // walls
      A.wallRects.forEach(([x, y, w, h]) => walls.add(X(x), X(x + w), y0, y0 + H, Z(y), Z(y + h)));

      // floors (one finish, a slight tint per room so spaces read apart)
      if (cfg.floors && mode !== 'massing') {
        A.roomRects.forEach(([x, y, w, h, id]) => {
          const tint = 0.9 + ((id * 37) % 11) / 75;
          floors.add(X(x), X(x + w), y0, y0 + 0.04, Z(y), Z(y + h), tint);
        });
      }

      // openings
      A.openings.forEach((op, i) => {
        let type = typeOf(op);
        if (s > 0 && op.exterior && type === 'door') type = 'window';   // no doors to thin air upstairs
        const x0 = X(op.x), x1 = X(op.x + op.w), z0 = Z(op.y), z1 = Z(op.y + op.h);
        const along = op.dir === 'h';
        const L = op.length;

        if (s === 0) {
          const hit = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.1, H * storeys + SLAB * (storeys - 1), z1 - z0 + 0.1), hitMat);
          hit.position.set((x0 + x1) / 2, (H * storeys + SLAB * (storeys - 1)) / 2, (z0 + z1) / 2);
          hit.userData.opening = i;
          hits.push(hit);
          model.add(hit);
        }
        if (mode === 'massing') return;

        if (type === 'wall') { walls.add(x0, x1, y0, y0 + H, z0, z1); return; }

        const lintel = (from) => { if (from < H) walls.add(x0, x1, y0 + from, y0 + H, z0, z1); };
        if (type === 'opening') { lintel(Math.min(2.4, H)); return; }

        if (type === 'window') {
          walls.add(x0, x1, y0, y0 + Math.min(sill, H), z0, z1);
          lintel(doorH);
          const gTop = Math.min(doorH, H);
          if (gTop > sill) {
            const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, t = 0.025;
            if (cfg.windows) {
              if (along) glass.add(x0, x1, y0 + sill, y0 + gTop, mz - t, mz + t);
              else glass.add(mx - t, mx + t, y0 + sill, y0 + gTop, z0, z1);
              const panes = Math.max(1, Math.round(L / 0.9));
              for (let k = 0; k <= panes; k++) {
                const f = k / panes, fw = 0.05;
                if (along) { const xx = lerp(x0, x1, f); frames.add(xx - fw / 2, xx + fw / 2, y0 + sill, y0 + gTop, mz - 0.04, mz + 0.04); }
                else { const zz = lerp(z0, z1, f); frames.add(mx - 0.04, mx + 0.04, y0 + sill, y0 + gTop, zz - fw / 2, zz + fw / 2); }
              }
              if (gTop >= doorH - 1e-3) {
                if (along) frames.add(x0, x1, y0 + gTop - 0.05, y0 + gTop, mz - 0.04, mz + 0.04);
                else frames.add(mx - 0.04, mx + 0.04, y0 + gTop - 0.05, y0 + gTop, z0, z1);
              }
            }
          }
          return;
        }

        // door
        lintel(doorH);
        if (!cfg.doors) return;
        const leafH = Math.min(doorH, H) - 0.02;
        const hingeX = along ? x0 : (x0 + x1) / 2;
        const hingeZ = along ? (z0 + z1) / 2 : z0;
        const alongDir = along ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
        const swingDir = along ? new THREE.Vector3(0, 0, op.swing) : new THREE.Vector3(op.swing, 0, 0);
        const ang = mode === 'cut' ? 90 * DEG : 72 * DEG;
        const d = alongDir.clone().multiplyScalar(Math.cos(ang)).add(swingDir.clone().multiplyScalar(Math.sin(ang)));
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(L - 0.04, leafH, 0.045).translate((L - 0.04) / 2, leafH / 2, 0), leafMat);
        leaf.position.set(hingeX, y0 + 0.01, hingeZ);
        leaf.rotation.y = Math.atan2(-d.z, d.x);
        leaf.castShadow = leaf.receiveShadow = true;
        model.add(leaf);
        if (mode === 'cut') {
          // plan convention: quarter-circle swing on the floor
          const pts = [];
          for (let k = 0; k <= 24; k++) {
            const a = (k / 24) * (Math.PI / 2);
            const v = alongDir.clone().multiplyScalar(Math.cos(a) * L).add(swingDir.clone().multiplyScalar(Math.sin(a) * L));
            pts.push(new THREE.Vector3(hingeX + v.x, y0 + 0.06, hingeZ + v.z));
          }
          model.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), arcMat));
        }
      });

      // slab above this storey (between storeys always, on top only if roof is on)
      if (mode === 'full' && (!top || cfg.roof)) {
        const ov = top ? 0.45 : 0;
        A.footRects.forEach(([x, y, w, h]) => slabs.add(X(x), X(x + w), y0 + H, y0 + H + SLAB, Z(y), Z(y + h)));
        if (ov) {
          // a parapet-free roof with a shading overhang around the footprint
          const fx0 = X(A.cx - A.width / cell / 2) - ov, fx1 = X(A.cx + A.width / cell / 2) + ov;
          const fz0 = Z(A.cy - A.depth / cell / 2) - ov, fz1 = Z(A.cy + A.depth / cell / 2) + ov;
          slabs.add(fx0, fx1, y0 + H + SLAB, y0 + H + SLAB + 0.12, fz0, fz1);
        }
      }
    }

    const parts = [
      walls.build([wallMat, pocheTop ? pocheMat : wallMat]),
      floors.build([floorMat, floorMat], { colors: true, shadow: false }),
      frames.build([frameMat, frameMat]),
      glass.build([glassMat, glassMat], { shadow: false }),
      slabs.build([slabMat, slabMat])
    ];
    ['walls', 'floors', 'frames', 'glass', 'slabs'].forEach((name, k) => { if (parts[k]) { parts[k].name = name; model.add(parts[k]); } });

    root.add(model);
    model.scale.y = grow < 1 ? 0.0001 : 1;

    // underlay plate (the original drawing, or a plain site)
    const plateTop = plate.material[2];
    plateTop.map = cfg.underlay ? plateTex : null;
    plateTop.color.set(cfg.underlay ? 0xffffff : 0xe6ebe0);
    plateTop.needsUpdate = true;

    buildLabels();
    return stats();
  }

  function stats() {
    const typeOf = (op) => overrides.get(op.key) || op.type;
    const count = (t) => analysis.openings.filter((op) => typeOf(op) === t).length;
    return {
      doors: count('door'), windows: count('window'), openings: count('opening'),
      rooms: analysis.rooms.length,
      width: analysis.width, depth: analysis.depth,
      builtUp: analysis.builtUp, carpet: analysis.carpet,
      coverage: analysis.coverage, walls: analysis.wallRects.length
    };
  }

  function buildLabels() {
    labelEls.forEach((l) => l.el.remove());
    labelEls = [];
    if (!labelsEl || !cfg.labels || (cfg.mode === 'full' && cfg.roof)) return;
    const A = analysis;
    const H = cfg.mode === 'cut' ? 1.2 : cfg.mode === 'massing' ? 0 : 0.1;
    A.rooms.filter((r) => r.area >= 2).forEach((r, k) => {
      const el = document.createElement('span');
      el.className = 'room-pin';
      el.innerHTML = `<b>${k + 1}</b>${r.area.toFixed(1)} m²`;
      labelsEl.appendChild(el);
      labelEls.push({ el, at: new THREE.Vector3((r.lx + 0.5 - A.cx) * A.cell, H + 0.05, (r.ly + 0.5 - A.cy) * A.cell) });
    });
  }

  function makePlate(source) {
    if (plate) { root.remove(plate); disposeTree(plate); }
    if (plateTex) plateTex.dispose();
    plateTex = new THREE.CanvasTexture(rasterise(source, 2048));
    plateTex.colorSpace = THREE.SRGBColorSpace;
    plateTex.anisotropy = 8;
    const A = analysis, W = A.gw * A.cell, D = A.gh * A.cell;
    const edge = new THREE.MeshLambertMaterial({ color: 0xe6ebe0 });
    const top = new THREE.MeshLambertMaterial({ map: plateTex });
    plate = new THREE.Mesh(new THREE.BoxGeometry(W, 0.12, D).translate(0, -0.06, 0), [edge, edge, top, edge, edge, edge]);
    plate.position.set((A.gw / 2 - A.cx) * A.cell, -0.005, (A.gh / 2 - A.cy) * A.cell);
    plate.receiveShadow = true;
    plate.name = 'drawing';
    root.add(plate);
    size = Math.max(W, D, A.width, A.depth);
    const r = size * 0.9;
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 0.5, far: size * 6 });
    sun.shadow.camera.updateProjectionMatrix();
    camera.far = size * 20;
    camera.updateProjectionMatrix();
    controls.maxDistance = size * 4;
    controls.minDistance = 1.5;
  }

  /* ---------- camera ---------- */
  let tween = null;
  const viewPose = (name) => {
    const A = analysis;
    const s = Math.max(A.width, A.depth);
    const k = Math.max(1, 1.25 / Math.max(0.2, camera.aspect));
    if (name === 'top') return { pos: new THREE.Vector3(0, s * 2.3 * k, 0.001), target: new THREE.Vector3(0, 0, 0) };
    if (name === 'eye') {
      // stand in the largest room, looking across it towards the middle of the house
      const room = A.rooms.reduce((a, b) => (b.area > a.area ? b : a), A.rooms[0]);
      const eyeY = Math.min(1.6, (cfg.mode === 'cut' ? 1.2 : cfg.wallHeight) + 0.4);
      if (!room) return { pos: new THREE.Vector3(0, eyeY, s), target: new THREE.Vector3(0, 1, 0) };
      // look down the room's long axis from near one end
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      A.roomRects.forEach(([x, y, w, h, id]) => {
        if (id !== room.id) return;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x + w); y0 = Math.min(y0, y); y1 = Math.max(y1, y + h);
      });
      const W = (gx) => (gx - A.cx) * A.cell, D = (gy) => (gy - A.cy) * A.cell;
      const px = W(room.lx + 0.5), pz = D(room.ly + 0.5);
      const pos = x1 - x0 >= y1 - y0
        ? new THREE.Vector3(W(lerp(x0, x1, 0.08)), eyeY, pz)
        : new THREE.Vector3(px, eyeY, D(lerp(y0, y1, 0.08)));
      const target = x1 - x0 >= y1 - y0
        ? new THREE.Vector3(W(x1), eyeY - 0.2, pz)
        : new THREE.Vector3(px, eyeY - 0.2, D(y1));
      return { pos, target };
    }
    const d = s * 1.75 * k;
    return { pos: new THREE.Vector3(d * 0.55, d * 1.05, d * 0.72), target: new THREE.Vector3(0, cfg && cfg.mode === 'full' ? 0.8 : 0.3, 0) };
  };
  const goTo = (name, snap) => {
    const p = viewPose(name);
    if (snap || reduced) {
      camera.position.copy(p.pos); controls.target.copy(p.target); controls.update(); tween = null; return;
    }
    tween = { fromP: camera.position.clone(), fromT: controls.target.clone(), toP: p.pos, toT: p.target, t: 0 };
  };

  /* ---------- picking ---------- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  const pick = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(hits, false)[0];
    return hit ? hit.object.userData.opening : -1;
  };
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || !analysis || cfg.mode === 'massing') return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 5) return;
    const i = pick(e);
    if (i < 0) return;
    const op = analysis.openings[i];
    const order = ['door', 'window', 'opening', 'wall'];
    const cur = overrides.get(op.key) || op.type;
    const next = order[(order.indexOf(cur) + 1) % order.length];
    if (next === op.type) overrides.delete(op.key); else overrides.set(op.key, next);
    const st = build();
    onPick && onPick(next, st);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons || !analysis || cfg.mode === 'massing') { canvas.style.cursor = ''; return; }
    canvas.style.cursor = pick(e) >= 0 ? 'pointer' : '';
  });

  /* ---------- loop ---------- */
  let aspect = 1, visible = true;
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    aspect = w / h;
    renderer.setSize(w, h, false);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(canvas);

  const v = new THREE.Vector3();
  let prev = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    if (visible && !document.hidden && model) {
      if (grow < 1) {
        grow = Math.min(1, grow + dt / 1.3);
        model.scale.y = Math.max(0.0001, 1 - Math.pow(1 - grow, 3));
      }
      if (tween) {
        tween.t = Math.min(1, tween.t + dt / 0.9);
        const k = 1 - Math.pow(1 - tween.t, 3);
        camera.position.lerpVectors(tween.fromP, tween.toP, k);
        controls.target.lerpVectors(tween.fromT, tween.toT, k);
        if (tween.t >= 1) tween = null;
      }
      controls.update();
      renderer.render(scene, camera);
      if (labelEls.length) {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        labelEls.forEach((l) => {
          v.copy(l.at); v.y *= model.scale.y;
          v.project(camera);
          const inside = camera.position.y < (cfg.mode === 'cut' ? 1.2 : cfg.wallHeight * cfg.storeys);   // labels would show through walls
          const off = inside || v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05;
          l.el.style.opacity = off ? 0 : 1;
          l.el.style.transform = `translate(${((v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -50%)`;
        });
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  /* ---------- API ---------- */
  return {
    /** New drawing: analyse, build, frame the camera. */
    load(source, config) {
      cfg = { ...config };
      analysis = analysePlan(source, cfg);
      if (!analysis) return null;
      overrides.clear();
      makePlate(source);
      setSun(sunT);
      grow = reduced ? 1 : 0;
      const st = build();
      goTo('persp', true);
      this.source = source;
      return st;
    },
    /** Re-run detection (scale or detection settings changed). */
    reanalyse(config) {
      if (!this.source) return null;
      cfg = { ...config };
      const a = analysePlan(this.source, cfg);
      if (!a) return null;
      analysis = a;
      makePlate(this.source);
      setSun(sunT);
      return build();
    },
    /** Rebuild geometry only (mode, style, height, element toggles). */
    configure(config) {
      if (!analysis) return null;
      const modeChanged = cfg.mode !== config.mode;
      cfg = { ...config };
      const st = build();
      if (modeChanged) goTo(cfg.mode === 'cut' ? 'persp' : 'persp');
      return st;
    },
    view: (name) => analysis && goTo(name),
    setSun: (t) => setSun(t),
    replay() { if (!reduced && model) grow = 0; },
    resetOpenings() { overrides.clear(); return analysis ? build() : null; },
    get analysis() { return analysis; },
    typeOf: (op) => overrides.get(op.key) || op.type,
    stats: () => (analysis ? stats() : null),

    /** PNG of the current view. */
    snapshot() {
      renderer.render(scene, camera);
      return new Promise((res) => canvas.toBlob(res, 'image/png'));
    },

    /** Binary glTF of the model and its drawing plate. */
    async exportGLB() {
      const { GLTFExporter } = await import('../vendor/addons/GLTFExporter.js');
      hits.forEach((h) => { h.visible = false; });
      try {
        const out = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
        return new Blob([out], { type: 'model/gltf-binary' });
      } finally {
        hits.forEach((h) => { h.visible = true; });
      }
    }
  };
}

/* ==========================================================================
   4. SAMPLE DRAWING — so the tool can be tried without a file
   ========================================================================== */
export function samplePlan() {
  const c = document.createElement('canvas');
  c.width = 1400; c.height = 1000;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = g.fillStyle = '#1c2119';
  g.lineCap = 'square';
  const wall = (x0, y0, x1, y1, t = 14) => { g.lineWidth = t; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  // 12 m × 8 m house drawn at 100 px per metre, origin (150, 150)
  const X = (m) => 150 + m * 100, Y = (m) => 150 + m * 100;
  const E = 23;                                    // outer wall thickness
  // outer walls with an entrance (S), windows on every side
  wall(X(0), Y(0), X(2), Y(0), E); wall(X(3.6), Y(0), X(5.6), Y(0), E); wall(X(7.2), Y(0), X(9.2), Y(0), E); wall(X(10.6), Y(0), X(12), Y(0), E);
  wall(X(12), Y(0), X(12), Y(1.5), E); wall(X(12), Y(3), X(12), Y(4.8), E); wall(X(12), Y(6), X(12), Y(8), E);
  wall(X(0), Y(8), X(1.5), Y(8), E); wall(X(3.3), Y(8), X(5), Y(8), E); wall(X(6), Y(8), X(10.3), Y(8), E); wall(X(11.7), Y(8), X(12), Y(8), E);
  wall(X(0), Y(0), X(0), Y(2.6), E); wall(X(0), Y(4), X(0), Y(8), E);
  // partitions with doors
  wall(X(4.5), Y(0), X(4.5), Y(3)); wall(X(4.5), Y(3.9), X(4.5), Y(4.6));
  wall(X(0), Y(4.6), X(1.6), Y(4.6)); wall(X(2.5), Y(4.6), X(8), Y(4.6));
  wall(X(8), Y(0), X(8), Y(2.4)); wall(X(8), Y(3.3), X(8), Y(4.6));
  wall(X(8), Y(4.6), X(8.6), Y(4.6)); wall(X(9.5), Y(4.6), X(12), Y(4.6));
  wall(X(9.6), Y(4.6), X(9.6), Y(5.3)); wall(X(9.6), Y(6.2), X(9.6), Y(8));
  wall(X(10.5), Y(6.2), X(12), Y(6.2));
  // window symbols (hairlines inside the gaps) — ignored by the solid-wall reading
  g.lineWidth = 2;
  const win = (x0, y0, x1, y1) => {
    g.beginPath();
    if (y0 === y1) { [-8, 0, 8].forEach((o) => { g.moveTo(x0, y0 + o); g.lineTo(x1, y1 + o); }); }
    else { [-8, 0, 8].forEach((o) => { g.moveTo(x0 + o, y0); g.lineTo(x1 + o, y1); }); }
    g.stroke();
  };
  win(X(2), Y(0), X(3.6), Y(0)); win(X(5.6), Y(0), X(7.2), Y(0)); win(X(9.2), Y(0), X(10.6), Y(0));
  win(X(12), Y(1.5), X(12), Y(3)); win(X(12), Y(4.8), X(12), Y(6)); win(X(0), Y(2.6), X(0), Y(4));
  win(X(1.5), Y(8), X(3.3), Y(8)); win(X(10.3), Y(8), X(11.7), Y(8));
  // door swings, furniture, dimensions, text — drafting marks to be ignored
  g.lineWidth = 1.5;
  const arc = (x, y, r, a0, a1) => { g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke(); };
  arc(X(5), Y(8), 100, Math.PI, 1.5 * Math.PI); arc(X(4.5), Y(3.9), 90, 0, 0.5 * Math.PI);
  arc(X(2.5), Y(4.6), 90, Math.PI, 1.5 * Math.PI); arc(X(8), Y(3.3), 90, 0.5 * Math.PI, Math.PI);
  arc(X(9.5), Y(4.6), 90, 0.5 * Math.PI, Math.PI); arc(X(9.6), Y(6.2), 90, 0, 0.5 * Math.PI);
  g.strokeRect(X(0.6), Y(0.6), 180, 210); g.strokeRect(X(9), Y(0.6), 160, 200);
  g.strokeRect(X(5.2), Y(0.5), 220, 60); g.strokeRect(X(1), Y(5.4), 200, 90);
  g.beginPath(); g.arc(X(6.3), Y(2.4), 55, 0, 7); g.stroke();
  g.beginPath(); g.moveTo(X(0), Y(-0.7)); g.lineTo(X(12), Y(-0.7));
  g.moveTo(X(0), Y(-0.85)); g.lineTo(X(0), Y(-0.55)); g.moveTo(X(12), Y(-0.85)); g.lineTo(X(12), Y(-0.55)); g.stroke();
  g.font = '500 24px sans-serif'; g.textAlign = 'center';
  [['BEDROOM', X(2.2), Y(2.5)], ['LIVING / DINING', X(6.3), Y(3.6)], ['BEDROOM', X(10), Y(2.6)],
    ['KITCHEN', X(1.8), Y(6.6)], ['VERANDAH', X(5.5), Y(6.5)], ['BATH', X(10.8), Y(7.3)], ['STORE', X(10.8), Y(5.5)]]
    .forEach(([t, x, y]) => g.fillText(t, x, y));
  g.font = '20px monospace';
  g.fillText('12 000', X(6), Y(-0.85));
  g.fillText('GROUND FLOOR PLAN · 1:100', X(6), Y(8.9));
  return c;
}
