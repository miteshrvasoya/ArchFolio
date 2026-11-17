/* Plan → 3D page: settings dock, file handling, detection preview, rooms, export. */
import { ROOM_TYPES } from './plan/furnish.js';

const $ = (id) => document.getElementById(id);
const status = $('status');
const MAX_BYTES = 20 * 1024 * 1024;
const phone = () => window.matchMedia('(max-width: 760px)').matches;

const MODE_HELP = {
  massing: 'Walls only, full height — a quick read of volume and enclosure.',
  cut: 'The plan sliced at 1.2 m, as architects draw it: walls in poché, sills, door swings and furniture.',
  full: 'The complete model: doors, windows, sunshades, furniture, storeys, roof and site.'
};

const cfg = {
  // detection
  width: 12, wallStyle: 'solid', sensitivity: 0.5, cleanup: 0.4, maxOpening: 2, exterior: 'auto',
  // model
  mode: 'full', finish: 'plaster', storeys: 1, wallHeight: 3,
  // elements
  doors: true, windows: true, shades: true, floors: true, roof: false, parapet: true,
  furniture: true, rugs: true, plants: true, lights: true,
  landscape: true, compound: false, people: true, underlay: false,
  labels: true, dimensions: false,
  // view
  lighting: 'day', render: 'realistic', background: 'studio', shadows: true,
  section: false, sectionHeight: 1.2, explode: 0, xray: 1, autoRotate: false
};
const REANALYSE = new Set(['width', 'wallStyle', 'sensitivity', 'cleanup', 'maxOpening', 'exterior']);
const LIVE = new Set(['section', 'sectionHeight', 'explode', 'xray', 'autoRotate', 'shadows']);

let viewer = null, busy = false, fileName = '';

const say = (msg, error = false) => { status.textContent = msg; status.classList.toggle('is-error', error); };
const webglOk = () => {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
  catch { return false; }
};

/* ---------- apply a setting change ---------- */
let raf = 0, pending = 'live';
const rank = { live: 0, configure: 1, reanalyse: 2 };
function change(key, value) {
  cfg[key] = value;
  refreshUi();
  if (!viewer) return;
  const kind = REANALYSE.has(key) ? 'reanalyse' : LIVE.has(key) ? 'live' : 'configure';
  if (rank[kind] > rank[pending]) pending = kind;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const k = pending; pending = 'live';
    if (k === 'reanalyse') { report(viewer.reanalyse(cfg)); renderRooms(); }
    else if (k === 'configure') report(viewer.configure(cfg));
    else viewer.live(cfg);
  });
}

