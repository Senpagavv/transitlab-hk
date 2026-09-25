"""第 39 步：公交分配（早高峰 8–9 时）→ 每条公交线、每一段有多少人，港铁各线最挤一段多挤。

Input : data/raw/gtfs_merged/hk-merged.gtfs.zip   合并班次表（第 17b 步：运输署全部 + 社区版港铁/轻铁）
        data/model/am-peak-2026.npz               早高峰公交人次 P_PT（第 24 步）
        data/web/zones-2026.geojson、data/model/zone-centres.parquet
Output: data/cache/transit-am/hk-am.gtfs.zip      截取出来的早高峰班次表（可再生，不是模型产出）
        data/cache/transit-am/aeq/                AequilibraE 工程（可再生）
        data/model/transit-assignment-am-2026.parquet   每条线每一段的早高峰人数
        data/web/transit-assignment-audit.json

方法：AequilibraE 的「最优策略」公交分配（Spiess & Florian）。乘客在车站看到几条能用的线，先来哪条上哪条，
按班次多少分摊；这正是频密公交网络的标准做法，和第 27 步的道路分配同一套工具。

处理的三件事：
1. 截取班次：只留当天（星期二）开行、7:30–9:30 之间有车的班次。运输署巴士是「按班距」写的（frequencies.txt），
   AequilibraE 会逐班展开，全天展开会太慢，所以先截取。
2. 换乘：AequilibraE 只在同一「车站」里生成换乘。把港铁站 200 米内的巴士、小巴、电车、渡轮、轻铁站都归到
   这个港铁站下面，才能坐巴士转港铁。
3. 接驳：分区中心到车站按直线步行（每秒 1 米，已含绕路）。直线穿过海面的接驳一律删掉
   （发起人 9/25 在修桥 demo 里发现过同类问题）。
"""
import io
import json
import shutil
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
GTFS = ROOT / "data" / "raw" / "gtfs_merged" / "hk-merged.gtfs.zip"
WORK = ROOT / "data" / "cache" / "transit-am"
AM_GTFS = WORK / "hk-am.gtfs.zip"
OUT = ROOT / "data" / "model" / "transit-assignment-am-2026.parquet"
AUDIT = ROOT / "data" / "web" / "transit-assignment-audit.json"
DAY = "2026-09-22"                  # 与第 18 步公交矩阵同一天（星期二）
WINDOW = (7 * 3600 + 1800, 9 * 3600 + 1800)
PERIOD = (8 * 3600, 9 * 3600)       # 分配的一小时
STATION_RADIUS_M = 200
LAND_GRID = ROOT / "data" / "raw" / "landuse" / "luhk2024_codes.tif"   # pipeline/36
WATER_CODES, WET_LIMIT_M = (0, 91), 30    # 海、水塘；与 pipeline/15 接驳不跨水同一标准
# 港铁官网工作日早高峰班距（2026-09 查）：港岛 1.9 分钟；荃湾、观塘 2.1；将军澳 北角–将军澳 2.2（宝琳 2.5/4、康城 6.7）；
# 东涌 香港–青衣 3–4（到东涌 6–8）；南港岛 3.3；屯马 2.7–3；东铁 金钟–上水 2.7、落马洲 9–14；机场快线 10；迪士尼 5。
# 社区版班次表的走向：东铁分罗湖 / 落马洲，将军澳分宝琳 / 康城（LHP）。东涌线只有到东涌一个走向，按核心段 3.5 分钟给
# （到东涌那段会偏多）。没列出的（荃湾、屯马、机场快线、迪士尼）原表已与官网一致。
MTR_PEAK_HEADWAY_S = {
    "osm:MTR-EAL-DT": 209, "osm:MTR-EAL-UT": 209, "osm:MTR-EAL-LMC-DT": 720, "osm:MTR-EAL-LMC-UT": 720,
    "osm:MTR-ISL-DT": 114, "osm:MTR-ISL-UT": 114, "osm:MTR-KTL-DT": 126, "osm:MTR-KTL-UT": 126,
    "osm:MTR-TKL-DT": 197, "osm:MTR-TKL-UT": 197, "osm:MTR-TKL-LHP-DT": 400, "osm:MTR-TKL-LHP-UT": 400,
    "osm:MTR-TCL-DT": 210, "osm:MTR-TCL-UT": 210, "osm:MTR-SIL-DT": 198, "osm:MTR-SIL-UT": 198,
}
BUS_TIME_FACTOR = 1.5       # 巴士/小巴车上时间的系数（班次表是理想时刻；早高峰塞车、不准时、站着坐）。9/25 按港铁 7 条线最繁忙段扫描：
                            # ×1.0 总体偏差 0.54、×1.3 0.25、×1.6 0.22、×2.0 0.34，取 1.5


