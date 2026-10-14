(function() {
  'use strict';
  // v7 · the row of stops under the top bar, the same on every mode's page: 01 … 05, the current one filled in.
  // <nav id="navrow" data-current="2"></nav> + this script (after i18n.js). It also adds the few labels all pages share. A click goes to that mode's page — the
  // bundled single file when this page is one (its name is not index.html), else the folder's index.html.
  const I=window.I18N,L=I.L;
  I.add({
    'nav.aria':L('五個模式','五个模式','Five modes'),
    'nav.m1':L('車站與步行','车站与步行','Stations & walking'),'nav.m2':L('地鐵','地铁','The metro'),'nav.m3':L('路會塞','路会塞','Roads that jam'),
    'nav.m4':L('站旁開發','站旁开发','Station-side development'),'nav.m5':L('沙盤 · 即將推出','沙盘 · 即将推出','Sandbox · soon'),
    // the labels every mode's page shares with mode 1 (mode 1's own strings load after this and keep theirs)
    'g.goalLbl':L('Goal · 目標','Goal · 目标','Goal'),'g.read':L('How to read the map · 怎麼看','How to read the map · 怎么看','How to read the map'),
    'g.log':L('Dispatch log · 調度提示','Dispatch log · 调度提示','Dispatch log'),'g.lvInfo':L('本關','本关','About'),'m.back':L('← 五個模式','← 五个模式','← Five modes')
  });
  const MODES=[
    {n:1,en:'Stations',dir:'mode1-bus',file:'模式1-车站与步行.html'},
    {n:2,en:'The metro',dir:'mode2-metro',file:'模式2-地铁.html'},
    {n:3,en:'Roads that jam',dir:'mode3-roads',file:'模式3-路会塞.html'},
    {n:4,en:'Station-side development',dir:'mode4-tod',file:'模式4-站旁开发.html'},
    {n:5,en:'Sandbox',soon:true}];
  const nav=document.getElementById('navrow');if(!nav)return;
  const cur=+nav.dataset.current||0,bundled=!/index\.html$|\/$/.test(location.pathname)&&!/editor\.html$/.test(location.pathname);
  function render(){
    nav.setAttribute('aria-label',I.t('nav.aria'));
    nav.innerHTML=MODES.map(m=>`<button data-go="${m.n}" aria-selected="${m.n===cur}" ${m.soon?'disabled':''}><i class="stop">0${m.n}</i><span class="t"><b>${m.en}</b><s>${I.t('nav.m'+m.n)}</s></span></button>`).join('');}
  nav.addEventListener('click',e=>{const b=e.target.closest('[data-go]');if(!b||b.disabled)return;const m=MODES[+b.dataset.go-1];if(m.n===cur||m.soon)return;
    location.href=`../${m.dir}/${bundled?m.file:'index.html'}`;});
  render();window.addEventListener('tl:lang',render);
})();

