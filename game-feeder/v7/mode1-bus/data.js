(function(root) {
  // v7 · mode 1 «stations and walking» (levels 1-1 Long Ping, 1-2 Yuen Long South, 1-3 Fanling, 1-4 Tai Po Market).
  // The rules and numbers are v6's (v5.8 + groups); v6's habit level (Tsing Yi) moves to the metro mode later.
  // v5 · shares trial. The three boards everyone knows from v2 / v3 (Long Ping, Yuen Long South, Fanling), with the
  // v5 rule: everyone near a stop rides, split between the stops by their pull; the puzzle is to keep the stops from
  // overflowing. The end of the line is the town centre (shops, school, jobs), not a station.
  // D is one object for the whole page; D.select(name) swaps the board in place (then call Tide.reset()).
  // D.use(def) loads any level definition the same way (tuning scripts).
  const pick=(typeof process!=='undefined'&&process.env&&process.env.FEEDER_MAP)||
    (typeof location!=='undefined'&&(/(?:^|[#&])map=(\w+)/.exec(location.hash)||[])[1])||'l1';
  function build(lines){
    const roads=new Set();
    for(const [x1,y1,x2,y2] of lines)
      for(let x=Math.min(x1,x2); x<=Math.max(x1,x2); x++)
        for(let y=Math.min(y1,y2); y<=Math.max(y1,y2); y++) roads.add(`${x},${y}`);
    return [...roads].map(s=>s.split(',').map(Number));
  }
  const STATION={'zh-Hant':'市中心','zh-Hans':'市中心',en:'TOWN CENTRE'};   // editor levels
  // where people go on each board: the well-known place by the station the board was drawn from
  const PLACE={l1:{'zh-Hant':'元朗市中心','zh-Hans':'元朗市中心',en:'YUEN LONG'},
    l2:{'zh-Hant':'元朗大馬路','zh-Hans':'元朗大马路',en:'CASTLE PEAK RD'},
    l3:{'zh-Hant':'聯和墟','zh-Hans':'联和墟',en:'LUEN WO HUI'},
    l4:{'zh-Hant':'大埔墟','zh-Hans':'大埔墟',en:'TAI PO MARKET'}};
  const hold=(phases,n=2)=>phases.flatMap(w=>Array(n).fill(w));      // each demand mix lasts n rounds
  // v6 level 5: each estate's daily trips (daily[o]) split by group (mix[o] = shares of elders, students, workers) and
  // by when each group sets out (when[g][r] = share of group g's trips in round r). Gives each round's head count per
  // estate and its group mix — so a round is a time of the morning with its own crowd.
  function slots(daily,mix,when){const R=when[0].length,waves=[],m=[];
    for(let r=0;r<R;r++){waves.push([]);m.push([]);
      daily.forEach((d,o)=>{const by=mix[o].map((x,g)=>d*x*when[g][r]),n=by.reduce((a,b)=>a+b,0)||1;
        waves[r].push(Math.round(n));m[r].push(by.map(v=>+(v/n).toFixed(3)));});}
    return{waves,mix:m};}
  // Tuned with bots/v5_tune.js (see LOG.md v5).
  const LEVELS={
    // Level 1 · Long Ping (the v2 board): four estates round the town centre; learn to share an estate between two stops.
    l1:{cols:10,rows:7,margin:[40,40],hub:[6,4],hubLabel:'right',station:PLACE.l1,
      roads:build([[1,6,8,6],[3,3,3,6],[3,4,8,4],[5,4,5,6],[6,1,6,6],[8,3,8,6],[5,2,7,2]]),
      candidates:[[2,6],[3,6],[3,5],[3,4],[4,4],[5,4],[5,6],[6,6],[7,6],[8,6],[8,4],[6,2],[6,3]],
      estates:[
        {name:'唐人新村',hans:'唐人新村',cell:[1,6],house:[0,38]},
        {name:'翹翠峰',hans:'翘翠峰',cell:[5,6],house:[0,38]},
        {name:'蝶翠峰',hans:'蝶翠峰',cell:[7,6],house:[0,38]},
        {name:'橫洲東頭圍',hans:'横洲东头围',short:'橫洲',shortHans:'横洲',cell:[6,1],house:[0,-40]}],
      // four rounds, two estates busy in each (6 → 18): 192 people; six openings keep every round's red rings open,
      // and exactly those carry everyone by bus
      waves:[[18,18,6,6],[6,6,18,18],[18,6,18,6],[6,18,6,18]],
      firstWave:20,interval:120,release:110,headway:[60,10],seats:8,queue:8,moves:0,cool:20,tiers:[185,189,192]},
    // Level 2 · Yuen Long South (v3): four estates strung along one road south of the town centre.
    l2:{cols:4,rows:9,margin:[120,48],hub:[3,0],hubLabel:'right',station:PLACE.l2,
      roads:build([[3,0,3,8],[1,1,3,1],[1,1,1,4],[1,4,3,4],[2,8,3,8]]),
      candidates:[[1,1],[2,1],[1,2],[1,3],[1,4],[2,4],[3,2],[3,3],[3,4],[3,5],[3,6],[3,7],[3,8],[2,8]],
      estates:[
        {name:'崇山新村',hans:'崇山新村',short:'崇山',shortHans:'崇山',cell:[2,8],house:[0,40]},
        {name:'朗善邨一帶',hans:'朗善邨一带',short:'朗善',shortHans:'朗善',cell:[3,6],house:[50,0]},
        {name:'蝶翠峰',hans:'蝶翠峰',cell:[2,4],house:[0,40]},
        {name:'大棠路',hans:'大棠路',cell:[1,1],house:[-50,0]}],
      // four rounds, two estates busy in each (12 → 32): 352; best opening 335, the right moves in the breaks reach 352
      waves:[[32,32,12,12],[12,12,32,32],[32,12,32,12],[12,32,12,32]],
      firstWave:20,interval:120,release:110,headway:[60,7],seats:8,queue:8,moves:1,cool:20,tiers:[321,340,350]},
    // Level 3 · Fanling (v3): five estates fanned out east of the town centre, more people than the stops can take.
    l3:{cols:7,rows:7,margin:[132,58],hub:[1,4],hubLabel:'left',station:PLACE.l3,
      roads:build([[1,4,4,4],[2,2,2,6],[2,2,6,2],[6,1,6,2],[4,2,4,6],[2,6,4,6]]),
      candidates:[[2,3],[2,2],[3,2],[4,2],[5,2],[6,2],[6,1],[4,3],[4,4],[4,5],[2,5],[2,6],[3,6],[4,6]],
      estates:[
        {name:'山麗苑',hans:'山丽苑',cell:[6,1],house:[50,0]},
        {name:'鳳凰嶺邨',hans:'凤凰岭邨',short:'鳳凰嶺',shortHans:'凤凰岭',cell:[3,2],house:[0,-40]},
        {name:'北區公園',hans:'北区公园',cell:[2,2],house:[-50,0]},
        {name:'華明邨',hans:'华明邨',short:'華明',shortHans:'华明',cell:[2,6],house:[0,40]},
        {name:'和合石',hans:'和合石',cell:[3,6],house:[0,40]}],
      // four rounds, two estates busy in each (10 → 30): 360, more than the stops can take — every layout overflows;
      // best opening 327, moves in the breaks 343, plus the extra move mid-round to rescue a swamped stop 350
      waves:[[30,30,10,10,10],[10,30,30,10,10],[10,10,10,30,30],[10,10,30,10,30]],
      firstWave:20,interval:120,release:110,headway:[60,5],seats:8,queue:8,moves:1,cool:20,tiers:[304,335,347]},
    // Level 1-4 · Tai Po Market — who travels (v6 level 5). Five estates round Tai Po Market station (placed from the site search).
    // Each estate's mix of elders / students / workers is the 2026 zone share (65+, students, working population;
    // the three northern estates share one parent zone). Elders: 35 points less a block (two blocks at most) and
    // 1.3× slower; students: must board within the bell time of leaving home (waiting counts); workers: skip stops
    // whose buses come less often than every maxHeadway seconds (with headway 60 + 8 × blocks: 3 blocks from the
    // station at most). The four rounds are four times of the morning: students go early, workers at the peak,
    // elders after it (tuned with bots/v6_tune.js: best opening 257, with moves 268 of 286).
    l4:{cols:7,rows:8,margin:[124,56],hub:[2,4],hubLabel:'left',station:PLACE.l4,
      roads:build([[2,1,2,6],[2,1,5,1],[1,6,5,6],[2,4,5,4],[5,4,5,6]]),
      candidates:[[2,1],[2,2],[2,3],[2,5],[2,6],[3,1],[4,1],[5,1],[1,6],[3,6],[4,6],[5,6],[3,4],[4,4],[5,4],[5,5]],
      estates:[
        {name:'大元邨',hans:'大元邨',cell:[2,1],house:[-50,0]},
        {name:'新興花園',hans:'新兴花园',short:'新興',shortHans:'新兴',cell:[3,1],house:[0,-40]},
        {name:'怡雅苑',hans:'怡雅苑',cell:[5,1],house:[50,0]},
        {name:'荔枝山',hans:'荔枝山',cell:[1,6],house:[-50,0]},
        {name:'南苑',hans:'南苑',cell:[5,6],house:[50,0]}],
      groups:{order:['old','stu','work'],old:{drop:.35,walk:1.3},stu:{bell:90},work:{maxHeadway:85}},
      ...slots([80,60,64,44,40],[[.34,.13,.53],[.34,.13,.53],[.34,.13,.53],[.18,.18,.64],[.15,.22,.63]],
        [[0,.1,.4,.5],[.75,.25,0,0],[.3,.45,.2,.05]]),
      clock:['07:00','08:00','09:00','10:00'],
      firstWave:20,interval:120,release:110,headway:[60,8],seats:8,queue:8,moves:1,cool:20,tiers:[230,252,264]}
  };
  // A level from the level editor (editor.html): given in the address by "Test play" (#lv=…), or the last one saved
  // in this browser (#map=custom). Same fields as a level above; water is a list of cells, a road across water is a bridge.
  function fromEditor(def){
    const roads=def.roads||build(def.lines||[]),k=c=>c.join(','),road=new Set(roads.map(k)),cells=def.waterCells||[];
    const water=[],left=new Set(cells.map(k));
    for(const [x,y] of [...cells].sort((a,b)=>a[1]-b[1]||a[0]-b[0])){if(!left.has(k([x,y])))continue;
      let e=x;while(left.has(k([e+1,y])))e++;for(let i=x;i<=e;i++)left.delete(k([i,y]));water.push([x,y,e,y]);}
    const total=(def.waves||[]).flat().reduce((a,b)=>a+b,0),guess=!(def.tiers||[]).some(x=>x>0);
    const tiers=guess?[.6,.75,.9].map(f=>Math.ceil(f*total)):def.tiers;
    return {station:STATION,margin:[60,50],hubLabel:'right',firstWave:20,...def,tiers,tiersGuess:guess,roads,water,bridges:cells.filter(c=>road.has(k(c)))};
  }
  function customDef(){
    const h=typeof location!=='undefined'?location.hash:'';
    try{const m=/(?:^|[#&])lv=([^&]+)/.exec(h);if(m)return JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1])))));}catch(e){}
    try{if(/(?:^|[#&])map=custom/.test(h)){const s=localStorage.getItem('tl-v7m1-level');if(s)return JSON.parse(s);}}catch(e){}
    return null;
  }
  const custom=customDef();if(custom)LEVELS.custom=fromEditor(custom);
  function make(key,L){
    const waves=L.waves.map(w=>w.slice());
    const origins=L.estates.map((e,i)=>({...e,count:waves.reduce((s,w)=>s+w[i],0),base:Math.min(...waves.map(w=>w[i]))}));
    const out={map:key,origins,waves,peaks:[],levels:Object.keys(LEVELS)};
    for(const k of ['title','tiersGuess','days','habit','groups','mix','clock','cols','rows','margin','hub','hubLabel','station','roads','water','bridges','candidates','headway','tiers','firstWave','interval',
      'release','seats','queue','cool','moves','willing','patience','tail'])if(L[k]!==undefined)out[k]=L[k];
    return out;
  }
  const first=custom&&(/(?:^|[#&])lv=/.test(typeof location!=='undefined'?location.hash:'')||pick==='custom')?'custom':LEVELS[pick]?pick:'l1';
  const D=make(first,LEVELS[first]);
  const swap=next=>{for(const k of Object.keys(D))delete D[k];Object.assign(D,next);return true;};
  Object.defineProperty(D,'select',{enumerable:false,value(name){return LEVELS[name]?swap(make(name,LEVELS[name])):false;}});
  Object.defineProperty(D,'use',{enumerable:false,value(def,key='custom'){return swap(make(key,{...def,roads:def.lines?build(def.lines):def.roads}));}});
  Object.defineProperty(D,'build',{enumerable:false,value:build});
  // the editor: load its level in place, and read the built-in levels as starting points
  Object.defineProperty(D,'loadEditor',{enumerable:false,value(def){return swap(make('custom',fromEditor(def)));}});
  Object.defineProperty(D,'example',{enumerable:false,value(name){return LEVELS[name]?JSON.parse(JSON.stringify(LEVELS[name])):null;}});
  if(typeof module!=='undefined') module.exports=D;
  root.TIDE_DATA=D;
})(typeof window!=='undefined'?window:globalThis);
