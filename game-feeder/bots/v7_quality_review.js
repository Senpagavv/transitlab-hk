'use strict';
// Longer independent batches of the existing mode 2/3 search, plus strict replay.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {clone,build,replay,record}=require('./v7_quality_lib.js');
const argv=process.argv.slice(2),arg=(k,d)=>argv.includes(k)?argv[argv.indexOf(k)+1]:d;
const file=arg('--level'),seconds=+arg('--seconds',180),out=arg('--out');
const e=JSON.parse(fs.readFileSync(file,'utf8')),mode=e.mode,dir=mode===2?'mode2-metro':'mode3-roads';
if(![2,3].includes(mode))throw Error('Modes 2 and 3 only');
const M=require('../v7/'+dir+'/engine.js');M.D.use(clone(e.level),e.key);M.reset();
const pool=[],start=Date.now();let batches=0,restarts=0,rejected=0;
function add(r){try{const v=replay(M,mode,r);pool.push({r:{...r,score:v.score},s:v.p.total,clean:!v.p.log.some(l=>l.crowdedSections)&&!r.line.some((c,i)=>i&&r.stations.some(s=>M.same(s,c))&&r.stations.some(s=>M.same(s,r.line[i-1])))});}catch(err){rejected++;}}
let old=e.level.demo;if(!old&&e.key.endsWith('-1')){require('../v7/'+dir+'/demo-plans.js');old=globalThis[mode===2?'TL_METRO_DEMO':'TL_ROADS_DEMO'][e.key];}for(const r of Object.values(old||{}))if(r?.line)add(r);
// Include legal simple routes for the same pass/high selection used by task 57.
const poi=[...M.D.origins,...M.D.destinations].map(x=>x.cell);for(let i=0;i<poi.length;i++)for(let j=i+1;j<poi.length;j++)for(const axes of [[0,1],[1,0]]){let c=poi[i].slice();const line=[c];for(const a of axes)while(c[a]!==poi[j][a]){c=c.slice();c[a]+=Math.sign(poi[j][a]-c[a]);line.push(c);}add({line,stations:[poi[i],poi[j]],trains:1,phase2:[]});}
const bot=path.join(__dirname,mode===2?'v7_metro_grow.js':'v7_roads.js');
while(Date.now()-start<seconds*1000||restarts<(mode===2?800:36)){
 const n=mode===2?200:8,seed=mode===2?11+batches*137:71+batches*137;
 let src=fs.readFileSync(bot,'utf8').replace(/let seed=\d+;/,'let seed='+seed+';');
 src+='\nmodule.exports='+(mode===2?'{found}':'{finals,firsts,climb,doFour}')+';';
 const mod={exports:{}},proc={argv:[process.execPath,bot,String(n),JSON.stringify(e.level),'--level',file]},log={log:()=>{}};
 new Function('require','module','exports','__dirname','__filename','process','console',src)(Module.createRequire(bot),mod,mod.exports,__dirname,bot,proc,log);
 M.D.use(clone(e.level),e.key);M.reset();const data=mod.exports;
 for(const f of mode===2?data.found:data.finals)add(record(f.p));
 if(mode===3){const basics=pool.slice().sort((a,b)=>b.s-a.s).slice(0,3);for(const b of basics){const first=data.climb(build(M,b.r),24),last=data.climb(data.doFour(first.p),14,true);add(record(last.p));}}
 batches++;restarts+=n;if(batches%2===0)console.log(JSON.stringify({key:e.key,seconds:(Date.now()-start)/1000,restarts,best:Math.max(...pool.map(x=>x.r.score))}));
}
pool.sort((a,b)=>b.s-a.s);const best=pool[0].r.score,tiers=[.4,.65,.88].map(f=>Math.round(best*f)),demo={tiers,best};
for(const [j,k] of ['pass','high','master'].entries()){
 const above=pool.filter(f=>f.s>=tiers[j]&&(j===2||f.s<tiers[j+1]));let f;
 if(j===2)f=pool[0];else if(mode===2)f=above.filter(x=>x.clean).sort((a,b)=>(a.r.stations.length+a.r.trains)-(b.r.stations.length+b.r.trains)||a.s-b.s)[0]||above.at(-1)||pool.filter(f=>f.s>=tiers[j]).at(-1);
 else f=above.slice().sort((a,b)=>a.s-b.s)[0]||pool.filter(f=>f.s>=tiers[j]).at(-1);
 demo[k]=f.r;
}
const report={key:e.key,mode,seconds:(Date.now()-start)/1000,restarts,batches,candidates:pool.length,rejected,best,tiers,demo,bestPlan:pool[0].r};
if(out)fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log('QUALITY '+JSON.stringify(report));
