/* 新地铁线：一轮一轮算到稳定。
 *
 * 每一轮做四件事（和原来的四阶段模型一一对应，但只算「跟现状比变了多少」，所以快）：
 *   ① 公交时间：原来坐公交的时间 vs「到站 + 等车 + 坐新线（挤了会慢）+ 出站」取小
 *   ② 去哪、怎么去：出行分布按公交时间的变化重新摊（衰减系数取 pipeline/22），
 *      开车还是坐公交按两边时间的变化重新分（敏感度取 pipeline/23）
 *   ③ 路上变顺：把少开的车从路网上拿掉，按 pipeline/27 的拥堵公式重算每段路的时间，再重算开车时间
 *   ④ 人口搬迁（简化的 TOD）：去岗位更方便的区，人口按可达性的变化多一些（弹性是估的）
 * 每轮的结果和上一轮平均（第 n 轮走 1/n），直到前后两轮差不到 0.5%。
 * 只在内存里算，不写任何文件。
 */
(function (root) {
  'use strict';

  const P = {
    speedKmh: 75, stopMin: 1, headwayMin: 3,
    walkKmh: 4.5, walkDetour: 1.25, walkMaxKm: 1.5, transferMin: 3, nearZones: 3,
    splitSens: 0.5,           // 新线和原公交路线之间怎么分：平滑，免得迭代来回跳
    splitMaxWorseMin: 10,     // 比原路线慢 10 分钟以上的不坐新线
    trainCap: 2000, trainsPerHour: 20,
    popElasticity: 0.5,       // 可达性变 1%，人口变 0.5%（估的，约 10–15 年的效果）
    popCap: 0.4,              // 单个区人口最多变 ±40%
    popStep: 0.5,             // 人口每轮只走剩下差距的一半（土地利用调整慢）
    maxRounds: 12, minRounds: 4, tol: 0.005,
    costLandPerKm: 35, costWaterPerKm: 60, costStation: 20,
    opexPerTrainKm: 300, fullFreqHours: 10, annualDays: 300,
  };

  let D, M, G, E, RoadMod;

  function decode(raw, type) {
    const bin = typeof atob === 'function' ? atob(raw) : Buffer.from(raw, 'base64').toString('binary');
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    return new type(bytes.buffer);
  }

  function init(engine, metroRaw, roadRaw) {
    E = engine; D = engine.data;
    const n = D.n;
    const t10 = decode(metroRaw.ptTime10, Uint16Array), ptTime = new Float32Array(n * n);
    for (let k = 0; k < n * n; k++) ptTime[k] = t10[k] === 65535 ? Infinity : t10[k] / 10;
    M = Object.assign({}, metroRaw, { ptTime, pt: decode(metroRaw.pt, Float32Array), car: decode(metroRaw.car, Float32Array) });
    // 路网：和修桥页共用 road.js
    RoadMod = root.Road || require('./road.js');
    RoadMod.init(roadRaw);
    G = RoadMod.g;
    // 可达性的底：每个区到各区岗位（按公交时间衰减）
    const kH = M.betaHBW * M.r;
    M.access0 = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) { const t = ptTime[i * n + j]; if (Number.isFinite(t)) s += D.zones[j].jobs * Math.exp(-kH * t); } M.access0[i] = s; }
    return { G, M };
  }

  // ---------- 最短路（二叉堆，懒删除） ----------
  function dijkstra(s, w) { return RoadMod.dijkstra(s, w, false); }

  // ---------- 线路几何 ----------
  function lineFrom(path, stationKm) {
    const cum = [0];
    for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + E.km(path[k - 1], path[k]));
    const at = km => { let k = 1; while (k < path.length - 1 && cum[k] < km) k++;
      const f = cum[k] > cum[k - 1] ? (km - cum[k - 1]) / (cum[k] - cum[k - 1]) : 0;
      return [path[k - 1][0] + (path[k][0] - path[k - 1][0]) * f, path[k - 1][1] + (path[k][1] - path[k - 1][1]) * f]; };
    let water = 0;
    const N = Math.max(20, Math.round(cum[cum.length - 1] * 20));
    for (let q = 0; q < N; q++) { const p = at((q + 0.5) / N * cum[cum.length - 1]); if (E.isWater(p[0], p[1])) water++; }
    const len = cum[cum.length - 1];
    return { path, cum, len, waterKm: len * water / N, stationKm: stationKm.slice(), stations: stationKm.map(at), at };
  }

  // ---------- 车站只能建在陆地上（线可以走海底隧道，站不行） ----------
  function measure(pts) {
    const c = [0]; for (let k = 1; k < pts.length; k++) c.push(c[k - 1] + E.km(pts[k - 1], pts[k]));
    const at = km => { let k = 1; while (k < pts.length - 1 && c[k] < km) k++;
      const f = c[k] > c[k - 1] ? Math.min(1, Math.max(0, (km - c[k - 1]) / (c[k] - c[k - 1]))) : 0;
      return [pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * f, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * f]; };
    return { c, at, len: c[c.length - 1] };
  }
  // 画出来的线两头伸到海里：从两头往里收，收到第一块陆地为止（首末站要建在岸上）；整条都在海上返回 null
  function trimToLand(pts) {
    const { c, at, len } = measure(pts);
    const wet = km => { const q = at(km); return E.isWater(q[0], q[1]); };
    let a = 0, b = len;
    while (a <= len && wet(a)) a += 0.02;
    while (b >= a && wet(b)) b -= 0.02;
    if (b - a < 0.02) return null;
    if (a === 0 && b === len) return pts;
    const out = [at(a)];
    for (let k = 1; k < pts.length - 1; k++) if (c[k] > a && c[k] < b) out.push(pts[k]);
    out.push(at(b));
    return out;
  }
  // 中间的站落在海上：沿线挪到最近的岸上（最多挪 600 米、离相邻站不少于 300 米），挪不了就不设这个站
  function landStations(path, kms) {
    const { at } = measure(path);
    const wet = km => { const q = at(km); return E.isWater(q[0], q[1]); };
    const out = [kms[0]];
    for (let q = 1; q < kms.length - 1; q++) {
      const lo = out[out.length - 1] + 0.3, hi = kms[kms.length - 1] - 0.3;
      let got = null;
      for (let s = 0; s <= 0.6 && got === null; s += 0.02) {
        if (kms[q] + s <= hi && !wet(kms[q] + s)) got = kms[q] + s;
        else if (kms[q] - s >= lo && !wet(kms[q] - s)) got = kms[q] - s;
      }
      if (got !== null) out.push(got);
    }
    if (kms.length > 1) out.push(kms[kms.length - 1]);
    return out;
  }

  // ---------- ① 公交时间 ----------
  function transit(line, cf) {
    const n = D.n, T = M.ptTime, S = line.stations.length, st = line.stations, km = E.km;
    const run = []; for (let s = 0; s < S - 1; s++) run.push((line.stationKm[s + 1] - line.stationKm[s]) / P.speedKmh * 60);
    const cum = [new Float64Array(S), new Float64Array(S)];
    for (let s = 0; s < S - 1; s++) { cum[0][s + 1] = cum[0][s] + run[s] * cf[0][s]; cum[1][s + 1] = cum[1][s] + run[s] * cf[1][s]; }
    const ride = (a, b) => Math.abs(cum[b > a ? 0 : 1][b] - cum[b > a ? 0 : 1][a]) + P.stopMin * Math.max(0, Math.abs(b - a) - 1);
    const walk = d => d * P.walkDetour / P.walkKmh * 60;
    if (!line.access) line.access = accessInfo(line);
    const { near, walkOK } = line.access;
    const acc = new Float64Array(n * S), egr = new Float64Array(S * n);
    for (let s = 0; s < S; s++) for (let i = 0; i < n; i++) {
      const d = km(st[s], [D.zones[i].lon, D.zones[i].lat]);
      let bi = d <= P.walkMaxKm && walkOK[i * S + s] ? walk(d) : Infinity, bo = bi;
      for (const x of near[s]) { if (x.i === i) continue; const w = walk(x.d) + P.transferMin;
        bi = Math.min(bi, T[i * n + x.i] + w); bo = Math.min(bo, T[x.i * n + i] + w); }
      acc[i * S + s] = bi; egr[s * n + i] = bo;
    }
    const wait = P.headwayMin / 2;
    const arr = new Float64Array(n * S).fill(Infinity), from = new Int16Array(n * S).fill(-1);
    for (let i = 0; i < n; i++) for (let a = 0; a < S; a++) {
      const b0 = acc[i * S + a] + wait; if (!Number.isFinite(b0)) continue;
      for (let b = 0; b < S; b++) { if (a === b) continue; const v = b0 + ride(a, b); if (v < arr[i * S + b]) { arr[i * S + b] = v; from[i * S + b] = a; } }
    }
    const via = new Float32Array(n * n).fill(Infinity), pa = new Int16Array(n * n).fill(-1), pb = new Int16Array(n * n).fill(-1);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) continue;
      let best = Infinity, bb = -1;
      for (let b = 0; b < S; b++) { const v = arr[i * S + b] + egr[b * n + j]; if (v < best) { best = v; bb = b; } }
      if (bb >= 0) { via[i * n + j] = best; pa[i * n + j] = from[i * S + bb]; pb[i * n + j] = bb; }
    }
    return { via, pa, pb };
  }

  // 哪些分区中心能走路到哪个站：直线距离 1.5 公里内，而且这段路不隔着海或水塘（land.js，每 20 米看一次）
  function crossesWater(p, q) { return !E.dryPath(p, q); }
  function accessInfo(line) {
    const n = D.n, S = line.stations.length, walkOK = new Uint8Array(n * S), near = [];
    line.stations.forEach((p, s) => {
      const byDist = D.zones.map((z, i) => ({ i, d: E.km(p, [z.lon, z.lat]) })).sort((x, y) => x.d - y.d);
      for (const x of byDist) { if (x.d > P.walkMaxKm) break; if (!crossesWater([D.zones[x.i].lon, D.zones[x.i].lat], p)) walkOK[x.i * S + s] = 1; }
      near.push(byDist.slice(0, 15).filter(x => walkOK[x.i * S + s]).slice(0, P.nearZones));
    });
    line.inWater = line.stations.filter(p => E.isWater(p[0], p[1])).length;
    line.unreachable = near.filter(x => x.length === 0).length;
    return { near, walkOK };
  }

  function crowdFactor(lf) { return lf <= 0.8 ? 1 : lf <= 1.2 ? 1 + 1.5 * (lf - 0.8) : 1.6 + 4 * (lf - 1.2); }

  // ---------- 整个过程 ----------
  async function run(line, onRound, onProgress) {
    const n = D.n, S = line.stations.length, nn = n * n;
    const pt0 = M.pt, car0 = M.car, Tpt0 = M.ptTime;
    const cap = P.trainCap * P.trainsPerHour;
    const zones = D.zones, pop0 = zones.map(z => z.pop), jobs = zones.map(z => z.jobs);
    const D0 = new Float64Array(nn), s0 = new Float64Array(nn), P0 = new Float64Array(n), A0 = new Float64Array(n);
    for (let k = 0; k < nn; k++) { D0[k] = pt0[k] + car0[k]; s0[k] = D0[k] > 0 ? pt0[k] / D0[k] : 0; }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { P0[i] += D0[i * n + j]; A0[j] += D0[i * n + j]; }
    const kDist = M.betaPeak * M.r, kAcc = M.betaHBW * M.r, theta = M.theta;

    // 状态（逐轮平均）
    let loads = [new Float64Array(S - 1), new Float64Array(S - 1)];
    let pop = Float64Array.from(pop0);
    const dflow = new Float64Array(G.nRoad);
    const w = Float64Array.from(G.base);
    let Tcar0 = null, Tcar = null;
    let PTn = null, CARn = null, lastT = null, revenueDay = 0;
    const history = [];

    for (let round = 1; round <= P.maxRounds; round++) {
      const step = 1 / round;
      // ① 公交时间（挤了会慢）
      onProgress && onProgress(round, 1, '算新线的公交时间');
      const cf = loads.map(l => Array.from(l, v => crowdFactor(v / cap)));
      const T = transit(line, cf);
      lastT = T;
      await tick();

      // ② 去哪、怎么去
      onProgress && onProgress(round, 2, '重新分：去哪、坐公交还是开车');
      const Tpt = new Float32Array(nn);
      for (let k = 0; k < nn; k++) Tpt[k] = Math.min(Tpt0[k], T.via[k]);
      const Prow = new Float64Array(n); let sp = 0;
      for (let i = 0; i < n; i++) { Prow[i] = pop0[i] > 0 ? P0[i] * pop[i] / pop0[i] : P0[i]; sp += Prow[i]; }
      const sa = A0.reduce((x, y) => x + y, 0);
      for (let i = 0; i < n; i++) Prow[i] *= sa / sp;
      const Dn = new Float64Array(nn);
      for (let k = 0; k < nn; k++) {
        if (D0[k] <= 0) continue;
        const d = Number.isFinite(Tpt0[k]) ? Tpt[k] - Tpt0[k] : 0;
        Dn[k] = D0[k] * Math.exp(-kDist * d);
      }
      furness(Dn, Prow, A0, n);
      const newPT = new Float64Array(nn), newCAR = new Float64Array(nn);
      for (let k = 0; k < nn; k++) {
        if (Dn[k] <= 0) continue;
        const dpt = Number.isFinite(Tpt0[k]) ? Tpt[k] - Tpt0[k] : 0;
        const dcar = Tcar && Number.isFinite(Tcar0[k]) && Number.isFinite(Tcar[k]) ? Tcar[k] - Tcar0[k] : 0;
        const ep = s0[k] * Math.exp(-theta * dpt), ec = (1 - s0[k]) * Math.exp(-theta * dcar);
        const s = ep + ec > 0 ? ep / (ep + ec) : 0;
        newPT[k] = Dn[k] * s; newCAR[k] = Dn[k] * (1 - s);
      }
      if (!PTn) { PTn = newPT; CARn = newCAR; }
      else for (let k = 0; k < nn; k++) { PTn[k] += step * (newPT[k] - PTn[k]); CARn[k] += step * (newCAR[k] - CARn[k]); }
      await tick();

      // 新线上的人（和原公交路线平滑地分）、每段多挤
      const aux = [new Float64Array(S - 1), new Float64Array(S - 1)];
      const zoneRiders = new Float64Array(n), board = new Float64Array(S);
      let ridersPeak = 0, revPeak = 0;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const k = i * n + j, v = T.via[k];
        if (!(PTn[k] > 0) || !Number.isFinite(v) || !Number.isFinite(Tpt0[k]) || v > Tpt0[k] + P.splitMaxWorseMin) continue;
        const share = 1 / (1 + Math.exp(-P.splitSens * (Tpt0[k] - v)));
        if (share < 0.01) continue;
        const q = PTn[k] * share, a = T.pa[k], b = T.pb[k], dir = b > a ? 0 : 1;
        for (let s = Math.min(a, b); s < Math.max(a, b); s++) aux[dir][s] += q;
        ridersPeak += q; zoneRiders[i] += q; zoneRiders[j] += q; board[a] += q; board[b] += q;
        revPeak += q * (5.68 + 0.84 * E.km(line.stations[a], line.stations[b]));
      }
      for (let d = 0; d < 2; d++) for (let s = 0; s < S - 1; s++) loads[d][s] += step * (aux[d][s] - loads[d][s]);

      // ④ 人口搬迁（简化 TOD）
      onProgress && onProgress(round, 4, '人口按可达性搬迁');
      const target = new Float64Array(n); let st = 0;
      for (let i = 0; i < n; i++) {
        let s = 0; for (let j = 0; j < n; j++) { const t = Tpt[i * n + j]; if (Number.isFinite(t)) s += jobs[j] * Math.exp(-kAcc * t); }
        const ratio = M.access0[i] > 0 ? Math.pow(s / M.access0[i], P.popElasticity) : 1;
        target[i] = pop0[i] * Math.min(1 + P.popCap, Math.max(1 - P.popCap, ratio)); st += target[i];
      }
      const totalPop = pop0.reduce((x, y) => x + y, 0);
      for (let i = 0; i < n; i++) { target[i] *= totalPop / st; pop[i] += P.popStep * (target[i] - pop[i]); }
      await tick();

      // ③ 路上变顺：把少开（或多开）的车放到路网上，重算每段路和开车时间
      const dveh = new Float64Array(nn);
      for (let k = 0; k < nn; k++) dveh[k] = (CARn[k] - car0[k]) / M.carOcc;
      const auxFlow = new Float64Array(G.nRoad), skim = new Float32Array(nn);
      for (let i = 0; i < n; i++) {
        if (i % 25 === 0) { onProgress && onProgress(round, 3, `路上重新分配车流 ${i}/${n}`); await tick(); }
        const cnt = dijkstra(G.origin[i], w);
        for (let j = 0; j < n; j++) { skim[i * n + j] = i === j ? 0 : G.dist[G.dest[j]]; G.acc[G.dest[j]] = i === j ? 0 : dveh[i * n + j]; }
        for (let q = cnt - 1; q > 0; q--) {
          const u = G.order[q], a = G.acc[u];
          if (a !== 0) { const e = G.pred[u]; if (e < G.nRoad) auxFlow[e] += a; G.acc[G.src[e]] += a; }
          G.acc[u] = 0;
        }
        G.acc[G.order[0]] = 0;
        for (let j = 0; j < n; j++) G.acc[G.dest[j]] = 0;
      }
      if (!Tcar0) Tcar0 = skim;
      Tcar = skim;
      const bb = G.bpr[1];
      for (let e = 0; e < G.nRoad; e++) {
        dflow[e] += step * (auxFlow[e] - dflow[e]);
        const v = Math.max(0, G.vol[e] + dflow[e]);
        w[e] = Math.max(1e-3, G.free[e] * (1 + G.alpha[e] * Math.pow(v / G.cap[e], bb)));
      }

      // 本轮汇总
      let carVehSaved = 0, carChange = 0, ptMinSaved = 0, carMinSaved = 0, popMoved = 0;
      for (let k = 0; k < nn; k++) {
        carChange += CARn[k] - car0[k];
        if (Number.isFinite(Tpt0[k])) ptMinSaved += 0.5 * (pt0[k] + PTn[k]) * (Tpt0[k] - Tpt[k]);
        if (Number.isFinite(Tcar0[k]) && Number.isFinite(Tcar[k])) { const dt = Tcar0[k] - Tcar[k]; carMinSaved += 0.5 * (car0[k] + CARn[k]) * dt; carVehSaved += CARn[k] / M.carOcc * dt; }
      }
      for (let i = 0; i < n; i++) popMoved += Math.max(0, pop[i] - pop0[i]);
      const maxLoad = Math.max(0, ...loads[0], ...loads[1]);
      const h = { round, ridersDay: ridersPeak * M.ptDaily, carTripsDay: -carChange * M.carDaily, popMoved, maxLoad,
                  carMinSavedPeak: carMinSaved, ptMinSavedPeak: ptMinSaved };
      const prev = history[history.length - 1];
      h.change = prev ? Math.max(rel(h.ridersDay, prev.ridersDay), rel(h.popMoved, prev.popMoved), rel(h.carTripsDay, prev.carTripsDay)) : 1;
      history.push(h);

      revenueDay = revPeak * M.ptDaily;
      const snapshot = { round, history, pop: Float64Array.from(pop), pop0, loads: loads.map(l => Float64Array.from(l)), cap,
                         zoneRiders: Array.from(zoneRiders, x => x * M.ptDaily), board: Array.from(board, x => x * M.ptDaily),
                         revenueDay: revPeak * M.ptDaily };
      onRound && await onRound(snapshot);
      if (round >= P.minRounds && h.change < P.tol) break;
    }

    // 最后的账
    const last = history[history.length - 1];
    const streets = relievedStreets(w);
    const capex = (line.len - line.waterKm) * P.costLandPerKm + line.waterKm * P.costWaterPerKm + S * P.costStation;
    const timeYr = (last.ptMinSavedPeak * M.ptDaily * M.votPt + last.carMinSavedPeak * M.carDaily * M.votCar) * P.annualDays / 1e8;
    const revenueYr = revenueDay * P.annualDays / 1e8;
    const opexYr = 2 * line.len * P.trainsPerHour * P.fullFreqHours * 365 * P.opexPerTrainKm / 1e8;
    return { history, streets, capex, timeYr, opexYr, revenueYr, converged: last.change < P.tol, carMinSavedDay: last.carMinSavedPeak * M.carDaily,
             ptMinSavedDay: last.ptMinSavedPeak * M.ptDaily, payback: timeYr > 0 ? capex / timeYr : Infinity };
  }

  function rel(a, b) { return Math.abs(a - b) / Math.max(Math.abs(b), 1); }
  function tick() { return new Promise(r => setTimeout(r, 0)); }

  function furness(T, P, A, n) {
    const rowF = new Float64Array(n), colF = new Float64Array(n);
    for (let it = 0; it < 20; it++) {
      rowF.fill(0); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) rowF[i] += T[i * n + j];
      for (let i = 0; i < n; i++) if (rowF[i] > 0) { const f = P[i] / rowF[i]; for (let j = 0; j < n; j++) T[i * n + j] *= f; }
      colF.fill(0); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) colF[j] += T[i * n + j];
      let err = 0;
      for (let j = 0; j < n; j++) if (colF[j] > 0) { const f = A[j] / colF[j]; err = Math.max(err, Math.abs(f - 1)); for (let i = 0; i < n; i++) T[i * n + j] *= f; }
      if (err < 1e-4) break;
    }
  }

  // 变顺最多的路：按「车流 × 每辆省的时间」汇总到路名
  function relievedStreets(w) {
    const by = new Map();
    for (let e = 0; e < G.nRoad; e++) {
      const dt = G.base[e] - w[e], nm = G.names[G.name[e]];
      if (!nm || Math.abs(dt) < 1e-4) continue;
      by.set(nm, (by.get(nm) || 0) + G.vol[e] * dt);
    }
    return [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, vehMin]) => ({ name, vehMin }));
  }

  // 自检：现状路况下的最短路，应等于打包好的开车时间表（data.js，精确到 0.1 分钟）
  function checkBaseline(every) {
    const n = D.n; let worst = 0;
    for (let i = 0; i < n; i += every || 1) {
      dijkstra(G.origin[i], G.base);
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const a = G.dist[G.dest[j]], b = D.time[i * n + j];
        if (Number.isFinite(a) && Number.isFinite(b)) worst = Math.max(worst, Math.abs(a - b));
        else if (Number.isFinite(a) !== Number.isFinite(b) && a < 600) worst = Infinity;
      }
    }
    return worst;
  }

  const api = { P, init, lineFrom, trimToLand, landStations, accessInfo, run, crowdFactor, checkBaseline, get graph() { return G; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sim = api;
})(typeof window !== 'undefined' ? window : globalThis);
