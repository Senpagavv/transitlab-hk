'use strict';
const assert=require('node:assert/strict');
const M=require('./engine.js');
const M2=require('../mode2-metro/engine.js');
const {D,Plan,same,destinationsFor,originsFor,landQuote}=M;
let passed=0;
function test(name,fn){fn();passed++;console.log('✓ '+name);}
function setup(cells=[[5,2]]){
  const p=new Plan();
  for(const c of cells)assert.equal(p.extend(c),true);
  for(const c of cells)assert.equal(p.toggleStation(c),true);
  return p;
}
test('空地必须在站旁一圈，而且确实是地图空地',()=>{
  const p=new Plan();assert.equal(p.canSell([5,1]),false);
  p.extend([5,2]);p.toggleStation([5,2]);
  assert.equal(p.canSell([5,1]),true);
  assert.equal(p.canSell([7,2]),false);
  assert.equal(p.canSell([2,2]),false);
});
test('每个年度窗口最多选择两块，未锁定时可以撤回',()=>{
  const p=setup();assert.ok(p.sellLand([5,1],'home'));assert.ok(p.sellLand([6,1],'shop'));
  assert.equal(p.sellLand([5,3],'home'),null);assert.equal(p.pendingSales.length,2);
  assert.equal(p.cancelSale([6,1]),true);assert.ok(p.sellLand([5,3],'home'));assert.equal(p.pendingSales.length,2);
});
test('住宅地增加 16 位全知道新线的居民',()=>{
  const p=setup();p.sellLand([5,1],'home');
  const y=p.now(),home=y.origins.find(o=>o.home);
  assert.equal(home.people,M.P.homePeople);assert.equal(home.people,16);
  assert.equal(p.awareFor().at(-1),1);assert.equal(y.est.at(-1).aware,1);
});
test('商业地按同站合并，吸引力是 4 + 6 × 块数',()=>{
  const p=setup();p.sellLand([5,1],'shop');p.sellLand([6,1],'shop');
  const mall=destinationsFor(p.allSales()).find(d=>d.kind==='shop');
  assert.equal(mall.attraction,4+6*2);assert.equal(mall.shopCount,2);
});
test('住宅地价手算：拉力合计 14，再乘 homeRate 3 得 42',()=>{
  const p=setup();const q=p.quote([5,1],'home');
  assert.equal(q.ok,true);assert.equal(q.price,M.P.homeRate*14);assert.equal(q.price,42);
});
test('商业售价按新增每日商场访客乘 shopRate',()=>{
  const p=setup();const q=p.quote([5,1],'shop');
  assert.ok(q.delta>0);assert.equal(q.price,M.P.shopRate*q.delta);
  const sale=p.sellLand([5,1],'shop');assert.equal(sale.price,q.price);
});
test('开发在按下一年时锁定，收入加入当年总账',()=>{
  const p=new Plan();for(const c of [[5,2],[6,2]])p.extend(c);
  p.toggleStation([5,2]);p.toggleStation([6,2]);p.sellLand([5,1],'home');
  const revenue=p.pendingSales.reduce((s,x)=>s+x.price,0),run=p.runYear();
  assert.ok(run);assert.equal(run.revenue,revenue);assert.equal(run.ledger,run.riders+revenue);
  assert.equal(p.cancelSale([5,1]),false);assert.equal(p.sales.length,1);
});
test('下一年开始可再卖两块，开发影响后续客流',()=>{
  const p=new Plan();for(const c of [[5,2],[6,2]])p.extend(c);
  p.toggleStation([5,2]);p.toggleStation([6,2]);p.sellLand([5,1],'home');p.runYear();
  assert.equal(p.pendingSales.length,0);assert.ok(p.sellLand([6,1],'shop'));assert.ok(p.sellLand([5,3],'home'));
  assert.equal(p.sellLand([8,3],'shop'),null);
  assert.equal(p.now().origins.length,D.origins.length+2);
});
test('simulate() 与逐年按按钮的八年结果一致',()=>{
  const p=new Plan();for(const c of [[10,1],[9,1],[8,1]])p.extend(c);
  p.toggleStation([10,1]);p.toggleStation([8,1]);
  const sim=p.simulate(),manual=new Plan();Object.assign(manual,JSON.parse(JSON.stringify({...p})));manual.rewind();
  while(!manual.done)manual.runYear();
  assert.equal(sim.year,8);assert.equal(sim.total,manual.total);
  assert.deepEqual(sim.log.map(x=>x.riders),manual.log.map(x=>x.riders));
});
test('不卖地时与模式 2 用同一份地图规则的分数完全相同',()=>{
  const d=D.example('m4-1');delete d.land;delete d.homePeople;delete d.shopBase;delete d.shopPer;delete d.homeRate;delete d.shopRate;delete d.carExtra;
  M2.D.use(d,'tod-parity');M2.reset();
  const a=new Plan(),b=new M2.Plan(),line=[[10,1],[9,1],[8,1]],stations=[[10,1],[8,1]];
  for(const c of line){a.extend(c);b.extend(c);}
  for(const c of stations){a.toggleStation(c);b.toggleStation(c);}
  assert.equal(a.simulate().total,b.simulate().total);
});
test('simulate() 會按記錄年份重放賣地再逐年結算',()=>{
  const line=[[5,6],[6,6],[7,6],[8,6],[9,6],[10,6],[10,5],[10,4],[10,3],[10,2],[10,1],[9,1],[8,1],[7,1],[7,2]];
  const stations=[[5,6],[10,1],[7,2],[10,4]],p=new Plan();
  for(const c of line)p.extend(c);for(const c of stations)p.toggleStation(c);
  assert.ok(p.sellLand([9,3],'shop'));p.runYear();assert.ok(p.sellLand([11,3],'home'));
  const sim=p.simulate(),manual=new Plan();for(const c of line)manual.extend(c);for(const c of stations)manual.toggleStation(c);
  assert.ok(manual.sellLand([9,3],'shop'));manual.runYear();assert.ok(manual.sellLand([11,3],'home'));
  while(!manual.done)manual.runYear();
  assert.equal(sim.total,manual.total);assert.deepEqual(sim.log.map(x=>x.revenue),manual.log.map(x=>x.revenue));
});
test('商場來客隨知曉率增加，晚一點賣同類地可更貴',()=>{
  const p=new Plan();
  for(const c of [[5,6],[6,6],[7,6],[8,6],[9,6],[10,6],[10,5],[10,4],[10,3],[10,2],[10,1],[9,1],[8,1],[7,1],[7,2]])p.extend(c);
  for(const c of [[5,6],[10,1],[7,2],[10,4]])p.toggleStation(c);
  const first=p.quote([9,3],'shop').price;p.runYear();p.runYear();const later=p.quote([9,3],'shop').price;
  assert.ok(later>first);console.log('  same shop lot price: '+first.toFixed(2)+' → '+later.toFixed(2));
});
console.log('PASS '+passed+' checks');
