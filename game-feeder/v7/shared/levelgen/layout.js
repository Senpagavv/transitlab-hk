(function(root){
'use strict';
const SETTINGS={"2":{"cols":14,"rows":9,"walkPer":2,"nearby":10,"stay":40,"wait":2,"lineCost":1,"stationCost":3,"trainCost":4,"perTrain":40,"budget":40,"years":8,"crowdBlocks":4,"aware":{"start":0.2,"spread":2}},"4":{"cols":14,"rows":9,"walkPer":2,"nearby":10,"stay":40,"wait":2,"lineCost":1,"stationCost":3,"trainCost":4,"perTrain":40,"budget":40,"years":8,"crowdBlocks":4,"aware":{"start":0.2,"spread":2},"homePeople":16,"shopBase":4,"shopPer":6,"carExtra":5,"homeRate":3,"shopRate":0.5}};
const Cutter=typeof module!=='undefined'&&module.exports?require('./cut.js'):root.LevelCutter;
const copy=x=>JSON.parse(JSON.stringify(x)),key=c=>c.join(','),distance=(a,b)=>Math.max(Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]));
const fail=(code,message,notes=[])=>({level:null,problems:[{code,message}],notes});
// Beam search on a small teaching grid. Ordering constraints prohibit reversing
// any source east/west or north/south relation; equal source coordinates may spread.
function place(items,water,cols,rows){
 const wet=new Set(water.map(key)),cells=[];
 for(let y=0;y<rows;y++)for(let x=0;x<cols;x++)if(!wet.has(key([x,y])))cells.push([x,y]);
 let beam=[{points:[],cost:0}];
 for(let i=0;i<items.length;i++){
  const item=items[i],next=[];
  for(const state of beam)for(const cell of cells){
   if(state.points.some((p,j)=>distance(p,cell)<2||[0,1].some(a=>{
    const delta=item.geo[a]-items[j].geo[a];return Math.abs(delta)>1e-6&&delta*(cell[a]-p[a])<0;
   })))continue;
   next.push({points:state.points.concat([cell]),cost:state.cost+(cell[0]-item.target[0])**2+(cell[1]-item.target[1])**2});
  }
  next.sort((a,b)=>a.cost-b.cost);beam=next.slice(0,160);
  if(!beam.length)return null;
 }
 return beam[0].points;
}
function layout(base,demand,request,mode){
 request=request||{};const notes=[],problems=[];
 if(!base||!Array.isArray(base.zones)||!demand||!Array.isArray(demand.pairs)||typeof base.land!=='string'||base.land.length!==base.cols*base.rows)
  return fail('invalid_input','Invalid Hong Kong base/demand schema.');
 const area=(base.areas||[]).find(a=>a.key===request.area),box=area&&Cutter.makeBox(area.box);
 if(!box||box.w<=0||box.h<=0||box.c0<0||box.r0<0||box.c0+box.w>base.cols||box.r0+box.h>base.rows)return fail('box_empty','Unknown or invalid area: '+request.area);
 const period=request.period||demand.period||'am',sourceDemand=demand.amDemand||demand;
 if(!['am','day','holiday'].includes(period)||sourceDemand.period&&sourceDemand.period!=='am')return fail('invalid_input','Modes 2/4 require AM source demand (pass amDemand alongside other periods).');
 if(request.changes!=null&&!Array.isArray(request.changes)||Array.isArray(request.changes)&&request.changes.length>4)return fail('invalid_request','At most four changes are supported.');
 const zones=base.zones.filter(z=>Array.isArray(z.cell)&&z.cell[0]>=box.c0&&z.cell[0]<box.c0+box.w&&z.cell[1]>=box.r0&&z.cell[1]<box.r0+box.h);
 const flows=new Map(),seq=(sourceDemand.zones||base.zones.map(z=>z.id)).map(String);
 for(const p of sourceDemand.pairs){const id=seq[p[0]];flows.set(id,(flows.get(id)||0)+Math.max(0,(+p[2]||0)+(+p[3]||0)));}
 const resolved=[];
 for(const ch of request.changes||[]){
  if(!ch||!['people','jobs'].includes(ch.what))return fail('invalid_request','road_cap is available only in mode 3.');
  if(!Number.isFinite(ch.pct)||ch.pct< -50||ch.pct>150)return fail('invalid_request','people/jobs pct must be between -50 and 150.');
  if(ch.by_year!=null&&(!Number.isInteger(ch.by_year)||ch.by_year<1||ch.by_year>8))return fail('invalid_request','by_year must be 1–8.');
  const pool=zones.filter(z=>ch.what==='people'?z.pop>0&&(flows.get(String(z.id))||0)>0:z.jobs>0),hit=Cutter.matchPlace(ch.place,pool);
  if(!hit||!hit.item||hit.ambiguous||hit.score<.999)return fail('place_not_found','No exact '+ch.what+' source zone for '+ch.place);
  resolved.push({change:ch,zone:hit.item});
 }
 const choose=(pool,metric,n,what)=>{
  const ranked=pool.slice().sort((a,b)=>metric(b)-metric(a)||String(a.id).localeCompare(String(b.id)));
  const forced=resolved.filter(r=>r.change.what===what).map(r=>r.zone),out=[...new Map(forced.concat(ranked).map(z=>[String(z.id),z])).values()].slice(0,n);
  return out;
 };
 const homes=choose(zones.filter(z=>z.pop>0&&(flows.get(String(z.id))||0)>0),z=>flows.get(String(z.id))||0,6,'people');
 const jobs=choose(zones.filter(z=>z.jobs>0),z=>z.jobs,3,'jobs');
 if(!homes.length||jobs.length<2)return fail('box_empty','Need positive trip demand and at least two job zones.');
 const groups=homes.map(z=>({z,fraction:1,side:null}));
 while(groups.length<5){
  const candidates=groups.filter(g=>!g.side).sort((a,b)=>(flows.get(String(b.z.id))||0)-(flows.get(String(a.z.id))||0));
  if(!candidates.length)return fail('box_empty','Too few independent residential groups (each zone can split once).');
  const g=candidates[0],i=groups.indexOf(g);groups.splice(i,1,{z:g.z,fraction:.5,side:'west'},{z:g.z,fraction:.5,side:'east'});
 }
 const amTotal=groups.reduce((s,g)=>s+(flows.get(String(g.z.id))||0)*g.fraction,0),scale=280/amTotal,maxJobs=Math.max(...jobs.map(z=>+z.jobs));
 const items=groups.map(g=>({geo:[g.z.cell[0]+(g.side==='west'?-.25:g.side==='east'?.25:0),g.z.cell[1]],group:g})).concat(jobs.map(z=>({geo:z.cell.slice(),job:z})));
 const lo=[0,1].map(a=>Math.min(...items.map(i=>i.geo[a]))-.5),hi=[0,1].map(a=>Math.max(...items.map(i=>i.geo[a]))+.5),cols=14,rows=9;
 const project=c=>c.map((v,a)=>(v-lo[a])/(hi[a]-lo[a])*([cols,rows][a]-1));
 const water=[];
 for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
  const c=Math.max(0,Math.min(base.cols-1,Math.round(lo[0]+x/(cols-1)*(hi[0]-lo[0])))),r=Math.max(0,Math.min(base.rows-1,Math.round(lo[1]+y/(rows-1)*(hi[1]-lo[1]))));
  if(['~','w'].includes(base.land[r*base.cols+c])||(base.water||[]).some(p=>p[0]===c&&p[1]===r))water.push([x,y]);
 }
 items.forEach(i=>i.target=project(i.geo));const points=place(items,water,cols,rows);
 if(!points)return fail('unreachable','Cannot preserve geographic order, spacing and dry cells on a 14 × 9 grid.');
 const origins=groups.map((g,i)=>({name:g.z.name+(g.side==='west'?'·西':g.side==='east'?'·東':''),hans:(g.z.hans||g.z.name)+(g.side==='west'?'·西':g.side==='east'?'·东':''),cell:points[i],house:[0,points[i][1]? -1:1],
  people:Math.round((flows.get(String(g.z.id))||0)*g.fraction*scale),zoneIds:[String(g.z.id)],sourceFraction:g.fraction,sourceAM:(flows.get(String(g.z.id))||0)*g.fraction,sourcePop:g.z.pop*g.fraction,sourceCell:g.z.cell.slice()}));
 // Use the example's car access assumptions in order; a third centre uses its
 // second centre's value. They are teaching settings, not measured travel times.
 const destinations=jobs.map((z,i)=>({name:z.name,hans:z.hans||z.name,short:z.name,shortHans:z.hans||z.name,kind:'jobs',cell:points[groups.length+i],house:[0,points[groups.length+i][1]<rows-1?1:-1],
  jobs:+z.jobs,attraction:+(16+8*z.jobs/maxJobs).toFixed(6),carExtra:i===0?3:7,zoneIds:[String(z.id)],sourceCell:z.cell.slice()}));
 const changeLog=[];
 for(const {change:c,zone:z} of resolved){
  const targets=c.what==='people'?origins.filter(o=>o.zoneIds.includes(String(z.id))):destinations.filter(d=>d.zoneIds.includes(String(z.id)));
  const field=c.what==='people'?'people':'attraction',factor=1+c.pct/100;
  for(const item of targets){const before=item[field];item[field]=c.what==='people'?Math.round(before*factor):+(before*factor).toFixed(6);changeLog.push({place:c.place,resolved:item.name,what:c.what,pct:c.pct,by_year:c.by_year||0,from:before,to:item[field]});}
  if(c.by_year)notes.push(mode===2?'Mode 2 uses the final value at opening; by_year='+c.by_year+' is not a yearly growth curve.':'Mode 4 uses the final value at opening; yearly source growth is not supported by this engine.');
 }
 const level={...copy(SETTINGS[mode]),title:request.title||area.name,story:request.story||[],origins,destinations,water,waterBlocksWalk:true,tiers:[0,0,0]};
 const parameterSources=Object.fromEntries(Object.keys(SETTINGS[mode]).map(k=>[k,'v7/levels/examples/m'+mode+'-1.json#/level/'+k]));
 level.source={area:area.key,period,peoplePeriod:'am',box:area.box,files:['v7/hk/hk-base.json','v7/hk/hk-demand-am.json'],trust:'C/D · teaching schematic; not a forecast',
  method:'Top six positive outgoing car+pt zones; up to three highest job zones; requested change zones included first. Source zones may split 50/50 to reach five groups.',
  amTotal,scale,targetPeople:280,maxJobs,changes:changeLog,parameterSources,
  numbers:{people:'round(outgoing car+pt × sourceFraction × 280 / selected outflow) × change factor; not population',attraction:'(16 + 8 × jobs / max(selected jobs)) × change factor',carExtra:'m'+mode+'-1 destination index 0 → 3, others → 7'},
  coordinates:{tier:'D',cols,rows,sourceBounds:[lo,hi],policy:'Affine map; no reversal of source E/W or N/S order; Chebyshev spacing ≥ 2; source water nearest-cell resampling; split-zone west/east offsets ±0.25 source cell are schematic.'},
  origins:origins.map(o=>({name:o.name,zoneIds:o.zoneIds,pop:o.sourcePop,periodOutflow:o.sourceAM,fraction:o.sourceFraction,cell:o.sourceCell,people:o.people})),
  destinations:destinations.map(d=>({name:d.name,zoneIds:d.zoneIds,jobs:d.jobs,cell:d.sourceCell,attraction:d.attraction,carExtra:d.carExtra}))};
 notes.push('C/D teaching schematic, not a forecast. AM car+pt outflow scaled to about 280 before changes, per task 57. Requested period '+period+' is retained as scenario context; these engines have no separate time-of-day parameters.');
 if(mode===4){
  const occupied=new Set(points.map(key)),wet=new Set(water.map(key)),patches=[],land=[];
  // Three compact patches on home-to-job corridors, never on places or water.
  const candidates=[];
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
   const c=[x,y];if(occupied.has(key(c))||wet.has(key(c)))continue;
   const between=origins.some(o=>destinations.some(d=>x>=Math.min(o.cell[0],d.cell[0])&&x<=Math.max(o.cell[0],d.cell[0])&&y>=Math.min(o.cell[1],d.cell[1])&&y<=Math.max(o.cell[1],d.cell[1])));
   if(between)candidates.push(c);
  }
  const used=new Set();
  for(let patch=0;patch<3;patch++){
   const available=candidates.filter(c=>!used.has(key(c))&&!patches.some(p=>p.some(q=>distance(q,c)<2)));
   let best=[];
   for(const seed of available){
    const pool=new Set(available.map(key)),todo=[seed],component=[],seen=new Set([key(seed)]);
    for(let h=0;h<todo.length&&component.length<5;h++){
     const c=todo[h];component.push(c);
     for(const n of [[c[0]+1,c[1]],[c[0]-1,c[1]],[c[0],c[1]+1],[c[0],c[1]-1]])if(pool.has(key(n))&&!seen.has(key(n))){seen.add(key(n));todo.push(n);}
    }
    if(component.length>best.length)best=component;if(best.length===5)break;
   }
   if(best.length<4)break;patches.push(best);for(const cell of best){used.add(key(cell));land.push({cell,patch:patch+1});}
  }
  if(land.length<12)return fail('unreachable','Cannot fit 12–18 dry land lots in 2–3 separated patches.',notes);
  level.land=land;level.source.land={tier:'D',count:land.length,patches,policy:'Three separated connected patches of five (minimum four) unsold cells between homes and destinations; no source zoning or sale claim.'};
 }
 return {level,problems,notes};
}
const API={toMode2:(b,d,r)=>layout(b,d,r,2),toMode4:(b,d,r)=>layout(b,d,r,4)};
if(typeof module!=='undefined'&&module.exports)module.exports=API;root.LevelLayout=API;
})(typeof window!=='undefined'?window:globalThis);
