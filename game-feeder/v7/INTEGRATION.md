# 排行榜 / Leaderboard

任务56前端交付，2026-10-15。源码模式页没有接入改动；下列片段由 Claude 审核后加入。后台接口按任务书给出的路径实现，尚未连接正式网站。没有补造第四关。

## 文件与加载顺序 / Files and loading order

新增 `shared/levelpack.js`、`shared/board.js`、`shared/board.css`，核分脚本在 `../tools/verify-score.js`。均无新增生产依赖。

每个模式页在 head 增加：

```html
<link rel="stylesheet" href="../shared/board.css">
```

在现有 `shared/i18n.js` 之后、`ui.js` 之前增加以下两行；保留现有 registry、data、engine、strings、nav、progress、save、tips 的相对顺序：

```html
<script src="../shared/levelpack.js"></script>
<script src="../shared/board.js"></script>
```

把原先 `ui.js`、`demo-plans.js`、`demo.js` 三个静态 script 标签替换为以下启动块。模式参数见下一张表。

```html
<script>
TLBoard.bind({ mode: 3, container: '#result .row', loginUrl: '/login' });
window.TL_PACK_READY = TLPack.startMode({
  mode: 3, D: ROADS_DATA, E: Roads,
  ui: 'ui.js', demos: ['demo-plans.js', 'demo.js']
}).catch(error => {
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.textContent = error.message;
  document.body.prepend(message);
});
</script>
```

| 模式页 / Page | mode | D | E | 关卡 id / Level id |
| --- | ---: | --- | --- | --- |
| mode1-bus | 1 | TIDE_DATA | Tide | feeder/m1/l4 |
| mode2-metro | 2 | METRO_DATA | Metro | feeder/m2/关卡key |
| mode3-roads | 3 | ROADS_DATA | Roads | feeder/m3/关卡key |
| mode4-tod | 4 | TOD_DATA | TOD | feeder/m4/关卡key |

`startMode` 先读 `#pack=<id>`，`await TLPack.load(id)`，核对模式，执行 `D.use(pack.level, pack.id)`、`E.reset()`，**然后才加载 ui.js**。不能仅插入一个异步读包函数后继续让静态 ui.js 抢先创建 Plan。缺失或损坏的包会报错，不会默默进入默认教学关。

有包时保存 `window.TL_ACTIVE_PACK`，把包的名称和故事写入 `#lvIntro`，语言切换时重新绘制；模式1额外注册自定义标题的 I18N 键并开启开场卡。无包时按原关卡启动。只给教学关加载 demos，挑战关和关卡包均跳过。`#intro=0` 仍可用于本机验收。

该写法针对源码 index.html。单文件打包及入口 hub 的包列表按钮留给整合者；现有 build.py 未改，不能把旧单文件当作已经接入的版本。

## 每个模式的结算片段 / Result event in each mode

放在各模式 `ui.js` 的结算函数内部，保留原来的 `tl:result` 事件。必须从完整的 Game/Plan 取方案；现有第三模式的 `tl:result` 只有最终线路，缺少第一阶段方案，第四模式的旧事件也缺少卖地记录，不能直接包装它们上传。

模式1 `showResult()`，其中已有 game、D、tierOf：

```js
window.dispatchEvent(new CustomEvent('feeder:result', { detail: {
  level: 'feeder/m1/' + D.map,
  score: game.delivered,
  plan: TLBoard.snapshot(1, game),
  tier: tierOf(game.delivered)
}}));
```

模式2 `result()`，其中已有 plan、D、tier：

```js
window.dispatchEvent(new CustomEvent('feeder:result', { detail: {
  level: 'feeder/m2/' + D.map, score: Math.round(plan.total),
  plan: TLBoard.snapshot(2, plan), tier
}}));
```

模式3同一位置使用：

```js
window.dispatchEvent(new CustomEvent('feeder:result', { detail: {
  level: 'feeder/m3/' + D.map, score: Math.round(plan.total),
  plan: TLBoard.snapshot(3, plan), tier
}}));
```

模式4 TOD 同一位置使用：

