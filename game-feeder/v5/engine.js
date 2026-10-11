(function(root) {
  'use strict';
  const D=typeof module!=='undefined'?require('./data.js'):root.TIDE_DATA;
  // Seconds are game time, not real transport calibration.
  // v5 (shares): everyone in an estate takes the bus if any stop is near enough; they split between the stops in
  // proportion to each stop's pull (100 % next door, 10 points less per block, nothing beyond 6 blocks). Stops 80 %
  // and 40 % share an estate 2 : 1. The split is fixed for each batch (evenly spread picks, no dice), so the same
  // plan always plays the same way and the map can show exactly who goes where.
  // A full stop drops out of the split for whoever decides at that moment; if every stop near them is full they wait
  // at home a while, then drive. Turned away at a stop: walk on to another one once, else go home, think, try once
  // more; whoever used up their patience on the way drives as soon as they are home. Score: arrivals by bus.
  // Rounds as in v4: people leave steadily through each round; moving a stop costs `cool` seconds.
  // Each level sets its own rhythm, pull, capacity and tiers (reset()).
  const P={tick:.5,duration:1080,firstWave:35,interval:120,release:110,
    walkStep:12,busStep:10,headwayBase:60,headwayStep:10,seats:6,queue:8,cool:20,moves:4,
    willing:[1,.9,.8,.7,.6,.5,.4],homeGrace:50,homeThink:20,patience:210,
    reconsider:4,target:133,highScore:140,masterScore:146};
  const key=c=>c.join(','), same=(a,b)=>a&&b&&key(a)===key(b);
  function rng(seed) { return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;
    let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;
    return((t^t>>>14)>>>0)/4294967296;}; }
  // Everything derived from the board. reset() rebuilds it after D.select() swaps the board in place.
  let graph=new Map(), cache=new Map();
  const toMTR=[];
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
  const willing=steps=>steps<0?0:(P.willing[steps]??0);
  // These residents drive today because the MTR is too far to walk. A stop that is as far on foot as the MTR
  // itself (or lies beyond it) wins nobody — nobody walks past the station to ride back to it.
  function reset() {
    graph=new Map(D.roads.map(c=>[key(c),c]));cache=new Map();
    // each board carries its own headway formula and score tiers
    [P.headwayBase,P.headwayStep]=D.headway||[60,10];
    if(D.tiers)[P.target,P.highScore,P.masterScore]=D.tiers;
    for(const k of ['firstWave','interval','release','seats','queue','cool','moves','willing','patience'])if(D[k]!==undefined)P[k]=Array.isArray(D[k])?D[k].slice():D[k];
    // after the last round people still walk, wait and ride: the game ends when everyone has an outcome
    // (delivered or drove), or at the latest `tail` seconds after the last round
    P.lastRound=P.firstWave+D.waves.length*P.interval;
    // the latest anyone can still be on the way: full patience, then the slowest bus and the longest ride
    const hwMax=Math.max(...D.candidates.map(c=>P.headwayBase+dist(c,D.hub)*P.headwayStep));
    const rideMax=Math.max(...D.candidates.map(c=>length(route(c,D.hub))*P.busStep));
    // counted from the last person to leave home (a level may spread departures past the end of its last round)
    const lastBorn=Math.max(P.lastRound,P.firstWave+(D.waves.length-1)*P.interval+P.release);
    P.duration=lastBorn+(D.tail??Math.ceil((P.patience+20+hwMax+rideMax+30)/10)*10);
    toMTR.splice(0,toMTR.length,...D.origins.map(o=>dist(o.cell,D.hub)));
  }
  reset();
  const shareAt=(origin,cell,walked=0,from=D.origins[origin].cell)=>{const total=walked+dist(from,cell);return total<toMTR[origin]?willing(total):0;};
  // How many of n people in one batch come when the share is w (thresholds are evenly spread).
  const comes=(n,w)=>Math.max(0,Math.min(n,Math.ceil(w*n-.5)));
  const headwayAt=cell=>P.headwayBase+dist(cell,D.hub)*P.headwayStep;
  // The stop whose slice of the pull holds `pick` (stops in order A, B, C; -1 if no stop pulls at all).
  function slice(pulls,pick){
    const sum=pulls.reduce((a,b)=>a+b,0);if(!sum)return -1;
    let acc=0,last=-1;
    for(let s=0;s<pulls.length;s++){if(!pulls[s])continue;last=s;acc+=pulls[s]/sum;if(pick<acc-1e-9)return s;}
    return last;
  }
  // How a batch of n splits over the stops (the same picks the people get): counts per stop.
  function split(n,pulls){const out=pulls.map(()=>0);for(let j=0;j<n;j++){const s=slice(pulls,(j+.5)/n);if(s>=0)out[s]++;}return out;}
  // Roughly how many one stop can take in a round: the buses that leave while people come out, plus its queue.
  const capacityAt=cell=>P.seats*P.release/headwayAt(cell)+P.queue;
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
        // Evenly spread picks, shuffled: a stop with a third of the pull gets exactly a third of the batch (split()).
        const picks=Array.from({length:n},(_,k)=>(k+.5)/n);
        for(let k=n-1;k>0;k--){const j=Math.floor(r()*(k+1));[picks[k],picks[j]]=[picks[j],picks[k]];}
        for(let j=0;j<n;j++) this.people.push({id:id++,origin:o,wave:wi,
          born:P.firstWave+wi*P.interval+(j+.5)/n*P.release,
          state:'future',pick:picks[j],budget:P.patience+40*(r()-.5),
          trips:0,switched:false,retryAt:0,avoid:[],walked:0,giveUp:false,
          path:[D.origins[o].cell],since:0,target:null,deadline:Infinity});
      }));
      this.people.sort((a,b)=>a.born-b.born||a.id-b.id);
    }
    emit(type,p,extra={}) {this.events.push({time:this.t,type,id:p?.id,origin:p?.origin,...extra});}
    person(id) {return this.people.find(p=>p.id===id);}
    headway(s) {return headwayAt(s.cell);}
    // opening + commands + seed is the whole round: replaying them gives the same score (verify_result.js)
    start() {if(this.started||this.stops.some(s=>!s.cell))return false;this.started=true;this.opening=this.stops.map(s=>s.cell.slice());for(const s of this.stops)s.departAt=this.headway(s);return true;}
    place(id,cell) {
      const s=this.stops[id];
      if(this.done||!s||!D.candidates.some(c=>same(c,cell))||this.stops.some(x=>x.id!==id&&same(x.cell,cell))||same(s.cell,cell))return false;
      if(this.started&&this.moves<=0)return false;
      const old=s.cell?.slice();
      if(this.started){this.moves--;this.commands.push({time:this.t,id,cell:cell.slice()});}
      // a moved stop cools down for P.cool seconds; its timetable keeps running (see buses())
      s.version++;s.cell=cell.slice();s.ready=this.started?this.t+P.cool:0;
      if(!this.started)s.departAt=Infinity;
      if(old) {
        // The bus loading at the old spot leaves at once: everyone aboard is delivered as usual.
        if(this.started&&s.boarding.length)this.depart(s,old);
        // People still queuing look for another stop from where they stand; if none suits, they walk home
        // and may try again once the new stop is ready (the move was not their failure).
        const waiting=s.queue.map(pid=>this.person(pid)).filter(p=>p.state==='queue');
        s.queue=[];s.boarding=[];
        for(const p of waiting)this.reroute(p,old,null,'搬站返家');
        for(const p of this.people) if(p.state==='walk'&&p.target===id) {
          const anchor=this.currentNode(p),pos=this.pos(p);
          p.walked+=(this.t-p.since)/P.walkStep;p.path=[pos];p.since=this.t;
          this.reroute(p,anchor,null,'原站搬遷',id);
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
    // Share of people willing to walk to stop s; zero while it is being built,
    // after this person was turned away there, or if they cannot make a bus in time.
    attraction(p,s,from=D.origins[p.origin].cell,walked=0) {
      if(!s.cell||s.ready>this.t||p.avoid.includes(s.id+':'+s.version))return 0;
      if(s.queue.length>=P.queue&&s.boarding.length>=P.seats)return 0;   // a full stop attracts nobody at the moment they decide
      const steps=dist(from,s.cell);if(steps<0)return 0;
      const share=shareAt(p.origin,s.cell,walked,from);if(!share)return 0;
      const walk=steps*P.walkStep,cycle=this.headway(s);
      let eta=this.eta(s);
      if(walk>eta)eta+=Math.ceil((walk-eta)/cycle)*cycle;
      const wait=Math.max(0,eta-walk);
      return this.t+walk+wait<p.deadline?share:0;
    }
    // Split by pull among the stops open to this person right now (pick decides which slice they fall in).
    choose(p,from,excluded=-1,walked=0) {
      const pulls=this.stops.map(s=>s.id===excluded?0:this.attraction(p,s,from,walked)),id=slice(pulls,p.pick);
      return id<0?null:{id,appeal:pulls[id]};
    }
    walk(p,id,from) {const path=this.walkingPath(p,from,this.stops[id].cell);Object.assign(p,{state:'walk',target:id,path,since:this.t});this.emit('walk',p,{stop:id});}
    decide(p) {
      const choice=this.choose(p,D.origins[p.origin].cell);
      if(choice){p.trips++;p.switched=false;p.walked=0;this.walk(p,choice.id,D.origins[p.origin].cell);}
      else{p.retryAt=this.t+P.reconsider;
        // nothing chosen because the stop they would use is full right now — that is the reason if they end up driving
        if(this.stops.some(s=>s.cell&&s.ready<=this.t&&s.queue.length>=P.queue&&s.boarding.length>=P.seats&&shareAt(p.origin,s.cell)>0))p.lastWhy='站滿了';}
    }
    leave(p){for(const s of this.stops){s.queue=s.queue.filter(id=>id!==p.id);s.boarding=s.boarding.filter(id=>id!==p.id);}}
    // Full, waited too long, or the stop moved: from where they stand, walk on to another stop if the whole
    // walk (already walked + still to walk) is still within their willingness — once per trip; otherwise walk
    // home, think for homeThink seconds, then choose once between the nearest stop that suits them (by the same
    // distance rule; the stop that was full counts again unless it is still full) and driving. At most two trips
    // out from home. Whoever is already walking never turns back, even if a nearer stop frees up.
    reroute(p,here,failed,why,excluded=-1) {
      this.leave(p);
      if(failed){p.avoid.push(failed.id+':'+failed.version);p.lastWhy=why==='久候返家'?'等太久':'站滿了';}
      const choice=p.switched?null:this.choose(p,here,excluded,p.walked);
      if(choice){p.switched=true;this.walk(p,choice.id,here);this.emit('switch',p,{stop:choice.id,from:failed?failed.id:-1,why});return;}
      this.goHome(p,why,here);
    }
    goHome(p,why,from,turnedAway) {
      if(['car','delivered','bus','missed'].includes(p.state))return;
      if(turnedAway)p.avoid.push(turnedAway.id+':'+turnedAway.version);
      for(const s of this.stops){s.queue=s.queue.filter(id=>id!==p.id);s.boarding=s.boarding.filter(id=>id!==p.id);}
      const anchor=from||this.currentNode(p),path=this.walkingPath(p,anchor,D.origins[p.origin].cell);
      Object.assign(p,{state:'return',target:null,path,since:this.t,returnWhy:why});this.emit('return',p,{why});
    }
    car(p) {
      if(['car','delivered','bus','missed'].includes(p.state))return;
      for(const s of this.stops){s.queue=s.queue.filter(id=>id!==p.id);s.boarding=s.boarding.filter(id=>id!==p.id);}
      p.state='car';p.since=this.t;this.cars++;this.emit('car',p,{why:p.lastWhy||'沒有夠近的站'});
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
      for(const s of this.stops){if(!s.cell)continue;
        if(s.ready>this.t){while(this.t+1e-6>=s.departAt)s.departAt+=this.headway(s);continue;}   // cooling down: buses pass empty
        for(const id of [...s.queue]){const p=this.person(id);if(this.t>=p.deadline)this.reroute(p,s.cell.slice(),s,'久候返家');}
        this.board(s);if(this.t+1e-6<s.departAt)continue;
        this.depart(s,s.cell);s.departAt=this.t+this.headway(s);this.board(s);
      }
    }
    // A departure from `from` (the stop's cell, or its old cell when it is moved). Fleet circulation is abstracted in
    // the headway; the map displays only the loaded, one-way feeder trip to MTR.
    depart(s,from) {
      const path=route(from,D.hub),load=s.boarding.splice(0),serial=++s.serial;
      if(load.length){this.trips.push({stop:s.id,serial,path,since:this.t,end:this.t+length(path)*P.busStep,load,done:false});
        for(const id of load){const p=this.person(id);p.state='bus';p.since=this.t;this.emit('depart',p,{stop:s.id,serial});}}
      this.emit('dispatch',null,{stop:s.id,serial,load:load.length});
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
          else if(p.trips<2&&this.t>=p.retryAt)this.decide(p);
        } else if(p.state==='walk'&&this.t-p.since+1e-6>=length(p.path)*P.walkStep){
          const s=this.stops[p.target];p.walked+=length(p.path);
          if(s&&s.ready<=this.t&&(s.boarding.length<P.seats||s.queue.length<P.queue)&&this.t<p.deadline){
            p.state='queue';p.path=[s.cell.slice()];p.since=this.t;s.queue.push(p.id);this.emit('queue',p,{stop:s.id});
            this.board(s);
            s.peak=Math.max(s.peak,s.queue.length);
          }else{const full=s&&s.queue.length>=P.queue&&s.boarding.length>=P.seats,here=p.path.at(-1).slice();
            if(full){s.rejected++;this.emit('full',p,{stop:s.id});}
            if(this.t>=p.deadline){p.giveUp=true;p.lastWhy='等太久';this.leave(p);this.goHome(p,'耐心耗盡',here);}
            else this.reroute(p,here,full?s:null,full?'站已滿員':'站還在重建');}
        } else if(p.state==='queue'&&this.t>=p.deadline){const s=this.stops[p.target];this.reroute(p,s.cell.slice(),s,'久候返家');}
        else if(p.state==='return'&&this.t-p.since+1e-6>=length(p.path)*P.walkStep){
          // patience used up on the way, or this was their last try (a stop moved away does not count): drive at once
          if(p.giveUp||p.trips>=2&&!['搬站返家','原站搬遷'].includes(p.returnWhy)){this.car(p);continue;}
          // home again: think for a while, then one decision — the nearest suitable stop, or the car
          Object.assign(p,{state:'home',path:[D.origins[p.origin].cell],since:this.t,avoid:[],homeUntil:Math.min(p.deadline,this.t+P.homeThink+P.tick),retryAt:this.t+P.homeThink});this.emit('home',p);
        }else if(p.state==='walk'&&this.t>=p.deadline){p.giveUp=true;p.lastWhy='等太久';this.goHome(p,'耐心耗盡');}
      }
      if(this.t>=P.duration||this.t>=P.lastRound&&this.people.every(p=>p.state==='delivered'||p.state==='car'))this.closeSession();
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
    // Map preview for a set of stop cells (replace stop `id` by `cell` to preview a placement), all stops open:
    // each estate's pull and share per stop and head count per round; and, played forward from now with this layout,
    // each stop's most people waiting and how many would find it full, per round. The play-forward uses the real
    // people (their departure times and picks), walking times and the bus timetable, but not what people do once a
    // stop is full (they would spread to the other stops) — so it is a warning, not a promise.
    forecast(id=-1,cell=null) {
      const cells=this.stops.map(s=>s.id===id?cell:s.cell),room=P.seats+P.queue,R=D.waves.length;
      const pullsOf=D.origins.map((o,i)=>cells.map(c=>c?shareAt(i,c):0));
      const estates=D.origins.map((o,i)=>{
        const pull=pullsOf[i],sum=pull.reduce((a,b)=>a+b,0);
        return{origin:i,pull,share:pull.map(w=>sum?w/sum:0),steps:cells.map(c=>c?dist(o.cell,c):null),
          perWave:D.waves.map(w=>split(w[i],pull)),drives:!sum};
      });
      const t0=this.started?this.t:0,roundOf=tt=>Math.max(0,Math.min(R-1,Math.floor((tt-P.firstWave)/P.interval)));
      const stops=cells.map((c,s)=>{
        const out={cell:c,room,capacity:c?P.seats*P.interval/headwayAt(c):0,
          load:D.waves.map((w,wi)=>estates.reduce((n,e)=>n+e.perWave[wi][s],0)),peak:D.waves.map(()=>0),over:D.waves.map(()=>0)};
        if(!c)return out;
        // arrivals from now on: people still to leave home (their pick decides the stop), and people walking here now
        const st=this.stops[s],moved=s===id,arrive=[];
        for(const p of this.people){
          if(p.state==='future'||p.state==='home'&&!this.started){if(slice(pullsOf[p.origin],p.pick)===s)arrive.push(p.born+dist(D.origins[p.origin].cell,c)*P.walkStep);}
          else if(!moved&&p.state==='walk'&&p.target===s)arrive.push(p.since+length(p.path)*P.walkStep);
        }
        arrive.sort((a,b)=>a-b);
        const hw=headwayAt(c);let wait=moved||!this.started?0:st.queue.length+st.boarding.length;
        let next=this.started&&!moved?st.departAt:t0+hw;
        const ready=moved?t0+P.cool:this.started?st.ready:0;
        for(const at of arrive){
          while(next<=at){if(next>=ready)wait=Math.max(0,wait-P.seats);next+=hw;}
          const r=roundOf(at);
          if(at<ready||wait>=room){out.over[r]++;continue;}
          wait++;out.peak[r]=Math.max(out.peak[r],wait);
        }
        return out;
      });
      return{estates,stops};
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
  const API={D,P,Game,route,dist,along,length,rng,same,willing,comes,headwayAt,shareAt,toMTR,reset,slice,split,capacityAt};
  if(typeof module!=='undefined')module.exports=API;root.Tide=API;
})(typeof window!=='undefined'?window:globalThis);
