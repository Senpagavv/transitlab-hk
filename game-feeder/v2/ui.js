(()=>{
  'use strict';
  const {Game,D,P,route,dist,along,same,willing,comes,headwayAt}=Tide,$=id=>document.getElementById(id);
  const C={paper:'#f2efe3',card:'#f7f4e8',ink:'#23201a',ink2:'#5a564a',edge:'#d5d0bd',joint:'#e8e7d9',deep:'#0d3024',
    land:'#a8ad52',landDeep:'#98a04a',tide:'#6cc79b',green:'#2e7d4f',blue:'#2a5d8f',amber:'#c08a2d',red:'#a72a24'};
  const letters=['A','B','C'],total=D.waves.flat().reduce((a,b)=>a+b,0);
  const shortName=['唐人新村','翹翠峰','蝶翠峰','橫洲'];
  let game=new Game(),selected=0,playing=false,speed=1,hover=null,shown=false,drag=null,pointerPressed=false,restoringFocus=false,last=performance.now(),lastDraw=0;
  const xy=c=>[20+c[0]*72,30+c[1]*62];
  const fmt=n=>`${String(Math.floor(Math.max(0,n)/60)).padStart(2,'0')}:${String(Math.floor(Math.max(0,n)%60)).padStart(2,'0')}`;
  const pathStr=path=>path.map((c,i)=>(i?'L':'M')+xy(c).join(' ')).join(' ');
  const svg=(tag,attrs,content='')=>`<${tag} ${Object.entries(attrs).map(([k,v])=>`${k}="${v}"`).join(' ')}>${content}</${tag}>`;
  const text=(x,y,s,size=13,fill=C.ink,extra={})=>svg('text',{x,y,'font-size':size,fill,stroke:C.card,'stroke-width':3,...extra},s);
  const rect=(x,y,w,h,fill,stroke=C.edge,extra={})=>svg('rect',{x,y,width:w,height:h,rx:5,fill,stroke,...extra});
  const waveStart=w=>P.firstWave+w*P.interval;
  // Estate buildings sit just off the road so stops can share the cell.
  const houseAt=i=>{const [x,y]=xy(D.origins[i].cell);return i===3?[x,y-40]:[x,y+38];};
  function note(s){$('notice').textContent=s;}
  function put(cell){
    const was=game.started;
    if(game.place(selected,cell)){
      hover=null;
      note(was?`${letters[selected]} 站搬好了，重建 20 秒；站上還沒上車的人要走回家，已開出的巴士照常送達。`:'放好了。可以選另一座站，或拖動已放的站。');
      if(!was){const next=game.stops.find(s=>!s.cell);if(next)selected=next.id;}
      render();
    }else note(was&&game.moves===0?'搬站次數已用完。':'這格已有車站，請選另一個 ＋。');
  }
  // Predicted arrivals per stop per batch (from the shares on the map) and whether the stop can take them.
  function plan(fc){
    return D.waves.map((w,wi)=>{
      const load=[0,0,0];fc.forEach(f=>{if(f.stop>=0)load[f.stop]+=f.perWave[wi];});
      const hot=load.map((l,s)=>{const c=hover&&s===selected?hover:game.stops[s].cell;if(!c||!l)return false;
        return l>P.seats*Math.max(1,Math.floor(P.interval/headwayAt(c)))+P.queue;});
      return{load,hot};
    });
  }
  function drawTide(){
    const fc=game.forecast(hover?selected:-1,hover),any=fc.some(f=>f.stop>=0),pl=plan(fc),w=game.waveInfo();
    const cur=game.started?(w.active>=0?w.active:w.next>=0?w.next:8):-1;
    let h=`<thead><tr><th>批次</th>${shortName.map(n=>`<th>${n}</th>`).join('')}</tr></thead><tbody>`;
    D.waves.forEach((wave,wi)=>{
      const past=game.started&&waveStart(wi)+P.release<=game.t;
      h+=`<tr class="${wi===cur?'now':''} ${past?'past':''}"><td>${fmt(waveStart(wi))}</td>`;
      wave.forEach((n,o)=>{
        const peak=D.peaks.some(p=>p.origin===o&&p.wave===wi),f=fc[o],k=f.perWave[wi],hot=f.stop>=0&&pl[wi].hot[f.stop];
        h+=`<td class="${peak?'peak':''} ${hot?'hot':''}"><b>${n}</b>${any?`<i>${f.stop<0?'無站':`會來 ${k}`}</i>`:''}</td>`;
      });
      h+='</tr>';
    });
    $('tide').innerHTML=h+'</tbody>';
  }
  function drawStopPanel(){
    const s=game.stops[selected],cell=hover||s.cell;
    let h=`<h2>${letters[selected]} 站${hover?' · 預覽':''}<small class="en">STOP ${letters[selected]}</small></h2>`;
    if(!cell){$('stopPanel').innerHTML=h+'<p>還沒放。點地圖上的 ＋ 放站；放之前把滑鼠停在 ＋ 上，可以先看每個屋苑會來多少人。</p>';return;}
    const steps=dist(cell,D.hub),hw=headwayAt(cell),fc=game.forecast(hover?selected:-1,hover);
    const served=fc.filter(f=>f.stop===selected).map(f=>`${D.origins[f.origin].name} ${Math.round(f.share*100)}%`).join('、')||'沒有屋苑選這座站';
    h+=`<div class="row"><span>到港鐵</span><span>${steps} 格 → 班距 ${P.headwayBase}＋${steps}×${P.headwayStep}＝<b>${hw} 秒</b></span></div>`;
    h+=`<div class="row"><span>誰會來</span><span>${served}</span></div>`;
    if(!hover){
      const build=Math.max(0,s.ready-game.t);
      h+=`<div class="row"><span>下一班</span><span class="big">${game.done?'—':!game.started?`開局後 ${hw}s`:build?`重建 ${Math.ceil(build)}s`:fmt(game.eta(s))}</span></div>`;
      h+=`<div class="row"><span>座位 ${s.boarding.length}/${P.seats}</span></div><div class="slots">${Array.from({length:P.seats},(_,j)=>`<i class="${j<s.boarding.length?'on':''}"></i>`).join('')}</div>`;
      h+=`<div class="row"><span>排隊 ${s.queue.length}/${P.queue}</span><span>${s.rejected?`被擠走 ${s.rejected} 人次`:''}</span></div><div class="slots queue ${s.queue.length>=P.queue?'full':''}">${Array.from({length:P.queue},(_,j)=>`<i class="${j<s.queue.length?'on':''}"></i>`).join('')}</div>`;
    }else h+=`<p>${game.started?`點擊搬到這裡：重建 20 秒，剩 ${game.moves} 次。`:'點擊放站（開局前不扣搬站次數）。'}離港鐵近 → 班次密；離屋苑近 → 來的人多。</p>`;
    $('stopPanel').innerHTML=h;
  }
  function drawHouse(i,fc){
    const o=D.origins[i],h=game.homeStats(i),[hx,hy]=houseAt(i),[cx,cy]=xy(o.cell);
    let out=svg('path',{d:`M${cx} ${cy}L${hx} ${hy}`,stroke:C.ink2,'stroke-width':2,'stroke-dasharray':'3 3'});
    if(hover){const f=fc[i],w=f.stop===selected?f.share:0,k=f.perWave;
      if(w>0){const r=22+24*w;out+=svg('circle',{cx:hx,cy:hy,r,fill:C.green,'fill-opacity':.12+.2*w,stroke:C.green,'stroke-width':2+2*w});
        const next=game.started?(game.waveInfo().next):0;
        out+=text(hx+r+6,hy-2,`${Math.round(w*100)}%`,16,C.green,{'font-weight':700});
        if(next>=0)out+=text(hx+r+6,hy+15,`下批 ${k[next]}/${D.waves[next][i]} 人`,12,C.green,{'font-weight':700});}}
    const peakNow=D.peaks.some(p=>p.origin===i&&game.t>=waveStart(p.wave)&&game.t<waveStart(p.wave)+P.release+20);
    if(peakNow)out+=svg('circle',{cx:hx,cy:hy,r:30,fill:'none',stroke:C.amber,'stroke-width':4,'stroke-dasharray':'6 4'});
    // pixel building: three blocks
    out+=rect(hx-17,hy-10,12,22,C.ink2,C.ink,{rx:1})+rect(hx-4,hy-16,10,28,C.ink,C.ink,{rx:1})+rect(hx+7,hy-6,10,18,C.ink2,C.ink,{rx:1});
    for(let k=0;k<3;k++)out+=svg('rect',{x:hx-1+(k%2)*3,y:hy-12+k*7,width:2,height:3,fill:C.paper});
    const ly=i===3?hy-22:hy+28;
    out+=text(hx,ly,o.name,14,C.ink,{'text-anchor':'middle','font-weight':700});
    if(h.home)out+=rect(hx+20,hy-12,36,22,C.card,C.amber,{'stroke-width':2})+text(hx+38,hy+4,`${h.home}`,13,C.amber,{'text-anchor':'middle','font-weight':700});
    const recent=game.events.filter(e=>e.type==='car'&&e.origin===i&&game.t-e.time<15).length;
    if(recent){const bx=hx-60,by=hy-4;out+=rect(bx-12,by-7,22,12,C.red,C.red,{rx:3})+svg('circle',{cx:bx-6,cy:by+6,r:2.6,fill:C.ink})+svg('circle',{cx:bx+4,cy:by+6,r:2.6,fill:C.ink})+text(bx+14,by+4,`+${recent}`,13,C.red,{'font-weight':700});}
    return out;
  }
  function drawMap(){
    // Do not replace a focused SVG node between pointer-down and click.
    if(pointerPressed&&!drag?.moved)return;
    const focused=document.activeElement,attrs=['data-cell','data-stop'];
    const focusAttr=attrs.find(a=>focused?.hasAttribute(a)),focusVal=focusAttr?focused.getAttribute(focusAttr):null;
    const fc=game.forecast(hover?selected:-1,hover);
    let out='';
    // pixel land
    for(let x=-1;x<11;x++)for(let y=-1;y<8;y++)if((x*7+y*13)%5===0){const [cx,cy]=xy([x,y]);out+=svg('rect',{x:cx-36,y:cy-31,width:72,height:62,fill:C.landDeep});}
    for(const c of D.roads)for(const n of [[c[0]+1,c[1]],[c[0],c[1]+1]])if(D.roads.some(q=>same(q,n)))out+=svg('path',{d:pathStr([c,n]),stroke:C.edge,'stroke-width':26,fill:'none','stroke-linecap':'square'});
    for(const c of D.roads)for(const n of [[c[0]+1,c[1]],[c[0],c[1]+1]])if(D.roads.some(q=>same(q,n)))out+=svg('path',{d:pathStr([c,n]),stroke:C.card,'stroke-width':20,fill:'none','stroke-linecap':'square'});
    const active=game.stops[selected];
    if(active.cell&&!hover)out+=svg('path',{d:pathStr(route(active.cell,D.hub)),stroke:C.green,'stroke-width':4,fill:'none',opacity:.35});
    if(hover)out+=svg('path',{d:pathStr(route(hover,D.hub)),stroke:C.green,'stroke-width':4,fill:'none','stroke-dasharray':'6 6',opacity:.8});
    for(let i=0;i<D.origins.length;i++)out+=drawHouse(i,fc);
    const [mx,my]=xy(D.hub);
    out+=rect(mx-24,my-23,48,46,C.deep,C.deep,{rx:3});
    out+=svg('text',{x:mx,y:my+9,'font-size':26,fill:C.card,'text-anchor':'middle','font-family':'Fraunces,Georgia,serif','font-weight':700},'M');
    out+=text(mx+32,my-8,'朗屏港鐵',15,C.deep,{'font-weight':700});
    out+=text(mx+32,my+8,'LONG PING',9.5,C.ink2,{'letter-spacing':'.16em'});
    out+=text(mx+32,my+25,`已送達 ${game.delivered}`,13,C.green,{'font-weight':700});
    for(const c of D.candidates){
      if(game.stops.some(s=>same(s.cell,c)))continue;
      const [x,y]=xy(c),on=hover&&same(hover,c);
      out+=svg('g',{class:'candidate','data-cell':c.join(','),role:'button',tabindex:0,'aria-label':`放置接駁站於 ${c[0]+1} 列 ${c[1]+1} 行`},svg('circle',{cx:x,cy:y,r:12,fill:on?C.green:C.card,stroke:on?C.green:C.ink2,'stroke-width':1.5})+svg('text',{x,y:y+5,'font-size':16,fill:on?C.card:C.ink2,'text-anchor':'middle'},'＋'));
    }
    // Buses go under the stops so a departing bus does not hide the stop letter.
    for(const b of game.trips.filter(b=>!b.done)){
      const [x,y]=xy(along(b.path,game.t-b.since,P.busStep));
      out+=svg('path',{d:pathStr(b.path),fill:'none',stroke:C.green,'stroke-width':2,opacity:.25});
      out+=rect(x-20,y-11,40,22,C.green,C.deep,{'stroke-width':1.5,rx:6})+svg('text',{x,y:y+5,'font-size':13,fill:C.card,'text-anchor':'middle','font-weight':700},`${letters[b.stop]}·${b.load.length}`);
    }
    for(const s of game.stops){if(!s.cell)continue;
      const [x,y]=xy(s.cell),build=Math.max(0,s.ready-game.t),sel=selected===s.id,full=s.queue.length>=P.queue;
      let content=rect(x-17,y-15,34,30,build?C.card:C.green,sel?C.ink:C.green,{'stroke-width':sel?3:1.5,'stroke-dasharray':build?'4 3':'none'});
      content+=svg('text',{x,y:y+7,'font-size':19,fill:build?C.green:C.card,'text-anchor':'middle','font-weight':700,'font-family':'Fraunces,Georgia,serif'},letters[s.id]);
      content+=text(x,y+31,game.done?'':build?`重建 ${Math.ceil(build)}s`:game.started?`發車 ${fmt(game.eta(s))}`:`班距 ${game.headway(s)}s`,12,C.green,{'text-anchor':'middle','font-weight':700});
      for(let j=0;j<P.seats;j++)content+=svg('rect',{x:x-29+j*10,y:y-37,width:8,height:8,rx:1.5,fill:j<s.boarding.length?C.green:C.card,stroke:C.green,'stroke-width':1.2});
      for(let j=0;j<P.queue;j++)content+=svg('rect',{x:x-31+j*8,y:y-26,width:6,height:7,rx:1,fill:j<s.queue.length?(full?C.red:C.amber):C.card,stroke:full?C.red:C.amber,'stroke-width':1});
      out+=svg('g',{class:'stop','data-stop':s.id,role:'button',tabindex:0,'aria-label':`接駁站 ${letters[s.id]}：座位 ${s.boarding.length}/${P.seats}，排隊 ${s.queue.length}/${P.queue}`},content);
    }
    for(const p of game.people)if(['walk','return'].includes(p.state)){
      const [x,y]=xy(game.pos(p)),ox=(p.id%3-1)*5,oy=(p.id%2?1:-1)*4;
      out+=svg('circle',{cx:x+ox,cy:y+oy,r:3.8,fill:p.state==='walk'?C.blue:C.amber,stroke:C.card,'stroke-width':1});
    }
    $('board').innerHTML=out;
    if(focusAttr){restoringFocus=true;try{$('board').querySelector(`[${focusAttr}="${focusVal}"]`)?.focus({preventScroll:true});}finally{restoringFocus=false;}}
    drawTide();drawStopPanel();
  }
  const reasons=['沒有夠近的站','站滿了','等太久'];
  function render(){
    const stats=game.stats(),w=game.waveInfo(),focusSelect=document.activeElement?.getAttribute('data-select');
    $('score').textContent=stats.delivered;$('scoreBar').style.width=`${100*stats.delivered/total}%`;
    $('goal').textContent=`過關 ${P.target} · 高分 ${P.highScore} · 共 ${total} 人`;
    $('cars').textContent=stats.cars;$('clock').textContent=`${fmt(game.t)} / ${fmt(P.duration)}`;$('moves').textContent=game.moves;
    $('wave').textContent=!game.started?`第 1 批：開局後 ${P.firstWave} 秒`:game.done?`未完成 ${game.missed} 人`:w.active>=0?`第 ${w.active+1}/8 批正在出門`:w.next>=0?`第 ${w.next+1}/8 批：${fmt(w.nextStart-game.t)} 後`:'8 批都出門了';
    $('start').innerHTML=(game.done?'已結束':game.started?(playing?'暫停':'繼續'):'開始')+`<small class="en">${game.done?'FINISHED':game.started?(playing?'PAUSE':'RESUME'):'START'}</small>`;
    $('start').disabled=game.done||(!game.started&&game.stops.some(s=>!s.cell));$('speed').value=speed;
    $('mapHint').textContent=game.done?'本局已結束。':game.started?`${playing?'運行中':'已暫停'} · 選 ${letters[selected]} 站再點 ＋，或直接拖動車站（剩 ${game.moves} 次）`:`放 ${letters[selected]} 站：滑鼠停在 ＋ 上先看預覽，點擊放下`;
    $('stations').innerHTML=game.stops.map(s=>`<button class="station-button ${s.id===selected?'selected':''}" data-select="${s.id}" aria-pressed="${s.id===selected}"><b>${letters[s.id]}</b><small>${s.cell?`座 ${s.boarding.length}/${P.seats} · 隊 ${s.queue.length}/${P.queue}`:'未放置'}</small></button>`).join('');
    drawMap();if(focusSelect)$('stations').querySelector(`[data-select="${focusSelect}"]`)?.focus({preventScroll:true});
    if(game.done&&!shown){shown=true;playing=false;showResult();}
  }
  function showResult(){
    const tier=game.delivered>=P.highScore?2:game.delivered>=P.target?1:0;
    $('resultTitle').textContent=['未過關','過關！','高分！跟上了潮汐'][tier];$('resultEn').textContent=['TRY AGAIN','CLEARED','HIGH SCORE'][tier];
    $('resultScore').textContent=`送達 ${game.delivered} / ${total} · 開車 ${game.cars} · 未完成 ${game.missed}`;
    const cars=game.events.filter(e=>e.type==='car'),count=(o,r)=>cars.filter(e=>e.origin===o&&e.why===r).length;
    $('resultRows').innerHTML=D.origins.map((o,i)=>{const h=game.homeStats(i);return `<tr><td>${o.name}</td><td>${h.delivered}/${h.total}</td>${reasons.map(r=>`<td>${count(i,r)||''}</td>`).join('')}<td>${h.missed||''}</td></tr>`;}).join('');
    const by=reasons.map(r=>cars.filter(e=>e.why===r).length),top=by.indexOf(Math.max(...by));
    const hint=tier===2?'這局跟上了每一次高峰。可以試試用更少的搬站次數做到。':
      top===0?`開車的人裡，最多是因為「太遠」（${by[0]} 人）：站離屋苑每近一格，願意來的人多 20%。`:
      `開車的人裡，最多是因為「${reasons[top]}」（${by[top]} 人）：看潮汐表，在高峰前 30 秒把一座站搬到那個屋苑旁邊，分走一部分人。`;
    $('resultHint').textContent=hint;$('result').showModal();
  }
  function reset(){game=new Game();selected=0;playing=false;speed=1;shown=false;hover=null;last=performance.now();note('每次重開都是同一份需求，方便比較不同站位。');render();}
  function pauseForInfo(){if(playing){playing=false;render();note('看規則時已暫停，關閉後點繼續。');}}
  $('stations').onclick=e=>{const el=e.target.closest('[data-select]');if(el){selected=+el.dataset.select;render();}};
  function svgPoint(e){const point=$('board').createSVGPoint();point.x=e.clientX;point.y=e.clientY;return point.matrixTransform($('board').getScreenCTM().inverse());}
  function pointCell(e){const p=svgPoint(e);return D.candidates.find(c=>{const [x,y]=xy(c);return Math.hypot(p.x-x,p.y-y)<22&&!game.stops.some(s=>same(s.cell,c));});}
  function pointStop(e){const p=svgPoint(e);return game.stops.find(s=>{if(!s.cell)return false;const [x,y]=xy(s.cell);return Math.hypot(p.x-x,p.y-y)<22;});}
  $('board').onclick=e=>{if(drag?.moved)return;const stop=e.target.closest('[data-stop]'),cell=e.target.closest('[data-cell]');if(stop){selected=+stop.dataset.stop;render();}else{const c=cell?cell.dataset.cell.split(',').map(Number):pointCell(e);if(c)put(c);}};
  $('board').onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();const s=e.target.closest('[data-stop]'),c=e.target.closest('[data-cell]');if(s){selected=+s.dataset.stop;render();}else if(c)put(c.dataset.cell.split(',').map(Number));}};
  $('board').onpointermove=e=>{if(drag&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>5)drag.moved=true;const c=pointCell(e)||null;if(JSON.stringify(c)!==JSON.stringify(hover)){hover=c;drawMap();}};
  $('board').onpointerleave=()=>{if(!drag){hover=null;drawMap();}};
  $('board').onpointerdown=e=>{pointerPressed=true;const el=e.target.closest('[data-stop]'),s=el?game.stops[+el.dataset.stop]:pointStop(e);if(s){selected=s.id;drag={x:e.clientX,y:e.clientY,moved:false};$('board').setPointerCapture(e.pointerId);render();}};
  $('board').onpointerup=()=>{pointerPressed=false;if(drag?.moved&&hover)put(hover);const moved=drag?.moved;drag=null;hover=null;if(moved)render();};
  document.addEventListener('pointerup',()=>{pointerPressed=false;requestAnimationFrame(()=>drawMap());});
  $('board').onpointercancel=()=>{pointerPressed=false;drag=null;hover=null;render();};
  $('board').addEventListener('focusin',e=>{if(restoringFocus)return;const c=e.target.closest('[data-cell]'),next=c?c.dataset.cell.split(',').map(Number):null;if(JSON.stringify(next)!==JSON.stringify(hover)){hover=next;drawMap();}});
  $('start').onclick=()=>{if(!game.started&&!game.start())return;playing=!playing;last=performance.now();note(playing?'開始了。看潮汐表：琥珀框是高峰，紅字是這座站可能擠爆。':'已暫停，可以慢慢看；搬站仍扣次數。');render();};
  $('speed').onchange=()=>{speed=+$('speed').value;note(`速度 ${speed}×；1× 是完整 18 分鐘。`);render();};
  $('reset').onclick=()=>{if(game.started&&!game.done&&!confirm('重開會清除本局進度，是否重開？'))return;reset();};
  $('help').onclick=()=>{pauseForInfo();$('info').showModal();};
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  $('again').onclick=()=>{$('result').close();reset();};
  $('enter').onclick=()=>$('intro').close();
  $('download').onclick=()=>{const run={version:'feeder-v2-2026-10-06',seed:game.seed,parameters:P,demand:D.waves,stats:game.stats(),stops:game.stops.map(s=>({id:s.id,cell:s.cell,peak:s.peak,rejected:s.rejected})),moves:game.commands,events:game.events};const url=URL.createObjectURL(new Blob([JSON.stringify(run,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='TransitLab-接駁v2-本局紀錄.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  $('source').textContent=D.source.geography+' '+D.source.demand;
  $('introPass').textContent=P.target;$('introHigh').textContent=P.highScore;$('introTotal').textContent=total;
  $('tickPass').style.left=`${100*P.target/total}%`;$('tickPass').dataset.label=P.target;
  $('tickHigh').style.left=`${100*P.highScore/total}%`;$('tickHigh').dataset.label=P.highScore;
  document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]')||e.target.tagName==='SELECT')return;if(['1','2','3'].includes(e.key)){selected=+e.key-1;render();}else if(e.code==='Space'&&e.target===document.body){e.preventDefault();if(game.started&&!game.done){playing=!playing;last=performance.now();render();}}});
  document.addEventListener('visibilitychange',()=>{last=performance.now();if(document.hidden&&playing){playing=false;note('離開畫面時已自動暫停。');render();}});
  function frame(now){const dt=Math.min(.5,(now-last)/1000);last=now;if(playing)game.advance(dt*speed);if(playing&&now-lastDraw>120){render();lastDraw=now;}requestAnimationFrame(frame);}
  // Test hook for screenshots and bots: #intro=0&layout=0-7-11&t=400&hover=3&sel=1&moves=125:1:11,365:1:6
  const q=new URLSearchParams(location.hash.slice(1));
  if(q.get('layout')){q.get('layout').split('-').map(Number).forEach((c,id)=>game.place(id,D.candidates[c]));
    if(q.get('t')){game.start();const moves=(q.get('moves')||'').split(',').filter(Boolean).map(m=>m.split(':').map(Number)).sort((a,b)=>a[0]-b[0]);
      for(const [t,id,to] of moves)if(t<+q.get('t')){game.advance(t-game.t);game.place(id,D.candidates[to]);}game.advance(+q.get('t')-game.t);}}
  if(q.get('sel'))selected=+q.get('sel');if(q.get('hover'))hover=D.candidates[+q.get('hover')];
  note('布局不限時。先放好三座接駁站，再按「開始」。');render();
  if(q.get('intro')!=='0')$('intro').showModal();
  requestAnimationFrame(frame);
})();
