# AGENTS.md — 给 AI 编程助手的项目说明

> **English note**: this file is written in Chinese on purpose (the project lead reads Chinese; AI assistants read it without trouble). Agents: follow every rule below; reply to the project lead in Chinese, and to other teammates in the language they write to you in. Human readers who need English: see [`docs/onboarding.en.md`](docs/onboarding.en.md).

> 读者：在这个仓库里干活的 AI 助手（Claude Code、Codex、Cursor、Copilot 等）。人类组员请看 [`docs/onboarding.md`](docs/onboarding.md)（同一套规矩的人话版）。
> 最新进度、已知局限、下一步：[`docs/handoff.md`](docs/handoff.md) **顶部**。开始任何任务前先读那里。

## 1. 项目是什么
香港全港四阶段交通模型 + 土地数据底座（455 个交通分区 + 15 个口岸），用于一个「在真实地图上画新地铁线/新路 → 算客流、塞车、人口变化、值不值得修」的规划游戏。
Python 3.12（uv 管理）+ AequilibraE（道路/公交分配）+ r5py（公交时间矩阵，需 Java 21）；前端 React + MapLibre + deck.gl；后端 FastAPI。

## 2. 目录地图
| 路径 | 内容 | 能不能改 |
|---|---|---|
| `pipeline/NN_*.py` | 一步一个脚本：下载 → 清洗 → 四阶段模型 → 分配 → 审计。**每个文件开头 docstring 写了 Input/Output/方法/出处** | 可以改，改完按第 5 节验证 |
| `data/raw/` | 原始下载（法定图则 `data/raw/zoning/` 在 Release 附件里，不在 Git） | **禁止手改**，只能由下载脚本写 |
| `data/model/` | 模型产物（parquet/npz/json） | **只能由 pipeline 生成** |
| `data/web/` | 网站数据 + 每步的 `*-audit.json` 审计报告 | **只能由 pipeline 生成** |
| `data/cache/`、`data/snapshots/` | 可再生缓存、只读快照（不进 Git） | 实验输出写到 `data/cache/<你的名字>/` |
| `docs/for-codex/pipeline-manifest.md` | 每一步的输入、输出、耗时总表 | 新增/改动步骤时同步更新 |
| `docs/data-sources.md` | 43 个数据来源的总目录 | 新增数据来源时更新 |
| `backend/`、`frontend/` | 网站 | 可以改 |
| `game-demo/` | 修桥/画地铁的浏览器小游戏（**已冻结**，只当例子，不要再加功能） | 不要改 |
| `tests/`、`pipeline/audit.py`、`pipeline/check_docs.py` | 测试、全量审计、文档数字体检 | 加检查可以，删检查要有理由 |

## 3. 不可违反的规则
1. **不写 `data/raw/`**；不手改 `data/model/`、`data/web/` 里的任何文件——改算法，重跑脚本。
2. **做实验不污染正式结果**：输出到 `data/cache/<名字>/` 或在新分支上做；改正式结果前先 `uv run python scripts/snapshot_base_data.py`。
3. **不要高频请求政府接口**（CSDI 地图服务、DATA.GOV.HK、地政总署）：曾因逐点查询被封 IP。优先用缓存；`pipeline/05` 有 `--from-cache`。
4. **不提交** `.env`、`data/cache/`、`data/snapshots/`、单个 >50 MB 的文件；提交前 `git status` 看一眼。
5. **运行顺序 ≠ 编号顺序**（例：15 读 21 的产物）。完整顺序见 `docs/handoff.md` 第 9 节「从头完整重建」。
6. **改了需求（20–26）或路网（15–17）任何一步，必须收尾**：`… → 26 → pipeline/feedback_loop.py → 39 → diagnose_corridors → audit`。
   只重跑 23 或 27 而不跑回代，方式选择用的塞车时间就和分配结果对不上。
7. 不引入没有出处的数字。每个参数要么来自数据（写明文件/表号），要么明确标「估算」并写理由。
8. 与项目负责人沟通用**中文、白话**（土木背景，非计算机专业），用土木类比解释，不要让他选工程细节、给推荐方案；组员里有不会中文的，**对方用英文就用英文回答**；给全组看的文档要中英双语（例：`docs/team-quickstart.md` / `.en.md`）。

