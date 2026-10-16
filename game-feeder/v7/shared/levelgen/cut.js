(function(root) {
  'use strict';

  const SIMP = {"觀":"观","啟":"启","啓":"启","龍":"龙","灣":"湾","將":"将","軍":"军","綫":"线","東":"东","順":"顺","門":"门","區":"区","環":"环","島":"岛","頭":"头","廣":"广","場":"场","鐵":"铁","車":"车","繞":"绕","經":"经","貿":"贸","業":"业","邨":"村","樂":"乐","園":"园","縣":"县","時":"时","間":"间","聯":"联","運":"运","輸":"输","線":"线","學":"学","會":"会","銀":"银","發":"发","達":"达","國":"国","際":"际","樹":"树","青":"青","葵":"葵","荃":"荃","錦":"锦","麗":"丽","馬":"马","涌":"涌","遠":"远","屬":"属","處":"处","億":"亿","萬":"万","陽":"阳","橋":"桥","號":"号","臺":"台","風":"风","後":"后","裏":"里","電":"电","氣":"气","條":"条","記":"记","樓":"楼","廈":"厦","寶":"宝","羅":"罗","蘭":"兰","蘇":"苏","賢":"贤","餘":"余","濱":"滨","錶":"表","舊":"旧","連":"连","點":"点","總":"总","選":"选","擇":"择","與":"与","為":"为","這":"这","個":"个","樣":"样","裡":"里","於":"于","開":"开","長":"长","興":"兴","產":"产","務":"务","層":"层","輕":"轻","寧":"宁","莊":"庄","鄉":"乡","鎮":"镇","墟":"墟","樟":"樟","埔":"埔","壩":"坝","壢":"坜","廟":"庙","體":"体","驗":"验","數":"数","據":"据","類":"类","型":"型","圖":"图","書":"书","館":"馆","廳":"厅","應":"应","對":"对","難":"难","簡":"简","邊":"边","值":"值","銅":"铜","鑼":"锣","榮":"荣","曉":"晓","聖":"圣"};
  const ROAD_ALIASES = {"KWUN TONG BYPASS":["觀塘繞道","观塘绕道"],"KWUN TONG ROAD":["觀塘道","观塘道"],"HOI YUEN ROAD":["開源道","开源道"],"CLEAR WATER BAY ROAD":["清水灣道","清水湾道"],"SAU MAU PING ROAD":["秀茂坪道","秀茂坪道"],"TSEUNG KWAN O TUNNEL ROAD":["將軍澳隧道公路","将军澳隧道公路","將軍澳隧道","将军澳隧道"],"TSEUNG KWAN O TUNNEL":["將軍澳隧道","将军澳隧道"],"TSEUNG LAM HIGHWAY":["將藍公路","将蓝公路"]};
  const cleanText = s => String(s == null ? '' : s).toLowerCase().replace(/[\s·・.,，。:：()（）「」『』《》\-_]/g, '');
  function norm(s) { return Array.from(cleanText(s), c => SIMP[c] || c).join(''); }
  const cellKey = c => `${c[0]},${c[1]}`;
  const manhattan = (a,b) => Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]);
  const inside = (c,b) => !!c && c[0] >= b.c0 && c[0] < b.c0+b.w && c[1] >= b.r0 && c[1] < b.r0+b.h;
  const rel = (c,b) => [c[0]-b.c0,c[1]-b.r0];
  const number = v => Number.isFinite(+v) ? +v : 0;

  function makeBox(box) {
    if (!Array.isArray(box) || box.length < 4) return null;
    const [c0,r0,c1,r1] = box.map(Number), dx=c1-c0, dy=r1-r0;
    if (![c0,r0,c1,r1].every(Number.isFinite) || dx < 0 || dy < 0) return null;
    // Task 51 describes 16×12 boxes but does not spell out endpoint semantics. Accept
    // either [start,end) (16,12 deltas) or inclusive bounds (15,11 deltas).
    const w = dx === 15 ? 16 : dx, h = dy === 11 ? 12 : dy;
    return {c0,r0,w,h,source:[c0,r0,c1,r1]};
  }

  function dist2(a,b) { return manhattan(a,b); }
  function components(items,cellOf) {
    const out=[];
    for(const item of items){
      // Complete-link groups: every pair of source representatives stays within two
      // cells. Transitive proximity would collapse most of a dense city into one group.
      const eligible=out.filter(group=>group.every(x=>dist2(cellOf(x),cellOf(item))<=2));
      eligible.sort((a,b)=>Math.min(...a.map(x=>dist2(cellOf(x),cellOf(item))))-Math.min(...b.map(x=>dist2(cellOf(x),cellOf(item)))));
      if(eligible.length)eligible[0].push(item);else out.push([item]);
    }
    return out;
  }
  function weightedCell(items, weightOf) {
    const total=items.reduce((sum,x)=>sum+Math.max(0,weightOf(x)),0);
    if(!total)return items[0].cell.slice();
    return [0,1].map(axis=>Math.round(items.reduce((sum,x)=>sum+x.cell[axis]*Math.max(0,weightOf(x)),0)/total));
  }
  function labelZone(z) { return String(z.name || z.hans || z.id || '未命名分区'); }
  function groups(zones,metric) {
    return components(zones.slice().sort((a,b)=>number(b[metric])-number(a[metric])||String(a.id).localeCompare(String(b.id))),z=>z.cell).map(members=>{
      const total=members.reduce((s,z)=>s+number(z[metric]),0);
      const rep=members.slice().sort((a,b)=>number(b[metric])-number(a[metric]))[0];
      return {members,total,rep,cell:weightedCell(members,z=>number(z[metric]))};
    }).sort((a,b)=>b.total-a.total);
  }
  function safeHouse(cell,box) {
    for(const d of [[1,0],[-1,0],[0,1],[0,-1]]) if(cell[0]+d[0]>=0&&cell[0]+d[0]<box.w&&cell[1]+d[1]>=0&&cell[1]+d[1]<box.h)return d;
    return [0,0];
  }
  function editDistance(a,b) {
    const x=Array.from(a),y=Array.from(b);let prev=Array.from({length:y.length+1},(_,i)=>i);
    for(let i=1;i<=x.length;i++){const row=[i];for(let j=1;j<=y.length;j++)row[j]=Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+(x[i-1]===y[j-1]?0:1));prev=row;}return prev[y.length];
  }
  function aliases(x) { const values=[x.name,x.hans,x.short,x.shortHans,x.en,...(x.aliases||[])].filter(Boolean).map(norm);return [...new Set(values.flatMap(s=>[s,s.replace(/站一带$/,''),s.replace(/(?:村|苑)$/,'')]))]; }
  function matchPlace(place,items) {
    const q=norm(place); if(!q||!items.length)return null;
    const ranked=items.map(item=>{
      let score=0;
      for(const a of aliases(item)){
        if(a===q)score=1;
        else if(a.includes(q)||q.includes(a))score=Math.max(score,.72+.28*Math.min(a.length,q.length)/Math.max(a.length,q.length));
        else score=Math.max(score,1-editDistance(a,q)/Math.max(a.length,q.length,1));
      }
      return {item,score};
    }).sort((a,b)=>b.score-a.score);
    if(ranked[0].score<.6)return null;
    if(ranked[1]&&ranked[1].score>=ranked[0].score-.02&&norm(ranked[1].item.name)!==norm(ranked[0].item.name))
      return {item:null,score:ranked[0].score,ambiguous:true};
    return ranked[0];
  }
  function titleForGate(z,side) {
    const s=`${z&&z.name||''}${z&&z.hans||''}${z&&z.en||''}${z&&z.district||''}`;
    if(/港島|香港島|hong.?kong.?island/i.test(s))return '往港島';
    if(/九龍|kowloon/i.test(s))return '往九龍';
    if(/新界|new.?territories/i.test(s))return '往新界';
    const dir={left:'西',right:'東',top:'北',bottom:'南'}[side]||'外';
    return `往${dir}面`;
  }
  function sideOf(cell,b) {
    const cx=b.c0+(b.w-1)/2, cy=b.r0+(b.h-1)/2, dx=cell[0]-cx,dy=cell[1]-cy;
    if(Math.abs(dx)/Math.max(1,b.w)>=Math.abs(dy)/Math.max(1,b.h))return dx<0?'left':'right';
    return dy<0?'top':'bottom';
  }
  function gateCell(side,originCell,b) {
    const c=Math.max(0,Math.min(b.w-1,Math.round(originCell[0]-b.c0))),r=Math.max(0,Math.min(b.h-1,Math.round(originCell[1]-b.r0)));
    if(side==='left')return [b.c0,b.r0+r];
    if(side==='right')return [b.c0+b.w-1,b.r0+r];
    if(side==='top')return [b.c0+c,b.r0];
    return [b.c0+c,b.r0+b.h-1];
  }
  function textForLine(line,stationById) {
    const stations=(line.stations||[]).map(id=>stationById.get(String(id))).filter(Boolean);
    return stations;
  }
  function undirectedKey(a,b) { return [cellKey(a),cellKey(b)].sort().join('|'); }
  function linePieces(cells) {
    const pieces=[];let cur=[];
    for(let i=0;i<cells.length;i++){
      const c=cells[i];
      if(!c){if(cur.length>1)pieces.push(cur);cur=[];continue;}
      if(cur.length&&manhattan(cur[cur.length-1],c)!==1){if(cur.length>1)pieces.push(cur);cur=[];}
      if(!cur.length||cellKey(cur[cur.length-1])!==cellKey(c))cur.push(c);
    }
    if(cur.length>1)pieces.push(cur);return pieces;
  }
  function roadPieces(selected,box) {
    const allByRoad=new Map();
    for(const s of selected){const k=String(s.road);if(!allByRoad.has(k))allByRoad.set(k,[]);allByRoad.get(k).push(s);}
    const degree=new Map(),roadAt=new Map();
    for(const s of selected)for(const c of [s.a,s.b]){const k=cellKey(c);degree.set(k,(degree.get(k)||0)+1);if(!roadAt.has(k))roadAt.set(k,new Set());roadAt.get(k).add(String(s.road));}
    const out=[];
    for(const [rid,segs] of allByRoad){
      const remain=new Set(segs.map((_,i)=>i));
      while(remain.size){const first=remain.values().next().value,comp=[segs[first]];remain.delete(first);let changed=true;
        while(changed){changed=false;for(const i of [...remain])if(comp.some(s=>manhattan(s.a,segs[i].a)===0||manhattan(s.a,segs[i].b)===0||manhattan(s.b,segs[i].a)===0||manhattan(s.b,segs[i].b)===0)){comp.push(segs[i]);remain.delete(i);changed=true;}}
        const touchesJunction=comp.some(s=>[s.a,s.b].some(c=>[...(roadAt.get(cellKey(c))||[])].some(other=>other!==rid)));
        const touchesFrame=comp.some(s=>[s.a,s.b].some(c=>c[0]===box.c0||c[0]===box.c0+box.w-1||c[1]===box.r0||c[1]===box.r0+box.h-1));
        if(comp.length===1&&!touchesJunction&&!touchesFrame)continue;
        for(const s of comp)out.push(s);
      }
    }
    return out;
  }

  function cut(base,demand,request) {
    request=request||{};const problems=[],notes=[];
    if(!base||!Array.isArray(base.zones)||!demand||!Array.isArray(demand.pairs))return {level:null,problems:[{code:'invalid_input',message:'需要 hk-base.json 的 zones/areas 和 hk-demand-<period>.json 的 pairs。'}],notes};
    if(!Number.isInteger(base.cols)||!Number.isInteger(base.rows)||base.cols<=0||base.rows<=0||typeof base.land!=='string'||base.land.length!==base.cols*base.rows)return {level:null,problems:[{code:'invalid_input',message:'底板 cols/rows/land 长度不符合格式。'}],notes};
    const area=(base.areas||[]).find(a=>String(a.key)===String(request.area));
    if(!area)return {level:null,problems:[{code:'box_empty',message:`底板找不到片区 ${request.area||'(未指定)'}`}],notes};
    const box=makeBox(area.box);
    if(!box||box.w<=0||box.h<=0)return {level:null,problems:[{code:'box_empty',message:`片区 ${area.key} 的 box 无效。`}],notes};
    if(box.w!==16||box.h!==12)notes.push(`底板 box 为 ${box.w}×${box.h} 格；按文件中的端点解释切取。`);
    const period=String(request.period||demand.period||'am');
    if(!['am','pm','day','holiday'].includes(period))return {level:null,problems:[{code:'invalid_request',message:'不支持的时段 '+period}],notes};
    if(period==='pm')return {level:null,problems:[{code:'invalid_request',message:'第一版尚未实现 pm 的出发地/目的地对调。'}],notes};
    if(demand.period&&demand.period!==period)return {level:null,problems:[{code:'invalid_input',message:'请求时段与需求文件不一致。'}],notes};
    if(request.mode!=null&&Number(request.mode)!==3)return {level:null,problems:[{code:'invalid_request',message:'第一版仅支持 mode 3。'}],notes};
    if(request.changes!=null&&!Array.isArray(request.changes))return {level:null,problems:[{code:'invalid_request',message:'changes 必须是数组。'}],notes};
    if(box.c0<0||box.r0<0||box.c0+box.w>number(base.cols)||box.r0+box.h>number(base.rows))return {level:null,problems:[{code:'box_empty',message:'片区范围超出底板边界。'}],notes};
    const inZones=base.zones.filter(z=>Array.isArray(z.cell)&&inside(z.cell,box)).map(z=>({...z,cell:z.cell.map(Number)}));
    const residential=inZones.filter(z=>number(z.pop)>0);
    const jobZones=inZones.filter(z=>number(z.jobs)>0);
    if(!residential.length&&!jobZones.length)problems.push({code:'box_empty',message:`${area.key} 框内没有人口或岗位分区。`});
    const originGroups=groups(residential,'pop').slice(0,6);
    const jobGroups=groups(jobZones,'jobs').slice(0,2);
    const roadCells=new Set();for(const s of base.sections||[])for(const c of [s.a,s.b])if(Array.isArray(c)&&inside(c,box))roadCells.add(cellKey(c));
    const terrain=typeof base.land==='string'?base.land:(Array.isArray(base.land)?base.land.join(''):'');
    const dry=c=>!['~','w'].includes(terrain[c[1]*number(base.cols)+c[0]]);
    const nearRoad=c=>[[0,0],[1,0],[-1,0],[0,1],[0,-1]].some(d=>roadCells.has(cellKey([c[0]+d[0],c[1]+d[1]])));
    const accessCell=(cell,edge)=>{
      let candidates=[];
      if(edge){
        for(let r=box.r0;r<box.r0+box.h;r++)for(let c=box.c0;c<box.c0+box.w;c++){
          const onSide=edge==='left'?c===box.c0:edge==='right'?c===box.c0+box.w-1:edge==='top'?r===box.r0:r===box.r0+box.h-1;
          if(onSide)candidates.push([c,r]);
        }
      } else {
        for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(Math.abs(dx)+Math.abs(dy)<=2)candidates.push([cell[0]+dx,cell[1]+dy]);
      }
      candidates=candidates.filter(c=>inside(c,box)&&dry(c)).sort((a,b)=>manhattan(a,cell)-manhattan(b,cell)||a[1]-b[1]||a[0]-b[0]);
      const connected=candidates.find(nearRoad),chosen=connected||candidates[0]||cell;
      if(manhattan(chosen,cell)>0)notes.push((edge?'出口':'人口/岗位加权格')+' '+cell.join(',')+' 移到 '+chosen.join(',')+'（避水或接驳道路）。');
      return chosen;
    };
    originGroups.forEach(g=>g.gameCell=accessCell(g.cell));jobGroups.forEach(g=>g.gameCell=accessCell(g.cell));
    const originByZone=new Map();originGroups.forEach((g,i)=>g.members.forEach(z=>originByZone.set(String(z.id),i)));
    const destByZone=new Map();jobGroups.forEach((g,i)=>g.members.forEach(z=>destByZone.set(String(z.id),i)));
    const baseById=new Map(base.zones.map(z=>[String(z.id),z]));
    const seq=(demand.zones||base.zones.map(z=>z.id)).map(String);
    const groupedFlows=originGroups.map(()=>jobGroups.map(()=>0));
    const externalBySide=new Map();
    let externalNoCell=0,allPairs=0;
    for(const row of demand.pairs){
      if(!Array.isArray(row)||row.length<4)continue;
      const i=Number(row[0]),j=Number(row[1]),pax=Math.max(0,number(row[2])+number(row[3]));if(pax<=0)continue;
      allPairs+=pax;const fromId=seq[i],toId=seq[j],oi=originByZone.get(String(fromId));if(oi==null)continue;
      const di=destByZone.get(String(toId));if(di!=null){groupedFlows[oi][di]+=pax;continue;}
      const to=baseById.get(String(toId));
      if(to&&Array.isArray(to.cell)&&!inside(to.cell,box)){
        const side=sideOf(to.cell,box);if(!externalBySide.has(side))externalBySide.set(side,{total:0,byZone:new Map()});
        const item=externalBySide.get(side);item.total+=pax;item.byZone.set(String(toId),(item.byZone.get(String(toId))||0)+pax);
      } else if(!to){externalNoCell+=pax;}
    }
    let gateSide=null,gateTarget=null,gateTrips=0;
    for(const [side,x] of externalBySide)if(!gateSide||x.total>externalBySide.get(gateSide).total)gateSide=side;
    if(gateSide){
      const sideData=externalBySide.get(gateSide);gateTrips=sideData.total;
      const best=[...sideData.byZone].sort((a,b)=>b[1]-a[1])[0];if(best)gateTarget=baseById.get(best[0])||null;
    }
    if(externalNoCell>0)notes.push(`${Math.round(externalNoCell)} 人/小时的出框 OD 目标没有底板分区坐标，不能可靠定向到出口；未计入出口客流。`);
    const gate=gateSide?{side:gateSide,target:gateTarget,total:gateTrips}:null;
    const groupTrips=originGroups.map((_,oi)=>groupedFlows[oi].reduce((s,v)=>s+v,0));
    // Assign selected-direction external trips to origins zone by zone, rather than by population.
    if(gate){
      const gatePerOrigin=originGroups.map(()=>0);
      for(const row of demand.pairs){if(!Array.isArray(row)||row.length<4)continue;const oi=originByZone.get(String(seq[Number(row[0])]));if(oi==null)continue;const to=baseById.get(String(seq[Number(row[1])]));if(to&&Array.isArray(to.cell)&&!inside(to.cell,box)&&sideOf(to.cell,box)===gate.side)gatePerOrigin[oi]+=Math.max(0,number(row[2])+number(row[3]));}
      for(let i=0;i<groupTrips.length;i++)groupTrips[i]+=gatePerOrigin[i];
      gate.byOrigin=gatePerOrigin;
    }
    const rawTotal=groupTrips.reduce((s,v)=>s+v,0),scale=rawTotal>0?300/rawTotal:0;
    if(!originGroups.length||(!jobGroups.length&&!gate))problems.push({code:'box_empty',message:'片区没有可用的屋苑或去处。'});
    if(rawTotal<=0)problems.push({code:'nothing_to_solve',message:'屋苑到所选去处和出口的需求合计为 0。'});
    const origins=originGroups.map((g,i)=>({name:labelZone(g.rep),hans:g.rep.hans||g.rep.name||labelZone(g.rep),cell:rel(g.gameCell,box),house:safeHouse(rel(g.gameCell,box),box),people:Math.round(groupTrips[i]*scale),zoneIds:g.members.map(z=>String(z.id)),aliases:[...new Set(g.members.flatMap(z=>[z.name,z.hans,z.en].filter(Boolean)))],sourcePop:Math.round(g.total)}));
    const destinations=jobGroups.map((g,i)=>({name:labelZone(g.rep),hans:g.rep.hans||g.rep.name||labelZone(g.rep),kind:'jobs',cell:rel(g.gameCell||g.cell,box),house:safeHouse(rel(g.gameCell||g.cell,box),box),jobs:Math.round(g.total),attraction:16+g.total/15000,carExtra:Math.min(4,2+Math.max(0,Math.min(2,Math.round(number(g.rep.cbd)||0)))),zoneIds:g.members.map(z=>String(z.id)),aliases:[...new Set(g.members.flatMap(z=>[z.name,z.hans,z.en].filter(Boolean)))]}));
    if(gate){
      const insideCell=weightedCell(originGroups.map(g=>({cell:g.cell,pop:g.total})),g=>g.pop);
      const edge=accessCell(gateCell(gate.side,insideCell,box),gate.side),targetName=gate.target?titleForGate(gate.target,gate.side):({left:'往西面',right:'往东面',top:'往北面',bottom:'往南面'}[gate.side]);
      destinations.push({name:targetName,hans:Array.from(targetName,c=>SIMP[c]||c).join(''),kind:'gate',cell:rel(edge,box),house:safeHouse(rel(edge,box),box),jobsEquivalent:Math.round(gate.total),attraction:16+gate.total/15000,carExtra:2,sourceTarget:gate.target?String(gate.target.id):null});
    } else {
      problems.push({code:'nothing_to_solve',message:'没有可定位的出框 OD，无法从模型流量确定出口。'});
      notes.push('没有可定位的出框 OD，未生成虚构出口。');
    }
    const land=typeof base.land==='string'?base.land:(Array.isArray(base.land)?base.land.join(''):''),water=[];
    if(land){for(let y=0;y<box.h;y++)for(let x=0;x<box.w;x++){const ch=land[(box.r0+y)*number(base.cols)+(box.c0+x)];if(ch==='~'||ch==='w')water.push([x,y]);}}
    for(const c of base.water||[])if(Array.isArray(c)&&inside(c,box)){const p=rel(c,box);if(!water.some(w=>cellKey(w)===cellKey(p)))water.push(p);}
    const stationById=new Map((base.stations||[]).map(s=>[String(s.id),s]));
    const lines=[];
    for(const ln of base.lines||[]){
      const sourceCells=Array.isArray(ln.cells)?ln.cells:(Array.isArray(ln.via)?ln.via:[]);
      const clipped=sourceCells.map(c=>inside(c,box)?rel(c,box):null),pieces=linePieces(clipped);
      const stations=textForLine(ln,stationById).filter(s=>Array.isArray(s.cell)&&inside(s.cell,box));
      pieces.forEach((piece,n)=>{
        const onPiece=stations.filter(s=>piece.some(c=>cellKey(c)===cellKey(rel(s.cell,box))));if(onPiece.length<2)return;
        lines.push({name:pieces.length>1?`${ln.name}${n+1}`:ln.name,hans:pieces.length>1?`${ln.hans||ln.name}${n+1}`:(ln.hans||ln.name),color:ln.color||'#666666',via:piece,stations:onPiece.map(s=>rel(s.cell,box)),names:onPiece.map(s=>s.name||s.hans||String(s.id)),namesHans:onPiece.map(s=>s.hans||s.name||String(s.id)),trains:3});
      });
    }
    const roadById=new Map((base.roads||[]).map(r=>[String(r.id),r]));
    const demandVc=new Map((demand.sections||[]).map(x=>[String(x[0]),number(x[2])]));
    const rawSelected=[];
    for(const s of base.sections||[]){
      if(!Array.isArray(s.a)||!Array.isArray(s.b)||!inside(s.a,box)||!inside(s.b,box)||manhattan(s.a,s.b)!==1)continue;
      const road=roadById.get(String(s.road));if(!road)continue;
      rawSelected.push({road:String(s.road),name:road.name||road.hans||String(s.road),hans:road.hans||road.name||String(s.road),a:s.a.map(Number),b:s.b.map(Number),cap:Math.max(.1,number(s.cap)),vc:demandVc.get(String(s.id))??number((s.am||{}).vc),sectionId:String(s.id)});
    }
    const kept=roadPieces(rawSelected,box),roads=[],roadSections=[];
    // One path per connected road/capacity chain. Split at branches and capacity changes,
    // because the existing engine has one capacity for every edge of a road object.
    const buckets=new Map();
    for(const s of kept){
      const k=s.road+'|'+s.cap;
      if(!buckets.has(k))buckets.set(k,new Map());
      const edges=buckets.get(k),ek=undirectedKey(s.a,s.b),old=edges.get(ek);
      if(old){old.vc=Math.max(old.vc,s.vc);old.sectionIds.push(s.sectionId);}
      else edges.set(ek,{...s,sectionIds:[s.sectionId]});
    }
    for(const entries of buckets.values()){
      const edges=[...entries.values()],at=new Map(),used=new Set();
      edges.forEach((s,i)=>{for(const c of [s.a,s.b]){const k=cellKey(c);if(!at.has(k))at.set(k,[]);at.get(k).push(i);}});
      const trace=(start,first)=>{
        const via=[start.slice()],segments=[];let cell=start,idx=first;
        while(!used.has(idx)){
          used.add(idx);const s=edges[idx],next=cellKey(s.a)===cellKey(cell)?s.b:s.a;
          via.push(next.slice());segments.push({a:rel(cell,box),b:rel(next,box),modelVC:s.vc,sectionIds:s.sectionIds.slice()});
          cell=next;const adj=at.get(cellKey(cell));
          if(adj.length!==2)break;
          idx=adj.find(i=>!used.has(i));if(idx==null)break;
        }
        const s=edges[first];
        const road=roadById.get(s.road),english=String(road&&road.en||s.name).toUpperCase(),bilingual=ROAD_ALIASES[english]||[];
        roads.push({name:s.name,hans:road&&road.hans||s.hans,aliases:[road&&road.en,...bilingual].filter(Boolean),via:via.map(c=>rel(c,box)),cap:Math.max(.1,s.cap*scale)});
        roadSections.push({name:s.name,road:s.road,modelCap:s.cap,segments});
      };
      for(const [k,adj] of at)if(adj.length!==2)for(const i of adj)if(!used.has(i))trace(k.split(',').map(Number),i);
      for(let i=0;i<edges.length;i++)if(!used.has(i))trace(edges[i].a,i);
    }
    if(!roads.length)notes.push('该片区没有保留下来的道路段；机器人道路负荷验收不能成立。');
    const changeLog=[];
    function applyChange(ch,index){
      if(!ch||typeof ch!=='object'){problems.push({code:'invalid_request',message:'changes['+index+'] 必须是对象。'});return;}
      const what=String(ch.what||'');if(!['people','jobs','road_cap'].includes(what)){problems.push({code:'invalid_request',message:`changes[${index}].what 不支持：${what}`});return;}
      const pool=what==='people'?origins:(what==='jobs'?destinations.filter(d=>d.kind!=='gate'):roads);
      const match=matchPlace(ch.place,pool);
      if(!match||match.ambiguous||!match.item){problems.push({code:'place_not_found',message:`找不到可用于 ${what} 的地点“${ch.place||''}”。`});return;}
      if(what==='road_cap'&&match.score<.999){problems.push({code:'place_not_found',message:`道路“${ch.place||''}”必须精确匹配中文名或英文名。`});return;}
      if(match.score<0.999)problems.push({code:'place_not_found',message:`“${ch.place}”未精确匹配；已回退到同类最近名称“${match.item.name}”（匹配度 ${match.score.toFixed(2)}）。`});
      const minPct=what==='road_cap'?-60:-50,maxPct=what==='road_cap'?50:150;
      const pct=Number(ch.pct);if(!Number.isFinite(pct)||pct<minPct||pct>maxPct){problems.push({code:'invalid_request',message:`changes[${index}].pct 必须在 ${minPct} 到 +${maxPct} 之间。`});return;}
      const year=ch.by_year==null?0:Number(ch.by_year);if(!Number.isInteger(year)||year<0){problems.push({code:'invalid_request',message:`changes[${index}].by_year 必须为非负整数。`});return;}
      const obj=match.item,mult=1+pct/100,targets=what==='road_cap'?roads.filter(r=>norm(r.name)===norm(obj.name)):[obj];
      let field,oldValue,newValue;
      for(let j=0;j<targets.length;j++){
        const target=targets[j],offset=what==='jobs'?16:0;
        field=what==='people'?'people':what==='jobs'?'attraction':'cap';
        const previous=target.grow?target.grow.map(p=>p.slice()):[[0,number(target[field])]];
        const valueAt=t=>{
          if(t<=previous[0][0])return previous[0][1];
          for(let k=1;k<previous.length;k++)if(t<=previous[k][0]){
            const a=previous[k-1],b=previous[k],f=(t-a[0])/(b[0]-a[0]);
            return a[1]+(b[1]-a[1])*f;
          }
          return previous[previous.length-1][1];
        };
        const times=[...new Set([0,...previous.map(p=>p[0]),year])].sort((a,b)=>a-b);
        const curve=times.map(t=>{
          const factor=year===0?mult:1+(mult-1)*Math.min(1,t/year);
          let value=offset+(valueAt(t)-offset)*factor;
          if(what==='people')value=Math.round(value);
          return [t,value];
        });
        if(j===0){oldValue=previous[previous.length-1][1];newValue=curve[curve.length-1][1];}
        target[field]=curve[0][1];
        if(curve.length>1)target.grow=curve;else delete target.grow;
        if(what==='jobs')target.jobsTarget=Math.round((curve[curve.length-1][1]-16)*15000);
      }
      changeLog.push({place:String(ch.place||''),resolved:obj.name,what,pct,by_year:year,from:+number(oldValue).toFixed(3),to:+number(newValue).toFixed(3),fallback:match.score<0.999,affectedSegments:targets.length});
    }
    const requestedChanges=Array.isArray(request.changes)?request.changes:[];
    if(requestedChanges.length>4)problems.push({code:'invalid_request',message:'第一版 changes 最多 4 条。'});
    requestedChanges.slice(0,4).forEach(applyChange);
    const sourceRoadSections=roadSections.map((x,i)=>{const r=roads[i],denom=Math.max(.1,x.modelCap*scale);return {...x,capFactor:r.cap/denom,capGrowFactors:r.grow?r.grow.map(p=>[p[0],p[1]/denom]):null};});roads.forEach(r=>delete r.capChangeMultiplier);
    const level={title:request.title||area.name||area.hans||area.key,story:Array.isArray(request.story)?request.story.slice():[],cols:box.w,rows:box.h,origins,destinations,roads,lines,water,
      walkPer:3,wait:2,lineCost:1,stationCost:3,trainCost:4,perTrain:40,budget:30,phase2Budget:0,years:8,crowdBlocks:4,aware:{start:.2,spread:2},nearby:10,stay:40,learn:.3,tiers:[0,0,0],
      source:{area:area.key,period,box:box.source,scale,changes:changeLog,roadCapCoeff:1,roadSections:sourceRoadSections}};
    if(allPairs===0)notes.push('需求文件 pairs 没有正流量。');
    notes.push(`出行人数来自所选两个岗位团及${gate?'最大出框方向':'空出口'}的 car+pt；总量 ${rawTotal.toFixed(1)} 缩放到约 300，scale=${scale.toPrecision(6)}。`);
    notes.push('岗位团 attraction=16+岗位/15,000；出口用所选方向的出框 car+pt 人数代作岗位量，折算规则相同。');
    notes.push(period==='holiday'?'节假日去处使用底板 jobs 作为商业活动代理；输入没有单独休闲/景点字段，需后续补充。':`时段 ${period} 的去处按岗位团选择。`);
    notes.push('道路容量初值=模型 cap×scale，roadCapCoeff=1；check.js 会用模型 v/c 对照调一个全局系数并记录排名相关性。');
    if(!origins.length||!destinations.length)problems.push({code:'box_empty',message:'切片没有可玩的屋苑或去处。'});
    return {level,problems,notes};
  }

  const API={cut,makeBox,norm,matchPlace};
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
  root.LevelCutter=API;
})(typeof window!=='undefined'?window:globalThis);
