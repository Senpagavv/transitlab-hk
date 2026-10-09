(()=>{
  'use strict';
  // v4 level editor. Draw a board (roads, river, estates, the MTR station, the spots where a stop may go), set the
  // numbers of the round rules and the people per round, let the bots measure it, then test-play it in the game page.
  // The level is a plain object (same fields as a level in data.js; water as a list of cells). It is saved in this
  // browser on every change and can be exported to / imported from a .json file.
  const {D,P}=Tide,$=id=>document.getElementById(id),I=window.I18N,t=(k,v)=>I.t(k,v);
  const SAVE='tl-v4-editor',LEVEL='tl-v4-level',GW=72,GH=62,MX=60,MY=50;
  const HOUSE={left:[-50,0],right:[50,0],up:[0,-56],down:[0,56]};
  const k=c=>c.join(','),un=s=>s.split(',').map(Number);
  // the page that plays a level: the source pages or the bundled single files, side by side in one folder
  const here=decodeURIComponent(location.pathname.split('/').pop()||'');
  const GAME=here==='关卡编辑器.html'?'开始游戏.html':'index.html';
  $('edToGame').href=GAME;

  /* ------------------------------------------------------------------ the level */
  function blank(){return{v:4,title:'',cols:12,rows:8,roads:[],waterCells:[],hub:null,candidates:[],estates:[],
    rounds:8,hold:2,phases:[],firstWave:20,interval:120,release:110,headway:[40,4],seats:8,queue:8,cool:20,moves:4,
    patience:210,willing:[100,90,80,70,60,50,40],tiers:[0,0,0]};}
  // a built-in level as an editor level
  function fromLevel(L,title){
    const water=[];for(const [x1,y1,x2,y2] of L.water||[])for(let x=x1;x<=x2;x++)for(let y=y1;y<=y2;y++)water.push([x,y]);
    const hold=L.waves.length>1&&L.waves.every((w,i)=>k(w)===k(L.waves[i-i%2]))?2:1;
    const side=h=>h[0]<0?'left':h[0]>0?'right':h[1]<0?'up':'down';
    return{...blank(),title,cols:L.cols,rows:L.rows,roads:L.roads.map(c=>c.slice()),waterCells:water,hub:L.hub.slice(),
      candidates:L.candidates.map(c=>c.slice()),estates:L.estates.map(e=>({name:e.name,cell:e.cell.slice(),side:side(e.house||[0,40])})),
      rounds:L.waves.length,hold,phases:L.waves.filter((w,i)=>i%hold===0).map(w=>w.slice()),
      firstWave:L.firstWave??20,interval:L.interval??120,release:L.release??110,headway:L.headway.slice(),seats:L.seats??8,
      queue:L.queue??8,cool:L.cool??20,moves:L.moves??4,patience:L.patience??210,
      willing:(L.willing||[1,.9,.8,.7,.6,.5,.4]).map(w=>Math.round(w*100)),tiers:(L.tiers||[0,0,0]).slice()};}
  const waves=lv=>Array.from({length:lv.rounds},(_,r)=>(lv.phases[Math.floor(r/lv.hold)]||lv.phases.at(-1)||[]).slice(0,lv.estates.length));
  // what the game reads
  function toLevel(lv){
    return{v:4,title:lv.title,cols:lv.cols,rows:lv.rows,roads:lv.roads,waterCells:lv.waterCells,hub:lv.hub,candidates:lv.candidates,
      estates:lv.estates.map(e=>({name:e.name,hans:e.name,cell:e.cell,house:HOUSE[e.side]||HOUSE.down})),waves:waves(lv),
      firstWave:lv.firstWave,interval:lv.interval,release:Math.min(lv.release,lv.interval),headway:lv.headway,seats:lv.seats,queue:lv.queue,
      cool:lv.cool,moves:lv.moves,patience:lv.patience,willing:lv.willing.map(w=>w/100),tiers:lv.tiers,
      margin:[MX,MY],hubLabel:lv.hub&&lv.hub[0]>=lv.cols-3?'left':'right'};
  }
  let lv=load();
  function load(){try{const s=localStorage.getItem(SAVE);if(s)return{...blank(),...JSON.parse(s)};}catch(e){}return fromLevel(D.example('l2'),'');}
  function save(){try{localStorage.setItem(SAVE,JSON.stringify(lv));}catch(e){}}
  function changed(){fixPhases();save();analysis=null;render();}
  // the people table always has one row per phase and one column per estate
  function fixPhases(){
    const n=Math.max(1,Math.ceil(lv.rounds/lv.hold));
    while(lv.phases.length<n)lv.phases.push(lv.phases.length?lv.phases.at(-1).slice():[]);
    lv.phases.length=n;
    for(const ph of lv.phases){while(ph.length<lv.estates.length)ph.push(3);ph.length=lv.estates.length;}
  }

  /* ----------------------------------------------------------------- checking */
  const has=(list,c)=>list.some(x=>k(x)===k(c));
  function problems(){
    const out=[],roads=new Set(lv.roads.map(k));
    if(!lv.hub)out.push(t('ed.pNoHub'));else if(!roads.has(k(lv.hub)))out.push(t('ed.pHubOff'));
    if(!lv.estates.length)out.push(t('ed.pNoEstate'));
    if(lv.candidates.length<3)out.push(t('ed.pFewCand'));
    for(const e of lv.estates)if(!roads.has(k(e.cell)))out.push(t('ed.pEstateOff',{s:e.name}));
    if(lv.hub&&roads.has(k(lv.hub))){
      const d=reach(lv.hub);
      for(const e of lv.estates)if(roads.has(k(e.cell))&&!d.has(k(e.cell)))out.push(t('ed.pNoPath',{s:e.name}));
      for(const c of lv.candidates)if(!d.has(k(c))){out.push(t('ed.pCandCut'));break;}}
    if(!waves(lv).flat().some(n=>n>0))out.push(t('ed.pNoPeople'));
    return out;
  }
  // road blocks from a cell to every road cell (the game's own distance)
  function reach(from){
    const roads=new Set(lv.roads.map(k)),d=new Map([[k(from),0]]),q=[from];
    for(let i=0;i<q.length;i++){const c=q[i];for(const n of [[c[0]+1,c[1]],[c[0]-1,c[1]],[c[0],c[1]+1],[c[0],c[1]-1]])
      if(roads.has(k(n))&&!d.has(k(n))){d.set(k(n),d.get(k(c))+1);q.push(n);}}
    return d;
  }

  /* ------------------------------------------------------------------- drawing */
  let tool='road',hover=null,selEstate=-1;
  const xy=c=>[MX+c[0]*GW,MY+c[1]*GH];
  const svg=(tag,a,inner='')=>`<${tag} ${Object.entries(a).map(([x,v])=>`${x}="${v}"`).join(' ')}>${inner}</${tag}>`;
  const tok=n=>getComputedStyle(document.documentElement).getPropertyValue('--s-'+n).trim();
  function drawBoard(){
    const W=MX*2+(lv.cols-1)*GW,H=MY*2+(lv.rows-1)*GH,C={road:tok('road'),edge:tok('road-edge'),ink:tok('ink'),ink2:tok('ink2'),ink3:tok('ink3'),
      paper:tok('paper'),panel:tok('panel'),accent:tok('accent'),info:tok('info'),warn:tok('warn'),line:tok('line2')};
    $('edBoard').setAttribute('viewBox',`0 0 ${W} ${H}`);
    let out='';
    for(let x=0;x<lv.cols;x++)for(let y=0;y<lv.rows;y++){const [px,py]=xy([x,y]);out+=svg('circle',{cx:px,cy:py,r:2.2,fill:C.line});}
    for(const c of lv.waterCells){const [x,y]=xy(c);out+=svg('rect',{x:x-GW/2,y:y-GH/2,width:GW,height:GH,fill:C.info,'fill-opacity':.18});}
    const roads=new Set(lv.roads.map(k));
    for(const [col,w] of [[C.edge,24],[C.road,20]])for(const c of lv.roads){
      const [x,y]=xy(c);out+=svg('rect',{x:x-w/2,y:y-w/2,width:w,height:w,fill:col});
      for(const n of [[c[0]+1,c[1]],[c[0],c[1]+1]])if(roads.has(k(n))){const [x2,y2]=xy(n);out+=svg('path',{d:`M${x} ${y}L${x2} ${y2}`,stroke:col,'stroke-width':w});}}
    for(const c of lv.waterCells)if(roads.has(k(c))){const [x,y]=xy(c),v=roads.has(k([c[0],c[1]-1]))||roads.has(k([c[0],c[1]+1]));
      for(const d of [-14,14])out+=v?svg('path',{d:`M${x+d} ${y-24}L${x+d} ${y+24}`,stroke:C.ink2,'stroke-width':2.2}):svg('path',{d:`M${x-30} ${y+d}L${x+30} ${y+d}`,stroke:C.ink2,'stroke-width':2.2});}
    for(const c of lv.candidates){const [x,y]=xy(c);out+=svg('circle',{cx:x,cy:y,r:11,fill:C.panel,stroke:C.ink3,'stroke-width':1.3})+svg('text',{x,y:y+5,'font-size':15,fill:C.ink3,'text-anchor':'middle'},'＋');}
    lv.estates.forEach((e,i)=>{const [x,y]=xy(e.cell),[dx,dy]=HOUSE[e.side]||HOUSE.down,hx=x+dx,hy=y+dy;
      out+=svg('path',{d:`M${x} ${y}L${hx} ${hy}`,stroke:C.ink3,'stroke-width':1.5,'stroke-dasharray':'2 3'});
      out+=svg('rect',{x:hx-17,y:hy-10,width:12,height:22,fill:C.ink2})+svg('rect',{x:hx-4,y:hy-16,width:10,height:28,fill:C.ink})+svg('rect',{x:hx+7,y:hy-6,width:10,height:18,fill:C.ink2});
      const lx=dx>0?hx+24:dx<0?hx-24:hx,ly=dx?hy+5:dy<0?hy-22:hy+28;
      out+=svg('text',{x:lx,y:ly,'font-size':14,'font-weight':600,fill:i===selEstate?C.accent:C.ink,stroke:C.panel,'stroke-width':3.5,'paint-order':'stroke','text-anchor':dx>0?'start':dx<0?'end':'middle'},esc(e.name));});
    if(lv.hub){const [x,y]=xy(lv.hub);out+=svg('rect',{x:x-23,y:y-22,width:46,height:44,rx:3,fill:C.ink})+svg('rect',{x:x-23,y:y+15,width:46,height:7,fill:C.accent})+
      svg('text',{x,y:y+8,'font-size':25,fill:C.paper,'text-anchor':'middle','font-family':'Bodoni Moda,Georgia,serif','font-weight':600},'M');}
    if(hover){const [x,y]=xy(hover);out+=svg('rect',{x:x-GW/2+3,y:y-GH/2+3,width:GW-6,height:GH-6,rx:6,fill:'none',stroke:C.accent,'stroke-width':2,'stroke-dasharray':'4 3'});}
    $('edBoard').innerHTML=out;
  }
  const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
  // what a cell means to each estate: blocks, the share that would come, or why nobody would
  function cellInfo(c){
    if(!c)return t('ed.hoverNone');
    const roads=new Set(lv.roads.map(k));if(!roads.has(k(c)))return t('ed.hoverOff',{x:c[0]+1,y:c[1]+1});
    const parts=[];const toHub=lv.hub?reach(lv.hub):null;
    if(toHub&&toHub.has(k(c)))parts.push(t('ed.hoverMTR',{n:toHub.get(k(c)),hw:lv.headway[0]+lv.headway[1]*toHub.get(k(c))}));
    for(const e of lv.estates){const d=reach(e.cell).get(k(c));if(d===undefined)continue;
      const mtr=toHub&&toHub.get(k(e.cell)),w=d<lv.willing.length?lv.willing[d]:0;
      parts.push(`${e.name} ${d}${t('ed.blocks')} ${mtr!==undefined&&d>=mtr?t('ed.whyMTR'):w?w+'%':t('ed.whyFar')}`);}
    return parts.join(' · ');
  }

  /* -------------------------------------------------------------- side panels */
  function num(id,v){const el=$(id);if(document.activeElement!==el)el.value=v;}
  function render(){
    document.title=t('doc.editor');
    drawBoard();
    num('edTitle',lv.title);$('edTitle').placeholder=t('ed.titlePh');num('edCols',lv.cols);num('edRows',lv.rows);
    document.querySelectorAll('#edTools [data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===tool)));
    $('edToolHint').textContent=t('ed.t.'+tool);
    $('edCell').textContent=cellInfo(hover);
    // estates
    const mtr=lv.hub?reach(lv.hub):new Map();
    $('edEstates').innerHTML=lv.estates.length?lv.estates.map((e,i)=>`<div class="ed-est ${i===selEstate?'sel':''}" data-i="${i}">
      <input class="ed-in" data-f="name" value="${esc(e.name)}" maxlength="8" aria-label="${t('ed.estName')}">
      <select data-f="side" aria-label="${t('ed.estSide')}">${Object.keys(HOUSE).map(s=>`<option value="${s}" ${s===e.side?'selected':''}>${t('ed.side.'+s)}</option>`).join('')}</select>
      <span class="mono">${mtr.has(k(e.cell))?t('ed.toMTR',{n:mtr.get(k(e.cell))}):'—'}</span>
      <button class="btn btn-sm" data-f="del" title="${t('ed.del')}">×</button></div>`).join(''):`<p class="note">${t('ed.noEstates')}</p>`;
    // rhythm and rules
    for(const [id,v] of [['edRounds',lv.rounds],['edHold',lv.hold],['edInterval',lv.interval],['edRelease',lv.release],['edHwBase',lv.headway[0]],
      ['edHwStep',lv.headway[1]],['edSeats',lv.seats],['edQueue',lv.queue],['edCool',lv.cool],['edMoves',lv.moves],['edPatience',lv.patience],
      ['edPass',lv.tiers[0]],['edHigh',lv.tiers[1]],['edMaster',lv.tiers[2]]])num(id,v);
    $('edWilling').innerHTML=lv.willing.map((w,d)=>`<label><small>${d}${t('ed.blocks')}</small><input class="ed-in mono" type="number" min="0" max="100" step="10" data-w="${d}" value="${w}"></label>`).join('');
    // the people table
    const W=waves(lv),total=W.flat().reduce((a,b)=>a+b,0);
    $('edPeople').innerHTML=`<thead><tr><th>${t('ed.phase')}</th>${lv.estates.map(e=>`<th>${esc(e.name)}</th>`).join('')}<th>${t('ed.sum')}</th></tr></thead><tbody>`+
      lv.phases.map((ph,r)=>`<tr><td class="mono">${t('ed.rounds',{a:r*lv.hold+1,b:Math.min(lv.rounds,(r+1)*lv.hold)})}</td>${ph.map((n,o)=>`<td><input class="ed-in mono" type="number" min="0" max="60" data-p="${r},${o}" value="${n}"></td>`).join('')}<td class="mono">${ph.reduce((a,b)=>a+b,0)}</td></tr>`).join('')+'</tbody>';
    $('edTotal').textContent=t('ed.total',{n:total,r:lv.rounds});
    const pr=problems();$('edProblems').innerHTML=pr.length?pr.map(s=>`<li>${esc(s)}</li>`).join(''):`<li class="ok">${t('ed.pNone')}</li>`;
    $('edPlay').disabled=pr.length>0;$('edAnalyse').disabled=pr.length>0||busy;
    renderAnalysis();
  }

  /* ------------------------------------------------------------------- editing */
  const board=$('edBoard');
  function cellAt(e){const p=board.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const q=p.matrixTransform(board.getScreenCTM().inverse());
    const c=[Math.round((q.x-MX)/GW),Math.round((q.y-MY)/GH)];return c[0]>=0&&c[1]>=0&&c[0]<lv.cols&&c[1]<lv.rows?c:null;}
  const del=(list,c)=>{const i=list.findIndex(x=>k(x)===k(c));if(i>=0)list.splice(i,1);return i>=0;};
  let paint=null,last=null;
  // a straight run of cells between two cells (row first, then column), so a fast drag leaves no gaps
  function run(a,b){const out=[];let [x,y]=a;out.push([x,y]);while(x!==b[0]){x+=Math.sign(b[0]-x);out.push([x,y]);}while(y!==b[1]){y+=Math.sign(b[1]-y);out.push([x,y]);}return out;}
  function apply(c,first){
    // roads and water only ever add (a new road may start on an old one); the eraser removes, also by dragging
    if(tool==='road'||tool==='water'){const list=tool==='road'?lv.roads:lv.waterCells;paint='on';
      for(const d of last?run(last,c):[c])if(!has(list,d))list.push(d);
      last=c;return;}
    if(tool==='erase'&&!first){for(const d of last?run(last,c):[c]){del(lv.candidates,d);if(!del(lv.roads,d))del(lv.waterCells,d);}last=c;return;}
    if(tool==='erase')paint='erase';
    if(!first)return;
    const onRoad=has(lv.roads,c);
    if(tool==='estate'){const i=lv.estates.findIndex(e=>k(e.cell)===k(c));
      if(i>=0){selEstate=i;return;}
      if(!onRoad){flash(t('ed.needRoad'));return;}
      lv.estates.push({name:t('ed.estDefault',{n:lv.estates.length+1}),cell:c,side:c[1]===0?'down':'up'});selEstate=lv.estates.length-1;}
    else if(tool==='hub'){if(!onRoad){flash(t('ed.needRoad'));return;}lv.hub=c;del(lv.candidates,c);}
    else if(tool==='cand'){if(!onRoad){flash(t('ed.needRoad'));return;}if(lv.hub&&k(lv.hub)===k(c))return;if(!del(lv.candidates,c))lv.candidates.push(c);}
    else if(tool==='erase'){const i=lv.estates.findIndex(e=>k(e.cell)===k(c));
      if(i>=0){lv.estates.splice(i,1);for(const ph of lv.phases)ph.splice(i,1);selEstate=-1;}
      else if(del(lv.candidates,c)){}else if(lv.hub&&k(lv.hub)===k(c))lv.hub=null;else if(!del(lv.roads,c))del(lv.waterCells,c);}
  }
  board.addEventListener('pointerdown',e=>{const c=cellAt(e);if(!c)return;board.setPointerCapture(e.pointerId);last=null;apply(c,true);last=c;changed();});
  board.addEventListener('pointermove',e=>{const c=cellAt(e);const moved=k(c||[-1,-1])!==k(hover||[-1,-1]);hover=c;
    if(paint&&c&&e.buttons){apply(c,false);changed();}else if(moved){drawBoard();$('edCell').textContent=cellInfo(hover);}});
  const stop=()=>{paint=null;last=null;};
  board.addEventListener('pointerup',stop);board.addEventListener('pointercancel',stop);
  board.addEventListener('pointerleave',()=>{hover=null;drawBoard();$('edCell').textContent=cellInfo(null);});
  $('edTools').onclick=e=>{const b=e.target.closest('[data-tool]');if(b){tool=b.dataset.tool;render();}};
  document.addEventListener('keydown',e=>{if(e.target.closest('input,select,textarea'))return;const i='123456'.indexOf(e.key);
    if(i>=0){tool=['road','water','estate','hub','cand','erase'][i];render();}});
  // inputs
  const clampN=(v,a,b,d)=>{v=Math.round(+v);return Number.isFinite(v)?Math.max(a,Math.min(b,v)):d;};
  const NUM={edCols:['cols',4,20],edRows:['rows',4,16],edRounds:['rounds',1,16],edHold:['hold',1,8],edInterval:['interval',30,300],edRelease:['release',5,300],
    edSeats:['seats',1,20],edQueue:['queue',0,20],edCool:['cool',0,120],edMoves:['moves',0,12],edPatience:['patience',60,900],
    edHwBase:['hw0',10,300],edHwStep:['hw1',0,60],edPass:['t0',0,999],edHigh:['t1',0,999],edMaster:['t2',0,999]};
  document.querySelectorAll('.ed-num').forEach(el=>el.addEventListener('change',()=>{const [f,a,b]=NUM[el.id];const v=clampN(el.value,a,b,a);
    if(f==='hw0')lv.headway[0]=v;else if(f==='hw1')lv.headway[1]=v;else if(f[0]==='t'&&f.length===2)lv.tiers[+f[1]]=v;else lv[f]=v;
    if(f==='cols'||f==='rows')trim();changed();}));
  function trim(){const ok=c=>c[0]<lv.cols&&c[1]<lv.rows;
    lv.roads=lv.roads.filter(ok);lv.waterCells=lv.waterCells.filter(ok);lv.candidates=lv.candidates.filter(ok);if(lv.hub&&!ok(lv.hub))lv.hub=null;
    for(let i=lv.estates.length-1;i>=0;i--)if(!ok(lv.estates[i].cell)){lv.estates.splice(i,1);for(const ph of lv.phases)ph.splice(i,1);}}
  $('edTitle').addEventListener('input',()=>{lv.title=$('edTitle').value.slice(0,24);save();});
  $('edWilling').addEventListener('change',e=>{const d=e.target.dataset.w;if(d===undefined)return;lv.willing[+d]=clampN(e.target.value,0,100,0);changed();});
  $('edPeople').addEventListener('change',e=>{const p=e.target.dataset.p;if(!p)return;const [r,o]=p.split(',').map(Number);lv.phases[r][o]=clampN(e.target.value,0,60,0);changed();});
  $('edEstates').addEventListener('change',e=>{const row=e.target.closest('[data-i]');if(!row)return;const est=lv.estates[+row.dataset.i];
    if(e.target.dataset.f==='name')est.name=e.target.value.trim().slice(0,8)||est.name;if(e.target.dataset.f==='side')est.side=e.target.value;changed();});
  $('edEstates').addEventListener('click',e=>{const b=e.target.closest('[data-f="del"]');if(!b)return;const i=+b.closest('[data-i]').dataset.i;
    lv.estates.splice(i,1);for(const ph of lv.phases)ph.splice(i,1);selEstate=-1;changed();});
  function flash(s){$('edNote').textContent=s;}

  /* ----------------------------------------------------------- bots, in the page */
  // The same checks as bots/v4_calibrate.js, smaller: every opening without moving, then from the best three openings a
  // player who moves one stop at most in each countdown (3 s before a round). Runs in slices so the page stays usable.
  let analysis=null,busy=false;
  const tick=()=>new Promise(r=>setTimeout(r,0));
  function playLevel(open,moves=[]){const g=new Tide.Game();open.forEach((c,id)=>g.place(id,D.candidates[c]));g.start();
    for(const m of moves){g.advance(m.time-g.t);g.place(m.id,D.candidates[m.to]);}g.advance(P.duration-g.t+1);return g.delivered;}
  async function analyse(){
    if(busy||problems().length)return;busy=true;analysis={progress:0};render();
    D.loadEditor(toLevel(lv));Tide.reset();
    const n=D.candidates.length,opens=[];for(let a=0;a<n;a++)for(let b=a+1;b<n;b++)for(let c=b+1;c<n;c++)opens.push([a,b,c]);
    const total=D.waves.flat().reduce((x,y)=>x+y,0),start=P.firstWave,rounds=D.waves.length;
    const plannerWork=3*(rounds-1)*3*n,work=opens.length+plannerWork;let done=0;
    const statics=[];
    for(let i=0;i<opens.length;i++){statics.push({o:opens[i],s:playLevel(opens[i])});done++;if(i%6===5){analysis.progress=done/work;renderAnalysis();await tick();}}
    statics.sort((a,b)=>b.s-a.s);
    let best={score:statics[0].s,moves:[],open:statics[0].o};
    for(const x of statics.slice(0,3)){
      const moves=[],cells=x.o.slice();let score=x.s;
      for(let r=1;r<rounds;r++){const time=start+r*P.interval-3;let pick=null;
        if(moves.length<P.moves)for(let id=0;id<3;id++)for(let to=0;to<n;to++){if(cells.includes(to))continue;
          const s=playLevel(x.o,[...moves,{time,id,to}]);if(s>score&&(!pick||s>pick.s))pick={s,m:{time,id,to}};}
        done+=3*n;analysis.progress=Math.min(1,done/work);renderAnalysis();await tick();
        if(pick){moves.push(pick.m);cells[pick.m.id]=pick.m.to;score=pick.s;}}
      if(score>best.score)best={score,moves,open:x.o};}
    const S=statics[0].s,B=best.score,sc=statics.map(x=>x.s);
    // the same moves 40 s early (still in the previous round): if that is not worse, timing does not matter
    const early=best.moves.length?playLevel(best.open,best.moves.map(m=>({...m,time:Math.max(1,m.time-40)}))):null;
    const pass=sc[Math.min(4,sc.length-1)],high=Math.max(S+1,S+Math.round((B-S)/2)),master=B-S>=3?B-1:B;
    analysis={total,openings:sc.length,staticBest:S,early,median:sc[Math.floor(sc.length/2)],passCount:sc.filter(s=>s>=pass).length,
      planBest:B,plan:best,tiers:[pass,Math.min(high,master),master],
      bestOpen:best.open.map(i=>k(D.candidates[i])),moves:best.moves.map(m=>({r:Math.round((m.time+3-start)/P.interval)+1,stop:'ABC'[m.id],to:k(D.candidates[m.to])}))};
    busy=false;render();
  }
  function renderAnalysis(){
    const el=$('edAnalysis');
    if(!analysis){el.innerHTML=`<p class="note">${t('ed.aIdle')}</p>`;return;}
    if(analysis.progress!==undefined){el.innerHTML=`<p class="note">${t('ed.aBusy',{p:Math.round(100*analysis.progress)})}</p><div class="gauge"><i style="width:${100*analysis.progress}%"></i></div>`;return;}
    const a=analysis,warn=[];
    if(a.planBest-a.staticBest<3)warn.push(t('ed.wMoves'));
    if(a.staticBest/a.total>.93)warn.push(t('ed.wEasy'));
    if(a.planBest/a.total<.6)warn.push(t('ed.wHard'));
    if(a.early!==null&&a.early>=a.planBest)warn.push(t('ed.wEarly'));
    el.innerHTML=`<div class="r"><span>${t('ed.aStatic')}</span><b class="mono">${a.staticBest} / ${a.total}</b></div>
      <div class="r"><span>${t('ed.aMedian')}</span><b class="mono">${a.median}</b></div>
      <div class="r"><span>${t('ed.aPlan')}</span><b class="mono">${a.planBest}</b></div>
      <p class="note">${t('ed.aPlanHow',{o:a.bestOpen.join(' · '),m:a.moves.length?a.moves.map(m=>t('ed.aMove',m)).join('；'):t('ed.aNoMove')})}</p>
      ${a.early!==null?`<div class="r"><span>${t('ed.aEarly')}</span><b class="mono">${a.early}</b></div>`:''}
      <div class="r"><span>${t('ed.aTiers')}</span><b class="mono">${a.tiers.join(' / ')}</b></div>
      <p class="note">${t('ed.aPass',{n:a.passCount,of:a.openings})}</p>
      ${warn.map(w=>`<p class="note ed-warn">${w}</p>`).join('')}
      <button class="btn btn-sm" id="edUseTiers">${t('ed.useTiers')}</button>`;
    $('edUseTiers').onclick=()=>{lv.tiers=a.tiers.slice();const keep=analysis;changed();analysis=keep;renderAnalysis();};
  }
  $('edAnalyse').onclick=analyse;

  /* ------------------------------------------------------------ play and files */
  $('edPlay').onclick=()=>{
    const level=toLevel(lv);if(!level.tiers.some(x=>x>0)&&analysis&&analysis.tiers)level.tiers=analysis.tiers;
    try{localStorage.setItem(LEVEL,JSON.stringify(level));}catch(e){}
    const code=encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(level)))));
    window.open(`${encodeURIComponent(GAME)}#map=custom&lv=${code}`,'_blank');};
  $('edExport').onclick=()=>{const blob=new Blob([JSON.stringify({level:toLevel(lv),editor:lv},null,1)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`TransitLab-level-${(lv.title||'draft').replace(/[^\w一-鿿-]+/g,'_')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  $('edImport').onclick=()=>$('edFile').click();
  $('edFile').onchange=async()=>{const f=$('edFile').files[0];if(!f)return;
    try{const j=JSON.parse(await f.text());lv=j.editor?{...blank(),...j.editor}:fromLevel(j.level||j,j.title||'');selEstate=-1;changed();flash(t('ed.imported',{s:f.name}));}
    catch(e){flash(t('ed.badFile'));}$('edFile').value='';};
  $('edExample').onchange=e=>{const v=e.target.value;e.target.value='';if(!v)return;
    if(v==='blank')lv=blank();else lv=fromLevel(D.example(v),t('site.'+v));selEstate=-1;changed();};
  window.addEventListener('tl:lang',render);
  function setTheme(th){document.documentElement.setAttribute('data-theme',th);$('thPaper').setAttribute('aria-pressed',String(th==='light'));$('thInk').setAttribute('aria-pressed',String(th==='dark'));
    try{localStorage.setItem('tl-theme',th);}catch(e){}render();}
  $('thPaper').onclick=()=>setTheme('light');$('thInk').onclick=()=>setTheme('dark');
  try{const th=localStorage.getItem('tl-theme');if(th)document.documentElement.setAttribute('data-theme',th);}catch(e){}
  window.TL_EDITOR={get level(){return lv;},toLevel:()=>toLevel(lv),analyse,get analysis(){return analysis;}};
  fixPhases();render();
})();
