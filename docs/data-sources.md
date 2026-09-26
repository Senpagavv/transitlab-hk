# TransitLab HK 数据来源总目录

> 核对日期：2026-09-26（Codex 按 `docs/for-codex/task-42-data-source-inventory.md` 只读整理；Claude 同日核对并补入下午的改动）。每个数字从哪读出来的见 [`data-sources-verification.md`](data-sources-verification.md)。项目路径 `F:\transitlab-hk`；本稿只读检查现有文件、步骤开头说明与审计报告。另一个模型进程可能继续更新文件，因此这是检查时点的目录。

**怎么读：**“来源”指一组同机构、同用途的数据；同一来源可能含多个表。**交通分区**是模型汇总出行的地理小块，原始普查有 211 个小区，模型内部有 455 个，另加 15 个口岸后有 470 个出行端点。**四阶段模型**依次估算出行从哪产生、去哪、用什么方式、走哪条路。**实测**是政府或设施发布的观测／登记数字；**推算**是用这些资料计算的结果；**估算**含明确假设。文件格式中，**GeoJSON** 是带地理形状的 JSON，**Parquet** 是压缩表格，**GTFS** 是公共交通时刻及站点的标准资料包，**GDB** 是地理图层资料库，**NPZ** 是多个数字矩阵的压缩包。**早高峰**在这里指工作日 08:00—09:00；**班距**是相邻两班车之间的时间。

各小节“用在哪一步”列出来源形成和向后传递的关键脚本；文末“四阶段直接读取”表逐项列出计算脚本打开的输入。网址一栏仅抄录相应 `pipeline/` 代码中明确写出的地址；空白不表示来源没有官网。文件大小为磁盘大小，不等于解压后的数据量。每处计数的读取方法见《核对记录》。

**术语补充：**CSDI 是香港政府共享地图和空间资料的平台；TPEDM 是规划署用人口与就业推算地区分布的模型；TCS 是运输署询问居民出行习惯的调查；ATC 是长期在固定道路位置数车的周年交通普查；AADT 是全年平均每日车流。OpenStreetMap（OSM）是公众共同维护的开放地图；PBF 是它的压缩地图文件。PMTiles 是把许多地图切片装进一个包的格式。TPDM 是运输署供规划交通设施时参考的设计手册；**毛楼面**是建筑各层总面积，包含通道等公用部分。BPR 是“车越多，行车时间越长”的经验曲线；GEH 是拿模型车流与实测车流比较的评分。**法定图则**规定一块地可作什么用途；**地积比**把可建楼面和土地面积相比；**出行端点**是一次旅程的起点或终点。ODbL 是要求修改后的数据库按相同许可共享的开放资料许可证。

## 0. 一页总览

| 编号 | 名称 | 发布机构／生成者 | 年份或版本 | 类别 | 实测／推算 |
|---|---|---|---|---|---|
| A01 | 2021 人口普查小规划统计区 | 政府统计处（经 CSDI） | 2021 | 人口与住户 | 实测（官方数字） |
| A02 | 规划署人口分布推算表 | 规划署 | 2021—2031 推算表 | 人口与住户 | 推算（官方预测） |
| A03 | 统计处人口与年龄表 | 政府统计处 | 表 110-01001／01002／01003 | 人口与住户 | 实测及官方估计 |
| A04 | 住户、收入与房屋统计表 | 政府统计处 | 表 130-06601／06603／06606／06806；文件版本未核实 | 人口与住户 | 实测（官方数字） |
| A05 | 全港人口就业分布基准 TPEDM | 规划署 | 2021 基准；含 2026、2031 | 人口与住户 | 推算（官方模型） |
| B01 | 2024 土地用途格网及统计表 | 规划署 | 2024 | 土地与规划 | 实测分类＋模型汇总 |
| B02 | 法定规划图则与用途地带 | 城市规划委员会 | 现存 153 张图则 | 土地与规划 | 实测图则＋推算可建楼面 |
| B03 | 差饷物业租值、存量与楼价表 | 差饷物业估价署 | 2024—2026 文件系列 | 土地与规划 | 实测（官方统计） |
| B04 | 规划及自动驾驶政策参考文件 | 规划署／立法会／相关部门 | 2017—2030（按文件名） | 土地与规划 | 政策资料（非逐条实测） |
| C01 | 全港建筑物位置、高度与推算楼面 | 地政总署（CSDI） | 下载版本未核实 | 建筑物与设施 | 实测几何＋推算楼面 |
| C02 | 私人楼宇用途登记 | 屋宇署 | 下载版本未核实 | 建筑物与设施 | 实测（官方记录） |
| C03 | 学校位置与分区学额 | 教育局 | 文件版本未核实 | 建筑物与设施 | 实测学校位置＋估算逐校学额 |
| C04 | 院校、医院与诊所位置 | 教育局／医院管理局 | 下载版本未核实 | 建筑物与设施 | 实测设施位置＋估算楼面和学额 |
| C05 | 各区酒店房间数 | 旅游事务署 | 2026（文件内 Year） | 建筑物与设施 | 实测（官方数字） |
| D01 | 运输署第二代道路网及附属图层 | 运输署 | 第二代道路网；文件版本未核实 | 道路网 | 实测（官方地理资料） |
| D02 | OpenStreetMap 道路及车道 | OpenStreetMap 贡献者 | 快照日期未核实 | 道路网 | 众包实测＋缺值估算 |
| E01 | 运输署官方 GTFS 公交时刻与班距 | 运输署 | 本地压缩包版本未核实 | 公共交通 | 实测（官方时刻资料） |
| E02 | 社区版香港 GTFS | wheelstransit／OpenStreetMap 社区 | 2026-09-15 下载（文档） | 公共交通 | 众包时刻资料 |
| E03 | 统一公共交通时刻表 | 运输署＋社区版（17b 合并） | 2026 模型版本 | 公共交通 | 推算（合并与补时） |
| F01 | 2022 年出行特征调查 TCS | 运输署 | 2022 调查；2025 报告版本 | 出行调查与行为参数 | 实测调查汇总 |
| F02 | 2011 年货车出行特征调查 | 运输署 | 2011 | 出行调查与行为参数 | 实测调查汇总 |
| F03 | 运输规划及设计手册 TPDM | 运输署 | 第一、二、六、九册（本地文件） | 出行调查与行为参数 | 设计参数／方法依据 |
| G01 | 周年交通普查 ATC | 运输署 | 2018—2024 | 交通计数与实测 | 实测（官方计数） |
| G02 | 战略道路探测器车流与车速 | 运输署／DATA.GOV.HK | 本地多日快照，日期见文件名 | 交通计数与实测 | 实测（道路探测器） |
| G03 | 运输署交通月报／交通摘要 | 运输署 | 2011／2026-06 文件系列 | 交通计数与实测 | 实测（官方月报） |
| H01 | 口岸每日出入境人次 | 入境事务处 | 至 2026-09-16 的本地快照（审计） | 跨境 | 实测（官方计数） |
| H02 | 跨境学童人数及使用口岸 | 教育局 | 本地文件年份按 School Year 栏 | 跨境 | 实测总量＋模型分配 |
| H03 | 跨境车辆月报表 | 运输署 | 2011／2026-06 文件系列 | 跨境 | 实测（官方月报） |
| I01 | 隧道及收费道路收费表 | 运输署（道路网附表） | 道路网文件现行版本 | 价格与收费 | 实测（法定收费） |
| I02 | 市区的士收费及参考文件 | 运输署／立法会 | 2024 收费；参考文件 2017—2025 | 价格与收费 | 实测费率＋政策参考 |
| I03 | 港铁站对车费 | 港铁公司 | 文件版本未核实 | 价格与收费 | 实测（公开车费表） |
| I04 | 综合消费物价指数 | 政府统计处 | 表 510-60001 | 价格与收费 | 实测（官方价格指数） |
| J01 | 地政总署底图和繁体标签 | 地政总署（CSDI） | 本地缓存／打包版本 | 底图与地名 | 官方地图资料 |
| J02 | 官方地名与地点索引 | 地政总署／GTFS 来源 | 官方地名版本未核实 | 底图与地名 | 实测地名＋索引推算 |
| J03 | 十八区行政边界 | 地政总署／政府地理资料 | 边界文件版本未核实 | 底图与地名 | 官方地理边界 |
| K01 | 2026 分区土地利用与人口表 | 模型步骤 16 | 2026 | 模型推算出来的数据 | 推算（模型算的） |
| K02 | 2022 出行调查参数表 | 模型步骤 20 | 2022 报告参数 | 模型推算出来的数据 | 推算（报告表提取） |
| K03 | 分区与建筑物出行端点 | 模型步骤 21 | 2026 工作日 | 模型推算出来的数据 | 推算（模型算的） |
| K04 | 可路由道路网与分区接驳 | 模型步骤 15 | 2026 基础网络 | 模型推算出来的数据 | 实测几何＋模型推算通行能力 |
| K05 | 普查站对应路段 | 模型步骤 15c | 2026 路网对应关系 | 模型推算出来的数据 | 推算（位置匹配） |
| K06 | 逐路段逐小时车速 | 模型步骤 15d | 本地多日观测合成 | 模型推算出来的数据 | 实测探测器＋未覆盖道路推算 |
| K07 | 道路拥堵曲线参数 | 模型步骤 15e | 本地工作日样本 | 模型推算出来的数据 | 推算（实测拟合） |
| K08 | 自由流小汽车时间矩阵 | 模型步骤 17 | 2026 基础网络 | 模型推算出来的数据 | 推算（最短路径） |
| K09 | 公交、步行、自行车时间矩阵 | 模型步骤 18 | 2026-09 工作日早间时刻窗 | 模型推算出来的数据 | 推算（时刻表路由） |
| K10 | 工作日出行分布矩阵 | 模型步骤 22 | 2026 工作日 | 模型推算出来的数据 | 推算（目的地配平） |
| K11 | 交通方式划分矩阵 | 模型步骤 23 | 2026 工作日 | 模型推算出来的数据 | 推算（选择模型） |
| K12 | 早高峰出行与车辆矩阵 | 模型步骤 24 | 2026 工作日 08:00—09:00 | 模型推算出来的数据 | 推算（全天到高峰换算） |
| K13 | 巴士与小巴道路预加载 | 模型步骤 25 | 2026 工作日 08:00—09:00 | 模型推算出来的数据 | 推算（班距铺路） |
| K14 | 货车与跨境车辆需求 | 模型步骤 26 | 2026 工作日 | 模型推算出来的数据 | 推算（旧调查外推） |
| K15 | 早高峰道路分配结果 | 模型步骤 27 | 2026 工作日 08:00—09:00 | 模型推算出来的数据 | 推算（均衡分配） |
| K16 | 拥堵反馈时间矩阵 | 模型步骤 27b | 2026 早高峰反馈 | 模型推算出来的数据 | 推算（分配结果回代） |
| K17 | 全天的士叫车请求 | 模型步骤 28 | 2026 工作日全天 | 模型推算出来的数据 | 推算（矩阵展开） |
| K18 | 的士车队逐小时供给 | 模型步骤 29 | 2026 工作日 | 模型推算出来的数据 | 估算（运营率情景） |
| K19 | 交通月报时间序列 | 模型步骤 30 | 2013—2026 本地月报 | 模型推算出来的数据 | 推算（表格整理） |
| K20 | 的士车队逐小时仿真 | 模型步骤 31 | 2026 工作日 | 模型推算出来的数据 | 推算（分钟级仿真） |
| K21 | 无人车分区投放情景 | 模型步骤 32 | 2026 工作日 | 模型推算出来的数据 | 推算（投放情景） |
| K22 | 夜间与配额扩展情景 | 模型步骤 34 | 2026 工作日 | 模型推算出来的数据 | 推算（政策情景） |
| K23 | 换更与充电规则情景 | 模型步骤 35 | 2026 工作日 | 模型推算出来的数据 | 推算（运营情景） |
| K24 | 2024 土地用途分区汇总 | 模型步骤 36 | 2024 格网／2026 分区 | 模型推算出来的数据 | 推算（格网汇总） |
| K25 | 法定用途地带与可建楼面 | 模型步骤 37 | 现存图则／2026 分区 | 模型推算出来的数据 | 推算（图则叠加） |
| K26 | 2026 分区物业价值 | 模型步骤 38 | 2026 分区 | 模型推算出来的数据 | 推算（行政区数值下推） |
| K27 | 早高峰公共交通分配结果 | 模型步骤 39 | 2026 工作日早高峰 | 模型推算出来的数据 | 推算（时刻表客流分配） |

