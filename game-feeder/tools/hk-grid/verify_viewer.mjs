import fs from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {chromium} from "file:///F:/transitlab-hk/frontend/node_modules/playwright/index.mjs";
const root=path.resolve("C:/Users/赵禹博/Desktop/TransitLab五模式-Codex/任务51");
const out=path.join(root,"out");
function check(v,msg){if(!v)throw new Error(msg)}
const B=JSON.parse(await fs.readFile(path.join(out,"hk-base.json"),"utf8"));
const names=["am","pm","day","holiday"],demands={};
for(const p of names)demands[p]=JSON.parse(await fs.readFile(path.join(out,"hk-demand-"+p+".json"),"utf8"));
const allfiles=["hk-base.json",...names.map(p=>"hk-demand-"+p+".json")],sizes={};
for(const f of allfiles){sizes[f]=(await fs.stat(path.join(out,f))).size;check(sizes[f]<5*1024*1024,"JSON too large "+f)}
check(B.land.length===B.cols*B.rows,"land length");
check(B.stations.length===97,"station count");check(B.zones.length===455,"zone count");
check(B.cells.reduce((s,x)=>s+x[2],0)===7517309,"population sum");
check(B.cells.reduce((s,x)=>s+x[3],0)===3947200,"jobs sum");
const st=new Map(B.stations.map(s=>[s.id,s])),road=new Set(B.roads.map(r=>r.id)),sec=new Map(B.sections.map(s=>[s.id,s]));
for(const f of B.lines.concat(B.roads)){
 check(f.cells.every((c,i)=>i===0||Math.abs(c[0]-f.cells[i-1][0])+Math.abs(c[1]-f.cells[i-1][1])===1),"path adjacency "+f.id);
}
for(const l of B.lines){check(l.stations.every(s=>st.has(s)),"rail ID reference");check(/^#[0-9A-F]{6}$/.test(l.color),"rail color")}
check(B.areas.length===20,"area count");
for(const a of B.areas){const q=a.box;check(q[2]-q[0]===16&&q[3]-q[1]===12,"area shape");check(q[0]>=0&&q[1]>=0&&q[2]<=B.cols&&q[3]<=B.rows,"area bounds")}
const flow={};
for(const [p,d]of Object.entries(demands)){
 check(d.period===p&&d.zones.join("|")===B.zones.map(z=>z.id).join("|"),"zone order "+p);
 check(d.sections.length===B.sections.length,"section count "+p);
 check(d.pairs.every(x=>x.length===7&&x[0]<455&&x[1]<455&&x[2]>=0&&x[3]>=0&&x[2]+x[3]>=1),"pair schema "+p);
 check(d.lines.every(x=>st.has(x[1])&&st.has(x[2])&&x[3]>=0&&x[4]>0),"rail rows "+p);
 check(d.sections.every(x=>sec.has(x[0])&&x[1]>=0&&x[2]>=0),"section rows "+p);
 const totals=d.pairs.reduce((s,x)=>[s[0]+x[2],s[1]+x[3]],[0,0]);
 flow[p]={pairs:d.pairs.length,pair_car:Number(totals[0].toFixed(1)),pair_pt:Number(totals[1].toFixed(1)),car_pct:d.checks.car_pct,pt_pct:d.checks.pt_pct,null_minutes:d.checks.null_minutes};
 check(Math.abs(totals[0]-d.checks.pair_car)<.15&&Math.abs(totals[1]-d.checks.pair_pt)<.15,"pair sum check "+p);
}
for(const x of demands.am.sections){let s=sec.get(x[0]);check(x[1]===s.am.load&&x[2]===s.am.vc,"AM mismatch")}
const profile=path.join(root,"scripts","_browser-profile"),temp=path.join(root,"scripts","_browser-tmp");
await fs.mkdir(temp,{recursive:true});
const ctx=await chromium.launchPersistentContext(profile,{executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true,
 viewport:{width:1440,height:1000},env:{...process.env,TEMP:temp,TMP:temp},args:["--disable-background-networking","--disable-crash-reporter","--no-first-run"]});
const page=ctx.pages()[0];const errors=[];page.on("pageerror",e=>errors.push(e.message));
await ctx.setOffline(true);
await page.goto(pathToFileURL(path.join(out,"viewer.html")).href);
await page.waitForFunction(()=>window.__hkViewer?.getState().w>0);
check(await page.locator(".periods button").count()===4,"period buttons");
await page.screenshot({path:path.join(out,"viewer-full.png"),fullPage:true});
for(const p of names){
 await page.locator('button[data-period="'+p+'"]').click();
 check(await page.evaluate(()=>window.__hkViewer.getState().period)===p,"period switching "+p);
}
await page.locator('button[data-period="am"]').click();
await page.selectOption("#area","0");
const before=await page.evaluate(()=>window.__hkViewer.getState());
const pos=await page.evaluate(()=>{
 const state=window.__hkViewer.getState(),a=window.__hkViewer.base.areas[0].box;
 return {x:state.ox+(a[0]+8.5)*state.scale,y:state.oy+(a[1]+6.5)*state.scale};
});
await page.mouse.move(pos.x,pos.y);
check((await page.locator("#hover").textContent()).includes("人口"),"cell hover");
await page.screenshot({path:path.join(out,"viewer-kowloon-east.png"),fullPage:true});
await page.mouse.wheel(0,-350);
const after=await page.evaluate(()=>window.__hkViewer.getState());check(after.scale>before.scale,"zoom");
await page.mouse.move(500,400);await page.mouse.down();await page.mouse.move(550,430);await page.mouse.up();
const panned=await page.evaluate(()=>window.__hkViewer.getState());check(panned.ox!==after.ox,"pan");
for(const id of ["terrain","population","jobs","roads","metro","areas"]){await page.locator("#"+id).click();await page.locator("#"+id).click()}
await page.locator("#fit").click();
check(errors.length===0,"browser errors "+errors.join(";"));
await ctx.close();
const result={passed:true,sizes_bytes:sizes,flow,browser:{errors,period_switch:true,pan:true,zoom:true,layers:true,hover:true},screenshots:["viewer-full.png","viewer-kowloon-east.png"]};
await fs.writeFile(path.join(out,"verification.json"),JSON.stringify(result,null,2),"utf8");
console.log(JSON.stringify(result));
