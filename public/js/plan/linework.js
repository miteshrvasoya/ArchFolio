/* ==========================================================================
   Linework — tells walls apart from the rest of a 2D plan's drafting.

   Conventions used (as an architect reads a plan):
   · walls are the heaviest, longest, straightest strokes and form a connected
     network; drawn either filled (poché) or as two parallel lines, often hatched
   · dashed / dotted lines show things above or below the cut plane (beams,
     lofts, chajjas, hidden edges) — never walls
   · text, dimension figures and symbols are rows of small marks
   · a staircase is a run of evenly spaced parallel treads
   · furniture is drawn as free-standing outlines inside rooms
   · a window is a wall drawn with glazing lines running inside its thickness
   · a door is a gap with a leaf and a swing arc; nothing solid can stand in
     the swing zone
   All functions work on a binary raster (1 = ink) of gw × gh cells.
   ========================================================================== */

/** Connected components of non-zero cells (8- or 4-connected). */
export function components(mask, gw, gh, eight) {
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

/** Per-cell stroke thickness: the shorter of its horizontal and vertical ink run. */
export function thicknessMap(mask, w, h) {
  const hr = new Uint16Array(mask.length), t = new Uint16Array(mask.length);
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!mask[y * w + x]) { x++; continue; }
      const s = x;
      while (x < w && mask[y * w + x]) x++;
      hr.fill(Math.min(x - s, 65535), y * w + s, y * w + x);
    }
  }
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!mask[y * w + x]) { y++; continue; }
      const s = y;
      while (y < h && mask[y * w + x]) y++;
      for (let k = s; k < y; k++) t[k * w + x] = Math.min(y - s, hr[k * w + x]);
    }
  }
  return t;
}

/** Typical stroke thickness (70th percentile of inked cells, px) and the share of
    ink in heavy strokes — high for filled walls, low for line drawings. */
export function strokeStats(mask, w, h) {
  const t = thicknessMap(mask, w, h);
  const hist = new Float64Array(129);
  let total = 0, heavy = 0;
  for (let i = 0; i < t.length; i++) {
    const v = t[i];
    if (v < 2) continue;
    hist[Math.min(128, v)]++; total++;
    if (v >= 5) heavy++;
  }
  if (!total) return { T: 2, heavyShare: 0 };
  let acc = 0, T = 128;
  for (let v = 2; v <= 128; v++) { acc += hist[v]; if (acc >= total * 0.7) { T = v; break; } }
  return { T, heavyShare: heavy / total };
}

/**
 * Dashed and dotted lines, text and small symbols: rows of small marks.
 * A small mark is removed when it is a speck, or when another mark of similar
 * size sits next to it in line (a dash pattern, a word). Solid blobs such as
 * columns are kept.
 */
