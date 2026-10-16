'use strict';
// node tools/levels/intake.test.js [--full <new scratch directory>]
// --full writes inspectable fixtures and runs the default full bots (no reduced restarts).
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),zlib=require('node:zlib');
const {spawnSync}=require('node:child_process');
const {crc32,readZip,readInput,safeName,MAX_FILE}=require('./intake-input.js');
const {guard}=require('./intake-worker.js');
const {intake,outputPath}=require('./intake.js');
const ROOT=path.resolve(__dirname,'../..'),DIR={1:'mode1-bus',2:'mode2-metro',3:'mode3-roads',4:'mode4-tod'};
function zip(entries){
  const local=[],central=[];let offset=0;
  for(const {name,text,method=8,attrs=0,plainSize} of entries){
    const data=Buffer.isBuffer(text)?text:Buffer.from(text),nb=Buffer.from(name),packed=method===8?zlib.deflateRawSync(data):data;
    const l=Buffer.alloc(30),c=Buffer.alloc(46),crc=crc32(data),size=plainSize??data.length;
    l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(0x800,6);l.writeUInt16LE(method,8);l.writeUInt32LE(crc,14);l.writeUInt32LE(packed.length,18);l.writeUInt32LE(size,22);l.writeUInt16LE(nb.length,26);
    c.writeUInt32LE(0x02014b50);c.writeUInt16LE(0x314,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(method,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(size,24);c.writeUInt16LE(nb.length,28);c.writeUInt32LE(attrs>>>0,38);c.writeUInt32LE(offset,42);
    local.push(l,nb,packed);central.push(c,nb);offset+=l.length+nb.length+packed.length;
  }
  const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,cd,end]);
}
function fixtures(){
  const out=[];
  for(let mode=1;mode<=4;mode++)for(const [i,tag] of ['a','b'].entries()){
    const D=require(path.join(ROOT,'v7',DIR[mode],'data.js'));
    const level=D.example(mode===1?'l'+(i+1):'m'+mode+'-1');
    delete level.demo;
    if(mode===1)level.waves=level.waves.map(w=>w.map(n=>Math.max(1,Math.round(n*(i?.36:.3)))));
    else{level.origins=level.origins.map(o=>({...o,people:Math.round(o.people*(i?.92:1.04))}));level.budget+=i?1:-1;}
    const e={format:'tl-level/1',mode,key:`intake-m${mode}-${tag}`,order:i+10,challenge:tag==='b',
      title:{'zh-Hant':`收件自測 ${mode}-${tag}`,'zh-Hans':`收件自测 ${mode}-${tag}`,en:`Intake self-test ${mode}-${tag}`},
      story:['脚本从内置地图另存，人数 / 预算做小幅改动，仅供工具自测。'],hub:{station:'沙田'},author:'Task 66 self-test',source:'Built-in geometry; altered demand/budget for test fixtures only',level};
    assert.deepEqual(guard(e),[]);out.push(e);
  }
  return out;
}
function uiFallbackTest(entry){
  let score=0,shown=false;const listeners={},nodes={};
  const el=()=>({style:{},className:'',hidden:false,onclick:null,appendChild(){},after(){},before(){},remove(){},querySelector(){return{scrollTop:0,scrollHeight:0};},querySelectorAll(){return[];},showModal(){shown=true;},close(){},set innerHTML(s){this.html=s;},get innerHTML(){return this.html||'';}});
  for(const id of ['lvInfo','demoBtn','demoDlg','demoCancel','demoBox','stations'])nodes[id]=el();
  const D={map:entry.key,origins:[{name:'屋苑',cell:[1,1]}],waves:[[1]],demo:entry.level.demo};
  const root={I18N:{t:k=>k,L:(...a)=>a[0],add(){},short:o=>o.name},TIDE_DATA:D,Tide:{dist:()=>1,shareAt:()=>1},
    TL_LEVELS:{get:()=>entry},TL_GAME:{pause(){},demo:{start(){},move(){return true;}}},addEventListener(k,f){listeners[k]=f;}};
  const box={window:root,document:{getElementById:id=>nodes[id],createElement:el,head:el(),body:el()},clearTimeout(){},setTimeout(){}};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT,'v7/mode1-bus/demo.js'),'utf8'),box);
  assert.equal(nodes.demoBtn.hidden,false);root.TL_DEMO.open();assert.equal(shown,true);
  for(const key of ['pass','high','master']){root.TL_DEMO.start(entry.key,key);assert.equal(root.TL_DEMO.active,true);root.TL_DEMO.tick({done:true,roundStart:[],delivered:entry.level.demo[key].score});score++;}
  // Current mode1 data.make drops D.demo: the registry fallback must also work.
  delete D.demo;root.TL_DEMO.open();assert.equal(nodes.demoBtn.hidden,false);
  root.TL_DEMO.start(entry.key,'master');assert.equal(root.TL_DEMO.active,true);
  // Built-in table must retain precedence, even if a registry entry shares the key.
  return score;
}
function full(dir){
  if(fs.existsSync(dir))throw Error('自测目录必须全新');fs.mkdirSync(dir,{recursive:true});
  const entries=fixtures(),source=path.join(dir,'input');fs.mkdirSync(source);
  for(const e of entries)fs.writeFileSync(path.join(source,e.key+'.json'),JSON.stringify(e,null,2));
  const duplicate=JSON.parse(JSON.stringify(entries[2]));duplicate.author='Duplicate author';duplicate.level.budget-=2;
  const archive=entries.map((e,i)=>({name:'组员/'+e.key+'.json',text:JSON.stringify(e),method:i%2?0:8}));
  archive.push({name:'坏JSON.json',text:'{"format":'}, {name:'重复编号.json',text:JSON.stringify(duplicate)}, {name:'../逃逸.json',text:JSON.stringify(entries[0])});
  const archivePath=path.join(dir,'组员提交.zip');fs.writeFileSync(archivePath,zip(archive));
  const out=path.join(dir,'zip-output'),p=spawnSync(process.execPath,[path.join(__dirname,'intake.js'),archivePath,'--out',out],{stdio:'inherit',windowsHide:true});
  assert.equal(p.status,2);const r=JSON.parse(fs.readFileSync(path.join(out,'报告.json'),'utf8'));
  assert.equal(r.summary.items,11);assert.equal(r.summary.processed,9);assert.equal(r.summary.rejected,2);assert.equal(r.rows.filter(x=>x.conflict).length,2);
  assert.equal(fs.existsSync(path.join(dir,'逃逸.json')),false);
  let demos=0;for(const row of r.rows.filter(x=>x.output)){
    const e=JSON.parse(fs.readFileSync(path.join(out,row.output),'utf8'));assert.equal(e.key,row.key);
    assert.deepEqual(e.level.tiers,[.4,.65,.88].map(f=>Math.round(row.best*f)));
    assert.deepEqual(row.originalTiers,entries.find(x=>x.key===e.key).level.tiers);
    if(e.challenge)assert.equal(e.level.demo,undefined);
    else for(const [i,k] of ['pass','high','master'].entries()){assert.equal(e.level.demo[k].score,row.replays[k].score);assert.ok(row.replays[k].score>=e.level.tiers[i]);demos++;}
    const check=spawnSync(process.execPath,[path.join(__dirname,'levels.js'),'check',path.join(out,row.output)],{encoding:'utf8',windowsHide:true});assert.equal(check.status,0,check.stdout+check.stderr);
    if(e.mode===1&&!e.challenge)assert.equal(uiFallbackTest(e),3);
  }
  // Folder intake, metadata warnings, and a genuinely low-scoring arbitrary level.
  const folder=path.join(dir,'folder-input');fs.mkdirSync(folder);const low=JSON.parse(JSON.stringify(entries[0]));
  low.key='intake-low-score';low.level.waves=low.level.waves.map(w=>w.map(()=>1));delete low.title.en;low.hub.station='不存在的站';
  fs.writeFileSync(path.join(folder,'low.json'),JSON.stringify(low));const fr=intake(folder,path.join(dir,'folder-output'));
  assert.equal(fr.rows[0].tooHard,true);assert.ok(fr.rows[0].missingLanguages.includes('en'));assert.ok(fr.rows[0].issues.some(x=>x.includes('stations.js')));assert.ok(fr.rows[0].output);
  const result={rows:r.summary.items,processed:r.summary.processed,rejected:r.summary.rejected,conflicts:2,defaultSearch:true,demosReplayed:demos,
    challengeWithoutDemo:r.rows.filter(x=>x.output&&x.challenge).length,folder:true,lowScore:fr.rows[0].best,mode1Fallback:'D.demo and registry both exercised',passed:true};
  fs.writeFileSync(path.join(dir,'自测结果.json'),JSON.stringify(result,null,2)+'\n');console.log('SELFTEST '+JSON.stringify(result));
}
if(process.argv.includes('--full'))full(path.resolve(process.argv[process.argv.indexOf('--full')+1]));
else{
  const scratch=path.resolve(process.env.TEMP||__dirname,'tl-intake-test-'+process.pid+'-'+Date.now());fs.mkdirSync(scratch,{recursive:true});
  const put=(name,entries)=>{const f=path.join(scratch,name);fs.writeFileSync(f,zip(entries));return f;};
  test.after(()=>fs.rmSync(scratch,{recursive:true,force:true}));
  test('ZIP stored / deflate / UTF-8 and folder return only JSON data',()=>{
    const f=put('valid.zip',[{name:'中文/a.json',text:'{"x":1}'},{name:'b.json',text:'{"x":2}',method:0}]);
    assert.deepEqual(readZip(f).map(x=>x.entry.x),[1,2]);const d=path.join(scratch,'folder');fs.mkdirSync(d);fs.writeFileSync(path.join(d,'a.json'),'{}');assert.equal(readInput(d).length,1);
  });
  test('path traversal, roots, Windows separators, non-JSON, huge / bomb, symlink and bad JSON are rejected',()=>{
    for(const n of ['../a.json','x/../../a.json','..\\a.json','/a.json','C:\\a.json','a\0.json'])assert.equal(safeName(n),false,n);
    const f=put('bad.zip',[{name:'../evil.json',text:'{}'},{name:'run.js',text:'throw Error("never execute")'},
      {name:'large.json',text:Buffer.alloc(MAX_FILE+1,32)},{name:'lie.json',text:Buffer.alloc(MAX_FILE+1,32),plainSize:2},
      {name:'link.json',text:'elsewhere',attrs:0xa1ff0000},{name:'bad.json',text:'{'}]);
    const rows=readZip(f);assert.equal(rows.length,6);assert.ok(rows.every(x=>x.rejected));assert.equal(fs.existsSync(path.join(scratch,'evil.json')),false);
  });
  test('CRC, local filename mismatch, duplicate ZIP entry, corrupt archive',()=>{
    const f=put('crc.zip',[{name:'a.json',text:'{}',method:0}]),b=fs.readFileSync(f);b[30+Buffer.byteLength('a.json')]=33;fs.writeFileSync(f,b);assert.ok(readZip(f)[0].rejected);
    const g=put('names.zip',[{name:'a.json',text:'{}'}]),c=fs.readFileSync(g);c[30]=98;fs.writeFileSync(g,c);assert.ok(readZip(g)[0].rejected);
    assert.ok(readZip(put('repeat.zip',[{name:'a.json',text:'{}'},{name:'a.json',text:'{}'}]))[1].rejected);
    const h=path.join(scratch,'corrupt.zip');fs.writeFileSync(h,'not zip');assert.throws(()=>readZip(h));
  });
  test('schema rejects null, wrong types, unsafe keys, infinite / dangerous parameters',()=>{
    for(const e of [null,[],{mode:'2'},JSON.parse('{"mode":1,"level":{},"__proto__":{}}')])assert.ok(guard(e).length);
    for(const e of fixtures()){assert.deepEqual(guard(e),[]);const bad=JSON.parse(JSON.stringify(e));bad.level.tiers=[1,2,null];assert.ok(guard(bad).length);}
    const e=fixtures()[2];e.level.trainCost=0;assert.ok(guard(e).length);
  });
  test('output refuses input overlap, live levels, nonempty output',()=>{
    const input=path.join(scratch,'input');fs.mkdirSync(input);assert.throws(()=>outputPath(input,path.join(input,'out')));
    assert.throws(()=>outputPath(input,path.join(ROOT,'v7/levels/forbidden')));assert.throws(()=>outputPath(input,ROOT));
    const out=path.join(scratch,'old');fs.mkdirSync(out);fs.writeFileSync(path.join(out,'keep.txt'),'keep');assert.throws(()=>outputPath(input,out));
  });
  test('malformed container produces report and exit code 2',()=>{
    const f=path.join(scratch,'broken.zip');fs.writeFileSync(f,'zip?');const r=intake(f,path.join(scratch,'broken-output'));assert.equal(r.code,2);assert.equal(r.rows[0].rejected,true);assert.ok(fs.existsSync(path.join(r.out,'报告.md')));
  });
  test('two-place arbitrary metro level uses --level and terminates without waiting for four unique places',()=>{
    const e=fixtures()[2];e.key='intake-two-places';e.level.origins=e.level.origins.slice(0,1);e.level.destinations=e.level.destinations.slice(0,1);
    e.level.origins[0].cell=[1,1];e.level.origins[0].people=3;e.level.destinations[0].cell=[5,1];
    const file=path.join(scratch,'two.json');fs.writeFileSync(file,JSON.stringify(e));
    const p=spawnSync(process.execPath,[path.join(__dirname,'intake-worker.js'),file,'2'],{encoding:'utf8',timeout:20000,windowsHide:true});
    assert.equal(p.status,0,p.stderr);const r=JSON.parse(p.stdout);assert.equal(r.ok,true,JSON.stringify(r));assert.ok(r.best<100,'must score supplied three-person level, not built-in level');
    const folder=path.join(scratch,'existing-key');fs.mkdirSync(folder);e.key='m2-1';fs.writeFileSync(path.join(folder,'replacement.json'),JSON.stringify(e));
    const intakeResult=intake(folder,path.join(scratch,'existing-key-output'),{restarts:2});
    assert.equal(intakeResult.code,2);assert.equal(intakeResult.rows[0].conflict,true);assert.ok(intakeResult.rows[0].output.startsWith('待确认/'));
    assert.equal(fs.existsSync(path.join(intakeResult.out,'m2/m2-1.json')),false);
  });
}
module.exports={zip,fixtures,uiFallbackTest};
