/* TransitLab HK · mode 5 sandbox engine
 * Pure model code: no DOM, network, canvas, or browser globals are required.
 * Coordinates and travel times are grid based; 1 grid = 2.5 minutes.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SandboxEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CELL_MIN = 2.5;
  const WALK_PER_CELL = 2;
  const WAIT = 2;
  const MAX_WALK = 6;
  const CAR_OCCUPANCY = 1.3;
  const LEARN = 0.3;
  const EPS = 1e-9;
  const defaults = { line: 1, station: 3, train: 4, budget: 300 };
  const coord = c => Array.isArray(c) ? [Number(c[0]), Number(c[1])] : [Number(c && c.c), Number(c && c.r)];
  const cellKey = c => { const q = coord(c); return `${q[0]},${q[1]}`; };
  const manhattan = (a, b) => { const x = coord(a), y = coord(b); return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]); };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const safe = x => Number.isFinite(Number(x)) ? Number(x) : 0;
  const minutes = x => x === null || x === undefined || !Number.isFinite(Number(x)) ? null : Math.max(0, Number(x));

  function landAt(base, c) {
    const [x, y] = coord(c);
    if (x < 0 || y < 0 || x >= base.cols || y >= base.rows) return '~';
    if (!base.land) return '.';
    const ch = base.land[y * base.cols + x] || '.';
    return ch;
  }
  function walkable(base, c) { return !['~', 'w'].includes(landAt(base, c)); }
  function adjacentCells(c) {
    const [x, y] = coord(c);
    return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
  }

  class MinHeap {
    constructor() { this.a = []; }
    push(item, score) {
      const a = this.a, node = { item, score }; a.push(node);
      let i = a.length - 1;
      while (i) { const p = (i - 1) >> 1; if (a[p].score <= score) break; a[i] = a[p]; i = p; }
      a[i] = node;
    }
    pop() {
      const a = this.a; if (!a.length) return null;
      const top = a[0], last = a.pop();
      if (a.length) {
        let i = 0;
        while (true) {
          const l = i * 2 + 1, r = l + 1;
          if (l >= a.length) break;
          const c = r < a.length && a[r].score < a[l].score ? r : l;
          if (a[c].score >= last.score) break;
          a[i] = a[c]; i = c;
        }
        a[i] = last;
      }
      return top;
    }
    get size() { return this.a.length; }
  }

  function nearestRoadNode(cell, nodes) {
    if (!nodes.length) return null;
    let best = null, bestD = Infinity;
    for (const k of nodes) {
      const [x, y] = k.split(',').map(Number), d = Math.abs(x - cell[0]) + Math.abs(y - cell[1]);
      if (d < bestD) { best = k; bestD = d; if (!d) break; }
    }
    return best;
  }

  function buildRoadGraph(base, sectionRows) {
    const secById = new Map(), roadNames = new Map((base.roads || []).map(r => [String(r.id), r.name || r.en || '']));
    for (let i = 0; i < (base.sections || []).length; i++) {
      const s = base.sections[i], id = s.id === undefined ? i : s.id;
      const row = sectionRows.get(String(id));
      const cap = Math.max(1e-6, safe(s.cap || s.capacity || (s.am && s.am.cap) || 1));
      const load = Math.max(0, safe(row ? row.load : (s.am && s.am.load) || s.load0 || 0));
      secById.set(String(id), { id, cap, load, road: s.road, a: coord(s.a), b: coord(s.b), name: s.name || roadNames.get(String(s.road)) || '' });
    }
    const graph = new Map();
    const add = (a, b, idx, section) => {
      const ka = cellKey(a), kb = cellKey(b);
      if (!graph.has(ka)) graph.set(ka, []);
      if (!graph.has(kb)) graph.set(kb, []);
      const extra = (section.load / section.cap) ** 2;
      const edge = { to: kb, section: idx, cost: 1 + extra };
      const back = { to: ka, section: idx, cost: 1 + extra };
      graph.get(ka).push(edge); graph.get(kb).push(back);
    };
    if ((base.sections || []).length) {
      (base.sections || []).forEach((s, i) => {
        const id = s.id === undefined ? i : s.id, sec = secById.get(String(id));
        if (sec) add(sec.a, sec.b, i, sec);
      });
    } else {
      (base.roads || []).forEach((road, ri) => {
        const cells = road.cells || [];
        for (let i = 0; i + 1 < cells.length; i++) {
          const id = `${road.id || ri}:${i}`;
          const sec = { id, cap: Math.max(1, safe(road.cap) || 1), load: 0, road: road.id || ri, name: road.name || '' };
          secById.set(String(id), sec); add(cells[i], cells[i + 1], secById.size - 1, sec);
        }
      });
    }
    return { graph, sections: Array.from(secById.values()), secById };
  }

  function shortestRoadTree(graph, start) {
    const dist = new Map([[start, 0]]), prev = new Map(), heap = new MinHeap();
    heap.push(start, 0);
    while (heap.size) {
      const cur = heap.pop(), u = cur.item;
      if (cur.score > (dist.get(u) ?? Infinity) + EPS) continue;
      for (const e of graph.get(u) || []) {
        const nd = cur.score + e.cost;
        if (nd + EPS < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd); prev.set(e.to, { node: u, section: e.section }); heap.push(e.to, nd);
        }
      }
    }
    return { start, dist, prev };
  }

  function reconstructRoadPath(tree, finish) {
    if (!tree || !tree.dist.has(finish) || finish === tree.start) return [];
    const path = []; let at = finish;
    while (at !== tree.start) { const p = tree.prev.get(at); if (!p) return []; path.push(p.section); at = p.node; }
    return path.reverse();
  }

  function precomputeRoadPaths(base, pairs, road) {
    const nodes = Array.from(road.graph.keys()), trees = new Map(), nearest = new Map(), paths = new Map();
    const RouteArray = road.sections.length < 65536 ? Uint16Array : Uint32Array;
    const near = cell => {
      const key = cellKey(cell);
      if (!nearest.has(key)) nearest.set(key, nearestRoadNode(cell, nodes));
      return nearest.get(key);
    };
    return pairs.map(pair => {
      const source = near(pair.fromCell), target = near(pair.toCell);
      if (!source || !target) return new RouteArray(0);
      const key = source + '>' + target;
      if (!paths.has(key)) {
        if (!trees.has(source)) trees.set(source, shortestRoadTree(road.graph, source));
        paths.set(key, RouteArray.from(reconstructRoadPath(trees.get(source), target)));
      }
      return paths.get(key);
    });
  }

  function landDistance(base, from, to, limit) {
    const start = coord(from), end = coord(to), startKey = cellKey(start), endKey = cellKey(end);
    if (!walkable(base, start) || !walkable(base, end)) return Infinity;
    if (startKey === endKey) return 0;
    const queue = [[start, 0]], seen = new Set([startKey]);
    for (let head = 0; head < queue.length; head++) {
      const [p, distance] = queue[head];
      if (distance >= limit) continue;
      for (const next of adjacentCells(p)) {
        if (!walkable(base, next)) continue;
        const key = cellKey(next); if (seen.has(key)) continue;
        if (key === endKey) return distance + 1;
        seen.add(key); queue.push([next, distance + 1]);
      }
    }
    return Infinity;
  }

  function stationCell(st, idMap) {
    if (Array.isArray(st)) return coord(st);
    if (st && st.cell) return coord(st.cell);
    const id = String(st && (st.id || st.station || st));
    const found = idMap.get(id);
    return found ? coord(found.cell) : null;
  }

  function buildMetro(base, plan) {
    const stationRows = base.stations || [], idMap = new Map(stationRows.map(s => [String(s.id), s]));
    const nodes = [], byKey = new Map(), edges = [];
    const addNode = (id, cell, isNew) => {
      let index = byKey.get(id);
      if (index !== undefined) { if (isNew) nodes[index].isNew = true; return index; }
      index = nodes.length; byKey.set(id, index); nodes.push({ id, cell: coord(cell), isNew: !!isNew }); return index;
    };
    const addEdge = (a, b, cost, isNew, isRide = true) => { if (a === b || !Number.isFinite(cost)) return; edges.push({ a, b, cost, isNew: !!isNew, isRide }); };
    const lineStations = (line, isNew, li) => {
      const ids = line.stations || [];
      const cells = line.cells || [];
      const cellPosition = new Map(cells.map((c, i) => [cellKey(c), i]));
      let cursor = 0;
      const entries = ids.map((s, si) => {
        if (isNew) {
          const c = stationCell(s, idMap); if (!c) return null;
          const id = `new:${li}:${si}`; return { id, cell: c, index: cellPosition.get(cellKey(c)) };
        }
        const id = typeof s === 'object' ? String(s.id || `old:${li}:${si}`) : String(s);
        const st = typeof s === 'object' ? s : idMap.get(id);
        const c = st && st.cell ? coord(st.cell) : stationCell(s, idMap);
        if (!c) return null;
        let index;
        for (let position = cursor; position < cells.length; position++) if (cellKey(cells[position]) === cellKey(c)) {
          index = position; cursor = position; break;
        }
        return { id, cell: c, index };
      }).filter(Boolean);
      const indexed = entries.map(e => ({ ...e, node: addNode(e.id, e.cell, isNew) }));
      if (isNew) indexed.sort((a, b) => (a.index === undefined ? Infinity : a.index) - (b.index === undefined ? Infinity : b.index));
      for (let i = 0; i + 1 < indexed.length; i++) {
        const a = indexed[i], b = indexed[i + 1];
        const cellsApart = a.index !== undefined && b.index !== undefined ? Math.abs(b.index - a.index) : manhattan(a.cell, b.cell);
        const trains = isNew ? safe(line.trains) : safe(line.trains_per_hour || line.trains || 1);
        if (trains > 0) addEdge(a.node, b.node, Math.max(1, cellsApart) + 1, isNew);
      }
      return indexed;
    };
    const allStations = [];
    (base.lines || []).forEach((line, li) => allStations.push(...lineStations(line, false, li)));
    (plan.lines || []).forEach((line, li) => {
      if (safe(line.trains) > 0) allStations.push(...lineStations(line, true, li));
    });
    // New stations within one grid cell are walk-and-wait transfers. Existing shared station IDs already share a node.
    for (let i = 0; i < allStations.length; i++) for (let j = i + 1; j < allStations.length; j++) {
      const a = allStations[i], b = allStations[j];
      if (a.node === b.node || (!nodes[a.node].isNew && !nodes[b.node].isNew)) continue;
      const d = manhattan(a.cell, b.cell);
      if (d <= 1) addEdge(a.node, b.node, d * WALK_PER_CELL + WAIT, false, false);
    }
    const n = nodes.length, dist = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 0 : Infinity));
    const usedNew = Array.from({ length: n }, () => new Uint8Array(n));
    for (const e of edges) {
      if (e.cost < dist[e.a][e.b] || (e.cost === dist[e.a][e.b] && !e.isNew)) {
        dist[e.a][e.b] = dist[e.b][e.a] = e.cost;
        usedNew[e.a][e.b] = usedNew[e.b][e.a] = Number(e.isNew);
      }
    }
    for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
      if (!Number.isFinite(dist[i][k])) continue;
      for (let j = 0; j < n; j++) {
        const d = dist[i][k] + dist[k][j], usesNew = usedNew[i][k] || usedNew[k][j];
        if (d < dist[i][j] || (d === dist[i][j] && !usesNew)) {
          dist[i][j] = d; usedNew[i][j] = Number(usesNew);
        }
      }
    }
    // A metro itinerary must include a train segment; walking through a station is not a rail trip.
    const rideDist = Array.from({ length: n }, () => new Float64Array(n).fill(Infinity));
    const rideNew = Array.from({ length: n }, () => new Uint8Array(n));
    for (const edge of edges) if (edge.isRide) {
      for (const [a, b] of [[edge.a, edge.b], [edge.b, edge.a]]) {
        for (let s = 0; s < n; s++) for (let t = 0; t < n; t++) {
          if (s === t) continue;
          const value = dist[s][a] + edge.cost + dist[b][t];
          const usesNew = usedNew[s][a] || edge.isNew || usedNew[b][t];
          if (value < rideDist[s][t] || (value === rideDist[s][t] && !usesNew)) {
            rideDist[s][t] = value; rideNew[s][t] = Number(usesNew);
          }
        }
      }
    }
    return { nodes, dist: rideDist, usedNew: rideNew, allStations };
  }

  function buildMetroZoneLookup(base, metro) {
    const n = metro.nodes.length, zones = base.zones || [];
    // One bounded land BFS per origin, instead of one per origin/station pair.
    // Distances remain the same integers, including the six-cell detour limit.
    const integerCells = zones.every(z => z.cell.every(Number.isInteger)) && metro.nodes.every(s => s.cell.every(Number.isInteger));
    const access = zones.map(z => {
      if (!integerCells) return metro.nodes.map(s => landDistance(base, z.cell, s.cell, MAX_WALK));
      const size = base.cols * base.rows, distances = new Int16Array(size).fill(-1), queue = new Int32Array(size);
      const [x, y] = z.cell;
      if (!walkable(base, z.cell)) return metro.nodes.map(() => Infinity);
      const start = y * base.cols + x; let head = 0, tail = 1; queue[0] = start; distances[start] = 0;
      while (head < tail) {
        const at = queue[head++], d = distances[at]; if (d >= MAX_WALK) continue;
        const cx = at % base.cols, cy = Math.floor(at / base.cols);
        for (const next of [cx > 0 ? at - 1 : -1, cx + 1 < base.cols ? at + 1 : -1, cy > 0 ? at - base.cols : -1, cy + 1 < base.rows ? at + base.cols : -1]) {
          if (next < 0 || distances[next] >= 0 || ['~', 'w'].includes((base.land || '')[next])) continue;
          distances[next] = d + 1; queue[tail++] = next;
        }
      }
      return metro.nodes.map(s => {
        const [sx, sy] = s.cell;
        if (sx < 0 || sy < 0 || sx >= base.cols || sy >= base.rows) return Infinity;
        const d = distances[sy * base.cols + sx]; return d < 0 ? Infinity : d;
      });
    });
    const costs = Array.from({ length: zones.length }, () => new Float64Array(zones.length).fill(Infinity));
    const usedNew = Array.from({ length: zones.length }, () => new Uint8Array(zones.length));
    for (let oi = 0; oi < zones.length; oi++) {
      const from = new Float64Array(n).fill(Infinity), fromNew = new Uint8Array(n), walk = access[oi];
      for (let s = 0; s < n; s++) if (walk[s] <= MAX_WALK) {
        const start = walk[s] * WALK_PER_CELL + WAIT;
        for (let t = 0; t < n; t++) {
          const value = start + metro.dist[s][t], usesNew = metro.usedNew[s][t];
          if (value < from[t] || (value === from[t] && !usesNew)) {
            from[t] = value; fromNew[t] = usesNew;
          }
        }
      }
      for (let di = 0; di < zones.length; di++) {
        let best = Infinity, bestNew = 0;
        for (let t = 0; t < n; t++) if (access[di][t] <= MAX_WALK) {
          const value = from[t] + access[di][t] * WALK_PER_CELL;
          if (value < best || (value === best && !fromNew[t])) { best = value; bestNew = fromNew[t]; }
        }
        costs[oi][di] = best; usedNew[oi][di] = bestNew;
      }
    }
    return { costs, usedNew };
  }

  function normalizePair(raw, index, demand, zoneMap, base) {
    let zi, zj, car, pt, carMin, ptMin, walkMin;
    if (Array.isArray(raw)) [zi, zj, car, pt, carMin, ptMin, walkMin] = raw;
    else ({ i: zi, j: zj, car, pt, carMin, ptMin, walkMin } = raw);
    const ids = demand.zones || [];
    const idI = typeof zi === 'number' ? ids[zi] : zi;
    const idJ = typeof zj === 'number' ? ids[zj] : zj;
    const i = zoneMap.get(String(idI)), j = zoneMap.get(String(idJ));
    if (!Number.isInteger(i) || !Number.isInteger(j)) throw new Error('demand pair ' + index + ' references an unknown zone');
    const from = base.zones[i], to = base.zones[j];
    if (!from || !to || !from.cell || !to.cell) throw new Error('demand pair ' + index + ' has no zone coordinates');
    return {
      index, i, j, fromCell: coord(from.cell), toCell: coord(to.cell),
      car0: Math.max(0, safe(car)), pt0: Math.max(0, safe(pt)),
      carMin: minutes(carMin), ptMin: minutes(ptMin), walkMin: minutes(walkMin),
      hasMinutes: minutes(carMin) !== null && minutes(ptMin) !== null
    };
  }

  function prepare(base, demand) {
    if (!base || !demand || !Array.isArray(base.zones) || !Array.isArray(demand.pairs)) throw new Error('base.zones and demand.pairs are required');
    const zoneMap = new Map(base.zones.map((z, i) => [String(z.id), i]));
    const pairs = demand.pairs.map((p, i) => normalizePair(p, i, demand, zoneMap, base));
    const sectionRows = new Map((demand.sections || []).map(s => Array.isArray(s) ? [String(s[0]), { load: safe(s[1]), vc: safe(s[2]) }] : [String(s.id), s]));
    const road = buildRoadGraph(base, sectionRows);
    const routes = precomputeRoadPaths(base, pairs, road);
    const metro0 = buildMetro(base, { lines: [] });
    const metro0Costs = buildMetroZoneLookup(base, metro0).costs;
    const zoneRail = pairs.map(p => {
      const d = metro0Costs[p.i] && metro0Costs[p.i][p.j];
      const fallback = p.ptMin === null ? Infinity : p.ptMin / CELL_MIN;
      return Number.isFinite(d) ? d : fallback;
    });
    const sections = road.sections.map((s, i) => ({ ...s, i, extra0: (s.load / s.cap) ** 2 }));
    const pairTotals = pairs.map(p => p.car0 + p.pt0);
    const baseCar = pairs.reduce((n, p) => n + p.car0, 0), basePt = pairs.reduce((n, p) => n + p.pt0, 0);
    const baseCongestion = sections.reduce((n, s) => n + s.load * s.extra0, 0);
    const basePeopleMinutes = pairs.reduce((n, p) => n + (p.hasMinutes ? p.car0 * p.carMin + p.pt0 * p.ptMin : 0), 0);
    const peopleWithMinutes = pairs.reduce((n, p) => n + (p.hasMinutes ? p.car0 + p.pt0 : 0), 0);
    return { base, demand, pairs, routes, sections, road, metro0, zoneRail, pairTotals, baseCar, basePt, baseCongestion, basePeopleMinutes, peopleWithMinutes, zoneMap };
  }

  function planCosts(plan) {
    const value = plan && plan.budget;
    const budget = value !== undefined && value !== null && Number.isFinite(Number(value))
      ? Math.max(0, Number(value)) : defaults.budget;
    return { ...defaults, ...(plan && plan.costs || {}), budget };
  }
  function planCost(plan) {
    const costs = planCosts(plan);
    let cells = 0, stations = 0, trains = 0;
    for (const line of (plan && plan.lines) || []) { cells += (line.cells || []).length; stations += (line.stations || []).length; trains += Math.max(0, Math.floor(safe(line.trains))); }
    return { cells, stations, trains, total: cells * costs.line + stations * costs.station + trains * costs.train, budget: costs.budget };
  }
  function validatePlan(base, plan) {
    const errors = [], costs = planCosts(plan), cost = planCost(plan), oldStations = base.stations || [];
    (plan.lines || []).forEach((line, li) => {
      const cells = (line.cells || []).map(coord), seen = new Set();
      if (!cells.length && (line.stations || []).length) errors.push(`line ${li + 1}: station without track`);
      cells.forEach((c, i) => {
        const k = cellKey(c);
        if (!c.every(Number.isInteger)) errors.push(`line ${li + 1}: cell coordinates must be integers`);
        if (c[0] < 0 || c[1] < 0 || c[0] >= base.cols || c[1] >= base.rows) errors.push(`line ${li + 1}: cell outside the map`);
        if (!walkable(base, c)) errors.push(`line ${li + 1}: track crosses water at ${k}`);
        if (seen.has(k)) errors.push(`line ${li + 1}: track repeats cell ${k}`);
        seen.add(k);
        if (i && manhattan(cells[i - 1], c) !== 1) errors.push(`line ${li + 1}: track is not 4-connected`);
      });
      const pathKeys = new Set(cells.map(cellKey));
      for (const c of cells) {
        const degree = adjacentCells(c).filter(n => pathKeys.has(cellKey(n))).length;
        if (degree > 2) { errors.push('line ' + (li + 1) + ': track branches'); break; }
      }
      if (cells.length > 2 && manhattan(cells[0], cells[cells.length - 1]) === 1) errors.push('line ' + (li + 1) + ': track cannot loop back to its start');
      for (const st of (line.stations || [])) {
        const c = stationCell(st, new Map());
        if (!c || !seen.has(cellKey(c))) errors.push(`line ${li + 1}: station must sit on its line`);
      }
      if (!Number.isInteger(Number(line.trains)) || Number(line.trains) < 0) errors.push(`line ${li + 1}: trains must be a non-negative integer`);
    });
    if (cost.total > costs.budget + EPS) errors.push(`budget exceeded (${cost.total} / ${costs.budget})`);
    const transfers = [];
    (plan.lines || []).forEach((line, li) => (line.stations || []).forEach((st, si) => {
      const c = stationCell(st, new Map());
      if (!c) return;
      const d = oldStations.reduce((best, old) => Math.min(best, manhattan(c, old.cell)), Infinity);
      if (d <= 1) transfers.push({ line: li, station: si, distance: d });
    }));
    return { valid: errors.length === 0, errors, cost, remaining: costs.budget - cost.total, transfers };
  }

  function signature(plan) { return JSON.stringify((plan && plan.lines || []).map(l => [l.cells || [], l.stations || [], l.trains || 0])); }

  function transitBenefits(prepared, plan) {
    if (!((plan && plan.lines) || []).some(line => safe(line.trains) > 0 && (line.stations || []).length)) {
      return prepared.pairs.map((p, i) => ({ d: 0, oldRail: prepared.zoneRail[i], newRail: prepared.zoneRail[i], usesNew: false }));
    }
    const metro = buildMetro(prepared.base, plan || { lines: [] });
    const lookup = buildMetroZoneLookup(prepared.base, metro), costs = lookup.costs;
    return prepared.pairs.map((p, i) => {
      const ptBaseGrid = p.ptMin === null ? Infinity : p.ptMin / CELL_MIN;
      const oldRail = prepared.zoneRail[i];
      const newRailRaw = costs[p.i] && costs[p.i][p.j];
      const newRail = Number.isFinite(newRailRaw) ? newRailRaw : ptBaseGrid;
      const d = Number.isFinite(oldRail) && Number.isFinite(newRail) ? Math.max(0, oldRail - newRail) : 0;
      return { d, oldRail, newRail, usesNew: d > EPS && !!lookup.usedNew[p.i][p.j] };
    });
  }

  function createState(prepared, plan) {
    const benefits = transitBenefits(prepared, plan || { lines: [] });
    return {
      planKey: signature(plan), round: 0, perceived: prepared.sections.map(s => s.extra0),
      previousCar: prepared.baseCar, changes: [], carShares: prepared.pairs.map(p => p.car0 + p.pt0 ? p.car0 / (p.car0 + p.pt0) : 0),
      benefits, rows: [], stable: false, last: null
    };
  }

  function shareByZone(prepared, shares) {
    const pop = prepared.base.zones.map(() => [0, 0]);
    prepared.pairs.forEach((p, i) => { const total = prepared.pairTotals[i]; pop[p.i][0] += total * shares[i]; pop[p.i][1] += total; });
    return pop.map(([car, total]) => total ? car / total : 0);
  }

  function explicitStep(prepared, plan, state) {
    const key = signature(plan);
    if (!state || state.planKey !== key) state = createState(prepared, plan);
    const secDelta = prepared.sections.map(() => 0), shares = [], carFlows = [], ptFlows = [], cByPair = [];
    for (let i = 0; i < prepared.pairs.length; i++) {
      const p = prepared.pairs[i], route = prepared.routes[i];
      let c = 0;
      for (let j=0;j<route.length;j++) { const si=route[j], s = prepared.sections[si]; if (s) c += s.extra0 - state.perceived[si]; }
      const d = state.benefits[i].d, total = prepared.pairTotals[i];
      const baseShare = total ? p.car0 / total : 0;
      const share = clamp(baseShare - 0.1 * (d - c), 0, 1);
      const car = share === baseShare ? p.car0 : total * share, pt = share === baseShare ? p.pt0 : total - car;
      shares.push(share); carFlows.push(car); ptFlows.push(pt); cByPair.push(c);
      const vehicleDelta = (car - p.car0) / CAR_OCCUPANCY;
      for (let j=0;j<route.length;j++) { const si=route[j]; if (prepared.sections[si]) secDelta[si] += vehicleDelta; }
    }
    const loads = prepared.sections.map((s, i) => Math.max(0, s.load + secDelta[i]));
    const actual = prepared.sections.map((s, i) => (loads[i] / s.cap) ** 2);
    const perceived = state.perceived.map((p, i) => p + LEARN * (actual[i] - p));
    const carTotal = carFlows.reduce((a, b) => a + b, 0), ptTotal = ptFlows.reduce((a, b) => a + b, 0);
    const deltaPct = state.previousCar > 0 ? Math.abs(carTotal - state.previousCar) / state.previousCar : (carTotal > 0 ? 1 : 0);
    const changes = [...state.changes, deltaPct].slice(-5);
    const roundNo = state.round + 1;
    const congestion = loads.reduce((sum, load, i) => sum + load * actual[i], 0);
    const switchedToTransit = ptFlows.reduce((sum, value, i) => sum + Math.max(0, value - prepared.pairs[i].pt0), 0);
    const newLineRiders = ptFlows.reduce((sum, value, i) => sum + (state.benefits[i].usesNew ? value : 0), 0);
    const personMinutesSaved = prepared.pairs.reduce((sum, p, i) => {
      if (!p.hasMinutes) return sum;
      const carMin = Math.max(0, p.carMin - cByPair[i] * CELL_MIN);
      const ptMin = Math.max(0, p.ptMin - state.benefits[i].d * CELL_MIN);
      return sum + (p.car0 - carFlows[i]) * p.carMin + (p.pt0 - ptFlows[i]) * p.ptMin
        + carFlows[i] * (p.carMin - carMin) + ptFlows[i] * (p.ptMin - ptMin);
    }, 0);
    const sectionChanges = prepared.sections.map((s, i) => ({
      id: s.id, name: s.name || `Section ${s.id}`,
      road: s.road, load0: s.load, load: loads[i], cap: s.cap, vc0: s.load / s.cap, vc: loads[i] / s.cap,
      extra0: s.extra0, extra: actual[i], change: loads[i] - s.load
    })).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 5);
    const metrics = {
      carPeople: carTotal, ptPeople: ptTotal, carShare: (carTotal + ptTotal) ? carTotal / (carTotal + ptTotal) : 0,
      baseCarPeople: prepared.baseCar, basePtPeople: prepared.basePt,
      newLineRiders, switchedToTransit,
      vehiclesReduced: (prepared.baseCar - carTotal) / CAR_OCCUPANCY,
      congestion, baseCongestion: prepared.baseCongestion, congestionReduced: prepared.baseCongestion - congestion,
      personMinutesSaved,
      personMinutesCoverage: prepared.baseCar + prepared.basePt ? prepared.peopleWithMinutes / (prepared.baseCar + prepared.basePt) : 1,
      personMinutesExcluded: prepared.baseCar + prepared.basePt - prepared.peopleWithMinutes,
      zoneCarShare: shareByZone(prepared, shares), sectionChanges,
      sectionLoads: loads, sectionExtras: actual
    };
    const stable = roundNo >= 5 && changes.length === 5 && changes.every(v => v < 0.005);
    const row = { round: roundNo, newLineRiders, vehiclesReduced: metrics.vehiclesReduced, congestionReduced: metrics.congestionReduced, carShare: metrics.carShare, changePct: deltaPct, stable };
    const next = { ...state, round: roundNo, perceived, previousCar: carTotal, changes, carShares: shares, rows: [...state.rows, row], stable, last: metrics };
    return { state: next, row, metrics };
  }

  // User-approved 2026-10-15: same-round implicit feedback retains LEARN=0.3.
  const norm = vector => { let result = 0; for (const value of vector) result = Math.max(result, Math.abs(value)); return result; };
  const dot = (a,b) => { let result = 0; for (let i=0;i<a.length;i++) result += a[i]*b[i]; return result; };

  function linearSolve(matvec, rhs, diagonal, tolerance) {
    const n=rhs.length, x=new Float64Array(n), r=Float64Array.from(rhs), shadow=Float64Array.from(rhs);
    const p=new Float64Array(n); let v=new Float64Array(n), rhoOld=1, alpha=1, omega=1;
    let iterations=0;
    for (;iterations<60;iterations++) {
      if (norm(r)<=tolerance) break;
      const rho=dot(shadow,r); if (Math.abs(rho)<1e-30) break;
      const beta=(rho/rhoOld)*(alpha/omega);
      for(let i=0;i<n;i++) p[i]=r[i]+beta*(p[i]-omega*v[i]);
      const ph=Float64Array.from(p,(value,i)=>value/diagonal[i]);
      v=matvec(ph); const denominator=dot(shadow,v); if(Math.abs(denominator)<1e-30)break;
      alpha=rho/denominator;
      const s=Float64Array.from(r,(value,i)=>value-alpha*v[i]);
      if(norm(s)<=tolerance){for(let i=0;i<n;i++)x[i]+=alpha*ph[i];iterations++;break;}
      const sh=Float64Array.from(s,(value,i)=>value/diagonal[i]), t=matvec(sh), tt=dot(t,t);
      if(tt<1e-30)break;
      omega=dot(t,s)/tt;
      for(let i=0;i<n;i++){x[i]+=alpha*ph[i]+omega*sh[i];r[i]=s[i]-omega*t[i];}
      if(Math.abs(omega)<1e-30)break;
      rhoOld=rho;
    }
    return {x,iterations};
  }

  function implicitStep(prepared, plan, state) {
    if (!state || state.planKey !== signature(plan)) state=createState(prepared,plan);
    const old=state.perceived, count=prepared.sections.length, learning=LEARN;
    const evaluate = perception => {
      const result=explicitStep(prepared,plan,{...state,perceived:perception});
      const residual=Float64Array.from(perception,(value,i)=>value-(1-learning)*old[i]-learning*result.metrics.sectionExtras[i]);
      return {perception,result,residual,error:norm(residual)};
    };
    let current=evaluate(Float64Array.from(old)), newton=0, linearIterations=0;
    // Exact zero change bypasses the solve and preserves every baseline number.
    if (current.error > 1e-8) {
      for (;newton<16 && current.error>1e-8;newton++) {
        const active=[], weights=[], derivative=new Float64Array(count), diagonal=new Float64Array(count).fill(1);
        for(let i=0;i<count;i++) derivative[i]=2*current.result.metrics.sectionLoads[i]/(prepared.sections[i].cap**2);
        for(let p=0;p<prepared.pairs.length;p++){
          const share=current.result.state.carShares[p];
          if(share<=0||share>=1||!prepared.routes[p].length)continue;
          const weight=.1*prepared.pairTotals[p]/CAR_OCCUPANCY;
          if(!weight)continue;active.push(p);weights.push(weight);
          const route=prepared.routes[p];
          for(let j=0;j<route.length;j++){const section=route[j];diagonal[section]+=learning*derivative[section]*weight;}
        }
        const matvec=vector=>{
          const summed=new Float64Array(count);
          for(let k=0;k<active.length;k++){
            const route=prepared.routes[active[k]];let value=0;
            for(let j=0;j<route.length;j++)value+=vector[route[j]];
            value*=weights[k];for(let j=0;j<route.length;j++)summed[route[j]]+=value;
          }
          for(let i=0;i<count;i++)summed[i]=vector[i]+learning*derivative[i]*summed[i];
          return summed;
        };
        const rhs=Float64Array.from(current.residual,x=>-x);
        const solved=linearSolve(matvec,rhs,diagonal,Math.max(1e-10,current.error*1e-3));
        linearIterations+=solved.iterations;
        let accepted=false;
        for(let fraction=1;fraction>=1/1024;fraction/=2){
          const candidate=Float64Array.from(current.perception,(value,i)=>Math.max(0,value+fraction*solved.x[i]));
          const next=evaluate(candidate);
          if(next.error<current.error){current=next;accepted=true;break;}
        }
        if(!accepted)throw Error('Implicit feedback did not find a decreasing residual ('+current.error+')');
      }
      if(current.error>1e-8)throw Error('Implicit feedback residual above tolerance: '+current.error);
    }
    const result=current.result;
    result.state.perceived=current.perception;
    result.metrics.solver={method:'implicit',newton,linearIterations,residual:current.error};
    return result;
  }

  function step(prepared, plan, state) { return implicitStep(prepared, plan, state); }

  function runToStable(prepared, plan, options) {
    const opts = options || {}, maxRounds = Math.max(5, Math.min(500, Math.floor(safe(opts.maxRounds) || 180)));
    const history = [], initialState = opts.state || createState(prepared, plan);
    let state = initialState;
    while (!state.stable && state.round - initialState.round < maxRounds) {
      const result = step(prepared, plan, state); state = result.state; history.push(result.row);
    }
    return { state, metrics: state.last || step(prepared, plan, state).metrics, rows: history, stable: state.stable, rounds: state.round };
  }

  function emptyPlan(options) {
    const o = options || {};
    const budget = o.budget !== undefined && o.budget !== null && Number.isFinite(Number(o.budget))
      ? Math.max(0, Number(o.budget)) : defaults.budget;
    return { budget, costs: { line: defaults.line, station: defaults.station, train: defaults.train }, lines: [] };
  }

  return { CELL_MIN, WALK_PER_CELL, WAIT, MAX_WALK, CAR_OCCUPANCY, LEARN, defaults, prepare, buildMetro, transitBenefits, createState, step, explicitStep, runToStable, validatePlan, planCost, emptyPlan, signature };
});
