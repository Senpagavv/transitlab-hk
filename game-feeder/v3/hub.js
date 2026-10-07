/* Hub — the opening and the map you come back to (v3.1). Adapted from the team product suite's tide cover.
   Intro: title + tide bar over the territory's dot field. Scrolling (wheel, touch, ↓ / PgDn / Enter) carries it into
   the hub: the copy and the tide bar move away, the dot map settles centred behind, the top bar and the 01–06 menu
   slide in. Mode 01 puts the playable stations on the map; clicking one hands the dots around that station to the
   board (they fly onto its blocks, from the MTR outwards), and "← Map" plays the same film backwards. Other places
   are marked "not built yet"; modes 02–06 only change the glass panel for now. */
(function () {
  'use strict';
  const CV = window.COVER, hub = document.getElementById('hub'), I = window.I18N, D = window.TIDE_DATA;
  if (!hub) return;
  const $ = id => document.getElementById(id), t = (k, v) => I.t(k, v), root = document.documentElement, body = document.body;
  const q = new URLSearchParams(location.hash.slice(1));
  const clamp = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const easeInOut = u => u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  const easeOut = u => 1 - Math.pow(1 - u, 3);
  const grp = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const hh = x => (x < 10 ? '0' + x : '' + x) + ':00';
  const EN = ['', 'Entry game', 'Lessons', 'Full sandbox', 'Observation deck', 'Leaderboard', 'Network console'];
  function rgba(c) {                            // '#RRGGBB' or 'rgba(r,g,b,a)' → [r,g,b,a]
    c = String(c).trim();
    if (c.charAt(0) === '#') { const n = parseInt(c.slice(1, 7), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255, 1]; }
    const m = c.match(/[\d.]+/g) || [0, 0, 0, 1]; return [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]];
  }

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

  /* ---- state ---- */
  // mode: 'cover' (intro ↔ hub, driven by p), 'leaving' (dots fly onto the board), 'game', 'returning' (and back)
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

  /* ---- the 01–06 menu and the glass panel ---- */
  const site = key => D.sites.find(s => s.key === key);
  const plays = () => D.sites.filter(s => s.status === 'play');
  const best = map => { try { return +localStorage.getItem('tl-best-' + map) || 0; } catch (e) { return 0; } };
  const inGame = () => mode === 'game' || mode === 'leaving';
  function renderNav() {
    document.querySelectorAll('#navrow [data-mode]').forEach(b => {
      const m = +b.dataset.mode, sel = inGame() ? m === 1 : (mode === 'returning' || mode === 'cover' && p > .5) && m === nav;
      b.setAttribute('aria-selected', String(sel));
      b.classList.toggle('invite', mode === 'cover' && hub.classList.contains('open') && nav === 0 && m === 1);
    });
  }
  function selectNav(n) {
    if (mode === 'game') { showHub(n); return; }
    if (mode !== 'cover') return;
    nav = n; target = 1; kick();
    hub.classList.toggle('m1', nav === 1); hot = null;
    renderNav(); renderPanel();
  }
  document.querySelectorAll('#navrow [data-mode]').forEach(b => b.addEventListener('click', () => selectNav(+b.dataset.mode)));
  function levelButton(s) {
    const b = best(s.map), resume = window.TL_GAME && window.TL_GAME.inProgress() && window.TL_GAME.map() === s.map;
    return '<button class="lv' + (s.minor ? ' minor' : '') + '" data-site="' + s.key + '"><span class="lv-n"><b>' + t('site.' + s.key) + '</b><small>' + s.station.en + '</small></span>' +
      '<span class="lv-m">' + t('hub.levelLine', { n: s.estates, pass: s.tiers[0] }) + (b ? ' · <em>' + t('hub.best', { n: b }) + '</em>' : '') + '</span>' +
      (resume ? '<span class="lv-r">' + t('hub.resume') + '</span>' : '') + '</button>';
  }
  const tc = s => I.lang === 'en' ? '' : '<span class="hp-tc">' + s + '</span>';
  function renderPanel() {
    let h;
    if (nav === 0) h = '<span class="lbl">' + t('hub.start') + '</span><h2 class="hp-h">' + t('hub.pickH') + ' <span class="hp-up">↑</span></h2><p class="note">' + t('hub.pickP') + '</p>';
    else if (nav === 1) {
      h = '<span class="lbl">Mode 01 · Entry game</span><h2 class="hp-h">Feeder bus' + tc(t('hub.m1H')) + '</h2><p class="note">' + t('hub.m1P') + '</p>' +
        '<div class="lbl hp-sub">' + t('hub.levels') + '</div><div class="lvls">' + plays().map(levelButton).join('') + '</div>' +
        '<div class="hp-detail" id="hubDetail" aria-live="polite"></div>' +
        '<div class="hp-legend"><span><i class="k st-play"></i>' + t('hub.play') + '</span><span><i class="k st-soon"></i>' + t('hub.soon') + '</span></div>' +
        '<p class="hp-fine">' + t('hub.soonNote') + (t('hub.enNames') ? ' ' + t('hub.enNames') : '') + '</p>';
    } else h = '<span class="lbl">Mode 0' + nav + ' · ' + EN[nav] + '</span><h2 class="hp-h">' + EN[nav] + tc(t('hub.m' + nav + 'H')) + '</h2>' +
      '<span class="chip"><i></i>' + t('hub.coming') + '</span><p class="note">' + t('hub.m' + nav + 'P') + '</p>';
    $('hubPanel').innerHTML = h;
    $('hubPanel').querySelectorAll('.lv').forEach(b => {
      b.addEventListener('click', () => play(b.dataset.site));
      b.addEventListener('pointerenter', () => setHot(b.dataset.site)); b.addEventListener('focus', () => setHot(b.dataset.site));
      b.addEventListener('pointerleave', () => setHot(null)); b.addEventListener('blur', () => setHot(null));
    });
    renderDetail();
  }
  function renderDetail() {
    const el = $('hubDetail'); if (!el) return;
    const s = hot && site(hot);
    if (!s) { el.innerHTML = '<p class="hp-idle">' + t('hub.hover') + '</p>'; return; }
    el.innerHTML = '<div class="hp-dh"><b>' + t('site.' + s.key) + '</b><span class="tag st-' + s.status + '">' + t(s.status === 'play' ? 'hub.play' : 'hub.soon') + '</span></div>' +
      '<p>' + t('about.' + s.key) + '</p>' + (s.status === 'play' ? '<p class="mono hp-tiers">' + t('hub.tiers', { a: s.tiers[0], b: s.tiers[1], c: s.tiers[2] }) + '</p>' : '');
  }
  function setHot(key) {
    hot = key; renderDetail();
    $('hubMarks').querySelectorAll('.hm').forEach(el => el.classList.toggle('hot', el.dataset.site === key));
    $('hubPanel').querySelectorAll('.lv').forEach(el => el.classList.toggle('hot', el.dataset.site === key));
  }

  /* ---- markers on the map ---- */
  function buildMarks() {
    $('hubMarks').innerHTML = D.sites.map((s, i) => {
      const playable = s.status === 'play', b = playable && best(s.map);
      const sub = playable ? s.station.en + (b ? ' · ' + t('hub.best', { n: b }) : '') : t('hub.soon');
      return '<button class="hm st-' + s.status + (s.minor ? ' minor' : '') + '" data-site="' + s.key + '" data-side="' + (s.side || 'right') + '" style="--i:' + i + '"' +
        (playable ? '' : ' aria-disabled="true"') + ' aria-label="' + t('site.' + s.key) + ' · ' + sub + '"><i class="pin"></i><span class="lab"><b>' + t('site.' + s.key) + '</b><small>' + sub + '</small></span></button>';
    }).join('');
    $('hubMarks').querySelectorAll('.hm').forEach(el => {
      el.addEventListener('click', () => { if (el.classList.contains('st-play')) play(el.dataset.site); else setHot(el.dataset.site); });
      el.addEventListener('pointerenter', () => setHot(el.dataset.site)); el.addEventListener('focus', () => setHot(el.dataset.site));
      el.addEventListener('pointerleave', () => setHot(null)); el.addEventListener('blur', () => setHot(null));
    });
    placeMarks();
  }
  function placeMarks() {
    const g = geom();
    $('hubMarks').querySelectorAll('.hm').forEach(el => {
      const s = site(el.dataset.site), [x, y] = screenXY(s.lon, s.lat, g);
      el.style.left = x.toFixed(1) + 'px'; el.style.top = y.toFixed(1) + 'px';
    });
  }

  /* ---- the hand-off: dots gather onto the board (and back) ---- */
  const FADE = 520, FLY = 760, SPREAD = 620, HOLD = 140, END = 160 + SPREAD + FLY + HOLD, BACK_HOLD = 420;
  function play(key) {
    const s = site(key);
    if (!s || s.status !== 'play' || mode !== 'cover' || p < .97) return;
    if (!window.TL_GAME || !window.TL_GAME.loadMap(s.map)) return;
    handoff(1);
  }
  function handoff(dir, frozenAt) {
    const run = ++runId;
    stopRise(); mode = dir > 0 ? 'leaving' : 'returning';
    hub.classList.add('leaving'); $('cvTip').classList.remove('on'); setHot(null);
    body.classList.add('inhub'); renderNav();
    const g = geom(), B = window.TL_BOARD && window.TL_BOARD.targets();
    if (!B || !B.items.length) { if (dir > 0) setTimeout(enterGame, 300); else backToHub(); return; }
    const dpr = size(), m = TIDE[hour], L = light(), [lpx, lpy] = screenXY(D.station.lon, D.station.lat, g);
    // the live dots nearest the level's station, nearest first
    const live = [];
    for (let i = 0; i < DOTS.n; i++) {
      const val = DOTS.v[i] * baseMax * m; if (val <= 0.5) continue;
      const sx = g.ox + DOTS.x[i] * g.s, sy = g.oy + DOTS.y[i] * g.s, v = tVis(val);
      live.push({ i, x: sx, y: sy, r: (1.05 + 1.35 * v) * g.s, a: 0.09 + 0.91 * v, d: (sx - lpx) * (sx - lpx) + (sy - lpy) * (sy - lpy) });
    }
    live.sort((a, b) => a.d - b.d);
    // blocks ordered from the MTR outwards, so the board assembles like a ripple leaving the station
    const items = B.items.slice().sort((a, b) => {
      const da = Math.hypot(a.p[0] - B.hub[0], a.p[1] - B.hub[1]), db = Math.hypot(b.p[0] - B.hub[0], b.p[1] - B.hub[1]);
      return (a.kind === 'hub' ? -1 : 0) - (b.kind === 'hub' ? -1 : 0) || da - db;
    });
    const ink = rgba(L ? '#0A0A0A' : '#F5F5F5'), skip = new Uint8Array(DOTS.n), parts = [], n = Math.min(items.length, live.length);
    for (let j = 0; j < n; j++) {
      const src = live[j], dst = items[j]; skip[src.i] = 1;
      parts.push({ x0: src.x, y0: src.y, r0: Math.max(1.4, src.r), a0: src.a, x1: dst.p[0], y1: dst.p[1], w1: dst.w, h1: dst.h,
        c1: rgba(dst.color), delay: 160 + SPREAD * (j / Math.max(1, n - 1)), house: dst.kind !== 'road' });
    }
    // roads underneath, buildings and the MTR on top — the same stacking as the board
    const order = parts.filter(x => !x.house).concat(parts.filter(x => x.house));
    if (dir < 0) { hub.classList.remove('away'); void hub.offsetWidth; hub.classList.remove('gone'); }
    const T0 = performance.now(); let done = false;
    // rAF stops in background tabs and can crawl on slow machines: the hand-off always finishes on time anyway
    if (frozenAt === undefined) setTimeout(() => { if (run !== runId || done) return; done = true; if (dir > 0) enterGame(); else backToHub(); }, (dir > 0 ? END : END + BACK_HOLD) + 500);
    function frame(now) {
      if (run !== runId) return;
      const tt = frozenAt === undefined ? now - T0 : frozenAt;
      // backwards: hold on the assembled board while the hub fades in over it, then play the film in reverse
      const u = dir > 0 ? tt : END - Math.max(0, tt - BACK_HOLD);
      drawMap(1 - easeOut(clamp(u / FADE)), skip, g);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const x of order) {
        const v = clamp((u - x.delay) / FLY), e = easeInOut(v), s = easeOut(clamp((v - .55) / .45));
        const px = x.x0 + (x.x1 - x.x0) * e, py = x.y0 + (x.y1 - x.y0) * e;
        // a dot first, then it opens out into its block as it lands
        const w = 2 * x.r0 + (x.w1 - 2 * x.r0) * s, hgt = 2 * x.r0 + (x.h1 - 2 * x.r0) * s, rad = Math.min(w, hgt) / 2 * (1 - s) + (x.house ? 3 : 1.5) * s;
        const c = [0, 1, 2].map(z => Math.round(ink[z] + (x.c1[z] - ink[z]) * s)), a = x.a0 + (Math.max(.9, x.c1[3]) - x.a0) * easeOut(v);
        ctx.fillStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(px - w / 2, py - hgt / 2, w, hgt, rad); else ctx.rect(px - w / 2, py - hgt / 2, w, hgt);
        ctx.fill();
      }
      if (frozenAt !== undefined) return;
      if (dir > 0) { if (tt >= END && !done) { done = true; enterGame(); } if (tt < END + 700) requestAnimationFrame(frame); }
      else if (tt >= END + BACK_HOLD) { if (!done) { done = true; backToHub(); } } else requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  function enterGame() {
    mode = 'game'; hub.classList.add('gone'); hub.classList.remove('leaving');
    body.classList.remove('inhub', 'chrome-off'); root.style.setProperty('--hub-q', '1');
    body.classList.remove('entered'); void body.offsetWidth; body.classList.add('entered');   // the side columns glide in again
    if (window.TL_GAME) window.TL_GAME.texts();
    renderNav();
    setTimeout(() => { if (mode === 'game') hub.classList.add('away'); }, 700);
    window.dispatchEvent(new CustomEvent('tl:entered'));
  }
  function backToHub() {
    runId++; mode = 'cover'; p = target = 1; hub.classList.remove('leaving', 'gone', 'away');
    hub.classList.toggle('m1', nav === 1);
    document.title = t('doc.title');
    buildMarks(); renderPanel(); applyP(); renderNav();
  }
  // From the game: "← Map", the result's "Back to map" or any menu item.
  function showHub(n) {
    if (mode !== 'game') return;
    if (window.TL_GAME) window.TL_GAME.pause();
    nav = n || 1; handoff(-1);
  }
  window.TL_HUB = { show: showHub };

  /* ---- language, theme, size ---- */
  window.addEventListener('tl:lang', () => {
    if (mode === 'cover') document.title = t('doc.title');
    $('cvPhase').textContent = phaseTxt(hour); buildMarks(); renderPanel(); setHot(hot);
  });
  new MutationObserver(draw).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('resize', () => { if (mode === 'cover') { renderTide(); applyP(); } });

  /* ---- start ---- */
  // Test hooks: #intro=0 (straight into the game) · #hub=1&nav=1 (the map) · #hubp=0.5 (frozen mid-scroll)
  // · #coverfx=900 (hand-off frozen at 900 ms) · #hot=fanling (a marker's details)
  buildMarks(); renderTide();
  if (q.get('intro') === '0') {
    mode = 'game'; p = target = 1; nav = 1; hub.classList.add('gone', 'away'); body.classList.remove('inhub'); body.classList.add('entered');
    root.style.setProperty('--hub-q', '1'); renderNav(); setHour(PH);
    return;
  }
  document.title = t('doc.title');
  if (q.get('hubp')) { frozen = true; p = target = clamp(+q.get('hubp')); setHour(8); applyP(); return; }
  if (q.get('hub') || q.get('coverfx')) {
    p = target = 1; nav = q.has('nav') ? +q.get('nav') : 1; hub.classList.toggle('m1', nav === 1);
    setHour(PH); applyP(); renderPanel(); renderNav();
    if (q.get('hot')) setHot(q.get('hot'));
    if (q.get('coverfx')) setTimeout(() => { if (window.TL_GAME.loadMap(D.map)) handoff(1, +q.get('coverfx')); }, 250);
    return;
  }
  applyP(); renderPanel();
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) setHour(PH);
  else { setHour(LH); setTimeout(rise, 650); }
})();
