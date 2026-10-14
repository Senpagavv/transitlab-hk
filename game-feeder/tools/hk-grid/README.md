# 任务51交付说明

已完成：全港400米底板、早高峰、核对、离线查看页；晚高峰、平峰、节假日。

## 重算

使用项目现有 Python，开启 -B 禁止写入字节码；脚本只在自身上级任务51目录写文件。运行：
F:/transitlab-hk/.venv/Scripts/python.exe -B C:/Users/赵禹博/Desktop/TransitLab五模式-Codex/任务51/scripts/build_hk_grid.py
可加 --am-only 只生成底板与早高峰。源项目未修改，未运行 pipeline 脚本入口，未做 git 操作，未联网。get_base 按任务书许可导入模型模块。

## 口径与接口

- 400米，HK1980 / EPSG:2326，x0=800000、y_top=848000、160列×120行。完整覆盖10米土地栅格；东侧最后250米补海。人口岗位50米格边缘补零后8×8相加，按最大余数取整，保持全港总数。
- land取400米格内地类面积最多者；若水域占多数但有模型人口/岗位且本格确有非水地类，改取格内面积最大的非水类，保护海岸窄条建筑。山林与灌丛等映射 ^，非行政意义的郊野公园边界；住宅r、商业c、工业i、机构及其他已建o、港口机场p、交通o、农业及空地.；缺少格级混合用途标签，此版未单独标m。图形为粗尺度简化。
- zones.cell 用50米人口权重、没人则岗位权重的空间重心，再选本区有人/岗位的最近400米格。pop/jobs由trip-ends分区数采用最大余数取整，分区合计与格子合计及模型一致；未沿用pl.zones对岗位的截尾整数。zone_index为新增行优先数组，值为 zones 下标，-1表示中心点不在分区内；查看页使用。
- zones.en 无可靠分区英文标签，写 null；中文标签从模型继承，hans 用本地 OpenCC 转换。district保留项目区名并转换为繁体；name也是繁体，hans为简体。
- cbd 为C级游戏分类：按办公GFA/区面积，正值样本第90百分位以上=2，第75百分位以上=1，其余=0。阈值由数据计算，分类阈值选择属启发式，不代表官方CBD。{"office_gfa_density_q75": 821176.2, "office_gfa_density_q90": 1599073}
- stations.id 为GTFS母站ID；xy来自项目GTFS的HK1980坐标。重铁97站，含机场快线，不含轻铁。冲突/海格移到真实坐标最近的非海空格。
- lines.stations 为GTFS相邻站的真实行走顺序。分支插入往返，允许在分岔站重复；新增 main_stations/patterns 保存主路径和GTFS分支模式。cells按已移动站格之间直线栅格化，为4连通示意折线，不是轨道工程线位。官方色来自本地GTFS route_color。
- trains_per_hour 来自港铁分配表 per_hour（班次）；cap_per_hour 来自 capacity。需求文件 lines 的 perHour 使用 volume（人/小时），不是 per_hour。非AM载客仅按全港PT总量缩放；PM交换方向，D级，不是重新分配。
- roads选 expressway/primary/district，排除local。路节点端点直线栅格化；共用节点落在同格，保留交叉连接。道路按名字/级别的连通块输出，分支用4连通往返步行覆盖。400米聚合会合并立交及平行道路，无法保留高程和转向限制，C级。
- sections 每一相邻格边唯一；经过该边的原路容量和负荷按空间方向分别相加。cap取两方向容量大者，load取两方向流量大者，vc=load/cap，均为一位小数或整数。model_links新增为追溯原路ID。两个最大值可能来自不同方向；用于游戏近似。
- roads.tunnel 以源 elevation<0 判断，toll取本组件最大私家车收费。缺名道路写未命名道路。中文路名从places.json的双语站点同位逗号分段提取，仅English完全匹配、中文路名后缀且候选唯一才采用；英文原名保留en。对照及来源保存out/road-name-map.json；不能确认的保留英文，完整列表在文末。
- areas.box为[c0,r0,c1,r1]，右/下端不含，全部16×12格且不越界，中心按移格后的站。
- pairs只保留未取整car+pt≥1；car=PV+TAXI，人/小时，pt=PT，SPB未并入公交；checks方式比例分母包含SPB。car_share/pt_share按任务要求只留一位小数，精确核对用car_pct/pt_pct等百分数（一位小数）。pairs过滤和取整会产生少量损失。
- 455内部分区之间的OD；15个X:口岸/外部联系控制点未纳入pairs，排除量在checks中列出。不能据此解释全港含跨境的全部出行。
- carMin=早高峰模型车程，不含停车；PM/day乘逐小时速度中位比8点/目标小时，C级。ptMin/walkMin来自skim-active-transit（2026-09-22 07:30–08:30窗），步行R5上限2小时，补回接驳后可能超过2小时；其他时段沿用基础时刻与步行；不可达用null，不能当0分钟。

