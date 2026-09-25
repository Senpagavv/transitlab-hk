"""Merge the official and the community GTFS into the one timetable the transit skim runs on.

Input : data/raw/gtfs_official/td-gtfs-en.zip      Transport Department, headway information (GTFS),
                                                    https://static.data.gov.hk/td/pt-headway-en/gtfs.zip
        data/raw/gtfs_community/hk.gtfs.zip        wheelstransit/hongkong-community-gtfs (ODbL)
Output: data/raw/gtfs_merged/hk-merged.gtfs.zip
        data/web/transit-feed-audit.json

Why two feeds (the plan in docs/reuse-and-references.md, 2026-09-15):
  official  - buses, green minibuses, trams, the Peak Tram and every licensed ferry, 2,452 routes. No MTR,
              no light rail.
  community - built from OpenStreetMap, the only feed with the MTR's 10 lines and the 11 light rail
              routes. Everything else in it is thinner than the official feed and in places wrong:
              every Central - Peng Chau ferry runs Peng Chau to Central (none come back), Central -
              Cheung Chau has no morning sailing from Cheung Chau, and one direction of bus 230R to
              Ma Wan runs on weekends only. A skim built on it alone could not reach Peng Chau from
              433 of 464 zones. So only the MTR and light rail are taken from it.

Bus stop times. The official feed times only the first and last stop of each bus trip (88% of its
stop times are blank), and R5 fills the gaps in proportion to straight-line distance. That hands the
long, fast expressway sections far too much of the journey and the slow town streets far too little:
on route 960, Tuen Mun town centre to Central came out at 53 minutes in the vehicle against 35 in the
community feed, which times every stop. Here the blanks are filled in proportion to each hop's
free-flow time on the road network built by pipeline/15, plus a dwell at every stop, and scaled so
the timed stops keep exactly the official times.

Every id from each feed is prefixed ("td:", "osm:") so the two can never collide. Fares, shapes,
pathways and translations are left out: the routing engine does not use them.

ODbL: the merged file contains community data. Showing results built on it needs attribution;
publishing the merged database itself would have to be under ODbL too.

Run from the project root (about a minute):
    uv run python pipeline/17b_transit_feed.py
"""

import io
import json
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra

ROOT = Path(__file__).resolve().parents[1]
OFFICIAL = ROOT / "data" / "raw" / "gtfs_official" / "td-gtfs-en.zip"
COMMUNITY = ROOT / "data" / "raw" / "gtfs_community" / "hk.gtfs.zip"
OUTPUT = ROOT / "data" / "raw" / "gtfs_merged" / "hk-merged.gtfs.zip"
AUDIT = ROOT / "data" / "web" / "transit-feed-audit.json"
ROAD = ROOT / "data" / "model"

BUS = "3"
DWELL_MIN = 0.4  # time at each intermediate stop, added to the road time of the hop before it
HOP_LIMIT_MIN = 30.0  # a hop longer than this on the road network is not a real bus hop
FALLBACK_KPH = 20.0  # hops the road network cannot route (stop far from any road) run at this speed

FILES = ["agency", "routes", "trips", "stop_times", "stops", "calendar", "calendar_dates", "frequencies"]
COMMUNITY_AGENCIES = {"MTRR": "MTR", "LR": "Light Rail"}  # the only services taken from the community feed
MODE_NAMES = {"0": "电车/轻铁", "1": "港铁", "3": "巴士/小巴", "4": "渡轮", "7": "山顶缆车"}
SERVICE_DAY = "20260922"  # the day the skim is run for (a Tuesday)
PEAK = ("07:30:00", "08:30:00")
WEEKDAY = "tuesday"

# Which columns carry an id of which kind, so a prefix is applied consistently everywhere.
ID_COLUMNS = {
    "agency": ["agency_id"],
    "routes": ["route_id", "agency_id"],
    "trips": ["trip_id", "route_id", "service_id"],
    "stop_times": ["trip_id", "stop_id"],
    "stops": ["stop_id", "parent_station"],
    "calendar": ["service_id"],
    "calendar_dates": ["service_id"],
    "frequencies": ["trip_id"],
}
DROPPED_COLUMNS = {"trips": ["shape_id"], "stops": ["zone_id", "level_id"]}


