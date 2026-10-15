// the restyled data map (task 60) by mouse: home, the metric list, click a zone, search 沙田, the back link; desktop + phone
const {spawn}=require('node:child_process'),fs=require('node:fs');
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',PORT=9333+Math.floor(Math.random()*400),sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const edge=spawn(EDGE,['--headless=new','--disable-gpu','--hide-scrollbars',`--remote-debugging-port=${PORT}`,`--user-data-dir=F:/tmp-shots/edgeprof-dm-${Date.now()}`,'about:blank'],{stdio:'ignore'});
 try{let list=null;for(let i=0;i<40&&!list;i++){await sleep(250);try{list=await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();}catch(e){}}
 const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const w=new Map(),errors=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w.has(m.id)){w.get(m.id)(m);w.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push('console: '+m.params.args.map(a=>a.value||a.description).join(' ').slice(0,160));};
 const send=(method,params={})=>new Promise(r=>{const i=++id;w.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
 const ev=async e=>(await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true})).result.result.value;
 const click=async([x,y])=>{for(const type of ['mouseMoved','mousePressed','mouseReleased']){await send('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1});await sleep(type==='mouseMoved'?150:40);}await sleep(400);};
 const at=sel=>ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;const r=el.getBoundingClientRect();return[r.x+r.width/2,r.y+r.height/2]})()`);
 const shot=async n=>{const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`F:/tmp-shots/${n}.png`,Buffer.from(r.result.data,'base64'));console.log('shot',n);};
 await send('Runtime.enable');await send('Page.enable');
 for(const [W,H,tag] of [[1500,920,'dm-desk'],[390,844,'dm-phone']]){
  await send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:W<500});
  await send('Page.navigate',{url:'http://127.0.0.1:8000/'});await sleep(9000);
  console.log(tag,'metrics:',await ev(`[...document.querySelectorAll('select option')].map(o=>o.textContent).join(' | ')`));
  console.log(tag,'back link:',await ev(`(document.querySelector('.hub-link')||{}).getAttribute&&document.querySelector('.hub-link').getAttribute('href')`),'| overflow x',await ev('document.documentElement.scrollWidth-innerWidth'));
  await shot(tag+'-home');
  // click the middle of the map (a zone)
  await click([W*0.62,H*0.5]);await sleep(800);
  console.log(tag,'zone panel:',(await ev(`(document.querySelector('.zone-panel,[class*=ZonePanel],[class*=zone-panel]')||{}).innerText||''`)).replace(/\n+/g,' | ').slice(0,140));
  await shot(tag+'-zone');
  // search 沙田
  const box=await at('input[type=search],input');await click(box);await send('Input.insertText',{text:'沙田'});await sleep(1500);
  console.log(tag,'suggestions:',(await ev(`[...document.querySelectorAll('[role=option],li')].slice(0,4).map(x=>x.textContent.trim()).join(' / ')`)).slice(0,160));
  await shot(tag+'-search');
 }
 // the back link goes to the hub's 05
 await send('Emulation.setDeviceMetricsOverride',{width:1500,height:920,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:'http://127.0.0.1:8000/'});await sleep(6000);
 await click(await at('.hub-link'));await sleep(4000);console.log('after back link:',(await ev('location.href')).replace('http://127.0.0.1:8000',''));
 console.log('errors',errors.length?errors.slice(0,6):'none');ws.close();}finally{edge.kill();}})();