def secs(t: pd.Series) -> pd.Series:
    """"HH:MM:SS" → 秒；空着的（班次表允许中途站不写时间）→ NaN。"""
    hms = t.where(t != "").str.split(":", expand=True)
    return pd.to_numeric(hms[0]) * 3600 + pd.to_numeric(hms[1]) * 60 + pd.to_numeric(hms[2])


def cut_gtfs(report: list) -> dict:
    """截取当天早高峰的班次，另存一份小的班次表。"""
    z = zipfile.ZipFile(GTFS)
    rd = lambda n: pd.read_csv(io.BytesIO(z.read(n)), dtype=str, keep_default_na=False)
    cal, cdates = rd("calendar.txt"), rd("calendar_dates.txt")
    ymd, weekday = DAY.replace("-", ""), pd.Timestamp(DAY).day_name().lower()
    active = set(cal.loc[(cal[weekday] == "1") & (cal["start_date"] <= ymd) & (cal["end_date"] >= ymd), "service_id"])
    active |= set(cdates.loc[(cdates["date"] == ymd) & (cdates["exception_type"] == "1"), "service_id"])
    active -= set(cdates.loc[(cdates["date"] == ymd) & (cdates["exception_type"] == "2"), "service_id"])

    trips, freq = rd("trips.txt"), rd("frequencies.txt")
    trips = trips[trips["service_id"].isin(active)]
    stop_times = rd("stop_times.txt")
    stop_times = stop_times[stop_times["trip_id"].isin(trips["trip_id"])]
    span = stop_times.assign(t=secs(stop_times["departure_time"].where(stop_times["departure_time"] != "", stop_times["arrival_time"])))
    span = span.groupby("trip_id")["t"].agg(["min", "max"])

    freq = freq[freq["trip_id"].isin(trips["trip_id"])].copy()
    # 社区版港铁班次表的早高峰班距与港铁官网不符（东铁两个支线各 3 分钟，主干变成每小时 40 班；港岛线只有 18 班），
    # 按官网工作日早高峰班距改写覆盖 8-9 时的那一段
    peak_rows = freq["trip_id"].isin(MTR_PEAK_HEADWAY_S) & (secs(freq["start_time"]) <= PERIOD[0]) & (secs(freq["end_time"]) >= PERIOD[1])
    before = freq.loc[peak_rows, ["trip_id", "headway_secs"]].set_index("trip_id")["headway_secs"].to_dict()
    freq.loc[peak_rows, "headway_secs"] = freq.loc[peak_rows, "trip_id"].map(MTR_PEAK_HEADWAY_S).astype(int).astype(str)
    report.append("港铁早高峰班距按官网改写（秒，原 → 新）：" + "；".join(
        f"{k.removeprefix('osm:MTR-')} {before[k]}→{MTR_PEAK_HEADWAY_S[k]}" for k in before if str(before[k]) != str(MTR_PEAK_HEADWAY_S[k])))
    by_freq = set(freq["trip_id"])
    fs, fe = secs(freq["start_time"]), secs(freq["end_time"])
    freq = freq[(fs < WINDOW[1]) & (fe > WINDOW[0] - 3 * 3600)].assign(fs=fs, fe=fe, h=freq["headway_secs"].astype(int))
    # 按时刻的班次：首末站时间与时段重叠；按班距的班次：先当模板留着，下面自己逐班展开
    timed = set(span[(span["min"] <= WINDOW[1]) & (span["max"] >= WINDOW[0])].index) - by_freq
    keep = timed | set(freq["trip_id"])
    trips = trips[trips["trip_id"].isin(keep)]
    stop_times = stop_times[stop_times["trip_id"].isin(keep)]

    # 中途站可以不写时间，AequilibraE 却要求每站时刻严格递增：空的按前后站线性插值，同一时刻顺延 1 秒
    stop_times = stop_times.assign(seq=stop_times["stop_sequence"].astype(int)).sort_values(["trip_id", "seq"])
    t = secs(stop_times["arrival_time"]).fillna(secs(stop_times["departure_time"]))
    t = t.groupby(stop_times["trip_id"]).transform(lambda s: s.interpolate(limit_direction="both"))
    fixed = np.empty(len(t))
    starts = np.r_[0, np.nonzero(stop_times["trip_id"].to_numpy()[1:] != stop_times["trip_id"].to_numpy()[:-1])[0] + 1, len(t)]
    tv = t.to_numpy()
    for a, b in zip(starts[:-1], starts[1:]):
        seg = np.round(tv[a:b])
        for k in range(1, len(seg)):
            seg[k] = max(seg[k], seg[k - 1] + 1)
        fixed[a:b] = seg
    blanks = int(stop_times["arrival_time"].eq("").sum())
    stop_times = stop_times.assign(t=fixed).drop(columns="seq")

    # 按班距的班次自己逐班展开（AequilibraE 1.7 展开时不给新班次改编号，会把它们全部丢掉）：
    # 第 k 班 = 模板各站时刻整体平移到「班距段开始 + k × 班距」；只留 7:30–9:30 之间在路上跑的班
    first = stop_times.groupby("trip_id")["t"].agg(["min", "max"])
    rows = []
    for i, f in freq.reset_index(drop=True).iterrows():
        if f["trip_id"] not in first.index:
            continue
        t0, t1 = first.at[f["trip_id"], "min"], first.at[f["trip_id"], "max"]
        dep = np.arange(f["fs"], f["fe"], f["h"])
        dep = dep[(dep <= WINDOW[1]) & (dep + (t1 - t0) >= WINDOW[0])]
        rows += [(f["trip_id"], f"{f['trip_id']}#{i}.{k}", d - t0) for k, d in enumerate(dep)]
    runs = pd.DataFrame(rows, columns=["trip_id", "new_id", "shift"])
    expanded_st = stop_times.merge(runs, on="trip_id")
    expanded_st = expanded_st.assign(t=expanded_st["t"] + expanded_st["shift"], trip_id=expanded_st["new_id"]).drop(columns=["new_id", "shift"])
    expanded_trips = trips.merge(runs[["trip_id", "new_id"]], on="trip_id").assign(trip_id=lambda d: d["new_id"]).drop(columns="new_id")
    trips = pd.concat([trips[trips["trip_id"].isin(timed)], expanded_trips], ignore_index=True)
    stop_times = pd.concat([stop_times[stop_times["trip_id"].isin(timed)], expanded_st], ignore_index=True)
    hms = [f"{int(v) // 3600:02d}:{int(v) % 3600 // 60:02d}:{int(v) % 60:02d}" for v in stop_times["t"]]
    stop_times = stop_times.assign(arrival_time=hms, departure_time=hms).drop(columns="t")
    expanded = int(len(runs))

    routes = rd("routes.txt")
    routes = routes[routes["route_id"].isin(trips["route_id"])]
    stops = rd("stops.txt")
    used = set(stop_times["stop_id"])
    stops = stops[stops["stop_id"].isin(used) | stops["stop_id"].isin(stops.loc[stops["stop_id"].isin(used), "parent_station"])]

    # 港铁站 200 米内的其他车站归到这个港铁站下面（才能换乘）
    from scipy.spatial import cKDTree
    from pyproj import Transformer
    to_grid = Transformer.from_crs("EPSG:4326", "EPSG:2326", always_xy=True)
    x, y = to_grid.transform(stops["stop_lon"].astype(float).to_numpy(), stops["stop_lat"].astype(float).to_numpy())
    child = stops["parent_station"] != ""
    platforms = np.nonzero(child.to_numpy())[0]
    tree = cKDTree(np.column_stack([x[platforms], y[platforms]]))
    orphans = np.nonzero((~child & (stops["location_type"] != "1")).to_numpy())[0]
    d, k = tree.query(np.column_stack([x[orphans], y[orphans]]), distance_upper_bound=STATION_RADIUS_M)
    hit = np.isfinite(d)
    parents = stops["parent_station"].to_numpy().copy()
    parents[orphans[hit]] = parents[platforms[k[hit]]]
    stops = stops.assign(parent_station=parents)

    calendar = cal[cal["service_id"].isin(trips["service_id"])]
    WORK.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(AM_GTFS, "w", zipfile.ZIP_DEFLATED) as out:
        for name, df in (("agency.txt", rd("agency.txt")), ("routes.txt", routes), ("trips.txt", trips), ("stops.txt", stops),
                         ("stop_times.txt", stop_times), ("calendar.txt", calendar),
                         ("calendar_dates.txt", cdates[cdates["service_id"].isin(trips["service_id"])])):
            out.writestr(name, df.to_csv(index=False))
    info = {"trips": int(len(trips)), "frequency_rows": int(len(freq)), "expanded_trips": expanded,
            "timed_trips": int(len(timed)), "stops": int(len(stops)), "routes": int(len(routes)),
            "stops_joined_to_rail_stations": int(hit.sum()), "blank_times_interpolated": blanks}
    report.append(f"截取 {DAY} {WINDOW[0] // 3600}:{WINDOW[0] % 3600 // 60:02d}–{WINDOW[1] // 3600}:{WINDOW[1] % 3600 // 60:02d}：线路 "
                  f"{info['routes']:,} 条、班次 {info["trips"]:,}（按班距的 {info["frequency_rows"]:,} 段自己展开成 {expanded:,} 班；"
                  f"按时刻的 {info['timed_trips']:,} 班）、车站 {info['stops']:,} 个；{info['stops_joined_to_rail_stations']:,} 个"
                  f"车站归到 200 米内的港铁/轻铁站下面")
    return info


