# 改动日志 / Changelog

> **规则 / Rule**：每次改动都在最上面加一条——**时间（香港时间）、提交编号、改了什么、为什么、怎么验证的**；本地提交后立即推送到 GitHub，保证本地和线上一致。
> Every change adds an entry at the top — **time (HKT), commit, what changed, why, how it was verified** — and is pushed to GitHub right after the local commit, so local and online stay identical.
> 更详细的过程和数字见 [`docs/handoff.md`](docs/handoff.md) 顶部。Details and numbers: top of `docs/handoff.md`.

## 2026-10-02

### 18:05 · 核心抽象定为「想法」+ Codex 任务 48（想法地图）/ Core unit "desire" and Codex task 48
- **改了什么**：`docs/design/game-v3-concept.md` 补充一节：网络复杂、每个人的想法简单；想法 = 一群人从 A 去 B、多少人、开不开心（😊 / 🐢 太慢 / 🧱 太挤 / ⛔ 断了）；满足办法 = 牵线直达、分流减压（间接救一片）、接驳、站旁开发；计分直接 / 间接分开，结算给连锁说明。
  `docs/for-codex/task-48-desire-map.md`：用真实数据划 35–45 个生活圈、抽 40–80 个想法、找每个想法现在的港铁路线和卡住的段、排热点段，做一张不用开关就能看懂的「想法地图」页，产出到桌面「TransitLab想法地图」。
  外星人降临启德的事件原型暂停，等想法地图验证规律后再做。
- **为什么**：发起人指出人看着人口、岗位、线路很难凭直觉找到规律；要先把复杂情况拆成简单的想法，看得清谁想去哪、多少人、一条线能满足多少。
- **验证**：文档变更，无代码改动。

### 17:40 · 游戏 v3 整体思路草案 + Codex 任务 46、47 / Game v3 concept draft and Codex tasks 46, 47
- **改了什么**：`docs/design/game-v3-concept.md`——发起人试玩 v2 后定的方向：「城市出了大事，用铁路和车站（TOD）限时化解」；地图本身一眼讲清问题（不用开关）、事件驱动 + 时间压缩、自由解题 + 即时模拟、多维评分（速度 / 花费 / 拥挤 / 公平 / 环保）各自上榜加总榜；去掉 v2 一步一步的「规划顾问」。
  `docs/for-codex/task-46-map-visual-mockups.md`：用真实数据做 6 种地图画法的样稿（点密度、六边形分级、重新划分的生活圈大区、只画问题、通勤时间着色、组合版），产出到桌面「TransitLab地图样式」，让发起人挑。
  `docs/for-codex/task-47-event-library.md`：10–12 个大事件（吸血鬼疏散〔虚构〕、启德散场、台风停运、跨境人潮、北都入伙、东铁过挤、老龄屋苑、新就业中心、过海中断、大型展览），每个写数量依据、目标、为什么一个站不够、容量参数，产出到桌面「TransitLab大事件库」。
- **为什么**：发起人反馈 v2 仍不好玩：看不到数据、指引像连线游戏、目标不清；要地图一眼看出人流、拥堵、不均，并能启发第一步；提出「大事件 + 极端情况 + TOD 快速化解 + 多维排行」的玩法；Claude 的用量有限，样稿和资料交给 Codex。
- **验证**：文档变更，无代码改动。

### 17:40 · 接入 Codex 参数调研（任务 44）/ Parameters from Codex task 44
- **改了什么**：登记表 7 项从「待查/临时值」改为在用，带出处：运营费 37.04 港元/车厢公里（C，港铁 2025 年报按 CPI 换到 2026 年 8 月）、每列载客 1780 人（A）、电网排放中电 0.34 / 港灯 0.59 kg/kWh（A，游戏按线路在港岛的车站比例加权）、碳价 1860 港元/吨（D，国际情景中值）、贴现率 4%（C）、换乘惩罚 4.41 分钟（C，港铁乘客选择研究）、列车 80 km/h · 1.0 m/s² · 停站 40 秒（C）。引擎：`params.py` 从登记表读列车参数，运营费按每列 8 节车厢折算。
  造价单价 Codex 没找到可拆分的值（只有项目级：南港岛线约 24 亿/公里、观塘延线约 28 亿/公里，均为当年金额），仍是 D 级临时值。
