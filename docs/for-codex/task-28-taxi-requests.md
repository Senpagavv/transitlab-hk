# 给 Codex 的任务：写 `pipeline/28_taxi_requests.py`（全日叫车请求生成器）

> 使用方法：把「---」之间的全部内容复制到 Codex，工作目录设为 `F:\transitlab-hk`。
> 这个任务**允许新建一个文件**（`pipeline/28_taxi_requests.py`），但不得改动其他任何文件。
> 完成后把生成的脚本和它的运行输出交回来，由我（Claude）逐条复核。

---

# 任务

在 `F:\transitlab-hk` 这个香港交通模型工程里，新写一个脚本 `pipeline/28_taxi_requests.py`。
它要把现有的"分区到分区、每天多少人坐的士"的矩阵，展开成**一条一条带时间戳和上下车坐标的叫车请求**，
覆盖一个完整工作日的 24 小时。这是后面做车队调度/自动驾驶车队模拟的输入。

## 一、硬约束

1. **只允许新建 `pipeline/28_taxi_requests.py` 和它的两个产出文件**
   （`data/model/taxi-requests-2026.parquet`、`data/web/taxi-requests-audit.json`）。
   其他任何文件都不得修改、删除、重命名。
2. **不得运行 `pipeline/` 下的其他脚本**，也不要运行 `audit.py`——它们会覆盖数据产出。
3. 不得执行 git 写操作。
4. 不需要联网。
5. 运行时间控制在 10 分钟内，内存 4 GB 内（分目的、分小时逐块处理，不要一次性展开成大数组）。
6. 结果必须可复现：脚本顶部定义 `SEED = 2026`，全部随机数走 `numpy.random.default_rng(SEED)`。

## 二、先读这些（了解工程的写法约定）

| 文件 | 为什么 |
|---|---|
| `pipeline/24_peak_hour.py` | **最像的一个脚本**，照它的结构写：模块开头的三引号说明、大写常量、`report: list[str]`、`flags`、写审计 JSON |
| `pipeline/26_goods_and_boundary_vehicles.py` | 另一个范例，看它怎么做自查和打中文报告 |
| `docs/for-codex/data-schemas.md` | 所有中间产物的字段和形状 |
| `docs/handoff.md` 第 7 节 | 自审方法（这个工程强制要求每一步都能自证） |

**写作约定（必须遵守）**：
- 模块开头三引号写清楚 `Input:` / `Output:` / `Why.` / `Method.` / `Run from the project root`；
- 代码和注释用英文，**`report` 里给人看的话全部用中文**；
- 任何一项自查没过，在那行中文末尾加 `  ← 需复核`，并把项目名 append 到 `flags`；
- 不要用 `print` 以外的日志库；最后统一 `print(f"-> {OUTPUT.relative_to(ROOT)}")` 再逐行打印 `report`。

## 三、输入数据（都已存在，不要重新计算）

| 文件 | 取什么 |
|---|---|
| `data/model/mode-split-2026.npz` | `zones`（470 个分区 id，含 15 个口岸）、`T_{目的}_TAXI`（470×470 每日的士人次）。目的有 7 个：`HBW HBS HBO NHB CBS CBR CBV` |
| `data/model/parameters-tcs2022.json` | `hourly_profile_pct`：`{"hours":[0..23], "HBW":[...24 个百分数...], "HBS":..., "HBO":..., "NHB":...}`，每条曲线合计 100 |
| `data/web/am-peak-audit.json` | `fraction_of_daily`（每个目的 8–9 时占全日的比例）、`people_per_vehicle`、`vehicles` |
| `data/model/building-trip-ends.parquet` | 22.2 万栋楼：`zone, use, home(bool), lon, lat, gfa_m2, trip_ends`。**用来在分区内部抽上下车点** |
| `data/model/zone-centres.parquet` | `zone, x, y, lon, lat`（分区内没有楼时的兜底） |
| `data/model/skim-car-freeflow.npz` | 分区间行车 `time_min`、`km`（只用来自查行程长度，不要用来选点） |

**跨境三个目的（CBS/CBR/CBV）没有自己的时段曲线**：`hourly_profile_pct` 里只有 HBW/HBS/HBO/NHB。
处理办法：`CBS` 用 `HBS` 的曲线、`CBR` 和 `CBV` 用 `HBO` 的曲线，并在 `report` 里写明这是假设。

