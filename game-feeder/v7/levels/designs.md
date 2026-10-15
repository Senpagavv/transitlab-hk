# 任務57：九關設計與數字來源 / Level designs and provenance

資料快照：桌面副本內的 `v7/hk/hk-base.json`、`hk-demand-am.json`。本文件不把模型數字當實測，也不把教學空地當真實可售地。人口與崗位為底板的分區推算；格子、預算、有效運力和地塊是 D 級教學示意，僅供學習。
Source snapshot: the copied Hong Kong base and AM demand files. Zone estimates and educational scenarios are distinguished below; none of these levels is a planning forecast.

## 共用口徑 / Common conventions

- `hk-base.zones` 的 id、name/hans、cell、pop、jobs、cbd 提供地名、相對方位、人口、崗位與中心類別。原底板一格 400 m；手擺 14×9 棋盤只保留大致方位，不宣稱每一格仍等於 400 m。
- 手擺關的出門人數：逐分區加總 `hk-demand-am.pairs` 中 `car+pt`（第 3、4 欄），再乘分組比例與 `280/所選分區總出行`，四捨五入。東涌兩個大分區各等分為兩個示意子組，比例 0.5 為明示假設，並非新增統計分區。
- 手擺吸引力 `16+8×本去處崗位/所選去處最大崗位`：16 沿用切片的底值，8 是內置 m2-1 的 24 減去 16；目的在把真實崗位比例映射到相同遊戲量級。停車額外格數 `2+min(2,cbd)` 沿用切片分類假設，並非實測停車時間。
- 第三玩法由 `cut.js` 原樣選 6 個人口團、2 個崗位團及最大出框方向；人口只計入到這些去處的 car+pt，按原切片 scale 縮到約 300；吸引力保持 `16+jobs/15000`，出口以出框人數代崗位。
- 所有關卡的來源分級、教學估算與參數完整保存在 JSON 的 `source` / `level.source`；`demo` 放在 `level.demo`，因為 data.js 只把 registry 的 level 物件帶入 D。挑戰關無此欄。

## 道路精簡函數 / Reusable corridor simplifier

`bots/v7_levels_batch.js::simplifyCorridors`：按道路名合併正流量邊，取連通分支的主脊；按可玩地點覆蓋與來源車流選 10 條。把主脊之間最短的底板連接段補回，必要的接駁即使原早高峰流量為零也保留，其他零流量小段移除。所有幾何邊都來自切片，沒有直線補造道路。支線來回描一遍，既有引擎會按無向邊去重；容量採來源段容量的調和平均×切片 scale，再沿用 checker 的單一係數校準。每條來源 sectionId、連接段原道路名、容量與調整係數都列在 JSON 中。
The simplifier retains source-edge spines and the minimum source-network connectors, checks actual OD access, and never invents a road edge. One displayed corridor may include explicitly recorded short connectors.

第三玩法的有效新列車容量為 30 / 25 / 25（內置 40 的 75% / 62.5% / 62.5%），擁擠罰格 6 / 8 / 8（內置 4 的 1.5 / 2 / 2 倍），學習步長 0.1（內置 0.3 的三分一），全部是 D 級難度設定。已有鐵路全部保留，列車教學單位由 3 調到 4 / 5 / 5，維持至少原來 3×40 的總運力；這些數字不代表真實港鐵車廂或班次。

## 搜索、門檻與簡易方案 / Search and calibration

三個舊機器人在 --level 之後再次讀 mN-1，直接使用會搜索錯關。白名單不准改舊 bot，所以本批處理以既有 options 參數傳完整 level，並在 CommonJS 包裝中擷取候選；舊檔與 demo-plans.js 都不寫。第二玩法 400 次、第三玩法 18 次、第四玩法預設 60 次重啟。第三玩法另外把最強三個簡易佈局交回同一 climb/第二期程序確定性改善，避免門檻低於已知簡單方案，沒有再增加隨機重啟。
門檻為 `round(best×[0.40,0.65,0.88])`。第二玩法按舊 --write 的「最簡潔乾淨且達標／最高分」選法；第三玩法按分段內最低達標／最高分，候選包括上述簡易方案復核；第四玩法與舊 --write 相同，過關=純商場、高分=純住宅、大師=混合。因此第四玩法的示範未必停在相應門檻之下。
簡易例子固定為兩端兩站、單列車、最短 L 線、無第二期；TOD 只按檔案順序售住宅，每年兩塊。表內選同一複雜度中最接近過關線的例子，同時公布此類最高分，以免用弱例子掩蓋難度。所有示範逐操作回放，核對整數總分與每個購買／售地是否合法。

## m2-2 · 東涌·北大嶼山 / Tung Chung · North Lantau

難度遞進：新增：兩個去處分向，線路不能只穿一個中心。 入口站：東涌。初始 280 人；14×9。
Best 691; tiers 276 / 449 / 608; demo pass/high/master 285 / 473 / 691.

| 居住組 / Origin | 底板 zoneIds | 來源人口 / pop | 比例 / fraction | 原 AM car+pt | 遊戲人數 | 棋盤 cell |
| --- | --- | --- | --- | --- | --- | --- |
| 逸東邨·西 | 950S.4 | 26098 | 0.5 | 3782.4 | 45 | 1,6 |
| 逸東邨·東 | 950S.4 | 26098 | 0.5 | 3782.4 | 45 | 3,6 |
| 東涌站一帶 | 950S.3 | 42854 | 1 | 7352.6 | 88 | 5,4 |
| 裕雅苑·西 | 950S.6 | 29212 | 0.5 | 4296.7 | 51 | 9,2 |
| 裕雅苑·東 | 950S.6 | 29212 | 0.5 | 4296.7 | 51 | 12,3 |

