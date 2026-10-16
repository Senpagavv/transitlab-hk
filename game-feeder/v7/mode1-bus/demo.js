(function(root) {
  'use strict';
  // v7 mode 1 · AI demo (temporary; remove this file, demo-plans.js and the lines marked «AI demo» in ui.js /
  // index.html / build.py). For each level it replays the bot's plan for one score line — pass, high or master — in
  // the real game: the opening, then every move at the moment the bot made it (in the break before a round, or that
  // many seconds into a round with an extra move), with one sentence on why. Plans: bots/v7_demo_plans.js.
  const $=id=>document.getElementById(id),I=root.I18N,t=(k,v)=>I.t(k,v),L=I.L;
  const PLANS=root.TL_DEMO_PLANS||{},letters=['A','B','C'];
  // D.make currently omits demo; the registry/active-pack fallback preserves it
  // without changing data.js. Built-in plans keep the same priority as modes 2-4.
  const plans=level=>PLANS[level]||(D().map===level&&D().demo)||root.TL_LEVELS?.get(1,level)?.level?.demo||
    (root.TL_ACTIVE_PACK?.id===level&&root.TL_ACTIVE_PACK.level?.demo);
  I.add({
    'demo.btn':L('AI 示範','AI 示范','AI demo'),
    'demo.h':L('看 AI 怎樣過這一關','看 AI 怎样过这一关','Watch the AI play this level'),
    'demo.intro':L('選一條分數線，AI 會從開局開始，把它的擺法和每一次挪站都演一遍，每一步旁邊寫著為什麼。看的時候可以暫停、加速（按住 F）。','选一条分数线，AI 会从开局开始，把它的摆法和每一次挪站都演一遍，每一步旁边写着为什么。看的时候可以暂停、加速（按住 F）。',
      'Pick a score line: the AI plays its opening and every move from the start, with one line on why at each step. Pause or hold F to speed up any time.'),
    'demo.pass':L('過關','过关','Pass'),'demo.high':L('高分','高分','High score'),'demo.master':L('大師','大师','Master'),
    'demo.line':L('分數線 {n} · AI 這套得 {s}','分数线 {n} · AI 这套得 {s}','line {n} · this plan scores {s}'),
    'demo.static':L('只靠開局，整局不挪站','只靠开局，整局不挪站','opening only, no moves'),
    'demo.moves':L('開局 + 挪站 {n} 次','开局 + 挪站 {n} 次','opening + {n} moves'),
    'demo.go':L('看這一套 ▶','看这一套 ▶','Watch ▶'),'demo.close':L('關閉','关闭','Close'),
    'demo.box':L('AI 示範 · {tier}（{n}）','AI 示范 · {tier}（{n}）','AI demo · {tier} ({n})'),
    'demo.stop':L('停止示範','停止示范','Stop the demo'),
    'demo.open':L('開局：{list}。{plan}','开局：{list}。{plan}','Opening: {list}. {plan}'),
    'demo.serves':L('{s} 站在 {near} 旁（接 {who}）','{s} 站在 {near} 旁（接 {who}）','{s} by {near} (serves {who})'),
    'demo.none':L('沒有屋苑','没有屋苑','no estate'),
    'demo.planStatic':L('之後一站都不挪。','之后一站都不挪。','No moves after that.'),
    'demo.planMoves':L('之後挪站 {n} 次，到時候會說明。','之后挪站 {n} 次，到时候会说明。','{n} moves later, each explained when it happens.'),
    'demo.break':L('第 {r} 輪開始前（停頓）','第 {r} 轮开始前（停顿）','Before round {r} (break)'),
    'demo.mid':L('第 {r} 輪第 {at} 秒（用機動）','第 {r} 轮第 {at} 秒（用机动）','Round {r}, {at} s in (extra move)'),
    'demo.move':L('{when}：把 {s} 站挪到 {near} 旁。這一輪人多的是 {busy}；新位置接 {who}。','{when}：把 {s} 站挪到 {near} 旁。这一轮人多的是 {busy}；新位置接 {who}。',
      '{when}: move stop {s} next to {near}. Busy this round: {busy}; the new spot serves {who}.'),
    'demo.end':L('示範結束：坐巴士 {d} 人（{tier}線 {n}）。','示范结束：坐巴士 {d} 人（{tier}线 {n}）。','Demo over: {d} by bus ({tier} line {n}).'),
    'demo.diff':L('（和機器人算的 {s} 不同，請回報）','（和机器人算的 {s} 不同，请回报）',' (the bot computed {s}; please report)')
  });
  let active=false,plan=null,tier='',pending=[],queued=[],log=[],timer=0,ended=false;
  const name=i=>I.short(D().origins[i]),D=()=>root.TIDE_DATA,Tide=()=>root.Tide;
  // the estates a cell serves (pull > 0), nearest first, and the nearest one's name
  function serves(cell){
    const d=D(),T=Tide(),out=d.origins.map((o,i)=>({i,dist:T.dist(o.cell,cell),pull:T.shareAt(i,cell)})).filter(x=>x.pull>0).sort((a,b)=>a.dist-b.dist);
    return{near:out.length?name(out[0].i):t('demo.none'),who:out.length?out.map(x=>`${name(x.i)} ${Math.round(x.pull*100)}%`).join(t('sep')):t('demo.none')};
  }
  function busiest(r){const w=D().waves[r]||[],idx=w.map((n,i)=>i).sort((a,b)=>w[b]-w[a]).slice(0,2);return idx.map(i=>`${name(i)} ${w[i]}`).join(t('sep'));}
  // the panel in the left column: tier, then one line per step
  function panel(){
    let el=$('demoBox');
    if(!el){el=document.createElement('div');el.id='demoBox';el.className='box demobox';$('stations').before(el);}
    if(!active&&!ended){el.remove();return;}
    el.innerHTML=`<div class="row"><b>${t('demo.box',{tier:t('demo.'+tier),n:plans(D().map)[tier].score})}</b><div class="sp"></div>${active?`<button class="btn btn-sm" id="demoStop">${t('demo.stop')}</button>`:''}</div><ol>${log.map(x=>`<li>${x}</li>`).join('')}</ol>`;
    const b=$('demoStop');if(b)b.onclick=stop;
    const ol=el.querySelector('ol');ol.scrollTop=ol.scrollHeight;
  }
  function say(s){log.push(s);panel();}
  function apply(m){
    const ok=root.TL_GAME.demo.move(m.id,m.cell);
    const sv=serves(m.cell),when=m.at===undefined?t('demo.break',{r:m.r}):t('demo.mid',{r:m.r,at:m.at});
    say(t('demo.move',{when,s:letters[m.id],near:sv.near,busy:busiest(m.r-1),who:sv.who})+(ok?'':' ✕'));
  }
  const Demo={
    get active(){return active;},
    start(level,which){
      const p=plans(level)?.[which];if(!p)return;
      root.TL_GAME.demo.start(p.opening);   // resets the game first (which stops any demo running)
      plan=p;tier=which;log=[];ended=false;pending=p.moves.map(m=>({...m}));queued=[];active=true;
      const list=p.opening.map((c,id)=>{const sv=serves(c);return t('demo.serves',{s:letters[id],near:sv.near,who:sv.who});}).join('；');
      say(t('demo.open',{list,plan:p.moves.length?t('demo.planMoves',{n:p.moves.length}):t('demo.planStatic')}));
    },
    stop(){active=false;ended=false;pending=[];queued=[];clearTimeout(timer);panel();},
    // a break opened before round index k: queue that round's break moves, shown one by one (the game stands still)
    onBreak(g){
      const r=g.round+1,now=pending.filter(m=>m.r===r&&m.at===undefined);pending=pending.filter(m=>!now.includes(m));
      queued.push(...now);const step=()=>{const m=queued.shift();if(m){apply(m);timer=setTimeout(step,900);}};
      clearTimeout(timer);timer=setTimeout(step,1200);
    },
    // before the game advances: any queued break move goes in first (the break may have been cut short), and the
    // advance stops exactly on the next mid-round move's time
    clamp(g,dt){
      while(queued.length)apply(queued.shift());
      const m=pending.find(x=>x.at!==undefined&&g.roundStart[x.r-1]!==undefined);
      if(m){const need=g.roundStart[m.r-1]+m.at-g.t-g.acc;if(need>=0&&dt>need)dt=need;}
      return dt;
    },
    tick(g){
      const m=pending.find(x=>x.at!==undefined&&g.roundStart[x.r-1]!==undefined);
      if(m&&g.t+1e-6>=g.roundStart[m.r-1]+m.at){pending=pending.filter(x=>x!==m);apply(m);}
      if(g.done&&active){active=false;ended=true;
        const P=plans(D().map),line=P.tiers[['pass','high','master'].indexOf(tier)];
        say(t('demo.end',{d:g.delivered,tier:t('demo.'+tier),n:line})+(g.delivered!==plan.score?t('demo.diff',{s:plan.score}):''));}
    },
    // the choice of score lines for this level
    open(){
      const lv=D().map,P=plans(lv);if(!P)return;
      let dlg=$('demoDlg');
      if(!dlg){dlg=document.createElement('dialog');dlg.id='demoDlg';dlg.className='intro';document.body.appendChild(dlg);}
      dlg.innerHTML=`<span class="lbl">AI DEMO</span><h2 class="h1">${t('demo.h')}</h2><p class="note">${t('demo.intro')}</p>`+
        ['pass','high','master'].map((k,j)=>{const p=P[k];if(!p)return '';
          return `<div class="demoopt"><div><b>${t('demo.'+k)}</b><small>${t('demo.line',{n:P.tiers[j],s:p.score})} · ${p.moves.length?t('demo.moves',{n:p.moves.length}):t('demo.static')}</small></div><button class="btn btn-p btn-sm" data-tier="${k}">${t('demo.go')}</button></div>`;}).join('')+
        `<div class="row"><button class="btn" id="demoCancel">${t('demo.close')}</button></div>`;
      dlg.querySelectorAll('[data-tier]').forEach(b=>b.onclick=()=>{dlg.close();Demo.start(lv,b.dataset.tier);});
      $('demoCancel').onclick=()=>dlg.close();
      root.TL_GAME.pause();dlg.showModal();
    }
  };
  function stop(){Demo.stop();}
  // the button, next to «本關» (only on levels that have plans)
  function button(){
    let b=$('demoBtn');
    if(!b){b=document.createElement('button');b.id='demoBtn';b.className='btn btn-sm';b.onclick=()=>Demo.open();$('lvInfo').after(b);}
    b.textContent=t('demo.btn');b.hidden=!plans(D().map);
  }
  // its own look (kept here so the demo leaves with its file)
  const css=document.createElement('style');css.textContent=`
    .demobox{margin:10px 0;border-color:var(--s-accent);background:color-mix(in srgb,var(--s-accent) 6%,var(--s-soft))}
    .demobox b{font-size:13px}.demobox ol{margin:8px 0 0;padding-left:18px;max-height:230px;overflow:auto;font-size:12.5px;line-height:1.6}
    .demobox li{margin:3px 0}.demobox li:last-child{color:var(--s-ink);font-weight:500}
    .demoopt{display:flex;align-items:center;gap:12px;justify-content:space-between;border-top:1px solid var(--s-line);padding:10px 0}
    .demoopt b{display:block;font-size:15px}.demoopt small{color:var(--s-ink2);font-size:12px}`;
  document.head.appendChild(css);
  root.TL_DEMO=Demo;
  root.addEventListener('tl:lang',()=>{button();panel();});
  root.addEventListener('tl:level',()=>{button();});
  button();
})(window);
