# 游戏 v2：有目标、有反馈 / Game v2: goals and feedback

> 状态：2026-10-02 和发起人讨论后定稿；取代 `game-rules-v1.md` 里「一次画完、一次算完」的流程。
> Status: agreed with the project lead on 2026-10-02; replaces the "draw once, compute once" flow of `game-rules-v1.md`.

## 为什么改 / Why

第一版 demo 玩起来没意思：画几条线 → 等 25 秒 → 一张报表 → 结束。中间没有反馈、没有目标、没有压力、没有奖励。
参考的游戏（Mini Metro、Mini Motorways、天际线、Poly Bridge、Subway Builder、NIMBY Rails、A/B Street）的共同点：**每 30–90 秒一个小反馈，每 10–15 分钟一个里程碑**；目标清楚；失败快、能马上再试；看得见「人」。
没有目标的 NIMBY Rails 只有铁路迷玩得下去——就是我们第一版的问题。

The first demo was dull: draw → wait 25 s → a report → done. The reference games share **small feedback every 30–90 s and a milestone every 10–15 min**, clear goals, quick failure and retry, and visible people. NIMBY Rails (no objectives) only works for enthusiasts — our first version's problem.

关键技术事实 / Key fact: 只算「新线客流」一步只要 **0.03 秒**（完整模型 25 秒）。所以每点一个站都能立刻出数字；完整模型留作「通车日结算」。
The transit-only estimate takes **0.03 s** (full model 25 s): instant numbers on every click; the full model becomes the "opening day" reveal.

## 三种玩法（按时长）/ Three ways to play (by length)

| 时长 / Length | 玩法 / Mode | 先后 / Order |
|---|---|---|
| 5 分钟 | **出题模式**：每日一题 + 题库，分步得分，和政府方案比 / Missions: daily + library, step scoring, vs the government plan | **第一期（10/18 前）** |
| 10–15 分钟 | **实时经营**：2026→2046 快进，人越来越多，太挤会倒计时，每年挑一个升级；两张图——现有港铁上加线、空白香港从零修（最后和真实港铁比），两张图各有自己的取胜方式（待定）/ Real-time management, two maps with their own win conditions (TBD) | 第二期 |
| 30 分钟 | **限时 / 课堂模式**：老师选题，各组比分，可展开四阶段白盒 / Timed / classroom | 第三期 |

## 出题模式 / Missions

**题目不手写，由数据自动生成**（只写模板）/ Generated from data, not hand-written:
1. **通勤题 / Commute**：模型里找「早高峰坐公交人多、时间又特别长」的区→区人流，给预算，目标是平均少 X 分钟。
2. **政府方案题 / Beat the government**：Codex 整理的政府规划铁路（`data/raw/planned-railways/`），先用完整模型把政府方案算一遍当标准答案；同样的造价单价，看谁的客流、省时、净收益更好。
3. **发展题 / Growth**：北都入伙等真实发展区多了 X 万人（现有「北都人口大增」）。

**一道题拆成多步，每步有指引和分数** / Each mission is a chain of steps with hints and points:

| 步骤 / Step | 分 / Pts | 怎么判 / Check |
|---|---|---|
| ① 看清问题：打开热力图或点问题区 | 5 | 前端 |
| ② 第一个站放在 A/B 级位置 | 10 | 站点卡等级 |
| ③ 接上现有港铁（换乘站） | 10 | 150 米内有现有站 |
| ④ 目标进度条（即时估算） | 30 | 0.03 秒快算，按比例给分 |
| ⑤ 不超预算 | 10 | 造价 |
| ⑥ 站旁开发（铁路 + 物业） | 5 | 选了开发 |
| ⑦ 通车日结算：完整模型确认达标 | 10 | 完整模型 |
| ⑧ 账算得过来（效益/成本） | 10 | 完整模型 |
| ⑨ 打败政府方案（没有就比每公里客流） | 10 | 完整模型 vs 基准 |

三颗星 / Stars：★ 达标 ★ 不超预算 ★ 打败政府方案。

**即时反馈 / Instant feedback**：每点一站跳「+X 人/天」；接上现有港铁跳「网络效应！客流 ×N」；预算条、分数滚动；线上有列车和乘客小点在跑，挤的段变红；挑模型里真实的通勤人流配上虚构人物说话（「陈太，住天水围、在观塘返工：以前 78 分钟，现在 61 分钟」——人物虚构，人数和时间是模型算的）。

## 真实和好玩怎么兼顾 / Real and fun

数是真的，时间是快进的：需求、时间、造价都来自模型（带 A–D 可信度）；游戏只压缩时间、简化运营。即时数字是快算（只算新线客流），结算用完整模型；两者差别会显示出来（「快算 vs 完整模型」）。
Numbers are real, time is compressed; instant numbers are the fast estimate, the reveal is the full model, and the gap is shown.

## 待定 / Open

- 实时经营两张图各自的取胜方式（发起人：两种模式各有一种取胜方式）/ Win conditions of the two real-time maps.
- 政府方案题里政府路线是开局就显示（虚线参考），还是交卷后才揭晓 / Show the government line from the start or only at the reveal.
