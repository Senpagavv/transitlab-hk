'use strict';
// Server-side score check for a leaderboard. The page fires `tl:result` when a round ends (see INTEGRATION.md);
// send that event's detail to the server, and before saving it replay the round here: the rules are deterministic,
// so the fixed seed + the opening stops + the moves always give the same score. Anything else was not played.
//   node verify_result.js result.json        → prints {"ok":true,"score":178,...}, exit code 1 if not ok
//   const verify = require('./verify_result.js'); verify(detail).ok
// Needs only data.js and engine.js from this folder (plain Node, no packages).
const E = require('./engine.js');

function verify(r) {
  const { Game, D, P, same } = E;
  const no = reason => ({ ok: false, reason });
  if (!r || typeof r !== 'object') return no('not a result');
  if (!D.levels.includes(r.map)) return no('unknown map');
  if (D.map !== r.map) { D.select(r.map); E.reset(); }
  const cell = c => Array.isArray(c) && c.length === 2 && D.candidates.some(k => same(k, c));
  const moves = Array.isArray(r.moves) ? r.moves : [];
  if (!Array.isArray(r.opening) || r.opening.length !== 3 || !r.opening.every(cell)) return no('bad opening');
  if (moves.length > 300) return no('too many moves');   // breaks are free; the replay refuses extra moves beyond the level's
  if (!moves.every(m => m && cell(m.cell) && [0, 1, 2].includes(m.id) && Number.isFinite(m.time))) return no('bad move');
  const g = new Game();                                            // the page always plays the default seed
  if (r.seed !== undefined && r.seed !== g.seed) return no('wrong seed');
  r.opening.forEach((c, id) => g.place(id, c));
  if (!g.start()) return no('cannot start');
  for (const m of [...moves].sort((a, b) => a.time - b.time)) {
    if (m.time < g.t || m.time > P.duration) return no('bad move time');
    g.advance(m.time - g.t);
    if (!g.place(m.id, m.cell)) return no('move not allowed');
  }
  g.advance(P.duration - g.t + 1);
  const total = D.waves.flat().reduce((a, b) => a + b, 0);
  return { ok: g.delivered === r.score, map: r.map, score: g.delivered, claimed: r.score, total, cars: g.cars, missed: g.missed };
}

module.exports = verify;
if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node verify_result.js result.json'); process.exit(2); }
  const out = verify(JSON.parse(require('node:fs').readFileSync(file, 'utf8')));
  console.log(JSON.stringify(out));
  process.exit(out.ok ? 0 : 1);
}
