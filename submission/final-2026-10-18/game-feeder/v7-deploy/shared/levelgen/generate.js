(function(root){
 'use strict';
 const node=typeof module!=='undefined'&&module.exports;
 const cutter=node?require('./cut.js'):root.LevelCutter,checker=node?require('./check.js'):root.LevelChecker;
 const simplifier=node?require('./simplify.js'):root.LevelSimplifier,layout=node?require('./layout.js'):root.LevelLayout;
 const bot=node?require('./bot.js'):root.LevelBot,bot24=node?require('./bot24.js'):root.LevelBot24;
 const clone=x=>JSON.parse(JSON.stringify(x));
 const period=r=>['am','day','holiday'].includes(r.period)?r.period:'am';
 function prepare(base,request){
  const req=clone(request||{}),notes=[];
  if(req.period&&req.period!==period(req))notes.push('Period '+req.period+' is not supported; using AM demand.');req.period=period(req);req.mode=req.mode==null?3:Number(req.mode);req.changes=req.changes||[];
  if(Array.isArray(req.box)&&req.box.length===4){base={...base,areas:[...base.areas,{key:'selection',name:req.boxName||'selection',box:req.box}]};req.area='selection';}
  const area=(base.areas||[]).find(a=>a.key===req.area),box=area&&cutter.makeBox(area.box);
  for(const c of Array.isArray(req.changes)?req.changes:[]){
   if(!c||c.add===undefined||c.pct!==undefined)continue;
   const field=c.what==='jobs'?'jobs':'pop';
   const pool=base.zones.filter(z=>box&&z.cell&&z.cell[0]>=box.c0&&z.cell[0]<box.c0+box.w&&z.cell[1]>=box.r0&&z.cell[1]<box.r0+box.h&&z[field]>0);
   const hit=cutter.matchPlace(c.place,pool),z=hit&&!hit.ambiguous&&hit.score>=.999?hit.item:null;
   if(!z)continue;
   c.pct=Math.max(-50,Math.min(150,Math.round(100*c.add/z[field])));c.from={add:c.add,base:z[field]};delete c.add;
  }
  return {base,request:req,notes};
 }
 function evaluate(base,demand,request,engine,seconds,onProgress=()=>{}){
  const prep=prepare(base,request),req=prep.request,notes=prep.notes;
  const empty=problems=>({level:null,request:req,report:null,problems,notes});
  if(![2,3,4].includes(req.mode))return empty([{code:'invalid_request',message:'mode must be 2, 3 or 4.'}]);
  if(!Array.isArray(req.changes))return empty([{code:'invalid_request',message:'changes must be an array.'}]);
  onProgress('cut');
  const result=req.mode===3?cutter.cut(prep.base,demand,req):layout['toMode'+req.mode](prep.base,demand,req);
  result.notes=notes.concat(result.notes||[]);
  if(!result.level)return {...result,request:req,report:null};
  const level=result.level;
  if(req.mode===3){
   try{simplifier.simplifyCorridors(level,engine,{calibrate:false,preserveChanges:true});}
   catch(err){return {level:null,request:req,report:null,problems:result.problems.concat({code:'unreachable',message:'Source corridors: '+err.message}),notes:result.notes};}
   const missing=(level.source.changes||[]).filter(c=>c.what==='road_cap'&&!level.roads.some(r=>r.name===c.resolved));
   if(missing.length)return {level:null,request:req,report:null,problems:[{code:'place_not_found',message:'Changed road has no positive-flow source corridor: '+missing.map(c=>c.resolved).join(', ')}],notes:result.notes};
   const calibration=checker.calibrateRoads(level,engine);level.source.calibration=calibration;
   onProgress('bot');const searched=bot.search(level,engine,seconds||15),checked=checker.check(level,engine,searched);
   return {level,request:req,report:checked.report,problems:result.problems.concat(checked.problems),notes:result.notes.concat(calibration.notes||[],checked.notes||[])};
  }
  onProgress('bot');const searched=bot24.search(level,engine,seconds,req.mode),tiers=searched.tiers,problems=result.problems.slice();
  level.tiers=tiers;
  if(searched.best<50)problems.push({code:'nothing_to_solve',message:'Best score below 50.'});
  if(searched.best>=50&&searched.simpleBest>=tiers[2])problems.push({code:'too_easy',message:'A short two-station, one-train plan already reaches master (mode 4: at most one land sale).'});
  const replay=bot24.replay(level,engine,searched.bestPlan);
  if(replay!==searched.best)problems.push({code:'invalid_input',message:'Bot plan score does not replay.'});
  return {level,request:req,report:{...searched,accepted:problems.length===0,replay,doNothing:{score:0},mode:req.mode},problems,notes:result.notes};
 }
 const API={period,prepare,evaluate};if(node)module.exports=API;root.LevelGenerator=API;
})(typeof window!=='undefined'?window:globalThis);
