# 给 Codex 的任务 A：区域投放情景的网页面板

> 复制「---」之间的全部内容给 Codex。工作目录 `F:\transitlab-hk`。
> **这份任务可以和任务 B、C 同时进行**，它们碰的文件互不重叠。

---

# 背景

`pipeline/32` 算出了"在某个区投放 N 辆无人车会怎样"，`pipeline/33` 已经把结果转成了网页能读的
`data/web/deployment-scenarios.json`。现在缺的是**把它接到界面上**。

结论本身是**负面的**，而这正是要展示清楚的：1,200 辆无人车只接走投放区 10% 的行程，
最忙一小时只有 14% 在跑，等待只降了 36 秒。界面必须让人一眼看出"加车没用"，
而不是把它美化成一个成功故事。

# 一、硬约束

1. **只允许**：
   - 新建 `frontend/src/components/DeploymentPanel.tsx`
   - 新建 `frontend/scripts/check-deployment.mjs`
   - 修改 `backend/main.py`（**只加一个接口**）
   - 修改 `frontend/src/App.tsx`（**只加 import 和一行 JSX**）
   - 追加 `frontend/src/App.css`（**只在文件末尾追加，不改已有规则**）

   **其他任何文件都不得改动**——尤其不要碰 `pipeline/` 下的任何脚本、
   `frontend/src/map/` 下的任何文件（另一项任务可能正在改那里）。
2. 不得运行 `pipeline/` 下的任何脚本，不得执行 git 写操作。
3. **不要新增任何 npm 依赖**。图表用手写 SVG——现有的 `FleetPanel.tsx` 就是这么做的，照它。
4. 中文界面。代码和注释用英文，和这个工程其他前端文件一致。

# 二、先读这些

| 文件 | 为什么 |
|---|---|
| `frontend/src/components/FleetPanel.tsx` | **最重要**。你的组件是它的兄弟：同样的取数方式、同样的手写 SVG、同样的「局限」折叠区。照它的写法 |
| `frontend/src/App.css` 末尾的 `.fleet-*` 规则 | 配色和间距照抄，新规则用 `.deploy-*` 前缀 |
| `backend/main.py` 的 `/api/fleet/scenarios` | 你要加的接口和它一模一样，只是换个文件 |
| `data/web/deployment-scenarios.json` | **你的数据源，先完整读一遍再动手** |
| `frontend/scripts/check-fleet.mjs` | 截图自检的写法，照它 |

# 三、数据契约（**已经定死，不要改 JSON，也不要假设字段**）

```
{
  "areas": ["离岛（东涌 + 机场）", "观塘"],
  "kinds": ["deployment"],
  "taxi_fleet": 17695,
  "scenarios": [ {
      "kind": "deployment",          // 以后还会出现 "time_window"、"quota_swap"
      "area": "...", "av_fleet": 1200, "taxi_fleet": 17695,
      "from_hour": 0, "to_hour": 24,
      "summary": { requests_in_area, requests_total, served_av, av_share_in_area,
                   wait_in_area_min, wait_total_min, av_vehicle_km, total_vehicle_km,
                   av_empty_share, av_busy_peak, av_outside_area_peak },
      "vs_baseline": { wait_in_area_min, total_vehicle_km_pct },   // 相对同区 av_fleet=0
      "hourly": [ {hour, requests_in_area, requests_total, served_av, served_taxi, gave_up,
                   wait_in_area_min, wait_total_min, av_empty_km, av_paid_km,
                   taxi_empty_km, taxi_paid_km, av_busy, taxi_busy, av_outside_area} x24 ]
  } ]
}
```

**`kind` 是为了以后加情景留的**。你的组件必须：
- 按 `kind` 分组显示，**遇到不认识的 `kind` 要照样显示**（按 `kind` 值分一组），不能崩、不能过滤掉；
- 不要写死 `areas` 或 `av_fleet` 的取值，全部从数据里读。

**这一条是这份任务最重要的要求**：以后加情景时前端不应该需要改动。

# 四、要做什么

## 1. 后端接口

照 `/api/fleet/scenarios` 的写法加 `/api/fleet/deployment`，读 `data/web/deployment-scenarios.json`，
文件不存在时 404 并提示"先跑 pipeline/32 和 pipeline/33"。

## 2. `DeploymentPanel.tsx`

放在地图**右下角**（`.fleet-panel` 在左上，分区图例和车流图例在右上/右中，右下是空的；
**放好后一定要截图确认没有和现有图例重叠**）。可折叠，默认折叠——
这个面板是第二层信息，不该一上来就压住地图。

展开后：

1. **一行导语**：说明这是"在某个区投放无人车、的士车队不变"的情景。
2. **区域选择**（`areas` 有几个就几个按钮）。
3. **车队规模选择**（该区有哪些 `av_fleet` 就列哪些）。
4. **四个数字**：无人车接走区内行程的比例 / 区内平均等待 / 较基准的等待变化 / 总车公里变化。
   等待变化和车公里变化用 `vs_baseline`，**减少显示为绿色、增加显示为红色**。
5. **一张"利用率"条**：`summary.av_busy_peak / av_fleet`，写明"最忙一小时只有 X% 在跑"。
   **这是这个面板要传达的核心事实**，给它足够的视觉分量。
6. **一张逐小时 SVG 图**：两条线——`served_av` 和 `av_busy`，横轴 0–23 时。手写 SVG，不加依赖。
7. **一行漂移提示**：`summary.av_outside_area_peak / av_fleet`，
   文案"全天最多有 X% 的无人车停在投放区外（区域牌照只限制在哪接客，不限制车停在哪）"。
8. **「这些数字的局限」折叠区**：直接渲染 JSON 里的 `limits` 数组，**不要自己写文案**。

## 3. `check-deployment.mjs`

照 `check-fleet.mjs` 写截图自检，必须验证：
- 面板能展开，且展开后不遮挡右侧两个图例（截图人工确认即可，脚本里记录截图路径）；
- 切换区域、切换车队规模后，四个数字**确实变了**（比较 innerText）；
- 「局限」折叠区能展开且条目数 = JSON 里 `limits` 的长度；
- 无控制台错误、无失败请求（**过滤掉 `ERR_ABORTED`**，那是 React 严格模式双次挂载取消 fetch，不是故障）。

# 五、这个工程的已知坑

1. **不要用 `taskkill /F /IM node.exe` 关开发服务器**——会杀掉机器上所有 node 进程。按端口关，或者留着。
2. `.fleet-panel` 在**左上角**是因为右侧被两个图例占了。你的面板放右下，**别再把图例挤出屏幕**。
3. 起服务：后端 `.venv\Scripts\python.exe -m uvicorn backend.main:app --port 8000`，
   前端 `cd frontend; npm run dev`，网址 `http://localhost:5173`。
4. 类型检查用 `cd frontend; npx tsc --noEmit`，**必须通过**。

# 六、交回来时必须附上

1. 新增/改动文件的全文（`backend/main.py` 和 `App.tsx` 只给改动片段）；
2. `npx tsc --noEmit` 的输出；
3. `node scripts/check-deployment.mjs <目录>` 的输出，以及**截图文件的路径**；
4. **一节「我偏离任务书的地方」**，没有就写"无"。

---
