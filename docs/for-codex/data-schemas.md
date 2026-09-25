# 管线产物数据字典（供 Codex 阅读）

> 本文依据 `pipeline/*.py` 的写出代码确定字段，并搜索仓库源码中的读取路径确认消费者；没有打开 `.parquet`、`.npz`、`.gdb`、`.pdf` 或 `.xls`。类型是源码写出时的逻辑类型或显式 dtype。规模只有在脚本说明或中文报告明确记录时才给数值，否则写“未记录”。没有匹配消费者时标为【推断】。

## `data/model/`

### `data/model/am-peak-2026.npz`

- 生成：`pipeline/24_peak_hour.py`
- 消费：`pipeline/27_road_assignment.py`
- 规模：未记录

| 数组 | 类型 | 含义 |
|---|---|---|
| `zones` | 字符串一维数组 | 与所有矩阵行列一致的小区顺序 |
| `P_PV`、`P_TAXI`、`P_PT`、`P_SPB` | `float32` 二维数组 | 08:00–09:00 各方式人次，起点→终点 |
| `V_PV`、`V_TAXI`、`V_SPB` | `float32` 二维数组 | 08:00–09:00 各道路车辆方式车次，起点→终点 |

### `data/model/assignment-am-2026.parquet`

- 生成：`pipeline/27_road_assignment.py`
- 消费：`pipeline/diagnose_corridors.py`
- 规模：未记录

| 字段 | 类型 | 含义 |
|---|---|---|
| `car`、`taxi`、`goods_light`、`goods_heavy`、`coach` | 浮点数 | 各车辆类别的均衡分配流量 |
| `preload`、`bus`、`total` | 浮点数 | 固定公交预载、公交量与总流量 |
| `congested_time`、`free_time` | 浮点数 | 拥堵与自由流行驶分钟 |
| `road_link` | 整数 | `road-links.parquet` 的链接编号 |
| `side` | 字符串 | `ab` 或 `ba` 行驶方向 |
| `capacity` | 浮点数 | 该方向设计流量（辆/小时） |
| `distance` | 浮点数 | 路段公里 |
| `heavy_share` | 浮点数 | 重型车辆占比 |
| `vc` | 浮点数 | 总流量/容量 |

### `data/model/building-trip-ends.parquet`

- 生成：`pipeline/21_trip_generation.py`
- 消费：`pipeline/15_road_network.py`、`pipeline/28_taxi_requests.py`
- 规模：未记录

| 字段 | 类型 | 含义 |
|---|---|---|
| `OBJECTID` | 整数 | 建筑物源数据编号 |
| `zone` | 字符串 | 所属模型小区 |
| `use` | 字符串 | 建筑用途 |
| `home` | 布尔值 | 是否作为住宅端点 |
| `lon`、`lat` | 浮点数 | WGS84 坐标 |
| `gfa_m2` | 浮点数 | 建筑毛楼面面积（平方米） |
| `trip_ends` | 浮点数 | 分配到该建筑的出行端点权重 |

### `data/model/bus-preload-am.parquet`

- 生成：`pipeline/25_bus_preload.py`
- 消费：`pipeline/27_road_assignment.py`
- 规模：中文报告记录 21,983 个有巴士路段

| 字段 | 类型 | 含义 |
|---|---|---|
| `link_id` | 整数 | 道路链接编号 |
| `bus_ab`、`bus_ba` | 浮点数 | 08:00–09:00 两方向专营巴士辆数 |
| `minibus_ab`、`minibus_ba` | 浮点数 | 08:00–09:00 两方向专线小巴辆数 |

### `data/model/bus-segment-paths.parquet`

- 生成：`pipeline/25_bus_preload.py`
- 消费：【推断】未发现仓库内直接消费者
- 规模：未记录

| 字段 | 类型 | 含义 |
|---|---|---|
| `from_stop`、`to_stop` | 字符串 | 站到站路段两端的 GTFS 站点编号 |
| `links` | 整数列表 | 该站间路径经过的道路链接 |
| `sides` | 字符串列表 | 与 `links` 对齐的 `ab`/`ba` 方向 |

### `data/model/census-links.parquet`

- 生成：`pipeline/15c_census_links.py`
- 消费：`pipeline/25_bus_preload.py`、`pipeline/27_road_assignment.py`、`pipeline/diagnose_corridors.py`
- 规模：中文报告记录 416 个路段方向

| 字段 | 类型 | 含义 |
|---|---|---|
| `station` | 整数 | 交通流量普查站编号 |
| `direction` | 字符串 | 普查计数方向 |
| `link_id` | 整数 | 匹配的道路链接编号 |
| `side` | 字符串 | `ab` 或 `ba` 方向 |
| `street`、`census_road` | 字符串 | 路网道路名与普查道路名 |
| `distance_m` | 浮点数 | 站点到匹配路段距离（米） |
| `matched_by` | 字符串 | 路名/最近距离/断面等匹配方法 |
| `carriageways` | 整数 | 该计数方向覆盖的平行车行道数 |

### `data/model/deployment-scenarios.parquet`

