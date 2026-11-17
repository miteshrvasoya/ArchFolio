/* ==========================================================================
   Plan analysis — reads a floor-plan image in the browser and finds walls,
   door/window openings, enclosed rooms and the building footprint.
   ========================================================================== */

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

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

/** Luminance → { lum, inverted } for a canvas. */
function luminance(canvas) {
  const w = canvas.width, h = canvas.height, n = w * h;
  const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const lum = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    mean += lum[i];
  }
  const inverted = mean / n < 110;                 // blueprint: light lines on dark
  if (inverted) for (let i = 0; i < n; i++) lum[i] = 255 - lum[i];
  return lum;
}

/** Typical wall stroke thickness in pixels: per dark pixel the shorter of its
    horizontal and vertical run, then a high percentile (walls dominate ink area). */
function strokeThickness(mask, w, h) {
  const hr = new Uint16Array(mask.length);
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!mask[y * w + x]) { x++; continue; }
      const s = x;
      while (x < w && mask[y * w + x]) x++;
      hr.fill(Math.min(x - s, 65535), y * w + s, y * w + x);
    }
  }
  const hist = new Float64Array(129);
  let total = 0;
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!mask[y * w + x]) { y++; continue; }
      const s = y;
      while (y < h && mask[y * w + x]) y++;
      const v = y - s;
      for (let k = s; k < y; k++) {
        const t = Math.min(128, Math.min(v, hr[k * w + x]));
        if (t >= 2) { hist[t]++; total++; }
      }
    }
  }
  if (!total) return 2;
  let acc = 0;
  for (let t = 2; t <= 128; t++) { acc += hist[t]; if (acc >= total * 0.7) return t; }
  return 128;
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

function dropSmall(mask, gw, gh, cleanup) {
  const cc = components(mask, gw, gh, true);
  const biggest = cc.size.reduce((a, b) => Math.max(a, b), 0);
  const min = Math.min(biggest, Math.round(lerp(1, 0.2 * biggest + 0.0004 * gw * gh, cleanup * cleanup)));
  for (let i = 0; i < mask.length; i++) if (mask[i] && cc.size[cc.label[i]] < min) mask[i] = 0;
}

/** Group the drawing's pieces into one building: start from the largest piece and
    add every piece whose box lies within `tol` cells of the group so far. Pieces of
    one wall broken by window or door gaps join; distant title blocks do not. */
function cluster(mask, gw, gh, tol) {
  const kc = components(mask, gw, gh, true);
  if (!kc.size.length) return null;
  let m = 0;
  kc.size.forEach((s, i) => { if (s > kc.size[m]) m = i; });
  const keep = kc.size.map((_, i) => i === m);
  let x0 = kc.minX[m], y0 = kc.minY[m], x1 = kc.maxX[m], y1 = kc.maxY[m];
  for (let grew = true; grew;) {
    grew = false;
    kc.size.forEach((_, i) => {
      if (keep[i]) return;
      if (kc.maxX[i] >= x0 - tol && kc.minX[i] <= x1 + tol && kc.maxY[i] >= y0 - tol && kc.minY[i] <= y1 + tol) {
        keep[i] = true; grew = true;
        x0 = Math.min(x0, kc.minX[i]); y0 = Math.min(y0, kc.minY[i]);
        x1 = Math.max(x1, kc.maxX[i]); y1 = Math.max(y1, kc.maxY[i]);
      }
    });
  }
  return { keep, label: kc.label, x0, y0, x1, y1 };
}

/** Square-kernel erode / dilate, separable. */
function morph(mask, gw, gh, r, erode) {
  const tmp = new Uint8Array(mask.length), out = new Uint8Array(mask.length);
  const want = erode ? 0 : 1;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let v = 1 - want;
    for (let k = -r; k <= r; k++) {
      const xx = x + k;
      if ((xx < 0 || xx >= gw ? 0 : mask[y * gw + xx]) === want) { v = want; break; }
    }
    tmp[y * gw + x] = v;
  }
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let v = 1 - want;
    for (let k = -r; k <= r; k++) {
      const yy = y + k;
      if ((yy < 0 || yy >= gh ? 0 : tmp[yy * gw + x]) === want) { v = want; break; }
    }
    out[y * gw + x] = v;
  }
  return out;
}

