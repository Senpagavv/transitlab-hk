# TransitLab HK

香港交通情景模拟平台 · Hack for SDGs 2026（Green Transport & Smart Mobility 赛道）

> ### New teammates start here · 新组员从这里开始
> - **English**: joining & GitHub basics → [`docs/team-quickstart.en.md`](docs/team-quickstart.en.md); getting started by role → [`docs/onboarding.en.md`](docs/onboarding.en.md); AI assistants → [`AGENTS.md`](AGENTS.md). Most other documents are in Chinese — use browser translation or ask your AI assistant.
> - **第一次用 GitHub**：[`docs/team-quickstart.md`](docs/team-quickstart.md)（注册、接受邀请、下载、日常怎么提交）
> - **人**：读 [`docs/onboarding.md`](docs/onboarding.md)——装什么、怎么拿到项目、按角色（看结果 / 前端 / 调模型 / 画新线）看哪里、怎么在 GitHub 上协作、哪些东西不能动。
> - **AI 助手**（Claude Code、Codex、Cursor…）：让它先读 [`AGENTS.md`](AGENTS.md)。
> - **数据从哪来**：[`docs/data-sources.md`](docs/data-sources.md)（43 个来源的总目录）；**每个数据、参数可信到什么程度**：[`docs/data-tiers.md`](docs/data-tiers.md)（A/B/C/D 四级）。
> - **改动日志**：[`CHANGELOG.md`](CHANGELOG.md)（每次改动的时间、内容、验证）。
> - **现在做到哪、准确度、已知局限**：[`docs/handoff.md`](docs/handoff.md) 顶部。
>
> 方向（2026-09-25 起）：在这个模型上做「画新地铁线 / 新路」的规划游戏；下面「这个工程算出了什么」一节是更早的无人车车队方向，保留作参考。

> **要演示？照着 [`docs/demo-runbook.md`](docs/demo-runbook.md) 念**——开场、讲什么、会被问什么、不要说什么。
>
> **接手这个项目？先读 [`docs/handoff.md`](docs/handoff.md)** —— 完整交接简报：
> 现在做到哪一步、每个数字从哪来、踩过哪些坑、自审方法怎么用。
> 做任何改动前先跑 `uv run python pipeline/audit.py`（120 项检查，失败退出码 1）。

## 这个工程算出了什么（2026-09-23）

一条链，从政府公开数据一路算到"需要多少辆车"：

```
官方数据 ──► 交通分区/路网/班次 ──► 四阶段模型 ──► 叫车请求 ──► 调度模拟 ──► 网页
 普查·运输署·规划署        455 个分区        生成→分布→方式→分配   71.7 万条    逐分钟派单
```

| 结论 | 数字 | 怎么验证的 |
|---|---|---|
| 2026 年工作日机动化出行 | **1,231 万人次** | 出行调查 2022 为 1,236 万 |
| 的士日均载客 | **68.8 万人次** | 锚定运输署月报表 2.1S（最近 12 个月） |
| 干路网行车时间误差 | **中位 12%** | 对 589 个探测器路段的实测车速 |
| **最小车队**（接单 ≥95%、等待 ≤5 分钟） | **12,000 辆** | 今天领牌 17,695 辆，**少 32%** |

**报最后这个数时必须一起说四条局限**：车不换更不充电、没有空车再平衡、需求固定、分区级派单。
详见 [`docs/handoff.md`](docs/handoff.md) 第 6.67 条。

也有几条结论是**反直觉、但更该讲的**：香港的士载客率在 **65% 以上**，没有传说中的"一半空驶"；
配额自 1994 年冻结在 18,163 辆、载客量十年跌三成，但 2026 年在回升。见 6.62、6.66。

## 目录结构

| 目录 | 作用 | 类比 |
|---|---|---|
| `pipeline/` | 数据管线：下载、清洗、统一坐标、算出行时间矩阵（离线运行） | 材料进场检验 + 预制构件厂 |
| `data/raw/` | 原始下载，永远不手改（进 Git；法定图则 `data/raw/zoning/` 太大，放在 Releases 附件） | 原材料仓 |
| `data/processed/` | 清洗后的数据（不进 Git，可由 pipeline 重新生成） | 半成品 |
| `data/model/` | 模型算出来的表和矩阵（只能由 pipeline 生成） | 计算结果 |
| `data/web/` | 给网站用的轻量文件 + 每步的审计报告 | 成品构件 |
| `model/` | 交通模型（出行产生、分布、方式选择、指标）+ 测试 | 结构计算书 |
| `backend/` | FastAPI 后端：数据查询、地名解析、跑模型、调用 AI | 结构和设备系统 |
| `frontend/` | React + MapLibre 前端：地图、面板、图表 | 建筑外观和人流动线 |
| `docs/` | 复用项目清单、数据来源记录 | 图纸目录 |
| `scripts/` | 一键启动等小工具 | — |