- 生成：`pipeline/32_deployment_scenario.py`
- 消费：`pipeline/33_deployment_web.py`、`pipeline/34_scenarios.py`
- 规模：未记录；一行是一个投放区域 × 无人车规模 × 小时，共 17 列

| 字段 | 类型 | 含义 |
|---|---|---|
| `area` | 字符串 | 持牌无人车可接单的投放区域 |
| `av_fleet`、`hour` | 整数 | 无人车规模与小时（0–23） |
| `requests_in_area`、`requests_total` | 整数 | 区内起点请求数与全港请求数 |
| `served_av`、`served_taxi`、`gave_up` | 整数 | 无人车/的士完成数及放弃数 |
| `wait_in_area_min`、`wait_total_min` | 浮点数 | 区内及全港已服务请求的平均等待分钟 |
| `av_empty_km`、`av_paid_km`、`taxi_empty_km`、`taxi_paid_km` | 浮点数 | 两类车辆的空驶与载客公里 |
| `av_busy`、`taxi_busy` | 浮点数 | 小时平均在跑车辆数 |
| `av_outside_area` | 整数 | 小时末停在投放区外的空闲无人车数 |

### `data/model/extra-scenarios.parquet`

- 生成：`pipeline/34_scenarios.py`
- 消费：`pipeline/33_deployment_web.py`
- 规模：未记录；一行是一个情景 × 投放区域 × 无人车规模 × 小时，共 21 列
- 字段：完整继承上表的 17 列，另有以下 4 列。

| 新增字段 | 类型 | 含义 |
|---|---|---|
| `kind` | 字符串 | `time_window`（夜间窗口）或 `quota_swap`（无人车加入同时退出的士牌照） |
| `taxi_fleet` | 整数 | 该情景的士车队规模 |
| `from_hour`、`to_hour` | 整数 | 无人车可接单时间窗，左闭右开；例如 22→6 跨午夜，0→24 为全天 |

### `data/model/fleet-simulation-2026.parquet`

- 生成：`pipeline/31_fleet_simulator.py`
- 消费：`tests/test_product_layer.py`
- 规模：未记录；粒度为每小时一行

| 字段 | 类型 | 含义 |
|---|---|---|
| `hour` | 整数 | 小时（0–23） |
| `requests`、`served`、`gave_up` | 浮点数 | 到达请求、已服务请求、放弃请求数 |
| `mean_wait_min`、`max_wait_min` | 浮点数 | 平均与最长等待分钟 |
| `empty_km`、`paid_km` | 浮点数 | 接客空驶与载客公里 |
| `vehicles_busy` | 浮点数 | 该小时平均忙碌车辆数 |
| `empty_share` | 浮点数 | `empty_km/(empty_km+paid_km)` |

### `data/model/goods-2026.npz`

- 生成：`pipeline/26_goods_and_boundary_vehicles.py`
- 消费：`pipeline/27_road_assignment.py`
- 规模：未记录

| 数组 | 类型 | 含义 |
|---|---|---|
| `zones` | 字符串一维数组 | 行列的小区顺序 |
| `D_GOODS_LIGHT`、`D_GOODS_HEAVY`、`D_BOUNDARY_CAR`、`D_BOUNDARY_COACH` | `float32` 二维数组 | 全天车辆车次，起点→终点 |
| `V_GOODS_LIGHT`、`V_GOODS_HEAVY`、`V_BOUNDARY_CAR`、`V_BOUNDARY_COACH` | `float32` 二维数组 | 08:00–09:00 车辆车次，起点→终点 |

### `data/model/landuse-2026.parquet`

- 生成：`pipeline/16_landuse_2026.py`
- 消费：`pipeline/17_car_skim.py`、`pipeline/21_trip_generation.py`、`pipeline/22_trip_distribution.py`、`pipeline/23_mode_choice.py`、`pipeline/26_goods_and_boundary_vehicles.py`
- 规模：未记录

| 字段 | 类型 | 含义 |
|---|---|---|
| `zone`、`census_zone`、`district` | 字符串 | 模型小区、母普查小区、行政区 |
| `population_2021`、`population`、`age_0_14`、`age_15_24`、`age_25_44`、`age_45_64`、`age_65_plus` | 整数 | 基年/目标年人口及年龄组 |
| `households`、`households_public`、`households_private` | 整数 | 住户数及公私营住房住户 |
| `workers`、`labour_force`、`work_same_zone`、`work_hk_island`、`work_kowloon`、`work_nt`、`work_at_home`、`work_outside_hk`、`work_no_fixed_place` | 整数 | 工作人口与工作地分类 |
| `students`、`study_same_zone`、`study_hk_island`、`study_kowloon`、`study_nt` | 整数 | 学生与就学地分类 |
| `household_size`、`area_km2`、`centroid_lon`、`centroid_lat` | 浮点数 | 户均人数、面积与小区活动中心坐标 |
| `gfa_*` | 浮点数 | 各用途毛楼面面积；字段来自 attraction/schools/institutions 图层 |
| `schools`、`places_*` | 数值 | 学校数及幼稚园、小学、中学、特殊学校、专上教育学额 |

### `data/model/mode-split-2026.npz`

