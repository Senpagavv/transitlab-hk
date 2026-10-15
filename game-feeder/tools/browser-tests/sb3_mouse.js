// the sandbox's third layout by mouse: hover a zone → the data card; ⌁ draw a line; ▣ select zones → only this area →
// run a round (time it); people card; AI card; play this area in mode 3
const {spawn}=require('node:child_process'),fs=require('node:fs');
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL='http://127.0.0.1:8000/feeder/mode5-sandbox/index.html';
const PORT=9333+Math.floor(Math.random()*400),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const within=(p,ms)=>Promise.race([p,new Promise((_,j)=>setTimeout(()=>j(new Error('timeout')),ms))]);
(async()=>{
  const edge=spawn(EDGE,['--headless=new','--disable-gpu','--hide-scrollbars','--window-size=1500,920',`--remote-debugging-port=${PORT}`,`--user-data-dir=F:/tmp-shots/edgeprof-sb3-${Date.now()}`,'about:blank'],{stdio:'ignore'});
  try{
  let list=null;for(let i=0;i<40&&!list;i++){await sleep(250);try{list=await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();}catch(e){}}
  const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
  let id=0;const wait=new Map(),errors=[];
  ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&wait.has(m.id)){wait.get(m.id)(m);wait.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
  const send=(method,params={})=>within(new Promise(r=>{const i=++id;wait.set(i,r);ws.send(JSON.stringify({id:i,method,params}));}),60000);
  const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});return r.result.result&&r.result.result.value;};
  const mouse=(type,[x,y],extra={})=>send('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1,...extra});
  const click=async(p,mod=0)=>{await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p[0],y:p[1]});await sleep(80);await mouse('mousePressed',p,{modifiers:mod});await sleep(40);await mouse('mouseReleased',p,{modifiers:mod});await sleep(250);};
  const drag=async pts=>{await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:pts[0][0],y:pts[0][1]});await mouse('mousePressed',pts[0]);for(const p of pts.slice(1)){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p[0],y:p[1],buttons:1});await sleep(40);}await mouse('mouseReleased',pts.at(-1));await sleep(300);};
  const at=sel=>ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;const r=el.getBoundingClientRect();return[r.x+r.width/2,r.y+r.height/2]})()`);
  const zoneXY=id=>ev(`(()=>{const b=TL_SANDBOX.base,i=b.zones.findIndex(z=>String(z.id)===${JSON.stringify(id)}),z=b.zones[i];return TL_SANDBOX.toPage(z.cell[0]+.5,z.cell[1]+.5)})()`);
  const shot=async n=>{const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`F:/tmp-shots/${n}.png`,Buffer.from(r.result.data,'base64'));console.log('shot',n);};
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1500,height:920,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:URL});
  for(let i=0;i<60;i++){await sleep(250);if(await ev('!!window.TL_SANDBOX_LAYOUT'))break;}
  const ok=await at('dialog[open] .btn-p');if(ok)await click(ok);
  // look: zoom onto Kowloon East, hover a zone
  await ev("TL_SANDBOX.fitBox([95,65,111,77]),1");await sleep(500);
  const p1=await zoneXY('214');await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p1[0]-3,y:p1[1]});await sleep(100);await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p1[0],y:p1[1]});await sleep(500);
  console.log('hover → data card:',(await ev(`document.getElementById('dataContent').innerText`)||'').replace(/\n+/g,' | ').slice(0,160));
  await shot('sb3-1-hover');
  // ⌁ draw a line across Kowloon East
  await click(await at('.sb-dock [data-tool="line"]'));
  console.log('tool',await ev('TL_SANDBOX.tool'),'card',await ev('TL_SANDBOX_LAYOUT.page'));
  const a=await ev('TL_SANDBOX.toPage(97.5,70.5)'),b=await ev('TL_SANDBOX.toPage(108.5,70.5)'),c=await ev('TL_SANDBOX.toPage(108.5,74.5)');
  await drag([a,[ (a[0]+b[0])/2,a[1]],b,c]);
  await click(await at('.sb-dock [data-tool="station"]'));for(const q of [a,b,c])await click(q);
  console.log('plan',await ev('JSON.stringify(TL_SANDBOX.plan.lines.map(l=>[l.cells.length,l.stations.length,l.trains]))'),'| note',await ev(`document.getElementById('mapMessage').className+' '+document.getElementById('mapMessage').textContent.slice(0,60)`));
  await shot('sb3-2-line');
  // ▣ select three zones, only this area, run a round (timed)
  await click(await at('.sb-dock [data-tool="select"]'));
  const zs=await ev(`TL_SANDBOX.base.zones.map((z,i)=>({id:String(z.id),d:Math.abs(z.cell[0]-103)+Math.abs(z.cell[1]-71),p:z.pop})).filter(x=>x.p>0).sort((a,b)=>a.d-b.d).slice(0,3).map(x=>x.id)`);let first=true;for(const z of zs){const p=await zoneXY(z);await click(p,first?0:8);first=false;}
  console.log('selected',await ev('TL_SANDBOX.selected().length'),'|',await ev(`document.querySelector('.sb-seln').textContent`));
  await click(await at('#focusSel'));await sleep(500);
  console.log('scope',await ev('JSON.stringify(TL_SANDBOX.scope)'),'|',await ev(`document.querySelector('.sb-scope').innerText`));
  for(let i=0;i<60;i++){await sleep(250);if(!await ev(`document.getElementById('runStep').disabled`))break;}
  let t0=Date.now();await click(await at('#runStep'));
  for(let i=0;i<120;i++){await sleep(250);if(!await ev(`document.getElementById('runStep').disabled`))break;}
  console.log('scoped round',((Date.now()-t0)/1000).toFixed(1)+'s','| hud',await ev(`[...document.querySelectorAll('.sb-result .sandbox-hud b')].map(b=>b.textContent).join(' / ')`));
  await shot('sb3-3-scoped');
  // back to all of Hong Kong, run a round (timed)
  await click(await at('.sb-scope button'));await sleep(300);
  for(let i=0;i<80;i++){await sleep(250);if(!await ev(`document.getElementById('runStep').disabled`))break;}
  t0=Date.now();await click(await at('#runStep'));
  for(let i=0;i<160;i++){await sleep(250);if(!await ev(`document.getElementById('runStep').disabled`))break;}
  console.log('whole-HK round',((Date.now()-t0)/1000).toFixed(1)+'s','| hud',await ev(`[...document.querySelectorAll('.sb-result .sandbox-hud b')].map(b=>b.textContent).join(' / ')`));
  // people card, AI card
  await click(await at('.sb-dock [data-tool="people"]'));console.log('people card',await ev('TL_SANDBOX_LAYOUT.page'),'tool',await ev('TL_SANDBOX.tool'));await shot('sb3-4-people');
  await click(await at('.sb-dock [data-tool="ai"]'));console.log('ai card',await ev('TL_SANDBOX_LAYOUT.page'),!!(await at('.sb-toolcard #aiGenerate')));await shot('sb3-5-ai');
  // play this area in mode 3
  await click(await at('.sb-dock [data-tool="select"]'));await sleep(200);
  await click(await at('.sb-selbtns .btn-p'));
  for(let i=0;i<80;i++){await sleep(500);const u=await ev('location.href').catch(()=>'');if(/mode3-roads/.test(u||''))break;}
  await sleep(3000);console.log('now at',(await ev('location.href')).replace(/^.*feeder\//,''),'| pack',await ev('JSON.stringify(window.TL_ACTIVE_PACK&&{title:TL_ACTIVE_PACK.title,tiers:TL_ACTIVE_PACK.tiers,o:TL_ACTIVE_PACK.level.origins.length,r:TL_ACTIVE_PACK.level.roads.length})'));
  await shot('sb3-6-mode3');
  console.log('errors',errors.length?errors.slice(0,5):'none');ws.close();
  }finally{edge.kill();}
})().catch(e=>{console.error(e.message);process.exit(1);});
