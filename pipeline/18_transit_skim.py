"""Door-to-door times by public transport, on foot and by bicycle, between every pair of zones.

Input : data/raw/gtfs_merged/hk-merged.gtfs.zip     timetables: official buses, minibuses, trams and ferries
                                                    plus the community MTR and light rail (pipeline/17b)
        data/raw/osm/hong-kong-latest.osm.pbf      OpenStreetMap, for the walk to and from the stop
        data/model/zone-centres.parquet            where each zone's trips start (pipeline/15)
        data/model/skim-car-freeflow.npz           to compare against (pipeline/17)
Output: data/model/skim-active-transit.npz         zone-by-zone matrices (455 x 455): transit, walk, bicycle (minutes)
        data/web/transit-skim-audit.json

The routing engine is R5 (through r5py), which walks from the zone's activity centre to a stop,
waits, rides, changes and walks the last stretch, all on the published timetables. Most Hong Kong
services run to a headway rather than a timetable (93% of trips in this feed), and R5 treats those
by drawing many possible departure times inside the window and reporting the median.

The trip starts on Tuesday 22 September 2026 between 07:30 and 08:30 - an ordinary school and
working day in the feed's calendar (no holiday exception that date), and the same morning peak the
road network's tolls are taken at.

Origins are the same activity centres the car matrix used, so the two can be compared pair by pair.
Cheung Chau, Peng Chau and Lamma have no road access (pipeline/15) but do have ferries; this is the
matrix that gives them a way in and out.

A zone's activity centre can sit where the walking network does not let it be reached:
  - on a scrap of footpath OpenStreetMap never joined to the streets (Wah Ming Estate: 20,000 people
    nobody could reach, and who could reach nobody);
  - more than about 2 km's walk from any stop. R5 links stops to destinations only within that
    distance, while a trip may START anywhere its own street search reaches, so such a zone can be
    left but not reached (Mui Tsz Lam, a hillside village: 99% of zones reachable from it, 11% able
    to reach it; routed from its stop with the 41-minute walk added back, both became 100%).
    Paths tagged access=private were suspected first and ruled out: its walk to the stop works
    both ways.
Before the matrices, each centre is walked to its eight nearest stops (up to 3 km) and back. If
any of them is within half an hour's walk both ways, R5 can reach the centre and it stays. If none
is, the zone is routed from the stop with the shortest walk, and that walk is added back to every
trip in and out of it (where no walk could be routed at all: the straight line at walking pace with
a 1.3 detour factor). Without the added walk, Lamma (routed from a pier 847 m away) would have been
a quarter of an hour closer to everywhere than it is. Testing only the single nearest stop was not
enough: Discovery Bay's centre is 470 m from a pontoon it takes over half an hour to walk to, and
was routed from that pontoon - 35 minutes added to every trip, Central 103 minutes away instead of
68 - although the main ferry pier is an easy walk.

R5 must run on Java 21. JAVA_HOME is read from the project's .env before r5py is imported - left to
itself the JVM finder picks up any older Java on the machine and fails.

Run from the project root (several minutes; --sample N for a quick check on N zones):
    uv run python pipeline/18_transit_skim.py
"""

import argparse
import datetime as dt
import hashlib
import io
import json
import os
import shutil
import warnings
import zipfile
from concurrent.futures import ThreadPoolExecutor
from importlib.metadata import version
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
os.environ["JAVA_HOME"] = dotenv_values(ROOT / ".env")["JAVA_HOME"]

import geopandas as gpd  # noqa: E402  (JAVA_HOME has to be set before r5py loads)
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import r5py  # noqa: E402

warnings.filterwarnings("ignore")

MODEL = ROOT / "data" / "model"
GTFS = ROOT / "data" / "raw" / "gtfs_merged" / "hk-merged.gtfs.zip"
OSM = ROOT / "data" / "raw" / "osm" / "hong-kong-latest.osm.pbf"
OUTPUT = MODEL / "skim-active-transit.npz"
AUDIT = ROOT / "data" / "web" / "transit-skim-audit.json"
ROAD_AUDIT = ROOT / "data" / "web" / "road-network-audit.json"
STAGING = ROOT / "data" / "cache" / "r5-inputs"

