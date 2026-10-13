(function(root) {
  'use strict';
  // v7 · mode 2 «the metro» — levels. First draft: one board, a schematic of north-west New Territories (Tin Shui Wai
  // → Hung Shui Kiu → Yuen Long) with a planned east–west line. Names are real places; positions, numbers and the line
  // itself are a game sketch (not the real Tuen Ma line). One block ≈ 400 m.
  //   line          the planned alignment, west → east, one cell after another (stations go on these cells)
  //   origins       estates: people a week (if every one of them tried the metro) and where they go (shares of
  //                 `destinations`, in order)
  //   destinations  where people go
  const LEVELS={
    'm2-1':{title:'新界西北 · 東西線',cols:15,rows:9,
      line:[[1,5],[2,5],[3,5],[4,5],[5,5],[6,5],[7,5],[7,4],[8,4],[9,4],[10,4],[11,4],[12,4],[13,4]],
      origins:[
        {name:'天瑞邨',hans:'天瑞邨',cell:[1,7],house:[0,40],people:42,to:[.5,.3,.2]},
        {name:'天耀邨',hans:'天耀邨',cell:[3,2],house:[0,-40],people:48,to:[.5,.3,.2]},
        {name:'天恆邨',hans:'天恒邨',cell:[5,8],house:[0,40],people:39,to:[.55,.3,.15]},
        {name:'洪福邨',hans:'洪福邨',cell:[9,6],house:[0,40],people:34,to:[.6,.25,.15]},
        {name:'朗屏邨',hans:'朗屏邨',cell:[11,1],house:[0,-40],people:36,to:[.45,.35,.2]},
        {name:'水邊圍',hans:'水边围',cell:[13,7],house:[0,40],people:28,to:[.45,.35,.2]}],
      destinations:[
        {name:'元朗市中心',hans:'元朗市中心',short:'元朗',shortHans:'元朗',en:'Yuen Long town centre',kind:'town',cell:[14,4],house:[40,0]},
        {name:'洪水橋新發展區',hans:'洪水桥新发展区',short:'洪水橋',shortHans:'洪水桥',en:'Hung Shui Kiu new town',kind:'jobs',cell:[7,1],house:[0,-40]},
        {name:'天水圍醫院 · 學校',hans:'天水围医院 · 学校',short:'天水圍北',shortHans:'天水围北',en:'Tin Shui Wai hospital · schools',kind:'school',cell:[0,3],house:[0,40]}],
      weeks:6,habit:{start:.35,rate:.5,floor:.1},
      stationsMax:4,trainsMin:1,trainsMax:5,budget:15,cap:10,platform:16,trainStep:2.5,dwell:4,turn:10,
      firstWave:20,release:110,tiers:[760,880,930]}   // bots/v7_metro_tune.js: default trains best 845 (p90 720, median 607); best plan 939
  };
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
