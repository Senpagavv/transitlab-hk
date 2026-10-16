'use strict';
const fs=require('node:fs'),path=require('node:path');
const M=require('../v7/mode3-roads/engine.js'),{D,P,Plan,G,same,expand}=M;
// --level <file.json>: tune a level file (v7/levels/README.md) instead of the mode's own level; prints, never writes
const argv=process.argv.slice(2),lvAt=argv.indexOf('--level'),levelFile=lvAt>=0?argv[lvAt+1]:null,args=argv.filter((_,i)=>lvAt<0||(i!==lvAt&&i!==lvAt+1)),write=args.includes('--write')&&!levelFile,pos=args.filter(x=>x!=='--write'),restarts=Math.max(4,+(pos[0]||18)),opts=pos[1]?JSON.parse(pos[1]):{};
if(levelFile){const e=JSON.parse(require('node:fs').readFileSync(levelFile,'utf8'));D.use(e.level,e.key);M.reset();console.log('level file '+levelFile+' → '+e.key);}
const def=(levelFile?JSON.parse(JSON.stringify(D)):D.example('m3-1'));for(const [k,v] of Object.entries(opts)){if(k==='people')def.origins=def.origins.map((o,i)=>({...o,people:v[i]}));else if(k==='att')def.destinations=def.destinations.map((d,i)=>({...d,attraction:v[i]}));else if(k==='grow')Object.assign(def,{}),v.origins&&(def.origins=def.origins.map((o,i)=>({...o,grow:v.origins[i]||o.grow}))),v.destinations&&(def.destinations=def.destinations.map((d,i)=>({...d,grow:v.destinations[i]||d.grow})));else def[k]=v;}
D.use(def,'bot-tune');M.reset();
let seed=71;const rnd=()=>{seed=(Math.imul(seed,1103515245)+12345)&0x7fffffff;return seed/0x80000000;},pick=a=>a[Math.floor(rnd()*a.length)];
const copy=x=>JSON.parse(JSON.stringify(x)),cp=p=>{const q=new Plan();Object.assign(q,copy(p));return q;};
const POI=[...D.origins.map(o=>o.cell),...D.destinations.map(d=>d.cell),...G.lines.flatMap(l=>l.stations)];
const N4=c=>[[c[0]+1,c[1]],[c[0]-1,c[1]],[c[0],c[1]+1],[c[0],c[1]-1]];
function routePlan(){for(let tries=0;tries<50;tries++){const pts=[],n=2+Math.floor(rnd()*3);while(pts.length<n){const c=pick(POI);if(!pts.some(x=>same(x,c)))pts.push(c);}
 const p=new Plan();let ok=p.extend(pts[0]);for(let j=1;j<pts.length&&ok;j++){let c=p.line.at(-1).slice(),z=pts[j],h=rnd()<.5;
  const walkAxis=a=>{while(ok&&c[a]!==z[a]){c=c.slice();c[a]+=Math.sign(z[a]-c[a]);if(!p.extend(c))ok=false;}};if(h){walkAxis(0);walkAxis(1);}else{walkAxis(1);walkAxis(0);}}
 if(!ok||p.line.length<2)continue;const candidates=POI.filter(c=>p.onLine(c));for(const c of candidates.sort(()=>rnd()-.5))if(p.canStation(c)&&rnd()<.75)p.toggleStation(c);
 if(p.stations.length<2){for(const c of p.line)if(p.canStation(c))p.toggleStation(c);if(p.stations.length<2)continue;}
 while(p.canTrain()&&rnd()<.45)p.addTrain();return p;}return null;}
function moves1(p){const out=[];for(const e of [p.line[0],p.line.at(-1)])if(e){for(const n of N4(e))if(p.canExtend(n))out.push(q=>q.extend(n));if(p.line.length>2&&p.canShorten(e))out.push(q=>q.shorten(e));}
 for(const c of p.line){if(p.isStation(c)||p.canStation(c))out.push(q=>q.toggleStation(c));}p.line.forEach((c,j)=>{if(!p.isStation(c))return;for(const n of [p.line[j-1],p.line[j+1]])if(n&&!p.isStation(n))out.push(q=>{q.toggleStation(c);q.toggleStation(n);});});
 if(p.canTrain())out.push(q=>q.addTrain());if(p.canUntrain())out.push(q=>q.removeTrain());return out;}
