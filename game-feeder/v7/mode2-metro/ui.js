(()=>{
  'use strict';
  // v7 · mode 2 «the metro», build once and watch it grow — the page, a living map. Every estate sends people out all
  // the time: grey cars drive to the two centres, brown dots walk to a station and ride, light dots walk. Hover a cell
  // on your line and the map turns into what a station there would bring once everybody knows the line; hold the eye
  // button to see that for the whole plan — or, once open, what it would be without the line.
  const {Plan,D,P,year,spread,walk,same,key}=Metro,$=id=>document.getElementById(id),I=window.I18N,t=(k,v)=>I.t(k,v);
  const CS=60,MX=60,MY=104,STEP_MS=2600,DAY_S=7,PER_DOT=1,MAX_DOTS=600;
  const xy=c=>[MX+c[0]*CS,MY+c[1]*CS];
  const svg=(tag,a,c='')=>`<${tag} ${Object.entries(a).map(([k,v])=>`${k}="${v}"`).join(' ')}>${c}</${tag}>`;
  let C={};
  function readTokens(){const s=getComputedStyle(document.documentElement),v=n=>s.getPropertyValue('--s-'+n).trim();
    C={paper:v('paper'),panel:v('panel'),soft:v('soft'),raise:v('raise'),ink:v('ink'),ink2:v('ink2'),ink3:v('ink3'),line:v('line'),line2:v('line2'),accent:v('accent'),accent2:v('accent2'),
      warn:v('warn'),bad:v('bad'),info:v('info'),metro:v('metro'),walk:v('walk')};}
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
  const nameO=i=>I.name(D.origins[i]),nameD=k=>I.name(D.destinations[k]),shortD=k=>{const d=D.destinations[k];return I.lang==='zh-Hans'?(d.shortHans||d.hans):(d.short||d.name);};
  const R=Math.round,f1=v=>(Math.round(v*10)/10).toFixed(1),tenth=a=>R(a*10),sw=c=>`<i class="sw" style="background:${c}"></i>`;
  const signed=v=>{const r=R(v);return{txt:(r>0?'+':r<0?'−':'±')+Math.abs(r),cls:r>0?'good':r<0?'bad':''};};
  let plan=new Plan(),tool='draw',hover=null,sel=-1,drag=false,history=[],playing=false,timer=0,hold=false,lastY=null,flash=0;
  const VBW=MX*2+(D.cols-1)*CS+80,VBH=MY+60+(D.rows-1)*CS;
  function snapshot(){history.push(JSON.stringify({...plan}));if(history.length>200)history.shift();}
  function restore(s){const p=new Plan();Object.assign(p,JSON.parse(s));plan=p;}
  const planKey=p=>JSON.stringify([p.line,p.stations,p.trains]);
  const memo=new Map();function cached(k,f){if(!memo.has(k)){if(memo.size>60)memo.clear();memo.set(k,f());}return memo.get(k);}
  function now(){return cached('now'+planKey(plan)+plan.year+JSON.stringify(plan.aware)+JSON.stringify(plan.crowded),()=>plan.now());}
  // without the line: everyone drives (or walks) where they always went
  const noLine=()=>cached('none',()=>year([],[],D.origins.map(()=>0),1));
  // what the map shows: this year, a preview (a station toggled here, or the whole line known by all), or no line
  function view(){
    if(hold&&plan.open)return{mode:'nothing',y:noLine()};
    if(!plan.open){
      if(tool==='station'&&hover&&plan.onLine(hover)&&(plan.isStation(hover)||plan.money>=P.stationCost)){
        const q=new Plan();Object.assign(q,JSON.parse(JSON.stringify({...plan})));q.toggleStation(hover);
        if(q.stations.length>=2)return{mode:'preview',y:cached('pot'+planKey(q),()=>q.potential()),cell:hover};}
      if(hold&&plan.stations.length>=2)return{mode:'ahead',y:cached('pot'+planKey(plan),()=>plan.potential())};
      return{mode:'today',y:noLine()};}
    return{mode:'year',y:lastY||now()};
  }
  const rowsOf=y=>[...y.est.flatMap(e=>e.to.map(x=>({from:D.origins[e.i].cell,to:D.destinations[x.k].cell,x,who:nameO(e.i),e}))),
    ...(y.chain||[]).map(q=>({from:D.destinations[q.a].cell,to:D.destinations[q.b].cell,x:q,who:shortD(q.a),chain:true}))];

  /* -------------------------------------------------------------- the moving people */
  const V={walk:34,car:80,rail:190};
  function carPath(from,to){const [a,b]=[xy(from),xy(to)],mid=[b[0],a[1]];return{pts:[a,mid,b],sp:[V.car,V.car]};}
  function metroPath(trip,from,to){const pts=[xy(from)],sp=[],step=trip.tx>=trip.fx?1:-1;
    pts.push(xy(plan.line[trip.fx]));sp.push(V.walk);
    for(let i=trip.fx+step;step>0?i<=trip.tx:i>=trip.tx;i+=step){pts.push(xy(plan.line[i]));sp.push(V.rail);}
    pts.push(xy(to));sp.push(V.walk);return{pts,sp};}
  function walkPath(from,to){return{pts:[xy(from),xy(to)],sp:[V.walk]};}
  function timed(p){const cum=[0];for(let i=1;i<p.pts.length;i++){const [a,b]=[p.pts[i-1],p.pts[i]];cum.push(cum[i-1]+Math.hypot(b[0]-a[0],b[1]-a[1])/p.sp[i-1]);}return{...p,cum,T:cum.at(-1)};}
  const flowMemo=new WeakMap();
  function flowsOf(y){if(flowMemo.has(y))return flowMemo.get(y);const out=[];
    const add=(id,kind,n,mk)=>{if(n>.3)out.push({id,kind,n,mk});};
    const one=(id,x,from,to)=>{add(id+'c','car',x.drivers,()=>carPath(from,to));
      if(x.trip&&plan.line.length)add(id+'m','metro',x.metro,()=>metroPath(x.trip,from,to));
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
      if(d.kind==='car')s+=`<rect x="${(x-3.5).toFixed(1)}" y="${(yy-2.5).toFixed(1)}" width="7" height="5" rx="1.5" fill="${C.ink}" opacity=".6"/>`;
      else if(d.kind==='metro')s+=`<circle cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="3.2" fill="${C.metro}"/>`;
      else s+=`<circle cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="2.6" fill="${C.walk}"/>`;
      return true;});
    return s;}

  /* -------------------------------------------------------------- the board */
  function drawBase(v){
    const y=v.y,placing=!plan.open,ghost=v.mode==='nothing'||v.mode==='today';
    let ground='',lines='',things='',labels='';
    for(let x=0;x<D.cols;x++)for(let yy=0;yy<D.rows;yy++){const [cx,cy]=xy([x,yy]),can=placing&&tool==='draw'&&plan.canExtend([x,yy])&&plan.line.length>0;
      ground+=svg('rect',{x:cx-CS/2+3,y:cy-CS/2+3,width:CS-6,height:CS-6,rx:5,fill:can?C.metro:C.soft,'fill-opacity':can?.10:.5,stroke:can?C.metro:C.line,'stroke-opacity':can?.45:.8,'stroke-dasharray':can?'4 3':''});}
    const dim=v.mode==='nothing';
    for(let s=0;s+1<plan.line.length;s++){const [x1,y1]=xy(plan.line[s]),[x2,y2]=xy(plan.line[s+1]),f=!ghost&&y.cap?y.load[s]/y.cap:0,col=f>1?C.bad:f>.8?C.warn:C.metro;
      lines+=svg('path',{d:`M${x1} ${y1}L${x2} ${y2}`,stroke:col,'stroke-width':dim?4:12,'stroke-linecap':'round','stroke-opacity':dim?.25:.92,'stroke-dasharray':dim?'4 6':''});}
    if(plan.line.length===1){const [x,yy]=xy(plan.line[0]);lines+=svg('circle',{cx:x,cy:yy,r:7,fill:C.metro});}
    if(placing&&tool==='draw')for(const e of [plan.line[0],plan.line.at(-1)])if(e){const [x,yy]=xy(e);things+=svg('circle',{cx:x,cy:yy,r:9,fill:C.panel,stroke:C.metro,'stroke-width':3,'stroke-dasharray':'3 2'});}
    // estates: a ring of how they go (car, metro, foot), a green arc of who knows the line, the name
    y.est.forEach(e=>{const o=D.origins[e.i],[cx,cy]=xy(o.cell),walkers=e.to.reduce((s,x)=>s+x.walkers,0);
      const parts=[[e.to.reduce((s,x)=>s+x.drivers,0),C.ink3],[e.metro,C.metro],[walkers,C.walk]],all=parts.reduce((s,p)=>s+p[0],0)||1,r=23,L=2*Math.PI*r;let off=0;
      labels+=svg('circle',{cx,cy:cy-4,r,fill:C.panel,'fill-opacity':.85,stroke:C.raise,'stroke-width':5});
      for(const [n,c] of parts){const len=L*n/all;if(len>.5)labels+=svg('circle',{cx,cy:cy-4,r,fill:'none',stroke:c,'stroke-width':5,'stroke-dasharray':`${len.toFixed(1)} ${L.toFixed(1)}`,'stroke-dashoffset':(-off).toFixed(1),transform:`rotate(-90 ${cx} ${cy-4})`});off+=len;}
      const aw=dim?0:plan.open||v.mode!=='today'?(v.mode==='preview'||v.mode==='ahead'?1:e.aware):0,R2=r+5.5,L2=2*Math.PI*R2;
      if(aw>0)labels+=svg('circle',{cx,cy:cy-4,r:R2,fill:'none',stroke:C.accent,'stroke-width':2.5,'stroke-dasharray':`${(L2*aw).toFixed(1)} ${L2.toFixed(1)}`,transform:`rotate(-90 ${cx} ${cy-4})`,'stroke-linecap':'round'});
      labels+=sprite(ESTATE,cx-14,cy-20,2.4,{k:C.ink,w:C.paper,l:C.warn,g:C.ink2});
      const up=o.house[1]<0;labels+=text(cx,up?cy-36:cy+40,nameO(e.i),14.5,C.ink,{'text-anchor':'middle','font-weight':700});});
    y.dest.forEach(d=>{const o=D.destinations[d.k],[cx,cy]=xy(o.cell),sp=DEST[o.kind],w=sp[0].length*2.8,diff=v.mode==='today'||dim?0:R(d.go-d.before);
      labels+=sprite(sp,cx-w/2,cy-22,2.8,{k:C.ink,w:C.paper,a:DCOL(o.kind),r:C.accent2,p:C.paper,l:C.warn,d:DCOL(o.kind),g:C.ink2});
      const side=o.house[0]!==0,lx=side?cx+(o.house[0]>0?w/2+6:-w/2-6):cx,ly=side?cy:cy-32,la=side?(o.house[0]>0?'start':'end'):'middle';
      labels+=svg('text',{x:lx,y:ly,'font-size':14.5,'text-anchor':la,'font-weight':700,stroke:C.paper,'stroke-width':4,'paint-order':'stroke'},
        `<tspan fill="${DCOL(o.kind)}">${nameD(d.k)}</tspan>`+(diff?`<tspan fill="${diff>0?C.accent:C.bad}"> ${diff>0?'↑+':'↓'}${diff}</tspan>`:''));});
    if(!dim){const order=plan.stations.map(s=>({s,x:plan.line.findIndex(c=>same(c,s))})).sort((a,b)=>a.x-b.x);
      order.forEach(({s},n)=>{const [x,yy]=xy(s);
        things+=svg('circle',{cx:x,cy:yy,r:13,fill:C.panel,stroke:C.metro,'stroke-width':4.5})+svg('text',{x,y:yy+4.5,'font-size':12.5,'font-weight':700,fill:C.metro,'text-anchor':'middle','font-family':'Geist Mono,monospace'},n+1);});}
    $('gBase').innerHTML=ground+lines+labels+things;
  }
  function drawTop(v){
    let s='';const placing=!plan.open;
    if(sel>=0){const row=rowsOf(v.y)[sel];if(row&&row.x.trip){const {from:o,to:d,x}=row,seg=(a,b)=>`M${xy(a).join(' ')}L${xy([b[0],a[1]]).join(' ')}L${xy(b).join(' ')}`;
      s+=svg('path',{d:seg(o,x.trip.from),fill:'none',stroke:C.ink,'stroke-width':2.5,'stroke-dasharray':'2 5','stroke-linecap':'round'})+svg('path',{d:seg(x.trip.to,d),fill:'none',stroke:C.ink,'stroke-width':2.5,'stroke-dasharray':'2 5','stroke-linecap':'round'});}}
    if(hover&&placing){const [hx,hy]=xy(hover);
      if(tool==='draw'){
        if(plan.canExtend(hover)){const end=!plan.line.length?null:Metro.adj(hover,plan.line.at(-1))?plan.line.at(-1):plan.line[0];
          if(end)s+=svg('path',{d:`M${xy(end).join(' ')}L${hx} ${hy}`,stroke:C.metro,'stroke-width':12,'stroke-opacity':.35,'stroke-linecap':'round'});
          else s+=svg('circle',{cx:hx,cy:hy,r:7,fill:C.metro,'fill-opacity':.4});
          s+=pill(hx,hy-22,t('m.pvExtend',{c:P.lineCost}),C.metro,12);}
        else if(plan.canShorten(hover))s+=pill(hx,hy-22,t('m.pvShorten'),C.ink2,12);}
      else if(plan.onLine(hover)){const has=plan.isStation(hover);
        if(!has&&plan.money<P.stationCost)s+=pill(hx,hy-24,t('m.pvNoMoney'),C.bad,12);
        else{if(!has)s+=svg('circle',{cx:hx,cy:hy,r:15,fill:'none',stroke:C.metro,'stroke-width':4,'stroke-dasharray':'4 3'});
          s+=pill(hx,hy-26,(has?t('m.pvRemove'):t('m.pvAdd'))+' '+t(has?'m.pvRefund':'m.pvCost',{c:P.stationCost}),C.metro,12);}}}
    $('gTop').innerHTML=s;
  }
  function drawDyn(tm,v){
    let s=stepDots(tm,v.y);
    const order=plan.stations.map(q=>({q,x:plan.line.findIndex(c=>same(c,q))})).sort((a,b)=>a.x-b.x);
    if(order.length>=2&&v.mode!=='nothing'&&v.mode!=='today'){const a=order[0].x,b=order.at(-1).x,span=Math.max(1,b-a);
      for(let k=0;k<plan.trains;k++){const ph=(tm/1000*1.6+k*2*span/plan.trains)%(2*span),pos=a+(ph<span?ph:2*span-ph),i=Math.min(plan.line.length-1,Math.floor(pos)),f=pos-i,c1=plan.line[i],c2=plan.line[Math.min(plan.line.length-1,i+1)];
        const [x1,y1]=xy(c1),[x2,y2]=xy(c2);s+=`<g opacity=".85" transform="translate(${(x1+(x2-x1)*f-25.5).toFixed(1)} ${(y1+(y2-y1)*f-8).toFixed(1)})">`+sprite(TRAIN,0,0,2.7,{m:C.metro,w:C.paper,k:C.ink})+'</g>';}}
    $('gDyn').innerHTML=s;
  }
  let baseKey='';
  function draw(force){const v=view(),k=JSON.stringify([planKey(plan),plan.year,v.mode,v.cell,tool,sel,I.lang,C.paper,!!lastY,hold]);
    if(force||k!==baseKey){baseKey=k;drawBase(v);headline(v);side(v);}drawTop(v);info(v);}

  /* -------------------------------------------------------------- headline, info card */
  function headline(v){
    const el=$('headline'),y=v.y,n=noLine(),d0=shortD(0),d1=shortD(1);
    el.className='headline '+(v.mode==='preview'||v.mode==='ahead'?'preview':v.mode==='nothing'?'nothing':'');
    const gains=yy=>[0,1].map(k=>signed(yy.dest[k].go-n.dest[k].go));
    let main='',sub='';
    if(v.mode==='nothing'){main=t('m2.hlNothing',{d0,d1,a:R(n.dest[0].go),b:R(n.dest[1].go)});sub=t('m2.hlNothingSub');}
    else if(v.mode==='preview'||v.mode==='ahead'){const [a,b]=gains(y);main=t(v.mode==='preview'?'m2.hlPreview':'m2.hlAhead',{r:R(y.riders),d0,d1,a:a.txt,ca:a.cls,b:b.txt,cb:b.cls});sub=t('m2.hlPreviewSub',{s:tenth(P.aware.start)});}
    else if(plan.done){const tier=plan.total>=P.masterScore?3:plan.total>=P.highScore?2:plan.total>=P.target?1:0;main=t('m2.hlDone',{s:R(plan.total),tier:t('r.t'+tier)});sub=t('m2.hlDoneSub');}
    else if(plan.open&&plan.log.length){const l=plan.log.at(-1),prev=plan.log.at(-2),[a,b]=gains(lastY||now()),nx=spread(now(),plan.aware);
      const avg=arr=>arr.reduce((s,x)=>s+x,0)/arr.length;
      main=t('m2.hlYear',{y:l.year,r:R(l.riders),d:signed(l.riders-(prev?prev.riders:0)).txt,d0,d1,a:a.txt,ca:a.cls,b:b.txt,cb:b.cls});
      const more=plan.done?0:Math.max(0,tenth(avg(nx))-tenth(avg(plan.aware)));sub=more?t('m2.hlYearSub',{a:tenth(avg(plan.aware)),n:more}):t('m2.hlYearSub0',{a:tenth(avg(plan.aware))});}
    else{main=t('m2.hlToday',{d0,d1,a:R(n.dest[0].go),b:R(n.dest[1].go)});sub=t('m2.hlTodaySub');}
    $('hlMain').innerHTML=main;$('hlSub').innerHTML=sub;
  }
  function info(v){
    if(flash&&performance.now()<flash.until){$('infoCard').innerHTML=flash.html;return;}
    if(!hover){$('infoCard').innerHTML='';return;}
    const y=v.y,c=hover,h=[];
    const oi=D.origins.findIndex(o=>same(o.cell,c));
    if(oi>=0){const e=y.est[oi];
      h.push(t('m2.iEst',{n:nameO(oi),p:e.n,c:R(e.to.reduce((s,x)=>s+x.drivers,0)),m:R(e.metro),w:R(e.to.reduce((s,x)=>s+x.walkers,0)),nb:R(e.nearby),a:tenth(e.aware)}));
      e.to.forEach(x=>h.push(t('m2.iTrip',{d:shortD(x.k),car:x.alt,m:x.trip?x.trip.blocks:'—',t:x.tenths})));}
    const di=D.destinations.findIndex(o=>same(o.cell,c));
    if(di>=0){const d=y.dest[di];h.push(t('m2.iDest',{n:nameD(di),g:R(d.go),b:R(d.before),m:R(d.metro),o:R(d.onward||0)}));}
    if(plan.isStation(c)&&y.cap){const order=plan.stations.map(s=>({s,x:plan.line.findIndex(q=>same(q,s))})).sort((a,b)=>a.x-b.x),n=order.findIndex(o=>same(o.s,c)),j=plan.line.findIndex(q=>same(q,c));
      const l=Math.max(y.load[j-1]||0,y.load[j]||0);h.push(t('m2.iStation',{n:n+1,l:R(l),c:y.cap}));}
    $('infoCard').innerHTML=h.join('<br>');
  }
  function say(html){flash={until:performance.now()+1800,html};}

  /* -------------------------------------------------------------- side panels */
  function side(v){
    const y=now(),pot=plan.stations.length>=2?cached('pot'+planKey(plan),()=>plan.potential()):null,nx=spread(y,plan.aware),hi=R(P.masterScore*1.12),at=q=>Math.max(0,Math.min(100,100*q/hi));
    $('score').textContent=R(plan.total);$('scoreBar').style.width=`${at(plan.total)}%`;
    for(const [id,q,k] of [['tickPass',P.target,'g.tickPass'],['tickHigh',P.highScore,'g.tickHigh'],['tickMaster',P.masterScore,'g.tickMaster']]){$(id).style.left=`${at(q)}%`;$(id).dataset.label=t(k,{n:q});}
    $('yearNum').textContent=plan.done?t('m.yearDone',{m:P.years}):plan.open?t('m.yearN',{y:plan.year,m:P.years}):t('m.yearPlan');
    $('run').textContent=plan.done?t('m.runDone'):plan.open?(playing?t('m.playing'):t('m.runN',{n:plan.year+1})):t('m.run0');
    $('run').disabled=playing||(!plan.done&&!plan.canRun());
    $('pause').hidden=!plan.open||plan.done;$('pause').textContent=playing?t('m.pause'):t('m.play');$('rewind').hidden=!plan.open;
    $('hold').textContent=plan.open?t('m2.holdNothing'):t('m2.holdAhead');$('hold').disabled=!plan.open&&plan.stations.length<2;$('hold').classList.toggle('on',hold);
    const top=Math.max(pot?pot.riders:0,...plan.log.map(l=>l.riders),y.riders,P.masterScore/P.years)*1.15;
    let yc='';for(let k=1;k<=P.years;k++){const l=plan.log[k-1],q=l?l.riders:k===plan.year+1&&!plan.done&&plan.stations.length>=2?y.riders:0,h=R(52*q/top);
      yc+=`<div class="yb ${l?'done':k===plan.year+1?'next':''} ${l&&l.crowdedSections?'crowd':''}"><i style="height:${h}px"></i><b>${q?R(q):''}</b><small>${t('m.yShort',{y:k})}</small></div>`;}
    if(pot)yc+=`<div class="ypot" style="bottom:${(18+52*pot.riders/top).toFixed(0)}px"><span>${t('m.potShort',{n:R(pot.riders)})}</span></div>`;
    $('yChart').innerHTML=yc;
    $('yNote').innerHTML=!pot?t('m.yNoteNone'):plan.open?t('m.yNoteN',{y:plan.year,r:R(plan.log.at(-1)?.riders??0),p:R(pot.riders)}):t('m.yNote0',{r:R(y.riders),p:R(pot.riders)});
    $('planBox').classList.toggle('locked',plan.open);
    $('money').textContent=`${plan.money} / ${P.budget}`;
    $('moneyNote').innerHTML=t('m.money0',{lc:P.lineCost,sc:P.stationCost,tc:P.trainCost});
    $('trainsTxt').innerHTML=t('m.trains',{n:plan.trains,c:plan.trains*P.perTrain});
    $('trainPlus').disabled=!plan.canTrain();$('trainMinus').disabled=!plan.canUntrain();
    document.querySelectorAll('#toolSeg [data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===tool)));
    $('toolHint').textContent=plan.open?t('m.hintOpen'):tool==='draw'?(plan.line.length?t('m.hintDraw2'):t('m.hintDraw1')):(plan.line.length<2?t('m.hintNeedLine'):plan.stations.length<2?t('m.hintStation1'):t('m.hintStation2'));
    $('undo').disabled=!history.length||plan.open;$('clear').disabled=plan.open||!plan.line.length;
    let h='';y.est.forEach(e=>{const a=tenth(e.aware),d=tenth(nx[e.i])-a;
      h+=`<div class="xr"><span class="xn">${nameO(e.i)}</span><span class="abar">${Array.from({length:10},(_,k)=>`<i class="${k<a?'on':''}"></i>`).join('')}</span><b>${t('m.tenths',{n:a})}</b><em class="${d>0?'up':''}">${plan.done?'':d>0?t('m.awNext',{n:d}):t('m.awSame')}</em></div>`;});
    $('awareBox').innerHTML=h+`<p class="hbnote">${t('m.awNote',{s:tenth(P.aware.start)})}</p>`;
    const w0=v.y;let w='';w0.est.forEach(e=>{const n=e.n,seg=[...e.to.map(x=>({v:x.go/n,b:x.before/n,c:DCOL(D.destinations[x.k].kind)})),{v:e.nearby/n,b:e.nearbyBefore/n,c:C.ink3}];
      let bacc=0,ticks='';const bars=seg.map(s=>{const el=`<i style="flex:${s.v.toFixed(3)};background:${s.c}"></i>`;bacc+=s.b;if(bacc<.999)ticks+=`<u style="left:${(100*bacc).toFixed(1)}%"></u>`;return el;}).join('');
      w+=`<div class="wr"><span class="xn">${nameO(e.i)}</span><span class="wbar">${bars}${ticks}</span><b>${R(100*(n-e.nearby)/n)}%</b></div>`;});
    $('whereBox').innerHTML=w+`<p class="hbnote">${t('m.whereNote',{a:sw(DCOL(D.destinations[0].kind))+shortD(0),b:sw(DCOL(D.destinations[1].kind))+shortD(1),c:sw(C.ink3)+t('m.nearbyName')})}</p>`;
    let tb=`<thead><tr><th>${t('m.tTrip')}</th><th>${t('m.tGo')}</th><th>${t('m.tAlt')}</th><th>${t('m.tMetro')}</th><th>${t('m.tSave')}</th><th>${t('m.tRiders')}</th></tr></thead><tbody>`;
    rowsOf(y).forEach(({x,who,chain},k)=>{const e=chain?null:y.est.find(z=>z.to.includes(x));
      tb+=`<tr data-row="${k}" class="${sel===k?'sel':''} ${x.metro>=1?'on':''} ${chain?'chain':''}"><td>${who}<small>→ ${shortD(x.k)}${chain?' · '+t('m.chainTag'):''}</small></td><td>${R(x.go)}<small>${t('m.was',{b:R(x.before)})}</small></td><td>${x.alt}<small>${t(x.byFoot?'m.byFoot':'m.byCar')}</small></td>`+
      `<td>${x.trip?`${x.trip.blocks}<small>${P.walkPer*x.trip.walkA}+${P.wait}+${x.trip.pass}+${P.walkPer*x.trip.walkB}${x.trip.crowd?'+'+x.trip.crowd:''}</small>`:'—'}</td><td>${x.trip?x.save:''}</td><td><b>${x.metro>=1?R(x.metro):''}</b>${x.tenths?`<small>${t('m.tenths',{n:x.tenths})}${e?'×'+t('m.tenths',{n:tenth(e.aware)}):''}</small>`:''}</td></tr>`;});
    $('trips').innerHTML=tb+'</tbody>';
  }
  function render(){draw(true);}
  function fit(){$('board').setAttribute('viewBox',`0 0 ${VBW} ${VBH}`);}
  function texts(){
    $('goal').innerHTML=t('m.goal',{pass:P.target,high:P.highScore,master:P.masterScore});
    const v={st:P.stay,wp:P.walkPer,w:P.wait,lc:P.lineCost,sc:P.stationCost,tc:P.trainCost,pt:P.perTrain,b:P.budget,y:P.years,s:tenth(P.aware.start),cb:P.crowdBlocks,nb:P.nearby,
      sp:P.aware.spread,a0:D.destinations[0].attraction,a1:D.destinations[1].attraction,e0:D.destinations[0].carExtra??2,e1:D.destinations[1].carExtra??2,d0:shortD(0),d1:shortD(1)};
    $('rules').innerHTML=['m.r0','m.r1','m.r2','m.rOn','m.r3','m.r4','m.r5'].map(k=>`<li>${t(k,v)}</li>`).join('');
    $('infoBody').innerHTML=t('m.info',v);$('ivBody').innerHTML=t('iv.m2.body',v);
    $('mapLegend').innerHTML=t('m.legend');document.title=t('m.doc');
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
    const tier=plan.total>=P.masterScore?3:plan.total>=P.highScore?2:plan.total>=P.target?1:0,pot=plan.potential();
    $('result').classList.toggle('win',tier>0);$('resultTitle').textContent=t('r.t'+tier);$('resultEn').textContent=['Try again','Cleared','High score','Master'][tier];
    $('resultScore').textContent=t('m.rScore',{d:R(plan.total),y:P.years});
    let h=`<table class="result"><thead><tr><th>${t('m.ryYear')}</th><th>${t('m.ryRiders')}</th><th>${t('m.ryAware')}</th><th>${shortD(0)}</th><th>${shortD(1)}</th><th>${t('m.ryCrowd')}</th></tr></thead><tbody>`;
    for(const l of plan.log)h+=`<tr><td>${t('m.yShort',{y:l.year})}</td><td>${R(l.riders)}</td><td>${t('m.tenths',{n:tenth(l.after.reduce((s,a)=>s+a,0)/l.after.length)})}</td><td>${R(l.dest[0].go)}</td><td>${R(l.dest[1].go)}</td><td>${l.crowdedSections||''}</td></tr>`;
    h+='</tbody></table>';
    const last=plan.log.at(-1),tips=[];
    last.dest.forEach((d,k)=>{const diff=R(d.go-d.before);if(diff)tips.push(t(diff>0?'m.tipGrow':'m.tipShrink',{d:nameD(k),b:R(d.before),g:R(d.go),m:R(d.metro),n:Math.abs(diff)}));});
    const crowdYears=plan.log.filter(l=>l.crowdedSections).length;if(crowdYears)tips.push(t('m.tipCrowd',{n:crowdYears,cb:P.crowdBlocks}));
    D.origins.forEach((o,i)=>{if(last.after[i]<=P.aware.start+.001)tips.push(t('m.tipNever',{a:nameO(i),y:P.years,s:tenth(P.aware.start)}));});
    if(last.riders<pot.riders*.9)tips.push(t('m.tipSlow',{r:R(last.riders),p:R(pot.riders)}));
    $('resultBody').innerHTML=h+`<ul class="ivlist">${tips.slice(0,5).map(s=>`<li>${s}</li>`).join('')}</ul>`;
    try{const k='tl-best-m2-'+D.map;if(plan.total>(+localStorage.getItem(k)||0))localStorage.setItem(k,R(plan.total));}catch(e){}
    window.dispatchEvent(new CustomEvent('tl:result',{detail:{game:'feeder',mode:'m2-metro',version:'7.9',map:D.map,score:R(plan.total),tier,tiers:[P.target,P.highScore,P.masterScore],line:plan.line,stations:plan.stations,trains:plan.trains,lang:I.lang}}));
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
  window.TL_METRO={api,plan:()=>({line:plan.line.map(c=>c.slice()),stations:plan.stations.map(c=>c.slice()),year:plan.year,money:plan.money,trains:plan.trains,total:plan.total,done:plan.done,playing,riders:now().riders,dots:dots.length}),
    cellXY:c=>{const m=board.getScreenCTM(),[x,y]=xy(c);return[m.a*x+m.c*y+m.e,m.b*x+m.d*y+m.f];}};
})();
