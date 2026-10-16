# 任务64：GitHub 交接状态

日期：2026-10-16（香港 / 上海时间）。
状态：**做到一半 / WIP**。
分支：`codex/task-64-wip`；创建基线：最新 `origin/main` = `4d9056c6128d3956954683b30c6a74af7ed44b9d`。
完整桌面交付位置：`C:\Users\赵禹博\Desktop\TransitLab五模式-Codex\任务64`。

已转交原白名单内 23 个文件，门槛、示范、路名与机器人增量已保存。未纳入 mode3-roads/demo.js、mode3-roads/ui.js：虽桌面说明记载原对话追加许可，任务69本次严格限定任务书白名单，故不扩展。m3-1 的旧内置示范仍优先于新 level.demo，页面可能继续显示旧的 3321 分；选中道路标题仍被强制大写。本分支不能作为任务64完整验收版本。请新电脑先核实并取得相应范围授权后处理这两个位置，再验证页面示范 3531 和路名大小写。

## 本分支重新检查

| 检查 | 结果 | 秒 |
|---|---|---:|
| `strings` | 通过 | 0.2 |
| `mode2-metro` | 通过 | 0.09 |
| `mode3-roads` | 通过 | 0.17 |
| `mode4-tod` | 通过 | 0.11 |
| `levelgen` | 通过 | 3.53 |
| `levels-replay` | 通过 | 0.53 |
| `strict-replay` | 通过 | 1.17 |

复现命令（项目根目录；本机 Python 命令可换为 `uv run python`）：

```powershell
node game-feeder/tools/check_strings.js
node game-feeder/v7/mode2-metro/test_engine.js
node game-feeder/v7/mode3-roads/test_engine.js
node game-feeder/v7/mode4-tod/test_engine.js
node --test game-feeder/bots/v7_levelgen_tests.js
node game-feeder/bots/v7_levels_batch.js verify
```

注意：新关卡JSON需要重新生成 `levels/registry.js` 才会进入网页。接手后在本分支运行 `python game-feeder/v7/build.py`，再验证页面；按本次白名单与禁入规则，生成的registry和离线单文件未提交。39套逐操作重放读取本分支引擎、关卡与桌面12份 `验证/*-search.json`，不重新进行已完成的长时间搜索。

## 文件范围与提交前检查

仅转入本任务白名单源码 23 个文件；交接文档与精选小图全部位于 `docs/for-codex/handoff/`。
精选截图 7 张（最多10张）。未提交桌面报告 JSON、批检结果、ZIP、离线单文件、site、node_modules 或超过5 MiB文件。
提交前执行 `git diff --cached --stat`，逐文件核对本任务白名单；检查 `.env`、密钥关键字与禁入数据目录。关键字出现在代码变量、提示或测试占位符时单独复核，不把变量名当作真实凭据。最终检查结果也记入交接汇总。

源码清单：

- `game-feeder/bots/v7_metro_grow.js`
- `game-feeder/bots/v7_quality_apply.js`
- `game-feeder/bots/v7_quality_lib.js`
- `game-feeder/bots/v7_quality_review.js`
- `game-feeder/bots/v7_roads.js`
- `game-feeder/bots/v7_tod.js`
- `game-feeder/bots/v7_tod_plus.js`
- `game-feeder/v7/hub/hub.js`
- `game-feeder/v7/levels/m3/m3-1.json`
- `game-feeder/v7/levels/m3/m3-2.json`
- `game-feeder/v7/levels/m3/m3-3.json`
- `game-feeder/v7/levels/m3/m3-4.json`
- `game-feeder/v7/levels/m4/m4-1.json`
- `game-feeder/v7/levels/m4/m4-2.json`
- `game-feeder/v7/levels/m4/m4-3.json`
- `game-feeder/v7/levels/m4/m4-4.json`
- `game-feeder/v7/mode2-metro/strings.js`
- `game-feeder/v7/mode2-metro/ui.js`
- `game-feeder/v7/mode4-tod/demo-plans.js`
- `game-feeder/v7/mode4-tod/strings.js`
- `game-feeder/v7/mode4-tod/ui.js`
- `game-feeder/v7/shared/levelgen/generate.js`
- `game-feeder/v7/shared/levelgen/simplify.js`

白名单外排除：

- `game-feeder/v7/mode3-roads/demo.js`
- `game-feeder/v7/mode3-roads/ui.js`

## 接手顺序

1. 在新电脑 fetch 并检出该分支，先读本文，再读 `task-64/原交付说明.md`。
2. 按表中检查复验，结合已知问题审阅；本次没有合并或推送 main。
3. 跨任务合并时重新检查共享文件，尤其 task64/65 的 strings、task64/66 的 bots、task64/67 的关卡生成流程。

English: This branch contains only the task whitelist and handoff documentation. Validation was rerun on this branch. Review and integration belong to the receiving computer; no Claude review or main-branch merge has occurred.
