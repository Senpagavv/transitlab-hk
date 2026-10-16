'use strict';
// A fresh, time/memory-limited child for every untrusted level.
const fs=require('node:fs'),path=require('node:path');
const {problems,dryRun}=require('./levels.js');
function guard(e){
  const errors=[],obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
  function walk(x,depth=0){
    if(depth>32)throw Error('JSON 超过 32 层');
    if(typeof x==='number'&&!Number.isFinite(x))throw Error('JSON 包含非有限数');
    if(x&&typeof x==='object')for(const [k,v] of Object.entries(x)){if(['__proto__','prototype','constructor'].includes(k))throw Error('JSON 含危险属性 '+k);walk(v,depth+1);}
  }
  try{walk(e);}catch(x){return[x.message];}
  if(!obj(e))return['关卡必须是 JSON 对象'];
  if(!Number.isInteger(e.mode)||![1,2,3,4].includes(e.mode))return['mode 必须是整数 1–4'];
  if(!obj(e.level))return['level 必须是对象'];
  errors.push(...problems(e));
  if(typeof e.key!=='string'||e.key.length>100||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(e.key))errors.push('编号过长、不是字符串或为系统保留名');
  if(e.challenge!==undefined&&typeof e.challenge!=='boolean')errors.push('challenge 必须是布尔值');
  const l=e.level;
  for(const k of ['cols','rows'])if(!Number.isInteger(l[k])||l[k]<1||l[k]>128)errors.push(k+' 必须是 1–128 整数');
  const cell=c=>Array.isArray(c)&&c.length===2&&c.every(Number.isInteger)&&c[0]>=0&&c[1]>=0&&c[0]<l.cols&&c[1]<l.rows;
  const cells=a=>Array.isArray(a)&&a.length<=16384&&a.every(cell);
  if(l.tiers!==undefined&&(!Array.isArray(l.tiers)||l.tiers.length!==3||!l.tiers.every(x=>Number.isFinite(x)&&x>=0)))errors.push('tiers 必须是三个非负有限数');
  if(e.mode===1){
    if(!cell(l.hub)||!cells(l.roads)||!cells(l.candidates)||l.candidates.length<3||l.candidates.length>64)errors.push('第一玩法需要 hub、roads、3–64 个候选站');
    if(!Array.isArray(l.estates)||!l.estates.length||l.estates.length>64||!l.estates.every(o=>obj(o)&&typeof o.name==='string'&&cell(o.cell)))errors.push('estates 无效');
    if(!Array.isArray(l.waves)||!l.waves.length||l.waves.length>32||!l.waves.every(w=>Array.isArray(w)&&w.length===l.estates?.length&&w.every(n=>Number.isInteger(n)&&n>=0))||l.waves.flat().reduce((a,b)=>a+b,0)>10000)errors.push('waves 无效或总出门人数超过 10000');
    if(cells(l.candidates)&&new Set(l.candidates.map(String)).size!==l.candidates.length)errors.push('候选站重复');
    if(cells(l.roads)&&cells(l.candidates)&&cell(l.hub)){
      const roads=new Set(l.roads.map(String)),seen=new Set([String(l.hub)]),queue=[l.hub];
      for(let i=0;i<queue.length;i++){const [x,y]=queue[i];for(const c of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]])if(roads.has(String(c))&&!seen.has(String(c))){seen.add(String(c));queue.push(c);}}
      if(!roads.has(String(l.hub))||[...l.candidates,...(l.estates||[]).map(o=>o.cell)].some(c=>!seen.has(String(c))))errors.push('候选站 / 屋苑没有沿道路接通 hub');
    }
    for(const k of ['firstWave','release','interval','seats','queue','patience','cool','moves','tail'])if(l[k]!==undefined&&(!Number.isFinite(l[k])||l[k]<0||l[k]>10000))errors.push(k+' 数值无效');
    if(l.headway!==undefined&&(!Array.isArray(l.headway)||l.headway.length!==2||!l.headway.every(x=>Number.isFinite(x)&&x>=0)||l.headway[0]<=0))errors.push('headway 无效');
  }else{
    for(const [k,n] of [['origins','people'],['destinations','attraction']]){
      if(!Array.isArray(l[k])||!l[k].length||l[k].length>64||!l[k].every(o=>obj(o)&&typeof o.name==='string'&&cell(o.cell)&&Number.isFinite(o[n])&&o[n]>=0))errors.push(k+' 无效');
    }
    if(!Number.isInteger(l.years)||l.years<1||l.years>32||(e.mode===3&&l.years<=4))errors.push('years 无效（道路玩法至少 5 年，上限 32）');
    for(const k of ['budget','lineCost','stationCost','trainCost','perTrain'])if(!Number.isFinite(l[k])||l[k]<0||l[k]>10000||(k==='trainCost'||k==='perTrain')&&l[k]<=0)errors.push(k+' 数值无效');
    if(e.mode===3&&(!Array.isArray(l.roads)||!l.roads.length||l.roads.length>128||!l.roads.every(r=>obj(r)&&typeof r.name==='string'&&cells(r.via)&&r.via.length>=2&&Number.isFinite(r.cap)&&r.cap>0)))errors.push('roads 无效');
    if(e.mode===3&&(!Number.isFinite(l.phase2Budget)||l.phase2Budget<0||l.phase2Budget>10000))errors.push('phase2Budget 无效');
    if(l.lines!==undefined&&(!Array.isArray(l.lines)||l.lines.length>64||!l.lines.every(r=>obj(r)&&cells(r.via)&&r.via.length>=2&&cells(r.stations)&&Number.isInteger(r.trains)&&r.trains>0)))errors.push('lines 无效');
    if(e.mode===4&&(!Array.isArray(l.land)||l.land.length>256||!l.land.every(r=>obj(r)&&cell(r.cell))))errors.push('land 无效');
  }
  return errors;
}
function run(file,restarts){
  const e=JSON.parse(fs.readFileSync(file,'utf8')),issues=guard(e);if(issues.length)return{ok:false,issues};
  let dry;try{dry=dryRun(e);}catch(x){return{ok:false,issues:['levels.js check: 引擎无法空跑：'+x.message]};}
  try{
    delete e.level.demo;
    // search reads only this already-validated private JSON, never an archive path.
    const result=require('../../bots/v7_intake.js').search(file,{restarts});
    return{ok:true,dry,...result};
  }catch(x){return{ok:false,dry,issues:['完整机器人 / 重放失败：'+x.message]};}
}
module.exports={guard,run};
if(require.main===module){try{process.stdout.write(JSON.stringify(run(path.resolve(process.argv[2]),Number(process.argv[3])||undefined)));}
  catch(e){process.stdout.write(JSON.stringify({ok:false,issues:[e.message]}));process.exitCode=1;}}
