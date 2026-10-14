# 任务 53：从全港底板切出关卡（位置不变）+ 机器人验收

> 第五关「全港沙盘」三份任务之一（51 底板、52 沙盘、**53 切关卡**；Claude 做 AI 工作流和整合）。
> 数据格式见 `task-51-hk-grid-base.md` 第四节。51 先交 `hk-base.json` + `hk-demand-am.json`（在 `Desktop\TransitLab五模式-Codex\任务51\out\`）；还没出来时先按格式写代码，拿手工的九龙东关卡（`v7/mode3-roads/data.js`）做对照目标。
> 分工（发起人 2026-10-14 定）：Codex 先做「大差不差」的一版，Claude 审、调、验收、提交。

## 一、要什么
发起人：真实地图本身没有「要解决的问题」，所以关卡＝**从全港图里把一片切出来（位置不变）＋改一些地方的人口 / 岗位 / 路**。改什么由 AI 按一句话决定（Claude 做 AI 那一段），**你做的是：拿到「切哪片 + 改什么」→ 生成一关能玩的关卡 → 机器人验收定门槛**。
九龙东那关（`mode3-roads/data.js`，注释里有每个数怎么从模型来的）是 Claude 手工这样做的；这个任务把手工变成程序。生成的关卡格式**就是 `mode3-roads/data.js` 里 `KE` 那个对象的格式**，所以第三关的引擎和页面能直接玩（引擎已有 `D.use(关卡)`）。

## 二、硬规矩（违反作废）
1. **项目只读**：`F:\transitlab-hk` 可以读、可以 `node` 运行，但不写、不改、不删；不做 git 操作。
2. **在复制里改**：把 `F:\transitlab-hk\game-feeder\v7\` 和 `...\bots\` 复制到 `%USERPROFILE%\Desktop\TransitLab五模式-Codex\任务53\game-feeder\`；**只新建** `v7/shared/levelgen/**` 和 `bots/v7_levelgen.js`。`mode3-roads/` 不改（任务 49 在改）——在第三关里打开生成关卡的那几行接口，写在说明里，Claude 整合。
3. `levelgen` 的代码浏览器和 Node 都能跑（同 `engine.js` 的写法：`(function(root){...})(typeof window!=='undefined'?window:globalThis)` + `module.exports`），不碰 DOM（预览页除外）。
4. 交回时写 `任务53\说明.md`：切法、每个数的来源、对照结果、机器人结果（贴命令和输出）、没做完的。

## 三、输入：「关卡请求」（AI 会产出这个，Claude 负责）
```jsonc
{
  "area": "kowloon-east",          // hk-base.json 的 areas[].key
  "period": "am",                  // am | pm | day | holiday（第一版先保证 am；pm 是下班回家，起点终点对调，第二版）
  "mode": 3,                       // 第一版只做 3（地铁 + 路）；2、4 第二版
  "changes": [                     // 0–4 条
    {"place": "啟德", "what": "people", "pct": 50, "by_year": 4},     // what: people | jobs | road_cap；pct −50…+150；by_year 可省（省＝第 0 年就是）
    {"place": "觀塘繞道", "what": "road_cap", "pct": -30}
  ],
  "title": "啟德再多五萬人", "story": ["……", "……"]
}
```
`place` 按名字找关卡里的屋苑 / 去处 / 路（繁简都认，找不到就找最近的同类）；找不到的放进输出的 `problems`。

## 四、切法（`levelgen/cut.js`：`cut(base, demand, request) → {level, problems, notes}`）
照九龙东手工关卡的做法（看 `mode3-roads/data.js` 注释）：
1. **范围**：`areas[].box`（16 × 12 格），格子坐标减去左上角＝关卡坐标；海 / 水塘格子进 `water`。
2. **屋苑（`origins`，最多 6 个）**：框里住人的分区，按代表格相距 ≤ 2 格合并成团，取人最多的 6 团；名字用团里人最多的分区名（繁 + 简）；`cell`＝团的人口加权格（不压海、不压路口也行）；`house` 朝向随便给一个不出界的方向。
3. **去处（`destinations`，最多 3 个）**：框里岗位最多的 2 团（am、day 看岗位，holiday 看商业 / 休闲，写清楚）＋ 1 个**出口**（框外最大的去向，放在框边上对应方向的格子，名字如「往九龍」「往港島」，`kind:"gate"`）。
   - `attraction`＝16 + 岗位 ÷ 15,000（同九龙东；出口按出框人数折算，写清楚）；`carExtra`：`cbd` 2 → 4、1 → 3、0 → 2。
4. **人数**：每个屋苑的 `people`＝它去这几个去处（含出口）的出行人数（`pairs` 的 car + pt）× 缩放，缩放让全关合计 ≈ 300（同九龙东量级）；缩放系数写进 `level.source.scale`。
5. **路（`roads`）**：框里的路段按 `road` 归成路，`via` 用格子折线（`expand()` 能吃相邻格子）；`cap`＝模型容量 × 同一个缩放 × 一个系数，**让框里「什么都不做」的 v/c 排名和模型 am 的 v/c 排名大致一致**；去掉孤立的短路头；保证屋苑、去处 1 格内能上路（同第三关的 `reach 1`）。
6. **老线（`lines`）**：框里的港铁线段，站名真名、官方色，`trains` 默认 3。
7. **改动**：`changes` 按比例改 `people` / `attraction`（jobs 按 attraction 公式换算）/ 路的 `cap`；有 `by_year` 的写成 `grow:[[0, 原值], [by_year, 新值]]`（任务 49 在给第三关加 `grow`，字段名照这个）。
8. **其他参数**照九龙东：`walkPer 3, wait 2, lineCost 1, stationCost 3, trainCost 4, perTrain 40, budget 30, years 8, crowdBlocks 4, aware {start .2, spread 2}, nearby 10, stay 40, learn .3`。
9. `level.title`、`level.story` 来自请求；`level.source`＝`{area, period, box, scale, changes}`。

## 五、验收（`levelgen/check.js` + `levelgen/bot.js`）
1. 用第三关引擎（`mode3-roads/engine.js` 的 `D.use(level)` + `reset()`）跑「什么都不做」：塞车 > 0；逐年不来回跳（相邻两年差 < 10%）。
2. **机器人**：照 `bots/v7_roads.js` 的局部搜索，加时间上限（默认 20 秒，可调），找最好方案。
3. **门槛**：`tiers`＝最好分 × (0.40, 0.65, 0.88)，取整。
4. **不合格的原因码**（放 `problems`，Claude 会把它回给 AI 改）：`too_easy`（不建也有很多分 / 随便一条线就到大师）、`nothing_to_solve`（最好分太小，路不塞）、`unreachable`（屋苑上不了路 / 没有站能到）、`place_not_found`、`box_empty`。
5. 输出 `{level, report:{doNothing, best, bestPlan, tiers, seconds}, problems}`。

## 六、命令行和预览
- `node bots/v7_levelgen.js --base <hk-base.json> --demand <hk-demand-am.json> --area kowloon-east [--request req.json] [--seconds 20] [--out level.json]`
- **对照**：`--area kowloon-east`、不改，生成的关卡和手工九龙东比：屋苑 / 去处名字对上几个、人数比例、路名、什么都不做的塞车排名、机器人最好分——打印对照表写进说明（不要求一样，要求同一个量级、同一种「哪里塞」）。
- 再切 3 片（建议：沙田·大圍、元朗、銅鑼灣·灣仔），各一个请求（自己写一句，如「沙田多三万人」），打印结果。
- `levelgen/preview.html`：选片区、填请求 JSON → 切 → 小地图预览 + 关卡 JSON + 验收结果；按钮「在第三关打开」把关卡放进 `localStorage['tl-gen-level']` 并打开 `../../mode3-roads/index.html#gen`（第三关那边读取的几行由 Claude 加，写进说明里给出你建议的代码）。

## 七、优先顺序（时间不够就从上往下做，做到哪写到哪）
1 `cut.js` + 九龙东对照 → 2 `check.js` + `bot.js` + 门槛 → 3 命令行 + 另外 3 片 → 4 预览页 → 5 mode 2 / 4、pm。
