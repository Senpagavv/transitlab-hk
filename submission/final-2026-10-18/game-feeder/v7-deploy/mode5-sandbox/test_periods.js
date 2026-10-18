'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),E=require('./engine.js');
const base=JSON.parse(fs.readFileSync(__dirname+'/../hk/hk-base.json','utf8')),cells=[[100,68],[101,68],[102,68],[103,68],[103,69],[103,70],[103,71]];
const plan={budget:300,lines:[{cells,stations:[{cell:cells[0]},{cell:cells[6]}],trains:1}]};
for(const period of ['pm','day','holiday']){
 const demand=JSON.parse(fs.readFileSync(__dirname+'/../hk/hk-demand-'+period+'.json','utf8')),p=E.prepare(base,demand);
 const start=performance.now(),result=E.runToStable(p,plan,{maxRounds:30});
 assert.ok(result.stable,period+' urban line must settle in 30 rounds');
 assert.ok(result.rows.slice(-5).every(r=>r.changePct<.005));
 assert.ok(result.metrics.solver.residual<1e-8);
 console.log('PASS full HK '+period+' urban: '+result.rounds+' rounds; '+result.metrics.newLineRiders.toFixed(1)+' new-line riders/h; '+result.metrics.vehiclesReduced.toFixed(1)+' fewer cars; residual '+result.metrics.solver.residual.toExponential(3)+'; elapsed '+((performance.now()-start)/1000).toFixed(3)+' s');
}
