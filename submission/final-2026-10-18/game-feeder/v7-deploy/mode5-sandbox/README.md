# 任务52：全港沙盘引擎与页面

更新：2026-10-15。第一版已接入真实全港底板和四时段。完整Node检查退出码0；早高峰真实九龙东示例5轮稳定，其他三个时段也均5轮稳定。**默认采用用户在2026-10-15明确批准的同轮联立反馈算法**，保留全部方式选择/道路公式和0.3学习系数；这项计算顺序调整与原文不同，记录如下。

## 文件范围

F:/transitlab-hk全程只读，未做git操作。v7、bots复制到本任务目录；实现只写game-feeder/v7/mode5-sandbox/，此外写本说明。shared/nav.js未修改，第五站导航由Claude整合。

源项目在起始复制后仍由其他工作更新；本任务保留起始快照。尤其第三关data.js起始副本与后续源版本不同，因此早期暂存夹具和桌面夹具的数字不同；本说明以桌面副本实际检查为准。

## 启动

```powershell
node "$env:USERPROFILE\Desktop\TransitLab五模式-Codex\任务52\game-feeder\v7\mode5-sandbox\serve.js"
```

打开 http://127.0.0.1:8765/mode5-sandbox/index.html 。服务器只绑定127.0.0.1、只读取v7，无依赖、无写盘；停止用Ctrl+C。当前预览服务已启动。真实数据经HTTP加载；file://或JSON缺失时显示明确标D级的九龙东机制夹具。

## 真实数据

任务51在2026-10-14 23:36交付后，已复制同一版本的底板、四时段需求及检查JSON。160×120网格，400米/格；455分区、97港铁站、885条道路、3000段路、3928个人口/岗位格、20片区。

| 时段 | OD对 | 数据级别 | 人·分钟覆盖 |
| --- | ---: | --- | ---: |
| 早高峰 | 134348 | B | 99.60% |
| 晚高峰 | 138627 | C | 99.68% |
| 平日日常 | 76284 | C | 99.92% |
| 节假日 | 40643 | D | 99.94% |

未知分钟保留null；对应人数仍参与方式选择和道路负荷，排除在人·分钟统计之外。0分钟仍有效。地形^是山地/灌木近似，不能当作法定郊野公园；时段需求含估计和分配，尤其D级不作为规划结论。来源与限制见任务51说明及本目录data/内保留的来源/检查JSON。英文缺失的原始地名保留中文，不编造正式译名。

D级备用夹具沿用第三关14×12、约600米示意几何，计算按2.5分钟/格；人口=people×2000，岗位=max(0,attraction−16)×15000，OD总量=round(people×(attraction+3)×1.15)，58%开车。carGrid=max(4,曼哈顿格数+carExtra)，ptGrid=max(carGrid+2,格数×2+8)，各自×2.5换分钟；道路容量=cap×100。夹具只验证机制，不是香港真实模型。

## 引擎规则

engine.js为纯数值模块，无DOM、I/O、网络，可在Node直接require。真实模型的道路准备、港铁最短路和整张图迭代在worker.js运行，不按地图视野截断。仅D级小夹具允许Worker不可用时回退到主线程。

- 1时间格2.5分钟；步行每格2时间格，等车2格。实际步行BFS绕水，到站最多6格；地铁行程必须经过至少一段列车行驶。
- 基准carMin/2.5、ptMin/2.5。老港铁支线保持原站序，包括重复站；运行格数加停站1格。新站距服务车站≤1格时可步行加等车换乘。
- d=max(0,无新线地铁时间−有新线地铁时间)，老网不可达时用基准公交时间；pt=pt0−d，行程时间最低0。
- 车路线按基准拥堵确定后固定。每起点求一次Dijkstra，OD路线缓存为紧凑类型数组。c=Σ(extra0−感知extra)；carShare=clamp(baseShare−0.1×(d−c),0,1)。
- load=load0+Σ开车人数变化/1.3，最低0；extra=(load/cap)²。塞车为Σ车辆×extra；车辆减少为净开车人数减少/1.3。
- 默认联立求解同轮的感知与实际拥堵：e_next=0.7e_old+0.3actual(e_next)。方式选择和道路方程不变。最后5轮总开车人数相对前轮变化均<0.5%才稳定。页面每次自动运行最多30个新增轮次，未达标如实显示“仍未稳定”。
- 无建设时保留原car0/pt0数值，避免小数舍入漂移；分钟节省按差量计算。四时段各30轮基准、每个分区比例、每段道路负荷及extra检查均通过。
- 默认预算300：每线格1、站3、列车4，预算0有效。整数格、4连通、不分叉、不重复、不闭环、不穿水；站必须在线上。0列车的新线不提供服务。
- 坐新线人数只计最快改善行程实际经过新服务的OD。第一版等待时间固定；增减列车目前影响预算和是否提供服务，逐段容量反馈留第二版。

