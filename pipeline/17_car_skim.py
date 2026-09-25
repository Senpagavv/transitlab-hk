"""Car travel times between every pair of model zones, on the free-flowing network.

Input : data/model/road-links.parquet, road-connectors.parquet   (pipeline/15)
        data/model/landuse-2026.parquet                          (pipeline/16) - zone order, districts
Output: data/model/skim-car-freeflow.npz   zone-by-zone matrices (455 x 455): minutes, kilometres, toll (HK$)
        data/web/car-skim-audit.json

Trip distribution and mode choice both need to know how far apart the zones are. This is the first
estimate: every road at its speed limit, no congestion. After the first assignment, the congested
times replace these and the model iterates until demand and travel times agree.

Routing is by time. The toll paid along that route is recorded but does not yet steer the route:
that needs a value of time to turn dollars into minutes, and no sourced figure has been chosen yet
(an open parameter, listed in docs/handoff.md). Banned turns are not applied here either - most of
the 11,051 are U-turn bans, which barely change a zone-to-zone time - and are left to assignment.

The routing library is AequilibraE, the same one the assignment will use, so both steps read one
graph. Its handling of one-way links, tolls along the path and blocked centroids was checked on a
three-node test network before it was pointed at Hong Kong.

Zones join the network through their connectors (pipeline/15) at 25 km/h - the speed of getting
from a building to the main road. A trip is never allowed to pass through another zone's centroid.

Run from the project root (about a minute):
    uv run python pipeline/17_car_skim.py
"""

import json
import warnings
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from aequilibrae.paths import Graph, NetworkSkimming

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "data" / "model"
OUTPUT = MODEL / "skim-car-freeflow.npz"
AUDIT = ROOT / "data" / "web" / "car-skim-audit.json"
ZONES = ROOT / "data" / "web" / "zones.geojson"
CENTRES = MODEL / "zone-centres.parquet"
BUILDINGS = ROOT / "data" / "raw" / "buildings" / "buildings-classified.parquet"

CONNECTOR_KPH = 25
NODE_OFFSET = 10_000  # network node ids sit above the zone centroids (1 .. number of zones)
HK80, WGS84 = "EPSG:2326", "EPSG:4326"
GRID_M = 100  # cell size of the developed-land grid used to recognise a detour round the hills
DEVELOPED_REACH_CELLS = 2  # land within this many cells of a building counts as developed

HK_ISLAND = {"Central and Western", "Wan Chai", "Eastern", "Southern"}
KOWLOON = {"Yau Tsim Mong", "Sham Shui Po", "Kowloon City", "Wong Tai Sin", "Kwun Tong"}
# Places people know, to read the matrix against. Coordinates are the town centres.
LANDMARKS = {
    "中环": (114.1580, 22.2819),
    "尖沙咀": (114.1722, 22.2988),
    "观塘": (114.2260, 22.3122),
    "沙田": (114.1886, 22.3823),
    "屯门": (113.9772, 22.3927),
    "东涌": (113.9415, 22.2893),
}
SAMPLE_TRIPS = [("屯门", "中环"), ("沙田", "尖沙咀"), ("东涌", "中环"), ("观塘", "中环"), ("中环", "屯门")]


def build_network(zone_ids: list[str]) -> tuple[pd.DataFrame, dict[str, int]]:
    links = pd.read_parquet(MODEL / "road-links.parquet")
    links = links[links["routable"]]
    connectors = pd.read_parquet(MODEL / "road-connectors.parquet")

    centroid = {zone: index + 1 for index, zone in enumerate(zone_ids)}
    road = pd.DataFrame({
        "a_node": links["a_node"] + NODE_OFFSET,
        "b_node": links["b_node"] + NODE_OFFSET,
        "direction": links["direction"],
        "time": links["free_flow_min"],
        "distance": links["length_m"] / 1000,
        "toll": links["toll_hkd"],
    })
    connectors = connectors[connectors["zone"].isin(centroid)]
    access = pd.DataFrame({
        "a_node": connectors["zone"].map(centroid),
        "b_node": connectors["node_id"] + NODE_OFFSET,
        "direction": 0,
        "time": connectors["metres"] / 1000 / CONNECTOR_KPH * 60,
        "distance": connectors["metres"] / 1000,
        "toll": 0.0,
    })
    network = pd.concat([access, road], ignore_index=True)
    network.insert(0, "link_id", np.arange(1, len(network) + 1))
    network["id"] = network["link_id"]
    return network, centroid