## A 人口与住户

### A01 2021 人口普查小规划统计区

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 2021 人口普查小规划统计区 / 政府统计处（经 CSDI） / 2021 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/census/stpug_2021.geojson`（GEOJSON，34.87 MB） |
| 规模 | 211 个原始普查小区；`stpug_2021.geojson`：211 条 |
| 每条包含什么 | `age_1`、`dh`、工作及就学流向等；每条是一个小区的人口、住户及通勤概况。 |
| 空间单位 | 普查小规划统计区 |
| 实测还是推算 | 实测（官方数字） |
| 用在哪一步 | `pipeline/08_build_zones.py`、`pipeline/14_split_zones.py`、`pipeline/16_landuse_2026.py`、`pipeline/21_trip_generation.py` |
| 已知问题 | 小区人口与全港官方总数有轻微差异；不能当作 2026 实测人口。 |

### A02 规划署人口分布推算表

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 规划署人口分布推算表 / 规划署 / 2021—2031 推算表 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/projections/table_1.csv`（CSV，2.7 KB）<br>`data/raw/projections/table_7.csv`（CSV，49.4 KB）<br>`data/raw/projections/table_15.csv`（CSV，15.2 KB） |
| 规模 | 表 1、7、15 分别按区、年龄、小区列预测人口；`table_1.csv`：26 条；`table_7.csv`：500 条；`table_15.csv`：212 条 |
| 每条包含什么 | `2021` 至 `2031` 等；每行是一个地区或年龄组在各年的预测人口。 |
| 空间单位 | 小区、18 区、年龄组 |
| 实测还是推算 | 推算（官方预测） |
| 用在哪一步 | `pipeline/16_landuse_2026.py`、`pipeline/21_trip_generation.py` |
| 已知问题 | `table_15.csv` 的 212 行包含 211 个小区和 1 行陆上总计；2026 全港预测总量高于统计处临时估计，模型以统计处总量校准。 |

### A03 统计处人口与年龄表

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 统计处人口与年龄表 / 政府统计处 / 表 110-01001／01002／01003 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/projections/csd_110-01001.json`（JSON，3.55 MB）<br>`data/raw/projections/csd_110-01002.json`（JSON，15.51 MB）<br>`data/raw/projections/csd_110-01003.json`（JSON，245.9 KB） |
| 规模 | 三张网页表的本地数据集；`csd_110-01001.json`：dataSet 11,154 条；`csd_110-01002.json`：dataSet 50,322 条；`csd_110-01003.json`：dataSet 1,048 条 |
| 每条包含什么 | `header`、`dataSet`；逐条是年份、年龄等维度的统计值。 |
| 空间单位 | 全港、年龄、年份 |
| 实测还是推算 | 实测及官方估计 |
| 用在哪一步 | `pipeline/16_landuse_2026.py` |
| 已知问题 | 部分年份为临时估计，须和规划署的空间预测分开理解。 |

### A04 住户、收入与房屋统计表

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 住户、收入与房屋统计表 / 政府统计处 / 表 130-06601／06603／06606／06806；文件版本未核实 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/socioeconomic/csd_130-06601.json`（JSON，861.1 KB）<br>`data/raw/socioeconomic/csd_130-06603.json`（JSON，336.7 KB）<br>`data/raw/socioeconomic/csd_130-06606.json`（JSON，426.2 KB）<br>`data/raw/socioeconomic/csd_130-06806.json`（JSON，482.4 KB） |
| 规模 | 四张统计表；`csd_130-06601.json`：dataSet 3,312 条；`csd_130-06603.json`：dataSet 1,220 条；`csd_130-06606.json`：dataSet 1,656 条；`csd_130-06806.json`：dataSet 1,900 条 |
| 每条包含什么 | `dataSet`；记录家庭人数、房屋类别、收入中位数及平均住户人数。 |
| 空间单位 | 全港或统计表所列组别 |
| 实测还是推算 | 实测（官方数字） |
| 用在哪一步 | `pipeline/23_mode_choice.py` |
| 已知问题 | 在模型中用于推算有车家庭和时间价值，细分区数并非逐户调查记录。 |

### A05 全港人口就业分布基准 TPEDM

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 全港人口就业分布基准 TPEDM / 规划署 / 2021 基准；含 2026、2031 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/tpedm/tpedm-2021-based.geojson`（GEOJSON，737.9 KB） |
| 规模 | 18 区，三个年份；`tpedm-2021-based.geojson`：18 条 |
| 每条包含什么 | `Y2026_Popu`、`Y2026_Empl`；每区预测人口和就业数。 |
| 空间单位 | 18 个行政区 |
| 实测还是推算 | 推算（官方模型） |
| 用在哪一步 | `pipeline/21_trip_generation.py` |
| 已知问题 | 公开版只有区级概化结果，没有交通分区岗位明细。 |


## B 土地与规划

### B01 2024 土地用途格网及统计表

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 2024 土地用途格网及统计表 / 规划署 / 2024 |
| 网址（代码里写了才填） | https://portal.csdi.gov.hk/server/rest/services/common/pland_rcd_1725865972233_20687/MapServer |
| 本地文件 | `data/raw/landuse/luhk2024_codes.tif`（TIF，2.48 MB）<br>`data/raw/landuse/luhk2024_statistics_english.csv`（CSV，1.7 KB）<br>`data/raw/landuse/luhk2024_statistics_sc.csv`（CSV，1.4 KB） |
| 规模 | 10 米格网；统计表逐用途类别；`luhk2024_statistics_english.csv`：27 条；`luhk2024_statistics_sc.csv`：27 条 |
| 每条包含什么 | `Class`、`Area`；格网每格标一种土地用途，汇总到模型分区。 |
| 空间单位 | 10 米格网、模型分区 |
| 实测还是推算 | 实测分类＋模型汇总 |
| 用在哪一步 | `pipeline/36_land_utilization.py`、`pipeline/15_road_network.py`、`pipeline/39_transit_assignment.py` |
| 已知问题 | 住宅再分私人／公营时按附近楼宇估算；少量陆地在模型小区以外。 |

### B02 法定规划图则与用途地带

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 法定规划图则与用途地带 / 城市规划委员会 / 现存 153 张图则 |
| 网址（代码里写了才填） | https://www.ozp.tpb.gov.hk/arcgis2/rest/services/DATA/OZP_PLAN_CSDI/FeatureServer/0/query |
| 本地文件 | `data/raw/zoning/`：540 个 JSON／CSV／PDF 文件，合计 536.56 MB（例：Data Dictionary.pdf、plans.csv、BHC.json） |
| 规模 | 153 张图则；用途地带见模型文件；`plans.csv`：153 条 |
| 每条包含什么 | `PLAN_NO`、`zone_label`、地积比；每块地带描述可用地及建造上限。 |
| 空间单位 | 图则、用途地带、模型分区 |
| 实测还是推算 | 实测图则＋推算可建楼面 |
| 用在哪一步 | `pipeline/37_statutory_zoning.py` |
| 已知问题 | 部分地积比未从注释提取，改用规划标准默认值；两张规管地区图没有用途地带。 |

### B03 差饷物业租值、存量与楼价表

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 差饷物业租值、存量与楼价表 / 差饷物业估价署 / 2024—2026 文件系列 |
| 网址（代码里写了才填） | https://www.rvd.gov.hk/datagovhk/ |
| 本地文件 | `data/raw/rvd/`：16 个文件，合计 33.1 KB（例：commercial.csv、domestic.csv、flatted_factory.csv） |
| 规模 | 分区存量、租金和价格表；`commercial.csv`：23 条；`domestic.csv`：23 条；`flatted_factory.csv`：23 条；`industrial_office.csv`：16 条；`market_1.1A.csv`：28 条；`market_1.2A.csv`：28 条；`market_2.1A.csv`：28 条；`market_2.2A.csv`：28 条；其余逐表数字见《核对记录》 |
| 每条包含什么 | 住宅、办公室、商铺、工厂的存量／租值／价格；每行通常为一地区或年份。 |
| 空间单位 | 行政区、楼宇类别、年份 |
| 实测还是推算 | 实测（官方统计） |
| 用在哪一步 | `pipeline/10_zone_attraction.py`、`pipeline/38_property_values.py` |
| 已知问题 | 统计表的实用面积与模型毛楼面口径不同，不宜直接相除当误差。 |

### B04 规划及自动驾驶政策参考文件

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 规划及自动驾驶政策参考文件 / 规划署／立法会／相关部门 / 2017—2030（按文件名） |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/policy/`：10 个文件，合计 4.46 MB（例：hk5yplan-2026-2030-full-tc.pdf、hk5yplan-2026-2030-full-tc.txt、hk5yplan-index.html） |
| 规模 | 本地 PDF、文字稿、网页存档 |
| 每条包含什么 | 政策条文和规划目标；供情景解释，不是逐小区观测值。 |
| 空间单位 | 文件 |
| 实测还是推算 | 政策资料（非逐条实测） |
| 用在哪一步 | 四阶段脚本无直接读取；供政策情景说明。 |
| 已知问题 | 只作政策背景，不能把目标值写成当前观测。 |


