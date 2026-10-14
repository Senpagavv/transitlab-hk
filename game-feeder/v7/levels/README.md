# 關卡檔：做一關、放進去、拿出來

> 寫給要做關卡的組員。**一關＝一個 JSON 檔。** 放進 `levels/m1`～`m4`（第幾關的玩法就放第幾個資料夾），跑一次打包，這關就出現在遊戲裡；檔名裡的 `key` 和現有的關卡一樣，就**取代**那一關；刪掉檔案再打包，就**乾淨移除**，不留別的東西。

## 一、四步

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
