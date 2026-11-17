import { PROJECTS, CONTACT } from './projects.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

$('year').textContent = new Date().getFullYear();

/* ---------- navigation ---------- */
const nav = $('nav'), navToggle = $('navToggle');
navToggle.addEventListener('click', () => {
  const open = nav.classList.toggle('is-open');
  navToggle.setAttribute('aria-expanded', String(open));
});
nav.addEventListener('click', (e) => {
  if (e.target.closest('a')) {
    nav.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
  }
});

const navLinks = [...nav.querySelectorAll('a[href^="#"]')];
const spy = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (!en.isIntersecting) return;
    navLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${en.target.id}`));
  });
}, { rootMargin: '-45% 0px -50% 0px' });
document.querySelectorAll('main section[id]').forEach((s) => spy.observe(s));

/* ---------- featured projects + lightbox ---------- */
const featured = PROJECTS.filter((p) => p.images && p.images.length);
const lightbox = $('lightbox');
let lb = { project: null, idx: 0 };

function showPhoto(card, p, idx) {
  idx = (idx + p.images.length) % p.images.length;
  card.dataset.idx = idx;
  const main = card.querySelector('.feat-main img');
  main.src = p.images[idx];
  main.alt = `${p.name} — ${p.captions[idx]}`;
  card.querySelector('.feat-cap').textContent = p.captions[idx];
  card.querySelector('.feat-count').textContent = `${idx + 1} / ${p.images.length}`;
  card.querySelectorAll('.thumbs button').forEach((b, i) => b.setAttribute('aria-current', String(i === idx)));
}

function openLightbox(p, idx) {
  lb = { project: p, idx };
  updateLightbox();
  if (!lightbox.open) lightbox.showModal();
}
function updateLightbox() {
  const { project: p, idx } = lb;
  $('lbImg').src = p.images[idx];
  $('lbImg').alt = `${p.name} — ${p.captions[idx]}`;
  $('lbCap').textContent = `${p.name} · ${p.captions[idx]}`;
}
function stepLightbox(d) {
  const n = lb.project.images.length;
  lb.idx = (lb.idx + d + n) % n;
  updateLightbox();
}
$('lbPrev').addEventListener('click', () => stepLightbox(-1));
$('lbNext').addEventListener('click', () => stepLightbox(1));
$('lbClose').addEventListener('click', () => lightbox.close());
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.close(); });
lightbox.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') stepLightbox(-1);
  if (e.key === 'ArrowRight') stepLightbox(1);
});

featured.forEach((p, n) => {
  const card = document.createElement('article');
  card.className = `feat reveal${n % 2 ? ' flip' : ''}`;
  card.innerHTML = `
    <div class="feat-media">
      <button type="button" class="feat-main" aria-label="Enlarge photograph of ${esc(p.name)}">
        <img src="${esc(p.images[0])}" alt="" loading="lazy">
        <span class="feat-count mono"></span>
      </button>
      <div class="thumbs">
        ${p.images.map((src, i) => `<button type="button" data-i="${i}" aria-label="Photograph ${i + 1} of ${esc(p.name)}"><img src="${esc(src)}" alt="" loading="lazy"></button>`).join('')}
      </div>
    </div>
    <div class="feat-body">
      <span class="micro">${esc(p.job)} · ${esc(p.category)}</span>
      <h3>${esc(p.name)}</h3>
      <p class="desc">${esc(p.text)}</p>
      <p class="feat-cap mono"></p>
      <dl class="meta">
        <div><dt>Location</dt><dd>${esc(p.location)}</dd></div>
        <div><dt>Year</dt><dd>${esc(p.year)}</dd></div>
        <div><dt>Area</dt><dd>${esc(p.area)}</dd></div>
        <div><dt>Status</dt><dd>${esc(p.status)}</dd></div>
      </dl>
    </div>`;
  card.querySelector('.thumbs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) showPhoto(card, p, Number(b.dataset.i));
  });
  card.querySelector('.feat-main').addEventListener('click', () => openLightbox(p, Number(card.dataset.idx)));
  $('featured').appendChild(card);
  showPhoto(card, p, 0);
});

/* ---------- project register ---------- */
const CATS = ['All', ...new Set(PROJECTS.map((p) => p.category))];
let activeCat = 'All';

function renderRegister() {
  $('filters').innerHTML = CATS.map((c) => {
    const n = c === 'All' ? PROJECTS.length : PROJECTS.filter((p) => p.category === c).length;
    return `<button type="button" data-cat="${esc(c)}" aria-pressed="${c === activeCat}">${esc(c)} <span>${n}</span></button>`;
  }).join('');
  $('registerList').innerHTML = PROJECTS
    .filter((p) => activeCat === 'All' || p.category === activeCat)
    .map((p) => `
      <details class="row">
        <summary>
          <span class="row-job mono">${esc(p.job)}</span>
          <span class="row-name">${esc(p.name)}</span>
          <span class="row-loc">${esc(p.location)}</span>
          <span class="row-cat">${esc(p.category)}</span>
          <span class="row-yr mono">${esc(p.year)}</span>
        </summary>
        <div class="row-body">
          <p class="desc">${esc(p.text)}</p>
          <span class="mono">${esc(p.area)} · ${esc(p.status)}</span>
        </div>
      </details>`).join('');
}
$('filters').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  activeCat = b.dataset.cat;
  renderRegister();
});
renderRegister();

/* ---------- scroll reveal ---------- */
const revealObs = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (en.isIntersecting) { en.target.classList.add('is-in'); revealObs.unobserve(en.target); }
  });
}, { rootMargin: '0px 0px -8% 0px' });
document.querySelectorAll('.reveal').forEach((el) => revealObs.observe(el));

/* ---------- contact form → WhatsApp / email ---------- */
const form = $('briefForm');
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const status = $('formStatus');
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  const d = Object.fromEntries(new FormData(form));
  const body = [
    'Project brief for .PLN architects',
    `Name: ${d.name}`,
    `Mobile: ${d.phone}`,
    `Project type: ${d.category}`,
    d.location ? `Site location: ${d.location}` : '',
    '',
    d.message
  ].filter((l, i) => l !== '' || i === 5).join('\n');
  const via = e.submitter && e.submitter.dataset.via === 'email' ? 'email' : 'whatsapp';
  const url = via === 'email'
    ? `mailto:${CONTACT.email}?subject=${encodeURIComponent(`Project brief — ${d.category}`)}&body=${encodeURIComponent(body)}`
    : `https://wa.me/${CONTACT.phone.replace(/\D/g, '')}?text=${encodeURIComponent(body)}`;
  window.open(url, via === 'email' ? '_self' : '_blank', 'noopener');
  status.textContent = via === 'email'
    ? 'Your email app should open with the brief ready to send.'
    : 'WhatsApp should open with the brief ready to send.';
});

