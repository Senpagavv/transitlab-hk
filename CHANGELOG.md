# 改动日志 / Changelog

> **规则 / Rule**：每次改动都在最上面加一条——**时间（香港时间）、提交编号、改了什么、为什么、怎么验证的**；本地提交后立即推送到 GitHub，保证本地和线上一致。
> Every change adds an entry at the top — **time (HKT), commit, what changed, why, how it was verified** — and is pushed to GitHub right after the local commit, so local and online stay identical.
> 更详细的过程和数字见 [`docs/handoff.md`](docs/handoff.md) 顶部。Details and numbers: top of `docs/handoff.md`.

## 2026-10-02

### 15:00 · 数据与参数可信度分级登记表；改动日志 / Confidence registry; changelog
- **改了什么**：新增 `model/registry/data_tiers.toml`——105 项（35 数据集、27 模型产物、43 参数）逐项标 **A 实测 / B 校准推算 / C 依据推断 / D 示意假设**，写明出处、依据、在用/待查/不做；
  `model/registry/build_doc.py` 自动生成中英对照的 [`docs/data-tiers.md`](docs/data-tiers.md)；`tests/test_data_tiers.py` 核对登记值与审计文件一致、43 个数据来源都已登记、文档是最新的。
  新增本日志；`AGENTS.md`、上手指南、合并请求模板加入「每次改动写日志、本地与 GitHub 同步」。
- **What**: 105-item confidence registry (A measured / B calibrated / C evidence-based estimate / D illustrative assumption) with sources and status; bilingual tier document generated from it; tests keep it in sync with the audit files. This changelog; the rule added to AGENTS.md, onboarding and the PR template.
- **为什么**：发起人要求后台标清哪些是实测、哪些是推断、哪些是假设，使用时分级提示（教学用途，C/D 级仅供参考）。
- **验证**：pytest 55 项全过（新增 4 项）。

### 09:52 · `24367d5` 一键环境安装 / One-click setup
- `scripts/setup-windows.cmd`（双击）、`setup-mac.sh`、`start-dev.sh`；依赖清单补 pillow（第 36 步要用，原来缺）、rasterio、scipy。
- 验证：Windows 版在本机实跑 5 步全过；Mac 版未实测；pytest 51 全过。

## 2026-09-28
### 20:17 · `7793df5` 推算方法总目录入库；时段塞车指数修正
- `docs/methods-catalogue.md`（英文 `.en.md`）、`docs/methods-course-notes.md`（Codex 整理，对照 CA5236）。
- Codex 发现第 27b 步时段权重写死 `(车流比)^4`，而塞车曲线 β 已是 2 → 改为读 `bpr-parameters.json`；权重 0.70/0.66/0.59/0.68 → 0.80/0.80/0.74/0.81，回代 1 轮稳定，东铁 1.36 → 1.37。
- 验证：审计 118/120（两项已知局限），pytest 51，文档体检通过。

### 19:17 · `36ffece` Codex 任务书 43（推算方法总目录）

## 2026-09-26
### 15:17 · `29a48c0` 双语文档：组员加入指南（中/英）、上手指南英文版
### 14:47 · `4fa62c7` CODEOWNERS：`data/`、`pipeline/` 改动须项目负责人批准
### 14:40 · `40e4af2` 数据文件不做换行转换（各电脑上 SHA-256 指纹一致）
### 14:39 · `bac3449` 上传准备：原始数据入库（法定图则走 Release 附件）、AGENTS.md、合并请求模板、数据来源总目录
### 14:26 · `dfa0065` 记录两项已知局限：逐站 GEH 18%、巴士 0.84（发起人确认不再改动）
### 14:19 · `4927906` 出行分布加区内系数（沙田自给率 21% → 31%）+ 底座整体审查
- 验证：审计 118/120，pytest 51；28–35 按新需求重跑。
### 13:14 · `0434ca8` 塞车曲线按探测器实测（alpha 0.378、beta 2）+ 塞车回代方式选择；修探测器车流翻倍
- 验证：走廊 GEH<5 23.5% → 29.4%；探测器路段早高峰/深夜 模型 1.06 → 1.14（实测 1.22）。

## 2026-09-25
### 21:15 · `8e09161` 第一次存档：模型底座 + 隧道排队 + 海水边界 + 上传前检查
- 底座补全（36 土地用途、37 法定图则、38 地价、39 公交分配）；隧道排队 6 分钟；接驳与小游戏不跨海/水塘；上传前密钥与路径检查。

## Git 之前（2026-09-15 – 09-25，详见 handoff）/ Before Git
- 09-15 项目骨架；09-16 底图、实时车流、普查与吸引端数据；09-17 455 个交通分区、2026 人口、开车/公交时间矩阵；
  09-18 出行生成、分布、方式选择；09-19 – 09-24 早高峰、货车、道路分配、车队沙盘（28–35）；09-25 方向改为「画新线」规划游戏，修桥/修地铁原型。
