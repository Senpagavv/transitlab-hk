(function(root) {
  'use strict';
  const D=typeof module!=='undefined'?require('./data.js'):root.METRO_DATA;
  // v7 · mode 2 «the metro» — six years of one line (2026-10-13: the static version, commit b36f747, was too quick to
  // solve; the lead asked for the experience constant to iterate). Everything is counted in blocks:
  //   a metro trip = walk to a station + wait 2 + 1 for every station passed + walk from the station; the car trip is
  //   the blocks apart + 2 to park. Tenths who switch = blocks saved + the estate's EXPERIENCE (0…10).
  //   Experience (the mode constant of a choice model, made visible): each estate starts at `exp.start` (a new line,
  //   nobody knows it). After every year it moves 1 step: +1 if the estate's riders rode in comfort, −1 if more than a
  //   third of them sat in a crowded section (between `exp.min` and `exp.max`). An estate nobody of which rides
  //   doesn't change.
  //   Crowding: every section of line (between two neighbouring cells) carries everyone whose ride passes it; it holds
  //   `trains` × `perTrain` a day. Over that, the section is crowded.
  //   Money: you open with `budget`. After each year the fares bring 1 for every `fare` riders a day. Between years you
  //   may extend the line at either end, add stations, add trains — never remove what is built.
  //   Score: the riders of all years added up (car trips saved).
  const P={wait:2,lineCost:1,stationCost:3,trainCost:4,perTrain:40,fare:10,budget:30,years:6,crowdShare:1/3,
    exp:{start:-3,min:-3,max:3},target:0,highScore:0,masterScore:0};
  const key=c=>c.join(','),same=(a,b)=>a&&b&&a[0]===b[0]&&a[1]===b[1];
  const walk=(a,b)=>Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]);
  const adj=(a,b)=>walk(a,b)===1;
  function reset(){for(const k of ['wait','lineCost','stationCost','trainCost','perTrain','fare','budget','years','crowdShare'])if(D[k]!==undefined)P[k]=D[k];
    if(D.exp)P.exp={...P.exp,...D.exp};[P.target,P.highScore,P.masterScore]=D.tiers||[0,0,0];}
  reset();
  // every desire line: from estate i to destination k, people a day and the car trip in blocks
  function trips(){const out=[];D.origins.forEach((o,i)=>o.to.forEach((n,k)=>{if(n>0)out.push({i,k,people:n,car:D.car[i][k]});}));return out;}
  // the best metro trip for one desire line: the station pair (board, alight) with the fewest blocks
  function best(trip,line,stations){
    const o=D.origins[trip.i].cell,d=D.destinations[trip.k].cell,order=stations.map(s=>({x:line.findIndex(c=>same(c,s)),c:s})).sort((a,b)=>a.x-b.x);
    let b=null;
    order.forEach((a,ia)=>order.forEach((z,iz)=>{if(ia===iz)return;
      const wa=walk(o,a.c),wz=walk(z.c,d),pass=Math.abs(iz-ia)-1,metro=wa+P.wait+pass+wz;
      if(!b||metro<b.metro)b={from:a.c,to:z.c,fx:a.x,tx:z.x,walkA:wa,pass,walkB:wz,metro};}));
    return b;
  }
  // a year with this line, these stations, these trains and this experience: every desire line, every section's load
  function evaluate(line,stations,exp=D.origins.map(()=>0),trains=1){
    const rows=trips().map(tr=>{const b=best(tr,line,stations),e=exp[tr.i];
      if(!b)return{...tr,metro:null,save:0,exp:e,tenths:0,riders:0};
      const save=Math.max(0,tr.car-b.metro),tenths=Math.max(0,Math.min(10,save>0?save+e:0));
      return{...tr,...b,save,exp:e,tenths,riders:Math.round(tr.people*tenths/10)};});
    // section j joins line[j] and line[j+1]
    const load=Array(Math.max(0,line.length-1)).fill(0),cap=trains*P.perTrain;
    for(const r of rows)if(r.riders)for(let j=Math.min(r.fx,r.tx);j<Math.max(r.fx,r.tx);j++)load[j]+=r.riders;
    const crowded=load.map(n=>n>cap);
    for(const r of rows){r.crowded=false;if(r.riders)for(let j=Math.min(r.fx,r.tx);j<Math.max(r.fx,r.tx);j++)if(crowded[j]){r.crowded=true;break;}}
    const riders=rows.reduce((a,r)=>a+r.riders,0);
    return{rows,riders,load,cap,crowded,people:rows.reduce((a,r)=>a+r.people,0)};
  }
  // how each estate's experience moves after a year
  function nextExp(ev,exp){return D.origins.map((o,i)=>{const rs=ev.rows.filter(r=>r.i===i&&r.riders),n=rs.reduce((a,r)=>a+r.riders,0);
    if(!n)return exp[i];const bad=rs.filter(r=>r.crowded).reduce((a,r)=>a+r.riders,0)/n;
    return Math.max(P.exp.min,Math.min(P.exp.max,exp[i]+(bad>P.crowdShare?-1:1)));});}
  // the game: year 0 is planning (draw freely within the budget); then each year runs, the fares come in, and you may
  // only add to what is built
  class Plan {
    constructor(){Object.assign(this,{line:[],stations:[],trains:1,money:P.budget,year:0,exp:D.origins.map(()=>P.exp.start),
      builtLine:0,builtStations:[],log:[],total:0,done:false});}
    get open(){return this.year>0;}
    cost(){return this.open?0:this.line.length*P.lineCost+this.stations.length*P.stationCost+(this.trains-1)*P.trainCost;}
    left(){return this.money;}
    inside(c){return c[0]>=0&&c[1]>=0&&c[0]<D.cols&&c[1]<D.rows;}
    onLine(c){return this.line.some(x=>same(x,c));}
    isStation(c){return this.stations.some(x=>same(x,c));}
    built(c){return this.open&&(this.builtStations.some(x=>same(x,c)));}
    canExtend(c){if(this.done||!this.inside(c)||this.onLine(c)||this.money<P.lineCost)return false;
      if(!this.line.length)return true;return adj(c,this.line[0])||adj(c,this.line.at(-1));}
    extend(c){if(!this.canExtend(c))return false;if(!this.line.length||adj(c,this.line.at(-1)))this.line.push(c.slice());else this.line.unshift(c.slice());
      this.money-=P.lineCost;return true;}
    isEnd(c){return this.line.length>0&&(same(c,this.line[0])||same(c,this.line.at(-1)));}
    // an end cell comes off only while it isn't built yet (in year 0 anything; later only this year's additions)
    canShorten(c){if(!this.isEnd(c)||this.done)return false;if(!this.open)return true;const i=this.line.findIndex(x=>same(x,c));return !this.builtCells().has(key(this.line[i]));}
    shorten(c){if(!this.canShorten(c))return false;if(same(c,this.line.at(-1)))this.line.pop();else{this.line.shift();}
      if(this.isStation(c)){this.stations=this.stations.filter(s=>!same(s,c));this.money+=P.stationCost;}this.money+=P.lineCost;return true;}
    builtCells(){return new Set(this.open?this.builtSet:[]);}
    canStation(c){return !this.done&&this.onLine(c)&&!this.isStation(c)&&this.money>=P.stationCost;}
    toggleStation(c){
      if(this.isStation(c)){if(this.built(c)||this.done)return false;this.stations=this.stations.filter(s=>!same(s,c));this.money+=P.stationCost;return true;}
      if(!this.canStation(c))return false;this.stations.push(c.slice());this.money-=P.stationCost;return true;}
    canTrain(){return !this.done&&this.money>=P.trainCost;}
    addTrain(){if(!this.canTrain())return false;this.trains++;this.money-=P.trainCost;return true;}
    canUntrain(){return !this.done&&this.trains>(this.open?this.builtTrains:1);}
    removeTrain(){if(!this.canUntrain())return false;this.trains--;this.money+=P.trainCost;return true;}
    clear(){if(this.open)return false;Object.assign(this,{line:[],stations:[],trains:1,money:P.budget});return true;}
    evaluate(){return evaluate(this.line,this.stations,this.exp,this.trains);}
    // what one more station / one less would do this year (the preview)
    withStation(c){const s=this.isStation(c)?this.stations.filter(x=>!same(x,c)):[...this.stations,c];return evaluate(this.line,s,this.exp,this.trains);}
    withTrains(n){return evaluate(this.line,this.stations,this.exp,n);}
    // run a year: count it, collect the fares, move every estate's experience; what was planned is now built
    canRun(){return !this.done&&this.stations.length>=2;}
    runYear(){if(!this.canRun())return null;
      const ev=this.evaluate(),income=Math.floor(ev.riders/P.fare),before=this.exp.slice(),after=nextExp(ev,this.exp);
      this.year++;this.total+=ev.riders;this.money+=income;this.exp=after;
      this.builtSet=this.line.map(key);this.builtStations=this.stations.map(c=>c.slice());this.builtTrains=this.trains;
      const entry={year:this.year,riders:ev.riders,income,before,after,trains:this.trains,crowdedSections:ev.crowded.filter(Boolean).length,stations:this.stations.length,line:this.line.length};
      this.log.push(entry);if(this.year>=P.years)this.done=true;return{...entry,ev};}
    copy(){const p=new Plan();Object.assign(p,JSON.parse(JSON.stringify({...this})));return p;}
  }
  const API={D,P,Plan,evaluate,nextExp,trips,best,walk,same,key,adj,reset};
  if(typeof module!=='undefined')module.exports=API;root.Metro=API;
})(typeof window!=='undefined'?window:globalThis);