function moves2(p){const out=[];for(const e of [p.line[0],p.line.at(-1)])if(e)for(const n of N4(e))if(p.canExtend(n))out.push(q=>q.extend(n));
 for(const c of p.line)if(p.canStation(c))out.push(q=>q.toggleStation(c));if(p.canTrain())out.push(q=>q.addTrain());return out;}
const scoreCache=new Map();function score(p){const k=JSON.stringify([p.line,p.stations,p.trains,p.money,p.phase2Actions]);if(!scoreCache.has(k))scoreCache.set(k,p.stations.length>=2?p.simulate().total:-Infinity);return scoreCache.get(k);}
function sampledBest(p,phase2=false){const ms=phase2?moves2(p):moves1(p),q=ms.slice().sort(()=>rnd()-.5).slice(0,Math.min(12,ms.length));let best=null,bs=score(p);for(const m of q){const x=cp(p);if(m(x)&&x.stations.length>=2){const v=score(x);if(v>bs){bs=v;best=x;}}}return best;}
function climb(p,steps,phase2=false){let s=score(p);for(let j=0;j<steps;j++){const q=sampledBest(p,phase2);if(!q)break;const v=score(q);if(v<=s+1e-9)break;p=q;s=v;}return{p,s};}
const firsts=[];for(let i=0;i<restarts;i++){const p=routePlan();if(p){const f=climb(p,24);firsts.push(f);}}
firsts.sort((a,b)=>b.s-a.s);
function doFour(p){const q=cp(p);while(q.year<4)if(!q.runYear())break;return q;}
function yearJam(p){return p.simulate().log.map(x=>x.jam);}
const candidates=firsts.slice(0,Math.min(6,firsts.length)),finals=[];
for(const f of candidates){const p2=doFour(f.p);if(p2.phase!==2)continue;finals.push(climb(p2,14,true));}
finals.sort((a,b)=>b.s-a.s);
function worstRoad(y){let best=null;const congestion=id=>y.extra?y.extra[id]:(y.roadLoad[id]/G.sections[id].cap)**2;for(const r of D.roads){const ids=G.sections.filter(s=>s.roads.includes(r.name)).map(s=>s.id),mx=Math.max(...ids.map(congestion));if(!best||mx>best.extra)best={road:r,extra:mx,ids};}return best;}
function makeRoadPlan(r,phase2=false){const cells=expand(r.road.via),plans=[];for(let st=0;st<cells.length-1;st++)for(let len=2;len<=cells.length-st;len++){const p=new Plan();if(phase2){while(p.year<4)p.runYear();}let ok=true;for(let j=st;j<st+len;j++)if(!p.extend(cells[j])){ok=false;break;}if(!ok)continue;
 const picks=[];for(let j=0;j<len;j+=2)picks.push(cells[st+j]);if(!picks.some(c=>p.onLine(c)))continue;for(const c of picks)if(p.canStation(c))p.toggleStation(c);if(p.stations.length<2){for(const c of p.line)if(p.canStation(c))p.toggleStation(c);}
 if(p.stations.length<2)continue;while(p.canTrain())p.addTrain();if(phase2){p.continuePhase2();}plans.push(p);}
 plans.sort((a,b)=>score(b)-score(a));return plans[0]||null;}
function extendToward(p,road){const q=cp(p),cells=expand(road.road.via);let best=null,bestLen=Infinity;
 for(const end of [q.line[0],q.line.at(-1)])for(const target of cells){const d=Math.abs(end[0]-target[0])+Math.abs(end[1]-target[1]);if(d<bestLen)bestLen=d;}
 const opts=[];for(const side of [0,1])for(const target of cells){const start=q.line[side===0?0:q.line.length-1],path=[start.slice()];let c=start.slice();while(c[0]!==target[0]){c=[c[0]+Math.sign(target[0]-c[0]),c[1]];path.push(c);}while(c[1]!==target[1]){c=[c[0],c[1]+Math.sign(target[1]-c[1])];path.push(c);}opts.push({side,target,path});}
 opts.sort((a,b)=>a.path.length-b.path.length);for(const o of opts){const x=cp(q);let ok=true;const seq=o.path.slice(1);for(const c of seq){if(!x.extend(c)){ok=false;break;}}if(!ok)continue;
  for(const c of x.line)if(x.canStation(c)&&POI.some(z=>same(z,c))&&rnd()<.18)x.toggleStation(c);while(x.canTrain()&&rnd()<.4)x.addTrain();x.continuePhase2();best=x;break;}
 return best||(()=>{const x=cp(q);x.continuePhase2();return x;})();}
