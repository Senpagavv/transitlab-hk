# 任务 61：先上一个静态版网站（Cloudflare Pages）——大家能玩、能做关卡

> P0（越快越好）。分工：Codex 做准备（打包脚本、静态开关、检查、上线说明），Claude 审、真鼠标验收；**真正发布由发起人自己在 Cloudflare 上点**（对外的动作，Codex 和 Claude 都不做）。

## 一、最终要的是什么
一个公开网址（Cloudflare Pages 免费的 `xxx.pages.dev`），任何人打开就能：
1. 从入口（潮汐封面 + 全港波点地图）进 01–04 四个玩法，逐关玩，看 AI 示范；
2. 进 05 全港沙盘：画线、放站、选区、「放大只算这一片」「用第三关玩这一片」；
3. 用关卡编辑器（入口右上「✎ 關卡編輯器」）做关卡、试玩、机器人试算、**导出 .json**，再自己发给发起人。

**这一版不要后台**：不放 AI 后台（DeepSeek）、不放全港数据地图（原 TransitLab Live，靠后台）、不放排行榜和登录（以后同学的后台）。这些入口在静态版要藏起来或说明「稍后开放」，不能点了报错。以后的后台版（任务 62）会用同一套网址，所以网址结构这次就定好。

## 二、硬规矩
1. 项目只读，不做 git。复制 `F:\transitlab-hk\game-feeder\` 到 `%USERPROFILE%\Desktop\TransitLab五模式-Codex\任务61\game-feeder\`，交回增量包。
2. **不发布、不登录任何账号**（Cloudflare、GitHub 都不碰），不调任何外部接口。上线步骤写成说明给发起人。
3. **不读 `.env`**，网站里绝不能出现：`.env`、任何密钥、`data/`（`v7/hk/` 以外）、`*.py`、`node_modules`、测试和机器人脚本。打包脚本要有一个**禁止清单检查**，命中就失败退出。
4. 只许新建 / 改：
   - 新：`game-feeder/tools/deploy/**`（打包脚本、检查脚本、上线说明、`_headers`、`_redirects`、404 页模板）、`game-feeder/v7/shared/site.js`（站点开关）。
   - 改：各页面 HTML 加一行载入 `shared/site.js`；为了静态开关要动的地方——`hub/hub.js`、`hub/strings.js`、`mode5-sandbox/ui.js`、`mode5-sandbox/layout.js`、`mode5-sandbox/ai-level.js`、`ai/client.js`、`shared/board.js`、两个编辑器的 `editor.js` 和 `strings.js`；`v7/build.py` 和各玩法 `build.py` 只在需要把 `site.js` 也打进离线单文件时改。
   - **规则引擎（各 `engine.js`）、`data.js`、关卡文件不改。**
5. **本机（`python -m http.server` 或后台 `/feeder/`）和离线单文件的行为必须和现在一模一样**：`site.js` 默认是「本机版」，只有打包脚本生成的网站里才写成「静态版」。
6. 文字三语（繁 / 简 / 英），交回前跑 `node game-feeder/tools/check_strings.js`。

## 三、做什么（按顺序）

### 1. 网址结构（P0）
网站根目录 = 一个 `site/` 文件夹：
```
site/
  index.html           → 302 到 /feeder/（_redirects；以后后台版的 / 放全港数据地图）
  feeder/              ← game-feeder/v7 的网页部分（入口、五个玩法、编辑器、hk 数据、shared、levels/registry.js）
  _headers  _redirects  404.html
```
本机后台也是把 v7 挂在 `/feeder/`，所以以后换成后台版网址不变。

### 2. 打包脚本 `game-feeder/tools/deploy/build_static.py`（P0）
- **白名单**复制 v7 运行要用的文件（扫描各页面实际引用的 js / css / json / svg，加上 `hk/*.json`、`levels/registry.js`、`shared/levelgen/*.js`、worker 文件）；不要的：`*.py`、`test_*.js`、`fuzz_*`、`verify_*`、离线单文件（`模式*.html`、`开始.html`、`关卡编辑器.html`）、`INTEGRATION.md`、`README.md`、`levels/examples`、`shared/levelgen/results`、`preview.html`、没有入口链接的旧目录（如 `mode4-bus`，先确认没有页面链到它）。
- 写入静态版的 `site.js`（见第 3 条）。
- **禁止清单检查**（见硬规矩 3），再检查：每个页面里相对路径的 `src` / `href` / `fetch` / `new Worker` 都能在 `site/` 里找到；列出所有以 `/` 开头的地址（如 `/api/...`、`/login`、`/`），每一个都要在静态版里被开关挡掉或改掉。
- 打印：文件数、总大小、最大的 10 个文件（Cloudflare Pages：单文件 ≤ 25 MiB、总数 ≤ 20,000）。
- 用法：`python game-feeder/tools/deploy/build_static.py [输出目录，默认 F:\transitlab-hk\site]`。输出目录不进 git（交回说明里提醒发起人把 `site/` 加进 `.gitignore`，或者输出到项目外）。

### 3. 站点开关 `v7/shared/site.js`（P0）
```js
window.TL_SITE = { static: false, ai: true, dataMap: true, board: true, submit: '' };   // 本机版（默认）
// 打包脚本写成：{ static: true, ai: false, dataMap: false, board: false, submit: '發給發起人' }
```
每个页面在其他脚本之前载入它。静态版里：
- **全港数据地图**：入口 05 的卡、沙盘顶栏的「全港數據地圖」不显示（`hub.js` 的 `hubLive`、`layout.js` 的 live 链接、`ui.js` 里的 `liveMap`）。
- **AI 出关卡**：不访问后台（`ai/client.js` 直接走现成示例），AI 卡上写清楚「AI 正式版稍後開放；現在可以試這幾句」并列出示例能认的几个说法（启德、沙田、铜锣湾、将军澳隧道、北部都会区）；示例出的关卡照样在浏览器里切、能用第三关打开。入口 05 的「AI 出關卡」卡片说明也相应改。
- **排行榜 / 登录**：不显示按钮、不发请求（`board.js`；各玩法页的 `TLBoard.bind`）。
- **编辑器**：导出后的提示和「怎麼交關卡」里写上 `TL_SITE.submit`（例如「發給發起人」；发起人以后可以改成群组名，不要写任何人的邮箱或电话）。
- 关卡包上传本来就关着（`TL_FEATURES.levelUpload=false`），保持。

### 4. 署名和来源（P0，公开上线的硬要求）
沙盘地图的铁路走向来自 OpenStreetMap（ODbL），必须在地图上看得到「© OpenStreetMap contributors」；顺带写上其他来源（地政总署、运输署、规划署等，按 `hk/hk-base.json` 的 `sources` 和 `hk-shapes.json` 的 `source`）。放在沙盘左下图层卡下面或地图右下角，小字、不挡操作。

### 5. 缓存、404、搜索引擎（P1）
- `_headers`：`*.html` 每次重新验证；`*.js`、`*.css` 短缓存加重新验证（没有带版本号的文件名，所以不能长缓存）；`feeder/hk/*.json` 缓存 1 小时。
- `X-Robots-Tag: noindex` 先打开（测试期不让搜索引擎收录），在说明里写怎么关掉。
- `404.html`：游戏风格的一页，「找不到這一頁 → 回五個模式」。
- 小屏幕（宽 < 700px）打开沙盘时，顶部提示一次「沙盘建議用電腦玩」（可关）。

### 6. 检查（P0）
- 写 `game-feeder/tools/deploy/check_site.js`（用 Node + 项目里已有的 Playwright，或 Edge 无头）：在 `site/` 上起一个本机静态服务器，逐页打开（入口、五个玩法的每一关 `#map=`、两个编辑器、沙盘），**零报错**；01–04 每个玩法跑一次 AI 示范的大师档；编辑器导出一个文件；沙盘跑一轮、「放大只算这一片」跑一轮；AI 卡用示例说法出一关并打开第三关。
- 再确认本机后台 `/feeder/` 和离线单文件照旧（静态开关不影响它们）。

### 7. 上线说明 `game-feeder/tools/deploy/README.md`（P0，写给发起人，中文，一步一步）
- **方法一（最简单，不装东西）**：Cloudflare 后台 → Workers & Pages → 创建 → Pages → 上传资产 → 拖入 `site` 文件夹 → 起项目名 → 部署；以后更新：同一个项目「创建新部署」再拖一次。写清楚上传文件数的限制（如果超过网页拖放的上限，就用方法二）。
- **方法二**：`npx wrangler login`（会打开浏览器让发起人自己登录）→ `npx wrangler pages deploy site --project-name <名字>`。
- 以后接 GitHub 自动部署、绑定自己的网址：写一段「以后再做」。
- 发布前检查清单：跑过 `build_static.py`（禁止清单通过）、跑过 `check_site.js`、手机和电脑各打开一次。

## 四、交回
`任务61\说明.md`：改了哪些文件、`site/` 的文件数和大小、`check_site.js` 的结果（每页零报错的列表、示范分数）、静态版里藏了哪些入口、已知局限。附增量包。
