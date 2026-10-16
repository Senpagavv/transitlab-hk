# AI 出关卡调教 / Level-AI acceptance

默认离线：`chat()` 被固定 JSON 回复替换；脚本不读取 `.env`，不查询密钥，不联网。需要 Node.js 和项目 Python 依赖。

```powershell
uv run python -m pytest backend/test_feeder_ai.py game-feeder/tools/ai-test/test_scoring.py -q -p no:cacheprovider
node --test game-feeder/tools/ai-test/test_frontend.js
uv run python game-feeder/tools/ai-test/run_sentences.py --offline
```

仅 Claude 跑真 AI，下面命令由 Claude 执行；Codex 没有执行。`--live` 必须显式指定。凭据只由启动进程注入，脚本不读取或输出密钥。

```powershell
uv run --env-file .env python game-feeder/tools/ai-test/run_sentences.py --live --repeat 3 --out game-feeder/tools/ai-test/results/task67-live
```

先试少量可加 `--limit 5`。60 句 × 3 轮 = 180 次关卡请求；每次后台最多尝试两次。输出 JSON 与 Markdown 表，包括原始 AI 回复、重试次数、耗时、每个维度的结果，以及 `unstable_cases`。

验收口径：

- 每句定义玩法、片区、改动；`changes: []` 必须完全不改背景需求。`add` 必须保留原句人数，不能用任意百分比代替。
- `pct_range` 只用于原句有变化但没有精确规模的情况；范围是游戏测试约定，并非实测。`by_year_range` 只用于“陆续”等逐年措辞。
- `changes` 同时检查地点、类型、数量、正负方向、时间；`no_extra` 单独检查多加的地点／类型和重复项。少改也会在 `changes` 扣分。
- 普通句子固定一个片区；少数测试允许的备选片区／地点明确列在 JSON，不会只看“成功返回”就通过。
- `unavailable` 的两句是北都／古洞缺底板，只认 `area_empty` 和缺数据提示；不得当作安全拒绝。玩法、片区和改动打分显示 `—`，不混入对应分母。
- 中文标题自动查 4–10 字，英文查 4–10 词。“自然不别扭”仍需人审；标题长度通过不等于用词合格。
- 这里只验请求，未运行机器人验收整关。固定回复的 60/60 只能证明链路正常，不能当作真 AI 通过率。

菜单格式为 `{areaKey: {places: [...], roads: [...]}}`。前端与脚本共用 `client.js.makeNames()`；旧数组仍可用于人口／岗位，不能当作道路菜单。未命名道路和没有中文名／既有双语别名的道路不进入中文菜单。

## English

The default is offline and replaces `chat()` with fixed JSON replies. No credential or `.env` reads occur offline. Only Claude should opt in to `--live`; the launch command supplies credentials. Run the commands above from the project root.

The JSON/Markdown report checks outcome, gameplay, area, exact changes, extra changes, title length, period and required notes. Raw replies and retries are retained. Repeated runs report unstable area/place/amount choices. Empty changes must stay empty; absolute counts must stay absolute. The two unavailable northern cases test data-coverage errors, not safety refusals. Natural title wording and playable-level acceptance require separate review. Offline fixture scores are not measurements of live-model quality.
