'use strict';
// Rule checks for v4 (rounds trial). Run: node test_engine.js
// Difficulty is tuned with ../bots/v4_tune.js and ../bots/v4_calibrate.js; the last checks guard what they found.
const assert=require('node:assert/strict');
const BOARD=process.env.FEEDER_MAP;process.env.FEEDER_MAP='l1';
const E=require('./engine.js'),{Game,D,P,dist,length,same,willing,comes,headwayAt}=E;
let passed=0;
function test(name,fn){fn();passed++;console.log('ok',name);}
const total=()=>D.waves.flat().reduce((a,b)=>a+b,0);
const roundStart=r=>P.firstWave+(r-1)*P.interval;
// Best openings and countdown plans found by bots/v4_calibrate.js (moves 3 s before round r).
const PLANS={
  l1:{opening:[[6,1],[1,4],[6,4]],moves:[{r:2,id:1,cell:[1,3]},{r:5,id:0,cell:[1,4]},{r:8,id:1,cell:[1,2]}]},
  l2:{opening:[[1,1],[7,1],[3,6]],moves:[{r:2,id:1,cell:[7,3]},{r:3,id:0,cell:[2,1]},{r:4,id:0,cell:[4,1]},{r:5,id:0,cell:[1,1]}]}};
function useLevel(name){assert(D.select(name));E.reset();}
function play(plan,lead=3,moves=plan.moves){
  const g=new Game();plan.opening.forEach((c,id)=>assert(g.place(id,c)));assert(g.start());
  for(const m of moves){g.advance(roundStart(m.r)-lead-g.t);assert(g.place(m.id,m.cell),`move to ${m.cell}`);}
  g.advance(P.duration-g.t+1);return g;
}
function setup(){const g=new Game();PLANS[D.map].opening.forEach((c,id)=>assert(g.place(id,c)));assert(g.start());return g;}

