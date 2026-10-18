(function (root) {
  'use strict';
  const I = root.I18N;
  if (!I) throw new Error('Load shared/i18n.js before board.js');
  const L = I.L;
  I.add({
    'board.title': L('排行榜', '排行榜', 'Leaderboard'),
    'board.local': L('本機', '本机', 'This device'),
    'board.offline': L('排行榜暫時連不上，顯示本機成績', '排行榜暂时连不上，显示本机成绩', 'Leaderboard unavailable. Showing scores on this device'),
    'board.login': L('登入後可上傳', '登录后可上传', 'Sign in to upload'),
    'board.signin': L('登入', '登录', 'Sign in'),
    'board.upload': L('上傳本局成績', '上传本局成绩', 'Upload this score'),
    'board.uploaded': L('已上傳', '已上传', 'Uploaded'),
    'board.rejected': L('成績未被接受，請重新檢查方案', '成绩未被接受，请重新检查方案', 'Score was rejected. Please check the plan'),
    'board.refresh': L('重新整理', '刷新', 'Refresh'),
    'board.close': L('關閉', '关闭', 'Close'),
    'board.loading': L('讀取中…', '读取中…', 'Loading…'),
    'board.rank': L('名次', '名次', 'Rank'),
    'board.player': L('玩家', '玩家', 'Player'),
    'board.score': L('成績', '成绩', 'Score'),
    'board.me': L('我的名次：{rank}', '我的名次：{rank}', 'My rank: {rank}'),
    'board.unranked': L('尚未上榜', '尚未上榜', 'Not ranked yet'),
    'board.empty': L('暫無成績', '暂无成绩', 'No scores yet'),
    'board.you': L('我', '我', 'Me'),
    'board.storage': L('瀏覽器未能保存成績，只在這次頁面顯示', '浏览器未能保存成绩，只在这次页面显示', 'Scores could not be saved; available only on this page')
  });
  const cfg = { mode: null, container: '#result .row', loginUrl: '/login', timeout: 4000 };
  const memory = new Map();
  let current = null, button = null, dialog = null, model = null, ticket = 0, busy = false;
  const copy = x => JSON.parse(JSON.stringify(x));
  function parts(id) {
    const m = /^feeder\/(m[1-5](?:-bus)?)\/([a-z0-9][a-z0-9-]*)$/.exec(id || '');
    return m ? { mode: m[1], n: Number(m[1][1]), key: m[2] } : null;
  }
  function eligible(id) {
    const p = parts(id); if (!p) return false;
    if (p.key.startsWith('custom-')) {
      try { return !!root.TLPack?.list().some(x => x.id === p.key && x.mode === p.n); } catch (_) { return false; }
    }
    return !!root.TL_LEVELS?.get(p.n, p.key)?.challenge;
  }
  function local(id) {
    // setItem can fail (quota/private mode) while getItem still succeeds. Keep the
    // just-finished score visible in that case too, not only when both methods throw.
    if (memory.has(id)) return copy(memory.get(id));
    try {
      const a = JSON.parse(root.localStorage.getItem('tl-board/1/' + id) || '[]');
      return Array.isArray(a) ? a.filter(x => x && Number.isFinite(x.score) && typeof x.created === 'string').sort((a, b) => b.score - a.score || a.created.localeCompare(b.created)).slice(0, 10) : [];
    } catch (_) { return memory.get(id) || []; }
  }
  function record(r) {
    const a = local(r.level).concat({ score: r.score, tier: r.tier, created: new Date().toISOString() }).sort((a, b) => b.score - a.score || a.created.localeCompare(b.created)).slice(0, 10);
    memory.set(r.level, a);
    try { root.localStorage.setItem('tl-board/1/' + r.level, JSON.stringify(a)); return true; } catch (_) { return false; }
  }
  function receive(r) {
    if (root.TL_SITE?.board === false) return false;
    ++ticket; busy = false;
    if (!r || !eligible(r.level) || !Number.isFinite(r.score) || !r.plan || typeof r.plan !== 'object') {
      current = null; if (button) button.hidden = true; if (dialog?.open) dialog.close(); return false;
    }
    try { current = copy({ level: r.level, score: r.score, plan: r.plan, tier: r.tier, lang: I.lang }); } catch (_) { return false; }
    current.saved = record(current); current.uploaded = false; model = null;
    mount(); if (button) button.hidden = false; if (dialog?.open) refresh(); return true;
  }
  function mount() {
    if (root.TL_SITE?.board === false) return ;
    const parent = typeof cfg.container === 'string' ? document.querySelector(cfg.container) : cfg.container;
    if (!parent) return;
    if (!button || button.parentNode !== parent) {
      button?.remove(); button = document.createElement('button'); button.type = 'button'; button.className = 'btn tl-board-open';
      button.addEventListener('click', open); parent.append(button);
    }
    button.textContent = I.t('board.title'); button.hidden = !current;
  }
  async function request(url, opts = {}) {
    if (root.TL_SITE?.board === false) throw new Error('Leaderboard disabled');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), cfg.timeout);
    try {
      const r = await root.fetch(url, { ...opts, credentials: 'same-origin', signal: controller.signal });
      if (r.status === 401) return { unauthorized: true };
      if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return await r.json();
    } finally { clearTimeout(timer); }
  }
  function element(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
  function action(key, fn, disabled = false) { const b = element('button', I.t(key), 'btn'); b.type = 'button'; b.disabled = disabled; b.addEventListener('click', fn); return b; }
  function rowsOf(data) {
    const rows = Array.isArray(data) ? data : data?.entries || data?.leaderboard || data?.scores;
    if (!Array.isArray(rows)) throw new Error('Bad leaderboard response');
    return rows.slice(0, 50).map((x, i) => {
      if (!x || !Number.isFinite(x.score)) throw new Error('Bad score response');
      return { rank: Number.isInteger(x.rank) && x.rank > 0 ? x.rank : i + 1, name: String(x.name || x.displayName || x.user?.name || x.username || '—'), score: x.score };
    });
  }
  function render() {
    if (!dialog || !current) return;
    dialog.replaceChildren();
    const head = element('div', undefined, 'tl-board-head'), h = element('h2', I.t('board.title')); h.id = 'tl-board-title';
    head.append(h, action('board.close', () => dialog.close())); dialog.append(head);
    dialog.append(element('code', current.level, 'tl-board-level'));
    if (!current.saved) dialog.append(element('p', I.t('board.storage'), 'tl-board-status'));
    if (!model) { dialog.append(element('p', I.t('board.loading'), 'tl-board-status')); return; }
    const offline = model.offline;
    if (offline) dialog.append(element('p', I.t('board.offline'), 'tl-board-status'));
    const rows = offline ? local(current.level).map((x, i) => ({ rank: i + 1, name: I.t('board.local'), score: x.score })) : model.rows;
    const table = element('table'), cap = element('caption', offline ? I.t('board.local') + ' · 10' : I.t('board.title') + ' · 50'); table.append(cap);
    const thead = element('thead'), tr = element('tr');
    for (const k of ['board.rank', 'board.player', 'board.score']) { const th = element('th', I.t(k)); th.scope = 'col'; tr.append(th); } thead.append(tr); table.append(thead);
    const body = element('tbody'); rows.forEach(x => { const row = element('tr'); row.append(element('td', String(x.rank)), element('td', x.name), element('td', String(Math.round(x.score * 100) / 100))); body.append(row); });
    table.append(body); dialog.append(table);
    if (!rows.length) dialog.append(element('p', I.t('board.empty')));
    if (offline) {
      const n = rows.findIndex(x => Math.abs(x.score - current.score) < 0.000001);
      dialog.append(element('p', I.t('board.local') + ' · ' + I.t('board.me', { rank: n < 0 ? I.t('board.unranked') : n + 1 })));
    } else if (model.user) {
      dialog.append(element('p', I.t('board.me', { rank: model.me?.rank || I.t('board.unranked') }), 'tl-board-mine'));
      dialog.append(action(current.uploaded ? 'board.uploaded' : 'board.upload', submit, busy || current.uploaded));
    } else {
      const p = element('p', I.t('board.login') + ' '), a = element('a', I.t('board.signin'));
      const url = new URL(cfg.loginUrl, root.location.href);
      if (['http:', 'https:'].includes(url.protocol)) a.href = url.href;
      p.append(a); dialog.append(p);
    }
    if (model.message) dialog.append(element('p', I.t(model.message), 'tl-board-status'));
    dialog.append(action('board.refresh', refresh, busy));
  }
  async function refresh() {
    if (root.TL_SITE?.board === false) return ;
    if (!current || busy) return;
    const mine = ++ticket, r = current; model = null; render();
    try {
      const q = '?mode=' + encodeURIComponent(r.level);
      const [auth, data] = await Promise.all([request('/api/auth/me'), request('/api/game/leaderboard' + q + '&limit=50')]);
      const rows = rowsOf(data), user = !auth.unauthorized && auth.user;
      const me = user ? await request('/api/game/leaderboard/me' + q) : null;
      if (mine !== ticket || r !== current) return;
      model = { rows, user, me: me?.entry || me };
    } catch (_) { if (mine !== ticket || r !== current) return; model = { offline: true }; }
    render();
  }
  async function submit() {
    if (root.TL_SITE?.board === false) return ;
    if (!current || busy || !model?.user || model.offline || current.uploaded) return;
    busy = true; const r = current, mine = ticket; render();
    try {
      const out = await request('/api/game/leaderboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: r.level, score: r.score, plan: r.plan, lang: r.lang }) });
      if (r !== current || mine !== ticket) return;
      if (out.unauthorized) { model.user = null; return; }
      if (out.ok === false) { model.message = 'board.rejected'; return; }
      r.uploaded = true; busy = false; await refresh();
    } catch (e) {
      if (r !== current || mine !== ticket) return;
      if (e.status >= 400 && e.status < 500) model.message = 'board.rejected'; else model = { offline: true };
    } finally { if (r === current) { busy = false; render(); } }
  }
  function open() {
    if (root.TL_SITE?.board === false) return false;
    if (!current) return false;
    if (!dialog) {
      dialog = element('dialog', undefined, 'tl-board-panel'); dialog.setAttribute('aria-labelledby', 'tl-board-title');
      dialog.setAttribute('aria-live', 'polite'); document.body.append(dialog);
      dialog.addEventListener('close', () => { ++ticket; busy = false; button?.focus(); });
    }
    render(); if (!dialog.open) dialog.showModal(); refresh(); return true;
  }
  function bind(options = {}) { Object.assign(cfg, options); mount(); return API; }
  function result(detail) { root.dispatchEvent(new CustomEvent('feeder:result', { detail })); }
  function snapshot(mode, p) {
    if (mode === 1) return copy({ seed: p.seed, opening: p.opening, moves: p.commands.map(a => ({ time: a.time, id: a.id, cell: a.cell })) });
    if (![2, 3, 4].includes(mode)) throw new Error('tl-level/1 supports modes 1–4');
    const initial = mode === 3 ? p.phase1State || p : p;
    const out = { line: initial.line, stations: initial.stations, trains: initial.trains };
    if (mode === 3) out.phase2 = p.phase2Actions || [];
    if (mode === 4) out.sales = (p.sales || []).concat(p.pendingSales || []).map(a => ({ cell: a.cell, use: a.use, year: a.year }));
    return copy(out);
  }
  const API = { bind, result, snapshot, open, refresh, eligible, local, receive };
  root.TLBoard = API;
  root.addEventListener('feeder:result', e => receive(e.detail));
  root.addEventListener('tl:lang', () => { mount(); render(); });
  if (typeof module !== 'undefined') module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
