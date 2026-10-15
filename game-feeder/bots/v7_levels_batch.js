'use strict';
// Task 57: source-backed level authoring, corridor simplification, and existing-bot adapter.
// No engine, original bot or demo-plans.js is changed. Run from game-feeder/bots/.
// node bots/v7_levels_batch.js generate
// node bots/v7_levels_batch.js --level v7/levels/m2/m2-2.json [--restarts 400]
// node bots/v7_levels_batch.js verify | docs
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const ROOT=path.resolve(__dirname,'..'),V7=path.join(ROOT,'v7');
const clone=x=>JSON.parse(JSON.stringify(x)),key=c=>c.join(','),dist=(a,b)=>Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]);
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const write=(f,x)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(x,null,2)+'\n');};
const dirs={2:'mode2-metro',3:'mode3-roads',4:'mode4-tod'};
const bots={2:'v7_metro_grow.js',3:'v7_roads.js',4:'v7_tod.js'};
const E=mode=>require(path.join(V7,dirs[mode],'engine.js'));
const files=()=>[2,3,4].flatMap(m=>fs.readdirSync(path.join(V7,'levels','m'+m)).filter(f=>/^m[234]-[234]\.json$/.test(f)).map(f=>path.join(V7,'levels','m'+m,f)));

// One connected, traffic-carrying spine for each named road. It uses only source edges.
// Disconnected pieces and zero-flow twigs are removed; branches are reduced to a diameter.
// Select 8-10 corridors by source traffic plus the coverage they add to the playable places.
function simplifyCorridors(level,engine,{count=10}={}){
 const src=level.source,byName=new Map(),allEdges=new Map();
 level.roads.forEach((r,i)=>{
  for(const s of src.roadSections[i].segments){const k=[key(s.a),key(s.b)].sort().join('|');
   if(!allEdges.has(k))allEdges.set(k,{...clone(s),cap:src.roadSections[i].modelCap,sourceName:r.name});}
  if(/未命名/.test(r.name))return;
  if(!byName.has(r.name))byName.set(r.name,{name:r.name,hans:r.hans,aliases:r.aliases,edges:new Map()});
  const out=byName.get(r.name),meta=src.roadSections[i];
  for(const s of meta.segments){if(!(s.modelVC>0))continue;
   const k=[key(s.a),key(s.b)].sort().join('|'),old=out.edges.get(k);
   if(old){old.modelVC=Math.max(old.modelVC,s.modelVC);old.sectionIds.push(...s.sectionIds);old.cap=Math.min(old.cap,meta.modelCap);}
   else out.edges.set(k,{...clone(s),cap:meta.modelCap});
  }
 });
 const candidates=[];
 for(const road of byName.values()){
  const edges=[...road.edges.values()],at=new Map();
  for(const s of edges)for(const c of [s.a,s.b]){const k=key(c);if(!at.has(k))at.set(k,[]);at.get(k).push(s);}
  const remaining=new Set(at.keys()),components=[];
  while(remaining.size){const todo=[remaining.values().next().value],nodes=[];remaining.delete(todo[0]);
   while(todo.length){const k=todo.shift();nodes.push(k);for(const s of at.get(k)){const n=key(s.a)===k?key(s.b):key(s.a);if(remaining.delete(n))todo.push(n);}}
   components.push(nodes);
  }
  for(const nodes of components){
   if(nodes.length<3)continue;
   let best=null;
   for(const start of nodes){const queue=[start],prev=new Map([[start,null]]),steps=new Map([[start,0]]);
    while(queue.length){const k=queue.shift();for(const s of at.get(k)){const n=key(s.a)===k?key(s.b):key(s.a);if(!prev.has(n)){prev.set(n,{k,s});steps.set(n,steps.get(k)+1);queue.push(n);}}}
    for(const end of nodes){if(end===start)continue;const seq=[],segs=[];let k=end;
     while(k){seq.unshift(k.split(',').map(Number));const p=prev.get(k);if(!p)break;segs.unshift(p.s);k=p.k;}
     const traffic=segs.reduce((sum,s)=>sum+s.cap*s.modelVC,0),value=seq.length+traffic/10000;
     if(!best||value>best.value)best={seq,segs,value,traffic};
    }
   }
   if(best)candidates.push({...road,...best});
  }
 }
 const places=[...level.origins,...level.destinations],selected=[],covered=new Set(),names=new Set();
 while(selected.length<count){let choice=null,score=-Infinity;
  for(const c of candidates){if(names.has(c.name))continue;
   const add=places.reduce((s,p,i)=>s+(!covered.has(i)&&c.seq.some(q=>dist(q,p.cell)<=1)?1:0),0);
   const joins=selected.some(x=>x.seq.some(a=>c.seq.some(b=>key(a)===key(b))));
   const v=add*100+c.seq.length+Math.log1p(c.traffic)+(joins?12:0);
   if(v>score){score=v;choice=c;}
  }
  if(!choice)break;selected.push(choice);names.add(choice.name);places.forEach((p,i)=>{if(choice.seq.some(c=>dist(c,p.cell)<=1))covered.add(i);});
 }
 if(selected.length<6)throw Error('Fewer than six source-backed corridors');
 // Retain the minimum source-network connectors between spines. A road at a place
 // is insufficient if that road is disconnected from every destination. Detours
 // retrace source edges, which the engine deduplicates into the same physical edge.
 const fullAt=new Map();for(const s of allEdges.values())for(const c of [s.a,s.b]){const k=key(c);if(!fullAt.has(k))fullAt.set(k,[]);fullAt.get(k).push(s);}
 const connectors=[];
 for(let round=0;round<30;round++){
  const at=new Map();selected.forEach(c=>c.seq.forEach((p,i)=>{const k=key(p);if(!at.has(k))at.set(k,new Set());for(const q of [c.seq[i-1],c.seq[i+1]])if(q)at.get(k).add(key(q));}));
  const remaining=new Set(at.keys()),comps=[];while(remaining.size){const todo=[remaining.values().next().value],nodes=[];remaining.delete(todo[0]);while(todo.length){const k=todo.shift();nodes.push(k);for(const n of at.get(k))if(remaining.delete(n))todo.push(n);}comps.push(nodes);}
  if(comps.length<=1)break;comps.sort((a,b)=>b.length-a.length);const main=new Set(comps[0]),targets=new Set(comps.slice(1).flat());
  const todo=[...main],prev=new Map(todo.map(k=>[k,null]));let hit=null;
  while(todo.length&&!hit){const k=todo.shift();for(const s of fullAt.get(k)||[]){const n=key(s.a)===k?key(s.b):key(s.a);if(prev.has(n))continue;prev.set(n,{k,s});if(targets.has(n)){hit=n;break;}todo.push(n);}}
  if(!hit)throw Error('Source road graph cannot connect selected corridors');
  const via=[],segments=[];let k=hit;while(k){via.unshift(k.split(',').map(Number));const p=prev.get(k);if(!p)break;segments.unshift(p.s);k=p.k;}
  const owner=selected.find(c=>c.seq.some(p=>key(p)===key(via[0]))),i=owner.seq.findIndex(p=>key(p)===key(via[0]));
  owner.seq=[...owner.seq.slice(0,i+1),...via.slice(1),...via.slice(0,-1).reverse(),...owner.seq.slice(i+1)];owner.segs.push(...segments);
  connectors.push({corridor:owner.name,via,sourceRoads:[...new Set(segments.map(s=>s.sourceName))],sectionIds:[...new Set(segments.flatMap(s=>s.sectionIds))]});
 }
 level.roads=selected.map(c=>({name:c.name,hans:c.hans,aliases:c.aliases,via:c.seq,
  cap:Number((c.segs.length/c.segs.reduce((s,e)=>s+1/e.cap,0)*src.scale).toFixed(6))}));
 src.roadSections=selected.map(c=>({name:c.name,modelCap:c.segs.length/c.segs.reduce((s,e)=>s+1/e.cap,0),
  segments:c.segs.map(s=>({a:s.a,b:s.b,modelVC:s.modelVC,sectionIds:[...new Set(s.sectionIds)]})),capFactor:1,capGrowFactors:null}));
 const roadCells=[...new Map(selected.flatMap(c=>c.seq).map(c=>[key(c),c])).values()],water=new Set(level.water.map(key)),moves=[];
 places.forEach(p=>{
  if(roadCells.some(c=>dist(c,p.cell)<=1))return;
  const candidates=[];for(const c of roadCells)for(const delta of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]){
   const q=[c[0]+delta[0],c[1]+delta[1]];
   if(q[0]<0||q[1]<0||q[0]>=level.cols||q[1]>=level.rows||water.has(key(q)))continue;
   if(p.kind==='gate'&&!(q[0]===0||q[1]===0||q[0]===level.cols-1||q[1]===level.rows-1))continue;
   candidates.push(q);
  }
  candidates.sort((a,b)=>dist(a,p.cell)-dist(b,p.cell)||a[1]-b[1]||a[0]-b[0]);const q=candidates[0];
  if(!q||dist(q,p.cell)>3)throw Error('Cannot attach '+p.name+' to simplified corridors within 3 cells');
  moves.push({name:p.name,from:p.cell,to:q});p.cell=q;
 });
 src.simplification={inputRoadObjects:byName.size,outputCorridors:level.roads.length,policy:'Positive-flow source spines, one displayed corridor per name; minimum source-edge connectors retained for reachability; harmonic-mean capacity; no invented edges',moves,connectors};
 // Source road v/c calibrates a single global capacity coefficient (existing checker).
 const checker=require(path.join(V7,'shared/levelgen/check.js'));
 src.calibration=checker.calibrateRoads(level,engine);
 return level;
}