人數比例 scale=0.011909。原 AM 分母=23510.8；最大去處崗位=37982。

| 去處 / Destination | zoneIds / target | 來源崗位或出框當量 | 吸引力 / attraction | carExtra | cell |
| --- | --- | --- | --- | --- | --- |
| 東涌市中心 | 950S.3 | 37982 | 24 | 2 | 6,5 |
| 機場就業區 | 950S.1 | 34415 | 23.248697 | 2 | 3,0 |

| 參數 / Parameter | 數值 / Value | 出處 / Source |
| --- | --- | --- |
| cols | 14 | 手擺示意 / cut box |
| rows | 9 | 手擺示意 / cut box |
| walkPer | 2 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| nearby | 10 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| stay | 40 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| wait | 2 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| lineCost | 1 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| stationCost | 3 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| trainCost | 4 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| perTrain | 40 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| budget | 38 | D 級教學預算；按關卡遞減 |
| years | 8 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| crowdBlocks | 4 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| aware | {"start":0.2,"spread":2} | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| tiers | [276,449,608] | 本關 bot 最好分×0.40/0.65/0.88，四捨五入 |

圖示偏移 house、手擺 cell、空地 cell 均為 D 級排版/教學設定；來源底板位置可由 zoneIds 回查。

## m2-3 · 將軍澳南·日出康城 / Tseung Kwan O South · LOHAS Park

難度遞進：承接分向去處；再新增：三個中心、東南大客源與較緊預算。 入口站：康城。初始 279 人；14×9。
Best 1016; tiers 406 / 660 / 894; demo pass/high/master 440 / 700 / 1016.

| 居住組 / Origin | 底板 zoneIds | 來源人口 / pop | 比例 / fraction | 原 AM car+pt | 遊戲人數 | 棋盤 cell |
| --- | --- | --- | --- | --- | --- | --- |
| 健明邨 | 833.4 | 14398 | 1 | 2577.9 | 28 | 1,4 |
| 將軍澳中心 | 838.5 | 13508 | 1 | 2448.6 | 27 | 4,5 |
| 怡明邨 | 838.4 | 22996 | 1 | 4306.5 | 47 | 7,4 |
| 清水灣半島 | 838.3 | 5246 | 1 | 910.9 | 10 | 9,3 |
| 康城站一帶 | 839.1 | 70340 | 1 | 15148.9 | 167 | 12,7 |

人數比例 scale=0.011027。原 AM 分母=25392.8；最大去處崗位=27420。

| 去處 / Destination | zoneIds / target | 來源崗位或出框當量 | 吸引力 / attraction | carExtra | cell |
| --- | --- | --- | --- | --- | --- |
| 將軍澳市中心 | 838.1 | 11309 | 19.299489 | 4 | 5,3 |
| 康城商業區 | 839.1 | 27420 | 24 | 2 | 11,7 |
| 坑口商業區 | 837.1 | 3441 | 17.003939 | 2 | 9,0 |

| 參數 / Parameter | 數值 / Value | 出處 / Source |
| --- | --- | --- |
| cols | 14 | 手擺示意 / cut box |
| rows | 9 | 手擺示意 / cut box |
| walkPer | 2 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| nearby | 10 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| stay | 40 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| wait | 2 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| lineCost | 1 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| stationCost | 3 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| trainCost | 4 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| perTrain | 40 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| budget | 35 | D 級教學預算；按關卡遞減 |
| years | 8 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| crowdBlocks | 4 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| aware | {"start":0.2,"spread":2} | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| tiers | [406,660,894] | 本關 bot 最好分×0.40/0.65/0.88，四捨五入 |

圖示偏移 house、手擺 cell、空地 cell 均為 D 級排版/教學設定；來源底板位置可由 zoneIds 回查。

## m2-4 · 北部都會區·新田古洞 / Northern Metropolis · San Tin and Kwu Tung

難度遞進：組合：三個分離中心、稀疏客源、最緊預算；白地只代表沒有預畫新線，沒有虛構未來人口。 入口站：落馬洲。初始 280 人；14×9。
Best 676; tiers 270 / 439 / 595; challenge, no demo.

| 居住組 / Origin | 底板 zoneIds | 來源人口 / pop | 比例 / fraction | 原 AM car+pt | 遊戲人數 | 棋盤 cell |
| --- | --- | --- | --- | --- | --- | --- |
| 落馬洲站一帶 | 542 | 11183 | 1 | 1513 | 84 | 1,3 |
| 攸潭尾村 | 543S | 5000 | 1 | 720.9 | 40 | 3,7 |
| 河上鄉 | 545 | 4854 | 1 | 226.7 | 13 | 7,1 |
| 古洞 | 548S | 1287 | 1 | 67.7 | 4 | 9,2 |
| 東塘新村 | 547 | 14533 | 1 | 2497.8 | 139 | 11,6 |

人數比例 scale=0.055709。原 AM 分母=5026.1；最大去處崗位=10750。

