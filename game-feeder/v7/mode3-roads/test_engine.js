'use strict';
// Rule checks for v7 mode 3 «roads that jam». Run: node test_engine.js
const assert=require('node:assert/strict');
const M=require('./engine.js'),{Plan,D,P,G,year,spread,learnFrom,metroTrip,network,carRoute,carBlocks,expand,walk,same,key}=M;
let passed=0;function test(name,fn){fn();passed++;console.log('ok',name);}
const near=(a,b,e=1e-9)=>assert(Math.abs(a-b)<e,`${a} ≠ ${b}`);
require('./demo-plans.js');const DEMO=globalThis.TL_ROADS_DEMO[D.map];
function build(d){const p=new Plan();for(const c of d.line)assert(p.extend(c),'extend '+c);for(const s of d.stations)assert(p.toggleStation(s),'station '+s);
  for(let k=1;k<d.trains;k++)assert(p.addTrain());return p;}
test('The map: roads join up, every trip has a car route, the lines already there have their stations on them',()=>{
  const seen=new Set(),todo=[key(G.sections[0].a)],adjs=new Map();
  for(const s of G.sections)for(const [a,b] of [[s.a,s.b],[s.b,s.a]]){if(!adjs.has(key(a)))adjs.set(key(a),[]);adjs.get(key(a)).push(key(b));}
  while(todo.length){const k=todo.pop();if(seen.has(k))continue;seen.add(k);todo.push(...adjs.get(k));}
  assert.equal(seen.size,adjs.size,'one road network');
  G.carOD.forEach(r=>r.forEach(route=>{assert(route.sections.length>0,'drives on a road');assert(route.local<=4);}));
  for(const l of G.lines)for(const s of l.stations)assert(l.cells.some(c=>same(c,s)),'station on its line');
  for(const c of [...D.origins,...D.destinations].map(x=>x.cell))assert(c[0]>=0&&c[1]>=0&&c[0]<D.cols&&c[1]<D.rows);
});
test('Driving: local streets + 1 a road section + the jam drivers reckon with + parking; the route is the shortest',()=>{
  const per=G.sections.map((s,j)=>j%3*.5);
  D.origins.forEach((o,i)=>D.destinations.forEach((d,k)=>{const r=G.carOD[i][k];
    near(carBlocks(r,k,per),r.local+r.sections.length+r.sections.reduce((s,id)=>s+per[id],0)+(d.carExtra??2));
    for(let j=1;j<r.sections.length;j++){const a=G.sections[r.sections[j-1]],b=G.sections[r.sections[j]];assert([a.a,a.b].some(x=>same(x,b.a)||same(x,b.b)),'sections join');}
    assert(r.local+r.sections.length>=walk(o.cell,d.cell),'no shorter than straight');}));
});
test('Roads jam: each section adds (cars ÷ capacity)² blocks; the jam = Σ cars × extra; loads are the drivers on their routes',()=>{
  const y=G.base;
  y.extra.forEach((e,id)=>near(e,(y.roadLoad[id]/G.sections[id].cap)**2));
  near(y.jam,y.roadLoad.reduce((s,v,id)=>s+v*y.extra[id],0));
  const load=G.sections.map(()=>0);
  y.est.forEach((e,i)=>e.to.forEach((x,k)=>{for(const id of x.route.sections)load[id]+=x.drivers;}));
  y.chain.forEach(q=>{for(const id of q.route.sections)load[id]+=q.drivers;});
  load.forEach((v,id)=>near(v,y.roadLoad[id],1e-6));
  assert(Math.max(...y.extra)>1,'some road is over capacity when nothing is done');
});
test('Metro: walk×walkPer + wait + stations passed + walk×walkPer; a change = walk + wait again; at least one ride',()=>{
  const net=G.netOld,kt=G.lines.find(l=>l.name==='觀塘綫'),tko=G.lines.find(l=>l.name==='將軍澳綫');
  const a=kt.stations[1],b=kt.stations[4];   // 九龍灣 → 藍田: 2 stations passed
  near(metroTrip(net,a,b).blocks,P.wait+2);
  const c=tko.stations[2],t=metroTrip(net,c,a);   // 將軍澳 → 九龍灣: change at 油塘
  assert.equal(t.changes,1);near(t.blocks,(P.wait+1)+(P.wait+3));
  const o=[a[0]-1,a[1]];near(metroTrip(net,o,b).blocks,P.walkPer+P.wait+2);   // one cell west of 九龍灣
  const same1=metroTrip(net,a,a);assert(same1.blocks>=P.wait,'you cannot board and alight at one station');
});
test('Drivers learn slowly: the reckoning moves `learn` of the way; «do nothing» is settled',()=>{
  const y=G.base,per=G.base.perceived;
  learnFrom(per,y).forEach((v,id)=>near(v,per[id]+P.learn*(y.extra[id]-per[id])));
  per.forEach((v,id)=>near(v,y.extra[id],1e-4));
  const spreadOf=Math.max(...G.doNothing)-Math.min(...G.doNothing);assert(spreadOf<1e-3,'do nothing stays put');
});
test('Only those who know the new line use it; word of mouth = mode 2\'s, counted on the new line',()=>{
  const p=build(DEMO.master),none=year(p,D.origins.map(()=>0),p.perceived,p.crowded);
  assert.equal(none.onNew,0);none.est.forEach(e=>e.to.forEach(x=>near(x.knowGo,0)));
  const y=p.now(),nx=spread(y,p.aware);
  y.est.forEach((e,i)=>{near(e.share,e.onNew/e.n);near(nx[i],Math.min(1,p.aware[i]+Math.min(1,P.aware.spread*e.share)*(1-p.aware[i])));});
  for(const e of y.est)for(const x of e.to){near(x.metro,x.knowGo*x.tenthsNew/10+x.dontGo*x.tenthsOld/10);near(x.go,x.drivers+x.walkers+x.metro,1e-9);}
});
test('The new line takes cars off the roads; the roads clear, then some drive again (the jam falls, then creeps back)',()=>{
  const r=build(DEMO.master).simulate(),jams=r.log.map(l=>l.jam),lo=Math.min(...jams);
  assert(jams[0]<G.doNothing[0],'year 1 already better');assert(lo<.5*G.doNothing[0],'halves the jam at best');
  const at=jams.indexOf(lo);assert(at<P.years-1&&jams.at(-1)>lo,'a rebound after the clearest year');
  assert(r.log.at(-1).drivers<G.base.drivers,'fewer drivers than doing nothing');
});
test('Built once; score = Σ (do nothing − this year\'s jam); deterministic; demo plans score what they say and clear their line',()=>{
  const p=build(DEMO.master);assert(p.runYear());assert(!p.extend([0,0])&&!p.toggleStation(p.line[1])&&!p.addTrain());
  p.rewind();assert.equal(p.year,0);assert(p.perceived.every((v,id)=>Math.abs(v-G.base.perceived[id])<1e-12));
  const s=p.simulate();near(s.total,s.log.reduce((a,l)=>a+l.jam0-l.jam,0));near(build(DEMO.master).simulate().total,s.total);
  assert(P.target<P.highScore&&P.highScore<P.masterScore);assert.deepEqual(DEMO.tiers,[P.target,P.highScore,P.masterScore]);
  ['pass','high','master'].forEach((k,j)=>{const d=DEMO[k],q=build(d);assert(q.money>=0);const v=q.simulate().total;assert.equal(Math.round(v),d.score);assert(v>=DEMO.tiers[j],k);});
});
console.log(`\n${passed} checks passed`);
