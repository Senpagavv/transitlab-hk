(function(root) {
  'use strict';
  // v7 mode 2 · AI demo (temporary; remove this file, demo-plans.js and the lines marked «AI demo» in index.html and
  // build.py). Pick a score line — pass, high or master — and the AI builds its plan in the real game: the line cell by
  // cell, each station with what it serves, the trains with why, a few words on the idea; then it opens the line and
  // the years play. Plans: bots/v7_metro_grow.js --write.
  const $=id=>document.getElementById(id),I=root.I18N,t=(k,v)=>I.t(k,v),L=I.L,M=root.Metro,{D,P,walk,same}=M;
  I.add({
    'demo.btn':L('AI 示範','AI 示范','AI demo'),
    'demo.h':L('看 AI 怎樣建這條線','看 AI 怎样建这条线','Watch the AI build its line'),
    'demo.intro':L('選一條分數線，AI 會在棋盤上一步一步建它的方案：先畫線，再一個一個放站、買車，每一步寫著為什麼；然後開通，看八年。','选一条分数线，AI 会在棋盘上一步一步建它的方案：先画线，再一个一个放站、买车，每一步写着为什么；然后开通，看八年。',
      'Pick a score line: the AI builds its plan step by step — the line, then each station and train, with why — then opens it and the eight years play.'),
    'demo.pass':L('過關','过关','Pass'),'demo.high':L('高分','高分','High score'),'demo.master':L('大師','大师','Master'),
    'demo.line':L('分數線 {n} · AI 這套 {s}','分数线 {n} · AI 这套 {s}','line {n} · this plan {s}'),
    'demo.shape':L('線 {l} 格 · {s} 個站 · {t} 列車','线 {l} 格 · {s} 个站 · {t} 列车','{l} cells · {s} stations · {t} trains'),
    'demo.go':L('看這一套 ▶','看这一套 ▶','Watch ▶'),'demo.close':L('關閉','关闭','Close'),
    'demo.box':L('AI 示範 · {tier}（{n}）','AI 示范 · {tier}（{n}）','AI demo · {tier} ({n})'),'demo.stop':L('停止示範','停止示范','Stop'),
    'demo.s1':L('<b>① 畫線</b>：{via}。線 {l} 格，花 {c}。','<b>① 画线</b>：{via}。线 {l} 格，花 {c}。','<b>① The line</b>: {via}. {l} cells, {c} spent.'),
    'demo.st':L('<b>② 放站 {n}</b>：{where}。','<b>② 放站 {n}</b>：{where}。','<b>② Station {n}</b>: {where}.'),
    'demo.stPot':L('現在這條線，大家都知道以後每天 <b>{p}</b> 人坐。','现在这条线，大家都知道以后每天 <b>{p}</b> 人坐。','Once everyone knows, <b>{p}</b> a day ride this line.'),
    'demo.door':L('就在{a}門口，走路 0 格','就在{a}门口，走路 0 格','right at {a}, no walking'),
    'demo.next':L('在{a}旁邊 1 格（走路 {w}）','在{a}旁边 1 格（走路 {w}）','one cell from {a} (walk {w})'),
    'demo.plain':L('線上一格，接{a}（走 {c} 格）','线上一格，接{a}（走 {c} 格）','on the line, for {a} ({c} cells\' walk)'),
    'demo.tr2':L('<b>③ 買列車</b>：大家都知道以後，最擠的一段每天約 <b>{l}</b> 人；1 列只載 {c}，所以一共買 {n} 列（每段 {cap}）——擠了明年每次多 {cb} 格，口碑也會停。','<b>③ 买列车</b>：大家都知道以后，最挤的一段每天约 <b>{l}</b> 人；1 列只载 {c}，所以一共买 {n} 列（每段 {cap}）——挤了明年每次多 {cb} 格，口碑也会停。',
      '<b>③ Trains</b>: once everyone knows, the busiest section carries about <b>{l}</b> a day; one train holds {c}, so {n} in all ({cap} a section) — crowded means {cb} more blocks next year, and word of mouth stalls.'),
    'demo.tr1':L('<b>③ 列車</b>：最擠的一段大家都知道以後每天約 {l} 人，1 列（{c}）就夠，錢留給線和站。','<b>③ 列车</b>：最挤的一段大家都知道以后每天约 {l} 人，1 列（{c}）就够，钱留给线和站。','<b>③ Trains</b>: the busiest section reaches about {l} a day; one train ({c}) is enough, the money goes to line and stations.'),
    'demo.why':L('<b>④ 這一套的想法</b>','<b>④ 这一套的想法</b>','<b>④ The idea</b>'),
    'demo.wDoor':L('{n} 個站有 {d} 個就在屋苑或目的地門口：走路每格算 {w}，站離門口一格，每趟就貴 {w} 格。','{n} 个站有 {d} 个就在屋苑或目的地门口：走路每格算 {w}，站离门口一格，每趟就贵 {w} 格。',
      '{d} of the {n} stations sit right at an estate or destination: walking is {w} a cell, so one cell off costs every trip {w}.'),
    'demo.wBend':L('線故意繞路（{l} 格）：坐車不按距離算，只有路過的站才多 1 格，所以繞去多接一個屋苑很划算。','线故意绕路（{l} 格）：坐车不按距离算，只有路过的站才多 1 格，所以绕去多接一个屋苑很划算。',
      'The line winds ({l} cells): the ride doesn\'t count distance, only stations passed, so a detour to pick up another estate pays.'),
    'demo.wBoth':L('兩個目的地都接上：{a}和{b}都會變近，兩邊都多人去；兩地之間順路來回的人，大家都知道以後每天約 {n} 人坐地鐵。','两个目的地都接上：{a}和{b}都会变近，两边都多人去；两地之间顺路来回的人，大家都知道以后每天约 {n} 人坐地铁。','Both destinations on the line: {a} and {b} both come nearer and draw more; people going on between them add about {n} metro trips a day once everyone knows.'),
    'demo.wSkip':L('離站遠的屋苑：{list}——走過去太貴，坐的人少。預算 {b} 只夠這麼多，先接人多、開車又遠的。','离站远的屋苑：{list}——走过去太贵，坐的人少。预算 {b} 只够这么多，先接人多、开车又远的。','Far from a station: {list} — too long a walk, few ride. A budget of {b} only goes so far: serve big estates far from the destinations first.'),
    'demo.far':L('{a}（走 {c} 格）','{a}（走 {c} 格）','{a} ({c} cells)'),
    'demo.wLeft':L('還剩 {m} 沒用。','还剩 {m} 没用。','{m} left unspent.'),
    'demo.open':L('<b>⑤ 開通</b>：第 1 年只有 {s} 成人知道。看口耳相傳把人帶上來。','<b>⑤ 开通</b>：第 1 年只有 {s} 成人知道。看口耳相传把人带上来。','<b>⑤ Open</b>: in year 1 only {s}/10 know the line. Watch word of mouth bring people on.'),
    'demo.year':L('第 {y} 年：每天 <b>{r}</b> 人坐 · 平均 {a} 成人知道 · 累計 {t}','第 {y} 年：每天 <b>{r}</b> 人坐 · 平均 {a} 成人知道 · 累计 {t}','Year {y}: <b>{r}</b> a day · {a}/10 know · {t} so far'),
    'demo.done':L('完成：八年累計 <b>{t}</b>（{tier} 線 {n}）。按「↺ 回到規劃」可以在這套上面自己改。','完成：八年累计 <b>{t}</b>（{tier} 线 {n}）。按「↺ 回到规划」可以在这套上面自己改。',
      'Done: <b>{t}</b> over eight years ({tier} line {n}). «↺ Back to planning» to edit it yourself.')
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
  .demobox p.old{opacity:.5}.demobox .dbody{columns:1}
  .mapplate.demo .clockbox,.mapplate.demo .lanebox{display:none}`;
  document.head.append(css);
  const sleep=ms=>new Promise(r=>{const id=setTimeout(r,ms);timers.push(id);});
  let timers=[],run=0,watch=0;
  const plans=()=>(root.TL_METRO_DEMO||{})[D.map];
  const btn=document.createElement('button');btn.className='btn btn-sm';btn.id='demoBtn';
  $('lvInfo').after(btn);
  const dlg=document.createElement('dialog');dlg.id='demoDlg';document.body.append(dlg);
  const box=document.createElement('div');box.className='demobox';box.hidden=true;document.querySelector('.mapplate').append(box);
  const names=()=>[...D.origins.map((o,i)=>({cell:o.cell,name:I.name(o),estate:i})),...D.destinations.map(d=>({cell:d.cell,name:I.name(d),dest:true}))];
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
    stopDemo();const me=run,pl=plans(),plan=pl[k],j=['pass','high','master'].indexOf(k),api=TL_METRO.api;
    for(const d of document.querySelectorAll('dialog[open]'))d.close();
    box.hidden=false;box.innerHTML=`<div class="dh"><b>${t('demo.box',{tier:tierName(k),n:pl.tiers[j]})}</b><span class="sp"></span><button class="btn btn-sm" data-stop>${t('demo.stop')}</button></div><div class="dbody"></div>`;
    box.querySelector('[data-stop]').onclick=()=>stopDemo();
    $('board').style.pointerEvents='none';document.querySelector('.mapplate').classList.add('demo');api.reset();
    const live=()=>me===run;
    // ① the line, cell by cell
    const places=names(),onLine=places.map(x=>({...x,at:plan.line.findIndex(c=>walk(c,x.cell)<=1)})).filter(x=>x.at>=0).sort((a,b)=>a.at-b.at);
    say(t('demo.s1',{via:onLine.map(x=>x.name).join(' → ')||'—',l:plan.line.length,c:plan.line.length*P.lineCost}));
    for(const c of plan.line){if(!live())return;api.extend(c);await sleep(70);}
    await sleep(700);
    // ② stations, in line order, each with what it serves
    const order=plan.stations.map(s=>({s,x:plan.line.findIndex(c=>same(c,s))})).sort((a,b)=>a.x-b.x);
    for(const [n,{s}] of order.entries()){if(!live())return;api.station(s);
      const near=places.map(x=>({...x,d:walk(x.cell,s)})).sort((a,b)=>a.d-b.d)[0];
      const where=near.d===0?t('demo.door',{a:near.name}):near.d===1?t('demo.next',{a:near.name,w:P.walkPer}):t('demo.plain',{a:near.name,c:near.d});
      const pot=api.plan.stations.length>=2?Math.round(api.plan.potential().riders):0;
      say(t('demo.st',{n:n+1,where})+(pot?' '+t('demo.stPot',{p:pot}):''));await sleep(1300);}
    // ③ trains
    for(let n=1;n<plan.trains;n++){if(!live())return;api.train();}
    const pot=api.plan.potential(),load=Math.round(Math.max(...pot.load));
    say(plan.trains>1?t('demo.tr2',{l:load,c:P.perTrain,n:plan.trains,cap:plan.trains*P.perTrain,cb:P.crowdBlocks}):t('demo.tr1',{l:load,c:P.perTrain}));await sleep(2200);
    if(!live())return;
    // ④ the idea
    const why=[],atDoor=plan.stations.filter(s=>places.some(x=>same(x.cell,s))).length;
    why.push(t('demo.wDoor',{n:plan.stations.length,d:atDoor,w:P.walkPer}));
    const a=order[0].s,z=order.at(-1).s;if(plan.line.length-1>walk(a,z)+2)why.push(t('demo.wBend',{l:plan.line.length}));
    const served=x=>plan.stations.some(s=>walk(s,x.cell)<=1);
    if(D.destinations.every((d,k2)=>served({cell:d.cell})))why.push(t('demo.wBoth',{a:I.name(D.destinations[0]),b:I.name(D.destinations[1]),n:Math.round(pot.chain.reduce((s2,q)=>s2+q.metro,0))}));
    const skip=places.filter(x=>x.estate!==undefined&&!served(x)).map(x=>t('demo.far',{a:x.name,c:Math.min(...plan.stations.map(s=>walk(s,x.cell)))}));
    if(skip.length)why.push(t('demo.wSkip',{list:skip.join(t('sep')),b:P.budget}));
    if(api.plan.money>0)why.push(t('demo.wLeft',{m:api.plan.money}));
    say(t('demo.why')+'<ul>'+why.map(s=>`<li>${s}</li>`).join('')+'</ul>',true);await sleep(5200);
    if(!live())return;
    // ⑤ open: the years play
    say(t('demo.open',{s:Math.round(P.aware.start*10)}));await sleep(1200);if(!live())return;
    api.go();let seen=0;
    watch=setInterval(()=>{if(!live()){clearInterval(watch);return;}const p=api.plan,l=p.log.at(-1);
      if(p.year>seen&&l){seen=p.year;say(t('demo.year',{y:l.year,r:Math.round(l.riders),a:Math.round(10*l.after.reduce((s2,v)=>s2+v,0)/l.after.length),t:Math.round(p.total)}));}
      if(p.done){clearInterval(watch);say(t('demo.done',{t:Math.round(p.total),tier:tierName(k),n:pl.tiers[j]}));stopDemo(true);}},250);
  }
  window.addEventListener('tl:lang',texts);
  texts();
  root.TL_METRO_DEMO_PLAY=play;
})(typeof window!=='undefined'?window:globalThis);
