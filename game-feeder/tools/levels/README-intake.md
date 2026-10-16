# 关卡收件 / Level intake

在项目根目录运行；只用 Node 内置模块，不需要安装包。
Run from the project root. Uses Node built-ins only; no package installation.

```powershell
node game-feeder/tools/levels/intake.js "D:\收件\组员.zip" --out "D:\收件\处理结果"
node game-feeder/tools/levels/intake.js "D:\收件\组员文件夹" --out "D:\收件\处理结果2"
```

输出目录须全新或为空，不能与输入互相包含，不能指向 `v7/levels/`。不会读取 ZIP 内的程序、解压到原路径、写入正式关卡或替 Claude 决定是否取代旧关卡。
The output must be new or empty, separate from the input and outside `v7/levels/`. Archive members are never executed or extracted to their supplied paths. Existing levels are never replaced automatically.

输出 / Outputs:

- `报告.md`：每关一行，冲突 / 太容易 / 太难放前面；包含组员原门槛和新门槛、各类数量、示范分及问题。中文为主，保留英文规则摘要。
  One row per level, with conflicts/easy/hard cases first; original/new thresholds, object counts, replayed demo scores and issues.
- `报告.json`：完整机器人配置、耗时、简单方案定义、最佳分重放、各示范逐操作核对结果、输出 SHA-256。
  Machine-readable search settings, timings, simple-plan definition, best replay, demo replay evidence and output hashes.
- `mN/<key>.json`：处理成功的关卡，Claude 看过报告后可以复制进 `v7/levels/mN/`。
  Calibrated levels, ready for manual installation after report review.
- `待确认/流水号/mN/<key>.json`：与登记表或本批编号冲突的每个候选版本，全部分开保存。
  Every conflicting candidate is kept separately for review. Nothing is silently overwritten.

标题三语缺失和未知站名列为问题，不翻译或猜站名。坏 JSON / 格式 / 引擎失败 / 超时不输出关卡；同批其他有效文件继续处理。编号对照启动时的 `levels/registry.js`；新增文件未打包进登记表时，应先让主项目维护者更新登记表再收件。
Missing title languages and unknown station names are reported without invention. Invalid or timed-out levels are not emitted; valid siblings continue. Conflicts use the current generated registry, so newly installed levels should be registered before intake.

退出码 / Exit codes: `0` 无问题 / clean; `2` 报告已生成、需要审阅 / report generated with review items; `1` 参数或输出路径等致命错误 / fatal CLI or output-path error.

## 搜索与重放 / Search and replay

默认完整机器人：第二玩法 400 次重启，第三玩法 18 次，第四玩法 60 次。第一玩法穷举三个候选站的全部静态开局，再从前三个开局搜索合法轮间挪站及轮内机动；规则和计分完全来自原引擎。第二到四玩法沿用原机器人完整搜索，额外纳入简单方案；第三玩法按任务57用三个最强简单方案做原有爬山和第二期改善。
Defaults: mode 2 = 400 restarts; mode 3 = 18; mode 4 = 60. Mode 1 enumerates all three-stop static openings, then searches legal break and extra moves from its top three openings. All scoring uses the unchanged engines. Rail modes run the existing full bots plus simple schemes; mode 3 also improves three strongest basic layouts using its existing two-phase routines.

门槛为 `round(best × [0.40, 0.65, 0.88])`。每档优先挑对应分段里较简单的方案；分段没有方案时选已知合法达标方案，所以不同档有可能相同或跨过下一条线。大师使用已找到的最好方案。挑战关清除输入自带示范，输出不含 `level.demo`。所有输出示范逐操作合法重放、核对整数总分及对应门槛；最佳方案也重放。搜索不是全局最优证明，第四玩法使用本项目快照中的 `v7_tod.js`；本快照没有独立 `v7_tod_plus.js`。
Thresholds are rounded best × 0.40/0.65/0.88. Simpler plans within each score band are preferred; a legal plan above the line is used if a band has no candidate. Demos may therefore share plans or exceed the next line. Master uses the best found. Challenges have no embedded demos. Every emitted demo and the best plan is legally replayed against the engine. Search is not proof of a global optimum; this snapshot uses the available `v7_tod.js` and contains no separate plus bot.

“太容易”比较同类简单方案的最高分与大师线。第一玩法简单方案=静态三站、全局不挪；第二/三玩法=最短 L 线、两端两站、单列车、无第二期；第四玩法在此基础上按文件顺序每年最多售两块住宅。最好 < 50 标太难。
Easy means the strongest enumerated simple scheme reaches master. Simple schemes: static three-stop openings in mode 1; shortest Manhattan L, two endpoint stations, one train, no phase 2 in rail modes; mode 4 additionally sells eligible homes in file order, up to two per year. Best below 50 is flagged hard.

