# 技术证据与复现

[首页](../../README.zh-CN.md) · [评委导览](README.zh-CN.md) · [English](technical-evidence.md) · [最终包](../../submission/README.md)

本页解释当前原型怎样连接到数据底座。早期车队研究的结果不作为当前游戏的现实影响主张。数据可追溯，也不等于最终界面的每一个交互均已验收。

## 从原始资料到游戏

| 层次 | 做了什么 | 对应证据 |
|---|---|---|
| 1 公开输入 | 普查、建筑、学校、预测、出行调查、道路、GTFS 和交通观测，年份及空间单位各不相同 | [来源目录](../data-sources.md)、[原始输入](../../data/raw/)、[图则与土地缓存 Release](https://github.com/Senpagavv/transitlab-hk/releases/tag/base-2026-09-26) |
| 2 空间底座 | 关联建筑与吸引量，将 211 个普查小区拆成 455 个内部分区，模型另有 15 个边界端点；2026 年资料是按已有年份推到基准年，不是逐地点重新实测 | [分区拆分](../../pipeline/14_split_zones.py)、[土地利用](../../pipeline/16_landuse_2026.py)、[分区审计](../../data/web/zones-split-audit.json) |
| 3 离线交通模型 | 出行生成 → 分布 → 方式选择 → 早高峰道路/公交分配；拥堵再反馈到选择 | [方法目录](../methods-catalogue.md)、[管线清单](../for-codex/pipeline-manifest.md)、[模型产物](../../data/model/) |
| 4 保存与校核 | 核对总量、连接、地理与观测比较，保留未达标项 | [审计程序](../../pipeline/audit.py)、[审计 JSON](../../data/web/)、[分级登记](../../model/registry/data_tiers.toml) |
| 5 游戏底板 | 聚合为 400 米、160×120 网格，提取内区 OD 并作分时段近似；它不是完整工程路网 | [生成脚本](../../game-feeder/tools/hk-grid/build_hk_grid.py)、[字段说明](../../game-feeder/tools/hk-grid/README.md)、[最终底板](../../submission/final-2026-10-18/game-feeder/v7-deploy/hk/) |
| 6 互动计算 | 浏览器用准备好的基线和简化规则响应玩家，不在每次点击时重跑整套四阶段模型 | [最终沙盘引擎](../../submission/final-2026-10-18/game-feeder/v7-deploy/mode5-sandbox/engine.js)、[worker](../../submission/final-2026-10-18/game-feeder/v7-deploy/mode5-sandbox/worker.js)、[机制说明](../../submission/final-2026-10-18/game-feeder/v7-deploy/mode5-sandbox/README.md) |
| 7 GenAI | 句子转成受限请求，程序构建关卡；按数值结果复盘并核对数字 | [最终 AI 后台](../../submission/final-2026-10-18/backend/feeder_ai.py)、[客户端与示例回退](../../submission/final-2026-10-18/game-feeder/v7-deploy/ai/client.js) |

详细方法说明保留了原始日期与部分旧桌面路径；当前脚本决定实际输出位置，不要把旧绝对路径当成新电脑的启动命令。

### 两种计算循环要分开看

**离线模型** 的 `27b → 23 → 24 → 27` 协调拥堵时间、方式选择和道路分配，之后进行 39 公交分配。

**游戏引擎** 用保存的 OD、时间与路段负荷计算方案差量，再迭代简化反馈。不建设时保持基线，是内部一致性检查，不是预测准确性的证明。[引擎说明](../../submission/final-2026-10-18/game-feeder/v7-deploy/mode5-sandbox/README.md)记录收敛方法与未建模影响。

## 可靠性要按字段说明

[登记表](../../model/registry/data_tiers.toml)及[分级文档](../data-tiers.md)使用 A/B/C/D。来源权威性和“实测、预测、假设”是两件都要讲清楚的事。

| 类别 | 读法 |
|---|---|
| A 有明确来源的输入 | 如官方调查、计数或公开预测。官方预测仍是预测，不代表逐地点实测的 2026 人数。 |
| B 校准/模型推算 | 有方法的模型结果或确定性汇总，不是新的直接观测。 |
| C 依据推断/近似 | 有理由的代理、几何聚合或时段近似，需要说明局限。 |
| D 示意假设 | 教学、玩法或情景假设，不能当成现实确曾发生。 |

游戏中早高峰 OD 是 **B**；400 米道路几何、部分格边负荷是 **C**。晚高峰/日常 OD 为 **C**，部分非早高峰轨道载客缩放为 **D**；节假日需求为 **D**。教学地图也有简化和示意数值，不能统一写成“全部真实数据”。

游戏 OD 使用 **455 个内部分区**，没有把离线模型的 **15 个边界端点全部纳入**。网格聚合可能合并平行道路、立交，不能保留工程级转向与高程。[底板说明](../../game-feeder/tools/hk-grid/README.md)和[检查文件](../../submission/final-2026-10-18/game-feeder/v7-deploy/hk/checks.json)记录排除量与口径。

## 验证与已知局限

### 离线基线

- 当前保存底座的审计为 **118 项通过、2 项未通过**。道路计数拟合和巴士预载是保留的已知不足；这不等于“98.3% 准确率”。
- [道路分配审计](../../data/web/assignment-audit.json)：走廊 GEH<5 约 **29.4%**，未达到项目 **60%** 目标。总量接近不代表逐路段准确。
- [巴士预载审计](../../data/web/bus-preload-audit.json)：专营巴士模型/普查总量约 **0.84**，资料解释了覆盖和路线限制。
- 数值、空间检查不能证明教学有效，也不能证明现实减排。用户学习与实际影响需要另行评估。

### 最终原型

最终包包含浏览器引擎、FastAPI、可选 DeepSeek/SMTP、账号/排行榜和备用演示。[本次核查记录](verification.md)列明仓库整理实际做过的检查。

局限包括粗尺度几何、简化行为与容量/反馈假设。时段与教学数值的部分字段是推断或示意。“跑到稳定”是数值停止条件，不是预测年限或实证认证。

AI 有字段限制、范围、重试与复盘数字检查，但这些不能消除意图歧义、错误解释或低质量关卡。预设示例、策略回放不能称为一次实时大模型调用。

## 数据交付与复现

### A 只玩最终游戏

按[最终包说明](../../submission/README.md)启动。游戏准备好的 JSON 已包含在包内，不需要安装 Java/GIS 或下载全部原始输入。没有 AI 密钥时使用示例回退，邮件行为取决于 SMTP 配置。

### B 核查保存结果和交付一致性

仓库整理前，本地底座 **112 份已跟踪原始文件、34 份模型文件、78 份网页/审计文件**与远端 [`4e15852`](https://github.com/Senpagavv/transitlab-hk/tree/4e15852757aa8ea5b109d61a3d7415f78c9e470f) 的 Git blob 指纹全部一致。最终包中 10 份 `hk/` 数据/核对文件也与开发版底板一致。

在仓库根运行：

```sh
python submission/verify.py
```

它按[清单](../../submission/manifest.json)核对原 ZIP 与每份展开文件；这是交付完整性检查，不是模型准确性或全功能测试。

### C 重建离线模型

1. 使用 Python 3.12、根目录 `pyproject.toml` 和 `uv.lock`，执行 `uv sync --frozen`。R5 公交矩阵另需 Java 21；见[环境自检](../../pipeline/00_check_env.py)和[组员上手](../onboarding.md)。
2. 重算土地/图则步骤时下载[现有 Release](https://github.com/Senpagavv/transitlab-hk/releases/tag/base-2026-09-26)，在根目录解压。包内是 540 份图则与 2 份土地缓存，路径从 `data/` 开始。
3. 按[清单](../for-codex/pipeline-manifest.md)和[完整重建顺序](../handoff.md#9-文件地图)运行；编号顺序不等于依赖顺序，部分步骤需要重复执行。
4. 当前游戏不要求重跑已废弃的车队实验；仍被复用的通用脚本应保留，不能按编号范围批量删除。
5. 需求或路网变化后，完成拥堵反馈、公交分配、诊断和审计，再有意执行 `python game-feeder/tools/hk-grid/build_hk_grid.py` 导出新游戏底板；此脚本会写产物。

管线会写正式数据，部分步骤会访问政府服务，不是无需联网的一键演示。本次整理展示文档没有重跑整条管线。

### 哪些内容有意不放进 Git

| 内容 | 处理方式 |
|---|---|
| 图则与 LUHK 缓存 | 已在约 399 MB 的公开 Release 附件。 |
| 本地约 1.26 GB 历史交通 XML | 可选的原始级复现资料，当前未附；逐小时汇总及下游结果已跟踪。重抓归档不能保证采样集合逐字节相同。 |
| 底图缓存、路由工作库、软件依赖 | 可下载/可再生环境；玩最终包不必具备。 |
| 重复历史快照和旧候选结果 | 留作备份历史；主阅读线保留相关方法与审计。 |
| `.env`、密钥、邮件授权码、真实账号数据库 | 不进入公开交付，使用空白模板及本地/服务器配置。 |

## 署名与结果解释

[来源目录](../data-sources.md)、[复用说明](../reuse-and-references.md)与[底板元数据](../../submission/final-2026-10-18/game-feeder/v7-deploy/hk/)记录资料提供者和变换局限，相关地图署名继续保留。第三方条件包括适用的 OpenStreetMap/ODbL；这次整理没有为所有底层资料重新授予统一许可。

评审时请区分：**已经实现的代码、已经核查的行为、模型情景结果、未来影响/评估计划**。[官方标准](https://www.hack4sdg.com/judging-criteria/)也要求讲清哪些能工作、哪些属于模拟。
