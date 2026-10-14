/* A deliberately small D-tier mechanics fixture, adapted from mode3-roads/data.js.
 * It is not a substitute for task 51's full-Hong-Kong JSON files.
 */
(function (root) {
  'use strict';
  const step = (a, b) => {
    const out = [[a[0], a[1]]]; let x = a[0], y = a[1];
    while (x !== b[0]) { x += Math.sign(b[0] - x); out.push([x, y]); }
    while (y !== b[1]) { y += Math.sign(b[1] - y); out.push([x, y]); }
    return out;
  };
  const expand = points => {
    const out = [];
    for (let i = 0; i < points.length; i++) {
      if (!i) out.push(points[i].slice());
      else out.push(...step(points[i - 1], points[i]).slice(1));
    }
    return out;
  };
  const english = {"啟德":"Kai Tak","牛頭角":"Ngau Tau Kok","順利·安達臣道":"Shun Lee · Anderson Road","秀茂坪":"Sau Mau Ping","藍田":"Lam Tin","將軍澳":"Tseung Kwan O","觀塘商貿區":"Kwun Tong Business Area","九龍灣商貿區":"Kowloon Bay Business Area","觀塘繞道":"Kwun Tong Bypass","觀塘道":"Kwun Tong Road","開源道":"Hoi Yuen Road","清水灣道":"Clear Water Bay Road","秀茂坪道":"Sau Mau Ping Road","將軍澳隧道":"Tseung Kwan O Tunnel","將藍隧道":"Tseung Kwan O–Lam Tin Tunnel","觀塘綫":"Kwun Tong Line","將軍澳綫":"Tseung Kwan O Line","彩虹":"Choi Hung","九龍灣":"Kowloon Bay","觀塘":"Kwun Tong","油塘":"Yau Tong","調景嶺":"Tiu Keng Leng","寶琳":"Po Lam"};
  const en = name => english[name] || name;
  const make = d => {
    if (!d || !d.cols || !d.rows) throw new Error('mode 3 fixture was not loaded');
    const land = Array(d.cols * d.rows).fill('.');
    for (const [x, y] of d.water || []) land[y * d.cols + x] = '~';
    for (let y = 0; y < Math.min(3, d.rows); y++) for (let x = Math.max(10, d.cols - 4); x < d.cols; x++) if (land[y * d.cols + x] === '.') land[y * d.cols + x] = '^';
    for (let y = 0; y < d.rows; y++) for (let x = 0; x < d.cols; x++) {
      if (land[y * d.cols + x] === '.' && ((x * 7 + y * 11) % 31 === 0)) land[y * d.cols + x] = 'g';
    }
    const zones = [];
    (d.origins || []).forEach((z, i) => zones.push({ id: 'o' + i, name: z.name, hans: z.hans || z.name, en: en(z.name), district: z.name === '啟德' ? '九龍城' : z.name === '將軍澳' ? '西貢' : '觀塘', cell: z.cell.slice(), pop: z.people * 2000, jobs: 0, cbd: 0 }));
    (d.destinations || []).forEach((z, i) => zones.push({ id: 'd' + i, name: z.name, hans: z.hans || z.name, en: en(z.name), district: '觀塘', cell: z.cell.slice(), pop: 0, jobs: Math.max(0, z.attraction - 16) * 15000, cbd: 1 }));
    const cells = zones.map(z => [z.cell[0], z.cell[1], z.pop, z.jobs]);
    const roadVcs = [1.57, 1.17, 0.82, 2.35, 0.94, 0.89, 1.52];
    const roads = [], sections = [];
    (d.roads || []).forEach((road, ri) => {
      const cellsOnRoad = expand(road.via), id = ri + 1;
      roads.push({ id, name: road.name, hans: road.hans || road.name, en: en(road.name), class: ri === 0 || ri === 3 ? 'expressway' : 'primary', cells: cellsOnRoad, tunnel: /隧道/.test(road.name), toll: 0 });
      const cap = Math.round((road.cap || 40) * 100), vc = roadVcs[ri] || 0.9, load = Math.round(cap * vc);
      for (let i = 0; i + 1 < cellsOnRoad.length; i++) {
        const a = cellsOnRoad[i], b = cellsOnRoad[i + 1], sectionId = sections.length;
        sections.push({ id: sectionId, a, b, road: id, cap, am: { load, vc } });
      }
    });
    const stations = [], stationAt = new Map(), lines = [];
    (d.lines || []).forEach((line, li) => {
      const id = 'mock-line-' + (li + 1), stIds = [];
      (line.stations || []).forEach((cell, si) => {
        const k = cell.join(','), stationId = stationAt.get(k) || ('mock-st-' + (stationAt.size + 1));
        if (!stationAt.has(k)) {
          stationAt.set(k, stationId);
          stations.push({ id: stationId, name: (line.names || [])[si] || ('站 ' + (si + 1)), hans: (line.namesHans || [])[si] || (line.names || [])[si] || ('站 ' + (si + 1)), en: en((line.names || [])[si] || ('Station ' + (si + 1))), cell: cell.slice(), xy: cell.slice(), lines: [], zone: null });
        }
        const st = stations.find(x => x.id === stationId); if (!st.lines.includes(id)) st.lines.push(id);
        stIds.push(stationId);
      });
      lines.push({ id, name: line.name, hans: line.hans || line.name, en: en(line.name), color: line.color || '#1E9A4A', stations: stIds, cells: expand(line.via), trains_per_hour: (line.trains || 2) * 8, cap_per_hour: (line.trains || 2) * 8 * 750 });
    });
    const base = {
      version: 0, fixture: true, tier: 'D', cell_m: d.cell_m || 600, cols: d.cols, rows: d.rows,
      land: land.join(''), cells, zones, stations, lines, roads, sections,
      areas: [{ key: 'kowloon-east', name: '九龍東', hans: '九龙东', en: 'Kowloon East', center: '觀塘', box: [0, 0, d.cols, d.rows] }],
      sources: { fixture: 'mode3-roads/data.js; all demand values are schematic test values' }, tiers: { fixture: 'D' }
    };
    const demandZones = zones.map(z => z.id), pairs = [];
    for (let i = 0; i < (d.origins || []).length; i++) for (let j = 0; j < (d.destinations || []).length; j++) {
      const o = d.origins[i], dest = d.destinations[j], total = Math.round(o.people * (dest.attraction + 3) * 1.15);
      const car = Math.round(total * 0.58), pt = total - car;
      const distance = Math.abs(o.cell[0] - dest.cell[0]) + Math.abs(o.cell[1] - dest.cell[1]);
      const carGrid = Math.max(4, distance + (dest.carExtra || 2));
      const carMin = Math.round(carGrid * 2.5);
      const ptMin = Math.round(Math.max(carGrid + 2, distance * 2 + 8) * 2.5);
      pairs.push([i, (d.origins || []).length + j, car, pt, carMin, ptMin, distance * 5]);
    }
    const demand = {
      period: 'am', label: '早高峰 · 假底板', hans: '早高峰 · 假底板', en: 'AM peak · fixture', hours: 'D-tier mechanics fixture', tier: 'D',
      theme: { paper: '#EEF3F8', ink: '#2B3A4A', accent: '#2F6FD6' }, zones: demandZones, pairs,
      sections: sections.map(s => [s.id, s.am.load, s.am.vc]), lines: [], checks: { note: 'D-tier synthetic flows; not for planning.' }
    };
    return { base, demand, demands: { am: demand }, availablePeriods: ['am'], fixture: true };
  };
  root.SandboxFallback = { make };
})(typeof window !== 'undefined' ? window : globalThis);