export function removeMarks(mask, gw, gh, cell) {
  const cc = components(mask, gw, gh, true);
  const maxLong = 0.55 / cell, speck = Math.max(2, 0.06 / cell);
  const items = [];
  cc.size.forEach((s, i) => {
    const bw = cc.maxX[i] - cc.minX[i] + 1, bh = cc.maxY[i] - cc.minY[i] + 1;
    const long = Math.max(bw, bh), short = Math.min(bw, bh);
    if (long > maxLong) return;
    const solid = s / (bw * bh) > 0.86 && short * cell >= 0.18 && long / short < 2.5;   // column-like (bold letters have holes)
    items.push({ i, long, short, solid });
  });
  const remove = new Uint8Array(cc.size.length);
  // words and symbols: compact pieces with no long straight stroke in them
  // (a wall piece, even a short one, is two full-length lines)
  cc.size.forEach((s, i) => {
    const bw = cc.maxX[i] - cc.minX[i] + 1, bh = cc.maxY[i] - cc.minY[i] + 1;
    const long = Math.max(bw, bh), short = Math.min(bw, bh);
    if (long <= maxLong || long * cell > 4 || short * cell > 0.5 || s / (bw * bh) > 0.6) return;
    let run = 0;
    for (let y = cc.minY[i]; y <= cc.maxY[i]; y++) {
      let r = 0;
      for (let x = cc.minX[i]; x <= cc.maxX[i]; x++) { r = cc.label[y * gw + x] === i ? r + 1 : 0; if (r > run) run = r; }
    }
    for (let x = cc.minX[i]; x <= cc.maxX[i]; x++) {
      let r = 0;
      for (let y = cc.minY[i]; y <= cc.maxY[i]; y++) { r = cc.label[y * gw + x] === i ? r + 1 : 0; if (r > run) run = r; }
    }
    if (run < 0.35 * long) remove[i] = 1;
  });
  // bucket by position so neighbour search stays cheap
  const B = Math.max(8, Math.round(maxLong));
  const buckets = new Map();
  const key = (bx, by) => bx * 73856093 ^ by * 19349663;
  items.forEach((it) => {
    const k = key(Math.floor(cc.minX[it.i] / B), Math.floor(cc.minY[it.i] / B));
    (buckets.get(k) || buckets.set(k, []).get(k)).push(it);
  });
  items.forEach((it) => {
    if (it.solid) return;
    if (it.long <= speck) { remove[it.i] = 1; return; }
    const i = it.i, gap = Math.max(0.3 / cell, 1.6 * it.long);
    const bx = Math.floor(cc.minX[i] / B), by = Math.floor(cc.minY[i] / B);
    for (let dx = -1; dx <= 1 && !remove[i]; dx++) for (let dy = -1; dy <= 1 && !remove[i]; dy++) {
      for (const jt of buckets.get(key(bx + dx, by + dy)) || []) {
        if (jt === it || jt.solid) continue;
        const j = jt.i;
        if (jt.long > it.long * 3 + 2 || it.long > jt.long * 3 + 2) continue;
        const gx = Math.max(0, cc.minX[j] - cc.maxX[i], cc.minX[i] - cc.maxX[j]);
        const gy = Math.max(0, cc.minY[j] - cc.maxY[i], cc.minY[i] - cc.maxY[j]);
        const inLine = (gy === 0 && gx <= gap) || (gx === 0 && gy <= gap) || (gx <= gap * 0.6 && gy <= gap * 0.6);
        if (inLine) { remove[i] = 1; remove[j] = 1; break; }
      }
    }
  });
  let count = 0;
  for (let p = 0; p < mask.length; p++) if (mask[p] && remove[cc.label[p]]) { mask[p] = 0; count++; }
  return count;
}

/**
 * Staircases: five or more parallel lines of similar extent at an even tread
 * spacing (0.15–0.4 m). The whole flight — treads, stringers, arrow — is erased.
 */
