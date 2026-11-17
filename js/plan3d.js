/* ==========================================================================
   Plan → 3D visualiser
   Reads an uploaded floor-plan image entirely in the browser, treats the
   dark, connected line-work as walls, and extrudes it into a 3D massing
   model standing on the original drawing.
   ========================================================================== */
import * as THREE from '../vendor/three.module.min.js';

const GRID = 260;           // cells along the longer side of the plan
const DEG = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------- image → wall rectangles ---------- */

/** Paint any image source on a white canvas no larger than `max` px. */
function rasterise(source, max) {
  const sw = source.naturalWidth || source.videoWidth || source.width;
  const sh = source.naturalHeight || source.videoHeight || source.height;
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

/**
 * sensitivity 0..1 — how light a line may be and still count as a wall
 * cleanup     0..1 — how aggressively small, detached marks (text, furniture,
 *                    door swings, dimensions) are discarded
 */
export function detectWalls(source, { sensitivity = 0.5, cleanup = 0.4 } = {}) {
  const small = rasterise(source, GRID);
  const gw = small.width, gh = small.height;
  const px = small.getContext('2d').getImageData(0, 0, gw, gh).data;
  const n = gw * gh;

  const lum = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    mean += lum[i];
  }
  mean /= n;
  const inverted = mean < 110;                 // blueprint: light lines on dark
  const cut = lerp(70, 215, sensitivity);
  const wall = new Uint8Array(n);
  for (let i = 0; i < n; i++) wall[i] = (inverted ? 255 - lum[i] : lum[i]) < cut ? 1 : 0;

  // connected components (8-neighbour); drop the small detached ones
  const label = new Int32Array(n).fill(-1);
  const sizes = [];
  const stack = [];
  for (let s = 0; s < n; s++) {
    if (!wall[s] || label[s] !== -1) continue;
    const id = sizes.length;
    let count = 0;
    stack.push(s); label[s] = id;
    while (stack.length) {
      const i = stack.pop(); count++;
      const x = i % gw, y = (i - x) / gw;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= gh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= gw) continue;
          const j = yy * gw + xx;
          if (wall[j] && label[j] === -1) { label[j] = id; stack.push(j); }
        }
      }
    }
    sizes.push(count);
  }
  const biggest = sizes.reduce((a, b) => Math.max(a, b), 0);
  const minSize = Math.min(biggest, Math.round(lerp(1, 0.2 * biggest + 40, cleanup * cleanup)));
  let cells = 0;
  for (let i = 0; i < n; i++) {
    if (wall[i] && sizes[label[i]] < minSize) wall[i] = 0;
    cells += wall[i];
  }

  // greedy merge of wall cells into rectangles
  const rects = [];
  const used = new Uint8Array(n);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      if (!wall[i] || used[i]) continue;
      let w = 1;
      while (x + w < gw && wall[i + w] && !used[i + w]) w++;
      let h = 1;
      grow: while (y + h < gh) {
        const row = (y + h) * gw + x;
        for (let k = 0; k < w; k++) if (!wall[row + k] || used[row + k]) break grow;
        h++;
      }
      for (let yy = 0; yy < h; yy++) used.fill(1, (y + yy) * gw + x, (y + yy) * gw + x + w);
      rects.push([x, y, w, h]);
    }
  }
  return { gw, gh, rects, coverage: cells / n };
}

