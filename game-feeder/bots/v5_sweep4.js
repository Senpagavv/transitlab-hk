'use strict';
// v5.2: four rounds, two busy estates a round. Try patterns × base × peak on one board (openings without moves).
//   node bots/v5_sweep4.js l1
// Per line: total, best opening, openings that carry everyone, median, and "calm" openings — no stop overflows and no
// estate left without a stop in any round's preview (what the rings show) — with their real scores.
const E=require('../v5/engine.js'),{D,P}=E,bots=require('./lib.js');
const name=process.argv[2]||'l1';
D.select(name);const base=D.example(name),k=base.estates.length;
const PAIRS={4:{A:[[0,1],[2,3],[0,2],[1,3]],B:[[0,1],[1,2],[2,3],[3,0]],C:[[0,3],[1,2],[1,3],[0,2]]},
  5:{A:[[0,1],[2,3],[4,0],[1,3]],B:[[0,1],[1,2],[3,4],[2,4]],C:[[0,4],[1,2],[3,0],[2,4]]}}[k];
const only=process.env.PAT;
for(const [pat,pairs] of Object.entries(PAIRS)){if(only&&!only.includes(pat))continue;
  for(const b of (process.env.BASE||'6,8,10').split(',').map(Number))for(const p of (process.env.PEAK||'8,12,16').split(',').map(Number)){
    const waves=pairs.map(pr=>Array.from({length:k},(_,o)=>pr.includes(o)?b+p:b));
    D.use({...base,waves,...(process.env.INTERVAL?{interval:+process.env.INTERVAL}:{})},name);E.reset();
    const B=bots(E),total=waves.flat().reduce((a,c)=>a+c,0);
    const rows=B.layouts.map(l=>{const g=B.play(l),f=new E.Game();l.forEach((c,id)=>f.place(id,D.candidates[c]));
      const calm=waves.every((w,r)=>{const fc=f.forecastRound(r);return !fc.estates.some(e=>e.drives)&&fc.stops.every(s=>!s.over);});
      return{s:g.delivered,calm};}).sort((a,c)=>c.s-a.s);
    const sc=rows.map(r=>r.s),calm=rows.filter(r=>r.calm).map(r=>r.s);
    console.log(`${pat} base ${b} peak +${p}`.padEnd(20),`total ${total}  best ${sc[0]}  perfect ${sc.filter(s=>s===total).length}/${sc.length}  top5 ${sc.slice(0,5).join(',')}  median ${sc[Math.floor(sc.length/2)]}  calm ${calm.length} [${calm.slice(0,6).join(',')}${calm.length>6?'…':''}]`);
  }}
