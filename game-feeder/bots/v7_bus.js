'use strict';
// Task 66: the historical filename below is mode4-bus. --level mode 1 uses the
// actual stations-and-walking engine, without changing that historical default.
if(require.main===module&&process.argv.includes('--level')){
  const file=process.argv[process.argv.indexOf('--level')+1];
  const entry=JSON.parse(require('node:fs').readFileSync(file,'utf8'));
  if(entry.mode!==1)throw Error('v7_bus.js --level accepts mode 1 (stations and walking)');
  console.log(JSON.stringify(require('./v7_intake.js').searchMode1(entry)));
  return;
}
// v7 mode 4 (buses on the road, Kowloon East) · tune the level and find the AI demo plans: local search over up to three
// bus routes (along the roads, stops on them), the buses on each and the bus lanes, kept the same every year, within
// the yearly budget; scored on the eight-year jam taken off the roads. Starts from routes between road cells next to
// estates, business areas and stations.
//   node bots/v7_bus.js [restarts=200] ['{"busHead":6}'] [--write]
const fs=require('node:fs'),path=require('node:path');
const M=require('../v7/mode4-bus/engine.js'),{D,P,G,Plan,same,walk,key,sectionBetween}=M;
const args=process.argv.slice(2),write=args.includes('--write'),pos=args.filter(a=>a!=='--write');
const restarts=+(pos[0]||200),o=pos[1]?JSON.parse(pos[1]):{};
if(Object.keys(o).length){const d=D.example('m4-1');Object.assign(d,o);D.use(d,'probe');M.reset();}
let seed=7;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const pick=a=>a[Math.floor(rnd()*a.length)];
const total=p=>p.simulate().total;
const roadCells=[...G.roadNodes.values()].map(n=>n.cell);
const places=[...D.origins.map(x=>x.cell),...D.destinations.map(x=>x.cell),...G.lines.flatMap(l=>l.stations)];
const ends=roadCells.filter(c=>places.some(p=>walk(p,c)<=1));
// the shortest road path between two road cells
function roadPath(a,b){const prev=new Map([[key(a),null]]),q=[a];
  while(q.length){const c=q.shift();if(same(c,b))break;for(const e of G.roadNodes.get(key(c)).out){if(!prev.has(e.to)){prev.set(e.to,c);q.push(G.roadNodes.get(e.to).cell);}}}
  if(!prev.has(key(b)))return null;const out=[];let c=b;while(c){out.unshift(c);c=prev.get(key(c));}return out;}
function randomPlan(){const p=new Plan(),n=1+Math.floor(rnd()*3);
  for(let r=0;r<n;r++){for(let t=0;t<20;t++){const a=pick(ends),b=pick(ends);if(same(a,b))continue;const path=roadPath(a,b);if(!path||path.length<3||path.length>14)continue;
    for(const c of path)p.extend(r,c);p.toggleStop(r,path[0]);p.toggleStop(r,path.at(-1));
    for(const c of path.slice(1,-1))if(places.some(q=>walk(q,c)<=1)&&rnd()<.6)p.toggleStop(r,c);break;}}
  if(rnd()<.5){const used=D.roads.filter(rd=>p.routes.some(R=>R.cells.some((c,i)=>i&&sectionBetween(R.cells[i-1],c)?.roads.includes(rd.name))));if(used.length)p.toggleLane(pick(used).name);}
  let guard=0;while(p.money>=P.busCost&&guard++<40){const live=p.routes.map((R,i)=>i).filter(i=>p.routes[i].stops.length>=2);if(!live.length)break;p.addBus(pick(live));}
  return p;}
