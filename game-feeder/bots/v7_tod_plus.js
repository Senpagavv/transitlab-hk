'use strict';
// Multi-line TOD search: rail local optima + coverage diversity, three greedy uses,
// then sale replacement/addition/removal and pairwise year swaps. Final strict replay.
// node bots/v7_tod_plus.js --level <json> --seconds 300 --out <report.json> [--seed 7]
const fs=require('node:fs'),path=require('node:path');
const {clone,build,replay,record}=require('./v7_quality_lib.js');
const argv=process.argv.slice(2),arg=(k,d)=>argv.includes(k)?argv[argv.indexOf(k)+1]:d;
const file=arg('--level'),seconds=Math.max(1,+arg('--seconds',300)),out=arg('--out');
if(!file)throw Error('--level required');const e=JSON.parse(fs.readFileSync(file,'utf8'));
const M=require('../v7/mode4-tod/engine.js'),{D,P,Plan,same}=M;D.use(clone(e.level),e.key);M.reset();
const start=Date.now(),end=start+seconds*1000,lineEnd=start+seconds*350;
let seed=+arg('--seed',7),restarts=0,evaluations=0;
const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;},pick=a=>a[Math.floor(rnd()*a.length)];
const poi=[...D.origins,...D.destinations].map(x=>x.cell),found=new Map(),results={none:null,home:null,shop:null,mixed:null};
const cp=p=>Object.assign(new Plan(),clone(p)),key=p=>JSON.stringify([p.line,p.stations,p.trains]);
const total=p=>p.stations.length>=2?p.simulate().total:-Infinity;
function leg(p,t,h){let c=p.line.at(-1).slice(),ok=true;const step=a=>{while(ok&&c[a]!==t[a]){c=c.slice();c[a]+=Math.sign(t[a]-c[a]);ok=!!p.extend(c);}};if(h){step(0);step(1);}else{step(1);step(0);}return ok;}
function route(){for(let k=0;k<50;k++){const pts=[],n=2+Math.floor(rnd()*3);for(let g=0;g<50&&pts.length<n;g++){const c=pick(poi);if(!pts.some(x=>same(x,c)))pts.push(c);}const p=new Plan();let ok=!!p.extend(pts[0]);for(const t of pts.slice(1))if(ok)ok=leg(p,t,rnd()<.5);if(!ok)continue;for(const c of poi)if(p.canStation(c))p.toggleStation(c);if(p.stations.length<2)continue;while(p.canTrain()&&rnd()<.5)p.addTrain();return p;}return null;}
function moves(p){const a=[];for(const c of [p.line[0],p.line.at(-1)])if(c){for(const n of [[c[0]+1,c[1]],[c[0]-1,c[1]],[c[0],c[1]+1],[c[0],c[1]-1]])if(p.canExtend(n))a.push(q=>q.extend(n));if(p.line.length>2)a.push(q=>q.shorten(c));}for(const [i,c] of p.line.entries()){if(p.isStation(c)||p.canStation(c))a.push(q=>q.toggleStation(c));if(p.isStation(c))for(const n of [p.line[i-1],p.line[i+1]])if(n&&!p.isStation(n))a.push(q=>{q.toggleStation(c);return q.toggleStation(n);});}if(p.canTrain())a.push(q=>q.addTrain());if(p.canUntrain())a.push(q=>q.removeTrain());return a;}
function climb(p){let s=total(p);for(let n=0;n<200&&Date.now()<lineEnd;n++){let next=null,v=s;for(const move of moves(p)){const q=cp(p);if(!move(q)||q.stations.length<2)continue;const w=total(q);if(w>v+1e-9){next=q;v=w;}}if(!next)break;p=next;s=v;}return {p,s};}
function cells(p){return D.land.filter(l=>!p.onLine(l.cell)&&M.landStation(p.stations,p.line,l.cell)).map(l=>l.cell);}
function run(base,acts){const p=new Plan();p.line=clone(base.line);p.stations=clone(base.stations);p.trains=base.trains;p.money=base.money;for(let y=0;y<P.years;y++){const day=acts.filter(a=>a.year===y);if(day.length>2)return null;for(const a of day)if(!p.sellLand(a.cell,a.use))return null;if(!p.runYear())return null;}evaluations++;return p;}
function score(base,acts){const p=run(base,acts);return p?p.total:-Infinity;}
function kind(a){return new Set(a.map(x=>x.use)).size===2?'mixed':a[0]?.use||'none';}
function remember(base,acts){const p=run(base,acts);if(!p)return;const k=kind(acts);if(!results[k]||p.total>results[k].value)results[k]={base,actions:clone(acts),value:p.total};}
function greedy(base,allowed){const lots=cells(base);let acts=[],v=score(base,acts);for(let y=0;y<P.years&&Date.now()<end;y++)for(let slot=0;slot<2;slot++){let next=null,w=v;for(const c of lots)if(!acts.some(a=>same(a.cell,c)))for(const use of allowed){const trial=acts.concat({cell:c,use,year:y}),s=score(base,trial);if(s>w+1e-7){next=trial;w=s;}}if(next){acts=next;v=w;remember(base,acts);}}return {base,actions:acts,value:v,allowed};}
function polish(r){let {base,actions:acts,value:v,allowed}=r;const lots=cells(base);let next=null,w=v;const test=t=>{const s=score(base,t);if(s>w+1e-7){next=t;w=s;}};
 for(let i=0;i<acts.length&&Date.now()<end;i++){for(const c of lots)if(!acts.some((a,j)=>j!==i&&same(a.cell,c)))for(let y=0;y<P.years;y++)for(const use of allowed)test(acts.map((a,j)=>j===i?{cell:c,use,year:y}:a));test(acts.filter((_,j)=>j!==i));}
 for(const c of lots)if(!acts.some(a=>same(a.cell,c)))for(let y=0;y<P.years&&Date.now()<end;y++)if(acts.filter(a=>a.year===y).length<2)for(const use of allowed)test(acts.concat({cell:c,use,year:y}));
 for(let i=0;i<acts.length&&Date.now()<end;i++)for(let j=i+1;j<acts.length;j++)if(acts[i].year!==acts[j].year)test(acts.map((a,k)=>({...a,year:k===i?acts[j].year:k===j?acts[i].year:a.year})));
 if(next){remember(base,next);return {...r,actions:next,value:w};}return r;
}
// Keep all previously shipped strategies as seeds, without trusting their declared scores.
let old=e.level.demo;if(e.key==='m4-1'){require('../v7/mode4-tod/demo-plans.js');old=globalThis.TL_TOD_DEMO[e.key];}
const seeds=[];for(const r of Object.values(old||{}))if(r&&r.line)try{const p=build(M,r);seeds.push(p);remember(p,r.actions||[]);found.set(key(p),{p,s:total(p)});}catch(err){throw Error('Shipped plan invalid: '+err.message);}
while(Date.now()<lineEnd){const p=route();if(!p)continue;const f=climb(p);restarts++;found.set(key(f.p),f);}
const rail=[...found.values()].sort((a,b)=>b.s-a.s),short=rail.slice(0,16);for(const f of [...rail].sort((a,b)=>cells(b.p).length-cells(a.p).length||b.s-a.s)){if(short.length>=28)break;if(!short.some(q=>key(q.p)===key(f.p)))short.push(f);}
const pool=[];for(const f of short){remember(f.p,[]);for(const allowed of [['home','shop'],['home'],['shop']]){if(Date.now()>=end)break;pool.push(greedy(f.p,allowed));}}
// Polish the best of each strategy first; retain multiple rail layouts per strategy.
const queue=[];for(const allowed of [['home','shop'],['home'],['shop']])queue.push(...pool.filter(r=>r.allowed.join()===allowed.join()).sort((a,b)=>b.value-a.value).slice(0,4));
let rounds=0;while(Date.now()<end&&queue.length){const i=rounds++%queue.length;queue[i]=polish(queue[i]);if(rounds%queue.length===0)console.log(JSON.stringify({seconds:(Date.now()-start)/1000,restarts,evaluations,best:Object.fromEntries(Object.entries(results).map(([k,v])=>[k,Math.round(v?.value||0)]))}));if(rounds>1000)break;}
const strategies={};for(const [k,r] of Object.entries(results))if(r){const rec=record(r.base,r.actions),check=replay(M,4,rec);if(check.score!==Math.round(r.value))throw Error('Replay mismatch '+k);strategies[k]={...rec,score:check.score};}
const best=Math.max(...Object.values(strategies).map(r=>r.score)),report={key:e.key,mode:4,seconds:(Date.now()-start)/1000,restarts,lines:found.size,landEvaluations:evaluations,best,tiers:[.4,.65,.88].map(f=>Math.round(best*f)),strategies};
if(out)fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log('QUALITY '+JSON.stringify(report));
