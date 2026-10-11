'use strict';
// v5: why did people drive in one opening? node bots/v5_why.js l1 5,4 6,6 6,2
// Prints, per round: each stop's round preview (people, fullest, turned away) and the cars by reason; per estate: share per stop.
const E=require('../v5/engine.js'),{D,P}=E;
const [name,...cells]=process.argv.slice(2);D.select(name);E.reset();
const g=new E.Game();cells.forEach((c,id)=>g.place(id,c.split(',').map(Number)));g.start();
const fc=g.forecast(),rounds=D.waves.map((w,r)=>g.forecastRound(r));
g.advance(P.duration+1);
const byRound=D.waves.map(()=>({cars:{},full:0})),roundOf=t=>{let r=0;while(r+1<g.roundStart.length&&g.roundStart[r+1]<=t)r++;return r;};
for(const e of g.events){if(e.type==='car'){const p=g.person(e.id);byRound[p.wave].cars[e.why]=(byRound[p.wave].cars[e.why]||0)+1;}
  if(e.type==='full')byRound[roundOf(e.time)].full++;}
console.log(`${name} ${cells.join(' ')}: bus ${g.delivered} / cars ${g.cars} / total ${g.people.length}`);
fc.estates.forEach((e,i)=>console.log(`  ${D.origins[i].name}: ${e.share.map((s,k)=>`${'ABC'[k]} ${Math.round(s*100)}% (pull ${Math.round(e.pull[k]*100)}, ${e.steps[k]} blocks)`).join(' · ')}`));
D.waves.forEach((w,wi)=>console.log(`  r${wi+1} [${w.join(',')}] ${rounds[wi].stops.map((s,k)=>`${"ABC"[k]} ${s.load} peak ${s.peak}/${s.room} over ${s.over}`).join('  ')}  full-events ${byRound[wi].full}  cars ${JSON.stringify(byRound[wi].cars)}`));
for(const s of g.stops)console.log(`  stop ${'ABC'[s.id]} ${s.cell} headway ${g.headway(s)} peak queue ${s.peak} rejected ${s.rejected}`);
