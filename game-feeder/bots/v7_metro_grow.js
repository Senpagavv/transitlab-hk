'use strict';
// v7 mode 2 (metro, build once and watch it grow) · tune the level: the best plans (local search over line, stations
// and trains within the budget, scored on the eight-year total), how much destinations grow, the S-curve.
//   node bots/v7_metro_grow.js [restarts=600] ['{"nearby":10,"att":[24,24],"extra":[3,6]}']
// att: the destinations' attractions; extra: each destination's car access + parking blocks (car trip = blocks apart + extra).
const M=require('../v7/mode2-metro/engine.js'),{D,P,Plan,same}=M;
const restarts=+(process.argv[2]||600),o=process.argv[3]?JSON.parse(process.argv[3]):{};
const base=D.example('m2-1'),def={...base,...o};
if(o.att)def.destinations=base.destinations.map((d,k)=>({...d,attraction:o.att[k]}));
if(o.extra)def.destinations=def.destinations.map((d,k)=>({...d,carExtra:o.extra[k]}));
D.use(def,'probe');M.reset();
let seed=11;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const total=p=>p.simulate().total;
function randomPlan(){const p=new Plan();let c=[Math.floor(rnd()*D.cols),Math.floor(rnd()*D.rows)];p.extend(c);const L=4+Math.floor(rnd()*16);
  for(let k=0;k<L;k++){const ns=[[c[0]+1,c[1]],[c[0]-1,c[1]],[c[0],c[1]+1],[c[0],c[1]-1]].filter(n=>p.canExtend(n)&&p.money>9);if(!ns.length)break;c=ns[Math.floor(rnd()*ns.length)];p.extend(c);}
  for(let k=0;k<2+Math.floor(rnd()*3);k++){const c2=p.line[Math.floor(rnd()*p.line.length)];if(p.canStation(c2))p.toggleStation(c2);}
  if(rnd()<.4&&p.canTrain())p.addTrain();return p;}
const cp=p=>{const q=new Plan();Object.assign(q,JSON.parse(JSON.stringify({...p})));return q;};
function moves(p){const out=[];
  for(const e of [p.line[0],p.line.at(-1)])if(e){for(const n of [[e[0]+1,e[1]],[e[0]-1,e[1]],[e[0],e[1]+1],[e[0],e[1]-1]])if(p.canExtend(n))out.push(q=>q.extend(n));if(p.line.length>1)out.push(q=>q.shorten(e));}
  for(const c of p.line)if(p.isStation(c)||p.canStation(c))out.push(q=>q.toggleStation(c));
  p.line.forEach((c,j)=>{if(!p.isStation(c))return;for(const n of [p.line[j-1],p.line[j+1]])if(n&&!p.isStation(n))out.push(q=>{q.toggleStation(c);q.toggleStation(n);});});
  if(p.canTrain())out.push(q=>q.addTrain());if(p.canUntrain())out.push(q=>q.removeTrain());
  return out;}
function climb(){let p=randomPlan(),s=p.stations.length>=2?total(p):0;
  for(let it=0;it<200;it++){let best=null,bs=-1;for(const m of moves(p)){const q=cp(p);m(q);if(q.stations.length<2)continue;const v=total(q);if(v>bs||(v===bs&&rnd()<.3)){bs=v;best=q;}}
    if(!best||bs<s||(bs===s&&rnd()<.2&&it>40))break;p=best;s=bs;}
  return{p,s};}
const found=[];for(let r=0;r<restarts;r++)found.push(climb());found.sort((a,b)=>b.s-a.s);
const q=f=>Math.round(found[Math.floor(f*(found.length-1))].s);
const b=found[0].p,run=b.simulate(),pot=b.potential();
console.log(JSON.stringify(o),`· best ${Math.round(found[0].s)} · local optima p90 ${q(.1)} median ${q(.5)} p25 ${q(.75)}`);
console.log(`  plan: line ${b.line.map(c=>c.join(",")).join(" ")}, stations ${b.stations.map(c=>c.join(',')).join(' ')}, trains ${b.trains}, money left ${b.money}`);
console.log(`  years ${run.log.map(l=>Math.round(l.riders)+(l.crowdedSections?'!':'')).join(' ')} · potential ${Math.round(pot.riders)} · aware ${run.aware.map(a=>a.toFixed(2)).join(',')}`);
console.log('  destinations before → full potential:',pot.dest.map((d,k)=>`${D.destinations[k].name} ${Math.round(d.before)}→${Math.round(d.go)} (metro ${Math.round(d.metro)})`).join(' | '));
