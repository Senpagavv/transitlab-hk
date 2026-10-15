// real AI in the sandbox's AI card (layout v3, #tab=ai): a sentence (+ optional «make as» mode) → level → open in its mode
// node ai_modes.js "<sentence>" <tag> [mode]
const {spawn}=require('node:child_process'),fs=require('node:fs');
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SENT=process.argv[2],TAG=process.argv[3]||'x',MODE=process.argv[4]||'';
const PORT=9333+Math.floor(Math.random()*400),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const within=(p,ms)=>Promise.race([p,new Promise((_,j)=>setTimeout(()=>j(new Error('timeout')),ms))]);
(async()=>{
  const edge=spawn(EDGE,['--headless=new','--disable-gpu','--hide-scrollbars','--window-size=1500,920',`--remote-debugging-port=${PORT}`,`--user-data-dir=F:/tmp-shots/edgeprof-aim-${Date.now()}`,'about:blank'],{stdio:'ignore'});
  try{
  let list=null;for(let i=0;i<40&&!list;i++){await sleep(250);try{list=await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();}catch(e){}}
  const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
  let id=0;const wait=new Map(),errors=[];
  ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&wait.has(m.id)){wait.get(m.id)(m);wait.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
  const send=(method,params={})=>within(new Promise(r=>{const i=++id;wait.set(i,r);ws.send(JSON.stringify({id:i,method,params}));}),30000);
  const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});return r.result.result&&r.result.result.value;};
  const click=async([x,y])=>{for(const type of ['mouseMoved','mousePressed','mouseReleased']){await send('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1});await sleep(type==='mouseMoved'?150:40);}await sleep(300);};
  const at=sel=>ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return[r.x+r.width/2,r.y+r.height/2]})()`);
  const shot=async n=>{const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`F:/tmp-shots/${n}.png`,Buffer.from(r.result.data,'base64'));};
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1500,height:920,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'http://127.0.0.1:8000/feeder/mode5-sandbox/index.html#tab=ai'});
  for(let i=0;i<80;i++){await sleep(250);if(await ev("!!(window.TL_SANDBOX_LAYOUT&&document.getElementById('aiMode'))"))break;}
  if(MODE)await ev(`(()=>{const s=document.getElementById('aiMode');s.value='${MODE}';s.dispatchEvent(new Event('change'));return s.value})()`);
  await click(await at('#aiSentence'));await send('Input.insertText',{text:SENT});
  await click(await at('#aiGenerate'));
  const t0=Date.now();let last='';
  for(let i=0;i<150;i++){await sleep(1000);const s=await ev(`document.getElementById('aiStatus').textContent`);if(s!==last){console.log(((Date.now()-t0)/1000).toFixed(0)+'s',s);last=s;}
    if(await ev(`!!document.getElementById('aiOpen')`)||/做不成/.test(s))break;}
  console.log('card:',(await ev(`document.getElementById('aiOut').innerText`)||'').replace(/\n+/g,' | ').slice(0,420));
  console.log('request:',(await ev(`document.getElementById('aiRequest').textContent`)||'').replace(/\s+/g,' ').slice(0,260));
  await shot('aim-'+TAG+'-card');
  if(await ev(`!!document.getElementById('aiOpen')`)){
    await click(await at('#aiOpen'));await sleep(6000);
    console.log('opened:',(await ev('location.href')).replace(/^.*feeder\//,''),'| pack',await ev(`JSON.stringify(window.TL_ACTIVE_PACK&&{mode:TL_ACTIVE_PACK.mode,title:TL_ACTIVE_PACK.title,tiers:TL_ACTIVE_PACK.tiers,o:TL_ACTIVE_PACK.level.origins.length,d:TL_ACTIVE_PACK.level.destinations.length,roads:(TL_ACTIVE_PACK.level.roads||[]).length,land:(TL_ACTIVE_PACK.level.land||[]).length})`));
    await ev("document.querySelectorAll('dialog[open]').forEach(d=>d.close()),1");await sleep(300);await shot('aim-'+TAG+'-board');
  }
  console.log('errors',errors.length?errors.slice(0,4):'none');ws.close();
  }finally{edge.kill();}
})().catch(e=>{console.error(e.message);process.exit(1);});