## 每天启动

**双击桌面上的「TransitLab HK」图标**。第一次启动约 15–20 秒后浏览器自动打开网站；服务已经在运行时再双击，只会打开网页，不会重复启动。

- 启动后任务栏会出现一个终端窗口（后端、前端各一个标签页），**用网站时不要关**；不用时关掉它即可停止。
- 桌面图标指向 `scripts\start-dev.ps1`；图标丢了可以双击 `scripts\start-dev.cmd`，效果相同。
- **玩修地铁 demo**：双击 `scripts\start-game.cmd`（Mac：`scripts/start-game.sh`），浏览器打开 <http://127.0.0.1:8000/game/>；说明见 [`game/README.md`](game/README.md)。

或者手动开两个终端：

```powershell
# 终端 1：后端（项目根目录）
uv run uvicorn backend.main:app --reload --port 8000

# 终端 2：前端
cd frontend
npm run dev
```

- 网站：http://localhost:5173
- 后端接口文档（可以直接在网页里试接口）：http://127.0.0.1:8000/docs

## 网页上能看什么

- **地图底图 + 地名搜索**
- **实时车流**：运输署 770 多个探测器，每 3 分钟更新，画成沿路的渐变线条
- **交通分区图层**（右侧下拉切换 7 个指标）：人口密度、人口变化、就业、学额、65 岁以上占比、
  **叫车需求**、**车队缩到 8 千辆时的接单率**——最后这个能看出**哪些偏远分区先被放弃**
- **车队沙盘**（左上角面板）：车队规模曲线可点，换规模看接单率/等待/空驶；底部折叠区列着四条局限

## 检查和测试

```powershell
uv run python pipeline/00_check_env.py   # 环境自检（Python、地理库、坐标转换、Java、r5py）
uv run python pipeline/audit.py          # 全量数据自审（120 项，失败退出码 1）
uv run pytest                            # 后端和模型测试
cd frontend; node scripts/check-fleet.mjs map-check/fleet   # 车队沙盘截图自检（需先起服务）
cd frontend; npm run build               # 前端类型检查 + 打包
```

## 新电脑第一次配置

> **最快**：Windows 双击 `scripts\setup-windows.cmd`；Mac 运行 `bash scripts/setup-mac.sh`（自动装 uv、Node.js、Python 3.12 和全部库，处理中文用户名，最后自检）。下面是手动步骤。

1. 安装 Node.js 20+、Git、Python（任意版本，只用来装 uv）。
2. 安装 uv：`python -m pip install uv`
3. 下载 Java 21（Temurin **zip 版**，不要用 MSI），解压到**纯英文路径**。
4. 复制 `.env.example` 为 `.env`，填 `JAVA_HOME` 和 `DEEPSEEK_API_KEY`。
5. 安装依赖：项目根目录 `uv sync`；`frontend` 目录 `npm install`。
6. 运行环境自检：`uv run python pipeline/00_check_env.py`，全部 `[OK]` 即可。

### 如果 Windows 用户名是中文（本机就是）

中文路径会让 Java 等原生工具出错，本机已做以下处理：

| 问题 | 处理 |
|---|---|
| uv 默认把 Python 装到用户目录 | 用户环境变量 `UV_PYTHON_INSTALL_DIR=F:\tools\uv-python`；`uv.toml` 里缓存放 `F:/tools/uv-cache` |
| Java 读不了中文临时目录（r5py 报 `java.io.tmpdir directory does not exist`） | `%APPDATA%\r5py.yml` 写入 `temporary-directory: F:/tools/java-tmp` |
| Java 21 | 解压在 `F:\tools\jdk-21`，只通过 `.env` 的 `JAVA_HOME` 给本项目用，不影响系统里原有的 Java 8 |

新开的 VS Code 终端才会读到新设置的环境变量；如果 `uv run` 开始重新下载 Python，重启 VS Code 即可。

## 搜索是怎么工作的

输入框边打字边出结果，分两路：

| | 本地索引 `/api/places/suggest` | 政府接口 `/api/search` |
|---|---|---|
| 内容 | 港铁站、轻铁站、码头、巴士站、小巴站（约 9,500 个） | 建筑、地址、设施等全部地名 |
| 速度 | 约 10–50 毫秒 | 约 1–2 秒（其中约 0.8 秒是政府服务器处理时间） |
| 触发 | 打第 1 个字就查 | 停止打字 0.4 秒后，且至少 2 个汉字或 3 个英文字母 |

