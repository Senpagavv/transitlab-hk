# 给 Codex 的任务 B：把投放面板的逐小时图改成双轴

> 复制「---」之间的全部内容给 Codex。工作目录 `F:\transitlab-hk`。
> **可与任务 A、C 同时进行**，三者碰的文件互不重叠。小任务，约一小时。

---

# 背景

你做的 `DeploymentPanel.tsx` 里那张「逐小时：接走行程与在跑车辆」的图有一个真问题：

**两条线各自按自己的最大值缩放**（`maxServed` 和 `maxBusy` 分别归一），所以
「接走 636 单」和「在跑 165 辆」被画成几乎重合的两条线。
**两个不同量纲画在同一个 0–1 的空间里，看起来像在说"它们一样"，但它们不可比。**
读图的人会以为每辆车跑了 4 趟，其实那只是缩放的巧合。

这不是错误，是**会误导**。要改成双轴，并且让两个轴的刻度可见。

# 一、硬约束

1. **只允许修改**：`frontend/src/components/DeploymentPanel.tsx`、
   `frontend/src/App.css`（**只在文件末尾追加，不改已有规则**）、
   `frontend/scripts/check-deployment.mjs`（只加检查，不改已有检查）。
   **其他任何文件都不得改动**——尤其不要碰 `frontend/src/map/` 和 `pipeline/`。
2. **不要新增任何 npm 依赖**，手写 SVG。
3. 不得运行 `pipeline/` 下的脚本，不得执行 git 写操作。
4. **必须过 `cd frontend; npm run build`**（不是 `npx tsc --noEmit`——
   两者检查强度不同，这个工程刚被这个差别坑过一次，构建过了才算过）。

# 二、要做成什么样

把 `HourChart` 改成双轴：

- **左轴**：`served_av`（接走行程，单位「单」），用主色 `var(--accent)`；
- **右轴**：`av_busy`（在跑车辆，单位「辆」），用琥珀色 `#b45309`（和利用率横幅同色）；
- 两个轴**各自标出最大值刻度和 0**，刻度文字用对应的颜色，让人一眼知道哪条线读哪个轴；
- 横轴保持 0/6/12/18/23 时；
- 图例保持现在的两个色块，但**在每个图例后面补上单位**（「接走行程（单）」「在跑车辆（辆）」）。

**另外补一句话在图下方**（这是这张图真正要说的事）：
> 用当前情景的数字算：`每辆车每小时接走 X 单`（= 该小时 `served_av / av_busy` 的全天加权平均，
> `av_busy` 为 0 的小时跳过）。

这句话比两条线本身更有信息量——它直接回答「这些车忙不忙」。

# 三、自查（**验收标准，必须逐条原样实现，不得替换、不得删减**）

在 `check-deployment.mjs` 里**新增**下面 4 条（保留原有全部检查）：

| # | 检查 | 判据 |
|---|---|---|
| 1 | 图里有两个轴的刻度文字，且数值不同 | 两个最大值文本不相等（除非该情景两者恰好相等，此时跳过并打印说明） |
| 2 | 切换车队规模后，两个轴的最大值**都**变了 | 比较 innerText |
| 3 | 「每辆车每小时接走 X 单」这句话存在且 X 是有限正数 | 正则取数，`Number.isFinite` 且 > 0 |
| 4 | `av_fleet = 0` 的基准情景下，不因除零而出现 `NaN` / `Infinity` | 页面文本里不含这两个字符串 |

第 4 条是重点：**基准情景 `av_busy` 全天为 0**，除法要先判零。

# 四、已知坑

1. 数据来自 `/api/fleet/deployment`（`data/web/deployment-scenarios.json`）。
   现在里面有 **20 个情景、3 个 kind**（`deployment` / `time_window` / `quota_swap`），
   其中 **`time_window` 的车只在 22:00–06:00 接客**，所以白天 `served_av` 全是 0——
   双轴在"一条线整段为 0"时不能画崩。
2. `av_fleet = 0` 的情景存在且必须能正常显示。
3. 起服务：后端 `.venv\Scripts\python.exe -m uvicorn backend.main:app --port 8000`，
   前端 `cd frontend; npm run dev`。**不要用 `taskkill /F /IM node.exe` 关**，它会杀掉所有 node 进程。
4. 自检脚本里 `ERR_ABORTED` 要过滤，那是 React 严格模式双次挂载取消 fetch，不是故障。

# 五、交回来时必须附上

1. `DeploymentPanel.tsx` 全文、CSS 追加片段、`check-deployment.mjs` 的改动片段；
2. `npm run build` 的输出（**必须成功**）；
3. `node scripts/check-deployment.mjs <目录>` 的输出和截图路径，
   截图至少包含：`deployment` 情景、`time_window` 情景（白天为 0 那种）、`av_fleet=0` 基准；
4. **一节「我偏离任务书的地方」**，没有就写"无"。

---
