'use strict';
// Apply only tiers/demo/road-name fields. Never writes verification/source numbers.
// node bots/v7_quality_apply.js <task-root>
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),task=process.argv[2],read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
if(fs.existsSync(path.join(task,'验证/summary.json')))throw Error('Already applied: preserve the original before/after audit; use a fresh baseline copy to reapply.');
const {clone,replay}=require('./v7_quality_lib.js'),report=[],traces=[];
const modes={2:'mode2-metro',3:'mode3-roads',4:'mode4-tod'};
for(const mode of [2,3,4])for(let n=1;n<=4;n++){
 const key=`m${mode}-${n}`,file=path.join(root,'v7/levels',`m${mode}`,key+'.json'),exists=fs.existsSync(file),original=read(exists?file:path.join(root,'v7/levels/examples',key+'.json'));
 const searchFile=path.join(task,'验证',key+'-search.json');if(!fs.existsSync(searchFile)){console.log(key+' pending');continue;}
 const search=read(searchFile),e=clone(original),M=require('../v7/'+modes[mode]+'/engine.js');
 if(!exists){const builtin=read(path.join(root,'v7/levels/builtin.json')).levels.find(x=>x.mode===mode&&x.key===key);if(builtin)Object.assign(e,clone(builtin));}
 M.D.use(clone(e.level),key);M.reset();
 let oldDemo=e.level.demo;
 if(n===1){require('../v7/'+modes[mode]+'/demo-plans.js');oldDemo=globalThis[{2:'TL_METRO_DEMO',3:'TL_ROADS_DEMO',4:'TL_TOD_DEMO'}[mode]][key];}
 const beforeBest=original.verification?.best||oldDemo?.best;
 const changed=search.best>beforeBest*(mode===4?1.03:1.05),tiers=changed?search.tiers:e.level.tiers;
 let demo=oldDemo,oldScores=null;
 if(!e.challenge)oldScores=Object.fromEntries((mode===4&&oldDemo?.mixed?['shop','home','mixed']:['pass','high','master']).map(k=>[k,oldDemo?.[k]?.score]));
 if(changed){e.level.tiers=tiers;
  if(!e.challenge){if(mode===4){demo={tiers,best:search.best};for(const [k,strategy]of [['pass','shop'],['high','home'],['master','mixed']])demo[k]=clone(search.strategies[strategy]);}
   else demo=clone(search.demo);
   for(const [j,k] of ['pass','high','master'].entries())if(demo[k].score<tiers[j])throw Error(key+' '+k+' below tier');
   if(mode===4&&n===1){fs.writeFileSync(path.join(root,'v7/mode4-tod/demo-plans.js'),'// Task 64: strict replay verified TOD strategies.\n(function(root){root.TL_TOD_DEMO={"m4-1":'+JSON.stringify(demo)+'};})(typeof window!=="undefined"?window:globalThis);\n');}
   else e.level.demo=demo;
  }
 }
 let naming={};if(mode===3&&n>1){const base=read(path.join(root,'v7/hk/hk-base.json'));naming=require('../v7/shared/levelgen/simplify.js').nameRoads(e.level,base);}
 if(changed||Object.keys(naming).length)fs.writeFileSync(file,JSON.stringify(e,null,2)+'\n');
 // Re-select after naming, and replay both best and all retained/updated tutorial plans.
 M.D.use(clone(e.level),key);M.reset();const bestRecord=mode===4?Object.values(search.strategies).sort((a,b)=>b.score-a.score)[0]:search.bestPlan;
 const records={best:bestRecord};if(!e.challenge){if(demo?.mixed){records.pass=demo.shop;records.high=demo.home;records.master=demo.mixed;}else for(const k of ['pass','high','master'])records[k]=demo[k];}
 const scores={};for(const [k,r]of Object.entries(records)){const check=replay(M,mode,r);if(check.score!==r.score)throw Error(key+' '+k+' replay differs '+check.score+' vs '+r.score);scores[k]=check.score;traces.push({key,strategy:k,score:check.score,steps:check.steps});}
 report.push({key,mode,beforeBest,afterBest:search.best,gainPct:100*(search.best/beforeBest-1),seconds:search.seconds,restarts:search.restarts,beforeTiers:original.level.tiers,afterTiers:tiers,changed,oldScores,newScores:e.challenge?null:{pass:scores.pass,high:scores.high,master:scores.master},replay:scores,naming,
  runtimeDemoCaveat:changed&&n===1&&mode===3&&fs.readFileSync(path.join(root,'v7/mode3-roads/demo.js'),'utf8').includes("const plans=()=>(root.TL_ROADS_DEMO||{})[D.map]||D.demo;")?'Existing mode3 demo.js prioritizes TL_ROADS_DEMO over level.demo; reviewer must switch that priority.':null});
}
fs.writeFileSync(path.join(task,'验证/summary.json'),JSON.stringify(report,null,2)+'\n');fs.writeFileSync(path.join(task,'验证/replay-steps.json'),JSON.stringify(traces,null,2)+'\n');console.log(JSON.stringify(report.map(({naming,...r})=>({...r,renamed:Object.keys(naming).length})),null,2));