| 去處 / Destination | zoneIds / target | 來源崗位或出框當量 | 吸引力 / attraction | carExtra | cell |
| --- | --- | --- | --- | --- | --- |
| 落馬洲就業區 | 542 | 3417 | 18.542884 | 2 | 1,0 |
| 上水商貿區 | 624S.3 | 9399 | 22.994605 | 2 | 13,4 |
| 彩蒲苑商業區 | 626 | 10750 | 24 | 2 | 10,8 |

| 參數 / Parameter | 數值 / Value | 出處 / Source |
| --- | --- | --- |
| cols | 14 | 手擺示意 / cut box |
| rows | 9 | 手擺示意 / cut box |
| walkPer | 2 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| nearby | 10 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| stay | 40 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| wait | 2 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| lineCost | 1 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| stationCost | 3 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| trainCost | 4 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| perTrain | 40 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| budget | 32 | D 級教學預算；按關卡遞減 |
| years | 8 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| crowdBlocks | 4 | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| aware | {"start":0.2,"spread":2} | 沿用 levels/examples/m2-1.json 或同玩法 engine.js 預設 |
| tiers | [270,439,595] | 本關 bot 最好分×0.40/0.65/0.88，四捨五入 |

圖示偏移 house、手擺 cell、空地 cell 均為 D 級排版/教學設定；來源底板位置可由 zoneIds 回查。

## m3-2 · 沙田·大圍 / Sha Tin · Tai Wai

難度遞進：新增：南北通勤與河兩岸接駁；第二期要把通道補完整。 入口站：大圍。初始 300 人；16×12。
Best 1209; tiers 484 / 786 / 1064; demo pass/high/master 512 / 797 / 1209.

| 居住組 / Origin | 底板 zoneIds | 來源人口 / pop | 比例 / fraction | 原 AM car+pt | 遊戲人數 | 棋盤 cell |
| --- | --- | --- | --- | --- | --- | --- |
| 隆亨邨 | 759.7, 759.3, 759.6 | 61809 | 1 | 6426.1 | 67 | 6,10 |
| 美田邨 | 731S.3, 731S.2 | 55027 | 1 | 5547.5 | 58 | 5,7 |
| 第一城站一帶 | 756S.1, 755.2 | 45164 | 1 | 5000.5 | 52 | 12,6 |
| 水泉澳邨 | 755.3, 755.1 | 43069 | 1 | 4240.7 | 44 | 11,9 |
| 乙明邨 | 755.4, 759.1 | 35774 | 1 | 3692 | 39 | 9,8 |
| 沙田站一帶 | 758.1, 758.3 | 35110 | 1 | 3851.6 | 40 | 8,6 |

人數比例 scale=0.010432。分母與出框方向見 cutNotes；來源人數先加總後取整。

| 去處 / Destination | zoneIds / target | 來源崗位或出框當量 | 吸引力 / attraction | carExtra | cell |
| --- | --- | --- | --- | --- | --- |
| 石門站一帶 | 756S.2 | 28679 | 17.911933 | 2 | 13,3 |
| 穗禾苑 | 732S.3 | 22171 | 17.478067 | 2 | 8,2 |
| 往南面 | 121S | 25123 | 17.674893 | 2 | 8,11 |

| 參數 / Parameter | 數值 / Value | 出處 / Source |
| --- | --- | --- |
| cols | 16 | 手擺示意 / cut box |
| rows | 12 | 手擺示意 / cut box |
| walkPer | 3 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| wait | 2 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| lineCost | 1 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| stationCost | 3 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| trainCost | 4 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| perTrain | 30 | D 級 operatingScenario（上文列原值與倍率） |
| budget | 24 | D 級教學預算；按關卡遞減 |
| phase2Budget | 12 | D 級教學預算；按關卡遞減 |
| years | 8 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| crowdBlocks | 6 | D 級 operatingScenario（上文列原值與倍率） |
| aware | {"start":0.2,"spread":2} | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| nearby | 10 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| stay | 40 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| learn | 0.1 | D 級 operatingScenario（上文列原值與倍率） |
| tiers | [484,786,1064] | 本關 bot 最好分×0.40/0.65/0.88，四捨五入 |

圖示偏移 house、手擺 cell、空地 cell 均為 D 級排版/教學設定；來源底板位置可由 zoneIds 回查。切片坐標由原 box 85,46,101,58 平移；source.simplification.moves=[]

