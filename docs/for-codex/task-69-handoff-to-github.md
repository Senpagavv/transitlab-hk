# 任务 69：交接——把你做的任务推到 GitHub 的分支上，让另一台电脑接着做

> 给原电脑（发起人这台）的 Codex。等任务 63–67 做完（或额度快用完时）就做这个。之后的工作会换到同学的电脑上，从 GitHub 拉下来继续；Claude 不再参与审查。交接总说明见 `docs/HANDOFF-2026-10-15.md`。

## 一、要的是什么
你在桌面 `%USERPROFILE%\Desktop\TransitLab五模式-Codex\任务NN\` 里做的东西，另一台电脑看不到。把每个任务变成 GitHub 上的一个**分支**：
- **做完的**：`codex/task-NN`——在当前 `main` 上应用你的增量，一个或几个提交。
- **没做完的**：`codex/task-NN-wip`——已经做好的部分照样提交，加一份 `docs/for-codex/handoff/task-NN-状态.md`：做到哪、没做什么、下一步、怎么验证、已知问题。
- **完全没开始的**：不建分支，在第四节的汇总里写「未开始」。

## 二、硬规矩（这次允许用 git，但只限下面这些）
1. **只碰 `codex/` 开头的分支。绝不提交、合并、推送到 `main`，绝不 `--force`，不删除任何远端分支，不改 git 配置**（用本机现有的身份和凭据）。推送失败（要登录等）就停下，在汇总里写清楚，交给发起人。
2. 每个分支都从**最新的 `origin/main`** 开出来：`git fetch origin` → `git switch -c codex/task-NN origin/main`。
3. 只放这个任务书白名单里的文件改动，加上 `docs/for-codex/handoff/` 下的说明文件。**不放**：桌面上的截图、报告 JSON、批检结果、离线单文件（`模式*.html`、`开始.html`、`关卡编辑器.html`）、`site/`、`node_modules`、任何 > 5 MB 的文件。截图需要的话挑最多 10 张小图放 `docs/for-codex/handoff/task-NN/`。
4. 提交前必须检查并在汇总里写结果：
   - `git diff --cached --stat` 只有该任务的文件；
   - 没有 `.env`、没有密钥（搜 `DEEPSEEK`、`sk-`、`api_key`、`Bearer`）、没有 `data/raw/` `data/cache/` `data/snapshots/`；
   - 该任务书要求的检查（引擎检查、`check_strings.js`、后台测试等）在这个分支上重新跑一遍通过；没通过的写进状态说明，不要硬推成「做完」。
5. 合并冲突（`main` 在你开工后变了）：在分支上按 `main` 的新版本重新应用你的改动；解决不了的写进状态说明，不要改动不属于你的文件。
6. 提交说明用中文：`任务NN：……（Codex，原电脑；未经 Claude 审查）`。

## 三、每个任务的步骤
1. `git fetch origin && git switch -c codex/task-NN origin/main`（没做完的用 `codex/task-NN-wip`）。
2. 把桌面副本里这个任务改过的文件复制回仓库对应位置（按你的增量清单；删除的文件用 `git rm`）。
3. 写 `docs/for-codex/handoff/task-NN-说明.md`（做完的：就是你的交回说明；没做完的：`task-NN-状态.md`）。
4. 跑第二节第 4 条的检查。
5. `git add` 只加该任务的文件 → `git commit` → `git push -u origin codex/task-NN`。
6. `git switch main`，回到干净状态，再做下一个任务。

## 四、最后
在 `main` 之外再建一个 `codex/handoff-status` 分支，只加一个文件 `docs/for-codex/handoff/汇总.md`，推上去：
| 任务 | 分支 | 做完 / 做到一半 / 未开始 | 检查结果 | 下一步给新电脑的话 |
并附上你在桌面上的完整交付位置，万一需要可以由发起人手动拷过去。
完成后告诉发起人：推了哪些分支、各自状态。