## C 建筑物与设施

### C01 全港建筑物位置、高度与推算楼面

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 全港建筑物位置、高度与推算楼面 / 地政总署（CSDI） / 下载版本未核实 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/buildings/building-stock-raw.parquet`（PARQUET，9.46 MB）<br>`data/raw/buildings/building-stock.parquet`（PARQUET，9.61 MB）<br>`data/raw/buildings/buildings-classified.parquet`（PARQUET，10.02 MB） |
| 规模 | 每栋建筑一条；`building-stock-raw.parquet`：222,354 条；`building-stock.parquet`：222,354 条；`buildings-classified.parquet`：222,354 条 |
| 每条包含什么 | `footprint_m2`、`height_m`、`storeys`、`gfa_m2`、`use`；由占地和层数估毛楼面。 |
| 空间单位 | 建筑物 |
| 实测还是推算 | 实测几何＋推算楼面 |
| 用在哪一步 | `pipeline/09_building_stock.py`、`pipeline/10_zone_attraction.py`、`pipeline/12_zone_institutions.py`、`pipeline/14_split_zones.py`、`pipeline/15_road_network.py`、`pipeline/19_web_zones.py`、`pipeline/21_trip_generation.py` |
| 已知问题 | 许多楼宇的层数由高度估计；用途分类也含推断，不等于官方逐栋用途。 |

### C02 私人楼宇用途登记

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 私人楼宇用途登记 / 屋宇署 / 下载版本未核实 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/buildings/bd-building-usage.csv`（CSV，17.94 MB） |
| 规模 | 逐栋用途记录；`bd-building-usage.csv`：51,354 条 |
| 每条包含什么 | `OBJECTID`、`ADDRESS_E` 等；每条写一栋私人楼宇的地址与用途资料。 |
| 空间单位 | 私人楼宇 |
| 实测还是推算 | 实测（官方记录） |
| 用在哪一步 | `pipeline/10_zone_attraction.py` |
| 已知问题 | 未覆盖大量公营住宅、学校及政府建筑，未分类楼面需另估。 |

### C03 学校位置与分区学额

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 学校位置与分区学额 / 教育局 / 文件版本未核实 |
| 网址（代码里写了才填） | https://www.edb.gov.hk/attachment/en/about-edb/publications-stat/figures/tab0307_en.csv |
| 本地文件 | `data/raw/schools/schools.parquet`（PARQUET，145.9 KB）<br>`data/web/zones-schools.geojson`（GEOJSON，1.13 MB） |
| 规模 | 学校逐所；模型分区逐区；`schools.parquet`：3,063 条；`zones-schools.geojson`：455 条 |
| 每条包含什么 | `level`、`places`、`zone`；学校在哪、属于哪个学段，学额为分区总数分摊。 |
| 空间单位 | 学校、模型分区 |
| 实测还是推算 | 实测学校位置＋估算逐校学额 |
| 用在哪一步 | `pipeline/11_zone_schools.py`、`pipeline/16_landuse_2026.py` |
| 已知问题 | 区级学额总数准确，但区内各校平均分摊；特殊学校学额未完整分配。 |

### C04 院校、医院与诊所位置

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 院校、医院与诊所位置 / 教育局／医院管理局 / 下载版本未核实 |
| 网址（代码里写了才填） | https://www.ha.org.hk/opendata/facility-hosp.json |
| 本地文件 | `data/raw/institutions/facilities.parquet`（PARQUET，15.4 KB）<br>`data/web/zones-institutions.geojson`（GEOJSON，1.09 MB） |
| 规模 | 每设施一条；分区结果逐区；`facilities.parquet`：291 条；`zones-institutions.geojson`：455 条 |
| 每条包含什么 | `name_en`、`kind`、`lat`、`lon`；每条给设施类型与位置。 |
| 空间单位 | 设施、模型分区 |
| 实测还是推算 | 实测设施位置＋估算楼面和学额 |
| 用在哪一步 | `pipeline/12_zone_institutions.py`、`pipeline/16_landuse_2026.py` |
| 已知问题 | 校园范围及逐校学生不是实测；归属楼宇和学额分配为估算。 |

### C05 各区酒店房间数

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 各区酒店房间数 / 旅游事务署 / 2026（文件内 Year） |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/hotels/hotel-rooms-by-district.csv`（CSV，896 B） |
| 规模 | 一行，按 18 区列房间数；`hotel-rooms-by-district.csv`：1 条 |
| 每条包含什么 | `Year` 和各区房间列；这行是各区酒店客房控制总量。 |
| 空间单位 | 18 个行政区 |
| 实测还是推算 | 实测（官方数字） |
| 用在哪一步 | `pipeline/10_zone_attraction.py` |
| 已知问题 | 酒店楼面由建筑物识别估算，房间数仅作总量校核。 |


## D 道路网

### D01 运输署第二代道路网及附属图层

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 运输署第二代道路网及附属图层 / 运输署 / 第二代道路网；文件版本未核实 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/road-network/RdNet_IRNP.gdb.zip`（ZIP，17.02 MB） |
| 规模 | 中心线、路口、转向、限速及收费等图层；`RdNet_IRNP.gdb.zip`：CENTERLINE 36,471 条；INTERSECTION 27,320 条；TURN 11,051 条；TUN_BRIDGE_TOLL 49 条；TUN_BRIDGE_TV_TOLL 1,112 条 |
| 每条包含什么 | `STREET_ENAME`、`TRAVEL_DIRECTION`、`SPEED_LIMIT`；一条中心线是一段道路的几何与行驶方向。 |
| 空间单位 | 路段、路口、限制图层 |
| 实测还是推算 | 实测（官方地理资料） |
| 用在哪一步 | `pipeline/06_detector_road_segments.py`、`pipeline/15_road_network.py`、`pipeline/15b_detector_corridors.py`、`pipeline/15d_speed_profiles.py`、`pipeline/25_bus_preload.py`、`pipeline/27_road_assignment.py` |
| 已知问题 | 道路网没有全路车道数；限速图层仅列例外，未列道路按一般 50 公里／小时处理。 |

道路资料库各图层（只读 `pyogrio.read_info`）：

| 图层 | 条数 | 主要信息 |
|---|---:|---|
| `VEHICLE_RESTRICTION` | 834 | ROAD_ROUTE_ID, MAX_AXLE_WEIGHT, VR_ID |
| `TRAFFIC_FEATURES` | 2,965 | FEATURE_TYPE, FEATURE_ID, CRE_DATE |
| `SPEED_LIMIT` | 4,338 | SPEED_LIMIT_ID, ROAD_ROUTE_ID, SPEED_LIMIT |
| `RUN_IN_OUT` | 677 | RUN_IN_OUT_ID, RUN_IN_OUT_TYPE, PARKING_ID |
| `ROUNDABOUT` | 355 | CRE_DATE, R_ABOUT_ID, R_ABOUT_ENAME |
| `PROHIBITION` | 2,341 | PROHIBITION_ID, EXC_VEH_TYPE, INC_VEH_TYPE |
| `PERMIT` | 22 | PERMIT_ID, ROAD_ROUTE_ID, REMARKS |
| `PEDESTRIAN_ZONE` | 66 | ROAD_ROUTE_ID, TIME_ZONE, EFFECTIVE_DAY |
| `NSR` | 20,046 | VEHICLE_TYPE, TIME_ZONE, EFFECTIVE_DAY |
| `BUS_ONLY_LANE` | 251 | ROAD_ROUTE_ID, TIME_ZONE, EFFECTIVE_DAY |
| `CENTERLINE` | 36,471 | STREET_ENAME, STREET_CNAME, ELEVATION |
| `TURN` | 11,051 | EDGE1END, EDGE1FCID, EDGE1FID |
| `INTERSECTION` | 27,320 | CRE_DATE, INT_ID, INT_TYPE |
| `TUN_BRIDGE_TOLL` | 49 | TUNNEL_BRIDGE_NAME, TUNNEL_BRIDGE_CHINESE_NAME, FEATURE_ID_1 |
| `ONSTREETPARK` | 37,267 | FEATUREID, CRE_DATE, LAST_UPD_DATE |
| `GISP_ON_STREET_PARKING` | 37,267 | STREET_NAME_ENG, STREET_NAME_CHI, METER_NONMETER |
| `TUN_BRIDGE_TV_TOLL` | 1,112 | TUNNEL_BRIDGE_NAME, TUNNEL_BRIDGE_CHINESE_NAME, FEATURE_ID_1 |

