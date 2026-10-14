(async function () {
  'use strict';
  const L = I18N.L;
  I18N.add({
    'mock.title': L('任務56 · 本機驗收', '任务56 · 本机验收', 'Task 56 · local acceptance'),
    'mock.scope': L('假登入、記憶體排行榜，僅供本機測試。關卡庫未開放。', '假登录、内存排行榜，仅供本机测试。关卡库未开放。', 'Fake sign-in and in-memory leaderboard for local testing. Level library is closed.'),
    'mock.challenge': L('挑戰關 · 真正模式頁', '挑战关 · 真实模式页', 'Challenge · actual mode page'),
    'mock.challengeNote': L('在回應中暫時接上排行榜，硬碟上的模式頁保持原樣。既有測試掛鉤加速結算。', '在响应中临时接上排行榜，硬盘上的模式页保持原样。已有测试钩子加速结算。', 'Temporary response integration; mode files on disk stay unchanged. Existing test hooks speed up settlement.'),
    'mock.openChallenge': L('開啟模式1第4關結算', '打开模式1第4关结算', 'Open mode 1 level 4 settlement'),
    'mock.custom': L('AI 關卡包 · 第三模式', 'AI 关卡包 · 第三模式', 'AI level pack · mode 3'),
    'mock.run': L('運行大師方案並結算', '运行大师方案并结算', 'Run master plan and settle'),
    'mock.export': L('導出關卡包', '导出关卡包', 'Export level pack'),
    'mock.result': L('本局結算', '本局结算', 'Round result'),
    'mock.score': L('成績：{score}', '成绩：{score}', 'Score: {score}'),
    'mock.m1': L('模式1 · 打開關卡包', '模式1 · 打开关卡包', 'Mode 1 · open level pack'),
    'mock.m2': L('模式2 · 打開關卡包', '模式2 · 打开关卡包', 'Mode 2 · open level pack'),
    'mock.m3': L('模式3 · 打開關卡包', '模式3 · 打开关卡包', 'Mode 3 · open level pack'),
    'mock.m4': L('模式4 · 打開關卡包', '模式4 · 打开关卡包', 'Mode 4 · open level pack')
  });
  I18N.apply();
  const p = await TLPack.save(await fetch('/__mock/pack').then(r => r.json()));
  const pick = x => typeof x === 'string' ? x : x[I18N.lang] || x['zh-Hant'];
  const show = () => { document.querySelector('#packTitle').textContent = pick(p.title); document.querySelector('#packId').textContent = p.id; document.querySelector('#packStory').textContent = p.story.map(pick).join(' '); };
  show(); addEventListener('tl:lang', show);
  TLPack.uploadButton(p, document.querySelector('#library'));
  TLBoard.bind({ mode: 3, loginUrl: '/__mock/login#mock-login' });
  document.querySelector('#run').disabled = false; document.querySelector('#export').disabled = false;
  document.querySelector('#export').onclick = () => TLPack.exportFile(p);
  document.querySelectorAll('[data-pack-mode]').forEach(button => { button.onclick = async () => { const mode = Number(button.dataset.packMode); const pack = await TLPack.save(await fetch('/__mock/pack?mode=' + mode).then(r => r.json())); location.href = '/__mock/mode?mode=' + mode + '#pack=' + pack.id; }; });
  document.querySelector('#dismiss').onclick = () => document.querySelector('#result').close();
  document.querySelector('#run').onclick = () => {
    const input = TL_ROADS_DEMO['m3-1'].master; ROADS_DATA.use(p.level, p.id); Roads.reset(); const plan = new Roads.Plan();
    input.line.forEach(c => plan.extend(c)); input.stations.forEach(c => plan.toggleStation(c));
    for (let i = 1; i < input.trains; i++) plan.addTrain();
    while (plan.year < 4) plan.runYear();
    input.phase2.forEach(a => { if (a.type === 'train') plan.addTrain(); else if (a.type === 'station') plan.toggleStation(a.cell); else plan.extend(a.cell); });
    plan.continuePhase2(); while (!plan.done) plan.runYear();
    document.querySelector('#resultScore').textContent = I18N.t('mock.score', { score: Math.round(plan.total) }); document.querySelector('#result').showModal();
    TLBoard.result({ level: 'feeder/m3/' + p.id, score: Math.round(plan.total), tier: 3, plan: { line: input.line, stations: input.stations, trains: input.trains, phase2: input.phase2 } });
  };
  document.addEventListener('click', async e => {
    const a = e.target.closest('a'); if (!a || !a.href.endsWith('/__mock/login#mock-login')) return;
    e.preventDefault(); await fetch('/__mock/login', { method: 'POST', credentials: 'same-origin' }); await TLBoard.refresh();
  });
})();
