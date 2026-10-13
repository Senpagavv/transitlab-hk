'use strict';
// Rule checks for v7 mode 2 «the metro», six years with the experience constant. Run: node test_engine.js
const assert=require('node:assert/strict');
const M=require('./engine.js'),{Plan,D,P,evaluate,nextExp,walk,same}=M;
let passed=0;function test(name,fn){fn();passed++;console.log('ok',name);}
const LINE=[[2,2],[3,2],[4,2],[5,2],[6,2],[7,2],[8,2],[8,3],[8,4],[9,4],[9,5],[9,6],[9,7],[10,7],[11,7],[12,7],[12,6],[12,5]],ST=[[2,2],[7,2],[9,6],[12,5]];
function open(line=LINE,st=ST){const p=new Plan();for(const c of line)assert(p.extend(c),'extend '+c);for(const s of st)assert(p.toggleStation(s),'station '+s);return p;}
test('Year 0: the line starts anywhere, grows only from an end, never revisits; stations on it; money pays for all of it',()=>{
  const p=new Plan();assert(p.extend([3,3]));assert(p.extend([4,3]));assert(p.extend([2,3]));
  assert(!p.extend([6,3])&&!p.extend([3,3])&&!p.extend([3,4]));assert(p.shorten([2,3]));assert.deepEqual(p.line,[[3,3],[4,3]]);
  assert(!p.toggleStation([5,3]));assert(p.toggleStation([4,3]));assert.equal(p.money,P.budget-2*P.lineCost-P.stationCost);
  assert(p.shorten([4,3]));assert.equal(p.stations.length,0);assert.equal(p.money,P.budget-P.lineCost);
  const q=open();assert.equal(q.money,0);assert(!q.extend([1,2])&&!q.addTrain(),'nothing left to spend');
});
test('Tenths = blocks saved + the estate’s experience; a trip = walk + wait + stations passed + walk',()=>{
  const p=open(),ev=p.evaluate();
  for(const r of ev.rows){assert.equal(r.car,walk(D.origins[r.i].cell,D.destinations[r.k].cell)+2);if(r.metro===null)continue;
    assert.equal(r.metro,r.walkA+P.wait+r.pass+r.walkB);assert.equal(r.exp,P.exp.start);
    assert.equal(r.tenths,r.save>0?Math.max(0,Math.min(10,r.save+r.exp)):0);assert.equal(r.riders,Math.round(r.people*r.tenths/10));}
  const better=evaluate(p.line,p.stations,D.origins.map(()=>2),1);assert(better.riders>ev.riders,'more experience, more riders');
});
test('Crowding: a section carries everyone riding through it; over trains × perTrain it is crowded',()=>{
  const ev=evaluate(LINE,ST,D.origins.map(()=>3),1);
  ev.load.forEach((n,j)=>{const want=ev.rows.filter(r=>r.riders&&Math.min(r.fx,r.tx)<=j&&j<Math.max(r.fx,r.tx)).reduce((a,r)=>a+r.riders,0);assert.equal(n,want);assert.equal(ev.crowded[j],n>P.perTrain);});
  assert(ev.crowded.some(Boolean),'full experience on one train is crowded');
  const two=evaluate(LINE,ST,D.origins.map(()=>3),4);assert(!two.crowded.some(Boolean),'four trains are not');
});
test('Experience: +1 a year in comfort, −1 when more than a third rode crowded, unchanged with no riders, within −3…+3',()=>{
  const ev=evaluate(LINE,ST,D.origins.map(()=>0),1),nx=nextExp(ev,D.origins.map(()=>0));
  D.origins.forEach((o,i)=>{const rs=ev.rows.filter(r=>r.i===i&&r.riders),n=rs.reduce((a,r)=>a+r.riders,0);
    if(!n)assert.equal(nx[i],0);else{const bad=rs.filter(r=>r.crowded).reduce((a,r)=>a+r.riders,0)/n;assert.equal(nx[i],bad>P.crowdShare?-1:1);}});
  assert.deepEqual(nextExp(evaluate(LINE,ST,D.origins.map(()=>3),9),D.origins.map(()=>3)).filter(x=>x>3),[]);
});
test('A year: the fares come in (1 per fare riders), experience moves, what is built can no longer be removed',()=>{
  const p=open(),ev=p.evaluate(),r=p.runYear();
  assert.equal(r.riders,ev.riders);assert.equal(p.money,Math.floor(ev.riders/P.fare));assert.equal(p.total,ev.riders);assert.deepEqual(p.exp,nextExp(ev,D.origins.map(()=>P.exp.start)));
  assert(!p.toggleStation([2,2]),'a built station stays');assert(!p.shorten([2,2])&&!p.shorten([12,5]),'built ends stay');assert(!p.clear());
  // this year's additions can still be taken back
  const m=p.money;if(p.extend([1,2])){assert(p.shorten([1,2]));assert.equal(p.money,m);}
});
test('Six years and done; the score is every year’s riders added up',()=>{
  const p=open();let sum=0;while(!p.done){sum+=p.evaluate().riders;p.runYear();}
  assert.equal(p.year,P.years);assert.equal(p.total,sum);assert.equal(p.runYear(),null);
});
test('The score lines (bots/v7_metro_years.js): never spending stays under pass; trains when crowded clears it; master needs more',()=>{
  const lazy=open();while(!lazy.done)lazy.runYear();assert(lazy.total<P.target,`never spending ${lazy.total}`);
  const tr=open();while(!tr.done){while(tr.evaluate().crowded.some(Boolean)&&tr.canTrain())tr.addTrain();tr.runYear();}
  assert(tr.total>=P.target&&tr.total<P.highScore,`trains only ${tr.total}`);
});
console.log(passed,'checks passed');
