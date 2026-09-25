/* 早高峰真实路网（来自 pipeline/27 的分配结果），修桥页和修地铁页共用。
 * 功能：最短路（正向：从一点到各处；反向：各处到一点）、把点吸附到最近的真实路口、还原车实际开的路线。
 * 每个交通分区有一个「出发点」（只有出边）和一个「到达点」（只有入边），路径不会穿过分区中心。
 */
(function (root) {
  'use strict';

  let R = null;

  function decode(raw, type) {
    const bin = typeof atob === 'function' ? atob(raw) : Buffer.from(raw, 'base64').toString('binary');
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    return new type(bytes.buffer);
  }

  function csr(N, from, to, E) {
    const off = new Int32Array(N + 1);
    for (let e = 0; e < E; e++) off[from[e] + 1]++;
    for (let v = 0; v < N; v++) off[v + 1] += off[v];
    const fill = off.slice(0, N), adj = new Int32Array(E);
    for (let e = 0; e < E; e++) adj[fill[from[e]]++] = e;
    return { off, adj };
  }

  function init(raw) {
    if (R) return R;
    const src = decode(raw.src, Int32Array), dst = decode(raw.dst, Int32Array);
    const N = raw.nNodes, E = src.length, nRoad = raw.nRoad;
    const free = decode(raw.free, Float32Array), cap = decode(raw.cap, Float32Array), vol = decode(raw.vol, Float32Array);
    const conn = decode(raw.connMin, Float32Array);
    const [a, b] = raw.bpr;
    // 每段路的 BPR alpha（一般 0.15；隧道串按排队时间放大，与 pipeline/27 相同）
    const alpha = raw.alpha ? decode(raw.alpha, Float32Array) : new Float32Array(nRoad).fill(a);
    const base = new Float64Array(E);
    for (let e = 0; e < E; e++) base[e] = e < nRoad ? Math.max(1e-3, free[e] * (1 + alpha[e] * Math.pow(vol[e] / cap[e], b))) : Math.max(1e-3, conn[e - nRoad]);
    R = { N, E, nRoad, src, dst, free, cap, vol, alpha, base, bpr: [a, b], fwd: csr(N, src, dst, E), rev: csr(N, dst, src, E),
          name: decode(raw.name, Uint16Array), names: raw.names, origin: raw.origin, dest: raw.dest,
          nRoadNodes: raw.nRoadNodes, lon: decode(raw.nodeLon, Float32Array), lat: decode(raw.nodeLat, Float32Array),
          ok: raw.nodeOK ? decode(raw.nodeOK, Uint8Array) : null,
          dist: new Float64Array(N), pred: new Int32Array(N), order: new Int32Array(N), acc: new Float64Array(N),
          hk: new Float64Array(E + N), hv: new Int32Array(E + N) };
    // 只吸附到主路网上的路口（从一个分区出发能到、也能回到这个分区）
    const hub = raw.origin[Math.floor(raw.origin.length / 2)], hubIn = raw.dest[Math.floor(raw.dest.length / 2)];
    dijkstra(hub, base, false); const out = Float64Array.from(R.dist);
    dijkstra(hubIn, base, true);
    R.main = new Uint8Array(R.nRoadNodes);
    for (let v = 0; v < R.nRoadNodes; v++) R.main[v] = Number.isFinite(out[v]) && Number.isFinite(R.dist[v]) && R.lon[v] > 0 ? 1 : 0;
    return R;
  }

  // 最短路。reverse=false：从 s 到各点；reverse=true：各点到 s。
  // 正向时 pred[v] = 进入 v 的那条路；反向时 pred[v] = 从 v 出去、朝 s 走的那条路。
  function dijkstra(s, w, reverse) {
    const { dist, pred, order, hk, hv, src, dst } = R;
    const { off, adj } = reverse ? R.rev : R.fwd, next = reverse ? src : dst;
    dist.fill(Infinity); pred.fill(-1);
    let hn = 0, cnt = 0;
    const push = (k, v) => { let i = hn++; while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; } hk[i] = k; hv[i] = v; };
    const pop = () => { const v = hv[0], lk = hk[--hn], lv = hv[hn]; let i = 0;
      while (true) { let c = 2 * i + 1; if (c >= hn) break; if (c + 1 < hn && hk[c + 1] < hk[c]) c++; if (hk[c] >= lk) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; }
      hk[i] = lk; hv[i] = lv; return v; };
    dist[s] = 0; push(0, s);
    while (hn > 0) {
      const k0 = hk[0], u = pop();
      if (k0 > dist[u]) continue;
      order[cnt++] = u;
      for (let q = off[u], qe = off[u + 1]; q < qe; q++) {
        const e = adj[q], v = next[e], nd = k0 + w[e];
        if (nd < dist[v]) { dist[v] = nd; pred[v] = e; push(nd, v); }
      }
    }
    return cnt;
  }

  // 桥头接到哪个路口：离点的地方最近、能接新桥的地面路口（在陆地上，不连桥面、隧道、收费广场、快速公路；
  // 见 build_data.py 的 bridge_heads），而且从点的地方到路口之间不隔着海或水塘（land.js）。
  // 点在海上、或 2 公里内没有这样的路口（比如不通车的离岛、郊野公园深处）就不接：node = -1，reason 说原因。
  const SNAP_MAX_KM = 2;
  const landMod = () => { const l = root.Land || (typeof require === 'function' ? require('./land.js') : null); return l && l.ready ? l : null; };
  function snap(lon, lat) {
    const land = landMod();
    if (land && land.isWater(lon, lat)) return { node: -1, reason: 'water', lon, lat, km: 0 };
    const kx = Math.cos(lat * Math.PI / 180), lim = (SNAP_MAX_KM / 111.2) ** 2, cand = [];
    for (let v = 0; v < R.nRoadNodes; v++) {
      if (!R.main[v] || (R.ok && !R.ok[v])) continue;
      const dx = (R.lon[v] - lon) * kx, dy = R.lat[v] - lat, d = dx * dx + dy * dy;
      if (d <= lim) cand.push([d, v]);
    }
    cand.sort((x, y) => x[0] - y[0]);
    for (const [d, v] of cand) {
      if (land && !land.dryPath([lon, lat], [R.lon[v], R.lat[v]])) continue;
      return { node: v, lon: R.lon[v], lat: R.lat[v], km: Math.sqrt(d) * 111.2 };
    }
    return { node: -1, reason: 'noroad', lon, lat, km: Infinity };
  }

  // 还原路线（只取真实路口，跳过分区的出发点/到达点）
  function pathToward(pred, start, target) {           // 反向最短路的结果：从 start 一路走到 target
    const out = []; let u = start, guard = 0;
    while (u !== target && u >= 0 && guard++ < 100000) { if (u < R.nRoadNodes) out.push([R.lat[u], R.lon[u]]); const e = pred[u]; if (e < 0) break; u = R.dst[e]; }
    if (u === target && u < R.nRoadNodes) out.push([R.lat[u], R.lon[u]]);
    return out;
  }
  function pathFrom(pred, source, end) {                 // 正向最短路的结果：从 source 走到 end
    const out = []; let u = end, guard = 0;
    while (u !== source && u >= 0 && guard++ < 100000) { if (u < R.nRoadNodes) out.push([R.lat[u], R.lon[u]]); const e = pred[u]; if (e < 0) break; u = R.src[e]; }
    if (u === source && u < R.nRoadNodes) out.push([R.lat[u], R.lon[u]]);
    return out.reverse();
  }

  const api = { init, dijkstra, snap, pathToward, pathFrom, get g() { return R; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Road = api;
})(typeof window !== 'undefined' ? window : globalThis);
