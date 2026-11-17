/* ==========================================================================
   Room types and furniture
   Guesses what each room is, then lays out simple, correctly sized furniture
   against the wall furthest from its doors, keeping door swings clear.
   Everything is built from boxes into per-material batches (few draw calls).
   ========================================================================== */

export const ROOM_TYPES = {
  living: 'Living',
  bedroom: 'Bedroom',
  kitchen: 'Kitchen',
  dining: 'Dining',
  bath: 'Bath / WC',
  study: 'Study',
  store: 'Store / Utility',
  passage: 'Passage',
  balcony: 'Balcony / Verandah',
  empty: 'Empty'
};

/** Best guess of each room's use from its size, shape and openings. */
export function guessRoomTypes(A) {
  const cell = A.cell;
  const info = A.rooms.map((r) => {
    const rw = r.rect.w * cell, rh = r.rect.h * cell;
    return { r, area: r.area, minDim: Math.min(rw, rh), aspect: Math.max(rw, rh) / Math.max(0.1, Math.min(rw, rh)) };
  });
  A.openings.forEach((op) => {
    [op.roomA, op.roomB].forEach((id) => {
      if (!id) return;
      const r = A.rooms[id - 1];
      if (op.type === 'window' && op.exterior) r.exteriorWindows++;
      if (op.type === 'door' || op.type === 'opening') r.doors++;
      if (op.type === 'door' && op.exterior) r.entrance = true;
    });
  });
  const types = new Array(A.rooms.length).fill(null);
  info.forEach((x, i) => {
    if (x.minDim < 1.35 && x.aspect > 2.2) types[i] = 'passage';
    else if (x.area < 2.4) types[i] = 'store';
    else if (x.area < 6) types[i] = 'bath';
  });
  const rest = info.map((x, i) => i).filter((i) => !types[i]).sort((a, b) => info[b].area - info[a].area);
  const entrance = rest.find((i) => A.rooms[i].entrance && info[i].area >= 9);
  const living = entrance ?? rest[0];
  if (living !== undefined) types[living] = 'living';
  const kitchen = rest.filter((i) => types[i] === null && info[i].area <= 14).sort((a, b) => info[a].area - info[b].area)[0];
  if (kitchen !== undefined) types[kitchen] = 'kitchen';
  rest.forEach((i) => { if (!types[i]) types[i] = info[i].area >= 8.5 ? 'bedroom' : 'study'; });
  // a second very large room next to living reads better as dining
  const big = rest.filter((i) => types[i] === 'bedroom' && info[i].area > 24);
  if (big.length && !types.includes('dining')) types[big[0]] = 'dining';
  return types;
}

/** Collects axis-aligned boxes per material role. */
export class Collector {
  constructor() { this.boxes = {}; this.plants = []; this.lamps = []; this.people = []; this.chairs = 0; }
  box(role, x0, x1, y0, y1, z0, z1) {
    (this.boxes[role] = this.boxes[role] || []).push([Math.min(x0, x1), Math.max(x0, x1), y0, y1, Math.min(z0, z1), Math.max(z0, z1)]);
  }
}

/**
 * Lay out one room.
 * rect   room's largest clear rectangle in world metres {x0, z0, x1, z1}
 * doors  world positions {x, z} of doors/openings serving the room
 * opts   { furniture, rugs, plants, lights, height }
 */