/* ---------- 3D studies ---------- */
const SCALES = {
  site: {
    label: '1:500',
    text: 'At 1:500 we decide where the building sits on the plot. Sun path, prevailing breeze, existing trees and the arrival sequence shape the footprint before any room is drawn.'
  },
  section: {
    label: '1:100',
    text: 'At 1:100 we set floor heights, courtyard proportions and roof overhangs. The deep overhang blocks high summer glare while inviting low winter sunlight deep into the living court.'
  },
  detail: {
    label: '1:5',
    text: 'At 1:5 we resolve how the wall is built, brick by brick. A perforated jaali turns to admit breeze and break glare, so the craftsperson has nothing left to guess.'
  }
};
const setScaleText = (key) => {
  $('scaleLabel').textContent = SCALES[key].label;
  $('scaleCaption').textContent = SCALES[key].text;
  document.querySelectorAll('#scaleSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scale === key)));
};
setScaleText('site');

const fmtTime = (t) => {
  const mins = Math.round(360 + t * 720);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
};

function webglOk() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

async function init3D() {
  const figs = [$('heroStudy'), $('scaleStudy')];
  if (!webglOk()) { figs.forEach((f) => f.classList.add('no-webgl')); return; }
  try {
    const { createStudy } = await import('./scene.js');

    // hero: plan → building → sun study
    const phases = [...$('phases').children];
    const range = $('sunRange');
    const hero = createStudy($('heroCanvas'), {
      kind: 'hero',
      onPhase: (i) => phases.forEach((li, n) => {
        li.classList.toggle('is-done', n < i);
        li.classList.toggle('is-now', n === i);
      }),
      onSun: (t) => { range.value = Math.round(t * 1000); $('sunTime').textContent = fmtTime(t); }
    });
    range.addEventListener('input', () => {
      const t = range.value / 1000;
      hero.setSun(t);
      $('sunTime').textContent = fmtTime(t);
    });
    $('replayBtn').addEventListener('click', () => hero.replay());
    $('heroStudy').classList.add('is-live');

    // method: one model at three scales (created lazily when first scrolled near)
    let viewer = null;
    const mountViewer = () => {
      if (viewer) return viewer;
      viewer = createStudy($('scaleCanvas'), { kind: 'viewer', labelsEl: $('scalePins') });
      $('scaleStudy').classList.add('is-live');
      return viewer;
    };
    const lazy = new IntersectionObserver((es) => {
      if (es[0].isIntersecting) { mountViewer(); lazy.disconnect(); }
    }, { rootMargin: '600px' });
    lazy.observe($('scaleStudy'));
    $('scaleSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      setScaleText(b.dataset.scale);
      mountViewer().setMode(b.dataset.scale);
    });
  } catch (err) {
    console.error('3D study unavailable:', err);
    figs.forEach((f) => { if (!f.classList.contains('is-live')) f.classList.add('no-webgl'); });
  }
}
init3D();

