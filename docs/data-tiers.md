# 数据与参数可信度分级 / Data & Parameter Confidence Tiers

> 本页由 `model/registry/build_doc.py` 根据 `model/registry/data_tiers.toml` 自动生成，**不要手改**；改登记表后重新运行。
> Generated from `model/registry/data_tiers.toml` by `model/registry/build_doc.py` — **do not edit by hand**.

## 四个级别 / The four tiers

| 级别 Tier | 名称 | Name | 含义 | Meaning |
|---|---|---|---|---|
| 🟢 **A** | 实测 | Measured | 官方直接公布的数字，可直接引用 | Published official figures; can be quoted directly |
| 🔵 **B** | 校准推算 | Calibrated | 模型算出、已与官方数字对账，并写明误差 | Computed by the model and checked against official figures, error stated |
| 🟠 **C** | 依据推断 | Evidence-based estimate | 无本地实测，按有出处的资料推出；仅供参考 | No local measurement; derived from cited sources; for reference only |
| 🔴 **D** | 示意假设 | Illustrative assumption | 无可靠出处、按常理取值，只为让计算能跑、演示规律；仅供学习，不可用于真实决策 | No reliable source; a plausible value so the calculation runs and shows the mechanism; for learning only, never for real decisions |

**结果的级别 = 它用到的最差那个数据的级别**（链子的强度取决于最弱的一环）。例如回本年数用到 C 级造价，就是 C 级结果。
**A result is only as trustworthy as its weakest input**: a payback period that uses a tier-C cost is a tier-C result.

## 统计 / Summary

| 类别 Kind | 🟢 A | 🔵 B | 🟠 C | 🔴 D | 合计 Total |
|---|---|---|---|---|---|
| 数据集 Dataset | 27 | 6 | 2 | 0 | 35 |
| 模型产物 Model output | 2 | 18 | 3 | 4 | 27 |
| 参数 Parameter | 7 | 13 | 16 | 19 | 55 |

## 🟢 A · 实测 / Measured（36）

