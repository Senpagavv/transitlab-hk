'use strict';
// v6: how much the free moves in the breaks can rescue a so-so opening (greedy, break by break).
//   node bots/v6_recover.js l4 [overrides-json]
const E=require('../v6/engine.js'),{D,P}=E;
const [name,over]=process.argv.slice(2);
const base=D.example(name),o=over?JSON.parse(over):{};
if(o.waves&&o.days)o.waves=Array(o.days).fill(o.waves[0]);
if(o.habit)o.habit={...base.habit,...o.habit};
D.use({...base,...o},name);E.reset();
const C=D.candidates,n=C.length,R=D.waves.length;
function play(l,moves=[]){const g=new E.Game();l.forEach((c,id)=>g.place(id,C[c]));g.start();
  for(const m of moves){g.runTo(m.r);g.place(m.id,C[m.to]);}g.advance(P.duration+1);return g;}
const L=[];for(let a=0;a<n;a++)for(let b=a+1;b<n;b++)for(let c=b+1;c<n;c++)L.push([a,b,c]);
const st=L.map(l=>({l,s:play(l).delivered})).sort((x,y)=>y.s-x.s);
function plan(l){const moves=[];let s=play(l).delivered;
  for(let r=1;r<R;r++)for(let k=0;k<3;k++){const cells=l.slice();for(const m of moves)cells[m.id]=m.to;let pick=null;
    for(let id=0;id<3;id++){if(moves.some(m=>m.r===r&&m.id===id))continue;for(let to=0;to<n;to++){if(cells.includes(to))continue;
      const d=play(l,[...moves,{r,id,to}]).delivered;if(d>s&&(!pick||d>pick.d))pick={d,m:{r,id,to}};}}
    if(!pick)break;moves.push(pick.m);s=pick.d;}
  return{s,moves};}
console.log('total',D.waves.flat().reduce((a,b)=>a+b,0),'best static',st[0].s);
for(const q of [0,.1,.25,.5,.75]){const x=st[Math.floor(q*(st.length-1))],p=plan(x.l);
  console.log(`p${Math.round(100-100*q)} opening ${x.l.map(i=>C[i].join(',')).join(' ')} static ${x.s} -> with break moves ${p.s} (${p.moves.map(m=>'d'+(m.r+1)+':'+'ABC'[m.id]+'>'+C[m.to].join(',')).join(' ')})`);}
