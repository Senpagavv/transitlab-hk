(function(root) {
  'use strict';
  // v7 mode 3 · AI demo (temporary; remove this file, demo-plans.js and the lines marked «AI demo» in index.html and
  // build.py). Pick a score line — pass, high or master — and the AI builds its plan in the real game: the line cell by
  // cell, each station with what it serves, the trains with why, the roads it relieves; then it opens the line and the
  // years play. Plans: bots/v7_roads.js --write.
  const $=id=>document.getElementById(id),I=root.I18N,t=(k,v)=>I.t(k,v),L=I.L,M=root.Roads,{D,P,G,walk,same}=M;
  I.add({
    'demo.btn':L('AI 示範','AI 示范','AI demo'),
    'demo.h':L('看 AI 怎樣建這條線','看 AI 怎样建这条线','Watch the AI build its line'),
    'demo.intro':L('選一條分數線，AI 會在棋盤上一步一步建它的新線：先畫線，再一個一個放站、買車，每一步寫著為什麼；然後開通，看八年裡路怎樣變。','选一条分数线，AI 会在棋盘上一步一步建它的新线：先画线，再一个一个放站、买车，每一步写着为什么；然后开通，看八年里路怎样变。',
      'Pick a score line: the AI builds its line step by step — the line, then each station and train, with why — then opens it, and you watch the roads over eight years.'),
    'demo.pass':L('過關','过关','Pass'),'demo.high':L('高分','高分','High score'),'demo.master':L('大師','大师','Master'),
    'demo.line':L('分數線 {n} · AI 這套 {s}','分数线 {n} · AI 这套 {s}','line {n} · this plan {s}'),
    'demo.shape':L('線 {l} 格 · {s} 個站 · {t} 列車','线 {l} 格 · {s} 个站 · {t} 列车','{l} cells · {s} stations · {t} trains'),
    'demo.go':L('看這一套 ▶','看这一套 ▶','Watch ▶'),
    'demo.box':L('AI 示範 · {tier}（{n}）','AI 示范 · {tier}（{n}）','AI demo · {tier} ({n})'),'demo.stop':L('停止示範','停止示范','Stop'),
    'demo.s1':L('<b>① 畫線</b>：{via}。線 {l} 格，花 {c}。','<b>① 画线</b>：{via}。线 {l} 格，花 {c}。','<b>① The line</b>: {via}. {l} cells, {c} spent.'),
    'demo.st':L('<b>② 放站 {n}</b>：{where}。','<b>② 放站 {n}</b>：{where}。','<b>② Station {n}</b>: {where}.'),
    'demo.stPot':L('大家都知道、路也穩定以後：新線每天 <b>{r}</b> 人坐，路上塞車 {j}（什麼都不做 {n}）。','大家都知道、路也稳定以后：新线每天 <b>{r}</b> 人坐，路上塞车 {j}（什么都不做 {n}）。',
      'Once everyone knows and the roads settle: <b>{r}</b> a day on the line, jam {j} (do nothing {n}).'),
    'demo.door':L('就在{a}門口','就在{a}门口','right at {a}'),
    'demo.next':L('在{a}旁邊 1 格（走路 {w}）','在{a}旁边 1 格（走路 {w}）','one cell from {a} (walk {w})'),
    'demo.plain':L('線上一格，接{a}（走 {c} 格）','线上一格，接{a}（走 {c} 格）','on the line, for {a} ({c} cells\' walk)'),
    'demo.change':L('，和{l}的{s}站換綫','，和{l}的{s}站换线',', changing with the {l} at {s}'),
    'demo.tr2':L('<b>③ 買列車</b>：路穩定以後，新線最擠的一段每天約 <b>{l}</b> 人；1 列只載 {c}，所以一共買 {n} 列（每段 {cap}）。擠了大家會慢慢回到路上。','<b>③ 买列车</b>：路稳定以后，新线最挤的一段每天约 <b>{l}</b> 人；1 列只载 {c}，所以一共买 {n} 列（每段 {cap}）。挤了大家会慢慢回到路上。',
      '<b>③ Trains</b>: once settled, the busiest section carries about <b>{l}</b> a day; one train holds {c}, so {n} in all ({cap} a section). Crowded trains send people slowly back to the roads.'),
    'demo.tr1':L('<b>③ 列車</b>：新線最擠的一段約 {l} 人，1 列（{c}）就夠，錢留給線和站。','<b>③ 列车</b>：新线最挤的一段约 {l} 人，1 列（{c}）就够，钱留给线和站。','<b>③ Trains</b>: the busiest section reaches about {l}; one train ({c}) is enough, the money goes to line and stations.'),
    'demo.why':L('<b>④ 這一套的想法</b>','<b>④ 这一套的想法</b>','<b>④ The idea</b>'),
    'demo.wDoor':L('{n} 個站有 {d} 個就在屋苑、商貿區門口，或者能換綫：這裡走路每格算 {w}，離門口一格每趟就貴 {w} 格。','{n} 个站有 {d} 个就在屋苑、商贸区门口，或者能换线：这里走路每格算 {w}，离门口一格每趟就贵 {w} 格。',
      '{d} of the {n} stations sit at an estate, a business area, or a change: walking is {w} a cell here, so one cell off costs every trip {w}.'),
    'demo.wRoad':L('最受惠的路：{list}（每趟多花的格數，什麼都不做 → 這一套穩定以後）。','最受惠的路：{list}（每趟多花的格数，什么都不做 → 这一套稳定以后）。','Roads relieved most: {list} (extra blocks a trip, do nothing → this plan settled).'),
    'demo.road':L('{r} {a}→{b}','{r} {a}→{b}','{r} {a}→{b}'),
    'demo.wBack':L('路通了，開車又變好走：會有人回去開車，所以塞車先降、後回升一點，最後停在中間。','路通了，开车又变好走：会有人回去开车，所以塞车先降、后回升一点，最后停在中间。','Clear roads make driving easy again: some go back to the car, so the jam falls, creeps back a little, and settles in between.'),
    'demo.wSkip':L('離站遠的屋苑：{list}——預算 {b} 只夠這麼多。','离站远的屋苑：{list}——预算 {b} 只够这么多。','Far from a station: {list} — a budget of {b} only goes so far.'),
    'demo.far':L('{a}（走 {c} 格）','{a}（走 {c} 格）','{a} ({c} cells)'),
    'demo.wLeft':L('還剩 {m} 沒用。','还剩 {m} 没用。','{m} left unspent.'),
    'demo.open':L('<b>⑤ 開通</b>：第 1 年只有 {s} 成人知道新線。看路怎樣慢慢變通。','<b>⑤ 开通</b>：第 1 年只有 {s} 成人知道新线。看路怎样慢慢变通。','<b>⑤ Open</b>: in year 1 only {s}/10 know the line. Watch the roads clear, slowly.'),
    'demo.year':L('第 {y} 年：塞車 <b>{j}</b>（什麼都不做 {n}）· 開車 {c} 人 · 新線 {r} 人 · 累計少塞 {t}','第 {y} 年：塞车 <b>{j}</b>（什么都不做 {n}）· 开车 {c} 人 · 新线 {r} 人 · 累计少塞 {t}',
      'Year {y}: jam <b>{j}</b> (do nothing {n}) · {c} drive · {r} on the line · {t} so far'),
    'demo.done':L('完成：八年少塞 <b>{t}</b>（{tier} 線 {n}）。按「↺ 回到規劃」可以在這套上面自己改。','完成：八年少塞 <b>{t}</b>（{tier} 线 {n}）。按「↺ 回到规划」可以在这套上面自己改。',
      'Done: <b>{t}</b> less jam over eight years ({tier} line {n}). «↺ Back to planning» to edit it yourself.')
  });
  const css=document.createElement('style');css.textContent=`
  #demoDlg .dcards{display:grid;gap:10px;margin:14px 0}
  #demoDlg .dcard{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:4px 14px;text-align:left;padding:12px 14px;border:1px solid var(--s-line2);border-radius:8px;background:var(--s-panel);color:var(--s-ink);cursor:pointer;font:inherit}
  #demoDlg .dcard:hover{border-color:var(--s-metro)}
  #demoDlg .dcard b{font-size:16px;color:var(--s-metro);grid-row:span 2}
  #demoDlg .dcard span{font-size:13.5px}#demoDlg .dcard small{font-size:12px;color:var(--s-ink3)}
  #demoDlg .dcard em{font-style:normal;grid-row:span 2;font-size:13px;color:var(--s-metro)}
  .demobox{position:absolute;left:16px;right:16px;top:12px;max-height:200px;overflow:hidden;padding:10px 14px 12px;border-radius:8px;background:var(--s-panel);border:1.5px solid var(--s-accent);
    box-shadow:0 6px 24px rgb(0 0 0 / .12);font-size:13px;line-height:1.6;color:var(--s-ink2);z-index:5}
  .demobox .dh{display:flex;align-items:center;gap:8px;margin-bottom:6px}.demobox .dh b{color:var(--s-accent);font-size:13.5px}.demobox .dh .sp{flex:1}
  .demobox p{margin:3px 0}.demobox p b{color:var(--s-ink)}.demobox ul{margin:4px 0 0;padding-left:18px}.demobox li{margin:2px 0}
  .demobox p.old{opacity:.5}
  .mapplate.demo .clockbox,.mapplate.demo .lanebox{display:none}`;
  document.head.append(css);
  const sleep=ms=>new Promise(r=>{const id=setTimeout(r,ms);timers.push(id);});
  let timers=[],run=0,watch=0;
  const plans=()=>(root.TL_ROADS_DEMO||{})[D.map];
  const btn=document.createElement('button');btn.className='btn btn-sm';btn.id='demoBtn';
  $('lvInfo').after(btn);
  const dlg=document.createElement('dialog');dlg.id='demoDlg';document.body.append(dlg);
  const box=document.createElement('div');box.className='demobox';box.hidden=true;document.querySelector('.mapplate').append(box);
  const nm=o=>I.lang==='zh-Hans'?(o.hans||o.name):o.name;
  const names=()=>[...D.origins.map((o,i)=>({cell:o.cell,name:nm(o),estate:i})),...D.destinations.map(d=>({cell:d.cell,name:nm(d),dest:true}))];
  const stationsThere=()=>G.lines.flatMap(l=>l.stations.map((s,j)=>({cell:s,line:I.lang==='zh-Hans'?(l.hans||l.name):l.name,name:(I.lang==='zh-Hans'?l.namesHans:l.names)[j]})));
  const tierName=k=>t('demo.'+k);
  function texts(){btn.textContent=t('demo.btn');const pl=plans();if(!pl){btn.hidden=true;return;}
    dlg.innerHTML=`<button class="close" data-x>×</button><span class="lbl">AI DEMO</span><h2 class="h1">${t('demo.h')}</h2><p class="note">${t('demo.intro')}</p><div class="dcards">`+
      ['pass','high','master'].filter(k=>pl[k]).map((k,j)=>{const p=pl[k];return `<button class="dcard" data-tier="${k}"><b>${tierName(k)}</b><span>${t('demo.line',{n:pl.tiers[j],s:p.score})}</span><em>${t('demo.go')}</em>`+
        `<small>${t('demo.shape',{l:p.line.length,s:p.stations.length,t:p.trains})}</small></button>`;}).join('')+'</div>';
    dlg.querySelector('[data-x]').onclick=()=>dlg.close();
    dlg.querySelectorAll('[data-tier]').forEach(b=>b.onclick=()=>{dlg.close();play(b.dataset.tier);});}
  btn.onclick=()=>{texts();dlg.showModal();};
  function stopDemo(keepBox){run++;timers.forEach(clearTimeout);timers=[];clearInterval(watch);$('board').style.pointerEvents='';document.querySelector('.mapplate').classList.remove('demo');if(!keepBox)box.hidden=true;}
  function say(html,alone){const body=box.querySelector('.dbody');if(alone)body.innerHTML='';
    body.querySelectorAll('p').forEach(p=>p.classList.add('old'));const p=document.createElement('p');p.innerHTML=html;body.append(p);
    while(body.children.length>2)body.firstChild.remove();}
  async function play(k){
    stopDemo();const me=run,pl=plans(),plan=pl[k],j=['pass','high','master'].indexOf(k),api=TL_ROADS.api,n0=Math.round(G.doNothing[0]);
    for(const d of document.querySelectorAll('dialog[open]'))d.close();
    box.hidden=false;box.innerHTML=`<div class="dh"><b>${t('demo.box',{tier:tierName(k),n:pl.tiers[j]})}</b><span class="sp"></span><button class="btn btn-sm" data-stop>${t('demo.stop')}</button></div><div class="dbody"></div>`;
    box.querySelector('[data-stop]').onclick=()=>stopDemo();
    $('board').style.pointerEvents='none';document.querySelector('.mapplate').classList.add('demo');api.reset();
    const live=()=>me===run;
    // ① the line, cell by cell
    const places=names(),there=stationsThere(),onLine=places.map(x=>({...x,at:plan.line.findIndex(c=>walk(c,x.cell)<=1)})).filter(x=>x.at>=0).sort((a,b)=>a.at-b.at);
    say(t('demo.s1',{via:onLine.map(x=>x.name).join(' → ')||'—',l:plan.line.length,c:plan.line.length*P.lineCost}));
    for(const c of plan.line){if(!live())return;api.extend(c);await sleep(70);}
    await sleep(700);
    // ② stations, in line order, each with what it serves
    const order=plan.stations.map(s=>({s,x:plan.line.findIndex(c=>same(c,s))})).sort((a,b)=>a.x-b.x);
    for(const [n,{s}] of order.entries()){if(!live())return;api.station(s);
      const near=places.map(x=>({...x,d:walk(x.cell,s)})).sort((a,b)=>a.d-b.d)[0],chg=there.find(x=>walk(x.cell,s)<=1);
      let where=near.d===0?t('demo.door',{a:near.name}):near.d===1?t('demo.next',{a:near.name,w:P.walkPer}):t('demo.plain',{a:near.name,c:near.d});
      if(chg)where+=t('demo.change',{l:chg.line,s:chg.name});
      let extra='';if(api.plan.stations.length>=2){const pot=api.plan.potential();extra=' '+t('demo.stPot',{r:Math.round(pot.onNew),j:Math.round(pot.jam),n:n0});}
      say(t('demo.st',{n:n+1,where})+extra);await sleep(1500);}
    // ③ trains
    for(let n=1;n<plan.trains;n++){if(!live())return;api.train();}
    const pot=api.plan.potential(),mine=pot.lines.find(l=>l.isNew),load=Math.round(Math.max(...mine.load));
    say(plan.trains>1?t('demo.tr2',{l:load,c:P.perTrain,n:plan.trains,cap:plan.trains*P.perTrain}):t('demo.tr1',{l:load,c:P.perTrain}));await sleep(2200);
    if(!live())return;
    // ④ the idea
    const why=[],good=plan.stations.filter(s=>places.some(x=>same(x.cell,s))||there.some(x=>walk(x.cell,s)<=1)).length;
    why.push(t('demo.wDoor',{n:plan.stations.length,d:good,w:P.walkPer}));
    const roads=D.roads.map(r=>{const ids=G.sections.filter(s=>s.roads.includes(r.name)).map(s=>s.id),mx=a=>Math.max(...ids.map(id=>a[id]));return{r:nm(r),a:mx(G.base.extra),b:mx(pot.extra)};})
      .filter(x=>x.a-x.b>.1).sort((x,y)=>(y.a-y.b)-(x.a-x.b)).slice(0,3);
    if(roads.length)why.push(t('demo.wRoad',{list:roads.map(x=>t('demo.road',{r:x.r,a:x.a.toFixed(1),b:x.b.toFixed(1)})).join(t('sep'))}));
    why.push(t('demo.wBack'));
    const served=x=>plan.stations.some(s=>walk(s,x.cell)<=1);
    const skip=places.filter(x=>x.estate!==undefined&&!served(x)).map(x=>t('demo.far',{a:x.name,c:Math.min(...plan.stations.map(s=>walk(s,x.cell)))}));
    if(skip.length)why.push(t('demo.wSkip',{list:skip.join(t('sep')),b:P.budget}));
    if(api.plan.money>0)why.push(t('demo.wLeft',{m:api.plan.money}));
    say(t('demo.why')+'<ul>'+why.map(s=>`<li>${s}</li>`).join('')+'</ul>',true);await sleep(6000);
    if(!live())return;
    // ⑤ open: the years play
    say(t('demo.open',{s:Math.round(P.aware.start*10)}));await sleep(1200);if(!live())return;
    api.go();let seen=0,phaseActionsStarted=false;
    watch=setInterval(()=>{if(!live()){clearInterval(watch);return;}const p=api.plan,l=p.log.at(-1);
      if(p.year>seen&&l){seen=p.year;say(t('demo.year',{y:l.year,j:Math.round(l.jam),n:Math.round(l.jam0),c:Math.round(l.drivers),r:Math.round(l.onNew),t:Math.round(p.total)}));}
      if(p.phase===2&&p.year===4&&!p.phase2Committed&&!phaseActionsStarted){phaseActionsStarted=true;(async()=>{say(t('r3.phase2Map',{b:P.phase2Budget}));await sleep(1200);for(const a of plan.phase2||[]){if(!live())return;if(a.type==='extend')api.extend(a.cell);else if(a.type==='station')api.station(a.cell);else if(a.type==='train')api.train();await sleep(550);}if(live())api.continue();})();}
      if(p.done){clearInterval(watch);say(t('demo.done',{t:Math.round(p.total),tier:tierName(k),n:pl.tiers[j]}));stopDemo(true);}},250);
  }
  window.addEventListener('tl:lang',texts);
  texts();
  root.TL_ROADS_DEMO_PLAY=play;
})(typeof window!=='undefined'?window:globalThis);
