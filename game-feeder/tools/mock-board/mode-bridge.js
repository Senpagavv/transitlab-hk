(function () {
  'use strict';
  const mode = Number(document.currentScript.dataset.mode);
  TLBoard.bind({ mode, loginUrl: '/__mock/login#mock-login' });
  addEventListener('tl:result', e => {
    const r = e.detail;
    const plan = mode === 1 ? { seed: r.seed, opening: r.opening, moves: r.moves } : TLBoard.snapshot(mode, ({ 2: window.TL_METRO, 3: window.TL_ROADS, 4: window.TL_TOD })[mode].api.plan);
    TLBoard.result({ level: 'feeder/m' + mode + '/' + r.map, score: r.score, tier: r.tier, plan });
  });
  document.addEventListener('click', async e => {
    const a = e.target.closest('a'); if (!a || !a.href.endsWith('/__mock/login#mock-login')) return;
    e.preventDefault(); await fetch('/__mock/login', { method: 'POST', credentials: 'same-origin' }); await TLBoard.refresh();
  });
})();