| 走廊 / Corridor | 原容量調和均值 | 遊戲 cap | 來源 sectionIds | 逐格 via（來源邊） |
| --- | --- | --- | --- | --- |
| 獅子山隧道公路 | 3512.978204 | 18.323228 | 1210,1264,1330,1396,1397,1442,1208 | 8,7 → 7,7 → 8,7 → 8,8 → 8,9 → 8,10 → 7,10 → 7,11 → 6,11 |
| SHA LEK HIGHWAY | 11024.529688 | 57.502485 | 1162,1163,1217,1215,1216 | 14,6 → 13,6 → 13,7 → 12,7 → 11,7 → 11,8 |
| TATE'S CAIRN HIGHWAY | 7651.868156 | 39.911129 | 976,1001,1002,1028,1054,1084,1117,1165,1219 | 15,0 → 15,1 → 14,1 → 14,2 → 14,3 → 14,4 → 14,5 → 14,6 → 14,7 → 14,8 |
| TSING SHA HIGHWAY | 8583.848348 | 44.772214 | 1206,1204,1205,1258,1321,1322,1388,1389,1437 | 7,7 → 6,7 → 5,7 → 5,8 → 5,9 → 4,9 → 4,10 → 3,10 → 3,11 → 2,11 |
| 火炭路 | 3994.51953 | 20.834884 | 995,1022,1025 | 9,1 → 9,2 → 10,2 → 10,3 |
| TAI PO ROAD - SHA TIN | 6574.314647 | 34.290753 | 973,974,1000,1026,1027,1049 | 13,0 → 12,0 → 12,1 → 12,2 → 11,2 → 11,3 → 10,3 |
| 大涌橋路 | 4807.228916 | 25.073868 | 1110,1111,1157,1211,1212,1263,1213 | 11,5 → 10,5 → 10,6 → 10,7 → 11,7 → 10,7 → 9,7 → 9,8 → 8,8 |
| SHA TIN ROAD | 9361.968313 | 48.830785 | 1051,1079,1112,1115 | 11,3 → 11,4 → 11,5 → 12,5 → 12,6 |
| 大老山隧道 | 3410.89838 | 17.790794 | 1270,1271,1333,1398 | 15,8 → 14,8 → 14,9 → 14,10 → 14,11 |
| SHING MUN TUNNEL ROAD | 4700 | 24.514577 | 1148,1150,1151,1152 | 2,6 → 3,6 → 4,6 → 5,6 → 5,7 |

容量全局係數 0.5；接駁段：[{"corridor":"獅子山隧道公路","via":[[8,7],[7,7]],"sourceRoads":["SHING MUN TUNNEL ROAD"],"sectionIds":["1208"]},{"corridor":"大涌橋路","via":[[10,7],[11,7]],"sourceRoads":["沙田圍路"],"sectionIds":["1213"]}]。
已有鐵路：東鐵綫 大圍→沙田→火炭，4 教學列車單位（原 3×40）；屯馬綫 顯徑→大圍→車公廟→沙田圍→第一城→石門，4 教學列車單位（原 3×40）。
不建線 Y1–Y8 塞車：338.531126 / 338.531117 / 338.53111 / 338.531104 / 338.531098 / 338.531093 / 338.531089 / 338.531085。
切片模型與精簡遊戲的道路排名診斷：{"sections":58,"spearman":-0.342,"modelTop":[{"name":"獅子山隧道公路","vc":1.5},{"name":"TATE'S CAIRN HIGHWAY","vc":1.3},{"name":"TAI PO ROAD - SHA TIN","vc":1.1},{"name":"大老山隧道","vc":1.1},{"name":"TSING SHA HIGHWAY","vc":0.7},{"name":"火炭路","vc":0.6},{"name":"SHING MUN TUNNEL ROAD","vc":0.6}],"gameTop":[{"name":"獅子山隧道公路","vc":1.68},{"name":"火炭路","vc":0.77},{"name":"大涌橋路","vc":0.77},{"name":"TATE'S CAIRN HIGHWAY","vc":0.68},{"name":"SHA LEK HIGHWAY","vc":0.47},{"name":"TAI PO ROAD - SHA TIN","vc":0.47},{"name":"SHA TIN ROAD","vc":0.33}]}。此診斷不是全模型校準驗收；來源中有穿境流量，縮成少量屋苑之後不能保證 v/c 排名一致。

## m3-3 · 荃灣·葵青 / Tsuen Wan · Kwai Tsing

難度遞進：承接兩期投資；再新增：青衣與葵青支路、分離客源及更緊首期預算。 入口站：葵芳。初始 301 人；16×12。
Best 1253; tiers 501 / 814 / 1103; demo pass/high/master 546 / 828 / 1253.

| 居住組 / Origin | 底板 zoneIds | 來源人口 / pop | 比例 / fraction | 原 AM car+pt | 遊戲人數 | 棋盤 cell |
| --- | --- | --- | --- | --- | --- | --- |
| 青衣轉車站 - 長安邨 | 351.2, 350.1, 351.3 | 99719 | 1 | 10419.3 | 72 | 4,11 |
| 葵芳邨 | 326.8, 326.6, 326.7, 326.9, 326.2 | 90671 | 1 | 9980.3 | 69 | 11,9 |
| 荃灣西站一帶 | 320S.2, 320S.1 | 64222 | 1 | 8187.9 | 56 | 7,7 |
| 梨木樹邨 | 327.2, 327.5 | 51758 | 1 | 4884.3 | 34 | 14,7 |
| 尚翠苑 | 320S.6, 320S.7 | 49055 | 1 | 6156.6 | 42 | 8,8 |
| 大窩口邨 | 326.3, 326.4 | 38125 | 1 | 4003.2 | 28 | 9,8 |

人數比例 scale=0.006876。分母與出框方向見 cutNotes；來源人數先加總後取整。

| 去處 / Destination | zoneIds / target | 來源崗位或出框當量 | 吸引力 / attraction | carExtra | cell |
| --- | --- | --- | --- | --- | --- |
| 荃灣西站一帶 | 320S.2, 323.1 | 56889 | 19.7926 | 2 | 6,7 |
| 尚翠苑 | 320S.6, 320S.1, 326.3 | 54298 | 19.619867 | 2 | 8,8 |
| 往南面 | 121S | 34114 | 18.27428 | 2 | 8,11 |

