'use strict';
const fs=require('node:fs'),path=require('node:path');
const cutter=require('../v7/shared/levelgen/cut.js');
const checker=require('../v7/shared/levelgen/check.js');
const bot=require('../v7/shared/levelgen/bot.js');
const comparison=require('../v7/shared/levelgen/compare.js');
function parse(argv){
  const out={},flags=new Set(['help','compare','batch','serve','benchmark']);
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];if(!arg.startsWith('--'))throw new Error('未知参数：'+arg);
    const key=arg.slice(2);
    if(flags.has(key)){out[key]=true;continue;}
    if(!['base','demand','area','request','seconds','out','engine','port'].includes(key))throw new Error('未知参数：'+arg);
    if(!argv[i+1]||argv[i+1].startsWith('--'))throw new Error('缺少参数值：'+arg);
    out[key]=argv[++i];
  }
  return out;
}
function usage(){
  console.log('node bots/v7_levelgen.js --base <hk-base.json> --demand <hk-demand-am.json> --area kowloon-east [--request req.json] [--seconds 20] [--out level.json] [--compare] [--engine engine.js]');
  console.log('另外三片及九龙东：将 --area 替换成 --batch；预览：node bots/v7_levelgen.js --serve [--port 8053]');
}
const readJSON=p=>JSON.parse(fs.readFileSync(path.resolve(p),'utf8').replace(/^\uFEFF/,''));
function evaluate(base,demand,request,Engine,seconds){
  const res=cutter.cut(base,demand,request);
  if(!res.level)return {level:null,request,report:{doNothing:null,best:0,bestPlan:null,tiers:[0,0,0],seconds:0},problems:res.problems,notes:res.notes};
  const calibration=checker.calibrateRoads(res.level,Engine);
  const searched=bot.search(res.level,Engine,seconds);
  const checked=checker.check(res.level,Engine,searched);
  return {level:res.level,request,report:checked.report,problems:res.problems.concat(checked.problems),notes:res.notes.concat(calibration.notes,checked.notes)};
}
function summarize(res){
  console.log('\n片区：'+res.request.area+' · '+(res.level?res.level.title:'切片失败'));
  if(res.level)console.log(res.level.origins.length+' 屋苑 / '+res.level.destinations.length+' 去处 / '+res.level.roads.length+' 道路折线 / '+res.level.lines.length+' 港铁线');
  const r=res.report;
  console.log('doNothing jam='+ (r.doNothing?r.doNothing.jam:'-')+' · stable='+ (r.doNothing?r.doNothing.stable:'-')+' · best='+r.best+' · tiers='+r.tiers.join(', ')+' · '+r.seconds+'s');
  console.log('problems: '+(res.problems.map(p=>p.code).join(', ')||'none'));
  if(r.roadRank)console.log('v/c Spearman='+r.roadRank.spearman+' · model='+r.roadRank.modelTop.map(x=>x.name+':'+x.vc).join(' / ')+' · game='+r.roadRank.gameTop.map(x=>x.name+':'+x.vc).join(' / '));
}
function compareWithManual(res,Engine,seconds){
  if(!res.level)return;
  const manual=Engine.D.example('m3-1');
  const searched=bot.search(manual,Engine,seconds),checked=checker.check(manual,Engine,searched);
  res.comparison=comparison.compare(res.level,res.report,manual,checked.report,cutter);
  console.log('\n九龙东对照（名字精确匹配与近名匹配分别列出）：');
  console.table(res.comparison.origins.map(x=>({生成屋苑:x.name,手工屋苑:x.match||'无',精确:x.exact,匹配依据:x.matchedVia,生成份额:x.share.toFixed(3),手工份额:x.manualShare==null?'-':x.manualShare.toFixed(3)})));
  console.table(res.comparison.destinations.map(x=>({生成去处:x.name,手工去处:x.match||'无',精确:x.exact,生成吸引力:x.attraction.toFixed(2),手工吸引力:x.manualAttraction==null?'-':x.manualAttraction.toFixed(2)})));
  console.log('对应路名（含英文名称桥接）：'+(res.comparison.roads.shared.join('、')||'无'));
  console.table([{版本:'生成',人数:res.comparison.totals.generatedPeople,基准塞车:res.report.doNothing.jam,机器人:res.report.best},
    {版本:'手工',人数:res.comparison.totals.manualPeople,基准塞车:checked.report.doNothing.jam,机器人:checked.report.best}]);
  console.log('手工游戏 v/c：'+checked.report.roadRank.gameTop.map(x=>x.name+':'+x.vc).join(' / '));
}
function batchRequests(base,demand){
  const out=[{area:'kowloon-east',period:'am',mode:3,changes:[],title:'九龙东 · 原始切片',story:['原始早高峰底板，无改动。']}];
  const specs=[{word:'沙田',type:'people',add:30000,title:'沙田多三万人'},{word:'元朗',type:'people',add:20000,title:'元朗多两万人'},{word:'铜锣湾',type:'jobs',add:15000,title:'铜锣湾·湾仔多一万五千个岗位'}];
  for(const spec of specs){
    const area=base.areas.find(a=>cutter.norm([a.key,a.name,a.hans].join(' ')).includes(spec.word));
    if(!area){out.push({area:'missing:'+spec.word,period:'am',mode:3,changes:[],title:spec.title,story:['底板未提供该片区。']});continue;}
    const draft=cutter.cut(base,demand,{area:area.key,period:'am',mode:3,changes:[]});
    const items=draft.level?(spec.type==='people'?draft.level.origins:draft.level.destinations.filter(d=>d.kind!=='gate')):[];
    const item=items.slice().sort((a,b)=>(spec.type==='people'?b.sourcePop:b.jobs)-(spec.type==='people'?a.sourcePop:a.jobs))[0];
    const amount=item?(spec.type==='people'?item.sourcePop:item.jobs):0;
    const pct=amount?Math.min(150,Math.round(spec.add/amount*1000)/10):0;
    out.push({area:area.key,period:'am',mode:3,title:spec.title,
      story:[item?'“'+item.name+'”'+(spec.type==='people'?'人口':'岗位')+'增加 '+spec.add+'；按原数量换算为 '+pct+'%。':'没有可用于改动的人口或岗位团。'],
      changes:item?[{place:item.name,what:spec.type,pct,by_year:4}]:[]});
  }
  return out;
}
function serve(port){
  const http=require('node:http'),root=path.resolve(__dirname,'..');
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
  const server=http.createServer((req,res)=>{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    let file;
    try{const name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);file=path.resolve(root,'.'+(name==='/'?'/v7/shared/levelgen/preview.html':name));}
    catch{res.writeHead(400);res.end('Bad request');return;}
    if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(req.method==='HEAD'?undefined:data);});
  });
  server.on('error',e=>{console.error(e.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log('预览：http://127.0.0.1:'+port+'/v7/shared/levelgen/preview.html'));
}
function run(){
  let args;try{args=parse(process.argv.slice(2));}catch(e){console.error(e.message);usage();process.exitCode=2;return;}
  if(args.help){usage();return;}
  if(args.serve){const port=Number(args.port||8053);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('port 无效');serve(port);return;}
  if(args.benchmark){
    const seconds=Number(args.seconds||20);if(!Number.isFinite(seconds)||seconds<=0)throw new Error('seconds 必须为正数');
    const Engine=require(args.engine?path.resolve(args.engine):'../v7/mode3-roads/engine.js'),level=Engine.D.example('m3-1');
    const searched=bot.search(level,Engine,seconds),checked=checker.check(level,Engine,searched);
    const result={input:'手工九龙东，非全港切片',engine:args.engine||'复制的 mode3-roads/engine.js',level,report:checked.report,problems:checked.problems,notes:checked.notes};
    console.log(JSON.stringify(result,null,2));
    if(args.out){const file=path.resolve(args.out);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(result,null,2),'utf8');console.log('wrote '+file);}
    return;
  }
  if(!args.base||!args.demand||(!args.area&&!args.batch)){usage();process.exitCode=2;return;}
  const seconds=Number(args.seconds||20);if(!Number.isFinite(seconds)||seconds<=0)throw new Error('seconds 必须为正数');
  const crypto=require('node:crypto');
  const load=p=>{const file=path.resolve(p),raw=fs.readFileSync(file);return {data:JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,'')),source:{path:file,bytes:raw.length,sha256:crypto.createHash('sha256').update(raw).digest('hex')}};};
  const baseInput=load(args.base),demandInput=load(args.demand),base=baseInput.data,demand=demandInput.data;
  const inputs={base:baseInput.source,demand:demandInput.source};
  const Engine=require(args.engine?path.resolve(args.engine):'../v7/mode3-roads/engine.js');
  const requests=args.batch?batchRequests(base,demand):[{...(args.request?readJSON(args.request):{}),area:args.area}];
  const results=requests.map(req=>{
    req={...req,period:req.period||demand.period||'am',mode:req.mode==null?3:req.mode,changes:req.changes||[]};
    const result=evaluate(base,demand,req,Engine,seconds);summarize(result);
    if((args.compare||args.batch)&&req.area==='kowloon-east'&&req.changes.length===0)compareWithManual(result,Engine,seconds);
    return result;
  });
  const output=args.batch?{inputs,results}:{...results[0],inputs};
  if(args.out){const file=path.resolve(args.out);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(output,null,2),'utf8');console.log('\nwrote '+file);}
  else console.log(JSON.stringify(output,null,2));
  if(results.some(x=>!x.level))process.exitCode=2;
}
try{run();}catch(e){console.error(e.stack||e.message);process.exitCode=1;}
