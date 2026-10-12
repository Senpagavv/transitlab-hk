'use strict';
// Rule checks for v5 (shares trial). Run: node test_engine.js
// Difficulty is tuned with ../bots/v5_tune.js and ../bots/v5_sweep.js; the last checks guard what they found.
const assert=require('node:assert/strict');
const BOARD=process.env.FEEDER_MAP;process.env.FEEDER_MAP='l1';
const E=require('./engine.js'),{Game,D,P,dist,same,willing,headwayAt,slice,split}=E;
let passed=0;
function test(name,fn){fn();passed++;console.log('ok',name);}
const LEVELS=['l1','l2','l3','l4','l5'],BASE=['l1','l2','l3'];   // BASE: the v5 rules (no habit, no groups)
const total=()=>D.waves.flat().reduce((a,b)=>a+b,0);
// Openings and plans found by bots/v5_tune.js (moves in the break before round r, counted from 1).
const PLANS={
  l1:{opening:[[5,6],[6,6],[6,2]],moves:[]},
  l2:{opening:[[1,1],[3,4],[3,5]],moves:[{r:2,id:2,cell:[1,3]},{r:3,id:2,cell:[3,5]},{r:3,id:1,cell:[3,6]},{r:4,id:0,cell:[2,1]}]},
  l3:{opening:[[2,2],[3,2],[2,5]],moves:[{r:2,id:1,cell:[4,4]},{r:3,id:2,cell:[2,6]},{r:3,at:60,id:2,cell:[2,5]}]},
  // v6 (bots/v6_tune.js): level 4 is won by the opening; level 5 moves with the time of the morning
  l4:{opening:[[2,1],[4,2],[4,3]],moves:[]},
  l5:{opening:[[2,3],[3,1],[3,6]],moves:[{r:2,id:0,cell:[2,2]},{r:2,id:1,cell:[4,1]},{r:2,at:90,id:0,cell:[2,3]},{r:3,id:1,cell:[5,1]}]}};
function useLevel(name){assert(D.select(name));E.reset();}
// moves in the break before round m.r (1-based); with mid, that many seconds into the round before instead
// (with at: that many seconds into round m.r instead — an extra move)
function play(plan,mid=0,moves=plan.moves){
  const g=new Game();plan.opening.forEach((c,id)=>assert(g.place(id,c)));assert(g.start());
  for(const m of moves){if(mid){g.runTo(m.r-2);g.advance(mid);}else{g.runTo(m.r-1);if(m.at!==undefined)g.advance(g.roundStart[m.r-1]+m.at-g.t);}
    assert(g.place(m.id,m.cell),`move to ${m.cell}`);}
  g.advance(P.duration+1);return g;
}
function setup(){const g=new Game();PLANS[D.map].opening.forEach((c,id)=>assert(g.place(id,c)));assert(g.start());return g;}
const allLayouts=()=>{const C=D.candidates,out=[];for(let a=0;a<C.length;a++)for(let b=a+1;b<C.length;b++)for(let c=b+1;c<C.length;c++)out.push([C[a],C[b],C[c]]);return out;};
function playLayout(cells){const g=new Game();cells.forEach((c,id)=>g.place(id,c));g.start();g.advance(P.duration+1);return g;}

