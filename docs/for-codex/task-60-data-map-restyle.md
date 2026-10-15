# 任务 60：全港数据地图换成游戏的配色和画风

> P1（决赛前要）。分工：Codex 做，Claude 审、真鼠标验收、提交。

## 一、最终要的是什么
入口 05 有一张「全港數據地圖」（后台根地址 `/`，前端 `frontend/`，React + MapLibre + deck.gl）：搜地点、分区人口/岗位等数据、实时车流。它是最早的 TransitLab Live，配色是紫色分区 + 默认网页样式，和游戏（米白纸色、黑字、绿色强调、衬线标题）不搭。发起人原话：不用调太多东西，但配色和画风要和现在的游戏匹配；车队的东西全删掉。
「车队沙盘」「无人车情景」两个面板 Claude 已从 `App.tsx` 拿掉（v7.29），文件还在。

## 二、硬规矩
1. 项目只读，不做 git。复制 `F:\transitlab-hk\frontend\`（不含 `node_modules`、`dist`，自己 `npm ci`）和参考用的 `game-feeder\v7\shared\` 到 `%USERPROFILE%\Desktop\TransitLab五模式-Codex\任务60\`，交回增量包。
2. 只许改 `frontend/src/**`、`frontend/index.html`、`frontend/public/**`（加字体/图标可以）。**不加新的 npm 依赖，不改后台，不改数据。**
3. 数据显示的内容和数字不变（分区指标、图例分档、车流探测器、来源说明），只改样子；删车队相关代码时，确认没有别的地方用它。
4. `npm run build`、`npm run lint` 通过；用 Playwright（已在 devDependencies）截图验收。

## 三、做什么

### 1. 删掉车队
删 `components/FleetPanel.tsx`、`components/DeploymentPanel.tsx` 及只给它们用的 CSS、`api/client.ts` 里只给它们用的函数和类型。其他保留。

### 2. 换成游戏的样子（参考 `game-feeder/v7/shared/style.css` 和 `game-feeder/v7/mode5-sandbox/vector.js`）
- **颜色变量**（同游戏）：纸色 `#FFFCF7`、面板 `#FFFFFF`、浅底 `#F8F6F1`、墨 `#0A0A0A` / `#525252` / `#8C8C8C`、线 `rgba(0,0,0,.08)` / `.18`、强调绿 `#0E7A4E`（浅 `#E6F1EA`）、警示 `#B07C10`、坏 `#BF3B2B`、信息蓝 `#1F5FA8`。
- **字体**（同游戏，Google Fonts）：标题 Bodoni Moda / Noto Serif TC，正文 Geist，数字和小标签 Geist Mono（小标签大写、字距 .14em、9.5–10.5px、灰）。
- **顶栏**：同游戏的顶栏（左边 `logo-tide.svg` + 「TransitLab」字标 + 小字「HK · 全港數據地圖」，右边「← 五個模式」回 `/feeder/index.html#hub=1&nav=5`），搜索框换成游戏的输入框样式。
- **底图**：海 `#d9e8ef`、陆地 `#f7f5ef`、区界细灰线，道路米黄（同沙盘 `vector.js` 的浅色调色板）；地名字用墨色/灰，不要默认蓝色。
- **分区上色**：去掉紫色。人口类用纸色 → 绿（`#9fc796` 一路到深绿），岗位类用纸色 → 蓝（`#9cbad8` 到深蓝），其他指标同理挑和游戏协调的单色渐变；分档数和阈值不变。
- **车流**：绿 → 黄 → 橙 → 红保留（这是通用的拥堵语言），但饱和度降一点、线宽不变，和纸色底图协调。
- **面板**（分区数据、实时车流、点分区出来的详情）：游戏卡片样式——白底、1px 细线、圆角 6–8px、轻阴影；标题用小号大写等宽标签；数字等宽。
- **语言**：现在是简体。读游戏存的语言 `localStorage['tl-lang']`（`zh-Hant` / `zh-Hans` / `en`），至少支持繁体和简体（游戏默认繁体）；地名保留数据原文。做不完英文就写清楚。
- （P2）深色：读 `<html data-theme>` 或游戏存的主题，有余力做一套深色变量。

### 3. 检查
1500×920 和 390×844 各截一张：首页、点一个分区、搜「沙田」。没有横向滚动，面板不挡住主要地图。

## 四、交回
`任务60\说明.md`：改了哪些文件、删了哪些、前后对比截图、已知局限。附增量包（只含 `frontend/src` 等允许的文件）。
