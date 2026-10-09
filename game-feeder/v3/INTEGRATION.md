# 接驳巴士游戏：部署与对接说明

> 写给负责网站、注册登录和排行榜的组员。English: [`INTEGRATION.en.md`](INTEGRATION.en.md)
> 一句话：这是一个**纯静态网页游戏**，原样放到网站的一个子目录就能玩；登录和排行榜用你自己的脚本接，**不用改游戏代码**。

## 1. 源码在哪

仓库 `Senpagavv/transitlab-hk`（私有）的 `game-feeder/v3/` 文件夹。整个仓库有几百 MB 交通数据，只要游戏的话这样拉，只下载 `game-feeder`：

```bash
git clone --filter=blob:none --sparse https://github.com/Senpagavv/transitlab-hk.git
cd transitlab-hk
git sparse-checkout set game-feeder
```

| 文件 | 作用 |
|---|---|
| `index.html`、`style.css`、`logo-tide.svg` | 页面结构、样式、标志 |
| `data.js` | 三张关卡地图（粉嶺、元朗南、朗屏）、全港选址点 |
| `engine.js` | 游戏规则（谁走去哪座站、巴士、计分）。浏览器和 Node 都能跑 |
| `ui.js` | 关卡画面、操作、结算 |
| `hub.js`、`cover-data.js` | 开场 → 全港地图 → 点站进关卡 |
| `i18n.js` | 繁体 / 简体 / 英文全部文字 |
| `开始游戏.html` | 以上全部打包成的单个文件（`python build.py` 生成） |
| `verify_result.js` | **服务器用**：核对成绩是不是真的（见第 4 节） |
| `test_engine.js`、`build.py` | 自动检查、打包，不用上传 |

## 2. 原样放上服务器

不需要后端，也不需要在服务器上跑 Node。两种放法，任选一种，都放在网站下的 `/feeder/` 子目录（**不要覆盖网站首页**）：

- **A. 单文件（最简单）**：把 `开始游戏.html` 改名为 `index.html`，放到 `/feeder/`。
- **B. 源码文件夹（方便加你自己的脚本）**：上传 `index.html`、`style.css`、`logo-tide.svg`、`data.js`、`engine.js`、`i18n.js`、`cover-data.js`、`ui.js`、`hub.js` 到 `/feeder/`。

放在同一个网站下，游戏页面就能用到网站已有的登录 Cookie。字体从 Google Fonts 加载，国内打不开时会自动用系统字体，不影响玩。正式开放注册登录前请先配好 HTTPS。

## 3. 接你的功能：游戏对外发出的信号

在 `index.html` 的 `</body>` 前加一行你自己的脚本，例如 `<script src="/feeder-site.js"></script>`。游戏会在 `window` 上发出这些事件：

| 事件 | 什么时候 | `e.detail` |
|---|---|---|
| `tl:result` | **每局结束一次** | 成绩记录，字段见下表 |
| `tl:lang` | 玩家在游戏里切换语言 | `'zh-Hant'` / `'zh-Hans'` / `'en'` |
| `tl:entered` | 进入一个关卡 | 无 |

`tl:result` 的字段：

| 字段 | 例子 | 说明 |
|---|---|---|
| `game`、`version` | `'feeder'`、`'3.1'` | 哪个游戏、哪一版 |
| `map` | `'fanling'` | 关卡：`fanling` 粉嶺 / `yuenlong` 元朗南 / `longping` 朗屏 |
| `score` | `178` | 送上港铁的人数（分数） |
| `total` | `234` | 这一关的总人数（粉嶺 234，元朗南 192，朗屏 192） |
| `tier`、`tiers` | `1`、`[174,180,185]` | 0 未过关 / 1 过关 / 2 高分 / 3 潮汐大师，及三档门槛 |
| `cars`、`missed` | `46`、`2` | 改开车的人数、没出门的人数 |
| `seed`、`opening`、`moves` | `1781`、`[[2,2],[6,2],[2,6]]`、`[{time:90,id:2,cell:[2,5]}]` | 整局记录，服务器用它重算核分 |
| `lang` | `'zh-Hant'` | 当时的语言 |

还可以调用：`I18N.set('en')`（切语言）、`I18N.lang`（当前语言）、`TL_GAME.map()`（当前关卡）、`TL_GAME.pause()`（暂停）。

**语言**：游戏先读自己的 `tl-lang`；玩家没在游戏里选过，就读网站的 `tlhk-lang`（代码相同）。网站有、游戏没有的语言（es、ru、ja、ko、id）显示英文。玩家在游戏里切换后如果要同步回网站，监听 `tl:lang` 写入 `tlhk-lang`（见下例）。

**浏览器本地存的**：`tl-best-<关卡>`（本机最高分）、`tl-lang`、`tl-theme`。游戏自己**不向任何服务器发送数据**。

例子（`/api/feeder/scores` 是建议你新建的接口，现在还不存在）：

```js
// feeder-site.js：网站自己的脚本，游戏代码不用动
addEventListener('tl:result', async e => {
  const me = await fetch('/api/auth/me', { credentials: 'same-origin' }).then(r => r.json()).catch(() => null);
  if (!me || !me.user) return;                       // 没登录：成绩只留在本机
  fetch('/api/feeder/scores', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(e.detail)
  });
});
addEventListener('tl:lang', e => { try { localStorage.setItem('tlhk-lang', e.detail); } catch (_) {} });
```

## 4. 排行榜防作弊：服务器先核分再保存

规则是确定的：同一个随机种子 + 同样的开局三站 + 同样的挪站操作，结果永远是同一个分数。所以服务器不要相信浏览器报的 `score`，自己重算一遍：

```js
// Node 后端：verify_result.js、data.js、engine.js 放在同一个文件夹
const verify = require('./verify_result.js');
const check = verify(body);              // body = 浏览器发来的 tl:result 记录
if (!check.ok) return res.status(400).json(check);
// 保存 check.score（服务器算出来的），check.map 区分关卡
```

后端不是 Node（例如 Python）时，把记录写成文件后调用命令：`node verify_result.js result.json`，退出码 0 = 可信，1 = 不对（同时打印 JSON 结果）。核对一局约几十毫秒。

- 排行榜**按关卡分开**：三关总人数和门槛都不同，不能放在同一个榜里比。
- 不要和铁路规划游戏的排行榜混在一起。
- 以后游戏规则如果改了（`version` 会变），旧成绩应该另存或标注版本。

## 5. 一起改代码的规矩

- **游戏规则和数值**（`engine.js`、`data.js`）由 Benny 定，要改先和他商量；界面和你自己的网站脚本可以直接改。
- 在自己的分支上改（`<名字>/<做什么>`），通过 Pull Request 合并；在 `game-feeder/LOG.md` 的 v3 线和仓库根目录 `CHANGELOG.md` 各记一条（时间、改了什么、为什么、怎么验证）。
- 改完运行 `node v3/test_engine.js`（22 项要全过），再 `python v3/build.py` 重新生成 `开始游戏.html`。
- **请把服务器上实际运行的网站源码（注册登录、排行榜、语言）也推到 GitHub**，放在这个仓库的新文件夹或单独的仓库都可以，方便以后对接和出问题时回退。不要提交 `.env`、密码、邮箱授权码或数据库文件。
