'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const ai=require(path.join(root,'v7/ai/client.js')),cutter=require(path.join(root,'v7/shared/levelgen/cut.js'));
const base=JSON.parse(fs.readFileSync(path.join(root,'v7/hk/hk-base.json'),'utf8'));
const demand=JSON.parse(fs.readFileSync(path.join(root,'v7/hk/hk-demand-am.json'),'utf8'));
const menus=ai.makeNames(base);
const request=(area,changes=[])=>({area,period:'am',mode:3,changes,title:'交通规划练习',story:['按原句推演。','比较交通方案。']});

test('menus use every canonical zone and Chinese roads inside each box',()=>{
  assert(menus['kai-tak'].places.length>40);
  assert(menus['kai-tak'].places.includes('啓德站一帶'));
  assert(menus['sha-tin-tai-wai'].places.includes('第一城站一帶'));
  assert(menus['tseung-kwan-o'].roads.includes('將軍澳隧道公路'));
  assert(menus['kowloon-east'].roads.includes('觀塘繞道'));
  assert.deepEqual(menus['northern-metropolis'].places,[]);
  for(const value of Object.values(menus))for(const road of value.roads)assert(/[\u3400-\u9fff]/.test(road));
});

test('menu clipping excludes outside sections, deduplicates, and retains known road aliases',()=>{
  const b={areas:[{key:'a',box:[0,0,16,12]}],zones:[{name:'區內',cell:[1,1]},{name:'區外',cell:[16,1]}],
    roads:[{id:1,name:'KWUN TONG BYPASS',en:'KWUN TONG BYPASS'},{id:2,name:'區外路'}],
    sections:[{road:1,a:[1,1],b:[2,1]},{road:1,a:[2,1],b:[3,1]},{road:2,a:[16,1],b:[17,1]}]};
  assert.deepEqual(ai.makeNames(b),{a:{places:['區內'],roads:['觀塘繞道']}});
});

for(const place of ['將軍澳隧道公路','将军澳隧道公路','將軍澳隧道','TSEUNG KWAN O TUNNEL ROAD']){
  test('road closure matches every segment in '+place,()=>{
    const before=cutter.cut(base,demand,request('tseung-kwan-o'));
    const after=cutter.cut(base,demand,request('tseung-kwan-o',[{place,what:'road_cap',pct:-60}]));
    assert.equal(after.problems.filter(p=>['place_not_found','invalid_request'].includes(p.code)).length,0);
    const change=after.level.source.changes[0];assert(change&&change.affectedSegments>0);
    const indices=before.level.roads.flatMap((r,i)=>cutter.norm(r.name)===cutter.norm(change.resolved)?[i]:[]);
    assert.equal(change.affectedSegments,indices.length);
    for(const i of indices)assert(Math.abs(after.level.roads[i].cap/before.level.roads[i].cap-.4)<1e-9);
    for(let i=0;i<before.level.roads.length;i++)if(!indices.includes(i))assert.equal(after.level.roads[i].cap,before.level.roads[i].cap);
  });
}

for(const [what,pct,valid] of [['road_cap',-60,true],['road_cap',50,true],['road_cap',-61,false],['road_cap',51,false],['people',-60,false],['people',150,true]]){
  test(`capacity/population bounds ${what} ${pct}`,()=>{
    const area=what==='road_cap'?'tseung-kwan-o':'tung-chung',place=what==='road_cap'?'將軍澳隧道公路':'逸東邨';
    const out=cutter.cut(base,demand,request(area,[{place,what,pct}]));
    assert.equal(!out.problems.some(p=>p.code==='invalid_request'),valid);
  });
}

test('a station or fuzzy name cannot stand in for a road',()=>{
  for(const place of ['將軍澳站一帶','將軍澳隧道公']){
    const out=cutter.cut(base,demand,request('tseung-kwan-o',[{place,what:'road_cap',pct:-40}]));
    assert(out.problems.some(p=>p.code==='place_not_found'));
    assert.equal(out.level.source.changes.length,0);
  }
});

test('every typed road menu entry resolves exactly in that area cutter',()=>{
  let checked=0;
  for(const [area,menu] of Object.entries(menus)){
    const out=cutter.cut(base,demand,request(area));
    if(!out.level)continue;
    for(const road of menu.roads){
      const hit=cutter.matchPlace(road,out.level.roads);
      // A one-edge isolated road can be pruned by the cutter. All retained names must match exactly.
      if(hit&&!hit.ambiguous){assert.equal(hit.score,1,`${area}: ${road}`);checked++;}
    }
  }
  assert(checked>100);
});

test('plain land-sale example does not add residents or jobs',()=>{
  assert.deepEqual(ai.pickExample('東涌東賣地').changes,[]);
  assert.deepEqual(ai.pickExample('東涌修地鐵').changes,[]);
  assert.deepEqual(ai.pickExample('啟德').changes,[]);
  assert.equal(ai.pickExample('北都'),null);
  assert.deepEqual(ai.pickExample('沙田多三萬人').changes,[{place:'沙田站一帶',what:'people',add:30000}]);
});

test('server validation errors cannot silently become an unrelated static example',async()=>{
  const old=global.fetch;
  global.fetch=async()=>({ok:false,status:422,json:async()=>({message:'缺少底板分区',code:'area_empty'})});
  try{await assert.rejects(()=>ai.generate('北都'),e=>e.code==='area_empty');}
  finally{global.fetch=old;}
});

test('panel sends typed menus and caches the base',async()=>{
  let fetches=0,captured;
  const context={I18N:{L:(...args)=>args[0],add(){},t:k=>k},TLAI:{makeNames:ai.makeNames,generate:async(s,args)=>{captured=args.names;return null;}},
    fetch:async url=>{assert.equal(url,'../hk/hk-base.json');fetches++;return {ok:true,json:async()=>base};}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'v7/mode5-sandbox/ai-level.js'),'utf8'),context);
  for(let i=0;i<2;i++)await context.TLAILevel.run('封路',{lang:'zh-Hans',mode:3,names:{bad:[]},status:{},out:{},areas:base.areas});
  assert.deepEqual(captured,menus);assert.equal(fetches,1);
});

test('client forwards names and original sentence using a fixed HTTP response',async()=>{
  const old=global.fetch;let sent;
  global.fetch=async(url,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>({request:request('tung-chung'),notes:[]})};};
  try{await ai.generate('东涌要修新地铁',{names:menus,build:()=>({problems:[]})});assert.equal(sent.sentence,'东涌要修新地铁');assert.deepEqual(sent.names,menus);}
  finally{global.fetch=old;}
});