/* ---------- controls ---------- */
function radioGroup(id, key, cast = String) {
  const group = $(id);
  group.addEventListener('click', (e) => {
    const b = e.target.closest('[role="radio"]');
    if (!b || group.closest('fieldset')?.disabled) return;
    group.querySelectorAll('[role="radio"]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    change(key, cast(b.dataset.v));
  });
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
radioGroup('wallStyleSeg', 'wallStyle');
radioGroup('exteriorSeg', 'exterior');
radioGroup('modeSeg', 'mode');
radioGroup('finishSeg', 'finish');
radioGroup('storeySeg', 'storeys', Number);
radioGroup('lightingSeg', 'lighting');
radioGroup('renderSeg', 'render');
radioGroup('bgSeg', 'background');

const range = (id, key, scale = 1) => $(id).addEventListener('input', (e) => change(key, Number(e.target.value) * scale));
range('rWidth', 'width');
range('rSens', 'sensitivity', 0.01);
range('rClean', 'cleanup', 0.01);
range('rOpen', 'maxOpening');
range('rHeight', 'wallHeight');
range('rSection', 'sectionHeight');
range('rExplode', 'explode');
range('rXray', 'xray', 0.01);

document.querySelectorAll('#panel-elems input[data-k]').forEach((el) => el.addEventListener('change', () => change(el.dataset.k, el.checked)));
$('cSection').addEventListener('change', (e) => change('section', e.target.checked));
$('cShadows').addEventListener('change', (e) => change('shadows', e.target.checked));
$('cRotate').addEventListener('change', (e) => change('autoRotate', e.target.checked));
$('rSun').addEventListener('input', (e) => viewer && viewer.setSun(e.target.value / 1000));
$('resetOpenings').addEventListener('click', () => viewer && report(viewer.resetOpenings()));

function refreshUi() {
  const full = cfg.mode === 'full', massing = cfg.mode === 'massing';
  $('modeHelp').textContent = MODE_HELP[cfg.mode];
  $('storeyField').hidden = !full;
  $('explodeField').hidden = !full || cfg.storeys < 2;
  $('sunField').hidden = cfg.lighting !== 'day';
  document.querySelectorAll('#panel-elems input[data-k]').forEach((el) => {
    const k = el.dataset.k;
    el.disabled = massing && !['labels', 'dimensions', 'underlay'].includes(k)
      || ((k === 'roof' || k === 'parapet') && !full) || (k === 'parapet' && !cfg.roof)
      || (['rugs'].includes(k) && !cfg.furniture);
  });
  const maxCut = (full ? cfg.storeys : 1) * (cfg.wallHeight + 0.15);
  const rs = $('rSection');
  rs.max = maxCut.toFixed(2);
  rs.disabled = !cfg.section || cfg.mode === 'cut';
  $('cSection').disabled = cfg.mode === 'cut';
  if (cfg.sectionHeight > maxCut) { cfg.sectionHeight = maxCut; rs.value = maxCut; }
  $('oWidth').textContent = `${cfg.width} m`;
  $('oHeight').textContent = `${cfg.wallHeight.toFixed(1)} m`;
  $('oSens').textContent = `${Math.round(cfg.sensitivity * 100)}%`;
  $('oClean').textContent = `${Math.round(cfg.cleanup * 100)}%`;
  $('oOpen').textContent = `${cfg.maxOpening.toFixed(1)} m`;
  $('oSection').textContent = `${Number(cfg.sectionHeight).toFixed(2)} m`;
  $('oExplode').textContent = `${cfg.explode.toFixed(1)} m`;
  $('oXray').textContent = `${Math.round(cfg.xray * 100)}%`;
}

/* ---------- tabs ---------- */
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(t) {
  tabs.forEach((x) => {
    const on = x === t;
    x.setAttribute('aria-selected', String(on));
    x.tabIndex = on ? 0 : -1;
    $(x.getAttribute('aria-controls')).hidden = !on;
  });
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const n = tabs[(i + (e.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length];
    n.focus(); selectTab(n);
  });
});

/* ---------- dock ---------- */
const dock = $('dock'), dockToggle = $('dockToggle');
const setDock = (open) => {
  dock.classList.toggle('is-closed', !open);
  dockToggle.setAttribute('aria-expanded', String(open));
  dockToggle.querySelector('span').textContent = open ? 'Hide' : 'Settings';
};
dockToggle.addEventListener('click', () => setDock(dock.classList.contains('is-closed')));
setDock(!phone());

/* ---------- toolbar ---------- */
const download = (blob, name) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
const base = () => (fileName || 'plan').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w-]+/g, '-').toLowerCase();
$('vtools').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b || !viewer) return;
  if (b.dataset.view) { viewer.view(b.dataset.view); return; }
  if (b.dataset.act === 'png') download(await viewer.snapshot(), `${base()}-${cfg.mode}.png`);
  if (b.dataset.act === 'glb') {
    b.disabled = true; say('Preparing 3D model…');
    try { download(await viewer.exportGLB(), `${base()}-${cfg.mode}.glb`); say('3D model downloaded (.glb).'); }
    catch (err) { console.error(err); say('The 3D model could not be exported.', true); }
    finally { b.disabled = false; }
  }
  if (b.dataset.act === 'fullscreen') {
    const el = $('tool');
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  }
});