test('Every estate sends people every round, steadily through the whole round (no idle end of a round)',()=>{
  for(const name of ['l1','l2']){useLevel(name);
    assert(P.release>=P.interval-15,`${name}: release ${P.release} leaves a gap`);
    D.waves.forEach(w=>w.forEach(n=>assert(n>0,`${name}: an estate sends nobody in a round`)));
    const g=new Game();
    for(const p of g.people){const s=P.firstWave+p.wave*P.interval;assert(p.born>=s&&p.born<s+P.release);}
    assert.equal(g.people.length,total());}
  useLevel('l1');
});
test('Willingness falls 10 points a block; exactly comes(n,share) people accept a share',()=>{
  assert.deepEqual([0,1,2,3,4,5,6,9,10,12].map(willing),[1,.9,.8,.7,.6,.5,.4,.1,0,0]);
  const g=new Game();
  D.waves.forEach((w,wi)=>w.forEach((n,o)=>{const ps=g.people.filter(p=>p.wave===wi&&p.origin===o);assert.equal(ps.length,n);
    for(const s of [1,.9,.7,.5,.3])assert.equal(ps.filter(p=>p.preference<s).length,comes(n,s));}));
});
test('What the map forecasts is who walks out on the first try (stops ready, no queues full yet)',()=>{
  const g=setup(),fc=g.forecast(),t=P.firstWave+40;g.advance(t);
  D.origins.forEach((o,i)=>{const born=g.people.filter(p=>p.wave===0&&p.origin===i&&p.born<=t-P.tick);
    const want=born.filter(p=>p.preference<fc[i].share).length;
    const went=born.filter(p=>g.events.some(e=>e.type==='walk'&&e.id===p.id)).length;
    assert.equal(went,want,o.name);});
});
test('Headway is the level\'s base + step per block to the MTR',()=>{
  for(const name of ['l1','l2']){useLevel(name);
    for(const c of D.candidates)assert.equal(headwayAt(c),D.headway[0]+D.headway[1]*dist(c,D.hub));}
  useLevel('l1');
});
test('Seats, queue and population are conserved through a full game; driving is permanent',()=>{
  const g=setup(),lost=new Set();
  for(let i=0;i<P.duration/P.tick;i++){g.advance(P.tick);
    for(const s of g.stops){assert(s.queue.length<=P.queue);assert(s.boarding.length<=P.seats);}
    for(const b of g.trips)assert(b.load.length<=P.seats);
    for(const p of g.people){if(lost.has(p.id))assert.equal(p.state,'car');if(p.state==='car')lost.add(p.id);}
    const st=g.stats();assert.equal(st.delivered+st.cars+st.missed+st.active+st.future,total());}
  assert(g.done);
});
test('A moved stop cools down: nobody queues or boards, the timetable keeps running, it boards right after',()=>{
  const g=setup();g.advance(300);const s=g.stops[0],waiting=[...s.queue,...s.boarding],before=s.departAt,hw0=g.headway(s);
  assert(waiting.length>0);
  const to=D.candidates.find(c=>!g.stops.some(x=>same(x.cell,c))&&g.forecast(0,c).some(f=>f.stop===0));
  assert(g.place(0,to));assert.equal(g.moves,P.moves-1);assert.equal(s.ready,300+P.cool);assert.equal(s.departAt,before);
  waiting.forEach(id=>{assert(['return','walk'].includes(g.person(id).state));assert(!g.person(id).giveUp,'a move is not the passenger\'s failure');});
  const dispatches=()=>g.events.filter(e=>e.type==='dispatch'&&e.stop===0).length,d0=dispatches();
  for(let k=0;k<P.cool/P.tick-1;k++){g.advance(P.tick);assert.equal(s.queue.length+s.boarding.length,0);}
  assert.equal(dispatches(),d0,'no departures are recorded while cooling down');
  // the timetable kept its rhythm: the next departure is the old one plus whole headways
  const gap=s.departAt-before;assert(gap>=0);assert(Math.abs(gap/hw0-Math.round(gap/hw0))<1e-6||gap%g.headway(s)<1e-6);
  g.advance(150);assert(g.events.some(e=>e.type==='queue'&&e.stop===0&&e.time>=s.ready),'boards again after the cool-down');
});
test('Moving in the countdown beats moving 40 s early: stops are still busy at the end of a round',()=>{
  for(const name of ['l1','l2']){useLevel(name);
    const on=play(PLANS[name]).delivered,early=play(PLANS[name],43).delivered;
    assert(on>early,`${name}: countdown ${on} vs 40 s early ${early}`);}
  useLevel('l1');
});
test('Moves are limited by the level; occupied cells are rejected; starting needs three stops',()=>{
  const g=new Game();assert(!g.start());g.place(0,D.candidates[0]);assert(!g.place(1,D.candidates[0]));
  g.place(1,D.candidates[7]);g.place(2,D.candidates[9]);g.start();
  for(let i=0;i<P.moves;i++)assert(g.place(0,D.candidates[i%2?0:1]));assert(!g.place(0,D.candidates[2]));
});
test('Frame rate does not change the result',()=>{
  const a=setup(),b=setup();a.advance(P.duration);for(let t=0;t<P.duration*10;t++)b.advance(.1);
  assert.deepEqual(a.stats(),b.stats());
});
test('Every level is well formed: candidates on roads, every estate reaches the MTR, neighbours can share a stop',()=>{
  for(const name of ['l1','l2']){useLevel(name);
    const onRoad=c=>D.roads.some(r=>same(r,c));
    assert(onRoad(D.hub));
    D.candidates.forEach(c=>{assert(onRoad(c),`${name}: candidate ${c} off road`);assert(!same(c,D.hub));});
    D.origins.forEach((o,i)=>{assert(onRoad(o.cell));assert(E.toMTR[i]>0,`${name}: ${o.name} cannot reach the MTR`);
      assert(D.candidates.some(c=>E.shareAt(i,c)>=.8),`${name}: ${o.name} has no good stop`);
      assert(D.candidates.some(c=>E.shareAt(i,c)>0&&D.origins.some((q,j)=>j!==i&&E.shareAt(j,c)>0)),`${name}: ${o.name} shares no stop`);});
    // water only where there is no road, except the bridges
    for(const [x1,y,x2] of D.water||[])for(let x=x1;x<=x2;x++)if(onRoad([x,y]))assert((D.bridges||[]).some(b=>same(b,[x,y])),`${name}: road through water at ${x},${y}`);
    const g=play({opening:D.candidates.slice(0,3),moves:[]});const st=g.stats();assert.equal(st.delivered+st.cars+st.missed,st.total);}
  useLevel('l1');
});
test('Switching levels in place plays exactly like loading that level fresh',()=>{
  const fresh={},rx=/[\\/]v4[\\/](engine|data)\.js$/;
  for(const name of ['l1','l2']){
    for(const k of Object.keys(require.cache))if(rx.test(k))delete require.cache[k];
    process.env.FEEDER_MAP=name;const F=require('./engine.js');
    const g=new F.Game();[0,1,2].forEach(id=>g.place(id,F.D.candidates[id*2+1]));g.start();g.advance(F.P.duration);
    fresh[name]={stats:g.stats(),P:{...F.P},toMTR:F.toMTR.slice()};
  }
  for(const k of Object.keys(require.cache))if(rx.test(k))delete require.cache[k];
  process.env.FEEDER_MAP='l1';const F=require('./engine.js');
  for(const name of ['l2','l1','l2']){
    assert(F.D.select(name));F.reset();assert.equal(F.D.map,name);
    const g=new F.Game();[0,1,2].forEach(id=>g.place(id,F.D.candidates[id*2+1]));g.start();g.advance(F.P.duration);
    assert.deepEqual(g.stats(),fresh[name].stats,`${name}: different result after switching`);
    assert.deepEqual({...F.P},fresh[name].P);assert.deepEqual(F.toMTR,fresh[name].toMTR);
  }
  assert(!F.D.select('nowhere'));assert(!Object.keys(F.D).includes('select'));
  process.env.FEEDER_MAP=BOARD||'';
});
test('Difficulty holds: only the best few openings pass without moving, none reaches high, the countdown plan reaches master',()=>{
  const F=require('./engine.js');           // the instance loaded last
  for(const name of ['l1','l2']){F.D.select(name);F.reset();
    const C=F.D.candidates,scores=[];
    for(let a=0;a<C.length;a++)for(let b=a+1;b<C.length;b++)for(let c=b+1;c<C.length;c++){
      const g=new F.Game();[a,b,c].forEach((k,id)=>g.place(id,C[k]));g.start();g.advance(F.P.duration+1);scores.push(g.delivered);}
    const pass=scores.filter(s=>s>=F.P.target).length,best=Math.max(...scores);
    assert(pass>=1&&pass<=8,`${name}: ${pass} openings pass without moving`);
    assert(best<F.P.highScore,`${name}: an opening reaches high (${best}) without moving`);
    const g=new F.Game(),plan=PLANS[name];plan.opening.forEach((c,id)=>g.place(id,c));g.start();
    for(const m of plan.moves){g.advance(F.P.firstWave+(m.r-1)*F.P.interval-3-g.t);g.place(m.id,m.cell);}
    g.advance(F.P.duration-g.t+1);
    assert(g.delivered>=F.P.masterScore,`${name}: the countdown plan ${g.delivered} < master ${F.P.masterScore}`);}
});
test('Every text has all three languages, and every key the page uses exists',()=>{
  const fs=require('node:fs'),path=require('node:path'),src=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
  require('./i18n.js');const T=globalThis.I18N,body=src('i18n.js');
  const keys=[...body.matchAll(/'([\w.]+)':L\(/g)].map(m=>m[1]);
  const used=new Set();
  for(const m of src('ui.js').matchAll(/\bt\('([\w.]+)'[,)]/g))used.add(m[1]);
  for(const m of src('ui.js').matchAll(/\bt\(([a-z]+)\?'([\w.]+)':'([\w.]+)'/g)){used.add(m[2]);used.add(m[3]);}
  for(const m of src('index.html').matchAll(/data-i18n(?:-html|-title|-aria)?="([\w.]+)"/g))used.add(m[1]);
  const L=require('./data.js');
  for(const m of L.levels){used.add('src.'+m);used.add('site.'+m);used.add('lvEn.'+m);}
  for(let n=0;n<=3;n++)used.add('r.t'+n);
  for(const k of used)assert(keys.includes(k),`missing text: ${k}`);
  for(const lang of T.LANGS){T.set(lang);for(const k of keys){const v=T.t(k);assert(typeof v==='string'&&v!==k,`${k} in ${lang}`);
    if(lang!=='en'&&!['hub.enNames','b.mtr'].includes(k))assert(v.length>0,`${k} is empty in ${lang}`);}}
  T.set('zh-Hant');
});
test('A finished game replays from its record to the same score (the leaderboard check), and a forged record fails',()=>{
  const verify=require('./verify_result.js'),F=require('./engine.js');
  for(const name of ['l1','l2']){F.D.select(name);F.reset();
    const C=F.D.candidates,g=new F.Game();[0,1,2].forEach(id=>g.place(id,C[id*2+1]));g.start();
    const run=until=>{while(g.t<until&&!g.done)g.advance(.37);};
    run(230);assert(g.place(0,C[C.length-1]));run(470);assert(g.place(1,C[C.length-2]));run(Infinity);
    const json=JSON.parse(JSON.stringify({map:name,score:g.delivered,seed:g.seed,opening:g.opening,moves:g.commands}));
    const v=verify(json);assert(v.ok,`${name}: ${JSON.stringify(v)}`);
    assert(!verify({...json,score:json.score+1}).ok);
    assert(!verify({...json,moves:Array(P.moves+1).fill(json.moves[0])}).ok);}
});
console.log(`${passed} checks passed`);
