'use strict';
// v6: quick look at a level with variations of its numbers (openings without moves).
//   node bots/v6_probe.js l4 '{"waves":[[22,18,18,20]],"days":5}' '{"habit":{"start":.5}}'
// Each argument after the level merges into it (waves given once are repeated for `days` days).
const E=require('../v6/engine.js'),{D,P,Game}=E;
const [name,...variants]=process.argv.slice(2);
for(const v of variants.length?variants:['{}']){
  const base=D.example(name),over=JSON.parse(v);
  if(over.waves&&over.days)over.waves=Array(over.days).fill(over.waves[0]);
  if(over.habit)over.habit={...base.habit,...over.habit};
  if(over.groups){const g={...base.groups};for(const k of Object.keys(over.groups))g[k]=Array.isArray(over.groups[k])?over.groups[k]:{...base.groups[k],...over.groups[k]};over.groups=g;}
  D.use({...base,...over},name);E.reset();
  const C=D.candidates,total=D.waves.flat().reduce((a,b)=>a+b,0),rows=[];
  for(let a=0;a<C.length;a++)for(let b=a+1;b<C.length;b++)for(let c=b+1;c<C.length;c++){
    const g=new Game();[a,b,c].forEach((k,id)=>g.place(id,C[k]));g.start();g.advance(P.duration+1);rows.push({d:g.delivered,l:[a,b,c],g});}
  rows.sort((x,y)=>y.d-x.d);const sc=rows.map(r=>r.d),best=rows[0].g;
  const why={};for(const e of best.events)if(e.type==='car')why[e.why]=(why[e.why]||0)+1;
  const perDay=D.waves.map((w,r)=>best.people.filter(p=>p.wave===r&&p.state==='delivered').length);
  console.log(`${v.padEnd(48)} total ${total} best ${sc[0]} p90 ${sc[Math.floor(.1*sc.length)]} median ${sc[Math.floor(sc.length/2)]} | best ${JSON.stringify(rows[0].l.map(i=>C[i]))}`);
  console.log(`   by bus per day ${perDay.join(' ')} | cars ${JSON.stringify(why)}`+(best.habitLog?` | habit ${best.habitLog.map(h=>Math.round(100*h.habit.reduce((a,b)=>a+b,0)/h.habit.length)).join('→')}%`:''));
  if(D.groups){const by={};for(const p of best.people){const k=p.group;(by[k]??={n:0,ok:0}).n++;if(p.state==='delivered')by[k].ok++;}
    console.log('   groups',Object.entries(by).map(([k,v])=>`${k} ${v.ok}/${v.n}`).join(' '));}
}