- 生成：`pipeline/23_mode_choice.py`
- 消费：`pipeline/24_peak_hour.py`、`pipeline/28_taxi_requests.py`、`tests/test_product_layer.py`
- 规模：未记录

| 数组 | 类型 | 含义 |
|---|---|---|
| `zones` | 字符串一维数组 | 行列的小区顺序 |
| `T_<purpose>_<mode>` | `float32` 二维数组 | 各目的、各方式的全天人次，起点→终点；`purpose` 为 `HBW/HBS/HBO/NHB/CBS/CBR/CBV`，`mode` 为 `PV/TAXI/PT/SPB` |

### `data/model/parameters-tcs2022.json`

- 生成：`pipeline/20_behaviour_parameters.py`
- 消费：`pipeline/21_trip_generation.py`、`pipeline/22_trip_distribution.py`、`pipeline/23_mode_choice.py`、`pipeline/24_peak_hour.py`、`pipeline/26_goods_and_boundary_vehicles.py`、`pipeline/28_taxi_requests.py`
- 规模：未记录

| 字段 | 类型 | 含义 |
|---|---|---|
| `source`、`url` | 字符串 | 调查来源与网址 |
| `weekday_mechanised_trips`、`trip_rates` | 对象 | 按目的的工作日机动化出行量与出行率 |
| `mean_journey_time_min`、`journey_time_shares_pct` | 对象 | 平均出行时间与时长区间占比 |
| `regional_movements`、`self_containment_pct` | 对象 | 大区间流动与自给率标定目标 |
| `boarding_shares_pct`、`boardings_by_mode_purpose` | 对象 | 各方式乘车占比及按目的乘车次数 |
| `value_of_time_cents_per_min_2022` | 对象 | 2022 年价格的时间价值 |
| `pv_availability_pct`、`broad_districts` | 对象 | 有车比例及 26 个大区人口/出行参数 |
| `max_acceptable_wait_min`、`access_walk_min` | 对象 | 可接受候车与接驳步行分钟 |
| `stated_mode_switching_pct` | 对象 | 增加出行时间后的方式转移意向 |
| `hourly_profile_pct`、`peak_hour_direction_pct` | 对象 | 24 小时曲线与高峰方向比例 |
| `not_in_report` | 字符串列表 | 报告没有提供的参数 |

### `data/model/road-connectors.parquet`

- 生成：`pipeline/15_road_network.py`
- 消费：`pipeline/17_car_skim.py`、`pipeline/27_road_assignment.py`
- 规模：中文报告记录 1,267 个接驳点

| 字段 | 类型 | 含义 |
|---|---|---|
| `zone` | 字符串 | 模型小区 |
| `node_id` | 整数 | 接入的道路节点 |
| `metres` | 浮点数 | 小区活动中心到节点的距离（米） |

### `data/model/road-links.parquet`

- 生成：`pipeline/15_road_network.py`
- 消费：`pipeline/15b_detector_corridors.py`、`pipeline/15c_census_links.py`、`pipeline/15d_speed_profiles.py`、`pipeline/17_car_skim.py`、`pipeline/25_bus_preload.py`、`pipeline/27_road_assignment.py`、`pipeline/29_fleet_supply.py`、`pipeline/31_fleet_simulator.py`、`pipeline/32_deployment_scenario.py`（`34` 复用其加载逻辑）
- 规模：中文报告记录 36,471 条路段

| 字段 | 类型 | 含义 |
|---|---|---|
| `link_id`、`objectid`、`a_node`、`b_node` | 整数 | 模型链接、源对象和两端节点编号 |
| `length_m`、`bearing`、`free_flow_min` | 浮点数 | 长度、方位角、自由流分钟 |
| `street`、`road_class`、`lanes_source` | 字符串 | 路名、道路等级、车道数来源 |
| `route_num`、`route_id`、`elevation`、`direction` | 数值 | 路线、高程层、通行方向属性 |
| `routable`、`speed_posted` | 布尔值 | 是否参与路由、车速是否为公布值 |
| `speed_kph` | 浮点数 | 自由流/限速公里每小时 |
| `lanes_ab`、`lanes_ba` | 整数 | 两方向车道数 |
| `capacity_ab_veh_hr`、`capacity_ba_veh_hr` | 数值 | 两方向设计流量 |
| `toll_hkd`、`toll_facility` | 浮点数、字符串 | 收费金额与设施名 |

### `data/model/road-nodes.parquet`

- 生成：`pipeline/15_road_network.py`
- 消费：`pipeline/15b_detector_corridors.py`、`pipeline/15c_census_links.py`、`pipeline/25_bus_preload.py`
- 规模：中文报告记录 27,319 个节点

| 字段 | 类型 | 含义 |
|---|---|---|
| `node_id` | 整数 | 道路节点编号 |
| `x`、`y` | 浮点数 | HK1980 Grid 平面坐标 |

### `data/model/road-speeds-hourly.parquet`

- 生成：`pipeline/15d_speed_profiles.py`
- 消费：`pipeline/29_fleet_supply.py`、`pipeline/31_fleet_simulator.py`、`pipeline/32_deployment_scenario.py`（`34` 复用其加载逻辑）
- 规模：中文报告记录 1,144,632 行（路段方向×24 小时）

