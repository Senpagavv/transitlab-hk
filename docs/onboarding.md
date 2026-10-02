# 新组员上手指南（给人看的）

> 写给第一次打开这个项目的组员。读完你应该知道：项目是什么、电脑要装什么、你这个角色该看哪里、怎么改东西才不会弄坏底座。
> 用 AI 助手（Claude Code、Codex、Cursor 等）干活的，让它先读根目录的 [`AGENTS.md`](../AGENTS.md)——那是同一套规矩的"AI 版"。
> English version: [`onboarding.en.md`](onboarding.en.md)。第一次用 GitHub 的，先看 [`team-quickstart.md`](team-quickstart.md)（English: [`team-quickstart.en.md`](team-quickstart.en.md)）。

## 0. 这个项目是什么（一分钟版）

一个**香港交通 + 土地的模型**，用政府公开数据把全港 455 个交通分区的人、岗位、道路、公交串起来，算出早高峰"谁从哪到哪、坐什么、走哪条路"。
在它上面我们要做一个**画新线的规划游戏**：在真实地图上画一条新地铁线或新路，模型算出客流、塞车、人口怎么变、值不值得修。

- 模型是**四阶段模型**：① 出行生成（每个区出多少人次）→ ② 出行分布（去哪）→ ③ 方式选择（开车还是坐公交）→ ④ 分配（走哪条路、坐哪条线）。
- 每一步都有**审计**：拿官方数字（人口普查、出行调查、交通普查、立法会港铁客量）对账，对不上会报出来。
- 现在的准确度、已知局限：见 [`handoff.md`](handoff.md) 顶部。

## 1. 第一次上手（所有人）

### 1.1 要装的软件
| 软件 | 用来干什么 | 装法 |
|---|---|---|
| Git | 下载项目、提交改动 | <https://git-scm.com> 下载安装，一路默认 |
| GitHub 命令行 `gh`（推荐） | 登录 GitHub、下载项目、发合并请求 | Windows：`winget install GitHub.cli` |
| uv | 装 Python 和项目用到的库 | `winget install astral-sh.uv`，或见 README「新电脑第一次配置」 |
| Node.js 20+ | 跑网站前端 | <https://nodejs.org> 下载 LTS 版 |
| VS Code（推荐） | 看代码、看文档 | <https://code.visualstudio.com> |

> **Windows 用户名是中文的**：先照 README「如果 Windows 用户名是中文」一节设好几个英文路径的环境变量，不然部分地理库会报错。

### 1.2 拿到项目
1. 接受邀请：GitHub 会发邮件「invited you to collaborate on transitlab-hk」，点 **Accept invitation**（仓库是私有的，只有组员能看）。
2. 登录：终端里 `gh auth login`，选 GitHub.com → HTTPS → Login with a web browser，按提示在浏览器里输入一次性代码。
3. 下载：`gh repo clone Senpagavv/transitlab-hk`（约 450 MB，含代码、文档、模型结果和除法定图则外的全部原始数据）。
4. 装环境：**Windows 双击 `scripts\setup-windows.cmd`，Mac 运行 `bash scripts/setup-mac.sh`**，一次装好全部（含中文用户名的处理）；手动装的话：项目根目录 `uv sync`，然后 `cd frontend` → `npm install`。
5. 自检：`uv run python pipeline/00_check_env.py`，全部 `[OK]` 即可（Java 只有重算公交时间矩阵的第 18 步才需要）。

### 1.3 附件（只有要重跑这两步的人才需要）
仓库的 **Releases（发布）** 页面有一个附件压缩包，里面是：
- `data/raw/zoning/`：城规会法定图则（153 张图的用途地带边界 + 152 份注释 PDF，约 510 MB）——重跑 `pipeline/37_statutory_zoning.py` 才需要；
- `data/cache/luhk2024/`：规划署土地用途格网的下载缓存——重跑 `pipeline/36_land_utilization.py` 才需要，**有了它就不必去请求政府服务器**（频繁请求会被封 IP）。

下载后**在项目根目录解压**（压缩包里的路径已经是 `data/...`）。命令行：`gh release download base-2026-09-26 --repo Senpagavv/transitlab-hk --pattern "*.zip"`。

## 2. 按角色看哪里

### 2.1 看结果、做演示
- 网站：双击 `scripts\start-dev.cmd`（或 README「每天启动」里的两条命令），浏览器开 <http://localhost:5173>。
- 小游戏（修桥 / 画地铁，已冻结当例子用）：直接双击 `game-demo/index.html`、`game-demo/metro.html`，不需要服务器。
- 结果文件：`data/model/`（模型算出来的表和矩阵）、`data/web/`（网站用的数据和每一步的 `*-audit.json` 审计报告）。
- 数据都从哪来：[`data-sources.md`](data-sources.md)（43 个来源，每个有多少条、什么字段、用在哪一步）。
- 每一步怎么算、用什么方程、怎么拟合、和 CA5236 课程的对照：[`methods-catalogue.md`](methods-catalogue.md)（英文 `methods-catalogue.en.md`）。
- 演示话术：[`demo-runbook.md`](demo-runbook.md)。

