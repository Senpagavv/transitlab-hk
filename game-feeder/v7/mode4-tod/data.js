(function(root) {
  'use strict';
  // North-west New Territories board, one block about 400 m. Empty land is illustrative.
  const NW={title:'新界西北 · 站旁开发',cols:14,rows:9,
    origins:[
      {name:'天耀邨',hans:'天耀邨',cell:[2,2],house:[0,-1],people:60},
      {name:'天瑞邨',hans:'天瑞邨',cell:[1,7],house:[0,1],people:54},
      {name:'天恆邨',hans:'天恒邨',cell:[5,6],house:[0,1],people:50},
      {name:'洪福邨',hans:'洪福邨',cell:[8,7],house:[0,1],people:46},
      {name:'朗屏邨',hans:'朗屏邨',cell:[10,1],house:[0,-1],people:44}],
    destinations:[
      {name:'元朗市中心',hans:'元朗市中心',short:'元朗',shortHans:'元朗',kind:'town',cell:[13,4],house:[1,0],attraction:24,carExtra:3},
      {name:'洪水橋新發展區',hans:'洪水桥新发展区',short:'洪水橋',shortHans:'洪水桥',kind:'jobs',cell:[7,2],house:[0,-1],attraction:10,carExtra:7}],
    // Empty land only: 洪水橋一帶 7 格、元朗西邊 5 格、天水圍北 4 格。
    // These cells do not overlap the estates, destinations, roads or water on this schematic map.
    land:[
      {cell:[5,1]},{cell:[6,1]},{cell:[8,1]},{cell:[9,1]},
      {cell:[5,3]},{cell:[8,3]},{cell:[9,3]},
      {cell:[11,3]},{cell:[12,3]},{cell:[11,4]},{cell:[12,4]},{cell:[11,5]},
      {cell:[3,3]},{cell:[4,3]},{cell:[3,4]},{cell:[4,4]}],
    walkPer:2,nearby:10,stay:40,wait:2,lineCost:1,stationCost:3,trainCost:4,perTrain:40,budget:40,years:8,crowdBlocks:4,
    aware:{start:.2,spread:2},homePeople:16,shopBase:4,shopPer:6,carExtra:5,homeRate:3,shopRate:.5,
    // bots/v7_tod.js: 60 random starts; homeRate 3 and shopRate 0.5 give best mixed 1538, local median 923, p90 1148.
    // tiers (bots/v7_tod.js, learnt crowding): only the line 655, all homes 1309, all shops 1201, best mix 1545 →
    // pass 900, high 1250 (one kind of land can just reach it), master 1400 (needs both kinds)
    tiers:[900,1250,1400]};
  const LEVELS={'m4-1':NW};
  // levels added as files (v7/levels/m4/*.json → levels/registry.js) join these; the same key replaces one
  for(const L of (root.TL_LEVELS?root.TL_LEVELS.mode(4):[]))if(L.level)LEVELS[L.key]=L.level;
  const pick=(typeof location!=='undefined'&&(/(?:^|[#&])map=([\w-]+)/.exec(location.hash)||[])[1])||'m4-1';
  const D={};
  const swap=name=>{const L=JSON.parse(JSON.stringify(LEVELS[name]));for(const k of Object.keys(D))delete D[k];Object.assign(D,L,{map:name,levels:Object.keys(LEVELS)});return true;};
  swap(LEVELS[pick]?pick:'m4-1');
  Object.defineProperty(D,'select',{enumerable:false,value(name){return LEVELS[name]?swap(name):false;}});
  Object.defineProperty(D,'use',{enumerable:false,value(def,name='draft'){LEVELS[name]=def;return swap(name);}});
  Object.defineProperty(D,'example',{enumerable:false,value(name){return LEVELS[name]?JSON.parse(JSON.stringify(LEVELS[name])):null;}});
  if(typeof module!=='undefined')module.exports=D;
  root.TOD_DATA=D;
})(typeof window!=='undefined'?window:globalThis);