## 字段来源和可信度

A=项目保存的官方原始输入；B=项目模型输出或确定性汇总；C=400米几何、游戏分类或时段近似；D=缺模型而明确假设。
|字段|来源|级别|
|---|---|---|
|网格坐标/land|luhk2024_codes.tif及其transform，400米多数类|B|
|cells人口岗位|game.engine.places的50米pop/jobs；trip-ends-2026|B|
|zones名字/区/总数|zones-2026.geojson、pl.zones标签、trip-ends-2026守恒取整|B|
|zones.cell/cbd/zone_index|分区边界、50米人口岗位、landuse办公GFA|C|
|stations ID/xy/线路、官方色|本地GTFS（重铁来自OSM）、places.json|B|
|station cell、lines cells|真实站位栅格化及避让|C|
|lines班次/容量、AM载客|transit-assignment-am-2026|B|
|roads/sections几何|road-links/road-nodes，400米汇总|C|
|AM OD/minutes/道路负荷|am-peak-2026、skim-active-transit、b.car_skim0、assignment-am-2026|B；格边负荷C|
|PM/day OD|mode-split-2026、parameters-tcs2022的目的小时系数|C|
|PM/day道路负荷|ATC 2024按AADT加权的11/18点对8点系数×AM|C|
|PM/day港铁载客|AM载客×该时段总PT/AM总PT；PM反向|D|
|holiday全部时段推算|HBO/NHB、用途/口岸去处代理、TD月客量高低比|D|

## 核对结果

{"population": 7517309, "jobs": 3947200, "population_difference": 0, "jobs_difference": 0, "stations": 97, "zones": 455, "road_sections": 3000, "four_connected": true, "areas": 20}
人口和岗位与模型合计完全一致。海岸分类调整：{"reclassified_cells": 599, "population": 357163, "jobs": 290939, "remaining_water_population": 0, "remaining_water_jobs": 0}。AM分钟空值数（car/pt/walk）：{"car": 851, "pt": 0, "walk": 107013}。{"checks.json": 0.0, "hk-base.json": 0.7, "hk-demand-am.json": 3.6, "hk-demand-day.json": 2.0, "hk-demand-holiday.json": 1.1, "hk-demand-pm.json": 3.7, "road-name-map.json": 0.0, "source-verification.json": 0.0, "verification.json": 0.0} MB。
道路连通块（各块涉及格子数，从大到小）：{"source_links": 23626, "within_one_cell": 17305, "features": 885, "sections": 3000, "component_cells": [2332, 2, 2, 2, 2, 2], "class_counts": {"expressway": 220, "district": 566, "primary": 99}}
主要连通块以外的小块保留，没有凭空造连接路。400米共格可连通，但不证明原始路网能转向。
AM car=171,855，PT=1,345,665，SPB=88,282 人/小时；car=10.7%，PT=83.8%；pairs覆盖car+PT 98%。
各区核对采用出发区；模型和pairs同为内区→内区，下面最后两列均以car+PT为分母。

