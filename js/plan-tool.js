/* Plan → 3D page: controls, file handling, detection preview, export. */
const $ = (id) => document.getElementById(id);
const status = $('status');
const MAX_BYTES = 20 * 1024 * 1024;

const MODE_HELP = {
  massing: 'Walls only, full height — a quick read of volume and enclosure.',
  cut: 'The plan sliced at 1.2 m, as architects draw it: walls in poché, window sills, door swings.',
  full: 'Full-height walls with doors, windows, lintels, floor finish, storeys and an optional roof.'
};

const cfg = {
  mode: 'full', style: 'plaster', storeys: 1,
  width: 12, wallHeight: 3,
  doors: true, windows: true, floors: true, roof: false, labels: true, underlay: true,
  wallStyle: 'solid', sensitivity: 0.5, cleanup: 0.4, maxOpening: 2, exterior: 'auto'
};

let viewer = null, mod = null, busy = false, fileName = '';

const say = (msg, error = false) => {
  status.textContent = msg;
  status.classList.toggle('is-error', error);
};

const webglOk = () => {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
  catch { return false; }
};

/* ---------- controls → cfg ---------- */
function radioGroup(id, attr, key, cast = (v) => v, after) {
  const group = $(id);
  group.addEventListener('click', (e) => {
    const b = e.target.closest('[role="radio"]');
    if (!b || group.closest('fieldset')?.disabled) return;
    group.querySelectorAll('[role="radio"]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    cfg[key] = cast(b.dataset[attr]);
    after && after();
  });
  // arrow-key support for radio groups
  group.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const items = [...group.querySelectorAll('[role="radio"]')];
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = items[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length];
    next.focus(); next.click();
  });
}

const refreshUi = () => {
  $('modeHelp').textContent = MODE_HELP[cfg.mode];
  const full = cfg.mode === 'full';
  $('storeyField').hidden = !full;
  $('heightField').hidden = cfg.mode === 'cut';
  $('cRoof').disabled = !full;
  ['cDoors', 'cWindows', 'cFloors'].forEach((id) => { $(id).disabled = cfg.mode === 'massing'; });
  $('oWidth').textContent = `${cfg.width} m`;
  $('oHeight').textContent = `${cfg.wallHeight.toFixed(1)} m`;
  $('oSens').textContent = `${Math.round(cfg.sensitivity * 100)}%`;
  $('oClean').textContent = `${Math.round(cfg.cleanup * 100)}%`;
  $('oOpen').textContent = `${cfg.maxOpening.toFixed(1)} m`;
};

const configure = () => { refreshUi(); if (viewer) report(viewer.configure(cfg)); };
let raf = 0;
const reanalyse = () => {
  refreshUi();
  if (!viewer) return;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => report(viewer.reanalyse(cfg)));
};

radioGroup('modeSeg', 'mode', 'mode', String, configure);
radioGroup('styleSeg', 'style', 'style', String, configure);
radioGroup('storeySeg', 'storeys', 'storeys', Number, configure);
radioGroup('wallStyleSeg', 'ws', 'wallStyle', String, reanalyse);
radioGroup('exteriorSeg', 'ex', 'exterior', String, reanalyse);

const bindRange = (id, key, scale, rebuild) => $(id).addEventListener('input', (e) => {
  cfg[key] = Number(e.target.value) * scale;
  rebuild();
});
bindRange('rWidth', 'width', 1, reanalyse);
bindRange('rHeight', 'wallHeight', 1, configure);
bindRange('rSens', 'sensitivity', 0.01, reanalyse);
bindRange('rClean', 'cleanup', 0.01, reanalyse);
bindRange('rOpen', 'maxOpening', 1, reanalyse);

[['cDoors', 'doors'], ['cWindows', 'windows'], ['cFloors', 'floors'], ['cRoof', 'roof'], ['cLabels', 'labels'], ['cUnderlay', 'underlay']]
  .forEach(([id, key]) => $(id).addEventListener('change', (e) => { cfg[key] = e.target.checked; configure(); }));

$('resetOpenings').addEventListener('click', () => viewer && report(viewer.resetOpenings()));
$('rSun').addEventListener('input', (e) => viewer && viewer.setSun(e.target.value / 1000));
$('vtools').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !viewer) return;
  if (b.dataset.view === 'replay') viewer.replay(); else viewer.view(b.dataset.view);
});

/* ---------- reporting ---------- */
const m2 = (v) => `${Math.round(v).toLocaleString('en-IN')} m²`;
function report(st) {
  if (!st) {
    say('No walls found. Raise “Line sensitivity”, lower “Ignore small details”, or try “As two lines”.', true);
    return;
  }
  drawDetection();
  $('kSize').textContent = `${st.width.toFixed(1)} × ${st.depth.toFixed(1)} m`;
  $('kBuilt').textContent = m2(st.builtUp);
  $('kCarpet').textContent = m2(st.carpet);
  $('kRooms').textContent = st.rooms;
  $('kDoors').textContent = st.doors;
  $('kWindows').textContent = st.windows;
  if (st.coverage > 0.5) say('Most of the image reads as wall — lower “Line sensitivity”, or use a cleaner line drawing.', true);
  else if (st.walls > 900) say('This looks like a photo or a very busy drawing. A clean line plan gives a much better model.', true);
  else if (!st.rooms) say('Walls found, but no closed rooms — check the building width, or raise “Widest opening”.', true);
  else say(`${fileName} · ${st.rooms} rooms · ${st.doors} doors · ${st.windows} windows`);
}

