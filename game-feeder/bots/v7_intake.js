'use strict';
// Full original search routines, adapted to arbitrary level files. Never --write.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const ROOT=path.resolve(__dirname,'..');
const DIR={1:'mode1-bus',2:'mode2-metro',3:'mode3-roads',4:'mode4-tod'};
const BOT={2:'v7_metro_grow.js',3:'v7_roads.js',4:'v7_tod.js'};
const DEFAULTS={2:400,3:18,4:60},NAMES=['pass','high','master'];
const clone=x=>JSON.parse(JSON.stringify(x));
const engine=mode=>require(path.join(ROOT,'v7',DIR[mode],'engine.js'));
function setup(e){const M=engine(e.mode);M.D.use(clone(e.level),e.key);M.reset();return M;}
function replayBus(M,p){
  const g=new M.Game();for(const [i,c] of p.opening.entries())if(!g.place(i,c))throw Error('非法开局站 '+i);
  if(!g.start())throw Error('开局未完成');
  for(const m of p.moves){
    if(!Number.isInteger(m.r)||m.r<1||m.r>M.D.waves.length)throw Error('非法轮次');
    g.runTo(m.r-1);
    if(m.at!==undefined){const target=g.roundStart[m.r-1]+m.at;if(target<g.t)throw Error('操作时间倒退');g.advance(target-g.t);}
    if(g.round!==m.r-1||!g.place(m.id,m.cell))throw Error('非法挪站 '+JSON.stringify(m));
  }
  g.advance(M.P.duration+1);if(!g.done)throw Error('巴士重放未结束');
  return {score:g.delivered,operations:p.opening.length+p.moves.length,trace:g.commands};
}
function build(M,p){const q=new M.Plan();
  for(const c of p.line)if(!q.extend(c))throw Error('非法线段 '+c);
  for(const c of p.stations)if(!q.toggleStation(c))throw Error('非法车站 '+c);
  for(let i=1;i<p.trains;i++)if(!q.addTrain())throw Error('列车超预算');return q;
}
function replay(M,mode,p){
  if(mode===1)return replayBus(M,p);
  const q=build(M,p);let operations=p.line.length+p.stations.length+Math.max(0,p.trains-1);
  if(mode===3){
    while(q.year<4)if(!q.runYear())throw Error('第一期未推进');
    for(const a of p.phase2||[]){const ok=a.type==='extend'?q.extend(a.cell):a.type==='station'?q.toggleStation(a.cell):a.type==='train'?q.addTrain():false;if(!ok)throw Error('非法第二期操作 '+JSON.stringify(a));operations++;}
    q.continuePhase2();
  }
  while(!q.done){
    if(mode===4)for(const a of (p.actions||[]).filter(a=>a.year===q.year)){if(!q.sellLand(a.cell,a.use))throw Error('非法售地 '+JSON.stringify(a));operations++;}
    if(!q.runYear())throw Error('年份未推进');
  }
  if(!Number.isFinite(q.total))throw Error('重放产生非有限分数');
  return{score:Math.round(q.total),rawScore:q.total,operations,years:q.log.map(l=>({year:l.year,score:l.ledger??l.riders??l.jam}))};
}
function basics(M,mode){
  const ds=M.D.destinations,pairs=M.D.origins.flatMap(o=>ds.map(d=>[o,d]));
  ds.forEach((o,i)=>ds.slice(i+1).forEach(d=>pairs.push([o,d])));const out=[];
  for(const [o,d] of pairs)for(const axes of [[0,1],[1,0]]){
    if(Math.abs(o.cell[0]-d.cell[0])+Math.abs(o.cell[1]-d.cell[1])<2)continue;
    const line=[o.cell.slice()];let c=o.cell.slice();
    for(const a of axes)while(c[a]!==d.cell[a]){c=c.slice();c[a]+=Math.sign(d.cell[a]-c[a]);line.push(c);}
    const record={line,stations:[o.cell,d.cell],trains:1,actions:[],phase2:[]};
    try{
      if(mode===4){const p=build(M,record);record.actions=M.D.land.filter(l=>p.canSell(l.cell)).slice(0,2*M.P.years).map((l,i)=>({cell:l.cell,use:'home',year:Math.floor(i/2)}));}
      const r=replay(M,mode,record);out.push({record,s:r.rawScore??r.score});
    }catch{/* A basic route may cross water or exceed the budget. */}
  }
  return out.sort((a,b)=>b.s-a.s);
}
function searchMode1(e){
  const M=setup(e),C=M.D.candidates,statics=[],pool=[];let simulations=0;
  const score=p=>{simulations++;return replayBus(M,p).score;};
  for(let a=0;a<C.length;a++)for(let b=a+1;b<C.length;b++)for(let c=b+1;c<C.length;c++){
    const record={opening:[C[a],C[b],C[c]],moves:[]};statics.push({record,s:score(record)});
  }
  statics.sort((a,b)=>b.s-a.s);if(!statics.length)throw Error('没有三个合法候选站');pool.push(...statics);
  // Same exhaustive openings and legal-break local search as v7_demo_plans.js,
  // extended to arbitrary keys and extra moves; no built-in MASTER lookup.
  for(const start of statics.slice(0,3)){
    let record=clone(start.record),s=start.s;
    for(let r=2;r<=M.D.waves.length;r++)for(let k=0;k<3;k++){
      let best=null;
      for(let id=0;id<3;id++){
        if(record.moves.some(m=>m.r===r&&m.id===id&&m.at===undefined))continue;
        for(const cell of C){const p={opening:record.opening,moves:[...record.moves,{r,id,cell}]};
          try{const v=score(p);if(v>s&&(!best||v>best.s))best={record:p,s:v};}catch{}}
      }
      if(!best)break;({record,s}=best);pool.push(best);
    }
    // Try every round and stop at two actual in-round times, accepting only
    // moves allowed by Game.place (including its limited extra-move budget).
    for(let k=0;k<M.P.moves;k++){
      let best=null;
      for(let r=1;r<=M.D.waves.length;r++)for(const at of [M.P.release/2,M.P.release*3/4].map(v=>Math.round(v*2)/2))for(let id=0;id<3;id++)for(const cell of C){
        const moves=[...record.moves,{r,at,id,cell}].sort((a,b)=>a.r-b.r||(a.at??-1)-(b.at??-1));
        try{const p={opening:record.opening,moves},v=score(p);if(v>s&&(!best||v>best.s))best={record:p,s:v};}catch{}}
      if(!best)break;({record,s}=best);pool.push(best);
    }
  }
  return finish(e,M,pool,statics,{bot:'v7_bus.js --level → v7_intake.js / mode1 engine',openings:statics.length,simulations,
    simpleDefinition:'三个候选站的全部静态开局，不挪站；报告其中最高分'});
}
function original(file,e,restarts){
  const bot=path.join(__dirname,BOT[e.mode]),suffix={2:'module.exports={found,clean};',3:'module.exports={finals,climb,doFour};',4:'module.exports={results};'}[e.mode];
  const mod={exports:{}},logs=[];
  const proc={argv:[process.execPath,bot,String(restarts),'{}','--level',file]};
  // Only local trusted bot source is evaluated. Level JSON is read as data by --level.
  new Function('require','module','exports','__dirname','__filename','process','console',fs.readFileSync(bot,'utf8')+'\n'+suffix)(
    Module.createRequire(bot),mod,mod.exports,__dirname,bot,proc,{log:(...a)=>{if(logs.length<80)logs.push(a.join(' '));}});
  return{data:mod.exports,logs};
}
function recordRail(p,mode){const a=p.phase1State||p;return{line:clone(a.line),stations:clone(a.stations),trains:a.trains,...(mode===3?{phase2:clone(p.phase2Actions||[])}:{})};}
function finish(e,M,pool,simple,meta){
  pool=pool.filter(x=>Number.isFinite(x.s)).sort((a,b)=>b.s-a.s);if(!pool.length)throw Error('机器人没有找到可合法重放的方案');
  const best=Math.round(pool[0].s),tiers=[.4,.65,.88].map(f=>Math.round(best*f));
  const simpleBest=simple.length?Math.round(simple[0].s):null,demo={tiers,best},replays={};
  for(const [i,name] of NAMES.entries()){
    const inBand=pool.filter(x=>Math.round(x.s)>=tiers[i]&&(i===2||Math.round(x.s)<tiers[i+1]));
    const size=x=>e.mode===1?x.record.moves.length*1000:x.record.line.length+(x.record.stations.length+x.record.trains)*100;
    const chosen=i===2?pool[0]:inBand.sort((a,b)=>size(a)-size(b)||a.s-b.s)[0]||pool.filter(x=>Math.round(x.s)>=tiers[i]).at(-1);
    if(!chosen)throw Error('没有达到 '+name+' 的方案');
    const p={...clone(chosen.record),score:Math.round(chosen.s)},r=replay(M,e.mode,p);
    if(r.score!==p.score||r.score<tiers[i])throw Error(name+' 重放分数或门槛不符');
    demo[name]=p;replays[name]=r;
  }
  return{best,tiers,demo:e.challenge?null:demo,replays:e.challenge?null:replays,bestReplay:replay(M,e.mode,{...pool[0].record}),
    simpleBest,simplePlan:simple[0]?.record??null,...meta};
}
function search(file,options={}){
  const e=JSON.parse(fs.readFileSync(file,'utf8'));if(e.mode===1)return searchMode1(e);
  const n=options.restarts||DEFAULTS[e.mode],{data,logs}=original(file,e,n),M=setup(e),simple=basics(M,e.mode),pool=[...simple];
  if(e.mode===2){for(const f of data.found)pool.push({record:recordRail(f.p,2),s:f.s});}
  if(e.mode===3){
    for(const f of data.finals)pool.push({record:recordRail(f.p,3),s:f.s});
    for(const b of simple.slice(0,3)){
      const f=data.climb(build(M,b.record),24),g=data.climb(data.doFour(f.p),14,true);
      pool.push({record:recordRail(g.p,3),s:g.s});
    }
  }
  if(e.mode===4)for(const r of Object.values(data.results))if(r)pool.push({record:{...recordRail(r.base,4),actions:clone(r.actions||[])},s:r.plan.total});
  return finish(e,M,pool,simple,{bot:BOT[e.mode],restarts:n,logs,
    simpleDefinition:e.mode===4?'最短 L 线、两端站、单列车；按文件顺序每年卖两块住宅':'最短 L 线、两端站、单列车、无第二期'});
}
module.exports={search,searchMode1,replay,setup,DEFAULTS};
if(require.main===module){const a=process.argv.slice(2),i=a.indexOf('--level');if(i<0)throw Error('用法: v7_intake.js --level file.json [--restarts N]');
  console.log(JSON.stringify(search(path.resolve(a[i+1]),{restarts:Number(a[a.indexOf('--restarts')+1])||undefined})));}
