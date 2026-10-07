(function(root) {
  // v3 · site boards and the hub map.
  // Each level is a real station and the estates around it that our model says have the most morning car
  // commuters 0.6–3 km away (zones whose nearest station it is), laid out on a grid of about 350 m a block
  // from their real walking distances (OpenStreetMap paths) and directions. Same rules on every board.
  // D is one object for the whole page; D.select(name) swaps the board in place (then call Tide.reset()).
  // First board: #map=… in the browser, FEEDER_MAP for node, else Fanling.
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
    // Fanling (East Rail): the station at the west edge, the estates fanned out on its east side — a north pair,
    // a south pair and Shan Lai Court far to the north-east with by far the most drivers. Fung Wong Ling and
    // Wo Hop Shek really can share a stop east of the station (real walks 1.28 / 0.90 km).
    fanling:{cols:7,rows:7,margin:[132,58],hub:[1,4],hubLabel:'left',headway:[60,5],tiers:[174,180,185],
      station:{'zh-Hant':'粉嶺港鐵','zh-Hans':'粉岭港铁',en:'FANLING',lon:114.138649,lat:22.492132},
      roads:build([[1,4,4,4],[2,2,2,6],[2,2,6,2],[6,1,6,2],[4,2,4,6],[2,6,4,6]]),
      candidates:[[2,3],[2,2],[3,2],[4,2],[5,2],[6,2],[6,1],[4,3],[4,4],[4,5],[2,5],[2,6],[3,6],[4,6]],
      estates:[
        {name:'山麗苑',hans:'山丽苑',zone:'634',cell:[6,1],house:[50,0],car:2006,walk:3073},
        {name:'鳳凰嶺邨',hans:'凤凰岭邨',short:'鳳凰嶺',shortHans:'凤凰岭',zone:'625.2',cell:[3,2],house:[0,-40],car:372,walk:1337},
        {name:'北區公園',hans:'北区公园',zone:'625.3',cell:[2,2],house:[-50,0],car:311,walk:1073},
        {name:'華明邨',hans:'华明邨',short:'華明',shortHans:'华明',zone:'628.4',cell:[2,6],house:[0,40],car:267,walk:1083},
        {name:'和合石',hans:'和合石',zone:'628.5',cell:[3,6],house:[0,40],car:203,walk:908}],
      base:[6,3,3,3,3],peaks:[{origin:2,wave:1},{origin:4,wave:3},{origin:0,wave:5},{origin:3,wave:6},{origin:1,wave:7}]},
    // Yuen Long (Tuen Ma): four estates in one corridor south of the station (Tai Tong Road / Shap Pat Heung).
    yuenlong:{cols:4,rows:9,margin:[120,48],hub:[3,0],hubLabel:'right',headway:[60,7],tiers:[138,143,148],
      station:{'zh-Hant':'元朗港鐵','zh-Hans':'元朗港铁',en:'YUEN LONG',lon:114.03437,lat:22.445719},
      roads:build([[3,0,3,8],[1,1,3,1],[1,1,1,4],[1,4,3,4],[2,8,3,8]]),
      candidates:[[1,1],[2,1],[1,2],[1,3],[1,4],[2,4],[3,2],[3,3],[3,4],[3,5],[3,6],[3,7],[3,8],[2,8]],
      estates:[
        {name:'崇山新村',hans:'崇山新村',short:'崇山',shortHans:'崇山',zone:'522',cell:[2,8],house:[0,40],car:1017,walk:3003},
        {name:'朗善邨一帶',hans:'朗善邨一带',short:'朗善',shortHans:'朗善',zone:'523',cell:[3,6],house:[50,0],car:418,walk:2004},
        {name:'蝶翠峰',hans:'蝶翠峰',zone:'529',cell:[2,4],house:[0,40],car:388,walk:1563},
        {name:'大棠路',hans:'大棠路',zone:'524.3',cell:[1,1],house:[-50,0],car:383,walk:833}],
      base:[6,3,3,3],peaks:[{origin:3,wave:1},{origin:2,wave:3},{origin:0,wave:5},{origin:1,wave:6}]},
    // The original v2.5 board, for comparison.
    longping:{cols:10,rows:7,margin:[20,30],hub:[6,4],hubLabel:'right',headway:[60,10],tiers:[133,140,146],
      station:{'zh-Hant':'朗屏港鐵','zh-Hans':'朗屏港铁',en:'LONG PING',lon:114.025421,lat:22.447773},
      roads:build([[1,6,8,6],[3,3,3,6],[3,4,8,4],[5,4,5,6],[6,1,6,6],[8,3,8,6],[5,2,7,2]]),
      candidates:[[2,6],[3,6],[3,5],[3,4],[4,4],[5,4],[5,6],[6,6],[7,6],[8,6],[8,4],[6,2],[6,3]],
      estates:[
        {name:'唐人新村',hans:'唐人新村',zone:'519',cell:[1,6],house:[0,38]},
        {name:'翹翠峰',hans:'翘翠峰',zone:'527.4',cell:[5,6],house:[0,38]},
        {name:'蝶翠峰',hans:'蝶翠峰',zone:'529',cell:[7,6],house:[0,38]},
        {name:'橫洲東頭圍',hans:'横洲东头围',short:'橫洲',shortHans:'横洲',zone:'528',cell:[6,1],house:[0,-40]}],
      base:[6,3,3,3],peaks:[{origin:3,wave:1},{origin:1,wave:3},{origin:0,wave:5},{origin:2,wave:6}]}
  };
  // Places on the hub map. "play" opens a level; "soon" are candidates from the territory-wide site search
  // (tools/site-search). side = where the name sits next to the pin, so neighbours do not collide.
  const SITES=[
    {key:'fanling',status:'play',map:'fanling',lon:114.138649,lat:22.492132,side:'right'},
    {key:'yuenlong',status:'play',map:'yuenlong',lon:114.03437,lat:22.445719,side:'bottom'},
    {key:'longping',status:'play',map:'longping',lon:114.025421,lat:22.447773,side:'topright',minor:true},
    {key:'wahfu',status:'soon',lon:114.167572,lat:22.248241,side:'bottom'},
    {key:'tsingyi',status:'soon',lon:114.107025,lat:22.358324,side:'left'},
    {key:'chaiwan',status:'soon',lon:114.237122,lat:22.264599,side:'right'},
    {key:'kwaihing',status:'soon',lon:114.131355,lat:22.363169,side:'right'},
    {key:'taiwo',status:'soon',lon:114.161072,lat:22.451057,side:'right'},
    {key:'tinshuiwai',status:'soon',lon:114.005959,lat:22.449448,side:'left'},
    {key:'tuenmun',status:'soon',lon:113.973312,lat:22.393721,side:'left'},
    {key:'sheungshui',status:'soon',lon:114.127861,lat:22.501383,side:'top'}
  ].map(s=>s.map?{...s,estates:MAPS[s.map].estates.length,tiers:MAPS[s.map].tiers,station:MAPS[s.map].station}:s);
  const PEAK=18;
  function make(name){
    const M=MAPS[name];
    const peaks=M.peaks.map(p=>({...p,extra:PEAK})),base=M.base.slice();
    const waves=Array.from({length:8},(_,w)=>base.map((b,o)=>b+peaks.filter(p=>p.origin===o&&p.wave===w).reduce((s,p)=>s+p.extra,0)));
    const origins=M.estates.map((e,i)=>({...e,count:waves.reduce((s,w)=>s+w[i],0),base:base[i]}));
    return {map:name,cols:M.cols,rows:M.rows,margin:M.margin,roads:M.roads,hub:M.hub,hubLabel:M.hubLabel,station:M.station,
      candidates:M.candidates,headway:M.headway,tiers:M.tiers,origins,base,peaks,waves,levels:Object.keys(MAPS),sites:SITES};
  }
  const D=make(MAPS[pick]?pick:'fanling');
  Object.defineProperty(D,'select',{enumerable:false,value(name){
    if(!MAPS[name])return false;const next=make(name);
    for(const k of Object.keys(D))delete D[k];Object.assign(D,next);return true;}});
  if(typeof module!=='undefined') module.exports=D;
  root.TIDE_DATA=D;
})(typeof window!=='undefined'?window:globalThis);
