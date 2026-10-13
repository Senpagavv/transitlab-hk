'use strict';
// v7 mode 2 (metro) · does each decision matter? Every station set (2–4 stations on the alignment) × a few train plans.
//   node bots/v7_metro_probe.js '{"cap":16}' '{"cap":12,"scale":1.5}'      (each argument: overrides of the level)
// scale multiplies every estate's people; other keys replace level fields.
const M=require('../v7/mode2-metro/engine.js'),{D,P,Game}=M;
const base=D.example('m2-1');
const PLANS={flat:[3,3,3,3,3,3],ramp:[1,2,3,3,4,5],slow:[2,2,3,3,4,4],front:[5,4,3,2,2,2],late:[1,1,2,4,5,5]};
function play(stations,trains){const g=new Game();for(const c of stations)g.build(c);trains.forEach((n,w)=>g.setTrains(n,w));g.start();g.advance(1e5);return g;}
for(const arg of process.argv.slice(2).length?process.argv.slice(2):['{}']){
  const o=JSON.parse(arg),def={...base,...o};
  if(o.scale)def.origins=base.origins.map(x=>({...x,people:Math.round(x.people*o.scale)}));
  delete def.scale;D.use(def,'probe');M.reset();
  const L=D.line,sets=[];
  for(let a=0;a<L.length;a++)for(let b=a+1;b<L.length;b++){sets.push([L[a],L[b]]);
    for(let c=b+1;c<L.length;c++){sets.push([L[a],L[b],L[c]]);for(let d=c+1;d<L.length;d++)sets.push([L[a],L[b],L[c],L[d]]);}}
  const total=D.origins.reduce((s,x)=>s+x.people,0)*D.weeks;
  const rows=sets.map(s=>({s,score:play(s,PLANS.slow).delivered}));rows.sort((x,y)=>y.score-x.score);
  const q=f=>rows[Math.floor(f*(rows.length-1))].score,best=rows[0];
  console.log(`${arg}  people ${total} · sets ${rows.length} · plan slow: best ${best.score} [${best.s.map(c=>c.join(',')).join(' ')}] p90 ${q(.1)} median ${q(.5)}`);
  const by=n=>rows.filter(r=>r.s.length===n)[0];console.log('   best with 2 / 3 / 4 stations:',[2,3,4].map(n=>by(n).score).join(' / '));
  for(const r of rows.slice(0,3)){const line=Object.entries(PLANS).map(([k,v])=>{const g=play(r.s,v);return `${k} ${g.delivered}`;}).join(' · ');
    const g=play(r.s,PLANS.slow),why={};for(const e of g.events)if(e.type==='car')why[e.why]=(why[e.why]||0)+1;
    console.log(`   [${r.s.map(c=>c.join(',')).join(' ')}] ${line} | crowded ${g.events.filter(e=>e.type==='crowded').length} | ${JSON.stringify(why)} | habit ${g.habitLog.map(h=>Math.round(100*h.habit.reduce((a,b)=>a+b)/h.habit.length)).join('→')}`);}
}
