(()=>{
  'use strict';
  // v7 · mode 2 «the metro», build once and watch it grow — the page, on mode 1's layout: the map in mode 1's style
  // (paper, trees, estates with a green ring for those on the metro, faint grey lines for where people go), the year top
  // left, the preview top right, four numbers at the bottom; on the left the goal, the controls, three cards (line,
  // stations, trains) with the line's panel and three rules; on the right the years table, where people go and one line
  // of what happens. Hover a cell on the line (stations) and the map turns into what a station there brings once
  // everybody knows; hold «👁» for that for the whole line, or (once open) for no line.
  const {Plan,D,P,year,spread,walk,same,key}=TOD,$=id=>document.getElementById(id),I=window.I18N,t=(k,v)=>I.t(k,v);
  const CS=62,MX=50,MY=50,STEP_MS=2600,DAY_S=7,PER_DOT=1,MAX_DOTS=600;
  const xy=c=>[MX+c[0]*CS,MY+c[1]*CS];
  const svg=(tag,a,c='')=>`<${tag} ${Object.entries(a).map(([k,v])=>`${k}="${v}"`).join(' ')}>${c}</${tag}>`;
  let C={};
  function readTokens(){const s=getComputedStyle(document.documentElement),v=n=>s.getPropertyValue('--s-'+n).trim();
    C={paper:v('paper'),panel:v('panel'),soft:v('soft'),raise:v('raise'),ink:v('ink'),ink2:v('ink2'),ink3:v('ink3'),line:v('line'),line2:v('line2'),accent:v('accent'),accent2:v('accent2'),
      warn:v('warn'),bad:v('bad'),info:v('info'),metro:v('metro'),walk:v('walk')};}
  readTokens();
  const text=(x,y,s,size=13,fill=C.ink,extra={})=>svg('text',{x,y,'font-size':size,fill,stroke:C.panel,'stroke-width':3.5,'paint-order':'stroke',...extra},s);
  const textW=(s,size)=>[...String(s)].reduce((w,ch)=>w+(ch.charCodeAt(0)>0x2e7f?size:ch===' '?size*.32:size*.6),0);
  const pill=(x,y,s,color,size=12)=>{const w=textW(s,size)+16,x0=x-w/2;
    return svg('rect',{x:x0.toFixed(1),y:(y-size+1).toFixed(1),width:w.toFixed(1),height:size+8,rx:(size+8)/2,fill:C.panel,stroke:color,'stroke-width':1.2,'fill-opacity':.97})+
      svg('text',{x:(x0+w/2).toFixed(1),y:(y+2.5).toFixed(1),'font-size':size,fill:color,'text-anchor':'middle','font-weight':600},s);};
  function sprite(rows,x0,y0,u,pal){let out='';rows.forEach((row,j)=>{for(let i=0;i<row.length;){const ch=row[i];if(ch==='.'||!pal[ch]){i++;continue;}let k=i;while(k+1<row.length&&row[k+1]===ch)k++;
    out+=`<rect x="${(x0+i*u).toFixed(1)}" y="${(y0+j*u).toFixed(1)}" width="${((k-i+1)*u).toFixed(1)}" height="${u}" fill="${pal[ch]}"/>`;i=k+1;}});return `<g shape-rendering="crispEdges">${out}</g>`;}
  const ESTATE=["....kkkkk...","....kwklk...","....kkkkk...","....kwkwk.kk","kkk.kkkkk.kl","klk.kwkwk.kk","kkk.kkkkk.kw","kwk.klkwk.kk","kkk.kkkkk.kw","kwk.kwkwk.kk","kkk.kkkkk.kl","gggggggggggg"];
  const TOWN=["......kkkk......","....kkaaaakk....","..kkaaaaaaaakk..","kkaaaaaaaaaaaakk","kaaaaaaaaaaaaaak","rprprprprprprprp","prprprprprprprpr",".kkkkkkkkkkkkkk.",".kllkkkddkkkllk.",".kllkkkddkkkllk.",".kkkkkkddkkkkkk.","gggggggggggggggg"];
  const OFFICE=[".....kkkk.....",".....kwwk.....","..kkkkkkkkkk..","..kwwkwwkwwk..","..kkkkkkkkkk..","..kwwkwwkwwk..","..kkkkkkkkkk..","..kwwkwwkwwk..","..kkkkkkkkkk..","..kwwkddkwwk..","..kkkkddkkkk..","gggggggggggggg"];
  const TRAIN=[".mmmmmmmmmmmmmmmmm.","mmwwmmwwmmwwmmwwmmm","mmwwmmwwmmwwmmwwmmm","mmmmmmmmmmmmmmmmmmm","mkkmmmmmmmmmmmmkkmm","..k.............k.."];
  const TREE=["..g..",".ggg.","ggggg",".ggg.","ggggg","..t..","..t.."],BUSH=[".gg.","gggg",".gg."],FLOWER=["f.f.",".g.f","..g."],HOME=["...kkkk...","..krrrrk..","..kwkkwk..",".kkkkkkkk.",".kwkkwkkk.",".kkkkkkkk.","...k..k..."],SHOP=["..kkkkkk..",".kwwwwwk..",".kkkkkkk..",".kwkddwk..",".kkkkkkk..","..kkkkk..."];
  const DEST={town:TOWN,jobs:OFFICE,shop:OFFICE},DCOL=k=>({town:C.warn,jobs:C.info,shop:C.accent})[k];
  let shownDestinations=D.destinations; const nameOrigin=o=>o.home?t('tod.homeName',{n:o.landIndex}):I.name(o); const nameO=i=>nameOrigin(D.origins[i]); const nameD=k=>{const d=shownDestinations[k]||D.destinations[k];return d.kind==='shop'?t('tod.shopName',{n:d.stationNo}):I.name(d);}; const shortD=k=>{const d=shownDestinations[k]||D.destinations[k];return d.kind==='shop'?t('tod.shopName',{n:d.stationNo}):(I.lang==='zh-Hans'?(d.shortHans||d.hans):(d.short||d.name));};
  const R=Math.round,tenth=a=>R(a*10),sw=c=>`<i class="sw" style="background:${c}"></i>`;
  const signed=v=>{const r=R(v);return{txt:(r>0?'+':r<0?'−':'±')+Math.abs(r),cls:r>0?'good':r<0?'bad':''};};
  window.TL_INPROGRESS=()=>!plan.done&&(plan.year>0||plan.line.length>0);   // leaving now loses this round (shared/nav.js asks)
  let plan=new Plan(),tool='draw',landUse='home',hover=null,sel=-1,drag=false,history=[],playing=false,timer=0,hold=false,lastY=null,flash=0;
  const VBW=MX*2+(D.cols-1)*CS+130,VBH=MY*2+(D.rows-1)*CS;
  function snapshot(){history.push(JSON.stringify({...plan}));if(history.length>200)history.shift();}
  function restore(s){const p=new Plan();Object.assign(p,JSON.parse(s));plan=p;}
  const planKey=p=>JSON.stringify([p.line,p.stations,p.trains,p.sales,p.pendingSales]);
  const memo=new Map();function cached(k,f){if(!memo.has(k)){if(memo.size>60)memo.clear();memo.set(k,f());}return memo.get(k);}
  function now(){return cached('now'+planKey(plan)+plan.year+JSON.stringify(plan.aware)+JSON.stringify(plan.crowded),()=>plan.now());}
  const noLine=()=>cached('none',()=>year([],[],D.origins.map(()=>0),1));
  const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
  function view(){
    if(hold&&plan.open)return{mode:'nothing',y:noLine(),aware:0};
    if(tool==='land'&&hover&&plan.canSell(hover)){const quote=plan.quote(hover,landUse);return{mode:'landPreview',y:plan.previewSale(hover,landUse),cell:hover,use:landUse,aware:avg(plan.awareFor()),quote};}
    if(!plan.open){
      if(tool==='station'&&hover&&plan.onLine(hover)&&(plan.isStation(hover)||plan.money>=P.stationCost)){
        const q=new Plan();Object.assign(q,JSON.parse(JSON.stringify({...plan})));q.toggleStation(hover);
        if(q.stations.length>=2)return{mode:'preview',y:cached('pot'+planKey(q),()=>q.potential()),cell:hover,aware:1};}
      if(hold&&plan.stations.length>=2)return{mode:'ahead',y:cached('pot'+planKey(plan),()=>plan.potential()),aware:1};
      return plan.stations.length>=2?{mode:'plan',y:now(),aware:avg(plan.aware)}:{mode:'today',y:noLine(),aware:0};}
    return{mode:'year',y:lastY||now(),aware:avg(plan.aware)};
  }
  const rowsOf=y=>[...y.est.flatMap(e=>e.to.map(x=>({from:e.origin.cell,to:y.destinations[x.k].cell,x,who:nameOrigin(e.origin),e}))),
    ...(y.chain||[]).map(q=>({from:y.destinations[q.a].cell,to:y.destinations[q.b].cell,x:q,who:shortD(q.a),chain:true}))];

  /* -------------------------------------------------------------- the moving people */
  const V={walk:34,car:80,rail:190};
  const corner=(a,b)=>[...(a[0]===b[0]||a[1]===b[1]?[]:[xy([b[0],a[1]])]),xy(b)];
  function leg(pts,sp,a,b,v){for(const q of corner(a,b)){pts.push(q);sp.push(v);}}
  function carPath(from,to){const pts=[xy(from)],sp=[];leg(pts,sp,from,to,V.car);return{pts,sp};}
  function metroPath(trip,from,to){const pts=[xy(from)],sp=[],step=trip.tx>=trip.fx?1:-1;
    leg(pts,sp,from,plan.line[trip.fx],V.walk);
    for(let i=trip.fx+step;step>0?i<=trip.tx:i>=trip.tx;i+=step){pts.push(xy(plan.line[i]));sp.push(V.rail);}
    leg(pts,sp,plan.line[trip.tx],to,V.walk);return{pts,sp};}
  function walkPath(from,to){const pts=[xy(from)],sp=[];leg(pts,sp,from,to,V.walk);return{pts,sp};}
  function timed(p){const cum=[0];for(let i=1;i<p.pts.length;i++){const [a,b]=[p.pts[i-1],p.pts[i]];cum.push(cum[i-1]+Math.hypot(b[0]-a[0],b[1]-a[1])/p.sp[i-1]);}return{...p,cum,T:cum.at(-1)};}
  const flowMemo=new WeakMap();
  function flowsOf(y){if(flowMemo.has(y))return flowMemo.get(y);const out=[];
    const add=(id,kind,n,mk)=>{if(n>.3)out.push({id,kind,n,mk});};
    const one=(id,x,from,to)=>{add(id+'c','car',x.drivers,()=>carPath(from,to));
      if(x.trip&&plan.line.length)add(id+'m','metro',x.metro,()=>metroPath(x.trip,from,to));add(id+'w','walk',x.walkers,()=>walkPath(from,to));};
    y.est.forEach(e=>e.to.forEach(x=>one('e'+e.i+'k'+x.k,x,e.origin.cell,y.destinations[x.k].cell)));
    (y.chain||[]).forEach(q=>one('d'+q.a+q.b,q,y.destinations[q.a].cell,y.destinations[q.b].cell));
    flowMemo.set(y,out);return out;}
  let dots=[],acc={},lastT=0;
  function stepDots(tm,y){
    const dt=Math.min(.12,Math.max(0,(tm-lastT)/1000));lastT=tm;
    for(const f of flowsOf(y)){acc[f.id]=(acc[f.id]??Math.random())+f.n/PER_DOT/DAY_S*dt;
      while(acc[f.id]>=1&&dots.length<MAX_DOTS){acc[f.id]-=1;if(!f.path)f.path=timed(f.mk());dots.push({p:f.path,kind:f.kind,t:0});}
      if(acc[f.id]>=1)acc[f.id]=0;}
    let s='';dots=dots.filter(d=>{d.t+=dt;if(d.t>=d.p.T)return false;const c=d.p.cum;let i=1;while(i<c.length-1&&c[i]<d.t)i++;
      const a=d.p.pts[i-1],b=d.p.pts[i],f=(d.t-c[i-1])/Math.max(1e-6,c[i]-c[i-1]),x=a[0]+(b[0]-a[0])*f,yy=a[1]+(b[1]-a[1])*f;
      if(d.kind==='car')s+=`<rect x="${(x-3).toFixed(1)}" y="${(yy-2.2).toFixed(1)}" width="6" height="4.4" rx="1.2" fill="${C.ink}" opacity=".55"/>`;
      else if(d.kind==='metro')s+=`<circle cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="2.8" fill="${C.metro}"/>`;
      else s+=`<circle cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="2.3" fill="${C.walk}"/>`;
      return true;});
    return s;}

  /* -------------------------------------------------------------- the board, in mode 1's style */
  let decorKey='',decorSvg='';
  function decor(){
    const k=C.accent2+C.paper;if(k===decorKey)return decorSvg;
    const hash=(a,b)=>{let h=Math.imul(Math.imul(a|0,73856093)^Math.imul(b|0,19349663)^41234567,2654435761)>>>0;h=(h^(h>>>15))>>>0;return(h%1000)/1000;};
    const busy=new Set();for(const o of [...D.origins,...D.destinations])for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)busy.add(key([o.cell[0]+dx,o.cell[1]+dy]));
    let out='';
    for(let gx=0;gx<D.cols;gx++)for(let gy=0;gy<D.rows;gy++){if(busy.has(key([gx,gy])))continue;
      for(const [ox,oy] of [[-.25,-.2],[.25,.25]]){const h=hash(gx*4+ox*8+7,gy*4+oy*8+11);if(h>.26)continue;const [cx,cy]=xy([gx+ox,gy+oy]);
        const pick=h<.09?TREE:h<.17?BUSH:FLOWER,f=[C.warn,C.bad,C.info][Math.floor(hash(gx,gy)*3)];out+=sprite(pick,cx-5,cy-8,2.2,{g:C.accent2,t:C.ink2,f});}}
    decorKey=k;decorSvg=`<g opacity=".5">${out}</g>`;return decorSvg;}
  function curve(a,b,j){const [x1,y1]=xy(a),[x2,y2]=xy(b),dx=x2-x1,dy=y2-y1,L=Math.hypot(dx,dy)||1,bend=Math.min(50,L*.12)*(j%2?1:-1);
    const cx=(x1+x2)/2-dy/L*bend,cy=(y1+y2)/2+dx/L*bend;return `M${x1} ${y1}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2} ${y2}`;}
  function drawBase(v){
    const y=v.y,placing=!plan.open,ghost=v.mode==='nothing'||v.mode==='today';
    let ground=decor(),want='',lines='',things='',labels='';
    D.land.forEach(q=>{const c=q.cell,[cx,cy]=xy(c),sale=plan.allSales().find(s=>same(s.cell,c)),near=!plan.onLine(c)&&!!plan.stationForLand(c);
      if(plan.onLine(c)&&!sale)return;   // the line runs over it: not land to sell any more, so not drawn as such
      ground+=svg('rect',{x:cx-17,y:cy-17,width:34,height:34,rx:3,fill:sale?(sale.use==='home'?C.info:C.warn):near?C.accent:C.soft,'fill-opacity':sale?0.2:near?0.17:0.08,stroke:sale?(sale.use==='home'?C.info:C.warn):near?C.accent:C.line2,'stroke-width':sale?2:near?2:1.2,'stroke-dasharray':sale?'':'4 3'});});
    // where people go: faint grey lines (thicker = more), the brown part by metro
    rowsOf(y).forEach(({from,to,x},j)=>{const d=curve(from,to,j),w=1+x.go/7,on=sel===j;
      want+=svg('path',{d,fill:'none',stroke:on?C.ink:C.ink3,'stroke-width':w.toFixed(1),'stroke-opacity':on?.45:.16,'stroke-linecap':'round'});
      if(x.metro>.5)want+=svg('path',{d,fill:'none',stroke:C.metro,'stroke-width':(w*x.metro/x.go).toFixed(1),'stroke-opacity':on?.8:.28,'stroke-linecap':'round'});});
    if(placing&&tool==='draw'&&plan.line.length)for(let x=0;x<D.cols;x++)for(let yy=0;yy<D.rows;yy++)if(plan.canExtend([x,yy])){const [cx,cy]=xy([x,yy]);ground+=svg('rect',{x:cx-15,y:cy-15,width:30,height:30,rx:5,fill:'none',stroke:C.metro,'stroke-width':2,'stroke-dasharray':'4 3','stroke-opacity':.8});}
    const dim=v.mode==='nothing';
    for(let s=0;s+1<plan.line.length;s++){const [x1,y1]=xy(plan.line[s]),[x2,y2]=xy(plan.line[s+1]),f=!ghost&&y.cap?y.load[s]/y.cap:0,col=f>1?C.bad:f>.8?C.warn:C.metro;
      lines+=svg('path',{d:`M${x1} ${y1}L${x2} ${y2}`,stroke:col,'stroke-width':dim?3:9,'stroke-linecap':'round','stroke-opacity':dim?.3:.9,'stroke-dasharray':dim?'4 6':''});}
    if(plan.line.length===1){const [x,yy]=xy(plan.line[0]);lines+=svg('circle',{cx:x,cy:yy,r:6,fill:C.metro});}
    if(placing&&tool==='draw')for(const e of [plan.line[0],plan.line.at(-1)])if(e){const [x,yy]=xy(e);things+=svg('circle',{cx:x,cy:yy,r:9,fill:C.panel,stroke:C.metro,'stroke-width':3,'stroke-dasharray':'3 2'});}
    y.est.forEach(e=>{const o=e.origin,[cx,cy]=xy(o.cell),go=e.to.reduce((s,x)=>s+x.go,0),f=go?e.metro/go:0,r=24,L=2*Math.PI*r;
      labels+=sprite(ESTATE,cx-13,cy-19,2.2,{k:C.ink,w:C.paper,l:C.warn,g:C.ink2});
      const up=o.house[1]<0;labels+=text(cx,up?cy-34:cy+38,nameOrigin(e.origin||D.origins[e.i]),13,C.ink,{'text-anchor':'middle','font-weight':600});labels+=text(cx,up?cy-49:cy+53,t('m2.estMetro',{n:R(e.metro)}),11.5,C.accent,{'text-anchor':'middle','font-weight':600});});
    y.dest.forEach(d=>{const o=y.destinations[d.k],[cx,cy]=xy(o.cell),sp=DEST[o.kind],w=sp[0].length*2.6,diff=v.mode==='today'||dim?0:R(d.go-d.before);
      labels+=sprite(sp,cx-w/2,cy-20,2.6,{k:C.ink,w:C.paper,a:DCOL(o.kind),r:C.accent2,p:C.paper,l:C.warn,d:DCOL(o.kind),g:C.ink2});
      const house=o.house||[1,0],sd=house[0]!==0,lx=sd?cx+(house[0]>0?w/2+6:-w/2-6):cx,ly=sd?cy-4:cy-30,la=sd?(house[0]>0?'start':'end'):'middle';
      labels+=svg('text',{x:lx,y:ly,'font-size':13,'text-anchor':la,'font-weight':600,stroke:C.panel,'stroke-width':3.5,'paint-order':'stroke'},`<tspan fill="${C.ink}">${nameD(d.k)}</tspan>`+(diff?`<tspan fill="${diff>0?C.accent:C.bad}"> ${diff>0?'↑+':'↓'}${diff}</tspan>`:''))+
        text(lx,ly+(sd?15:-15),o.kind==='shop'?t('tod.mallDaily',{n:R(d.go)}):t('m2.toCentre',{g:R(d.go),m:R(d.metro)}),11.5,C.accent,{'text-anchor':la,'font-weight':600});});
    if(!dim){const order=plan.stations.map(s=>({s,x:plan.line.findIndex(c=>same(c,s))})).sort((a,b)=>a.x-b.x);
      order.forEach(({s},n)=>{const [x,yy]=xy(s);things+=svg('circle',{cx:x,cy:yy,r:12,fill:C.panel,stroke:C.metro,'stroke-width':4})+svg('text',{x,y:yy+4.5,'font-size':12,'font-weight':700,fill:C.metro,'text-anchor':'middle','font-family':'Geist Mono,monospace'},n+1);});}
    plan.allSales().forEach(s=>{const [cx,cy]=xy(s.cell);things+=sprite(s.use==='home'?HOME:SHOP,cx-12,cy-13,2.3,{k:C.ink,w:C.paper,r:C.warn,a:C.accent,d:C.info});});
    if(v.mode==='landPreview'&&v.cell){const cell=v.use==='shop'?(plan.stationForLand(v.cell)?.s||v.cell):v.cell,[cx,cy]=xy(cell);things+='<g opacity=".45">'+sprite(v.use==='home'?HOME:SHOP,cx-12,cy-13,2.3,{k:C.ink,w:C.paper,r:C.warn,a:C.accent,d:C.info})+'</g>';}
    $('gBase').innerHTML=ground+want+lines+labels+things;
  }
  function drawTop(v){
    let s='';const placing=!plan.open;
    if(hover&&placing){
      const [hx,hy]=xy(hover);
      if(tool==='draw'){
        if(plan.canExtend(hover)){const end=!plan.line.length?null:TOD.adj(hover,plan.line.at(-1))?plan.line.at(-1):plan.line[0];
          if(end)s+=svg('path',{d:'M'+xy(end).join(' ')+'L'+hx+' '+hy,stroke:C.metro,'stroke-width':9,'stroke-opacity':.4,'stroke-linecap':'round'});
          else s+=svg('circle',{cx:hx,cy:hy,r:6,fill:C.metro,'fill-opacity':.45});
          s+=pill(hx,hy-22,t('m.pvExtend',{c:P.lineCost}),C.metro,11.5);}
        else if(plan.canShorten(hover))s+=pill(hx,hy-22,t('m.pvShorten'),C.ink2,11.5);
      }else if(tool==='station'&&plan.onLine(hover)){
        const has=plan.isStation(hover);
        if(!has&&plan.money<P.stationCost)s+=pill(hx,hy-24,t('m.pvNoMoney'),C.bad,11.5);
        else{if(!has)s+=svg('circle',{cx:hx,cy:hy,r:14,fill:'none',stroke:C.metro,'stroke-width':3.5,'stroke-dasharray':'4 3'});
          s+=pill(hx,hy-26,(has?t('m.pvRemove'):t('m.pvAdd'))+' '+t(has?'m.pvRefund':'m.pvCost',{c:P.stationCost}),C.metro,11.5);}
      }
    }
    if(hover&&tool==='land'){
      const [hx,hy]=xy(hover),pending=plan.pendingSales.find(q=>same(q.cell,hover));
      if(pending)s+=pill(hx,hy-25,t('tod.cancel'),C.warn,11);
      else if(plan.canSell(hover)){
        const h=plan.quote(hover,'home'),sh=plan.quote(hover,'shop');
        s+=pill(hx,hy-27,t('tod.priceHome',{n:R(h.price)})+' · '+t('tod.priceShop',{n:R(sh.price)}),C.accent,11.5);
      }else if(D.land.some(q=>same(q.cell,hover)))s+=pill(hx,hy-25,t('tod.unsellable'),C.ink3,10.5);
    }
    $('gTop').innerHTML=s;
  }
  function drawDyn(tm,v){
    let s=stepDots(tm,v.y);
    const order=plan.stations.map(q=>({q,x:plan.line.findIndex(c=>same(c,q))})).sort((a,b)=>a.x-b.x);
    if(order.length>=2&&v.mode!=='nothing'&&v.mode!=='today'){const a=order[0].x,b=order.at(-1).x,span=Math.max(1,b-a);
      for(let k=0;k<plan.trains;k++){const ph=(tm/1000*1.6+k*2*span/plan.trains)%(2*span),pos=a+(ph<span?ph:2*span-ph),i=Math.min(plan.line.length-1,Math.floor(pos)),f=pos-i,c1=plan.line[i],c2=plan.line[Math.min(plan.line.length-1,i+1)];
        const [x1,y1]=xy(c1),[x2,y2]=xy(c2);s+=`<g opacity=".85" transform="translate(${(x1+(x2-x1)*f-21).toFixed(1)} ${(y1+(y2-y1)*f-6.5).toFixed(1)})">`+sprite(TRAIN,0,0,2.2,{m:C.metro,w:C.paper,k:C.ink})+'</g>';}}
    $('gDyn').innerHTML=s;
  }
  // the map and its overlays follow the preview; the side panels only the plan itself
  let baseKey='',sideKey='';
  function draw(force){const v=view();shownDestinations=v.y.destinations||D.destinations;const k=JSON.stringify([planKey(plan),plan.year,v.mode,v.cell,tool,landUse,sel,I.lang,C.paper,!!lastY,hold]);
    if(force||k!==baseKey){baseKey=k;drawBase(v);overlays(v);}
    shownDestinations=v.y.destinations||D.destinations;
    const sk=JSON.stringify([planKey(plan),plan.year,tool,landUse,sel,I.lang,C.paper,hold,playing,history.length,plan.done,!!lastY]);
    if(force||sk!==sideKey){sideKey=sk;side({mode:'plain',y:plan.open&&lastY?lastY:plan.stations.length>=2||plan.open?now():noLine(),aware:avg(plan.awareFor())});}drawTop(v);}

  /* -------------------------------------------------------------- the overlays on the map */
  function overlays(v){
    const y=v.y,n=noLine(),d0=shortD(0),d1=shortD(1),gains=yy=>[0,1].map(k=>signed(yy.dest[k].go-n.dest[k].go));
    $('clock').textContent=plan.open?t('m2.clockYear',{y:plan.year}):t('m2.clockPlan');
    $('wave').textContent=t(plan.open?'m2.clockSubOpen':'m2.clockSub',{m:P.years});$('clockProg').style.width=`${100*plan.year/P.years}%`;
    const newResidents=y.origins.filter(o=>o.home).reduce((a,o)=>a+o.people,0),mallVisitors=y.dest.filter(d=>d.kind==='shop').reduce((a,d)=>a+d.go,0);
    let shownLedger=plan.total+plan.pendingSales.reduce((a,q)=>a+q.price,0);if(v.mode==='landPreview'&&v.quote)shownLedger+=v.quote.price;
    $('hudBus').textContent=R(y.riders);$('hudRail').textContent=R(newResidents);$('hudCar').textContent=R(mallVisitors);$('hudJam').textContent=R(shownLedger);
    let h='',main='',note='';
    if(v.mode==='nothing'){h=t('m2.laneNo');main=t('m2.hlNothing',{d0,d1,a:R(n.dest[0].go),b:R(n.dest[1].go)});note=t('m2.hlNothingSub');}
    else if(v.mode==='landPreview'){h=t('m2.lanePv');main=t('tod.previewLine',{homes:R(plan.quote(v.cell,'home').price),shops:R(plan.quote(v.cell,'shop').price),visitors:R(v.y.dest.filter(d=>d.kind==='shop').reduce((a,d)=>a+d.go,0))});note=t('tod.lockHint');}
    else if(v.mode==='preview'||v.mode==='ahead'){const [a,b]=gains(y);h=t('m2.lanePv');main=t(v.mode==='preview'?'m2.hlPreview':'m2.hlAhead',{r:R(y.riders),d0,d1,a:a.txt,ca:a.cls,b:b.txt,cb:b.cls});note=t('m2.hlPreviewSub',{s:tenth(P.aware.start)});}
    else if(plan.done){const tier=plan.total>=P.masterScore?3:plan.total>=P.highScore?2:plan.total>=P.target?1:0;h=t('m2.laneNow');main=t('m2.hlDone',{s:R(plan.total),tier:t('r.t'+tier)});note=t('m2.hlDoneSub');}
    else if(plan.open&&plan.log.length){
      const l=plan.log.at(-1),prev=plan.log.at(-2),[a,b]=gains(lastY||now()),nx=spread(now(),plan.aware);
      h=t('m2.laneNow');
      if(l.sales&&l.sales.length){
        const groups=new Map();
        l.sales.forEach(s=>{const g=groups.get(s.stationNo)||{no:s.stationNo,homes:0,shops:0,revenue:0};if(s.use==='home')g.homes++;else g.shops++;g.revenue+=s.price;groups.set(s.stationNo,g);});
        main=[...groups.values()].map(g=>t('tod.yearSales',{station:t('tod.stationLabel',{n:g.no}),homes:g.homes,shops:g.shops,revenue:R(g.revenue)})).join(' · ');
      }else{
        const mall=(lastY||now()).dest.find(d=>d.kind==='shop');
        main=mall?t('tod.mallSentence',{name:t('tod.shopName',{n:mall.stationNo}),n:R(mall.go)}):
          t('m2.hlYear',{y:l.year,r:R(l.riders),d:signed(l.riders-(prev?prev.riders:0)).txt,d0,d1,a:a.txt,ca:a.cls,b:b.txt,cb:b.cls});
      }
      if(plan.pendingSales.length){
        const homes=plan.pendingSales.filter(s=>s.use==='home').length,shops=plan.pendingSales.filter(s=>s.use==='shop').length;
        main+=' · '+t('tod.pendingSentence',{homes,shops,revenue:R(plan.pendingSales.reduce((s,q)=>s+q.price,0))});
      }
      const more=plan.done?0:Math.max(0,tenth(avg(nx))-tenth(avg(plan.aware)));
      note=more?t('m2.hlYearSub',{a:tenth(avg(plan.aware)),n:more}):t('m2.hlYearSub0',{a:tenth(avg(plan.aware))});
    }
    else if(v.mode==='plan'){
      const [a,b]=gains(y);h=t('m2.laneNow');
      main=t('m2.hlYear',{y:1,r:R(y.riders),d:signed(y.riders).txt,d0,d1,a:a.txt,ca:a.cls,b:b.txt,cb:b.cls});
      if(plan.pendingSales.length){
        const homes=plan.pendingSales.filter(s=>s.use==='home').length,shops=plan.pendingSales.filter(s=>s.use==='shop').length;
        main+=' · '+t('tod.pendingSentence',{homes,shops,revenue:R(plan.pendingSales.reduce((s,q)=>s+q.price,0))});
      }
      note=t('m2.hlPreviewSub',{s:tenth(P.aware.start)});
    }
    else{h=t('m2.laneNow');main=t('m2.hlToday',{d0,d1,a:R(n.dest[0].go),b:R(n.dest[1].go)});note=t('m2.hlTodaySub');}
    $('laneH').textContent=h;$('mapHint').innerHTML=main;
    if(!(flash&&performance.now()<flash.until))$('notice').innerHTML=note;
  }
  function say(html){flash={until:performance.now()+2500};$('notice').innerHTML=html;}

  /* -------------------------------------------------------------- the side panels */
  function side(v){
    const y=v.y,nowY=now(),hi=R(P.masterScore*1.12),at=q=>Math.max(0,Math.min(100,100*q/hi)),pendingRevenue=plan.pendingSales.reduce((a,q)=>a+q.price,0),shownScore=plan.total+pendingRevenue;
    $('score').textContent=R(shownScore);$('goalMax').textContent=P.masterScore;$('scoreBar').style.width=`${at(shownScore)}%`;
    for(const [id,q,k] of [['tickPass',P.target,'g.tickPass'],['tickHigh',P.highScore,'g.tickHigh'],['tickMaster',P.masterScore,'g.tickMaster']]){$(id).style.left=`${at(q)}%`;$(id).dataset.label=t(k,{n:q});}
    $('run').textContent=plan.done?t('m.runDone'):plan.open?(playing?t('m.playing'):t('m.runN',{n:plan.year+1})):t('m2.run0');$('run').disabled=playing||(!plan.done&&!plan.canRun());
    $('pause').textContent=playing?t('m.pause'):t('m.play');$('pause').disabled=!plan.open||plan.done;
    $('hold').textContent=plan.open?t('m2.holdNothing2'):t('m2.holdAhead2');$('hold').disabled=!plan.open&&plan.stations.length<2;$('hold').classList.toggle('on',hold);
    $('rewind').disabled=!plan.open;
    $('money').textContent=`${plan.money} / ${P.budget}`;
    const cards=[['draw',t('m2.cardLine'),t('m2.cardLineN',{n:plan.line.length})],['station',t('m2.cardStation'),t('m2.cardStationN',{n:plan.stations.length})],['land',t('m2.cardTrain'),t('m2.cardTrainN',{n:plan.allSales().length})]];
    $('stations').innerHTML=cards.map(([k,n,s])=>'<button class="station-button '+(tool===k?'selected':'')+'" data-card="'+k+'" aria-pressed="'+(tool===k)+'" '+(plan.open&&k!=='land'?'disabled':'')+'><b>'+n+'</b><small>'+s+'</small></button>').join('');
    const pot=plan.stations.length>=2?cached('pot'+planKey(plan),()=>plan.potential()):null;
    const hint=tool==='land'?t('tod.landHint'):plan.open?t('m.hintOpen'):tool==='draw'?(plan.line.length?t('m.hintDraw2'):t('m.hintDraw1')):tool==='station'?(plan.line.length<2?t('m.hintNeedLine'):plan.stations.length<2?t('m.hintStation1'):t('m.hintStation2')):t('m.trains',{n:plan.trains,c:plan.trains*P.perTrain});
    $('stopPanel').innerHTML=`<h3><span>${t('m2.spTitle')}</span><span class="lbl">${t('tod.landTitle')}</span></h3>`+
      `<div class="r"><span>${t('m2.spLine')}</span><b>${t('m2.cells',{n:plan.line.length})}</b></div>`+
      `<div class="r"><span>${t('m2.spStations')}</span><b>${t('m2.count',{n:plan.stations.length})}</b></div>`+
      `<div class="r"><span>${t('m2.spTrains')}</span><span class="pm"><button class="btn btn-sm" id="trainMinus" ${plan.canUntrain()?'':'disabled'}>−</button><b class="c">${plan.trains}</b><button class="btn btn-sm" id="trainPlus" ${plan.canTrain()?'':'disabled'}>＋</button></span></div>`+
      `<div class="r"><span>${t('m2.spRoom')}</span><b>${t('m2.peopleN',{n:plan.trains*P.perTrain})}</b></div>`+
      `<div class="r"><span>${t('m2.spLeft')}</span><b>${plan.money}</b></div>`+
      (pot?`<div class="r"><span>${t('m2.spRiders')}</span><b>${t('m2.peopleN',{n:R(nowY.riders)})}</b></div><div class="r"><span>${t('m2.spPot')}</span><b>${t('m2.peopleN',{n:R(pot.riders)})}</b></div>`:'')+
      `<div class="tools"><div class="seg" id="toolSeg" role="group"><button data-tool="draw" aria-pressed="${tool==='draw'}" ${plan.open?'disabled':''}>${t('m.toolDraw')}</button><button data-tool="station" aria-pressed="${tool==='station'}" ${plan.open?'disabled':''}>${t('m.toolStation')}</button><button data-tool="land" aria-pressed="${tool==='land'}" ${plan.done?'disabled':''}>${t('tod.toolLand')}</button></div>`+
      `<button class="btn btn-sm" id="undo" ${!history.length?'disabled':''}>↶</button><button class="btn btn-sm" id="clear" ${plan.open||!plan.line.length?'disabled':''}>${t('m.clear')}</button></div><p>${hint}</p>`;
    const heldRevenue=plan.sales.reduce((a,q)=>a+q.price,0),pendingRevenueNow=plan.pendingSales.reduce((a,q)=>a+q.price,0);
    $('stopPanel').insertAdjacentHTML(tool==='land'?'afterbegin':'beforeend','<div class="land-controls"><div class="r"><span>'+t('tod.landCount',{left:Math.max(0,2-plan.pendingSales.length),sold:plan.allSales().length})+'</span></div><div class="r"><span>'+t('tod.landRevenue')+'</span><b>'+t('tod.landRevenueValue',{n:R(heldRevenue),p:R(pendingRevenueNow)})+'</b></div><div class="tools"><button class="btn btn-sm '+(landUse==='home'?'on':'')+'" data-use="home">'+t('tod.useHome')+'</button><button class="btn btn-sm '+(landUse==='shop'?'on':'')+'" data-use="shop">'+t('tod.useShop')+'</button></div><p>'+t('tod.lockHint')+'</p></div>');
    // the years table
    $('yearChip').textContent=t('m2.yearChip',{m:P.years});
    let tb='<thead><tr><th>'+t('tod.year')+'</th><th>'+t('tod.riders')+'</th><th>'+t('tod.sales')+'</th><th>'+t('tod.ledger')+'</th></tr></thead><tbody>';
    for(let k=1;k<=P.years;k++){const l=plan.log[k-1],next=k===plan.year+1&&!plan.done,yy=!l&&next&&plan.stations.length>=2?nowY:null;
      tb+='<tr class="'+(l?'past ':'')+(next?'now next':'')+'"><td>'+t('m.yShort',{y:k})+'</td>'+(l?'<td><b>'+R(l.riders)+'</b></td><td><b>'+R(l.revenue)+'</b></td><td><b>'+R(l.ledger)+'</b></td>':yy?'<td><b>'+R(yy.riders)+'</b></td><td><b>'+R(pendingRevenue)+'</b></td><td><b>'+R(plan.total+pendingRevenue+yy.riders)+'</b></td>':'<td></td><td></td><td></td>')+'</tr>';}
    $('tide').innerHTML=tb+'</tbody>';$('tideKey').innerHTML=t('m2.tideKey',{d0:shortD(0),d1:shortD(1)});
    const sales=plan.allSales();
    let w=y.dest.filter(d=>d.kind==='shop').map(d=>'<div class="rd"><span class="n">'+t('tod.shopName',{n:d.stationNo})+'</span><b>'+t('tod.mallDaily',{n:R(d.go)})+'</b></div>').join('');
    w+=sales.map(q=>'<div class="rd"><span class="n">'+(q.use==='home'?t('tod.soldHome'):t('tod.soldShop'))+' · '+t('tod.lot',{n:q.landIndex})+'</span><b>'+R(q.price)+'</b><small>'+(plan.pendingSales.includes(q)?t('tod.pending'):t('tod.locked'))+'</small></div>').join('');
    if(!w)w='<p class="note">'+t('tod.noSales')+'</p>';
    $('roadBox').innerHTML=w+'<p class="note" style="margin:6px 0 2px;font-size:11.5px">'+t('m2.whereNote2')+'</p>';
    let trs=`<thead><tr><th>${t('m.tTrip')}</th><th>${t('m.tGo')}</th><th>${t('m.tAlt')}</th><th>${t('m.tMetro')}</th><th>${t('m.tSave')}</th><th>${t('m.tRiders')}</th></tr></thead><tbody>`;
    rowsOf(y).forEach(({x,who,chain},k)=>{trs+=`<tr data-row="${k}"><td>${who}<small>→ ${shortD(x.k)}${chain?' · '+t('m.chainTag'):''}</small></td><td>${R(x.go)}<small>${t('m.was',{b:R(x.before)})}</small></td><td>${x.alt}<small>${t(x.byFoot?'m.byFoot':'m.byCar')}</small></td>`+
      `<td>${x.trip?x.trip.blocks:'—'}</td><td>${x.trip?x.save:''}</td><td><b>${x.metro>=1?R(x.metro):''}</b></td></tr>`;});
    $('trips').innerHTML=trs+'</tbody>';
  }
  function render(){draw(true);}
  function fit(){$('board').setAttribute('viewBox',`0 0 ${VBW} ${VBH}`);}
  function texts(){
    $('goal').innerHTML=t('m.goal',{pass:P.target,high:P.highScore,master:P.masterScore});
    const v={st:P.stay,wp:P.walkPer,w:P.wait,lc:P.lineCost,sc:P.stationCost,tc:P.trainCost,pt:P.perTrain,b:P.budget,y:P.years,s:tenth(P.aware.start),cb:P.crowdBlocks,nb:P.nearby,
      sp:P.aware.spread,a0:D.destinations[0].attraction,a1:D.destinations[1].attraction,e0:D.destinations[0].carExtra??2,e1:D.destinations[1].carExtra??2,d0:shortD(0),d1:shortD(1),
      hp:P.homePeople,sb:P.shopBase,spc:P.shopPer,ce:P.carExtra,hr:P.homeRate,sr:P.shopRate};
    $('rules').innerHTML=['m2.rule1','m2.rule2','m2.rule3'].map(k=>`<li>${t(k,v)}</li>`).join('');
    $('infoBody').innerHTML=t('tod.fullRules',v);$('ivBody').innerHTML=t('iv.m4.body',v);
    $('mapLegend').innerHTML=t('m2.legend2');document.title=t('m.doc');
  }

  /* -------------------------------------------------------------- the years */
  function step(){
    if(plan.done){stop();return;}
    const r=plan.runYear();if(!r)return stop();
    lastY=r.y;render();if(plan.done){stop();setTimeout(result,STEP_MS);}
  }
  function play(){if(plan.done)return;playing=true;clearInterval(timer);timer=setInterval(step,STEP_MS);render();}
  function stop(){playing=false;clearInterval(timer);render();}
  // one year at a time (no autoplay): land is sold between the years
  function open(){if(!plan.canRun())return;history=[];tool='land';hover=null;step();}
  function rewind(){stop();plan.rewind();lastY=null;render();}
  function result(){
    const tier=plan.total>=P.masterScore?3:plan.total>=P.highScore?2:plan.total>=P.target?1:0,pot=plan.potential();if(window.TLProgress)TLProgress.record(4,D.map,plan.total,[P.target,P.highScore,P.masterScore]);if(window.TL_SAVE)TL_SAVE.clearIf(4,D.map);
    $('result').classList.toggle('win',tier>0);$('resultTitle').textContent=t('r.t'+tier);$('resultEn').textContent=['Try again','Cleared','High score','Master'][tier];
    $('resultScore').textContent=t('m.rScore',{d:R(plan.total),y:P.years});
    let h='<table class="result"><thead><tr><th>'+t('tod.year')+'</th><th>'+t('tod.riders')+'</th><th>'+t('tod.sales')+'</th><th>'+t('tod.ledger')+'</th></tr></thead><tbody>';
    for(const l of plan.log)h+='<tr><td>'+t('m.yShort',{y:l.year})+'</td><td>'+R(l.riders)+'</td><td>'+R(l.revenue)+'</td><td>'+R(l.ledger)+'</td></tr>';    h+='</tbody></table>';
    const last=plan.log.at(-1),tips=[];
    last.dest.forEach((d,k)=>{const diff=R(d.go-d.before);if(diff)tips.push(t(diff>0?'m.tipGrow':'m.tipShrink',{d:nameD(k),b:R(d.before),g:R(d.go),m:R(d.metro),n:Math.abs(diff)}));});
    const crowdYears=plan.log.filter(l=>l.crowdedSections).length;if(crowdYears)tips.push(t('m.tipCrowd',{n:crowdYears,cb:P.crowdBlocks}));
    D.origins.forEach((o,i)=>{if(last.after[i]<=P.aware.start+.001)tips.push(t('m.tipNever',{a:nameO(i),y:P.years,s:tenth(P.aware.start)}));});
    if(last.riders<pot.riders*.9)tips.push(t('m.tipSlow',{r:R(last.riders),p:R(pot.riders)}));
    $('resultBody').innerHTML=h+`<ul class="ivlist">${tips.slice(0,5).map(s=>`<li>${s}</li>`).join('')}</ul>`;
    try{const k='tl-best-tod-'+D.map;if(plan.total>(+localStorage.getItem(k)||0))localStorage.setItem(k,R(plan.total));}catch(e){}
    window.dispatchEvent(new CustomEvent('tl:result',{detail:{game:'feeder',mode:'m4-tod',version:'7.11',map:D.map,score:R(plan.total),tier,tiers:[P.target,P.highScore,P.masterScore],line:plan.line,stations:plan.stations,trains:plan.trains,lang:I.lang}}));
    $('result').showModal();
  }

  /* -------------------------------------------------------------- controls */
  const board=$('board');
  function cellAt(e){const pt=board.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;const p=pt.matrixTransform(board.getScreenCTM().inverse());
    const c=[Math.round((p.x-MX)/CS),Math.round((p.y-MY)/CS)];return c[0]>=0&&c[1]>=0&&c[0]<D.cols&&c[1]<D.rows?c:null;}
  function act(c){
    if(tool==='land'){
      const pending=plan.pendingSales.find(q=>same(q.cell,c));
      if(pending){snapshot();plan.cancelSale(c);return true;}
      if(!plan.canSell(c)){say(t(plan.pendingSales.length>=2?'tod.maxSales':'tod.unsellable'));return false;}
      snapshot();const sale=plan.sellLand(c,landUse);if(sale)say(t('tod.saleToast',{kind:landUse==='home'?t('tod.soldHome'):t('tod.soldShop'),price:R(sale.price)}));return !!sale;
    }
    if(plan.open){say(`<b>${t('m.cardLocked')}</b> ${t('m.cardLocked2')}`);return false;}
    if(tool==='draw'){
      if(plan.canExtend(c)){snapshot();plan.extend(c);return true;}
      if(plan.canShorten(c)){snapshot();plan.shorten(c);return true;}
      return false;}
    if(tool!=='station'||!plan.onLine(c))return false;
    if(!plan.isStation(c)&&plan.money<P.stationCost){say(t('m.pvNoMoney'));return false;}
    snapshot();plan.toggleStation(c);return true;
  }
  board.onpointerdown=e=>{const c=cellAt(e);if(!c)return;drag=tool==='draw'&&!plan.open;if(act(c))render();if(drag)board.setPointerCapture(e.pointerId);};
  board.onpointermove=e=>{const c=cellAt(e);
    if(drag&&c&&plan.canExtend(c)){snapshot();plan.extend(c);hover=null;render();return;}
    if(JSON.stringify(c)!==JSON.stringify(hover)){hover=c;draw();}};
  board.onpointerup=()=>{drag=false;};
  board.onpointerleave=()=>{if(!drag&&hover){hover=null;draw();}};
  $('stations').onclick=e=>{const b=e.target.closest('[data-card]');if(b&&(!plan.open||b.dataset.card==='land')){tool=b.dataset.card;hover=null;render();}};
  $('stopPanel').onclick=e=>{const use=e.target.closest('[data-use]');if(use){landUse=use.dataset.use;render();return;}
    const tb=e.target.closest('[data-tool]');if(tb&&(!plan.open||tb.dataset.tool==='land')){tool=tb.dataset.tool;hover=null;render();return;}
    const id=e.target.closest('button')?.id;if(!id)return;
    if(id==='trainPlus'){snapshot();if(plan.addTrain())render();}else if(id==='trainMinus'){snapshot();if(plan.removeTrain())render();}
    else if(id==='undo'){const s=history.pop();if(s){restore(s);render();}}else if(id==='clear'){if(plan.open||!plan.line.length)return;snapshot();plan.clear();tool='draw';render();}};
  $('run').onclick=()=>{if(plan.done)result();else if(!plan.open)open();else step();};
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
    if(e.key==='1'&&!plan.open){tool='draw';render();}else if(e.key==='2'&&!plan.open){tool='station';render();}else if(e.key==='3'&&!plan.done){tool='land';render();}
    else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();const s=history.pop();if(s&&!plan.open){restore(s);render();}}
    else if(e.code==='Space'&&plan.open&&!plan.done&&!e.target.closest?.('button')){e.preventDefault();$('pause').click();}
    else if(e.key==='Escape'&&sel>=0){sel=-1;render();}});
  function setTheme(th){document.documentElement.setAttribute('data-theme',th);$('thPaper').setAttribute('aria-pressed',String(th==='light'));$('thInk').setAttribute('aria-pressed',String(th==='dark'));
    try{localStorage.setItem('tl-theme',th);}catch(e){}readTokens();decorKey='';render();}
  $('thPaper').onclick=()=>setTheme('light');$('thInk').onclick=()=>setTheme('dark');
  window.addEventListener('tl:lang',()=>{texts();render();});
  let lastFrame=0;(function loop(tm){if(tm-lastFrame>33){drawDyn(tm,view());lastFrame=tm;}requestAnimationFrame(loop);})(0);
  // test hook: #intro=0&line=2,2;3,2;4,2&stations=2,2;4,2&trains=2&years=3&tool=station&sel=0&theme=dark&lang=en&hover=9,5&hold=1
  const q=new URLSearchParams(location.hash.slice(1));
  let saved=null;try{saved=localStorage.getItem('tl-theme');}catch(e){}
  fit();
  if(q.get('theme')||saved)setTheme(q.get('theme')||saved);
  if(q.get('line'))for(const s of q.get('line').split(';'))plan.extend(s.split(',').map(Number));
  if(q.get('stations'))for(const s of q.get('stations').split(';'))plan.toggleStation(s.split(',').map(Number));
  for(let k=1;k<+(q.get('trains')||1);k++)plan.addTrain();
  for(let k=0;k<+(q.get('years')||0);k++){const r=plan.runYear();if(r)lastY=r.y;}
  if(q.get('tool'))tool=q.get('tool');if(q.get('sel'))sel=+q.get('sel');if(q.get('hover'))hover=q.get('hover').split(',').map(Number);if(q.get('hold'))hold=true;
  texts();render();
  if(q.get('intro')!=='0'&&!q.get('line'))$('lvIntro').showModal();
  const api={reset(){stop();plan=new Plan();history=[];sel=-1;tool='draw';hover=null;lastY=null;render();},
    extend(c){const ok=plan.extend(c);render();return ok;},station(c){tool='station';const ok=plan.toggleStation(c);render();return ok;},
    train(){const ok=plan.addTrain();render();return ok;},go(){open();},halt(){stop();},get plan(){return plan;}};
    // a round left half-played is kept (shared/save.js) and picked up here, year and all
  window.TL_SAVESTATE=()=>({key:D.map,year:plan.year,state:{plan:JSON.parse(JSON.stringify(plan))}});
  if(window.TL_SAVE&&TL_SAVE.restoreFor(4,D.map,st=>{Object.assign(plan,st.plan);history=[];lastY=plan.year>0?plan.now():null;}))render();
  // For the hub's hand-off (shared/flyin.js): this board's blocks in screen pixels — the vacant land and the lines people wish for grey, the estates and the
  // places people go dark — so the hub's dots land on this level's own map.
  window.TL_BOARD={targets(){const m=board.getScreenCTM();if(!m)return null;
    const k=Math.hypot(m.a,m.b),at=(x,y)=>[m.a*x+m.c*y+m.e,m.b*x+m.d*y+m.f],items=[],tok=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const road=tok('--s-road')||'#EEEAE1',faint=tok('--s-ink3')||'#9A9A9A',dark=tok('--s-ink')||'#0A0A0A';
    for(const q of D.land||[]){if(plan.onLine(q.cell))continue;const [x,y]=xy(q.cell);items.push({p:at(x,y),w:30*k,h:30*k,color:road,kind:'road'});}
    for(const o of D.origins)for(const d of D.destinations){const [x1,y1]=xy(o.cell),[x2,y2]=xy(d.cell),n=Math.max(2,Math.round(Math.hypot(x2-x1,y2-y1)/(CS*.5)));
      for(let i=1;i<n;i++)items.push({p:at(x1+(x2-x1)*i/n,y1+(y2-y1)*i/n),w:6*k,h:6*k,color:faint,kind:'road'});}
    for(const o of D.origins){const [x,y]=xy(o.cell);items.push({p:at(x,y-3),w:26*k,h:30*k,color:dark,kind:'house'});}
    for(const d of D.destinations){const [x,y]=xy(d.cell);items.push({p:at(x,y-3),w:30*k,h:32*k,color:dark,kind:'house'});}
    const c=D.destinations[0]?xy(D.destinations[0].cell):xy([D.cols>>1,D.rows>>1]);return{items,hub:at(c[0],c[1]-3),k};}};
  window.TL_TOD={api,plan:()=>({line:plan.line.map(c=>c.slice()),stations:plan.stations.map(c=>c.slice()),year:plan.year,money:plan.money,trains:plan.trains,total:plan.total,done:plan.done,playing,riders:now().riders,dots:dots.length}),
    cellXY:c=>{const m=board.getScreenCTM(),[x,y]=xy(c);return[m.a*x+m.c*y+m.e,m.b*x+m.d*y+m.f];}};
})();