| 字段 | 类型 | 含义 |
|---|---|---|
| `link_id` | 整数 | 道路链接编号 |
| `side` | 字符串 | `ab` 或 `ba` 方向 |
| `hour` | 整数 | 小时（0–23） |
| `speed` | 浮点数 | 该小时公里每小时 |
| `source` | 字符串 | `detector` 或 `class factor` |
| `limit_kph` | 浮点数 | 该链接源码中的 `speed_kph`，写出时改名为限速字段 |

### `data/model/road-turns.parquet`

- 生成：`pipeline/15_road_network.py`
- 消费：【推断】未发现仓库内直接消费者
- 规模：未记录

| 字段 | 类型 | 含义 |
|---|---|---|
| `from_link`、`to_link`、`via_link` | 数值 | 转向涉及的进入、离开及中间链接 |
| `banned`、`u_turn` | 布尔值 | 是否禁转、是否掉头 |

### `data/model/skim-active-transit.npz`

- 生成：`pipeline/18_transit_skim.py`
- 消费：`pipeline/22_trip_distribution.py`、`pipeline/23_mode_choice.py`
- 规模：未记录

| 数组 | 类型 | 含义 |
|---|---|---|
| `zones` | 字符串一维数组 | 行列的小区顺序 |
| `transit_min`、`walk_min`、`bike_min` | 浮点二维数组 | 公交、步行、自行车门到门分钟 |
| `departure` | 字符串标量 | 公交路径计算出发时刻 |
| `window_min` | 整数标量 | 计算时间窗分钟 |
| `routed_from_stop` | 字符串数组 | 改从车站路由的小区 |
| `access_penalty_min` | 浮点一维数组 | 各小区补回的接驳时间 |

### `data/model/skim-car-freeflow.npz`

- 生成：`pipeline/17_car_skim.py`
- 消费：`pipeline/18_transit_skim.py`、`pipeline/23_mode_choice.py`、`pipeline/24_peak_hour.py`、`pipeline/26_goods_and_boundary_vehicles.py`、`pipeline/28_taxi_requests.py`、`pipeline/29_fleet_supply.py`、`pipeline/31_fleet_simulator.py`、`pipeline/32_deployment_scenario.py`（`34` 复用其加载逻辑）
- 规模：中文报告记录 455×455 个小区对

| 数组 | 类型 | 含义 |
|---|---|---|
| `zones` | 字符串一维数组 | 行列的小区顺序 |
| `time_min` | 浮点二维数组 | 自由流车程分钟 |
| `distance_km` | 浮点二维数组 | 最短路径公里 |
| `toll_hkd` | 浮点二维数组 | 路径收费港元 |

### `data/model/taxi-fleet-hourly.parquet`

- 生成：`pipeline/29_fleet_supply.py`
- 消费：`tests/test_product_layer.py`
- 规模：未记录；粒度为每小时一行

| 字段 | 类型 | 含义 |
|---|---|---|
| `hour` | 整数 | 小时（0–23） |
| `requests` | 浮点数 | 该小时计入的请求数 |
| `veh_km`、`veh_min` | 浮点数 | 载客车辆公里与车辆分钟 |
| `busy_taxis` | 浮点数 | 同时载客车辆数 |
| `on_road_at_55`、`on_road_at_70`、`on_road_at_85` | 浮点数 | 三种载客率假设下所需在路车辆数 |

### `data/model/taxi-requests-2026.parquet`

- 生成：`pipeline/28_taxi_requests.py`
- 消费：`pipeline/29_fleet_supply.py`、`pipeline/31_fleet_simulator.py`、`pipeline/32_deployment_scenario.py`（`34` 复用其加载逻辑）、`tests/test_product_layer.py`
- 规模：`pipeline/31_fleet_simulator.py` 说明记录全天 717,198 条请求

| 字段 | 类型 | 含义 |
|---|---|---|
| `request_id` | `int64` | 从 1 起的请求编号 |
| `time_sec` | 整数 | 0 点起请求秒数 |
| `origin_zone`、`destination_zone` | 分类字符串 | 起点、终点小区编号；跨境编号以 `X:` 开头 |
| `origin_lon`、`origin_lat`、`destination_lon`、`destination_lat` | `float64` | 起终点 WGS84 坐标 |
| `purpose` | 分类字符串 | `HBW/HBS/HBO/NHB/CBS/CBR/CBV` |
| `passengers` | `uint8` | 每条请求乘客数；当前代码固定为 1 |

### `data/model/td-digest-series.json`

- 生成：`pipeline/30_td_digest_series.py`
- 消费：`pipeline/29_fleet_supply.py`、`pipeline/31_fleet_simulator.py`、`pipeline/32_deployment_scenario.py`（`34` 复用其车队数）
- 规模：中文报告记录 5 个年度、66 个月份

| 字段 | 类型 | 含义 |
|---|---|---|
| `source`、`edition` | 字符串 | 运输署月报来源与版本 |
| `files` | 字符串列表 | 两个源工作簿路径 |
| `patronage_thousand_per_day.unit`、`.table` | 字符串 | 客运量单位与表号 |
| `patronage_thousand_per_day.annual`、`.monthly` | 对象 | 年度/月份→营办商或合计→千人次/日 |
| `taxi_fleet.table` | 字符串 | 的士车队表号 |
| `taxi_fleet.annual` | 对象 | 年度→`urban/new_territories/lantau/total`→`first_registration/registered/licensed` |

