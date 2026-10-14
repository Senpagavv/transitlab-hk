(function(root){
'use strict';
// v7 · mode 3 «roads that jam» — v2 (2026-10-14, task 49). Mode 2's rules on a real map (Kowloon East), with the roads
// and the metro lines already there; everything counted in blocks.
//   mode 2, unchanged  where to go (pull = attraction − blocks, against «nearby»), how to go (blocks saved → tenths by
//                      metro), going on between the two centres (against «done, home»), only people who know the new
//                      line use it, word of mouth, crowded sections cost `crowdBlocks` (learnt)
//   roads              a car trip follows the roads (a fixed route); every section takes `cap` cars and adds
//                      (cars ÷ cap)² blocks; drivers reckon with last year's reckoning + `learn` × (what they met − it)
//   foot               those not on the metro walk the same way: every block walking saves on the car, one in ten walk
// New in v2:
//   the city grows     origins / destinations may carry grow: [[year, value], …] — people / attraction in year t,
//                      straight lines between the points (valueAt, peopleAt, attractionAt); «do nothing» grows too
//   two phases         phase 1 (budget 20) is built in year 0; after year 4 the plan stops, phase 2 adds 12 and may
//                      only add (extend an end, a station, a train); phase2Actions replays it in simulate()
//   the cars' account  year(…, accounting) also gives, per section: offRoad = cars without the new line − cars with it
//                      (same people, reckoning, awareness); rebound = cars this year − cars had drivers kept the
//                      reckoning of the opening year (those who came back because the road cleared); roadBy = whose cars
// Score: each year «do nothing»'s jam minus this year's, added up; jam = Σ over sections of cars × extra blocks.
const D=typeof module!=='undefined'?require('./data.js'):root.ROADS_DATA;
const P={walkPer:2,wait:2,lineCost:1,stationCost:3,trainCost:4,perTrain:40,budget:20,phase2Budget:12,years:8,crowdBlocks:4,aware:{start:.2,spread:2},nearby:10,stay:40,learn:.5,target:0,highScore:0,masterScore:0};
const NUM=['walkPer','wait','lineCost','stationCost','trainCost','perTrain','budget','phase2Budget','years','crowdBlocks','nearby','stay','learn'];
const key=c=>c.join(','),same=(a,b)=>a&&b&&a[0]===b[0]&&a[1]===b[1],walk=(a,b)=>Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]),adj=(a,b)=>walk(a,b)===1;
function valueAt(o,f,t){const pts=[[0,Number(o[f]||0)],...(o.grow||[])].sort((a,b)=>a[0]-b[0]);if(t<=pts[0][0])return pts[0][1];
 for(let j=1;j<pts.length;j++){const a=pts[j-1],b=pts[j];if(t<=b[0])return a[1]+(b[1]-a[1])*(t-a[0])/(b[0]-a[0]);}return pts.at(-1)[1];}
const peopleAt=(i,t)=>valueAt(D.origins[i],'people',t),attractionAt=(k,t)=>valueAt(D.destinations[k],'attraction',t);
function expand(v){const out=[v[0].slice()];for(let j=1;j<v.length;j++){let c=out.at(-1).slice(),z=v[j];while(c[0]!==z[0]){c=[c[0]+Math.sign(z[0]-c[0]),c[1]];out.push(c);}while(c[1]!==z[1]){c=[c[0],c[1]+Math.sign(z[1]-c[1])];out.push(c);}}return out;}
const G={};
function buildRoads(){const sec=new Map(),nodes=new Map();G.sections=[];for(const r of D.roads){const cells=expand(r.via);for(let j=1;j<cells.length;j++){const a=cells[j-1],b=cells[j],k=[key(a),key(b)].sort().join('|');
 if(!sec.has(k))sec.set(k,{id:G.sections.length,a,b,cap:r.cap,roads:[r.name]}),G.sections.push(sec.get(k));else{const s=sec.get(k);s.cap=Math.max(s.cap,r.cap);if(!s.roads.includes(r.name))s.roads.push(r.name);}
 for(const [x,y] of [[a,b],[b,a]]){if(!nodes.has(key(x)))nodes.set(key(x),{cell:x,out:[]});nodes.get(key(x)).out.push({to:key(y),s:sec.get(k).id});}}}G.roadNodes=nodes;}