```js
window.dispatchEvent(new CustomEvent('feeder:result', { detail: {
  level: 'feeder/m4/' + D.map, score: Math.round(plan.total),
  plan: TLBoard.snapshot(4, plan), tier
}}));
```

也可调用 `TLBoard.result(detail)`，它发出的就是上述事件，站内脚本可自行监听。模块只在 `TL_LEVELS.get(mode,key).challenge === true`，或同模式包已存在于 sessionStorage 时显示按钮。禁止用“key 结尾是4”猜挑战关。

本快照的 registry 仅模式1有第4关 l4；模式2、3、4各只有第1关。它们的教学关不显示榜。后续组员增加挑战关并重建 registry 后自动生效；核分脚本会读取新 registry。第五模式沙盘没有 `tl-level/1` 的 data.use/关卡总分契约，旧 mode4-bus 也不是当前 registry 的模式4，两者不冒充 TOD 的排行榜。需要先由负责人定义其关卡和成绩契约。

## 浏览器模块 / Browser modules

`TLBoard.bind({mode, container, loginUrl, timeout})` 默认容器 `#result .row`，登录链接 `/login`，请求超时4000毫秒。`TLBoard.open()`、`refresh()` 可供站内脚本调用。结算事件首先写本机前10名；打开面板才读远端；玩家点上传才 POST。前端无自动上传。请求同源且 `credentials:'same-origin'`。

每关 `localStorage['tl-board/1/'+levelId]` 保存成绩、档次和时间，不存方案。远端读失败、网络异常或超时显示标注“本机”的成绩。400/403等上传拒绝显示提示；401转未登录；异常回退本机。浏览器拒绝存储时只在本次页面的内存中展示，并显示未保存提示。关闭面板、切换结果时丢弃旧异步响应。

`TLBoard.snapshot(mode, gameOrPlan)` 返回最小可重放 JSON：

| 模式 / Mode | plan 字段 / Fields |
| --- | --- |
| 1 | seed、opening（三站）、moves（按时间顺序的 time/id/cell） |
| 2 | line（逐格、有序）、stations、trains |
| 3 | 第一次开通时 phase1State 的 line/stations/trains；phase2 为 phase2Actions，有序 extend/station/train |
| 4 TOD | line/stations/trains；sales 只保留 cell/use/year，year=1表示第1年结算的卖地，保留同年操作次序 |

不要上传或信任 money、total、aware、crowded、销售价格、现成 roadLoad。它们由引擎重算。第三模式必须保留第一阶段与第二阶段，不可用最终线路代替第一阶段。

`TLPack` 方法：

```js
const saved = await TLPack.save(pack); // 自动补 id/hash/created；返回独立副本
const all = TLPack.list();            // 同步，当前会话中的包
const packAgain = await TLPack.load(saved.id); // 校验储存内容哈希，缺失返回null
TLPack.remove(saved.id);              // 同步，返回是否存在
await TLPack.exportFile(saved);       // 下载custom-xxxxxxxx.tlevel.json
const imported = await TLPack.importFile(file); // File/Blob，有text()；导入包必须带正确hash
await TLPack.upload(saved);           // 默认返回disabled，零请求
TLPack.uploadButton(saved, element);  // 默认灰色“关卡库即将开放”
```

储存键 `sessionStorage['tl-packs/1']`。包的 format=`tl-level/1`，mode为1–4；title是文字或繁/简/英对象，story为同样形式的数组，source.by是 ai 或 user，source.request可保存 AI 请求。包顶层 tiers 和 level.tiers 必须相同。按模式检查地图尺寸、位置、屋苑/需求/路网/土地、预算及年份等字段。最多2MB，拒绝非有限数、危险对象键和过深嵌套。

对 level 做“对象键排序、数组顺序保持”的 JSON 编码，然后 SHA-256：hash=前16个十六进制字符，id=`custom-`+前8字符。只对 level 内容哈希，符合任务书；标题、故事和作者元数据不在哈希范围。save/export 可补哈希；import/load 拒绝错误哈希或不匹配的 id。支持 Web Crypto（localhost/HTTPS）及 Node crypto。截断 id 冲突或跨模式同 id 会拒绝覆盖。

