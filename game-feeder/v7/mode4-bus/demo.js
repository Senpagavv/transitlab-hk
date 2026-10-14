(function(root) {
  'use strict';
  // v7 mode 4 · AI demo (temporary; remove this file, demo-plans.js and the lines marked «AI demo» in index.html and
  // build.py). Pick a score line and the AI builds its bus network in the real game: each route along the roads, its
  // stops (what they serve), its buses (and the wait they give), the bus lanes with why; then the years play.
  // Plans: bots/v7_bus.js --write (the same plan every year).
  const $=id=>document.getElementById(id),I=root.I18N,t=(k,v)=>I.t(k,v),L=I.L,M=root.Bus,{D,P,G,walk,same,sectionBetween}=M;
  const RL=['A','B','C'];
  I.add({
    'demo.btn':L('AI 示範','AI 示范','AI demo'),
    'demo.h':L('看 AI 怎樣排巴士','看 AI 怎样排巴士','Watch the AI plan its buses'),
    'demo.intro':L('選一條分數線，AI 會在地圖上一步一步排它的巴士：畫線、放站、加車、劃專線，每一步寫著為什麼；然後播放八年。這一套每年都一樣（你自己玩的時候可以每年改）。','选一条分数线，AI 会在地图上一步一步排它的巴士：画线、放站、加车、划专线，每一步写着为什么；然后播放八年。这一套每年都一样（你自己玩的时候可以每年改）。',
      'Pick a score line: the AI lays out its buses step by step — routes, stops, buses, lanes — with why; then eight years play. It keeps the same plan every year (you may change yours).'),
    'demo.pass':L('過關','过关','Pass'),'demo.high':L('高分','高分','High score'),'demo.master':L('大師','大师','Master'),
    'demo.line':L('分數線 {n} · AI 這套 {s}','分数线 {n} · AI 这套 {s}','line {n} · this plan {s}'),
    'demo.shape':L('{r} 條線 · {b} 輛巴士 · {l} 條專線','{r} 条线 · {b} 辆巴士 · {l} 条专线','{r} routes · {b} buses · {l} lanes'),
    'demo.go':L('看這一套 ▶','看这一套 ▶','Watch ▶'),
    'demo.box':L('AI 示範 · {tier}（{n}）','AI 示范 · {tier}（{n}）','AI demo · {tier} ({n})'),'demo.stop':L('停止示範','停止示范','Stop'),
    'demo.route':L('<b>① {r} 線</b>：沿路從{a}到{b}，{l} 格。','<b>① {r} 线</b>：沿路从{a}到{b}，{l} 格。','<b>① Route {r}</b>: along the roads from {a} to {b}, {l} cells.'),
    'demo.stops':L('<b>② 站</b>：{list}。','<b>② 站</b>：{list}。','<b>② Stops</b>: {list}.'),
    'demo.door':L('{a}門口','{a}门口','at {a}'),'demo.change':L('{s}站（換{l}）','{s}站（换{l}）','{s} (change to the {l})'),'demo.near':L('{a}旁邊','{a}旁边','next to {a}'),'demo.plain':L('路邊一站','路边一站','a roadside stop'),
    'demo.buses':L('<b>③ 巴士</b>：{b} 輛，等車 {w} 格。','<b>③ 巴士</b>：{b} 辆，等车 {w} 格。','<b>③ Buses</b>: {b}, a wait of {w}.'),
    'demo.lane':L('<b>④ 專線</b>：{r}。這條路上的巴士不塞；車只剩 {p} 成路。','<b>④ 专线</b>：{r}。这条路上的巴士不塞；车只剩 {p} 成路。','<b>④ Bus lane</b>: {r}. Buses there skip the jam; cars keep {p}/10 of it.'),
    'demo.noLane':L('<b>④ 專線</b>：這一套不劃專線——塞的路上巴士不多，劃了只會讓車更塞。','<b>④ 专线</b>：这一套不划专线——塞的路上巴士不多，划了只会让车更塞。','<b>④ Bus lanes</b>: none — few buses on the jammed roads; a lane would only jam the cars.'),
    'demo.why':L('<b>⑤ 這一套的想法</b>','<b>⑤ 这一套的想法</b>','<b>⑤ The idea</b>'),
    'demo.wFeed':L('{n} 條線接到地鐵站：巴士只走最後一段，長的那段交給地鐵（第一關的接駁）。','{n} 条线接到地铁站：巴士只走最后一段，长的那段交给地铁（第一关的接驳）。','{n} route(s) feed a metro station: the bus does the last stretch, the metro the long one (mode 1\'s feeders).'),
    'demo.wSettle':L('穩定以後：塞車比沒有巴士 {dj}，每天坐巴士 {b} 人，路上的車 {dc}。','稳定以后：塞车比没有巴士 {dj}，每天坐巴士 {b} 人，路上的车 {dc}。','Settled: jam vs no buses {dj}, {b} by bus a day, cars {dc}.'),
    'demo.wLeft':L('每年還剩 {m} 沒用。','每年还剩 {m} 没用。','{m} a year left unspent.'),
    'demo.open':L('<b>⑥ 開通</b>：看路怎樣變通、又怎樣有人回去開車。','<b>⑥ 开通</b>：看路怎样变通、又怎样有人回去开车。','<b>⑥ Open</b>: watch the roads clear — and some drive again.'),
    'demo.year':L('第 {y} 年：塞車 <b>{j}</b>（沒有巴士 {n}）· 坐巴士 {b} 人 · 開車 {c} · 累計少塞 {t}','第 {y} 年：塞车 <b>{j}</b>（没有巴士 {n}）· 坐巴士 {b} 人 · 开车 {c} · 累计少塞 {t}','Year {y}: jam <b>{j}</b> (no buses {n}) · {b} by bus · {c} drive · {t} so far'),
    'demo.done':L('完成：八年少塞 <b>{t}</b>（{tier} 線 {n}）。你可以接著每年改，看能不能更好。','完成：八年少塞 <b>{t}</b>（{tier} 线 {n}）。你可以接着每年改，看能不能更好。','Done: <b>{t}</b> less jam ({tier} line {n}). Change it year by year yourself and beat it.')
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
  const plans=()=>(root.TL_BUS_DEMO||{})[D.map];
  const btn=document.createElement('button');btn.className='btn btn-sm';btn.id='demoBtn';$('lvInfo').after(btn);
  const dlg=document.createElement('dialog');dlg.id='demoDlg';document.body.append(dlg);
  const box=document.createElement('div');box.className='demobox';box.hidden=true;document.querySelector('.mapplate').append(box);
  const nm=o=>I.lang==='zh-Hans'?(o.hans||o.name):o.name;
  const places=()=>[...D.origins.map(o=>({cell:o.cell,name:nm(o)})),...D.destinations.map(d=>({cell:d.cell,name:nm(d)}))];
  const stations=()=>G.lines.flatMap(l=>l.stations.map((s,j)=>({cell:s,line:I.lang==='zh-Hans'?(l.hans||l.name):l.name,name:(I.lang==='zh-Hans'?l.namesHans:l.names)[j]})));
  const tierName=k=>t('demo.'+k);
  function texts(){btn.textContent=t('demo.btn');const pl=plans();if(!pl){btn.hidden=true;return;}
    dlg.innerHTML=`<button class="close" data-x>×</button><span class="lbl">AI DEMO</span><h2 class="h1">${t('demo.h')}</h2><p class="note">${t('demo.intro')}</p><div class="dcards">`+
      ['pass','high','master'].filter(k=>pl[k]).map((k,j)=>{const p=pl[k];return `<button class="dcard" data-tier="${k}"><b>${tierName(k)}</b><span>${t('demo.line',{n:pl.tiers[j],s:p.score})}</span><em>${t('demo.go')}</em>`+
        `<small>${t('demo.shape',{r:p.routes.filter(R=>R.buses>0&&R.stops.length>=2).length,b:p.routes.reduce((s,R)=>s+R.buses,0),l:p.lanes.length})}</small></button>`;}).join('')+'</div>';
    dlg.querySelector('[data-x]').onclick=()=>dlg.close();
    dlg.querySelectorAll('[data-tier]').forEach(b=>b.onclick=()=>{dlg.close();play(b.dataset.tier);});}
  btn.onclick=()=>{texts();dlg.showModal();};
  function stopDemo(keepBox){run++;timers.forEach(clearTimeout);timers=[];clearInterval(watch);$('board').style.pointerEvents='';document.querySelector('.mapplate').classList.remove('demo');if(!keepBox)box.hidden=true;}
  function say(html,alone){const body=box.querySelector('.dbody');if(alone)body.innerHTML='';
    body.querySelectorAll('p').forEach(p=>p.classList.add('old'));const p=document.createElement('p');p.innerHTML=html;body.append(p);while(body.children.length>2)body.firstChild.remove();}
  const nearest=c=>places().map(x=>({...x,d:walk(x.cell,c)})).sort((a,b)=>a.d-b.d)[0];
  function stopWhat(c){const st=stations().find(x=>walk(x.cell,c)<=1);if(st)return t('demo.change',{s:st.name,l:st.line});const n=nearest(c);return n.d===0?t('demo.door',{a:n.name}):n.d===1?t('demo.near',{a:n.name}):t('demo.plain');}
  async function play(k){
    stopDemo();const me=run,pl=plans(),plan=pl[k],j=['pass','high','master'].indexOf(k),api=TL_BUS.api,n0=Math.round(G.doNothing[0]);
    for(const d of document.querySelectorAll('dialog[open]'))d.close();
    box.hidden=false;box.innerHTML=`<div class="dh"><b>${t('demo.box',{tier:tierName(k),n:pl.tiers[j]})}</b><span class="sp"></span><button class="btn btn-sm" data-stop>${t('demo.stop')}</button></div><div class="dbody"></div>`;
    box.querySelector('[data-stop]').onclick=()=>stopDemo();
    $('board').style.pointerEvents='none';document.querySelector('.mapplate').classList.add('demo');api.reset();
    const live=()=>me===run;let feeds=0;
    for(const [r,Rt] of plan.routes.entries()){if(!live())return;if(!Rt.cells.length||!Rt.buses)continue;
      api.pick(r);say(t('demo.route',{r:RL[r],a:nearest(Rt.cells[0]).name,b:nearest(Rt.cells.at(-1)).name,l:Rt.cells.length}),true);
      for(const c of Rt.cells){if(!live())return;api.extend(r,c);await sleep(110);}
      await sleep(500);
      for(const s of Rt.stops){if(!live())return;api.stop(r,s);await sleep(350);}
      if(Rt.stops.some(s=>stations().some(x=>walk(x.cell,s)<=1)))feeds++;
      say(t('demo.stops',{list:Rt.stops.map(stopWhat).join(t('sep'))}));await sleep(1400);
      for(let b=0;b<Rt.buses;b++){if(!live())return;api.bus(r);await sleep(160);}
      say(t('demo.buses',{b:Rt.buses,w:(P.busHead/Rt.buses).toFixed(1)}));await sleep(1300);}
    if(!live())return;
    if(plan.lanes.length)for(const l of plan.lanes){api.lane(l);say(t('demo.lane',{r:nm(D.roads.find(x=>x.name===l)||{name:l}),p:Math.round((1-P.laneCut)*10)}),true);await sleep(1800);}
    else{say(t('demo.noLane'),true);await sleep(1800);}
    if(!live())return;
    const pot=api.plan.potential(),b=G.base,pc=(a,c)=>{const v=Math.round(100*(a-c)/c);return (v>0?'+':v<0?'−':'±')+Math.abs(v)+'%';};
    const why=[];if(feeds)why.push(t('demo.wFeed',{n:feeds}));why.push(t('demo.wSettle',{dj:pc(pot.jam,b.jam),b:Math.round(pot.onBus),dc:pc(pot.drivers,b.drivers)}));
    if(api.plan.money>0)why.push(t('demo.wLeft',{m:api.plan.money}));
    say(t('demo.why')+'<ul>'+why.map(s=>`<li>${s}</li>`).join('')+'</ul>',true);await sleep(5000);
    if(!live())return;
    say(t('demo.open'));await sleep(1000);if(!live())return;
    api.go();let seen=0;
    watch=setInterval(()=>{if(!live()){clearInterval(watch);return;}const p=api.plan,l=p.log.at(-1);
      if(p.year>seen&&l){seen=p.year;say(t('demo.year',{y:l.year,j:Math.round(l.jam),n:Math.round(l.jam0),b:Math.round(l.onBus),c:Math.round(l.drivers),t:Math.round(p.total)}));}
      if(p.done){clearInterval(watch);say(t('demo.done',{t:Math.round(p.total),tier:tierName(k),n:pl.tiers[j]}));stopDemo(true);}},250);
  }
  window.addEventListener('tl:lang',texts);texts();
  root.TL_BUS_DEMO_PLAY=play;
})(typeof window!=='undefined'?window:globalThis);
