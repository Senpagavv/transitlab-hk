(function (root) {
  'use strict';
  const I = root.I18N, E = root.SandboxEngine, $ = id => document.getElementById(id);
  const CELL = 18, periods = ['am', 'pm', 'day', 'holiday'];
  const paperByPeriod = { am: '#EEF3F8', pm: '#F8EEE2', day: '#F7F5EF', holiday: '#FBEDEA' };
  let v2 = null;
  let model = null, base = null, demands = {}, demand = null, fixture = false;
  let worker = null, syncPrepared = null, syncState = null, workerReady = false, requestNo = 0, pendingPreview = 0;
  let plan = E.emptyPlan(), activeLine = -1, tool = 'pan', activeArea = null;   // no tool picked: drag to look round, wheel to zoom
  let convergenceFailed = false, computing = false, displayStats = { totals: [], shares: [], loads: [] };
  let activeMetrics = null, previewMetrics = null, rows = [], camera = { x: 0, y: 0, zoom: 1 }, firstFit = true;
  let canvas, ctx, dpr = 1, pointerMap = new Map(), gesture = null, lastCell = null, dragMoved = false;
  const format = n => Math.round(Number(n) || 0).toLocaleString(I.lang === 'en' ? 'en-US' : 'zh-Hans-CN');
  const pct = n => (Math.round((Number(n) || 0) * 1000) / 10).toFixed(1);
  const signed = n => (n > 0 ? '+' : '') + format(n);
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const coordKey = c => c[0] + ',' + c[1];
  const manhattan = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
  const getActive = () => activeLine >= 0 ? plan.lines[activeLine] : null;
  const displayName = o => I.lang === 'zh-Hans' ? (o.hans || o.name) : (I.lang === 'en' ? (o.en || o.name) : o.name);
  const t = (key, vars) => I.t(key, vars);
  const finite = n => Number.isFinite(Number(n)) ? Number(n) : 0;
  const emptyMetrics = () => ({ newLineRiders: 0, switchedToTransit: 0, vehiclesReduced: 0, congestionReduced: 0, personMinutesSaved: 0, sectionChanges: [], zoneCarShare: [] });

  async function jsonFile(name) {
    const response = await fetch(name, { cache: 'no-cache' });   // revalidates (304) instead of downloading again
    if (!response.ok) throw new Error(name + ' returned ' + response.status);
    return response.json();
  }
  async function loadModel() {
    if (location.protocol !== 'file:') {
      try {
        // the map first: the grid, the clean base map (vector.js) and the morning, side by side; the other three times
        // of day (2 MB) follow once the map is up (loadOtherPeriods) — before, all four came first and the map was
        // black for seven seconds
        const [realBase, am, shapes] = await Promise.all([jsonFile('../hk/hk-base.json'), jsonFile('../hk/hk-demand-am.json'),
          jsonFile('../hk/hk-shapes.json').catch(() => null)]);
        return { base: realBase, demands: { am }, fixture: false, shapes };
      } catch (_) {}
    }
    return Object.assign(SandboxFallback.make(root.ROADS_DATA), { fixture: true });
  }
  function prepareDisplayData() {
    const byZone = new Map(base.zones.map((z, i) => [String(z.id), i]));
    const totals = new Float64Array(base.zones.length), cars = new Float64Array(base.zones.length);
    let allPeople = 0, knownPeople = 0;
    for (const pair of demand.pairs || []) {
      const index = byZone.get(String((demand.zones || [])[pair[0]])); if (index === undefined) continue;
      const people = finite(pair[2]) + finite(pair[3]);
      cars[index] += finite(pair[2]); totals[index] += people; allPeople += people;
      if (pair[4] !== null && pair[5] !== null && Number.isFinite(Number(pair[4])) && Number.isFinite(Number(pair[5]))) knownPeople += people;
    }
    const bySection = new Map((demand.sections || []).map(s => [String(s[0]), finite(s[1])]));
    displayStats = { totals, shares: Array.from(totals, (n, i) => n ? cars[i] / n : 0), minutesCoverage: allPeople ? knownPeople / allPeople : 1,
      loads: (base.sections || []).map(s => bySection.has(String(s.id)) ? bySection.get(String(s.id)) : finite((s.am || {}).load)) };
  }

  function updateRunButtons() {
    const ready = workerReady || !!syncPrepared;
    const disabled = computing || !ready || !E.validatePlan(base, plan).valid;
    $('runStep').disabled = disabled; $('runStable').disabled = disabled;
  }

  function validationText(error) {
    const rules = [['budget', 'Budget'], ['integers', 'Grid'], ['outside', 'Outside'], ['water', 'Water'],
      ['repeats', 'Repeat'], ['4-connected', 'Connected'], ['branches', 'Branch'], ['loop', 'Loop'],
      ['station', 'Station'], ['trains', 'Trains']];
    for (const [match, key] of rules) if (String(error).includes(match)) return t('m5.err' + key);
    return String(error || '');
  }

  function refreshLanguage() {
    $('examplePlan').hidden = !buildExamplePlan();
    updatePlanUI(); renderAreas(); renderRows(); setMetrics(activeMetrics || emptyMetrics(), false);
    if (!activeMetrics && previewMetrics) setMetrics(previewMetrics, true);
    renderSourceNote();
    $('fixtureBadge').textContent = t(fixture ? (location.protocol === 'file:' ? 'm5.fileHint' : 'm5.fixtureBadge') : 'm5.modelBadge');
    const round = rows.length ? rows[rows.length - 1].round : 0;
    $('roundBadge').textContent = t('m5.roundStatus', { n: round }); $('roundLabel').textContent = round ? $('roundBadge').textContent : '—';
    $('stableBadge').textContent = round ? t(rows[rows.length - 1].stable ? 'm5.stable' : (convergenceFailed ? 'm5.convergeFail' : 'm5.roundStatus'), { n: round }) : t('m5.waiting');
    $('dispatch').textContent = t('m5.dispatch');
    $('mapMessage').textContent = activeMetrics ? mapSummary(activeMetrics) : (previewMetrics ? t('m5.preview', { n: format(previewMetrics.newLineRiders) }) : t('m5.loaded'));
    if (v2) v2.refresh();
    document.title = 'TransitLab HK · ' + t('m5.mode'); updateMapToolHint(); draw();
  }

  function buildExamplePlan() {
    if (!base) return null;
    const example = E.emptyPlan();
    if (fixture) {
      example.lines.push({ id: 'kowloon-example', cells: [[5,4],[5,5],[4,5],[3,5],[3,6],[3,7],[4,7],[5,7],[6,7]],
        stations: [{cell:[5,4]},{cell:[3,6]},{cell:[6,7]}], trains: 1 });
    } else {
      const from = (base.stations || []).find(s => s.id === 'osm:MTR-KOB');
      const to = (base.stations || []).find(s => s.id === 'osm:MTR-KWT');
      if (!from || !to) return null;
      const cells = routeBetween(from.cell, to.cell); if (!cells) return null;
      example.lines.push({ id: 'kowloon-east-express', cells, stations: [{cell:from.cell.slice()},{cell:to.cell.slice()}], trains: 1 });
    }
    return example;
  }

  // zoom onto a box in grid units (a selection of zones)
  function fitBox(b) {
    if (!b) return; const pad = 1.5, width = (b[2] - b[0] + 2 * pad) * CELL, height = (b[3] - b[1] + 2 * pad) * CELL;
    const w = canvas.clientWidth, availableHeight = Math.max(80, canvas.clientHeight - 150);
    camera.zoom = Math.min(4, Math.max(80, w - 48) / width, availableHeight / height);
    camera.x = (w - width * camera.zoom) / 2 - (b[0] - pad) * CELL * camera.zoom;
    camera.y = 70 + (availableHeight - height * camera.zoom) / 2 - (b[1] - pad) * CELL * camera.zoom;
  }
  function fitArea(index) {
    const area = (base.areas || [])[index]; if (!area || !area.box) return;
    const b = area.box, width = (b[2] - b[0]) * CELL, height = (b[3] - b[1]) * CELL;
    const w = canvas.clientWidth, availableHeight = Math.max(80, canvas.clientHeight - 150);
    camera.zoom = Math.min(1.5, Math.max(80, w - 48) / width, availableHeight / height);
    camera.x = (w - width * camera.zoom) / 2 - b[0] * CELL * camera.zoom;
    camera.y = 70 + (availableHeight - height * camera.zoom) / 2 - b[1] * CELL * camera.zoom;
    draw();
  }

  function renderSourceNote() {
    const isD = fixture || demand.tier === 'D';
    $('sourceNote').textContent = fixture ? t('m5.statusFixture')
      : t('m5.sourceTier', { tier: demand.tier || '?' }) + (isD ? ' · ' + t('m5.referenceOnly') : '');
    $('sourceNote').classList.toggle('d-tier', isD);
    const coverage = displayStats.minutesCoverage ?? 1;
    $('timeNote').textContent = t('m5.timeCoverage', { coverage: (100 * coverage).toFixed(2) });
    $('timeNote').hidden = fixture || coverage >= 1;
  }

  function isNearZoneMarker(event, zone) {
    const rect = canvas.getBoundingClientRect();
    const x = camera.x + (zone.cell[0] * CELL + CELL / 2) * camera.zoom, y = camera.y + (zone.cell[1] * CELL + CELL / 2) * camera.zoom;
    return Math.hypot(event.clientX - rect.left - x, event.clientY - rect.top - y) <= 12;
  }

  function isWalkable(c) {
    const x = c[0], y = c[1];
    if (x < 0 || y < 0 || x >= base.cols || y >= base.rows) return false;
    const land = base.land;
    if (!land) return true;
    const ch = land[y * base.cols + x] || '.';
    return ch !== '~' && ch !== 'w';
  }
  function getCell(clientX, clientY) {
    const rect = canvas.getBoundingClientRect(), sx = clientX - rect.left, sy = clientY - rect.top;
    const wx = (sx - camera.x) / camera.zoom, wy = (sy - camera.y) / camera.zoom;
    const c = [Math.floor(wx / CELL), Math.floor(wy / CELL)];
    return c[0] >= 0 && c[1] >= 0 && c[0] < base.cols && c[1] < base.rows ? c : null;
  }
  function routeBetween(a, b) {
    const candidates = [];
    const hFirst = [[a[0], a[1]]]; let x = a[0], y = a[1];
    while (x !== b[0]) { x += Math.sign(b[0] - x); hFirst.push([x, y]); }
    while (y !== b[1]) { y += Math.sign(b[1] - y); hFirst.push([x, y]); }
    const vFirst = [[a[0], a[1]]]; x = a[0]; y = a[1];
    while (y !== b[1]) { y += Math.sign(b[1] - y); vFirst.push([x, y]); }
    while (x !== b[0]) { x += Math.sign(b[0] - x); vFirst.push([x, y]); }
    candidates.push(hFirst, vFirst);
    return candidates.find(path => path.every(isWalkable)) || null;
  }
  function ensureLine() {
    if (!getActive()) {
      plan.lines.push({ id: 'new-' + (plan.lines.length + 1), cells: [], stations: [], trains: 1 });
      activeLine = plan.lines.length - 1;
    }
    return getActive();
  }
  function updateLinePath(cell) {
    const line = ensureLine(), path = line.cells;
    if (!path.length) { if (!isWalkable(cell)) return false; path.push(cell); return true; }
    const last = path[path.length - 1];
    if (coordKey(cell) === coordKey(last)) return false;
    if (path.length > 1 && coordKey(cell) === coordKey(path[path.length - 2])) { path.pop(); line.stations = line.stations.filter(s => coordKey(s.cell) !== coordKey(last)); return true; }
    const route = routeBetween(last, cell);
    if (!route) return false;
    const additions = route.slice(1);
    if (additions.some(c => path.some(existing => coordKey(existing) === coordKey(c)))) return false;
    path.push(...additions);
    return additions.length > 0;
  }
  function toggleStation(cell) {
    const line = getActive();
    if (!line || !line.cells.some(c => coordKey(c) === coordKey(cell))) { setStatus(t('m5.newStation')); return false; }
    const idx = line.stations.findIndex(s => coordKey(s.cell) === coordKey(cell));
    if (idx >= 0) line.stations.splice(idx, 1);
    else line.stations.push({ cell: cell.slice(), name: 'Station ' + (line.stations.length + 1) });
    return true;
  }
  function statsPlan() {
    let cells = 0, stations = 0, trains = 0;
    for (const line of plan.lines) { cells += line.cells.length; stations += line.stations.length; trains += Math.max(0, finite(line.trains)); }
    const used = cells + stations * 3 + trains * 4;
    return { cells, stations, trains, used, remaining: plan.budget - used };
  }
  function updatePlanUI() {
    const s = statsPlan(), validation = E.validatePlan(base, plan), active = getActive();
    $('lineCount').textContent = format(s.cells); $('stationCount').textContent = format(s.stations);
    $('trainCount').textContent = format(active ? active.trains : 0);
    $('budgetUsed').textContent = format(s.used); $('budgetMax').textContent = format(plan.budget);
    $('budgetBar').style.width = (plan.budget > 0 ? Math.min(100, 100 * s.used / plan.budget) : s.used ? 100 : 0) + '%';
    $('budgetBar').classList.toggle('over', s.used > plan.budget);
    $('activeLineNote').textContent = active ? t('m5.planActive', { n: activeLine + 1 }) : t('m5.planEmpty');
    if (!s.cells && !s.stations && !s.trains) $('planDetail').innerHTML = esc(t('m5.noPlan'));
    else if (!validation.valid) $('planDetail').innerHTML = '<span class="bad">' + esc(t('m5.planInvalid', { why: validationText(validation.errors[0]) })) + '</span><br>' + esc(t('m5.planSummary', { cells: s.cells, stations: s.stations, trains: s.trains }));
    else $('planDetail').innerHTML = '<span class="good">' + esc(t('m5.planValid')) + '</span><br>' + esc(t('m5.planSummary', { cells: s.cells, stations: s.stations, trains: s.trains })) + '<br>' + (validation.transfers.length ? esc(t('m5.transferCount', { n: validation.transfers.length })) : '');
    $('lineTool').classList.toggle('selected', tool === 'line'); $('stationTool').classList.toggle('selected', tool === 'station');
    $('lineTool').setAttribute('aria-pressed', String(tool === 'line')); $('stationTool').setAttribute('aria-pressed', String(tool === 'station'));
    $('panTool').setAttribute('aria-pressed', String(tool === 'pan'));
    $('linePicker').innerHTML = plan.lines.map((line, i) => '<option value="' + i + '">' + esc(t('m5.lineNumber', { n: i + 1 })) + '</option>').join('');
    $('linePicker').value = String(activeLine); $('linePicker').disabled = !plan.lines.length;
    $('newLine').disabled = !!active && !active.cells.length;
    updateRunButtons();
  }
  function clearResults() {
    if(v2)v2.reset(); requestNo++; computing = false; activeMetrics = null; previewMetrics = null; rows = []; convergenceFailed = false;
    $('roundRows').innerHTML = ''; $('roundLabel').textContent = '—'; $('roundBadge').textContent = t('m5.roundStatus', { n: 0 });
    $('stableBadge').textContent = t('m5.waiting'); $('dispatch').textContent = t('m5.dispatch');
    setMetrics(emptyMetrics(), false); updateRunButtons(); draw();
  }

  function setStatus(message) { $('mapStatus').textContent = message || ''; if (message) setTimeout(() => { if ($('mapStatus').textContent === message) $('mapStatus').textContent = ''; }, 3000); }
  function planChanged() {
    clearResults(); updatePlanUI();
    if (pendingPreview) clearTimeout(pendingPreview);
    pendingPreview = setTimeout(() => { pendingPreview = 0; sendPlan(); }, 240);
  }

  function sendPlan() {
    if(!workerReady&&!syncPrepared)return;
    const valid = E.validatePlan(base, plan);
    if (!valid.valid) { draw(); return; }
    requestNo++;
    if (worker && workerReady) worker.postMessage({ type: 'set-plan', plan, runId: requestNo });
    else if (syncPrepared) {
      syncState = E.createState(syncPrepared, plan);
      const result = E.step(syncPrepared, plan, syncState); previewMetrics = result.metrics; draw(); setMetrics(result.metrics, true);
      $('mapMessage').textContent = t('m5.preview', { n: format(result.metrics.newLineRiders) });
    }
  }
  function setMetrics(m, preview) {
    m = m || emptyMetrics();
    const hud = { hudNew: m.newLineRiders, hudTransit: m.switchedToTransit, hudCars: m.vehiclesReduced, hudJam: m.congestionReduced };
    for (const [id, value] of Object.entries(hud)) $(id).textContent = format(value);
    if (preview) return;
    const goals = { goalNew: m.newLineRiders, goalCars: m.vehiclesReduced, goalJam: m.congestionReduced, goalSaved: m.personMinutesSaved };
    for (const [id, value] of Object.entries(goals)) $(id).textContent = format(value);
    renderHotRoads(m);
  }

  function renderHotRoads(m) {
    const items = m && m.sectionChanges || [];
    if (!items.length) { $('hotRoads').textContent = t('m5.noRoadChanges'); return; }
    $('hotRoads').innerHTML = items.slice(0, 5).map(r => {
      const d = Number(r.change) || 0, cls = d < 0 ? 'down' : d > 0 ? 'up' : '';
      const segment = (base.sections || []).find(s => String(s.id) === String(r.id));
      const position = segment ? '[' + segment.a.join(',') + '] → [' + segment.b.join(',') + '] · ' : '';
      return '<div class="road-row"><span>' + esc(roadName(r)) + '</span><b class="' + cls + '">' + signed(d) + '</b><small>' +
        esc(position) + esc(t('m5.roadVc', { vc: r.vc.toFixed(2), base: r.vc0.toFixed(2), cap: format(r.cap) })) + '</small></div>';
    }).join('');
  }
  function renderRows() {
    $('roundRows').innerHTML = rows.slice(-120).map(r => '<tr><td>' + format(r.round) + '</td><td>' + format(r.newLineRiders) + '</td><td>' + signed(r.vehiclesReduced) + '</td><td>' + signed(r.congestionReduced) + '</td></tr>').join('');
    if (rows.length) $('roundRows').parentElement.scrollTop = $('roundRows').parentElement.scrollHeight;
  }
  function renderAreas() {
    const areas = base.areas || [];
    $('areasList').innerHTML = areas.map((a, i) => '<button class="area-chip" data-area="' + i + '" aria-pressed="' + String(activeArea === i) + '">' + esc(displayName(a)) + '</button>').join('');
    $('cutArea').disabled = activeArea == null;
  }
  function onMessage(event) {
    const m = event.data || {};
    if (m.runId && m.runId !== requestNo && m.type !== 'ready') return;
    if (m.type === 'scenario-audit') { if(v2)v2.audit(m.audit); return; }
    if (m.type === 'ready') { workerReady = true; setStatus(''); updateRunButtons(); sendPlan(); return; }
    if (m.type === 'preview') {
      previewMetrics = m.metrics; setMetrics(m.metrics, true);
      $('mapMessage').textContent = t('m5.preview', { n: format(m.metrics.newLineRiders) }); draw(); return;
    }
    if (m.type === 'step' || m.type === 'stable') {
      if (Number.isFinite(m.elapsedMs)) console.info('[mode5] Worker ' + m.type + ': ' + m.elapsedMs.toFixed(3) + ' ms' + (m.roundsRun ? ', ' + m.roundsRun + ' rounds, ' + m.roundMs.toFixed(3) + ' ms/round' : ''));
      computing = false; convergenceFailed = m.type === 'stable' && !m.stable; activeMetrics = m.metrics || emptyMetrics();
      rows = m.type === 'step' ? (m.rows || rows) : (m.allRows || rows.concat(m.rows || []));
      renderRows(); setMetrics(activeMetrics, false); draw();
      const round = rows.length ? rows[rows.length - 1].round : 0;
      $('roundLabel').textContent = t('m5.roundStatus', { n: round });
      $('roundBadge').textContent = $('roundLabel').textContent;
      $('stableBadge').textContent = m.stable ? t('m5.stable', { n: round })
        : (m.type === 'stable' ? t('m5.convergeFail') : t('m5.roundStatus', { n: round }));
      $('mapMessage').textContent = mapSummary(activeMetrics);
      $('dispatch').textContent = m.stable ? t('m5.stable', { n: round }) : t('m5.dispatch');
      updateRunButtons(); if(v2)v2.result(m); return;
    }
    if (m.type === 'progress') {
      if (m.metrics) {
        activeMetrics = m.metrics; rows = m.rows || rows; renderRows(); setMetrics(activeMetrics, false); draw();
        $('roundLabel').textContent = t('m5.roundStatus', { n: m.round });
        $('mapMessage').textContent = mapSummary(activeMetrics);
      }
      $('stableBadge').textContent = t('m5.running', { n: m.round });
      $('roundBadge').textContent = t('m5.roundStatus', { n: m.round }); return;
    }
    if (m.type === 'error') { computing = false; updateRunButtons(); setStatus(m.message); }
  }

  function mapSummary(m) {
    return t('m5.mapSummary', { riders: format(m.switchedToTransit), cars: format(m.vehiclesReduced) });
  }

  function initializeWorker() {
    workerReady = false; syncPrepared = null; computing = false; updateRunButtons(); setStatus(t('m5.loading'));
    const fallback = () => {
      if (worker) worker.terminate(); worker = null; workerReady = false; computing = false;
      if (!fixture) { setStatus(t('m5.workerError')); updateRunButtons(); return; }
      try { syncPrepared = E.prepare(base, demand); syncState = E.createState(syncPrepared, plan); setStatus(''); updateRunButtons(); sendPlan(); }
      catch (e) { setStatus(e.message); }
    };
    try {
      worker = new Worker('scenario-worker.js'); worker.onmessage = onMessage; worker.onerror = fallback;
      requestNo++; worker.postMessage({ type: 'init', base, demand, plan, scenario:v2?v2.configs:{}, weights:v2?v2.weights:{zones:{}}, runId: requestNo });
    } catch (_) { fallback(); }
  }

  function changePeriod(period) {
    if (!demands[period]) return;
    if (pendingPreview) { clearTimeout(pendingPreview); pendingPreview = 0; }
    demand = demands[period]; prepareDisplayData();
    renderSourceNote();
    $('sourceNote').classList.toggle('d-tier', fixture || demand.tier === 'D');
    workerReady = false; syncPrepared = null;
    clearResults(); renderAreas(); if(v2)v2.refresh();
    for (const b of document.querySelectorAll('#periodTabs [data-period]')) b.setAttribute('aria-pressed', String(b.dataset.period === period));
    canvas.style.backgroundColor = (demand.theme && demand.theme.paper) || paperByPeriod[period];
    $('mapMessage').textContent = t('m5.selectPeriod', { name: periodName(period) });
    if (worker) worker.postMessage({ type: 'period', base, demand, plan, scenario:v2?v2.configs:{}, weights:v2?v2.weights:{zones:{}}, runId: requestNo });
    else if (fixture) {
      try { syncPrepared = E.prepare(base, demand); syncState = E.createState(syncPrepared, plan); updateRunButtons(); sendPlan(); } catch (e) { setStatus(e.message); }
    }
    draw();
  }

  function periodName(p) { return t('p.' + p); }
  function setTool(next) { tool = next; updatePlanUI(); if ($('selectTool')) $('selectTool').setAttribute('aria-pressed', String(next === 'select')); updateMapToolHint(); draw(); $('toolHint').textContent = t(next === 'line' ? 'm5.newTrack' : next === 'station' ? 'm5.newStation' : 'm5.panHint'); }
  function startNewLine() {
    if (getActive() && !getActive().cells.length) { setStatus(t('m5.newTrack')); return; }
    plan.lines.push({ id: 'new-' + (plan.lines.length + 1), cells: [], stations: [], trains: 1 });
    activeLine = plan.lines.length - 1; setTool('line'); planChanged();
  }
  function updateTrain(delta) {
    const line = getActive(); if (!line) { setStatus(t('m5.newTrack')); return; }
    line.trains = Math.max(0, Math.floor(finite(line.trains) + delta)); planChanged();
  }
  function fitMap() {
    if (!canvas || !base) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const availableHeight = Math.max(80, h - 150);
    camera.zoom = Math.min(6, Math.max(80, w - 48) / (base.cols * CELL), availableHeight / (base.rows * CELL));
    camera.x = (w - base.cols * CELL * camera.zoom) / 2;
    camera.y = 70 + (availableHeight - base.rows * CELL * camera.zoom) / 2;
    draw();
  }
  function drawTerrain() {
    const w = base.cols, h = base.rows, land = base.land || '';
    const colors = { '~': '#b7d7e7', w: '#a9cbdc', '^': '#d5dfc6', g: '#d8e9ce', r: '#ece7dc', c: '#e8e4d9', i: '#e0e1dc', m: '#e6e4d9', p: '#e4e0d6', o: '#e9e6dd', '.': '#f0eee6' };
    ctx.fillStyle = paperByPeriod[demand.period] || (demand.theme && demand.theme.paper) || '#EEF3F8';
    ctx.fillRect(0, 0, w * CELL, h * CELL);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = land[y * w + x] || '.', px = x * CELL, py = y * CELL;
      ctx.fillStyle = colors[k] || colors['.']; ctx.fillRect(px, py, CELL, CELL);
      if (camera.zoom >= .65 && k === '~' && ((x + y) % 3 === 0)) { ctx.fillStyle = '#9dc5d9'; ctx.fillRect(px + 3, py + 7 + ((x * 3 + y) % 4), 5, 1); }
      if (camera.zoom >= .65 && (k === '^' || k === 'g')) {
        const n = (x * 13 + y * 7) % 5;
        ctx.fillStyle = k === '^' ? '#a4bd96' : '#9fc795';
        ctx.fillRect(px + 4 + n, py + 5, 5, 5); ctx.fillRect(px + 3 + n, py + 9, 7, 3);
        ctx.fillStyle = '#b9cd9e'; ctx.fillRect(px + 5 + n, py + 3, 3, 2);
      }
      ctx.fillStyle = 'rgba(93,109,105,.07)'; ctx.fillRect(px, py, CELL, CELL);
    }
  }
  function linePath(points, offset) {
    if (!points || points.length < 2) return;
    ctx.beginPath();
    points.forEach((c, i) => {
      const p = [c[0] * CELL + CELL / 2, c[1] * CELL + CELL / 2];
      if (offset && i + 1 < points.length) {
        const n = points[i + 1], dx = n[0] - c[0], dy = n[1] - c[1];
        p[0] += -dy * offset; p[1] += dx * offset;
      }
      if (!i) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
    });
    ctx.stroke();
  }
  // vec: the clean base map already drew the roads; only the traffic layer goes on top, finer
  function drawRoads(vec) {
    if (!vec) for (const r of base.roads || []) {
      if (camera.zoom < .65 && r.class === 'district') continue;
      ctx.lineCap = 'square'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#d6c4a7'; ctx.lineWidth = 5; linePath(r.cells, 0);
      ctx.strokeStyle = '#f5f1e8'; ctx.lineWidth = 2.5; linePath(r.cells, 0);
    }
    if (!$('layerRoads').checked) return;
    const sections = base.sections || [], m = v2 ? v2.mapMetrics() : activeMetrics || previewMetrics;
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i], c1 = s.a, c2 = s.b;
      const load = m && m.sectionLoads ? m.sectionLoads[i] : displayStats.loads[i];
      const cap = Math.max(1, finite(s.cap || s.capacity || 1)), vc = load / cap;
      if (vec && vc < .8) continue;   // clean map: only the jammed sections (orange, red)
      const x1 = c1[0] * CELL + CELL / 2, y1 = c1[1] * CELL + CELL / 2;
      const x2 = c2[0] * CELL + CELL / 2, y2 = c2[1] * CELL + CELL / 2;
      const dx = x2 - x1, dy = y2 - y1, len = Math.max(1, Math.hypot(dx, dy));
      const ox = vec ? 0 : -dy / len * 3, oy = vec ? 0 : dx / len * 3;
      ctx.beginPath(); ctx.moveTo(x1 + ox, y1 + oy); ctx.lineTo(x2 + ox, y2 + oy);
      ctx.strokeStyle = v2 ? v2.roadColor(i,vc >= 1.2 ? '#c94f4f' : vc >= .8 ? '#d59235' : '#61a2a7') : '#61a2a7';
      ctx.globalAlpha = vec ? .6 : .78; ctx.lineWidth = vec ? Math.min(4, 1.2 + vc) / camera.zoom : Math.min(5, 1.3 + vc * 1.3); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
  // vec: the clean base map already drew the MTR at its stations' true places; only the player's lines go on top
  function drawRail(vec) {
    const transitOn = !vec && $('layerTransit').checked, stationMap = new Map((base.stations || []).map(s => [String(s.id), s]));
    if (transitOn) for (const line of base.lines || []) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#fffdf8'; ctx.lineWidth = 7; linePath(line.cells, 0);
      ctx.strokeStyle = line.color || '#687c93'; ctx.lineWidth = 4; linePath(line.cells, 0);
    }
    if (transitOn) for (const row of demand.lines || []) {
      const line = (base.lines || []).find(l => String(l.id) === String(row[0]));
      const from = stationMap.get(String(row[1])), to = stationMap.get(String(row[2]));
      if (!line || !from || !to) continue;
      const a = line.cells.findIndex(c => coordKey(c) === coordKey(from.cell)), b = line.cells.findIndex(c => coordKey(c) === coordKey(to.cell));
      if (a < 0 || b < 0) continue;
      const cells = line.cells.slice(Math.min(a, b), Math.max(a, b) + 1);
      const ratio = finite(row[3]) / Math.max(1, finite(row[4]));
      ctx.strokeStyle = line.color || '#687c93'; ctx.globalAlpha = .72; ctx.lineWidth = Math.min(5, 1.3 + 2 * ratio); linePath(cells, -3); ctx.globalAlpha = 1;
    }
    // Player tracks remain visible while editing even when the passenger-flow overlay is hidden.
    if(!v2||!v2.before) plan.lines.forEach((line, index) => {
      ctx.setLineDash([5, 3]); ctx.lineCap = 'round'; ctx.strokeStyle = '#d9505f'; ctx.lineWidth = index === activeLine ? 5 : 3;
      linePath(line.cells, -3); ctx.setLineDash([]);
      line.stations.forEach(st => drawStation(st.cell, '#c84250', true));
    });
    if (transitOn) for (const station of base.stations || []) {
      drawStation(station.cell, lineColor(station.lines && station.lines[0]), false);
      if (!v2 && camera.zoom > 1.05) {
        ctx.font = (11 / camera.zoom) + 'px Geist, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#334451';
        ctx.fillText(displayName(station), station.cell[0] * CELL + CELL / 2 + 5, station.cell[1] * CELL + CELL / 2 - 5);
      }
    }
  }

  function lineColor(id) { const l = (base.lines || []).find(x => String(x.id) === String(id)); return l && l.color || '#617b8f'; }
  function drawStation(cell, color, fresh) {
    const x = cell[0] * CELL + CELL / 2, y = cell[1] * CELL + CELL / 2;
    ctx.beginPath(); ctx.arc(x, y, fresh ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fffdf8'; ctx.fill(); ctx.lineWidth = fresh ? 2.4 : 1.8; ctx.strokeStyle = color; ctx.stroke();
  }
  function drawBuildings() {
    const showPop = $('layerPop').checked, showJobs = $('layerJobs').checked;
    if (!showPop && !showJobs) return;
    const cells = base.cells || [];
    const maxPop = cells.reduce((n, c) => Math.max(n, finite(c[2])), 1), maxJobs = cells.reduce((n, c) => Math.max(n, finite(c[3])), 1);
    for (const item of cells) {
      const pop = finite(item[2]), jobs = finite(item[3]), px = Number(item[0]) * CELL, py = Number(item[1]) * CELL;
      if (showPop && pop > 0) {
        const ratio = Math.sqrt(pop / maxPop), count = Math.max(1, Math.ceil(6 * ratio));
        ctx.fillStyle = 'rgba(83,139,86,' + (.06 + .16 * ratio) + ')'; ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
        for (let i = 0; i < count; i++) {
          const x = px + 2 + (i % 3) * 4, y = py + 6 + Math.floor(i / 3) * 5;
          ctx.fillStyle = '#7eaa78'; ctx.fillRect(x, y, 3, 4); ctx.fillStyle = '#d9e8ca'; ctx.fillRect(x + 1, y + 1, 1, 1);
        }
      }
      if (showJobs && jobs > 0) {
        const ratio = Math.sqrt(jobs / maxJobs), count = Math.max(1, Math.ceil(6 * ratio));
        ctx.fillStyle = 'rgba(80,117,151,' + (.05 + .15 * ratio) + ')'; ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
        for (let i = 0; i < count; i++) {
          const x = px + 3 + (i % 3) * 4, y = py + 2 + Math.floor(i / 3) * 4;
          ctx.fillStyle = '#748ea8'; ctx.fillRect(x, y, 3, 3); ctx.fillStyle = '#c2d4e3'; ctx.fillRect(x + 1, y + 1, 1, 1);
        }
      }
    }
  }

  function drawZones() {
    const labels = [], zones = (base.zones || []).map((z, i) => ({ z, i })).sort((a, b) => finite(b.z.pop) + finite(b.z.jobs) - finite(a.z.pop) - finite(a.z.jobs));
    for (const { z } of zones) {
      const x = z.cell[0] * CELL + CELL / 2, y = z.cell[1] * CELL + CELL / 2;
      ctx.beginPath(); ctx.arc(x, y, Math.max(2.5, Math.min(6, 2.5 + Math.log10(finite(z.pop) + finite(z.jobs) + 1) / 3)), 0, Math.PI * 2);
      ctx.fillStyle = z.jobs > z.pop ? '#577c9d' : '#618f61'; ctx.fill(); ctx.strokeStyle = '#fffdf8'; ctx.lineWidth = 1.2; ctx.stroke();
      if (camera.zoom <= .72) continue;
      const text = displayName(z); ctx.font = (12 / camera.zoom) + 'px Geist, sans-serif';
      const sx = camera.x + x * camera.zoom + 7, sy = camera.y + y * camera.zoom + 14, width = ctx.measureText(text).width * camera.zoom;
      if (sx > canvas.clientWidth || sy > canvas.clientHeight || sx + width < 0 || sy < 0) continue;
      const rect = [sx, sy - 12, sx + width, sy + 2];
      if (labels.some(r => rect[0] < r[2] + 4 && rect[2] > r[0] - 4 && rect[1] < r[3] + 3 && rect[3] > r[1] - 3)) continue;
      labels.push(rect); ctx.textAlign = 'left'; ctx.fillStyle = '#314454';
      ctx.fillText(text, x + 7 / camera.zoom, y + 14 / camera.zoom);
    }
  }

  function drawAreas(vec) {
    for (let i = 0; i < (base.areas || []).length; i++) {
      const a = base.areas[i], b = a.box; if (!b || vec && i !== activeArea) continue;   // clean map: only the chosen area's box
      const x = b[0] * CELL, y = b[1] * CELL, w = (b[2] - b[0]) * CELL, h = (b[3] - b[1]) * CELL;
      ctx.setLineDash(i === activeArea ? [4, 2] : [2, 4]); ctx.lineWidth = (i === activeArea ? 2 : .6) / camera.zoom;
      ctx.strokeStyle = i === activeArea ? '#bd3c53' : 'rgba(55,75,84,.15)'; ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
    }
    ctx.setLineDash([]);
  }
  function draw() {
    if (!canvas || !base || !ctx) return;
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      if (firstFit) { fitMap(); firstFit = false; return; }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = (demand.theme && demand.theme.paper) || paperByPeriod[demand.period] || paperByPeriod.am;
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(dpr * camera.zoom, 0, 0, dpr * camera.zoom, dpr * camera.x, dpr * camera.y);
    const vec = root.SandboxVector && SandboxVector.S.ready;
    if (vec) {
      SandboxVector.draw({ ctx, CELL, camera, tool, dark: document.documentElement.getAttribute('data-theme') === 'dark',
        layers: { pop: $('layerPop').checked, jobs: $('layerJobs').checked, transit: $('layerTransit').checked },
        selected: v2 && v2.selectedZones ? v2.selectedZones() : [] });
      drawRoads(true); drawRail(true);
    } else { drawTerrain(); if (camera.zoom >= .65) drawBuildings(); drawRoads(); drawRail(); }
    drawAreas(vec); if (v2) v2.draw();
    if (fixture) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  }
  function updateMapToolHint() {
    $('board').style.cursor = tool === 'pan' ? 'grab' : 'crosshair';
    $('toolHint').textContent = t(tool === 'line' ? 'm5.newTrack' : tool === 'station' ? 'm5.newStation' : 'm5.panHint');
  }
  function renderInitialMetrics() {
    previewMetrics = emptyMetrics(); setMetrics(previewMetrics, false);
    $('mapMessage').textContent = t('m5.loaded'); $('dispatch').textContent = t('m5.dispatch');
    $('fixtureBadge').textContent = t(fixture ? (location.protocol === 'file:' ? 'm5.fileHint' : 'm5.fixtureBadge') : 'm5.modelBadge');
    renderSourceNote();
    $('sourceNote').classList.toggle('d-tier', fixture || demand.tier === 'D');
    $('stableBadge').textContent = t('m5.waiting'); $('roundBadge').textContent = t('m5.roundStatus', { n: 0 });
    canvas.style.backgroundColor = (demand.theme && demand.theme.paper) || paperByPeriod[demand.period];
    document.title = 'TransitLab HK · ' + t('m5.mode');
  }

  async function loadOtherPeriods() {
    if (fixture) return;
    for (const p of periods) if (!demands[p]) { try { demands[p] = await jsonFile('../hk/hk-demand-' + p + '.json'); } catch (_) {} renderPeriodButtons(); }
  }
  function renderPeriodButtons() {
    document.querySelectorAll('#periodTabs [data-period]').forEach(b => {
      b.disabled = !demands[b.dataset.period];
      b.setAttribute('aria-pressed', String(b.dataset.period === (demand.period || 'am')));
    });
  }
  function bindControls() {
    $('lineTool').addEventListener('click', () => setTool(tool === 'line' ? 'pan' : 'line'));
    $('stationTool').addEventListener('click', () => setTool(tool === 'station' ? 'pan' : 'station'));
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && tool !== 'pan' && !document.querySelector('dialog[open]')) setTool('pan'); });
    $('panTool').addEventListener('click', () => setTool('pan'));
    $('newLine').addEventListener('click', startNewLine);
    $('examplePlan').addEventListener('click', () => {
      const example = buildExamplePlan(); if (!example) return;
      plan = example; activeLine = 0; setTool('line'); planChanged();
      activeArea = (base.areas || []).findIndex(a => a.key === 'kowloon-east');
      if (activeArea >= 0) { renderAreas(); fitArea(activeArea); }
    });
    $('linePicker').addEventListener('change', e => { activeLine = Number(e.target.value); updatePlanUI(); draw(); });
    $('trainPlus').addEventListener('click', () => updateTrain(1));
    $('trainMinus').addEventListener('click', () => updateTrain(-1));
    const run = stable => {
      const validation = E.validatePlan(base, plan);
      if (!validation.valid) { setStatus(t('m5.badPlan', { why: validationText(validation.errors[0]) })); return; }
      if (computing || (!workerReady && !syncPrepared)) return;
      if (pendingPreview) { clearTimeout(pendingPreview); pendingPreview = 0; sendPlan(); }
      computing = true; updateRunButtons(); $('stableBadge').textContent = t('m5.running', { n: (rows.length ? rows[rows.length - 1].round : 0) + 1 }); requestNo++;
      if (worker && workerReady) worker.postMessage({ type: stable ? 'stable' : 'step', runId: requestNo });
      else if (syncPrepared) {
        if (stable) {
          const result = E.runToStable(syncPrepared, plan, { state: syncState, maxRounds: 30 }); syncState = result.state;
          onMessage({ data: { type: 'stable', runId: requestNo, metrics: result.metrics, allRows: syncState.rows, stable: result.stable } });
        } else {
          const result = E.step(syncPrepared, plan, syncState); syncState = result.state;
          onMessage({ data: { type: 'step', runId: requestNo, metrics: result.metrics, row: result.row, rows: syncState.rows, stable: syncState.stable } });
        }
      }
    };
    $('runStep').addEventListener('click', () => run(false));
    $('runStable').addEventListener('click', () => run(true));
    $('reset').addEventListener('click', () => { plan = E.emptyPlan(); activeLine = -1; setTool('line'); planChanged(); setStatus(t('m5.clearPlan')); });
    $('periodTabs').addEventListener('click', e => { const b = e.target.closest('[data-period]'); if (b && !b.disabled) changePeriod(b.dataset.period); });
    for (const id of ['layerRoads', 'layerTransit', 'layerPop', 'layerJobs']) $(id).addEventListener('change', draw);
    $('zoomIn').addEventListener('click', () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.2));
    $('zoomOut').addEventListener('click', () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.2));
    $('resetView').addEventListener('click', fitMap);
    $('areasList').addEventListener('click', e => {
      const b = e.target.closest('[data-area]'); if (!b) return;
      activeArea = Number(b.dataset.area); renderAreas(); fitArea(activeArea);
      setStatus(t('m5.areaSelected', { name: displayName(base.areas[activeArea]) }));
    });
    $('cutArea').addEventListener('click', () => setStatus(t('m5.cutStub')));
    for (const id of ['help', 'about']) $(id).addEventListener('click', () => $('info').showModal());
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $(b.dataset.close).close()));
    $('thPaper').addEventListener('click', () => setTheme('light'));
    $('thInk').addEventListener('click', () => setTheme('dark'));
    canvas.addEventListener('wheel', e => { e.preventDefault(); const r = canvas.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown); canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp); canvas.addEventListener('pointercancel', e => { pointerMap.delete(e.pointerId); gesture = null; });
    canvas.addEventListener('pointerleave', () => { if (!gesture) $('tooltip').hidden = true; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('resize', draw);
    window.addEventListener('tl:lang', refreshLanguage);
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $('thPaper').setAttribute('aria-pressed', String(theme === 'light')); $('thInk').setAttribute('aria-pressed', String(theme === 'dark'));
  }
  function zoomAt(x, y, factor) {
    const next = Math.max(.06, Math.min(6, camera.zoom * factor));
    const wx = (x - camera.x) / camera.zoom, wy = (y - camera.y) / camera.zoom;
    camera.x = x - wx * next; camera.y = y - wy * next; camera.zoom = next; draw();
  }
  function onPointerDown(e) {
    if (v2 && v2.pointer(e, getCell(e.clientX, e.clientY))) return;
    pointerMap.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    $('tooltip').hidden = true;
    if (pointerMap.size >= 2) {
      const values = Array.from(pointerMap.values()), rect = canvas.getBoundingClientRect();
      const centerX = (values[0].x + values[1].x) / 2 - rect.left, centerY = (values[0].y + values[1].y) / 2 - rect.top;
      gesture = { type: 'pinch', distance: Math.max(1, Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y)),
        zoom: camera.zoom, worldX: (centerX - camera.x) / camera.zoom, worldY: (centerY - camera.y) / camera.zoom };
      return;
    }
    lastCell = getCell(e.clientX, e.clientY);
    const type = tool === 'pan' || e.button === 1 || e.button === 2 ? 'pan' : tool;
    gesture = { type, x: e.clientX, y: e.clientY, cell: lastCell, deferred: type === 'line' || (e.pointerType === 'touch' && type !== 'pan') };
    if (gesture.deferred || !lastCell) return;
    if (type === 'station' && toggleStation(lastCell)) planChanged();
    if (type === 'line' && updateLinePath(lastCell)) planChanged();
  }

  function onPointerMove(e) {
    if (root.SandboxVector && SandboxVector.S.ready && base) { const c = getCell(e.clientX, e.clientY), h = SandboxVector.S.hover;
      if (!h !== !c || h && c && (h[0] !== c[0] || h[1] !== c[1])) { SandboxVector.setHover(c); if (tool === 'line' || tool === 'station') draw(); } }
    if (pointerMap.has(e.pointerId)) pointerMap.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointerMap.size >= 2 && gesture && gesture.type === 'pinch') {
      const values = Array.from(pointerMap.values()), rect = canvas.getBoundingClientRect();
      const centerX = (values[0].x + values[1].x) / 2 - rect.left, centerY = (values[0].y + values[1].y) / 2 - rect.top;
      const distance = Math.max(1, Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y));
      const zoom = Math.max(.06, Math.min(6, gesture.zoom * distance / gesture.distance));
      camera.x = centerX - gesture.worldX * zoom; camera.y = centerY - gesture.worldY * zoom; camera.zoom = zoom; draw(); return;
    }
    if (gesture && gesture.type === 'pan' && pointerMap.size === 1) {
      camera.x += e.clientX - gesture.x; camera.y += e.clientY - gesture.y; gesture.x = e.clientX; gesture.y = e.clientY; draw(); return;
    }
    if (gesture && gesture.type === 'line' && pointerMap.size === 1) {
      if (gesture.deferred) {
        if (Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) < 5) return;
        gesture.deferred = false;
        if (gesture.cell && updateLinePath(gesture.cell)) planChanged();
      }
      const cell = getCell(e.clientX, e.clientY);
      if (cell && (!lastCell || coordKey(cell) !== coordKey(lastCell))) {
        if (updateLinePath(cell)) { lastCell = cell; planChanged(); }
      }
      return;
    }
    if (!gesture) showTooltip(e);
  }

  function onPointerUp(e) {
    if (gesture && gesture.deferred && pointerMap.size === 1 && gesture.cell) {
      if(gesture.type==='line'&&v2){v2.tap(e,gesture.cell);pointerMap.delete(e.pointerId);gesture=null;lastCell=null;return;}
      const changed = gesture.type === 'station' ? toggleStation(gesture.cell) : updateLinePath(gesture.cell);
      if (changed) planChanged();
    }
    pointerMap.delete(e.pointerId); gesture = null; lastCell = null;
    if (pointerMap.size === 1) { const p = Array.from(pointerMap.values())[0]; gesture = { type: 'pan', x: p.x, y: p.y }; }
  }

  function nearestZone(cell) {
    if (!cell) return null;
    if (Array.isArray(base.zone_index)) {
      const index = base.zone_index[cell[1] * base.cols + cell[0]];
      if (Number.isInteger(index) && index >= 0 && base.zones[index]) return { z: base.zones[index], i: index };
    }
    let best = null, distance = Infinity;
    (base.zones || []).forEach((z, i) => { const d = manhattan(cell, z.cell); if (d < distance) { best = { z, i }; distance = d; } });
    return distance <= 1 ? best : null;
  }

  function zoneAt(event) {
    if (!event || !root.SandboxVector || !SandboxVector.S.ready) return null;
    const rect = canvas.getBoundingClientRect(), x = (event.clientX - rect.left - camera.x) / camera.zoom / CELL, y = (event.clientY - rect.top - camera.y) / camera.zoom / CELL;
    const i = SandboxVector.zoneAt(x, y);
    return i >= 0 && base.zones[i] ? { z: base.zones[i], i } : null;
  }
  function nearestSection(cell, event) {
    if (!cell || !event || !$('layerRoads').checked) return null;
    const rect = canvas.getBoundingClientRect(), x = (event.clientX - rect.left - camera.x) / camera.zoom, y = (event.clientY - rect.top - camera.y) / camera.zoom;
    let best = null, distance = Infinity;
    (base.sections || []).forEach((s, i) => {
      const ax = s.a[0] * CELL + CELL / 2, ay = s.a[1] * CELL + CELL / 2;
      const bx = s.b[0] * CELL + CELL / 2, by = s.b[1] * CELL + CELL / 2;
      const dx = bx - ax, dy = by - ay, length = Math.max(1, Math.hypot(dx, dy)), ox = -dy / length * 3, oy = dx / length * 3;
      const fraction = Math.max(0, Math.min(1, ((x - ax - ox) * dx + (y - ay - oy) * dy) / (length * length)));
      const d = Math.hypot(x - ax - ox - fraction * dx, y - ay - oy - fraction * dy) * camera.zoom;
      if (d < distance) { distance = d; best = { s, i }; }
    });
    return distance <= 6 ? best : null;
  }

  function showTooltip(e) {
    const cell = getCell(e.clientX, e.clientY), zone = nearestZone(cell), section = nearestSection(cell, e), tooltip = $('tooltip');
    if (!zone && !section) { tooltip.hidden = true; return; }
    if (v2 && zone) { v2.tooltip(e, zone); return; }
    const m = activeMetrics || previewMetrics || emptyMetrics(); let text = '';
    if (zone && (!section || isNearZoneMarker(e, zone.z))) {
      const z = zone.z, baseShare = baseShareForZone(zone.i);
      const current = Number.isFinite(m.zoneCarShare[zone.i]) ? m.zoneCarShare[zone.i] : baseShare;
      const change = current - baseShare;
      const vars = { name: displayName(z), share: pct(current), ptShare: pct(1 - current), change: (change > 0 ? '+' : '') + pct(change), pop: format(z.pop), jobs: format(z.jobs) };
      text = t(displayStats.totals[zone.i] ? 'm5.tooltipZone' : 'm5.tooltipNoDemand', vars);
    } else {
      const s = section.s, baseline = displayStats.loads[section.i], load = m.sectionLoads ? m.sectionLoads[section.i] : baseline;
      const cap = Math.max(1, finite(s.cap || s.capacity));
      text = t('m5.tooltipRoad', { name: roadName(s), load: format(load), cap: format(cap), vc: (load / cap).toFixed(2), base: (baseline / cap).toFixed(2) });
    }
    const rect = canvas.getBoundingClientRect(); tooltip.textContent = text; tooltip.hidden = false;
    const left = Math.max(5, Math.min(rect.width - 245, e.clientX - rect.left + 12)), top = Math.max(5, Math.min(rect.height - 115, e.clientY - rect.top + 12));
    tooltip.style.left = left + 'px'; tooltip.style.top = top + 'px';
  }

  function baseShareForZone(index) { return displayStats.shares[index] || 0; }

  function roadName(s) {
    const road = (base.roads || []).find(r => String(r.id) === String(s.road));
    return (road && displayName(road)) || displayName(s) || t('m5.sectionName', { n: s.id });
  }
  function initPeriod() {
    for (const p of periods) {
      const button = document.querySelector('#periodTabs [data-period="' + p + '"]');
      if (button) button.disabled = !demands[p];
    }
    demand = demands.am; canvas.style.backgroundColor = paperByPeriod.am;
  }
  async function boot() {
    canvas = $('board'); ctx = canvas.getContext('2d', { alpha: false });
    { const w = canvas.clientWidth, h = canvas.clientHeight, r = window.devicePixelRatio || 1;   // paper, not black, while loading
      if (w && h) { canvas.width = Math.round(w * r); canvas.height = Math.round(h * r); ctx.fillStyle = paperByPeriod.am; ctx.fillRect(0, 0, canvas.width, canvas.height); } }
    $('mapStatus').textContent = t('m5.loading');
    try {
      model = await loadModel(); base = model.base; demands = model.demands; fixture = !!model.fixture;
      if (model.shapes && root.SandboxVector) SandboxVector.load(model.shapes, base);
      if (!demands.am) throw new Error('AM demand data is required');
      demand = demands.am; prepareDisplayData(); plan = E.emptyPlan(); $('examplePlan').hidden = !buildExamplePlan();
      $('mapStatus').textContent = ''; renderPeriodButtons(); renderInitialMetrics(); bindControls(); renderAreas(); updatePlanUI();
      v2 = SandboxV2.create({
        get base(){return base}, get demand(){return demand}, get demands(){return demands},
        get camera(){return camera}, get canvas(){return canvas}, get ctx(){return ctx},
        get metrics(){return activeMetrics}, get preview(){return previewMetrics}, get stats(){return displayStats},
        get plan(){return plan}, get rows(){return rows}, get area(){return activeArea}, get tool(){return tool},
        get fixture(){return fixture}, get computing(){return computing},
        draw, setTool, roadName, displayName, nearestZone, zoneAt, nearestSection, getCell,
        selectArea(i){activeArea=i;renderAreas();fitArea(i)},
        changeDemand(next){demand=next;prepareDisplayData();if(worker)worker.terminate();clearResults();initializeWorker();renderSourceNote()},
        rebuildScenario(){if(worker)worker.terminate();clearResults();initializeWorker()},
        setPlan(next){plan=next;activeLine=next.lines.length?0:-1;planChanged()},
        status:setStatus
      });
      if (root.SandboxVector && SandboxVector.S.ready) {
        const fb = document.createElement('button'); fb.className = 'btn btn-sm'; fb.id = 'focusSel'; fb.setAttribute('aria-pressed', 'false');
        const label = () => { fb.textContent = t('m5.focus'); }; label(); root.addEventListener('tl:lang', label);
        ($('selectTool') || $('board')).after(fb);
        // the first TransitLab map (TransitLab Live, frontend/dist at the backend's root): all game layers off, its own way of looking things up
        if (location.protocol !== 'file:') { const live = document.createElement('a'); live.className = 'btn btn-sm'; live.id = 'liveMap'; live.href = '/';
          const ll = () => { live.textContent = t('m5.live'); live.title = t('m5.liveTitle'); }; ll(); root.addEventListener('tl:lang', ll); fb.after(live); }
        fb.onclick = () => { const sel = v2.selectedZones(); if (!sel.length && !SandboxVector.S.focus) { setStatus(t('m5.focusNone')); return; }
          SandboxVector.S.focus = !SandboxVector.S.focus; fb.setAttribute('aria-pressed', String(SandboxVector.S.focus));
          if (SandboxVector.S.focus) fitBox(SandboxVector.bounds(sel)); else fitMap(); draw(); };
      }
      firstFit = true; fitMap(); initializeWorker(); updateMapToolHint(); setTool(tool); loadOtherPeriods();
      // for tests and tools: a grid point (cell units) → a point on the page
      root.TL_SANDBOX = { get tool() { return tool; }, selected: () => v2.selectedZones(), toPage(x, y) { const r = canvas.getBoundingClientRect();
        return [r.left + camera.x + x * CELL * camera.zoom, r.top + camera.y + y * CELL * camera.zoom]; }, fitBox, draw };
    } catch (e) { $('mapStatus').textContent = e.message; }
  }
  boot();
})(typeof window !== 'undefined' ? window : globalThis);







