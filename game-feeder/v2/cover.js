/* Opening cover — adapted from the team product suite ("OPENING · THE TIDE").
   The territory's trip field rises and falls with the 761-detector 24-hour tide.
   v2.1 adds the hand-off: Enter zooms the dot field into Long Ping, where the game is. */
(function () {
  'use strict';
  var D = window.COVER, cover = document.getElementById('cover');
  if (!cover) return;
  var $ = function (id) { return document.getElementById(id); };
  function finish() {
    cover.classList.add('gone'); document.body.classList.add('entered');
    window.dispatchEvent(new CustomEvent('tl:entered'));
    setTimeout(function () { if (cover.parentNode) cover.parentNode.removeChild(cover); }, 650);
  }
  // test hook (#intro=0) and a missing payload both skip straight to the game
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

  var cv = $('cvDots'), state = { hour: LH, raf: 0, zoom: 0 };
  function light() { return document.documentElement.getAttribute('data-theme') !== 'dark'; }
  function narrow() { return window.innerWidth < 1024; }
  function geom() {
    var rc = cv.getBoundingClientRect(), s = rc.width / rc.height > D.W / D.H ? rc.width / D.W : rc.height / D.H;
    var g = narrow() ? { s: s, ox: (rc.width - D.W * s) / 2, oy: (rc.height - D.H * s) / 2 } : { s: s, ox: rc.width - D.W * s, oy: (rc.height - D.H * s) / 2 };
    if (state.zoom > 0) {                       // glide Long Ping to the centre while zooming in
      var e = state.zoom, s1 = g.s * (1 + 2.2 * e);
      var sx = g.ox + LP.x * g.s, sy = g.oy + LP.y * g.s;
      sx += (rc.width / 2 - sx) * e; sy += (rc.height / 2 - sy) * e;
      g = { s: s1, ox: sx - LP.x * s1, oy: sy - LP.y * s1 };
    }
    return g;
  }
  function draw() {
    var dpr = Math.min(2, window.devicePixelRatio || 1), rect = cv.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var W = Math.round(rect.width * dpr), H = Math.round(rect.height * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    var g = geom(), L = light(), k = g.s * dpr, m = TIDE[state.hour], ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.setTransform(k, 0, 0, k, g.ox * dpr, g.oy * dpr);
    ctx.fillStyle = L ? '#FFFFFF' : '#1B1B1B'; ctx.fill(LAND);
    ctx.strokeStyle = L ? 'rgba(14,122,78,.85)' : 'rgba(110,217,150,.6)'; ctx.lineWidth = 1.1 / k; ctx.stroke(COAST);
    var RGBA = 'rgba(' + (L ? '10,10,10' : '245,245,245') + ',', shrink = Math.pow(1 + 2.2 * state.zoom, 0.6);   // keep the halftone fine while zooming
    for (var i = 0; i < DOTS.n; i++) {
      var val = DOTS.v[i] * baseMax * m;
      if (val <= 0.5) continue;
      var t = tVis(val);
      ctx.fillStyle = RGBA + (0.09 + 0.91 * t).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(DOTS.x[i], DOTS.y[i], (1.05 + 1.35 * t) / shrink, 0, 6.2832); ctx.fill();
    }
    if (state.zoom > 0) {                       // Long Ping lights up green as we arrive
      var e = state.zoom;
      ctx.fillStyle = 'rgba(18,160,106,' + (0.22 * e).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(LP.x, LP.y, 4 + 10 * e, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = 'rgba(14,122,78,' + (0.9 * e).toFixed(3) + ')'; ctx.lineWidth = 1.6 / k; ctx.stroke();
    }
  }

  (function () {                                // hover: one zone card
    var tip = $('cvTip');
    cv.addEventListener('pointermove', function (e) {
      if (state.zoom) return;
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
    function set(e) { var rc = mid.getBoundingClientRect(); stop(); setHour(Math.round(Math.max(0, Math.min(1, (e.clientX - rc.left) / rc.width)) * 23)); }
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
  window.addEventListener('resize', function () { if (cover.parentNode) { renderTide(); draw(); } });
  new MutationObserver(function () { if (cover.parentNode) draw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  $('coverEnter').addEventListener('click', function () {
    stop(); cover.classList.add('zooming'); $('cvTip').classList.remove('on');
    var t0 = performance.now(), DUR = 1500;
    (function step(t) {
      var u = Math.min(1, (t - t0) / DUR);
      state.zoom = u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;   // ease-in-out cubic
      draw();
      if (u < 1) requestAnimationFrame(step); else setTimeout(finish, 380);
    })(t0);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && cover.parentNode && !cover.classList.contains('zooming')) $('coverEnter').click(); });

  renderTide();
  var held = /coverzoom=([\d.]+)/.exec(location.hash);   // test hook: hold the zoom at a fraction
  if (held) { cover.classList.add('zooming'); state.zoom = +held[1]; setHour(8); return; }
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) setHour(PH);
  else { setHour(LH); setTimeout(rise, 650); }
})();