|区|模型car|模型PT|输出car|输出PT|模型car%|输出car%|
|---|---:|---:|---:|---:|---:|---:|
|中西區|7431|58902|7307|57756|11.2|11.2|
|九龍城區|11539|83282|11238|81980|12.2|12.1|
|元朗區|17036|96056|16366|93108|15.1|14.9|
|北區|8609|50277|8254|49073|14.6|14.4|
|南區|5820|46686|5665|45382|11.1|11.1|
|大埔區|10116|52448|9819|51292|16.2|16.1|
|屯門區|14391|88874|13970|87134|13.9|13.8|
|東區|10950|99600|10760|97577|9.9|9.9|
|沙田區|14890|119339|14632|117954|11.1|11|
|油尖旺區|7622|72515|7473|71756|9.5|9.4|
|深水埗區|7304|79505|7137|78332|8.4|8.4|
|灣仔區|7286|42631|7145|41745|14.6|14.6|
|荃灣區|7160|52647|6970|51781|12|11.9|
|葵青區|8000|85188|7743|83624|8.6|8.5|
|西貢區|13975|84411|13207|82608|14.2|13.8|
|觀塘區|11143|127299|10919|125827|8|8|
|離島區|2648|34784|2498|33842|7.1|6.9|
|黃大仙區|5935|71220|5819|70178|7.7|7.7|

### 格边 v/c 最高15段

|格段|道路|负荷|容量|v/c|原路ID|
|---|---|---:|---:|---:|---|
|1495|西貢公路|1528|850|1.8|33019,33503|
|1399|西貢公路|1525|850|1.8|32688,32874|
|1445|西貢公路|1525|850|1.8|32688,32874|
|1796|清水灣道|1458|850|1.7|4388,6474|
|1528|獅子山隧道公路|4998|3000|1.7|10488|
|1558|獅子山隧道公路|4998|3000|1.7|10488,10489|
|1593|獅子山隧道公路|4998|3000|1.7|10488,10489|
|1594|獅子山隧道公路|4998|3000|1.7|10488,10489|
|1335|西貢公路|1358|850|1.6|32936,32941|
|1273|西貢公路|1352|850|1.6|33269,33272|
|1272|西貢公路|1317|850|1.5|33020,33186|
|1260|車公廟路|1526|1000|1.5|5110|
|1330|獅子山隧道公路|4366|3000|1.5|33624,33625|
|1396|獅子山隧道公路|4366|3000|1.5|33624,33625|
|1397|獅子山隧道公路|4366|3000|1.5|33624,33625|

### 原模型 v/c 最高15方向及格段映射

|原路|道路|方向|v/c|对应格段|
|---|---|---|---:|---|
|8108|-99|ab|3.3|local道路未选|
|35327|-99|ab|2.8|local道路未选|
|35285|-99|ab|2.8|local道路未选|
|35284|-99|ab|2.8|local道路未选|
|22546|TUNG CHI STREET|ab|2.7|local道路未选|
|31484|CHUI YAN STREET|ab|2.5|local道路未选|
|11886|WEST KOWLOON HIGHWAY|ab|2.5|400米同格内|
|4493|KING LAM STREET|ab|2.4|local道路未选|
|31484|CHUI YAN STREET|ba|2.4|local道路未选|
|27842|HONG WAN PATH|ab|2.4|local道路未选|
|27146|-99|ab|2.4|local道路未选|
|27147|-99|ab|2.4|local道路未选|
|27148|-99|ab|2.4|local道路未选|
|35281|-99|ab|2.4|local道路未选|
|35282|-99|ab|2.4|local道路未选|

两张表不要求排名相同：格边合并平行及交叉道路后容量与流量改变，且原模型高负荷可能发生在400米同格内部。保留model_links支持追溯。

