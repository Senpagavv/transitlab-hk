# 给 Codex 的任务：写 `pipeline/32_deployment_scenario.py`（区域投放情景）

> 复制「---」之间的全部内容给 Codex。工作目录 `F:\transitlab-hk`。
> 这是这个项目**最核心的一个问题**，请慢一点、把不变量做扎实。

---

# 背景与目的

这个工程已经能回答"全香港最少需要多少辆的士"（`pipeline/31`，答案 12,000 辆）。
但项目的命题不是这个，而是：

> **在某一个片区投放 N 辆无人车，会发生什么？**

现实里运输署发的会是**有地域限制的牌照**——无人车只能在划定的区域接客，的士照常全港运营。
所以这一步要模拟的是**两支车队在同一份需求上竞争**，而不是把车队整个换掉。

产出必须能回答三句话：
1. 这 N 辆无人车接走了该区多少比例的行程？
2. 乘客等待时间变了多少？（分"区内乘客"和"全港乘客"两组看）
3. 道路上多跑了还是少跑了多少车公里？

# 一、硬约束

1. **只允许新建**：`pipeline/32_deployment_scenario.py`、`data/model/deployment-scenarios.parquet`、
   `data/web/deployment-audit.json`。**其他任何文件都不得修改、删除、重命名**——
   尤其**不要改 `pipeline/31_fleet_simulator.py`**，照抄它的逻辑到新文件里即可（允许重复代码）。
2. **不得运行 `pipeline/` 下的其他脚本**，也不得运行 `pipeline/audit.py`。
3. 不得执行 git 写操作。不需要联网。
4. 随机种子 `SEED = 20260923`（和 `31` 一致），两次独立运行必须逐值一致。
5. 全部情景跑完控制在 15 分钟内、内存 4 GB 内。

# 二、先读这些

| 文件 | 为什么 |
|---|---|
| `pipeline/31_fleet_simulator.py` | **最重要**。你的脚本是它的扩展版，派单循环、时钟约定、输出风格全部照它 |
| `pipeline/29_fleet_supply.py` | 车队数怎么从 `td-digest-series.json` 读 |
| `tests/test_product_layer.py` | 你上次写的不变量，这次要保持同样的严谨度 |
| `docs/handoff.md` 第 6.67 条 | `31` 的四条局限，这一步全部继承，必须照样写出来 |

# 三、输入

| 文件 | 取什么 |
|---|---|
| `data/model/taxi-requests-2026.parquet` | 71.7 万条请求：`time_sec`、`origin_zone`、`destination_zone` |
| `data/model/skim-car-freeflow.npz` | `zones`、`time_min`、`distance_km`（455 个分区） |
| `data/model/road-speeds-hourly.parquet` + `data/model/road-links.parquet` | 逐小时拥堵折算，算法照抄 `31` 的 `slowdown()` |
| `data/model/trip-ends-2026.parquet` | `zone`、`district`、`external`、`host_zone` |
| `data/model/td-digest-series.json` | 的士领牌车队数（最新年度 `taxi_fleet.annual.<年>.total.licensed`） |

# 四、要实现的方法

## 1. 投放区域

顶部定义（**区名请先读 `trip-ends-2026.parquet` 的 `district` 实际取值再填，不要凭印象写**）：

```python
DEPLOY_AREAS = {
    "离岛（东涌 + 机场）": [...],   # 对应 district 里的离岛
    "观塘": [...],                  # 对应 district 里的观塘
}
```

选这两个是有理由的，**请原样写进脚本注释**：离岛是 `31` 算出来**车队缩小时最先被放弃**的地方
（最差分区接单率只剩 37%），而且机场是全港最适合先行的封闭场景；观塘是密集市区，作为对照。

## 2. 两支车队

- **的士**：全港接单，车队数 = `td-digest-series.json` 的最新领牌数。
- **无人车**：**只能接起点在投放区内的请求**，车队规模扫描 `AV_FLEET_SWEEP = (0, 100, 300, 600, 1200)`。
  初始位置按该区第一小时的需求分布撒（照 `31` 的做法，只是限定在区内分区）。

## 3. 派单

完全照 `31`：每分钟一次，等待最久的优先，每单派给**它可用车辆中最近的一辆**。
唯一的差别是"可用车辆"的定义：

- 起点在投放区内的请求：**无人车和的士都能接**，取两者中最近的那一辆；
- 起点在区外的请求：**只有的士能接**。