def read(feed: Path) -> dict[str, pd.DataFrame]:
    archive = zipfile.ZipFile(feed)
    names = set(archive.namelist())
    return {
        name: pd.read_csv(io.BytesIO(archive.read(f"{name}.txt")), dtype=str, keep_default_na=False)
        if f"{name}.txt" in names else pd.DataFrame()
        for name in FILES
    }


def one_url(value: str) -> str:
    """One well-formed URL, as R5's parser insists on.

    Jointly run routes list both operators' sites as "https://a|https://b", and some timetable links
    to Transport Department PDFs contain spaces ("SofS_RS DB01R_Eng.pdf"). R5 refuses to load a feed
    with either.
    """
    return value.split("|")[0].strip().replace(" ", "%20")


def prefix(tables: dict[str, pd.DataFrame], tag: str) -> dict[str, pd.DataFrame]:
    out = {}
    for name, frame in tables.items():
        frame = frame.drop(columns=[c for c in DROPPED_COLUMNS.get(name, []) if c in frame.columns])
        for column in ("agency_url", "route_url"):
            if column in frame.columns:
                frame[column] = frame[column].map(one_url)
        for column in ID_COLUMNS[name]:
            if column in frame.columns:
                frame[column] = frame[column].map(lambda v: f"{tag}:{v}" if v != "" else "")
        out[name] = frame
    return out


def road_graph():
    links = pd.read_parquet(ROAD / "road-links.parquet")
    links = links[links["routable"]]
    nodes = pd.read_parquet(ROAD / "road-nodes.parquet")
    both = links["direction"].eq(0)
    edges = pd.DataFrame({
        "a": np.concatenate([links["a_node"], links.loc[both, "b_node"]]),
        "b": np.concatenate([links["b_node"], links.loc[both, "a_node"]]),
        "cost": np.concatenate([links["free_flow_min"], links.loc[both, "free_flow_min"]]),
    })
    # A sparse matrix adds up duplicate entries; two parallel links between the same junctions must
    # count as the faster one, not as their sum.
    edges = edges.groupby(["a", "b"], as_index=False)["cost"].min()
    graph = coo_matrix((edges["cost"], (edges["a"], edges["b"])), shape=(len(nodes), len(nodes))).tocsr()
    degree = pd.concat([links["a_node"], links["b_node"]]).value_counts()
    nodes = nodes[nodes["node_id"].map(degree).fillna(0) >= 2]
    return graph, gpd.GeoDataFrame(nodes, geometry=gpd.points_from_xy(nodes["x"], nodes["y"]), crs="EPSG:2326")


