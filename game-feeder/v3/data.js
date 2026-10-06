(function(root) {
  // v3 · site boards. Each board is a real station and the estates around it that our model says have the
  // most morning car commuters 0.6–3 km away (zones whose nearest station it is), laid out on a grid of
  // about 350 m a block from their real walking distances (OpenStreetMap paths) and directions.
  // Same rules on every board. Choose with #map=fanling|yuenlong|longping, or FEEDER_MAP for node.
  const pick=(typeof process!=='undefined'&&process.env&&process.env.FEEDER_MAP)||
    (typeof location!=='undefined'&&(/(?:^|[#&])map=(\w+)/.exec(location.hash)||[])[1])||'fanling';
  function build(lines){
    const roads=new Set();
    for(const [x1,y1,x2,y2] of lines)
      for(let x=Math.min(x1,x2); x<=Math.max(x1,x2); x++)
        for(let y=Math.min(y1,y2); y<=Math.max(y1,y2); y++) roads.add(`${x},${y}`);
    return [...roads].map(s=>s.split(',').map(Number));
  }
  const MAPS={
    // Fanling (East Rail): the station sits at the west edge and the estates fan out on its east side —
    // a north pair, a south pair, and Shan Lai Court far to the north-east with by far the most drivers.
    // East of the station, Fung Wong Ling and Wo Hop Shek can share a stop (real walks 1.28 / 0.90 km).
    fanling:{label:'粉嶺',cols:7,rows:7,margin:[132,58],hub:[1,4],hubLabel:'left',headway:[60,5],tiers:[174,180,185],
      station:{zh:'粉嶺港鐵',en:'FANLING',lon:114.138654,lat:22.492131},
      roads:build([[1,4,4,4],[2,2,2,6],[2,2,6,2],[6,1,6,2],[4,2,4,6],[2,6,4,6]]),
      candidates:[[2,3],[2,2],[3,2],[4,2],[5,2],[6,2],[6,1],[4,3],[4,4],[4,5],[2,5],[2,6],[3,6],[4,6]],
      estates:[
        {name:'山麗苑',short:'山麗苑',zone:'634',cell:[6,1],house:[50,0],car:2006,walk:3073},
        {name:'鳳凰嶺邨',short:'鳳凰嶺',zone:'625.2',cell:[3,2],house:[0,-40],car:372,walk:1337},
        {name:'北區公園',short:'北區公園',zone:'625.3',cell:[2,2],house:[-50,0],car:311,walk:1073},
        {name:'華明邨',short:'華明',zone:'628.4',cell:[2,6],house:[0,40],car:267,walk:1083},
        {name:'和合石',short:'和合石',zone:'628.5',cell:[3,6],house:[0,40],car:203,walk:908}],
      base:[6,3,3,3,3],peaks:[{origin:2,wave:1},{origin:4,wave:3},{origin:0,wave:5},{origin:3,wave:6},{origin:1,wave:7}],
      geography:'粉嶺站、五個分區的名字與早高峰開車人數取自 TransitLab 本地模型；分區位置按真實步行距離（OpenStreetMap 行人路網）與方位畫成約 350 米一格的棋盤，略作遊戲化：山麗苑真實步行約 3.1 公里，棋盤縮為 8 格。車站在西、各區在東側一個扇形裡；鳳凰嶺邨與和合石之間真的有比去車站還近的共用位置。道路為示意，不是實測道路或獲准設站位置。'},
    // Yuen Long (Tuen Ma): four estates in one corridor south of the station (Tai Tong Road / Shap Pat Heung).
    yuenlong:{label:'元朗南',cols:4,rows:9,margin:[120,48],hub:[3,0],hubLabel:'right',headway:[60,7],tiers:[138,143,148],
      station:{zh:'元朗港鐵',en:'YUEN LONG',lon:114.035311,lat:22.446253},
      roads:build([[3,0,3,8],[1,1,3,1],[1,1,1,4],[1,4,3,4],[2,8,3,8]]),
      candidates:[[1,1],[2,1],[1,2],[1,3],[1,4],[2,4],[3,2],[3,3],[3,4],[3,5],[3,6],[3,7],[3,8],[2,8]],
      estates:[
        {name:'崇山新村',short:'崇山',zone:'522',cell:[2,8],house:[0,40],car:1017,walk:3003},
        {name:'朗善邨一帶',short:'朗善',zone:'523',cell:[3,6],house:[50,0],car:418,walk:2004},
        {name:'蝶翠峰',short:'蝶翠峰',zone:'529',cell:[2,4],house:[0,40],car:388,walk:1563},
        {name:'大棠路',short:'大棠路',zone:'524.3',cell:[1,1],house:[-50,0],car:383,walk:833}],
      base:[6,3,3,3],peaks:[{origin:3,wave:1},{origin:2,wave:3},{origin:0,wave:5},{origin:1,wave:6}],
      geography:'元朗站與四個分區的名字、早高峰開車人數取自 TransitLab 本地模型；按真實步行距離（大棠路 0.8、蝶翠峰 1.6、朗善邨一帶 2.0、崇山新村 3.0 公里）與方位畫成約 350 米一格的棋盤，略作遊戲化。四區都在車站南面一條走廊上，相鄰兩區可以共用接駁站。道路為示意。'},
    // The original v2.5 board, for comparison.
    longping:{label:'朗屏（原版）',cols:10,rows:7,margin:[20,30],hub:[6,4],hubLabel:'right',headway:[60,10],tiers:[133,140,146],
      station:{zh:'朗屏港鐵',en:'LONG PING',lon:114.025421,lat:22.447773},
      roads:build([[1,6,8,6],[3,3,3,6],[3,4,8,4],[5,4,5,6],[6,1,6,6],[8,3,8,6],[5,2,7,2]]),
      candidates:[[2,6],[3,6],[3,5],[3,4],[4,4],[5,4],[5,6],[6,6],[7,6],[8,6],[8,4],[6,2],[6,3]],
      estates:[
        {name:'唐人新村',short:'唐人新村',zone:'519',cell:[1,6],house:[0,38]},
        {name:'翹翠峰',short:'翹翠峰',zone:'527.4',cell:[5,6],house:[0,38]},
        {name:'蝶翠峰',short:'蝶翠峰',zone:'529',cell:[7,6],house:[0,38]},
        {name:'橫洲東頭圍',short:'橫洲',zone:'528',cell:[6,1],house:[0,-40]}],
      base:[6,3,3,3],peaks:[{origin:3,wave:1},{origin:1,wave:3},{origin:0,wave:5},{origin:2,wave:6}],
      geography:'v2.5 的原版棋盤：朗屏站與四個分區的相對方位取自 TransitLab 本地資料，道路重畫為棋盤示意。（後來核對發現唐人新村、蝶翠峰最近的港鐵站其實是天水圍和元朗。）'}
  };
  const name=MAPS[pick]?pick:'fanling',M=MAPS[name];
  // demand: every estate sends the same number of people every batch, plus one announced peak (+18)
  const PEAK=18;
  const peaks=M.peaks.map(p=>({...p,extra:PEAK})),base=M.base.slice();
  const waves=Array.from({length:8},(_,w)=>base.map((b,o)=>b+peaks.filter(p=>p.origin===o&&p.wave===w).reduce((s,p)=>s+p.extra,0)));
  const origins=M.estates.map((e,i)=>({...e,count:waves.reduce((s,w)=>s+w[i],0),base:base[i]}));
  const D = {
    map:name, maps:Object.fromEntries(Object.entries(MAPS).map(([k,v])=>[k,v.label])),
    cols:M.cols, rows:M.rows, margin:M.margin, roads:M.roads, hub:M.hub, hubLabel:M.hubLabel, station:M.station,
    candidates:M.candidates, headway:M.headway, tiers:M.tiers, origins, base, peaks, waves,
    source:{geography:M.geography,
      demand:'各區平時人數：開車最多的一區每批 6 人，其他每批 3 人；每區一次高峰（多 18 人）。人數與時間均為遊戲假設，不代表真實客流或減碳量。',date:'2026-10-07'}
  };
  if(typeof module!=='undefined') module.exports=D;
  root.TIDE_DATA=D;
})(typeof window!=='undefined'?window:globalThis);
