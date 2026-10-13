(function(root) {
  'use strict';
  const D=typeof module!=='undefined'?require('./data.js'):root.METRO_DATA;
  // v7 · mode 2 «the metro» (first draft for discussion). Seconds are game time, not real calibration.
  // The board: estates (where people live), destinations (where they go: jobs, schools), and a planned alignment.
  //   Stations: up to `stationsMax` on the alignment's spots, built once at the start (they cannot move later).
  //   Trains: `trains` sets shuttle between the two outermost stations, stopping at every station; a loop is
  //     travel (trainStep a block, both ways) + a dwell at every stop + a turn at each end, so a longer line or more
  //     stations means a longer loop and, for the same trains, a train less often. Each train carries `cap`.
  //   People: each estate sends people to the destinations in fixed shares. Someone rides only if a station is near
  //     their home AND a station is near where they are going (walking pull as in mode 1: 100 % next door, 10 points
  //     less a block, nothing beyond 6 blocks); they split over every usable (home station → destination station)
  //     pair in proportion to pull × pull — evenly spread picks, no dice. No usable pair: they drive.
  //   Weeks: one round is a morning of one week. A new line: only `habit.start` of each estate even tries it; each
  //     night the habit moves halfway towards the share of that week's riders who got on without trouble (v6 rule).
  //   Each week the player sets how many trains run (1–5) out of a budget for the whole game.
  //   A platform holds `platform` people per direction; arriving at a full one, people give up and drive. In the
  //     queue they wait for a train with room (no patience used, as in mode 1).
  // Score: people who reached their destination by metro.
  const P={tick:.5,walkStep:12,trainStep:2.5,dwell:4,turn:10,cap:24,platform:30,release:110,firstWave:20,
    willing:[1,.9,.8,.7,.6,.5,.4],stationsMax:4,trainsMin:1,trainsMax:5,budget:18,target:0,highScore:0,masterScore:0};
  const key=c=>c.join(','),same=(a,b)=>a&&b&&a[0]===b[0]&&a[1]===b[1];
  const walk=(a,b)=>Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]);           // on foot: blocks along the street grid
  const willing=n=>n<0?0:(P.willing[n]??0);
  function rng(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
  // the person with pick p in [0,1) falls in the slice of the pulls it lands on (-1: no pull at all)
  function slice(pulls,p){const sum=pulls.reduce((a,b)=>a+b,0);if(!(sum>0))return -1;let acc=0;
    for(let i=0;i<pulls.length;i++){acc+=pulls[i]/sum;if(p<acc-1e-12)return i;}return pulls.findLastIndex(x=>x>0);}
  function reset(){
    for(const k of ['trainStep','dwell','turn','cap','platform','release','firstWave','stationsMax','trainsMin','trainsMax','budget','willing'])if(D[k]!==undefined)P[k]=D[k];
    [P.target,P.highScore,P.masterScore]=D.tiers||[0,0,0];
  }
  reset();
  const idxOf=c=>D.line.findIndex(x=>same(x,c));          // position along the alignment (blocks from its west end)
  class Game {
    constructor(seed=2026){
      Object.assign(this,{seed,t:0,started:false,done:false,round:0,roundStart:[P.firstWave],delivered:0,cars:0,walked:0,steps:0,acc:0,ptr:0,active:new Set(),queues:[],
        events:[],stations:[],trainsByWeek:[],people:[],trains:[],habit:D.origins.map(()=>D.habit.start),habitLog:[]});
      const r=rng(seed);let id=0;
      const spread=n=>{const a=Array.from({length:n},(_,k)=>(k+.5)/n);for(let k=n-1;k>0;k--){const j=Math.floor(r()*(k+1));[a[k],a[j]]=[a[j],a[k]];}return a;};
      for(let w=0;w<D.weeks;w++)D.origins.forEach((o,oi)=>{
        const n=o.people,dest=spread(n),pick=spread(n),tp=spread(n);
        for(let j=0;j<n;j++)this.people.push({id:id++,origin:oi,wave:w,offset:(j+.5)/n*P.release,
          dest:slice(o.to,dest[j]),pick:pick[j],tpick:tp[j],state:'future',born:Infinity,turned:false});
      });
      this.people.sort((a,b)=>a.wave-b.wave||a.offset-b.offset||a.id-b.id);
      this.pending=Array.from({length:D.weeks},(_,w)=>this.people.filter(p=>p.wave===w).length);
      this.habitLog=[{week:0,habit:this.habit.slice()}];
    }
    emit(type,p,extra={}){this.events.push({time:this.t,type,id:p?.id,origin:p?.origin,...extra});}
    // ---- building (before the start only)
    canBuild(c){return !this.started&&idxOf(c)>=0&&!this.stations.some(s=>same(s,c))&&this.stations.length<P.stationsMax;}
    build(c){if(!this.canBuild(c))return false;this.stations.push(c.slice());this.stations.sort((a,b)=>idxOf(a)-idxOf(b));this.emit('build',null,{cell:c.slice()});return true;}
    unbuild(c){if(this.started)return false;const n=this.stations.length;this.stations=this.stations.filter(s=>!same(s,c));return this.stations.length<n;}
    // ---- trains: how many this week (1–5, within what is left of the budget)
    spent(){return this.trainsByWeek.reduce((a,b)=>a+b,0);}
    trainsRange(week=this.round){const left=P.budget-this.trainsByWeek.slice(0,week).reduce((a,b)=>a+b,0),later=D.weeks-week-1;
      return[P.trainsMin,Math.max(P.trainsMin,Math.min(P.trainsMax,left-later*P.trainsMin))];}
    setTrains(n,week=this.round){const [lo,hi]=this.trainsRange(week);if(n<lo||n>hi)return false;
      if(this.started&&week<this.round)return false;this.trainsByWeek[week]=n;if(this.started&&week===this.round&&this.t<this.roundStart[week]+1e-9)this.schedule();return true;}
    // one loop of a train set: every stop (station index, direction, time from the loop start) and the loop length
    loop(){
      const st=this.stations.map(idxOf),ev=[];let t=0;if(st.length<2)return{ev,T:Infinity};
      ev.push({s:0,dir:1,at:0});
      for(let i=1;i<st.length;i++){t+=(st[i]-st[i-1])*P.trainStep;ev.push({s:i,dir:1,at:t});t+=P.dwell;}
      t+=P.turn;ev.push({s:st.length-1,dir:-1,at:t});
      for(let i=st.length-2;i>=0;i--){t+=(st[i+1]-st[i])*P.trainStep;ev.push({s:i,dir:-1,at:t});t+=P.dwell;}
      t+=P.turn;return{ev,T:t};
    }
    headway(n=this.trainsByWeek[this.round]||1){const T=this.loop().T;return T/n;}
    schedule(){const n=this.trainsByWeek[this.round]||P.trainsMin,{ev,T}=this.loop(),t0=this.roundStart[this.round];
      this.trains=Array.from({length:n},(_,k)=>({k,t0:t0-k*T/n,load:[],ev,T}));this.queues=[];this.lastT=this.t;}
    // where a train is now: [cell along the line as a fraction of an index] for drawing
    trainPos(tr){const {ev,T}=tr;if(!isFinite(T))return null;const ph=((this.t-tr.t0)%T+T)%T,st=this.stations.map(idxOf);
      for(let i=0;i<ev.length;i++){const a=ev[i],b=ev[i+1]||{s:0,dir:1,at:T};
        const dep=a.at+(i===0||a.s===st.length-1&&a.dir===-1?0:P.dwell);
        if(ph<a.at)continue;
        if(ph<=dep)return{at:st[a.s],dir:a.dir,stopped:true};
        if(ph<b.at){const f=(ph-dep)/Math.max(1e-6,b.at-dep),x=st[a.s]+(st[b.s]-st[a.s])*f;return{at:x,dir:b.s>a.s?1:b.s<a.s?-1:a.dir,stopped:false};}}
      return{at:st[0],dir:1,stopped:true};}
    // a week nobody set: the week before's trains (2 in week 1), within what the budget still allows
    fill(w){if(this.trainsByWeek[w]!==undefined)return;const [lo,hi]=this.trainsRange(w);this.trainsByWeek[w]=Math.max(lo,Math.min(hi,w?this.trainsByWeek[w-1]:2));}
    start(){if(this.started||this.stations.length<2)return false;
      this.fill(0);this.started=true;this.opening=this.stations.map(c=>c.slice());this.schedule();return true;}
    // ---- a person's usable trips: every (home station, destination station) pair with both ends near enough
    pairs(p){const o=D.origins[p.origin].cell,d=D.destinations[p.dest].cell,out=[];
      this.stations.forEach((a,i)=>this.stations.forEach((b,j)=>{if(i===j)return;const w=willing(walk(o,a))*willing(walk(b,d));if(w>0)out.push({i,j,w});}));
      return out;}
    // nobody can ride: which end has no station (or the only station near both ends is the same one)
    why(p){const o=D.origins[p.origin].cell,d=D.destinations[p.dest].cell;
      const home=this.stations.some(s=>willing(walk(o,s))>0),there=this.stations.some(s=>willing(walk(s,d))>0);
      return !home?'起點沒有站':!there?'終點沒有站':walk(o,d)<=6?'走路就到':'起點終點同一站';}
    outcome(p,state,why){p.state=state;if(why)p.why=why;this.active.delete(p);this.pending[p.wave]--;
      if(state==='car'){this.cars++;this.emit('car',p,{why});}else if(state==='delivered'){this.delivered++;this.emit('delivered',p);}else{this.walked++;this.emit('walked',p);}}
    decide(p){
      if(p.tpick>=this.habit[p.origin]){this.outcome(p,'car','習慣開車');return;}
      p.tried=true;const ps=this.pairs(p),k=slice(ps.map(x=>x.w),p.pick);
      if(k<0){const y=this.why(p);if(y==='走路就到'){p.tried=false;this.outcome(p,'walked',y);}else this.outcome(p,'car',y);return;}
      const {i,j}=ps[k];Object.assign(p,{state:'walk',from:i,to:j,dir:Math.sign(idxOf(this.stations[j])-idxOf(this.stations[i])),since:this.t,
        until:this.t+walk(D.origins[p.origin].cell,this.stations[i])*P.walkStep});
      this.active.add(p);this.emit('walk',p,{station:i});
    }
    queue(i,dir){const k=i*2+(dir>0?1:0);return this.queues[k]??=[];}
    queueAt(i,dir){return this.queue(i,dir);}
    step(){
      this.steps++;this.t=+(this.steps*P.tick).toFixed(4);const t=this.t,r=this.round,start=this.roundStart[r];
      // leave home through the week's release window (people are sorted by week, then by when they leave)
      while(this.ptr<this.people.length){const p=this.people[this.ptr];if(p.wave!==r||t<start+p.offset)break;p.born=t;this.ptr++;this.decide(p);}
      // on foot: reach the station (a full platform: give up and drive) or the destination (arrived)
      for(const p of [...this.active]){
        if(p.state==='walk'&&t>=p.until){const q=this.queue(p.from,p.dir);
          if(q.length>=P.platform){p.turned=true;this.emit('full',p,{station:p.from});this.outcome(p,'car','月台太擠');}
          else{p.state='queue';p.qsince=t;q.push(p);}}
        else if(p.state==='walkout'&&t>=p.until)this.outcome(p,'delivered');}
      // trains: every stop passed since the last step — people get off, then the queue boards (first come first served)
      const prev=this.lastT??t;
      for(const tr of this.trains)for(const e of tr.ev){
        const n=Math.ceil((prev-tr.t0-e.at)/tr.T-1e-9);
        for(let at=tr.t0+e.at+n*tr.T;at<=t+1e-9;at+=tr.T){if(at<=prev+1e-9)continue;
          const off=tr.load.filter(p=>p.to===e.s);
          for(const p of off){p.state='walkout';p.since=at;p.until=at+walk(this.stations[e.s],D.destinations[p.dest].cell)*P.walkStep;}
          if(off.length)tr.load=tr.load.filter(p=>p.to!==e.s);
          const q=this.queue(e.s,e.dir);
          while(q.length&&tr.load.length<P.cap){const p=q.shift();p.state='ride';tr.load.push(p);}
          if(q.length)this.emit('crowded',null,{station:e.s,dir:e.dir,left:q.length});}}
      this.lastT=t;
      // the week is over when every one of its people has an outcome; the next starts at once (habit learnt overnight)
      if(this.pending[r]===0&&t>=start+P.release){
        this.learn(r);
        if(r+1>=D.weeks){this.done=true;return;}
        this.round=r+1;this.roundStart[this.round]=t;this.fill(this.round);this.schedule();this.emit('round',null,{round:this.round});}
    }
    learn(w){const ok=p=>!p.turned&&p.state==='delivered';
      D.origins.forEach((o,i)=>{const ps=this.people.filter(p=>p.wave===w&&p.origin===i&&p.tried);const sat=ps.length?ps.filter(ok).length/ps.length:1;
        this.habit[i]=+Math.min(1,Math.max(D.habit.floor,this.habit[i]+D.habit.rate*(sat-this.habit[i]))).toFixed(4);});
      this.habitLog.push({week:w+1,habit:this.habit.slice()});this.emit('habit',null,{week:w});}
    advance(sec,opt={}){if(!this.started||this.done)return;this.acc+=Math.max(0,sec);const r0=this.round;
      while(this.acc+1e-9>=P.tick&&!this.done){this.acc-=P.tick;this.step();if(opt.stopAtRound&&this.round!==r0){this.acc=0;return;}}}
    runTo(w){while(this.started&&!this.done&&this.round<w)this.step();}
    // ---- the week's preview: with these stations and trains, who can ride, how full each platform gets
    forecast(w=this.round,stations=this.stations){
      const save=this.stations;this.stations=stations;
      const est=D.origins.map((o,i)=>({n:0,tries:0,ride:0,noHome:0,noThere:0,walk:0}));
      const load=stations.map(()=>({out:0,in:0})),dst=D.destinations.map(()=>({tries:0,ride:0}));
      for(const p of this.people){if(p.wave!==w)continue;const e=est[p.origin];e.n++;if(p.tpick>=this.habit[p.origin])continue;e.tries++;
        const ps=this.pairs(p),k=slice(ps.map(x=>x.w),p.pick),y=k<0?this.why(p):'';if(y==='走路就到'){e.tries--;e.walk++;continue;}
        dst[p.dest].tries++;if(k<0){if(y==='起點沒有站')e.noHome++;else e.noThere++;continue;}
        e.ride++;dst[p.dest].ride++;load[ps[k].i].out++;load[ps[k].j].in++;}
      this.stations=save;return{est,load,dst};}
    stats(){return{delivered:this.delivered,cars:this.cars,walked:this.walked,week:this.round,done:this.done};}
  }
  const API={D,P,Game,reset,walk,willing,idxOf,slice,same,key,rng};
  if(typeof module!=='undefined')module.exports=API;root.Metro=API;
})(typeof window!=='undefined'?window:globalThis);
