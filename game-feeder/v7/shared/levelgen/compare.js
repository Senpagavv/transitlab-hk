(function(root){
  'use strict';
  // Display bridges for the corridors named in the hand-authored Kowloon East level.
  // They affect comparison labels only, never geometry, flows or capacities.
  const roadBridge={
    'KWUN TONG BYPASS':'觀塘繞道','KWUN TONG ROAD':'觀塘道',
    'HOI YUEN ROAD':'開源道','CLEAR WATER BAY ROAD':'清水灣道',
    'SAU MAU PING ROAD':'秀茂坪道','TSEUNG KWAN O TUNNEL ROAD':'將軍澳隧道',
    'TSEUNG KWAN O TUNNEL':'將軍澳隧道','TSEUNG LAM HIGHWAY':'將藍隧道'
  };
  function compare(generated,report,manual,manualReport,cutter){
    const match=(items,target)=>items.map(item=>{
      let chosen=null,via=null;
      for(const query of [item.name,item.hans,...(item.aliases||[])].filter(Boolean)){
        const hit=cutter.matchPlace(query,target);
        if(hit&&hit.item&&(!chosen||hit.score>chosen.score)){chosen=hit;via=query;}
      }
      return {name:item.name,match:chosen?chosen.item.name:null,matchedVia:via,exact:!!(chosen&&chosen.score===1),
        people:item.people,share:item.people==null?null:item.people/Math.max(1,items.reduce((s,x)=>s+(x.people||0),0)),
        manualPeople:chosen?chosen.item.people:null,
        manualShare:chosen&&chosen.item.people!=null?chosen.item.people/Math.max(1,target.reduce((s,x)=>s+(x.people||0),0)):null,
        attraction:item.attraction,manualAttraction:chosen?chosen.item.attraction:null};
    });
    const names=arr=>[...new Set(arr.map(x=>x.name))],roadNames=names(generated.roads),oldRoads=names(manual.roads);
    const roadMatches=[];
    for(const name of roadNames){
      const bridge=roadBridge[String(name).toUpperCase()],mapped=oldRoads.find(x=>cutter.norm(x)===cutter.norm(bridge||name));
      if(mapped)roadMatches.push({generated:name,manual:mapped,bridge:!!bridge});
    }
    return {
      origins:match(generated.origins,manual.origins),
      destinations:match(generated.destinations,manual.destinations),
      totals:{generatedPeople:generated.origins.reduce((s,x)=>s+x.people,0),manualPeople:manual.origins.reduce((s,x)=>s+x.people,0)},
      roads:{generated:roadNames,manual:oldRoads,shared:roadMatches.map(x=>x.manual),matches:roadMatches,
        literalShared:roadMatches.filter(x=>!x.bridge).map(x=>x.manual)},
      doNothing:{generated:report.doNothing,manual:manualReport.doNothing},
      roadRank:{generated:report.roadRank,manual:manualReport.roadRank},
      bot:{generated:report.best,manual:manualReport.best,ratio:manualReport.best?report.best/manualReport.best:null},
      parameters:{generated:{budget:generated.budget,phase2Budget:generated.phase2Budget||0,years:generated.years},
        manual:{budget:manual.budget,phase2Budget:manual.phase2Budget||0,years:manual.years}}
    };
  }
  const api={compare};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.LevelCompare=api;
})(typeof window!=='undefined'?window:globalThis);
