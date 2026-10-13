(()=>{
  'use strict';
  // v7 · mode 2 «the metro», build once and watch it grow — the page. Year 0: draw a line, its stations and buy its
  // trains within the budget; the map shows year 1 and the line's potential. Then the years play by themselves: word
  // of mouth spreads, more people take the metro and more go to the places it reaches. Back to planning any time.
  const {Plan,D,P,spread,walk,same,key}=Metro,$=id=>document.getElementById(id),I=window.I18N,t=(k,v)=>I.t(k,v);
  const CS=60,MX=60,MY=70,STEP_MS=1600;
  const xy=c=>[MX+c[0]*CS,MY+c[1]*CS];
  const svg=(tag,a,c='')=>`<${tag} ${Object.entries(a).map(([k,v])=>`${k}="${v}"`).join(' ')}>${c}</${tag}>`;
  let C={};
  function readTokens(){const s=getComputedStyle(document.documentElement),v=n=>s.getPropertyValue('--s-'+n).trim();
    C={paper:v('paper'),panel:v('panel'),soft:v('soft'),raise:v('raise'),ink:v('ink'),ink2:v('ink2'),ink3:v('ink3'),line:v('line'),line2:v('line2'),accent:v('accent'),accent2:v('accent2'),
      warn:v('warn'),bad:v('bad'),info:v('info'),metro:v('metro')};}
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
  const nameO=i=>I.name(D.origins[i]),nameD=k=>I.name(D.destinations[k]),shortD=k=>{const d=D.destinations[k];return I.lang==='zh-Hans'?(d.shortHans||d.hans):(d.short||d.name);};
  const R=Math.round,tenth=a=>R(a*10),sw=c=>`<i class="sw" style="background:${c}"></i>`;
  let plan=new Plan(),tool='draw',hover=null,sel=-1,drag=false,history=[],playing=false,timer=0,fx=null,card=0;
  const VBW=MX*2+(D.cols-1)*CS,VBH=MY*2+(D.rows-1)*CS;
  function snapshot(){history.push(JSON.stringify({...plan}));if(history.length>200)history.shift();}
  function restore(s){const p=new Plan();Object.assign(p,JSON.parse(s));plan=p;}
  function curve(a,b,j){const [x1,y1]=xy(a),[x2,y2]=xy(b),dx=x2-x1,dy=y2-y1,L=Math.hypot(dx,dy)||1,bend=Math.min(60,L*.12)*(j%2?1:-1);
    const cx=(x1+x2)/2-dy/L*bend,cy=(y1+y2)/2+dx/L*bend;return{d:`M${x1} ${y1}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2} ${y2}`,mid:[(x1+2*cx+x2)/4,(y1+2*cy+y2)/4]};}

  // every desire line of a year: estate → destination, then destination → destination (people going on)
  const rowsOf=y=>[...y.est.flatMap(e=>e.to.map(x=>({from:D.origins[e.i].cell,to:D.destinations[x.k].cell,x,who:nameO(e.i)}))),
    ...(y.chain||[]).map(q=>({from:D.destinations[q.a].cell,to:D.destinations[q.b].cell,x:q,who:shortD(q.a),chain:true}))];

  /* -------------------------------------------------------------- the board */
  function draw(now=performance.now()){
    const y=plan.now(),placing=!plan.open;
    let ground='',desire='',lines='',things='',labels='';
    for(let x=0;x<D.cols;x++)for(let yy=0;yy<D.rows;yy++){const [cx,cy]=xy([x,yy]),can=placing&&tool==='draw'&&plan.canExtend([x,yy])&&plan.line.length>0;
      ground+=svg('rect',{x:cx-CS/2+3,y:cy-CS/2+3,width:CS-6,height:CS-6,rx:5,fill:can?C.metro:C.soft,'fill-opacity':can?.10:.55,stroke:can?C.metro:C.line,'stroke-opacity':can?.45:1,'stroke-dasharray':can?'4 3':''});}
    // desire lines: thickness = people going there now; the brown core = those on the metro
    // the pills: only the four busiest metro desire lines (the table has them all)
    const rows=rowsOf(y),busy=rows.map(r=>r.x.metro).map((m,k)=>[m,k]).filter(([m])=>m>=1).sort((a,b)=>b[0]-a[0]).slice(0,4).map(([,k])=>k);
    rows.forEach(({from,to,x,chain},j)=>{const {d:path,mid}=curve(from,to,j),w=1.5+x.go/4,on=sel===j;
      desire+=svg('path',{d:path,fill:'none',stroke:on?C.ink:C.ink3,'stroke-width':w.toFixed(1),'stroke-opacity':on?.5:sel>=0?.12:x.byFoot?.4:.28,'stroke-linecap':'round','stroke-dasharray':x.byFoot?`0.1 ${(w+6).toFixed(1)}`:''});
      if(x.metro>.5)desire+=svg('path',{d:path,fill:'none',stroke:C.metro,'stroke-width':(w*x.metro/x.go).toFixed(1),'stroke-opacity':sel>=0&&!on?.25:.85,'stroke-linecap':'round'});
      if(on)labels+=pill(mid[0],mid[1],t('m.dlFull',{g:R(x.go),b:R(x.before),m:R(x.metro)}),x.metro>.5?C.metro:C.ink2,12.5);
      else if(sel<0&&busy.includes(j))labels+=pill(mid[0],mid[1],t(chain?'m.dlOn':'m.dl',{g:R(x.go),m:R(x.metro)}),C.metro,12);});
    if(sel>=0&&rows[sel]&&rows[sel].x.trip){const {from:o,to:d,x}=rows[sel],seg=(a,b)=>`M${xy(a).join(' ')}L${xy([b[0],a[1]]).join(' ')}L${xy(b).join(' ')}`;
      lines+=svg('path',{d:seg(o,x.trip.from),fill:'none',stroke:C.ink,'stroke-width':2.5,'stroke-dasharray':'2 5','stroke-linecap':'round'})+svg('path',{d:seg(x.trip.to,d),fill:'none',stroke:C.ink,'stroke-width':2.5,'stroke-dasharray':'2 5','stroke-linecap':'round'});}
    // the line, section by section (orange: nearly full, red: crowded)
    let worst=-1;
    for(let s=0;s+1<plan.line.length;s++){const [x1,y1]=xy(plan.line[s]),[x2,y2]=xy(plan.line[s+1]),f=y.load[s]/y.cap,col=f>1?C.bad:f>.8?C.warn:C.metro;
      if(f>1)lines+=svg('path',{d:`M${x1} ${y1}L${x2} ${y2}`,stroke:C.bad,'stroke-width':22,'stroke-opacity':(.15+.06*Math.sin(now/300)).toFixed(3),'stroke-linecap':'round'});
      lines+=svg('path',{d:`M${x1} ${y1}L${x2} ${y2}`,stroke:col,'stroke-width':12,'stroke-linecap':'round'});if(worst<0||y.load[s]>y.load[worst])worst=s;}
    if(plan.line.length===1){const [x,yy]=xy(plan.line[0]);lines+=svg('circle',{cx:x,cy:yy,r:7,fill:C.metro});}
    if(worst>=0&&plan.stations.length>=2&&y.load[worst]>.8*y.cap){const a=xy(plan.line[worst]),b=xy(plan.line[worst+1]),f=y.load[worst]/y.cap;
      labels+=pill((a[0]+b[0])/2,(a[1]+b[1])/2-24,t(f>1?'m.crowd':'m.nearly',{a:R(y.load[worst]),b:y.cap}),f>1?C.bad:C.warn,12.5);}
    if(placing&&tool==='draw')for(const e of [plan.line[0],plan.line.at(-1)])if(e){const [x,yy]=xy(e);things+=svg('circle',{cx:x,cy:yy,r:9,fill:C.panel,stroke:C.metro,'stroke-width':3,'stroke-dasharray':'3 2'});}
    // hover preview while placing
    if(hover&&placing){const [hx,hy]=xy(hover);
      if(tool==='draw'){
        if(plan.canExtend(hover)){const end=!plan.line.length?null:Metro.adj(hover,plan.line.at(-1))?plan.line.at(-1):plan.line[0];
          if(end)lines+=svg('path',{d:`M${xy(end).join(' ')}L${hx} ${hy}`,stroke:C.metro,'stroke-width':12,'stroke-opacity':.35,'stroke-linecap':'round'});
          else lines+=svg('circle',{cx:hx,cy:hy,r:7,fill:C.metro,'fill-opacity':.4});
          labels+=pill(hx,hy-22,t('m.pvExtend',{c:P.lineCost}),C.metro,12);}
        else if(plan.canShorten(hover))labels+=pill(hx,hy-22,t('m.pvShorten'),C.ink2,12);}
      else if(plan.onLine(hover)){const has=plan.isStation(hover);
        if(!has&&plan.money<P.stationCost)labels+=pill(hx,hy-24,t('m.pvNoMoney'),C.bad,12);
        else{const q=new Plan();Object.assign(q,JSON.parse(JSON.stringify({...plan})));q.toggleStation(hover);const dv=R(q.potential().riders-plan.potential().riders);
          if(!has)things+=svg('circle',{cx:hx,cy:hy,r:15,fill:C.panel,stroke:C.metro,'stroke-width':5,'stroke-opacity':.5,'stroke-dasharray':'4 3'});
          labels+=pill(hx,hy-26,(has?t('m.pvRemove'):t('m.pvAdd'))+' '+t(dv>=0?'m.pvGain':'m.pvLoss',{n:Math.abs(dv)})+' · '+t(has?'m.pvRefund':'m.pvCost',{c:P.stationCost}),dv>0?C.accent:dv<0?C.bad:C.ink2,12.5);}}}
    // estates: name, how many know the metro (ten cells), how many ride it
    y.est.forEach(e=>{const o=D.origins[e.i],[cx,cy]=xy(o.cell),up=o.house[1]<0,a=tenth(e.aware);
      things+=sprite(ESTATE,cx-18,cy-24,3,{k:C.ink,w:C.paper,l:C.warn,g:C.ink2});
      labels+=text(cx,up?cy-34:cy+32,nameO(e.i),15.5,C.ink,{'text-anchor':'middle','font-weight':700});
      const by=up?cy-60:cy+40;for(let k=0;k<10;k++)labels+=svg('rect',{x:cx-30+k*6,y:by,width:5,height:8,fill:k<a?C.accent:C.raise,stroke:k<a?'none':C.line2,'stroke-width':.8,'shape-rendering':'crispEdges'});
      labels+=text(cx,up?cy-66:cy+62,t('m.estLine',{a,r:R(e.metro),n:e.n}),12,e.metro>=1?C.metro:C.ink2,{'text-anchor':'middle','font-weight':600});
      if(fx&&now<fx.until&&fx.aware[e.i]>0){const k=(fx.until-now)/1800;labels+=svg('text',{x:cx+24,y:(cy-2-18*(1-k)).toFixed(1),'font-size':15,'font-weight':700,fill:C.accent,opacity:Math.min(1,k*1.5).toFixed(2),'text-anchor':'start'},t('m.fxAware',{n:fx.aware[e.i]}));}});
    y.dest.forEach(d=>{const o=D.destinations[d.k],[cx,cy]=xy(o.cell),sp=DEST[o.kind],w=sp[0].length*3,diff=R(d.go-d.before);
      things+=sprite(sp,cx-w/2,cy-24,3,{k:C.ink,w:C.paper,a:DCOL(o.kind),r:C.accent2,p:C.paper,l:C.warn,d:DCOL(o.kind),g:C.ink2});
      const side=o.house[0]>0,lx=side?cx+w/2+8:cx,ly=side?cy-8:cy-34,la=side?'start':'middle';
      labels+=text(lx,ly,nameD(d.k),15.5,DCOL(o.kind),{'text-anchor':la,'font-weight':700});
      labels+=svg('text',{x:lx,y:ly+(side?18:-18),'font-size':12.5,'text-anchor':la,'font-weight':600,stroke:C.paper,'stroke-width':4,'paint-order':'stroke'},
        `<tspan fill="${C.ink2}">${t('m.dstLine',{g:R(d.go),b:R(d.before)})}</tspan>`+(diff?`<tspan fill="${diff>0?C.accent:C.bad}"> ${diff>0?'↑+':'↓'}${diff}</tspan>`:''));});
    // trains, then stations on top
    const order=plan.stations.map(s=>({s,x:plan.line.findIndex(c=>same(c,s))})).sort((a,b)=>a.x-b.x);
    if(order.length>=2){const a=order[0].x,b=order.at(-1).x,span=Math.max(1,b-a);
      for(let k=0;k<plan.trains;k++){const ph=(now/1000*1.6+k*2*span/plan.trains)%(2*span),pos=a+(ph<span?ph:2*span-ph),i=Math.min(plan.line.length-1,Math.floor(pos)),f=pos-i,c1=plan.line[i],c2=plan.line[Math.min(plan.line.length-1,i+1)];
        const [x1,y1]=xy(c1),[x2,y2]=xy(c2);lines+=`<g opacity=".9" transform="translate(${(x1+(x2-x1)*f-28.5).toFixed(1)} ${(y1+(y2-y1)*f-9).toFixed(1)})">`+sprite(TRAIN,0,0,3,{m:C.metro,w:C.paper,k:C.ink})+'</g>';}}
    const building=c=>D.origins.some(o=>same(o.cell,c))||D.destinations.some(o=>same(o.cell,c));
    order.forEach(({s},n)=>{const [x,yy]=xy(s);
      if(building(s))labels+=svg('circle',{cx:x,cy:yy-6,r:26,fill:'none',stroke:C.metro,'stroke-width':4})+svg('circle',{cx:x+21,cy:yy-25,r:10,fill:C.metro})+
        svg('text',{x:x+21,y:yy-21,'font-size':12,'font-weight':700,fill:C.paper,'text-anchor':'middle','font-family':'Geist Mono,monospace'},n+1);
      else things+=svg('circle',{cx:x,cy:yy,r:15,fill:C.panel,stroke:C.metro,'stroke-width':5})+svg('text',{x,y:yy+5,'font-size':14,'font-weight':700,fill:C.metro,'text-anchor':'middle','font-family':'Geist Mono,monospace'},n+1);});
    $('board').innerHTML=ground+desire+lines+things+labels;
  }

  /* -------------------------------------------------------------- side panels */
  function side(){
    const y=plan.now(),pot=plan.stations.length>=2?plan.potential():null,nx=spread(y,plan.aware),hi=R(P.masterScore*1.12),at=v=>Math.max(0,Math.min(100,100*v/hi));
    $('score').textContent=R(plan.total);$('scoreBar').style.width=`${at(plan.total)}%`;
    for(const [id,v,k] of [['tickPass',P.target,'g.tickPass'],['tickHigh',P.highScore,'g.tickHigh'],['tickMaster',P.masterScore,'g.tickMaster']]){$(id).style.left=`${at(v)}%`;$(id).dataset.label=t(k,{n:v});}
    $('yearNum').textContent=plan.done?t('m.yearDone',{m:P.years}):plan.open?t('m.yearN',{y:plan.year,m:P.years}):t('m.yearPlan');
    $('run').textContent=plan.done?t('m.runDone'):plan.open?(playing?t('m.playing'):t('m.runN',{n:plan.year+1})):t('m.run0');
    $('run').disabled=playing||(!plan.done&&!plan.canRun());
    $('pause').hidden=!plan.open||plan.done;$('pause').textContent=playing?t('m.pause'):t('m.play');$('rewind').hidden=!plan.open;
    // riders a day per year, the potential as a dashed line
    const top=Math.max(pot?pot.riders:0,...plan.log.map(l=>l.riders),y.riders,P.masterScore/P.years)*1.15;
    let yc='';for(let k=1;k<=P.years;k++){const l=plan.log[k-1],v=l?l.riders:k===plan.year+1&&!plan.done?y.riders:0,h=R(52*v/top);
      yc+=`<div class="yb ${l?'done':k===plan.year+1?'next':''} ${l&&l.crowdedSections?'crowd':''}"><i style="height:${h}px"></i><b>${v?R(v):''}</b><small>${t('m.yShort',{y:k})}</small></div>`;}
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
    // who knows the metro, and how many more next year
    let h='';y.est.forEach(e=>{const a=tenth(e.aware),d=tenth(nx[e.i])-a;
      h+=`<div class="xr"><span class="xn">${nameO(e.i)}</span><span class="abar">${Array.from({length:10},(_,k)=>`<i class="${k<a?'on':''}"></i>`).join('')}</span><b>${t('m.tenths',{n:a})}</b><em class="${d>0?'up':''}">${plan.done?'':d>0?t('m.awNext',{n:d}):t('m.awSame')}</em></div>`;});
    $('awareBox').innerHTML=h+`<p class="hbnote">${t('m.awNote',{s:tenth(P.aware.start)})}</p>`;
    // where each estate's people go: now, with the split before the line as a thin mark
    let w='';y.est.forEach(e=>{const n=e.n,seg=[...e.to.map(x=>({v:x.go/n,b:x.before/n,c:DCOL(D.destinations[x.k].kind)})),{v:e.nearby/n,b:e.nearbyBefore/n,c:C.ink3}];
      let acc=0,bacc=0,ticks='';const bars=seg.map(s=>{const el=`<i style="flex:${s.v.toFixed(3)};background:${s.c}"></i>`;bacc+=s.b;if(bacc<.999)ticks+=`<u style="left:${(100*bacc).toFixed(1)}%"></u>`;return el;}).join('');
      w+=`<div class="wr"><span class="xn">${nameO(e.i)}</span><span class="wbar">${bars}${ticks}</span><b>${R(100*(n-e.nearby)/n)}%</b></div>`;});
    $('whereBox').innerHTML=w+`<p class="hbnote">${t('m.whereNote',{a:sw(DCOL(D.destinations[0].kind))+shortD(0),b:sw(DCOL(D.destinations[1].kind))+shortD(1),c:sw(C.ink3)+t('m.nearbyName')})}</p>`;
    let tb=`<thead><tr><th>${t('m.tTrip')}</th><th>${t('m.tGo')}</th><th>${t('m.tAlt')}</th><th>${t('m.tMetro')}</th><th>${t('m.tSave')}</th><th>${t('m.tRiders')}</th></tr></thead><tbody>`;
    rowsOf(y).forEach(({x,who,chain},k)=>{const e=chain?null:y.est.find(z=>z.to.includes(x));
      tb+=`<tr data-row="${k}" class="${sel===k?'sel':''} ${x.metro>=1?'on':''} ${chain?'chain':''}"><td>${who}<small>→ ${shortD(x.k)}${chain?' · '+t('m.chainTag'):''}</small></td><td>${R(x.go)}<small>${t('m.was',{b:R(x.before)})}</small></td><td>${x.alt}<small>${t(x.byFoot?'m.byFoot':'m.byCar')}</small></td>`+
      `<td>${x.trip?`${x.trip.blocks}<small>${P.walkPer*x.trip.walkA}+${P.wait}+${x.trip.pass}+${P.walkPer*x.trip.walkB}${x.trip.crowd?'+'+x.trip.crowd:''}</small>`:'—'}</td><td>${x.trip?x.save:''}</td><td><b>${x.metro>=1?R(x.metro):''}</b>${x.tenths?`<small>${t('m.tenths',{n:x.tenths})}${e?'×'+t('m.tenths',{n:tenth(e.aware)}):''}</small>`:''}</td></tr>`;});
    $('trips').innerHTML=tb+'</tbody>';
  }
  function render(){draw();side();}
  function fit(){draw();try{const bb=$('board').getBBox(),x0=Math.min(0,bb.x-14),y0=Math.min(0,bb.y-14),x1=Math.max(VBW,bb.x+bb.width+14),y1=Math.max(VBH,bb.y+bb.height+14);
    $('board').setAttribute('viewBox',`${x0} ${y0} ${x1-x0} ${y1-y0}`);}catch(e){}}
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
    fx={until:performance.now()+1800,aware:r.after.map((a,i)=>tenth(a)-tenth(r.before[i]))};
    const prev=plan.log.at(-2),grow=prev?R(r.riders-prev.riders):R(r.riders);
    const dd=r.dest.map((d,k)=>`${shortD(k)} ${R(d.go)}${R(d.go-d.before)?` (${R(d.go-d.before)>0?'+':''}${R(d.go-d.before)})`:''}`).join(' · ');
    showCard(t('m.cardTitle',{y:r.year}),[t('m.cardRiders',{r:R(r.riders),d:(grow>=0?'+':'')+grow}),t('m.cardAware',{a:tenth(r.after.reduce((s,a)=>s+a,0)/r.after.length)}),t('m.cardDest',{list:dd}),
      r.crowdedSections?t('m.cardCrowd',{n:r.crowdedSections,cb:P.crowdBlocks}):''].filter(Boolean),r.crowdedSections?'warn':'');
    render();if(plan.done){stop();setTimeout(result,1500);}
  }
  function showCard(title,rows,kind){const el=$('yearCard');el.className='yearcard on '+kind;el.innerHTML=`<b>${title}</b>`+rows.map(s=>`<span>${s}</span>`).join('');
    clearTimeout(card);card=setTimeout(()=>el.classList.remove('on'),STEP_MS+400);}
  function play(){if(plan.done)return;playing=true;clearInterval(timer);timer=setInterval(step,STEP_MS);render();}
  function stop(){playing=false;clearInterval(timer);render();}
  function open(){if(!plan.canRun())return;history=[];tool='draw';hover=null;step();play();}
  function rewind(){stop();plan.rewind();fx=null;$('yearCard').classList.remove('on');render();}
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
    window.dispatchEvent(new CustomEvent('tl:result',{detail:{game:'feeder',mode:'m2-metro',version:'7.5-grow',map:D.map,score:R(plan.total),tier,tiers:[P.target,P.highScore,P.masterScore],line:plan.line,stations:plan.stations,trains:plan.trains,lang:I.lang}}));
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
  let lastFrame=0;(function loop(now){if((plan.stations.length>=2||(fx&&now<fx.until))&&now-lastFrame>60&&!drag){draw(now);lastFrame=now;}requestAnimationFrame(loop);})(0);
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
  window.TL_METRO={api,plan:()=>({line:plan.line.map(c=>c.slice()),stations:plan.stations.map(c=>c.slice()),year:plan.year,money:plan.money,trains:plan.trains,total:plan.total,done:plan.done,playing,riders:plan.now().riders}),
    cellXY:c=>{const m=board.getScreenCTM(),[x,y]=xy(c);return[m.a*x+m.c*y+m.e,m.b*x+m.d*y+m.f];}};
})();