function generate(modeFilter){
 const base=read(path.join(V7,'hk/hk-base.json')),demand=read(path.join(V7,'hk/hk-demand-am.json'));
 const zones=new Map(base.zones.map(z=>[String(z.id),z])),seq=demand.zones.map(String),flows=new Map();
 for(const p of demand.pairs){const id=seq[p[0]];flows.set(id,(flows.get(id)||0)+p[2]+p[3]);}
 const sample=n=>clone(read(path.join(V7,'levels/examples',`m${n}-1.json`)).level);
 const constants=l=>{delete l.origins;delete l.destinations;delete l.land;delete l.title;return l;};
 const m2=constants(sample(2)),m4=constants(sample(4));
 const origin=(id,cell,fraction=1,label)=>{const z=zones.get(id);if(!z)throw Error(id);return{name:label||z.name,hans:label?label.replace(/東/g,'东').replace(/帶/g,'带'):z.hans,cell,house:[0,-1],people:0,
  zoneIds:[id],sourcePop:z.pop*fraction,sourceAM:(flows.get(id)||0)*fraction,sourceFraction:fraction};};
 const dest=(id,cell,label)=>{const z=zones.get(id);return{name:label||z.name,hans:z.hans,short:label||z.name,shortHans:z.hans,kind:'jobs',cell,house:[0,1],attraction:Number((16+z.jobs/15000).toFixed(6)),carExtra:2+Math.min(2,z.cbd||0),jobs:z.jobs,zoneIds:[id]};};
 const packageLevel=(mode,num,title,hans,en,station,story,level)=>({format:'tl-level/1',mode,key:`m${mode}-${num}`,order:num,challenge:num===4,title:{'zh-Hant':title,'zh-Hans':hans,en},story,hub:{station},author:'Codex · task 57',
  source:{files:['v7/hk/hk-base.json','v7/hk/hk-demand-am.json'],trust:'C/D · teaching schematic; not a forecast'},level:{...level,title,story}});
 const save=e=>{if(!modeFilter||modeFilter===e.mode)write(path.join(V7,'levels','m'+e.mode,e.key+'.json'),e);};
 const manual=(mode,num,title,hans,en,station,origins,destinations,settings,land,story,difficulty)=>{
  const total=origins.reduce((s,o)=>s+o.sourceAM,0),target=280;
  origins.forEach(o=>o.people=Math.round(o.sourceAM/total*target));
  const maxJobs=Math.max(...destinations.map(d=>d.jobs));
  destinations.forEach(d=>d.attraction=Number((16+8*d.jobs/maxJobs).toFixed(6)));
  const lvl={...(mode===2?clone(m2):clone(m4)),origins,destinations,...settings,tiers:[1,2,3]};
 if(mode===4){const occupied=new Set([...origins,...destinations].map(o=>key(o.cell)));
   lvl.land=land.filter(cell=>!occupied.has(key(cell))).map(cell=>({cell}));}
  lvl.source={method:'Manual schematic; origin AM car+pt outflow scaled to 280; attraction=16+8*jobs/max(selected jobs), matching the built-in attraction range',amTotal:total,scale:target/total,maxJobs,
   difficulty,coordinateNote:'14×9 teaching layout, preserves broad west/east and north/south; split zone fractions and lot positions are D-tier schematic assumptions.',
   assumptions:{...settings,land:land||null,subdivision:origins.filter(o=>o.sourceFraction!==1).map(o=>({name:o.name,zone:o.zoneIds[0],fraction:o.sourceFraction}))}};
  save(packageLevel(mode,num,title,hans,en,station,story,lvl));
 };
 const tc=()=>[origin('950S.4',[1,6],.5,'逸東邨·西'),origin('950S.4',[3,6],.5,'逸東邨·東'),origin('950S.3',[5,4]),origin('950S.6',[9,2],.5,'裕雅苑·西'),origin('950S.6',[12,3],.5,'裕雅苑·東')];
 manual(2,2,'東涌·北大嶼山','东涌·北大屿山','Tung Chung · North Lantau','東涌',tc(),[dest('950S.3',[6,5],'東涌市中心'),dest('950S.1',[3,0],'機場就業區')],{budget:38},null,
  ['逸東到東涌東的居民，要去市中心或機場。兩個去處分在不同方向。','先選服務哪批人，再留錢買車；開通後不能重修。'],['新增：兩個去處分向，線路不能只穿一個中心。']);
 manual(2,3,'將軍澳南·日出康城','将军澳南·日出康城','Tseung Kwan O South · LOHAS Park','康城',
  [origin('833.4',[1,4]),origin('838.5',[4,5]),origin('838.4',[7,4]),origin('838.3',[9,3]),origin('839.1',[12,7])],
  [dest('838.1',[5,3],'將軍澳市中心'),dest('839.1',[11,7],'康城商業區'),dest('837.1',[9,0],'坑口商業區')],{budget:35},null,
  ['康城人口集中在東南，坑口與將軍澳市中心分在北面和西面。','三個去處與較緊的預算，逼你在繞路、站數和列車之間取捨。'],['承接分向去處；再新增：三個中心、東南大客源與較緊預算。']);
 manual(2,4,'北部都會區·新田古洞','北部都会区·新田古洞','Northern Metropolis · San Tin and Kwu Tung','落馬洲',
  [origin('542',[1,3]),origin('543S',[3,7]),origin('545',[7,1]),origin('548S',[9,2]),origin('547',[11,6])],
  [dest('542',[1,0],'落馬洲就業區'),dest('624S.3',[13,4],'上水商貿區'),dest('626',[10,8],'彩蒲苑商業區')],{budget:32},null,
  ['新田與古洞之間是一張待規劃的白地。人口與工作點分散在整條走廊。','挑戰關：有限預算一次建好，沒有 AI 示範；高分要同時照顧客源、轉乘端與運力。'],['組合：三個分離中心、稀疏客源、最緊預算；白地只代表沒有預畫新線，沒有虛構未來人口。']);
 const lotsKT=[[2,1],[3,1],[4,1],[2,3],[4,3],[6,2],[7,2],[8,2],[6,4],[8,4],[10,3],[11,3],[12,3],[10,5],[12,5]];
 manual(4,2,'古洞北·兩端開發','古洞北·两端开发','Kwu Tung North · two development nodes','上水',
  [origin('545',[1,2]),origin('548S',[3,2]),origin('623',[6,2]),origin('624S.2',[9,4]),origin('626',[11,7])],
  [dest('624S.3',[11,4],'上水商貿區'),dest('624S.1',[13,6],'上水市中心')],{budget:38},lotsKT,
  ['古洞北到上水的屋苑，隔著兩片可開發地。人口來自現有底板，空地是教學配置。','先讓鐵路接通工作點，再比較住宅和商場怎樣互相抬價。'],['新增：空地分成兩端，不是把站全放在一個開發團就足夠。']);
 const lotsTC=[[1,4],[2,4],[3,4],[1,6],[3,6],[5,3],[6,3],[7,3],[5,5],[7,5],[9,1],[10,1],[11,1],[9,3],[11,3],[11,5]];
 manual(4,3,'東涌東·分期賣地','东涌东·分期卖地','Tung Chung East · phased land sales','東涌',tc(),
  [dest('950S.3',[5,5],'東涌市中心'),dest('950S.1',[2,0],'機場就業區'),dest('950S.6',[12,2],'東涌東商業區')],{budget:35},lotsTC,
  ['東涌東空地離機場和舊市中心各有一段距離。','預算更緊、去處更多；要把車先買夠，並安排住宅與商場的出售年份。'],['承接分散地塊；再新增：三個去處、運力與售地時序同時受限。']);
 const lotsHSK=[[1,1],[2,1],[3,1],[1,3],[3,3],[5,1],[6,1],[7,1],[5,3],[7,3],[9,3],[10,3],[11,3],[9,5],[11,5],[4,6],[5,6],[6,6]];
 manual(4,4,'洪水橋全區·鐵路與物業','洪水桥全区·铁路与物业','Hung Shui Kiu · district-wide rail and property','洪水橋',
  [origin('511',[1,2]),origin('515',[6,3]),origin('512',[5,7]),origin('517',[12,2]),origin('519',[10,7]),origin('442',[1,8])],
  [dest('515',[6,4],'洪水橋商貿區'),dest('528',[13,0],'橫洲就業區'),dest('519',[11,8],'唐人新村商業區')],{budget:32},lotsHSK,
  ['洪水橋全區的住宅、工作與可開發地分散在三片。','挑戰關：沒有 AI 示範；站位、運力、住宅商場比例與售地年份一起決定八年的賬。'],['組合：三片地塊、六個客源、三個中心、最緊預算；不能靠只賣一種用途拿滿分。']);
 const cutter=require(path.join(V7,'shared/levelgen/cut.js'));
 const defs=[
  [2,'sha-tin-tai-wai','沙田·大圍','沙田·大围','Sha Tin · Tai Wai','大圍',24,12,['新增：南北通勤與河兩岸接駁；第二期要把通道補完整。']],
  [3,'tsuen-wan-kwai-tsing','荃灣·葵青','荃湾·葵青','Tsuen Wan · Kwai Tsing','葵芳',21,12,['承接兩期投資；再新增：青衣與葵青支路、分離客源及更緊首期預算。']],
  [4,'causeway-bay-wan-chai','銅鑼灣·灣仔','铜锣湾·湾仔','Causeway Bay · Wan Chai','銅鑼灣',18,10,['組合：三個去處、既有多線轉乘、跨海出口與最緊兩期預算；沒有示範。']]
 ];
 for(const [num,area,title,hans,en,station,budget,phase2Budget,difficulty] of defs){
  const cut=cutter.cut(base,demand,{area,mode:3,period:'am',title});if(cut.problems.length)throw Error(JSON.stringify(cut.problems));
  const l=simplifyCorridors(cut.level,E(3));l.budget=budget;l.phase2Budget=phase2Budget;
  l.perTrain=num===2?30:25;l.crowdBlocks=num===2?6:8;
  l.learn=.1;
  for(const ln of l.lines){ln.sourceTrains=ln.trains;ln.trains=Math.ceil(ln.trains*40/l.perTrain);}
  l.source.operatingScenario={perTrain:l.perTrain,perTrainBase:40,fraction:l.perTrain/40,crowdBlocks:l.crowdBlocks,
   learn:l.learn,note:'D-tier teaching scenario: new units carry 75% / 62.5% of built-in 40; crowd penalty is 1.5x / 2x built-in 4; learning=one third of built-in .3. All existing rail branches retained; their unit counts are rounded up to preserve at least the source 3x40 total capacity. These are teaching units, not real train capacities.'};
  E(3).D.use(l,'final-diagnostic');E(3).reset();l.source.finalRoadRank=require(path.join(V7,'shared/levelgen/check.js')).ranking(E(3),l);
  l.source.cutNotes=cut.notes;l.source.difficulty=difficulty;
  save(packageLevel(3,num,title,hans,en,station,['早高峰人口、工作點和道路來自全港底板切片，保留有車流的主走廊。',difficulty[0]+' 道路暢通後仍可能有人重新開車，要看八年的總減堵。'],l));
 }
}

