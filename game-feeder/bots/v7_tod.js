'use strict';
const fs=require('node:fs'),path=require('node:path');
const M=require('../v7/mode4-tod/engine.js'),{D,P,Plan,same}=M;
// --level <file.json>: tune a level file (v7/levels/README.md) instead of the mode's own level; prints, never writes
const argv=process.argv.slice(2),lvAt=argv.indexOf('--level'),levelFile=lvAt>=0?argv[lvAt+1]:null,args=argv.filter((_,i)=>lvAt<0||(i!==lvAt&&i!==lvAt+1)),write=args.includes('--write')&&!levelFile,pos=args.filter(x=>x!=='--write');
if(levelFile){const e=JSON.parse(require('node:fs').readFileSync(levelFile,'utf8'));D.use(e.level,e.key);M.reset();console.log('level file '+levelFile+' → '+e.key);}
const restarts=+(pos[0]||60),opts=pos[1]?JSON.parse(pos[1]):{};
const def=(levelFile?JSON.parse(JSON.stringify(D)):D.example('m4-1'));
for(const [k,v] of Object.entries(opts)){
  if(k==='att')def.destinations=def.destinations.map((d,i)=>({...d,attraction:v[i]}));
  else if(k==='extra')def.destinations=def.destinations.map((d,i)=>({...d,carExtra:v[i]}));
  else def[k]=v;
}
D.use(def,'bot');M.reset();
let seed=101;
const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const pick=a=>a[Math.floor(rnd()*a.length)],sameKey=p=>JSON.stringify([p.line,p.stations,p.trains]);
const POI=[...D.origins.map(o=>o.cell),...D.destinations.map(d=>d.cell)];
function routePlan(){
  for(let tries=0;tries<60;tries++){
    const n=2+Math.floor(rnd()*3),pts=[];
    while(pts.length<n){const c=pick(POI);if(!pts.some(x=>same(x,c)))pts.push(c);}
    const p=new Plan();let ok=p.extend(pts[0]);
    for(let j=1;j<pts.length&&ok;j++){
      let c=p.line.at(-1).slice(),t=pts[j],hf=rnd()<.5;
      const step=axis=>{while(ok&&c[axis]!==t[axis]){c=c.slice();c[axis]+=Math.sign(t[axis]-c[axis]);if(!p.extend(c))ok=false;}};
      if(hf){step(0);step(1);}else{step(1);step(0);}
    }
    if(!ok)continue;
    for(const c of POI)if(p.onLine(c)&&p.canStation(c))p.toggleStation(c);
    if(p.stations.length<2)continue;
    while(p.canTrain()&&rnd()<.45)p.addTrain();
    return p;
  }
  return null;
}
function clone(p){const q=new Plan();Object.assign(q,JSON.parse(JSON.stringify({...p})));return q;}
const N4=c=>[[c[0]+1,c[1]],[c[0]-1,c[1]],[c[0],c[1]+1],[c[0],c[1]-1]];
function lineMoves(p){
  const out=[];
  for(const e of [p.line[0],p.line.at(-1)])if(e){
    for(const n of N4(e))if(p.canExtend(n))out.push(q=>q.extend(n));
    if(p.line.length>2)out.push(q=>q.shorten(e));
  }
  for(const c of p.line)if(p.isStation(c)||p.canStation(c))out.push(q=>q.toggleStation(c));
  p.line.forEach((c,j)=>{if(!p.isStation(c))return;for(const n of [p.line[j-1],p.line[j+1]])if(n&&!p.isStation(n))out.push(q=>{q.toggleStation(c);q.toggleStation(n);});});
  if(p.canTrain())out.push(q=>q.addTrain());if(p.canUntrain())out.push(q=>q.removeTrain());
  return out;
}
function baseScore(p){return p.stations.length>=2?p.simulate().total:0;}
function climb(){
  let p=routePlan();if(!p)return null;let score=baseScore(p);
  for(let it=0;it<110;it++){
    let best=null,bs=score;
    for(const move of lineMoves(p)){const q=clone(p);move(q);if(q.stations.length<2)continue;const v=baseScore(q);if(v>bs+1e-8){bs=v;best=q;}}
    if(!best)break;p=best;score=bs;
  }
  return p;
}
function fresh(base){
  const p=new Plan();p.line=base.line.map(c=>c.slice());p.stations=base.stations.map(c=>c.slice());p.trains=base.trains;p.money=base.money;return p;
}
function eligible(base){return D.land.filter(q=>!base.line.some(c=>same(c,q.cell))&&!!M.landStation(base.stations,base.line,q.cell)).map(q=>q.cell);}
function run(base,actions){
  const p=fresh(base);
  for(let y=0;y<P.years;y++){
    const day=actions.filter(a=>a.year===y);
    if(day.length>2)return null;
    for(const a of day)if(!p.sellLand(a.cell,a.use))return null;
    if(!p.runYear())return null;
  }
  return p;
}
function score(base,actions){const p=run(base,actions);return p?p.total:-Infinity;}
function greedy(base,allowed){
  const cells=eligible(base),actions=[];let best=score(base,actions);
  for(let y=0;y<P.years;y++)for(let slot=0;slot<2;slot++){
    let chosen=null,cs=best;
    for(const cell of cells)for(const use of allowed){
      if(actions.some(a=>same(a.cell,cell)))continue;
      const trial=actions.concat({cell,use,year:y}),v=score(base,trial);
      if(v>cs+1e-7){cs=v;chosen=trial;}
    }
    if(chosen){actions.splice(0,actions.length,...chosen);best=cs;}
  }
  return actions;
}
function mixedSeed(base,actions){
  const cells=eligible(base);
  if(!cells.length)return actions;
  let counts={home:actions.filter(a=>a.use==='home').length,shop:actions.filter(a=>a.use==='shop').length};
  if(counts.home&&counts.shop)return actions;
  const missing=counts.home?'shop':'home',cands=[];
  for(let i=0;i<actions.length;i++)for(const cell of cells)for(let y=0;y<P.years;y++){
    if(actions.some((a,j)=>j!==i&&same(a.cell,cell)))continue;
    const trial=actions.map((a,j)=>j===i?{cell,use:missing,year:y}:a);
    const v=score(base,trial);if(Number.isFinite(v))cands.push({trial,v});
  }
  for(const cell of cells)for(let y=0;y<P.years;y++){
    if(actions.some(a=>same(a.cell,cell))||actions.filter(a=>a.year===y).length>=2)continue;
    const trial=actions.concat({cell,use:missing,year:y}),v=score(base,trial);
    if(Number.isFinite(v))cands.push({trial,v});
  }
  cands.sort((a,b)=>b.v-a.v);return cands[0]?.trial||actions;
}
function local(base,start,allowed,requireMixed=false){
  let actions=start.map(a=>({...a,cell:a.cell.slice()})),value=score(base,actions),cells=eligible(base);
  for(let round=0;round<7;round++){
    let best=null,bv=value;
    for(let i=0;i<actions.length;i++)for(const cell of cells)for(let y=0;y<P.years;y++)for(const use of allowed){
      if(actions.some((a,j)=>j!==i&&same(a.cell,cell)))continue;
      const trial=actions.map((a,j)=>j===i?{cell,use,year:y}:a);
      if(requireMixed&&new Set(trial.map(a=>a.use)).size<2)continue;
      const v=score(base,trial);if(v>bv+1e-7){bv=v;best=trial;}
    }
    if(!best)break;actions=best;value=bv;
  }
  return{actions,value,plan:run(base,actions)};
}
function optimize(base){
  const home=local(base,greedy(base,['home']),['home']);
  const shop=local(base,greedy(base,['shop']),['shop']);
  let mixedStart=mixedSeed(base,greedy(base,['home','shop']));
  if(mixedStart.length<2&&eligible(base).length>=2){
    const start=mixedStart.slice(),cells=eligible(base);
    outer:for(const cell of cells)for(const use of ['home','shop'])if(!start.some(a=>same(a.cell,cell))){start.push({cell,use,year:0});break outer;}
    mixedStart=start;
  }
  const mixed=local(base,mixedStart,['home','shop'],true);
  return{home,shop,mixed};
}
const found=new Map();
for(let i=0;i<restarts;i++){const p=climb();if(p)found.set(sameKey(p),p);}
const all=[...found.values()].sort((a,b)=>baseScore(b)-baseScore(a));
const short=[];
for(const p of all.slice(0,10))short.push(p);
const coverage=all.slice().sort((a,b)=>eligible(b).length-eligible(a).length||baseScore(b)-baseScore(a));
for(const p of coverage){if(short.length>=16)break;if(!short.some(q=>sameKey(q)===sameKey(p)))short.push(p);}
const results={none:null,home:null,shop:null,mixed:null},mixedScores=[];
for(const base of short){
  const no={plan:base.simulate(),actions:[]},s=no.plan.total;
  if(!results.none||s>results.none.plan.total)results.none={plan:no.plan,actions:[],base};
  const o=optimize(base);mixedScores.push(o.mixed.value);
  for(const [k,v] of [['home',o.home],['shop',o.shop],['mixed',o.mixed]])if(v.plan&&(!results[k]||v.value>results[k].plan.total))results[k]={plan:v.plan,actions:v.actions,base};
}
const planText=p=>'line '+p.line.map(c=>c.join(',')).join(' ')+' · stations '+p.stations.map(c=>c.join(',')).join(' ')+' · trains '+p.trains;
function print(label,r){
  if(!r){console.log(label+': no plan');return;}
  console.log(label+': '+Math.round(r.plan.total)+' (rail '+Math.round(r.plan.log.reduce((s,l)=>s+l.riders,0))+' + land '+Math.round(r.plan.landRevenue)+')');
  if(r.base)console.log('  '+planText(r.base));
  if(r.actions?.length)console.log('  sales '+r.actions.slice().sort((a,b)=>a.year-b.year).map(a=>'Y'+a.year+': lot'+(D.land.findIndex(q=>same(q.cell,a.cell))+1)+' '+a.use).join(' · '));
  if(r.plan.log)console.log('  years '+r.plan.log.map(l=>'Y'+l.year+' '+Math.round(l.riders)+' + '+Math.round(l.revenue)+' = '+Math.round(l.ledger)).join(' | '));
}
console.log('rates homeRate='+P.homeRate+' shopRate='+P.shopRate+' · lines searched '+short.length+' / '+found.size);
print('only line, no sales',results.none);print('all homes',results.home);print('all shops',results.shop);print('best mixed',results.mixed);
const mixSorted=mixedScores.filter(Number.isFinite).sort((a,b)=>a-b); if(mixSorted.length)console.log('mixed local scores: median '+Math.round(mixSorted[Math.floor((mixSorted.length-1)*.5)])+' · p90 '+Math.round(mixSorted[Math.floor((mixSorted.length-1)*.9)]));
if(results.mixed&&results.home&&results.shop){
  console.log('mixed uplift '+Math.round(100*(results.mixed.plan.total/results.home.plan.total-1))+'% vs homes · '+Math.round(100*(results.mixed.plan.total/results.shop.plan.total-1))+'% vs shops');
}
if(write){
  const plans={tiers:D.tiers,best:Math.round(results.mixed?.plan.total||0)};
  for(const k of ['none','home','shop','mixed'])if(results[k])plans[k]={line:(results[k].base||results.none.base).line,stations:(results[k].base||results.none.base).stations,
    trains:(results[k].base||results.none.base).trains,actions:results[k].actions||[],score:Math.round(results[k].plan.total)};
  const out=path.join(__dirname,'../v7/mode4-tod/demo-plans.js');
  fs.writeFileSync(out,'// v7 mode 4 TOD plans; generated by bots/v7_tod.js.\n(function(root){root.TL_TOD_DEMO={"m4-1":'+JSON.stringify(plans)+'};})(typeof window!=="undefined"?window:globalThis);\n');
  console.log('written '+out);
}
