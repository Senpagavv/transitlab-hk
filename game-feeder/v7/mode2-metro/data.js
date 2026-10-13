(function(root) {
  'use strict';
  // v7 · mode 2 «the metro» (static version) — levels. A schematic of north-west New Territories: five estates, two
  // places people go each morning. Names are real; positions and numbers are a game sketch. One block ≈ 400 m.
  //   origins       estates: people a day to each destination (in the order of `destinations`)
  //   destinations  where people go
  //   car           the car trip in blocks for each estate → destination: the blocks apart + `park` (finding a space
  //                 and walking from it) — written out so the board can show it
  function carTable(origins,dests,park=2){return origins.map(o=>dests.map(d=>Math.abs(o.cell[0]-d.cell[0])+Math.abs(o.cell[1]-d.cell[1])+park));}
  const NW={title:'新界西北 · 一條新線',cols:14,rows:9,
    origins:[
      {name:'天耀邨',hans:'天耀邨',cell:[2,2],house:[0,-1],to:[40,20]},
      {name:'天瑞邨',hans:'天瑞邨',cell:[1,7],house:[0,1],to:[36,18]},
      {name:'天恆邨',hans:'天恒邨',cell:[5,6],house:[0,1],to:[30,20]},
      {name:'洪福邨',hans:'洪福邨',cell:[8,7],house:[0,1],to:[24,22]},
      {name:'朗屏邨',hans:'朗屏邨',cell:[10,1],house:[0,-1],to:[30,14]}],
    destinations:[
      {name:'元朗市中心',hans:'元朗市中心',kind:'town',cell:[13,4],house:[1,0]},
      {name:'洪水橋新發展區',hans:'洪水桥新发展区',kind:'jobs',cell:[7,2],house:[0,-1]}],
    wait:2,lineCost:1,stationCost:3,trainCost:4,perTrain:40,fare:10,budget:30,years:6,exp:{start:-3,min:-3,max:3},
    // bots/v7_metro_years.js (six years): never spending 333, trains only 579, trains + extensions 694
    tiers:[450,600,680]};
  NW.car=carTable(NW.origins,NW.destinations);
  const LEVELS={'m2-1':NW};
  const pick=(typeof location!=='undefined'&&(/(?:^|[#&])map=([\w-]+)/.exec(location.hash)||[])[1])||'m2-1';
  const D={};
  const swap=name=>{const L=JSON.parse(JSON.stringify(LEVELS[name]));for(const k of Object.keys(D))delete D[k];Object.assign(D,L,{map:name,levels:Object.keys(LEVELS)});return true;};
  swap(LEVELS[pick]?pick:'m2-1');
  Object.defineProperty(D,'select',{enumerable:false,value(name){return LEVELS[name]?swap(name):false;}});
  Object.defineProperty(D,'use',{enumerable:false,value(def,name='draft'){if(!def.car)def.car=carTable(def.origins,def.destinations,def.park);LEVELS[name]=def;return swap(name);}});
  Object.defineProperty(D,'example',{enumerable:false,value(name){return LEVELS[name]?JSON.parse(JSON.stringify(LEVELS[name])):null;}});
  if(typeof module!=='undefined')module.exports=D;
  root.METRO_DATA=D;
})(typeof window!=='undefined'?window:globalThis);
