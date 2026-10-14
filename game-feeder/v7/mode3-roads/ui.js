(()=>{
  'use strict';
  // v7 · mode 3 «roads that jam» — the page. Mode 2's build-once metro on a real map (Kowloon East) with the roads and
  // the lines already there. Year 0: draw a new line, stations, trains; the map shows the roads as they are. Then the
  // years play: people find the line, cars leave the roads, the roads clear — and drivers, learning slowly, come back.
  const {Plan,D,P,G,year,spread,walk,same,key}=Roads,$=id=>document.getElementById(id),I=window.I18N,t=(k,v)=>I.t(k,v);
  const CS=56,MX=56,MY=70,STEP_MS=1700;
  const xy=c=>[MX+c[0]*CS,MY+c[1]*CS];
  const svg=(tag,a,c='')=>`<${tag} ${Object.entries(a).map(([k,v])=>`${k}="${v}"`).join(' ')}>${c}</${tag}>`;
  let C={};
  function readTokens(){const s=getComputedStyle(document.documentElement),v=n=>s.getPropertyValue('--s-'+n).trim();
    C={paper:v('paper'),panel:v('panel'),soft:v('soft'),raise:v('raise'),ink:v('ink'),ink2:v('ink2'),ink3:v('ink3'),line:v('line'),line2:v('line2'),accent:v('accent'),accent2:v('accent2'),
      warn:v('warn'),bad:v('bad'),info:v('info'),metro:v('metro'),jam:v('jam'),free:v('free')};}
  readTokens();
  const text=(x,y,s,size=14,fill=C.ink,extra={})=>svg('text',{x,y,'font-size':size,fill,stroke:C.paper,'stroke-width':4,'paint-order':'stroke',...extra},s);
  const textW=(s,size)=>[...String(s)].reduce((w,ch)=>w+(ch.charCodeAt(0)>0x2e7f?size:ch===' '?size*.32:size*.6),0);
  const pill=(x,y,s,color,size=13,anchor='middle')=>{const w=textW(s,size)+18,x0=anchor==='start'?x:anchor==='end'?x-w:x-w/2;
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
  const roadName=r=>{const d=D.roads.find(x=>x.name===r);return d?nm(d):r;},lineName=l=>l.isNew?t('r3.newTag'):(I.lang==='zh-Hans'?(l.hans||l.name):l.name);
  const R=Math.round,f1=v=>(Math.round(v*10)/10).toFixed(1),tenth=a=>R(a*10);
  const jamCol=e=>e<.25?C.ink3:e<1?'#E3A008':C.jam;
  // roads sit a little off the cell centres (beside the railways that share their cells)
  const OFF=7,rxy=(s,c)=>{const [x,y]=xy(c),h=s.a[1]===s.b[1];return h?[x,y+OFF]:[x+OFF,y];};
  let plan=new Plan(),tool='draw',hover=null,sel=-1,drag=false,history=[],playing=false,timer=0,fx=null,card=0,cache=null;
  const VBW=MX*2+(D.cols-1)*CS,VBH=MY*2+(D.rows-1)*CS;
  function snapshot(){history.push(JSON.stringify({...plan}));if(history.length>200)history.shift();}
  function restore(s){const p=new Plan();Object.assign(p,JSON.parse(s));plan=p;}
  function curve(a,b,j){const [x1,y1]=xy(a),[x2,y2]=xy(b),dx=x2-x1,dy=y2-y1,L=Math.hypot(dx,dy)||1,bend=Math.min(60,L*.12)*(j%2?1:-1);
    const cx=(x1+x2)/2-dy/L*bend,cy=(y1+y2)/2+dx/L*bend;return{d:`M${x1} ${y1}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2} ${y2}`,mid:[(x1+2*cx+x2)/4,(y1+2*cy+y2)/4]};}
  // this year, computed once per change (the animation redraws often)
  const stateKey=()=>JSON.stringify([plan.line,plan.stations,plan.trains,plan.year]);
  function now(){const k=stateKey();if(!cache||cache.k!==k)cache={k,y:plan.now()};return cache.y;}
  const rowsOf=y=>[...y.est.flatMap(e=>e.to.map(x=>({from:D.origins[e.i].cell,to:D.destinations[x.k].cell,x,who:shortO(e.i),e}))),
    ...(y.chain||[]).map(q=>({from:D.destinations[q.a].cell,to:D.destinations[q.b].cell,x:q,who:shortD(q.a),chain:true}))];
  // each road: its worst section this year, what drivers reckon with there, and «do nothing»
  function roadStats(y){return D.roads.map(r=>{const ids=G.sections.filter(s=>s.roads.includes(r.name)).map(s=>s.id);
    const worst=ids.reduce((b,id)=>y.extra[id]>y.extra[b]?id:b,ids[0]);
    return{name:r.name,ids,worst,extra:y.extra[worst],felt:Math.max(...ids.map(id=>plan.perceived[id])),base:Math.max(...ids.map(id=>G.base.extra[id])),cars:y.roadLoad[worst],cap:G.sections[worst].cap};});}

  /* -------------------------------------------------------------- the board */
  function draw(tm=performance.now()){
    const y=now(),placing=!plan.open;
    let ground='',roads='',cars='',rails='',desire='',lines='',things='',labels='';
    const water=new Set((D.water||[]).map(key));
    for(let x=0;x<D.cols;x++)for(let yy=0;yy<D.rows;yy++){const [cx,cy]=xy([x,yy]),can=placing&&tool==='draw'&&plan.canExtend([x,yy])&&plan.line.length>0,wet=water.has(key([x,yy]));
      ground+=svg('rect',{x:cx-CS/2+2,y:cy-CS/2+2,width:CS-4,height:CS-4,rx:4,fill:can?C.metro:wet?C.info:C.soft,'fill-opacity':can?.10:wet?.10:.5,stroke:can?C.metro:wet?'none':C.line,'stroke-opacity':can?.45:1,'stroke-dasharray':can?'4 3':''});}
    // roads: wide, coloured by this year's jam; dots are cars, slower where it jams
    G.sections.forEach(s=>{const [x1,y1]=rxy(s,s.a),[x2,y2]=rxy(s,s.b),e=y.extra[s.id],w=5+Math.min(7,s.cap/10);
      roads+=svg('path',{d:`M${x1} ${y1}L${x2} ${y2}`,stroke:jamCol(e),'stroke-width':w.toFixed(1),'stroke-opacity':e<.25?.35:.6,'stroke-linecap':'round'});
      const n=Math.min(7,Math.round(y.roadLoad[s.id]/9)),sp=.55/(1+e);
      for(let k=0;k<n;k++){const ph=((tm/1000)*sp+k/n+s.id*.37)%1,fwd=k%2===0,f=fwd?ph:1-ph,px=x1+(x2-x1)*f,py=y1+(y2-y1)*f;
        cars+=`<rect x="${(px-2.5).toFixed(1)}" y="${(py-2.5).toFixed(1)}" width="5" height="5" rx="1" fill="${C.ink2}" opacity=".8"/>`;}});
    // the lines already there
    G.lines.forEach((l,li)=>{rails+=svg('path',{d:'M'+l.cells.map(c=>xy(c).join(' ')).join('L'),fill:'none',stroke:l.color,'stroke-width':6,'stroke-linejoin':'round','stroke-linecap':'round','stroke-opacity':.9});
      const load=y.lines.find(z=>z.name===l.name);
      l.stations.forEach((s,j)=>{const [x,yy]=xy(s);rails+=svg('circle',{cx:x,cy:yy,r:7,fill:C.panel,stroke:l.color,'stroke-width':3});
        const nmS=(I.lang==='zh-Hans'?l.namesHans:l.names)?.[j];if(nmS)labels+=text(x+10,yy+14,nmS,11,l.color,{'font-weight':600});});
      if(load&&load.crowded.some(Boolean))load.crowded.forEach((c,j)=>{if(!c)return;const [x1,y1]=xy(l.cells[j]),[x2,y2]=xy(l.cells[j+1]);rails+=svg('path',{d:`M${x1} ${y1}L${x2} ${y2}`,stroke:C.bad,'stroke-width':10,'stroke-opacity':.35,'stroke-linecap':'round'});});});
    // desire lines, faint; the selected one in full
    const rows=rowsOf(y);
    rows.forEach(({from,to,x,chain},j)=>{const {d:path,mid}=curve(from,to,j),w=1+x.go/6,on=sel===j;
      desire+=svg('path',{d:path,fill:'none',stroke:on?C.ink:C.ink3,'stroke-width':w.toFixed(1),'stroke-opacity':on?.5:sel>=0?.06:.13,'stroke-linecap':'round'});
      if(x.metro>.5)desire+=svg('path',{d:path,fill:'none',stroke:C.metro,'stroke-width':(w*x.metro/x.go).toFixed(1),'stroke-opacity':on?.85:sel>=0?.1:.3,'stroke-linecap':'round'});
      if(on)labels+=pill(mid[0],mid[1],t('r3.dl',{c:R(x.drivers),m:R(x.metro)}),C.ink2,12.5);});
    if(sel>=0&&rows[sel]){const {from:o,to:d,x}=rows[sel],seg=(a,b)=>`M${xy(a).join(' ')}L${xy([b[0],a[1]]).join(' ')}L${xy(b).join(' ')}`;
      if(x.drivers>.5&&x.route)lines+=x.route.sections.map(id=>{const s=G.sections[id],[x1,y1]=rxy(s,s.a),[x2,y2]=rxy(s,s.b);return svg('path',{d:`M${x1} ${y1}L${x2} ${y2}`,stroke:C.ink,'stroke-width':3,'stroke-dasharray':'1 6','stroke-linecap':'round'});}).join('');
      if(x.trip)lines+=svg('path',{d:seg(o,x.trip.from),fill:'none',stroke:C.metro,'stroke-width':2.5,'stroke-dasharray':'2 5'})+svg('path',{d:seg(x.trip.to,d),fill:'none',stroke:C.metro,'stroke-width':2.5,'stroke-dasharray':'2 5'});}
    // the new line, section by section (orange: nearly full, red: crowded)
    const mine=y.lines.find(l=>l.isNew);
    for(let s=0;s+1<plan.line.length;s++){const [x1,y1]=xy(plan.line[s]),[x2,y2]=xy(plan.line[s+1]),f=mine?mine.load[s]/mine.cap:0,col=f>1?C.bad:f>.8?C.warn:C.metro;
      lines+=svg('path',{d:`M${x1} ${y1}L${x2} ${y2}`,stroke:col,'stroke-width':11,'stroke-linecap':'round'});}
    if(plan.line.length===1){const [x,yy]=xy(plan.line[0]);lines+=svg('circle',{cx:x,cy:yy,r:7,fill:C.metro});}
    if(mine){const worst=mine.load.reduce((b,v,j)=>v>mine.load[b]?j:b,0),f=mine.load[worst]/mine.cap;
      if(f>.8){const a=xy(plan.line[worst]),b=xy(plan.line[worst+1]);labels+=pill((a[0]+b[0])/2,(a[1]+b[1])/2-22,t(f>1?'m.crowd':'m.nearly',{a:R(mine.load[worst]),b:mine.cap}),f>1?C.bad:C.warn,12);}}
    if(placing&&tool==='draw')for(const e of [plan.line[0],plan.line.at(-1)])if(e){const [x,yy]=xy(e);things+=svg('circle',{cx:x,cy:yy,r:9,fill:C.panel,stroke:C.metro,'stroke-width':3,'stroke-dasharray':'3 2'});}
    // the two most jammed roads, named
    roadStats(y).filter(r=>r.extra>=.5).sort((a,b)=>b.extra-a.extra).slice(0,2).forEach(r=>{const s=G.sections[r.worst],[x1,y1]=rxy(s,s.a),[x2,y2]=rxy(s,s.b);
      labels+=pill((x1+x2)/2,(y1+y2)/2-16,t('r3.jamPill',{r:roadName(r.name),e:f1(r.extra)}),jamCol(r.extra),11.5);});
    // hover preview while placing
    if(hover&&placing){const [hx,hy]=xy(hover);
      if(tool==='draw'){
        if(plan.canExtend(hover)){const end=!plan.line.length?null:Roads.adj(hover,plan.line.at(-1))?plan.line.at(-1):plan.line[0];
          if(end)lines+=svg('path',{d:`M${xy(end).join(' ')}L${hx} ${hy}`,stroke:C.metro,'stroke-width':11,'stroke-opacity':.35,'stroke-linecap':'round'});
          else lines+=svg('circle',{cx:hx,cy:hy,r:7,fill:C.metro,'fill-opacity':.4});
          labels+=pill(hx,hy-20,t('m.pvExtend',{c:P.lineCost}),C.metro,12);}
        else if(plan.canShorten(hover))labels+=pill(hx,hy-20,t('m.pvShorten'),C.ink2,12);}
      else if(plan.onLine(hover)){const has=plan.isStation(hover);
        if(!has&&plan.money<P.stationCost)labels+=pill(hx,hy-22,t('m.pvNoMoney'),C.bad,12);
        else{const pv=preview(hover);
          if(!has)things+=svg('circle',{cx:hx,cy:hy,r:14,fill:C.panel,stroke:C.metro,'stroke-width':5,'stroke-opacity':.5,'stroke-dasharray':'4 3'});
          const sg=v=>(v>=0?'+':'−')+Math.abs(v);
          labels+=pill(hx,hy-24,(has?t('m.pvRemove'):t('m.pvAdd'))+' '+t('r3.pv',{r:sg(pv.dr),j:sg(pv.dj)})+' · '+t(has?'m.pvRefund':'m.pvCost',{c:P.stationCost}),pv.dj<0?C.accent:pv.dj>0?C.bad:C.ink2,12);}}}
    // estates and business areas
    y.est.forEach(e=>{const o=D.origins[e.i],[cx,cy]=xy(o.cell),up=o.house[1]<0,side=o.house[0]!==0,a=tenth(e.aware);
      things+=sprite(ESTATE,cx-16,cy-21,2.7,{k:C.ink,w:C.paper,l:C.warn,g:C.ink2});
      const lx=side?cx+(o.house[0]>0?24:-24):cx,la=side?(o.house[0]>0?'start':'end'):'middle',ly=side?cy-14:up?cy-32:cy+30;
      labels+=text(lx,ly,nameO(e.i)+(o.tag==='new'?' ★':''),14,C.ink,{'text-anchor':la,'font-weight':700});
      const bx=la==='start'?lx:la==='end'?lx-60:lx-30,by=ly+5;for(let k=0;k<10;k++)labels+=svg('rect',{x:bx+k*6,y:by,width:5,height:7,fill:k<a?C.accent:C.raise,stroke:k<a?'none':C.line2,'stroke-width':.8,'shape-rendering':'crispEdges'});
      labels+=text(lx,by+20,t('r3.estLine',{a,c:R(e.drivers),m:R(e.metro)}),11.5,e.onNew>=1?C.metro:C.ink2,{'text-anchor':la,'font-weight':600});
      if(fx&&tm<fx.until&&fx.aware[e.i]>0){const k=(fx.until-tm)/1800;labels+=svg('text',{x:cx+20,y:(cy-6-18*(1-k)).toFixed(1),'font-size':14,'font-weight':700,fill:C.accent,opacity:Math.min(1,k*1.5).toFixed(2)},t('m.fxAware',{n:fx.aware[e.i]}));}});
    y.dest.forEach(d=>{const o=D.destinations[d.k],[cx,cy]=xy(o.cell),sp=DEST[o.kind],w=sp[0].length*2.7,diff=R(d.go-d.before);
      things+=sprite(sp,cx-w/2,cy-21,2.7,{k:C.ink,w:C.paper,a:DCOL(o.kind),r:C.accent2,p:C.paper,l:C.warn,d:DCOL(o.kind),g:C.ink2});
      const side=o.house[0]!==0,lx=side?cx+(o.house[0]>0?w/2+6:-w/2-6):cx,ly=side?cy-6:cy+30,la=side?(o.house[0]>0?'start':'end'):'middle';
      labels+=text(lx,ly,nameD(d.k),14,DCOL(o.kind),{'text-anchor':la,'font-weight':700});
      labels+=svg('text',{x:lx,y:ly+16,'font-size':11.5,'text-anchor':la,'font-weight':600,stroke:C.paper,'stroke-width':4,'paint-order':'stroke'},
        `<tspan fill="${C.ink2}">${t('m.dstLine',{g:R(d.go),b:R(d.before)})}</tspan>`+(diff?`<tspan fill="${diff>0?C.accent:C.bad}"> ${diff>0?'↑+':'↓'}${diff}</tspan>`:''));});
    // trains on the new line, then its stations on top
    const order=plan.stations.map(s=>({s,x:plan.line.findIndex(c=>same(c,s))})).sort((a,b)=>a.x-b.x);
    if(order.length>=2){const a=order[0].x,b=order.at(-1).x,span=Math.max(1,b-a);
      for(let k=0;k<plan.trains;k++){const ph=(tm/1000*1.6+k*2*span/plan.trains)%(2*span),pos=a+(ph<span?ph:2*span-ph),i=Math.min(plan.line.length-1,Math.floor(pos)),f=pos-i,c1=plan.line[i],c2=plan.line[Math.min(plan.line.length-1,i+1)];
        const [x1,y1]=xy(c1),[x2,y2]=xy(c2);lines+=`<g opacity=".9" transform="translate(${(x1+(x2-x1)*f-25.5).toFixed(1)} ${(y1+(y2-y1)*f-8).toFixed(1)})">`+sprite(TRAIN,0,0,2.7,{m:C.metro,w:C.paper,k:C.ink})+'</g>';}}
    order.forEach(({s},n)=>{const [x,yy]=xy(s);
      things+=svg('circle',{cx:x,cy:yy,r:13,fill:C.panel,stroke:C.metro,'stroke-width':5})+svg('text',{x,y:yy+5,'font-size':13,'font-weight':700,fill:C.metro,'text-anchor':'middle','font-family':'Geist Mono,monospace'},n+1);});
    $('board').innerHTML=ground+roads+cars+rails+desire+lines+things+labels;
  }
  // a station here or not: one year with everybody knowing the line and today's roads
  function preview(c){const all=D.origins.map(()=>1),q=new Plan();Object.assign(q,JSON.parse(JSON.stringify({...plan})));q.toggleStation(c);
    const a=year(plan.stations.length>=2?plan:null,all,plan.perceived,plan.crowded),b=year(q.stations.length>=2?q:null,all,plan.perceived,plan.crowded);
    return{dr:R(b.onNew-a.onNew),dj:R(b.jam-a.jam)};}

  /* -------------------------------------------------------------- side panels */
  function side(){
    const y=now(),nx=spread(y,plan.aware),hi=R(P.masterScore*1.12),at=v=>Math.max(0,Math.min(100,100*v/hi)),n0=R(G.doNothing[0]);
    $('score').textContent=R(plan.total);$('scoreBar').style.width=`${at(plan.total)}%`;
    for(const [id,v,k] of [['tickPass',P.target,'g.tickPass'],['tickHigh',P.highScore,'g.tickHigh'],['tickMaster',P.masterScore,'g.tickMaster']]){$(id).style.left=`${at(v)}%`;$(id).dataset.label=t(k,{n:v});}
    $('yearNum').textContent=plan.done?t('m.yearDone',{m:P.years}):plan.open?t('m.yearN',{y:plan.year,m:P.years}):t('m.yearPlan');
    $('run').textContent=plan.done?t('m.runDone'):plan.open?(playing?t('m.playing'):t('m.runN',{n:plan.year+1})):t('m.run0');
    $('run').disabled=playing||(!plan.done&&!plan.canRun());
    $('pause').hidden=!plan.open||plan.done;$('pause').textContent=playing?t('m.pause'):t('m.play');$('rewind').hidden=!plan.open;
    // the jam a day, year by year; «do nothing» dashed
    const top=Math.max(...G.doNothing,...plan.log.map(l=>l.jam),y.jam)*1.12;
    let yc='';for(let k=1;k<=P.years;k++){const l=plan.log[k-1],v=l?l.jam:k===plan.year+1&&!plan.done&&plan.stations.length>=2?y.jam:0,h=R(52*v/top);
      yc+=`<div class="yb ${l?'done':k===plan.year+1?'next':''} ${l&&l.crowdedSections?'crowd':''}"><i style="height:${h}px"></i><b>${v?R(v):''}</b><small>${t('m.yShort',{y:k})}</small></div>`;}
    yc+=`<div class="ypot" style="bottom:${(18+52*G.doNothing[0]/top).toFixed(0)}px"><span>${t('r3.yNothing',{n:n0})}</span></div>`;
    $('yChart').innerHTML=yc;
    $('yNote').innerHTML=plan.stations.length<2?t('r3.yNoteNone'):plan.open?t('r3.yNoteN',{y:plan.year,j:R(plan.log.at(-1)?.jam??0),n:n0}):t('r3.yNote0',{j:R(y.jam),n:n0});
    $('planBox').classList.toggle('locked',plan.open);
    $('money').textContent=`${plan.money} / ${P.budget}`;
    $('moneyNote').innerHTML=t('m.money0',{lc:P.lineCost,sc:P.stationCost,tc:P.trainCost});
    $('trainsTxt').innerHTML=t('m.trains',{n:plan.trains,c:plan.trains*P.perTrain});
    $('trainPlus').disabled=!plan.canTrain();$('trainMinus').disabled=!plan.canUntrain();
    document.querySelectorAll('#toolSeg [data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===tool)));
    $('toolHint').textContent=plan.open?t('m.hintOpen'):tool==='draw'?(plan.line.length?t('m.hintDraw2'):t('m.hintDraw1')):(plan.line.length<2?t('m.hintNeedLine'):plan.stations.length<2?t('r3.hintStation1'):t('m.hintStation2'));
    $('undo').disabled=!history.length||plan.open;$('clear').disabled=plan.open||!plan.line.length;
    // the roads: this year's jam on each, what drivers reckon with, «do nothing»
    const scale=3;let h=`<p class="jamline">${t('r3.jamNow',{j:R(y.jam),n:n0})}</p>`;
    roadStats(y).forEach(r=>{const w=v=>Math.min(100,100*v/scale).toFixed(1);
      h+=`<div class="rr"><span class="xn">${roadName(r.name)}</span><span class="rbar"><i style="width:${w(r.extra)}%;background:${jamCol(r.extra)}"></i><s style="left:${w(r.base)}%"></s><u style="left:${w(r.felt)}%"></u></span><b style="color:${jamCol(r.extra)}">${t('r3.extra',{e:f1(r.extra)})}</b></div>`;});
    $('roadBox').innerHTML=h+`<p class="hbnote">${t('r3.roadNote',{lp:R(P.learn*10)+(I.lang==='en'?'/10':' 成')})}</p>`;
    let a='';y.est.forEach(e=>{const v=tenth(e.aware),d=tenth(nx[e.i])-v;
      a+=`<div class="xr"><span class="xn">${shortO(e.i)}</span><span class="abar">${Array.from({length:10},(_,k)=>`<i class="${k<v?'on':''}"></i>`).join('')}</span><b>${t('m.tenths',{n:v})}</b><em class="${d>0?'up':''}">${plan.done?'':d>0?t('m.awNext',{n:d}):t('m.awSame')}</em></div>`;});
    $('awareBox').innerHTML=a+`<p class="hbnote">${t('r3.awNote',{s:tenth(P.aware.start)})}</p>`;
    let tb=`<thead><tr><th>${t('m.tTrip')}</th><th>${t('m.tGo')}</th><th>${t('r3.tCar')}</th><th>${t('m.tMetro')}</th><th>${t('r3.tDrive')}</th><th>${t('m.tRiders')}</th></tr></thead><tbody>`;
    rowsOf(y).forEach(({x,who,chain},k)=>{const jamPart=x.route?x.route.sections.reduce((s,id)=>s+plan.perceived[id],0):0;
      tb+=`<tr data-row="${k}" class="${sel===k?'sel':''} ${x.metro>=1?'on':''} ${chain?'chain':''}"><td>${who}<small>→ ${shortD(x.k)}${chain?' · '+t('m.chainTag'):''}</small></td><td>${R(x.go)}<small>${t('m.was',{b:R(x.before)})}</small></td>`+
        `<td>${f1(x.car)}<small>${t('r3.carSum',{b:f1(x.car-jamPart),j:f1(jamPart)})}</small></td><td>${x.trip?(Number.isInteger(x.trip.blocks)?x.trip.blocks:f1(x.trip.blocks)):'—'}<small>${x.trip?x.trip.lines.map(n=>n==='new'?t('r3.newTag'):lineName(G.lines.find(l=>l.name===n)||{name:n})).join('→'):''}</small></td>`+
        `<td>${R(x.drivers)}</td><td><b>${x.metro>=1?R(x.metro):''}</b></td></tr>`;});
    $('trips').innerHTML=tb+'</tbody>';
  }
  function render(){draw();side();}
  function fit(){draw();try{const bb=$('board').getBBox(),x0=Math.min(0,bb.x-14),y0=Math.min(0,bb.y-14),x1=Math.max(VBW,bb.x+bb.width+14),y1=Math.max(VBH,bb.y+bb.height+14);
    $('board').setAttribute('viewBox',`${x0} ${y0} ${x1-x0} ${y1-y0}`);}catch(e){}}
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
    fx={until:performance.now()+1800,aware:r.after.map((a,i)=>tenth(a)-tenth(r.before[i]))};
    const felt=r.y.extra.reduce((s,e,id)=>s+e-r.perBefore[id],0);
    showCard(t('m.cardTitle',{y:r.year}),[t('r3.cardJam',{j:R(r.jam),n:R(r.jam0),s:R(r.saved)}),t('r3.cardMode',{c:R(r.drivers),m:R(r.onNew)}),
      t('m.cardAware',{a:tenth(r.after.reduce((s,a)=>s+a,0)/r.after.length)}),Math.abs(felt)>.05?t(felt<0?'r3.cardBetter':'r3.cardWorse'):'',
      r.crowdedSections?t('r3.cardCrowd',{n:r.crowdedSections,cb:P.crowdBlocks}):''].filter(Boolean),r.crowdedSections?'warn':'');
    render();if(plan.done){stop();setTimeout(result,1500);}
  }
  function showCard(title,rows,kind){const el=$('yearCard');el.className='yearcard on '+kind;el.innerHTML=`<b>${title}</b>`+rows.map(s=>`<span>${s}</span>`).join('');
    clearTimeout(card);card=setTimeout(()=>el.classList.remove('on'),STEP_MS+400);}
  function play(){if(plan.done)return;playing=true;clearInterval(timer);timer=setInterval(step,STEP_MS);render();}
  function stop(){playing=false;clearInterval(timer);render();}
  function open(){if(!plan.canRun())return;history=[];tool='draw';hover=null;step();play();}
  function rewind(){stop();plan.rewind();fx=null;$('yearCard').classList.remove('on');render();}
  function result(){
    const tier=plan.total>=P.masterScore?3:plan.total>=P.highScore?2:plan.total>=P.target?1:0;
    $('result').classList.toggle('win',tier>0);$('resultTitle').textContent=t('r.t'+tier);$('resultEn').textContent=['Try again','Cleared','High score','Master'][tier];
    $('resultScore').textContent=t('r3.rScore',{d:R(plan.total),y:P.years});
    let h=`<table class="result"><thead><tr><th>${t('m.ryYear')}</th><th>${t('r3.ryJam')}</th><th>${t('r3.ryNothing')}</th><th>${t('r3.rySaved')}</th><th>${t('r3.ryDrive')}</th><th>${t('r3.ryNew')}</th><th>${t('m.ryAware')}</th></tr></thead><tbody>`;
    for(const l of plan.log)h+=`<tr><td>${t('m.yShort',{y:l.year})}</td><td>${R(l.jam)}</td><td>${R(l.jam0)}</td><td>${R(l.saved)}</td><td>${R(l.drivers)}</td><td>${R(l.onNew)}</td><td>${t('m.tenths',{n:tenth(l.after.reduce((s,a)=>s+a,0)/l.after.length)})}</td></tr>`;
    h+='</tbody></table>';
    const tips=[],lo=plan.log.reduce((b,l)=>l.jam<b.jam?l:b,plan.log[0]),last=plan.log.at(-1);
    if(lo.year<P.years&&last.jam>lo.jam*1.05)tips.push(t('r3.tipRebound',{lo:lo.year,a:R(lo.jam),b:R(last.jam)}));
    const worst=roadStats(now()).sort((a,b)=>b.extra-a.extra)[0];if(worst&&worst.extra>=.5)tips.push(t('r3.tipWorst',{r:roadName(worst.name),e:f1(worst.extra)}));
    const crowdYears=plan.log.filter(l=>l.crowdedSections).length;if(crowdYears)tips.push(t('r3.tipCrowd',{n:crowdYears}));
    D.origins.forEach((o,i)=>{if(last.after[i]<=P.aware.start+.001)tips.push(t('r3.tipNever',{a:nameO(i)}));});
    $('resultBody').innerHTML=h+`<ul class="ivlist">${tips.slice(0,5).map(s=>`<li>${s}</li>`).join('')}</ul>`;
    try{const k='tl-best-m3-'+D.map;if(plan.total>(+localStorage.getItem(k)||0))localStorage.setItem(k,R(plan.total));}catch(e){}
    window.dispatchEvent(new CustomEvent('tl:result',{detail:{game:'feeder',mode:'m3-roads',version:'7.8',map:D.map,score:R(plan.total),tier,tiers:[P.target,P.highScore,P.masterScore],line:plan.line,stations:plan.stations,trains:plan.trains,lang:I.lang}}));
    $('result').showModal();
  }

  /* -------------------------------------------------------------- controls */
  const board=$('board');
  function cellAt(e){const pt=board.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;const p=pt.matrixTransform(board.getScreenCTM().inverse());
    const c=[Math.round((p.x-MX)/CS),Math.round((p.y-MY)/CS)];return c[0]>=0&&c[1]>=0&&c[0]<D.cols&&c[1]<D.rows?c:null;}
  function act(c){
    if(plan.open){showCard(t('m.cardLocked'),[t('m.cardLocked2')],'');return false;}
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
  window.addEventListener('tl:lang',()=>{texts();fit();render();});
  let lastFrame=0;(function loop(tm){if(tm-lastFrame>70&&!drag){draw(tm);lastFrame=tm;}requestAnimationFrame(loop);})(0);
  // test hook: #intro=0&line=2,2;3,2;4,2&stations=2,2;4,2&trains=2&years=3&tool=station&sel=0&theme=dark&lang=en
  const q=new URLSearchParams(location.hash.slice(1));
  let saved=null;try{saved=localStorage.getItem('tl-theme');}catch(e){}
  board.setAttribute('viewBox',`0 0 ${VBW} ${VBH}`);
  if(q.get('theme')||saved)setTheme(q.get('theme')||saved);
  if(q.get('line'))for(const s of q.get('line').split(';'))plan.extend(s.split(',').map(Number));
  if(q.get('stations'))for(const s of q.get('stations').split(';'))plan.toggleStation(s.split(',').map(Number));
  for(let k=1;k<+(q.get('trains')||1);k++)plan.addTrain();
  for(let k=0;k<+(q.get('years')||0);k++)plan.runYear();
  if(q.get('tool'))tool=q.get('tool');if(q.get('sel'))sel=+q.get('sel');
  texts();fit();render();
  if(q.get('intro')!=='0'&&!q.get('line'))$('lvIntro').showModal();
  // for the AI demo (demo.js): set a plan up step by step, then open it
  const api={reset(){stop();plan=new Plan();history=[];sel=-1;tool='draw';hover=null;fx=null;$('yearCard').classList.remove('on');render();},
    extend(c){const ok=plan.extend(c);render();return ok;},station(c){tool='station';const ok=plan.toggleStation(c);render();return ok;},
    train(){const ok=plan.addTrain();render();return ok;},go(){open();},halt(){stop();},get plan(){return plan;}};
  window.TL_ROADS={api,plan:()=>({line:plan.line.map(c=>c.slice()),stations:plan.stations.map(c=>c.slice()),year:plan.year,money:plan.money,trains:plan.trains,total:plan.total,done:plan.done,playing,jam:now().jam}),
    cellXY:c=>{const m=board.getScreenCTM(),[x,y]=xy(c);return[m.a*x+m.c*y+m.e,m.b*x+m.d*y+m.f];}};
})();
