"""Step 4b: the buses and minibuses on every road link in the weekday morning peak hour (08:00-09:00),
straight from the timetables - a fixed load that the car assignment has to share the road with.

Input : data/raw/gtfs_merged/hk-merged.gtfs.zip   timetables (pipeline/17b: Transport Department GTFS
                                                  for buses, minibuses, trams, ferries)
        data/model/road-links.parquet, road-nodes.parquet   the road network (pipeline/15)
        data/web/traffic/atc-stations.json, atc-occupancy.json   Annual Traffic Census (pipeline/07), for the check
        data/model/census-links.parquet          the link side each census station counts (pipeline/15c)
Output: data/model/bus-preload-am.parquet        link_id, bus_ab, bus_ba, minibus_ab, minibus_ba (vehicles/hour)
        data/model/bus-segment-paths.parquet     each stop-to-stop hop -> the road links it runs along
        data/web/bus-preload-audit.json

Why a preload. Franchised buses and green minibuses run to a timetable whatever the traffic, so they
are not assigned; they are counted. TPDM Volume 2's design flows are in vehicles with heavy vehicles
(buses included) up to 15% allowed for (2.4.1.1), so buses go on as vehicles, and each link's
heavy-vehicle share is carried forward for the Table 2.4.1.2 reduction.

How. For every trip running on a weekday (Wednesday service), each departure from a stop between
08:00 and 09:00 counts once on the hop to the next stop; frequency-based trips are expanded from
their headways. The timetables carry no route shapes, so each hop is laid on the road network as the
quickest free-flow path between the stops. Each stop is placed beside a road link, not at the
nearest junction: snapping to junctions within 150 m put Kwun Tong Road's stops on Ngau Tau Kok
Road, one block away, and loaded 497 buses an hour onto it. A stop within 25 m of a dual
carriageway is close to both halves, so it keeps every link side within 25 m and each hop takes the
pair of sides that gives the quickest path (the wrong half means turning round).

Left out: residents' services (Discovery Bay, Ma Wan) - they are special purpose buses, which mode
choice already puts on the road; red minibuses (no timetable is published); trams, which run on
their own tracks (TPDM: a lane with frequent trams is taken out of the capacity instead).

Check the timetables did not set: the census's core stations count franchised buses and public
light buses per hour; the preload on the link at each station should be close.

Run from the project root (a few minutes):
    uv run python pipeline/25_bus_preload.py
"""

import json
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
from pyproj import Transformer
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "data" / "model"
WEB = ROOT / "data" / "web"
GTFS = ROOT / "data" / "raw" / "gtfs_merged" / "hk-merged.gtfs.zip"
OUTPUT = MODEL / "bus-preload-am.parquet"
PATHS = MODEL / "bus-segment-paths.parquet"
AUDIT = WEB / "bus-preload-audit.json"
STATIONS = WEB / "traffic" / "atc-stations.json"
OCCUPANCY = WEB / "traffic" / "atc-occupancy.json"

PEAK = (8 * 3600, 9 * 3600)
WEEKDAY = "wednesday"
SERVICE_DATE = 20260916  # a Wednesday in term time, no public holiday
LEFT_OUT_AGENCIES = {"td:PI", "td:DB"}  # residents' services: special purpose buses, from mode choice
MINIBUS_AGENCIES = {"td:GMB"}
CANDIDATES = 3  # nearest links kept per stop (each with both sides if two-way)
STOP_LINK_M = 25  # a stop stands beside a link this close: its own carriageway, or the one across
SNAP_M = 150  # failing that (stops inside bus termini), the nearest link this close
SNAP_KPH = 15  # stop-to-link distance is charged at this speed when choosing the sides
PATH_LIMIT_MIN = 40.0  # longest free-flow hop searched (express sections through tunnels)
BATCH = 256
CENSUS_LINKS = MODEL / "census-links.parquet"  # pipeline/15c
CENSUS_YEAR = 2024


def seconds(text: pd.Series) -> np.ndarray:
    parts = text.str.split(":", expand=True).astype(int)
    return (parts[0] * 3600 + parts[1] * 60 + parts[2]).to_numpy()


def running_services(feed: zipfile.ZipFile) -> set[str]:
    calendar = pd.read_csv(feed.open("calendar.txt"), dtype={"service_id": str})
    active = set(calendar.loc[(calendar[WEEKDAY] == 1) & (calendar["start_date"] <= SERVICE_DATE)
                              & (calendar["end_date"] >= SERVICE_DATE), "service_id"])
    exceptions = pd.read_csv(feed.open("calendar_dates.txt"), dtype={"service_id": str})
    today = exceptions[exceptions["date"] == SERVICE_DATE]
    active |= set(today.loc[today["exception_type"] == 1, "service_id"])
    active -= set(today.loc[today["exception_type"] == 2, "service_id"])
    return active