/** Fill pin-holes and notches left by anti-aliasing inside wall strokes. */
function fillPinholes(mask, gw, gh) {
  const out = mask.slice();
  for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
    const i = y * gw + x;
    if (mask[i]) continue;
    const n4 = mask[i - 1] + mask[i + 1] + mask[i - gw] + mask[i + gw];
    if (n4 >= 3) out[i] = 1;
  }
  return out;
}

/** Cells in runs of empty space bounded by wall at both ends, minLen..maxLen long.
    With `cont`, at least one end must carry on as wall for `cont` cells in the
    run's direction — runs between two crossing wall faces (across a narrow
    room or corridor) are dropped. */
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
        let l = true, r = true;
        for (let k = 1; k <= cont && (l || r); k++) {
          if (l && (s - k < 0 || !mask[at(a, s - k)])) l = false;
          if (r && (b + k - 1 >= B || !mask[at(a, b + k - 1)])) r = false;
        }
        if (!cont || l || r) for (let k = s; k < b; k++) out[at(a, k)] = 1;
      }
    }
  }
  return out;
}

/** Greedy merge of equal non-zero labels into rectangles [x, y, w, h, label]. */
export function rectMerge(labels, gw, gh) {
  const used = new Uint8Array(labels.length);
  const rects = [];
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
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
  return rects;
}

/** Chamfer distance from each inside cell to the nearest outside cell. */
function distanceField(inside, gw, gh) {
  const d = new Float32Array(inside.length);
  for (let i = 0; i < d.length; i++) d[i] = inside[i] ? 1e9 : 0;
  const pass = (fwd) => {
    const s = fwd ? 1 : -1;
    for (let y = fwd ? 0 : gh - 1; fwd ? y < gh : y >= 0; y += s) {
      for (let x = fwd ? 0 : gw - 1; fwd ? x < gw : x >= 0; x += s) {
        const i = y * gw + x;
        if (!d[i]) continue;
        let v = d[i];
        const px = x - s, py = y - s;
        if (px >= 0 && px < gw) v = Math.min(v, d[i - s] + 1);
        if (py >= 0 && py < gh) {
          v = Math.min(v, d[i - s * gw] + 1);
          if (px >= 0 && px < gw) v = Math.min(v, d[i - s * gw - s] + 1.414);
          const nx = x + s;
          if (nx >= 0 && nx < gw) v = Math.min(v, d[i - s * gw + s] + 1.414);
        }
        d[i] = v;
      }
    }
  };
  pass(true); pass(false);
  return d;
}

/** Largest axis-aligned rectangle of cells with roomOf === id inside a bounding box. */
function maxRect(roomOf, gw, id, x0, y0, x1, y1) {
  const w = x1 - x0 + 1;
  const hts = new Int32Array(w);
  let best = { area: 0, x: x0, y: y0, w: 1, h: 1 };
  const stack = [];
  for (let y = y0; y <= y1; y++) {
    for (let k = 0; k < w; k++) hts[k] = roomOf[y * gw + x0 + k] === id ? hts[k] + 1 : 0;
    stack.length = 0;
    for (let k = 0; k <= w; k++) {
      const hgt = k < w ? hts[k] : 0;
      let start = k;
      while (stack.length && stack[stack.length - 1][1] >= hgt) {
        const [s, sh] = stack.pop();
        const area = sh * (k - s);
        if (area > best.area) best = { area, x: x0 + s, y: y - sh + 1, w: k - s, h: sh };
        start = s;
      }
      stack.push([start, hgt]);
    }
  }
  return best;
}

/**
 * Options
 *  width        real outer width of the building, metres
 *  sensitivity  0..1  how light a line may be and still count as wall
 *  cleanup      0..1  how aggressively small detached marks are dropped
 *  wallStyle    'solid' (filled strokes) | 'outlined' (two parallel lines)
 *  maxOpening   widest gap, metres, read as a door/window rather than open space
 *  exterior     'auto' | 'window' | 'door'
 */
