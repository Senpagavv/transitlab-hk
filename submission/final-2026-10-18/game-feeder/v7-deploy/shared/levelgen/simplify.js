(function(root){
 'use strict';
 // Extracted from task 57; defaults preserve its calibration and selection behavior.
 const checker=typeof module!=='undefined'&&module.exports?require('./check.js'):root.LevelChecker;
 const clone=x=>JSON.parse(JSON.stringify(x)),key=c=>c.join(','),dist=(a,b)=>Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]);
function simplifyCorridors(level,engine,{count=10,calibrate=true,preserveChanges=false}={}){
 const inputCount=level.roads.length;
 const factors=new Map(level.roads.map((r,i)=>[r.name,level.source.roadSections[i]]));
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
   const changed=preserveChanges&&(src.changes||[]).some(ch=>ch.what==='road_cap'&&ch.resolved===c.name);
   const v=add*100+c.seq.length+Math.log1p(c.traffic)+(joins?12:0)+(changed?10000:0);
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
 src.simplification={inputRoadObjects:inputCount,outputCorridors:level.roads.length,policy:'Positive-flow source spines, one displayed corridor per name; minimum source-edge connectors retained for reachability; harmonic-mean capacity; no invented edges',moves,connectors};
 // Source road v/c calibrates a single global capacity coefficient (existing checker).
 if(preserveChanges)src.roadSections.forEach((meta,i)=>{const old=factors.get(level.roads[i].name);if(old){meta.capFactor=old.capFactor;meta.capGrowFactors=old.capGrowFactors;}});
 if(calibrate)src.calibration=checker.calibrateRoads(level,engine);
 return level;
}

 const API={simplifyCorridors};
 if(typeof module!=='undefined'&&module.exports)module.exports=API;
 root.LevelSimplifier=API;
})(typeof window!=='undefined'?window:globalThis);
