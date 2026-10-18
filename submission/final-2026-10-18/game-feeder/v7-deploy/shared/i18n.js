(function(root) {
  'use strict';
  // TransitLab feeder suite · v7 shared language engine (every mode loads this first, then its own strings.js).
  // Languages: 繁體中文 (default), 简体中文, English, Español, 日本語, Қазақша, 한국어. Display titles stay in English in every language; the
  // Chinese line under them follows the language and is left out in English. Estate names stay in Chinese.
  // A mode adds its texts with I18N.add({key: I18N.L(hant, hans, en), …}) — later additions override earlier ones —
  // then calls I18N.apply(). Static markup: data-i18n, data-i18n-html, data-i18n-title, data-i18n-aria.
  const LANGS=['zh-Hant','zh-Hans','en','es','ja','kk','ko'];
  const EXTRA_LANGS=['es','ja','kk','ko'];
  const L=(hant,hans,en,extras={})=>Object.assign({'zh-Hant':hant,'zh-Hans':hans,en},extras);
  const S={};
  const DIST={'东区':['東區','Eastern'],'中西区':['中西區','Central & Western'],'九龙城区':['九龍城區','Kowloon City'],'元朗区':['元朗區','Yuen Long'],
    '北区':['北區','North'],'南区':['南區','Southern'],'大埔区':['大埔區','Tai Po'],'屯门区':['屯門區','Tuen Mun'],'沙田区':['沙田區','Sha Tin'],
    '油尖旺区':['油尖旺區','Yau Tsim Mong'],'深水埗区':['深水埗區','Sham Shui Po'],'湾仔区':['灣仔區','Wan Chai'],'离岛区':['離島區','Islands'],
    '荃湾区':['荃灣區','Tsuen Wan'],'葵青区':['葵青區','Kwai Tsing'],'西贡区':['西貢區','Sai Kung'],'观塘区':['觀塘區','Kwun Tong'],'黄大仙区':['黃大仙區','Wong Tai Sin']};
  const pick=(/(?:^|[#&])lang=([\w-]+)/.exec(typeof location!=='undefined'?location.hash:'')||[])[1];
  // tlhk-lang: the language a hosting TransitLab site saved (same codes); used until the player picks one here
  let saved=null;try{saved=localStorage.getItem('tl-lang')||localStorage.getItem('tlhk-lang');}catch(e){}
  let lang=LANGS.includes(pick)?pick:LANGS.includes(saved)?saved:saved?'en':'zh-Hant';   // a site language the game lacks → English
  function t(key,vars){
    const e=S[key];let s=e?(e[lang]??e.en??e['zh-Hant']):key;
    if(vars)s=s.replace(/\{(\w+)\}/g,(m,k)=>vars[k]!==undefined?vars[k]:m);
    return s;
  }
  function apply(scope){
    const el=scope||document;
    el.querySelectorAll('[data-i18n]').forEach(n=>{n.textContent=t(n.dataset.i18n);});
    el.querySelectorAll('[data-i18n-html]').forEach(n=>{n.innerHTML=t(n.dataset.i18nHtml);});
    el.querySelectorAll('[data-i18n-title]').forEach(n=>{n.title=t(n.dataset.i18nTitle);});
    el.querySelectorAll('[data-i18n-aria]').forEach(n=>{n.setAttribute('aria-label',t(n.dataset.i18nAria));});
    // an empty translation (the Chinese line in English) hides its element
    el.querySelectorAll('[data-i18n],[data-i18n-html]').forEach(n=>{n.hidden=!n.textContent&&!n.children.length;});
    document.documentElement.lang=lang;
    document.querySelectorAll('#langSeg [data-lang]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.lang===lang)));
    const more=document.getElementById('langMore'); if(more) more.value=EXTRA_LANGS.includes(lang)?lang:'';
  }
  function set(next){
    if(!LANGS.includes(next)||next===lang)return;lang=next;
    if(typeof document==='undefined')return;            // node tests
    try{localStorage.setItem('tl-lang',lang);}catch(e){}
    apply();root.dispatchEvent(new CustomEvent('tl:lang',{detail:lang}));
  }
  const hans=()=>lang==='zh-Hans';
  const API={LANGS,L,t,apply,set,add:o=>Object.assign(S,o),has:k=>k in S,get lang(){return lang;},
    name:o=>hans()?(o.hans||o.name):(lang==='zh-Hant'?o.name:(o.en||o.name)),
    short:o=>hans()?(o.shortHans||o.short||o.hans||o.name):(lang==='zh-Hant'?(o.short||o.name):(o.shortEn||o.en||o.short||o.name)),
    station:st=>lang==='zh-Hant'?st['zh-Hant']:(lang==='zh-Hans'?st['zh-Hans']:(st.en||st['zh-Hant']||'')),
    district:d=>{const v=DIST[d];return !v?d:lang==='zh-Hans'?d:(lang==='zh-Hant'?v[0]:v[1]);}};
  root.I18N=API;
  if(typeof document!=='undefined'){
    document.querySelectorAll('#langSeg [data-lang]').forEach(b=>b.addEventListener('click',()=>set(b.dataset.lang)));
    const more=document.getElementById('langMore'); if(more) more.addEventListener('change',()=>{if(more.value)set(more.value);});
  }   // the mode's strings.js calls apply() once its texts are in
})(typeof window!=='undefined'?window:globalThis);

