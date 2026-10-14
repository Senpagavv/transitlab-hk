/* Task 55: presentation and scenario inputs. The simulation engine is unchanged. */
(function(root){
  'use strict';
  const I=root.I18N,$=id=>document.getElementById(id),L=I.L;
  I.add({
    'v.select':L('選分區','选分区','Select zone'),
    'v.zoomDistrict':L('全港 · 18 區','全港 · 18 区','Hong Kong · 18 districts'),
    'v.zoomPlace':L('片區 · 港鐵與地方','片区 · 港铁与地方','Area · stations & places'),
    'v.zoomStreet':L('街區 · 屋苑與路名','街区 · 屋苑与路名','Neighbourhood · estates & roads'),
    'v.placeCard':L('{name} · {district}\n居民 {pop} 人 · 岗位 {jobs} 個\n早上開車 {share} 成（私家車 / 私家車＋公交）','{name} · {district}\n居民 {pop} 人 · 岗位 {jobs} 个\n早上开车 {share} 成（私家车 / 私家车＋公交）','{name} · {district}\n{pop} residents · {jobs} jobs\nAM car share: {pct}% (car / car + transit)'),
    'v.areasHint':L('點片區，一步到達','点片区，一步到达','Choose an area to zoom in'),
    'v.selectHint':L('點一格選分區 · Shift 加選','点一格选分区 · Shift 加选','Click a cell to select · Shift adds zones'),
    'v.playHelp':L('玩法','玩法','How to play'),
    'v.introTitle':L('讓香港少一點塞車','让香港少一点塞车','Make Hong Kong move'),
    'v.step1':L('選一個地方：點右邊片區，或選左邊的題目。','选一个地方：点右边片区，或选左边的题目。','Choose a place: pick an area or a challenge.'),
    'v.step2':L('畫線、放站：拖動畫線，再按「車站」在線上點站；列車先送你一列。','画线、放站：拖动画线，再按“车站”在线上点站；列车先送你一列。','Draw a line, then choose Stations and click the line to add stops. Your first train is included.'),
    'v.step3':L('按「跑到穩定」：看成績單，切「變化」找哪條路少了車。','按“跑到稳定”：看成绩单，切“变化”找哪条路少了车。','Run to stable: read your report, then use Changes to see which roads carry fewer cars.'),
    'v.start':L('開始試一條線','开始试一条线','Try a line'),
    'v.challenges':L('選一道題，或自由玩','选一道题，或自由玩','Pick a challenge or explore'),
    'v.free':L('自由玩 · 看全港問題旗','自由玩 · 看全港问题旗','Free play · show problem flags'),
    'v.goalPending':L('先畫線、放至少兩站，再跑。','先画线、放至少两站，再跑。','Draw a line, add at least two stations, then run.'),
    'v.goalProgress':L('這次 {value} / {target} · 還差 {remaining}','这次 {value} / {target} · 还差 {remaining}','This run: {value} / {target} · {remaining} to go'),
    'v.goalPassed':L('✓ 這次達標：{value} / {target}','✓ 这次达标：{value} / {target}','✓ Goal met this run: {value} / {target}'),
    'v.best':L('本機最高 {n}','本机最高 {n}','Personal best {n}'),
    'v.flagRoad':L('{name}：每小時 {load} 輛，負荷 / 容量 {vc}；試著讓沿路的人改坐地鐵。','{name}：每小时 {load} 辆，负荷 / 容量 {vc}；试着让沿路的人改坐地铁。','{name}: {load} vehicles/hour; load/capacity {vc}. Give people along this road a rail alternative.'),
    'v.flagZone':L('{name}：住 {pop} 人，最近港鐵站直線約 {km} 公里；試接一條線。','{name}：住 {pop} 人，最近港铁站直线约 {km} 公里；试接一条线。','{name}: {pop} residents, about {km} km in a straight line to the nearest MTR station. Try a new connection.'),
    'v.report':L('這條新線，改變了什麼？','这条新线，改变了什么？','What changed with your line?'),
    'v.reportOpen':L('看成績單','看成绩单','View report'),
    'v.details':L('詳細 · 逐輪結果','详细 · 逐轮结果','Details · round history'),
    'v.ridersSentence':L('新線每小時 {n} 人坐。','新线每小时 {n} 人坐。','Your new line carries {n} people per hour.'),
    'v.roadLess':L('{name}這一段，每小時少了 {n} 輛車。','{name}这一段，每小时少了 {n} 辆车。','This section of {name} carries {n} fewer vehicles per hour.'),
    'v.roadMore':L('{name}這一段，每小時多了 {n} 輛車。','{name}这一段，每小时多了 {n} 辆车。','This section of {name} carries {n} more vehicles per hour.'),
    'v.shareSentence':L('{name}開車比例從 {a} 成變成 {b} 成。','{name}开车比例从 {a} 成变成 {b} 成。','The car share in {name} changes from {a}% to {b}%.'),
    'v.jamLess':L('全港塞車指標減少 {n}。','全港塞车指标减少 {n}。','The Hong Kong congestion index falls by {n}.'),
    'v.jamMore':L('全港塞車指標增加 {n}。','全港塞车指标增加 {n}。','The Hong Kong congestion index rises by {n}.'),
    'v.reportNote':L('本時段的模型結果，只作學習參考。開車比例口徑：私家車 /（私家車＋公交）。塞車指標是引擎的 Σ 負荷 × 額外耗時，並非實測排隊分鐘。','本时段的模型结果，只作学习参考。开车比例口径：私家车 /（私家车＋公交）。塞车指标是引擎的 Σ 负荷 × 额外耗时，并非实测排队分钟。','Model results for the selected time period, for learning. Car share = car / (car + transit). The congestion index is the engine’s sum of load × extra time, not observed queue minutes.'),
    'v.continue':L('回地圖繼續改','回地图继续改','Back to the map'),
    'v.change':L('變化','变化','Changes'),
    'v.before':L('之前','之前','Before'),
    'v.after':L('之後','之后','After'),
    'v.changeKey':L('綠：少車 / 少開車　紅：多車 / 多開車','绿：少车 / 少开车　红：多车 / 多开车','Green: less traffic / driving · Red: more'),
    'v.changeEmpty':L('先跑方案，再看變化','先跑方案，再看变化','Run a plan to see changes'),
    'v.noResult':L('跑完後，這裡說清楚誰改坐車、哪裡少塞車。','跑完后，这里说清楚谁改坐车、哪里少塞车。','Run your plan to see who switched to rail and where traffic eased.'),
    'v.stableOnly':L('目標以跑到穩定的結果判定。','目标以跑到稳定的结果判定。','Goals are checked when the run is stable.'),
    'v.population':L('分區的人與吸引力','分区的人与吸引力','People & attraction'),
    'v.noSelection':L('在地圖點一格選分區；Shift 點擊可加選。','在地图点一格选分区；Shift 点击可加选。','Click a map cell to select a zone; Shift-click adds zones.'),
    'v.selected':L('選中 {n} 個分區','选中 {n} 个分区','{n} zones selected'),
    'v.people':L('整體人數','整体人数','All people'),
    'v.child':L('小孩 · 上學 HBS','小孩 · 上学 HBS','Children · school (HBS)'),
    'v.adult':L('成人 · 上班 HBW','成人 · 上班 HBW','Adults · work (HBW)'),
    'v.elder':L('老人 · 其他 HBO','老人 · 其他 HBO','Older people · other (HBO)'),
    'v.attraction':L('吸引力 · 到達出行','吸引力 · 到达出行','Attraction · arriving trips'),
    'v.resetZone':L('還原選中分區','还原选中分区','Reset selected zones'),
    'v.resetAllZones':L('還原全部調整','还原全部调整','Reset all adjustments'),
    'v.scenarioNote':L('D 假設：年齡滑杆以出行目的代替：小孩→HBS、成人→HBW、老人→HBO；不是實測年齡出行。比例讀自 trip-ends-2026。吸引力只重分目的地，每個出發分區的總出行不變。','D 假设：年龄滑杆以出行目的代替：小孩→HBS、成人→HBW、老人→HBO；不是实测年龄出行。比例读自 trip-ends-2026。吸引力只重分目的地，每个出发分区的总出行不变。','D assumption: age sliders proxy trip purpose—children→HBS, adults→HBW, older people→HBO; these are not measured age-specific trips. Weights come from trip-ends-2026. Attraction redistributes destinations while preserving every origin’s total trips.'),
    'v.departures':L('選中分區本時段出發：{a} → {b} 人次','选中分区本时段出发：{a} → {b} 人次','Selected-zone departures this period: {a} → {b} trips'),
    'v.purposeSchool':L('上學出行權重：{a} → {b}','上学出行权重：{a} → {b}','School production weight: {a} → {b}'),
    'v.scenarioLoading':L('正在讀取出行目的比例…','正在读取出行目的比例…','Loading trip-purpose weights…'),
    'v.scenarioError':L('出行比例未能讀取，暫不能調整人數。','出行比例未能读取，暂不能调整人数。','Trip-purpose weights could not be loaded; population controls are unavailable.'),
    'v.zonesEdited':L('已調整 {n} 個分區 · 跑後看變化','已调整 {n} 个分区 · 跑后看变化','{n} zones adjusted · run to see the effect'),
    'v.data':L('香港數據','香港数据','Hong Kong data'),
    'v.areasTab':L('片區','片区','Areas'),
    'v.inspectHint':L('選要查的對象，再點地圖。數字為原始模型底板。','选要查的对象，再点地图。数字为原始模型底板。','Choose an object type, then click the map. Values describe the original model baseline.'),
    'v.zoneType':L('分區','分区','Zone'),
    'v.roadType':L('道路','道路','Road'),
    'v.stationType':L('港鐵站','港铁站','MTR station'),
    'v.inspectMap':L('在地圖選取','在地图选取','Select on map'),
    'v.popData':L('居民人口','居民人口','Residents'),
    'v.jobsData':L('崗位','岗位','Jobs'),
    'v.shareData':L('本時段開車比例','本时段开车比例','Car share this period'),
    'v.loadData':L('本時段車流（輛 / 小時）','本时段车流（辆 / 小时）','Traffic this period (vehicles/hour)'),
    'v.capacityData':L('通行能力（輛 / 小時）','通行能力（辆 / 小时）','Capacity (vehicles/hour)'),
    'v.vcData':L('負荷 / 容量','负荷 / 容量','Load / capacity'),
    'v.stationFlow':L('相連區間最多人次 / 小時','相连区间最多人次 / 小时','Busiest adjacent section (people/hour)'),
    'v.frequency':L('所在線路班次 / 小時','所在线路班次 / 小时','Line frequency (trains/hour)'),
    'v.tierA':L('A 官方統計','A 官方统计','A Official statistics'),
    'v.tierB':L('B 模型標定','B 模型标定','B Calibrated model'),
    'v.tierC':L('C 推算','C 推算','C Estimate'),
    'v.tierD':L('D 假設','D 假设','D Assumption'),
    'v.tiersNote':L('A 官方統計；B 模型標定；C 推算；D 假設。C／D 只作學習參考；這份底板沒有 A 級直接觀測值。','A 官方统计；B 模型标定；C 推算；D 假设。C／D 只作学习参考；这份底板没有 A 级直接观测值。','A official statistics; B calibrated model; C estimate; D assumption. C/D are for learning. This baseline contains no direct tier-A observations.'),
    'v.noObject':L('還未選中對象。','还未选中对象。','No object selected yet.'),
    'v.noNearby':L('這裡沒有該類對象，請放大後再點。','这里没有该类对象，请放大后再点。','No object of this type here. Zoom in and try again.'),
    'v.notAvailable':L('未提供','未提供','Not provided'),
    'v.mixed':L('多個值','多个值','Mixed'),
    'v.controlTab':L('操控沙盤','操控沙盘','Play the sandbox'),
    'v.browseTab':L('查香港數據','查香港数据','Explore Hong Kong data'),
    'v.aiTab':L('AI 出關卡','AI 出关卡','AI level request'),
    'v.aiTitle':L('一句話，提出一個交通難題','一句话，提出一个交通难题','Describe a transport challenge'),
    'v.aiPrompt':L('你想在哪裡試什麼變化？','你想在哪里试什么变化？','Where and what would you like to change?'),
    'v.aiPlaceholder':L('例如：啟德多五萬人，怎樣讓觀塘道少塞車？','例如：启德多五万人，怎样让观塘道少塞车？','Example: 50,000 more people in Kai Tak. How can we ease Kwun Tong Road?'),
    'v.aiGenerate':L('產生關卡請求','生成关卡请求','Generate a level request'),
    'v.aiBusy':L('正在產生…','正在生成…','Generating…'),
    'v.aiNote':L('先產生請求 JSON，交給後續關卡製作。切出關卡與打開第三關由下一步接入。','先生成请求 JSON，交给后续关卡制作。切出关卡与打开第三关由下一步接入。','This creates a request JSON for the next level-building step. Cutting a level and opening mode 3 will be connected next.'),
    'v.aiEmpty':L('請先寫一句你想試的情境。','请先写一句你想试的情境。','Enter a scenario first.'),
    'v.aiExample':L('AI 服務未連接，已使用本機示例。','AI 服务未连接，已使用本机示例。','AI service unavailable; a local example was used.'),
    'v.aiSource':L('已由 AI 產生請求。','已由 AI 生成请求。','Request generated by AI.'),
    'v.aiError':L('暫時無法產生請求。可試「啟德」「沙田」「北部都會區」等本機示例。','暂时无法生成请求。可试“启德”“沙田”“北部都会区”等本机示例。','Unable to generate a request. Try a local example mentioning Kai Tak, Sha Tin or the Northern Metropolis.'),
    'v.noDemand':L('這裡沒有本時段出發出行資料','这里没有本时段出发出行数据','No departing-trip data for this period'),
    'm5.runStable':L('▶ 跑到穩定','▶ 跑到稳定','▶ Run to stable'),
    'm5.newTrack':L('拖動畫線 · 點格選分區 · 滾輪縮放','拖动画线 · 点格选分区 · 滚轮缩放','Drag to draw · click to select a zone · scroll to zoom'),
    'm5.panHint':L('拖動平移 · 滾輪縮放','拖动平移 · 滚轮缩放','Drag to pan · scroll to zoom'),
    'v.mapJump':L('到地圖畫線 ↓','到地图画线 ↓','Draw on the map ↓'),
    'v.mobileLine':L('畫線','画线','Draw'),
    'v.mobileStation':L('放站','放站','Stations'),
    'v.mobileRun':L('▶ 跑','▶ 跑','▶ Run'),
    'v.close':L('關閉','关闭','Close'),
    'v.needsStations':L('先在線上放至少兩個站，才有人能坐新線。','先在线上放至少两个站，才有人能坐新线。','Add at least two stations on your line so people can use it.'),
    'v.views':L('沙盤子入口','沙盘子入口','Sandbox views'),
    'v.objectType':L('查詢對象類別','查询对象类别','Object type'),
    'v.placeNoDemand':L('{name} · {district}\n居民 {pop} 人 · 崗位 {jobs} 個\n未提供本時段出發出行，不能算開車比例。','{name} · {district}\n居民 {pop} 人 · 岗位 {jobs} 个\n未提供本时段出发出行，不能算开车比例。','{name} · {district}\n{pop} residents · {jobs} jobs\nCar share unavailable: no departing-trip data for this period.')
  });
  const t=(k,v)=>I.t(k,v),num=n=>Math.round(n||0).toLocaleString('en-US');
  const districtNames={
    '中西區':['中西区','Central & Western'],'九龍城區':['九龙城区','Kowloon City'],'元朗區':['元朗区','Yuen Long'],'北區':['北区','North'],
    '南區':['南区','Southern'],'大埔區':['大埔区','Tai Po'],'屯門區':['屯门区','Tuen Mun'],'東區':['东区','Eastern'],
    '沙田區':['沙田区','Sha Tin'],'油尖旺區':['油尖旺区','Yau Tsim Mong'],'深水埗區':['深水埗区','Sham Shui Po'],'灣仔區':['湾仔区','Wan Chai'],
    '荃灣區':['荃湾区','Tsuen Wan'],'葵青區':['葵青区','Kwai Tsing'],'西貢區':['西贡区','Sai Kung'],'觀塘區':['观塘区','Kwun Tong'],
    '離島區':['离岛区','Islands'],'黃大仙區':['黄大仙区','Wong Tai Sin']
  };
  function districtName(s){const n=districtNames[s];return n?(I.lang==='en'?n[1]:I.lang==='zh-Hans'?n[0]:s):s;}
  function create(q){
    const b=q.base,ctx=q.ctx,C=18;
    let selected=new Set(),inspected=null,mode='play',changes=false,before=false,challenge=null;
    const pick=o=>typeof o==='string'?o:(o&&o[I.lang]||o&&o['zh-Hant']||'');
    const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    function saved(key,fallback){try{return JSON.parse(localStorage.getItem(key))||fallback;}catch(_){return fallback;}}
    function save(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch(_){}}
    let achievements=saved('tl-m5-challenges-v2',{}),configs={},weights={zones:{}},weightsReady=false,lastAudit=null;
    const districts=new Map(),boundaries=[];
    for(const z of b.zones){if(!districts.has(z.district))districts.set(z.district,{name:z.district,x:0,y:0,w:0});const d=districts.get(z.district),w=Math.sqrt(z.pop+z.jobs+1);d.x+=(z.cell[0]+.5)*w;d.y+=(z.cell[1]+.5)*w;d.w+=w;}
    for(const d of districts.values()){d.x=d.x/d.w*C;d.y=d.y/d.w*C;}
    const ids=b.zone_index||[];
    for(let y=0;y<b.rows;y++)for(let x=0;x<b.cols;x++){
      const z=b.zones[ids[y*b.cols+x]];if(!z)continue;
      for(const [dx,dy] of [[1,0],[0,1]]){const n=b.zones[ids[(y+dy)*b.cols+x+dx]];if(n&&n.district!==z.district)boundaries.push(dx?[x+1,y,x+1,y+1]:[x,y+1,x+1,y+1]);}
    }
    const zoomLabel=document.createElement('span');zoomLabel.id='zoomLevel';zoomLabel.className='zoom-level';document.querySelector('.maptoolbar').prepend(zoomLabel);
    const select=document.createElement('button');select.id='selectTool';select.className='btn btn-sm';select.dataset.i18n='v.select';select.textContent=t('v.select');document.querySelector('.maptools').prepend(select);select.onclick=()=>q.setTool('select');
    document.querySelector('.sandbox-right .areas').style.maxHeight='none';
    const challengeBox=document.createElement('section');challengeBox.innerHTML='<div class="lbl" data-i18n="v.challenges"></div><div id="challengeList" class="challenge-list"></div><button id="freePlay" class="btn btn-sm" data-i18n="v.free"></button><div id="activeGoal" class="active-goal" role="status"></div>';document.querySelector('.sandbox .lede').after(challengeBox);
    const objective=document.createElement('div');objective.id='mapObjective';objective.className='map-corner map-objective';document.querySelector('.sandbox-map').append(objective);
    const help=document.createElement('dialog');help.id='playHelp';help.className='intro-dialog';help.innerHTML='<button class="close" data-close="playHelp" data-i18n-aria="v.close">×</button><span class="lbl">TRANSITLAB · 05</span><h2 data-i18n="v.introTitle"></h2><ol class="steps"><li data-i18n="v.step1"></li><li data-i18n="v.step2"></li><li data-i18n="v.step3"></li></ol><button id="startPlaying" class="btn btn-p" data-i18n="v.start"></button>';document.body.append(help);
    const openHelp=()=>{if(!help.open)help.showModal();};$('help').onclick=openHelp;$('help').dataset.i18n='v.playHelp';
    // The old rules remain accessible through “About”; “How to play” is the three-step first-run card.
    $('help').addEventListener('click',()=>$('info').close());
    help.querySelector('.close').onclick=()=>{help.close();save('tl-m5-played-v2',true);};$('startPlaying').onclick=()=>{help.close();save('tl-m5-played-v2',true);};
    const changeTools=document.createElement('div');changeTools.className='layer-change-tools';changeTools.innerHTML='<button id="changeLayer" class="btn btn-sm" aria-pressed="false" data-i18n="v.change"></button><button id="beforeView" class="btn btn-sm" aria-pressed="false" data-i18n="v.before"></button><button id="afterView" class="btn btn-sm" aria-pressed="true" data-i18n="v.after"></button>';document.querySelector('.maptoolbar').append(changeTools);
    const changeKey=document.createElement('div');changeKey.id='changeKey';changeKey.className='change-key';document.querySelector('.sandbox-map').append(changeKey);
    $('changeLayer').onclick=()=>{changes=!changes;$('changeLayer').setAttribute('aria-pressed',String(changes));q.draw();};
    function view(old){before=old;$('beforeView').setAttribute('aria-pressed',String(old));$('afterView').setAttribute('aria-pressed',String(!old));q.draw();}
    $('beforeView').onclick=()=>view(true);$('afterView').onclick=()=>view(false);
    const report=document.createElement('dialog');report.id='report';report.className='intro-dialog';report.innerHTML='<button class="close" data-i18n-aria="v.close">×</button><span class="lbl" id="reportPeriod"></span><h2 data-i18n="v.report"></h2><div id="reportGoal" class="active-goal"></div><div id="reportSentences" class="report-sentences"></div><details><summary data-i18n="v.details"></summary><div id="reportDetails"></div></details><p class="note" data-i18n="v.reportNote"></p><button id="backToMap" class="btn btn-p" data-i18n="v.continue"></button>';document.body.append(report);report.querySelector('.close').onclick=()=>report.close();$('backToMap').onclick=()=>report.close();
    const right=document.querySelector('.sandbox-right');const summary=document.createElement('div');summary.innerHTML='<div id="reportSummary" class="report-summary" data-i18n="v.noResult"></div><button id="openReport" class="btn btn-sm" data-i18n="v.reportOpen" disabled></button>';right.prepend(summary);$('openReport').onclick=()=>report.showModal();
    const jump=document.createElement('button');jump.className='btn btn-sm map-jump';jump.dataset.i18n='v.mapJump';challengeBox.append(jump);jump.onclick=()=>document.querySelector('.sandbox-play').scrollIntoView({behavior:'smooth',block:'start'});
    const mobileTools=document.createElement('div');mobileTools.className='mobile-map-tools';mobileTools.innerHTML='<button id="mobileLine" class="btn btn-sm" data-i18n="v.mobileLine"></button><button id="mobileStation" class="btn btn-sm" data-i18n="v.mobileStation"></button><button id="mobileRun" class="btn btn-sm btn-p" data-i18n="v.mobileRun"></button>';document.querySelector('.maptoolbar').append(mobileTools);$('mobileLine').onclick=()=>q.setTool('line');$('mobileStation').onclick=()=>q.setTool('station');$('mobileRun').onclick=()=>$('runStable').click();
    const population=document.createElement('section');population.className='population-panel box';population.innerHTML='<div class="lbl" data-i18n="v.population"></div><p id="selectedZones" class="note"></p><div id="populationSliders"></div><div class="row"><button id="resetZones" class="btn btn-sm" data-i18n="v.resetZone"></button><button id="resetAllZones" class="btn btn-sm" data-i18n="v.resetAllZones"></button></div><p id="scenarioAudit" class="note"></p><p id="scenarioStatus" class="note"></p><p class="note" data-i18n="v.scenarioNote"></p>';document.querySelector('.plan-detail').after(population);
    $('populationSliders').innerHTML=['people','child','adult','elder','attraction'].map(k=>'<label class="population-slider"><span data-i18n="v.'+k+'"></span><output id="value-'+k+'">0%</output><input id="slider-'+k+'" type="range" min="-50" max="150" step="5" value="0" data-kind="'+k+'" aria-label="'+esc(t('v.'+k))+'" disabled></label>').join('');
    let scenarioTimer=0;
    function applyScenario(){if(scenarioTimer)clearTimeout(scenarioTimer);scenarioTimer=setTimeout(()=>{scenarioTimer=0;q.rebuildScenario();},240);}
    $('populationSliders').addEventListener('input',e=>{const key=e.target.dataset.kind;if(!key)return;for(const i of selected){const id=String(b.zones[i].id);configs[id]={...(configs[id]||{}),[key]:Number(e.target.value)};}lastAudit=null;renderPopulation(false);applyScenario();});
    $('resetZones').onclick=()=>{for(const i of selected)delete configs[String(b.zones[i].id)];lastAudit=null;renderPopulation();applyScenario();};$('resetAllZones').onclick=()=>{configs={};lastAudit=null;renderPopulation();applyScenario();};
    fetch('trip-weights.json').then(r=>{if(!r.ok)throw Error(r.status);return r.json()}).then(out=>{weights=out;weightsReady=true;renderPopulation();}).catch(()=>{$('scenarioStatus').textContent=t('v.scenarioError');});
    const areaPanel=document.createElement('div');areaPanel.id='areaPanel';const areaHeading=$('areasList').previousElementSibling;right.insertBefore(areaPanel,areaHeading);areaPanel.append(areaHeading,$('areasList'),$('cutArea'));if(areaPanel.nextElementSibling?.classList.contains('note'))areaPanel.append(areaPanel.nextElementSibling);
    const rightTabs=document.createElement('div');rightTabs.className='right-tabs';rightTabs.innerHTML='<button id="areasTab" class="btn btn-sm" aria-pressed="true" data-i18n="v.areasTab"></button><button id="dataTab" class="btn btn-sm" aria-pressed="false" data-i18n="v.data"></button>';right.insertBefore(rightTabs,areaPanel);
    const dataPanel=document.createElement('section');dataPanel.id='dataPanel';dataPanel.hidden=true;dataPanel.innerHTML='<p class="note" data-i18n="v.inspectHint"></p><div class="row"><select id="inspectType" aria-label="Object type"><option value="zone" data-i18n="v.zoneType"></option><option value="road" data-i18n="v.roadType"></option><option value="station" data-i18n="v.stationType"></option></select><button id="inspectMap" class="btn btn-sm" data-i18n="v.inspectMap"></button></div><div id="dataContent"></div><p class="note" data-i18n="v.tiersNote"></p>';areaPanel.after(dataPanel);
    function rightTab(data){areaPanel.hidden=data;dataPanel.hidden=!data;$('areasTab').setAttribute('aria-pressed',String(!data));$('dataTab').setAttribute('aria-pressed',String(data));renderData();}
    $('areasTab').onclick=()=>rightTab(false);$('dataTab').onclick=()=>rightTab(true);$('inspectMap').onclick=()=>q.setTool('inspect');
    $('inspectType').dataset.i18nAria='v.objectType';$('inspectType').onchange=()=>{inspected=null;renderData();};
    const modeTabs=document.createElement('nav');modeTabs.className='sandbox-modes';modeTabs.setAttribute('aria-label','Sandbox views');modeTabs.innerHTML='<button class="btn btn-sm" data-mode="play" aria-pressed="true" data-i18n="v.controlTab"></button><button class="btn btn-sm" data-mode="data" aria-pressed="false" data-i18n="v.browseTab"></button><button class="btn btn-sm" data-mode="ai" aria-pressed="false" data-i18n="v.aiTab"></button>';$('app').before(modeTabs);
    const aiPanel=document.createElement('section');aiPanel.id='aiPanel';aiPanel.hidden=true;aiPanel.innerHTML='<div class="ai-card"><span class="lbl">TRANSITLAB · AI</span><h2 data-i18n="v.aiTitle"></h2><label for="aiSentence" data-i18n="v.aiPrompt"></label><textarea id="aiSentence" rows="3" maxlength="600"></textarea><button class="btn btn-p" id="aiGenerate" data-i18n="v.aiGenerate"></button><p id="aiStatus" class="note" role="status"></p><pre id="aiRequest" tabindex="0"></pre><p class="note" data-i18n="v.aiNote"></p></div>';$('app').after(aiPanel);
    modeTabs.dataset.i18nAria='v.views';
    function setMode(next){mode=next;$('app').hidden=next==='ai';aiPanel.hidden=next!=='ai';document.body.dataset.sandboxMode=next;modeTabs.querySelectorAll('[data-mode]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.mode===next)));if(next==='data'){rightTab(true);q.setTool('inspect');}else if(next==='play')q.setTool('line');requestAnimationFrame(q.draw);}
    modeTabs.onclick=e=>{const btn=e.target.closest('[data-mode]');if(btn)setMode(btn.dataset.mode);};
    $('aiGenerate').onclick=async()=>{const sentence=$('aiSentence').value.trim();if(!sentence){$('aiStatus').textContent=t('v.aiEmpty');return;}$('aiGenerate').disabled=true;$('aiStatus').textContent=t('v.aiBusy');$('aiRequest').textContent='';try{const names=Object.fromEntries(b.areas.map(a=>[a.key,b.zones.filter(z=>inside(z.cell,a.box)).map(z=>q.displayName(z))]));const out=await root.TLAI.generate(sentence,{lang:I.lang,names});$('aiRequest').textContent=JSON.stringify(out.request,null,2);$('aiStatus').textContent=t(out.source==='example'?'v.aiExample':'v.aiSource');}catch(e){$('aiStatus').textContent=t('v.aiError');}finally{$('aiGenerate').disabled=false;}};
    function renderPopulation(updateSlider=true){const n=selected.size;$('selectedZones').textContent=n?t('v.selected',{n})+' · '+[...selected].map(i=>q.displayName(b.zones[i])).join('、'):t('v.noSelection');
      for(const key of ['people','child','adult','elder','attraction']){const values=[...selected].map(i=>configs[String(b.zones[i].id)]?.[key]||0),mixed=new Set(values).size>1,value=values[0]||0;const slider=$('slider-'+key);slider.disabled=!n||!weightsReady;slider.setAttribute('aria-label',t('v.'+key));if(updateSlider)slider.value=mixed?0:value;$('value-'+key).textContent=mixed?t('v.mixed'):(value>0?'+':'')+value+'%';}
      $('resetZones').disabled=!n;$('scenarioStatus').textContent=weightsReady?t('v.zonesEdited',{n:Object.values(configs).filter(c=>Object.values(c).some(Number)).length}):t('v.scenarioLoading');renderAudit();
    }
    function renderAudit(){if(!selected.size){$('scenarioAudit').textContent='';return;}const draft=lastAudit||root.SandboxScenarios.adjust(q.demand,configs,weights).audit;let a=0,z=0,schoolA=0,schoolZ=0;for(const i of selected){const id=String(b.zones[i].id),row=draft.zones[id];a+=row?.before??q.stats.totals[i]??0;z+=row?.after??q.stats.totals[i]??0;schoolA+=weights.zones[id]?.HBS||0;schoolZ+=row?.purposes?.HBS??weights.zones[id]?.HBS??0;}$('scenarioAudit').textContent=t('v.departures',{a:num(a),b:num(z)})+'\n'+t('v.purposeSchool',{a:num(schoolA),b:num(schoolZ)});}
    function dataRow(label,value,tier,source){return '<div class="data-row"><span>'+esc(label)+'</span><b>'+esc(value)+'</b><small class="tier-badge">'+esc(t('v.tier'+(tier||'D')))+'</small><small class="data-source">'+esc(source||'')+'</small></div>';}
    function renderData(){if(!inspected){$('dataContent').textContent=t('v.noObject');return;}let html='';const index=inspected.index,kind=inspected.kind,source=b.sources||{},tiers=b.tiers||{};
      if(kind==='zone'){const z=b.zones[index];if(!z)return;html='<h3>'+esc(q.displayName(z))+'</h3><p class="note">'+esc(districtName(z.district))+'</p>'+dataRow(t('v.popData'),num(z.pop),tiers.zones,source.population_jobs)+dataRow(t('v.jobsData'),num(z.jobs),tiers.zones,source.population_jobs)+dataRow(t('v.shareData'),q.stats.totals[index]?((q.stats.shares[index]||0)*100).toFixed(1)+'%':t('v.notAvailable'),q.demand.tiers?.pairs||q.demand.tier,'hk-demand-'+q.demand.period+'.json · car / (car + transit)');}
      if(kind==='road'){const s=b.sections[index];if(!s)return;html='<h3>'+esc(q.roadName(s))+'</h3>'+dataRow(t('v.loadData'),num(q.stats.loads[index]),q.demand.tiers?.sections||tiers.sections,source.roads)+dataRow(t('v.capacityData'),num(s.cap),tiers.sections,source.roads)+dataRow(t('v.vcData'),(q.stats.loads[index]/s.cap).toFixed(2),tiers.sections,source.roads);}
      if(kind==='station'){const s=b.stations[index];if(!s)return;const flows=(q.demand.lines||[]).filter(r=>r[1]===s.id||r[2]===s.id);html='<h3>'+esc(q.displayName(s))+'</h3>'+dataRow(t('v.stationFlow'),flows.length?num(Math.max(...flows.map(r=>r[3]))):t('v.notAvailable'),q.demand.tiers?.lines||tiers.stations,source.stations_lines);for(const id of s.lines||[]){const l=b.lines.find(l=>l.id===id);if(l)html+=dataRow(q.displayName(l)+' · '+t('v.frequency'),l.trains_per_hour??t('v.notAvailable'),tiers.stations,source.stations_lines);}}
      $('dataContent').innerHTML=html;
    }
    const roundHeader=$('stableBadge').closest('.row');const roundTable=$('roundRows').closest('.table-wrap');$('reportDetails').append(roundHeader,roundTable);
    const flags=[];
    function rebuildFlags(){flags.length=0;
    const congested=b.sections.map((s,i)=>({s,i,vc:q.stats.loads[i]/Math.max(1,s.cap)})).sort((a,z)=>z.vc-a.vc).slice(0,5);
    for(const r of congested)flags.push({kind:'road',index:r.i,cell:r.s.a});
    const distant=b.zones.map((z,i)=>({z,i,d:Math.min(...b.stations.map(s=>Math.hypot(z.cell[0]-s.cell[0],z.cell[1]-s.cell[1])))})).filter(v=>v.d>=3&&v.z.pop>0).sort((a,z)=>(z.z.pop*z.d)-(a.z.pop*a.d)).slice(0,5);
    for(const z of distant)flags.push({kind:'zone',index:z.i,cell:z.z.cell,distance:z.d});
    }
    function flagText(f){if(f.kind==='road'){const s=b.sections[f.index];return t('v.flagRoad',{name:q.roadName(s),load:num(q.stats.loads[f.index]),vc:(q.stats.loads[f.index]/s.cap).toFixed(2)});}const z=b.zones[f.index];return t('v.flagZone',{name:q.displayName(z),pop:num(z.pop),km:(f.distance*(b.cell_m||400)/1000).toFixed(1)});}
    function renderChallenges(){
      $('challengeList').innerHTML=(root.SandboxChallenges||[]).map((c,i)=>'<button class="challenge-card" data-challenge="'+esc(c.key)+'" aria-pressed="'+(challenge===c)+'"><span class="challenge-mark">'+(achievements[c.key]?.passed?'✓':'0'+(i+1))+'</span><b>'+esc(pick(c.title))+'</b><small>'+esc(pick(c.story))+'</small></button>').join('');
      renderGoal();
    }
    function chooseChallenge(c){challenge=c;if(c){const i=b.areas.findIndex(a=>a.key===c.area);if(i>=0)q.selectArea(i);}renderChallenges();q.draw();if(window.innerWidth<=700&&c)document.querySelector('.sandbox-play').scrollIntoView({behavior:'smooth',block:'start'});}
    $('challengeList').onclick=e=>{const btn=e.target.closest('[data-challenge]');if(btn)chooseChallenge(root.SandboxChallenges.find(c=>c.key===btn.dataset.challenge));};$('freePlay').onclick=()=>chooseChallenge(null);
    const inside=(cell,box)=>cell[0]>=box[0]&&cell[1]>=box[1]&&cell[0]<box[2]&&cell[1]<box[3];
    function goalValue(c,m){if(!c||!m)return 0;const g=c.goal;
      if(g.metric==='roadVehiclesReduced'){const roads=new Set(b.roads.filter(r=>g.where.roads.includes(r.en)).map(r=>String(r.id)));return Math.max(0,...b.sections.map((s,i)=>roads.has(String(s.road))?q.stats.loads[i]-m.sectionLoads[i]:0));}
      if(g.metric==='transitSharePoints'){let total=0,delta=0;b.zones.forEach((z,i)=>{if(inside(z.cell,g.where.box)){const n=q.stats.totals[i]||0;total+=n;delta+=n*((q.stats.shares[i]||0)-(m.zoneCarShare[i]||0));}});return total?delta/total*100:0;}
      if(g.metric==='areaCongestionReduced')return b.sections.reduce((sum,s,i)=>{if(!inside(s.a,g.where.box))return sum;const old=q.stats.loads[i],next=m.sectionLoads[i];return sum+old*(old/s.cap)**2-next*m.sectionExtras[i];},0);
      return 0;
    }
    function goalStatus(m){if(!challenge)return '';if(!m)return t('v.goalPending');const v=goalValue(challenge,m),target=challenge.goal.target;return t(v+1e-9>=target?'v.goalPassed':'v.goalProgress',{value:v.toFixed(1),target,remaining:Math.max(0,target-v).toFixed(1)});}
    function renderGoal(m=q.metrics){$('activeGoal').innerHTML=challenge?'<strong>'+esc(pick(challenge.title))+'</strong>'+esc(pick(challenge.hint))+'<br>'+esc(goalStatus(m))+'<br><small>'+esc(t('v.stableOnly'))+'</small>':'';objective.textContent=challenge?pick(challenge.title)+' · '+goalStatus(m):'';}
    function result(message){
      const m=message.metrics;if(!m)return;renderGoal(m);const lines=[t('v.ridersSentence',{n:num(m.newLineRiders)})];
      const roads=b.sections.map((s,i)=>({s,d:q.stats.loads[i]-m.sectionLoads[i]})).sort((a,z)=>Math.abs(z.d)-Math.abs(a.d));const named=roads.filter(v=>!/(未命名|unnamed)/i.test(q.roadName(v.s)));const target=challenge?.goal?.where?.roads;const targetRoads=target?named.filter(v=>target.includes(b.roads.find(r=>r.id===v.s.road)?.en)):[];const best=targetRoads[0]||named[0]||roads[0];if(best)lines.push(t(best.d>=0?'v.roadLess':'v.roadMore',{name:q.roadName(best.s),n:num(Math.abs(best.d))}));
      const zones=b.zones.map((z,i)=>({z,i,d:(q.stats.shares[i]||0)-(m.zoneCarShare[i]||0)})).filter(v=>q.stats.totals[v.i]>0&&(q.area==null||inside(v.z.cell,b.areas[q.area].box))).sort((a,z)=>Math.abs(z.d)-Math.abs(a.d));const z=zones[0];if(z){const scale=I.lang==='en'?100:10;lines.push(t('v.shareSentence',{name:q.displayName(z.z),a:((q.stats.shares[z.i]||0)*scale).toFixed(1),b:((m.zoneCarShare[z.i]||0)*scale).toFixed(1)}));}
      lines.push(t(m.congestionReduced>=0?'v.jamLess':'v.jamMore',{n:num(Math.abs(m.congestionReduced))}));
      $('reportSentences').innerHTML=lines.map(s=>'<p>'+esc(s)+'</p>').join('');$('reportSummary').textContent=lines.slice(0,2).join(' ');$('reportPeriod').textContent=I.t('p.'+(q.demand.period||'am'))+' · '+I.t('m5.roundStatus',{n:q.rows.length});$('openReport').disabled=false;
      if(challenge&&message.stable){const v=goalValue(challenge,m),old=achievements[challenge.key]||{};achievements[challenge.key]={passed:old.passed||v>=challenge.goal.target,best:Math.max(old.best||0,v)};save('tl-m5-challenges-v2',achievements);renderChallenges();}
      $('reportGoal').innerHTML=challenge?esc(goalStatus(m))+(achievements[challenge.key]?'<br>'+esc(t('v.best',{n:achievements[challenge.key].best.toFixed(1)})):''):'';
      if(message.stable&&!report.open)report.showModal();
    }
    function screen(c){return {x:q.camera.x+(c[0]+.5)*C*q.camera.zoom,y:q.camera.y+(c[1]+.5)*C*q.camera.zoom};}
    function visible(p,pad=20){return p.x>=-pad&&p.y>=-pad&&p.x<q.canvas.clientWidth+pad&&p.y<q.canvas.clientHeight+pad;}
    function label(text,x,y,size=12,color='#33464c',weight=500){
      ctx.font=`${weight} ${size}px Geist, "Microsoft YaHei", sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineWidth=3;ctx.strokeStyle='rgba(251,250,244,.93)';ctx.strokeText(text,x,y);ctx.fillStyle=color;ctx.fillText(text,x,y);
    }
    function draw(){
      const zoom=q.camera.zoom,level=zoom<.65?0:zoom<1.6?1:2,w=q.canvas.clientWidth,h=q.canvas.clientHeight;
      $('mobileRun').disabled=$('runStable').disabled;$('mobileLine').setAttribute('aria-pressed',String(q.tool==='line'));$('mobileStation').setAttribute('aria-pressed',String(q.tool==='station'));
      zoomLabel.textContent=t(['v.zoomDistrict','v.zoomPlace','v.zoomStreet'][level]);select.setAttribute('aria-pressed',String(q.tool==='select'));
      ctx.save();ctx.strokeStyle='#6a816e';ctx.lineWidth=.8/zoom;ctx.globalAlpha=.35;ctx.setLineDash([4/zoom,3/zoom]);ctx.beginPath();for(const v of boundaries){ctx.moveTo(v[0]*C,v[1]*C);ctx.lineTo(v[2]*C,v[3]*C);}ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;
      if(zoom>=.65){ctx.strokeStyle='rgba(76,87,73,.13)';ctx.lineWidth=.6/zoom;ctx.beginPath();
        const x0=Math.max(0,Math.floor(-q.camera.x/zoom/C)),x1=Math.min(b.cols,Math.ceil((w-q.camera.x)/zoom/C));
        const y0=Math.max(0,Math.floor(-q.camera.y/zoom/C)),y1=Math.min(b.rows,Math.ceil((h-q.camera.y)/zoom/C));
        for(let x=x0;x<=x1;x++){ctx.moveTo(x*C,y0*C);ctx.lineTo(x*C,y1*C);}for(let y=y0;y<=y1;y++){ctx.moveTo(x0*C,y*C);ctx.lineTo(x1*C,y*C);}ctx.stroke();}
      if(selected.size){ctx.fillStyle='rgba(43,108,88,.18)';ctx.strokeStyle='#296b59';ctx.lineWidth=1/zoom;for(let y=0;y<b.rows;y++)for(let x=0;x<b.cols;x++)if(selected.has(ids[y*b.cols+x])){ctx.fillRect(x*C,y*C,C,C);ctx.strokeRect(x*C,y*C,C,C);}}
      const dpr=window.devicePixelRatio||1;ctx.setTransform(dpr,0,0,dpr,0,0);
      if(changes){changeKey.textContent=q.metrics||q.preview?t('v.changeKey'):t('v.changeEmpty');const m=q.metrics||q.preview;if(m&&!before)for(let y=0;y<b.rows;y++)for(let x=0;x<b.cols;x++){const i=ids[y*b.cols+x];if(i<0||i===undefined)continue;const d=(m.zoneCarShare[i]||0)-(q.stats.shares[i]||0);if(Math.abs(d)<.0001)continue;const p=screen([x-.5,y-.5]);ctx.globalAlpha=Math.min(.32,.07+Math.abs(d)*3);ctx.fillStyle=d<0?'#16926d':'#cc4752';ctx.fillRect(p.x,p.y,C*zoom,C*zoom);}ctx.globalAlpha=1;}else changeKey.textContent='';
      // Every full-map district label is retained, with short leaders where dense districts overlap.
      if(level===0){const used=[];
        for(const d of districts.values()){
          const p={x:q.camera.x+d.x*zoom,y:q.camera.y+d.y*zoom};if(!visible(p,50))continue;
          const name=districtName(d.name),size=I.lang==='en'?11:14;ctx.font=`600 ${size}px Geist, "Microsoft YaHei",sans-serif`;const tw=ctx.measureText(name).width+12,th=22;
          let x=Math.max(tw/2+5,Math.min(w-tw/2-5,p.x)),y=Math.max(42,Math.min(h-90,p.y)),found=false;
          for(let r=0;r<=150&&!found;r+=12)for(let a=0;a<Math.PI*2;a+=Math.PI/4){const tx=Math.max(tw/2+5,Math.min(w-tw/2-5,x+Math.cos(a)*r)),ty=Math.max(42,Math.min(h-90,y+Math.sin(a)*r));const box=[tx-tw/2,ty-th/2,tx+tw/2,ty+th/2];if(!used.some(v=>box[0]<v[2]+3&&box[2]>v[0]-3&&box[1]<v[3]+2&&box[3]>v[1]-2)){x=tx;y=ty;used.push(box);found=true;break;}}
          if(Math.hypot(x-p.x,y-p.y)>16){ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(x,y);ctx.strokeStyle='#617c7266';ctx.lineWidth=1;ctx.stroke();}
          ctx.fillStyle='rgba(250,249,242,.7)';ctx.fillRect(x-tw/2,y-th/2,tw,th);label(name,x,y,size,'#304e49',600);
        }
      }else{
        const used=[];function place(text,p,size,color,dx=0,dy=0){if(!visible(p))return;const x=p.x+dx,y=p.y+dy;ctx.font=`500 ${size}px Geist,"Microsoft YaHei",sans-serif`;const tw=ctx.measureText(text).width,box=[x-tw/2,y-8,x+tw/2,y+8];if(used.some(v=>box[0]<v[2]+3&&box[2]>v[0]-3&&box[1]<v[3]+3&&box[3]>v[1]-3))return;used.push(box);label(text,x,y,size,color);}
        if($('layerTransit').checked)for(const s of b.stations||[])place(q.displayName(s),screen(s.cell),12,'#304554',18,-10);
        const zones=[...b.zones].sort((a,z)=>(z.pop+z.jobs)-(a.pop+a.jobs));
        for(const z of zones){if(level===1&&z.pop+z.jobs<25000)continue;place(q.displayName(z),screen(z.cell),level===1?13:12,'#3d624b',0,14);}
        if(level===2)for(const r of b.roads||[]){const c=r.cells[Math.floor(r.cells.length/2)];if(c)place(q.displayName(r),screen(c),10,'#826440',0,0);}
      }
      if(q.area!=null&&b.areas[q.area]){const a=b.areas[q.area],p=screen([a.box[0],a.box[1]]);label(q.displayName(a),Math.max(65,Math.min(w-65,p.x+55)),Math.max(32,p.y-8),14,'#a73750',600);}
      if(!challenge)flags.forEach((f,i)=>{const p=screen(f.cell);if(!visible(p))return;ctx.strokeStyle='#a23845';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(p.x,p.y+7);ctx.lineTo(p.x,p.y-15);ctx.stroke();ctx.fillStyle='#c34d59';ctx.beginPath();ctx.moveTo(p.x,p.y-15);ctx.lineTo(p.x+19,p.y-15);ctx.lineTo(p.x+15,p.y-2);ctx.lineTo(p.x,p.y-2);ctx.fill();ctx.fillStyle='#fff';ctx.font='bold 9px Geist';ctx.textAlign='center';ctx.fillText(i+1,p.x+8,p.y-8);});
      ctx.restore();
    }
    function tooltip(e,zone){const z=zone.z,m=before?null:q.metrics||q.preview,share=m&&Number.isFinite(m.zoneCarShare[zone.i])?m.zoneCarShare[zone.i]:q.stats.shares[zone.i]||0;
      const tip=$('tooltip');tip.textContent=t(q.stats.totals[zone.i]?'v.placeCard':'v.placeNoDemand',{name:q.displayName(z),district:districtName(z.district),pop:num(z.pop),jobs:num(z.jobs),share:(share*10).toFixed(1),pct:(share*100).toFixed(1)});tip.hidden=false;
      const r=q.canvas.getBoundingClientRect();tip.style.left=Math.max(5,Math.min(r.width-250,e.clientX-r.left+12))+'px';tip.style.top=Math.max(5,Math.min(r.height-120,e.clientY-r.top+12))+'px';
    }
    function pointer(e,cell){
      if(q.tool==='pan'||e.button===1||e.button===2)return false;
      if(!challenge){const r=q.canvas.getBoundingClientRect();const f=flags.find(f=>{const p=screen(f.cell);return Math.hypot(e.clientX-r.left-p.x-8,e.clientY-r.top-p.y+8)<15;});if(f){inspected=f;$('mapMessage').textContent=flagText(f);q.status(flagText(f));return true;}}
      if(q.tool==='inspect'||mode==='data'){
        const type=$('inspectType').value;let item=null;
        if(type==='zone'){const z=q.nearestZone(cell);if(z){selected=new Set([z.i]);item={kind:'zone',index:z.i};renderPopulation();}}
        if(type==='road'){const s=q.nearestSection(cell,e);if(s)item={kind:'road',index:s.i};}
        if(type==='station'){const r=q.canvas.getBoundingClientRect();let distance=18;(b.stations||[]).forEach((s,i)=>{const p=screen(s.cell),d=Math.hypot(e.clientX-r.left-p.x,e.clientY-r.top-p.y);if(d<distance){distance=d;item={kind:'station',index:i};}});}
        if(item){inspected=item;renderData();}else q.status(t('v.noNearby'));q.draw();return true;
      }
      if(q.tool!=='select'&&!e.shiftKey)return false;tap(e,cell);return true;
    }
    function tap(e,cell){const zone=q.nearestZone(cell);if(!zone)return;if(!e.shiftKey)selected.clear();selected.add(zone.i);inspected={kind:'zone',index:zone.i};renderPopulation();renderData();q.draw();}
    function refresh(){I.apply();rebuildFlags();$('aiSentence').placeholder=t('v.aiPlaceholder');renderChallenges();renderPopulation();renderData();select.textContent=t('v.select');if(q.metrics)result({metrics:q.metrics,stable:false});q.draw();}
    function roadColor(i,normal){if(!changes)return normal;const m=q.metrics||q.preview;if(before||!m)return '#9daba7';const delta=m.sectionLoads[i]-q.stats.loads[i];return Math.abs(delta)<.5?'#9daba7':delta<0?'#168263':'#cc4752';}
    function reset(){renderGoal(null);$('openReport').disabled=true;$('reportSummary').textContent=t('v.noResult');if(report.open)report.close();}
    refresh();if(!saved('tl-m5-played-v2',false))openHelp();
    return {draw,tooltip,pointer,tap,refresh,result,reset,roadColor,mapMetrics:()=>before?null:(q.metrics||q.preview),get before(){return before},get configs(){return configs},get weights(){return weights},audit(a){lastAudit=a;renderAudit();}};
  }
  root.SandboxV2={create,districtName};
})(window);
