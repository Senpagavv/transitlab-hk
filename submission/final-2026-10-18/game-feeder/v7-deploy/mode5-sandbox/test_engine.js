'use strict';
const assert = require('node:assert/strict');
const roadsData = require('../mode3-roads/data.js');
require('./fallback.js');
const E = require('./engine.js');
const fixture = globalThis.SandboxFallback.make(roadsData);
const base = fixture.base, demand = fixture.demand;
const prepared = E.prepare(base, demand);
const close = (a, b, eps, label) => assert.ok(Math.abs(a - b) < eps, label + ': ' + a + ' vs ' + b);
const baselineShares = base.zones.map((_, zi) => {
  let car = 0, total = 0;
  for (const p of demand.pairs) if (p[0] === zi) { car += p[2]; total += p[2] + p[3]; }
  return total ? car / total : 0;
});

let state = E.createState(prepared, E.emptyPlan()), noBuildMetrics;
let maxDrift = 0;
for (let i = 0; i < 30; i++) {
  const result = E.step(prepared, E.emptyPlan(), state); state = result.state; noBuildMetrics = result.metrics;
  for (const key of ['carPeople', 'ptPeople', 'baseCarPeople', 'basePtPeople', 'congestion', 'baseCongestion']) {
    const baseline = key === 'carPeople' || key === 'baseCarPeople' ? prepared.baseCar
      : key === 'ptPeople' || key === 'basePtPeople' ? prepared.basePt : prepared.baseCongestion;
    const drift = Math.abs(noBuildMetrics[key] - baseline); maxDrift = Math.max(maxDrift, drift); close(noBuildMetrics[key], baseline, 1e-6, 'no-build ' + key);
  }
  for (const key of ['newLineRiders', 'switchedToTransit', 'vehiclesReduced', 'congestionReduced', 'personMinutesSaved']) close(noBuildMetrics[key], 0, 1e-6, 'no-build ' + key);
  noBuildMetrics.sectionLoads.forEach((load, si) => close(load, prepared.sections[si].load, 1e-6, 'no-build section load ' + si));
  noBuildMetrics.sectionExtras.forEach((extra, si) => close(extra, prepared.sections[si].extra0, 1e-6, 'no-build section extra ' + si));
  close(noBuildMetrics.carShare, prepared.baseCar / (prepared.baseCar + prepared.basePt), 1e-6, 'no-build car share');
  noBuildMetrics.zoneCarShare.forEach((share, zi) => close(share, baselineShares[zi], 1e-6, 'no-build zone share ' + zi));
}

const linePlan = {
  budget: 300, costs: { line: 1, station: 3, train: 4 },
  lines: [{ id: 'test-line', cells: [[5,4],[5,5],[4,5],[3,5],[3,6],[3,7],[4,7],[5,7],[6,7]],
    stations: [{cell:[5,4]},{cell:[3,6]},{cell:[6,7]}], trains: 1 }]
};
const check = E.validatePlan(base, linePlan);
assert.equal(check.valid, true, 'urban test line should be valid');
assert.ok(check.transfers.length > 0, 'station within one cell of existing rail should transfer');
const start = performance.now();
const run = E.runToStable(prepared, linePlan, { maxRounds: 30 });
const elapsedMs = performance.now() - start;
assert.equal(run.stable, true, 'urban line should settle');
assert.ok(run.rows.length <= 30, 'urban line should settle within 30 rounds');
assert.ok(run.rows.slice(-5).every(r => r.changePct < 0.005), 'last five rounds should move less than 0.5%');
const kaiTak = base.zones.findIndex(z => z.id === 'o0');
const ngauTauKok = base.zones.findIndex(z => z.id === 'o1');
assert.ok(run.metrics.zoneCarShare[ngauTauKok] < baselineShares[ngauTauKok], 'Kwun Tong-area car share should fall');
const settledShares = run.rows.slice(-5).map(row => row.carShare);
const settledRange = Math.max(...settledShares) - Math.min(...settledShares);
assert.ok(settledRange / Math.max(1e-9, settledShares[settledShares.length - 1]) < 0.005,
  'settled car share should not keep bouncing across a 0.5% range');
