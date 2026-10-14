/* Input/output bridge around the original, byte-for-byte unchanged worker and engine. */
importScripts('worker.js','scenarios.js');
const simulationMessage=self.onmessage,send=postMessage.bind(self);
let carOffset=0,jamOffset=0,originalCar=0,originalPT=0,originalJam=0;
self.postMessage=function(message){
  if(message.metrics){message.metrics={...message.metrics,vehiclesReduced:message.metrics.vehiclesReduced+carOffset,congestionReduced:message.metrics.congestionReduced+jamOffset,baseCarPeople:originalCar,basePtPeople:originalPT,baseCongestion:originalJam};}
  const row=r=>({...r,vehiclesReduced:r.vehiclesReduced+carOffset,congestionReduced:r.congestionReduced+jamOffset});
  if(message.rows)message.rows=message.rows.map(row);if(message.allRows)message.allRows=message.allRows.map(row);if(message.row&&message.row.round)message.row=row(message.row);
  send(message);
};
self.onmessage=function(event){
  const input=event.data;
  if(input.type==='init'||input.type==='period'){
    try{
      const raw=input.demand,changed=SandboxScenarios.adjust(raw,input.scenario,input.weights||{zones:{}});
      originalCar=raw.pairs.reduce((n,p)=>n+p[2],0);originalPT=raw.pairs.reduce((n,p)=>n+p[3],0);
      const loads=new Map(raw.sections.map(s=>[String(s[0]),s[1]]));originalJam=input.base.sections.reduce((n,s)=>{const load=loads.get(String(s.id))||0;return n+load*(load/s.cap)**2;},0);
      let adjusted=changed.demand;
      if(!changed.audit.unchanged){const prepared=SandboxEngine.prepare(input.base,raw);adjusted=SandboxScenarios.roadInputs(prepared,raw,adjusted);}
      const car=adjusted.pairs.reduce((n,p)=>n+p[2],0),newLoads=new Map(adjusted.sections.map(s=>[String(s[0]),s[1]]));
      const jam=input.base.sections.reduce((n,s)=>{const load=newLoads.get(String(s.id))||0;return n+load*(load/s.cap)**2;},0);
      carOffset=(originalCar-car)/SandboxEngine.CAR_OCCUPANCY;jamOffset=originalJam-jam;
      send({type:'scenario-audit',audit:changed.audit,runId:input.runId});
      simulationMessage({data:{...input,demand:adjusted}});
    }catch(e){send({type:'error',message:e.message,runId:input.runId});}
  }else simulationMessage(event);
};