def skim(network: pd.DataFrame, centroid: dict[str, int]) -> dict[str, np.ndarray]:
    """Full zone-by-zone matrices; zones with no road access come back as NaN rows and columns."""
    connected = sorted(set(network["a_node"]) & set(centroid.values()))
    graph = Graph()
    graph.network = network
    graph.prepare_graph(np.array(connected))
    graph.set_graph("time")
    graph.set_skimming(["time", "distance", "toll"])
    graph.set_blocked_centroid_flows(True)
    run = NetworkSkimming(graph)
    run.execute()
    matrices = run.results.skims
    order = {c: i for i, c in enumerate(matrices.index)}
    n = len(centroid)
    rows = np.array([order.get(centroid[z], -1) for z in centroid])
    have = rows >= 0
    result = {}
    for name in matrices.names:
        full = np.full((n, n), np.nan)
        full[np.ix_(have, have)] = matrices.get_matrix(name)[np.ix_(rows[have], rows[have])]
        result[name] = full
    return result


def intrazonal(time: np.ndarray, distance: np.ndarray) -> None:
    """A trip that stays inside a zone: half the way to its nearest neighbour (common practice)."""
    for matrix in (time, distance):
        off = matrix.copy()
        np.fill_diagonal(off, np.inf)
        off[~np.isfinite(off)] = np.inf
        nearest = off.min(axis=1)
        np.fill_diagonal(matrix, np.where(np.isfinite(nearest), nearest / 2, np.nan))


