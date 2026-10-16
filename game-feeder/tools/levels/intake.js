#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {readInput,MAX_FILE}=require('./intake-input.js');
const {guard}=require('./intake-worker.js');
const V7=path.resolve(__dirname,'../../v7');
function canonicalPath(p){
  p=path.resolve(p);let tail=[];
  while(!fs.existsSync(p)){tail.unshift(path.basename(p));const up=path.dirname(p);if(up===p)throw Error('找不到路径祖先');p=up;}
  return path.resolve(fs.realpathSync(p),...tail);
}
const inside=(p,root)=>{const r=path.relative(root,p);return !r||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));};
function outputPath(input,out){
  const a=canonicalPath(input),b=canonicalPath(out),levels=canonicalPath(path.join(V7,'levels'));
  if(inside(b,levels)||inside(levels,b))throw Error('--out 不得位于 v7/levels，也不得包含该目录');
  if(inside(b,a)||inside(a,b))throw Error('--out 与输入必须是互不包含的独立路径');
  if(fs.existsSync(b)&&(!fs.statSync(b).isDirectory()||fs.readdirSync(b).length))throw Error('--out 必须不存在或是空文件夹，避免覆盖旧报告 / 关卡');
  return b;
}
function context(){
  const registry=require(path.join(V7,'levels/registry.js')).list;
  const box={window:{}};vm.runInNewContext(fs.readFileSync(path.join(V7,'hub/stations.js'),'utf8'),box,{timeout:1000});
  return{registry,stations:box.window.TL_STATIONS};
}
const md=x=>String(x??'—').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\|/g,'\\|').replace(/[\r\n\x00-\x1f]/g,' ').replace(/`/g,'&#96;');
const json=x=>JSON.stringify(x,null,2)+'\n';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function canonical(x){if(Array.isArray(x))return'['+x.map(canonical).join(',')+']';if(x&&typeof x==='object')return'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';return JSON.stringify(x);}
function report(out,rows,run){
  const priority=r=>r.conflict||r.tooEasy||r.tooHard?0:r.rejected?1:2;
  const sorted=rows.slice().sort((a,b)=>priority(a)-priority(b)||a.file.localeCompare(b.file,'en'));
  const good=rows.filter(r=>r.output).length,rejected=rows.filter(r=>r.rejected).length;
  const lines=['# 关卡收件报告 / Level intake report','',
    `时间：${run.started}；输入：${md(run.input)}。`,
    `共 ${rows.length} 项；处理成功 ${good}；拒绝 / 未完成 ${rejected}；编号待确认 ${rows.filter(r=>r.conflict).length}。`,
    '编号冲突、简单方案到大师、最好低于 50 的条目置顶。门槛 = round(机器人已找到的最好 × 0.40 / 0.65 / 0.88)。最好分不是全局最优证明。',
    '正常输出在 mN/；编号冲突的每个版本分别保存在 待确认/流水号/mN/。没有自动取代或挑选任何版本。工具未写入 v7/levels。',
    'Warnings and rejected items require review. Conflicting candidates are kept separately; no existing level is replaced.','',
    '| 文件名 | 玩法 | 编号 | 标题 | 作者 | 屋苑 / 去处 / 路 / 空地 | 机器人最好 | 新门槛 vs 组员门槛 | 示范分（过 / 高 / 大师） | 问题 / 输出 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  for(const r of sorted){
    const issues=[...r.issues];if(r.tooEasy)issues.unshift(`太容易：简单方案 ${r.simpleBest} ≥ 大师 ${r.tiers[2]}`);if(r.tooHard)issues.unshift('太难：最好 < 50');
    if(r.simpleBest!==undefined)issues.push('简单方案最高 '+(r.simpleBest??'没有合法方案'));
    if(r.output)issues.push('输出 '+r.output);else issues.push('未输出');
    lines.push('| '+[r.file,r.mode,r.key,r.title,r.author,r.counts?.join(' / '),r.best,
      r.tiers?`${r.tiers.join(' / ')} vs level ${JSON.stringify(r.originalTiers)}${r.originalTopTiers!==undefined?'；顶层 '+JSON.stringify(r.originalTopTiers):''}`:'—',
      r.challenge?'挑战关，无示范':r.replays?['pass','high','master'].map(k=>r.replays[k].score).join(' / '):'—',issues.join('；')].map(md).join(' | ')+' |');
  }
  lines.push('','每套非挑战关示范均经真实引擎逐操作重放，核对整数总分、操作是否合法及对应门槛。完整记录见 报告.json；输入门槛保留于 originalTiers / originalTopTiers。',
    '第一玩法的“路”是道路格数，去处为 hub（1 个）；第二至四玩法的“路”是命名道路条数。简单方案定义和机器人次数见各行 JSON 记录。',
    '安全上限：单文件 2 MiB，ZIP / 累计 JSON 64 MiB，512 项，目录 16 层，JSON 32 层。加密、ZIP64、分卷、符号链接、非 JSON、路径穿越均拒绝；只支持 stored / deflate。',
    `每关超时 ${run.timeoutSeconds} 秒，子进程 Node heap 上限 384 MiB；超时 / 内存失败不输出该关。搜索重启数：${run.restarts?'显式覆盖为 '+run.restarts:'地铁 400，道路 18，TOD 60；第一玩法枚举所有静态开局并搜索合法挪站'}。`,
    '标题缺失的语言不自动翻译；hub 站名不自动猜测。退出码：0=无问题；2=已出报告但需要人工审阅；1=命令 / 输出路径等致命错误。','');
  fs.writeFileSync(path.join(out,'报告.md'),lines.join('\n'));
  fs.writeFileSync(path.join(out,'报告.json'),json({run,summary:{items:rows.length,processed:good,rejected},rows:sorted}));
}
function intake(input,out,options={}){
  const target=outputPath(input,out),timeout=options.timeoutSeconds??1200;
  const run={started:new Date().toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'})+' +08:00',input:path.resolve(input),timeoutSeconds:timeout,restarts:options.restarts??null};
  fs.mkdirSync(target,{recursive:true});
  const rows=[];let raw;
  try{raw=readInput(input);}catch(e){rows.push({file:path.basename(input),issues:[e.message],rejected:true});report(target,rows,run);return{code:2,rows,out:target};}
  if(!raw.length){rows.push({file:path.basename(input),issues:['输入没有 JSON 文件'],rejected:true});report(target,rows,run);return{code:2,rows,out:target};}
  const ctx=context(),seen=new Map();
  for(const r of raw){const e=r.entry;if(e&&typeof e==='object'&&Number.isInteger(e.mode)&&typeof e.key==='string'){
    const k=e.mode+':'+e.key;if(!seen.has(k))seen.set(k,[]);seen.get(k).push(r.file);
  }}
  const temp=fs.mkdtempSync(path.join(target,'.intake-'));
  try{
    for(const [i,r] of raw.entries()){
      const e=r.entry,row={file:r.file,issues:r.issues||[],rejected:!!r.rejected};rows.push(row);
      if(row.rejected)continue;
      const invalid=guard(e);if(invalid.length){row.rejected=true;row.issues.push(...invalid);continue;}
      if(e&&typeof e==='object'){
        Object.assign(row,{mode:e.mode,key:e.key,title:typeof e.title==='string'?e.title:e.title?.['zh-Hans']||e.title?.['zh-Hant']||e.title?.en,
          author:typeof e.author==='string'?e.author:JSON.stringify(e.author),challenge:e.challenge===true,
          originalTiers:e.level?.tiers,originalTopTiers:e.tiers});
        const lv=e.level||{};row.counts=[(lv.estates||lv.origins||[]).length,(lv.destinations||[]).length||(e.mode===1?1:0),(lv.roads||[]).length,(lv.land||[]).length];
        const existing=ctx.registry.filter(x=>x.key===e.key);
        if(existing.length){row.conflict=true;row.issues.push('编号与现有关卡重复（'+existing.map(x=>'玩法 '+x.mode).join('、')+'），取代 / 撞号待 Claude 确认');}
        const batch=[...seen.entries()].filter(([k])=>k.slice(k.indexOf(':')+1)===e.key).flatMap(([,v])=>v);
        if(batch.length>1){row.conflict=true;row.issues.push('同批编号重复：'+batch.join('、'));}
        row.missingLanguages=['zh-Hant','zh-Hans','en'].filter(k=>typeof e.title?.[k]!=='string'||!e.title[k].trim());
        if(row.missingLanguages.length)row.issues.push('标题缺 '+row.missingLanguages.join(' / '));
        if(typeof e.hub?.station!=='string'||!Object.hasOwn(ctx.stations,e.hub.station))row.issues.push('hub.station 不在 stations.js：'+String(e.hub?.station));
        if(e.tiers&&JSON.stringify(e.tiers)!==JSON.stringify(lv.tiers))row.issues.push('组员顶层 tiers 与 level.tiers 不一致');
      }
      const file=path.join(temp,String(i)+'.json');fs.writeFileSync(file,json(e));
      console.log(`[${i+1}/${raw.length}] ${md(r.file)}：检查、搜索、重放…`);
      const start=Date.now(),p=spawnSync(process.execPath,['--max-old-space-size=384',path.join(__dirname,'intake-worker.js'),file,String(options.restarts||'')],
        {encoding:'utf8',timeout:timeout*1000,maxBuffer:16*1024*1024,windowsHide:true});
      row.seconds=Number(((Date.now()-start)/1000).toFixed(2));let result;
      try{result=JSON.parse(p.stdout);}catch{result={ok:false,issues:[p.error?.code==='ETIMEDOUT'?'检查 / 搜索超时':`子进程未正常返回（${p.error?.message||p.signal||p.status}）`],diagnostic:(p.stderr||'').slice(-1000)};}
      if(!result.ok||p.error||p.status!==0){row.rejected=true;row.issues.push(...(result.issues||['子进程失败']));row.diagnostic=result.diagnostic;continue;}
      const {demo,...verification}=result;delete verification.ok;Object.assign(row,verification);
      row.tooEasy=result.simpleBest!==null&&result.simpleBest>=result.tiers[2];row.tooHard=result.best<50;
      const processed=JSON.parse(JSON.stringify(e));processed.level.tiers=result.tiers;
      if(e.tiers!==undefined)processed.tiers=result.tiers;
      delete processed.level.demo;delete processed.demo;
      if(!processed.challenge)processed.level.demo=demo;
      if(processed.hash!==undefined){processed.hash=hash(canonical(processed.level)).slice(0,16);if(processed.id!==undefined)processed.id='custom-'+processed.hash.slice(0,8);}
      // Previous verification is not evidence for these newly calibrated scores.
      if(processed.verification!==undefined){row.issues.push('旧 verification 移至报告；输出使用本次重放结果');row.previousVerification=processed.verification;delete processed.verification;}
      const finalProblems=guard(processed);if(finalProblems.length){row.rejected=true;row.issues.push('处理后检查失败：'+finalProblems.join('；'));continue;}
      const prefix=row.conflict?'待确认/'+String(i+1).padStart(3,'0')+'/':'';
      row.output=prefix+'m'+e.mode+'/'+e.key+'.json';const dst=path.join(target,...row.output.split('/')),data=json(processed);
      if(Buffer.byteLength(data)>MAX_FILE){row.rejected=true;row.issues.push('加入示范后超过 2 MiB，未输出');delete row.output;continue;}
      fs.mkdirSync(path.dirname(dst),{recursive:true});fs.writeFileSync(dst,data,{flag:'wx'});row.outputSha256=hash(data);
      console.log(`  最好 ${row.best}；门槛 ${row.tiers.join('/')}；${row.challenge?'挑战关':Object.values(row.replays).map(x=>x.score).join('/')} 重放通过`);
    }
  }finally{fs.rmSync(temp,{recursive:true,force:true});report(target,rows,run);}
  return{out:target,rows,code:rows.some(r=>r.rejected||r.conflict||r.tooEasy||r.tooHard||r.issues.length)?2:0};
}
module.exports={intake,outputPath,canonicalPath};
if(require.main===module){
  try{
    const a=process.argv.slice(2),input=a.shift(),o={};
    if(!input||input==='--help'){console.log('用法: node game-feeder/tools/levels/intake.js <ZIP 或文件夹> --out <全新输出目录> [--timeout 秒] [--restarts N]\n默认完整搜索；--restarts 只供诊断 / 加长复核，报告会注明。');process.exitCode=input?0:1;}
    else{
      while(a.length){const k=a.shift();if(!['--out','--timeout','--restarts'].includes(k)||!a.length||o[k]!==undefined)throw Error('未知 / 重复参数：'+k);o[k]=a.shift();}
      if(!o['--out'])throw Error('必须提供 --out');
      for(const k of ['--timeout','--restarts'])if(o[k]!==undefined&&(!Number.isInteger(Number(o[k]))||Number(o[k])<1||Number(o[k])>86400))throw Error(k+' 必须为 1–86400 整数');
      const r=intake(path.resolve(input),path.resolve(o['--out']),{timeoutSeconds:o['--timeout']?Number(o['--timeout']):undefined,restarts:o['--restarts']?Number(o['--restarts']):undefined});
      console.log('报告：'+path.join(r.out,'报告.md'));process.exitCode=r.code;
    }
  }catch(e){console.error('收件失败：'+e.message);process.exitCode=1;}
}