每关默认超时 1200 秒，Node heap 上限 384 MiB。可用 `--timeout 1800` 延长。`--restarts N` 显式改搜索次数，主要用于诊断或加长复核，报告会记录；第一玩法仍完整枚举静态开局。
Each level has a default 1200-second timeout and a 384 MiB Node heap cap. Use `--timeout 1800` to extend it. `--restarts N` explicitly overrides restart counts for diagnosis or deeper checks and is recorded in the report. Mode 1 still enumerates all static openings.

## 第一玩法示范格式 / Mode 1 demo format

```json
{
  "level": {
    "tiers": [80, 130, 176],
    "demo": {
      "tiers": [80, 130, 176],
      "best": 200,
      "pass": {"opening": [[1,1],[2,1],[3,1]], "moves": [], "score": 90},
      "high": {"opening": [[1,1],[2,1],[3,1]], "moves": [{"r":2,"id":1,"cell":[2,2]}], "score": 140},
      "master": {"opening": [[1,1],[2,1],[3,1]], "moves": [{"r":2,"at":55,"id":1,"cell":[2,2]}], "score": 200}
    }
  }
}
```

以上只是字段结构示例，不是可玩关卡或已校分方案。`opening` 恰好三格，依次是 A/B/C；`id` 从 0 开始；`r` 从 1 开始，表示第几轮；省略 `at` 是该轮开始前的停顿挪站，带 `at` 是该轮 `roundStart` 后的秒数，消耗机动次数。按时间排序，不可有非法或倒退操作。`score` 是完整结束时 `Game.delivered`。
This is a structural example, not a playable calibrated level. The three opening cells are A/B/C. Stop ids are zero-based; rounds are one-based. Omitted `at` means the break before that round; `at` is seconds after that round's actual `roundStart` and consumes the extra-move budget. Moves are chronological and legal. Score is final `Game.delivered`.

`demo.js` 取方案顺序：内置 `TL_DEMO_PLANS[map]` → `D.demo` → 当前关卡的 registry / active pack 内 `level.demo`。最后两项是因为现有第一玩法 `data.js::make()` 没有把 demo 复制到 D；只改了 demo.js 取方案位置，未改 data.js。
Lookup order: built-in plans, then `D.demo`, then the selected registry/active-pack level's demo. The latter supports the current data loader, which omits the demo property. Only plan lookup sites in `demo.js` were changed.

## 不可信输入与局限 / Input limits

只读 UTF-8 JSON（接受 BOM）。单文件 2 MiB，ZIP 容器 / 累计 JSON 64 MiB；512 项；目录 16 层；JSON 32 层。只支持 stored/deflate、UTF-8/ASCII 文件名的普通 ZIP；拒绝 ZIP64、分卷、加密、符号链接、特殊文件、路径穿越、绝对路径、非 JSON、CRC/头不一致、压缩炸弹。目录中的非 JSON 也逐项拒绝并写报告。不会把 ZIP 路径拿来生成输出路径。
Only UTF-8 JSON (optional BOM), at most 2 MiB per file, 64 MiB ZIP/aggregate JSON, 512 entries, 16 directory levels and 32 JSON levels. Regular stored/deflate ZIPs with UTF-8/ASCII names are supported. ZIP64, split/encrypted archives, links, special files, traversal, absolute paths, non-JSON members, inconsistent CRC/headers and oversized inflation are rejected. Archive paths never become output paths.

工具有额外资源检查：棋盘边长 1–128；第一玩法 3–64 个候选站、最多 32 轮 / 10000 人；铁路玩法最多 32 年、64 个屋苑 / 去处、128 条路、256 块地，列车费用和运力须为正。这些是收件工具的运行保护，不是对原规则引擎的修改。较大但合理的关卡可先人工审查后调整工具上限。
Resource guards additionally cap board edges at 128, mode-1 candidates at 64, rounds at 32 and trips at 10000; rail modes at 32 years, 64 origins/destinations, 128 roads and 256 lots. Train cost/capacity must be positive. These guards protect intake execution and do not alter engine rules.

本工具只做脚本检查和逐操作重放；关卡摆法、中文文案和真实网页交互仍由 Claude 最后审阅。已存在内置示范的同编号关卡，游戏按要求仍优先使用内置方案；取代旧关时必须检查这一点。
The tool verifies data and engine replays. Layout, wording and final browser interaction remain the reviewer's responsibility. Built-in plans retain priority for matching keys; review this when replacing an existing level.

## 自测 / Self-test

```powershell
cd game-feeder
node tools/levels/intake.test.js
node tools/levels/intake.test.js --full "D:\收件\任务66自测-新目录"
```

快速测试覆盖 ZIP 安全、格式、路径保护。完整测试以脚本另存四玩法各两关，包含教学和挑战关；另带坏 JSON、同批重复编号、`../逃逸.json` 三个坏文件，用默认完整机器人跑一遍；再跑文件夹输入、低于50、三语缺失和站名不存在的案例，输出报告供复核。
Fast tests cover archive security, validation and output protection. Full tests generate two levels per mode (tutorial/challenge), add malformed JSON, a duplicate key and a traversal member, run default full searches, then exercise folder input, low scores, missing title language and unknown stations. Reports remain available for inspection.
