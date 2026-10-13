# 接駁巴士 v7 · 模組版（五個模式）

> 給組員和接手的 AI 看的：v7 的檔案怎樣分、怎樣加一個新模式、怎樣打包和測試。玩法方案見 `docs/for-codex/2026-10-13-五模式与AI生成关卡.md`。

## 為什麼要分模組

每個模式是一個**獨立的頁面、獨立的引擎、獨立的打包檔**。改一個模式不會影響其他模式；只有外觀（顏色、字體、像素圖示、頂欄、卡片、提示框）和語言工具放在 `shared/` 共用，以後統一改 UI 只改一處。最後由入口頁（之後換成全港波點地圖、點進去波點飛成棋盤）把各模式串起來；組員也可以把自己的東西掛到入口上。

```
v7/
  index.html        入口頁（現在是五張模式卡；之後換成 v3 的波點地圖入口）
  build.py          一次打包全部：先跑每個模式自己的 build.py，再把入口頁打包成 开始.html
  shared/           所有模式共用
    style.css       顏色、字體、版面、卡片、提示框（亮 / 暗兩套）
    logo-tide.svg
    i18n.js         語言引擎：I18N.t / add / apply / set；繁 / 簡 / 英
    tips.js         引導關的一句提示（不強制、不暫停、看過就不再出）
  mode1-bus/        模式 1 · 車站與步行（可以玩）
    index.html      頁面（引用 ../shared/ 的檔案）
    data.js         關卡：1-1 朗屏（引導）、1-2 元朗南、1-3 粉嶺、1-4 大埔墟（不同的人）
    engine.js       規則引擎（v6 的規則：按吸引力分流、站會爆、停頓隨便挪、人群）
    strings.js      這個模式的文字（I18N.add）
    ui.js           畫面
    editor.html / editor.js   關卡編輯器
    test_engine.js  規則檢查（27 項）
    verify_result.js 排行榜核分（重放一局）
    fuzz_engine.js  隨機關卡壓力測試
    build.py        打包成 模式1-车站与步行.html、模式1-关卡编辑器.html
  mode2-metro/ …    之後的模式，照同樣的樣子建
```

## 怎樣玩 / 打包 / 測試

- 玩：雙擊 `开始.html`（入口）或 `mode1-bus/模式1-车站与步行.html`。
- 打包：`python game-feeder/v7/build.py`（改了任何源檔、包括 `shared/`，都要重新打包）。
- 測試：`node game-feeder/v7/mode1-bus/test_engine.js`（約 5 分鐘）。
- 截圖 / 指定局面：網址後加 `#map=l2&intro=0&tips=0&layout=0-7-11&t=400`（`intro=0` 不彈開場卡，`tips=0` 不出提示）。

## 加一個新模式

1. 新建 `modeN-名字/`，頁面引用 `../shared/style.css`、`../shared/i18n.js`、自己的 `strings.js`、需要的話 `../shared/tips.js`。
2. 引擎、關卡、文字都放在自己的資料夾裡，不要改別的模式的檔案；需要共用的東西先放進 `shared/`，並在這份說明裡寫一句。
3. 寫自己的 `build.py`（照 `mode1-bus/build.py`），`v7/build.py` 會自動找到它。
4. 在入口頁 `index.html` 把那張卡從「設計中」改成連結。

## 引導提示怎樣加

在模式的 `ui.js` 裡列出「時刻 → 文字」（例如 `TIPS={l1:{start:'tip.start',placed:'tip.placed',full:'tip.full',break:'tip.break'}}`），在那個時刻呼叫 `Tips.fire('placed', 旁邊的元素)`。文字放在 `strings.js`。每條提示每個瀏覽器只出一次；玩家按「不再提示」就全部關掉。

## AI 示範（臨時，之後會刪）

模式 1 每一關左上有「AI 示範」：選一條分數線（過關 / 高分 / 大師），AI 從開局開始把它的擺法和每一次挪站演一遍，左欄逐條寫為什麼（這一輪哪個屋苑人多、新位置接哪些屋苑）。打法由 `bots/v7_demo_plans.js` 算好寫進 `mode1-bus/demo-plans.js`（改了關卡數值要重跑），頁面重演的分數和機器人算的一致（12 套都核對過）。

**刪除方法**：刪 `mode1-bus/demo.js`、`mode1-bus/demo-plans.js`；`mode1-bus/index.html` 和 `build.py` 裡標「AI demo」的兩個檔名；`ui.js` 裡標「AI demo」的幾行（`TL_GAME.demo`、frame 裡的 `clamp / tick / onBreak`、`put` 和 `reset` 開頭各一句、`tl:level` 事件）。不刪也不影響遊戲：沒有 `demo.js` 時這些行什麼都不做。

## 和 v6 的關係

v7 模式 1 的規則和數值與 v6 相同（v6 第 1–3 關和第 5 關）。v6 第 4 關（青衣 · 習慣）沒有放進模式 1：習慣是「一週一週地變」，屬於之後的地鐵模式。v6 原樣保留。
