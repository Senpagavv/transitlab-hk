'use strict';
// v7 mode 2 (metro, six years with experience) · do the yearly decisions matter? A few strategies from the same opening.
//   node bots/v7_metro_years.js ['{"perTrain":40,"fare":10}']
const M=require('../v7/mode2-metro/engine.js'),{D,P,Plan,same}=M;
const over=process.argv[2]?JSON.parse(process.argv[2]):{};
if(Object.keys(over).length){D.use({...D.example('m2-1'),...over},'probe');M.reset();}
const LINE=[[2,2],[3,2],[4,2],[5,2],[6,2],[7,2],[8,2],[8,3],[8,4],[9,4],[9,5],[9,6],[9,7],[10,7],[11,7],[12,7],[12,6],[12,5]],ST=[[2,2],[7,2],[9,6],[12,5]];
function open(line=LINE,st=ST,trains=1){const p=new Plan();for(const c of line)p.extend(c);for(const s of st)p.toggleStation(s);for(let k=1;k<trains;k++)p.addTrain();return p;}
// one action at a time, the best for next year's riders (+ a little for experience) while money allows
function actions(p){const out=[];if(p.canTrain())out.push(q=>q.addTrain());
  for(const c of p.line)if(p.canStation(c))out.push(q=>q.toggleStation(c));
  for(const e of [p.line[0],p.line.at(-1)])for(const n of [[e[0]+1,e[1]],[e[0]-1,e[1]],[e[0],e[1]+1],[e[0],e[1]-1]])if(p.canExtend(n))out.push(q=>q.extend(n));
  // an extension of up to 5 cells (straight, or one turn) from an end, with a station at its new end
  for(const e of [p.line[0],p.line.at(-1)])for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])for(let a=1;a<=5;a++)for(const [tx,ty] of [[0,0],[dy,dx],[-dy,-dx]])for(let b=0;b<=(tx||ty?4:0);b++){
    const cells=[];for(let k=1;k<=a;k++)cells.push([e[0]+dx*k,e[1]+dy*k]);const t=cells.at(-1);for(let k=1;k<=b;k++)cells.push([t[0]+tx*k,t[1]+ty*k]);
    if(cells.length<2)continue;out.push(q=>{for(const c of cells)if(!q.extend(c))return;q.toggleStation(cells.at(-1));});}
  return out;}
const value=p=>{const ev=p.evaluate();return ev.riders+3*M.nextExp(ev,p.exp).reduce((a,b)=>a+b,0)-ev.crowded.filter(Boolean).length*2;};
function greedy(p){for(let k=0;k<6;k++){let best=null,bv=value(p);for(const a of actions(p)){const q=p.copy();Object.setPrototypeOf(q,Plan.prototype);a(q);const v=value(q);if(v>bv){bv=v;best=q;}}if(!best)break;Object.assign(p,best);}}
function run(name,p,each){const ys=[];while(!p.done){if(each)each(p);const r=p.runYear();ys.push(`${r.riders}${r.crowdedSections?'!':''}`);}
  console.log(`${name.padEnd(34)} total ${String(p.total).padStart(4)} | per year ${ys.join(' ')} | trains ${p.trains} stations ${p.stations.length} line ${p.line.length} money left ${p.money} | exp ${p.exp.join(',')}`);return p.total;}
console.log(`perTrain ${P.perTrain} · fare 1 per ${P.fare} riders · train ${P.trainCost} · exp ${P.exp.start}..${P.exp.max} · ${P.years} years`);
run('static best, never spend',open());
run('static best, a train when crowded',open(),p=>{while(p.evaluate().crowded.some(Boolean)&&p.canTrain())p.addTrain();});
run('static best, greedy every year',open(),greedy);
run('3 stations + 2 trains, greedy',open(LINE,[[2,2],[7,2],[12,5]],2),greedy);
run('short west line, greedy (grow it)',open(LINE.slice(0,9),[[2,2],[7,2],[8,4]]),greedy);
run('short east line, greedy',open(LINE.slice(8),[[9,6],[12,5]]),greedy);
