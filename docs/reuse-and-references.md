# 复用项目与数据来源清单

记录日期：2026-09-15。原则：**用成熟的开源库和官方模板拼装，不整体 fork 大型项目**。大型项目读懂和改造的时间会超过 5 周的比赛周期。

## 已采用

| 项目 | 用在哪里 | 许可证 | 状态 |
|---|---|---|---|
| [Vite](https://vite.dev) `react-ts` 官方模板 | 前端骨架 | MIT | ✅ 已用 |
| [maplibre/maplibre-gl-js](https://github.com/maplibre/maplibre-gl-js) | 地图引擎 | BSD-3 | ✅ 已用 |
| [visgl/react-map-gl](https://github.com/visgl/react-map-gl) | 在 React 里使用 MapLibre | MIT | ✅ 已用 |
| [visgl/deck.gl](https://github.com/visgl/deck.gl) | 大量数据图层（小区、站点、流线、3D） | MIT | ✅ 已用 |
| [FastAPI](https://fastapi.tiangolo.com) | 后端接口 | MIT | ✅ 已用 |
| 地政总署 [Vector Map API](https://portal.csdi.gov.hk/csdi-webpage/apidoc/VectorMapAPI) + [Vector Map Label API](https://portal.csdi.gov.hk/csdi-webpage/apidoc/VectorMapLabelAPI) | 主底图（矢量，繁中标注） | 政府条款：地图上须有地政总署标志 + 版权声明；避免短时间大量请求 | ✅ 已用 |
| 地政总署底图 XYZ 图片瓦片 | 快速缩放时的低清占位底图 | 同上 | ✅ 已用 |
| [microsoft/playwright](https://github.com/microsoft/playwright) | 驱动本机 Edge 截图检查界面（开发工具，不进网站） | Apache-2.0 | ✅ 已用 |
| 地政总署 [Location Search API](https://portal.csdi.gov.hk/csdi-webpage/apidoc/LocationSearchAPI) | 地名 → 坐标 | 政府条款 | ✅ 已用 |
| [r5py/r5py](https://github.com/r5py/r5py) | 公交出行时间矩阵（阶段 2） | GPL-3.0 或 MIT | ✅ 已安装并用样例数据验证 |
| [developmentseed/lonboard](https://github.com/developmentseed/lonboard) | 在 Jupyter 里快速看地图数据 | MIT | ✅ 已安装 |
| [wheelstransit/hongkong-community-gtfs](https://github.com/wheelstransit/hongkong-community-gtfs) | 全港 GTFS，**含港铁 10 条线和轻铁** | 代码 MIT；数据 ODbL | ✅ 已下载到 `data/raw/gtfs_community/` |

## 计划采用（到对应阶段再装）

| 项目 | 用途 | 许可证 | 阶段 |
|---|---|---|---|
| 运输署官方 GTFS（DATA.GOV.HK） | 巴士、专线小巴、电车、渡轮、山顶缆车 | DATA.GOV.HK 条款 | ✅ 9/17 已采用，见 `pipeline/17b` |
| [visgl/flowmap.gl](https://github.com/visgl/flowmap.gl) | OD 流线可视化 | Apache-2.0 | 3 |
| [AequilibraE/aequilibrae](https://github.com/AequilibraE/aequilibrae) | 道路分配等四阶段工具（按需） | MIT（附加条款） | 3 |
| [kepler.gl 在线版](https://kepler.gl/demo) | 把 GeoJSON 拖进去快速查看，不嵌入项目 | MIT | 随时 |

## 两份 GTFS 的对比（2026-09-15 实测）

| | 运输署官方 GTFS | 社区 GTFS |
|---|---|---|
| 线路总数 | 2,452 | 1,623 |
| 港铁重铁 | ❌ 没有 | ✅ 10 条线 |
| 轻铁 | ❌ 没有 | ✅ 11 条 |
| 专线小巴 | 779 | 396 |
| 电车 | ✅ | ❌ |

**计划**：港铁和轻铁取社区版，巴士、小巴和电车取官方版，在阶段 1–2 合并。

**已执行（2026-09-17，`pipeline/17b_transit_feed.py`）**。另发现社区版渡轮缺方向（中环–坪洲只有单程），所以渡轮也必须用官方版——详见交接文档 6.25。

**ODbL 注意**：网站上显示基于该数据的地图和结果，只需署名；如果把**修改后的数据库本身**公开发布，需要同样以 ODbL 共享。

## 考察后不采用

| 项目 | 原因 |
|---|---|
| [fastapi/full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template)（★4.5 万） | 自带登录、PostgreSQL、Docker，比赛用不上；本机也没有 Docker |
| Conveyal Analysis（[conveyal/r5](https://github.com/conveyal/r5)） | 功能最接近（公交情景 + 可达性），但 Java 后端 + 数据库 + 云计算，改造成本远超比赛周期。**作为竞品参考**，底层 R5 引擎已通过 r5py 使用 |
| [UDST/urbanaccess](https://github.com/UDST/urbanaccess)、[UDST/pandana](https://github.com/UDST/pandana) | AGPL-3.0：放进网站服务需公开全部源码 |
| [hkbus/hk-bus-crawling](https://github.com/hkbus/hk-bus-crawling) | GPL-2.0；社区 GTFS 已包含它的成果，不直接拷贝代码 |
| GitHub 上零星的 maplibre + fastapi 模板 | 0 星、维护不明，不如官方模板可靠 |

## 核心数据来源（待下载）

见交接文档第五节。阶段 1 优先：2021 普查小规划统计区边界与人口、按工作地点划分的工作人口、规划署 TPEDM、TCS 2022 参数。
