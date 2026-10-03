/* 外星人降临启德 - one tool (bus lanes) with a what-if preview on hover. Plain visuals on purpose. */
(function () {
  'use strict';
  const D = ALIEN_DATA, Sim = AlienSim, P = Sim.P;
  const $ = (id) => document.getElementById(id);
  const LANDSD = 'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/';
  const STEP_MS = 600;           // one game minute at 1x (3 hours = 1.8 minutes)
  const WINDOW = 45;             // preview: average jam over the next 45 game minutes
  const wan = (n) => { n = Math.round(n || 0); return Math.abs(n) >= 10000 ? (n / 10000).toFixed(1) + ' 万' : n.toLocaleString('zh-CN'); };
  const sgn = (n, unit) => (n > 0 ? '+' : n < 0 ? '−' : '±') + (unit === '人' ? wan(Math.abs(n)) : Math.abs(Math.round(n))) + (unit === '人' ? '' : ' ' + unit);
  const clock = (t) => { const m = 18 * 60 + Math.floor(t); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

  // ---------- edge geometry along the real roads ----------
  const geom = D.edges.map((e) => e.geom);
  const cum = geom.map((g) => { const c = [0]; for (let i = 1; i < g.length; i++) c.push(c[i - 1] + Math.hypot((g[i][0] - g[i - 1][0]) * 110.57, (g[i][1] - g[i - 1][1]) * 103)); return c; });
  function along(i, f) {
    const g = geom[i], c = cum[i], L = c[c.length - 1] * Math.max(0, Math.min(1, f));
    let k = 1; while (k < c.length - 1 && c[k] < L) k++;
    const s = (L - c[k - 1]) / Math.max(c[k] - c[k - 1], 1e-9);
    return [g[k - 1][0] + (g[k][0] - g[k - 1][0]) * s, g[k - 1][1] + (g[k][1] - g[k - 1][1]) * s];
  }
  function part(i, f) { const g = geom[i], c = cum[i], L = c[c.length - 1] * f, pts = [g[0]]; for (let k = 1; k < g.length && c[k] < L; k++) pts.push(g[k]); pts.push(along(i, f)); return pts; }

  // ---------- baseline ----------
  const baseRun = Sim.replay(D, [], 999), base = baseRun.summary();
  base.carTrips = base.by.car / P.OCC;
  const STARS = [1.25, 1.45, 1.65].map((k) => base.arrived * k);
  $('baseline').innerHTML = `什么都不做：只有 <b>${wan(base.arrived)}</b> 人领到，<b>${wan(base.gave)}</b> 人放弃。<br>★ ${wan(STARS[0])}　★★ ${wan(STARS[1])}　★★★ ${wan(STARS[2])}`;
  $('introBase').innerHTML = $('baseline').innerHTML;
  $('wantAll').textContent = wan(base.want);

  // ---------- map ----------
  const map = L.map('map', { preferCanvas: true, zoomControl: false, zoomSnap: 0.5, minZoom: 10, maxZoom: 16, maxBounds: [[22.1, 113.8], [22.62, 114.45]] }).setView([22.345, 114.13], 11.5);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.attributionControl.setPrefix(false);
  L.tileLayer(LANDSD + 'basemap/WGS84/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '地图 © 香港地政总署' }).addTo(map);
  const R = L.canvas({ padding: 0.3 });
  Object.entries(D.nodes).forEach(([id, n]) => { if (id !== 'KT') L.tooltip({ permanent: true, direction: 'center', className: 'hub' }).setLatLng([n.lat, n.lon]).setContent(n.name).addTo(map); });
  L.marker(D.kt, { interactive: false, icon: L.divIcon({ className: '', html: '<div class="ufo">🛸</div>', iconSize: [36, 36], iconAnchor: [18, 18] }) }).addTo(map);

  let S, actions = [], playing = false, speed = 1, acc = 0, last = performance.now();
  let zoneMk = [], edgeLine = [], edgeHit = [], railMk = [], hover = null, preview = null, selZone = null;
  const overlay = L.layerGroup().addTo(map), pvLayer = L.layerGroup().addTo(map);
  let aCache = { key: null, run: null };

  function build() {
    S = Sim.create(D); actions = []; aCache = { key: null, run: null }; hover = null; preview = null; selZone = null;
    zoneMk.forEach((m) => m.remove()); edgeLine.forEach((m) => m.remove()); edgeHit.forEach((m) => m && m.remove()); railMk.forEach((m) => m.remove());
    overlay.clearLayers(); pvLayer.clearLayers();
    zoneMk = S.zones.map((z, i) => L.circleMarker([z.lat, z.lon], { renderer: R, radius: 1.5 + Math.sqrt(z.want) / 12, stroke: false, fillColor: '#cbd5e1', fillOpacity: 0.4 })
      .on('click', () => { selZone = i; showZone(); }).addTo(map));
    edgeLine = S.edges.map((e, i) => L.polyline(geom[i], { renderer: R, color: '#22c55e', weight: e.player ? 5 : 2, opacity: e.player ? 0.95 : 0.6, interactive: false }).addTo(map));
    edgeHit = S.edges.map((e, i) => (e.player ? L.polyline(geom[i], { renderer: R, color: '#000', weight: 20, opacity: 0.001 })
      .bindTooltip(e.name, { sticky: true, className: 'ename' })
      .on('mouseover', () => startPreview(i)).on('mouseout', stopPreview).on('click', () => toggle(i)).addTo(map) : null));
    railMk = D.rail_stations.map((st) => L.circleMarker([st.lat, st.lon], { renderer: R, radius: 4, color: '#a855f7', weight: 3, fill: false, interactive: false }).addTo(map));
    $('card').hidden = true; $('play').textContent = '▶ 开始'; pause(); refresh();
  }

  // ---------- after each game minute ----------
  function edgeColor(d) { return d < 3 ? '#22c55e' : d < 10 ? '#f59e0b' : d < 25 ? '#ef4444' : '#7f1d1d'; }
  function mix(a, b, f) {
    const p = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
    const x = p(a), y = p(b);
    return '#' + x.map((v, k) => Math.round(v + (y[k] - v) * f).toString(16).padStart(2, '0')).join('');
  }
  function refresh() {
    const t = S.t;
    S.zones.forEach((z, i) => {
      if (z.newsAt > t) { zoneMk[i].setStyle({ fillColor: '#cbd5e1', fillOpacity: 0.35 }); return; }
      const g = Math.min(1, z.gave / z.want * 1.6), h = z.home / z.want;
      zoneMk[i].setStyle({ fillColor: mix('#f97316', '#6b7280', g), fillOpacity: Math.min(0.85, 0.1 + 0.7 * h + 0.35 * g) });
    });
    overlay.clearLayers();
    if (!preview) {
      const jams = [];
      S.edges.forEach((e, i) => {
        const d = S.delay(e);
        edgeLine[i].setStyle({ color: edgeColor(d), weight: e.player ? 5 : 2 });
        if (d > 5) { L.polyline(part(i, Math.min(0.9, d / 60)), { renderer: R, color: '#450a0a', weight: e.player ? 10 : 6, opacity: 0.45, interactive: false }).addTo(overlay); jams.push({ i, d }); }
      });
      jams.sort((a, b) => b.d - a.d).slice(0, 3).forEach((j) => L.tooltip({ permanent: true, direction: 'top', className: 'jam' })
        .setLatLng(along(j.i, 0.5)).setContent(`${S.edges[j.i].name} 堵 ${Math.round(j.d)} 分钟`).addTo(overlay));
    }
    S.edges.forEach((e, i) => { if (e.lane) L.polyline(geom[i], { renderer: R, color: S.laneOn(e) ? '#1d4ed8' : '#93c5fd', weight: 3, dashArray: S.laneOn(e) ? '10 6' : '4 6', interactive: false }).addTo(overlay); });
    const rq = S.railQueue;
    railMk.forEach((m) => m.setRadius(4 + Math.min(40, Math.sqrt(rq / D.rail_stations.length) / 6)));
    if (rq > 2000) L.tooltip({ permanent: true, direction: 'right', className: 'rail' }).setLatLng([D.rail_stations[0].lat, D.rail_stations[0].lon]).setContent(`港铁站外排队 ${wan(rq)}`).addTo(overlay);
    const h = S.history[S.history.length - 1] || { veh: 0, cars: 0 };
    const dep = S.zones.reduce((a, z) => a + z.dep.car + z.dep.rail + z.dep.walk + z.dep.bus, 0);
    $('clock').textContent = clock(t);
    $('left').textContent = `距离外星人离开 ${Math.floor((P.DURATION - t) / 60)}:${String((P.DURATION - t) % 60).padStart(2, '0')}`;
    $('arrived').textContent = wan(S.arrived); $('moving').textContent = wan(dep - S.arrived);
    $('gave').textContent = wan(S.gave); $('cars').textContent = wan(h.cars);
    $('lanes').textContent = `${S.lanesUsed} / ${P.LANES_MAX}`;
    $('laneList').innerHTML = S.edges.filter((e) => e.lane).map((e) => `<div class="item"><span>🛣 ${e.name}：${S.laneOn(e) ? '已开通' : '设置中…'}</span><button class="btn small" data-lane="${e.i}">关掉</button></div>`).join('');
    if (selZone !== null && !preview) showZone();
  }

  // ---------- what-if preview ----------
  const key = (acts) => acts.map((a) => `${a.t}:${a.edge}`).join(',');
  function forecast() {      // "if you change nothing more" - cached per set of actions
    const k = key(actions);
    if (aCache.key !== k) aCache = { key: k, run: Sim.replay(D, actions, 999) };
    return aCache.run;
  }
  let pvTimer = null, lastPv = 0;
  function startPreview(i) {
    if (S.done) return;
    hover = i;
    clearTimeout(pvTimer);
    $('card').hidden = false;
    $('card').innerHTML = `<h3>预演：${S.edges[i].name}</h3><p>正在推演…</p>`;
    pvTimer = setTimeout(() => { lastPv = performance.now(); computePreview(i); }, 60);
  }
  function stopPreview() {
    hover = null; clearTimeout(pvTimer);
    preview = null; pvLayer.clearLayers(); refresh();
    if (selZone === null) $('card').hidden = true;
  }
  function computePreview(i) {
    if (hover !== i) return;
    const e = S.edges[i], adding = !e.lane;
    if (adding && S.lanesUsed >= P.LANES_MAX) {
      $('card').innerHTML = `<h3>${e.name}</h3><p>专线已经用完 ${P.LANES_MAX} 条。先在右边关掉一条，才能在这里开。</p>`;
      return;
    }
    const A = forecast();
    const B = Sim.replay(D, actions.concat([{ t: S.t, type: 'lane', edge: i }]), 999);
    const t0 = S.t, t1 = Math.min(P.DURATION, t0 + WINDOW);
    const avg = (run, j) => { const L = run.edges[j].delayLog.slice(t0, t1); return L.length ? L.reduce((a, b) => a + b, 0) / L.length : 0; };
    const dd = S.edges.map((_, j) => avg(B, j) - avg(A, j));
    const ra = A.summary(), rb = B.summary();
    preview = { i, dd, ra, rb, adding };
    drawPreview();
  }
  function drawPreview() {
    const { i, dd, ra, rb, adding } = preview;
    pvLayer.clearLayers();
    S.edges.forEach((e, j) => {
      const d = dd[j];
      const c = j === i ? '#1d4ed8' : d < -8 ? '#15803d' : d < -2 ? '#4ade80' : d > 8 ? '#b91c1c' : d > 2 ? '#f87171' : '#9ca3af';
      edgeLine[j].setStyle({ color: c, weight: j === i ? 9 : (e.player ? 4 : 2) + Math.min(8, Math.abs(d) / 2) });
    });
    overlay.clearLayers();
    const big = S.edges.map((e, j) => ({ j, d: dd[j] })).filter((x) => x.j !== i && Math.abs(x.d) >= 2).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    const dirs = ['top', 'bottom', 'right', 'left', 'top'];
    big.slice(0, 5).forEach((x, n) => L.tooltip({ permanent: true, direction: dirs[n], className: x.d < 0 ? 'better' : 'worse' })
      .setLatLng(along(x.j, [0.5, 0.35, 0.65, 0.25, 0.75][n])).setContent(`${S.edges[x.j].name} ${sgn(x.d, '分钟')}`).addTo(pvLayer));
    const self = dd[i];
    const dArr = rb.arrived - ra.arrived, dGave = rb.gave - ra.gave, dBus = rb.by.bus - ra.by.bus, dCar = rb.by.car - ra.by.car, dLate = rb.late - ra.late;
    L.tooltip({ permanent: true, direction: 'top', className: 'self' }).setLatLng(along(i, 0.5)).setContent(`${adding ? '开专线' : '关专线'}：${S.edges[i].name}`).addTo(pvLayer);
    const better = big.filter((x) => x.d < 0).slice(0, 4).map((x) => `${S.edges[x.j].name} ${sgn(x.d, '分钟')}`).join('、') || '没有明显变化';
    const worse = big.filter((x) => x.d > 0).slice(0, 4).map((x) => `${S.edges[x.j].name} ${sgn(x.d, '分钟')}`).join('、') || '没有明显变化';
    $('card').hidden = false;
    $('card').innerHTML = `<h3>预演：现在${adding ? '给' : '关掉'}「${S.edges[i].name}」${adding ? '开专线' : '的专线'}</h3>
      <div class="delta ${dArr >= 0 ? 'up' : 'down'}">到 21:00 领到礼物 <b>${sgn(dArr, '人')}</b><small>（照现在这样：${wan(ra.arrived)} → ${wan(rb.arrived)}）</small></div>
      <div class="kv"><span>坐巴士来的</span><span>${sgn(dBus, '人')}</span><span>开车来的</span><span>${sgn(dCar, '人')}</span><span>放弃的人</span><span>${sgn(dGave, '人')}</span><span>出发了但 9 点前没赶到</span><span>${sgn(dLate, '人')}</span>
      <span>这条路本身</span><span>私家车平均 ${sgn(self, '分钟')}（巴士${adding ? '不再堵' : '回到一起堵'}）</span></div>
      <p><b class="g">变顺的路：</b>${better}</p><p><b class="r">变堵的路：</b>${worse}</p>
      <p class="hint">颜色是未来 ${WINDOW} 分钟各条路平均堵车时间的变化：绿 = 变顺，红 = 变堵。<b>点一下</b>就${adding ? '开（5 分钟后生效）' : '关掉'}。</p>`;
  }
  function toggle(i) {
    if (S.done) return;
    const e = S.edges[i];
    if (!e.lane && S.lanesUsed >= P.LANES_MAX) { toast(`专线最多 ${P.LANES_MAX} 条，先关掉一条`); return; }
    actions.push({ t: S.t, type: 'lane', edge: i });
    S.toggleLane(i);
    aCache = { key: null, run: null };
    toast(e.lane ? `${e.name} 开巴士专线，5 分钟后生效` : `关掉了 ${e.name} 的专线`);
    preview = null; refresh();
    if (hover === i) startPreview(i);
  }
  $('laneList').addEventListener('click', (ev) => { const b = ev.target.closest('[data-lane]'); if (b) toggle(Number(b.dataset.lane)); });

  function showZone() {
    const z = S.zones[selZone], o = z.opt || {};
    const f = (m) => (o[m] === undefined ? '—' : Math.round(o[m]) + ' 分钟');
    $('card').hidden = false;
    $('card').innerHTML = `<h3>${z.label} <small>${z.district}</small> <button class="btn small" id="zx">✕</button></h3><div class="kv">
      <span>想来的人</span><span>${wan(z.want)}（还在家 ${wan(z.home)}）</span>
      <span>已出发</span><span>开车 ${wan(z.dep.car)} · 巴士 ${wan(z.dep.bus)} · 港铁 ${wan(z.dep.rail)} · 走路 ${wan(z.dep.walk)}</span>
      <span>放弃了</span><span>${wan(z.gave)}</span>
      <span>平时坐公交去启德</span><span>${Math.round(z.pt)} 分钟</span>
      <span>现在去启德要</span><span>开车 ${f('car')} · 巴士 ${f('bus')} · 港铁 ${f('rail')}${o.walk !== undefined ? ' · 走路 ' + f('walk') : ''}</span></div>
      <p class="hint">${z.newsAt > S.t ? '这里还没收到消息。' : '要的时间比平时多太多，人就会放弃。'}</p>`;
    $('zx').addEventListener('click', () => { selZone = null; $('card').hidden = true; });
  }

  // ---------- moving vehicles ----------
  const cv = $('dots'), ctx = cv.getContext('2d');
  function fit() { const r = $('map').getBoundingClientRect(); cv.width = r.width; cv.height = r.height; cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px'; }
  window.addEventListener('resize', fit); fit();
  function draw() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!S || preview) return;
    const now = S.t + (playing ? acc / STEP_MS : 0);
    S.edges.forEach((e, i) => {
      for (const k of e.transit) dot(along(i, (now - k.enterAt) / Math.max(k.exitAt - k.enterAt, 0.1)), k);
      const d = S.delay(e);
      if (d > 3) {
        const f = Math.min(0.9, d / 60), all = e.queue.concat(e.busQueue), n = Math.min(50, all.length);
        for (let j = 0; j < n; j++) dot(along(i, f * (j + 0.5) / n), all[j]);
      }
    });
  }
  function dot(p, k) {
    const pt = map.latLngToContainerPoint(p), bus = k.mode === 'bus';
    ctx.fillStyle = bus ? '#1d4ed8' : '#ef4444';
    ctx.beginPath();
    if (bus) ctx.rect(pt.x - 3, pt.y - 3, 6, 6); else ctx.arc(pt.x, pt.y, Math.min(3.5, 1.5 + Math.sqrt(k.veh) / 5), 0, Math.PI * 2);
    ctx.fill();
  }

  // ---------- loop and controls ----------
  function loop(now) {
    const dt = now - last; last = now;
    if (playing && S && !S.done) {
      acc += dt * speed;
      while (acc >= STEP_MS && !S.done) {
        acc -= STEP_MS; S.step();
        refresh();
        if (S.alerts.length) toast(S.alerts.map((a) => a.text).join('　'));
        if (hover !== null && performance.now() - lastPv > 2000) { lastPv = performance.now(); computePreview(hover); }
        if (S.done) { pause(); end(); }
      }
    }
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  function play() { if (S.done) return; playing = true; $('play').textContent = '⏸ 暂停'; }
  function pause() { playing = false; $('play').textContent = S && S.t > 0 ? '▶ 继续' : '▶ 开始'; }
  $('play').addEventListener('click', () => (playing ? pause() : play()));
  document.querySelectorAll('.spd').forEach((b) => b.addEventListener('click', () => { speed = Number(b.dataset.speed); document.querySelectorAll('.spd').forEach((x) => x.classList.toggle('on', x === b)); }));
  $('restart').addEventListener('click', () => { pause(); build(); });
  $('introOk').addEventListener('click', () => { $('intro').hidden = true; });
  let toastT;
  function toast(s) { const t = $('toast'); t.textContent = s; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3500); }
  map.on('move zoom', draw);

  // ---------- the end ----------
  function end() {
    const r = S.summary(), carTrips = r.by.car / P.OCC;
    const stars = STARS.filter((x) => r.arrived >= x).length;
    const pct = (a, b) => (b ? Math.round(100 * (a - b) / b) : 0);
    $('endBody').innerHTML = `<h2>👋 外星人飞走了</h2>
      <div class="stars">${'★'.repeat(stars)}<span class="off">${'★'.repeat(3 - stars)}</span></div>
      <table class="res">
        <tr><td>领到礼物</td><td class="n">${wan(r.arrived)}</td><td>什么都不做：${wan(base.arrived)}（${pct(r.arrived, base.arrived) >= 0 ? '+' : ''}${pct(r.arrived, base.arrived)}%）</td></tr>
        <tr><td>放弃的人</td><td class="n">${wan(r.gave)}</td><td>什么都不做：${wan(base.gave)}</td></tr>
        <tr><td>出发了但没赶到</td><td class="n">${wan(r.late)}</td><td>什么都不做：${wan(base.late)}</td></tr>
        <tr><td>怎么来的</td><td class="n"></td><td>巴士 ${wan(r.by.bus)} · 港铁 ${wan(r.by.rail)} · 开车打车 ${wan(r.by.car)} · 走路 ${wan(r.by.walk)}</td></tr>
        <tr><td>🌿 私家车 / 的士车次</td><td class="n">${wan(carTrips)}</td><td>什么都不做：${wan(base.carTrips)}（${pct(carTrips, base.carTrips)}%）</td></tr>
        <tr><td>🌿 路上车辆总时间</td><td class="n">${wan(r.vehHours)} 车·时</td><td>什么都不做：${wan(base.vehHours)}（${pct(r.vehHours, base.vehHours)}%）</td></tr></table>
      <div class="egg"><b>🥚 其实……这不是外星人。</b><br>你刚才处理的，就是演唱会、球赛、跨年烟花这类大型活动的真实问题：一大群人在同一段时间要去同一个地方。
      你摸到的规律——给巴士一条专线，一条车道能多运好几倍的人；但私家车会绕到别的路，把堵车推过去；专线开在大家都要经过的最后一段最有效；越早开越好——正是交通工程师做大型活动交通安排时的思路。</div>
      <div class="row" style="margin-top:12px"><button class="btn main" id="again">再玩一次</button><button class="btn" id="look">留在地图上看看</button></div>`;
    $('end').hidden = false;
    $('again').addEventListener('click', () => { $('end').hidden = true; build(); });
    $('look').addEventListener('click', () => { $('end').hidden = true; });
  }

  build();
  window.TLA = { map, get S() { return S; }, base, startPreview, toggle };   // for automatic checks
})();