const noService = JSON.parse(JSON.stringify(linePlan)); noService.lines[0].trains = 0;
const noServiceRun = E.runToStable(prepared, noService, { maxRounds: 30 });
close(noServiceRun.metrics.newLineRiders, 0, 1e-6, 'a line without trains must have no riders');
close(noServiceRun.metrics.vehiclesReduced, 0, 1e-6, 'a line without trains must have no mode-choice effect');
assert.ok(run.metrics.zoneCarShare[kaiTak] < baselineShares[kaiTak], 'Kai Tak car share should fall after a nearby line');
assert.ok(run.metrics.vehiclesReduced > 0, 'urban line should remove vehicles');
const namedRoads = new Map((base.roads || []).map(r => [String(r.id), r.name]));
const roadDeltas = new Map();
(base.sections || []).forEach((s, i) => {
  const name = namedRoads.get(String(s.road));
  if (!roadDeltas.has(name)) roadDeltas.set(name, { before: 0, after: 0 });
  roadDeltas.get(name).before += s.am.load;
  roadDeltas.get(name).after += run.metrics.sectionLoads[i];
});
const targetRoads = ['觀塘繞道', '觀塘道'];
assert.ok(targetRoads.some(name => roadDeltas.has(name) && roadDeltas.get(name).after < roadDeltas.get(name).before),
  'Kwun Tong Bypass or Kwun Tong Road load should fall');

const budgetPlan = JSON.parse(JSON.stringify(linePlan)); budgetPlan.budget = 20;
assert.equal(E.validatePlan(base, budgetPlan).valid, false, 'budget limit should be enforced');
assert.equal(E.emptyPlan({ budget: 0 }).budget, 0, 'zero budget should stay zero');
assert.equal(E.planCost({ ...linePlan, budget: 0 }).budget, 0, 'zero budget must not use the default');
const transferPlan = { budget: 30, lines: [{ cells:[[4,0],[4,1],[4,2]], stations:[{cell:[4,1]}], trains:1 }] };
assert.ok(E.validatePlan(base, transferPlan).transfers.some(x => x.distance === 1), 'one-cell transfer should be recognized');
const noTransferPlan = { budget: 30, lines: [{ cells:[[0,0],[1,0],[2,0]], stations:[{cell:[0,0]}], trains:1 }] };
assert.equal(E.validatePlan(base, noTransferPlan).transfers.length, 0, 'far station should not count as a transfer');

const remotePlan = { budget: 50, lines: [{ cells:[[10,0],[11,0],[12,0],[13,0]], stations:[{cell:[10,0]},{cell:[13,0]}], trains:1 }] };
assert.equal(E.validatePlan(base, remotePlan).valid, true, 'remote park line should be valid');
const remote = E.runToStable(prepared, remotePlan, { maxRounds: 30 });
close(remote.metrics.vehiclesReduced, 0, 1e-6, 'unpopulated remote line vehicle effect');
close(remote.metrics.congestionReduced, 0, 1e-6, 'unpopulated remote line congestion effect');

const isolatedBase = Object.assign({}, base, { lines: [], stations: [] });
const longDemand = JSON.parse(JSON.stringify(demand));
longDemand.pairs[11][5] = 150;
const isolatedPrepared = E.prepare(isolatedBase, longDemand);
const makeLongLine = startY => {
  const cells = [[13,startY]]; let x = 13, y = startY; const path = [[x,y]];
  while (y < 6) { y++; path.push([x,y]); }
  while (x > 3) { x--; path.push([x,y]); }
  return { budget: 60, lines: [{ cells:path, stations:[{cell:[13,startY]},{cell:[3,6]}], trains:1 }] };
};
const withinSix = E.transitBenefits(isolatedPrepared, makeLongLine(1));
const beyondSix = E.transitBenefits(isolatedPrepared, makeLongLine(0));
assert.ok(withinSix[11].d > 0, 'zone six cells from a station should be able to walk to it');
close(beyondSix[11].d, 0, 1e-6, 'zone seven cells from a station should be outside the walk limit');

