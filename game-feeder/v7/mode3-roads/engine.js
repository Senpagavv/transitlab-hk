(function(root) {
  'use strict';
  const D=typeof module!=='undefined'?require('./data.js'):root.ROADS_DATA;
  // v7 · mode 3 «roads that jam» (2026-10-14) — mode 2's rules on a real map (Kowloon East), with the roads and the
  // metro lines already there. Everything is still counted in blocks. Mode 2's rules, unchanged:
  //   where to go (pull = attraction − blocks, against «nearby»), how to go (blocks saved → tenths by metro), going on
  //   between the two centres (against «done, home»), only people who know the new line use it, word of mouth,
  //   crowded sections cost `crowdBlocks` the year after.
  // New here:
  //   roads   a car trip follows the roads (a fixed route); every road section takes `cap` cars a day, and every
  //           section adds (cars ÷ cap)² blocks — full: +1, half again: +2¼.
  //   drivers learn slowly: the jam they reckon with this year = last year's reckoning + `learn` × (what they met last
  //           year − last year's reckoning). Fewer cars → the roads clear → driving looks better → some drive again.
  //   foot    those not on the metro walk the same way: every block walking saves on the car, one in ten walk.
  //   lines   the lines already there (觀塘綫, 將軍澳綫) everybody knows; changing lines = walk + wait again.
  //   crowding is learnt the same way: a section that was crowded counts toward `crowdBlocks`, a learnt amount
  //           (+ `learn` × (crowdBlocks or 0 − last year's)); a trip pays the most it meets, once.
  // The player adds one line (bought once, as in mode 2). Score: the jam taken off the roads — each year, «do nothing»'s
  // jam minus this year's, added up over the years; jam = Σ over road sections of cars × extra blocks.
  const P={walkPer:2,wait:2,lineCost:1,stationCost:3,trainCost:4,perTrain:40,budget:30,years:8,crowdBlocks:4,
    aware:{start:.2,spread:2},nearby:10,stay:40,learn:.5,target:0,highScore:0,masterScore:0};
  const NUM=['walkPer','wait','lineCost','stationCost','trainCost','perTrain','budget','years','crowdBlocks','nearby','stay','learn'];
  const key=c=>c.join(','),same=(a,b)=>a&&b&&a[0]===b[0]&&a[1]===b[1];
  const walk=(a,b)=>Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]);
  const adj=(a,b)=>walk(a,b)===1;
  // a polyline of waypoints → cells (each leg horizontal first, then vertical)
  function expand(via){const out=[via[0].slice()];
    for(let j=1;j<via.length;j++){let c=out.at(-1).slice();const t=via[j];
      while(c[0]!==t[0]){c=[c[0]+Math.sign(t[0]-c[0]),c[1]];out.push(c);}
      while(c[1]!==t[1]){c=[c[0],c[1]+Math.sign(t[1]-c[1])];out.push(c);}}
    return out;}
  const G={};   // derived from the level: road sections, car routes, the lines already there, «do nothing»
  /* ------------------------------------------------------------------ roads */
  function buildRoads(){
    const sec=new Map(),nodes=new Map();G.sections=[];
    for(const r of D.roads){const cells=expand(r.via);
      for(let j=1;j<cells.length;j++){const a=cells[j-1],b=cells[j],k=[key(a),key(b)].sort().join('|');
        if(!sec.has(k)){const s={id:G.sections.length,a,b,cap:r.cap,roads:[r.name]};sec.set(k,s);G.sections.push(s);}
        else{const s=sec.get(k);s.cap=Math.max(s.cap,r.cap);if(!s.roads.includes(r.name))s.roads.push(r.name);}
        for(const [x,y] of [[a,b],[b,a]]){if(!nodes.has(key(x)))nodes.set(key(x),{cell:x,out:[]});nodes.get(key(x)).out.push({to:key(y),s:sec.get(k).id});}}}
    G.roadNodes=nodes;
  }
  // a car trip: drive the local streets to a road (1 a cell, at most `reach` = 1 cell), along the roads (1 a section),
  // off to the destination; the shortest such route, fixed for the level
  function carRoute(o,d,reach=1){
    const dist=new Map(),prev=new Map(),q=[];
    for(const [k,n] of G.roadNodes){const w=walk(o,n.cell);if(w<=reach){dist.set(k,w);q.push(k);}}
    if(!q.length)return{local:walk(o,d),sections:[]};
    while(q.length){q.sort((a,b)=>dist.get(a)-dist.get(b));const k=q.shift(),n=G.roadNodes.get(k);
      for(const e of n.out){const v=dist.get(k)+1;if(!dist.has(e.to)||v<dist.get(e.to)){dist.set(e.to,v);prev.set(e.to,{k,s:e.s});if(!q.includes(e.to))q.push(e.to);}}}
    let best=null;for(const [k,n] of G.roadNodes){const w=walk(n.cell,d);if(w>reach||!dist.has(k))continue;const v=dist.get(k)+w;if(!best||v<best.v)best={k,v,w};}
    if(!best)return{local:walk(o,d),sections:[]};
    const sections=[];let k=best.k;while(prev.has(k)){const p=prev.get(k);sections.unshift(p.s);k=p.k;}
    return{local:best.v-sections.length,sections};
  }
  /* ------------------------------------------------------------------ metro networks */
  // the lines: the ones already there (data) and, when it has 2 stations, the player's
  function network(extra){
    const lines=[...G.lines,...(extra&&extra.stations.length>=2?[extra]:[])],nodes=[];
    lines.forEach((l,li)=>{l.stations.map(s=>({cell:s,idx:l.cells.findIndex(c=>same(c,s))})).filter(s=>s.idx>=0).sort((a,b)=>a.idx-b.idx)
      .forEach(s=>nodes.push({li,idx:s.idx,cell:s.cell,out:[]}));});
    nodes.forEach((n,i)=>nodes.forEach((m,j)=>{if(i===j)return;
      if(n.li===m.li){const own=nodes.filter(x=>x.li===n.li),a=own.indexOf(n),b=own.indexOf(m);if(Math.abs(a-b)===1)n.out.push({to:j,cost:1,ride:true});}
      else if(walk(n.cell,m.cell)<=1)n.out.push({to:j,cost:P.walkPer*walk(n.cell,m.cell)+P.wait-1,ride:false});}));
    return{lines,nodes};
  }
  // the quickest metro trip o → d: walk to a station + (wait − 1) + 1 a station hopped + [walk + (wait − 1) to change]
  // + walk from the station  (= walk + wait + stations passed + walk on one line); at least one ride
  function metroTrip(net,o,d,crowded){
    const N=net.nodes.length;if(!N)return null;
    const dist=[new Array(N).fill(Infinity),new Array(N).fill(Infinity)],prev=[new Array(N).fill(null),new Array(N).fill(null)],done=[new Array(N).fill(false),new Array(N).fill(false)];
    net.nodes.forEach((n,i)=>{dist[0][i]=P.walkPer*walk(o,n.cell)+P.wait-1;});
    for(;;){let bi=-1,bf=0,bv=Infinity;for(let f=0;f<2;f++)for(let i=0;i<N;i++)if(!done[f][i]&&dist[f][i]<bv){bv=dist[f][i];bi=i;bf=f;}
      if(bi<0)break;done[bf][bi]=true;
      for(const e of net.nodes[bi].out){if(!e.ride&&bf===0)continue;const v=bv+e.cost;if(v<dist[1][e.to]){dist[1][e.to]=v;prev[1][e.to]={i:bi,f:bf};}}}
    let best=null;net.nodes.forEach((n,i)=>{const v=dist[1][i]+P.walkPer*walk(n.cell,d);if(v<Infinity&&(!best||v<best.v))best={i,v};});
    if(!best)return null;
    const path=[];let s={i:best.i,f:1};while(s){path.unshift(s.i);s=prev[s.f][s.i];}
    const legs=[];for(let j=1;j<path.length;j++){const a=net.nodes[path[j-1]],b=net.nodes[path[j]];if(a.li!==b.li)continue;
      const last=legs.at(-1);if(last&&last.li===a.li&&last.to===a.idx)last.to=b.idx;else legs.push({li:a.li,from:a.idx,to:b.idx});}
    let crowd=0;for(const l of legs){const name=net.lines[l.li].name;for(let j=Math.min(l.from,l.to);j<Math.max(l.from,l.to);j++)crowd=Math.max(crowd,(crowded&&crowded[name]&&crowded[name][j])||0);}
    const first=net.nodes[path[0]],last=net.nodes[path.at(-1)];
    return{blocks:best.v+crowd,crowd,legs,from:first.cell,to:last.cell,walkA:walk(o,first.cell),walkB:walk(last.cell,d),changes:legs.length-1,
      usesNew:legs.some(l=>net.lines[l.li].isNew),lines:legs.map(l=>net.lines[l.li].name)};
  }
  /* ------------------------------------------------------------------ one year */
  const carExtra=k=>D.destinations[k].carExtra??2;
  const carBlocks=(route,k,perceived)=>route.local+route.sections.reduce((s,id)=>s+1+perceived[id],0)+carExtra(k);
  function split(i,blocks){const pulls=D.destinations.map((d,k)=>Math.max(0,d.attraction-blocks[k])),all=pulls.reduce((a,b)=>a+b,0)+P.nearby;
    return{pulls,shares:pulls.map(p=>p/all),nearby:P.nearby/all};}
  function onward(a,b,blocks){const pull=Math.max(0,D.destinations[b].attraction-blocks);return{pull,share:pull+P.stay>0?pull/(pull+P.stay):0};}
  // a trip between two places this year: by car (perceived jam), on foot, by the old network, by the network with the new line
  function legOf(route,k,from,to,netOld,netNew,perceived,crowded){
    const car=carBlocks(route,k,perceived),foot=P.walkPer*walk(from,to),alt=Math.min(car,foot);
    const tOld=metroTrip(netOld,from,to,crowded),tNew=netNew?metroTrip(netNew,from,to,crowded):tOld;
    const mo=tOld?tOld.blocks:Infinity,mn=tNew?tNew.blocks:Infinity,saveOld=Math.max(0,alt-mo),saveNew=Math.max(0,alt-mn);
    return{car,foot,alt,byFoot:foot<car,walkTenths:Math.min(10,Math.max(0,car-foot)),route,tOld,tNew,trip:tNew,fastOld:Math.min(alt,mo),fastNew:Math.min(alt,mn),
      tenthsOld:Math.min(10,saveOld),tenthsNew:Math.min(10,saveNew),save:saveNew,tenths:Math.min(10,saveNew)};
  }
  function year(plan,aware,perceived,crowded){
    const lineNew=plan&&plan.stations.length>=2?{name:'new',isNew:true,cells:plan.line,stations:plan.stations,trains:plan.trains}:null;
    const netOld=G.netOld,netNew=lineNew?network(lineNew):null,nets=netNew||netOld;
    const roadLoad=new Array(G.sections.length).fill(0),lineLoad={};for(const l of nets.lines)lineLoad[l.name]=new Array(Math.max(0,l.cells.length-1)).fill(0);
    const ride=(t,n)=>{if(!t||!n)return;for(const l of t.legs){const name=nets.lines[l.li]?.name;const arr=lineLoad[name];if(!arr)continue;for(let j=Math.min(l.from,l.to);j<Math.max(l.from,l.to);j++)arr[j]+=n;}};
    const drive=(route,n)=>{if(n>0)for(const id of route.sections)roadLoad[id]+=n;};
    // map an old-network trip onto the line names of the network in use (same names), so loads add up
    const pairs=[];if(P.stay>0)D.destinations.forEach((da,a)=>D.destinations.forEach((db,b)=>{if(a===b)return;
      const L=legOf(G.carDD[a][b],b,da.cell,db.cell,netOld,netNew,perceived,crowded);
      pairs.push({a,b,k:b,...L,shareNow:onward(a,b,L.fastNew).share,shareBefore:onward(a,b,L.fastOld).share});}));
    const est=D.origins.map((o,i)=>{
      const legs=D.destinations.map((d,k)=>legOf(G.carOD[i][k],k,o.cell,d.cell,netOld,netNew,perceived,crowded));
      const before=split(i,legs.map(l=>l.fastOld)),now=split(i,legs.map(l=>l.fastNew)),a=aware[i],n=o.people;
      const to=legs.map((L,k)=>{const knowGo=n*a*now.shares[k],dontGo=n*(1-a)*before.shares[k],go=knowGo+dontGo;
        const mKnow=knowGo*L.tenthsNew/10,mDont=dontGo*L.tenthsOld/10,metro=mKnow+mDont,rest=go-metro;
        const walkers=rest*L.walkTenths/10,drivers=rest-walkers;ride(L.tNew,mKnow);ride(L.tOld,mDont);drive(L.route,drivers);
        return{k,...L,knowGo,dontGo,go,metro,onNew:L.tNew&&L.tNew.usesNew?mKnow:0,walkers,drivers,
          before:G.base?G.base.est[i].to[k].go:go,pull:now.pulls[k]};});
      const chain=pairs.map(q=>{const x=to[q.a],knowGo=x.knowGo*q.shareNow,dontGo=x.dontGo*q.shareBefore,go=knowGo+dontGo;
        const mKnow=knowGo*q.tenthsNew/10,mDont=dontGo*q.tenthsOld/10,metro=mKnow+mDont,rest=go-metro;
        const walkers=rest*q.walkTenths/10,drivers=rest-walkers;ride(q.tNew,mKnow);ride(q.tOld,mDont);drive(q.route,drivers);
        return{knowGo,dontGo,go,metro,onNew:q.tNew&&q.tNew.usesNew?mKnow:0,drivers,walkers};});
      const sum=(arr,f)=>arr.reduce((s,x)=>s+x[f],0);
      const metro=sum(to,'metro')+sum(chain,'metro'),onNew=sum(to,'onNew')+sum(chain,'onNew'),drivers=sum(to,'drivers')+sum(chain,'drivers');
      return{i,n,aware:a,to,chain,nearby:n*(a*now.nearby+(1-a)*before.nearby),metro,onNew,drivers,share:onNew/n};});
    const chain=pairs.map((q,j)=>{const s=f=>est.reduce((t,e)=>t+e.chain[j][f],0);
      return{...q,go:s('go'),metro:s('metro'),onNew:s('onNew'),drivers:s('drivers'),walkers:s('walkers'),before:G.base?G.base.chain[j].go:s('go')};});
    // roads: this year's jam
    const extra=roadLoad.map((v,id)=>(v/G.sections[id].cap)**2),jam=roadLoad.reduce((s,v,id)=>s+v*extra[id],0);
    // lines: load, room, crowding
    const lines=nets.lines.map(l=>{const cap=l.trains*P.perTrain,load=lineLoad[l.name];return{name:l.name,isNew:!!l.isNew,cap,load,crowded:load.map(v=>v>cap+1e-9)};});
    const crowdedNext={};for(const l of lines)crowdedNext[l.name]=l.crowded;
    const into=(k,f)=>chain.filter(q=>q.b===k).reduce((s,q)=>s+q[f],0);
    const dest=D.destinations.map((d,k)=>({k,go:est.reduce((s,e)=>s+e.to[k].go,0)+into(k,'go'),metro:est.reduce((s,e)=>s+e.to[k].metro,0)+into(k,'metro'),
      before:G.base?G.base.dest[k].go:0}));
    const sum=f=>est.reduce((s,e)=>s+e[f],0);
    return{est,chain,dest,roadLoad,extra,jam,lines,crowded:crowdedNext,riders:sum('metro'),onNew:sum('onNew'),drivers:sum('drivers'),
      people:D.origins.reduce((s,o)=>s+o.people,0)};
  }
  const spread=(y,aware)=>y.est.map((e,i)=>Math.min(1,aware[i]+Math.min(1,P.aware.spread*e.share)*(1-aware[i])));
  const learnFrom=(perceived,y)=>perceived.map((p,id)=>p+P.learn*(y.extra[id]-p));
  // the crowding people reckon with, per line section: learnt toward crowdBlocks where it was crowded, toward 0 elsewhere
  const learnCrowd=(felt,y)=>{const out={};for(const l of y.lines){const was=felt[l.name]||[];out[l.name]=l.crowded.map((c,j)=>{const f=was[j]||0;return f+P.learn*((c?P.crowdBlocks:0)-f);});}return out;};
  /* ------------------------------------------------------------------ the level */
  function reset(){
    for(const k of NUM)if(D[k]!==undefined)P[k]=D[k];if(D.aware)P.aware={...P.aware,...D.aware};[P.target,P.highScore,P.masterScore]=D.tiers||[0,0,0];
    buildRoads();
    G.carOD=D.origins.map(o=>D.destinations.map(d=>carRoute(o.cell,d.cell)));
    G.carDD=D.destinations.map(a=>D.destinations.map(b=>carRoute(a.cell,b.cell)));
    G.lines=(D.lines||[]).map(l=>({name:l.name,hans:l.hans,color:l.color,cells:expand(l.via),stations:l.stations,names:l.names,namesHans:l.namesHans,trains:l.trains}));
    G.netOld=network(null);G.base=null;
    // «do nothing»: let today's roads settle (drivers learn until the jam they reckon with is the jam they meet)
    let per=G.sections.map(()=>0),crowd={},y=null;const aware0=D.origins.map(()=>0);
    for(let it=0;it<300;it++){y=year(null,aware0,per,crowd);const next=learnFrom(per,y);const gap=Math.max(0,...next.map((v,j)=>Math.abs(v-per[j])));per=next;crowd=learnCrowd(crowd,y);if(gap<1e-6&&it>20)break;}
    G.base={perceived:per,crowded:crowd,...y};G.base=year(null,aware0,per,crowd);G.base.perceived=per;G.base.crowdedStart=crowd;
    // «do nothing» over the years (the same start, nobody builds): each year's jam, for the score
    G.doNothing=[];{let p2=per.slice(),c2=crowd;for(let t=0;t<P.years;t++){const y2=year(null,aware0,p2,c2);G.doNothing.push(y2.jam);p2=learnFrom(p2,y2);c2=learnCrowd(c2,y2);}}
  }
  class Plan {
    constructor(){Object.assign(this,{line:[],stations:[],trains:1,money:P.budget});this.rewind();}
    rewind(){Object.assign(this,{year:0,aware:D.origins.map(()=>P.aware.start),perceived:G.base.perceived.slice(),crowded:JSON.parse(JSON.stringify(G.base.crowdedStart)),log:[],total:0,done:false});}
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
    now(){return year(this,this.aware,this.perceived,this.crowded);}
    // everybody knows the line and the roads have settled: run it on until nothing moves
    potential(){let per=this.perceived.slice(),crowd=this.crowded,y=null;const all=D.origins.map(()=>1);
      for(let it=0;it<60;it++){y=year(this,all,per,crowd);per=learnFrom(per,y);crowd=learnCrowd(crowd,y);}return y;}
    canRun(){return !this.done&&this.stations.length>=2;}
    runYear(){if(!this.canRun())return null;
      const y=this.now(),before=this.aware.slice(),jam0=G.doNothing[this.year];this.year++;const saved=jam0-y.jam;this.total+=saved;
      this.aware=spread(y,this.aware);const perBefore=this.perceived;this.perceived=learnFrom(this.perceived,y);this.crowded=learnCrowd(this.crowded,y);
      const entry={year:this.year,jam:y.jam,jam0,saved,riders:y.riders,onNew:y.onNew,drivers:y.drivers,before,after:this.aware.slice(),
        crowdedSections:Object.values(y.crowded).reduce((s,a)=>s+a.filter(Boolean).length,0),dest:y.dest.map(d=>({go:d.go,metro:d.metro,before:d.before}))};
      this.log.push(entry);if(this.year>=P.years)this.done=true;return{...entry,y,perBefore};}
    simulate(){const p=new Plan();Object.assign(p,JSON.parse(JSON.stringify({...this})));p.rewind();while(!p.done)p.runYear();return p;}
  }
  reset();
  const API={D,P,G,Plan,year,spread,learnFrom,learnCrowd,metroTrip,network,carRoute,carBlocks,split,onward,expand,walk,same,key,adj,reset};
  if(typeof module!=='undefined')module.exports=API;root.Roads=API;
})(typeof window!=='undefined'?window:globalThis);
