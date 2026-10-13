(()=>{
  'use strict';
  // v7 · mode 2 «the metro», six years — the page. Year 0: draw a line and its stations within the budget. Then run
  // the years one at a time: each estate's experience moves (+1 in comfort, −1 when crowded), the fares come in, and
  // between years you add to the line (never remove), add stations or trains.
  const {Plan,D,P,evaluate,nextExp,walk,same,key}=Metro,$=id=>document.getElementById(id),I=window.I18N,t=(k,v)=>I.t(k,v);
  const CS=60,MX=60,MY=70;
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
  const sgn=n=>n>0?'+'+n:n<0?'−'+(-n):'0';
  let plan=new Plan(),tool='draw',hover=null,sel=-1,drag=false,history=[],toastTimer=0,fx=null;
  const VBW=MX*2+(D.cols-1)*CS,VBH=MY*2+(D.rows-1)*CS;
  function snapshot(){history.push(JSON.stringify({...plan}));if(history.length>200)history.shift();}
  function restore(s){const p=new Plan();Object.assign(p,JSON.parse(s));plan=p;}
  function toast(s,kind=''){const el=$('toast');el.className='toast on '+kind;el.textContent=s;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('on'),3200);}
  function curve(a,b,j){const [x1,y1]=xy(a),[x2,y2]=xy(b),dx=x2-x1,dy=y2-y1,L=Math.hypot(dx,dy)||1,bend=Math.min(60,L*.12)*(j%2?1:-1);
    const cx=(x1+x2)/2-dy/L*bend,cy=(y1+y2)/2+dx/L*bend;return{d:`M${x1} ${y1}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2} ${y2}`,mid:[(x1+2*cx+x2)/4,(y1+2*cy+y2)/4]};}
  const isBuiltCell=c=>plan.open&&(plan.builtSet||[]).includes(key(c));
  const isBuiltStation=c=>plan.open&&plan.builtStations.some(x=>same(x,c));

  /* -------------------------------------------------------------- the board */
  function draw(now=performance.now()){
    const ev=plan.evaluate();
    let ground='',desire='',lines='',things='',labels='';
    for(let x=0;x<D.cols;x++)for(let y=0;y<D.rows;y++){const [cx,cy]=xy([x,y]),can=tool==='draw'&&!plan.done&&plan.canExtend([x,y])&&plan.line.length>0;
      ground+=svg('rect',{x:cx-CS/2+3,y:cy-CS/2+3,width:CS-6,height:CS-6,rx:5,fill:can?C.metro:C.soft,'fill-opacity':can?.10:.55,stroke:can?C.metro:C.line,'stroke-opacity':can?.45:1,'stroke-dasharray':can?'4 3':''});}
    ev.rows.forEach((r,j)=>{const o=D.origins[r.i],d=D.destinations[r.k],{d:path,mid}=curve(o.cell,d.cell,j),w=2+r.people/7,on=sel===j;
      desire+=svg('path',{d:path,fill:'none',stroke:on?C.ink:C.ink3,'stroke-width':w.toFixed(1),'stroke-opacity':on?.5:sel>=0?.12:.28,'stroke-linecap':'round'});
      if(r.tenths)desire+=svg('path',{d:path,fill:'none',stroke:C.metro,'stroke-width':(w*r.tenths/10).toFixed(1),'stroke-opacity':sel>=0&&!on?.25:.85,'stroke-linecap':'round'});
      if(on)labels+=pill(mid[0],mid[1],r.metro===null?t('m.dlCar',{c:r.car}):t('m.dlFull',{s:r.save,e:sgn(r.exp),n:r.tenths,p:r.riders}),r.tenths?C.metro:C.ink2,12.5);
      else if(r.tenths&&sel<0)labels+=pill(mid[0],mid[1],t('m.dl',{n:r.tenths,p:r.riders}),C.metro,12);});
    if(sel>=0){const r=ev.rows[sel];if(r.metro!==null){const o=D.origins[r.i].cell,d=D.destinations[r.k].cell,seg=(a,b)=>`M${xy(a).join(' ')}L${xy([b[0],a[1]]).join(' ')}L${xy(b).join(' ')}`;
      lines+=svg('path',{d:seg(o,r.from),fill:'none',stroke:C.ink,'stroke-width':2.5,'stroke-dasharray':'2 5','stroke-linecap':'round'})+svg('path',{d:seg(r.to,d),fill:'none',stroke:C.ink,'stroke-width':2.5,'stroke-dasharray':'2 5','stroke-linecap':'round'});}}
    // the line, section by section: how full each one gets this year (red = crowded); this year's additions dashed
    let worst=-1;
    for(let j=0;j+1<plan.line.length;j++){const a=plan.line[j],b=plan.line[j+1],[x1,y1]=xy(a),[x2,y2]=xy(b),f=ev.load[j]/ev.cap,col=f>1?C.bad:f>.8?C.warn:C.metro,isNew=!(isBuiltCell(a)&&isBuiltCell(b));
      if(f>1)lines+=svg('path',{d:`M${x1} ${y1}L${x2} ${y2}`,stroke:C.bad,'stroke-width':22,'stroke-opacity':(.15+.06*Math.sin(now/300)).toFixed(3),'stroke-linecap':'round'});
      lines+=svg('path',{d:`M${x1} ${y1}L${x2} ${y2}`,stroke:col,'stroke-width':12,'stroke-linecap':'round','stroke-opacity':isNew&&plan.open?.55:1,'stroke-dasharray':isNew&&plan.open?'10 6':''});
      if(worst<0||ev.load[j]>ev.load[worst])worst=j;}
    if(plan.line.length===1){const [x,y]=xy(plan.line[0]);lines+=svg('circle',{cx:x,cy:y,r:7,fill:C.metro});}
    if(worst>=0&&plan.stations.length>=2&&ev.load[worst]>.8*ev.cap){const a=xy(plan.line[worst]),b=xy(plan.line[worst+1]),f=ev.load[worst]/ev.cap;
      labels+=pill((a[0]+b[0])/2,(a[1]+b[1])/2-24,t(f>1?'m.crowd':'m.nearly',{a:ev.load[worst],b:ev.cap}),f>1?C.bad:C.warn,12.5);}
    if(tool==='draw'&&!plan.done)for(const e of [plan.line[0],plan.line.at(-1)])if(e){const [x,y]=xy(e);things+=svg('circle',{cx:x,cy:y,r:9,fill:C.panel,stroke:C.metro,'stroke-width':3,'stroke-dasharray':'3 2'});}
    // hover preview
    if(hover&&!plan.done){const [hx,hy]=xy(hover);
      if(tool==='draw'){
        if(plan.canExtend(hover)){const end=!plan.line.length?null:Metro.adj(hover,plan.line.at(-1))?plan.line.at(-1):plan.line[0];
          if(end)lines+=svg('path',{d:`M${xy(end).join(' ')}L${hx} ${hy}`,stroke:C.metro,'stroke-width':12,'stroke-opacity':.35,'stroke-linecap':'round'});
          else lines+=svg('circle',{cx:hx,cy:hy,r:7,fill:C.metro,'fill-opacity':.4});
          labels+=pill(hx,hy-22,t('m.pvExtend',{c:P.lineCost}),C.metro,12);}
        else if(plan.canShorten(hover))labels+=pill(hx,hy-22,t('m.pvShorten'),C.ink2,12);}
      else if(plan.onLine(hover)){const has=plan.isStation(hover);
        if(has&&isBuiltStation(hover))labels+=pill(hx,hy-26,t('m.pvBuilt'),C.ink2,12);
        else if(!has&&plan.money<P.stationCost)labels+=pill(hx,hy-24,t('m.pvNoMoney'),C.bad,12);
        else{const dv=plan.withStation(hover).riders-ev.riders;
          if(!has)things+=svg('circle',{cx:hx,cy:hy,r:15,fill:C.panel,stroke:C.metro,'stroke-width':5,'stroke-opacity':.5,'stroke-dasharray':'4 3'});
          labels+=pill(hx,hy-26,(has?t('m.pvRemove'):t('m.pvAdd'))+' '+t(dv>=0?'m.pvGain':'m.pvLoss',{n:Math.abs(dv)})+' · '+t(has?'m.pvRefund':'m.pvCost',{c:P.stationCost}),dv>0?C.accent:dv<0?C.bad:C.ink2,12.5);}}}
    // estates: name, experience, riders
    D.origins.forEach((o,i)=>{const [cx,cy]=xy(o.cell),up=o.house[1]<0,ppl=o.to.reduce((a,b)=>a+b,0),rode=ev.rows.filter(r=>r.i===i).reduce((a,r)=>a+r.riders,0),e=plan.exp[i];
      things+=sprite(ESTATE,cx-18,cy-24,3,{k:C.ink,w:C.paper,l:C.warn,g:C.ink2});
      labels+=text(cx,up?cy-34:cy+32,nameO(i),15.5,C.ink,{'text-anchor':'middle','font-weight':700});
      labels+=svg('text',{x:cx,y:up?cy-52:cy+50,'font-size':12.5,'text-anchor':'middle','font-weight':600,stroke:C.paper,'stroke-width':4,'paint-order':'stroke'},
        `<tspan fill="${rode?C.metro:C.ink2}">${rode?t('m.estRode',{n:ppl,r:rode}):t('m.estAll',{n:ppl})}</tspan><tspan fill="${e>0?C.accent:e<0?C.bad:C.ink2}"> · ${t('m.expChip',{e:sgn(e)})}</tspan>`);
      if(fx&&now<fx.until&&fx.d[i]){const k=(fx.until-now)/1800;labels+=svg('text',{x:cx+52,y:(cy-28-18*(1-k)).toFixed(1),'font-size':20,'font-weight':700,fill:fx.d[i]>0?C.accent:C.bad,opacity:Math.min(1,k*1.5).toFixed(2),'text-anchor':'middle'},sgn(fx.d[i]));}});
    D.destinations.forEach((o,k)=>{const [cx,cy]=xy(o.cell),sp=DEST[o.kind],w=sp[0].length*3,came=ev.rows.filter(r=>r.k===k).reduce((a,r)=>a+r.riders,0),ppl=ev.rows.filter(r=>r.k===k).reduce((a,r)=>a+r.people,0);
      things+=sprite(sp,cx-w/2,cy-24,3,{k:C.ink,w:C.paper,a:DCOL(o.kind),r:C.accent2,p:C.paper,l:C.warn,d:DCOL(o.kind),g:C.ink2});
      const side=o.house[0]>0,lx=side?cx+w/2+8:cx,ly=side?cy-8:cy-34,la=side?'start':'middle';
      labels+=text(lx,ly,nameD(k),15.5,DCOL(o.kind),{'text-anchor':la,'font-weight':700});
      labels+=text(lx,ly+(side?18:-18),came?t('m.dstRode',{n:ppl,r:came}):t('m.dstAll',{n:ppl}),12.5,came?C.metro:C.ink2,{'text-anchor':la,'font-weight':600});});
    // trains (as many as run), under the stations
    const order=plan.stations.map(s=>({s,x:plan.line.findIndex(c=>same(c,s))})).sort((a,b)=>a.x-b.x);
    if(order.length>=2){const a=order[0].x,b=order.at(-1).x,span=Math.max(1,b-a);
      for(let k=0;k<plan.trains;k++){const ph=(now/1000*1.6+k*2*span/plan.trains)%(2*span),pos=a+(ph<span?ph:2*span-ph),i=Math.min(plan.line.length-1,Math.floor(pos)),f=pos-i,c1=plan.line[i],c2=plan.line[Math.min(plan.line.length-1,i+1)];
        const [x1,y1]=xy(c1),[x2,y2]=xy(c2);lines+=`<g opacity=".9" transform="translate(${(x1+(x2-x1)*f-28.5).toFixed(1)} ${(y1+(y2-y1)*f-9).toFixed(1)})">`+sprite(TRAIN,0,0,3,{m:C.metro,w:C.paper,k:C.ink})+'</g>';}}
    const building=c=>D.origins.some(o=>same(o.cell,c))||D.destinations.some(o=>same(o.cell,c));
    order.forEach(({s},n)=>{const [x,y]=xy(s),isNew=plan.open&&!isBuiltStation(s),dash=isNew?'4 3':'';
      if(building(s))labels+=svg('circle',{cx:x,cy:y-6,r:26,fill:'none',stroke:C.metro,'stroke-width':4,'stroke-dasharray':dash})+svg('circle',{cx:x+21,cy:y-25,r:10,fill:C.metro})+
        svg('text',{x:x+21,y:y-21,'font-size':12,'font-weight':700,fill:C.paper,'text-anchor':'middle','font-family':'Geist Mono,monospace'},n+1);
      else things+=svg('circle',{cx:x,cy:y,r:15,fill:C.panel,stroke:C.metro,'stroke-width':5,'stroke-dasharray':dash})+svg('text',{x,y:y+5,'font-size':14,'font-weight':700,fill:C.metro,'text-anchor':'middle','font-family':'Geist Mono,monospace'},n+1);});
    $('board').innerHTML=ground+desire+lines+things+labels;
  }

  /* -------------------------------------------------------------- side panels */
  function side(){
    const ev=plan.evaluate(),nx=nextExp(ev,plan.exp),hi=Math.round(P.masterScore*1.12),at=v=>Math.max(0,Math.min(100,100*v/hi));
    $('score').textContent=plan.total;$('thisYear').textContent=plan.done?'':t(plan.open?'m.thisYear':'m.firstYear',{n:ev.riders,y:plan.year+1});
    $('scoreBar').style.width=`${at(plan.total)}%`;
    for(const [id,v,k] of [['tickPass',P.target,'g.tickPass'],['tickHigh',P.highScore,'g.tickHigh'],['tickMaster',P.masterScore,'g.tickMaster']]){$(id).style.left=`${at(v)}%`;$(id).dataset.label=t(k,{n:v});}
    $('yearNum').textContent=plan.done?t('m.yearDone',{m:P.years}):plan.open?t('m.yearN',{y:plan.year,m:P.years}):t('m.yearPlan');
    $('run').textContent=plan.done?t('m.runDone'):t(plan.open?'m.runN':'m.run0',{n:plan.year+1});$('run').disabled=!plan.done&&!plan.canRun();
    // riders per year: past years solid, the coming one as an outline
    const top=Math.max(P.masterScore/P.years*1.4,...plan.log.map(l=>l.riders),ev.riders);
    let yc='';for(let y=1;y<=P.years;y++){const l=plan.log[y-1],v=l?l.riders:y===plan.year+1&&!plan.done?ev.riders:0,h=Math.round(46*v/top);
      yc+=`<div class="yb ${l?'done':y===plan.year+1?'next':''} ${l&&l.crowdedSections?'crowd':''}"><i style="height:${h}px"></i><b>${v||''}</b><small>${t('m.yShort',{y})}</small></div>`;}
    $('yChart').innerHTML=yc;
    $('money').textContent=plan.money;
    $('moneyNote').innerHTML=plan.open?t('m.moneyN',{n:plan.log.at(-1)?.income??0,f:P.fare,lc:P.lineCost,sc:P.stationCost,tc:P.trainCost}):t('m.money0',{lc:P.lineCost,sc:P.stationCost,tc:P.trainCost});
    $('trainsTxt').innerHTML=t('m.trains',{n:plan.trains,c:plan.trains*P.perTrain});
    $('trainPlus').disabled=!plan.canTrain();$('trainMinus').disabled=!plan.canUntrain();
    document.querySelectorAll('#toolSeg [data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===tool)));
    $('toolHint').textContent=plan.done?t('m.hintDone'):tool==='draw'?(plan.line.length?(plan.open?t('m.hintGrow'):t('m.hintDraw2')):t('m.hintDraw1')):
      (plan.line.length<2?t('m.hintNeedLine'):plan.stations.length<2?t('m.hintStation1'):t('m.hintStation2'));
    $('undo').disabled=!history.length||plan.done;$('clear').disabled=plan.open;
    // experience: −3 … +3 per estate, and where it goes next year with this plan
    let h='';D.origins.forEach((o,i)=>{const e=plan.exp[i],d=nx[i]-e;
      h+=`<div class="xr"><span class="xn">${nameO(i)}</span><span class="xbar">${[-3,-2,-1,0,1,2,3].map(v=>`<i class="${v===e?'on':''} ${v<0?'neg':v>0?'pos':'zero'}"></i>`).join('')}</span><b class="${e>0?'pos':e<0?'neg':''}">${sgn(e)}</b>`+
        `<em class="${d>0?'up':d<0?'down':''}">${plan.done?'':d>0?t('m.expUp'):d<0?t('m.expDown'):t('m.expSame')}</em></div>`;});
    $('expBox').innerHTML=h+`<p class="hbnote">${t('m.expNote')}</p>`;
    let tb=`<thead><tr><th>${t('m.tTrip')}</th><th>${t('m.tPeople')}</th><th>${t('m.tCar')}</th><th>${t('m.tMetro')}</th><th>${t('m.tSave')}</th><th>${t('m.tExp')}</th><th>${t('m.tRiders')}</th></tr></thead><tbody>`;
    ev.rows.forEach((r,j)=>{tb+=`<tr data-row="${j}" class="${sel===j?'sel':''} ${r.riders?'on':''} ${r.crowded?'crowd':''}"><td>${nameO(r.i)}<small>→ ${shortD(r.k)}</small></td><td>${r.people}</td><td>${r.car}</td>`+
      `<td>${r.metro===null?'—':`${r.metro}<small>${r.walkA}+${P.wait}+${r.pass}+${r.walkB}</small>`}</td><td>${r.metro===null?'':r.save}</td><td>${r.metro===null?'':sgn(r.exp)}</td><td><b>${r.riders||''}</b>${r.tenths?`<small>${t('m.tenths',{n:r.tenths})}</small>`:''}</td></tr>`;});
    $('trips').innerHTML=tb+`</tbody><tfoot><tr><td colspan="6">${t('m.tTotal')}</td><td><b>${ev.riders}</b></td></tr></tfoot>`;
  }
  function render(){draw();side();}
  function fit(){draw();try{const bb=$('board').getBBox(),x0=Math.min(0,bb.x-14),y0=Math.min(0,bb.y-14),x1=Math.max(VBW,bb.x+bb.width+14),y1=Math.max(VBH,bb.y+bb.height+14);
    $('board').setAttribute('viewBox',`${x0} ${y0} ${x1-x0} ${y1-y0}`);}catch(e){}}
  function texts(){
    $('goal').innerHTML=t('m.goal',{pass:P.target,high:P.highScore,master:P.masterScore});
    const v={w:P.wait,lc:P.lineCost,sc:P.stationCost,tc:P.trainCost,pt:P.perTrain,f:P.fare,b:P.budget,y:P.years,e:sgn(P.exp.start)};
    $('rule2').innerHTML=t('m.rule2',v);$('rule3').innerHTML=t('m.rule3',v);$('rule4').innerHTML=t('m.rule4',v);
    $('infoBody').innerHTML=t('m.info',v);$('ivBody').innerHTML=t('iv.m2.body',v);
    $('mapLegend').innerHTML=t('m.legend');document.title=t('m.doc');
  }

  /* -------------------------------------------------------------- a year, and the end */
  function runYear(){
    if(plan.done){result();return;}
    const before=plan.exp.slice(),r=plan.runYear();if(!r)return;
    history=[];fx={until:performance.now()+1800,d:plan.exp.map((e,i)=>e-before[i])};
    toast(t('m.tYear',{y:r.year,r:r.riders,f:r.income})+(r.crowdedSections?' · '+t('m.tCrowd',{n:r.crowdedSections}):''),r.crowdedSections?'warn':'tide');
    render();if(plan.done)setTimeout(result,1400);
  }
  function result(){
    const tier=plan.total>=P.masterScore?3:plan.total>=P.highScore?2:plan.total>=P.target?1:0;
    $('result').classList.toggle('win',tier>0);$('resultTitle').textContent=t('r.t'+tier);$('resultEn').textContent=['Try again','Cleared','High score','Master'][tier];
    $('resultScore').textContent=t('m.rScore',{d:plan.total,y:P.years,m:plan.money});
    let h=`<table class="result"><thead><tr><th>${t('m.ryYear')}</th><th>${t('m.ryRiders')}</th><th>${t('m.ryIncome')}</th><th>${t('m.ryTrains')}</th><th>${t('m.ryStations')}</th><th>${t('m.ryCrowd')}</th><th>${t('m.ryExp')}</th></tr></thead><tbody>`;
    for(const l of plan.log)h+=`<tr><td>${t('m.yShort',{y:l.year})}</td><td>${l.riders}</td><td>+${l.income}</td><td>${l.trains}</td><td>${l.stations}</td><td>${l.crowdedSections||''}</td><td>${l.after.map(sgn).join(' ')}</td></tr>`;
    h+='</tbody></table>';
    const tips=[],crowdYears=plan.log.filter(l=>l.crowdedSections).length;
    if(crowdYears)tips.push(t('m.tipCrowd',{n:crowdYears}));
    D.origins.forEach((o,i)=>{if(plan.log.every(l=>l.after[i]===P.exp.start))tips.push(t('m.tipNever',{a:nameO(i)}));});
    if(plan.money>=8)tips.push(t('m.tipMoney',{n:plan.money}));
    if(!tips.length)tips.push(t('m.tip3'));
    $('resultBody').innerHTML=h+`<ul class="ivlist">${tips.slice(0,4).map(s=>`<li>${s}</li>`).join('')}</ul>`;
    try{const k='tl-best-m2-'+D.map;if(plan.total>(+localStorage.getItem(k)||0))localStorage.setItem(k,plan.total);}catch(e){}
    window.dispatchEvent(new CustomEvent('tl:result',{detail:{game:'feeder',mode:'m2-metro',version:'7.4-years',map:D.map,score:plan.total,tier,tiers:[P.target,P.highScore,P.masterScore],log:plan.log,lang:I.lang}}));
    $('result').showModal();
  }

  /* -------------------------------------------------------------- controls */
  const board=$('board');
  function cellAt(e){const pt=board.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;const p=pt.matrixTransform(board.getScreenCTM().inverse());
    const c=[Math.round((p.x-MX)/CS),Math.round((p.y-MY)/CS)];return c[0]>=0&&c[1]>=0&&c[0]<D.cols&&c[1]<D.rows?c:null;}
  function act(c){
    if(plan.done)return false;
    if(tool==='draw'){
      if(plan.canExtend(c)){snapshot();plan.extend(c);return true;}
      if(plan.canShorten(c)){snapshot();plan.shorten(c);return true;}
      if(plan.isEnd(c)&&plan.open)toast(t('m.nBuilt'),'warn');
      else if(plan.money<P.lineCost)toast(t('m.nNoMoney'),'warn');
      else if(plan.line.length&&!plan.onLine(c))toast(t('m.nAdjacent'),'warn');
      return false;}
    if(!plan.onLine(c)){toast(t('m.nOnLine'),'warn');return false;}
    if(plan.isStation(c)&&isBuiltStation(c)){toast(t('m.nBuilt'),'warn');return false;}
    if(!plan.isStation(c)&&plan.money<P.stationCost){toast(t('m.nNoMoney'),'warn');return false;}
    snapshot();plan.toggleStation(c);return true;
  }
  board.onpointerdown=e=>{const c=cellAt(e);if(!c)return;drag=tool==='draw';if(act(c))render();if(drag)board.setPointerCapture(e.pointerId);};
  board.onpointermove=e=>{const c=cellAt(e);
    if(drag&&c&&plan.canExtend(c)){snapshot();plan.extend(c);hover=null;render();return;}
    if(JSON.stringify(c)!==JSON.stringify(hover)){hover=c;draw();}};
  board.onpointerup=()=>{drag=false;};
  board.onpointerleave=()=>{if(!drag&&hover){hover=null;draw();}};
  $('toolSeg').onclick=e=>{const b=e.target.closest('[data-tool]');if(b){tool=b.dataset.tool;hover=null;render();}};
  $('undo').onclick=()=>{const s=history.pop();if(s){restore(s);render();}};
  $('clear').onclick=()=>{if(plan.open||!plan.line.length)return;snapshot();plan.clear();tool='draw';render();};
  $('trainPlus').onclick=()=>{snapshot();if(plan.addTrain())render();};
  $('trainMinus').onclick=()=>{snapshot();if(plan.removeTrain())render();};
  $('run').onclick=runYear;
  $('trips').onclick=e=>{const r=e.target.closest('[data-row]');if(!r)return;const j=+r.dataset.row;sel=sel===j?-1:j;render();};
  $('again').onclick=()=>{$('result').close();plan=new Plan();history=[];tool='draw';sel=-1;render();};
  $('help').onclick=()=>$('info').showModal();
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  $('lvInfo').onclick=()=>$('lvIntro').showModal();$('ivGo').onclick=()=>$('lvIntro').close();
  document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]'))return;
    if(e.key==='1'){tool='draw';render();}else if(e.key==='2'){tool='station';render();}
    else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$('undo').click();}
    else if(e.key==='Enter'&&!e.target.closest?.('button')){e.preventDefault();$('run').click();}
    else if(e.key==='Escape'&&sel>=0){sel=-1;render();}});
  function setTheme(th){document.documentElement.setAttribute('data-theme',th);$('thPaper').setAttribute('aria-pressed',String(th==='light'));$('thInk').setAttribute('aria-pressed',String(th==='dark'));
    try{localStorage.setItem('tl-theme',th);}catch(e){}readTokens();render();}
  $('thPaper').onclick=()=>setTheme('light');$('thInk').onclick=()=>setTheme('dark');
  window.addEventListener('tl:lang',()=>{texts();fit();render();});
  let lastFrame=0;(function loop(now){if((plan.stations.length>=2||(fx&&now<fx.until))&&now-lastFrame>60&&!drag){draw(now);lastFrame=now;}requestAnimationFrame(loop);})(0);
  // test hook: #intro=0&line=2,2;3,2;4,2&stations=2,2;4,2&trains=2&years=2&tool=station&sel=0&theme=dark&lang=en
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
  window.TL_METRO={plan:()=>({line:plan.line.map(c=>c.slice()),stations:plan.stations.map(c=>c.slice()),year:plan.year,money:plan.money,trains:plan.trains,total:plan.total,exp:plan.exp.slice(),done:plan.done,...plan.evaluate()}),
    cellXY:c=>{const m=board.getScreenCTM(),[x,y]=xy(c);return[m.a*x+m.c*y+m.e,m.b*x+m.d*y+m.f];}};
})();
