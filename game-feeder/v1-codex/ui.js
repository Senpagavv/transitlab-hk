(()=>{
  'use strict';
  const {Game,D,P,route,dist,along,same}=Tide,$=id=>document.getElementById(id);
  const C={paper:'#f2efe3',card:'#f7f4e8',ink:'#23201a',muted:'#5a564a',edge:'#d5d0bd',deep:'#0d3024',green:'#2e7d4f',blue:'#2a5d8f',teal:'#12766e',amber:'#c08a2d',red:'#a72a24'};
  const letters=['A','B','C'],colors=[C.green,C.blue,C.teal];
  let game=new Game(),selected=0,playing=false,speed=1,hover=null,shown=false,drag=null,pointerPressed=false,restoringFocus=false,last=performance.now(),lastDraw=0;
  const xy=c=>[60+c[0]*70,40+c[1]*55];
  const fmt=n=>`${String(Math.floor(Math.max(0,n)/60)).padStart(2,'0')}:${String(Math.floor(Math.max(0,n)%60)).padStart(2,'0')}`;
  const pathStr=path=>path.map((c,i)=>(i?'L':'M')+xy(c).join(' ')).join(' ');
  const svg=(tag,attrs,content='')=>`<${tag} ${Object.entries(attrs).map(([k,v])=>`${k}="${v}"`).join(' ')}>${content}</${tag}>`;
  const text=(x,y,s,size=15,fill=C.ink,extra={})=>svg('text',{x,y,'font-size':size,style:`fill:${fill}`,...extra},s);
  const rect=(x,y,w,h,fill,stroke=C.edge,extra={})=>svg('rect',{x,y,width:w,height:h,rx:8,fill,stroke,...extra});
  function note(s){$('notice').textContent=s;}
  function put(cell){
    const was=game.started;
    if(game.place(selected,cell)){
      hover=null;
      note(was?`${letters[selected]} 站重建 20 秒；尚未發車者返家，已駛出的車繼續送達。`:'接駁站已放好，可繼續選另一座站。');
      if(!was){const next=game.stops.find(s=>!s.cell);if(next)selected=next.id;}
      render();
    }else note(was&&game.moves===0?'搬站次數已用完。':'這格已有車站，請選另一個 ＋。');
  }
  function drawPanel(){
    const s=game.stops[selected],cell=hover||s.cell,color=colors[selected];
    let out=rect(20,20,315,177,C.card);
    out+=text(36,45,hover?`預覽 ${letters[selected]} 站的位置`:`${letters[selected]} 接駁站 · 定時發車`,18,color,{'font-weight':700});
    if(!cell){out+=text(36,76,'選地圖上的 ＋，看住宅影響。');out+=text(36,103,'每班 5 座 · 另有 8 個排隊位');out+=text(36,132,'車留在站內上客，倒數歸零才出發。',14);out+=text(36,166,'初始布局不限時，開局後可搬 6 次。',14,C.muted);return out;}
    const steps=dist(cell,D.hub),headway=P.headwayBase+steps*P.headwayStep;
    out+=text(36,71,`班距 ${headway} 秒 · 到港鐵 ${steps*P.busStep} 秒`,15);
    if(hover){
      out+=text(36,98,'住宅卡與光圈：距離影響預覽',15,color);
      out+=text(36,123,'遠站少走路，卻可能班次更疏。',14);
      out+=text(36,149,'位置只預覽，實際還受候車與擁擠影響。',12,C.muted);
      out+=text(36,177,game.started?`點擊搬站 · 重建 20 秒 · 餘 ${game.moves} 次`:'點擊放站 · 初始布局不扣搬遷次數',14,color);
    }else{
      const build=Math.max(0,s.ready-game.t),eta=game.started?fmt(game.eta(s)):'開局時計';
      out+=text(36,98,game.done?'本局觀察已結束':!game.started?`首班：開局後 ${headway} 秒`:build?`重建倒數 ${fmt(build)}`:`下一班 ${eta} 發車`,19,color,{'font-weight':700});
      out+=rect(36,110,110,29,C.card,color,{'stroke-width':2,rx:5});
      out+=svg('circle',{cx:55,cy:139,r:3,fill:color})+svg('circle',{cx:125,cy:139,r:3,fill:color});
      out+=text(91,130,`${letters[s.id]}車 ${s.boarding.length}/5`,16,color,{'text-anchor':'middle','font-weight':700});
      out+=text(163,130,`排隊 ${s.queue.length}/8`,17,s.queue.length===8?C.red:C.ink);
      const waiting=[...s.queue,...s.boarding].map(id=>game.person(id));
      const left=waiting.length?Math.min(...waiting.map(p=>Math.min(p.queueLimit-(game.t-p.since),p.deadline-game.t))):null;
      out+=text(36,157,left===null?'到站就能上空座，滿座才排隊。':`最先久候返家：${left<1?'不足1秒':fmt(left)}`,14,left===null?C.muted:C.amber);
      out+=text(36,177,`峰值排隊 ${s.peak}/8 · 滿員返家 ${s.rejected} 人次`,14,C.muted);
    }
    return out;
  }
  function drawHouse(i){
    const o=D.origins[i],h=game.homeStats(i),[hx,hy]=xy(o.cell);
    const box=i===3?[610,20,240,163]:[[20,435,240,142],[290,435,240,142],[560,435,240,142]][i];
    const [x,y,w,height]=box,tx=x+12,cardAnchor=i===3?[x,100]:[x+w/2,y];
    let out=svg('path',{d:`M${hx} ${hy-30}L${cardAnchor.join(' ')}`,stroke:C.edge,'stroke-width':1.5,fill:'none'});
    if(hover){const steps=dist(o.cell,hover),a=1/(1+(steps/P.spread)**2);out+=svg('circle',{cx:hx,cy:hy,r:23+17*a,fill:C.green,opacity:.06+.12*a});out+=svg('circle',{cx:hx,cy:hy,r:23+17*a,fill:'none',stroke:C.green,'stroke-width':1+3*a,opacity:.3+.7*a});}
    if(!game.stops.some(s=>same(s.cell,o.cell))){
      out+=rect(hx-19,hy-53,38,29,C.card,h.home?C.amber:C.edge);
      out+=text(hx,hy-32,`${h.home}`,17,h.home?C.amber:C.muted,{'text-anchor':'middle','font-weight':700});
      out+=text(hx,hy-60,'在家',12,C.muted,{'text-anchor':'middle'});
    }
    let content=rect(x,y,w,height,C.card,h.activeTotal&&h.activeRemaining?C.amber:C.edge,{class:'card-frame'});
    content+=text(tx,y+23,o.name,17,C.ink,{'font-weight':700});
    content+=text(x+w-12,y+23,`全局 ${h.total} 人`,13,C.muted,{'text-anchor':'end'});
    content+=text(tx,y+48,`未出發 ${h.future+h.home} · 在家 ${h.home}`,17,C.ink,{'font-weight':700});
    if(h.active>=0)content+=text(tx,y+69,`第 ${h.active+1} 批 ${h.activeTotal} 人 · 尚未離家 ${h.activeRemaining}`,14,h.activeRemaining?C.amber:C.muted);
    else content+=text(tx,y+69,h.firstDrive!==null?`在家考慮 ${h.home} 人 · 最早自駕 ${fmt(h.firstDrive)}`:game.done?`未完成 ${h.missed} 人`:h.next<0?'八批已全數出發':'等下一批，先看位置與班距。',13,C.muted);
    content+=text(tx,y+89,h.next>=0?`下一批 ${h.next+1}：${h.nextCount} 人 · ${fmt(h.nextIn)} 後`:'沒有後續批次',14,C.blue);
    if(hover){const steps=dist(o.cell,hover),appeal=1/(1+(steps/P.spread)**2);content+=text(tx,y+111,`本站步行 ${steps*P.walkStep} 秒 · 距離吸引${appeal>.7?'強':appeal>.35?'中':'弱'}`,15,C.green);}
    else content+=text(tx,y+111,`去站 ${h.walking} · 排隊 ${h.queue} · 返家 ${h.returning}`,14,C.muted);
    content+=text(tx,y+132,`送達 ${h.delivered} · 自駕 ${h.cars} · 車上 ${h.seated+h.aboard}`,14,h.cars?C.red:C.muted);
    if(i===3)content+=text(tx,y+151,'點卡查看八批人數',12,C.muted);
    const recent=game.events.filter(e=>e.type==='car'&&e.origin===i&&game.t-e.time<18).length;
    if(recent)content+=text(hx+23,hy-30,`自駕 ＋${recent}`,14,C.red,{'font-weight':700});
    out+=svg('g',{class:'house-card','data-house':i,role:'button',tabindex:0,'aria-label':`${o.name}：全局${h.total}人，未出發${h.future+h.home}人，下一批${h.nextCount}人，查看八批需求`},content);
    return out;
  }
  function drawMap(){
    // Do not replace a focused SVG node between pointer-down and click.
    if(pointerPressed&&!drag?.moved)return;
    const focused=document.activeElement,attrs=['data-cell','data-stop','data-house'];
    const focusAttr=attrs.find(a=>focused?.hasAttribute(a)),focusVal=focusAttr?focused.getAttribute(focusAttr):null;
    let out='';
    for(let x=0;x<10;x++)for(let y=0;y<7;y++){const [cx,cy]=xy([x,y]);out+=rect(cx-35,cy-27.5,70,55,C.card,'#e8e7d9',{rx:0,'stroke-width':.6});}
    for(const c of D.roads)for(const n of [[c[0]+1,c[1]],[c[0],c[1]+1]])if(D.roads.some(q=>same(q,n)))out+=svg('path',{d:pathStr([c,n]),stroke:C.edge,'stroke-width':18,fill:'none','stroke-linecap':'round'});
    for(const c of D.roads)for(const n of [[c[0]+1,c[1]],[c[0],c[1]+1]])if(D.roads.some(q=>same(q,n)))out+=svg('path',{d:pathStr([c,n]),stroke:C.card,'stroke-width':13,fill:'none','stroke-linecap':'round'});
    const active=game.stops[selected];
    if(active.cell)out+=svg('path',{d:pathStr(route(active.cell,D.hub)),stroke:colors[selected],'stroke-width':3,fill:'none',opacity:.3});
    if(hover)out+=svg('path',{d:pathStr(route(hover,D.hub)),stroke:C.green,'stroke-width':3,fill:'none','stroke-dasharray':'5 5',opacity:.6});
    const [mx,my]=xy(D.hub);
    out+=rect(mx-23,my-22,46,44,C.deep,C.deep);
    out+=text(mx,my+7,'M',24,C.card,{'text-anchor':'middle'});
    out+=text(mx+32,my-11,'朗屏港鐵',18,C.deep,{'font-weight':700});
    out+=text(mx+32,my+9,`已接上 ${game.delivered} 人`,14,C.green);
    out+=text(mx+32,my+28,'固定終點 · 下車才得分',11,C.muted);
    for(const c of D.candidates){
      if(game.stops.some(s=>same(s.cell,c)))continue;
      const [x,y]=xy(c);
      out+=svg('g',{class:'candidate','data-cell':c.join(','),role:'button',tabindex:0,'aria-label':`放置接駁站於 ${c[0]+1} 列 ${c[1]+1} 行`},svg('circle',{cx:x,cy:y,r:14,fill:C.card,stroke:hover&&same(hover,c)?C.green:C.edge,'stroke-width':2})+text(x,y+6,'＋',20,C.muted,{'text-anchor':'middle'}));
    }
    for(const s of game.stops){if(!s.cell)continue;
      const [x,y]=xy(s.cell),build=Math.max(0,s.ready-game.t),color=colors[s.id];
      let content=rect(x-19,y-17,38,34,build?C.card:color,selected===s.id?C.ink:color,{'stroke-width':selected===s.id?3:1,'stroke-dasharray':build?'4 3':'none'});
      content+=text(x,y+6,letters[s.id],20,build?color:C.card,{'text-anchor':'middle','font-weight':700});
      content+=text(x,y+34,game.done?'已結束':build?`重建 ${Math.ceil(build)}s`:game.started?`發車 ${fmt(game.eta(s))}`:`班距 ${game.headway(s)}s`,13,color,{'text-anchor':'middle'});
      content+=text(x,y-38,s.queue.length===8?`滿8 · 座${s.boarding.length}`:`座${s.boarding.length} · 隊${s.queue.length}`,14,s.queue.length===8?C.red:color,{'text-anchor':'middle','font-weight':700});
      for(let j=0;j<8;j++)content+=rect(x-27+j*7,y-30,5,7,j<s.queue.length?(s.queue.length===8?C.red:color):C.card,s.queue.length===8?C.red:color,{rx:1});
      out+=svg('g',{class:'stop','data-stop':s.id,role:'button',tabindex:0,'aria-label':`選擇接駁站 ${letters[s.id]}，已入座${s.boarding.length}人，排隊${s.queue.length}人`},content);
    }
    for(const p of game.people)if(['walk','return'].includes(p.state)){
      const [x,y]=xy(game.pos(p)),offset=(p.id%3-1)*5;
      out+=svg('circle',{cx:x+offset,cy:y+9,r:3.8,fill:p.state==='walk'?C.blue:C.amber,stroke:C.card,'stroke-width':1});
    }
    for(const b of game.trips.filter(b=>!b.done)){
      const pos=along(b.path,game.t-b.since,P.busStep),[x,y]=xy(pos),color=colors[b.stop];
      // The arrow uses the current segment, and the trip never changes its path.
      const progress=(game.t-b.since)/P.busStep,index=Math.min(b.path.length-2,Math.floor(progress)),a=b.path[index],z=b.path[index+1];
      const angle=Math.atan2((z[1]-a[1])*55,(z[0]-a[0])*70)*180/Math.PI;
      out+=svg('path',{d:pathStr(b.path),fill:'none',stroke:color,'stroke-width':2,opacity:.2});
      out+=rect(x-27,y-17,54,25,C.card,color,{'stroke-width':2});
      out+=text(x,y,`${letters[b.stop]}車 ${b.load.length}`,13,color,{'text-anchor':'middle','font-weight':700});
      out+=svg('path',{d:`M${x-4} ${y+13}l9 0-4-4m4 4-4 4`,stroke:color,fill:'none','stroke-width':2,transform:`rotate(${angle} ${x} ${y+13})`});
      out+=text(x,y-24,'送往港鐵',11,color,{'text-anchor':'middle'});
    }
    out+=drawPanel();
    const w=game.waveInfo();
    out+=text(20,225,w.active>=0?`第 ${w.active+1} 批正在離家 · 全圖 30 人，30 秒內陸續出發`:w.next>=0?`下一批 ${w.next+1} · 全圖 30 人 · ${fmt(w.nextStart-game.t)} 後`:game.done?'觀察結束 · 查看各住宅的送達與自駕':'八批已離家 · 繼續接上在路上的乘客',15,w.active>=0?C.amber:C.deep,{'font-weight':700});
    out+=text(20,251,'● 去站　● 返家　　在家 → 入座／排隊 → 巴士 → 港鐵',12,C.muted);
    out+=svg('circle',{cx:24,cy:247,r:3.5,fill:C.blue});out+=svg('circle',{cx:81,cy:247,r:3.5,fill:C.amber});
    for(let i=0;i<D.origins.length;i++)out+=drawHouse(i);
    $('board').innerHTML=out;
    if(focusAttr){restoringFocus=true;try{$('board').querySelector(`[${focusAttr}="${focusVal}"]`)?.focus({preventScroll:true});}finally{restoringFocus=false;}}
  }
  function render(){
    const stats=game.stats(),w=game.waveInfo(),focusSelect=document.activeElement?.getAttribute('data-select');
    $('goal').textContent=`目標 ${P.target} · 高分 ${P.highScore}`;$('score').textContent=`${stats.delivered} / 240`;$('cars').textContent=`${stats.cars} 人`;
    $('clock').textContent=`${fmt(game.t)} / 18:00`;$('moves').textContent=`${game.moves} 次`;
    $('wave').textContent=!game.started?'第一批：開局後 35 秒':game.done?`未完成 ${game.missed} 人`:w.active>=0?`第 ${w.active+1}/8 批正在離家`:w.next>=0?`第 ${w.next+1}/8 批：${fmt(w.nextStart-game.t)} 後`:'所有批次已出發';
    $('start').textContent=game.done?'本局已結束':game.started?(playing?'暫停':'繼續'):'開始觀察';
    $('start').disabled=game.done||(!game.started&&game.stops.some(s=>!s.cell));$('preset').hidden=game.started;$('speed').value=speed;
    $('mapHint').textContent=game.done?'本局已結束，點住宅卡查看批次。':game.started?`${playing?'運行中':'已暫停'} · 選 ${letters[selected]} 站，再點 ＋ 搬站（餘 ${game.moves} 次）`:`正在放置 ${letters[selected]} 站 · 懸停 ＋ 預覽；點擊放置`;
    $('stations').innerHTML=game.stops.map(s=>`<button class="station-button ${s.id===selected?'selected':''}" data-select="${s.id}" aria-pressed="${s.id===selected}"><b>${letters[s.id]} 站</b><small>${s.cell?`入座 ${s.boarding.length} · 排隊 ${s.queue.length}`:'未放置'}</small></button>`).join('');
    drawMap();if(focusSelect)$('stations').querySelector(`[data-select="${focusSelect}"]`)?.focus({preventScroll:true});
    if(game.done&&!shown){shown=true;playing=false;$('resultTitle').textContent=game.delivered>=P.highScore?'達成高分挑戰':game.delivered>=P.target?'本局達成觀察目標':'18 分鐘觀察結束';
      $('resultScore').textContent=`送達 ${game.delivered} · 自駕 ${game.cars} · 未完成 ${game.missed}`;
      $('resultBreakdown').innerHTML=D.origins.map((o,i)=>{const h=game.homeStats(i);return `<div class="result-row"><span>${o.name} · ${h.total} 人</span><span>送達 ${h.delivered}／自駕 ${h.cars}／未完成 ${h.missed}</span></div>`}).join('');
      const full=game.events.filter(e=>e.type==='full').length,wait=game.events.filter(e=>e.why==='久候返家').length;
      $('resultHint').textContent=`本局滿員返家 ${full} 人次、久候返家 ${wait} 人次，搬站 ${game.commands.length} 次。返家次數可包含同一人重試；未完成指觀察結束時尚未送達。保存紀錄可對照你覺得太快、太慢或難以判斷的時段。`;
      $('result').showModal();
    }
  }
  function reset(){game=new Game();selected=0;playing=false;speed=1;shown=false;hover=null;last=performance.now();note('布局不限時。每次重開使用同一份需求與乘客意願，方便對照。');render();}
  function pauseForInfo(){if(playing){playing=false;render();note('查看說明時已暫停，關閉後點繼續。');}}
  function showHouse(i){pauseForInfo();$('houseTitle').textContent=D.origins[i].name+' · 八批出發表';$('houseWaves').innerHTML=`<table><thead><tr><th>批次</th><th>開始離家</th><th>此住宅人數</th></tr></thead><tbody>${D.waves.map((wave,j)=>`<tr><td>第 ${j+1} 批</td><td>${fmt(P.firstWave+j*P.interval)} ～ ${fmt(P.firstWave+j*P.interval+P.release)}</td><td>${wave[i]} 人</td></tr>`).join('')}</tbody></table>`;$('houseInfo').showModal();}
  $('stations').onclick=e=>{const el=e.target.closest('[data-select]');if(el){selected=+el.dataset.select;render();}};
  function pointCell(e){const point=$('board').createSVGPoint();point.x=e.clientX;point.y=e.clientY;const p=point.matrixTransform($('board').getScreenCTM().inverse());return D.candidates.find(c=>{const [x,y]=xy(c);return Math.hypot(p.x-x,p.y-y)<20&&!game.stops.some(s=>same(s.cell,c));});}
  function pointStop(e){const point=$('board').createSVGPoint();point.x=e.clientX;point.y=e.clientY;const p=point.matrixTransform($('board').getScreenCTM().inverse());return game.stops.find(s=>{if(!s.cell)return false;const [x,y]=xy(s.cell);return Math.hypot(p.x-x,p.y-y)<21;});}
  $('board').onclick=e=>{if(drag?.moved)return;const stop=e.target.closest('[data-stop]'),house=e.target.closest('[data-house]'),cell=e.target.closest('[data-cell]');if(stop){selected=+stop.dataset.stop;render();}else if(house)showHouse(+house.dataset.house);else{const c=cell?cell.dataset.cell.split(',').map(Number):pointCell(e);if(c)put(c);}};
  $('board').onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();const s=e.target.closest('[data-stop]'),c=e.target.closest('[data-cell]'),h=e.target.closest('[data-house]');if(s){selected=+s.dataset.stop;render();}else if(c)put(c.dataset.cell.split(',').map(Number));else if(h)showHouse(+h.dataset.house);}};
  $('board').onpointermove=e=>{if(drag&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>5)drag.moved=true;const c=pointCell(e)||null;if(JSON.stringify(c)!==JSON.stringify(hover)){hover=c;drawMap();}};
  $('board').onpointerleave=()=>{if(!drag){hover=null;drawMap();}};
  $('board').onpointerdown=e=>{pointerPressed=true;const el=e.target.closest('[data-stop]'),s=el?game.stops[+el.dataset.stop]:pointStop(e);if(s){selected=s.id;drag={x:e.clientX,y:e.clientY,moved:false};$('board').setPointerCapture(e.pointerId);render();}};
  $('board').onpointerup=()=>{pointerPressed=false;if(drag?.moved&&hover)put(hover);const moved=drag?.moved;drag=null;hover=null;if(moved)render();};
  document.addEventListener('pointerup',()=>{pointerPressed=false;requestAnimationFrame(()=>drawMap());});
  $('board').onpointercancel=()=>{pointerPressed=false;drag=null;hover=null;render();};
  $('board').addEventListener('focusin',e=>{if(restoringFocus)return;const c=e.target.closest('[data-cell]'),next=c?c.dataset.cell.split(',').map(Number):null;if(JSON.stringify(next)!==JSON.stringify(hover)){hover=next;drawMap();}});
  $('preset').onclick=()=>{[0,7,11].forEach((i,id)=>game.place(id,D.candidates[i]));selected=0;note('試放住宅附近的三座站。這份布局會出現排隊壓力，仍可自由改位置。');render();};
  $('start').onclick=()=>{if(!game.started&&!game.start())return;playing=!playing;last=performance.now();note(playing?'觀察開始。住宅卡顯示本批與下一批；車站倒數歸零才發車。':'已暫停，能細看住宅批次與排隊；搬站仍扣次數。');render();};
  $('speed').onchange=()=>{speed=+$('speed').value;note(`觀察速度 ${speed}×。遊戲規則時間不變；1× 是完整 18 分鐘。`);render();};
  $('reset').onclick=()=>{if(game.started&&!game.done&&!confirm('重開會清除本局進度，是否重開？'))return;reset();};
  $('help').onclick=()=>{pauseForInfo();$('info').showModal();};
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  $('again').onclick=()=>{$('result').close();reset();};
  $('download').onclick=()=>{const run={version:'scheduled-feeder-long-2026-10-06',seed:game.seed,parameters:P,stats:game.stats(),stops:game.stops.map(s=>({id:s.id,cell:s.cell,peak:s.peak,rejected:s.rejected})),moves:game.commands,events:game.events};const url=URL.createObjectURL(new Blob([JSON.stringify(run,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='TransitLab-本局观察记录.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  $('source').textContent=D.source.geography+' '+D.source.demand;
  document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]')||e.target.tagName==='SELECT')return;if(['1','2','3'].includes(e.key)){selected=+e.key-1;render();}else if(e.code==='Space'&&e.target===document.body){e.preventDefault();if(game.started&&!game.done){playing=!playing;last=performance.now();render();}}});
  document.addEventListener('visibilitychange',()=>{last=performance.now();if(document.hidden&&playing){playing=false;note('離開畫面時已自動暫停。');render();}});
  function frame(now){const dt=Math.min(.5,(now-last)/1000);last=now;if(playing)game.advance(dt*speed);if(playing&&now-lastDraw>120){render();lastDraw=now;}requestAnimationFrame(frame);}
  render();requestAnimationFrame(frame);
})();