| 參數 / Parameter | 數值 / Value | 出處 / Source |
| --- | --- | --- |
| cols | 16 | 手擺示意 / cut box |
| rows | 12 | 手擺示意 / cut box |
| walkPer | 3 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| wait | 2 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| lineCost | 1 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| stationCost | 3 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| trainCost | 4 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| perTrain | 25 | D 級 operatingScenario（上文列原值與倍率） |
| budget | 21 | D 級教學預算；按關卡遞減 |
| phase2Budget | 12 | D 級教學預算；按關卡遞減 |
| years | 8 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| crowdBlocks | 8 | D 級 operatingScenario（上文列原值與倍率） |
| aware | {"start":0.2,"spread":2} | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| nearby | 10 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| stay | 40 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| learn | 0.1 | D 級 operatingScenario（上文列原值與倍率） |
| tiers | [501,814,1103] | 本關 bot 最好分×0.40/0.65/0.88，四捨五入 |

圖示偏移 house、手擺 cell、空地 cell 均為 D 級排版/教學設定；來源底板位置可由 zoneIds 回查。切片坐標由原 box 67,48,83,60 平移；source.simplification.moves=[]

| 走廊 / Corridor | 原容量調和均值 | 遊戲 cap | 來源 sectionIds | 逐格 via（來源邊） |
| --- | --- | --- | --- | --- |
| TSUEN WAN ROAD | 9568.098384 | 46.051501 | 1245,1304,1306,1373,1375,1423,1426,1476,1479,1515 | 5,6 → 5,7 → 6,7 → 6,8 → 7,8 → 7,9 → 8,9 → 8,10 → 9,10 → 9,11 → 10,11 |
| TSING TSUEN ROAD | 3939.711552 | 18.961932 | 1424,1473,1471,1469 | 7,9 → 7,10 → 6,10 → 5,10 → 4,10 |
| 德士古道 | 4717.702762 | 22.706423 | 1312,1379,1425 | 9,7 → 9,8 → 9,9 → 8,9 |
| 興芳路 | 5242.34691 | 25.231549 | 1480,1481 | 11,10 → 10,10 → 10,11 |
| 和宜合道 | 2683.509357 | 12.915799 | 1144,1196,1253,1319,1386 | 13,4 → 13,5 → 13,6 → 13,7 → 13,8 → 13,9 |
| CHEUNG PEI SHAN ROAD | 6985.131974 | 33.619618 | 1145,1143,1141,1142,1194,1192,1193,1251,1249,1248,1246 | 14,5 → 14,4 → 13,4 → 12,4 → 12,5 → 11,5 → 10,5 → 10,6 → 9,6 → 8,6 → 7,6 → 6,6 |
| 荃錦公路 | 850 | 4.091072 | 1019,1020,1045,1072,1073,1104,1105,1137,1138,1189,1191 | 5,0 → 4,0 → 4,1 → 4,2 → 5,2 → 5,3 → 6,3 → 6,4 → 7,4 → 7,5 → 8,5 → 8,6 |
| 屯門公路 | 5432.571091 | 26.147103 | 1242,1243,1301,1300,1298,1299,1370 | 5,6 → 4,6 → 4,7 → 3,7 → 2,7 → 1,7 → 1,8 → 0,8 |
| 葵涌道 | 6113.456001 | 29.424219 | 1384,1434,1482,1483 | 12,8 → 12,9 → 12,10 → 11,10 → 11,11 |
| CASTLE PEAK ROAD - KWAI CHUNG | 2006.985667 | 9.659673 | 1433,1436,1484,1485 | 12,9 → 13,9 → 13,10 → 12,10 → 12,11 |

容量全局係數 0.7；接駁段：[]。
已有鐵路：荃灣綫 葵芳→葵興→大窩口→荃灣，5 教學列車單位（原 3×40）。
不建線 Y1–Y8 塞車：699.434122 / 699.434119 / 699.434115 / 699.434112 / 699.43411 / 699.434107 / 699.434105 / 699.434103。
切片模型與精簡遊戲的道路排名診斷：{"sections":61,"spearman":-0.149,"modelTop":[{"name":"CASTLE PEAK ROAD - KWAI CHUNG","vc":1.1},{"name":"屯門公路","vc":0.9},{"name":"TSUEN WAN ROAD","vc":0.8},{"name":"TSING TSUEN ROAD","vc":0.6},{"name":"荃錦公路","vc":0.6},{"name":"德士古道","vc":0.5},{"name":"CHEUNG PEI SHAN ROAD","vc":0.5}],"gameTop":[{"name":"TSUEN WAN ROAD","vc":1.72},{"name":"TSING TSUEN ROAD","vc":1.21},{"name":"興芳路","vc":1.18},{"name":"CASTLE PEAK ROAD - KWAI CHUNG","vc":0.55},{"name":"和宜合道","vc":0.48},{"name":"德士古道","vc":0.47},{"name":"CHEUNG PEI SHAN ROAD","vc":0.19}]}。此診斷不是全模型校準驗收；來源中有穿境流量，縮成少量屋苑之後不能保證 v/c 排名一致。

## m3-4 · 銅鑼灣·灣仔 / Causeway Bay · Wan Chai

難度遞進：組合：三個去處、既有多線轉乘、跨海出口與最緊兩期預算；沒有示範。 入口站：銅鑼灣。初始 299 人；16×12。
Best 540; tiers 216 / 351 / 475; challenge, no demo.

