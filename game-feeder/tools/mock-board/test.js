'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs'), vm = require('node:vm');
const V7 = path.resolve(__dirname, '../../v7');
class Storage { constructor() { this.values = new Map(); } getItem(k) { return this.values.get(k) || null; } setItem(k, v) { this.values.set(k, String(v)); } }
global.sessionStorage = new Storage(); global.localStorage = new Storage();
const nativeFetch = global.fetch;
require(path.join(V7, 'shared/i18n.js'));
const Pack = require(path.join(V7, 'shared/levelpack.js')), verify = require('../verify-score.js');
const fixture = () => {
  const p = JSON.parse(fs.readFileSync(path.join(V7, 'levels/examples/m3-1.json'), 'utf8'));
  p.source = { by: 'ai', area: 'kowloon-east', period: 'am', request: { prompt: 'test' } };
  p.created = '2026-10-15T10:00:00+08:00'; return p;
};
test('pack save/load/list/remove; independent clones', async () => {
  const p = await Pack.save(fixture()); assert.match(p.id, /^custom-[a-f0-9]{8}$/); assert.match(p.hash, /^[a-f0-9]{16}$/);
  assert.deepEqual(await Pack.load(p.id), p); assert.equal(Pack.list().length, 1);
  const a = await Pack.load(p.id); a.level.cols = 999; assert.notEqual((await Pack.load(p.id)).level.cols, 999);
  assert.equal(Pack.remove(p.id), true); assert.equal(await Pack.load(p.id), null);
});
test('export/import round trip; tampered hash rejected; sorted keys stable', async () => {
  const out = await Pack.exportFile(fixture()); assert.ok(out.name.endsWith('.tlevel.json'));
  const p = await Pack.importFile({ text: async () => out.text }); assert.deepEqual(p, out.pack);
  const bad = JSON.parse(out.text); bad.level.budget++;
  await assert.rejects(Pack.importFile({ text: async () => JSON.stringify(bad) }));
  const reordered = Object.fromEntries(Object.entries(p.level).reverse()); assert.equal(await Pack.hash(reordered), p.hash);
});
test('required fields in all four modes; invalid bounds/format/sales data rejected', async () => {
  for (const [mode, file] of [[1, 'l2'], [2, 'm2-1'], [3, 'm3-1'], [4, 'm4-1']]) {
    const p = JSON.parse(fs.readFileSync(path.join(V7, 'levels/examples/' + file + '.json'), 'utf8')); p.source = { by: 'user' };
    assert.equal((await Pack.prepare(p)).mode, mode);
    delete p.level.cols; await assert.rejects(Pack.prepare(p));
  }
  const bad = fixture(); bad.level.origins[0].cell = [-1, 0]; await assert.rejects(Pack.prepare(bad));
  const bad2 = fixture(); bad2.format = 'tl-level/2'; await assert.rejects(Pack.prepare(bad2));
});
test('disabled upload sends zero requests, enabled upload uses Cookie and specified path', async () => {
  let calls = 0; global.fetch = async (url, opts) => { calls++; assert.equal(url, '/api/feeder/levels'); assert.equal(opts.credentials, 'same-origin'); return { ok: true, json: async () => ({ ok: true }) }; };
  global.TL_FEATURES.levelUpload = false; assert.equal((await Pack.upload(fixture())).disabled, true); assert.equal(calls, 0);
  global.TL_FEATURES.levelUpload = true; assert.equal((await Pack.upload(fixture())).ok, true); assert.equal(calls, 1); global.TL_FEATURES.levelUpload = false; global.fetch = nativeFetch;
});
test('third-mode master rounds to 3321; changed score fails; strict 0.5 bound', async () => {
  const ctx = vm.createContext({}); vm.runInContext(fs.readFileSync(path.join(V7, 'mode3-roads/demo-plans.js'), 'utf8'), ctx);
  const p = JSON.parse(JSON.stringify(ctx.TL_ROADS_DEMO['m3-1'].master));
  const out = await verify('feeder/m3/m3-1', p); assert.equal(out.ok, true, JSON.stringify(out)); assert.equal(out.rounded, 3321);
  assert.equal((await verify('feeder/m3/m3-1', { ...p, score: p.score + 1 })).ok, false);
  assert.equal((await verify('feeder/m3/m3-1', p, { score: out.score + 0.5 })).ok, false);
  const illegal = { ...p, trains: 10000 }; assert.equal((await verify('feeder/m3/m3-1', illegal)).ok, false);
  const pack = await Pack.prepare(fixture()); assert.equal((await verify('feeder/m3/' + pack.id, p, { pack })).ok, true);
  assert.equal((await verify('feeder/m3/' + pack.id, p)).ok, false);
});
test('board challenge gate, per-level local top ten, missing storage fallback', async () => {
  const events = new Map(); const storage = new Storage();
  const c = vm.createContext({ localStorage: storage, I18N: global.I18N, TL_LEVELS: { get: (n, k) => ({ challenge: k === 'l4' }) }, addEventListener: (k, f) => events.set(k, f), document: { querySelector: () => null }, console });
  vm.runInContext(fs.readFileSync(path.join(V7, 'shared/board.js'), 'utf8'), c);
  assert.equal(c.TLBoard.eligible('feeder/m1/l1'), false); assert.equal(c.TLBoard.eligible('feeder/m1/l4'), true);
  for (let score = 0; score < 15; score++) events.get('feeder:result')({ detail: { level: 'feeder/m1/l4', score, plan: {}, tier: 1 } });
  assert.equal(c.TLBoard.local('feeder/m1/l4').length, 10); assert.equal(c.TLBoard.local('feeder/m1/l4')[0].score, 14); assert.equal(c.TLBoard.local('feeder/m2/l4').length, 0);
  c.localStorage = { getItem() { throw Error(); }, setItem() { throw Error(); } };
  assert.equal(c.TLBoard.receive({ level: 'feeder/m1/l4', score: 20, plan: {} }), true); assert.equal(c.TLBoard.local('feeder/m1/l4')[0].score, 20);
  c.localStorage = { getItem() { return '[]'; }, setItem() { throw Error('quota'); } };
  assert.equal(c.TLBoard.receive({ level: 'feeder/m1/l4', score: 21, plan: {} }), true); assert.equal(c.TLBoard.local('feeder/m1/l4')[0].score, 21);
  const snapshot = c.TLBoard.snapshot(3, { line: [[5, 5]], trains: 99, phase1State: { line: [[1, 1], [1, 2]], stations: [[1, 1], [1, 2]], trains: 1 }, phase2Actions: [{ type: 'train' }] });
  assert.equal(snapshot.trains, 1); assert.equal(snapshot.phase2.length, 1); assert.equal(snapshot.line.length, 2);
});
test('CLI master returns exit 0 / rounded 3321, modified one-number file returns exit 1', () => {
  const { spawnSync } = require('node:child_process');
  for (const [file, code] of [['master.json', 0], ['master-tampered.json', 1]]) {
    const r = spawnSync(process.execPath, [path.join(__dirname, '../verify-score.js'), 'feeder/m3/m3-1', path.join(__dirname, 'fixtures', file)], { encoding: 'utf8' });
    assert.equal(r.status, code, r.stderr); const out = JSON.parse(r.stdout); assert.equal(out.rounded, 3321); assert.equal(out.ok, code === 0);
  }
});
test('modes 1/2/4 replay through engine methods; sale year retained; illegal plans rejected', async () => {
  const E1 = require(path.join(V7, 'mode1-bus/engine.js')); E1.D.select('l4'); E1.reset(); const g = new E1.Game();
  const opening = E1.D.candidates.slice(0, 3).map(c => c.slice()); opening.forEach((c, i) => assert.equal(g.place(i, c), true)); assert.equal(g.start(), true); g.advance(E1.P.duration + 1);
  assert.equal((await verify('feeder/m1/l4', { opening, moves: [], seed: g.seed, score: g.delivered })).ok, true);
  assert.equal((await verify('feeder/m1/l4', { opening: [opening[0], opening[0], opening[2]], score: g.delivered })).ok, false);
  for (const [mode, dir, variable, pick] of [[2, 'mode2-metro', 'TL_METRO_DEMO', 'master'], [4, 'mode4-tod', 'TL_TOD_DEMO', 'mixed']]) {
    const c = vm.createContext({}); vm.runInContext(fs.readFileSync(path.join(V7, dir, 'demo-plans.js'), 'utf8'), c);
    const p = JSON.parse(JSON.stringify(c[variable]['m' + mode + '-1'][pick]));
    if (mode === 4) p.sales = p.actions.map(a => ({ cell: a.cell, use: a.use, year: a.year + 1 }));
    const check = await verify('feeder/m' + mode + '/m' + mode + '-1', p); assert.equal(check.ok, true, JSON.stringify(check));
    assert.equal((await verify('feeder/m' + mode + '/m' + mode + '-1', { ...p, score: p.score + 1 })).ok, false);
    if (mode === 4) assert.equal((await verify('feeder/m4/m4-1', { ...p, sales: [{ cell: [0, 0], use: 'home', year: 1 }] })).ok, false);
  }
});
test('mock API: unauthenticated, Cookie login, verified upload, best rank, tamper refusal, library closed', async () => {
  const server = require('./server.js')(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await nativeFetch(base + '/api/auth/me').then(r => r.json())).user, null);
    assert.equal((await nativeFetch(base + '/api/game/leaderboard', { method: 'POST', body: '{}' })).status, 401);
    const login = await nativeFetch(base + '/__mock/login', { method: 'POST' }), cookie = login.headers.get('set-cookie').split(';')[0];
    const pack = await nativeFetch(base + '/__mock/pack').then(r => r.json());
    const c = vm.createContext({}); vm.runInContext(fs.readFileSync(path.join(V7, 'mode3-roads/demo-plans.js'), 'utf8'), c);
    const plan = JSON.parse(JSON.stringify(c.TL_ROADS_DEMO['m3-1'].master)), mode = 'feeder/m3/' + pack.id;
    const send = b => nativeFetch(base + '/api/game/leaderboard', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    const result = { mode, plan, score: 3321, lang: 'zh-Hant' };
    assert.equal((await send(result)).status, 200); assert.equal((await send(result)).status, 200);
    assert.equal((await send({ ...result, score: 3322 })).status, 400);
    assert.equal((await send({ ...result, mode: 'feeder/m3/m3-1' })).status, 400);
    const board = await nativeFetch(base + '/api/game/leaderboard?mode=' + mode + '&limit=50').then(r => r.json()); assert.equal(board.entries.length, 1); assert.equal(board.entries[0].rank, 1);
    const me = await nativeFetch(base + '/api/game/leaderboard/me?mode=' + mode, { headers: { cookie } }).then(r => r.json()); assert.equal(me.entry.rank, 1);
    assert.equal((await nativeFetch(base + '/api/feeder/levels', { method: 'POST' })).status, 503);
    assert.equal((await nativeFetch(base + '/__mock/m1').then(r => r.text())).includes('m1-bridge.js'), true);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
