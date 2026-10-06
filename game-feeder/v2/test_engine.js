'use strict';
// Rule checks for v2. Run: node test_engine.js   (bots/evaluate.js covers difficulty)
const assert=require('node:assert/strict');
const {Game,D,P,dist,length,same,willing,comes,headwayAt}=require('./engine.js');
const total=D.waves.flat().reduce((a,b)=>a+b,0);
let passed=0;
function test(name,fn){fn();passed++;console.log('ok',name);}
function setup(a=[0,7,11]){const g=new Game();a.forEach((i,id)=>assert(g.place(id,D.candidates[i])));assert(g.start());return g;}
function finish(g){g.advance(P.duration-g.t);return g;}

test('Demand is regular: a fixed number per estate per batch, plus exactly one peak per estate',()=>{
  assert.equal(D.waves.length,8);
  D.origins.forEach((o,i)=>{
    const col=D.waves.map(w=>w[i]),peaks=D.peaks.filter(p=>p.origin===i);
    assert.equal(peaks.length,1);
    col.forEach((n,w)=>assert.equal(n,D.base[i]+(w===peaks[0].wave?peaks[0].extra:0)));
    assert.equal(o.count,col.reduce((a,b)=>a+b,0));
  });
  assert.equal(new Game().people.length,total);
});
test('Willingness is the distance table: 100/100/80/60/40/20/0 %',()=>{
  assert.deepEqual([0,1,2,3,4,5,6,9].map(willing),[1,1,.8,.6,.4,.2,0,0]);
  assert.equal(comes(18,.8),14);assert.equal(comes(3,.6),2);assert.equal(comes(6,1),6);assert.equal(comes(3,0),0);
});
test('Each batch has evenly spread thresholds, so exactly comes(n,share) people accept a share',()=>{
  const g=new Game();
  D.waves.forEach((w,wi)=>w.forEach((n,o)=>{const ps=g.people.filter(p=>p.wave===wi&&p.origin===o);assert.equal(ps.length,n);
    for(const s of [1,.8,.6,.4,.2])assert.equal(ps.filter(p=>p.preference<s).length,comes(n,s));}));
});
test('What the map forecasts is what walks out on the first try (stops ready, no queues yet)',()=>{
  const g=setup([1,7,11]),fc=g.forecast();
  g.advance(P.firstWave+P.release+1);
  D.origins.forEach((o,i)=>{const walked=g.events.filter(e=>e.type==='walk'&&e.origin===i).length;assert.equal(walked,fc[i].perWave[0],o.name);});
});
test('People pick the stop with the highest share; ties go to the more frequent stop',()=>{
  const g=setup([0,1,7]),p=g.people.find(p=>p.origin===0);p.deadline=1e9;
  assert.equal(g.choose(p,D.origins[0].cell).id,0);              // [2,6] is 1 block (100%), [3,6] is 2 (80%)
  const h=new Game();[[3,6],[3,4],[6,6]].forEach((c,id)=>h.place(id,c));h.start();
  const q=h.people.find(p=>p.origin===0);q.deadline=1e9;q.preference=0;
  assert.equal(willing(dist(D.origins[0].cell,[3,6])),.8);
  assert.equal(h.choose(q,D.origins[0].cell).id,0);
});
test('Headway is 60 s + 10 s per block to the MTR',()=>{assert.equal(headwayAt([6,3]),70);assert.equal(headwayAt([2,6]),120);});
test('Seats, queue and population are conserved through a full round; driving is permanent',()=>{
  const g=setup(),lost=new Set();
  for(let i=0;i<P.duration/P.tick;i++){g.advance(P.tick);
    for(const s of g.stops){assert(s.queue.length<=P.queue);assert(s.boarding.length<=P.seats);}
    for(const b of g.trips)assert(b.load.length<=P.seats);
    for(const p of g.people){if(lost.has(p.id))assert.equal(p.state,'car');if(p.state==='car')lost.add(p.id);}
    const st=g.stats();assert.equal(st.delivered+st.cars+st.missed+st.active+st.future,total);}
  assert(g.done);assert(g.events.some(e=>e.type==='full'));
});
test('Someone turned away by a full stop does not walk back to that same stop',()=>{
  const g=finish(setup());
  for(const e of g.events.filter(e=>e.type==='full')){
    const later=g.events.filter(x=>x.id===e.id&&x.type==='walk'&&x.time>e.time);
    for(const w of later)assert.notEqual(w.stop,e.stop);
  }
});
test('Nobody walks to a stop that is as far as the MTR, so nobody walks past the station and rides back',()=>{
  const {shareAt,toMTR,route}=require('./engine.js');
  assert.equal(shareAt(3,[6,6]),0);                                   // 橫洲 → south of the MTR: 5 blocks via the station
  assert.equal(shareAt(1,[3,4]),0);                                   // 翹翠峰 → past the MTR's corner: 4 ≥ 3
  assert.equal(shareAt(3,[6,2]),1);
  for(const layout of [[0,7,11],[3,7,12],[0,6,10],[4,5,12]]){
    const g=finish(setup(layout));
    for(const e of g.events.filter(e=>e.type==='walk')){
      const p=g.person(e.id);
      assert(!route(D.origins[p.origin].cell,g.stops[e.stop].cell).slice(1,-1).some(c=>same(c,D.hub))||false,'walked through the MTR');
    }
    for(const p of g.people)assert(p.walked<toMTR[p.origin]+1e-6,`${D.origins[p.origin].name} walked ${p.walked} ≥ ${toMTR[p.origin]}`);
  }
});
test('Turned away: switch on the spot within the walking budget; otherwise home to think it over; two trips out at most',()=>{
  const g=finish(setup([1,0,7]));
  const people=new Set(g.events.filter(e=>e.type==='full'||e.why==='久候返家').map(e=>e.id));
  assert(people.size>0);
  for(const id of people){
    const walks=g.events.filter(e=>e.id===id&&e.type==='walk');
    assert(walks.length<=2,'more than two trips out');
  }
  assert(g.events.some(e=>e.type==='switch'),'nobody ever switched');
});
test('Back home, people think it over before driving (up to homeGrace, within their patience)',()=>{
  const g=finish(setup([1,0,7]));let checked=0;
  for(const car of g.events.filter(e=>e.type==='car')){
    const home=g.events.filter(e=>e.id===car.id&&e.type==='home'&&e.time<=car.time).at(-1);if(!home)continue;
    const p=g.person(car.id),expect=Math.min(P.homeGrace,p.deadline-home.time);
    assert(car.time-home.time>=expect-P.tick-1e-6,`drove ${car.time-home.time}s after getting home, expected ~${expect}s`);checked++;
  }
  assert(checked>0,'nobody came home and drove');
});
test('Every car has a reason the result screen can show',()=>{
  const g=finish(setup());const why=new Set(g.events.filter(e=>e.type==='car').map(e=>e.why));
  for(const w of why)assert(['沒有夠近的站','站滿了','等太久'].includes(w),w);
});
test('Buses go stop → MTR once; scoring happens on arrival, once per person',()=>{
  const g=finish(setup()),del=g.events.filter(e=>e.type==='delivered');
  assert.equal(new Set(del.map(e=>e.id)).size,del.length);
  for(const b of g.trips){assert(same(b.path.at(-1),D.hub));assert.equal(b.end-b.since,length(b.path)*P.busStep);}
});
test('Moving a stop sends its waiting people home, keeps departed buses, restarts the clock after rebuild',()=>{
  const g=setup();g.advance(200);const s=g.stops[0],waiting=[...s.queue,...s.boarding];assert(waiting.length>0);
  const trip=g.trips.find(b=>!b.done&&b.stop===0);
  assert(g.place(0,D.candidates[1]));assert.equal(g.moves,P.moves-1);assert.equal(s.ready,200+P.build);assert.equal(s.departAt,200+P.build+g.headway(s));
  waiting.forEach(id=>assert(['return','walk'].includes(g.person(id).state)));   // home, or on to another stop
  waiting.forEach(id=>assert(!g.person(id).giveUp,'a move is not the passenger\'s failure'));
  if(trip){g.advance(80);assert(trip.done);}
});
test('Moves are limited; occupied cells are rejected; starting needs three stops',()=>{
  const g=new Game();assert(!g.start());g.place(0,D.candidates[0]);assert(!g.place(1,D.candidates[0]));
  g.place(1,D.candidates[7]);g.place(2,D.candidates[11]);g.start();
  for(let i=0;i<P.moves;i++)assert(g.place(0,D.candidates[i%2?0:1]));assert(!g.place(0,D.candidates[2]));
});
test('Frame rate does not change the result',()=>{
  const a=setup(),b=setup();a.advance(P.duration);for(let t=0;t<P.duration*10;t++)b.advance(.1);
  assert.deepEqual(a.stats(),b.stats());
});
console.log(`${passed} checks passed`);