### `data/model/trip-distribution-2026.npz`

- 生成：`pipeline/22_trip_distribution.py`
- 消费：`pipeline/23_mode_choice.py`、`pipeline/26_goods_and_boundary_vehicles.py`
- 规模：未记录

| 数组 | 类型 | 含义 |
|---|---|---|
| `zones` | 字符串一维数组 | 行列的小区顺序 |
| `T_HBW`、`T_HBS`、`T_HBO`、`T_NHB`、`T_CBS`、`T_CBR`、`T_CBV` | `float32` 二维数组 | 各目的全天人次，产生端→吸引端 |

### `data/model/trip-ends-2026.parquet`

- 生成：`pipeline/21_trip_generation.py`
- 消费：`pipeline/15_road_network.py`、`pipeline/19_web_zones.py`、`pipeline/22_trip_distribution.py`、`pipeline/23_mode_choice.py`、`pipeline/26_goods_and_boundary_vehicles.py`、`pipeline/28_taxi_requests.py`、`pipeline/31_fleet_simulator.py`、`pipeline/32_deployment_scenario.py`（`34` 复用其加载逻辑）
- 规模：未记录

| 字段 | 类型 | 含义 |
|---|---|---|
| `zone`、`district`、`broad` | 字符串 | 小区、行政区、TCS 大区 |
| `population`、`workers`、`students`、`jobs` | 浮点数 | 人口、工作人口、学生与岗位 |
| `P_<purpose>`、`A_<purpose>` | 浮点数 | 各目的产生量与吸引量 |
| `external` | 布尔值 | 是否为外部口岸小区 |
| `name`、`mode`、`host_zone` | 字符串 | 口岸名、方式、挂靠内部小区 |
| `lon`、`lat` | 浮点数 | 口岸坐标 |

### `data/model/zone-centres.parquet`

- 生成：`pipeline/15_road_network.py`
- 消费：`pipeline/18_transit_skim.py`、`pipeline/19_web_zones.py`、`pipeline/28_taxi_requests.py`
- 规模：未记录

| 字段 | 类型 | 含义 |
|---|---|---|
| `zone` | 字符串 | 模型小区 |
| `x`、`y` | 浮点数 | HK1980 Grid 活动中心坐标 |
| `lon`、`lat` | 浮点数 | WGS84 活动中心坐标 |

## `data/web/` 的非审计产物

### 点位、交通观测与道路显示

| 产物 | 生成 | 消费 | 规模 | 字段（类型与含义） |
|---|---|---|---|---|
| `data/web/places.json` | `01_build_place_index.py` | `pipeline/19_web_zones.py`、后端点位索引 | 未记录 | 顶层 `source/generated` 字符串、`places` 列表；每点 `name_zh/name_en/kind` 字符串，`lon/lat` 浮点坐标 |
| `data/web/traffic/detectors.json` | `05_traffic_detectors.py` | `06_detector_road_segments.py`、`15b_detector_corridors.py`、`15d_speed_profiles.py`、实时交通后端 | 未记录 | 探测器列表；`id/district/road_en/road_zh/direction` 字符串，`lon/lat` 浮点坐标 |
| `data/web/traffic/observed-<date>.json` | `05_traffic_detectors.py` | `15d_speed_profiles.py`、实时交通后端 | 未记录 | 顶层 `date/weekday/source/note` 字符串，`sampled_every_minutes/snapshots_used` 整数，`detectors` 列表；每项含 `id` 及三个 24 项数组 `vehicles_per_hour/speed_kph/samples_per_hour` |
| `data/web/traffic/atc-stations.json` | `07_annual_traffic_census.py` | `15c_census_links.py`、`24_peak_hour.py`、`25_bus_preload.py`、`27_road_assignment.py`、`28_taxi_requests.py`、`29_fleet_supply.py`、`diagnose_corridors.py` | 未记录 | 顶层 `source/note` 字符串、`years` 整数对、`records/hourly` 列表；记录含站号、年份、方向、道路属性、AADT、高峰流量、车辆比例与坐标；逐小时项含站号、年份及 `weekday_pct/all_days_pct` 24 项数组 |
| `data/web/traffic/atc-occupancy.json` | `07_annual_traffic_census.py` | `23_mode_choice.py`、`24_peak_hour.py`、`25_bus_preload.py`、`26_goods_and_boundary_vehicles.py`、`27_road_assignment.py`、`28_taxi_requests.py`、`29_fleet_supply.py`、`diagnose_corridors.py` | 未记录 | 顶层 `source/note/classes`、`summary` 对象、`stations` 列表；站点项含 `station/year/hours`，每时段每车种含 `share_pct/occupancy`；汇总含加权 `share/occupancy` |
| `data/web/traffic/detector-roads.json` | `06_detector_road_segments.py` | 【推断】无；脚本说明已被 `15b` 取代 | 未记录 | `source` 字符串、`stretch_metres` 数值、`roads` 列表；每路段含探测器编号、路名、方向、吸附距离和 `path` 坐标数组 |
| `data/web/traffic/detector-corridors.json` | `15b_detector_corridors.py` | 前端实时交通图 | 未记录 | `source` 字符串、`corridors` 列表、`unmatched` 探测器编号列表；每条走廊含 `detectors/path/a/b/t/length_m`，后三个数组用于沿线插值 |