## 4. 常用命令（项目根目录）
```powershell
uv sync                                        # 装 Python 依赖
uv run python pipeline/00_check_env.py         # 环境自检
uv run python pipeline/<步骤>.py                # 跑一步（耗时见 pipeline-manifest.md）
uv run python pipeline/feedback_loop.py        # 塞车回代：27b → 23 → 24 → 27，直到相差 <5%（每轮约 13 分钟）
uv run python pipeline/audit.py                # 全量审计（120 项；现 118 通过，2 项已知局限见 handoff 顶部）
uv run python pipeline/check_docs.py           # 文档里引用的数字与审计是否一致
uv run pytest                                  # 测试（51 项）
uv run python scripts/snapshot_base_data.py [--check]   # 给 data/model + data/web 存只读快照 / 与最新快照比对
cd frontend; npm install; npm run build; npm run lint   # 前端
```
Windows 注意：用户名含中文时，GDAL 需要 `CPL_TMPDIR` 指向纯英文路径；Bash 的 heredoc 会吞反斜杠，含反斜杠的代码用文件写入工具。

## 5. 完成任何改动前的验证（缺一不可）
1. 改动涉及的 pipeline 步骤及其下游已按第 3 条第 6 点重跑；
2. `audit.py`：**不能出现新的 FAIL**（允许的 2 项：`assignment-audit.json` 的逐站 GEH、`bus-preload-audit.json` 的 0.84）；
3. `check_docs.py` 通过；文档里引用的数字改了就同步改，旧值加入 `check_docs.py` 的 `RETIRED`；
4. `pytest` 全过；前端改动还要 `npm run build`；
5. 在 `docs/handoff.md` 顶部加一段中文记录：改了什么、为什么、前后数字对比、还剩什么；新步骤写进 `pipeline-manifest.md`。
6. **在 `CHANGELOG.md` 最上面加一条**：时间（香港时间）、提交编号、改了什么、为什么、怎么验证；**本地提交后立即推送到 GitHub**，本地与线上保持一致。
7. 新增或改动了任何数据、模型产物或参数：在 `model/registry/data_tiers.toml` 登记它的可信度级别（A 实测 / B 校准推算 / C 依据推断 / D 示意假设）与出处，再运行 `uv run python model/registry/build_doc.py`；C/D 级结果对外展示时必须带「仅供参考 / 仅供学习」提示。
不要宣称「完成」或「更准了」而不给出前后对比的数字。

## 6. 模型关键事实（改之前要知道）
- 四阶段：21 出行生成 → 22 出行分布（双约束重力模型，公交时间阻抗；过海系数 K + 9 个主要地区的区内系数，对准出行调查表 3.4/3.5）
  → 23 方式选择（logit，自动拟合敏感度、的士车费权重、各方式常数；开车时间 = 空路时间 + 权重 × 塞车延误，来自 27b）
  → 24 早高峰 → 25 巴士预载 → 26 货车/跨境 → 27 道路分配（AequilibraE bfw，BPR alpha 0.378 / beta 2，来自 15e 探测器拟合；隧道串排队 6 分钟）
  → 39 公交分配（最优策略，港铁班距按官网改写）。
- 主要核对指标：全港总量 模型/普查 0.96；走廊 GEH<5 29%（目标 60%，**未达标，最该改进**）；港铁最繁忙段 模型/立法会 东铁 1.36、屯马 1.01、荃湾 0.93。
- 踩过的坑（全部在 `docs/handoff.md` 第 6 节）：`TRAVEL_DIRECTION` 1=双向、3=单行；AequilibraE 公交图的边是 b_node→a_node；
  AequilibraE 1.7 展开班次会丢班次（自己展开）；运输署探测器每份快照含两个 30 秒时段（曾导致车流翻倍）；社区版 GTFS 港铁班距不对。

## 7. 仓库协作
- `main` 只放审核过的内容；在分支上工作（`<名字>/<做什么>`），通过 Pull Request 合并，按 `.github/pull_request_template.md` 勾选。
- 改到 `data/`、`pipeline/` 的 PR 需要 CODEOWNERS（项目负责人）批准。
- 仓库是**私有**的；法定图则（`data/raw/zoning/`）与土地用途缓存（`data/cache/luhk2024/`）在 Release 附件里（见 `docs/onboarding.md` 1.3）。
