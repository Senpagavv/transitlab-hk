(function(root){
 'use strict';
 const key=c=>c.join(','),copy=x=>JSON.parse(JSON.stringify(x));
 const adjacent=c=>[[c[0]+1,c[1]],[c[0]-1,c[1]],[c[0],c[1]+1],[c[0],c[1]-1]];
 function search(level,engine,seconds,mode){
  const started=Date.now(),deadline=started+Math.min(20,Math.max(.1,Number(seconds)||15))*1000;
  engine.D.use(level,'levelgen');engine.reset();const Plan=engine.Plan;
  const clone=p=>Object.assign(new Plan(),copy({...p}));
  const poi=[...new Map([...level.origins,...level.destinations].map(p=>[key(p.cell),p.cell])).values()];
  let seed=59024,iterations=0,simpleBest=0,best=0,bestPlan=null;
  const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;},pick=a=>a[Math.floor(rnd()*a.length)];
  const planData=(p,actions,score)=>({line:copy(p.line),stations:copy(p.stations),trains:p.trains,spent:level.budget-p.money,actions:copy(actions),score:Math.round(score)});
  function retain(p,actions,value){if(Number.isFinite(value)&&value>best){best=value;bestPlan=planData(p,actions,value);}}
  function railScore(p){iterations++;const v=p.stations.length>=2?p.simulate().total:0;retain(p,[],v);return v;}
  function route(points,axis){
   const p=new Plan();if(!p.extend(points[0]))return null;
   for(const t of points.slice(1)){
    let c=p.line.at(-1).slice();
    for(const a of [axis,1-axis])while(c[a]!==t[a]){c=c.slice();c[a]+=Math.sign(t[a]-c[a]);if(!p.extend(c))return null;}
   }
   for(const c of poi)if(p.onLine(c)&&p.canStation(c))p.toggleStation(c);
   return p.stations.length>=2?p:null;
  }
  const candidates=new Map();
  function remember(p,score){
   if(mode!==4)return;
   const k=JSON.stringify([p.line,p.stations,p.trains]);
   if(!candidates.has(k))candidates.set(k,{p:clone(p),score,coverage:level.land.filter(q=>!p.onLine(q.cell)&&engine.landStation(p.stations,p.line,q.cell)).length});
   if(candidates.size>2048){
    const entries=[...candidates.entries()],keep=new Set(entries.slice().sort((a,b)=>b[1].score-a[1].score).slice(0,512).map(x=>x[0]));
    for(const [id] of entries.slice().sort((a,b)=>b[1].coverage-a[1].coverage||b[1].score-a[1].score).slice(0,512))keep.add(id);
    for(const id of candidates.keys())if(!keep.has(id))candidates.delete(id);
   }
  }
  // Short, two-POI Manhattan probes in both directions, before local search.
  for(let i=0;i<poi.length&&Date.now()<deadline;i++)for(let j=i+1;j<poi.length&&Date.now()<deadline;j++)for(const a of [0,1]){
   if(Date.now()>=deadline)break;const p=route([poi[i],poi[j]],a);if(!p)continue;
   for(const c of p.stations.slice())if(key(c)!==key(poi[i])&&key(c)!==key(poi[j]))p.toggleStation(c);
   const v=railScore(p);if(p.line.length<=6)simpleBest=Math.max(simpleBest,v);remember(p,v);
  }
  function moves(p){
   const out=[];
   for(const c of [p.line[0],p.line.at(-1)]){
    for(const n of adjacent(c))if(p.canExtend(n))out.push(q=>q.extend(n));
    if(p.line.length>2)out.push(q=>q.shorten(c));
   }
   for(const c of p.line)if(p.isStation(c)||p.canStation(c))out.push(q=>q.toggleStation(c));
   p.line.forEach((c,i)=>{if(p.isStation(c))for(const n of [p.line[i-1],p.line[i+1]])if(n&&!p.isStation(n))out.push(q=>{q.toggleStation(c);q.toggleStation(n);});});
   if(p.canTrain())out.push(q=>q.addTrain());if(p.canUntrain())out.push(q=>q.removeTrain());return out;
  }
  const railDeadline=mode===4?started+(deadline-started)*.36:deadline;
  while(Date.now()<railDeadline){
   const pts=[];const n=Math.min(poi.length,2+Math.floor(rnd()*3));
   for(let guard=0;guard<30&&pts.length<n;guard++){const c=pick(poi);if(!pts.some(p=>key(p)===key(c)))pts.push(c);}
   if(pts.length<2)break;let p=route(pts,rnd()<.5?0:1);if(!p)continue;
   while(p.canTrain()&&rnd()<.4)p.addTrain();let value=railScore(p);remember(p,value);
   for(let step=0;step<100&&Date.now()<railDeadline;step++){
    let next=null,nextScore=value;
    for(const move of moves(p)){
     if(Date.now()>=railDeadline)break;const q=clone(p);move(q);if(q.stations.length<2)continue;
     const v=railScore(q);remember(q,v);if(v>nextScore+1e-8){next=q;nextScore=v;}
    }
    if(!next)break;p=next;value=nextScore;
   }
  }
  if(mode===4){
   const all=[...candidates.values()],short=[];
   const sorted=[all.slice().sort((a,b)=>b.score-a.score),all.slice().sort((a,b)=>b.coverage-a.coverage||b.score-a.score)];
   for(let i=0;i<6;i++)for(const list of sorted)if(list[i]&&!short.includes(list[i]))short.push(list[i]);
   function run(base,actions){
    const p=clone(base);
    for(let year=1;year<=level.years;year++){
     const sales=actions.filter(a=>a.year===year);if(sales.length>2)return -Infinity;
     for(const a of sales)if(!p.sellLand(a.cell,a.use))return -Infinity;
     if(!p.runYear())return -Infinity;
    }
    iterations++;retain(base,actions,p.total);return p.total;
   }
   for(let index=0;index<short.length&&Date.now()<deadline;index++){
    const base=short[index].p,cells=level.land.filter(q=>!base.onLine(q.cell)&&engine.landStation(base.stations,base.line,q.cell)).map(q=>q.cell);
    const until=Date.now()+(deadline-Date.now())/(short.length-index);let actions=[],value=run(base,actions);
    for(let year=1;year<=level.years&&Date.now()<until;year++)for(let slot=0;slot<2&&Date.now()<until;slot++){
     let choice=null,score=value;
     for(const cell of cells)for(const use of ['home','shop']){
      if(Date.now()>=until)break;if(actions.some(a=>key(a.cell)===key(cell)))continue;
      const trial=actions.concat({cell,use,year}),v=run(base,trial);
      if(base.line.length<=6&&base.stations.length===2&&base.trains===1&&trial.length===1)simpleBest=Math.max(simpleBest,v);
      if(v>score+1e-8){choice=trial;score=v;}
     }
     if(choice){actions=choice;value=score;}
    }
    // Local changes cover cell, use, and delayed sale years.
    for(let round=0;round<3&&Date.now()<until;round++){
     let choice=null,score=value;
     for(let i=0;i<actions.length&&Date.now()<until;i++)for(const cell of cells)for(const use of ['home','shop'])for(let year=1;year<=level.years&&Date.now()<until;year++){
      if(actions.some((a,j)=>j!==i&&key(a.cell)===key(cell)))continue;
      const trial=actions.map((a,j)=>j===i?{cell,use,year}:a),v=run(base,trial);if(v>score+1e-8){choice=trial;score=v;}
     }
     if(!choice)break;actions=choice;value=score;
    }
   }
  }
  const rounded=Math.max(0,Math.round(best));
  return {best:rounded,bestPlan,simpleBest:Math.round(simpleBest),iterations,seconds:+((Date.now()-started)/1000).toFixed(3),tiers:[.4,.65,.88].map(f=>Math.round(rounded*f))};
 }
 function replay(level,engine,plan){
  engine.D.use(level,'levelgen-replay');engine.reset();if(!plan)return 0;const p=new engine.Plan();
  for(const c of plan.line)if(!p.extend(c))throw Error('Invalid bot line');
  for(const c of plan.stations)if(!p.toggleStation(c))throw Error('Invalid bot station');
  while(p.trains<plan.trains)if(!p.addTrain())throw Error('Invalid bot train budget');
  if(typeof p.sellLand==='function'){
   for(let year=1;year<=level.years;year++){
    for(const a of plan.actions||[])if(a.year===year&&!p.sellLand(a.cell,a.use))throw Error('Invalid bot land sale');
    if(!p.runYear())throw Error('Invalid bot year');
   }
   return Math.round(p.total);
  }
  return Math.round(p.simulate().total);
 }
 const API={search,replay};if(typeof module!=='undefined'&&module.exports)module.exports=API;root.LevelBot24=API;
})(typeof window!=='undefined'?window:globalThis);
