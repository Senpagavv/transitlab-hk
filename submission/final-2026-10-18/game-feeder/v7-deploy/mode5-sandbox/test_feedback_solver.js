'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),E=require('./engine.js'),S=require('./feedback-solver.js');
const base=JSON.parse(fs.readFileSync(__dirname+'/../hk/hk-base.json','utf8')), demand=JSON.parse(fs.readFileSync(__dirname+'/../hk/hk-demand-am.json','utf8'));
const prepared=E.prepare(base,demand),cells=[[100,68],[101,68],[102,68],[103,68],[103,69],[103,70],[103,71]];
const plan={budget:300,lines:[{cells,stations:[{cell:cells[0]},{cell:cells[6]}],trains:1}]};
const baseline=S.step(prepared,E.emptyPlan(),E.createState(prepared,E.emptyPlan()));
assert.equal(baseline.metrics.vehiclesReduced,0);assert.equal(baseline.metrics.personMinutesSaved,0);
let state=E.createState(prepared,plan); const start=performance.now();
for(let n=0;n<30;n++){const previous=state.perceived,r=S.step(prepared,plan,state);state=r.state;
let residual=0;for(let s=0;s<previous.length;s++)residual=Math.max(residual,Math.abs(state.perceived[s]-.7*previous[s]-.3*r.metrics.sectionExtras[s]));
assert.ok(residual<1e-8);
console.log(JSON.stringify({round:state.round,change: r.row.changePct,vehicles:r.row.vehiclesReduced,carShare:r.row.carShare,residual,seconds:(performance.now()-start)/1000}));
}
assert.ok(state.changes.every(v=>v<.005));assert.ok(state.last.vehiclesReduced>0);
const ids=new Set(base.roads.filter(r=>/觀塘道|观塘道|KWUN TONG (BYPASS|ROAD)/i.test([r.name,r.hans,r.en].join(' '))).map(r=>String(r.id)));
let before=0,after=0;prepared.sections.forEach((s,i)=>{if(ids.has(String(base.sections[i].road))){before+=s.load;after+=state.last.sectionLoads[i]}});
assert.ok(after<before);
console.log('PASS experimental implicit solver only: 30 continued rounds, last-five changes <0.5%, learning residual <1e-8; target roads '+before+' -> '+after+'; elapsed '+((performance.now()-start)/1000).toFixed(3)+' s.');
