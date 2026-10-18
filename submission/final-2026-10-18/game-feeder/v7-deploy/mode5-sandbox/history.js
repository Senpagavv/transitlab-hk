(function(root){
  'use strict';
  const I=root.I18N, L=I.L;
  I.add({
    'h.title':L('操作記錄','操作记录','Action log'),
    'h.empty':L('還未改動沙盤。','还未改动沙盘。','No sandbox actions yet.'),
    'h.note':L('每一行都是獨立操作；刪除後保留其他仍然有效的改動。','每一行都是独立操作；删除后保留其他仍然有效的改动。','Each row is independent; removing one keeps other valid changes.'),
    'h.remove':L('刪除這步','删除这步','Remove this step'),
    'h.newLine':L('新增線路','新增线路','New line'),
    'h.line':L('畫線','画线','Draw line'),
    'h.station':L('放站 / 刪站','放站 / 删站','Add / remove station'),
    'h.trainPlus':L('增加列車','增加列车','Add train'),
    'h.trainMinus':L('刪除列車','删除列车','Remove train'),
    'h.example':L('載入示範方案','载入示范方案','Load example plan'),
    'h.reset':L('清空線路方案','清空线路方案','Clear line plan'),
    'h.people':L('調整人口參數','调整人口参数','Adjust population'),
    'h.resetPeople':L('還原人口參數','还原人口参数','Reset population')
  });
  let entries=[], initial=null, host=null, list=null, note=null, setupDone=false, restoring=false;
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone=value=>JSON.parse(JSON.stringify(value==null?null:value));
  const t=(k,v)=>I.t(k,v);
  function css(){
    if(document.getElementById('m5-history-style'))return;
    const style=document.createElement('style');style.id='m5-history-style';style.textContent=`
      .m5-history{position:absolute;left:50%;bottom:82px;transform:translateX(-50%);z-index:30;width:min(440px,calc(100% - 28px));max-height:190px;padding:10px 12px;border:1px solid rgba(55,78,73,.22);border-radius:14px;background:rgba(250,249,244,.94);box-shadow:0 12px 34px rgba(26,50,45,.18);backdrop-filter:blur(10px);font-size:12px;color:#243b37;pointer-events:auto}
      [data-theme=dark] .m5-history{background:rgba(28,37,37,.94);color:#edf4ef;border-color:#71847d66}
      .m5-history-head{display:flex;align-items:center;gap:8px;margin-bottom:5px}.m5-history-head b{font-weight:600;letter-spacing:.02em}.m5-history-head .sp{flex:1}.m5-history-note{margin:0 0 6px;color:#71817b;font-size:11px;line-height:1.3}.m5-history-list{list-style:none;padding:0;margin:0;max-height:115px;overflow:auto}.m5-history-row{display:flex;align-items:center;gap:7px;padding:4px 0;border-top:1px solid rgba(82,104,98,.13)}.m5-history-row:first-child{border-top:0}.m5-history-row .idx{width:18px;height:18px;border-radius:50%;display:inline-grid;place-items:center;background:#347d63;color:white;font:500 10px 'Geist Mono',monospace;flex:0 0 18px}.m5-history-row .label{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.m5-history-row button{border:0;background:transparent;color:#9a4e49;padding:2px 5px;border-radius:6px;cursor:pointer;font-size:11px}.m5-history-row button:hover{background:#f1d8d4}.m5-history-empty{padding:4px 0;color:#71817b}.m5-history[hidden]{display:none}@media(max-width:700px){.m5-history{bottom:78px;max-height:150px}.m5-history-list{max-height:82px}}
    `;document.head.append(style);
  }
  function render(){
    if(!list)return;
    list.innerHTML=entries.length?entries.map((e,i)=>'<li class="m5-history-row"><span class="idx">'+(i+1)+'</span><span class="label">'+esc(e.label)+'</span><button type="button" data-history-remove="'+i+'" aria-label="'+esc(t('h.remove'))+'">↶</button></li>').join(''):'<li class="m5-history-empty">'+esc(t('h.empty'))+'</li>';
    const count=host.querySelector('[data-history-count]');if(count)count.textContent=entries.length?String(entries.length):'';
    note.textContent=t('h.note');host.hidden=false;
  }
  function setup(){
    if(setupDone||!root.TL_SANDBOX)return;const map=document.querySelector('.sandbox-map');if(!map)return;setupDone=true;css();host=document.createElement('section');host.id='sandboxHistory';host.className='m5-history';host.setAttribute('aria-label',t('h.title'));host.innerHTML='<div class="m5-history-head"><b data-history-title></b><span class="sp"></span><small data-history-count></small></div><p class="m5-history-note"></p><ol class="m5-history-list"></ol>';
    map.append(host);list=host.querySelector('.m5-history-list');note=host.querySelector('.m5-history-note');host.querySelector('[data-history-title]').textContent=t('h.title');render();
    host.addEventListener('click',e=>{const b=e.target.closest('[data-history-remove]');if(!b)return;const index=Number(b.dataset.historyRemove),entry=entries[index];if(!entry)return;
      // Rebuild the visible state from the initial snapshot and the remaining
      // operation deltas.  This keeps a population edit, line, station, or
      // train change removable on its own instead of rolling back everything
      // that happened afterwards.  If a later operation depended on a
      // removed line, its missing path is simply skipped.
      const base=initial||entry.before, state=clone(base), keep=entries.filter((_,i)=>i!==index);
      keep.forEach(op=>applyDelta(state,op.before,op.after)); entries=keep;
      restoring=true;try{root.TL_SANDBOX.restoreSnapshot(state);}finally{restoring=false;}
      if(!entries.length)initial=null; render();});
    root.addEventListener('tl:history-action',e=>{if(restoring)return;const d=e.detail||{};if(!d.before||!d.after)return;try{if(JSON.stringify(d.before)===JSON.stringify(d.after))return;}catch(_){}
      if(!initial)initial=clone(d.before); entries.push({kind:d.kind||'action',label:d.label||d.kind||t('h.title'),before:clone(d.before),after:clone(d.after)});render();});
    root.addEventListener('tl:lang',()=>{host.querySelector('[data-history-title]').textContent=t('h.title');host.setAttribute('aria-label',t('h.title'));render();});
  }
  const MISSING=Object.freeze({});
  function same(a,b){try{return JSON.stringify(a)===JSON.stringify(b);}catch(_){return a===b;}}
  function diff(a,b,path,out){
    if(same(a,b))return;
    const ao=a&&typeof a==='object',bo=b&&typeof b==='object';
    if(!ao||!bo||Array.isArray(a)!==Array.isArray(b)){out.push({path:path.slice(),value:clone(b)});return;}
    const keys=new Set([...Object.keys(a||{}),...Object.keys(b||{})]);
    for(const k of keys){const p=path.concat(k);if(!(k in (b||{})))out.push({path:p,value:MISSING});else if(!(k in (a||{})))out.push({path:p,value:clone(b[k])});else diff(a[k],b[k],p,out);}
  }
  function setPath(root,path,value){if(!path.length)return value;let cur=root;for(let i=0;i<path.length-1;i++){const k=path[i];if(cur==null||typeof cur!=='object')return root;if(!(k in cur))return root;cur=cur[k];}const last=path[path.length-1];if(value===MISSING){if(Array.isArray(cur))cur.splice(Number(last),1);else delete cur[last];}else if(cur&&typeof cur==='object')cur[last]=clone(value);return root;}
  function applyDelta(state,before,after){const changes=[];diff(before,after,[],changes);for(const c of changes)setPath(state,c.path,c.value);return state;}
  if(root.TL_SANDBOX)setup();else root.addEventListener('tl:sandbox-ready',setup,{once:true});
})(window);