API：prepare、createState、step、runToStable、validatePlan、planCost、buildMetro、transitBenefits。explicitStep保留文档原显式四步，供比较。feedback-solver.js为已合入engine.js算法的兼容入口，无独立第二份算法。

### 为什么调整顺序

原文顺序为方式选择→道路负荷→实际拥堵→感知更新0.3，在真实新增线路上发生全网振荡：前四轮开车比例11.199%、11.235%、10.963%、14.529%，第30轮仍大幅变化。原失败输出保留在explicit-check-output.txt；不是删掉失败检查后声称成功。

用户明确选择“采用稳定候选（推荐）”后才启用同轮联立算法。数值解采用矩阵向量方式的Newton迭代和迭代线性求解，不建立巨大的OD矩阵；残差超过1e-8即报错。30轮持续观察的残差和目标道路方向检查见feedback-check-output.txt。这比达到5轮阈值就停更能检查是否再次发散。

## 页面

使用shared/style.css的v7三栏骨架；I18N.add/L三语言。像素地图包含海、山、住宅/岗位、道路、官方色港铁、v/c、人口/岗位相对热度、分区与片区。

多线编辑、画线、线上放/删站、增减列车；缩放按钮/滚轮、平移工具拖动、中右键拖动、两指手势代码。道路流量与基准港铁流量分别偏移在两侧。四时段各有底色、真实需求及B/C/D提示。20片区可点选缩放；“切成关卡”为任务53接口。

预览只更新地图、HUD与消息；方案变更清空旧结果，实际运行才更新两侧结果、逐轮表和5段道路变化。运行前刷入待发送方案，忽略过期Worker回复；自动计算逐轮报进度，并逐轮更新地图数、两侧结果和表格。分区指向用zone_index；道路指向用实际线段命中，显示负荷/容量/基准变化。

真实示例：九龙湾[100,68]→观塘[103,71]，7线格、2站、1列车，成本17。AM第5轮：新线3617.2人/小时，净少车111.9辆，塞车指标减少75.2，节省约6928人·分钟。地图“改坐公交”408为转向公交人数总和，车辆减少按全网净变化计算，两者因部分其他OD改回开车而不直接相除。

浏览器已实际核对真实加载、预算17示例、预览两侧不更新、运行后表/结果更新、全图/片区缩放、四时段及等级提示、图层开关、三语言、未收敛提示跨语言保留、稳定结果与Node一致。实测发现并修复方案重置作用域错误，修复后运行无新增JS错误。截图：preview-full-hk.png、preview-kowloon.png。

手机尺寸截图工具超时，手动画线与实际两指手势的实机验收尚未完成，不能称为已验证。

## 检查命令与实际输出

```powershell
Set-Location "$env:USERPROFILE\Desktop\TransitLab五模式-Codex\任务52\game-feeder\v7\mode5-sandbox"
node test_engine.js
```

完整输出在engine-check-output.txt，退出码0：

```text
Urban line rounds: round | car share | new-line riders | vehicles reduced | congestion reduced | car change
1 | 50.78% | 5713.5 | 1186.4 | 35952.0 | 12.458%
2 | 52.25% | 5470.8 | 944.9 | 26391.5 | 2.897%
3 | 52.84% | 5356.1 | 846.9 | 22488.6 | 1.142%
4 | 53.10% | 5298.9 | 805.7 | 20884.3 | 0.475%
5 | 53.21% | 5268.9 | 787.4 | 20203.8 | 0.210%
6 | 53.26% | 5252.4 | 778.6 | 19901.3 | 0.100%
7 | 53.29% | 5243.1 | 774.2 | 19758.9 | 0.051%
8 | 53.30% | 5237.6 | 771.8 | 19687.9 | 0.028%
PASS no-build 30 rounds; max baseline drift < 0.00e+0
PASS urban line stable in 8 rounds; Kai Tak car share 58.0% → 48.5%
PASS road direction; 觀塘繞道 / 觀塘道 load decreased
PASS budget, one-cell transfer, six-cell walking limit, and remote park line
Fixture simulate-to-stable elapsed 10.3 ms (8 rounds; D-tier fixture only)
PASS full HK am: 134348 OD pairs, 30 no-build rounds, drift 0.00e+0; prepare 1894.3 ms; mean step + checks 107.4 ms; minute coverage 99.60%
PASS full HK pm: 138627 OD pairs, 30 no-build rounds, drift 0.00e+0; prepare 2715.7 ms; mean step + checks 115.1 ms; minute coverage 99.68%
PASS full HK day: 76284 OD pairs, 30 no-build rounds, drift 0.00e+0; prepare 2418.7 ms; mean step + checks 47.3 ms; minute coverage 99.92%
PASS full HK holiday: 40643 OD pairs, 30 no-build rounds, drift 0.00e+0; prepare 2257.4 ms; mean step + checks 25.7 ms; minute coverage 99.94%
Full HK AM urban rounds: round | car share | new-line riders | fewer cars | congestion reduced | car change
1 | 11.206% | 3619.4 | 143.0 | 208.4 | 0.111%
2 | 11.208% | 3618.3 | 122.4 | 105.5 | 0.016%
3 | 11.209% | 3617.7 | 115.8 | 83.4 | 0.005%
4 | 11.209% | 3617.4 | 113.1 | 77.2 | 0.002%
5 | 11.209% | 3617.2 | 111.9 | 75.2 | 0.001%
PASS full HK urban convergence within 30 rounds
PASS full HK stable direction (5 rounds); Kwun Tong car share 7.985% → 7.877%; target-road summed section load 90324.0 → 90083.6
PASS full HK unused rural line [[88,4],[89,4],[90,4],[91,4]]; no vehicle or congestion change
PASS real JSON interface: 160×120, 455 zones, 97 stations, 3000 road sections, 20 areas
```