const barrierLand = Array.from(isolatedBase.land); barrierLand[4 * base.cols + 13] = '~';
const barrierBase = { ...isolatedBase, land: barrierLand.join('') };
const barrierCells = [[13,1],[12,1]];
for (let y = 2; y <= 6; y++) barrierCells.push([12,y]);
for (let x = 11; x >= 3; x--) barrierCells.push([x,6]);
const barrierPlan = { budget: 60, lines: [{ cells: barrierCells, stations: [{cell:[13,1]},{cell:[3,6]}], trains:1 }] };
assert.equal(E.validatePlan(barrierBase, barrierPlan).valid, true, 'barrier line should remain on land');
close(E.transitBenefits(E.prepare(barrierBase, longDemand), barrierPlan)[11].d, 0, 1e-6,
  'six-cell walk limit must include the detour around water');


// Null minutes stay unknown; complete-time savings must not turn them into zero-minute trips.
const missingMinuteDemand = JSON.parse(JSON.stringify(demand));
missingMinuteDemand.pairs[0][4] = null;
const missingMinutePrepared = E.prepare(base, missingMinuteDemand);
assert.equal(missingMinutePrepared.pairs[0].carMin, null, 'unknown minutes must remain null');
const missingMinuteRound = E.step(missingMinutePrepared, E.emptyPlan(), E.createState(missingMinutePrepared, E.emptyPlan()));
close(missingMinuteRound.metrics.personMinutesSaved, 0, 1e-6, 'no-build savings with unknown minutes');
assert.ok(missingMinuteRound.metrics.personMinutesCoverage < 1, 'unknown travel times must lower savings coverage');

// Old branch station lists contain repeated interchange IDs and must keep their supplied order.
const branchBase = { cols:4, rows:3, land:'.'.repeat(12), stations:[
  {id:'a',cell:[0,0]}, {id:'b',cell:[1,0]}, {id:'c',cell:[2,0]}, {id:'d',cell:[1,1]}
], lines:[{stations:['a','b','c','b','d'],cells:[[0,0],[1,0],[2,0],[1,0],[1,1]],trains_per_hour:1}] };
const branchMetro = E.buildMetro(branchBase,{lines:[]});
const branchA = branchMetro.nodes.findIndex(s=>s.id==='a'), branchB = branchMetro.nodes.findIndex(s=>s.id==='b');
close(branchMetro.dist[branchA][branchB], 2, 1e-6, 'branch must preserve the direct a-b station segment');

console.log('Urban line rounds: round | car share | new-line riders | vehicles reduced | congestion reduced | car change');
for (const row of run.rows) console.log([row.round, (row.carShare * 100).toFixed(2) + '%', row.newLineRiders.toFixed(1), row.vehiclesReduced.toFixed(1), row.congestionReduced.toFixed(1), (row.changePct * 100).toFixed(3) + '%'].join(' | '));
console.log('PASS no-build 30 rounds; max baseline drift < ' + maxDrift.toExponential(2));
console.log('PASS urban line stable in ' + run.rows.length + ' rounds; Kai Tak car share ' + (baselineShares[kaiTak] * 100).toFixed(1) + '% → ' + (run.metrics.zoneCarShare[kaiTak] * 100).toFixed(1) + '%');
console.log('PASS road direction; ' + targetRoads.filter(n => roadDeltas.get(n) && roadDeltas.get(n).after < roadDeltas.get(n).before).join(' / ') + ' load decreased');
console.log('PASS budget, one-cell transfer, six-cell walking limit, and remote park line');
console.log('Fixture simulate-to-stable elapsed ' + elapsedMs.toFixed(1) + ' ms (' + run.rows.length + ' rounds; D-tier fixture only)');