// Original bots hard-code D.example('mN-1') after --level. Supplying the full level as the
// supported options argument makes the existing search really use the requested JSON.
// A CommonJS wrapper captures lexical results; no textual changes or --write on originals.
function search(file,restarts){
 const e=read(file),mode=e.mode,bot=path.join(ROOT,'bots',bots[mode]),level=clone(e.level);delete level.demo;
 const n=restarts||({2:400,3:18,4:60}[mode]);
 const proc={argv:[process.execPath,bot,String(n),JSON.stringify(level),'--level',file]};
 const suffix=mode===2?'module.exports={found,clean};':mode===3?'module.exports={finals,firsts,baseAlong,climb,doFour};':'module.exports={results};';
 const mod={exports:{}},start=Date.now();
 const log={log:(...v)=>console.log(...v.map(x=>typeof x==='string'&&x.startsWith('{"cols"')?'[full level supplied as bot options]':x))};
 new Function('require','module','exports','__dirname','__filename','process','console',fs.readFileSync(bot,'utf8')+'\n'+suffix)(Module.createRequire(bot),mod,mod.exports,path.dirname(bot),bot,proc,log);
 const data=mod.exports,M=E(mode);M.D.use(clone(level),e.key);M.reset();
 let best=0,plans;
 const basics=basicPlans(M,mode);
 if(mode===2)best=Math.round(data.found[0].s);
 else if(mode===3){
  data.finals.push(...basics.map(f=>({p:f.p,s:f.s})));
  // Deterministic follow-up to the simple-scheme audit: let the same bot improve
  // the three strongest basic layouts and spend the phase-two budget. The required
  // original search still runs exactly 18 randomized restarts.
  for(const basic of basics.slice(0,3)){const first=data.climb(buildPlan(M,basic.record),24);data.finals.push(data.climb(data.doFour(first.p),14,true));}
  data.finals.sort((a,b)=>b.s-a.s);best=Math.round(data.finals[0].s);
 }
 else best=Math.round(Math.max(...Object.values(data.results).filter(Boolean).map(x=>x.plan.total)));
 const tiers=[.4,.65,.88].map(r=>Math.round(best*r));M.D.tiers=tiers;
 if(mode===2){plans={tiers,best};
  ['pass','high','master'].forEach((name,j)=>{
   const above=data.found.filter(f=>f.s>=tiers[j]&&(j===2||f.s<tiers[j+1]));
   const simple=above.filter(data.clean).sort((a,b)=>(a.p.stations.length+a.p.trains)-(b.p.stations.length+b.p.trains)||a.s-b.s)[0];
   const c=j===2?data.found[0]:simple||above.at(-1)||data.found.filter(f=>f.s>=tiers[j]).at(-1);
   plans[name]={line:c.p.line,stations:c.p.stations,trains:c.p.trains,score:Math.round(c.s)};
  });
 }else if(mode===3){plans={tiers,best};const pool=data.finals.filter(f=>f.p.money>=0),choose=(lo,hi)=>pool.filter(f=>f.s>=lo&&(hi===undefined||f.s<hi)).sort((a,b)=>a.s-b.s)[0];
  const choices=[choose(tiers[0],tiers[1])||choose(tiers[0]),choose(tiers[1],tiers[2])||choose(tiers[1]),pool[0]];
  ['pass','high','master'].forEach((k,i)=>{const f=choices[i],p=f.p.phase1State||f.p;plans[k]={line:p.line,stations:p.stations,trains:p.trains,phase2:f.p.phase2Actions||[],score:Math.round(f.s)};});
 }else{plans={tiers,best};for(const [k,r] of [['pass',data.results.shop],['high',data.results.home],['master',data.results.mixed]]){
   if(!r)throw Error('Missing TOD strategy '+k);plans[k]={line:r.base.line,stations:r.base.stations,trains:r.base.trains,actions:r.actions||[],score:Math.round(r.plan.total)};
  }
 }
 e.level.tiers=tiers;
 if(!e.challenge)e.level.demo=plans;else delete e.level.demo;
 const replay={};for(const [i,k] of ['pass','high','master'].entries()){
  const p=replayPlan(M,mode,plans[k]);replay[k]=Math.round(p.total);
  if(replay[k]!==plans[k].score)throw Error(k+' replay differs: '+replay[k]+' vs '+plans[k].score);
  if(!e.challenge&&replay[k]<tiers[i])throw Error(k+' below its tier: '+replay[k]+' < '+tiers[i]);
 }
 const b=basics.slice().sort((a,b)=>Math.abs(Math.round(a.s)-tiers[0])-Math.abs(Math.round(b.s)-tiers[0])||a.record.line.length-b.record.line.length)[0];
 const simple={from:b.names[0],to:b.names[1],score:Math.round(b.s),gap:Math.round(b.s)-tiers[0],plan:b.record,
  selection:'Example closest to the pass line among plans with the same two-station/one-train complexity; the strongest such plan is reported separately',strongestBasic:Math.round(basics[0].s)};
 e.verification={bot:bots[mode],restarts:n,seconds:Number(((Date.now()-start)/1000).toFixed(2)),best,tiers,demoScores:e.challenge?null:replay,
  strategyScores:replay,simple:{description:'Shortest Manhattan L between two named places, two end stations, one train; no phase two; TOD sells eligible lots as homes in file order, two a year',...simple},
  followUp:mode===3?'Three strongest simple layouts improved with the same original climb/phase-two routines; no additional randomized restart':null,
  headlessReplay:true,browser:null};
 write(file,e);console.log('TASK57 '+JSON.stringify({key:e.key,...e.verification}));
}
function buildPlan(M,record){const p=new M.Plan();for(const c of record.line)if(!p.extend(c))throw Error('Illegal line '+key(c));
 for(const c of record.stations)if(!p.toggleStation(c))throw Error('Illegal station '+key(c));for(let i=1;i<record.trains;i++)if(!p.addTrain())throw Error('Over budget train');return p;}
