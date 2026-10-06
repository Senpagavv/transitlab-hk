'use strict';
// Tune a v3 site board: for each headway option, rank all static layouts and see what moves add
// (tide-chasing bot from the top openings, greedy search from best / 3rd / 10th opening).
// Usage: FEEDER_MAP=fanling node bots/site_tune.js [v3]
const fs=require('node:fs'),path=require('node:path');
const version=process.argv[2]||'v3';
const E=require(path.join(__dirname,'..',version,'engine.js'));
const B=require('./lib.js')(E),{D,P}=E;
const out=[];
for(const hw of [[60,10],[60,7],[60,5]]){
  [P.headwayBase,P.headwayStep]=hw;
  const ranked=B.layouts.map(l=>({l,d:B.play(l).delivered})).sort((a,b)=>b.d-a.d);
  const tops=[ranked[0],ranked[2],ranked[9]];
  const chase=B.chasers(ranked.slice(0,5).map(r=>r.l));
  const greedy=tops.map(r=>B.greedy(r.l).delivered);
  const row={map:D.map,hw,demand:D.waves.flat().reduce((a,b)=>a+b,0),layouts:ranked.length,top:ranked.slice(0,6).map(r=>r.d),
    median:ranked[Math.floor(ranked.length/2)].d,chaser:chase[0]?.delivered??0,greedy,
    best:ranked[0].l.map(i=>D.candidates[i].join(',')).join('|')};
  out.push(row);
  console.log(`${D.map} hw ${hw} demand ${row.demand} · static top ${row.top.join(' ')} med ${row.median} · chaser ${row.chaser} · greedy(best/3rd/10th) ${greedy.join('/')} · best ${row.best}`);
}
fs.writeFileSync(path.join(__dirname,'reports',`site-tune-${D.map}.json`),JSON.stringify(out,null,1));
