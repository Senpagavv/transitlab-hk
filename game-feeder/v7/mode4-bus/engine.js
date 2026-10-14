(function(root) {
  'use strict';
  const D=typeof module!=='undefined'?require('./data.js'):root.BUS_DATA;
  // v7 · mode 4 «buses on the road» (2026-10-14) — mode 3's Kowloon East with the 東九龍綫 from mode 3 already built.
  // Mode 3's rules hold (pull = attraction − blocks against «nearby»; blocks saved → tenths by public transport; going on
  // between the two centres; roads jam by (cars ÷ capacity)²; drivers learn `learn` of the way each year; crowding is
  // learnt too). New here:
  //   buses     a route runs along the roads; its stops are on it. A bus trip = walk + wait + for every hop between
  //             stops: 1 + the road sections ridden (1 + the jam each, the jam people reckon with) + walk. Wait =
  //             `busHead` ÷ the buses on the route. A route carries buses × `perBus` a day on a section; more is crowded.
  //   lanes     a bus lane on a road: the buses there skip the jam, but the cars lose `laneCut` of the road's capacity.
  //   crowding  a section over its room counts toward `crowdBlocks` × how far over (a quarter over: all), learnt slowly.
  //   buses add `busPCU` cars' worth to the road for every bus (not on a bus lane).
  //   yearly    buses are cheap and flexible: routes, stops, buses and lanes can change every year, within a budget a
  //             year (a bus `busCost`, a lane `laneCost`). Everyone sees a bus route at once — no word of mouth.
  // Score: as mode 3, the jam taken off the roads each year compared with doing nothing (no buses), added up.
  const P={walkPer:3,wait:2,busHead:8,perBus:16,busPCU:2,laneCut:.4,budget:12,busCost:1,laneCost:3,maxRoutes:3,perTrain:40,years:8,crowdBlocks:4,
    nearby:10,stay:40,learn:.3,target:0,highScore:0,masterScore:0};
  const NUM=['walkPer','wait','busHead','perBus','busPCU','laneCut','budget','busCost','laneCost','maxRoutes','perTrain','years','crowdBlocks','nearby','stay','learn'];
  const key=c=>c.join(','),same=(a,b)=>a&&b&&a[0]===b[0]&&a[1]===b[1];
  const walk=(a,b)=>Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]);
  const adj=(a,b)=>walk(a,b)===1;
  function expand(via){const out=[via[0].slice()];
    for(let j=1;j<via.length;j++){let c=out.at(-1).slice();const t=via[j];
      while(c[0]!==t[0]){c=[c[0]+Math.sign(t[0]-c[0]),c[1]];out.push(c);}
      while(c[1]!==t[1]){c=[c[0],c[1]+Math.sign(t[1]-c[1])];out.push(c);}}
    return out;}
  const G={};
  /* ------------------------------------------------------------------ roads */
  function buildRoads(){
    const sec=new Map(),nodes=new Map();G.sections=[];G.secByCells=sec;
    for(const r of D.roads){const cells=expand(r.via);
      for(let j=1;j<cells.length;j++){const a=cells[j-1],b=cells[j],k=[key(a),key(b)].sort().join('|');
        if(!sec.has(k)){const s={id:G.sections.length,a,b,cap:r.cap,roads:[r.name]};sec.set(k,s);G.sections.push(s);}
        else{const s=sec.get(k);s.cap=Math.max(s.cap,r.cap);if(!s.roads.includes(r.name))s.roads.push(r.name);}
        for(const [x,y] of [[a,b],[b,a]]){if(!nodes.has(key(x)))nodes.set(key(x),{cell:x,out:[]});nodes.get(key(x)).out.push({to:key(y),s:sec.get(k).id});}}}
    G.roadNodes=nodes;
  }
  const sectionBetween=(a,b)=>G.secByCells.get([key(a),key(b)].sort().join('|'));
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
  const laned=(s,lanes)=>s.roads.some(r=>lanes.includes(r));
  /* ------------------------------------------------------------------ the network: railways and buses */
  // a line: {name, kind:'rail'|'bus', cells, stations, cap, wait, hop(j) = cost from its j-th stop to the next}
  function network(lines){
    const nodes=[];
    lines.forEach((l,li)=>{l.order=l.stations.map(s=>({cell:s,idx:l.cells.findIndex(c=>same(c,s))})).filter(s=>s.idx>=0).sort((a,b)=>a.idx-b.idx);
      l.order.forEach((s,k)=>nodes.push({li,k,idx:s.idx,cell:s.cell,wait:l.wait,out:[]}));});
    nodes.forEach((n,i)=>nodes.forEach((m,j)=>{if(i===j)return;
      if(n.li===m.li){if(Math.abs(n.k-m.k)===1)n.out.push({to:j,cost:lines[n.li].hop(Math.min(n.k,m.k)),ride:true});}
      else if(walk(n.cell,m.cell)<=1)n.out.push({to:j,cost:P.walkPer*walk(n.cell,m.cell)+m.wait-1,ride:false});}));
    return{lines,nodes};
  }
  // the quickest public-transport trip o → d: walk + (wait − 1) + the hops [+ walk + (wait − 1) to change] + walk
  function transitTrip(net,o,d,crowded){
    const N=net.nodes.length;if(!N)return null;
    const dist=[new Array(N).fill(Infinity),new Array(N).fill(Infinity)],prev=[new Array(N).fill(null),new Array(N).fill(null)],done=[new Array(N).fill(false),new Array(N).fill(false)];
    net.nodes.forEach((n,i)=>{dist[0][i]=P.walkPer*walk(o,n.cell)+n.wait-1;});
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
      bus:legs.some(l=>net.lines[l.li].kind==='bus'),rail:legs.some(l=>net.lines[l.li].kind==='rail'),lines:legs.map(l=>net.lines[l.li].name)};
  }
  /* ------------------------------------------------------------------ one year */
  const carExtra=k=>D.destinations[k].carExtra??2;
  function split(i,blocks){const pulls=D.destinations.map((d,k)=>Math.max(0,d.attraction-blocks[k])),all=pulls.reduce((a,b)=>a+b,0)+P.nearby;
    return{pulls,shares:pulls.map(p=>p/all),nearby:P.nearby/all};}
  function onward(a,b,blocks){const pull=Math.max(0,D.destinations[b].attraction-blocks);return{pull,share:pull+P.stay>0?pull/(pull+P.stay):0};}
  // the lines running this year: the railways, and every bus route with 2 stops and a bus
  function linesOf(plan,perceived){
    const lanes=plan?plan.lanes:[],out=G.lines.map(l=>({...l,kind:'rail',cap:l.trains*P.perTrain,wait:P.wait,hop:()=>1}));
    if(plan)plan.routes.forEach((r,ri)=>{if(r.stops.length<2||r.buses<1)return;
      const stopIdx=r.stops.map(s=>r.cells.findIndex(c=>same(c,s))).filter(i=>i>=0).sort((a,b)=>a-b);
      const road=j=>{let v=0;for(let i=stopIdx[j];i<stopIdx[j+1];i++){const s=sectionBetween(r.cells[i],r.cells[i+1]);v+=1+(s&&!laned(s,lanes)?perceived[s.id]:0);}return v;};
      out.push({name:'bus'+ri,kind:'bus',route:ri,cells:r.cells,stations:r.stops,cap:r.buses*P.perBus,wait:P.busHead/r.buses,hop:j=>1+road(j)});});
    return out;}
  function year(plan,perceived,crowded){
    const lanes=plan?plan.lanes:[],lines=linesOf(plan,perceived),net=network(lines);
    const capOf=s=>s.cap*(laned(s,lanes)?1-P.laneCut:1);
    const roadLoad=new Array(G.sections.length).fill(0),lineLoad={};for(const l of lines)lineLoad[l.name]=new Array(Math.max(0,l.cells.length-1)).fill(0);
    // the buses themselves on the road (not on a bus lane)
    for(const l of lines)if(l.kind==='bus'){const r=plan.routes[l.route];for(let i=0;i+1<l.cells.length;i++){const s=sectionBetween(l.cells[i],l.cells[i+1]);if(s&&!laned(s,lanes))roadLoad[s.id]+=r.buses*P.busPCU;}}
    const busLoad=roadLoad.slice();
    const ride=(t,n)=>{if(!t||!n)return;for(const l of t.legs){const arr=lineLoad[net.lines[l.li].name];for(let j=Math.min(l.from,l.to);j<Math.max(l.from,l.to);j++)arr[j]+=n;}};
    const drive=(route,n)=>{if(n>0)for(const id of route.sections)roadLoad[id]+=n;};
    const legOf=(route,k,from,to)=>{const car=route.local+route.sections.reduce((s,id)=>s+1+perceived[id],0)+carExtra(k),foot=P.walkPer*walk(from,to),alt=Math.min(car,foot);
      const trip=transitTrip(net,from,to,crowded),pt=trip?trip.blocks:Infinity,save=Math.max(0,alt-pt);
      return{car,foot,alt,byFoot:foot<car,walkTenths:Math.min(10,Math.max(0,car-foot)),route,trip,fast:Math.min(alt,pt),save,tenths:Math.min(10,save)};};
    const pairs=[];if(P.stay>0)D.destinations.forEach((da,a)=>D.destinations.forEach((db,b)=>{if(a===b)return;
      const L=legOf(G.carDD[a][b],b,da.cell,db.cell);pairs.push({a,b,k:b,...L,share:onward(a,b,L.fast).share});}));
    const est=D.origins.map((o,i)=>{
      const legs=D.destinations.map((d,k)=>legOf(G.carOD[i][k],k,o.cell,d.cell)),now=split(i,legs.map(l=>l.fast)),n=o.people;
      const to=legs.map((L,k)=>{const go=n*now.shares[k],transit=go*L.tenths/10,rest=go-transit,walkers=rest*L.walkTenths/10,drivers=rest-walkers;
        ride(L.trip,transit);drive(L.route,drivers);
        return{k,...L,go,metro:transit,onBus:L.trip&&L.trip.bus?transit:0,walkers,drivers,before:G.base?G.base.est[i].to[k].go:go,pull:now.pulls[k]};});
      const chain=pairs.map(q=>{const x=to[q.a],go=x.go*q.share,transit=go*q.tenths/10,rest=go-transit,walkers=rest*q.walkTenths/10,drivers=rest-walkers;
        ride(q.trip,transit);drive(q.route,drivers);return{go,metro:transit,onBus:q.trip&&q.trip.bus?transit:0,drivers,walkers};});
      const sum=(arr,f)=>arr.reduce((s,x)=>s+x[f],0);
      return{i,n,to,chain,nearby:n*now.nearby,metro:sum(to,'metro')+sum(chain,'metro'),onBus:sum(to,'onBus')+sum(chain,'onBus'),drivers:sum(to,'drivers')+sum(chain,'drivers'),
        walkers:sum(to,'walkers')+sum(chain,'walkers')};});
    const chain=pairs.map((q,j)=>{const s=f=>est.reduce((t,e)=>t+e.chain[j][f],0);return{...q,go:s('go'),metro:s('metro'),onBus:s('onBus'),drivers:s('drivers'),walkers:s('walkers'),before:G.base?G.base.chain[j].go:s('go')};});
    const extra=roadLoad.map((v,id)=>(v/capOf(G.sections[id]))**2),jam=roadLoad.reduce((s,v,id)=>s+(v-busLoad[id])*extra[id],0);
    const lineState=lines.map(l=>{const load=lineLoad[l.name];return{name:l.name,kind:l.kind,route:l.route,cap:l.cap,wait:l.wait,load,crowded:load.map(v=>v>l.cap+1e-9)};});
    const into=(k,f)=>chain.filter(q=>q.b===k).reduce((s,q)=>s+q[f],0);
    const dest=D.destinations.map((d,k)=>({k,go:est.reduce((s,e)=>s+e.to[k].go,0)+into(k,'go'),metro:est.reduce((s,e)=>s+e.to[k].metro,0)+into(k,'metro'),before:G.base?G.base.dest[k].go:0}));
    const sum=f=>est.reduce((s,e)=>s+e[f],0);
    return{est,chain,dest,roadLoad,busLoad,extra,jam,lines:lineState,riders:sum('metro'),onBus:sum('onBus'),drivers:sum('drivers'),walkers:sum('walkers'),
      people:D.origins.reduce((s,o)=>s+o.people,0)};
  }
  const learnFrom=(perceived,y)=>perceived.map((p,id)=>p+P.learn*(y.extra[id]-p));
  // crowding people reckon with: toward crowdBlocks × how far over the room it was (a quarter over or more: all of it)
  const crowdOf=(load,cap)=>P.crowdBlocks*Math.min(1,Math.max(0,(load/cap-1)*4));
  const learnCrowd=(felt,y)=>{const out={};for(const l of y.lines){const was=felt[l.name]||[];out[l.name]=l.load.map((v,j)=>{const f=was[j]||0;return f+P.learn*(crowdOf(v,l.cap)-f);});}return out;};
  /* ------------------------------------------------------------------ the level */
  function reset(){
    for(const k of NUM)if(D[k]!==undefined)P[k]=D[k];[P.target,P.highScore,P.masterScore]=D.tiers||[0,0,0];
    buildRoads();
    G.carOD=D.origins.map(o=>D.destinations.map(d=>carRoute(o.cell,d.cell)));
    G.carDD=D.destinations.map(a=>D.destinations.map(b=>carRoute(a.cell,b.cell)));
    G.lines=(D.lines||[]).map(l=>({name:l.name,hans:l.hans,color:l.color,cells:expand(l.via),stations:l.stations,names:l.names,namesHans:l.namesHans,trains:l.trains,mine:!!l.mine}));
    G.base=null;
    // doing nothing: the roads settle with the railways alone
    let per=G.sections.map(()=>0),crowd={},y=null;
    for(let it=0;it<300;it++){y=year(null,per,crowd);const next=learnFrom(per,y);const gap=Math.max(0,...next.map((v,j)=>Math.abs(v-per[j])));per=next;crowd=learnCrowd(crowd,y);if(gap<1e-6&&it>20)break;}
    G.base=y;G.base=year(null,per,crowd);G.base.perceived=per;G.base.crowdedStart=crowd;
    G.doNothing=[];{let p2=per.slice(),c2=crowd;for(let t=0;t<P.years;t++){const y2=year(null,p2,c2);G.doNothing.push(y2.jam);p2=learnFrom(p2,y2);c2=learnCrowd(c2,y2);}}
  }
  class Plan {
    constructor(){this.routes=Array.from({length:P.maxRoutes},()=>({cells:[],stops:[],buses:0}));this.lanes=[];this.rewind();}
    rewind(){Object.assign(this,{year:0,perceived:G.base.perceived.slice(),crowded:JSON.parse(JSON.stringify(G.base.crowdedStart)),log:[],total:0,done:false});}
    get open(){return this.year>0;}
    get spent(){return this.routes.reduce((s,r)=>s+r.buses*P.busCost,0)+this.lanes.length*P.laneCost;}
    get money(){return P.budget-this.spent;}
    isRoad(c){return G.roadNodes.has(key(c));}
    onRoute(r,c){return this.routes[r].cells.some(x=>same(x,c));}
    isStop(r,c){return this.routes[r].stops.some(x=>same(x,c));}
    canExtend(r,c){if(this.done)return false;const R=this.routes[r];if(!this.isRoad(c)||this.onRoute(r,c))return false;if(!R.cells.length)return true;
      return [R.cells[0],R.cells.at(-1)].some(e=>sectionBetween(e,c));}
    extend(r,c){if(!this.canExtend(r,c))return false;const R=this.routes[r];if(!R.cells.length||sectionBetween(R.cells.at(-1),c))R.cells.push(c.slice());else R.cells.unshift(c.slice());return true;}
    isEnd(r,c){const R=this.routes[r];return R.cells.length>0&&(same(c,R.cells[0])||same(c,R.cells.at(-1)));}
    shorten(r,c){if(this.done||!this.isEnd(r,c))return false;const R=this.routes[r];if(same(c,R.cells.at(-1)))R.cells.pop();else R.cells.shift();R.stops=R.stops.filter(s=>!same(s,c));return true;}
    toggleStop(r,c){if(this.done||!this.onRoute(r,c))return false;const R=this.routes[r];if(this.isStop(r,c))R.stops=R.stops.filter(s=>!same(s,c));else R.stops.push(c.slice());return true;}
    canBus(r){return !this.done&&this.money>=P.busCost;}
    addBus(r){if(!this.canBus(r))return false;this.routes[r].buses++;return true;}
    removeBus(r){if(this.done||this.routes[r].buses<1)return false;this.routes[r].buses--;return true;}
    hasLane(name){return this.lanes.includes(name);}
    toggleLane(name){if(this.done)return false;if(this.hasLane(name)){this.lanes=this.lanes.filter(x=>x!==name);return true;}if(this.money<P.laneCost)return false;this.lanes.push(name);return true;}
    clearRoute(r){if(this.done)return false;this.routes[r]={cells:[],stops:[],buses:0};return true;}
    get running(){return this.routes.filter(r=>r.stops.length>=2&&r.buses>=1).length;}
    now(){return year(this,this.perceived,this.crowded);}
    // keep this plan and let the roads settle
    potential(){let per=this.perceived.slice(),crowd=this.crowded,y=null;for(let it=0;it<60;it++){y=year(this,per,crowd);per=learnFrom(per,y);crowd=learnCrowd(crowd,y);}return y;}
    canRun(){return !this.done;}
    runYear(){if(!this.canRun())return null;
      const y=this.now(),jam0=G.doNothing[this.year];this.year++;const saved=jam0-y.jam;this.total+=saved;
      const perBefore=this.perceived;this.perceived=learnFrom(this.perceived,y);this.crowded=learnCrowd(this.crowded,y);
      const entry={year:this.year,jam:y.jam,jam0,saved,riders:y.riders,onBus:y.onBus,drivers:y.drivers,buses:this.routes.map(r=>r.buses),lanes:this.lanes.slice(),spent:this.spent,
        crowdedSections:y.lines.reduce((s,l)=>s+l.crowded.filter(Boolean).length,0),dest:y.dest.map(d=>({go:d.go,metro:d.metro,before:d.before}))};
      this.log.push(entry);if(this.year>=P.years)this.done=true;return{...entry,y,perBefore};}
    clone(){const p=new Plan();Object.assign(p,JSON.parse(JSON.stringify({...this})));return p;}
    simulate(){const p=this.clone();p.rewind();while(!p.done)p.runYear();return p;}
  }
  reset();
  const API={D,P,G,Plan,year,learnFrom,learnCrowd,transitTrip,network,linesOf,carRoute,sectionBetween,laned,split,onward,expand,walk,same,key,adj,reset};
  if(typeof module!=='undefined')module.exports=API;root.Bus=API;
})(typeof window!=='undefined'?window:globalThis);
