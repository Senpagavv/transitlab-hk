(function(root) {
  'use strict';
  const same=(a,b)=>a&&b&&a[0]===b[0]&&a[1]===b[1];const key=c=>c.join(',');
  const clonePlan=(p,Plan)=>{const q=new Plan();Object.assign(q,JSON.parse(JSON.stringify({...p})));return q;};
  const n4=c=>[[c[0]+1,c[1]],[c[0]-1,c[1]],[c[0],c[1]+1],[c[0],c[1]-1]];
  function search(level,engine,seconds) {const started=Date.now(),limit=Math.max(.1,Number(seconds)||20),deadline=started+limit*1000;if(!level||!engine||!engine.D||!engine.Plan)return {best:0,bestPlan:null,seconds:0,quickMaster:false,iterations:0};engine.D.use(level,'levelgen');engine.reset();const {D,Plan,G}=engine;const poi=[],seen=new Set();for(const c of [...D.origins.map(x=>x.cell),...D.destinations.map(x=>x.cell),...G.lines.flatMap(l=>l.stations)])if(Array.isArray(c)&&c.length===2&&c[0]>=0&&c[1]>=0&&c[0]<D.cols&&c[1]<D.rows&&!seen.has(key(c))){seen.add(key(c));poi.push(c.slice());}if(poi.length<2)return {best:0,bestPlan:null,seconds:+((Date.now()-started)/1000).toFixed(2),quickMaster:false,iterations:0};let seed=531,iterations=0,best={score:0,p:null},simpleBest=0;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;},pick=a=>a[Math.floor(rnd()*a.length)],score=p=>{const v=p.stations.length>=2?p.simulate().total:0;if(p.stations.length===2&&p.trains===1&&p.line.length<=6)simpleBest=Math.max(simpleBest,v);return v;};
  function routePlan(){for(let attempt=0;attempt<24&&Date.now()<deadline;attempt++){const count=2+Math.floor(rnd()*3),pts=[];for(let guard=0;guard<24&&pts.length<count;guard++){const c=pick(poi);if(!pts.some(x=>same(x,c)))pts.push(c);}if(pts.length<2)continue;const p=new Plan();let ok=p.extend(pts[0]);for(let j=1;j<pts.length&&ok;j++){let c=p.line.at(-1).slice(),t=pts[j],hFirst=rnd()<.5;const stepTo=axis=>{while(ok&&c[axis]!==t[axis]){c=c.slice();c[axis]+=Math.sign(t[axis]-c[axis]);if(!p.extend(c))ok=false;}};if(hFirst){stepTo(0);stepTo(1);}else{stepTo(1);stepTo(0);}}if(!ok||p.line.length<2)continue;for(const c of poi)if(p.onLine(c)&&p.canStation(c))p.toggleStation(c);if(p.stations.length<2)continue;while(p.canTrain()&&rnd()<.35)p.addTrain();return p;}return null;}
  function moves(p){const out=[];for(const e of [p.line[0],p.line.at(-1)])if(e){for(const c of n4(e))if(p.canExtend(c))out.push(q=>q.extend(c));if(p.line.length>2)out.push(q=>q.shorten(e));}for(const c of p.line)if(p.isStation(c)||p.canStation(c))out.push(q=>q.toggleStation(c));p.line.forEach((c,j)=>{if(!p.isStation(c))return;for(const n of [p.line[j-1],p.line[j+1]])if(n&&!p.isStation(n))out.push(q=>{q.toggleStation(c);q.toggleStation(n);});});if(p.canTrain())out.push(q=>q.addTrain());if(p.canUntrain())out.push(q=>q.removeTrain());return out;}
  const simpleDeadline=started+Math.min(2,limit*.2)*1000;
  for(let i=0;i<poi.length&&Date.now()<simpleDeadline;i++)for(let j=i+1;j<poi.length&&Date.now()<simpleDeadline;j++){
    for(const firstAxis of [0,1]){
      if(Date.now()>=simpleDeadline)break;
      const p=new Plan(),target=poi[j];let cell=poi[i].slice(),ok=p.extend(cell);
      for(const axis of [firstAxis,1-firstAxis])while(ok&&cell[axis]!==target[axis]){
        cell=cell.slice();cell[axis]+=Math.sign(target[axis]-cell[axis]);ok=p.extend(cell);
      }
      if(!ok)continue;
      for(const c of [poi[i],target])if(p.canStation(c))p.toggleStation(c);
      if(p.stations.length<2)continue;
      const v=score(p);iterations++;if(v>best.score)best={score:v,p:clonePlan(p,Plan)};
    }
  }
  while(Date.now()<deadline){let p=routePlan();if(!p)break;let sc=score(p);iterations++;if(sc>best.score)best={score:sc,p:clonePlan(p,Plan)};for(let step=0;step<120&&Date.now()<deadline;step++){let next=null,ns=sc;for(const move of moves(p)){if(Date.now()>=deadline)break;const q=clonePlan(p,Plan);move(q);if(q.stations.length<2)continue;const v=score(q);iterations++;if(v>ns+1e-9){ns=v;next=q;}if(v>best.score){best={score:v,p:clonePlan(q,Plan)};}}if(!next)break;p=next;sc=ns;}if(Date.now()>=deadline)break;}
  const p=best.p,bestInt=Math.max(0,Math.round(best.score)),bestPlan=p?{line:p.line.map(c=>c.slice()),stations:p.stations.map(c=>c.slice()),trains:p.trains,spent:level.budget-p.money,score:bestInt}:null,tiers=[.4,.65,.88].map(x=>Math.round(bestInt*x));level.tiers=tiers;engine.D.use(level,'levelgen');engine.reset();return {best:bestInt,bestPlan,tiers,seconds:+((Date.now()-started)/1000).toFixed(2),simpleBest:Math.round(simpleBest),quickMaster:bestInt>0&&simpleBest>=tiers[2],iterations};}
  const API={search};if(typeof module!=='undefined'&&module.exports)module.exports=API;root.LevelBot=API;
})(typeof window!=='undefined'?window:globalThis);
