/* Offline browser acceptance: Node + an already-installed Playwright/Edge. No package download, no external calls.
   node game-feeder/tools/deploy/check_site.js <site> --playwright=<local playwright package directory>
   Optional: --report=<json> --local=<modified v7> --baseline=<original v7> */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{createRequire}=require('node:module');
const assert=require('node:assert/strict');
const positional=process.argv.slice(2).filter(x=>!x.startsWith('--'));
const opt=k=>process.argv.find(x=>x.startsWith('--'+k+'='))?.slice(k.length+3);
const phases=(opt('only')||'pages,demos,editors,sandbox,regression').split(',');
const site=path.resolve(positional[0]||'site');
const reportFile=path.resolve(opt('report')||path.join(path.dirname(site),'site-check-report.json'));
const report={started:new Date().toISOString(),pages:[],demos:[],editors:[],sandbox:{},regression:[],failures:[],externalRequests:[],backendRequests:[]};
const dirs=[null,'mode1-bus','mode2-metro','mode3-roads','mode4-tod'];
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
function server(root,source=false){return new Promise(resolve=>{
  const srv=http.createServer((req,res)=>{let name;try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch(_){res.writeHead(400).end();return;}
    if(source){if(!name.startsWith('/feeder/')){res.writeHead(404).end();return;}name=name.slice(7);}
    let file=path.resolve(root,'.'+name);if(!file.startsWith(path.resolve(root)+path.sep)&&file!==path.resolve(root)){res.writeHead(403).end();return;}
    if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
    if(!fs.existsSync(file)){res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'}).end(source?'Not found':fs.readFileSync(path.join(root,'404.html')));return;}
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
  }).listen(0,'127.0.0.1',()=>resolve({srv,origin:'http://127.0.0.1:'+srv.address().port}));
});}
function playwright(){
  if(opt('playwright'))return require(path.resolve(opt('playwright')));
  if(process.env.TL_PLAYWRIGHT)return require(process.env.TL_PLAYWRIGHT);
  for(const base of [process.cwd(),path.resolve(__dirname,'../../../..')]){
    try{return createRequire(path.join(base,'package.json'))('playwright');}catch(_){}
    try{return require(path.join(base,'frontend/node_modules/playwright'));}catch(_){}
  }
  throw Error('Playwright is not installed locally. Pass --playwright=<existing package directory>; this checker never downloads it.');
}
let browser,staticServer;const servers=[];
async function ctx(origin,{local=false,mobile=false}={}){
  const c=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},acceptDownloads:true});
  c.errors=[];c.requests=[];
  await c.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(!['http:','https:'].includes(u.protocol))return route.continue();
    if(u.origin!==origin){
      // Local/offline regression preserves the existing font tags, but fulfils them without network access.
      if(local&&/^fonts\.(googleapis|gstatic)\.com$/.test(u.hostname))return route.fulfill({status:200,contentType:'text/css',body:''});
      report.externalRequests.push(u.href);c.errors.push('External request: '+u.href);return route.fulfill({status:403,body:'External access disabled'});
    }
    if(/^\/(?:api(?:\/|$)|login(?:\/|$))/.test(u.pathname)){report.backendRequests.push(u.href);c.errors.push('Backend request: '+u.href);return route.fulfill({status:503,body:'Backend access disabled'});}
    c.requests.push(u.pathname);return route.continue();
  });
  c.on('page',p=>{
    p.on('pageerror',e=>c.errors.push(e.message));
    p.on('console',m=>{if(m.type()==='error')c.errors.push(m.text());});
    p.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('/absent-page-for-check'))c.errors.push('HTTP '+r.status()+': '+r.url());});
    p.on('requestfailed',r=>{if(r.failure()?.errorText!=='net::ERR_ABORTED')c.errors.push('Request failed: '+r.url()+' '+r.failure()?.errorText);});
  });
  await c.addInitScript(()=>{try{localStorage.setItem('tl-v7-editor-seen','1');localStorage.setItem('tl-m5-played-v2','true');}catch(_){}});
  return c;
}
async function closeDialogs(p){await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(x=>x.close()));}
async function ready(p,mode){
  await p.waitForFunction(m=>m===1?!!window.TL_GAME:m===2?!!window.TL_METRO:m===3?!!window.TL_ROADS:!!window.TL_TOD,mode,{timeout:20000});
  await closeDialogs(p);
}
async function clean(c,label){assert.deepEqual(c.errors,[],label+' errors');}
async function pages(){
  const c=await ctx(staticServer.origin),p=await c.newPage();
  await p.goto(staticServer.origin+'/');await p.waitForURL('**/feeder/');
  await p.waitForFunction(()=>!!window.TL_LEVELS);assert.equal(await p.evaluate(()=>TL_SITE.static),true);
  const levels=await p.evaluate(()=>[1,2,3,4].flatMap(mode=>TL_LEVELS.mode(mode).map(l=>({mode,key:l.key}))));
  const paths=['/feeder/','/feeder/index.html#hub=1&nav=5',...levels.map(l=>'/feeder/'+dirs[l.mode]+'/index.html#map='+l.key+'&intro=0'),'/feeder/editor/index.html','/feeder/mode1-bus/editor.html','/feeder/mode5-sandbox/index.html'];
  for(const url of paths){const before=c.errors.length;await p.goto(staticServer.origin+url,{waitUntil:'load'});
    if(url.includes('sandbox'))await p.waitForFunction(()=>!!window.TL_SANDBOX_LAYOUT,{timeout:30000});
    else if(url.includes('editor'))await p.waitForFunction(()=>!!(window.TL_EDITOR||window.TL_LEVEL_EDITOR));
    else if(url.includes('mode')){const mode=Number(/mode(\d)/.exec(url)?.[1]);if(mode)await ready(p,mode);}
    if(url.includes('nav=5')){await p.waitForSelector('#hubAI');assert.equal(await p.locator('#hubLive').count(),0);assert.match(await p.locator('#hubAI').innerText(),/稍後|稍后|coming/);}
    assert.equal(await p.locator('.tl-board-open').count(),0);
    await p.evaluate(()=>{if(window.TLBoard){TLBoard.open();TLBoard.refresh();TLBoard.receive({level:'feeder/m1/l1',score:999,plan:{}});}});
    report.pages.push({url,errors:c.errors.slice(before)});console.log('PAGE',url,c.errors.length===before?'PASS':'FAIL');
  }
  for(const mode of [2,3,4]){await p.goto(staticServer.origin+'/feeder/editor/index.html#mode='+mode);await p.waitForFunction(m=>window.TL_LEVEL_EDITOR?.state.mode===m,mode);await closeDialogs(p);assert.deepEqual(await p.evaluate(()=>TL_LEVEL_EDITOR.problems()),[]);}
  await clean(c,'All static pages');await c.close();return levels;
}
async function demos(){
  for(let mode=1;mode<=4;mode++){
    const c=await ctx(staticServer.origin),p=await c.newPage(),key=mode===1?'l1':'m'+mode+'-1';
    await p.goto(staticServer.origin+'/feeder/'+dirs[mode]+'/index.html#map='+key+'&intro=0');await ready(p,mode);
    // Replay the shipped UI demo with virtual browser time; no engine or score shortcuts.
    await p.clock.install();await p.locator('#demoBtn').click();await p.locator('#demoDlg [data-tier="master"]').click();
    for(let i=0;i<180;i++){
      await p.clock.runFor(mode===1?10000:3000);
      if(await p.evaluate(m=>m===1?TL_GAME.state().done:({2:window.TL_METRO,3:window.TL_ROADS,4:window.TL_TOD})[m].api.plan.done,mode))break;
    }
    const out=await p.evaluate(m=>{if(m===1)return{done:TL_GAME.state().done,score:Number(document.querySelector('#rScore')?.textContent||0),text:document.querySelector('#demoBox')?.textContent,expected:TL_DEMO_PLANS.l1.master.score,master:TL_DEMO_PLANS.l1.tiers[2]};
      const a=({2:window.TL_METRO,3:window.TL_ROADS,4:window.TL_TOD})[m].api.plan;
      const d=({2:window.TL_METRO_DEMO,3:window.TL_ROADS_DEMO,4:window.TL_TOD_DEMO})[m];const demo=d?.['m'+m+'-1'];return{done:a.done,score:Math.round(a.total),expected:(demo?.master||demo?.mixed)?.score,master:demo?.tiers[2]};},mode);
    if(mode===1){const found=/示範結束：坐巴士\s*([\d,]+)|示范结束：坐巴士\s*([\d,]+)|Demo over:\s*([\d,]+)/.exec(out.text);if(found)out.score=Number((found[1]||found[2]||found[3]).replaceAll(',',''));}
    assert.equal(out.done,true,'Demo '+mode+' completed');assert.equal(out.score,out.expected,'Demo '+mode+' exact score');assert.ok(out.score>=out.master,'Demo '+mode+' master tier');await clean(c,'Demo '+mode);
    report.demos.push({mode,key,...out,errors:[]});console.log('DEMO',mode,out.score,'PASS');await c.close();
  }
}
async function editors(){
  for(const spec of [{url:'/feeder/mode1-bus/editor.html',export:'#edExport',play:'#edPlay',analyse:'#edAnalyse'},{url:'/feeder/editor/index.html',export:'#eeExport',play:'#eePlay',analyse:'#eeAnalyse'}]){
    const c=await ctx(staticServer.origin),p=await c.newPage();await p.goto(staticServer.origin+spec.url);await p.waitForFunction(()=>!!(window.TL_EDITOR||window.TL_LEVEL_EDITOR));await closeDialogs(p);
    for(const [lang,label] of [['zh-Hant','發給發起人'],['zh-Hans','发给发起人'],['en','Send it to the organiser.']]){
      const text=await p.evaluate(({lang})=>{I18N.set(lang);return I18N.t(window.TL_EDITOR?'e1.exported':'e.exported',{s:'check.json'});},{lang});assert.ok(text.includes(label),lang+' export hand-in translation');
    }
    await p.evaluate(()=>I18N.set('zh-Hant'));
    await p.locator(spec.analyse).click();await p.waitForFunction(()=>{const a=(window.TL_EDITOR||window.TL_LEVEL_EDITOR)?.analysis;return a&&a.progress===undefined;},{},{timeout:90000});
    const downloadPromise=p.waitForEvent('download');await p.locator(spec.export).click();const download=await downloadPromise;
    const stream=await download.createReadStream();let body='';for await(const chunk of stream)body+=chunk;const pack=JSON.parse(body);assert.equal(pack.format,'tl-level/1');assert.ok(pack.level);
    const popupPromise=p.waitForEvent('popup');await p.locator(spec.play).click();const popup=await popupPromise;await popup.waitForLoadState('load');await ready(popup,pack.mode);
    assert.equal(await popup.evaluate(()=>TL_SITE.static),true);await clean(c,'Editor');report.editors.push({url:spec.url,filename:download.suggestedFilename(),mode:pack.mode,bytes:Buffer.byteLength(body),analysis:true,testPlay:true,errors:[]});console.log('EDITOR',spec.url,'PASS');await c.close();
  }
}
async function sandbox(){
  const c=await ctx(staticServer.origin),p=await c.newPage();await p.goto(staticServer.origin+'/feeder/mode5-sandbox/index.html');await p.waitForFunction(()=>!!window.TL_SANDBOX_LAYOUT,{timeout:30000});await closeDialogs(p);
  assert.equal(await p.locator('#liveMap').count(),0);assert.equal(await p.locator('a[href="/"]:visible').count(),0);assert.match(await p.locator('.sb-attribution').innerText(),/© OpenStreetMap contributors/);
  for(const lang of ['zh-Hant','zh-Hans','en']){await p.evaluate(l=>I18N.set(l),lang);await p.waitForTimeout(20);assert.match(await p.locator('.sb-attribution').innerText(),/OpenStreetMap/);await p.evaluate(()=>TL_SANDBOX_LAYOUT.show('ai'));assert.match(await p.locator('[data-i18n="v.aiNote"]').innerText(),/啟德|启德|Kai Tak/);}
  await p.evaluate(()=>I18N.set('zh-Hant'));await p.evaluate(()=>TL_SANDBOX_LAYOUT.show('line'));await p.locator('#examplePlan').click();
  await p.locator('#runStep').click();await p.waitForFunction(()=>document.querySelectorAll('#roundRows tr').length>=1,{},{timeout:45000});
  report.sandbox.round1=await p.locator('#roundRows').innerText();
  await p.evaluate(()=>{const S=TL_SANDBOX;const area=S.base.areas.find(a=>a.key==='kowloon-east');const indices=S.base.zones.map((z,i)=>({z,i})).filter(({z})=>z.cell[0]>=area.box[0]&&z.cell[0]<=area.box[2]&&z.cell[1]>=area.box[1]&&z.cell[1]<=area.box[3]).slice(0,3).map(x=>x.i);S.v2.select(indices);TL_SANDBOX_LAYOUT.show('select');});
  await p.locator('#focusSel').click();assert.ok(await p.evaluate(()=>TL_SANDBOX.scope?.length));await p.waitForFunction(()=>!document.querySelector('#runStep').disabled);
  await p.locator('#runStep').click();await p.waitForFunction(()=>document.querySelectorAll('#roundRows tr').length>=1,{},{timeout:45000});report.sandbox.scopedRound=await p.locator('#roundRows').innerText();report.sandbox.scope=await p.evaluate(()=>TL_SANDBOX.scope);
  // Selected-area cutting and navigation use the same browser worker as the AI card.
  await p.evaluate(()=>TL_SANDBOX_LAYOUT.cutSelection(TL_SANDBOX.v2.selectedZones()));await p.waitForURL('**/mode3-roads/index.html#pack=*',{timeout:90000});await ready(p,3);report.sandbox.selectedAreaPlay=true;
  await p.goto(staticServer.origin+'/feeder/mode5-sandbox/index.html#tab=ai');await p.waitForFunction(()=>!!window.TL_SANDBOX_LAYOUT,{timeout:30000});await closeDialogs(p);
  await p.locator('#aiSentence').fill('啟德多五萬人');await p.locator('#aiGenerate').click();await p.waitForSelector('#aiOpen',{timeout:90000});report.sandbox.aiText=await p.locator('#aiStatus').innerText();await p.locator('#aiOpen').click();await p.waitForURL('**/mode3-roads/index.html#pack=*');await ready(p,3);report.sandbox.aiPlay=true;
  assert.equal(await p.evaluate(()=>TL_FEATURES.levelUpload),false);await p.evaluate(()=>TLPack.upload({}));await clean(c,'Sandbox');await c.close();
  const mobile=await ctx(staticServer.origin,{mobile:true}),mp=await mobile.newPage();await mp.goto(staticServer.origin+'/feeder/mode5-sandbox/index.html');await mp.waitForSelector('.sb-mobile-note',{timeout:30000});await closeDialogs(mp);await mp.locator('.sb-mobile-note button').click();assert.equal(await mp.locator('.sb-mobile-note').count(),0);await mp.reload();await mp.waitForFunction(()=>!!window.TL_SANDBOX_LAYOUT);assert.equal(await mp.locator('.sb-mobile-note').count(),0);assert.equal(await mp.locator('.sb-attribution').isVisible(),true);await clean(mobile,'Mobile');await mp.screenshot({path:path.join(path.dirname(reportFile),'mobile-sandbox.png')});await mobile.close();report.sandbox.mobileOnce=true;report.sandbox.mobileAttribution=true;report.sandbox.errors=[];console.log('SANDBOX PASS');
}
async function fingerprint(p){return p.evaluate(()=>({site:window.TL_SITE||{static:false,ai:true,dataMap:true,board:true,submit:''},title:document.title,nav:[...document.querySelectorAll('#navrow a')].map(a=>({text:a.textContent,href:a.getAttribute('href')})),hubLive:!!document.querySelector('#hubLive'),level:window.Tide?.D?.map||window.METRO_DATA?.map||window.ROADS_DATA?.map||window.TOD_DATA?.map||null,board:!!window.TLBoard,sandbox:window.TL_SANDBOX?{zones:TL_SANDBOX.base.zones.length,scope:TL_SANDBOX.scope}:null}));}
async function regression(){
  if(!opt('local')||!opt('baseline'))return;
  const roots=[path.resolve(opt('baseline')),path.resolve(opt('local'))];
  const snapshots=[];
  for(const root of roots){const srv=await server(root,true);servers.push(srv.srv);const c=await ctx(srv.origin,{local:true}),p=await c.newPage(),snaps={};
    for(const url of ['/feeder/index.html#hub=1&nav=5',...dirs.slice(1).map(d=>'/feeder/'+d+'/index.html#intro=0'),'/feeder/editor/index.html','/feeder/mode1-bus/editor.html','/feeder/mode5-sandbox/index.html']){
      await p.goto(srv.origin+url);if(url.includes('sandbox'))await p.waitForFunction(()=>!!window.TL_SANDBOX_LAYOUT,{timeout:30000});else if(url.includes('nav=5'))await p.waitForSelector('#hubLive');await closeDialogs(p);snaps[url]=await fingerprint(p);assert.equal(snaps[url].site.static,false);
    }
    await clean(c,'Local regression');await c.close();
    const fc=await ctx('file://',{local:true}),fp=await fc.newPage();const bundles=['开始.html',...dirs.slice(1).map((d,i)=>d+'/'+['模式1-车站与步行.html','模式2-地铁.html','模式3-路会塞.html','模式4-站旁开发.html'][i]),'editor/关卡编辑器.html','mode1-bus/模式1-关卡编辑器.html'];
    for(const f of bundles){await fp.goto(require('node:url').pathToFileURL(path.join(root,f)).href+'#intro=0');await fp.waitForLoadState('load');await closeDialogs(fp);snaps['file:'+f]=await fingerprint(fp);assert.equal(snaps['file:'+f].site.static,false);}
    await clean(fc,'Offline regression');await fc.close();snapshots.push(snaps);
  }
  for(const key of Object.keys(snapshots[0])){assert.deepEqual(snapshots[1][key],snapshots[0][key],key+' unchanged');report.regression.push({url:key,baselineMatches:true});}console.log('LOCAL + OFFLINE REGRESSION PASS');
}
(async()=>{try{
  assert.ok(fs.existsSync(path.join(site,'404.html'))&&fs.existsSync(path.join(site,'feeder/index.html')),'Not a built site directory: '+site);
  const pw=playwright();const exe=[pw.chromium.executablePath(),process.env['PROGRAMFILES(X86)']&&path.join(process.env['PROGRAMFILES(X86)'],'Microsoft/Edge/Application/msedge.exe'),process.env.PROGRAMFILES&&path.join(process.env.PROGRAMFILES,'Microsoft/Edge/Application/msedge.exe')].find(x=>x&&fs.existsSync(x));
  assert.ok(exe,'No local Chromium/Edge found; the checker never downloads browsers.');
  browser=await pw.chromium.launch({headless:true,executablePath:exe,args:['--disable-background-networking','--no-first-run','--disable-component-update']});report.browser=exe;
  staticServer=await server(site);servers.push(staticServer.srv);report.phases=phases;
  if(phases.includes('pages'))await pages();if(phases.includes('demos'))await demos();if(phases.includes('editors'))await editors();if(phases.includes('sandbox'))await sandbox();if(phases.includes('regression'))await regression();
  report.status='PASS';
}catch(e){report.status='FAIL';report.failures.push(e.stack);console.error(e.stack);process.exitCode=1;}
finally{if(browser)await browser.close();servers.forEach(s=>s.close());report.finished=new Date().toISOString();try{fs.mkdirSync(path.dirname(reportFile),{recursive:true});}catch(_){}   // a drive root (F:\) exists already; mkdir on it fails on Windows
fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');console.log(report.status,reportFile);}})();
