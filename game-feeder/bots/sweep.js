'use strict';
// Parameter search for v2: which legible settings give an easy pass and a high score that needs moves?
// Usage: node bots/sweep.js            (writes bots/reports/sweep.json)
const fs=require('node:fs'),path=require('node:path');
const E=require(path.join(__dirname,'..','v2','engine.js'));
const B=require('./lib.js')(E),{D,P}=E;
const peakWaves=D.peaks.map(p=>({origin:p.origin,wave:p.wave}));
function setDemand(base,extra){
  D.base.splice(0,4,...base);D.peaks.forEach(p=>p.extra=extra);
  const waves=Array.from({length:8},(_,w)=>base.map((b,o)=>b+(peakWaves.some(p=>p.origin===o&&p.wave===w)?extra:0)));
  D.waves.splice(0,D.waves.length,...waves);
}
const grid=[];
for(const hw of [[70,12],[40,20],[50,15],[60,10]])for(const seats of [5,6])
  for(const base of [[6,3,3,3],[5,3,3,3],[4,4,4,4],[6,3,3,2]])for(const extra of [10,15])grid.push({hw,seats,base,extra});
const rows=[];const t0=Date.now();
for(const g of grid){
  [P.headwayBase,P.headwayStep]=g.hw;P.seats=g.seats;setDemand(g.base,g.extra);
  const r=B.core();
  const row={...g,demand:r.demand,median:r.dist.median,p90:r.dist.p90,novice:r.novice.delivered,reader:r.reader.delivered,
    best:r.bestStatic.delivered,chaser:r.bestChaser?.delivered??0,rho:r.legibility.capacity,
    bestLayout:r.bestStatic.layout.join('-'),noviceLayout:r.novice.layout.join('-')};
  // Shares of demand so different totals compare fairly.
  const s=x=>+(x/r.demand).toFixed(3);
  Object.assign(row,{sNovice:s(row.novice),sBest:s(row.best),sChaser:s(row.chaser),staticGap:s(row.best-row.novice),dynGap:s(row.chaser-row.best),spread:s(row.best-row.median)});
  rows.push(row);
  console.log(JSON.stringify(g),'→',`med ${row.median} nov ${row.novice} rdr ${row.reader} best ${row.best} chase ${row.chaser} ρ ${row.rho}`);
}
fs.mkdirSync(path.join(__dirname,'reports'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'reports','sweep.json'),JSON.stringify(rows,null,1));
console.log(`done ${rows.length} in ${(Date.now()-t0)/1000}s`);
