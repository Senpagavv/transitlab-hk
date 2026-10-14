(function(root) {
  'use strict';
  // v7 · mode 4 «buses on the road» — levels. The same Kowloon East as mode 3, a few years on: the 東九龍綫 built in
  // mode 3 (the AI's master line) is running, 啟德 and the 安達臣道 estates have filled up (people × about 1.5), and
  // parking in the business areas costs more (觀塘 6, 九龍灣 5 blocks). Buses fill the last gaps. Kowloon East as a 14 × 12 grid, one cell ≈ 600 m (cell = (x − 837,500,
  // 823,500 − y) / 600 on the HK1980 grid). Positions, population and jobs come from the model: zone centres
  // (data/model/zone-centres.parquet) and zones-2026.geojson; congestion from the AM-peak road assignment
  // (data/model/assignment-am-2026.parquet). Game numbers are a sketch of those (tier D, for learning only):
  //   people      a day to the two centres, ≈ residents ÷ 2,000 (the scenario adds 安達臣道 and a full 啟德)
  //   attraction  the pull of a business area (16 + jobs ÷ 15,000, the scenario adds half again to the jobs)
  //   roads       waypoints on the grid (each leg horizontal, then vertical) and the cars a day a section takes
  //   lines       the metro already there: 觀塘綫 (彩虹 → 油塘) and 將軍澳綫 (油塘 → 寶琳), stations and trains
  const KE={title:'九龍東 · 巴士補上最後一段',cols:14,rows:12,
    // zones: 啟德站一帶 286.2 pop 84,141 (+180%); 牛頭角 291.x/294.x ≈ 116k; 順利·安泰 292.x ≈ 72k (+ 安達臣道 ≈ 25k);
    // 秀茂坪·寶達·安達 293S.x ≈ 109k (+21%); 藍田 297.x/290.1 ≈ 120k; 將軍澳 836–839 ≈ 300k (part of it comes this way)
    origins:[
      {name:'啟德',hans:'启德',cell:[2,4],house:[-1,0],people:70,tag:'new'},
      {name:'牛頭角',hans:'牛头角',cell:[5,4],house:[0,-1],people:56},
      {name:'順利·安達臣道',hans:'顺利·安达臣道',short:'順利',shortHans:'顺利',cell:[7,2],house:[0,-1],people:80,tag:'new'},
      {name:'秀茂坪',hans:'秀茂坪',cell:[9,5],house:[1,0],people:62},
      {name:'藍田',hans:'蓝田',cell:[9,8],house:[1,0],people:66},
      {name:'將軍澳',hans:'将军澳',cell:[13,7],house:[1,0],people:84}],
    // 觀塘站一帶 295: jobs 151,391, office 1.65 M m²; 九龍灣站一帶 280.1: jobs 86,552, office 1.14 M m²
    destinations:[
      {name:'觀塘商貿區',hans:'观塘商贸区',short:'觀塘',shortHans:'观塘',kind:'jobs',cell:[6,7],house:[0,1],attraction:28,carExtra:6},
      {name:'九龍灣商貿區',hans:'九龙湾商贸区',short:'九龍灣',shortHans:'九龙湾',kind:'town',cell:[3,6],house:[-1,0],attraction:24,carExtra:5}],
    // AM peak v/c (max on the road in this box): 觀塘繞道 1.57, 觀塘道 1.17, 清水灣道 2.35, 將軍澳隧道公路 0.89 (將軍澳道 1.15),
    // 將藍公路 1.52, 寶琳路 1.22
    roads:[
      {name:'觀塘繞道',hans:'观塘绕道',via:[[0,4],[2,4],[2,5],[4,5],[4,8],[8,8]],cap:70},
      {name:'觀塘道',hans:'观塘道',via:[[2,4],[2,3],[4,3],[4,4],[6,4],[6,6],[7,6],[7,7],[8,7],[8,8]],cap:45},
      {name:'開源道',hans:'开源道',via:[[4,6],[6,6]],cap:40},
      {name:'清水灣道',hans:'清水湾道',via:[[4,3],[4,2],[13,2]],cap:30},
      {name:'秀茂坪道',hans:'秀茂坪道',via:[[8,2],[8,7]],cap:30},
      {name:'將軍澳隧道',hans:'将军澳隧道',via:[[8,5],[12,5],[12,7]],cap:45},
      {name:'將藍隧道',hans:'将蓝隧道',via:[[8,8],[12,8],[12,7]],cap:40}],
    lines:[
      {name:'觀塘綫',hans:'观塘线',color:'#1E9A4A',via:[[4,2],[4,4],[5,4],[5,5],[6,5],[6,6],[7,6],[7,7],[7,8],[8,8],[8,9]],
        stations:[[4,2],[4,4],[5,5],[6,6],[7,7],[8,9]],names:['彩虹','九龍灣','牛頭角','觀塘','藍田','油塘'],namesHans:['彩虹','九龙湾','牛头角','观塘','蓝田','油塘'],trains:3},
      {name:'將軍澳綫',hans:'将军澳线',color:'#7D499D',via:[[8,9],[12,9],[12,4]],stations:[[8,9],[11,9],[12,8],[12,5]],names:['油塘','調景嶺','將軍澳','寶琳'],namesHans:['油塘','调景岭','将军澳','宝琳'],trains:3},
      // built in mode 3 (bots/v7_roads.js best plan): 寶琳 → 秀茂坪 → 觀塘商貿區 → 九龍灣商貿區
      {name:'東九龍綫',hans:'东九龙线',color:'#9A3B26',mine:true,via:[[12,5],[6,5],[6,7],[3,7],[3,6]],stations:[[12,5],[9,5],[6,7],[3,6]],names:['寶琳','秀茂坪','觀塘商貿','九龍灣商貿'],namesHans:['宝琳','秀茂坪','观塘商贸','九龙湾商贸'],trains:3}],
    // decoration: the harbour
    water:[[0,6],[1,6],[0,7],[1,7],[2,7],[0,8],[1,8],[2,8],[0,9],[1,9],[2,9],[3,9],[0,10],[1,10],[2,10],[3,10],[4,10],[5,10],[0,11],[1,11],[2,11],[3,11],[4,11],[5,11],[6,11],[7,11]],
    // buses: wait = busHead ÷ buses on the route; perBus a day a section; busPCU cars' worth on the road; a bus lane takes
    // laneCut of the road from the cars. A year's budget: a bus busCost, a bus lane laneCost.
    walkPer:3,wait:2,busHead:6,perBus:16,busPCU:2,laneCut:.4,budget:12,busCost:1,laneCost:3,maxRoutes:3,perTrain:40,years:8,crowdBlocks:4,nearby:10,stay:40,learn:.3,
    tiers:[250,500,750]};
  const LEVELS={'m4-1':KE};
  const pick=(typeof location!=='undefined'&&(/(?:^|[#&])map=([\w-]+)/.exec(location.hash)||[])[1])||'m4-1';
  const D={};
  const swap=name=>{const L=JSON.parse(JSON.stringify(LEVELS[name]));for(const k of Object.keys(D))delete D[k];Object.assign(D,L,{map:name,levels:Object.keys(LEVELS)});return true;};
  swap(LEVELS[pick]?pick:'m4-1');
  Object.defineProperty(D,'select',{enumerable:false,value(name){return LEVELS[name]?swap(name):false;}});
  Object.defineProperty(D,'use',{enumerable:false,value(def,name='draft'){LEVELS[name]=def;return swap(name);}});
  Object.defineProperty(D,'example',{enumerable:false,value(name){return LEVELS[name]?JSON.parse(JSON.stringify(LEVELS[name])):null;}});
  if(typeof module!=='undefined')module.exports=D;
  root.BUS_DATA=D;
})(typeof window!=='undefined'?window:globalThis);