/* ---------- reporting ---------- */
const m2 = (v) => `${Math.round(v).toLocaleString('en-IN')} m²`;
function report(st) {
  if (!st) { say('No walls found. Raise “Line sensitivity”, lower “Ignore small details”, or try “As two lines”.', true); return; }
  drawDetection();
  $('kpis').hidden = false;
  $('kSize').textContent = `${st.width.toFixed(1)} × ${st.depth.toFixed(1)} m`;
  $('kBuilt').textContent = m2(st.builtUp);
  $('kCarpet').textContent = m2(st.carpet);
  $('kRooms').textContent = st.rooms;
  $('kDoors').textContent = st.doors;
  $('kWindows').textContent = st.windows;
  if (st.coverage > 0.5) say('Most of the image reads as wall — lower “Line sensitivity”, or use a cleaner line drawing.', true);
  else if (st.walls > 2500) say('This looks like a photo or a very busy drawing. A clean line plan gives a much better model.', true);
  else if (!st.rooms) say('Walls found but no closed rooms — check the building width, or raise “Widest opening”.', true);
  else say(fileName);
}

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
  const types = A.openings.map((op) => viewer.typeOf(op));
  for (let i = 0; i < A.gw * A.gh; i++) {
    let col = null;
    if (A.wall[i]) col = COLORS.wall;
    else if (A.openIdx[i]) col = COLORS[types[A.openIdx[i] - 1]] || COLORS.wall;
    else if (A.roomOf[i]) col = A.roomOf[i] % 2 ? [106, 121, 93, 46] : [106, 121, 93, 82];
    if (col) ov.data.set(col, i * 4);
  }
  const tmp = document.createElement('canvas');
  tmp.width = A.gw; tmp.height = A.gh;
  tmp.getContext('2d').putImageData(ov, 0, 0);
  g.imageSmoothingEnabled = false;
  g.drawImage(tmp, 0, 0, w, h);
  $('detectFig').hidden = false;
}

function renderRooms() {
  const list = $('roomList');
  list.innerHTML = '';
  if (!viewer || !viewer.analysis) return;
  const types = viewer.roomTypes;
  viewer.analysis.rooms.forEach((r, i) => {
    const li = document.createElement('li');
    const opts = Object.entries(ROOM_TYPES).map(([k, v]) => `<option value="${k}"${k === types[i] ? ' selected' : ''}>${v}</option>`).join('');
    li.innerHTML = `<b>${i + 1}</b><select aria-label="Room ${i + 1} type">${opts}</select><em>${r.area.toFixed(1)} m²</em>`;
    li.querySelector('select').addEventListener('change', (e) => report(viewer.setRoomType(i, e.target.value)));
    list.appendChild(li);
  });
}

/* ---------- loading ---------- */
async function show(source, name) {
  if (busy) return;
  busy = true;
  try {
    if (!webglOk()) throw new Error('nogl');
    say('Reading plan…');
    const [{ createPlanViewer }, sample] = await Promise.all([import('./plan/viewer.js'), source === 'sample' ? import('./plan/sample.js') : null]);
    if (source === 'sample') { source = sample.samplePlan(); cfg.width = 12; $('rWidth').value = 12; }
    viewer = viewer || createPlanViewer($('canvas'), {
      labelsEl: $('pins'),
      onPick: (type, st) => { report(st); say(`Opening changed to: ${type === 'opening' ? 'open passage' : type}`); }
    });
    fileName = name;
    refreshUi();
    const st = viewer.load(source, cfg);
    document.querySelectorAll('.dock fieldset').forEach((f) => { f.disabled = false; });
    $('rSun').disabled = false;
    document.body.classList.add('is-live');
    $('vtools').hidden = false;
    refreshUi();
    report(st);
    renderRooms();
  } catch (err) {
    console.error(err);
    say(err.message === 'nogl' ? 'This browser cannot display 3D graphics (WebGL is unavailable).' : 'Sorry — a 3D model could not be made from that file.', true);
  } finally { busy = false; }
}

async function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { say('Please choose an image (PNG, JPG, WebP or SVG). Export PDFs and CAD drawings as an image first.', true); return; }
  if (file.size > MAX_BYTES) { say('That image is larger than 20 MB — please export a smaller one.', true); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    img.src = url;
    await img.decode();
    if (!img.naturalWidth) throw new Error('empty');
    await show(img, file.name.length > 34 ? `${file.name.slice(0, 31)}…` : file.name);
  } catch { say('That image could not be read. Try exporting it again as PNG or JPG.', true); }
  finally { URL.revokeObjectURL(url); }
}

$('pFile').addEventListener('change', (e) => { handleFile(e.target.files[0]); e.target.value = ''; });
$('pSample').addEventListener('click', () => show('sample', 'Sample plan'));
$('pSample2').addEventListener('click', () => show('sample', 'Sample plan'));

const main = $('tool');
['dragenter', 'dragover'].forEach((t) => main.addEventListener(t, (e) => { e.preventDefault(); main.classList.add('is-over'); }));
['dragleave', 'drop'].forEach((t) => main.addEventListener(t, (e) => {
  e.preventDefault();
  if (t === 'drop' || !main.contains(e.relatedTarget)) main.classList.remove('is-over');
}));
main.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

refreshUi();
