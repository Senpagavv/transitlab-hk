## 改了什么（一两句白话）


## 为什么


## 前后对比（改到模型或数据时必填：改之前 → 改之后的关键数字）


## 检查（改到哪类就勾哪类）
- [ ] 改到 `pipeline/` 或 `data/`：受影响的步骤和下游都重跑了（顺序见 `docs/handoff.md` 第 9 节；改了需求或路网要跑 `pipeline/feedback_loop.py`）
- [ ] `uv run python pipeline/audit.py` 没有新的 FAIL（已知的 2 项除外）
- [ ] `uv run python pipeline/check_docs.py` 通过
- [ ] `uv run pytest` 全过
- [ ] 改到前端：`cd frontend; npm run build` 和 `npm run lint` 通过
- [ ] `docs/handoff.md` 顶部加了记录；新步骤写进 `docs/for-codex/pipeline-manifest.md`
- [ ] `CHANGELOG.md` 最上面加了一条（时间、改了什么、为什么、怎么验证）
- [ ] 新增或改动的数据/参数已在 `model/registry/data_tiers.toml` 登记级别（A/B/C/D）并重新生成 `docs/data-tiers.md`
- [ ] 没有提交 `.env`、`data/cache/`、`data/snapshots/` 或 >50 MB 的文件
