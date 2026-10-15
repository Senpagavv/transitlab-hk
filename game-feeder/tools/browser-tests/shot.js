// screenshots over the local backend: node shot.js <name> <url> [waitMs] [js before shot] … (repeat groups with --)
const {spawn}=require('node:child_process'),fs=require('node:fs');
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT=9333+Math.floor(Math.random()*400),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const within=(p,ms)=>Promise.race([p,new Promise((_,j)=>setTimeout(()=>j(new Error('timeout')),ms))]);
const groups=[];let cur=[];for(const a of process.argv.slice(2)){if(a==='--'){groups.push(cur);cur=[];}else cur.push(a);}if(cur.length)groups.push(cur);
(async()=>{
  const edge=spawn(EDGE,['--headless=new','--disable-gpu','--hide-scrollbars','--window-size=1500,920',`--remote-debugging-port=${PORT}`,`--user-data-dir=F:/tmp-shots/edgeprof-shot-${Date.now()}`,'about:blank'],{stdio:'ignore'});
  try{
  let list=null;for(let i=0;i<40&&!list;i++){await sleep(250);try{list=await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();}catch(e){}}
  const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
  let id=0;const wait=new Map(),errors=[];
  ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&wait.has(m.id)){wait.get(m.id)(m);wait.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
  const send=(method,params={})=>within(new Promise(r=>{const i=++id;wait.set(i,r);ws.send(JSON.stringify({id:i,method,params}));}),20000);
  const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});return r.result.result&&r.result.result.value;};
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1500,height:920,deviceScaleFactor:1,mobile:false});
  for(const [name,url,ms,js] of groups){
    const t0=Date.now();await send('Page.navigate',{url});await sleep(+ms||4000);
    if(js)console.log(name,'js →',JSON.stringify(await ev(js)).slice(0,600));
    const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`F:/tmp-shots/${name}.png`,Buffer.from(r.result.data,'base64'));console.log('shot',name,((Date.now()-t0)/1000).toFixed(1)+'s');}
  console.log('errors',errors.length?errors.slice(0,5):'none');ws.close();
  }finally{edge.kill();}
})().catch(e=>{console.error(e.message);process.exit(1);});
