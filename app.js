/* MyPDF Puzzle — upload PDF, conteng dengan jari / stylus, simpan dalam telefon. */
'use strict';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

/* =========================================================================
 * IndexedDB storage (fail PDF + conteng disimpan dalam peranti)
 * ======================================================================= */
const DB = (() => {
  let dbp;
  function open() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open('mypdf', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('docs', { keyPath: 'id' }); // metadata
          db.createObjectStore('files');                   // id -> ArrayBuffer
          db.createObjectStore('annots');                  // id -> { pages: { [num]: Stroke[] } }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }
  async function run(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaksi dibatalkan'));
    });
  }
  return {
    get: (store, key) => run(store, 'readonly', s => s.get(key)),
    put: (store, val, key) => run(store, 'readwrite', s => (key === undefined ? s.put(val) : s.put(val, key))),
    del: (store, key) => run(store, 'readwrite', s => s.delete(key)),
    all: store => run(store, 'readonly', s => s.getAll()),
  };
})();

/* =========================================================================
 * Helpers
 * ======================================================================= */
const $ = sel => document.querySelector(sel);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const r4 = v => Math.round(v * 10000) / 10000;

function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
function fmtDate(t) {
  try { return new Date(t).toLocaleDateString('ms-MY', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return new Date(t).toDateString(); }
}
let toastTimer;
function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
function busy(on, text) {
  $('#busy').classList.toggle('hidden', !on);
  if (text) $('#busyText').textContent = text;
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Gagal muat ' + src));
    document.head.appendChild(s);
  });
}
const prefs = {
  load() { try { return JSON.parse(localStorage.getItem('mypdf.prefs') || '{}'); } catch { return {}; } },
  save(p) { try { localStorage.setItem('mypdf.prefs', JSON.stringify(p)); } catch { /* ignore */ } },
};

/* =========================================================================
 * State
 * ======================================================================= */
const PALETTES = {
  pen: ['#111827', '#dc2626', '#2563eb', '#16a34a', '#9333ea', '#ea580c'],
  hl:  ['#facc15', '#4ade80', '#f472b6', '#60a5fa', '#fb923c', '#c084fc'],
};
const saved = prefs.load();
const state = {
  tool: saved.tool || 'pen',
  colors: Object.assign({ pen: PALETTES.pen[0], hl: PALETTES.hl[0] }, saved.colors),
  sizes: Object.assign({ pen: 3, hl: 5, eraser: 5 }, saved.sizes),
  stylusOnly: !!saved.stylusOnly,
  penSeen: !!saved.penSeen,
  zoom: 1,
};
function savePrefs() {
  prefs.save({ tool: state.tool, colors: state.colors, sizes: state.sizes, stylusOnly: state.stylusOnly, penSeen: state.penSeen });
}
// pen & highlighter berkongsi tetapan ikut "keluarga"
const family = tool => (tool === 'pen' ? 'pen' : tool === 'eraser' ? 'eraser' : 'hl');

// Lebar garisan disimpan relatif kepada lebar halaman (tak berubah bila zoom)
const widthNorm = (tool, size) => (tool === 'pen' ? size * 0.0018 : size * 0.006);
const eraserRadiusPx = size => 4 + size * 3;

let doc = null; // dokumen yang sedang dibuka

/* =========================================================================
 * Library
 * ======================================================================= */
const ICON_TRASH = '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';