function carRoute(o,d,reach=1){const dist=new Map(),prev=new Map(),q=[];for(const [k,n] of G.roadNodes){const w=walk(o,n.cell);if(w<=reach){dist.set(k,w);q.push(k);}}if(!q.length)return{local:walk(o,d),sections:[]};
 while(q.length){q.sort((a,b)=>dist.get(a)-dist.get(b));const k=q.shift();for(const e of G.roadNodes.get(k).out){const v=dist.get(k)+1;if(!dist.has(e.to)||v<dist.get(e.to)){dist.set(e.to,v);prev.set(e.to,{k,s:e.s});if(!q.includes(e.to))q.push(e.to);}}}
 let best=null;for(const [k,n] of G.roadNodes){const w=walk(n.cell,d);if(w<=reach&&dist.has(k)&&(!best||dist.get(k)+w<best.v))best={k,v:dist.get(k)+w};}if(!best)return{local:walk(o,d),sections:[]};
 const sections=[];let k=best.k;while(prev.has(k)){const p=prev.get(k);sections.unshift(p.s);k=p.k;}return{local:best.v-sections.length,sections};}
function network(extra){const lines=[...G.lines,...(extra&&extra.stations.length>=2?[extra]:[])],nodes=[];
 lines.forEach((l,li)=>l.stations.map(s=>({cell:s,idx:l.cells.findIndex(c=>same(c,s))})).filter(s=>s.idx>=0).sort((a,b)=>a.idx-b.idx).forEach(s=>nodes.push({li,idx:s.idx,cell:s.cell,out:[]})));
 nodes.forEach((n,i)=>nodes.forEach((m,j)=>{if(i===j)return;if(n.li===m.li){const own=nodes.filter(x=>x.li===n.li);if(Math.abs(own.indexOf(n)-own.indexOf(m))===1)n.out.push({to:j,cost:1,ride:true});}else if(walk(n.cell,m.cell)<=1)n.out.push({to:j,cost:P.walkPer*walk(n.cell,m.cell)+P.wait-1,ride:false});}));return{lines,nodes};}
function metroTrip(net,o,d,crowded){const N=net.nodes.length;if(!N)return null;const dist=[Array(N).fill(Infinity),Array(N).fill(Infinity)],prev=[Array(N).fill(null),Array(N).fill(null)],done=[Array(N).fill(false),Array(N).fill(false)];
 net.nodes.forEach((n,i)=>dist[0][i]=P.walkPer*walk(o,n.cell)+P.wait-1);for(;;){let bi=-1,bf=0,bv=Infinity;for(let f=0;f<2;f++)for(let i=0;i<N;i++)if(!done[f][i]&&dist[f][i]<bv){bi=i;bf=f;bv=dist[f][i];}if(bi<0)break;done[bf][bi]=true;
 for(const e of net.nodes[bi].out){if(!e.ride&&bf===0)continue;const v=bv+e.cost;if(v<dist[1][e.to]){dist[1][e.to]=v;prev[1][e.to]={i:bi,f:bf};}}}
 let best=null;net.nodes.forEach((n,i)=>{const v=dist[1][i]+P.walkPer*walk(n.cell,d);if(v<Infinity&&(!best||v<best.v))best={i,v};});if(!best)return null;
 const path=[];let s={i:best.i,f:1};while(s){path.unshift(s.i);s=prev[s.f][s.i];}const legs=[];for(let j=1;j<path.length;j++){const a=net.nodes[path[j-1]],b=net.nodes[path[j]];if(a.li!==b.li)continue;const last=legs.at(-1);if(last&&last.li===a.li&&last.to===a.idx)last.to=b.idx;else legs.push({li:a.li,from:a.idx,to:b.idx});}
 let crowd=0;for(const l of legs){const n=net.lines[l.li].name;for(let j=Math.min(l.from,l.to);j<Math.max(l.from,l.to);j++)crowd=Math.max(crowd,(crowded&&crowded[n]&&crowded[n][j])||0);}
 const first=net.nodes[path[0]],last=net.nodes[path.at(-1)];return{blocks:best.v+crowd,crowd,legs,from:first.cell,to:last.cell,walkA:walk(o,first.cell),walkB:walk(last.cell,d),changes:legs.length-1,usesNew:legs.some(l=>net.lines[l.li].isNew),lines:legs.map(l=>net.lines[l.li].name)};}
