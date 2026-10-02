# 任务 46：游戏地图的 6 种画法样稿（让发起人挑）

## 一、背景
TransitLab HK 的修地铁游戏（`game/`、`game-ui/`）要改成「大事件 + 限时化解」（见 `docs/design/game-v3-concept.md`）。
发起人试玩后最大的意见：**地图本身看不出问题**——人口、岗位、人流都要玩家自己去开图层开关。他要的是：
**一打开地图，不用调任何开关，一眼就能看出：人住在哪、在哪上班、人往哪走、哪里挤 / 哪里堵、哪里分配不均；看完能想到第一个站该放哪。而且不能乱。**
你要用项目里的真实数据，做 **6 种不同画法的静态样稿**，让他挑 1–2 种。

## 二、硬规矩（违反作废）
1. **项目只读**：`F:\transitlab-hk` 里不写、不改、不删任何文件（可以读、可以 import 运行）。
2. **只写一个目录**：`%USERPROFILE%\Desktop\TransitLab地图样式\`（不存在就创建）。
3. **不调用任何政府接口**（数据全在项目里）；底图可以用地政总署瓦片（`https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/WGS84/{z}/{x}/{y}.png`，浏览时正常加载即可），也可以不用底图。
4. **不编造数据**：所有数字从下面的文件算；做不到的效果写「做不到 / 需要什么数据」，不要用假数据凑。
5. 每个样稿是**双击就能打开的单个 HTML**（数据嵌在同目录的 `.js` 里），地图库用项目里的 `game-ui/vendor/leaflet.js`（复制过去），或从 cdnjs / unpkg 加载 MapLibre / deck.gl。

## 三、数据在哪（全部只读）
用项目的 Python 环境：在 `F:\transitlab-hk` 里 `uv run python 你的脚本.py`（脚本放在桌面输出目录里）。
最省事的办法是直接 import 游戏引擎（只读，不会写文件）：
```python
import sys; sys.path.insert(0, r"F:\transitlab-hk")
from game.engine.base import get_base      # 约 8 秒
from game.engine.places import get_places  # 约 1 秒
b, pl = get_base(), get_places()
```
| 要什么 | 在哪 |
|---|---|
| 455 个分区的边界、名字、区、人口、岗位、密度 | `data/web/zones-2026.geojson`（属性 `zone, label, district, population, jobs, density, jobs_density …`）|
| 住的人 / 岗位在 50 米格上的分布（按土地用途格网摊到住宅、工商楼宇）| `pl.pop`、`pl.jobs`（二维数组，HK1980 坐标 2326，左上角 `pl.x0, pl.y1`，格 50 米）；`pl.near_rail`＝离港铁站 800 米内 |
| 早高峰 8–9 点分区到分区的人数（坐公交 / 开车）| `b.peak0["P_PT"]`、`b.peak0["P_PV"]`（470×470，顺序 `b.ids`，前 455 个是分区，后 15 个是口岸）；或 `data/model/am-peak-2026.npz` |
| 坐公交门到门分钟数 | `b.cost22`（470×470）|
| 道路早高峰车流 / 通行能力（堵不堵）| `data/model/assignment-am-2026.parquet`（`road_link, side, total, capacity, vc`）+ `road-links.parquet`（`a_node, b_node`）+ `road-nodes.parquet`（节点坐标）|
| 港铁每段早高峰多挤 | `data/model/transit-assignment-am-2026.parquet`（`line, from_station, to_station, per_hour, capacity, load_factor`）；站坐标 `b.stations`（`id, name_en, lon, lat, lines`），中文站名 `pl.existing` |
| 分区中心经纬度 | `b.zone_lon, b.zone_lat`（455）|
| 坐标转换 | `b.to_ll.transform(x, y)`（HK1980→经纬度），`b.to_grid` 反过来 |

## 四、6 种画法（每种一个 HTML）
每种都要同时回答 **5 个问题**：①人住在哪 ②在哪上班 ③人往哪走 ④哪里挤 / 堵 ⑤哪里不均（职住失衡、离港铁远）。不需要按任何开关就能看到；可以有一个小图例。
1. **点密度**：1 个暖色点 = N 个居民，1 个冷色点 = N 个岗位（点撒在真实的住宅 / 工商格子上）；人流用沿曲线**流动的小点**（动画）表示，越多人越密；港铁挤的段、堵的路标红。
2. **六边形分级**：500 米六边形，颜色 = 人口 + 岗位分级（或双色），描边 / 小图标表示职住比；缩小时自动合并成大六边形；人流箭头只画最主要的 15 条。
3. **重新划分的「生活圈」大区**：把 455 个分区合成 25–40 个看得懂的大区（按 18 区再拆新市镇，例如天水围、屯门、将军澳、东涌），每个大区一个圆（大小 = 人口，颜色 = 职住比），大区之间画粗箭头（早高峰坐公交的人）；放大到 13 级以上才显示分区细节。
4. **只画问题**：背景淡化成灰，只突出问题——最挤的港铁段（红色粗线 + 载客率）、最堵的路（红）、通勤最久的人群（红色光斑，按人数 × 分钟）、离港铁远的大屋苑（橙色图标）；每个问题旁边一句话说明（例如「东铁 大围→九龙塘 早高峰 137% 载客率」）。
5. **通勤时间着色**：每个分区按「早高峰坐公交到主要就业中心（中环 / 尖沙咀 / 观塘等，按岗位加权）的平均分钟数」着色，越久越红；叠加人口点；让人一眼看出「谁上班最远」。
6. **组合版（你认为最好的）**：综合以上，给出你觉得**一眼看懂又不乱**的版本，并说明取舍。

## 五、产出（`%USERPROFILE%\Desktop\TransitLab地图样式\`）
| 文件 | 内容 |
|---|---|
| `v1-点密度.html` … `v6-组合版.html` | 6 个样稿，双击打开 |
| `index.html` | 一页并排展示 6 张截图，点击进入对应样稿 |
| `screenshots/` | 每个样稿 2 张截图：全港（缩放 11）和放大一处（缩放 14，建议元朗 / 天水围或观塘）|
| `说明.md` | 每版一段：画了什么、怎么读、优点、缺点、在哪个缩放级别会乱、数据来自哪些文件 |
| `build_*.py` | 生成数据的脚本（放这里，不放进项目）|

截图可以用项目里的 Playwright：`cd F:\transitlab-hk\frontend; node 你的截图脚本.mjs`（脚本放桌面目录，Edge 浏览器 `channel: 'msedge'`，参考 `frontend/scripts/check-game.mjs`）。

## 六、完成后
回复一句话：做了几版、哪版你最推荐、有哪些效果因为数据不够没做到。
