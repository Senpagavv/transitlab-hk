/* 陆地 / 水面（data-land.js：规划署 2024 土地用途 10 米格网里的海和水塘，并成约 40 米一格）。
 * 修桥页和修地铁页共用：桥头、车站只能放在陆地上；走路进站、桥头接路口都不能隔着海或水塘。
 * 格网以外（深圳、外海）一律算水。
 */
(function (root) {
  'use strict';

  let G = null;
  const WADE_KM = 0.08;   // 直线上最多容许 80 米的水：窄河涌、码头边、格子边缘的误差；维港最窄的鲤鱼门也有 300 多米

  function init(raw) {
    if (G) return G;
    const bin = typeof atob === 'function' ? atob(raw.bits) : Buffer.from(raw.bits, 'base64').toString('binary');
    const bits = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bits[k] = bin.charCodeAt(k);
    G = { lon0: raw.lon0, lat0: raw.lat0, d: raw.d, nx: raw.nx, ny: raw.ny, bits };
    return G;
  }

  // 这点是不是水（海或水塘）
  function isWater(lon, lat) {
    const i = Math.floor((lon - G.lon0) / G.d), j = Math.floor((lat - G.lat0) / G.d);
    if (!(i >= 0 && j >= 0 && i < G.nx && j < G.ny)) return true;
    const k = j * G.nx + i;
    return ((G.bits[k >> 3] >> (7 - (k & 7))) & 1) === 1;
  }

  const KX = 111.32 * Math.cos(22.35 * Math.PI / 180), KY = 110.57;
  // 两点直线上有多少公里是水（每 20 米看一次）
  function waterKm(a, b) {
    const d = Math.hypot((b[0] - a[0]) * KX, (b[1] - a[1]) * KY), N = Math.max(2, Math.ceil(d / 0.02));
    let wet = 0;
    for (let k = 0; k < N; k++) { const f = (k + 0.5) / N; if (isWater(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)) wet++; }
    return d * wet / N;
  }
  // 两点直线上最长一段连续的水有多长（公里）
  function widestWaterKm(a, b) {
    const d = Math.hypot((b[0] - a[0]) * KX, (b[1] - a[1]) * KY), N = Math.max(2, Math.ceil(d / 0.02));
    let run = 0, most = 0;
    for (let k = 0; k < N; k++) {
      const f = (k + 0.5) / N;
      run = isWater(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f) ? run + 1 : 0;
      if (run > most) most = run;
    }
    return d * most / N;
  }
  // 两点之间能不能直接走过去（中间没有一段像样的水）
  function dryPath(a, b) { return widestWaterKm(a, b) <= WADE_KM; }

  const api = { init, isWater, waterKm, widestWaterKm, dryPath, WADE_KM, get ready() { return !!G; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.Land = api; if (root.LAND_DATA) init(root.LAND_DATA); }   // 网页里先载 data-land.js 再载本文件
})(typeof window !== 'undefined' ? window : globalThis);
