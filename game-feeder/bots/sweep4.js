'use strict';
// Pressure sweep for a board: headway × seats × peak size. Usage: FEEDER_MAP=arc node bots/sweep4.js
const fs=require('node:fs'),path=require('node:path');
const E=require(path.join(__dirname,'..','v2','engine.js'));
const B=require('./lib.js')(E),{D,P}=E;
const peakAt=D.peaks.map(p=>({origin:p.origin,wave:p.wave}));
function setPeak(extra){D.peaks.forEach(p=>p.extra=extra);
  D.waves.splice(0,D.waves.length,...Array.from({length:8},(_,w)=>D.base.map((b,o)=>b+(peakAt.some(p=>p.origin===o&&p.wave===w)?extra:0))));}
const grid=[[[60,10],6,24],[[60,10],5,18],[[60,10],5,24],[[60,6],6,24],[[60,6],5,18],[[60,6],5,24]];
const rows=[],t0=Date.now();
for(const [hw,seats,extra] of grid){
  [P.headwayBase,P.headwayStep]=hw;P.seats=seats;setPeak(extra);
  const r=B.core(),g=B.greedy(r.bestStatic.layout),ranked=r.statics.map(s=>s.delivered).sort((a,b)=>b-a);
  const row={map:D.map,hw,seats,extra,demand:r.demand,top:ranked.slice(0,5),median:r.dist.median,chaser:r.bestChaser?.delivered??0,greedy:g.delivered,rho:r.legibility.capacity,best:r.bestStatic.layout.map(i=>D.candidates[i].join(',')).join('|')};
  rows.push(row);
  console.log(`${D.map} hw ${hw} seats ${seats} peak +${extra} (demand ${row.demand}) → top ${row.top.join(' ')} med ${row.median} chase ${row.chaser} greedy ${row.greedy} ρ ${row.rho} best ${row.best}`);
}
fs.writeFileSync(path.join(__dirname,'reports',`sweep4-${D.map}.json`),JSON.stringify(rows,null,1));
console.log(`done in ${(Date.now()-t0)/1000}s`);