## 四、要实现的方法

1. **每个目的、每个小时的人次矩阵**
   `P[目的][h] = T_{目的}_TAXI × hourly_profile_pct[目的][h] / 100`。

2. **人次 → 请求条数**
   顶部定义 `PARTY_SIZE = 1.0`（一条请求 = 一个人次）并在 `report` 里明确写成假设。
   每个 (目的, h, o, d) 的请求条数用泊松抽样：`rng.poisson(P/PARTY_SIZE)`。
   **为了不让 470×470×24×7 个泊松抽样拖慢**：先把 `P` 拍平、只对 `P > 0` 的格子抽样。

3. **时间戳**
   每条请求在它所属的那个小时内均匀抽一个分钟：`minute = h*60 + rng.integers(0, 60)`，再加 `rng.random()` 当秒的小数（存成 `float` 的分钟数即可）。

4. **上下车点**
   在起点分区内按建筑物的 `trip_ends` 加权抽一栋楼，取它的 `lon/lat`；终点同理。
   - **居家端要对得上**：`HBW`/`HBS`/`HBO` 这三个目的，有一端是家。按 `am-peak-audit.json` 的
     `from_home_share` 决定这条请求是"从家出发"还是"回家"，**家的那一端只在 `home == True` 的楼里抽**，
     另一端在 `home == False` 的楼里抽。`NHB` 两端都在 `home == False` 里抽。
   - 分区里没有符合条件的楼时，退回该分区所有楼；再没有就用 `zone-centres.parquet` 的中心点，
     并在 `report` 里统计"用了中心点兜底的请求占比"。
   - **15 个口岸分区（id 以 `X:` 开头）没有楼**，一律用中心点，不计入兜底比例。

5. **输出**
   `data/model/taxi-requests-2026.parquet`，一行一条请求：

   | 列 | 类型 | 说明 |
   |---|---|---|
   | `request_id` | int64 | 从 0 起 |
   | `minute` | float32 | 0–1440，一天中的分钟 |
   | `purpose` | category | HBW/HBS/HBO/NHB/CBS/CBR/CBV |
   | `o_zone`, `d_zone` | string | 分区 id |
   | `o_lon`, `o_lat`, `d_lon`, `d_lat` | float32 | WGS84 |
   | `party` | int16 | 目前恒为 1 |

   按 `minute` 排序后写出。

## 五、自查（必须全部实现，结果写进 `report` 和审计 JSON）

| 检查什么 | 用什么对 | 阈值 |
|---|---|---|
| 全日请求数 | 全日的士人次 974,552 ÷ `PARTY_SIZE` | 误差 < 1% |
| 8–9 时请求数 | 全日的士人次 × 各目的 `fraction_of_daily` 加权后的值 | 误差 < 2% |
| 8–9 时"折算成车次" | 请求数 × `PARTY_SIZE` ÷ `people_per_vehicle["TAXI"]` 应接近 `vehicles["TAXI"]` = 61,229 | 误差 < 3% |
| 逐小时曲线 | 24 个小时的请求数合计 = 全日总数；打印早高峰(8)与晚高峰(18)占全日的比例 | 合计必须相等 |
| 平均行程距离 | 用 `skim-car-freeflow.npz` 的 `km` 按请求加权，应接近 `data/web/mode-choice-audit.json` 里 `mean_trip_km.TAXI`（5.8 公里） | 误差 < 10% |
| 起终点同区的比例 | 打印出来即可（作为参考，不设阈值） | — |
| 居家端命中率 | HBW/HBS/HBO 里，家那一端落在 `home == True` 的楼上的比例 | > 95% |
| 兜底占比 | 用分区中心点代替楼的请求占比（不含口岸） | < 2% |

审计 JSON 至少包含：`seed`、`party_size`、`total_requests`、`hourly_counts`（24 个数）、
`by_purpose`、`checks`（上表每项的实测值）、`flags`、`report`。

## 六、交回来时请附上

1. `pipeline/28_taxi_requests.py` 全文；
2. 实际运行的完整终端输出（包含 `report` 的每一行）；
3. `data/web/taxi-requests-audit.json` 全文；
4. 你做过但没写进代码的判断（例如为什么这样抽样），以及你认为**不确定或可能有问题**的地方——
   这一条很重要，**宁可多说也不要藏**。

---
