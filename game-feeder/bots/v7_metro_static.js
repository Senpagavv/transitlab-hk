'use strict';
// v7 mode 2 (metro, static) · how good can a plan get? Local search over lines and stations within the budget.
//   node bots/v7_metro_static.js [restarts=4000] ['{"budget":26}']
// Moves: grow either end into a free neighbour, cut an end, add or remove a station. Climbs while the riders go up
// (ties accepted now and then), from random starting cells. Prints the best plan, its desire lines, and how good the
// local optima usually are (what a sensible player tends to reach).
const M=require('../v7/mode2-metro/engine.js'),{D,P,Plan,same}=M;
const restarts=+(process.argv[2]||4000),over=process.argv[3]?JSON.parse(process.argv[3]):{};
if(Object.keys(over).length){D.use({...D.example('m2-1'),...over},'probe');M.reset();}
let seed=7;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const score=p=>p.evaluate().riders;
function moves(p){const out=[];
  for(const end of [p.line[0],p.line.at(-1)])if(end){for(const n of [[end[0]+1,end[1]],[end[0]-1,end[1]],[end[0],end[1]+1],[end[0],end[1]-1]])if(p.canExtend(n))out.push(q=>q.extend(n));
    if(p.line.length>1)out.push(q=>q.shorten(end));}
  for(const c of p.line)if(p.isStation(c)||p.canStation(c))out.push(q=>q.toggleStation(c));
  p.line.forEach((c,j)=>{if(!p.isStation(c))return;for(const n of [p.line[j-1],p.line[j+1]])if(n&&!p.isStation(n))out.push(q=>{q.toggleStation(c);q.toggleStation(n);});});
  return out;}
// a random line (a walk that never revisits a cell) with a few random stations on it
function randomPlan(){const p=new Plan();let c=[Math.floor(rnd()*D.cols),Math.floor(rnd()*D.rows)];p.extend(c);const L=4+Math.floor(rnd()*16);
  for(let k=0;k<L;k++){const ns=[[c[0]+1,c[1]],[c[0]-1,c[1]],[c[0],c[1]+1],[c[0],c[1]-1]].filter(n=>p.canExtend(n)&&p.left()>9);if(!ns.length)break;c=ns[Math.floor(rnd()*ns.length)];p.extend(c);}
  const n=2+Math.floor(rnd()*3);for(let k=0;k<n;k++){const c2=p.line[Math.floor(rnd()*p.line.length)];if(p.canStation(c2))p.toggleStation(c2);}
  return p;}
function climb(){let p=randomPlan();let s=score(p);
  for(let it=0;it<400;it++){const ms=moves(p);if(!ms.length)break;let best=null,bs=-1;
    for(const m of ms){const q=p.copy();m(q);const v=score(q);if(v>bs||(v===bs&&rnd()<.3)){bs=v;best=q;}}
    if(bs<s||(bs===s&&rnd()<.15&&it>60))break;p=best;s=bs;}
  return{p,s};}
const found=[];
for(let r=0;r<restarts;r++)found.push(climb());
found.sort((a,b)=>b.s-a.s);
const q=f=>found[Math.floor(f*(found.length-1))].s,total=M.evaluate([],[]).people;
const b=found[0],e=b.p.evaluate();
console.log(`people a day ${total} · budget ${P.budget} (line ${P.lineCost}/block, station ${P.stationCost}) · restarts ${restarts}`);
console.log(`best ${b.s} (cost ${e.cost}, line ${b.p.line.length} blocks, ${b.p.stations.length} stations) · local optima: p90 ${q(.1)} median ${q(.5)} p25 ${q(.75)}`);
console.log('  line',b.p.line.map(c=>c.join(',')).join(' '),'| stations',b.p.stations.map(c=>c.join(',')).join(' '));
for(const r of e.rows)console.log(`  ${D.origins[r.i].name}→${D.destinations[r.k].name} ${r.people}/day car ${r.car} metro ${r.metro??'—'} (walk ${r.walkA??'-'}+2+pass ${r.pass??'-'}+walk ${r.walkB??'-'}) save ${r.save} → ${r.tenths}/10 = ${r.riders}`);
// the tension: does one more station ever cost riders? Try adding each free line cell as a station to the best plan
const gain=b.p.line.filter(c=>!b.p.isStation(c)).map(c=>{const ev=M.evaluate(b.p.line,[...b.p.stations,c]);return ev.riders-b.s;});
console.log('  one more station on the best line (ignoring budget): best',Math.max(...gain),'worst',Math.min(...gain));
const fewer=b.p.stations.map(c=>M.evaluate(b.p.line,b.p.stations.filter(x=>!same(x,c))).riders-b.s);
console.log('  one station fewer:',fewer.join(' '));
