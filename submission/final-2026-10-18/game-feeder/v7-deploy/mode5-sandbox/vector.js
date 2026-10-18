(function (root) {
  'use strict';
  // v7 · the sandbox's clean base map (2026-10-15). The first versions drew the 400 m grid as a mosaic of land-use
  // squares with pixel buildings and roads stepping along the cells — busy, and nothing like Hong Kong's real shapes.
  // This draws what the earlier TransitLab map showed: the sea, the land, the 455 zones and 18 districts at their real
  // outlines, the expressways and main roads where they run, the railways as they run (OpenStreetMap) with the stations
  // at their true places
  // (hk/hk-shapes.json and hk-base.json, all in the grid's units, so the sandbox's camera and cells still apply).
  // The grid itself stays out of sight: only the cell under the pointer shows while a line or a station is placed.
  // Population or jobs colour the zones; selected zones are outlined, and «only the selection» fades the rest.
  const S = { ready: false, hover: null, focus: false };
  let Z = [], D = [], coast = null, roadsMain = null, roadsMinor = null, zoneIndex = new Map(), lines = [], rail = [];
  // the grid's own origin (hk-base.json x0 / y_top); hk-shapes.json is written in the same units
  let X0 = 800000, YT = 848000, CELL_M = 400;
  const at = xy => [(xy[0] - X0) / CELL_M, (YT - xy[1]) / CELL_M];
  function ringPath(p, ring) { ring.forEach((q, i) => i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])); p.closePath(); }
  function area(ring) { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]); return Math.abs(a / 2); }
  function load(shapes, base) {
    X0 = base.x0 ?? X0; YT = base.y_top ?? YT; CELL_M = base.cell_m ?? CELL_M;
    if (shapes.y_top !== undefined && (shapes.y_top !== YT || shapes.x0 !== X0)) console.warn('hk-shapes.json and hk-base.json have different origins');
    const byId = new Map((base.zones || []).map((z, i) => [String(z.id), { z, i }]));
    Z = shapes.zones.map(s => {
      const p = new Path2D(); let a = 0, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const r of s.rings) { ringPath(p, r); a += area(r); for (const q of r) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); } }
      const m = byId.get(String(s.id)), km2 = Math.max(.01, a * .16);
      return { id: String(s.id), path: p, idx: m ? m.i : -1, pop: m ? +m.z.pop || 0 : 0, jobs: m ? +m.z.jobs || 0 : 0, km2, box: [x0, y0, x1, y1] };
    });
    zoneIndex = new Map(Z.map(z => [z.idx, z]));
    D = shapes.districts.map(d => { const p = new Path2D(); d.rings.forEach(r => ringPath(p, r)); return { name: d.name, path: p, label: d.label }; });
    coast = new Path2D(); shapes.coast.forEach(r => ringPath(coast, r));
    roadsMain = new Path2D(); roadsMinor = new Path2D();
    for (const r of shapes.roads) { const p = r[4] === 0 ? roadsMain : roadsMinor; p.moveTo(r[0], r[1]); p.lineTo(r[2], r[3]); }
    // the railways as they run (OpenStreetMap), one path a colour and kind; without them, straight lines station to station
    const groups = new Map();
    for (const r of shapes.rail || []) { const key = r.c + '|' + r.k; if (!groups.has(key)) groups.set(key, { color: r.c, kind: r.k, path: new Path2D() });
      const p = groups.get(key).path; r.pts.forEach((q, i) => i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])); }
    rail = [...groups.values()].sort((a, b) => b.kind - a.kind);   // high-speed and Light Rail under the MTR
    const st = new Map((base.stations || []).map(s => [String(s.id), s]));
    lines = (base.lines || []).map(l => ({ color: l.color || '#687c93', pts: (l.stations || []).map(id => st.get(String(id))).filter(Boolean).map(s => s.xy ? at(s.xy) : [s.cell[0] + .5, s.cell[1] + .5]) }));
    S.stations = (base.stations || []).map(s => ({ s, p: s.xy ? at(s.xy) : [s.cell[0] + .5, s.cell[1] + .5] }));
    const maxD = k => Math.max(...Z.map(z => z[k] / z.km2));
    S.maxPop = maxD('pop'); S.maxJobs = maxD('jobs'); S.ready = true;
  }
  const mix = (a, b, t) => '#' + [0, 1, 2].map(i => Math.round(parseInt(a.slice(1 + 2 * i, 3 + 2 * i), 16) * (1 - t) + parseInt(b.slice(1 + 2 * i, 3 + 2 * i), 16) * t).toString(16).padStart(2, '0')).join('');
  // o: {ctx, CELL, camera, tool, layers:{pop, jobs, transit}, selected:[zone index], dark}
  function draw(o) {
    if (!S.ready) return;
    const ctx = o.ctx, k = o.CELL, z = o.camera.zoom, px = 1 / (z * k), dark = !!o.dark;
    const pal = dark ? { sea: '#1d2a31', land: '#262624', zone: 'rgba(255,255,255,.07)', dist: 'rgba(255,255,255,.22)', coast: '#4d6b78', road: '#5b5348', road2: '#463f37', pop: '#4f7a4a', jobs: '#3f6585', sel: '#7fd1b1', fade: 'rgba(29,42,49,.72)' }
      : { sea: '#d9e8ef', land: '#f7f5ef', zone: 'rgba(70,80,70,.12)', dist: 'rgba(70,80,70,.38)', coast: '#9ab7c3', road: '#e2c48f', road2: '#e9dcc3', pop: '#9fc796', jobs: '#9cbad8', sel: '#2b6c58', fade: 'rgba(247,245,239,.78)' };
    ctx.save(); ctx.scale(k, k);
    ctx.fillStyle = pal.sea; ctx.fillRect(-60, -60, 300, 260);
    ctx.fillStyle = pal.land; ctx.fill(coast);
    // population or jobs: each zone tinted by its density (people or jobs a km²)
    const metric = o.layers.pop ? 'pop' : o.layers.jobs ? 'jobs' : null;
    if (metric) {
      const max = metric === 'pop' ? S.maxPop : S.maxJobs, top = metric === 'pop' ? pal.pop : pal.jobs;
      for (const q of Z) { const v = q[metric] / q.km2; if (v <= 0) continue; ctx.fillStyle = mix(pal.land, top, Math.min(1, Math.sqrt(v / max) * 1.15)); ctx.fill(q.path); }
    }
    const sel = new Set(o.selected || []);
    if (S.focus && sel.size) { ctx.fillStyle = pal.fade; for (const q of Z) if (!sel.has(q.idx)) ctx.fill(q.path); }
    if (z * k > 9) { ctx.strokeStyle = pal.zone; ctx.lineWidth = .8 * px; for (const q of Z) ctx.stroke(q.path); }
    ctx.strokeStyle = pal.dist; ctx.lineWidth = 1.1 * px; for (const d of D) ctx.stroke(d.path);
    ctx.strokeStyle = pal.coast; ctx.lineWidth = 1 * px; ctx.stroke(coast);
    // roads: expressways always, main roads once zoomed in a little
    ctx.lineCap = 'round';
    if (z * k > 14) { ctx.strokeStyle = pal.road2; ctx.lineWidth = 1.4 * px; ctx.stroke(roadsMinor); }
    ctx.strokeStyle = pal.road; ctx.lineWidth = (z * k > 14 ? 2.4 : 1.4) * px; ctx.stroke(roadsMain);
    // the MTR through its stations' true places
    if (o.layers.transit) {
      ctx.lineJoin = 'round';
      if (rail.length) for (const g of rail) {
        const w = g.kind === 1 ? 1.6 : g.kind === 2 ? 1.4 : 3;
        if (g.kind === 2) ctx.setLineDash([4 * px, 3 * px]);
        else { ctx.strokeStyle = dark ? '#1b1b1b' : '#ffffff'; ctx.lineWidth = (w + 2) * px; ctx.stroke(g.path); }
        ctx.strokeStyle = g.color; ctx.lineWidth = w * px; ctx.stroke(g.path); ctx.setLineDash([]);
      }
      else for (const l of lines) { if (l.pts.length < 2) continue; ctx.beginPath(); l.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
        ctx.strokeStyle = dark ? '#1b1b1b' : '#ffffff'; ctx.lineWidth = 5 * px; ctx.stroke(); ctx.strokeStyle = l.color; ctx.lineWidth = 3 * px; ctx.stroke(); }
      const r = (z * k > 14 ? 3.4 : 2.2) * px;
      for (const { p } of S.stations) { ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 6.2832); ctx.fillStyle = dark ? '#eee' : '#fff'; ctx.fill(); ctx.strokeStyle = dark ? '#ccc' : '#3d4a52'; ctx.lineWidth = 1.2 * px; ctx.stroke(); }
    }
    // the selection
    if (sel.size) { ctx.strokeStyle = pal.sel; ctx.lineWidth = 2.2 * px; ctx.fillStyle = dark ? 'rgba(127,209,177,.14)' : 'rgba(43,108,88,.12)';
      for (const i of sel) { const q = zoneIndex.get(i); if (q) { ctx.fill(q.path); ctx.stroke(q.path); } } }
    // the one cell under the pointer while drawing a line or placing a station
    if (S.hover && (o.tool === 'line' || o.tool === 'station')) {
      ctx.strokeStyle = dark ? '#ffd27a' : '#c2410c'; ctx.lineWidth = 1.6 * px; ctx.setLineDash([3 * px, 2 * px]);
      ctx.strokeRect(S.hover[0], S.hover[1], 1, 1); ctx.setLineDash([]);
    }
    ctx.restore();
  }
  // the box round some zones (grid units), for zooming onto a selection
  function bounds(indices) {
    let b = null; for (const i of indices) { const q = zoneIndex.get(i); if (!q) continue;
      b = b ? [Math.min(b[0], q.box[0]), Math.min(b[1], q.box[1]), Math.max(b[2], q.box[2]), Math.max(b[3], q.box[3])] : q.box.slice(); }
    return b;
  }
  // the zone whose outline holds a point (grid units), or -1
  let probe = null;
  function zoneAt(x, y) {
    if (!S.ready) return -1;
    if (!probe) probe = document.createElement('canvas').getContext('2d');
    for (const q of Z) if (q.idx >= 0 && x >= q.box[0] && x <= q.box[2] && y >= q.box[1] && y <= q.box[3] && probe.isPointInPath(q.path, x, y)) return q.idx;
    return -1;
  }
  root.SandboxVector = { S, load, draw, bounds, zoneAt, setHover(c) { S.hover = c; } };
})(typeof window !== 'undefined' ? window : globalThis);
