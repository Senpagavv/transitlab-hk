'use strict';
// Retune for a board (default the fan board): headway formula × seats. Reports static best,
// the tide-chasing bot and the greedy bound from the best opening. Usage: node bots/sweep3.js
const fs=require('node:fs'),path=require('node:path');
const E=require(path.join(__dirname,'..','v2','engine.js'));
const B=require('./lib.js')(E),{D,P}=E;
const rows=[],t0=Date.now();
for(const hw of [[60,10],[50,8],[40,8],[60,5],[45,5]])for(const seats of [6,5]){
  [P.headwayBase,P.headwayStep]=hw;P.seats=seats;
  const r=B.core(),g=B.greedy(r.bestStatic.layout),ranked=r.statics.map(s=>s.delivered).sort((a,b)=>b-a);
  const row={map:D.map,hw,seats,top:ranked.slice(0,5),median:r.dist.median,chaser:r.bestChaser?.delivered??0,greedy:g.delivered,moves:g.moves.length,rho:r.legibility.capacity,best:r.bestStatic.layout.map(i=>D.candidates[i].join(',')).join('|')};
  rows.push(row);
  console.log(`${D.map} hw ${hw} seats ${seats} → top ${row.top.join(' ')} med ${row.median} chase ${row.chaser} greedy ${row.greedy} (${row.moves}) ρ ${row.rho} best ${row.best}`);
}
fs.writeFileSync(path.join(__dirname,'reports',`sweep3-${D.map}.json`),JSON.stringify(rows,null,1));
console.log(`done in ${(Date.now()-t0)/1000}s`);