- **为什么**：发起人说 Codex 已完成；把查到的值接进去，结果的可信度标签随之更新。
- **验证**：pytest 59 全过；北环线例子：每天 27 万人次（换乘惩罚变大、停站变长，原 32 万）、列车用电碳排 9,706 吨/年（原约 1.5 万）、运营费 4.23 亿/年、运营费可信度 D→C。政府方案基准缓存自动失效重算。

### 17:21 · 游戏 v2：有目标、有反馈（出题模式）/ Game v2: missions with goals and feedback
- **改了什么**：发起人反馈第一版"画几条线、等结果、结束"没意思。参考 Mini Metro、天际线、Poly Bridge、Subway Builder、NIMBY Rails、A/B Street 后定方向（`docs/design/game-v2-missions.md`，中英）：
  - **题目由数据自动生成，不手写**（`game/engine/missions.py`）：通勤题 8 道（模型里"人多又慢"的区→区早高峰公交人流，出发区和目的地取紧凑的一片，没路的离岛不算）；打败政府方案 5 道（北环线、中铁线、新界东北线、屯门南延线、东涌线延线；政府方案先用完整模型算一遍当标准答案，缓存在 `game/.cache/`，同一套单价）；发展题 1 道（北都人口大增）；每天一道"今日一题"。
  - **一道题拆成 8 步，每步有指引和分数**（满分 100、三颗星）：看清问题、好站位、接上港铁、完成目标、不超预算、铁路+物业、账算得过来、打败政府方案。
  - **即时反馈**：新增 `/game/api/quick`，每点一个站 0.1 秒内算出新线客流和目标进度；跳"+X 人/天"、"网络效应！接上青衣站，客流 ×N"、"🎯 目标达成"；分数和进度条实时动；列车小方块在线上跑、站上人数气泡（挤就闪红）；挑模型里真实的受益人流配虚构人物说话（时间是模型算的）；音效可关。
  - **通车日**：完整模型揭晓，星级、分步得分、"你 vs 政府方案"并排条形图、快算和完整模型的差别说明；每题本机排行和"载入"旧方案。
  - 新数据 `data/raw/planned-railways/`（Codex 任务 45：24 个政府规划项目的示意走线与站位，约 ±500 米）登记为 B05（C 级）。北环线终点古洞东铁站在建，模型里用"延到上水"代表接上东铁线，否则政府方案被低估（快算 3 万 → 修正后完整模型 28 万人次/天）。
  - 原自由世界保留（也有即时反馈）；实时经营、空白香港为下一期。
- **为什么**：游戏要不断有反馈、有目标、中间有很多步骤和得分点；关卡不能靠手写。
- **验证**：pytest 59 全过（新增出题测试）；无头浏览器全流程（选题 → 画线跳数字/连击 → 通车 → 结果、政府方案对比）无报错。示例：屯门→油尖旺快线 62 分；北环线题我方 32 万 vs 政府 28 万人次/天、净收益 −382 vs −349 亿，59.5 分。

### 16:40 · 桌面图标「TransitLab 修地铁」/ Desktop shortcut for the demo
- **改了什么**：新增 `scripts/start-game.ps1`（`start-game.cmd` 改为调用它）：8000 端口没开就在后台启动计算引擎；开着但没有 /game（游戏加进来之前启动的旧后端，返回 404）就自动重启它；等到能用再打开 <http://127.0.0.1:8000/game/>。本机桌面加了「TransitLab 修地铁」快捷方式（图标同 TransitLab HK）。
- **为什么**：发起人要能从桌面直接打开；本机正开着一个旧后端，直接打开会 404。
- **验证**：本机实跑：旧后端被替换为带 --reload 的新后端，8 秒后浏览器打开游戏页，/game/api/boot 返回 200。

