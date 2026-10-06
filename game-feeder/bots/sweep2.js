'use strict';
// v2.2 retune after the realism fixes (MTR rule, switch on the spot). Includes the greedy upper bound.
// Usage: node bots/sweep2.js   (writes bots/reports/sweep2.json)
const fs=require('node:fs'),path=require('node:path');
const E=require(path.join(__dirname,'..','v2','engine.js'));
const B=require('./lib.js')(E),{D,P}=E;
const peakAt=D.peaks.map(p=>({origin:p.origin,wave:p.wave}));
function setDemand(base,extra){
  D.base.splice(0,4,...base);D.peaks.forEach(p=>p.extra=extra);
  D.waves.splice(0,D.waves.length,...Array.from({length:8},(_,w)=>base.map((b,o)=>b+(peakAt.some(p=>p.origin===o&&p.wave===w)?extra:0))));
}
const rows=[],t0=Date.now();
for(const hw of [[60,10],[50,15]])for(const seats of [5,6])for(const extra of [15,18,21]){
  [P.headwayBase,P.headwayStep]=hw;P.seats=seats;setDemand([6,3,3,3],extra);
  const r=B.core(),g=B.greedy(r.bestStatic.layout);
  const row={hw,seats,extra,demand:r.demand,median:r.dist.median,p90:r.dist.p90,novice:r.novice.delivered,best:r.bestStatic.delivered,
    chaser:r.bestChaser?.delivered??0,greedy:g.delivered,rho:r.legibility.capacity,bestLayout:r.bestStatic.layout.join('-'),chase:r.bestChaser&&{float:r.bestChaser.floatId,lead:r.bestChaser.lead,back:r.bestChaser.back}};
  rows.push(row);console.log(JSON.stringify({hw,seats,extra}),'→',`demand ${row.demand} med ${row.median} p90 ${row.p90} nov ${row.novice} best ${row.best} chase ${row.chaser} greedy ${row.greedy} ρ ${row.rho}`);
}
fs.writeFileSync(path.join(__dirname,'reports','sweep2.json'),JSON.stringify(rows,null,1));
console.log(`done in ${(Date.now()-t0)/1000}s`);