def peak_hops(feed: zipfile.ZipFile, report: list[str]) -> pd.DataFrame:
    """Departures between 08:00 and 09:00 on each stop-to-stop hop, by route and vehicle kind."""
    routes = pd.read_csv(feed.open("routes.txt"), dtype=str)
    routes = routes[(routes["route_type"] == "3") & ~routes["agency_id"].isin(LEFT_OUT_AGENCIES)]
    trips = pd.read_csv(feed.open("trips.txt"), dtype=str, usecols=["route_id", "service_id", "trip_id"])
    trips = trips[trips["route_id"].isin(routes["route_id"]) & trips["service_id"].isin(running_services(feed))]
    kind = routes.set_index("route_id")["agency_id"].isin(MINIBUS_AGENCIES).map({True: "minibus", False: "bus"})
    trips["kind"] = trips["route_id"].map(kind)

    times = pd.read_csv(feed.open("stop_times.txt"), dtype={"trip_id": str, "stop_id": str},
                        usecols=["trip_id", "stop_id", "stop_sequence", "departure_time"])
    times = times[times["trip_id"].isin(trips["trip_id"])].sort_values(["trip_id", "stop_sequence"])
    times["t"] = seconds(times["departure_time"])
    times["next_stop"] = times.groupby("trip_id")["stop_id"].shift(-1)
    times["offset"] = times["t"] - times.groupby("trip_id")["t"].transform("first")
    hops = times.dropna(subset=["next_stop"])

    frequencies = pd.read_csv(feed.open("frequencies.txt"), dtype={"trip_id": str})
    frequencies = frequencies[frequencies["trip_id"].isin(trips["trip_id"])]
    frequencies["start"] = seconds(frequencies["start_time"])
    frequencies["end"] = seconds(frequencies["end_time"])

    # Frequency-based trips: departures start, start + h, ... (< end) from the first stop; the bus is
    # at a later stop `offset` seconds after. Count those at the stop within the peak hour.
    scheduled = hops.merge(frequencies[["trip_id", "start", "end", "headway_secs"]], on="trip_id")
    h = scheduled["headway_secs"].to_numpy()
    first = scheduled["start"].to_numpy() + scheduled["offset"].to_numpy()  # first bus at this stop
    last = scheduled["end"].to_numpy() - 1 + scheduled["offset"].to_numpy()  # departures strictly before end
    low = np.maximum(first, PEAK[0])
    high = np.minimum(last, PEAK[1] - 1)
    count = np.where(high >= low, np.floor((high - first) / h) - np.ceil((low - first) / h) + 1, 0)
    scheduled = scheduled.assign(departures=np.maximum(count, 0))

    fixed = hops[~hops["trip_id"].isin(frequencies["trip_id"])]
    fixed = fixed.assign(departures=((fixed["t"] >= PEAK[0]) & (fixed["t"] < PEAK[1])).astype(float))

    counted = pd.concat([scheduled[["trip_id", "stop_id", "next_stop", "departures"]],
                         fixed[["trip_id", "stop_id", "next_stop", "departures"]]])
    counted = counted[counted["departures"] > 0].merge(trips[["trip_id", "route_id", "kind"]], on="trip_id")
    per_hop = counted.groupby(["stop_id", "next_stop", "kind"], as_index=False)["departures"].sum()
    routes_running = counted["route_id"].nunique()
    report.append(f"工作日（{SERVICE_DATE}，{WEEKDAY}）8-9 时行驶的巴士/小巴线路 {routes_running} 条（不含居民巴士、电车）；"
                  f"站到站路段 {len(per_hop):,} 个；发车：巴士 {per_hop.loc[per_hop.kind == 'bus', 'departures'].sum():,.0f}、"
                  f"专线小巴 {per_hop.loc[per_hop.kind == 'minibus', 'departures'].sum():,.0f}（站次）")
    return per_hop


