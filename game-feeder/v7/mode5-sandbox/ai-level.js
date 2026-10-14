(function (root) {
  'use strict';
  // v7 · «AI 出關卡» end to end (2026-10-15). One sentence → the AI's level request (ai/client.js → backend/feeder_ai.py;
  // without the backend, the ready-made examples) → in a worker (shared/levelgen/worker.js) the area is cut out of the
  // Hong Kong grid and the bot finds the best plan and sets the tiers → a level pack for this browser session → mode 3
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
    'ai.open': L('用第三關的玩法打開 →', '用第三关的玩法打开 →', 'Play it with mode 3 →'),
    'ai.where': L('片區', '片区', 'Area'), 'ai.when': L('時段', '时段', 'Time'), 'ai.changes': L('改動', '改动', 'Changes'),
    'ai.best': L('機器人最好 {b} · 過關 {p} · 高分 {h} · 大師 {m}', '机器人最好 {b} · 过关 {p} · 高分 {h} · 大师 {m}', 'Bot best {b} · pass {p} · high {h} · master {m}'),
    'ai.size': L('{o} 個屋苑 · {d} 個去處 · {r} 條路 · {l} 條港鐵線', '{o} 个屋苑 · {d} 个去处 · {r} 条路 · {l} 条港铁线', '{o} estates · {d} destinations · {r} roads · {l} MTR lines'),
    'ai.vc': L('提醒：這一片最塞的路和模型排的不完全一樣（只算了框裡的車）。', '提醒：这一片最塞的路和模型排的不完全一样（只算了框里的车）。', 'Note: the jams here do not rank exactly as in the model (only trips inside the box count).'),
    'ai.people': L('住的人', '住的人', 'people'), 'ai.jobs': L('崗位 / 吸引力', '岗位 / 吸引力', 'jobs / pull'), 'ai.road_cap': L('路能過的車', '路能过的车', 'road capacity'),
    'ai.byYear': L('，到第 {y} 年', '，到第 {y} 年', ' by year {y}'),
    'ai.period.am': L('早高峰', '早高峰', 'AM peak'), 'ai.period.day': L('平日日常', '平日日常', 'Daytime'), 'ai.period.holiday': L('節假日', '节假日', 'Holiday')
  });
  const FATAL = new Set(['too_easy', 'nothing_to_solve', 'unreachable', 'place_not_found', 'box_empty', 'invalid_request', 'invalid_input', 'unstable_traffic', 'error']);
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
  async function run(sentence, { lang, names, status, out, areas }) {
    const say = k => { status.textContent = t(k); };
    out.innerHTML = ''; say('ai.ask');
    let res;
    try {
      res = await root.TLAI.generate(sentence, { lang, names,
        onStep: s => say(s.step === 'ask' ? 'ai.ask' : s.step === 'build' ? 'ai.cut' : 'ai.retry'),
        build: async request => {
          const m = await build(request, p => say(p === 'bot' ? 'ai.bot' : 'ai.cut'));
          if (m.error) return { level: null, problems: [{ code: 'error', message: m.error }] };
          const all = m.problems || [];
          const fatal = p => !m.level || (FATAL.has(p.code) && !/回退/.test(p.message || ''));   // a near-name fallback is only a note
          return { ...m, built: m.request, problems: all.filter(fatal), warnings: all.filter(p => !fatal(p)) };
        } });
    } catch (e) { status.textContent = t('ai.fail') + (e.message || ''); return; }
    if (!res || !res.level) { status.textContent = t('ai.fail') + ((res && res.problems || []).map(p => p.message || p.code).join('；') || '—'); return res; }
    status.textContent = t(res.source === 'example' ? 'ai.readyEx' : 'ai.ready');
    const r = res.request, lv = res.level, rep = res.report || {}, tiers = lv.tiers || rep.tiers || [0, 0, 0];
    const area = (areas || []).find(a => a.key === r.area);
    const sign = n => (n > 0 ? '+' : '') + n, num = n => sign(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    // the worker's copy of the request: an «add» the AI read (50,000 more people) is turned into a % of the place's people
    const changes = ((res.built || r).changes || []).map(c => esc(c.place) + ' · ' + t('ai.' + c.what) + ' ' +
      (c.from ? num(c.from.add) + '（≈ ' + sign(c.pct) + '%）' : sign(c.pct) + '%') + (c.by_year ? t('ai.byYear', { y: c.by_year }) : '')).join('<br>') || '—';
    out.innerHTML = '<div class="ai-level"><h3>' + esc(r.title) + '</h3>' + (r.story || []).map(s => '<p>' + esc(s) + '</p>').join('') +
      '<dl><dt>' + t('ai.where') + '</dt><dd>' + esc(area ? pick({ 'zh-Hant': area.name, 'zh-Hans': area.hans || area.name, en: area.en || area.key }) : r.area) + '</dd>' +
      '<dt>' + t('ai.when') + '</dt><dd>' + t('ai.period.' + (lv.source && lv.source.period || r.period || 'am')) + '</dd>' +
      '<dt>' + t('ai.changes') + '</dt><dd>' + changes + '</dd></dl>' +
      '<p class="mono">' + t('ai.size', { o: (lv.origins || []).length, d: (lv.destinations || []).length, r: new Set((lv.roads || []).map(x => x.name)).size, l: (lv.lines || []).length }) + '</p>' +
      '<p class="mono">' + t('ai.best', { b: Math.round(rep.best || 0), p: tiers[0], h: tiers[1], m: tiers[2] }) + '</p>' +
      ((res.warnings || []).some(p => p.code === 'model_vc_mismatch') ? '<p class="note">' + t('ai.vc') + '</p>' : '') +
      '<button class="btn btn-p" id="aiOpen">' + t('ai.open') + '</button></div>';
    // kept for this browser session only (shared/levelpack.js checks it and names it custom-<hash>); nothing is uploaded
    document.getElementById('aiOpen').onclick = async () => {
      const draft = JSON.parse(JSON.stringify({ format: 'tl-level/1', mode: 3, title: r.title, story: r.story || [], level: { ...lv, tiers, title: r.title }, tiers,
        source: { by: 'ai', example: res.source === 'example', area: r.area, period: r.period, request: r } }));
      try { const p = await root.TLPack.save(draft); location.href = '../mode3-roads/index.html#pack=' + p.id; }
      catch (e) { status.textContent = t('ai.fail') + e.message; }
    };
    return res;
  }
  root.TLAILevel = { run };
})(typeof window !== 'undefined' ? window : globalThis);