// Without WebGL the scale buttons still update the caption
$('scaleSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && $('scaleStudy').classList.contains('no-webgl')) setScaleText(b.dataset.scale);
});

/* ---------- plan → 3D visualiser ---------- */
(() => {
  const study = $('p3Study'), stage = $('p3Stage'), status = $('p3Status');
  const tune = $('p3Tune'), fileInput = $('p3File');
  const MAX_BYTES = 20 * 1024 * 1024;
  let viewer = null, busy = false;

  const say = (msg, error = false) => {
    status.textContent = msg;
    status.classList.toggle('is-error', error);
  };
  const opts = () => ({
    height: Number($('p3Height').value),
    width: Number($('p3Width').value),
    sensitivity: $('p3Sens').value / 100,
    cleanup: $('p3Clean').value / 100
  });
  const outputs = () => {
    $('p3HeightOut').textContent = `${Number($('p3Height').value).toFixed(1)} m`;
    $('p3WidthOut').textContent = `${$('p3Width').value} m`;
    $('p3SensOut').textContent = `${$('p3Sens').value}%`;
    $('p3CleanOut').textContent = `${$('p3Clean').value}%`;
  };
  const report = (r, name) => {
    if (!r) return;
    if (!r.segments) {
      say('No walls found — raise “Line sensitivity” or lower “Ignore small details”.', true);
    } else if (r.coverage > 0.6) {
      say('Most of the image reads as wall — lower “Line sensitivity”, or use a cleaner line drawing.', true);
    } else if (r.segments > 700) {
      say('This looks like a photo or a very busy drawing — the preview works best with a clean line plan. Try raising “Ignore small details”.', true);
    } else {
      const o = opts();
      say(`${name ? `${name} · ` : ''}${o.width} × ${r.depth.toFixed(1)} m · walls ${o.height.toFixed(1)} m · ${r.segments} wall segments`);
    }
  };

  let currentName = '';
  async function show(source, name) {
    if (busy) return;
    busy = true;
    try {
      if (!webglOk()) throw new Error('nogl');
      const mod = await import('./plan3d.js');
      if (source === 'sample') source = mod.samplePlan();
      viewer = viewer || mod.createPlanViewer($('p3Canvas'));
      currentName = name;
      const r = viewer.load(source, opts());
      viewer.lastResult = r;
      study.classList.add('is-live');
      $('p3Tools').hidden = false;
      tune.disabled = false;
      report(r, name);
    } catch (err) {
      console.error(err);
      say(err.message === 'nogl'
        ? 'This browser cannot display 3D graphics (WebGL is unavailable).'
        : 'Sorry — the 3D preview could not be created from that file.', true);
    } finally { busy = false; }
  }

  async function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      say('Please choose an image file (PNG, JPG, WebP or SVG). For a PDF or CAD drawing, export it as an image first.', true);
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
      await show(img, file.name.length > 28 ? `${file.name.slice(0, 25)}…` : file.name);
    } catch {
      say('That image could not be read. Try exporting it again as PNG or JPG.', true);
    } finally { URL.revokeObjectURL(url); }
  }

  fileInput.addEventListener('change', () => { handleFile(fileInput.files[0]); fileInput.value = ''; });
  $('p3Sample').addEventListener('click', () => show('sample', 'Sample plan'));

  ['dragenter', 'dragover'].forEach((t) => stage.addEventListener(t, (e) => {
    e.preventDefault(); stage.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach((t) => stage.addEventListener(t, (e) => {
    e.preventDefault();
    if (t === 'drop' || !stage.contains(e.relatedTarget)) stage.classList.remove('is-over');
  }));
  stage.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

  let raf = 0;
  tune.addEventListener('input', (e) => {
    outputs();
    if (!viewer) return;
    if (e.target.id === 'p3Height') { viewer.setHeight(opts().height); report(viewer.lastResult, currentName); return; }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { viewer.lastResult = viewer.update(opts()); report(viewer.lastResult, currentName); });
  });
  $('p3Tools').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !viewer) return;
    const act = b.dataset.act;
    if (act === 'top' || act === 'persp') viewer.view(act);
    else if (act === 'in') viewer.zoom(0.8);
    else if (act === 'out') viewer.zoom(1.25);
    else viewer.replay();
  });
  outputs();
})();
