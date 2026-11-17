/* ==========================================================================
   Plan → 3D viewer
   Builds the model from an analysis (see analyse.js) and renders it with
   configurable representation, finish, elements, lighting and view styles.
   ========================================================================== */
import * as THREE from 'three';
import { OrbitControls } from '../../vendor/addons/OrbitControls.js';
import { analysePlan, rasterise } from './analyse.js';
import { guessRoomTypes, furnishRoom, Collector, ROOM_TYPES } from './furnish.js';

const DEG = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const SLAB = 0.15;
const MAX_LIGHTS = 8;

/* ---------- geometry batching ---------- */
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
      const b = this.v;
      (isTop ? this.top : this.side).push(b, b + 1, b + 2, b, b + 2, b + 3);
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
    const m = new THREE.Mesh(g, Array.isArray(materials) ? materials : [materials, materials]);
    m.castShadow = opts.shadow !== false;
    m.receiveShadow = true;
    return m;
  }
}

/* ---------- textures (1 uv unit = 1 m) ---------- */
let seed = 9;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
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
      g.fillStyle = `hsl(28 ${38 + rnd() * 10}% ${54 + rnd() * 10}%)`; g.fillRect(0, r * 32, s, 32);
      g.fillStyle = 'rgba(60,40,20,0.3)'; g.fillRect(0, r * 32, s, 1.5); g.fillRect(rnd() * s, r * 32, 1.5, 32);
    }
  }, 1 / 1.6),
  slabs: () => canvasTexture(256, (g) => {
    for (let r = 0; r < 2; r++) for (let k = 0; k < 2; k++) {
      g.fillStyle = `hsl(60 ${6 + rnd() * 6}% ${72 + rnd() * 6}%)`; g.fillRect(k * 128, r * 128, 128, 128);
    }
    g.strokeStyle = 'rgba(60,66,54,0.22)'; g.lineWidth = 2;
    for (let r = 0; r < 2; r++) for (let k = 0; k < 2; k++) g.strokeRect(k * 128, r * 128, 128, 128);
  }, 1 / 1.2),
  tiles: () => canvasTexture(256, (g, s) => {
    g.fillStyle = '#efe6d8'; g.fillRect(0, 0, s, s);
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) {
      g.fillStyle = `hsl(22 ${45 + rnd() * 10}% ${60 + rnd() * 6}%)`; g.fillRect(k * 64 + 2, r * 64 + 2, 60, 60);
    }
  }, 1 / 1.2),
  lawn: () => canvasTexture(128, (g, s) => {
    g.fillStyle = '#9fb08a'; g.fillRect(0, 0, s, s);
    for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(${60 + rnd() * 40},${90 + rnd() * 40},${50 + rnd() * 30},0.25)`; g.fillRect(rnd() * s, rnd() * s, 1.5, 1.5); }
  }, 1 / 2)
};

/* ---------- finishes ---------- */
export const FINISHES = {
  plaster: { label: 'Lime plaster', wall: 0xefebe3, floor: 'planks', floorColor: 0xffffff, poche: 0x6e3511, frame: 0x333b2f, leaf: 0x8a5a3a, slab: 0xdedad2,
    fabric: 0x8c9a7f, accent: 0xc98b5a, wood: 0x9a6b45, linen: 0xf3efe6, rug: 0xd8c8ad, cabinet: 0xe9e4da, counter: 0xcfcac0 },
  concrete: { label: 'Exposed concrete', wall: 0xd6d4cd, wallMap: 'concrete', floor: 'slabs', floorColor: 0xffffff, poche: 0x6e3511, frame: 0x2b302a, leaf: 0x7a4f33, slab: 0xc9c7c0,
    fabric: 0x5d625a, accent: 0xb9894e, wood: 0x7a5236, linen: 0xecebe6, rug: 0xb9b4a8, cabinet: 0x50554e, counter: 0xd9d6cf },
  brick: { label: 'Red brick', wall: 0xffffff, wallMap: 'brick', floor: 'tiles', floorColor: 0xffffff, poche: 0x333b2f, frame: 0x5a3a24, leaf: 0x6b4429, slab: 0xd6d3cb,
    fabric: 0x6a795d, accent: 0xe0b15a, wood: 0x6b4429, linen: 0xf1ece2, rug: 0xc9a27c, cabinet: 0xefe9dd, counter: 0x3a3d38 },
  card: { label: 'White card model', wall: 0xfbfaf6, floor: null, floorColor: 0xe8dcc4, poche: 0x8b8f86, frame: 0xf2f0ea, leaf: 0xe2d6bd, slab: 0xf4f2ec,
    fabric: 0xf2efe8, accent: 0xe6dccb, wood: 0xe2d6bd, linen: 0xfbfaf6, rug: 0xefe9de, cabinet: 0xf4f2ec, counter: 0xece8df, card: true }
};
const COMMON = { dark: 0x3a3f38, steel: 0xb9bdb6, ceramic: 0xf7f7f4, screen: 0x1f2320, mirror: 0xa9c3c0, leafGreen: 0x6a795d, leafLight: 0x8c9a7f,
  pot: 0xa0522d, lawn: 0x9fb08a, paving: 0xd8d4c8, trunk: 0x4a4136, lamp: 0xfff1d6 };

/* ==========================================================================
   VIEWER
   ========================================================================== */
export function createPlanViewer(canvas, { labelsEl, onPick } = {}) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 3000);
  camera.position.set(20, 20, 20);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reduced;
  controls.dampingFactor = 0.09;
  controls.maxPolarAngle = 89 * DEG;
  controls.screenSpacePanning = true;
  controls.autoRotateSpeed = 0.7;

  const hemi = new THREE.HemisphereLight(0xffffff, 0xc2c8b8, 1.9);
  const sun = new THREE.DirectionalLight(0xfff3e0, 1.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(hemi, sun, sun.target);
  const lamps = Array.from({ length: MAX_LIGHTS }, () => {
    const l = new THREE.PointLight(0xffc98a, 0, 9, 1.6);
    scene.add(l);
    return l;
  });

  const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);
  const root = new THREE.Group();          // exported content
  scene.add(root);

  let analysis = null, cfg = null, source = null;
  let model = null, plate = null, plateTex = null;
  let roomTypes = [];
  const overrides = new Map();
  const hits = [];
  const storeyGroups = [];
  const pocheMeshes = [];
  let labelEls = [];
  let mats = {};
  let size = 12, grow = 1, sunT = 0.35;

  const texCache = {};
  const tex = (name) => (texCache[name] = texCache[name] || TEX[name]());
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });

  const disposeTree = (o) => o.traverse((c) => {
    if (c.geometry) c.geometry.dispose();
  });
  const typeOf = (op) => overrides.get(op.key) || op.type;

  /* ---------- materials ---------- */
  function buildMaterials() {
    Object.values(mats).forEach((m) => m.dispose());
    mats = {};
    const F = FINISHES[cfg.finish];
    const rs = cfg.render;
    const night = cfg.lighting === 'night' && rs === 'realistic';
    const C = { ...COMMON, ...F };
    if (F.card) Object.assign(C, { dark: 0xcfcac0, steel: 0xe0ddd6, screen: 0xd9d5cc, ceramic: 0xfbfaf6, pot: 0xe6dccb, leafGreen: 0xdcd8cc, leafLight: 0xe8e4d8, trunk: 0xd2ccbf, lawn: 0xece9e0, paving: 0xf3f1ea });

    const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
    const roles = {
      wall: () => lambert(C.wall, { map: F.wallMap ? tex(F.wallMap) : null }),
      floor: () => lambert(C.floorColor, { map: F.floor ? tex(F.floor) : null, vertexColors: true }),
      slab: () => lambert(C.slab), frame: () => lambert(C.frame), leaf: () => lambert(C.leaf),
      fabric: () => lambert(C.fabric), accent: () => lambert(C.accent), wood: () => lambert(C.wood), linen: () => lambert(C.linen),
      rug: () => lambert(C.rug), cabinet: () => lambert(C.cabinet), counter: () => lambert(C.counter), dark: () => lambert(C.dark),
      steel: () => lambert(C.steel), ceramic: () => lambert(C.ceramic), screen: () => lambert(C.screen),
      mirror: () => lambert(C.mirror), pot: () => lambert(C.pot), leafGreen: () => lambert(C.leafGreen, { flatShading: true }),
      leafLight: () => lambert(C.leafLight, { flatShading: true }), trunk: () => lambert(C.trunk),
      lawn: () => lambert(0xffffff, { map: F.card ? null : tex('lawn'), color: F.card ? C.lawn : 0xffffff }),
      paving: () => lambert(C.paving), compound: () => lambert(C.wall, { map: F.wallMap ? tex(F.wallMap) : null }),
      person: () => lambert(0xc9c0b2),
      glass: () => lambert(0x9fc4c0, { transparent: true, opacity: F.card ? 0.22 : 0.4, depthWrite: false,
        emissive: night ? 0xffbf73 : 0x000000, emissiveIntensity: night ? 0.55 : 0 }),
      lamp: () => lambert(C.lamp, { emissive: night ? 0xffd9a0 : 0x000000, emissiveIntensity: night ? 1.4 : 0 }),
      poche: () => new THREE.MeshBasicMaterial({ color: C.poche, side: THREE.BackSide }),
      pocheTop: () => lambert(C.poche),
      line: () => new THREE.LineBasicMaterial({ color: C.poche }),
      edge: () => new THREE.LineBasicMaterial({ color: rs === 'blueprint' ? 0xe6f0fb : 0x2a2f28, transparent: true, opacity: rs === 'blueprint' ? 0.85 : 0.75 })
    };
    Object.entries(roles).forEach(([k, f]) => { mats[k] = f(); });

    if (rs === 'sketch') {
      Object.keys(mats).forEach((k) => {
        if (['edge', 'line', 'poche', 'glass'].includes(k)) return;
        mats[k].dispose();
        mats[k] = lambert(k === 'floor' ? 0xecebe6 : k === 'lawn' ? 0xf1f0eb : 0xf8f7f3, k === 'floor' ? { vertexColors: true } : {});
      });
      mats.glass.color.set(0xd5e3e6); mats.glass.opacity = 0.35;
      mats.poche.color.set(0x2a2f28);
    } else if (rs === 'blueprint') {
      Object.keys(mats).forEach((k) => {
        if (['edge'].includes(k)) return;
        mats[k].dispose();
        mats[k] = k === 'poche'
          ? new THREE.MeshBasicMaterial({ color: 0x9cc2e6, side: THREE.BackSide })
          : k === 'line' ? new THREE.LineBasicMaterial({ color: 0xe6f0fb })
            : new THREE.MeshBasicMaterial({ color: 0x5b8fc4, transparent: true, opacity: k === 'floor' || k === 'lawn' ? 0.08 : 0.16, depthWrite: false });
      });
    }
    // x-ray
    if (cfg.xray < 1) {
      mats.wall.transparent = true; mats.wall.opacity = Math.min(mats.wall.opacity, cfg.xray); mats.wall.depthWrite = false;
    }
    return mats;
  }

  /* ---------- lights / background ---------- */
  let skyTex = null;
  function skyTexture(top, bottom) {
    const c = document.createElement('canvas');
    c.width = 2; c.height = 256;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, top); gr.addColorStop(1, bottom);
    g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function applyLighting() {
    const night = cfg.lighting === 'night', golden = cfg.lighting === 'golden';
    const t = golden ? 0.1 : sunT;
    const a = Math.PI * clamp(t, 0.03, 0.97), h = Math.sin(a);
    const dir = new THREE.Vector3(Math.cos(a) * 0.9, h * 0.95 + 0.12, 0.45).normalize();
    sun.position.copy(dir).multiplyScalar(size * 2.5);
    sun.target.position.set(0, 0, 0);
    if (night) {
      sun.color.set(0x8fa6d6); sun.intensity = 0.25; sun.position.set(-size, size * 1.6, size * 0.8);
      hemi.color.set(0x5a6f99); hemi.groundColor.set(0x1d2433); hemi.intensity = 0.55;
    } else {
      sun.color.setRGB(1, lerp(0.7, 0.96, golden ? 0.15 : h), lerp(0.5, 0.9, golden ? 0.1 : h));
      sun.intensity = golden ? 1.5 : 0.7 + 1.0 * h;
      hemi.color.set(golden ? 0xffe2c4 : 0xffffff); hemi.groundColor.set(0xc2c8b8);
      hemi.intensity = golden ? 1.35 : 1.7 + 0.35 * h;
    }
    sun.castShadow = cfg.shadows && cfg.render !== 'blueprint';

    if (skyTex) { skyTex.dispose(); skyTex = null; }
    if (cfg.render === 'blueprint') scene.background = new THREE.Color(0x17395c);
    else if (night) { skyTex = skyTexture('#0b1220', '#26324a'); scene.background = skyTex; }
    else if (cfg.background === 'sky') { skyTex = golden ? skyTexture('#f3c99a', '#fbeee0') : skyTexture('#bcd3e6', '#f4f6f2'); scene.background = skyTex; }
    else scene.background = null;
  }

  /* ---------- model ---------- */
  function build() {
    if (model) { root.remove(model); disposeTree(model); }
    hits.length = 0; storeyGroups.length = 0; pocheMeshes.length = 0;
    buildMaterials();
    const A = analysis, F = FINISHES[cfg.finish], M = mats;
    const cell = A.cell;
    const X = (gx) => (gx - A.cx) * cell, Z = (gy) => (gy - A.cy) * cell;
    model = new THREE.Group();
    model.name = 'plan-model';

    const mode = cfg.mode;
    const storeys = mode === 'cut' ? 1 : cfg.storeys;
    const H = cfg.wallHeight;
    const doorH = Math.min(2.1, H - 0.2), sill = 0.9;
    const elements = mode !== 'massing';

    // furniture & lamps, laid out once per room in storey-local coordinates
    const furn = new Collector();
    if (elements) {
      A.rooms.forEach((r, i) => {
        const rect = { x0: X(r.rect.x), x1: X(r.rect.x + r.rect.w), z0: Z(r.rect.y), z1: Z(r.rect.y + r.rect.h) };
        const doors = A.openings.filter((op) => (op.roomA === r.id || op.roomB === r.id) && ['door', 'opening'].includes(typeOf(op)))
          .map((op) => ({ x: X(op.x + op.w / 2), z: Z(op.y + op.h / 2) }));
        furnishRoom(roomTypes[i], rect, doors, { furniture: cfg.furniture, rugs: cfg.rugs, plants: cfg.plants, lights: cfg.lights, height: H }, furn);
      });
    }

    for (let s = 0; s < storeys; s++) {
      const g = new THREE.Group();
      g.name = `storey-${s}`;
      const y0 = s * (H + SLAB);
      const top = s === storeys - 1;
      const walls = new BoxBatch(), floors = new BoxBatch(), frames = new BoxBatch(), glass = new BoxBatch(), slabs = new BoxBatch(), shades = new BoxBatch();

      A.wallRects.forEach(([x, y, w, h]) => walls.add(X(x), X(x + w), y0, y0 + H, Z(y), Z(y + h)));
      if (cfg.floors && elements) {
        A.roomRects.forEach(([x, y, w, h, id]) => floors.add(X(x), X(x + w), y0, y0 + 0.03, Z(y), Z(y + h), 0.9 + ((id * 37) % 11) / 75));
      }

      A.openings.forEach((op, i) => {
        let type = typeOf(op);
        if (s > 0 && op.exterior && type === 'door') type = 'window';
        const x0 = X(op.x), x1 = X(op.x + op.w), z0 = Z(op.y), z1 = Z(op.y + op.h);
        const along = op.dir === 'h', L = op.length;
        if (s === 0) {
          const hh = H;
          const hit = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.1, hh, z1 - z0 + 0.1), hitMat);
          hit.position.set((x0 + x1) / 2, hh / 2, (z0 + z1) / 2);
          hit.userData.opening = i;
          hits.push(hit); g.add(hit);
        }
        if (!elements) return;
        if (type === 'wall') { walls.add(x0, x1, y0, y0 + H, z0, z1); return; }
        const lintel = (from) => { if (from < H) walls.add(x0, x1, y0 + from, y0 + H, z0, z1); };
        if (type === 'opening') { lintel(Math.min(2.4, H)); return; }

        // sunshade (chajja) over exterior openings, projecting outwards
        if (cfg.shades && op.exterior) {
          const out = -op.swing, p = 0.6, t = 0.08, yy = y0 + doorH + 0.05;
          if (along) { const zf = out < 0 ? z0 : z1; shades.add(x0 - 0.15, x1 + 0.15, yy, yy + t, Math.min(zf, zf + out * p), Math.max(zf, zf + out * p)); }
          else { const xf = out < 0 ? x0 : x1; shades.add(Math.min(xf, xf + out * p), Math.max(xf, xf + out * p), yy, yy + t, z0 - 0.15, z1 + 0.15); }
        }

        if (type === 'window') {
          walls.add(x0, x1, y0, y0 + Math.min(sill, H), z0, z1);
          lintel(doorH);
          const gTop = Math.min(doorH, H);
          if (cfg.windows && gTop > sill) {
            const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, t = 0.025;
            if (along) glass.add(x0, x1, y0 + sill, y0 + gTop, mz - t, mz + t);
            else glass.add(mx - t, mx + t, y0 + sill, y0 + gTop, z0, z1);
            const panes = Math.max(1, Math.round(L / 0.9));
            for (let k = 0; k <= panes; k++) {
              const f = k / panes, fw = 0.05;
              if (along) { const xx = lerp(x0, x1, f); frames.add(xx - fw / 2, xx + fw / 2, y0 + sill, y0 + gTop, mz - 0.04, mz + 0.04); }
              else { const zz = lerp(z0, z1, f); frames.add(mx - 0.04, mx + 0.04, y0 + sill, y0 + gTop, zz - fw / 2, zz + fw / 2); }
            }
            [sill, gTop - 0.05].forEach((yy) => {
              if (along) frames.add(x0, x1, y0 + yy, y0 + yy + 0.05, mz - 0.04, mz + 0.04);
              else frames.add(mx - 0.04, mx + 0.04, y0 + yy, y0 + yy + 0.05, z0, z1);
            });
            // projecting stone sill on the outside face
            if (op.exterior) {
              const out = -op.swing;
              if (along) { const zf = out < 0 ? z0 : z1; frames.add(x0 - 0.05, x1 + 0.05, y0 + sill - 0.05, y0 + sill, Math.min(zf, zf + out * 0.06), Math.max(zf, zf + out * 0.06)); }
              else { const xf = out < 0 ? x0 : x1; frames.add(Math.min(xf, xf + out * 0.06), Math.max(xf, xf + out * 0.06), y0 + sill - 0.05, y0 + sill, z0 - 0.05, z1 + 0.05); }
            }
          }
          return;
        }

        // door: lintel, frame and an open leaf
        lintel(doorH);
        if (!cfg.doors) return;
        const leafH = Math.min(doorH, H) - 0.02, Lw = L - 0.06;
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        if (along) { frames.add(x0, x0 + 0.04, y0, y0 + doorH, z0, z1); frames.add(x1 - 0.04, x1, y0, y0 + doorH, z0, z1); }
        else { frames.add(x0, x1, y0, y0 + doorH, z0, z0 + 0.04); frames.add(x0, x1, y0, y0 + doorH, z1 - 0.04, z1); }
        const ang = mode === 'cut' ? 90 * DEG : 72 * DEG;
        const hx = along ? x0 + 0.04 : mx, hz = along ? mz : z0 + 0.04;
        const ad = along ? [1, 0] : [0, 1], sd = along ? [0, op.swing] : [op.swing, 0];
        const d = [ad[0] * Math.cos(ang) + sd[0] * Math.sin(ang), ad[1] * Math.cos(ang) + sd[1] * Math.sin(ang)];
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(Lw, leafH, 0.045).translate(Lw / 2, leafH / 2, 0), M.leaf);
        leaf.position.set(hx, y0 + 0.01, hz);
        leaf.rotation.y = Math.atan2(-d[1], d[0]);
        leaf.castShadow = leaf.receiveShadow = true;
        leaf.userData.edges = true;
        g.add(leaf);
        if (mode === 'cut') {
          const pts = [];
          for (let k = 0; k <= 24; k++) {
            const a = (k / 24) * (Math.PI / 2);
            pts.push(new THREE.Vector3(hx + (ad[0] * Math.cos(a) + sd[0] * Math.sin(a)) * Lw, y0 + 0.05, hz + (ad[1] * Math.cos(a) + sd[1] * Math.sin(a)) * Lw));
          }
          g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), M.line));
        }
      });

      // slab over this storey: always between storeys, on top only with a roof
      if (mode === 'full' && (!top || cfg.roof)) {
        A.footRects.forEach(([x, y, w, h]) => slabs.add(X(x), X(x + w), y0 + H, y0 + H + SLAB, Z(y), Z(y + h)));
        if (top && cfg.parapet) A.ringRects.forEach(([x, y, w, h]) => walls.add(X(x), X(x + w), y0 + H + SLAB, y0 + H + SLAB + 0.9, Z(y), Z(y + h)));
      }

      // furniture boxes
      const fb = {};
      Object.entries(furn.boxes).forEach(([role, list]) => {
        const b = (fb[role] = new BoxBatch());
        list.forEach(([a, bb, c, d, e, f]) => b.add(a, bb, y0 + c, y0 + d, e, f));
      });
      if (cfg.lights && elements) {
        const lb = fb.lamp || (fb.lamp = new BoxBatch()), db = fb.dark || (fb.dark = new BoxBatch());
        furn.lamps.forEach((l) => {
          const [x, z] = l.at;
          if (l.table) { db.add(x - 0.06, x + 0.06, y0 + l.y, y0 + l.y + 0.2, z - 0.06, z + 0.06); lb.add(x - 0.13, x + 0.13, y0 + l.y + 0.2, y0 + l.y + 0.4, z - 0.13, z + 0.13); }
          else if (cfg.lighting === 'night') { db.add(x - 0.01, x + 0.01, y0 + l.y + 0.14, y0 + H, z - 0.01, z + 0.01); lb.add(x - 0.15, x + 0.15, y0 + l.y, y0 + l.y + 0.14, z - 0.15, z + 0.15); }
        });
      }

      const add = (mesh, name, opts = {}) => {
        if (!mesh) return null;
        mesh.name = name;
        if (opts.edges) mesh.userData.edges = true;
        if (opts.poche) { const p = new THREE.Mesh(mesh.geometry, M.poche); p.visible = false; p.userData.poche = true; g.add(p); pocheMeshes.push(p); }
        g.add(mesh);
        return mesh;
      };
      // massing reads best with poché wall tops
      add(walls.build([M.wall, mode === 'massing' ? M.pocheTop : M.wall]), 'walls', { edges: true, poche: true });
      add(floors.build([M.floor, M.floor], { colors: true, shadow: false }), 'floors', { edges: cfg.render !== 'realistic' });
      add(frames.build(M.frame), 'frames', { edges: cfg.render === 'blueprint' });
      add(glass.build(M.glass, { shadow: false }), 'glass');
      add(slabs.build(M.slab), 'slabs', { edges: true, poche: true });
      add(shades.build(M.slab), 'sunshades', { edges: true });
      Object.entries(fb).forEach(([role, b]) => add(b.build(M[role] || M.wood, { shadow: role !== 'rug' && role !== 'glass' && role !== 'mirror' }), `furniture-${role}`, { edges: role !== 'rug' }));

      // plants (instanced foliage)
      if (furn.plants.length) {
        const pots = new BoxBatch();
        furn.plants.forEach((p) => pots.add(p.x - 0.16 * p.s, p.x + 0.16 * p.s, y0, y0 + 0.36 * p.s, p.z - 0.16 * p.s, p.z + 0.16 * p.s));
        add(pots.build(M.pot), 'plant-pots', { edges: true });
        const leaves2 = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.32, 0), M.leafGreen, furn.plants.length);
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
        furn.plants.forEach((p, k) => {
          q.setFromEuler(new THREE.Euler(0, k * 1.7, 0));
          sc.set(p.s, p.s * 1.35, p.s);
          pos.set(p.x, y0 + 0.36 * p.s + 0.36 * p.s, p.z);
          leaves2.setMatrixAt(k, m4.compose(pos, q, sc));
        });
        leaves2.castShadow = true;
        leaves2.name = 'plant-foliage';
        g.add(leaves2);
      }
      model.add(g);
      storeyGroups.push(g);
    }

    if (elements) buildSite();
    if (cfg.render !== 'realistic') addEdges();

    root.add(model);
    model.scale.y = grow < 1 ? 0.0001 : 1;

    const plateTop = plate.material[2];
    plateTop.map = cfg.underlay ? plateTex : null;
    plateTop.color.set(cfg.render === 'blueprint' ? 0x1f4a73 : cfg.underlay ? 0xffffff : cfg.landscape ? 0xb9c4a8 : 0xe6ebe0);
    plateTop.transparent = cfg.render === 'blueprint';
    plateTop.opacity = cfg.render === 'blueprint' ? 0.35 : 1;
    plateTop.needsUpdate = true;

    applyLighting();
    applyLive();
    buildLabels();
    return stats();
  }

  /* ---------- site: lawn, trees, entrance path, compound wall, people ---------- */
  function buildSite() {
    const A = analysis, M = mats, cell = A.cell;
    const g = new THREE.Group();
    g.name = 'site';
    const fx0 = (A.bbox.x0 - A.cx) * cell, fx1 = (A.bbox.x1 - A.cx) * cell;
    const fz0 = (A.bbox.y0 - A.cy) * cell, fz1 = (A.bbox.y1 - A.cy) * cell;
    const off = 3.5;
    const entrance = A.openings.find((op) => op.exterior && typeOf(op) === 'door');
    let path = null;
    if (entrance) {
      const out = -entrance.swing;
      const X = (gx) => (gx - A.cx) * cell, Z = (gy) => (gy - A.cy) * cell;
      const w = entrance.length + 0.5;
      if (entrance.dir === 'h') {
        const xc = X(entrance.x + entrance.w / 2), zf = out < 0 ? Z(entrance.y) : Z(entrance.y + entrance.h);
        path = { x0: xc - w / 2, x1: xc + w / 2, z0: Math.min(zf, zf + out * (Math.abs((out < 0 ? fz0 : fz1) - zf) + off + 1)), z1: Math.max(zf, zf + out * (Math.abs((out < 0 ? fz0 : fz1) - zf) + off + 1)), axis: 'z', side: out < 0 ? 'N' : 'S' };
      } else {
        const zc = Z(entrance.y + entrance.h / 2), xf = out < 0 ? X(entrance.x) : X(entrance.x + entrance.w);
        path = { z0: zc - w / 2, z1: zc + w / 2, x0: Math.min(xf, xf + out * (Math.abs((out < 0 ? fx0 : fx1) - xf) + off + 1)), x1: Math.max(xf, xf + out * (Math.abs((out < 0 ? fx0 : fx1) - xf) + off + 1)), axis: 'x', side: out < 0 ? 'W' : 'E' };
      }
    }

    if (cfg.landscape) {
      const S = Math.max(fx1 - fx0, fz1 - fz0) + off * 2 + 20;
      const lawn = new THREE.Mesh(new THREE.BoxGeometry(S, 0.1, S).translate(0, -0.17, 0), M.lawn);
      M.lawn.map && M.lawn.map.repeat.set(S / 2, S / 2);
      lawn.receiveShadow = true; lawn.name = 'lawn';
      g.add(lawn);
      if (path) {
        const pb = new BoxBatch();
        pb.add(path.x0, path.x1, -0.12, -0.1, path.z0, path.z1);
        const m = pb.build(M.paving, { shadow: false }); m.name = 'path'; m.userData.edges = true; g.add(m);
      }
      // trees on a loose ring around the house, kept off the path
      const trees = [];
      const per = 2 * (fx1 - fx0 + fz1 - fz0) + 8 * off;
      const count = clamp(Math.round(per / 9), 4, 14);
      let sd = 7;
      const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
      for (let k = 0; k < count * 3 && trees.length < count; k++) {
        const side = k % 4, t = r();
        const d = off + 1.2 + r() * 3;
        let x, z;
        if (side === 0) { x = lerp(fx0 - d, fx1 + d, t); z = fz0 - d; }
        else if (side === 1) { x = fx1 + d; z = lerp(fz0 - d, fz1 + d, t); }
        else if (side === 2) { x = lerp(fx0 - d, fx1 + d, t); z = fz1 + d; }
        else { x = fx0 - d; z = lerp(fz0 - d, fz1 + d, t); }
        if (path && x > path.x0 - 1.6 && x < path.x1 + 1.6 && z > path.z0 - 1.6 && z < path.z1 + 1.6) continue;
        if (trees.some((q) => Math.hypot(q.x - x, q.z - z) < 3.2)) continue;
        trees.push({ x, z, s: 0.6 + r() * 0.45 });
      }
      if (trees.length) {
        const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.16, 1, 6).translate(0, 0.5, 0), M.trunk, trees.length);
        const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), M.leafLight, trees.length);
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
        trees.forEach((t, k) => {
          trunk.setMatrixAt(k, m4.compose(pos.set(t.x, -0.12, t.z), q, sc.set(t.s, 2.2 * t.s, t.s)));
          crown.setMatrixAt(k, m4.compose(pos.set(t.x, 2.2 * t.s + 0.8 * t.s, t.z), q.setFromEuler(new THREE.Euler(0, k, 0)), sc.set(1.15 * t.s, 1.0 * t.s, 1.15 * t.s)));
          q.identity();
        });
        trunk.castShadow = crown.castShadow = true;
        trunk.name = 'tree-trunks'; crown.name = 'tree-crowns';
        g.add(trunk, crown);
      }
    }

    if (cfg.compound) {
      const cb = new BoxBatch(), t = 0.2, h = 1.2, y = -0.12;
      const X0 = fx0 - off, X1 = fx1 + off, Z0 = fz0 - off, Z1 = fz1 + off;
      const gate = path ? { a: (path.axis === 'z' ? path.x0 : path.z0) - 0.5, b: (path.axis === 'z' ? path.x1 : path.z1) + 0.5, side: path.side } : null;
      const run = (side, a0, a1, fixed) => {
        const segs = gate && gate.side === side ? [[a0, gate.a], [gate.b, a1]] : [[a0, a1]];
        segs.forEach(([a, b]) => {
          if (b - a < 0.05) return;
          if (side === 'N' || side === 'S') cb.add(a, b, y, y + h, fixed - t / 2, fixed + t / 2);
          else cb.add(fixed - t / 2, fixed + t / 2, y, y + h, a, b);
        });
      };
      run('N', X0, X1, Z0); run('S', X0, X1, Z1); run('W', Z0, Z1, X0); run('E', Z0, Z1, X1);
      const m = cb.build(M.compound); m.name = 'compound-wall'; m.userData.edges = true; g.add(m);
    }

    if (cfg.people) {
      const spots = [];
      if (path) spots.push(path.axis === 'z' ? [(path.x0 + path.x1) / 2 + 0.4, -0.12, path.side === 'N' ? path.z0 + 1.2 : path.z1 - 1.2] : [path.side === 'W' ? path.x0 + 1.2 : path.x1 - 1.2, -0.12, (path.z0 + path.z1) / 2 + 0.4]);
      const byArea = A.rooms.map((r, i) => ({ r, i })).filter(({ i }) => ['living', 'dining', 'kitchen', 'balcony'].includes(roomTypes[i])).sort((a, b) => b.r.area - a.r.area);
      byArea.slice(0, 2).forEach(({ r }) => {
        const rx = (r.rect.x + r.rect.w * 0.5 - A.cx) * cell, rz = (r.rect.y + r.rect.h * 0.62 - A.cy) * cell;
        spots.push([rx + 0.4, 0.03, rz]);
      });
      const tones = [0xb7a58f, 0x8f9a86, 0xc7b49a, 0x9a8f86];
      spots.forEach(([x, y, z], k) => {
        const mat = cfg.render === 'realistic' && !FINISHES[cfg.finish].card ? new THREE.MeshLambertMaterial({ color: tones[k % tones.length] }) : M.person;
        if (mat !== M.person) mats[`person${k}`] = mat;
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 1.05, 4, 10), mat);
        body.position.set(x, y + 0.17 + 0.525, z);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), mat);
        head.position.set(x, y + 1.6, z);
        body.castShadow = head.castShadow = true;
        body.name = head.name = 'person';
        g.add(body, head);
      });
    }
    model.add(g);
  }

  function addEdges() {
    const lines = [];
    model.traverse((o) => {
      if (!o.isMesh || !o.userData.edges || o.userData.poche) return;
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 25), mats.edge);
      e.position.copy(o.position); e.rotation.copy(o.rotation); e.scale.copy(o.scale);
      e.userData.isEdge = true;
      lines.push([o.parent, e]);
    });
    lines.forEach(([p, e]) => p.add(e));
  }

  /* ---------- live settings (no rebuild) ---------- */
  function sectionY() {
    if (cfg.mode === 'cut') return 1.2;
    if (cfg.section) return cfg.sectionHeight;
    return null;
  }
  function applyLive() {
    const cut = sectionY();
    renderer.clippingPlanes = cut === null ? [] : [clipPlane];
    clipPlane.constant = cut === null ? 1e6 : cut;
    pocheMeshes.forEach((p) => { p.visible = cut !== null; });
    const H = cfg.wallHeight;
    storeyGroups.forEach((g, k) => { g.position.y = k * (cfg.mode === 'full' ? cfg.explode : 0); });
    controls.autoRotate = !!cfg.autoRotate && !reduced;
    // interior lights at night, in the storey whose floor is visible
    const night = cfg.lighting === 'night' && cfg.render === 'realistic' && cfg.mode !== 'massing';
    const k = labelStorey();
    const yBase = k * (H + SLAB) + k * (cfg.mode === 'full' ? cfg.explode : 0);
    const rooms = analysis ? analysis.rooms.map((r, i) => ({ r, i })).filter(({ i }) => roomTypes[i] !== 'empty').sort((a, b) => b.r.area - a.r.area) : [];
    lamps.forEach((l, i) => {
      const it = rooms[i];
      if (!night || !it) { l.intensity = 0; return; }
      const A = analysis;
      l.position.set((it.r.lx + 0.5 - A.cx) * A.cell, yBase + Math.min(H - 0.5, (cut ?? 99) - 0.2), (it.r.ly + 0.5 - A.cy) * A.cell);
      l.intensity = clamp(it.r.area * 0.9, 6, 22);
      l.distance = Math.sqrt(it.r.area) * 2.2 + 2;
    });
  }
  function labelStorey() {
    const storeys = cfg.mode === 'cut' ? 1 : cfg.storeys;
    const cut = sectionY();
    if (cut !== null) return clamp(Math.floor(cut / (cfg.wallHeight + SLAB)), 0, storeys - 1);
    return storeys - 1;
  }

  function stats() {
    const count = (t) => analysis.openings.filter((op) => typeOf(op) === t).length;
    return {
      doors: count('door'), windows: count('window'), openings: count('opening'),
      rooms: analysis.rooms.length, width: analysis.width, depth: analysis.depth,
      builtUp: analysis.builtUp, carpet: analysis.carpet, coverage: analysis.coverage,
      walls: analysis.wallRects.length, grid: analysis.grid
    };
  }

  /* ---------- labels: room names/areas and overall dimensions ---------- */
  function buildLabels() {
    labelEls.forEach((l) => l.el.remove());
    labelEls = [];
    if (!labelsEl) return;
    const A = analysis;
    const roofed = cfg.mode === 'full' && cfg.roof && sectionY() === null;
    if (cfg.labels && !roofed) {
      A.rooms.forEach((r, i) => {
        if (r.area < 1.5) return;
        const el = document.createElement('span');
        el.className = A.rooms.length > 12 ? 'room-pin compact' : 'room-pin';
        el.innerHTML = `<b>${i + 1}</b><span>${ROOM_TYPES[roomTypes[i]] || 'Room'}</span><em>${r.area.toFixed(1)} m²</em>`;
        labelsEl.appendChild(el);
        labelEls.push({ el, at: new THREE.Vector3((r.lx + 0.5 - A.cx) * A.cell, 0, (r.ly + 0.5 - A.cy) * A.cell), room: true });
      });
    }
    if (dimLines) { root.remove(dimLines); dimLines.geometry.dispose(); dimLines = null; }
    if (cfg.dimensions) {
      const fx0 = (A.bbox.x0 - A.cx) * A.cell, fx1 = (A.bbox.x1 - A.cx) * A.cell;
      const fz0 = (A.bbox.y0 - A.cy) * A.cell, fz1 = (A.bbox.y1 - A.cy) * A.cell;
      const o = 1.3, y = 0.02, t = 0.25, pts = [];
      const seg = (a, b) => pts.push(a[0], y, a[1], b[0], y, b[1]);
      seg([fx0, fz1 + o], [fx1, fz1 + o]); seg([fx0, fz1 + o - t], [fx0, fz1 + o + t]); seg([fx1, fz1 + o - t], [fx1, fz1 + o + t]);
      seg([fx1 + o, fz0], [fx1 + o, fz1]); seg([fx1 + o - t, fz0], [fx1 + o + t, fz0]); seg([fx1 + o - t, fz1], [fx1 + o + t, fz1]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      dimLines = new THREE.LineSegments(geo, cfg.render === 'blueprint' ? mats.edge : mats.line);
      dimLines.name = 'dimensions';
      root.add(dimLines);
      [[`${(fx1 - fx0).toFixed(2)} m`, [(fx0 + fx1) / 2, fz1 + o]], [`${(fz1 - fz0).toFixed(2)} m`, [fx1 + o, (fz0 + fz1) / 2]]].forEach(([txt, [x, z]]) => {
        const el = document.createElement('span');
        el.className = 'dim-pin';
        el.textContent = txt;
        labelsEl.appendChild(el);
        labelEls.push({ el, at: new THREE.Vector3(x, y, z), room: false });
      });
    }
  }
  let dimLines = null;

  function makePlate(src) {
    if (plate) { root.remove(plate); disposeTree(plate); }
    if (plateTex) plateTex.dispose();
    plateTex = new THREE.CanvasTexture(rasterise(src, 2048));
    plateTex.colorSpace = THREE.SRGBColorSpace;
    plateTex.anisotropy = 8;
    const A = analysis, W = A.gw * A.cell, D = A.gh * A.cell;
    const edge = new THREE.MeshLambertMaterial({ color: 0xe6ebe0 });
    const top = new THREE.MeshLambertMaterial({ map: plateTex });
    plate = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, D).translate(0, -0.06, 0), [edge, edge, top, edge, edge, edge]);
    plate.position.set((A.gw / 2 - A.cx) * A.cell, -0.005, (A.gh / 2 - A.cy) * A.cell);
    plate.receiveShadow = true;
    plate.name = 'drawing';
    root.add(plate);
    size = Math.max(A.width, A.depth) + 8;
    const r = size * 0.85;
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 0.5, far: size * 6 });
    sun.shadow.camera.updateProjectionMatrix();
    camera.far = size * 25;
    camera.updateProjectionMatrix();
    controls.maxDistance = size * 5;
    controls.minDistance = 1;
  }

  /* ---------- camera ---------- */
  let tween = null;
  function viewPose(name) {
    const A = analysis;
    const s = Math.max(A.width, A.depth);
    const storeys = cfg.mode === 'cut' ? 1 : cfg.storeys;
    const tall = storeys * (cfg.wallHeight + SLAB) + (cfg.mode === 'full' ? (storeys - 1) * cfg.explode : 0);
    const k = Math.max(1, 1.05 / Math.max(0.3, camera.aspect));
    if (name === 'top') return { pos: new THREE.Vector3(0, s * 2.1 * k + tall, 0.001), target: new THREE.Vector3(0, 0, 0) };
    if (name === 'front') {
      const d = Math.max(s, tall * 2) * 2.0 * k;
      return { pos: new THREE.Vector3(0, tall * 0.55 + 1.2, A.depth / 2 + d), target: new THREE.Vector3(0, tall * 0.45, 0) };
    }
    if (name === 'eye') {
      const room = A.rooms.reduce((a, b) => (b.area > a.area ? b : a), A.rooms[0]);
      const ls = labelStorey();
      const base = ls * (cfg.wallHeight + SLAB + (cfg.mode === 'full' ? cfg.explode : 0));
      const eyeY = base + Math.min(1.6, (sectionY() ?? 99) - 0.2);
      if (!room) return { pos: new THREE.Vector3(0, eyeY, s), target: new THREE.Vector3(0, base + 1, 0) };
      const W = (gx) => (gx - A.cx) * A.cell, D = (gy) => (gy - A.cy) * A.cell;
      const { x, y, w, h } = room.rect;
      const pz = D(room.ly + 0.5), px = W(room.lx + 0.5);
      if (w >= h) return { pos: new THREE.Vector3(W(x + w * 0.06), eyeY, pz), target: new THREE.Vector3(W(x + w), eyeY - 0.2, pz) };
      return { pos: new THREE.Vector3(px, eyeY, D(y + h * 0.06)), target: new THREE.Vector3(px, eyeY - 0.2, D(y + h)) };
    }
    const d = s * 1.7 * k + tall * 1.1;
    return { pos: new THREE.Vector3(d * 0.55, d * 0.95 + tall * 0.3, d * 0.72), target: new THREE.Vector3(0, tall * 0.35, 0) };
  }
  function goTo(name, snap) {
    const p = viewPose(name);
    if (snap || reduced) { camera.position.copy(p.pos); controls.target.copy(p.target); controls.update(); tween = null; return; }
    tween = { fromP: camera.position.clone(), fromT: controls.target.clone(), toP: p.pos, toT: p.target, t: 0 };
  }

  /* ---------- picking openings ---------- */
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
    const next = order[(order.indexOf(typeOf(op)) + 1) % order.length];
    if (next === op.type) overrides.delete(op.key); else overrides.set(op.key, next);
    const st = build();
    onPick && onPick(next, st);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons || !analysis || cfg.mode === 'massing') { canvas.style.cursor = ''; return; }
    canvas.style.cursor = pick(e) >= 0 ? 'pointer' : '';
  });

  /* ---------- render loop ---------- */
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
      if (grow < 1) { grow = Math.min(1, grow + dt / 1.3); model.scale.y = Math.max(0.0001, 1 - Math.pow(1 - grow, 3)); }
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
        const ls = labelStorey();
        const ly = ls * (cfg.wallHeight + SLAB + (cfg.mode === 'full' ? cfg.explode : 0)) + 0.1;
        const cut = sectionY();
        const inside = camera.position.y < (cut ?? (cfg.mode === 'cut' ? 1.2 : (ls + 1) * (cfg.wallHeight + SLAB)));
        labelEls.forEach((l) => {
          v.copy(l.at);
          if (l.room) v.y = ly * model.scale.y;
          v.project(camera);
          const off = (l.room && inside) || v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05;
          l.el.style.opacity = off ? 0 : 1;
          l.el.style.transform = `translate(${((v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -50%)`;
        });
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  /* ---------- API ---------- */
  const api = {
    load(src, config) {
      cfg = { ...config };
      const a = analysePlan(src, cfg);
      if (!a) return null;
      analysis = a; source = src;
      overrides.clear();
      roomTypes = guessRoomTypes(analysis);
      makePlate(src);
      grow = reduced ? 1 : 0;
      const st = build();
      goTo('axo', true);
      return st;
    },
    reanalyse(config) {
      if (!source) return null;
      const reframe = Math.abs(config.width - cfg.width) / cfg.width > 0.15;
      cfg = { ...config };
      const a = analysePlan(source, cfg);
      if (!a) return null;
      analysis = a;
      roomTypes = guessRoomTypes(analysis);
      makePlate(source);
      const st = build();
      if (reframe) goTo('axo');
      return st;
    },
    configure(config) {
      if (!analysis) return null;
      const reframe = config.storeys !== cfg.storeys || config.mode !== cfg.mode;
      cfg = { ...config };
      const st = build();
      if (reframe) goTo('axo');
      return st;
    },
    /** settings that change without rebuilding geometry */
    live(config) {
      if (!analysis) return;
      const relabel = config.section !== cfg.section || config.sectionHeight !== cfg.sectionHeight || config.explode !== cfg.explode;
      const reframe = config.explode !== cfg.explode && !tween;
      cfg = { ...config };
      if (cfg.render !== 'blueprint') {
        const x = cfg.xray < 1;
        mats.wall.transparent = x; mats.wall.opacity = x ? cfg.xray : 1; mats.wall.depthWrite = !x; mats.wall.needsUpdate = true;
      }
      sun.castShadow = cfg.shadows && cfg.render !== 'blueprint';
      applyLive();
      if (relabel) buildLabels();
      if (reframe && Math.abs(config.explode - (this._lastFrameExplode ?? 0)) > 0.8) { this._lastFrameExplode = config.explode; goTo('axo'); }
    },
    setSun(t) { sunT = t; if (cfg) applyLighting(); },
    setRoomType(i, type) { roomTypes[i] = type; return build(); },
    get roomTypes() { return roomTypes.slice(); },
    view: (name) => analysis && goTo(name),
    replay() { if (!reduced && model) grow = 0; },
    resetOpenings() { overrides.clear(); return analysis ? build() : null; },
    get analysis() { return analysis; },
    get source() { return source; },
    typeOf,
    snapshot() {
      renderer.render(scene, camera);
      return new Promise((res) => canvas.toBlob(res, 'image/png'));
    },
    async exportGLB() {
      const { GLTFExporter } = await import('../../vendor/addons/GLTFExporter.js');
      const hidden = [];
      root.traverse((o) => { if ((hits.includes(o) || o.userData.poche || o.userData.isEdge) && o.visible) { o.visible = false; hidden.push(o); } });
      try {
        const out = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
        return new Blob([out], { type: 'model/gltf-binary' });
      } finally {
        hidden.forEach((o) => { o.visible = true; });
      }
    }
  };
  return api;
}