### 分区 GeoJSON 与元数据

所有 GeoJSON 均为 `FeatureCollection`；`geometry` 是 WGS84 Polygon/MultiPolygon，下面列的是 `properties`。

| 产物 | 生成 | 消费 | 规模 | 属性（类型与含义） |
|---|---|---|---|---|
| `data/web/zones-census.geojson` | `08_build_zones.py` | `14_split_zones.py`、`16_landuse_2026.py` | 中文报告记录 211 个普查小区 | `zone/name_en/name_zh` 字符串；人口、年龄、工作、住户、就学字段为整数；`household_size/area_km2/density_per_km2` 数值 |
| `data/web/zones.geojson` | `14_split_zones.py` | `10_zone_attraction.py`、`11_zone_schools.py`、`12_zone_institutions.py`、`15_road_network.py`、`16_landuse_2026.py`、`19_web_zones.py` | 中文报告记录 455 个模型小区 | `zone/census_zone/name_zh` 字符串；继承并守恒的普查计数字段为整数；`dwelling_gfa_m2/centroid_lon/centroid_lat/area_km2/density_per_km2/household_size` 数值 |
| `data/web/zones-attraction.geojson` | `10_zone_attraction.py` | `16_landuse_2026.py`、`21_trip_generation.py` | 中文报告的空间覆盖以 455 个小区为分母 | 继承 `zones.geojson` 属性；增加 `gfa_<use>`、`gfa_total` 数值和 `buildings` 数值 |
| `data/web/zones-schools.geojson` | `11_zone_schools.py` | `16_landuse_2026.py` | 中文报告的空间覆盖以 455 个小区为分母 | 继承分区属性；增加 `places_kindergarten/primary/secondary/special`、`places_total`、`schools` 数值 |
| `data/web/zones-institutions.geojson` | `12_zone_institutions.py` | `16_landuse_2026.py` | 中文报告记录 62 个小区有专上院校、62 个有医疗设施 | 继承分区属性；增加 `gfa_tertiary/gfa_hospital/places_tertiary` 数值 |
| `data/web/zones-2026.geojson` | `19_web_zones.py` | 前端分区图 | 未记录 | `zone/label/label_source/district` 字符串；人口、住户、工作人口、学生、学额、岗位、出行量为整数；增长、密度、老龄占比、面积为数值；`road_access` 布尔值 |

`data/web/zones-meta.json` 由 `08_build_zones.py` 生成并供文档/前端解释字段；顶层 `source/note` 为字符串、`zones` 为整数、`fields` 为“字段名→中文含义”的对象。规模未记录。

### 其他业务 JSON

#### `data/web/cross-boundary.json`

- 生成：`pipeline/13_cross_boundary.py`
- 消费：`pipeline/21_trip_generation.py`、`pipeline/22_trip_distribution.py`、`pipeline/23_mode_choice.py`、`pipeline/26_goods_and_boundary_vehicles.py`、`pipeline/28_taxi_requests.py`
- 规模：中文报告记录 15 个已定位口岸

| 字段 | 类型 | 含义 |
|---|---|---|
| `source`、`as_of`、`basis` | 字符串 | 来源、数据日期和典型工作日口径 |
| `weekday_crossings` | 整数 | 工作日双向总人次 |
| `control_points` | 对象列表 | 每口岸的英文编号、中文名、方式、坐标、挂靠小区、挂靠距离、到达/离开、居民/访客和跨境学童数 |

#### `data/web/fleet-scenarios.json`

- 生成：`pipeline/31_fleet_simulator.py`
- 消费：`pipeline/33_deployment_web.py`、后端 `GET /api/fleet/scenarios` 与前端情景面板
- 规模：中文报告记录 6 个车队规模点

| 字段 | 类型 | 含义 |
|---|---|---|
| `note` | 字符串 | 产物来源说明 |
| `base_fleet` | 整数 | 基准领牌车队数 |
| `max_wait_min` | 浮点数 | 放弃前最长等待分钟 |
| `hourly` | 对象列表 | 与 `fleet-simulation-2026.parquet` 相同的逐小时字段 |
| `sweep` | 对象列表 | 每个车队规模的 `fleet/served_share/mean_wait_min/empty_share/peak_busy` |
| `zones.base`、`zones.small` | 对象列表 | 每小区 `zone/requests/served_share/mean_wait_min` |
| `zones.small_fleet` | 整数 | 小车队地图所用规模 |
| `limits` | 字符串列表 | 四条模型局限 |

#### `data/web/deployment-scenarios.json`

- 生成：`pipeline/33_deployment_web.py`
- 消费：`backend/main.py` 的 `GET /api/fleet/deployment`、`frontend/src/components/DeploymentPanel.tsx`
- 规模：未记录