AI 生成完成后在调用处构造完整包，再 `await TLPack.save(pack)`。打开包须同源、同一标签页导航，例如：

```js
const dir = {1:'mode1-bus',2:'mode2-metro',3:'mode3-roads',4:'mode4-tod'};
const saved = await TLPack.save(aiPack);
location.href = '../' + dir[saved.mode] + '/index.html#pack=' + saved.id;
// 导入：const saved = await TLPack.importFile(input.files[0]); 然后同样导航。
```

所有新增用户文字用 `I18N.add({key:L(繁,简,英)})` 注册。包自身的单语言标题按原文展示，三语言标题按当前语言选择；用 textContent 展示用户内容。

## 接口 / HTTP contract

| 方法及路径 / Method and path | 请求 / Request | 本机假后台响应 / Mock response |
| --- | --- | --- |
| GET /api/auth/me | Cookie | `{user:null}` 或 `{user:{id,name}}` |
| GET /api/game/leaderboard?mode=feeder%2Fm3%2Fkey&limit=50 | 完整关卡id | `{entries:[{rank,name,score,userId}]}` |
| GET /api/game/leaderboard/me?mode=... | Cookie、关卡id | `{entry:{rank,name,score,userId}}` 或 `{entry:null}`；未登录401 |
| POST /api/game/leaderboard | `{mode:<完整关卡id>,score,plan,lang}` | `{ok:true,entry:...}`；核分失败400，未登录401 |
| POST /api/feeder/levels | 完整tl-level/1包、Cookie | **未上线**；假后台返回503 |

前端榜单同时兼容直接数组及 entries/leaderboard/scores 包装，玩家名兼容 name/displayName/user.name/username；我的排名兼容直接对象或 entry 包装。正式网站响应尚未只读获取，需后台组员按实际结构确认，必要时只调 rowsOf 与 refresh 的适配，不改引擎。

`window.TL_FEATURES.levelUpload` 默认 false。在模块加载前或按钮创建前设为true才可启用未来库上传；当前不得在生产环境开放。关闭时 `upload` 在校验/请求前直接返回disabled，按钮灰色。打开时走同源 Cookie POST `/api/feeder/levels`。后端审批通过后才登记关卡库及其独立排行榜。

普通自定义包暂时只在本机持有，正式后台若没有可信关卡定义就应拒绝它的远端成绩。假后台的自定义定义由 `/__mock/pack` 在服务端建立，只是本机验收夹具；不要把客户端 plan 夹带的 level 当作可信后台定义。

## 后台核分 / Server replay

```js
const verifyScore = require('./game-feeder/tools/verify-score.js');
const check = await verifyScore(body.mode, body.plan, {
  score: body.score,
  challengeOnly: true,
  pack: trustedPackFromYourDatabase // 自定义关卡才需；由后台自己取得
});
if (!check.ok) return res.status(400).json(check);
// 保存check.score，并按body.mode分榜、每个账户保留最好成绩。
```

核分每次在新的 vm 上下文载入原始 registry/data/engine，使用 Game.place/advance 或 Plan.extend/toggleStation/addTrain/runYear、第二阶段方法和 sellLand 重放。验证合法位置、连通、预算、列车、操作顺序、卖地年份等；不把客户上传状态直接 Object.assign 到引擎。比较严格 `abs(engineScore-claimedScore)<0.5`。

命令行输入可为 `{"score":3321,"plan":{...}}`，也可为 `{...plan字段,"score":3321}`。错误退出1，用法错误退出2。官方教学关可用CLI核验演示方案；后台上传需 challengeOnly=true。

```powershell
node game-feeder/tools/verify-score.js feeder/m3/m3-1 game-feeder/tools/mock-board/fixtures/master.json
node game-feeder/tools/verify-score.js feeder/m3/m3-1 game-feeder/tools/mock-board/fixtures/master-tampered.json
# 第一条exit 0、rounded=3321；第二条exit 1。
# 自定义：额外传 --level 后台保存的可信.tlevel.json；关卡id必须匹配包的mode/id。
```

