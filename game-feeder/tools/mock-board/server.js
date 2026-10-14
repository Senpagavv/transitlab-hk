#!/usr/bin/env node
'use strict';
// Loopback-only, disposable in-memory backend. Never deploy this fake login service.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..'), V7 = path.join(ROOT, 'v7');
const verify = require('../verify-score.js');
const Pack = require(path.join(V7, 'shared/levelpack.js'));
function createServer() {
  const scores = new Map(), sessions = new Map(), packs = new Map();
  let uploads = 0;
  const sorted = mode => [...(scores.get(mode)?.values() || [])].sort((a, b) => b.score - a.score || a.created - b.created).map((x, i) => ({ rank: i + 1, name: x.name, score: x.score, userId: x.userId }));
  const userOf = req => { const m = /(?:^|;\s*)mock-session=([a-f0-9]+)/.exec(req.headers.cookie || ''); return m ? sessions.get(m[1]) : null; };
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  async function body(req) {
    const chunks = []; let bytes = 0;
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) throw Error('Body too large'); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // No remote fonts, assets or network calls while using copied game pages.
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'");
    try {
      const url = new URL(req.url, 'http://127.0.0.1'), route = url.pathname, user = userOf(req);
      if (req.method === 'POST' && req.headers.origin && !['http://' + req.headers.host].includes(req.headers.origin)) return json(res, 403, { ok: false });
      if (route.startsWith('/api/')) console.log(req.method + ' ' + route);
      if (route === '/__mock/login' && req.method === 'POST') {
        const token = crypto.randomBytes(16).toString('hex'); sessions.set(token, { id: 'mock-player', name: 'Mock player' });
        res.setHeader('Set-Cookie', 'mock-session=' + token + '; HttpOnly; SameSite=Strict; Path=/'); return json(res, 200, { ok: true });
      }
      if (route === '/__mock/status') return json(res, 200, { uploads, users: sessions.size, levels: scores.size });
      if (route === '/__mock/stop' && req.method === 'POST') {
        res.on('finish', () => { server.close(); server.closeIdleConnections(); });
        return json(res, 200, { ok: true });
      }
      if (route === '/api/auth/me' && req.method === 'GET') return json(res, 200, { user: user || null });
      if (route === '/api/game/leaderboard' && req.method === 'GET') {
        const n = Number(url.searchParams.get('limit') || 50); return json(res, 200, { entries: sorted(url.searchParams.get('mode')).slice(0, Math.max(0, Math.min(50, Number.isFinite(n) ? n : 50))) });
      }
      if (route === '/api/game/leaderboard/me' && req.method === 'GET') {
        if (!user) return json(res, 401, { user: null });
        return json(res, 200, { entry: sorted(url.searchParams.get('mode')).find(x => x.userId === user.id) || null });
      }
      if (route === '/api/game/leaderboard' && req.method === 'POST') {
        if (!user) return json(res, 401, { ok: false, reason: 'Sign in first' });
        const b = await body(req);
        if (!['zh-Hant', 'zh-Hans', 'en'].includes(b.lang)) return json(res, 400, { ok: false, reason: 'Bad language' });
        const check = await verify(b.mode, b.plan, { score: b.score, challengeOnly: true, pack: packs.get(b.mode) });
        if (!check.ok) return json(res, 400, check);
        const rows = scores.get(b.mode) || new Map(), old = rows.get(user.id);
        if (!old || check.score > old.score) rows.set(user.id, { userId: user.id, name: user.name, score: check.score, created: Date.now() });
        scores.set(b.mode, rows); uploads++; return json(res, 200, { ok: true, entry: sorted(b.mode).find(x => x.userId === user.id) });
      }
      // Future library endpoint is deliberately unavailable, even in the mock.
      if (route === '/api/feeder/levels') return json(res, 503, { ok: false, reason: 'Level library not launched' });
      if (route === '/__mock/pack') {
        const mode = Number(url.searchParams.get('mode') || 3), files = { 1: 'l2', 2: 'm2-1', 3: 'm3-1', 4: 'm4-1' };
        if (!files[mode]) return json(res, 400, { ok: false });
        const p = JSON.parse(fs.readFileSync(path.join(V7, 'levels/examples/' + files[mode] + '.json'), 'utf8'));
        p.source = { by: 'ai', area: 'kowloon-east', period: 'am', request: { prompt: 'Local acceptance fixture' } };
        p.story = [{ 'zh-Hant': '這是本機保存的關卡包。', 'zh-Hans': '这是本机保存的关卡包。', en: 'This level pack is saved in this browser session.' }, { 'zh-Hant': '可導出成檔案，關卡庫仍未開放。', 'zh-Hans': '可以导出为文件，关卡库仍未开放。', en: 'Export it as a file. The level library is still closed.' }];
        p.created = '2026-10-15T10:00:00+08:00'; const pack = await Pack.prepare(p);
        packs.set('feeder/m' + mode + '/' + pack.id, pack); return json(res, 200, pack);
      }
      if (route === '/__mock/m1') {
        // Temporary response-only integration: copied index.html/ui.js remain byte-identical.
        let html = fs.readFileSync(path.join(V7, 'mode1-bus/index.html'), 'utf8');
        html = html.replace('<head>', '<head><base href="/v7/mode1-bus/"><link rel="stylesheet" href="../shared/board.css">');
        html = html.replace('<script src="ui.js">', '<script src="../shared/levelpack.js"></script><script src="../shared/board.js"></script><script src="/mock/m1-bridge.js"></script><script src="ui.js">');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html);
      }
      if (route === '/__mock/mode') {
        const mode = Number(url.searchParams.get('mode')), dirs = { 1: 'mode1-bus', 2: 'mode2-metro', 3: 'mode3-roads', 4: 'mode4-tod' }, globals = { 1: ['TIDE_DATA', 'Tide'], 2: ['METRO_DATA', 'Metro'], 3: ['ROADS_DATA', 'Roads'], 4: ['TOD_DATA', 'TOD'] };
        if (!dirs[mode]) return json(res, 400, { ok: false });
        let html = fs.readFileSync(path.join(V7, dirs[mode], 'index.html'), 'utf8');
        html = html.replace('<head>', '<head><base href="/v7/' + dirs[mode] + '/"><link rel="stylesheet" href="../shared/board.css">');
        const boot = '<script src="../shared/levelpack.js"></script><script src="../shared/board.js"></script><script src="/mock/mode-bridge.js" data-mode="' + mode + '"></script><script>window.TL_PACK_READY=TLPack.startMode({mode:' + mode + ',D:' + globals[mode][0] + ',E:' + globals[mode][1] + ',ui:"ui.js",demos:["demo-plans.js","demo.js"]});</script>';
        html = html.replace('<script src="ui.js"></script><script src="demo-plans.js"></script><script src="demo.js"></script>', boot);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html);
      }
      if (route.startsWith('/api/')) return json(res, 404, { ok: false });
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { ok: false });
      const relative = route === '/' ? 'tools/mock-board/index.html' : route.startsWith('/mock/') ? 'tools/mock-board/' + decodeURIComponent(route.slice(6)) : decodeURIComponent(route.slice(1));
      const file = path.resolve(ROOT, relative), rel = path.relative(ROOT, file);
      if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { ok: false });
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' }[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime + (mime.startsWith('text/') ? '; charset=utf-8' : '') });
      if (req.method === 'HEAD') return res.end(); fs.createReadStream(file).pipe(res);
    } catch (e) { if (!res.headersSent) json(res, 400, { ok: false, reason: e.message }); else res.end(); }
  });
  return server;
}
module.exports = createServer;
if (require.main === module) {
  const port = Number(process.argv[2] || 8866);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid port');
  const server = createServer(); server.listen(port, '127.0.0.1', () => console.log('Mock board: http://127.0.0.1:' + port + ' (memory only)'));
}