DEPARTURE = dt.datetime(2026, 9, 22, 7, 30)
WINDOW = dt.timedelta(minutes=60)
MAX_TRANSIT = dt.timedelta(hours=3)
MAX_ACTIVE = dt.timedelta(hours=2)  # nobody walks or cycles further than this for a daily trip
WORKERS = min(16, max(1, (os.cpu_count() or 2) - 4))  # leave a few cores for the rest of the machine
CHUNK = 2  # origins per task
WALK_KPH = 3.6  # R5's default walking speed, used for access walks it cannot route
BIKE_KPH = 12.0  # R5's default cycling speed
STOP_SEARCH_M = 3000  # a zone further than this from any stop keeps its own centre
CANDIDATE_STOPS = 8  # nearest distinct stop locations tried for each centre
ACCESS_LIMIT = dt.timedelta(minutes=60)
DETOUR = 1.3  # walking distance over straight-line distance, for an access walk that cannot be routed
# R5 links stops to destinations only within about 2 km of walking, so a trip cannot end further than
# that from a stop - while a trip can START anywhere its own street search reaches. A centre whose
# nearest stop is a longer walk than this is routed from the stop (hillside villages such as Mui Tsz Lam).
EGRESS_LIMIT_MIN = 30.0

LANDMARKS = {
    "中环": (114.1580, 22.2819),
    "尖沙咀": (114.1722, 22.2988),
    "观塘": (114.2260, 22.3122),
    "沙田": (114.1886, 22.3823),
    "屯门": (113.9772, 22.3927),
    "东涌": (113.9415, 22.2893),
    "长洲": (114.0290, 22.2100),
}
SAMPLE_TRIPS = [("屯门", "中环"), ("沙田", "尖沙咀"), ("东涌", "中环"), ("观塘", "中环"), ("长洲", "中环")]


def staged(path: Path) -> Path:
    """A copy of an input whose name changes whenever its content does.

    r5py copies every input into its own cache under the input's file name and never refreshes that
    copy. A GTFS rebuilt under the same name is therefore silently ignored: the network cache is
    keyed on content and rebuilds, but it rebuilds from the stale copy. (A merged feed that R5 had
    rejected kept being rejected after it was fixed.) Naming the staged copy after its content
    makes a changed timetable impossible to miss - which matters once the sandbox edits routes.
    """
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
    stem, suffix = path.name.split(".", 1)
    target = STAGING / f"{stem}-{digest}.{suffix}"
    if not target.exists():
        STAGING.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
    return target


def check_service_day() -> None:
    """The departure day must be a normal weekday in the feed, not a holiday exception."""
    feed = zipfile.ZipFile(GTFS)
    exceptions = pd.read_csv(io.BytesIO(feed.read("calendar_dates.txt")), dtype=str)
    if (exceptions["date"] == DEPARTURE.strftime("%Y%m%d")).any():
        raise RuntimeError(f"{DEPARTURE:%Y-%m-%d} is a holiday exception in the GTFS feed; pick another day")
    if DEPARTURE.weekday() >= 5:
        raise RuntimeError("the departure day must be a weekday")


def matrix(network, points: gpd.GeoDataFrame, modes: list, max_time: dt.timedelta, label: str,
           destinations: gpd.GeoDataFrame | None = None) -> np.ndarray:
    """All origins to all destinations, several origins at a time.

    r5py 1.1.7 routes the origins of one TravelTimeMatrix strictly one after another, which left 19
    of this machine's 20 cores idle: 5.4 s per origin, 42 minutes for the transit matrix alone.
    Splitting the origins into chunks on a thread pool - R5 releases Python's lock while it routes,
    and r5py's own DetailedItineraries shares one network across threads the same way - measured
    1.6 s per origin with 16 threads.
    """
    ids = points["id"].tolist()
    targets = points if destinations is None else destinations
    target_ids = targets["id"].tolist()
    chunks = [points.iloc[i:i + CHUNK] for i in range(0, len(points), CHUNK)]
    done = [0]

    def route(origins: gpd.GeoDataFrame) -> pd.DataFrame:
        result = r5py.TravelTimeMatrix(
            network,
            origins=origins,
            destinations=targets,
            snap_to_network=True,
            departure=DEPARTURE,
            departure_time_window=WINDOW,
            transport_modes=modes,
            max_time=max_time,
        )
        done[0] += len(origins)
        print(f"   {label} {done[0]}/{len(ids)}", end="\r", flush=True)
        return pd.DataFrame(result)[["from_id", "to_id", "travel_time"]]

    with ThreadPoolExecutor(WORKERS) as pool:
        table = pd.concat(pool.map(route, chunks), ignore_index=True)
    print()
    table = table.pivot(index="from_id", columns="to_id", values="travel_time")
    return np.array(table.reindex(index=ids, columns=target_ids), dtype=float)  # a writable copy


