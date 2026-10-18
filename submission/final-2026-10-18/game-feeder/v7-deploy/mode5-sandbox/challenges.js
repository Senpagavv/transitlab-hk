/* Add a challenge here; the UI reads this schema without a separate per-challenge handler. */
(function(root){
  const L=(hant,hans,en)=>({'zh-Hant':hant,'zh-Hans':hans,en});
  const challenges=[
    {key:'kowloon-traffic',title:L('九龍東塞車','九龙东塞车','Kowloon East traffic'),
      story:L('早上觀塘道車龍排長。畫一條新線，讓一些人改坐地鐵。','早上观塘道车龙排长。画一条新线，让一些人改坐地铁。','The morning queue on Kwun Tong Road is long. Give drivers a metro alternative.'),
      area:'kowloon-east',goal:{metric:'roadVehiclesReduced',target:100,where:{roads:['KWUN TONG ROAD','KWUN TONG BYPASS']}},
      hint:L('目標：觀塘道／觀塘繞道至少一段，每小時少 100 輛車。先連接住宅與九龍灣、觀塘站。','目标：观塘道／观塘绕道至少一段，每小时少 100 辆车。先连接住宅与九龙湾、观塘站。','Goal: at least one section on Kwun Tong Road / Bypass carries 100 fewer vehicles per hour. Connect homes to Kowloon Bay and Kwun Tong stations.')},
    {key:'northern-metro',title:L('北部都會區沒地鐵','北部都会区没地铁','A metro for the Northern Metropolis'),
      story:L('新田與古洞的家和工作離車站遠。接一條線，讓公交更方便。','新田与古洞的家和工作离车站远。接一条线，让公交更方便。','Homes and jobs near San Tin and Kwu Tung are far from stations. Link them into the railway.'),
      area:'northern-metropolis',goal:{metric:'transitSharePoints',target:3,where:{box:[54,9,82,25]}},
      hint:L('目標：框內出發人次的公交比例提高 3 個百分點（私家車＋公交口徑）。','目标：框内出发人次的公交比例提高 3 个百分点（私家车＋公交口径）。','Goal: raise the transit share of trips originating inside the box by 3 percentage points (car + transit trips).')},
    {key:'kai-tak-growth',title:L('啟德多五萬人','启德多五万人','50,000 more people in Kai Tak'),
      story:L('先用現有人口練習：在啟德附近建線，找出讓九龍東減堵最多的方案。這題尚未加入五萬人。','先用现有人口练习：在启德附近建线，找出让九龙东减堵最多的方案。这题尚未加入五万人。','Practise with today’s population: build near Kai Tak and maximise congestion relief in Kowloon East. The extra 50,000 residents are not applied yet.'),
      area:'kai-tak',goal:{metric:'areaCongestionReduced',target:100,where:{box:[95,65,111,77]}},
      hint:L('先達到九龍東塞車指標減少 100，再挑戰自己的最高紀錄。','先达到九龙东塞车指标减少 100，再挑战自己的最高纪录。','First reduce the Kowloon East congestion index by 100, then beat your personal best.')}
  ];
  root.SandboxChallenges=challenges;if(typeof module!=='undefined')module.exports=challenges;
})(typeof window!=='undefined'?window:globalThis);
