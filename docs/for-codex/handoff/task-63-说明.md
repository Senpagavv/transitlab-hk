# 任务63：GitHub 交接说明

日期：2026-10-16（香港 / 上海时间）。
状态：**做完（待新电脑审阅，未经 Claude 审查）**。
分支：`codex/task-63`；创建基线：最新 `origin/main` = `4d9056c6128d3956954683b30c6a74af7ed44b9d`。
完整桌面交付位置：`C:\Users\赵禹博\Desktop\TransitLab五模式-Codex\任务63`。

完成沙盘手机抽屉、道路与车站资料、题目人口配置、北部门槛校准、推荐站位和引擎提速；P2 仅有讨论方案。基线引擎与本分支按三方案逐位核对。手机证据是浏览器模拟，实体手机速度未测；原交付曾有一轮 6.078 秒，不能保证所有设备都低于 6 秒。

## 本分支重新检查

| 检查 | 结果 | 秒 |
|---|---|---:|
| `strings` | 通过 | 0.09 |
| `test_engine` | 通过 | 18.86 |
| `test_scenarios` | 通过 | 1.64 |
| `test_periods` | 通过 | 10.64 |
| `bitwise` | 通过 | 65.16 |

复现命令（项目根目录；本机 Python 命令可换为 `uv run python`）：

```powershell
node game-feeder/tools/check_strings.js
node game-feeder/v7/mode5-sandbox/test_engine.js
node game-feeder/v7/mode5-sandbox/test_scenarios.js
node game-feeder/v7/mode5-sandbox/test_periods.js
```

三方案各5轮，共97,830个指标数值叶子逐位一致，同时严格比对每对OD状态和轮次记录。以下为本分支复测首轮耗时：

| 方案 | 原引擎秒 | 本分支秒 |
|---|---:|---:|
| Kowloon-East | 3.567 | 1.217 |
| kwu-tung-sheung-shui | 5.396 | 1.821 |
| north-orbital | 3.883 | 1.408 |

逐位复现使用原桌面 `验证/复现脚本/benchmark.cjs`，旧引擎从本分支基线的 `origin/main` 读取，新引擎指向本分支；仍用原 `验证/校准方案.json`。原始性能 JSON 按任务69保留本地，不提交。

## 文件范围与提交前检查

仅转入本任务白名单源码 7 个文件；交接文档与精选小图全部位于 `docs/for-codex/handoff/`。
精选截图 8 张（最多10张）。未提交桌面报告 JSON、批检结果、ZIP、离线单文件、site、node_modules 或超过5 MiB文件。
提交前执行 `git diff --cached --stat`，逐文件核对本任务白名单；检查 `.env`、密钥关键字与禁入数据目录。关键字出现在代码变量、提示或测试占位符时单独复核，不把变量名当作真实凭据。最终检查结果也记入交接汇总。

源码清单：

- `game-feeder/v7/mode5-sandbox/challenges.js`
- `game-feeder/v7/mode5-sandbox/engine.js`
- `game-feeder/v7/mode5-sandbox/experience.js`
- `game-feeder/v7/mode5-sandbox/layout.css`
- `game-feeder/v7/mode5-sandbox/layout.js`
- `game-feeder/v7/mode5-sandbox/ui.js`
- `game-feeder/v7/mode5-sandbox/vector.js`

## 接手顺序

1. 在新电脑 fetch 并检出该分支，先读本文，再读 `task-63/原交付说明.md`。
2. 按表中检查复验，结合已知问题审阅；本次没有合并或推送 main。
3. 跨任务合并时重新检查共享文件，尤其 task64/65 的 strings、task64/66 的 bots、task64/67 的关卡生成流程。

English: This branch contains only the task whitelist and handoff documentation. Validation was rerun on this branch. Review and integration belong to the receiving computer; no Claude review or main-branch merge has occurred.
