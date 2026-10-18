(function(root) {
  'use strict';
  const D=typeof module!=='undefined'?require('./data.js'):root.METRO_DATA;
  // v7 · mode 2 «the metro» — build once, then watch it grow (2026-10-13, third rule set; the lead: what changes over
  // the years is WHERE people go — a destination that becomes easy to reach draws more people, and the metro is
  // discovered by word of mouth). Everything is counted in blocks; five rules:
  //   1 where to go: a destination's pull = its attraction − the blocks to get there (car, foot or metro, whichever
  //     is quickest); people split over the destinations and «somewhere nearby» (a fixed pull) in proportion to pull.
  //   2 how to go: of those going somewhere, every block the metro saves on the quicker of car and walking brings one
  //     in ten to the metro.
  //   2½ going on: of the people who reach a destination, some go on to the other one — the same two rules again:
  //     pull = the other's attraction − the blocks between them, split against «done, home» (`stay`, fixed); then
  //     blocks saved → tenths by metro. Two centres that need each other: a line between them carries this traffic.
  //   3 only people who know the metro choose this way; the others go where they always went, by car or on foot.
  //     At the opening `aware.start` of every estate know it.
  //   4 word of mouth: each year, whatever share of an estate rides the metro, that share of the people who don't
  //     know it yet hear of it (× `aware.spread`).
  //   5 crowding: a section (between two neighbouring cells) carries `trains` × `perTrain` a day; a metro trip that
  //     runs through a crowded section counts `crowdBlocks` more the year after (once, however many sections).
  // Walking is slow: `walkPer` (2) blocks for every cell walked. A trip by metro = walk to a station + wait + 1 for
  // every station passed + walk from the station; by car = the cells apart + the destination's parking and access
  // (carExtra); on foot = the cells apart × walkPer. The line, its stations and its trains are bought once, before
  // opening, within the budget. Score: metro riders a day, every year added up.
  const P={walkPer:2,wait:2,lineCost:1,stationCost:3,trainCost:4,perTrain:40,budget:30,years:8,crowdBlocks:2,
    aware:{start:.2,spread:1.5},nearby:15,stay:0,target:0,highScore:0,masterScore:0};
  const key=c=>c.join(','),same=(a,b)=>a&&b&&a[0]===b[0]&&a[1]===b[1];
  const walk=(a,b)=>Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]);
  const adj=(a,b)=>walk(a,b)===1;
  // rivers (2026-10-15, the level editor): a level with `waterBlocksWalk` walks round its `water` cells (the shortest
  // way on the grid; a place on the water can be reached, not walked through); cars and the metro still cross. Without
  // it walking is cells apart, as before — the existing levels do not change.
  let wetFoot=null;
  const footReset=()=>{wetFoot=D.waterBlocksWalk&&(D.water||[]).length?{wet:new Set(D.water.map(key)),from:new Map()}:null;};
  function footCells(a,b){if(!wetFoot)return walk(a,b);const W=D.cols,H=D.rows;let d=wetFoot.from.get(key(a));
    if(!d){d=new Int16Array(W*H).fill(-1);const q=[a];d[a[1]*W+a[0]]=0;
      for(let h=0;h<q.length;h++){const c=q[h],v=d[c[1]*W+c[0]];
        for(const n of [[c[0]+1,c[1]],[c[0]-1,c[1]],[c[0],c[1]+1],[c[0],c[1]-1]]){if(n[0]<0||n[1]<0||n[0]>=W||n[1]>=H||d[n[1]*W+n[0]]>=0)continue;
          d[n[1]*W+n[0]]=v+1;if(!wetFoot.wet.has(key(n)))q.push(n);}}
      wetFoot.from.set(key(a),d);}
    const v=b[0]>=0&&b[1]>=0&&b[0]<W&&b[1]<H?d[b[1]*W+b[0]]:-1;return v>=0?v:99;}
  function reset(){footReset();for(const k of ['walkPer','wait','lineCost','stationCost','trainCost','perTrain','budget','years','crowdBlocks','nearby','stay'])P[k]=D[k]??({stay:0})[k]??P[k];
    if(D.aware)P.aware={...P.aware,...D.aware};[P.target,P.highScore,P.masterScore]=D.tiers||[0,0,0];}
  reset();
  // the fastest metro trip from estate i to destination k: the station pair with the fewest blocks (sections that were
  // crowded last year add crowdBlocks to a trip that runs through them — once, however many)
  function metroTrip(i,k,line,stations,crowdedBefore=[]){return tripBetween(D.origins[i].cell,D.destinations[k].cell,line,stations,crowdedBefore);}
  function tripBetween(o,d,line,stations,crowdedBefore=[]){
    const order=stations.map(s=>({x:line.findIndex(c=>same(c,s)),c:s})).sort((a,b)=>a.x-b.x);
    let b=null;
    order.forEach((a,ia)=>order.forEach((z,iz)=>{if(ia===iz)return;
      const lo=Math.min(a.x,z.x),hi=Math.max(a.x,z.x);let crowd=0;for(let j=lo;j<hi;j++)if(crowdedBefore[j])crowd=P.crowdBlocks;
      const wa=footCells(o,a.c),wz=footCells(z.c,d),pass=Math.abs(iz-ia)-1,blocks=P.walkPer*(wa+wz)+P.wait+pass+crowd;
      if(!b||blocks<b.blocks)b={from:a.c,to:z.c,fx:a.x,tx:z.x,walkA:wa,pass,walkB:wz,crowd,blocks};}));
    return b;
  }
  // by car: the blocks apart + the destination's parking and access (`carExtra`, 2 if not given)
  const carBlocks=(i,k)=>walk(D.origins[i].cell,D.destinations[k].cell)+(D.destinations[k].carExtra??2);
  // on foot all the way: the cells apart × walkPer
  const footBlocks=(i,k)=>P.walkPer*footCells(D.origins[i].cell,D.destinations[k].cell);
  // going on from destination a to destination b, given the blocks between them: pull against «done, home»
  function onward(a,b,blocks){const pull=Math.max(0,D.destinations[b].attraction-blocks);return{pull,share:pull+P.stay>0?pull/(pull+P.stay):0};}
  // shares of estate i over the destinations and «nearby» (last), given the blocks to each destination
  function split(i,blocks){const pulls=D.destinations.map((d,k)=>Math.max(0,d.attraction-blocks[k])),all=pulls.reduce((a,b)=>a+b,0)+P.nearby;
    return{pulls,shares:pulls.map(p=>p/all),nearby:P.nearby/all};}
  // one year: who knows the metro, where everyone goes and how, the load on every section
  function year(line,stations,aware,trains,crowdedBefore=[]){
    // the legs between destinations (a → b): blocks by car, on foot, by metro — the same for everyone
    const pairs=[];if(P.stay>0)D.destinations.forEach((da,a)=>D.destinations.forEach((db,b)=>{if(a===b)return;
      const dist=walk(da.cell,db.cell),car=dist+(db.carExtra??2),foot=P.walkPer*footCells(da.cell,db.cell),alt=Math.min(car,foot);
      const trip=stations.length>=2?tripBetween(da.cell,db.cell,line,stations,crowdedBefore):null,save=trip?Math.max(0,alt-trip.blocks):0;
      pairs.push({a,b,k:b,car,foot,alt,byFoot:foot<car,trip,save,tenths:Math.min(10,save),shareNow:onward(a,b,trip?Math.min(alt,trip.blocks):alt).share,shareBefore:onward(a,b,alt).share});}));
    const est=D.origins.map((o,i)=>{
      const car=D.destinations.map((d,k)=>carBlocks(i,k)),foot=D.destinations.map((d,k)=>footBlocks(i,k)),alt=car.map((c,k)=>Math.min(c,foot[k]));
      const trip=D.destinations.map((d,k)=>stations.length>=2?metroTrip(i,k,line,stations,crowdedBefore):null);
      const fast=alt.map((b,k)=>trip[k]?Math.min(b,trip[k].blocks):b);
      const before=split(i,alt),now=split(i,fast),a=aware[i],n=o.people;
      const to=D.destinations.map((d,k)=>{const save=trip[k]?Math.max(0,alt[k]-trip[k].blocks):0,tenths=Math.min(10,save);
        const knowGo=n*a*now.shares[k],dontGo=n*(1-a)*before.shares[k],go=knowGo+dontGo,metro=knowGo*tenths/10,byFoot=foot[k]<car[k];
        return{k,car:car[k],foot:foot[k],alt:alt[k],byFoot,trip:trip[k],save,tenths,before:n*before.shares[k],knowGo,dontGo,go,metro,
          walkers:byFoot?go-metro:0,drivers:byFoot?0:go-metro,pull:now.pulls[k],pullBefore:before.pulls[k]};});
      // going on: those who know the metro decide with it, the others as before
      const chain=pairs.map(q=>{const x=to[q.a],knowGo=x.knowGo*q.shareNow,dontGo=x.dontGo*q.shareBefore;
        return{knowGo,dontGo,go:knowGo+dontGo,metro:knowGo*q.tenths/10,before:x.before*q.shareBefore};});
      const direct=to.reduce((s,x)=>s+x.metro,0),onMetro=chain.reduce((s,c)=>s+c.metro,0),metro=direct+onMetro;
      return{i,n,aware:a,to,chain,nearby:n*(a*now.nearby+(1-a)*before.nearby),nearbyBefore:n*before.nearby,direct,onward:onMetro,metro,share:metro/n};});
    const chain=pairs.map((q,j)=>{const sum=f=>est.reduce((s,e)=>s+e.chain[j][f],0),go=sum('go'),metro=sum('metro');
      return{...q,go,metro,before:sum('before'),knowGo:sum('knowGo'),dontGo:sum('dontGo'),walkers:q.byFoot?go-metro:0,drivers:q.byFoot?0:go-metro};});
    const load=Array(Math.max(0,line.length-1)).fill(0),cap=trains*P.perTrain;
    for(const x of [...est.flatMap(e=>e.to),...chain])if(x.metro&&x.trip)for(let j=Math.min(x.trip.fx,x.trip.tx);j<Math.max(x.trip.fx,x.trip.tx);j++)load[j]+=x.metro;
    const crowded=load.map(v=>v>cap+1e-9),riders=est.reduce((s,e)=>s+e.metro,0);
    const into=(k,f)=>chain.filter(q=>q.b===k).reduce((s,q)=>s+q[f],0);
    const dest=D.destinations.map((d,k)=>({k,before:est.reduce((s,e)=>s+e.to[k].before,0)+into(k,'before'),go:est.reduce((s,e)=>s+e.to[k].go,0)+into(k,'go'),
      metro:est.reduce((s,e)=>s+e.to[k].metro,0)+into(k,'metro'),onward:into(k,'go')}));
    return{est,chain,dest,load,cap,crowded,riders,people:D.origins.reduce((s,o)=>s+o.people,0)};
  }
  // word of mouth: the share of the estate on the metro tells that share of those who don't know yet
  const spread=(y,aware)=>y.est.map((e,i)=>Math.min(1,aware[i]+Math.min(1,P.aware.spread*e.share)*(1-aware[i])));
  // the plan: bought once before opening; then the years run
  class Plan {
    constructor(){Object.assign(this,{line:[],stations:[],trains:1,money:P.budget,year:0,aware:D.origins.map(()=>P.aware.start),crowded:[],log:[],total:0,done:false});}
    get open(){return this.year>0;}
    inside(c){return c[0]>=0&&c[1]>=0&&c[0]<D.cols&&c[1]<D.rows;}
    onLine(c){return this.line.some(x=>same(x,c));}
    isStation(c){return this.stations.some(x=>same(x,c));}
    canExtend(c){if(this.open||!this.inside(c)||this.onLine(c)||this.money<P.lineCost)return false;if(!this.line.length)return true;return adj(c,this.line[0])||adj(c,this.line.at(-1));}
    extend(c){if(!this.canExtend(c))return false;if(!this.line.length||adj(c,this.line.at(-1)))this.line.push(c.slice());else this.line.unshift(c.slice());this.money-=P.lineCost;return true;}
    isEnd(c){return this.line.length>0&&(same(c,this.line[0])||same(c,this.line.at(-1)));}
    canShorten(c){return !this.open&&this.isEnd(c);}
    shorten(c){if(!this.canShorten(c))return false;if(same(c,this.line.at(-1)))this.line.pop();else this.line.shift();
      if(this.isStation(c)){this.stations=this.stations.filter(s=>!same(s,c));this.money+=P.stationCost;}this.money+=P.lineCost;return true;}
    canStation(c){return !this.open&&this.onLine(c)&&!this.isStation(c)&&this.money>=P.stationCost;}
    toggleStation(c){if(this.open)return false;if(this.isStation(c)){this.stations=this.stations.filter(s=>!same(s,c));this.money+=P.stationCost;return true;}
      if(!this.canStation(c))return false;this.stations.push(c.slice());this.money-=P.stationCost;return true;}
    canTrain(){return !this.open&&this.money>=P.trainCost;}
    addTrain(){if(!this.canTrain())return false;this.trains++;this.money-=P.trainCost;return true;}
    canUntrain(){return !this.open&&this.trains>1;}
    removeTrain(){if(!this.canUntrain())return false;this.trains--;this.money+=P.trainCost;return true;}
    clear(){if(this.open)return false;Object.assign(this,{line:[],stations:[],trains:1,money:P.budget});return true;}
    // the coming year (or year 1 before opening)
    now(){return year(this.line,this.stations,this.aware,this.trains,this.crowded);}
    // what it would come to if everybody knew the metro and nothing were crowded (the line's potential)
    potential(){return year(this.line,this.stations,D.origins.map(()=>1),this.trains,[]);}
    withStation(c){const s=this.isStation(c)?this.stations.filter(x=>!same(x,c)):[...this.stations,c];return year(this.line,s,this.aware,this.trains,this.crowded);}
    canRun(){return !this.done&&this.stations.length>=2;}
    runYear(){if(!this.canRun())return null;
      const y=this.now(),before=this.aware.slice();this.year++;this.total+=y.riders;this.aware=spread(y,this.aware);this.crowded=y.crowded.slice();
      const entry={year:this.year,riders:y.riders,before,after:this.aware.slice(),crowdedSections:y.crowded.filter(Boolean).length,dest:y.dest.map(d=>({go:d.go,metro:d.metro,before:d.before}))};
      this.log.push(entry);if(this.year>=P.years)this.done=true;return{...entry,y};}
    // back to the plan (to adjust it and run again)
    rewind(){Object.assign(this,{year:0,aware:D.origins.map(()=>P.aware.start),crowded:[],log:[],total:0,done:false});}
    // the whole run at once (bots, the «expected» line)
    simulate(){const p=new Plan();Object.assign(p,JSON.parse(JSON.stringify({...this})));p.rewind();while(!p.done)p.runYear();return p;}
  }
  const API={D,P,Plan,year,spread,metroTrip,tripBetween,onward,carBlocks,footBlocks,footCells,split,walk,same,key,adj,reset};
  if(typeof module!=='undefined')module.exports=API;root.Metro=API;
})(typeof window!=='undefined'?window:globalThis);
