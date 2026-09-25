/* 修一座桥：算谁会走、省多少时间、要花多少钱。
 * 只用现成的开车时间表和早高峰车流，不重跑整个模型。
 * 下面这些单价都是粗估，改这里就行。
 */
(function (root) {
  'use strict';

  const P = {
    bridgeSpeedKmh: 80,       // 桥上车速
    minSaveMin: 0.5,          // 省不到半分钟的不算
    laneCapacity: 1800,       // 每车道每小时车数
    maxLanesPerDir: 4,
    costWaterPerLaneKm: 5,    // 亿港元：海上桥，每车道每公里
    costLandPerLaneKm: 2,     // 亿港元：陆上高架，每车道每公里
    costEnds: 6,              // 亿港元：两头接驳匝道
    annualDays: 300,          // 一年折成多少个工作日
  };

  let D = null;   // 解码后的数据

  function decode(raw, type) {
    const bin = typeof atob === 'function' ? atob(raw) : Buffer.from(raw, 'base64').toString('binary');
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    return new type(bytes.buffer);
  }

  function init(G) {
    const n = G.n;
    const t10 = decode(G.time10, Uint16Array);
    const time = new Float32Array(n * n);
    for (let k = 0; k < n * n; k++) time[k] = t10[k] === 65535 ? Infinity : t10[k] / 10;
    const zones = G.zones.map(z => ({ id: z[0], name: z[1], district: z[2], pop: z[3], jobs: z[4],
                                      lon: z[5], lat: z[6], road: z[7] }));
    // 能开车进出的分区（开车时间表里有路可走）
    zones.forEach((z, i) => { let ok = 0; for (let j = 0; j < n; j++) if (Number.isFinite(time[i * n + j])) ok++; z.drivable = ok > n / 2; });
    const polys = G.geo.features.map(f => {
      const rings = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      let w = 180, s = 90, e = -180, nn = -90;
      rings.forEach(poly => poly[0].forEach(([x, y]) => { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); nn = Math.max(nn, y); }));
      return { i: f.properties.i, rings, box: [w, s, e, nn] };
    });
    D = { n, time, zones, polys, veh: decode(G.veh, Float32Array), ppl: decode(G.ppl, Float32Array),
          val: decode(G.val, Float32Array), dailyFactor: G.dailyFactor };
    return D;
  }

  function km(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function inRing(x, y, ring) {
    let inside = false;
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const [xa, ya] = ring[a], [xb, yb] = ring[b];
      if ((ya > y) !== (yb > y) && x < (xb - xa) * (y - ya) / (yb - ya) + xa) inside = !inside;
    }
    return inside;
  }
  // 点落在哪个分区（落在海上返回 -1）
  function zoneAt(lon, lat) {
    for (const p of D.polys) {
      const b = p.box;
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
      for (const poly of p.rings) {
        if (inRing(lon, lat, poly[0]) && !poly.slice(1).some(h => inRing(lon, lat, h))) return p.i;
      }
    }
    return -1;
  }

  // 陆地 / 水面：有 land.js（规划署 10 米土地用途格网）就用它；没有就退回「落不落在哪个分区里」
  const landMod = () => { const l = root.Land || (typeof require === 'function' ? require('./land.js') : null); return l && l.ready ? l : null; };
  function isWater(lon, lat) { const l = landMod(); return l ? l.isWater(lon, lat) : zoneAt(lon, lat) < 0; }
  // 两点之间能不能直接走过去（不隔着海或水塘）
  function dryPath(p, q) {
    const l = landMod();
    if (l) return l.dryPath(p, q);
    const N = Math.max(4, Math.ceil(km(p, q) / 0.05));
    let water = 0;
    for (let k = 1; k < N; k++) { const f = k / N; if (zoneAt(p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f) < 0 && ++water > 1) return false; }
    return true;
  }
  // 桥长多少在海上
  function waterShare(a, b) {
    const l = landMod(), L1 = km(a, b);
    if (l) return L1 > 0 ? Math.min(1, l.waterKm(a, b) / L1) : 0;
    const N = 60;
    let water = 0;
    for (let k = 0; k < N; k++) {
      const f = (k + 0.5) / N;
      if (zoneAt(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f) < 0) water++;
    }
    return water / N;
  }

  // 路网（road.js）。桥头吸附到最近的真实路口，谁能上桥、怎么开到桥头，都在真实路网上算，不会隔海直线接过去。
  let Road = null;
  function useRoad(r) { Road = r; }

  function evaluate(a, b) {
    const n = D.n, T = D.time, g = Road.g;
    const sa = Road.snap(a[0], a[1]), sb = Road.snap(b[0], b[1]);
    // 桥头点在海上、或附近没有能接的路：不算，告诉页面是哪一头、为什么
    if (sa.node < 0 || sb.node < 0) return { error: sa.node < 0 ? sa.reason : sb.reason, end: sa.node < 0 ? 'A' : 'B', A: sa, B: sb };
    const pa = [sa.lon, sa.lat], pb = [sb.lon, sb.lat];
    const lenKm = km(pa, pb), water = waterShare(pa, pb);
    const bridgeMin = lenKm / P.bridgeSpeedKmh * 60;
    // 各分区沿路开到桥头（反向最短路）、从桥头沿路开到各分区（正向最短路）
    const run = (node, reverse, ends) => { Road.dijkstra(node, g.base, reverse);
      return { t: Float64Array.from(ends, v => g.dist[v]), pred: Int32Array.from(g.pred) }; };
    const toA = run(sa.node, true, g.origin), toB = run(sb.node, true, g.origin);
    const fromA = run(sa.node, false, g.dest), fromB = run(sb.node, false, g.dest);
    let veh = 0, ppl = 0, valMin = 0, vehMin = 0, ab = 0, ba = 0;
    const zoneVeh = new Float64Array(n), zoneVehMin = new Float64Array(n);
    const ods = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const k = i * n + j, v = D.veh[k];
        if (v <= 0) continue;
        const old = T[k];
        if (!Number.isFinite(old)) continue;
        const v1 = toA.t[i] + bridgeMin + fromB.t[j], v2 = toB.t[i] + bridgeMin + fromA.t[j];
        const via = Math.min(v1, v2), save = old - via;
        if (!(save >= P.minSaveMin)) continue;
        veh += v; ppl += D.ppl[k]; valMin += D.val[k] * save; vehMin += v * save;
        if (v1 <= v2) ab += v; else ba += v;
        zoneVeh[i] += v; zoneVeh[j] += v; zoneVehMin[i] += v * save; zoneVehMin[j] += v * save;
        ods.push({ i, j, v, save, dir: v1 <= v2 ? 0 : 1, old, via });
      }
    }
    ods.sort((x, y) => y.v * y.save - x.v * x.save);

    const peakDir = Math.max(ab, ba);
    const need = Math.ceil(peakDir / P.laneCapacity);
    const lanesPerDir = Math.min(P.maxLanesPerDir, Math.max(1, need));
    const lanes = 2 * lanesPerDir;
    const cost = lenKm * water * lanes * P.costWaterPerLaneKm + lenKm * (1 - water) * lanes * P.costLandPerLaneKm + P.costEnds;
    const F = D.dailyFactor;
    const benefitYr = valMin * F * P.annualDays / 1e8;     // 亿港元 / 年
    // 受益最多的几条出行：还原真实开的路线（起点 → 沿路到桥头 → 过桥 → 沿路到终点）
    const route = o => {
      const [p, q, to, from] = o.dir === 0 ? [sa, sb, toA, fromB] : [sb, sa, toB, fromA];
      const zi = D.zones[o.i], zj = D.zones[o.j];
      return [[zi.lat, zi.lon], ...Road.pathToward(to.pred, g.origin[o.i], p.node), [p.lat, p.lon], [q.lat, q.lon],
              ...Road.pathFrom(from.pred, q.node, g.dest[o.j]), [zj.lat, zj.lon]];
    };
    return {
      lenKm, waterKm: lenKm * water, bridgeMin, A: sa, B: sb, lanes, lanesPerDir, jammed: need > P.maxLanesPerDir,
      cost, peakVeh: veh, peakDir, dayVeh: veh * F, dayPpl: ppl * F, avgSave: veh ? vehMin / veh : 0,
      benefitYr, payback: benefitYr > 0 ? cost / benefitYr : Infinity,
      zoneVeh: zoneVeh.map(x => x * F), zoneSave: zoneVeh.map((x, i) => (x ? zoneVehMin[i] / x : 0)),
      top: ods.slice(0, 8).map(o => Object.assign(o, { day: o.v * F, path: route(o) })),
    };
  }

  const api = { P, init, useRoad, evaluate, zoneAt, isWater, dryPath, km, get data() { return D; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
