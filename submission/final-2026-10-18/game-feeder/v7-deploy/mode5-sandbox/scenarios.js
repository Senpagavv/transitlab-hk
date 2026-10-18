/* Scenario input adapter. No simulation equations are changed. */
(function(root){
  'use strict';
  const purposes=['HBW','HBS','HBO','NHB','CBS','CBR','CBV'];
  function adjust(demand,configs,weights){
    if(!configs||!Object.values(configs).some(c=>Object.values(c).some(Number)))return {demand,audit:{unchanged:true,zones:{}}};
    const sum=rows=>rows.reduce((n,p)=>n+p[2]+p[3],0),totals=new Map(),weighted=new Map(),factors=new Map(),audit={unchanged:false,zones:{}};
    const cfg=id=>configs[String(id)]||{};
    for(let i=0;i<demand.zones.length;i++){
      const id=String(demand.zones[i]),c=cfg(id),p=weights.zones[id]||{},all=purposes.reduce((n,k)=>n+(p[k]||0),0);
      const people=1+(c.people||0)/100,age={HBW:1+(c.adult||0)/100,HBS:1+(c.child||0)/100,HBO:1+(c.elder||0)/100};
      const weightedPurpose=purposes.reduce((n,k)=>n+(p[k]||0)*(age[k]??1),0);
      factors.set(i,people*(all?weightedPurpose/all:1));
      audit.zones[id]={factor:factors.get(i),purposes:Object.fromEntries(purposes.map(k=>[k,(p[k]||0)*people*(age[k]??1)])),sourcePurposes:p};
    }
    for(const p of demand.pairs){const n=p[2]+p[3],a=Math.max(.5,1+(cfg(demand.zones[p[1]]).attraction||0)/100);totals.set(p[0],(totals.get(p[0])||0)+n);weighted.set(p[0],(weighted.get(p[0])||0)+n*a);}
    const pairs=demand.pairs.map(p=>{const a=Math.max(.5,1+(cfg(demand.zones[p[1]]).attraction||0)/100),den=weighted.get(p[0]),normal=den?(totals.get(p[0])||0)/den:1,f=(factors.get(p[0])||1)*a*normal;const row=p.slice();row[2]*=f;row[3]*=f;return row;});
    const byOrigin=new Map();for(const p of pairs)byOrigin.set(p[0],(byOrigin.get(p[0])||0)+p[2]+p[3]);for(const [i,total] of totals){const a=audit.zones[String(demand.zones[i])];a.before=total;a.after=byOrigin.get(i)||0;a.expected=total*factors.get(i);}
    audit.totalBefore=sum(demand.pairs);audit.totalAfter=sum(pairs);return {demand:{...demand,pairs},audit};
  }
  // Keep the published road baseline, adding only the change in OD vehicles along the engine's own routes.
  function roadInputs(prepared,original,adjusted){
    if(adjusted===original)return original;
    const loads=Float64Array.from(prepared.sections,s=>s.load);
    adjusted.pairs.forEach((p,i)=>{const delta=(p[2]-original.pairs[i][2])/root.SandboxEngine.CAR_OCCUPANCY;if(delta)for(const section of prepared.routes[i])loads[section]+=delta;});
    return {...adjusted,sections:prepared.sections.map((s,i)=>[s.id,Math.max(0,loads[i]),Math.max(0,loads[i])/s.cap])};
  }
  const api={adjust,roadInputs,purposes};root.SandboxScenarios=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