| ID | 名称 | Name | 类别 Kind | 数值 Value | 来源 / 依据 Source | 状态 Status | 说明 | Note |
|---|---|---|---|---|---|---|---|---|
| A01 | 2021 人口普查小规划统计区 | 2021 Population Census, small areas | 数据集 Dataset |  | 政府统计处（经 CSDI）；2021 | 在用 in use |  |  |
| A02 | 规划署人口分布推算表 | PlanD population distribution projections | 数据集 Dataset |  | 规划署；2021—2031 推算表 | 在用 in use | 官方预测值，不是实测；2026 年总数改用统计处年中估计（规划署推算高 1.04%） | Official projection, not a measurement; the 2026 total uses the C&SD mid-year estimate (PlanD was 1.04% higher) |
| A03 | 统计处人口与年龄表 | C&SD population and age tables | 数据集 Dataset |  | 政府统计处；表 110-01001／01002／01003 | 在用 in use |  |  |
| A04 | 住户、收入与房屋统计表 | Household, income and housing tables | 数据集 Dataset |  | 政府统计处；表 130-06601／06603／06606／06806；文件版本未核实 | 在用 in use |  |  |
| A05 | 全港人口就业分布基准 TPEDM | PlanD TPEDM population & employment base | 数据集 Dataset |  | 规划署；2021 基准；含 2026、2031 | 在用 in use | 官方模型的推算值，不是实测 | Output of an official model, not a measurement |
| B01 | 2024 土地用途格网及统计表 | 2024 land utilisation grid and statistics | 数据集 Dataset |  | 规划署；2024 | 在用 in use |  |  |
| B02 | 法定规划图则与用途地带 | Statutory plans and zones | 数据集 Dataset |  | 城市规划委员会；现存 153 张图则 | 在用 in use | 图则本身是官方的；由它推出的可建楼面见 K25（C 级） | The plans are official; floor space derived from them is K25 (tier C) |
| B03 | 差饷物业租值、存量与楼价表 | RVD rateable values, stock and prices | 数据集 Dataset |  | 差饷物业估价署；2024—2026 文件系列 | 在用 in use |  |  |
| C02 | 私人楼宇用途登记 | Private building use records (BD) | 数据集 Dataset |  | 屋宇署；下载版本未核实 | 在用 in use |  |  |
| C05 | 各区酒店房间数 | Hotel rooms by district | 数据集 Dataset |  | 旅游事务署；2026（文件内 Year） | 在用 in use |  |  |
| D01 | 运输署第二代道路网及附属图层 | TD road network (2nd generation) and layers | 数据集 Dataset |  | 运输署；第二代道路网；文件版本未核实 | 在用 in use |  |  |
| E01 | 运输署官方 GTFS 公交时刻与班距 | TD official GTFS timetables | 数据集 Dataset |  | 运输署；本地压缩包版本未核实 | 在用 in use |  |  |
| F01 | 2022 年出行特征调查 TCS | Travel Characteristics Survey 2022 | 数据集 Dataset |  | 运输署；2022 调查；2025 报告版本 | 在用 in use |  |  |
| F02 | 2011 年货车出行特征调查 | Goods Vehicle Trip Characteristics Survey 2011 | 数据集 Dataset |  | 运输署；2011 | 在用 in use |  |  |
| F03 | 运输规划及设计手册 TPDM | Transport Planning and Design Manual (TPDM) | 数据集 Dataset |  | 运输署；第一、二、六、九册（本地文件） | 在用 in use | 官方设计标准；把设计流量当通行能力用是一种假设 | Official design standard; using design flows as capacities is itself an assumption |
| G01 | 周年交通普查 ATC | Annual Traffic Census (ATC) | 数据集 Dataset |  | 运输署；2018—2024 | 在用 in use |  |  |
| G02 | 战略道路探测器车流与车速 | Strategic-road detectors: flow and speed | 数据集 Dataset |  | 运输署／DATA.GOV.HK；本地多日快照，日期见文件名 | 在用 in use | 实测；2026-09-26 前车流多算一倍（已修），车速不受影响 | Measured; flows were doubled before 2026-09-26 (fixed), speeds unaffected |
| G03 | 运输署交通月报／交通摘要 | TD Monthly Traffic and Transport Digest | 数据集 Dataset |  | 运输署；2011／2026-06 文件系列 | 在用 in use |  |  |
| H01 | 口岸每日出入境人次 | Daily control-point passenger counts | 数据集 Dataset |  | 入境事务处；至 2026-09-16 的本地快照（审计） | 在用 in use |  |  |
| H03 | 跨境车辆月报表 | Cross-boundary vehicles (monthly) | 数据集 Dataset |  | 运输署；2011／2026-06 文件系列 | 在用 in use |  |  |
| I01 | 隧道及收费道路收费表 | Tunnel and toll-road charges | 数据集 Dataset |  | 运输署（道路网附表）；道路网文件现行版本 | 在用 in use |  |  |
| I02 | 市区的士收费及参考文件 | Urban taxi fares and references | 数据集 Dataset |  | 运输署／立法会；2024 收费；参考文件 2017—2025 | 在用 in use |  |  |
| I03 | 港铁站对车费 | MTR station-to-station fares | 数据集 Dataset |  | 港铁公司；文件版本未核实 | 在用 in use |  |  |
| I04 | 综合消费物价指数 | Composite Consumer Price Index | 数据集 Dataset |  | 政府统计处；表 510-60001 | 在用 in use |  |  |
| J01 | 地政总署底图和繁体标签 | LandsD base map and Chinese labels | 数据集 Dataset |  | 地政总署（CSDI）；本地缓存／打包版本 | 在用 in use |  |  |
| J02 | 官方地名与地点索引 | Official place names and index | 数据集 Dataset |  | 地政总署／GTFS 来源；官方地名版本未核实 | 在用 in use |  |  |
| J03 | 十八区行政边界 | 18 district boundaries | 数据集 Dataset |  | 地政总署／政府地理资料；边界文件版本未核实 | 在用 in use |  |  |
| K02 | 2022 出行调查参数表 | TCS 2022 parameter table | 模型产物 Model output |  | 模型步骤 20；2022 报告参数 | 在用 in use | 从出行调查报告表格提取，合计核对通过 | Extracted from the TCS report tables; totals check out |
| K19 | 交通月报时间序列 | Monthly digest time series | 模型产物 Model output |  | 模型步骤 30；2013—2026 本地月报 | 在用 in use | 运输署月报表格整理 | Tables from the TD monthly digest |
| P.mtr_headways | 港铁早高峰班距（改写社区版） | MTR peak headways (override) | 参数 Parameter | 见代码 MTR_PEAK_HEADWAY_S 秒 s | 港铁官网（`pipeline/39_transit_assignment.py`） | 在用 in use | 社区版东铁 40 班/时、港岛线 18 班/时不对，按官网改 | Community feed had EAL 40/h and ISL 18/h; replaced with MTR's own figures |
| P.capacity_tpdm | 道路通行能力（每车道设计流量） | Road capacity (design flow per lane) | 参数 Parameter | TPDM 第二册表 2.4.1.1 辆/小时 veh/h | 运输规划及设计手册（`pipeline/15_road_network.py`） | 在用 in use | 官方设计标准；当作通行能力用是假设 | Official design standard; using it as capacity is an assumption |
| P.heavy_reduction | 重型车多时通行能力折减 | Capacity cut for heavy vehicles | 参数 Parameter | TPDM 第二册表 2.4.1.2 | 运输规划及设计手册（`pipeline/27_road_assignment.py`） | 在用 in use | 15–20% 减 7%，20% 以上减 10% | 7% cut at 15-20% heavy, 10% above 20% |
| G.train_capacity | 每列车载客量 | Passengers per train | 参数 Parameter | 待定 人（demo 临时值 2000，🔴D） | 待查 / to research | 待查 to research | 港铁公布的列车载客量（按每平方米站立人数口径） | MTR's published train capacity |
| G.emission_factor_vehicle | 车辆每公里碳排放系数 | Vehicle CO2 per km | 参数 Parameter | 待定 g CO2/km（demo 临时值 0.19，🔴D） | 待查 / to research | 待查 to research | 环保署排放清单 / EMFAC-HK | EPD inventory / EMFAC-HK |
| G.grid_factor | 电网每度电碳排放 | Grid CO2 per kWh | 参数 Parameter | 待定 kg CO2/kWh（demo 临时值 0.6，🔴D） | 待查 / to research | 待查 to research | 中电、港灯公布值 | CLP / HK Electric published values |
| G.children_share | 各分区儿童比例 | Share of children by zone | 参数 Parameter | landuse-2026.parquet 的 age_0_14 列 % | 2021 人口普查，经第 16 步推到 2026 | 在用 in use | 人口普查表直接补 | Straight from the census tables |