const baseRoad=worstRoad(G.base),baseAlong=makeRoadPlan(baseRoad,false),year4Base=doFour(baseAlong||firsts[0]?.p),road4=worstRoad(year4Base.log.at(-1)),road4Along=baseAlong?extendToward(doFour(baseAlong),road4):null;
const best=finals[0]||null,bestPlan=best&&best.p,bestRun=bestPlan&&bestPlan.simulate();
function fmt(p){return'p1 line '+p.phase1State?.line?.map(c=>c.join(',')).join(' ')+' · stations '+p.phase1State?.stations?.map(c=>c.join(',')).join(' ')+' · trains '+(p.phase1State?.trains||p.trains)+' · p2 '+JSON.stringify(p.phase2Actions);}
function jams(a){return a.map(x=>Math.round(x)).join(' ');}
console.log('do nothing jam Y1–Y8: '+G.doNothing.map(Math.round).join(' '));
console.log('Year 0 worst road: '+baseRoad.road.name+' (max extra '+baseRoad.extra.toFixed(2)+')');
if(baseAlong){const r=baseAlong.simulate();console.log('Along Y0 worst road, no phase 2: '+Math.round(r.total)+' pts; jam '+jams(r.log.map(x=>x.jam))+'; '+fmt(Object.assign(baseAlong,{phase1State:baseAlong.phase1State||{line:baseAlong.line,stations:baseAlong.stations,trains:baseAlong.trains}})));}
console.log('Year 4 worst road: '+road4.road.name+' (max extra '+road4.extra.toFixed(2)+')');
if(road4Along){const r=road4Along.simulate();console.log('Same plan + extend toward Y4 worst road: '+Math.round(r.total)+' pts; jam '+jams(r.log.map(x=>x.jam))+'; '+JSON.stringify(road4Along.phase2Actions));}
if(best){console.log('Best two-phase: '+Math.round(best.s)+' pts; '+fmt(best.p));console.log('Best jam: '+jams(bestRun.log.map(x=>x.jam)));console.log('Best off-road: '+bestRun.log.map(x=>Math.round(x.offRoadTotal)).join(' '));console.log('Best rebound: '+bestRun.log.map(x=>Math.round(x.reboundTotal)).join(' '));}
console.log('first-phase local optima: '+firsts.length+'; phase-two candidates: '+finals.length+'; cache: '+scoreCache.size);
const tiers=D.tiers,plans={tiers,best:Math.round(best?best.s:0)};
if(finals.length){const pool=finals.filter(f=>f.p.money>=0);const choose=(lo,hi)=>pool.filter(f=>f.s>=lo&&(hi===undefined||f.s<hi)).sort((a,b)=>a.s-b.s)[0];
 const pass=choose(tiers[0],tiers[1])||(baseAlong?{p:baseAlong,s:score(baseAlong)}:pool.at(-1)),high=choose(tiers[1],tiers[2])||pool[Math.floor(pool.length/2)]||pool[0],master=pool[0];
 for(const [k,f] of [['pass',pass],['high',high],['master',master]])if(f){const one=f.p.phase1State||{line:f.p.line,stations:f.p.stations,trains:f.p.trains};plans[k]={line:one.line,stations:one.stations,trains:one.trains,phase2:f.p.phase2Actions,score:Math.round(f.s)};console.log(k+' '+Math.round(f.s)+': '+fmt(f.p));}}
if(write){const file=path.join(__dirname,'../v7/mode3-roads/demo-plans.js');const payload=JSON.stringify(plans);fs.writeFileSync(file,'// v7 mode 3 · two-phase demo plans. Generated by bots/v7_roads.js.\n(function(root){root.TL_ROADS_DEMO={\"m3-1\":'+payload+'};})(typeof window!==\"undefined\"?window:globalThis);\n');console.log('written '+file);}