### D02 OpenStreetMap 道路及车道

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | OpenStreetMap 道路及车道 / OpenStreetMap 贡献者 / 快照日期未核实 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/osm/hong-kong-latest.osm.pbf`（PBF，37.54 MB） |
| 规模 | PBF 本地文件；道路元素数未核实 |
| 每条包含什么 | `highway`、`lanes` 等标签；每条 OSM 道路提供路类、车道及步行连接。 |
| 空间单位 | 道路与步行路径 |
| 实测还是推算 | 众包实测＋缺值估算 |
| 用在哪一步 | `pipeline/15_road_network.py`、`pipeline/18_transit_skim.py` |
| 已知问题 | 缺车道标签或对不上运输署路段时按道路等级估算；车道不是政府官方量测。 |


## E 公共交通

### E01 运输署官方 GTFS 公交时刻与班距

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 运输署官方 GTFS 公交时刻与班距 / 运输署 / 本地压缩包版本未核实 |
| 网址（代码里写了才填） | https://static.data.gov.hk/td/pt-headway-en/gtfs.zip |
| 本地文件 | `data/raw/gtfs_official/td-gtfs-en.zip`（ZIP，13.69 MB）<br>`data/raw/gtfs_official/td-gtfs-tc.zip`（ZIP，13.69 MB） |
| 规模 | 各表逐行计数；英文版为建模输入；`td-gtfs-en.zip`：routes.txt 2,452 行；stops.txt 9,447 行；trips.txt 82,397 行；frequencies.txt 76,328 行；stop_times.txt 1,369,514 行；`td-gtfs-tc.zip`：routes.txt 2,452 行；stops.txt 9,447 行；trips.txt 82,397 行；frequencies.txt 76,328 行；stop_times.txt 1,369,514 行 |
| 每条包含什么 | `routes.txt`、`trips.txt`、`stops.txt`、`frequencies.txt`；分别是线路、班次、车站和发车间隔。 |
| 空间单位 | 线路、站、班次 |
| 实测还是推算 | 实测（官方时刻资料） |
| 用在哪一步 | `pipeline/17b_transit_feed.py`、`pipeline/18_transit_skim.py`、`pipeline/25_bus_preload.py`、`pipeline/39_transit_assignment.py` |
| 已知问题 | 不含港铁及轻铁；部分巴士中途站时间缺失，合并步骤按道路时间补齐。 |

### E02 社区版香港 GTFS

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 社区版香港 GTFS / wheelstransit／OpenStreetMap 社区 / 2026-09-15 下载（文档） |
| 网址（代码里写了才填） | https://github.com/wheelstransit/hongkong-community-gtfs |
| 本地文件 | `data/raw/gtfs_community/hk.gtfs.zip`（ZIP，18.78 MB） |
| 规模 | 各表逐行计数；`hk.gtfs.zip`：routes.txt 1,623 行；stops.txt 14,765 行；trips.txt 4,891 行；frequencies.txt 50,297 行；stop_times.txt 104,422 行 |
| 每条包含什么 | `routes.txt`、`stops.txt`、`trips.txt`；每行是线路、站或一趟服务。 |
| 空间单位 | 线路、站、班次 |
| 实测还是推算 | 众包时刻资料 |
| 用在哪一步 | `pipeline/01_build_place_index.py`、`pipeline/14_split_zones.py`、`pipeline/17b_transit_feed.py`、`pipeline/23_mode_choice.py` |
| 已知问题 | 社区版渡轮方向有误；合并时只取其港铁和轻铁。数据许可证 ODbL。 |

### E03 统一公共交通时刻表

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 统一公共交通时刻表 / 运输署＋社区版（17b 合并） / 2026 模型版本 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/gtfs_merged/hk-merged.gtfs.zip`（ZIP，10.26 MB） |
| 规模 | 合并后逐表计数；`hk-merged.gtfs.zip`：routes.txt 2,473 行；stops.txt 9,824 行；trips.txt 82,443 行；frequencies.txt 76,480 行；stop_times.txt 1,370,156 行 |
| 每条包含什么 | `routes.txt`、`stop_times.txt`、`frequencies.txt`；供公交门到门时间及车辆预加载。 |
| 空间单位 | 线路、站、班次 |
| 实测还是推算 | 推算（合并与补时）；由 E01 和 E02 经 17b 合并；审计在 data/web/transit-feed-audit.json。 |
| 用在哪一步 | `pipeline/18_transit_skim.py`、`pipeline/25_bus_preload.py`、`pipeline/39_transit_assignment.py` |
| 已知问题 | 巴士缺失到站时间由道路自由流时间插补；不能视为实测班表。 |


## F 出行调查与行为参数

### F01 2022 年出行特征调查 TCS

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 2022 年出行特征调查 TCS / 运输署 / 2022 调查；2025 报告版本 |
| 网址（代码里写了才填） | https://www.td.gov.hk/filemanager/en/content_5349/tcs2022_eng.pdf |
| 本地文件 | `data/raw/tcs/tcs2022_eng.pdf`（PDF，5.25 MB）<br>`data/raw/tcs/tcs2022_eng.txt`（TXT，170.1 KB）<br>`data/raw/tcs/tcs2022app_eng.pdf`（PDF，1.84 MB）<br>`data/raw/tcs/tcs2022app_eng.txt`（TXT，26.2 KB） |
| 规模 | 主报告与附录各一份，另有文字提取稿 |
| 每条包含什么 | 出行率、目的、方式、耗时、时间价值；每个表格是受访出行的汇总。 |
| 空间单位 | 全港、26 大区、方式与目的 |
| 实测还是推算 | 实测调查汇总 |
| 用在哪一步 | `pipeline/20_behaviour_parameters.py`、`pipeline/21_trip_generation.py`、`pipeline/22_trip_distribution.py`、`pipeline/23_mode_choice.py`、`pipeline/24_peak_hour.py`、`pipeline/27b_congested_skim.py` |
| 已知问题 | 原始逐人数据库不公开，模型只能用报告的汇总表校准。 |

### F02 2011 年货车出行特征调查

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 2011 年货车出行特征调查 / 运输署 / 2011 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/tcs/gvtcs2011_eng.pdf`（PDF，1.57 MB）<br>`data/raw/tcs/gvtcs2011_eng.txt`（TXT，83.7 KB）<br>`data/raw/tcs/gvtcs2011app_eng.pdf`（PDF，2.08 MB）<br>`data/raw/tcs/gvtcs2011app_eng.txt`（TXT，13.2 KB） |
| 规模 | 主报告与附录及文字稿 |
| 每条包含什么 | 货车行程、目的地和车种；供 2026 货运需求外推。 |
| 空间单位 | 车种、26 大区、口岸 |
| 实测还是推算 | 实测调查汇总 |
| 用在哪一步 | `pipeline/26_goods_and_boundary_vehicles.py`、`pipeline/27_road_assignment.py` |
| 已知问题 | 调查年份早，2026 车辆规模需用运输署月报外推。 |

### F03 运输规划及设计手册 TPDM

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 运输规划及设计手册 TPDM / 运输署 / 第一、二、六、九册（本地文件） |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/tpdm/`：8 个文件，合计 32.29 MB（例：tpdm_v1.pdf、tpdm_v1.txt、tpdm_v2.pdf） |
| 规模 | 各册 PDF 与文字稿 |
| 每条包含什么 | 容量、分区、步行等设计规则；例如道路通行能力按车道和道路等级取值。 |
| 空间单位 | 规则表、道路类别 |
| 实测还是推算 | 设计参数／方法依据 |
| 用在哪一步 | `pipeline/08_build_zones.py`、`pipeline/09_building_stock.py`、`pipeline/15_road_network.py`、`pipeline/20_behaviour_parameters.py`、`pipeline/21_trip_generation.py`、`pipeline/23_mode_choice.py` |
| 已知问题 | 是设计标准，不是某年逐路段实测车流。 |


## G 交通计数与实测