def import_gtfs(report: list):
    """新建 AequilibraE 工程（放在缓存目录，每次重建），定义 8–9 时时段，导入早高峰班次表。"""
    import time
    from aequilibrae import Project
    from aequilibrae.transit import Transit
    folder = WORK / "aeq"
    if folder.exists():
        shutil.rmtree(folder)
    project = Project()
    project.new(str(folder))
    project.network.periods.new_period(2, PERIOD[0], PERIOD[1], "AM peak 08-09").save()
    data = Transit(project)
    t0 = time.time()
    feed = data.new_gtfs_builder(agency="HK", file_path=str(AM_GTFS), description="TransitLab HK morning peak cut")
    feed.set_allow_map_match(False)
    feed.load_date(DAY)
    feed.save_to_disk()
    with project.transit_connection as conn:
        n = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("routes", "trips", "stops", "route_links")}
    report.append(f"导入 AequilibraE：{time.time() - t0:.0f} 秒；线路模式 {n['routes']:,}、班次 {n['trips']:,}、车站 {n['stops']:,}")
    return project, data


MODEL = ROOT / "data" / "model"
WALK_MPS = 1.0              # 接驳步行速度（米/秒），含绕路
# 早高峰最繁忙一小时、最繁忙一段的每小时每方向人次（校核用）。2014 年数字来自立法会 CB(4)854/15-16 附件一
# （2015-12-09 书面答复）；东铁线来自 2022-06-15 立法会答复：载客率约 73%（每平方米站 4 人），新信号系统下
# 每小时每方向最大运力 82,500（2 分钟一班），现行约 2.7 分钟一班 → 82,500 × 2 / 2.7 × 0.73 ≈ 44,600。
# 2022 年东铁过海段通车后，荃湾线最挤一段少了两成多、观塘线少了约一成（同一答复），所以这两条按 2014 年打折。
REFERENCE = [
    ("EAL", "Tai Wai", "Kowloon Tong", 44_600, "2022 年答复推算"),
    ("TWL", "Tsim Sha Tsui", "Admiralty", round(52_300 * 0.78), "2014 年 52,300，东铁过海后少两成多"),
    ("KTL", "Shek Kip Mei", "Prince Edward", round(48_100 * 0.90), "2014 年 48,100，东铁过海后少约一成"),
    ("ISL", "Tin Hau", "Causeway Bay", 53_700, "2014 年"),
    ("TKL", "Yau Tong", "Quarry Bay", 45_200, "2014 年"),
    ("TML", "Kam Sheung Road", "Tsuen Wan West", 36_600, "2014 年（当年的西铁线）"),
    ("TCL", "Olympic", "Kowloon", 22_800, "2014 年"),
]
# 每班车每平方米站 4 人时的载客量：东铁 9 卡新车 = 82,500 ÷ 30 班；其余 8 卡列车按 2014 年表的运力 ÷ 班次约 2,000
TRAIN_CAPACITY = {"EAL": 2_750, "AEL": 1_000, "DRL": 1_000}
DEFAULT_TRAIN_CAPACITY = 2_000


