(function(root) {
  'use strict';
  // v7 · mode 4 «station-side development» (2026-10-14, task 50) — mode 2's rules (where to go, how to go, word of mouth,
  // crowding, going on between centres, walking; the line built once, fixed once open) plus the land beside the stations:
  //   land      vacant cells (D.land) within the ring of 8 around a station can be sold, at most 2 a year, from year 0;
  //             a sale is locked when the year is run and takes effect from the next year
  //   homes     a sold home lot becomes a small estate of `homePeople` people who all know the line (aware 1)
  //   shops     a station's shop lots make one destination «station N shops»: attraction shopBase + shopPer × lots,
  //             carExtra 5; it also takes part in going on between centres
  //   prices    home = homeRate × Σ max(0, attraction − fastest blocks from the lot) («how handy is it to live here»);
  //             shop = shopRate × (people a day coming to that station's shops with the lot − without), with today's
  //             awareness; both counted at the moment of sale, once
  //   crowding  learnt, as in mode 3: each year a section's felt crowding moves `learn` of the way to crowdBlocks (crowded)
  //             or 0 — mode 2's all-or-nothing next-year penalty made riders saw-tooth once homes filled the line
  // Score (the MTR's ledger): Σ daily metro riders over the years (fares, as mode 2's score) + Σ land sold.
  const D=typeof module!=='undefined'?require('./data.js'):root.TOD_DATA;
  const P={walkPer:2,wait:2,lineCost:1,stationCost:3,trainCost:4,perTrain:40,budget:40,years:8,crowdBlocks:4,learn:.3,
    aware:{start:.2,spread:2},nearby:10,stay:40,homePeople:16,shopBase:4,shopPer:6,carExtra:5,homeRate:1,shopRate:.5,
    target:0,highScore:0,masterScore:0};
  const key=c=>c.join(','),same=(a,b)=>a&&b&&a[0]===b[0]&&a[1]===b[1];
  const walk=(a,b)=>Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]),adj=(a,b)=>walk(a,b)===1;
  function reset(){
    for(const k of ['walkPer','wait','lineCost','stationCost','trainCost','perTrain','budget','years','crowdBlocks','learn','nearby','stay','homePeople','shopBase','shopPer','carExtra','homeRate','shopRate'])P[k]=D[k]??P[k];
    if(D.aware)P.aware={...P.aware,...D.aware};
    [P.target,P.highScore,P.masterScore]=D.tiers||[0,0,0];
  }
  reset();
  function originsFor(sales=[]){
    const out=D.origins.map(o=>({...o,cell:o.cell.slice()}));let n=0;
    for(const s of sales)if(s.use==='home'){n++;out.push({name:'Station homes',hans:'Station homes',cell:s.cell.slice(),house:[0,1],people:P.homePeople,home:true,aware:1,landIndex:s.landIndex});}
    return out;
  }
  function destinationsFor(sales=[]){
    const out=D.destinations.map(d=>({...d,cell:d.cell.slice()})),shops=new Map();
    for(const s of sales)if(s.use==='shop'){
      const k=key(s.station),g=shops.get(k)||{station:s.station.slice(),stationNo:s.stationNo,count:0};g.count++;shops.set(k,g);
    }
    for(const g of shops.values())out.push({name:'Station mall',hans:'Station mall',short:'Mall',shortHans:'Mall',kind:'shop',cell:g.station,
      station:g.station.slice(),stationNo:g.stationNo,shopCount:g.count,attraction:P.shopBase+P.shopPer*g.count,carExtra:P.carExtra});
    return out;
  }
  function awareFor(origins,aware=[]){return origins.map((o,i)=>o.home?1:(aware[i]??P.aware.start));}
  function tripBetween(o,d,line,stations,crowdedBefore=[]){
    const order=stations.map(s=>({x:line.findIndex(c=>same(c,s)),c:s})).sort((a,b)=>a.x-b.x);let best=null;
    order.forEach((a,ia)=>order.forEach((z,iz)=>{
      if(ia===iz)return;const lo=Math.min(a.x,z.x),hi=Math.max(a.x,z.x);let crowd=0;
      for(let j=lo;j<hi;j++)crowd=Math.max(crowd,+crowdedBefore[j]||0);
      const wa=walk(o,a.c),wz=walk(z.c,d),pass=Math.abs(iz-ia)-1,blocks=P.walkPer*(wa+wz)+P.wait+pass+crowd;
      if(!best||blocks<best.blocks)best={from:a.c,to:z.c,fx:a.x,tx:z.x,walkA:wa,pass,walkB:wz,crowd,blocks};
    }));
    return best;
  }
  const metroTrip=(i,k,line,stations,crowdedBefore=[])=>tripBetween(D.origins[i].cell,D.destinations[k].cell,line,stations,crowdedBefore);
  const carBlocks=(i,k)=>walk(D.origins[i].cell,D.destinations[k].cell)+(D.destinations[k].carExtra??2);
  const footBlocks=(i,k)=>P.walkPer*walk(D.origins[i].cell,D.destinations[k].cell);
  function onward(a,b,blocks,destinations=D.destinations){const pull=Math.max(0,destinations[b].attraction-blocks);return{pull,share:pull+P.stay>0?pull/(pull+P.stay):0};}
  function split(i,blocks,destinations=D.destinations){
    const pulls=destinations.map((d,k)=>Math.max(0,d.attraction-blocks[k])),all=pulls.reduce((a,b)=>a+b,0)+P.nearby;
    return{pulls,shares:pulls.map(p=>p/all),nearby:P.nearby/all};
  }
  function year(line,stations,aware,trains,crowdedBefore=[],sales=[]){
    const origins=originsFor(sales),destinations=destinationsFor(sales),known=awareFor(origins,aware),pairs=[];
    if(P.stay>0)destinations.forEach((da,a)=>destinations.forEach((db,b)=>{
      if(a===b)return;const dist=walk(da.cell,db.cell),car=dist+(db.carExtra??2),foot=P.walkPer*dist,alt=Math.min(car,foot);
      const trip=stations.length>=2?tripBetween(da.cell,db.cell,line,stations,crowdedBefore):null,save=trip?Math.max(0,alt-trip.blocks):0;
      pairs.push({a,b,k:b,car,foot,alt,byFoot:foot<car,trip,save,tenths:Math.min(10,save),
        shareNow:onward(a,b,trip?Math.min(alt,trip.blocks):alt,destinations).share,shareBefore:onward(a,b,alt,destinations).share});
    }));
    const est=origins.map((o,i)=>{
      const car=destinations.map(d=>walk(o.cell,d.cell)+(d.carExtra??2)),foot=destinations.map(d=>P.walkPer*walk(o.cell,d.cell)),alt=car.map((c,k)=>Math.min(c,foot[k]));
      const trip=destinations.map(d=>stations.length>=2?tripBetween(o.cell,d.cell,line,stations,crowdedBefore):null),fast=alt.map((b,k)=>trip[k]?Math.min(b,trip[k].blocks):b);
      const before=split(i,alt,destinations),now=split(i,fast,destinations),a=known[i],n=o.people;
      const to=destinations.map((d,k)=>{
        const save=trip[k]?Math.max(0,alt[k]-trip[k].blocks):0,tenths=Math.min(10,save),knowGo=n*a*now.shares[k],dontGo=n*(1-a)*before.shares[k];
        const go=knowGo+dontGo,metro=knowGo*tenths/10,byFoot=foot[k]<car[k];
        return{k,car:car[k],foot:foot[k],alt:alt[k],byFoot,trip:trip[k],save,tenths,before:n*before.shares[k],knowGo,dontGo,go,metro,
          walkers:byFoot?go-metro:0,drivers:byFoot?0:go-metro,pull:now.pulls[k],pullBefore:before.pulls[k]};
      });
      const chain=pairs.map(q=>{const x=to[q.a],knowGo=x.knowGo*q.shareNow,dontGo=x.dontGo*q.shareBefore;
        return{knowGo,dontGo,go:knowGo+dontGo,metro:knowGo*q.tenths/10,before:x.before*q.shareBefore};});
      const direct=to.reduce((s,x)=>s+x.metro,0),onMetro=chain.reduce((s,c)=>s+c.metro,0),metro=direct+onMetro;
      return{i,n,origin:o,aware:a,to,chain,nearby:n*(a*now.nearby+(1-a)*before.nearby),nearbyBefore:n*before.nearby,direct,onward:onMetro,metro,share:n?metro/n:0};
    });
    const chain=pairs.map((q,j)=>{
      const sum=f=>est.reduce((s,e)=>s+e.chain[j][f],0),go=sum('go'),metro=sum('metro');
      return{...q,go,metro,before:sum('before'),knowGo:sum('knowGo'),dontGo:sum('dontGo'),walkers:q.byFoot?go-metro:0,drivers:q.byFoot?0:go-metro};
    });
    const load=Array(Math.max(0,line.length-1)).fill(0),cap=trains*P.perTrain;
    for(const x of [...est.flatMap(e=>e.to),...chain])if(x.metro&&x.trip)for(let j=Math.min(x.trip.fx,x.trip.tx);j<Math.max(x.trip.fx,x.trip.tx);j++)load[j]+=x.metro;
    const crowded=load.map(v=>v>cap+1e-9),riders=est.reduce((s,e)=>s+e.metro,0),into=(k,f)=>chain.filter(q=>q.b===k).reduce((s,q)=>s+q[f],0);
    const dest=destinations.map((d,k)=>({k,kind:d.kind,stationNo:d.stationNo,before:est.reduce((s,e)=>s+e.to[k].before,0)+into(k,'before'),
      go:est.reduce((s,e)=>s+e.to[k].go,0)+into(k,'go'),metro:est.reduce((s,e)=>s+e.to[k].metro,0)+into(k,'metro'),onward:into(k,'go')}));
    return{est,chain,dest,load,cap,crowded,riders,people:origins.reduce((s,o)=>s+o.people,0),origins,destinations};
  }
  function spread(y,aware){return y.est.map((e,i)=>e.origin.home?1:Math.min(1,aware[i]+Math.min(1,P.aware.spread*e.share)*(1-aware[i])));}
  function landStation(stations,line,cell){
    const ordered=stations.map((s,i)=>({s,i,d:Math.max(Math.abs(s[0]-cell[0]),Math.abs(s[1]-cell[1])),x:line.findIndex(c=>same(c,s))})).sort((a,b)=>a.x-b.x);
    const hit=ordered.find(q=>q.d===1);return hit?{...hit,no:ordered.indexOf(hit)+1}:null;
  }
  function landQuote(plan,cell,use,stationInfo){
    const sales=plan.allSales(),station=stationInfo?stationInfo.s:landStation(plan.stations,plan.line,cell)?.s;if(!station)return{ok:false,price:0,visitors:0};
    if(use==='home'){
      const ds=destinationsFor(sales);let value=0;
      for(const d of ds){const dist=walk(cell,d.cell),car=dist+(d.carExtra??2),foot=P.walkPer*dist;let fastest=Math.min(car,foot);
        if(plan.stations.length>=2){const mt=tripBetween(cell,d.cell,plan.line,plan.stations,plan.crowded);if(mt)fastest=Math.min(fastest,mt.blocks);}
        value+=Math.max(0,d.attraction-fastest);}
      return{ok:true,price:P.homeRate*value,visitors:0};
    }
    if(use==='shop'){
      const before=year(plan.line,plan.stations,plan.awareFor(sales),plan.trains,plan.crowded,sales);
      const candidate={use:'shop',cell:cell.slice(),station:station.slice(),stationNo:(stationInfo?.no??plan.stations.findIndex(c=>same(c,station))+1),
        landIndex:D.land.findIndex(q=>same(q.cell,cell))+1};
      const afterSales=sales.concat(candidate),after=year(plan.line,plan.stations,plan.awareFor(afterSales),plan.trains,plan.crowded,afterSales);
      const afterAt=after.destinations.findIndex(d=>d.kind==='shop'&&same(d.cell,station));
      const beforeVisitors=before.dest.find(d=>d.kind==='shop'&&same(before.destinations[d.k].cell,station))?.go||0;
      const visitors=afterAt>=0?after.dest[afterAt].go:0;
      return{ok:true,price:P.shopRate*(visitors-beforeVisitors),visitors,delta:visitors-beforeVisitors};
    }
    return{ok:false,price:0,visitors:0};
  }
  class Plan{
    constructor(){Object.assign(this,{line:[],stations:[],trains:1,money:P.budget,year:0,aware:D.origins.map(()=>P.aware.start),
      crowded:[],sales:[],pendingSales:[],landRevenue:0,log:[],total:0,done:false});}
    get open(){return this.year>0;}
    inside(c){return c[0]>=0&&c[1]>=0&&c[0]<D.cols&&c[1]<D.rows;}
    onLine(c){return this.line.some(x=>same(x,c));}
    isStation(c){return this.stations.some(x=>same(x,c));}
    canExtend(c){if(this.open||!this.inside(c)||this.onLine(c)||this.money<P.lineCost)return false;if(!this.line.length)return true;return adj(c,this.line[0])||adj(c,this.line.at(-1));}
    extend(c){if(!this.canExtend(c))return false;if(!this.line.length||adj(c,this.line.at(-1)))this.line.push(c.slice());else this.line.unshift(c.slice());this.money-=P.lineCost;return true;}
    isEnd(c){return this.line.length>0&&(same(c,this.line[0])||same(c,this.line.at(-1)));}
    canShorten(c){return !this.open&&this.isEnd(c);}
    shorten(c){if(!this.canShorten(c))return false;if(same(c,this.line.at(-1)))this.line.pop();else this.line.shift();if(this.isStation(c)){this.stations=this.stations.filter(s=>!same(s,c));this.money+=P.stationCost;}this.money+=P.lineCost;return true;}
    canStation(c){return !this.open&&this.onLine(c)&&!this.isStation(c)&&this.money>=P.stationCost;}
    toggleStation(c){if(this.open)return false;if(this.isStation(c)){this.stations=this.stations.filter(s=>!same(s,c));this.money+=P.stationCost;return true;}if(!this.canStation(c))return false;this.stations.push(c.slice());this.money-=P.stationCost;return true;}
    canTrain(){return !this.open&&this.money>=P.trainCost;}
    addTrain(){if(!this.canTrain())return false;this.trains++;this.money-=P.trainCost;return true;}
    canUntrain(){return !this.open&&this.trains>1;}
    removeTrain(){if(!this.canUntrain())return false;this.trains--;this.money+=P.trainCost;return true;}
    clear(){if(this.open)return false;Object.assign(this,{line:[],stations:[],trains:1,money:P.budget,year:0,aware:D.origins.map(()=>P.aware.start),
      crowded:[],sales:[],pendingSales:[],landRevenue:0,log:[],total:0,done:false});return true;}
    allSales(){return this.sales.concat(this.pendingSales);}
    awareFor(sales=this.allSales()){return awareFor(originsFor(sales),this.aware);}
    stationForLand(c){return landStation(this.stations,this.line,c);}
    isSold(c){return this.allSales().some(s=>same(s.cell,c));}
    canSell(c){return !this.done&&this.year<P.years&&this.pendingSales.length<2&&D.land.some(q=>same(q.cell,c))&&!this.onLine(c)&&!this.isSold(c)&&!!this.stationForLand(c);}
    quote(c,use){return this.canSell(c)?landQuote(this,c,use,this.stationForLand(c)):{ok:false,price:0,visitors:0};}
    sellLand(c,use){if(!this.canSell(c)||!['home','shop'].includes(use))return null;const si=this.stationForLand(c),q=landQuote(this,c,use,si);
      const sale={cell:c.slice(),use,station:si.s.slice(),stationNo:si.no,landIndex:D.land.findIndex(q=>same(q.cell,c))+1,year:this.year+1,price:q.price,visitors:q.visitors};
      this.pendingSales.push(sale);return sale;}
    cancelSale(c){const i=this.pendingSales.findIndex(s=>same(s.cell,c));if(i<0)return false;this.pendingSales.splice(i,1);return true;}
    now(){const sales=this.allSales();return year(this.line,this.stations,this.awareFor(sales),this.trains,this.crowded,sales);}
    potential(){const sales=this.allSales(),origins=originsFor(sales);return year(this.line,this.stations,origins.map(()=>1),this.trains,[],sales);}
    previewSale(c,use){const sales=this.allSales(),si=this.stationForLand(c);if(!si||this.isSold(c))return this.now();const q=landQuote(this,c,use,si);
      const candidate={cell:c.slice(),use,station:si.s.slice(),stationNo:si.no,landIndex:D.land.findIndex(x=>same(x.cell,c))+1,year:this.year+1,price:q.price,visitors:q.visitors};
      const all=sales.concat(candidate),origins=originsFor(all);return year(this.line,this.stations,awareFor(origins,this.aware),this.trains,this.crowded,all);}
    withStation(c){const s=this.isStation(c)?this.stations.filter(x=>!same(x,c)):[...this.stations,c];return year(this.line,s,this.awareFor(),this.trains,this.crowded,this.allSales());}
    canRun(){return !this.done&&this.stations.length>=2;}
    runYear(){if(!this.canRun())return null;const committing=this.pendingSales.slice(),sales=this.sales.concat(committing),origins=originsFor(sales),before=awareFor(origins,this.aware);
      const y=year(this.line,this.stations,before,this.trains,this.crowded,sales),revenue=committing.reduce((s,x)=>s+x.price,0);
      this.sales=sales;this.pendingSales=[];this.year++;this.total+=y.riders+revenue;this.landRevenue+=revenue;this.aware=spread(y,before);this.crowded=y.crowded.map((c,j)=>{const f=+this.crowded[j]||0;return f+P.learn*((c?P.crowdBlocks:0)-f);});
      const entry={year:this.year,riders:y.riders,revenue,landRevenue:this.landRevenue,ledger:this.total,before,after:this.aware.slice(),crowdedSections:y.crowded.filter(Boolean).length,
        sales:committing.map(s=>({...s,cell:s.cell.slice(),station:s.station.slice()})),
        dest:y.dest.map(d=>({kind:d.kind,stationNo:d.stationNo,go:d.go,metro:d.metro,before:d.before}))};
      this.log.push(entry);if(this.year>=P.years)this.done=true;return{...entry,y};}
    rewind(){Object.assign(this,{year:0,aware:D.origins.map(()=>P.aware.start),crowded:[],sales:[],pendingSales:[],landRevenue:0,log:[],total:0,done:false});}
    simulate(){
      const schedule=this.allSales().map((s,i)=>({cell:s.cell.slice(),use:s.use,year:s.year||1,order:i})).sort((a,b)=>a.year-b.year||a.order-b.order);
      const p=new Plan();Object.assign(p,JSON.parse(JSON.stringify({...this})));p.rewind();if(!p.canRun())return p;
      while(!p.done){const next=p.year+1;for(const a of schedule)if(a.year===next&&!p.sellLand(a.cell,a.use))throw new Error('Invalid sale in simulation: '+key(a.cell));if(!p.runYear())break;}
      return p;
    }
  }
  const API={D,P,Plan,year,spread,metroTrip,tripBetween,onward,carBlocks,footBlocks,split,walk,same,key,adj,originsFor,destinationsFor,landQuote,landStation,reset};
  if(typeof module!=='undefined')module.exports=API;
  root.TOD=API;
})(typeof window!=='undefined'?window:globalThis);
