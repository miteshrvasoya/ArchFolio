/* ==========================================================================
   .PLN architects — 3D study model
   One procedural house (concrete, brick arches, water court, jaali screen)
   used twice on the page:
     - hero:   the plan drafts itself, extrudes into a building, then a
               sun-path study plays across it (slider controlled)
     - viewer: the same model read at three drawing scales
               (1:500 site, 1:100 section cut, 1:5 jaali wall detail)
   ========================================================================== */
import * as THREE from '../vendor/three.module.min.js';

const COL = {
  plate: 0xe6ebe0,
  concrete: 0xdedcd5,
  concreteDark: 0xc4c2ba,
  brick: 0xa85a32,
  timber: 0x8a5a3a,
  steel: 0x333b2f,
  glass: 0x26322d,
  water: 0x6fa39b,
  sage: 0x6a795d,
  sageLight: 0x8c9a7f,
  terra: 0x6e3511,
  sun: 0xe09a3a
};

const DEG = Math.PI / 180;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------- procedural textures (1 uv unit = 1 metre) ---------- */
function brickTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#d9c8b4';
  g.fillRect(0, 0, 256, 256);
  const rows = 16, cols = 4, bh = 256 / rows, bw = 256 / cols;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let r = 0; r < rows; r++) {
    for (let k = -1; k < cols; k++) {
      const x = k * bw + (r % 2 ? bw / 2 : 0);
      const l = 40 + rnd() * 9, h = 18 + rnd() * 6;
      g.fillStyle = `hsl(${h} 55% ${l}%)`;
      g.fillRect(x + 1.5, r * bh + 1.5, bw - 3, bh - 3);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 0.75);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function concreteTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let r = 0; r < 8; r++) {            // board-formed shuttering bands
    g.fillStyle = `rgba(60,66,54,${0.02 + rnd() * 0.06})`;
    g.fillRect(0, r * 32, 256, 32);
    g.fillStyle = 'rgba(60,66,54,0.16)';
    g.fillRect(0, r * 32, 256, 1);
  }
  g.fillStyle = 'rgba(60,66,54,0.28)';     // tie-rod holes
  [[64, 80], [192, 80], [64, 208], [192, 208]].forEach(([x, y]) => {
    g.beginPath(); g.arc(x, y, 2.4, 0, 7); g.fill();
  });
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 1.2, 1 / 1.2);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* Box sitting on y = 0 with UVs measured in metres */
function boxGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]);
    }
  }
  return g;
}

