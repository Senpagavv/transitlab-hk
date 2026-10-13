'use strict';
// v7 mode 2 (metro) · score lines. Every station set (2–4 stations) with the default trains (2 a week — what a player
// who never touches the trains gets), then the best 40 sets with every rising train plan that spends the whole budget.
//   node bots/v7_metro_tune.js
const M=require('../v7/mode2-metro/engine.js'),{D,P,Game}=M;
function play(stations,trains){const g=new Game();for(const c of stations)g.build(c);(trains||[]).forEach((n,w)=>g.setTrains(n,w));g.start();g.advance(1e6);return g.delivered;}
const L=D.line,sets=[];
for(let a=0;a<L.length;a++)for(let b=a+1;b<L.length;b++){sets.push([L[a],L[b]]);
  for(let c=b+1;c<L.length;c++){sets.push([L[a],L[b],L[c]]);for(let d=c+1;d<L.length;d++)sets.push([L[a],L[b],L[c],L[d]]);}}
const base=sets.map(s=>({s,score:play(s)})).sort((x,y)=>y.score-x.score);
const q=f=>base[Math.floor(f*(base.length-1))].score;
console.log('default trains (2 a week): best',base[0].score,'p90',q(.1),'p75',q(.25),'median',q(.5),'of',base.length,'| total',D.origins.reduce((s,o)=>s+o.people,0)*D.weeks);
// rising plans of D.weeks weeks, 1..5 each, spending the whole budget
const plans=[];(function rec(pre,min,left){if(pre.length===D.weeks){if(left===0)plans.push(pre);return;}for(let k=min;k<=P.trainsMax&&k<=left;k++)rec([...pre,k],k,left-k);})([],P.trainsMin,P.budget);
console.log('rising plans',plans.length,plans.map(p=>p.join('')).join(' '));
let best={score:-1};const rows=[];
for(const x of base.slice(0,40)){let b={score:-1};for(const p of plans){const s=play(x.s,p);if(s>b.score)b={score:s,p};}rows.push({...b,s:x.s,def:x.score});if(b.score>best.score)best={...b,s:x.s};}
rows.sort((a,b)=>b.score-a.score);
for(const r of rows.slice(0,8))console.log(`  [${r.s.map(c=>c.join(',')).join(' ')}] default ${r.def} → best plan ${r.score} (${r.p.join(',')})`);
const flat=play(best.s,[3,3,3,2,2,2]),front=play(best.s,[5,4,2,2,1,1]);
console.log('best stations with front-loaded trains 3,3,3,2,2,2:',flat,'| 5,4,2,2,1,1:',front);
