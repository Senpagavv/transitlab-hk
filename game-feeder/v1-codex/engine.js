(function(root) {
  'use strict';
  const D=typeof module!=='undefined'?require('./data.js'):root.TIDE_DATA;
  // Seconds are observation-game time, not real transport calibration.
  const P={tick:.5,duration:1080,firstWave:35,interval:120,release:30,
    walkStep:12,busStep:10,headwayBase:70,headwayStep:12,seats:5,queue:8,build:20,moves:6,
    spread:3.8,waitScale:140,homeGrace:50,patience:210,queuePatience:120,
    reconsider:4,target:120,highScore:130};
  const key=c=>c.join(','), same=(a,b)=>a&&b&&key(a)===key(b);
  function rng(seed) { return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;
    let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;
    return((t^t>>>14)>>>0)/4294967296;}; }
  const graph=new Map(D.roads.map(c=>[key(c),c])), cache=new Map();
  function route(a,b) {
    const k=key(a)+'>'+key(b);
    if(cache.has(k)) return cache.get(k).map(c=>c.slice());
    const q=[a],parent=new Map([[key(a),null]]);
    for(let i=0;i<q.length;i++) {
      const c=q[i]; if(same(c,b)) break;
      for(const n of [[c[0]+1,c[1]],[c[0]-1,c[1]],[c[0],c[1]+1],[c[0],c[1]-1]])
        if(graph.has(key(n))&&!parent.has(key(n))) {parent.set(key(n),c);q.push(n);}
    }
    if(!parent.has(key(b))) return [];
    const out=[];let c=b;while(c){out.push(c);c=parent.get(key(c));}
    out.reverse();cache.set(k,out);return out.map(c=>c.slice());
  }
  const dist=(a,b)=>route(a,b).length-1;
  const length=path=>path.slice(1).reduce((n,c,i)=>n+Math.abs(c[0]-path[i][0])+Math.abs(c[1]-path[i][1]),0);
  function along(path,elapsed,step) {
    let left=Math.max(0,elapsed/step);
    for(let i=1;i<path.length;i++) {
      const a=path[i-1],b=path[i],d=Math.abs(b[0]-a[0])+Math.abs(b[1]-a[1]);
      if(left<d) return[a[0]+(b[0]-a[0])*left/d,a[1]+(b[1]-a[1])*left/d];
      left-=d;
    }
    return(path.at(-1)||[0,0]).slice();
  }
  class Game {
    constructor(seed=1781) {
      Object.assign(this,{seed,t:0,started:false,done:false,moves:P.moves,delivered:0,cars:0,missed:0,steps:0,acc:0,events:[],commands:[],people:[]});
      this.trips=[];
      this.stops=[0,1,2].map(id=>({id,cell:null,version:0,ready:0,queue:[],boarding:[],peak:0,rejected:0,serial:0,departAt:Infinity}));
      const r=rng(seed);let id=0;
      D.waves.forEach((w,wi)=>w.forEach((n,o)=>{
        for(let j=0;j<n;j++) this.people.push({id:id++,origin:o,wave:wi,
          born:P.firstWave+wi*P.interval+(j+.15+.7*r())/n*P.release,
          state:'future',preference:.08+.72*r(),budget:P.patience+40*(r()-.5),
          queueLimit:P.queuePatience+20*(r()-.5),attempts:0,retryAt:0,
          path:[D.origins[o].cell],since:0,target:null,deadline:Infinity});
      }));
      this.people.sort((a,b)=>a.born-b.born||a.id-b.id);
    }
    emit(type,p,extra={}) {this.events.push({time:this.t,type,id:p?.id,origin:p?.origin,...extra});}
    person(id) {return this.people.find(p=>p.id===id);}
    headway(s) {return P.headwayBase+dist(s.cell,D.hub)*P.headwayStep;}
    start() {if(this.started||this.stops.some(s=>!s.cell))return false;this.started=true;for(const s of this.stops)s.departAt=this.headway(s);return true;}
    place(id,cell) {
      const s=this.stops[id];
      if(this.done||!s||!D.candidates.some(c=>same(c,cell))||this.stops.some(x=>x.id!==id&&same(x.cell,cell))||same(s.cell,cell))return false;
      if(this.started&&this.moves<=0)return false;
      const old=s.cell?.slice();
      if(this.started){this.moves--;this.commands.push({time:this.t,id,cell:cell.slice()});}
      s.version++;s.cell=cell.slice();s.ready=this.started?this.t+P.build:0;
      s.departAt=this.started?s.ready+this.headway(s):Infinity;
      if(old) {
        for(const pid of [...s.queue,...s.boarding]) {const p=this.person(pid);if(['queue','seated'].includes(p.state))this.goHome(p,'搬站返家');}
        s.queue=[];s.boarding=[];
        for(const p of this.people) if(p.state==='walk'&&p.target===id) {
          const anchor=this.currentNode(p),choice=this.choose(p,anchor,id);
          if(choice)this.walk(p,choice.id,anchor);else this.goHome(p,'原站搬遷',anchor);
        }
      }
      this.emit(this.started?'move':'place',null,{stop:id,cell:cell.slice()});return true;
    }
    pos(p) {return along(p.path,this.t-p.since,P.walkStep);}
    currentNode(p) {
      let left=Math.max(0,(this.t-p.since)/P.walkStep);
      for(let i=1;i<p.path.length;i++) {
        const d=length([p.path[i-1],p.path[i]]);
        if(left<d-1e-8)return p.path[i].slice();left-=d;
      }
      return p.path.at(-1).slice();
    }
    walkingPath(p,from,to) {
      const path=route(from,to),pos=['walk','return','queue','seated'].includes(p.state)?this.pos(p):from;
      return same(pos,from)?path:[pos,...path];
    }
    eta(s) {return s.cell?Math.max(0,s.departAt-this.t):Infinity;}
    attraction(p,s,from=D.origins[p.origin].cell) {
      if(!s.cell||s.ready>this.t)return 0;
      const steps=dist(from,s.cell);if(steps<0)return 0;
      const walk=steps*P.walkStep,cycle=this.headway(s);
      let eta=this.eta(s);
      if(walk>eta)eta+=Math.ceil((walk-eta)/cycle)*cycle;
      // People perceive the present crowd, not an omniscient forecast of other walkers.
      const wait=Math.max(0,eta-walk);
      const appeal=1/(1+(steps/P.spread)**2)/(1+(wait/P.waitScale)**2)/(1+s.queue.length/10+s.boarding.length/25);
      return this.t+walk+wait<p.deadline?appeal:0;
    }
    choose(p,from,excluded=-1) {
      let best=null;
      for(const s of this.stops){if(s.id===excluded)continue;const appeal=this.attraction(p,s,from);
        if(appeal>p.preference&&(!best||appeal>best.appeal))best={id:s.id,appeal};}
      return best;
    }
    walk(p,id,from) {const path=this.walkingPath(p,from,this.stops[id].cell);Object.assign(p,{state:'walk',target:id,path,since:this.t});this.emit('walk',p,{stop:id});}
    decide(p) {
      const choice=this.choose(p,D.origins[p.origin].cell);
      if(choice){p.attempts++;this.walk(p,choice.id,D.origins[p.origin].cell);}
      else p.retryAt=this.t+P.reconsider;
    }
    goHome(p,why,from) {
      if(['car','delivered','bus','missed'].includes(p.state))return;
      for(const s of this.stops){s.queue=s.queue.filter(id=>id!==p.id);s.boarding=s.boarding.filter(id=>id!==p.id);}
      const anchor=from||this.currentNode(p),path=this.walkingPath(p,anchor,D.origins[p.origin].cell);
      Object.assign(p,{state:'return',target:null,path,since:this.t});this.emit('return',p,{why});
    }
    car(p) {
      if(['car','delivered','bus','missed'].includes(p.state))return;
      for(const s of this.stops){s.queue=s.queue.filter(id=>id!==p.id);s.boarding=s.boarding.filter(id=>id!==p.id);}
      p.state='car';p.since=this.t;this.cars++;this.emit('car',p);
    }
    board(s) {
      if(s.ready>this.t)return;
      while(s.boarding.length<P.seats&&s.queue.length){const id=s.queue.shift(),p=this.person(id);
        if(p.state!=='queue'||p.deadline<=this.t)continue;
        s.boarding.push(id);p.state='seated';this.emit('board',p,{stop:s.id});}
    }
    buses() {
      for(const b of this.trips.filter(b=>!b.done))if(this.t>=b.end){
        for(const id of b.load){const p=this.person(id);p.state='delivered';p.since=this.t;this.delivered++;this.emit('delivered',p,{stop:b.stop});}
        b.done=true;
      }
      for(const s of this.stops){if(!s.cell||s.ready>this.t)continue;
        for(const id of [...s.queue,...s.boarding]){const p=this.person(id);
          if(this.t-p.since>=p.queueLimit||this.t>=p.deadline)this.goHome(p,'久候返家');}
        this.board(s);if(this.t+1e-6<s.departAt)continue;
        const path=route(s.cell,D.hub),load=s.boarding.splice(0),serial=++s.serial;
        // A scheduled departure. Fleet circulation is abstracted in the headway;
        // the map displays only the loaded, one-way feeder trip to MTR.
        if(load.length){this.trips.push({stop:s.id,serial,path,since:this.t,end:this.t+length(path)*P.busStep,load,done:false});
          for(const id of load){const p=this.person(id);p.state='bus';p.since=this.t;this.emit('depart',p,{stop:s.id,serial});}}
        this.emit('dispatch',null,{stop:s.id,serial,load:load.length});
        s.departAt=this.t+this.headway(s);this.board(s);
      }
    }
    closeSession() {
      for(const p of this.people)if(!['car','delivered'].includes(p.state)){p.state='missed';this.missed++;}
      for(const s of this.stops){s.queue=[];s.boarding=[];}
      for(const b of this.trips)b.done=true;
      this.done=true;this.emit('finish');
    }
    step() {
      this.steps++;this.t=+(this.steps*P.tick).toFixed(4);this.buses();
      for(const p of this.people){
        if(p.state==='future'&&this.t>=p.born){Object.assign(p,{state:'home',deadline:this.t+p.budget,homeUntil:this.t+P.homeGrace,retryAt:this.t});this.emit('spawn',p);}
        if(p.state==='home'){
          if(this.t>=p.deadline||this.t>=p.homeUntil)this.car(p);
          else if(p.attempts<2&&this.t>=p.retryAt)this.decide(p);
        } else if(p.state==='walk'&&this.t-p.since+1e-6>=length(p.path)*P.walkStep){
          const s=this.stops[p.target];
          if(s&&s.ready<=this.t&&(s.boarding.length<P.seats||s.queue.length<P.queue)&&this.t<p.deadline){
            p.state='queue';p.path=[s.cell.slice()];p.since=this.t;s.queue.push(p.id);this.emit('queue',p,{stop:s.id});
            this.board(s);
            s.peak=Math.max(s.peak,s.queue.length);
          }else{if(s&&s.queue.length>=P.queue){s.rejected++;this.emit('full',p,{stop:s.id});}this.goHome(p,this.t>=p.deadline?'耐心耗盡':'站已滿員');}
        } else if(['queue','seated'].includes(p.state)&&(this.t-p.since>=p.queueLimit||this.t>=p.deadline))this.goHome(p,'久候返家');
        else if(p.state==='return'&&this.t-p.since+1e-6>=length(p.path)*P.walkStep){
          Object.assign(p,{state:'home',path:[D.origins[p.origin].cell],since:this.t,homeUntil:Math.min(p.deadline,this.t+P.homeGrace),retryAt:this.t+P.reconsider});this.emit('home',p);
        }else if(p.state==='walk'&&this.t>=p.deadline)this.goHome(p,'耐心耗盡');
      }
      if(this.t>=P.duration)this.closeSession();
    }
    advance(seconds) {
      if(!this.started||this.done)return;this.acc+=Math.max(0,seconds);
      while(this.acc+1e-8>=P.tick&&!this.done){this.acc-=P.tick;this.step();}
    }
    waveInfo() {
      const active=D.waves.findIndex((w,i)=>this.t>=P.firstWave+i*P.interval&&this.t<P.firstWave+i*P.interval+P.release);
      const next=D.waves.findIndex((w,i)=>P.firstWave+i*P.interval>this.t);
      return{active,next,activeEnd:active<0?null:P.firstWave+active*P.interval+P.release,
        nextStart:next<0?null:P.firstWave+next*P.interval};
    }
    homeStats(origin) {
      const ps=this.people.filter(p=>p.origin===origin),w=this.waveInfo(),count=state=>ps.filter(p=>p.state===state).length;
      const home=ps.filter(p=>p.state==='home');
      return{total:ps.length,future:count('future'),home:home.length,walking:count('walk'),queue:count('queue'),seated:count('seated'),returning:count('return'),aboard:count('bus'),delivered:count('delivered'),cars:count('car'),missed:count('missed'),
        firstDrive:home.length?Math.max(0,Math.min(...home.map(p=>Math.min(p.homeUntil,p.deadline)))-this.t):null,
        active:w.active,activeTotal:w.active<0?0:D.waves[w.active][origin],activeRemaining:w.active<0?0:ps.filter(p=>p.wave===w.active&&p.state==='future').length,
        next:w.next,nextCount:w.next<0?0:D.waves[w.next][origin],nextIn:w.nextStart===null?null:w.nextStart-this.t};
    }
    stats(){return{delivered:this.delivered,cars:this.cars,missed:this.missed,
      active:this.people.filter(p=>!['future','delivered','car','missed'].includes(p.state)).length,
      future:this.people.filter(p=>p.state==='future').length,total:this.people.length,time:this.t,moves:this.moves,done:this.done};}
  }
  const API={D,P,Game,route,dist,along,length,rng,same};
  if(typeof module!=='undefined')module.exports=API;root.Tide=API;
})(typeof window!=='undefined'?window:globalThis);
