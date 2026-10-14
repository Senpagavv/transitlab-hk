(function(root) {
  'use strict';
  // v7 mode 4 · AI demo (temporary, like mode 2's; remove this file, demo-plans.js and their lines in index.html and
  // build.py). Pick a score line — pass, high or master — and the AI builds its plan in the real game: the line cell by
  // cell, the stations, the trains; then year by year it sells the land beside the stations — homes or shops, which
  // lot, what it fetched and why — and the years play. Plans: bots/v7_tod.js --write (pass = all shops, high = all
  // homes, master = the best mix).
  const $=id=>document.getElementById(id),I=root.I18N,t=(k,v)=>I.t(k,v),L=I.L,M=root.TOD,{D,P,walk,same}=M;
  I.add({
    'demo.btn':L('AI 示範','AI 示范','AI demo'),
    'demo.h':L('看 AI 怎樣修線、賣地','看 AI 怎样修线、卖地','Watch the AI build and sell'),
    'demo.intro':L('選一條分數線，AI 會在棋盤上一步一步做它的方案：先畫線、放站、買車，然後一年一年賣站旁的地——賣哪塊、賣成什麼、進賬多少、為什麼。','选一条分数线，AI 会在棋盘上一步一步做它的方案：先画线、放站、买车，然后一年一年卖站旁的地——卖哪块、卖成什么、进账多少、为什么。',
      'Pick a score line: the AI builds its line, stations and trains step by step, then sells the land beside the stations year by year — which lot, homes or shops, what it fetched and why.'),
    'demo.pass':L('過關','过关','Pass'),'demo.high':L('高分','高分','High score'),'demo.master':L('大師','大师','Master'),
    'demo.line':L('分數線 {n} · AI 這套 {s}','分数线 {n} · AI 这套 {s}','line {n} · this plan {s}'),
    'demo.shape':L('線 {l} 格 · {s} 個站 · 賣地 {h} 住宅 / {p} 商場','线 {l} 格 · {s} 个站 · 卖地 {h} 住宅 / {p} 商场','{l} cells · {s} stations · {h} homes / {p} shops'),
    'demo.go':L('看這一套 ▶','看这一套 ▶','Watch ▶'),'demo.close':L('關閉','关闭','Close'),
    'demo.box':L('AI 示範 · {tier}（{n}）','AI 示范 · {tier}（{n}）','AI demo · {tier} ({n})'),'demo.stop':L('停止示範','停止示范','Stop'),
    'demo.s1':L('<b>① 畫線</b>：{via}。線 {l} 格。','<b>① 画线</b>：{via}。线 {l} 格。','<b>① The line</b>: {via}. {l} cells.'),
    'demo.st':L('<b>② 放站 {n}</b>：{where}；旁邊有 {lots} 塊空地可以賣。','<b>② 放站 {n}</b>：{where}；旁边有 {lots} 块空地可以卖。','<b>② Station {n}</b>: {where}; {lots} vacant lots beside it.'),
    'demo.door':L('就在{a}門口','就在{a}门口','right at {a}'),'demo.near':L('離{a} {c} 格','离{a} {c} 格','{c} cells from {a}'),
    'demo.tr':L('<b>③ 列車 {n} 列</b>（每段每天 {cap}）：賣了住宅，站上會多出每天坐車的人，列車要先想好——開通後不能加。','<b>③ 列车 {n} 列</b>（每段每天 {cap}）：卖了住宅，站上会多出每天坐车的人，列车要先想好——开通后不能加。',
      '<b>③ {n} trains</b> ({cap} a section a day): homes put riders on the line, so plan the trains now — none can be added once open.'),
    'demo.why':L('<b>④ 這一套的想法</b>','<b>④ 这一套的想法</b>','<b>④ The idea</b>'),
    'demo.wMix':L('住宅 {h} 塊、商場 {p} 塊混著賣：住宅讓站上多住人，商場讓這個站變成大家要去的地方——兩樣互相抬價。','住宅 {h} 块、商场 {p} 块混着卖：住宅让站上多住人，商场让这个站变成大家要去的地方——两样互相抬价。','{h} homes and {p} shops: homes put people on the line, shops make the station a place to go — each raises the other\'s price.'),
    'demo.wHome':L('只賣住宅（{h} 塊）：每塊多 16 個人住在站上、都坐地鐵——車費年年有；可是沒有商場，大家還是只去元朗。','只卖住宅（{h} 块）：每块多 16 个人住在站上、都坐地铁——车费年年有；可是没有商场，大家还是只去元朗。','Homes only ({h}): each puts 16 people on the line, riding every year — but with no shops everyone still goes to Yuen Long.'),
    'demo.wShop':L('只賣商場（{p} 塊）：站旁的商場把附近屋苑的人吸過來坐地鐵；可是沒人住在站上，地價抬不高。','只卖商场（{p} 块）：站旁的商场把附近屋苑的人吸过来坐地铁；可是没人住在站上，地价抬不高。','Shops only ({p}): station shops draw people from the estates onto the metro — but nobody lives at the stations, so land stays cheap.'),
    'demo.wTime':L('分 {y} 年賣，不全在開通那年：口耳相傳和周圍的開發會讓地價漲；也不全拖到最後：早賣早有車費。','分 {y} 年卖，不全在开通那年：口耳相传和周围的开发会让地价涨；也不全拖到最后：早卖早有车费。','Sold over {y} years, not all at the opening: word of mouth and development round it raise the price — and not all at the end: early sales bring fares sooner.'),
    'demo.open':L('<b>⑤ 開通</b>：每年最多賣兩塊站旁空地，一年一年看賬。','<b>⑤ 开通</b>：每年最多卖两块站旁空地，一年一年看账。','<b>⑤ Open</b>: up to two lots beside the stations a year — watch the ledger year by year.'),
    'demo.sell':L('賣<b>{lot}</b>成{use}，進賬 <b>{p}</b>（{why}）','卖<b>{lot}</b>成{use}，进账 <b>{p}</b>（{why}）','<b>{lot}</b> sold for {use}: <b>{p}</b> ({why})'),
    'demo.home':L('住宅','住宅','homes'),'demo.shop':L('商場','商场','shops'),
    'demo.whyHome':L('住在這裡，去各處方便','住在这里，去各处方便','handy for everywhere'),'demo.whyShop':L('每天多 {v} 人來這個站','每天多 {v} 人来这个站','{v} more a day come to this station'),
    'demo.year':L('第 {y} 年：每天 <b>{r}</b> 人坐地鐵 · 今年賣地 {l} · 賬 {t}','第 {y} 年：每天 <b>{r}</b> 人坐地铁 · 今年卖地 {l} · 账 {t}','Year {y}: <b>{r}</b> by metro · land {l} · ledger {t}'),
    'demo.done':L('完成：八年的賬 <b>{t}</b>（{tier} 線 {n}）。按「↺ 回到規劃」可以在這套上面自己改。','完成：八年的账 <b>{t}</b>（{tier} 线 {n}）。按「↺ 回到规划」可以在这套上面自己改。','Done: a ledger of <b>{t}</b> over eight years ({tier} line {n}). «↺ Back to planning» to edit it yourself.')
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
  let timers=[],run=0;
  // the three score lines and the bot's plans that reach them
  const PLAN={pass:'shop',high:'home',master:'mixed'};
  const plans=()=>{const pl=(root.TL_TOD_DEMO||{})[D.map];if(!pl)return null;const out={tiers:pl.tiers};for(const k in PLAN)if(pl[PLAN[k]])out[k]=pl[PLAN[k]];return out;};
  const btn=document.createElement('button');btn.className='btn btn-sm';btn.id='demoBtn';
  $('lvInfo').after(btn);
  const dlg=document.createElement('dialog');dlg.id='demoDlg';document.body.append(dlg);
  const box=document.createElement('div');box.className='demobox';box.hidden=true;document.querySelector('.mapplate').append(box);
  const places=()=>[...D.origins.map(o=>({cell:o.cell,name:I.name(o)})),...D.destinations.map(d=>({cell:d.cell,name:I.name(d)}))];
  const lotName=c=>t('tod.lot',{n:D.land.findIndex(q=>same(q.cell,c))+1});
  const tierName=k=>t('demo.'+k);
  const uses=p=>({h:p.actions.filter(a=>a.use==='home').length,s:p.actions.filter(a=>a.use==='shop').length});
  function texts(){btn.textContent=t('demo.btn');const pl=plans();if(!pl){btn.hidden=true;return;}
    dlg.innerHTML=`<button class="close" data-x>×</button><span class="lbl">AI DEMO</span><h2 class="h1">${t('demo.h')}</h2><p class="note">${t('demo.intro')}</p><div class="dcards">`+
      ['pass','high','master'].filter(k=>pl[k]).map((k,j)=>{const p=pl[k],u=uses(p);return `<button class="dcard" data-tier="${k}"><b>${tierName(k)}</b><span>${t('demo.line',{n:pl.tiers[j],s:p.score})}</span><em>${t('demo.go')}</em>`+
        `<small>${t('demo.shape',{l:p.line.length,s:p.stations.length,h:u.h,p:u.s})}</small></button>`;}).join('')+'</div>';
    dlg.querySelector('[data-x]').onclick=()=>dlg.close();
    dlg.querySelectorAll('[data-tier]').forEach(b=>b.onclick=()=>{dlg.close();play(b.dataset.tier);});}
  btn.onclick=()=>{texts();dlg.showModal();};
  function stopDemo(keepBox){run++;timers.forEach(clearTimeout);timers=[];$('board').style.pointerEvents='';document.querySelector('.mapplate').classList.remove('demo');if(!keepBox)box.hidden=true;}
  function say(html,alone){const body=box.querySelector('.dbody');if(alone)body.innerHTML='';
    body.querySelectorAll('p').forEach(p=>p.classList.add('old'));const p=document.createElement('p');p.innerHTML=html;body.append(p);
    while(body.children.length>2)body.firstChild.remove();}
  async function play(k){
    stopDemo();const me=run,pl=plans(),plan=pl[k],j=['pass','high','master'].indexOf(k),api=TL_TOD.api,live=()=>me===run;
    for(const d of document.querySelectorAll('dialog[open]'))d.close();
    box.hidden=false;box.innerHTML=`<div class="dh"><b>${t('demo.box',{tier:tierName(k),n:pl.tiers[j]})}</b><span class="sp"></span><button class="btn btn-sm" data-stop>${t('demo.stop')}</button></div><div class="dbody"></div>`;
    box.querySelector('[data-stop]').onclick=()=>stopDemo();
    $('board').style.pointerEvents='none';document.querySelector('.mapplate').classList.add('demo');api.reset();
    // ① the line, cell by cell
    const pl2=places(),onLine=pl2.map(x=>({...x,at:plan.line.findIndex(c=>walk(c,x.cell)<=1)})).filter(x=>x.at>=0).sort((a,b)=>a.at-b.at);
    say(t('demo.s1',{via:onLine.map(x=>x.name).join(' → ')||'—',l:plan.line.length}));
    for(const c of plan.line){if(!live())return;api.extend(c);await sleep(70);}
    await sleep(700);
    // ② stations, in line order: what each serves and the land beside it
    const order=plan.stations.map(s=>({s,x:plan.line.findIndex(c=>same(c,s))})).sort((a,b)=>a.x-b.x);
    for(const [n,{s}] of order.entries()){if(!live())return;api.station(s);
      const near=pl2.map(x=>({...x,d:walk(x.cell,s)})).sort((a,b)=>a.d-b.d)[0],lots=D.land.filter(q=>!api.plan.onLine(q.cell)&&Math.max(Math.abs(q.cell[0]-s[0]),Math.abs(q.cell[1]-s[1]))<=1).length;
      say(t('demo.st',{n:n+1,where:near.d===0?t('demo.door',{a:near.name}):t('demo.near',{a:near.name,c:near.d}),lots}));await sleep(1300);}
    // ③ trains
    for(let n=1;n<plan.trains;n++){if(!live())return;api.train();}
    say(t('demo.tr',{n:plan.trains,cap:plan.trains*P.perTrain}));await sleep(2000);if(!live())return;
    // ④ the idea
    const u=uses(plan),years=new Set(plan.actions.map(a=>a.year)).size,why=[];
    why.push(u.h&&u.s?t('demo.wMix',{h:u.h,p:u.s}):u.h?t('demo.wHome',{h:u.h}):t('demo.wShop',{p:u.s}));
    if(years>1)why.push(t('demo.wTime',{y:years}));
    say(t('demo.why')+'<ul>'+why.map(s=>`<li>${s}</li>`).join('')+'</ul>',true);await sleep(5200);if(!live())return;
    // ⑤ year by year: this year's lots, then the year runs
    say(t('demo.open'));await sleep(1200);
    for(let y=0;y<P.years;y++){
      if(!live())return;
      for(const a of plan.actions.filter(a=>a.year===y)){if(!live())return;
        const q=api.plan.quote(a.cell,a.use),sale=api.sell(a.cell,a.use);if(!sale)continue;
        say(t('demo.sell',{lot:lotName(a.cell),use:t('demo.'+a.use),p:Math.round(sale.price||q.price||0),why:a.use==='home'?t('demo.whyHome'):t('demo.whyShop',{v:Math.round(q.visitors||0)})}));await sleep(1500);}
      if(!live())return;
      api.next();await sleep(1200);
      const p=api.plan,l=p.log.at(-1);if(l)say(t('demo.year',{y:l.year,r:Math.round(l.riders),l:Math.round(l.revenue),t:Math.round(p.total)}));
      await sleep(900);}
    if(!live())return;
    const p=api.plan;say(t('demo.done',{t:Math.round(p.total),tier:tierName(k),n:pl.tiers[j]}));stopDemo(true);
  }
  window.addEventListener('tl:lang',texts);
  texts();
  root.TL_TOD_DEMO_PLAY=play;
})(typeof window!=='undefined'?window:globalThis);