无人车送完客后**停在终点**（和 `31` 一样不做再平衡），**即使终点在投放区外**——
它只是不能在区外**接**新客，必须等派到区内的单才动。这一条是刻意的，请写进注释：
**它会让无人车逐渐漂出投放区，这正是真实世界里区域牌照的麻烦之处，模型不该替它掩盖。**

## 4. 输出

`data/model/deployment-scenarios.parquet`，一行 = 一个（区域 × 无人车规模 × 小时）：

| 列 | 含义 |
|---|---|
| `area` | 区域名 |
| `av_fleet` | 该情景的无人车数 |
| `hour` | 0–23 |
| `requests_in_area` / `requests_total` | 起点在区内的请求数 / 全港请求数（到达口径） |
| `served_av` / `served_taxi` / `gave_up` | 当小时发生口径，和 `31` 一致 |
| `wait_in_area_min` / `wait_total_min` | 区内乘客 / 全港乘客的平均等待（按接单数加权） |
| `av_empty_km` / `av_paid_km` / `taxi_empty_km` / `taxi_paid_km` | 四项里程 |
| `av_busy` / `taxi_busy` | 当小时在跑的车数 |
| `av_outside_area` | 停在投放区外的无人车数（小时末） |

`data/web/deployment-audit.json` 照工程惯例：`{"checks": {...}, "flags": [...], "report": [中文逐行]}`。

# 五、自查清单（**验收标准，必须逐条原样实现，不得替换、不得删减**）

每条输出「实测值 / 阈值 / 通过或未通过」，未通过在该行末尾加 `  ← 需复核` 并 append 到 `flags`。
你若认为某条设计得不好，**照做之后另起一节写意见**；想加的放最后并注明"Codex 追加"。

| # | 检查什么 | 阈值 |
|---|---|---|
| 1 | **`av_fleet = 0` 的情景，必须和纯的士基准逐值一致**（同种子） | 每一列完全相等 |
| 2 | 每个情景：全天 `served_av + served_taxi + gave_up` = 全天 `requests_total` | 完全相等 |
| 3 | 累计 `served_av + served_taxi + gave_up` ≤ 累计 `requests_total`（逐小时前缀和） | 无例外 |
| 4 | **无人车服务的每一单，起点必须在投放区内** | 无例外（这一条在派单时直接断言） |
| 5 | 每小时 `av_busy ≤ av_fleet`、`taxi_busy ≤ 的士车队数` | 无例外 |
| 6 | 无人车越多，`served_av` 不降、区内等待不升 | 允许 1% 噪声 |
| 7 | 四项里程都 ≥ 0；`av_paid_km + taxi_paid_km` 在各情景间的差异 < 2% | 载客里程由需求决定，不该随车队大幅变化 |
| 8 | **总车公里（四项之和）随无人车增加的变化**，只打印不设阈值 | — |
| 9 | 停在投放区外的无人车占比（全天最大值），只打印 | — |
| 10 | 固定种子两次独立运行逐值一致 | 必须一致 |

**第 1 条是最重要的**：它证明你的两车队逻辑在无人车为 0 时退化成原来的单车队模型，
没有在别处引入偏差。**先让第 1 条过，再谈别的。**

# 六、这个工程的已知坑

1. **跨境分区 id 以 `X:` 开头**，不在 455 个分区的矩阵里；照 `31` 的做法映射到 `host_zone`。
   映射之后它们属于哪个 district，要按**挂靠分区**算，不是按口岸本身。
2. **`31` 的小时表有两个时钟**：`requests` 是到达数，其余是当小时发生数，只有全天才平账。
   照抄这个约定，并在脚本注释里写明。
3. **不要把"最小车队"的结论套用过来**：那是全港替换，这里是区域叠加，两者不能比。
4. `taxi-requests-2026.parquet` 的列名是 `origin_zone` / `destination_zone` / `time_sec`，
   不是 `o_zone` / `minute`。
5. 车队数**不要写死**，从 `td-digest-series.json` 读。

# 七、交回来时必须附上

1. `pipeline/32_deployment_scenario.py` 全文；
2. 完整终端输出（中文报告每一行）；
3. `data/web/deployment-audit.json` 全文；
4. **一张结果表**：两个区域 × 五个车队规模，每格给「无人车接单占该区比例 / 区内平均等待 / 总车公里变化」；
5. **一节「我偏离任务书的地方」**，没有就写"无"。

---
