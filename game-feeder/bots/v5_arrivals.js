// Compare the current rule (2 trips from home, 1 switch per trip) with a cap of N stop arrivals (switch freely)
const E=require('../v5/engine.js'),{D,P,Game}=E;
for(const name of ['l1','l2','l3']){
  for(const N of [0,2,3,4,5,6]){D.select(name);E.reset();P.maxArrivals=N;const C=D.candidates,total=D.waves.flat().reduce((a,b)=>a+b,0);
    const layouts=[];for(let a=0;a<C.length;a++)for(let b=a+1;b<C.length;b++)for(let c=b+1;c<C.length;c++)layouts.push([a,b,c]);
    const games=layouts.map(l=>{const g=new Game();l.forEach((c,id)=>g.place(id,C[c]));g.start();g.advance(P.duration+1);return g;}).sort((a,b)=>b.delivered-a.delivered);
    const sc=games.map(g=>g.delivered),top=games.slice(0,10);
    let arr=0,ppl=0,many=0,maxA=0,carsTop=0,arrDrove=0,drove=0,time=0;
    for(const g of top){carsTop+=g.cars;time+=g.t;for(const p of g.people){const a=g.events.filter(e=>e.id===p.id&&(e.type==='queue'||e.type==='full')).length;
      arr+=a;ppl++;if(a>=3)many++;maxA=Math.max(maxA,a);if(p.state==='car'){arrDrove+=a;drove++;}}}
    console.log(`${name} ${N?('cap '+N).padEnd(7):'now    '} best ${sc[0]}/${total} perfect ${String(sc.filter(s=>s===total).length).padStart(2)} p90 ${sc[Math.floor(.1*sc.length)]} median ${sc[Math.floor(sc.length/2)]} | best 10: drove ${(carsTop/10).toFixed(1)}, stop visits per person ${(arr/ppl).toFixed(2)}, ≥3 visits ${(100*many/ppl).toFixed(1)}%, most ${maxA}, drivers visited ${(arrDrove/Math.max(1,drove)).toFixed(1)}, game ${Math.round(time/10)} s`);}
}
