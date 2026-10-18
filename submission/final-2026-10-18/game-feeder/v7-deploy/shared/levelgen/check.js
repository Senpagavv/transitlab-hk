(function(root) {
  'use strict';
  const key=c=>Array.isArray(c)?String(c[0])+','+String(c[1]):'';
  const undirected=(a,b)=>[key(a),key(b)].sort().join('|');
  function rank(values) { const order=values.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v),out=new Array(values.length); for(let i=0;i<order.length;){let j=i+1;while(j<order.length&&order[j].v===order[i].v)j++;const r=(i+j-1)/2;for(let k=i;k<j;k++)out[order[k].i]=r;i=j;}return out;}
  function correlation(a,b) { if(a.length<2)return 0;const x=rank(a),y=rank(b),mx=x.reduce((s,v)=>s+v,0)/x.length,my=y.reduce((s,v)=>s+v,0)/y.length;let n=0,dx=0,dy=0;for(let i=0;i<x.length;i++){n+=(x[i]-mx)*(y[i]-my);dx+=(x[i]-mx)**2;dy+=(y[i]-my)**2;}return dx&&dy?n/Math.sqrt(dx*dy):0;}
  function median(a) {if(!a.length)return 1;const b=a.slice().sort((x,y)=>x-y);return b[Math.floor(b.length/2)];}
  function targetLookup(level) {
    const out=new Map();
    for(const road of level.source&&level.source.roadSections||[]){
      for(const s of road.segments||[road]){
        const v=Number(s.modelVC);if(!Number.isFinite(v)||!Array.isArray(s.a)||!Array.isArray(s.b))continue;
        const k=undirected(s.a,s.b);if(!out.has(k))out.set(k,[]);out.get(k).push(v);
      }
    }
    return out;
  }
  function ranking(engine,level) {
    const refs=targetLookup(level),model=[],game=[],rows=[];
    for(const s of engine.G.sections){
      if(s.cap<=0)continue;
      const arr=refs.get(undirected(s.a,s.b)),target=arr&&arr.length?median(arr):null;
      const actual=(engine.G.base.roadLoad[s.id]||0)/s.cap;
      if(target!=null&&target>=0&&Number.isFinite(actual)){model.push(target);game.push(actual);}
      for(const name of s.roads||[''])rows.push({model:target,game:actual,name});
    }
    const topBy=field=>{
      const byName=new Map();
      for(const r of rows){if(r[field]==null||!Number.isFinite(r[field]))continue;const old=byName.get(r.name);if(!old||r[field]>old[field])byName.set(r.name,r);}
      return [...byName.values()].sort((a,b)=>b[field]-a[field]).slice(0,7).map(r=>({name:r.name,vc:+r[field].toFixed(2)}));
    };
    return {sections:model.length,spearman:+correlation(model,game).toFixed(3),modelTop:topBy('model'),gameTop:topBy('game')};
  }
  function setRoadCaps(level,coeff) {
    const src=level.source||{},meta=src.roadSections||[],scale=Number(src.scale)||0;
    level.roads.forEach((r,i)=>{
      const x=meta[i];if(!x)return;
      const base=Math.max(.1,Number(x.modelCap)*scale)*coeff;
      r.cap=base*(Number(x.capFactor)||Number(x.changeMultiplier)||1);
      if(x.capGrowFactors)r.grow=x.capGrowFactors.map(p=>[p[0],base*p[1]]);
    });
    src.roadCapCoeff=coeff;
  }
  function calibrateRoads(level,engine) {if(!level||!engine||!engine.D||!engine.reset)return {coefficient:1,ranking:null,notes:['无法载入第三关引擎，未校准道路容量。']};const meta=level.source&&level.source.roadSections||[];if(!meta.length)return {coefficient:1,ranking:null,notes:['没有来源道路段，容量系数保留 1。']};const refs=targetLookup(level),coeffs=[.2,.35,.5,.7,.85,1,1.2,1.5,2,3,4];setRoadCaps(level,1);engine.D.use(level,'levelgen-probe');engine.reset();const ratios=[];for(const s of engine.G.sections){const vals=refs.get(undirected(s.a,s.b));if(!vals||!vals.length)continue;const target=median(vals),actual=(engine.G.base.roadLoad[s.id]||0)/s.cap;if(target>0&&actual>0)ratios.push(actual/target);}const guess=Math.max(.05,Math.min(20,median(ratios)));coeffs.push(guess,guess*.75,guess*1.25);let best=null;for(const c of [...new Set(coeffs.map(x=>+x.toFixed(5)))]){setRoadCaps(level,c);engine.D.use(level,'levelgen-probe');engine.reset();const r=ranking(engine,level),errs=[];for(const s of engine.G.sections){const vals=refs.get(undirected(s.a,s.b));if(!vals||!vals.length)continue;const target=median(vals),actual=(engine.G.base.roadLoad[s.id]||0)/s.cap;if(target>0)errs.push(Math.abs(Math.log((actual+.01)/(target+.01))));}const error=errs.length?errs.reduce((a,b)=>a+b,0)/errs.length:Infinity,ys=engine.G.doNothing||[];let maxJump=0;for(let i=1;i<ys.length;i++)maxJump=Math.max(maxJump,Math.abs(ys[i]-ys[i-1])/Math.max(Math.abs(ys[i-1]),1e-9));const stabilityPenalty=maxJump<.1?0:5+maxJump,score=r.spearman-.15*error-stabilityPenalty;if(!best||score>best.score)best={coefficient:c,score,error,maxJump};}setRoadCaps(level,best?best.coefficient:1);engine.D.use(level,'levelgen');engine.reset();const r=ranking(engine,level);return {coefficient:best?best.coefficient:1,ranking:r,notes:['道路容量统一系数搜索结果：'+(best?best.coefficient:1).toFixed(3)+'；匹配 '+r.sections+' 段，Spearman='+r.spearman+'；系数搜索内最大逐年跳变 '+(100*(best?best.maxJump:0)).toFixed(1)+'%。']};}
  function check(level,engine,botResult) {
    const problems=[],notes=[];
    if(!level||!engine||!engine.D)return {report:{doNothing:{yearly:[],jam:0,stable:false},best:0,bestPlan:null,tiers:[0,0,0],seconds:0},problems:[{code:'invalid_input',message:'关卡或第三关引擎不可用。'}],notes};
    engine.D.use(level,'levelgen');engine.reset();
    if([...level.origins,...level.destinations].some(x=>x.grow)&&typeof engine.valueAt!=='function')problems.push({code:'invalid_input',message:'此第三关引擎版本不支持人口/岗位 grow；按年变化未得到真实验收。'});
    if(level.roads.some(x=>x.grow)&&typeof engine.capAt!=='function')problems.push({code:'invalid_input',message:'此第三关引擎尚未提供道路容量 grow 接口；道路按年变化未得到真实验收。'});
    const yearly=(engine.G.doNothing||[]).map(v=>+Number(v||0).toFixed(3)),jam=yearly.reduce((s,v)=>s+v,0);let maxStepPct=0,stable=true;
    for(let i=1;i<yearly.length;i++){const pct=Math.abs(yearly[i]-yearly[i-1])/Math.max(Math.abs(yearly[i-1]),1e-9);maxStepPct=Math.max(maxStepPct,pct);if(pct>=.10)stable=false;}
    let emptyScore=0,emptyPer=engine.G.base.perceived.slice(),emptyCrowd=engine.G.base.crowdedStart;
    const unaware=level.origins.map(()=>0);
    for(let t=1;t<=yearly.length;t++){
      const y=engine.year(null,unaware,emptyPer,emptyCrowd,t);
      emptyScore+=(engine.G.doNothing[t-1]||0)-y.jam;
      emptyPer=engine.learnFrom(emptyPer,y);emptyCrowd=engine.learnCrowd(emptyCrowd,y);
    }
    const doNothing={yearly,jam:+jam.toFixed(3),score:Math.round(emptyScore),stable,maxStepPct:+maxStepPct.toFixed(4)};
    if(jam<=0)problems.push({code:'nothing_to_solve',message:'什么都不做的道路塞车为 0。'});
    if(!stable)problems.push({code:'unstable_traffic',message:'什么都不做的逐年塞车变化最大为 '+(maxStepPct*100).toFixed(1)+'%，超过 10%。'});
    if(!level.origins.length||!level.destinations.length)problems.push({code:'box_empty',message:'关卡缺少屋苑或去处。'});
    const unreachable=[];
    const water=new Set((level.water||[]).map(key));
    for(const x of [...level.origins,...level.destinations])if(x.cell[0]<0||x.cell[1]<0||x.cell[0]>=level.cols||x.cell[1]>=level.rows||water.has(key(x.cell)))unreachable.push(x.name+' 位于水域或超出关卡边界');
    for(let i=0;i<level.origins.length;i++){const routes=engine.G.carOD[i]||[];if(!routes.length||routes.every(r=>!r.sections.length))unreachable.push('屋苑 '+level.origins[i].name+' 在 1 格接驳范围内没有可用路段');}
    for(const d of level.destinations){const reachable=[...(engine.G.roadNodes||new Map()).values()].some(n=>Math.abs(n.cell[0]-d.cell[0])+Math.abs(n.cell[1]-d.cell[1])<=1);if(!reachable)unreachable.push('去处 '+d.name+' 在 1 格接驳范围内没有可用路段');}
    let transitPairs=0;for(const o of level.origins)for(const d of level.destinations)if(engine.metroTrip(engine.G.netOld,o.cell,d.cell,{}))transitPairs++;
    if(!transitPairs)unreachable.push('现有港铁没有一组屋苑至去处可达路径');if(unreachable.length)problems.push({code:'unreachable',message:unreachable.join('；')});
    const roadRank=ranking(engine,level);roadRank.acceptable=roadRank.sections>=3?roadRank.spearman>=.2:null;
    if(roadRank.acceptable===false){problems.push({code:'model_vc_mismatch',message:'游戏与模型 v/c 排名 Spearman='+roadRank.spearman+'，低于第一版粗对照阈值0.2。'});notes.push('单一容量系数未能让模型堵点排名与游戏接近，需检查穿境流量、OD 简化及格网道路合并。');}
    const best=Number(botResult&&botResult.best)||0,bestPlan=botResult&&botResult.bestPlan||null,tiers=[.4,.65,.88].map(x=>Math.round(best*x));level.tiers=tiers;
    if(best<50)problems.push({code:'nothing_to_solve',message:'限时局部搜索最好分低于第一版最低门槛 50。'});
    const simpleBest=Number(botResult&&botResult.simpleBest)||0;
    const easy=best>=50&&(simpleBest>=tiers[2]||(tiers[0]>0&&doNothing.score>=tiers[0]));if(easy)problems.push({code:'too_easy',message:doNothing.score>=tiers[0]?'什么都不做已经达到第一档门槛。':'六格以内、两站、单列车方案已达到最终大师门槛。'});
    return {report:{accepted:problems.length===0,doNothing,best,bestPlan,tiers,seconds:+Number(botResult&&botResult.seconds||0).toFixed(2),simpleBest:Math.round(simpleBest),iterations:Number(botResult&&botResult.iterations)||0,roadRank},problems,notes};
  }
  const API={check,calibrateRoads,ranking,correlation};if(typeof module!=='undefined'&&module.exports)module.exports=API;root.LevelChecker=API;
})(typeof window!=='undefined'?window:globalThis);