/* ---------- 2D detection preview ---------- */
const COLORS = { wall: [110, 53, 17, 230], door: [224, 154, 58, 255], window: [47, 128, 145, 255], opening: [106, 121, 93, 255] };
function drawDetection() {
  const A = viewer.analysis, src = viewer.source;
  if (!A) return;
  const c = $('detectCanvas');
  const w = 640, h = Math.round((w * A.gh) / A.gw);
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  g.globalAlpha = 0.45; g.drawImage(src, 0, 0, w, h); g.globalAlpha = 1;
  const ov = new ImageData(A.gw, A.gh);
  const types = A.openings.map((op) => viewer.typeOf ? viewer.typeOf(op) : op.type);
  for (let i = 0; i < A.gw * A.gh; i++) {
    let col = null;
    if (A.wall[i]) col = COLORS.wall;
    else if (A.openIdx[i]) col = COLORS[types[A.openIdx[i] - 1]] || COLORS.wall;
    else if (A.roomOf[i]) col = A.roomOf[i] % 2 ? [106, 121, 93, 46] : [106, 121, 93, 80];
    if (col) ov.data.set(col, i * 4);
  }
  const tmp = document.createElement('canvas');
  tmp.width = A.gw; tmp.height = A.gh;
  tmp.getContext('2d').putImageData(ov, 0, 0);
  g.imageSmoothingEnabled = false;
  g.drawImage(tmp, 0, 0, w, h);
  $('detectFig').hidden = false;
  $('kpis').hidden = false;
}

/* ---------- loading ---------- */
async function show(source, name) {
  if (busy) return;
  busy = true;
  try {
    if (!webglOk()) throw new Error('nogl');
    mod = mod || await import('./plan3d.js');
    if (source === 'sample') { source = mod.samplePlan(); cfg.width = 12; $('rWidth').value = 12; }
    viewer = viewer || mod.createPlanViewer($('canvas'), {
      labelsEl: $('pins'),
      onPick: (type, st) => { report(st); say(`Opening changed to: ${type === 'opening' ? 'open passage' : type}`); }
    });
    fileName = name;
    refreshUi();
    const st = viewer.load(source, cfg);
    document.querySelectorAll('.panel fieldset').forEach((f) => { f.disabled = false; });
    $('rSun').disabled = false;
    $('viewer').classList.add('is-live');
    $('vtools').hidden = false;
    $('hint').hidden = false;
    refreshUi();
    report(st);
  } catch (err) {
    console.error(err);
    say(err.message === 'nogl'
      ? 'This browser cannot display 3D graphics (WebGL is unavailable).'
      : 'Sorry — a 3D model could not be made from that file.', true);
  } finally { busy = false; }
}

async function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    say('Please choose an image (PNG, JPG, WebP or SVG). Export PDFs and CAD drawings as an image first.', true);
    return;
  }
  if (file.size > MAX_BYTES) { say('That image is larger than 20 MB — please export a smaller one.', true); return; }
  say('Reading plan…');
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    img.src = url;
    await img.decode();
    if (!img.naturalWidth) throw new Error('empty');
    await show(img, file.name.length > 30 ? `${file.name.slice(0, 27)}…` : file.name);
  } catch {
    say('That image could not be read. Try exporting it again as PNG or JPG.', true);
  } finally { URL.revokeObjectURL(url); }
}

$('pFile').addEventListener('change', (e) => { handleFile(e.target.files[0]); e.target.value = ''; });
$('pSample').addEventListener('click', () => show('sample', 'Sample plan'));

const stage = $('stage');
['dragenter', 'dragover'].forEach((t) => stage.addEventListener(t, (e) => { e.preventDefault(); stage.classList.add('is-over'); }));
['dragleave', 'drop'].forEach((t) => stage.addEventListener(t, (e) => {
  e.preventDefault();
  if (t === 'drop' || !stage.contains(e.relatedTarget)) stage.classList.remove('is-over');
}));
stage.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

/* ---------- export ---------- */
const download = (blob, name) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
const base = () => (fileName || 'plan').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w-]+/g, '-').toLowerCase();
$('dlPng').addEventListener('click', async () => viewer && download(await viewer.snapshot(), `${base()}-${cfg.mode}.png`));
$('dlGlb').addEventListener('click', async () => {
  if (!viewer) return;
  const btn = $('dlGlb');
  btn.disabled = true; say('Preparing 3D model…');
  try { download(await viewer.exportGLB(), `${base()}-${cfg.mode}.glb`); say('3D model downloaded.'); }
  catch (err) { console.error(err); say('The 3D model could not be exported.', true); }
  finally { btn.disabled = false; }
});

refreshUi();