大师方案来自本副本 `mode3-roads/demo-plans.js`，原始引擎分约3320.73，显示分3321，满足差<0.5。伪改到3322拒绝；恰好相差0.5也拒绝。

## 本机验收 / Local acceptance

```powershell
node game-feeder/tools/mock-board/server.js 8866
# http://127.0.0.1:8866/；v7静态文件在 /v7/，v3在 /v3/
node --test game-feeder/tools/mock-board/test.js
```

服务仅绑定127.0.0.1，Cookie假登录，内存榜单，重启清空；不得上线。CSP阻止外部字体、资源和请求。`/__mock/m1` 与 `/__mock/mode?mode=1..4` 只在 HTTP 响应里临时插入接入片段，磁盘上的原模式页不变。模式1既有测试挂钩加速结算；鼠标打开面板、假登录、上传和刷新均为 CDP Input.dispatchMouseEvent。

有已安装 Playwright 和 Edge 时可复验（不安装、不下载）：

```powershell
# 先起server。Playwright在自有环境中可直接require时，无需设置该变量。
$env:PLAYWRIGHT_MODULE = '你已有的playwright包绝对路径'
node game-feeder/tools/mock-board/browser-test.js
```

此脚本禁止非本机请求，最后 POST `/__mock/stop` 真正关闭服务，再用鼠标点刷新验证本机回退；需复验时重新启动 server。截图默认写任务56/shots。

实测 Node 9组通过；CDP 测试包括自定义3321分、真实模式1第4关183分两次上传、各自名次1、教学关无榜、四种模式的包开场卡、繁/简/英和后台关闭回退，页面JS异常0。12张截图和 browser-check.json 交回 shots。生产后台、Claude正式模式页改动、单文件重新打包及最终人工审核均待后续接手。

## English handoff

The production mode files and engines remain unchanged. Add board.css plus levelpack.js and board.js after I18N, then replace the three ui/demo script tags with the awaited `TLPack.startMode` block above using the per-mode D/E table. It loads and checks `#pack=id`, calls D.use/E.reset before UI initialization, paints the pack title/story and skips demos for packs/challenges. Emit `feeder:result` inside each settlement function using `TLBoard.snapshot`; the old mode-3 event lacks its first-phase plan, and the old TOD event lacks sales.

The board uses the four specified same-origin Cookie endpoints. Results are recorded locally before any remote request; opening fetches the top 50 and personal rank, and upload is explicit. Failed connections display the per-level local top ten. The configurable login URL defaults to `/login`. Supported response wrappers and the mock contract are listed above; the production response schema has not been contacted or verified.

Pack operations are session scoped. save/load/import/export/upload are asynchronous; list/remove are synchronous. Canonical JSON sorts object keys and preserves arrays. The level hash is the first 16 SHA-256 hex digits, and the id uses the first eight. Import requires an intact hash. Metadata is not hashed. Validation covers modes 1–4, matching tiers, required fields, coordinates and finite JSON. The level-library feature defaults to false and sends no request when disabled; `/api/feeder/levels` is **not launched**.

The asynchronous Node verifier replays legal engine methods in a fresh context and accepts only a difference strictly below 0.5. Custom definitions must come from trusted backend storage; never accept a definition supplied inside the uploaded plan. Mode 3 preserves phase1State plus ordered phase2 actions; TOD sales use commitment years starting at 1. Save the recomputed score. Mode 5 sandbox and legacy mode4-bus need separately defined level/score contracts and are not mapped to TOD.

The localhost-only mock provides static v7/v3 files, disposable Cookie sign-in and in-memory best scores. Temporary response integration leaves original mode files byte-identical. Nine Node test groups passed. Actual CDP mouse events verified two uploads, ranks, teaching exclusion, four pack opening cards, three languages and fallback after the service was shut down; no page errors. Twelve screenshots are included. Claude still owns production page integration, review, packaging and commit; deployment/backend work remains with the responsible teammate.
