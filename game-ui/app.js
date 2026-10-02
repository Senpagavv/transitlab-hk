/* TransitLab 修地铁 v2 - missions with step scoring, instant estimates and opening-day results.
   Talks to the engine at /game/api (game/api.py). Design notes: docs/design/game-v2-missions.md */
(function () {
  'use strict';

  const API = 'api/';
  const LANDSD = 'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/';
  const COLORS = ['#e4572e', '#2e86ab', '#3c9d4e', '#9b5de5', '#f1a208', '#d6336c'];
  const TYPE_ZH = { tunnel: '隧道', viaduct: '高架', surface: '地面' };
  const TYPE_NEXT = { tunnel: 'viaduct', viaduct: 'surface', surface: 'tunnel' };
  const KIND_ZH = { commute: '通勤题', gov: '打败政府方案', growth: '发展题' };
  const PEOPLE = ['陈太', '阿明', '李伯', 'Kelly', '黄生', '阿欣', '张婆婆', 'Jason', '何小姐', '老周', '阿珊', '梁生'];
  const SNAP_EXISTING_M = 150, SNAP_SHARED_M = 100;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- helpers ----------
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
  async function post(path, body) {
    const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { let d = r.status; try { d = (await r.json()).detail || d; } catch (e) { /* not json */ } throw new Error(d); }
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

  // ---------- sound (tiny synthesised blips, can be muted) ----------
  let soundOn = load('tl-sound', true), actx = null;
  function blip(kind) {
    if (!soundOn) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const notes = { add: [660], step: [523, 784], combo: [523, 659, 784, 1047], goal: [784, 988, 1175, 1568], bad: [220, 196], done: [523, 659, 784, 1047, 1319] }[kind] || [600];
      notes.forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.09;
        o.type = kind === 'bad' ? 'sawtooth' : 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.2);
      });
    } catch (e) { /* no audio */ }
  }
  $('sound').textContent = soundOn ? '🔊' : '🔈';
  $('sound').addEventListener('click', () => { soundOn = !soundOn; store('tl-sound', soundOn); $('sound').textContent = soundOn ? '🔊' : '🔈'; });

  // ---------- map ----------
  const map = L.map('map', { minZoom: 10, maxZoom: 18, zoomControl: false, doubleClickZoom: false,
    maxBounds: [[22.0, 113.7], [22.7, 114.55]] }).setView([22.36, 114.12], 11);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.attributionControl.setPrefix(false);
  L.tileLayer(LANDSD + 'basemap/WGS84/{z}/{x}/{y}.png', { maxZoom: 18,
    attribution: '地图 © 香港地政总署　数据：政府统计处、运输署、规划署等（见项目 data-sources）' }).addTo(map);
  const pane = (name, z, events) => { map.createPane(name); map.getPane(name).style.zIndex = z; if (!events) map.getPane(name).style.pointerEvents = 'none'; };
  pane('labels', 450); pane('heat', 350); pane('focus', 380); pane('draw', 620, true); pane('live', 640);
  L.tileLayer(LANDSD + 'label/hk/tc/WGS84/{z}/{x}/{y}.png', { pane: 'labels', maxZoom: 18 }).addTo(map);

  const layers = { pop: null, jobs: null, unserved: null, flows: L.layerGroup(), mtr: L.layerGroup(), gov: L.layerGroup(),
    live: L.layerGroup(), result: L.layerGroup(), focus: L.layerGroup().addTo(map) };
  const drawLayer = L.layerGroup().addTo(map);
  let searchMarker = null;

  // ---------- state ----------
  let BOOT = null, MISSIONS = null, ZONES = null;
  const S = { mode: 'home', mission: null, lines: [], active: -1, selected: null, running: false, result: null,
    quick: null, looked: false, lastEdit: null, stepsDone: {} };
  const segCache = {}, cardCache = {};

  function designKey() { return 'tl-d-' + (S.mission ? S.mission.id : 'free'); }
  function design() {
    return { lines: S.lines.filter((l) => l.points.filter((p) => p.kind === 'station').length >= 2).map((l) => ({
      id: l.id, name: l.name, headway_min: l.headway,
      points: l.points.map((p) => ({ lon: p.lng, lat: p.lat, kind: p.kind, dev: p.dev || null, name: p.name || null })),
      segment_types: l.segs.map((s) => s.override || null),
    })) };
  }
  function save() { store(designKey(), S.lines); }

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
    MISSIONS = await get('missions');
    $('loading').hidden = true;
    for (const name of ['pop', 'jobs', 'unserved']) {
      layers[name] = L.imageOverlay(API + 'layer/' + name + '.png', BOOT.layer_bounds, { pane: 'heat', opacity: 0.85 });
    }
    drawMtr(); drawFlows(BOOT.corridors); applyLayers();
    $('nick').value = load('tl-nick', '');
    showHome();
  }

  function drawMtr() {
    layers.mtr.clearLayers();
    for (const s of BOOT.existing) {
      L.circleMarker([s.lat, s.lon], { radius: 4, color: '#4a5560', weight: 2, fillColor: '#fff', fillOpacity: 1 })
        .bindTooltip(`<b>${esc(s.name_zh)}站</b>（${s.lines.join(' / ')}）<br>800 米内：住 ${wan(s.pop)} 人 · 岗位 ${wan(s.jobs)}`)
        .addTo(layers.mtr);
    }
  }

  function curve(from, to, bend = 0.18) {
    const mid = L.latLng((from.lat + to.lat) / 2, (from.lng + to.lng) / 2);
    const dx = to.lng - from.lng, dy = to.lat - from.lat;
    const ctrl = L.latLng(mid.lat - dx * bend, mid.lng + dy * bend);
    const pts = [];
    for (let t = 0; t <= 1.0001; t += 0.05) {
      pts.push(L.latLng((1 - t) ** 2 * from.lat + 2 * (1 - t) * t * ctrl.lat + t * t * to.lat,
        (1 - t) ** 2 * from.lng + 2 * (1 - t) * t * ctrl.lng + t * t * to.lng));
    }
    return pts;
  }
  function arrow(from, to, weight, color, text, paneName) {
    const pts = curve(from, to);
    const g = L.layerGroup();
    const line = L.polyline(pts, { color, weight, opacity: 0.75, lineCap: 'round', pane: paneName || 'overlayPane' }).addTo(g);
    if (text) line.bindTooltip(text, { sticky: true, className: 'flow' });
    const a = map.latLngToLayerPoint(pts[pts.length - 2]), b = map.latLngToLayerPoint(pts[pts.length - 1]);
    const ang = Math.atan2(b.y - a.y, b.x - a.x), size = 8 + weight;
    const head = [b, L.point(b.x - size * Math.cos(ang - 0.45), b.y - size * Math.sin(ang - 0.45)),
      L.point(b.x - size * Math.cos(ang + 0.45), b.y - size * Math.sin(ang + 0.45))].map((p) => map.layerPointToLatLng(p));
    L.polygon(head, { color, weight: 1, fillColor: color, fillOpacity: 0.9, pane: paneName || 'overlayPane' }).addTo(g);
    return g;
  }
  let lastFlows = null;
  function drawFlows(list) {
    lastFlows = list;
    layers.flows.clearLayers();
    if (!list || !list.length) return;
    const top = list[0].people;
    for (const f of list) {
      arrow(L.latLng(f.from_lat, f.from_lon), L.latLng(f.to_lat, f.to_lon), 3 + 13 * f.people / top, '#7c3aed',
        `早高峰 8–9 点：<b>${esc(f.from)} → ${esc(f.to)}</b><br>约 ${wan(f.people)} 人坐公交，两区中心相距 ${f.km} 公里`).addTo(layers.flows);
    }
  }
  map.on('zoomend', () => { if (lastFlows) drawFlows(lastFlows); if (S.mission) drawFocus(); });

  function chipOn(n) { const c = document.querySelector(`#layers .chip[data-layer="${n}"]`); return c && c.classList.contains('on') && !c.hidden; }
  function applyLayers() {
    document.querySelectorAll('#layers .chip').forEach((c) => {
      const layer = layers[c.dataset.layer];
      if (!layer) return;
      const on = c.classList.contains('on') && !c.hidden;
      if (on && !map.hasLayer(layer)) layer.addTo(map);
      if (!on && map.hasLayer(layer)) map.removeLayer(layer);
    });
    legend();
  }
  $('layers').addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    c.classList.toggle('on');
    const heat = ['pop', 'jobs', 'unserved'];
    if (c.classList.contains('on') && heat.includes(c.dataset.layer)) {
      document.querySelectorAll('#layers .chip').forEach((o) => { if (o !== c && heat.includes(o.dataset.layer)) o.classList.remove('on'); });
    }
    if (c.classList.contains('on') && c.dataset.layer !== 'mtr' && c.dataset.layer !== 'live') markLooked();
    applyLayers();
  });
  function legend() {
    const rows = [];
    if (chipOn('pop')) rows.push('<b>人口</b>：越深每平方公里住的人越多（浅 = 1 千，深 = 10 万）');
    if (chipOn('jobs')) rows.push('<b>岗位</b>：越深每平方公里的工作岗位越多');
    if (chipOn('unserved')) rows.push('<b>离港铁远的人</b>：住或工作在离港铁站超过 800 米的地方');
    if (chipOn('flows')) rows.push('<b>主要人流</b>：早高峰坐公交、人多又走得远的 12 条区与区之间的人流');
    if (S.mode === 'play' && S.mission && S.mission.kind === 'commute') rows.push('<b>红色</b> = 这道题的出发区，<b>蓝色</b> = 目的地');
    if (S.mode === 'play' && S.mission && S.mission.kind === 'growth') rows.push('<b>紫色</b> = 新居民入住的北都');
    if (chipOn('gov') && S.mission && S.mission.gov) rows.push('<b>灰色虚线</b> = 政府方案（示意走线，约 ±500 米）');
    if (chipOn('live') && S.quick && S.quick.ok) rows.push('<b>小方块</b> = 列车；<b>绿色圆</b> = 每天在这站上车的人，红色闪 = 太挤；黄色对话框 = 受益的通勤者');
    $('legend').innerHTML = rows.join('<br>');
    $('legend').hidden = !rows.length;
  }

  // ---------- home ----------
  function showHome() {
    S.mode = 'home'; S.mission = null; S.lines = []; S.active = -1; S.quick = null; S.result = null;
    $('homeBox').hidden = false; $('playBox').hidden = true; $('hud').hidden = true;
    layers.focus.clearLayers(); layers.gov.clearLayers(); layers.result.clearLayers(); stopLive(); render(); legend();
    map.setView([22.36, 114.12], 11);
    const d = MISSIONS.items.find((m) => m.id === MISSIONS.daily);
    const today = new Date();
    $('dailyCard').innerHTML = `<div class="tag">今日一题 · ${today.getMonth() + 1} 月 ${today.getDate()} 日 · ${KIND_ZH[d.kind]}</div>
      <h3>${esc(d.title)}</h3><p>预算 ${num(d.budget_yi)} 亿 · 约 5 分钟</p>
      <button type="button" class="btn" data-m="${d.id}">开始 ▶</button>`;
    $('library').innerHTML = ['gov', 'commute', 'growth'].map((k) => {
      const items = MISSIONS.items.filter((m) => m.kind === k);
      if (!items.length) return '';
      return `<div class="lib-group">${KIND_ZH[k]}</div>` + items.map((m) => {
        const best = bestOf(m.id);
        return `<div class="lib-item" data-m="${m.id}"><span>${esc(m.title)}</span><span class="best">${best ? '★'.repeat(best.stars) + '☆'.repeat(3 - best.stars) + ' ' + best.score : '未玩'}</span></div>`;
      }).join('');
    }).join('');
  }
  $('homeBox').addEventListener('click', (e) => {
    const t = e.target.closest('[data-m]');
    if (t) startMission(t.dataset.m);
  });
  $('freeMode').addEventListener('click', startFree);
  $('home').addEventListener('click', () => { if (!S.running) showHome(); });

  function enterPlay() {
    S.mode = 'play'; S.result = null; S.quick = null; S.looked = false; S.stepsDone = {}; S.active = -1; S.selected = null;
    $('homeBox').hidden = true; $('playBox').hidden = false;
    $('results').hidden = true; $('progress').hidden = true; $('cardBox').hidden = true;
    layers.result.clearLayers(); stopLive();
    S.lines = load(designKey(), []);
    S.lines.forEach((l) => { l.segs = l.segs || []; });
  }

  async function startMission(id) {
    const m = await get('mission/' + id);
    S.mission = m;
    enterPlay();
    $('advisorBox').hidden = false; $('hud').hidden = false;
    const gov = m.gov;
    const govChip = document.querySelector('#layers .chip[data-layer="gov"]');
    govChip.hidden = !gov; govChip.classList.toggle('on', !!gov);
    $('brief').innerHTML = `<div class="hint">${KIND_ZH[m.kind]}</div><b>${esc(m.title)}</b><p style="margin:6px 0">${esc(m.story)}</p>` +
      (gov ? `<p class="hint" style="margin:0">政府公布的造价：${esc(gov.official_cost || '未公布')}。游戏里两边用同一套单价算，才公平。</p>` : '') +
      (m.kind === 'growth' ? '<p class="hint" style="margin:0">第一次算这道题要先算「北都多了 20 万人、没有新线」的香港，约 1 分钟。</p>' : '');
    drawGov(); await drawFocus();
    if (m.view) map.fitBounds(m.view, { padding: [40, 40] });
    applyLayers(); render(); updateSteps(); renderHistory(); refreshQuick();
  }
  function startFree() {
    S.mission = null;
    enterPlay();
    $('advisorBox').hidden = true; $('hud').hidden = false;
    document.querySelector('#layers .chip[data-layer="gov"]').hidden = true;
    $('brief').innerHTML = '<b>自由世界</b><p style="margin:6px 0">没有题目，随便修。每点一个站马上看到多少人会坐；「通车」看完整账本。</p>';
    layers.focus.clearLayers(); layers.gov.clearLayers();
    applyLayers(); render(); renderHistory(); refreshQuick();
  }

  function drawGov() {
    layers.gov.clearLayers();
    const g = S.mission && S.mission.gov; if (!g) return;
    for (const l of g.design.lines) {
      L.polyline(l.points.map((p) => [p.lat, p.lon]), { color: '#4b5563', weight: 5, opacity: 0.7, dashArray: '2 10', lineCap: 'round' }).addTo(layers.gov);
      l.points.filter((p) => p.kind === 'station').forEach((p, i) => {
        const c = L.circleMarker([p.lat, p.lon], { radius: 6, color: '#4b5563', weight: 2, fillColor: '#e5e7eb', fillOpacity: 1 }).addTo(layers.gov);
        c.bindTooltip(i === 0 ? '政府方案：' + esc(g.name) : '政府站：' + esc(p.name || ''), i === 0 ? { permanent: true, direction: 'left', className: 'gov' } : { className: 'gov' });
      });
    }
  }
  async function drawFocus() {
    layers.focus.clearLayers();
    const m = S.mission; if (!m || !m.focus) return;
    if (!ZONES) { try { ZONES = await (await fetch('/api/zones')).json(); } catch (e) { ZONES = { features: [] }; } }
    const o = new Set(m.focus.origin), d = new Set(m.focus.dest);
    const purple = m.kind === 'growth';
    L.geoJSON({ type: 'FeatureCollection', features: ZONES.features.filter((f) => o.has(f.properties.zone) || d.has(f.properties.zone)) }, {
      pane: 'focus', interactive: false,
      style: (f) => {
        const c = purple ? '#7c3aed' : o.has(f.properties.zone) ? '#dc2626' : '#2563eb';
        return { color: c, weight: 2, fillColor: c, fillOpacity: purple ? 0.12 : 0.18, dashArray: '4 3' };
      },
    }).addTo(layers.focus);
    if (m.focus.arrow) {
      const [a, b] = m.focus.arrow;
      arrow(L.latLng(a[0], a[1]), L.latLng(b[0], b[1]), 6, '#dc2626', null, 'focus').addTo(layers.focus);
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
    return segInfo(line.points[i], line.points[i + 1]).suggested || 'tunnel';
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
      if (card.on_water) { toast('车站不能建在海上（线可以过海：先 Shift+点 放一个拐弯点）'); blip('bad'); return; }
      p.card = card;
      if (s.shared) toast('和另一条新线共用这个站（换乘站）');
    }
    line.points.push(p);
    line.segs = line.points.slice(1).map((_, i) => line.segs[i] || {});
    if (kind === 'station') S.selected = p;
    S.lastEdit = p;
    blip('add');
    afterEdit();
  }
  function afterEdit() {
    S.result = null; layers.result.clearLayers();
    save(); render(); refreshQuick(); updateSteps();
  }
  map.on('click', async (e) => {
    if (!BOOT || S.mode !== 'play') return;
    if (S.active >= 0) { await addPoint(e.latlng, e.originalEvent.shiftKey ? 'bend' : 'station'); if (S.selected) showCard(S.selected, true); return; }
    markLooked();
    showCard({ lat: e.latlng.lat, lng: e.latlng.lng }, false);
  });
  function markLooked() { if (S.mode === 'play' && !S.looked) { S.looked = true; updateSteps(); } }

  function stationName(p, k) {
    if (p.snap) return p.snap;
    if (p.name) return p.name;
    if (p.card) return p.card.zone_label.replace(/站一带$|一带$/, '');
    return '车站 ' + (k + 1);
  }
  function icon(line, p) {
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
        const info = segCache[segKey(a, b)] || {};
        L.polyline([a, b], { color: line.color, pane: 'draw', opacity: active ? 0.95 : 0.85,
          weight: t === 'viaduct' ? 7 : t === 'surface' ? 4 : 6, dashArray: t === 'tunnel' ? '10 7' : null }).addTo(drawLayer)
          .bindTooltip(`${TYPE_ZH[t]}${line.segs[i] && line.segs[i].override ? '（你选的）' : '（自动）'} · ${(metres(a, b) / 1000).toFixed(2)} 公里` +
            (info.water > 0.02 ? ` · ${Math.round(info.water * 100)}% 在海上` : '') + '<br><span style="color:#888">点一下换建法</span>', { sticky: true })
          .on('click', (e) => { L.DomEvent.stop(e); line.segs[i] = { override: TYPE_NEXT[t] }; S.lastEdit = null; afterEdit(); });
      }
      line.points.forEach((p, k) => {
        const m = L.marker(p, { icon: icon(line, p), draggable: active, pane: 'draw', zIndexOffset: p.kind === 'bend' ? 0 : 500 }).addTo(drawLayer);
        if (p.kind === 'station') m.bindTooltip(`${esc(stationName(p, k))}${p.card ? ' · 潜力 ' + p.card.grade : ''}${p.dev ? ' · ' + BOOT.dev[p.dev].zh : ''}`, { direction: 'top', offset: [0, -8] });
        m.on('click', (e) => { L.DomEvent.stop(e); if (p.kind === 'station') { S.selected = p; showCard(p, true); } });
        m.on('contextmenu', (e) => {
          L.DomEvent.stop(e);
          if (!active) { toast('先在右边点这条线的「继续画」'); return; }
          line.points.splice(k, 1);
          line.segs = line.points.slice(1).map((_, i) => line.segs[i] || {});
          if (S.selected === p) { S.selected = null; $('cardBox').hidden = true; }
          S.lastEdit = null;
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
          S.lastEdit = p;
          afterEdit();
        });
      });
    });
    renderLines(); renderCost();
    $('map').classList.toggle('drawing', S.active >= 0);
    $('drawHint').hidden = S.active < 0;
  }

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
      S.lines.splice(i, 1); S.active = -1; S.lastEdit = null; afterEdit();
    }
  });
  $('lines').addEventListener('change', (e) => {
    const item = e.target.closest('.line-item'); if (!item) return;
    const l = S.lines[Number(item.dataset.i)];
    if (e.target.classList.contains('lname')) l.name = e.target.value.slice(0, 20) || l.name;
    if (e.target.classList.contains('lhead')) l.headway = Number(e.target.value);
    S.lastEdit = null;
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
    S.lines = []; S.active = -1; $('cardBox').hidden = true; S.lastEdit = null; afterEdit();
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
        <dt>最近的港铁站</dt><dd>${esc(c.nearest)}站 · ${num(c.nearest_m)} 米${c.snap ? '（放这里会自动做成换乘站）' : ''}</dd>
        <dt>住宅楼价</dt><dd>约 ${(c.price_m2 / 1e4).toFixed(1)} 万港元/㎡（${esc(c.district)}平均）</dd>
      </dl>
      ${c.on_water ? '<p class="neg">这里是海面：车站不能建在这里，线可以从这里过海。</p>' : ''}
      ${devSel}
      ${isStation ? '<div class="row"><button type="button" class="btn small danger" id="stDel">删掉这个站</button></div>' : ''}
      ${!isStation && S.active >= 0 && !c.on_water ? '<div class="row"><button type="button" class="btn small main" id="stAdd">在这里加车站</button></div>' : ''}
      <p class="hint" style="margin:6px 0 0">潜力等级 = 周边住的人 + 岗位，和 97 个现有港铁站比：A 前 25%，B 前 50%，C 前 75%，D 其余。</p>
    </div>`;
    const dev = $('devSel');
    if (dev) dev.addEventListener('change', () => { p.dev = dev.value || null; S.lastEdit = p; afterEdit(); });
    const nm = $('stName');
    if (nm) nm.addEventListener('change', () => { p.name = nm.value.trim() || null; afterEdit(); });
    const del = $('stDel');
    if (del) del.addEventListener('click', () => {
      for (const l of S.lines) {
        const k = l.points.indexOf(p);
        if (k >= 0) { l.points.splice(k, 1); l.segs = l.points.slice(1).map((_, i) => l.segs[i] || {}); }
      }
      box.hidden = true; S.lastEdit = null; afterEdit();
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
    const parts = Object.keys(e.by).filter((t) => e.km[t] > 0).map((t) => `${TYPE_ZH[t]} ${e.km[t].toFixed(1)} 公里 ${num(e.by[t])} 亿`);
    $('costBox').innerHTML = `<b>预计造价 ${num(e.total)} 亿港元</b> <span class="tier t-D" title="单价是示意值">D</span><br>
      <span class="hint">${parts.join(' · ') || '还没画线'}${e.stations ? ` · ${e.stations} 个站 ${num(e.st)} 亿` : ''}<br>
      单价：隧道 ${BOOT.units.tunnel.yi_per_km} 亿/公里，高架 ${BOOT.units.viaduct.yi_per_km}，地面 ${BOOT.units.surface.yi_per_km}，每站 ${BOOT.station_yi} 亿。过海、穿山、市区自动算隧道；郊区空地算高架（点线段可改）。</span>`;
    updateHud();
  }

  // ---------- instant estimate (0.1 s) and its feedback ----------
  let quickSeq = 0, quickTimer = null;
  function refreshQuick() {
    clearTimeout(quickTimer);
    quickTimer = setTimeout(async () => {
      const d = design(), seq = ++quickSeq;
      if (!d.lines.length) { S.quick = null; stopLive(); updateHud(); updateSteps(); legend(); return; }
      try {
        const q = await post('quick', { design: d, mission: S.mission ? S.mission.id : null });
        if (seq !== quickSeq || S.mode !== 'play') return;
        const prev = S.quick;
        S.quick = q;
        feedback(prev, q);
        drawLive(q);
        updateHud(); updateSteps(); legend();
      } catch (e) { /* keep the last numbers */ }
    }, 120);
  }

  function floatAt(latlng, text, cls) {
    if (!latlng) return;
    const p = map.latLngToContainerPoint(latlng);
    const el = document.createElement('div');
    el.className = 'float ' + (cls || ''); el.textContent = text;
    el.style.left = p.x + 'px'; el.style.top = (p.y - 26) + 'px';
    $('map').appendChild(el);
    setTimeout(() => el.remove(), 1900);
  }
  function banner(text) {
    document.querySelectorAll('.combo').forEach((o) => o.remove());
    const el = document.createElement('div');
    el.className = 'combo'; el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }
  function feedback(prev, q) {
    if (!q || !q.ok) return;
    const before = prev && prev.ok ? prev.riders_day : 0;
    const delta = q.riders_day - before;
    if (S.lastEdit && Math.abs(delta) >= 100) floatAt(S.lastEdit, (delta > 0 ? '+' : '−') + wan(Math.abs(delta)) + ' 人/天', delta > 0 ? '' : 'neg');
    const had = new Set(prev && prev.ok ? prev.interchanges : []);
    const added = q.interchanges.filter((n) => !had.has(n));
    const name = added.length ? (BOOT.existing.find((s) => s.name_en === added[0]) || {}).name_zh || added[0] : '';
    if (added.length && before > 0 && q.riders_day / Math.max(before, 1) >= 2) {
      banner(`网络效应！接上${name}站，客流 ×${Math.round(q.riders_day / Math.max(before, 1))}`); blip('combo');
    } else if (added.length) {
      banner(`接上现有港铁：${name}站`); blip('step');
    }
    if (progressOf(q) >= 1 && progressOf(prev) < 1) { banner('🎯 目标达成！'); blip('goal'); }
    if (S.mission && q.capex_yi > S.mission.budget_yi && !(prev && prev.ok && prev.capex_yi > S.mission.budget_yi)) { toast('超预算了！可以把郊区段改成高架，或者少挖一段隧道'); blip('bad'); }
  }

  function progressOf(q) {
    const m = S.mission;
    if (!m || !q || !q.ok) return 0;
    if (m.metric.type === 'time') return q.target ? q.target.saved / m.metric.goal : 0;
    return q.riders_day / Math.max(m.metric.goal, 1);
  }

  // ---------- trains, crowds and voices ----------
  const live = { trains: [], raf: null, t0: 0 };
  function stopLive() { if (live.raf) cancelAnimationFrame(live.raf); live.raf = null; live.trains = []; layers.live.clearLayers(); }
  function pathOf(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + metres(pts[i - 1], pts[i]));
    return { pts, cum, len: cum[cum.length - 1] };
  }
  function at(path, s) {
    const { pts, cum } = path;
    let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const f = (s - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-6);
    return L.latLng(pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * f, pts[i - 1].lng + (pts[i].lng - pts[i - 1].lng) * f);
  }
  function drawLive(q) {
    stopLive();
    if (!q || !q.ok) return;
    for (const s of q.sections) {
      const a = q.stations[s.a], b = q.stations[s.b];
      if (!a || !b) continue;
      const c = s.lf < 0.6 ? '#22c55e' : s.lf < 1 ? '#f59e0b' : '#ef4444';
      L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { color: c, weight: 14, opacity: 0.35, pane: 'focus' }).addTo(layers.live);
    }
    const hot = new Set(q.sections.filter((s) => s.lf > 1).flatMap((s) => [s.a, s.b]));
    q.stations.forEach((s, k) => {
      if (s.boardings_day < 50) return;
      const size = Math.round(20 + Math.min(26, Math.sqrt(s.boardings_day) / 9));
      L.marker([s.lat, s.lon], { pane: 'live', interactive: false, icon: L.divIcon({ className: '', iconSize: [size, size], iconAnchor: [size / 2, size + 12],
        html: `<div class="crowd ${hot.has(k) ? 'hot' : ''}" style="width:${size}px;height:${size}px">${wan(s.boardings_day, 0).replace(' ', '')}</div>` }) }).addTo(layers.live);
    });
    // trains: 1 real second = 1 minute of service, both directions, spaced by the headway
    const drawn = S.lines.filter((l) => l.points.filter((p) => p.kind === 'station').length >= 2);
    for (const l of drawn) {
      const path = pathOf(l.points.map((p) => L.latLng(p.lat, p.lng)));
      if (path.len < 200) continue;
      const cycle = 2 * path.len / 1000;           // ~60 km/h average: 1 km a "minute" = a second
      const n = Math.max(2, Math.min(14, Math.round(cycle / (l.headway || 3))));
      for (let i = 0; i < n; i++) {
        const mk = L.marker(path.pts[0], { pane: 'live', interactive: false,
          icon: L.divIcon({ className: '', iconSize: [12, 12], html: `<div class="train" style="background:${l.color}"></div>` }) }).addTo(layers.live);
        live.trains.push({ mk, path, off: i * cycle / n, cycle });
      }
    }
    voices(q);
    live.t0 = performance.now();
    const tick = (now) => {
      const t = (now - live.t0) / 1000;
      for (const tr of live.trains) {
        const s = ((t + tr.off) % tr.cycle) / tr.cycle * 2 * tr.path.len;
        tr.mk.setLatLng(at(tr.path, s <= tr.path.len ? s : 2 * tr.path.len - s));
      }
      live.raf = requestAnimationFrame(tick);
    };
    if (live.trains.length) live.raf = requestAnimationFrame(tick);
  }
  function voices(q) {
    (q.stories || []).slice(0, 2).forEach((s) => {
      const who = PEOPLE[(s.o * 7 + s.d) % PEOPLE.length];
      const saved = s.before - s.after;
      const mood = saved >= 15 ? '太好了 🎉' : saved >= 8 ? '快多了 😊' : '有点帮助 🙂';
      L.marker([s.lat, s.lon], { pane: 'live', interactive: false, icon: L.divIcon({ className: '', iconSize: [1, 1] }) })
        .bindTooltip(`<b>${who}</b>：住${esc(s.from)}，去${esc(s.to)}。以前 ${s.before} 分钟，现在 ${s.after} 分钟，${mood}<br><span style="color:#888">早高峰这样走的约 ${num(s.people_peak)} 人</span>`,
          { permanent: true, direction: 'top', className: 'voice', offset: [0, -6] }).addTo(layers.live);
    });
  }

  // ---------- HUD and the planner's steps ----------
  function stepsNow() {
    const m = S.mission, q = S.quick && S.quick.ok ? S.quick : null;
    const newSt = S.lines.flatMap((l) => l.points.filter((p) => p.kind === 'station' && !p.snap && p.card));
    const ab = newSt.filter((p) => ['A', 'B'].includes(p.card.grade)).length;
    const share = newSt.length ? ab / newSt.length : 0;
    const inter = S.lines.some((l) => l.points.some((p) => p.kind === 'station' && p.snap));
    const cost = estimate().total;
    const prog = progressOf(q);
    const dev = S.lines.some((l) => l.points.some((p) => p.dev));
    const goalTip = m.metric.type === 'time'
      ? `让红色出发区的人去蓝色目的地平均少 ${m.metric.goal} 分钟（看上方进度条）`
      : `每天坐你的线的人次超过政府方案（快算 ${wan(m.metric.goal)} 人次）`;
    return [
      { id: 'look', name: '看清问题', tip: m.kind === 'gov' ? '打开图层或点地图看看：政府方案经过哪里、周边人多不多' : '打开「人口」「主要人流」图层，或点一下红色出发区', max: 5, pts: S.looked ? 5 : 0, done: S.looked },
      { id: 'site', name: '好站位', tip: `新站放在 A/B 级位置（现在 ${ab}/${newSt.length} 个）`, max: 10, pts: 10 * Math.min(1, share / 0.5), done: newSt.length > 0 && share >= 0.5 },
      { id: 'link', name: '接上港铁', tip: '把一个站放在现有港铁站 150 米内，做成换乘站', max: 10, pts: inter ? 10 : 0, done: inter },
      { id: 'goal', name: '完成目标', tip: goalTip, max: 30, pts: 30 * Math.min(1, Math.max(prog, 0)), done: prog >= 1 },
      { id: 'budget', name: '不超预算', tip: `造价控制在 ${num(m.budget_yi)} 亿内（现在 ${num(cost)} 亿）`, max: 10, pts: q && cost <= m.budget_yi ? 10 : 0, done: !!q && cost <= m.budget_yi },
      { id: 'dev', name: '铁路 + 物业', tip: '点一个新站，选「站旁开发」收回地价', max: 5, pts: dev ? 5 : 0, done: dev },
      { id: 'bcr', name: '账算得过来', tip: '通车日揭晓：每花 1 元换回 1 元满分（站旁开发能帮大忙）', max: 15, later: true },
      { id: 'beat', name: m.kind === 'gov' ? '打败政府方案' : '每公里客流', tip: m.kind === 'gov' ? '通车日揭晓：客流和净收益都比政府方案好' : '通车日揭晓：每公里每天 1.2 万人次满分', max: 15, later: true },
    ];
  }
  function updateSteps() {
    if (!S.mission || S.mode !== 'play') return;
    const steps = stepsNow();
    const nowIdx = steps.findIndex((s) => !s.done && !s.later);
    $('steps').innerHTML = steps.map((s, i) => `<li class="${s.done ? 'done' : ''} ${i === nowIdx ? 'now' : ''} ${s.later ? 'later' : ''}" data-id="${s.id}">
      <span class="ic"></span><span><b>${esc(s.name)}</b><span class="tip">${esc(s.tip)}</span></span>
      <span class="pts">${s.later ? '?' : Math.round(s.pts)} / ${s.max}</span></li>`).join('');
    $('advisorHint').textContent = nowIdx >= 0 ? `下一步：${steps[nowIdx].name}` : '都完成了，点「通车！」揭晓';
    for (const s of steps) {
      if (s.done && !S.stepsDone[s.id]) {
        S.stepsDone[s.id] = true;
        const li = document.querySelector(`#steps li[data-id="${s.id}"]`);
        if (li) li.classList.add('flash');
        if (s.id !== 'goal') blip('step');
      }
      if (!s.done) S.stepsDone[s.id] = false;
    }
    updateHud();
  }
  let shownScore = 0;
  function updateHud() {
    if (S.mode !== 'play') return;
    const q = S.quick && S.quick.ok ? S.quick : null;
    const cost = estimate().total;
    if (!S.mission) {
      $('hudGoalLabel').textContent = '新线每天（快算）';
      $('hudGoalBar').style.width = Math.min(100, (q ? q.riders_day : 0) / 5000) + '%';
      $('hudGoalText').textContent = q ? `${wan(q.riders_day)} 人次 · 大家每天省 ${wan(q.hours_saved_day)} 小时` : '画两个站就有数字';
      $('hudBudgetBar').style.width = Math.min(100, cost / 20) + '%';
      $('hudBudgetText').textContent = `${num(cost)} 亿`;
      $('hudScore').textContent = '–'; $('hudStars').textContent = '';
      return;
    }
    const m = S.mission, prog = progressOf(q);
    $('hudGoalLabel').textContent = m.metric.label + '（快算）';
    $('hudGoalBar').style.width = Math.min(100, prog * 100) + '%';
    $('hudGoalBar').parentElement.classList.toggle('done', prog >= 1);
    if (m.metric.type === 'time') {
      const t = q && q.target;
      $('hudGoalText').textContent = t ? `${t.before} → ${t.after} 分钟（目标少 ${m.metric.goal}）` : `目标：平均少 ${m.metric.goal} 分钟`;
    } else {
      $('hudGoalText').textContent = `${wan(q ? q.riders_day : 0)} / 政府 ${wan(m.metric.goal)} 人次/天`;
    }
    $('hudBudgetBar').style.width = Math.min(100, 100 * cost / m.budget_yi) + '%';
    $('hudBudgetBar').parentElement.classList.toggle('over', cost > m.budget_yi);
    $('hudBudgetText').textContent = `${num(cost)} / ${num(m.budget_yi)} 亿`;
    const score = Math.round(stepsNow().reduce((a, s) => a + (s.later ? 0 : s.pts), 0));
    if (score !== shownScore) {
      const el = $('hudScore');
      el.classList.add('bump'); setTimeout(() => el.classList.remove('bump'), 220);
      shownScore = score;
    }
    $('hudScore').textContent = score;
    const stars = (prog >= 1 ? 1 : 0) + (q && cost <= m.budget_yi ? 1 : 0);
    $('hudStars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  }

  // ---------- opening day: the full model ----------
  $('go').addEventListener('click', run);
  async function run() {
    const d = design();
    if (!d.lines.length) { toast('先画一条至少两个车站的线'); return; }
    S.active = -1; render();
    S.running = true; $('go').disabled = true; $('go').textContent = '正在通车…';
    $('progress').hidden = false; $('results').hidden = true;
    $('prog').innerHTML = '<li class="now"><span class="spinner"></span>排队中…</li>';
    $('progress').scrollIntoView({ behavior: 'smooth' });
    const t0 = Date.now();
    const newSt = S.lines.flatMap((l) => l.points.filter((p) => p.kind === 'station' && !p.snap && p.card));
    try {
      const { job } = await post('run', { design: d, mission: S.mission ? S.mission.id : null,
        flags: { looked: S.looked, grades: newSt.map((p) => p.card.grade) } });
      for (;;) {
        await new Promise((res) => setTimeout(res, 800));
        const j = await get('job/' + job);
        showProgress(j, (Date.now() - t0) / 1000);
        if (j.status === 'done') { showResult(j.result); break; }
        if (j.status === 'error') { $('prog').innerHTML += `<li class="neg">出错了：${esc(j.error)}</li>`; console.error(j.trace); break; }
      }
    } catch (e) {
      $('prog').innerHTML = `<li class="neg">出错了：${esc(e.message)}</li>`;
    } finally {
      S.running = false; $('go').disabled = false; $('go').textContent = '🚇 通车！看完整结果';
    }
  }
  const STAGE = { transit: '① 新线：谁会改坐新线、车厢多挤', demand: '② 出行：去哪里、坐什么（公交 / 开车 / 的士）', road: '③ 路面：少了或多了的车放回真实路网，算塞车' };
  function showProgress(j, secs) {
    const ev = j.progress || [];
    const rows = [];
    const ref = ev.filter((e) => e.label === 'ref');
    if (ref.length) {
      const done = ref.filter((e) => e.stage === 'road').length;
      rows.push(`<li class="${done >= 4 ? 'done' : 'now'}">${done >= 4 ? '✓' : '<span class="spinner"></span>'} 准备题目：先算「北都多了 20 万人、没有新线」的香港（${done}/4 轮，只算一次）</li>`);
    }
    const des = ev.filter((e) => e.label === 'design');
    for (let r = 1; r <= 4; r++) {
      const roundEv = des.filter((e) => e.round === r);
      if (!roundEv.length) { if (r === 1 && j.status === 'running' && (ref.length === 0 || ref.filter((e) => e.stage === 'road').length >= 4)) rows.push(`<li class="now"><span class="spinner"></span>第 1 轮：${STAGE.transit}</li>`); continue; }
      const last = roundEv[roundEv.length - 1];
      if (last.stage === 'road') {
        rows.push(`<li class="done">✓ 第 ${r} 轮：新线早高峰 ${wan(last.riders_peak)} 人次 · 路上车辆 ${last.cars_peak <= 0 ? '少' : '多'} ${num(Math.abs(last.cars_peak))} 辆（${last.seconds} 秒）</li>`);
        if (r < 4) rows.push(`<li class="now"><span class="spinner"></span>第 ${r + 1} 轮：${STAGE.transit}</li>`);
      } else {
        rows.push(`<li class="now"><span class="spinner"></span>第 ${r} 轮：${STAGE[last.stage === 'transit' ? 'demand' : 'road']}</li>`);
      }
    }
    if (j.status === 'queued') rows.push('<li class="now"><span class="spinner"></span>排队中（后台还在算别的，稍等）</li>');
    $('prog').innerHTML = rows.join('') + `<li class="hint">已用 ${Math.round(secs)} 秒。每一轮都会改变下一轮：新线快了 → 有人改坐公交 → 路上车少了 → 开车也快了 → …直到稳定。</li>`;
    $('progTitle').textContent = j.status === 'done' ? '通车了！' : '通车日：完整模型正在跑';
  }

  function tier(t) { return `<span class="tier t-${t}" title="${{ A: '实测', B: '校准推算', C: '依据推断（仅供参考）', D: '示意假设（仅供参考）' }[t]}">${t}</span>`; }
  function showResult(res) {
    if (!res.ok) { $('prog').innerHTML += `<li class="neg">${esc((res.problems || []).join('；'))}</li>`; return; }
    S.result = res;
    const L_ = res.ledger, T = L_.tiers, ms = res.mission;
    const sign = (v, a, b) => (v < 0 ? a : b);
    let html = '';
    let newBest = false;
    if (ms) {
      const prev = bestOf(S.mission.id);
      newBest = !prev || ms.total > prev.score;
      html += `<div class="stars-big">${'★'.repeat(ms.stars)}<span class="off">${'★'.repeat(3 - ms.stars)}</span></div>
        <div class="score"><div class="n">${ms.total}</div><div class="g">总分 / 100</div></div>
        ${newBest ? '<div class="newbest">新纪录！</div>' : ''}`;
      html += '<ol class="quest">' + ms.steps.map((s) => `<li class="${s.points >= s.max - 0.01 ? 'done' : ''}"><span class="ic"></span>
        <span><b>${esc(s.name)}</b><span class="tip">${esc(s.note)}</span></span><span class="pts">${s.points} / ${s.max}</span></li>`).join('') + '</ol>';
      if (ms.benchmark) {
        const b = ms.benchmark;
        const bar = (a, c, fmt) => { const mx = Math.max(Math.abs(a), Math.abs(c), 1); return `<div class="bars"><div class="me" style="width:${Math.max(4, 100 * Math.abs(a) / mx)}%">你 ${fmt(a)}</div><div class="gv" style="width:${Math.max(4, 100 * Math.abs(c) / mx)}%">政府 ${fmt(c)}</div></div>`; };
        html += `<h3>你 vs 政府方案（同一套单价、同一个完整模型）</h3><div class="vs">
          <div class="r"><span>每天客流</span>${bar(L_.riders_day, b.riders_day, (v) => wan(v))}</div>
          <div class="r"><span>净收益</span>${bar(L_.npv_yi, b.npv_yi, (v) => num(v) + ' 亿')}</div>
          <div class="r"><span>造价</span>${bar(L_.capex_yi, b.capex_yi, (v) => num(v) + ' 亿')}</div>
          <div class="r"><span>每天省时</span>${bar(L_.pt_hours_saved_day + L_.car_hours_saved_day, b.hours_saved_day, (v) => wan(v) + ' 时')}</div></div>`;
      } else if (S.mission.kind === 'gov') {
        html += '<p class="hint">政府方案的完整模型还在后台算，稍后再通车一次就能对比。</p>';
      }
    }
    html += `<h3>通车日的数字</h3><div class="big">
      <div><div class="l">每天坐新线 ${tier(T.riders)}</div><div class="v">${wan(L_.riders_day)} 人次</div><div class="e">早高峰 1 小时 ${wan(L_.riders_peak)} 人次；${Math.round(L_.interchange_share * 100)}% 在和现有港铁的换乘站上车</div></div>
      <div><div class="l">大家每天省下 ${tier(T.time)}</div><div class="v">${wan(L_.pt_hours_saved_day + L_.car_hours_saved_day)} 小时</div><div class="e">坐公交的省 ${wan(L_.pt_hours_saved_day)} 小时，开车的省 ${wan(L_.car_hours_saved_day)} 小时</div></div>
      <div><div class="l">早高峰路上 ${tier('B')}</div><div class="v ${sign(L_.cars_peak, 'pos', 'neg')}">${sign(L_.cars_peak, '少', '多')} ${num(Math.abs(L_.cars_peak))} 辆车</div><div class="e">全港塞车${sign(L_.delay_hours_peak, '少', '多')} ${num(Math.abs(L_.delay_hours_peak))} 车·小时</div></div>
      <div><div class="l">每年碳排 ${tier(T.carbon)}</div><div class="v ${sign(L_.co2_t_year, 'pos', 'neg')}">${sign(L_.co2_t_year, '少排', '多排')} ${wan(Math.abs(L_.co2_t_year))} 吨</div><div class="e">路上车${sign(L_.co2_road_t, '少排', '多排')} ${wan(Math.abs(L_.co2_road_t))} 吨，列车用电排 ${wan(L_.co2_train_t)} 吨</div></div>
      <div><div class="l">造价 ${tier(T.capex)}</div><div class="v">${num(L_.capex_yi)} 亿</div><div class="e">${Object.entries(L_.capex_by_type).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${num(v)}`).join(' · ')} · 车站 ${num(L_.capex_stations_yi)}</div></div>
      <div><div class="l">${L_.years} 年净收益 ${tier(L_.tier)}</div><div class="v ${sign(-L_.npv_yi, 'pos', 'neg')}">${L_.npv_yi >= 0 ? '+' : ''}${num(L_.npv_yi)} 亿</div><div class="e">每花 1 元换回 ${L_.bcr ?? '–'} 元 · ${L_.payback_year ? L_.payback_year + ' 年回本' : `${L_.years} 年内回不了本`}</div></div>
    </div>`;
    if (S.quick && S.quick.ok) {
      html += `<p class="hint">快算 ${wan(S.quick.riders_day)} 人次/天 → 完整模型 ${wan(L_.riders_day)}：差别来自人们改了去哪里、改坐什么、路上塞车的变化。</p>`;
    }
    html += '<h3>为什么是这个结果</h3><ul class="why">' + res.why.map((w) => `<li class="${w.kind}">${esc(w.text)}</li>`).join('') + '</ul>';
    html += `<details><summary>完整账本（亿港元）</summary><table class="ledger">
      <tr><td>省下的时间，每年值 ${tier(T.time)}</td><td class="num">${L_.benefit_time_yi.toFixed(2)} /年</td></tr>
      <tr><td>少排的碳，每年值 ${tier(T.carbon)}</td><td class="num">${L_.carbon_value_yi.toFixed(2)} /年</td></tr>
      <tr><td>站旁开发收回的地价（一次）${tier(T.land)}</td><td class="num">${num(L_.land_yi)}</td></tr>
      <tr><td>造价（分 5 年建）${tier(T.capex)}</td><td class="num">−${num(L_.capex_yi)}</td></tr>
      <tr><td>运营费 ${tier(T.opex)}（每年 ${wan(L_.train_km_year)} 列车公里）</td><td class="num">−${L_.opex_yi_year.toFixed(2)} /年</td></tr>
      <tr><td>折算成今天的钱：好处 ${num(L_.pv_benefit_yi)}，成本 ${num(L_.pv_cost_yi)}</td><td></td></tr>
      <tr class="total"><td>净收益（${L_.years} 年，每年折现 ${(L_.discount * 100).toFixed(0)}%）</td><td class="num">${num(L_.npv_yi)}</td></tr></table>
      <p class="hint">① 新线给每对分区多一条走法，快得多的人大多改走新线，太挤会觉得更慢；② 时间变了，人们去哪里、坐什么也变（用模型自己的分布和方式选择重算）；③ 少开或多开的车放回真实路网算塞车；4 轮逐轮平均到稳定。省下的时间按模型的时间价值（每分钟 0.7–1.4 港元）× 每年 300 个工作日折钱。</p></details>`;
    html += `<div class="row" style="margin-top:10px"><button type="button" class="btn main" id="again">再改改</button>
      ${S.mission ? '<button type="button" class="btn" id="other">换一题</button>' : ''}</div>`;
    $('results').innerHTML = html; $('results').hidden = false;
    $('again').addEventListener('click', () => { document.querySelector('.panel').scrollTop = 0; });
    const other = $('other'); if (other) other.addEventListener('click', showHome);
    drawResult(res);
    addHistory(res);
    if (ms) { blip(ms.stars >= 2 ? 'done' : 'step'); if (newBest) banner(`新纪录 ${ms.total} 分！`); }
    $('results').scrollIntoView({ behavior: 'smooth' });
  }

  function drawResult(res) {
    layers.result.clearLayers();
    const maxG = Math.max(1, ...res.zone_gain.map((z) => z.hours_day));
    for (const z of res.zone_gain) {
      if (z.hours_day <= 0) continue;
      L.circleMarker([z.lat, z.lon], { radius: 3 + 16 * Math.sqrt(z.hours_day / maxG), color: '#1d4ed8', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.3 })
        .bindTooltip(`这里出发的人每天共省 ${num(z.hours_day)} 小时`).addTo(layers.result);
    }
    layers.result.addTo(map);
  }

  // ---------- records ----------
  function histKey() { return 'tl-h-' + (S.mission ? S.mission.id : 'free'); }
  function bestOf(id) {
    return load('tl-h-' + id, []).reduce((a, h) => (!a || h.score > a.score ? h : a), null);
  }
  function addHistory(res) {
    const all = load(histKey(), []);
    const L_ = res.ledger, ms = res.mission;
    all.unshift({ t: Date.now(), nick: $('nick').value.trim() || '我', score: ms ? ms.total : Math.round(L_.npv_yi), stars: ms ? ms.stars : 0,
      riders: L_.riders_day, npv: L_.npv_yi, capex: L_.capex_yi, design: S.lines });
    store(histKey(), all.slice(0, 30));
    renderHistory();
  }
  function renderHistory() {
    const all = load(histKey(), []);
    if (!all.length) { $('history').innerHTML = '<p class="hint">通车一次就会记在这里（只存在这台电脑的浏览器里）。</p>'; return; }
    const rows = [...all].sort((a, b) => b.score - a.score).slice(0, 8);
    $('history').innerHTML = `<table class="history"><tr><td>#</td><td>谁</td><td>${S.mission ? '得分' : '净收益(亿)'}</td><td>人次/天</td><td>造价</td><td></td></tr>` +
      rows.map((h, i) => `<tr class="${i === 0 ? 'best' : ''}"><td>${i + 1}</td><td>${esc(h.nick)}</td>
        <td>${S.mission ? `${h.score} ${'★'.repeat(h.stars)}` : num(h.score)}</td><td>${wan(h.riders)}</td><td>${num(h.capex)}</td>
        <td><button type="button" class="btn small" data-t="${h.t}">载入</button></td></tr>`).join('') + '</table>';
  }
  $('history').addEventListener('click', (e) => {
    const t = e.target.dataset.t; if (!t) return;
    const h = load(histKey(), []).find((x) => String(x.t) === t); if (!h) return;
    S.lines = JSON.parse(JSON.stringify(h.design)); S.active = -1; S.lastEdit = null; afterEdit();
    toast('已载入这个方案，可以改了再通车');
  });
  $('nick').addEventListener('change', () => store('tl-nick', $('nick').value.trim()));

  // ---------- search ----------
  let qTimer, qItems = [], qSel = -1;
  function localSearch(q) {
    const out = [], ql = q.toLowerCase();
    for (const s of BOOT.existing) if (s.name_zh.includes(q) || s.name_en.toLowerCase().includes(ql)) out.push({ name: s.name_zh + '站', note: '港铁站 · ' + s.lines.join('/'), lat: s.lat, lon: s.lon });
    for (const z of BOOT.zones) if (z.label.includes(q) || z.district.includes(q)) out.push({ name: z.label, note: '分区 · ' + z.district + ' · ' + wan(z.pop) + ' 人', lat: z.lat, lon: z.lon });
    return out.slice(0, 8);
  }
  function showQ(items) {
    qItems = items; qSel = -1;
    $('qres').innerHTML = items.map((it, i) => `<li data-i="${i}">${esc(it.name)}<small>${esc(it.note)}</small></li>`).join('') || '<li class="hint">没找到，按回车搜更多</li>';
    $('qres').hidden = false;
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
      showQ([...localSearch(q), ...await remote(q, true)].slice(0, 12));
    } else if (e.key === 'Escape') { $('qres').hidden = true; }
  });
  $('qres').addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) pick(qItems[Number(li.dataset.i)]); });
  function pick(it) {
    $('qres').hidden = true; $('q').value = it.name;
    map.setView([it.lat, it.lon], 15);
    if (searchMarker) map.removeLayer(searchMarker);
    searchMarker = L.circleMarker([it.lat, it.lon], { radius: 9, color: '#7c3aed', weight: 3, fillOpacity: 0.15 }).addTo(map);
    if (S.mode === 'play') { markLooked(); showCard({ lat: it.lat, lng: it.lon }, false); }
  }
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) $('qres').hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.active >= 0 && document.activeElement.tagName !== 'INPUT') { S.active = -1; render(); } });

  window.TL = { map, S };   // for the screenshot check (frontend/scripts/check-game.mjs)
  boot();
})();