| 字段 | 类型 | 含义 |
|---|---|---|
| `note` | 字符串 | 来源说明 |
| `areas`、`kinds` | 字符串列表 | 投放区和实际出现的情景类型 |
| `taxi_fleet` | 整数 | 基准持牌的士规模，取自 `fleet-scenarios.json` |
| `scenarios` | 对象列表 | 同时包含 `deployment`、`time_window`、`quota_swap`；前端按 `kind` 分组，未知 `kind` 也应以原值显示 |
| `scenarios[].kind`、`.area` | 字符串 | 情景类型与投放区 |
| `scenarios[].av_fleet`、`.taxi_fleet`、`.from_hour`、`.to_hour` | 整数 | 无人车与的士规模、无人车运行窗口 |
| `scenarios[].summary` | 对象 | `requests_in_area/requests_total/served_av`、`av_share_in_area`、`wait_in_area_min/wait_total_min`、`av_vehicle_km/total_vehicle_km`、`av_empty_share`、`av_busy_peak/av_outside_area_peak`；全日汇总 |
| `scenarios[].hourly` | 24 项对象数组 | 每小时一项；每项含 `hour` 及 parquet 的请求、服务、放弃、等待、里程、在跑车辆和区外无人车字段，数值保留三位小数 |
| `scenarios[].vs_baseline` | 对象 | 与同区 `deployment` 且 `av_fleet=0` 的基准比较：`wait_in_area_min` 差值、`total_vehicle_km_pct` 相对变化 |
| `limits` | 字符串列表 | 模型及区域投放限制说明 |

#### `data/web/corridor-diagnosis.json`

- 生成：`pipeline/diagnose_corridors.py`
- 消费：【推断】当前仓库内无直接读取程序；供走廊诊断和人工核对
- 规模：未记录；从现有 08:00–09:00 道路分配与普查读入后生成

| 字段 | 类型 | 含义 |
|---|---|---|
| `by_station` | 对象列表 | 可比的双向站点；每项有 `station/link/road_type/observed/modelled/ratio/geh/by_class/worst_class` |
| `by_corridor` | 对象列表 | 各走廊的 `corridor/stations/observed/modelled/ratio/geh_under_5/内部分流偏差/worst_station` |
| `by_class` | 对象 | 车种→`modelled/observed/ratio/worst_stations`；最差站还含 `difference` |
| `summary` | 字符串列表 | 全网、走廊、车种和道路类型的中文诊断结论 |

`内部分流偏差` 先把走廊总量对齐，再衡量各站分流差异：`Σ|模型ᵢ − 普查ᵢ × (Σ模型/Σ普查)| / Σ普查`。因此它将“总量错”与“站间分流错”分开；总量差异另看走廊的 `ratio = Σ模型/Σ普查`。

## `data/web/*-audit.json`

审计 JSON 统一把中文逐行结论放在 `report: list[str]`。有显式通过/未通过判据的脚本把未通过项放在 `flags: list[str]`；旧脚本中部分审计文件没有 `flags`，不能把缺字段解释成“全部通过”。其余字段都是生成器专属的中间量、阈值或汇总对象。除表中特别说明外，规模均未记录。

