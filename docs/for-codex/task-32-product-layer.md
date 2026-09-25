# 给 Codex 的任务：给产品层补测试，并去掉写死的车队数

> 复制「---」之间的全部内容给 Codex。工作目录 `F:\transitlab-hk`。
> 这是两件相关的小事，一起做；预计一小时内。

---

# 背景

`pipeline/28`（叫车请求）、`29`（车队供给）、`31`（车队调度模拟）是这个工程最新的三步，
也是**唯一没有任何测试**的三步。它们算出来的"最小车队 12,000 辆"是整个项目对外的头条数字，
现在只靠脚本自己的中文自查兜底，没有人验证过**代码层面的不变量**（比如车会不会凭空多出来）。

同时 `29` 和 `31` 里的车队数是我手抄进去的常量，而 `pipeline/30` 已经把运输署月报解析成了
`data/model/td-digest-series.json`——**写死的数字会悄悄过期**，这个工程已经为此吃过一次亏。

# 一、硬约束

1. **只允许**：
   - 新建 `tests/test_product_layer.py`
   - 修改 `pipeline/29_fleet_supply.py`、`pipeline/31_fleet_simulator.py`（只改第三节说的地方）
   - 修改 `pyproject.toml` 的 `testpaths`（把 `"tests"` 加进去）
   **其他任何文件都不得改动。**
2. **不得运行 `pipeline/` 下的任何脚本**（它们会覆盖数据产出），也不得运行 `pipeline/audit.py`。
   测试必须**只读**已有的产物。
3. 不得执行 git 写操作。不需要联网。
4. 全部测试跑完控制在 60 秒内。

# 二、先读这些

| 文件 | 为什么 |
|---|---|
| `pipeline/29_fleet_supply.py`、`pipeline/31_fleet_simulator.py` | 要测的对象；开头的三引号写明了方法和已知局限 |
| `model/` 和 `backend/` 下现有的 `test_*.py` | **照它们的写法写**：命名、断言风格、中文注释的用法 |
| `docs/handoff.md` 第 6.66、6.67 条 | 这两步的结论和四条局限，测试的阈值要和它们一致 |

# 三、第一件事：去掉写死的车队数

`pipeline/29_fleet_supply.py` 现在是：

```python
FLEET = {"urban": 14_941, "new_territories": 2_679, "lantau": 75}
FLEET_REGISTERED = 18_163
```

改成从 `data/model/td-digest-series.json` 读**最新年份**的 `taxi_fleet.annual`：

- `licensed` 三项 → 对应 urban / new_territories / lantau
- `total.registered` → `FLEET_REGISTERED`
- 文件不存在时**直接抛 `RuntimeError`**，提示"先跑 pipeline/30"（照这个工程其他脚本缺输入时的做法）

`pipeline/31_fleet_simulator.py` 的 `FLEET = 17_695` 同样改成读同一个文件的 `total.licensed`。
**`FLEET_SWEEP` 和 `SMALL_FLEET` 保持写死**——那是刻意选的情景，不是会过期的事实。

改完在两个脚本的中文报告里注明车队数来自哪一年（例如"领牌车队 17,695 辆（运输署月报 2025 年）"）。
**不要运行脚本**；语法检查用 `python -c "import ast; ast.parse(open(...).read())"` 即可。

# 四、第二件事：写不变量测试 `tests/test_product_layer.py`

只读这些产物：`data/model/taxi-requests-2026.parquet`、`data/model/taxi-fleet-hourly.parquet`、
`data/model/fleet-simulation-2026.parquet`、`data/web/fleet-scenarios.json`、
`data/web/fleet-simulation-audit.json`、`data/web/taxi-requests-audit.json`、
`data/model/mode-split-2026.npz`、`data/web/am-peak-audit.json`。

**产物不存在时用 `pytest.skip`**，不要让测试失败——别人可能还没跑过那几步。

必须实现下面 10 条，**逐条原样实现，不得替换、不得删减**。你若觉得某条设计得不好，
**照做之后另起一节写意见**；想加的测试放在最后并注明"Codex 追加"。

| # | 测什么 | 判据 |
|---|---|---|
| 1 | 请求文件的行数 = `mode-split-2026.npz` 里七个 `T_*_TAXI` 之和 | 误差 <1% |
| 2 | 请求的 `time_sec` 全部落在 `[0, 86400)` | 无例外 |
| 3 | 请求的经纬度都在香港范围内（经度 113.8–114.5，纬度 22.1–22.6） | 无例外 |
| 4 | 请求的 `origin_zone`、`destination_zone` 都能在 `mode-split-2026.npz` 的 `zones` 里找到 | 无例外 |
| 5 | `fleet-simulation-2026.parquet` 每小时：`served + gave_up ≤ requests` | 无例外（差额是跨小时还在等的） |
| 6 | 全天 `served + gave_up` = 全天 `requests` | 完全相等（收工时不应有人还在等） |
| 7 | 每小时 `vehicles_busy ≤ FLEET`（车不会凭空多出来） | 无例外 |
| 8 | `empty_km` 和 `paid_km` 都 ≥ 0，且 `empty_share` 与 `empty_km/(empty_km+paid_km)` 一致 | 误差 <1e-6 |
| 9 | `fleet-scenarios.json` 的 `sweep`：**车队越小，接单率不升、等待不降**（单调性） | 允许 1% 的数值噪声 |
| 10 | `taxi-fleet-hourly.parquet`（`29`）最忙一小时的 `busy_taxis`，应**小于** `31` 模拟出的 `vehicles_busy` 最大值 | `29` 只算载客时间，`31` 还含接客空驶和上下客，所以必然更小；差距应在 0–60% |

第 9、10 两条是重点：**9 验证的是模型行为的方向性，10 是两个独立算法的交叉验证**，
它们能抓到的错误是单个脚本自查抓不到的。

# 五、这个工程的已知坑

1. **`31` 的输出是"每小时"表，`28` 的输出是"每条请求"**，两者行数量级差 5 个数量级，
   测试里不要把它们直接相加比较。
2. **跨境出行的分区 id 以 `X:` 开头**，它们不在 455 个分区的小汽车矩阵里；第 4 条要连 `X:` 一起查。
3. `fleet-scenarios.json` 里 `sweep` 的第一个点是基准车队（17,695），**不在 `FLEET_SWEEP` 常量里**。
4. pandas 读 parquet 时列名请按实际文件为准（`origin_zone` 而不是 `o_zone`）。

# 六、交回来时必须附上

1. `tests/test_product_layer.py` 全文；
2. `29`、`31` 的改动片段（不用全文）；
3. `uv run pytest` 的完整输出；
4. **一节「我偏离任务书的地方」**：字段名、产出路径、检查项，凡是没完全照做的逐条写出来和原因。
   没有就写"无"。**前两次你都改了东西没主动说，这一节是硬性要求。**

---
