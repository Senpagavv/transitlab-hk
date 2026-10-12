'use strict';
// Stress test for the rules engine with random levels like the editor can make: random road networks, 2–6 estates,
// and settings at their limits (no queue places, one seat, no moves, no cool-down, short patience, rounds that
// overlap, odd willingness tables). Random openings and random moves at random times.
//   node fuzz_engine.js [levels=200] [seed=1]      (test_engine.js runs a short version)
// Checks after every step: capacity, conservation, nobody leaves a bus; at the end: the game ended, nobody unfinished.
const E=require('./engine.js'),{D,P,Game,rng,same}=E;
function fuzz(levels=200,seed=1,log=()=>{}){
  const r=rng(seed),ri=(a,b)=>a+Math.floor(r()*(b-a+1)),pick=a=>a[Math.floor(r()*a.length)];
  let games=0;
  for(let L=0;L<levels;L++){
    const cols=ri(5,14),rows=ri(4,10),key=c=>c.join(',');
    // a connected road network grown from the station
    const hub=[ri(0,cols-1),ri(0,rows-1)],roads=new Map([[key(hub),hub]]);
    const target=ri(8,Math.min(60,cols*rows));
    while(roads.size<target){const from=pick([...roads.values()]),d=pick([[1,0],[-1,0],[0,1],[0,-1]]),len=ri(1,4);let c=from;
      for(let i=0;i<len;i++){c=[c[0]+d[0],c[1]+d[1]];if(c[0]<0||c[1]<0||c[0]>=cols||c[1]>=rows)break;roads.set(key(c),c);}}
    const cells=[...roads.values()].filter(c=>!same(c,hub));
    if(cells.length<5){L--;continue;}
    const shuffled=cells.map(c=>[r(),c]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
    const ne=ri(2,Math.min(6,shuffled.length-3)),estates=shuffled.slice(0,ne).map((c,i)=>({name:'E'+i,cell:c,house:[0,40]}));
    const candidates=shuffled.slice(ne>2?1:0).slice(0,ri(3,Math.min(12,shuffled.length)));
    if(candidates.length<3){L--;continue;}
    const rounds=ri(1,8),interval=ri(30,160);
    const def={cols,rows,roads:[...roads.values()],waterCells:cells.filter(()=>r()<.1),hub,candidates,estates,
      waves:Array.from({length:rounds},()=>estates.map(()=>ri(0,15))),firstWave:ri(0,30),interval,release:ri(5,interval+60),
      headway:[ri(10,120),ri(0,15)],seats:ri(1,12),queue:ri(0,10),cool:ri(0,60),moves:ri(0,6),patience:ri(60,400),
      willing:Array.from({length:7},(_,i)=>i===0?1:+(r()).toFixed(1)),tiers:[1,2,3]};
    // v6: habit (one round a day) and groups on some levels, at their limits too
    if(r()<.35)Object.assign(def,{days:true,habit:{start:+(.1+.9*r()).toFixed(2),rate:+(.1+.9*r()).toFixed(2),good:1.25,bad:.5,min:.4,max:1.5,floor:.1}});
    if(r()<.35){const mix=()=>{const a=[r(),r(),r()],s=a[0]+a[1]+a[2]||1;return a.map(x=>+(x/s).toFixed(3));};
      def.groups={order:['old','stu','work'],old:{drop:pick([.2,.35,.5]),walk:pick([1,1.3,2])},stu:{bell:ri(20,200)},work:{maxHeadway:ri(40,200)}};
      def.mix=r()<.5?estates.map(mix):def.waves.map(()=>estates.map(mix));}
    D.loadEditor(def);E.reset();
    const total=D.waves.flat().reduce((a,b)=>a+b,0);
    for(let gi=0;gi<3;gi++){
      const g=new Game(ri(1,99999)),open=candidates.map(c=>[r(),c]).sort((a,b)=>a[0]-b[0]).slice(0,3).map(x=>x[1]);
      open.forEach((c,id)=>{if(!g.place(id,c))throw Error(`L${L}: opening refused`);});
      if(!g.start())throw Error(`L${L}: start refused`);
      const moves=Array.from({length:ri(0,P.moves+2)},()=>({time:ri(1,P.lastRound),id:ri(0,2),to:pick(candidates)})).sort((a,b)=>a.time-b.time);
      const boarded=new Set();
      while(!g.done){
        while(moves.length&&moves[0].time<=g.t){const m=moves.shift();g.place(m.id,m.to);}   // refused moves are fine
        g.advance(ri(1,9)*P.tick);
        for(const s of g.stops){if(s.queue.length>P.queue)throw Error(`L${L}: queue ${s.queue.length} > ${P.queue}`);
          if(s.boarding.length>P.seats)throw Error(`L${L}: aboard ${s.boarding.length} > ${P.seats}`);}
        for(const b of g.trips)if(b.load.length>P.seats)throw Error(`L${L}: bus load`);
        for(const p of g.people){if(p.state==='seated'||p.state==='bus')boarded.add(p.id);
          if(boarded.has(p.id)&&!['seated','bus','delivered'].includes(p.state))throw Error(`L${L}: person ${p.id} left the bus (${p.state})`);}
        const st=g.stats();if(st.delivered+st.cars+st.missed+st.active+st.future!==total)throw Error(`L${L}: people lost`);
        if(g.t>P.duration+1)throw Error(`L${L}: did not end`);
      }
      if(g.missed)throw Error(`L${L}: ${g.missed} unfinished at the end`);
      if(!Number.isFinite(g.t))throw Error(`L${L}: bad clock`);
      games++;
    }
    log(L);
  }
  return games;
}
module.exports=fuzz;
if(require.main===module){const n=+(process.argv[2]||200),seed=+(process.argv[3]||1),t0=Date.now();
  const games=fuzz(n,seed,L=>{if(L%25===24)console.log(`${L+1} levels…`);});console.log(`ok: ${n} random levels, ${games} games, ${((Date.now()-t0)/1000).toFixed(1)} s`);}
