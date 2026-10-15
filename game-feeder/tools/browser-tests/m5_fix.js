// sandbox fixes 2026-10-15: map up fast (no black), default tool = look round, zone click lands on the zone drawn
const {spawn}=require('node:child_process'),fs=require('node:fs');
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL='http://127.0.0.1:8000/feeder/mode5-sandbox/index.html';
const PORT=9333+Math.floor(Math.random()*400),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const within=(p,ms)=>Promise.race([p,new Promise((_,j)=>setTimeout(()=>j(new Error('timeout')),ms))]);
(async()=>{
  const edge=spawn(EDGE,['--headless=new','--disable-gpu','--hide-scrollbars','--window-size=1500,920',`--remote-debugging-port=${PORT}`,`--user-data-dir=F:/tmp-shots/edgeprof-fix-${Date.now()}`,'about:blank'],{stdio:'ignore'});
  try{
  let list=null;for(let i=0;i<40&&!list;i++){await sleep(250);try{list=await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();}catch(e){}}
  const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
  let id=0;const wait=new Map(),errors=[];
  ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&wait.has(m.id)){wait.get(m.id)(m);wait.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
  const send=(method,params={})=>within(new Promise(r=>{const i=++id;wait.set(i,r);ws.send(JSON.stringify({id:i,method,params}));}),15000);
  const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});return r.result.result&&r.result.result.value;};
  const mouse=async(type,[x,y],extra={})=>send('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1,...extra});
  const click=async p=>{await mouse('mouseMoved',p);await sleep(120);await mouse('mousePressed',p);await sleep(40);await mouse('mouseReleased',p);await sleep(250);};
  const at=sel=>ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return[r.x+r.width/2,r.y+r.height/2]})()`);
  const shot=async n=>{const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`F:/tmp-shots/${n}.png`,Buffer.from(r.result.data,'base64'));console.log('shot',n);};
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1500,height:920,deviceScaleFactor:1,mobile:false});
  const t0=Date.now();await send('Page.navigate',{url:URL});
  for(let i=0;i<60;i++){await sleep(200);if(await ev('!!(window.SandboxVector&&SandboxVector.S.ready&&window.TL_SANDBOX)'))break;}
  console.log('map ready after',((Date.now()-t0)/1000).toFixed(1)+'s');await shot('fix-0-early');
  const ok=await at('dialog[open] .btn-p');if(ok){await click(ok);await sleep(300);}
  console.log('default tool',await ev('TL_SANDBOX.tool'));
  // drag with no tool: the map moves, no line drawn
  const c=await at('#board');await mouse('mouseMoved',c);await mouse('mousePressed',c);for(let k=1;k<=6;k++){await mouse('mouseMoved',[c[0]+k*15,c[1]+k*8]);await sleep(30);}await mouse('mouseReleased',[c[0]+90,c[1]+48]);await sleep(300);
  console.log('lines after drag',await ev("document.getElementById('lineCount').textContent"));
  // zoom onto Central, pick «選分區», click on stations: the zone picked should be the station's zone
  await ev("TL_SANDBOX.fitBox([84,76,96,86]),1");await sleep(400);
  await click(await at('#selectTool'));console.log('tool now',await ev('TL_SANDBOX.tool'));
  const sts=await ev("SandboxVector.S.stations.filter(o=>o.s.zone&&['osm:MTR-ADM','osm:MTR-CEN','osm:MTR-WAC','osm:MTR-SHW','osm:MTR-CAB','osm:MTR-TST'].includes(o.s.id)).map(o=>({id:o.s.id,zone:o.s.zone,p:TL_SANDBOX.toPage(o.p[0],o.p[1])}))");
  let hit=0;
  for(const s of sts||[]){await click(s.p);const z=await ev("(()=>{const i=TL_SANDBOX.selected()[0];return i==null?null:String(window.__b||'')})()");
    const zid=await ev("(()=>{const i=TL_SANDBOX.selected()[0];return i==null?null:document.querySelector('#dataContent h3')?.textContent||i})()");
    const picked=await ev(`(async()=>{const b=await (await fetch('../hk/hk-base.json')).json();const i=TL_SANDBOX.selected()[0];return i==null?null:b.zones[i].id})()`);
    console.log(s.id,'station zone',s.zone,'picked',picked);if(String(picked)===String(s.zone))hit++;}
  await shot('fix-1-central');
  console.log('hits',hit,'/',(sts||[]).length);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await sleep(200);
  console.log('after Esc',await ev('TL_SANDBOX.tool'));
  await sleep(4000);console.log('periods enabled',await ev("[...document.querySelectorAll('#periodTabs [data-period]')].map(b=>b.dataset.period+':'+!b.disabled).join(' ')"));
  console.log('errors',errors.length?errors.slice(0,5):'none');ws.close();
  }finally{edge.kill();}
})().catch(e=>{console.error(e.message);process.exit(1);});
