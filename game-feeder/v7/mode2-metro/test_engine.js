'use strict';
// Rule checks for v7 mode 2 «the metro» (first draft). Run: node test_engine.js
const assert=require('node:assert/strict');
const M=require('./engine.js'),{Game,D,P,walk,willing}=M;
let passed=0;function test(name,fn){fn();passed++;console.log('ok',name);}
const BEST=[[2,5],[5,5],[11,4],[12,4]],PLAN=[1,2,3,3,3,3];
function play(stations,trains){const g=new Game();for(const c of stations)assert(g.build(c));(trains||[]).forEach((n,w)=>assert(g.setTrains(n,w)));assert(g.start());g.advance(1e6);return g;}
test('Stations: only on the alignment, at most four, built before the opening and fixed after',()=>{
  const g=new Game();assert(!g.build([0,0]));for(const c of BEST)assert(g.build(c));assert(!g.build([7,4]),'a fifth');
  assert(g.unbuild([12,4]));assert(g.build([12,4]));assert(g.start());assert(!g.build([7,4]));assert(!g.unbuild([2,5]));
  assert.deepEqual(g.stations,BEST);
});
test('Trains: 1–5 a week, never more than the budget, at least one left for every later week',()=>{
  const g=new Game();for(const c of BEST)g.build(c);
  assert(!g.setTrains(0,0));assert(!g.setTrains(6,0));assert(g.setTrains(5,0));assert(g.setTrains(5,1));
  assert.deepEqual(g.trainsRange(2),[1,2]);assert(!g.setTrains(3,2));   // 15 − 10 = 5 left, 1 kept for each of the last 3 weeks
  const h=play(BEST);assert(h.trainsByWeek.reduce((a,b)=>a+b,0)<=P.budget);assert.equal(h.trainsByWeek.length,D.weeks);
});
test('A longer line or more stops means a longer loop; more trains mean a train more often',()=>{
  const g=new Game();g.build([2,5]);g.build([12,4]);const a=g.loop().T;g.build([7,4]);const b=g.loop().T;
  const h=new Game();h.build([2,5]);h.build([7,4]);const c=h.loop().T;
  assert(b>a&&a>c,`${a} ${b} ${c}`);assert(g.headway(3)<g.headway(1));
});
test('Both ends need a station: who rides has a station near home and near where they go; split by pull × pull',()=>{
  const g=play(BEST,PLAN);
  for(const p of g.people)if(p.state==='delivered'){const a=g.stations[p.from],b=g.stations[p.to];
    assert(willing(walk(D.origins[p.origin].cell,a))>0&&willing(walk(b,D.destinations[p.dest].cell))>0);}
  const one=play([[2,5],[3,5]]);   // both stations far from every destination
  assert(one.people.filter(p=>p.tried).every(p=>p.state!=='delivered'||willing(walk(one.stations[p.to],D.destinations[p.dest].cell))>0));
  assert(one.people.some(p=>p.why==='終點沒有站'));
});
test('Everyone has an outcome, nobody is counted twice, trains never carry more than they hold',()=>{
  const g=new Game();for(const c of BEST)g.build(c);PLAN.forEach((n,w)=>g.setTrains(n,w));g.start();
  while(!g.done){g.advance(P.tick);for(const tr of g.trains)assert(tr.load.length<=P.cap);for(let i=0;i<4;i++)for(const d of [1,-1])assert(g.queue(i,d).length<=P.platform);}
  const n=s=>g.people.filter(p=>p.state===s).length;
  assert.equal(n('delivered')+n('car')+n('walked'),g.people.length);assert.equal(n('delivered'),g.delivered);assert.equal(n('car'),g.cars);
});
test('Habit: week 1 exactly the start share tries; each night it moves halfway to the week’s smooth share',()=>{
  const g=play(BEST,PLAN),ok=p=>!p.turned&&p.state==='delivered';
  D.origins.forEach((o,i)=>{const ps=g.people.filter(p=>p.wave===0&&p.origin===i);
    assert.equal(ps.filter(p=>p.tpick<D.habit.start).length,Array.from({length:ps.length},(_,k)=>(k+.5)/ps.length).filter(x=>x<D.habit.start).length);
    const tr=ps.filter(p=>p.tried),sat=tr.length?tr.filter(ok).length/tr.length:1;
    assert(Math.abs(g.habitLog[1].habit[i]-(D.habit.start+D.habit.rate*(sat-D.habit.start)))<1e-3);});
});
test('The same plan always plays the same; the score lines hold (bots/v7_metro_tune.js)',()=>{
  assert.equal(play(BEST,PLAN).delivered,play(BEST,PLAN).delivered);
  assert(play(BEST,PLAN).delivered>=P.masterScore,'the best plan reaches master');
  assert(play(BEST).delivered<P.highScore,'untouched trains stay below the high score');
  assert(play(BEST,[5,4,2,2,1,1]).delivered<play(BEST,PLAN).delivered-100,'trains early waste the budget');
});
console.log(passed,'checks passed');
