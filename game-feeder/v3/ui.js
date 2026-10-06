(()=>{
  'use strict';
  const {Game,D,P,route,dist,along,same,headwayAt}=Tide,$=id=>document.getElementById(id);
  const letters=['A','B','C'],total=D.waves.flat().reduce((a,b)=>a+b,0);
  const shortName=D.origins.map(o=>o.short||o.name);
  // Colours come from the CSS tokens so the Paper / Ink switch repaints the board too.
  let C={};
  function readTokens(){const s=getComputedStyle(document.documentElement),v=n=>s.getPropertyValue('--s-'+n).trim();
    C={paper:v('paper'),panel:v('panel'),soft:v('soft'),raise:v('raise'),ink:v('ink'),ink2:v('ink2'),ink3:v('ink3'),line:v('line'),line2:v('line2'),
      accent:v('accent'),accent2:v('accent2'),warn:v('warn'),bad:v('bad'),info:v('info'),road:v('road'),roadEdge:v('road-edge')};}
  readTokens();
  let game=new Game(),selected=0,playing=false,speed=1,hover=null,shown=false,drag=null,pointerPressed=false,restoringFocus=false;
  let last=performance.now(),lastDraw=0,lastSide=0,seen=0,lastDelivered=0,warned=new Set(),rang=new Set(),toastTimer=0;
  const [MX,MY]=D.margin||[20,30],xy=c=>[MX+c[0]*72,MY+c[1]*62];
  // board size follows the map: grid cells plus room for the buildings and labels around them
  const VBW=MX+(D.cols-1)*72+Math.max(MX,120),VBH=MY+(D.rows-1)*62+86;
  document.getElementById('board').setAttribute('viewBox',`0 0 ${VBW} ${VBH}`);document.getElementById('fx').setAttribute('viewBox',`0 0 ${VBW} ${VBH}`);
  const fmt=n=>`${String(Math.floor(Math.max(0,n)/60)).padStart(2,'0')}:${String(Math.floor(Math.max(0,n)%60)).padStart(2,'0')}`;
  const pathStr=path=>path.map((c,i)=>(i?'L':'M')+xy(c).join(' ')).join(' ');
  const svg=(tag,attrs,content='')=>`<${tag} ${Object.entries(attrs).map(([k,v])=>`${k}="${v}"`).join(' ')}>${content}</${tag}>`;
  const text=(x,y,s,size=13,fill=C.ink,extra={})=>svg('text',{x,y,'font-size':size,fill,stroke:C.panel,'stroke-width':3.5,...extra},s);
  const rect=(x,y,w,h,fill,stroke=C.line2,extra={})=>svg('rect',{x,y,width:w,height:h,rx:4,fill,stroke,...extra});
  const waveStart=w=>P.firstWave+w*P.interval;
  const houseAt=i=>{const [x,y]=xy(D.origins[i].cell),[dx,dy]=D.origins[i].house||[0,38];return[x+dx,y+dy];};
  // name label: above a building that sits above its road, otherwise below it
  const labelY=i=>{const [,hy]=houseAt(i),dy=(D.origins[i].house||[0,38])[1];return dy<0?hy-22:hy+28;};
  function note(s){$('notice').textContent=s;}
  function toast(s,kind=''){const t=$('toast');t.className='toast on '+kind;t.textContent=s;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('on'),2600);}

  /* ------------------------------------------------------------ feedback layer */
  let fxId=0;
  function fx(markup,ms=1700){const g=document.createElementNS('http://www.w3.org/2000/svg','g'),id='fx'+(++fxId);g.id=id;g.innerHTML=markup;$('fxl').appendChild(g);if(!document.body.classList.contains('fxfreeze'))setTimeout(()=>g.remove(),ms);}
  // Arrivals: a green glow at the MTR, brighter and wider the more people step off at once,
  // with one tide ring per 4 people (up to three, like the three tiers of the logo).
  function fxArrive(n){const [x,y]=xy(D.hub),r=26+9*Math.sqrt(n),peak=Math.min(1,.4+.1*n);
    let m=svg('circle',{class:'fx glow',cx:x,cy:y,r,fill:'url(#gGood)',style:`--peak:${peak.toFixed(2)};--d:${(1.3+.06*n).toFixed(2)}s`});
    for(let k=0;k<Math.min(3,1+Math.floor(n/4));k++)m+=svg('circle',{class:'fx ring',cx:x,cy:y,r:r*.9,stroke:C.accent2,style:`animation-delay:${k*.16}s`});
    m+=svg('text',{class:'fx float',x:x+30,y:y-26,fill:C.accent,stroke:C.panel},`+${n}`);
    fx(m,2000);pulse('hudGood','pop');}
  // Losses: a red→amber flash at the estate, "−n", and a little red car leaving.
  function fxLoss(o,n){const [x,y]=houseAt(o),dir=(D.origins[o].house||[0,0])[0]<0?-1:1,r=20+7*Math.sqrt(n);
    let m=svg('circle',{class:'fx glow',cx:x,cy:y,r,fill:'url(#gBad)',style:`--peak:${Math.min(1,.5+.12*n).toFixed(2)};--d:1.1s`});
    m+=svg('text',{class:'fx float',x:x+(o===0?-44:26),y:y-14,fill:C.bad,stroke:C.panel},`−${n}`);
    for(let k=0;k<Math.min(3,n);k++)m+=svg('g',{class:'fx car',style:`--dx:${dir*(80+k*18)}px;animation-delay:${k*.12}s`},
      rect(x-9+dir*22,y+12+k*4,18,9,C.bad,C.bad,{rx:3})+svg('circle',{cx:x-4+dir*22,cy:y+21+k*4,r:2.2,fill:C.ink})+svg('circle',{cx:x+5+dir*22,cy:y+21+k*4,r:2.2,fill:C.ink}));
    fx(m,2000);pulse('hudBad','hit');}
  // Someone turned away at a full stop: a quiet red ripple, no words (the stop itself carries the FULL chip).
  function fxFull(s){const st=game.stops[s];if(!st.cell)return;const [x,y]=xy(st.cell);
    fx(svg('circle',{class:'fx ring',cx:x,cy:y,r:24,stroke:C.bad,style:'--d:1s'}),1100);}
  function fxDepart(s,n){const st=game.stops[s];if(!st.cell)return;const [x,y]=xy(st.cell);
    fx(svg('circle',{class:'fx ring',cx:x,cy:y,r:22,stroke:C.accent,style:'--d:.9s'}),1000);}
  function fxTide(o){const [x,y]=houseAt(o);
    fx(svg('circle',{class:'fx glow',cx:x,cy:y,r:46,fill:'url(#gTide)',style:'--d:2s'})+[0,1,2].map(k=>svg('circle',{class:'fx ring',cx:x,cy:y,r:34,stroke:C.warn,style:`animation-delay:${k*.25}s;--d:1.6s`})).join(''),2600);}
  function fxBuilt(s){const st=game.stops[s];if(!st.cell)return;const [x,y]=xy(st.cell);
    fx(svg('circle',{class:'fx ring',cx:x,cy:y,r:26,stroke:C.accent2,'stroke-dasharray':'4 4',style:'--d:1.2s'}),1300);}
  function pulse(id,cls){const el=$(id);el.classList.remove(cls);void el.offsetWidth;el.classList.add(cls);}
  // Turn new engine events into effects, batched per frame.
  function feedback(){
    const ev=game.events;if(seen>ev.length)seen=0;
    let delivered=0;const cars={},full=new Set(),departs=[];
    for(let i=seen;i<ev.length;i++){const e=ev[i];
      if(e.type==='delivered')delivered++;else if(e.type==='car')cars[e.origin]=(cars[e.origin]||0)+1;
      else if(e.type==='full')full.add(e.stop);else if(e.type==='dispatch'&&e.load>0)departs.push([e.stop,e.load]);
      else if(e.type==='move')setTimeout(()=>fxBuilt(e.stop),P.build*1000/Math.max(1,speed));}
    seen=ev.length;
    if(delivered)fxArrive(delivered);
    for(const o in cars)fxLoss(+o,cars[o]);
    full.forEach(fxFull);departs.forEach(([s,n])=>fxDepart(s,n));
    // Peaks: warn 25 s ahead, then a tide ripple as the batch starts.
    for(const pk of D.peaks){const t0=waveStart(pk.wave),n=D.waves[pk.wave][pk.origin],name=D.origins[pk.origin].name;
      if(game.t>=t0-25&&game.t<t0&&!warned.has(pk.wave)){warned.add(pk.wave);toast(`25 秒後 · ${name} 高峰 ${n} 人`,'tide');}
      if(game.t>=t0&&!rang.has(pk.wave)){rang.add(pk.wave);fxTide(pk.origin);toast(`漲潮 · ${name} 這批 ${n} 人出門`,'tide');}}
    if(lastDelivered<P.target&&game.delivered>=P.target)toast(`過關 · CLEARED  ${P.target} 人送達`);
    if(lastDelivered<P.highScore&&game.delivered>=P.highScore)toast(`高分 · HIGH SCORE  ${P.highScore} 人送達`);
    if(lastDelivered<P.masterScore&&game.delivered>=P.masterScore)toast(`潮汐大師 · TIDE MASTER  ${P.masterScore} 人送達`);
    lastDelivered=game.delivered;
  }

  /* ---------------------------------------------------------------- the board */
  function put(cell){
    const was=game.started;
    if(game.place(selected,cell)){
      hover=null;
      note(was?`${letters[selected]} 站搬好了，重建 20 秒；站上還沒上車的人要走回家，已開出的巴士照常送達。`:'放好了。可以選另一座站，或拖動已放的站。');
      if(!was){fxBuilt(selected);const next=game.stops.find(s=>!s.cell);if(next)selected=next.id;}
      render();
    }else note(was&&game.moves===0?'搬站次數已用完。':'這格已有車站，請選另一個 ＋。');
  }
  function plan(fc){
    return D.waves.map((w,wi)=>{
      const load=[0,0,0];fc.forEach(f=>{if(f.stop>=0)load[f.stop]+=f.perWave[wi];});
      const hot=load.map((l,s)=>{const c=hover&&s===selected?hover:game.stops[s].cell;if(!c||!l)return false;
        return l>P.seats*Math.max(1,Math.floor(P.interval/headwayAt(c)))+P.queue;});
      return{load,hot};
    });
  }
  function drawHouse(i,fc){
    const o=D.origins[i],h=game.homeStats(i),[hx,hy]=houseAt(i),[cx,cy]=xy(o.cell);
    let out=svg('path',{d:`M${cx} ${cy}L${hx} ${hy}`,stroke:C.ink3,'stroke-width':1.5,'stroke-dasharray':'2 3'});
    if(hover){const f=fc[i],w=f.stop===selected?f.share:0,k=f.perWave;
      if(w>0){const r=22+24*w,next=game.started?game.waveInfo().next:0;
        out+=svg('circle',{cx:hx,cy:hy,r,fill:C.accent2,'fill-opacity':(.08+.16*w).toFixed(2),stroke:C.accent,'stroke-width':1.5+2*w});
        const right=hx<VBW*.72,lx=right?hx+r+6:hx-r-6,anchor=right?'start':'end';   // keep the label inside the board
        out+=text(lx,hy-2,`${Math.round(w*100)}%`,16,C.accent,{'font-weight':600,'font-family':'Geist Mono,monospace','text-anchor':anchor});
        if(next>=0)out+=text(lx,hy+15,`下批 ${k[next]}/${D.waves[next][i]} 人`,12,C.accent,{'font-weight':500,'text-anchor':anchor});}}
    // pixel building
    out+=rect(hx-17,hy-10,12,22,C.ink2,C.ink,{rx:1})+rect(hx-4,hy-16,10,28,C.ink,C.ink,{rx:1})+rect(hx+7,hy-6,10,18,C.ink2,C.ink,{rx:1});
    for(let k=0;k<3;k++)out+=svg('rect',{x:hx-1+(k%2)*3,y:hy-12+k*7,width:2,height:3,fill:C.paper});
    out+=text(hx,labelY(i),o.name,14,C.ink,{'text-anchor':'middle','font-weight':600});
    // people at home deciding: beside a building under its road, above a building beside its road
    const side=(o.house||[0,38])[0]!==0,[bx,by]=side?[hx-17,hy-46]:[hx+20,hy-12];
    if(h.home)out+=rect(bx,by,34,20,C.panel,C.warn,{'stroke-width':1.5})+text(bx+17,by+15,`${h.home}`,12.5,C.warn,{'text-anchor':'middle','font-weight':600,'font-family':'Geist Mono,monospace'});
    return out;
  }
  function drawMap(){
    if(pointerPressed&&!drag?.moved)return;           // keep the node under the pointer alive for the click
    const focused=document.activeElement,attrs=['data-cell','data-stop'];
    const focusAttr=attrs.find(a=>focused?.hasAttribute(a)),focusVal=focusAttr?focused.getAttribute(focusAttr):null;
    const fc=game.forecast(hover?selected:-1,hover);
    let out='';
    for(const pass of [[C.roadEdge,24],[C.road,20]])
      for(const c of D.roads)for(const n of [[c[0]+1,c[1]],[c[0],c[1]+1]])if(D.roads.some(q=>same(q,n)))out+=svg('path',{d:pathStr([c,n]),stroke:pass[0],'stroke-width':pass[1],fill:'none','stroke-linecap':'square'});
    const active=game.stops[selected];
    if(active.cell&&!hover)out+=svg('path',{d:pathStr(route(active.cell,D.hub)),stroke:C.accent,'stroke-width':3,fill:'none',opacity:.35});
    if(hover)out+=svg('path',{d:pathStr(route(hover,D.hub)),stroke:C.accent,'stroke-width':3,fill:'none','stroke-dasharray':'5 6'});
    for(let i=0;i<D.origins.length;i++)out+=drawHouse(i,fc);
    const [mx,my]=xy(D.hub);
    out+=rect(mx-23,my-22,46,44,C.ink,C.ink,{rx:3})+svg('rect',{x:mx-23,y:my+15,width:46,height:7,fill:C.accent});
    out+=svg('text',{x:mx,y:my+8,'font-size':25,fill:C.paper,'text-anchor':'middle','font-family':'Bodoni Moda,Georgia,serif','font-weight':600},'M');
    const hl=D.hubLabel==='left',lx=hl?mx-32:mx+32,la=hl?'end':'start';   // station label on the open side
    out+=text(lx,my-8,D.station.zh,15,C.ink,{'font-weight':600,'text-anchor':la});
    out+=text(lx,my+7,D.station.en,9,C.ink3,{'letter-spacing':'.16em','font-family':'Geist Mono,monospace','text-anchor':la});
    out+=text(lx,my+25,`已送達 ${game.delivered}`,13,C.accent,{'font-weight':600,'font-family':'Geist Mono,monospace','text-anchor':la});
    for(const c of D.candidates){
      if(game.stops.some(s=>same(s.cell,c)))continue;
      const [x,y]=xy(c),on=hover&&same(hover,c);
      out+=svg('g',{class:'candidate','data-cell':c.join(','),role:'button',tabindex:0,'aria-label':`放置接駁站於 ${c[0]+1} 列 ${c[1]+1} 行`},
        svg('circle',{cx:x,cy:y,r:11,fill:on?C.accent:C.panel,stroke:on?C.accent:C.ink3,'stroke-width':1.3})+svg('text',{x,y:y+5,'font-size':15,fill:on?C.paper:C.ink3,'text-anchor':'middle'},'＋'));
    }
    for(const p of game.people)if(['walk','return'].includes(p.state)){   // people walk under buses and stops
      const [x,y]=xy(game.pos(p)),ox=(p.id%3-1)*5,oy=(p.id%2?1:-1)*4;
      out+=svg('circle',{cx:x+ox,cy:y+oy,r:3.6,fill:p.state==='walk'?C.info:C.warn,stroke:C.panel,'stroke-width':1});
    }
    for(const b of game.trips.filter(b=>!b.done)){       // buses under the stops
      const [x,y]=xy(along(b.path,game.t-b.since,P.busStep));
      out+=svg('path',{d:pathStr(b.path),fill:'none',stroke:C.accent,'stroke-width':2,opacity:.25});
      out+=rect(x-19,y-11,38,22,C.accent,C.accent,{rx:11})+svg('text',{x,y:y+5,'font-size':12.5,fill:C.paper,'text-anchor':'middle','font-weight':600,'font-family':'Geist Mono,monospace'},`${letters[b.stop]}·${b.load.length}`);
    }
    for(const s of game.stops){if(!s.cell)continue;
      const [x,y]=xy(s.cell),build=Math.max(0,s.ready-game.t),sel=selected===s.id,full=s.queue.length>=P.queue;
      let content='';
      if(full){const breathe=(.35+.3*Math.sin(performance.now()/380)).toFixed(2);   // a slow red breath while the queue is full
        content+=svg('circle',{cx:x,cy:y,r:27,fill:C.bad,'fill-opacity':(breathe*.18).toFixed(3),stroke:C.bad,'stroke-width':1.5,'stroke-opacity':breathe});
        content+=rect(x+20,y-58,58,16,C.bad,C.bad,{rx:8})+svg('text',{x:x+49,y:y-46.5,'font-size':9.5,fill:C.paper,'text-anchor':'middle','font-family':'Geist Mono,monospace','letter-spacing':'.08em','font-weight':600},'FULL 滿');}
      content+=rect(x-16,y-15,32,30,build?C.panel:C.accent,sel?C.ink:C.accent,{'stroke-width':sel?2.5:1.2,'stroke-dasharray':build?'4 3':'none',rx:5});
      content+=svg('text',{x,y:y+7,'font-size':19,fill:build?C.accent:C.paper,'text-anchor':'middle','font-weight':600,'font-family':'Bodoni Moda,Georgia,serif'},letters[s.id]);
      content+=text(x,y+31,game.done?'':build?`重建 ${Math.ceil(build)}s`:game.started?`發車 ${fmt(game.eta(s))}`:`班距 ${game.headway(s)}s`,11.5,C.accent,{'text-anchor':'middle','font-weight':600,'font-family':'Geist Mono,monospace'});
      for(let j=0;j<P.seats;j++)content+=svg('rect',{x:x-29+j*10,y:y-37,width:8,height:8,rx:1.5,fill:j<s.boarding.length?C.accent:C.panel,stroke:C.accent,'stroke-width':1.1});
      for(let j=0;j<P.queue;j++)content+=svg('rect',{x:x-31+j*8,y:y-26,width:6,height:7,rx:1,fill:j<s.queue.length?(full?C.bad:C.warn):C.panel,stroke:full?C.bad:C.warn,'stroke-width':1});
      out+=svg('g',{class:'stop','data-stop':s.id,role:'button',tabindex:0,'aria-label':`接駁站 ${letters[s.id]}：座位 ${s.boarding.length}/${P.seats}，排隊 ${s.queue.length}/${P.queue}`},content);
    }
    $('board').innerHTML=out;
    if(focusAttr){restoringFocus=true;try{$('board').querySelector(`[${focusAttr}="${focusVal}"]`)?.focus({preventScroll:true});}finally{restoringFocus=false;}}
  }

  /* ------------------------------------------------------------ side columns */
  function drawTide(){
    const fc=game.forecast(hover?selected:-1,hover),any=fc.some(f=>f.stop>=0),pl=plan(fc),w=game.waveInfo();
    const cur=game.started?(w.active>=0?w.active:w.next>=0?w.next:8):-1;
    let h=`<thead><tr><th>批次</th>${shortName.map(n=>`<th>${n}</th>`).join('')}</tr></thead><tbody>`;
    D.waves.forEach((wave,wi)=>{
      const past=game.started&&waveStart(wi)+P.release<=game.t;
      h+=`<tr class="${wi===cur?'now':''} ${past?'past':''}"><td>${fmt(waveStart(wi))}</td>`;
      wave.forEach((n,o)=>{const peak=D.peaks.some(p=>p.origin===o&&p.wave===wi),f=fc[o],hot=f.stop>=0&&pl[wi].hot[f.stop];
        h+=`<td class="${peak?'peak':''} ${hot?'hot':''}"><b>${n}</b>${any?`<i>${f.stop<0?'無站':`會來 ${f.perWave[wi]}`}</i>`:''}</td>`;});
      h+='</tr>';
    });
    $('tide').innerHTML=h+'</tbody>';
  }
  function drawStopPanel(){
    const s=game.stops[selected],cell=hover||s.cell;
    let h=`<h3><span>${letters[selected]} 站${hover?' · 預覽':''}</span><span class="lbl">Stop ${letters[selected]}</span></h3>`;
    if(!cell){$('stopPanel').innerHTML=h+'<p>還沒放。滑鼠停在地圖的 ＋ 上先看預覽，再點擊放站。</p>';return;}
    const steps=dist(cell,D.hub),hw=headwayAt(cell),fc=game.forecast(hover?selected:-1,hover);
    const served=fc.filter(f=>f.stop===selected).map(f=>`${D.origins[f.origin].name} ${Math.round(f.share*100)}%`).join('、')||'沒有屋苑選這座站';
    const beyond=D.origins.map((o,i)=>i).filter(i=>{const d=dist(D.origins[i].cell,cell);return d>=Tide.toMTR[i]&&Tide.willing(d)>0;}).map(i=>D.origins[i].name);
    h+=`<div class="r"><span>到港鐵</span><span>${steps} 格 → 班距 <b>${hw}s</b></span></div><div class="r"><span>誰會來</span><span>${served}</span></div>`;
    if(beyond.length)h+=`<div class="r"><span>不會來</span><span>${beyond.join('、')}（比走去港鐵還遠）</span></div>`;
    if(!hover){
      const build=Math.max(0,s.ready-game.t);
      h+=`<div class="r"><span>下一班</span><span class="big">${game.done?'—':!game.started?`開局 +${hw}s`:build?`重建 ${Math.ceil(build)}s`:fmt(game.eta(s))}</span></div>`;
      h+=`<div class="r"><span>座位 ${s.boarding.length}/${P.seats}</span></div><div class="slots">${Array.from({length:P.seats},(_,j)=>`<i class="${j<s.boarding.length?'on':''}"></i>`).join('')}</div>`;
      h+=`<div class="r"><span>排隊 ${s.queue.length}/${P.queue}</span><span>${s.rejected?`被擠走 ${s.rejected} 人次`:''}</span></div><div class="slots queue ${s.queue.length>=P.queue?'full':''}">${Array.from({length:P.queue},(_,j)=>`<i class="${j<s.queue.length?'on':''}"></i>`).join('')}</div>`;
    }else h+=`<p>${game.started?`點擊搬到這裡：重建 20 秒，剩 ${game.moves} 次。`:'點擊放站（開局前不扣搬站次數）。'}離港鐵近 → 班次密；離屋苑近 → 來的人多。</p>`;
    $('stopPanel').innerHTML=h;
  }
  function drawSide(){
    const st=game.stats(),w=game.waveInfo(),focusSelect=document.activeElement?.getAttribute('data-select');
    const onway=st.active-game.people.filter(p=>p.state==='home').length;
    $('score').textContent=st.delivered;$('score2').textContent=st.delivered;$('scoreBar').style.width=`${100*st.delivered/total}%`;
    $('cars').textContent=st.cars;$('onway').textContent=Math.max(0,onway);$('notOut').textContent=st.future+game.people.filter(p=>p.state==='home').length;
    $('clock').textContent=`${fmt(game.t)} / ${fmt(P.duration)}`;$('clockProg').style.width=`${100*game.t/P.duration}%`;$('moves').textContent=game.moves;
    $('wave').textContent=!game.started?`第 1 批：開局後 ${P.firstWave} 秒`:game.done?`未完成 ${game.missed} 人`:w.active>=0?`第 ${w.active+1}/8 批正在出門`:w.next>=0?`第 ${w.next+1}/8 批：${fmt(w.nextStart-game.t)} 後`:'8 批都出門了';
    $('start').textContent=game.done?'已結束':game.started?(playing?'❚❚ 暫停':'▶ 繼續'):'▶ 開始';
    $('start').disabled=game.done||(!game.started&&game.stops.some(s=>!s.cell));
    document.querySelectorAll('#speedSeg button').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.sp===speed)));
    $('mapHint').textContent=game.done?'本局已結束。':game.started?`${playing?'運行中':'已暫停'} · 選站再點 ＋，或直接拖動車站`:`放 ${letters[selected]} 站：停在 ＋ 上先看預覽，點擊放下`;
    $('stations').innerHTML=game.stops.map(s=>`<button class="station-button ${s.id===selected?'selected':''}" data-select="${s.id}" aria-pressed="${s.id===selected}"><b>${letters[s.id]}</b><small>${s.cell?`座 ${s.boarding.length}/${P.seats} · 隊 ${s.queue.length}/${P.queue}`:'未放置'}</small></button>`).join('');
    if(focusSelect)$('stations').querySelector(`[data-select="${focusSelect}"]`)?.focus({preventScroll:true});
    drawTide();drawStopPanel();
  }
  function render(){drawMap();drawSide();if(game.done&&!shown){shown=true;playing=false;showResult();drawSide();}}
  const reasons=['沒有夠近的站','站滿了','等太久'];
  function showResult(){
    const tier=game.delivered>=P.masterScore?3:game.delivered>=P.highScore?2:game.delivered>=P.target?1:0;
    $('result').classList.toggle('win',tier>0);
    $('resultTitle').textContent=['未過關','過關','高分 · 跟上了潮汐','潮汐大師'][tier];$('resultEn').textContent=['Try again','Cleared','High score','Tide master'][tier];
    $('resultScore').textContent=`送達 ${game.delivered} / ${total} · 開車 ${game.cars} · 未完成 ${game.missed}`;
    const cars=game.events.filter(e=>e.type==='car'),count=(o,r)=>cars.filter(e=>e.origin===o&&e.why===r).length;
    $('resultRows').innerHTML=D.origins.map((o,i)=>{const h=game.homeStats(i);return `<tr><td>${o.name}</td><td>${h.delivered}/${h.total}</td>${reasons.map(r=>`<td>${count(i,r)||''}</td>`).join('')}<td>${h.missed||''}</td></tr>`;}).join('');
    const by=reasons.map(r=>cars.filter(e=>e.why===r).length),top=by.indexOf(Math.max(...by));
    const moved=game.commands.length;
    $('resultHint').textContent=tier===3?'每一次漲潮都接住了。':
      tier===2?`已經跟上了潮汐（挪站 ${moved} 次）。潮汐大師要 ${P.masterScore}：試試開局就把兩座站留在南邊（四次高峰有三次在南邊），再讓一座站跟著高峰走。`:
      tier===1?(moved?`靠挪站過關了。高分 ${P.highScore} 要每次高峰前約 30 秒就把站挪到位。`:`開局擺得很準，一站不挪也過關了。高分 ${P.highScore} 光靠擺站到不了，要跟著潮汐表挪站。`):
      top===0?`開車的人裡，最多是因為「太遠」（${by[0]} 人）：站離屋苑每近一格，願意來的人多 20%。`:
      `開車的人裡，最多是因為「${reasons[top]}」（${by[top]} 人）：看潮汐表，在高峰前 30 秒把一座站搬到那個屋苑旁邊，分走一部分人。`;
    $('result').showModal();
  }
  function reset(){game=new Game();selected=0;playing=false;speed=1;shown=false;hover=null;seen=0;lastDelivered=0;warned=new Set();rang=new Set();
    $('fxl').innerHTML='';last=performance.now();note('每次重開都是同一份需求，方便比較不同站位。');render();}
  function pauseForInfo(){if(playing){playing=false;render();note('看規則時已暫停，關閉後點繼續。');}}

  /* ---------------------------------------------------------------- controls */
  $('stations').onclick=e=>{const el=e.target.closest('[data-select]');if(el){selected=+el.dataset.select;render();}};
  function svgPoint(e){const point=$('board').createSVGPoint();point.x=e.clientX;point.y=e.clientY;return point.matrixTransform($('board').getScreenCTM().inverse());}
  function pointCell(e){const p=svgPoint(e);return D.candidates.find(c=>{const [x,y]=xy(c);return Math.hypot(p.x-x,p.y-y)<22&&!game.stops.some(s=>same(s.cell,c));});}
  function pointStop(e){const p=svgPoint(e);return game.stops.find(s=>{if(!s.cell)return false;const [x,y]=xy(s.cell);return Math.hypot(p.x-x,p.y-y)<22;});}
  const board=$('board');
  board.onclick=e=>{if(drag?.moved)return;const stop=e.target.closest('[data-stop]'),cell=e.target.closest('[data-cell]');if(stop){selected=+stop.dataset.stop;render();}else{const c=cell?cell.dataset.cell.split(',').map(Number):pointCell(e);if(c)put(c);}};
  board.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();const s=e.target.closest('[data-stop]'),c=e.target.closest('[data-cell]');if(s){selected=+s.dataset.stop;render();}else if(c)put(c.dataset.cell.split(',').map(Number));}};
  board.onpointermove=e=>{if(drag&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>5)drag.moved=true;const c=pointCell(e)||null;if(JSON.stringify(c)!==JSON.stringify(hover)){hover=c;drawMap();drawTide();drawStopPanel();}};
  board.onpointerleave=()=>{if(!drag){hover=null;drawMap();drawTide();drawStopPanel();}};
  board.onpointerdown=e=>{pointerPressed=true;const el=e.target.closest('[data-stop]'),s=el?game.stops[+el.dataset.stop]:pointStop(e);if(s){selected=s.id;drag={x:e.clientX,y:e.clientY,moved:false};board.setPointerCapture(e.pointerId);render();}};
  board.onpointerup=()=>{pointerPressed=false;if(drag?.moved&&hover)put(hover);const moved=drag?.moved;drag=null;hover=null;if(moved)render();};
  document.addEventListener('pointerup',()=>{pointerPressed=false;requestAnimationFrame(()=>drawMap());});
  board.onpointercancel=()=>{pointerPressed=false;drag=null;hover=null;render();};
  board.addEventListener('focusin',e=>{if(restoringFocus)return;const c=e.target.closest('[data-cell]'),next=c?c.dataset.cell.split(',').map(Number):null;if(JSON.stringify(next)!==JSON.stringify(hover)){hover=next;drawMap();drawTide();drawStopPanel();}});
  $('start').onclick=()=>{if(!game.started&&!game.start())return;playing=!playing;last=performance.now();note(playing?'開始了。看右邊潮汐表：琥珀框是高峰，紅字是那座站可能擠爆。':'已暫停，可以慢慢看；搬站仍扣次數。');render();};
  $('speedSeg').onclick=e=>{const b=e.target.closest('[data-sp]');if(!b)return;speed=+b.dataset.sp;note(`速度 ${speed}×；1× 是完整 18 分鐘。`);drawSide();};
  $('reset').onclick=()=>{if(game.started&&!game.done&&!confirm('重開會清除本局進度，是否重開？'))return;reset();};
  $('help').onclick=$('srcBtn').onclick=()=>{pauseForInfo();$('info').showModal();};
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  $('again').onclick=()=>{$('result').close();reset();};
  $('download').onclick=()=>{const run={version:'feeder-v2.1-2026-10-06',seed:game.seed,parameters:P,demand:D.waves,stats:game.stats(),stops:game.stops.map(s=>({id:s.id,cell:s.cell,peak:s.peak,rejected:s.rejected})),moves:game.commands,events:game.events};const url=URL.createObjectURL(new Blob([JSON.stringify(run,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='TransitLab-接駁v2-本局紀錄.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  function setTheme(t){document.documentElement.setAttribute('data-theme',t);$('thPaper').setAttribute('aria-pressed',String(t==='light'));$('thInk').setAttribute('aria-pressed',String(t==='dark'));
    try{localStorage.setItem('tl-theme',t);}catch(e){}readTokens();render();}
  $('thPaper').onclick=()=>setTheme('light');$('thInk').onclick=()=>setTheme('dark');
  // board switch: the board is read at load, so switching reloads straight into the game (no cover)
  $('mapSeg').innerHTML=Object.entries(D.maps).map(([k,v])=>`<button data-map="${k}">${v}</button>`).join('');
  // titles follow the board's station
  const stationShort=D.station.zh.replace('港鐵','');
  $('titleEn').textContent=`Feeder to ${D.station.en.charAt(0)+D.station.en.slice(1).toLowerCase().replace(/ (\w)/g,(m,c)=>' '+c.toUpperCase())}`;
  $('titleTc').textContent=`接駁巴士 → ${D.station.zh}`;document.title=`TransitLab HK · 接駁巴士 · ${stationShort}`;
  if($('coverMode'))$('coverMode').textContent=`入門遊戲：接駁巴士 → ${D.station.zh}`;
  document.querySelectorAll('#mapSeg button').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.map===D.map));
    b.onclick=()=>{if(b.dataset.map===D.map)return;if(game.started&&!game.done&&!confirm('換地圖會清除本局進度，是否繼續？'))return;location.hash=`map=${b.dataset.map}&intro=0`;location.reload();};});
  // For the cover hand-off: every block of the board in screen pixels, so the cover's dots can land exactly on them.
  window.TL_BOARD={targets(){
    const m=board.getScreenCTM();if(!m)return null;
    const k=Math.hypot(m.a,m.b),at=(x,y)=>[m.a*x+m.c*y+m.e,m.b*x+m.d*y+m.f],items=[],isRoad=c=>D.roads.some(q=>same(q,c));
    for(const c of D.roads){const [x,y]=xy(c);items.push({p:at(x,y),w:20*k,h:20*k,color:C.road,kind:'road'});
      for(const n of [[c[0]+1,c[1]],[c[0],c[1]+1]])if(isRoad(n)){const [x2,y2]=xy(n),h=n[0]!==c[0];
        items.push({p:at((x+x2)/2,(y+y2)/2),w:(h?52:20)*k,h:(h?20:42)*k,color:C.road,kind:'road'});}}
    D.origins.forEach((o,i)=>{const [hx,hy]=houseAt(i);items.push({p:at(hx,hy+1),w:34*k,h:28*k,color:C.ink,kind:'house'});});
    const [mx,my]=xy(D.hub);items.push({p:at(mx,my),w:46*k,h:44*k,color:C.ink,kind:'hub'});
    return{items,hub:at(mx,my),k};
  }};
  $('source').textContent=D.source.geography+' '+D.source.demand;
  if(window.COVER)$('coverSource').textContent=`開場封面：組員「TransitLab 產品套件」的潮汐封面，運輸署幹道探測器逐小時車流（${window.COVER.tide.period||'24 個工作日'}）；圓點是全港 455 個分區的出行量。`;
  $('totalN').textContent=total;
  document.querySelectorAll('.hwBase').forEach(e=>e.textContent=P.headwayBase);document.querySelectorAll('.hwStep').forEach(e=>e.textContent=P.headwayStep);
  $('goal').innerHTML=`<b>${P.target}</b> 過關：開局三站要擺得很準，不然要靠中途挪站補救。<b>${P.highScore}</b> 高分：一定要跟著潮汐挪站。<b>${P.masterScore}</b> 潮汐大師：每一步都挪得準。`;
  $('tickMaster').style.left=`${100*P.masterScore/total}%`;$('tickMaster').dataset.label=`大師 ${P.masterScore}`;
  $('tickPass').style.left=`${100*P.target/total}%`;$('tickPass').dataset.label=`過關 ${P.target}`;
  $('tickHigh').style.left=`${100*P.highScore/total}%`;$('tickHigh').dataset.label=`高分 ${P.highScore}`;
  document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]')||document.getElementById('cover'))return;if(['1','2','3'].includes(e.key)){selected=+e.key-1;render();}else if(e.code==='Space'&&e.target===document.body){e.preventDefault();if(game.started&&!game.done){playing=!playing;last=performance.now();render();}}});
  document.addEventListener('visibilitychange',()=>{last=performance.now();if(document.hidden&&playing){playing=false;note('離開畫面時已自動暫停。');render();}});
  function frame(now){const dt=Math.min(.5,(now-last)/1000);last=now;
    if(playing){game.advance(dt*speed);feedback();
      if(now-lastDraw>40){drawMap();lastDraw=now;}
      if(now-lastSide>200){drawSide();lastSide=now;}
      if(game.done&&!shown)render();}
    requestAnimationFrame(frame);}
  // Test hook for screenshots and bots: #intro=0&layout=0-7-11&t=400&hover=3&sel=1&moves=125:1:11,365:1:6&theme=dark&fx=1
  const q=new URLSearchParams(location.hash.slice(1));
  let saved=null;try{saved=localStorage.getItem('tl-theme');}catch(e){}
  if(q.get('theme')||saved)setTheme(q.get('theme')||saved);
  if(q.get('layout')){q.get('layout').split('-').map(Number).forEach((c,id)=>game.place(id,D.candidates[c]));
    if(q.get('t')){game.start();const moves=(q.get('moves')||'').split(',').filter(Boolean).map(m=>m.split(':').map(Number)).sort((a,b)=>a[0]-b[0]);
      for(const [t,id,to] of moves)if(t<+q.get('t')){game.advance(t-game.t);game.place(id,D.candidates[to]);}game.advance(+q.get('t')-game.t);}}
  seen=q.get('fx')?Math.max(0,game.events.length-Number(q.get('fx'))):game.events.length;lastDelivered=game.delivered;
  for(const pk of D.peaks)if(game.t>=waveStart(pk.wave)-25){warned.add(pk.wave);if(game.t>=waveStart(pk.wave))rang.add(pk.wave);}
  if(q.get('sel'))selected=+q.get('sel');if(q.get('hover'))hover=D.candidates[+q.get('hover')];
  note('布局不限時。先放好三座接駁站，再按「開始」。');render();
  if(q.get('fxfreeze'))document.body.classList.add('fxfreeze');if(q.get('fx'))feedback();
  requestAnimationFrame(frame);
})();
