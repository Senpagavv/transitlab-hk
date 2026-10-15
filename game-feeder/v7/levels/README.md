# 關卡檔：做一關、放進去、拿出來

> 寫給要做關卡的組員。**一關＝一個 JSON 檔。** 放進 `levels/m1`～`m4`（第幾關的玩法就放第幾個資料夾），跑一次打包，這關就出現在遊戲裡；檔名裡的 `key` 和現有的關卡一樣，就**取代**那一關；刪掉檔案再打包，就**乾淨移除**，不留別的東西。

## 零、最簡單：用關卡編輯器（2026-10-15）

不用碰程式和 JSON：

1. **打開編輯器**：入口頁右上「✎ 關卡編輯器」；或直接雙擊 `v7/editor/关卡编辑器.html`（第二到四關）、`v7/mode1-bus/模式1-关卡编辑器.html`（第一關）。兩個編輯器頂上可以互相切換。
2. **選玩法、畫地圖**：屋苑（人從這裡出門）、去處（市中心、就業區）、河；第三關加道路和現有港鐵線，第四關加空地。點一個東西可以在右邊改名字和數字；「從這裡開始」可以拿現有的關卡改。
   - **河**：畫了河之後勾「河擋住走路」，人就不能走過去，只能坐地鐵或開車過河（第一關的河本來就擋路，路過河＝橋）。
3. **填「關卡資料」**：編號（如 `m3-5`，不填會自動給一個）、標題、開場兩句、在全港地圖上放在哪個站、作者、數字從哪裡來。
4. **試玩、試算**：「▶ 試玩」用真的遊戲頁打開這關；「機器人試算」約 8–14 秒，估一個門檻（粗估，最後由 Claude 用完整的機器人定）。
5. **導出 .json → 壓成 zip → 交給發起人**。Claude 會：`levels.js check` 檢查、機器人定門檻、教學關做三套 AI 示範、放進 `levels/mN/`、打包、真滑鼠驗收、提交。

## 一、四步（手寫 JSON 的做法）

1. **從一個現成的關卡開始**：複製 `levels/examples/` 裡同一個玩法的檔案（`l2.json`＝第一關、`m2-1.json`＝第二關、`m3-1.json`＝第三關、`m4-1.json`＝第四關），改名，放進 `levels/m3/`（以第三關為例）。
   也可以從任何現有關卡導出：`node game-feeder/tools/levels/levels.js export 3 m3-1 我的關卡.json`
2. **改內容**：
   - `key`：新的、不重複，小寫字母、數字和「-」，例如 `m3-2`（第三關第 2 個）。和現有的一樣＝取代它。
   - `order`：在這個玩法裡排第幾；`challenge: true`＝挑戰關（有排行榜、沒有 AI 解法；每個玩法第 4 個）。
   - `title`（繁 / 簡 / 英）、`story`（開場兩句）、`hub`（在全港地圖上的位置：`{"station": "沙田"}`）、`author`、`source`（數字從哪來）。
   - `level`：關卡本身。每個欄位是什麼意思，看那個玩法的 `data.js` 開頭的註釋（例如 `mode3-roads/data.js`：屋苑 `origins`、去處 `destinations`、路 `roads`、已有的地鐵 `lines`、海 `water`、預算和規則數字、門檻 `tiers`）。
3. **檢查**：`node game-feeder/tools/levels/levels.js check levels/m3/我的關卡.json`
   會檢查格式，再把這關放進引擎、什麼都不建跑一次（第三關會印出每年的塞車和最塞的路）。有錯會說哪裡錯。
4. **定門檻、打包**：
   - 讓機器人找最好的方案：`node game-feeder/bots/v7_roads.js 18 --level levels/m3/我的關卡.json`（第二關 `v7_metro_grow.js`、第四關 `v7_tod.js`）。只印結果，不會改別的檔。
   - `tiers` 一般取：過關 ≈ 最好 × 0.40、高分 ≈ × 0.65、大師 ≈ × 0.88，再自己玩一次調。
   - `python game-feeder/v7/build.py`：重新打包（會先把所有關卡檔登記進 `levels/registry.js`，打印每個檔「+ 新增 / ↻ 取代 / ✗ 有錯被略過」）。

打開：`modeN-*/index.html#map=<key>`（或打包後的單檔 `模式N-….html#map=<key>`）；入口頁的全港地圖會按 `hub` 放這關。

## 二、格式（tl-level/1）
```jsonc
{
  "format": "tl-level/1",
  "mode": 3,                 // 1 車站與步行、2 地鐵、3 路會塞、4 站旁開發
  "key": "m3-2",
  "order": 2,
  "challenge": false,
  "title": {"zh-Hant": "沙田·大圍", "zh-Hans": "沙田·大围", "en": "Sha Tin"},
  "story": ["…", "…"],
  "hub": {"station": "沙田"},
  "author": "", "source": "",
  "level": { /* 和那個玩法 data.js 裡 LEVELS 的一項一模一樣 */ }
}
```
AI 生成的關卡、以後玩家上傳的關卡，用的也是這個格式（多 `id`、`hash`、`source.request`）。

## 三、這套東西怎麼接起來（給寫程式的人）
- `levels/build_registry.py`：把 `builtin.json`（寫在各玩法 `data.js` 裡的關卡的資料：名字、順序、挑戰關、地圖位置）和 `m1…m4/*.json` 合成 `levels/registry.js`（`window.TL_LEVELS`：`list`、`mode(n)`、`get(n, key)`）。`v7/build.py` 會先跑它。
- 每個玩法頁先載入 `../levels/registry.js`，`data.js` 把 `TL_LEVELS.mode(n)` 裡有 `level` 的關卡併進自己的 `LEVELS`（同 key 取代），`#map=<key>` 選關。
- 機器人 `--level <檔案>`：換成這個關卡再搜，不寫檔。