export function furnishRoom(type, rect, doors, opts, out) {
  const inset = 0.04;
  const R = { x0: rect.x0 + inset, x1: rect.x1 - inset, z0: rect.z0 + inset, z1: rect.z1 - inset };
  const RW = R.x1 - R.x0, RD = R.z1 - R.z0;
  if (RW < 0.5 || RD < 0.5) return;

  // back wall: the side furthest from the nearest door (prefer longer walls on ties)
  const sides = [
    { s: 'N', line: (p) => p.z - R.z0, len: RW },
    { s: 'S', line: (p) => R.z1 - p.z, len: RW },
    { s: 'W', line: (p) => p.x - R.x0, len: RD },
    { s: 'E', line: (p) => R.x1 - p.x, len: RD }
  ];
  sides.forEach((sd) => { sd.score = (doors.length ? Math.min(...doors.map(sd.line)) : 5) + sd.len * 0.15; });
  sides.sort((a, b) => b.score - a.score);
  const side = sides[0].s;

  // local frame: u along the back wall, v away from it into the room
  const W = side === 'N' || side === 'S' ? RW : RD;
  const D = side === 'N' || side === 'S' ? RD : RW;
  const toW = (u, v) => {
    switch (side) {
      case 'N': return [R.x0 + u, R.z0 + v];
      case 'S': return [R.x1 - u, R.z1 - v];
      case 'W': return [R.x0 + v, R.z1 - u];
      default: return [R.x1 - v, R.z0 + u];
    }
  };
  const B = (role, u0, u1, v0, v1, y0, y1) => {
    const [ax, az] = toW(u0, v0), [bx, bz] = toW(u1, v1);
    out.box(role, ax, bx, y0, y1, az, bz);
  };
  const local = doors.map((p) => {
    switch (side) {
      case 'N': return { u: p.x - R.x0, v: p.z - R.z0 };
      case 'S': return { u: R.x1 - p.x, v: R.z1 - p.z };
      case 'W': return { u: R.z1 - p.z, v: p.x - R.x0 };
      default: return { u: p.z - R.z0, v: R.x1 - p.x };
    }
  });
  const clear = 0.95;   // keep door swings free
  const free = (u0, u1, v0, v1) => local.every((d) => {
    const du = Math.max(u0 - d.u, 0, d.u - u1), dv = Math.max(v0 - d.v, 0, d.v - v1);
    return Math.hypot(du, dv) > clear;
  }) && u0 >= -1e-3 && v0 >= -1e-3 && u1 <= W + 1e-3 && v1 <= D + 1e-3;
  /** first u-centre (tried from the middle outwards) where a footprint fits */
  const place = (w, v0, v1, prefer = W / 2) => {
    const tries = [prefer];
    for (let k = 0.25; k < W; k += 0.25) tries.push(prefer + k, prefer - k);
    for (const c of tries) if (free(c - w / 2, c + w / 2, v0, v1)) return c;
    return null;
  };
  const corner = (s, v0, v1) => {
    for (const u of [W - s / 2 - 0.05, s / 2 + 0.05]) if (free(u - s / 2, u + s / 2, v0, v1)) return u;
    return null;
  };
  const plant = (u, v, big = false) => {
    const [x, z] = toW(u, v);
    out.plants.push({ x, z, s: big ? 1.15 : 0.8 });
  };
  const chair = (u, v, face) => {     // face: +1 → looks towards +v, -1 → towards -v
    const s = 0.44;
    B('wood', u - s / 2, u + s / 2, v - s / 2, v + s / 2, 0.42, 0.46);
    const bv = face > 0 ? v - s / 2 : v + s / 2 - 0.05;
    B('wood', u - s / 2, u + s / 2, bv, bv + 0.05, 0.46, 0.9);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => {
      const lu = u + a * (s / 2 - 0.03), lv = v + b * (s / 2 - 0.03);
      B('dark', lu - 0.02, lu + 0.02, lv - 0.02, lv + 0.02, 0, 0.42);
    });
  };
  const table = (u, v, w, d, h = 0.75) => {
    B('wood', u - w / 2, u + w / 2, v - d / 2, v + d / 2, h - 0.04, h);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => {
      const lu = u + a * (w / 2 - 0.06), lv = v + b * (d / 2 - 0.06);
      B('dark', lu - 0.03, lu + 0.03, lv - 0.03, lv + 0.03, 0, h - 0.04);
    });
  };
  const dining = (u, v, maxW, maxD) => {
    const seats = maxW >= 2.6 ? 3 : maxW >= 1.9 ? 2 : 1;
    const tw = seats === 3 ? 1.8 : seats === 2 ? 1.2 : 0.8, td = Math.min(0.9, maxD - 1.1);
    if (td < 0.6) return;
    table(u, v, tw, td);
    for (let k = 0; k < seats; k++) {
      const cu = u - tw / 2 + (tw / seats) * (k + 0.5);
      chair(cu, v - td / 2 - 0.3, 1);
      chair(cu, v + td / 2 + 0.3, -1);
    }
    if (opts.rugs) B('rug', u - tw / 2 - 0.5, u + tw / 2 + 0.5, v - td / 2 - 0.7, v + td / 2 + 0.7, 0, 0.012);
  };

  if (opts.furniture) {
    switch (type) {
      case 'bedroom': {
        let bedW = W >= 3 ? 1.8 : W >= 2.3 ? 1.35 : 0.95;
        const bedL = Math.min(2.05, D - 0.7);
        if (bedL < 1.6) break;
        const c = place(bedW + 0.9, 0, bedL) ?? place(bedW, 0, bedL);
        if (c === null) break;
        if (opts.rugs) B('rug', c - bedW / 2 - 0.45, c + bedW / 2 + 0.45, bedL * 0.45, Math.min(D - 0.1, bedL + 0.65), 0, 0.012);
        B('wood', c - bedW / 2, c + bedW / 2, 0, bedL, 0.05, 0.32);                           // base
        B('linen', c - bedW / 2 + 0.03, c + bedW / 2 - 0.03, 0.06, bedL - 0.03, 0.32, 0.52);   // mattress
        B('fabric', c - bedW / 2 + 0.01, c + bedW / 2 - 0.01, bedL * 0.42, bedL - 0.01, 0.52, 0.56); // throw
        B('wood', c - bedW / 2 - 0.02, c + bedW / 2 + 0.02, 0, 0.07, 0, 1.05);                // headboard
        const pw = bedW > 1.2 ? bedW / 2 - 0.12 : bedW - 0.24;
        (bedW > 1.2 ? [-1, 1] : [0]).forEach((s) => {
          const pc = c + s * (bedW / 4);
          B('linen', pc - pw / 2, pc + pw / 2, 0.1, 0.48, 0.52, 0.66);
        });
        [-1, 1].forEach((s) => {                                                               // side tables
          const u = c + s * (bedW / 2 + 0.28);
          if (free(u - 0.22, u + 0.22, 0, 0.42)) {
            B('wood', u - 0.22, u + 0.22, 0, 0.42, 0, 0.5);
            if (opts.lights) out.lamps.push({ table: true, at: toW(u, 0.2), y: 0.5 });
          }
        });
        const wl = Math.min(2.2, W - 0.6);                                                     // wardrobe
        if (D - bedL >= 1.35 && wl >= 1) {
          const wc = place(wl, D - 0.62, D, W - wl / 2);
          if (wc !== null) {
            B('wood', wc - wl / 2, wc + wl / 2, D - 0.6, D, 0, Math.min(2.1, opts.height - 0.15));
            for (let k = 1; k < Math.round(wl / 0.5); k++) {
              const du = wc - wl / 2 + (wl / Math.round(wl / 0.5)) * k;
              B('dark', du - 0.006, du + 0.006, D - 0.605, D - 0.6, 0.1, Math.min(2.0, opts.height - 0.25));
            }
          }
        }
        if (opts.plants) { const u = corner(0.5, D - 0.5, D - 0.05); if (u !== null && D - bedL < 1.35) plant(u, D - 0.3); }
        break;
      }
      case 'living': {
        const sw = Math.min(2.4, W - 1.0);
        if (sw < 1.3 || D < 2.4) break;
        const c = place(sw, 0, 0.92);
        if (c === null) break;
        if (opts.rugs) B('rug', c - sw / 2, c + sw / 2, 0.75, Math.min(D - 0.6, 2.5), 0, 0.012);
        B('fabric', c - sw / 2, c + sw / 2, 0, 0.92, 0.12, 0.44);                               // seat
        B('fabric', c - sw / 2, c + sw / 2, 0, 0.22, 0.44, 0.84);                               // back
        B('fabric', c - sw / 2, c - sw / 2 + 0.18, 0, 0.92, 0.44, 0.62);                        // arms
        B('fabric', c + sw / 2 - 0.18, c + sw / 2, 0, 0.92, 0.44, 0.62);
        const n = sw > 2 ? 3 : 2;
        for (let k = 0; k < n; k++) {
          const cu = c - sw / 2 + 0.2 + ((sw - 0.4) / n) * (k + 0.5);
          B('accent', cu - (sw - 0.5) / n / 2, cu + (sw - 0.5) / n / 2, 0.22, 0.85, 0.44, 0.54);
        }
        B('dark', c - sw / 2 + 0.05, c + sw / 2 - 0.05, 0.05, 0.85, 0, 0.12);
        if (D >= 2.6) table(c, 1.45, Math.min(1.1, sw * 0.5), 0.55, 0.4);                      // coffee table
        [-1, 1].forEach((s) => {                                                                 // armchairs
          const u = c + s * (sw / 2 + 0.55);
          if (D >= 2.9 && free(u - 0.4, u + 0.4, 1.0, 1.8)) {
            B('fabric', u - 0.38, u + 0.38, 1.02, 1.78, 0.12, 0.42);
            const bu = s < 0 ? u - 0.38 : u + 0.2;
            B('fabric', bu, bu + 0.18, 1.02, 1.78, 0.42, 0.8);
            B('dark', u - 0.33, u + 0.33, 1.07, 1.73, 0, 0.12);
          }
        });
        if (D >= 3.6) {                                                                          // media wall
          const tc = place(1.8, D - 0.45, D, c);
          if (tc !== null) {
            B('wood', tc - 0.9, tc + 0.9, D - 0.45, D, 0, 0.45);
            B('screen', tc - 0.65, tc + 0.65, D - 0.08, D - 0.03, 0.75, 1.5);
          }
        }
        if (D >= 6 && W >= 2.8) {
          const v = 2.9 + (D - 2.9) / 2;
          if (free(c - 1.4, c + 1.4, v - 1.1, v + 1.1)) dining(c, v, Math.min(W, 3.2), D - 2.9);
        }
        if (opts.plants) {
          const u = corner(0.6, 0.05, 0.6); if (u !== null) plant(u, 0.32, true);
          const u2 = corner(0.5, D - 0.55, D - 0.05); if (u2 !== null) plant(u2, D - 0.3);
        }
        break;
      }
      case 'dining': {
        if (W >= 2.2 && D >= 2.2) dining(W / 2, D / 2, W, D);
        if (D >= 3.4) {
          const c = place(1.6, 0, 0.45);
          if (c !== null) B('wood', c - 0.8, c + 0.8, 0, 0.45, 0, 0.85);                          // sideboard
        }
        if (opts.plants) { const u = corner(0.5, 0.05, 0.55); if (u !== null) plant(u, 0.3); }
        break;
      }
      case 'kitchen': {
        // counter runs along the back wall, broken where doors need clearance
        const runs = [];
        let s = null;
        for (let u = 0; u <= W + 1e-6; u += 0.05) {
          const ok = u < W && free(u, Math.min(W, u + 0.05), 0, 0.62);
          if (ok && s === null) s = u;
          if (!ok && s !== null) { if (u - s >= 0.6) runs.push([s, u]); s = null; }
        }
        runs.forEach(([a, b], k) => {
          B('cabinet', a, b, 0, 0.6, 0.1, 0.86);
          B('dark', a, b, 0.05, 0.55, 0, 0.1);
          B('counter', a, b, 0, 0.62, 0.86, 0.9);
          if (opts.height >= 2.4) B('cabinet', a, b, 0, 0.35, 1.5, Math.min(2.2, opts.height - 0.1));
          if (k === 0 && b - a >= 1.6) {
            const m = a + (b - a) * 0.3, h = a + (b - a) * 0.7;
            B('steel', m - 0.3, m + 0.3, 0.1, 0.5, 0.9, 0.905);                                  // sink
            B('dark', h - 0.3, h + 0.3, 0.08, 0.52, 0.9, 0.91);                                  // hob
          }
        });
        const fridge = runs.length ? runs[runs.length - 1] : null;
        if (fridge && fridge[1] - fridge[0] >= 1.3) B('steel', fridge[1] - 0.7, fridge[1], 0, 0.68, 0, 1.85);
        if (D >= 2.6) {                                                                          // return leg
          const len = Math.min(D - 1.3, 2.2);
          if (len >= 0.8 && free(0, 0.62, 0.62, 0.62 + len)) {
            B('cabinet', 0, 0.6, 0.62, 0.62 + len, 0.1, 0.86);
            B('counter', 0, 0.62, 0.62, 0.62 + len, 0.86, 0.9);
          }
        }
        if (D >= 3.2 && W >= 2.4) {
          const c = place(1.0, D - 1.4, D - 0.6, W - 0.8);
          if (c !== null) { table(c, D - 1.0, 0.8, 0.7); chair(c, D - 0.5, -1); }
        }
        break;
      }
      case 'bath': {
        const wcU = corner(0.45, 0, 0.72);
        if (wcU !== null) {
          B('ceramic', wcU - 0.19, wcU + 0.19, 0, 0.18, 0, 0.8);                                  // cistern
          B('ceramic', wcU - 0.18, wcU + 0.18, 0.18, 0.68, 0, 0.4);                               // bowl
          B('ceramic', wcU - 0.19, wcU + 0.19, 0.17, 0.7, 0.4, 0.43);
        }
        const bu = wcU !== null && wcU > W / 2 ? 0.4 : W - 0.4;                                 // vanity at the other end
        if (W >= 1.4 && free(bu - 0.32, bu + 0.32, 0, 0.48)) {
          B('wood', bu - 0.32, bu + 0.32, 0, 0.48, 0.35, 0.8);
          B('ceramic', bu - 0.24, bu + 0.24, 0.04, 0.42, 0.8, 0.88);
          B('mirror', bu - 0.3, bu + 0.3, 0, 0.02, 1.1, 1.8);
        }
        if (D >= 1.9) {                                                                          // shower
          const su = wcU !== null && wcU > W / 2 ? W - 0.95 : 0;
          if (free(su, su + 0.9, D - 0.9, D)) {
            B('ceramic', su, su + 0.9, D - 0.9, D, 0, 0.05);
            B('glass', su, su + 0.9, D - 0.92, D - 0.9, 0.05, Math.min(2.0, opts.height - 0.1));
            B('steel', su + 0.42, su + 0.48, D - 0.06, D, 1.9, 2.0);
          }
        }
        break;
      }
      case 'study': {
        const c = place(1.3, 0, 0.62);
        if (c !== null) {
          table(c, 0.3, 1.3, 0.6);
          B('screen', c - 0.28, c + 0.28, 0.12, 0.15, 0.85, 1.2);
          chair(c, 0.95, -1);
        }
        const bl = Math.min(1.8, D - 1.2);
        if (bl >= 0.9 && free(W - 0.36, W, D - bl - 0.1, D - 0.1)) {
          B('wood', W - 0.36, W, D - bl - 0.1, D - 0.1, 0, Math.min(2.0, opts.height - 0.2));
        }
        if (opts.plants) { const u = corner(0.5, D - 0.55, D - 0.05); if (u !== null) plant(u, D - 0.3); }
        break;
      }
      case 'store': {
        const runW = W - 0.1;
        if (runW >= 0.6 && free(0.05, W - 0.05, 0, 0.45)) {
          for (let k = 0; k < 4; k++) B('wood', 0.05, W - 0.05, 0, 0.45, 0.05 + k * 0.55, 0.08 + k * 0.55);
          B('wood', 0.05, 0.08, 0, 0.45, 0, 1.75);
          B('wood', W - 0.08, W - 0.05, 0, 0.45, 0, 1.75);
          for (let k = 0; k < Math.floor(runW / 0.45); k++) {
            const u = 0.15 + k * 0.45;
            B('accent', u, u + 0.3, 0.05, 0.38, 0.08 + (k % 3) * 0.55, 0.32 + (k % 3) * 0.55);
          }
        }
        break;
      }
      case 'balcony': {
        if (W >= 1.6 && D >= 1.2) {
          const c = place(1.4, 0.1, 1.0);
          if (c !== null) { table(c, 0.55, 0.5, 0.5, 0.6); chair(c - 0.55, 0.55, 1); chair(c + 0.55, 0.55, 1); }
        }
        if (opts.plants) {
          [0.3, W - 0.3].forEach((u) => { if (free(u - 0.25, u + 0.25, D - 0.5, D)) plant(u, D - 0.28); });
        }
        break;
      }
      default: break;
    }
  } else if (opts.plants && (type === 'living' || type === 'balcony')) {
    const u = corner(0.6, 0.05, 0.6); if (u !== null) plant(u, 0.32, true);
  }

  if (opts.lights && type !== 'empty') {
    const [x, z] = toW(W / 2, D / 2);
    out.lamps.push({ at: [x, z], y: opts.height - 0.55, area: RW * RD });
  }
}