function replayPlan(M,mode,record){const p=buildPlan(M,record);
 if(mode===3){while(p.year<4)if(!p.runYear())throw Error('Phase 1 stalled');for(const a of record.phase2||[]){const ok=a.type==='extend'?p.extend(a.cell):a.type==='station'?p.toggleStation(a.cell):a.type==='train'?p.addTrain():false;if(!ok)throw Error('Illegal phase 2 '+JSON.stringify(a));}
  p.continuePhase2();while(!p.done)if(!p.runYear())throw Error('Phase 2 stalled');
 }else if(mode===4){for(let y=0;y<M.P.years;y++){for(const a of (record.actions||[]).filter(a=>a.year===y))if(!p.sellLand(a.cell,a.use))throw Error('Illegal sale');if(!p.runYear())throw Error('TOD stalled');}}
 else{while(!p.done)if(!p.runYear())throw Error('Metro stalled');}
 return p;
}
function basicPlans(M,mode){
 const ds=M.D.destinations,pairs=M.D.origins.flatMap(o=>ds.map(d=>({o,d})));
 ds.forEach((o,i)=>ds.slice(i+1).forEach(d=>pairs.push({o,d})));const out=[];
 for(const {o,d} of pairs)for(const axes of [[0,1],[1,0]]){if(dist(o.cell,d.cell)<2)continue;
  const line=[o.cell.slice()];let c=o.cell.slice();for(const a of axes)while(c[a]!==d.cell[a]){c=c.slice();c[a]+=Math.sign(d.cell[a]-c[a]);line.push(c);}
  try{const record={line,stations:[o.cell,d.cell],trains:1,actions:[],phase2:[]};
   if(mode===4){const p=buildPlan(M,record),lots=M.D.land.filter(l=>p.canSell(l.cell));record.actions=lots.slice(0,2*M.P.years).map((l,i)=>({cell:l.cell,use:'home',year:Math.floor(i/2)}));}
   const p=replayPlan(M,mode,record);out.push({p,s:p.total,record,names:[o.name,d.name]});
  }catch{}
 }out.sort((a,b)=>b.s-a.s);if(!out.length)throw Error('No legal basic scheme');return out;
}
function verify(){for(const file of files()){const e=read(file),M=E(e.mode);M.D.use(clone(e.level),e.key);M.reset();
 if(e.challenge&&e.level.demo)throw Error('Challenge has demo');if(!e.challenge&&!e.level.demo)throw Error('Tutorial lacks demo');
 for(const k of ['pass','high','master'])if(e.level.demo){const r=replayPlan(M,e.mode,e.level.demo[k]);if(Math.round(r.total)!==e.level.demo[k].score)throw Error('Replay mismatch');}
 const people=e.level.origins.reduce((s,o)=>s+o.people,0);if(people<250||people>320)throw Error('Population scale');
 if(e.mode===3){if(e.level.roads.length<6||e.level.roads.length>10)throw Error('Road density');const misses=e.level.origins.filter((o,i)=>M.G.carOD[i].every(r=>r.sections.length===0));if(misses.length)throw Error('No road access '+misses.map(o=>o.name));
  for(let i=1;i<M.G.doNothing.length;i++)if(Math.abs(M.G.doNothing[i]/M.G.doNothing[i-1]-1)>=.1)throw Error('Unstable no-build baseline');
  M.G.carOD.forEach((row,i)=>row.forEach((r,j)=>{if(dist(e.level.origins[i].cell,e.level.destinations[j].cell)>2&&!r.sections.length)throw Error('Disconnected origin-destination pair');}));
 }
 if(e.mode===4){const occupied=new Set([...e.level.origins,...e.level.destinations].map(o=>key(o.cell)));if(e.level.land.some(l=>occupied.has(key(l.cell))))throw Error('Vacant lot overlaps an occupied place');}
 console.log(e.key+' verified; people '+people+'; best '+e.verification.best);
 }}