const carExtra=k=>D.destinations[k].carExtra??2,carBlocks=(r,k,p)=>r.local+r.sections.reduce((s,id)=>s+1+p[id],0)+carExtra(k);
function split(blocks,t){const pulls=D.destinations.map((d,k)=>Math.max(0,attractionAt(k,t)-blocks[k])),all=pulls.reduce((a,b)=>a+b,0)+P.nearby;return{pulls,shares:pulls.map(x=>x/all),nearby:P.nearby/all};}
function onward(b,blocks,t){const pull=Math.max(0,attractionAt(b,t)-blocks);return{pull,share:pull+P.stay>0?pull/(pull+P.stay):0};}
function legOf(route,k,from,to,old,neu,per,crowd){const car=carBlocks(route,k,per),foot=P.walkPer*walk(from,to),alt=Math.min(car,foot),tOld=metroTrip(old,from,to,crowd),tNew=neu?metroTrip(neu,from,to,crowd):tOld,
 mo=tOld?tOld.blocks:Infinity,mn=tNew?tNew.blocks:Infinity,saveOld=Math.max(0,alt-mo),saveNew=Math.max(0,alt-mn);
 return{car,foot,alt,byFoot:foot<car,walkTenths:Math.min(10,Math.max(0,car-foot)),route,tOld,tNew,trip:tNew,fastOld:Math.min(alt,mo),fastNew:Math.min(alt,mn),tenthsOld:Math.min(10,saveOld),tenthsNew:Math.min(10,saveNew),save:saveNew,tenths:Math.min(10,saveNew)};}
