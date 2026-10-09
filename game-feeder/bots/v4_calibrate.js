'use strict';
// v4 tier calibration: how high can a player who moves only in the countdowns get (beam search, full knowledge
// of the tide table), and how many openings clear a given score without moving.
//   node bots/v4_calibrate.js l1        or   node bots/v4_calibrate.js drafts.js
const path=require('node:path');
const E=require('../v4/engine.js'),{D,P}=E,bots=require('./lib.js');
const arg=process.argv[2]||'l1',width=+(process.env.BEAM||5);
const defs=arg.endsWith('.js')?require(path.resolve(arg)):{[arg]:null};
for(const [name,def] of Object.entries(defs)){
  if(def)D.use(def,name);else if(!D.select(name))throw Error('no level '+name);
  E.reset();
  const B=bots(E),n=D.candidates.length,cell=i=>D.candidates[i].join(',');
  const statics=B.layouts.map(l=>({l,s:B.play(l).delivered})).sort((a,b)=>b.s-a.s);
  const top=statics[0].s,count=x=>statics.filter(s=>s.s>=x).length;
  // beam over countdown moves (3 s before rounds 2..n), from the best few openings
  let beam=statics.slice(0,3).map(x=>({start:x.l,cells:x.l.slice(),moves:[],score:x.s}));
  for(let w=1;w<D.waves.length;w++){
    const time=P.firstWave+w*P.interval-3,next=[...beam];
    for(const b of beam){if(b.moves.length>=P.moves)continue;
      for(let id=0;id<3;id++)for(let to=0;to<n;to++){if(b.cells.includes(to))continue;
        const moves=[...b.moves,{time,id,to}],cells=b.cells.slice();cells[id]=to;
        next.push({start:b.start,cells,moves,score:B.play(b.start,moves).delivered});}}
    const seen=new Set();beam=next.sort((a,b)=>b.score-a.score).filter(b=>{const k=b.start+'|'+JSON.stringify(b.moves);return seen.has(k)?false:seen.add(k);}).slice(0,width);
  }
  const best=beam[0];
  console.log(JSON.stringify({level:name,total:D.waves.flat().reduce((a,b)=>a+b,0),staticBest:top,
    staticsAtOrAbove:Object.fromEntries([0,1,2,3,4,6].map(k=>[top-k,count(top-k)])),of:statics.length,
    beamBest:best.score,opening:best.start.map(cell),moves:best.moves.map(m=>`r${Math.round((m.time+3-P.firstWave)/P.interval)+1}:${'ABC'[m.id]}->${cell(m.to)}`),
    beamTop:beam.map(b=>b.score)}));
}
