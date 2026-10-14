# 任务 56：排行榜和自定义关卡包（前端模块）

> P0。分工：Codex 先做「大差不差」的一版，Claude 审、真鼠标验收、提交。后台由负责上线的组员接。

## 一、发起人要的（原意）
- 每个模式：第 1–3 关是教学关（有 AI 解法），**第 4 关是挑战关**（没有 AI 解法，有**排行榜**）。注册登录后可以把成绩传到排行榜，在关卡里看排名。
- **AI 生成的关卡**（和以后玩家自己做的关卡）＝一个「关卡包」：先**只在本机玩**，关掉网页就删（`sessionStorage`）；可以导出成文件、再导入。「上传到关卡库」**先留接口、不开放**（以后后台审核通过才进关卡库，每个上传的关卡有自己的排行榜；现在怕后台维护和空间，不开）。

## 二、硬规矩（违反作废）
1. **项目只读**：`F:\transitlab-hk` 不写不改不删；不做 git 操作；不联网（不要去请求组员的线上网站）。
2. **在复制里改**：把 `F:\transitlab-hk\game-feeder\v7\`、`...\v3\` 复制到 `%USERPROFILE%\Desktop\TransitLab五模式-Codex\任务56\game-feeder\`；**只新建** `v7/shared/board.js`、`v7/shared/levelpack.js`、`v7/shared/board.css`、`v7/INTEGRATION.md` 的「排行榜」一节、`tools/mock-board/`（本机假后台）。模式页不改——在说明里写清楚每个模式页要加的几行（Claude 来加）。
3. 文字三种 `I18N.add({key:L(繁,简,英)})`。
4. 交回写 `任务56\说明.md`。

## 三、排行榜（`shared/board.js`）
- **接口照组员网站现有的**（`docs` 里没有，见下；只读参考 `game-feeder/v3/INTEGRATION.md` 第 3–4 节的事件和 `verify_result.js` 的核分思路）：
  `GET /api/auth/me`（登录状态）、`GET /api/game/leaderboard?mode=<关卡 id>&limit=50`、`GET /api/game/leaderboard/me?mode=<关卡 id>`、`POST /api/game/leaderboard`（`{mode:<关卡 id>, score, plan, lang}`）。同源、Cookie。关卡 id 用 `feeder/<模式>/<关卡 key>`，例如 `feeder/m3/m3-4`。
- **UI**：结算框里一个「排行榜」按钮 → 一个小面板：前 50 名、我的名次；没登录显示「登入後可上傳」并链到网站的登录（链接可配置）；后台连不上 → 只显示**本机成绩**（`localStorage`，每关前 10，标「本機」）。
- **只在挑战关和自定义关卡出现**（`TL_LEVELS.get(模式, key).challenge` 为真，或来自关卡包）。
- **核分**：上传带 `plan`（方案：线、站、列车、卖地……各模式 `Plan` 能重放的最小信息）；写一个 Node 脚本 `tools/verify-score.js <关卡 id> <plan.json>`：用对应模式的 `engine.js` 重放，算出的分和上传的分差 < 0.5 才算数（给组员后台调用；照 `v3/verify_result.js`）。
- **事件**：结算时 `window.dispatchEvent(new CustomEvent('feeder:result', {detail:{level, score, plan, tier}}))`，组员的站内脚本也可以自己接（同 v3 的做法）。
- **假后台** `tools/mock-board/server.js`：本机 Node 起一个同样接口的小服务（内存存储，假登录），配合 `v7` 静态页面一起提供，用来真鼠标测试。

## 四、关卡包（`shared/levelpack.js`）
- 格式＝关卡文件的 `tl-level/1`（`v7/levels/README.md`，组员做关卡也用它），关卡包多 `id`、`hash`、`source`、`created`：
```jsonc
{"format": "tl-level/1", "id": "custom-<8 位哈希>", "mode": 3, "title": "…", "story": ["…", "…"],
 "level": { /* 该模式 data.js 里 LEVELS 一项的格式 */ },
 "tiers": [500, 1000, 3000], "source": {"by": "ai|user", "area": "kowloon-east", "period": "am", "request": { /* AI 的关卡请求 */ }},
 "created": "2026-10-15T10:00:00+08:00", "hash": "<level 内容的 SHA-256 前 16 位>"}
```
- `TLPack.save(pack)` → `sessionStorage`（关掉网页就没了）；`TLPack.list()`、`TLPack.load(id)`、`TLPack.remove(id)`；`TLPack.exportFile(pack)`（下载 `.tlevel.json`）、`TLPack.importFile(file)`（读文件、检查格式和哈希、按模式检查必需字段）。
- `TLPack.upload(pack)`：功能开关 `TL_FEATURES.levelUpload=false` 时按钮灰掉，写「關卡庫即將開放」；开的时候 `POST /api/feeder/levels`（接口写进 `INTEGRATION.md`，标「未上线」）。
- 模式页怎么打开关卡包：`#pack=<id>` → `TLPack.load(id)` → 该模式 `D.use(pack.level)`（各模式 `data.js` 已有 `use()`），关卡名和故事放进开场卡；写成说明里的几行代码。

## 五、验收
- `node` 测试：关卡包存取、导出 / 导入往返一致、哈希不对拒收、上传开关关着时不发请求；核分脚本：第三关大师方案（`mode3-roads/demo-plans.js`）核出 3321，改一个数就不通过。
- 真鼠标（CDP 鼠标事件，配假后台）：结算 → 排行榜 → 未登录提示 → 假登录 → 上传 → 看到自己的名次；后台关掉 → 显示本机成绩。截图放 `任务56\shots\`。

## 六、优先顺序
1 关卡包 → 2 排行榜面板 + 本机成绩 → 3 核分脚本 → 4 假后台 + 真鼠标测试 → 5 `INTEGRATION.md` 排行榜一节。
