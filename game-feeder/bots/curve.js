'use strict';
// Difficulty curve check for v2.3: does passing need either the right opening or moves, and does a high
// score need good moves? Tries a few home-wait settings. Usage: node bots/curve.js [homeGrace ...]
const path=require('node:path');
const E=require(path.join(__dirname,'..','v2','engine.js'));
const B=require('./lib.js')(E),{D,P}=E;
const graces=process.argv.slice(2).map(Number);
const name=l=>l.map(i=>D.candidates[i].join(',')).join(' | ');
const idx=c=>D.candidates.findIndex(x=>x.join()===c);
const openings={best:['2,6','6,6','6,2'],nearBest:['2,6','6,6','6,3'],southPair:['2,6','5,6','6,6'],stepIn:['3,6','6,6','6,2'],eastStop:['2,6','6,6','7,6']};
for(const g of graces.length?graces:[P.homeGrace]){
  P.homeGrace=g;
  const statics=B.layouts.map(l=>B.play(l).delivered).sort((a,b)=>b-a);
  console.log(`\nhomeGrace ${g}s · static top ${statics.slice(0,6).join(' ')} · median ${statics[143]}`);
  for(const [k,names] of Object.entries(openings)){
    const l=names.map(idx),st=B.play(l).delivered,ch=B.chasers([l]),gr=B.greedy(l);
    console.log(`${k.padEnd(10)} ${name(l).padEnd(20)} static ${st}  chaser ${ch[0]?.delivered??'-'}  greedy ${gr.delivered} (${gr.moves.length} moves)`);
  }
}
