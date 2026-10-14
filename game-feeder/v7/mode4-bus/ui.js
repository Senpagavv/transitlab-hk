(()=>{
  'use strict';
  // v7 · mode 4 «buses on the road» — the page. Mode 3's living map of Kowloon East with the 東九龍綫 running; the player
  // draws up to three bus routes along the roads, puts stops and buses on them and gives roads bus lanes, within a
  // budget a year — and may change all of it every year. Hover a stop, a road (lane tool) or ＋/− and the map turns into
  // what the change brings once drivers settle; hold the eye button to see the plan settled, or (once open) no buses.
  const {Plan,D,P,G,year,walk,same,key,sectionBetween,laned}=Bus,$=id=>document.getElementById(id),I=window.I18N,t=(k,v)=>I.t(k,v);
  const CS=56,MX=56,MY=96,STEP_MS=2600,DAY_S=7,PER_DOT=1,MAX_DOTS=640;
  const RC=['#2F6FD6','#E07B00','#C2185B'],RL=['A','B','C'];
  const xy=c=>[MX+c[0]*CS,MY+c[1]*CS];
  const svg=(tag,a,c='')=>`<${tag} ${Object.entries(a).map(([k,v])=>`${k}="${v}"`).join(' ')}>${c}</${tag}>`;
  let C={};
  function readTokens(){const s=getComputedStyle(document.documentElement),v=n=>s.getPropertyValue('--s-'+n).trim();
    C={paper:v('paper'),panel:v('panel'),soft:v('soft'),raise:v('raise'),ink:v('ink'),ink2:v('ink2'),ink3:v('ink3'),line:v('line'),line2:v('line2'),accent:v('accent'),accent2:v('accent2'),
      warn:v('warn'),bad:v('bad'),info:v('info'),metro:v('metro'),jam:v('jam'),free:v('free'),walk:v('walk')};}
  readTokens();
  const text=(x,y,s,size=14,fill=C.ink,extra={})=>svg('text',{x,y,'font-size':size,fill,stroke:C.paper,'stroke-width':4,'paint-order':'stroke',...extra},s);
  const textW=(s,size)=>[...String(s)].reduce((w,ch)=>w+(ch.charCodeAt(0)>0x2e7f?size:ch===' '?size*.32:size*.6),0);
  const pill=(x,y,s,color,size=13)=>{const w=textW(s,size)+18,x0=x-w/2;
    return svg('rect',{x:x0.toFixed(1),y:(y-size+1).toFixed(1),width:w.toFixed(1),height:size+9,rx:(size+9)/2,fill:C.panel,stroke:color,'stroke-width':1.3,'fill-opacity':.97})+
      svg('text',{x:(x0+w/2).toFixed(1),y:(y+3).toFixed(1),'font-size':size,fill:color,'text-anchor':'middle','font-weight':600},s);};
  function sprite(rows,x0,y0,u,pal){let out='';rows.forEach((row,j)=>{for(let i=0;i<row.length;){const ch=row[i];if(ch==='.'||!pal[ch]){i++;continue;}let k=i;while(k+1<row.length&&row[k+1]===ch)k++;
    out+=`<rect x="${(x0+i*u).toFixed(1)}" y="${(y0+j*u).toFixed(1)}" width="${((k-i+1)*u).toFixed(1)}" height="${u}" fill="${pal[ch]}"/>`;i=k+1;}});return `<g shape-rendering="crispEdges">${out}</g>`;}
  const ESTATE=["....kkkkk...","....kwklk...","....kkkkk...","....kwkwk.kk","kkk.kkkkk.kl","klk.kwkwk.kk","kkk.kkkkk.kw","kwk.klkwk.kk","kkk.kkkkk.kw","kwk.kwkwk.kk","kkk.kkkkk.kl","gggggggggggg"];
  const TOWN=["......kkkk......","....kkaaaakk....","..kkaaaaaaaakk..","kkaaaaaaaaaaaakk","kaaaaaaaaaaaaaak","rprprprprprprprp","prprprprprprprpr",".kkkkkkkkkkkkkk.",".kllkkkddkkkllk.",".kllkkkddkkkllk.",".kkkkkkddkkkkkk.","gggggggggggggggg"];
  const OFFICE=[".....kkkk.....",".....kwwk.....","..kkkkkkkkkk..","..kwwkwwkwwk..","..kkkkkkkkkk..","..kwwkwwkwwk..","..kkkkkkkkkk..","..kwwkwwkwwk..","..kkkkkkkkkk..","..kwwkddkwwk..","..kkkkddkkkk..","gggggggggggggg"];
  const DEST={town:TOWN,jobs:OFFICE},DCOL=k=>({town:C.warn,jobs:C.info})[k];
  const nm=o=>I.lang==='zh-Hans'?(o.hans||o.name):(o.name);
  const nameO=i=>nm(D.origins[i]),nameD=k=>nm(D.destinations[k]),shortD=k=>{const d=D.destinations[k];return I.lang==='zh-Hans'?(d.shortHans||d.hans):(d.short||d.name);};
  const shortO=i=>{const o=D.origins[i];return I.lang==='zh-Hans'?(o.shortHans||o.hans):(o.short||o.name);};
  const roadName=r=>{const d=D.roads.find(x=>x.name===r);return d?nm(d):r;},lineLabel=n=>n.startsWith('bus')?RL[+n.slice(3)]:(()=>{const l=G.lines.find(x=>x.name===n);return l?(I.lang==='zh-Hans'?(l.hans||l.name):l.name):n;})();
  const R=Math.round,f1=v=>(Math.round(v*10)/10).toFixed(1),tenth=a=>R(a*10);
  const pct=(a,b)=>{const v=b?R(100*(a-b)/b):0;return{txt:(v>0?'+':v<0?'−':'±')+Math.abs(v)+'%',cls:v<0?'good':v>0?'bad':''};};
  const sgn=(v,goodUp)=>{const r=R(v);return{txt:(r>0?'+':r<0?'−':'±')+Math.abs(r),cls:r===0?'':(r>0)===goodUp?'good':'bad'};};
  const jamCol=e=>e<.25?C.ink3:e<1?'#E3A008':C.jam;
  const OFF=7,rxy=(s,c,side=1)=>{const [x,y]=xy(c),h=s.a[1]===s.b[1];return h?[x,y+side*OFF]:[x+side*OFF,y];};
  const bxy=(a,b,c)=>{const [x,y]=xy(c),h=a[1]===b[1];return h?[x,y-OFF]:[x-OFF,y];};   // bus routes run on the other side of the road
  let plan=new Plan(),tool='draw',cur=0,hover=null,hoverBtn=null,sel=-1,drag=false,history=[],playing=false,timer=0,hold=false,lastY=null,flash=0,changedIn=[];
  const VBW=MX*2+(D.cols-1)*CS+80,VBH=MY+56+(D.rows-1)*CS;
  const cfg=p=>JSON.stringify([p.routes,p.lanes]);
  function snapshot(){history.push(cfg(plan));if(history.length>200)history.shift();}
  function restore(s){const [routes,lanes]=JSON.parse(s);plan.routes=routes;plan.lanes=lanes;}
  const memo=new Map();function cached(k,f){if(!memo.has(k)){if(memo.size>80)memo.clear();memo.set(k,f());}return memo.get(k);}
  const stamp=()=>cfg(plan)+plan.year+JSON.stringify(plan.perceived.map(v=>Math.round(v*1e4)));
  function now(){return cached('now'+stamp(),()=>plan.now());}
  const settled=p=>cached('pot'+cfg(p)+p.year+JSON.stringify(p.perceived.map(v=>Math.round(v*1e4))),()=>p.potential());
  // the road a lane click at this cell means: one a route uses, else the first through it
  function laneRoadAt(c){const here=G.sections.filter(s=>same(s.a,c)||same(s.b,c));if(!here.length)return null;
    const used=here.flatMap(s=>s.roads).find(r=>plan.routes.some(R=>R.cells.some((x,i)=>i&&sectionBetween(R.cells[i-1],x)?.roads.includes(r))));return used||here[0].roads[0];}
  // a change the cursor points at: its plan, or null
  function intent(){
    if(plan.done||playing)return null;
    const q=()=>plan.clone();
    if(hoverBtn==='plus'&&plan.canBus(cur)){const p=q();p.addBus(cur);return{p,what:'bus'};}
    if(hoverBtn==='minus'&&plan.routes[cur].buses>0){const p=q();p.removeBus(cur);return{p,what:'bus'};}
    if(!hover)return null;
    if(tool==='stop'&&plan.onRoute(cur,hover)){const p=q();p.toggleStop(cur,hover);return{p,what:'stop',cell:hover};}
    if(tool==='lane'){const r=laneRoadAt(hover);if(r&&(plan.hasLane(r)||plan.money>=P.laneCost)){const p=q();p.toggleLane(r);return{p,what:'lane',road:r};}}
    return null;}
  function view(){
    if(hold&&plan.open)return{mode:'nothing',y:G.base,p:null};
    const it=intent();if(it&&(it.p.running||plan.running))return{mode:'step',y:settled(it.p),base:settled(plan),p:it.p,it};
    if(hold&&!plan.open&&plan.running)return{mode:'ahead',y:settled(plan),p:plan};
    if(!plan.open)return{mode:plan.running?'first':'today',y:now(),p:plan};
    return{mode:'year',y:lastY||now(),p:plan};
  }
  const rowsOf=y=>[...y.est.flatMap(e=>e.to.map(x=>({from:D.origins[e.i].cell,to:D.destinations[x.k].cell,x,who:shortO(e.i),e}))),
    ...(y.chain||[]).map(q=>({from:D.destinations[q.a].cell,to:D.destinations[q.b].cell,x:q,who:shortD(q.a),chain:true}))];
  function roadStats(y,p){const lanes=p?p.lanes:[];return D.roads.map(r=>{const ids=G.sections.filter(s=>s.roads.includes(r.name)).map(s=>s.id);
    const worst=ids.reduce((b,id)=>y.extra[id]>y.extra[b]?id:b,ids[0]);
    return{name:r.name,ids,worst,extra:y.extra[worst],felt:Math.max(...ids.map(id=>plan.perceived[id])),base:Math.max(...ids.map(id=>G.base.extra[id])),lane:lanes.includes(r.name)};});}

  /* -------------------------------------------------------------- the moving people and buses */
  const V={walk:34,car:95,bus:80,rail:190};
  const corner=(a,b)=>[...(a[0]===b[0]||a[1]===b[1]?[]:[xy([b[0],a[1]])]),xy(b)];
  function leg(pts,sp,a,b,v){for(const q of corner(a,b)){pts.push(q);sp.push(v);}}
  function carPath(route,from,to,y){
    const pts=[xy(from)],sp=[];
    if(route&&route.sections.length){const secs=route.sections.map(id=>G.sections[id]);
      let c0=secs.length>1?(same(secs[0].a,secs[1].a)||same(secs[0].a,secs[1].b)?secs[0].b:secs[0].a):(walk(secs[0].a,from)<=walk(secs[0].b,from)?secs[0].a:secs[0].b);
      pts.push(rxy(secs[0],c0));sp.push(V.car);
      for(const s of secs){const nx=same(s.a,c0)?s.b:s.a;pts.push(rxy(s,nx));sp.push(V.car/(1+(y.extra[s.id]||0)));c0=nx;}}
    pts.push(xy(to));sp.push(V.car);return{pts,sp};}
  const busSpeed=(a,b,y,p)=>{const s=sectionBetween(a,b);return s&&!laned(s,p.lanes)?V.bus/(1+(y.extra[s.id]||0)):V.bus;};
  function transitPath(trip,from,to,y,p){
    const pts=[xy(from)],sp=[];let at=from;
    trip.legs.forEach((l,j)=>{const name=trip.lines[j],bus=name.startsWith('bus'),cells=bus?p.routes[+name.slice(3)].cells:(G.lines.find(x=>x.name===name)||{cells:[]}).cells,step=l.to>=l.from?1:-1;
      leg(pts,sp,at,cells[l.from],V.walk);
      for(let i=l.from+step;step>0?i<=l.to:i>=l.to;i+=step){const a=cells[i-step],b=cells[i];if(bus){pts.push(bxy(a,b,b));sp.push(busSpeed(a,b,y,p));}else{pts.push(xy(b));sp.push(V.rail);}}
      at=cells[l.to];});
    leg(pts,sp,at,to,V.walk);return{pts,sp};}
  function walkPath(from,to){const pts=[xy(from)],sp=[];leg(pts,sp,from,to,V.walk);return{pts,sp};}
  function timed(p){const cum=[0];for(let i=1;i<p.pts.length;i++){const [a,b]=[p.pts[i-1],p.pts[i]];cum.push(cum[i-1]+Math.hypot(b[0]-a[0],b[1]-a[1])/p.sp[i-1]);}return{...p,cum,T:cum.at(-1)};}
  const flowMemo=new WeakMap();
  function flowsOf(y,p){if(flowMemo.has(y))return flowMemo.get(y);const out=[];
    const add=(id,kind,n,mk)=>{if(n>.3)out.push({id,kind,n,mk});};
    const one=(id,x,from,to)=>{add(id+'c','car',x.drivers,()=>carPath(x.route,from,to,y));
      if(x.trip)add(id+'t','metro',x.metro,()=>transitPath(x.trip,from,to,y,p||plan));
      add(id+'w','walk',x.walkers,()=>walkPath(from,to));};
    y.est.forEach(e=>e.to.forEach(x=>one(`e${e.i}k${x.k}`,x,D.origins[e.i].cell,D.destinations[x.k].cell)));
    (y.chain||[]).forEach(q=>one(`d${q.a}${q.b}`,q,D.destinations[q.a].cell,D.destinations[q.b].cell));
    flowMemo.set(y,out);return out;}
  let dots=[],acc={},lastT=0;
  function stepDots(tm,v){
    const dt=Math.min(.12,Math.max(0,(tm-lastT)/1000));lastT=tm;
    for(const f of flowsOf(v.y,v.p)){acc[f.id]=(acc[f.id]??Math.random())+f.n/PER_DOT/DAY_S*dt;
      while(acc[f.id]>=1&&dots.length<MAX_DOTS){acc[f.id]-=1;if(!f.path)f.path=timed(f.mk());dots.push({p:f.path,kind:f.kind,t:0});}
      if(acc[f.id]>=1)acc[f.id]=0;}
    let s='';dots=dots.filter(d=>{d.t+=dt;if(d.t>=d.p.T)return false;const c=d.p.cum;let i=1;while(i<c.length-1&&c[i]<d.t)i++;
      const a=d.p.pts[i-1],b=d.p.pts[i],f=(d.t-c[i-1])/Math.max(1e-6,c[i]-c[i-1]),x=a[0]+(b[0]-a[0])*f,yy=a[1]+(b[1]-a[1])*f;
      if(d.kind==='car')s+=`<rect x="${(x-3.5).toFixed(1)}" y="${(yy-2.5).toFixed(1)}" width="7" height="5" rx="1.5" fill="${C.ink}" opacity=".7"/>`;
      else if(d.kind==='metro')s+=`<circle cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="3" fill="${C.metro}"/>`;
      else s+=`<circle cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="2.6" fill="${C.walk}"/>`;
      return true;});
    return s;}

  /* -------------------------------------------------------------- the board */
  function drawBase(v){
    const y=v.y,p=v.p||{routes:[],lanes:[]},placing=!plan.done;
    let ground='',roads='',rails='',buses='',things='',labels='';
    const water=new Set((D.water||[]).map(key));
    for(let x=0;x<D.cols;x++)for(let yy=0;yy<D.rows;yy++){const [cx,cy]=xy([x,yy]),wet=water.has(key([x,yy])),road=G.roadNodes.has(key([x,yy]));
      const can=placing&&tool==='draw'&&plan.routes[cur].cells.length&&plan.canExtend(cur,[x,yy]);
      ground+=svg('rect',{x:cx-CS/2+2,y:cy-CS/2+2,width:CS-4,height:CS-4,rx:4,fill:can?RC[cur]:wet?C.info:C.soft,'fill-opacity':can?.14:wet?.10:road&&tool==='draw'&&placing?.7:.45,stroke:can?RC[cur]:wet?'none':C.line,'stroke-opacity':can?.6:.7,'stroke-dasharray':can?'4 3':''});}
    G.sections.forEach(s=>{const [x1,y1]=rxy(s,s.a),[x2,y2]=rxy(s,s.b),e=y.extra[s.id],w=5+Math.min(7,s.cap/10),ln=laned(s,p.lanes);
      roads+=svg('path',{d:`M${x1} ${y1}L${x2} ${y2}`,stroke:jamCol(e),'stroke-width':w.toFixed(1),'stroke-opacity':e<.25?.3:.55,'stroke-linecap':'round'});
      if(ln){const [a1,b1]=bxy(s.a,s.b,s.a),[a2,b2]=bxy(s.a,s.b,s.b);roads+=svg('path',{d:`M${a1} ${b1}L${a2} ${b2}`,stroke:C.bad,'stroke-width':3,'stroke-dasharray':'5 4','stroke-opacity':.8});}});
    G.lines.forEach(l=>{rails+=svg('path',{d:'M'+l.cells.map(c=>xy(c).join(' ')).join('L'),fill:'none',stroke:l.color,'stroke-width':l.mine?7:5,'stroke-linejoin':'round','stroke-linecap':'round','stroke-opacity':.75});
      l.stations.forEach(s=>{const [x,yy]=xy(s);rails+=svg('circle',{cx:x,cy:yy,r:5.5,fill:C.panel,stroke:l.color,'stroke-width':2.5});});});
    // bus routes: their colour, the side of the road opposite the cars; stops as squares
    p.routes.forEach((Rt,r)=>{if(!Rt.cells.length)return;const on=r===cur&&!plan.done,run=Rt.stops.length>=2&&Rt.buses>0;
      if(Rt.cells.length>1){const pts=Rt.cells.map((c,i)=>{const a=Rt.cells[Math.max(0,i-1)],b=Rt.cells[Math.min(Rt.cells.length-1,i+1)];return bxy(a,b,c);});
        buses+=svg('path',{d:'M'+pts.map(q=>q.map(z=>z.toFixed(1)).join(' ')).join('L'),fill:'none',stroke:RC[r],'stroke-width':on?5:3.5,'stroke-opacity':run?.9:.45,'stroke-dasharray':run?'':'6 4','stroke-linejoin':'round'});}
      else{const [x,yy]=xy(Rt.cells[0]);buses+=svg('circle',{cx:x,cy:yy,r:5,fill:RC[r]});}
      Rt.stops.forEach(s=>{const i=Rt.cells.findIndex(c=>same(c,s)),a=Rt.cells[Math.max(0,i-1)],b=Rt.cells[Math.min(Rt.cells.length-1,i+1)],[x,yy]=bxy(a,b,s);
        things+=svg('rect',{x:(x-6).toFixed(1),y:(yy-6).toFixed(1),width:12,height:12,rx:2.5,fill:C.panel,stroke:RC[r],'stroke-width':3});});
      if(placing&&tool==='draw'&&on)for(const e of [Rt.cells[0],Rt.cells.at(-1)]){const [x,yy]=xy(e);things+=svg('circle',{cx:x,cy:yy,r:8,fill:'none',stroke:RC[r],'stroke-width':2.5,'stroke-dasharray':'3 2'});}});
    y.est.forEach(e=>{const o=D.origins[e.i],[cx,cy]=xy(o.cell);
      const parts=[[e.drivers,C.ink3],[e.metro,C.metro],[e.walkers,C.walk]],all=parts.reduce((s,q)=>s+q[0],0)||1,r=21,L=2*Math.PI*r;let off=0;
      labels+=svg('circle',{cx,cy:cy-4,r,fill:C.panel,'fill-opacity':.85,stroke:C.raise,'stroke-width':5});
      for(const [n,c] of parts){const len=L*n/all;if(len>.5)labels+=svg('circle',{cx,cy:cy-4,r,fill:'none',stroke:c,'stroke-width':5,'stroke-dasharray':`${len.toFixed(1)} ${L.toFixed(1)}`,'stroke-dashoffset':(-off).toFixed(1),transform:`rotate(-90 ${cx} ${cy-4})`});off+=len;}
      labels+=sprite(ESTATE,cx-13,cy-19,2.2,{k:C.ink,w:C.paper,l:C.warn,g:C.ink2});
      const side=o.house[0]!==0,up=o.house[1]<0,lx=side?cx+(o.house[0]>0?28:-28):cx,ly=side?cy:up?cy-31:cy+34,la=side?(o.house[0]>0?'start':'end'):'middle';
      labels+=text(lx,ly,nameO(e.i)+(o.tag==='new'?' ★':''),13.5,C.ink,{'text-anchor':la,'font-weight':700});});
    y.dest.forEach(d=>{const o=D.destinations[d.k],[cx,cy]=xy(o.cell),sp=DEST[o.kind],w=sp[0].length*2.6;
      labels+=sprite(sp,cx-w/2,cy-20,2.6,{k:C.ink,w:C.paper,a:DCOL(o.kind),r:C.accent2,p:C.paper,l:C.warn,d:DCOL(o.kind),g:C.ink2});
      const side=o.house[0]!==0,lx=side?cx+(o.house[0]>0?w/2+6:-w/2-6):cx,ly=side?cy:cy+30,la=side?(o.house[0]>0?'start':'end'):'middle';
      labels+=text(lx,ly,nameD(d.k),13.5,DCOL(o.kind),{'text-anchor':la,'font-weight':700});});
    $('gBase').innerHTML=ground+roads+rails+buses+labels+things;
  }
  function drawTop(v){
    let s='';
    if(sel>=0){const row=rowsOf(v.y)[sel];if(row){const {x}=row;
      if(x.route)s+=x.route.sections.map(id=>{const q=G.sections[id],[x1,y1]=rxy(q,q.a),[x2,y2]=rxy(q,q.b);return svg('path',{d:`M${x1} ${y1}L${x2} ${y2}`,stroke:C.ink,'stroke-width':3,'stroke-dasharray':'1 6','stroke-linecap':'round'});}).join('');}}
    if(hover&&!plan.done&&!playing){const [hx,hy]=xy(hover),Rt=plan.routes[cur];
      if(tool==='draw'){
        if(plan.canExtend(cur,hover)){const end=!Rt.cells.length?null:sectionBetween(Rt.cells.at(-1),hover)?Rt.cells.at(-1):Rt.cells[0];
          if(end)s+=svg('path',{d:`M${xy(end).join(' ')}L${hx} ${hy}`,stroke:RC[cur],'stroke-width':6,'stroke-opacity':.5,'stroke-linecap':'round'});
          else s+=svg('circle',{cx:hx,cy:hy,r:6,fill:RC[cur],'fill-opacity':.5});}
        else if(plan.isEnd(cur,hover))s+=pill(hx,hy-20,t('m.pvShorten'),C.ink2,12);
        else if(!plan.isRoad(hover))s+=pill(hx,hy-20,t('b4.pvRoad'),C.ink3,11.5);}
      else if(tool==='stop'&&plan.onRoute(cur,hover)){const has=plan.isStop(cur,hover);
        s+=svg('rect',{x:hx-9,y:hy-9,width:18,height:18,rx:3,fill:'none',stroke:RC[cur],'stroke-width':3,'stroke-dasharray':'4 3'})+pill(hx,hy-24,t(has?'b4.pvUnstop':'b4.pvStop'),RC[cur],12);}
      else if(tool==='lane'){const r=laneRoadAt(hover);if(r){const on=plan.hasLane(r);
        for(const q of G.sections.filter(x=>x.roads.includes(r))){const [x1,y1]=rxy(q,q.a),[x2,y2]=rxy(q,q.b);s+=svg('path',{d:`M${x1} ${y1}L${x2} ${y2}`,stroke:C.bad,'stroke-width':13,'stroke-opacity':.22,'stroke-linecap':'round'});}
        s+=pill(hx,hy-22,roadName(r)+' · '+t(on?'b4.pvUnlane':'b4.pvLane',{c:P.laneCost}),C.bad,12);}}}
    $('gTop').innerHTML=s;
  }
  function drawDyn(tm,v){
    let s=stepDots(tm,v);
    const p=v.p;if(p)p.routes.forEach((Rt,r)=>{if(Rt.stops.length<2||Rt.buses<1||Rt.cells.length<2)return;const n=Rt.cells.length-1;
      for(let k=0;k<Rt.buses;k++){const ph=((tm/1000)*0.9+k*2*n/Rt.buses)%(2*n),pos=ph<n?ph:2*n-ph,i=Math.min(n-1,Math.floor(pos)),f=pos-i,a=Rt.cells[i],b=Rt.cells[i+1];
        const [x1,y1]=bxy(a,b,a),[x2,y2]=bxy(a,b,b),x=x1+(x2-x1)*f,yy=y1+(y2-y1)*f,h=a[1]===b[1];
        s+=`<rect x="${(x-(h?7:4)).toFixed(1)}" y="${(yy-(h?4:7)).toFixed(1)}" width="${h?14:8}" height="${h?8:14}" rx="2" fill="${RC[r]}" stroke="${C.paper}" stroke-width="1.2"/>`;}});
    $('gDyn').innerHTML=s;
  }
  let baseKey='';
  function draw(force){const v=view(),k=JSON.stringify([cfg(plan),plan.year,v.mode,v.it?[v.it.what,v.it.cell,v.it.road,hoverBtn]:0,tool,cur,sel,I.lang,C.paper,hold,playing]);
    if(force||k!==baseKey){baseKey=k;drawBase(v);headline(v);side(v);}drawTop(v);info(v);}

  /* -------------------------------------------------------------- headline, info card */
  function headline(v){
    const el=$('headline'),y=v.y,b=G.base,worst=roadStats(y,v.p).sort((p,q)=>q.extra-p.extra)[0];
    el.className='headline '+(v.mode==='step'||v.mode==='ahead'?'preview':v.mode==='nothing'?'nothing':'');
    let main='',sub='';
    if(v.mode==='nothing'){main=t('b4.hlNothing',{c:R(b.drivers),j:R(b.jam)});sub=t('r3.hlNothingSub');}
    else if(v.mode==='step'){const j=pct(y.jam,v.base.jam),c=pct(y.drivers,v.base.drivers),bb=sgn(y.onBus-v.base.onBus,true);
      main=t('b4.hlStep',{dj:j.txt,jc:j.cls,db:bb.txt,bc:bb.cls,dc:c.txt,cc:c.cls});sub=t('b4.hlStepSub');}
    else if(v.mode==='ahead'||v.mode==='first'){const j=pct(y.jam,b.jam),c=pct(y.drivers,b.drivers);
      main=t(v.mode==='ahead'?'b4.hlAhead':'b4.hlFirst',{dj:j.txt,jc:j.cls,b:R(y.onBus),dc:c.txt,cc:c.cls});sub=t(v.mode==='ahead'?'b4.hlAheadSub':'b4.hlFirstSub');}
    else if(plan.done){const tier=plan.total>=P.masterScore?3:plan.total>=P.highScore?2:plan.total>=P.target?1:0;main=t('b4.hlDone',{s:R(plan.total),tier:t('r.t'+tier)});sub=t('b4.hlDoneSub');}
    else if(plan.open&&plan.log.length){const l=plan.log.at(-1),j=pct(l.jam,l.jam0),c=pct(l.drivers,b.drivers);
      main=t('b4.hlYear',{y:l.year,dj:j.txt,jc:j.cls,b:R(l.onBus),dc:c.txt,cc:c.cls});
      const felt=lastY?lastY.extra.reduce((s,e)=>s+e,0)-plan.perceived.reduce((s,e)=>s+e,0):0;
      sub=[Math.abs(felt)>.05?t(felt<0?'r3.cardBetter':'r3.cardWorse'):'',t('b4.hlYearSub')].filter(Boolean).join(' · ');}
    else{main=t('b4.hlToday',{c:R(b.drivers),j:R(b.jam)});sub=t('b4.hlTodaySub',{r:roadName(worst.name),e:f1(worst.extra)});}
    $('hlMain').innerHTML=main;$('hlSub').innerHTML=sub;
  }
  function info(v){
    if(flash&&performance.now()<flash.until){$('infoCard').innerHTML=flash.html;return;}
    if(!hover){$('infoCard').innerHTML='';return;}
    const y=v.y,c=hover,h=[],p=v.p||plan;
    const oi=D.origins.findIndex(o=>same(o.cell,c));
    if(oi>=0){const e=y.est[oi];h.push(t('r3.iEst',{n:nameO(oi),p:e.n,c:R(e.drivers),m:R(e.metro),w:R(e.walkers),nb:R(e.nearby),a:10}).replace(/<br>[^<]*$/,''));
      e.to.forEach(x=>h.push(t('r3.iTrip',{d:shortD(x.k),car:f1(x.car),m:x.trip?f1(x.trip.blocks)+' ('+x.trip.lines.map(lineLabel).join('→')+')':'—'})));}
    const di=D.destinations.findIndex(o=>same(o.cell,c));
    if(di>=0){const d=y.dest[di];h.push(t('r3.iDest',{n:nameD(di),g:R(d.go),b:R(d.before),m:R(d.metro)}));}
    for(const l of G.lines){const j=l.stations.findIndex(s=>same(s,c));if(j>=0)h.push(t('r3.iStation',{l:I.lang==='zh-Hans'?(l.hans||l.name):l.name,s:(I.lang==='zh-Hans'?l.namesHans:l.names)[j]}));}
    p.routes.forEach((Rt,r)=>{if(Rt.stops.some(s=>same(s,c))&&Rt.buses>0)h.push(t('b4.iStop',{n:RL[r],w:f1(P.busHead/Rt.buses)}));});
    const here=G.sections.filter(s=>same(s.a,c)||same(s.b,c)),seen=new Set();
    for(const s of here){const rn=s.roads[0];if(seen.has(rn))continue;seen.add(rn);const ids=here.filter(q=>q.roads[0]===rn).map(q=>q.id),id=ids.reduce((b,q)=>y.extra[q]>y.extra[b]?q:b,ids[0]);
      h.push(t('r3.iRoad',{r:roadName(rn),c:R(y.roadLoad[id]),cap:R(G.sections[id].cap*(laned(G.sections[id],p.lanes)?1-P.laneCut:1)),e:f1(y.extra[id]),f:f1(plan.perceived[id])})+(laned(G.sections[id],p.lanes)?' '+t('b4.iLane',{p:R((1-P.laneCut)*10)}):''));}
    $('infoCard').innerHTML=h.join('<br>');
  }
  function say(html){flash={until:performance.now()+1800,html};}

  /* -------------------------------------------------------------- side panels */
  function side(v){
    const y=v.y,nowY=now(),hi=R(P.masterScore*1.12),at=q=>Math.max(0,Math.min(100,100*q/hi)),n0=R(G.doNothing[0]);
    $('score').textContent=R(plan.total);$('scoreBar').style.width=`${at(plan.total)}%`;
    for(const [id,q,k] of [['tickPass',P.target,'g.tickPass'],['tickHigh',P.highScore,'g.tickHigh'],['tickMaster',P.masterScore,'g.tickMaster']]){$(id).style.left=`${at(q)}%`;$(id).dataset.label=t(k,{n:q});}
    $('yearNum').textContent=plan.done?t('m.yearDone',{m:P.years}):plan.open?t('m.yearN',{y:plan.year,m:P.years}):t('m.yearPlan');
    $('run').textContent=plan.done?t('m.runDone'):plan.open?t('b4.runN',{n:plan.year+1}):t('b4.run0');$('run').disabled=playing;
    $('pause').hidden=!plan.open||plan.done;$('pause').textContent=playing?t('b4.autoStop'):t('b4.auto');$('rewind').hidden=!plan.open;
    $('hold').textContent=plan.open?t('b4.holdNothing'):t('b4.holdAhead');$('hold').disabled=!plan.open&&!plan.running;$('hold').classList.toggle('on',hold);
    const top=Math.max(...G.doNothing,...plan.log.map(l=>l.jam),nowY.jam)*1.12;
    let yc='';for(let k=1;k<=P.years;k++){const l=plan.log[k-1],q=l?l.jam:k===plan.year+1&&!plan.done&&plan.running?nowY.jam:0,h=R(52*q/top);
      yc+=`<div class="yb ${l?'done':k===plan.year+1?'next':''} ${l&&l.crowdedSections?'crowd':''}"><i style="height:${h}px"></i><b>${q?R(q):''}</b><small>${t('m.yShort',{y:k})}</small></div>`;}
    yc+=`<div class="ypot" style="bottom:${(18+52*G.doNothing[0]/top).toFixed(0)}px"><span>${t('b4.yNothing',{n:n0})}</span></div>`;
    $('yChart').innerHTML=yc;
    $('yNote').innerHTML=!plan.running&&!plan.open?t('b4.yNoteNone'):t('b4.yNote',{j:R(nowY.jam),n:n0});
    $('planBox').classList.toggle('locked',plan.done);
    $('money').textContent=`${plan.money} / ${P.budget}`;
    $('moneyNote').innerHTML=t('b4.money0',{bc:P.busCost,lc:P.laneCost});
    $('routeSeg').innerHTML=plan.routes.map((Rt,r)=>`<button data-r="${r}" aria-pressed="${r===cur}" style="--rc:${RC[r]}"><b>${t('b4.route',{n:RL[r]})}</b><small>${!Rt.cells.length?t('b4.chipEmpty'):Rt.buses?t('b4.chip',{b:Rt.buses,w:f1(P.busHead/Rt.buses)}):t('b4.chipNoBus')}</small></button>`).join('');
    const Rt=plan.routes[cur];$('routeTxt').innerHTML=t('b4.routeTxt',{n:RL[cur],b:Rt.buses,w:Rt.buses?f1(P.busHead/Rt.buses):'—',c:Rt.buses*P.perBus});
    $('busPlus').disabled=plan.done||!plan.canBus(cur);$('busMinus').disabled=plan.done||Rt.buses<1;
    document.querySelectorAll('#toolSeg [data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===tool)));
    $('toolHint').textContent=plan.done?'':plan.open&&!Rt.cells.length?t('b4.hintOpen'):tool==='draw'?(Rt.cells.length?t('b4.hintDraw2'):t('b4.hintDraw1')):tool==='stop'?(Rt.stops.length>=2&&!Rt.buses?t('b4.hintBus',{h:P.busHead}):t('b4.hintStop')):t('b4.hintLane',{p:R((1-P.laneCut)*10)});
    $('undo').disabled=!history.length||plan.done;$('clear').disabled=plan.done||!Rt.cells.length;
    const scale=3,p=v.p||plan;let h=`<p class="jamline">${t('r3.jamNow',{j:R(y.jam),n:n0}).replace(/什麼都不做|什么都不做|do nothing/,t('b4.yNothing',{n:''}).trim())}</p>`;
    roadStats(y,p).forEach(r=>{const w=q=>Math.min(100,100*q/scale).toFixed(1);
      h+=`<div class="rr"><span class="xn">${roadName(r.name)}</span><span class="rbar"><i style="width:${w(r.extra)}%;background:${jamCol(r.extra)}"></i><s style="left:${w(r.base)}%"></s><u style="left:${w(r.felt)}%"></u></span><b style="color:${jamCol(r.extra)}">${t('r3.extra',{e:f1(r.extra)})}</b>`+
        `<button class="lanebtn ${plan.hasLane(r.name)?'on':''}" data-lane="${r.name}" ${plan.done?'disabled':''}>${t('b4.lane')}</button></div>`;});
    $('roadBox').innerHTML=h+`<p class="hbnote">${t('r3.roadNote',{lp:R(P.learn*10)+(I.lang==='en'?'/10':' 成')})}</p>`;
    let bx='';y.lines.filter(l=>l.kind==='bus').forEach(l=>{const r=l.route,Rr=p.routes[r],riders=y.est.reduce((s,e)=>s+e.to.filter(x=>x.trip&&x.trip.lines.includes(l.name)).reduce((a,x)=>a+x.metro,0),0),mx=Math.max(0,...l.load);
      bx+=`<div class="br"><i class="sw2" style="background:${RC[r]}"></i><span>${t('b4.busRow',{n:RL[r],b:Rr.buses,w:f1(l.wait),r:R(riders),l:R(mx),c:l.cap,crowd:mx>l.cap?t('b4.busCrowd'):''})}</span></div>`;});
    $('busBox').innerHTML=(bx||`<p class="hbnote">${t('b4.busNone')}</p>`)+`<p class="hbnote">${t('b4.busNote',{pcu:P.busPCU})}</p>`;
    let tb=`<thead><tr><th>${t('m.tTrip')}</th><th>${t('m.tGo')}</th><th>${t('r3.tCar')}</th><th>${t('m.tMetro')}</th><th>${t('r3.tDrive')}</th><th>${t('m.tRiders')}</th></tr></thead><tbody>`;
    rowsOf(y).forEach(({x,who,chain},k)=>{tb+=`<tr data-row="${k}" class="${sel===k?'sel':''} ${x.metro>=1?'on':''} ${chain?'chain':''}"><td>${who}<small>→ ${shortD(x.k)}${chain?' · '+t('m.chainTag'):''}</small></td><td>${R(x.go)}<small>${t('m.was',{b:R(x.before)})}</small></td>`+
      `<td>${f1(x.car)}</td><td>${x.trip?f1(x.trip.blocks):'—'}<small>${x.trip?x.trip.lines.map(lineLabel).join('→'):''}</small></td><td>${R(x.drivers)}</td><td><b>${x.metro>=1?R(x.metro):''}</b></td></tr>`;});
    $('trips').innerHTML=tb+'</tbody>';
  }
  function render(){draw(true);}
  function fit(){$('board').setAttribute('viewBox',`0 0 ${VBW} ${VBH}`);}
  function texts(){
    $('goal').innerHTML=t('b4.goal',{pass:P.target,high:P.highScore,master:P.masterScore});
    const v={wp:P.walkPer,w:P.wait,h:P.busHead,pb:P.perBus,pcu:P.busPCU,p:R((1-P.laneCut)*10),b:P.budget,bc:P.busCost,lc:P.laneCost,mr:P.maxRoutes,y:P.years,cb:P.crowdBlocks,nb:P.nearby,
      lp:I.lang==='en'?P.learn*10+'/10':R(P.learn*10)+' 成',e0:D.destinations[0].carExtra??2,e1:D.destinations[1].carExtra??2};
    $('rules').innerHTML=['b4.r0','b4.r1','b4.r2','b4.r3','b4.r4','b4.r5'].map(k=>`<li>${t(k,v)}</li>`).join('');
    $('infoBody').innerHTML=t('b4.info',v);$('ivBody').innerHTML=t('iv.m4.body',v);
    $('mapLegend').innerHTML=t('b4.legend');document.title=t('b4.doc');
  }

  /* -------------------------------------------------------------- the years */
  function step(){
    if(plan.done){stop();return;}
    const before=plan.log.at(-1),r=plan.runYear();if(!r)return stop();
    if(before&&JSON.stringify([before.buses,before.lanes])!==JSON.stringify([r.buses,r.lanes]))changedIn.push(r.year);
    lastY=r.y;render();if(plan.done){stop();setTimeout(result,STEP_MS);}
  }
  function play(){if(plan.done)return;playing=true;clearInterval(timer);timer=setInterval(step,STEP_MS);render();}
  function stop(){playing=false;clearInterval(timer);render();}
  function rewind(){stop();plan.rewind();lastY=null;changedIn=[];render();}
  function result(){
    const tier=plan.total>=P.masterScore?3:plan.total>=P.highScore?2:plan.total>=P.target?1:0;
    $('result').classList.toggle('win',tier>0);$('resultTitle').textContent=t('r.t'+tier);$('resultEn').textContent=['Try again','Cleared','High score','Master'][tier];
    $('resultScore').textContent=t('b4.rScore',{d:R(plan.total),y:P.years});
    let h=`<table class="result"><thead><tr><th>${t('m.ryYear')}</th><th>${t('r3.ryJam')}</th><th>${t('b4.yNothing',{n:''})}</th><th>${t('r3.rySaved')}</th><th>${t('r3.ryDrive')}</th><th>${t('b4.ryBus')}</th><th>${t('b4.ryKit')}</th></tr></thead><tbody>`;
    for(const l of plan.log)h+=`<tr><td>${t('m.yShort',{y:l.year})}</td><td>${R(l.jam)}</td><td>${R(l.jam0)}</td><td>${R(l.saved)}</td><td>${R(l.drivers)}</td><td>${R(l.onBus)}</td><td>${l.buses.reduce((a,b)=>a+b,0)} / ${l.lanes.length}</td></tr>`;
    h+='</tbody></table>';
    const tips=[],lo=plan.log.reduce((b,l)=>l.jam<b.jam?l:b,plan.log[0]),last=plan.log.at(-1);
    if(lo.year<P.years&&last.jam>lo.jam*1.05)tips.push(t('r3.tipRebound',{lo:lo.year,a:R(lo.jam),b:R(last.jam)}));
    const rs=roadStats(lastY||now(),plan);const worst=rs.slice().sort((a,b)=>b.extra-a.extra)[0];if(worst&&worst.extra>=.5)tips.push(t('r3.tipWorst',{r:roadName(worst.name),e:f1(worst.extra)}));
    rs.filter(r=>r.lane&&r.extra>=1).forEach(r=>tips.push(t('b4.tipLane',{r:roadName(r.name),p:R((1-P.laneCut)*10)})));
    if(changedIn.length)tips.push(t('b4.tipChange',{y:changedIn[0]}));
    $('resultBody').innerHTML=h+`<ul class="ivlist">${tips.slice(0,5).map(s=>`<li>${s}</li>`).join('')}</ul>`;
    try{const k='tl-best-m4-'+D.map;if(plan.total>(+localStorage.getItem(k)||0))localStorage.setItem(k,R(plan.total));}catch(e){}
    window.dispatchEvent(new CustomEvent('tl:result',{detail:{game:'feeder',mode:'m4-bus',version:'7.10',map:D.map,score:R(plan.total),tier,tiers:[P.target,P.highScore,P.masterScore],routes:plan.routes,lanes:plan.lanes,lang:I.lang}}));
    $('result').showModal();
  }

  /* -------------------------------------------------------------- controls */
  const board=$('board');
  function cellAt(e){const pt=board.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;const p=pt.matrixTransform(board.getScreenCTM().inverse());
    const c=[Math.round((p.x-MX)/CS),Math.round((p.y-MY)/CS)];return c[0]>=0&&c[1]>=0&&c[0]<D.cols&&c[1]<D.rows?c:null;}
  function act(c){
    if(plan.done)return false;
    if(tool==='draw'){
      if(plan.canExtend(cur,c)){snapshot();plan.extend(cur,c);return true;}
      if(plan.isEnd(cur,c)){snapshot();plan.shorten(cur,c);return true;}
      return false;}
    if(tool==='stop'){if(!plan.onRoute(cur,c))return false;snapshot();plan.toggleStop(cur,c);return true;}
    const r=laneRoadAt(c);if(!r)return false;if(!plan.hasLane(r)&&plan.money<P.laneCost){say(t('m.pvNoMoney'));return false;}snapshot();plan.toggleLane(r);return true;
  }
  board.onpointerdown=e=>{const c=cellAt(e);if(!c)return;drag=tool==='draw'&&!plan.done;if(act(c))render();if(drag)board.setPointerCapture(e.pointerId);};
  board.onpointermove=e=>{const c=cellAt(e);
    if(drag&&c&&plan.canExtend(cur,c)){snapshot();plan.extend(cur,c);hover=null;render();return;}
    if(JSON.stringify(c)!==JSON.stringify(hover)){hover=c;draw();}};
  board.onpointerup=()=>{drag=false;};
  board.onpointerleave=()=>{if(!drag&&hover){hover=null;draw();}};
  $('toolSeg').onclick=e=>{const b=e.target.closest('[data-tool]');if(b&&!plan.done){tool=b.dataset.tool;hover=null;render();}};
  $('routeSeg').onclick=e=>{const b=e.target.closest('[data-r]');if(b){cur=+b.dataset.r;if(!plan.routes[cur].cells.length)tool='draw';render();}};
  $('undo').onclick=()=>{const s=history.pop();if(s){restore(s);render();}};
  $('clear').onclick=()=>{if(plan.done)return;snapshot();plan.clearRoute(cur);tool='draw';render();};
  $('busPlus').onclick=()=>{snapshot();if(plan.addBus(cur))render();};
  $('busMinus').onclick=()=>{snapshot();if(plan.removeBus(cur))render();};
  for(const [id,k] of [['busPlus','plus'],['busMinus','minus']]){$(id).addEventListener('pointerenter',()=>{hoverBtn=k;draw();});$(id).addEventListener('pointerleave',()=>{hoverBtn=null;draw();});}
  $('roadBox').onclick=e=>{const b=e.target.closest('[data-lane]');if(!b||plan.done)return;if(!plan.hasLane(b.dataset.lane)&&plan.money<P.laneCost){say(t('m.pvNoMoney'));return;}snapshot();plan.toggleLane(b.dataset.lane);render();};
  $('run').onclick=()=>{if(plan.done)result();else step();};
  $('pause').onclick=()=>{playing?stop():play();};
  $('rewind').onclick=rewind;
  const holdOn=e=>{if($('hold').disabled)return;e.preventDefault();hold=true;draw();},holdOff=()=>{if(hold){hold=false;draw();}};
  $('hold').addEventListener('pointerdown',holdOn);for(const ev of ['pointerup','pointerleave','pointercancel'])$('hold').addEventListener(ev,holdOff);
  $('trips').onclick=e=>{const r=e.target.closest('[data-row]');if(!r)return;const j=+r.dataset.row;sel=sel===j?-1:j;render();};
  $('again').onclick=()=>{$('result').close();rewind();};
  $('help').onclick=()=>$('info').showModal();
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  $('lvInfo').onclick=()=>$('lvIntro').showModal();$('ivGo').onclick=()=>$('lvIntro').close();
  document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]'))return;
    if(['1','2','3'].includes(e.key)){tool=['draw','stop','lane'][+e.key-1];render();}
    else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$('undo').click();}
    else if(e.code==='Space'&&plan.open&&!plan.done&&!e.target.closest?.('button')){e.preventDefault();$('pause').click();}
    else if(e.key==='Escape'&&sel>=0){sel=-1;render();}});
  function setTheme(th){document.documentElement.setAttribute('data-theme',th);$('thPaper').setAttribute('aria-pressed',String(th==='light'));$('thInk').setAttribute('aria-pressed',String(th==='dark'));
    try{localStorage.setItem('tl-theme',th);}catch(e){}readTokens();render();}
  $('thPaper').onclick=()=>setTheme('light');$('thInk').onclick=()=>setTheme('dark');
  window.addEventListener('tl:lang',()=>{texts();render();});
  let lastFrame=0;(function loop(tm){if(tm-lastFrame>33){drawDyn(tm,view());if(flash&&tm>flash.until){flash=0;info(view());}lastFrame=tm;}requestAnimationFrame(loop);})(0);
  // test hook: #intro=0&r0=7,2;8,2;8,3&s0=7,2;8,3&b0=3&lanes=秀茂坪道&years=3&tool=stop&cur=0&hover=8,3&hold=1&theme=dark&lang=en
  const q=new URLSearchParams(location.hash.slice(1));
  let saved=null;try{saved=localStorage.getItem('tl-theme');}catch(e){}
  fit();
  if(q.get('theme')||saved)setTheme(q.get('theme')||saved);
  for(let r=0;r<P.maxRoutes;r++){if(q.get('r'+r))for(const s of q.get('r'+r).split(';'))plan.extend(r,s.split(',').map(Number));
    if(q.get('s'+r))for(const s of q.get('s'+r).split(';'))plan.toggleStop(r,s.split(',').map(Number));for(let k=0;k<+(q.get('b'+r)||0);k++)plan.addBus(r);}
  if(q.get('lanes'))for(const l of q.get('lanes').split(';'))plan.toggleLane(l);
  for(let k=0;k<+(q.get('years')||0);k++){const r=plan.runYear();if(r)lastY=r.y;}
  if(q.get('tool'))tool=q.get('tool');if(q.get('cur'))cur=+q.get('cur');if(q.get('sel'))sel=+q.get('sel');if(q.get('hover'))hover=q.get('hover').split(',').map(Number);if(q.get('hold'))hold=true;
  texts();render();
  if(q.get('intro')!=='0'&&!q.get('r0'))$('lvIntro').showModal();
  // for the AI demo (demo.js)
  const api={reset(){stop();plan=new Plan();history=[];sel=-1;tool='draw';cur=0;hover=null;lastY=null;changedIn=[];render();},
    pick(r){cur=r;render();},extend(r,c){cur=r;tool='draw';const ok=plan.extend(r,c);render();return ok;},stop(r,c){cur=r;tool='stop';const ok=plan.toggleStop(r,c);render();return ok;},
    bus(r){cur=r;const ok=plan.addBus(r);render();return ok;},lane(n){tool='lane';const ok=plan.toggleLane(n);render();return ok;},go(){step();play();},halt(){stop();},get plan(){return plan;}};
  window.TL_BUS={api,plan:()=>({routes:JSON.parse(JSON.stringify(plan.routes)),lanes:plan.lanes.slice(),year:plan.year,money:plan.money,total:plan.total,done:plan.done,playing,jam:now().jam,dots:dots.length}),
    cellXY:c=>{const m=board.getScreenCTM(),[x,y]=xy(c);return[m.a*x+m.c*y+m.e,m.b*x+m.d*y+m.f];}};
})();