### 2.2 做前端
- 代码在 `frontend/`（React + MapLibre + deck.gl），后端在 `backend/`（FastAPI）。
- 开发：两个终端分别跑后端 `uv run uvicorn backend.main:app --reload --port 8000`、前端 `cd frontend; npm run dev`。
- 提交前：`cd frontend; npm run build`（类型检查 + 打包）和 `npm run lint`。
- 截图自检脚本在 `frontend/scripts/check-*.mjs`（用本机 Edge 后台截图）。

### 2.3 调模型、调数据
**先读**：[`for-codex/pipeline-manifest.md`](for-codex/pipeline-manifest.md)（每一步读什么、产出什么、跑多久）和 [`handoff.md`](handoff.md) 第 9 节（运行顺序）。
- 每个 `pipeline/NN_*.py` 开头都写着：读什么、怎么算、为什么、数据出处。
- 拟合用了哪些数据、拟合了几轮、误差多少：看对应的 `data/web/*-audit.json`（`report` 字段是中文说明）。
- **运行顺序 ≠ 编号顺序**。从头完整重建、只改某一步后该补跑哪些，都在 handoff 第 9 节。
- **改了需求或路网之后必须收尾**：`… → 26 → feedback_loop（塞车回代，直到稳定）→ 39 → diagnose_corridors → audit`。
- 大致耗时：方式选择（23）8–11 分钟；塞车回代每轮约 13 分钟（一般 1 轮就稳定）；公交分配（39）约 4 分钟；公交时间矩阵（18）约 20 分钟。
- **改完一定跑三件事**：`uv run python pipeline/audit.py`、`uv run python pipeline/check_docs.py`、`uv run pytest`。
  审计现在 118/120：剩下的 2 项是已知局限（逐站吻合度、巴士 0.84），原因写在 handoff 顶部；**不能出现新的不通过项**。

### 2.4 画新线、做情景
- 快速版：`game-demo/metro.html`（浏览器里十几秒算完，只算"跟现状比变了多少"），算法在 `game-demo/sim.js` 开头有说明。
- 完整版（一条新线进入正式模型，哪些步骤要重跑、跑几轮、看哪些数）：**文档编写中**（`docs/` 下「新线路怎么跑」）。

## 3. 在 GitHub 上怎么协作

```
main（主分支，只放审核过的）
 ├─ 你的分支  →  改、提交  →  推上去  →  开「合并请求」(Pull Request)  →  有人批准  →  合进 main
```
1. 开始新工作前：`git switch main` → `git pull`（拿到最新）→ `git switch -c 你的名字/做什么`（例：`amy/zone-panel`）。
2. 改完：`git add -A` → `git commit -m "一句话说清改了什么"` → `git push -u origin 你的分支名`。
3. 开合并请求：`gh pr create`（或在网页上点 Compare & pull request），按模板勾选检查项。
4. **改到 `data/` 或 `pipeline/` 的合并请求必须项目负责人批准**（仓库里的 `.github/CODEOWNERS` 规定的）。
5. 合并之后：`git switch main` → `git pull`。

## 4. 规矩（保护底座）

1. **`data/raw/` 只放原始下载，永远不手改。** 要换数据就改下载脚本重新下，并在合并请求里写明原因。
2. **`data/model/`、`data/web/` 只能由 `pipeline/` 脚本生成**，不要手改里面的文件。
3. **做实验不要改正式结果**：把输出写到你自己的目录（例如 `data/cache/你的名字/`，这个目录不进 Git），或者开新分支。
4. 本地有只读快照工具：改之前 `uv run python scripts/snapshot_base_data.py` 存一份，改之后 `--check` 看改了哪些文件。
5. **不要提交** `.env`（放密钥）、`data/cache/`、`data/snapshots/`、单个超过 50 MB 的文件。
6. **不要高频请求政府接口**（CSDI、DATA.GOV.HK 等）——被封过一次 IP；能用缓存就用缓存。
7. 改了数字，文档里引用它的地方也要改（`check_docs.py` 会查）。
8. **永远不要强制推送（force push）**。
9. **每次改动在 `CHANGELOG.md` 最上面写一条**（时间、改了什么、为什么、怎么验证），提交后马上推送到 GitHub。
10. 用到的每个数据或参数都有可信度级别（A 实测 / B 校准推算 / C 依据推断 / D 示意假设），见 [`data-tiers.md`](data-tiers.md)；新加的要在 `model/registry/data_tiers.toml` 登记。C/D 级只供参考和学习，不能当真实数据用。

## 5. 常见问题
- **`uv sync` 很慢或报路径错**：多半是中文用户名路径，见 1.1 的提示。
- **地理库读 `.gdb.zip` 报错**：设环境变量 `CPL_TMPDIR` 到一个纯英文路径的文件夹。
- **网站地图空白**：底图来自地政总署，要联网；公司/学校网络挡了就换网络。
- **审计出现新的 FAIL**：先看 `data/web/` 里对应的 `*-audit.json` 的 `report` 和 `flags`，再看 handoff 第 6 节「踩过的坑」有没有同样的情况。