/* ---------- the house ---------- */
function buildHouse() {
  const group = new THREE.Group();
  const parts = [];       // animated during the build sequence
  const footprints = [];  // rectangles drafted as the plan

  const brickMap = brickTexture();
  const concMap = concreteTexture();
  const M = {
    plate: new THREE.MeshLambertMaterial({ color: COL.plate }),
    concrete: new THREE.MeshLambertMaterial({ color: COL.concrete, map: concMap }),
    concreteDark: new THREE.MeshLambertMaterial({ color: COL.concreteDark, map: concMap }),
    brick: new THREE.MeshLambertMaterial({ color: 0xffffff, map: brickMap }),
    timber: new THREE.MeshLambertMaterial({ color: COL.timber }),
    steel: new THREE.MeshLambertMaterial({ color: COL.steel }),
    glass: new THREE.MeshLambertMaterial({ color: COL.glass, transparent: true, opacity: 0.5 }),
    rail: new THREE.MeshLambertMaterial({ color: 0xcfe0da, transparent: true, opacity: 0.35 }),
    water: new THREE.MeshLambertMaterial({ color: COL.water, transparent: true, opacity: 0.86 }),
    leaf: new THREE.MeshLambertMaterial({ color: COL.sage, flatShading: true }),
    leafLight: new THREE.MeshLambertMaterial({ color: COL.sageLight, flatShading: true })
  };

  const add = (mesh, stage, mode = 'rise') => {
    const soft = mesh.material.transparent;
    mesh.castShadow = !soft;
    mesh.receiveShadow = true;
    mesh.userData.soft = soft;
    group.add(mesh);
    if (stage) parts.push({ obj: mesh, stage, mode, y: mesh.position.y });
    return mesh;
  };

  const B = (x0, x1, y0, h, z0, z1, mat, stage, mode, plan) => {
    const m = new THREE.Mesh(boxGeo(x1 - x0, h, z1 - z0), mat);
    m.position.set((x0 + x1) / 2, y0, (z0 + z1) / 2);
    if (plan) footprints.push([x0, x1, z0, z1]);
    return add(m, stage, mode);
  };

  /* South-facing wall with round-headed openings (the studio's brick arches) */
  const archWall = (x0, x1, y0, h, z, t, mat, stage, openings) => {
    const L = x1 - x0;
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(L, 0); s.lineTo(L, h); s.lineTo(0, h); s.closePath();
    openings.forEach(({ cx, w, sill, top }) => {
      const r = w / 2, p = new THREE.Path();
      p.moveTo(cx - r, sill);
      p.lineTo(cx - r, top - r);
      p.absarc(cx, top - r, r, Math.PI, 0, true);
      p.lineTo(cx + r, sill);
      p.closePath();
      s.holes.push(p);
    });
    const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 14 });
    const m = new THREE.Mesh(g, mat);
    m.position.set(x0, y0, z - t);
    footprints.push([x0, x1, z - t, z]);
    return add(m, stage, 'rise');
  };

  const T = 0.25;                 // wall thickness
  const GF = 0.45, GH = 3.0;      // ground floor level / height
  const FF = GF + GH + 0.3, FH = 2.9;
  const RF = FF + FH;

  // site plate (always present — the sheet the plan is drawn on)
  B(-15, 17, -0.4, 0.4, -12, 14, M.plate, 0);

  /* --- stage 1: site works --- */
  B(-8.5, 7.6, 0, GF, -5.5, 3.6, M.concreteDark, 1, 'rise', true);            // plinth
  B(0.5, 12, 0, 0.3, 4.6, 9.6, M.concrete, 1, 'rise', true);                  // pool rim (south)
  B(8.6, 12, 0, 0.3, -3, 4.6, M.concrete, 1, 'rise', true);                   // pool rim (east)
  B(-2.2, 0.2, 0, 0.15, 3.6, 4.5, M.concrete, 1);                             // entry steps
  B(-2.2, 0.2, 0.15, 0.15, 3.6, 4.2, M.concrete, 1);
  B(-2.2, 0.2, 0.3, 0.15, 3.6, 3.9, M.concrete, 1);
  B(-1.8, -0.2, 0, 0.03, 4.5, 13.6, M.concrete, 1);                           // approach path
  B(-14.6, 16.6, 0, 1.1, -11.6, -11.4, M.brick, 1, 'rise', true);             // compound walls
  B(-14.6, -14.4, 0, 1.1, -11.4, 13.6, M.brick, 1, 'rise', true);
  B(16.4, 16.6, 0, 1.1, -11.4, 13.6, M.brick, 1, 'rise', true);

  /* --- stage 2: ground floor --- */
  B(-8, -8 + T, GF, GH, -5, 1, M.concrete, 2, 'rise', true);                  // core block
  B(-8, 7, GF, GH, -5, -5 + T, M.concrete, 2, 'rise', true);                  // north wall
  B(-8, -2.5, GF, GH, 1 - T, 1, M.concrete, 2, 'rise', true);
  B(-2.5 - T, -2.5, GF, GH, -5, 1.5, M.concrete, 2, 'rise', true);
  B(7 - T, 7, GF, GH, -5, 1.5, M.concrete, 2, 'rise', true);                  // east wall
  B(-8.2, -8, GF, GH, 1, 3.4, M.concrete, 2, 'rise', true);                   // verandah pier
  archWall(-2.5, 7, GF, GH, 1.5, 0.32, M.brick, 2, [
    { cx: 1.75, w: 2.2, sill: 0, top: 2.65 },
    { cx: 4.75, w: 2.2, sill: 0, top: 2.65 },
    { cx: 7.75, w: 2.2, sill: 0, top: 2.65 }
  ]);

  // perforated brick jaali in front of the west verandah
  const jaali = (() => {
    const bw = 0.23, bh = 0.075, bd = 0.11, px = 0.33, py = 0.086;
    const x0 = -7.9, x1 = -2.6, cols = Math.floor((x1 - x0) / px), rows = Math.floor(GH / py);
    const mesh = new THREE.InstancedMesh(boxGeo(bw, bh, bd), M.brick, cols * rows);
    const slots = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        slots.push([x0 + px / 2 + c * px + (r % 2 ? px / 2 : 0) - px / 4, r * py]);
      }
    }
    mesh.position.set(0, GF, 3.2);
    const dummy = new THREE.Object3D();
    let last = null;
    const set = (angle) => {
      if (last !== null && Math.abs(angle - last) < 0.002) return;
      last = angle;
      slots.forEach(([x, y], i) => {
        dummy.position.set(x, y, 0);
        dummy.rotation.y = angle * (Math.floor(i / cols) % 2 ? 1 : -1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    set(0);
    footprints.push([x0, x1, 3.15, 3.3]);
    add(mesh, 2, 'rise');
    return { set };
  })();

  /* --- stage 3: first-floor slab (cantilevers 2 m as a verandah) --- */
  B(-8.5, 7.6, GF + GH, 0.3, -5.5, 3.6, M.concrete, 3, 'drop');

  /* --- stage 4: first floor --- */
  B(-8, -8 + T, FF, FH, -5, 2.2, M.brick, 4, 'rise', true);                   // brick volume
  B(-8, -3, FF, FH, -5, -5 + T, M.brick, 4, 'rise', true);
  B(-3 - T, -3, FF, FH, -5, 2.2, M.brick, 4, 'rise', true);
  archWall(-8, -3, FF, FH, 2.2, 0.32, M.brick, 4, [
    { cx: 1.45, w: 1.5, sill: 0.6, top: 2.45 },
    { cx: 3.55, w: 1.5, sill: 0.6, top: 2.45 }
  ]);
  B(-3, 6, FF, FH, -5, -5 + T, M.concrete, 4, 'rise', true);                  // concrete volume
  B(6 - T, 6, FF, FH, -5, 0.5, M.concrete, 4, 'rise', true);
  B(-3, 6, FF + FH - 0.45, 0.45, 0.5 - T, 0.5, M.concrete, 4, 'drop');        // lintel

  /* --- stage 5: roof + timber-soffit canopy --- */
  B(-8.4, 6.5, RF, 0.3, -5.4, 2.6, M.concrete, 5, 'drop');
  B(-3.2, 8.2, RF - 0.1, 0.1, 0.3, 4.2, M.timber, 5, 'drop');
  B(-3.3, 8.3, RF, 0.22, 0.2, 4.3, M.concrete, 5, 'drop');
  B(7.9, 8.05, 0, RF - 0.1, 3.95, 4.1, M.steel, 5, 'rise');
  B(-2, 5.5, RF + 0.3, 0.5, -5.2, -4.4, M.concrete, 5, 'rise');               // roof planter

  /* --- stage 6: glass, water, planting, life --- */
  B(-2.3, 6.8, GF, GH, 1.22, 1.27, M.glass, 6);                               // behind ground arches
  B(-7.8, -3.2, FF, FH, 1.92, 1.97, M.glass, 6);                              // behind upper arches
  B(-2.9, 5.8, FF, FH - 0.45, 0.32, 0.37, M.glass, 6);                        // upper living glazing
  B(-2.8, 7.5, FF, 1.0, 3.48, 3.52, M.rail, 6);                               // balcony rail
  B(7.48, 7.52, FF, 1.0, 1.6, 3.5, M.rail, 6);
  B(0.8, 11.7, 0, 0.34, 4.9, 9.3, M.water, 6);                                // water court fills
  B(8.9, 11.7, 0, 0.34, -2.7, 4.9, M.water, 6);
  B(-1.9, 5.4, RF + 0.8, 0.35, -5.1, -4.5, M.leafLight, 6);                   // planter greens
  B(0.5, 3.3, GF, 0.45, -2.6, -1.7, M.timber, 6);                             // sofa
  B(4.2, 6, GF, 0.75, -3.6, -2.6, M.timber, 6);                               // dining table
  B(-1.5, 2.5, FF, 0.5, -3.4, -1.6, M.timber, 6);                             // bed

  const tree = (x, z, r, h, mat) => {
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, h, 6), M.steel);
    trunk.position.y = h / 2;
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat);
    crown.position.y = h + r * 0.6;
    crown.scale.y = 0.85;
    [trunk, crown].forEach((m) => { m.castShadow = true; m.receiveShadow = true; });
    t.add(trunk, crown);
    t.position.set(x, 0, z);
    group.add(t);
    parts.push({ obj: t, stage: 6, mode: 'pop', y: 0 });
  };
  tree(-11, 5.5, 2.3, 3.0, M.leaf);         // west shade tree
  tree(-11.5, -6.5, 1.8, 2.4, M.leafLight);
  tree(13.5, -8.5, 2.0, 2.6, M.leaf);
  tree(-11.8, 10.5, 1.5, 2.0, M.leafLight);
  tree(14.2, 11.5, 1.6, 2.2, M.leafLight);

  /* --- drafted plan lines --- */
  const pts = [];
  footprints.forEach(([x0, x1, z0, z1]) => {
    const y = 0.03;
    pts.push(x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0);
  });
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const planLines = new THREE.LineSegments(
    lineGeo,
    new THREE.LineBasicMaterial({ color: COL.terra, transparent: true })
  );
  group.add(planLines);

  // drafting grid on the plate
  const grid = new THREE.GridHelper(32, 16, COL.sage, COL.sage);
  grid.material.transparent = true;
  grid.material.opacity = 0.22;
  grid.position.set(1, 0.012, 1);
  grid.scale.z = 26 / 32;
  group.add(grid);

  // north arrow
  const arrow = new THREE.Shape();
  arrow.moveTo(0, 1.3); arrow.lineTo(0.55, -0.6); arrow.lineTo(0, -0.2); arrow.lineTo(-0.55, -0.6); arrow.closePath();
  const north = new THREE.Mesh(new THREE.ShapeGeometry(arrow), new THREE.MeshBasicMaterial({ color: COL.terra }));
  north.rotation.x = -Math.PI / 2;
  north.position.set(-12.6, 0.03, 12);
  group.add(north);

  /* --- terracotta "poché" fill shown on surfaces cut by the section plane --- */
  const pocheMat = new THREE.MeshBasicMaterial({ color: COL.terra, side: THREE.BackSide });
  const poches = [];
  group.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && !o.userData.soft && o !== north && !o.userData.poche) {
      const p = new THREE.Mesh(o.geometry, pocheMat);
      p.userData.poche = true;
      p.visible = false;
      poches.push([o, p]);
    }
  });
  poches.forEach(([o, p]) => o.add(p));

  /* --- build sequencing --- */
  const WINDOWS = { 1: [0.21, 0.36], 2: [0.3, 0.52], 3: [0.5, 0.6], 4: [0.58, 0.78], 5: [0.76, 0.88], 6: [0.86, 1] };
  const perStage = {};
  parts.forEach((p) => { (perStage[p.stage] = perStage[p.stage] || []).push(p); });
  Object.entries(perStage).forEach(([stage, list]) => {
    const [a, b] = WINDOWS[stage], span = (b - a) / 2;
    list.forEach((p, i) => { p.t0 = a + span * (i / list.length); p.t1 = p.t0 + span; });
  });
  const lineCount = pts.length / 3;

  const setBuild = (p) => {
    planLines.geometry.setDrawRange(0, Math.ceil((lineCount * clamp01(p / 0.22)) / 2) * 2);
    planLines.material.opacity = lerp(1, 0.4, smooth(0.6, 1, p));
    parts.forEach((part) => {
      const k = easeOut(clamp01((p - part.t0) / (part.t1 - part.t0)));
      const o = part.obj;
      o.visible = k > 0;
      if (part.mode === 'rise') o.scale.y = Math.max(k, 0.0001);
      else if (part.mode === 'drop') o.position.y = part.y + (1 - k) * 5;
      else o.scale.setScalar(Math.max(k, 0.0001));
    });
  };

  const setPoche = (on) => poches.forEach(([, p]) => { p.visible = on; });

  return { group, setBuild, setPoche, jaali };
}

