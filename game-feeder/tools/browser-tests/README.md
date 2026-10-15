# 真浏览器验收脚本（Claude 2026-10-15 用过的）

用 Node 的 CDP 直接驱动无头 Edge，**真鼠标**（`Input.dispatchMouseEvent`）点页面，截图并打印结果。都是验收用，不改项目。

在另一台电脑上用之前要改的地方（每个文件开头几行）：
- `EDGE`：Edge 的路径（默认 `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`）。
- 截图和浏览器临时目录写在 `F:/tmp-shots/`：换成本机一个可写的目录。
- 页面地址默认本机后台 `http://127.0.0.1:8000/feeder/…`（先跑 `scripts/start-feeder.cmd`）。

| 脚本 | 测什么 | 用法 |
|---|---|---|
| `shot.js` | 打开任意网址、等几秒、执行一段 JS、截图 | `node shot.js <名字> <网址> [毫秒] [JS] [-- 下一组…]` |
| `sb3_mouse.js` | 沙盘第三版：悬停看数据、画线放站、选区、只算这一片（计时）、全港一轮、改人口卡、AI 卡、用第三关玩这一片 | `node sb3_mouse.js` |
| `m5_fix.js` | 沙盘：点车站位置选中的分区对不对、默认工具、Esc | `node m5_fix.js` |
| `ai_modes.js` | 沙盘 AI 卡出关卡（会调真 AI，用发起人的密钥），可指定玩法 | `node ai_modes.js "<一句话>" <标签> [2|3|4]` |
| `lv57.js` | 第二到四关逐关：开场卡标题、提示、逐年表，「AI 示範」跑完分数和关卡文件对不对 | `node lv57.js [master|high|pass] [关卡编号…]` |
| `ed_v7.js` | 第二到四关编辑器：画屋苑去处和河、机器人试算、试玩、导出 | `node ed_v7.js [编辑器网址]` |
| `ed_m3.js` | 第三关编辑器：画路、接长、画港铁线、放站、擦断路 | `node ed_m3.js` |
| `datamap.js` | 全港数据地图（后台根地址 `/`）：电脑和手机尺寸，点分区、搜索、返回链接 | `node datamap.js` |
| `timeline.js` | 沙盘打开时各数据文件的下载时间和截图 | `node timeline.js [网址]` |

静态版网站的整站检查用 `game-feeder/tools/deploy/check_site.js`（见 `tools/deploy/README.md`）。
