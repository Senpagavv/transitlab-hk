/* Opening cover — adapted from the team product suite ("OPENING · THE TIDE").
   The territory's trip field rises and falls with the 761-detector 24-hour tide.
   v2.2 hand-off: on Enter the copy fades, the dots around Long Ping gather and fly onto the board one after
   another (from the MTR outwards), turning from round ink dots into the board's coloured blocks; the rest of
   the territory fades away, and the cover dissolves onto the real board underneath, block for block. */
(function () {
  'use strict';
  var D = window.COVER, cover = document.getElementById('cover');
  if (!cover) return;
  var $ = function (id) { return document.getElementById(id); };
  function finish() {
    cover.classList.add('gone'); document.body.classList.add('entered');
    window.dispatchEvent(new CustomEvent('tl:entered'));
    setTimeout(function () { if (cover.parentNode) cover.parentNode.removeChild(cover); }, 700);
  }
  if (!D || /(^|[#&])intro=0/.test(location.hash)) { cover.parentNode.removeChild(cover); document.body.classList.add('entered'); return; }

  function b64u8(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function b64u16(s) { var b = b64u8(s); return new Uint16Array(b.buffer, b.byteOffset, b.byteLength >> 1); }
  function runsToPath(bytes, cols, rows, step) {
    var p = new Path2D();
    for (var j = 0; j < rows; j++) {
      var run = -1;
      for (var i = 0; i <= cols; i++) {
        var k = j * cols + i, on = i < cols && ((bytes[k >> 3] >> (k & 7)) & 1);
        if (on && run < 0) run = i;
        else if (!on && run >= 0) { p.rect(run * step, j * step, (i - run) * step, step); run = -1; }
      }
    }
    return p;
  }
  function grp(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function hh(x) { return (x < 10 ? '0' + x : '' + x) + ':00'; }
  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeInOut(u) { return u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
  function easeOut(u) { return 1 - Math.pow(1 - u, 3); }
  function rgba(c) {                            // '#RRGGBB' or 'rgba(r,g,b,a)' → [r,g,b,a]
    c = String(c).trim();
    if (c.charAt(0) === '#') { var n = parseInt(c.slice(1, 7), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255, 1]; }
    var m = c.match(/[\d.]+/g) || [0, 0, 0, 1]; return [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]];
  }

  var DOTS = (function () {
    var idx = b64u16(D.dotsI), val = b64u16(D.dotsV), zi = b64u16(D.dotZ), n = idx.length;
    var x = new Float32Array(n), y = new Float32Array(n), v = new Float32Array(n), z = new Int16Array(n);
    for (var k = 0; k < n; k++) {
      var c = idx[k];
      x[k] = (c % D.dcols + 0.5) * D.STEP; y[k] = ((c / D.dcols) | 0) * D.STEP + 0.5 * D.STEP;
      v[k] = val[k] / 65535; z[k] = zi[k] === 65535 ? -1 : zi[k];
    }
    return { n: n, x: x, y: y, v: v, z: z };
  })();
  var LAND = runsToPath(b64u8(D.land), D.cols, D.rows, D.BORDER_STEP);
  var COAST = new Path2D(); COAST.addPath(new Path2D(D.coast), new DOMMatrix([0.5, 0, 0, 0.5, 0, 0]));
  var G = D.geom, LP = { x: 114.025421 * G.kx * G.scale + G.offx, y: -22.447773 * G.scale + G.offy };  // 朗屏站

  var TIDE = D.tide.factor24, FLOW = D.tide.flow24, SPEED = D.tide.speed24, PH = 0, LH = 0, h;
  for (h = 0; h < 24; h++) { if (TIDE[h] > TIDE[PH]) PH = h; if (TIDE[h] < TIDE[LH]) LH = h; }
  var FMAX = TIDE[PH], baseMax = D.baseMax;
  var tOf = function (v) { return Math.log(1 + v) / Math.log(1 + baseMax * FMAX); };
  var POSV = [];
  for (var k = 0; k < DOTS.n; k++) if (DOTS.v[k] * baseMax > 0.5) POSV.push(DOTS.v[k] * baseMax * FMAX);
  POSV.sort(function (a, b) { return a - b; });
  var TREF = Math.max(0.05, tOf(POSV[Math.floor(POSV.length * 0.85)] || baseMax));
  var tVis = function (v) { var t = Math.min(1, tOf(v) / TREF); return t * t * (1.9 - 0.9 * t); };

  var cv = $('cvDots'), ctx = cv.getContext('2d'), state = { hour: LH, raf: 0, leaving: false };
  function light() { return document.documentElement.getAttribute('data-theme') !== 'dark'; }
  function geom() {
    var rc = cv.getBoundingClientRect(), s = rc.width / rc.height > D.W / D.H ? rc.width / D.W : rc.height / D.H;
    return window.innerWidth < 1024 ? { s: s, ox: (rc.width - D.W * s) / 2, oy: (rc.height - D.H * s) / 2 } : { s: s, ox: rc.width - D.W * s, oy: (rc.height - D.H * s) / 2 };
  }
  function size() {
    var dpr = Math.min(2, window.devicePixelRatio || 1), rect = cv.getBoundingClientRect();
    var W = Math.round(rect.width * dpr), H = Math.round(rect.height * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    return dpr;
  }
  // The territory: land, coast and the dot field. `alpha` fades it; `skip` leaves out dots that are flying.
  function drawMap(alpha, skip) {
    var dpr = size(), g = geom(), L = light(), k = g.s * dpr, m = TIDE[state.hour];
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.setTransform(k, 0, 0, k, g.ox * dpr, g.oy * dpr);
    ctx.fillStyle = L ? '#FFFFFF' : '#1B1B1B'; ctx.fill(LAND);
    ctx.strokeStyle = L ? 'rgba(14,122,78,.85)' : 'rgba(110,217,150,.6)'; ctx.lineWidth = 1.1 / k; ctx.stroke(COAST);
    var RGBA = 'rgba(' + (L ? '10,10,10' : '245,245,245') + ',';
    for (var i = 0; i < DOTS.n; i++) {
      if (skip && skip[i]) continue;
      var val = DOTS.v[i] * baseMax * m;
      if (val <= 0.5) continue;
      var t = tVis(val);
      ctx.fillStyle = RGBA + (0.09 + 0.91 * t).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(DOTS.x[i], DOTS.y[i], 1.05 + 1.35 * t, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function draw() { if (!state.leaving) drawMap(1); }

  (function () {                                // hover: one zone card
    var tip = $('cvTip');
    cv.addEventListener('pointermove', function (e) {
      if (state.leaving) return;
      var rect = cv.getBoundingClientRect(), g = geom(), x = (e.clientX - rect.left - g.ox) / g.s, y = (e.clientY - rect.top - g.oy) / g.s;
      var best = -1, bd = 256;
      for (var i = 0; i < DOTS.n; i++) { var dx = DOTS.x[i] - x, dy = DOTS.y[i] - y, d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = i; } }
      var z = best >= 0 ? DOTS.z[best] : -1;
      if (z < 0) { tip.classList.remove('on'); return; }
      var m = D.zones[z];
      tip.innerHTML = '<div class="tt">' + m.l + ' <span class="tc">' + (D.distNames[m.di] || '') + '</span></div><div class="tv"><span>Trips now 此刻出行</span><b>' + grp(m.ti * TIDE[state.hour] / FMAX) + '</b></div>';
      tip.classList.add('on');
      var lx = e.clientX - rect.left + 14, ly = e.clientY - rect.top + 12;
      if (lx + tip.offsetWidth > rect.width - 6) lx = e.clientX - rect.left - tip.offsetWidth - 14;
      tip.style.left = lx + 'px'; tip.style.top = Math.max(6, Math.min(ly, rect.height - tip.offsetHeight - 6)) + 'px';
    });
    cv.addEventListener('pointerleave', function () { tip.classList.remove('on'); });
  })();

  var TW = 600, TH = 46, PAD = { t: 10, b: 8, l: 6, r: 6 };
  function TX(i) { return PAD.l + i / 23 * (TW - PAD.l - PAD.r); }
  function TY(v) { return PAD.t + (TH - PAD.t - PAD.b) * (1 - v / (FMAX * 1.06)); }
  function renderTide() {
    var mid = $('cvTide'), rect = mid.getBoundingClientRect();
    TW = Math.max(220, Math.round(rect.width)); TH = Math.max(40, Math.round(rect.height));
    mid.setAttribute('viewBox', '0 0 ' + TW + ' ' + TH); mid.setAttribute('preserveAspectRatio', 'none');
    var line = '', j;
    for (j = 0; j < 24; j++) line += (j ? 'L' : 'M') + TX(j).toFixed(1) + ' ' + TY(TIDE[j]).toFixed(1);
    var area = line + ' L' + TX(23).toFixed(1) + ' ' + (TH - PAD.b) + ' L' + TX(0).toFixed(1) + ' ' + (TH - PAD.b) + ' Z';
    var s = '<defs><linearGradient id="cvtg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--s-accent);stop-opacity:.38"/><stop offset="1" style="stop-color:var(--s-accent);stop-opacity:.02"/></linearGradient></defs>';
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
    var g = $('cvPh'); if (!g) return;
    var x = TX(state.hour).toFixed(1), y = TY(TIDE[state.hour]).toFixed(1);
    g.innerHTML = '<line x1="' + x + '" y1="0" x2="' + x + '" y2="' + (TH - PAD.b) + '" style="stroke:var(--s-accent2)" stroke-width="1.3"/>' +
      '<circle cx="' + x + '" cy="' + y + '" r="4.2" style="fill:var(--s-accent2);stroke:var(--s-paper)" stroke-width="1.6"/>';
  }
  (function () {                                // scrub the curve
    var mid = $('cvTide'), drag = false;
    function set(e) { var rc = mid.getBoundingClientRect(); stop(); setHour(Math.round(clamp((e.clientX - rc.left) / rc.width) * 23)); }
    mid.addEventListener('pointerdown', function (e) { drag = true; mid.setPointerCapture(e.pointerId); set(e); });
    mid.addEventListener('pointermove', function (e) { if (drag) set(e); });
    mid.addEventListener('pointerup', function () { drag = false; });
  })();
  function phaseTxt(x) { return x === PH ? 'crest 滿潮' : x === LH ? 'trough 低潮' : TIDE[x] >= 1 ? 'rising 漲潮' : 'ebbing 退潮'; }
  function setHour(x) {
    state.hour = Math.max(0, Math.min(23, x));
    $('cvHour').textContent = hh(state.hour); $('cvPhase').textContent = phaseTxt(state.hour);
    $('cvFlow').textContent = grp(FLOW[state.hour]); $('cvSpeed').textContent = SPEED[state.hour].toFixed(1);
    playhead(); draw();
  }
  function stop() { if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; } }
  function rise() {                             // 03:00 ebb lifts to the 18:00 crest, then rests
    stop();
    var t0 = performance.now(), from = state.hour === PH ? LH : state.hour;
    (function step(t) {
      var u = Math.min(1, (t - t0) / 2600); u = 0.5 - 0.5 * Math.cos(Math.PI * u);
      setHour(Math.round(from + (PH - from) * u));
      state.raf = u < 1 ? requestAnimationFrame(step) : 0;
    })(t0);
  }
  $('cvPlay').addEventListener('click', rise);
  window.addEventListener('resize', function () { if (cover.parentNode && !state.leaving) { renderTide(); draw(); } });
  new MutationObserver(function () { if (cover.parentNode) draw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  /* ---- the hand-off: dots gather onto the board ---- */
  var FADE = 520, FLY = 760, SPREAD = 620, HOLD = 140;
  function leave(frozenAt) {
    var B = window.TL_BOARD && window.TL_BOARD.targets();
    stop(); state.leaving = true; cover.classList.add('leaving'); $('cvTip').classList.remove('on');
    if (!B || !B.items.length) { drawMap(0); setTimeout(finish, 300); return; }
    var dpr = size(), g = geom(), m = TIDE[state.hour], L = light();
    var lpx = g.ox + LP.x * g.s, lpy = g.oy + LP.y * g.s;
    // the live dots nearest Long Ping, nearest first
    var live = [];
    for (var i = 0; i < DOTS.n; i++) {
      var val = DOTS.v[i] * baseMax * m; if (val <= 0.5) continue;
      var sx = g.ox + DOTS.x[i] * g.s, sy = g.oy + DOTS.y[i] * g.s, t = tVis(val);
      live.push({ i: i, x: sx, y: sy, r: (1.05 + 1.35 * t) * g.s, a: 0.09 + 0.91 * t, d: (sx - lpx) * (sx - lpx) + (sy - lpy) * (sy - lpy) });
    }
    live.sort(function (a, b) { return a.d - b.d; });
    // blocks ordered from the MTR outwards, so the board assembles like a ripple leaving the station
    var items = B.items.slice().sort(function (a, b) {
      var da = Math.hypot(a.p[0] - B.hub[0], a.p[1] - B.hub[1]), db = Math.hypot(b.p[0] - B.hub[0], b.p[1] - B.hub[1]);
      return (a.kind === 'hub' ? -1 : 0) - (b.kind === 'hub' ? -1 : 0) || da - db;
    });
    var ink = rgba(L ? '#0A0A0A' : '#F5F5F5'), skip = new Uint8Array(DOTS.n), parts = [], n = Math.min(items.length, live.length);
    for (var j = 0; j < n; j++) {
      var src = live[j], dst = items[j]; skip[src.i] = 1;
      parts.push({ x0: src.x, y0: src.y, r0: Math.max(1.4, src.r), a0: src.a, x1: dst.p[0], y1: dst.p[1], w1: dst.w, h1: dst.h,
        c1: rgba(dst.color), delay: 160 + SPREAD * (j / Math.max(1, n - 1)), house: dst.kind !== 'road' });
    }
    // roads underneath, buildings and the MTR on top — the same stacking as the board
    var order = parts.filter(function (p) { return !p.house; }).concat(parts.filter(function (p) { return p.house; }));
    var END = 160 + SPREAD + FLY + HOLD, T0 = performance.now(), done = false;
    function frame(now) {
      var t = frozenAt === undefined ? now - T0 : frozenAt;
      drawMap(1 - easeOut(clamp(t / FADE)), skip);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (var q = 0; q < order.length; q++) {
        var p = order[q], u = clamp((t - p.delay) / FLY), e = easeInOut(u), s = easeOut(clamp((u - .55) / .45));
        var x = p.x0 + (p.x1 - p.x0) * e, y = p.y0 + (p.y1 - p.y0) * e;
        // a dot first, then it opens out into its block as it lands
        var w = 2 * p.r0 + (p.w1 - 2 * p.r0) * s, hgt = 2 * p.r0 + (p.h1 - 2 * p.r0) * s, rad = Math.min(w, hgt) / 2 * (1 - s) + (p.house ? 3 : 1.5) * s;
        var c = [0, 1, 2].map(function (z) { return Math.round(ink[z] + (p.c1[z] - ink[z]) * s); }), a = p.a0 + (Math.max(.9, p.c1[3]) - p.a0) * easeOut(u);
        ctx.fillStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x - w / 2, y - hgt / 2, w, hgt, rad); else ctx.rect(x - w / 2, y - hgt / 2, w, hgt);
        ctx.fill();
      }
      if (frozenAt !== undefined) return;
      if (t >= END && !done) { done = true; finish(); }
      if (t < END + 700) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  $('coverEnter').addEventListener('click', function () { if (!state.leaving) leave(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && cover.parentNode && !state.leaving) leave(); });

  renderTide();
  var held = /coverfx=(\d+)/.exec(location.hash);    // test hook: freeze the hand-off at t ms for screenshots
  if (held) { setHour(8); setTimeout(function () { leave(+held[1]); }, 200); return; }
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) setHour(PH);
  else { setHour(LH); setTimeout(rise, 650); }
})();
