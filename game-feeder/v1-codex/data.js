(function(root) {
  const roads = new Set();
  function line(x1,y1,x2,y2) {
    for(let x=Math.min(x1,x2); x<=Math.max(x1,x2); x++)
      for(let y=Math.min(y1,y2); y<=Math.max(y1,y2); y++) roads.add(`${x},${y}`);
  }
  line(1,6,8,6); line(3,3,3,6); line(3,4,8,4); line(5,4,5,6);
  line(6,1,6,6); line(8,3,8,6); line(5,2,7,2);
  const D = {
    cols:10, rows:9, roads:[...roads].map(s=>s.split(',').map(Number)), hub:[6,4],
    candidates:[[2,6],[3,6],[3,5],[3,4],[4,4],[5,4],[5,6],[6,6],[7,6],[8,6],[8,4],[6,2],[6,3]],
    origins:[
      {name:'唐人新村',cell:[1,6],zone:'519',count:100,source:[818830.48,833186.74]},
      {name:'翹翠峰',cell:[5,6],zone:'527.4',count:44,source:[820324.07,833217.23]},
      {name:'蝶翠峰',cell:[7,6],zone:'529',count:64,source:[821106.98,833104.55]},
      {name:'橫洲東頭圍',cell:[6,1],zone:'528',count:32,source:[820945.62,835625.03]}
    ],
    waves:[[20,4,6,0],[7,6,17,0],[4,4,6,16],[20,6,4,0],[6,14,8,2],[18,3,7,2],[5,3,13,9],[20,4,3,3]],
    source:{geography:'香港朗屏與四個住宅區的相對方位取自 TransitLab 本地資料。道路重畫為棋盤示意，不是實測道路或獲准設站位置。',
      demand:'原短局的25、11、16、8組需求依分區私家車模型量縮放。本觀察版再放大四倍為240人，批次與時間全是遊戲假設，不代表真實客流或減碳量。',date:'2026-10-06'}
  };
  if(typeof module!=='undefined') module.exports=D;
  root.TIDE_DATA=D;
})(typeof window!=='undefined'?window:globalThis);
