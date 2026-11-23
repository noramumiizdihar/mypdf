/* Word search helper: kesan grid huruf (dari teks PDF atau OCR gambar),
 * snap garis pada huruf, baca perkataan & cari perkataan dalam grid. */
'use strict';

const WS = (() => {
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const DIRS = [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]];

  const median = a => {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);

  /* ------------------------------------------------------------------
   * Bina grid daripada titik huruf {x, y, h, ch?, conf?}
   * ---------------------------------------------------------------- */
  function clusterRows(pts) {
    const byY = pts.slice().sort((a, b) => a.y - b.y);
    const rows = [];
    for (const p of byY) {
      const r = rows[rows.length - 1];
      if (r && p.y - r.y < 0.5 * Math.max(p.h, r.h)) {
        r.items.push(p);
        r.y = mean(r.items.map(q => q.y));
        r.h = median(r.items.map(q => q.h));
      } else rows.push({ y: p.y, h: p.h, items: [p] });
    }
    return rows;
  }

  function tryColumns(run) {
    const s = median(run.map(r => r.h));
    const xs = run.flatMap(r => r.items).sort((a, b) => a.x - b.x);
    let cols = [];
    for (const p of xs) {
      const c = cols[cols.length - 1];
      if (c && p.x - c.x < 0.45 * s) { c.items.push(p); c.x = mean(c.items.map(q => q.x)); }
      else cols.push({ x: p.x, items: [p] });
    }
    cols = cols.filter(c => new Set(c.items.map(q => q.row)).size >= Math.max(3, 0.5 * run.length));
    if (cols.length < 4) return null;
    // ambil jujukan lajur dengan jarak sekata
    const gaps = cols.slice(1).map((c, i) => c.x - cols[i].x);
    const d = median(gaps);
    let bs = 0, be = 0, s0 = 0;
    for (let i = 0; i < gaps.length; i++) {
      if (!(gaps[i] > 0.6 * d && gaps[i] < 1.5 * d)) { s0 = i + 1; continue; }
      if (i + 1 - s0 > be - bs) { bs = s0; be = i + 1; }
    }
    cols = cols.slice(bs, be + 1);
    if (cols.length < 4) return null;
    const colPitch = (cols[cols.length - 1].x - cols[0].x) / (cols.length - 1);
    // semak kebanyakan huruf dalam kawasan grid jatuh pada lajur
    const xmin = cols[0].x - colPitch / 2, xmax = cols[cols.length - 1].x + colPitch / 2;
    const inside = xs.filter(p => p.x >= xmin && p.x <= xmax);
    const onCol = inside.filter(p => cols.some(c => Math.abs(p.x - c.x) < 0.35 * colPitch));
    if (onCol.length < 0.75 * inside.length) return null;
    // SETIAP baris mesti sekata dengan lajur (tolak baris tajuk / senarai perkataan)
    for (const r of run) {
      const ins = r.items.filter(p => p.x >= xmin && p.x <= xmax);
      const hit = new Set();
      let on = 0;
      for (const p of ins) {
        const k = cols.findIndex(c => Math.abs(p.x - c.x) < 0.3 * colPitch);
        if (k >= 0) { on++; hit.add(k); }
      }
      if (!ins.length || on < 0.85 * ins.length || hit.size < 0.6 * cols.length) return null;
    }
    return { cols, colPitch, s };
  }

  function buildGrid(pts) {
    if (pts.length < 16) return null;
    const rows = clusterRows(pts).filter(r => r.items.length >= 4);
    rows.forEach((r, i) => r.items.forEach(p => (p.row = i)));
    let best = null;
    for (let i = 0; i < rows.length; i++) {
      const run = [rows[i]];
      for (let j = i + 1; j < rows.length; j++) {
        const prev = run[run.length - 1];
        const pitch = rows[j].y - prev.y;
        if (run.length === 1) { if (pitch > 4 * prev.h || pitch < 0.8 * prev.h) break; }
        else {
          const p0 = (prev.y - run[0].y) / (run.length - 1);
          if (Math.abs(pitch - p0) > 0.25 * p0) break;
        }
        if (Math.abs(rows[j].h - prev.h) > 0.45 * prev.h) break;
        run.push(rows[j]);
      }
      if (run.length < 4) continue;
      // cuba jujukan penuh dan juga yang lebih pendek (kalau baris tajuk terlekat)
      for (let k = run.length; k >= 4; k--) {
        const sub = run.slice(0, k);
        const colInfo = tryColumns(sub);
        if (!colInfo) continue;
        const score = sub.length * colInfo.cols.length;
        if (!best || score > best.score) best = { score, run: sub, ...colInfo };
        break;
      }
    }
    if (!best) return null;
    const { run, cols, colPitch } = best;
    const rowY = run.map(r => r.y);
    const colX = cols.map(c => c.x);
    const rowPitch = (rowY[rowY.length - 1] - rowY[0]) / (rowY.length - 1);
    const cells = rowY.map(() => colX.map(() => null));
    run.forEach((r, ri) => {
      for (const p of r.items) {
        let ci = -1, bd = Infinity;
        colX.forEach((x, k) => { const dd = Math.abs(p.x - x); if (dd < bd) { bd = dd; ci = k; } });
        if (bd < 0.5 * colPitch) {
          const cur = cells[ri][ci];
          if (!cur || (p.conf || 0) > (cur.conf || 0)) cells[ri][ci] = p;
        }
      }
    });
    return { rowY, colX, rowPitch, colPitch, s: best.s, cells };
  }

  /* ------------------------------------------------------------------
   * Sumber 1: lapisan teks PDF
   * ---------------------------------------------------------------- */
  async function textSource(page) {
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const pts = [], items = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const t = pdfjsLib.Util.transform(vp.transform, it.transform);
      const fh = Math.hypot(t[2], t[3]);
      if (!fh || Math.abs(t[1]) > 0.01 * fh) continue; // abaikan teks senget
      const chars = [...it.str];
      const w = it.width || fh * 0.6 * chars.length;
      const adv = w / chars.length;
      const cy = t[5] - fh * 0.35;
      chars.forEach((ch, i) => {
        if (/[A-Za-z]/.test(ch)) pts.push({ x: t[4] + adv * (i + 0.5), y: cy, h: fh * 0.7, ch: ch.toUpperCase(), conf: 100 });
      });
      items.push({ str: it.str, x0: t[4], x1: t[4] + w, y: cy, h: fh * 0.7 });
    }
    return { W: vp.width, H: vp.height, pts, items };
  }

  /* ------------------------------------------------------------------
   * Sumber 2: gambar — cari "blob" huruf (geometri sahaja, laju)
   * ---------------------------------------------------------------- */
  async function renderCanvas(page, width) {
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: width / vp1.width });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return c;
  }

  function blobPoints(canvas) {
    const W = canvas.width, H = canvas.height;
    const px = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const gray = new Uint8Array(W * H);
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (px[j] * 299 + px[j + 1] * 587 + px[j + 2] * 114) / 1000;
    // threshold adaptif (purata tempatan) supaya foto dengan bayang pun ok
    const iw = W + 1;
    const integ = new Float64Array(iw * (H + 1));
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) {
        row += gray[y * W + x];
        integ[(y + 1) * iw + x + 1] = integ[y * iw + x + 1] + row;
      }
    }
    const R = Math.max(8, Math.round(Math.max(W, H) / 60));
    const bin = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - R), y1 = Math.min(H, y + R + 1);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - R), x1 = Math.min(W, x + R + 1);
        const sum = integ[y1 * iw + x1] - integ[y0 * iw + x1] - integ[y1 * iw + x0] + integ[y0 * iw + x0];
        const m = sum / ((x1 - x0) * (y1 - y0));
        const g = gray[y * W + x];
        bin[y * W + x] = g < m * 0.8 && g < 190 ? 1 : 0;
      }
    }
    // simpan versi hitam-putih untuk OCR (bayang & cahaya tak sekata dah dibuang)
    const bw = document.createElement('canvas');
    bw.width = W; bw.height = H;
    const bctx = bw.getContext('2d');
    const out = bctx.createImageData(W, H);
    for (let i = 0, j = 0; i < bin.length; i++, j += 4) {
      const v = bin[i] ? 0 : 255;
      out.data[j] = out.data[j + 1] = out.data[j + 2] = v; out.data[j + 3] = 255;
    }
    bctx.putImageData(out, 0, 0);
    // komponen bersambung (8-arah)
    const label = new Int32Array(W * H);
    const stack = new Int32Array(W * H);
    const pts = [];
    let next = 1;
    const minH = Math.max(6, H * 0.004), maxH = H * 0.08;
    for (let i = 0; i < bin.length; i++) {
      if (!bin[i] || label[i]) continue;
      let sp = 0, area = 0, minx = W, maxx = 0, miny = H, maxy = 0;
      stack[sp++] = i; label[i] = next;
      while (sp) {
        const k = stack[--sp];
        const x = k % W, y = (k / W) | 0;
        area++;
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= W) continue;
            const kk = yy * W + xx;
            if (bin[kk] && !label[kk]) { label[kk] = next; stack[sp++] = kk; }
          }
        }
      }
      next++;
      const w = maxx - minx + 1, h = maxy - miny + 1;
      if (h < minH || h > maxH || w > 1.6 * h || area < 0.08 * w * h) continue;
      pts.push({ x: (minx + maxx) / 2, y: (miny + maxy) / 2, h, w });
    }
    return { pts, bw };
  }

  /* ------------------------------------------------------------------
   * OCR (Tesseract, fail disimpan dalam app — offline)
   * ---------------------------------------------------------------- */
  let workerP = null;
  let progressCb = null;
  function abs(path) { return new URL(path, location.href).href; }
  async function getWorker() {
    if (!workerP) {
      workerP = (async () => {
        await loadScript('vendor/tesseract/tesseract.min.js');
        return Tesseract.createWorker('eng', 1, {
          workerPath: abs('vendor/tesseract/worker.min.js'),
          corePath: abs('vendor/tesseract/core/'),
          langPath: abs('vendor/tesseract/lang/'),
          gzip: true,
          workerBlobURL: false,
          logger: m => { if (progressCb) progressCb(m); },
        });
      })();
      workerP.catch(() => { workerP = null; });
    }
    return workerP;
  }
  async function terminate() {
    if (!workerP) return;
    try { (await workerP).terminate(); } catch { /* ignore */ }
    workerP = null;
  }

  function symbolsOf(data) {
    const out = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || [])
      for (const w of l.words || []) for (const s of w.symbols || []) out.push(s);
    return out;
  }
  function wordsOf(data) {
    const out = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || [])
      out.push((l.words || []).map(w => ({ text: w.text, bbox: w.bbox, conf: w.confidence })));
    return out;
  }
  const FIX = { 0: 'O', 1: 'I', '|': 'I', 5: 'S', 8: 'B', 2: 'Z', 6: 'G', '$': 'S' };
  function normCh(t) {
    const c = (t || '').trim().charAt(0);
    if (!c) return '';
    const u = (FIX[c] || c).toUpperCase();
    return LETTERS.includes(u) ? u : '';
  }

  function crop(src, x, y, w, h, k) {
    const c = document.createElement('canvas');
    const pad = 12;
    c.width = Math.max(1, Math.round(w * k) + pad * 2);
    c.height = Math.max(1, Math.round(h * k) + pad * 2);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, x, y, w, h, pad, pad, w * k, h * k);
    return { canvas: c, pad };
  }

  async function ocrGrid(canvas, g, onStep) {
    const worker = await getWorker();
    const rows = g.rowY.length, cols = g.colX.length;
    const k = Math.min(4, Math.max(0.6, 44 / g.s));
    const x0 = Math.max(0, g.colX[0] - g.colPitch * 0.6);
    const y0 = Math.max(0, g.rowY[0] - g.rowPitch * 0.6);
    const x1 = Math.min(canvas.width, g.colX[cols - 1] + g.colPitch * 0.6);
    const y1 = Math.min(canvas.height, g.rowY[rows - 1] + g.rowPitch * 0.6);
    const { canvas: cc, pad } = crop(canvas, x0, y0, x1 - x0, y1 - y0, k);
    await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: LETTERS });
    onStep && onStep('Membaca huruf grid…');
    const { data } = await worker.recognize(cc, {}, { blocks: true, text: false, hocr: false, tsv: false });
    const best = g.cells.map(r => r.map(() => null));
    for (const s of symbolsOf(data)) {
      const ch = normCh(s.text);
      if (!ch) continue;
      const cx = x0 + ((s.bbox.x0 + s.bbox.x1) / 2 - pad) / k;
      const cy = y0 + ((s.bbox.y0 + s.bbox.y1) / 2 - pad) / k;
      const r = nearestIdx(g.rowY, cy), c = nearestIdx(g.colX, cx);
      if (Math.abs(g.rowY[r] - cy) > 0.5 * g.rowPitch || Math.abs(g.colX[c] - cx) > 0.5 * g.colPitch) continue;
      if (!best[r][c] || s.confidence > best[r][c].conf) best[r][c] = { ch, conf: s.confidence };
    }
    // sel yang tertinggal / kurang yakin: baca satu-satu
    const todo = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!best[r][c] || best[r][c].conf < 45) todo.push([r, c]);
    }
    if (todo.length && todo.length <= 120) {
      await worker.setParameters({ tessedit_pageseg_mode: '10', tessedit_char_whitelist: LETTERS });
      let n = 0;
      for (const [r, c] of todo) {
        onStep && onStep(`Menyemak huruf ${++n}/${todo.length}…`);
        const { canvas: one } = crop(canvas, g.colX[c] - g.colPitch / 2, g.rowY[r] - g.rowPitch / 2, g.colPitch, g.rowPitch, k);
        const { data: d1 } = await worker.recognize(one, {}, { blocks: true, text: false, hocr: false, tsv: false });
        const sy = symbolsOf(d1).sort((a, b) => b.confidence - a.confidence)[0];
        const ch = sy && normCh(sy.text);
        if (ch && (!best[r][c] || sy.confidence > best[r][c].conf)) best[r][c] = { ch, conf: sy.confidence };
      }
    }
    return best.map(r => r.map(x => (x ? x.ch : '?')).join(''));
  }

  async function ocrWordList(canvas, g, onStep) {
    const worker = await getWorker();
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    ctx.fillStyle = '#fff';
    const b = gridBounds(g, 0.7);
    ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
    onStep && onStep('Membaca senarai perkataan…');
    const { data } = await worker.recognize(c, {}, { blocks: true, text: false, hocr: false, tsv: false });
    return wordsOf(data).map(line => line.filter(w => w.conf > 40).map(w => w.text));
  }

  function gridBounds(g, m) {
    const rows = g.rowY.length, cols = g.colX.length;
    return {
      x0: g.colX[0] - g.colPitch * m, x1: g.colX[cols - 1] + g.colPitch * m,
      y0: g.rowY[0] - g.rowPitch * m, y1: g.rowY[rows - 1] + g.rowPitch * m,
    };
  }

  /* ------------------------------------------------------------------
   * Perkataan
   * ---------------------------------------------------------------- */
  function normalize(w) { return (w || '').toUpperCase().replace(/[^A-Z]/g, ''); }

  function findWord(grid, word, fuzzy) {
    const w = normalize(word);
    if (w.length < 2) return null;
    const L = grid.letters, R = L.length, C = R ? L[0].length : 0;
    const maxUnknown = Math.max(1, Math.floor(w.length / 4));
    let best = null;
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      for (const [dr, dc] of DIRS) {
        const r1 = r + dr * (w.length - 1), c1 = c + dc * (w.length - 1);
        if (r1 < 0 || r1 >= R || c1 < 0 || c1 >= C) continue;
        let mis = 0, unk = 0;
        for (let i = 0; i < w.length; i++) {
          const ch = L[r + dr * i][c + dc * i];
          if (ch === '?') unk++;
          else if (ch !== w[i]) { mis++; if (mis > 1) break; }
        }
        const ok = (mis === 0 && unk <= maxUnknown) ||
          (fuzzy && w.length >= 5 && mis <= 1 && mis + unk <= maxUnknown);
        if (!ok) continue;
        const score = mis * 2 + unk;
        if (!best || score < best.score) best = { r0: r, c0: c, r1, c1, score };
      }
    }
    return best;
  }

  function readPath(grid, a, b) {
    const dr = Math.sign(b.r - a.r), dc = Math.sign(b.c - a.c);
    const n = Math.max(Math.abs(b.r - a.r), Math.abs(b.c - a.c));
    let s = '';
    for (let i = 0; i <= n; i++) s += (grid.letters[a.r + dr * i] || '')[a.c + dc * i] || '?';
    return s;
  }

  // padan bacaan dengan senarai (depan/belakang, '?' = mana-mana huruf)
  function matchList(read, list, fuzzy) {
    const rev = [...read].reverse().join('');
    for (const word of list) {
      const w = normalize(word);
      if (w.length !== read.length) continue;
      for (const s of [read, rev]) {
        let mis = 0, unk = 0;
        for (let i = 0; i < w.length; i++) {
          if (s[i] === '?') unk++;
          else if (s[i] !== w[i]) mis++;
        }
        const maxUnknown = Math.max(1, Math.floor(w.length / 4));
        if ((mis === 0 && unk <= maxUnknown) || (fuzzy && w.length >= 5 && mis <= 1 && mis + unk <= maxUnknown)) return word;
      }
    }
    return null;
  }

  // calon perkataan dari baris teks: token tunggal + gabungan 2-3 token (cth "ICE CREAM")
  function candidates(lines) {
    const out = new Set();
    for (const line of lines) {
      const toks = line.join(' ').split(/[^A-Za-z]+/).filter(Boolean).map(t => t.toUpperCase());
      for (let i = 0; i < toks.length; i++) {
        let s = '';
        for (let j = i; j < Math.min(toks.length, i + 3); j++) {
          s += toks[j];
          if (s.length >= 3 && s.length <= 20) out.add(s);
        }
      }
    }
    return [...out];
  }

  function pickWords(grid, lines, fuzzy) {
    const found = candidates(lines).filter(w => findWord(grid, w, fuzzy));
    // buang perkataan yang cuma sebahagian daripada perkataan lain yang dijumpai
    return found.filter(w => !found.some(o => o !== w && o.length > w.length && o.includes(w)));
  }

  /* ------------------------------------------------------------------
   * API utama
   * ---------------------------------------------------------------- */
  function nearestIdx(arr, v) {
    let bi = 0, bd = Infinity;
    arr.forEach((x, i) => { const d = Math.abs(x - v); if (d < bd) { bd = d; bi = i; } });
    return bi;
  }

  function normalizeGrid(g, W, H) {
    return {
      v: 1,
      rowY: g.rowY.map(y => +(y / H).toFixed(5)),
      colX: g.colX.map(x => +(x / W).toFixed(5)),
      rowPitch: g.rowPitch / H,
      colPitch: g.colPitch / W,
    };
  }

  /**
   * Kesan grid pada halaman. onGeom(grid) dipanggil sebaik geometri siap
   * (supaya snap boleh terus digunakan), kemudian huruf dibaca (OCR jika perlu).
   */
  async function detect(page, { onStep, onGeom, onProgress } = {}) {
    // 1. teks PDF
    const t = await textSource(page);
    const tg = buildGrid(t.pts);
    if (tg) {
      const letters = tg.cells.map(r => r.map(p => (p ? p.ch : '?')).join(''));
      const known = letters.join('').replace(/\?/g, '').length;
      if (known >= 0.85 * letters.length * letters[0].length) {
        const grid = { ...normalizeGrid(tg, t.W, t.H), letters, src: 'text', done: true };
        const b = gridBounds(tg, 0.5);
        const outside = t.items.filter(it => it.y < b.y0 || it.y > b.y1 || it.x1 < b.x0 || it.x0 > b.x1);
        // kumpul item ikut baris
        const lines = [];
        outside.sort((a, b2) => a.y - b2.y || a.x0 - b2.x0);
        for (const it of outside) {
          const l = lines[lines.length - 1];
          if (l && Math.abs(it.y - l.y) < 0.5 * it.h && it.x0 - l.x1 < 1.5 * it.h) { l.parts.push(it.str); l.x1 = it.x1; }
          else lines.push({ y: it.y, x1: it.x1, parts: [it.str] });
        }
        grid.words = pickWords(grid, lines.map(l => l.parts), false);
        onGeom && onGeom(grid);
        return grid;
      }
    }

    // 2. gambar / scan: geometri dari blob, kemudian OCR
    onStep && onStep('Mengesan grid…');
    const canvas = await renderCanvas(page, 1600);
    const blobs = blobPoints(canvas);
    const bg = buildGrid(blobs.pts);
    if (!bg) return null;
    const rows = bg.rowY.length, cols = bg.colX.length;
    const grid = { ...normalizeGrid(bg, canvas.width, canvas.height), letters: Array(rows).fill('?'.repeat(cols)), src: 'ocr', done: false, words: [] };
    onGeom && onGeom(grid);

    progressCb = m => {
      if (m.status && /loading|initializ/i.test(m.status)) onProgress && onProgress(`Memuat enjin OCR… ${Math.round((m.progress || 0) * 100)}%`);
    };
    try {
      grid.letters = await ocrGrid(blobs.bw, bg, onProgress);
      const lines = await ocrWordList(blobs.bw, bg, onProgress);
      grid.words = pickWords(grid, lines, true);
      grid.done = true;
    } finally {
      progressCb = null;
    }
    return grid;
  }

  // sel terdekat dengan titik (x,y dalam 0..1)
  function cellAt(g, nx, ny) {
    const r = nearestIdx(g.rowY, ny), c = nearestIdx(g.colX, nx);
    if (Math.abs(g.rowY[r] - ny) > 1.0 * g.rowPitch || Math.abs(g.colX[c] - nx) > 1.0 * g.colPitch) return null;
    return { r, c };
  }

  // hujung garis: snap ke salah satu 8 arah dari sel mula
  function snapEnd(g, a, nx, ny, ratio) {
    const dc = (nx - g.colX[a.c]) / g.colPitch;
    const dr = (ny - g.rowY[a.r]) / g.rowPitch;
    // ukur sudut dalam ruang fizikal
    const ang = Math.atan2(dr * g.rowPitch * ratio, dc * g.colPitch);
    const sn = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
    const uc = Math.round(Math.cos(sn)), ur = Math.round(Math.sin(sn));
    let n = Math.round((dc * uc + dr * ur) / (uc * uc + ur * ur));
    n = Math.max(0, n);
    const R = g.rowY.length, C = g.colX.length;
    while (n > 0 && (a.r + ur * n < 0 || a.r + ur * n >= R || a.c + uc * n < 0 || a.c + uc * n >= C)) n--;
    return { r: a.r + ur * n, c: a.c + uc * n };
  }

  const center = (g, cell) => [g.colX[cell.c], g.rowY[cell.r]];
  const lineWidth = (g, ratio) => 0.78 * Math.min(g.colPitch, g.rowPitch * ratio);

  return { detect, cellAt, snapEnd, center, lineWidth, readPath, findWord, matchList, normalize, terminate };
})();