class Roads:
    """The routable network as directed link sides (a link open both ways is two sides)."""

    def __init__(self) -> None:
        links = pd.read_parquet(MODEL / "road-links.parquet")
        self.links = links[links["routable"]].reset_index(drop=True)
        nodes = pd.read_parquet(MODEL / "road-nodes.parquet").set_index("node_id")
        self.nodes = nodes
        forward = self.links[self.links["direction"].isin([0, 1])]
        backward = self.links[self.links["direction"].isin([0, -1])]
        sides = pd.concat([
            pd.DataFrame({"link_id": forward["link_id"], "side": "ab", "u": forward["a_node"],
                          "v": forward["b_node"], "w": forward["free_flow_min"]}),
            pd.DataFrame({"link_id": backward["link_id"], "side": "ba", "u": backward["b_node"],
                          "v": backward["a_node"], "w": backward["free_flow_min"]}),
        ], ignore_index=True)
        sides["w"] = sides["w"].clip(lower=1e-4)  # scipy reads an explicit zero as no edge
        sides[["u", "v"]] = sides[["u", "v"]].astype(int)
        self.sides = sides
        quickest = sides.sort_values("w").drop_duplicates(["u", "v"])  # parallel links: the quicker one
        n = int(nodes.index.max()) + 1
        self.graph = csr_matrix((quickest["w"], (quickest["u"], quickest["v"])), shape=(n, n))
        self.edge = {(u, v): i for i, u, v in zip(quickest.index, quickest["u"], quickest["v"])}

        # Points every 10 m along each link, to find the link a stop stands beside.
        ax, ay = nodes.loc[self.links["a_node"], "x"].to_numpy(), nodes.loc[self.links["a_node"], "y"].to_numpy()
        bx, by = nodes.loc[self.links["b_node"], "x"].to_numpy(), nodes.loc[self.links["b_node"], "y"].to_numpy()
        steps = np.maximum(1, np.ceil(self.links["length_m"].to_numpy() / 10)).astype(int)
        owner = np.repeat(np.arange(len(self.links)), steps + 1)
        t = np.concatenate([np.linspace(0, 1, s + 1) for s in steps])
        self.samples = np.column_stack([ax[owner] + t * (bx - ax)[owner], ay[owner] + t * (by - ay)[owner]])
        self.sample_link = owner
        self.tree = cKDTree(self.samples)
        self.sides_of = sides.groupby(sides["link_id"]).groups  # link_id -> side indices
        self.link_ids = self.links["link_id"].to_numpy()

    def beside(self, x: float, y: float) -> list[tuple[int, float]]:
        """Link sides a stop could be on: every side of the links within STOP_LINK_M, or failing
        that the nearest link within SNAP_M; (side index, metres)."""
        for reach in (STOP_LINK_M, SNAP_M):
            near = self.tree.query_ball_point([x, y], reach)
            if near:
                break
        else:
            return []
        dist = np.hypot(self.samples[near, 0] - x, self.samples[near, 1] - y)
        by_link: dict[int, float] = {}
        for i, d in zip(np.asarray(near)[np.argsort(dist)], np.sort(dist)):
            by_link.setdefault(int(self.link_ids[self.sample_link[i]]), float(d))
        ranked = sorted(by_link.items(), key=lambda kv: kv[1])
        if reach == SNAP_M:
            ranked = ranked[:1]
        return [(int(s), d) for link, d in ranked[:CANDIDATES] for s in self.sides_of[link]]


def snap_stops(feed: zipfile.ZipFile, stop_ids: set[str], roads: Roads) -> dict[str, list[tuple[int, float]]]:
    stops = pd.read_csv(feed.open("stops.txt"), dtype={"stop_id": str}, usecols=["stop_id", "stop_lat", "stop_lon"])
    stops = stops[stops["stop_id"].isin(stop_ids)]
    x, y = Transformer.from_crs("EPSG:4326", "EPSG:2326", always_xy=True).transform(stops["stop_lon"], stops["stop_lat"])
    snapped = {}
    for stop, sx, sy in zip(stops["stop_id"], x, y):
        sides = roads.beside(sx, sy)
        if sides:
            snapped[stop] = sides
    return snapped


