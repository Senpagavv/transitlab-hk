(function () {
  'use strict';
  // Only served in the mock's temporary /__mock/m1 response. Not a production mode edit.
  const L = I18N.L;
  I18N.add({ 'mock.banner': L('本機假后台驗收 · 模式頁檔案未改', '本机假后台验收 · 模式页文件未改', 'Local mock acceptance · mode files unchanged') });
  const note = document.createElement('p'); note.textContent = I18N.t('mock.banner'); note.style.cssText = 'position:fixed;bottom:0;left:0;z-index:10;padding:4px 10px;background:#f4ddb2;margin:0;font:12px system-ui'; document.body.append(note);
  TLBoard.bind({ mode: 1, loginUrl: '/__mock/login#mock-login' });
  addEventListener('tl:result', e => {
    const r = e.detail;
    TLBoard.result({ level: 'feeder/m1/' + r.map, score: r.score, tier: r.tier, plan: { seed: r.seed, opening: r.opening, moves: r.moves } });
  });
  document.addEventListener('click', async e => {
    const a = e.target.closest('a'); if (!a || !a.href.endsWith('/__mock/login#mock-login')) return;
    e.preventDefault(); await fetch('/__mock/login', { method: 'POST', credentials: 'same-origin' }); await TLBoard.refresh();
  });
})();