def transit_zones() -> tuple[pd.DataFrame, np.ndarray]:
    """455 个交通分区 + 15 个口岸，编号 1..470，顺序与 am-peak-2026.npz 相同；中心点用模型的出行端点中心。"""
    import geopandas as gpd
    from shapely.geometry import Point
    peak = np.load(MODEL / "am-peak-2026.npz")
    ids = [str(z) for z in peak["zones"]]
    geo = gpd.read_file(ROOT / "data" / "web" / "zones-2026.geojson").set_index("zone")
    cen = pd.read_parquet(MODEL / "zone-centres.parquet").set_index("zone")
    points = {f"X:{p['point']}": p for p in json.loads((ROOT / "data" / "web" / "cross-boundary.json").read_text(encoding="utf-8"))["control_points"]}
    rows = []
    for k, z in enumerate(ids, start=1):
        if z in geo.index:
            poly = geo.at[z, "geometry"]
            centre = Point(cen.at[z, "lon"], cen.at[z, "lat"]) if z in cen.index else poly.representative_point()
        else:
            p = points[z]
            centre = Point(p["lon"], p["lat"])
            poly = centre.buffer(0.003)
        rows.append((k, z, poly, centre))
    return pd.DataFrame(rows, columns=["zone_id", "zone", "geometry", "centre"]), peak["P_PT"].astype(float)


