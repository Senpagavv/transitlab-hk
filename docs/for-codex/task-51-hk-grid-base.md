# 任务 51：全港格子底板——把全港模型铺成游戏的格子（四种流量）

> 第五关「全港沙盘」三份任务之一（51 底板 → 52 沙盘引擎和页面、53 切关卡；Claude 做 AI 工作流和整合）。
> **本任务定下的数据格式是 52、53 共用的接口**，字段名照第四节写，不要自己改名；要加字段可以，写进说明。
> 分工（发起人 2026-10-14 定）：Codex 先做「大差不差」的一版，Claude 审、调、验收、提交。

## 一、背景
发起人要第五关是**全港沙盘**：用全港模型（`F:\transitlab-hk` 的 `data/model`，就是「实时地图」「修地铁 demo」背后的那个四阶段模型），铺成前几关那种**像素画风的格子**，车站、路、屋苑都落在格子上；整张图按前几关的规则一轮一轮跑（任务 52）。
关卡则从全港图里**切一片**（位置不变），由 AI 按一句话改人口 / 岗位 / 路，变成关卡（任务 53 + Claude）。
四种流量各做一个底板：**早高峰、晚高峰、平日日常、节假日**，界面上用不同底色区分。

## 二、硬规矩（违反作废）
1. **项目只读**：`F:\transitlab-hk` 可以读、可以 `uv run python` 运行、可以 import `game.engine`，但不写、不改、不删；不运行 `pipeline/` 下的脚本；不做 git 操作；不联网取数据。
2. **只写**：`%USERPROFILE%\Desktop\TransitLab五模式-Codex\任务51\`（脚本、输出、说明都放这里）。
3. **不编造**：每个数从项目数据算出来；做不到的写「做不到 / 缺什么」；推算的（尤其节假日）标 D 级并写清假设。
4. 交回时写 `任务51\说明.md`：怎么算的、每个字段来源和可信度（A–D）、核对结果、没做完 / 拿不准的。

## 三、数据从哪来（都只读）
- 读法参考 `docs/for-codex/task-48-desire-map.md` 第三节、`game/engine/base.py`（`get_base()`：`b.ids`、`b.peak0`、`b.cost22`、`b.car_skim0`、`b.stations`、`_stations()` 的站序读法）、`game/engine/places.py`（人口 / 岗位已经摊到 50 米格、`pl.zones` 有名字和区）。
- 分区中心 `data/model/zone-centres.parquet`（HK1980 `x,y`）；分区边界 `data/web/zones-2026.geojson`；人口岗位 `data/model/trip-ends-2026.parquet`、`landuse-2026.parquet`。
- 路：`data/model/road-links.parquet`（`road_class`、`lanes_ab/ba`、`capacity_ab/ba_veh_hr`、`street`）+ `road-nodes.parquet`；早高峰负荷 `assignment-am-2026.parquet`（`road_link, side, car, taxi, bus, total, capacity, vc`）；逐小时车速 `road-speeds-hourly.parquet`（`link_id, side, hour, speed`）。
- 港铁：`b.stations`、`data/model/transit-assignment-am-2026.parquet`（`line, from_station, to_station, per_hour, capacity, load_factor`）。
- 出行：早高峰 `am-peak-2026.npz`（`P_PV / P_TAXI / P_PT / P_SPB`，人 / 小时）；全天按目的 × 方式 `mode-split-2026.npz`（`T_HBW_PV` 等）；时段系数在 `pipeline/20_behaviour_parameters.py`、`pipeline/24_peak_hour.py` 里（只读，照它的数用，不要运行）；门到门分钟 `skim-active-transit.npz`（`transit_min`、`walk_min`）、`skim-car-am-delay.npz`、`b.car_skim0`。
- 地用 / 地形：`land-utilization-2024.parquet`、`zoning-capacity.parquet`、`places.py` 用的规划署土地用途格网。

## 四、输出格式（52、53 照这个读）
全部写到 `任务51\out\`，UTF-8 JSON，数字取整或 1 位小数（控制大小）。

### 1. `hk-base.json`（几何，四种流量共用）
```jsonc
{
  "version": 1,
  "cell_m": 400,
  "x0": 800000, "y_top": 850000,          // HK1980：第 c 列第 r 行格子中心 = (x0 + (c+0.5)*400, y_top - (r+0.5)*400)
  "cols": 150, "rows": 113,               // 可按实际范围微调，写进说明
  "land": "~~~~^^rr...",                  // rows*cols 个字符，一行接一行：~ 海  w 河/水塘  ^ 郊野公园/山  g 绿地/休憩  r 住宅  c 商业  i 工业  m 混合  p 港口/机场/口岸  o 其他已建  . 空地/农地
  "cells": [[c, r, pop, jobs], ...],      // 只列有人或有岗位的格（人口、岗位按 50 米格汇总）
  "zones": [{"id": "286.2", "name": "啟德", "hans": "启德", "en": "Kai Tak", "district": "九龍城",
             "cell": [c, r],              // 按人口（没人就按岗位）加权的代表格
             "pop": 84141, "jobs": 12000, "cbd": 0}],   // cbd：0 一般 / 1 市区 / 2 核心商业区（泊车难，开车多算格）
  "stations": [{"id": "KOB", "name": "九龍灣", "hans": "九龙湾", "en": "Kowloon Bay", "cell": [c, r], "xy": [x, y], "lines": ["KTL"], "zone": "280.1"}],
  "lines": [{"id": "KTL", "name": "觀塘綫", "hans": "观塘线", "en": "Kwun Tong Line", "color": "#1E9A4A",
             "stations": ["WHA", "HOM", ...],          // 按顺序
             "cells": [[c, r], ...],                    // 经过各站格子的 4 连通折线（每步上下左右一格）
             "trains_per_hour": 30, "cap_per_hour": 75000}],
  "roads": [{"id": 12, "name": "觀塘繞道", "hans": "观塘绕道", "en": "Kwun Tong Bypass", "class": "expressway",
             "cells": [[c, r], ...], "tunnel": false, "toll": 0}],     // 4 连通折线
  "sections": [{"id": 0, "a": [c, r], "b": [c, r], "road": 12, "cap": 4200,   // 相邻两格之间的一段路；cap＝两个方向里大的那个（车 / 小时）
                "am": {"load": 3900, "vc": 0.93}}],                          // 早高峰负荷（大的那个方向）；其他时段在各自的 demand 文件
  "areas": [{"key": "kowloon-east", "name": "九龍東", "hans": "九龙东", "center": "觀塘", "box": [c0, r0, c1, r1]}],  // 见第五节
  "sources": {"...": "..."}, "tiers": {"...": "A|B|C|D"}
}
```
- 站：同一格挤了两个站时，后一个挪到最近的空格（不压海），保持线上顺序；`xy` 留真实坐标。只做重铁（含机场快线），轻铁先不做（写进说明）。
- 路：只要 `road_class` 为快速路 / 主干路 / 一级道路（市区可以加次干路，控制总段数在 ~4000 以内）；把路段几何落到格子上，连成 4 连通折线；**断开的要在路口接上**（格子相邻或同格即连通）。名字用中文（`street` 是英文就查对照，查不到写英文并在说明列出）。
- 线的颜色用港铁官方色。

### 2. `hk-demand-<period>.json`（`period` = `am` / `pm` / `day` / `holiday`）
```jsonc
{
  "period": "am", "label": "早高峰", "hans": "早高峰", "en": "AM peak", "hours": "平日 08:00–09:00", "tier": "B",
  "theme": {"paper": "#EEF3F8", "ink": "#2B3A4A", "accent": "#2F6FD6"},   // 见下
  "zones": ["286.2", ...],                     // 顺序 = 下面的下标
  "pairs": [[i, j, car, pt, carMin, ptMin, walkMin], ...],   // 只列 car+pt ≥ 1 人/小时 的分区对；car = 私家车+的士（人），pt = 公共交通（人）；分钟取整
  "sections": [[sectionId, load, vc], ...],    // 这个时段每段路的负荷（am 与 hk-base 相同）
  "lines": [[lineId, fromStation, toStation, perHour, cap], ...],   // 这个时段港铁每段载客
  "checks": {"car_share": 0.18, "pt_share": 0.78, "by_district": [...], "top_vc": [...]}
}
```
- **am**：直接用模型（`am-peak-2026.npz` + 早高峰分配），可信度最高。
- **pm**（平日 18:00–19:00）：全天按目的 × 方式的出行，乘时段系数（上班 / 上学的回程＝转置）；路的负荷按逐小时车速 / 普查晚高峰流量核对或缩放。写清系数。
- **day**（平日日常，取 11:00–12:00 或平峰平均一小时）：同上，平峰系数；上班少、其他目的多。
- **holiday**（节假日大流量）：模型没有，D 级推算——以 `HBO`（其他目的）为主，去处加权到商业 / 购物、郊野公园 / 海滩、主题乐园、口岸；总量按 `td-digest-series.json` 里港铁日客量的高低月份或你能在项目里找到的依据定倍数；全部假设写进说明。
- 四种底色（可微调）：am 晨蓝 `#EEF3F8`、pm 黄昏橙 `#F8EEE2`、day 白纸 `#F7F5EF`、holiday 红金 `#FBEDEA`（accent 用 `#C8102E` / 金 `#C9A227`）。
- 优先级：**am 第一**（52、53 等着用），pm / day 第二，holiday 第三。