### G01 周年交通普查 ATC

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 周年交通普查 ATC / 运输署 / 2018—2024 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/atc/ATC_IRNP.gdb.zip`（ZIP，86.7 KB）<br>`data/raw/atc/ATC_TRAFFIC_DATA.zip`（ZIP，33.71 MB）<br>`data/raw/atc/extract/S1001.xls`（XLS，89.6 KB）<br>`data/raw/atc/extract/sample.xls`（XLS，84.0 KB）<br>`data/web/traffic/atc-stations.json`（JSON，1.35 MB）<br>`data/web/traffic/atc-occupancy.json`（JSON，6.98 MB） |
| 规模 | 逐站逐年记录及普查站图层；`ATC_IRNP.gdb.zip`：ATC_STATION_PT 1,694 条；ATC_STATION_LINE 356 条；`atc-stations.json`：records 2,422 条；`atc-occupancy.json`：stations 763 条 |
| 每条包含什么 | `am_peak_flow`、方向、AADT；一个记录是某站某年某方向的车流。 |
| 空间单位 | 普查站、方向、年 |
| 实测还是推算 | 实测（官方计数） |
| 用在哪一步 | `pipeline/07_annual_traffic_census.py`、`pipeline/15c_census_links.py`、`pipeline/24_peak_hour.py`、`pipeline/25_bus_preload.py`、`pipeline/27_road_assignment.py` |
| 已知问题 | 原始图层站点多于模型中有有效年度流量的站；用途是校核与车种构成。 |

普查空间图层：

| 图层 | 条数 |
|---|---:|
| `ATC_STATION_PT` | 1,694 |
| `ATC_CORDON_LINE` | 9 |
| `ATC_SCREENLINE_LINE` | 11 |
| `ATC_STATION_LINE` | 356 |

### G02 战略道路探测器车流与车速

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 战略道路探测器车流与车速 / 运输署／DATA.GOV.HK / 本地多日快照，日期见文件名 |
| 网址（代码里写了才填） | https://static.data.gov.hk/td/traffic-data-strategic-major-roads/info/traffic_speed_volume_occ_info.csv |
| 本地文件 | `data/raw/traffic/rawSpeedVol-lanes.xml`（XML，708.8 KB）<br>`data/web/traffic/detectors.json`（JSON，187.8 KB）<br>`data/web/traffic/observed-`：24 个文件，合计 5.60 MB（例：observed-2026-08-24.json、observed-2026-08-25.json、observed-2026-08-26.json） |
| 规模 | 807 个探测器；逐日观测文件另列；`detectors.json`：807 条 |
| 每条包含什么 | `volume`、`speed`、`direction`；每条是某探测器在一小时的车辆数与车速。 |
| 空间单位 | 探测器、日期、小时 |
| 实测还是推算 | 实测（道路探测器） |
| 用在哪一步 | `pipeline/05_traffic_detectors.py`、`pipeline/06_detector_road_segments.py`、`pipeline/15b_detector_corridors.py`、`pipeline/15d_speed_profiles.py`、`pipeline/15e_bpr_calibration.py` |
| 已知问题 | 每份快照含两个 30 秒时段；原方法将车数加总后再乘 120 导致翻倍，9/26 已修。 |

### G03 运输署交通月报／交通摘要

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 运输署交通月报／交通摘要 / 运输署 / 2011／2026-06 文件系列 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/td-digest/`：18 个文件，合计 4.53 MB（例：1112_table41a.pdf、1112_table41a.txt、2606_2606_e.pdf） |
| 规模 | 月报 PDF、XLS、文字稿 |
| 每条包含什么 | 客运人次、车队数、跨境车辆等按月汇总；各表口径不同。 |
| 空间单位 | 月份、交通方式、车种 |
| 实测还是推算 | 实测（官方月报） |
| 用在哪一步 | `pipeline/26_goods_and_boundary_vehicles.py`、`pipeline/29_fleet_supply.py`、`pipeline/30_td_digest_series.py`、`pipeline/31_fleet_simulator.py` |
| 已知问题 | 不同表的“车次”和“人次”不能相加；需按表号取值。 |


## H 跨境

### H01 口岸每日出入境人次

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 口岸每日出入境人次 / 入境事务处 / 至 2026-09-16 的本地快照（审计） |
| 网址（代码里写了才填） | https://www.immd.gov.hk/opendata/eng/transport/immigration_clearance/statistics_on_daily_passenger_traffic.csv |
| 本地文件 | `data/raw/cross-boundary/daily-passengers.parquet`（PARQUET，5.0 KB）<br>`data/web/cross-boundary.json`（JSON，5.6 KB） |
| 规模 | 按口岸及方向汇总；15 个模型口岸；`daily-passengers.parquet`：28 条；`cross-boundary.json`：control_points 15 条 |
| 每条包含什么 | `point`、`direction`、`hk_residents`、`mainland_visitors`、`total`；每条是一个口岸方向的过境人次。 |
| 空间单位 | 口岸、方向 |
| 实测还是推算 | 实测（官方计数） |
| 用在哪一步 | `pipeline/13_cross_boundary.py`、`pipeline/21_trip_generation.py`、`pipeline/22_trip_distribution.py`、`pipeline/23_mode_choice.py`、`pipeline/26_goods_and_boundary_vehicles.py`、`pipeline/27_road_assignment.py`、`pipeline/39_transit_assignment.py` |
| 已知问题 | 原始入境处口岸与模型外部分区有映射，口岸坐标为人工录入且已校区。 |

### H02 跨境学童人数及使用口岸

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 跨境学童人数及使用口岸 / 教育局 / 本地文件年份按 School Year 栏 |
| 网址（代码里写了才填） | https://www.edb.gov.hk/attachment/datagovhk/Number_of_cross_boundary_students_land_en.csv |
| 本地文件 | `data/raw/cross-boundary/students-by-point-and-level.csv`（CSV，40.2 KB） |
| 规模 | 按学年、口岸、学段的记录；`students-by-point-and-level.csv`：540 条 |
| 每条包含什么 | `School Year`、`Control Point`、`School Level`、`No. of Students`；每行是一个口岸学段组合。 |
| 空间单位 | 口岸、学段、学年 |
| 实测还是推算 | 实测总量＋模型分配 |
| 用在哪一步 | `pipeline/13_cross_boundary.py`、`pipeline/21_trip_generation.py` |
| 已知问题 | 审计显示总数 16,656 名、分配 16,655 名，差 1 名；小区落点为模型推配。 |

### H03 跨境车辆月报表

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 跨境车辆月报表 / 运输署 / 2011／2026-06 文件系列 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/td-digest/2606_table81*.xls`：7 个文件，合计 308.2 KB（例：2606_table81a.xls、2606_table81b.xls、2606_table81c.xls）<br>`data/raw/td-digest/1112_table41a.txt`（TXT，76.1 KB） |
| 规模 | 按口岸和车种的月报工作簿 |
| 每条包含什么 | 跨境私家车、客车与货车；每格是某月某车种通关数量。 |
| 空间单位 | 口岸、车种、月份 |
| 实测还是推算 | 实测（官方月报） |
| 用在哪一步 | `pipeline/26_goods_and_boundary_vehicles.py` |
| 已知问题 | 2026 跨境早高峰车辆由月报与货车调查再推算，非直接车流观测。 |


## I 价格与收费

### I01 隧道及收费道路收费表

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 隧道及收费道路收费表 / 运输署（道路网附表） / 道路网文件现行版本 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/road-network/RdNet_IRNP.gdb.zip`（ZIP，17.02 MB） |
| 规模 | 固定收费与分时收费两图层；`RdNet_IRNP.gdb.zip`：CENTERLINE 36,471 条；INTERSECTION 27,320 条；TURN 11,051 条；TUN_BRIDGE_TOLL 49 条；TUN_BRIDGE_TV_TOLL 1,112 条 |
| 每条包含什么 | `GAZETTED_TOLL`、`START_TIME`、`VEHICLE_CLASS_DESCRIPTION`；每条是某车种某时段收费。 |
| 空间单位 | 收费设施、车种、时段 |
| 实测还是推算 | 实测（法定收费） |
| 用在哪一步 | `pipeline/15_road_network.py`、`pipeline/17_car_skim.py`、`pipeline/27_road_assignment.py` |
| 已知问题 | 模型取 08:30 费率，的士过海有回程附加收费；不能把全天都按同一价解释。 |

### I02 市区的士收费及参考文件

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 市区的士收费及参考文件 / 运输署／立法会 / 2024 收费；参考文件 2017—2025 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/fares/taxi-fare-urban.json`（JSON，671 B）<br>`data/raw/taxi/`：8 个文件，合计 7.54 MB（例：legco_brief_taxi_fare_2024.pdf、legco_brief_taxi_fare_2024.txt、legco_issh_taxi_2025.pdf） |
| 规模 | 结构化费率及 PDF／文字稿 |
| 每条包含什么 | `flag_fall_hkd`、`step_m` 等；起表价、每段距离加价及附加费。 |
| 空间单位 | 收费规则、文件 |
| 实测还是推算 | 实测费率＋政策参考 |
| 用在哪一步 | `pipeline/23_mode_choice.py` |
| 已知问题 | 市区的士规则用于模型；参考文件未直接作为逐单价格。 |

### I03 港铁站对车费

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 港铁站对车费 / 港铁公司 / 文件版本未核实 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/fares/mtr_lines_fares.csv`（CSV，743.9 KB） |
| 规模 | 每个起讫车站组合一行；`mtr_lines_fares.csv`：9,216 条 |
| 每条包含什么 | `SRC_STATION_ID`、`DEST_STATION_ID`、`OCT_ADT_FARE`；每行是一对站的成人八达通车费。 |
| 空间单位 | 车站对 |
| 实测还是推算 | 实测（公开车费表） |
| 用在哪一步 | `pipeline/23_mode_choice.py` |
| 已知问题 | 模型用站对车费拟合距离函数，再近似其他公交票价；巴士和小巴票价属假设。 |

### I04 综合消费物价指数

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 综合消费物价指数 / 政府统计处 / 表 510-60001 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/prices/csd_510-60001.json`（JSON，1.63 MB） |
| 规模 | 本地网页表数据集；`csd_510-60001.json`：dataSet 7,908 条 |
| 每条包含什么 | `header`、`dataSet`；每条是一个月份／类别的价格指数。 |
| 空间单位 | 月份、价格类别 |
| 实测还是推算 | 实测（官方价格指数） |
| 用在哪一步 | `pipeline/27_road_assignment.py` |
| 已知问题 | 用于将旧年份货车时间价值折算到模型年，非当年实测行程成本。 |


## J 底图与地名

### J01 地政总署底图和繁体标签

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 地政总署底图和繁体标签 / 地政总署（CSDI） / 本地缓存／打包版本 |
| 网址（代码里写了才填） | https://portal.csdi.gov.hk/csdi-webpage/apidoc/VectorMapAPI |
| 本地文件 | `data/build/basemap/`：28 个文件，合计 200.99 MB（例：hk-landsd-base.pmtiles、hk-landsd-label-tc.pmtiles、hk-landsd-raster.pmtiles） |
| 规模 | 三个 PMTiles 包及资源清单 |
| 每条包含什么 | 街道、水体、地物及中文标签；地图切片供网页显示。 |
| 空间单位 | 地图切片 |
| 实测还是推算 | 官方地图资料 |
| 用在哪一步 | `pipeline/02_build_basemap_style.py`、`pipeline/03_prewarm_basemap_cache.py`、`pipeline/04_build_basemap_pmtiles.py` |
| 已知问题 | 网页显示须依地政总署条款署名；底图切片不进入四阶段计算。 |

### J02 官方地名与地点索引

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 官方地名与地点索引 / 地政总署／GTFS 来源 / 官方地名版本未核实 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/placenames/GEO_PLACE_NAME.geojson`（GEOJSON，829.6 KB）<br>`data/raw/placenames/PLACE_NAME.geojson`（GEOJSON，748.8 KB）<br>`data/web/places.json`（JSON，1.29 MB） |
| 规模 | 官方地名点及网页搜索索引；`GEO_PLACE_NAME.geojson`：2,706 条；`PLACE_NAME.geojson`：2,826 条；`places.json`：places 9,548 条 |
| 每条包含什么 | `NAME_TC`、`NAME_EN`、坐标；每条是一个地名或车站检索项。 |
| 空间单位 | 地名点、车站 |
| 实测还是推算 | 实测地名＋索引推算 |
| 用在哪一步 | `pipeline/01_build_place_index.py`、`pipeline/19_web_zones.py` |
| 已知问题 | 网页名称可能同名，需搭配小区编号识别。 |

