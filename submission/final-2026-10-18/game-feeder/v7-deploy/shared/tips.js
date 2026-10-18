(function(root) {
  'use strict';
  // TransitLab feeder suite · v7 shared one-line tips for teaching levels.
  // Not a step-by-step tutorial: a level lists a few moments (first load, all stops placed, first full stop, first
  // break…) and a tip shows once, when that moment first happens, beside the thing it talks about. It never pauses
  // the game and never blocks a click. Seen tips are remembered in this browser; "no more tips" turns them all off.
  //   Tips.setup(scope, {start:'tip.start', placed:'tip.placed', …})   per level (an empty object: no tips)
  //   Tips.fire('placed', anchor)   anchor: an element, a DOMRect, or {x, y} in screen pixels
  // Off in the address with #tips=0 (screenshots, bots).
  const OFF='tl-tips-off',SEEN='tl-tips-seen-';
  const store={get(k){try{return localStorage.getItem(k);}catch(e){return null;}},set(k,v){try{localStorage.setItem(k,v);}catch(e){}}};
  const t=k=>root.I18N?root.I18N.t(k):k;
  let scope='',items={},queue=[],box=null,showing=null;
  const disabled=()=>store.get(OFF)==='1'||/(?:^|[#&])tips=0/.test(typeof location!=='undefined'?location.hash:'');
  const seen=()=>{try{return new Set(JSON.parse(store.get(SEEN+scope)||'[]'));}catch(e){return new Set();}};
  function mark(id){const s=seen();s.add(id);store.set(SEEN+scope,JSON.stringify([...s]));}
  function ensureBox(){
    if(box)return box;
    box=document.createElement('div');box.className='tipbox';box.setAttribute('role','status');box.setAttribute('aria-live','polite');
    box.innerHTML='<p class="tiptext"></p><div class="tipbtns"><button class="btn btn-sm tipoff"></button><button class="btn btn-sm btn-p tipok"></button></div>';
    box.querySelector('.tipok').onclick=()=>{hide();next();};
    box.querySelector('.tipoff').onclick=()=>{store.set(OFF,'1');queue=[];hide();};
    document.body.appendChild(box);return box;
  }
  function rectOf(a){
    if(!a)return null;
    if(a.getBoundingClientRect)return a.getBoundingClientRect();
    if(a.width!==undefined)return a;
    return{left:a.x,top:a.y,right:a.x,bottom:a.y,width:0,height:0};
  }
  function place(rect){
    const b=ensureBox(),W=innerWidth,H=innerHeight,bw=Math.min(320,W-24);b.style.width=bw+'px';
    const bh=b.offsetHeight||110;
    let x=rect?rect.left+rect.width/2-bw/2:W/2-bw/2,y=rect?rect.bottom+12:H/2-bh/2;
    if(rect&&y+bh>H-12)y=rect.top-bh-12;                 // no room below: above
    x=Math.max(12,Math.min(W-bw-12,x));y=Math.max(12,Math.min(H-bh-12,y));
    b.style.left=x+'px';b.style.top=y+'px';
  }
  function show(id,anchor){
    const b=ensureBox();showing=id;
    b.querySelector('.tiptext').textContent=t(items[id]);
    b.querySelector('.tipok').textContent=t('tip.ok');b.querySelector('.tipoff').textContent=t('tip.off');
    b.classList.add('on');place(rectOf(typeof anchor==='function'?anchor():anchor));mark(id);
  }
  function hide(){if(box)box.classList.remove('on');showing=null;}
  function next(){const n=queue.shift();if(n)show(n.id,n.anchor);}
  const Tips={
    setup(s,list){scope=s;items=list||{};queue=[];hide();},
    fire(id,anchor){
      if(!items[id]||disabled()||seen().has(id)||showing===id||queue.some(q=>q.id===id))return false;
      if(showing)queue.push({id,anchor});else show(id,anchor);
      return true;},
    hide,
    reset(){store.set(OFF,'0');store.set(SEEN+scope,'[]');},     // show this level's tips again
    get showing(){return showing;}
  };
  if(typeof window!=='undefined')window.addEventListener('tl:lang',()=>{if(showing&&box){box.querySelector('.tiptext').textContent=t(items[showing]);
    box.querySelector('.tipok').textContent=t('tip.ok');box.querySelector('.tipoff').textContent=t('tip.off');}});
  root.Tips=Tips;
})(typeof window!=='undefined'?window:globalThis);
