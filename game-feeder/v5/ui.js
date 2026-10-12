(()=>{
  'use strict';
  const {Game,D,P,route,dist,along,same,headwayAt}=Tide,$=id=>document.getElementById(id),I=window.I18N,t=(k,v)=>I.t(k,v);
  const letters=['A','B','C'];
  // Everything that depends on the board. setupMap() recomputes it when the hub swaps the level (TL_GAME.loadMap).
  let total=0,MX=20,MY=30,VBW=660,VBH=485;
  const name=i=>I.name(D.origins[i]),short=i=>I.short(D.origins[i]);
  // Colours come from the CSS tokens so the Paper / Ink switch repaints the board too.
  let C={};
  function readTokens(){const s=getComputedStyle(document.documentElement),v=n=>s.getPropertyValue('--s-'+n).trim();
    C={paper:v('paper'),panel:v('panel'),soft:v('soft'),raise:v('raise'),ink:v('ink'),ink2:v('ink2'),ink3:v('ink3'),line:v('line'),line2:v('line2'),
      accent:v('accent'),accent2:v('accent2'),warn:v('warn'),bad:v('bad'),info:v('info'),road:v('road'),roadEdge:v('road-edge')};}
  readTokens();
  let game=new Game(),selected=0,playing=false,speed=1,hover=null,hoverStop=-1,shown=false,drag=null,pointerPressed=false,restoringFocus=false;
  let last=performance.now(),lastDraw=0,lastSide=0,seen=0,lastDelivered=0,warned=new Set(),rang=new Set(),toastTimer=0;
  const xy=c=>[MX+c[0]*72,MY+c[1]*62];
  const fmt=n=>`${String(Math.floor(Math.max(0,n)/60)).padStart(2,'0')}:${String(Math.floor(Math.max(0,n)%60)).padStart(2,'0')}`;
  const pathStr=path=>path.map((c,i)=>(i?'L':'M')+xy(c).join(' ')).join(' ');
  const svg=(tag,attrs,content='')=>`<${tag} ${Object.entries(attrs).map(([k,v])=>`${k}="${v}"`).join(' ')}>${content}</${tag}>`;
  const text=(x,y,s,size=13,fill=C.ink,extra={})=>svg('text',{x,y,'font-size':size,fill,stroke:C.panel,'stroke-width':3.5,...extra},s);
  const rect=(x,y,w,h,fill,stroke=C.line2,extra={})=>svg('rect',{x,y,width:w,height:h,rx:4,fill,stroke,...extra});
  // v5.3: rounds have no fixed times; a round starts when the one before has settled (game.roundStart)
  const waveStart=w=>game.roundStart[w]??Infinity;
  // v4: rounds. The round running at time t, the next one to start, and its numbers as a short list.
  const roundAt=tt=>tt>=waveStart(game.round)?game.round:-1;
  const roundList=r=>D.waves[r].map((n,o)=>`${short(o)} ${n}`).join(' · ');
  const roundStat=r=>{let d=0,c=0;for(const p of game.people)if(p.wave===r){if(p.state==='delivered')d++;else if(p.state==='car')c++;}return{d,c};};
  const busyCut=()=>Math.ceil(.6*Math.max(...D.waves.flat()));
  // v5.2 · between rounds the game stops for INTER_MS (real time) and the map shows the coming round. Pausing in that
  // break turns it into an adjusting break with no time limit; resuming starts the round at once.
  const INTER_MS=5000;let inter=null;            // {r: coming round, end: performance.now() when it starts, adjust}
  const vizRound=()=>game.done?-1:!game.started?0:inter?inter.r:-1;
  const houseAt=i=>{const [x,y]=xy(D.origins[i].cell),[dx,dy]=D.origins[i].house||[0,38];return[x+dx,y+dy];};
  // name label: above a building that sits above its road, otherwise below it
  const labelY=i=>{const [,hy]=houseAt(i),dy=(D.origins[i].house||[0,38])[1];return dy<0?hy-22:hy+28;};
  function note(s){$('notice').textContent=s;}
  function toast(s,kind=''){const el=$('toast');el.className='toast on '+kind;el.textContent=s;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('on'),2600);}
  // the engine records why someone drove in Chinese; these are the keys for showing it
  const WHY={'沒有夠近的站':'why.far','站滿了':'why.full','等太久':'why.wait'},reasons=Object.keys(WHY);

  /* ------------------------------------------------------- board-dependent text */
  function setupMap(){
    total=D.waves.flat().reduce((a,b)=>a+b,0);[MX,MY]=D.margin||[20,30];
    // board size follows the map: grid cells plus room for the buildings and labels around them
    VBW=MX+(D.cols-1)*72+Math.max(MX,140);VBH=MY+(D.rows-1)*62+Math.max(96,MY);
    for(const id of ['board','fx'])$(id).setAttribute('viewBox',`0 0 ${VBW} ${VBH}`);
    texts();fitBoard();
  }
  // grow the board's frame to fit every name and label (an estate on the outer edge with a long name)
  function fitBoard(){
    if(typeof game==='undefined'||!game)return;
    drawMap();try{const bb=$('board').getBBox(),x0=Math.min(0,bb.x-10),y0=Math.min(0,bb.y-10),x1=Math.max(VBW,bb.x+bb.width+10),y1=Math.max(VBH,bb.y+bb.height+10);
      for(const id of ['board','fx'])$(id).setAttribute('viewBox',`${x0} ${y0} ${x1-x0} ${y1-y0}`);}catch(e){}
  }
  let gaugeLo=0;const gaugeAt=v=>Math.max(0,Math.min(100,100*(v-gaugeLo)/Math.max(1,total-gaugeLo)));
  function texts(){
    const own=D.map==='custom'&&D.title;
    $('titleEn').textContent=own||t('lvEn.'+D.map);
    $('titleTc').textContent=t('g.titleTc',{s:t('site.'+D.map)});$('titleTc').hidden=!$('titleTc').textContent;
    document.title=t('doc.game',{s:own||t('site.'+D.map)});
    $('levelSeg').querySelector('[data-level="custom"]').hidden=!D.levels.includes('custom');
    $('editLevel').textContent=t(D.map==='custom'?'g.edit':'g.editor');
    $('totalN').textContent=total;
    $('goal').innerHTML=t('g.goal',{pass:P.target,high:P.highScore,master:P.masterScore})+(D.tiersGuess?' '+t('g.tiersGuess'):'');
    gaugeLo=Math.max(0,Math.min(P.target-1,2*P.target-P.highScore-(total-P.masterScore)-10));
    for(const [id,v,k] of [['tickPass',P.target,'g.tickPass'],['tickHigh',P.highScore,'g.tickHigh'],['tickMaster',P.masterScore,'g.tickMaster']]){
      $(id).style.left=`${gaugeAt(v)}%`;$(id).dataset.label=t(k,{n:v});}
    $('scoreBar').parentElement.dataset.lo=gaugeLo?gaugeLo:'';
    const nums={base:P.headwayBase,step:P.headwayStep,seats:P.seats,queue:P.queue,moves:P.moves,cool:P.cool,n:D.waves.length};
    $('rule2').innerHTML=t('g.rule2',nums);$('rule3').innerHTML=t('g.rule3',nums);
    $('infoR3').innerHTML=t('i.r3',nums);$('infoR5').innerHTML=t('i.r5',nums);$('infoR6').innerHTML=t('i.r6',nums);
    $('movesMax').textContent=P.moves;
    document.querySelectorAll('#levelSeg [data-level]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.level===D.map)));
    $('source').textContent=t('src.'+D.map)+' '+t('src.demand');
    $('coverSource').textContent='';
  }

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
  function fxDepart(s){const st=game.stops[s];if(!st.cell)return;const [x,y]=xy(st.cell);
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
      else if(e.type==='full')full.add(e.stop);else if(e.type==='dispatch'&&e.load>0)departs.push(e.stop);
      else if(e.type==='move')setTimeout(()=>fxBuilt(e.stop),P.cool*1000/Math.max(1,speed));}
    seen=ev.length;
    if(delivered)fxArrive(delivered);
    for(const o in cars)fxLoss(+o,cars[o]);
    full.forEach(fxFull);departs.forEach(fxDepart);
    // A new round: a tide ripple at its busy estates and a toast with its numbers.
    const r=roundAt(game.t);
    if(r>=0&&!rang.has(r)&&!inter){rang.add(r);D.waves[r].forEach((n,o)=>{if(n>=busyCut())fxTide(o);});toast(t('t.round',{n:r+1,list:roundList(r)}),'tide');}
    if(lastDelivered<P.target&&game.delivered>=P.target)toast(t('t.pass',{n:P.target}));
    if(lastDelivered<P.highScore&&game.delivered>=P.highScore)toast(t('t.high',{n:P.highScore}));
    if(lastDelivered<P.masterScore&&game.delivered>=P.masterScore)toast(t('t.master',{n:P.masterScore}));
    lastDelivered=game.delivered;
  }

  /* ---------------------------------------------------------------- the board */
  function put(cell){
    const was=game.started;
    if(game.place(selected,cell)){
      hover=null;
      note(was?t(playing?'n.moved':'n.pausedMove',{s:letters[selected],cool:P.cool}):t('n.placed'));
      if(!was){fxBuilt(selected);const next=game.stops.find(s=>!s.cell);if(next)selected=next.id;}
      render();
    }else{const why=was&&game.moves<=0?t('n.noMoves',{max:P.moves}):t('n.taken');note(why);toast(why,'warn');}
  }
  // v5.4 · the board in layers, bottom to top: ground (water, roads) · glow (soft halos) · lines · arcs (thin rings) ·
  // things (＋, buildings, the centre, people, buses, stops) · labels (every word and number, last, on a paper halo).
  // Nothing written is ever covered. Motion is computed from the clock at each redraw: halos breathe, a stop that
  // overflows sends out slow ripples and a few drifting specks.
  const TAU=Math.PI*2;
  function arc(cx,cy,r,a0,a1){
    if(a1-a0>=.999)return `M${cx} ${cy-r}A${r} ${r} 0 1 1 ${cx-.01} ${cy-r}`;
    const pt=a=>[(cx+r*Math.sin(TAU*a)).toFixed(1),(cy-r*Math.cos(TAU*a)).toFixed(1)],[x0,y0]=pt(a0),[x1,y1]=pt(a1);
    return `M${x0} ${y0}A${r} ${r} 0 ${a1-a0>.5?1:0} 1 ${x1} ${y1}`;}
  // thin arcs, one after another (fractions of a turn) with a small gap; the rest of the circle a faint dotted track
  function arcs(cx,cy,r,parts,color,w=3,op=.85){
    let out=svg('circle',{cx,cy,r,fill:'none',stroke:C.ink3,'stroke-width':1.1,'stroke-opacity':.32,'stroke-dasharray':'1.5 4'}),a=0;
    const n=parts.filter(f=>f>.004).length,gap=n>1?.035:0;
    for(const f of parts){if(f<=.004)continue;const a1=Math.min(1,a+f);
      if(a1-a>gap+.012)out+=svg('path',{d:arc(cx,cy,r,a+gap/2,a1-gap/2),fill:'none',stroke:color,'stroke-width':w,'stroke-linecap':'round','stroke-opacity':op});
      a=a1;if(a>=1)break;}
    return out;}
  const halo=(x,y,r,id,a)=>svg('circle',{cx:x,cy:y,r:r.toFixed(1),fill:`url(#${id})`,'fill-opacity':Math.max(0,Math.min(1,a)).toFixed(3)});
  function defs(){
    const band=(id,c,mid)=>svg('radialGradient',{id},svg('stop',{offset:0,'stop-color':c,'stop-opacity':.05})+svg('stop',{offset:mid,'stop-color':c,'stop-opacity':.5})+svg('stop',{offset:1,'stop-color':c,'stop-opacity':0}));
    const lift=svg('filter',{id:'fLift',x:'-50%',y:'-50%',width:'200%',height:'200%'},svg('feDropShadow',{dx:0,dy:3,stdDeviation:3.2,'flood-color':C.ink,'flood-opacity':.32}));
    const head=svg('marker',{id:'mHead',viewBox:'0 0 10 10',refX:8,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'},svg('path',{d:'M0 0L10 5L0 10z',fill:C.accent}));
    return svg('defs',{},lift+head+band('hWarm',C.warn,.5)+band('hHot',C.bad,.55)+
      svg('radialGradient',{id:'hAura'},svg('stop',{offset:0,'stop-color':C.accent2,'stop-opacity':.32})+svg('stop',{offset:.7,'stop-color':C.accent2,'stop-opacity':.1})+svg('stop',{offset:1,'stop-color':C.accent2,'stop-opacity':0})));}
  // a stop under pressure: a warm haze that thickens as it fills (amber → coral), ripples and specks when it overflows
  function pressure(x,y,fill,over,seed,now){
    const wob=Math.sin(now/950+seed*1.7);let out='';
    if(fill>.35||over)out+=halo(x,y,30+16*Math.min(1,fill)+2*wob,over?'hHot':'hWarm',(over?.8:.2+.7*(fill-.35))*(1+.12*wob));
    if(over){
      for(let k=0;k<2;k++){const ph=(now/2000+k/2+seed*.13)%1;
        out+=svg('circle',{cx:x,cy:y,r:(28+28*ph).toFixed(1),fill:'none',stroke:C.bad,'stroke-width':1.2,'stroke-opacity':((1-ph)*.4).toFixed(3)});}
      for(let j=0;j<7;j++){const ph=(now/2600+j/7+seed*.31)%1,an=j/7*TAU+now/5200+seed,d=27+24*ph;
        out+=svg('circle',{cx:(x+Math.cos(an)*d).toFixed(1),cy:(y+Math.sin(an)*d-5*ph).toFixed(1),r:(1.9-.8*ph).toFixed(2),fill:C.bad,'fill-opacity':((1-ph)*.55).toFixed(3)});}}
    return out;}
  // where an estate's name and the "pull" hint go: never on top of each other (people at home: a badge on the building)
  function spots(i){
    const [hx,hy]=houseAt(i),[dx,dy]=D.origins[i].house||[0,38],right=hx<VBW*.72;
    if(dx)return{name:[hx+(dx>0?34:-34),hy+5,dx>0?'start':'end'],hint:[hx,hy+44,'middle']};
    return{name:[hx,dy<0?hy-36:hy+44,'middle'],hint:[right?hx+32:hx-32,hy+4,right?'start':'end']};
  }
  const pill=(x,y,s,color,anchor='middle',size=12)=>{const w=s.length*size*.62+14,x0=anchor==='start'?x-4:anchor==='end'?x-w+4:x-w/2;
    return rect(x0,y-size+1,w,size+8,C.panel,color,{rx:(size+8)/2,'stroke-width':1,'stroke-opacity':.55,'fill-opacity':.92})+text(anchor==='start'?x0+7:anchor==='end'?x0+w-7:x,y+2,s,size,color,{'text-anchor':anchor,'font-weight':600});};
  function drawMap(){
    if(pointerPressed&&!drag?.moved)return;           // keep the node under the pointer alive for the click
    const focused=document.activeElement,attrs=['data-cell','data-stop'];
    const focusAttr=attrs.find(a=>focused?.hasAttribute(a)),focusVal=focusAttr?focused.getAttribute(focusAttr):null;
    const vr=vizRound(),fc=vr>=0?game.forecastRound(vr,hover?selected:-1,hover):null,now=performance.now();
    let ground='',glow='',lines='',rings='',things='',labels='';
    // ground
    for(const [x1,y1,x2,y2] of D.water||[]){const [ax,ay]=xy([x1,y1]),[bx,by]=xy([x2,y2]);
      ground+=svg('rect',{x:ax-36,y:ay-28,width:bx-ax+72,height:by-ay+56,fill:C.info,'fill-opacity':.14,rx:10});}
    for(const pass of [[C.roadEdge,24],[C.road,20]])
      for(const c of D.roads)for(const n of [[c[0]+1,c[1]],[c[0],c[1]+1]])if(D.roads.some(q=>same(q,n)))ground+=svg('path',{d:pathStr([c,n]),stroke:pass[0],'stroke-width':pass[1],fill:'none','stroke-linecap':'square'});
    const onRoad=c=>D.roads.some(q=>same(q,c));
    for(const b of D.bridges||[]){const [x,y]=xy(b),v=onRoad([b[0],b[1]-1])||onRoad([b[0],b[1]+1]);   // rails either side of the road
      for(const d of [-14,14])ground+=svg('path',{d:v?`M${x+d} ${y-24}L${x+d} ${y+24}`:`M${x-30} ${y+d}L${x+30} ${y+d}`,stroke:C.ink2,'stroke-width':2.2});}
    // previewing a spot: the way its buses would take to the centre (only then; a stop's route is not drawn otherwise)
    if(hover)lines+=svg('path',{d:pathStr(route(hover,D.hub)),stroke:C.accent,'stroke-width':2.5,fill:'none','stroke-dasharray':'5 6',opacity:.6,'stroke-linecap':'round'});
    // the round preview (before the start and between rounds): who goes where, how full stops get, who is left out
    if(fc){
      fc.estates.forEach((e,i)=>{const [hx,hy]=houseAt(i);
        e.share.forEach((sh,sid)=>{const c=fc.stops[sid].cell;if(!c||sh<=0)return;
          const [x,y]=xy(c),dx=x-hx,dy=y-hy,len=Math.hypot(dx,dy)||1,bend=Math.min(30,len*.16)*(sid%2?1:-1);
          lines+=svg('path',{d:`M${hx} ${hy}Q${(hx+x)/2-dy/len*bend} ${(hy+y)/2+dx/len*bend} ${x} ${y}`,fill:'none',stroke:C.ink3,'stroke-width':(1+3.5*sh).toFixed(1),'stroke-opacity':.26,'stroke-linecap':'round'});});
        if(e.n){glow+=halo(hx,hy-2,40,'hAura',.35+.65*e.served/e.n+.08*Math.sin(now/1100+i));
          rings+=arcs(hx,hy-2,24,[e.served/e.n],C.accent,3,.9);}
        if(e.drives&&!hover&&fc.stops.some(st=>st.cell)){const sp=spots(i);labels+=pill(sp.hint[0],sp.hint[1],t('b.drives'),C.bad,sp.hint[2],11.5);}});
      fc.stops.forEach((st,sid)=>{if(!st.cell)return;const [x,y]=xy(st.cell),sum=st.from.reduce((a,b)=>a+b,0),fill=st.peak/st.room;
        glow+=pressure(x,y,fill,st.over>0,sid,now);
        rings+=arcs(x,y,25,sum?st.from.map(n=>n/sum*fill):[],st.over>0?C.bad:C.warn,3,.8);});
    }
    // the spot under the pointer, at any time: what it would pull from each estate, by blocks (the core rule)
    if(hover)D.origins.forEach((o,i)=>{const d=dist(o.cell,hover),w=Tide.shareAt(i,hover),[hx,hy]=houseAt(i),[x,y]=xy(hover),sp=spots(i);
      if(w>0){lines+=svg('path',{d:`M${hx} ${hy}L${x} ${y}`,stroke:C.accent,'stroke-width':1.6,'stroke-dasharray':'3 5',opacity:.55,'stroke-linecap':'round'});
        labels+=pill(sp.hint[0],sp.hint[1],t('b.pull',{p:Math.round(w*100),n:d}),C.accent,sp.hint[2]);}});   // spots it cannot reach: why, in the stop panel
    // estates: building, name, people deciding at home
    D.origins.forEach((o,i)=>{const [hx,hy]=houseAt(i),[cx,cy]=xy(o.cell),sp=spots(i),h=game.homeStats(i);
      things+=svg('path',{d:`M${cx} ${cy}L${hx} ${hy}`,stroke:C.ink3,'stroke-width':1.5,'stroke-dasharray':'2 3'});
      things+=rect(hx-17,hy-10,12,22,C.ink2,C.ink,{rx:1})+rect(hx-4,hy-16,10,28,C.ink,C.ink,{rx:1})+rect(hx+7,hy-6,10,18,C.ink2,C.ink,{rx:1});
      for(let k=0;k<3;k++)things+=svg('rect',{x:hx-1+(k%2)*3,y:hy-12+k*7,width:2,height:3,fill:C.paper});
      labels+=text(sp.name[0],sp.name[1],name(i),14,C.ink,{'text-anchor':sp.name[2],'font-weight':600});
      // people at home still deciding: a small badge on the building's lower right corner (clear of roads and stops)
      const bx=hx+((o.house||[0,38])[0]<0?-19:19);   // the corner away from the road
      if(h.home&&!fc)labels+=svg('circle',{cx:bx,cy:hy+11,r:h.home>9?10:8.5,fill:C.panel,stroke:C.warn,'stroke-width':1.3})+text(bx,hy+15,`${h.home}`,11,C.warn,{'text-anchor':'middle','font-weight':600,'font-family':'Geist Mono,monospace','stroke-width':0});});
    // the town centre
    const [mx,my]=xy(D.hub);
    things+=rect(mx-23,my-22,46,44,C.ink,C.ink,{rx:6})+svg('rect',{x:mx-23,y:my+15,width:46,height:7,fill:C.accent,rx:2});
    things+=svg('text',{x:mx,y:my+8,'font-size':I.lang==='en'?25:21,fill:C.paper,'text-anchor':'middle','font-family':I.lang==='en'?'Bodoni Moda,Georgia,serif':'Noto Serif TC,serif','font-weight':600},t('b.hubMark'));
    const hl=D.hubLabel==='left',lx=hl?mx-34:mx+34,la=hl?'end':'start';   // its label on the open side
    labels+=text(lx,my-8,I.station(D.station),15,C.ink,{'font-weight':600,'text-anchor':la});
    labels+=text(lx,my+7,I.lang==='en'?t('b.mtr'):D.station.en,9,C.ink3,{'letter-spacing':'.16em','font-family':'Geist Mono,monospace','text-anchor':la});
    labels+=text(lx,my+25,t('b.delivered',{n:game.delivered}),13,C.accent,{'font-weight':600,'font-family':'Geist Mono,monospace','text-anchor':la});
    // free spots
    for(const c of D.candidates){
      if(game.stops.some(s=>same(s.cell,c)))continue;
      const [x,y]=xy(c),on=hover&&same(hover,c);
      things+=svg('g',{class:'candidate','data-cell':c.join(','),role:'button',tabindex:0,'aria-label':t('b.candAria',{c:c[0]+1,r:c[1]+1}),opacity:canMove()?1:.3},
        svg('circle',{cx:x,cy:y,r:on?13:10,fill:on?C.accent:C.panel,stroke:on?C.accent:C.ink3,'stroke-width':1.2,'stroke-opacity':on?1:.7})+svg('text',{x,y:y+5,'font-size':on?16:14,fill:on?C.paper:C.ink3,'text-anchor':'middle'},'＋'));
    }
    // people walking, buses
    for(const p of game.people)if(['walk','return'].includes(p.state)){
      const [x,y]=xy(game.pos(p)),ox=(p.id%3-1)*5,oy=(p.id%2?1:-1)*4;
      things+=svg('circle',{cx:x+ox,cy:y+oy,r:3.4,fill:p.state==='walk'?C.info:C.warn,stroke:C.panel,'stroke-width':1});
    }
    for(const b of game.trips.filter(b=>!b.done)){
      const [x,y]=xy(along(b.path,game.t-b.since,P.busStep));
      lines+=svg('path',{d:pathStr(b.path),fill:'none',stroke:C.accent,'stroke-width':2,opacity:.18});
      things+=rect(x-19,y-11,38,22,C.accent,C.accent,{rx:11})+svg('text',{x,y:y+5,'font-size':12.5,fill:C.paper,'text-anchor':'middle','font-weight':600,'font-family':'Geist Mono,monospace'},`${letters[b.stop]}·${b.load.length}`);
    }
    const moving=game.stops[selected];
    if(hover){const [gx,gy]=xy(hover);
      if(moving.cell){const [sx,sy]=xy(moving.cell),dx=gx-sx,dy=gy-sy,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len;
        lines+=svg('path',{d:`M${(sx+ux*24).toFixed(1)} ${(sy+uy*24).toFixed(1)}Q${((sx+gx)/2-uy*26).toFixed(1)} ${((sy+gy)/2+ux*26).toFixed(1)} ${(gx-ux*22).toFixed(1)} ${(gy-uy*22).toFixed(1)}`,fill:'none',stroke:C.accent,'stroke-width':2,'stroke-dasharray':'6 5','marker-end':'url(#mHead)',opacity:.85});}
      things+=rect(gx-16,gy-15,32,30,C.panel,C.accent,{'stroke-width':1.6,'stroke-dasharray':'4 3',rx:7,'fill-opacity':.85})+svg('text',{x:gx,y:gy+7,'font-size':19,fill:C.accent,'text-anchor':'middle','font-weight':600,'font-family':'Bodoni Moda,Georgia,serif',opacity:.75},letters[selected]);}
    // stops: the box, and while the game runs its seats, queue and next bus (a full stop: the same warm haze, breathing)
    for(const s of game.stops){if(!s.cell)continue;
      const [x,y]=xy(s.cell),build=Math.max(0,s.ready-game.t),sel=selected===s.id,full=s.queue.length>=P.queue&&s.boarding.length>=P.seats;
      if(full&&!fc){glow+=pressure(x,y,1,true,s.id,now);labels+=text(x+21,y-14,t('b.fullShort'),12,C.bad,{'font-weight':600});}
      if(sel){glow+=halo(x,y,34,'hAura',.9+.1*Math.sin(now/700));
        rings+=svg('circle',{cx:x,cy:y,r:31,fill:'none',stroke:C.accent2,'stroke-width':2,'stroke-dasharray':'6 5','stroke-dashoffset':(-now/60%22).toFixed(1),'stroke-opacity':.9,'stroke-linecap':'round'});}
      else if(hoverStop===s.id)rings+=svg('circle',{cx:x,cy:y,r:27,fill:'none',stroke:C.ink3,'stroke-width':1.5,'stroke-opacity':.5});
      let content=rect(x-16,y-15,32,30,build?C.panel:C.accent,sel?C.ink:C.accent,{'stroke-width':sel?2.2:1.2,'stroke-dasharray':build?'4 3':'none',rx:7,...(sel?{filter:'url(#fLift)'}:{})});
      content+=svg('text',{x,y:y+7,'font-size':19,fill:build?C.accent:C.paper,'text-anchor':'middle','font-weight':600,'font-family':'Bodoni Moda,Georgia,serif'},letters[s.id]);
      if(!fc){
        const sw=Math.min(8,64/Math.max(1,P.seats)),qw=Math.min(7,60/Math.max(1,P.queue));
        for(let j=0;j<P.seats;j++)content+=svg('rect',{x:x-P.seats*sw/2+j*sw,y:y-37,width:sw-1.6,height:7,rx:1.5,fill:j<s.boarding.length?C.accent:C.panel,stroke:C.accent,'stroke-width':1,'stroke-opacity':.7});
        for(let j=0;j<P.queue;j++)content+=svg('rect',{x:x-P.queue*qw/2+j*qw,y:y-26,width:qw-1.6,height:6,rx:1,fill:j<s.queue.length?(full?C.bad:C.warn):C.panel,stroke:full?C.bad:C.warn,'stroke-width':1,'stroke-opacity':.6});
        // under the stop if that is free; else beside it (right, then left); else above the seats
        const near=(px,py,w,h)=>D.origins.some((o,i)=>{const [hx,hy]=houseAt(i);return Math.abs(hx-px)<w&&Math.abs(hy-py)<h;})||
          game.stops.some(q=>q.id!==s.id&&q.cell&&(()=>{const [qx,qy]=xy(q.cell);return Math.abs(qx-px)<w&&Math.abs(qy-py)<h;})());
        const cap=!near(x,y+40,40,24)?[x,y+31,'middle']:!near(x+60,y,44,26)?[x+22,y+5,'start']:!near(x-60,y,44,26)?[x-22,y+5,'end']:[x,y-44,'middle'];
        labels+=text(cap[0],cap[1],game.done?'':build?t('b.rebuild',{n:Math.ceil(build)}):game.started?t('b.depart',{t:fmt(game.eta(s))}):t('b.headway',{n:game.headway(s)}),11.5,C.accent,{'text-anchor':cap[2],'font-weight':600,'font-family':'Geist Mono,monospace'});}
      things+=svg('g',{class:'stop','data-stop':s.id,role:'button',tabindex:0,'aria-label':t('b.stopAria',{s:letters[s.id],a:s.boarding.length,b:P.seats,c:s.queue.length,d:P.queue})},content);
    }
    $('board').innerHTML=defs()+ground+glow+lines+rings+things+labels;
    if(focusAttr){restoringFocus=true;try{$('board').querySelector(`[${focusAttr}="${focusVal}"]`)?.focus({preventScroll:true});}finally{restoringFocus=false;}}
  }

  /* ------------------------------------------------------------ side columns */
  function drawTide(){
    const cur=game.started&&!inter?roundAt(game.t):-1,vr=vizRound(),cut=busyCut();
    let h=`<thead><tr><th>${t('tt.batch')}</th>${D.origins.map((o,i)=>`<th>${short(i)}</th>`).join('')}</tr></thead><tbody>`;
    D.waves.forEach((wave,wi)=>{
      const past=game.started&&wi<game.round,start=game.roundStart[wi];
      h+=`<tr class="${wi===cur?'now':''} ${wi===vr?'next':''} ${past?'past':''}"><td>${t('tt.round',{n:wi+1})}<small>${game.started&&start!==undefined?fmt(start):''}</small></td>`;
      wave.forEach(n=>{h+=`<td class="${n>=cut?'peak':''}"><b>${n}</b></td>`;});
      h+='</tr>';
    });
    $('tide').innerHTML=h+'</tbody>';
  }
  function drawStopPanel(){
    const s=game.stops[selected],cell=hover||s.cell;
    let h=`<h3><span>${t('sp.title',{s:letters[selected]})}${hover?t('sp.preview'):''}</span><span class="lbl">Stop ${letters[selected]}</span></h3>`;
    if(!cell){$('stopPanel').innerHTML=h+`<p>${t('sp.empty')}</p>`;return;}
    const steps=dist(cell,D.hub),hw=headwayAt(cell),vr=vizRound(),fc=game.forecastRound(Math.max(0,vr),hover?selected:-1,hover),st=fc.stops[selected];
    const served=fc.estates.filter(e=>e.share[selected]>0).map(e=>t('sp.served',{name:name(e.origin),n:e.steps[selected],p:Math.round(e.pull[selected]*100),s:Math.round(e.share[selected]*100)})).join('<br>')||t('sp.nobody');
    const beyond=D.origins.map((o,i)=>i).filter(i=>{const d=dist(D.origins[i].cell,cell);return d>=Tide.toMTR[i]&&Tide.willing(d)>0;}).map(name);
    h+=`<div class="r"><span>${t('sp.toMTR')}</span><span>${t('sp.toMTRv',{n:steps,hw})}</span></div><div class="r"><span>${t('sp.who')}</span><span>${served}</span></div>`;
    const far=D.origins.map((o,i)=>i).filter(i=>!Tide.willing(dist(D.origins[i].cell,cell))).map(name);
    if(beyond.length||far.length)h+=`<div class="r"><span>${t('sp.not')}</span><span>${[beyond.length?t('sp.beyond',{list:beyond.join(t('sep'))}):'',far.length?t('sp.far',{list:far.join(t('sep'))}):''].filter(Boolean).join('<br>')}</span></div>`;
    if(vr>=0)h+=`<div class="r"><span>${t('sp.loadR',{n:vr+1})}</span><span>${t('sp.loadV',{n:st.load,p:st.peak,room:st.room})}</span></div><div class="r"><span>${t('sp.overflow')}</span><span class="${st.over?'badtxt':''}">${st.over?t('sp.overN',{n:st.over}):t('sp.noOver')}</span></div>`;
    if(!hover){
      const build=Math.max(0,s.ready-game.t);
      h+=`<div class="r"><span>${t('sp.next')}</span><span class="big">${game.done?'—':!game.started?t('sp.opening',{n:hw}):build?t('b.rebuild',{n:Math.ceil(build)}):fmt(game.eta(s))}</span></div>`;
      h+=`<div class="r"><span>${t('sp.seats',{a:s.boarding.length,b:P.seats})}</span></div><div class="slots">${Array.from({length:P.seats},(_,j)=>`<i class="${j<s.boarding.length?'on':''}"></i>`).join('')}</div>`;
      h+=`<div class="r"><span>${t('sp.queue',{a:s.queue.length,b:P.queue})}</span><span>${s.rejected?t('sp.rejected',{n:s.rejected}):''}</span></div><div class="slots queue ${s.queue.length>=P.queue&&s.boarding.length>=P.seats?'full':''}">${Array.from({length:P.queue},(_,j)=>`<i class="${j<s.queue.length?'on':''}"></i>`).join('')}</div>`;
    }else h+=`<p>${game.started?t('sp.hoverMove',{n:game.moves,cool:P.cool}):t('sp.hoverPlace')}${t('sp.tip')}</p>`;
    $('stopPanel').innerHTML=h;
  }
  function drawSide(){
    const st=game.stats(),w=game.waveInfo(),focusSelect=document.activeElement?.getAttribute('data-select');
    const athome=game.people.filter(p=>p.state==='home').length,onway=st.active-athome;
    $('score').textContent=st.delivered;$('score2').textContent=st.delivered;$('scoreBar').style.width=`${gaugeAt(st.delivered)}%`;
    $('cars').textContent=st.cars;$('onway').textContent=Math.max(0,onway);$('notOut').textContent=st.future+athome;
    const m=D.waves.length,r=roundAt(game.t);
    $('clock').textContent=fmt(game.t);$('clockProg').style.width=`${game.done?100:Math.min(100,100*(game.round+(r>=0?.5:0))/m)}%`;$('moves').textContent=game.moves;
    $('wave').textContent=!game.started?t('w.first',{n:P.firstWave}):game.done?t('w.missed',{n:game.missed}):inter?t('w.break',{n:inter.r+1,m}):r>=0?t('w.active',{n:r+1,m,...roundStat(r)}):t('w.first',{n:Math.ceil(P.firstWave-game.t)});
    $('undoMoves').hidden=!(snap&&!playing&&!game.done&&game.commands.length>snap.commands.length);
    $('start').textContent=game.done?t('g.over'):game.started?(playing?t('g.pause'):t('g.resume')):t('g.start');
    $('start').disabled=game.done||(!game.started&&game.stops.some(s=>!s.cell));
    document.querySelectorAll('#speedSeg button').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.sp===speed)));
    $('mapHint').textContent=game.done?t('h.done'):!game.started?t('h.place',{s:letters[selected]}):game.moves<=0?t('h.noMoves'):t('h.move',{s:letters[selected],n:game.moves});
    $('mapHint').classList.toggle('bad',game.started&&!game.done&&game.moves<=0);$('moves').parentElement.classList.toggle('none',game.started&&game.moves<=0);
    $('stations').innerHTML=game.stops.map(s=>`<button class="station-button ${s.id===selected?'selected':''}" data-select="${s.id}" aria-pressed="${s.id===selected}"><b>${letters[s.id]}</b><small>${s.cell?t('st.btn',{a:s.boarding.length,b:P.seats,c:s.queue.length,d:P.queue}):t('st.none')}</small></button>`).join('');
    if(focusSelect)$('stations').querySelector(`[data-select="${focusSelect}"]`)?.focus({preventScroll:true});
    drawTide();drawStopPanel();
  }
  // The break before each round: 5 real seconds (the game stands still), or as long as you like once paused in it.
  function drawCountdown(){
    const el=$('cdown');
    if(!inter||game.done){el.classList.remove('on');return;}
    const still=inter.adjust||!playing;
    el.classList.add('on');el.classList.toggle('paused',still);
    $('cdNum').textContent=still?'❚❚':Math.max(1,Math.ceil((inter.end-performance.now())/1000-1e-6));
    $('cdText').textContent=t('cd.round',{n:inter.r+1});   // the numbers are in the tide table, its row lit
    $('cdHint').textContent=still?t('cd.adjust'):t('cd.hint');
  }
  function render(){drawMap();drawSide();drawCountdown();if(game.done&&!shown){shown=true;playing=false;showResult();drawSide();}}
  const tierOf=n=>n>=P.masterScore?3:n>=P.highScore?2:n>=P.target?1:0;
  function fillResult(){
    const tier=tierOf(game.delivered);
    $('result').classList.toggle('win',tier>0);
    $('resultTitle').textContent=t('r.t'+tier);$('resultEn').textContent=['Try again','Cleared','High score','Tide master'][tier];
    $('resultScore').textContent=t('r.score',{d:game.delivered,t:total,c:game.cars,m:game.missed});
    $('resultHead').innerHTML=t('r.head');
    const cars=game.events.filter(e=>e.type==='car'),count=(o,r)=>cars.filter(e=>e.origin===o&&e.why===r).length;
    $('resultRows').innerHTML=D.origins.map((o,i)=>{const h=game.homeStats(i);return `<tr><td>${name(i)}</td><td>${h.delivered}/${h.total}</td>${reasons.map(r=>`<td>${count(i,r)||''}</td>`).join('')}<td>${h.missed||''}</td></tr>`;}).join('');
    const by=reasons.map(r=>cars.filter(e=>e.why===r).length),top=by.indexOf(Math.max(...by));
    const moved=game.commands.length;
    $('resultHint').textContent=tier===3?t('r.h3'):tier===2?t('r.h2',{m:moved,n:P.masterScore}):
      tier===1?(moved?t('r.h1moved',{n:P.highScore}):t('r.h1static',{n:P.highScore})):
      top===0?t('r.h0far',{n:by[0]}):t('r.h0other',{why:t(WHY[reasons[top]]),n:by[top]});
  }
  function showResult(){
    // best score per level, shown on the hub map (this browser only)
    try{const k='tl-best-'+D.map;if(game.delivered>(+localStorage.getItem(k)||0))localStorage.setItem(k,game.delivered);}catch(e){}
    fillResult();$('result').showModal();
    // For a site that hosts the game (accounts, leaderboard): one event per finished round. The game itself sends
    // nothing anywhere. seed + opening + moves let a server replay the round and check the score (verify_result.js).
    window.dispatchEvent(new CustomEvent('tl:result',{detail:{game:'feeder',version:'5.0-trial',map:D.map,
      score:game.delivered,total,tier:tierOf(game.delivered),tiers:[P.target,P.highScore,P.masterScore],cars:game.cars,missed:game.missed,
      seed:game.seed,opening:game.opening,moves:game.commands.map(c=>({time:c.time,id:c.id,cell:c.cell.slice()})),lang:I.lang}}));
  }
  let snap=null;
  function setPlaying(v,msg){
    if(v===playing)return;playing=v;last=performance.now();
    if(inter){if(v)inter=null;else inter.adjust=true;}
    snap=!v&&game.started&&!game.done?structuredClone({...game}):null;
    if(msg)note(msg);render();}
  function undoMoves(){
    if(!snap)return;game=Object.assign(Object.create(Game.prototype),structuredClone(snap));
    seen=game.events.length;lastDelivered=game.delivered;hover=null;note(t('n.undone'));render();}
  function reset(msg){snap=null;inter=null;game=new Game();selected=0;playing=false;speed=1;shown=false;hover=null;seen=0;lastDelivered=0;warned=new Set();rang=new Set();
    $('fxl').innerHTML='';last=performance.now();note(msg||t('n.reset'));render();}
  function pauseForInfo(){if(playing)setPlaying(false,t('n.info'));}

  /* ---------------------------------------------------------------- controls */
  $('stations').onclick=e=>{const el=e.target.closest('[data-select]');if(el){selected=+el.dataset.select;render();}};
  function svgPoint(e){const point=$('board').createSVGPoint();point.x=e.clientX;point.y=e.clientY;return point.matrixTransform($('board').getScreenCTM().inverse());}
  function pointCell(e){const p=svgPoint(e);return D.candidates.find(c=>{const [x,y]=xy(c);return Math.hypot(p.x-x,p.y-y)<22&&!game.stops.some(s=>same(s.cell,c));});}
  function pointStop(e){const p=svgPoint(e);return game.stops.find(s=>{if(!s.cell)return false;const [x,y]=xy(s.cell);return Math.hypot(p.x-x,p.y-y)<22;});}
  const board=$('board');
  board.onclick=e=>{if(drag?.moved)return;const stop=e.target.closest('[data-stop]'),cell=e.target.closest('[data-cell]');if(stop){selected=+stop.dataset.stop;render();}else{const c=cell?cell.dataset.cell.split(',').map(Number):pointCell(e);if(c)put(c);}};
  board.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();const s=e.target.closest('[data-stop]'),c=e.target.closest('[data-cell]');if(s){selected=+s.dataset.stop;render();}else if(c)put(c.dataset.cell.split(',').map(Number));}};
  const canMove=()=>!game.done&&(!game.started||game.moves>0);
  board.onpointermove=e=>{if(drag&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>5)drag.moved=true;const c=canMove()?pointCell(e)||null:null;
    const hs=pointStop(e)?.id??-1;if(hs!==hoverStop){hoverStop=hs;if(!(JSON.stringify(c)!==JSON.stringify(hover)))drawMap();}if(JSON.stringify(c)!==JSON.stringify(hover)){hover=c;drawMap();drawTide();drawStopPanel();}};
  board.onpointerleave=()=>{hoverStop=-1;if(!drag){hover=null;drawMap();drawTide();drawStopPanel();}};
  board.onpointerdown=e=>{pointerPressed=true;const el=e.target.closest('[data-stop]'),s=el?game.stops[+el.dataset.stop]:pointStop(e);if(s){selected=s.id;drag={x:e.clientX,y:e.clientY,moved:false};board.setPointerCapture(e.pointerId);render();}};
  board.onpointerup=()=>{pointerPressed=false;if(drag?.moved&&hover)put(hover);const moved=drag?.moved;drag=null;hover=null;if(moved)render();};
  document.addEventListener('pointerup',()=>{pointerPressed=false;requestAnimationFrame(()=>drawMap());});
  board.onpointercancel=()=>{pointerPressed=false;drag=null;hover=null;render();};
  board.addEventListener('focusin',e=>{if(restoringFocus)return;const c=e.target.closest('[data-cell]'),next=c?c.dataset.cell.split(',').map(Number):null;if(JSON.stringify(next)!==JSON.stringify(hover)){hover=next;drawMap();drawTide();drawStopPanel();}});
  $('start').onclick=()=>{if(!game.started&&!game.start())return;setPlaying(!playing,playing?t('n.pause'):t('n.start'));};
  $('undoMoves').onclick=undoMoves;
  $('speedSeg').onclick=e=>{const b=e.target.closest('[data-sp]');if(!b)return;speed=+b.dataset.sp;note(t('n.speed',{n:speed}));drawSide();};
  $('reset').onclick=()=>{if(game.started&&!game.done&&!confirm(t('c.reset')))return;reset();};
  $('help').onclick=$('srcBtn').onclick=()=>{pauseForInfo();$('info').showModal();};
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  $('again').onclick=()=>{$('result').close();reset();};
  function loadLevel(map){
    if(map===D.map){if(game.done)reset(t('n.layout'));return true;}
    if(game.started&&!game.done&&!confirm(t('c.map')))return false;
    if(!D.select(map))return false;
    Tide.reset();setupMap();reset(t('n.layout'));return true;}
  $('levelSeg').onclick=e=>{const b=e.target.closest('[data-level]');if(b)loadLevel(b.dataset.level);};
  // the level editor sits next to this page (source pages or the bundled single files)
  const page=decodeURIComponent(location.pathname.split('/').pop()||'');
  $('editLevel').href=page==='开始游戏.html'?'关卡编辑器.html':'editor.html';
  $('download').onclick=()=>{const run={version:'feeder-v5-trial-2026-10-11',map:D.map,seed:game.seed,parameters:P,demand:D.waves,stats:game.stats(),stops:game.stops.map(s=>({id:s.id,cell:s.cell,peak:s.peak,rejected:s.rejected})),moves:game.commands,events:game.events};const url=URL.createObjectURL(new Blob([JSON.stringify(run,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`TransitLab-feeder-${D.map}-run.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  function setTheme(th){document.documentElement.setAttribute('data-theme',th);$('thPaper').setAttribute('aria-pressed',String(th==='light'));$('thInk').setAttribute('aria-pressed',String(th==='dark'));
    try{localStorage.setItem('tl-theme',th);}catch(e){}readTokens();render();}
  $('thPaper').onclick=()=>setTheme('light');$('thInk').onclick=()=>setTheme('dark');
  window.addEventListener('tl:lang',()=>{texts();render();if($('result').open)fillResult();});
  window.TL_GAME={loadMap:loadLevel,pause(){if(playing)setPlaying(false);},map:()=>D.map,inProgress:()=>game.started&&!game.done,texts,
    state:()=>({t:game.t,round:game.round,playing,inter:inter&&{...inter},done:game.done,acc:game.acc,speed})};
  // For the hand-off: every block of the board in screen pixels, so the hub's dots can land exactly on them.
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
  document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]')||document.body.classList.contains('inhub'))return;if(['1','2','3'].includes(e.key)){selected=+e.key-1;render();}else if(e.code==='Space'&&!e.target.closest?.('button,input,select,textarea')){e.preventDefault();if(game.started&&!game.done)setPlaying(!playing,playing?t('n.pause'):t('n.start'));}});
  document.addEventListener('visibilitychange',()=>{last=performance.now();if(document.hidden&&playing)setPlaying(false,t('n.hidden'));});
  function frame(now){const dt=Math.min(.5,(now-last)/1000);last=now;
    if(playing){
      if(inter){if(now>=inter.end){inter=null;render();}}
      else{const r0=game.round;game.advance(dt*speed,{stopAtRound:true});
        if(game.round!==r0&&!game.done){inter={r:game.round,end:now+INTER_MS,adjust:false};render();}}
      feedback();drawCountdown();
      if(now-lastDraw>40){drawMap();lastDraw=now;}
      if(now-lastSide>200){drawSide();lastSide=now;}
      if(game.done&&!shown)render();}
    else if(!game.done&&now-lastDraw>50&&!pointerPressed){drawMap();lastDraw=now;}
    requestAnimationFrame(frame);}
  // Test hook for screenshots and bots: #intro=0&map=yuenlong&layout=0-7-11&t=400&hover=3&sel=1&moves=125:1:11,365:1:6&theme=dark&fx=1&lang=en
  const q=new URLSearchParams(location.hash.slice(1));
  let saved=null;try{saved=localStorage.getItem('tl-theme');}catch(e){}
  setupMap();
  if(q.get('theme')||saved)setTheme(q.get('theme')||saved);
  if(q.get('layout')){q.get('layout').split('-').map(Number).forEach((c,id)=>game.place(id,D.candidates[c]));
    if(q.get('t')){game.start();const moves=(q.get('moves')||'').split(',').filter(Boolean).map(m=>m.split(':').map(Number)).sort((a,b)=>a[0]-b[0]);
      for(const [tm,id,to] of moves)if(tm<+q.get('t')){game.advance(tm-game.t);game.place(id,D.candidates[to]);}game.advance(+q.get('t')-game.t);}}
  seen=q.get('fx')?Math.max(0,game.events.length-Number(q.get('fx'))):game.events.length;lastDelivered=game.delivered;
  for(let k=0;k<=game.round;k++)if(game.t>=waveStart(k))rang.add(k);
  if(q.get('paused')&&game.started)snap=structuredClone({...game});
  if(q.get('sel'))selected=+q.get('sel');if(q.get('hover'))hover=D.candidates[+q.get('hover')];
  note(t('n.layout'));render();
  if(q.get('fxfreeze'))document.body.classList.add('fxfreeze');if(q.get('fx'))feedback();
  requestAnimationFrame(frame);
})();
