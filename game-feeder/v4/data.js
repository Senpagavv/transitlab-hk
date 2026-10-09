(function(root) {
  // v4 · rounds prototype. Two practice boards to feel the round rules (steady departures through each round,
  // a cool-down after moving a stop, willingness falling 10 points a block). The boards are game layouts, not
  // real places: early boards are close to the simple picture "a few estates, one station, distances in blocks";
  // later boards add roads that hide it.
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
  const STATION={'zh-Hant':'港鐵站','zh-Hans':'港铁站',en:'MTR STATION'};
  const hold=(phases,n=2)=>phases.flatMap(w=>Array(n).fill(w));      // each demand mix lasts n rounds
  // Tuned with bots/v4_tune.js and bots/v4_calibrate.js (see LOG.md v4): only the best few openings pass
  // without moving; high score needs moves in the countdowns; master needs nearly the best plan.
  const LEVELS={
    // Level 1 · loop corners: four estates on the corners of one loop road, the station far down one trunk road.
    // The two lower estates are nearer the station (faster buses), the two upper ones farther.
    l1:{cols:8,rows:9,margin:[110,50],hub:[4,8],hubLabel:'right',station:STATION,
      roads:build([[1,1,6,1],[1,4,6,4],[1,1,1,4],[6,1,6,4],[4,4,4,8]]),
      candidates:[[1,1],[4,1],[6,1],[1,2],[1,3],[6,2],[6,3],[1,4],[4,4],[6,4],[4,6]],
      estates:[
        {name:'北苑',hans:'北苑',cell:[1,1],house:[-50,0]},
        {name:'東邨',hans:'东邨',cell:[6,1],house:[50,0]},
        {name:'西邨',hans:'西邨',cell:[1,4],house:[-50,0]},
        {name:'南苑',hans:'南苑',cell:[6,4],house:[50,0]}],
      // the busy pair goes round the loop: top, right, bottom, left
      waves:hold([[9,6,2,1],[2,9,1,6],[1,2,6,9],[6,1,9,2]]),
      firstWave:20,interval:120,release:110,headway:[60,8],seats:8,moves:4,cool:20,tiers:[113,121,127]},
    // Level 2 · across the river: three estates north of a river with two bridges, one south of it, the station
    // south. Middle Bank looks right above the station but has to go round by a bridge.
    l2:{cols:10,rows:9,margin:[90,50],hub:[6,8],hubLabel:'right',station:STATION,
      roads:build([[1,1,8,1],[8,1,8,2],[2,1,2,6],[7,1,7,6],[2,6,7,6],[6,6,6,8]]),
      water:[[0,4,9,4]],bridges:[[2,4],[7,4]],
      candidates:[[1,1],[2,1],[4,1],[5,1],[7,1],[8,1],[2,3],[7,3],[2,6],[3,6],[6,6],[7,6]],
      estates:[
        {name:'西岸',hans:'西岸',cell:[1,1],house:[0,-60]},
        {name:'中岸',hans:'中岸',cell:[5,1],house:[0,-60]},
        {name:'東岸',hans:'东岸',cell:[8,2],house:[50,0]},
        {name:'南灣',hans:'南湾',cell:[3,6],house:[0,58]}],
      // two estates busy at once, more people than level 1
      waves:hold([[11,7,2,2],[2,7,11,2],[2,2,7,11],[11,2,2,7]]),
      firstWave:20,interval:120,release:110,headway:[60,8],seats:8,moves:4,cool:20,tiers:[125,133,139]}
  };
  function make(key,L){
    const waves=L.waves.map(w=>w.slice());
    const origins=L.estates.map((e,i)=>({...e,count:waves.reduce((s,w)=>s+w[i],0),base:Math.min(...waves.map(w=>w[i]))}));
    const out={map:key,origins,waves,peaks:[],levels:Object.keys(LEVELS)};
    for(const k of ['cols','rows','margin','hub','hubLabel','station','roads','water','bridges','candidates','headway','tiers','firstWave','interval',
      'release','seats','queue','cool','moves','willing','tail'])if(L[k]!==undefined)out[k]=L[k];
    return out;
  }
  const D=make(LEVELS[pick]?pick:'l1',LEVELS[LEVELS[pick]?pick:'l1']);
  const swap=next=>{for(const k of Object.keys(D))delete D[k];Object.assign(D,next);return true;};
  Object.defineProperty(D,'select',{enumerable:false,value(name){return LEVELS[name]?swap(make(name,LEVELS[name])):false;}});
  Object.defineProperty(D,'use',{enumerable:false,value(def,key='custom'){return swap(make(key,{...def,roads:def.lines?build(def.lines):def.roads}));}});
  Object.defineProperty(D,'build',{enumerable:false,value:build});
  if(typeof module!=='undefined') module.exports=D;
  root.TIDE_DATA=D;
})(typeof window!=='undefined'?window:globalThis);
