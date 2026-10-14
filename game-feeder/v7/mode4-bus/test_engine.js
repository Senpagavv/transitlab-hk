'use strict';
// Rule checks for v7 mode 4 «buses on the road». Run: node test_engine.js
const assert=require('node:assert/strict');
const M=require('./engine.js'),{Plan,D,P,G,year,transitTrip,network,linesOf,sectionBetween,laned,walk,same,key}=M;
let passed=0;function test(name,fn){fn();passed++;console.log('ok',name);}
const near=(a,b,e=1e-9)=>assert(Math.abs(a-b)<e,`${a} ≠ ${b}`);
require('./demo-plans.js');const DEMO=globalThis.TL_BUS_DEMO[D.map];
function build(d){const p=new Plan();d.routes.forEach((R,r)=>{for(const c of R.cells)assert(p.extend(r,c),'extend '+c);for(const s of R.stops)assert(p.toggleStop(r,s),'stop '+s);
  for(let k=0;k<R.buses;k++)assert(p.addBus(r),'bus');});for(const l of d.lanes)assert(p.toggleLane(l),'lane '+l);return p;}
// 順利 down 秀茂坪道 to 秀茂坪 station (東九龍綫)
const FEED={routes:[{cells:[[7,2],[8,2],[8,3],[8,4],[8,5],[9,5]],stops:[[7,2],[9,5]],buses:4}],lanes:[]};
test('The map: mode 3\'s Kowloon East with the 東九龍綫 running; doing nothing has settled',()=>{
  const mine=G.lines.find(l=>l.mine);assert(mine&&mine.stations.length===4,'the line from mode 3');
  for(const l of G.lines)for(const s of l.stations)assert(l.cells.some(c=>same(c,s)));
  assert(Math.max(...G.doNothing)-Math.min(...G.doNothing)<1e-3,'steady');assert(G.base.jam>100,'the roads still jam');
});
test('Routes run on the roads only, grow from an end along a road section; stops on them; buses and lanes within a year\'s budget',()=>{
  const p=new Plan();assert(!p.extend(0,[0,0]),'not a road');assert(p.extend(0,[7,2]));assert(p.extend(0,[8,2]));
  assert(!p.extend(0,[9,3]),'not next to an end');assert(!p.extend(0,[7,3]),'no road section from the end');assert(p.extend(0,[6,2]),'from the other end');
  assert(p.shorten(0,[6,2]));assert(!p.toggleStop(0,[5,5]),'stops on the route');assert(p.toggleStop(0,[7,2]));
  for(let k=0;k<P.budget/P.busCost;k++)assert(p.addBus(0));assert(!p.addBus(0)&&p.money===0,'never over budget');
  assert(!p.toggleLane('觀塘道'),'a lane needs money');p.removeBus(0);p.removeBus(0);p.removeBus(0);assert(p.toggleLane('觀塘道'));assert.equal(p.money,0);
});
test('A bus trip = walk + wait (busHead ÷ buses) + every road section (1 + the jam reckoned) + 1 a stop + walk; changes to the metro',()=>{
  const p=build(FEED),lines=linesOf(p,p.perceived),bus=lines.find(l=>l.kind==='bus'),net=network(lines);
  near(bus.wait,P.busHead/4);
  const road=[[7,2],[8,2],[8,3],[8,4],[8,5],[9,5]].slice(1).reduce((s,c,i,arr)=>{const a=i?arr[i-1]:[7,2],sec=sectionBetween(a,c);return s+1+p.perceived[sec.id];},0);
  near(bus.hop(0),1+road);
  const tr=transitTrip(net,[7,2],[9,5]);near(tr.blocks,P.busHead/4+road);assert(tr.bus);
  const to=transitTrip(net,[7,2],D.destinations[0].cell);assert(to.bus&&to.rail&&to.changes===1,'feeds the 東九龍綫');
});
test('A bus lane: buses skip the jam there, cars keep (1 − laneCut) of the road; buses take busPCU cars\' worth off a lane only',()=>{
  const p=build(FEED),y0=p.now(),q=build({...FEED,lanes:['秀茂坪道']}),y1=q.now();
  const s=sectionBetween([8,3],[8,4]);assert(laned(s,q.lanes)&&!laned(s,p.lanes));
  const hop=l=>linesOf(l,l.perceived).find(x=>x.kind==='bus').hop(0);assert(hop(q)<hop(p),'faster on the lane');
  near(y1.extra[s.id],(y1.roadLoad[s.id]/(s.cap*(1-P.laneCut)))**2);near(y0.extra[s.id],(y0.roadLoad[s.id]/s.cap)**2);
  near(y0.busLoad[s.id],4*P.busPCU);near(y1.busLoad[s.id],0);
});
test('Change every year: what you change counts from the next year; doing nothing stays the score\'s yardstick',()=>{
  const p=build(FEED),a=p.runYear();const before=p.now().onBus;p.addBus(0);p.addBus(0);const after=p.now().onBus;assert(after>before,'more buses, more riders at once');
  const r=p.runYear();near(r.jam0,G.doNothing[1]);near(p.total,a.saved+r.saved);
  const s=build(FEED).simulate();near(s.total,s.log.reduce((t,l)=>t+l.jam0-l.jam,0));near(build(FEED).simulate().total,s.total);
});
test('Demo plans: each fits a year\'s budget, scores what demo-plans.js says and clears its line',()=>{
  assert.deepEqual(DEMO.tiers,[P.target,P.highScore,P.masterScore]);assert(P.target<P.highScore&&P.highScore<P.masterScore);
  ['pass','high','master'].forEach((k,j)=>{const d=DEMO[k],q=build(d);assert(q.money>=0);const v=q.simulate().total;assert.equal(Math.round(v),d.score);assert(v>=DEMO.tiers[j],k);});
});
console.log(`\n${passed} checks passed`);
