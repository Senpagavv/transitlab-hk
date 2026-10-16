(function (root) {
  'use strict';
  // v7 · the sandbox's third layout (2026-10-15, docs/design-sandbox-v3.md). The whole screen is the map; what you do
  // floats on it: the scene (challenges, what is being computed), the data of the place under the pointer, a dock of
  // tools at the bottom, the card of the tool in hand above it, the results after a run, the layers. With no tool in
  // hand the map is for looking: drag, zoom, hover to read a zone. The pieces are the same elements as before — ui.js
  // and experience.js still drive them — moved into the cards; this file only arranges them and adds:
  //   «only this area»   the chosen zones: zoom there, fade the rest, only their trips choose again (ui.js setScope)
  //   «play this area»   a 16 × 12 box round the chosen zones cut into a mode 3 level (shared/levelgen/worker.js)
  const I = root.I18N, L = I.L, t = (k, v) => I.t(k, v), $ = id => document.getElementById(id);
  I.add({
    'sb.brand': L('HK · 05 · 全港沙盤', 'HK · 05 · 全港沙盘', 'HK · 05 · Sandbox'),
    'sb.back': L('← 五個模式', '← 五个模式', '← Five modes'),
    'sb.dataMap': L('全港數據地圖', '全港数据地图', 'Data map'),
    'sb.scene': L('TRANSITLAB · 05 · 全港沙盤', 'TRANSITLAB · 05 · 全港沙盘', 'TRANSITLAB · 05 · SANDBOX'),
    'sb.title': L('讓香港少一點塞車', '让香港少一点塞车', 'Fewer jams in Hong Kong'),
    'sb.scopeAll': L('範圍：全港', '范围：全港', 'Area: all of Hong Kong'),
    'sb.scopeSel': L('範圍：{name}{more}（只算這一片）', '范围：{name}{more}（只算这一片）', 'Area: {name}{more} (only this is computed)'),
    'sb.more': L(' 及另外 {n} 區', ' 及另外 {n} 区', ' and {n} other zones'),
    'sb.scopeOff': L('回全港', '回全港', 'All HK'),
    'sb.jump': L('跳到片區…', '跳到片区…', 'Go to an area…'),
    'sb.info': L('TRANSITLAB · 資料', 'TRANSITLAB · 资料', 'TRANSITLAB · DATA'),
    'sb.hoverHint': L('停在分區、道路或車站查看資料與來源；手機用「看地圖」點一下，再開資料。', '停在分区、道路或车站查看资料与来源；手机用“看地图”点一下，再开资料。', 'Hover a zone, road or station for data and sources. On a phone, tap in Look mode, then open Data.'),
    'sb.look': L('✋ 看地圖', '✋ 看地图', '✋ Look'), 'sb.line': L('⌁ 畫線', '⌁ 画线', '⌁ Line'), 'sb.station': L('● 放站', '● 放站', '● Station'),
    'sb.trains': L('列車', '列车', 'Trains'), 'sb.select': L('▣ 選區', '▣ 选区', '▣ Select'), 'sb.people': L('👥 改人口', '👥 改人口', '👥 People'),
    'sb.ai': L('✦ AI 出關卡', '✦ AI 出关卡', '✦ AI level'), 'sb.budget': L('預算', '预算', 'Budget'),
    'sb.lineCard': L('畫線、放站', '画线、放站', 'Lines and stations'),
    'sb.lineHint': L('按住拖動畫一條線（只走上下左右）；選「放站」再點線上的格子放站。再點一次工具或按 Esc 放下。', '按住拖动画一条线（只走上下左右）；选「放站」再点线上的格子放站。再点一次工具或按 Esc 放下。', 'Drag to draw a line (up, down, left, right); pick «Station» and click the line to place one. Click the tool again or press Esc to put it down.'),
    'sb.selCard': L('選區', '选区', 'Selection'),
    'sb.selHint': L('在地圖上點分區，按住 Shift 可以多選。', '在地图上点分区，按住 Shift 可以多选。', 'Click zones on the map; hold Shift to pick several.'),
    'sb.selN': L('已選 {n} 個區：{names}', '已选 {n} 个区：{names}', '{n} zones: {names}'),
    'sb.selNone': L('還沒選。', '还没选。', 'Nothing selected.'),
    'sb.focus': L('放大只算這一片', '放大只算这一片', 'Zoom in, compute only this'),
    'sb.unfocus': L('回到全港', '回到全港', 'Back to all of HK'),
    'sb.playSel': L('用第三關玩這一片 →', '用第三关玩这一片 →', 'Play this area in mode 3 →'),
    'sb.clearSel': L('清除', '清除', 'Clear'),
    'sb.cutting': L('正在切這一片、機器人定門檻（約 20 秒）…', '正在切这一片、机器人定门槛（约 20 秒）…', 'Cutting this area and setting the tiers (about 20 s)…'),
    'sb.cutFail': L('這一片切不成關卡：', '这一片切不成关卡：', 'No level from this area: '),
    'sb.cutTitle': L('{name}一帶', '{name}一带', 'Around {name}'),
    'sb.cutStory1': L('從全港沙盤切出來的一片：{names}。', '从全港沙盘切出来的一片：{names}。', 'An area cut from the Hong Kong sandbox: {names}.'),
    'sb.cutStory2': L('畫一條線，讓這一片早上少塞一點。', '画一条线，让这一片早上少塞一点。', 'Draw a line to ease this area\'s morning jams.'),
    'sb.peopleCard': L('改人口', '改人口', 'People'),
    'sb.peopleHint': L('先在地圖上點要改的分區（Shift 多選），再拉下面的滑桿。', '先在地图上点要改的分区（Shift 多选），再拉下面的滑杆。', 'Click the zones to change on the map (Shift for several), then move the sliders.'),
    'sb.result': L('本輪結果', '本轮结果', 'This round'),
    'sb.details': L('變化最大的路、調度提示', '变化最大的路、调度提示', 'Roads that changed most, notes'),
    'sb.layers': L('圖層', '图层', 'Layers'),
    'sb.freeStation': L('自由放站（關閉吸附）', '自由放站（关闭吸附）', 'Free placement (no snapping)'),
    'sb.recommendHint': L('小圓圈：港鐵站格及各片區人口／崗位最多的分區中心。預設吸附到 1 格內、目前線上的最近建議點（D 示意）。', '小圆圈：港铁站格及各片区人口／岗位最多的分区中心。默认吸附到 1 格内、目前线上的最近建议点（D 示意）。', 'Circles mark existing MTR cells and the largest population/job centres per area. Snap within one grid cell to the nearest suggestion on this line (tier D aid).'),
    'sb.tools': L('工具', '工具', 'Tools'),
    'sb.drawerScene': L('情境', '情境', 'Scene'),
    'sb.drawerInfo': L('資料', '资料', 'Data'),
    'sb.drawerResult': L('結果', '结果', 'Results'),
    'sb.close': L('收起', '收起', 'Close')
  });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function card(cls, label) { const c = el('section', 'sb-card ' + cls); if (label) c.append(el('span', 'lbl', '')); if (label) c.firstChild.dataset.i18n = label; return c; }
  let built = false;
  function build() {
    if (built || !root.TL_SANDBOX || !root.TL_SANDBOX.v2) return; built = true;
    const S = root.TL_SANDBOX, v2 = S.v2, b = S.base, map = document.querySelector('.sandbox-map'), name = z => z ? (I.lang === 'zh-Hans' ? (z.hans || z.name) : I.lang === 'en' ? (z.en || z.name) : z.name) : '';
    document.body.classList.add('sb3');
    const sizeTop = () => { document.documentElement.style.setProperty('--sb-top', $('topbar').getBoundingClientRect().height + 'px'); S.draw(); };
    new ResizeObserver(sizeTop).observe($('topbar'));
    requestAnimationFrame(sizeTop);
    if (root.TL_SITE?.static) {
      I.add({
        'v.aiNote': L('AI 正式版稍後開放；現在可以試這幾句：啟德多五萬人、沙田多三萬人、銅鑼灣假日人潮、將軍澳隧道封一條線、北部都會區。', 'AI 正式版稍后开放；现在可以试这几句：启德多五万人、沙田多三万人、铜锣湾假日人潮、将军澳隧道封一条线、北部都会区。', 'Full AI is coming later. Try: Kai Tak population growth; Sha Tin population growth; Causeway Bay holiday crowds; TKO tunnel closure; Northern Metropolis.'),
        'ai.ask': L('① 正在配對現成示例…', '① 正在匹配现成示例…', '① Matching a ready-made example…'),
        'ai.readyEx': L('示例關卡做好了。AI 正式版稍後開放。', '示例关卡做好了。AI 正式版稍后开放。', 'The example level is ready. Full AI is coming later.'),
        'sb.mobile': L('沙盤建議用電腦玩', '沙盘建议用电脑玩', 'The sandbox works best on a computer'),
        'sb.sources': L('鐵路：© OpenStreetMap contributors（ODbL）；土地、分區：規劃署、地政總署；道路、交通：運輸署、GTFS／TransitLab 推算。僅供學習。', '铁路：© OpenStreetMap contributors（ODbL）；土地、分区：规划署、地政总署；道路、交通：运输署、GTFS／TransitLab 推算。仅供学习。', 'Railways: © OpenStreetMap contributors (ODbL). Land/zones: Planning and Lands Departments. Roads/traffic: Transport Department, GTFS / TransitLab estimates. For learning only.')
      });
    }
    if (v2.mode !== 'play') v2.setMode('play');
    // ---- the top bar: back, the four times of day, zoom, the data map
    const top = $('topbar'), brand = top.querySelector('.brand');
    brand.querySelector('.sub').dataset.i18n = 'sb.brand';
    const back = el('a', 'btn btn-sm sb-topbar-link'); back.href = '../index.html#hub=1&nav=5'; back.dataset.i18n = 'sb.back'; brand.after(back);
    back.after($('periodTabs'));
    const zoom = el('div', 'sb-zoom'); zoom.append($('zoomOut'), $('zoomIn'), $('resetView'));
    const live = el('a', 'btn btn-sm sb-topbar-link'); live.href = '/'; live.dataset.i18n = 'sb.dataMap';
    if (location.protocol === 'file:' || root.TL_SITE?.dataMap === false) live.hidden = true;
    $('help').before(zoom);
    if (root.TL_SITE?.dataMap !== false) $('help').before(live);
    // ---- the scene: title, what is being computed, the challenges
    const scene = card('sb-scene', 'sb.scene');
    scene.append(el('h2', '', ''), el('div', 'sb-scope', '<span></span><button class="btn btn-sm" hidden></button>'));
    scene.querySelector('h2').dataset.i18n = 'sb.title';
    const jump = el('select', 'ed-in sb-jump'); scene.append(jump);
    const challenges = $('challengeList').parentElement; scene.append(challenges);
    map.append(scene);
    jump.onchange = () => { const i = jump.value; jump.value = ''; if (i === '') return; const btn = $('areasList').querySelector(`[data-area="${i}"]`); if (btn) btn.click(); };
    // ---- the data of the place under the pointer
    const info = card('sb-info', 'sb.info');
    const hint = el('p', 'sb-hint'); hint.dataset.i18n = 'sb.hoverHint'; info.append(hint, $('dataPanel'));
    map.append(info);
    // ---- the dock: tools, trains, run, budget
    const dock = card('sb-dock', null);
    const tools = [['look', 'sb.look'], ['line', 'sb.line'], ['station', 'sb.station']].map(([k, lab]) => { const x = el('button', 'sb-tool'); x.dataset.tool = k; x.dataset.i18n = lab; return x; });
    const trains = el('span', 'sb-trains'); const tl = el('span'); tl.dataset.i18n = 'sb.trains'; trains.append(tl, $('trainMinus'), $('trainCount'), $('trainPlus'));
    const more = [['select', 'sb.select'], ['people', 'sb.people'], ['ai', 'sb.ai']].map(([k, lab]) => { const x = el('button', 'sb-tool'); x.dataset.tool = k; x.dataset.i18n = lab; return x; });
    const run = el('span', 'sb-run row'); run.append($('runStep'), $('runStable'), $('reset'));
    const budget = el('span', 'sb-budget'); const bl = el('span'); bl.dataset.i18n = 'sb.budget'; const bv = $('budgetUsed').parentElement; budget.append(bl, bv, $('budgetBar').parentElement);
    dock.append(...tools, trains, el('span', 'sep'), ...more, el('span', 'sep'), run, el('span', 'sep'), budget);
    map.append(dock);
    // ---- the card of the tool in hand
    const toolcard = card('sb-toolcard', 'sb.tools'); toolcard.hidden = true; map.append(toolcard);
    const close = el('button', 'sb-close', '×'); close.dataset.i18nTitle = 'sb.close'; close.title = t('sb.close'); toolcard.append(close);
    const pages = {};
    pages.line = el('div', 'sb-page'); pages.line.innerHTML = '<span class="lbl" data-i18n="sb.lineCard"></span><p class="note" data-i18n="sb.lineHint"></p>';
    pages.line.append($('newLine').parentElement, $('examplePlan'), $('planDetail'));
    const stationOptions = el('div', 'sb-station-options'); stationOptions.hidden = true;
    stationOptions.innerHTML = '<label><input type="checkbox" id="sbFreeStation"><span data-i18n="sb.freeStation"></span></label><p class="note" data-i18n="sb.recommendHint"></p>';
    pages.line.insertBefore(stationOptions, pages.line.querySelector('p'));
    stationOptions.querySelector('#sbFreeStation').onchange = e => S.setFreeStation(e.target.checked);
    pages.select = el('div', 'sb-page'); pages.select.innerHTML = '<span class="lbl" data-i18n="sb.selCard"></span><p class="note" data-i18n="sb.selHint"></p><p class="note sb-seln"></p><div class="row sb-selbtns"></div><p class="note sb-cutstatus" role="status"></p>';
    const playSel = el('button', 'btn btn-sm btn-p'); playSel.dataset.i18n = 'sb.playSel';
    const clearSel = el('button', 'btn btn-sm'); clearSel.dataset.i18n = 'sb.clearSel';
    pages.select.querySelector('.sb-selbtns').append($('focusSel'), playSel, clearSel);
    pages.people = el('div', 'sb-page'); pages.people.innerHTML = '<span class="lbl" data-i18n="sb.peopleCard"></span><p class="note" data-i18n="sb.peopleHint"></p>';
    pages.people.append(document.querySelector('.population-panel'));
    pages.ai = el('div', 'sb-page'); pages.ai.append(document.querySelector('#aiPanel .ai-card'));
    for (const p of Object.values(pages)) { p.hidden = true; toolcard.append(p); }
    // ---- the results, after a run
    const result = card('sb-result', 'sb.result'); result.hidden = true;
    const hud = map.querySelector('.sandbox-hud'); const summary = $('reportSummary').parentElement;
    const det = el('details'); det.innerHTML = '<summary data-i18n="sb.details"></summary>'; det.append($('hotRoads'), $('dispatch'));
    result.append(hud, summary, document.querySelector('.layer-change-tools'), det);
    map.append(result);
    for (const id of ['runStep', 'runStable']) $(id).addEventListener('click', () => { result.hidden = false; if (mobile.matches) openDrawer(result); });
    // ---- the layers
    const layers = card('sb-layers', 'sb.layers'); for (const lab of [...map.querySelectorAll('.layer-corner label')]) layers.append(lab); map.append(layers);
    if (root.TL_SITE?.static) {
      const credit = el('p', 'sb-attribution'); credit.dataset.i18n = 'sb.sources';
      function placeCredit() {
        if (root.innerWidth <= 640) {
          credit.style.cssText = 'position:absolute;left:8px;right:8px;bottom:58px;z-index:11;background:var(--s-panel);border-radius:5px;padding:4px 6px;font-size:9px;line-height:1.35;margin:0;pointer-events:none';
          map.append(credit);
        } else {
          credit.style.cssText = 'font-size:10px;line-height:1.45;margin:7px 0 0;max-width:240px';
          layers.append(credit);
        }
      }
      placeCredit(); root.addEventListener('resize', placeCredit);
      let seen = false; try { seen = sessionStorage.getItem('tl-static-mobile') === '1'; } catch (_) {}
      if (root.innerWidth < 700 && !seen) {
        const note = el('div', 'sb-mobile-note'); note.setAttribute('role', 'status');
        note.style.cssText = 'position:fixed;top:58px;left:8px;right:8px;z-index:150;padding:8px 12px;background:var(--s-paper);border:1px solid var(--s-line);border-radius:8px;display:flex;align-items:center;justify-content:space-between';
        const label = el('span'); label.dataset.i18n = 'sb.mobile'; const dismiss = el('button', 'btn btn-sm', '×'); dismiss.dataset.i18nAria = 'sb.close';
        dismiss.onclick = () => note.remove(); note.append(label, dismiss); document.body.append(note);
        try { sessionStorage.setItem('tl-static-mobile', '1'); } catch (_) {}
      }
    }

    // Four mobile drawers share a single open body. Desktop keeps the floating cards.
    const mobile = root.matchMedia('(max-width: 699px)'), drawers = el('div', 'sb-drawers');
    map.append(drawers);
    const drawerCards = [scene, info, result, toolcard];
    const drawerLabels = ['sb.drawerScene', 'sb.drawerInfo', 'sb.drawerResult', 'sb.tools'];
    let activeDrawer = null;
    drawerCards.forEach((c, i) => {
      const old = c.querySelector(':scope > .lbl'), toggle = el('button', 'sb-drawer-toggle lbl');
      toggle.type = 'button'; toggle.dataset.i18n = drawerLabels[i];
      const body = el('div', 'sb-drawer-body'); body.id = 'sb-drawer-' + i;
      toggle.setAttribute('aria-controls', body.id);
      if (old) old.remove();
      while (c.firstChild) body.append(c.firstChild);
      c.append(toggle, body); drawers.append(c);
      toggle.onclick = () => { if (mobile.matches && !toggle.disabled) openDrawer(activeDrawer === c ? null : c); };
    });
    function syncDrawers() {
      for (const c of drawerCards) {
        const on = !mobile.matches || activeDrawer === c, toggle = c.querySelector('.sb-drawer-toggle');
        c.classList.toggle('sb-drawer-open', on);
        toggle.setAttribute('aria-expanded', String(on));
        toggle.disabled = mobile.matches && c.hidden;
      }
    }
    function openDrawer(c) { activeDrawer = c; syncDrawers(); }
    mobile.addEventListener('change', () => { activeDrawer = null; syncDrawers(); });
    new MutationObserver(syncDrawers).observe(toolcard, { attributes: true, attributeFilter: ['hidden'] });
    syncDrawers();

    // ---- tools: the dock follows ui.js's tool; the card follows the dock
    let page = null;
    function show(p) { page = p; toolcard.hidden = !p; for (const [k, x] of Object.entries(pages)) x.hidden = k !== p; if (mobile.matches) openDrawer(p ? toolcard : null); syncDrawers(); sync(); }
    function sync() {
      const tool = S.tool; stationOptions.hidden = tool !== 'station';
      for (const x of dock.querySelectorAll('.sb-tool')) { const k = x.dataset.tool;
        x.setAttribute('aria-pressed', String(k === 'look' ? tool === 'pan' && !page : k === 'people' || k === 'ai' ? page === k : k === 'select' ? tool === 'select' && page !== 'people' : tool === k)); }
      renderSel(); }
    dock.addEventListener('click', e => { const x = e.target.closest('.sb-tool'); if (!x) return; const k = x.dataset.tool;
      if (k === 'look') { S.setTool('pan'); show(null); return; }
      if (k === 'line' || k === 'station') { const on = S.tool === k; S.setTool(on ? 'pan' : k); show(on ? null : 'line'); return; }
      if (k === 'select') { const on = S.tool === 'select' && page === 'select'; S.setTool(on ? 'pan' : 'select'); show(on ? null : 'select'); return; }
      if (k === 'people') { const on = page === 'people'; S.setTool(on ? 'pan' : 'select'); show(on ? null : 'people'); return; }
      if (k === 'ai') { const on = page === 'ai'; if (!on) S.setTool('pan'); show(on ? null : 'ai'); } });
    close.onclick = () => { S.setTool('pan'); show(null); };
    root.addEventListener('tl:tool', e => { const tool = e.detail;
      if (tool === 'pan' && (page === 'line' || page === 'select')) show(null); else if ((tool === 'line' || tool === 'station') && page !== 'line') show('line'); else sync(); });
    // ---- the selection: what is chosen, only this area, play it with mode 3
    function renderSel() {
      const sel = v2.selectedZones(), names = sel.slice(0, 4).map(i => name(b.zones[i])).join('、') + (sel.length > 4 ? '…' : '');
      pages.select.querySelector('.sb-seln').textContent = sel.length ? t('sb.selN', { n: sel.length, names }) : t('sb.selNone');
      $('focusSel').textContent = t(S.scope ? 'sb.unfocus' : 'sb.focus'); $('focusSel').disabled = !sel.length && !S.scope; playSel.disabled = !sel.length; clearSel.disabled = !sel.length;
      const sc = scene.querySelector('.sb-scope'), on = !!S.scope; sc.classList.toggle('on', on);
      const first = on ? b.zones.find(z => String(z.id) === S.scope[0]) : null;
      sc.querySelector('span').textContent = on ? t('sb.scopeSel', { name: name(first), more: S.scope.length > 1 ? t('sb.more', { n: S.scope.length - 1 }) : '' }) : t('sb.scopeAll');
      const off = sc.querySelector('button'); off.hidden = !on; off.textContent = t('sb.scopeOff'); }
    scene.querySelector('.sb-scope button').onclick = () => S.setScope(null);
    root.addEventListener('tl:scope', renderSel);
    $('board').addEventListener('pointerup', () => setTimeout(renderSel, 0));
    clearSel.onclick = () => { v2.select([]); renderSel(); };
    playSel.onclick = () => cutSelection(v2.selectedZones());
    // a 16 × 12 box (the size of mode 3's boards) round the chosen zones, cut like an AI level, opened in mode 3
    let cutter = null;
    function cutSelection(sel) {
      if (!sel.length) return;
      const cells = sel.map(i => b.zones[i].cell), cx = Math.round(cells.reduce((s, c) => s + c[0], 0) / cells.length), cy = Math.round(cells.reduce((s, c) => s + c[1], 0) / cells.length);
      const x0 = Math.max(0, Math.min(b.cols - 16, cx - 8)), y0 = Math.max(0, Math.min(b.rows - 12, cy - 6)), box = [x0, y0, x0 + 16, y0 + 12];
      const first = name(b.zones[sel[0]]).replace(/站一帶$|站一带$/, ''), names = sel.slice(0, 4).map(i => name(b.zones[i])).join('、');
      // the people changed in the sandbox go with it (as % changes, at most four)
      const changes = []; for (const i of sel) { const c = (v2.configs || {})[String(b.zones[i].id)]; if (!c) continue;
        if (c.people) changes.push({ place: b.zones[i].name, what: 'people', pct: c.people }); if (c.attraction) changes.push({ place: b.zones[i].name, what: 'jobs', pct: c.attraction }); }
      const request = { box, boxName: first, period: (S.demand && S.demand.period) || 'am', mode: 3, changes: changes.slice(0, 4),
        title: t('sb.cutTitle', { name: first }), story: [t('sb.cutStory1', { names }), t('sb.cutStory2')] };
      const status = pages.select.querySelector('.sb-cutstatus'); status.textContent = t('sb.cutting'); playSel.disabled = true;
      if (!cutter) cutter = new Worker('../shared/levelgen/worker.js');
      cutter.onmessage = async e => { const m = e.data; if (m.progress) return; playSel.disabled = false;
        if (!m.level) { status.textContent = t('sb.cutFail') + ((m.problems || []).map(p => p.message || p.code).join('；') || m.error || '—'); return; }
        const tiers = m.level.tiers || (m.report && m.report.tiers) || [0, 0, 0];
        try { const p = await root.TLPack.save(JSON.parse(JSON.stringify({ format: 'tl-level/1', mode: 3, title: request.title, story: request.story,
            level: { ...m.level, tiers, title: request.title }, tiers, source: { by: 'user', sandbox: true, request: m.request } })));
          location.href = '../mode3-roads/index.html#pack=' + p.id; }
        catch (err) { status.textContent = t('sb.cutFail') + err.message; } };
      cutter.onerror = e => { playSel.disabled = false; status.textContent = t('sb.cutFail') + (e.message || 'worker'); };
      cutter.postMessage({ request, seconds: 15 });
    }
    // ---- looking: the zone under the pointer goes to the data card
    let hoverKey = '', raf = 0, latestPointer = null, touchStart = null;
    function inspectPointer(e) {
      const item = S.inspectAt(e), key = item ? item.kind + ':' + item.index : '';
      if (key === hoverKey) return; hoverKey = key; v2.inspect(item);
    }
    $('board').addEventListener('pointermove', e => {
      if (e.buttons || e.pointerType === 'touch') return;
      latestPointer = { clientX: e.clientX, clientY: e.clientY };
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; inspectPointer(latestPointer); });
    });
    $('board').addEventListener('pointerdown', e => { touchStart = { x: e.clientX, y: e.clientY }; });
    $('board').addEventListener('pointerup', e => {
      if (S.tool === 'pan' && touchStart && Math.hypot(e.clientX - touchStart.x, e.clientY - touchStart.y) < 6) inspectPointer(e);
      touchStart = null;
    });
    // ---- the note at the top of the map only once there is a line to talk about
    const msg = $('mapMessage'), quiet = () => msg.classList.toggle('sb-quiet', !(S.plan && (S.plan.lines || []).some(l => (l.cells || []).length)));
    new MutationObserver(quiet).observe(msg, { childList: true, characterData: true, subtree: true }); quiet();
    // ---- the areas to jump to, in the scene card; texts on a language change
    function texts() {
      jump.innerHTML = `<option value="">${esc(t('sb.jump'))}</option>` + (b.areas || []).map((a, i) => `<option value="${i}">${esc(name(a))}</option>`).join('');
      I.apply(); renderSel(); }
    root.addEventListener('tl:lang', () => setTimeout(texts, 0));
    texts(); show(null);
    // the hub's «AI 出關卡» (#tab=ai) opens the AI card on the map
    if (/(?:^|[#&])tab=ai/.test(location.hash)) show('ai');
    root.TL_SANDBOX_LAYOUT = { show, cutSelection, get page() { return page; } };
  }
  if (root.TL_SANDBOX && root.TL_SANDBOX.v2) build(); else root.addEventListener('tl:sandbox-ready', build);
})(typeof window !== 'undefined' ? window : globalThis);