| 居住組 / Origin | 底板 zoneIds | 來源人口 / pop | 比例 / fraction | 原 AM car+pt | 遊戲人數 | 棋盤 cell |
| --- | --- | --- | --- | --- | --- | --- |
| 新時代廣場 | 153.2, 153.1, 151.3 | 55883 | 1 | 4964.5 | 52 | 11,3 |
| 灣仔站一帶 | 131, 132 | 39647 | 1 | 7223.7 | 76 | 6,7 |
| 健威花園 | 153.4, 154, 153.3 | 30961 | 1 | 2624.3 | 28 | 13,3 |
| 嘉富麗苑 | 142.1, 114, 122 | 29158 | 1 | 4481.2 | 47 | 0,6 |
| 炮台山站一帶 | 151.1, 151.2 | 28180 | 1 | 2882 | 30 | 10,4 |
| 紅磡站一帶 | 213S, 245.3, 217 | 27868 | 1 | 6195.7 | 66 | 9,0 |

人數比例 scale=0.010574。分母與出框方向見 cutNotes；來源人數先加總後取整。

| 去處 / Destination | zoneIds / target | 來源崗位或出框當量 | 吸引力 / attraction | carExtra | cell |
| --- | --- | --- | --- | --- | --- |
| 中環站一帶 | 121S, 143 | 220289 | 30.685933 | 4 | 2,7 |
| 銅鑼灣站一帶 | 146S, 134S, 132, 133 | 206361 | 29.7574 | 3 | 7,6 |
| 往九龍 | 251S | 15115 | 17.007673 | 2 | 8,0 |

| 參數 / Parameter | 數值 / Value | 出處 / Source |
| --- | --- | --- |
| cols | 16 | 手擺示意 / cut box |
| rows | 12 | 手擺示意 / cut box |
| walkPer | 3 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| wait | 2 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| lineCost | 1 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| stationCost | 3 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| trainCost | 4 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| perTrain | 25 | D 級 operatingScenario（上文列原值與倍率） |
| budget | 18 | D 級教學預算；按關卡遞減 |
| phase2Budget | 10 | D 級教學預算；按關卡遞減 |
| years | 8 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| crowdBlocks | 8 | D 級 operatingScenario（上文列原值與倍率） |
| aware | {"start":0.2,"spread":2} | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| nearby | 10 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| stay | 40 | 沿用 levels/examples/m3-1.json 或同玩法 engine.js 預設 |
| learn | 0.1 | D 級 operatingScenario（上文列原值與倍率） |
| tiers | [216,351,475] | 本關 bot 最好分×0.40/0.65/0.88，四捨五入 |

圖示偏移 house、手擺 cell、空地 cell 均為 D 級排版/教學設定；來源底板位置可由 zoneIds 回查。切片坐標由原 box 84,74,100,86 平移；source.simplification.moves=[]

| 走廊 / Corridor | 原容量調和均值 | 遊戲 cap | 來源 sectionIds | 逐格 via（來源邊） |
| --- | --- | --- | --- | --- |
| CENTRAL-WAN CHAI BYPASS TUNNEL | 7123.08977 | 112.979634 | 2491,2492,2546,2544,2545,2493,2446,2445 | 9,4 → 10,4 → 10,3 → 11,3 → 10,3 → 10,4 → 9,4 → 8,4 → 8,5 → 7,5 → 6,5 → 6,6 |
| ISLAND EASTERN CORRIDOR | 8188.932829 | 129.885017 | 2447,2402,2401,2403,2405,2451,2454 | 11,3 → 12,3 → 12,2 → 13,2 → 14,2 → 14,3 → 15,3 → 15,4 |
| CONNAUGHT ROAD CENTRAL | 15472.09646 | 245.40359 | 2533,2536,2599 | 0,5 → 1,5 → 1,6 → 2,6 |
| HUNG HOM BYPASS | 5478.30064 | 86.891563 | 2315,2316,2356 | 9,0 → 8,0 → 8,1 → 7,1 |
| CROSS HARBOUR TUNNEL | 4151.228733 | 65.842818 | 2314,2357,2400,2443,2444 | 7,0 → 7,1 → 7,2 → 7,3 → 8,3 → 8,4 |
| 告士打道 | 24385.615405 | 386.781299 | 2605,2607,2609,2611 | 4,6 → 5,6 → 6,6 → 7,6 → 8,6 |
| 維園道 | 32103.119713 | 509.188967 | 2548,2549 | 9,5 → 8,5 → 8,6 |
| 梳士巴利道 | 8097.111923 | 128.428642 | 2354,2355,2398 | 7,1 → 6,1 → 6,2 → 5,2 |
| 夏慤道 | 16453.085194 | 260.963094 | 2601,2603 | 2,6 → 3,6 → 4,6 |
| 九龍公園徑 | 7031.311089 | 111.523929 | 2351,2397 | 4,1 → 4,2 → 5,2 |

