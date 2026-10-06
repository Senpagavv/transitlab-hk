(function(root) {
  const roads = new Set();
  function line(x1,y1,x2,y2) {
    for(let x=Math.min(x1,x2); x<=Math.max(x1,x2); x++)
      for(let y=Math.min(y1,y2); y<=Math.max(y1,y2); y++) roads.add(`${x},${y}`);
  }
  line(1,6,8,6); line(3,3,3,6); line(3,4,8,4); line(5,4,5,6);
  line(6,1,6,6); line(8,3,8,6); line(5,2,7,2);
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
    {name:'唐人新村',cell:[1,6],zone:'519',source:[818830.48,833186.74]},
    {name:'翹翠峰',cell:[5,6],zone:'527.4',source:[820324.07,833217.23]},
    {name:'蝶翠峰',cell:[7,6],zone:'529',source:[821106.98,833104.55]},
    {name:'橫洲東頭圍',cell:[6,1],zone:'528',source:[820945.62,835625.03]}
  ];
  origins.forEach((o,i)=>{o.count=waves.reduce((s,w)=>s+w[i],0);o.base=base[i];});
  const D = {
    cols:10, rows:9, roads:[...roads].map(s=>s.split(',').map(Number)), hub:[6,4],
    candidates:[[2,6],[3,6],[3,5],[3,4],[4,4],[5,4],[5,6],[6,6],[7,6],[8,6],[8,4],[6,2],[6,3]],
    origins, base, peaks, waves,
    source:{geography:'香港朗屏與四個住宅區的相對方位取自 TransitLab 本地資料。道路重畫為棋盤示意，不是實測道路或獲准設站位置。',
      demand:'四區平時人數按分區私家車模型量的大小排序後取整（唐人新村最多）；每區一次高峰與所有時間均為遊戲假設，不代表真實客流或減碳量。',date:'2026-10-06'}
  };
  if(typeof module!=='undefined') module.exports=D;
  root.TIDE_DATA=D;
})(typeof window!=='undefined'?window:globalThis);