/* ---------- camera presets ---------- */
const VIEWS = {
  hero: { az: 34, el: 22, dist: 50, target: [1.2, 2.4, 1.2] },
  site: { az: 18, el: 58, dist: 60, target: [1, 0, 1.5], sun: 0.34, clip: null },
  section: { az: 90, el: 5, dist: 22, target: [2.5, 3.6, 1.6], sun: 0.5, clip: 2.5 },
  detail: { az: 24, el: 8, dist: 10.5, target: [-5.2, 2.0, 3.2], sun: 0.3, clip: null }
};

const LABELS = {
  site: [
    { at: [10.3, 0.5, 1.5], text: 'Water court · evaporative cooling' },
    { at: [-11, 5.2, 5.5], text: 'Shade tree · filters low western sun' }
  ],
  section: [
    { at: [2.5, 8.6, 3.78], text: 'June sun 88° · stopped by the overhang' },
    { at: [2.5, 7.1, 7.25], text: 'December sun 45° · warms the living court' },
    { at: [2.5, 0.5, 7.2], text: 'Water court · cools the breeze' }
  ],
  detail: [
    { at: [-4.6, 2.9, 3.3], text: 'Brick jaali · breeze in, glare out' },
    { at: [-6.2, 3.62, 3.6], text: 'Slab overhang · noon shade' }
  ]
};

