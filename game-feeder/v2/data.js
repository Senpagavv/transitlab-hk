(function(root) {
  // Two boards share the same estates, demand and rules.
  //   fan  (default, v2.6): the estates sit on an arc around Long Ping, so neighbours can share a stop.
  //   grid (v2.0–v2.5):     the original board — Long Ping between the north estate and the south ones.
  // Choose with #map=grid in the browser, or FEEDER_MAP=grid for node.
  const pick=(typeof process!=='undefined'&&process.env&&process.env.FEEDER_MAP)||
    (typeof location!=='undefined'&&(/(?:^|[#&])map=(\w+)/.exec(location.hash)||[])[1])||'fan';
  function build(lines){
    const roads=new Set();
    for(const [x1,y1,x2,y2] of lines)
      for(let x=Math.min(x1,x2); x<=Math.max(x1,x2); x++)
        for(let y=Math.min(y1,y2); y<=Math.max(y1,y2); y++) roads.add(`${x},${y}`);
    return [...roads].map(s=>s.split(',').map(Number));
  }
  const MAPS={
    // headway = [base, per block] seconds; tiers = [pass, high, master]. Each board is tuned on its own.
    grid:{cols:10,rows:7,margin:[20,30],hub:[6,4],headway:[60,10],tiers:[133,140,146],
      roads:build([[1,6,8,6],[3,3,3,6],[3,4,8,4],[5,4,5,6],[6,1,6,6],[8,3,8,6],[5,2,7,2]]),
      candidates:[[2,6],[3,6],[3,5],[3,4],[4,4],[5,4],[5,6],[6,6],[7,6],[8,6],[8,4],[6,2],[6,3]],
      cells:[[1,6],[5,6],[7,6],[6,1]], house:[[0,38],[0,38],[0,38],[0,-40]],
      geography:'香港朗屏與四個住宅區的相對方位取自 TransitLab 本地資料。道路重畫為棋盤示意，不是實測道路或獲准設站位置。'},
    // Long Ping at the top; the estates on an arc below it, joined by a ring road with three spokes.
    // Every estate is 6–7 blocks from the MTR, and each pair of neighbours has stops that are nearer to both.
    fan:{cols:11,rows:8,margin:[78,42],hub:[5,2],headway:[60,5],tiers:[139,147,152],
      roads:build([[1,2,10,2],[1,2,1,4],[0,4,1,4],[1,5,1,5],[1,5,2,5],[2,5,2,6],[2,6,7,6],[5,2,5,6],
        [8,6,8,6],[8,5,8,6],[8,5,9,5],[9,4,9,5],[9,4,10,4],[10,2,10,4]]),
      candidates:[[0,4],[1,4],[1,5],[2,5],[3,6],[4,6],[5,6],[6,6],[7,6],[8,5],[9,5],[9,4],[10,3],[10,2],[8,2],[5,4],[3,2]],
      cells:[[0,4],[3,6],[7,6],[10,3]], house:[[-50,0],[0,40],[0,40],[50,0]],
      geography:'朗屏站與四個住宅區的名字與遠近次序取自 TransitLab 本地資料。為了玩法，棋盤把四區排成圍著港鐵站的一道弧，方位與距離都經遊戲化處理：真實的橫洲東頭圍在朗屏站北面，其餘三區在南面，港鐵站正好夾在中間，南北之間其實沒有共用的接駁站位。道路為示意，不是實測道路或獲准設站位置。'},
    // Compact arc: same distances to the MTR as the old board (3 / 3 / 4 / 7 blocks, the real order),
    // but the estates run in one arc from west to south-east, so every pair of neighbours can share a stop.
    arc:{cols:8,rows:5,margin:[84,44],hub:[5,1],headway:[60,10],tiers:[138,144,147],
      roads:build([[1,1,7,1],[1,1,1,3],[0,3,3,3],[3,1,3,4],[3,4,7,4],[5,1,5,4],[7,1,7,4]]),
      candidates:[[0,3],[1,3],[2,3],[3,3],[3,2],[3,4],[4,4],[5,4],[6,4],[7,4],[7,3],[7,2],[5,2],[1,1],[4,1],[6,1]],
      cells:[[0,3],[3,2],[5,4],[7,3]], house:[[-50,0],[-46,0],[0,40],[50,0]],
      geography:'朗屏站與四個住宅區的名字、遠近次序（翹翠峰、蝶翠峰較近，橫洲東頭圍稍遠，唐人新村最遠）取自 TransitLab 本地資料。為了玩法，棋盤把四區排成圍著港鐵站的一道弧，方位經遊戲化處理：真實的橫洲東頭圍在朗屏站北面，其餘三區在南面，港鐵站正好夾在中間，南北之間其實沒有共用的接駁站位。道路為示意，不是實測道路或獲准設站位置。'}
  };
  const M=MAPS[pick]||MAPS.fan;
  // v2 demand: every estate sends the same number of people in every batch,
  // and each estate has exactly one announced peak batch ("rising tide").
  const base=[6,3,3,3], peaks=[
    {origin:3, wave:1, extra:18},   // 橫洲東頭圍
    {origin:1, wave:3, extra:18},   // 翹翠峰
    {origin:0, wave:5, extra:18},   // 唐人新村
    {origin:2, wave:6, extra:18}    // 蝶翠峰
  ];
  const waves=Array.from({length:8},(_,w)=>base.map((b,o)=>b+peaks.filter(p=>p.origin===o&&p.wave===w).reduce((s,p)=>s+p.extra,0)));
  const origins=[
    {name:'唐人新村',zone:'519',source:[818830.48,833186.74]},
    {name:'翹翠峰',zone:'527.4',source:[820324.07,833217.23]},
    {name:'蝶翠峰',zone:'529',source:[821106.98,833104.55]},
    {name:'橫洲東頭圍',zone:'528',source:[820945.62,835625.03]}
  ];
  origins.forEach((o,i)=>{o.cell=M.cells[i];o.house=M.house[i];o.count=waves.reduce((s,w)=>s+w[i],0);o.base=base[i];});
  const D = {
    map:MAPS[pick]?pick:'fan', cols:M.cols, rows:M.rows, margin:M.margin, roads:M.roads, hub:M.hub, candidates:M.candidates,
    headway:M.headway, tiers:M.tiers,
    origins, base, peaks, waves,
    source:{geography:M.geography,
      demand:'四區平時人數按分區私家車模型量的大小排序後取整（唐人新村最多）；每區一次高峰與所有時間均為遊戲假設，不代表真實客流或減碳量。',date:'2026-10-07'}
  };
  if(typeof module!=='undefined') module.exports=D;
  root.TIDE_DATA=D;
})(typeof window!=='undefined'?window:globalThis);
