(function(root) {
  'use strict';
  // v7 · progress in this browser (2026-10-14): each level's best score and tier, written when its result shows.
  // The hub opens a mode's levels one after another: the first (by `order` in levels/registry.js) is open, the next
  // opens when the one before it is passed. #unlock=all in the hub's address opens everything (for testing and demos).
  const K='tl-progress';
  const read=()=>{try{return JSON.parse(localStorage.getItem(K)||'{}');}catch(e){return{};}};
  function record(mode,key,score,tiers){
    const all=read(),id=mode+'/'+key,t=tiers||[0,0,0],tier=score>=t[2]?3:score>=t[1]?2:score>=t[0]?1:0,was=all[id]||{best:0,tier:0};
    all[id]={best:Math.max(was.best,score),tier:Math.max(was.tier,tier),at:Date.now()};
    try{localStorage.setItem(K,JSON.stringify(all));}catch(e){}
    return all[id];}
  const get=(mode,key)=>read()[mode+'/'+key]||null;
  const passed=(mode,key)=>((get(mode,key)||{}).tier||0)>=1;
  function open(mode,key){
    if(typeof location!=='undefined'&&/(?:^|[#&])unlock=all/.test(location.hash))return true;
    const L=root.TL_LEVELS?root.TL_LEVELS.mode(mode):[],i=L.findIndex(l=>l.key===key);
    return i<=0||passed(mode,L[i-1].key);}
  root.TLProgress={record,get,passed,open};
})(typeof window!=='undefined'?window:globalThis);
