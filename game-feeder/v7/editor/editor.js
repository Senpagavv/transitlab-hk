(function (root) {
  'use strict';
  // v7 · the level editor for modes 2–4 (2026-10-15). One page, three modes: the metro (2), roads that jam (3) and
  // station-side development (4) share estates, destinations and the rule numbers; mode 3 adds roads and the existing
  // MTR lines, mode 4 lots of land. Any mode may have a river: drawn, and with «waterBlocksWalk» nobody walks across it
  // (the engines walk round it). The level is kept in this browser (localStorage) as the game reads it, except that
  // roads and lines are kept cell by cell while editing (the game keeps their corners, `via`).
  // Out: one tl-level/1 file (levels/README.md) — what a teammate zips and hands in; Claude checks it, sets the tiers
  // with the full bots, adds the AI demo and drops it into levels/mN/. Test play: a level pack for this browser session
  // (shared/levelpack.js) opened by the mode's own page (#pack=<id>).
  const I = root.I18N, t = (k, v) => I.t(k, v), $ = id => document.getElementById(id);
  const ENG = { 2: root.Metro, 3: root.Roads, 4: root.TOD };
  const PAGE = { 2: ['mode2-metro', '模式2-地铁.html'], 3: ['mode3-roads', '模式3-路会塞.html'], 4: ['mode4-tod', '模式4-站旁开发.html'] };
  const EXAMPLE = { 2: 'm2-1', 3: 'm3-1', 4: 'm4-1' };
  const bundled = /编辑器|編輯器/.test(decodeURIComponent(location.pathname.split('/').pop() || ''));
  const SAVE = 'tl-v7-editor';
  const SIDES = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const sideOf = h => !h ? 'down' : h[0] < 0 ? 'left' : h[0] > 0 ? 'right' : h[1] < 0 ? 'up' : 'down';
  const LINE_COLORS = ['#1E9A4A', '#E2231A', '#0071CE', '#7D499D', '#F38B00', '#00A040', '#8B5A2B'];
  const k = c => c.join(','), same = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1];
  const clone = x => JSON.parse(JSON.stringify(x));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  /* ------------------------------------------------------------------ the level */
  // the corners of a path of cells (what the game keeps) and back
  function corners(cells) {
    if (cells.length < 3) return cells.map(c => c.slice());
    const out = [cells[0].slice()];
    for (let j = 1; j < cells.length - 1; j++) { const a = cells[j - 1], b = cells[j], c = cells[j + 1];
      if (b[0] - a[0] !== c[0] - b[0] || b[1] - a[1] !== c[1] - b[1]) out.push(b.slice()); }
    out.push(cells.at(-1).slice()); return out; }
  function expand(via) {
    const out = [via[0].slice()];
    for (let j = 1; j < via.length; j++) { let c = out.at(-1).slice(); const z = via[j];
      while (c[0] !== z[0]) { c = [c[0] + Math.sign(z[0] - c[0]), c[1]]; out.push(c); }
      while (c[1] !== z[1]) { c = [c[0], c[1] + Math.sign(z[1] - c[1])]; out.push(c); } }
    return out; }
  // the game's level → what the editor edits
  function fromGame(level, mode) {
    const lv = clone(level);
    lv.origins = lv.origins || []; lv.destinations = lv.destinations || []; lv.water = lv.water || [];
    if (mode === 3) {
      lv.roads = (lv.roads || []).map(r => { const { via, ...rest } = r; return { ...rest, cells: via && via.length ? expand(via) : [] }; });
      lv.lines = (lv.lines || []).map(l => { const { via, ...rest } = l; return { ...rest, cells: via && via.length ? expand(via) : [], stations: l.stations || [], names: l.names || [], trains: l.trains || 1 }; });
    } else { delete lv.roads; delete lv.lines; }
    if (mode === 4) lv.land = lv.land || []; else delete lv.land;
    lv.tiers = lv.tiers || [0, 0, 0];
    delete lv.demo; delete lv.title; delete lv.story;
    return lv; }
  // what the editor edits → the game's level
  function toGame(lv, mode, meta) {
    const out = clone(lv);
    if (mode === 3) {
      out.roads = lv.roads.filter(r => r.cells.length >= 2).map(r => { const { cells, ...rest } = r; return { ...rest, via: corners(cells) }; });
      out.lines = lv.lines.filter(l => l.cells.length >= 2).map(l => { const { cells, ...rest } = l;
        const order = st => cells.findIndex(c => same(c, st)), pairs = l.stations.map((s, j) => ({ s, n: l.names[j] || '' })).filter(p => order(p.s) >= 0).sort((a, b) => order(a.s) - order(b.s));
        return { ...rest, via: corners(cells), stations: pairs.map(p => p.s), names: pairs.map(p => p.n), trains: Math.max(1, Math.round(l.trains || 1)) }; });
    }
    if (!out.water || !out.water.length) { delete out.water; delete out.waterBlocksWalk; }
    else if (!out.waterBlocksWalk) delete out.waterBlocksWalk;
    if (meta) { out.title = meta.title['zh-Hant'] || t('e.myLevel'); out.story = meta.story.filter(Boolean); }
    return out; }
  // a fresh level for a mode: the built-in level's rule numbers, an empty map
  function blank(mode) {
    const lv = fromGame(ENG[mode].D.example(EXAMPLE[mode]), mode);
    lv.origins = []; lv.destinations = []; lv.water = []; lv.tiers = [0, 0, 0];
    if (mode === 3) { lv.roads = []; lv.lines = []; }
    if (mode === 4) lv.land = [];
    return lv; }
  const blankMeta = mode => ({ key: '', order: 2, challenge: false, title: { 'zh-Hant': '', 'zh-Hans': '', en: '' }, story: ['', ''], station: '', author: '', source: '' });
  // the whole editor: the mode on show and one level per mode
  let S = load();
  { const m = +(/(?:^|[#&])mode=([234])/.exec(location.hash) || [])[1]; if (m) S.mode = m; }   // mode 1's editor links here with #mode=N
  function load() {
    try { const s = JSON.parse(localStorage.getItem(SAVE) || 'null'); if (s && s.docs && s.docs[s.mode]) return s; } catch (e) {}
    const docs = {}; for (const m of [2, 3, 4]) docs[m] = { meta: blankMeta(m), level: fromGame(ENG[m].D.example(EXAMPLE[m]), m) };
    for (const m of [2, 3, 4]) docs[m].meta.title['zh-Hant'] = t('e.myLevel');
    return { mode: 3, docs }; }
  function save() { try { localStorage.setItem(SAVE, JSON.stringify(S)); } catch (e) {} }
  const doc = () => S.docs[S.mode], lv = () => doc().level, meta = () => doc().meta;
  let analysis = null, busy = false;
  function changed(keepAnalysis) { save(); if (!keepAnalysis) analysis = null; render(); }

  /* ----------------------------------------------------------------- checking */
  function problems() {
    const L = lv(), m = S.mode, out = [], wet = new Set(L.water.map(k));
    if (!meta().title['zh-Hant'].trim()) out.push(t('e.p.title'));
    if (meta().key && !/^[a-z0-9-]+$/.test(meta().key)) out.push(t('e.p.key'));
    if (L.origins.length < 2) out.push(t('e.p.origins'));
    if (L.destinations.length < 2) out.push(t('e.p.dests'));
    for (const o of L.origins) { if (!(o.people > 0)) out.push(t('e.p.people', { s: o.name })); if (wet.has(k(o.cell))) out.push(t('e.p.wet', { s: o.name })); }
    for (const d of L.destinations) { if (!(d.attraction > 0)) out.push(t('e.p.pull', { s: d.name })); if (wet.has(k(d.cell))) out.push(t('e.p.wet', { s: d.name })); }
    if (m === 3) {
      const roads = L.roads.filter(r => r.cells.length >= 2);
      if (!roads.length) out.push(t('e.p.roads'));
      else { const cells = roads.flatMap(r => r.cells);
        for (const x of [...L.origins, ...L.destinations]) if (!cells.some(c => Math.abs(c[0] - x.cell[0]) + Math.abs(c[1] - x.cell[1]) <= 1)) out.push(t('e.p.offRoad', { s: x.name })); }
    }
    if (m === 4 && L.land.length < 4) out.push(t('e.p.land'));
    const tr = L.tiers; if (!(tr[0] <= tr[1] && tr[1] <= tr[2])) out.push(t('e.p.tiers'));
    return out; }
  // the game itself reads the level: an error here is one the game would hit
  function engineCheck() {
    // (a two-station line from the first estate to the first destination; mode 2 never ends a run with no stations)
    try { const M = ENG[S.mode], L = toGame(lv(), S.mode, meta()); M.D.use(L, 'editor-check'); M.reset(); const p = new M.Plan(), a = L.origins[0].cell, z = L.destinations[0].cell;
      let c = a.slice(), ok = p.extend(c); while (ok && c[0] !== z[0]) { c = [c[0] + Math.sign(z[0] - c[0]), c[1]]; ok = p.extend(c); } while (ok && c[1] !== z[1]) { c = [c[0], c[1] + Math.sign(z[1] - c[1])]; ok = p.extend(c); }
      if (ok && p.canStation(a)) p.toggleStation(a); if (ok && p.canStation(z)) p.toggleStation(z);
      if (p.stations.length >= 2) p.simulate(); return null; }
    catch (e) { return t('e.p.engine', { s: e.message }); } }

  /* ------------------------------------------------------------------- drawing */
  const CS = 46, MX = 34, MY = 34, xy = c => [MX + c[0] * CS + CS / 2, MY + c[1] * CS + CS / 2];
  const svg = (tag, a, inner = '') => `<${tag} ${Object.entries(a).map(([x, v]) => `${x}="${v}"`).join(' ')}>${inner}</${tag}>`;
  const tok = n => getComputedStyle(document.documentElement).getPropertyValue('--s-' + n).trim();
  let tool = 'origin', hover = null, sel = null;   // sel: {kind: 'origin'|'dest'|'road'|'line', i}
  const TOOLS = () => ['origin', 'dest', 'water', ...(S.mode === 3 ? ['road', 'line'] : []), ...(S.mode === 4 ? ['land'] : []), 'erase'];
  function label(x, y, s, color, size = 12.5, weight = 600, anchor = 'middle') {
    return svg('text', { x, y, 'font-size': size, 'font-weight': weight, fill: color, stroke: tok('panel'), 'stroke-width': 3.5, 'paint-order': 'stroke', 'text-anchor': anchor }, esc(s)); }
  function drawBoard() {
    const L = lv(), W = MX * 2 + L.cols * CS, H = MY * 2 + L.rows * CS;
    const C = { road: tok('road'), edge: tok('road-edge'), ink: tok('ink'), ink2: tok('ink2'), ink3: tok('ink3'), paper: tok('paper'), panel: tok('panel'),
      accent: tok('accent'), info: tok('info'), warn: tok('warn'), line: tok('line2'), bad: tok('bad') };
    let out = svg('rect', { x: MX, y: MY, width: L.cols * CS, height: L.rows * CS, fill: 'none', stroke: C.line, 'stroke-width': 1, 'stroke-dasharray': '2 4' });
    for (let x = 0; x < L.cols; x++) for (let y = 0; y < L.rows; y++) { const [px, py] = xy([x, y]); out += svg('circle', { cx: px, cy: py, r: 1.8, fill: C.line }); }
    for (const c of L.water) { const [x, y] = xy(c); out += svg('rect', { x: x - CS / 2, y: y - CS / 2, width: CS, height: CS, fill: C.info, 'fill-opacity': L.waterBlocksWalk ? .26 : .15 }); }
    if (S.mode === 4) for (const q of L.land) { const [x, y] = xy(q.cell); out += svg('rect', { x: x - 16, y: y - 16, width: 32, height: 32, rx: 3, fill: C.warn, 'fill-opacity': .1, stroke: C.warn, 'stroke-width': 1.2, 'stroke-dasharray': '3 3' }); }
    if (S.mode === 3) {
      L.roads.forEach((r, i) => { if (!r.cells.length) return; const d = r.cells.map((c, j) => (j ? 'L' : 'M') + xy(c).join(' ')).join('');
        const on = sel && sel.kind === 'road' && sel.i === i;
        out += svg('path', { d, fill: 'none', stroke: C.edge, 'stroke-width': 24, 'stroke-linecap': 'square', 'stroke-linejoin': 'miter' });
        out += svg('path', { d, fill: 'none', stroke: on ? C.warn : C.road, 'stroke-opacity': on ? .55 : 1, 'stroke-width': 20, 'stroke-linecap': 'square', 'stroke-linejoin': 'miter' }); });
      L.roads.forEach((r, i) => { if (r.cells.length < 2) return; const c = r.cells[Math.floor(r.cells.length / 2)], [x, y] = xy(c); out += label(x, y + 4, r.name, C.ink3, 10.5, 500); });
      L.lines.forEach((l, i) => { if (!l.cells.length) return; const d = l.cells.map((c, j) => (j ? 'L' : 'M') + xy(c).join(' ')).join('');
        const on = sel && sel.kind === 'line' && sel.i === i;
        out += svg('path', { d, fill: 'none', stroke: C.panel, 'stroke-width': on ? 9 : 7, 'stroke-linejoin': 'round' }) + svg('path', { d, fill: 'none', stroke: l.color || LINE_COLORS[0], 'stroke-width': on ? 6 : 4, 'stroke-linejoin': 'round' });
        for (const s of l.stations) { const [x, y] = xy(s); out += svg('circle', { cx: x, cy: y, r: 6, fill: C.panel, stroke: l.color || LINE_COLORS[0], 'stroke-width': 2.4 }); } });
    }
    L.origins.forEach((o, i) => { const [x, y] = xy(o.cell), on = sel && sel.kind === 'origin' && sel.i === i;
      out += svg('rect', { x: x - 13, y: y - 9, width: 8, height: 20, fill: C.ink2 }) + svg('rect', { x: x - 4, y: y - 15, width: 9, height: 26, fill: on ? C.accent : C.ink }) + svg('rect', { x: x + 6, y: y - 5, width: 8, height: 16, fill: C.ink2 });
      out += label(x, y + 26, o.name, on ? C.accent : C.ink) + label(x, y - 20, o.people, C.ink3, 10.5, 500); });
    L.destinations.forEach((d, i) => { const [x, y] = xy(d.cell), on = sel && sel.kind === 'dest' && sel.i === i, col = d.kind === 'town' ? C.warn : C.info;
      out += svg('rect', { x: x - 14, y: y - 14, width: 28, height: 28, rx: 4, fill: col, 'fill-opacity': on ? .35 : .2, stroke: on ? C.accent : col, 'stroke-width': on ? 2.4 : 1.6 });
      out += svg('text', { x, y: y + 5, 'font-size': 14, 'text-anchor': 'middle', fill: col }, d.kind === 'town' ? '★' : '◆');
      out += label(x, y + 30, d.short || d.name, on ? C.accent : C.ink) + label(x, y - 20, '+' + d.attraction, C.ink3, 10.5, 500); });
    if (hover) { const [x, y] = xy(hover); out += svg('rect', { x: x - CS / 2 + 3, y: y - CS / 2 + 3, width: CS - 6, height: CS - 6, rx: 5, fill: 'none', stroke: C.accent, 'stroke-width': 2, 'stroke-dasharray': '4 3' }); }
    const b = $('eeBoard'); b.setAttribute('viewBox', `0 0 ${W} ${H}`); b.innerHTML = out; }
  // what is on a cell, for the strip under the map
  function cellInfo(c) {
    if (!c) return t('e.hoverNone');
    const L = lv(), parts = [t('e.hoverAt', { x: c[0] + 1, y: c[1] + 1 })];
    for (const o of L.origins) if (same(o.cell, c)) parts.push(o.name + ' · ' + o.people);
    for (const d of L.destinations) if (same(d.cell, c)) parts.push(d.name + ' · +' + d.attraction);
    if (L.water.some(w => same(w, c))) parts.push(t('e.hoverWater'));
    if (S.mode === 4 && L.land.some(q => same(q.cell, c))) parts.push(t('e.hoverLand'));
    if (S.mode === 3) { for (const r of L.roads) if (r.cells.some(x => same(x, c))) parts.push(r.name + ' · ' + r.cap);
      for (const l of L.lines) if (l.cells.some(x => same(x, c))) parts.push(l.name + (l.stations.some(s => same(s, c)) ? ' ●' : '')); }
    return parts.join(' · '); }

  /* -------------------------------------------------------------- side panels */
  const val = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v; };
  function itemRow(kind, i, name, num, numAttr) {
    const on = sel && sel.kind === kind && sel.i === i;
    return `<div class="ed-est ee-row ${on ? 'sel' : ''}" data-kind="${kind}" data-i="${i}"><input class="ed-in" data-f="name" value="${esc(name)}" maxlength="12" aria-label="${t('e.name')}">` +
      (num !== null ? `<input class="ed-in mono" type="number" data-f="${numAttr}" value="${num}" min="0">` : '<span></span>') +
      `<button class="btn btn-sm" data-f="del" title="${t('e.del')}">×</button></div>`; }
  function render() {
    const L = lv(), M = meta(), m = S.mode;
    document.title = t('e.doc');
    document.querySelectorAll('#eeModes [data-mode]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.mode === m)));
    if (!TOOLS().includes(tool)) tool = 'origin';
    $('eeTools').innerHTML = TOOLS().map((x, j) => `<button data-tool="${x}" aria-pressed="${x === tool}" title="${j + 1}">${t('e.tool.' + x)}</button>`).join('');
    $('eeToolHint').textContent = t('e.t.' + tool);
    val('eeTitle', M.title['zh-Hant']); $('eeTitle').placeholder = t('e.titlePh'); val('eeCols', L.cols); val('eeRows', L.rows);
    $('eeOrigins').innerHTML = L.origins.length ? L.origins.map((o, i) => itemRow('origin', i, o.name, o.people, 'people')).join('') : `<p class="note">${t('e.none')}</p>`;
    $('eeDests').innerHTML = L.destinations.length ? L.destinations.map((d, i) => itemRow('dest', i, d.name, d.attraction, 'attraction')).join('') : `<p class="note">${t('e.none')}</p>`;
    $('eeRoadsBox').hidden = m !== 3; $('eeLinesBox').hidden = m !== 3;
    if (m === 3) {
      $('eeRoads').innerHTML = L.roads.length ? L.roads.map((r, i) => itemRow('road', i, r.name, r.cap, 'cap')).join('') : `<p class="note">${t('e.none')}</p>`;
      $('eeLines').innerHTML = L.lines.length ? L.lines.map((l, i) => itemRow('line', i, l.name, l.trains, 'trains')).join('') : `<p class="note">${t('e.none')}</p>`; }
    $('eeLandCount').hidden = m !== 4; if (m === 4) $('eeLandCount').textContent = t('e.landCount', { n: L.land.length });
    const pr = problems(); $('eeProblems').innerHTML = pr.length ? pr.map(s => `<li>${esc(s)}</li>`).join('') : `<li class="ok">${t('e.pNone')}</li>` + (L.tiers.some(x => x > 0) ? '' : `<li class="ee-warn-li">${t('e.noTiers')}</li>`);
    $('eePlay').disabled = pr.length > 0; $('eeAnalyse').disabled = pr.length > 0 || busy;
    renderStart(); renderSel(); renderMeta(); renderRules(); renderAnalysis(); drawBoard(); $('eeCell').textContent = cellInfo(hover); }
  function renderStart() {
    const list = root.TL_LEVELS ? root.TL_LEVELS.mode(S.mode) : [], pick = x => typeof x === 'string' ? x : x && (x[I.lang] || x['zh-Hant']) || '';
    $('eeStart').innerHTML = `<option value="">${t('e.startPick')}</option><option value="blank">${t('e.blank')}</option>` +
      list.map(e => `<option value="${esc(e.key)}">${esc(e.order + ' · ' + pick(e.title))}${e.challenge ? ' 🏆' : ''}</option>`).join(''); }
  // the selected thing: every field, the usual ones first
  function renderSel() {
    const L = lv(), box = $('eeSel'); if (!sel) { box.innerHTML = `<p class="note">${t('e.selNone')}</p>`; return; }
    const f = (lab, key, v, type = 'text', extra = '') => `<label class="ee-f"><span>${t(lab)}</span><input class="ed-in ${type === 'number' ? 'mono' : ''}" data-s="${key}" type="${type}" value="${esc(v)}" ${extra}></label>`;
    const sideSel = h => `<label class="ee-f"><span>${t('e.house')}</span><select class="ed-in" data-s="house">${Object.keys(SIDES).map(s => `<option value="${s}" ${s === sideOf(h) ? 'selected' : ''}>${t('e.side.' + s)}</option>`).join('')}</select></label>`;
    const grow = g => (g || []).map(p => p[0] + ':' + p[1]).join(' ');
    let h = '';
    if (sel.kind === 'origin') { const o = L.origins[sel.i]; if (!o) { sel = null; return renderSel(); }
      h = f('e.name', 'name', o.name) + f('e.people', 'people', o.people, 'number', 'min="0" max="400"') + sideSel(o.house) +
        `<details class="ee-more"><summary>${t('e.moreFields')}</summary>` + f('e.hans', 'hans', o.hans || '') +
        (S.mode === 3 ? f('e.grow', 'grow', grow(o.grow)) + `<label class="ee-check"><input type="checkbox" data-s="tagNew" ${o.tag === 'new' ? 'checked' : ''}> ${t('e.newTag')}</label>` : '') + '</details>'; }
    else if (sel.kind === 'dest') { const d = L.destinations[sel.i]; if (!d) { sel = null; return renderSel(); }
      h = f('e.name', 'name', d.name) + f('e.short', 'short', d.short || '') + f('e.attraction', 'attraction', d.attraction, 'number', 'min="0" max="100" step="0.5"') +
        `<label class="ee-f"><span>${t('e.kind')}</span><select class="ed-in" data-s="kind">${['town', 'jobs'].map(x => `<option value="${x}" ${x === d.kind ? 'selected' : ''}>${t('e.kind.' + x)}</option>`).join('')}</select></label>` +
        f('e.carExtraD', 'carExtra', d.carExtra ?? 2, 'number', 'min="0" max="20"') +
        `<details class="ee-more"><summary>${t('e.moreFields')}</summary>` + f('e.hans', 'hans', d.hans || '') + sideSel(d.house) + (S.mode === 3 ? f('e.grow', 'grow', grow(d.grow)) : '') + '</details>'; }
    else if (sel.kind === 'road') { const r = L.roads[sel.i]; if (!r) { sel = null; return renderSel(); }
      h = f('e.name', 'name', r.name) + f('e.cap', 'cap', r.cap, 'number', 'min="1" max="400"') + `<details class="ee-more"><summary>${t('e.moreFields')}</summary>` + f('e.hans', 'hans', r.hans || '') + '</details>'; }
    else if (sel.kind === 'line') { const l = L.lines[sel.i]; if (!l) { sel = null; return renderSel(); }
      h = f('e.name', 'name', l.name) + f('e.trains', 'trains', l.trains, 'number', 'min="1" max="20"') + f('e.color', 'color', l.color || LINE_COLORS[0], 'color') +
        f('e.stationNames', 'names', (l.names || []).join('、')) + `<details class="ee-more"><summary>${t('e.moreFields')}</summary>` + f('e.hans', 'hans', l.hans || '') + '</details>'; }
    box.innerHTML = h; }
  function renderMeta() {
    const M = meta();
    val('eeKey', M.key); val('eeOrder', M.order); $('eeChallenge').checked = !!M.challenge;
    val('eeTitleHans', M.title['zh-Hans']); val('eeTitleEn', M.title.en); val('eeStory0', M.story[0] || ''); val('eeStory1', M.story[1] || '');
    val('eeStation', M.station); val('eeAuthor', M.author); val('eeSource', M.source); }
  const BASIC = m => [['budget', 'e.budget', 1, 200], ...(m === 3 ? [['phase2Budget', 'e.phase2Budget', 0, 200]] : []), ['years', 'e.years', m === 3 ? 5 : 1, 20]];
  const ADV = m => [['walkPer', 0, 10], ['wait', 0, 10], ['nearby', 0, 60], ['stay', 0, 200], ['lineCost', 0, 10], ['stationCost', 0, 20], ['trainCost', 0, 20],
    ['perTrain', 1, 200], ['crowdBlocks', 0, 20], ['awareStart', 0, 1], ['awareSpread', 0, 10], ...(m === 3 ? [['learn', 0, 1]] : []),
    ...(m === 4 ? [['homePeople', 0, 100], ['shopBase', 0, 50], ['shopPer', 0, 50], ['carExtra', 0, 20], ['homeRate', 0, 10], ['shopRate', 0, 10]] : [])];
  const getRule = (L, f) => f === 'awareStart' ? (L.aware || {}).start : f === 'awareSpread' ? (L.aware || {}).spread : L[f];
  function renderRules() {
    const L = lv(), m = S.mode, inp = (f, lab, a, b, v, step) => `<label><span>${t(lab)}</span><input class="ed-in mono" type="number" data-r="${f}" min="${a}" max="${b}" step="${step || 'any'}" value="${v ?? ''}"></label>`;
    if (!$('eeRules').contains(document.activeElement)) $('eeRules').innerHTML = BASIC(m).map(([f, lab, a, b]) => inp(f, lab, a, b, L[f], 1)).join('');
    if (!$('eeTiers').contains(document.activeElement)) $('eeTiers').innerHTML = ['pass', 'high', 'master'].map((x, j) => `<label><span>${t('e.' + x)}</span><input class="ed-in mono" type="number" data-tier="${j}" min="0" value="${L.tiers[j]}"></label>`).join('');
    if (!$('eeAdvanced').contains(document.activeElement)) $('eeAdvanced').innerHTML = ADV(m).map(([f, a, b]) => inp(f, 'e.f.' + f, a, b, getRule(L, f))).join('');
    $('eeWaterBox').hidden = !L.water.length; $('eeWaterBlocks').checked = !!L.waterBlocksWalk; }
  function renderAnalysis() {
    const el = $('eeAnalysis');
    if (!analysis) { el.innerHTML = `<p class="note">${t('e.aIdle')}</p>`; return; }
    if (analysis.progress !== undefined) { el.innerHTML = `<p class="note">${t('e.aBusy', { p: Math.round(100 * analysis.progress) })}</p><div class="gauge"><i style="width:${100 * analysis.progress}%"></i></div>`; return; }
    const a = analysis, warn = [];
    if (a.best < 50) warn.push(t('e.wNone')); else if (a.simple >= a.tiers[2]) warn.push(t('e.wEasy'));
    el.innerHTML = `<div class="r"><span>${t('e.aBest')}</span><b class="mono">${a.best}</b></div><div class="r"><span>${t('e.aSimple')}</span><b class="mono">${a.simple}</b></div>` +
      (a.plan ? `<p class="note">${t('e.aPlan', { n: a.plan.line.length, s: a.plan.stations.length, tr: a.plan.trains, land: a.plan.actions.length ? t('e.aLand', { n: a.plan.actions.length }) : '' })}</p>` : '') +
      `<div class="r"><span>${t('e.aTiers')}</span><b class="mono">${a.tiers.join(' / ')}</b></div>` + warn.map(w => `<p class="note ed-warn">${w}</p>`).join('') +
      `<button class="btn btn-sm" id="eeUseTiers">${t('e.useTiers')}</button>`;
    $('eeUseTiers').onclick = () => { lv().tiers = a.tiers.slice(); changed(true); }; }

  /* ------------------------------------------------------------------- editing */
  const board = $('eeBoard');
  function cellAt(e) { const p = board.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const q = p.matrixTransform(board.getScreenCTM().inverse()), L = lv();
    const c = [Math.floor((q.x - MX) / CS), Math.floor((q.y - MY) / CS)]; return c[0] >= 0 && c[1] >= 0 && c[0] < L.cols && c[1] < L.rows ? c : null; }
  // a straight run of cells (row first, then column), so a quick drag leaves no gaps
  function run(a, b) { const out = []; let [x, y] = a; while (x !== b[0]) { x += Math.sign(b[0] - x); out.push([x, y]); } while (y !== b[1]) { y += Math.sign(b[1] - y); out.push([x, y]); } return out; }
  const placeAt = c => { const L = lv(); const o = L.origins.findIndex(x => same(x.cell, c)); if (o >= 0) return { kind: 'origin', i: o };
    const d = L.destinations.findIndex(x => same(x.cell, c)); return d >= 0 ? { kind: 'dest', i: d } : null; };
  const wetAt = c => lv().water.some(w => same(w, c));
  let drag = null;   // {type, last, moved, item}
  function down(c, e) {
    const L = lv(), at = placeAt(c); drag = { type: tool, last: c, start: c, moved: false };
    if (tool === 'origin' || tool === 'dest') {
      const kind = tool;
      if (at && at.kind === kind) { sel = at; drag.item = at; return; }       // pick it up: released on another cell, it moves
      if (at) { flash(t('e.taken')); drag = null; return; }
      if (wetAt(c)) { flash(t('e.onWater')); drag = null; return; }
      if (kind === 'origin') { const n = L.origins.length + 1; L.origins.push({ name: t('e.newOrigin', { n }), hans: t('e.newOrigin', { n }), cell: c, house: [0, -1], people: 40 }); sel = { kind, i: L.origins.length - 1 }; }
      else { const n = L.destinations.length + 1, nm = t('e.newDest', { n }); L.destinations.push({ name: nm, hans: nm, short: nm, shortHans: nm, kind: 'jobs', cell: c, house: [0, 1], attraction: 20, carExtra: 3 }); sel = { kind, i: L.destinations.length - 1 }; }
      drag = null; return; }
    if (tool === 'water') { if (!wetAt(c) && !at) L.water.push(c); return; }
    if (tool === 'land') { const i = L.land.findIndex(q => same(q.cell, c)); if (i >= 0) L.land.splice(i, 1); else if (at || wetAt(c)) flash(t('e.taken')); else L.land.push({ cell: c }); drag = null; return; }
    if (tool === 'road' || tool === 'line') {
      const list = tool === 'road' ? L.roads : L.lines, kind = tool;
      // on a line (not an end of the selected one): a click puts a station there or takes it away
      if (kind === 'line') { const li = L.lines.findIndex(l => l.cells.some(x => same(x, c)));
        const selLine = sel && sel.kind === 'line' ? L.lines[sel.i] : null, atEnd = selLine && (same(selLine.cells[0], c) || same(selLine.cells.at(-1), c));
        if (li >= 0 && !atEnd) { drag = { type: 'station', line: li, cell: c }; return; } }
      const cur = sel && sel.kind === kind ? list[sel.i] : null;
      if (cur && same(cur.cells.at(-1), c)) { drag.item = { list, i: sel.i, end: 1 }; return; }
      if (cur && same(cur.cells[0], c)) { cur.cells.reverse(); drag.item = { list, i: sel.i, end: 1 }; return; }
      const n = list.length + 1;
      list.push(kind === 'road' ? { name: t('e.newRoad', { n }), hans: t('e.newRoad', { n }), cap: 60, cells: [c] }
        : { name: t('e.newLine', { n }), hans: t('e.newLine', { n }), color: LINE_COLORS[(n - 1) % LINE_COLORS.length], cells: [c], stations: [], names: [], trains: 2 });
      sel = { kind, i: list.length - 1 }; drag.item = { list, i: list.length - 1, end: 1, fresh: true }; return; }
    if (tool === 'erase') { eraseClick(c); drag.erase = true; } }
  function move(c) {
    if (!drag || !c || same(c, drag.last)) return false;
    const L = lv(), steps = run(drag.last, c); drag.moved = true;
    if (drag.type === 'water') for (const d of steps) if (!wetAt(d) && !placeAt(d)) L.water.push(d);
    if ((drag.type === 'road' || drag.type === 'line') && drag.item) { const it = drag.item.list[drag.item.i];
      for (const d of steps) { if (same(it.cells.at(-2), d)) { it.cells.pop(); continue; }   // stepping back undoes
        if (!it.cells.some(x => same(x, d))) it.cells.push(d); } }
    if (drag.type === 'erase') for (const d of steps) eraseDrag(d);
    drag.last = c; return true; }
  function up(c) {
    const L = lv();
    if (drag && drag.item && (drag.type === 'origin' || drag.type === 'dest') && c && !same(c, drag.start)) {
      const it = drag.item.kind === 'origin' ? L.origins[drag.item.i] : L.destinations[drag.item.i];
      if (placeAt(c)) flash(t('e.taken')); else if (wetAt(c)) flash(t('e.onWater')); else it.cell = c; }
    if (drag && drag.type === 'station') { const l = L.lines[drag.line], j = l.stations.findIndex(s => same(s, drag.cell));
      if (j >= 0) { l.stations.splice(j, 1); l.names.splice(j, 1); } else { l.stations.push(drag.cell); l.names.push(''); }
      sortStations(l); sel = { kind: 'line', i: drag.line }; }
    // a click (no drag) on an end of the selected line: a station there, as anywhere else on it
    if (drag && drag.type === 'line' && drag.item && !drag.item.fresh && !drag.moved) { const l = drag.item.list[drag.item.i], j = l.stations.findIndex(s => same(s, drag.start));
      if (j >= 0) { l.stations.splice(j, 1); l.names.splice(j, 1); } else { l.stations.push(drag.start); l.names.push(''); } sortStations(l); }
    if (drag && drag.item && drag.item.fresh) { const it = drag.item.list[drag.item.i]; if (it.cells.length < 2) { drag.item.list.splice(drag.item.i, 1); sel = null; } }
    drag = null; }
  // a line's stations (and their names) in order along it, so «station names in order» reads as the map does
  function sortStations(l) { const order = st => l.cells.findIndex(c => same(c, st)), pairs = l.stations.map((s, j) => ({ s, n: l.names[j] || '' })).sort((a, b) => order(a.s) - order(b.s));
    l.stations = pairs.map(p => p.s); l.names = pairs.map(p => p.n); }
  function eraseClick(c) {
    const L = lv(), at = placeAt(c);
    if (at) { (at.kind === 'origin' ? L.origins : L.destinations).splice(at.i, 1); sel = null; return; }
    if (S.mode === 3) { for (const l of L.lines) { const j = l.stations.findIndex(s => same(s, c)); if (j >= 0) { l.stations.splice(j, 1); l.names.splice(j, 1); return; } } }
    eraseDrag(c); }
  // a road or line loses a cell; one cut in the middle becomes two pieces (same name)
  function cutPath(list, c) {
    for (let i = 0; i < list.length; i++) { const it = list[i], j = it.cells.findIndex(x => same(x, c)); if (j < 0) continue;
      const a = it.cells.slice(0, j), b = it.cells.slice(j + 1);
      if (it.stations) it.stations = it.stations.filter(s => !same(s, c));
      if (a.length >= 2 && b.length >= 2) { it.cells = a; const piece = { ...clone(it), cells: b };
        if (it.stations) { piece.stations = it.stations.filter(s => b.some(x => same(x, s))); it.stations = it.stations.filter(s => a.some(x => same(x, s))); }
        list.splice(i + 1, 0, piece); }
      else it.cells = a.length >= b.length ? a : b;
      if (it.cells.length < 2) list.splice(i, 1);
      sel = null; return true; }
    return false; }
  function eraseDrag(c) {
    const L = lv();
    if (S.mode === 4) { const i = L.land.findIndex(q => same(q.cell, c)); if (i >= 0) { L.land.splice(i, 1); return; } }
    if (S.mode === 3 && (cutPath(L.lines, c) || cutPath(L.roads, c))) return;
    const w = L.water.findIndex(x => same(x, c)); if (w >= 0) L.water.splice(w, 1); }
  board.addEventListener('pointerdown', e => { const c = cellAt(e); if (!c) return; board.setPointerCapture(e.pointerId); down(c, e); changed(); });
  board.addEventListener('pointermove', e => { const c = cellAt(e), moved = k(c || [-1, -1]) !== k(hover || [-1, -1]); hover = c;
    if (drag && e.buttons && move(c)) { changed(); return; } if (moved) { drawBoard(); $('eeCell').textContent = cellInfo(hover); } });
  board.addEventListener('pointerup', e => { if (drag) { up(cellAt(e)); changed(); } });
  board.addEventListener('pointercancel', () => { drag = null; });
  board.addEventListener('pointerleave', () => { hover = null; drawBoard(); $('eeCell').textContent = cellInfo(null); });
  $('eeTools').onclick = e => { const b = e.target.closest('[data-tool]'); if (b) { tool = b.dataset.tool; render(); } };
  document.addEventListener('keydown', e => { if (e.target.closest('input,select,textarea') || document.querySelector('dialog[open]')) return;
    const n = +e.key; if (n >= 1 && n <= TOOLS().length) { tool = TOOLS()[n - 1]; render(); }
    if (e.key === 'Escape') { sel = null; render(); } });
  $('eeModes').onclick = e => { const b = e.target.closest('[data-mode]'); if (!b) return; S.mode = +b.dataset.mode; sel = null; analysis = null; changed(); };
  // the lists on the left: names and the main number; a click picks the thing
  for (const id of ['eeOrigins', 'eeDests', 'eeRoads', 'eeLines']) {
    $(id).addEventListener('change', e => { const row = e.target.closest('[data-i]'); if (!row) return; const it = itemOf(row.dataset.kind, +row.dataset.i), f = e.target.dataset.f; if (!it || !f) return;
      if (f === 'name') { const old = it.name; it.name = e.target.value.trim().slice(0, 12) || it.name;   // names that followed the old one follow the new one
        for (const g of ['hans', 'short', 'shortHans']) if (it[g] === old) it[g] = it.name; }
      else it[f] = Math.max(0, +e.target.value || 0);
      changed(); });
    $(id).addEventListener('click', e => { const row = e.target.closest('[data-i]'); if (!row) return; const kind = row.dataset.kind, i = +row.dataset.i;
      if (e.target.closest('[data-f="del"]')) { listOf(kind).splice(i, 1); sel = null; changed(); return; }
      if (!sel || sel.kind !== kind || sel.i !== i) { sel = { kind, i }; render(); } }); }
  const listOf = kind => ({ origin: lv().origins, dest: lv().destinations, road: lv().roads, line: lv().lines })[kind];
  const itemOf = (kind, i) => (listOf(kind) || [])[i];
  // the selected thing's own fields
  $('eeSel').addEventListener('change', e => { if (!sel) return; const it = itemOf(sel.kind, sel.i), f = e.target.dataset.s; if (!it || !f) return; const v = e.target.value;
    if (f === 'house') it.house = SIDES[v].slice();
    else if (f === 'grow') { const pts = v.split(/[\s,，、]+/).map(s => s.split(/[:：]/).map(Number)).filter(p => p.length === 2 && p.every(Number.isFinite) && p[0] > 0);
      if (pts.length) it.grow = pts.sort((a, b) => a[0] - b[0]); else delete it.grow; }
    else if (f === 'tagNew') { if (e.target.checked) it.tag = 'new'; else delete it.tag; }
    else if (f === 'names') it.names = v.split(/[、,，]/).map(s => s.trim());
    else if (f === 'short') { const old = it.short; it.short = v.trim().slice(0, 8) || it.name; if (!it.shortHans || it.shortHans === old) it.shortHans = it.short; }
    else if (['people', 'attraction', 'carExtra', 'cap', 'trains'].includes(f)) it[f] = Math.max(0, +v || 0);
    else if (f === 'color') it.color = v;
    else it[f] = v.trim().slice(0, 24);
    changed(); });
  // the level's own facts
  const metaInput = (id, set) => $(id).addEventListener('input', () => { set($(id).value); save(); if (id === 'eeTitle' || id === 'eeKey') { const pr = problems(); $('eeProblems').innerHTML = pr.length ? pr.map(s => `<li>${esc(s)}</li>`).join('') : `<li class="ok">${t('e.pNone')}</li>`; $('eePlay').disabled = pr.length > 0; } });
  metaInput('eeTitle', v => { meta().title['zh-Hant'] = v.slice(0, 24); });
  metaInput('eeKey', v => { meta().key = v.trim().toLowerCase(); });
  metaInput('eeOrder', v => { meta().order = Math.max(1, Math.round(+v || 1)); });
  metaInput('eeTitleHans', v => { meta().title['zh-Hans'] = v; }); metaInput('eeTitleEn', v => { meta().title.en = v; });
  metaInput('eeStory0', v => { meta().story[0] = v; }); metaInput('eeStory1', v => { meta().story[1] = v; });
  metaInput('eeStation', v => { meta().station = v.trim(); }); metaInput('eeAuthor', v => { meta().author = v; }); metaInput('eeSource', v => { meta().source = v; });
  $('eeChallenge').onchange = () => { meta().challenge = $('eeChallenge').checked; save(); };
  $('eeCols').onchange = $('eeRows').onchange = () => { const L = lv(); L.cols = Math.max(6, Math.min(20, Math.round(+$('eeCols').value) || L.cols)); L.rows = Math.max(5, Math.min(16, Math.round(+$('eeRows').value) || L.rows)); trim(); changed(); };
  function trim() { const L = lv(), ok = c => c[0] < L.cols && c[1] < L.rows;
    L.origins = L.origins.filter(o => ok(o.cell)); L.destinations = L.destinations.filter(d => ok(d.cell)); L.water = L.water.filter(ok);
    if (L.land) L.land = L.land.filter(q => ok(q.cell));
    for (const list of [L.roads, L.lines]) if (list) for (let i = list.length - 1; i >= 0; i--) { const it = list[i], j = it.cells.findIndex(c => !ok(c)); if (j >= 0) it.cells = it.cells.slice(0, j);
      if (it.stations) it.stations = it.stations.filter(ok); if (it.cells.length < 2) list.splice(i, 1); }
    sel = null; }
  $('eeRules').addEventListener('change', e => { const f = e.target.dataset.r; if (!f) return; lv()[f] = Math.max(0, Math.round(+e.target.value) || 0); changed(); });
  $('eeTiers').addEventListener('change', e => { const j = e.target.dataset.tier; if (j === undefined) return; lv().tiers[+j] = Math.max(0, Math.round(+e.target.value) || 0); changed(true); });
  $('eeAdvanced').addEventListener('change', e => { const f = e.target.dataset.r; if (!f) return; const L = lv(), v = Math.max(0, +e.target.value || 0);
    if (f === 'awareStart') L.aware = { ...(L.aware || {}), start: Math.min(1, v) }; else if (f === 'awareSpread') L.aware = { ...(L.aware || {}), spread: v }; else L[f] = v; changed(); });
  $('eeWaterBlocks').onchange = () => { lv().waterBlocksWalk = $('eeWaterBlocks').checked; changed(); };
  // start from a level already in the game (or a blank map): its map and numbers, not its key
  $('eeStart').onchange = e => { const v = e.target.value; e.target.value = ''; if (!v) return; const m = S.mode;
    if (v === 'blank') S.docs[m] = { meta: blankMeta(m), level: blank(m) };
    else { const lvl = ENG[m].D.example(v), entry = root.TL_LEVELS && root.TL_LEVELS.get(m, v); if (!lvl) return;
      const M = blankMeta(m); if (entry && entry.title) { const tt = entry.title; M.title = typeof tt === 'string' ? { 'zh-Hant': tt, 'zh-Hans': tt, en: '' } : { 'zh-Hant': tt['zh-Hant'] || '', 'zh-Hans': tt['zh-Hans'] || '', en: tt.en || '' }; }
      M.story = ((entry && entry.story) || []).map(s => typeof s === 'string' ? s : s['zh-Hant'] || '').concat(['', '']).slice(0, 2);
      M.station = entry && entry.hub && entry.hub.station || ''; S.docs[m] = { meta: M, level: fromGame(lvl, m) }; }
    sel = null; changed(); };
  let toastTimer = 0;
  function flash(s) { const el = $('eeToast'); el.textContent = s; el.classList.toggle('on', !!s); clearTimeout(toastTimer); if (s) toastTimer = setTimeout(() => el.classList.remove('on'), 3200); }

  /* ------------------------------------------------------- the file, play, bot */
  // the tl-level/1 file (levels/README.md): what is handed in
  function packFile() {
    const M = meta(), m = S.mode, tt = M.title, hant = tt['zh-Hant'].trim() || t('e.myLevel');
    if (!M.key) { M.key = 'm' + m + '-new-' + Math.random().toString(36).slice(2, 6); save(); renderMeta(); }   // a key the checks accept; Claude may rename it
    return { format: 'tl-level/1', mode: m, key: M.key || '', order: M.order || 2, challenge: !!M.challenge,
      title: { 'zh-Hant': hant, 'zh-Hans': tt['zh-Hans'].trim() || hant, en: tt.en.trim() || hant }, story: M.story.map(s => s.trim()).filter(Boolean),
      hub: M.station ? { station: M.station } : {}, author: M.author || '', source: M.source || 'level editor (TransitLab v7)', level: toGame(lv(), m, M) }; }
  $('eeExport').onclick = () => { const err = engineCheck(); if (err) { flash(err); return; }
    const f = packFile(), name = (f.key || 'm' + f.mode + '-' + (f.title['zh-Hant'] || 'level').replace(/[^\w一-鿿-]+/g, '_')) + '.json';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(f, null, 1) + '\n'], { type: 'application/json' })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000); flash(t('e.exported', { s: name })); };
  $('eeImport').onclick = () => $('eeFile').click();
  $('eeFile').onchange = async () => { const file = $('eeFile').files[0]; $('eeFile').value = ''; if (!file) return;
    try { const j = JSON.parse(await file.text()); let m = S.mode, level = j, M = blankMeta(m);
      if (j.format === 'tl-level/1') { m = +j.mode; if (![2, 3, 4].includes(m)) throw Error('mode'); level = j.level;
        const tt = j.title || {}; M.key = j.key || ''; M.order = j.order || 2; M.challenge = !!j.challenge;
        M.title = typeof tt === 'string' ? { 'zh-Hant': tt, 'zh-Hans': tt, en: '' } : { 'zh-Hant': tt['zh-Hant'] || '', 'zh-Hans': tt['zh-Hans'] || '', en: tt.en || '' };
        M.story = (j.story || []).map(s => typeof s === 'string' ? s : s['zh-Hant'] || '').concat(['', '']).slice(0, 2);
        M.station = j.hub && j.hub.station || ''; M.author = j.author || ''; M.source = typeof j.source === 'string' ? j.source : ''; }
      if (!level || !Array.isArray(level.origins)) throw Error('level');
      if (m !== S.mode) flash(t('e.otherMode', { n: m })); else flash(t('e.imported', { s: file.name }));
      S.mode = m; S.docs[m] = { meta: M, level: fromGame(level, m) }; sel = null; changed(); }
    catch (e) { flash(t('e.badFile')); } };
  $('eePlay').onclick = async () => {
    const err = engineCheck(); if (err) { flash(err); return; }
    const f = packFile(), m = S.mode;
    try { const p = await root.TLPack.save({ format: 'tl-level/1', mode: m, title: f.title, story: f.story, level: f.level, tiers: f.level.tiers, source: { by: 'user', editor: true } });
      const [dir, file] = PAGE[m]; window.open(`../${dir}/${bundled ? encodeURIComponent(file) : 'index.html'}#pack=${p.id}`, '_blank'); }
    catch (e) { flash(e.message); } };
  $('eeAnalyse').onclick = async () => {
    if (busy || problems().length) return; const err = engineCheck(); if (err) { flash(err); return; }
    busy = true; analysis = { progress: 0 }; render();
    try { const m = S.mode, r = await root.TLEditorBot.estimate(ENG[m], toGame(lv(), m, meta()), { seconds: m === 4 ? 14 : 8, land: m === 4,
        onProgress: p => { if (analysis && analysis.progress !== undefined) { analysis.progress = p; renderAnalysis(); } } });
      analysis = r; }
    catch (e) { analysis = null; flash(e.message); }
    busy = false; render(); };
  $('eeHelp').onclick = () => $('eeHelpDlg').showModal(); $('eeHelpOk').onclick = () => $('eeHelpDlg').close();
  // the stations of the Hong Kong map (hub/stations.js), Chinese names, for «which station»
  $('eeStations').innerHTML = Object.keys(root.TL_STATIONS || {}).filter(s => /[㐀-鿿]/.test(s)).map(s => `<option value="${esc(s)}">`).join('');
  window.addEventListener('tl:lang', render);
  window.addEventListener('hashchange', () => { const m = +(/(?:^|[#&])mode=([234])/.exec(location.hash) || [])[1]; if (m && m !== S.mode) { S.mode = m; sel = null; analysis = null; changed(); } });
  function setTheme(th) { document.documentElement.setAttribute('data-theme', th); $('thPaper').setAttribute('aria-pressed', String(th === 'light')); $('thInk').setAttribute('aria-pressed', String(th === 'dark'));
    try { localStorage.setItem('tl-theme', th); } catch (e) {} render(); }
  $('thPaper').onclick = () => setTheme('light'); $('thInk').onclick = () => setTheme('dark');
  try { const th = localStorage.getItem('tl-theme'); if (th) setTheme(th); } catch (e) {}
  if (bundled) { $('eeMode1').href = '../mode1-bus/' + encodeURIComponent('模式1-关卡编辑器.html'); $('eeHub').href = '../' + encodeURIComponent('开始.html') + '#hub=1'; }
  // for tests and tools
  root.TL_LEVEL_EDITOR = { get state() { return S; }, packFile, toGame: () => toGame(lv(), S.mode, meta()), problems, get analysis() { return analysis; }, setMode(m) { S.mode = m; sel = null; changed(); } };
  I.apply(); render();
  try { if (!localStorage.getItem('tl-v7-editor-seen')) { localStorage.setItem('tl-v7-editor-seen', '1'); $('eeHelpDlg').showModal(); } } catch (e) {}
})(typeof window !== 'undefined' ? window : globalThis);
