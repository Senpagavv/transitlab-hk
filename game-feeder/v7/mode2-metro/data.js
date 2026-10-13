(function(root) {
  'use strict';
  // v7 · mode 2 «the metro» (build once, watch it grow) — levels. A schematic of north-west New Territories: five estates, two
  // places people go each morning. Names are real; positions and numbers are a game sketch. One block ≈ 400 m.
  //   origins       estates: people who go out each day
  //   destinations  where they may go, with an attraction (pull = attraction − blocks to get there)
  //   nearby        the fixed pull of «somewhere nearby» (where people go who don't go to the destinations)
  //   carExtra      a destination's parking and access by car, in blocks (the new town: roads unfinished, little
  //                 parking — the metro is what opens it up)
  const NW={title:'新界西北 · 一條新線',cols:14,rows:9,
    origins:[
      {name:'天耀邨',hans:'天耀邨',cell:[2,2],house:[0,-1],people:60},
      {name:'天瑞邨',hans:'天瑞邨',cell:[1,7],house:[0,1],people:54},
      {name:'天恆邨',hans:'天恒邨',cell:[5,6],house:[0,1],people:50},
      {name:'洪福邨',hans:'洪福邨',cell:[8,7],house:[0,1],people:46},
      {name:'朗屏邨',hans:'朗屏邨',cell:[10,1],house:[0,-1],people:44}],
    destinations:[
      {name:'元朗市中心',hans:'元朗市中心',short:'元朗',shortHans:'元朗',kind:'town',cell:[13,4],house:[1,0],attraction:24,carExtra:3},
      {name:'洪水橋新發展區',hans:'洪水桥新发展区',short:'洪水橋',shortHans:'洪水桥',kind:'jobs',cell:[7,2],house:[0,-1],attraction:22,carExtra:7}],
    nearby:10,wait:2,lineCost:1,stationCost:3,trainCost:4,perTrain:40,budget:30,years:8,crowdBlocks:2,aware:{start:.2,spread:1.5},
    // bots/v7_metro_grow.js (local search, eight-year totals): best 694 (never crowded), local optima p90 ~510, median
    // ~360; the plain 天耀邨 → 洪水橋 → 元朗 line with 3 stations and 2 trains: 642 (crowded in three years)
    tiers:[400,550,660]};
  const LEVELS={'m2-1':NW};
  const pick=(typeof location!=='undefined'&&(/(?:^|[#&])map=([\w-]+)/.exec(location.hash)||[])[1])||'m2-1';
  const D={};
  const swap=name=>{const L=JSON.parse(JSON.stringify(LEVELS[name]));for(const k of Object.keys(D))delete D[k];Object.assign(D,L,{map:name,levels:Object.keys(LEVELS)});return true;};
  swap(LEVELS[pick]?pick:'m2-1');
  Object.defineProperty(D,'select',{enumerable:false,value(name){return LEVELS[name]?swap(name):false;}});
  Object.defineProperty(D,'use',{enumerable:false,value(def,name='draft'){LEVELS[name]=def;return swap(name);}});
  Object.defineProperty(D,'example',{enumerable:false,value(name){return LEVELS[name]?JSON.parse(JSON.stringify(LEVELS[name])):null;}});
  if(typeof module!=='undefined')module.exports=D;
  root.METRO_DATA=D;
})(typeof window!=='undefined'?window:globalThis);
