'use strict';
// Difficulty curve: static score of a few openings (best, runners-up, middling) vs what moves can add.
// Usage: node bots/curve.js            (FEEDER_MAP=grid for the old board)
const path=require('node:path');
const E=require(path.join(__dirname,'..','v2','engine.js'));
const B=require('./lib.js')(E),{D,P}=E;
const name=l=>l.map(i=>D.candidates[i].join(',')).join(' | ');
const ranked=B.layouts.map(l=>({l,d:B.play(l).delivered})).sort((a,b)=>b.d-a.d);
const at=q=>ranked[Math.min(ranked.length-1,Math.floor(q))];
const ge=t=>ranked.filter(r=>r.d>=t).length;
console.log(`map ${D.map} · ${ranked.length} static layouts · top ${ranked.slice(0,8).map(r=>r.d).join(' ')} · median ${at(ranked.length/2).d}`);
console.log(`static ≥ thresholds: ${[P.target,P.highScore,P.masterScore].map(t=>`${t}:${ge(t)}`).join('  ')}`);
const picks=[['best',at(0)],['2nd',at(1)],['5th',at(4)],['10th',at(9)],['20th',at(19)],['top 10%',at(ranked.length*.1)]];
let bestMove=0;
for(const [k,r] of picks){
  const ch=B.chasers([r.l]),gr=B.greedy(r.l);bestMove=Math.max(bestMove,gr.delivered);
  console.log(`${k.padEnd(8)} ${name(r.l).padEnd(22)} static ${r.d}  chaser ${ch[0]?.delivered??'-'}  greedy ${gr.delivered} (${gr.moves.length} moves)`);
}