def fill_bus_stop_times(tables: dict[str, pd.DataFrame]) -> dict:
    """Give every official bus stop a time, shaped by road free-flow time between stops."""
    routes = tables["routes"]
    bus_trips = tables["trips"].loc[tables["trips"]["route_id"].isin(
        routes.loc[routes["route_type"] == BUS, "route_id"]), "trip_id"]
    times = tables["stop_times"]
    times["seq"] = times["stop_sequence"].astype(int)
    times.sort_values(["trip_id", "seq"], inplace=True)
    times.reset_index(drop=True, inplace=True)
    is_bus = times["trip_id"].isin(bus_trips)

    stops = tables["stops"]
    located = gpd.GeoDataFrame(
        stops[["stop_id"]],
        geometry=gpd.points_from_xy(stops["stop_lon"].astype(float), stops["stop_lat"].astype(float)),
        crs="EPSG:4326",
    ).to_crs("EPSG:2326")
    graph, nodes = road_graph()
    snapped = gpd.sjoin_nearest(located, nodes[["node_id", "geometry"]], how="left", distance_col="metres")
    snapped = snapped[~snapped.index.duplicated(keep="first")]
    node_of = dict(zip(snapped["stop_id"], snapped["node_id"]))
    xy = dict(zip(located["stop_id"], zip(located.geometry.x, located.geometry.y)))

    bus = times[is_bus]
    nxt = bus.groupby("trip_id")["stop_id"].shift(-1)
    hops = pd.DataFrame({"a": bus["stop_id"], "b": nxt}).dropna().drop_duplicates()
    hops["na"] = hops["a"].map(node_of).astype(int)
    hops["nb"] = hops["b"].map(node_of).astype(int)

    road_min = {}
    all_sources = hops["na"].drop_duplicates().to_numpy()
    for batch_start in range(0, len(all_sources), 400):
        sources = all_sources[batch_start:batch_start + 400]
        found = dijkstra(graph, directed=True, indices=sources, limit=HOP_LIMIT_MIN)
        index = {int(n): i for i, n in enumerate(sources)}
        part = hops[hops["na"].isin(sources)]
        for row in part.itertuples():
            road_min[(row.a, row.b)] = found[index[int(row.na)], int(row.nb)]

    def hop_minutes(a: str, b: str) -> float:
        value = road_min.get((a, b), np.inf)
        if np.isfinite(value):
            return float(value)
        (xa, ya), (xb, yb) = xy[a], xy[b]
        return float(np.hypot(xa - xb, ya - yb)) / 1000 / FALLBACK_KPH * 60

    def clock(value: str) -> float:
        h, m, s = value.split(":")
        return int(h) * 60 + int(m) + int(s) / 60

    def text(minutes: float) -> str:
        whole = int(round(minutes * 60))
        return f"{whole // 3600:02d}:{whole % 3600 // 60:02d}:{whole % 60:02d}"

    filled = routed = fallback = 0
    arrival = times["arrival_time"].to_numpy(object)
    departure = times["departure_time"].to_numpy(object)
    for _, trip in times[is_bus].groupby("trip_id", sort=False):
        idx = trip.index.to_numpy()
        ids = trip["stop_id"].to_numpy()
        weight = np.zeros(len(idx))
        for k in range(1, len(idx)):
            minutes = hop_minutes(ids[k - 1], ids[k])
            if (ids[k - 1], ids[k]) in road_min and np.isfinite(road_min[(ids[k - 1], ids[k])]):
                routed += 1
            else:
                fallback += 1
            weight[k] = weight[k - 1] + minutes + (DWELL_MIN if k < len(idx) - 1 else 0.0)
        known = [k for k in range(len(idx)) if departure[idx[k]] or arrival[idx[k]]]
        if len(known) < 2:
            continue
        known_time = {k: clock(departure[idx[k]] or arrival[idx[k]]) for k in known}
        for left, right in zip(known, known[1:]):
            span = weight[right] - weight[left]
            for k in range(left + 1, right):
                share = (weight[k] - weight[left]) / span if span > 0 else (k - left) / (right - left)
                stamp = text(known_time[left] + share * (known_time[right] - known_time[left]))
                arrival[idx[k]] = departure[idx[k]] = stamp
                filled += 1
    times["arrival_time"] = arrival
    times["departure_time"] = departure
    times.drop(columns="seq", inplace=True)
    far = int((snapped["metres"] > 150).sum())
    return {"filled": filled, "hops_on_roads": routed, "hops_fallback": fallback, "stops_far_from_road": far}


def community_rail(tables: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame]:
    """Only the MTR and light rail, with exactly the stops, services and stations they use."""
    routes = tables["routes"][tables["routes"]["agency_id"].isin(COMMUNITY_AGENCIES)]
    trips = tables["trips"][tables["trips"]["route_id"].isin(routes["route_id"])]
    times = tables["stop_times"][tables["stop_times"]["trip_id"].isin(trips["trip_id"])]
    stops = tables["stops"]
    used = stops[stops["stop_id"].isin(times["stop_id"])]
    parents = stops[stops["stop_id"].isin(used["parent_station"])]
    services = set(trips["service_id"])
    return {
        "agency": tables["agency"][tables["agency"]["agency_id"].isin(COMMUNITY_AGENCIES)],
        "routes": routes,
        "trips": trips,
        "stop_times": times,
        "stops": pd.concat([used, parents]).drop_duplicates("stop_id"),
        "calendar": tables["calendar"][tables["calendar"]["service_id"].isin(services)],
        "calendar_dates": tables["calendar_dates"][tables["calendar_dates"]["service_id"].isin(services)],
        "frequencies": tables["frequencies"][tables["frequencies"]["trip_id"].isin(trips["trip_id"])],
    }


def active_services(merged: dict[str, pd.DataFrame]) -> set[str]:
    calendar = merged["calendar"]
    running = set(calendar.loc[
        (calendar[WEEKDAY] == "1") & (calendar["start_date"] <= SERVICE_DAY) & (calendar["end_date"] >= SERVICE_DAY),
        "service_id",
    ])
    changes = merged["calendar_dates"]
    today = changes[changes["date"] == SERVICE_DAY]
    running |= set(today.loc[today["exception_type"] == "1", "service_id"])
    running -= set(today.loc[today["exception_type"] == "2", "service_id"])
    return running


