'use strict';
// Rule checks for v7 mode 2 «the metro», static version. Run: node test_engine.js
const assert=require('node:assert/strict');
const M=require('./engine.js'),{Plan,D,P,evaluate,walk,same}=M;
let passed=0;function test(name,fn){fn();passed++;console.log('ok',name);}
// the best plan bots/v7_metro_static.js found
const BEST_LINE=[[12,5],[12,6],[12,7],[11,7],[10,7],[9,7],[9,6],[9,5],[9,4],[8,4],[8,3],[8,2],[7,2],[6,2],[5,2],[4,2],[3,2],[2,2]],BEST_ST=[[7,2],[12,5],[2,2],[9,6]];
function planOf(line,st){const p=new Plan();for(const c of line)assert(p.extend(c),'extend '+c);for(const s of st)assert(p.toggleStation(s),'station '+s);return p;}
test('The line: starts anywhere, grows only from an end into a free neighbour, never twice through a cell; ends can be cut',()=>{
  const p=new Plan();assert(p.extend([3,3]));assert(p.extend([4,3]));assert(p.extend([2,3]),'the other end');
  assert(!p.extend([6,3]),'not next to an end');assert(!p.extend([3,3]),'a cell already on the line');assert(!p.extend([3,4]),'next to the middle only');
  assert.deepEqual(p.line,[[2,3],[3,3],[4,3]]);assert(!p.shorten([3,3]),'not an end');assert(p.shorten([2,3]));assert.deepEqual(p.line,[[3,3],[4,3]]);
  assert(!p.extend([-1,0])&&!p.extend([D.cols,0]),'inside the board');
});
test('Stations only on the line; cutting an end takes its station; the budget is never exceeded',()=>{
  const p=new Plan();p.extend([3,3]);p.extend([4,3]);assert(!p.toggleStation([5,3]));assert(p.toggleStation([4,3]));assert(p.shorten([4,3]));assert.equal(p.stations.length,0);
  const q=new Plan();let c=[0,0];q.extend(c);while(q.extend([c[0]+1,c[1]]))c=[c[0]+1,c[1]];
  assert(q.cost()<=P.budget);for(const x of q.line)q.toggleStation(x);assert(q.cost()<=P.budget,`cost ${q.cost()}`);
});
test('A metro trip is walk + wait + stations passed + walk; every block saved on the car brings a tenth of the people',()=>{
  const ev=planOf(BEST_LINE,BEST_ST).evaluate();
  for(const r of ev.rows){assert.equal(r.car,walk(D.origins[r.i].cell,D.destinations[r.k].cell)+2);
    if(r.metro===null)continue;
    assert.equal(r.metro,r.walkA+P.wait+r.pass+r.walkB);assert.equal(r.walkA,walk(D.origins[r.i].cell,r.from));assert.equal(r.walkB,walk(r.to,D.destinations[r.k].cell));
    assert.equal(r.tenths,Math.min(10,Math.max(0,r.car-r.metro)));assert.equal(r.riders,Math.round(r.people*r.tenths/10));}
  assert.equal(ev.riders,ev.rows.reduce((a,r)=>a+r.riders,0));
});
test('Everyone takes the fastest station pair; one more station on the way costs those riding through 1 block',()=>{
  const p=planOf([[2,2],[3,2],[4,2],[5,2],[6,2],[7,2]],[[2,2],[7,2]]),r=p.evaluate().rows.find(x=>x.i===0&&x.k===1);
  assert.equal(r.pass,0);assert.equal(r.metro,0+P.wait+0+0);
  p.toggleStation([4,2]);const r2=p.evaluate().rows.find(x=>x.i===0&&x.k===1);assert.equal(r2.pass,1);assert.equal(r2.metro,r.metro+1);
  // the pair chosen is the cheapest of all pairs
  const ev=planOf(BEST_LINE,BEST_ST).evaluate();
  for(const x of ev.rows)if(x.metro!==null)for(const a of BEST_ST)for(const b of BEST_ST)if(!same(a,b)){
    const ia=BEST_LINE.findIndex(c=>same(c,a)),ib=BEST_LINE.findIndex(c=>same(c,b)),between=BEST_ST.filter(s=>{const k=BEST_LINE.findIndex(c=>same(c,s));return k>Math.min(ia,ib)&&k<Math.max(ia,ib);}).length;
    assert(x.metro<=walk(D.origins[x.i].cell,a)+P.wait+between+walk(b,D.destinations[x.k].cell));}
});
test('The preview of a station is exactly the plan with it (or without it)',()=>{
  const p=planOf(BEST_LINE,BEST_ST);for(const c of p.line){const pv=p.withStation(c).riders,q=p.copy();q.toggleStation(c);if(q.stations.length!==p.stations.length)assert.equal(pv,q.evaluate().riders);}
});
test('The score lines hold: the best plan found reaches master, every extra station on it costs riders',()=>{
  const p=planOf(BEST_LINE,BEST_ST),s=p.evaluate().riders;assert(s>=P.masterScore,`best ${s} < ${P.masterScore}`);assert.equal(p.cost(),P.budget);
  for(const c of p.line)if(!p.isStation(c))assert(evaluate(p.line,[...p.stations,c]).riders<s,'one more station never helps on this line');
  assert(planOf([[2,2],[3,2]],[[2,2],[3,2]]).evaluate().riders<P.target,'a stub line does not pass');
});
console.log(passed,'checks passed');
