/* 不可通行区域的边界：海、水塘不能当路走。
 * 用法（项目根目录）：node --test game-demo/tests/
 * 需要先跑 game-demo/build_data.py（data-road.js 带 nodeOK、data-land.js）。
 *
 * 查四件事：
 *   ① 桥头吸附：点在海上不接；点在岸上只接「能接新桥」的地面路口，而且点和路口之间不隔海
 *      （随机撒点 + 维港两岸、南丫岛、马湾这些以前容易出错的地方）
 *   ② 修桥页的例子都能算，桥头点在海上会报错而不是偷偷挪到对岸
 *   ③ 地铁：线头伸进海里会收回岸上，站不会落在海上
 *   ④ 走路进站不隔海：港岛的站只有港岛的区能走进去，九龙/新界的站走不到港岛（随机撒站检查）
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.resolve(__dirname, '..');
global.window = globalThis;
for (const f of ['data.js', 'data-metro.js', 'data-road.js', 'data-land.js']) require(path.join(DIR, f));
const Land = require(path.join(DIR, 'land.js'));
const Road = require(path.join(DIR, 'road.js'));
const E = require(path.join(DIR, 'engine.js'));
const Sim = require(path.join(DIR, 'sim.js'));
Land.init(window.LAND_DATA);
const D = E.init(window.GAME_DATA);
E.useRoad(Road);
Sim.init(E, window.METRO_DATA, window.ROAD_DATA);
const R = Road.g;

// 固定种子的随机数，每次跑结果一样
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const BOX = { lon: [113.83, 114.43], lat: [22.15, 22.56] };
const HK_ISLAND = new Set(['中西区', '湾仔区', '东区', '南区']);
const nodeLL = v => [R.lon[v], R.lat[v]];

test('数据带着边界信息', () => {
  assert.ok(R.ok, 'data-road.js 没有 nodeOK：重跑 game-demo/build_data.py');
  assert.ok(Land.ready);
  // 几个一看就知道答案的点
  assert.ok(Land.isWater(114.1750, 22.2890), '维港中间应是水');
  assert.ok(Land.isWater(114.2450, 22.4650), '船湾淡水湖应是水');
  assert.ok(!Land.isWater(114.1720, 22.3000), '尖沙咀应是陆地');
  assert.ok(!Land.isWater(114.1580, 22.2800), '中环应是陆地');
  assert.ok(!Land.isWater(114.1860, 22.3830), '沙田应是陆地');
});

test('① 桥头吸附：随机撒点，不点海上、不隔海接路口、只接地面路口', () => {
  const r = rng(20260925);
  let water = 0, snapped = 0, noroad = 0;
  for (let k = 0; k < 1500; k++) {
    const p = [BOX.lon[0] + r() * (BOX.lon[1] - BOX.lon[0]), BOX.lat[0] + r() * (BOX.lat[1] - BOX.lat[0])];
    const s = Road.snap(p[0], p[1]);
    if (Land.isWater(p[0], p[1])) {
      water++;
      assert.strictEqual(s.node, -1, `海上的点 ${p} 不该接到路口`);
      assert.strictEqual(s.reason, 'water');
      continue;
    }
    if (s.node < 0) { noroad++; assert.strictEqual(s.reason, 'noroad'); continue; }
    snapped++;
    assert.strictEqual(R.ok[s.node], 1, `${p} 接到了不能接桥的路口 ${s.node}（桥面/隧道/收费/快速公路）`);
    assert.strictEqual(R.main[s.node], 1, `${p} 接到了不在主路网上的路口`);
    assert.ok(s.km <= 2.001, `${p} 接到了 ${s.km.toFixed(2)} 公里外`);
    const wet = Land.widestWaterKm(p, nodeLL(s.node));
    assert.ok(wet <= Land.WADE_KM, `${p} → 路口 ${s.node} 中间隔着 ${(wet * 1000).toFixed(0)} 米水`);
  }
  console.log(`   随机 1500 点：海上 ${water}（都拒绝），接上路口 ${snapped}，2 公里内没路 ${noroad}`);
  assert.ok(snapped > 200 && water > 500);
});

test('① 桥头吸附：以前容易出错的地方', () => {
  const cases = [
    // [名字, 点, 检查]
    ['维港中间', [114.1750, 22.2890], s => s.node === -1 && s.reason === 'water'],
    ['尖沙咀东（九龙岸）', [114.1760, 22.2975], s => s.node >= 0 && R.lat[s.node] > 22.292],
    ['湾仔北（港岛岸）', [114.1750, 22.2810], s => s.node >= 0 && R.lat[s.node] < 22.287],
    ['鲤鱼门 油塘岸', [114.2380, 22.2960], s => s.node >= 0 && R.lat[s.node] > 22.290],
    ['鲤鱼门 筲箕湾岸', [114.2320, 22.2800], s => s.node >= 0 && R.lat[s.node] < 22.286],
    ['南丫岛（不能接到香港仔）', [114.1240, 22.2100], s => s.node === -1 || R.lat[s.node] < 22.235],
    ['马湾（不能接到青衣或大屿山）', [114.0600, 22.3500], s => s.node === -1 || E.km([114.0600, 22.3500], nodeLL(s.node)) < 1.5],
    ['船湾淡水湖', [114.2450, 22.4650], s => s.node === -1 && s.reason === 'water'],
  ];
  for (const [name, p, ok] of cases) {
    const s = Road.snap(p[0], p[1]);
    assert.ok(ok(s), `${name}：接到了 ${s.node >= 0 ? nodeLL(s.node).map(x => x.toFixed(4)) : s.reason}`);
  }
});

test('② 修桥：例子都能算；桥头点在海上会报错', () => {
  const src = fs.readFileSync(path.join(DIR, 'app.js'), 'utf8');
  const ex = [...src.matchAll(/name: '([^']+)', a: \[([\d.]+), ([\d.]+)\], b: \[([\d.]+), ([\d.]+)\]/g)];
  assert.ok(ex.length >= 3, '没读到修桥页的例子');
  for (const m of ex) {
    const R1 = E.evaluate([+m[2], +m[3]], [+m[4], +m[5]]);
    assert.ok(!R1.error, `${m[1]}：${R1.error}`);
    for (const end of [R1.A, R1.B]) assert.strictEqual(R.ok[end.node], 1, `${m[1]}：桥头接到了不能接的路口`);
  }
  const bad = E.evaluate([114.1750, 22.2890], [114.1720, 22.3000]);
  assert.strictEqual(bad.error, 'water');
  assert.strictEqual(bad.end, 'A');
});

test('③ 地铁：线头收回岸上，站不落在海上', () => {
  // 从维港中间画到九龙塘：线头要收回九龙岸上
  const t = Sim.trimToLand([[114.1750, 22.2890], [114.1760, 22.3370]]);
  assert.ok(t && !Land.isWater(...t[0]) && !Land.isWater(...t[t.length - 1]));
  assert.ok(t[0][1] > 22.292, '线头应收回到尖沙咀东岸上');
  // 整条在海上
  assert.strictEqual(Sim.trimToLand([[114.1700, 22.2895], [114.1800, 22.2890]]), null);
  // 中环 → 尖沙咀过海，中间那个站按间距会落在海上：要挪到岸上或取消
  const cross = [[114.1580, 22.2830], [114.1720, 22.2990]];
  const len = E.km(cross[0], cross[1]);
  const st = Sim.landStations(cross, [0, len / 2, len]);
  const line = Sim.lineFrom(cross, st);
  line.stations.forEach((p, k) => assert.ok(!Land.isWater(p[0], p[1]), `过海线第 ${k + 1} 站在海上`));
  // 地铁页的例子
  const src = fs.readFileSync(path.join(DIR, 'metro.js'), 'utf8');
  const ex = [...src.matchAll(/name: '([^']+)', st: (\[\[.*?\]\])/g)];
  assert.ok(ex.length >= 1, '没读到地铁页的例子');
  for (const m of ex) {
    const pts = JSON.parse(m[2]);
    const c = [0]; for (let k = 1; k < pts.length; k++) c.push(c[k - 1] + E.km(pts[k - 1], pts[k]));
    const l = Sim.lineFrom(pts, Sim.landStations(pts, c));
    assert.strictEqual(l.stations.length, pts.length, `${m[1]}：有站被挪掉了（例子的站应都在岸上）`);
    l.stations.forEach((p, k) => assert.ok(!Land.isWater(p[0], p[1]), `${m[1]} 第 ${k + 1} 站在海上`));
  }
});

test('④ 走路进站不隔海：港岛和九龙/新界互相走不过去（随机撒站）', () => {
  const r = rng(7);
  const stations = [[114.1720, 22.2975], [114.1580, 22.2830], [114.2380, 22.2960], [114.2320, 22.2800]];
  while (stations.length < 400) {
    const p = [114.10 + r() * 0.16, 22.26 + r() * 0.06];   // 维港两岸一带
    if (!Land.isWater(p[0], p[1]) && E.zoneAt(p[0], p[1]) >= 0) stations.push(p);
  }
  let pairs = 0;
  for (let q = 0; q < stations.length; q += 40) {
    const group = stations.slice(q, q + 40);
    const line = { stations: group };
    const { walkOK } = Sim.accessInfo(line);
    const S = group.length;
    group.forEach((p, s) => {
      const island = HK_ISLAND.has(D.zones[E.zoneAt(p[0], p[1])].district);
      for (let i = 0; i < D.n; i++) {
        if (!walkOK[i * S + s]) continue;
        pairs++;
        assert.strictEqual(HK_ISLAND.has(D.zones[i].district), island,
          `站 ${p.map(x => x.toFixed(4))}（${island ? '港岛' : '九龙'}）能走到对岸的「${D.zones[i].name}」`);
      }
    });
  }
  console.log(`   维港两岸随机 ${stations.length} 个站，能走进站的分区-车站对 ${pairs} 个，没有一对隔着维港`);
  assert.ok(pairs > 400);
});