function yearCore(plan,aware,per,crowded,t){const extraLine=plan&&plan.stations.length>=2?{name:'new',isNew:true,cells:plan.line,stations:plan.stations,trains:plan.trains}:null,old=G.netOld,neu=extraLine?network(extraLine):null,nets=neu||old;
 const roadLoad=Array(G.sections.length).fill(0),roadBy=G.sections.map(()=>[]),lineLoad={};for(const l of nets.lines)lineLoad[l.name]=Array(Math.max(0,l.cells.length-1)).fill(0);
 const ride=(q,n)=>{if(!q||!n)return;for(const l of q.legs)for(let j=Math.min(l.from,l.to);j<Math.max(l.from,l.to);j++){const arr=lineLoad[nets.lines[l.li]?.name];if(arr)arr[j]+=n;}};
 const drive=(route,n,from,to)=>{if(n<=0)return;for(const id of route.sections){roadLoad[id]+=n;const row=roadBy[id],hit=row.find(x=>x.from===from&&x.to===to);if(hit)hit.cars+=n;else row.push({from,to,cars:n});}};
 const pairs=[];if(P.stay>0)D.destinations.forEach((da,a)=>D.destinations.forEach((db,b)=>{if(a===b)return;const L=legOf(G.carDD[a][b],b,da.cell,db.cell,old,neu,per,crowded);pairs.push({a,b,k:b,...L,shareNow:onward(b,L.fastNew,t).share,shareBefore:onward(b,L.fastOld,t).share});}));
 const est=D.origins.map((o,i)=>{const legs=D.destinations.map((d,k)=>legOf(G.carOD[i][k],k,o.cell,d.cell,old,neu,per,crowded)),before=split(legs.map(l=>l.fastOld),t),now=split(legs.map(l=>l.fastNew),t),a=aware[i],n=peopleAt(i,t);
 const to=legs.map((L,k)=>{const knowGo=n*a*now.shares[k],dontGo=n*(1-a)*before.shares[k],go=knowGo+dontGo,mKnow=knowGo*L.tenthsNew/10,mDont=dontGo*L.tenthsOld/10,metro=mKnow+mDont,rest=go-metro,walkers=rest*L.walkTenths/10,drivers=rest-walkers;
 ride(L.tNew,mKnow);ride(L.tOld,mDont);drive(L.route,drivers,o.name,D.destinations[k].name);return{k,...L,knowGo,dontGo,go,metro,onNew:L.tNew&&L.tNew.usesNew?mKnow:0,walkers,drivers,before:G.base?G.base.est[i].to[k].go:go,pull:now.pulls[k]};});
 const chain=pairs.map(q=>{const x=to[q.a],knowGo=x.knowGo*q.shareNow,dontGo=x.dontGo*q.shareBefore,go=knowGo+dontGo,mKnow=knowGo*q.tenthsNew/10,mDont=dontGo*q.tenthsOld/10,metro=mKnow+mDont,rest=go-metro,walkers=rest*q.walkTenths/10,drivers=rest-walkers;
 ride(q.tNew,mKnow);ride(q.tOld,mDont);drive(q.route,drivers,D.destinations[q.a].name,D.destinations[q.b].name);return{knowGo,dontGo,go,metro,onNew:q.tNew&&q.tNew.usesNew?mKnow:0,drivers,walkers};});
 const sum=(a,f)=>a.reduce((s,x)=>s+x[f],0),metro=sum(to,'metro')+sum(chain,'metro'),onNew=sum(to,'onNew')+sum(chain,'onNew'),drivers=sum(to,'drivers')+sum(chain,'drivers');
 return{i,n,aware:a,to,chain,nearby:n*(a*now.nearby+(1-a)*before.nearby),metro,onNew,drivers,share:n?onNew/n:0};});
 const chain=pairs.map((q,j)=>{const sum=f=>est.reduce((s,e)=>s+e.chain[j][f],0);return{...q,go:sum('go'),metro:sum('metro'),onNew:sum('onNew'),drivers:sum('drivers'),walkers:sum('walkers'),before:G.base?G.base.chain[j].go:sum('go')};});
 const extra=roadLoad.map((v,id)=>(v/G.sections[id].cap)**2),jam=roadLoad.reduce((s,v,id)=>s+v*extra[id],0),lines=nets.lines.map(l=>{const cap=l.trains*P.perTrain;return{name:l.name,isNew:!!l.isNew,cap,load:lineLoad[l.name],crowded:lineLoad[l.name].map(v=>v>cap+1e-9)};});
 const crowdedNext={};for(const l of lines)crowdedNext[l.name]=l.crowded;const into=(k,f)=>chain.filter(q=>q.b===k).reduce((s,q)=>s+q[f],0);
 const dest=D.destinations.map((d,k)=>({k,go:est.reduce((s,e)=>s+e.to[k].go,0)+into(k,'go'),metro:est.reduce((s,e)=>s+e.to[k].metro,0)+into(k,'metro'),before:G.base?G.base.dest[k].go:0}));
 const sum=f=>est.reduce((s,e)=>s+e[f],0);return{est,chain,dest,roadLoad,roadBy,extra,jam,lines,crowded:crowdedNext,riders:sum('metro'),onNew:sum('onNew'),drivers:sum('drivers'),people:D.origins.reduce((s,o,i)=>s+peopleAt(i,t),0),year:t};}
function year(plan,aware,per,crowded,t=0,accounting=false){const y=yearCore(plan,aware,per,crowded,t);if(!accounting||!plan||plan.stations.length<2){y.offRoad=Array(G.sections.length).fill(0);y.rebound=Array(G.sections.length).fill(0);y.offRoadTotal=0;y.reboundTotal=0;return y;}
 const noLine=yearCore(null,aware,per,crowded,t),frozen=yearCore(plan,aware,plan.openedPerceived||per,crowded,t);y.offRoadRaw=noLine.roadLoad.map((n,id)=>n-y.roadLoad[id]);y.offRoad=y.offRoadRaw.map(n=>Math.max(0,n));y.rebound=y.roadLoad.map((n,id)=>Math.max(0,n-frozen.roadLoad[id]));
 y.offRoadTotal=y.offRoad.reduce((s,n)=>s+Math.max(0,n),0);y.offRoadNet=y.offRoad.reduce((s,n)=>s+n,0);y.reboundTotal=y.rebound.reduce((s,n)=>s+n,0);y.noLineRoadLoad=noLine.roadLoad;y.frozenRoadLoad=frozen.roadLoad;return y;}
