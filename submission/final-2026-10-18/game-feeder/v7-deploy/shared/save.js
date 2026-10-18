(function(root) {
  'use strict';
  // v7 · one saved round (2026-10-15). Leaving a level half-played (the top row, «← Five modes», closing the page) keeps
  // that round here instead of losing it; the hub then offers «continue», and opening that level again picks it up.
  // Starting a different level asks first — yes, and the saved round is gone. One slot: the newest round replaces it.
  // Each mode's page gives its round with window.TL_SAVESTATE() → {key, year?, stops?, state} and takes it back with
  // TL_SAVE.restoreFor(mode, key, apply). A finished round clears its save.
  const K='tl-save',I=root.I18N;
  if(I&&I.add){const L=I.L;I.add({
    'save.switch':L('你有一局還沒玩完：「{t}」。開始另一關，那一局就刪掉。確定嗎？','你有一局还没玩完：「{t}」。开始另一关，那一局就删掉。确定吗？','You have a round in progress: «{t}». Start another level and it is deleted. Go ahead?'),
    'save.resume':L('繼續上次','继续上次','Continue'),'save.mark':L('未完 · 點擊繼續','未完 · 点击继续','In progress · continue'),
    'save.year':L('第 {y} 年','第 {y} 年','year {y}'),'save.stops':L('已放 {n} 個站','已放 {n} 个站','{n} stops placed'),'save.start':L('還沒開通','还没开通','not opened yet')});}
  const read=()=>{try{return JSON.parse(localStorage.getItem(K)||'null');}catch(e){return null;}};
  const write=v=>{try{if(v)localStorage.setItem(K,JSON.stringify(v));else localStorage.removeItem(K);}catch(e){}};
  const API={
    get:read,
    put(mode,s){if(!s||!s.key)return;write({mode,key:s.key,year:s.year,stops:s.stops,state:s.state,at:Date.now()});},
    clear(){write(null);},
    clearIf(mode,key){const v=read();if(v&&v.mode===mode&&v.key===key)write(null);},
    is(mode,key){const v=read();return !!v&&v.mode===mode&&v.key===key;},
    // what the saved round has got to, in a few words
    line(v){v=v||read();if(!v||!I)return'';return v.year?I.t('save.year',{y:v.year}):v.stops?I.t('save.stops',{n:v.stops}):I.t('save.start');},
    // about to open (mode, key): a different level with a round saved asks first; yes deletes the save
    confirmSwitch(mode,key,title){const v=read();if(!v||v.mode===mode&&v.key===key)return true;
      if(!confirm(I.t('save.switch',{t:title||v.key})))return false;write(null);return true;},
    // a mode's page, once drawn: its saved round, if this is that level
    restoreFor(mode,key,apply){const v=read();if(!v||v.mode!==mode||v.key!==key)return false;try{apply(v.state);return true;}catch(e){write(null);return false;}}
  };
  root.TL_SAVE=API;
})(typeof window!=='undefined'?window:globalThis);