def route_check(merged: dict[str, pd.DataFrame]) -> str:
    """Route 960, Tuen Mun town centre to Central: the case that exposed straight-line interpolation."""
    routes = merged["routes"]
    trips = merged["trips"][merged["trips"]["route_id"].isin(
        routes.loc[(routes["route_short_name"] == "960") & routes["route_id"].str.startswith("td:"), "route_id"])]
    stops = merged["stops"].set_index("stop_id")
    town, central = np.array([113.9772, 22.3927]), np.array([114.1580, 22.2819])
    for trip in trips["trip_id"]:
        st = merged["stop_times"][merged["stop_times"]["trip_id"] == trip]
        st = st.assign(seq=st["stop_sequence"].astype(int)).sort_values("seq")
        xy = np.array([[float(stops.loc[s, "stop_lon"]), float(stops.loc[s, "stop_lat"])] for s in st["stop_id"]])
        board = int(np.argmin(np.hypot(*(xy - town).T)))
        alight = int(np.argmin(np.hypot(*(xy - central).T)))
        if alight <= board:
            continue
        clock = [int(h) * 60 + int(m) + int(s) / 60 for h, m, s in
                 (v.split(":") for v in st["departure_time"].where(st["departure_time"].ne(""), st["arrival_time"]))]
        return (f"960 屯门市中心→中环车上时间 {clock[alight] - clock[board]:.0f} 分钟"
                f"（全程 {clock[-1] - clock[0]:.0f}；社区版逐站时间为 35，直线插值为 53）")
    return "960 线未找到，无法抽查"