本地索引文件 `data/web/places.json` 由 `uv run python pipeline/01_build_place_index.py` 从社区 GTFS 生成；GTFS 更新后重跑一次，再重启后端。

## 底图

- 地政总署**矢量底图 + 繁中标注**（免费、无需密钥），样式文件由 `uv run python pipeline/02_build_basemap_style.py` 生成到 `frontend/public/basemap/`。
- **本地缓存**：瓦片、字体、图标都经后端 `/api/basemap/...` 取，缓存在 `data/cache/landsd/`（不进 Git），从硬盘读约 6 毫秒。网址加 `?tiles=direct` 可绕过缓存做对比。`pipeline/03_prewarm_basemap_cache.py` 可限速预下载全港瓦片（约 7,000 个文件，约 1 小时）。
- **上线用的打包底图**：`pipeline/04_build_basemap_pmtiles.py` 把缓存打包成 PMTiles 单文件，网址加 `?basemap=pmtiles` 可在本地验证。上传步骤见 [docs/deployment.md](docs/deployment.md)。
- **解析线程**：MapLibre 默认只用 1 个线程解析瓦片，已改为 4 个（`frontend/src/map/maplibreWorker.ts`）。
- **缩放过渡**（`frontend/src/map/transitionVeil.ts`，网址加 `?veil=off` 可关闭）：放大/缩小时先用旧画面盖住（放大越多越模糊，避免巨型糊字），新画面全部准备好后**整体一次性碎开**（0.3 秒）。拖动不触发，未加载的边缘显示浅色底色。
- 17 级以上不再下载瓦片，但每换一级仍要重新解析 15 级数据，所以仍有约 0.3–0.5 秒准备时间。
- 条款要求：地图上显示地政总署标志和 "© Map from Lands Department"；避免短时间大量请求。

### 实测速度（2026-09-15，停止缩放 → 新画面就绪）

| | 政府服务器直连 | 本地缓存·第一次看 | 本地缓存·看过的地方 |
|---|---|---|---|
| 中环（12→16 级快速放大） | 1.2 秒 | 1.3 秒 | **0.33 秒** |
| 旺角 | 1.9 秒 | 1.3 秒 | **约 0.5 秒** |

## 实时车流

- 数据：运输署「主要道路交通数据」，**767 个探测器**记录每条车道的车速、车流量和占有率，**实测数据，不是模型**。
- 节奏：源文件约每 3 分钟更新，数据滞后当前时间 3–5 分钟；后端最多每 60 秒向源站要一次（带 ETag，未更新就不重新下载 700 KB），前端每 30 秒取一次后端的精简数据（gzip 后约 33 KB）。
- 只接受比当前更新的读数：数据源有多个缓存节点，偶尔会返回稍旧的快照。
- 显示：颜色=拥堵程度（当前车速 ÷ 该探测器自身的畅通车速），圆点大小和不透明度=车流量，所以视线会落在车多或堵的地方。更新时用 1.5 秒渐变过渡，实测缩放帧率 58 fps、无卡顿。
- 接口：`GET /api/traffic/live`。历史某天的逐小时数据：`uv run python pipeline/05_traffic_detectors.py 2026-09-09 --every 10`（约 4 分钟，输出 0.2 MB）。

## 看不到界面时怎么检查（需要前后端正在运行）

| 脚本（在 `frontend` 目录运行） | 作用 |
|---|---|
| `node scripts/check-map.mjs <输出目录>` | 用本机 Edge 后台打开网站，记录报错，在不同缩放级别截图 |
| `node scripts/check-transition.mjs <输出目录> [direct]` | 快速缩放/拖动时按时间点截图，并对比过渡动画开/关的帧率 |
| `node scripts/measure-basemap.mjs <cache\|direct> [zoom/lat/lon]` | 测停止缩放、拖动后多久新画面就绪 |

## 已知接口特性

- MapLibre 6 的工作线程文件在 Vite 开发服务器下找不到（矢量底图会一片空白），已在 `frontend/src/map/maplibreWorker.ts` 指定路径。

- 地政总署地名搜索接口会拒绝 Python 默认的 User-Agent（403），后端已自带应用名。
- 同一接口在"查不到"时返回 HTTP 500 而不是空列表，后端按"没有结果"处理。
- 接口支持简体输入；本地索引也做了简繁转换（OpenCC）。
- 地政总署底图要求保留 "© Map from Lands Department" 署名。
