# 任务53交回说明

已重审前一版代码，并用任务51正式底板生成四片关卡、完成20秒机器人搜索和最佳方案重放。**铜锣湾·湾仔通过当前粗验收；九龙东、沙田、元朗的模型堵点排序未达标，已明确返回 model_vc_mismatch。**

F:\transitlab-hk 只读，未做 git 操作。复制中的93个原有文件（包括 mode3-roads）按 SHA-256 核对未改变。交回只增加 v7/shared/levelgen/**、bots/v7_levelgen.js 和本说明。

## 文件

- game-feeder/v7/shared/levelgen/cut.js：cut(base,demand,request) → {level,problems,notes}
- check.js：统一容量系数搜索、无操作与模型排序验收。
- bot.js：默认20秒局部搜索，保存最好方案及门槛。
- compare.js：手工九龙东对照；标明代表名称、成员别名、英文走廊桥接。
- preview.html：片区、请求、地图、JSON、验收和第三关打开按钮。
- game-feeder/bots/v7_levelgen.js：CLI、--compare、--batch、--benchmark、--serve。
- levelgen/inputs/：本次正式输入快照及 provenance.json。
- levelgen/results/：四片各自 JSON、四片合并 JSON、对照/重放摘要、手工基准、系数扫描证据。
- levelgen/verification.json：语法、双环境、接口、名称匹配、方案重放及文件保护检查摘要。

四个库都是浏览器全局 + module.exports 双接口，不访问 DOM。文件和 HTTP 操作只在 bots/v7_levelgen.js。

## 正式输入

- hk-base.json：780371字节，修改时间2026-10-14T15:36:30.521Z；SHA-256：c8256b6d00d7b913196f63e6ebf351a18f67bbf0518c99527678df20dccc3fdd
- hk-demand-am.json：3802073字节，修改时间2026-10-14T15:36:31.212Z；SHA-256：6ca08972d9566ff1f6e8e986b8e5b836ef502448586e66692aa234031600b252

底板160×120、455分区、97站、10线、885路、3000格边；AM 134348个OD。

任务51曾在本轮运行中更新岗位取整及路名，因此本次冻结输入，CLI 记录读取内容的 SHA-256。完整来源、模型文件和可信度保留在输入 sources/tiers 字段。临时人工夹具只用于回归，不作为全港模型输出。

## 切法及每个数的来源

1. areas[].box 切16×12格，所有坐标减去左上角；端点差16/12按右下不含，15/11按右下包含，source.box 保留原值。land 长度必须等于 cols×rows；~、w进入 water。

2. 框内 pop>0 的分区按人口从大到小合团，**团内任意两个代表格曼哈顿距离≤2**，防止链式相邻把大半城市合成一团。取人口最多六团；名字取最大成员，位置为人口加权格取整。检查周围两格内避水/道路接驳候选，移动写入 notes，无法接驳报 unreachable；不添加模型外道路。

3. jobs同样合团，取前两团。attraction=16+jobs/15000，carExtra=2+cbd（0/1/2→2/3/4）；位置按岗位加权并使用实际接驳格。第三个去处为所选屋苑出框 car+pt 最大方向的出口，严格放该方向框边。出口 attraction=16+该方向人/小时÷15000，carExtra=2；这只是等效岗位量，jobsEquivalent有明确标记。没有可定位外部OD则报问题，不造假出口。

4. 每屋苑 people=成员去所选两岗位团及出口的 pairs.car+pairs.pt，scale=300/合计，人数四舍五入。source.scale保存系数。未纳入其它内部去处及其它出框方向，不能当成完整全港通勤。changes按人口比例等比改这份OD出行量，不重新运行四阶段模型。

5. 路来自框内相邻格 sections，按road及相同cap连成折线，在分叉/容量变化处拆开；孤立、不接其它路且不触框的单段去掉。初始 cap=modelCap×scale，check乘一个全局系数；source.roadSections保留逐格边的模型vc/sectionId。重复格边由原引擎取最大容量。当前校准在带请求的切片上同时参考排序、误差和年度稳定性；后续应将基准系数固定在改动前，并进一步处理OD/穿境流量差异。

6. 港铁从 base.lines.cells 切连续片段，保留片段内至少两站，真站名、简体名、颜色原样读输入，trains=3。

7. changes支持 people/jobs/road_cap，pct=-50…150，by_year为非负整数。识别繁简、站一带/屋苑简称、团成员别名及已知走廊英文别名；无可信匹配/歧义不改，可识别近名回退并报place_not_found。道路修改作用于全部同名片段；观塘绕道中文请求已验证映射到 KWUN TONG BYPASS，影响12个片段。jobs按岗位比例后重新计算16+jobs/15000。有by_year写grow；重复变化合成曲线。容量校准同时缩放cap和grow，保留请求百分比。

8. title/story来自请求；source记录area/period/box/scale/解析后的changes/roadCapCoeff/道路来源及容量变化因子。其它参数严格按任务：walkPer3、wait2、lineCost1、stationCost3、trainCost4、perTrain40、budget30、years8、crowdBlocks4、aware{start:.2,spread:2}、nearby10、stay40、learn.3。另加phase2Budget=0，避免任务49新版第四年额外给12。

## 验收与机器人

D.use(level)+reset()读取无操作8年塞车：要求>0、相邻年变化<10%。无操作得分逐年重新计算，绕开旧引擎空Plan.simulate()会停顿的问题。检查边界、水域、道路接驳及现有港铁可达性。

机器人以屋苑/去处/老站为候选点，折线随机起步，局部调整端点、站位、站数和列车；默认20秒。仅优化开局一条固定线路，后四年不追加动作。best为限时找到的最好分，不是全局最优证明；tiers=round(best×[.40,.65,.88])。“太容易”按六格以内、两站、单车的simpleBest是否达到最终大师线判断；best<50视为太小。

问题码包含任务要求五项，另加invalid_input、invalid_request、unstable_traffic、model_vc_mismatch。第一版粗排序阈值为Spearman≥0.2，report.accepted同时考虑问题列表。此阈值不等同于完整交通校准已完成。

## 实际命令及结果

在任务53/game-feeder目录执行：

~~~powershell
node bots/v7_levelgen.js --base v7/shared/levelgen/inputs/hk-base.json --demand v7/shared/levelgen/inputs/hk-demand-am.json --batch --seconds 20 --engine F:\transitlab-hk\game-feeder\v7\mode3-roads\engine.js --out <本次结果文件>
~~~

实际先输出至工作目录 four-areas-real.json，交回保存为 levelgen/results/four-areas.json。各area JSON也单独保存。控制台对照表及结果字段汇总如下；最后仅增加名称别名元数据，五个已保存最佳方案均重放得到相同分数和花费。

| 片区 | 屋苑/去处/路/老线 | 无操作总塞车 | 年变化最大 | 最好分 | 门槛 | 秒 | Spearman | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| kowloon-east | 6/3/161/2 | 7530.488 | 0.00% | 3282 | 1313/2133/2888 | 20.02 | 0.046 | model_vc_mismatch |
| sha-tin-tai-wai | 6/3/117/2 | 4551.4 | 7.83% | 1191 | 476/774/1048 | 20.09 | 0.189 | model_vc_mismatch |
| yuen-long | 6/3/117/1 | 2390.706 | 2.91% | 840 | 336/546/739 | 20.08 | -0.123 | model_vc_mismatch |
| causeway-bay-wan-chai | 6/3/152/5 | 2842.557 | 0.43% | 907 | 363/590/798 | 20.04 | 0.3 | 通过粗验收 |

- kowloon-east：scale=0.005670509381857771；容量系数=0.7；请求=[]
- sha-tin-tai-wai：scale=0.010431734727940354；容量系数=0.40847；请求=[{"place":"隆亨邨","what":"people","pct":48.5,"by_year":4}]
- yuen-long：scale=0.012383645332397683；容量系数=1；请求=[{"place":"元朗站一帶","what":"people","pct":36.8,"by_year":4}]
- causeway-bay-wan-chai：scale=0.010574028775456976；容量系数=0.51049；请求=[{"place":"中環站一帶","what":"jobs","pct":6.8,"by_year":4}]

“三万人/两万人/一万五千岗位”按所选团原人口/岗位换算pct，保留到0.1%，故标题数量为近似。铜锣湾片区框包含中环，本示例改的是框内最大岗位团中環站一帶，目标在请求中明列。

### 九龙东与手工对照

| 版本 | 人数 | 无操作塞车 | 20秒最好分 |
| --- | --- | --- | --- |
| 生成 | 301 | 7530.488 | 3282 |
| 手工 | 282 | 9922.524 | 3244 |

最好分比=1.0117

| 生成屋苑 | 手工对应 | 匹配依据 | 生成份额 | 手工份额 |
| --- | --- | --- | --- | --- |
| 啓德站一帶 | 啟德 | 啓德站一帶 | 25.2% | 8.5% |
| 秀茂坪邨 | 秀茂坪 | 秀茂坪邨 | 16.6% | 19.9% |
| 啓田邨 | 无 | — | 15.0% | — |
| 彩盈邨 | 牛頭角 | 牛頭角上邨 | 16.6% | 17.7% |
| 牛池灣街彩雲邨 | 无 | — | 15.3% | — |
| 安泰邨 | 順利·安達臣道 | 順利邨 | 11.3% | 10.6% |

| 生成去处 | 手工对应 | 生成吸引力 | 手工吸引力 |
| --- | --- | --- | --- |
| 觀塘站一帶 | 觀塘商貿區 | 26.804 | 26.000 |
| 九龍灣站一帶 | 九龍灣商貿區 | 23.409 | 24.000 |
| 往西面 | 无 | 18.590 | — |

对应6条走廊：清水湾道、观塘绕道、观塘道、秀茂坪道、将军澳隧道、将蓝隧道；开源道未出现在此底板切片。英文桥接只作为手工关卡注释中的走廊对照，标bridge=true，不声称线段几何完全相同。代表名字/成员别名能近名对应4个屋苑，两处岗位都对应。

模型 v/c：清水灣道 1.7 → EASTERN HARBOUR CROSSING 1.3 → ISLAND EASTERN CORRIDOR 1.2 → 啟華街 1.1 → TSEUNG LAM HIGHWAY 1.1 → 茶果嶺道 1.1 → KWUN TONG BYPASS 0.9

生成游戏 v/c：協和街 2.37 → 曉光街 2.35 → KAI CHEUNG ROAD 2.06 → 觀塘道 1.63 → 物華街 1.53 → KWUN TONG BYPASS 1.3 → 振華道 1.18

手工游戏 v/c：開源道 1.6 → 秀茂坪道 1.4 → 觀塘繞道 0.97 → 觀塘道 0.93 → 將藍隧道 0.74 → 清水灣道 0.34 → 將軍澳隧道 0

模型最高清水湾道，生成游戏最高协和街/晓光街；手工游戏最高开源道/秀茂坪道。**量级及最好分接近，堵点排序没有通过，不能把它写成完全一致。** 推断涉及框外穿境车流缺失、引擎重新分配目的地/方式、道路格网合并。系数扫描也未找到满足粗排序阈值的因子：

| 片区 | 扫描数 | 最高稳定相关性 | 该系数 |
| --- | --- | --- | --- |
| kowloon-east | 46 | 0.047 | 0.6 |
| sha-tin-tai-wai | 47 | 0.189 | 0.4 |
| yuen-long | 46 | -0.122 | 0.4 |

扫描覆盖0.05至20，每片46或47个统一系数，证据见results/cap-sweep.json；不是连续参数空间的最优证明。没有采用逐路任意改容量来伪造排序。

### 手工基准

~~~powershell
node bots/v7_levelgen.js --benchmark --engine F:\transitlab-hk\game-feeder\v7\mode3-roads\engine.js --seconds 20
~~~

手工九龙东best=3244，tiers=[1298,2109,2855]，无操作总塞车9922.524，最大逐年变化24.06%，返回unstable_traffic。源手工关卡有设计增长；保留任务53的10%条件，未把它写成通过。手工首阶段20/第二阶段12，生成关卡30/第二阶段0，预算和增长差异已记录。

## 预览与整合接口

~~~powershell
node bots/v7_levelgen.js --serve --port 8053
~~~

打开 http://127.0.0.1:8053/v7/shared/levelgen/preview.html，选inputs两个JSON，通过同一HTTP来源共享localStorage。预览载入/生成/错误状态已用浏览器全局与DOM夹具检查，HTTP页面及脚本返回200；未做真实浏览器截图验收。20秒搜索同步执行，会暂时阻塞界面。

“在第三关打开”写localStorage['tl-gen-level']并打开../../mode3-roads/index.html#gen。按硬规矩未改mode3-roads；Claude在data.js后、engine.js前加入：

~~~html
<script>
if (location.hash === '#gen') {
  try {
    const raw = localStorage.getItem('tl-gen-level');
    if (raw) ROADS_DATA.use(JSON.parse(raw), 'gen');
  } catch (error) { console.error('生成关卡读取失败', error); }
}
</script>
~~~

初次复制的旧引擎不支持grow，新版源引擎支持人口/岗位grow，故实测用了--engine源路径。旧引擎忽略增长时check报invalid_input。当前道路容量grow仍需引擎支持，本程序输出字段并报未真实验收（目前以capAt导出判断接口，整合若改名需同步）。

## 复查及未完成

语法5文件通过；非零左上角平移、输入不变、有效land长度、人数缩放、道路合并、未知名称不误改、错误模式拒绝、容量grow百分比、门槛计算、浏览器全局加载、CLI对照、预览事件、本地服务均检查。真实四片及手工最好方案共五个重放通过。输入与证据可复现。

剩余：三个片区堵点排序；基准容量校准与改动顺序；road_cap按年引擎接口；pm/mode2/4；holiday目前用jobs作活动代理，缺专门休闲数据；第三关接入及浏览器画面验收。合回时仅整合新增目录和CLI，复制中的旧mode3-roads交由Claude按任务49新版接口整合。
