/* Add a challenge here; the UI reads this schema without a separate per-challenge handler. */
(function(root){
  const L=(hant,hans,en)=>({'zh-Hant':hant,'zh-Hans':hans,en});
  const challenges=[
    {key:'kowloon-traffic',title:L('九龍東塞車','九龙东塞车','Kowloon East traffic'),
      story:L('早上觀塘道車龍排長。畫一條新線，讓一些人改坐地鐵。','早上观塘道车龙排长。画一条新线，让一些人改坐地铁。','The morning queue on Kwun Tong Road is long. Give drivers a metro alternative.'),
      area:'kowloon-east',goal:{metric:'roadVehiclesReduced',target:100,where:{roads:['KWUN TONG ROAD','KWUN TONG BYPASS']}},
      hint:L('目標：觀塘道／觀塘繞道至少一段，每小時少 100 輛車。先連接住宅與九龍灣、觀塘站。','目标：观塘道／观塘绕道至少一段，每小时少 100 辆车。先连接住宅与九龙湾、观塘站。','Goal: at least one section on Kwun Tong Road / Bypass carries 100 fewer vehicles per hour. Connect homes to Kowloon Bay and Kwun Tong stations.')},
    // Task 63 / AM full-HK calibration: arbitrary short line 0; existing-rail duplicate 0;
    // Kwu Tung–Kam Tsin–Sheung Shui +0.310936748642228 pp (cost 23/300); north orbital +0.6589306318742211 pp (54/300).
    {key:'northern-metro',title:L('北部都會區沒地鐵','北部都会区没地铁','A metro for the Northern Metropolis'),
      story:L('新田與古洞的家和工作離車站遠。接一條線，讓公交更方便。','新田与古洞的家和工作离车站远。接一条线，让公交更方便。','Homes and jobs near San Tin and Kwu Tung are far from stations. Link them into the railway.'),
      area:'northern-metropolis',goal:{metric:'transitSharePoints',target:0.3,where:{box:[54,9,82,25]}},
      hint:L('目標：框內出發人次的公交比例提高 0.3 個百分點（私家車＋公交口徑）。','目标：框内出发人次的公交比例提高 0.3 个百分点（私家车＋公交口径）。','Goal: raise the transit share of trips originating inside the box by 0.3 percentage points (car + transit trips).')},
    {key:'kai-tak-growth',title:L('啟德多五萬人','启德多五万人','50,000 more people in Kai Tak'),
      story:L('選題即在啓德站一帶、啓德郵輪碼頭兩個模型分區，按原人口比例合計增加 50,000 人（D 假設）；退出題目還原。建線減輕九龍東塞車。','选题即在启德站一带、启德邮轮码头两个模型分区，按原人口比例合计增加 50,000 人（D 假设）；退出题目还原。建线减轻九龙东塞车。','Selecting this challenge adds 50,000 residents across the Kai Tak station and cruise terminal model zones, in proportion to their original populations (tier D assumption). Leaving restores the original scenario. Build rail to ease Kowloon East traffic.'),
      population:{zoneIds:['286.1','286.2'],additional:50000},
      area:'kai-tak',goal:{metric:'areaCongestionReduced',target:100,where:{box:[95,65,111,77]}},
      hint:L('先達到九龍東塞車指標減少 100，再挑戰自己的最高紀錄。','先达到九龙东塞车指标减少 100，再挑战自己的最高纪录。','First reduce the Kowloon East congestion index by 100, then beat your personal best.')}
  ];
  root.SandboxChallenges=challenges;if(typeof module!=='undefined')module.exports=challenges;
})(typeof window!=='undefined'?window:globalThis);
