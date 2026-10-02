/* TransitLab 修地铁 - playable demo page. Talks to the engine at /game/api (game/api.py). */
(function () {
  'use strict';

  const API = 'api/';
  const LANDSD = 'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/';
  const COLORS = ['#e4572e', '#2e86ab', '#3c9d4e', '#9b5de5', '#f1a208', '#d6336c'];
  const TYPE_ZH = { tunnel: '隧道', viaduct: '高架', surface: '地面' };
  const TYPE_NEXT = { tunnel: 'viaduct', viaduct: 'surface', surface: 'tunnel' };
  const SNAP_EXISTING_M = 150, SNAP_SHARED_M = 100;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- small helpers ----------
  function wan(n, digits = 1) {
    n = Number(n) || 0;
    const a = Math.abs(n);
    if (a >= 1e8) return (n / 1e8).toFixed(digits) + ' 亿';
    if (a >= 1e4) return (n / 1e4).toFixed(digits) + ' 万';
    return Math.round(n).toLocaleString('zh-CN');
  }
  const num = (n) => Math.round(Number(n) || 0).toLocaleString('zh-CN');
  function metres(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  async function get(path) {
    const r = await fetch(API + path);
    if (!r.ok) throw new Error(path + ' ' + r.status);
    return r.json();
  }
  let toastTimer;
  function toast(text) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }
  function store(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ } }
  function load(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }

  // ---------- map ----------
  const map = L.map('map', { minZoom: 10, maxZoom: 18, zoomControl: false, doubleClickZoom: false,
    maxBounds: [[22.0, 113.7], [22.7, 114.55]] }).setView([22.39, 114.11], 11);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.attributionControl.setPrefix(false);
  L.tileLayer(LANDSD + 'basemap/WGS84/{z}/{x}/{y}.png', { maxZoom: 18,
    attribution: '地图 © 香港地政总署　数据：政府统计处、运输署、规划署等（见项目 data-sources）' }).addTo(map);
  map.createPane('labels'); map.getPane('labels').style.zIndex = 450; map.getPane('labels').style.pointerEvents = 'none';
  L.tileLayer(LANDSD + 'label/hk/tc/WGS84/{z}/{x}/{y}.png', { pane: 'labels', maxZoom: 18 }).addTo(map);
  map.createPane('heat'); map.getPane('heat').style.zIndex = 350;
  map.createPane('draw'); map.getPane('draw').style.zIndex = 620;

  const layers = { pop: null, jobs: null, unserved: null, flows: L.layerGroup(), mtr: L.layerGroup(), result: L.layerGroup(), scenario: L.layerGroup() };
  const drawLayer = L.layerGroup().addTo(map);
  let searchMarker = null;

  // ---------- state ----------
  let BOOT = null;
  const S = { mode: 'free', lines: [], active: -1, selected: null, running: false, result: null, scenarioInfo: null };
  const segCache = {};
  const cardCache = {};

  function design() {
    return { lines: S.lines.filter((l) => l.points.filter((p) => p.kind === 'station').length >= 2).map((l) => ({
      id: l.id, name: l.name, headway_min: l.headway,
      points: l.points.map((p) => ({ lon: p.lng, lat: p.lat, kind: p.kind, dev: p.dev || null, name: p.name || null })),
      segment_types: l.segs.map((s) => s.override || null),
    })) };
  }
  function save() { store('tl-design-' + S.mode, S.lines); }

  // ---------- boot ----------
  async function boot() {
    for (;;) {
      try {
        const b = await get('boot');
        if (b.ready) { BOOT = b; break; }
        if (b.stage === 'error') { $('loading').textContent = '模型载入失败：' + b.error; return; }
      } catch (e) { /* server starting */ }
      await new Promise((r) => setTimeout(r, 1500));
    }
    $('loading').hidden = true;
    const bounds = BOOT.layer_bounds;
    for (const name of ['pop', 'jobs', 'unserved']) {
      layers[name] = L.imageOverlay(API + 'layer/' + name + '.png', bounds, { pane: 'heat', opacity: 0.85 });
    }
    drawMtr();
    drawFlows(BOOT.corridors);
    applyLayers();
    $('nick').value = load('tl-nick', '');
    setMode(load('tl-mode', 'free'));
    if (!load('tl-intro', false)) $('intro').hidden = false;
  }

  function drawMtr() {
    layers.mtr.clearLayers();
    for (const s of BOOT.existing) {
      L.circleMarker([s.lat, s.lon], { radius: 4, color: '#4a5560', weight: 2, fillColor: '#fff', fillOpacity: 1, pane: 'markerPane' })
        .bindTooltip(`<b>${esc(s.name_zh)}站</b>（${s.lines.join(' / ')}）<br>800 米内：住 ${wan(s.pop)} 人 · 岗位 ${wan(s.jobs)}`)
        .addTo(layers.mtr);
    }
  }

  function arrow(from, to, weight, color, text) {
    // a gentle curve so two-way flows do not overlap, with a head at the end
    const mid = L.latLng((from.lat + to.lat) / 2, (from.lng + to.lng) / 2);
    const dx = to.lng - from.lng, dy = to.lat - from.lat;
    const ctrl = L.latLng(mid.lat - dx * 0.18, mid.lng + dy * 0.18);
    const pts = [];
    for (let t = 0; t <= 1.0001; t += 0.05) {
      pts.push(L.latLng((1 - t) ** 2 * from.lat + 2 * (1 - t) * t * ctrl.lat + t * t * to.lat,
        (1 - t) ** 2 * from.lng + 2 * (1 - t) * t * ctrl.lng + t * t * to.lng));
    }
    const g = L.layerGroup();
    L.polyline(pts, { color, weight, opacity: 0.75, lineCap: 'round' }).bindTooltip(text, { sticky: true, className: 'flow' }).addTo(g);
    const a = map.latLngToLayerPoint(pts[pts.length - 2]), b = map.latLngToLayerPoint(pts[pts.length - 1]);
    const ang = Math.atan2(b.y - a.y, b.x - a.x), size = 8 + weight;
    const head = [b, L.point(b.x - size * Math.cos(ang - 0.45), b.y - size * Math.sin(ang - 0.45)),
      L.point(b.x - size * Math.cos(ang + 0.45), b.y - size * Math.sin(ang + 0.45))].map((p) => map.layerPointToLatLng(p));
    L.polygon(head, { color, weight: 1, fillColor: color, fillOpacity: 0.9 }).addTo(g);
    return g;
  }
  let lastFlows = null;
  function drawFlows(list) {
    lastFlows = list;
    layers.flows.clearLayers();
    if (!list || !list.length) return;
    const top = list[0].people;
    for (const f of list) {
      const w = 3 + 13 * f.people / top;
      arrow(L.latLng(f.from_lat, f.from_lon), L.latLng(f.to_lat, f.to_lon), w, '#7c3aed',
        `早高峰 8–9 点：<b>${esc(f.from)} → ${esc(f.to)}</b><br>约 ${wan(f.people)} 人坐公交，两区中心相距 ${f.km} 公里`).addTo(layers.flows);
    }
  }
  map.on('zoomend', () => { if (lastFlows) drawFlows(lastFlows); });

  function applyLayers() {
    document.querySelectorAll('#layers .chip').forEach((c) => {
      const name = c.dataset.layer, on = c.classList.contains('on');
      const layer = name === 'flows' ? layers.flows : layers[name];
      if (!layer) return;
      if (on && !map.hasLayer(layer)) layer.addTo(map);
      if (!on && map.hasLayer(layer)) map.removeLayer(layer);
    });
    legend();
  }
  $('layers').addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    c.classList.toggle('on');
    // the three heat maps are easier to read one at a time
    if (c.classList.contains('on') && ['pop', 'jobs', 'unserved'].includes(c.dataset.layer)) {
      document.querySelectorAll('#layers .chip').forEach((o) => {
        if (o !== c && ['pop', 'jobs', 'unserved'].includes(o.dataset.layer)) o.classList.remove('on');
      });
    }
    applyLayers();
  });
  function legend() {
    const on = (n) => document.querySelector(`#layers .chip[data-layer="${n}"]`).classList.contains('on');
    const rows = [];
    if (on('pop')) rows.push('<b>人口</b>：颜色越深每平方公里住的人越多（浅 = 1 千，深 = 10 万）');
    if (on('jobs')) rows.push('<b>岗位</b>：颜色越深每平方公里的工作岗位越多');
    if (on('unserved')) rows.push('<b>离港铁远的人</b>：住或工作在离港铁站超过 800 米的地方。深橙 = 很多人要先坐巴士才能搭港铁');
    if (on('flows')) rows.push('<b>主要人流</b>：早高峰坐公交、人多又走得远的 12 条区与区之间的人流，越粗人越多');
    if (S.mode === 'north' && S.scenarioInfo) rows.push('<b>紫色圆点</b>：题目里新增居民住的地方，越大人越多');
    if (on('result') && S.result) rows.push('<b>结果</b>：线越粗 = 早高峰越多人坐（绿 → 橙 → 红 = 越来越挤）；绿圈 = 站的上车人数；蓝圈 = 这里出发的人每天共省下的时间');
    $('legend').innerHTML = rows.join('<br>');
    $('legend').hidden = !rows.length;
  }

  // ---------- modes ----------
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  async function setMode(mode) {
    if (S.running) return;
    S.mode = mode; store('tl-mode', mode);
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    S.lines = load('tl-design-' + mode, []);
    S.lines.forEach((l) => { l.segs = l.segs || []; });
    S.active = -1; S.selected = null; S.result = null;
    $('results').hidden = true; $('progress').hidden = true;
    layers.result.clearLayers(); layers.scenario.clearLayers();
    document.querySelector('#layers .chip[data-layer="result"]').hidden = true;
    const story = $('story');
    if (mode === 'north') {
      const sc = BOOT.scenarios.north;
      story.innerHTML = `<b>题目：${esc(sc.title)}</b><br>${esc(sc.story)}<br><span class="hint">预算 ${num(sc.budget_yi)} 亿港元；超预算总分打 7 折。满分 100：通勤更快 30 · 少开车 15 · 账算得过来 40 · 新线有人坐 15。</span>`;
      story.hidden = false;
      layers.scenario.addTo(map);
      loadScenario();
    } else {
      story.hidden = true;
      if (map.hasLayer(layers.scenario)) map.removeLayer(layers.scenario);
      drawFlows(BOOT.corridors);
    }
    $('goHint').textContent = mode === 'north' ? '完整模型跑 4 轮，约 30 秒（第一次多算一遍「没有新线的北都」，约 1 分钟）' : '完整模型跑 4 轮，约 30 秒';
    render(); renderHistory(); legend();
  }
  async function loadScenario() {
    for (let i = 0; i < 60 && S.mode === 'north'; i++) {
      const info = await get('scenario/north').catch(() => ({ ready: false }));
      if (info.ready) {
        S.scenarioInfo = info;
        layers.scenario.clearLayers();
        for (const z of info.zones) {
          L.circleMarker([z.lat, z.lon], { radius: 3 + Math.sqrt(z.residents) / 12, color: '#7c3aed', weight: 1, fillColor: '#a78bfa', fillOpacity: 0.55 })
            .bindTooltip(`${esc(z.label)}：新增约 ${wan(z.residents)} 居民`).addTo(layers.scenario);
        }
        drawFlows(info.corridors);
        legend();
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  // ---------- drawing ----------
  function segKey(a, b) { return [a.lat, a.lng, b.lat, b.lng].map((v) => v.toFixed(5)).join(','); }
  function segInfo(a, b) {
    const k = segKey(a, b);
    if (segCache[k]) return segCache[k];
    segCache[k] = { pending: true };
    get(`segment?lon0=${a.lng}&lat0=${a.lat}&lon1=${b.lng}&lat1=${b.lat}`).then((r) => { segCache[k] = r; render(); })
      .catch(() => { delete segCache[k]; });
    return segCache[k];
  }
  function segType(line, i) {
    const s = line.segs[i] || {};
    if (s.override) return s.override;
    const info = segInfo(line.points[i], line.points[i + 1]);
    return info.suggested || 'tunnel';
  }
  async function probe(p) {
    const k = p.lat.toFixed(5) + ',' + p.lng.toFixed(5);
    if (!cardCache[k]) cardCache[k] = await get(`probe?lon=${p.lng}&lat=${p.lat}`);
    return cardCache[k];
  }
  function snap(latlng, skip) {
    let best = null, bd = Infinity;
    for (const s of BOOT.existing) {
      const d = metres(latlng, { lat: s.lat, lng: s.lon });
      if (d < bd) { bd = d; best = s; }
    }
    if (bd < SNAP_EXISTING_M) return { lat: best.lat, lng: best.lon, snap: best.name_zh };
    for (const l of S.lines) for (const p of l.points) {
      if (p === skip || p.kind !== 'station') continue;
      if (metres(latlng, p) < SNAP_SHARED_M) return { lat: p.lat, lng: p.lng, snap: p.snap || null, shared: true };
    }
    return { lat: latlng.lat, lng: latlng.lng, snap: null };
  }
  async function addPoint(latlng, kind) {
    const line = S.lines[S.active];
    if (!line) return;
    let p = { lat: latlng.lat, lng: latlng.lng, kind };
    if (kind === 'station') {
      const s = snap(latlng);
      p = { ...p, lat: s.lat, lng: s.lng, snap: s.snap };
      const card = await probe(p);
      if (card.on_water) { toast('车站不能建在海上（线可以过海：先点一个拐弯点）'); return; }
      p.card = card;
      if (s.snap) toast(`接上现有「${s.snap}站」，自动做成换乘站`);
      else if (s.shared) toast('和另一条新线共用这个站（换乘站）');
    }
    line.points.push(p);
    line.segs.push({});
    line.segs.length = Math.max(0, line.points.length - 1);
    S.selected = kind === 'station' ? p : S.selected;
    afterEdit();
  }
  function afterEdit() {
    S.result = null; layers.result.clearLayers();
    document.querySelector('#layers .chip[data-layer="result"]').hidden = true;
    save(); render();
  }
  map.on('click', async (e) => {
    if (!BOOT) return;
    if (S.active >= 0) { await addPoint(e.latlng, e.originalEvent.shiftKey ? 'bend' : 'station'); if (S.selected) showCard(S.selected, true); return; }
    const p = { lat: e.latlng.lat, lng: e.latlng.lng };
    showCard(p, false);
  });

  function stationName(p, k) {
    if (p.snap) return p.snap;
    if (p.name) return p.name;
    if (p.card) return p.card.zone_label.replace(/站一带$|一带$/, '') ;
    return '车站 ' + (k + 1);
  }

  function icon(line, p, k) {
    if (p.kind === 'bend') return L.divIcon({ className: '', iconSize: [10, 10], html: `<div class="st-icon bend" style="width:10px;height:10px;border-color:${line.color}"></div>` });
    const size = p.snap ? 20 : 16;
    const fill = p.card ? { A: '#1f8a4c', B: '#5ea33a', C: '#e0a400', D: '#c23a2b' }[p.card.grade] : '#fff';
    return L.divIcon({ className: '', iconSize: [size, size],
      html: `<div class="st-icon ${p.snap ? 'x' : ''}" style="width:${size}px;height:${size}px;border-color:${line.color};background:${fill}"></div>` });
  }

  function render() {
    drawLayer.clearLayers();
    S.lines.forEach((line, li) => {
      const active = li === S.active;
      for (let i = 0; i + 1 < line.points.length; i++) {
        const a = line.points[i], b = line.points[i + 1], t = segType(line, i);
        const style = { color: line.color, pane: 'draw', opacity: active ? 0.95 : 0.8,
          weight: t === 'viaduct' ? 7 : t === 'surface' ? 4 : 6, dashArray: t === 'tunnel' ? '10 7' : null };
        const info = segCache[segKey(a, b)] || {};
        const km = metres(a, b) / 1000;
        L.polyline([a, b], style).addTo(drawLayer)
          .bindTooltip(`${TYPE_ZH[t]}${line.segs[i] && line.segs[i].override ? '（你选的）' : '（自动）'} · ${km.toFixed(2)} 公里` +
            (info.water > 0.02 ? ` · ${Math.round(info.water * 100)}% 在海上` : '') + '<br><span style="color:#888">点一下换建法</span>', { sticky: true })
          .on('click', (e) => {
            L.DomEvent.stop(e);
            line.segs[i] = { override: TYPE_NEXT[t] };
            afterEdit();
          });
      }
      line.points.forEach((p, k) => {
        const m = L.marker(p, { icon: icon(line, p, k), draggable: active, pane: 'draw', zIndexOffset: p.kind === 'bend' ? 0 : 500 }).addTo(drawLayer);
        if (p.kind === 'station') m.bindTooltip(`${esc(stationName(p, k))}${p.card ? ' · 潜力 ' + p.card.grade : ''}${p.dev ? ' · ' + BOOT.dev[p.dev].zh : ''}`, { direction: 'top', offset: [0, -8] });
        m.on('click', (e) => { L.DomEvent.stop(e); if (p.kind === 'station') { S.selected = p; showCard(p, true); } });
        m.on('contextmenu', (e) => {
          L.DomEvent.stop(e);
          if (!active) { toast('先在右边点这条线的「继续画」'); return; }
          line.points.splice(k, 1);
          line.segs.splice(Math.min(k, line.segs.length - 1), 1);
          line.segs.length = Math.max(0, line.points.length - 1);
          if (S.selected === p) { S.selected = null; $('cardBox').hidden = true; }
          afterEdit();
        });
        m.on('dragend', async () => {
          const ll = m.getLatLng();
          if (p.kind === 'station') {
            const s = snap(ll, p);
            const q = { lat: s.lat, lng: s.lng };
            const card = await probe(q);
            if (card.on_water) { toast('车站不能放在海上'); render(); return; }
            Object.assign(p, q, { snap: s.snap, card });
            S.selected = p; showCard(p, true);
          } else { p.lat = ll.lat; p.lng = ll.lng; }
          if (k > 0) line.segs[k - 1] = {};
          if (k < line.segs.length) line.segs[k] = {};
          afterEdit();
        });
      });
    });
    renderLines(); renderCost();
    $('map').classList.toggle('drawing', S.active >= 0);
    $('drawHint').hidden = S.active < 0;
  }

  // ---------- lines panel ----------
  function lineStats(line) {
    let km = 0;
    for (let i = 0; i + 1 < line.points.length; i++) km += metres(line.points[i], line.points[i + 1]) / 1000;
    return { km, stations: line.points.filter((p) => p.kind === 'station').length };
  }
  function renderLines() {
    const box = $('lines');
    if (!S.lines.length) { box.innerHTML = '<p class="hint">还没有线。点「画一条新线」开始。</p>'; return; }
    box.innerHTML = S.lines.map((l, i) => {
      const st = lineStats(l);
      return `<div class="line-item ${i === S.active ? 'active' : ''}" data-i="${i}">
        <div class="row" style="margin:0"><span class="swatch" style="background:${l.color}"></span>
          <input type="text" class="lname" value="${esc(l.name)}" style="width:120px">
          <span class="hint">${st.stations} 站 · ${st.km.toFixed(1)} 公里</span></div>
        <div class="row" style="margin:4px 0 0">
          <label class="hint">班次 <select class="lhead">${[2, 2.5, 3, 4, 5, 6, 8].map((h) => `<option value="${h}" ${h === l.headway ? 'selected' : ''}>${h} 分钟一班</option>`).join('')}</select></label>
          ${i === S.active ? '<button type="button" class="btn small main ldone">画好了</button>' : '<button type="button" class="btn small ledit">继续画</button>'}
          <button type="button" class="btn small danger ldel">删除</button>
        </div></div>`;
    }).join('');
  }
  $('lines').addEventListener('click', (e) => {
    const item = e.target.closest('.line-item'); if (!item) return;
    const i = Number(item.dataset.i);
    if (e.target.classList.contains('ledit')) { S.active = i; render(); }
    if (e.target.classList.contains('ldone')) { S.active = -1; render(); }
    if (e.target.classList.contains('ldel')) {
      if (!confirm('删除「' + S.lines[i].name + '」？')) return;
      S.lines.splice(i, 1); S.active = -1; afterEdit();
    }
  });
  $('lines').addEventListener('change', (e) => {
    const item = e.target.closest('.line-item'); if (!item) return;
    const l = S.lines[Number(item.dataset.i)];
    if (e.target.classList.contains('lname')) l.name = e.target.value.slice(0, 20) || l.name;
    if (e.target.classList.contains('lhead')) l.headway = Number(e.target.value);
    afterEdit();
  });
  $('newLine').addEventListener('click', () => {
    const n = S.lines.length;
    S.lines.push({ id: 'L' + Date.now().toString(36), name: '新线 ' + (n + 1), color: COLORS[n % COLORS.length], headway: 3, points: [], segs: [] });
    S.active = n; render();
    toast('在地图上点一下放第一个车站');
  });
  $('clearAll').addEventListener('click', () => {
    if (!S.lines.length || !confirm('清空所有线路？')) return;
    S.lines = []; S.active = -1; $('cardBox').hidden = true; afterEdit();
  });
  $('example').addEventListener('click', async () => {
    const pts = [[22.4347, 114.0632, '錦上路'], [22.4745, 114.0725, '牛潭尾'], [22.4960, 114.0860, '新田'], [22.5050, 114.1050, '古洞'], [22.5014, 114.1279, '上水']];
    const line = { id: 'Lex', name: '北环线（例子）', color: COLORS[S.lines.length % COLORS.length], headway: 4, points: [], segs: [] };
    for (const [lat, lng, name] of pts) {
      const s = snap({ lat, lng });
      const p = { lat: s.lat, lng: s.lng, kind: 'station', snap: s.snap, name: s.snap ? null : name };
      p.card = await probe(p);
      line.points.push(p);
    }
    line.segs = line.points.slice(1).map(() => ({}));
    S.lines.push(line); S.active = -1;
    map.fitBounds(L.latLngBounds(line.points).pad(0.3));
    afterEdit();
    toast('例子：连接屯马线錦上路和东铁线上水的北环线。点「开始算」看看');
  });

  // ---------- station card ----------
  async function showCard(p, isStation) {
    const box = $('cardBox');
    box.hidden = false;
    box.innerHTML = '<div class="card station"><span class="spinner"></span>看看这里…</div>';
    const c = p.card || await probe(p);
    if (isStation) p.card = c;
    const name = isStation ? stationName(p, 0) : c.zone_label;
    const devSel = isStation && !p.snap ? `<div class="row"><span class="hint">站旁开发</span>
        <select id="devSel"><option value="">不开发</option>${Object.entries(BOOT.dev).map(([k, d]) =>
          `<option value="${k}" ${p.dev === k ? 'selected' : ''}>${esc(d.zh)}（住宅 ${wan(d.residential_m2)}㎡ / 商业 ${wan(d.office_m2)}㎡）</option>`).join('')}</select></div>
        <p class="hint" style="margin:0">像港铁「铁路 + 物业」：站上盖楼卖地，收回一部分地价；新住户和上班的人也会带来新的出行。</p>
        <div class="row"><span class="hint">站名</span><input type="text" id="stName" value="${esc(p.name || '')}" placeholder="${esc(name)}" maxlength="12"></div>` : '';
    box.innerHTML = `<div class="card station">
      <div><span class="grade g-${c.grade}">${c.grade}</span><b>${esc(name)}</b> <span class="hint">${esc(c.district)}</span></div>
      <p style="margin:6px 0">建站潜力<b>${esc(c.grade_text)}</b>：周边 800 米（走路约 10 分钟）住 <b>${wan(c.pop)}</b> 人、有 <b>${wan(c.jobs)}</b> 个岗位，
        比 ${c.percentile}% 的现有港铁站多，跟「${esc(c.alike)}站」差不多。</p>
      <dl class="kv">
        <dt>离港铁远的人</dt><dd>${wan(c.far_from_rail_pop)} 人住、${wan(c.far_from_rail_jobs)} 个岗位（这些人现在走不到港铁）</dd>
        <dt>最近的港铁站</dt><dd>${esc(c.nearest)}站 · ${num(c.nearest_m)} 米${c.snap ? '（会自动做成换乘站）' : ''}</dd>
        <dt>住宅楼价</dt><dd>约 ${(c.price_m2 / 1e4).toFixed(1)} 万港元/㎡（${esc(c.district)}平均）</dd>
      </dl>
      ${c.on_water ? '<p class="neg">这里是海面：车站不能建在这里，线可以从这里过海。</p>' : ''}
      ${devSel}
      ${isStation ? '<div class="row"><button type="button" class="btn small danger" id="stDel">删掉这个站</button></div>' : ''}
      ${!isStation && S.active >= 0 && !c.on_water ? '<div class="row"><button type="button" class="btn small main" id="stAdd">在这里加车站</button></div>' : ''}
      <p class="hint" style="margin:6px 0 0">潜力等级 = 周边住的人 + 岗位，和 97 个现有港铁站比：A 前 25%，B 前 50%，C 前 75%，D 其余。</p>
    </div>`;
    const dev = $('devSel');
    if (dev) dev.addEventListener('change', () => { p.dev = dev.value || null; afterEdit(); });
    const nm = $('stName');
    if (nm) nm.addEventListener('change', () => { p.name = nm.value.trim() || null; afterEdit(); });
    const del = $('stDel');
    if (del) del.addEventListener('click', () => {
      for (const l of S.lines) {
        const k = l.points.indexOf(p);
        if (k >= 0) { l.points.splice(k, 1); l.segs = l.points.slice(1).map((_, i) => l.segs[i] || {}); }
      }
      box.hidden = true; afterEdit();
    });
    const add = $('stAdd');
    if (add) add.addEventListener('click', async () => { await addPoint(L.latLng(p.lat, p.lng), 'station'); box.hidden = true; });
  }

  // ---------- cost ----------
  function estimate() {
    const by = { tunnel: 0, viaduct: 0, surface: 0 }, km = { tunnel: 0, viaduct: 0, surface: 0 };
    const stations = [];
    for (const l of S.lines) {
      for (let i = 0; i + 1 < l.points.length; i++) {
        const t = segType(l, i), k = metres(l.points[i], l.points[i + 1]) / 1000;
        km[t] += k; by[t] += k * BOOT.units[t].yi_per_km;
      }
      for (const p of l.points) if (p.kind === 'station' && !stations.some((q) => metres(q, p) < SNAP_SHARED_M)) stations.push(p);
    }
    const st = stations.length * BOOT.station_yi;
    return { by, km, stations: stations.length, st, total: by.tunnel + by.viaduct + by.surface + st };
  }
  function renderCost() {
    if (!BOOT) return;
    const e = estimate();
    const budget = S.mode === 'north' ? BOOT.scenarios.north.budget_yi : null;
    const parts = Object.keys(e.by).filter((t) => e.km[t] > 0).map((t) => `${TYPE_ZH[t]} ${e.km[t].toFixed(1)} 公里 ${num(e.by[t])} 亿`);
    $('costBox').innerHTML = `<b>预计造价 ${num(e.total)} 亿港元</b> <span class="tier t-D" title="单价是示意值，等调研">D</span>
      ${budget ? `<div class="budget ${e.total > budget ? 'over' : ''}"><div style="width:${Math.min(100, 100 * e.total / budget)}%"></div></div>
      <span class="hint">预算 ${num(budget)} 亿${e.total > budget ? '，<span class="neg">超了！</span>' : `，还剩 ${num(budget - e.total)} 亿`}</span><br>` : ''}
      <span class="hint">${parts.join(' · ') || '还没画线'}${e.stations ? ` · ${e.stations} 个站 ${num(e.st)} 亿` : ''}<br>
      单价：隧道 ${BOOT.units.tunnel.yi_per_km} 亿/公里，高架 ${BOOT.units.viaduct.yi_per_km}，地面 ${BOOT.units.surface.yi_per_km}，每站 ${BOOT.station_yi} 亿。线段自动判断：过海、穿山、市区 → 隧道；郊区空地 → 高架。</span>`;
  }

  // ---------- run ----------
  $('go').addEventListener('click', run);
  async function run() {
    const d = design();
    if (!d.lines.length) { toast('先画一条至少两个车站的线'); return; }
    S.active = -1; render();
    S.running = true; $('go').disabled = true; $('go').textContent = '正在算…';
    $('progress').hidden = false; $('results').hidden = true;
    $('prog').innerHTML = '<li class="now"><span class="spinner"></span>排队中…</li>';
    const t0 = Date.now();
    try {
      const r = await fetch(API + 'run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ design: d, scenario: S.mode === 'north' ? 'north' : null }) });
      if (!r.ok) throw new Error((await r.json()).detail || r.status);
      const { job } = await r.json();
      for (;;) {
        await new Promise((res) => setTimeout(res, 800));
        const j = await get('job/' + job);
        showProgress(j, (Date.now() - t0) / 1000);
        if (j.status === 'done') { showResult(j.result, d); break; }
        if (j.status === 'error') { $('prog').innerHTML += `<li class="neg">出错了：${esc(j.error)}</li>`; console.error(j.trace); break; }
      }
    } catch (e) {
      $('prog').innerHTML = `<li class="neg">出错了：${esc(e.message)}</li>`;
    } finally {
      S.running = false; $('go').disabled = false; $('go').textContent = '开始算';
    }
  }
  const STAGE = { transit: '① 新线：谁会改坐新线、车厢多挤', demand: '② 出行：去哪里、坐什么（公交 / 开车 / 的士）', road: '③ 路面：少了或多了的车放回真实路网，算塞车' };
  function showProgress(j, secs) {
    const ev = j.progress || [];
    const rows = [];
    const ref = ev.filter((e) => e.label === 'ref');
    if (ref.length) {
      const done = ref.filter((e) => e.stage === 'road').length;
      rows.push(`<li class="${done >= 4 ? 'done' : 'now'}">${done >= 4 ? '✓' : '<span class="spinner"></span>'} 准备题目：先算「北都多了 20 万人、但没有新线」时的香港（${done}/4 轮，只算一次）</li>`);
    }
    const des = ev.filter((e) => e.label === 'design');
    for (let r = 1; r <= 4; r++) {
      const roundEv = des.filter((e) => e.round === r);
      if (!roundEv.length) { if (r === 1 && (ref.length === 0 || ref.filter((e) => e.stage === 'road').length >= 4)) rows.push(`<li class="now"><span class="spinner"></span>第 1 轮：${STAGE.transit}</li>`); continue; }
      const last = roundEv[roundEv.length - 1];
      if (last.stage === 'road') {
        rows.push(`<li class="done">✓ 第 ${r} 轮：新线早高峰 ${wan(last.riders_peak)} 人次 · 路上车辆 ${last.cars_peak <= 0 ? '少' : '多'} ${num(Math.abs(last.cars_peak))} 辆（${last.seconds} 秒）</li>`);
        if (r < 4) rows.push(`<li class="now"><span class="spinner"></span>第 ${r + 1} 轮：${STAGE.transit}</li>`);
      } else {
        const next = last.stage === 'transit' ? 'demand' : 'road';
        rows.push(`<li class="now"><span class="spinner"></span>第 ${r} 轮：${STAGE[next]}</li>`);
      }
    }
    if (j.status === 'queued') rows.push('<li class="now"><span class="spinner"></span>排队中（前面还有人在算）</li>');
    $('prog').innerHTML = rows.join('') + `<li class="hint">已用 ${Math.round(secs)} 秒。每一轮的结果会改变下一轮：新线快了 → 有人改坐公交 → 路上车少了 → 开车也快了 → …直到稳定。</li>`;
    $('progTitle').textContent = j.status === 'done' ? '算完了' : '正在算';
  }

  // ---------- results ----------
  function tier(t) { return `<span class="tier t-${t}" title="${{ A: '实测', B: '校准推算', C: '依据推断（仅供参考）', D: '示意假设（仅供参考）' }[t]}">${t}</span>`; }
  function showResult(res, d) {
    if (!res.ok) { $('prog').innerHTML += `<li class="neg">${esc((res.problems || []).join('；'))}</li>`; return; }
    S.result = res;
    const L_ = res.ledger, T = L_.tiers;
    const sign = (v, a, b) => (v < 0 ? a : b);
    let html = '<h2>结果</h2>';
    if (res.score) {
      const sc = res.score;
      html += `<div class="score"><div class="n">${sc.total}</div><div class="g">${sc.grade} 级${sc.over_budget ? ' · <span class="neg">超预算，总分 ×0.7</span>' : ''}</div></div>`;
      html += sc.parts.map((p) => `<div class="part"><b>${esc(p.name)}</b> ${p.points} / ${p.max}<div class="bar"><div style="width:${100 * p.points / p.max}%"></div></div><span class="hint">${esc(p.value)}</span></div>`).join('');
    }
    html += `<div class="big">
      <div><div class="l">每天坐新线 ${tier(T.riders)}</div><div class="v">${wan(L_.riders_day)} 人次</div><div class="e">早高峰 1 小时 ${wan(L_.riders_peak)} 人次；${Math.round(L_.interchange_share * 100)}% 在和现有港铁的换乘站上车</div></div>
      <div><div class="l">大家每天省下 ${tier(T.time)}</div><div class="v">${wan(L_.pt_hours_saved_day + L_.car_hours_saved_day)} 小时</div><div class="e">坐公交的省 ${wan(L_.pt_hours_saved_day)} 小时，开车的省 ${wan(L_.car_hours_saved_day)} 小时</div></div>
      <div><div class="l">早高峰路上 ${tier('B')}</div><div class="v ${sign(L_.cars_peak, 'pos', 'neg')}">${sign(L_.cars_peak, '少', '多')} ${num(Math.abs(L_.cars_peak))} 辆车</div><div class="e">全港塞车${sign(L_.delay_hours_peak, '少', '多')} ${num(Math.abs(L_.delay_hours_peak))} 车·小时</div></div>
      <div><div class="l">每年碳排 ${tier(T.carbon)}</div><div class="v ${sign(L_.co2_t_year, 'pos', 'neg')}">${sign(L_.co2_t_year, '少排', '多排')} ${wan(Math.abs(L_.co2_t_year))} 吨</div><div class="e">路上车${sign(L_.co2_road_t, '少排', '多排')} ${wan(Math.abs(L_.co2_road_t))} 吨，列车用电排 ${wan(L_.co2_train_t)} 吨</div></div>
      <div><div class="l">造价 ${tier(T.capex)}</div><div class="v">${num(L_.capex_yi)} 亿</div><div class="e">${Object.entries(L_.capex_by_type).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${num(v)}`).join(' · ')} · 车站 ${num(L_.capex_stations_yi)}</div></div>
      <div><div class="l">${L_.years} 年净收益 ${tier(L_.tier)}</div><div class="v ${sign(-L_.npv_yi, 'pos', 'neg')}">${L_.npv_yi >= 0 ? '+' : ''}${num(L_.npv_yi)} 亿</div><div class="e">每花 1 元换回 ${L_.bcr ?? '–'} 元 · ${L_.payback_year ? L_.payback_year + ' 年回本' : `${L_.years} 年内回不了本`}</div></div>
    </div>`;
    html += '<h3>为什么是这个结果</h3><ul class="why">' + res.why.map((w) => `<li class="${w.kind}">${esc(w.text)}</li>`).join('') + '</ul>';
    html += `<h3>账本（亿港元）</h3><table class="ledger">
      <tr><td>省下的时间，每年值 ${tier(T.time)}</td><td class="num">${L_.benefit_time_yi.toFixed(2)} /年</td></tr>
      <tr><td>少排的碳，每年值 ${tier(T.carbon)}</td><td class="num">${L_.carbon_value_yi.toFixed(2)} /年</td></tr>
      <tr><td>站旁开发收回的地价（一次）${tier(T.land)}</td><td class="num">${num(L_.land_yi)}</td></tr>
      <tr><td>造价（分 5 年建）${tier(T.capex)}</td><td class="num">−${num(L_.capex_yi)}</td></tr>
      <tr><td>运营费 ${tier(T.opex)}（每年 ${wan(L_.train_km_year)} 列车公里）</td><td class="num">−${L_.opex_yi_year.toFixed(2)} /年</td></tr>
      <tr><td>折算成今天的钱：好处 ${num(L_.pv_benefit_yi)}，成本 ${num(L_.pv_cost_yi)}</td><td></td></tr>
      <tr class="total"><td>净收益（${L_.years} 年，每年折现 ${(L_.discount * 100).toFixed(0)}%）</td><td class="num">${num(L_.npv_yi)}</td></tr></table>
      <details><summary>这些数怎么算的？</summary><p class="hint">
      ① 用 2026 年基准模型（455 个分区，人口、岗位、出行都来自政府统计并校准）算每两个分区之间坐公交要多久；
      新线给每对分区多一条走法（走路或坐巴士到站 → 等车 → 坐车 → 换乘 → 下车），快得多的人大多改走新线，太挤会让人觉得更慢。<br>
      ② 时间变了，人们去哪里、坐什么也会变：用模型自己的「出行分布」和「方式选择」重算（不重新拟合参数）。<br>
      ③ 少开或多开的车放回真实路网（5 万条路段），用 BPR 公式算塞车，塞车又影响下一轮的选择。共 4 轮，逐轮平均到稳定。<br>
      ④ 省下的时间按模型的时间价值（每分钟 0.7–1.4 港元）× 每年 ${300} 个工作日折钱；碳、造价、运营费的单价现在是示意值（D 级），在等调研。</p></details>`;
    html += '<h3>每段多挤（早高峰最繁忙方向）</h3>' + res.lines.map((l) => `<div><b>${esc(l.name)}</b> <span class="hint">${l.km} 公里 · 全程 ${l.end_to_end_min} 分钟 · ${l.headway} 分钟一班 · 每小时每方向能载 ${wan(l.capacity)} 人 · 每天上车 ${wan(l.boardings_day)}</span>` +
      l.sections.map((s) => {
        const c = (lf) => (lf < 0.6 ? '#3c9d4e' : lf < 1 ? '#e0a400' : '#c23a2b');
        const ab = s.load_ab / s.capacity, ba = s.load_ba / s.capacity;
        return `<div class="sec"><span>${esc(s.from)} ⇄ ${esc(s.to)}</span><div class="bars">
          <div class="b" title="${esc(s.from)}→${esc(s.to)} ${num(s.load_ab)} 人/小时"><div style="width:${Math.min(100, ab * 100)}%;background:${c(ab)}"></div></div>
          <div class="b" title="${esc(s.to)}→${esc(s.from)} ${num(s.load_ba)} 人/小时"><div style="width:${Math.min(100, ba * 100)}%;background:${c(ba)}"></div></div></div></div>`;
      }).join('') + '</div>').join('');
    html += `<p class="hint">计算用时 ${res.seconds} 秒。</p>`;
    $('results').innerHTML = html; $('results').hidden = false;
    drawResult(res, d);
    addHistory(res, d);
    $('results').scrollIntoView({ behavior: 'smooth' });
  }

  function drawResult(res, d) {
    layers.result.clearLayers();
    const all = res.lines.flatMap((l) => l.sections.map((s) => Math.max(s.load_ab, s.load_ba)));
    const top = Math.max(1, ...all);
    const drawn = S.lines.filter((l) => l.points.filter((p) => p.kind === 'station').length >= 2);
    res.lines.forEach((rl, li) => {
      const line = drawn[li]; if (!line) return;
      const idx = line.points.map((p, k) => (p.kind === 'station' ? k : -1)).filter((k) => k >= 0);
      rl.sections.forEach((s, si) => {
        const a = idx[si], b = idx[si + 1]; if (b === undefined) return;
        const load = Math.max(s.load_ab, s.load_ba), lf = load / s.capacity;
        L.polyline(line.points.slice(a, b + 1), { color: lf < 0.6 ? '#3c9d4e' : lf < 1 ? '#e0a400' : '#c23a2b', weight: 4 + 18 * load / top, opacity: 0.8, pane: 'draw' })
          .bindTooltip(`${esc(s.from)} ⇄ ${esc(s.to)}<br>早高峰最多 ${num(load)} 人/小时，载客率 ${Math.round(lf * 100)}%`, { sticky: true }).addTo(layers.result);
      });
    });
    const maxB = Math.max(1, ...res.stations.map((s) => s.boardings_day));
    for (const s of res.stations) {
      L.circleMarker([s.lat, s.lon], { radius: 5 + 18 * Math.sqrt(s.boardings_day / maxB), color: '#14532d', weight: 2, fillColor: '#3c9d4e', fillOpacity: 0.5, pane: 'draw' })
        .bindTooltip(`<b>${esc(s.name)}</b><br>每天上车约 ${wan(s.boardings_day)} 人次`).addTo(layers.result);
    }
    const maxG = Math.max(1, ...res.zone_gain.map((z) => z.hours_day));
    for (const z of res.zone_gain) {
      if (z.hours_day <= 0) continue;
      L.circleMarker([z.lat, z.lon], { radius: 3 + 16 * Math.sqrt(z.hours_day / maxG), color: '#1d4ed8', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.35 })
        .bindTooltip(`这里出发的人每天共省 ${num(z.hours_day)} 小时`).addTo(layers.result);
    }
    const chip = document.querySelector('#layers .chip[data-layer="result"]');
    chip.hidden = false; chip.classList.add('on');
    applyLayers();
  }

  // ---------- history and local leaderboard ----------
  function addHistory(res, d) {
    const all = load('tl-history', []);
    const L_ = res.ledger;
    all.unshift({ t: Date.now(), mode: S.mode, nick: $('nick').value.trim() || '我', lines: d.lines.length,
      km: res.lines.reduce((a, l) => a + l.km, 0), riders: L_.riders_day, npv: L_.npv_yi, bcr: L_.bcr, capex: L_.capex_yi,
      score: res.score ? res.score.total : null, grade: res.score ? res.score.grade : null, design: S.lines });
    store('tl-history', all.slice(0, 40));
    renderHistory();
  }
  function renderHistory() {
    const all = load('tl-history', []).filter((h) => h.mode === S.mode);
    if (!all.length) { $('history').innerHTML = '<p class="hint">算过的方案会记在这里（只存在这台电脑的浏览器里）。</p>'; return; }
    const key = S.mode === 'north' ? 'score' : 'npv';
    const best = all.reduce((a, h) => (h[key] > a[key] ? h : a), all[0]);
    const rows = [...all].sort((a, b) => b[key] - a[key]).slice(0, 10);
    $('history').innerHTML = `<p class="hint">本机排行榜（按${S.mode === 'north' ? '总分' : '净收益'}）</p><table class="history">
      <tr><td>#</td><td>谁</td><td>${S.mode === 'north' ? '总分' : '净收益(亿)'}</td><td>人次/天</td><td>造价</td><td></td></tr>` +
      rows.map((h, i) => `<tr class="${h === best ? 'best' : ''}"><td>${i + 1}</td><td>${esc(h.nick)}</td>
        <td>${S.mode === 'north' ? `${h.score} ${h.grade}` : num(h.npv)}</td><td>${wan(h.riders)}</td><td>${num(h.capex)}</td>
        <td><button type="button" class="btn small" data-t="${h.t}">载入</button></td></tr>`).join('') + '</table>';
  }
  $('history').addEventListener('click', (e) => {
    const t = e.target.dataset.t; if (!t) return;
    const h = load('tl-history', []).find((x) => String(x.t) === t); if (!h) return;
    S.lines = JSON.parse(JSON.stringify(h.design)); S.active = -1; afterEdit();
    toast('已载入这个方案，可以改了再算');
  });
  $('nick').addEventListener('change', () => store('tl-nick', $('nick').value.trim()));

  // ---------- search ----------
  let qTimer, qItems = [], qSel = -1;
  function localSearch(q) {
    const out = [];
    const ql = q.toLowerCase();
    for (const s of BOOT.existing) if (s.name_zh.includes(q) || s.name_en.toLowerCase().includes(ql)) out.push({ name: s.name_zh + '站', note: '港铁站 · ' + s.lines.join('/'), lat: s.lat, lon: s.lon });
    for (const z of BOOT.zones) if (z.label.includes(q) || z.district.includes(q)) out.push({ name: z.label, note: '分区 · ' + z.district + ' · ' + wan(z.pop) + ' 人', lat: z.lat, lon: z.lon });
    return out.slice(0, 8);
  }
  function showQ(items) {
    qItems = items; qSel = -1;
    const ul = $('qres');
    ul.innerHTML = items.map((it, i) => `<li data-i="${i}">${esc(it.name)}<small>${esc(it.note)}</small></li>`).join('') || '<li class="hint">没找到，按回车搜更多</li>';
    ul.hidden = false;
  }
  async function remote(q, broad) {
    try {
      const r = await fetch((broad ? '/api/search?q=' : '/api/places/suggest?q=') + encodeURIComponent(q));
      if (!r.ok) return [];
      const kinds = { mtr: '港铁站', light_rail: '轻铁站', ferry: '码头', bus_stop: '巴士站', minibus_stop: '小巴站', place: '地方' };
      return (await r.json()).map((p) => ({ name: p.name_zh || p.name_en, note: (kinds[p.kind] || '') + (p.district_zh ? ' · ' + p.district_zh : ''), lat: p.lat, lon: p.lon }));
    } catch (e) { return []; }
  }
  $('q').addEventListener('input', () => {
    clearTimeout(qTimer);
    const q = $('q').value.trim();
    if (!q || !BOOT) { $('qres').hidden = true; return; }
    qTimer = setTimeout(async () => {
      const local = localSearch(q);
      showQ(local);
      const more = await remote(q, false);
      if ($('q').value.trim() === q) showQ([...local, ...more.filter((m) => !local.some((l) => l.name === m.name))].slice(0, 12));
    }, 180);
  });
  $('q').addEventListener('keydown', async (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      qSel = Math.max(0, Math.min(qItems.length - 1, qSel + (e.key === 'ArrowDown' ? 1 : -1)));
      document.querySelectorAll('#qres li').forEach((li, i) => li.classList.toggle('sel', i === qSel));
    } else if (e.key === 'Enter') {
      if (qSel >= 0 && qItems[qSel]) { pick(qItems[qSel]); return; }
      const q = $('q').value.trim(); if (!q) return;
      const more = await remote(q, true);
      showQ([...localSearch(q), ...more].slice(0, 12));
    } else if (e.key === 'Escape') { $('qres').hidden = true; }
  });
  $('qres').addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) pick(qItems[Number(li.dataset.i)]); });
  function pick(it) {
    $('qres').hidden = true; $('q').value = it.name;
    map.setView([it.lat, it.lon], 15);
    if (searchMarker) map.removeLayer(searchMarker);
    searchMarker = L.circleMarker([it.lat, it.lon], { radius: 9, color: '#7c3aed', weight: 3, fillOpacity: 0.15 }).addTo(map);
    showCard({ lat: it.lat, lng: it.lon }, false);
  }
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) $('qres').hidden = true; });

  $('introOk').addEventListener('click', () => { $('intro').hidden = true; store('tl-intro', true); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.active >= 0 && document.activeElement.tagName !== 'INPUT') { S.active = -1; render(); } });

  window.TL = { map, S };   // for the screenshot check (frontend/scripts/check-game.mjs)
  boot();
})();