export function removeStairs(mask, gw, gh, cell) {
  const minLen = Math.round(0.6 / cell), minSp = Math.round(0.15 / cell), maxSp = Math.round(0.42 / cell);
  const th = thicknessMap(mask, gw, gh), thin = Math.max(2, 0.07 / cell);
  let flights = 0;
  [true, false].forEach((horizontal) => {
    const A = horizontal ? gh : gw, Bn = horizontal ? gw : gh;
    const at = horizontal ? (a, b) => a * gw + b : (a, b) => b * gw + a;
    const runs = Array.from({ length: A }, () => []);
    for (let a = 0; a < A; a++) {
      let b = 0;
      while (b < Bn) {
        if (!mask[at(a, b)]) { b++; continue; }
        const s = b;
        while (b < Bn && mask[at(a, b)]) b++;
        if (b - s >= minLen) {
          const t = [0.2, 0.35, 0.65, 0.8].map((f) => th[at(a, Math.round(s + (b - 1 - s) * f))]).sort((p, q) => p - q)[1];
          if (t <= thin) runs[a].push([s, b - 1]);
        }
      }
    }
    const overlap = (r, q) => (Math.min(r[1], q[1]) - Math.max(r[0], q[0])) / Math.min(r[1] - r[0], q[1] - q[0]);
    const boxes = [];
    for (let a = 0; a < A; a++) {
      for (const r of runs[a]) {
        if (r.used) continue;
        const seq = [[a, r]];
        let last = a, step = null;
        for (;;) {
          let found = null;
          const lo = last + (step ? Math.round(step * 0.75) : minSp), hi = last + (step ? Math.round(step * 1.25) + 1 : maxSp);
          for (let a2 = lo; a2 <= Math.min(A - 1, hi) && !found; a2++) {
            for (const q of runs[a2]) if (!q.used && overlap(r, q) > 0.8 && Math.abs((q[1] - q[0]) - (r[1] - r[0])) < 0.25 * (r[1] - r[0])) { found = [a2, q]; break; }
          }
          if (!found) break;
          step = step || found[0] - last;
          seq.push(found); last = found[0];
        }
        if (seq.length >= 5) {
          seq.forEach(([, q]) => { q.used = true; });
          const box = { a0: seq[0][0], a1: last, b0: Math.min(...seq.map(([, q]) => q[0])), b1: Math.max(...seq.map(([, q]) => q[1])), step };
          // carry on past the ends while rows are inked across the flight but stay
          // inside its width (an arrowhead can break a tread; a wall carries on past it)
          const wB = box.b1 - box.b0;
          const near = (a2) => {
            if (a2 < 0 || a2 >= A) return false;
            let inkC = 0;
            for (let b2 = box.b0; b2 <= box.b1; b2++) inkC += mask[at(a2, b2)];
            if (inkC < 0.5 * wB) return false;
            const out = Math.round(0.2 * wB) + 3;
            let beyond = 0;
            for (let b2 = Math.max(0, box.b0 - out); b2 < box.b0 - 2; b2++) beyond += mask[at(a2, b2)];
            for (let b2 = box.b1 + 3; b2 <= Math.min(Bn - 1, box.b1 + out); b2++) beyond += mask[at(a2, b2)];
            return beyond < 0.5 * (out - 2);
          };
          for (let k = 1; k <= 3; k++) {
            let ext = false;
            for (let a2 = box.a1 + Math.round(step * 0.6); a2 <= Math.min(A - 1, box.a1 + Math.round(step * 1.4)); a2++) if (near(a2)) { box.a1 = a2; ext = true; break; }
            for (let a2 = box.a0 - Math.round(step * 0.6); a2 >= Math.max(0, box.a0 - Math.round(step * 1.4)); a2--) if (near(a2)) { box.a0 = a2; ext = true; break; }
            if (!ext) break;
          }
          boxes.push(box);
        }
      }
    }
    for (let i = 0; i < boxes.length; i++) for (let j = boxes.length - 1; j > i; j--) {
      const p = boxes[i], q = boxes[j];
      const va = Math.min(p.a1, q.a1) - Math.max(p.a0, q.a0), gapB = Math.max(q.b0 - p.b1, p.b0 - q.b1);
      if (va > 0.5 * Math.min(p.a1 - p.a0, q.a1 - q.a0) && gapB < Math.max(p.step, 6)) {
        p.a0 = Math.min(p.a0, q.a0); p.a1 = Math.max(p.a1, q.a1); p.b0 = Math.min(p.b0, q.b0); p.b1 = Math.max(p.b1, q.b1);
        boxes.splice(j, 1);
      }
    }
    boxes.forEach((bx) => {
      const pad = Math.max(2, Math.round(bx.step * 0.45));
      for (let a = Math.max(0, bx.a0 - pad); a <= Math.min(A - 1, bx.a1 + pad); a++) {
        for (let b = Math.max(0, bx.b0 - 2); b <= Math.min(Bn - 1, bx.b1 + 2); b++) mask[at(a, b)] = 0;
      }
      flights++;
    });
  });
  return flights;
}

/**
 * Furniture: free-standing outlines (beds, tables, counters, wardrobes). In a
 * two-line drawing every wall line has a parallel partner a wall's thickness
 * away (0.05–0.38 m); furniture lines do not. Pieces that are small next to the
 * wall network and mostly unpaired are removed, so they are not filled in as wall.
 */
export function removeFurniture(mask, gw, gh, cell, lineW = 2) {
  const lo = Math.max(1, Math.round(0.04 / cell)), hi = Math.round(0.38 / cell);
  const cc = components(mask, gw, gh, true);
  const paired = new Uint8Array(mask.length);
  [true, false].forEach((horizontal) => {
    const A = horizontal ? gh : gw, Bn = horizontal ? gw : gh;
    const at = horizontal ? (a, b) => a * gw + b : (a, b) => b * gw + a;
    for (let a = 0; a < A; a++) {
      let b = 0;
      while (b < Bn && !mask[at(a, b)]) b++;
      while (b < Bn) {
        while (b < Bn && mask[at(a, b)]) b++;
        const s0 = b;
        while (b < Bn && !mask[at(a, b)]) b++;
        const len = b - s0;
        if (b < Bn && len >= lo && len <= hi) { paired[at(a, s0 - 1)] = 1; paired[at(a, b)] = 1; }
      }
    }
  });
  const biggest = cc.size.reduce((a, b) => Math.max(a, b), 0);
  const pc = new Float64Array(cc.size.length);
  for (let p = 0; p < mask.length; p++) if (mask[p] && paired[p]) pc[cc.label[p]]++;
  // share of a shape's length that has a partner at wall spacing: room outlines
  // are paired all round (every wall face has another face behind it), furniture
  // beside a wall along one edge at most
  let count = 0;
  const remove = cc.size.map((s, i) => {
    if (s >= biggest * 0.08) return false;
    const bw = cc.maxX[i] - cc.minX[i] + 1, bh = cc.maxY[i] - cc.minY[i] + 1;
    if (s / (bw * bh) > 0.6) return false;                  // solid blob: column
    return (pc[i] * Math.max(1, lineW)) / s < 0.5;
  });
  for (let p = 0; p < mask.length; p++) if (mask[p] && remove[cc.label[p]]) { mask[p] = 0; count++; }
  return count;
}

