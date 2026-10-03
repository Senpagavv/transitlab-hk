/* 外星人降临启德 - map, controls and feedback around AlienSim (sim.js). Plain visuals on purpose: get the rules right first. */
(function () {
  'use strict';
  const D = ALIEN_DATA, Sim = AlienSim, P = Sim.P;
  const $ = (id) => document.getElementById(id);
  const LANDSD = 'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/';
  const STEP_MS = 1300;     // one game minute at 1x
  const wan = (n) => { n = Math.round(n || 0); return Math.abs(n) >= 10000 ? (n / 10000).toFixed(1) + ' 万' : n.toLocaleString('zh-CN'); };
  const clock = (t) => { const m = 18 * 60 + Math.floor(t); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
  const node = (id) => D.nodes[id];

  // ---------- baseline: what happens if you do nothing ----------
  const base = (() => { const b = Sim.create(D); while (!b.done) b.step(); const r = b.summary(); r.carTrips = b.zones.reduce((a, z) => a + z.dep.car, 0) / P.OCC; return r; })();
  const STARS = [1.2, 1.45, 1.65].map((k) => base.arrived * k);
  $('baseline').innerHTML = `如果什么都不做：9 点前只有 <b>${wan(base.arrived)}</b> 人领到礼物，<b>${wan(base.gave)}</b> 人放弃。<br>★ ${wan(STARS[0])}　★★ ${wan(STARS[1])}　★★★ ${wan(STARS[2])}`;
  $('introBase').innerHTML = $('baseline').innerHTML;
  $('wantAll').textContent = wan(base.want);

  // ---------- map ----------
  const map = L.map('map', { preferCanvas: true, zoomControl: false, zoomSnap: 0.5, minZoom: 10, maxZoom: 16, maxBounds: [[22.1, 113.8], [22.62, 114.45]] }).setView([22.355, 114.12], 11.5);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.attributionControl.setPrefix(false);
  L.tileLayer(LANDSD + 'basemap/WGS84/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '地图 © 香港地政总署' }).addTo(map);
  const R = L.canvas({ padding: 0.3 });
  let S, zoneMk = [], edgeLine = [], edgeHit = [], overlay = L.layerGroup().addTo(map), pkLayer = L.layerGroup().addTo(map), news, railMk = [];
  let playing = false, speed = 1, acc = 0, last = performance.now(), tool = null, sel = null, temp = null;

  Object.entries(D.nodes).forEach(([id, n]) => { if (id !== 'KT') L.tooltip({ permanent: true, direction: 'center', className: 'hub' }).setLatLng([n.lat, n.lon]).setContent(n.name).addTo(map); });
  L.marker(D.kt, { interactive: false, icon: L.divIcon({ className: '', html: '<div class="ufo">🛸</div>', iconSize: [36, 36], iconAnchor: [18, 18] }) }).addTo(map);

  function edgeColor(d) { return d < 3 ? '#22c55e' : d < 10 ? '#f59e0b' : d < 25 ? '#ef4444' : '#7f1d1d'; }
  function ll(n) { return [node(n).lat, node(n).lon]; }
  function lerp(a, b, f) { return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }

  function build() {
    S = Sim.create(D);
    zoneMk.forEach((m) => m.remove()); edgeLine.forEach((m) => m.remove()); edgeHit.forEach((m) => m.remove()); railMk.forEach((m) => m.remove());
    overlay.clearLayers(); pkLayer.clearLayers(); if (news) news.remove();
    zoneMk = S.zones.map((z, i) => L.circleMarker([z.lat, z.lon], { renderer: R, radius: 2 + Math.sqrt(z.want) / 9, stroke: false, fillColor: '#cbd5e1', fillOpacity: 0.5 })
      .on('click', (e) => { L.DomEvent.stop(e); if (tool === 'pickup') return pickAt(e.latlng); if (tool === 'lane') return laneNear(e.latlng); select({ type: 'zone', i }); }).addTo(map));
    edgeLine = S.edges.map((e) => L.polyline([ll(e.from), ll(e.to)], { renderer: R, color: '#22c55e', weight: e.player ? 5 : 3, opacity: e.player ? 0.9 : 0.5, interactive: false }).addTo(map));
    edgeHit = S.edges.map((e) => L.polyline([ll(e.from), ll(e.to)], { renderer: R, color: '#000', weight: 18, opacity: 0.001 })
      .bindTooltip(e.name + (e.player ? '' : '（连接路，不能开专线）'), { sticky: true })
      .on('click', (ev) => { L.DomEvent.stop(ev); if (tool === 'lane') return laneAt(e); select({ type: 'edge', i: e.i }); }).addTo(map));
    news = L.circle(D.kt, { radius: 10, color: '#f97316', weight: 2, dashArray: '4 8', fill: false, interactive: false }).addTo(map);
    railMk = D.rail_stations.map((st) => L.circleMarker([st.lat, st.lon], { renderer: R, radius: 4, color: '#a855f7', weight: 3, fill: false, interactive: false }).addTo(map));
    sel = null; $('card').hidden = true; setTool(null); refresh();
  }

  // ---------- after each game minute ----------
  function refresh() {
    const t = S.t;
    // zones: orange = want to come and still at home, grey = gave up, pale = no news yet
    S.zones.forEach((z, i) => {
      if (z.newsAt > t) { zoneMk[i].setStyle({ fillColor: '#cbd5e1', fillOpacity: 0.45 }); return; }
      const g = Math.min(1, z.gave / z.want * 1.6), h = z.home / z.want;
      zoneMk[i].setStyle({ fillColor: mix('#f97316', '#6b7280', g), fillOpacity: Math.min(0.9, 0.12 + 0.75 * h + 0.35 * g) });
    });
    news.setRadius(Math.max(10, Math.min(t * P.NEWS_KM_PER_MIN * 1000, 45000)));
    // roads
    overlay.clearLayers();
    const jams = [];
    S.edges.forEach((e, i) => {
      const d = S.delay(e), flow = e.flowHist.length ? e.flowHist.reduce((a, b) => a + b, 0) / e.flowHist.length : 0;
      edgeLine[i].setStyle({ color: edgeColor(d), weight: (e.player ? 4 : 2) + Math.min(10, flow / 8) });
      if (d > 5) {
        const f = Math.min(0.9, d / 50);
        const a = ll(e.from), b = lerp(a, ll(e.to), f);
        L.polyline([a, b], { renderer: R, color: '#450a0a', weight: 9, opacity: 0.55, interactive: false }).addTo(overlay);
        jams.push({ e, d, at: lerp(a, b, 0.5) });
      }
      if (e.lane) {
        const on = S.laneOn(e);
        L.polyline([ll(e.from), ll(e.to)], { renderer: R, color: on ? '#1d4ed8' : '#93c5fd', weight: 3, dashArray: on ? null : '6 6', interactive: false }).addTo(overlay);
      }
    });
    jams.sort((a, b) => b.d - a.d).slice(0, 3).forEach((j) => L.tooltip({ permanent: true, direction: 'top', className: 'jam' })
      .setLatLng(lerp(ll(j.e.from), ll(j.e.to), 0.5)).setContent(`${j.e.name} 堵 ${Math.round(j.d)} 分钟`).addTo(overlay));
    // MTR queue at Kai Tak
    const rq = S.railQueue;
    railMk.forEach((m) => m.setRadius(4 + Math.min(40, Math.sqrt(rq / D.rail_stations.length) / 6)));
    if (rq > 2000) L.tooltip({ permanent: true, direction: 'right', className: 'rail' }).setLatLng([D.rail_stations[0].lat, D.rail_stations[0].lon])
      .setContent(`港铁站外排队 ${wan(rq)}`).addTo(overlay);
    // pickups
    pkLayer.clearLayers();
    S.pickups.filter((k) => !k.closed).forEach((k) => {
      L.circle([k.lat, k.lon], { radius: P.PICKUP_KM * 1000, color: '#2563eb', weight: 1, fillOpacity: 0.05, interactive: false }).addTo(pkLayer);
      const ready = k.deployAt <= S.t;
      L.marker([k.lat, k.lon], { icon: L.divIcon({ className: '', html: `<div class="pk-label">🚌 ${k.buses.length}${ready ? '' : ' 在路上'} · 等车 ${wan(k.queue)}</div>`, iconSize: null }) })
        .on('click', (ev) => { L.DomEvent.stop(ev); select({ type: 'pk', id: k.id }); }).addTo(pkLayer);
    });
    // HUD and lists
    const h = S.history[S.history.length - 1] || { veh: 0 };
    const dep = S.zones.reduce((a, z) => a + z.dep.car + z.dep.rail + z.dep.walk + z.dep.bus, 0);
    $('clock').textContent = clock(t);
    $('left').textContent = `距离外星人离开 ${Math.floor((P.DURATION - t) / 60)}:${String((P.DURATION - t) % 60).padStart(2, '0')}`;
    $('arrived').textContent = wan(S.arrived); $('moving').textContent = wan(dep - S.arrived);
    $('gave').textContent = wan(S.gave); $('cars').textContent = wan(h.veh);
    $('fleet').textContent = `${S.busFleetUsed()} / ${P.FLEET}`; $('lanes').textContent = `${S.lanesUsed} / ${P.LANES_MAX}`;
    $('pickupList').innerHTML = S.pickups.filter((k) => !k.closed).map((k) => `<div class="item"><span>🚌 ${k.area}：${k.buses.length} 辆 · 已送 ${wan(k.served)}</span>
      <span><button class="btn small" data-pk="${k.id}" data-d="-10">−10</button> <button class="btn small" data-pk="${k.id}" data-d="10">+10</button> <button class="btn small" data-pk="${k.id}" data-d="x">✕</button></span></div>`).join('');
    $('laneList').innerHTML = S.edges.filter((e) => e.lane).map((e) => `<div class="item"><span>🛣 ${e.name}：${S.laneOn(e) ? '已开通' : '设置中…'}</span><button class="btn small" data-lane="${e.i}">✕</button></div>`).join('');
    if (sel) showCard();
  }
  function mix(a, b, f) {
    const p = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
    const x = p(a), y = p(b);
    return '#' + x.map((v, k) => Math.round(v + (y[k] - v) * f).toString(16).padStart(2, '0')).join('');
  }

  // ---------- moving vehicles (drawn every frame between game minutes) ----------
  const cv = $('dots'), ctx = cv.getContext('2d');
  function fit() { const r = $('map').getBoundingClientRect(); cv.width = r.width; cv.height = r.height; cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px'; }
  window.addEventListener('resize', fit); fit();
  function draw() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!S) return;
    const now = S.t + (playing ? acc / STEP_MS : 0);
    for (const e of S.edges) {
      const a = ll(e.from), b = ll(e.to);
      for (const k of e.transit) {
        const f = Math.max(0, Math.min(1, (now - k.enterAt) / Math.max(k.exitAt - k.enterAt, 0.1)));
        dot(lerp(a, b, f), k);
      }
      const d = S.delay(e);
      if (d > 3) {   // vehicles waiting at the entrance, spread along the jam
        const f = Math.min(0.9, d / 50), n = Math.min(40, e.queue.length + e.busQueue.length);
        const all = e.queue.concat(e.busQueue);
        for (let j = 0; j < n; j++) dot(lerp(a, b, f * (j + 0.5) / n), all[j], (j * 7919) % 13 - 6);
      }
    }
  }
  function dot(p, k, jitter) {
    const pt = map.latLngToContainerPoint(p);
    const bus = k.mode === 'bus';
    ctx.fillStyle = bus ? '#1d4ed8' : '#ef4444';
    const r = bus ? 3.5 : Math.min(4, 1.5 + Math.sqrt(k.veh) / 4);
    const j = jitter || 0;
    ctx.beginPath();
    if (bus) ctx.rect(pt.x - r + j * 0.3, pt.y - r + j * 0.3, r * 2, r * 2); else ctx.arc(pt.x + j * 0.4, pt.y - j * 0.4, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---------- loop ----------
  function loop(now) {
    const dt = now - last; last = now;
    if (playing && S && !S.done) {
      acc += dt * speed;
      while (acc >= STEP_MS && !S.done) {
        acc -= STEP_MS; S.step(); refresh();
        if (S.alerts.length) { pause(); toast(S.alerts.map((a) => a.text).join('　') + '（已暂停，想想怎么办）'); }
        if (S.done) { pause(); end(); }
      }
    }
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  function play() { if (S.done) return; playing = true; $('play').textContent = '⏸ 暂停'; setTool(null); }
  function pause() { playing = false; $('play').textContent = '▶ 继续'; }
  $('play').addEventListener('click', () => (playing ? pause() : play()));
  document.querySelectorAll('.spd').forEach((b) => b.addEventListener('click', () => {
    speed = Number(b.dataset.speed); document.querySelectorAll('.spd').forEach((x) => x.classList.toggle('on', x === b));
  }));
  $('restart').addEventListener('click', () => { pause(); build(); $('play').textContent = '▶ 开始'; });
  $('introOk').addEventListener('click', () => { $('intro').hidden = true; });
  let toastT;
  function toast(s) { const t = $('toast'); t.textContent = s; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 4500); }
  map.on('move zoom', draw);

  // ---------- tools ----------
  function setTool(t) {
    tool = t;
    $('toolPickup').classList.toggle('on', t === 'pickup'); $('toolLane').classList.toggle('on', t === 'lane');
    $('map').classList.toggle('picking', !!t);
    $('toolHint').textContent = t === 'pickup' ? '点地图上人多（橙色）的地方放上车点。周围 2 公里的人会走过来坐车。'
      : t === 'lane' ? `点一条干道开 / 关巴士专线（还剩 ${P.LANES_MAX - S.lanesUsed} 条）。巴士在专线上不堵，但这条路少一条车道给私家车。`
        : '选一个工具，再点地图。用工具时时间自动暂停。';
    if (temp) { temp.remove(); temp = null; }
  }
  $('toolPickup').addEventListener('click', () => { pause(); setTool(tool === 'pickup' ? null : 'pickup'); });
  $('toolLane').addEventListener('click', () => { pause(); setTool(tool === 'lane' ? null : 'lane'); });
  map.on('click', (e) => { if (tool === 'pickup') pickAt(e.latlng); else if (tool === 'lane') laneNear(e.latlng); });
  function laneNear(latlng) {   // the closest of the 13 corridors to where the player clicked
    const pt = map.latLngToContainerPoint(latlng);
    let best = null, bd = Infinity;
    for (const e of S.edges) {
      if (!e.player) continue;
      const a = map.latLngToContainerPoint(ll(e.from)), b = map.latLngToContainerPoint(ll(e.to));
      const dx = b.x - a.x, dy = b.y - a.y, f = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(a.x + f * dx - pt.x, a.y + f * dy - pt.y);
      if (d < bd) { bd = d; best = e; }
    }
    if (best && bd < 40) laneAt(best); else toast('点得离干道近一点');
  }

  function pickAt(latlng) {
    const left = P.FLEET - S.busFleetUsed();
    if (left < 10) { toast('巴士已经全部派出去了，可以从别的上车点调回来（−10）'); return; }
    if (temp) temp.remove();
    temp = L.circle(latlng, { radius: P.PICKUP_KM * 1000, color: '#2563eb', dashArray: '4 6', fillOpacity: 0.1, interactive: false }).addTo(map);
    let n = Math.min(50, left - left % 10);
    const render = () => {
      const pv = S.previewPickup(latlng.lat, latlng.lng, n);
      $('card').hidden = false;
      $('card').innerHTML = `<h3>🚌 在「${pv.area}」放上车点</h3>
        <div class="preview">派 <b>${n}</b> 辆巴士（还能派 ${left}）<input type="range" id="pvN" min="10" max="${Math.min(150, left)}" step="10" value="${n}">
        <div class="kv"><span>周围 2 公里想来、还在家的人</span><span><b>${wan(pv.atHome)}</b></span>
        <span>巴士从这里到启德（按现在路况）</span><span>${pv.ride} 分钟</span>
        <span>跑一个来回</span><span>约 ${pv.cycle} 分钟</span>
        <span>每小时大约能运</span><span><b>${wan(pv.perHour)}</b> 人</span></div>
        <p class="hint">巴士走的路如果堵，来回就慢、运得少——可以给它走的干道开专线。车 ${P.BUS_DEPLOY} 分钟后到。</p>
        <div class="row"><button class="btn main" id="pvOk">派车</button><button class="btn" id="pvNo">取消</button></div></div>`;
      $('pvN').addEventListener('input', (ev) => { n = Number(ev.target.value); render(); });
      $('pvOk').addEventListener('click', () => { S.addPickup(latlng.lat, latlng.lng, n); setTool(null); $('card').hidden = true; refresh(); toast(`派出 ${n} 辆巴士，${P.BUS_DEPLOY} 分钟后到。按 ▶ 继续`); });
      $('pvNo').addEventListener('click', () => { setTool(null); $('card').hidden = true; });
    };
    render();
  }
  function laneAt(e) {
    if (!e.player) { toast('这是连接路，新手关不能开专线；请点 13 条主干道之一'); return; }
    const had = !!e.lane;
    if (!S.toggleLane(e.i)) { toast(`专线最多 ${P.LANES_MAX} 条，先关掉一条`); return; }
    setTool(null); refresh();
    toast(had ? `关掉了 ${e.name} 的专线` : `${e.name} 开巴士专线，${P.LANE_SETUP} 分钟后生效。按 ▶ 继续`);
  }
  $('pickupList').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-pk]'); if (!b) return;
    const k = S.pickups.find((x) => x.id === b.dataset.pk); if (!k) return;
    if (b.dataset.d === 'x') S.removePickup(k.id); else S.setBuses(k, k.buses.length + Number(b.dataset.d));
    refresh();
  });
  $('laneList').addEventListener('click', (ev) => { const b = ev.target.closest('[data-lane]'); if (b) { S.toggleLane(Number(b.dataset.lane)); refresh(); } });

  // ---------- detail card ----------
  function select(s) { sel = s; showCard(); }
  function showCard() {
    const c = $('card'); c.hidden = false;
    if (sel.type === 'edge') {
      const e = S.edges[sel.i], d = S.delay(e), q = S.queueVeh(e);
      const flow = e.flowHist.length ? e.flowHist.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, e.flowHist.length) : 0;
      const src = {}; let tot = 0;
      for (const k of e.queue.concat(e.transit)) { src[k.origin] = (src[k.origin] || 0) + k.veh; tot += k.veh; }
      const top = Object.entries(src).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, v]) => `${node(n).name} ${Math.round(100 * v / tot)}%`).join('、');
      const cap = S.capNow(e) * 60, net = cap - flow * 60;
      c.innerHTML = `<h3>${e.name}${e.player ? '' : '（连接路）'}</h3><div class="kv">
        <span>现在堵</span><span><b>${Math.round(d)} 分钟</b>（排队约 ${wan(q)} 辆车）</span>
        <span>每小时能放行</span><span>${wan(cap)} 辆（平时已有车占掉一部分）</span>
        <span>这些车从哪来</span><span>${top || '—'}</span>
        <span>巴士专线</span><span>${e.lane ? (S.laneOn(e) ? '已开通' : '设置中') : '没有'}</span>
        <span>会不会散</span><span>${q < 50 ? '基本畅通' : net > 0 ? `新来的车比放行的少，约 ${Math.round(q / Math.max(net / 60, 0.1))} 分钟后消散` : '新来的车比放行的多，还在变长'}</span></div>
        <p class="hint">治堵要往上游找：在这些车的出发地放巴士上车点，少一些人开车；或者给这条路开专线让巴士先过。</p>`;
    } else if (sel.type === 'zone') {
      const z = S.zones[sel.i], o = z.opt || {};
      const f = (m) => (o[m] === undefined ? '—' : Math.round(o[m]) + ' 分钟');
      c.innerHTML = `<h3>${z.label} <small>${z.district}</small></h3><div class="kv">
        <span>想来的人</span><span>${wan(z.want)}</span><span>还在家</span><span>${wan(z.home)}</span>
        <span>已出发</span><span>开车 ${wan(z.dep.car)} · 港铁 ${wan(z.dep.rail)} · 巴士 ${wan(z.dep.bus)} · 走路 ${wan(z.dep.walk)}</span>
        <span>放弃了</span><span>${wan(z.gave)}</span>
        <span>平时坐公交去启德</span><span>${Math.round(z.pt)} 分钟</span>
        <span>现在去启德要</span><span>开车 ${f('car')} · 港铁 ${f('rail')} · 巴士 ${f('bus')}${o.walk !== undefined ? ' · 走路 ' + f('walk') : ''}</span></div>
        <p class="hint">${z.newsAt > S.t ? '这里还没收到消息。' : '比平时多太多，人就会放弃。帮他们把时间降下来。'}</p>`;
    } else if (sel.type === 'pk') {
      const k = S.pickups.find((x) => x.id === sel.id);
      if (!k) { c.hidden = true; return; }
      const st = {}; k.buses.forEach((b) => { st[b.state] = (st[b.state] || 0) + 1; });
      c.innerHTML = `<h3>🚌 上车点：${k.area}</h3><div class="kv"><span>巴士</span><span>${k.buses.length} 辆（在路上去启德 ${st.run || 0}、回程 ${st.back || 0}、等客 ${st.board || 0}、赶来中 ${st.deploy || 0}）</span>
        <span>等车的人</span><span>${wan(k.queue)}</span><span>已经送到</span><span>${wan(k.served)}</span></div>`;
    }
  }

  // ---------- the end ----------
  function end() {
    const r = S.summary();
    const carTrips = S.zones.reduce((a, z) => a + z.dep.car, 0) / P.OCC;
    const stars = STARS.filter((x) => r.arrived >= x).length;
    const pct = (a, b) => (b ? Math.round(100 * (a - b) / b) : 0);
    $('endBody').innerHTML = `<h2>👋 外星人飞走了</h2>
      <div class="stars">${'★'.repeat(stars)}<span class="off">${'★'.repeat(3 - stars)}</span></div>
      <table class="res">
        <tr><td>领到礼物</td><td class="n">${wan(r.arrived)}</td><td>什么都不做：${wan(base.arrived)}（${pct(r.arrived, base.arrived) >= 0 ? '+' : ''}${pct(r.arrived, base.arrived)}%）</td></tr>
        <tr><td>放弃的人</td><td class="n">${wan(r.gave)}</td><td>什么都不做：${wan(base.gave)}</td></tr>
        <tr><td>坐你的巴士来的</td><td class="n">${wan(r.by.bus)}</td><td>港铁 ${wan(r.by.rail)} · 开车打车 ${wan(r.by.car)} · 走路 ${wan(r.by.walk)}</td></tr>
        <tr><td>🌿 开车出行</td><td class="n">${wan(carTrips)} 车次</td><td>什么都不做：${wan(base.carTrips)}（${pct(carTrips, base.carTrips)}%）</td></tr>
        <tr><td>🌿 路上车辆总时间</td><td class="n">${wan(r.vehHours)} 车·时</td><td>什么都不做：${wan(base.vehHours)}（${pct(r.vehHours, base.vehHours)}%）</td></tr>
        <tr><td>💰 巴士用量</td><td class="n">${wan(r.busHours)} 车·时</td><td></td></tr></table>
      <div class="egg"><b>🥚 其实……这不是外星人。</b><br>你刚才处理的，就是演唱会、球赛、跨年烟花这类大型活动的真实问题：一大群人在同一段时间要去（或离开）同一个地方。
      你摸到的规律——巴士没有专线就和私家车一起堵、越早出手越好、车要分到几个地方、给最后一段路开专线、一条车道给巴士比给私家车能多运好几倍——正是交通工程师做大型活动交通安排时的思路。</div>
      <div class="row" style="margin-top:12px"><button class="btn main" id="again">再玩一次</button><button class="btn" id="look">留在地图上看看</button></div>`;
    $('end').hidden = false;
    $('again').addEventListener('click', () => { $('end').hidden = true; build(); $('play').textContent = '▶ 开始'; });
    $('look').addEventListener('click', () => { $('end').hidden = true; });
  }

  build();
  window.TLA = { map, get S() { return S; }, base };   // for automatic checks
})();