def build_graph(project, zones: pd.DataFrame, report: list, bus_factor: float = BUS_TIME_FACTOR):
    """公交网络：车站、每条线每一段、上下车、同站步行换乘；分区中心接到附近车站（穿过海面的接驳删掉）。"""
    import shapely
    from aequilibrae.transit.transit_graph_builder import TransitGraphBuilder
    b = TransitGraphBuilder(project, period_id=2, projected_crs="EPSG:2326", with_inner_stop_transfers=False,
                            with_outer_stop_transfers=False, with_walking_edges=True, blocking_centroid_flows=True,
                            connector_method="overlapping_regions")
    b.walking_speed = WALK_MPS
    b.add_zones(zones[["zone_id", "geometry"]], from_crs="EPSG:4326")
    b.zones["centroids"] = shapely.to_wkb(zones["centre"].to_numpy())
    b.create_graph()

    # 巴士/小巴（线路类型 3）车上时间乘系数
    if bus_factor != 1.0:
        with project.transit_connection as conn:
            types = pd.read_sql("SELECT pattern_id, route_type FROM routes", conn)
        bus = set(types.loc[types["route_type"] == 3, "pattern_id"].astype(str))
        pattern = b.edges["line_id"].astype(str).str.split("_").str[-1]
        mask = (b.edges["link_type"] == "on-board") & pattern.isin(bus)
        b.edges.loc[mask, "trav_time"] = b.edges.loc[mask, "trav_time"] * bus_factor

    # 穿过海面或水塘的接驳：用规划署 2024 土地用途 10 米格网（pipeline/36），与 pipeline/15 路网接驳同一标准——
    # 沿直线每 10 米看一次，海或水塘累计超过 30 米就删
    import rasterio
    with rasterio.open(LAND_GRID) as src:
        codes, tf = src.read(1), src.transform
    geom = b.vertices.set_index("node_id")["geometry"].map(shapely.from_wkb)
    conn = b.edges[b.edges["link_type"].isin(["access_connector", "egress_connector"])]
    from pyproj import Transformer
    to_grid = Transformer.from_crs("EPSG:4326", "EPSG:2326", always_xy=True)
    ax, ay = to_grid.transform(shapely.get_x(geom.loc[conn["a_node"]].to_numpy()), shapely.get_y(geom.loc[conn["a_node"]].to_numpy()))
    bx, by = to_grid.transform(shapely.get_x(geom.loc[conn["b_node"]].to_numpy()), shapely.get_y(geom.loc[conn["b_node"]].to_numpy()))
    length = np.hypot(bx - ax, by - ay)
    steps = np.maximum(2, np.ceil(length / 10).astype(int))
    wet = np.zeros(len(conn))
    for k in range(1, steps.max()):
        f = np.where(k < steps, k / steps, np.nan)
        ok = ~np.isnan(f)
        px, py = ax + (bx - ax) * np.nan_to_num(f), ay + (by - ay) * np.nan_to_num(f)
        r, c = rasterio.transform.rowcol(tf, px, py)
        r, c = np.clip(np.asarray(r), 0, codes.shape[0] - 1), np.clip(np.asarray(c), 0, codes.shape[1] - 1)
        wet += ok * np.isin(codes[r, c], WATER_CODES) * (length / steps)
    drop = conn.index[wet > WET_LIMIT_M]
    b.edges = b.edges.drop(index=drop).reset_index(drop=True)
    b.create_od_node_mapping()
    served = set(b.edges.loc[b.edges["link_type"] == "access_connector", "b_node"]) | set(b.edges.loc[b.edges["link_type"] == "access_connector", "a_node"])
    kinds = b.edges["link_type"].value_counts().to_dict()
    report.append(f"公交网络（巴士车上时间 × {bus_factor}）：{len(b.vertices):,} 个节点、{len(b.edges):,} 条边（{', '.join(f'{k} {v:,}' for k, v in kinds.items())}）；"
                  f"删掉直线跨海或水塘超过 {WET_LIMIT_M} 米的接驳 {len(drop):,} 条（共 {len(conn):,} 条）")
    b.water_check = {"grid": LAND_GRID.name, "limit_m": WET_LIMIT_M, "connectors": int(len(conn)), "dropped": int(len(drop))}
    return b


