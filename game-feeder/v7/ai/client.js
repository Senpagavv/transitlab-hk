(function(root) {
  'use strict';
  // v7 · the AI for mode 5 (2026-10-14). One sentence → a level request (the AI picks an area, a time of day and up to
  // four changes from menus; backend/feeder_ai.py holds the key and checks the answer) → the level builder
  // (shared/levelgen, task 53) cuts the area out of the Hong Kong grid and the bot sets the tiers → if the builder
  // finds a problem (too easy, nothing to solve, a place it can't find), the problem goes back to the AI once.
  // No backend or no key: the sentence is matched against the ready-made examples below, so the demo still works.
  const BASE=root.TL_AI_BASE||'/api/feeder/ai';
  // ready-made level requests (same format as the AI's), for the static site and for when the AI is down
  const EXAMPLES=[
    {keys:['啟德','启德','kai tak'],request:{area:'kowloon-east',period:'am',mode:3,
      changes:[{place:'啟德',what:'people',pct:50,by_year:4}],
      title:'啟德再多五萬人',story:['假設啟德新屋苑在四年內陸續入伙，住的人多一半。','畫一條線，別讓觀塘繞道塞死。'],note:'啟德住的人 +50%，四年內'}},
    {keys:['沙田','sha tin','第一城'],request:{area:'sha-tin-tai-wai',period:'am',mode:3,
      changes:[{place:'沙田',what:'people',pct:30}],
      title:'沙田多三萬人',story:['假設沙田一帶多了三成住的人。','早上大家都往九龍去，路和地鐵頂得住嗎？'],note:'沙田住的人 +30%'}},
    {keys:['銅鑼灣','铜锣湾','周末','假日','節日','节日','causeway'],request:{area:'causeway-bay-wan-chai',period:'holiday',mode:3,
      changes:[{place:'銅鑼灣',what:'jobs',pct:60}],
      title:'銅鑼灣假日人潮',story:['假設假日去銅鑼灣購物的人多了六成。','人潮湧來，怎樣不讓軒尼詩道塞住？'],note:'銅鑼灣吸引力 +60%，節假日'}},
    {keys:['隧道','封','將軍澳','将军澳','tko'],request:{area:'tseung-kwan-o',period:'am',mode:3,
      changes:[{place:'將軍澳隧道',what:'road_cap',pct:-40}],
      title:'將軍澳隧道封一條線',story:['假設將軍澳隧道維修，少了四成車能過。','早上出九龍的車怎麼辦？'],note:'將軍澳隧道 −40%'}},
    {keys:['北部都會','北部都会','北都','新田','古洞','northern'],request:{area:'northern-metropolis',period:'am',mode:3,
      changes:[{place:'新田',what:'jobs',pct:100,by_year:6},{place:'古洞',what:'people',pct:80,by_year:6}],
      title:'北都新田科技城',story:['假設新田科技城六年內建成，古洞多住八成人。','新的工作和新的家之間，要一條怎樣的線？'],note:'新田岗位 +100%、古洞住的人 +80%，六年內'}}];
  const low=s=>String(s||'').toLowerCase();
  function pickExample(sentence){const s=low(sentence);let best=null,hits=0;
    for(const e of EXAMPLES){const h=e.keys.filter(k=>s.includes(low(k))).length;if(h>hits){hits=h;best=e;}}
    return best?JSON.parse(JSON.stringify(best.request)):null;}
  async function call(path,body){
    if(root.TL_SITE?.ai===false){const err=new Error('examples_only');err.code='examples_only';throw err;}
    let r;try{r=await fetch(BASE+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});}
    catch(e){const err=new Error('offline');err.code='offline';throw err;}
    let j={};try{j=await r.json();}catch(e){}
    if(!r.ok){const err=new Error(j.message||('HTTP '+r.status));err.code=j.code||(r.status===503?'no_key':'http_'+r.status);err.problems=j.problems;throw err;}
    return j;}
  async function status(){if(root.TL_SITE?.ai===false)return{ready:false,examples:true};try{return await call('/status');}catch(e){return{ready:false,offline:e.code==='offline'};}}
  // sentence → {request, level, report, source:'ai'|'example', tries, notes}
  //   build(request) → {level, report, problems} or a promise of it (problems: [{code, message}] from the level builder;
  //   [] = playable)
  //   names: {areaKey: [place names inside it]} from the Hong Kong grid, so the AI picks real names
  async function generate(sentence,{lang='zh-Hans',names=null,build,onStep=()=>{},tries=2}={}){
    let feedback=null,last=null;
    for(let t=1;t<=tries;t++){
      let request,source='ai',notes=[];
      onStep({step:'ask',try:t});
      try{const j=await call('/level',{sentence,lang,names,feedback});request=j.request;notes=j.notes||[];}
      catch(e){if(e.code==='refuse')throw e;
        request=pickExample(sentence);source='example';
        if(!request){const err=new Error(e.code==='examples_only'?({'zh-Hant':'請試啟德、沙田、銅鑼灣、將軍澳隧道或北部都會區。','zh-Hans':'请试启德、沙田、铜锣湾、将军澳隧道或北部都会区。',en:'Try Kai Tak, Sha Tin, Causeway Bay, TKO tunnel or Northern Metropolis.'}[lang]||'Try Kai Tak') : e.code==='offline'||e.code==='no_key'?'AI 暂时用不了，也没有对得上的示例':e.message);err.code=e.code;throw err;}}
      onStep({step:'build',try:t,request,source});
      const out=build?await build(request):{level:null,report:null,problems:[]};
      last={...out,request,source,tries:t,notes};
      if(!out.problems||!out.problems.length||source==='example')return last;
      feedback=out.problems.map(p=>({code:p.code,message:p.message}));onStep({step:'retry',try:t,problems:feedback});}
    return last;}
  // a commentary from the AI, checked server-side to use only the game's numbers; without the AI, a plain one
  async function comment(summary,{lang='zh-Hans'}={}){
    if(root.TL_SITE?.ai===false)return{text:plainComment(summary,lang),source:'plain'};
    try{const j=await call('/comment',{summary,lang});return{text:j.comment,source:'ai'};}
    catch(e){return{text:plainComment(summary,lang),source:'plain'};}}
  function plainComment(s,lang){const t=s.tiers||[],sc=Math.round(s.score||0);
    const tier=sc>=t[2]?2:sc>=t[1]?1:sc>=t[0]?0:-1;
    const L={'zh-Hant':['還沒過關','過關了','拿到高分','到了大師線'],'zh-Hans':['还没过关','过关了','拿到高分','到了大师线'],en:['not passed yet','passed','high score','master line']}[lang]||[];
    const lead=lang==='en'?`Score ${sc}: ${L[tier+1]}.`:`${sc} 分，${L[tier+1]}。`;
    const r=(s.roads||[])[0];
    const road=r?(lang==='en'?` The biggest change: ${r.name}, ${r.carsBefore} → ${r.carsAfter} cars.`:` 變化最大的是${r.name}：${r.carsBefore} → ${r.carsAfter} 輛。`):'';
    return lead+road;}
  const API={status,generate,comment,pickExample,plainComment,EXAMPLES,base:BASE};
  if(typeof module!=='undefined')module.exports=API;root.TLAI=API;
})(typeof window!=='undefined'?window:globalThis);