容量全局係數 1.5；接駁段：[{"corridor":"CENTRAL-WAN CHAI BYPASS TUNNEL","via":[[9,4],[10,4],[10,3],[11,3]],"sourceRoads":["ISLAND EASTERN CORRIDOR","未命名道路"],"sectionIds":["2493","2446","2445"]}]。
已有鐵路：東鐵綫 金鐘→會展→紅磡，5 教學列車單位（原 3×40）；荃灣綫 中環→金鐘→尖沙咀，5 教學列車單位（原 3×40）；港島綫 鰂魚涌→北角→炮台山→天后→銅鑼灣→灣仔→金鐘→中環→上環，5 教學列車單位（原 3×40）；將軍澳綫 北角→鰂魚涌，5 教學列車單位（原 3×40）；屯馬綫 柯士甸→尖東→紅磡，5 教學列車單位（原 3×40）。
不建線 Y1–Y8 塞車：184.770122 / 184.770074 / 184.770032 / 184.769994 / 184.769962 / 184.769933 / 184.769908 / 184.769885。
切片模型與精簡遊戲的道路排名診斷：{"sections":39,"spearman":0.397,"modelTop":[{"name":"CROSS HARBOUR TUNNEL","vc":1.3},{"name":"ISLAND EASTERN CORRIDOR","vc":1.2},{"name":"CENTRAL-WAN CHAI BYPASS TUNNEL","vc":0.9},{"name":"九龍公園徑","vc":0.5},{"name":"告士打道","vc":0.3},{"name":"梳士巴利道","vc":0.3},{"name":"CONNAUGHT ROAD CENTRAL","vc":0.2}],"gameTop":[{"name":"CENTRAL-WAN CHAI BYPASS TUNNEL","vc":0.65},{"name":"CROSS HARBOUR TUNNEL","vc":0.54},{"name":"夏慤道","vc":0.41},{"name":"HUNG HOM BYPASS","vc":0.41},{"name":"告士打道","vc":0.28},{"name":"CONNAUGHT ROAD CENTRAL","vc":0.15},{"name":"ISLAND EASTERN CORRIDOR","vc":0.07}]}。此診斷不是全模型校準驗收；來源中有穿境流量，縮成少量屋苑之後不能保證 v/c 排名一致。

## m4-2 · 古洞北·兩端開發 / Kwu Tung North · two development nodes

難度遞進：新增：空地分成兩端，不是把站全放在一個開發團就足夠。 入口站：上水。初始 280 人；14×9。
Best 2513; tiers 1005 / 1633 / 2211; demo pass/high/master 1624 / 1798 / 2513.

| 居住組 / Origin | 底板 zoneIds | 來源人口 / pop | 比例 / fraction | 原 AM car+pt | 遊戲人數 | 棋盤 cell |
| --- | --- | --- | --- | --- | --- | --- |
| 河上鄉 | 545 | 4854 | 1 | 226.7 | 9 | 1,2 |
| 古洞 | 548S | 1287 | 1 | 67.7 | 3 | 3,2 |
| 金錢 | 623 | 4469 | 1 | 626.7 | 26 | 6,2 |
| 鳳溪第一中學 | 624S.2 | 7535 | 1 | 1097.6 | 45 | 9,4 |
| 彩蒲苑 | 626 | 28250 | 1 | 4762 | 197 | 11,7 |

人數比例 scale=0.041294。原 AM 分母=6780.7；最大去處崗位=9399。

| 去處 / Destination | zoneIds / target | 來源崗位或出框當量 | 吸引力 / attraction | carExtra | cell |
| --- | --- | --- | --- | --- | --- |
| 上水商貿區 | 624S.3 | 9399 | 24 | 2 | 11,4 |
| 上水市中心 | 624S.1 | 7117 | 22.057666 | 2 | 13,6 |

| 參數 / Parameter | 數值 / Value | 出處 / Source |
| --- | --- | --- |
| cols | 14 | 手擺示意 / cut box |
| rows | 9 | 手擺示意 / cut box |
| walkPer | 2 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| nearby | 10 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| stay | 40 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| wait | 2 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| lineCost | 1 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| stationCost | 3 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| trainCost | 4 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| perTrain | 40 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| budget | 38 | D 級教學預算；按關卡遞減 |
| years | 8 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| crowdBlocks | 4 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| aware | {"start":0.2,"spread":2} | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| homePeople | 16 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| shopBase | 4 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| shopPer | 6 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| carExtra | 5 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| homeRate | 3 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| shopRate | 0.5 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| tiers | [1005,1633,2211] | 本關 bot 最好分×0.40/0.65/0.88，四捨五入 |

圖示偏移 house、手擺 cell、空地 cell 均為 D 級排版/教學設定；來源底板位置可由 zoneIds 回查。

空地 / schematic vacant cells：2,1；3,1；4,1；2,3；4,3；7,2；8,2；6,4；8,4；10,3；11,3；12,3；10,5；12,5。已排除屋苑與去處的佔用格；這些不是實際地籍或政府賣地清單。

## m4-3 · 東涌東·分期賣地 / Tung Chung East · phased land sales

難度遞進：承接分散地塊；再新增：三個去處、運力與售地時序同時受限。 入口站：東涌。初始 280 人；14×9。
Best 1468; tiers 587 / 954 / 1292; demo pass/high/master 1197 / 1406 / 1468.

