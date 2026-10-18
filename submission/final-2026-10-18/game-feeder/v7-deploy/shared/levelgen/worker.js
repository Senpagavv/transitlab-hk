// Shared browser/CLI pipeline; engines are loaded once per requested mode.
importScripts('cut.js','check.js','simplify.js','layout.js','bot.js','bot24.js','generate.js');
const cache={},engines={};
const dirs={2:'mode2-metro',3:'mode3-roads',4:'mode4-tod'},globals={2:'Metro',3:'Roads',4:'TOD'};
async function grid(name){
 if(!cache[name]){const response=await fetch('../../hk/'+name);if(!response.ok)throw Error('Grid HTTP '+response.status+': '+name);cache[name]=await response.json();}
 return cache[name];
}
onmessage=async e=>{
 try{
  const request=e.data.request||{},mode=request.mode==null?3:Number(request.mode);
  if(!dirs[mode]){postMessage({done:true,level:null,problems:[{code:'invalid_request',message:'mode must be 2, 3 or 4.'}]});return;}
  if(!engines[mode]){importScripts('../../'+dirs[mode]+'/data.js','../../'+dirs[mode]+'/engine.js');engines[mode]=self[globals[mode]];}
  postMessage({progress:'cut'});
  const base=await grid('hk-base.json');let demand=await grid('hk-demand-'+LevelGenerator.period(request)+'.json');
  if(mode!==3&&demand.period!=='am')demand={...demand,amDemand:await grid('hk-demand-am.json')};
  const result=LevelGenerator.evaluate(base,demand,request,engines[mode],e.data.seconds||15,p=>postMessage({progress:p}));
  postMessage({done:true,...result});
 }catch(err){postMessage({done:true,error:String(err&&err.message||err)});}
};
