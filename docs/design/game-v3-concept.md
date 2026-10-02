# 游戏 v3 整体思路（草案）/ Game v3 concept (draft)

> 2026-10-02 发起人试玩 v2 后的意见整理成的方向，**待发起人从地图样式和事件库里挑选后再细化**。取代 v2 的「规划顾问一步一步点」。
> Direction after the lead played v2; to be refined once the lead picks a map style and events. Replaces v2's step-by-step advisor.

## 一句话 / One line
**城市出了大事，你用铁路和车站（加站旁开发，TOD）在限时内化解。** 地图一眼看出问题在哪、人往哪走、哪里挤、哪里堵；放一个站，马上看到人流改道、堵点转移；一个站不够（会堵），要多站分流、找平衡；满意了交卷，按多个维度打分上榜。
*A big event hits the city; you defuse it within a time limit with lines and stations (TOD). The map shows the problem at a glance; every station visibly reroutes people and moves the bottleneck; one station jams, so you balance several; submit when satisfied, scored on several dimensions with leaderboards.*

## v2 的问题（发起人原话要点）/ What was wrong with v2
1. 看不到数据：人口、岗位、人流都要自己去开图层。**地图本身就要把数据讲清楚，而且不乱，不用玩家去调开关。**
2. 指引太细，像「连线游戏」；目标和玩法开场没讲清楚。
3. 看到地图想不到第一步怎么做；不知道车站怎么影响问题。

## 三根柱子 / Three pillars

### 1. 一张会说话的地图（不用开关）/ A map that speaks for itself
同一张图上同时看到：人住在哪、在哪上班（底色）；人往哪走（流动的小点沿着人流方向跑）；哪里挤、哪里堵（红色）；问题在哪（事件热点图标）。
缩小看全景（几十个「生活圈」大区 + 粗箭头），放大看细节（分区、车站、每段多挤）。
**具体样式不由我拍板**：Codex 任务 46 先做 6 版不同的画法（点密度、六边形分级、重新划分的大区、只画问题、通勤时间着色、组合版），发起人挑 1–2 版，再做进游戏。

### 2. 大事件 + 时间压缩 / Events with compressed time
每局一个事件：一个清楚的问题、一个目标、一个时限。现实里要十年二十年的规划，在极端情况下几分钟内做完。
例：某区「吸血鬼爆发」，12 万人要在 30 分钟（游戏时间）内转移出去——只修一个站会堵在那个站，转移变慢，所以要几个站分流、和现有线路配合；还有演唱会散场、台风后某线停运、新城入伙、跨境大潮等。
虚构事件明确标「虚构」，但人数、路网、站的容量都用真实数据。事件库由 Codex 任务 47 先整理（每个事件：发生在哪、多少人、多长时间、改变了什么、为什么一个站不够）。

### 3. 自由解题 + 即时模拟 + 多维评分 / Free solving, live simulation, multi-score
不再一步一步指引：开场一张「事件简报」讲清楚发生了什么、目标是什么、怎么算赢；提示只在玩家要时给。
放站 → 小点立刻改道 → 新的瓶颈冒出来（站挤、线挤、路堵）→ 再调整。现有 0.1 秒快算加上新做的「限时人流」排队模拟（站的进出闸和月台容量、列车运力、排队时间）。
交卷后按维度打分：**速度**（多快转移完 / 通勤省多少）、**花费**、**拥挤**（最挤处排队多久）、**公平**（有没有地方被落下）、**环保**；每个维度一个榜，再加总榜。

## 时长 / Length
事件 5–10 分钟一局；课堂 / 限时模式 30 分钟（老师选事件，各组比）。

## 分工 / Who does what
| 工作 | 谁 |
|---|---|
| 地图样式 6 版样稿（用真实数据，静态网页 + 截图）| Codex 任务 46 |
| 大事件库（10–12 个事件、数量依据、目标、评分维度）| Codex 任务 47 |
| 限时人流 / 疏散的排队模拟引擎 | Claude（发起人挑完后）|
| 把选中的地图样式做进游戏、事件简报、多维评分和排行 | Claude |
| 从 6 版里挑 1–2 版；从事件库挑 3 个先做 | 发起人 |
