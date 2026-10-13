'use strict';
// v7 mode 1 · the AI demo's plans: for every level, one way to reach each score line (pass, high, master).
//   node bots/v7_demo_plans.js          → writes game-feeder/v7/mode1-bus/demo-plans.js
// pass:   an opening left alone that clears the pass line but not the high score (the simplest way to pass)
// high:   an opening left alone if one reaches the high score but not master; else the fewest break moves from a
//         good opening that get there
// master: the plan the rule checks use (test_engine.js PLANS) — or the best static opening if it already is master
// Moves: {r, id, cell} = in the break before round r (counted from 1); with at = that many seconds into round r
// (an extra move, mid-round). Every plan is replayed here and its score written down; the page replays it the same way.
const fs=require('node:fs'),path=require('node:path');
const E=require('../v7/mode1-bus/engine.js'),{D,P}=E;
const MASTER={
  l1:null,   // a static opening is master on level 1
  l2:{opening:[[1,1],[3,4],[3,5]],moves:[{r:2,id:2,cell:[1,3]},{r:3,id:2,cell:[3,5]},{r:3,id:1,cell:[3,6]},{r:4,id:0,cell:[2,1]}]},
  l3:{opening:[[2,2],[3,2],[2,5]],moves:[{r:2,id:1,cell:[4,4]},{r:3,id:2,cell:[2,6]},{r:3,at:60,id:2,cell:[2,5]}]},
  l4:{opening:[[2,3],[3,1],[3,6]],moves:[{r:2,id:0,cell:[2,2]},{r:2,id:1,cell:[4,1]},{r:2,at:90,id:0,cell:[2,3]},{r:3,id:1,cell:[5,1]}]}};
function play(plan){
  const g=new E.Game();plan.opening.forEach((c,id)=>{if(!g.place(id,c))throw Error('opening '+c);});g.start();
  for(const m of plan.moves){g.runTo(m.r-1);if(m.at!==undefined)g.advance(g.roundStart[m.r-1]+m.at-g.t);if(!g.place(m.id,m.cell))throw Error('move '+JSON.stringify(m));}
  g.advance(P.duration+1);return g.delivered;
}
const out={};
for(const name of ['l1','l2','l3','l4']){
  D.select(name);E.reset();
  const C=D.candidates,n=C.length,R=D.waves.length,T=[P.target,P.highScore,P.masterScore];
  const statics=[];
  for(let a=0;a<n;a++)for(let b=a+1;b<n;b++)for(let c=b+1;c<n;c++){const plan={opening:[C[a],C[b],C[c]],moves:[]};statics.push({...plan,score:play(plan)});}
  statics.sort((x,y)=>y.score-x.score);
  const inRange=(lo,hi)=>statics.filter(s=>s.score>=lo&&s.score<hi);
  // greedy break moves from an opening until the score reaches `goal` (fewest moves first)
  function climb(start,goal){
    let plan={opening:start.opening,moves:[]},score=start.score;
    for(let r=2;r<=R&&score<goal;r++)for(let k=0;k<3&&score<goal;k++){
      const cells=plan.opening.map(c=>c);for(const m of plan.moves)cells[m.id]=m.cell;
      let best=null;
      for(let id=0;id<3;id++){if(plan.moves.some(m=>m.r===r&&m.id===id))continue;
        for(const cell of C){if(cells.some(c=>E.same(c,cell)))continue;
          const p={opening:plan.opening,moves:[...plan.moves,{r,id,cell}]},s=play(p);if(s>score&&(!best||s>best.s))best={p,s};}}
      if(!best)break;plan=best.p;score=best.s;}
    return score>=goal?{...plan,score}:null;
  }
  const pick=list=>list[Math.floor(list.length/2)];     // the middle one of a range: neither lucky nor perfect
  let pass=pick(inRange(T[0],T[1]));
  if(!pass){for(const s of inRange(0,T[0]).slice(0,10)){const c=climb(s,T[0]);if(c&&c.score<T[1]){pass=c;break;}}}
  let high=pick(inRange(T[1],T[2]));
  if(!high){for(const s of statics.slice(0,10)){const c=climb(s,T[1]);if(c&&(!high||c.moves.length<high.moves.length))high=c;}}
  let master=MASTER[name]?{...MASTER[name],score:play(MASTER[name])}:statics[0];
  if(master.score<T[2])throw Error(`${name}: master plan ${master.score} < ${T[2]}`);
  out[name]={tiers:T,total:D.waves.flat().reduce((a,b)=>a+b,0),pass,high,master};
  const show=x=>x?`${x.score} (${x.moves.length} moves)`:'none';
  console.log(name,'tiers',T.join('/'),'| pass',show(pass),'| high',show(high),'| master',show(master),'| openings',statics.length,'best static',statics[0].score);
}
const file=path.join(__dirname,'../v7/mode1-bus/demo-plans.js');
fs.writeFileSync(file,`// v7 mode 1 · AI demo plans, written by bots/v7_demo_plans.js (${new Date().toISOString().slice(0,10)}). Do not edit by hand.\n`+
  `// level → {tiers, total, pass|high|master: {opening: 3 cells, moves: [{r, id, cell, at?}], score}}\n`+
  `(function(root){root.TL_DEMO_PLANS=${JSON.stringify(out)};if(typeof module!=='undefined')module.exports=root.TL_DEMO_PLANS;})(typeof window!=='undefined'?window:globalThis);\n`);
console.log('written',file);
