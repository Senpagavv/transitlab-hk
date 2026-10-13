(()=>{
  'use strict';
  // v7 · mode 2 «the metro», static version — the page. Draw one line on the grid, put stations on it, and every
  // desire line shows at once how many people leave the car. Nothing runs in time: the score is the plan.
  const {Plan,D,P,evaluate,walk,same}=Metro,$=id=>document.getElementById(id),I=window.I18N,t=(k,v)=>I.t(k,v);
  const CS=60,MX=60,MY=70;   // a square cell
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
  let plan=new Plan(),tool='draw',hover=null,sel=-1,drag=false,history=[],toastTimer=0;
  const VBW=MX*2+(D.cols-1)*CS,VBH=MY*2+(D.rows-1)*CS;
  function snapshot(){history.push(plan.copy());if(history.length>200)history.shift();}
  function toast(s,kind=''){let el=$('toast');if(!el){el=document.createElement('div');el.id='toast';el.className='toast';$('board').parentElement.appendChild(el);}
    el.className='toast on '+kind;el.textContent=s;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('on'),2400);}
  // a desire line drawn as a gentle curve from the estate to the destination (alternating sides so they don't sit on each other)
  function curve(a,b,j){const [x1,y1]=xy(a),[x2,y2]=xy(b),dx=x2-x1,dy=y2-y1,L=Math.hypot(dx,dy)||1,bend=Math.min(60,L*.12)*(j%2?1:-1);
    const cx=(x1+x2)/2-dy/L*bend,cy=(y1+y2)/2+dx/L*bend;return{d:`M${x1} ${y1}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2} ${y2}`,mid:[(x1+2*cx+x2)/4,(y1+2*cy+y2)/4]};}

  /* -------------------------------------------------------------- the board */
  function draw(now=performance.now()){
    const ev=plan.evaluate();
    let ground='',desire='',lines='',things='',labels='';
    // the chessboard: every cell a soft square; in the drawing tool, the cells the line can grow into are marked
    for(let x=0;x<D.cols;x++)for(let y=0;y<D.rows;y++){const [cx,cy]=xy([x,y]),can=tool==='draw'&&plan.canExtend([x,y])&&plan.line.length>0;
      ground+=svg('rect',{x:cx-CS/2+3,y:cy-CS/2+3,width:CS-6,height:CS-6,rx:5,fill:can?C.metro:C.soft,'fill-opacity':can?.10:.55,stroke:can?C.metro:C.line,'stroke-opacity':can?.45:1,'stroke-dasharray':can?'4 3':''});}
    // desire lines: grey = still by car; the metro-coloured core = the share that switches
    ev.rows.forEach((r,j)=>{const o=D.origins[r.i],d=D.destinations[r.k],{d:path,mid}=curve(o.cell,d.cell,j),w=2+r.people/7,on=sel===j;
      desire+=svg('path',{d:path,fill:'none',stroke:on?C.ink:C.ink3,'stroke-width':w.toFixed(1),'stroke-opacity':on?.5:sel>=0?.12:.28,'stroke-linecap':'round'});
      if(r.tenths)desire+=svg('path',{d:path,fill:'none',stroke:C.metro,'stroke-width':(w*r.tenths/10).toFixed(1),'stroke-opacity':sel>=0&&!on?.25:.85,'stroke-linecap':'round'});
      if(r.tenths&&(sel<0||on))labels+=pill(mid[0],mid[1],t('m.dl',{n:r.tenths,p:r.riders}),C.metro,12.5);
      else if(on)labels+=pill(mid[0],mid[1],t('m.dlCar',{c:r.car}),C.ink2,12.5);});
    // the selected trip, step by step: walk (dashed) → ride → walk (dashed)
    if(sel>=0){const r=ev.rows[sel];if(r.metro!==null){const o=D.origins[r.i].cell,d=D.destinations[r.k].cell;
      const seg=(a,b)=>`M${xy(a).join(' ')}L${xy([b[0],a[1]]).join(' ')}L${xy(b).join(' ')}`;
      lines+=svg('path',{d:seg(o,r.from),fill:'none',stroke:C.ink,'stroke-width':2.5,'stroke-dasharray':'2 5','stroke-linecap':'round'});
      lines+=svg('path',{d:seg(r.to,d),fill:'none',stroke:C.ink,'stroke-width':2.5,'stroke-dasharray':'2 5','stroke-linecap':'round'});}}
    // the line
    if(plan.line.length){const pts=plan.line.map(c=>xy(c).join(' ')).join(' L');
      lines+=svg('path',{d:'M'+pts,fill:'none',stroke:C.metro,'stroke-width':12,'stroke-linecap':'round','stroke-linejoin':'round'});
      if(plan.line.length===1){const [x,y]=xy(plan.line[0]);lines+=svg('circle',{cx:x,cy:y,r:7,fill:C.metro});}
      if(tool==='draw')for(const e of [plan.line[0],plan.line.at(-1)]){const [x,y]=xy(e);things+=svg('circle',{cx:x,cy:y,r:9,fill:C.panel,stroke:C.metro,'stroke-width':3,'stroke-dasharray':'3 2'});}}
    // hover preview
    if(hover){const [hx,hy]=xy(hover);
      if(tool==='draw'){
        if(plan.canExtend(hover)){const end=!plan.line.length?null:Metro.adj(hover,plan.line.at(-1))?plan.line.at(-1):plan.line[0];
          if(end)lines+=svg('path',{d:`M${xy(end).join(' ')}L${hx} ${hy}`,stroke:C.metro,'stroke-width':12,'stroke-opacity':.35,'stroke-linecap':'round'});
          else lines+=svg('circle',{cx:hx,cy:hy,r:7,fill:C.metro,'fill-opacity':.4});
          labels+=pill(hx,hy-22,t('m.pvExtend',{c:P.lineCost}),C.metro,12);}
        else if(plan.isEnd(hover))labels+=pill(hx,hy-22,t('m.pvShorten'),C.ink2,12);}
      else if(plan.onLine(hover)){const after=plan.withStation(hover),dv=after.riders-ev.riders,has=plan.isStation(hover);
        if(!has&&plan.left()<P.stationCost)labels+=pill(hx,hy-24,t('m.pvNoMoney'),C.bad,12);
        else{if(!has)things+=svg('circle',{cx:hx,cy:hy,r:15,fill:C.panel,stroke:C.metro,'stroke-width':5,'stroke-opacity':.5,'stroke-dasharray':'4 3'});
          labels+=pill(hx,hy-26,(has?t('m.pvRemove'):t('m.pvAdd'))+' '+t(dv>=0?'m.pvGain':'m.pvLoss',{n:Math.abs(dv)})+' · '+t(has?'m.pvRefund':'m.pvCost',{c:P.stationCost}),dv>0?C.accent:dv<0?C.bad:C.ink2,12.5);}}}
    // estates and destinations
    D.origins.forEach((o,i)=>{const [cx,cy]=xy(o.cell),up=o.house[1]<0,ppl=o.to.reduce((a,b)=>a+b,0),rode=ev.rows.filter(r=>r.i===i).reduce((a,r)=>a+r.riders,0);
      things+=sprite(ESTATE,cx-18,cy-24,3,{k:C.ink,w:C.paper,l:C.warn,g:C.ink2});
      labels+=text(cx,up?cy-34:cy+32,nameO(i),15.5,C.ink,{'text-anchor':'middle','font-weight':700});
      labels+=text(cx,up?cy-52:cy+50,rode?t('m.estRode',{n:ppl,r:rode}):t('m.estAll',{n:ppl}),12.5,rode?C.metro:C.ink2,{'text-anchor':'middle','font-weight':600});});
    D.destinations.forEach((o,k)=>{const [cx,cy]=xy(o.cell),sp=DEST[o.kind],w=sp[0].length*3,came=ev.rows.filter(r=>r.k===k).reduce((a,r)=>a+r.riders,0),ppl=ev.rows.filter(r=>r.k===k).reduce((a,r)=>a+r.people,0);
      things+=sprite(sp,cx-w/2,cy-24,3,{k:C.ink,w:C.paper,a:DCOL(o.kind),r:C.accent2,p:C.paper,l:C.warn,d:DCOL(o.kind),g:C.ink2});
      const side=o.house[0]>0,lx=side?cx+w/2+8:cx,ly=side?cy-8:cy-34,la=side?'start':'middle';
      labels+=text(lx,ly,nameD(k),15.5,DCOL(o.kind),{'text-anchor':la,'font-weight':700});
      labels+=text(lx,ly+(side?18:-18),came?t('m.dstRode',{n:ppl,r:came}):t('m.dstAll',{n:ppl}),12.5,came?C.metro:C.ink2,{'text-anchor':la,'font-weight':600});});
    // stations, numbered along the line
    const order=plan.stations.map(s=>({s,x:plan.line.findIndex(c=>same(c,s))})).sort((a,b)=>a.x-b.x);
    // a train running between the end stations, just to show it is a railway (under the stations)
    if(order.length>=2){const a=order[0].x,b=order.at(-1).x,span=b-a,ph=(now/1000*1.6)%(2*span),pos=a+(ph<span?ph:2*span-ph),i=Math.floor(pos),f=pos-i,c1=plan.line[i],c2=plan.line[Math.min(plan.line.length-1,i+1)];
      const [x1,y1]=xy(c1),[x2,y2]=xy(c2),x=x1+(x2-x1)*f,y=y1+(y2-y1)*f;
      lines+=`<g opacity=".9" transform="translate(${(x-28.5).toFixed(1)} ${(y-9).toFixed(1)})">`+sprite(TRAIN,0,0,3,{m:C.metro,w:C.paper,k:C.ink})+'</g>';}
    const building=c=>D.origins.some(o=>same(o.cell,c))||D.destinations.some(o=>same(o.cell,c));
    order.forEach(({s},n)=>{const [x,y]=xy(s);
      if(building(s))labels+=svg('circle',{cx:x,cy:y-6,r:26,fill:'none',stroke:C.metro,'stroke-width':4})+svg('circle',{cx:x+21,cy:y-25,r:10,fill:C.metro})+
        svg('text',{x:x+21,y:y-21,'font-size':12,'font-weight':700,fill:C.paper,'text-anchor':'middle','font-family':'Geist Mono,monospace'},n+1);
      else things+=svg('circle',{cx:x,cy:y,r:15,fill:C.panel,stroke:C.metro,'stroke-width':5})+svg('text',{x,y:y+5,'font-size':14,'font-weight':700,fill:C.metro,'text-anchor':'middle','font-family':'Geist Mono,monospace'},n+1);});
    $('board').innerHTML=ground+desire+lines+things+labels;
  }

  /* -------------------------------------------------------------- the side panels */
  function side(){
    const ev=plan.evaluate(),lo=0,hi=Math.round(P.masterScore*1.15),at=v=>Math.max(0,Math.min(100,100*(v-lo)/(hi-lo)));
    $('score').textContent=ev.riders;$('ofTotal').textContent=t('m.ofTotal',{n:ev.people});$('scoreBar').style.width=`${at(ev.riders)}%`;
    for(const [id,v,k] of [['tickPass',P.target,'g.tickPass'],['tickHigh',P.highScore,'g.tickHigh'],['tickMaster',P.masterScore,'g.tickMaster']]){$(id).style.left=`${at(v)}%`;$(id).dataset.label=t(k,{n:v});}
    const lc=plan.line.length*P.lineCost,sc=plan.stations.length*P.stationCost;
    $('budgetNum').textContent=`${ev.cost} / ${P.budget}`;$('bbLine').style.width=`${100*lc/P.budget}%`;$('bbStation').style.width=`${100*sc/P.budget}%`;
    $('budgetSum').textContent=t('m.budgetSum',{l:plan.line.length,lc:P.lineCost,s:plan.stations.length,sc:P.stationCost,left:plan.left()});
    document.querySelectorAll('#toolSeg [data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===tool)));
    $('toolHint').textContent=tool==='draw'?(plan.line.length?t('m.hintDraw2'):t('m.hintDraw1')):(plan.line.length<2?t('m.hintNeedLine'):plan.stations.length<2?t('m.hintStation1'):t('m.hintStation2'));
    $('undo').disabled=!history.length;$('submit').disabled=plan.stations.length<2;
    // every desire line, with its sum spelled out
    let h=`<thead><tr><th>${t('m.tTrip')}</th><th>${t('m.tPeople')}</th><th>${t('m.tCar')}</th><th>${t('m.tMetro')}</th><th>${t('m.tSave')}</th><th>${t('m.tRiders')}</th></tr></thead><tbody>`;
    ev.rows.forEach((r,j)=>{
      h+=`<tr data-row="${j}" class="${sel===j?'sel':''} ${r.riders?'on':''}"><td>${nameO(r.i)}<small>→ ${shortD(r.k)}</small></td><td>${r.people}</td><td>${r.car}</td>`+
        `<td>${r.metro===null?'—':`${r.metro}<small>${r.walkA}+${P.wait}+${r.pass}+${r.walkB}</small>`}</td><td>${r.metro===null?'':r.save}</td><td><b>${r.riders||''}</b>${r.tenths?`<small>${t('m.tenths',{n:r.tenths})}</small>`:''}</td></tr>`;});
    $('trips').innerHTML=h+`</tbody><tfoot><tr><td colspan="5">${t('m.tTotal')}</td><td><b>${ev.riders}</b></td></tr></tfoot>`;
  }
  function render(){draw();side();}
  function fit(){draw();try{const bb=$('board').getBBox(),x0=Math.min(0,bb.x-14),y0=Math.min(0,bb.y-14),x1=Math.max(VBW,bb.x+bb.width+14),y1=Math.max(VBH,bb.y+bb.height+14);
    $('board').setAttribute('viewBox',`${x0} ${y0} ${x1-x0} ${y1-y0}`);}catch(e){}}
  function texts(){
    $('goal').innerHTML=t('m.goal',{pass:P.target,high:P.highScore,master:P.masterScore});
    $('rule2').innerHTML=t('m.rule2',{w:P.wait});$('rule3').innerHTML=t('m.rule3',{lc:P.lineCost,sc:P.stationCost,b:P.budget});
    $('infoBody').innerHTML=t('m.info',{w:P.wait,lc:P.lineCost,sc:P.stationCost,b:P.budget});
    $('ivBody').innerHTML=t('iv.m2.body',{w:P.wait,lc:P.lineCost,sc:P.stationCost,b:P.budget});
    $('mapLegend').innerHTML=t('m.legend');document.title=t('m.doc');
  }

  /* -------------------------------------------------------------- the result: the score, and what would help most */
  function result(){
    const ev=plan.evaluate(),tier=ev.riders>=P.masterScore?3:ev.riders>=P.highScore?2:ev.riders>=P.target?1:0;
    $('result').classList.toggle('win',tier>0);$('resultTitle').textContent=t('r.t'+tier);$('resultEn').textContent=['Try again','Cleared','High score','Master'][tier];
    $('resultScore').textContent=t('m.rScore',{d:ev.riders,n:ev.people,c:ev.cost,b:P.budget});
    const tips=[];
    // a station that slows more people than it brings
    for(const s of plan.stations){const dv=evaluate(plan.line,plan.stations.filter(x=>!same(x,s))).riders-ev.riders;
      if(dv>0)tips.push(t('m.tipStation',{n:dv,sc:P.stationCost}));}
    // the biggest desire lines left by car
    const missed=ev.rows.filter(r=>!r.riders).sort((a,b)=>b.people-a.people).slice(0,2);
    for(const r of missed)tips.push(t(r.metro===null?'m.tipMissNo':'m.tipMissSlow',{a:nameO(r.i),b:shortD(r.k),n:r.people,car:r.car,m:r.metro??''}));
    if(plan.left()>=P.stationCost)tips.push(t('m.tipBudget',{n:plan.left()}));
    if(tier===3&&!tips.length)tips.push(t('m.tip3'));
    $('resultBody').innerHTML=`<ul class="ivlist">${tips.slice(0,4).map(s=>`<li>${s}</li>`).join('')}</ul>`;
    try{const k='tl-best-m2-'+D.map;if(ev.riders>(+localStorage.getItem(k)||0))localStorage.setItem(k,ev.riders);}catch(e){}
    window.dispatchEvent(new CustomEvent('tl:result',{detail:{game:'feeder',mode:'m2-metro',version:'7.3-static',map:D.map,score:ev.riders,total:ev.people,tier,
      tiers:[P.target,P.highScore,P.masterScore],cost:ev.cost,line:plan.line,stations:plan.stations,lang:I.lang}}));
    $('result').showModal();
  }

  /* -------------------------------------------------------------- controls */
  const board=$('board');
  function cellAt(e){const pt=board.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;const p=pt.matrixTransform(board.getScreenCTM().inverse());
    const c=[Math.round((p.x-MX)/CS),Math.round((p.y-MY)/CS)];return c[0]>=0&&c[1]>=0&&c[0]<D.cols&&c[1]<D.rows?c:null;}
  function act(c){
    if(tool==='draw'){
      if(plan.canExtend(c)){snapshot();plan.extend(c);return true;}
      if(plan.isEnd(c)){snapshot();plan.shorten(c);return true;}
      if(plan.left()<P.lineCost)toast(t('m.nNoMoney'),'warn');
      else if(plan.line.length&&!plan.onLine(c))toast(t('m.nAdjacent'),'warn');
      return false;}
    if(!plan.onLine(c)){toast(t('m.nOnLine'),'warn');return false;}
    if(!plan.isStation(c)&&plan.left()<P.stationCost){toast(t('m.nNoMoney'),'warn');return false;}
    snapshot();plan.toggleStation(c);return true;
  }
  board.onpointerdown=e=>{const c=cellAt(e);if(!c)return;drag=tool==='draw';if(act(c))render();if(drag)board.setPointerCapture(e.pointerId);};
  board.onpointermove=e=>{const c=cellAt(e);
    if(drag&&c&&plan.canExtend(c)){snapshot();plan.extend(c);hover=null;render();return;}
    if(JSON.stringify(c)!==JSON.stringify(hover)){hover=c;draw();}};
  board.onpointerup=()=>{drag=false;};
  board.onpointerleave=()=>{if(!drag&&hover){hover=null;draw();}};
  $('toolSeg').onclick=e=>{const b=e.target.closest('[data-tool]');if(b){tool=b.dataset.tool;hover=null;render();}};
  $('undo').onclick=()=>{const p=history.pop();if(p){plan=p;render();}};
  $('clear').onclick=()=>{if(!plan.line.length)return;snapshot();plan.clear();tool='draw';render();};
  $('submit').onclick=result;
  $('trips').onclick=e=>{const r=e.target.closest('[data-row]');if(!r)return;const j=+r.dataset.row;sel=sel===j?-1:j;render();};
  $('again').onclick=()=>{$('result').close();snapshot();plan.clear();tool='draw';sel=-1;render();};
  $('help').onclick=()=>$('info').showModal();
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  $('lvInfo').onclick=()=>$('lvIntro').showModal();$('ivGo').onclick=()=>$('lvIntro').close();
  document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]'))return;
    if(e.key==='1'){tool='draw';render();}else if(e.key==='2'){tool='station';render();}
    else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$('undo').click();}
    else if(e.key==='Escape'&&sel>=0){sel=-1;render();}});
  function setTheme(th){document.documentElement.setAttribute('data-theme',th);$('thPaper').setAttribute('aria-pressed',String(th==='light'));$('thInk').setAttribute('aria-pressed',String(th==='dark'));
    try{localStorage.setItem('tl-theme',th);}catch(e){}readTokens();render();}
  $('thPaper').onclick=()=>setTheme('light');$('thInk').onclick=()=>setTheme('dark');
  window.addEventListener('tl:lang',()=>{texts();fit();render();});
  // the train moves: redraw a few times a second while there is a line with two stations
  let lastFrame=0;(function loop(now){if(plan.stations.length>=2&&now-lastFrame>60&&!drag){draw(now);lastFrame=now;}requestAnimationFrame(loop);})(0);
  // test hook: #intro=0&line=2,2;3,2;4,2&stations=2,2;4,2&tool=station&sel=0&theme=dark&lang=en
  const q=new URLSearchParams(location.hash.slice(1));
  let saved=null;try{saved=localStorage.getItem('tl-theme');}catch(e){}
  board.setAttribute('viewBox',`0 0 ${VBW} ${VBH}`);
  if(q.get('theme')||saved)setTheme(q.get('theme')||saved);
  if(q.get('line'))for(const s of q.get('line').split(';'))plan.extend(s.split(',').map(Number));
  if(q.get('stations'))for(const s of q.get('stations').split(';'))plan.toggleStation(s.split(',').map(Number));
  if(q.get('tool'))tool=q.get('tool');if(q.get('sel'))sel=+q.get('sel');
  texts();fit();render();
  if(q.get('intro')!=='0'&&!q.get('line'))$('lvIntro').showModal();
  window.TL_METRO={plan:()=>({line:plan.line.map(c=>c.slice()),stations:plan.stations.map(c=>c.slice()),...plan.evaluate()}),cellXY:c=>{const m=board.getScreenCTM(),[x,y]=xy(c);return[m.a*x+m.c*y+m.e,m.b*x+m.d*y+m.f];}};
})();