## 🔵 B · 校准推算 / Calibrated（37）

| ID | 名称 | Name | 类别 Kind | 数值 Value | 来源 / 依据 Source | 状态 Status | 说明 | Note |
|---|---|---|---|---|---|---|---|---|
| C01 | 全港建筑物位置、高度与推算楼面 | Buildings: footprint, height and estimated floor area | 数据集 Dataset |  | 地政总署（CSDI）；下载版本未核实 | 在用 in use | 建筑几何为实测；楼面 = 占地 × 层数，已与差饷署分区存量对账（写字楼 1.39 倍、零售 1.14 倍，毛/净面积差可解释） | Geometry measured; floor area = footprint x storeys, checked against RVD stock (office 1.39x, retail 1.14x, explained by gross/net) |
| C03 | 学校位置与分区学额 | Schools and school places | 数据集 Dataset |  | 教育局；文件版本未核实 | 在用 in use | 学校位置实测；逐校学额由分区官方学生数分摊（小学、中学合计与官方 100% 吻合） | School locations measured; places per school spread from official district counts (primary/secondary totals match 100%) |
| C04 | 院校、医院与诊所位置 | Tertiary institutions, hospitals and clinics | 数据集 Dataset |  | 教育局／医院管理局；下载版本未核实 | 在用 in use | 设施位置实测；医院楼面、院校学生为推算（相对权重） | Locations measured; hospital floor space and tertiary students are estimates (relative weights) |
| D02 | OpenStreetMap 道路及车道 | OpenStreetMap roads and lanes | 数据集 Dataset |  | OpenStreetMap 贡献者；快照日期未核实 | 在用 in use | 众包数据；车道数已用探测器核对（完全一致 80%，±1 条 95%） | Crowd-sourced; lane counts checked against detectors (80% exact, 95% within one lane) |
| E03 | 统一公共交通时刻表 | Merged public transport timetable | 数据集 Dataset |  | 运输署＋社区版（17b 合并）；2026 模型版本 | 在用 in use | 官方 GTFS 全用 + 社区版只取港铁/轻铁；补时与班距改写有记录 | All of the official GTFS + only MTR/LRT from the community feed; gap filling and headway fixes are logged |
| H02 | 跨境学童人数及使用口岸 | Cross-boundary students and their crossings | 数据集 Dataset |  | 教育局；本地文件年份按 School Year 栏 | 在用 in use | 官方总数 + 按口岸归口分配 | Official totals + allocation to crossings |
| K01 | 2026 分区土地利用与人口表 | 2026 zone land use and population | 模型产物 Model output |  | 模型步骤 16；2026 | 在用 in use | 全港与各年龄段总数对准统计处（差 0.00%）；18 区最大偏差 1.16%；交通分区约 ±15–20% | Totals match C&SD (0.00%); 18 districts within 1.16%; traffic zones about ±15-20% |
| K03 | 分区与建筑物出行端点 | Trip ends by zone and building | 模型产物 Model output |  | 模型步骤 21；2026 工作日 | 在用 in use | 按出行调查附录表 A.2 各区总量校准（机动化 1,231 万 vs 调查 1,236 万） | Calibrated to TCS Table A.2 by district (12.31 M motorised trips vs 12.36 M surveyed) |
| K04 | 可路由道路网与分区接驳 | Routable road network and zone connectors | 模型产物 Model output |  | 模型步骤 15；2026 基础网络 | 在用 in use | 几何实测；车道 OSM（已核对）；通行能力按 TPDM 设计流量 | Geometry measured; lanes from OSM (checked); capacities from TPDM design flows |
| K05 | 普查站对应路段 | Census stations matched to links | 模型产物 Model output |  | 模型步骤 15c；2026 路网对应关系 | 在用 in use | 356 个普查方向中 355 个配到路段 | 355 of 356 census directions matched to links |
| K06 | 逐路段逐小时车速 | Hourly speeds by link | 模型产物 Model output |  | 模型步骤 15d；本地多日观测合成 | 在用 in use | 有探测器的路段为实测；其余按同类道路比例推算 | Measured where there is a detector; elsewhere by road-class factors |
| K07 | 道路拥堵曲线参数 | Congestion (BPR) curve parameters | 模型产物 Model output |  | 模型步骤 15e；本地工作日样本 | 在用 in use | 680 个探测器拟合，加权误差 3%（原教科书值 8.4%） | Fitted to 680 detectors, weighted error 3% (textbook values 8.4%) |
| K08 | 自由流小汽车时间矩阵 | Free-flow car travel-time matrix | 模型产物 Model output |  | 模型步骤 17；2026 基础网络 | 在用 in use | 在已核对的路网上算最短路 | Shortest paths on the checked network |
| K09 | 公交、步行、自行车时间矩阵 | Public transport / walk / cycle time matrices | 模型产物 Model output |  | 模型步骤 18；2026-09 工作日早间时刻窗 | 在用 in use | R5 按真实班次表路由；与调查自报时间的比例 r = 1.28 | R5 routing on the real timetables; ratio to reported times r = 1.28 |
| K10 | 工作日出行分布矩阵 | Weekday trip distribution matrices | 模型产物 Model output |  | 模型步骤 22；2026 工作日 | 在用 in use | 对准出行调查表 3.4（±6%）与 3.5（±1 个百分点） | Matches TCS Table 3.4 (±6%) and 3.5 (±1 point) |
| K11 | 交通方式划分矩阵 | Mode split matrices | 模型产物 Model output |  | 模型步骤 23；2026 工作日 | 在用 in use | 各方式份额对准出行调查附录 A.3；的士对准运输署载客数 | Mode shares match TCS Appendix A.3; taxis match TD passenger counts |
| K12 | 早高峰出行与车辆矩阵 | AM-peak person and vehicle matrices | 模型产物 Model output |  | 模型步骤 24；2026 工作日 08:00—09:00 | 在用 in use | 每车人数来自普查；车种组成与普查一致 | Occupancy from the census; vehicle mix matches the census |
| K13 | 巴士与小巴道路预加载 | Bus and minibus road preload | 模型产物 Model output |  | 模型步骤 25；2026 工作日 08:00—09:00 | 在用 in use | 巴士 模型/普查 0.84（已知局限：班次表外的车、走线） | Buses model/census 0.84 (known limitation: off-timetable buses, routing) |
| K14 | 货车与跨境车辆需求 | Goods and cross-boundary vehicle demand | 模型产物 Model output |  | 模型步骤 26；2026 工作日 | 在用 in use | 2011 年调查外推到 2026；车种组成与 2024 普查一致 | 2011 survey extrapolated to 2026; vehicle mix matches the 2024 census |
| K15 | 早高峰道路分配结果 | AM-peak road assignment | 模型产物 Model output |  | 模型步骤 27；2026 工作日 08:00—09:00 | 在用 in use | 全港总量 0.96；走廊 GEH<5 29%（目标 60%，未达标） | Total 0.96 of census; corridor GEH<5 29% (target 60%, not met) |
| K16 | 拥堵反馈时间矩阵 | Congestion feedback delay matrix | 模型产物 Model output |  | 模型步骤 27b；2026 早高峰反馈 | 在用 in use | 回代 1 轮稳定（相差 0.7%）；时段权重含 C 级假设 | Settled in one round (0.7% gap); the time-of-day weights carry a tier-C assumption |
| K17 | 全天的士叫车请求 | Daily taxi requests | 模型产物 Model output |  | 模型步骤 28；2026 工作日全天 | 在用 in use | 锚定运输署的士载客数（已停做的车队方向） | Anchored to TD taxi passenger counts (fleet direction, discontinued) |
| K24 | 2024 土地用途分区汇总 | 2024 land use by zone | 模型产物 Model output |  | 模型步骤 36；2024 格网／2026 分区 | 在用 in use | 27 类与统计表逐类对账（差 ≤0.65 km²） | All 27 classes reconcile with the statistics (within 0.65 km²) |
| K27 | 早高峰公共交通分配结果 | AM-peak public transport assignment | 模型产物 Model output |  | 模型步骤 39；2026 工作日早高峰 | 在用 in use | 港铁最繁忙段 模型/立法会：东铁 1.37、荃湾 0.93、屯马 1.01 等；不含拥挤 | MTR busiest links model/LegCo: EAL 1.37, TWL 0.93, TML 1.01 ...; no crowding |
| P.bpr_alpha | 塞车曲线系数 alpha | BPR alpha | 参数 Parameter | 0.3776 | 运输署探测器 20 个工作日（`pipeline/15e_bpr_calibration.py`） | 在用 in use | 加权最小二乘拟合，误差 3% | Weighted least squares, 3% error |
| P.tunnel_queue_min | 隧道串排队时间 | Tunnel queue time scale | 参数 Parameter | 6 分钟 min | 扫描 0/6/12/20 对隧道普查车流（`pipeline/27_road_assignment.py`） | 在用 in use | 6 分钟走廊吻合最好 | 6 minutes fitted the corridor counts best |
| P.toll_weight | 收费权重 | Toll weight | 参数 Parameter | 0.2 | 扫描 7 档对普查车流（`pipeline/27_road_assignment.py`） | 在用 in use | 收费按时间价值折成分钟再乘此权重 | Tolls converted to minutes by value of time, then weighted |
| P.time_scale_r | 自报时间 ÷ 模型时间 r | Reported / modelled time r | 参数 Parameter | 1.28 | 出行调查表 3.4、3.5（`pipeline/22_trip_distribution.py`） | 在用 in use | 黄金分割搜索 | Golden-section search |
| P.harbour_k | 过海系数 K | Cross-harbour factor K | 参数 Parameter | 0.617 | 出行调查表 3.4 过海比例（`pipeline/22_trip_distribution.py`） | 在用 in use | 二分法对准过海出行占 15.9% | Bisection to the 15.9% cross-harbour share |
| P.area_factors | 九个主要地区的区内系数 | Intra-area factors (9 main areas) | 参数 Parameter | Hong Kong Island 1；Kowloon 1.076；Tsuen Wan/Kwai Tsing 1.383；Tuen Mun 1.161；Yuen Long/Tin Shui Wai 0.5192；Fanling/Sheung Shui 0.7428；Tai Po 1.404；Sha Tin/Ma On Shan 2.342；Tseung Kwan O 1.29；North Lantau 0.5387 | 出行调查表 3.5 自给率（`pipeline/22_trip_distribution.py`） | 在用 in use | 代替模型还没有的铁路拥挤；沙田 2.34 最大 | Stand in for the missing rail crowding; Sha Tin 2.34 the largest |
| P.mode_sensitivity | 方式选择对时间的敏感度 | Mode-choice time sensitivity | 参数 Parameter | 0.06337 每广义分钟 per generalised min | 出行调查表 5.2（`pipeline/23_mode_choice.py`） | 在用 in use | 拟合「多几分钟会改方式」三点 | Fitted to the three stated-switching points |
| P.taxi_fare_weight | 的士车费权重 | Taxi fare weight | 参数 Parameter | 0.1693 | 普查的士车公里占比（`pipeline/23_mode_choice.py`） | 在用 in use | 二分法对准的士车公里占比 25.4% | Bisection to the 25.4% taxi share of vehicle-km |
| P.vot | 时间价值（分目的、有车/无车） | Values of time | 参数 Parameter | HBW_pv 1.399；HBW_nopv 0.922；HBS_pv 1.092；HBS_nopv 0.721；HBO_pv 1.071；HBO_nopv 0.837；NHB_pv 1.071；NHB_nopv 0.837 港元/分钟 HK$/min | 出行调查 2022 表值 × 综合消费物价指数（`pipeline/23_mode_choice.py`） | 在用 in use | 调查值换算到 2026 价格 | Survey values brought to 2026 prices |
| P.goods_rho_light | 轻型货车距离系数 rho | Light goods rho | 参数 Parameter | 2.73 | 货车调查表 4.3 + 车公里（`pipeline/26_goods_and_boundary_vehicles.py`） | 在用 in use | 两段拟合 | Two-stage fit |
| P.goods_rho_heavy | 中重型货车距离系数 rho | Heavy goods rho | 参数 Parameter | 3.429 | 货车调查表 4.3（`pipeline/26_goods_and_boundary_vehicles.py`） | 在用 in use | 只拟合地域比例 | Fitted to the regional shares only |
| P.bus_time_factor | 巴士车上时间系数 | Bus in-vehicle time factor | 参数 Parameter | 1.5 | 按港铁 7 条线最繁忙段扫描（`pipeline/39_transit_assignment.py`） | 在用 in use | 反映班次表外的塞车与不准时 | Covers congestion and unreliability the timetable omits |
| G.jobs_per_m2 | 每平方米写字楼/零售楼面对应岗位 | Jobs per m² of office/retail floor | 参数 Parameter | 待定 m²/岗 | 待查 / to research | 在用 in use | 沿用第 21 步回归（写字楼 22、零售 24 m²/岗） | Reuse step 21's regression (office 22, retail 24 m² per job) |

