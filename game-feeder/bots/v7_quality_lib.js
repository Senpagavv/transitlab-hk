'use strict';
// Shared strict replay for task 64. No plan fields are assigned during replay.
const clone=x=>JSON.parse(JSON.stringify(x));
function build(M,r){const p=new M.Plan();for(const c of r.line)if(!p.extend(c))throw Error('Illegal line '+c);for(const c of r.stations)if(!p.toggleStation(c))throw Error('Illegal station '+c);for(let n=1;n<r.trains;n++)if(!p.addTrain())throw Error('Illegal train');return p;}
function replay(M,mode,r){const p=new M.Plan(),steps=[];
 const mark=(op)=>steps.push({op,year:p.year,money:p.money,total:p.total});
 for(const c of r.line){if(!p.extend(c))throw Error('Illegal line '+c);mark('extend '+c);}for(const c of r.stations){if(!p.toggleStation(c))throw Error('Illegal station '+c);mark('station '+c);}for(let n=1;n<r.trains;n++){if(!p.addTrain())throw Error('Illegal train');mark('train');}
 if(mode===3){while(p.year<4){if(!p.runYear())throw Error('Year stalled');mark('year');}for(const a of r.phase2||[]){const ok=a.type==='extend'?p.extend(a.cell):a.type==='station'?p.toggleStation(a.cell):a.type==='train'?p.addTrain():false;if(!ok)throw Error('Illegal phase 2 '+JSON.stringify(a));mark('phase2 '+JSON.stringify(a));}if(!p.continuePhase2())throw Error('Cannot continue phase 2');}
 while(!p.done){for(const a of (r.actions||[]).filter(a=>a.year===p.year)){if(!p.sellLand(a.cell,a.use))throw Error('Illegal sale '+JSON.stringify(a));mark('sale '+JSON.stringify(a));}if(!p.runYear())throw Error('Year stalled');mark('year');}
 if(p.money<0||!Number.isFinite(p.total))throw Error('Invalid final state');return {p,score:Math.round(p.total),steps};
}
const record=(p,actions=[])=>({line:clone(p.phase1State?.line||p.line),stations:clone(p.phase1State?.stations||p.stations),trains:p.phase1State?.trains||p.trains,...(p.phase2Actions?{phase2:clone(p.phase2Actions)}:{}),actions:clone(actions)});
module.exports={clone,build,replay,record};