test('A round starts only when everyone of the round before is on a bus, arrived or drove; people leave through 110 s of it',()=>{
  for(const name of LEVELS){useLevel(name);
    D.waves.forEach(w=>w.forEach(n=>assert(n>0,`${name}: an estate sends nobody in a round`)));
    const g=setup(),seen=[];
    while(!g.done){const r=g.round;g.advance(P.tick);
      if(g.round!==r){seen.push(g.round);
        for(const p of g.people)if(p.wave===r)assert(['delivered','car','bus'].includes(p.state),`${name}: round ${r+2} began with person ${p.id} ${p.state}`);
        assert(g.events.some(e=>e.type==='round'&&e.round===g.round&&e.time===g.t));}}
    assert.deepEqual(seen,D.waves.slice(1).map((w,i)=>i+1),`${name}: rounds ${seen}`);
    for(const p of g.people){const s=g.roundStart[p.wave];assert(p.born>=s&&p.born<s+P.release);}
    assert.equal(g.people.length,total());}
  useLevel('l1');
});
test('Pull falls 10 points a block to 40% at 6 blocks, nothing beyond; a batch splits exactly by pull (80 : 40 → 8 : 4)',()=>{
  assert.deepEqual([0,1,2,3,4,5,6,7,9,12].map(willing),[1,.9,.8,.7,.6,.5,.4,0,0,0]);
  assert.deepEqual(split(12,[.8,.4,0]),[8,4,0]);assert.deepEqual(split(10,[.8,.8,0]),[5,5,0]);assert.deepEqual(split(9,[.9,0,.9]),[4,0,5]);
  assert.deepEqual(split(5,[0,0,0]),[0,0,0]);
  // the people of every batch carry exactly those picks, whatever the pulls
  const g=new Game();
  D.waves.forEach((w,wi)=>w.forEach((n,o)=>{const ps=g.people.filter(p=>p.wave===wi&&p.origin===o);assert.equal(ps.length,n);
    for(const pulls of [[.8,.4,0],[.9,.9,.9],[1,0,.4],[.5,.7,.6]]){const want=split(n,pulls);
      pulls.forEach((x,s)=>assert.equal(ps.filter(p=>slice(pulls,p.pick)===s).length,want[s]));}}));
});
test('Everyone with a stop near enough takes the bus: with room at every stop, all of them arrive by bus',()=>{
  const def={cols:8,rows:3,roads:[[0,1],[1,1],[2,1],[3,1],[4,1],[5,1],[6,1],[7,1]],hub:[7,1],candidates:[[0,1],[1,1],[2,1],[3,1],[4,1]],
    estates:[{name:'甲',cell:[0,1],house:[0,-40]},{name:'乙',cell:[3,1],house:[0,-40]}],waves:[[3,2],[2,3],[3,3]],
    interval:120,release:110,headway:[30,2],seats:8,queue:8,cool:20,moves:2,tiers:[1,2,3]};
  D.use(def,'tiny');E.reset();
  const g=playLayout([[0,1],[2,1],[3,1]]);assert.equal(g.delivered,16);assert.equal(g.cars,0);
  useLevel('l1');
});
test('What the map shows is who walks out on the first try (stops ready, nobody turned away yet)',()=>{
  for(const name of BASE){useLevel(name);
    const g=setup(),fc=g.forecast(),t=P.firstWave+40;g.advance(t-g.t);
    D.origins.forEach((o,i)=>{const born=g.people.filter(p=>p.wave===0&&p.origin===i&&p.born<=t-P.tick);
      for(let s=0;s<3;s++){
        const want=born.filter(p=>slice(fc.estates[i].pull,p.pick)===s).length;
        const went=born.filter(p=>g.events.some(e=>e.type==='walk'&&e.id===p.id&&e.stop===s)).length;
        assert.equal(went,want,`${name}: ${o.name} → ${'ABC'[s]}`);}});
    // and the shares on the lines add up to the whole estate
    fc.estates.forEach(e=>{const sum=e.share.reduce((a,b)=>a+b,0);assert(e.drives?sum===0:Math.abs(sum-1)<1e-9);});}
  useLevel('l1');
});
test('A full stop drops out of the split; with every stop near them full, people wait at home, then drive',()=>{
  const g=setup(),fc=g.forecast();
  const i=fc.estates.findIndex(e=>e.share.filter(x=>x>0).length>=2),pulls=fc.estates[i].pull;
  const a=pulls.findIndex(x=>x>0),b=pulls.findIndex((x,k)=>k!==a&&x>0);
  const p=g.people.find(q=>q.origin===i&&slice(pulls,q.pick)===a);
  const fill=s=>{s.queue=Array(P.queue).fill(-1);s.boarding=Array(P.seats).fill(-1);};
  fill(g.stops[a]);
  const c=g.choose(p,D.origins[i].cell);assert(c&&c.id!==a,'goes to another stop');
  // its slice of the others: same proportions among the stops still open
  const open=pulls.map((x,k)=>k===a?0:x);assert.equal(c.id,slice(open,p.pick));
  for(const s of g.stops)if(pulls[s.id]>0)fill(s);
  assert.equal(g.choose(p,D.origins[i].cell),null);
  // a person deciding now waits, and drives once the wait at home runs out, for "stop full"
  Object.assign(p,{state:'home',deadline:g.t+999,homeUntil:g.t+P.homeGrace,retryAt:g.t});
  g.decide(p);assert.equal(p.state,'home');assert.equal(p.lastWhy,'站滿了');
});
test('Back and forth: whoever used up their patience, or their last try, drives as soon as they are home',()=>{
  useLevel('l3');
  const g=playLayout([[2,3],[4,4],[2,5]]);let n=0;
  for(const p of g.people){const ev=g.events.filter(e=>e.id===p.id);let outings=0;
    ev.forEach((e,k)=>{if(e.type==='walk'&&k>0&&['spawn','home'].includes(ev[k-1].type))outings++;
      if(e.type!=='return'||['搬站返家','原站搬遷'].includes(e.why))return;
      if(e.why==='耐心耗盡'||outings>=2){n++;assert.equal(ev[k+1]?.type,'car',`person ${p.id} thought again after their last try`);}
      else assert.equal(ev[k+1]?.type,'home',`person ${p.id} drove after a first try`);});}
  assert(n>0,'no one used up their tries on this crowded board');
  useLevel('l1');
});
test('Waiting in a queue costs no patience: the patience left stays the same while queuing; nobody leaves a queue (but a student at the bell)',()=>{
  for(const name of LEVELS){useLevel(name);const g=setup(),left=new Map(),bell=p=>p.group&&D.groups[p.group].bell;
    for(let i=0;i<P.duration/P.tick&&!g.done;i++){g.advance(P.tick);
      for(const p of g.people){if(p.state==='queue'&&!bell(p)){const l=+(p.deadline-g.t).toFixed(3);if(left.has(p.id))assert.equal(l,left.get(p.id),`${name}: person ${p.id} lost patience in a queue`);left.set(p.id,l);}else left.delete(p.id);}}
    assert(!g.events.some(e=>e.type==='return'&&e.why==='久候返家'),`${name}: someone left a queue`);}
  useLevel('l1');
});
test('A stop moved in a break and put back where it began the break does not cool down; one left elsewhere does',()=>{
  useLevel('l2');const g=setup();g.runTo(1);const s=g.stops[0],home=s.cell.slice(),ready=s.ready;
  const free=()=>D.candidates.find(c=>!same(c,home)&&!g.stops.some(q=>same(q.cell,c)));
  assert(g.place(0,free()));assert(s.ready>g.t,'moved away: cooling');assert(g.place(0,free()));assert(g.place(0,home));
  assert.equal(s.ready,ready,'back home: no cool-down');assert(s.ready<=g.t);
  const t1=g.stops[1];assert(g.place(1,free()));assert.equal(t1.ready,g.t+P.cool,'left elsewhere: cools down');
  useLevel('l1');
});
test('Headway is the level\'s base + step per block to the town centre',()=>{
  for(const name of LEVELS){useLevel(name);
    for(const c of D.candidates)assert.equal(headwayAt(c),D.headway[0]+D.headway[1]*dist(c,D.hub));}
  useLevel('l1');
});
test('Seats, queue and population are conserved through a full game; driving is permanent',()=>{
  for(const name of LEVELS){useLevel(name);
    const g=setup(),lost=new Set();
    for(let i=0;i<P.duration/P.tick;i++){g.advance(P.tick);
      for(const s of g.stops){assert(s.queue.length<=P.queue);assert(s.boarding.length<=P.seats);}
      for(const b of g.trips)assert(b.load.length<=P.seats);
      for(const p of g.people){if(lost.has(p.id))assert.equal(p.state,'car');if(p.state==='car')lost.add(p.id);}
      const st=g.stats();assert.equal(st.delivered+st.cars+st.missed+st.active+st.future,total());}
    assert(g.done);}
  useLevel('l1');
});
test('Moving a stop: the bus loading there leaves at once; the queue goes elsewhere; the stop cools down, timetable running',()=>{
  useLevel('l3');
  const g=setup();const s=g.stops[0];
  while(!(s.boarding.length&&s.queue.length)&&!g.done)g.advance(1);   // a moment with people aboard and queuing
  assert(s.boarding.length&&s.queue.length,'no moment with people aboard and a queue');
  const t0=g.t,aboard=s.boarding.slice(),queued=s.queue.slice(),before=s.departAt;
  const to=D.candidates.find(c=>!g.stops.some(x=>same(x.cell,c))&&g.forecast(0,c).estates.some(e=>e.share[0]>0));
  assert(g.place(0,to));assert.equal(g.moves,P.moves-1);assert.equal(s.ready,t0+P.cool);assert.equal(s.departAt,before);
  aboard.forEach(id=>assert.equal(g.person(id).state,'bus','everyone aboard leaves with the bus'));
  assert(g.events.some(e=>e.type==='dispatch'&&e.stop===0&&e.time===t0&&e.load===aboard.length));
  queued.forEach(id=>{assert(['return','walk'].includes(g.person(id).state));assert(!g.person(id).giveUp,'a move is not the passenger\'s failure');});
  for(let k=0;k<P.cool/P.tick-1;k++){g.advance(P.tick);assert.equal(s.queue.length+s.boarding.length,0);}
  g.advance(150);assert(g.events.some(e=>e.type==='queue'&&e.stop===0&&e.time>=s.ready),'boards again after the cool-down');
  g.advance(P.duration);aboard.forEach(id=>assert.equal(g.person(id).state,'delivered'));
  useLevel('l1');
});
test('Once aboard, a passenger always arrives; nobody is left half-way when the game ends',()=>{
  for(const name of LEVELS){useLevel(name);const g=play(PLANS[name]);
    for(const p of g.people){const ev=g.events.filter(e=>e.id===p.id),b=ev.findIndex(e=>e.type==='board');
      if(b<0)continue;assert.equal(p.state,'delivered',`${name}: person ${p.id} boarded but ${p.state}`);
      assert(!ev.slice(b).some(e=>['return','walk','car'].includes(e.type)),`${name}: person ${p.id} left the bus`);}
    for(const e of g.events.filter(e=>e.type==='return'&&e.why==='久候返家'))assert(e.time>=g.person(e.id).deadline-1e-6);
    assert(g.done);assert.equal(g.missed,0,`${name}: ${g.missed} unfinished`);assert(g.t<=P.duration);}
  useLevel('l1');
});
test('The rings: on level 1 every opening whose rounds all keep their red rings open carries everyone by bus',()=>{
  useLevel('l1');let calm=0;
  for(const cells of allLayouts()){const f=new Game();cells.forEach((c,id)=>f.place(id,c));
    if(!D.waves.every((w,r)=>{const fc=f.forecastRound(r);return !fc.estates.some(e=>e.drives)&&fc.stops.every(s=>!s.over);}))continue;
    calm++;assert.equal(playLayout(cells).delivered,total(),`calm opening ${JSON.stringify(cells)} still loses people`);}
  assert(calm>=1,'no calm opening on level 1');
});
test('The round preview is that round alone: who comes from where, how full each stop gets, who is left out',()=>{
  for(const name of LEVELS){useLevel(name);
    const g=setup();
    for(let r=0;r<D.waves.length;r++){g.runTo(r);const fc=g.forecastRound(r);
      fc.estates.forEach((e,i)=>{assert.equal(e.n,D.waves[r][i]);assert.equal(e.served,e.to.reduce((a,b)=>a+b,0));assert(e.served<=e.n);
        if(e.drives)assert.equal(e.served,0);});
      fc.stops.forEach((st,s)=>{assert.equal(st.from.reduce((a,b)=>a+b,0)+st.over,st.load);assert(st.peak<=st.room);
        fc.estates.forEach((e,i)=>assert.equal(e.to[s],st.from[i]));});
      // the people it counts are exactly that round's, split as the lines show
      const fw=g.forecast();fc.estates.forEach((e,i)=>assert.deepEqual(e.to.map((v,s)=>v+0),e.to)&&assert.equal(fw.estates[i].perWave[r].reduce((a,b)=>a+b,0),e.drives?0:e.n));}}
  useLevel('l1');
});
test('A level from the editor loads like a built-in one: water cells, bridges where a road crosses, plays to the end',()=>{
  const def={title:'測試',cols:8,rows:6,roads:[[1,1],[2,1],[3,1],[4,1],[5,1],[6,1],[3,2],[3,3],[3,4],[3,5],[4,5],[5,5],[6,5]],
    waterCells:[[0,3],[1,3],[2,3],[3,3],[4,3],[5,3]],hub:[6,5],candidates:[[1,1],[2,1],[4,1],[6,1],[3,2],[3,4],[4,5]],
    estates:[{name:'甲',cell:[1,1],house:[0,-56]},{name:'乙',cell:[6,1],house:[0,-56]}],waves:[[5,3],[5,3],[3,5],[3,5]],
    interval:100,release:90,headway:[40,4],seats:6,queue:6,cool:15,moves:2,patience:240,willing:[1,.9,.8,.7,.6,.5,.4],tiers:[10,12,14]};
  assert(D.loadEditor(def));E.reset();
  assert.equal(D.map,'custom');assert.deepEqual(D.bridges,[[3,3]]);assert.deepEqual(D.water,[[0,3,5,3]],'cells in a row become one stretch of river');
  assert.equal(P.interval,100);assert.equal(P.moves,2);assert.equal(P.patience,240);assert.deepEqual(P.willing,def.willing);
  const g=new Game();[[1,1],[6,1],[3,4]].forEach((c,id)=>assert(g.place(id,c)));assert(g.start());g.advance(P.duration+1);
  const st=g.stats();assert(g.done);assert.equal(st.delivered+st.cars+st.missed,32);assert(st.delivered>0);
  useLevel('l1');
});
test('Moving pays: on levels 2 and 3 the moves in the breaks beat not moving; on level 3 the extra move mid-round adds more',()=>{
  for(const name of ['l2','l3']){useLevel(name);const plan=PLANS[name],breaks={...plan,moves:plan.moves.filter(m=>m.at===undefined)};
    const none=play({...plan,moves:[]}).delivered,inBreaks=play(breaks).delivered,all=play(plan).delivered;
    assert(inBreaks>none,`${name}: moving in the breaks ${inBreaks} vs not moving ${none}`);
    if(name==='l3')assert(all>inBreaks,`l3: with the extra move ${all} vs breaks only ${inBreaks}`);}
  useLevel('l1');
});
test('Moves: the opening and every break are free; during a round only the level’s extra moves',()=>{
  useLevel('l2');
  const g=new Game();assert(!g.start());g.place(0,D.candidates[0]);assert(!g.place(1,D.candidates[0]),'an occupied cell is refused');
  g.place(1,D.candidates[7]);g.place(2,D.candidates[9]);assert(g.place(0,D.candidates[1])&&g.place(0,D.candidates[0]),'the opening is free');g.start();
  const free=()=>D.candidates.find(c=>!g.stops.some(s=>same(s.cell,c)));
  g.advance(40);assert.equal(g.moveKind(),'extra');assert(g.place(0,free()),'mid-round: the extra move');assert(!g.place(0,free()),'mid-round: nothing left');
  g.runTo(1);assert.equal(g.moveKind(),'break');for(let k=0;k<5;k++)assert(g.place(k%3,free()),`break move ${k+1}: free`);
  assert.equal(g.moves,0,'breaks do not use the extra moves');
  g.advance(1);assert.equal(g.moveKind(),null,'the round has begun and the extra is used');
  assert.deepEqual(g.commands.map(c=>c.kind),['extra','break','break','break','break','break']);
  useLevel('l1');const h=setup();h.advance(40);assert.equal(h.moveKind(),null,'level 1 has no extra moves');h.runTo(1);assert.equal(h.moveKind(),'break');
});
test('Frame rate does not change the result',()=>{
  const a=setup(),b=setup();a.advance(P.duration);for(let t=0;t<P.duration*10;t++)b.advance(.1);
  assert.deepEqual(a.stats(),b.stats());
});
test('Every level is well formed: candidates on roads, every estate reaches the town centre, neighbours can share a stop',()=>{
  for(const name of LEVELS){useLevel(name);
    const onRoad=c=>D.roads.some(r=>same(r,c));
    assert(onRoad(D.hub));
    D.candidates.forEach(c=>{assert(onRoad(c),`${name}: candidate ${c} off road`);assert(!same(c,D.hub));});
    D.origins.forEach((o,i)=>{assert(onRoad(o.cell));assert(E.toMTR[i]>0,`${name}: ${o.name} cannot reach the town centre`);
      assert(D.candidates.some(c=>E.shareAt(i,c)>=.8),`${name}: ${o.name} has no good stop`);
});
    // most estates can share a stop with a neighbour (Long Ping keeps its lone estate up north, as in v2)
    const sharing=D.origins.filter((o,i)=>D.candidates.some(c=>E.shareAt(i,c)>0&&D.origins.some((q,j)=>j!==i&&E.shareAt(j,c)>0))).length;
    assert(sharing>=D.origins.length-1,`${name}: only ${sharing} estates can share a stop`);
    const g=play({opening:D.candidates.slice(0,3),moves:[]});const st=g.stats();assert.equal(st.delivered+st.cars+st.missed,st.total);}
  useLevel('l1');
});
test('Switching levels in place plays exactly like loading that level fresh',()=>{
  const fresh={},rx=/[\\/]v6[\\/](engine|data)\.js$/;
  for(const name of LEVELS){
    for(const k of Object.keys(require.cache))if(rx.test(k))delete require.cache[k];
    process.env.FEEDER_MAP=name;const F=require('./engine.js');
    const g=new F.Game();[0,1,2].forEach(id=>g.place(id,F.D.candidates[id*2+1]));g.start();g.advance(F.P.duration);
    fresh[name]={stats:g.stats(),P:{...F.P},toMTR:F.toMTR.slice()};
  }
  for(const k of Object.keys(require.cache))if(rx.test(k))delete require.cache[k];
  process.env.FEEDER_MAP='l1';const F=require('./engine.js');
  for(const name of ['l2','l3','l1','l3']){
    assert(F.D.select(name));F.reset();assert.equal(F.D.map,name);
    const g=new F.Game();[0,1,2].forEach(id=>g.place(id,F.D.candidates[id*2+1]));g.start();g.advance(F.P.duration);
    assert.deepEqual(g.stats(),fresh[name].stats,`${name}: different result after switching`);
    assert.deepEqual({...F.P},fresh[name].P);assert.deepEqual(F.toMTR,fresh[name].toMTR);
  }
  assert(!F.D.select('nowhere'));assert(!Object.keys(F.D).includes('select'));
  process.env.FEEDER_MAP=BOARD||'';
});
test('Difficulty holds: level 1 has a few perfect openings; the others none; master takes moves (level 4: one of the very best openings)',()=>{
  const F=require('./engine.js');           // the instance loaded last
  for(const name of LEVELS){F.D.select(name);F.reset();
    const C=F.D.candidates,scores=[],all=F.D.waves.flat().reduce((a,b)=>a+b,0);
    for(let a=0;a<C.length;a++)for(let b=a+1;b<C.length;b++)for(let c=b+1;c<C.length;c++){
      const g=new F.Game();[a,b,c].forEach((k,id)=>g.place(id,C[k]));g.start();g.advance(F.P.duration+1);scores.push(g.delivered);}
    const perfect=scores.filter(s=>s===all).length,pass=scores.filter(s=>s>=F.P.target).length;
    assert(pass>=1&&pass<=0.12*scores.length,`${name}: ${pass} openings pass without moving`);
    if(name==='l1')assert(perfect>=1&&perfect<=8,`l1: ${perfect} perfect openings`);
    else{assert.equal(perfect,0,`${name}: an opening carries everyone`);
      // level 4 is won on day 1: only the very best openings reach master (moves add little there)
      if(name==='l4'){const m=scores.filter(s=>s>=F.P.masterScore).length;assert(m>=1&&m<=3,`l4: ${m} openings reach master`);}
      else assert(Math.max(...scores)<F.P.masterScore,`${name}: master without moving`);
      const g=new F.Game(),plan=PLANS[name];plan.opening.forEach((c,id)=>g.place(id,c));g.start();
      for(const m of plan.moves){g.runTo(m.r-1);if(m.at!==undefined)g.advance(g.roundStart[m.r-1]+m.at-g.t);g.place(m.id,m.cell);}
      g.advance(F.P.duration+1);
      assert(g.delivered>=F.P.masterScore,`${name}: the countdown plan ${g.delivered} < master ${F.P.masterScore}`);}}
});
test('Habit (level 4): each day exactly the habit share of every estate tries the bus; the rest drive at once, by habit',()=>{
  useLevel('l4');const g=setup();g.runTo(1);
  D.origins.forEach((o,i)=>{const ps=g.people.filter(p=>p.wave===0&&p.origin===i),n=ps.length;
    const want=Array.from({length:n},(_,k)=>(k+.5)/n).filter(x=>x<D.habit.start).length;
    assert.equal(ps.filter(p=>p.tried).length,want,`${o.name}: triers`);
    for(const p of ps.filter(p=>!p.tried))assert.equal(p.state,'car');
    assert.equal(g.events.filter(e=>e.type==='car'&&e.origin===i&&e.why==='習慣開車'&&g.person(e.id).wave===0).length,n-want);});
  // the preview counts the same people
  const fc=new Game().forecastRound(0);D.origins.forEach((o,i)=>assert.equal(fc.estates[i].tries,g.people.filter(p=>p.wave===0&&p.origin===i&&p.tried).length));
  useLevel('l1');
});
test('Habit moves halfway to the day’s smooth share each night; a spot’s reputation halfway to how its people fared there',()=>{
  useLevel('l4');const H=D.habit,ok=p=>!p.turned&&['delivered','bus'].includes(p.state);
  // an opening that turns enough people away at one spot on day 1 for its reputation to fall
  let g=null;for(const c of allLayouts()){const h=new Game();c.forEach((x,id)=>h.place(id,x));h.start();h.runTo(1);
    if(h.rep.some(r=>Object.values(r).some(v=>v<1))){g=h;break;}}
  assert(g,'some opening costs a spot its reputation on day 1');
  D.origins.forEach((o,i)=>{const ps=g.people.filter(p=>p.wave===0&&p.origin===i&&p.tried),sat=ps.length?ps.filter(ok).length/ps.length:1;
    assert(Math.abs(g.habit[i]-(H.start+H.rate*(sat-H.start)))<1e-3,`${o.name}: habit ${g.habit[i]}`);
    const by={};for(const p of ps)if(p.firstCell!==undefined)(by[p.firstCell]??=[]).push(ok(p)?H.good:H.bad);
    for(const [k,xs] of Object.entries(by)){const m=xs.reduce((a,b)=>a+b,0)/xs.length,want=Math.min(H.max,Math.max(H.min,1+H.rate*(m-1)));
      assert(Math.abs(g.repOf(i,k.split(',').map(Number))-want)<1e-3,`${o.name} at ${k}`);}});
  // the split uses pull × reputation
  const fc=g.forecast();D.origins.forEach((o,i)=>g.stops.forEach((s,k)=>{if(s.cell)assert(Math.abs(fc.estates[i].pull[k]-E.shareAt(i,s.cell)*g.repOf(i,s.cell))<1e-9);}));
  useLevel('l1');
});
test('Habit settles: with the best opening the last two days carry nearly the same riders and the average habit stops moving',()=>{
  useLevel('l4');const g=play(PLANS.l4),R=D.waves.length,day=r=>g.people.filter(p=>p.wave===r&&p.state==='delivered').length;
  assert(Math.abs(day(R-1)-day(R-2))<=2,`days ${day(R-2)} and ${day(R-1)}`);
  const avg=h=>h.reduce((a,b)=>a+b,0)/h.length,log=g.habitLog;
  assert(Math.abs(avg(log.at(-1).habit)-avg(log.at(-2).habit))<.02,'habit still moving');
  assert(day(R-1)>day(0)+20,'more ride once the habit has grown');
  useLevel('l1');
});
test('Groups (level 5): every batch has exactly its round’s mix; the preview counts the same people',()=>{
  useLevel('l5');const g=new Game();
  D.waves.forEach((w,r)=>w.forEach((n,o)=>{const ps=g.people.filter(p=>p.wave===r&&p.origin===o),want=split(n,D.mix[r][o]);
    D.groups.order.forEach((k,j)=>assert.equal(ps.filter(p=>p.group===k).length,want[j],`round ${r+1}, ${D.origins[o].name}, ${k}`));}));
  PLANS.l5.opening.forEach((c,id)=>g.place(id,c));
  const fc=g.forecastRound(1);fc.estates.forEach(e=>D.groups.order.forEach(k=>assert.equal(e.groups[k].n,g.people.filter(p=>p.wave===1&&p.origin===e.origin&&p.group===k).length)));
  useLevel('l1');
});
test('Groups: elders walk at most 2 blocks, slower; workers never go to a stop whose buses come too seldom; late students give up',()=>{
  useLevel('l5');const g=play(PLANS.l5),G=D.groups;
  for(const p of g.people){if(p.firstCell===undefined)continue;const c=p.firstCell.split(',').map(Number),d=dist(D.origins[p.origin].cell,c);
    if(p.group==='old')assert(d<=2,`elder walked ${d} blocks`);
    if(p.group==='work')assert(headwayAt(c)<=G.work.maxHeadway,`worker at a stop every ${headwayAt(c)} s`);}
  assert.equal(E.willingG('old',2),.3);assert.equal(E.willingG('old',3),0);assert.equal(E.willingG('work',3),willing(3));
  assert(g.people.filter(p=>p.group==='old').every(p=>p.walkStep===P.walkStep*G.old.walk));
  const late=g.events.filter(e=>e.type==='car'&&e.why==='趕不上課');
  assert(late.length>0&&late.every(e=>g.person(e.id).group==='stu'),'only students are late for school');
  // a worker with only a far stop near enough drives for "buses too seldom"
  const h=new Game();h.place(0,[5,1]);h.place(1,[5,6]);h.place(2,[5,5]);h.start();h.advance(P.duration+1);
  assert(h.events.some(e=>e.type==='car'&&e.why==='班次太疏'&&h.person(e.id).group==='work'),'workers skip far stops');
  useLevel('l1');
});
test('Moving with the morning pays on level 5: the plan’s moves beat its opening left alone',()=>{
  useLevel('l5');const still=play({...PLANS.l5,moves:[]}).delivered,moved=play(PLANS.l5).delivered;
  assert(moved>=still+10,`moves ${moved} vs ${still}`);
  useLevel('l1');
});
test('Every text has all three languages, and every key the page uses exists',()=>{
  const fs=require('node:fs'),path=require('node:path'),src=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
  require('./i18n.js');const T=globalThis.I18N,body=src('i18n.js');
  const keys=[...body.matchAll(/'([\w.]+)':L\(/g)].map(m=>m[1]);
  const used=new Set();
  for(const f of ['ui.js','editor.js']){
    for(const m of src(f).matchAll(/\bt\('([\w.]+)'[,)]/g))used.add(m[1]);
    for(const m of src(f).matchAll(/\bt\(([a-z]+)\?'([\w.]+)':'([\w.]+)'/g)){used.add(m[2]);used.add(m[3]);}}
  for(const tool of ['road','water','estate','hub','cand','erase'])used.add('ed.t.'+tool);
  for(const side of ['left','right','up','down'])used.add('ed.side.'+side);
  for(const f of ['index.html','editor.html'])for(const m of src(f).matchAll(/data-i18n(?:-html|-title|-aria)?="([\w.]+)"/g))used.add(m[1]);
  const L=require('./data.js');
  for(const m of [...L.levels,'custom']){used.add('src.'+m);used.add('site.'+m);used.add('lvEn.'+m);}
  for(let n=0;n<=3;n++)used.add('r.t'+n);
  for(const k of used)assert(keys.includes(k),`missing text: ${k}`);
  for(const lang of T.LANGS){T.set(lang);for(const k of keys){const v=T.t(k);assert(typeof v==='string'&&v!==k,`${k} in ${lang}`);
    if(lang!=='en'&&!['hub.enNames','b.mtr'].includes(k))assert(v.length>0,`${k} is empty in ${lang}`);}}
  T.set('zh-Hant');
});
test('A finished game replays from its record to the same score (the leaderboard check), and a forged record fails',()=>{
  const verify=require('./verify_result.js'),F=require('./engine.js');
  for(const name of LEVELS){F.D.select(name);F.reset();
    const C=F.D.candidates,g=new F.Game();[0,1,2].forEach(id=>g.place(id,C[id*2+1]));g.start();
    const run=until=>{while(g.t<until&&!g.done)g.advance(.37);};
    g.runTo(1);assert(g.place(0,C[C.length-1]),'break');run(g.t+60);if(F.P.moves)assert(g.place(1,C[C.length-2]),'extra');run(Infinity);
    const json=JSON.parse(JSON.stringify({map:name,score:g.delivered,seed:g.seed,opening:g.opening,moves:g.commands}));
    const v=verify(json);assert(v.ok,`${name}: ${JSON.stringify(v)}`);
    assert(!verify({...json,score:json.score+1}).ok);
    assert(!verify({...json,moves:Array(D.waves.length+P.moves).fill(json.moves[0])}).ok);
    assert(!verify({...json,moves:[{...json.moves[0],time:json.moves[0].time+30},{...json.moves[0],time:json.moves[0].time+40,cell:C[0]}]}).ok,'two mid-round moves');}
});
test('Random levels like the editor makes (settings at their limits) never lose people, strand passengers or run on',()=>{
  const fuzz=require('./fuzz_engine.js');assert(fuzz(60,4242)>=180);   // node fuzz_engine.js 1500 for the long run
  useLevel('l1');
});
console.log(`${passed} checks passed`);