| 审计产物 | 生成 | 直接消费者 | 专属内容摘要 |
|---|---|---|---|
| `am-peak-audit.json` | `24_peak_hour.py` | `28_taxi_requests.py` | 时段、全天比例、方向比例、每车人数、普查车辆组成、人次和车次 |
| `assignment-audit.json` | `27_road_assignment.py` | `pipeline/diagnose_corridors.py` | 时间价值、BPR、车公里、GEH、流量比及分类比较 |
| `bus-preload-audit.json` | `25_bus_preload.py` | 【推断】未发现 | 服务日期、巴士/小巴车公里及普查核对 |
| `car-skim-audit.json` | `17_car_skim.py` | 【推断】未发现 | 分区数、不可达小区对、免费过海、车速和绕行系数 |
| `census-links-audit.json` | `15c_census_links.py` | 【推断】未发现 | `report` 与 `flags` |
| `cross-boundary-audit.json` | `13_cross_boundary.py` | 【推断】未发现 | 未知口岸与坐标行政区不一致项 |
| `data/web/deployment-audit.json` | `32_deployment_scenario.py` | 【推断】未发现仓库内直接消费者 | `checks`（10 项，各有 `name/actual/threshold/pass`，单调性另有 `comparisons`）、`flags`、中文 `report` |
| `detector-corridors-audit.json` | `15b_detector_corridors.py` | 【推断】未发现 | 探测器车道数与路网车道数核对 |
| `data/web/extra-scenarios-audit.json` | `34_scenarios.py` | 【推断】未发现仓库内直接消费者 | `night_window/night_fleets/swap_fleets/taxi_fleet/seed`、4 项 `checks`（各含 `实测/阈值/通过`）、`flags`、中文 `report` |
| `fleet-simulation-audit.json` | `31_fleet_simulator.py` | `tests/test_product_layer.py` | 车队、等待阈值、随机种子、服务/请求、空驶占比、扫描、逐小时记录 |
| `fleet-supply-audit.json` | `29_fleet_supply.py` | `31_fleet_simulator.py` | 分牌照类别车队、领牌/登记数、载客率、覆盖率、车公里、峰值与逐小时记录 |
| `goods-audit.json` | `26_goods_and_boundary_vehicles.py` | 【推断】未发现 | 重力模型参数、车队增长、全天/高峰总量、口岸车辆 |
| `landuse-2026-audit.json` | `16_landuse_2026.py` | 【推断】未发现 | 数据来源、人口校准、规划署/统计处对照 |
| `mode-choice-audit.json` | `23_mode_choice.py` | `27_road_assignment.py`、`28_taxi_requests.py` | 方式选择参数、的士车公里占比、平均行程、时间价值和目标 |
| `road-network-audit.json` | `15_road_network.py` | `17_car_skim.py`、`19_web_zones.py` | 路网规模、连通分量、无道路小区、收费、车道和容量来源 |
| `road-speeds-audit.json` | `15d_speed_profiles.py` | 【推断】未发现 | 落位探测器数、输出行数、覆盖率及道路等级车速系数；中文报告记录 1,144,632 行 |
| `taxi-requests-audit.json` | `28_taxi_requests.py` | `tests/test_product_layer.py` 只检查文件是否存在 | 请求生成、逐小时重标定、坐标/楼宇覆盖、距离、复现性和 parquet 范围 |
| `tcs-parameters-audit.json` | `20_behaviour_parameters.py` | 【推断】未发现 | 参数原文交叉核对；只有 `report` |
| `td-digest-audit.json` | `30_td_digest_series.py` | 【推断】未发现 | 六项 `checks`、`flags` 与 `report`；报告记录 5 个年度、66 个月份 |
| `transit-feed-audit.json` | `17b_transit_feed.py` | 【推断】未发现 | 输入来源与公交逐站时间补齐结果 |
| `transit-skim-audit.json` | `18_transit_skim.py` | 【推断】未发现 | 引擎、出发时刻、窗口、速度、不可达小区对 |
| `transit-skim-audit.sample.json` | `18_transit_skim.py --sample` | 【推断】未发现 | 与正式公交阻抗审计同结构的样本版 |
| `trip-distribution-audit.json` | `22_trip_distribution.py` | 【推断】未发现 | 时间尺度、过海系数、搜索历史、各目的、区域流动与出行时长 |
| `trip-generation-audit.json` | `21_trip_generation.py` | 【推断】未发现 | 总量、大区人口比、产生率、岗位和吸引量 |
| `zones-2026-audit.json` | `19_web_zones.py` | 【推断】未发现 | 网页人口/出行一致性、命名来源和同名小区 |
| `zones-attraction-audit.json` | `10_zone_attraction.py` | 【推断】未发现 | 楼面与官方库存、覆盖、未分类、粒度、异常值、实测/估算及住宅判定 |
| `zones-institutions-audit.json` | `12_zone_institutions.py` | 【推断】未发现 | 专上学生、大学/医院楼面、每生/每床楼面 |
| `zones-schools-audit.json` | `11_zone_schools.py` | 【推断】未发现 | 官方/落区学额、学校数和空间覆盖 |
| `zones-split-audit.json` | `14_split_zones.py` | 【推断】未发现 | 拆分方法、目标人口、拆分前后小区数和总量守恒 |

## 共享模块的内存返回值

`pipeline/fleet_sim.py` 不生成文件。`simulate()` 返回 `Result` 数据类，供 `pipeline/31_fleet_simulator.py`、`pipeline/32_deployment_scenario.py` 和 `pipeline/34_scenarios.py` 消费；它不是 DataFrame。

| 成员 | 类型 | 含义 |
|---|---|---|
| `hourly` | `pd.DataFrame` | 24 个小时的请求、完成、等待、各车队服务和里程、在跑车辆等记录 |
| `by_zone` | `pd.DataFrame` | 按起点分区的 `requests/served/gave_up/wait_sum` |
| `left_waiting` | 整数 | 一日结束时仍在队列中的请求数 |
| `violations` | 整数 | 违反车队接单区域或时段限制的服务次数，应为 0 |

## 发现的不一致

1. `pipeline/15d_speed_profiles.py` 的三引号把输出车速列写成 `speed_kph`，实际代码写出 `speed`，并另写 `limit_kph`；本文按代码记录。
2. `pipeline/15b_detector_corridors.py` 的三引号只列 `detector-corridors.json`，代码还写出 `detector-corridors-audit.json`；本文把后者列入审计产物。
3. `pipeline/18_transit_skim.py` 的三引号只列正式产物；带 `--sample` 时代码会另写 `skim-active-transit.sample.npz` 和 `transit-skim-audit.sample.json`。当前 `data/model/` 没有样本 NPZ，所以本文只把现存的样本审计列入表。
4. `pipeline/29_fleet_supply.py` 的三引号没有列出代码实际读取的 `data/model/road-speeds-hourly.parquet`、`data/model/road-links.parquet` 和 `data/model/td-digest-series.json`。
5. `pipeline/10_zone_attraction.py` 的三引号把 `data/web/zones.geojson` 注释成 211 个模型小区；该文件由 `pipeline/14` 写成 455 个模型小区。
