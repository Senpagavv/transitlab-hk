'use strict';
// v5: try demand patterns on one board (statics only, fast). node bots/v5_sweep.js l1
// Prints per pattern: total, best static, how many openings carry everyone by bus, median, and how often the map's
// overflow warning is right.
const E=require('../v5/engine.js'),{D,P}=E,bots=require('./lib.js');
const name=process.argv[2]||'l1';
D.select(name);const base=JSON.parse(JSON.stringify(D.example?D.example(name):{}));
const hold=(ph,n=2)=>ph.flatMap(w=>Array(n).fill(w));
const k=D.origins.length;
const rot=(b,p)=>Array.from({length:4},(_,i)=>Array.from({length:k},(_,o)=>o===i%k?b+p:b));
const designs=[];
for(const b of [4,5,6,7,8])for(const p of [6,8,10,12,14])designs.push({label:`base ${b} peak +${p}`,waves:hold(rot(b,p))});
for(const d of designs){
  D.use({...base,waves:d.waves},name);E.reset();
  const B=bots(E),total=D.waves.flat().reduce((a,b)=>a+b,0);
  let agree=0;const sc=B.layouts.map(l=>{const g=B.play(l);const f=new E.Game();l.forEach((c,id)=>f.place(id,D.candidates[c]));
    const warn=f.forecast().stops.some(s=>s.over.some(v=>v>0));if(warn===(g.delivered<total))agree++;return g.delivered;}).sort((a,b)=>b-a);
  console.log(`${d.label.padEnd(18)} total ${total}  best ${sc[0]}  allByBus ${sc.filter(s=>s===total).length}/${sc.length}  top5 ${sc.slice(0,5).join(',')}  median ${sc[Math.floor(sc.length/2)]}  warn-right ${(agree/sc.length).toFixed(2)}`);
}
