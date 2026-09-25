# 给 Codex 的任务 A：再刷新一次两份索引

> 复制「---」之间的全部内容给 Codex。工作目录 `F:\transitlab-hk`。
> **可与任务 B、C 同时进行**，三者碰的文件互不重叠。小任务，约半小时。

---

# 背景

你在 2026-09-23 刷新过 `docs/for-codex/pipeline-manifest.md` 和 `docs/for-codex/data-schemas.md`，
当时 38 个脚本。**9 月 24 日又多了 6 个文件**，而且其中两个不是管线步骤：

| 文件 | 是什么 |
|---|---|
| `pipeline/fleet_sim.py` | **共享模块**，不是管线的一步（无编号、不写文件）。`31`、`32`、`34` 都 import 它 |
| `pipeline/32_deployment_scenario.py` | 区域投放情景 |
| `pipeline/33_deployment_web.py` | 把情景转成网页 JSON |
| `pipeline/34_scenarios.py` | 夜间窗口 + 配额联动情景 |
| `pipeline/diagnose_corridors.py` | **诊断工具**，无编号、只读 |
| `pipeline/check_docs.py` | **文档数字体检**，无编号、只读，已接进 `audit.py` |

同时 `31` 和 `32` 的**内部结构变了**（派单循环已抽进 `fleet_sim.py`），但**行为和产出没变**。

# 一、硬约束

1. **只允许修改这两个文件**：`docs/for-codex/pipeline-manifest.md`、`docs/for-codex/data-schemas.md`。
   其他任何文件都不得改动、新建、删除。
2. **不得运行 `pipeline/` 下的任何脚本**，也不得运行 `pipeline/audit.py`。
3. **不要打开二进制文件**（`.parquet`、`.npz`、`.gdb`、`.pdf`、`.xls`）。
   字段名从**写出它的脚本源码**里读（找 `to_parquet` / `np.savez` / `json.dumps` 的列名），这比猜文件内容可靠。
4. 不得执行 git 写操作。不需要联网。

# 二、要做什么

## 1. `pipeline-manifest.md`

对 `pipeline/` 下每一个 `.py` 给一行，**保持你上次的表格格式**，按文件名排序
（`15b`/`15c`/`15d` 排在 `15` 之后；无编号的排在最后）。

**新增一列「类型」**，取值三选一，这是这次最重要的改动：

| 类型 | 含义 | 例子 |
|---|---|---|
| 管线步骤 | 有编号，跑一次产生数据 | `27`、`32` |
| 共享模块 | 被别的脚本 import，自己不产生文件 | `fleet_sim.py` |
| 工具 | 无编号，只读，按需跑 | `diagnose_corridors.py`、`check_docs.py`、`audit.py` |

**不要写行数**（会天天变）。**不要描述函数内部结构**（`31`/`32` 刚重构过）。
「一句话」「输入」「输出」「大致耗时」照旧从模块开头三引号读；三引号没写耗时的**留空，不要自己估**。

## 2. `data-schemas.md`

补上 9 月 24 日新增的产物，字段从源码读：

- `data/model/deployment-scenarios.parquet`（`32` 写，17 列）
- `data/model/extra-scenarios.parquet`（`34` 写，比上面多 `kind`/`taxi_fleet`/`from_hour`/`to_hour`）
- `data/web/deployment-scenarios.json`（`33` 写，**注意它的 `kind` 字段设计**：
  `deployment` / `time_window` / `quota_swap`，前端按 `kind` 分组且必须能显示未知值）
- `data/web/deployment-audit.json`、`data/web/extra-scenarios-audit.json`、
  `data/web/corridor-diagnosis.json`

`corridor-diagnosis.json` 里有一个自定义指标 **`内部分流偏差`**，务必解释清楚它的定义：
先把走廊总量对齐，再看各站还差多少（`Σ|模型ᵢ − 普查ᵢ × (Σ模型/Σ普查)| / Σ普查`），
它用来区分「总量错」和「分流错」。

# 三、自查（**验收标准，必须逐条原样实现，不得替换、不得删减**）

在交付说明里逐条报「实测 / 期望 / 通过与否」：

| # | 检查 | 期望 |
|---|---|---|
| 1 | manifest 的行数 = `pipeline/*.py` 的实际文件数 | 完全相等 |
| 2 | 每个「管线步骤」都有非空的输入和输出 | 无例外 |
| 3 | 每个「共享模块」和「工具」的输出列，与三引号一致（`fleet_sim` 不写文件，`diagnose_corridors`/`check_docs` 只写各自那一个文件） | 无例外 |
| 4 | data-schemas 里每个产物都标明「谁生成、谁消费」 | 无例外 |
| 5 | 上面第二节点名的 6 个新产物全部出现在 data-schemas 里 | 6/6 |
| 6 | manifest 里**不含任何行数数字** | 0 处 |

# 四、已知坑

1. `15`、`15b`、`15c`、`15d` 是四个不同脚本。
2. `33` 的输出 JSON 里 `scenarios[].hourly` 是 24 行的数组，不要当成单值字段。
3. `fleet_sim.py` 的 `simulate()` 返回的是一个 `Result` 数据类（`hourly` / `by_zone` / `left_waiting` / `violations`），
   不是 DataFrame——它不落盘，但 schemas 里值得记一笔，因为三个脚本都靠它。
4. `audit.py` 现在会调用 `check_docs.py`（子进程），两者在 manifest 里都列为「工具」。

# 五、交回来时必须附上

1. 两个文件的完整新内容；
2. **对照**：新增了哪些、改了哪些、删了哪些；
3. 六条自查逐条的「实测 / 期望 / 通过与否」；
4. **一节「我偏离任务书的地方」**，没有就写"无"。

---