## 五、切图用的片区（`areas`）
每片默认 16 × 12 格（6.4 × 4.8 公里），以中心站的格子为中心，不出全图；可以按地形微调并写进说明：
九龍東（觀塘）、啟德（啟德）、旺角·油尖旺（旺角）、尖沙咀（尖沙咀）、中環·金鐘（金鐘）、銅鑼灣·灣仔（銅鑼灣）、深水埗·長沙灣（長沙灣）、紅磡·何文田（紅磡）、荃灣·葵青（荃灣）、沙田·大圍（沙田）、馬鞍山（馬鞍山）、大埔（大埔墟）、粉嶺·上水（粉嶺）、元朗（元朗）、天水圍·洪水橋（天水圍）、屯門（屯門）、將軍澳（將軍澳）、東涌（東涌）、港島南（黃竹坑）、北部都會區·新田古洞（落馬洲）。
`key` 用英文短横线（如 `kowloon-east`、`northern-metropolis`）。

## 六、查看页 `out\viewer.html`（只为核对数据，简单就好）
双击能开（数据用 `<script>` 内嵌或同目录 JSON + 说明怎么开）；画风参考 `game-feeder/v7/mode3-roads/ui.js` 的 `drawBase`（点纸、海、树丛、像素房子、淡色路带、港铁官方色）。能平移、缩放；图层开关：地形 / 人口 / 岗位 / 路（按 v/c 着色）/ 港铁；四种流量切换（换底色和路的颜色）；指着一格显示分区、人口、岗位。把 20 个片区的框画出来。

## 七、核对（写进说明）
- 全港人口、岗位合计 = 模型合计（差 < 1%）。
- am：各区开车 / 公交比例（与模型对照表）；`sections` 里 v/c 最高的 15 段，和模型 `assignment-am-2026` v/c 最高的路名对照。
- 站数（应 ~97，写清楚）、每条线站序与真实一致、挪了格的站列表。
- 路：段数、连通块个数（应该基本一个大块 + 离岛）。
- 文件大小（每个 JSON 尽量 < 5 MB）。

## 八、优先顺序（时间不够就从上往下做，做到哪写到哪）
1 `hk-base.json` + `hk-demand-am.json`（先交一版给 52、53 用，放在 `out\` 就行）→ 2 核对 → 3 查看页 → 4 `pm` / `day` → 5 `holiday`。
脚本都放 `任务51\scripts\`，Claude 会把它们搬进项目 `game-feeder/tools/hk-grid/` 以便重算。
