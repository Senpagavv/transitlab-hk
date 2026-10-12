'use strict';
// v5 level check (v5.3: a round starts when the one before has settled; moves are made in the break before a round).
//   node bots/v5_tune.js l1              (a level in v5/data.js)
//   node bots/v5_tune.js path/defs.js    (a module exporting {name: levelDef, ...}; tuning drafts)
// Reports, per level:
//   statics   every 3-stop opening without moves: best, spread, how many carry everyone by bus
//   calm      openings where no round's preview shows a full red ring or an estate without a stop — and their scores
//   planner   moves only in the breaks between rounds (from the five best openings): the intended play
//   mid       the planner's moves made 60 s into the round before instead (in the middle, without the rings)
const path=require('node:path');
const E=require('../v5/engine.js'),{D,P}=E;
const arg=process.argv[2]||'l1';
const defs=arg.endsWith('.js')?require(path.resolve(arg)):{[arg]:null};
for(const [name,def] of Object.entries(defs)){
  if(def)D.use(def,name);else if(!D.select(name))throw Error('no level '+name);
  E.reset();
  const n=D.candidates.length,total=D.waves.flat().reduce((a,b)=>a+b,0),R=D.waves.length;
  const layouts=[];for(let a=0;a<n-2;a++)for(let b=a+1;b<n-1;b++)for(let c=b+1;c<n;c++)layouts.push([a,b,c]);
  // a move {r,id,to} is made in the break before round r; with `at`, that many seconds into round r instead (an extra
  // move); with mid, every move is made that many seconds into the round before its break
  function play(layout,moves=[],mid=0){
    const g=new E.Game();layout.forEach((c,id)=>g.place(id,D.candidates[c]));g.start();
    for(const m of [...moves].sort((a,b)=>a.r-b.r||(a.at??-1)-(b.at??-1))){
      if(mid){g.runTo(m.r-1);g.advance(Math.max(0,g.roundStart[m.r-1]+mid-g.t));}
      else if(m.at!==undefined){g.runTo(m.r);g.advance(Math.max(0,g.roundStart[m.r]+m.at-g.t));}
      else g.runTo(m.r);
      g.place(m.id,D.candidates[m.to]);}
    g.advance(P.duration+1);return g;
  }
  const calmOf=l=>{const f=new E.Game();l.forEach((c,id)=>f.place(id,D.candidates[c]));
    return D.waves.every((w,r)=>{const fc=f.forecastRound(r);return !fc.estates.some(e=>e.drives)&&fc.stops.every(s=>!s.over);});};
  const statics=layouts.map(l=>({l,s:play(l).delivered,calm:calmOf(l)})).sort((a,b)=>b.s-a.s);
  const sc=statics.map(x=>x.s),q=f=>sc[Math.floor(f*(sc.length-1))];
  // v5.4 moves: one in each break (greedy, round by round), then the extra one as a second move in the best break
  function planner(start){
    const moves=[];let score=play(start).delivered;
    const cellsAt=r=>{const cells=start.slice();for(const m of moves.filter(m=>m.r<=r).sort((a,b)=>a.r-b.r))cells[m.id]=m.to;return cells;};
    for(let r=1;r<R;r++){
      const cells=cellsAt(r);let pick=null;
      for(let id=0;id<3;id++)for(let to=0;to<n;to++){if(cells.includes(to))continue;
        const d=play(start,[...moves,{r,id,to}]).delivered;if(d>score&&(!pick||d>pick.d))pick={d,m:{r,id,to}};}
      if(pick){moves.push(pick.m);score=pick.d;}
    }
    // the extra move(s): during a round only — try 30 / 60 / 90 s into each round
    for(let k=0;k<P.moves;k++){let extra=null;
      for(let r=0;r<R;r++)for(const at of [30,60,90]){const cells=cellsAt(r);
        for(let id=0;id<3;id++)for(let to=0;to<n;to++){if(cells.includes(to))continue;
          const d=play(start,[...moves,{r,at,id,to}]).delivered;if(d>score&&(!extra||d>extra.d))extra={d,m:{r,at,id,to}};}}
      if(extra){moves.push(extra.m);score=extra.d;}}
    return{moves,score};
  }
  let plan={moves:[],score:-1,start:null};
  for(const x of statics.slice(0,process.env.STARTS?+process.env.STARTS:5)){const p=planner(x.l);if(p.score>plan.score)plan={...p,start:x.l};}
  const cellOf=i=>D.candidates[i].join(','),calm=statics.filter(x=>x.calm);
  console.log(JSON.stringify({level:name,total,candidates:n,rounds:R,
    statics:{best:sc[0],bestLayout:statics[0].l.map(cellOf),p90:q(.1),median:q(.5),worst:sc.at(-1),perfect:sc.filter(s=>s===total).length,within5:sc.filter(s=>s>=sc[0]-5).length,of:sc.length},
    calm:{count:calm.length,scores:calm.slice(0,8).map(x=>x.s)},
    planner:{score:plan.score,gain:plan.score-sc[0],opening:plan.start.map(cellOf),moves:plan.moves.map(m=>`r${m.r+1}${m.at!==undefined?'+'+m.at+'s':''}:${'ABC'[m.id]}->${cellOf(m.to)}`)},
    mid:plan.moves.length?play(plan.start,plan.moves,60).delivered:null}));
}