/* ---------- public: mount a study on a canvas ---------- */
export function createStudy(canvas, opts = {}) {
  const kind = opts.kind || 'hero';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 300);
  const house = buildHouse();
  scene.add(house.group);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xb4bcab, 1.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 120 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  // sun-path diagram: dashed arc + sun marker
  const SUN_C = new THREE.Vector3(1, 0, 1);
  const sunDir = (t, out) => {
    const a = Math.PI * t;
    return out.set(Math.cos(a) * 0.9, Math.sin(a) * 0.95 + 0.1, 0.42).normalize();
  };
  const arcPts = [];
  const tmp = new THREE.Vector3();
  for (let i = 0; i <= 48; i++) arcPts.push(sunDir(i / 48, tmp).clone().multiplyScalar(17).add(SUN_C));
  const arc = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(arcPts),
    new THREE.LineDashedMaterial({ color: COL.sage, dashSize: 0.5, gapSize: 0.35, transparent: true, opacity: 0.7 })
  );
  arc.computeLineDistances();
  const sunDot = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 14), new THREE.MeshBasicMaterial({ color: COL.sun }));
  scene.add(arc, sunDot);

  // section diagram: noon sun angles for Surat (21°N) grazing the slab edge
  const ray = (deg, color) => {
    const a = deg * DEG, edge = new THREE.Vector3(2.46, 3.5, 3.6);
    const from = edge.clone().add(new THREE.Vector3(0, Math.sin(a), Math.cos(a)).multiplyScalar(5.15));
    const to = edge.clone().add(new THREE.Vector3(0, -Math.sin(a), -Math.cos(a)).multiplyScalar(3.0 / Math.sin(a)));
    const l = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([from, to]),
      new THREE.LineDashedMaterial({ color, dashSize: 0.28, gapSize: 0.16 })
    );
    l.computeLineDistances();
    l.visible = false;
    scene.add(l);
    return l;
  };
  const rays = [ray(88, COL.terra), ray(45, COL.sun)];

  const warm = new THREE.Color(0xffb877), white = new THREE.Color(0xfff7ea);
  let sunT = -1;
  const setSun = (t) => {
    t = clamp01(t);
    if (Math.abs(t - sunT) < 0.0005) return;
    sunT = t;
    const d = sunDir(t, tmp);
    const height = Math.sin(Math.PI * t);
    sun.position.copy(d).multiplyScalar(60).add(SUN_C);
    sun.target.position.copy(SUN_C);
    sun.color.copy(warm).lerp(white, Math.pow(height, 0.6));
    sun.intensity = 0.9 + 1.5 * height;
    hemi.intensity = 1.75 + 0.3 * height;
    sunDot.position.copy(d).multiplyScalar(17).add(SUN_C);
  };

  /* --- state --- */
  const clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 20);
  const CLIP_OFF = 19;
  const cam = { az: 0, el: 0, dist: 0, target: new THREE.Vector3() };
  const goal = { az: 0, el: 0, dist: 0, target: new THREE.Vector3(), clip: CLIP_OFF, sun: 0.4 };
  let clip = CLIP_OFF;
  let mode = kind === 'hero' ? 'hero' : 'site';
  let build = reduced || kind !== 'hero' ? 1 : 0;
  let building = kind === 'hero' && !reduced;
  let phase = -1;
  let userAz = 0, dragging = false;
  let autoSun = kind === 'hero' && !reduced;
  let sunClock = 0.9;
  let aspect = 1, visible = true, time = 0, labelDelay = 0;

  const applyView = (name, snap) => {
    const v = VIEWS[name];
    goal.az = v.az * DEG; goal.el = v.el * DEG; goal.dist = v.dist;
    goal.target.fromArray(v.target);
    goal.clip = v.clip == null ? CLIP_OFF : v.clip;
    if (v.sun != null) goal.sun = v.sun;
    if (snap) {
      cam.az = goal.az; cam.el = goal.el; cam.dist = goal.dist; cam.target.copy(goal.target);
      clip = goal.clip;
    }
  };
  applyView(mode, true);

  /* --- labels (viewer only) --- */
  const labelEls = [];
  if (opts.labelsEl) {
    Object.entries(LABELS).forEach(([m, list]) => list.forEach((l) => {
      const el = document.createElement('span');
      el.className = 'pin';
      el.textContent = l.text;
      opts.labelsEl.appendChild(el);
      labelEls.push({ el, mode: m, at: new THREE.Vector3().fromArray(l.at) });
    }));
  }

  /* --- drag to orbit --- */
  let lastX = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('is-dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    userAz = Math.max(-1.3, Math.min(1.3, userAz - (e.clientX - lastX) * 0.006));
    lastX = e.clientX;
  });
  const endDrag = () => { dragging = false; canvas.classList.remove('is-dragging'); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  /* --- sizing / visibility --- */
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
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { rootMargin: '120px' }).observe(canvas);

  const v3 = new THREE.Vector3();
  const frame = (dt) => {
    time += dt;

    // build sequence (hero)
    if (building) {
      build = Math.min(1, build + dt / 7);
      if (build >= 1) building = false;
    }
    house.setBuild(build);
    const ph = build < 0.2 ? 0 : build < 0.6 ? 1 : build < 0.9 ? 2 : 3;
    if (ph !== phase) { phase = ph; opts.onPhase && opts.onPhase(ph); }

    // sun
    if (kind === 'hero') {
      if (autoSun && build >= 1) {
        sunClock += dt * 0.11;
        goal.sun = 0.5 - 0.4 * Math.cos(sunClock);
        opts.onSun && opts.onSun(goal.sun);
      }
      setSun(build < 1 ? 0.36 : lerp(sunT, goal.sun, 1 - Math.exp(-dt * 8)));
    } else {
      const drift = reduced ? 0 : Math.sin(time * 0.35) * (mode === 'detail' ? 0.07 : 0.12);
      setSun(lerp(sunT < 0 ? goal.sun : sunT, goal.sun + drift, 1 - Math.exp(-dt * 3)));
      house.jaali.set(mode === 'detail' && !reduced ? 0.5 + 0.45 * Math.sin(time * 0.7) : mode === 'detail' ? 0.6 : 0);
    }

    // camera
    const k = 1 - Math.exp(-dt * 3.2);
    const sway = reduced || dragging ? 0 : Math.sin(time * 0.22) * 0.1;
    let el = goal.el, dist = goal.dist;
    if (kind === 'hero') {
      el = lerp(80 * DEG, goal.el, smooth(0.12, 0.72, build));   // plan view → perspective
      dist *= Math.max(1, 1.28 / aspect);
    } else {
      dist *= Math.max(1, 1.45 / aspect);
    }
    cam.az = lerp(cam.az, goal.az + userAz + sway, k);
    cam.el = lerp(cam.el, el, kind === 'hero' && building ? 1 : k);
    cam.dist = lerp(cam.dist, dist, k);
    cam.target.lerp(goal.target, k);
    const ce = Math.cos(cam.el);
    camera.position.set(
      cam.target.x + cam.dist * Math.sin(cam.az) * ce,
      cam.target.y + cam.dist * Math.sin(cam.el),
      cam.target.z + cam.dist * Math.cos(cam.az) * ce
    );
    camera.lookAt(cam.target);

    // section cut
    clip = lerp(clip, goal.clip, 1 - Math.exp(-dt * 2.4));
    const cutting = clip < CLIP_OFF - 0.5;
    clipPlane.constant = clip;
    renderer.clippingPlanes = cutting ? [clipPlane] : [];
    house.setPoche(cutting);
    rays.forEach((r) => { r.visible = mode === 'section' && clip < goal.clip + 0.6; });
    arc.visible = sunDot.visible = (mode === 'hero' || mode === 'site') && build > 0.85;

    renderer.render(scene, camera);

    // labels
    if (labelEls.length) {
      labelDelay = Math.max(0, labelDelay - dt);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      labelEls.forEach((l) => {
        const on = l.mode === mode && labelDelay === 0;
        l.el.classList.toggle('is-on', on);
        if (l.mode !== mode) return;
        v3.copy(l.at).project(camera);
        const x = (v3.x * 0.5 + 0.5) * w, y = (-v3.y * 0.5 + 0.5) * h;
        const flip = x > w * 0.5;
        l.el.classList.toggle('flip', flip);
        l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)${flip ? ' translateX(-100%)' : ''}`;
      });
    }
  };

  let prev = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    if (visible && !document.hidden) frame(dt);
    requestAnimationFrame(loop);
  };
  setSun(goal.sun);
  frame(0);
  requestAnimationFrame(loop);

  return {
    /** t: 0 = 06:00, 1 = 18:00. Stops the automatic sweep. */
    setSun(t) { autoSun = false; goal.sun = clamp01(t); },
    replay() {
      if (reduced) return;
      build = 0; building = true; userAz = 0;
    },
    setMode(name) {
      if (!VIEWS[name] || name === mode) return;
      mode = name; userAz = 0; labelDelay = 1.1;
      applyView(name, reduced);
    }
  };
}