### 16:31 · 可玩 demo：自由世界 + 情境题「北都人口大增」/ Playable demo: free world + scenario
- **改了什么**：新增 `game/`（计算引擎 + `/game/api`）和 `game-ui/`（网页），双击 `scripts/start-game.cmd`（Mac：`start-game.sh`）打开 <http://127.0.0.1:8000/game/>。
  点地图放车站、站间自动连直线（Shift+点 = 拐弯点）；150 米内接上现有港铁站自动成换乘站；线段按土地用途格网自动判断隧道/高架（可点击改）；站旁开发三种套餐；搜车站、地方、屋苑、分区。
  每次「开始算」跑完整四阶段模型 4 轮：新线客流和拥挤 → pipeline/22、23、24 原参数重算去哪里、坐什么、早高峰 → 增量路网分配和塞车回代；以 2026 基准加差值，什么都不建 = 基准原样。
  结果：每天坐新线人次、省时（半数法则 × 模型时间价值）、路上车辆、碳排、造价、运营费、地价、40 年净收益和回本年数，每项带 A–D 可信度；原因卡；每段载客率；地图上线宽 = 客流、绿圈 = 上车、蓝圈 = 受益地区。情境题 100 分制（通勤 30、少开车 15、效益成本比 40、有人坐 15，超预算 ×0.7）和本机排行榜。
  帮大众看懂数据：人口 / 岗位 / 离港铁远的人三张热力图（分区人口摊到 10 米土地用途格网的住宅/工商楼宇）、「人多又走得远」的主要人流箭头、站点卡（800 米内人口岗位，和 97 个现有站比 A–D，「跟哪个站差不多」）。
  登记表新增 4 项 D 级（D.route_cutoff_min、D.service_pattern、D.dev_packages、D.scenario_north），to_research 参数给了 demo 临时值（`provisional`，按 D 级算），共 117 项；`pyproject.toml` 的 pytest 把项目根目录放在最前（本机 PYTHONPATH 里另有一个 `game` 文件夹会抢名字）。
- **What**: playable demo (`game/` engine + API, `game-ui/` page): click to place stations, straight segments, automatic interchange and tunnel/viaduct choice, station-area development, search; each run is the full four-step model for 4 feedback rounds as a difference on the 2026 base; ledger with confidence tiers, reasons, section loads, maps of riders and gains; scenario score out of 100 and a local leaderboard; heat maps, main-flow arrows and station cards to make the data readable.
- **为什么**：发起人要先亲手玩两个 demo（自由开放世界 + 一道有分数的题），再给体验反馈。
- **验证**：pytest 58 全过（新增 `tests/test_game_engine.py`：不建线 = 基准原样，误差 < 1e-6；运行时间公式；接驳与分流合理）；无头浏览器截图检查 `frontend/scripts/check-game.mjs` 全流程无报错。示例「北环线」（錦上路—上水 12 公里）：每天约 37 万人次（含一条屯门试画线）、造价 405–571 亿、效益成本比 0.14–0.2；情境题示例 24.6 分 D 级。自由模式一次约 25 秒，情境题第一次约 50 秒（多算一遍「没有新线的北都」，之后缓存）。
- **已知局限**：现有港铁各线的拥挤没有建模（新线分走旧线乘客的好处没算）；造价、碳排等单价是 D 级临时值，等任务 44。

### 15:19 · 游戏规则 v1 草案（A 真实世界 + B 情境题）
- **改了什么**：新增 `docs/design/game-rules-v1.md`——两个模式共用一个引擎和一本账；四道情境题（北都人口大增、东铁过挤、老龄化社区、新就业中心）；预算内不限线路条数；排行榜按净收益（亏得少也算）+ 题目目标徽章；引擎要支持多条新线互相换乘（min-plus 组合）。`pro-mode-walkthrough.md` 标注为教学沙盘（以后做）的参考。
- **为什么**：发起人澄清：要的是玩家自己画线、切实感受变化并比较谁画得最好，而不是跟着老师做任务。
- **验证**：文档变更，无代码改动。

### 15:10 · Codex 任务书 44、45；专业/教学模式完整流程示例（草案）
- **改了什么**：`docs/for-codex/task-44-parameter-research.md`（24 个待查/待升级参数：造价、运营成本、楼价溢价、排放系数、碳价、贴现率、各种弹性、列车运动学、步行范围、拥挤与换乘惩罚，每个值须附出处页码）；`docs/for-codex/task-45-planned-railways.md`（政府已公布的规划铁路：清单 + GeoJSON 走向与车站）；`docs/design/pro-mode-walkthrough.md`（以虚构的北都东西线 + 站旁开发为例，18 步写清看到什么、能做什么、公式、考虑因素、数据级别、对应课程、可视化、计算时间）。登记表新增 4 项（拥挤系数 D、换乘惩罚 D、列车运动学 C 待查、步行范围 C 待查），共 109 项。
- **为什么**：发起人要求 Codex 并行查资料；先看一个完整、复杂的专业模式例子再决定加减。
- **验证**：pytest 55 全过；`docs/data-tiers.md` 已重新生成。

