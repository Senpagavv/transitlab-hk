'use strict';
// v7 mode 3 (roads that jam: the metro against the roads, Kowloon East) · tune the level and find the AI demo plans: local search over line,
// stations and trains within the budget, scored on the eight-year total; starts from routes through 2–4 of the estates
// and destinations (L-shaped legs), then extends, shortens, moves stations and trains one step at a time.
//   node bots/v7_metro_grow.js [restarts=400] ['{"nearby":10,"att":[24,22],"extra":[3,7],"spread":2}'] [--write]
// att: the destinations' attractions; extra: each destination's car parking and access in blocks; any other key goes
// into the level as it is (walkPer, budget, …). --write: save the pass / high / master plans to
// v7/mode3-roads/demo-plans.js for the AI demo.
const fs=require('node:fs'),path=require('node:path');
const M=require('../v7/mode3-roads/engine.js'),{D,P,Plan,same}=M;
const args=process.argv.slice(2),write=args.includes('--write'),pos=args.filter(a=>a!=='--write');
const restarts=+(pos[0]||400),o=pos[1]?JSON.parse(pos[1]):{};
const base=D.example('m3-1'),def={...base};
for(const [k,v] of Object.entries(o)){if(k==='att')def.destinations=def.destinations.map((d,j)=>({...d,attraction:v[j]}));
  else if(k==='extra')def.destinations=def.destinations.map((d,j)=>({...d,carExtra:v[j]}));
  else if(k==='spread')def.aware={...def.aware,spread:v};else def[k]=v;}
D.use(def,'probe');M.reset();
let seed=11;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const pick=a=>a[Math.floor(rnd()*a.length)];
const total=p=>p.stations.length>=2?p.simulate().total:0;
// places worth a stop: estates, business areas, and the stations already there (to change lines)
const POI=[...D.origins.map(o=>o.cell),...D.destinations.map(d=>d.cell),...M.G.lines.flatMap(l=>l.stations)];
// a route through 2–4 places, each leg an L (horizontal or vertical first); stations on the places it passes
function routePlan(){
  for(let tries=0;tries<50;tries++){const n=2+Math.floor(rnd()*3),pts=[];while(pts.length<n){const c=pick(POI);if(!pts.some(x=>same(x,c)))pts.push(c);}
    const p=new Plan();let ok=p.extend(pts[0]);
    for(let j=1;j<pts.length&&ok;j++){let c=p.line.at(-1).slice();const t=pts[j],hFirst=rnd()<.5;
      const stepTo=axis=>{while(ok&&c[axis]!==t[axis]){c=c.slice();c[axis]+=Math.sign(t[axis]-c[axis]);if(!p.extend(c))ok=false;}};
      if(hFirst){stepTo(0);stepTo(1);}else{stepTo(1);stepTo(0);}}
    if(!ok||p.line.length<2)continue;
    for(const c of POI)if(p.onLine(c)&&p.canStation(c))p.toggleStation(c);
    if(p.stations.length<2)continue;
    while(p.canTrain()&&rnd()<.5)p.addTrain();
    return p;}
  return null;}
const cp=p=>{const q=new Plan();Object.assign(q,JSON.parse(JSON.stringify({...p})));return q;};
const N4=c=>[[c[0]+1,c[1]],[c[0]-1,c[1]],[c[0],c[1]+1],[c[0],c[1]-1]];
function moves(p){const out=[];
  for(const e of [p.line[0],p.line.at(-1)])if(e){for(const n of N4(e))if(p.canExtend(n))out.push(q=>q.extend(n));if(p.line.length>2)out.push(q=>q.shorten(e));}
  for(const c of p.line)if(p.isStation(c)||p.canStation(c))out.push(q=>q.toggleStation(c));
  p.line.forEach((c,j)=>{if(!p.isStation(c))return;for(const n of [p.line[j-1],p.line[j+1]])if(n&&!p.isStation(n))out.push(q=>{q.toggleStation(c);q.toggleStation(n);});});
  if(p.canTrain())out.push(q=>q.addTrain());if(p.canUntrain())out.push(q=>q.removeTrain());
  return out;}
function climb(){let p=routePlan();if(!p)return null;let s=total(p);
  for(let it=0;it<200;it++){let best=null,bs=-1;for(const m of moves(p)){const q=cp(p);m(q);if(q.stations.length<2)continue;const v=total(q);if(v>bs){bs=v;best=q;}}
    if(!best||bs<=s+1e-9)break;p=best;s=bs;}
  return{p,s};}
const found=[];for(let r=0;r<restarts;r++){const f=climb();if(f)found.push(f);}found.sort((a,b)=>b.s-a.s);
const q=f=>Math.round(found[Math.floor(f*(found.length-1))].s);
const b=found[0].p,run=b.simulate(),pot=b.potential();
const fmt=p=>`line ${p.line.map(c=>c.join(',')).join(' ')} · stations ${p.stations.map(c=>c.join(',')).join(' ')} · trains ${p.trains} · left ${p.money}`;
console.log(JSON.stringify(o),`· best ${Math.round(found[0].s)} · local optima p90 ${q(.1)} median ${q(.5)} p25 ${q(.75)} (${found.length})`);
console.log('  '+fmt(b));
console.log(`  jam ${run.log.map(l=>Math.round(l.jam)+(l.crowdedSections?'!':'')).join(' ')} (do nothing ${Math.round(M.G.doNothing[0])}) · new line a day ${run.log.map(l=>Math.round(l.onNew)).join(' ')} · aware ${run.aware.map(a=>a.toFixed(2)).join(',')}`);
console.log('  destinations before → settled:',pot.dest.map((d,k)=>`${D.destinations[k].name} ${Math.round(d.before)}→${Math.round(d.go)} (metro ${Math.round(d.metro)})`).join(' | '),'· drivers',Math.round(M.G.base.drivers),'→',Math.round(pot.drivers));
// the demo plans: the lowest optimum that clears each line, the best for master
const tiers=D.tiers,plans={tiers,best:Math.round(found[0].s)};
// clean plans read well in a demo: never crowded, no two stations side by side; pass and high take the cheapest
const clean=f=>{const r=f.p.simulate();return !r.log.some(l=>l.crowdedSections)&&!f.p.line.some((c,j)=>j&&f.p.isStation(c)&&f.p.isStation(f.p.line[j-1]));};
['pass','high','master'].forEach((name,j)=>{const above=found.filter(f=>f.s>=tiers[j]&&(j===2||f.s<tiers[j+1]));
  const size=f=>P.budget-f.p.money,simple=above.filter(clean).sort((x,y)=>size(x)-size(y)||x.s-y.s)[0];   // the cheapest clean plan
  const c=name==='master'?found[0]:simple||above.at(-1);
  if(!c){console.log(`  ${name}: no plan clears ${tiers[j]}`);return;}
  plans[name]={line:c.p.line,stations:c.p.stations,trains:c.p.trains,score:Math.round(c.s)};console.log(`  ${name} ${tiers[j]} → ${Math.round(c.s)}: ${fmt(c.p)}`);});
if(write){const f=path.join(__dirname,'../v7/mode3-roads/demo-plans.js');
  fs.writeFileSync(f,`// v7 mode 3 · AI demo plans, written by bots/v7_metro_grow.js (${new Date(Date.now()+8*3600e3).toISOString().slice(0,10)}). Do not edit by hand.\n`+
    `// level → {tiers, best, pass|high|master: {line, stations, trains, score}}\n(function(root){root.TL_ROADS_DEMO={"m3-1":${JSON.stringify(plans)}};})(typeof window!=='undefined'?window:globalThis);\n`);
  console.log('written',f);}
