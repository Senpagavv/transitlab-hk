#!/usr/bin/env node
'use strict';
// No dependencies, no I/O inside engines, no trusting money/year/total from the client.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const V7 = path.resolve(__dirname, '../v7');
const DIR = { m1: 'mode1-bus', m2: 'mode2-metro', m3: 'mode3-roads', m4: 'mode4-tod' };
require(path.join(V7, 'shared/i18n.js'));
const Pack = require(path.join(V7, 'shared/levelpack.js'));
function engine(mode) {
  // Each replay gets fresh P/defaults: a previous custom level cannot change the next score.
  const context = vm.createContext({ console });
  const execute = (file, req) => {
    context.module = { exports: {} }; context.require = req;
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file, timeout: 10000 });
    return context.module.exports;
  };
  const registry = execute(path.join(V7, 'levels/registry.js'));
  const dir = path.join(V7, DIR[mode]), D = execute(path.join(dir, 'data.js'));
  const E = execute(path.join(dir, 'engine.js'), id => { if (id === './data.js') return D; throw new Error('Unexpected engine dependency'); });
  return { E, D, registry };
}
const insist = (yes, why) => { if (!yes) throw new Error(why); };
async function verify(id, input, options = {}) {
  try {
    insist(typeof id === 'string', 'Missing level id');
    const m = /^feeder\/(m[1-4])\/([a-z0-9][a-z0-9-]*)$/.exec(id);
    insist(m, 'Unsupported level id (tl-level/1 supports modes 1–4)');
    insist(input && typeof input === 'object' && !Array.isArray(input), 'Missing plan');
    Pack.canonical(input); // Reject non-finite/non-JSON values.
    const p = input.plan || input, claimed = options.score ?? input.score;
    insist(Number.isFinite(claimed), 'Missing finite claimed score');
    const mode = m[1], key = m[2], { E, D, registry } = engine(mode);
    if (key.startsWith('custom-')) {
      // Backend must pass its own stored/approved pack, never a level supplied inside plan.
      insist(options.pack, 'Custom level must be supplied by the backend');
      const pack = await Pack.prepare(options.pack, true);
      insist(pack.id === key && pack.mode === +mode[1], 'Wrong custom level');
      D.use(pack.level, key);
    } else {
      insist(D.select(key), 'Unknown level');
      if (options.challengeOnly) insist(registry.get(+mode[1], key)?.challenge, 'Teaching level has no leaderboard');
    }
    E.reset();
    const cell = c => Array.isArray(c) && c.length === 2 && c.every(Number.isInteger) && c[0] >= 0 && c[1] >= 0 && c[0] < D.cols && c[1] < D.rows;
    const arr = (a, max, name) => { insist(Array.isArray(a) && a.length <= max, 'Bad ' + name); return a; };
    let score;
    if (mode === 'm1') {
      const g = new E.Game();
      insist(p.seed === undefined || p.seed === g.seed, 'Wrong seed');
      const opening = arr(p.opening, 3, 'opening'); insist(opening.length === 3, 'Three opening stops required');
      for (let i = 0; i < 3; i++) insist(cell(opening[i]) && g.place(i, opening[i]), 'Illegal opening');
      insist(g.start(), 'Cannot start');
      let time = 0;
      for (const a of arr(p.moves || [], 300, 'moves')) {
        insist(a && Number.isFinite(a.time) && a.time >= time && a.time <= E.P.duration && [0, 1, 2].includes(a.id) && cell(a.cell), 'Bad move');
        g.advance(a.time - g.t); time = a.time;
        insist(g.place(a.id, a.cell), 'Illegal move');
      }
      g.advance(E.P.duration - g.t + 1); insist(g.done, 'Incomplete run'); score = g.delivered;
    } else {
      const plan = new E.Plan();
      for (const c of arr(p.line, D.cols * D.rows, 'line')) insist(cell(c) && plan.extend(c), 'Illegal/disconnected/over-budget line');
      for (const c of arr(p.stations, D.cols * D.rows, 'stations')) insist(cell(c) && !plan.isStation(c) && plan.toggleStation(c), 'Illegal/duplicate/over-budget station');
      insist(Number.isInteger(p.trains) && p.trains >= 1 && p.trains <= 10000, 'Bad train count');
      for (let n = 1; n < p.trains; n++) insist(plan.addTrain(), 'Over-budget trains');
      insist(plan.canRun(), 'At least two stations required');
      if (mode === 'm3') {
        while (plan.year < 4) insist(plan.runYear(), 'Incomplete phase one');
        for (const a of arr(p.phase2 || [], D.cols * D.rows + 10000, 'phase2')) {
          insist(a && ['extend', 'station', 'train'].includes(a.type), 'Unknown phase-two action');
          if (a.type !== 'train') insist(cell(a.cell), 'Bad phase-two cell');
          if (a.type === 'extend') insist(plan.extend(a.cell), 'Illegal phase-two extension');
          if (a.type === 'station') insist(!plan.isStation(a.cell) && plan.toggleStation(a.cell), 'Illegal phase-two station');
          if (a.type === 'train') insist(plan.addTrain(), 'Over-budget phase-two train');
        }
        insist(plan.continuePhase2(), 'Cannot open phase two');
      }
      const sales = mode === 'm4' ? arr(p.sales || [], E.P.years * 2, 'sales') : [];
      for (const a of sales) insist(a && cell(a.cell) && ['home', 'shop'].includes(a.use) && Number.isInteger(a.year) && a.year >= 1 && a.year <= E.P.years, 'Bad sale schedule');
      while (!plan.done) {
        for (const a of sales) if (a.year === plan.year + 1) insist(plan.sellLand(a.cell, a.use), 'Illegal land sale');
        insist(plan.runYear(), 'Incomplete run');
      }
      score = plan.total;
    }
    insist(Number.isFinite(score), 'Engine produced invalid score');
    const difference = Math.abs(score - claimed);
    return { ok: difference < 0.5, level: id, score, rounded: Math.round(score), claimed, difference };
  } catch (e) { return { ok: false, level: id, reason: e.message }; }
}
module.exports = verify;
if (require.main === module) {
  (async () => {
    const [id, file, flag, packFile] = process.argv.slice(2);
    if (!id || !file || (flag && (flag !== '--level' || !packFile))) { console.error('usage: node verify-score.js <feeder/mN/key> <plan.json> [--level trusted-pack.tlevel.json]'); process.exitCode = 2; return; }
    try {
      const input = JSON.parse(fs.readFileSync(file, 'utf8'));
      const pack = packFile ? JSON.parse(fs.readFileSync(packFile, 'utf8')) : undefined;
      const out = await verify(id, input, { pack }); console.log(JSON.stringify(out)); process.exitCode = out.ok ? 0 : 1;
    } catch (e) { console.log(JSON.stringify({ ok: false, reason: e.message })); process.exitCode = 1; }
  })();
}