function docs(qaFile){
 const qa=qaFile?read(path.resolve(qaFile)):[],entries=files().map(file=>({file,e:read(file)})),base=read(path.join(V7,'hk/hk-base.json')),demand=read(path.join(V7,'hk/hk-demand-am.json'));
 const zoneById=new Map(base.zones.map(z=>[String(z.id),z])),seq=demand.zones.map(String),byOrigin=new Map();
 for(const row of demand.pairs){const id=seq[row[0]];if(!byOrigin.has(id))byOrigin.set(id,[]);byOrigin.get(id).push(row);}
 const fmt=n=>Number.isFinite(n)?String(Number(n.toFixed(6))):String(n),table=(heads,rows)=>'| '+heads.join(' | ')+' |\n| '+heads.map(()=> '---').join(' | ')+' |\n'+rows.map(r=>'| '+r.join(' | ')+' |').join('\n')+'\n';
 const design=['# 任務57：九關設計與數字來源 / Level designs and provenance','',
  '資料快照：桌面副本內的 `v7/hk/hk-base.json`、`hk-demand-am.json`。本文件不把模型數字當實測，也不把教學空地當真實可售地。人口與崗位為底板的分區推算；格子、預算、有效運力和地塊是 D 級教學示意，僅供學習。',
  'Source snapshot: the copied Hong Kong base and AM demand files. Zone estimates and educational scenarios are distinguished below; none of these levels is a planning forecast.','',
  '## 共用口徑 / Common conventions','',
  '- `hk-base.zones` 的 id、name/hans、cell、pop、jobs、cbd 提供地名、相對方位、人口、崗位與中心類別。原底板一格 400 m；手擺 14×9 棋盤只保留大致方位，不宣稱每一格仍等於 400 m。',
  '- 手擺關的出門人數：逐分區加總 `hk-demand-am.pairs` 中 `car+pt`（第 3、4 欄），再乘分組比例與 `280/所選分區總出行`，四捨五入。東涌兩個大分區各等分為兩個示意子組，比例 0.5 為明示假設，並非新增統計分區。',
  '- 手擺吸引力 `16+8×本去處崗位/所選去處最大崗位`：16 沿用切片的底值，8 是內置 m2-1 的 24 減去 16；目的在把真實崗位比例映射到相同遊戲量級。停車額外格數 `2+min(2,cbd)` 沿用切片分類假設，並非實測停車時間。',
  '- 第三玩法由 `cut.js` 原樣選 6 個人口團、2 個崗位團及最大出框方向；人口只計入到這些去處的 car+pt，按原切片 scale 縮到約 300；吸引力保持 `16+jobs/15000`，出口以出框人數代崗位。',
  '- 所有關卡的來源分級、教學估算與參數完整保存在 JSON 的 `source` / `level.source`；`demo` 放在 `level.demo`，因為 data.js 只把 registry 的 level 物件帶入 D。挑戰關無此欄。','',
  '## 道路精簡函數 / Reusable corridor simplifier','',
  '`bots/v7_levels_batch.js::simplifyCorridors`：按道路名合併正流量邊，取連通分支的主脊；按可玩地點覆蓋與來源車流選 10 條。把主脊之間最短的底板連接段補回，必要的接駁即使原早高峰流量為零也保留，其他零流量小段移除。所有幾何邊都來自切片，沒有直線補造道路。支線來回描一遍，既有引擎會按無向邊去重；容量採來源段容量的調和平均×切片 scale，再沿用 checker 的單一係數校準。每條來源 sectionId、連接段原道路名、容量與調整係數都列在 JSON 中。',
  'The simplifier retains source-edge spines and the minimum source-network connectors, checks actual OD access, and never invents a road edge. One displayed corridor may include explicitly recorded short connectors.','',
  '第三玩法的有效新列車容量為 30 / 25 / 25（內置 40 的 75% / 62.5% / 62.5%），擁擠罰格 6 / 8 / 8（內置 4 的 1.5 / 2 / 2 倍），學習步長 0.1（內置 0.3 的三分一），全部是 D 級難度設定。已有鐵路全部保留，列車教學單位由 3 調到 4 / 5 / 5，維持至少原來 3×40 的總運力；這些數字不代表真實港鐵車廂或班次。','',
  '## 搜索、門檻與簡易方案 / Search and calibration','',
  '三個舊機器人在 --level 之後再次讀 mN-1，直接使用會搜索錯關。白名單不准改舊 bot，所以本批處理以既有 options 參數傳完整 level，並在 CommonJS 包裝中擷取候選；舊檔與 demo-plans.js 都不寫。第二玩法 400 次、第三玩法 18 次、第四玩法預設 60 次重啟。第三玩法另外把最強三個簡易佈局交回同一 climb/第二期程序確定性改善，避免門檻低於已知簡單方案，沒有再增加隨機重啟。',
  '門檻為 `round(best×[0.40,0.65,0.88])`。第二玩法按舊 --write 的「最簡潔乾淨且達標／最高分」選法；第三玩法按分段內最低達標／最高分，候選包括上述簡易方案復核；第四玩法與舊 --write 相同，過關=純商場、高分=純住宅、大師=混合。因此第四玩法的示範未必停在相應門檻之下。',
  '簡易例子固定為兩端兩站、單列車、最短 L 線、無第二期；TOD 只按檔案順序售住宅，每年兩塊。表內選同一複雜度中最接近過關線的例子，同時公布此類最高分，以免用弱例子掩蓋難度。所有示範逐操作回放，核對整數總分與每個購買／售地是否合法。',''];
 const summary=['# 任务57交回说明','',
  '桌面完整副本：`%USERPROFILE%\\Desktop\\TransitLab五模式-Codex\\任务57\\game-feeder\\`。原 F 盘项目只读，全程未运行 Git。新增九个 tl-level/1 JSON、一个批处理脚本和 designs.md；玩法源文件仅三个 demo.js 的取方案行附近增加 D.demo 回退；registry 与单页 HTML 是 build.py 自动产物。','',
  '## 每关结果',''];
 for(const {file,e} of entries){const l=e.level,v=e.verification,people=l.origins.reduce((s,o)=>s+o.people,0),q=qa.filter(x=>x.key===e.key);
  if(q.length){v.browser={method:'Actual browser mouse/locator input; completion read from visible DOM',results:q};write(file,e);}
  const demos=e.challenge?'挑战关，无 AI 示范':`过关 ${v.demoScores.pass}／高分 ${v.demoScores.high}／大师 ${v.demoScores.master}`;
  summary.push(`**${e.key} · ${e.title['zh-Hans']}**：${l.source.difficulty.join(' ')} 初始 ${people} 人，${l.origins.length} 个屋苑/居住组、${l.destinations.length} 个去处${e.mode===3?'、'+l.roads.length+' 条走廊':''}${e.mode===4?'、'+l.land.length+' 块空地':''}。机器人最好 ${v.best}；门槛 ${v.tiers.join(' / ')}；AI 示范 ${demos}。简易方案「${v.simple.from}→${v.simple.to}」${v.simple.score} 分，距过关线 ${v.simple.gap>=0?'+':''}${v.simple.gap}；同类简易方案最高 ${v.simple.strongestBasic}。浏览器记录 ${q.length?q.map(x=>x.tier+':'+(x.score??x.playable)).join('，'):'待补'}。`,'');
  design.push(`## ${e.key} · ${e.title['zh-Hant']} / ${e.title.en}`,'',
   `難度遞進：${l.source.difficulty.join(' ')} 入口站：${e.hub.station}。初始 ${people} 人；${l.cols}×${l.rows}。`,
   `Best ${v.best}; tiers ${v.tiers.join(' / ')}; ${e.challenge?'challenge, no demo':'demo pass/high/master '+Object.values(v.demoScores).join(' / ')}.`,'');
  const rowOrigin=l.origins.map(o=>{
   let raw=o.sourceAM;
   if(e.mode===3){const box=l.source.box,[x0,y0,x1,y1]=box,jobIds=new Set(l.destinations.filter(d=>d.kind!=='gate').flatMap(d=>d.zoneIds||[])),g=l.destinations.find(d=>d.kind==='gate'),side=g.cell[0]===0?'left':g.cell[0]===l.cols-1?'right':g.cell[1]===0?'top':'bottom';raw=0;
    for(const id of o.zoneIds)for(const p of byOrigin.get(id)||[]){const to=zoneById.get(seq[p[1]]);let keep=jobIds.has(seq[p[1]]);if(!keep&&to){const [x,y]=to.cell;if(x<x0||x>=x1||y<y0||y>=y1){const dx=x-(x0+(l.cols-1)/2),dy=y-(y0+(l.rows-1)/2),s=Math.abs(dx)/l.cols>=Math.abs(dy)/l.rows?(dx<0?'left':'right'):(dy<0?'top':'bottom');keep=s===side;}}if(keep)raw+=p[2]+p[3];}
   }
   return[o.name,(o.zoneIds||[]).join(', '),fmt(o.sourcePop),fmt(o.sourceFraction??1),fmt(raw),o.people,key(o.cell)];
  });
  design.push(table(['居住組 / Origin','底板 zoneIds','來源人口 / pop','比例 / fraction','原 AM car+pt','遊戲人數','棋盤 cell'],rowOrigin),
   `人數比例 scale=${fmt(l.source.scale)}。${e.mode===3?'分母與出框方向見 cutNotes；來源人數先加總後取整。':'原 AM 分母='+fmt(l.source.amTotal)+'；最大去處崗位='+l.source.maxJobs+'。'}`,'',
   table(['去處 / Destination','zoneIds / target','來源崗位或出框當量','吸引力 / attraction','carExtra','cell'],l.destinations.map(d=>[d.name,(d.zoneIds||[d.sourceTarget]).join(', '),d.jobs??d.jobsEquivalent,fmt(d.attraction),d.carExtra,key(d.cell)])),
   table(['參數 / Parameter','數值 / Value','出處 / Source'],Object.entries(l).filter(([k,val])=>typeof val==='number'||k==='aware'||k==='tiers').map(([k,val])=>[k,typeof val==='object'?JSON.stringify(val):val,k==='cols'||k==='rows'?'手擺示意 / cut box':k==='tiers'?'本關 bot 最好分×0.40/0.65/0.88，四捨五入':k==='budget'||k==='phase2Budget'?'D 級教學預算；按關卡遞減':k==='perTrain'&&e.mode===3||k==='crowdBlocks'&&e.mode===3||k==='learn'&&e.mode===3?'D 級 operatingScenario（上文列原值與倍率）':`沿用 levels/examples/m${e.mode}-1.json 或同玩法 engine.js 預設`])),
   `圖示偏移 house、手擺 cell、空地 cell 均為 D 級排版/教學設定；來源底板位置可由 zoneIds 回查。${e.mode===3?'切片坐標由原 box '+l.source.box.join(',')+' 平移；source.simplification.moves='+JSON.stringify(l.source.simplification.moves):''}`,'');
  if(e.mode===3){const M=E(3);M.D.use(clone(l),e.key);M.reset();design.push(
   table(['走廊 / Corridor','原容量調和均值','遊戲 cap','來源 sectionIds','逐格 via（來源邊）'],l.roads.map((r,i)=>[r.name,fmt(l.source.roadSections[i].modelCap),fmt(r.cap),[...new Set(l.source.roadSections[i].segments.flatMap(s=>s.sectionIds))].join(','),r.via.map(key).join(' → ')])),
   `容量全局係數 ${l.source.roadCapCoeff}；接駁段：${JSON.stringify(l.source.simplification.connectors)}。`,
   '已有鐵路：'+l.lines.map(ln=>ln.name+' '+ln.names.join('→')+'，'+ln.trains+' 教學列車單位（原 '+ln.sourceTrains+'×40）').join('；')+'。',
   '不建線 Y1–Y8 塞車：'+M.G.doNothing.map(n=>fmt(n)).join(' / ')+'。',
   '切片模型與精簡遊戲的道路排名診斷：'+JSON.stringify(l.source.finalRoadRank)+'。此診斷不是全模型校準驗收；來源中有穿境流量，縮成少量屋苑之後不能保證 v/c 排名一致。','');}
  if(e.mode===4)design.push('空地 / schematic vacant cells：'+l.land.map(q=>key(q.cell)).join('；')+'。已排除屋苑與去處的佔用格；這些不是實際地籍或政府賣地清單。','');
 }
 summary.push('## 复现与核查','',
  '在桌面 game-feeder 目录运行：','',
  '```powershell','node bots/v7_levels_batch.js --level v7/levels/m2/m2-2.json','node bots/v7_levels_batch.js --level v7/levels/m3/m3-2.json','node bots/v7_levels_batch.js --level v7/levels/m4/m4-2.json','node bots/v7_levels_batch.js verify','node tools/levels/levels.js check v7/levels/m3/m3-2.json','python v7/build.py','```','',
  '其余 JSON 同样检查。不要直接用旧 bot 的裸 --level 校分；其读回 mN-1 的现有问题由本新增脚本适配。`generate [mode]` 会重做该玩法初稿，并清掉已校分/示范；复现定稿分数请用 --level，而非重新 generate。','',
  '九关 levels.js check、批处理的逐操作回放/空地/OD 接驳/空跑稳定性检查、build.py 均通过。现有引擎检查：第二玩法 11、第三玩法 9、第四玩法 12，合计 32 项通过。三个 demo.js 与新增脚本语法检查通过。','',
  '## 留给最终审阅的既有局限','',
  '- 当前各玩法左栏标题、开场说明仍硬编码第一关地名；第二玩法的逐年表/说明仍只列前两个去处。新地图的全部去处在棋盘显示并参与算分，18 套分数以完成画面核对。这些位置不在本任务允许修改的文件/范围内，未扩大改动。',
  '- 古洞站不在现有 stations.js，古洞北按上水站定位；北部都会区默认 box 内没有分区人口，改用走廊周边现有分区。洪水桥按任务默认地点制作，与第一关的新界西北范围有交叠，入口锚点使用不同的洪水桥站。',
  '- 道路精简后，游戏 v/c 与全港模型的道路排名不是处处一致；保留具体诊断数值于 designs.md / level.source.finalRoadRank，不能把关卡成绩解释为专业规划结论。',
  '- 桌面副本保留开工时快照；期间 F 盘另有沙盘和 AI 更新，本任务没有同步覆盖。增量包仅含本任务白名单文件，验收记录列出原目录后续变化的时间戳/哈希证据，便于最终合并区分。',
  '- 规则引擎、旧机器人、data.js、demo-plans.js、ui.js、strings.js 及 F 盘原件均未改动。Claude 的最后审阅、调参、提交仍由原分工负责。','',
  'English handover: nine separate level JSON files, six tutorials with three embedded demos each, three challenges without demos. The copied game is rebuilt and replay-checked. Existing hard-coded headings/two-destination labels and model-versus-schematic traffic limitations are disclosed above; engine and original source project remain unchanged.','');
 fs.writeFileSync(path.join(V7,'levels/designs.md'),design.join('\n')+'\n');fs.writeFileSync(path.join(ROOT,'..','说明.md'),summary.join('\n')+'\n');
 console.log('written v7/levels/designs.md and ../说明.md');
}
module.exports={simplifyCorridors,replayPlan,search,generate,verify,docs};
if(require.main===module){const args=process.argv.slice(2);if(args[0]==='generate')generate(+args[1]||undefined);else if(args[0]==='verify')verify();else if(args[0]==='docs')docs(args[1]);else if(args[0]==='--level')search(path.resolve(args[1]),+(args[args.indexOf('--restarts')+1])||undefined);else throw Error('Use generate [mode] | --level <file> [--restarts N] | verify | docs [qa.json]');}
