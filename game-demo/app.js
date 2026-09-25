(function () {
  'use strict';
  const E = window.Engine;
  const D = E.init(window.GAME_DATA);
  E.useRoad(window.Road); window.Road.init(window.ROAD_DATA);
  const $ = s => document.querySelector(s);
  const nf = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
  const many = x => (x >= 10000 ? (x / 10000).toFixed(1) + ' 万' : nf.format(Math.round(x)));
  const yi = x => (x >= 10 ? nf.format(Math.round(x)) : x.toFixed(x >= 1 ? 1 : 2)) + ' 亿';

  const EXAMPLES = [
    { name: '沙田 → 西贡（模型里最划算）', a: [114.2149, 22.38183], b: [114.25871, 22.3724] },
    { name: '红磡 → 北角', a: [114.1880, 22.3030], b: [114.1990, 22.2910] },
    { name: '香港仔 → 中环', a: [114.1560, 22.2480], b: [114.1580, 22.2800] },
    { name: '西贡 → 马鞍山', a: [114.2700, 22.3820], b: [114.2350, 22.4200] },
    { name: '坚尼地城 → 青衣', a: [114.1280, 22.2835], b: [114.1060, 22.3450] },
  ];

  // ---------- 地图 ----------
  const map = L.map('map', { minZoom: 10, maxZoom: 18, zoomControl: false, attributionControl: true,
    maxBounds: [[22.05, 113.7], [22.65, 114.55]] }).setView([22.35, 114.13], 11);
  L.control.zoom({ position: 'topright' }).addTo(map);
  map.attributionControl.setPrefix(false);
  const LANDSD = 'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/';
  L.tileLayer(LANDSD + 'basemap/WGS84/{z}/{x}/{y}.png', {
    maxZoom: 18, maxNativeZoom: 18,
    attribution: '<img class="attr-logo" src="https://api.hkmapservice.gov.hk/mapapi/landsdlogo.jpg" alt="">'
      + '<a href="https://api.portal.hkmapservice.gov.hk/disclaimer" target="_blank" rel="noopener">© 香港特别行政区政府 地政总署</a>',
  }).addTo(map);
  map.createPane('labels').style.zIndex = 450;
  map.getPane('labels').style.pointerEvents = 'none';
  L.tileLayer(LANDSD + 'label/hk/tc/WGS84/{z}/{x}/{y}.png', { pane: 'labels', maxZoom: 18 }).addTo(map);
  map.createPane('lines').style.zIndex = 470;
  const lineRenderer = L.svg({ pane: 'lines', padding: 0.5 });

  const baseStyle = { color: '#6b7785', weight: 0.6, opacity: 0.25, fillOpacity: 0 };
  const zoneLayer = L.geoJSON(window.GAME_DATA.geo, {
    style: () => baseStyle,
    onEachFeature: (f, layer) => {
      layer.bindTooltip(() => zoneTip(f.properties.i), { sticky: true, direction: 'top', opacity: 0.95 });
    },
  }).addTo(map);
  const zoneById = {};
  zoneLayer.eachLayer(l => { zoneById[l.feature.properties.i] = l; });

  // ---------- 状态 ----------
  let A = null, B = null, R = null;
  const marks = {}, drawn = [];
  let rubber = null, routeLines = [];
  const clickKm = { A: 0, B: 0 };   // 点的地方离接上的路口多远

  function setStep(text) { $('#step').textContent = text; $('#step').hidden = !text; }

  // 桥头只能落在岸上、接到能接的地面路口（road.js 的 snap：不接桥面、隧道、收费广场、快速公路，也不隔海接到对岸）。
  // 点在海上或附近没路：不放桥头，告诉他为什么。
  const WHY = { water: '这里是海（或水塘），桥头要点在岸上', noroad: '附近 2 公里内没有能接的路（不通车的离岛、郊野公园深处），换个地方' };
  function landEnd(key, p) {
    const s = window.Road.snap(p[0], p[1]);
    if (s.node < 0) { setStep(WHY[s.reason]); return null; }
    clickKm[key] = s.km;
    return [s.lon, s.lat];
  }

  function zoneTip(i) {
    const z = D.zones[i];
    let s = `<b>${z.name}</b>（${z.district}）`;
    if (R) {
      const v = R.zoneVeh[i];
      s += v >= 1 ? `<br>每天约 ${many(v)} 车次走这座桥，平均每趟省 ${R.zoneSave[i].toFixed(1)} 分钟` : '<br>这里的人不走这座桥';
    } else {
      s += `<br>住 ${many(z.pop)} 人 · ${many(z.jobs)} 个岗位`;
    }
    return s;
  }

  function endMarker(key, ll) {
    const m = L.marker(ll, { draggable: true, icon: L.divIcon({ className: '', html: '<div class="end-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(map);
    m.bindTooltip('拖动可以挪桥头', { direction: 'top', offset: [0, -8] });
    let before = null;
    m.on('dragstart', () => { before = key === 'A' ? A : B; });
    m.on('drag', () => { const p = m.getLatLng(); if (key === 'A') A = [p.lng, p.lat]; else B = [p.lng, p.lat]; if (A && B) drawBridgeOnly(); });
    m.on('dragend', () => {
      const p = landEnd(key, key === 'A' ? A : B) || before;   // 拖到海上：弹回原处
      if (key === 'A') A = p; else B = p;
      m.setLatLng([p[1], p[0]]);
      if (A && B) build(false);
    });
    marks[key] = m;
  }

  function clearLines() { drawn.forEach(l => map.removeLayer(l)); drawn.length = 0; routeLines = []; }

  function drawBridgeOnly() {
    clearLines();
    const ll = [[A[1], A[0]], [B[1], B[0]]];
    const w = R ? 4 + R.lanes : 6;
    drawn.push(L.polyline(ll, { renderer: lineRenderer, color: '#fff', weight: w + 4, opacity: 0.9, interactive: false }).addTo(map));
    drawn.push(L.polyline(ll, { renderer: lineRenderer, color: '#1d4ed8', weight: w, opacity: 1, interactive: false }).addTo(map));
  }

  // ---------- 修桥 ----------
  map.on('click', e => {
    if (A && B) return;
    const p = [e.latlng.lng, e.latlng.lat];
    if (!A) {
      const q = landEnd('A', p); if (!q) return;
      A = q; endMarker('A', L.latLng(q[1], q[0]));
      setStep('② 再点桥的另一头');
    } else {
      const q = landEnd('B', p); if (!q) return;
      if (E.km(A, q) < 0.3) { setStep('两头接到了同一片路口，另一头点远一点'); return; }
      B = q; endMarker('B', L.latLng(q[1], q[0]));
      if (rubber) { map.removeLayer(rubber); rubber = null; }
      build(true);
    }
  });
  map.on('mousemove', e => {
    if (!A || B) return;
    const p = [e.latlng.lng, e.latlng.lat];
    const ll = [[A[1], A[0]], [p[1], p[0]]];
    const txt = `${E.km(A, p).toFixed(1)} 公里`;
    if (!rubber) {
      rubber = L.polyline(ll, { renderer: lineRenderer, color: '#1d4ed8', weight: 4, dashArray: '6 6', interactive: false }).addTo(map);
      rubber.bindTooltip(txt, { permanent: true, direction: 'right', offset: [10, 0] });
    } else { rubber.setLatLngs(ll); rubber.setTooltipContent(txt); }
    rubber.openTooltip(e.latlng);
  });

  function build(fit) {
    const r = E.evaluate(A, B);
    if (r.error) { setStep(WHY[r.error]); return; }
    R = r;
    // 桥头吸附到最近的真实路口
    A = [R.A.lon, R.A.lat]; B = [R.B.lon, R.B.lat];
    marks.A.setLatLng([A[1], A[0]]); marks.B.setLatLng([B[1], B[0]]);
    drawBridgeOnly();
    const flowA = [[A[1], A[0]], [B[1], B[0]]];
    const w = 4 + R.lanes;
    if (R.peakVeh > 0) {
      drawn.push(L.polyline(flowA, { renderer: lineRenderer, color: '#fff', weight: w - 2, className: 'flow', interactive: false }).addTo(map));
      drawn.push(L.polyline(flowA.slice().reverse(), { renderer: lineRenderer, color: '#bfdbfe', weight: w - 2, className: 'flow-slow', interactive: false }).addTo(map));
    }
    // 受益最多的几条出行：起点 → 桥这头 → 桥那头 → 终点
    const maxDay = Math.max(1, ...R.top.map(o => o.day));
    R.top.forEach((o, k) => {
      const zi = D.zones[o.i], zj = D.zones[o.j];
      const path = o.path;
      const line = L.polyline(path, { renderer: lineRenderer, color: '#1d4ed8', weight: 1.5 + 4 * Math.sqrt(o.day / maxDay),
        opacity: 0.45, className: 'flow-slow', interactive: false }).addTo(map);
      drawn.push(line); routeLines[k] = line;
    });
    colourZones();
    renderResult();
    $('#legend').hidden = R.peakVeh <= 0;
    $('#actions').hidden = false;
    setStep('');
    if (fit) {
      const pts = [[A[1], A[0]], [B[1], B[0]]];
      R.top.slice(0, 5).forEach(o => { pts.push([D.zones[o.i].lat, D.zones[o.i].lon], [D.zones[o.j].lat, D.zones[o.j].lon]); });
      const wide = window.innerWidth > 640;
      map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: wide ? [370, 40] : [30, 30], paddingBottomRight: wide ? [40, 40] : [30, window.innerHeight * 0.5], maxZoom: 14 });
    }
  }

  function colourZones() {
    const mx = Math.max(1, ...R.zoneVeh);
    zoneLayer.eachLayer(l => {
      const v = R.zoneVeh[l.feature.properties.i];
      l.setStyle(v >= 1
        ? { color: '#c46a12', weight: 0.6, opacity: 0.35, fillColor: '#f08a24', fillOpacity: 0.08 + 0.67 * Math.sqrt(v / mx) }
        : baseStyle);
    });
  }

  function verdict() {
    if (R.dayVeh < 1) return ['bad', '没人走', '两头之间本来就没有车要来往，或者桥头落在开不了车的地方。'];
    const y = R.payback;
    const why = R.dayVeh < 10000 ? `走的车太少：每天只有 ${many(R.dayVeh)} 车次，两头之间本来来往就不多。`
      : R.avgSave < 3 ? `每趟只省 ${R.avgSave.toFixed(1)} 分钟：原来的路已经够快，新桥抄的近路不多。`
      : '省的时间不少，但造价更高。';
    if (y <= 30) return ['good', '值得修', `省下的时间约 ${Math.round(y)} 年就抵得上造价。`];
    if (y <= 80) return ['mid', '勉强', why];
    return ['bad', '不值', why];
  }

  function renderResult() {
    const [cls, word, why] = verdict();
    const waterNote = R.waterKm >= 0.05 ? `，海上 ${R.waterKm.toFixed(1)}` : '';
    const far = Math.max(R.A.km, R.B.km, clickKm.A, clickKm.B) > 1;
    const topList = R.top.slice(0, 6).map((o, k) => {
      const zi = D.zones[o.i], zj = D.zones[o.j];
      return `<li data-k="${k}"><b>${zi.name}</b> → <b>${zj.name}</b><span>每天 ${many(o.day)} 车次 · 每趟省 ${o.save.toFixed(1)} 分钟（${Math.round(o.old)} → ${Math.round(o.via)}）</span></li>`;
    }).join('');
    $('#result').innerHTML = `
      <div class="verdict"><span class="pill ${cls}">${word}</span><span class="why">${why}</span></div>
      <dl class="nums">
        <div><dt>造价约</dt><dd>${yi(R.cost)}<small> 港元 · ${R.lenKm.toFixed(1)} 公里${waterNote} · 双向 ${R.lanes} 车道</small></dd></div>
        <div><dt>每天改走这座桥</dt><dd>${many(R.dayVeh)}<small> 车次 · 约 ${many(R.dayPpl)} 人次</small></dd></div>
        <div><dt>平均每趟省</dt><dd>${R.avgSave.toFixed(1)}<small> 分钟</small></dd></div>
        <div><dt>每年省下的时间折合</dt><dd>${yi(R.benefitYr)}<small> 港元</small></dd></div>
        <div><dt>多少年回本（只算省下的时间）</dt><dd>${Number.isFinite(R.payback) ? nf.format(Math.round(R.payback)) : '—'}<small> 年</small></dd></div>
      </dl>
      ${R.jammed ? '<p class="note">高峰车流超过双向 8 车道，桥上也会塞车。</p>' : ''}
      ${far ? '<p class="note">你点的地方离最近能接的路口超过 1 公里（山里或没路的地方），桥头已挪到最近的地面路口。</p>' : ''}
      ${topList ? `<div class="top"><h3>受益最多的出行（点一条在图上高亮）</h3><ol id="toplist">${topList}</ol></div>` : ''}`;
    $('#result').hidden = false;
    const list = $('#toplist');
    if (list) list.addEventListener('click', e => {
      const li = e.target.closest('[data-k]'); if (!li) return;
      const k = +li.dataset.k, on = !li.classList.contains('on');
      list.querySelectorAll('li').forEach(x => x.classList.remove('on'));
      routeLines.forEach(l => l && l.setStyle({ opacity: on ? 0.15 : 0.45, color: '#1d4ed8' }));
      if (on) { li.classList.add('on'); routeLines[k].setStyle({ opacity: 0.95, color: '#f08a24' }); routeLines[k].bringToFront(); }
    });
  }

  function reset() {
    clearLines();
    Object.values(marks).forEach(m => map.removeLayer(m));
    if (rubber) { map.removeLayer(rubber); rubber = null; }
    A = B = R = null; clickKm.A = clickKm.B = 0;
    zoneLayer.setStyle(baseStyle);
    $('#result').hidden = true; $('#actions').hidden = true; $('#legend').hidden = true;
    setStep('① 在地图上点桥的一头');
  }
  $('#reset').addEventListener('click', reset);

  EXAMPLES.forEach(x => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = x.name;
    b.addEventListener('click', () => {
      reset();
      A = x.a; B = x.b;
      endMarker('A', L.latLng(A[1], A[0])); endMarker('B', L.latLng(B[1], B[0]));
      build(true);
    });
    $('#examples').appendChild(b);
  });
})();