const cp=p=>p.clone();
function moves(p){const out=[];
  p.routes.forEach((R,r)=>{if(!R.cells.length)return;
    for(const e of [R.cells[0],R.cells.at(-1)]){for(const x of G.roadNodes.get(key(e)).out){const c=G.roadNodes.get(x.to).cell;if(p.canExtend(r,c))out.push(q=>q.extend(r,c));}
      if(R.cells.length>2)out.push(q=>q.shorten(r,e));}
    for(const c of R.cells)out.push(q=>q.toggleStop(r,c));
    if(R.buses>0){out.push(q=>q.removeBus(r));p.routes.forEach((S,s)=>{if(s!==r&&S.stops.length>=2)out.push(q=>{q.removeBus(r);q.addBus(s);});});}
    if(p.money>=P.busCost)out.push(q=>q.addBus(r));});
  for(const rd of D.roads)out.push(q=>{if(q.toggleLane(rd.name))return;let k=0;while(!q.toggleLane(rd.name)&&k++<3){const r=q.routes.findIndex(R=>R.buses>0);if(r<0)break;q.removeBus(r);}});
  return out;}
function climb(){let p=randomPlan(),s=total(p);
  for(let it=0;it<120;it++){let best=null,bs=-Infinity;for(const m of moves(p)){const q=cp(p);m(q);if(q.money<0)continue;const v=total(q);if(v>bs){bs=v;best=q;}}
    if(!best||bs<=s+1e-9)break;p=best;s=bs;}
  return{p,s};}
const found=[];for(let r=0;r<restarts;r++)found.push(climb());found.sort((a,b)=>b.s-a.s);
const q=f=>Math.round(found[Math.floor(f*(found.length-1))].s);
const fmt=p=>p.routes.map((R,i)=>R.cells.length?`#${i+1} ${R.cells.map(c=>c.join(',')).join(' ')} · stops ${R.stops.map(c=>c.join(',')).join(' ')} · ${R.buses} buses`:'').filter(Boolean).join(' | ')+` · lanes ${p.lanes.join(',')||'—'} · left ${p.money}`;
const b=found[0].p,run=b.simulate();
console.log(JSON.stringify(o),`· do nothing ${Math.round(G.doNothing[0])} · best ${Math.round(found[0].s)} · local optima p90 ${q(.1)} median ${q(.5)} p25 ${q(.75)} (${found.length})`);
console.log('  '+fmt(b));
console.log(`  jam ${run.log.map(l=>Math.round(l.jam)).join(' ')} · on buses ${run.log.map(l=>Math.round(l.onBus)).join(' ')} · drivers ${run.log.map(l=>Math.round(l.drivers)).join(' ')}`);
const tiers=D.tiers,plans={tiers,best:Math.round(found[0].s)};
const clean=f=>!f.p.simulate().log.some(l=>l.crowdedSections);
['pass','high','master'].forEach((name,j)=>{const above=found.filter(f=>f.s>=tiers[j]&&(j===2||f.s<tiers[j+1]));
  const size=f=>f.p.spent*100+f.p.routes.reduce((s,R)=>s+R.cells.length,0),cheap=above.filter(clean).sort((x,y)=>size(x)-size(y)||x.s-y.s)[0];
  const c=name==='master'?found[0]:cheap||above.at(-1);
  if(!c){console.log(`  ${name}: no plan clears ${tiers[j]}`);return;}
  plans[name]={routes:c.p.routes.filter(R=>R.cells.length),lanes:c.p.lanes,score:Math.round(c.s)};console.log(`  ${name} ${tiers[j]} → ${Math.round(c.s)}: ${fmt(c.p)}`);});
if(write){const f=path.join(__dirname,'../v7/mode4-bus/demo-plans.js');
  fs.writeFileSync(f,`// v7 mode 4 · AI demo plans, written by bots/v7_bus.js (${new Date(Date.now()+8*3600e3).toISOString().slice(0,10)}). Do not edit by hand.\n`+
    `// level → {tiers, best, pass|high|master: {routes: [{cells, stops, buses}], lanes, score}} — the same plan every year\n(function(root){root.TL_BUS_DEMO={"m4-1":${JSON.stringify(plans)}};})(typeof window!=='undefined'?window:globalThis);\n`);
  console.log('written',f);}
