// the v7 level editor (modes 2–4) by mouse: render each mode; in mode 2 draw a river, place an estate, a destination;
// bot estimate; test play opens the mode page with the pack; export file contents checked
const {spawn}=require('node:child_process'),fs=require('node:fs');
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL=process.argv[2]||'http://127.0.0.1:8000/feeder/editor/index.html';
const PORT=9333+Math.floor(Math.random()*400),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const within=(p,ms)=>Promise.race([p,new Promise((_,j)=>setTimeout(()=>j(new Error('timeout')),ms))]);
(async()=>{
  const edge=spawn(EDGE,['--headless=new','--disable-gpu','--hide-scrollbars','--window-size=1500,920',`--remote-debugging-port=${PORT}`,`--user-data-dir=F:/tmp-shots/edgeprof-ed-${Date.now()}`,'about:blank'],{stdio:'ignore'});
  try{
  let list=null;for(let i=0;i<40&&!list;i++){await sleep(250);try{list=await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();}catch(e){}}
  const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
  let id=0;const wait=new Map(),errors=[];
  ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&wait.has(m.id)){wait.get(m.id)(m);wait.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
  const send=(method,params={})=>within(new Promise(r=>{const i=++id;wait.set(i,r);ws.send(JSON.stringify({id:i,method,params}));}),30000);
  const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});return r.result.result&&r.result.result.value;};
  const mouse=(type,[x,y])=>send('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
  const click=async p=>{await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p[0],y:p[1]});await sleep(80);await mouse('mousePressed',p);await sleep(40);await mouse('mouseReleased',p);await sleep(200);};
  const dragPath=async pts=>{await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:pts[0][0],y:pts[0][1]});await mouse('mousePressed',pts[0]);for(const p of pts.slice(1)){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p[0],y:p[1],buttons:1});await sleep(40);}await mouse('mouseReleased',pts.at(-1));await sleep(200);};
  const at=sel=>ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return[r.x+r.width/2,r.y+r.height/2]})()`);
  const cell=(x,y)=>ev(`(()=>{const b=document.getElementById('eeBoard'),p=b.createSVGPoint();p.x=34+${x}*46+23;p.y=34+${y}*46+23;const q=p.matrixTransform(b.getScreenCTM());return[q.x,q.y]})()`);
  const shot=async n=>{const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`F:/tmp-shots/${n}.png`,Buffer.from(r.result.data,'base64'));console.log('shot',n);};
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1500,height:920,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:URL});await sleep(3000);
  const ok=await at('#eeHelpDlg[open] #eeHelpOk');if(ok){await shot('ed-0-help');await click(ok);}
  for(const m of [3,4,2]){await click(await at(`#eeModes [data-mode="${m}"]`));await sleep(300);
    console.log('mode',m,'tools',await ev(`[...document.querySelectorAll('#eeTools button')].map(b=>b.textContent).join(' ')`),'| problems',await ev(`document.getElementById('eeProblems').innerText.replace(/\\n/g,' / ')`));
    await shot('ed-m'+m+'-example');}
  // mode 2: start blank, draw
  await ev(`(()=>{const s=document.getElementById('eeStart');s.value='blank';s.dispatchEvent(new Event('change'));})()`);await sleep(300);
  const tool=async n=>{await click(await at(`#eeTools [data-tool="${n}"]`));};
  await tool('origin');for(const [x,y] of [[1,1],[2,6],[4,3]])await click(await cell(x,y));
  await tool('dest');for(const [x,y] of [[12,4],[9,1]])await click(await cell(x,y));
  await tool('water');await dragPath([await cell(7,0),await cell(7,2),await cell(7,5),await cell(7,8)]);
  console.log('after drawing',await ev(`JSON.stringify((s=>({o:s.origins.length,d:s.destinations.length,w:s.water.length}))(TL_LEVEL_EDITOR.state.docs[2].level))`));
  // name the level
  await click(await at('#eeTitle'));await send('Input.insertText',{text:'測試河流關'});await sleep(200);
  await click(await at('#eeWaterBlocks'));await sleep(200);
  console.log('waterBlocks',await ev('TL_LEVEL_EDITOR.state.docs[2].level.waterBlocksWalk'),'| problems',await ev(`document.getElementById('eeProblems').innerText.replace(/\\n/g,' / ')`));
  await shot('ed-m2-drawn');
  await click(await at('#eeAnalyse'));
  for(let i=0;i<40;i++){await sleep(500);const a=await ev('JSON.stringify(TL_LEVEL_EDITOR.analysis)');if(a&&!a.includes('progress'))break;}
  console.log('analysis',await ev(`document.getElementById('eeAnalysis').innerText.replace(/\\n/g,' / ')`));
  const use=await at('#eeUseTiers');if(use)await click(use);
  console.log('tiers now',await ev('JSON.stringify(TL_LEVEL_EDITOR.state.docs[2].level.tiers)'));
  await shot('ed-m2-analysed');
  const f=await ev('JSON.stringify(TL_LEVEL_EDITOR.packFile())');console.log('file',f.slice(0,400));
  // test play: opens a new tab with the pack
  await click(await at('#eePlay'));await sleep(2500);
  const tabs=await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();const play=tabs.find(t=>t.type==='page'&&/pack=/.test(t.url));
  console.log('play tab',play?play.url.replace(/^.*feeder\//,''):'none');
  if(play){const ws2=new WebSocket(play.webSocketDebuggerUrl);await new Promise(r=>ws2.onopen=r);let id2=0;const w2=new Map();ws2.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w2.has(m.id)){w2.get(m.id)(m);w2.delete(m.id);}};
    const s2=(method,params={})=>new Promise(r=>{const i=++id2;w2.set(i,r);ws2.send(JSON.stringify({id:i,method,params}));});
    await s2('Emulation.setDeviceMetricsOverride',{width:1500,height:920,deviceScaleFactor:1,mobile:false});await sleep(1500);
    const r=await s2('Runtime.evaluate',{expression:`JSON.stringify({title:document.querySelector('#lvIntro h2')?.textContent,water:METRO_DATA.water&&METRO_DATA.water.length,blocks:METRO_DATA.waterBlocksWalk,origins:METRO_DATA.origins.length})`,returnByValue:true});console.log('play page',r.result.result.value);
    await s2('Runtime.evaluate',{expression:`document.querySelectorAll('dialog[open]').forEach(d=>d.close())`});await sleep(400);
    const sh=await s2('Page.captureScreenshot',{format:'png'});fs.writeFileSync('F:/tmp-shots/ed-m2-play.png',Buffer.from(sh.result.data,'base64'));console.log('shot ed-m2-play');ws2.close();}
  console.log('errors',errors.length?errors.slice(0,5):'none');ws.close();
  }finally{edge.kill();}
})().catch(e=>{console.error(e.message);process.exit(1);});