def access_points(network, points: gpd.GeoDataFrame) -> tuple[gpd.GeoDataFrame, dict[str, str], np.ndarray]:
    """Route a zone from a stop when its centre cannot walk to any nearby stop and back in time.

    Returns the routing points, a note per moved zone, and the minutes to add to every trip in and out
    of each zone (zero for the zones left where they were).
    """
    feed = zipfile.ZipFile(GTFS)
    stops = pd.read_csv(io.BytesIO(feed.read("stops.txt")), dtype=str, keep_default_na=False)
    stops = stops[stops["location_type"].isin(["", "0"])]
    located = gpd.GeoDataFrame(
        stops, geometry=gpd.points_from_xy(stops["stop_lon"].astype(float), stops["stop_lat"].astype(float)),
        crs="EPSG:4326",
    ).to_crs(2326)
    # Several operators often share one kerb; one candidate per spot.
    located = located.loc[~located.geometry.apply(lambda g: (round(g.x), round(g.y))).duplicated()]
    xy = np.column_stack([located.geometry.x, located.geometry.y])
    centres = points.to_crs(2326)

    rows = []
    for i, centre in enumerate(centres.geometry):
        metres = np.hypot(xy[:, 0] - centre.x, xy[:, 1] - centre.y)
        for rank, k in enumerate(np.argsort(metres)[:CANDIDATE_STOPS]):
            if metres[k] <= STOP_SEARCH_M:
                rows.append((i, rank, k, float(metres[k])))
    candidates = pd.DataFrame(rows, columns=["zone", "rank", "stop", "metres"])
    lonlat = located.to_crs(4326).geometry.to_numpy()
    # r5py sets every pair whose origin and destination share an id to 0 minutes, whether or not
    # they are the same place - so the stops get ids of their own, or a stranded centre reads as
    # "0 minutes from its stop" and is never caught.
    stop_points = gpd.GeoDataFrame(
        {"id": [f"{points['id'].iloc[z]}|stop{r}" for z, r in zip(candidates["zone"], candidates["rank"])]},
        geometry=[lonlat[k] for k in candidates["stop"]],
        crs="EPSG:4326",
    )
    out_all = matrix(network, points, [r5py.TransportMode.WALK], ACCESS_LIMIT, "步行到附近车站", stop_points)
    back_all = matrix(network, stop_points, [r5py.TransportMode.WALK], ACCESS_LIMIT, "从附近车站步行回来", points)
    candidates["out"] = out_all[candidates["zone"].to_numpy(), np.arange(len(candidates))]
    candidates["back"] = back_all[np.arange(len(candidates)), candidates["zone"].to_numpy()]
    candidates["worst"] = candidates[["out", "back"]].max(axis=1, skipna=False)

    walk_m_per_min = WALK_KPH * 1000 / 60
    moved, penalty = {}, np.zeros(len(points))
    routed = points.copy()
    for i, group in candidates.groupby("zone"):
        if (group["worst"] <= EGRESS_LIMIT_MIN).any():
            continue  # some stop is a short walk away both ways: R5 reaches this centre itself
        both = group[np.isfinite(group["worst"])]
        if not both.empty:
            best = both.loc[both["worst"].idxmin()]
            penalty[i] = (best["out"] + best["back"]) / 2
            why = "附近车站都要步行半小时以上，R5 不让公交乘客下车后走这么远"
        else:
            one_way = group[np.isfinite(group["out"]) | np.isfinite(group["back"])]
            if not one_way.empty:
                best = one_way.loc[one_way[["out", "back"]].min(axis=1).idxmin()]
                penalty[i] = float(np.nanmin([best["out"], best["back"]]))
                why = "只能单向步行（通道限制）"
            else:
                best = group.loc[group["metres"].idxmin()]
                penalty[i] = best["metres"] * DETOUR / walk_m_per_min
                why = "步行碎片与街道不相连"
        zone = points["id"].iloc[i]
        stop = located.iloc[int(best["stop"])]
        routed.loc[routed.index[i], "geometry"] = lonlat[int(best["stop"])]
        moved[zone] = f"{stop['stop_name'][:28]}（{best['metres']:.0f} 米，补回步行 {penalty[i]:.0f} 分钟；{why}）"
    return routed, moved, penalty


def add_access(time: np.ndarray, minutes: np.ndarray) -> None:
    """Add a zone's access walk to every trip that starts or ends there."""
    time += minutes[:, None]
    time += minutes[None, :]