async function renderLibrary() {
  const docs = (await DB.all('docs')).sort((a, b) => (b.opened || 0) - (a.opened || 0));
  const list = $('#docList');
  list.innerHTML = '';
  $('#empty').classList.toggle('hidden', docs.length > 0);
  for (const d of docs) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="thumb"></div>
      ${d.inked ? '<span class="badge">✏️ ada conteng</span>' : ''}
      <button class="del" type="button" title="Buang" aria-label="Buang">${ICON_TRASH}</button>
      <div class="meta"><div class="name"></div><div class="sub"></div></div>`;
    if (d.thumb) card.querySelector('.thumb').style.backgroundImage = `url("${d.thumb}")`;
    card.querySelector('.name').textContent = d.name;
    card.querySelector('.sub').textContent = `${d.pages} hlm · ${fmtSize(d.size)} · ${fmtDate(d.opened || d.added)}`;
    card.addEventListener('click', () => openDoc(d.id));
    card.querySelector('.del').addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`Buang "${d.name}" dan semua conteng dari telefon?`)) return;
      await Promise.all([DB.del('docs', d.id), DB.del('files', d.id), DB.del('annots', d.id)]);
      renderLibrary();
      toast('Dibuang');
    });
    list.appendChild(card);
  }
  updateStorageInfo();
}

async function updateStorageInfo() {
  const el = $('#storageInfo');
  if (!navigator.storage || !navigator.storage.estimate) { el.textContent = ''; return; }
  try {
    const { usage, quota } = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    el.textContent = `Storan telefon digunakan: ${fmtSize(usage || 0)} / ${fmtSize(quota || 0)}` +
      (persisted ? ' · 🔒 storan kekal' : '');
  } catch { el.textContent = ''; }
}

async function makeThumb(pdf, annots) {
  const page = await pdf.getPage(1);
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: 300 / vp1.width });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const strokes = annots && annots.pages && annots.pages[1];
  if (strokes && strokes.length) {
    ctx.globalCompositeOperation = 'multiply';
    for (const s of strokes) drawStroke(ctx, s, c.width, c.height);
  }
  return c.toDataURL('image/jpeg', 0.75);
}

async function addFiles(files) {
  const pdfs = [...files].filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!pdfs.length) { toast('Sila pilih fail PDF'); return; }
  let lastId = null;
  busy(true, 'Menyimpan PDF dalam telefon…');
  try {
    for (const f of pdfs) {
      const buf = await f.arrayBuffer();
      let pdf;
      try {
        pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
      } catch (err) {
        console.error(err);
        toast(`"${f.name}" tak dapat dibuka (rosak atau berkata laluan)`, 3500);
        continue;
      }
      const id = uid();
      let thumb = '';
      try { thumb = await makeThumb(pdf); } catch (e) { console.warn(e); }
      const meta = { id, name: f.name, size: f.size, pages: pdf.numPages, added: Date.now(), opened: Date.now(), thumb, lastPage: 1 };
      await DB.put('files', buf, id);
      await DB.put('docs', meta);
      pdf.destroy();
      lastId = id;
    }
  } catch (err) {
    console.error(err);
    toast(err && err.name === 'QuotaExceededError' ? 'Storan telefon penuh!' : 'Gagal simpan: ' + err.message, 4000);
  } finally {
    busy(false);
  }
  requestPersist();
  await renderLibrary();
  if (lastId && pdfs.length === 1) openDoc(lastId);
}

async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
      updateStorageInfo();
    }
  } catch { /* ignore */ }
}

/* =========================================================================
 * Viewer: buka, susun & render halaman
 * ======================================================================= */
const pagesEl = $('#pages');
const stackEl = $('#stack');

async function openDoc(id) {
  if (doc) await closeDoc(true);
  busy(true, 'Membuka…');
  try {
    const [meta, buf, annots] = await Promise.all([DB.get('docs', id), DB.get('files', id), DB.get('annots', id)]);
    if (!meta || !buf) throw new Error('Fail tiada');
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    doc = { id, meta, pdf, pages: [], annots: annots || { pages: {} }, undo: [], redo: [], dirty: false };

    stackEl.innerHTML = '';
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const el = document.createElement('div');
      el.className = 'page';
      el.dataset.num = n;
      el.innerHTML = `<span class="pnum">${n}</span>`;
      const pdfCanvas = document.createElement('canvas');
      pdfCanvas.className = 'pdf';
      const ink = document.createElement('canvas');
      ink.className = 'ink';
      el.append(pdfCanvas, ink);
      stackEl.appendChild(el);
      doc.pages.push({ num: n, el, pdfCanvas, ink, baseW: vp.width, ratio: vp.height / vp.width, cssW: 0, cssH: 0, scale: 0, task: null });
    }

    $('#docTitle').textContent = meta.name;
    $('#library').classList.add('hidden');
    $('#viewer').classList.remove('hidden');
    if (!history.state || !history.state.viewer) history.pushState({ viewer: true }, '');

    state.zoom = clamp(meta.zoom || 1, 0.5, 5);
    layoutPages();
    const target = doc.pages[(meta.lastPage || 1) - 1];
    pagesEl.scrollTop = target ? target.el.offsetTop - 10 : 0;
    pagesEl.scrollLeft = 0;
    updateUndoButtons();
    scheduleRender();
    meta.opened = Date.now();
    DB.put('docs', meta);
  } catch (err) {
    console.error(err);
    toast('Tak dapat buka PDF: ' + err.message, 3500);
    doc = null;
  } finally {
    busy(false);
  }
}

async function closeDoc(silent) {
  if (!doc) return;
  const d = doc;
  doc = null;
  await flushSave(d);
  try {
    d.meta.lastPage = currentPageNum(d);
    d.meta.zoom = state.zoom;
    d.meta.inked = Object.values(d.annots.pages).some(a => a && a.length);
    d.meta.thumb = await makeThumb(d.pdf, d.annots);
  } catch (e) { console.warn(e); }
  await DB.put('docs', d.meta);
  d.pages.forEach(p => p.task && p.task.cancel());
  d.pdf.destroy();
  stackEl.innerHTML = '';
  $('#menu').classList.add('hidden');
  if (!silent) {
    $('#viewer').classList.add('hidden');
    $('#library').classList.remove('hidden');
    renderLibrary();
  }
}

function fitWidth() {
  return Math.max(200, Math.min(pagesEl.clientWidth - 16, 1000));
}

function layoutPages() {
  if (!doc) return;
  const fw = fitWidth();
  for (const p of doc.pages) {
    p.cssW = Math.round(fw * state.zoom);
    p.cssH = Math.round(p.cssW * p.ratio);
    p.el.style.width = p.cssW + 'px';
    p.el.style.height = p.cssH + 'px';
  }
  $('#zoomLabel').textContent = Math.round(state.zoom * 100) + '%';
}

/* Tukar zoom sambil kekalkan titik di bawah jari/tengah skrin */
function setZoom(z, anchorX, anchorY, fromZoom, fromScroll) {
  if (!doc) return;
  z = clamp(z, 0.5, 5);
  const rect = pagesEl.getBoundingClientRect();
  if (anchorX === undefined) { anchorX = rect.left + rect.width / 2; anchorY = rect.top + rect.height / 2; }
  const z0 = fromZoom || state.zoom;
  const s0 = fromScroll || { x: pagesEl.scrollLeft, y: pagesEl.scrollTop, ax: anchorX, ay: anchorY };
  const cx = s0.x + (s0.ax - rect.left);
  const cy = s0.y + (s0.ay - rect.top);
  state.zoom = z;
  layoutPages();
  const k = z / z0;
  pagesEl.scrollLeft = cx * k - (anchorX - rect.left);
  pagesEl.scrollTop = cy * k - (anchorY - rect.top);
  scheduleRender(200);
}

const MAX_CANVAS_PX = 12e6;
let renderTimer = null;
let rendering = false;

function scheduleRender(delay = 60) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderVisible, delay);
}

async function renderVisible() {
  if (!doc || rendering) { if (rendering) scheduleRender(120); return; }
  rendering = true;
  const d = doc;
  try {
    const rect = pagesEl.getBoundingClientRect();
    const near = [], far = [];
    for (const p of d.pages) {
      const r = p.el.getBoundingClientRect();
      const dist = r.bottom < rect.top ? rect.top - r.bottom : r.top > rect.bottom ? r.top - rect.bottom : 0;
      if (dist < rect.height * 1.0) near.push({ p, dist });
      else if (dist > rect.height * 3) far.push(p);
    }
    for (const p of far) releasePage(p);
    near.sort((a, b) => a.dist - b.dist);
    for (const { p } of near) {
      if (doc !== d) break;
      await renderPage(d, p);
    }
  } finally {
    rendering = false;
  }
}

function releasePage(p) {
  if (!p.scale) return;
  if (p.task) p.task.cancel();
  p.pdfCanvas.width = p.pdfCanvas.height = 0;
  p.ink.width = p.ink.height = 0;
  p.scale = 0;
}

async function renderPage(d, p) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  let pxW = p.cssW * dpr, pxH = p.cssH * dpr;
  if (pxW * pxH > MAX_CANVAS_PX) {
    const k = Math.sqrt(MAX_CANVAS_PX / (pxW * pxH));
    pxW *= k; pxH *= k;
  }
  const scale = pxW / p.baseW;
  if (p.scale && Math.abs(p.scale - scale) / scale < 0.02) return;
  if (p.task) p.task.cancel();
  const page = await d.pdf.getPage(p.num);
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.className = 'pdf';
  c.width = Math.floor(vp.width);
  c.height = Math.floor(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  const task = page.render({ canvasContext: ctx, viewport: vp });
  p.task = task;
  try { await task.promise; } catch { return; } // dibatalkan
  if (p.task === task) p.task = null;
  if (doc !== d) return;
  p.el.replaceChild(c, p.pdfCanvas);
  p.pdfCanvas = c;
  p.scale = scale;
  p.ink.width = c.width;
  p.ink.height = c.height;
  drawInk(p);
}

function currentPageNum(d = doc) {
  if (!d || !d.pages.length) return 1;
  const rect = pagesEl.getBoundingClientRect();
  const mid = rect.top + rect.height / 2;
  for (const p of d.pages) {
    const r = p.el.getBoundingClientRect();
    if (r.bottom >= mid) return p.num;
  }
  return d.pages.length;
}

let indTimer;
pagesEl.addEventListener('scroll', () => {
  if (!doc) return;
  scheduleRender(80);
  const ind = $('#pageIndicator');
  ind.textContent = `${currentPageNum()} / ${doc.pages.length}`;
  ind.classList.add('show');
  clearTimeout(indTimer);
  indTimer = setTimeout(() => ind.classList.remove('show'), 1200);
}, { passive: true });

let resizeTimer;
window.addEventListener('resize', () => {
  if (!doc) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const fracY = pagesEl.scrollTop / Math.max(1, pagesEl.scrollHeight);
    layoutPages();
    pagesEl.scrollTop = fracY * pagesEl.scrollHeight;
    scheduleRender();
  }, 150);
});

/* =========================================================================
 * Lukis conteng
 * Stroke: { t: 'pen'|'hl', c: colour, w: width (relatif lebar halaman),
 *           p: ada tekanan?, pts: [[x, y, pressure?], ...] (0..1) }
 * ======================================================================= */
function strokePath(ctx, pts, W, H) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0] * W, pts[0][1] * H);
  if (pts.length === 2) {
    ctx.lineTo(pts[1][0] * W, pts[1][1] * H);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2 * W;
    const my = (pts[i][1] + pts[i + 1][1]) / 2 * H;
    ctx.quadraticCurveTo(pts[i][0] * W, pts[i][1] * H, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0] * W, last[1] * H);
}

function drawStroke(ctx, s, W, H) {
  const pts = s.pts;
  if (!pts || !pts.length) return;
  const lw = s.w * W;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = s.c;
  ctx.fillStyle = s.c;
  if (s.t === 'hl') ctx.globalAlpha = 0.42;

  if (pts.length === 1) {
    const f = s.p ? pts[0][2] : 1;
    ctx.beginPath();
    ctx.arc(pts[0][0] * W, pts[0][1] * H, Math.max(0.5, lw * f / 2), 0, Math.PI * 2);
    ctx.fill();
  } else if (s.t === 'pen' && s.p) {
    // lebar berubah ikut tekanan stylus
    let px = pts[0][0] * W, py = pts[0][1] * H;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const nx = i < pts.length - 1 ? (b[0] + pts[i + 1][0]) / 2 * W : b[0] * W;
      const ny = i < pts.length - 1 ? (b[1] + pts[i + 1][1]) / 2 * H : b[1] * H;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(b[0] * W, b[1] * H, nx, ny);
      ctx.lineWidth = Math.max(0.5, lw * (a[2] + b[2]) / 2);
      ctx.stroke();
      px = nx; py = ny;
    }
  } else {
    ctx.lineWidth = lw;
    strokePath(ctx, pts, W, H);
    ctx.stroke();
  }
  ctx.restore();
}

function pageStrokes(num, create) {
  let arr = doc.annots.pages[num];
  if (!arr && create) arr = doc.annots.pages[num] = [];
  return arr || [];
}

function drawInk(p) {
  const c = p.ink;
  if (!c.width) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  for (const s of pageStrokes(p.num)) drawStroke(ctx, s, c.width, c.height);
}

/* ---------- live layer (stroke yang sedang dilukis) ---------- */
const live = document.createElement('canvas');
live.className = 'live';
let liveRaf = 0;

function attachLive(p) {
  if (live.parentNode !== p.el) p.el.appendChild(live);
  const w = p.ink.width || Math.round(p.cssW * Math.min(devicePixelRatio || 1, 3));
  const h = p.ink.height || Math.round(p.cssH * Math.min(devicePixelRatio || 1, 3));
  if (live.width !== w || live.height !== h) { live.width = w; live.height = h; }
  else live.getContext('2d').clearRect(0, 0, w, h);
}
function detachLive() {
  cancelAnimationFrame(liveRaf);
  liveRaf = 0;
  live.getContext('2d').clearRect(0, 0, live.width, live.height);
  if (live.parentNode) live.parentNode.removeChild(live);
}
function requestLive() {
  if (liveRaf) return;
  liveRaf = requestAnimationFrame(() => {
    liveRaf = 0;
    if (!drawing) return;
    const ctx = live.getContext('2d');
    ctx.clearRect(0, 0, live.width, live.height);
    if (drawing.stroke) drawStroke(ctx, drawing.stroke, live.width, live.height);
    if (drawing.cursor) {
      const k = live.width / drawing.page.cssW;
      ctx.save();
      ctx.beginPath();
      ctx.arc(drawing.cursor.x * k, drawing.cursor.y * k, eraserRadiusPx(state.sizes.eraser) * k, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(15,23,42,.6)';
      ctx.lineWidth = 1.5 * k;
      ctx.setLineDash([4 * k, 3 * k]);
      ctx.stroke();
      ctx.restore();
    }
  });
}

/* ---------- pointer / gesture handling ---------- */
const pointers = new Map(); // pointerId -> {x, y, type}
let drawing = null;  // { id, type, page, stroke?, erased?, start? }
let gesture = null;  // { kind: 'pan'|'pinch', ... }

function pagePoint(p, e) {
  const r = p.el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top }; // css px dalam halaman
}
function pressureOf(e) {
  if (e.pointerType !== 'pen' || !e.pressure) return 1;
  return Math.round(clamp(0.35 + e.pressure * 1.3, 0.3, 1.8) * 100) / 100;
}

function touchList() {
  return [...pointers.entries()].filter(([, v]) => v.type === 'touch');
}

pagesEl.addEventListener('pointerdown', e => {
  if (!doc) return;
  $('#menu').classList.add('hidden');

  if (e.pointerType === 'pen' && !state.penSeen) {
    state.penSeen = true;
    if (!state.stylusOnly) {
      setStylusOnly(true);
      toast('Stylus dikesan ✏️ — mod "Stylus sahaja" ON. Jari untuk scroll & zoom.', 4000);
    }
    savePrefs();
  }

  // Mod scroll: sentuhan guna scroll asal browser
  if (state.tool === 'hand' && e.pointerType !== 'mouse') return;

  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
  try { pagesEl.setPointerCapture(e.pointerId); } catch { /* ignore */ }

  if (e.pointerType === 'touch') {
    // tapak tangan semasa menulis guna stylus: abaikan
    if (drawing && drawing.type === 'pen') return;
    const touches = touchList();
    if (touches.length >= 2) {
      if (drawing && drawing.type === 'touch') cancelDrawing();
      startPinch(touches);
      return;
    }
    if (state.stylusOnly) {
      gesture = { kind: 'pan', id: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
  }

  if (state.tool === 'hand') { // mouse drag
    gesture = { kind: 'pan', id: e.pointerId, x: e.clientX, y: e.clientY };
    return;
  }
  if (e.pointerType === 'pen' && gesture && gesture.kind === 'pan') gesture = null; // tapak tangan
  if (drawing || (gesture && gesture.kind === 'pinch')) return;

  const pageEl = e.target.closest && e.target.closest('.page');
  if (!pageEl) return;
  const p = doc.pages[pageEl.dataset.num - 1];
  e.preventDefault();
  startDrawing(p, e);
});

pagesEl.addEventListener('pointermove', e => {
  const ptr = pointers.get(e.pointerId);
  if (!ptr) return;
  ptr.x = e.clientX; ptr.y = e.clientY;

  if (gesture && gesture.kind === 'pinch' && gesture.ids.includes(e.pointerId)) { updatePinch(); return; }
  if (gesture && gesture.kind === 'pan' && gesture.id === e.pointerId) {
    if (drawing) return;
    pagesEl.scrollLeft -= e.clientX - gesture.x;
    pagesEl.scrollTop -= e.clientY - gesture.y;
    gesture.x = e.clientX; gesture.y = e.clientY;
    return;
  }
  if (drawing && drawing.id === e.pointerId) {
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    moveDrawing(evs.length ? evs : [e]);
  }
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (drawing && drawing.id === e.pointerId) finishDrawing();
  if (gesture) {
    if (gesture.kind === 'pinch' && gesture.ids.includes(e.pointerId)) {
      gesture = null;
      scheduleRender(30);
      // jari yang tinggal teruskan pan (bukan melukis)
      const rest = touchList();
      if (rest.length === 1) gesture = { kind: 'pan', id: rest[0][0], x: rest[0][1].x, y: rest[0][1].y };
    } else if (gesture.kind === 'pan' && gesture.id === e.pointerId) {
      gesture = null;
    }
  }
}
pagesEl.addEventListener('pointerup', endPointer);
pagesEl.addEventListener('pointercancel', endPointer);
pagesEl.addEventListener('contextmenu', e => e.preventDefault());
// iOS Safari: elak zoom keseluruhan halaman web
document.addEventListener('gesturestart', e => e.preventDefault());

// Desktop: Ctrl + scroll untuk zoom
pagesEl.addEventListener('wheel', e => {
  if (!doc || !e.ctrlKey) return;
  e.preventDefault();
  setZoom(state.zoom * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY);
}, { passive: false });

function startPinch(touches) {
  const [a, b] = touches.slice(0, 2).map(t => t[1]);
  gesture = {
    kind: 'pinch',
    ids: touches.slice(0, 2).map(t => t[0]),
    d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    z0: state.zoom,
    s0: { x: pagesEl.scrollLeft, y: pagesEl.scrollTop, ax: (a.x + b.x) / 2, ay: (a.y + b.y) / 2 },
  };
}
function updatePinch() {
  const a = pointers.get(gesture.ids[0]), b = pointers.get(gesture.ids[1]);
  if (!a || !b) return;
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  const z = gesture.z0 * d / gesture.d0;
  setZoom(z, (a.x + b.x) / 2, (a.y + b.y) / 2, gesture.z0, gesture.s0);
}

function startDrawing(p, e) {
  const pt = pagePoint(p, e);
  drawing = { id: e.pointerId, type: e.pointerType, page: p };
  attachLive(p);
  const tool = state.tool;
  if (tool === 'eraser') {
    drawing.erased = [];
    drawing.cursor = pt;
    eraseAt(p, pt);
  } else {
    const fam = family(tool);
    const hasPressure = tool === 'pen' && e.pointerType === 'pen';
    const x = r4(pt.x / p.cssW), y = r4(pt.y / p.cssH);
    drawing.stroke = {
      t: tool === 'pen' ? 'pen' : 'hl',
      c: state.colors[fam],
      w: r4(widthNorm(tool, state.sizes[fam])),
      pts: hasPressure ? [[x, y, pressureOf(e)]] : [[x, y]],
    };
    if (hasPressure) drawing.stroke.p = 1;
    if (tool === 'line') drawing.start = pt;
  }
  requestLive();
}

function moveDrawing(evs) {
  const p = drawing.page;
  const tool = state.tool;
  if (tool === 'eraser') {
    for (const ev of evs) {
      const pt = pagePoint(p, ev);
      drawing.cursor = pt;
      eraseAt(p, pt);
    }
  } else if (tool === 'line') {
    const ev = evs[evs.length - 1];
    let pt = pagePoint(p, ev);
    pt = snapAngle(drawing.start, pt);
    const s = drawing.stroke;
    s.pts = [s.pts[0], [r4(pt.x / p.cssW), r4(pt.y / p.cssH)]];
  } else {
    const s = drawing.stroke;
    for (const ev of evs) {
      const pt = pagePoint(p, ev);
      const last = s.pts[s.pts.length - 1];
      const x = r4(pt.x / p.cssW), y = r4(pt.y / p.cssH);
      // abaikan titik terlalu rapat
      const dx = (x - last[0]) * p.cssW, dy = (y - last[1]) * p.cssH;
      if (dx * dx + dy * dy < 1.2) continue;
      s.pts.push(s.p ? [x, y, pressureOf(ev)] : [x, y]);
    }
  }
  requestLive();
}

// Garis lurus: snap ke mendatar / menegak / pepenjuru (word search)
function snapAngle(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 4) return b;
  const ang = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  const snapped = Math.round(ang / step) * step;
  if (Math.abs(ang - snapped) < (9 * Math.PI) / 180) {
    return { x: a.x + Math.cos(snapped) * len, y: a.y + Math.sin(snapped) * len };
  }
  return b;
}

function finishDrawing() {
  const d = drawing;
  drawing = null;
  detachLive();
  if (!d || !doc) return;
  const num = d.page.num;
  if (d.erased) {
    if (d.erased.length) pushAction({ t: 'erase', page: num, items: d.erased });
  } else if (d.stroke) {
    const s = d.stroke;
    if (s.pts.length === 2 && s.t === 'hl') {
      const [a, b] = s.pts;
      if (a[0] === b[0] && a[1] === b[1]) s.pts = [a];
    }
    pageStrokes(num, true).push(s);
    pushAction({ t: 'add', page: num, s });
    drawInk(d.page);
  }
}

function cancelDrawing() {
  const d = drawing;
  drawing = null;
  detachLive();
  if (d && d.erased && d.erased.length) {
    // pulihkan apa yang terpadam oleh jari sebelum pinch
    const arr = pageStrokes(d.page.num, true);
    for (let i = d.erased.length - 1; i >= 0; i--) arr.splice(d.erased[i].i, 0, d.erased[i].s);
    drawInk(d.page);
  }
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function strokeHit(s, pt, W, H, r) {
  const tol = r + (s.w * W) / 2;
  const pts = s.pts;
  if (pts.length === 1) return Math.hypot(pt.x - pts[0][0] * W, pt.y - pts[0][1] * H) <= tol;
  for (let i = 1; i < pts.length; i++) {
    if (distToSeg(pt.x, pt.y, pts[i - 1][0] * W, pts[i - 1][1] * H, pts[i][0] * W, pts[i][1] * H) <= tol) return true;
  }
  return false;
}

function eraseAt(p, pt) {
  const arr = pageStrokes(p.num);
  if (!arr.length) return;
  const r = eraserRadiusPx(state.sizes.eraser);
  let changed = false;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (strokeHit(arr[i], pt, p.cssW, p.cssH, r)) {
      drawing.erased.push({ s: arr[i], i });
      arr.splice(i, 1);
      changed = true;
    }
  }
  if (changed) drawInk(p);
}

/* ---------- undo / redo ---------- */
function pushAction(a) {
  doc.undo.push(a);
  if (doc.undo.length > 300) doc.undo.shift();
  doc.redo = [];
  markDirty();
}

function applyAction(a, reverse) {
  const arr = pageStrokes(a.page, true);
  if (a.t === 'add') {
    if (reverse) { const i = arr.lastIndexOf(a.s); if (i >= 0) arr.splice(i, 1); }
    else arr.push(a.s);
  } else if (a.t === 'erase') {
    if (reverse) for (let i = a.items.length - 1; i >= 0; i--) arr.splice(a.items[i].i, 0, a.items[i].s);
    else for (const it of a.items) arr.splice(it.i, 1);
  } else if (a.t === 'clear') {
    doc.annots.pages[a.page] = reverse ? a.strokes.slice() : [];
  } else if (a.t === 'clearAll') {
    doc.annots.pages = reverse ? JSON.parse(JSON.stringify(a.pages)) : {};
  }
  if (a.t === 'clearAll') doc.pages.forEach(drawInk);
  else { const p = doc.pages[a.page - 1]; if (p) drawInk(p); }
}

function undo() {
  if (!doc || !doc.undo.length || drawing) return;
  const a = doc.undo.pop();
  applyAction(a, true);
  doc.redo.push(a);
  markDirty();
}
function redo() {
  if (!doc || !doc.redo.length || drawing) return;
  const a = doc.redo.pop();
  applyAction(a, false);
  doc.undo.push(a);
  markDirty();
}
function updateUndoButtons() {
  $('#undoBtn').disabled = !doc || !doc.undo.length;
  $('#redoBtn').disabled = !doc || !doc.redo.length;
}

/* ---------- auto-save ---------- */
let saveTimer;
function markDirty() {
  doc.dirty = true;
  updateUndoButtons();
  clearTimeout(saveTimer);
  const d = doc;
  saveTimer = setTimeout(() => flushSave(d), 600);
}
async function flushSave(d = doc) {
  clearTimeout(saveTimer);
  if (!d || !d.dirty) return;
  d.dirty = false;
  try {
    await DB.put('annots', d.annots, d.id);
  } catch (err) {
    d.dirty = true;
    console.error(err);
    toast('Gagal simpan conteng: ' + err.message, 3500);
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && doc) {
    flushSave();
    doc.meta.lastPage = currentPageNum();
    doc.meta.zoom = state.zoom;
    DB.put('docs', doc.meta);
  }
});
window.addEventListener('pagehide', () => flushSave());

/* =========================================================================
 * Export PDF berconteng (pdf-lib)
 * ======================================================================= */
function canvasToBytes(c) {
  return new Promise((resolve, reject) => c.toBlob(b => (b ? b.arrayBuffer().then(resolve, reject) : reject(new Error('toBlob gagal'))), 'image/png'));
}

async function exportPdf() {
  if (!doc) return;
  busy(true, 'Menyediakan PDF…');
  try {
    await flushSave();
    await loadScript('vendor/pdf-lib.min.js');
    const { PDFDocument, degrees, BlendMode } = PDFLib;
    const bytes = await DB.get('files', doc.id);
    const out = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const outPages = out.getPages();

    for (const p of doc.pages) {
      const strokes = pageStrokes(p.num);
      if (!strokes.length || !outPages[p.num - 1]) continue;
      const W = 2000, H = Math.round(W * p.ratio);
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      for (const s of strokes) drawStroke(ctx, s, W, H);
      const img = await out.embedPng(await canvasToBytes(c));

      const pg = outPages[p.num - 1];
      const box = pg.getCropBox();
      const rot = (((pg.getRotation().angle || 0) % 360) + 360) % 360;
      const Wp = box.width, Hp = box.height, cx = box.x, cy = box.y;
      let o;
      if (rot === 90) o = { x: cx + Wp, y: cy, width: Hp, height: Wp };
      else if (rot === 180) o = { x: cx + Wp, y: cy + Hp, width: Wp, height: Hp };
      else if (rot === 270) o = { x: cx, y: cy + Hp, width: Hp, height: Wp };
      else o = { x: cx, y: cy, width: Wp, height: Hp };
      pg.drawImage(img, { ...o, rotate: degrees(rot), blendMode: BlendMode.Multiply });
    }

    const outBytes = await out.save();
    const fname = doc.meta.name.replace(/\.pdf$/i, '') + ' (conteng).pdf';
    const file = new File([outBytes], fname, { type: 'application/pdf' });
    busy(false);

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: fname });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('PDF dimuat turun');
  } catch (err) {
    console.error(err);
    toast('Gagal export: ' + err.message, 4000);
  } finally {
    busy(false);
  }
}

/* =========================================================================
 * Toolbar UI
 * ======================================================================= */
function setTool(tool) {
  state.tool = tool;
  pagesEl.dataset.tool = tool;
  document.querySelectorAll('.tools button').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  const tb = $('#toolbar');
  tb.classList.toggle('no-color', tool === 'hand' || tool === 'eraser');
  tb.classList.toggle('no-size', tool === 'hand');
  renderSwatches();
  renderSize();
  savePrefs();
}

function renderSwatches() {
  const fam = family(state.tool);
  const box = $('#swatches');
  box.innerHTML = '';
  if (!PALETTES[fam]) return;
  for (const col of PALETTES[fam]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (state.colors[fam] === col ? ' active' : '');
    b.style.background = col;
    b.setAttribute('aria-label', 'Warna ' + col);
    b.addEventListener('click', () => {
      state.colors[fam] = col;
      renderSwatches(); renderSize(); savePrefs();
    });
    box.appendChild(b);
  }
}

function renderSize() {
  const fam = family(state.tool);
  if (fam === 'hand') return;
  const v = state.sizes[fam] || 3;
  $('#sizeInput').value = v;
  const dot = $('#sizeDot');
  const px = fam === 'eraser' ? Math.min(22, eraserRadiusPx(v)) : Math.min(22, Math.max(3, widthNorm(state.tool, v) * 380));
  dot.style.setProperty('--d', px + 'px');
  dot.style.setProperty('--c', fam === 'eraser' ? 'transparent' : state.colors[fam]);
  if (fam === 'eraser') dot.style.setProperty('--c', '#cbd5e1');
}

function setStylusOnly(on) {
  state.stylusOnly = on;
  $('#stylusBtn').setAttribute('aria-pressed', String(on));
  savePrefs();
}

document.querySelectorAll('.tools button').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('#sizeInput').addEventListener('input', e => {
  const fam = family(state.tool);
  state.sizes[fam] = +e.target.value;
  renderSize(); savePrefs();
});
$('#stylusBtn').addEventListener('click', () => {
  setStylusOnly(!state.stylusOnly);
  toast(state.stylusOnly ? 'Stylus sahaja: jari untuk scroll & zoom' : 'Jari & stylus boleh conteng (2 jari untuk scroll/zoom)', 2800);
});
$('#undoBtn').addEventListener('click', undo);
$('#redoBtn').addEventListener('click', redo);
$('#zoomIn').addEventListener('click', () => setZoom(state.zoom * 1.25));
$('#zoomOut').addEventListener('click', () => setZoom(state.zoom / 1.25));
$('#zoomLabel').addEventListener('click', () => setZoom(1));
$('#backBtn').addEventListener('click', () => {
  if (history.state && history.state.viewer) history.back();
  else closeDoc();
});
window.addEventListener('popstate', () => { if (doc) closeDoc(); });

$('#menuBtn').addEventListener('click', e => { e.stopPropagation(); $('#menu').classList.toggle('hidden'); });
document.addEventListener('click', e => { if (!e.target.closest('#menu')) $('#menu').classList.add('hidden'); });
$('#menu').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn || !doc) return;
  $('#menu').classList.add('hidden');
  const act = btn.dataset.action;
  if (act === 'export') exportPdf();
  else if (act === 'clearPage') {
    const num = currentPageNum();
    const strokes = pageStrokes(num);
    if (!strokes.length) { toast('Tiada conteng di halaman ' + num); return; }
    if (!confirm(`Padam semua conteng di halaman ${num}?`)) return;
    const a = { t: 'clear', page: num, strokes: strokes.slice() };
    applyAction(a, false); pushAction(a);
    toast('Dipadam — tekan Undo kalau tersilap');
  } else if (act === 'clearAll') {
    if (!Object.values(doc.annots.pages).some(a => a && a.length)) { toast('Tiada conteng'); return; }
    if (!confirm('Padam SEMUA conteng dalam PDF ini?')) return;
    const a = { t: 'clearAll', pages: JSON.parse(JSON.stringify(doc.annots.pages)) };
    applyAction(a, false); pushAction(a);
    toast('Semua conteng dipadam — Undo untuk pulihkan');
  }
});

document.addEventListener('keydown', e => {
  if (!doc) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  else if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(state.zoom * 1.25); }
  else if (mod && e.key === '-') { e.preventDefault(); setZoom(state.zoom / 1.25); }
});

/* ---------- upload ---------- */
$('#fileInput').addEventListener('change', e => {
  const files = e.target.files;
  if (files && files.length) addFiles(files);
  e.target.value = '';
});
['dragenter', 'dragover'].forEach(t => document.addEventListener(t, e => {
  if ($('#library').classList.contains('hidden')) return;
  e.preventDefault(); document.body.classList.add('dragover');
}));
['dragleave', 'drop'].forEach(t => document.addEventListener(t, e => {
  e.preventDefault(); document.body.classList.remove('dragover');
  if (t === 'drop' && e.dataTransfer && e.dataTransfer.files.length && !$('#library').classList.contains('hidden')) addFiles(e.dataTransfer.files);
}));

/* ---------- install PWA ---------- */
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  $('#installBtn').classList.remove('hidden');
});
$('#installBtn').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  $('#installBtn').classList.add('hidden');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW', err)));
}

/* ---------- start ---------- */
setTool(state.tool);
setStylusOnly(state.stylusOnly);
history.replaceState({ library: true }, '');
renderLibrary().catch(err => {
  console.error(err);
  toast('Storan tak dapat dibuka: ' + err.message, 5000);
});