/**
 * Windows in two-line drawings: a long line running inside a wall's thickness,
 * with empty space between it and both faces of the wall (glazing / sill lines).
 * Hatching is diagonal and plain walls have nothing inside, so neither matches.
 * Returns a mask of wall cells that are really window.
 */
export function findWindows(wall, raw, gw, gh, cell, maxOpening = 2.4) {
  const out = new Uint8Array(wall.length);
  const minRun = Math.round(0.45 / cell), reach = Math.max(3, Math.round(0.3 / cell));
  const maxRun = Math.round((maxOpening + 0.3) / cell);       // glazing stops at the jambs
  const W = (x, y) => x >= 0 && y >= 0 && x < gw && y < gh && wall[y * gw + x];
  const R = (x, y) => x >= 0 && y >= 0 && x < gw && y < gh && raw[y * gw + x];
  [true, false].forEach((horizontal) => {
    const A = horizontal ? gh : gw, Bn = horizontal ? gw : gh;
    const xy = horizontal ? (a, b) => [b, a] : (a, b) => [a, b];
    // is the raw line at (a, b) separated from both wall faces by empty interior?
    const inside = (a, b) => {
      let up = false, dn = false;
      for (let k = 1; k <= reach && !up; k++) { const [x, y] = xy(a - k, b); if (!W(x, y)) break; if (!R(x, y)) up = true; }
      if (!up) return false;
      for (let k = 1; k <= reach && !dn; k++) { const [x, y] = xy(a + k, b); if (!W(x, y)) break; if (!R(x, y)) dn = true; }
      return dn;
    };
    for (let a = 0; a < A; a++) {
      let b = 0;
      while (b < Bn) {
        const [x, y] = xy(a, b);
        if (!(R(x, y) && W(x, y) && inside(a, b))) { b++; continue; }
        const s = b;
        while (b < Bn) { const [x2, y2] = xy(a, b); if (!(R(x2, y2) && W(x2, y2) && inside(a, b))) break; b++; }
        if (b - s < minRun || b - s > maxRun) continue;
        // a window is only as deep as a wall: anything fused to it (furniture) is not glazing
        const mid = Math.round((s + b) / 2);
        let depth = 0;
        for (let d = -reach * 3; d <= reach * 3; d++) { const [x2, y2] = xy(a + d, mid); if (W(x2, y2)) depth++; }
        if (depth * cell > 0.45) continue;
        for (let k = s; k < b; k++) {
          // mark the full wall thickness at this position
          for (let d = 0; d <= reach * 2; d++) { const [x2, y2] = xy(a - d, k); if (!W(x2, y2)) break; out[y2 * gw + x2] = 1; }
          for (let d = 1; d <= reach * 2; d++) { const [x2, y2] = xy(a + d, k); if (!W(x2, y2)) break; out[y2 * gw + x2] = 1; }
        }
      }
    }
  });
  return out;
}

/**
 * Keep strokes that read as walls: long straight runs (in any of eight
 * directions, so diagonal walls survive) or wall-thick blobs (piers, columns,
 * nibs). Short curved or thin strokes — swing arcs, symbols — are dropped,
 * except where they join a kept stroke within about a wall's thickness.
 */
/** Longest straight run of wall cells through each cell, over eight directions (in cells). */
export function straightRuns(wall, gw, gh) {
  const n = wall.length;
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1], [2, 1], [1, 2], [2, -1], [1, -2]];
  const best = new Float32Array(n);
  const fwd = new Uint16Array(n), bwd = new Uint16Array(n);
  dirs.forEach(([dx, dy]) => {
    const len = Math.hypot(dx, dy);
    // forward: depends on (x - dx, y - dy); rows ascending, x ascending when dy = 0
    for (let y = 0; y < gh; y++) {
      for (let xi = 0; xi < gw; xi++) {
        const x = dy === 0 || dx >= 0 ? xi : gw - 1 - xi;
        const i = y * gw + x;
        if (!wall[i]) { fwd[i] = 0; continue; }
        const px = x - dx, py = y - dy;
        fwd[i] = px >= 0 && px < gw && py >= 0 ? fwd[py * gw + px] + 1 : 1;
      }
    }
    for (let y = gh - 1; y >= 0; y--) {
      for (let xi = 0; xi < gw; xi++) {
        const x = dy === 0 || dx >= 0 ? gw - 1 - xi : xi;
        const i = y * gw + x;
        if (!wall[i]) { bwd[i] = 0; continue; }
        const nx = x + dx, ny = y + dy;
        bwd[i] = nx >= 0 && nx < gw && ny < gh ? bwd[ny * gw + nx] + 1 : 1;
      }
    }
    for (let i = 0; i < n; i++) if (wall[i]) best[i] = Math.max(best[i], (fwd[i] + bwd[i] - 1) * len);
  });
  return best;
}

