'use strict';
// Quick check of a candidate board: distance of each estate to the station and the share each candidate
// stop gets from each estate under the v2 rules (100/100/80/60/40/20 %, and only if nearer than the station).
const W=[1,1,.8,.6,.4,.2];
function build(lines){const s=new Set();for(const [x1,y1,x2,y2] of lines)for(let x=Math.min(x1,x2);x<=Math.max(x1,x2);x++)for(let y=Math.min(y1,y2);y<=Math.max(y1,y2);y++)s.add(`${x},${y}`);return s;}
function check(name,b){
  const roads=build(b.roads),key=c=>c.join(',');
  const bfs=a=>{const d=new Map([[key(a),0]]),q=[a];for(let i=0;i<q.length;i++){const c=q[i];for(const n of [[c[0]+1,c[1]],[c[0]-1,c[1]],[c[0],c[1]+1],[c[0],c[1]-1]])if(roads.has(key(n))&&!d.has(key(n))){d.set(key(n),d.get(key(c))+1);q.push(n);}}return d;};
  const fromHub=bfs(b.hub),fromE=b.estates.map(e=>bfs(e.cell));
  const toMTR=b.estates.map((e,i)=>fromE[i].get(key(b.hub)));
  console.log(`\n== ${name}: hub ${b.hub}  to MTR ${b.estates.map((e,i)=>`${e.name} ${toMTR[i]}`).join(' · ')}`);
  for(const c of b.candidates){
    if(!roads.has(key(c))){console.log('  OFF ROAD',c);continue;}
    const sh=b.estates.map((e,i)=>{const d=fromE[i].get(key(c));return d!==undefined&&d<toMTR[i]?(W[d]??0):0;});
    const n=sh.filter(x=>x>0).length;
    console.log(`  ${key(c).padEnd(5)} hw ${b.headway[0]+fromHub.get(key(c))*b.headway[1]}s  ${sh.map(x=>String(Math.round(x*100)).padStart(3)).join(' ')}${n>1?'  <- shared':''}`);
  }
}
module.exports=check;
if(require.main===module){const boards=require(process.argv[2]);for(const [k,b] of Object.entries(boards))check(k,b);}
