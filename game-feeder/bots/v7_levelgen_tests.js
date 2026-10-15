'use strict';
// Offline regression suite: node --test bots/v7_levelgen_tests.js
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../v7'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const base=read('hk/hk-base.json'),demand=read('hk/hk-demand-am.json');
const cutter=require('../v7/shared/levelgen/cut.js'),layout=require('../v7/shared/levelgen/layout.js'),generator=require('../v7/shared/levelgen/generate.js'),simplify=require('../v7/shared/levelgen/simplify.js'),bot=require('../v7/shared/levelgen/bot24.js');
const engines={2:require('../v7/mode2-metro/engine.js'),3:require('../v7/mode3-roads/engine.js'),4:require('../v7/mode4-tod/engine.js')};
const req=(mode,area='tung-chung',changes=[])=>({area,mode,period:'am',changes,title:'Offline test',story:['A teaching scenario.']});
const key=c=>c.join(','),copy=x=>JSON.parse(JSON.stringify(x));
test('mode 2/4 layouts preserve geographic order, separation, source numbers, water and lots across all populated areas',()=>{
 for(const mode of [2,4])for(const area of base.areas){
  const result=layout['toMode'+mode](base,demand,req(mode,area.key));
  if(area.key==='northern-metropolis'){assert.equal(result.level,null);assert.equal(result.problems[0].code,'box_empty');continue;}
  assert.deepEqual(result.problems,[],area.key);const l=result.level;
  assert.ok(l.origins.length>=5&&l.origins.length<=6);assert.ok(l.destinations.length>=2&&l.destinations.length<=3);
  const points=[...l.origins,...l.destinations],wet=new Set(l.water.map(key));
  assert.ok(Math.abs(l.origins.reduce((s,o)=>s+o.people,0)-280)<=3);
  points.forEach((p,i)=>{assert.ok(!wet.has(key(p.cell)));assert.ok(p.cell[0]>=0&&p.cell[0]<14&&p.cell[1]>=0&&p.cell[1]<9);
   for(const q of points.slice(i+1)){assert.ok(Math.max(Math.abs(p.cell[0]-q.cell[0]),Math.abs(p.cell[1]-q.cell[1]))>=2);
    for(const a of [0,1])assert.ok((p.sourceCell[a]-q.sourceCell[a])*(p.cell[a]-q.cell[a])>=0,area.key+' reversed direction');}
  });
  for(const o of l.origins)assert.equal(o.people,Math.round(o.sourceAM*l.source.scale));
  for(const d of l.destinations)assert.equal(d.attraction,+(16+8*d.jobs/l.source.maxJobs).toFixed(6));
  if(mode===4){assert.ok(l.land.length>=12&&l.land.length<=18);assert.ok(l.source.land.patches.length>=2&&l.source.land.patches.length<=3);
   const occupied=new Set(points.map(p=>key(p.cell)));assert.equal(new Set(l.land.map(q=>key(q.cell))).size,l.land.length);
   l.land.forEach(q=>assert.ok(!occupied.has(key(q.cell))&&!wet.has(key(q.cell))));}
 }
});
test('percentage changes apply to split homes and attractions, final growth is disclosed',()=>{
 const plain=layout.toMode2(base,demand,req(2)).level;
 const changed=layout.toMode2(base,demand,req(2,'tung-chung',[{place:'裕雅苑',what:'people',pct:50,by_year:4},{place:'東涌站一帶',what:'jobs',pct:50}]));
 assert.deepEqual(changed.problems,[]);assert.ok(changed.notes.some(n=>n.includes('final value')));
 for(const o of changed.level.origins.filter(o=>o.name.includes('裕雅苑'))){const old=plain.origins.find(p=>p.name===o.name);assert.equal(o.people,Math.round(old.people*1.5));assert.equal(o.grow,undefined);}
 assert.equal(changed.level.destinations.find(d=>d.name==='東涌站一帶').attraction,36);
});
test('invalid modes, road changes, unknown names and empty boxes remain rejected',()=>{
 for(const mode of [2,4])assert.equal(layout['toMode'+mode](base,demand,req(mode,'tung-chung',[{what:'road_cap',place:'x',pct:10}])).problems[0].code,'invalid_request');
 assert.equal(layout.toMode2(base,demand,req(2,'tung-chung',[{what:'people',place:'火星',pct:10}])).problems[0].code,'place_not_found');
 assert.equal(generator.evaluate(base,demand,req(5),engines[3],.1).problems[0].code,'invalid_request');
 assert.equal(generator.evaluate(base,demand,{...req(2),changes:'bad'},engines[2],.1).problems[0].code,'invalid_request');
});
test('absolute numbers and selection boxes use the shared preparer without mutating caller input',()=>{
 const z=base.zones.find(z=>z.name==='裕雅苑'),r=req(2,'tung-chung',[{place:z.name,what:'people',add:z.pop/2}]),saved=copy(r);
 const p=generator.prepare(base,r);assert.deepEqual(r,saved);assert.equal(p.request.changes[0].pct,50);
 const selected=generator.prepare(base,{...req(2),box:base.areas.find(a=>a.key==='tung-chung').box});assert.equal(selected.request.area,'selection');
 assert.ok(layout.toMode2(selected.base,demand,selected.request).level);
});
test('mode 2/4 period context keeps AM source numbers, and unsupported PM conversion is disclosed',()=>{
 for(const mode of [2,4]){
  const periodDemand=read('hk/hk-demand-holiday.json');
  const res=layout['toMode'+mode](base,{...periodDemand,amDemand:demand},{...req(mode),period:'holiday'});
  assert.ok(res.level);assert.equal(res.level.source.period,'holiday');assert.equal(res.level.source.peoplePeriod,'am');
  const normal=layout['toMode'+mode](base,demand,req(mode));assert.equal(res.level.source.amTotal,normal.level.source.amTotal);
 }
 const p=generator.prepare(base,{...req(2),period:'pm'});assert.equal(p.request.period,'am');assert.ok(p.notes.some(n=>n.includes('not supported')));
});
test('corridors use source edges, retain road-capacity changes and share task 57 adapter',()=>{
 assert.equal(require('./v7_levels_batch.js').simplifyCorridors,simplify.simplifyCorridors);
 const raw=cutter.cut(base,demand,req(3,'kowloon-east',[{place:'觀塘道',what:'road_cap',pct:-40,by_year:4}]));assert.deepEqual(raw.problems,[]);
 const edges=new Set(raw.level.source.roadSections.flatMap(r=>r.segments.map(s=>[key(s.a),key(s.b)].sort().join('|')))),before=raw.level.roads.length;
 simplify.simplifyCorridors(raw.level,engines[3],{calibrate:false,preserveChanges:true});assert.ok(before>10);assert.ok(raw.level.roads.length<=10&&raw.level.roads.length>=6);
 for(const road of raw.level.roads)for(let i=1;i<road.via.length;i++)assert.ok(edges.has([key(road.via[i-1]),key(road.via[i])].sort().join('|')));
 const index=raw.level.roads.findIndex(r=>r.name==='觀塘道');assert.ok(index>=0);assert.equal(raw.level.source.roadSections[index].capGrowFactors.at(-1)[1],.6);
});
test('mode 2 and 4 bot plans replay with the unmodified engines and exact tier formula',()=>{
 for(const mode of [2,4]){const res=generator.evaluate(base,demand,req(mode),engines[mode],.5);assert.ok(res.report.best>=50);assert.equal(bot.replay(res.level,engines[mode],res.report.bestPlan),res.report.best);assert.deepEqual(res.level.tiers,[.4,.65,.88].map(f=>Math.round(res.report.best*f)));if(mode===4)assert.ok(res.report.bestPlan.actions.length>0);}
});
test('client sends selected mode, preserves builder notes and retries rejected levels',async()=>{
 const calls=[];const fake={module:{exports:{}},fetch:async(url,opts)=>{calls.push(JSON.parse(opts.body));return {ok:true,json:async()=>({request:req(4),notes:['server']})};}};fake.globalThis=fake;
 vm.runInNewContext(fs.readFileSync(path.join(root,'ai/client.js'),'utf8'),fake);const ai=fake.module.exports;let builds=0;
 const result=await ai.generate('test',{mode:2,build:async request=>{assert.equal(request.mode,2);builds++;return {level:{},notes:['builder'],problems:builds===1?[{code:'too_easy'}]:[]};}});
 assert.equal(calls.length,2);assert.equal(calls[0].mode,2);assert.equal(calls[1].feedback[0].code,'too_easy');assert.ok(result.notes.includes('builder'));
 assert.equal(ai.pickExample('东涌修地铁').mode,2);assert.equal(ai.pickExample('东涌东卖地建新屋苑').mode,4);assert.equal(ai.pickExample('将军澳隧道封一条线').mode,3);
 assert.equal(ai.pickExample('TKO South metro').mode,2);assert.equal(ai.pickExample('Hung Shui Kiu property').mode,4);
});
test('mode 5 panel owns its new strings in all three languages',()=>{
 const strings={},c={globalThis:null,I18N:{L:(...args)=>args,add:x=>Object.assign(strings,x)}};c.globalThis=c;
 vm.runInNewContext(fs.readFileSync(path.join(root,'mode5-sandbox/ai-level.js'),'utf8'),c);
 for(const [k,v] of Object.entries(strings)){assert.equal(v.length,3,k);assert.ok(v.every(s=>typeof s==='string'&&s.length),k);}
 for(const n of [2,3,4]){assert.ok(strings['ai.open'+n]);assert.ok(strings['ai.mode'+n]);}
});
test('concurrent site examples-only policy survives the merge and never calls fetch',async()=>{
 let calls=0;const c={module:{exports:{}},TL_SITE:{ai:false},fetch:()=>{calls++;throw Error('network forbidden');}};c.globalThis=c;
 vm.runInNewContext(fs.readFileSync(path.join(root,'ai/client.js'),'utf8'),c);const ai=c.module.exports;
 assert.equal((await ai.status()).examples,true);
 const result=await ai.generate('东涌修地铁',{mode:2,build:async r=>({level:{},problems:[]})});assert.equal(result.source,'example');assert.equal(result.request.mode,2);
 assert.equal((await ai.comment({score:50,tiers:[10,20,40]})).source,'plain');
 await assert.rejects(ai.generate('unmatched input',{mode:4}),e=>e.code==='examples_only');assert.equal(calls,0);
 assert.equal(ai.pickExample('北部都会').area,'northern-metropolis');
});
test('panel refuses a builder rejection even when an example has a level object',async()=>{
 const c={I18N:{L:(...x)=>x,add:()=>{},t:k=>k},TLAI:{generate:async()=>({level:{},problems:[{code:'too_easy',message:'rejected'}]})}};c.globalThis=c;
 vm.runInNewContext(fs.readFileSync(path.join(root,'mode5-sandbox/ai-level.js'),'utf8'),c);
 const status={},out={};await c.TLAILevel.run('x',{mode:2,status,out});assert.equal(out.innerHTML,'');assert.equal(status.textContent,'ai.failrejected');
});