def audit(merged: dict[str, pd.DataFrame], official_routes: int, community_routes: int,
          profile: dict) -> list[str]:
    report = []
    times = merged["stop_times"]
    blank = times[times["arrival_time"].eq("") & times["departure_time"].eq("")]
    kinds = blank.merge(merged["trips"][["trip_id", "route_id"]], on="trip_id").merge(
        merged["routes"][["route_id", "route_type"]], on="route_id")["route_type"].value_counts()
    bus_blank = int(kinds.get(BUS, 0))
    others = "、".join(f"{MODE_NAMES.get(k, k)} {v:,}" for k, v in kinds.items() if k != BUS)
    report.append(
        f"巴士逐站时间：补齐 {profile['filled']:,} 个中途站，站间按路网自由流车程分配的 {profile['hops_on_roads']:,} 段、"
        f"路网走不通按 {FALLBACK_KPH:.0f} km/h 估算的 {profile['hops_fallback']:,} 段；"
        f"离最近路口超过 150 米的站 {profile['stops_far_from_road']:,} 个"
    )
    report.append(
        f"仍由 R5 按直线距离插值的站：{others or '无'}（电车站距均匀、渡轮中途停靠少，插值合适）"
        + (f"；巴士仍有 {bus_blank:,} 个站没有时间  ← 需复核" if bus_blank else "；巴士已全部补齐")
    )
    report.append(route_check(merged))

    # 1. Every reference resolves - a dangling id is a trip R5 silently drops.
    stops = set(merged["stops"]["stop_id"])
    trips = set(merged["trips"]["trip_id"])
    services = set(merged["calendar"]["service_id"]) | set(merged["calendar_dates"]["service_id"])
    broken = {
        "trip→route": int((~merged["trips"]["route_id"].isin(merged["routes"]["route_id"])).sum()),
        "trip→service": int((~merged["trips"]["service_id"].isin(services)).sum()),
        "stop_time→trip": int((~merged["stop_times"]["trip_id"].isin(trips)).sum()),
        "stop_time→stop": int((~merged["stop_times"]["stop_id"].isin(stops)).sum()),
        "frequency→trip": int((~merged["frequencies"]["trip_id"].isin(trips)).sum()),
        "stop→parent": int((merged["stops"]["parent_station"].ne("")
                            & ~merged["stops"]["parent_station"].isin(stops)).sum()),
        "route→agency": int((~merged["routes"]["agency_id"].isin(merged["agency"]["agency_id"])).sum()),
    }
    bad = {k: v for k, v in broken.items() if v}
    report.append("引用完整：全部 id 都能对上" if not bad else f"引用断裂 {bad}  ← 需复核")

    urls = pd.concat([merged["agency"]["agency_url"], merged["routes"].get("route_url", pd.Series(dtype=str))])
    urls = urls[urls.ne("")]
    malformed = int((~urls.str.match(r"^https?://[^\s|]+$")).sum())
    report.append("网址格式：全部可被 R5 解析" if not malformed else f"网址格式不合规 {malformed} 个  ← 需复核")

    duplicates = {name: int(merged[name][column].duplicated().sum())
                  for name, column in (("stops", "stop_id"), ("trips", "trip_id"), ("routes", "route_id"))}
    report.append("id 唯一：站点、班次、线路均无重复" if not any(duplicates.values())
                  else f"id 重复 {duplicates}  ← 需复核")

    # 2. What runs on the modelled morning.
    running = active_services(merged)
    trip_table = merged["trips"][merged["trips"]["service_id"].isin(running)].merge(
        merged["routes"][["route_id", "route_type", "agency_id"]], on="route_id")
    first = (merged["stop_times"].assign(seq=merged["stop_times"]["stop_sequence"].astype(int))
             .sort_values("seq").groupby("trip_id").first())
    frequencies = merged["frequencies"]
    in_window_freq = set(frequencies.loc[
        (frequencies["start_time"] <= PEAK[1]) & (frequencies["end_time"] >= PEAK[0]), "trip_id"])
    departs = first["departure_time"].reindex(trip_table["trip_id"]).to_numpy()
    trip_table["in_peak"] = trip_table["trip_id"].isin(in_window_freq) | (
        (departs >= PEAK[0]) & (departs <= PEAK[1]))
    by_mode = trip_table.groupby("route_type").agg(routes=("route_id", "nunique"), peak=("in_peak", "sum"))
    report.append(
        f"{SERVICE_DAY} 早高峰（{PEAK[0][:5]}-{PEAK[1][:5]}）有班次的线路/班次组："
        + "；".join(f"{MODE_NAMES.get(t, t)} {int(r.routes)} 条线/{int(r.peak)}" for t, r in by_mode.iterrows())
    )

    mtr = trip_table[trip_table["agency_id"] == "osm:MTRR"]
    report.append(f"港铁：{mtr['route_id'].nunique()} 条线当天运营，其中 {mtr.loc[mtr['in_peak'], 'route_id'].nunique()} "
                  "条早高峰有车（应为 10）")

    # 3. Every ferry route runs both ways in the morning - the community feed's failure.
    ferries = trip_table[trip_table["route_type"] == "4"].copy()
    ferries["origin"] = first["stop_id"].reindex(ferries["trip_id"]).to_numpy()
    one_way = []
    for route, group in ferries.groupby("route_id"):
        if group["origin"].nunique() < 2:
            one_way.append(route)
    names = merged["routes"].set_index("route_id")["route_long_name"]
    report.append(
        f"渡轮：{ferries['route_id'].nunique()} 条航线当天运营，"
        + ("全部双向有船" if not one_way else
           f"{len(one_way)} 条只有单一起点（多为单程或循环航线，逐条核实）：{', '.join(names[r][:24] for r in one_way[:6])}")
    )
    for route in ("td:7005", "td:7007"):
        group = ferries[ferries["route_id"] == route]
        peak_origins = group.loc[group["in_peak"], "origin"].nunique()
        report.append(f"   {names.get(route, route)}：早高峰两端都有开船" if peak_origins >= 2 else
                      f"   {names.get(route, route)}：早高峰只有一端开船  ← 需复核")

    report.append(f"来源：官方 {official_routes:,} 条线全部采用；社区 {community_routes:,} 条线中只取港铁与轻铁 "
                  f"{int(merged['routes']['agency_id'].str.startswith('osm:').sum())} 条")
    return report


def main() -> None:
    official = prefix(read(OFFICIAL), "td")
    profile = fill_bus_stop_times(official)
    community_all = read(COMMUNITY)
    community = prefix(community_rail(community_all), "osm")

    merged = {name: pd.concat([official[name], community[name]], ignore_index=True).fillna("")
              for name in FILES}

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, frame in merged.items():
            archive.writestr(f"{name}.txt", frame.to_csv(index=False))

    report = audit(merged, len(official["routes"]), len(community_all["routes"]), profile)
    AUDIT.write_text(json.dumps({
        "sources": {
            "official": "Transport Department, Headway information of public transport services (GTFS), 2026-09-11",
            "community": "wheelstransit/hongkong-community-gtfs, MTR and light rail only (ODbL, OpenStreetMap contributors)",
        },
        "report": report,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"-> {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size / 1e6:.1f} MB)")
    for line in report:
        print("   " + line)


if __name__ == "__main__":
    main()