def assign(builder, zones: pd.DataFrame, demand: np.ndarray, report: list) -> pd.DataFrame:
    import os
    from aequilibrae.matrix import AequilibraeMatrix
    from aequilibrae.paths import TransitAssignment, TransitClass
    graph = builder.to_transit_graph()
    n = len(zones)
    mat = AequilibraeMatrix()
    mat.create_empty(zones=n, matrix_names=["pt"], memory_only=True)
    mat.index = zones["zone_id"].to_numpy()
    mat.matrices[:, :, 0] = demand
    mat.computational_view(["pt"])
    cls = TransitClass(name="pt", graph=graph, matrix=mat)
    run = TransitAssignment()
    run.add_class(cls)
    run.set_time_field("trav_time")
    run.set_frequency_field("freq")
    run.set_algorithm("optimal-strategies")
    run.set_cores(os.cpu_count() or 4)
    run.execute()
    vols = run.results()
    edges = builder.edges.set_index("link_id").join(vols)
    edges["volume"] = edges.filter(like="volume").sum(axis=1)
    return edges


def summarise(project, builder, edges: pd.DataFrame, demand: np.ndarray, report: list, flags: list) -> pd.DataFrame:
    """每条线每一段：上一站、下一站、每小时人数、每小时班数、运力、满载率；与立法会港铁数字比。"""
    # 网络里的车站编号是 AequilibraE 自己编的整数：经它的 stops 表对回原来的站台，港铁站台再对到所属车站的站名
    gtfs_stops = pd.read_csv(io.BytesIO(zipfile.ZipFile(AM_GTFS).read("stops.txt")), dtype=str, keep_default_na=False)
    names = dict(zip(gtfs_stops["stop_id"], gtfs_stops["stop_name"]))
    with project.transit_connection as conn:
        patterns = pd.read_sql("SELECT pattern_id, route_id, route, shortname, longname, route_type FROM routes", conn)
        db_stops = pd.read_sql("SELECT stop_id, stop, name, parent_station FROM stops", conn)
    rail_parent = db_stops["stop"].astype(str).str.startswith("osm:MTR-") & db_stops["parent_station"].fillna("").ne("")
    shown = np.where(rail_parent, db_stops["parent_station"].map(names), db_stops["name"])
    station = dict(zip(db_stops["stop_id"].astype(str), pd.Series(shown).fillna(db_stops["name"])))
    patterns["pattern_id"] = patterns["pattern_id"].astype(str)
    edges = edges.assign(pattern_id=edges["line_id"].astype(str).str.split("_").str[-1])   # 图里的线路编号是「序号_走向编号」
    # 每条线每小时几班：记在上车边的频率上（车上边的频率是无穷大）
    per_hour = edges[edges["link_type"] == "boarding"].groupby("line_id")["freq"].max() * 3600
    v = builder.vertices.set_index("node_id")
    board = edges[edges["link_type"] == "on-board"].copy()
    # 注意：AequilibraE 的公交图里边是从 b_node 走向 a_node（上车点在 b、下车点在 a；接驳边也是分区在 b、车站在 a），
    # 与道路图的 a→b 相反。读反了会让每条线的方向全部颠倒（9/25 曾因此把东铁最挤段看成北行）。
    board["from_stop"] = v.loc[board["b_node"], "stop_id"].astype(str).to_numpy()
    board["to_stop"] = v.loc[board["a_node"], "stop_id"].astype(str).to_numpy()
    board = board.merge(patterns, on="pattern_id", how="left")
    board["from_station"] = board["from_stop"].map(station)
    board["to_station"] = board["to_stop"].map(station)
    board["line"] = board["route"].astype(str).str.replace("osm:MTR-", "", regex=False)
    board["per_hour"] = board["line_id"].map(per_hour)
    cap = board["line"].map(TRAIN_CAPACITY).fillna(DEFAULT_TRAIN_CAPACITY)
    rail = board["route_type"].astype(str).isin(["1", "2"])
    board["capacity"] = np.where(rail, board["per_hour"] * cap, np.nan)
    board["load_factor"] = board["volume"] / board["capacity"]
    seg = board.groupby(["line", "route_type", "from_station", "to_station"], as_index=False).agg(
        volume=("volume", "sum"), per_hour=("per_hour", "sum"), capacity=("capacity", "sum"))
    seg["load_factor"] = seg["volume"] / seg["capacity"]

    # 乘客总数与上车人次
    boardings = edges[edges["link_type"] == "boarding"].merge(patterns, on="pattern_id", how="left")
    by_type = boardings.groupby(boardings["route_type"].astype(str))["volume"].sum()
    kind = {"0": "电车/轻铁", "1": "港铁", "2": "铁路", "3": "巴士/小巴", "4": "渡轮", "7": "缆车"}
    access = edges.loc[edges["link_type"] == "access_connector", "volume"].sum()
    report.append(f"分配 8-9 时公交 {demand.sum():,.0f} 人次，进入网络 {access:,.0f}（{access / demand.sum():.1%}）；上车人次："
                  + "、".join(f"{kind.get(k, k)} {x:,.0f}" for k, x in by_type.items())
                  + f"；平均每人上车 {by_type.sum() / max(access, 1):.2f} 次")
    if access < 0.95 * demand.sum():
        flags.append(f"只有 {access / demand.sum():.1%} 的公交人次进得了网络（分区接不到车站）")

    rows = []
    for line, a, bname, ref, note in REFERENCE:
        s = seg[(seg["line"] == line) & (seg["from_station"] == a) & (seg["to_station"] == bname)]
        model = float(s["volume"].sum()) if len(s) else float("nan")
        top = seg[seg["line"] == line].sort_values("volume", ascending=False).head(1)
        rows.append({"line": line, "segment": f"{a} → {bname}", "model": model, "reference": ref, "ratio": model / ref if ref else np.nan,
                     "model_busiest": f"{top['from_station'].iloc[0]} → {top['to_station'].iloc[0]} {top['volume'].iloc[0]:,.0f}" if len(top) else "",
                     "load_factor": float(s["load_factor"].max()) if len(s) else float("nan"), "note": note})
    check = pd.DataFrame(rows)
    report.append("港铁最繁忙一段（模型 / 立法会，每小时每方向）：" + "；".join(
        f"{r.line} {r.segment} {r.model:,.0f}/{r.reference:,.0f}（{r.ratio:.2f}）" for r in check.itertuples()))
    bad = check[(check["ratio"] < 0.6) | (check["ratio"] > 1.5) | check["ratio"].isna()]
    if len(bad):
        flags.append("港铁最繁忙一段与立法会数字相差超过 0.6–1.5 倍：" + "、".join(bad["line"]))
    return seg, check