### 港铁站序
- EAL：15站，金鐘 → 會展 → 紅磡 → 旺角東 → 九龍塘 → 大圍 → 沙田 → 火炭 → 大學 → 大埔墟 → 太和 → 粉嶺 → 上水 → 羅湖 → 上水 → 落馬洲
- TWL：16站，中環 → 金鐘 → 尖沙咀 → 佐敦 → 油麻地 → 旺角 → 太子 → 深水埗 → 長沙灣 → 茘枝角 → 美孚 → 茘景 → 葵芳 → 葵興 → 大窩口 → 荃灣
- KTL：17站，調景嶺 → 油塘 → 藍田 → 觀塘 → 牛頭角 → 九龍灣 → 彩虹 → 鑽石山 → 黃大仙 → 樂富 → 九龍塘 → 石硤尾 → 太子 → 旺角 → 油麻地 → 何文田 → 黃埔
- ISL：17站，柴灣 → 杏花邨 → 筲箕灣 → 西灣河 → 太古 → 鰂魚涌 → 北角 → 炮台山 → 天后 → 銅鑼灣 → 灣仔 → 金鐘 → 中環 → 上環 → 西營盤 → 香港大學 → 堅尼地城
- TKL：8站，北角 → 鰂魚涌 → 油塘 → 調景嶺 → 將軍澳 → 康城 → 將軍澳 → 坑口 → 寶琳
- TML：27站，屯門 → 兆康 → 天水圍 → 朗屏 → 元朗 → 錦上路 → 荃灣西 → 美孚 → 南昌 → 柯士甸 → 尖東 → 紅磡 → 何文田 → 土瓜灣 → 宋皇臺 → 啟德 → 鑽石山 → 顯徑 → 大圍 → 車公廟 → 沙田圍 → 第一城 → 石門 → 大水坑 → 恆安 → 馬鞍山 → 烏溪沙
- TCL：8站，香港 → 九龍 → 奧運 → 南昌 → 茘景 → 青衣 → 欣澳 → 東涌
- SIL：5站，金鐘 → 海洋公園 → 黃竹坑 → 利東 → 海怡半島
- AEL：5站，博覽館 → 機場 → 青衣 → 九龍 → 香港
- DRL：2站，迪士尼 → 欣澳

### 移格站列表
- 尖沙咀：[89, 76] → [89, 75]

## PM/day参数

小时系数=该目的目标小时图值/该目的24小时图值合计。PM HBW回程根据40%回家比例×0.5，再从小时总量扣除；HBS全部回程；HBO/NHB及跨境其他各半。11点各目的各半；方向缺少实测，C级。没有把AM普查的方式调整系数强加到其他小时。
18点：{"HBW": {"fraction_pct": 20.3, "from_home_pct": 1.3}, "HBS": {"fraction_pct": 3.4, "from_home_pct": 0}, "HBO": {"fraction_pct": 8.8, "from_home_pct": 50}, "NHB": {"fraction_pct": 19.1, "from_home_pct": 50}, "CBS": {"fraction_pct": 3.4, "from_home_pct": 0}, "CBR": {"fraction_pct": 8.8, "from_home_pct": 50}, "CBV": {"fraction_pct": 8.8, "from_home_pct": 50}}
11点：{"HBW": {"fraction_pct": 1.8, "from_home_pct": 50}, "HBS": {"fraction_pct": 1.2, "from_home_pct": 50}, "HBO": {"fraction_pct": 7.8, "from_home_pct": 50}, "NHB": {"fraction_pct": 4.6, "from_home_pct": 50}, "CBS": {"fraction_pct": 1.2, "from_home_pct": 50}, "CBR": {"fraction_pct": 7.8, "from_home_pct": 50}, "CBV": {"fraction_pct": 7.8, "from_home_pct": 50}}
道路普查缩放：{"year": 2024, "stations": 191, "hourly_sum": {"8": 485283.6, "11": 401789.2, "18": 471827.4}}；{"11": 0.8279472296223028, "18": 0.9722713746713534}
车程速度比中位数：18点 1，11点 1。这些数据不构成新的交通分配。

## 节假日D级假设

