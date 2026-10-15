(function (root) {
  'use strict';
  // v7 · the level editor's bot (2026-10-15). Modes 2–4 share one plan API (extend, shorten, toggleStation, addTrain,
  // simulate …), so one quick local search serves all three, the same moves as bots/v7_metro_grow.js and v7_tod.js:
  // routes through 2–4 of the estates and destinations (L-shaped legs), then extend, shorten, move stations and trains
  // one step at a time, scored on the whole game. Mode 4 then sells land greedily (bots/v7_tod.js «greedy»).
  // Tiers = best × (.40, .65, .88), as for the built-in levels. A rough estimate for whoever draws the level; the final
  // tiers come from the full bots when the level goes into the game. It yields to the page now and then (no worker:
  // the bundled editor runs from a file, where workers are not allowed).
  const tick = () => new Promise(r => setTimeout(r, 0));
  async function estimate(M, level, { seconds = 8, onProgress = () => {}, land = false } = {}) {
    M.D.use(JSON.parse(JSON.stringify(level)), 'editor-bot'); M.reset();
    const { D, Plan } = M, same = M.same, t0 = Date.now(), lineEnd = t0 + seconds * (land ? 400 : 1000), end = t0 + seconds * 1000;
    let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }, pick = a => a[Math.floor(rnd() * a.length)];
    const POI = [...D.origins.map(o => o.cell), ...D.destinations.map(d => d.cell)];
    const total = p => p.stations.length >= 2 ? p.simulate().total : 0;
    const cp = p => { const q = new Plan(); Object.assign(q, JSON.parse(JSON.stringify({ ...p }))); return q; };
    const N4 = c => [[c[0] + 1, c[1]], [c[0] - 1, c[1]], [c[0], c[1] + 1], [c[0], c[1] - 1]];
    const progress = () => onProgress(Math.min(1, (Date.now() - t0) / (seconds * 1000)));
    // a line from a to b, an L (horizontal or vertical first); null if the plan will not take it
    function leg(p, t, hFirst) { let c = p.line.at(-1).slice(), ok = true;
      const stepTo = axis => { while (ok && c[axis] !== t[axis]) { c = c.slice(); c[axis] += Math.sign(t[axis] - c[axis]); if (!p.extend(c)) ok = false; } };
      if (hFirst) { stepTo(0); stepTo(1); } else { stepTo(1); stepTo(0); } return ok; }
    function routePlan() {
      for (let tries = 0; tries < 50; tries++) { const n = 2 + Math.floor(rnd() * 3), pts = [];
        for (let g = 0; g < 30 && pts.length < n; g++) { const c = pick(POI); if (!pts.some(x => same(x, c))) pts.push(c); }
        if (pts.length < 2) return null;
        const p = new Plan(); let ok = p.extend(pts[0]);
        for (let j = 1; j < pts.length && ok; j++) ok = leg(p, pts[j], rnd() < .5);
        if (!ok || p.line.length < 2) continue;
        for (const c of POI) if (p.onLine(c) && p.canStation(c)) p.toggleStation(c);
        if (p.stations.length < 2) continue;
        while (p.canTrain() && rnd() < .5) p.addTrain();
        return p; }
      return null; }
    function moves(p) { const out = [];
      for (const e of [p.line[0], p.line.at(-1)]) if (e) { for (const n of N4(e)) if (p.canExtend(n)) out.push(q => q.extend(n)); if (p.line.length > 2) out.push(q => q.shorten(e)); }
      for (const c of p.line) if (p.isStation(c) || p.canStation(c)) out.push(q => q.toggleStation(c));
      p.line.forEach((c, j) => { if (!p.isStation(c)) return; for (const n of [p.line[j - 1], p.line[j + 1]]) if (n && !p.isStation(n)) out.push(q => { q.toggleStation(c); q.toggleStation(n); }); });
      if (p.canTrain()) out.push(q => q.addTrain()); if (p.canUntrain()) out.push(q => q.removeTrain());
      return out; }
    // the simplest line: two of the places, one train
    let simple = 0;
    for (let i = 0; i < POI.length; i++) for (let j = i + 1; j < POI.length; j++) for (const h of [true, false]) {
      const p = new Plan(); if (!p.extend(POI[i]) || !leg(p, POI[j], h)) continue;
      for (const c of [POI[i], POI[j]]) if (p.canStation(c)) p.toggleStation(c);
      if (p.stations.length === 2) simple = Math.max(simple, total(p)); }
    await tick();
    let best = null, restarts = 0; const found = new Map();   // the distinct local optima, for mode 4's land
    while (Date.now() < lineEnd) {
      let p = routePlan(); if (!p) break; let s = total(p); restarts++;
      for (let it = 0; it < 200 && Date.now() < lineEnd; it++) {
        let next = null, ns = s;
        for (const m of moves(p)) { const q = cp(p); m(q); if (q.stations.length < 2) continue; const v = total(q); if (v > ns + 1e-9) { ns = v; next = q; } }
        if (!next) break; p = next; s = ns; if (it % 3 === 2) { progress(); await tick(); } }
      if (!best || s > best.s) best = { p, s };
      const k = JSON.stringify([p.line, p.stations, p.trains]); if (!found.has(k)) found.set(k, { p, s });
      progress(); await tick(); }
    if (!best) return { best: 0, simple: Math.round(simple), tiers: [0, 0, 0], plan: null, restarts, seconds: (Date.now() - t0) / 1000 };
    let actions = [], score = best.s, base = best.p;
    // mode 4: sell land greedily, two lots a year at most (bots/v7_tod.js «greedy»), on the three best lines, homes only,
    // shops only and both — the line that is best without land is not always best with it
    if (land && D.land && D.land.length) {
      const sell = (line, allowed) => {
        const cells = D.land.filter(q => !line.line.some(c => same(c, q.cell)) && !!M.landStation(line.stations, line.line, q.cell)).map(q => q.cell);
        const fresh = () => { const p = new Plan(); p.line = line.line.map(c => c.slice()); p.stations = line.stations.map(c => c.slice()); p.trains = line.trains; p.money = line.money; return p; };
        const run = acts => { const p = fresh(); for (let y = 0; y < M.P.years; y++) { const day = acts.filter(a => a.year === y); if (day.length > 2) return -Infinity;   // two lots a year at most
          for (const a of day) if (!p.sellLand(a.cell, a.use)) return -Infinity; if (!p.runYear()) return -Infinity; } return p.total; };
        let acts = [], v0 = run([]);
        for (let y = 0; y < M.P.years && Date.now() < end; y++) for (let slot = 0; slot < 2; slot++) {
          let chosen = null, cs = v0;
          for (const cell of cells) for (const use of allowed) { if (acts.some(a => same(a.cell, cell))) continue;
            const trial = acts.concat({ cell, use, year: y }), v = run(trial); if (v > cs + 1e-7) { cs = v; chosen = trial; } }
          if (chosen) { acts = chosen; v0 = cs; } }
        return { acts, v: v0, cells, run }; };
      // then move one sale at a time to another lot, year or use while it helps (bots/v7_tod.js «local»)
      const polish = async (r, allowed) => { let { acts, v } = r;
        for (let round = 0; round < 7 && Date.now() < end; round++) { let next = null, nv = v;
          for (let i = 0; i < acts.length && Date.now() < end; i++) { for (const cell of r.cells) for (let y = 0; y < M.P.years; y++) for (const use of allowed) {
              if (acts.some((a, j) => j !== i && same(a.cell, cell))) continue;
              const trial = acts.map((a, j) => j === i ? { cell, use, year: y } : a), w = r.run(trial); if (w > nv + 1e-7) { nv = w; next = trial; } }
            progress(); await tick(); }
          if (!next) break; acts = next; v = nv; }
        return { acts, v }; };
      // greedy on the ten best lines (each with homes, shops, both), then polish the best three of those
      const tried = [];
      for (const l of [...found.values()].sort((a, b) => b.s - a.s).slice(0, 10)) for (const allowed of [['home', 'shop'], ['home'], ['shop']]) {
        if (Date.now() >= end) break; tried.push({ l, allowed, r: sell(l.p, allowed) }); progress(); await tick(); }
      tried.sort((a, b) => b.r.v - a.r.v);
      for (const x of tried.slice(0, 3)) { if (Date.now() >= end) break;
        const r = await polish(x.r, x.allowed); if (r.v > score) { score = r.v; actions = r.acts; base = x.l.p; } }
    }
    const b = Math.round(score);
    return { best: b, simple: Math.round(simple), tiers: [.4, .65, .88].map(f => Math.round(b * f)), restarts, seconds: (Date.now() - t0) / 1000,
      plan: { line: base.line, stations: base.stations, trains: base.trains, actions } };
  }
  const API = { estimate };
  if (typeof module !== 'undefined') module.exports = API; root.TLEditorBot = API;
})(typeof window !== 'undefined' ? window : globalThis);
