'use strict';
// AI play-tests for the feeder game. Usage:  node bots/evaluate.js [v2|v1-codex] [--write]
// Answers three questions with numbers:
//   1. Can the result be predicted from what the map shows? (visible-rule estimate vs actual, Spearman ρ)
//   2. Is a pass reachable with an obvious layout?          (novice / reader bots)
//   3. Does a high score need more thought?                 (best static vs tide-chasing moves)
const fs=require('node:fs'),path=require('node:path');
const version=process.argv[2]||'v2',write=process.argv.includes('--write');
const E=require(path.join(__dirname,'..',version,'engine.js'));
const B=require('./lib.js')(E),{D,P}=E;
const t0=Date.now(),r=B.core();
const greedyBest=B.greedy(r.bestStatic.layout),greedyNovice=B.greedy(r.novice.layout);
const chase=r.bestChaser;
const seeds=[1781,42,73,99,2026].map(s=>({seed:s,novice:B.play(r.novice.layout,[],s).delivered,best:B.play(r.bestStatic.layout,[],s).delivered,
  chaser:chase?B.play(chase.layout,chase.moves,s).delivered:null,greedy:B.play(greedyBest.layout,greedyBest.moves,s).delivered}));
const report={version,generated:new Date().toISOString(),
  demand:{total:r.demand,waves:D.waves,peaks:D.peaks||null},
  parameters:{seats:P.seats,queue:P.queue,headway:`${P.headwayBase}+${P.headwayStep}×格`,willing:P.willing||null,target:P.target,highScore:P.highScore,masterScore:P.masterScore,moves:P.moves},
  legibility:r.legibility,statics:{count:r.statics.length,...r.dist,
    reachTarget:r.statics.filter(s=>s.delivered>=P.target).length,reachHigh:r.statics.filter(s=>s.delivered>=P.highScore).length},
  bots:{novice:r.novice,reader:r.reader,bestStatic:r.bestStatic,bestChaser:chase,greedyFromNovice:greedyNovice,greedyFromBest:greedyBest},
  seeds,seconds:(Date.now()-t0)/1000};
if(write){fs.mkdirSync(path.join(__dirname,'reports'),{recursive:true});fs.writeFileSync(path.join(__dirname,'reports',`${version}-${D.map||'grid'}.json`),JSON.stringify(report,null,2));}
const cell=l=>l.map(i=>D.candidates[i].join(',')).join(' | ');
console.log(`${version}  demand ${r.demand}  target ${P.target}  high ${P.highScore}  (${report.seconds}s)`);
console.log(`legibility  coverage ρ=${r.legibility.coverage}  capacity ρ=${r.legibility.capacity}`);
console.log(`static ${r.statics.length}  min ${r.dist.min} p25 ${r.dist.p25} median ${r.dist.median} p75 ${r.dist.p75} p90 ${r.dist.p90} max ${r.dist.max}  ≥target ${report.statics.reachTarget}  ≥high ${report.statics.reachHigh}`);
for(const [k,v] of Object.entries(report.bots))if(v)console.log(`${k.padEnd(17)} ${String(v.delivered).padStart(4)}  cars ${v.cars}  missed ${v.missed}  full ${v.full}  wait ${v.longWait}  layout ${cell(v.layout)}  moves ${JSON.stringify(v.moves.map(m=>[m.time,m.id,m.to]))}`);
console.log('seeds',JSON.stringify(seeds));
