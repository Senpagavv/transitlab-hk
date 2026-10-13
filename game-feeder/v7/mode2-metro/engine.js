(function(root) {
  'use strict';
  const D=typeof module!=='undefined'?require('./data.js'):root.METRO_DATA;
  // v7 · mode 2 «the metro», static version (2026-10-13, after the lead's review of the first draft — that one, with
  // weeks, trains and habit, is commit c1ba721). One rule, counted in blocks:
  //   a metro trip = walk to a station (blocks) + wait 2 + 1 for every station the train passes on the way + walk from
  //   the station (blocks). The car trip is a number on each desire line. Every block the metro saves on the car,
  //   one in ten people switch: 3 blocks saved → 3 in 10 (capped at 10 in 10).
  //   You draw one line on the grid (it may turn, never branches) and put stations on it, within a budget: each block
  //   of line costs `lineCost`, each station `stationCost`.
  //   Score: people a day who leave the car for the metro (car trips saved).
  const P={wait:2,lineCost:1,stationCost:3,budget:30,target:0,highScore:0,masterScore:0};
  const key=c=>c.join(','),same=(a,b)=>a&&b&&a[0]===b[0]&&a[1]===b[1];
  const walk=(a,b)=>Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]);
  const adj=(a,b)=>walk(a,b)===1;
  function reset(){for(const k of ['wait','lineCost','stationCost','budget'])if(D[k]!==undefined)P[k]=D[k];[P.target,P.highScore,P.masterScore]=D.tiers||[0,0,0];}
  reset();
  // every desire line: from estate i to destination k, people a day and the car trip in blocks
  function trips(){const out=[];D.origins.forEach((o,i)=>o.to.forEach((n,k)=>{if(n>0)out.push({i,k,people:n,car:D.car[i][k]});}));return out;}
  const cost=(line,stations)=>line.length*P.lineCost+stations.length*P.stationCost;
  // the best metro trip for one desire line: the station pair (board, alight) with the fewest blocks
  function best(trip,line,stations){
    const o=D.origins[trip.i].cell,d=D.destinations[trip.k].cell,order=stations.map(s=>line.findIndex(c=>same(c,s))).map((x,j)=>({x,c:stations[j]})).sort((a,b)=>a.x-b.x);
    let b=null;
    order.forEach((a,ia)=>order.forEach((z,iz)=>{if(ia===iz)return;
      const wa=walk(o,a.c),wz=walk(z.c,d),pass=Math.abs(iz-ia)-1,metro=wa+P.wait+pass+wz;
      if(!b||metro<b.metro)b={from:a.c,to:z.c,walkA:wa,pass,walkB:wz,metro};}));
    return b;
  }
  // the whole board: every desire line's metro trip, blocks saved, share (tenths) and riders; the total
  function evaluate(line,stations){
    const rows=trips().map(tr=>{const b=best(tr,line,stations);
      if(!b)return{...tr,metro:null,save:0,tenths:0,riders:0};
      const save=Math.max(0,tr.car-b.metro),tenths=Math.min(10,save);
      return{...tr,...b,save,tenths,riders:Math.round(tr.people*tenths/10)};});
    return{rows,riders:rows.reduce((a,r)=>a+r.riders,0),cost:cost(line,stations),people:rows.reduce((a,r)=>a+r.people,0)};
  }
  // the plan being drawn: one line of cells (each next to the one before, none twice) and stations on it
  class Plan {
    constructor(){this.line=[];this.stations=[];}
    cost(){return cost(this.line,this.stations);}
    left(){return P.budget-this.cost();}
    inside(c){return c[0]>=0&&c[1]>=0&&c[0]<D.cols&&c[1]<D.rows;}
    onLine(c){return this.line.some(x=>same(x,c));}
    isStation(c){return this.stations.some(x=>same(x,c));}
    // a cell the line can grow into: empty, next to one end (any free cell to begin with)
    canExtend(c){if(!this.inside(c)||this.onLine(c)||this.left()<P.lineCost)return false;
      if(!this.line.length)return true;return adj(c,this.line[0])||adj(c,this.line.at(-1));}
    extend(c){if(!this.canExtend(c))return false;if(!this.line.length||adj(c,this.line.at(-1)))this.line.push(c.slice());else this.line.unshift(c.slice());return true;}
    // take an end cell off (its station goes with it)
    isEnd(c){return this.line.length>0&&(same(c,this.line[0])||same(c,this.line.at(-1)));}
    shorten(c){if(!this.isEnd(c))return false;if(same(c,this.line.at(-1)))this.line.pop();else this.line.shift();this.stations=this.stations.filter(s=>!same(s,c));return true;}
    canStation(c){return this.onLine(c)&&!this.isStation(c)&&this.left()>=P.stationCost;}
    toggleStation(c){if(this.isStation(c)){this.stations=this.stations.filter(s=>!same(s,c));return true;}if(!this.canStation(c))return false;this.stations.push(c.slice());return true;}
    clear(){this.line=[];this.stations=[];}
    evaluate(){return evaluate(this.line,this.stations);}
    // what one more station / one less would do (the preview)
    withStation(c){const s=this.isStation(c)?this.stations.filter(x=>!same(x,c)):[...this.stations,c];return evaluate(this.line,s);}
    copy(){const p=new Plan();p.line=this.line.map(c=>c.slice());p.stations=this.stations.map(c=>c.slice());return p;}
  }
  const API={D,P,Plan,evaluate,trips,best,walk,same,key,adj,reset,cost};
  if(typeof module!=='undefined')module.exports=API;root.Metro=API;
})(typeof window!=='undefined'?window:globalThis);
