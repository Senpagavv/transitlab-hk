/* Mode 5 · friendly score + leaderboard
 *
 * The score is normalized to current demand, so a small area and the full
 * Hong Kong map have a fair chance to reach the same score bands. Every
 * finished run starts at 500 points; improvements add points and stability
 * adds a small bonus. Device scores work offline; signed-in users can sync
 * to the existing feeder leaderboard API.
 */
(function(root){
  'use strict';
  const I=root.I18N, L=I&&I.L, t=(k,v)=>I.t(k,v), $=id=>document.getElementById(id);
  if(!I)return;
  I.add({
    'm5.scoreTitle':L('本局評分','本局评分','Round score'),
    'm5.scoreHint':L('分數同時看轉乘、少車、減堵和預算，讓不同規模的地區都公平。','分数同时看换乘、少车、减堵和预算，让不同规模的地区都公平。','The score balances ridership, fewer cars, congestion relief and budget across map sizes.'),
    'm5.scoreBand0':L('繼續試玩','继续试玩','Keep exploring'),
    'm5.scoreBand1':L('友善起步','友好起步','Good start'),
    'm5.scoreBand2':L('交通設計師','交通设计师','Transit designer'),
    'm5.scoreBand3':L('城市動線大師','城市动线大师','Mobility master'),
    'm5.scoreWaiting':L('完成一輪穩定計算後會顯示分數。','完成一轮稳定计算后会显示分数。','Finish a stable run to receive a score.'),
    'm5.scoreDetails':L('轉乘 {r} · 少車 {c} · 減堵 {j} · 預算效率 {e}','换乘 {r} · 少车 {c} · 减堵 {j} · 预算效率 {e}','Riders {r} · Fewer cars {c} · Less congestion {j} · Budget {e}'),
    'm5.rankTitle':L('全港沙盤排行榜','全港沙盘排行榜','Hong Kong sandbox leaderboard'),
    'm5.rankOpen':L('查看排行榜','查看排行榜','View leaderboard'),
    'm5.rankRefresh':L('刷新','刷新','Refresh'),
    'm5.rankUpload':L('上传本局成绩','上传本局成绩','Upload this score'),
    'm5.rankUploaded':L('已上传','已上传','Uploaded'),
    'm5.rankLocal':L('本机记录','本机记录','This device'),
    'm5.rankOffline':L('服务器暂时不可用，先显示本机记录。','服务器暂时不可用，先显示本机记录。','Server unavailable; showing device scores for now.'),
    'm5.rankLogin':L('登录后可参加全站排行榜。','登录后可参加全站排行榜。','Sign in to join the global leaderboard.'),
    'm5.rankEmpty':L('完成第一局后，这里会出现你的名次。','完成第一局后，这里会出现你的名次。','Finish a run and your rank will appear here.'),
    'm5.rankMe':L('我的名次：{n}','我的名次：{n}','My rank: {n}'),
    'm5.rankName':L('玩家','玩家','Player'),
    'm5.rankScore':L('分数','分数','Score'),
    'm5.rankChallenge':L('情境','情境','Scenario')
  });
  const KEY='tl-m5-leaderboard-v1', MODE='feeder/m5/sandbox';
  let latest=null, card=null, dialog=null, rows=null, busy=false, submitted=false;
  const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(Number(n))?Number(n):0));
  const fmt=n=>Math.round(Number(n)||0).toLocaleString(I.lang==='en'?'en-US':'zh-Hans-CN');
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function read(){try{const a=JSON.parse(localStorage.getItem(KEY)||'[]');if(!Array.isArray(a))return [];const best=new Map();for(const x of a){if(!x||!Number.isFinite(x.score))continue;const key=String(x.name||t('m5.rankLocal'));const old=best.get(key);if(!old||x.score>old.score)best.set(key,x);}return [...best.values()].sort((a,b)=>b.score-a.score||String(a.at).localeCompare(String(b.at))).slice(0,50);}catch(_){return [];}}
  function write(a){try{localStorage.setItem(KEY,JSON.stringify(a.slice(0,50)));}catch(_){}return a;}
  function playerName(){try{return String(root.TL_AUTH?.getUser?.()?.username||localStorage.getItem('tl-m5-player')||'').trim()||t('m5.rankLocal');}catch(_){return t('m5.rankLocal');}}
  function score(detail){
    const m=detail.metrics||{}, base=Math.max(1,Number(m.baseCarPeople||0)+Number(m.basePtPeople||0)), baseCar=Math.max(1,Number(m.baseCarPeople||base*.6)), baseJam=Math.max(1,Number(m.baseCongestion||base));
    // Demand-scaled caps stop a large map winning only because it has more people.
    const riders=clamp((Number(m.newLineRiders||0)+.35*Math.max(0,Number(m.switchedToTransit||0)))/(base*.16));
    const cars=clamp(Number(m.vehiclesReduced||0)/(baseCar/1.3*.22));
    const jam=clamp(Number(m.congestionReduced||0)/(baseJam*.16));
    const saved=clamp(Number(m.personMinutesSaved||0)/(base*7));
    const plan=detail.plan||root.TL_SANDBOX?.plan||{}, budget=Number(plan.budget||300), cost=root.SandboxEngine?.planCost?root.SandboxEngine.planCost(plan):null;
    const efficiency=cost?clamp(1-(Math.max(0,cost.total)/Math.max(1,budget))*.35,.65,1):.9;
    const quality=clamp(.32*riders+.25*cars+.25*jam+.10*saved+.08*efficiency);
    // Keep the entry score encouraging while preserving enough spread for a
    // meaningful ranking. The ceiling is 1,000 and every completed run is
    // at least 500, so a first attempt reads as progress rather than failure.
    const points=Math.min(1000,Math.round(500+450*quality+(detail.stable?50:0)));
    const band=points>=900?3:points>=760?2:points>=560?1:0;
    return {points,band,components:{riders,cars,jam,saved,efficiency},cost:cost?.total||0};
  }
  function addLocal(rec){const a=read();a.push(rec);write(a);return a;}
  function rankRows(){return rows||read().map((x,i)=>({rank:i+1,name:x.name||t('m5.rankLocal'),score:x.score,challenge:x.challenge||'—'}));}
  function ensure(){
    if(card)return;
    const map=document.querySelector('.sandbox-map'); if(!map)return;
    card=document.createElement('section');card.className='m5-score-card m5-score-floating';card.innerHTML='<div class="row"><span class="lbl" data-i18n="m5.scoreTitle"></span><div class="sp"></div><strong id="m5ScoreValue" class="m5-score-value">—</strong></div><div id="m5ScoreBand" class="m5-score-band"></div><div id="m5ScoreMeter" class="m5-score-meter"><i></i></div><p id="m5ScoreDetails" class="note"></p><p id="m5ScoreHint" class="note" data-i18n="m5.scoreWaiting"></p><button id="m5RankOpen" class="btn btn-sm" data-i18n="m5.rankOpen"></button></section>';
    // The v3 layout hides both sidebars and floats cards over the map. Mount
    // here so the score and leaderboard remain visible in that layout too.
    map.appendChild(card);I.apply();$('m5RankOpen').onclick=open;
  }
  function renderScore(){ensure();if(!card)return;const v=$('m5ScoreValue'),band=$('m5ScoreBand'),meter=$('m5ScoreMeter')?.querySelector('i'),details=$('m5ScoreDetails'),hint=$('m5ScoreHint');if(!latest){v.textContent='—';band.textContent='';if(meter)meter.style.width='0%';details.textContent='';hint.textContent=t('m5.scoreWaiting');return;}v.textContent=fmt(latest.points);band.textContent=t('m5.scoreBand'+latest.band);if(meter)meter.style.width=Math.max(4,Math.min(100,latest.points/10))+'%';details.textContent=t('m5.scoreDetails',{r:Math.round(latest.components.riders*100)+'%',c:Math.round(latest.components.cars*100)+'%',j:Math.round(latest.components.jam*100)+'%',e:Math.round(latest.components.efficiency*100)+'%'});hint.textContent=t('m5.scoreHint');}
  function currentUser(){try{return root.TL_AUTH?.getUser?.()||null;}catch(_){return null;}}
  async function fetchBoard(){
    busy=true;renderDialog();
    try{const r=await fetch('/api/game/leaderboard?mode='+encodeURIComponent(MODE)+'&limit=20',{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);const d=await r.json();const list=Array.isArray(d)?d:(d.entries||d.leaderboard||[]);rows=list.map((x,i)=>({rank:x.rank||i+1,name:x.name||x.username||'—',score:Number(x.score)||0,challenge:x.challenge||'—'}));}
    catch(_){rows=null;}
    busy=false;renderDialog();
  }
  function renderDialog(){if(!dialog)return;const list=rankRows();dialog.innerHTML='<div class="m5-rank-head"><h2>'+esc(t('m5.rankTitle'))+'</h2><button class="close" type="button">×</button></div><p class="note">'+esc(rows?'':t('m5.rankOffline'))+'</p>'+(list.length?'<table><thead><tr><th>#</th><th>'+esc(t('m5.rankName'))+'</th><th>'+esc(t('m5.rankScore'))+'</th><th>'+esc(t('m5.rankChallenge'))+'</th></tr></thead><tbody>'+list.slice(0,20).map((x,i)=>'<tr><td>'+esc(x.rank||i+1)+'</td><td>'+esc(x.name)+'</td><td><b>'+esc(fmt(x.score))+'</b></td><td>'+esc(x.challenge||'—')+'</td></tr>').join('')+'</tbody></table>':'<p>'+esc(t('m5.rankEmpty'))+'</p>')+'<div class="m5-rank-actions">'+(latest&&currentUser()?'<button id="m5RankUpload" class="btn btn-p" '+(submitted?'disabled':'')+'>'+esc(submitted?t('m5.rankUploaded'):t('m5.rankUpload'))+'</button>':'')+'<button id="m5RankRefresh" class="btn">'+esc(t('m5.rankRefresh'))+'</button></div>'+(currentUser()?'':'<p class="note">'+esc(t('m5.rankLogin'))+'</p>');dialog.querySelector('.close').onclick=()=>dialog.close();dialog.querySelector('#m5RankRefresh')?.addEventListener('click',fetchBoard);dialog.querySelector('#m5RankUpload')?.addEventListener('click',upload);}
  async function upload(){if(!latest||busy||submitted||!currentUser())return;busy=true;renderDialog();try{const r=await fetch('/api/game/leaderboard',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:MODE,score:latest.points,plan:latest.plan||{},lang:I.lang})});if(!r.ok)throw Error('HTTP '+r.status);submitted=true;await fetchBoard();}catch(_){rows=null;}finally{busy=false;renderDialog();}}
  function open(){ensure();if(!dialog){dialog=document.createElement('dialog');dialog.className='m5-rank-dialog';document.body.append(dialog);}renderDialog();if(!dialog.open)dialog.showModal();fetchBoard();}
  function onScore(e){const d=e.detail||{};if(!d.stable||!d.metrics)return;const s=score(d);const name=playerName();latest={...s,name,challenge:d.challengeTitle||d.challenge||t('m5.rankLocal'),plan:d.plan||{},at:new Date().toISOString()};submitted=false;addLocal({score:s.points,name,challenge:latest.challenge,at:latest.at});renderScore();}
  root.addEventListener('tl:sandbox-ready',ensure);root.addEventListener('tl:sandbox-score',onScore);root.addEventListener('tl:lang',()=>{renderScore();if(dialog?.open)renderDialog();});
})(typeof window!=='undefined'?window:globalThis);
