'use strict';
const assert=require('node:assert/strict');
const M=require('./engine.js'),{Plan,D,P,G,year,learnFrom,metroTrip,carRoute,carBlocks,expand,walk,same,key,peopleAt,attractionAt}=M;
let passed=0;function test(name,fn){fn();passed++;console.log('ok '+name);}
const near=(a,b,e=1e-7)=>assert(Math.abs(a-b)<e,String(a)+' ≠ '+String(b));
require('./demo-plans.js');const DEMO=globalThis.TL_ROADS_DEMO[D.map];
function build(d){const p=new Plan();for(const c of d.line)assert(p.extend(c),'extend '+c);for(const s of d.stations)assert(p.toggleStation(s),'station '+s);for(let k=1;k<d.trains;k++)assert(p.addTrain(),'train');return p;}
function applyActions(p,actions){for(const a of actions||[]){if(a.type==='extend')assert(p.extend(a.cell),'phase2 extend');else if(a.type==='station')assert(p.toggleStation(a.cell),'phase2 station');else if(a.type==='train')assert(p.addTrain(),'phase2 train');}}
function top2(load){return load.map((v,id)=>({id,v:(v/G.sections[id].cap)**2})).sort((a,b)=>b.v-a.v).slice(0,2).map(x=>x.id);}
test('Road network is connected and every origin-destination pair has a road route',()=>{
 const seen=new Set(),adj=new Map(),todo=[key(G.sections[0].a)];
 for(const s of G.sections)for(const [a,b] of [[s.a,s.b],[s.b,s.a]]){if(!adj.has(key(a)))adj.set(key(a),[]);adj.get(key(a)).push(key(b));}
 while(todo.length){const k=todo.pop();if(seen.has(k))continue;seen.add(k);todo.push(...(adj.get(k)||[]));}
 assert.equal(seen.size,adj.size);G.carOD.forEach(row=>row.forEach(r=>{assert(r.sections.length>0);assert(r.local<=4);}));
 for(const l of G.lines)for(const s of l.stations)assert(l.cells.some(c=>same(c,s)));
});
test('Car route time and road delay still use local streets, sections, perceived jam and parking',()=>{
 const per=G.sections.map((s,j)=>j%3*.5);D.origins.forEach((o,i)=>D.destinations.forEach((d,k)=>{const r=G.carOD[i][k];
 near(carBlocks(r,k,per),r.local+r.sections.length+r.sections.reduce((s,id)=>s+per[id],0)+(d.carExtra??2));assert(r.local+r.sections.length>=walk(o.cell,d.cell));}));
});
test('Metro travel still charges walks, waits, stations and changes',()=>{
 const kt=G.lines.find(l=>l.name==='觀塘綫'),tko=G.lines.find(l=>l.name==='將軍澳綫'),a=kt.stations[1],b=kt.stations[4];
 near(metroTrip(G.netOld,a,b).blocks,P.wait+2);const c=tko.stations[2],q=metroTrip(G.netOld,c,a);assert.equal(q.changes,1);near(q.blocks,(P.wait+1)+(P.wait+3));
});
test('Demand grows by year and no-build congestion rises while the worst segment moves',()=>{
 assert.equal(peopleAt(0,0),24);near(peopleAt(0,4),44);near(peopleAt(2,5),48);near(peopleAt(5,6),80);near(attractionAt(0,6),30);
 assert(G.doNothing[7]>=G.doNothing[0]*1.4,'year 8 do-nothing jam is at least 1.4× year 1');
 const a=top2(G.base.roadLoad),b=top2(G.doNothingRoad[7]);assert(b.some(id=>!a.includes(id)),'one of year 8 top two sections differs from year 0');
});
test('Drivers still learn congestion gradually from the roads they actually meet',()=>{
 const per=G.base.perceived,y=G.base;learnFrom(per,y).forEach((v,id)=>near(v,per[id]+P.learn*(y.extra[id]-per[id])));per.forEach((v,id)=>near(v,y.extra[id],1e-4));
});
test('Road accounting attributes cars and reports non-negative off-road and rebound counts',()=>{
 const p=build(DEMO.master),r=p.runYear(),y=r.y;assert.equal(y.roadBy.length,G.sections.length);assert(y.offRoadTotal>0);assert(y.reboundTotal>=0);
 y.roadBy.forEach((rows,id)=>near(rows.reduce((s,x)=>s+x.cars,0),y.roadLoad[id],1e-6));
 assert(y.offRoad.every(x=>x>=0));assert(y.rebound.every(x=>x>=0));
 const z=year(null,p.aware,p.perceived,p.crowded,1,true);assert(z.offRoad.every(x=>x===0));assert(z.rebound.every(x=>x===0));near(z.offRoadTotal,0);near(z.reboundTotal,0);
});
test('Second phase starts after year four, adds 12 and only permits reversible additions before continuing',()=>{
 const p=build(DEMO.master);for(let i=0;i<4;i++)assert(p.runYear());assert.equal(p.phase,2);assert.equal(p.year,4);assert.equal(p.money,12);
 assert.equal(p.shorten(p.line[0]),false);assert.equal(p.removeTrain(),false);assert.equal(p.toggleStation(p.stations[0]),false);
 const budget=p.phase2Snapshot.money;applyActions(p,DEMO.master.phase2);assert(budget-p.money<=P.phase2Budget);assert(p.phase2Actions.length>=0);
 assert(p.continuePhase2());assert.equal(p.canExtend([0,0]),false);assert.equal(p.addTrain(),false);assert(p.runYear());
});
test('Two-phase simulate matches advancing years and applying phase-two actions by hand',()=>{
 const planned=build(DEMO.master);planned.phase2Actions=structuredClone(DEMO.master.phase2);const sim=planned.simulate();
 const stepped=build(DEMO.master);for(let i=0;i<4;i++)stepped.runYear();applyActions(stepped,DEMO.master.phase2);assert(stepped.continuePhase2());while(!stepped.done)assert(stepped.runYear());
 assert.deepEqual(stepped.log.map(x=>x.jam),sim.log.map(x=>x.jam));near(stepped.total,sim.total);
});
test('Score remains the yearly do-nothing jam minus this plan, and generated demos meet their tiers',()=>{
 assert.deepEqual(DEMO.tiers,[P.target,P.highScore,P.masterScore]);assert(P.target<P.highScore&&P.highScore<P.masterScore);
 for(const [j,k] of ['pass','high','master'].entries()){const d=DEMO[k],p=build(d);p.phase2Actions=structuredClone(d.phase2);assert(p.money>=0);const r=p.simulate();assert.equal(Math.round(r.total),d.score);assert(r.total>=DEMO.tiers[j]);near(r.total,r.log.reduce((s,l)=>s+l.jam0-l.jam,0));}
});
console.log(String(passed)+' checks passed');