def main() -> None:
    import time
    report, flags = [], []
    t0 = time.time()
    cut = cut_gtfs(report)
    project, _ = import_gtfs(report)
    zones, demand = transit_zones()
    builder = build_graph(project, zones, report)
    edges = assign(builder, zones, demand, report)
    seg, check = summarise(project, builder, edges, demand, report, flags)
    seg.to_parquet(OUT, index=False)
    project.close()
    AUDIT.write_text(json.dumps({"method": "AequilibraE 最优策略公交分配（Spiess & Florian），早高峰 8-9 时",
                                 "gtfs_cut": cut, "mtr_check": check.round(3).to_dict("records"), "flags": flags,
                                 "connector_water_check": getattr(builder, "water_check", None),
                                 "report": report, "seconds": round(time.time() - t0)}, ensure_ascii=False, indent=1, default=str),
                     encoding="utf-8")
    for line in report:
        print(line)
    print("未通过：" + "；".join(flags) if flags else "全部检查通过")
    print(f"-> {OUT.relative_to(ROOT)}、{AUDIT.relative_to(ROOT)}（{time.time() - t0:.0f} 秒）")


if __name__ == "__main__":
    import sys
    if "--import" in sys.argv:
        rep: list = []
        print(cut_gtfs(rep))
        project, data = import_gtfs(rep)
        project.close()
        print("\n".join(rep))
    else:
        main()
