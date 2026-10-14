(function (root) {
  'use strict';
  const I = root.I18N;
  if (!I) throw new Error('Load shared/i18n.js before levelpack.js');
  const L = I.L;
  I.add({
    'pack.invalid': L('關卡檔格式不正確', '关卡文件格式不正确', 'Invalid level file'),
    'pack.hash': L('關卡內容與雜湊不符', '关卡内容与哈希不符', 'Level content does not match its hash'),
    'pack.storage': L('無法儲存本次網頁的關卡', '无法保存本次网页的关卡', 'Cannot save levels in this browser session'),
    'pack.closed': L('關卡庫即將開放', '关卡库即将开放', 'Level library coming soon'),
    'pack.upload': L('上傳到關卡庫', '上传到关卡库', 'Upload to level library'),
    'pack.failed': L('上傳失敗，請稍後再試', '上传失败，请稍后再试', 'Upload failed. Please try again later'),
    'pack.missing': L('這個關卡包不在本次網頁中，請重新導入', '这个关卡包不在本次网页中，请重新导入', 'This level pack is missing from this session. Import it again'),
    'pack.mode': L('關卡包的玩法與這個模式頁不同', '关卡包的玩法与这个模式页不同', 'This level pack belongs to a different mode')
  });
  root.TL_FEATURES = Object.assign({ levelUpload: false }, root.TL_FEATURES || {});
  const KEY = 'tl-packs/1', MAX = 2 * 1024 * 1024;
  const copy = x => JSON.parse(JSON.stringify(x));
  const fail = (key = 'pack.invalid', field = '') => { throw new Error(I.t(key) + (field ? ': ' + field : '')); };
  const obj = x => !!x && typeof x === 'object' && !Array.isArray(x);
  // Sorted object keys; array order is meaningful. Used identically in Node and the browser.
  function canonical(x) {
    if (x === null || typeof x === 'boolean' || typeof x === 'string') return JSON.stringify(x);
    if (typeof x === 'number' && Number.isFinite(x)) return JSON.stringify(x);
    if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
    if (obj(x)) return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
    fail();
  }
  function safeJSON(x, depth = 0) {
    if (depth > 32) fail();
    if (x && typeof x === 'object') {
      for (const k of Object.keys(x)) {
        if (['__proto__', 'prototype', 'constructor'].includes(k)) fail();
        safeJSON(x[k], depth + 1);
      }
    } else if (!['string', 'number', 'boolean'].includes(typeof x) && x !== null) fail();
    if (typeof x === 'number' && !Number.isFinite(x)) fail();
  }
  function validate(p) {
    safeJSON(p);
    if (!obj(p) || p.format !== 'tl-level/1' || ![1, 2, 3, 4].includes(p.mode) || !obj(p.level)) fail();
    if (!(typeof p.title === 'string' && p.title.trim()) && !(obj(p.title) && ['zh-Hant', 'zh-Hans', 'en'].every(k => typeof p.title[k] === 'string' && p.title[k].trim()))) fail('pack.invalid', 'title');
    if (!Array.isArray(p.story) || !p.story.every(s => typeof s === 'string' || (obj(s) && ['zh-Hant', 'zh-Hans', 'en'].every(k => typeof s[k] === 'string')))) fail('pack.invalid', 'story');
    const lv = p.level;
    for (const k of ['cols', 'rows']) if (!Number.isInteger(lv[k]) || lv[k] < 1 || lv[k] > 512) fail('pack.invalid', k);
    const cell = c => Array.isArray(c) && c.length === 2 && c.every(Number.isInteger) && c[0] >= 0 && c[0] < lv.cols && c[1] >= 0 && c[1] < lv.rows;
    const cells = a => Array.isArray(a) && a.every(cell);
    const tiers = a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite) && a[0] <= a[1] && a[1] <= a[2];
    if (!tiers(p.tiers) || !tiers(lv.tiers) || canonical(p.tiers) !== canonical(lv.tiers)) fail('pack.invalid', 'tiers');
    if (!obj(p.source) || !['ai', 'user'].includes(p.source.by) || (p.source.request !== undefined && !obj(p.source.request))) fail('pack.invalid', 'source');
    if (p.mode === 1) {
      if (!cell(lv.hub) || !cells(lv.roads) || !cells(lv.candidates) || lv.candidates.length < 3 || !Array.isArray(lv.estates) || !lv.estates.length || !lv.estates.every(o => obj(o) && typeof o.name === 'string' && cell(o.cell))) fail('pack.invalid', 'mode1');
      if (!Array.isArray(lv.waves) || !lv.waves.length || !lv.waves.every(w => Array.isArray(w) && w.length === lv.estates.length && w.every(n => Number.isFinite(n) && n >= 0))) fail('pack.invalid', 'waves');
    } else {
      for (const [k, n] of [['origins', 'people'], ['destinations', 'attraction']]) if (!Array.isArray(lv[k]) || !lv[k].length || !lv[k].every(o => obj(o) && typeof o.name === 'string' && cell(o.cell) && Number.isFinite(o[n]) && o[n] >= 0)) fail('pack.invalid', k);
      for (const k of ['budget', 'lineCost', 'stationCost', 'trainCost', 'perTrain', 'years']) if (!Number.isFinite(lv[k]) || lv[k] < 0) fail('pack.invalid', k);
      if (!Number.isInteger(lv.years) || lv.years < 1 || lv.years > 100) fail('pack.invalid', 'years');
      if (p.mode === 3 && (!Array.isArray(lv.roads) || !lv.roads.length || !lv.roads.every(r => obj(r) && typeof r.name === 'string' && cells(r.via) && r.via.length >= 2 && Number.isFinite(r.cap) && r.cap > 0) || !Number.isFinite(lv.phase2Budget) || lv.phase2Budget < 0 || lv.years <= 4)) fail('pack.invalid', 'roads/phase2Budget/years');
      if (p.mode === 4 && (!Array.isArray(lv.land) || !lv.land.every(r => obj(r) && cell(r.cell)))) fail('pack.invalid', 'land');
      if (lv.lines !== undefined && (!Array.isArray(lv.lines) || !lv.lines.every(r => obj(r) && cells(r.via) && r.via.length >= 2 && cells(r.stations) && Number.isInteger(r.trains) && r.trains > 0))) fail('pack.invalid', 'lines');
    }
    if (canonical(p).length > MAX) fail();
    return p;
  }
  async function hash(level) {
    const text = canonical(level);
    if (root.crypto && root.crypto.subtle) {
      const bytes = new TextEncoder().encode(text);
      const digest = await root.crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('').slice(0, 16);
    }
    if (typeof require === 'function') return require('node:crypto').createHash('sha256').update(text).digest('hex').slice(0, 16);
    fail('pack.invalid', 'SHA-256 requires localhost or HTTPS');
  }
  async function prepare(input, requireHash = false) {
    if (!obj(input)) fail();
    safeJSON(input);
    const p = copy(input);
    p.tiers = p.tiers || p.level?.tiers;
    validate(p);
    const h = await hash(p.level);
    if ((requireHash || p.hash !== undefined) && p.hash !== h) fail('pack.hash');
    if (p.id !== undefined && p.id !== 'custom-' + h.slice(0, 8)) fail('pack.hash', 'id');
    p.hash = h; p.id = 'custom-' + h.slice(0, 8);
    p.created = p.created || new Date().toISOString();
    if (typeof p.created !== 'string' || !Number.isFinite(Date.parse(p.created))) fail('pack.invalid', 'created');
    return p;
  }
  function read() {
    try { const x = JSON.parse(root.sessionStorage.getItem(KEY) || '{}'); if (!obj(x)) fail(); return x; }
    catch (_) { fail('pack.storage'); }
  }
  function write(x) { try { root.sessionStorage.setItem(KEY, JSON.stringify(x)); } catch (_) { fail('pack.storage'); } }
  async function save(input) {
    const p = await prepare(input), all = read();
    if (all[p.id] && (all[p.id].hash !== p.hash || all[p.id].mode !== p.mode)) fail('pack.hash', 'id collision');
    all[p.id] = p; write(all); return copy(p);
  }
  async function load(id) { const p = read()[id]; return p ? prepare(p, true) : null; }
  function list() { return Object.values(read()).map(copy); }
  function remove(id) { const all = read(), existed = Object.hasOwn(all, id); delete all[id]; write(all); return existed; }
  async function importFile(file) {
    if (!file || typeof file.text !== 'function' || file.size > MAX) fail();
    const text = await file.text(); if (text.length > MAX) fail();
    let p; try { p = JSON.parse(text); } catch (_) { fail(); }
    return save(await prepare(p, true));
  }
  async function exportFile(input) {
    const p = await prepare(input), text = JSON.stringify(p, null, 2) + '\n';
    const out = { name: p.id + '.tlevel.json', text, pack: p };
    if (typeof document !== 'undefined') {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = out.name;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return out;
  }
  async function upload(input) {
    if (root.TL_FEATURES.levelUpload !== true) return { ok: false, disabled: true, message: I.t('pack.closed') };
    const p = await prepare(input);
    const r = await root.fetch('/api/feeder/levels', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
    if (!r.ok) fail('pack.failed');
    return r.json();
  }
  function uploadButton(input, parent) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn';
    const render = () => { b.disabled = root.TL_FEATURES.levelUpload !== true; b.textContent = I.t(b.disabled ? 'pack.closed' : 'pack.upload'); };
    render(); root.addEventListener('tl:lang', render);
    b.addEventListener('click', async () => { b.disabled = true; try { await upload(input); } catch (e) { b.title = e.message; } finally { render(); } });
    parent.append(b); return b;
  }
  // Replace only the ui/demo script tags with this awaited boot. D/E have already loaded;
  // D.use + E.reset happen BEFORE ui.js constructs its first Game/Plan.
  async function startMode({ mode, D, E, ui = 'ui.js', demos = [] }) {
    const id = new URLSearchParams(root.location.hash.slice(1)).get('pack');
    let pack = null;
    if (id) {
      pack = await load(id); if (!pack) fail('pack.missing'); if (pack.mode !== mode) fail('pack.mode');
      D.use(pack.level, pack.id); E.reset(); root.TL_ACTIVE_PACK = pack;
      const tri = x => typeof x === 'string' ? L(x, x, x) : L(x['zh-Hant'], x['zh-Hans'], x.en);
      I.add({ ['site.' + pack.id]: tri(pack.title), ['lvEn.' + pack.id]: tri(pack.title) });
    }
    const script = src => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Cannot load ' + src)); document.body.append(s); });
    await script(ui);
    if (pack) {
      const pick = x => typeof x === 'string' ? x : x[I.lang] || x['zh-Hant'];
      const paint = () => {
        if (D.map !== pack.id) return;
        const card = document.querySelector('#lvIntro'), title = document.querySelector('#ivTitle') || card?.querySelector('h2'), body = document.querySelector('#ivBody');
        if (title) title.textContent = pick(pack.title);
        if (body) { body.replaceChildren(); for (const line of pack.story) { const li = document.createElement('li'); li.textContent = pick(line); body.append(li); } }
        const en = document.querySelector('#ivEn'); if (en) en.textContent = pick(pack.title);
      };
      paint(); root.addEventListener('tl:lang', paint);
      const card = document.querySelector('#lvIntro');
      if (card && new URLSearchParams(root.location.hash.slice(1)).get('intro') !== '0' && !card.open) card.showModal();
      const info = document.querySelector('#lvInfo');
      if (info) { const previous = info.onclick; info.onclick = e => { if (D.map !== pack.id) return previous?.call(info, e); paint(); if (card && !card.open) card.showModal(); }; }
    } else if (!root.TL_LEVELS?.get(mode, D.map)?.challenge) {
      for (const src of demos) await script(src);
    }
    return pack;
  }
  const API = { save, list, load, remove, exportFile, importFile, upload, uploadButton, startMode, hash, prepare, validate, canonical };
  root.TLPack = API;
  if (typeof module !== 'undefined') module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
// v7 integration (Claude, 2026-10-15): pages read the pack in data.js (synchronously, bundles too) and call this after
// ui.js to put the pack's title and story on the opening card, again on each language change.
(function (root) {
  if (typeof document === 'undefined') return;
  root.TLPackIntro = function (pack) {
    const I = root.I18N, pick = x => typeof x === 'string' ? x : x[I.lang] || x['zh-Hant'];
    const paint = () => {
      const card = document.querySelector('#lvIntro'); if (!card) return;
      const title = document.querySelector('#ivTitle') || card.querySelector('h2'), body = document.querySelector('#ivBody');
      if (title) title.textContent = pick(pack.title);
      if (body && pack.story) { body.replaceChildren(); for (const line of pack.story) { const li = document.createElement('li'); li.textContent = pick(line); body.append(li); } }
    };
    paint(); root.addEventListener('tl:lang', () => setTimeout(paint, 0));
  };
})(typeof window !== 'undefined' ? window : globalThis);