const spread=(y,a)=>y.est.map((e,i)=>Math.min(1,a[i]+Math.min(1,P.aware.spread*e.share)*(1-a[i]))),learnFrom=(p,y)=>p.map((v,i)=>v+P.learn*(y.extra[i]-v));
const learnCrowd=(felt,y)=>{const out={};for(const l of y.lines){const was=felt[l.name]||[];out[l.name]=l.crowded.map((c,j)=>(was[j]||0)+P.learn*((c?P.crowdBlocks:0)-(was[j]||0)));}return out;};
function reset(){for(const k of NUM)if(D[k]!==undefined)P[k]=D[k];if(D.aware)P.aware={...P.aware,...D.aware};[P.target,P.highScore,P.masterScore]=D.tiers||[0,0,0];buildRoads();
 G.carOD=D.origins.map(o=>D.destinations.map(d=>carRoute(o.cell,d.cell)));G.carDD=D.destinations.map(a=>D.destinations.map(b=>carRoute(a.cell,b.cell)));
 G.lines=(D.lines||[]).map(l=>({name:l.name,hans:l.hans,color:l.color,cells:expand(l.via),stations:l.stations,names:l.names,namesHans:l.namesHans,trains:l.trains}));G.netOld=network(null);G.base=null;
 let per=G.sections.map(()=>0),crowd={},y=null,zero=D.origins.map(()=>0);for(let it=0;it<300;it++){y=yearCore(null,zero,per,crowd,0);const next=learnFrom(per,y),gap=Math.max(0,...next.map((v,j)=>Math.abs(v-per[j])));per=next;crowd=learnCrowd(crowd,y);if(gap<1e-6&&it>20)break;}
 G.base=yearCore(null,zero,per,crowd,0);G.base.perceived=per;G.base.crowdedStart=crowd;G.doNothing=[];G.doNothingRoad=[];let p2=per.slice(),c2=crowd;
 for(let t=1;t<=P.years;t++){const z=yearCore(null,zero,p2,c2,t);G.doNothing.push(z.jam);G.doNothingRoad.push(z.roadLoad);p2=learnFrom(p2,z);c2=learnCrowd(c2,z);}}