export function keepStructural(wall, gw, gh, cell) {
  const n = wall.length;
  const best = straightRuns(wall, gw, gh);
  const th = thicknessMap(wall, gw, gh);
  // typical wall thickness
  const hist = new Float64Array(257);
  let tot = 0;
  for (let i = 0; i < n; i++) if (wall[i] && th[i] >= 2) { hist[Math.min(256, th[i])]++; tot++; }
  let acc = 0, Tw = 4;
  for (let v = 2; v <= 256; v++) { acc += hist[v]; if (acc >= tot * 0.7) { Tw = v; break; } }
  const minRun = 0.75 / cell, thickMin = Math.max(0.6 * Tw, 0.12 / cell);
  const reach = Math.max(2, Math.round(Tw));
  const dist = new Int32Array(n).fill(-1);
  const q = [];
  for (let i = 0; i < n; i++) if (wall[i] && (best[i] >= minRun || th[i] >= thickMin)) { dist[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % gw;
    if (dist[i] >= reach) continue;
    const nb = [x > 0 ? i - 1 : -1, x < gw - 1 ? i + 1 : -1, i - gw, i + gw];
    for (const j of nb) if (j >= 0 && j < n && wall[j] && dist[j] < 0) { dist[j] = dist[i] + 1; q.push(j); }
  }
  let removed = 0;
  for (let i = 0; i < n; i++) if (wall[i] && dist[i] < 0) { wall[i] = 0; removed++; }
  return { removed, Tw };
}

/**
 * Door swing zones: a leaf sweeps a quarter circle from its hinge, so nothing
 * solid can stand there. Inside each zone only a wall that passes straight
 * through it (a run longer than the zone) or a column survives; leaves, arcs,
 * counters or symbols drawn there are cleared. `isDoor(op)` picks the gaps that
 * can be doors (blank gaps — windows carry glazing lines).
 */
export function clearDoorSwings(wall, openings, gw, gh, cell, isDoor) {
  const best = straightRuns(wall, gw, gh);
  const th = thicknessMap(wall, gw, gh);
  const column = 0.21 / cell;
  let removed = 0;
  openings.forEach((op) => {
    const L = op.dir === 'h' ? op.w : op.h;
    if (L * cell < 0.55 || L * cell > 1.4 || !isDoor(op)) return;
    const R1 = L * 1.25;
    const jambs = op.dir === 'h' ? [[op.x - 0.5, 1], [op.x + op.w - 0.5, -1]] : [[op.y - 0.5, 1], [op.y + op.h - 0.5, -1]];
    const faces = op.dir === 'h' ? [[op.y - 1, -1], [op.y + op.h, 1]] : [[op.x - 1, -1], [op.x + op.w, 1]];
    // a door swings into one quadrant only: the one holding its leaf and arc
    let bestQ = null, bestN = 0;
    jambs.forEach(([ha, dirA]) => faces.forEach(([b0, dirB]) => {
      const aLo = Math.floor(dirA > 0 ? ha : ha - R1), aHi = Math.ceil(dirA > 0 ? ha + R1 : ha);
      const bLo = dirB > 0 ? b0 : Math.floor(b0 - R1), bHi = dirB > 0 ? Math.ceil(b0 + R1) : b0;
      const cells = [];
      for (let a = aLo; a <= aHi; a++) for (let b = bLo; b <= bHi; b++) {
        const x = op.dir === 'h' ? a : b, y = op.dir === 'h' ? b : a;
        if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
        const i = y * gw + x;
        if (!wall[i]) continue;
        const da = a - ha, db = b - (dirB > 0 ? b0 - 0.5 : b0 + 0.5);
        if (da * da + db * db > R1 * R1) continue;
        if (best[i] >= R1 * 1.1 || th[i] >= column) continue;
        cells.push(i);
      }
      if (cells.length > bestN) { bestN = cells.length; bestQ = cells; }
    }));
    if (bestQ && bestN >= 0.5 * L) {
      bestQ.forEach((i) => { wall[i] = 0; });
      removed += bestN;
    }
  });
  return removed;
}
