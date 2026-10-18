(function() {
  'use strict';
  // v7 · the second half of the hub's hand-off (2026-10-15). The hub fades its map but leaves the dots round the level
  // where they were on screen, writes them to sessionStorage ('tl-flyin') and opens this page. Here the dots are drawn
  // at the same places (the level's map and side columns hidden; the top bar stays, as on the hub), then fly onto this
  // level's own board — as in v3: roads and lines take the grey dots, estates and the places people go the dark ones —
  // and the page shows through.
  // Each mode's page says where its blocks are with window.TL_BOARD.targets() → {items:[{p:[x,y],w,h,color,kind}],hub}
  // (screen pixels; kind 'road' | 'house' | 'hub'). Loaded first thing in <body>; does nothing without a hand-off.
  let data=null;
  try{data=JSON.parse(sessionStorage.getItem('tl-flyin')||'null');sessionStorage.removeItem('tl-flyin');}catch(e){}
  if(!data||!data.dots||Date.now()-data.at>8000)return;
  const root=document.documentElement;root.classList.add('flyin');
  if(data.dark!==undefined)root.setAttribute('data-theme',data.dark?'dark':'light');   // the sheet in the hub's colours
  // the page's own dialogs (the level's opening card) wait until the board is built
  const show=HTMLDialogElement.prototype.showModal,queued=[];let busy=true;
  HTMLDialogElement.prototype.showModal=function(){if(busy){queued.push(this);return;}return show.call(this);};
  const style=document.createElement('style');
  style.textContent='html.flyin #app{opacity:0}#app{transition:opacity .45s ease}'+
    '.tl-flyin{position:fixed;inset:0;z-index:150;pointer-events:none}.tl-flyin canvas{position:absolute;left:0;top:0}';
  document.head.appendChild(style);
  const wrap=document.createElement('div');wrap.className='tl-flyin';wrap.innerHTML='<canvas></canvas>';
  const cv=wrap.querySelector('canvas'),ctx=cv.getContext('2d');
  const clamp=v=>v<0?0:v>1?1:v,easeInOut=u=>u<.5?4*u*u*u:1-Math.pow(-2*u+2,3)/2,easeOut=u=>1-Math.pow(1-u,3);
  function rgba(c){c=String(c||'').trim();if(c.charAt(0)==='#'){const n=parseInt(c.slice(1,7),16);return[n>>16&255,n>>8&255,n&255,1];}
    const m=c.match(/[\d.]+/g)||[0,0,0,1];return[+m[0],+m[1],+m[2],m[3]===undefined?1:+m[3]];}
  function size(){const dpr=Math.min(2,window.devicePixelRatio||1);cv.width=Math.round(innerWidth*dpr);cv.height=Math.round(innerHeight*dpr);
    cv.style.width=innerWidth+'px';cv.style.height=innerHeight+'px';return dpr;}
  const FLY=760,SPREAD=620,END=160+SPREAD+FLY+140;
  function finish(){busy=false;HTMLDialogElement.prototype.showModal=show;root.classList.remove('flyin');
    cv.style.transition='opacity .45s ease';cv.style.opacity='0';
    setTimeout(()=>{wrap.remove();queued.forEach(d=>{if(d.isConnected&&!d.open)show.call(d);});},480);}
  function run(){
    document.body.appendChild(wrap);
    const B=window.TL_BOARD&&window.TL_BOARD.targets&&window.TL_BOARD.targets();
    if(!B||!B.items||!B.items.length){finish();return;}
    const dpr=size(),dark=data.dark!==undefined?data.dark:root.getAttribute('data-theme')==='dark',ink=rgba(dark?'#F5F5F5':'#0A0A0A');
    // blocks from the station outwards, so the board assembles like a ripple leaving it
    const items=B.items.slice().sort((a,b)=>(a.kind==='hub'?-1:0)-(b.kind==='hub'?-1:0)||Math.hypot(a.p[0]-B.hub[0],a.p[1]-B.hub[1])-Math.hypot(b.p[0]-B.hub[0],b.p[1]-B.hub[1]));
    const dots=data.dots,n=items.length,parts=[];
    for(let j=0;j<n;j++){
      // more blocks than dots: the rest rise from the station
      const s=dots[j]||{x:B.hub[0],y:B.hub[1],r:1.4,a:.3},d=items[j];
      parts.push({x0:s.x,y0:s.y,r0:Math.max(1.4,s.r),a0:s.a,x1:d.p[0],y1:d.p[1],w1:d.w,h1:d.h,c1:rgba(d.color),delay:160+SPREAD*(j/Math.max(1,n-1)),house:d.kind!=='road'});}
    const spare=dots.slice(n);   // dots with nowhere to land fade where they are
    const order=parts.filter(x=>!x.house).concat(parts.filter(x=>x.house));
    const T0=performance.now();let done=false;
    setTimeout(()=>{if(!done){done=true;finish();}},END+800);
    (function frame(now){
      if(done)return;
      const u=now-T0;
      ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,innerWidth,innerHeight);
      const fade=1-easeOut(clamp(u/520));
      for(const s of spare){if(fade<=0)break;ctx.fillStyle='rgba('+ink.slice(0,3).join(',')+','+(s.a*fade).toFixed(3)+')';ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,6.2832);ctx.fill();}
      for(const x of order){
        const v=clamp((u-x.delay)/FLY),e=easeInOut(v),sc=easeOut(clamp((v-.55)/.45));
        const px=x.x0+(x.x1-x.x0)*e,py=x.y0+(x.y1-x.y0)*e;
        // a dot first, then it opens out into its block as it lands
        const w=2*x.r0+(x.w1-2*x.r0)*sc,hgt=2*x.r0+(x.h1-2*x.r0)*sc,rad=Math.min(w,hgt)/2*(1-sc)+(x.house?3:1.5)*sc;
        const c=[0,1,2].map(z=>Math.round(ink[z]+(x.c1[z]-ink[z])*sc)),a=x.a0+(Math.max(.9,x.c1[3])-x.a0)*easeOut(v);
        ctx.fillStyle='rgba('+c[0]+','+c[1]+','+c[2]+','+a.toFixed(3)+')';
        ctx.beginPath();if(ctx.roundRect)ctx.roundRect(px-w/2,py-hgt/2,w,hgt,rad);else ctx.rect(px-w/2,py-hgt/2,w,hgt);ctx.fill();}
      if(u>=END){done=true;finish();return;}
      requestAnimationFrame(frame);
    })(T0);
  }
  // draw the dots at once (the page is still loading underneath), fly when the page has drawn its board
  function early(){document.body.appendChild(wrap);const dpr=size(),dark=data.dark!==undefined?data.dark:root.getAttribute('data-theme')==='dark',ink=dark?'245,245,245':'10,10,10';
    ctx.setTransform(dpr,0,0,dpr,0,0);for(const s of data.dots){ctx.fillStyle='rgba('+ink+','+s.a+')';ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,6.2832);ctx.fill();}}
  if(document.body)early();else document.addEventListener('DOMContentLoaded',early);
  // fly once the page has drawn its board (not on «load»: that waits for the web fonts)
  const go=()=>requestAnimationFrame(()=>requestAnimationFrame(run));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();
})();
