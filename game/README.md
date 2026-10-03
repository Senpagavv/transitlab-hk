# 修地铁可玩 demo / Playable metro demo

> **新：外星人降临启德（规则版 demo，2026-10-03）**——桌面「外星人降临启德」或 <http://127.0.0.1:8000/game/alien/>。
> 规则见 `docs/design/game-v3-concept.md`；模拟器 `game-ui/alien/sim.js`（每游戏分钟一步，浏览器和 Node 都能跑），数据 `game/alien/build_data.py`（439 分区、13 条干道的真实通行能力与平日负荷），自动试玩 `node game/alien/tune.js`。
> New: the "aliens land at Kai Tak" rules demo at /game/alien/ (simulator in game-ui/alien/sim.js, data from game/alien/build_data.py, bot play-tests in game/alien/tune.js).

**怎么开 / How to start**: 双击 `scripts\start-game.cmd`（Mac：`scripts/start-game.sh`），浏览器会打开 <http://127.0.0.1:8000/game/>。第一次载入模型约 15 秒。
Double-click `scripts\start-game.cmd` (Mac: `scripts/start-game.sh`); the browser opens <http://127.0.0.1:8000/game/>. The model takes about 15 s to load the first time.

**v2 出题模式（2026-10-02）/ Missions**：选题首页有今日一题和题库（通勤题、打败政府方案、发展题，都由数据自动生成，见 `engine/missions.py` 和 `docs/design/game-v2-missions.md`）；画线时每一步 0.1 秒快算（`/game/api/quick`）给反馈和分数，「通车」用完整模型揭晓。

两种玩法（v1）/ Two modes (v1):
- **自由世界 / Free world**：2026 年真实的香港，随便画线、选站旁开发，看账本和净收益。Real 2026 Hong Kong, draw anything, see the ledger and net benefit.
- **情境题：北都人口大增 / Scenario: Northern Metropolis boom**：元朗、北区多住 20 万人，预算 1500 亿，每次算完给 100 分制的分数，本机排行榜。200,000 more residents in Yuen Long and North, HK$150 bn budget, a score out of 100 for every attempt, local leaderboard.

## 一次「开始算」做了什么 / What one run does

完整的四阶段模型，以 2026 基准为起点，只把**差值**加回去；什么都不建 = 和基准一模一样（`tests/test_game_engine.py` 检查）。
The full four-step model, starting from the 2026 base and adding only the **difference**; building nothing gives the base exactly (checked by `tests/test_game_engine.py`).

每一轮 / each round（共 4 轮，逐轮平均 / 4 rounds with averaging）:
1. **新线 / transit** (`engine/network.py`, `engine/transit.py`)：站点 150 米内接上现有港铁站 = 换乘站；站间运行时间按加速–巡航–减速（80 km/h、1 m/s²、停站 30 秒）；每对分区多一条「走路或坐原有公交到站 → 等车 → 坐车 → 换乘 → 下车」的走法（最短时间合成 min-plus），按省多少分钟分流（logit，每分钟 0.5），装到线上，太挤的区段感觉更慢（拥挤系数），重复到稳定。
   Stations within 150 m of an existing MTR station become interchanges; running time from acceleration–cruise–braking; every zone pair gets one more way to travel (min-plus composition with the base times), travellers split by minutes saved (logit 0.5/min), loaded on the line, crowded sections feel slower, repeated until stable.
2. **出行 / demand** (`engine/base.py`)：用 pipeline/22（去哪里，重力模型 + Furness）、pipeline/23（坐什么，多项 logit）、pipeline/24（早高峰 8–9 点）**原来的标定参数**重算，不重新拟合。Re-runs pipelines 22, 23 and 24 with their calibrated parameters (no refitting).
3. **路面 / roads** (`engine/road.py`)：多出或少了的私家车、的士、校巴，放回真实路网（5 万条路段）上的最短路（增量全有全无 + 逐次平均），BPR 算塞车，塞车回到下一轮的方式选择。Changed car/taxi/coach trips put on the real road network, BPR congestion fed back to mode choice.

然后 / then `engine/evaluate.py`：每天坐新线人次、省下的时间（半数法则 × 模型的时间价值 × 每年 300 个工作日）、路上少多少车、碳排（汽车 + 列车用电）、造价、运营费、站旁开发地价、40 年 4% 折现的净收益和回本年数，每一项带可信度（A–D）。
Riders per day, time saved (rule of half × the model's values of time × 300 days), cars, carbon (road + traction), capital and operating cost, station-area land value, 40-year NPV at 4 % and payback, each with its confidence tier.

**可信度 / Confidence**: 造价、运营费、碳排、拥挤、分流等单价现在是示意值（D 级，`model/registry/data_tiers.toml` 里的 `provisional`），结果**仅供参考、学习**；任务 44 调研回来后替换。Unit costs, operating cost, carbon, crowding and route-split values are placeholders (tier D) — results are for reference and learning only until task 44 replaces them.

## 地图上帮人看懂数据的东西 / What helps the public read the data (`engine/places.py`)

- 人口、岗位、离港铁远的人三张热力图：每个分区的人口 / 岗位按规划署 10 米土地用途格网摊到住宅 / 工商楼宇上，再汇成 50 米格。Heat maps of residents, jobs and people over 800 m from the MTR (zone totals spread over the zone's homes / workplaces on the 10 m land-use grid).
- 主要人流：早高峰公交「人多又走得远」的区与区之间人流（人数 × 距离排前 12）。Main flows: the 12 district pairs with the most peak public-transport travellers × distance.
- 站点卡：任一点 800 米内住多少人、多少岗位，和 97 个现有港铁站比打 A–D 等级，说「跟哪个站差不多」。Station card: residents and jobs within 800 m, graded A–D against the 97 existing stations, "similar to station X".

## 文件 / Files

| 文件 / File | 是什么 / What |
|---|---|
| `api.py` | `/game/api/*`：boot、probe（站点卡）、segment（线段过海/穿山判断）、layer（热力图 PNG）、run + job（后台排队计算、逐轮进度） |
| `engine/params.py` | 从可信度登记表读参数和等级 / parameters and tiers from the registry |
| `engine/base.py` | 一次载入基准模型 / loads the base model once |
| `engine/network.py` | 线、站、造价、新走法时间 / lines, stations, cost, new door-to-door times |
| `engine/transit.py` | 新线客流和拥挤 / riders and crowding |
| `engine/road.py` | 路网增量分配 / incremental road assignment |
| `engine/scenario.py` | 情境题和站旁开发 / scenarios and station-area development |
| `engine/run.py` | 一次完整计算 / one full run |
| `engine/evaluate.py` | 账本、原因卡、情境题打分 / ledger, reasons, scenario score |
| `engine/missions.py` | 自动出题、快算、分步得分、政府方案基准 / generated missions, quick estimate, step scoring, government benchmarks |
| `../game-ui/` | 网页（Leaflet，地政总署底图）/ the page |

截图检查 / Screenshot check: 先启动后端到 8010 端口，再 `cd frontend; node scripts/check-game.mjs map-check/game`。
Start the backend on port 8010, then run the script above.