def lay_hops(hops: pd.DataFrame, snapped: dict, roads: Roads) -> dict:
    """Quickest road path for every hop: hop -> [side index, ...].

    A hop runs from the end of the side the first stop is on to the side the next stop is on, and
    includes that last side but not the first (the previous hop already has it), so a bus is not
    counted twice on the link at a stop. Where a stop could be on either carriageway, the pair of
    sides giving the quickest path wins - the wrong carriageway means turning round.
    """
    sides = roads.sides
    pairs = hops[["stop_id", "next_stop"]].drop_duplicates()
    pairs = pairs[pairs["stop_id"].isin(snapped) & pairs["next_stop"].isin(snapped)]
    pairs = list(pairs.itertuples(index=False, name=None))
    by_origin: dict[int, list[tuple[int, int, float]]] = {}
    for p, (a, _) in enumerate(pairs):
        for side, d in snapped[a]:
            by_origin.setdefault(int(sides.at[side, "v"]), []).append((p, side, d))
    best = [np.inf] * len(pairs)
    chosen: list[list | None] = [None] * len(pairs)
    per_min = SNAP_KPH * 1000 / 60  # metres per minute
    for p, (a, b) in enumerate(pairs):  # both stops beside the same side: no new link
        for side_a, d_a in snapped[a]:
            for side_b, d_b in snapped[b]:
                if side_a == side_b and (d_a + d_b) / per_min < best[p]:
                    best[p], chosen[p] = (d_a + d_b) / per_min, []
    origins = sorted(by_origin)
    for start in range(0, len(origins), BATCH):
        batch = origins[start:start + BATCH]
        dist, pred = dijkstra(roads.graph, indices=batch, return_predecessors=True, limit=PATH_LIMIT_MIN)
        for row, origin in enumerate(batch):
            for p, side_a, d_a in by_origin[origin]:
                for side_b, d_b in snapped[pairs[p][1]]:
                    if side_b == side_a:
                        continue
                    target = int(sides.at[side_b, "u"])
                    cost = dist[row, target] + sides.at[side_b, "w"] + (d_a + d_b) / per_min
                    if cost < best[p]:
                        path, here = [side_b], target
                        while here != origin and here >= 0:
                            before = pred[row, here]
                            path.append(roads.edge[(int(before), int(here))])
                            here = before
                        best[p], chosen[p] = cost, path[::-1]
        print(f"   {min(start + BATCH, len(origins)):,}/{len(origins):,} 个起点", flush=True)
    return {pair: path for pair, path, cost in zip(pairs, chosen, best) if np.isfinite(cost)}


