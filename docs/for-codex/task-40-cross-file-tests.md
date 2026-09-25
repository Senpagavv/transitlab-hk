# 给 Codex 的任务 C：给需求层和跨文件一致性补测试

> 复制「---」之间的全部内容给 Codex。工作目录 `F:\transitlab-hk`。
> **可与任务 A、B 同时进行**，三者碰的文件互不重叠。约一小时。

---

# 背景

你写的 `tests/test_product_layer.py` 覆盖了请求文件和调度模拟。还有两块没有测试：

1. **`29`（车队供给）和 `30`（运输署月报序列）的产物**——没有任何不变量检查；
2. **跨文件一致性**——这是最要紧的一块。这个工程刚吃过一次亏：
   车队数曾经手抄在 `29`/`31` 里，`30` 把月报解析成数据文件之后，
   **手抄的数就悄悄过期了**（的士载客量从 676,105 变成 687,995，模型还在用旧值）。
   现在这些数改成从文件读了，但**没有任何东西保证它们读的是同一个数**。

跨文件测试要回答的是：**同一个事实，在几个地方是不是同一个值。**

# 一、硬约束

1. **只允许新建** `tests/test_demand_and_consistency.py`。**其他任何文件都不得改动。**
   （`pyproject.toml` 的 `testpaths` 已包含 `tests`，不用改。）
2. **不得运行 `pipeline/` 下的任何脚本**，也不得运行 `pipeline/audit.py`。测试只读已有产物。
3. 不得执行 git 写操作。不需要联网。
4. 全部测试跑完 30 秒内。
5. **产物不存在时用 `pytest.skip`**，不要让测试失败——别人可能还没跑过那几步。

# 二、先读这些

| 文件 | 为什么 |
|---|---|
| `tests/test_product_layer.py` | **你自己写的**，命名、断言风格、skip 写法照它 |
| `pipeline/29_fleet_supply.py`、`pipeline/30_td_digest_series.py` | 要测的对象，开头三引号写明了方法和已知局限 |
| `pipeline/23_mode_choice.py` 的 `td_taxi_daily()` | 的士需求怎么从月报读的——第三组测试的核心 |

# 三、第一组：`30` 运输署月报序列（只读 `data/model/td-digest-series.json`）

| # | 检查 | 判据 |
|---|---|---|
| 1 | 每个年度的各方式之和 = 该年的 `Total` 列 | 相对误差 <0.5% |
| 2 | 每个**完整**年度的逐月算术平均 ≈ 该年年度值 | <2%（月份天数不同，允许差异）；**月份不满 12 个的年份跳过** |
| 3 | 车队：每年 `total.registered` = urban + new_territories + lantau 的 registered 之和 | 完全相等 |
| 4 | 每年 `licensed ≤ registered`（三个类别各自，以及合计） | 无例外 |
| 5 | 所有年度的 `total.registered` 相同 | 配额自 1994 年冻结，完全相等 |
| 6 | 所有年份的字段集合一致 | 无例外 |

# 四、第二组：`29` 车队供给（只读 `data/model/taxi-fleet-hourly.parquet` 和 `data/web/fleet-supply-audit.json`）

| # | 检查 | 判据 |
|---|---|---|
| 7 | 24 行，`hour` 是 0–23 且不重复 | 完全相等 |
| 8 | `busy_taxis` = `veh_min / 60` | 误差 <1e-6 |
| 9 | 每个载客率 r 的 `on_road_at_<r>` = `busy_taxis / r` | 误差 <1e-6 |
| 10 | `veh_km`、`veh_min`、`requests` 全部 ≥ 0 | 无例外 |
| 11 | 逐小时 `requests` 之和，与请求文件的总行数 | 相对误差 <1%（`29` 对跨境请求做了按覆盖率放大，允许这个差） |
| 12 | 审计里的 `fleet_licensed` = `fleet` 三项之和 | 完全相等 |

# 五、第三组：跨文件一致性（**这组最重要**）

| # | 同一个事实 | 出现在哪几处 | 判据 |
|---|---|---|---|
| 13 | **领牌的士车队数** | `td-digest-series.json` 最新年度的 `taxi_fleet.annual.<最新年>.total.licensed`、`fleet-supply-audit.json` 的 `fleet_licensed`、`fleet-simulation-audit.json` 的 `fleet` | 三者完全相等 |
| 14 | **的士日均载客量** | `td-digest-series.json` 最近 12 个月 `Taxis` 的平均 × 1000、`mode-choice-audit.json` 里锚定复核那行报的运输署值 | 相对误差 <0.1% |
| 15 | **请求总数** | `taxi-requests-2026.parquet` 行数、`taxi-requests-audit.json`、`fleet-simulation-audit.json` 的 `requests` | 相对误差 <0.1% |
| 16 | **走廊 GEH<5** | `assignment-audit.json` 的 `corridor_geh_under_5`、`corridor-diagnosis.json` 的 `by_corridor` 逐条重算 | 差 <2 个百分点 |

第 13、14 两条是**这次真正要防的东西**：任何人再把这些数写死在某个脚本里，测试立刻会红。
第 14 条注意 `mode-choice-audit.json` 里那行是中文报告文本，需要用正则把数字取出来——
**如果取不到，让测试失败并打印那行原文**，不要 skip 掉（skip 会让这条防护形同虚设）。

# 六、已知坑

1. `td-digest-series.json` 的 `monthly` 键形如 `"2026-06"`，`annual` 键形如 `"2025"`，都是**字符串**；
   排序时要按数值排，`"2026-01"` 和 `"2026-1"` 不会同时出现，但年份比较要 `int()`。
2. **最近 12 个月可能跨年**（当前是 2025-07 到 2026-06），不要按年份筛。
3. `taxi-fleet-hourly.parquet` 的列名含载客率，形如 `on_road_at_55` / `on_road_at_70` / `on_road_at_85`，
   **从列名解析出 55/70/85 再除**，不要写死。
4. 请求文件的列是 `origin_zone` / `destination_zone` / `time_sec`。
5. `29` 的逐小时值做过 `1/coverage` 放大（覆盖率约 80.6%，跨境请求的口岸不在小汽车矩阵里），
   所以第 11 条不能要求完全相等。

# 七、交回来时必须附上

1. `tests/test_demand_and_consistency.py` 全文；
2. `uv run pytest` 的完整输出；
3. **如果有测试失败，不要削弱测试**——把失败原因查清楚写出来，和上次一样。
   那两次失败最后都证明是代码的真问题，不是测试写坏了。
4. **一节「我偏离任务书的地方」**，没有就写"无"。

---
