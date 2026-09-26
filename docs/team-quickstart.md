# TransitLab HK · 组员加入指南

> 给第一次用 GitHub 的组员。照着做一遍大约 30–60 分钟，做完你就能看到全部代码、数据和文档，也能提交自己的改动。
> 项目仓库：**https://github.com/Senpagavv/transitlab-hk** （私有，只有被邀请的组员能打开）
> 有问题在群里找 Benny。

## 这个项目是什么（30 秒）

一个**香港交通 + 土地模型**：用政府公开数据，把全港 455 个交通分区的人口、岗位、道路、公交串起来，算出早高峰"谁从哪到哪、坐什么、走哪条路"。
我们要在它上面做一个**画新线的规划游戏**：在地图上画一条新地铁线或新路，模型算出客流、塞车、人口怎么变、值不值得修。
仓库里已经有：全部代码、模型结果、原始数据、每一步的核对报告、说明文档。

## 第 1 步　注册 GitHub，把用户名发到群里

1. 没有账号的，打开 <https://github.com> → **Sign up**，用常用邮箱注册（已有账号跳过）。
2. 查自己的用户名：登录后点右上角**头像**，菜单最上面那行粗体就是用户名（不是邮箱）。
3. **把用户名发到群里**，Benny 会给你发邀请。

## 第 2 步　接受邀请

1. 邮箱里会收到 GitHub 的邮件：*Senpagavv invited you to collaborate on transitlab-hk*，点 **View invitation**。
   （没收到就直接打开 <https://github.com/Senpagavv/transitlab-hk/invitations>）
2. 点绿色的 **Accept invitation**。
3. 邀请 **7 天内有效**，过期了在群里说一声重发。

接受后，浏览器打开 <https://github.com/Senpagavv/transitlab-hk> 就能在线看所有文件和文档了。**只想看看的，做到这一步就够了。**

## 第 3 步　装软件（要下载到自己电脑、或者要改东西的人）

| 软件 | 干什么用 | 谁需要 |
|---|---|---|
| **GitHub Desktop**（推荐） | 图形界面下载项目、提交改动，不用敲命令 | 所有要改东西的人 · <https://desktop.github.com> |
| VS Code | 看代码、看文档（`.md` 文件右上角有预览按钮） | 推荐 · <https://code.visualstudio.com> |
| uv（Python 环境）、Node.js 20+ | 跑模型、跑网站 | 调模型、做前端的人，装法见仓库 `docs/onboarding.md` |

装好 GitHub Desktop 后，用你的 GitHub 账号登录它（首次打开会提示 *Sign in to GitHub.com*）。

## 第 4 步　把项目下载到电脑

用 GitHub Desktop：
1. 菜单 **File → Clone repository…**
2. 在列表里选 **Senpagavv/transitlab-hk**（看不到就是还没接受邀请，回到第 2 步）。
3. **Local path** 选一个**全英文、没有空格**的文件夹，例如 `D:\projects\transitlab-hk`。
4. 点 **Clone**，大约 450 MB，等它下载完。

（会用命令行的：`gh repo clone Senpagavv/transitlab-hk`）

## 第 5 步　先读这几份（按顺序）

| 文件 | 讲什么 |
|---|---|
| `README.md` | 首页：项目总览、怎么启动网站 |
| `docs/onboarding.md` | **上手指南**：按角色（看结果 / 前端 / 调模型 / 画新线）告诉你看哪里、怎么跑 |
| `docs/handoff.md` 顶部 | 现在做到哪了、准确度、已知局限 |
| `docs/data-sources.md` | 43 个数据来源：每个有多少条、什么内容、用在哪一步 |
| `AGENTS.md` | **给 AI 助手看的规则**：用 Claude / Codex / Cursor 干活的，让 AI 先读这个 |

## 第 6 步　日常怎么改东西（GitHub Desktop 版）

```
主分支 main（大家共用的正式版本）
   └─ 你自己的分支 ── 改、提交 ── 推上去 ── 发"合并请求" ── Benny 看过 ── 合进 main
```

1. **每次开始前**：点上面的 **Fetch origin**，有更新就点 **Pull origin**，拿到最新版本。
2. **开自己的分支**：点 **Current branch → New branch**，名字写 `你的名字/做什么`（例：`amy/zone-panel`），**Create branch**。
3. **改文件**（用 VS Code 或别的工具）。GitHub Desktop 左侧会列出你改了哪些文件。
4. **提交**：左下角 *Summary* 写一句话说明改了什么 → **Commit to 你的分支**。
5. **推上去**：点上面的 **Publish branch**（第一次）或 **Push origin**。
6. **发合并请求**：点 **Create Pull Request**，浏览器会打开，写清楚改了什么、为什么 → **Create pull request**，在群里@Benny。
7. 合并之后：**Current branch** 切回 `main` → **Pull origin**。

## 第 7 步　几条规矩（保护我们跑了很久的数据）

1. **不要直接在 `main` 上改**，都在自己的分支上改，再发合并请求。
2. **`data/raw/`（原始数据）永远不要手改**；`data/model/`、`data/web/`（模型结果）只能由程序生成，不要手改。
3. 想做实验：新开分支做，或者把结果输出到 `data/cache/你的名字/`（这个文件夹不会上传）。
4. **不要上传**：`.env`（放密钥的文件）、超过 50 MB 的文件。
5. **永远不要用 "Force push"（强制推送）**——它会覆盖别人的历史。
6. 改坏了**不要慌**：GitHub 上每一次改动都有记录，都能退回。在群里说一声就好。

## 附：少数人才需要的附件

要重跑"法定图则"（`pipeline/37`）或"土地用途"（`pipeline/36`）两步的人，到仓库的 **Releases**（右侧栏）下载 `transitlab-hk-extras-2026-09-26.zip`（399 MB），**解压到项目根目录**。其他人不用下载。