### J03 十八区行政边界

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 十八区行政边界 / 地政总署／政府地理资料 / 边界文件版本未核实 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/raw/boundaries/districts_18.json`（JSON，796.6 KB） |
| 规模 | 18 个区边界；`districts_18.json`：18 条 |
| 每条包含什么 | `District`、几何；每条是一个行政区边界。 |
| 空间单位 | 18 个行政区 |
| 实测还是推算 | 官方地理边界 |
| 用在哪一步 | `pipeline/10_zone_attraction.py`、`pipeline/19_web_zones.py` |
| 已知问题 | 用于落区和校核，不是 455 个模型小区的边界。 |


## K 模型推算出来的数据

### K01 2026 分区土地利用与人口表

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 2026 分区土地利用与人口表 / 模型步骤 16 / 2026 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/landuse-2026.parquet`（PARQUET，121.3 KB） |
| 规模 | 每个内部模型分区一行；`landuse-2026.parquet`：455 条 |
| 每条包含什么 | `population`、`households`、`workers`、各类楼面与学额；概括人住哪、活动在哪。 |
| 空间单位 | 455 个内部模型分区 |
| 实测还是推算 | 推算（模型算的）；由 A01、A02、A03、C01、C03、C04 经 16 推算。 |
| 用在哪一步 | `pipeline/16_landuse_2026.py`、`pipeline/17_car_skim.py`、`pipeline/21_trip_generation.py`、`pipeline/22_trip_distribution.py`、`pipeline/23_mode_choice.py`、`pipeline/26_goods_and_boundary_vehicles.py` |
| 已知问题 | 人口总数按统计处临时值校准；分区分布仍是规划署预测，非 2026 分区实测。 |

### K02 2022 出行调查参数表

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 2022 出行调查参数表 / 模型步骤 20 / 2022 报告参数 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/parameters-tcs2022.json`（JSON，19.7 KB） |
| 规模 | 一个 JSON 参数集合 |
| 每条包含什么 | `trip_rates`、`mean_journey_time_min`、`value_of_time_cents_per_min_2022`；存各目的出行率和时间价值。 |
| 空间单位 | 目的、方式、调查表 |
| 实测还是推算 | 推算（报告表提取）；由 F01 经 20 提取，并以 tcs-parameters-audit.json 核对。 |
| 用在哪一步 | `pipeline/20_behaviour_parameters.py`、`pipeline/21_trip_generation.py`、`pipeline/22_trip_distribution.py`、`pipeline/23_mode_choice.py`、`pipeline/24_peak_hour.py`、`pipeline/26_goods_and_boundary_vehicles.py`、`pipeline/27b_congested_skim.py`、`pipeline/28_taxi_requests.py` |
| 已知问题 | 只有公开汇总参数，无逐人原始记录。 |

### K03 分区与建筑物出行端点

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 分区与建筑物出行端点 / 模型步骤 21 / 2026 工作日 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/trip-ends-2026.parquet`（PARQUET，74.0 KB）<br>`data/model/building-trip-ends.parquet`（PARQUET，6.95 MB） |
| 规模 | 分区端点及逐栋端点；`trip-ends-2026.parquet`：470 条；`building-trip-ends.parquet`：222,193 条 |
| 每条包含什么 | `P_HBW`、`A_HBW` 是上班出行从哪里出发、去哪里；`trip_ends` 是每栋分得的端点数。 |
| 空间单位 | 455 内部区＋15 外部口岸；建筑物 |
| 实测还是推算 | 推算（模型算的）；由 K01、K02、C01、A02、A05、H01 经 21 推算。 |
| 用在哪一步 | `pipeline/21_trip_generation.py`、`pipeline/15_road_network.py`、`pipeline/19_web_zones.py`、`pipeline/22_trip_distribution.py`、`pipeline/23_mode_choice.py`、`pipeline/26_goods_and_boundary_vehicles.py`、`pipeline/28_taxi_requests.py` |
| 已知问题 | 建筑物端点是按楼面等权重分配，非逐栋实测客流。 |

### K04 可路由道路网与分区接驳

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 可路由道路网与分区接驳 / 模型步骤 15 / 2026 基础网络 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/road-links.parquet`（PARQUET，1.77 MB）<br>`data/model/road-nodes.parquet`（PARQUET，564.7 KB）<br>`data/model/road-turns.parquet`（PARQUET，114.6 KB）<br>`data/model/road-connectors.parquet`（PARQUET，19.1 KB）<br>`data/model/zone-centres.parquet`（PARQUET，20.3 KB） |
| 规模 | 路段、节点、转向、接驳和中心点分别成表；`road-links.parquet`：36,471 条；`road-nodes.parquet`：27,319 条；`road-turns.parquet`：11,051 条；`road-connectors.parquet`：1,266 条；`zone-centres.parquet`：455 条 |
| 每条包含什么 | `length_m`、`lanes_ab`、`capacity_ab_veh_hr`、`toll`；每条路存长度、车道、容量及收费。 |
| 空间单位 | 路段、节点、455 个小区 |
| 实测还是推算 | 实测几何＋模型推算通行能力；由 D01、D02、F03、B01、K03 和分区边界经 15 建立。 |
| 用在哪一步 | `pipeline/15_road_network.py`、`pipeline/17_car_skim.py`、`pipeline/18_transit_skim.py`、`pipeline/25_bus_preload.py`、`pipeline/27_road_assignment.py`、`pipeline/39_transit_assignment.py` |
| 已知问题 | 3 个离岛小区没有道路连接；缺车道时按路类估算。 |

### K05 普查站对应路段

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 普查站对应路段 / 模型步骤 15c / 2026 路网对应关系 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/census-links.parquet`（PARQUET，15.5 KB） |
| 规模 | 每个站点方向可对应多条并行路段；`census-links.parquet`：416 条 |
| 每条包含什么 | `station`、`direction`、`link_id`、`side`；说明普查车流应与哪条道路方向比较。 |
| 空间单位 | 站点方向、路段 |
| 实测还是推算 | 推算（位置匹配）；由 G01 和 K04 经 15c 匹配。 |
| 用在哪一步 | `pipeline/15c_census_links.py`、`pipeline/25_bus_preload.py`、`pipeline/27_road_assignment.py` |
| 已知问题 | 审计有 1 个方向未配上：2216 East Bound。 |

### K06 逐路段逐小时车速

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 逐路段逐小时车速 / 模型步骤 15d / 本地多日观测合成 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/road-speeds-hourly.parquet`（PARQUET，489.4 KB） |
| 规模 | 每个路段方向和小时一行；`road-speeds-hourly.parquet`：1,144,632 条 |
| 每条包含什么 | `link_id`、`side`、`hour`、`speed`、`source`；表示该方向该小时的行驶速度。 |
| 空间单位 | 路段方向、小时 |
| 实测还是推算 | 实测探测器＋未覆盖道路推算；由 G02、D01、K04 经 15d 推算。 |
| 用在哪一步 | `pipeline/15d_speed_profiles.py`、`pipeline/31_fleet_simulator.py`、`pipeline/32_deployment_scenario.py`、`pipeline/34_scenarios.py` |
| 已知问题 | 探测器仅覆盖少量道路，其余按同类道路速度比例推算。 |

### K07 道路拥堵曲线参数

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 道路拥堵曲线参数 / 模型步骤 15e / 本地工作日样本 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/bpr-parameters.json`（JSON，84 B） |
| 规模 | 一组参数 |
| 每条包含什么 | `alpha`、`beta`；把车流占容量比例换成延误倍数。 |
| 空间单位 | 全路网通用参数 |
| 实测还是推算 | 推算（实测拟合）；由 G02、K04 经 15e 拟合。 |
| 用在哪一步 | `pipeline/15e_bpr_calibration.py`、`pipeline/27_road_assignment.py` |
| 已知问题 | 探测器只覆盖可观测道路；无探测器路段沿用同一拟合公式。 |

