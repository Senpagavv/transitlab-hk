'use strict';
// Rule checks for v7 mode 2 «the metro», build once and watch it grow. Run: node test_engine.js
const assert=require('node:assert/strict');
const M=require('./engine.js'),{Plan,D,P,year,spread,metroTrip,carBlocks,footBlocks,split,walk}=M;
let passed=0;function test(name,fn){fn();passed++;console.log('ok',name);}
// 天耀邨 east to 洪水橋, down and on to 元朗市中心; three stations, two trains
const LINE=[[2,2],[3,2],[4,2],[5,2],[6,2],[7,2],[7,3],[7,4],[8,4],[9,4],[10,4],[11,4],[12,4],[13,4]],ST=[[2,2],[7,2],[13,4]];
function build(line=LINE,st=ST,trains=2){const p=new Plan();for(const c of line)assert(p.extend(c),'extend '+c);for(const s of st)assert(p.toggleStation(s),'station '+s);
  for(let k=1;k<trains;k++)assert(p.addTrain());return p;}
const near=(a,b,e=1e-9)=>assert(Math.abs(a-b)<e,`${a} ≠ ${b}`);
test('Planning: the line starts anywhere and grows from an end; stations on it; trains; all within the budget',()=>{
  const p=new Plan();assert(p.extend([3,3]));assert(p.extend([4,3]));assert(p.extend([2,3]));
  assert(!p.extend([6,3])&&!p.extend([3,3])&&!p.extend([3,4]));assert(p.shorten([2,3]));assert.deepEqual(p.line,[[3,3],[4,3]]);
  assert(!p.toggleStation([5,3]));assert(p.toggleStation([4,3]));assert(p.addTrain());
  assert.equal(p.money,P.budget-2*P.lineCost-P.stationCost-P.trainCost);
  assert(p.shorten([4,3]));assert.equal(p.stations.length,0);assert(p.removeTrain());assert(!p.removeTrain(),'one train always');
  assert.equal(p.money,P.budget-P.lineCost);
  const q=build();assert.equal(q.money,P.budget-LINE.length*P.lineCost-ST.length*P.stationCost-P.trainCost);
  while(q.canTrain())q.addTrain();assert(!q.addTrain()&&q.money<P.trainCost,'never over budget');
});
test('Built once: after opening nothing changes; back to planning keeps the plan and clears the years',()=>{
  const p=build(),line=JSON.stringify(p.line);assert(!new Plan().canRun(),'needs 2 stations');
  assert(p.runYear());assert(p.open);
  assert(!p.extend([1,2])&&!p.shorten([2,2])&&!p.toggleStation([4,2])&&!p.addTrain()&&!p.removeTrain()&&!p.clear());
  assert.equal(JSON.stringify(p.line),line);
  p.rewind();assert.equal(p.year,0);assert.equal(p.total,0);assert.equal(p.log.length,0);assert.equal(JSON.stringify(p.line),line);
  assert(p.aware.every(a=>a===P.aware.start));assert(p.extend([1,2]),'planning again');
});
test('Blocks: metro = walk×2 + wait + stations passed + walk×2 (fastest pair); car = cells apart + parking; foot = cells apart × 2',()=>{
  const p=build();
  for(let i=0;i<D.origins.length;i++)for(let k=0;k<D.destinations.length;k++){
    assert.equal(carBlocks(i,k),walk(D.origins[i].cell,D.destinations[k].cell)+(D.destinations[k].carExtra??2));
    assert.equal(footBlocks(i,k),P.walkPer*walk(D.origins[i].cell,D.destinations[k].cell));
    const t=metroTrip(i,k,p.line,p.stations);assert.equal(t.blocks,P.walkPer*(t.walkA+t.walkB)+P.wait+t.pass);
    p.stations.forEach((a,ia)=>p.stations.forEach((z,iz)=>{if(ia!==iz)
      assert(t.blocks<=P.walkPer*(walk(D.origins[i].cell,a)+walk(z,D.destinations[k].cell))+P.wait+Math.abs(iz-ia)-1,'no faster pair');}));}
  const t=metroTrip(0,1,p.line,p.stations);assert.deepEqual([t.walkA,t.pass,t.walkB,t.blocks],[0,0,0,P.wait],'天耀邨 → 洪水橋: on the doorstep');
  assert.equal(metroTrip(0,0,p.line,p.stations).pass,1,'天耀邨 → 元朗 passes 洪水橋');
});
test('Where to go: pull = attraction − blocks; shares (and «nearby») add up to everyone',()=>{
  const s=split(0,[5,30]);assert.deepEqual(s.pulls,[D.destinations[0].attraction-5,0]);near(s.shares[0]+s.shares[1]+s.nearby,1);
  near(s.shares[0],(D.destinations[0].attraction-5)/(D.destinations[0].attraction-5+P.nearby));
  for(const e of build().now().est){near(e.to.reduce((a,x)=>a+x.go,0)+e.nearby,e.n);near(e.to.reduce((a,x)=>a+x.before,0)+e.nearbyBefore,e.n);}
});
test('How to go: tenths = blocks saved on the quicker of car and foot (0–10); only those who know the metro ride it or change where they go',()=>{
  const p=build(),y=p.now();
  for(const e of y.est)for(const x of e.to){assert.equal(x.alt,Math.min(x.car,x.foot));assert.equal(x.tenths,Math.min(10,x.save));assert.equal(x.save,x.trip?Math.max(0,x.alt-x.trip.blocks):0);
    near(x.metro,x.knowGo*x.tenths/10);near(x.knowGo,e.n*e.aware*split(e.i,e.to.map(z=>z.trip?Math.min(z.alt,z.trip.blocks):z.alt)).shares[x.k]);
    near(x.dontGo,e.n*(1-e.aware)*split(e.i,e.to.map(z=>z.alt)).shares[x.k]);near(x.walkers+x.drivers+x.metro,x.go);
    if(x.trip&&x.foot<=x.trip.blocks)assert.equal(x.metro,0,'nobody takes the metro where walking is as quick');}
  assert(y.est.some(e=>e.to.some(x=>x.byFoot)),'some go on foot');
  const nobody=year(p.line,p.stations,D.origins.map(()=>0),p.trains);assert.equal(nobody.riders,0);
  nobody.dest.forEach(d=>near(d.go,d.before));
});
test('Word of mouth: next year’s aware = aware + min(1, spread × share riding) × those who don’t know; it only grows',()=>{
  const p=build(),y=p.now(),nx=spread(y,p.aware);
  y.est.forEach((e,i)=>{near(nx[i],Math.min(1,p.aware[i]+Math.min(1,P.aware.spread*e.metro/e.n)*(1-p.aware[i])));assert(nx[i]>=p.aware[i]);});
  const r=p.simulate();for(const l of r.log)l.after.forEach((a,i)=>assert(a>=l.before[i]));
  for(let k=1;k<r.log.length;k++)if(!r.log[k-1].crowdedSections)assert(r.log[k].riders>=r.log[k-1].riders-1e-9,'riders climb while nothing is crowded');
});
test('The line draws people: everyone knowing it, a destination it reaches gets more visitors than before; an S-curve',()=>{
  const pot=build().potential();assert(pot.dest.some(d=>d.go>d.before+5),'induced trips');
  const r=build().simulate();assert(r.log.at(-1).riders>2*r.log[0].riders,'year 8 well above year 1');
  assert(r.log.at(-1).riders<=pot.riders+1e-9,'never above the potential');
});
test('Crowding: over trains × perTrain, next year a trip through it counts crowdBlocks more (once); trains add room',()=>{
  const p=build(LINE,ST,1),saved=P.perTrain;P.perTrain=5;
  try{const y=p.now();assert(y.crowded.some(Boolean),'crowded with 5 a train');
    assert(p.runYear().crowdedSections>0);let seen=0;
    for(const e of p.now().est)for(const x of e.to)if(x.trip){let hit=false;for(let j=Math.min(x.trip.fx,x.trip.tx);j<Math.max(x.trip.fx,x.trip.tx);j++)hit=hit||y.crowded[j];
      assert.equal(x.trip.crowd,hit?P.crowdBlocks:0);if(hit)seen++;}
    assert(seen>0,'some trips pay for the crowding');
    const one=build(LINE,ST,1).now(),q=build(LINE,ST,1);while(q.canTrain())q.addTrain();
    assert(q.now().cap>one.cap);near(q.now().load.reduce((a,b)=>a+b,0),one.load.reduce((a,b)=>a+b,0));}
  finally{P.perTrain=saved;}
});
test('Score: the years’ daily riders added up; simulate() and year-by-year agree, deterministic; tiers in order',()=>{
  const p=build(),s=p.simulate();near(s.total,s.log.reduce((a,l)=>a+l.riders,0));assert.equal(s.log.length,P.years);assert(s.done);
  while(!p.done)p.runYear();near(p.total,s.total);near(build().simulate().total,s.total);
  assert(P.target<P.highScore&&P.highScore<P.masterScore);
});
test('AI demo plans: each fits the budget, scores what demo-plans.js says and clears its line',()=>{
  require('./demo-plans.js');const L=globalThis.TL_METRO_DEMO[D.map];assert.deepEqual(L.tiers,[P.target,P.highScore,P.masterScore]);
  ['pass','high','master'].forEach((name,j)=>{const d=L[name],p=build(d.line,d.stations,d.trains);assert(p.money>=0);
    const s=p.simulate().total;assert.equal(Math.round(s),d.score);assert(s>=L.tiers[j],name);});
  assert.equal(L.master.score,L.best);
});
console.log(`\n${passed} checks passed`);