const copy=x=>JSON.parse(JSON.stringify(x));
class Plan{
 constructor(){Object.assign(this,{line:[],stations:[],trains:1,money:P.budget,phase:1,phase2Actions:[],phase1State:null,phase2Snapshot:null,phase2Committed:false,openedPerceived:null});this.rewind();}
 rewind(){if(this.phase1State){this.line=copy(this.phase1State.line);this.stations=copy(this.phase1State.stations);this.trains=this.phase1State.trains;this.money=this.phase1State.money;}
 Object.assign(this,{year:0,phase:1,phase2Actions:[],phase1State:null,phase2Snapshot:null,phase2Committed:false,openedPerceived:null,aware:D.origins.map(()=>P.aware.start),perceived:G.base.perceived.slice(),crowded:copy(G.base.crowdedStart),log:[],total:0,done:false});}
 get open(){return this.phase===1?this.year>0:this.phase2Committed;}
 get editing(){return !this.done&&((this.phase===1&&this.year===0)||(this.phase===2&&this.year===4&&!this.phase2Committed));}
 inside(c){return c[0]>=0&&c[1]>=0&&c[0]<D.cols&&c[1]<D.rows;}onLine(c){return this.line.some(x=>same(x,c));}isStation(c){return this.stations.some(x=>same(x,c));}
 canExtend(c){if(!this.editing||!this.inside(c)||this.onLine(c)||this.money<P.lineCost)return false;if(!this.line.length)return true;return adj(c,this.line[0])||adj(c,this.line.at(-1));}
 extend(c){if(!this.canExtend(c))return false;if(!this.line.length||adj(c,this.line.at(-1)))this.line.push(c.slice());else this.line.unshift(c.slice());this.money-=P.lineCost;if(this.phase===2)this.phase2Actions.push({type:'extend',cell:c.slice()});return true;}
 isEnd(c){return this.line.length>0&&(same(c,this.line[0])||same(c,this.line.at(-1)));}canShorten(c){return this.editing&&this.phase===1&&this.isEnd(c);}
 shorten(c){if(!this.canShorten(c))return false;if(same(c,this.line.at(-1)))this.line.pop();else this.line.shift();if(this.isStation(c)){this.stations=this.stations.filter(s=>!same(s,c));this.money+=P.stationCost;}this.money+=P.lineCost;return true;}
 canStation(c){return this.editing&&this.onLine(c)&&!this.isStation(c)&&this.money>=P.stationCost;}
 toggleStation(c){if(!this.editing)return false;if(this.isStation(c)){if(this.phase!==1)return false;this.stations=this.stations.filter(s=>!same(s,c));this.money+=P.stationCost;return true;}if(!this.canStation(c))return false;this.stations.push(c.slice());this.money-=P.stationCost;if(this.phase===2)this.phase2Actions.push({type:'station',cell:c.slice()});return true;}
 canTrain(){return this.editing&&this.money>=P.trainCost;}addTrain(){if(!this.canTrain())return false;this.trains++;this.money-=P.trainCost;if(this.phase===2)this.phase2Actions.push({type:'train'});return true;}
 canUntrain(){return this.editing&&this.phase===1&&this.trains>1;}removeTrain(){if(!this.canUntrain())return false;this.trains--;this.money+=P.trainCost;return true;}
 clear(){if(!this.editing||this.phase!==1)return false;Object.assign(this,{line:[],stations:[],trains:1,money:P.budget});return true;}
 now(){return year(this,this.aware,this.perceived,this.crowded,this.year+1,false);}
 potential(){let per=this.perceived.slice(),crowd=this.crowded,y=null,all=D.origins.map(()=>1);for(let it=0;it<60;it++){y=year(this,all,per,crowd,Math.min(P.years,this.year+1),false);per=learnFrom(per,y);crowd=learnCrowd(crowd,y);}return y;}
 canRun(){return !this.done&&this.stations.length>=2&&(this.phase===1?this.year<4:(this.phase2Committed&&this.year<P.years));}
 continuePhase2(){if(this.phase!==2||this.year!==4||this.phase2Committed)return false;this.phase2Committed=true;return true;}
 runYear(){if(!this.canRun())return null;if(this.year===0){this.phase1State={line:copy(this.line),stations:copy(this.stations),trains:this.trains,money:this.money};this.openedPerceived=this.perceived.slice();}
 const y=year(this,this.aware,this.perceived,this.crowded,this.year+1,true),before=this.aware.slice(),jam0=G.doNothing[this.year];this.year++;this.total+=jam0-y.jam;this.aware=spread(y,this.aware);this.perceived=learnFrom(this.perceived,y);this.crowded=learnCrowd(this.crowded,y);
 const entry={year:this.year,jam:y.jam,jam0,saved:jam0-y.jam,riders:y.riders,onNew:y.onNew,drivers:y.drivers,before,after:this.aware.slice(),crowdedSections:Object.values(y.crowded).reduce((s,a)=>s+a.filter(Boolean).length,0),dest:y.dest.map(d=>({go:d.go,metro:d.metro,before:d.before})),roadLoad:y.roadLoad,roadBy:y.roadBy,offRoad:y.offRoad,rebound:y.rebound,offRoadTotal:y.offRoadTotal,reboundTotal:y.reboundTotal};
 this.log.push(entry);let phaseStart=false;if(this.year===4){this.phase=2;this.money+=P.phase2Budget;this.phase2Snapshot={line:copy(this.line),stations:copy(this.stations),trains:this.trains,money:this.money};this.phase2Actions=[];this.phase2Committed=false;phaseStart=true;}if(this.year>=P.years)this.done=true;return{...entry,y,phaseStart};}
 simulate(){const first=this.phase1State||{line:copy(this.line),stations:copy(this.stations),trains:this.trains,money:this.money},actions=copy(this.phase2Actions||[]),p=new Plan();p.line=copy(first.line);p.stations=copy(first.stations);p.trains=first.trains;p.money=first.money;p.rewind();while(p.year<4){if(!p.runYear())return p;}
 if(p.phase===2){for(const a of actions){if(a.type==='extend')p.extend(a.cell);else if(a.type==='station')p.toggleStation(a.cell);else if(a.type==='train')p.addTrain();}p.continuePhase2();}while(!p.done)if(!p.runYear())break;return p;}
}
reset();
const API={D,P,G,Plan,year,spread,learnFrom,learnCrowd,metroTrip,network,carRoute,carBlocks,split,onward,expand,walk,same,key,adj,reset,valueAt,peopleAt,attractionAt};
if(typeof module!=='undefined')module.exports=API;root.Roads=API;
})(typeof window!=='undefined'?window:globalThis);