## 🟠 C · 依据推断 / Evidence-based estimate（21）

| ID | 名称 | Name | 类别 Kind | 数值 Value | 来源 / 依据 Source | 状态 Status | 说明 | Note |
|---|---|---|---|---|---|---|---|---|
| B04 | 规划及自动驾驶政策参考文件 | Planning and autonomous-vehicle policy references | 数据集 Dataset |  | 规划署／立法会／相关部门；2017—2030（按文件名） | 在用 in use | 政策参考文件，不是逐条数据 | Policy documents for reference, not item-level data |
| E02 | 社区版香港 GTFS | Community Hong Kong GTFS | 数据集 Dataset |  | wheelstransit／OpenStreetMap 社区；2026-09-15 下载（文档） | 在用 in use | 众包时刻表；港铁班距有错，已用官网班距改写（见 E03、39） | Crowd-sourced timetable; its MTR headways were wrong and are overridden (see E03, step 39) |
| K20 | 的士车队逐小时仿真 | Taxi fleet simulation | 模型产物 Model output |  | 模型步骤 31；2026 工作日 | 在用 in use | 分钟级仿真，与第 29 步边界交叉核对（已停做的车队方向） | Minute-level simulation, cross-checked with step 29 bounds (fleet direction, discontinued) |
| K25 | 法定用途地带与可建楼面 | Zoning and buildable floor space | 模型产物 Model output |  | 模型步骤 37；现存图则／2026 分区 | 在用 in use | 65% 的地积比从图则注释提取，35% 用规划标准默认值（乡村式发展按 1.0 估计） | 65% of plot ratios from the plan notes, 35% planning-standard defaults (village type estimated at 1.0) |
| K26 | 2026 分区物业价值 | 2026 property values by zone | 模型产物 Model output |  | 模型步骤 38；2026 分区 | 在用 in use | 行政区数值下推到交通分区，分区内无差别 | District values pushed down to zones, no variation within a district |
| P.bpr_beta | 塞车曲线指数 beta | BPR beta | 参数 Parameter | 2 | 判断取值（`pipeline/15e_bpr_calibration.py`） | 在用 in use | 数据自由拟合约 1.3；为保留超载约束取 2 | A free fit gives about 1.3; fixed at 2 to keep the capacity restraint |
| P.delay_weights | 各目的一天遇到的塞车（早高峰的倍数） | Daily congestion exposure by purpose | 参数 Parameter | HBW 0.804；HBS 0.801；HBO 0.743；NHB 0.811 | 出行调查逐小时比例 + 普查逐小时车流（`pipeline/27b_congested_skim.py`） | 在用 in use | 假设各小时塞车 = (车流比)^beta | Assumes hourly delay = (flow ratio)^beta |
| P.walk_mps | 公交接驳步行速度（含绕路） | Transit access walking speed (incl. detours) | 参数 Parameter | 1 m/s | 常用步速约 1.2–1.4 m/s，折算绕路（`pipeline/39_transit_assignment.py`） | 在用 in use |  |  |
| G.cost_tunnel_km | 地铁隧道段每公里造价 | Rail cost per km, tunnel | 参数 Parameter | 待定 亿港元/公里（demo 临时值 30，🔴D） | 待查 / to research | 待查 to research | 立法会文件中近年港铁项目实际造价换算；须落在真实项目范围内 | From LegCo papers on recent MTR projects; must sit within real projects' range |
| G.cost_viaduct_km | 地铁高架段每公里造价 | Rail cost per km, viaduct | 参数 Parameter | 待定 亿港元/公里（demo 临时值 15，🔴D） | 待查 / to research | 待查 to research | 同上 | As above |
| G.cost_atgrade_km | 地铁地面段每公里造价 | Rail cost per km, at grade | 参数 Parameter | 待定 亿港元/公里（demo 临时值 8，🔴D） | 待查 / to research | 待查 to research | 同上 | As above |
| G.cost_station | 每个车站造价 | Cost per station | 参数 Parameter | 待定 亿港元/站（demo 临时值 10，🔴D） | 待查 / to research | 待查 to research | 同上 | As above |
| G.opex_car_km | 每车公里运营成本 | Operating cost per car-km | 参数 Parameter | 待定 港元（demo 临时值 300，🔴D） | 待查 / to research | 待查 to research | 港铁年报 | MTR annual reports |
| G.price_premium | 车站附近楼价溢价（随距离递减） | Property price premium near stations (distance decay) | 参数 Parameter | 待定 % | 待查 / to research | 待查 to research | 香港相关学术研究；有上限、随距离递减、不出现负值 | Hong Kong studies; capped, decaying with distance, never negative |
| G.commercial_uplift | 新线带动周边商业的弹性 | Commercial uplift elasticity | 参数 Parameter | 待定 | 待查 / to research | 待查 to research | 文献；查不到则降为 D | Literature; tier D if nothing reliable is found |
| G.embodied_carbon | 建造期隐含碳（每公里隧道/高架） | Embodied carbon per km of tunnel/viaduct | 参数 Parameter | 待定 吨 CO2/公里 | 待查 / to research | 待查 to research | 文献经验系数，单独列出 | Literature factors, reported separately |
| G.discount_rate | 贴现率 | Discount rate | 参数 Parameter | 待定 %（demo 临时值 0.04，🔴D） | 待查 / to research | 待查 to research | 政府项目评估指引（找到则 C，否则 D） | Government appraisal guidance (C if found, else D) |
| G.nested_logit | 嵌套 logit 嵌套系数 | Nested logit nesting coefficient | 参数 Parameter | 待定 | 待查 / to research | 待查 to research | 文献值，须在 0–1 之间 | Literature; must lie in 0-1 |
| G.induced_demand | 诱发需求弹性（车公里对出行时间） | Induced demand elasticity (VKT to travel time) | 参数 Parameter | 待定 | 待查 / to research | 待查 to research | 文献；方向必须是路越快车越多 | Literature; faster roads must mean more traffic |
| G.train_kinematics | 列车最高速度、加减速度、停站时间 | Train top speed, acceleration, dwell time | 参数 Parameter | 待定 | 待查 / to research | 待查 to research | 港铁或文献常用设计值；草案示意 100 km/h、1.0 m/s²、40 秒 | MTR or literature design values; draft uses 100 km/h, 1.0 m/s², 40 s |
| G.walk_catchment | 车站步行服务范围 | Station walking catchment | 参数 Parameter | 待定 分钟 / 米 | 待查 / to research | 待查 to research | TOD 常用约 10 分钟 / 800 米；原型用 1.5 公里上限；待找出处 | TOD practice about 10 min / 800 m; the prototype caps at 1.5 km; source pending |

