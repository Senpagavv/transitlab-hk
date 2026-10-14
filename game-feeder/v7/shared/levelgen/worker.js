// v7 · a level request built off the page (2026-10-15): cut the area out of the Hong Kong grid (cut.js), calibrate its
// roads and let the bot find the best plan with mode 3's engine (check.js, bot.js) — the same steps as
// bots/v7_levelgen.js. Message in: {request, seconds}; out: {progress:'cut'|'bot'} then {done, level, report, problems,
// notes, request} or {done, error}. The grid comes from ../../hk/ (so the page must be served, as the sandbox is).
importScripts('../../mode3-roads/data.js', '../../mode3-roads/engine.js', 'cut.js', 'check.js', 'bot.js');
const cache = {};
async function grid(name) { if (!cache[name]) cache[name] = await (await fetch('../../hk/' + name)).json(); return cache[name]; }
// «add» (an absolute number the AI read from the sentence: 50,000 more people) → a % of that place's people or jobs
// in the grid, since the cutter takes percentages
function toPct(base, request) {
  for (const c of request.changes || []) {
    if (c.add === undefined || c.pct !== undefined) continue;
    const key = c.what === 'jobs' ? 'jobs' : 'pop', place = String(c.place);
    const hits = base.zones.filter(z => [z.name, z.hans].some(n => n && (n === place || n.includes(place) || place.includes(n.replace(/站一帶|站一带/, '')))));
    const total = hits.reduce((s, z) => s + (+z[key] || 0), 0);
    c.pct = total > 0 ? Math.max(-50, Math.min(150, Math.round(100 * c.add / total))) : (c.add > 0 ? 30 : -30);
    c.from = { add: c.add, base: Math.round(total) }; delete c.add;
  }
  return request;
}
onmessage = async e => {
  const { request, seconds } = e.data;
  try {
    postMessage({ progress: 'cut' });
    const period = ['am', 'day', 'holiday'].includes(request.period) ? request.period : 'am';   // the cutter has no pm yet
    const base = await grid('hk-base.json'), demand = await grid('hk-demand-' + period + '.json');
    const req = toPct(base, JSON.parse(JSON.stringify({ ...request, period, mode: 3 })));
    const res = LevelCutter.cut(base, demand, req);
    if (!res.level) { postMessage({ done: true, level: null, problems: res.problems, notes: res.notes, request: req }); return; }
    const Engine = self.Roads;
    const calibration = LevelChecker.calibrateRoads(res.level, Engine);
    postMessage({ progress: 'bot' });
    const searched = LevelBot.search(res.level, Engine, seconds || 15);
    const checked = LevelChecker.check(res.level, Engine, searched);
    if (checked.report && checked.report.tiers) res.level.tiers = checked.report.tiers;
    postMessage({ done: true, level: res.level, report: checked.report, problems: res.problems.concat(checked.problems),
      notes: res.notes.concat(calibration.notes || [], checked.notes || []), request: req });
  } catch (err) { postMessage({ done: true, error: String(err && err.message || err) }); }
};
