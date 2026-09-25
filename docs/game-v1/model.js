/* 新线试算台 · 玩具模型
 *
 * 在一条 8 个分区的玩具走廊上，把第一版游戏的 13 个函数（F1–F13）完整跑一遍。
 * 标 REAL 的是现有四阶段模型里的真实参数；TOY 里全是占位数，等算法同学标定。
 * 浏览器里挂在 window.TL 上；node 里 module.exports。
 */
(function (root) {
  'use strict';

  // ---- 真实参数：沿用现有模型 ----
  const REAL = {
    theta: 0.060,     // 方式选择敏感度 / 广义分钟（对 TCS 表 5.2 拟合，23_mode_choice）
    fareBase: 5.68,   // 港铁票价拟合：5.68 + 0.84 × 直线公里
    farePerKm: 0.84,
    vot: 1.26,        // 时间价值 港元/分钟（私家车）
    carOcc: 1.31,     // 私家车每车人数
  };

  // ---- 占位参数 ----
  const TOY = {
    thetaRoute: 0.25,     // 巴士与新线之间怎么分：比方式选择更敏感，只用来平滑
    waitWeight: 2.0,      // 等 1 分钟 = 坐车 2 分钟
    walkMin: 4,
    transferMin: 5,       // 接驳巴士换地铁的换乘惩罚
    dwellMin: 1,          // 每停一站加 1 分钟（含加减速）
    busSpeed: 22,
    busHalfHeadway: 4,
    busFareBase: 4.5,
    busFarePerKm: 0.45,
    carSpeed: 28,
    carTerminalMin: 5,
    carCostPerKm: 1.0,
    harbourToll: 25,
    ascPT: 1.5,           // 公交的固有偏好（很多人没车）
    roadFactor: 1.15,     // 路网距离 / 直线距离
    tripsPerResident: 0.45,
    beta: 0.10,           // 重力模型距离衰减 / 公里
    intraKm: 1.5,
    peakShare: 0.20,      // 早高峰一小时占全日单程的比例
    annualDays: 300,
    years: 50,
    rate: 0.04,
    fullFreqHours: 10,    // 全天折算成满频运营的小时数
    congestionPerVkm: 2.5,
    co2PerVkm: 0.18,      // 公斤
    carbonPrice: 0.8,     // 港元 / 公斤
    busCostSave: 0.7,     // 巴士少收的票钱里，砍班能省回的比例
    budget: 800,          // 亿
    crowdLimit: 1.2,
    maxIter: 30,
    tol: 0.005,
  };

  const ZONES = [
    { id: 'A', name: '北部新市镇', x: 0,    pop: 300000, jobs: 40000,  dense: true,  park: 0 },
    { id: 'B', name: '新发展区',   x: 4,    pop: 90000,  jobs: 70000,  dense: false, park: 0 },
    { id: 'C', name: '旧墟镇',     x: 8,    pop: 180000, jobs: 50000,  dense: true,  park: 5 },
    { id: 'D', name: '郊野边村',   x: 13,   pop: 20000,  jobs: 5000,   dense: false, park: 0 },
    { id: 'E', name: '工业区',     x: 17,   pop: 120000, jobs: 130000, dense: false, park: 5 },
    { id: 'F', name: '九龙西',     x: 21,   pop: 160000, jobs: 140000, dense: true,  park: 15 },
    { id: 'G', name: '旺区',       x: 24,   pop: 180000, jobs: 260000, dense: true,  park: 25 },
    { id: 'H', name: '对岸商务区', x: 27.5, pop: 40000,  jobs: 420000, dense: true,  park: 40 },
  ];
  const N = ZONES.length;

  // 第 k 段连接分区 k 和 k+1
  const SEG_TERRAIN = [null, null, 'hill', null, null, null, 'harbour'];
  const TERRAIN = {
    hill:    { label: '郊野公园', rule: '不准高架和地面，只能打山岭隧道', perKm: 25 },
    harbour: { label: '维多利亚港', rule: '只能沉管隧道过海', perKm: 60 },
  };
  const BUILD = {
    tunnel:   { label: '地下',     speed: 60, cap: 2000, perKm: 35, station: 15,  opexPerTrainKm: 300 },
    elevated: { label: '高架',     speed: 60, cap: 2000, perKm: 14, station: 5,   opexPerTrainKm: 300 },
    grade:    { label: '地面轻铁', speed: 25, cap: 600,  perKm: 5,  station: 0.8, opexPerTrainKm: 120 },
  };
  const NIMBY_PER_KM = 6; // 高架贴着密集区走：隔音罩 + 补偿，亿/公里

  // ---- 现状（不随方案变） ----
  const straightKm = (i, j) => Math.abs(ZONES[i].x - ZONES[j].x);
  const roadKm = (i, j) => (i === j ? TOY.intraKm : TOY.roadFactor * straightKm(i, j));
  const crossesHarbour = (i, j) => Math.min(i, j) <= 6 && Math.max(i, j) >= 7;
  const busFare = (i, j) => TOY.busFareBase + TOY.busFarePerKm * roadKm(i, j);
  const busRideMin = (i, j) => roadKm(i, j) / TOY.busSpeed * 60;

  function gcBus(i, j) {
    return 2 * TOY.walkMin + TOY.waitWeight * TOY.busHalfHeadway + busRideMin(i, j) + busFare(i, j) / REAL.vot;
  }
  function gcCar(i, j) {
    const km = roadKm(i, j);
    const money = TOY.carCostPerKm * km + ZONES[j].park + (crossesHarbour(i, j) ? TOY.harbourToll : 0);
    return TOY.carTerminalMin + km / TOY.carSpeed * 60 + money / REAL.vot;
  }

  // F1 接驳：从分区 i 到车站 a（同区步行；否则坐接驳巴士，外加换乘惩罚）
  function access(i, a) {
    if (i === a) return TOY.walkMin;
    return TOY.walkMin + TOY.waitWeight * TOY.busHalfHeadway + busRideMin(i, a) + TOY.transferMin;
  }

  // F5 票价
  const fare = (a, b, mult) => (REAL.fareBase + REAL.farePerKm * straightKm(a, b)) * mult;

  // F8 拥挤系数
  function crowdFactor(lf) {
    if (lf <= 0.8) return 1;
    if (lf <= 1.2) return 1 + 1.5 * (lf - 0.8);
    return 1.6 + 4 * (lf - 1.2);
  }

  const BASE = (function () {
    const H = [];   // 住在 i、在 j 上班的人数（全日单程）
    for (let i = 0; i < N; i++) {
      const w = ZONES.map((z, j) => z.jobs * Math.exp(-TOY.beta * roadKm(i, j)));
      const sw = w.reduce((s, v) => s + v, 0);
      H.push(w.map(v => ZONES[i].pop * TOY.tripsPerResident * v / sw));
    }
    const od = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const gb = gcBus(i, j), gc = gcCar(i, j);
      const vPT = -REAL.theta * gb + TOY.ascPT, vCar = -REAL.theta * gc;
      od.push({
        i, j, H: H[i][j], gcBus: gb, gcCar: gc,
        p0: 1 / (1 + Math.exp(vCar - vPT)),
        busFare: busFare(i, j), roadKm: roadKm(i, j),
      });
    }
    return { H, od };
  })();

  // ---- 方案 → 线路 ----
  function buildLine(design) {
    const st = [...new Set(design.stations)].sort((a, b) => a - b);
    const type = BUILD[design.build];
    const segByK = new Array(N - 1).fill(null);
    const segs = [];
    if (st.length >= 2) {
      for (let k = st[0]; k < st[st.length - 1]; k++) {
        const len = ZONES[k + 1].x - ZONES[k].x;
        const terr = SEG_TERRAIN[k];
        const speed = terr ? (design.build === 'grade' ? 50 : 60) : type.speed;
        const perKm = terr ? TERRAIN[terr].perKm : type.perKm;
        const nimby = !terr && design.build === 'elevated' && (ZONES[k].dense || ZONES[k + 1].dense)
          ? NIMBY_PER_KM * len : 0;
        const g = { k, len, terr, speed, cost: perKm * len, nimby, runMin: len / speed * 60 };
        segs.push(g);
        segByK[k] = g;
      }
    }
    const stCum = [0];   // stCum[m] = 编号小于 m 的车站数
    for (let m = 0; m < N; m++) stCum.push(stCum[m] + (st.includes(m) ? 1 : 0));
    const length = segs.reduce((s, g) => s + g.len, 0);
    return { st, segs, segByK, stCum, length, type, capHour: type.cap * 60 / design.headway };
  }

  // 一次"给定拥挤 → 算选择 → 装到线上"（F2–F7）
  function assignOnce(line, design, cf) {
    const cum = [new Array(N).fill(0), new Array(N).fill(0)];
    const cumFree = new Array(N).fill(0);
    for (let k = 0; k < N - 1; k++) {
      const run = line.segByK[k] ? line.segByK[k].runMin : 0;
      cum[0][k + 1] = cum[0][k] + run * cf[0][k];
      cum[1][k + 1] = cum[1][k] + run * cf[1][k];
      cumFree[k + 1] = cumFree[k] + run;
    }
    const waitMin = design.headway / 2;                 // F3
    const loads = [new Array(N - 1).fill(0), new Array(N - 1).fill(0)];
    const res = BASE.od.map(o => {
      let best = null;
      for (const a of line.st) for (const b of line.st) {
        if (a === b) continue;
        const dir = b > a ? 0 : 1, lo = Math.min(a, b), hi = Math.max(a, b);
        const stops = line.stCum[hi] - line.stCum[lo + 1];
        const ride = cum[dir][hi] - cum[dir][lo] + TOY.dwellMin * stops;   // F2（含拥挤）
        const acc = access(o.i, a), egr = access(o.j, b);
        const f = fare(a, b, design.fareMult);
        const gc = acc + TOY.waitWeight * waitMin + ride + egr + f / REAL.vot;
        if (!best || gc < best.gc) {
          best = { a, b, dir, lo, hi, stops, gc, acc, egr, ride, fare: f, waitMin,
                   rideFree: cumFree[hi] - cumFree[lo] + TOY.dwellMin * stops };
        }
      }
      const gcPT1 = Math.min(o.gcBus, best.gc);                            // F4
      const s = 1 / (1 + Math.exp(-TOY.thetaRoute * (o.gcBus - best.gc)));
      const e = o.p0 * Math.exp(-REAL.theta * (gcPT1 - o.gcBus));          // F6
      const p1 = e / (e + 1 - o.p0);
      const mtr = p1 * s;
      const q = TOY.peakShare * o.H * mtr;                                 // F7
      for (let k = best.lo; k < best.hi; k++) loads[best.dir][k] += q;
      return { best, gcPT1, s, p1, mtr };
    });
    return { res, loads };
  }

  function evaluate(design) {
    const line = buildLine(design);
    if (line.st.length < 2) return { ok: false, reason: '至少要有两个车站' };

    const lfOf = loads => loads.map(arr => arr.map((v, k) => (line.segByK[k] ? v / line.capHour : 0)));
    const maxOf = m => Math.max(...m[0], ...m[1]);
    const ridersOf = mtr => mtr.reduce((s, v, idx) => s + 2 * BASE.od[idx].H * v, 0);

    // F9 迭代：拥挤 ↔ 选择，逐轮平均（MSA）
    const ones = new Array(N - 1).fill(1);
    let avgLoads = null, avgP1 = null, avgMtr = null, last = null;
    const history = [];
    for (let n = 1; n <= TOY.maxIter; n++) {
      const cf = avgLoads ? lfOf(avgLoads).map(arr => arr.map(crowdFactor)) : [ones, ones];
      last = assignOnce(line, design, cf);
      if (n === 1) {
        avgLoads = last.loads.map(a => a.slice());
        avgP1 = last.res.map(r => r.p1);
        avgMtr = last.res.map(r => r.mtr);
      } else {
        const w = 1 / n;
        for (let d = 0; d < 2; d++) for (let k = 0; k < N - 1; k++) {
          avgLoads[d][k] += w * (last.loads[d][k] - avgLoads[d][k]);
        }
        last.res.forEach((r, idx) => {
          avgP1[idx] += w * (r.p1 - avgP1[idx]);
          avgMtr[idx] += w * (r.mtr - avgMtr[idx]);
        });
      }
      const riders = ridersOf(avgMtr), maxLF = maxOf(lfOf(avgLoads));
      const h = { n, riders, maxLF, change: null };
      if (n > 1) {
        const p = history[n - 2];
        h.change = Math.max(Math.abs(riders - p.riders) / Math.max(p.riders, 1),
                            Math.abs(maxLF - p.maxLF) / Math.max(p.maxLF, 1e-9));
      }
      history.push(h);
      if (h.change !== null && h.change < TOY.tol) break;
    }
    const converged = history[history.length - 1].change !== null
      && history[history.length - 1].change < TOY.tol;

    // ---- 汇总 ----
    let trips = 0, bus0 = 0, car0 = 0, bus1 = 0, mtrDay = 0, fromCar = 0;
    let revenueDay = 0, pkm = 0, benefitMinDay = 0, dVkmDay = 0, busLostDay = 0;
    const roadBefore = [new Array(N - 1).fill(0), new Array(N - 1).fill(0)];
    const roadAfter = [new Array(N - 1).fill(0), new Array(N - 1).fill(0)];
    const ods = BASE.od.map((o, idx) => {
      const r = last.res[idx];
      const daily = 2 * o.H, p1 = avgP1[idx], mtr = avgMtr[idx];
      trips += daily; bus0 += daily * o.p0; car0 += daily * (1 - o.p0);
      bus1 += daily * (p1 - mtr); mtrDay += daily * mtr;
      fromCar += Math.min(daily * (p1 - o.p0), daily * mtr);
      revenueDay += daily * mtr * r.best.fare;
      pkm += daily * mtr * straightKm(r.best.a, r.best.b);
      const dGC = o.gcBus - r.gcPT1;
      benefitMinDay += 0.5 * (daily * o.p0 + daily * p1) * dGC;           // F12 半数法则
      dVkmDay += daily * (p1 - o.p0) / REAL.carOcc * o.roadKm;             // F10
      busLostDay += daily * (o.p0 - (p1 - mtr)) * o.busFare;
      const dir = o.j > o.i ? 0 : 1, lo = Math.min(o.i, o.j), hi = Math.max(o.i, o.j);
      for (let k = lo; k < hi; k++) {
        roadBefore[dir][k] += TOY.peakShare * o.H * (1 - o.p0) / REAL.carOcc;
        roadAfter[dir][k] += TOY.peakShare * o.H * (1 - p1) / REAL.carOcc;
      }
      return { i: o.i, j: o.j, H: o.H, p0: o.p0, p1, mtr, s: r.s, gcBus: o.gcBus, gcCar: o.gcCar,
               gcPT1: r.gcPT1, best: r.best };
    });

    const Y = TOY.annualDays;
    const AF = (1 - Math.pow(1 + TOY.rate, -TOY.years)) / TOY.rate;
    const capexTrack = line.segs.reduce((s, g) => s + g.cost, 0);
    const capexNimby = line.segs.reduce((s, g) => s + g.nimby, 0);
    const capexStations = line.st.length * line.type.station;
    const capex = capexTrack + capexNimby + capexStations;                 // F11
    const trainKmDay = 2 * line.length * (60 / design.headway) * TOY.fullFreqHours;
    const opexYr = trainKmDay * 365 * line.type.opexPerTrainKm / 1e8;
    const revenueYr = revenueDay * Y / 1e8;                                // F12
    const timeYr = benefitMinDay * REAL.vot * Y / 1e8;
    const decongYr = dVkmDay * TOY.congestionPerVkm * Y / 1e8;
    const co2TonYr = dVkmDay * TOY.co2PerVkm * Y / 1000;
    const emissionYr = co2TonYr * 1000 * TOY.carbonPrice / 1e8;
    const busLostYr = busLostDay * (1 - TOY.busCostSave) * Y / 1e8;   // 巴士公司净损失
    const PVB = (timeYr + decongYr + emissionYr - busLostYr) * AF;         // F13
    const PVC = capex + (opexYr - revenueYr) * AF;
    const bcr = PVC > 0 ? PVB / PVC : Infinity;
    const npv = PVB - PVC;                                                 // 主分数

    const lf = lfOf(avgLoads);
    const maxLF = maxOf(lf);
    return {
      ok: true, design, line, history, converged, AF,
      loads: avgLoads, lf, maxLF, crowd: lf.map(a => a.map(crowdFactor)),
      roadBefore, roadAfter, ods,
      trips, bus0, car0, bus1, mtrDay, fromCar, fromBus: mtrDay - fromCar,
      avgSavedMin: benefitMinDay / Math.max(mtrDay, 1),
      pkm, utilization: pkm / (trainKmDay * line.type.cap),
      dVkmDay, co2TonYr,
      money: { capex, capexTrack, capexNimby, capexStations, opexYr, revenueYr, timeYr, decongYr,
               emissionYr, busLostYr, PVB, PVC, bcr, npv, finRatio: revenueYr / opexYr },
      overBudget: capex > TOY.budget,
      overCrowd: maxLF > TOY.crowdLimit,
      underFunded: revenueYr < opexYr,
      score: Math.round(npv),
    };
  }

  const api = { REAL, TOY, ZONES, SEG_TERRAIN, TERRAIN, BUILD, NIMBY_PER_KM, BASE,
                straightKm, roadKm, access, fare, crowdFactor, buildLine, evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TL = api;
})(typeof window !== 'undefined' ? window : globalThis);
