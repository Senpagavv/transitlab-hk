(function () {
  'use strict';
  const E = window.Engine, Sim = window.Sim;
  const D = E.init(window.GAME_DATA);
  Sim.init(E, window.METRO_DATA, window.ROAD_DATA);
  const AREA = window.METRO_DATA.area;
  const $ = s => document.querySelector(s);
  const nf = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
  const many = x => (Math.abs(x) >= 10000 ? (x / 10000).toFixed(1) + ' 万' : nf.format(Math.round(x)));
  const yi = x => (x >= 10 ? nf.format(Math.round(x)) : x.toFixed(x >= 1 ? 1 : 2)) + ' 亿';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const METRO = '#7c3aed';

  const EXAMPLES = [
    { name: '东九龙线（示意）', st: [[114.2013, 22.3400], [114.2090, 22.3335], [114.2240, 22.3310], [114.2305, 22.3205], [114.2376, 22.2971]] },
    { name: '沙田 → 西贡', st: [[114.1878, 22.3824], [114.2149, 22.38183], [114.2500, 22.3740], [114.2740, 22.3825]] },
  ];

  // ---------- 地图 ----------
  const map = L.map('map', { minZoom: 10, maxZoom: 18, zoomControl: false, doubleClickZoom: false,
    maxBounds: [[22.05, 113.7], [22.65, 114.55]] }).setView([22.35, 114.13], 11);
  L.control.zoom({ position: 'topright' }).addTo(map);
  map.attributionControl.setPrefix(false);
  const LANDSD = 'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/';
  L.tileLayer(LANDSD + 'basemap/WGS84/{z}/{x}/{y}.png', { maxZoom: 18,
    attribution: '<img class="attr-logo" src="https://api.hkmapservice.gov.hk/mapapi/landsdlogo.jpg" alt="">'
      + '<a href="https://api.portal.hkmapservice.gov.hk/disclaimer" target="_blank" rel="noopener">© 香港特别行政区政府 地政总署</a>' }).addTo(map);
  map.createPane('labels').style.zIndex = 450;
  map.getPane('labels').style.pointerEvents = 'none';
  L.tileLayer(LANDSD + 'label/hk/tc/WGS84/{z}/{x}/{y}.png', { pane: 'labels', maxZoom: 18 }).addTo(map);
  map.createPane('lines').style.zIndex = 470;
  const lineRenderer = L.svg({ pane: 'lines', padding: 0.5 });

  // ---------- 分区图层 ----------
  const pop0 = D.zones.map(z => z.pop);
  let layerMode = 'dens0', snap = null;
  const DENS = [[1000, '#fef0d9'], [5000, '#fdd49e'], [10000, '#fdbb84'], [20000, '#fc8d59'], [40000, '#ef6548'], [60000, '#d7301f'], [Infinity, '#990000']];
  const CHG = [[-2, '#2166ac'], [-0.5, '#67a9cf'], [-0.1, '#d1e5f0'], [0.1, null], [0.5, '#fddbc7'], [2, '#ef8a62'], [Infinity, '#b2182b']];
  const densColor = d => DENS.find(([t]) => d < t)[1];
  const chgColor = p => CHG.find(([t]) => p < t)[1];

  const zoneLayer = L.geoJSON(window.GAME_DATA.geo, {
    style: f => zoneStyle(f.properties.i),
    onEachFeature: (f, l) => l.bindTooltip(() => zoneTip(f.properties.i), { sticky: true, direction: 'top', opacity: 0.95 }),
  }).addTo(map);

  const popNow = i => (snap ? snap.pop[i] : pop0[i]);
  function zoneStyle(i) {
    const edge = { color: '#6b7785', weight: 0.5, opacity: 0.3 };
    const a = AREA[i];
    if (layerMode === 'dens0' || layerMode === 'dens1') {
      const p = layerMode === 'dens1' ? popNow(i) : pop0[i];
      if (!(a > 0) || p < 1) return Object.assign(edge, { fillOpacity: 0 });
      return Object.assign(edge, { fillColor: densColor(p / a), fillOpacity: 0.55 });
    }
    if (layerMode === 'change' && snap) {
      if (!(pop0[i] > 0)) return Object.assign(edge, { fillOpacity: 0 });
      const c = chgColor((snap.pop[i] - pop0[i]) / pop0[i] * 100);
      return Object.assign(edge, c ? { fillColor: c, fillOpacity: 0.7 } : { fillOpacity: 0 });
    }
    if (layerMode === 'riders' && snap) {
      const mx = Math.max(1, ...snap.zoneRiders), v = snap.zoneRiders[i];
      return Object.assign(edge, v >= 1 ? { fillColor: '#f08a24', fillOpacity: 0.08 + 0.67 * Math.sqrt(v / mx) } : { fillOpacity: 0 });
    }
    return Object.assign(edge, { fillOpacity: 0, opacity: 0.15 });
  }
  function zoneTip(i) {
    const z = D.zones[i], a = AREA[i];
    let s = `<b>${z.name}</b>（${z.district}）<br>现在住 ${many(pop0[i])} 人`;
    if (a > 0) s += `，每平方公里 ${many(pop0[i] / a)} 人`;
    if (snap) {
      const d = snap.pop[i] - pop0[i];
      s += `<br>开线后 ${many(snap.pop[i])} 人（${d >= 0 ? '+' : '−'}${nf.format(Math.abs(Math.round(d)))}，${(d / Math.max(pop0[i], 1) * 100).toFixed(2)}%）`;
      if (snap.zoneRiders[i] >= 1) s += `<br>每天约 ${many(snap.zoneRiders[i])} 人次坐新线`;
    }
    return s;
  }
  function recolor() { zoneLayer.setStyle(f => zoneStyle(f.properties.i)); renderLegend(); }

  function renderLegend() {
    const L2 = $('#legend');
    if (layerMode === 'dens0' || layerMode === 'dens1') {
      const labels = ['< 1 千', '1–5 千', '5 千–1 万', '1–2 万', '2–4 万', '4–6 万', '> 6 万'];
      L2.innerHTML = `<div>${layerMode === 'dens1' ? '开线后' : '现在'}的人口密度（人 / 平方公里）</div>`
        + DENS.map(([, c], k) => `<div class="key"><i style="background:${c}"></i>${labels[k]}</div>`).join('');
    } else if (layerMode === 'change') {
      const labels = ['少 2% 以上', '少 0.5–2%', '少 0.1–0.5%', null, '多 0.1–0.5%', '多 0.5–2%', '多 2% 以上'];
      L2.innerHTML = '<div>人口变化（开线后 vs 现在）</div>'
        + CHG.map(([, c], k) => (c ? `<div class="key"><i style="background:${c}"></i>${labels[k]}</div>` : '<div class="key"><i class="empty"></i>变化不到 0.1%</div>')).join('');
    } else if (layerMode === 'riders') {
      L2.innerHTML = '<div>每天坐新线的人次（起点或终点在这个区）</div><div class="ramp"></div><div class="ends"><span>少</span><span>多</span></div>';
    } else L2.innerHTML = '';
    L2.hidden = !L2.innerHTML;
    if (path) L2.innerHTML += `<div class="key"><i style="background:${METRO}"></i>新线：越粗越挤，橙 / 红 = 接近 / 超过运力</div>`;
  }
  $('#layers').addEventListener('change', e => { if (e.target.name === 'layer') { layerMode = e.target.value; recolor(); } });
  function enableLayers(on) {
    ['dens1', 'change', 'riders'].forEach(v => { $(`input[value="${v}"]`).disabled = !on; });
  }
  function setLayer(v) { layerMode = v; $(`input[value="${v}"]`).checked = true; recolor(); }

  // ---------- 线路 ----------
  let path = null, cum = null, stationKm = [], markers = [], drawn = [], running = false, result = null;
  const KX = 111.32 * Math.cos(22.35 * Math.PI / 180), KY = 110.57;

  function setPath(p, stKm) {
    path = p;
    cum = [0];
    for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + E.km(path[k - 1], path[k]));
    stationKm = Sim.landStations(path, stKm ? stKm.slice() : evenStations());
    snap = null; result = null; enableLayers(false);
    if (layerMode !== 'dens0' && layerMode !== 'none') setLayer('dens0');
    $('#result').hidden = true; $('#progress').hidden = true; $('#edit').hidden = false;
    $('#step').textContent = '线画好了。拖车站调整，或者直接开始算。';
    redrawLine(); placeMarkers(); updateInfo(); renderLegend();
  }
  const total = () => cum[cum.length - 1];
  function evenStations() {
    const sp = +$('#spacing').value, L1 = total(), k = Math.max(1, Math.round(L1 / sp));
    return Array.from({ length: k + 1 }, (_, q) => L1 * q / k);
  }
  function at(km) {
    let k = 1; while (k < path.length - 1 && cum[k] < km) k++;
    const f = cum[k] > cum[k - 1] ? Math.min(1, Math.max(0, (km - cum[k - 1]) / (cum[k] - cum[k - 1]))) : 0;
    return [path[k - 1][0] + (path[k][0] - path[k - 1][0]) * f, path[k - 1][1] + (path[k][1] - path[k - 1][1]) * f];
  }
  // 车站只能建在陆地上（线可以走海底隧道，站不行）：规则在 sim.js（trimToLand、landStations），这里只管拖和点。
  const wetAt = km => { const p = at(km); return E.isWater(p[0], p[1]); };
  function project(lon, lat) {
    let best = { d: Infinity, km: 0 };
    for (let k = 1; k < path.length; k++) {
      const ax = path[k - 1][0] * KX, ay = path[k - 1][1] * KY, bx = path[k][0] * KX, by = path[k][1] * KY, px = lon * KX, py = lat * KY;
      const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2)) : 0;
      const d = Math.hypot(ax + vx * t - px, ay + vy * t - py);
      if (d < best.d) best = { d, km: cum[k - 1] + (cum[k] - cum[k - 1]) * t };
    }
    return best;
  }
  function slice(km0, km1) {
    const out = [at(km0)];
    for (let k = 1; k < path.length - 1; k++) if (cum[k] > km0 && cum[k] < km1) out.push(path[k]);
    out.push(at(km1));
    return out.map(p => [p[1], p[0]]);
  }

  function redrawLine() {
    drawn.forEach(l => map.removeLayer(l)); drawn = [];
    if (!path) return;
    const ll = path.map(p => [p[1], p[0]]);
    const casing = L.polyline(ll, { renderer: lineRenderer, color: '#fff', weight: 11, opacity: 0.9 }).addTo(map);
    casing.on('click', e => addStation(e.latlng));
    drawn.push(casing);
    const loads = snap ? snap.loads : null, cap = snap ? snap.cap : 1;
    const maxLoad = loads ? Math.max(1, ...loads[0], ...loads[1]) : 1;
    for (let s = 0; s < stationKm.length - 1; s++) {
      let color = METRO, w = 6;
      if (loads) {
        const v = Math.max(loads[0][s] || 0, loads[1][s] || 0), lf = v / cap;
        w = 4 + 9 * v / maxLoad; color = lf > 1 ? '#c23a2b' : lf > 0.8 ? '#c98200' : METRO;
      }
      const seg = L.polyline(slice(stationKm[s], stationKm[s + 1]), { renderer: lineRenderer, color, weight: w });
      seg.on('click', e => addStation(e.latlng));
      if (loads) seg.bindTooltip(`第 ${s + 1}–${s + 2} 站 早高峰：往后 ${many(loads[0][s])} 人/时，往前 ${many(loads[1][s])} 人/时（运力 ${many(cap)}）`, { sticky: true });
      drawn.push(seg.addTo(map));
    }
    if (snap) {
      drawn.push(L.polyline(ll, { renderer: lineRenderer, color: '#fff', weight: 2.5, className: 'flow', interactive: false }).addTo(map));
    }
  }

  function placeMarkers() {
    markers.forEach(m => map.removeLayer(m)); markers = [];
    stationKm.forEach((km, k) => {
      const p = at(km), end = k === 0 || k === stationKm.length - 1;
      const m = L.marker([p[1], p[0]], { draggable: !end && !running,
        icon: L.divIcon({ className: '', html: `<div class="st-dot${end ? ' end' : ''}"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] }) }).addTo(map);
      m.bindTooltip(() => stationTip(markers.indexOf(m)), { direction: 'top', offset: [0, -8] });
      m.on('drag', () => {
        const q = m.getLatLng(), i = markers.indexOf(m), pr = project(q.lng, q.lat);
        const km2 = Math.max(stationKm[i - 1] + 0.2, Math.min(stationKm[i + 1] - 0.2, pr.km));
        if (!wetAt(km2)) stationKm[i] = km2;          // 拖到海上就停在岸边，不跟过去
        const pt = at(stationKm[i]); m.setLatLng([pt[1], pt[0]]);
      });
      m.on('dragend', () => { redrawLine(); updateInfo(); });
      m.on('contextmenu', () => {
        if (running || end) return;
        stationKm.splice(markers.indexOf(m), 1); placeMarkers(); redrawLine(); updateInfo();
      });
      markers.push(m);
    });
  }
  function stationTip(k) {
    const p = stationKm[k] !== undefined ? at(stationKm[k]) : null;
    let near = '';
    if (p) { let b = null; D.zones.forEach(z => { const d = E.km(p, [z.lon, z.lat]); if (!b || d < b.d) b = { d, z }; }); near = b.z.name; }
    let s = `<b>第 ${k + 1} 站</b> · ${near}附近`;
    if (snap && snap.board[k] !== undefined) s += `<br>每天上下车约 ${many(snap.board[k])} 人次`;
    const end = k === 0 || k === stationKm.length - 1;
    return s + (running ? '' : end ? '<br>首末站固定在线的两头' : '<br>拖动沿线挪；右键删掉');
  }
  function addStation(ll) {
    if (running || !path) return;
    const pr = project(ll.lng, ll.lat);
    if (stationKm.some(k => Math.abs(k - pr.km) < 0.3)) return;
    if (wetAt(pr.km)) { $('#step').textContent = '这里在海上，车站要建在岸上'; return; }
    stationKm.push(pr.km); stationKm.sort((a, b) => a - b);
    placeMarkers(); redrawLine(); updateInfo();
  }

  function updateInfo() {
    const line = Sim.lineFrom(path, stationKm), P = Sim.P;
    const capex = (line.len - line.waterKm) * P.costLandPerKm + line.waterKm * P.costWaterPerKm + stationKm.length * P.costStation;
    $('#lineInfo').innerHTML = `
      <div><dt>线长</dt><dd>${line.len.toFixed(1)}<small> 公里${line.waterKm >= 0.3 ? `，过海 ${line.waterKm.toFixed(1)}` : ''}</small></dd></div>
      <div><dt>车站</dt><dd>${stationKm.length}<small> 个</small></dd></div>
      <div><dt>造价约</dt><dd>${yi(capex)}</dd></div>`;
    const wet = line.stations.filter(p => E.isWater(p[0], p[1])).length;
    $('#wetNote').textContent = wet ? `有 ${wet} 个站落在海上，没人能走进去。拖到岸上，或右键删掉。` : '';
    $('#spacingOut').textContent = `${(+$('#spacing').value).toFixed(1)} 公里`;
  }
  $('#spacing').addEventListener('input', () => { if (!path || running) return; stationKm = Sim.landStations(path, evenStations()); placeMarkers(); redrawLine(); updateInfo(); });
  $('#redraw').addEventListener('click', () => { if (running) return; clearLine(); });
  function clearLine() {
    drawn.forEach(l => map.removeLayer(l)); drawn = []; markers.forEach(m => map.removeLayer(m)); markers = [];
    path = null; snap = null; result = null; enableLayers(false); setLayer('dens0');
    $('#edit').hidden = true; $('#progress').hidden = true; $('#result').hidden = true;
    $('#step').textContent = '在地图上双击并按住，拖出线路';
  }

  // ---------- 画线：双击并按住拖，或打开画线模式后直接按住拖 ----------
  const box = map.getContainer();
  let drawMode = false, lastDown = { t: 0, x: 0, y: 0 }, drawing = null, temp = null;
  $('#drawMode').addEventListener('click', () => {
    drawMode = !drawMode; $('#drawMode').setAttribute('aria-pressed', drawMode);
    box.style.cursor = drawMode ? 'crosshair' : '';
    box.style.touchAction = drawMode ? 'none' : '';
  });
  box.addEventListener('pointerdown', e => {
    if (running || e.button !== 0 || e.target.closest('.leaflet-control, .leaflet-marker-icon') || map.getPane('lines').contains(e.target)) return;
    const now = performance.now();
    const dbl = now - lastDown.t < 400 && Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) < 20;
    lastDown = { t: now, x: e.clientX, y: e.clientY };
    if (!drawMode && !dbl) return;
    e.preventDefault(); e.stopPropagation();
    map.dragging.disable();
    box.setPointerCapture(e.pointerId);
    drawing = [map.mouseEventToLatLng(e)];
    temp = L.polyline(drawing, { renderer: lineRenderer, color: METRO, weight: 5, opacity: 0.8, dashArray: '8 6', interactive: false }).addTo(map);
    $('#step').textContent = '画着呢……松开鼠标就好';
  }, true);
  box.addEventListener('pointermove', e => {
    if (!drawing) return;
    e.stopPropagation();
    const p = map.mouseEventToContainerPoint(e), last = map.latLngToContainerPoint(drawing[drawing.length - 1]);
    if (p.distanceTo(last) < 5) return;
    drawing.push(map.mouseEventToLatLng(e)); temp.setLatLngs(drawing);
  }, true);
  const endDraw = e => {
    if (!drawing) return;
    e.stopPropagation();
    map.dragging.enable(); map.removeLayer(temp);
    const raw = simplify(drawing.map(ll => [ll.lng, ll.lat]), 0.02);
    drawing = null; lastDown.t = 0;
    const pts = Sim.trimToLand(raw);
    if (!pts) { $('#step').textContent = '整条线都在海上，车站没地方建。从岸上开始画'; return; }
    let len = 0; for (let k = 1; k < pts.length; k++) len += E.km(pts[k - 1], pts[k]);
    if (len < 0.8) { $('#step').textContent = '线太短了（不到 0.8 公里，伸到海里的线头已收回岸上），再画一次'; return; }
    setPath(pts);
    if (pts !== raw) $('#step').textContent = '线头伸到了海里，已收回岸上（首末站要建在陆地上）。拖车站调整，或者直接开始算。';
  };
  box.addEventListener('pointerup', endDraw, true);
  box.addEventListener('pointercancel', endDraw, true);

  function simplify(pts, tolKm) {
    if (pts.length < 3) return pts;
    const xy = pts.map(p => [p[0] * KX, p[1] * KY]), keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop(); let far = -1, fd = 0;
      const [ax, ay] = xy[a], [bx, by] = xy[b], vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
      for (let k = a + 1; k < b; k++) {
        const t = L2 > 0 ? Math.max(0, Math.min(1, ((xy[k][0] - ax) * vx + (xy[k][1] - ay) * vy) / L2)) : 0;
        const d = Math.hypot(ax + vx * t - xy[k][0], ay + vy * t - xy[k][1]);
        if (d > fd) { fd = d; far = k; }
      }
      if (fd > tolKm) { keep[far] = 1; stack.push([a, far], [far, b]); }
    }
    return pts.filter((_, k) => keep[k]);
  }

  // ---------- 开始算 ----------
  $('#go').addEventListener('click', async () => {
    if (running || !path) return;
    running = true;
    ['#go', '#redraw', '#spacing', '#drawMode'].forEach(s => { $(s).disabled = true; });
    placeMarkers();
    $('#result').hidden = true; $('#progress').hidden = false;
    $('#progTitle').textContent = '正在算……';
    $('#step').textContent = '在算，别动线路。地图会一轮一轮变化。';
    enableLayers(true); setLayer('change');
    const line = Sim.lineFrom(path, stationKm);
    const t0 = performance.now();
    result = await Sim.run(line, async s => {
      snap = s;
      recolor(); redrawLine(); renderSpark(s.history);
      const h = s.history[s.history.length - 1];
      $('#progNote').textContent = h.round === 1 ? '第 1 轮做完，接着把结果回代再算……'
        : `第 ${h.round} 轮：和上一轮差 ${(h.change * 100).toFixed(1)}%${h.change < Sim.P.tol ? '，稳了' : '，还在变'}`;
      await sleep(700);
    }, (round, stepId, text) => {
      $('#progTitle').textContent = `第 ${round} 轮 · ${text}`;
      document.querySelectorAll('#steps li').forEach(li => li.classList.toggle('on', +li.dataset.s === stepId));
    });
    document.querySelectorAll('#steps li').forEach(li => li.classList.remove('on'));
    $('#progTitle').textContent = `算完了：${result.history.length} 轮${result.converged ? '稳定' : '（到上限，还没完全稳）'}，用时 ${((performance.now() - t0) / 1000).toFixed(0)} 秒`;
    renderResult(line);
    running = false;
    ['#go', '#redraw', '#spacing', '#drawMode'].forEach(s => { $(s).disabled = false; });
    $('#go').textContent = '改好了，重新算';
    $('#step').textContent = '可以继续调车站，再点「重新算」。';
    placeMarkers();
  });

  function renderSpark(hs) {
    const W = 300, H = 110, l = 34, r = 34, t = 16, b = 20, n = Math.max(hs.length, 4);
    const X = i => l + i / (n - 1) * (W - l - r);
    const series = [
      { key: 'ridersDay', color: METRO, label: '坐新线（万人次/日）', f: v => (v / 1e4).toFixed(1) },
      { key: 'popMoved', color: '#d7301f', label: '搬到沿线（人）', f: v => nf.format(Math.round(v)) },
    ];
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="每一轮的变化">`;
    series.forEach((se, k) => {
      const vals = hs.map(h => h[se.key]), hi = Math.max(...vals) * 1.1 || 1;
      const Y = v => t + (1 - v / hi) * (H - t - b);
      s += `<polyline fill="none" stroke="${se.color}" stroke-width="2" points="${vals.map((v, i) => `${X(i)},${Y(v)}`).join(' ')}"/>`;
      vals.forEach((v, i) => { s += `<circle cx="${X(i)}" cy="${Y(v)}" r="2.5" fill="${se.color}"/>`; });
      const lv = vals[vals.length - 1];
      s += `<text x="${k ? W - r + 3 : l - 3}" y="${Y(lv) + 3}" font-size="10" fill="${se.color}" text-anchor="${k ? 'start' : 'end'}">${se.f(lv)}</text>`;
      s += `<text x="${k ? W - 4 : 4}" y="10" font-size="10" fill="${se.color}" text-anchor="${k ? 'end' : 'start'}">${se.label}</text>`;
    });
    for (let i = 0; i < n; i++) s += `<text x="${X(i)}" y="${H - 5}" font-size="9.5" fill="#5d6874" text-anchor="middle">${i + 1}</text>`;
    $('#spark').innerHTML = s + '</svg><div class="spark-x">第几轮</div>';
  }

  function renderResult(line) {
    const R = result, h = R.history[R.history.length - 1], P = Sim.P;
    const maxLoad = Math.max(0, ...snap.loads[0], ...snap.loads[1]);
    const cls = R.payback <= 30 ? 'good' : R.payback <= 80 ? 'mid' : 'bad';
    const word = R.payback <= 30 ? '值得修' : R.payback <= 80 ? '勉强' : '不值';
    const why = h.ridersDay < 50000 ? `坐的人少：每天 ${many(h.ridersDay)} 人次。`
      : R.payback > 80 ? '坐的人不少，但地铁造价高，光靠省时间回不了本（没算站旁地价）。' : `省下的时间约 ${Math.round(R.payback)} 年抵得上造价。`;
    const streets = R.streets.filter(x => x.vehMin > 0).map(x => x.name).join('、');
    $('#result').innerHTML = `
      <div class="verdict"><span class="pill ${cls}">${word}</span><span class="why">${why}</span></div>
      <dl class="nums">
        <div><dt>造价约</dt><dd>${yi(R.capex)}<small> · ${line.len.toFixed(1)} 公里${line.waterKm >= 0.3 ? `（过海 ${line.waterKm.toFixed(1)}）` : ''} · ${stationKm.length} 个站</small></dd></div>
        <div><dt>每天坐新线</dt><dd>${many(h.ridersDay)}<small> 人次</small></dd></div>
        <div><dt>每天少开车</dt><dd>${many(h.carTripsDay)}<small> 人次 · 路上约少 ${many(h.carTripsDay / window.METRO_DATA.carOcc)} 车次</small></dd></div>
        <div><dt>搬到沿线</dt><dd>${many(h.popMoved)}<small> 人（全港总人口不变，从别处搬来）</small></dd></div>
        <div><dt>每年省下的时间折合</dt><dd>${yi(R.timeYr)}<small> · 坐公交的人省 ${many(R.ptMinSavedDay / 60)} 小时/日，开车的人省 ${many(R.carMinSavedDay / 60)} 小时/日</small></dd></div>
        <div><dt>多少年回本（只算省下的时间）</dt><dd>${Number.isFinite(R.payback) ? nf.format(Math.round(R.payback)) : '—'}<small> 年</small></dd></div>
        <div><dt>每年票价收入 / 运营费</dt><dd>${yi(R.revenueYr)} / ${yi(R.opexYr)}<small> · ${R.revenueYr >= R.opexYr ? '够付运营' : '不够付运营'}</small></dd></div>
        <div><dt>最挤一段（早高峰每小时）</dt><dd>${many(maxLoad)}<small> 人 · 运力 ${many(snap.cap)}</small></dd></div>
      </dl>
      ${streets ? `<p class="note"><b>变顺最多的路：</b>${streets}</p>` : ''}
      ${line.unreachable ? `<p class="note">有 ${line.unreachable} 个站周围 1.5 公里内没有能走过去的地方（在海上或隔着海），这些站没人上下车。</p>` : ''}`;
    $('#result').hidden = false;
  }

  EXAMPLES.forEach(x => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = x.name;
    b.addEventListener('click', () => {
      if (running) return;
      clearLine();
      const c = [0]; for (let k = 1; k < x.st.length; k++) c.push(c[k - 1] + E.km(x.st[k - 1], x.st[k]));
      setPath(x.st, c);
      map.fitBounds(L.latLngBounds(x.st.map(p => [p[1], p[0]])), { paddingTopLeft: window.innerWidth > 640 ? [380, 60] : [30, 30], paddingBottomRight: [60, 60], maxZoom: 14 });
    });
    $('#examples').appendChild(b);
  });
  renderLegend();
})();
