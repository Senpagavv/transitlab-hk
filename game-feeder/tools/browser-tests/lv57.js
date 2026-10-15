// task 57 levels by mouse: open each level (served), read the intro and headline, then «AI 示範» → tier → wait for the
// end; page score vs the JSON's demo score. node lv57.js [tier] [keys…]
const {spawn}=require('node:child_process'),fs=require('node:fs');
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const tier=process.argv[2]||'master',PORT=9333+Math.floor(Math.random()*400),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const within=(p,ms)=>Promise.race([p,new Promise((_,j)=>setTimeout(()=>j(new Error('timeout')),ms))]);
const MODES={2:['mode2-metro','TL_METRO'],3:['mode3-roads','TL_ROADS'],4:['mode4-tod','TL_TOD']};
const keys=process.argv.slice(3).length?process.argv.slice(3):['m2-2','m2-3','m2-4','m3-2','m3-3','m3-4','m4-2','m4-3','m4-4'];
(async()=>{
  const edge=spawn(EDGE,['--headless=new','--disable-gpu','--hide-scrollbars','--window-size=1500,920',`--remote-debugging-port=${PORT}`,`--user-data-dir=F:/tmp-shots/edgeprof-lv57-${Date.now()}`,'about:blank'],{stdio:'ignore'});
  try{
  let list=null;for(let i=0;i<40&&!list;i++){await sleep(250);try{list=await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();}catch(e){}}
  const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
  let id=0;const wait=new Map();let errors=[];
  ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&wait.has(m.id)){wait.get(m.id)(m);wait.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
  const send=(method,params={})=>within(new Promise(r=>{const i=++id;wait.set(i,r);ws.send(JSON.stringify({id:i,method,params}));}),15000);
  const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true});return r.result.result&&r.result.result.value;};
  const click=async([x,y])=>{for(const type of ['mouseMoved','mousePressed','mouseReleased']){await send('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1});await sleep(type==='mouseMoved'?200:50);}await sleep(300);};
  const at=sel=>ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return[r.x+r.width/2,r.y+r.height/2]})()`);
  const shot=async n=>{const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`F:/tmp-shots/${n}.png`,Buffer.from(r.result.data,'base64'));};
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1500,height:920,deviceScaleFactor:1,mobile:false});
  for(const key of keys){
    errors=[];const mode=+key[1],[dir,G]=MODES[mode];
    const J=JSON.parse(fs.readFileSync(`F:/transitlab-hk/game-feeder/v7/levels/m${mode}/${key}.json`,'utf8'));
    await send('Page.navigate',{url:'about:blank'});await sleep(200);
    await send('Page.navigate',{url:`http://127.0.0.1:8000/feeder/${dir}/index.html#map=${key}`});await sleep(3500);
    const intro=await ev(`(()=>{const d=document.querySelector('#lvIntro');return{open:!!(d&&d.open),title:d&&d.querySelector('h2')?.textContent,h1:document.querySelector('h1 .h1tc')?.textContent,lede:document.querySelector('.lede .tcb')?.textContent?.slice(0,40)}})()`);
    await shot('lv57-'+key+'-intro');
    const go=await at('#lvIntro[open] .btn-p, #lvIntro[open] button');if(go){await click(go);await sleep(400);}
    const head=await ev(`(document.getElementById('mapHint')||{}).textContent`);
    const cols=await ev(`[...document.querySelectorAll('#tide thead th')].map(x=>x.textContent).join('|')`);
    let res='no demo (challenge)';
    if(J.level.demo&&J.level.demo[tier]){
      const b=await at('#demoBtn');if(!b){res='NO demo button';}else{await click(b);await sleep(500);const c=await at(`#demoDlg [data-tier="${tier}"]`);if(c)await click(c);
        const t0=Date.now();while(Date.now()-t0<180000){await sleep(1000);if(await ev(`${G}.plan().done`))break;}await sleep(1200);
        const tot=await ev(`${G}.plan().total`),want=J.level.demo[tier].score;res=`page ${Math.round(tot)} vs json ${want} ${Math.round(tot)===want?'MATCH':'DIFF'} (${Math.round((Date.now()-t0)/1000)}s)`;await shot('lv57-'+key+'-done');}}
    console.log(key,'|',J.title['zh-Hant'],'| intro',JSON.stringify(intro),'\n   head:',(head||'').slice(0,90),'\n   table:',cols,'\n   demo',tier+':',res,'| errors',errors.length?errors.slice(0,2):'none');
  }
  ws.close();
  }finally{edge.kill();}
})().catch(e=>{console.error(e.message);process.exit(1);});