def census_check(load: pd.DataFrame, report: list[str]) -> dict:
    """Preloaded buses and minibuses past each core station, both directions, against the census's
    08:00-09:00 count: two-way weekday AADT x the station's weekday share in that hour x the OCC
    sheet's share of franchised buses (public light buses) in that hour."""
    census = json.loads(STATIONS.read_text(encoding="utf-8"))
    records = pd.DataFrame(census["records"])
    records = records[records["year"] == CENSUS_YEAR]
    profile = {h["station"]: h["weekday_pct"][PEAK[0] // 3600] for h in census["hourly"] if h["year"] == CENSUS_YEAR}
    occupancy = json.loads(OCCUPANCY.read_text(encoding="utf-8"))["stations"]
    mix = {o["station"]: o["hours"]["0800-0900"] for o in occupancy if o["year"] == CENSUS_YEAR and "0800-0900" in o["hours"]}
    matched = pd.read_parquet(CENSUS_LINKS)
    loaded = load.set_index("link_id")
    rows = []
    for station, group in records.groupby("station"):
        sides = matched[matched["station"] == station]
        if (station not in mix or station not in profile or group["aadt"].isna().any()
                or set(sides["direction"]) != set(group["direction"])):
            continue
        flow = group["aadt"].sum() * profile[station] / 100
        share = mix[station]
        bus = sum(loaded.at[r.link_id, f"bus_{r.side}"] if r.link_id in loaded.index else 0.0 for r in sides.itertuples())
        minibus = sum(loaded.at[r.link_id, f"minibus_{r.side}"] if r.link_id in loaded.index else 0.0 for r in sides.itertuples())
        rows.append({"station": int(station), "road": str(group["link"].iloc[0])[:40], "flow": round(flow),
                     "census_bus": flow * (share["franchised_bus_single"]["share_pct"] + share["franchised_bus_double"]["share_pct"]) / 100,
                     "census_plb": flow * share["public_light_bus"]["share_pct"] / 100,
                     "preload_bus": bus, "preload_minibus": minibus})
    table = pd.DataFrame(rows)
    ratio_bus = table["preload_bus"].sum() / table["census_bus"].sum()
    ratio_mb = table["preload_minibus"].sum() / table["census_plb"].sum()
    geh = np.sqrt(2 * (table["preload_bus"] - table["census_bus"]) ** 2 / (table["preload_bus"] + table["census_bus"]).clip(lower=1))
    report.append(f"普查核对（{len(table)} 个核心站，8-9 时两方向）：专营巴士 模型/普查 = {ratio_bus:.2f}，GEH<5 的站 "
                  f"{np.mean(geh < 5):.0%}；小巴 模型（仅专线）/普查（专线 + 红色）= {ratio_mb:.2f}"
                  + ("" if 0.85 <= ratio_bus <= 1.15 and np.mean(geh < 5) >= 0.85 else "  ← 需复核"))
    worst = table.assign(geh=geh).nlargest(5, "geh")
    report.append("  差距最大的站：" + "；".join(f"{r.station} {r.road[:24]} 模型 {r.preload_bus:.0f} / 普查 {r.census_bus:.0f}"
                                           for r in worst.itertuples()))
    return {"stations": len(table), "bus_ratio": round(ratio_bus, 3), "minibus_ratio": round(ratio_mb, 3),
            "bus_geh_under_5": round(float(np.mean(geh < 5)), 3),
            "table": table.round(1).to_dict(orient="records")}


def main() -> None:
    report: list[str] = []
    feed = zipfile.ZipFile(GTFS)
    print("读取班次表…", flush=True)
    hops = peak_hops(feed, report)
    roads = Roads()
    links = roads.links
    stops = set(hops["stop_id"]) | set(hops["next_stop"])
    snapped = snap_stops(feed, stops, roads)
    close = sum(1 for s in snapped.values() if s[0][1] <= STOP_LINK_M)
    report.append(f"车站落到路网：{len(snapped):,}/{len(stops):,}（{close:,} 个在路边 {STOP_LINK_M} 米内，"
                  f"其余在 {SNAP_M} 米内，多为巴士总站）")
    print("铺设站间路径…", flush=True)
    paths = lay_hops(hops, snapped, roads)

    laid = hops.apply(lambda r: (r["stop_id"], r["next_stop"]) in paths, axis=1)
    share_laid = hops.loc[laid, "departures"].sum() / hops["departures"].sum()
    report.append(f"站间路径铺好的发车占 {share_laid:.1%}" + ("" if share_laid > 0.97 else "  ← 需复核"))

    side_link, side_dir = roads.sides["link_id"].to_numpy(), roads.sides["side"].to_numpy()
    load: dict[tuple[int, str, str], float] = {}
    for stop, nxt, kind, departures in hops[laid].itertuples(index=False, name=None):
        for side in paths[(stop, nxt)]:
            key = (int(side_link[side]), side_dir[side], kind)
            load[key] = load.get(key, 0.0) + departures
    frame = pd.Series(load).rename_axis(["link_id", "side", "kind"]).reset_index(name="vehicles")
    frame["column"] = frame["kind"] + "_" + frame["side"]
    table = frame.pivot_table(index="link_id", columns="column", values="vehicles", aggfunc="sum", fill_value=0.0)
    for column in ("bus_ab", "bus_ba", "minibus_ab", "minibus_ba"):
        if column not in table:
            table[column] = 0.0
    table = table[["bus_ab", "bus_ba", "minibus_ab", "minibus_ba"]].reset_index()
    table.to_parquet(OUTPUT, index=False)

    length = links.set_index("link_id")["length_m"].reindex(table["link_id"]).to_numpy() / 1000
    bus_km = ((table["bus_ab"] + table["bus_ba"]) * length).sum()
    minibus_km = ((table["minibus_ab"] + table["minibus_ba"]) * length).sum()
    report.append(f"8-9 时车公里：巴士 {bus_km:,.0f}、专线小巴 {minibus_km:,.0f}；有巴士的路段 {len(table):,} 段")
    busiest = table.assign(total=table["bus_ab"] + table["bus_ba"]).nlargest(5, "total")
    streets = links.set_index("link_id")["street"]
    report.append("巴士最多的路段：" + "；".join(f"{streets.get(r.link_id)} {r.bus_ab:.0f}/{r.bus_ba:.0f}"
                                              for r in busiest.itertuples()))

    pd.DataFrame([{"from_stop": a, "to_stop": b, "links": [int(side_link[s]) for s in path],
                   "sides": [str(side_dir[s]) for s in path]}
                  for (a, b), path in paths.items()]).to_parquet(PATHS, index=False)
    check = census_check(table, report)
    AUDIT.write_text(json.dumps({"period": "weekday 08:00-09:00", "service_date": SERVICE_DATE,
                                 "bus_km": round(bus_km), "minibus_km": round(minibus_km),
                                 "census_check": check, "report": report}, ensure_ascii=False, indent=1),
                     encoding="utf-8")
    print(f"-> {OUTPUT.relative_to(ROOT)}, {PATHS.relative_to(ROOT)}")
    for line in report:
        print("   " + line)


if __name__ == "__main__":
    main()