/* ---------- viewer ---------- */
export function createPlanViewer(canvas) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 2000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb4bcab, 1.55));
  const sun = new THREE.DirectionalLight(0xfff3e0, 1.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const sideMat = new THREE.MeshLambertMaterial({ color: 0xe9e7e0 });
  const topMat = new THREE.MeshLambertMaterial({ color: 0x8a4a22 });   // cut walls read as poché
  const edgeMat = new THREE.MeshLambertMaterial({ color: 0xe6ebe0 });
  const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

  let source = null, texture = null, floor = null, walls = null;
  let size = 12;                 // largest plan dimension in metres (drives the camera)
  let height = 3, rise = 1;
  const cam = { az: 35 * DEG, el: 38 * DEG, dist: 30 };
  const goal = { az: 35 * DEG, el: 38 * DEG, zoom: 1 };
  let aspect = 1, visible = true, dragging = false;

  const clear = (o) => {
    if (!o) return;
    scene.remove(o);
    if (o !== walls) o.geometry.dispose();
    if (o.isInstancedMesh) o.dispose();
  };

  const build = (opts, animate) => {
    const { gw, gh, rects, coverage } = detectWalls(source, opts);
    const W = opts.width, cell = W / gw, D = gh * cell;
    size = Math.max(W, D);
    height = opts.height;

    clear(floor); clear(walls);
    const floorMat = new THREE.MeshLambertMaterial({ map: texture });
    floor = new THREE.Mesh(
      new THREE.BoxGeometry(W, size * 0.012, D).translate(0, -size * 0.006, 0),
      [edgeMat, edgeMat, floorMat, edgeMat, edgeMat, edgeMat]
    );
    floor.receiveShadow = true;
    scene.add(floor);

    walls = new THREE.InstancedMesh(unit, [sideMat, sideMat, topMat, sideMat, sideMat, sideMat], Math.max(1, rects.length));
    walls.count = rects.length;
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    rects.forEach(([x, y, w, h], i) => {
      p.set((x + w / 2) * cell - W / 2, 0, (y + h / 2) * cell - D / 2);
      s.set(w * cell, 1, h * cell);
      walls.setMatrixAt(i, m.compose(p, q, s));
    });
    walls.instanceMatrix.needsUpdate = true;
    walls.castShadow = walls.receiveShadow = true;
    walls.frustumCulled = false;
    scene.add(walls);

    const r = size * 0.85;
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: size * 0.1, far: size * 5 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.position.set(size * 0.9, size * 1.5, size * 0.7);

    if (animate && !reduced) rise = 0;
    return { segments: rects.length, coverage, gw, gh, depth: D };
  };

  /* orbit: drag to turn (and tilt with a mouse); page scroll stays free on touch */
  let lx = 0, ly = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; lx = e.clientX; ly = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('is-dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    goal.az -= (e.clientX - lx) * 0.008;
    if (e.pointerType === 'mouse') goal.el = Math.min(89 * DEG, Math.max(8 * DEG, goal.el + (e.clientY - ly) * 0.006));
    lx = e.clientX; ly = e.clientY;
  });
  const end = () => { dragging = false; canvas.classList.remove('is-dragging'); };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

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
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { rootMargin: '100px' }).observe(canvas);

  const target = new THREE.Vector3();
  let prev = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    if (visible && !document.hidden && walls) {
      rise = Math.min(1, rise + dt / 1.4);
      const k = 1 - Math.pow(1 - rise, 3);
      walls.scale.y = Math.max(0.0001, height * k);

      const t = reduced ? 1 : 1 - Math.exp(-dt * 6);
      cam.az = lerp(cam.az, goal.az, t);
      cam.el = lerp(cam.el, goal.el, t);
      cam.dist = lerp(cam.dist, size * 2.15 * goal.zoom * Math.max(1, 1.3 / aspect), t);
      target.set(0, height * 0.3, 0);
      const ce = Math.cos(cam.el);
      camera.position.set(cam.dist * Math.sin(cam.az) * ce, target.y + cam.dist * Math.sin(cam.el), cam.dist * Math.cos(cam.az) * ce);
      camera.lookAt(target);
      renderer.render(scene, camera);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return {
    /** Load a new plan (HTMLImageElement, ImageBitmap or canvas) and extrude it. */
    load(src, opts) {
      source = src;
      if (texture) texture.dispose();
      texture = new THREE.CanvasTexture(rasterise(src, 1600));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      goal.az = 35 * DEG; goal.el = 38 * DEG; goal.zoom = 1;
      return build(opts, true);
    },
    /** Re-run detection with new settings on the current plan. */
    update(opts) { return source ? build(opts, false) : null; },
    setHeight(h) { height = h; },
    view(name) {
      if (name === 'top') { goal.el = 89 * DEG; goal.az = 0; }
      else { goal.el = 38 * DEG; goal.az = 35 * DEG; }
      goal.zoom = 1;
    },
    zoom(f) { goal.zoom = Math.min(2.2, Math.max(0.35, goal.zoom * f)); },
    replay() { if (!reduced) rise = 0; }
  };
}

/* ---------- a sample drawing, so the tool can be tried without a file ---------- */
export function samplePlan() {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 860;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = g.fillStyle = '#1c2119';
  const wall = (x0, y0, x1, y1, t = 16) => { g.lineWidth = t; g.lineCap = 'square'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  const X0 = 140, Y0 = 120, X1 = 1060, Y1 = 720;
  // outer walls, with an entrance and two window gaps left open
  wall(X0, Y0, X1, Y0, 22); wall(X1, Y0, X1, Y1, 22); wall(X0, Y0, X0, Y1, 22);
  wall(X0, Y1, 470, Y1, 22); wall(560, Y1, X1, Y1, 22);
  // partitions with door openings
  wall(520, Y0, 520, 330); wall(520, 420, 520, 520);
  wall(X0, 420, 300, 420); wall(390, 420, 520, 420);
  wall(520, 520, 760, 520); wall(850, 520, X1, 520);
  wall(780, Y0, 780, 300); wall(780, 390, 780, 520);
  wall(620, 520, 620, 600); wall(620, 690, 620, Y1);
  // courtyard
  wall(880, 580, 1000, 580, 10); wall(880, 660, 1000, 660, 10); wall(880, 580, 880, 660, 10); wall(1000, 580, 1000, 660, 10);
  // thin drafting marks the clean-up should ignore
  g.lineWidth = 1.5;
  const arc = (x, y, r, a0, a1) => { g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke(); };
  arc(470, 705, 76, -Math.PI / 2, 0); arc(520, 405, 70, Math.PI / 2, Math.PI);
  g.beginPath(); g.moveTo(X0, 70); g.lineTo(X1, 70); g.moveTo(X0, 60); g.lineTo(X0, 80); g.moveTo(X1, 60); g.lineTo(X1, 80); g.stroke();
  g.strokeRect(190, 170, 150, 90); g.strokeRect(600, 180, 110, 60); g.strokeRect(840, 170, 160, 110);
  g.font = '500 22px sans-serif'; g.textAlign = 'center';
  [['LIVING', 330, 320], ['KITCHEN', 650, 330], ['BEDROOM', 920, 380], ['VERANDAH', 330, 590], ['BATH', 700, 640], ['COURT', 940, 628]]
    .forEach(([t, x, y]) => g.fillText(t, x, y));
  g.font = '18px monospace'; g.fillText('12 000', 600, 54);
  g.fillText('SAMPLE PLAN · 1:100', 600, 800);
  return c;
}