### K08 自由流小汽车时间矩阵

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 自由流小汽车时间矩阵 / 模型步骤 17 / 2026 基础网络 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/skim-car-freeflow.npz`（NPZ，2.34 MB） |
| 规模 | 内部小区两两组合；`skim-car-freeflow.npz`：分区轴 455；矩阵 455×455 |
| 每条包含什么 | `time_min`、`distance_km`、`toll_hkd`；每格是一对小区开车所需时间、距离与收费。 |
| 空间单位 | 455×455 小区对 |
| 实测还是推算 | 推算（最短路径）；由 K04、K01 经 17 路由计算。 |
| 用在哪一步 | `pipeline/17_car_skim.py`、`pipeline/18_transit_skim.py`、`pipeline/23_mode_choice.py`、`pipeline/24_peak_hour.py`、`pipeline/26_goods_and_boundary_vehicles.py`、`pipeline/27b_congested_skim.py`、`pipeline/28_taxi_requests.py`、`pipeline/29_fleet_supply.py`、`pipeline/31_fleet_simulator.py`、`pipeline/32_deployment_scenario.py`、`pipeline/34_scenarios.py`、`pipeline/35_duty_and_charging.py` |
| 已知问题 | 自由流不含拥堵；3 个无公路小区的相关组合不可达。 |

### K09 公交、步行、自行车时间矩阵

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 公交、步行、自行车时间矩阵 / 模型步骤 18 / 2026-09 工作日早间时刻窗 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/skim-active-transit.npz`（NPZ，400.7 KB） |
| 规模 | 内部小区两两组合；`skim-active-transit.npz`：分区轴 455；矩阵 455×455 |
| 每条包含什么 | `transit_min`、`walk_min`、`bike_min`；每格是一对小区的门到门时间。 |
| 空间单位 | 455×455 小区对 |
| 实测还是推算 | 推算（时刻表路由）；由 E03、D02、K04、K08 经 18 计算。 |
| 用在哪一步 | `pipeline/18_transit_skim.py`、`pipeline/22_trip_distribution.py`、`pipeline/23_mode_choice.py` |
| 已知问题 | 少数小区对三小时内无公交路径；站点接驳依赖 OSM 步行网完整度。 |

### K10 工作日出行分布矩阵

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 工作日出行分布矩阵 / 模型步骤 22 / 2026 工作日 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/trip-distribution-2026.npz`（NPZ，3.06 MB） |
| 规模 | 含外部口岸的小区对及出行目的；`trip-distribution-2026.npz`：分区轴 470；矩阵 470×470 |
| 每条包含什么 | `T_HBW`、`T_HBS`、`T_NHB` 等；每格是某目的从一区到另一区的全天出行。 |
| 空间单位 | 470×470 小区对 |
| 实测还是推算 | 推算（目的地配平）；由 K03、K09、K01、K02、H01 经 22 推算。 |
| 用在哪一步 | `pipeline/22_trip_distribution.py`、`pipeline/23_mode_choice.py`、`pipeline/26_goods_and_boundary_vehicles.py` |
| 已知问题 | 过海系数 K 与 9 个主要地区的区内系数都是拟合参数（9/26 起，表 3.5 自给率逐区对准，沙田 21%→31%，系数 2.34 最大；区内系数代替模型还没有的铁路拥挤，以后加拥挤回代要重拟合）。 |

### K11 交通方式划分矩阵

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 交通方式划分矩阵 / 模型步骤 23 / 2026 工作日 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/mode-split-2026.npz`（NPZ，12.06 MB） |
| 规模 | 小区对、目的、交通方式；`mode-split-2026.npz`：分区轴 470；矩阵 470×470 |
| 每条包含什么 | `T_HBW_PV`、`T_HBW_TAXI`、`T_HBW_PT`；每格是上班出行选私家车、的士或公交的人次。 |
| 空间单位 | 470×470 小区对 |
| 实测还是推算 | 推算（选择模型）；由 K10、K03、K01、K08、K09、K02、A04、I02、I03、H01、G01 经 23 推算。 |
| 用在哪一步 | `pipeline/23_mode_choice.py`、`pipeline/24_peak_hour.py`、`pipeline/28_taxi_requests.py`、`pipeline/27_road_assignment.py` |
| 已知问题 | 巴士／小巴票价按港铁距离关系近似；有车概率是住户结构推算。 |

### K12 早高峰出行与车辆矩阵

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 早高峰出行与车辆矩阵 / 模型步骤 24 / 2026 工作日 08:00—09:00 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/am-peak-2026.npz`（NPZ，5.52 MB） |
| 规模 | 小区对、方式、人次与车次；`am-peak-2026.npz`：分区轴 470；矩阵 470×470 |
| 每条包含什么 | `P_PV`、`V_PV`、`V_TAXI`；`V_PV` 是早高峰该小区对的私家车车次。 |
| 空间单位 | 470×470 小区对 |
| 实测还是推算 | 推算（全天到高峰换算）；由 K11、K02、G01、K08 经 24 换算。 |
| 用在哪一步 | `pipeline/24_peak_hour.py`、`pipeline/27_road_assignment.py`、`pipeline/27b_congested_skim.py`、`pipeline/39_transit_assignment.py` |
| 已知问题 | 各目的高峰比例取自调查；人次换车次另用普查载客率。 |

### K13 巴士与小巴道路预加载

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 巴士与小巴道路预加载 / 模型步骤 25 / 2026 工作日 08:00—09:00 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/bus-preload-am.parquet`（PARQUET，200.1 KB）<br>`data/model/bus-segment-paths.parquet`（PARQUET，514.0 KB） |
| 规模 | 逐路段方向流量和站间路径；`bus-preload-am.parquet`：21,983 条；`bus-segment-paths.parquet`：14,289 条 |
| 每条包含什么 | `bus_ab`、`minibus_ab`；表示该道路方向已有多少巴士或小巴经过。 |
| 空间单位 | 道路方向、站间路径 |
| 实测还是推算 | 推算（班距铺路）；由 E03、K04、G01、K05 经 25 计算。 |
| 用在哪一步 | `pipeline/25_bus_preload.py`、`pipeline/27_road_assignment.py` |
| 已知问题 | 少数站点路径不能铺到道路；审计给出匹配覆盖。 |

### K14 货车与跨境车辆需求

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 货车与跨境车辆需求 / 模型步骤 26 / 2026 工作日 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/goods-2026.npz`（NPZ，3.21 MB） |
| 规模 | 含口岸的小区对和车种；`goods-2026.npz`：分区轴 470；矩阵 470×470 |
| 每条包含什么 | `V_GOODS_LIGHT`、`V_GOODS_HEAVY`、`V_BOUNDARY_CAR`；每格是相应车种的车次。 |
| 空间单位 | 470×470 小区对 |
| 实测还是推算 | 推算（旧调查外推）；由 F02、G03、H03、K01、K03、K08、K10、K02、H01、G01 经 26 推算。 |
| 用在哪一步 | `pipeline/26_goods_and_boundary_vehicles.py`、`pipeline/27_road_assignment.py` |
| 已知问题 | 货车出行行为来自 2011 调查，2026 规模按车队与口岸资料外推。 |

### K15 早高峰道路分配结果

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 早高峰道路分配结果 / 模型步骤 27 / 2026 工作日 08:00—09:00 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/assignment-am-2026.parquet`（PARQUET，2.33 MB） |
| 规模 | 每个可行驶路段方向一行；`assignment-am-2026.parquet`：47,693 条 |
| 每条包含什么 | `car`、`taxi`、`goods_light`、`total`、`congested_time`；`total` 是该方向早高峰各车种合计车辆。 |
| 空间单位 | 道路行驶方向 |
| 实测还是推算 | 推算（均衡分配）；由 K04、K12、K14、K13、K05、G01、K11、I01、H01 经 27 分配。 |
| 用在哪一步 | `pipeline/27_road_assignment.py`、`pipeline/27b_congested_skim.py` |
| 已知问题 | 审计仍标出 GEH 与走廊分流问题，不能称全网已完全校准。 |

### K16 拥堵反馈时间矩阵

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 拥堵反馈时间矩阵 / 模型步骤 27b / 2026 早高峰反馈 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/skim-car-am-delay.npz`（NPZ，1.53 MB） |
| 规模 | 内部小区两两组合；`skim-car-am-delay.npz`：分区轴 455；矩阵 455×455 |
| 每条包含什么 | `delay_min`；每格是早高峰塞车相对自由流的增加分钟数。 |
| 空间单位 | 455×455 小区对 |
| 实测还是推算 | 推算（分配结果回代）；由 K15、K08、K02、G01、K12 经 27b 计算。 |
| 用在哪一步 | `pipeline/27b_congested_skim.py`、`pipeline/23_mode_choice.py` |
| 已知问题 | 审计显示一次反馈后达到稳定阈值，但仍继承道路分配偏差。 |

### K17 全天的士叫车请求

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 全天的士叫车请求 / 模型步骤 28 / 2026 工作日全天 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/taxi-requests-2026.parquet`（PARQUET，10.58 MB） |
| 规模 | 每行一个模拟请求；`taxi-requests-2026.parquet`：715,443 条 |
| 每条包含什么 | `time_sec`、`origin_zone`、`destination_zone`、`passengers`；每条是一个按需求抽出的叫车事件。 |
| 空间单位 | 请求、时间、小区 |
| 实测还是推算 | 推算（矩阵展开）；由 K11、K02、G01、K03、K04、K08、H01 经 28 展开。 |
| 用在哪一步 | `pipeline/28_taxi_requests.py`、`pipeline/29_fleet_supply.py`、`pipeline/31_fleet_simulator.py`、`pipeline/32_deployment_scenario.py`、`pipeline/34_scenarios.py`、`pipeline/35_duty_and_charging.py` |
| 已知问题 | 请求是按统计矩阵生成的合成个体，不是实测订单。 |

### K18 的士车队逐小时供给

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 的士车队逐小时供给 / 模型步骤 29 / 2026 工作日 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/taxi-fleet-hourly.parquet`（PARQUET，6.8 KB） |
| 规模 | 24 个小时；`taxi-fleet-hourly.parquet`：24 条 |
| 每条包含什么 | `requests`、`busy_taxis`、`on_road_at_70`；表示各小时需求和假设占用率下的需车数。 |
| 空间单位 | 小时 |
| 实测还是推算 | 估算（运营率情景）；由 K17、K08、G01 经 29 估算。 |
| 用在哪一步 | `pipeline/29_fleet_supply.py` |
| 已知问题 | 占用率是情景参数，不是实时的士定位观测。 |

### K19 交通月报时间序列

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 交通月报时间序列 / 模型步骤 30 / 2013—2026 本地月报 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/td-digest-series.json`（JSON，22.2 KB） |
| 规模 | 一组按年／月索引的时间序列 |
| 每条包含什么 | `patronage_thousand_per_day`、`taxi_fleet`；把月报人次和的士数量变成可读序列。 |
| 空间单位 | 月、方式 |
| 实测还是推算 | 推算（表格整理）；由 G03 经 30 整理。 |
| 用在哪一步 | `pipeline/30_td_digest_series.py`、`pipeline/31_fleet_simulator.py`、`pipeline/32_deployment_scenario.py`、`pipeline/34_scenarios.py` |
| 已知问题 | 表格整理不改变官方数值；单位仍须按月报标注。 |