11–12点仅保留HBO+NHB构成，不含上班/上学；总量归一到平峰全目的内区机动人流×月际高低比；去处权重=1+455×各代理归一份额之和，四类代理等权；先对目的地加权，再逐出发区归一，保持每区原HBO/NHB总量；70%去程、30%回程。
代理为购物零售GFA、郊野/保育/休憩/开放空间面积、迪士尼和海洋公园母站数量、跨境控制点宿主区数量。没有可靠海滩数据，无法单独对海滩加权；公园面积也不等于实际游客量。
2025港铁日客量最高月/最低月比例：{"low_month": "2025-04", "low_thousand_per_day": 4548.2, "high_month": "2025-11", "high_thousand_per_day": 4964.3, "multiplier": 1.1, "exact_multiplier": "1.09149248", "formula": "1+455*sum(proxy/proxy.sum())", "proxies": ["retail GFA", "park/conservation/recreation/open-space hectares", "Disneyland Resort/Ocean Park station counts", "border-control host counts"], "total_target_people": 606753, "HBO_NHB_rescale": 1.2}。这是月际旺淡量级，不能当节假日实测增幅。道路按平峰车流×节假日car/day car；港铁按AM载客×holiday PT/AM PT。分钟沿用平峰近似。

## 独立验证

scripts/verify_source.py逐项对照原始NPZ/parquet：分区与格子守恒、AM/PM/day OD阈值与人数、方式占比、AM分钟空值与取整、港铁volume/容量。结果在out/source-verification.json。
scripts/verify_viewer.mjs用现有Playwright和Edge离线核对输出schema/引用/4连通，检查四时段切换、平移、缩放、图层与指格提示，结果在out/verification.json；另保存全港和九龙东截图。核对使用显式离线模式，浏览器临时目录也位于任务51。

## 已知限制 / 拿不准

- 轻铁未做；分区英文名缺失；英文路名未全部找到中文对照。
- 没有PM/day/holiday独立网络分配；非AM港铁载客为D级全局缩放，无法反映实际线路分流。节假日不含游客独立产生量及口岸控制点外部OD。
- 有人口/岗位的海岸多数水域格已用本格真实非水地类修正；不移动居民或岗位。山林不是正式山高程。
- 税费/停车分钟、桥隧转向、立交高程、车道分流未展开；格边模型主要供任务52/53初版。
- viewer只用于核对几何与负荷，双击离线可开，内嵌展示必要数据；数据权威文件为JSON。

## 尚无本地中文对照的路名