其他三时段新增线路：
```powershell
node test_periods.js
```
period-check-output.txt，退出码0：

```text
PASS full HK pm urban: 5 rounds; 3374.0 new-line riders/h; 133.7 fewer cars; residual 2.724e-10; elapsed 17.049 s
PASS full HK day urban: 5 rounds; 918.0 new-line riders/h; 52.5 fewer cars; residual 5.603e-11; elapsed 4.349 s
PASS full HK holiday urban: 5 rounds; 416.2 new-line riders/h; 25.2 fewer cars; residual 9.924e-11; elapsed 3.805 s
```

连续观察30轮及学习残差：
```powershell
node test_feedback_solver.js
```
feedback-check-output.txt，退出码0（此输出在候选验证阶段取得；现已将相同算法合入默认引擎）：

```text
{"round":1,"change":0.001113694137442737,"vehicles":143.00046896716455,"carShare":0.1120638588770187,"residual":6.989601675222445e-10,"seconds":3.1986426}
{"round":2,"change":0.00016060408778415956,"vehicles":122.40156170153148,"carShare":0.11208185679084946,"residual":9.807375744852465e-11,"seconds":6.188760999999999}
{"round":29,"change":1.0319902146163054e-10,"vehicles":110.64883153789336,"carShare":0.11209212552122415,"residual":9.163222958186168e-11,"seconds":51.2758123}
{"round":30,"change":6.73227383532307e-11,"vehicles":110.64882290097347,"carShare":0.11209212552876868,"residual":7.401434673481866e-11,"seconds":52.0347075}
PASS experimental implicit solver only: 30 continued rounds, last-five changes <0.5%, learning residual <1e-8; target roads 90324 -> 90091.62769280384; elapsed 52.036 s.
```

还覆盖预算0/超预算、1格换乘、最多6格、绕水超限、0列车无服务、未知时间不当0、港铁重复站的支线次序、无人山地线路无变化。所有交付JS已用node --check检查语法。

## 速度

Node v24.13.0；模型准备约1.9–2.7秒，基准一轮含逐项检查约0.026–0.115秒。真实新增线路涉及同轮解算，不能拿无建设或小夹具速度推算。

浏览器Worker实际：
```text
[mode5] Worker stable: 13481.200 ms, 5 rounds, 2696.240 ms/round
[mode5] Worker step: 2790.800 ms
```
最终页面AM五轮约13.48秒，平均2.70秒/轮；单独一轮2.79秒。UI计算在Worker中，地图/界面不在主线程做全港迭代。连续30轮Node检查52.036秒，初始轮较慢，后期约1秒；这是Node记录，不冒称Worker实测。

## 未完成及交接

1. 手动画线与手机两指的实机验收待补。
2. 逐段地铁挤、超过容量下一轮+4格及拥挤感知反馈：优先级6/第二版，未做。新增列车的逐段容量作用也在此范围。
3. 港铁客流层显示Task51基准分配；已算新线人数，尚未将全港乘客逐段重新分配到新旧各段。
4. 切关卡由任务53接入；第五站导航、最后审/调/验收/提交由Claude整合。

本次交付完成第一版引擎检查及真实地图/建造/图层/四时段。以上未完成项如实保留。