### 15:00 · `866730a` 数据与参数可信度分级登记表；改动日志 / Confidence registry; changelog
- **改了什么**：新增 `model/registry/data_tiers.toml`——105 项（35 数据集、27 模型产物、43 参数）逐项标 **A 实测 / B 校准推算 / C 依据推断 / D 示意假设**，写明出处、依据、在用/待查/不做；
  `model/registry/build_doc.py` 自动生成中英对照的 [`docs/data-tiers.md`](docs/data-tiers.md)；`tests/test_data_tiers.py` 核对登记值与审计文件一致、43 个数据来源都已登记、文档是最新的。
  新增本日志；`AGENTS.md`、上手指南、合并请求模板加入「每次改动写日志、本地与 GitHub 同步」。
- **What**: 105-item confidence registry (A measured / B calibrated / C evidence-based estimate / D illustrative assumption) with sources and status; bilingual tier document generated from it; tests keep it in sync with the audit files. This changelog; the rule added to AGENTS.md, onboarding and the PR template.
- **为什么**：发起人要求后台标清哪些是实测、哪些是推断、哪些是假设，使用时分级提示（教学用途，C/D 级仅供参考）。
- **验证**：pytest 55 项全过（新增 4 项）。

### 09:52 · `24367d5` 一键环境安装 / One-click setup
- `scripts/setup-windows.cmd`（双击）、`setup-mac.sh`、`start-dev.sh`；依赖清单补 pillow（第 36 步要用，原来缺）、rasterio、scipy。
- 验证：Windows 版在本机实跑 5 步全过；Mac 版未实测；pytest 51 全过。

## 2026-09-28
### 20:17 · `7793df5` 推算方法总目录入库；时段塞车指数修正
- `docs/methods-catalogue.md`（英文 `.en.md`）、`docs/methods-course-notes.md`（Codex 整理，对照 CA5236）。
- Codex 发现第 27b 步时段权重写死 `(车流比)^4`，而塞车曲线 β 已是 2 → 改为读 `bpr-parameters.json`；权重 0.70/0.66/0.59/0.68 → 0.80/0.80/0.74/0.81，回代 1 轮稳定，东铁 1.36 → 1.37。
- 验证：审计 118/120（两项已知局限），pytest 51，文档体检通过。

### 19:17 · `36ffece` Codex 任务书 43（推算方法总目录）

## 2026-09-26
### 15:17 · `29a48c0` 双语文档：组员加入指南（中/英）、上手指南英文版
### 14:47 · `4fa62c7` CODEOWNERS：`data/`、`pipeline/` 改动须项目负责人批准
### 14:40 · `40e4af2` 数据文件不做换行转换（各电脑上 SHA-256 指纹一致）
### 14:39 · `bac3449` 上传准备：原始数据入库（法定图则走 Release 附件）、AGENTS.md、合并请求模板、数据来源总目录
### 14:26 · `dfa0065` 记录两项已知局限：逐站 GEH 18%、巴士 0.84（发起人确认不再改动）
### 14:19 · `4927906` 出行分布加区内系数（沙田自给率 21% → 31%）+ 底座整体审查
- 验证：审计 118/120，pytest 51；28–35 按新需求重跑。
### 13:14 · `0434ca8` 塞车曲线按探测器实测（alpha 0.378、beta 2）+ 塞车回代方式选择；修探测器车流翻倍
- 验证：走廊 GEH<5 23.5% → 29.4%；探测器路段早高峰/深夜 模型 1.06 → 1.14（实测 1.22）。

## 2026-09-25
### 21:15 · `8e09161` 第一次存档：模型底座 + 隧道排队 + 海水边界 + 上传前检查
- 底座补全（36 土地用途、37 法定图则、38 地价、39 公交分配）；隧道排队 6 分钟；接驳与小游戏不跨海/水塘；上传前密钥与路径检查。

## Git 之前（2026-09-15 – 09-25，详见 handoff）/ Before Git
- 09-15 项目骨架；09-16 底图、实时车流、普查与吸引端数据；09-17 455 个交通分区、2026 人口、开车/公交时间矩阵；
  09-18 出行生成、分布、方式选择；09-19 – 09-24 早高峰、货车、道路分配、车队沙盘（28–35）；09-25 方向改为「画新线」规划游戏，修桥/修地铁原型。