def intrazonal(time: np.ndarray, fallback: np.ndarray | None = None) -> None:
    """Half the time to the nearest neighbouring zone - the same rule the car matrix uses."""
    off = time.copy()
    np.fill_diagonal(off, np.inf)
    off[~np.isfinite(off)] = np.inf
    nearest = off.min(axis=1)
    value = np.where(np.isfinite(nearest), nearest / 2, np.nan)
    if fallback is not None:
        value = np.where(np.isfinite(value), value, np.diag(fallback))
    np.fill_diagonal(time, value)


def locate(zones: list[str]) -> dict[str, int]:
    shapes = gpd.read_file(ROOT / "data" / "web" / "zones.geojson").set_index("zone")
    found = {}
    for name, (lon, lat) in LANDMARKS.items():
        point = gpd.GeoSeries(gpd.points_from_xy([lon], [lat]), crs="EPSG:4326").iloc[0]
        hit = shapes.index[shapes.geometry.contains(point)]
        if len(hit) and hit[0] in zones:
            found[name] = zones.index(hit[0])
    return found


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", type=int, default=0, help="only the first N zones, for a quick check")
    parser.add_argument("--zones", default="", help="only these zones (comma-separated), for a quick check")
    args = parser.parse_args()
    if args.zones:
        args.sample = len(args.zones.split(","))

    check_service_day()
    centres = pd.read_parquet(MODEL / "zone-centres.parquet")
    landuse = pd.read_parquet(MODEL / "landuse-2026.parquet")
    centres = centres.set_index("zone").reindex(landuse["zone"]).reset_index()
    if args.zones:
        centres = centres[centres["zone"].isin(args.zones.split(","))]
    elif args.sample:
        centres = centres.head(args.sample)
    zones = centres["zone"].tolist()
    points = gpd.GeoDataFrame(
        {"id": zones}, geometry=gpd.points_from_xy(centres["lon"], centres["lat"]), crs="EPSG:4326"
    )

    print("建立 R5 网络（OSM + GTFS）…", flush=True)
    network = r5py.TransportNetwork(staged(OSM), [staged(GTFS)])
    points, moved, penalty = access_points(network, points)
    print(f"改用附近车站作起终点的小区 {len(moved)} 个：{moved}", flush=True)

    print(f"{len(zones)}×{len(zones)}，{WORKERS} 个线程", flush=True)
    transit = matrix(network, points, [r5py.TransportMode.TRANSIT, r5py.TransportMode.WALK], MAX_TRANSIT, "公交")
    walk = matrix(network, points, [r5py.TransportMode.WALK], MAX_ACTIVE, "步行")
    bike = matrix(network, points, [r5py.TransportMode.BICYCLE], MAX_ACTIVE, "单车")

    add_access(transit, penalty)
    add_access(walk, penalty)
    add_access(bike, penalty * WALK_KPH / BIKE_KPH)  # the same stretch, ridden
    intrazonal(walk)
    intrazonal(bike)
    intrazonal(transit, fallback=walk)  # a trip inside a zone is walked

    # Save before anything else can fail. A first full run spent an hour routing and then lost it
    # all to a mistake in the audit code below, which a --sample run never reached because it
    # returned early. A sample run now goes through saving and the audit too, to its own file.
    output = OUTPUT.with_name(f"{OUTPUT.stem}.sample{OUTPUT.suffix}") if args.sample else OUTPUT
    np.savez_compressed(
        output, zones=np.array(zones), transit_min=transit, walk_min=walk, bike_min=bike,
        departure=str(DEPARTURE), window_min=WINDOW.seconds // 60,
        routed_from_stop=np.array(sorted(moved)),
        access_penalty_min=penalty,
    )
    print(f"-> {output.relative_to(ROOT)}", flush=True)
    if args.sample:
        print(pd.DataFrame(transit, index=zones, columns=zones).round(0).iloc[:6, :6])

    task = r5py.RegionalTask(network, points.geometry.iloc[0], departure=DEPARTURE)  # origin is a point
    speeds = {"walk_kph": float(task.speed_walking), "bike_kph": float(task.speed_cycling)}

    # --- audit --------------------------------------------------------------------------------
    report = []
    n = len(zones)
    off = ~np.eye(n, dtype=bool)
    gaps = ~np.isfinite(transit) & off
    lost = int(gaps.sum())
    per_zone = pd.Series(gaps.sum(axis=0) + gaps.sum(axis=1), index=zones).sort_values(ascending=False)
    worst = per_zone[per_zone > 0].head(6)
    report.append(
        f"连通：公交 3 小时内到不了的小区对 {lost:,} 个（占 {lost / (n * (n - 1)):.2%}）"
        + (f"；涉及最多的小区 {', '.join(f'{z}({c})' for z, c in worst.items())}" if lost else "，全部可达")
        + ("  ← 需复核" if lost / (n * (n - 1)) > 0.005 else "")
    )
    report.append(f"起终点：{len(moved)} 个小区的活动中心附近没有半小时内能往返的车站，改用步行最短的车站并补回步行时间："
                  + ("；".join(f"{z} {s}" for z, s in moved.items()) if moved else "无"))

    isolated = json.loads(ROAD_AUDIT.read_text(encoding="utf-8")).get("road_isolated_zones", [])
    island_rows = [zones.index(z) for z in isolated if z in zones]
    island_lines = []
    island_ok = True
    for i in island_rows:
        leave = float(np.isfinite(transit[i, off[i]]).mean())
        reach = float(np.isfinite(transit[off[:, i], i]).mean())
        island_ok &= leave > 0.95 and reach > 0.95
        island_lines.append(f"{zones[i]} 出 {leave:.0%} / 进 {reach:.0%}")
    report.append(f"无公路小区：{len(island_rows)} 个（离岛靠渡轮，山村靠步行），3 小时内公交可达比例 "
                  + "，".join(island_lines) + ("" if island_ok else "  ← 需复核"))

    both = np.isfinite(transit) & np.isfinite(walk) & off
    slower = int((transit[both] > walk[both] + 0.5).sum())
    report.append(f"一致性：公交时间（允许直接步行）不应长于纯步行，违反的小区对 {slower}"
                  + ("" if slower == 0 else "  ← 需复核"))

    car = np.load(MODEL / "skim-car-freeflow.npz", allow_pickle=True)
    car_time = pd.DataFrame(car["time_min"], index=car["zones"], columns=car["zones"]).reindex(
        index=zones, columns=zones).to_numpy()
    paired = np.isfinite(transit) & np.isfinite(car_time) & off
    ratio = transit[paired] / car_time[paired]
    report.append(f"对比小汽车（无拥堵）：公交/小汽车时间比中位 {np.median(ratio):.2f}，"
                  f"公交更快的小区对占 {(ratio < 1).mean():.1%}（多为铁路直达、道路绕行的组合）")

    shapes = pd.read_parquet(MODEL / "zone-centres.parquet").set_index("zone").reindex(zones)
    xy = shapes[["x", "y"]].to_numpy()
    straight = np.linalg.norm(xy[:, None, :] - xy[None, :, :], axis=2) / 1000
    short = np.isfinite(walk) & off & (straight > 0.5)
    pace = straight[short] / (walk[short] / 60)
    report.append(f"步行：R5 步速 {speeds['walk_kph']:.1f} km/h；按直线距离折算的有效步速中位 {np.median(pace):.1f} km/h"
                  f"（低于步速是因为要沿街道、天桥绕行）；单车 {speeds['bike_kph']:.1f} km/h")

    located = locate(zones)
    samples = []
    for origin, destination in SAMPLE_TRIPS:
        if origin in located and destination in located:
            i, j = located[origin], located[destination]
            car_part = f"，开车（无拥堵）{car_time[i, j]:.0f}" if np.isfinite(car_time[i, j]) else "，不能开车"
            samples.append(f"{origin}→{destination} 公交 {transit[i, j]:.0f} 分钟{car_part}")
    report.append("抽查（门到门，含步行与候车）：" + "；".join(samples))
    report.append(f"出发：{DEPARTURE:%Y-%m-%d %H:%M} 起 {WINDOW.seconds // 60} 分钟窗口的中位数；"
                  "该日在 GTFS 日历中无节假日例外")
    report.append("实测vs估算：线路、站点、班次/发车间隔为公布数据；步速、候车按引擎默认；"
                  "尚未计入车厢拥挤与换乘不便的额外负担（方式划分时用权重处理）")
    report.append("抽样误差：93% 的班次按发车间隔编排，引擎随机抽取发车时刻取中位数，"
                  "同一对小区重算会差约 1-2 分钟")

    audit_path = AUDIT.with_name(f"{AUDIT.stem}.sample{AUDIT.suffix}") if args.sample else AUDIT
    audit_path.write_text(json.dumps({
        "engine": f"R5 via r5py {version('r5py')}",
        "departure": str(DEPARTURE), "window_min": WINDOW.seconds // 60,
        "speeds": speeds, "unreachable_transit_pairs": lost,
        "report": report,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    for line in report:
        print("   " + line)


if __name__ == "__main__":
    main()
