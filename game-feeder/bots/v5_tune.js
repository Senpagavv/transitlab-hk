'use strict';
// v5 (shares) level check. Everyone near a stop rides, split by pull; cars come only from full stops and patience.
//   node bots/v5_tune.js l1              (a level in v5/data.js)
//   node bots/v5_tune.js path/defs.js    (a module exporting {name: levelDef, ...}; tuning drafts)
// Reports, per level:
//   statics   every 3-stop opening without moves: best, spread, how many reach the best / everyone by bus
//   planner   moves only in the 3-second countdown before a round (from the five best openings): the intended play
//   early     the planner's moves 40 s earlier: must not pay much more (no reason to dodge the countdown)
//   forecast  how often the map's overflow warning (load > capacity in some round) agrees with real cars
const path=require('node:path');
const E=require('../v5/engine.js'),{D,P}=E,bots=require('./lib.js');
const arg=process.argv[2]||'l1';
const defs=arg.endsWith('.js')?require(path.resolve(arg)):{[arg]:null};
const roundStart=w=>P.firstWave+w*P.interval;
for(const [name,def] of Object.entries(defs)){
  if(def)D.use(def,name);else if(!D.select(name))throw Error('no level '+name);
  E.reset();
  const B=bots(E),n=D.candidates.length,total=D.waves.flat().reduce((a,b)=>a+b,0);
  const statics=B.layouts.map(l=>({l,s:B.play(l).delivered})).sort((a,b)=>b.s-a.s);
  const sc=statics.map(x=>x.s),q=f=>sc[Math.floor(f*(sc.length-1))];
  function planner(start,lead=3){
    const moves=[];let score=B.play(start).delivered;
    for(let w=1;w<D.waves.length&&moves.length<P.moves;w++){
      const time=roundStart(w)-lead,cells=start.slice();for(const m of moves)cells[m.id]=m.to;let pick=null;
      for(let id=0;id<3;id++)for(let to=0;to<n;to++){if(cells.includes(to))continue;
        const d=B.play(start,[...moves,{time,id,to}]).delivered;if(d>score&&(!pick||d>pick.d))pick={d,m:{time,id,to}};}
      if(pick){moves.push(pick.m);score=pick.d;}
    }
    return{moves,score};
  }
  let plan={moves:[],score:-1,start:null};
  for(const x of statics.slice(0,process.env.STARTS?+process.env.STARTS:5)){const p=planner(x.l);if(p.score>plan.score)plan={...p,start:x.l};}
  const shift=dt=>B.play(plan.start,plan.moves.map(m=>({...m,time:Math.max(1,m.time+dt)}))).delivered;
  // the map's warning: some stop's forecast load exceeds its capacity in some round
  let agree=0;
  for(const x of statics){const g=new E.Game();x.l.forEach((c,id)=>g.place(id,D.candidates[c]));
    const fc=g.forecast(),warn=fc.stops.some(s=>s.over.some(v=>v>0));if(warn===(x.s<total))agree++;}
  const cellOf=i=>D.candidates[i].join(',');
  console.log(JSON.stringify({level:name,total,candidates:n,rounds:D.waves.length,
    statics:{best:sc[0],bestLayout:statics[0].l.map(cellOf),p90:q(.1),median:q(.5),worst:sc.at(-1),atBest:sc.filter(s=>s===sc[0]).length,
      allByBus:sc.filter(s=>s===total).length,within5:sc.filter(s=>s>=sc[0]-5).length,of:sc.length},
    planner:{score:plan.score,gain:plan.score-sc[0],moves:plan.moves.map(m=>`r${Math.round((m.time+3-P.firstWave)/P.interval)+1}:${'ABC'[m.id]}->${cellOf(m.to)}`)},
    early:{'-40s':shift(-40),plan:plan.score},
    forecastAgrees:+(agree/statics.length).toFixed(2)}));
}
