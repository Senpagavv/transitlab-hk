(()=>{
  'use strict';
  // v7 · mode 3 «roads that jam» — the page, a living map. Every estate sends people out all the time: grey cars
  // crawl along the roads (slower where they jam), brown dots walk to a station and ride, light dots walk. Hover a
  // cell on your line and the whole map turns into what a station there would bring (everybody knowing it, drivers
  // settled); hold the eye button to see eight years on — or, once open, what doing nothing would look like.
  const {Plan,D,P,G,year,spread,walk,same,key}=Roads,$=id=>document.getElementById(id),I=window.I18N,t=(k,v)=>I.t(k,v);
  const CS=56,MX=56,MY=96,STEP_MS=2600,DAY_S=7,PER_DOT=1,MAX_DOTS=640;
  const xy=c=>[MX+c[0]*CS,MY+c[1]*CS];
  const svg=(tag,a,c='')=>`<${tag} ${Object.entries(a).map(([k,v])=>`${k}="${v}"`).join(' ')}>${c}</${tag}>`;
  let C={};
  function readTokens(){const s=getComputedStyle(document.documentElement),v=n=>s.getPropertyValue('--s-'+n).trim();
    C={paper:v('paper'),panel:v('panel'),soft:v('soft'),raise:v('raise'),ink:v('ink'),ink2:v('ink2'),ink3:v('ink3'),line:v('line'),line2:v('line2'),accent:v('accent'),accent2:v('accent2'),
      warn:v('warn'),bad:v('bad'),info:v('info'),metro:v('metro'),walk:v('walk'),jam:v('jam'),free:v('free')};}
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
  const TRAIN=[".mmmmmmmmmmmmmmmmm.","mmwwmmwwmmwwmmwwmmm","mmwwmmwwmmwwmmwwmmm","mmmmmmmmmmmmmmmmmmm","mkkmmmmmmmmmmmmkkmm","..k.............k.."];
  const DEST={town:TOWN,jobs:OFFICE},DCOL=k=>({town:C.warn,jobs:C.info})[k];
  const nm=o=>I.lang==='zh-Hans'?(o.hans||o.name):(o.name);
  const nameO=i=>nm(D.origins[i]),nameD=k=>nm(D.destinations[k]),shortD=k=>{const d=D.destinations[k];return I.lang==='zh-Hans'?(d.shortHans||d.hans):(d.short||d.name);};
  const shortO=i=>{const o=D.origins[i];return I.lang==='zh-Hans'?(o.shortHans||o.hans):(o.short||o.name);};
  const roadName=r=>{const d=D.roads.find(x=>x.name===r);return d?nm(d):r;};
  const R=Math.round,f1=v=>(Math.round(v*10)/10).toFixed(1),tenth=a=>R(a*10);
  const pct=(a,b)=>{const v=b?R(100*(a-b)/b):0;return{txt:(v>0?'+':v<0?'−':'±')+Math.abs(v)+'%',cls:v<0?'good':v>0?'bad':''};};
  const jamCol=e=>e<.25?C.ink3:e<1?'#E3A008':C.jam;
  // roads sit a little off the cell centres (beside the railways that share their cells)
  const OFF=7,rxy=(s,c)=>{const [x,y]=xy(c),h=s.a[1]===s.b[1];return h?[x,y+OFF]:[x+OFF,y];};
  let plan=new Plan(),tool='draw',hover=null,sel=-1,drag=false,history=[],playing=false,timer=0,hold=false,lastY=null,flash=0;
  const VBW=MX*2+(D.cols-1)*CS+80,VBH=MY+56+(D.rows-1)*CS;
  function snapshot(){history.push(JSON.stringify({...plan}));if(history.length>200)history.shift();}
  function restore(s){const p=new Plan();Object.assign(p,JSON.parse(s));plan=p;}
  const planKey=p=>JSON.stringify([p.line,p.stations,p.trains]);
  const memo=new Map();function cached(k,f){if(!memo.has(k)){if(memo.size>60)memo.clear();memo.set(k,f());}return memo.get(k);}
  function now(){return cached('now'+planKey(plan)+plan.year+JSON.stringify(plan.aware),()=>plan.now());}
  // what the map shows: this year, a preview (a station toggled here, or the whole plan settled), or doing nothing
  function view(){
    if(hold&&plan.open)return{mode:'nothing',y:G.base};
    if(!plan.open){
      if(tool==='station'&&hover&&plan.onLine(hover)&&(plan.isStation(hover)||plan.money>=P.stationCost)){
        const q=new Plan();Object.assign(q,JSON.parse(JSON.stringify({...plan})));q.toggleStation(hover);
        if(q.stations.length>=2)return{mode:'preview',y:cached('pot'+planKey(q),()=>q.potential()),cell:hover};}
      if(hold&&plan.stations.length>=2)return{mode:'ahead',y:cached('pot'+planKey(plan),()=>plan.potential())};
      return{mode:'today',y:now()};}
    return{mode:'year',y:lastY||now()};
  }
  const rowsOf=y=>[...y.est.flatMap(e=>e.to.map(x=>({from:D.origins[e.i].cell,to:D.destinations[x.k].cell,x,who:shortO(e.i),e}))),
    ...(y.chain||[]).map(q=>({from:D.destinations[q.a].cell,to:D.destinations[q.b].cell,x:q,who:shortD(q.a),chain:true}))];
  function roadStats(y,per){return D.roads.map(r=>{const ids=G.sections.filter(s=>s.roads.includes(r.name)).map(s=>s.id);
    const worst=ids.reduce((b,id)=>y.extra[id]>y.extra[b]?id:b,ids[0]);
    return{name:r.name,ids,worst,extra:y.extra[worst],felt:Math.max(...ids.map(id=>per[id])),base:Math.max(...ids.map(id=>G.base.extra[id])),cars:y.roadLoad[worst],cap:G.sections[worst].cap};});}

  /* -------------------------------------------------------------- the moving people */
  // paths in board coordinates with a speed for every leg (px a second): cars slow down by 1 + the jam on a section
  const V={walk:34,car:95,rail:190};
  function carPath(route,from,to,y){
    const pts=[xy(from)],sp=[];
    if(route&&route.sections.length){const secs=route.sections.map(id=>G.sections[id]);
      let cur=secs.length>1?(same(secs[0].a,secs[1].a)||same(secs[0].a,secs[1].b)?secs[0].b:secs[0].a):(walk(secs[0].a,from)<=walk(secs[0].b,from)?secs[0].a:secs[0].b);
      pts.push(rxy(secs[0],cur));sp.push(V.car);
      for(const s of secs){const nx=same(s.a,cur)?s.b:s.a;pts.push(rxy(s,nx));sp.push(V.car/(1+(y.extra[s.id]||0)));cur=nx;}}
    pts.push(xy(to));sp.push(V.car);return{pts,sp};}
  function railCells(name){return name==='new'?plan.line:(G.lines.find(l=>l.name===name)||{cells:[]}).cells;}
  function metroPath(trip,from,to){
    const pts=[xy(from)],sp=[];
    trip.legs.forEach((l,j)=>{const cells=railCells(trip.lines[j]),step=l.to>=l.from?1:-1;
      pts.push(xy(cells[l.from]));sp.push(V.walk);
      for(let i=l.from+step;step>0?i<=l.to:i>=l.to;i+=step){pts.push(xy(cells[i]));sp.push(V.rail);}});
    pts.push(xy(to));sp.push(V.walk);return{pts,sp};}
  function walkPath(from,to){return{pts:[xy(from),xy(to)],sp:[V.walk]};}
  function timed(p){const cum=[0];for(let i=1;i<p.pts.length;i++){const [a,b]=[p.pts[i-1],p.pts[i]];cum.push(cum[i-1]+Math.hypot(b[0]-a[0],b[1]-a[1])/p.sp[i-1]);}return{...p,cum,T:cum.at(-1)};}
  // every flow of the shown year: who, how many a day, which way
  const flowMemo=new WeakMap();
  function flowsOf(y){if(flowMemo.has(y))return flowMemo.get(y);const out=[];
    const add=(id,kind,n,mk)=>{if(n>.3)out.push({id,kind,n,mk});};
    const one=(id,x,from,to)=>{add(id+'c','car',x.drivers,()=>carPath(x.route,from,to,y));
      if(x.tNew)add(id+'n','metro',x.knowGo*x.tenthsNew/10,()=>metroPath(x.tNew,from,to));
      if(x.tOld)add(id+'o','metro',x.dontGo*x.tenthsOld/10,()=>metroPath(x.tOld,from,to));
      add(id+'w','walk',x.walkers,()=>walkPath(from,to));};
    y.est.forEach(e=>e.to.forEach(x=>one(`e${e.i}k${x.k}`,x,D.origins[e.i].cell,D.destinations[x.k].cell)));
    (y.chain||[]).forEach(q=>one(`d${q.a}${q.b}`,q,D.destinations[q.a].cell,D.destinations[q.b].cell));
    flowMemo.set(y,out);return out;}
  let dots=[],acc={},lastT=0;
  function stepDots(tm,y){
    const dt=Math.min(.12,Math.max(0,(tm-lastT)/1000));lastT=tm;
    for(const f of flowsOf(y)){acc[f.id]=(acc[f.id]??Math.random())+f.n/PER_DOT/DAY_S*dt;
      while(acc[f.id]>=1&&dots.length<MAX_DOTS){acc[f.id]-=1;if(!f.path)f.path=timed(f.mk());dots.push({p:f.path,kind:f.kind,t:0});}
      if(acc[f.id]>=1)acc[f.id]=0;}
    let s='';dots=dots.filter(d=>{d.t+=dt;if(d.t>=d.p.T)return false;const c=d.p.cum;let i=1;while(i<c.length-1&&c[i]<d.t)i++;
      const a=d.p.pts[i-1],b=d.p.pts[i],f=(d.t-c[i-1])/Math.max(1e-6,c[i]-c[i-1]),x=a[0]+(b[0]-a[0])*f,yy=a[1]+(b[1]-a[1])*f;
      if(d.kind==='car')s+=`<rect x="${(x-3.5).toFixed(1)}" y="${(yy-2.5).toFixed(1)}" width="7" height="5" rx="1.5" fill="${C.ink}" opacity=".72"/>`;
      else if(d.kind==='metro')s+=`<circle cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="3.2" fill="${C.metro}"/>`;
      else s+=`<circle cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="2.6" fill="${C.walk}"/>`;
      return true;});
    return s;}

  /* -------------------------------------------------------------- the board */
  function drawBase(v){
    const y=v.y,placing=!plan.open;
    let ground='',roads='',rails='',lines='',things='',labels='';
    const water=new Set((D.water||[]).map(key));
    for(let x=0;x<D.cols;x++)for(let yy=0;yy<D.rows;yy++){const [cx,cy]=xy([x,yy]),can=placing&&tool==='draw'&&plan.canExtend([x,yy])&&plan.line.length>0,wet=water.has(key([x,yy]));
      ground+=svg('rect',{x:cx-CS/2+2,y:cy-CS/2+2,width:CS-4,height:CS-4,rx:4,fill:can?C.metro:wet?C.info:C.soft,'fill-opacity':can?.10:wet?.10:.45,stroke:can?C.metro:wet?'none':C.line,'stroke-opacity':can?.45:.7,'stroke-dasharray':can?'4 3':''});}
    G.sections.forEach(s=>{const [x1,y1]=rxy(s,s.a),[x2,y2]=rxy(s,s.b),e=y.extra[s.id],w=5+Math.min(7,s.cap/10);
      roads+=svg('path',{d:`M${x1} ${y1}L${x2} ${y2}`,stroke:jamCol(e),'stroke-width':w.toFixed(1),'stroke-opacity':e<.25?.3:.55,'stroke-linecap':'round'});});
    G.lines.forEach(l=>{rails+=svg('path',{d:'M'+l.cells.map(c=>xy(c).join(' ')).join('L'),fill:'none',stroke:l.color,'stroke-width':5,'stroke-linejoin':'round','stroke-linecap':'round','stroke-opacity':.75});
      l.stations.forEach(s=>{const [x,yy]=xy(s);rails+=svg('circle',{cx:x,cy:yy,r:5.5,fill:C.panel,stroke:l.color,'stroke-width':2.5});});});
    const mine=y.lines.find(l=>l.isNew),ghost=v.mode==='nothing';
    for(let s=0;s+1<plan.line.length;s++){const [x1,y1]=xy(plan.line[s]),[x2,y2]=xy(plan.line[s+1]),f=mine&&mine.load[s]!==undefined?mine.load[s]/mine.cap:0,col=f>1?C.bad:f>.8?C.warn:C.metro;
      lines+=svg('path',{d:`M${x1} ${y1}L${x2} ${y2}`,stroke:col,'stroke-width':ghost?4:10,'stroke-linecap':'round','stroke-opacity':ghost?.25:.9,'stroke-dasharray':ghost?'4 6':''});}
    if(plan.line.length===1){const [x,yy]=xy(plan.line[0]);lines+=svg('circle',{cx:x,cy:yy,r:7,fill:C.metro});}
    if(placing&&tool==='draw')for(const e of [plan.line[0],plan.line.at(-1)])if(e){const [x,yy]=xy(e);things+=svg('circle',{cx:x,cy:yy,r:9,fill:C.panel,stroke:C.metro,'stroke-width':3,'stroke-dasharray':'3 2'});}
    // estates: a ring of how they go (car, metro, foot), the name
    y.est.forEach(e=>{const o=D.origins[e.i],[cx,cy]=xy(o.cell),walkers=e.to.reduce((s,x)=>s+x.walkers,0)+(e.chain||[]).reduce((s,c)=>s+(c.walkers||0),0);
      const parts=[[e.drivers,C.ink3],[e.metro,C.metro],[walkers,C.walk]],all=parts.reduce((s,p)=>s+p[0],0)||1,r=21,L=2*Math.PI*r;let off=0;
      labels+=svg('circle',{cx,cy:cy-4,r,fill:C.panel,'fill-opacity':.85,stroke:C.raise,'stroke-width':5});
      for(const [n,c] of parts){const len=L*n/all;if(len>.5)labels+=svg('circle',{cx,cy:cy-4,r,fill:'none',stroke:c,'stroke-width':5,'stroke-dasharray':`${len.toFixed(1)} ${L.toFixed(1)}`,'stroke-dashoffset':(-off).toFixed(1),transform:`rotate(-90 ${cx} ${cy-4})`});off+=len;}
      labels+=sprite(ESTATE,cx-13,cy-19,2.2,{k:C.ink,w:C.paper,l:C.warn,g:C.ink2});
      const side=o.house[0]!==0,up=o.house[1]<0,lx=side?cx+(o.house[0]>0?28:-28):cx,ly=side?cy:up?cy-31:cy+34,la=side?(o.house[0]>0?'start':'end'):'middle';
      labels+=text(lx,ly,nameO(e.i)+(o.tag==='new'?' ★':''),13.5,C.ink,{'text-anchor':la,'font-weight':700});});
    y.dest.forEach(d=>{const o=D.destinations[d.k],[cx,cy]=xy(o.cell),sp=DEST[o.kind],w=sp[0].length*2.6,diff=R(d.go-d.before);
      labels+=sprite(sp,cx-w/2,cy-20,2.6,{k:C.ink,w:C.paper,a:DCOL(o.kind),r:C.accent2,p:C.paper,l:C.warn,d:DCOL(o.kind),g:C.ink2});
      const side=o.house[0]!==0,lx=side?cx+(o.house[0]>0?w/2+6:-w/2-6):cx,ly=side?cy:cy+30,la=side?(o.house[0]>0?'start':'end'):'middle';
      labels+=svg('text',{x:lx,y:ly,'font-size':13.5,'text-anchor':la,'font-weight':700,stroke:C.paper,'stroke-width':4,'paint-order':'stroke'},
        `<tspan fill="${DCOL(o.kind)}">${nameD(d.k)}</tspan>`+(diff?`<tspan fill="${diff>0?C.accent:C.bad}"> ${diff>0?'↑+':'↓'}${diff}</tspan>`:''));});
    const order=plan.stations.map(s=>({s,x:plan.line.findIndex(c=>same(c,s))})).sort((a,b)=>a.x-b.x);
    if(!ghost)order.forEach(({s},n)=>{const [x,yy]=xy(s);
      things+=svg('circle',{cx:x,cy:yy,r:12,fill:C.panel,stroke:C.metro,'stroke-width':4.5})+svg('text',{x,y:yy+4.5,'font-size':12,'font-weight':700,fill:C.metro,'text-anchor':'middle','font-family':'Geist Mono,monospace'},n+1);});
    $('gBase').innerHTML=ground+roads+rails+lines+labels+things;
  }
  function drawTop(v){
    let s='';const placing=!plan.open;
    if(sel>=0){const row=rowsOf(v.y)[sel];if(row){const {from:o,to:d,x}=row,seg=(a,b)=>`M${xy(a).join(' ')}L${xy([b[0],a[1]]).join(' ')}L${xy(b).join(' ')}`;
      if(x.route)s+=x.route.sections.map(id=>{const q=G.sections[id],[x1,y1]=rxy(q,q.a),[x2,y2]=rxy(q,q.b);return svg('path',{d:`M${x1} ${y1}L${x2} ${y2}`,stroke:C.ink,'stroke-width':3,'stroke-dasharray':'1 6','stroke-linecap':'round'});}).join('');
      if(x.trip)s+=svg('path',{d:seg(o,x.trip.from),fill:'none',stroke:C.metro,'stroke-width':2.5,'stroke-dasharray':'2 5'})+svg('path',{d:seg(x.trip.to,d),fill:'none',stroke:C.metro,'stroke-width':2.5,'stroke-dasharray':'2 5'});}}
    if(hover&&placing){const [hx,hy]=xy(hover);
      if(tool==='draw'){
        if(plan.canExtend(hover)){const end=!plan.line.length?null:Roads.adj(hover,plan.line.at(-1))?plan.line.at(-1):plan.line[0];
          if(end)s+=svg('path',{d:`M${xy(end).join(' ')}L${hx} ${hy}`,stroke:C.metro,'stroke-width':10,'stroke-opacity':.35,'stroke-linecap':'round'});
          else s+=svg('circle',{cx:hx,cy:hy,r:7,fill:C.metro,'fill-opacity':.4});
          s+=pill(hx,hy-20,t('m.pvExtend',{c:P.lineCost}),C.metro,12);}
        else if(plan.canShorten(hover))s+=pill(hx,hy-20,t('m.pvShorten'),C.ink2,12);}
      else if(plan.onLine(hover)){const has=plan.isStation(hover);
        if(!has&&plan.money<P.stationCost)s+=pill(hx,hy-22,t('m.pvNoMoney'),C.bad,12);
        else{if(!has)s+=svg('circle',{cx:hx,cy:hy,r:14,fill:'none',stroke:C.metro,'stroke-width':4,'stroke-dasharray':'4 3'});
          s+=pill(hx,hy-24,(has?t('m.pvRemove'):t('m.pvAdd'))+' '+t(has?'m.pvRefund':'m.pvCost',{c:P.stationCost}),C.metro,12);}}}
    $('gTop').innerHTML=s;
  }
  function drawDyn(tm,v){
    let s=stepDots(tm,v.y);
    const order=plan.stations.map(q=>({q,x:plan.line.findIndex(c=>same(c,q))})).sort((a,b)=>a.x-b.x);
    if(order.length>=2&&v.mode!=='nothing'){const a=order[0].x,b=order.at(-1).x,span=Math.max(1,b-a);
      for(let k=0;k<plan.trains;k++){const ph=(tm/1000*1.6+k*2*span/plan.trains)%(2*span),pos=a+(ph<span?ph:2*span-ph),i=Math.min(plan.line.length-1,Math.floor(pos)),f=pos-i,c1=plan.line[i],c2=plan.line[Math.min(plan.line.length-1,i+1)];
        const [x1,y1]=xy(c1),[x2,y2]=xy(c2);s+=`<g opacity=".85" transform="translate(${(x1+(x2-x1)*f-23).toFixed(1)} ${(y1+(y2-y1)*f-7).toFixed(1)})">`+sprite(TRAIN,0,0,2.4,{m:C.metro,w:C.paper,k:C.ink})+'</g>';}}
    $('gDyn').innerHTML=s;
  }
  let baseKey='';
  function draw(force){const v=view(),k=JSON.stringify([planKey(plan),plan.year,v.mode,v.cell,tool,sel,I.lang,C.paper,!!lastY,hold]);
    if(force||k!==baseKey){baseKey=k;drawBase(v);headline(v);side(v);}drawTop(v);info(v);}

  /* -------------------------------------------------------------- headline, info card */
  function headline(v){
    const el=$('headline'),y=v.y,b=G.base,worst=roadStats(y,plan.perceived).sort((p,q)=>q.extra-p.extra)[0];
    el.className='headline '+(v.mode==='preview'||v.mode==='ahead'?'preview':v.mode==='nothing'?'nothing':'');
    let main='',sub='';
    if(v.mode==='nothing'){main=t('r3.hlNothing',{c:R(b.drivers),j:R(b.jam)});sub=t('r3.hlNothingSub');}
    else if(v.mode==='preview'||v.mode==='ahead'){const c=pct(y.drivers,b.drivers),j=pct(y.jam,b.jam);
      main=t(v.mode==='preview'?'r3.hlPreview':'r3.hlAhead',{dc:c.txt,cc:c.cls,dj:j.txt,jc:j.cls,r:R(y.onNew)});sub=t('r3.hlPreviewSub');}
    else if(plan.done){const tier=plan.total>=P.masterScore?3:plan.total>=P.highScore?2:plan.total>=P.target?1:0;main=t('r3.hlDone',{s:R(plan.total),tier:t('r.t'+tier)});sub=t('r3.hlDoneSub');}
    else if(plan.open&&plan.log.length){const l=plan.log.at(-1),c=pct(l.drivers,b.drivers),j=pct(l.jam,l.jam0);
      main=t('r3.hlYear',{y:l.year,dc:c.txt,cc:c.cls,dj:j.txt,jc:j.cls});
      const felt=lastY?lastY.extra.reduce((s,e)=>s+e,0)-plan.perceived.reduce((s,e)=>s+e,0):0;
      sub=[t('r3.hlAware',{a:tenth(l.after.reduce((s,a)=>s+a,0)/l.after.length)}),Math.abs(felt)>.05?t(felt<0?'r3.cardBetter':'r3.cardWorse'):'',l.crowdedSections?t('r3.cardCrowd',{n:l.crowdedSections,cb:P.crowdBlocks}):''].filter(Boolean).join(' · ');}
    else{main=t('r3.hlToday',{c:R(b.drivers),j:R(b.jam)});sub=t('r3.hlTodaySub',{r:roadName(worst.name),e:f1(worst.extra)});}
    $('hlMain').innerHTML=main;$('hlSub').innerHTML=sub;
  }
  function info(v){
    if(flash&&performance.now()<flash.until){$('infoCard').innerHTML=flash.html;return;}
    if(!hover){$('infoCard').innerHTML='';return;}
    const y=v.y,c=hover,h=[];
    const oi=D.origins.findIndex(o=>same(o.cell,c));
    if(oi>=0){const e=y.est[oi],walkers=e.to.reduce((s,x)=>s+x.walkers,0);
      h.push(t('r3.iEst',{n:nameO(oi),p:e.n,c:R(e.drivers),m:R(e.metro),w:R(walkers),nb:R(e.nearby),a:tenth(e.aware)}));
      e.to.forEach(x=>h.push(t('r3.iTrip',{d:shortD(x.k),car:f1(x.car),m:x.trip?f1(x.trip.blocks):'—'})));}
    const di=D.destinations.findIndex(o=>same(o.cell,c));
    if(di>=0){const d=y.dest[di];h.push(t('r3.iDest',{n:nameD(di),g:R(d.go),b:R(d.before),m:R(d.metro)}));}
    for(const l of G.lines){const j=l.stations.findIndex(s=>same(s,c));if(j>=0)h.push(t('r3.iStation',{l:I.lang==='zh-Hans'?(l.hans||l.name):l.name,s:(I.lang==='zh-Hans'?l.namesHans:l.names)[j]}));}
    const here=G.sections.filter(s=>same(s.a,c)||same(s.b,c)),seen=new Set();
    for(const s of here){const r=s.roads[0];if(seen.has(r))continue;seen.add(r);const ids=here.filter(q=>q.roads[0]===r).map(q=>q.id),id=ids.reduce((b,q)=>y.extra[q]>y.extra[b]?q:b,ids[0]);
      h.push(t('r3.iRoad',{r:roadName(r),c:R(y.roadLoad[id]),cap:G.sections[id].cap,e:f1(y.extra[id]),f:f1(plan.perceived[id])}));}
    $('infoCard').innerHTML=h.join('<br>');
  }
  function say(html){flash={until:performance.now()+1800,html};}

  /* -------------------------------------------------------------- side panels */
  function side(v){
    const y=v.y,nowY=now(),nx=spread(nowY,plan.aware),hi=R(P.masterScore*1.12),at=q=>Math.max(0,Math.min(100,100*q/hi)),n0=R(G.doNothing[0]);
    $('score').textContent=R(plan.total);$('scoreBar').style.width=`${at(plan.total)}%`;
    for(const [id,q,k] of [['tickPass',P.target,'g.tickPass'],['tickHigh',P.highScore,'g.tickHigh'],['tickMaster',P.masterScore,'g.tickMaster']]){$(id).style.left=`${at(q)}%`;$(id).dataset.label=t(k,{n:q});}
    $('yearNum').textContent=plan.done?t('m.yearDone',{m:P.years}):plan.open?t('m.yearN',{y:plan.year,m:P.years}):t('m.yearPlan');
    $('run').textContent=plan.done?t('m.runDone'):plan.open?(playing?t('m.playing'):t('m.runN',{n:plan.year+1})):t('m.run0');
    $('run').disabled=playing||(!plan.done&&!plan.canRun());
    $('pause').hidden=!plan.open||plan.done;$('pause').textContent=playing?t('m.pause'):t('m.play');$('rewind').hidden=!plan.open;
    $('hold').textContent=plan.open?t('r3.holdNothing'):t('r3.holdAhead');$('hold').disabled=!plan.open&&plan.stations.length<2;$('hold').classList.toggle('on',hold);
    const top=Math.max(...G.doNothing,...plan.log.map(l=>l.jam),nowY.jam)*1.12;
    let yc='';for(let k=1;k<=P.years;k++){const l=plan.log[k-1],q=l?l.jam:k===plan.year+1&&!plan.done&&plan.stations.length>=2?nowY.jam:0,h=R(52*q/top);
      yc+=`<div class="yb ${l?'done':k===plan.year+1?'next':''} ${l&&l.crowdedSections?'crowd':''}"><i style="height:${h}px"></i><b>${q?R(q):''}</b><small>${t('m.yShort',{y:k})}</small></div>`;}
    yc+=`<div class="ypot" style="bottom:${(18+52*G.doNothing[0]/top).toFixed(0)}px"><span>${t('r3.yNothing',{n:n0})}</span></div>`;
    $('yChart').innerHTML=yc;
    $('yNote').innerHTML=plan.stations.length<2?t('r3.yNoteNone'):plan.open?t('r3.yNoteN',{y:plan.year,j:R(plan.log.at(-1)?.jam??0),n:n0}):t('r3.yNote0',{j:R(nowY.jam),n:n0});
    $('planBox').classList.toggle('locked',plan.open);
    $('money').textContent=`${plan.money} / ${P.budget}`;
    $('moneyNote').innerHTML=t('m.money0',{lc:P.lineCost,sc:P.stationCost,tc:P.trainCost});
    $('trainsTxt').innerHTML=t('m.trains',{n:plan.trains,c:plan.trains*P.perTrain});
    $('trainPlus').disabled=!plan.canTrain();$('trainMinus').disabled=!plan.canUntrain();
    document.querySelectorAll('#toolSeg [data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===tool)));
    $('toolHint').textContent=plan.open?t('m.hintOpen'):tool==='draw'?(plan.line.length?t('m.hintDraw2'):t('m.hintDraw1')):(plan.line.length<2?t('m.hintNeedLine'):plan.stations.length<2?t('r3.hintStation1'):t('m.hintStation2'));
    $('undo').disabled=!history.length||plan.open;$('clear').disabled=plan.open||!plan.line.length;
    const scale=3;let h=`<p class="jamline">${t('r3.jamNow',{j:R(y.jam),n:n0})}</p>`;
    roadStats(y,plan.perceived).forEach(r=>{const w=q=>Math.min(100,100*q/scale).toFixed(1);
      h+=`<div class="rr"><span class="xn">${roadName(r.name)}</span><span class="rbar"><i style="width:${w(r.extra)}%;background:${jamCol(r.extra)}"></i><s style="left:${w(r.base)}%"></s><u style="left:${w(r.felt)}%"></u></span><b style="color:${jamCol(r.extra)}">${t('r3.extra',{e:f1(r.extra)})}</b></div>`;});
    $('roadBox').innerHTML=h+`<p class="hbnote">${t('r3.roadNote',{lp:R(P.learn*10)+(I.lang==='en'?'/10':' 成')})}</p>`;
    let a='';nowY.est.forEach(e=>{const q=tenth(e.aware),d=tenth(nx[e.i])-q;
      a+=`<div class="xr"><span class="xn">${shortO(e.i)}</span><span class="abar">${Array.from({length:10},(_,k)=>`<i class="${k<q?'on':''}"></i>`).join('')}</span><b>${t('m.tenths',{n:q})}</b><em class="${d>0?'up':''}">${plan.done?'':d>0?t('m.awNext',{n:d}):t('m.awSame')}</em></div>`;});
    $('awareBox').innerHTML=a+`<p class="hbnote">${t('r3.awNote',{s:tenth(P.aware.start)})}</p>`;
    let tb=`<thead><tr><th>${t('m.tTrip')}</th><th>${t('m.tGo')}</th><th>${t('r3.tCar')}</th><th>${t('m.tMetro')}</th><th>${t('r3.tDrive')}</th><th>${t('m.tRiders')}</th></tr></thead><tbody>`;
    rowsOf(y).forEach(({x,who,chain},k)=>{const jamPart=x.route?x.route.sections.reduce((s,id)=>s+plan.perceived[id],0):0;
      tb+=`<tr data-row="${k}" class="${sel===k?'sel':''} ${x.metro>=1?'on':''} ${chain?'chain':''}"><td>${who}<small>→ ${shortD(x.k)}${chain?' · '+t('m.chainTag'):''}</small></td><td>${R(x.go)}<small>${t('m.was',{b:R(x.before)})}</small></td>`+
        `<td>${f1(x.car)}<small>${t('r3.carSum',{b:f1(x.car-jamPart),j:f1(jamPart)})}</small></td><td>${x.trip?(Number.isInteger(x.trip.blocks)?x.trip.blocks:f1(x.trip.blocks)):'—'}<small>${x.trip?x.trip.lines.map(n=>n==='new'?t('r3.newTag'):n).join('→'):''}</small></td>`+
        `<td>${R(x.drivers)}</td><td><b>${x.metro>=1?R(x.metro):''}</b></td></tr>`;});
    $('trips').innerHTML=tb+'</tbody>';
  }
  function render(){draw(true);}
  function fit(){$('board').setAttribute('viewBox',`0 0 ${VBW} ${VBH}`);}
  function texts(){
    $('goal').innerHTML=t('r3.goal',{pass:P.target,high:P.highScore,master:P.masterScore});
    const v={st:P.stay,wp:P.walkPer,w:P.wait,lc:P.lineCost,sc:P.stationCost,tc:P.trainCost,pt:P.perTrain,b:P.budget,y:P.years,s:tenth(P.aware.start),cb:P.crowdBlocks,nb:P.nearby,
      sp:P.aware.spread,lp:I.lang==='en'?P.learn*10+'/10':R(P.learn*10)+' 成',e0:D.destinations[0].carExtra??2,e1:D.destinations[1].carExtra??2};
    $('rules').innerHTML=['r3.r0','r3.r1','r3.r2','r3.r3','r3.r4','r3.r5'].map(k=>`<li>${t(k,v)}</li>`).join('');
    $('infoBody').innerHTML=t('r3.info',v);$('ivBody').innerHTML=t('iv.m3.body',v);
    $('mapLegend').innerHTML=t('r3.legend');document.title=t('r3.doc');
  }

  /* -------------------------------------------------------------- the years */
  function step(){
    if(plan.done){stop();return;}
    const r=plan.runYear();if(!r)return stop();
    lastY=r.y;render();if(plan.done){stop();setTimeout(result,STEP_MS);}
  }
  function play(){if(plan.done)return;playing=true;clearInterval(timer);timer=setInterval(step,STEP_MS);render();}
  function stop(){playing=false;clearInterval(timer);render();}
  function open(){if(!plan.canRun())return;history=[];tool='draw';hover=null;step();play();}
  function rewind(){stop();plan.rewind();lastY=null;render();}
  function result(){
    const tier=plan.total>=P.masterScore?3:plan.total>=P.highScore?2:plan.total>=P.target?1:0;
    $('result').classList.toggle('win',tier>0);$('resultTitle').textContent=t('r.t'+tier);$('resultEn').textContent=['Try again','Cleared','High score','Master'][tier];
    $('resultScore').textContent=t('r3.rScore',{d:R(plan.total),y:P.years});
    let h=`<table class="result"><thead><tr><th>${t('m.ryYear')}</th><th>${t('r3.ryJam')}</th><th>${t('r3.ryNothing')}</th><th>${t('r3.rySaved')}</th><th>${t('r3.ryDrive')}</th><th>${t('r3.ryNew')}</th><th>${t('m.ryAware')}</th></tr></thead><tbody>`;
    for(const l of plan.log)h+=`<tr><td>${t('m.yShort',{y:l.year})}</td><td>${R(l.jam)}</td><td>${R(l.jam0)}</td><td>${R(l.saved)}</td><td>${R(l.drivers)}</td><td>${R(l.onNew)}</td><td>${t('m.tenths',{n:tenth(l.after.reduce((s,a)=>s+a,0)/l.after.length)})}</td></tr>`;
    h+='</tbody></table>';
    const tips=[],lo=plan.log.reduce((b,l)=>l.jam<b.jam?l:b,plan.log[0]),last=plan.log.at(-1);
    if(lo.year<P.years&&last.jam>lo.jam*1.05)tips.push(t('r3.tipRebound',{lo:lo.year,a:R(lo.jam),b:R(last.jam)}));
    const worst=roadStats(lastY||now(),plan.perceived).sort((a,b)=>b.extra-a.extra)[0];if(worst&&worst.extra>=.5)tips.push(t('r3.tipWorst',{r:roadName(worst.name),e:f1(worst.extra)}));
    const crowdYears=plan.log.filter(l=>l.crowdedSections).length;if(crowdYears)tips.push(t('r3.tipCrowd',{n:crowdYears}));
    D.origins.forEach((o,i)=>{if(last.after[i]<=P.aware.start+.001)tips.push(t('r3.tipNever',{a:nameO(i)}));});
    $('resultBody').innerHTML=h+`<ul class="ivlist">${tips.slice(0,5).map(s=>`<li>${s}</li>`).join('')}</ul>`;
    try{const k='tl-best-m3-'+D.map;if(plan.total>(+localStorage.getItem(k)||0))localStorage.setItem(k,R(plan.total));}catch(e){}
    window.dispatchEvent(new CustomEvent('tl:result',{detail:{game:'feeder',mode:'m3-roads',version:'7.9',map:D.map,score:R(plan.total),tier,tiers:[P.target,P.highScore,P.masterScore],line:plan.line,stations:plan.stations,trains:plan.trains,lang:I.lang}}));
    $('result').showModal();
  }

  /* -------------------------------------------------------------- controls */
  const board=$('board');
  function cellAt(e){const pt=board.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;const p=pt.matrixTransform(board.getScreenCTM().inverse());
    const c=[Math.round((p.x-MX)/CS),Math.round((p.y-MY)/CS)];return c[0]>=0&&c[1]>=0&&c[0]<D.cols&&c[1]<D.rows?c:null;}
  function act(c){
    if(plan.open){say(`<b>${t('m.cardLocked')}</b><br>${t('m.cardLocked2')}`);return false;}
    if(tool==='draw'){
      if(plan.canExtend(c)){snapshot();plan.extend(c);return true;}
      if(plan.canShorten(c)){snapshot();plan.shorten(c);return true;}
      return false;}
    if(!plan.onLine(c))return false;
    if(!plan.isStation(c)&&plan.money<P.stationCost)return false;
    snapshot();plan.toggleStation(c);return true;
  }
  board.onpointerdown=e=>{const c=cellAt(e);if(!c)return;drag=tool==='draw'&&!plan.open;if(act(c))render();if(drag)board.setPointerCapture(e.pointerId);};
  board.onpointermove=e=>{const c=cellAt(e);
    if(drag&&c&&plan.canExtend(c)){snapshot();plan.extend(c);hover=null;render();return;}
    if(JSON.stringify(c)!==JSON.stringify(hover)){hover=c;draw();}};
  board.onpointerup=()=>{drag=false;};
  board.onpointerleave=()=>{if(!drag&&hover){hover=null;draw();}};
  $('toolSeg').onclick=e=>{const b=e.target.closest('[data-tool]');if(b&&!plan.open){tool=b.dataset.tool;hover=null;render();}};
  $('undo').onclick=()=>{const s=history.pop();if(s){restore(s);render();}};
  $('clear').onclick=()=>{if(plan.open||!plan.line.length)return;snapshot();plan.clear();tool='draw';render();};
  $('trainPlus').onclick=()=>{snapshot();if(plan.addTrain())render();};
  $('trainMinus').onclick=()=>{snapshot();if(plan.removeTrain())render();};
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
    if(e.key==='1'&&!plan.open){tool='draw';render();}else if(e.key==='2'&&!plan.open){tool='station';render();}
    else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$('undo').click();}
    else if(e.code==='Space'&&plan.open&&!plan.done&&!e.target.closest?.('button')){e.preventDefault();$('pause').click();}
    else if(e.key==='Escape'&&sel>=0){sel=-1;render();}});
  function setTheme(th){document.documentElement.setAttribute('data-theme',th);$('thPaper').setAttribute('aria-pressed',String(th==='light'));$('thInk').setAttribute('aria-pressed',String(th==='dark'));
    try{localStorage.setItem('tl-theme',th);}catch(e){}readTokens();render();}
  $('thPaper').onclick=()=>setTheme('light');$('thInk').onclick=()=>setTheme('dark');
  window.addEventListener('tl:lang',()=>{texts();render();});
  let lastFrame=0;(function loop(tm){if(tm-lastFrame>33){drawDyn(tm,view());if(flash&&tm>flash.until){flash=0;info(view());}lastFrame=tm;}requestAnimationFrame(loop);})(0);
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
  // for the AI demo (demo.js): set a plan up step by step, then open it
  const api={reset(){stop();plan=new Plan();history=[];sel=-1;tool='draw';hover=null;lastY=null;render();},
    extend(c){const ok=plan.extend(c);render();return ok;},station(c){tool='station';const ok=plan.toggleStation(c);render();return ok;},
    train(){const ok=plan.addTrain();render();return ok;},go(){open();},halt(){stop();},get plan(){return plan;}};
  window.TL_ROADS={api,plan:()=>({line:plan.line.map(c=>c.slice()),stations:plan.stations.map(c=>c.slice()),year:plan.year,money:plan.money,trains:plan.trains,total:plan.total,done:plan.done,playing,jam:now().jam,dots:dots.length}),
    cellXY:c=>{const m=board.getScreenCTM(),[x,y]=xy(c);return[m.a*x+m.c*y+m.e,m.b*x+m.d*y+m.f];}};
})();
