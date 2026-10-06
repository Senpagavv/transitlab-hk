'use strict';
// Bot players shared by evaluate.js (one report) and sweep.js (parameter search).
module.exports=function bots(E){
  const {Game,D,P,dist}=E,n=D.candidates.length;
  const willing=E.willing||(s=>1/(1+(s/(P.spread||3.8))**2));
  const comes=E.comes||((k,w)=>k*w);
  const headway=c=>P.headwayBase+dist(c,D.hub)*P.headwayStep;
  const layouts=[];
  for(let a=0;a<n-2;a++)for(let b=a+1;b<n-1;b++)for(let c=b+1;c<n;c++)layouts.push([a,b,c]);

  function play(layout,moves=[],seed=1781){
    const g=new Game(seed);layout.forEach((c,id)=>g.place(id,D.candidates[c]));g.start();
    for(const m of [...moves].sort((a,b)=>a.time-b.time)){g.advance(m.time-g.t);g.place(m.id,D.candidates[m.to]);}
    g.advance(P.duration-g.t+1);return g;
  }
  const summary=(g,layout,moves=[])=>({layout,moves,delivered:g.delivered,cars:g.cars,missed:g.missed,
    full:g.events.filter(e=>e.type==='full').length,longWait:g.events.filter(e=>e.why==='久候返家').length});

  // What a player can work out from the map: each estate walks to its best stop (the share shown),
  // and a stop offers seats × departures in the round.
  function estimate(layout,useCapacity){
    const cells=layout.map(i=>D.candidates[i]),load=cells.map(()=>0);
    D.origins.forEach((o,i)=>{let best=-1,bw=0;
      cells.forEach((c,s)=>{const w=E.shareAt?E.shareAt(i,c):willing(dist(o.cell,c));if(w>bw||w===bw&&w>0&&best>=0&&headway(c)<headway(cells[best])){bw=w;best=s;}});
      if(best>=0)load[best]+=D.waves.reduce((sum,w)=>sum+comes(w[i],bw),0);});
    if(!useCapacity)return load.reduce((a,b)=>a+b,0);
    return cells.reduce((sum,c,s)=>sum+Math.min(load[s],P.seats*Math.floor((P.duration-headway(c))/headway(c))),0);
  }

  // A tide-table player: before each announced peak, move the stop serving the fewest people
  // in that batch to the free candidate the peaking estate likes best; optionally move it back.
  function tideMoves(start,lead,back,floatId=null){
    if(!D.peaks)return[];
    const moves=[];let cells=start.slice();
    for(const pk of [...D.peaks].sort((a,b)=>a.wave-b.wave)){
      const t=Math.max(1,P.firstWave+pk.wave*P.interval-lead),o=D.origins[pk.origin];
      const free=D.candidates.map((c,i)=>i).filter(i=>!cells.includes(i));
      const score=i=>E.shareAt?E.shareAt(pk.origin,D.candidates[i]):willing(dist(o.cell,D.candidates[i]));
      const target=free.sort((a,b)=>score(b)-score(a)||headway(D.candidates[a])-headway(D.candidates[b]))[0];
      const served=cells.map(()=>0);
      D.origins.forEach((oo,k)=>{const ws=cells.map(ci=>E.shareAt?E.shareAt(k,D.candidates[ci]):willing(dist(oo.cell,D.candidates[ci])));const m=Math.max(...ws);if(m>0)served[ws.indexOf(m)]+=D.waves[pk.wave][k]*m;});
      // either the stop doing least right now, or one "floating" stop that follows every peak
      const id=floatId??served.indexOf(Math.min(...served));
      if(score(cells[id])>=score(target))continue;          // already where this peak needs it
      if(moves.length>=P.moves)break;
      moves.push({time:t,id,to:target});const from=cells[id];cells[id]=target;
      if(back&&moves.length<P.moves){moves.push({time:P.firstWave+pk.wave*P.interval+P.release+back,id,to:from});cells[id]=from;}
    }
    return moves;
  }
  function chasers(starts,leads=[30,60,120,180],backs=[0,60,150]){
    const out=[];
    for(const start of starts)for(const lead of leads)for(const back of backs)for(const floatId of [null,0,1,2]){
      const moves=tideMoves(start,lead,back,floatId);if(!moves.length)continue;
      out.push({...summary(play(start,moves),start,moves),lead,back,floatId});
    }
    return out.sort((a,b)=>b.delivered-a.delivered);
  }
  // Greedy search: every 30 s try each single move, keep the best. An upper bound for skilled play.
  function greedy(start,budget=P.moves,step=30){
    let moves=[],best=play(start).delivered;
    for(let t=step;t<P.duration-120&&moves.length<budget;t+=step){
      let pick=null;const cells=start.slice();for(const m of moves)cells[m.id]=m.to;
      for(let id=0;id<3;id++)for(let to=0;to<n;to++){if(cells.includes(to))continue;
        const d=play(start,[...moves,{time:t,id,to}]).delivered;if(d>best+1&&(!pick||d>pick.d))pick={d,m:{time:t,id,to}};}
      if(pick){moves.push(pick.m);best=pick.d;}
    }
    return summary(play(start,moves),start,moves);
  }
  function spearman(xs,ys){
    const rank=v=>{const idx=v.map((x,i)=>[x,i]).sort((a,b)=>a[0]-b[0]),r=Array(v.length);
      for(let i=0;i<idx.length;){let j=i;while(j+1<idx.length&&idx[j+1][0]===idx[i][0])j++;for(let k=i;k<=j;k++)r[idx[k][1]]=(i+j)/2;i=j+1;}return r;};
    const a=rank(xs),b=rank(ys),m=a.length,ma=a.reduce((s,x)=>s+x,0)/m,mb=b.reduce((s,x)=>s+x,0)/m;
    let num=0,da=0,db=0;for(let i=0;i<m;i++){num+=(a[i]-ma)*(b[i]-mb);da+=(a[i]-ma)**2;db+=(b[i]-mb)**2;}
    return da&&db?num/Math.sqrt(da*db):0;
  }
  // Everything except the slow greedy search.
  function core(){
    const statics=layouts.map(l=>summary(play(l),l)),actual=statics.map(s=>s.delivered);
    const sorted=[...actual].sort((a,b)=>a-b),pct=q=>sorted[Math.floor(q*(sorted.length-1))];
    const coverage=layouts.map(l=>estimate(l,false)),capped=layouts.map(l=>estimate(l,true));
    const pickBy=arr=>statics[arr.indexOf(Math.max(...arr))];
    const novice=pickBy(coverage),reader=pickBy(capped),bestStatic=statics[actual.indexOf(sorted.at(-1))];
    const chase=chasers([novice.layout,reader.layout,bestStatic.layout]);
    return{statics,dist:{min:pct(0),p25:pct(.25),median:pct(.5),p75:pct(.75),p90:pct(.9),max:pct(1)},
      legibility:{coverage:+spearman(coverage,actual).toFixed(3),capacity:+spearman(capped,actual).toFixed(3)},
      novice,reader,bestStatic,bestChaser:chase[0]||null,demand:D.waves.flat().reduce((a,b)=>a+b,0)};
  }
  return{layouts,play,summary,estimate,tideMoves,chasers,greedy,spearman,core,headway,willing,comes};
};
