# 任务 59：AI 出关卡扩展到第二关、第四关（第三关顺便精简道路）

> P1（决赛前要）。分工：Codex 做，Claude 最后审、真跑 AI、真鼠标验收、提交。

## 一、最终要的是什么
沙盘的「AI 出關卡」：玩家写一句话（如「东涌东要卖地建新屋苑」「将军澳南想修一条地铁」），AI 选片区、时段、改动，浏览器里切出一关、机器人定门槛，然后**用合适的玩法打开**。现在只能出第三关（地铁 + 路会塞），发起人试了发现「只给我第三关」。要能出**第二关（地铁）**和**第四关（地铁 + 站旁开发）**；第三关切出来的路太多（42–78 条），要用任务 57 的走廊精简。

现在的链条（都已接通，Claude 2026-10-15 做，v7.27）：
`mode5-sandbox/ai-level.js`（沙盘面板）→ `ai/client.js`（`TLAI.generate`，问 AI；不合格把原因交回 AI 再试一次）→ `backend/feeder_ai.py`（DeepSeek，菜单约束 + 校验，**MODES = {3}**）→ `shared/levelgen/worker.js`（`cut.js` 切 → `check.js` 校准道路 → `bot.js` 15 秒找最好 → `check.js` 定门槛）→ `TLPack.save` 存本次网页的关卡包 → `mode3-roads/index.html#pack=<id>`。
第二、四关的页面已经能读 `#pack=`（`data.js`），只差关卡本身。

## 二、硬规矩
1. 项目只读，不做 git。复制 `F:\transitlab-hk\` 里要用的部分到 `%USERPROFILE%\Desktop\TransitLab五模式-Codex\任务59\`，交回增量包。
2. 只许改/新建：`game-feeder/v7/shared/levelgen/**`（新文件 + `worker.js`）、`game-feeder/v7/mode5-sandbox/ai-level.js`、`game-feeder/v7/ai/client.js`、`game-feeder/v7/ai/test-sentences.json`、`backend/feeder_ai.py`、`backend/test_feeder_ai.py`、`game-feeder/bots/v7_levelgen.js`、新的 `game-feeder/bots/v7_levelgen_*.js`。**规则引擎（各玩法 `engine.js`）、`data.js`、`ui.js` 不改。**
3. **不读 `.env`、不调 DeepSeek**（密钥只在发起人机器上）。AI 那段用单元测试和 `client.js` 里的现成示例验证；真 AI 由 Claude 跑。
4. 浏览器和 Node 都要能用：新模块写成 `(function(root){…})(typeof window!=='undefined'?window:globalThis)` + `module.exports`，同 `cut.js`。
5. 文字三语（繁/简/英），新字串放 `ai-level.js` 自己的 `I.add`；交回前跑 `node game-feeder/tools/check_strings.js`。

## 三、做什么（按顺序）

### 1. 第三关：精简道路（先做，最简单）
`bots/v7_levels_batch.js` 的 `simplifyCorridors(level, engine)` 搬成 `shared/levelgen/simplify.js`（浏览器 + Node 都能用，`bots/v7_levels_batch.js` 改成 require 它，行为不变）。`worker.js` 在 `cut` 之后、校准之前调用它（留 6–10 条走廊）。验收：同一请求，路从几十条降到 ≤ 10，`check` 不报 `nothing_to_solve`。

### 2. 第二关：自动排版
新 `shared/levelgen/layout.js`：`toMode2(base, demand, request) → {level, problems, notes}`。
- 片区和改动同第三关（`request.area`、`changes`、`period`）。从片区里选 5–6 个居住组（按早高峰出行量，大分区可拆成两组，像任务 57 的「逸東邨·西/東」）和 2–3 个去处（按岗位）。
- 摆到约 14 × 9 的格子：**保留真实的东西南北关系**，不重叠，屋苑之间至少隔 1 格，去处不贴屋苑。
- 数字照任务 57 的 `manual()`：人数按早高峰出行量缩放到合计约 280，吸引力 = 16 + 8 × 岗位 ÷ 最大岗位，其他参数取 `levels/examples/m2-1.json`。改动（`people`/`jobs` 的 `pct`）乘到对应的人数/吸引力上；第二关引擎不支持逐年 `grow`，就按最终值，在 `notes` 写明。
- 每个数在 `level.source` 写来源（同任务 57）。

### 3. 第四关：在第二关的排版上加空地
`toMode4(…)`：同 `toMode2`，参数取 `levels/examples/m4-1.json`，再加 12–18 块空地（`land`），分 2–3 片，放在屋苑和去处之间的空格（不占屋苑、去处、水），像任务 57 的 `lotsKT` 那样。

### 4. 浏览器里的机器人和门槛（第二、四关）
`worker.js` 按 `request.mode` 分流。第二关、第四关各要一个 15–20 秒内跑完的局部搜索（参考 `bots/v7_metro_grow.js`、`bots/v7_tod.js` 的做法，可放 `shared/levelgen/bot2.js`、`bot4.js` 或把 `bot.js` 扩成按玩法），用各玩法的 `engine.js` 计分（worker 里 `importScripts` 对应的 `data.js` + `engine.js`，同第三关）。
门槛 = 最好 × (0.40, 0.65, 0.88) 取整（同任务 57）。不合格（太简单：最简单方案就到大师；没东西可解：最好 < 50）要报 `problems`，好让 AI 重试。

### 5. AI 后台和前台
- `feeder_ai.py`：`MODES = {2, 3, 4}`；提示词写清怎么选玩法：说到「卖地 / 开发 / 物业 / 新屋苑」→ 4；说到「塞车 / 路 / 隧道 / 车流」→ 3；只说「修地铁 / 新线 / 没地铁」→ 2；拿不准 → 3。`road_cap` 只在第三关可用（其他玩法出现就校验报错或改成 3，写进 notes）。请求可带 `mode`（玩家指定），带了就按它。`test_feeder_ai.py` 补测试（不调真 AI）。
- `ai/client.js`：示例里补第二关、第四关各两个；`generate` 把玩家选的 `mode` 传给后台。
- `test-sentences.json`：每句加期望玩法；补 10 句第二、四关的话。
- `ai-level.js`：面板加「做成：自動 / 第二關 / 第三關 / 第四關」；结果卡写清是第几关的玩法，按钮「用第 N 關的玩法打開 →」，`TLPack.save` 时 `mode: N`，跳到 `../mode2-metro/`、`../mode3-roads/`、`../mode4-tod/` 的 `index.html#pack=<id>`。

### 6. 命令行（验收用）
`node bots/v7_levelgen.js --mode 2|3|4 --area <key> [--request req.json] [--seconds 20]`：同浏览器一样的步骤，输出关卡 JSON 和报告。`--batch --mode N` 对 20 个片区各跑一次，列出哪些片区出不了关、为什么。

### 7.（P2，有时间再做）第一关（接驳巴士）
一个真实港铁站做中心，附近 1.5 公里内 5 个屋苑，候选站位，按早高峰出行量排人流波次，用 `bots/v7_bus.js` 定门槛。做不完就写清思路交回。

## 四、交回
`任务59\说明.md`：每种玩法 3 个例子（片区、改动、几个屋苑/去处/路/空地、机器人最好、门槛、用时）；`--batch` 结果表；改了哪些文件；已知局限。附增量包。
