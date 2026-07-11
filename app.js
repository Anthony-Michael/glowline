/* ===========================================================================
   GLOWLINE — app.js
   A visual sales-closer for permanent / holiday lighting installers.
   Trace a roofline on a photo → preview the glow in any season → priced proposal.
   Pure front-end, no build step, no backend. State persists to localStorage.
   =========================================================================== */
(() => {
  'use strict';

  /* ---------- lighting scenes (drive the trace colors) ---------- */
  const SCENES = {
    warm:    { name: 'Warm White',     colors: ['#ffd7a1'],                       swatch: '#ffd7a1' },
    cool:    { name: 'Cool White',     colors: ['#dbe9ff'],                       swatch: '#dbe9ff' },
    xmas:    { name: 'Christmas',      colors: ['#ff3b3b', '#2ee06b'],            swatch: '#ff3b3b' },
    hallow:  { name: 'Halloween',      colors: ['#ff7a1a', '#9a4dff'],           swatch: '#ff7a1a' },
    july4:   { name: 'Fourth of July', colors: ['#ff4d4d', '#f4f7ff', '#4d7dff'],swatch: '#4d7dff' },
    fall:    { name: 'Fall Amber',     colors: ['#ff9e2c', '#c8412b', '#ffcf6b'],swatch: '#ff9e2c' },
  };

  /* ---------- default demo house (inline SVG → data URI) ---------- */
  const DEMO_W = 1200, DEMO_H = 760;
  const DEMO_HOUSE = demoHouseDataURI();
  const DEMO_PX_PER_FOOT = 21.5; // demo frontage ≈ 56 ft across the image

  /* ---------- state ---------- */
  const state = {
    projectName: 'Untitled roofline',
    imgSrc: DEMO_HOUSE,
    imgW: DEMO_W, imgH: DEMO_H,
    isDemo: true,
    system: 'permanent',
    scene: 'warm',
    night: false,
    tool: 'trace',
    snap: true,                       // snap traced points to the nearest strong roofline edge
    runs: [{ id: 'r1', points: [] }], // each run = one continuous roof section [{x,y}] in image coords
    activeRun: 0,
    scale: { pxPerFoot: DEMO_PX_PER_FOOT, calib: [] }, // calib: up to 2 pts while measuring
    calibrating: false,
    lineItems: [],
    tax: 8,
    deposit: 50,
    customer: { company: '', name: '', address: '', expiry: '14 days', companyPhone: '', companyEmail: '' },
  };

  /* ---------- element refs ---------- */
  const $ = (s) => document.querySelector(s);
  const el = {
    stage: $('#stage'), overlay: $('#overlay'), img: $('#houseImg'),
    frame: $('#canvasFrame'), veil: $('#nightVeil'), hint: $('#stageHint'),
    scenes: $('.scenes'), projectName: $('#projectName'),
    feetNum: $('#feetNum'), feetSub: $('#feetSub'),
    systemSeg: $('#systemSeg'), systemNote: $('#systemNote'),
    lineItems: $('#lineItems'), addLine: $('#addLine'),
    taxRate: $('#taxRate'), depositPct: $('#depositPct'),
    tSubtotal: $('#tSubtotal'), tTax: $('#tTax'), tTotal: $('#tTotal'),
    tDeposit: $('#tDeposit'), tDepositLabel: $('#tDepositLabel'),
    scaleBanner: $('#scaleBanner'), scaleBannerText: $('#scaleBannerText'),
    photoInput: $('#photoInput'),
    proposalScrim: $('#proposalScrim'), proposalBody: $('#proposalBody'),
    savedScrim: $('#savedScrim'), savedList: $('#savedList'),
  };

  /* ---------- helpers ---------- */
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const uid = () => Math.random().toString(36).slice(2, 9);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  /* ---------- edge-snap assist (Sobel edge map of the current photo) ---------- */
  let edge = null; // { data:Uint8ClampedArray, w, h, sx, sy }

  function buildEdgeMap() {
    try {
      const MAXW = 760;
      const scale = Math.min(1, MAXW / state.imgW);
      const w = Math.max(2, Math.round(state.imgW * scale));
      const h = Math.max(2, Math.round(state.imgH * scale));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.drawImage(el.img, 0, 0, w, h);
      const src = ctx.getImageData(0, 0, w, h).data;
      const gray = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) gray[i] = 0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2];
      const mag = new Uint8ClampedArray(w * h);
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
        const gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
        mag[i] = Math.min(255, Math.hypot(gx, gy));
      }
      edge = { data: mag, w, h, sx: w / state.imgW, sy: h / state.imgH };
    } catch (e) { edge = null; } // tainted canvas etc. — snap simply becomes a no-op
  }

  // move a point to the strongest nearby edge, preferring closer ones
  function snapPoint(p) {
    if (!state.snap || !edge) return p;
    const cx = Math.round(p.x * edge.sx), cy = Math.round(p.y * edge.sy);
    const R = Math.max(8, Math.round(edge.w / 45));
    let bestScore = -1e9, bestMag = 0, bx = cx, by = cy;
    for (let y = Math.max(1, cy - R); y <= Math.min(edge.h - 2, cy + R); y++) {
      for (let x = Math.max(1, cx - R); x <= Math.min(edge.w - 2, cx + R); x++) {
        const m = edge.data[y * edge.w + x];
        const score = m - 2 * Math.hypot(x - cx, y - cy);
        if (score > bestScore) { bestScore = score; bestMag = m; bx = x; by = y; }
      }
    }
    if (bestMag < 45) return p; // nothing edge-like nearby — leave the click where it is
    return { x: bx / edge.sx, y: by / edge.sy };
  }

  // active run's point array (what new clicks append to)
  function activePoints() {
    if (!state.runs[state.activeRun]) state.activeRun = state.runs.length - 1;
    return state.runs[state.activeRun].points;
  }
  function totalPoints() { return state.runs.reduce((n, r) => n + r.points.length, 0); }
  function tracedRuns() { return state.runs.filter((r) => r.points.length >= 2); }

  function runPixels(pts) {
    let px = 0;
    for (let i = 0; i < pts.length - 1; i++) px += dist(pts[i], pts[i + 1]);
    return px;
  }
  function polylineFeet() {
    if (!state.scale.pxPerFoot) return 0;
    let px = 0;
    for (const r of state.runs) if (r.points.length >= 2) px += runPixels(r.points);
    return px / state.scale.pxPerFoot;
  }

  /* ---------- line items ---------- */
  function defaultLineItems() {
    const feet = Math.round(polylineFeet());
    const items = [{
      id: uid(), kind: 'track', auto: true, unit: 'ft',
      label: 'Permanent LED channel — installed', qty: feet, rate: 28,
    }];
    if (state.system === 'permanent') {
      items.push({ id: uid(), kind: 'controller', auto: false, unit: '',
        label: 'Smart controller + Glowline app', qty: null, rate: 199 });
    }
    return items;
  }

  function syncTrackLine() {
    const feet = Math.round(polylineFeet());
    const track = state.lineItems.find((l) => l.kind === 'track');
    if (track) track.qty = feet;
  }

  function applySystem() {
    const track = state.lineItems.find((l) => l.kind === 'track');
    if (state.system === 'permanent') {
      if (track && track.auto) {
        track.label = 'Permanent LED channel — installed';
        if (track.rate === 6) track.rate = 28;
      }
      if (!state.lineItems.find((l) => l.kind === 'controller')) {
        const idx = state.lineItems.findIndex((l) => l.kind === 'track');
        state.lineItems.splice(idx + 1, 0, { id: uid(), kind: 'controller', auto: false, unit: '',
          label: 'Smart controller + Glowline app', qty: null, rate: 199 });
      }
      el.systemNote.textContent = 'Year-round track, every holiday from one app. Installed once, hidden by day.';
    } else {
      if (track && track.auto) {
        track.label = 'Seasonal install + winter takedown';
        if (track.rate === 28) track.rate = 6;
      }
      state.lineItems = state.lineItems.filter((l) => l.kind !== 'controller');
      el.systemNote.textContent = 'Hung each fall, taken down after the holidays. Priced per foot, per season.';
    }
  }

  function lineAmount(l) {
    return l.unit ? (l.qty || 0) * l.rate : l.rate;
  }
  function subtotal() { return state.lineItems.reduce((s, l) => s + lineAmount(l), 0); }

  /* =========================================================================
     RENDER
     ========================================================================= */
  function render() {
    renderScenes();
    renderOverlay();
    renderReadout();
    renderLineItems();
    renderTotals();
    el.frame.classList.toggle('is-night', state.night);
    el.stage.classList.toggle('mode-scale', state.tool === 'scale');
    el.frame.classList.toggle('has-points', totalPoints() > 0);
    document.querySelectorAll('.tool[data-tool]').forEach((b) =>
      b.classList.toggle('is-active', b.dataset.tool === state.tool));
    $('#toolNight').classList.toggle('is-active', state.night);
    $('#toolSnap').classList.toggle('is-active', state.snap);
    persistDraft();
  }

  function renderScenes() {
    if (el.scenes.children.length) {
      [...el.scenes.children].forEach((c) => c.classList.toggle('is-active', c.dataset.scene === state.scene));
      return;
    }
    el.scenes.innerHTML = Object.entries(SCENES).map(([k, s]) =>
      `<button class="scene-chip ${k === state.scene ? 'is-active' : ''}" data-scene="${k}" style="--c:${s.swatch}">
         <span class="swatch"></span>${s.name}</button>`).join('');
  }

  // sample evenly-spaced bulb positions along the traced polyline
  function sampleBulbs(points, spacing) {
    if (points.length < 2) return points.slice();
    const out = [{ x: points[0].x, y: points[0].y }];
    let residual = spacing;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, segLen = Math.hypot(dx, dy);
      let d = residual;
      while (d < segLen) { const t = d / segLen; out.push({ x: a.x + dx * t, y: a.y + dy * t }); d += spacing; }
      residual = d - segLen;
    }
    const last = points[points.length - 1];
    if (dist(out[out.length - 1], last) > spacing * 0.4) out.push({ x: last.x, y: last.y });
    return out;
  }

  // build the inner SVG markup for a set of runs (reused live + in the proposal hero)
  function buildOverlayInner(runs, sceneKey, opts = {}) {
    const { handles = false, W = state.imgW, activeRun = -1 } = opts;
    const scene = SCENES[sceneKey] || SCENES.warm;
    const spacing = Math.max(13, W / 62);
    const twinkle = !opts.still;
    const r = Math.max(3.2, W / 200);

    const defs = `<defs>
      <filter id="gl-bloom" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="${Math.max(2.4, W / 320)}" />
      </filter>
    </defs>`;

    let lines = '', halos = '', cores = '', vhandles = '';
    let colorIdx = 0; // continuous color cycle across all runs

    runs.forEach((run, ri) => {
      const pts = run.points;
      if (pts.length > 1) {
        lines += `<polyline points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}"
          fill="none" stroke="rgba(255,224,180,0.5)" stroke-width="${Math.max(1.5, W / 700)}"
          stroke-linecap="round" stroke-linejoin="round" />`;
      }
      const bulbs = sampleBulbs(pts, spacing);
      bulbs.forEach((p) => {
        const c = scene.colors[colorIdx % scene.colors.length]; colorIdx++;
        halos += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r * 2.6}" fill="${c}" opacity="0.5" filter="url(#gl-bloom)" />`;
        const delay = twinkle ? ((colorIdx * 137) % 360) / 100 : 0;
        const anim = twinkle ? ` class="bulb" style="animation-delay:${delay}s"` : '';
        cores += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${c}"${anim} />`
               + `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r * 0.42}" fill="#fff" opacity="0.9" />`;
      });
      if (handles) {
        const dim = activeRun >= 0 && ri !== activeRun;
        vhandles += pts.map((p, i) =>
          `<circle class="vhandle" data-run="${ri}" data-idx="${i}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r * 1.7}"
             fill="rgba(10,14,28,.4)" stroke="#ffd7a1" stroke-opacity="${dim ? 0.4 : 1}" stroke-width="${Math.max(1.2, W / 900)}" style="cursor:grab" />`).join('');
      }
    });

    // scale calibration marks
    let calib = '';
    if (state.calibrating && state.scale.calib.length) {
      const cp = state.scale.calib;
      calib += cp.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="${r * 1.3}" fill="none" stroke="#ffb257" stroke-width="${Math.max(1.4, W / 700)}" />`).join('');
      if (cp.length === 2)
        calib += `<line x1="${cp[0].x}" y1="${cp[0].y}" x2="${cp[1].x}" y2="${cp[1].y}" stroke="#ffb257" stroke-width="${Math.max(1.4, W / 800)}" stroke-dasharray="6 5" />`;
    }

    return defs + lines + halos + cores + vhandles + calib;
  }

  function renderOverlay() {
    el.overlay.setAttribute('viewBox', `0 0 ${state.imgW} ${state.imgH}`);
    el.overlay.innerHTML = buildOverlayInner(state.runs, state.scene,
      { handles: state.tool === 'trace', W: state.imgW, activeRun: state.activeRun });
  }

  function renderReadout() {
    const feet = polylineFeet();
    if (!state.scale.pxPerFoot) {
      el.feetNum.textContent = '—';
      el.feetSub.textContent = 'set scale to price this run';
      el.feetSub.className = 'readout-sub warn';
    } else if (tracedRuns().length === 0) {
      el.feetNum.textContent = '0';
      el.feetSub.textContent = 'click along the roofline to lay the lights';
      el.feetSub.className = 'readout-sub';
    } else {
      el.feetNum.textContent = Math.round(feet).toLocaleString();
      const bulbs = totalNodes();
      const runs = tracedRuns().length;
      el.feetSub.textContent = `${runs} run${runs > 1 ? 's' : ''} · ~${bulbs} nodes · ${state.system} system`;
      el.feetSub.className = 'readout-sub';
    }
  }

  function totalNodes() {
    const spacing = Math.max(13, state.imgW / 62);
    return state.runs.reduce((n, r) => n + (r.points.length >= 2 ? sampleBulbs(r.points, spacing).length : 0), 0);
  }

  function renderLineItems() {
    el.lineItems.innerHTML = state.lineItems.map((l) => {
      const amt = lineAmount(l);
      const meta = l.unit
        ? `<div class="li-meta">
             <input data-li="${l.id}" data-f="qty" value="${l.qty ?? 0}" ${l.auto ? 'readonly title="from the traced roofline"' : ''} /> ${l.unit}
             × $<input data-li="${l.id}" data-f="rate" value="${l.rate}" />/${l.unit}
           </div>`
        : `<div class="li-meta">flat · $<input data-li="${l.id}" data-f="rate" value="${l.rate}" /></div>`;
      return `<div class="li ${l.auto ? 'auto' : ''}">
        <div class="li-main">
          <input class="li-label" data-li="${l.id}" data-f="label" value="${escapeAttr(l.label)}" />
          ${meta}
        </div>
        <div class="li-amount">${money(amt)}</div>
        <button class="li-del" data-del="${l.id}" title="Remove">×</button>
      </div>`;
    }).join('');
  }

  function renderTotals() {
    const sub = subtotal();
    const tax = sub * (state.tax / 100);
    const total = sub + tax;
    const dep = total * (state.deposit / 100);
    el.tSubtotal.textContent = money(sub);
    el.tTax.textContent = money(tax);
    el.tTotal.textContent = money(total);
    el.tDeposit.textContent = money(dep);
    el.tDepositLabel.textContent = `Due to book (${state.deposit}%)`;
  }

  function escapeAttr(s) { return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  /* =========================================================================
     INTERACTIONS
     ========================================================================= */
  // convert a pointer event to image-intrinsic coords
  function toImgCoords(ev) {
    const r = el.overlay.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) / r.width * state.imgW,
      y: (ev.clientY - r.top) / r.height * state.imgH,
    };
  }

  let dragRun = -1, dragIdx = -1, dragMoved = false;

  el.overlay.addEventListener('pointerdown', (ev) => {
    const handle = ev.target.closest('.vhandle');
    if (handle && state.tool === 'trace') {
      dragRun = +handle.dataset.run; dragIdx = +handle.dataset.idx; dragMoved = false;
      state.activeRun = dragRun; // grabbing a point activates its run
      el.overlay.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    }
  });
  el.overlay.addEventListener('pointermove', (ev) => {
    if (dragIdx < 0) return;
    dragMoved = true;
    state.runs[dragRun].points[dragIdx] = toImgCoords(ev);
    syncTrackLine();
    renderOverlay(); renderReadout(); renderLineItems(); renderTotals();
  });
  el.overlay.addEventListener('pointerup', () => {
    if (dragIdx >= 0) { dragRun = -1; dragIdx = -1; persistDraft(); }
  });

  el.overlay.addEventListener('click', (ev) => {
    if (dragMoved) { dragMoved = false; return; }        // ignore click that ended a drag
    if (ev.target.closest('.vhandle')) return;
    const p = toImgCoords(ev);

    if (state.tool === 'scale') { handleScaleClick(p); return; }

    activePoints().push(snapPoint(p));
    syncTrackLine();
    render();
  });

  function handleScaleClick(p) {
    if (!state.calibrating) { state.calibrating = true; state.scale.calib = []; }
    state.scale.calib.push(p);
    if (state.scale.calib.length === 2) {
      showScaleInput();
    } else {
      el.scaleBannerText.textContent = 'Now click the other end of that reference.';
    }
    renderOverlay();
  }

  function showScaleInput() {
    const px = dist(state.scale.calib[0], state.scale.calib[1]);
    el.scaleBanner.innerHTML =
      `<span class="scale-dot"></span>
       <span>That reference is</span>
       <input id="scaleFeet" type="number" min="1" step="0.5" value="16"
         style="width:64px;background:rgba(0,0,0,.35);border:1px solid rgba(255,178,87,.5);border-radius:8px;color:#fff;font-family:var(--font-mono);padding:5px 8px;text-align:right" />
       <span>feet</span>
       <button id="scaleSet" class="cta-btn" style="padding:7px 14px">Set scale</button>`;
    const input = $('#scaleFeet'); input.focus(); input.select();
    const commit = () => {
      const feet = parseFloat(input.value);
      if (feet > 0) {
        state.scale.pxPerFoot = px / feet;
        state.calibrating = false; state.scale.calib = [];
        setTool('trace');
        el.scaleBanner.hidden = true;
        syncTrackLine();
        render();
      }
    };
    $('#scaleSet').addEventListener('click', commit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
  }

  function setTool(t) {
    state.tool = t;
    if (t === 'scale') {
      state.calibrating = false; state.scale.calib = [];
      el.scaleBanner.hidden = false;
      el.scaleBanner.innerHTML = `<span class="scale-dot"></span><span id="scaleBannerText">Click two points on something you know the length of — a garage door (~16 ft), the front door (~7 ft).</span>`;
      el.scaleBannerText = $('#scaleBannerText');
    } else {
      el.scaleBanner.hidden = true;
    }
    render();
  }

  /* ---------- toolbar + controls wiring ---------- */
  $('#toolTrace').addEventListener('click', () => setTool('trace'));
  $('#toolScale').addEventListener('click', () => setTool('scale'));
  $('#toolNewRun').addEventListener('click', newRun);
  $('#toolNight').addEventListener('click', () => { state.night = !state.night; render(); });
  $('#toolSnap').addEventListener('click', () => { state.snap = !state.snap; render(); toast(state.snap ? 'Edge snap on' : 'Edge snap off'); });
  $('#toolUndo').addEventListener('click', undo);
  $('#toolClear').addEventListener('click', () => {
    if (!totalPoints()) return;
    state.runs = [{ id: uid(), points: [] }]; state.activeRun = 0;
    syncTrackLine(); render();
  });

  // start a fresh, separate roof section (e.g. the detached garage)
  function newRun() {
    setTool('trace');
    // reuse a trailing empty run if one exists
    const last = state.runs[state.runs.length - 1];
    if (last && last.points.length === 0) { state.activeRun = state.runs.length - 1; }
    else { state.runs.push({ id: uid(), points: [] }); state.activeRun = state.runs.length - 1; }
    render();
  }

  function undo() {
    if (state.tool === 'scale' && state.calibrating) {
      state.scale.calib.pop();
      if (!state.scale.calib.length) state.calibrating = false;
      renderOverlay(); return;
    }
    const pts = activePoints();
    if (pts.length) pts.pop();
    // if the active run is now empty and it isn't the only run, drop it
    if (pts.length === 0 && state.runs.length > 1) {
      state.runs.splice(state.activeRun, 1);
      state.activeRun = Math.max(0, state.activeRun - 1);
    }
    syncTrackLine(); render();
  }

  el.scenes.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.scene-chip');
    if (!chip) return;
    state.scene = chip.dataset.scene;
    if (!state.night) state.night = true; // scenes read best at night
    render();
  });

  el.systemSeg.addEventListener('click', (ev) => {
    const opt = ev.target.closest('.seg-opt'); if (!opt) return;
    state.system = opt.dataset.system;
    [...el.systemSeg.children].forEach((c) => c.classList.toggle('is-active', c === opt));
    applySystem(); render();
  });

  // line-item edits (event delegation)
  el.lineItems.addEventListener('input', (ev) => {
    const t = ev.target; const id = t.dataset.li; if (!id) return;
    const l = state.lineItems.find((x) => x.id === id); if (!l) return;
    const f = t.dataset.f;
    if (f === 'label') l.label = t.value;
    else if (f === 'qty') l.qty = parseFloat(t.value) || 0;
    else if (f === 'rate') l.rate = parseFloat(t.value) || 0;
    // update just this row's amount + totals (avoid re-render stealing focus)
    const row = t.closest('.li'); if (row) row.querySelector('.li-amount').textContent = money(lineAmount(l));
    renderTotals(); persistDraft();
  });
  el.lineItems.addEventListener('click', (ev) => {
    const id = ev.target.dataset.del; if (!id) return;
    state.lineItems = state.lineItems.filter((l) => l.id !== id);
    renderLineItems(); renderTotals(); persistDraft();
  });
  el.addLine.addEventListener('click', () => {
    state.lineItems.push({ id: uid(), kind: 'custom', auto: false, unit: '', label: 'New line item', qty: null, rate: 0 });
    renderLineItems(); renderTotals(); persistDraft();
  });

  el.taxRate.addEventListener('input', () => { state.tax = parseFloat(el.taxRate.value) || 0; renderTotals(); persistDraft(); });
  el.depositPct.addEventListener('input', () => { state.deposit = parseFloat(el.depositPct.value) || 0; renderTotals(); persistDraft(); });
  el.projectName.addEventListener('input', () => { state.projectName = el.projectName.value; persistDraft(); });

  // photo upload
  el.photoInput.addEventListener('change', (ev) => {
    const file = ev.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const im = new Image();
      im.onload = () => {
        // downscale so state + share links + storage stay small
        const MAX = 1600;
        let w = im.naturalWidth, h = im.naturalHeight;
        const s = Math.min(1, MAX / Math.max(w, h));
        w = Math.round(w * s); h = Math.round(h * s);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(im, 0, 0, w, h);
        let src; try { src = cv.toDataURL('image/jpeg', 0.82); } catch (e) { src = reader.result; }
        state.imgSrc = src; state.imgW = w; state.imgH = h;
        state.isDemo = false; state.runs = [{ id: uid(), points: [] }]; state.activeRun = 0;
        state.scale.pxPerFoot = null; state.night = false;
        el.img.src = state.imgSrc;
        setTool('scale'); // real photo → must calibrate scale first
        syncTrackLine(); render();
      };
      im.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  // keyboard shortcuts
  document.addEventListener('keydown', (ev) => {
    if (/input|textarea/i.test(document.activeElement.tagName)) return;
    if (ev.key === 't') setTool('trace');
    else if (ev.key === 's') setTool('scale');
    else if (ev.key === 'r') newRun();
    else if (ev.key === 'n') { state.night = !state.night; render(); }
    else if (ev.key === 'Backspace') { ev.preventDefault(); undo(); }
  });

  /* =========================================================================
     PROPOSAL
     ========================================================================= */
  $('#btnProposal').addEventListener('click', openProposal);
  $('#btnCloseProposal').addEventListener('click', () => { el.proposalScrim.hidden = true; });
  $('#btnPrint').addEventListener('click', () => window.print());
  el.proposalScrim.addEventListener('click', (e) => { if (e.target === el.proposalScrim) el.proposalScrim.hidden = true; });

  // portable snapshot of everything a proposal document needs to render
  function docData() {
    const sub = subtotal(), tax = sub * (state.tax / 100), total = sub + tax, dep = total * (state.deposit / 100);
    return {
      v: 2, projectName: state.projectName, system: state.system, scene: state.scene,
      imgSrc: state.imgSrc, imgW: state.imgW, imgH: state.imgH, runs: state.runs,
      feet: Math.round(polylineFeet()),
      lineItems: state.lineItems.map((l) => ({ label: l.label, unit: l.unit, qty: l.qty, rate: l.rate, amount: lineAmount(l) })),
      tax: state.tax, deposit: state.deposit, customer: { ...state.customer },
      sub, taxAmt: tax, total, dep,
    };
  }

  function docHTML(d) {
    const c = d.customer || {};
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const heroInner = buildOverlayInner(d.runs, d.scene, { handles: false, still: false, W: d.imgW });
    const sub = d.sub ?? d.lineItems.reduce((s, l) => s + l.amount, 0);
    const tax = d.taxAmt ?? sub * (d.tax / 100);
    const total = d.total ?? sub + tax;
    const dep = d.dep ?? total * (d.deposit / 100);
    const sceneName = (SCENES[d.scene] || SCENES.warm).name;
    const rows = d.lineItems.map((l) => {
      const q = l.unit ? `${l.qty || 0} ${l.unit} × $${l.rate}` : 'Flat rate';
      return `<tr><td><strong>${escapeHtml(l.label)}</strong><div class="desc">${q}</div></td>
              <td class="r">${money(l.amount)}</td></tr>`;
    }).join('');
    return `<div class="doc" style="-webkit-print-color-adjust:exact;print-color-adjust:exact">
      <div class="doc-top">
        <div>
          <div class="doc-co">${escapeHtml(c.company || 'Your Company')}</div>
          <div class="doc-badge"><span class="dot"></span>${d.system === 'permanent' ? 'Permanent' : 'Seasonal'} · Holiday Lighting Proposal</div>
          ${(c.companyPhone || c.companyEmail)
            ? `<div style="margin-top:8px;font-size:12.5px;color:#555">${escapeHtml([c.companyPhone, c.companyEmail].filter(Boolean).join('  ·  '))}</div>`
            : ''}
        </div>
        <div class="doc-meta">
          <div>Prepared for <strong>${escapeHtml(c.name || '—')}</strong></div>
          <div>${escapeHtml(c.address || '')}</div>
          <div>${today}</div>
          <div>Good through <strong>${escapeHtml(c.expiry || '14 days')}</strong></div>
        </div>
      </div>
      <div class="doc-hero">
        <div style="position:relative;line-height:0">
          <img src="${d.imgSrc}" style="width:100%;display:block" />
          <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,9,20,.5),rgba(6,9,20,.7));mix-blend-mode:multiply"></div>
          <svg viewBox="0 0 ${d.imgW} ${d.imgH}" preserveAspectRatio="none"
               style="position:absolute;inset:0;width:100%;height:100%">${heroInner}</svg>
        </div>
        <div class="doc-hero-cap">${sceneName} · ${d.feet} ft of roofline</div>
      </div>
      <h2>Scope &amp; investment</h2>
      <table class="doc-table"><tbody>${rows}</tbody></table>
      <div class="doc-tot">
        <div class="row"><span>Subtotal</span><span class="mono">${money(sub)}</span></div>
        <div class="row"><span>Tax (${d.tax}%)</span><span class="mono">${money(tax)}</span></div>
        <div class="row g"><span>Total</span><span class="mono">${money(total)}</span></div>
        <div class="row"><span>Deposit to reserve install (${d.deposit}%)</span><span class="mono">${money(dep)}</span></div>
      </div>
      <div class="doc-note">
        ${d.system === 'permanent'
          ? 'Permanent system includes color-matched track, commercial-grade RGBW nodes, smart controller, and the Glowline app — thousands of scenes for every holiday, no ladders ever again.'
          : 'Seasonal service includes professional install, all materials, mid-season service, and takedown with tidy off-season storage of your custom-cut set.'}
        Workmanship &amp; LED warranty included. Pricing reflects the roofline shown above.
      </div>
      <div class="doc-sign">
        <div class="line">Customer signature &amp; date</div>
        <div class="line">${escapeHtml(c.company || 'Your Company')}</div>
      </div>
    </div>`;
  }

  function openProposal() {
    const custForm = document.getElementById('customerFormTpl').content.cloneNode(true);
    el.proposalBody.innerHTML = '';
    el.proposalBody.appendChild(custForm);
    const holder = document.createElement('div');
    holder.innerHTML = docHTML(docData());
    el.proposalBody.appendChild(holder.firstElementChild);

    // live-bind customer fields → re-render the document on each edit
    el.proposalBody.querySelectorAll('.cust-form input').forEach((inp) => {
      const key = inp.dataset.c; inp.value = state.customer[key] || '';
      inp.addEventListener('input', () => {
        state.customer[key] = inp.value;
        const doc = el.proposalBody.querySelector('.doc');
        const fresh = document.createElement('div'); fresh.innerHTML = docHTML(docData());
        doc.replaceWith(fresh.firstElementChild);
        persistDraft();
      });
    });
    el.proposalScrim.hidden = false;
  }

  /* ---------- shareable read-only proposal link (no backend) ---------- */
  $('#btnShare').addEventListener('click', shareProposal);

  async function shareProposal() {
    let url;
    try {
      const enc = await encodeShare(docData());
      url = location.origin + location.pathname + '#p=' + enc;
    } catch (e) { toast('Could not build share link'); return; }
    try { await navigator.clipboard.writeText(url); toast('Share link copied — send it to your customer', true); return; }
    catch (e) { /* clipboard blocked — fall back to manual copy */ }
    try { window.prompt('Copy this proposal link:', url); }
    catch (e) { toast('Share link ready — copy is blocked in this view'); }
  }

  // gzip (native CompressionStream) → base64url, with a plain-base64 fallback
  async function encodeShare(obj) {
    const json = JSON.stringify(obj);
    if (typeof CompressionStream === 'function') {
      const cs = new CompressionStream('gzip');
      const buf = await new Response(new Blob([json]).stream().pipeThrough(cs)).arrayBuffer();
      return 'g' + b64urlFromBytes(new Uint8Array(buf));
    }
    return 'r' + b64urlFromBytes(new TextEncoder().encode(json));
  }
  async function decodeShare(str) {
    const tag = str[0], body = str.slice(1);
    const bytes = bytesFromB64url(body);
    if (tag === 'g' && typeof DecompressionStream === 'function') {
      const ds = new DecompressionStream('gzip');
      const text = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
      return JSON.parse(text);
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function b64urlFromBytes(bytes) {
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function bytesFromB64url(b64) {
    const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function toast(msg, good) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false; t.classList.toggle('good', !!good);
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(toast._t); toast._t = setTimeout(() => {
      t.classList.remove('show'); setTimeout(() => { t.hidden = true; }, 220);
    }, 2600);
  }

  // full-page, customer-facing proposal opened from a #p= link
  async function renderShared(enc) {
    let d;
    try { d = await decodeShare(enc); } catch (e) { return false; }
    document.querySelector('.topbar').style.display = 'none';
    document.querySelector('.workspace').style.display = 'none';
    const co = (d.customer && d.customer.company) || 'Your lighting pro';
    const view = document.getElementById('sharedView');
    view.hidden = false;
    view.innerHTML = `
      <div class="shared-top">
        <div class="brand"><span class="brand-node"></span><span class="brand-word">Glowline</span></div>
        <div style="font-size:12.5px;color:var(--frost-dim)">Proposal from <strong style="color:var(--frost)">${escapeHtml(co)}</strong></div>
      </div>
      <div class="shared-wrap">${docHTML(d)}</div>
      <div id="sharedCtaWrap" class="shared-cta">
        <button class="cta-btn" id="sharedAccept">Accept &amp; request install</button>
        <button class="ghost-btn" id="sharedPrint">Save as PDF</button>
      </div>
      <div class="shared-foot">Presented with <a href="${location.origin + location.pathname.replace(/[^/]*$/, '')}" target="_blank" rel="noopener">Glowline</a> — light design for installers.</div>`;
    document.getElementById('sharedPrint').addEventListener('click', () => window.print());
    document.getElementById('sharedAccept').addEventListener('click', () => {
      const cust = (d.customer || {});
      const phone = (cust.companyPhone || '').trim();
      const email = (cust.companyEmail || '').trim();
      const name = cust.name || 'A customer';
      const msg = `Hi ${co} — this is ${name}. I'd like to accept the lighting proposal (${d.feet} ft, ${money(d.total != null ? d.total : 0)}). Let's schedule the install.`;
      let href = null;
      if (email) href = 'mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent('Accepting your lighting proposal') + '&body=' + encodeURIComponent(msg);
      else if (phone) href = 'sms:' + phone.replace(/[^0-9+]/g, '') + '?&body=' + encodeURIComponent(msg);
      if (href) { try { window.location.href = href; } catch (e) {} }
      const reach = email ? `email ${escapeHtml(email)}` : (phone ? `text ${escapeHtml(phone)}` : `reach out`);
      document.getElementById('sharedCtaWrap').outerHTML =
        `<div class="shared-accepted">Thanks — you accepted ${escapeHtml(co)}'s proposal.${email || phone ? ` Your message app should open to ${reach}; if not, just ${reach} to lock in your install.` : ` ${escapeHtml(co)} will reach out to schedule your install.`}</div>`;
    });
    return true;
  }

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }

  /* =========================================================================
     CREW / MATERIALS SHEET  (internal — a bill of materials from the trace)
     ========================================================================= */
  $('#btnCrew').addEventListener('click', openCrew);
  $('#btnCloseCrew').addEventListener('click', () => { $('#crewScrim').hidden = true; });
  $('#btnCrewPrint').addEventListener('click', () => window.print());
  $('#crewScrim').addEventListener('click', (e) => { if (e.target === $('#crewScrim')) $('#crewScrim').hidden = true; });

  function runFeet(run) { return state.scale.pxPerFoot ? runPixels(run.points) / state.scale.pxPerFoot : 0; }

  function openCrew() {
    const runs = tracedRuns();
    if (!runs.length || !state.scale.pxPerFoot) { toast('Trace a roofline and set the scale first'); return; }
    const L = polylineFeet();
    const N = totalNodes();
    const corners = runs.reduce((s, r) => s + Math.max(0, r.points.length - 2), 0);
    const drops = runs.length;
    const sticks = Math.ceil(L / 10);
    const clips = Math.ceil(L * 0.8);                 // ~1 every 16"
    const endCaps = drops * 2;
    const injections = Math.max(drops, Math.ceil(L / 50));
    const watts = Math.ceil(N * 0.9);                 // ~0.9 W per RGBW node
    const psu = Math.ceil((watts * 1.2) / 60) * 60;   // size up 20%, 60 W increments

    const rows = [
      ['Roofline channel / track', `${Math.ceil(L)} ft`, `≈ ${sticks} × 10 ft sticks`],
      ['LED nodes (12&quot; spacing)', `${N}`, `${(N / Math.max(1, L)).toFixed(1)} per ft`],
      ['Mounting clips', `${clips}`, '~1 every 16 in'],
      ['Corner / bend connectors', `${corners}`, 'interior vertices'],
      ['End caps', `${endCaps}`, '2 per run'],
      ['Lead / drop wires', `${drops}`, '1 per run'],
      ['Power injection points', `${injections}`, '1 per ~50 ft, min 1/run'],
    ];
    if (state.system === 'permanent') {
      rows.push(['Power supply', `${psu} W`, `~${watts} W load + headroom`]);
      rows.push(['Smart controller', '1', 'Glowline app + scenes']);
    }

    const rowHTML = rows.map((r) =>
      `<tr><td><strong>${r[0]}</strong></td><td class="r">${r[1]}</td><td class="desc">${r[2]}</td></tr>`).join('');

    const perRun = runs.map((r, i) => {
      const spacing = Math.max(13, state.imgW / 62);
      const nodes = sampleBulbs(r.points, spacing).length;
      return `<tr><td>Run ${i + 1}</td><td class="r">${Math.round(runFeet(r))} ft</td><td class="r">${nodes} nodes</td><td class="desc">${r.points.length - 1} segment${r.points.length - 1 === 1 ? '' : 's'}</td></tr>`;
    }).join('');

    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    $('#crewBody').innerHTML = `<div class="doc" style="-webkit-print-color-adjust:exact;print-color-adjust:exact">
      <div class="doc-top">
        <div>
          <div class="doc-co">${escapeHtml(state.projectName || 'Roofline')}</div>
          <div class="doc-badge"><span class="dot"></span>${state.system === 'permanent' ? 'Permanent' : 'Seasonal'} · Install &amp; materials</div>
        </div>
        <div class="doc-meta">
          <div>${escapeHtml(state.customer.address || '')}</div>
          <div>${today}</div>
          <div><strong>${Math.round(L)} ft</strong> · ${N} nodes · ${drops} run${drops > 1 ? 's' : ''}</div>
        </div>
      </div>
      <h2>Bill of materials</h2>
      <table class="doc-table"><tbody>${rowHTML}</tbody></table>
      <h2>Per-run breakdown</h2>
      <table class="doc-table"><tbody>${perRun}</tbody></table>
      <div class="doc-note">
        Quantities are estimated from the traced roofline and standard spacing — confirm on site before pulling stock.
        Power supply sized at ~0.9 W/node plus 20% headroom. Add a run for any section the crew mounts separately.
      </div>
    </div>`;
    $('#crewScrim').hidden = false;
  }

  /* =========================================================================
     SAVE / LOAD (localStorage)
     ========================================================================= */
  const DRAFT_KEY = 'glowline.draft';
  const LIST_KEY = 'glowline.projects';

  function snapshot() {
    return {
      id: state.id || (state.id = uid()),
      projectName: state.projectName, imgSrc: state.imgSrc, imgW: state.imgW, imgH: state.imgH,
      isDemo: state.isDemo, system: state.system, scene: state.scene, night: state.night, snap: state.snap,
      runs: state.runs, activeRun: state.activeRun, scale: { pxPerFoot: state.scale.pxPerFoot },
      lineItems: state.lineItems, tax: state.tax, deposit: state.deposit, customer: state.customer,
      savedAt: Date.now(), v: 2,
    };
  }

  let draftTimer = null;
  function persistDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(snapshot())); } catch (e) {}
    }, 250);
  }

  function loadInto(snap) {
    Object.assign(state, {
      id: snap.id, projectName: snap.projectName, imgSrc: snap.imgSrc, imgW: snap.imgW, imgH: snap.imgH,
      isDemo: snap.isDemo, system: snap.system, scene: snap.scene, night: snap.night,
      snap: snap.snap !== undefined ? snap.snap : true,
      activeRun: snap.activeRun || 0, tax: snap.tax, deposit: snap.deposit,
      customer: snap.customer || state.customer,
      lineItems: snap.lineItems || [],
    });
    // migrate v1 drafts (single `points` array) → runs
    state.runs = snap.runs || (snap.points ? [{ id: uid(), points: snap.points }] : [{ id: uid(), points: [] }]);
    if (!state.runs.length) state.runs = [{ id: uid(), points: [] }];
    state.activeRun = Math.min(state.activeRun, state.runs.length - 1);
    state.scale.pxPerFoot = snap.scale ? snap.scale.pxPerFoot : null;
    el.img.src = state.imgSrc;
    el.projectName.value = state.projectName;
    el.taxRate.value = state.tax; el.depositPct.value = state.deposit;
    [...el.systemSeg.children].forEach((c) => c.classList.toggle('is-active', c.dataset.system === state.system));
    setTool('trace');
    render();
  }

  // "Saved" drawer
  $('#btnSaved').addEventListener('click', () => {
    saveCurrentToList();
    renderSavedList();
    el.savedScrim.hidden = false;
  });
  $('#btnCloseSaved').addEventListener('click', () => { el.savedScrim.hidden = true; });
  el.savedScrim.addEventListener('click', (e) => { if (e.target === el.savedScrim) el.savedScrim.hidden = true; });

  function getList() { try { return JSON.parse(localStorage.getItem(LIST_KEY)) || []; } catch (e) { return []; } }
  function setList(l) { try { localStorage.setItem(LIST_KEY, JSON.stringify(l)); } catch (e) {} }

  function saveCurrentToList() {
    if (tracedRuns().length === 0) return; // nothing worth saving yet
    const list = getList();
    const snap = snapshot();
    const i = list.findIndex((x) => x.id === snap.id);
    if (i >= 0) list[i] = snap; else list.unshift(snap);
    setList(list.slice(0, 40));
  }

  function renderSavedList() {
    const list = getList();
    if (!list.length) { el.savedList.innerHTML = `<div class="saved-empty">No saved proposals yet.<br>Trace a roofline, then hit Saved to keep it here.</div>`; return; }
    el.savedList.innerHTML = list.map((s) => {
      const feet = estimateFeet(s);
      const when = new Date(s.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `<div class="saved-card">
        <img class="saved-thumb" src="${s.imgSrc}" alt="" />
        <div class="saved-info">
          <h4>${escapeHtml(s.projectName || 'Untitled')}</h4>
          <p>${feet} ft · ${SCENES[s.scene] ? SCENES[s.scene].name : 'Warm'} · ${when}</p>
        </div>
        <button class="saved-open" data-open="${s.id}">Open</button>
      </div>`;
    }).join('');
  }
  function estimateFeet(s) {
    if (!s.scale || !s.scale.pxPerFoot) return '—';
    const runs = s.runs || (s.points ? [{ points: s.points }] : []);
    let px = 0;
    for (const run of runs) {
      const pts = run.points || [];
      for (let i = 0; i < pts.length - 1; i++) px += Math.hypot(pts[i].x - pts[i + 1].x, pts[i].y - pts[i + 1].y);
    }
    if (!px) return '—';
    return Math.round(px / s.scale.pxPerFoot);
  }
  el.savedList.addEventListener('click', (ev) => {
    const id = ev.target.dataset.open; if (!id) return;
    const snap = getList().find((x) => x.id === id); if (!snap) return;
    loadInto(snap); el.savedScrim.hidden = true;
  });

  /* =========================================================================
     BOOT
     ========================================================================= */
  function initEditor() {
    el.img.src = state.imgSrc;
    // restore last draft if present
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) { const snap = JSON.parse(raw); if (snap && snap.imgSrc) { loadInto(snap); return; } }
    } catch (e) {}
    state.lineItems = defaultLineItems();
    render();
  }
  function boot() {
    if (location.hash.indexOf('#p=') === 0) {
      renderShared(location.hash.slice(3)).then((ok) => { if (!ok) initEditor(); });
      return;
    }
    initEditor();
  }
  el.img.addEventListener('load', () => { buildEdgeMap(); });
  boot();

  /* =========================================================================
     DEMO HOUSE — an inline dusk-lit suburban home with a clean roofline
     ========================================================================= */
  function demoHouseDataURI() {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${DEMO_W}' height='${DEMO_H}' viewBox='0 0 ${DEMO_W} ${DEMO_H}'>
      <defs>
        <linearGradient id='sky' x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0' stop-color='#243056'/><stop offset='0.55' stop-color='#3a3f63'/><stop offset='1' stop-color='#6b5a72'/>
        </linearGradient>
        <linearGradient id='wall' x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0' stop-color='#e9e2d4'/><stop offset='1' stop-color='#cdc4b2'/>
        </linearGradient>
        <linearGradient id='roof' x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0' stop-color='#4a4550'/><stop offset='1' stop-color='#332f39'/>
        </linearGradient>
        <linearGradient id='lawn' x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0' stop-color='#3b4a3a'/><stop offset='1' stop-color='#2a3630'/>
        </linearGradient>
      </defs>
      <rect width='${DEMO_W}' height='${DEMO_H}' fill='url(#sky)'/>
      <circle cx='980' cy='150' r='46' fill='#f3ead0' opacity='0.85'/>
      <circle cx='980' cy='150' r='70' fill='#f3ead0' opacity='0.12'/>
      ${starField()}
      <rect y='560' width='${DEMO_W}' height='200' fill='url(#lawn)'/>
      <!-- main house body -->
      <rect x='250' y='330' width='560' height='250' fill='url(#wall)'/>
      <!-- main gable roof -->
      <polygon points='230,335 530,190 830,335' fill='url(#roof)'/>
      <polygon points='230,335 530,190 530,205 246,346' fill='#5a5560' opacity='0.6'/>
      <!-- garage wing (lower) -->
      <rect x='770' y='420' width='300' height='160' fill='url(#wall)'/>
      <polygon points='752,425 920,330 1088,425' fill='url(#roof)'/>
      <!-- door + windows (warm interior glow) -->
      <rect x='500' y='450' width='60' height='130' fill='#5a4632'/>
      <rect x='300' y='400' width='70' height='80' fill='#ffd98a' opacity='0.85'/>
      <rect x='690' y='400' width='70' height='80' fill='#ffd98a' opacity='0.85'/>
      <rect x='860' y='470' width='120' height='90' fill='#3a3f4a'/>
      <line x1='920' y1='470' x2='920' y2='560' stroke='#2a2e38' stroke-width='4'/>
      <!-- chimney -->
      <rect x='430' y='230' width='40' height='80' fill='#3f3a44'/>
      <!-- trees -->
      <circle cx='150' cy='500' r='70' fill='#2c3a30'/><rect x='142' y='500' width='16' height='70' fill='#3a2f28'/>
      <circle cx='1120' cy='500' r='60' fill='#2c3a30'/><rect x='1113' y='500' width='14' height='70' fill='#3a2f28'/>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }
  function starField() {
    let s = '';
    for (let i = 0; i < 60; i++) {
      const x = Math.round(Math.random() * DEMO_W), y = Math.round(Math.random() * 300), r = (Math.random() * 1.3 + 0.3).toFixed(1);
      s += `<circle cx='${x}' cy='${y}' r='${r}' fill='#fff' opacity='${(Math.random() * 0.6 + 0.2).toFixed(2)}'/>`;
    }
    return s;
  }
})();