| 居住組 / Origin | 底板 zoneIds | 來源人口 / pop | 比例 / fraction | 原 AM car+pt | 遊戲人數 | 棋盤 cell |
| --- | --- | --- | --- | --- | --- | --- |
| 逸東邨·西 | 950S.4 | 26098 | 0.5 | 3782.4 | 45 | 1,6 |
| 逸東邨·東 | 950S.4 | 26098 | 0.5 | 3782.4 | 45 | 3,6 |
| 東涌站一帶 | 950S.3 | 42854 | 1 | 7352.6 | 88 | 5,4 |
| 裕雅苑·西 | 950S.6 | 29212 | 0.5 | 4296.7 | 51 | 9,2 |
| 裕雅苑·東 | 950S.6 | 29212 | 0.5 | 4296.7 | 51 | 12,3 |

人數比例 scale=0.011909。原 AM 分母=23510.8；最大去處崗位=37982。

| 去處 / Destination | zoneIds / target | 來源崗位或出框當量 | 吸引力 / attraction | carExtra | cell |
| --- | --- | --- | --- | --- | --- |
| 東涌市中心 | 950S.3 | 37982 | 24 | 2 | 5,5 |
| 機場就業區 | 950S.1 | 34415 | 23.248697 | 2 | 2,0 |
| 東涌東商業區 | 950S.6 | 13454 | 18.833763 | 2 | 12,2 |

| 參數 / Parameter | 數值 / Value | 出處 / Source |
| --- | --- | --- |
| cols | 14 | 手擺示意 / cut box |
| rows | 9 | 手擺示意 / cut box |
| walkPer | 2 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| nearby | 10 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| stay | 40 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| wait | 2 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| lineCost | 1 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| stationCost | 3 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| trainCost | 4 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| perTrain | 40 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| budget | 35 | D 級教學預算；按關卡遞減 |
| years | 8 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| crowdBlocks | 4 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| aware | {"start":0.2,"spread":2} | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| homePeople | 16 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| shopBase | 4 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| shopPer | 6 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| carExtra | 5 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| homeRate | 3 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| shopRate | 0.5 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| tiers | [587,954,1292] | 本關 bot 最好分×0.40/0.65/0.88，四捨五入 |

圖示偏移 house、手擺 cell、空地 cell 均為 D 級排版/教學設定；來源底板位置可由 zoneIds 回查。

空地 / schematic vacant cells：1,4；2,4；3,4；5,3；6,3；7,3；7,5；9,1；10,1；11,1；9,3；11,3；11,5。已排除屋苑與去處的佔用格；這些不是實際地籍或政府賣地清單。

## m4-4 · 洪水橋全區·鐵路與物業 / Hung Shui Kiu · district-wide rail and property

難度遞進：組合：三片地塊、六個客源、三個中心、最緊預算；不能靠只賣一種用途拿滿分。 入口站：洪水橋。初始 280 人；14×9。
Best 1686; tiers 674 / 1096 / 1484; challenge, no demo.

| 居住組 / Origin | 底板 zoneIds | 來源人口 / pop | 比例 / fraction | 原 AM car+pt | 遊戲人數 | 棋盤 cell |
| --- | --- | --- | --- | --- | --- | --- |
| 廈村 | 511 | 8205 | 1 | 1450.5 | 26 | 1,2 |
| 洪水橋站一帶 | 515 | 29076 | 1 | 5408.2 | 96 | 6,3 |
| 鍾屋村站一帶 | 512 | 11570 | 1 | 1929 | 34 | 5,7 |
| 坑尾村站一帶 | 517 | 7903 | 1 | 1472.4 | 26 | 12,2 |
| 唐人新村 | 519 | 21472 | 1 | 4192.7 | 75 | 10,7 |
| 藍地站一帶 | 442 | 7459 | 1 | 1269 | 23 | 1,8 |

人數比例 scale=0.01781。原 AM 分母=15721.8；最大去處崗位=12966。

| 去處 / Destination | zoneIds / target | 來源崗位或出框當量 | 吸引力 / attraction | carExtra | cell |
| --- | --- | --- | --- | --- | --- |
| 洪水橋商貿區 | 515 | 8490 | 21.238316 | 2 | 6,4 |
| 橫洲就業區 | 528 | 12966 | 24 | 2 | 13,0 |
| 唐人新村商業區 | 519 | 7467 | 20.607126 | 2 | 11,8 |

| 參數 / Parameter | 數值 / Value | 出處 / Source |
| --- | --- | --- |
| cols | 14 | 手擺示意 / cut box |
| rows | 9 | 手擺示意 / cut box |
| walkPer | 2 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| nearby | 10 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| stay | 40 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| wait | 2 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| lineCost | 1 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| stationCost | 3 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| trainCost | 4 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| perTrain | 40 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| budget | 32 | D 級教學預算；按關卡遞減 |
| years | 8 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| crowdBlocks | 4 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| aware | {"start":0.2,"spread":2} | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| homePeople | 16 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| shopBase | 4 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| shopPer | 6 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| carExtra | 5 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| homeRate | 3 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| shopRate | 0.5 | 沿用 levels/examples/m4-1.json 或同玩法 engine.js 預設 |
| tiers | [674,1096,1484] | 本關 bot 最好分×0.40/0.65/0.88，四捨五入 |

圖示偏移 house、手擺 cell、空地 cell 均為 D 級排版/教學設定；來源底板位置可由 zoneIds 回查。

空地 / schematic vacant cells：1,1；2,1；3,1；1,3；3,3；5,1；6,1；7,1；5,3；7,3；9,3；10,3；11,3；9,5；11,5；4,6；5,6；6,6。已排除屋苑與去處的佔用格；這些不是實際地籍或政府賣地清單。

