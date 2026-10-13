(()=>{
  'use strict';
  // v7 · mode 2 «the metro» — the page. Same visual language as mode 1 (shared/style.css): paper board, pixel icons,
  // soft rings for what the coming week will do, labels always on top.
  const {Game,D,P,walk,willing,idxOf,same,slice}=Metro,$=id=>document.getElementById(id),I=window.I18N,t=(k,v)=>I.t(k,v);
  const CW=58,CH=52,MX=70,MY=56;
  const xy=c=>[MX+c[0]*CW,MY+c[1]*CH];
  const fmt=n=>`${String(Math.floor(Math.max(0,n)/60)).padStart(2,'0')}:${String(Math.floor(Math.max(0,n)%60)).padStart(2,'0')}`;
  const svg=(tag,a,c='')=>`<${tag} ${Object.entries(a).map(([k,v])=>`${k}="${v}"`).join(' ')}>${c}</${tag}>`;
  let C={};
  function readTokens(){const s=getComputedStyle(document.documentElement),v=n=>s.getPropertyValue('--s-'+n).trim();
    C={paper:v('paper'),panel:v('panel'),soft:v('soft'),ink:v('ink'),ink2:v('ink2'),ink3:v('ink3'),line2:v('line2'),accent:v('accent'),accent2:v('accent2'),
      warn:v('warn'),bad:v('bad'),info:v('info'),road:v('road'),metro:v('metro')};}
  readTokens();
  const text=(x,y,s,size=13,fill=C.ink,extra={})=>svg('text',{x,y,'font-size':size,fill,stroke:C.panel,'stroke-width':3.5,'paint-order':'stroke',...extra},s);
  const textW=(s,size)=>[...String(s)].reduce((w,ch)=>w+(ch.charCodeAt(0)>0x2e7f?size:ch===' '?size*.32:size*.6),0);
  const pill=(x,y,s,color,anchor='middle',size=12.5)=>{const w=textW(s,size)+16,x0=anchor==='start'?x-4:anchor==='end'?x-w+4:x-w/2;
    return svg('rect',{x:x0,y:y-size+1,width:w,height:size+8,rx:(size+8)/2,fill:C.panel,stroke:color,'stroke-width':1,'stroke-opacity':.6,'fill-opacity':.94})+
      text(anchor==='start'?x0+7:anchor==='end'?x0+w-7:x,y+2,s,size,color,{'text-anchor':anchor,'font-weight':600,'stroke-width':0});};
  function sprite(rows,x0,y0,u,pal){let out='';rows.forEach((row,j)=>{for(let i=0;i<row.length;){const ch=row[i];if(ch==='.'||!pal[ch]){i++;continue;}let k=i;while(k+1<row.length&&row[k+1]===ch)k++;
    out+=`<rect x="${(x0+i*u).toFixed(1)}" y="${(y0+j*u).toFixed(1)}" width="${((k-i+1)*u).toFixed(1)}" height="${u}" fill="${pal[ch]}"/>`;i=k+1;}});return `<g shape-rendering="crispEdges">${out}</g>`;}
  const ESTATE=["....kkkkk...","....kwklk...","....kkkkk...","....kwkwk.kk","kkk.kkkkk.kl","klk.kwkwk.kk","kkk.kkkkk.kw","kwk.klkwk.kk","kkk.kkkkk.kw","kwk.kwkwk.kk","kkk.kkkkk.kl","gggggggggggg"];
  const TOWN=["......kkkk......","....kkaaaakk....","..kkaaaaaaaakk..","kkaaaaaaaaaaaakk","kaaaaaaaaaaaaaak","rprprprprprprprp","prprprprprprprpr",".kkkkkkkkkkkkkk.",".kllkkkddkkkllk.",".kllkkkddkkkllk.",".kkkkkkddkkkkkk.","gggggggggggggggg"];
  const OFFICE=[".....kkkk.....",".....kwwk.....","..kkkkkkkkkk..","..kwwkwwkwwk..","..kkkkkkkkkk..","..kwwkwwkwwk..","..kkkkkkkkkk..","..kwwkwwkwwk..","..kkkkkkkkkk..","..kwwkddkwwk..","..kkkkddkkkk..","gggggggggggggg"];
  const SCHOOL=["......aa......","......aaa.....","......k.......","...kkkkkkkk...","..kaaaaaaaak..",".kaaaaaaaaaak.","kkkkkkkkkkkkkk","kwwkwwkkwwkwwk","kkkkkkddkkkkkk","kwwkwwddkwwkwk","kkkkkkddkkkkkk","gggggggggggggg"];
  const TRAIN=[".mmmmmmmmmmmmmmmmm.","mmwwmmwwmmwwmmwwmmm","mmwwmmwwmmwwmmwwmmm","mmmmmmmmmmmmmmmmmmm","mkkmmmmmmmmmmmmkkmm","..k.............k.."];
  const PLUS=["..kkk..","..kpk..","kkkpkkk","kpppppk","kkkpkkk","..kpk..","..kkk.."];
  const DEST={town:TOWN,jobs:OFFICE,school:SCHOOL},DCOL=k=>({town:C.warn,jobs:C.info,school:C.accent2})[k];
  const nameO=i=>I.name(D.origins[i]),nameD=k=>I.name(D.destinations[k]);
  const WHY={'習慣開車':'habit','起點沒有站':'home','終點沒有站':'there','起點終點同一站':'same','月台太擠':'full'};   // engine reasons → text keys
  // a station is named after the nearest estate or destination
  function stationName(c){let best=null;
    D.origins.forEach((o,i)=>{const d=walk(o.cell,c);if(!best||d<best.d)best={d,n:nameO(i)};});
    D.destinations.forEach((o,k)=>{const d=walk(o.cell,c);if(!best||d<best.d)best={d,n:(I.lang==='zh-Hans'?o.shortHans:o.short)||nameD(k)};});
    return t('m.stn',{n:best.n});}
  let game=new Game(),playing=false,speed=1,hover=null,shown=false,seen=0,inter=null,fastHeld=false,last=performance.now(),lastDraw=0,lastSide=0,toastTimer=0;
  const SPEED_BASE=4,FAST=8,INTER_MS=7000;
  const total=()=>D.origins.reduce((s,o)=>s+o.people,0)*D.weeks;
  const VBW=MX*2+(D.cols-1)*CW+40,VBH=MY*2+(D.rows-1)*CH+20;
  function note(s){$('notice').textContent=s;}
  function toast(s,kind=''){const el=$('toast');el.className='toast on '+kind;el.textContent=s;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('on'),2800);}
  // a walk on the street grid: along x first, then y; where someone is at fraction f of it
  function along(a,b,f){const dx=b[0]-a[0],dy=b[1]-a[1],L=Math.abs(dx)+Math.abs(dy);if(!L)return a.slice();let d=f*L;
    if(d<=Math.abs(dx))return[a[0]+Math.sign(dx)*d,a[1]];d-=Math.abs(dx);return[b[0],a[1]+Math.sign(dy)*d];}
  // a position along the alignment (a fractional index) → a cell position
  function lineAt(x){const i=Math.max(0,Math.min(D.line.length-1,Math.floor(x))),j=Math.min(D.line.length-1,i+1),f=x-i,a=D.line[i],b=D.line[j];return[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];}
  const vizWeek=()=>game.done?-1:!game.started?0:inter?inter.r:-1;

  /* -------------------------------------------------------------- the board */
  function draw(){
    const vw=vizWeek(),fc=vw>=0?game.forecast(vw,hover&&!game.started?[...game.stations,hover].sort((a,b)=>idxOf(a)-idxOf(b)):game.stations):null,now=performance.now();
    let ground='',lines='',rings='',things='',labels='';
    // the planned alignment (dashed), the built line between the outermost stations (solid)
    const pathOf=cs=>cs.map((c,i)=>(i?'L':'M')+xy(c).join(' ')).join(' ');
    ground+=svg('path',{d:pathOf(D.line),fill:'none',stroke:C.ink3,'stroke-width':6,'stroke-opacity':.25,'stroke-dasharray':'2 8','stroke-linecap':'round'});
    if(game.stations.length>=2){const a=idxOf(game.stations[0]),b=idxOf(game.stations.at(-1));
      lines+=svg('path',{d:pathOf(D.line.slice(a,b+1)),fill:'none',stroke:C.metro,'stroke-width':8,'stroke-linecap':'round','stroke-linejoin':'round',opacity:.9});}
    // hover: walking reach from that spot to every estate and destination
    if(hover){const [hx,hy]=xy(hover);
      D.origins.forEach((o,i)=>{const d=walk(o.cell,hover),w=willing(d);if(w<=0)return;const [x,y]=xy(o.cell);
        lines+=svg('path',{d:`M${hx} ${hy}L${x} ${y}`,stroke:C.accent,'stroke-width':1.4,'stroke-dasharray':'3 5',opacity:.55});
        labels+=pill(x,y+(o.house[1]<0?-62:62),t('m.reach',{p:Math.round(w*100),n:d}),C.accent);});
      D.destinations.forEach((o,k)=>{const d=walk(o.cell,hover),w=willing(d);if(w<=0)return;const [x,y]=xy(o.cell);
        lines+=svg('path',{d:`M${hx} ${hy}L${x} ${y}`,stroke:DCOL(o.kind),'stroke-width':1.4,'stroke-dasharray':'3 5',opacity:.6});
        labels+=pill(x+(o.house[0]<0?-8:o.house[0]>0?8:0),y+(o.house[1]<0?-62:o.house[1]>0?62:40),t('m.reach',{p:Math.round(w*100),n:d}),DCOL(o.kind));});}
    // estates and destinations
    D.origins.forEach((o,i)=>{const [cx,cy]=xy(o.cell),hx=cx+o.house[0],hy=cy+o.house[1]*.55;
      things+=sprite(ESTATE,cx-18,cy-24,3,{k:C.ink,w:C.paper,l:C.warn,g:C.ink2});
      labels+=text(cx,o.house[1]<0?cy-32:cy+30,nameO(i),15.5,C.ink,{'text-anchor':'middle','font-weight':600});
      if(fc){const e=fc.est[i];
        if(e.tries){const f=e.ride/e.tries;rings+=svg('circle',{cx,cy:cy-4,r:27,fill:'none',stroke:C.ink3,'stroke-width':1,'stroke-opacity':.3,'stroke-dasharray':'1.5 4'});
          if(f>0)rings+=svg('path',{d:arc(cx,cy-4,27,f),fill:'none',stroke:C.accent,'stroke-width':3,'stroke-linecap':'round'});}
        const up=o.house[1]<0,yy=up?cy-50:cy+48;
        labels+=text(cx,yy,t('m.tries',{a:e.tries,n:e.n}),13,C.ink2,{'text-anchor':'middle','font-family':'Geist Mono,monospace'});
        if(game.stations.length&&(e.noHome||e.noThere))labels+=pill(cx,yy+(up?-22:20),e.noHome?t('m.noHome',{n:e.noHome}):t('m.noThere',{n:e.noThere}),C.bad);}});
    D.destinations.forEach((o,k)=>{const [cx,cy]=xy(o.cell);
      things+=sprite(DEST[o.kind],cx-(DEST[o.kind][0].length*3)/2,cy-24,3,{k:C.ink,w:C.paper,a:DCOL(o.kind),r:C.accent2,p:C.paper,l:C.warn,d:DCOL(o.kind),g:C.ink2});
      const lx=cx+(o.house[0]<0?-26:o.house[0]>0?26:0),la=o.house[0]<0?'end':o.house[0]>0?'start':'middle',ly=o.house[1]<0?cy-32:o.house[0]?cy-6:cy+30;
      labels+=text(lx,ly,nameD(k),15.5,DCOL(o.kind),{'text-anchor':la,'font-weight':600});
      if(fc){const d=fc.dst[k];if(d.tries){const f=d.ride/d.tries;rings+=svg('circle',{cx,cy:cy-4,r:27,fill:'none',stroke:C.ink3,'stroke-width':1,'stroke-opacity':.3,'stroke-dasharray':'1.5 4'});
        if(f>0)rings+=svg('path',{d:arc(cx,cy-4,27,f),fill:'none',stroke:DCOL(o.kind),'stroke-width':3,'stroke-linecap':'round'});}}});
    // free spots on the alignment (before the start only: stations are built once)
    if(!game.started)for(const c of D.line){if(game.stations.some(s=>same(s,c)))continue;const [x,y]=xy(c),on=hover&&same(hover,c),can=game.stations.length<P.stationsMax;
      things+=svg('g',{class:'candidate','data-cell':c.join(','),role:'button',tabindex:0,opacity:can?1:.35},svg('rect',{x:x-13,y:y-13,width:26,height:26,fill:'transparent'})+
        sprite(PLUS,x-(on?12.25:9.1),y-(on?12.25:9.1),on?3.5:2.6,{k:on?C.metro:C.ink3,p:on?C.paper:C.panel}));}
    // people on foot: coloured by where they are going
    for(const p of game.people){let pos=null;
      if(p.state==='walk')pos=along(D.origins[p.origin].cell,game.stations[p.from],(game.t-p.since)/Math.max(1e-6,p.until-p.since));
      else if(p.state==='walkout')pos=along(game.stations[p.to],D.destinations[p.dest].cell,(game.t-p.since)/Math.max(1e-6,p.until-p.since));
      if(!pos)continue;const [x,y]=xy(pos),ox=(p.id%3-1)*4,oy=(p.id%2?1:-1)*3;
      things+=svg('rect',{x:(x+ox-2.6).toFixed(1),y:(y+oy-2.6).toFixed(1),width:5.2,height:5.2,fill:DCOL(D.destinations[p.dest].kind),stroke:C.panel,'stroke-width':.8,'shape-rendering':'crispEdges'});}
    // trains
    if(game.started&&!game.done)for(const tr of game.trains){const ps=game.trainPos(tr);if(!ps)continue;const [x,y]=xy(lineAt(ps.at));
      things+=`<g transform="translate(${(x-28.5).toFixed(1)} ${(y-9).toFixed(1)})${ps.dir<0?` scale(-1 1) translate(-57 0)`:''}">`+sprite(TRAIN,0,0,3,{m:C.metro,w:C.paper,k:C.ink})+'</g>';
      labels+=text(x,y-13,`${tr.load.length}/${P.cap}`,12,C.metro,{'text-anchor':'middle','font-weight':600,'font-family':'Geist Mono,monospace'});}
    // stations: a badge, the name, the two platforms (eastbound above, westbound below) and in the preview the load
    game.stations.forEach((c,i)=>{const [x,y]=xy(c);
      if(fc){const L=fc.load[i],per=Math.max(1,Math.ceil(P.release/Math.max(1,game.headway(game.trainsByWeek[vw]||2)))*P.cap),f=Math.min(1.4,(L.out)/per);
        if(f>.3)rings+=svg('circle',{cx:x,cy:y,r:(26+18*Math.min(1,f)).toFixed(1),fill:f>1?C.bad:C.warn,'fill-opacity':(.10+.18*Math.min(1,f)).toFixed(2)});
        labels+=text(x,y+36,t('m.load',{a:L.out,b:L.in}),12.5,f>1?C.bad:C.ink2,{'text-anchor':'middle','font-family':'Geist Mono,monospace'});}
      things+=svg('circle',{cx:x,cy:y,r:14,fill:C.panel,stroke:C.metro,'stroke-width':5})+svg('text',{x,y:y+5,'font-size':15,'font-weight':700,fill:C.metro,'text-anchor':'middle','font-family':'Geist Mono,monospace'},i+1);
      labels+=text(x,y-22,stationName(c),14.5,C.metro,{'text-anchor':'middle','font-weight':700});
      if(game.started&&!game.done){for(const [dir,dy] of [[1,-38],[-1,-31]]){const q=game.queue(i,dir).length;if(!q)continue;const w=Math.min(1,q/P.platform);
        things+=svg('rect',{x:x+18,y:y+dy+16,width:(26*w).toFixed(1),height:4,fill:w>=1?C.bad:w>.6?C.warn:C.ink3,'shape-rendering':'crispEdges'});
        labels+=text(x+48,y+dy+21,`${dir>0?'→':'←'}${q}`,11.5,w>=1?C.bad:C.ink2,{'font-family':'Geist Mono,monospace'});}}
      if(!game.started)things+=svg('circle',{cx:x,cy:y,r:16,fill:'transparent',class:'stationhit','data-station':i,role:'button',tabindex:0});});
    $('board').innerHTML=ground+lines+rings+things+labels;
  }
  function arc(cx,cy,r,f){if(f>=.999)return `M${cx} ${cy-r}A${r} ${r} 0 1 1 ${cx-.01} ${cy-r}`;const a=2*Math.PI*f,x=cx+r*Math.sin(a),y=cy-r*Math.cos(a);
    return `M${cx} ${cy-r}A${r} ${r} 0 ${f>.5?1:0} 1 ${x.toFixed(1)} ${y.toFixed(1)}`;}

  /* -------------------------------------------------------------- side panels */
  function side(){
    const st=game.stats(),onway=game.people.filter(p=>['walk','queue','ride','walkout'].includes(p.state)).length;
    $('score').textContent=st.delivered;$('score2').textContent=st.delivered;$('cars').textContent=st.cars;$('onway').textContent=onway;$('walked').textContent=st.walked;
    const lo=Math.max(0,P.target-(P.masterScore-P.target)*1.5),hi=P.masterScore+(P.masterScore-P.target)*.4,at=v=>Math.max(0,Math.min(100,100*(v-lo)/(hi-lo)));
    $('scoreBar').style.width=`${at(st.delivered)}%`;
    for(const [id,v,k] of [['tickPass',P.target,'g.tickPass'],['tickHigh',P.highScore,'g.tickHigh'],['tickMaster',P.masterScore,'g.tickMaster']]){$(id).style.left=`${at(v)}%`;$(id).dataset.label=t(k,{n:v});}
    $('clock').textContent=fmt(game.t);$('clockProg').style.width=`${game.done?100:100*game.round/D.weeks}%`;
    $('wave').textContent=!game.started?t('m.wFirst'):game.done?t('m.wDone'):inter?t('m.wBreak',{n:inter.r+1,m:D.weeks}):t('m.wNow',{n:game.round+1,m:D.weeks});
    $('start').textContent=game.done?t('g.over'):game.started?(playing?t('g.pause'):t('g.resume')):t('g.start');
    $('start').disabled=game.done||(!game.started&&game.stations.length<2);
    document.querySelectorAll('#speedSeg button').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.sp===speed)));
    // building
    const n=game.stations.length;
    $('buildBox').innerHTML=`<h3><span>${t('m.buildH')}</span><span class="lbl">${n} / ${P.stationsMax}</span></h3>`+
      (game.started?`<p>${t('m.built',{list:game.stations.map(stationName).join(t('sep'))})}</p>`:
        `<p>${n<2?t('m.buildHint'):n<P.stationsMax?t('m.buildMore',{n:P.stationsMax-n}):t('m.buildFull')}</p>`)+
      (n>=2?`<div class="r"><span>${t('m.loop')}</span><span class="mono">${t('m.loopV',{T:Math.round(game.loop().T)})}</span></div>`:'');
    // trains: this week (before the start: week 1; in a break: the coming week)
    const w=game.started?(inter?inter.r:game.round):0,edit=!game.done&&(!game.started||!!inter),cur=game.trainsByWeek[w]??(w?game.trainsByWeek[w-1]:2)??2,[lo2,hi2]=game.trainsRange(w);
    const left=P.budget-game.trainsByWeek.slice(0,w).reduce((a,b)=>a+b,0);
    let h=`<h3><span>${t('m.trainH',{n:w+1})}</span><span class="lbl">${t('m.budget',{a:left,b:P.budget})}</span></h3><div class="seg tsel">`;
    for(let k=P.trainsMin;k<=P.trainsMax;k++)h+=`<button data-trains="${k}" aria-pressed="${k===cur}" ${!edit||k<lo2||k>hi2?'disabled':''}>${k}</button>`;
    h+=`</div><div class="r"><span>${t('m.headway')}</span><span class="mono">${n>=2?t('m.headwayV',{h:Math.round(game.headway(cur))}):'—'}</span></div>`;
    h+=`<p class="mnote">${edit?t('m.trainEdit',{later:D.weeks-w-1}):t('m.trainLocked')}</p>`;
    if($('trainBox').innerHTML!==h)$('trainBox').innerHTML=h;
    weeks();habit();
  }
  function weeks(){
    const vw=vizWeek(),fc=vw>=0?game.forecast(vw):null;let h=`<thead><tr><th>${t('m.wk')}</th><th>${t('m.wTrains')}</th><th>${t('m.wHabit')}</th><th>${t('m.wTry')}</th><th>${t('m.wRode')}</th><th>${t('m.wFull')}</th></tr></thead><tbody>`;
    for(let w=0;w<D.weeks;w++){const ps=game.people.filter(p=>p.wave===w),begun=game.started&&w<=game.round&&w!==vw,hab=game.habitLog[w]?.habit;
      const avg=hab?Math.round(100*hab.reduce((a,b)=>a+b,0)/hab.length)+'%':'';
      h+=`<tr class="${w===game.round&&game.started&&!inter&&!game.done?'now':''} ${w===vw?'next':''} ${game.started&&w<game.round?'past':''}"><td>${t('m.wkN',{n:w+1})}</td><td>${game.trainsByWeek[w]??''}</td><td>${avg}</td>`+
        `<td>${begun?ps.filter(p=>p.tried).length:w===vw&&fc?fc.est.reduce((a,e)=>a+e.tries,0):''}</td><td>${begun?ps.filter(p=>p.state==='delivered').length:''}</td><td>${begun?ps.filter(p=>p.why==='月台太擠').length||'':''}</td></tr>`;}
    $('weeks').innerHTML=h+'</tbody>';$('weeksChip').textContent=t('m.weeksChip',{n:D.weeks});
  }
  function habit(){
    const log=game.habitLog,prev=log.length>1?log.at(-2).habit:null;
    let h='';D.origins.forEach((o,i)=>{const v=game.habit[i],d=prev?Math.round(100*(v-prev[i])):0,on=Math.round(v*10);
      h+=`<div class="hb"><span class="hn">${nameO(i)}</span><span class="cells">${Array.from({length:10},(_,k)=>`<i class="${k<on?'on':''}"></i>`).join('')}</span><b>${Math.round(v*100)}%</b><em class="${d>0?'up':d<0?'down':''}">${d>0?'▲'+d:d<0?'▼'+(-d):''}</em></div>`;});
    h+=`<p class="hbnote">${t('m.habitNote',{s:Math.round(D.habit.start*100)})}</p>`;
    if($('habitBox').innerHTML!==h)$('habitBox').innerHTML=h;
  }
  function countdown(){const el=$('cdown');if(!inter||game.done){el.classList.remove('on');return;}const still=inter.adjust||!playing;
    el.classList.add('on');el.classList.toggle('paused',still);$('cdNum').textContent=still?'❚❚':Math.max(1,Math.ceil((inter.end-performance.now())/1000-1e-6));
    $('cdText').textContent=t('m.cd',{n:inter.r+1});$('cdHint').textContent=still?t('m.cdAdjust'):t('m.cdHint');}
  function render(){draw();side();countdown();if(game.done&&!shown){shown=true;playing=false;result();side();}}
  function fit(){draw();try{const bb=$('board').getBBox(),x0=Math.min(0,bb.x-12),y0=Math.min(0,bb.y-12),x1=Math.max(VBW,bb.x+bb.width+12),y1=Math.max(VBH,bb.y+bb.height+12);
    $('board').setAttribute('viewBox',`${x0} ${y0} ${x1-x0} ${y1-y0}`);}catch(e){}}

  /* -------------------------------------------------------------- texts that follow the language */
  function texts(){
    $('titleEn').textContent='The metro';$('titleTc').textContent=t('m.levelTitle');$('titleTc').hidden=!$('titleTc').textContent;document.title=t('m.doc');
    $('totalN').textContent=total();
    $('goal').innerHTML=t('m.goal',{pass:P.target,high:P.highScore,master:P.masterScore});
    $('rule3').innerHTML=t('m.rule3',{cap:P.cap,platform:P.platform,budget:P.budget,min:P.trainsMin,max:P.trainsMax});
    $('legend').innerHTML=`<span><i style="background:${C.warn}"></i>${t('m.legTown')}</span><span><i style="background:${C.info}"></i>${t('m.legJobs')}</span><span><i style="background:${C.accent2}"></i>${t('m.legSchool')}</span>`+
      `<span><i class="ringkey good"></i>${t('m.legRing')}</span><span><i style="background:${C.warn};opacity:.4;border-radius:50%"></i>${t('m.legGlow')}</span>`;
    $('infoBody').innerHTML=t('m.info',{cap:P.cap,platform:P.platform,budget:P.budget,max:P.stationsMax,step:P.trainStep,dwell:P.dwell,turn:P.turn,walk:P.walkStep,s:Math.round(D.habit.start*100),weeks:D.weeks});
  }

  /* -------------------------------------------------------------- the end */
  function result(){
    const tier=game.delivered>=P.masterScore?3:game.delivered>=P.highScore?2:game.delivered>=P.target?1:0;
    $('result').classList.toggle('win',tier>0);$('resultTitle').textContent=t('r.t'+tier);$('resultEn').textContent=['Try again','Cleared','High score','Master'][tier];
    $('resultScore').textContent=t('m.rScore',{d:game.delivered,n:total(),c:game.cars,w:game.walked});
    const why={};for(const p of game.people)if(p.state==='car')why[p.why]=(why[p.why]||0)+1;
    let h=`<table class="result"><thead><tr><th>${t('m.wk')}</th><th>${t('m.wTrains')}</th><th>${t('m.wHabit')}</th><th>${t('m.wTry')}</th><th>${t('m.wRode')}</th><th>${t('m.wFull')}</th></tr></thead><tbody>`;
    for(let w=0;w<D.weeks;w++){const ps=game.people.filter(p=>p.wave===w),hab=game.habitLog[w].habit;
      h+=`<tr><td>${t('m.wkN',{n:w+1})}</td><td>${game.trainsByWeek[w]}</td><td>${Math.round(100*hab.reduce((a,b)=>a+b,0)/hab.length)}%</td><td>${ps.filter(p=>p.tried).length}</td><td>${ps.filter(p=>p.state==='delivered').length}</td><td>${ps.filter(p=>p.why==='月台太擠').length||''}</td></tr>`;}
    h+=`</tbody></table><p class="note">${Object.entries(why).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${t('m.why.'+(WHY[k]||'home'))} ${v}`).join(' · ')}</p>`;
    $('resultBody').innerHTML=h;
    // the one lesson that fits this game best
    const early=game.trainsByWeek.slice(0,2).reduce((a,b)=>a+b,0),late=game.trainsByWeek.slice(-2).reduce((a,b)=>a+b,0);
    $('resultHint').innerHTML=tier>=3?t('m.h3'):(why['終點沒有站']||0)>(why['起點沒有站']||0)&&(why['終點沒有站']||0)>20?t('m.hThere',{n:why['終點沒有站']}):
      (why['起點沒有站']||0)>20?t('m.hHome',{n:why['起點沒有站']}):(why['月台太擠']||0)>15?(early>=late?t('m.hFront',{n:why['月台太擠']}):t('m.hCrowd',{n:why['月台太擠']})):
      t('m.hLoop');
    $('result').showModal();
  }

  /* -------------------------------------------------------------- controls */
  function reset(msg){game=new Game();playing=false;shown=false;inter=null;hover=null;seen=0;note(msg||t('m.nBuild'));render();}
  function setPlaying(v,msg){if(v===playing)return;playing=v;last=performance.now();if(inter){if(v)inter=null;else inter.adjust=true;}if(msg)note(msg);render();}
  const board=$('board');
  function svgPoint(e){const pt=board.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;return pt.matrixTransform(board.getScreenCTM().inverse());}
  const cellAt=e=>{const p=svgPoint(e);return D.line.find(c=>{const [x,y]=xy(c);return Math.hypot(p.x-x,p.y-y)<22;});};
  board.onclick=e=>{if(game.started)return;const c=cellAt(e);if(!c)return;
    if(game.stations.some(s=>same(s,c))){game.unbuild(c);note(t('m.nRemoved'));}
    else if(game.build(c)){note(game.stations.length>=2?t('m.nCanStart'):t('m.nBuild'));}
    else toast(t('m.nMax',{n:P.stationsMax}),'warn');
    hover=null;render();};
  board.onpointermove=e=>{const c=!game.started?cellAt(e)||null:null,h=c&&!game.stations.some(s=>same(s,c))?c:null;if(JSON.stringify(h)!==JSON.stringify(hover)){hover=h;draw();}};
  board.onpointerleave=()=>{if(hover){hover=null;draw();}};
  $('trainBox').onclick=e=>{const b=e.target.closest('[data-trains]');if(!b||b.disabled)return;const w=game.started?(inter?inter.r:game.round):0;
    if(game.setTrains(+b.dataset.trains,w)){note(t('m.nTrains',{n:+b.dataset.trains,w:w+1}));render();}};
  $('start').onclick=()=>{if(!game.started){if(!game.start())return;note(t('m.nStart'));}setPlaying(!playing,playing?t('m.nPause'):null);};
  $('speedSeg').onclick=e=>{const b=e.target.closest('[data-sp]');if(b){speed=+b.dataset.sp;side();}};
  $('reset').onclick=()=>{if(game.started&&!game.done&&!confirm(t('m.cReset')))return;reset();};
  $('help').onclick=()=>{if(playing)setPlaying(false);$('info').showModal();};
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  $('again').onclick=()=>{$('result').close();reset();};
  function intro(){$('ivTitle').textContent=t('m.levelTitle');$('ivNew').innerHTML=t('iv.m2.new');$('ivBody').innerHTML=t('iv.m2.body',{max:P.stationsMax,budget:P.budget,s:Math.round(D.habit.start*100)});$('ivCourse').innerHTML=t('iv.m2.course');}
  $('lvInfo').onclick=()=>{if(playing)setPlaying(false);intro();$('lvIntro').showModal();};
  $('ivGo').onclick=()=>$('lvIntro').close();
  function setTheme(th){document.documentElement.setAttribute('data-theme',th);$('thPaper').setAttribute('aria-pressed',String(th==='light'));$('thInk').setAttribute('aria-pressed',String(th==='dark'));
    try{localStorage.setItem('tl-theme',th);}catch(e){}readTokens();texts();render();}
  $('thPaper').onclick=()=>setTheme('light');$('thInk').onclick=()=>setTheme('dark');
  window.addEventListener('tl:lang',()=>{texts();fit();render();if($('lvIntro').open)intro();});
  document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]'))return;
    if(e.code==='Space'&&!e.target.closest?.('button,input')){e.preventDefault();if(game.started&&!game.done)setPlaying(!playing,playing?t('m.nPause'):null);}
    if(e.code==='KeyF'){fastHeld=true;$('fastHint').classList.add('on');}});
  document.addEventListener('keyup',e=>{if(e.code==='KeyF'){fastHeld=false;$('fastHint').classList.remove('on');}});
  document.addEventListener('visibilitychange',()=>{last=performance.now();if(document.hidden&&playing)setPlaying(false);});
  // feedback from the engine: a toast when a week starts and the first time a platform overflows in a week
  let fullWeek=-1;
  function feedback(){const ev=game.events;
    for(let i=seen;i<ev.length;i++){const e=ev[i];
      if(e.type==='full'&&fullWeek!==game.round){fullWeek=game.round;toast(t('m.tFull',{s:stationName(game.stations[e.station])}),'warn');}
      else if(e.type==='round')toast(t('m.tWeek',{n:e.round+1,k:game.trainsByWeek[e.round],h:Math.round(game.headway())}),'tide');}
    seen=ev.length;}
  function frame(now){const dt=Math.min(.5,(now-last)/1000);last=now;
    if(playing){
      if(inter){if(now>=inter.end){inter=null;toast(t('m.tWeek',{n:game.round+1,k:game.trainsByWeek[game.round],h:Math.round(game.headway())}),'tide');render();}}
      else{const r0=game.round;game.advance(dt*speed*SPEED_BASE*(fastHeld?FAST:1),{stopAtRound:true});
        if(game.round!==r0&&!game.done){inter={r:game.round,end:now+INTER_MS,adjust:false};seen=game.events.length;render();}}
      feedback();countdown();
      if(now-lastDraw>40){draw();lastDraw=now;}if(now-lastSide>200){side();lastSide=now;}
      if(game.done&&!shown)render();}
    else if(now-lastDraw>80){draw();lastDraw=now;}
    requestAnimationFrame(frame);}
  // test hook: #intro=0&stations=2,5;5,5;11,4;12,4&trains=1,2,3,3,3,3&t=400&theme=dark&lang=en
  const q=new URLSearchParams(location.hash.slice(1));
  let saved=null;try{saved=localStorage.getItem('tl-theme');}catch(e){}
  $('board').setAttribute('viewBox',`0 0 ${VBW} ${VBH}`);
  if(q.get('theme')||saved)setTheme(q.get('theme')||saved);
  texts();
  if(q.get('stations'))for(const s of q.get('stations').split(';'))game.build(s.split(',').map(Number));
  if(q.get('trains'))q.get('trains').split(',').map(Number).forEach((n,w)=>game.setTrains(n,w));
  if(q.get('t')&&game.start()){game.advance(+q.get('t'));seen=game.events.length;}
  note(t('m.nBuild'));fit();render();
  if(q.get('intro')!=='0'&&!q.get('stations')){intro();$('lvIntro').showModal();}
  window.TL_METRO={state:()=>({t:game.t,round:game.round,playing,inter:inter&&{...inter},done:game.done,delivered:game.delivered,stations:game.stations.length,trains:game.trainsByWeek.slice()}),
    start(){$('start').click();}};
  requestAnimationFrame(frame);
})();
