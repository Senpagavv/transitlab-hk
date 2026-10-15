(function (root) {
  'use strict';
  // v7 · «AI 出關卡» end to end (2026-10-15). One sentence → the AI's level request (ai/client.js → backend/feeder_ai.py;
  // without the backend, the ready-made examples) → in a worker (shared/levelgen/worker.js) the area is cut out of the
  // Hong Kong grid and the bot finds the best plan and sets the tiers → a level pack for this browser session → mode 2/3/4
  // opens it (#pack=<id>) with the AI's title and story. A level the builder rejects (too easy, nothing to solve, a
  // place it can't find …) goes back to the AI once with the reason; «the jams don't rank like the model's» is only a note.
  const I = root.I18N, L = I.L, t = (k, v) => I.t(k, v);
  I.add({
    'ai.ask': L('① AI 在理解這句話…', '① AI 在理解这句话…', '① The AI is reading the sentence…'),
    'ai.cut': L('② 從全港地圖切出這一片…', '② 从全港地图切出这一片…', '② Cutting the area out of the Hong Kong map…'),
    'ai.bot': L('③ 機器人在找最好的方案、定門檻（約 15 秒）…', '③ 机器人在找最好的方案、定门槛（约 15 秒）…', '③ The bot is finding the best plan and setting the tiers (about 15 s)…'),
    'ai.retry': L('這一關不合格，把原因交回 AI 再試一次…', '这一关不合格，把原因交回 AI 再试一次…', 'Not a good level; asking the AI again with the reason…'),
    'ai.ready': L('關卡做好了。', '关卡做好了。', 'The level is ready.'),
    'ai.readyEx': L('關卡做好了（AI 暫時用不了，用的是現成示例）。', '关卡做好了（AI 暂时用不了，用的是现成示例）。', 'The level is ready (the AI is not available; a ready-made example was used).'),
    'ai.fail': L('這句話做不成關卡：', '这句话做不成关卡：', 'No level from this sentence: '),
    'ai.open2': L('用第二關的玩法打開 →', '用第二关的玩法打开 →', 'Play it with mode 2 →'),
    'ai.open3': L('用第三關的玩法打開 →', '用第三关的玩法打开 →', 'Play it with mode 3 →'),
    'ai.open4': L('用第四關的玩法打開 →', '用第四关的玩法打开 →', 'Play it with mode 4 →'),
    'ai.makeAs': L('做成：', '做成：', 'Make as:'),
    'ai.auto': L('自動', '自动', 'Automatic'),
    'ai.examplesHint': L('請試東涌修地鐵、將軍澳南新線、東涌東賣地、洪水橋物業，或原有第三關示例。', '请试东涌修地铁、将军澳南新线、东涌东卖地、洪水桥物业，或原有第三关示例。', 'Try Tung Chung metro, TKO South, Tung Chung East land sales, Hung Shui Kiu property, or a mode 3 example.'),
    'ai.mode2': L('第二關 · 地鐵', '第二关 · 地铁', 'Mode 2 · Metro'),
    'ai.mode3': L('第三關 · 地鐵與塞車', '第三关 · 地铁与塞车', 'Mode 3 · Metro and traffic'),
    'ai.mode4': L('第四關 · 地鐵與站旁開發', '第四关 · 地铁与站旁开发', 'Mode 4 · Metro and development'),
    'ai.gameplay': L('玩法', '玩法', 'Gameplay'),
    'ai.size24': L('{o} 個屋苑 · {d} 個去處 · {n} 塊空地', '{o} 个屋苑 · {d} 个去处 · {n} 块空地', '{o} estates · {d} destinations · {n} land lots'),
    'ai.finalGrowth': L('本玩法不支援逐年人口或崗位變化；開局採用改動後的最終值。', '本玩法不支持逐年人口或岗位变化；开局采用改动后的最终值。', 'This mode uses the final population or jobs value at opening; yearly source growth is unavailable.'),
    'ai.schematic': L('教學示意，僅供參考；格子與空地不是法定發展方案。', '教学示意，仅供参考；格子与空地不是法定发展方案。', 'Teaching schematic for reference; cells and lots are not a statutory development plan.'),
    'ai.ex.tcMetro.title': L('東涌一條新線', '东涌一条新线', 'A new Tung Chung line'),
    'ai.ex.tcMetro.s1': L('假設東涌要多修一條地鐵。', '假设东涌要多修一条地铁。', 'Suppose Tung Chung needs another metro line.'),
    'ai.ex.tcMetro.s2': L('接通屋苑和工作點，安排足夠列車。', '接通屋苑和工作点，安排足够列车。', 'Link homes to jobs and provide enough trains.'),
    'ai.ex.tkoMetro.title': L('將軍澳南新線', '将军澳南新线', 'A new TKO South line'),
    'ai.ex.tkoMetro.s1': L('假設將軍澳南要加一條地鐵。', '假设将军澳南要加一条地铁。', 'Suppose Tseung Kwan O South needs a new metro line.'),
    'ai.ex.tkoMetro.s2': L('在有限預算內照顧不同屋苑。', '在有限预算内照顾不同屋苑。', 'Serve different estates within the budget.'),
    'ai.ex.tcTOD.title': L('東涌東站旁開發', '东涌东站旁开发', 'Tung Chung East development'),
    'ai.ex.tcTOD.s1': L('假設裕雅苑住的人增加三成。', '假设裕雅苑住的人增加三成。', 'Suppose Yu Nga Court has 30% more residents.'),
    'ai.ex.tcTOD.s2': L('規劃地鐵，安排住宅和商場賣地。', '规划地铁，安排住宅和商场卖地。', 'Plan the metro and the sale of home and shop lots.'),
    'ai.ex.hskTOD.title': L('洪水橋鐵路物業', '洪水桥铁路物业', 'Hung Shui Kiu rail and property'),
    'ai.ex.hskTOD.s1': L('假設洪水橋站一帶崗位增加三成。', '假设洪水桥站一带岗位增加三成。', 'Suppose jobs around Hung Shui Kiu increase by 30%.'),
    'ai.ex.hskTOD.s2': L('接通工作點，再比較站旁開發。', '接通工作点，再比较站旁开发。', 'Connect jobs, then compare station-side development.'),
    'ai.where': L('片區', '片区', 'Area'), 'ai.when': L('時段', '时段', 'Time'), 'ai.changes': L('改動', '改动', 'Changes'),
    'ai.best': L('機器人最好 {b} · 過關 {p} · 高分 {h} · 大師 {m}', '机器人最好 {b} · 过关 {p} · 高分 {h} · 大师 {m}', 'Bot best {b} · pass {p} · high {h} · master {m}'),
    'ai.size': L('{o} 個屋苑 · {d} 個去處 · {r} 條路 · {l} 條港鐵線', '{o} 个屋苑 · {d} 个去处 · {r} 条路 · {l} 条港铁线', '{o} estates · {d} destinations · {r} roads · {l} MTR lines'),
    'ai.vc': L('提醒：這一片最塞的路和模型排的不完全一樣（只算了框裡的車）。', '提醒：这一片最塞的路和模型排的不完全一样（只算了框里的车）。', 'Note: the jams here do not rank exactly as in the model (only trips inside the box count).'),
    'ai.people': L('住的人', '住的人', 'people'), 'ai.jobs': L('崗位 / 吸引力', '岗位 / 吸引力', 'jobs / pull'), 'ai.road_cap': L('路能過的車', '路能过的车', 'road capacity'),
    'ai.byYear': L('，到第 {y} 年', '，到第 {y} 年', ' by year {y}'),
    'ai.period.am': L('早高峰', '早高峰', 'AM peak'), 'ai.period.day': L('平日日常', '平日日常', 'Daytime'), 'ai.period.holiday': L('節假日', '节假日', 'Holiday')
  });
  const FATAL = new Set(['too_easy', 'nothing_to_solve', 'unreachable', 'place_not_found', 'box_empty', 'invalid_request', 'invalid_input', 'unstable_traffic', 'change_mode_conflict', 'error']);
  // experience.js creates the panel later; mount here to respect its read-only UI files.
  function mountMode(){
    const sentence=document.getElementById('aiSentence');
    if(!sentence)return false;if(document.getElementById('aiMode'))return true;
    const row=document.createElement('label');row.htmlFor='aiMode';
    row.innerHTML='<span data-i18n="ai.makeAs"></span> <select id="aiMode"><option value="" data-i18n="ai.auto"></option>'+[2,3,4].map(n=>'<option value="'+n+'" data-i18n="ai.mode'+n+'"></option>').join('')+'</select>';
    sentence.after(row);I.apply(row);return true;
  }
  if(typeof document!=='undefined'&&!mountMode()){
    const observer=new MutationObserver(()=>{if(mountMode())observer.disconnect();});observer.observe(document.documentElement,{childList:true,subtree:true});
  }
  let worker = null;
  function build(request, onProgress) {
    return new Promise(resolve => {
      if (!worker) worker = new Worker('../shared/levelgen/worker.js');
      worker.onmessage = e => { const m = e.data; if (m.progress) { onProgress(m.progress); return; } resolve(m); };
      worker.onerror = e => resolve({ done: true, error: e.message || 'worker error' });
      worker.postMessage({ request, seconds: 15 });
    });
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const pick = x => typeof x === 'string' ? x : x && (x[I.lang] || x['zh-Hant']) || '';
  async function run(sentence, { lang, names, mode, status, out, areas }) {
    const say = k => { status.textContent = t(k); };
    mode=mode||Number(document.getElementById('aiMode')?.value)||null;
    out.innerHTML = ''; say('ai.ask');
    let res;
    try {
      res = await root.TLAI.generate(sentence, { lang, names, mode,
        onStep: s => say(s.step === 'ask' ? 'ai.ask' : s.step === 'build' ? 'ai.cut' : 'ai.retry'),
        build: async request => {
          const m = await build(request, p => say(p === 'bot' ? 'ai.bot' : 'ai.cut'));
          if (m.error) return { level: null, problems: [{ code: 'error', message: m.error }] };
          const all = m.problems || [];
          const fatal = p => !m.level || (FATAL.has(p.code) && !/回退/.test(p.message || ''));   // a near-name fallback is only a note
          return { ...m, built: m.request, problems: all.filter(fatal), warnings: all.filter(p => !fatal(p)) };
        } });
    } catch (e) { status.textContent = t('ai.fail') + (e.message || ''); return; }
    if (!res || !res.level || (res.problems || []).length) { status.textContent = t('ai.fail') + ((res && res.problems || []).map(p => p.message || p.code).join('；') || '—'); return res; }
    status.textContent = t(res.source === 'example' ? 'ai.readyEx' : 'ai.ready');
    const r = res.built || res.request, lv = res.level, playMode = Number(r.mode || 3), rep = res.report || {}, tiers = lv.tiers || rep.tiers || [0, 0, 0];
    const area = (areas || []).find(a => a.key === r.area);
    const sign = n => (n > 0 ? '+' : '') + n, num = n => sign(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    // the worker's copy of the request: an «add» the AI read (50,000 more people) is turned into a % of the place's people
    const changes = ((res.built || r).changes || []).map(c => esc(c.place) + ' · ' + t('ai.' + c.what) + ' ' +
      (c.from ? num(c.from.add) + '（≈ ' + sign(c.pct) + '%）' : sign(c.pct) + '%') + (c.by_year ? t('ai.byYear', { y: c.by_year }) : '')).join('<br>') || '—';
    out.innerHTML = '<div class="ai-level"><h3>' + esc(r.title) + '</h3>' + (r.story || []).map(s => '<p>' + esc(s) + '</p>').join('') +
      '<dl><dt>' + t('ai.gameplay') + '</dt><dd>' + t('ai.mode' + playMode) + '</dd><dt>' + t('ai.where') + '</dt><dd>' + esc(area ? pick({ 'zh-Hant': area.name, 'zh-Hans': area.hans || area.name, en: area.en || area.key }) : r.area) + '</dd>' +
      '<dt>' + t('ai.when') + '</dt><dd>' + t('ai.period.' + (lv.source && lv.source.period || r.period || 'am')) + '</dd>' +
      '<dt>' + t('ai.changes') + '</dt><dd>' + changes + '</dd></dl>' +
      '<p class="mono">' + (playMode === 3 ? t('ai.size', { o: (lv.origins || []).length, d: (lv.destinations || []).length, r: (lv.roads || []).length, l: (lv.lines || []).length }) : t('ai.size24', {o:lv.origins.length,d:lv.destinations.length,n:(lv.land||[]).length})) + '</p>' + (playMode!==3?'<p class="note">'+t('ai.schematic')+'</p>':'') + (playMode!==3&&(r.changes||[]).some(c=>c.by_year)?'<p class="note">'+t('ai.finalGrowth')+'</p>':'') +
      '<p class="mono">' + t('ai.best', { b: Math.round(rep.best || 0), p: tiers[0], h: tiers[1], m: tiers[2] }) + '</p>' +
      ((res.warnings || []).some(p => p.code === 'model_vc_mismatch') ? '<p class="note">' + t('ai.vc') + '</p>' : '') +
      '<button class="btn btn-p" id="aiOpen">' + t('ai.open' + playMode) + '</button></div>';
    // kept for this browser session only (shared/levelpack.js checks it and names it custom-<hash>); nothing is uploaded
    document.getElementById('aiOpen').onclick = async () => {
      const draft = JSON.parse(JSON.stringify({ format: 'tl-level/1', mode: playMode, title: r.title, story: r.story || [], level: { ...lv, tiers, title: r.title }, tiers,
        source: { by: 'ai', example: res.source === 'example', area: r.area, period: r.period, request: r } }));
      try { const p = await root.TLPack.save(draft); location.href = '../' + ({2:'mode2-metro',3:'mode3-roads',4:'mode4-tod'}[playMode]) + '/index.html#pack=' + p.id; }
      catch (e) { status.textContent = t('ai.fail') + e.message; }
    };
    return res;
  }
  root.TLAILevel = { run };
})(typeof window !== 'undefined' ? window : globalThis);