const fs = require('node:fs'), path = require('node:path');
const realBaseFile = path.join(__dirname, '..', 'hk', 'hk-base.json');
if (fs.existsSync(realBaseFile) && !process.argv.includes('--fixture-only')) {
  const realBase = JSON.parse(fs.readFileSync(realBaseFile, 'utf8'));
  const realPeriodFiles = ['am','pm','day','holiday'].filter(p => fs.existsSync(path.join(__dirname,'..','hk','hk-demand-'+p+'.json')));
  let amPrepared = null, amDemand = null;
  for (const period of realPeriodFiles) {
    const realDemand = JSON.parse(fs.readFileSync(path.join(__dirname,'..','hk','hk-demand-'+period+'.json'), 'utf8'));
    const prepareStart = performance.now(), real = E.prepare(realBase, realDemand), prepareMs = performance.now() - prepareStart;
    const carByZone = new Float64Array(realBase.zones.length), totalByZone = new Float64Array(realBase.zones.length);
    for (const pair of real.pairs) { carByZone[pair.i] += pair.car0; totalByZone[pair.i] += pair.car0 + pair.pt0; }
    let state = E.createState(real, E.emptyPlan()), drift = 0;
    const stepStart = performance.now();
    for (let round = 0; round < 30; round++) {
      const r = E.step(real, E.emptyPlan(), state); state = r.state;
      for (const [value,baseline] of [[r.metrics.carPeople,real.baseCar],[r.metrics.ptPeople,real.basePt],[r.metrics.congestion,real.baseCongestion],[r.metrics.personMinutesSaved,0],[r.metrics.newLineRiders,0],[r.metrics.vehiclesReduced,0]]) {
        drift = Math.max(drift, Math.abs(value-baseline)); close(value,baseline,1e-6,'real '+period+' baseline');
      }
      r.metrics.sectionLoads.forEach((load,i)=>close(load,real.sections[i].load,1e-6,'real '+period+' road load '+i));
      r.metrics.sectionExtras.forEach((extra,i)=>close(extra,real.sections[i].extra0,1e-6,'real '+period+' road extra '+i));
      r.metrics.zoneCarShare.forEach((share,i)=>close(share,totalByZone[i]?carByZone[i]/totalByZone[i]:0,1e-6,'real '+period+' zone share '+i));
    }
    const stepMs = (performance.now() - stepStart)/30;
    console.log('PASS full HK '+period+': '+real.pairs.length+' OD pairs, 30 no-build rounds, drift '+drift.toExponential(2)+'; prepare '+prepareMs.toFixed(1)+' ms; mean step + checks '+stepMs.toFixed(1)+' ms; minute coverage '+(100*real.peopleWithMinutes/(real.baseCar+real.basePt)).toFixed(2)+'%');
    if (period === 'am') { amPrepared = real; amDemand = realDemand; }
  }
  assert.ok(amPrepared,'AM demand is required for the real scenario');
  const from = realBase.stations.find(s=>s.id==='osm:MTR-KOB'), to = realBase.stations.find(s=>s.id==='osm:MTR-KWT');
  assert.ok(from && to,'Kwun Tong and Kowloon Bay stations must be present');
  const landPath = (a,b) => {
    const key = c=>c.join(','), target=key(b), queue=[a], previous=new Map([[key(a),null]]);
    for (let head=0;head<queue.length;head++) {
      const c=queue[head];
      if (key(c)===target) { const cells=[];let k=target;while(k!==null){cells.push(k.split(',').map(Number));k=previous.get(k);}return cells.reverse(); }
      for(const n of [[c[0]+1,c[1]],[c[0],c[1]+1],[c[0]-1,c[1]],[c[0],c[1]-1]]) {
        if(n[0]<0||n[1]<0||n[0]>=realBase.cols||n[1]>=realBase.rows||'~w'.includes(realBase.land[n[1]*realBase.cols+n[0]]))continue;
        const k=key(n);if(!previous.has(k)){previous.set(k,key(c));queue.push(n);}
      }
    }
    throw Error('no land path between example stations');
  };
  const realPlan = { budget:300, lines:[{id:'kowloon-east-express',cells:landPath(from.cell,to.cell),stations:[{cell:from.cell},{cell:to.cell}],trains:1}] };
  assert.equal(E.validatePlan(realBase,realPlan).valid,true,'real line must be valid');
  const realRun = E.runToStable(amPrepared,realPlan,{maxRounds:30});
  console.log('Full HK AM urban rounds: round | car share | new-line riders | fewer cars | congestion reduced | car change');
  for(const row of realRun.rows)console.log([row.round,(row.carShare*100).toFixed(3)+'%',row.newLineRiders.toFixed(1),row.vehiclesReduced.toFixed(1),row.congestionReduced.toFixed(1),(row.changePct*100).toFixed(3)+'%'].join(' | '));
  const convergencePass = realRun.stable && realRun.rows.slice(-5).every(r=>r.changePct<.005);
  console.log((convergencePass?'PASS':'FAIL')+' full HK urban convergence within 30 rounds');
  const directionMetrics = realRun.metrics;
  const kwunTong = realBase.zones.map((z,i)=>({z,i})).filter(({z})=>/觀塘|观塘/.test(z.district));
  let car0=0,carNow=0,total=0;
  for(const pair of amPrepared.pairs)if(kwunTong.some(z=>z.i===pair.i)){car0+=pair.car0;total+=pair.car0+pair.pt0;carNow+=(pair.car0+pair.pt0)*directionMetrics.zoneCarShare[pair.i];}
  assert.ok(carNow < car0,'Kwun Tong district car share must decrease');
  const targetRoadIds = new Set(realBase.roads.filter(r=>/觀塘道|观塘道|KWUN TONG (BYPASS|ROAD)/i.test([r.name,r.hans,r.en].join(' '))).map(r=>String(r.id)));
  let roadBefore=0,roadAfter=0;
  realBase.sections.forEach((s,i)=>{if(targetRoadIds.has(String(s.road))){roadBefore+=amPrepared.sections[i].load;roadAfter+=directionMetrics.sectionLoads[i];}});
  assert.ok(roadAfter < roadBefore,'Kwun Tong Road / Bypass total section loads must fall');
  console.log('PASS full HK stable direction ('+realRun.rounds+' rounds); Kwun Tong car share '+(100*car0/total).toFixed(3)+'% → '+(100*carNow/total).toFixed(3)+'%; target-road summed section load '+roadBefore.toFixed(1)+' → '+roadAfter.toFixed(1));
  let ruralCells = null;
  for(let y=0;y<realBase.rows&&!ruralCells;y++)for(let x=0;x<realBase.cols-3&&!ruralCells;x++){
    const cells=[[x,y],[x+1,y],[x+2,y],[x+3,y]];
    if(cells.some(c=>realBase.land[c[1]*realBase.cols+c[0]]!=='^'))continue;
    if(cells.some(c=>realBase.zones.some(z=>Math.abs(z.cell[0]-c[0])+Math.abs(z.cell[1]-c[1])<=6)))continue;
    ruralCells=cells;
  }
  assert.ok(ruralCells,'an unused rural area should be present');
  const ruralPlan={budget:50,lines:[{cells:ruralCells,stations:[{cell:ruralCells[0]},{cell:ruralCells[3]}],trains:1}]};
  assert.equal(E.validatePlan(realBase,ruralPlan).valid,true);
  const ruralRun=E.runToStable(amPrepared,ruralPlan,{maxRounds:30});
  close(ruralRun.metrics.vehiclesReduced,0,1e-6,'full HK unpopulated rural line');
  close(ruralRun.metrics.congestionReduced,0,1e-6,'full HK rural congestion effect');
  console.log('PASS full HK unused rural line '+JSON.stringify(ruralCells)+'; no vehicle or congestion change');
  assert.ok(convergencePass,'full HK urban line must settle within 30 rounds; other checks completed before this assertion');
  console.log('PASS real JSON interface: '+realBase.cols+'×'+realBase.rows+', '+realBase.zones.length+' zones, '+realBase.stations.length+' stations, '+realBase.sections.length+' road sections, '+realBase.areas.length+' areas');
}
