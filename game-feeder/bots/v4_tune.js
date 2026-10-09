'use strict';
// v4 (rounds) level check: is the level a puzzle with an optimum that is hard to find but reachable with effort?
//   node bots/v4_tune.js l1              (a level in v4/data.js)
//   node bots/v4_tune.js path/defs.js    (a module exporting {name: levelDef, ...}; tuning drafts)
// Reports, per level:
//   statics   every 3-stop opening without moves: spread (does the opening matter?) and how few clear each tier
//   planner   a player who moves only in the 3-second countdown before a round (full knowledge of the table):
//             the intended rhythm
//   greedy    a player who may move at any 15 s step (full knowledge): if this beats the planner a lot,
//             odd timing pays and the round rhythm is not what the rules reward
//   early     the planner's plan with every move 20 s / 40 s earlier (end of the previous round): must not pay —
//             a stop is still busy at the end of a round, so leaving early costs riders
//   window    the plan shifted by -30…+30 s: how wide the timing window is
//   idleTail  share of stop-seconds with nobody waiting or walking to the stop in the last 20 s of a round
//   legibility rank correlation between the visible-rule estimate and the real static score
const path=require('node:path');
const E=require('../v4/engine.js'),{D,P}=E,bots=require('./lib.js');
const arg=process.argv[2]||'l1';
const defs=arg.endsWith('.js')?require(path.resolve(arg)):{[arg]:null};
const roundStart=w=>P.firstWave+w*P.interval;
for(const [name,def] of Object.entries(defs)){
  if(def)D.use(def,name);else if(!D.select(name))throw Error('no level '+name);
  E.reset();
  const B=bots(E),n=D.candidates.length,total=D.waves.flat().reduce((a,b)=>a+b,0);
  const statics=B.layouts.map(l=>({l,s:B.play(l).delivered})).sort((a,b)=>b.s-a.s);
  const sc=statics.map(x=>x.s),q=f=>sc[Math.floor(f*(sc.length-1))];
  const best=statics[0];
  // planner: before each round (from round 2), in the countdown, try every single move or none
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
  // also start the planner from the five best openings, a good player tries several
  let plan={moves:[],score:-1,start:null};
  for(const x of statics.slice(0,5)){const p=planner(x.l);if(p.score>plan.score)plan={...p,start:x.l};}
  const shift=dt=>B.play(plan.start,plan.moves.map(m=>({...m,time:Math.max(1,m.time+dt)}))).delivered;
  const greedy=process.env.NOGREEDY?{delivered:null,moves:[]}:B.greedy(plan.start,P.moves,15);
  // idle tail on the planner's game
  const g=new E.Game();plan.start.forEach((c,id)=>g.place(id,D.candidates[c]));g.start();
  const mv=[...plan.moves].sort((a,b)=>a.time-b.time);let idle=0,cnt=0;
  while(g.t<P.duration-1&&!g.done){while(mv.length&&mv[0].time<=g.t){const m=mv.shift();g.place(m.id,D.candidates[m.to]);}
    g.advance(1);const into=(g.t-P.firstWave)%P.interval;
    if(g.t>P.firstWave+P.interval&&g.t<P.firstWave+D.waves.length*P.interval&&into>=P.interval-20)
      for(const s of g.stops){cnt++;if(s.ready<=g.t&&!s.queue.length&&!s.boarding.length&&!g.people.some(p=>p.state==='walk'&&p.target===s.id))idle++;}}
  const est=B.layouts.map(l=>B.estimate(l,true)),act=B.layouts.map(l=>B.play(l).delivered);
  const cellOf=i=>D.candidates[i].join(',');
  console.log(JSON.stringify({level:name,total,candidates:n,rounds:D.waves.length,
    statics:{best:best.s,bestLayout:best.l.map(cellOf),p90:q(.1),median:q(.5),worst:sc.at(-1),within3ofBest:sc.filter(s=>s>=best.s-3).length,of:sc.length},
    planner:{score:plan.score,gain:plan.score-best.s,moves:plan.moves.map(m=>`r${Math.round((m.time+3-P.firstWave)/P.interval)+1}:${'ABC'[m.id]}->${cellOf(m.to)}`)},
    greedy:{score:greedy.delivered,moves:greedy.moves.length},
    early:{'-20s':shift(-20),'-40s':shift(-40),plan:plan.score},
    window:Object.fromEntries([-30,-15,-5,5,15,30].map(dt=>[dt,shift(dt)])),
    idleTail:+(idle/Math.max(1,cnt)).toFixed(2),
    legibility:+B.spearman(est,act).toFixed(2)}));
}