export function analysePlan(source, o) {
  // --- 1. measure the drawing's wall thickness to choose a working resolution ---
  const probe = rasterise(source, 1400);
  const plum = luminance(probe);
  const cut = lerp(70, 215, o.sensitivity);
  const pmask = new Uint8Array(plum.length);
  for (let i = 0; i < plum.length; i++) pmask[i] = plum[i] < cut ? 1 : 0;
  const T = strokeThickness(pmask, probe.width, probe.height);
  const probeLong = Math.max(probe.width, probe.height);
  // aim for ~8 cells across a typical wall: thin enough strokes survive, hairlines don't
  const gridLong = Math.round(clamp(probeLong * 8 / T, 360, 1100));
  const small = gridLong >= probeLong ? probe : rasterise(source, gridLong);
  const gw = small.width, gh = small.height, n = gw * gh;
  const Tg = T * (Math.max(gw, gh) / probeLong);
  const lum = small === probe ? plum : luminance(small);

  let wall = new Uint8Array(n);
  const ink = new Uint8Array(n);
  for (let i = 0; i < n; i++) { wall[i] = lum[i] < cut ? 1 : 0; ink[i] = lum[i] < 232 ? 1 : 0; }

  // --- 2. drop sheet borders / title-block frames: huge, almost empty outlines ---
  let cc = components(wall, gw, gh, true);
  if (!cc.size.length) return null;
  const frame = cc.size.map((s, i) => {
    const bw = cc.maxX[i] - cc.minX[i] + 1, bh = cc.maxY[i] - cc.minY[i] + 1;
    return bw > gw * 0.85 && bh > gh * 0.85 && s / (bw * bh) < 0.015;
  });
  if (frame.some(Boolean)) {
    for (let i = 0; i < n; i++) if (wall[i] && frame[cc.label[i]]) wall[i] = 0;
    cc = components(wall, gw, gh, true);
    if (!cc.size.length) return null;
  }

  // --- 3. first scale estimate from the building's extent ---
  const tol = Math.round(12 * Math.max(Tg, 2.5));
  const c0 = cluster(wall, gw, gh, tol);
  const cell0 = o.width / Math.max(8, c0.x1 - c0.x0 + 1);

  // --- 4. normalise wall strokes ---
  if (o.wallStyle === 'outlined') {
    const k = Math.max(1, Math.round(0.35 / cell0));
    const hb = runBridges(wall, gw, gh, 1, k, true);
    for (let i = 0; i < n; i++) wall[i] |= hb[i];
    const vb = runBridges(wall, gw, gh, 1, k, false);
    for (let i = 0; i < n; i++) wall[i] |= vb[i];
    // single lines that were not half of a wall (dimensions, furniture, grid bubbles) stay thin
    wall = morph(morph(wall, gw, gh, 1, true), gw, gh, 1, false);
  } else if (Tg >= 4.5) {
    // strip hairlines (window symbols, hatching, dimension and swing lines)
    const r = Tg >= 11 ? 2 : 1;
    wall = morph(morph(wall, gw, gh, r, true), gw, gh, r, false);
  }
  wall = fillPinholes(wall, gw, gh);
  dropSmall(wall, gw, gh, o.cleanup);

  // keep only drawing that belongs to the building: dimension chains, grid
  // bubbles, scale bars and title blocks away from it would float in the model
  {
    const k = cluster(wall, gw, gh, tol);
    if (k) for (let i = 0; i < n; i++) if (wall[i] && !k.keep[k.label[i]]) wall[i] = 0;
  }

  // --- 5. final scale from the walls' bounding box ---
  let bx0 = gw, by0 = gh, bx1 = -1, by1 = -1;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    if (!wall[y * gw + x]) continue;
    if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
  }
  if (bx1 < 0) return null;
  const cell = o.width / (bx1 - bx0 + 1);
  const cx = (bx0 + bx1 + 1) / 2, cy = (by0 + by1 + 1) / 2;

  // --- 6. openings ---
  // A door or window is a short gap that starts at a free end of a wall, where
  // the same wall carries on past the gap. A gap that merely runs from one wall
  // face to another (across a corridor, or from a T-junction) is open space.
  const minLen = Math.max(2, Math.round(0.45 / cell));
  const maxLen = Math.max(minLen + 1, Math.round(o.maxOpening / cell));
  const maxThick = Math.max(2, Math.round(0.6 / cell));
  const cont = Math.max(3, Math.round(0.2 / cell));
  const W = (x, y) => x >= 0 && y >= 0 && x < gw && y < gh && wall[y * gw + x] === 1;
  const openIdx = new Int32Array(n);
  const openings = [];

  [true, false].forEach((horizontal) => {
    const br = runBridges(wall, gw, gh, minLen, maxLen, horizontal, cont);
    const bc = components(br, gw, gh, false);
    bc.size.forEach((_, id) => {
      const x = bc.minX[id], y = bc.minY[id];
      const w = bc.maxX[id] - x + 1, h = bc.maxY[id] - y + 1;
      const along = horizontal ? w : h, across = horizontal ? h : w;
      if (across > maxThick || along < minLen) return;

      // in run coordinates: a = along the gap, b = across it
      const cellAt = (a, b) => (horizontal ? W(a, b) : W(b, a));
      const a0 = horizontal ? x : y, a1 = a0 + along - 1;
      const b0 = horizontal ? y : x, b1 = b0 + across - 1;
      const endOk = (dir) => {
        const start = dir < 0 ? a0 - 1 : a1 + 1;
        let wallCells = 0, total = 0, empty = 0, sides = 0;
        for (let k = 0; k < cont; k++) {
          const a = start + dir * k;
          for (let b = b0; b <= b1; b++) { total++; if (cellAt(a, b)) wallCells++; }
          {
            sides += 2;
            if (!cellAt(a, b0 - 1)) empty++;
            if (!cellAt(a, b1 + 1)) empty++;
          }
        }
        return wallCells / total >= 0.8 && empty / sides >= 0.6;   // continues, and is a free end
      };
      if (!endOk(-1) && !endOk(1)) return;

      // both faces of the opening look onto space, not onto more wall
      const face = (b) => {
        let c = 0;
        for (let a = a0; a <= a1; a++) if (cellAt(a, b)) c++;
        return c / along;
      };
      if (face(b0 - 1) > 0.5 || face(b1 + 1) > 0.5) return;

      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
        if (br[yy * gw + xx] && openIdx[yy * gw + xx]) return;
      }
      const idx = openings.length + 1;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
        if (bc.label[yy * gw + xx] === id) openIdx[yy * gw + xx] = idx;
      }
      openings.push({ x, y, w, h, dir: horizontal ? 'h' : 'v', key: `${x},${y},${w},${h}` });
    });
  });

  // --- 7. outside vs rooms ---
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
  const dist = distanceField(inner, gw, gh);
  const minRoom = 0.8 / (cell * cell);
  const remap = new Int32Array(rc.size.length);
  const rooms = [];
  rc.size.forEach((size, id) => {
    if (size < minRoom) return;
    remap[id] = rooms.length + 1;
    rooms.push({
      id: rooms.length + 1, cells: size, area: size * cell * cell,
      bx0: rc.minX[id], by0: rc.minY[id], bx1: rc.maxX[id], by1: rc.maxY[id],
      lx: 0, ly: 0, best: -1
    });
  });
  const roomOf = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (!inner[i]) continue;
    const id = remap[rc.label[i]];
    roomOf[i] = id;
    if (!id) continue;
    const r = rooms[id - 1];
    if (dist[i] > r.best) { r.best = dist[i]; r.lx = i % gw; r.ly = (i - r.lx) / gw; }
  }
  rooms.forEach((r) => {
    r.rect = maxRect(roomOf, gw, r.id, r.bx0, r.by0, r.bx1, r.by1);
    r.exteriorWindows = 0; r.doors = 0; r.entrance = false;
  });

  // --- 8. classify openings ---
  const isOut = (x, y) => x < 0 || y < 0 || x >= gw || y >= gh || outside[y * gw + x];
  const roomAt = (x, y) => (x < 0 || y < 0 || x >= gw || y >= gh ? 0 : roomOf[y * gw + x]);
  const probeRoom = (x, y, dx, dy) => {
    for (let k = 1; k <= maxThick; k++) {
      const r = roomAt(x + dx * k, y + dy * k);
      if (r || isOut(x + dx * k, y + dy * k)) return r;
    }
    return 0;
  };
  openings.forEach((op) => {
    const len = (op.dir === 'h' ? op.w : op.h) * cell;
    op.length = len;
    const mx = op.x + (op.w >> 1), my = op.y + (op.h >> 1);
    const a = op.dir === 'h' ? [mx, op.y - 2] : [op.x - 2, my];
    const b = op.dir === 'h' ? [mx, op.y + op.h + 1] : [op.x + op.w + 1, my];
    const outA = isOut(...a), outB = isOut(...b);
    op.exterior = outA || outB;
    op.roomA = op.dir === 'h' ? probeRoom(mx, op.y, 0, -1) : probeRoom(op.x, my, -1, 0);
    op.roomB = op.dir === 'h' ? probeRoom(mx, op.y + op.h - 1, 0, 1) : probeRoom(op.x + op.w - 1, my, 1, 0);
    op.swing = outA ? 1 : outB ? -1 : op.roomA ? -1 : 1;           // -1 → side A, +1 → side B

    let inked = 0;
    for (let yy = op.y; yy < op.y + op.h; yy++) for (let xx = op.x; xx < op.x + op.w; xx++) inked += ink[yy * gw + xx];
    const symbol = inked / (op.w * op.h) > 0.12;
    if (symbol && o.exterior === 'auto') op.type = 'window';
    else if (op.exterior) op.type = o.exterior === 'window' ? 'window' : o.exterior === 'door' ? 'door' : len <= 1.1 ? 'door' : 'window';
    else op.type = len <= 1.35 ? 'door' : 'opening';
  });

  // --- 9. rectangles and footprint ---
  const wallRects = rectMerge(wall, gw, gh);
  const roomRects = rectMerge(roomOf, gw, gh);
  const foot = new Uint8Array(n);
  for (let i = 0; i < n; i++) foot[i] = closed[i] || roomOf[i] ? 1 : 0;
  const footRects = rectMerge(foot, gw, gh);
  // a 0.15 m ring just inside the footprint edge, for parapets
  const ringW = Math.max(1, Math.round(0.15 / cell));
  let edge = new Uint8Array(n);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const i = y * gw + x;
    if (!foot[i]) continue;
    if (x === 0 || y === 0 || x === gw - 1 || y === gh - 1 || !foot[i - 1] || !foot[i + 1] || !foot[i - gw] || !foot[i + gw]) edge[i] = 1;
  }
  if (ringW > 1) { edge = morph(edge, gw, gh, ringW - 1, false); for (let i = 0; i < n; i++) edge[i] &= foot[i]; }
  const ringRects = rectMerge(edge, gw, gh);

  let footCells = 0, wallCells = 0;
  for (let i = 0; i < n; i++) { footCells += foot[i]; wallCells += wall[i]; }

  return {
    gw, gh, cell, cx, cy, grid: `${gw}×${gh}`, stroke: Tg,
    width: o.width, depth: (by1 - by0 + 1) * cell,
    bbox: { x0: bx0, y0: by0, x1: bx1 + 1, y1: by1 + 1 },
    wall, openIdx, roomOf, outside,
    wallRects, roomRects, footRects, ringRects, openings, rooms,
    builtUp: footCells * cell * cell,
    carpet: rooms.reduce((s, rm) => s + rm.area, 0),
    coverage: wallCells / n
  };
}