def developed_land() -> tuple[np.ndarray, float, float]:
    """A grid marking land within 200 m of a building; the rest of the land is hills and country park."""
    from scipy.ndimage import binary_dilation

    frame = pd.read_parquet(BUILDINGS, columns=["lon", "lat"])
    points = gpd.GeoSeries(gpd.points_from_xy(frame["lon"], frame["lat"]), crs=WGS84).to_crs(HK80)
    x0, y0 = points.x.min() - 5000, points.y.min() - 5000
    cols = ((points.x - x0) // GRID_M).astype(int)
    rows = ((points.y - y0) // GRID_M).astype(int)
    grid = np.zeros((rows.max() + 100, cols.max() + 100), dtype=bool)
    grid[rows, cols] = True
    return binary_dilation(grid, iterations=DEVELOPED_REACH_CELLS), x0, y0


def main() -> None:
    landuse = pd.read_parquet(MODEL / "landuse-2026.parquet")
    zone_ids = landuse["zone"].tolist()
    network, centroid = build_network(zone_ids)
    print(f"{len(network):,} 条有向图边（含 {len(centroid)} 个小区的接驳线）")

    matrices = skim(network, centroid)
    time, distance, toll = matrices["time"], matrices["distance"], matrices["toll"]
    unreachable = ~np.isfinite(time) | (time > 1e6)
    np.fill_diagonal(unreachable, False)
    time[unreachable] = np.nan
    distance[unreachable] = np.nan
    toll[unreachable] = np.nan
    intrazonal(time, distance)
    np.fill_diagonal(toll, 0)

    np.savez_compressed(OUTPUT, zones=np.array(zone_ids), time_min=time, distance_km=distance, toll_hkd=toll)

    # --- audit --------------------------------------------------------------------------------
    report = []
    n = len(zone_ids)
    missing = int(unreachable.sum())
    road_audit = json.loads((ROOT / "data" / "web" / "road-network-audit.json").read_text(encoding="utf-8"))
    isolated = set(road_audit.get("road_isolated_zones", []))
    lonely = np.isin(np.array(zone_ids), list(isolated))
    unexplained = int((unreachable & ~lonely[:, None] & ~lonely[None, :]).sum())
    report.append(
        f"连通：{n}×{n} = {n * n:,} 个小区对，到不了的 {missing:,} 对，全部涉及 {len(isolated)} 个无公路小区"
        if unexplained == 0 else
        f"连通：有 {unexplained} 对到不了且不涉及无公路小区  ← 路网断开，需复核"
    )

    district = landuse.set_index("zone")["district"].reindex(zone_ids).to_numpy()
    island = np.isin(district, list(HK_ISLAND))
    kowloon = np.isin(district, list(KOWLOON))
    cross = np.zeros_like(unreachable)
    cross[np.ix_(island, kowloon)] = True
    cross[np.ix_(kowloon, island)] = True
    free_crossings = int(((toll == 0) & cross & ~unreachable).sum())
    report.append(f"过海收费：港岛↔九龙 {int(cross.sum()):,} 个小区对全部经收费隧道"
                  if free_crossings == 0 else
                  f"过海收费：港岛↔九龙有 {free_crossings} 对没交隧道费  ← 路网有不该存在的免费过海路径，需复核")

    zones = gpd.read_file(ZONES).set_index("zone").reindex(zone_ids)
    # The straight line is drawn between the same points the routes start and end at.
    centres = pd.read_parquet(CENTRES).set_index("zone").reindex(zone_ids)
    xy = centres[["x", "y"]].to_numpy()
    straight = np.linalg.norm(xy[:, None, :] - xy[None, :, :], axis=2) / 1000
    valid = ~unreachable & (straight > 2)
    np.fill_diagonal(valid, False)
    speed = distance[valid] / (time[valid] / 60)
    circuity = distance[valid] / straight[valid]
    report.append(f"合理性：自由流平均车速中位 {np.median(speed):.0f} km/h（10%-90%：{np.percentile(speed, 10):.0f}-"
                  f"{np.percentile(speed, 90):.0f}）；绕行系数中位 {np.median(circuity):.2f}"
                  f"（道路距离/直线距离，城市常见 1.2-1.6，香港有海港和山体会偏高）")
    # A big detour is explained when the straight line between the two zones crosses the sea - a
    # car has to go round by a bridge or tunnel - or the hills. Hong Kong's hills are its country
    # parks, land with no building near it: a straight line that runs a third of its way more than
    # 200 m from any building is crossing high ground. (This used to be read from zones with fewer
    # than 100 people per km2, which stopped working once hillside fragments were merged into the
    # towns below them.) Anything left after water and hills is listed by name.
    metric = zones.to_crs(HK80)
    land = metric.geometry.buffer(50).union_all()
    developed, x0, y0 = developed_land()
    pairs = np.argwhere(valid)[circuity > 4]
    over_water, over_hills, unexplained_detours = 0, 0, []
    for i, j in pairs:
        line = shapely.LineString([xy[i], xy[j]])
        samples = np.linspace(xy[i], xy[j], 200)
        cells = developed[((samples[:, 1] - y0) // GRID_M).astype(int), ((samples[:, 0] - x0) // GRID_M).astype(int)]
        if line.difference(land).length > 200:
            over_water += 1
        elif (~cells).mean() > 0.3:
            over_hills += 1
        else:
            unexplained_detours.append((zone_ids[i], zone_ids[j], float(distance[i, j] / straight[i, j])))
    if len(pairs):
        worst = sorted(unexplained_detours, key=lambda p: -p[2])[:4]
        report.append(
            f"绕行系数 >4 的小区对 {len(pairs)} 个：{over_water} 个直线跨海、{over_hills} 个直线翻越郊野"
            f"（三成以上离任何楼宇超过 200 米），均属地形所致；"
            + (f"其余 {len(unexplained_detours)} 个需人工核实：{', '.join(f'{a}↔{b} ×{c:.1f}' for a, b, c in worst)}"
               if unexplained_detours else "无其他")
        )

    asym = np.abs(time - time.T)[valid] / ((time + time.T)[valid] / 2)
    report.append(f"往返不对称：中位 {np.median(asym):.1%}，90% 分位 {np.percentile(asym, 90):.1%}（单行道与匝道造成）")

    located = {}
    for name, (lon, lat) in LANDMARKS.items():
        point = gpd.GeoSeries(gpd.points_from_xy([lon], [lat]), crs=WGS84).iloc[0]
        hit = zones.geometry.contains(point)
        if hit.any():
            located[name] = zone_ids.index(hit[hit].index[0])
    samples = []
    for origin, destination in SAMPLE_TRIPS:
        if origin in located and destination in located:
            i, j = located[origin], located[destination]
            samples.append(f"{origin}→{destination} {time[i, j]:.0f} 分钟 / {distance[i, j]:.0f} km / "
                           f"隧道费 {toll[i, j]:.0f} 元")
    report.append("抽查（无拥堵）：" + "；".join(samples))

    report.append("未纳入：转向限制（多为禁止掉头，对小区间时间影响小，留给分配阶段）；"
                  "收费只记录不影响选路（时间价值尚无出处，待定）")
    report.append("实测vs估算：这是自由流估算，不是实际行车时间；分配后会用拥堵时间替换并迭代")

    AUDIT.write_text(json.dumps({
        "zones": n, "unreachable_pairs": missing, "free_harbour_crossings": free_crossings,
        "median_speed_kph": round(float(np.median(speed)), 1),
        "median_circuity": round(float(np.median(circuity)), 3),
        "connector_kph": CONNECTOR_KPH,
        "report": report,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"-> {OUTPUT.relative_to(ROOT)}")
    for line in report:
        print("   " + line)


if __name__ == "__main__":
    main()
