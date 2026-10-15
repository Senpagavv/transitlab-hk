const {spawn}=require('node:child_process'),fs=require('node:fs');
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT=9333+Math.floor(Math.random()*400),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const URL=process.argv[2]||'http://127.0.0.1:8000/feeder/mode5-sandbox/index.html';
(async()=>{
  const edge=spawn(EDGE,['--headless=new','--disable-gpu','--hide-scrollbars','--window-size=1500,920',`--remote-debugging-port=${PORT}`,`--user-data-dir=F:/tmp-shots/edgeprof-tl-${Date.now()}`,'about:blank'],{stdio:'ignore'});
  try{let list=null;for(let i=0;i<40&&!list;i++){await sleep(250);try{list=await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();}catch(e){}}
  const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
  let id=0;const wait=new Map(),net=[];const t0={v:0};
  ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&wait.has(m.id)){wait.get(m.id)(m);wait.delete(m.id);}
    if(m.method==='Network.loadingFinished'){const r=net.find(x=>x.id===m.params.requestId);if(r){r.end=Date.now()-t0.v;r.kb=Math.round(m.params.encodedDataLength/1024);}}
    if(m.method==='Network.requestWillBeSent')net.push({id:m.params.requestId,url:m.params.request.url.replace(/^.*\/feeder\//,''),start:Date.now()-t0.v});};
  const send=(method,params={})=>new Promise(r=>{const i=++id;wait.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
  await send('Network.enable');await send('Page.enable');await send('Network.setCacheDisabled',{cacheDisabled:false});
  await send('Emulation.setDeviceMetricsOverride',{width:1500,height:920,deviceScaleFactor:1,mobile:false});
  t0.v=Date.now();send('Page.navigate',{url:URL});
  for(const ms of [700,1500,2500,4000,7000]){await sleep(ms-(Date.now()-t0.v));const r=await send('Page.captureScreenshot',{format:'jpeg',quality:40});fs.writeFileSync(`F:/tmp-shots/tl-${ms}.jpg`,Buffer.from(r.result.data,'base64'));}
  for(const r of net.filter(x=>x.kb>20||/json|worker/.test(x.url)))console.log(r.url.slice(0,60),r.start+'→'+r.end+'ms',r.kb+'KB');
  ws.close();}finally{edge.kill();}
})();