### K20 的士车队逐小时仿真

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 的士车队逐小时仿真 / 模型步骤 31 / 2026 工作日 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/fleet-simulation-2026.parquet`（PARQUET，8.0 KB） |
| 规模 | 24 个小时；`fleet-simulation-2026.parquet`：24 条 |
| 每条包含什么 | `served`、`gave_up`、`mean_wait_min`；每小时多少单被接走、放弃和平均等候多久。 |
| 空间单位 | 小时 |
| 实测还是推算 | 推算（分钟级仿真）；由 K17、K08、K06、K03、K04、K19 经 31 仿真。 |
| 用在哪一步 | `pipeline/31_fleet_simulator.py` |
| 已知问题 | 结果依赖派车、等待上限和车队数量假设。 |

### K21 无人车分区投放情景

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 无人车分区投放情景 / 模型步骤 32 / 2026 工作日 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/deployment-scenarios.parquet`（PARQUET，23.6 KB） |
| 规模 | 每地区／车队／小时一行；`deployment-scenarios.parquet`：240 条 |
| 每条包含什么 | `area`、`av_fleet`、`served_av`、`served_taxi`；描述不同投放规模下服务分配。 |
| 空间单位 | 地区、车队、小时 |
| 实测还是推算 | 推算（投放情景）；由 K17、K08、K06、K04、K03、K19 经 32 仿真。 |
| 用在哪一步 | `pipeline/32_deployment_scenario.py`、`pipeline/33_deployment_web.py` |
| 已知问题 | 是假设情景，不代表已有无人车运营。 |

### K22 夜间与配额扩展情景

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 夜间与配额扩展情景 / 模型步骤 34 / 2026 工作日 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/extra-scenarios.parquet`（PARQUET，27.8 KB） |
| 规模 | 每种政策／地区／小时一行；`extra-scenarios.parquet`：240 条 |
| 每条包含什么 | `kind`、`from_hour`、`taxi_fleet`、`served_av`；描述夜间窗口或车队替换。 |
| 空间单位 | 情景、地区、小时 |
| 实测还是推算 | 推算（政策情景）；由 K21、K17、K08、K06、K04、K03、K19 经 34 仿真。 |
| 用在哪一步 | `pipeline/34_scenarios.py`、`pipeline/33_deployment_web.py` |
| 已知问题 | 依赖同一组合成请求和政策假设，不能解释为政策实际效果。 |

### K23 换更与充电规则情景

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 换更与充电规则情景 / 模型步骤 35 / 2026 工作日 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/duty-scenarios.parquet`（PARQUET，22.7 KB） |
| 规模 | 规则／车队／小时一行；`duty-scenarios.parquet`：408 条 |
| 每条包含什么 | `rule`、`range_km`、`served`、`wait_min`；比较换更和充电约束下的车队服务。 |
| 空间单位 | 规则、车队、小时 |
| 实测还是推算 | 推算（运营情景）；由 K17、K08、K06、K03、K04、K19 经 35 仿真。 |
| 用在哪一步 | `pipeline/35_duty_and_charging.py` |
| 已知问题 | 充电续航及换更时长为情景设定。 |

### K24 2024 土地用途分区汇总

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 2024 土地用途分区汇总 / 模型步骤 36 / 2024 格网／2026 分区 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/land-utilization-2024.parquet`（PARQUET，52.3 KB） |
| 规模 | 每个内部模型分区一行；`land-utilization-2024.parquet`：455 条 |
| 每条包含什么 | `ha_1`、`ha_21` 等；每列是某用途在这个分区的公顷数。 |
| 空间单位 | 455 个内部模型分区 |
| 实测还是推算 | 推算（格网汇总）；由 B01、C01 和网页分区边界经 36 汇总。 |
| 用在哪一步 | `pipeline/36_land_utilization.py` |
| 已知问题 | 私宅／公营住宅拆分依赖邻近建筑物判别。 |

### K25 法定用途地带与可建楼面

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 法定用途地带与可建楼面 / 模型步骤 37 / 现存图则／2026 分区 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/zoning-2026.parquet`（PARQUET，45.08 MB）<br>`data/model/zoning-capacity.parquet`（PARQUET，56.6 KB） |
| 规模 | 逐地带与逐分区两张表；`zoning-2026.parquet`：11,958 条；`zoning-capacity.parquet`：455 条 |
| 每条包含什么 | `zone_label`、`pr_max`、`floor_cap_m2`、`ha_commercial`；描述规划用途、地积比和可建楼面。 |
| 空间单位 | 地带、455 个内部模型分区 |
| 实测还是推算 | 推算（图则叠加）；由 B02、C01 和网页分区边界经 37 推算。 |
| 用在哪一步 | `pipeline/37_statutory_zoning.py` |
| 已知问题 | 缺注释地积比处使用规划标准默认值。 |

### K26 2026 分区物业价值

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 2026 分区物业价值 / 模型步骤 38 / 2026 分区 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/property-values-2026.parquet`（PARQUET，24.1 KB） |
| 规模 | 每个内部模型分区一行；`property-values-2026.parquet`：455 条 |
| 每条包含什么 | `price_m2_AB`、`rent_m2_AB`；每区继承所在行政区的楼价与租金估计。 |
| 空间单位 | 455 个内部模型分区 |
| 实测还是推算 | 推算（行政区数值下推）；由 B03 和网页分区边界经 38 推算。 |
| 用在哪一步 | `pipeline/38_property_values.py` |
| 已知问题 | 同一区所有模型小区数值相同，不能解释为小区实测房价。 |

### K27 早高峰公共交通分配结果

| 项 | 内容 |
|---|---|
| 名称 / 发布机构 / 年份或版本 | 早高峰公共交通分配结果 / 模型步骤 39 / 2026 工作日早高峰 |
| 网址（代码里写了才填） | —（对应代码未列网址） |
| 本地文件 | `data/model/transit-assignment-am-2026.parquet`（PARQUET，788.8 KB） |
| 规模 | 线路的相邻站段逐行；`transit-assignment-am-2026.parquet`：43,996 条 |
| 每条包含什么 | `line`、`from_station`、`to_station`、`volume`、`load_factor`；每条是某线某站间的模型乘客量与拥挤度。 |
| 空间单位 | 线路站间段 |
| 实测还是推算 | 推算（时刻表客流分配）；由 E03、K12、K04、H01、B01 经 39 分配。 |
| 用在哪一步 | `pipeline/39_transit_assignment.py` |
| 已知问题 | 部分港铁班距按官网修正；结果是模型客流，审计用公开最繁忙段作校核。 |

## 模型最终用了什么

这里列的是四阶段各脚本**直接打开**的文件；前面的章节说明这些文件再往前来自哪里。表中的“分配”包括道路与公共交通两部分。

| 阶段 | 脚本 | 直接读取的数据 |
|---|---|---|
| ① 出行生成 | `pipeline/21_trip_generation.py` | `data/model/landuse-2026.parquet`、`data/web/zones-attraction.geojson`、`data/raw/projections/table_15.csv`、`data/model/parameters-tcs2022.json`、`data/raw/tpedm/tpedm-2021-based.geojson`、`data/web/cross-boundary.json`、`data/raw/buildings/buildings-classified.parquet` |
| ② 出行分布 | `pipeline/22_trip_distribution.py` | `data/model/trip-ends-2026.parquet`、`data/model/skim-active-transit.npz`、`data/model/landuse-2026.parquet`、`data/model/parameters-tcs2022.json`、`data/web/cross-boundary.json` |
| ③ 方式划分 | `pipeline/23_mode_choice.py` | `data/model/trip-distribution-2026.npz`、`data/model/trip-ends-2026.parquet`、`data/model/landuse-2026.parquet`、两份时间矩阵 `skim-car-freeflow.npz` 与 `skim-active-transit.npz`、`parameters-tcs2022.json`、统计处收入表、港铁车费表、市区的士收费、社区 GTFS、口岸表、ATC 载客率 |
| ④a 早高峰换算 | `pipeline/24_peak_hour.py` | `mode-split-2026.npz`、`parameters-tcs2022.json`、ATC 载客率／站点、`skim-car-freeflow.npz` |
| ④b 巴士预加载 | `pipeline/25_bus_preload.py` | 合并 GTFS、`road-links.parquet`、`road-nodes.parquet`、ATC 站点／载客率、`census-links.parquet` |
| ④c 货车与跨境车 | `pipeline/26_goods_and_boundary_vehicles.py` | 2011 货车调查、运输署月报跨境表、`landuse-2026.parquet`、`trip-ends-2026.parquet`、`skim-car-freeflow.npz`、`trip-distribution-2026.npz`、`parameters-tcs2022.json`、口岸表及 ATC 载客率 |
| ④d 道路分配 | `pipeline/27_road_assignment.py` | 道路路段与接驳、早高峰矩阵、货车矩阵、巴士预加载、普查站对应路段与站点／载客率、方式划分审计、物价指数、口岸表 |
| ④e 公交分配 | `pipeline/39_transit_assignment.py` | 合并 GTFS、早高峰矩阵、分区中心、网页分区、口岸表、土地用途格网 |

**使用边界：**道路探测器的实时车流主要供地图展示，并用于推算逐时速度与拥堵曲线；不能把其 807 个点写成全港每条道路的实测流量。公交与道路分配结果均属模型推算。

