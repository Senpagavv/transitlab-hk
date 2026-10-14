/* v7 · the hub (2026-10-15) — v3's cover and dot map, now the way into the five modes.
   Intro: title + tide bar over the territory's dot field. Scrolling (wheel, touch, ↓ / PgDn / Enter) carries it into
   the hub: the copy and the tide bar move away, the dot map settles centred behind, the top bar and the 01–05 menu
   slide in. Modes 01–04 put their levels on the map at real places (levels/registry.js; `hub.station` or
   `hub.lonlat`), opened one after another (shared/progress.js: a level opens when the one before it is passed).
   Clicking an open level gathers the dots round it into a board — as in v3 — and then goes to that mode's page
   (#map=<key>). 05 (the sandbox) only has its panel for now. A mode's «← Five modes» comes back with #hub=1&nav=N.
   Adapted from v3/hub.js; the cover, the scroll and the fly-in are v3's. */
(function () {
  'use strict';
  const CV = window.COVER, hub = document.getElementById('hub'), I = window.I18N, LV = window.TL_LEVELS, PR = window.TLProgress, ST = window.TL_STATIONS || {};
  if (!hub) return;
  const $ = id => document.getElementById(id), t = (k, v) => I.t(k, v), root = document.documentElement, body = document.body;
  const q = new URLSearchParams(location.hash.slice(1));
  const clamp = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const easeInOut = u => u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  const easeOut = u => 1 - Math.pow(1 - u, 3);
  const grp = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const hh = x => (x < 10 ? '0' + x : '' + x) + ':00';
  // the modes: where each one's page is (the bundled single file when the hub itself is one)
  const MODES = [null,
    { n: 1, en: 'Stations & walking', dir: 'mode1-bus', file: '模式1-车站与步行.html' },
    { n: 2, en: 'The metro', dir: 'mode2-metro', file: '模式2-地铁.html' },
    { n: 3, en: 'Roads that jam', dir: 'mode3-roads', file: '模式3-路会塞.html' },
    { n: 4, en: 'Station-side development', dir: 'mode4-tod', file: '模式4-站旁开发.html' },
    { n: 5, en: 'Sandbox', soon: true }];
  const bundled = !/index\.html$|\/$/.test(location.pathname);
  function rgba(c) {                            // '#RRGGBB' or 'rgba(r,g,b,a)' → [r,g,b,a]
    c = String(c).trim();
    if (c.charAt(0) === '#') { const n = parseInt(c.slice(1, 7), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255, 1]; }
    const m = c.match(/[\d.]+/g) || [0, 0, 0, 1]; return [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]];
  }
  const css = name => getComputedStyle(root).getPropertyValue(name).trim();

  /* ---- the dot field (the suite's data) ---- */
  function b64u8(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function b64u16(s) { const b = b64u8(s); return new Uint16Array(b.buffer, b.byteOffset, b.byteLength >> 1); }
  function runsToPath(bytes, cols, rows, step) {
    const p = new Path2D();
    for (let j = 0; j < rows; j++) {
      let run = -1;
      for (let i = 0; i <= cols; i++) {
        const k = j * cols + i, on = i < cols && ((bytes[k >> 3] >> (k & 7)) & 1);
        if (on && run < 0) run = i;
        else if (!on && run >= 0) { p.rect(run * step, j * step, (i - run) * step, step); run = -1; }
      }
    }
    return p;
  }
  const DOTS = (function () {
    const idx = b64u16(CV.dotsI), val = b64u16(CV.dotsV), zi = b64u16(CV.dotZ), n = idx.length;
    const x = new Float32Array(n), y = new Float32Array(n), v = new Float32Array(n), z = new Int16Array(n);
    for (let k = 0; k < n; k++) {
      const c = idx[k];
      x[k] = (c % CV.dcols + 0.5) * CV.STEP; y[k] = ((c / CV.dcols) | 0) * CV.STEP + 0.5 * CV.STEP;
      v[k] = val[k] / 65535; z[k] = zi[k] === 65535 ? -1 : zi[k];
    }
    return { n, x, y, v, z };
  })();
  const LAND = runsToPath(b64u8(CV.land), CV.cols, CV.rows, CV.BORDER_STEP);
  const COAST = new Path2D(); COAST.addPath(new Path2D(CV.coast), new DOMMatrix([0.5, 0, 0, 0.5, 0, 0]));
  const LANDX = [Infinity, -Infinity];             // west and east edge of the dot field, in map units
  for (let i = 0; i < DOTS.n; i++) { if (DOTS.x[i] < LANDX[0]) LANDX[0] = DOTS.x[i]; if (DOTS.x[i] > LANDX[1]) LANDX[1] = DOTS.x[i]; }
  const G = CV.geom, mapXY = (lon, lat) => [lon * G.kx * G.scale + G.offx, -lat * G.scale + G.offy];

  const TIDE = CV.tide.factor24, FLOW = CV.tide.flow24, SPEED = CV.tide.speed24;
  let PH = 0, LH = 0;
  for (let h = 0; h < 24; h++) { if (TIDE[h] > TIDE[PH]) PH = h; if (TIDE[h] < TIDE[LH]) LH = h; }
  const FMAX = TIDE[PH], baseMax = CV.baseMax;
  const tOf = v => Math.log(1 + v) / Math.log(1 + baseMax * FMAX);
  const POSV = [];
  for (let k = 0; k < DOTS.n; k++) if (DOTS.v[k] * baseMax > 0.5) POSV.push(DOTS.v[k] * baseMax * FMAX);
  POSV.sort((a, b) => a - b);
  const TREF = Math.max(0.05, tOf(POSV[Math.floor(POSV.length * 0.85)] || baseMax));
  const tVis = v => { const x = Math.min(1, tOf(v) / TREF); return x * x * (1.9 - 0.9 * x); };

  /* ---- the levels on the map ---- */
  const nameOf = o => !o ? '' : typeof o === 'string' ? o : (o[I.lang] || o['zh-Hant'] || o.en || '');
  const km = (a, b) => Math.hypot((a[0] - b[0]) * 102.6, (a[1] - b[1]) * 110.9);
  const stationAt = name => ST[String(name || '').replace(/站$/, '')] || null;
  let SITES = [];
  // a mode's levels in order, each at its station; two closer than 1.5 km: the later one moves to the nearest station
  // nobody uses, so every level gets its own place on the map
  function sitesOf(n) {
    const out = [];
    for (const l of (LV && n >= 1 && n <= 4 ? LV.mode(n) : [])) {
      let ll = l.hub && l.hub.lonlat ? l.hub.lonlat : stationAt(l.hub && l.hub.station);
      if (!ll) continue;
      if (out.some(s => km([s.lon, s.lat], ll) < 1.5)) {
        const free = Object.values(ST).filter(c => out.every(s => km([s.lon, s.lat], c) >= 1.5)).sort((a, b) => km(a, ll) - km(b, ll));
        if (free.length) ll = free[0];
      }
      const prev = out[out.length - 1];
      out.push({ key: l.key, mode: n, title: l.title, challenge: !!l.challenge, lon: ll[0], lat: ll[1], station: (l.hub && l.hub.station) || '',
        open: PR ? PR.open(n, l.key) : true, prog: PR ? PR.get(n, l.key) : null, prev: prev ? prev.title : null, i: out.length + 1,
        side: (l.hub && l.hub.side) || 'right' });
    }
    return out;
  }
  const site = key => SITES.find(s => s.key === key);
  const progLine = s => s.prog && s.prog.tier ? t('hub.tier' + s.prog.tier) + ' · ' + t('hub.best', { n: grp(s.prog.best) }) : '';
  const kindLine = s => s.challenge ? t('hub.challenge') : t('hub.teach');

  /* ---- state ---- */
  // mode: 'cover' (intro ↔ hub, driven by p), 'leaving' (the map fades round the level's dots), 'entering' (its page opens)
  let mode = 'cover', p = 0, target = 0, frozen = false, nav = 0, hot = null, hour = LH, riseRaf = 0, loopRaf = 0, runId = 0;
  const cv = $('cvDots'), ctx = cv.getContext('2d');
  const light = () => root.getAttribute('data-theme') !== 'dark';
  const chromeH = () => $('topbar').offsetHeight + $('navrow').offsetHeight;
  // Intro: the territory fills the screen from the right (centred on narrow screens). Hub: the whole territory,
  // centred in the space under the menu. Between them the geometry follows the scroll.
  function gIntro(w, h) {
    const s = w / h > CV.W / CV.H ? w / CV.W : h / CV.H;
    return w < 1024 ? { s, ox: (w - CV.W * s) / 2, oy: (h - CV.H * s) / 2 } : { s, ox: w - CV.W * s, oy: (h - CV.H * s) / 2 };
  }
  function gHub(w, h) {
    const top = chromeH() + 6, pad = w < 760 ? 8 : 24, bot = w < 760 ? 210 : 14, aw = w - 2 * pad, ah = Math.max(160, h - top - bot);
    const s = Math.min(aw / CV.W, ah / CV.H);
    let ox = (w - CV.W * s) / 2;
    // centred, but nudged right just enough that the glass panel does not cover the west of the territory
    const panel = w >= 760 ? $('hubPanel').offsetLeft + $('hubPanel').offsetWidth + 14 : 0, west = ox + LANDX[0] * s;
    if (panel > west) ox = Math.min(ox + panel - west, w - pad - LANDX[1] * s);
    return { s, ox, oy: top + (ah - CV.H * s) / 2 };
  }
  function geom() {
    const w = cv.clientWidth, h = cv.clientHeight, a = gIntro(w, h), b = gHub(w, h), e = easeInOut(p);
    return { s: a.s + (b.s - a.s) * e, ox: a.ox + (b.ox - a.ox) * e, oy: a.oy + (b.oy - a.oy) * e };
  }
  const screenXY = (lon, lat, g) => { const [x, y] = mapXY(lon, lat); return [g.ox + x * g.s, g.oy + y * g.s]; };
  function size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    return dpr;
  }
  // The territory: land, coast and the dot field. `alpha` fades it; `skip` leaves out dots that are flying.
  function drawMap(alpha, skip, g) {
    const dpr = size(), L = light(), m = TIDE[hour];
    g = g || geom();
    const k = g.s * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.setTransform(k, 0, 0, k, g.ox * dpr, g.oy * dpr);
    ctx.fillStyle = L ? '#FFFFFF' : '#1B1B1B'; ctx.fill(LAND);
    ctx.strokeStyle = L ? 'rgba(14,122,78,.85)' : 'rgba(110,217,150,.6)'; ctx.lineWidth = 1.1 / k; ctx.stroke(COAST);
    const RGBA = 'rgba(' + (L ? '10,10,10' : '245,245,245') + ',';
    for (let i = 0; i < DOTS.n; i++) {
      if (skip && skip[i]) continue;
      const val = DOTS.v[i] * baseMax * m;
      if (val <= 0.5) continue;
      const v = tVis(val);
      ctx.fillStyle = RGBA + (0.09 + 0.91 * v).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(DOTS.x[i], DOTS.y[i], 1.05 + 1.35 * v, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  const draw = () => { if (mode === 'cover') drawMap(1); };

  /* ---- hover: one zone card ---- */
  (function () {
    const tip = $('cvTip');
    cv.addEventListener('pointermove', function (e) {
      if (mode !== 'cover') return;
      const rect = cv.getBoundingClientRect(), g = geom(), x = (e.clientX - rect.left - g.ox) / g.s, y = (e.clientY - rect.top - g.oy) / g.s;
      let best = -1, bd = 256;
      for (let i = 0; i < DOTS.n; i++) { const dx = DOTS.x[i] - x, dy = DOTS.y[i] - y, d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = i; } }
      const z = best >= 0 ? DOTS.z[best] : -1;
      if (z < 0) { tip.classList.remove('on'); return; }
      const m = CV.zones[z];
      tip.innerHTML = '<div class="tt">' + m.l + ' <span class="tc">' + I.district(CV.distNames[m.di] || '') + '</span></div><div class="tv"><span>' + t('cv.trips') + '</span><b>' + grp(m.ti * TIDE[hour] / FMAX) + '</b></div>';
      tip.classList.add('on');
      let lx = e.clientX - rect.left + 14; const ly = e.clientY - rect.top + 12;
      if (lx + tip.offsetWidth > rect.width - 6) lx = e.clientX - rect.left - tip.offsetWidth - 14;
      tip.style.left = lx + 'px'; tip.style.top = Math.max(6, Math.min(ly, rect.height - tip.offsetHeight - 6)) + 'px';
    });
    cv.addEventListener('pointerleave', () => tip.classList.remove('on'));
  })();

  /* ---- the tide bar ---- */
  let TW = 600, TH = 46;
  const PAD = { t: 10, b: 8, l: 6, r: 6 };
  const TX = i => PAD.l + i / 23 * (TW - PAD.l - PAD.r);
  const TY = v => PAD.t + (TH - PAD.t - PAD.b) * (1 - v / (FMAX * 1.06));
  function renderTide() {
    const mid = $('cvTide'), rect = mid.getBoundingClientRect();
    TW = Math.max(220, Math.round(rect.width)); TH = Math.max(40, Math.round(rect.height));
    mid.setAttribute('viewBox', '0 0 ' + TW + ' ' + TH); mid.setAttribute('preserveAspectRatio', 'none');
    let line = '';
    for (let j = 0; j < 24; j++) line += (j ? 'L' : 'M') + TX(j).toFixed(1) + ' ' + TY(TIDE[j]).toFixed(1);
    const area = line + ' L' + TX(23).toFixed(1) + ' ' + (TH - PAD.b) + ' L' + TX(0).toFixed(1) + ' ' + (TH - PAD.b) + ' Z';
    let s = '<defs><linearGradient id="cvtg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--s-accent);stop-opacity:.38"/><stop offset="1" style="stop-color:var(--s-accent);stop-opacity:.02"/></linearGradient></defs>';
    s += '<path d="' + area + '" fill="url(#cvtg)"/>';
    s += '<line x1="' + PAD.l + '" y1="' + TY(1).toFixed(1) + '" x2="' + (TW - PAD.r) + '" y2="' + TY(1).toFixed(1) + '" style="stroke:var(--s-line2)" stroke-width="1" stroke-dasharray="3 4"/>';
    s += '<path d="' + line + '" fill="none" style="stroke:var(--s-accent)" stroke-width="1.7" stroke-linejoin="round"/>';
    s += '<circle cx="' + TX(PH) + '" cy="' + TY(TIDE[PH]).toFixed(1) + '" r="3.2" style="fill:var(--s-ink)"/>';
    s += '<text x="' + TX(PH) + '" y="' + (TY(TIDE[PH]) - 7).toFixed(1) + '" text-anchor="middle" style="fill:var(--s-ink);font:500 10px Geist Mono,monospace">high ' + hh(PH) + '</text>';
    s += '<circle cx="' + TX(LH) + '" cy="' + TY(TIDE[LH]).toFixed(1) + '" r="2.8" fill="none" style="stroke:var(--s-ink2)" stroke-width="1.3"/>';
    s += '<text x="' + TX(LH) + '" y="' + (TY(TIDE[LH]) + 14).toFixed(1) + '" text-anchor="middle" style="fill:var(--s-ink2);font:500 10px Geist Mono,monospace">low ' + hh(LH) + '</text>';
    s += '<g id="cvPh"></g>';
    mid.innerHTML = s; playhead();
  }
  function playhead() {
    const g = $('cvPh'); if (!g) return;
    const x = TX(hour).toFixed(1), y = TY(TIDE[hour]).toFixed(1);
    g.innerHTML = '<line x1="' + x + '" y1="0" x2="' + x + '" y2="' + (TH - PAD.b) + '" style="stroke:var(--s-accent2)" stroke-width="1.3"/>' +
      '<circle cx="' + x + '" cy="' + y + '" r="4.2" style="fill:var(--s-accent2);stroke:var(--s-paper)" stroke-width="1.6"/>';
  }
  (function () {                                // scrub the curve
    const mid = $('cvTide'); let drag = false;
    function set(e) { const rc = mid.getBoundingClientRect(); stopRise(); setHour(Math.round(clamp((e.clientX - rc.left) / rc.width) * 23)); }
    mid.addEventListener('pointerdown', e => { drag = true; mid.setPointerCapture(e.pointerId); set(e); });
    mid.addEventListener('pointermove', e => { if (drag) set(e); });
    mid.addEventListener('pointerup', () => { drag = false; });
  })();
  const phaseTxt = x => t(x === PH ? 'cv.crest' : x === LH ? 'cv.trough' : TIDE[x] >= 1 ? 'cv.rising' : 'cv.ebbing');
  function setHour(x) {
    hour = Math.max(0, Math.min(23, x));
    $('cvHour').textContent = hh(hour); $('cvPhase').textContent = phaseTxt(hour);
    $('cvFlow').textContent = grp(FLOW[hour]); $('cvSpeed').textContent = SPEED[hour].toFixed(1);
    playhead(); draw();
  }
  function stopRise() { if (riseRaf) { cancelAnimationFrame(riseRaf); riseRaf = 0; } }
  function rise() {                             // 03:00 ebb lifts to the 18:00 crest, then rests
    stopRise();
    const t0 = performance.now(), from = hour === PH ? LH : hour;
    (function step(now) {
      let u = Math.min(1, (now - t0) / 2600); u = 0.5 - 0.5 * Math.cos(Math.PI * u);
      setHour(Math.round(from + (PH - from) * u));
      riseRaf = u < 1 ? requestAnimationFrame(step) : 0;
    })(t0);
  }
  $('cvPlay').addEventListener('click', rise);

  /* ---- scroll: intro ↔ hub ---- */
  function applyP() {
    hub.style.setProperty('--hub-p', p.toFixed(4));
    const qv = mode === 'cover' ? clamp((p - .3) / .7) : 1;
    root.style.setProperty('--hub-q', qv.toFixed(4)); root.style.setProperty('--chrome-h', chromeH() + 'px');
    body.classList.toggle('chrome-off', qv < .5);
    hub.classList.toggle('past', p > .5);
    const open = p > .97;
    if (open !== hub.classList.contains('open')) { hub.classList.toggle('open', open); renderNav(); }
    draw();
    if (open) placeMarks();
  }
  function tick() {
    loopRaf = 0;
    if (!frozen) { const d = target - p; p = Math.abs(d) < .002 ? target : p + d * .12; }
    applyP();
    if (p !== target && !frozen) loopRaf = requestAnimationFrame(tick);
  }
  const kick = () => { if (!loopRaf) loopRaf = requestAnimationFrame(tick); };
  // One gesture opens or closes all the way: started from the intro, any scroll opens; from the hub, scrolling up closes.
  let gesture = null, gestureTimer = 0, closedAt = -1e9;
  function endGesture() {
    const g = gesture; gesture = null;
    if (g === 'open') target = target > .1 ? 1 : 0; else if (g === 'close') { target = target < .9 ? 0 : 1; if (!target) closedAt = performance.now(); }
    kick();
  }
  function nudge(d) {
    // a notched wheel turned slowly sends one event per notch, each its own gesture: the notches after the one that
    // closed must not count as "any scroll opens", or scrolling up bounces straight back to the map. Each such notch
    // extends the pause, so only an upward scroll after a real stop (1.2 s) opens again.
    if (!gesture && target < .5 && d < 0 && performance.now() - closedAt < 1200) { closedAt = performance.now(); return; }
    if (!gesture) gesture = target < .5 ? 'open' : 'close';
    if (gesture === 'open') target = clamp(target + Math.abs(d) / 650);
    else if (d < 0) target = clamp(target + d / 650);
    clearTimeout(gestureTimer); gestureTimer = setTimeout(endGesture, 170);
    kick();
  }
  const blocked = () => mode !== 'cover' || frozen || document.querySelector('dialog[open]');
  window.addEventListener('wheel', function (e) {
    if (blocked() || e.target.closest && e.target.closest('.hub-panel')) return;
    e.preventDefault();
    nudge(e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1));
  }, { passive: false });
  let ty = null;
  hub.addEventListener('touchstart', e => { ty = e.touches[0].clientY; }, { passive: true });
  hub.addEventListener('touchmove', function (e) {
    if (ty === null || blocked() || e.target.closest('.hub-panel,.cv-mid')) return;
    const y = e.touches[0].clientY, d = ty - y; ty = y;
    if (!gesture) gesture = target < .5 ? 'open' : 'close';
    if (gesture === 'open' ? d > 0 : d < 0) nudge(d * 1.6);
    e.preventDefault();
  }, { passive: false });
  hub.addEventListener('touchend', () => { ty = null; });
  document.addEventListener('keydown', function (e) {
    if (blocked()) return;
    const k = e.key, onButton = e.target.closest && e.target.closest('button,a,input');
    if (target < .5 && (['ArrowDown', 'PageDown'].includes(k) || ([' ', 'Enter'].includes(k) && !onButton))) { e.preventDefault(); target = 1; kick(); }
    else if (target > .5 && ['ArrowUp', 'PageUp'].includes(k)) { e.preventDefault(); target = 0; kick(); }
    else if (target > .5 && nav === 0 && k === 'Enter' && !onButton) { e.preventDefault(); selectNav(1); }
  });
  $('cvHint').addEventListener('click', () => { target = 1; kick(); });

  /* ---- the 01–05 menu and the glass panel ---- */
  function buildNav() {
    const el = $('navrow'); el.setAttribute('aria-label', t('nav.aria'));
    el.innerHTML = MODES.slice(1).map(m => '<button data-mode="' + m.n + '" aria-selected="false"' + (m.soon ? ' class="soon"' : '') + '><i class="stop">0' + m.n +
      '</i><span class="t"><b>' + m.en + '</b><s>' + t('nav.m' + m.n) + '</s></span></button>').join('');
    el.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => selectNav(+b.dataset.mode)));
    renderNav();
  }
  function renderNav() {
    document.querySelectorAll('#navrow [data-mode]').forEach(b => {
      const m = +b.dataset.mode;
      b.setAttribute('aria-selected', String(mode === 'cover' && p > .5 && m === nav || mode === 'leaving' && m === nav));
      b.classList.toggle('invite', mode === 'cover' && hub.classList.contains('open') && nav === 0 && m === 1);
    });
  }
  function selectNav(n) {
    if (mode !== 'cover') return;
    nav = n; target = 1; kick();
    hub.classList.toggle('m1', nav >= 1 && nav <= 4); hot = null;
    SITES = sitesOf(nav); buildMarks();
    renderNav(); renderPanel();
  }
  function levelButton(s) {
    const pl = progLine(s);
    return '<button class="lv' + (s.open ? '' : ' locked') + '" data-site="' + s.key + '"><span class="lv-n"><b>' + s.i + ' · ' + nameOf(s.title) + '</b><small>' + (s.station || '') + '</small></span>' +
      '<span class="lv-m">' + (s.open ? kindLine(s) + (pl ? ' · <em>' + pl + '</em>' : '') : '🔒 ' + t('hub.locked')) + '</span></button>';
  }
  const tc = s => I.lang === 'en' ? '' : '<span class="hp-tc">' + s + '</span>';
  // one round kept half-played (shared/save.js): «continue» on top of the panel, whatever the mode
  const saved = () => { const v = window.TL_SAVE && window.TL_SAVE.get(); return v && LV && LV.get(v.mode, v.key) ? v : null; };
  const savedTitle = () => { const v = saved(); return v ? nameOf(LV.get(v.mode, v.key).title) : ''; };
  function resumeBlock() {
    const v = saved(); if (!v) return '';
    return '<button class="lv resume" id="hubResume"><span class="lv-n"><b>⏵ ' + t('save.resume') + ' · ' + savedTitle() + '</b><small>0' + v.mode + ' · ' + MODES[v.mode].en + '</small></span>' +
      '<span class="lv-m"><em>' + window.TL_SAVE.line(v) + '</em></span></button>';
  }
  function resume() {
    const v = saved(); if (!v || mode !== 'cover') return;
    if (nav !== v.mode) { nav = v.mode; hub.classList.toggle('m1', true); SITES = sitesOf(nav); buildMarks(); renderNav(); renderPanel(); }
    const s = site(v.key); if (s) handoff(s);
  }
  function renderPanel() {
    let h;
    if (nav === 0) h = '<span class="lbl">' + t('hub.start') + '</span><h2 class="hp-h">' + t('hub.pickH') + ' <span class="hp-up">↑</span></h2><p class="note">' + t('hub.pickP') + '</p>';
    else if (nav <= 4) {
      h = '<span class="lbl">Mode 0' + nav + ' · ' + MODES[nav].en + '</span><h2 class="hp-h">' + MODES[nav].en + tc(t('hub.m' + nav + 'H')) + '</h2><p class="note">' + t('hub.m' + nav + 'P') + '</p>' +
        '<div class="lbl hp-sub">' + t('hub.levels') + '</div><div class="lvls">' + SITES.map(levelButton).join('') + '</div>' +
        '<div class="hp-detail" id="hubDetail" aria-live="polite"></div>' +
        '<div class="hp-legend"><span><i class="k st-play"></i>' + t('hub.play') + '</span><span><i class="k st-soon"></i>' + t('hub.locked') + '</span></div>';
    } else h = '<span class="lbl">Mode 05 · Sandbox</span><h2 class="hp-h">Sandbox' + tc(t('hub.m5H')) + '</h2>' +
      '<span class="chip"><i></i>' + t('hub.first') + '</span><p class="note">' + t('hub.m5P') + '</p>' +
      '<div class="lvls"><a class="lv" id="hubSandbox" href="mode5-sandbox/index.html"><span class="lv-n"><b>' + t('hub.m5b') + ' →</b></span><span class="lv-m">' + t(location.protocol === 'file:' ? 'hub.m5file' : 'hub.m5open') + '</span></a>' +
      (location.protocol === 'file:' ? '' : '<a class="lv" id="hubLive" href="/"><span class="lv-n"><b>' + t('hub.m5live') + ' →</b></span><span class="lv-m">' + t('hub.m5liveP') + '</span></a>') +
      ['m5a', 'm5c'].map(k => '<button class="lv locked" disabled><span class="lv-n"><b>' + t('hub.' + k) + '</b></span><span class="lv-m">' + t('hub.coming') + '</span></button>').join('') + '</div>';
    $('hubPanel').innerHTML = resumeBlock() + h;
    const rb = $('hubResume'); if (rb) rb.addEventListener('click', resume);
    $('hubPanel').querySelectorAll('.lv[data-site]').forEach(b => {
      b.addEventListener('click', () => play(b.dataset.site));
      b.addEventListener('pointerenter', () => setHot(b.dataset.site)); b.addEventListener('focus', () => setHot(b.dataset.site));
      b.addEventListener('pointerleave', () => setHot(null)); b.addEventListener('blur', () => setHot(null));
    });
    renderDetail();
  }
  let lockedMsg = null;
  function renderDetail() {
    const el = $('hubDetail'); if (!el) return;
    const s = hot && site(hot);
    if (!s) { el.innerHTML = '<p class="hp-idle">' + (lockedMsg || t('hub.hover')) + '</p>'; return; }
    const pl = progLine(s);
    el.innerHTML = '<div class="hp-dh"><b>' + nameOf(s.title) + '</b><span class="tag st-' + (s.open ? 'play' : 'soon') + '">' + (s.open ? kindLine(s) : '🔒 ' + t('hub.locked')) + '</span></div>' +
      '<p>' + (s.open ? t(s.challenge ? 'hub.challengeP' : 'hub.teachP') : t('hub.lockedP', { p: nameOf(s.prev) })) + '</p>' + (pl ? '<p class="mono hp-tiers">' + pl + '</p>' : '');
  }
  function setHot(key) {
    hot = key; if (key) lockedMsg = null; renderDetail();
    $('hubMarks').querySelectorAll('.hm').forEach(el => el.classList.toggle('hot', el.dataset.site === key));
    $('hubPanel').querySelectorAll('.lv').forEach(el => el.classList.toggle('hot', el.dataset.site === key));
  }

  /* ---- markers on the map ---- */
  function buildMarks() {
    $('hubMarks').innerHTML = SITES.map((s, i) => {
      const sub = window.TL_SAVE && window.TL_SAVE.is(s.mode, s.key) ? t('save.mark') : s.open ? kindLine(s) + (progLine(s) ? ' · ' + progLine(s) : '') : '🔒 ' + t('hub.locked');
      return '<button class="hm st-' + (s.open ? 'play' : 'soon') + '" data-site="' + s.key + '" data-side="' + s.side + '" style="--i:' + i + '"' +
        ' aria-label="' + nameOf(s.title) + ' · ' + sub + '"><i class="pin"></i><span class="lab"><b>' + s.i + ' · ' + nameOf(s.title) + '</b><small>' + sub + '</small></span></button>';
    }).join('');
    $('hubMarks').querySelectorAll('.hm').forEach(el => {
      el.addEventListener('click', () => play(el.dataset.site));
      el.addEventListener('pointerenter', () => setHot(el.dataset.site)); el.addEventListener('focus', () => setHot(el.dataset.site));
      el.addEventListener('pointerleave', () => setHot(null)); el.addEventListener('blur', () => setHot(null));
    });
    placeMarks();
  }
  function placeMarks() {
    const g = geom();
    $('hubMarks').querySelectorAll('.hm').forEach(el => {
      const s = site(el.dataset.site); if (!s) return;
      const [x, y] = screenXY(s.lon, s.lat, g);
      el.style.left = x.toFixed(1) + 'px'; el.style.top = y.toFixed(1) + 'px';
    });
  }

  /* ---- the hand-off: the map fades, the dots round the level stay; the level's page flies them onto its board ---- */
  const FADE = 520, KEEP = 420;
  function play(key) {
    const s = site(key);
    if (!s || mode !== 'cover' || p < .97) return;
    if (!s.open) { lockedMsg = t('hub.lockedP', { p: nameOf(s.prev) }); hot = null; renderDetail(); setHot(key); return; }
    if (window.TL_SAVE && !window.TL_SAVE.confirmSwitch(s.mode, s.key, savedTitle())) return;
    handoff(s);
  }
  function handoff(s) {
    const run = ++runId;
    stopRise(); mode = 'leaving';
    hub.classList.add('leaving'); $('cvTip').classList.remove('on'); setHot(null);
    renderNav();
    const g = geom(), m = TIDE[hour], [lpx, lpy] = screenXY(s.lon, s.lat, g), live = [];
    // the live dots nearest the level's place, nearest first: they stay; shared/flyin.js on the level's page lands them
    for (let i = 0; i < DOTS.n; i++) {
      const val = DOTS.v[i] * baseMax * m; if (val <= 0.5) continue;
      const sx = g.ox + DOTS.x[i] * g.s, sy = g.oy + DOTS.y[i] * g.s, v = tVis(val);
      live.push({ i, x: sx, y: sy, r: (1.05 + 1.35 * v) * g.s, a: 0.09 + 0.91 * v, d: (sx - lpx) * (sx - lpx) + (sy - lpy) * (sy - lpy) });
    }
    live.sort((a, b) => a.d - b.d);
    const keep = live.slice(0, KEEP), skip = new Uint8Array(DOTS.n), ink = light() ? '10,10,10' : '245,245,245';
    keep.forEach(d => { skip[d.i] = 1; });
    const dpr = size(), T0 = performance.now();
    setTimeout(() => { if (run === runId && mode === 'leaving') enter(s, keep); }, FADE + 600);
    (function frame(now) {
      if (run !== runId || mode !== 'leaving') return;
      const u = now - T0;
      drawMap(1 - easeOut(clamp(u / FADE)), skip, g);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const d of keep) { ctx.fillStyle = 'rgba(' + ink + ',' + d.a.toFixed(3) + ')'; ctx.beginPath(); ctx.arc(d.x, d.y, Math.max(1.4, d.r), 0, 6.2832); ctx.fill(); }
      if (u < FADE) requestAnimationFrame(frame); else enter(s, keep);
    })(T0);
  }
  // hand the dots over and open the level's page
  function enter(s, keep) {
    if (mode !== 'leaving') return;
    mode = 'entering';
    const m = MODES[s.mode];
    try {
      sessionStorage.setItem('tl-flyin', JSON.stringify({ at: Date.now(), key: s.key, dark: !light(),
        dots: keep.map(d => ({ x: +d.x.toFixed(1), y: +d.y.toFixed(1), r: +Math.max(1.4, d.r).toFixed(2), a: +d.a.toFixed(3) })) }));
    } catch (e) {}
    location.href = m.dir + '/' + (bundled ? m.file : 'index.html') + '#map=' + encodeURIComponent(s.key);
  }
  // back from a level's page with the browser's ← (the page may come back from the cache mid-hand-off)
  function backToHub() {
    runId++; mode = 'cover'; p = target = 1; body.classList.remove('veil'); hub.classList.remove('leaving', 'gone', 'away');
    SITES = sitesOf(nav); buildMarks(); renderPanel(); applyP(); renderNav();
  }
  window.addEventListener('pageshow', e => { if (e.persisted) backToHub(); });
  // the address changed in place (#nav=…, #unlock=all): read the levels again
  window.addEventListener('hashchange', () => {
    if (mode !== 'cover') return;
    const q2 = new URLSearchParams(location.hash.slice(1));
    if (q2.has('nav')) nav = +q2.get('nav');
    SITES = sitesOf(nav); buildMarks(); renderPanel(); renderNav();
  });

  /* ---- language, theme, size ---- */
  function setTheme(th) {
    root.setAttribute('data-theme', th);
    $('thPaper').setAttribute('aria-pressed', String(th === 'light')); $('thInk').setAttribute('aria-pressed', String(th === 'dark'));
    try { localStorage.setItem('tl-theme', th); } catch (e) {}
  }
  $('thPaper').addEventListener('click', () => setTheme('light')); $('thInk').addEventListener('click', () => setTheme('dark'));
  { let th = q.get('theme'); if (!th) try { th = localStorage.getItem('tl-theme'); } catch (e) {} if (th === 'dark' || th === 'light') setTheme(th); }
  window.addEventListener('tl:lang', () => {
    document.title = t('doc.title');
    $('cvPhase').textContent = phaseTxt(hour); buildNav(); buildMarks(); renderPanel(); setHot(hot);
  });
  new MutationObserver(draw).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('resize', () => { if (mode === 'cover') { renderTide(); applyP(); } });

  /* ---- start ---- */
  // Test hooks: #hub=1&nav=3 (the map, mode 03 — also how a mode's «← Five modes» comes back) · #hubp=0.5 (frozen
  // mid-scroll) · #hot=l2 (a level's details) · #unlock=all
  document.title = t('doc.title');
  buildNav(); renderTide();
  if (q.get('hubp')) { frozen = true; p = target = clamp(+q.get('hubp')); setHour(8); applyP(); return; }
  if (q.get('hub')) {
    p = target = 1; nav = q.has('nav') ? +q.get('nav') : 1; hub.classList.toggle('m1', nav >= 1 && nav <= 4);
    SITES = sitesOf(nav); buildMarks();
    setHour(PH); applyP(); renderPanel(); renderNav();
    if (q.get('hot')) setHot(q.get('hot'));
    return;
  }
  applyP(); renderPanel();
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) setHour(PH);
  else { setHour(LH); setTimeout(rise, 650); }
})();