AIRPORT ROAD、ALBANY ROAD、AUSTIN ROAD WEST、BLACK'S LINK、BRIDE'S POOL ROAD、CANAL ROAD FLYOVER、CANTON ROAD、CAPE ROAD、CASTLE PEAK ROAD、CASTLE PEAK ROAD - CASTLE PEAK BAY、CASTLE PEAK ROAD - HUNG SHUI KIU、CASTLE PEAK ROAD - KWAI CHUNG、CASTLE PEAK ROAD - LAM TEI、CASTLE PEAK ROAD - LINGNAN、CASTLE PEAK ROAD - MAI PO、CASTLE PEAK ROAD - NEW TAI LAM、CASTLE PEAK ROAD - NEW TING KAU、CASTLE PEAK ROAD - PING SHAN、CASTLE PEAK ROAD - SAN TIN、CASTLE PEAK ROAD - SHAM TSENG、CASTLE PEAK ROAD - SO KWUN WAT、CASTLE PEAK ROAD - TAI LAM、CASTLE PEAK ROAD - TAM MI、CASTLE PEAK ROAD - TING KAU、CASTLE PEAK ROAD - TSING LUNG TAU、CASTLE PEAK ROAD - TSUEN WAN、CASTLE PEAK ROAD - YUEN LONG、CENTRAL-WAN CHAI BYPASS TUNNEL、CHATHAM ROAD NORTH、CHATHAM ROAD SOUTH、CHEK LAP KOK ROAD、CHEONG HONG ROAD、CHEUNG PEI SHAN ROAD、CHEUNG TSING HIGHWAY、CHEUNG TSING TUNNEL、CHEUNG TUNG ROAD、CHI FU ROAD、CHI HO ROAD、CHING CHEUNG ROAD、CHUI TIN STREET、CHUNG HOM KOK ROAD、CHUNG NGA ROAD、CHUNG ON STREET、CONNAUGHT ROAD CENTRAL、CROSS HARBOUR TUNNEL、CYBERPORT ROAD、DAI CHEONG STREET、DISCOVERY BAY ROAD、EAST KOWLOON CORRIDOR、EASTERN HARBOUR CROSSING、EXPO DRIVE EAST、FANLING HIGHWAY、FANTASY ROAD、FUK WANG STREET、FUNG MO STREET、GASCOIGNE ROAD FLYOVER、HA TSUEN ROAD、HA WAN TSUEN EAST ROAD、HEUNG YUEN WAI HIGHWAY、HING SHING ROAD、HING WAH STREET WEST、HOI ON ROAD、HOLLYWOOD ROAD、HONG CHONG ROAD、HONG KONG-ZHUHAI-MACAO BRIDGE HONG KONG LINK ROAD、HONG LOK YUEN ROAD、HUNG CHI ROAD、HUNG HOM BYPASS、HUNG TIN ROAD、ISLAND EASTERN CORRIDOR、KAI CHEUNG ROAD、KAI CHEUNG ROAD FLYOVER、KAI FUK ROAD FLYOVER、KAI TAK TUNNEL、KAM POK ROAD、KAM POK ROAD EAST、KAM TIN BYPASS、KAM TSIN ROAD、KEUNG SHAN ROAD、KIN CHUEN STREET、KONG SHAM WESTERN HIGHWAY、KWAI HING ROAD、KWAI SHING CIRCUIT、KWU TUNG NORTH ROAD、KWUN TONG BYPASS、LAI CHI LING ROAD、LAI CHO ROAD、LAM TEI INTERCHANGE、LAM TIN INTERCHANGE、LANTAU LINK、LAU SHUI HEUNG ROAD、LIM CHO STREET、LIN CHEUNG ROAD、LO FAI ROAD、LOK LAM ROAD、LONG PING ROAD、LONG TIN ROAD、LONG YAT ROAD、LONG YIP STREET、LUGARD ROAD、LUNG KWU TAN ROAD、LUNG YUET ROAD、MA MIU ROAD、MA ON SHAN BYPASS、MA TONG ROAD、MAGIC ROAD、MAN KAT STREET、MAN YUE STREET、MOUNT DAVIS ROAD、MUI WO FERRY PIER ROAD、NAM CHEONG STREET、NEW PRAYA, KENNEDY TOWN、NGAN KWONG WAN ROAD、NGONG PING ROAD、NORTH LANTAU HIGHWAY、NORTH WEST TSING YI INTERCHANGE、OI TAK STREET、ON PO ROAD、PAK LAI ROAD、PAK LAM ROAD、PAK SHEK TOI ROAD、PAK TAM ROAD、PAK YAN ROAD、PENNY'S BAY HIGHWAY、PLOVER COVE ROAD、PO KIN ROAD、PO SHUN ROAD、PO WAN ROAD、POK FU LAM ROAD、POK OI INTERCHANGE、PRAT AVENUE、PRAYA, KENNEDY TOWN、PRINCE EDWARD ROAD EAST、PRINCE EDWARD ROAD WEST、PRINCESS MARGARET ROAD、QUEEN'S ROAD CENTRAL、QUEEN'S ROAD EAST、QUEEN'S ROAD WEST、SAI TAI STREET、SAM TUNG UK ROAD、SAN SHAM ROAD、SAN TIN HIGHWAY、SAU MAU PING ROAD、SHA LEK HIGHWAY、SHA TAU KOK ROAD - LUNG YEUK TAU、SHA TAU KOK ROAD - MA MEI HA、SHA TAU KOK ROAD - SHEK CHUNG AU、SHA TAU KOK ROAD - WO HANG、SHA TIN ROAD、SHA TIN RURAL COMMITTEE ROAD、SHA TIN TAU ROAD、SHAP PAT HEUNG INTERCHANGE、SHEK MUN INTERCHANGE、SHEK PAI WAN ROAD、SHENZHEN BAY BRIDGE、SHEUNG NING ROAD、SHING CHUEN ROAD、SHING MUN TUNNEL、SHING MUN TUNNEL ROAD、SHING SAI ROAD、SHUI PIN WAI INTERCHANGE、SHUN LONG ROAD、SHUN WUI ROAD、SIENA AVENUE、SO KWUN PO ROAD、SO KWUN WAT TSUEN ROAD、SOUTH LANTAU ROAD、STANLEY MAIN STREET、SUI CHEUNG STREET、SUN YIP STREET、SUNNY BAY ROAD、TAI AU MUN ROAD、TAI LIN PAI ROAD、TAI MONG TSAI ROAD、TAI MOU AVENUE、TAI O ROAD、TAI PO ROAD、TAI PO ROAD - MA LIU SHUI、TAI PO ROAD - PIPER'S HILL、TAI PO ROAD - SHA TIN、TAI PO ROAD - SHA TIN HEIGHTS、TAI PO ROAD - TAI PO KAU、TAI PO ROAD - TAI WO、TAI PO ROAD - YUEN CHAU TSAI、TAI SHU HA ROAD WEST、TAI WING AVENUE、TAI YIP STREET、TAN KWAI TSUEN ROAD、TATE'S CAIRN HIGHWAY、TEXACO ROAD NORTH、THIRD SKY STREET、TIN CHEUNG ROAD、TIN HA ROAD、TIN PING ROAD、TIN TSZ ROAD、TIN YING ROAD、TOLO HIGHWAY、TONG YAN SAN TSUEN INTERCHANGE、TONKIN STREET WEST、TOWN PARK ROAD NORTH、TSEUNG KWAN O TUNNEL ROAD、TSEUNG LAM HIGHWAY、TSING KWAI HIGHWAY、TSING LONG HIGHWAY、TSING SHA HIGHWAY、TSING TAI ROAD、TSING TSUEN ROAD、TSING WUN ROAD、TSING YI HONG WAN ROAD、TSING YI NORTH COASTAL ROAD、TSUEN KING CIRCUIT、TSUEN WAN ROAD、TSUI LAM ROAD、TSZ TIN ROAD、TUEN MUN CHEK LAP KOK TUNNEL ROAD、TUNG CHUNG WATERFRONT ROAD、TUNG WING ROAD、TUNG WUI ROAD、TUNG YUEN STREET、WAH YIU ROAD、WAI MAN ROAD、WANG LEE STREET、WANG LOK STREET、WANG YIP STREET WEST、WEST KOWLOON CORRIDOR、WEST KOWLOON CORRIDOR WEST、WEST KOWLOON HIGHWAY、WESTERN HARBOUR CROSSING、WO TONG TSUI STREET、WONG CHUK HANG ROAD、WONG NAI CHUNG GAP FLYOVER、WU KAU TANG ROAD、YAU KING LANE、YEN CHOW STREET WEST、YUEN LONG HIGHWAY、YUEN LONG TAI YUK ROAD、YUEN SHIN ROAD、YUK HONG STREET


## 最终独立核对

源文件逐项核对和离线浏览器交互核对均通过；记录为out/source-verification.json与out/verification.json。
分区及格子人口均为7,517,309，岗位均为3,947,200。599个有居民或岗位的海岸多数水域格改用本格真实非水地类；人口/岗位留在水域格的数量均为0。
源模型分区岗位含小数，本版最大余数守恒取整修正了辅助接口截尾造成的218岗位差额。
道路中文名对照确认385条，仍无唯一可靠对照的238条保留英文并列在文末。新增roads.name_source表示中文名的本地数据来源；对应原英文保留en，完整对照见out/road-name-map.json。

pairs只保留car+pt>=1；阈值过滤及一位小数舍入后的损失：
|时段|开车人流损失%|公交人流损失%|
|---|---:|---:|
|am|2.9|1.8|
|pm|2.3|1.6|
|day|8.1|7.4|

所有JSON文件大小：
|文件|MB|
|---|---:|
|checks.json|0|
|hk-base.json|0.7|
|hk-demand-am.json|3.6|
|hk-demand-day.json|2|
|hk-demand-holiday.json|1.1|
|hk-demand-pm.json|3.7|
|road-name-map.json|0|
|source-verification.json|0|
|verification.json|0|