## 🔴 D · 示意假设 / Illustrative assumption（23）

| ID | 名称 | Name | 类别 Kind | 数值 Value | 来源 / 依据 Source | 状态 Status | 说明 | Note |
|---|---|---|---|---|---|---|---|---|
| K18 | 的士车队逐小时供给 | Hourly taxi fleet supply | 模型产物 Model output |  | 模型步骤 29；2026 工作日 | 在用 in use | 运营率情景，属假设（已停做的车队方向） | Utilisation scenarios, assumptions (fleet direction, discontinued) |
| K21 | 无人车分区投放情景 | Autonomous-vehicle deployment scenarios | 模型产物 Model output |  | 模型步骤 32；2026 工作日 | 在用 in use | 投放情景，属假设（已停做） | Deployment scenarios, assumptions (discontinued) |
| K22 | 夜间与配额扩展情景 | Night and quota scenarios | 模型产物 Model output |  | 模型步骤 34；2026 工作日 | 在用 in use | 政策情景，属假设（已停做） | Policy scenarios, assumptions (discontinued) |
| K23 | 换更与充电规则情景 | Shift and charging scenarios | 模型产物 Model output |  | 模型步骤 35；2026 工作日 | 在用 in use | 运营规则情景，属假设（已停做） | Operating-rule scenarios, assumptions (discontinued) |
| P.connector_kph | 分区接驳车速 | Zone connector speed | 参数 Parameter | 25 km/h | 建模取值（`pipeline/17_car_skim.py`） | 在用 in use | 代表从楼宇开到主路的速度，无直接出处 | Speed from building to main road; no direct source |
| P.station_group_m | 车站归入港铁站的半径 | Radius to group stops into an MTR station | 参数 Parameter | 200 m | 建模取值（`pipeline/39_transit_assignment.py`） | 在用 in use | 让巴士站和港铁站之间能换乘 | Lets bus stops and MTR stations interchange |
| P.wet_limit_m | 接驳直线允许跨水长度 | Water a connector may cross | 参数 Parameter | 30 m | 建模规则（`pipeline/15_road_network.py`） | 在用 in use | 超过即视为隔海，不接 | More than this counts as across the water |
| P.hbo_from_home | 其他目的出行中从家出发的比例 | Share of HBO trips starting from home | 参数 Parameter | 0.7 | 假设（`pipeline/24_peak_hour.py`） | 在用 in use | 调查没有直接给出 | Not given directly by the survey |
| P.game_pop_elasticity | 人口随可达性搬迁的弹性（快速版小游戏） | Population-accessibility elasticity (quick game) | 参数 Parameter | 0.5 | 估计（`game-demo/sim.js`） | 在用 in use | 可达性变 1%，人口变 0.5%；约 10–15 年效果；待用文献或历史线路替换 | 1% accessibility change -> 0.5% population; to be replaced from literature or past lines |
| G.relocation_elasticity | 人口长远搬迁弹性（正式版） | Long-run relocation elasticity (full version) | 参数 Parameter | 待定 | 待查 / to research | 待查 to research | 文献或用过去线路（西铁、将军澳线、南港岛线）拟合；受图则可建楼面约束 | Literature or past lines; bounded by zoning capacity |
| G.carbon_price | 碳价 | Carbon price | 参数 Parameter | 待定 港元/吨（demo 临时值 400，🔴D） | 待查 / to research | 待查 to research | 政策取值，用户可改 | A policy choice, user-adjustable |
| X.junction_tia | 路口级交通影响评估 | Junction-level traffic impact | 参数 Parameter | 不做 |  | 不做 excluded | 455 分区宏观模型做不到路口级，明确不涵盖 | Out of scope for a 455-zone macro model |
| X.bus_bunching | 巴士串车 | Bus bunching | 参数 Parameter | 不做 |  | 不做 excluded | 模型没有车辆层面，明确不涵盖 | No vehicle-level simulation; out of scope |
| P.crowding_factor | 公交拥挤系数（感受车上时间的倍数） | Transit crowding factor (perceived in-vehicle time multiplier) | 参数 Parameter | 载客/运力 ≤0.8 为 1；0.8–1.2 线性升到 1.6；>1.2 为 1.6+4×(ρ−1.2) | 修地铁原型取值（`game-demo/sim.js`） | 在用 in use | 原型里的示意取值；待用文献（如拥挤惩罚研究）升级为 C | Prototype value; to be upgraded to C from crowding-penalty literature |
| P.transfer_penalty_min | 换乘惩罚 | Transfer penalty | 参数 Parameter | 3 分钟 min | 修地铁原型取值（`game-demo/sim.js`） | 在用 in use | 不含步行时间的额外不便；待文献 | Extra inconvenience beyond walking; literature pending |
| D.train_energy_kwh_km | 列车每公里耗电 | Train energy per train-km | 参数 Parameter | 20 kWh/列车公里 | 临时值（demo）（`game/engine/params.py`） | 在用 in use | 待任务 44 用港铁可持续发展报告替换 | Placeholder until task 44 (MTR sustainability report) |
| D.land_capture_share | 站旁开发地价中政府/铁路可取得的比例 | Share of station-area development value captured | 参数 Parameter | 0.3 | 临时值（demo）（`game/engine/params.py`） | 在用 in use | 铁路加物业的地价回收比例；待文献 | Rail-plus-property capture share; literature pending |
| D.appraisal_years | 评估年限 | Appraisal period | 参数 Parameter | 40 年 | 临时值（demo），常见 30–50 年（`game/engine/params.py`） | 在用 in use | 发起人待定 | To be decided |
| D.route_split_per_min | 新旧公交路线之间的选择敏感度 | Route-choice sensitivity between new and old transit paths | 参数 Parameter | 0.5 每分钟 per min | 修地铁原型取值（`game/engine/transit.py`） | 在用 in use | 平滑分配，避免全有全无；待文献 | Smooth split instead of all-or-nothing; literature pending |
| D.route_cutoff_min | 比原走法慢多少分钟就没人走新线 | Minutes slower than the old way beyond which nobody takes the new line | 参数 Parameter | 10 分钟 min | 临时值（demo）（`game/engine/transit.py`） | 在用 in use | 和 D.route_split_per_min 一起决定新旧走法的分流；待文献 | With D.route_split_per_min, decides the split between old and new paths; literature pending |
| D.service_pattern | 列车开行模式（算列车公里） | Train service pattern (for train-km) | 参数 Parameter | 高峰班次开 4 小时，另 14 小时班次减半，每年 365 天 | 临时值（demo），按港铁一般运营时间估（`game/engine/evaluate.py`） | 在用 in use | 影响运营费和列车用电碳排；待任务 44 用港铁年报替换 | Drives operating cost and traction carbon; to be replaced from MTR annual reports (task 44) |
| D.dev_packages | 站旁开发套餐的楼面面积 | Station-area development package floor areas | 参数 Parameter | 住宅为主 40 万㎡；写字楼/商场为主 25 万㎡；住宅+商业 25 万 + 10 万㎡ | 临时值（demo），参照港铁物业项目的一般规模（`game/engine/scenario.py`） | 在用 in use | 每平方米住多少人、多少岗位用 2026 基准的全港平均（landuse-2026） | Residents and jobs per m2 are the 2026 base's territory averages (landuse-2026) |
| D.scenario_north | 情境题「北都人口大增」的设定 | Scenario 'Northern Metropolis population boom' settings | 参数 Parameter | 元朗、北区新增 20 万居民（按法定图则剩余住宅楼面分到各分区），预算 1500 亿港元 | 题目设定（demo），不是预测（`game/engine/scenario.py`） | 在用 in use | 剩余楼面 = zoning-capacity 的住宅上限 − landuse-2026 现有住宅楼面 | Spare floor area = zoning-capacity domestic cap minus existing residential GFA (landuse-2026) |

数据集与模型产物的详细描述（条数、字段、用在哪一步）见 [`data-sources.md`](data-sources.md)；每一步的方程与拟合见 [`methods-catalogue.md`](methods-catalogue.md)。
Details of every dataset are in `data-sources.md`; equations and calibration in `methods-catalogue.en.md`.
