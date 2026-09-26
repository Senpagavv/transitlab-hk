"""Step 4d: equilibrium road assignment, weekday 08:00-09:00, 2026 - and the comparison with the
Annual Traffic Census.

Input : data/model/road-links.parquet, road-connectors.parquet   the network (pipeline/15)
        data/model/am-peak-2026.npz          private vehicle, taxi, special purpose bus trips (pipeline/24)
        data/model/goods-2026.npz            goods vehicles, boundary cars and coaches (pipeline/26)
        data/model/bus-preload-am.parquet    franchised buses and green minibuses per link (pipeline/25)
        data/model/census-links.parquet      the link sides each census station counts (pipeline/15c)
        data/web/traffic/atc-stations.json, atc-occupancy.json   the census (pipeline/07)
        data/web/mode-choice-audit.json      values of time (pipeline/23)
        data/raw/prices/csd_510-60001.json   C&SD Composite CPI, to bring 2011 goods values of time to now
        data/web/cross-boundary.json         control points (pipeline/13)
Output: data/model/assignment-am-2026.parquet   per link and direction: vehicles by class, buses, capacity,
                                                volume / capacity, congested minutes
        data/web/assignment-audit.json

Method. Five classes are assigned together to user equilibrium (bi-conjugate Frank-Wolfe, AequilibraE):
private vehicles (with the boundary cars), taxis, light goods, heavy goods, and coaches (special
purpose buses with the boundary coaches). Franchised buses and green minibuses are a preload: they
run to the timetable and use up road space whatever the traffic. Each class pays its own gazetted
toll - the Transport Department's tables charge by vehicle class, and a taxi passenger also pays the
return toll at the harbour crossings (pipeline/15) - weighed by its own value of time: private
vehicles and taxis by TCS Table E.6 (as mode choice, weighted by the peak hour's trips), goods
vehicles by GVTCS 2011 Table 6.1 raised by the Composite CPI, and by TOLL_WEIGHT below.

Capacity is TPDM Volume 2 Table 2.4.1.1's design flow, in vehicles, which allows for up to 15%
heavy vehicles (medium/heavy goods and all buses). Where the assignment puts more heavy vehicles
on a link, its design flow is cut by Table 2.4.1.2 (15-20%: 7%, 20-25%: 10%; above 25% the table
stops, so 10% is kept and the link is listed) and the assignment is run again. Delay grows with
volume / capacity by the BPR curve (alpha 0.15, beta 4), the usual default: TPDM gives no delay
function, and the census comparison is where this is judged.

Comparison. For every counted direction whose weekday AM peak hour is 08:00-09:00, the census's
one-way flow is compared with the modelled flow summed over the link sides it counts (GEH; the
UK's DMRB and TAG ask for GEH < 5 at 85% of counts). At the core stations the census also gives
the vehicle mix in that hour, so each class is compared too - which is where the goods vehicle
trip lengths and the private car peak share are checked.

Run from the project root (several minutes):
    uv run python pipeline/27_road_assignment.py
"""

import json
import os
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from aequilibrae.matrix import AequilibraeMatrix
from aequilibrae.paths import Graph, TrafficAssignment, TrafficClass
from pyproj import Transformer
from scipy.spatial import cKDTree

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "data" / "model"
WEB = ROOT / "data" / "web"
AM_PEAK = MODEL / "am-peak-2026.npz"
GOODS = MODEL / "goods-2026.npz"
BUSES = MODEL / "bus-preload-am.parquet"
CENSUS_LINKS = MODEL / "census-links.parquet"
STATIONS = WEB / "traffic" / "atc-stations.json"
OCCUPANCY = WEB / "traffic" / "atc-occupancy.json"
MODE_AUDIT = WEB / "mode-choice-audit.json"
PEAK_AUDIT = WEB / "am-peak-audit.json"
CPI = ROOT / "data" / "raw" / "prices" / "csd_510-60001.json"
CROSS_BOUNDARY = WEB / "cross-boundary.json"
OUTPUT = MODEL / "assignment-am-2026.parquet"
AUDIT = WEB / "assignment-audit.json"

NODE_OFFSET = 10_000  # network nodes sit above the centroids (1 .. number of zones), as in pipeline/17
CONNECTOR_KPH = 25  # zone centre to the road, as in pipeline/17
CROSSING_SNAP_M = 3000  # a road crossing joins the network at the nearest nodes this close
CONNECTOR_CAPACITY = 1e6
CENSUS_YEAR = 2024
PEAK_BAND = "0800-0900"
GOODS_VOT_2011 = {"light": (1.83 * 316_000 + 2.11 * 211_000) / 527_000,  # GVTCS 2011 Table 6.1, HK$/min, 2011
                  "heavy": (2.75 * 164_000 + 3.21 * 28_000 + 3.04 * 67_000) / 259_000}  # prices, by type, trip-weighted
HEAVY_REDUCTION = [(0.25, 0.10), (0.20, 0.10), (0.15, 0.07)]  # TPDM Vol 2 Table 2.4.1.2 (share above -> cut)
# Congestion curve fitted to the detectors (pipeline/15e: alpha 0.378, beta 2; the textbook 0.15/4 had the
# morning peak 6% slower than the night on the detector roads, against 20% measured).
_BPR_FILE = ROOT / "data" / "model" / "bpr-parameters.json"
BPR = ({k: float(v) for k, v in json.loads(_BPR_FILE.read_text(encoding="utf-8")).items() if k in ("alpha", "beta")}
       if _BPR_FILE.exists() else {"alpha": 0.15, "beta": 4.0})
# Queue time scale for tunnel chains (see tunnel_queue). Fitted to the tunnel counts; overridable for sweeps.
TUNNEL_QUEUE_MIN = float(os.environ.get("TUNNEL_QUEUE_MIN", "6"))
MAX_ITERATIONS = 100
RGAP = 1e-3
GEH_TARGET = 0.85
# A road taken over by one class is a route-choice fault, not traffic. Taxis are 28% of the peak
# hour's vehicles; these bounds were set from the sweep that removed the taxi toll weight.
TAXI_SHARE_LIMIT, TAXI_SHARE_MIN_FLOW, TAXI_SHARE_ALLOWED = 0.50, 300, 200
# How much of the toll a driver acts on. At 1.0 - every dollar weighed at the driver's own value of
# time - the Tai Lam Tunnel's HK$45 is worth 36 minutes to a private car, so nobody in the model pays
# for it, while the census counts 2,810 vehicles an hour. Fitted against nine tunnel counts by sweeping
# 1.00 / 0.60 / 0.35 / 0.25 / 0.20 / 0.15 / 0.10: corridor GEH < 5 peaks at 0.20 (35%, against 6% at 1.0).
# It is a route-choice calibration parameter, and it stands in for three things the model does not carry:
#   - running cost per kilometre. Route 3 through Tai Lam is about 9 km shorter than Tuen Mun Road, which
#     is roughly HK$18 of petrol - 40% of the toll - and no generalized cost here has a distance term.
#   - the value of time of the people who drive at 08:00. TCS Table E.6 averaged over all private vehicle
#     trips gives HK$1.26 a minute; car-owning households are about a tenth of Hong Kong's.
#   - reliability. The measured speeds say Tuen Mun Road runs at 70 km/h at 08:00 and Route 3 at 81, so
#     the expressway saves little time on average - but it is the free road that fails on a bad day.
# Read it as "route choice behaves as if the driver's value of time were 1 / TOLL_WEIGHT times the survey
# average" - at 0.20, HK$378 an hour. TOLL_WEIGHT=... in the environment overrides it for calibration runs.
TOLL_WEIGHT = float(os.environ.get("TOLL_WEIGHT", 0.20))
# Every class weighs the toll the same. A taxi was briefly the exception, at 1.0: a passenger pays
# the toll in cash on top of the meter, so the per-kilometre argument for the discount does not apply
# to it. That reasoning is sound and the result was not. Because the taxi's value of time is lower
# (HK$0.87 a minute against the car's 1.26), weight 1.0 made a taxi feel HK$8 as 9.2 minutes where a
# car feels it as 1.3 - seven times - and taxis fled the tunnels for the free hill roads. Sweeping
# 0.20 / 0.35 / 0.50 / 0.75 / 1.00 against the census, the number of carriageways carrying more taxis
# than everything else put together rises with the weight at every step - 182, 314, 425, 464 - and
# corridor GEH < 5 is best at 0.20. So the exception is gone: TAXI_TOLL_WEIGHT is kept only to sweep
# it again. What survives from that work is the per-class gazetted TOLLS (pipeline/15), which are
# real published figures, not a weight somebody argued for.
CLASS_TOLL_WEIGHT = {"taxi": float(os.environ["TAXI_TOLL_WEIGHT"])} if "TAXI_TOLL_WEIGHT" in os.environ else {}
CLASSES = ("car", "taxi", "goods_light", "goods_heavy", "coach")  # each has its own toll column (pipeline/15)
# Where a driver picks between parallel tolled and free crossings. The census station names are matched
# as written in the census; each corridor is compared as a whole, which is what route choice decides.
CORRIDORS = {
    "过海": r"CROSS HARBOUR TUNNEL \(|EASTERN HARBOUR CROSSING \(|WESTERN HARBOUR CROSSING \(",
    "沙田－九龙": r"LION ROCK TUNNEL \(|TATE'S CAIRN TUNNEL \(|EAGLE'S NEST TUNNEL \(",
    "屯门－荃湾": r"TAI LAM TUNNEL|TING KAU BRIDGE \(|TUEN MUN RD \(",
    "将军澳": r"TSEUNG KWAN O TUNNEL \(|TSEUNG KWAN O - LAM TIN",
    "大屿山": r"LANTAU LINK \(|TUEN MUN CHEK LAP KOK",
}


def values_of_time(report: list[str]) -> dict:
    """HK$ per minute for each class."""
    audit = json.loads(MODE_AUDIT.read_text(encoding="utf-8"))["values_of_time_hkd_per_min"]
    peak = json.loads(PEAK_AUDIT.read_text(encoding="utf-8"))["fraction_of_daily"]
    daily = np.load(MODEL / "mode-split-2026.npz")
    weights = {p: float(daily[f"T_{p}_PV"].sum()) * peak[p] for p in ("HBW", "HBS", "HBO", "NHB")}
    pv = sum(audit[f"{p}_pv"] * w for p, w in weights.items()) / sum(weights.values())
    taxi_weights = {p: float(daily[f"T_{p}_TAXI"].sum()) * peak[p] for p in ("HBW", "HBS", "HBO", "NHB")}
    taxi = sum(audit[f"{p}_nopv"] * w for p, w in taxi_weights.items()) / sum(taxi_weights.values())
    cpi = json.loads(CPI.read_text(encoding="utf-8"))["dataSet"]
    index = [r for r in cpi if r["sv"] == "CC_CM_1920" and r["svDesc"] == "Index" and r["figure"] != ""]
    year_2011 = next(float(r["figure"]) for r in index if r["freq"] == "Y" and r["period"] == "2011")
    latest = sorted((r for r in index if r["freq"] == "M"), key=lambda r: r["period"])[-12:]
    now = sum(float(r["figure"]) for r in latest) / 12
    inflation = now / year_2011
    vot = {"car": pv, "taxi": taxi, "goods_light": GOODS_VOT_2011["light"] * inflation,
           "goods_heavy": GOODS_VOT_2011["heavy"] * inflation, "coach": pv}
    report.append(f"时间价值（元/分钟）：私家车 {pv:.2f}、的士 {taxi:.2f}（出行调查表 E.6，按早高峰各目的出行加权）；轻型货车 "
                  f"{vot['goods_light']:.2f}、中重型 {vot['goods_heavy']:.2f}（货车调查 2011 × 综合消费物价指数 {inflation:.3f}，"
                  f"{latest[0]['period']}–{latest[-1]['period']} 对 2011 年）")
    return vot


def tunnel_queue(network: pd.DataFrame, links: pd.DataFrame, report: list[str]) -> None:
    """Tunnels are bottlenecks: give each tunnel, per direction of travel, a queue delay that does not
    depend on how long its links are.

    BPR adds delay in proportion to a link's free-flow time. A tunnel's narrowest stretch - the portal or
    toll plaza - is often a link a few seconds long, so even 60% over capacity added seconds, and the
    assignment packed 1.6 times the counted traffic into the Cross Harbour and Lion Rock tunnels and twice
    into Tseung Kwan O - Lam Tin (census 2024, 08:00-09:00; handoff 9/25). A real queue grows with the
    excess, not with the length of the link.
    So the links of each tunnel, direction by direction, are strung into chains, and every link in a chain
    gets its BPR alpha scaled by max(1, TUNNEL_QUEUE_MIN / chain free-flow minutes): the chain as a whole then
    delays like a BPR link of at least TUNNEL_QUEUE_MIN minutes, whatever its length. A link is a tunnel link
    if its name says tunnel or harbour crossing, it lies below ground, or it carries a toll. The queue
    time scale is fitted to the tunnel counts (see TUNNEL_QUEUE_MIN)."""
    info = links.set_index("link_id")[["street", "elevation", "toll_facility"]]
    road = network["road_link"] > 0
    rl = network.loc[road, "road_link"]
    street = rl.map(info["street"]).astype(str).str.strip()
    strategic = network.loc[road, "road_class"].isin(["expressway", "trunk", "primary"])
    # Only real bottlenecks: toll plazas; links named "... TUNNEL" / "... HARBOUR CROSSING" (not the long
    # "... TUNNEL ROAD" approaches, which diluted the queue); and strategic roads underground for at least
    # 200 m (the toll-free tunnels whose names do not say so: Tseung Kwan O - Lam Tin, Eagle's Nest, Nam Wan).
    # A first try that took every underground link gave 400-fold alphas to short city underpasses.
    flagged = (rl.map(info["toll_facility"]).notna()
               | street.str.contains(r"(?:TUNNEL|HARBOUR CROSSING)$", regex=True)
               | ((rl.map(info["elevation"]) < 0) & strategic & (network.loc[road, "distance"] >= 0.2)))
    arcs = network.loc[road].loc[flagged.to_numpy()]
    # Chains: arc i joins arc j when i ends where j starts, unless j is i the other way round.
    parent = {k: k for k in arcs.index}

    def find(k):
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k
    starts = arcs.groupby("a_node").groups
    for i, (b, link) in arcs[["b_node", "road_link"]].iterrows():
        for j in starts.get(b, []):
            if arcs.at[j, "road_link"] != link:
                parent[find(i)] = find(j)
    chain = pd.Series({k: find(k) for k in arcs.index})
    chain_time = arcs["time"].groupby(chain).sum()
    scale = np.maximum(1.0, TUNNEL_QUEUE_MIN / chain_time)
    network["alpha"] = BPR["alpha"]
    network["beta"] = BPR["beta"]
    network.loc[arcs.index, "alpha"] = BPR["alpha"] * chain.map(scale).to_numpy()
    report.append(f"隧道排队：{len(arcs):,} 个隧道行车方向连成 {chain_time.size} 串，每串至少按 {TUNNEL_QUEUE_MIN:g} 分钟的 BPR 延误计"
                  f"（放大的串 {int((scale > 1).sum())} 个）")


def build_graph(ids: list[str], report: list[str]) -> tuple[Graph, pd.DataFrame]:
    """One row per direction of travel, with centroid connectors; returns the graph and the rows."""
    links = pd.read_parquet(MODEL / "road-links.parquet")
    links = links[links["routable"]]
    rows = []
    forward = links[links["direction"].isin([0, 1])]
    rows.append(pd.DataFrame({"road_link": forward["link_id"], "side": "ab", "a_node": forward["a_node"] + NODE_OFFSET,
                              "b_node": forward["b_node"] + NODE_OFFSET, "time": forward["free_flow_min"],
                              "distance": forward["length_m"] / 1000, "capacity": forward["capacity_ab_veh_hr"],
                              "road_class": forward["road_class"],
                              **{f"toll_{c}": forward[f"toll_{c}_hkd"] * CLASS_TOLL_WEIGHT.get(c, TOLL_WEIGHT) for c in CLASSES}}))
    backward = links[links["direction"] == 0]
    rows.append(pd.DataFrame({"road_link": backward["link_id"], "side": "ba", "a_node": backward["b_node"] + NODE_OFFSET,
                              "b_node": backward["a_node"] + NODE_OFFSET, "time": backward["free_flow_min"],
                              "distance": backward["length_m"] / 1000, "capacity": backward["capacity_ba_veh_hr"],
                              "road_class": backward["road_class"],
                              **{f"toll_{c}": backward[f"toll_{c}_hkd"] * CLASS_TOLL_WEIGHT.get(c, TOLL_WEIGHT) for c in CLASSES}}))

    centroid = {zone: k + 1 for k, zone in enumerate(ids)}
    connectors = pd.read_parquet(MODEL / "road-connectors.parquet")
    connectors = connectors[connectors["zone"].isin(centroid)]
    joins = [(centroid[z], int(n) + NODE_OFFSET, m) for z, n, m in connectors[["zone", "node_id", "metres"]].itertuples(index=False)]
    # Control points: a road crossing joins the network where the road meets the boundary; the others
    # (rail, air, sea) at the zone they hang off.
    points = {f"X:{p['point']}": p for p in json.loads(CROSS_BOUNDARY.read_text(encoding="utf-8"))["control_points"]}
    nodes = pd.read_parquet(MODEL / "road-nodes.parquet").set_index("node_id")
    used = np.unique(np.concatenate([links["a_node"], links["b_node"]]))
    tree = cKDTree(nodes.loc[used, ["x", "y"]].to_numpy())
    to_grid = Transformer.from_crs("EPSG:4326", "EPSG:2326", always_xy=True)
    host_joins = connectors.groupby("zone")
    for zone in ids:
        if not zone.startswith("X:"):
            continue
        point = points[zone]
        if point["mode"] == "road":
            x, y = to_grid.transform(point["lon"], point["lat"])
            distance, k = tree.query([x, y], k=1)
            if distance <= CROSSING_SNAP_M:
                joins.append((centroid[zone], int(used[k]) + NODE_OFFSET, float(distance)))
                continue
        for n, m in host_joins.get_group(point["zone"])[["node_id", "metres"]].itertuples(index=False):
            joins.append((centroid[zone], int(n) + NODE_OFFSET, m + point["zone_distance_m"]))
    join = pd.DataFrame(joins, columns=["zone", "node", "metres"])
    for a, b, side in (("zone", "node", "out"), ("node", "zone", "in")):
        rows.append(pd.DataFrame({"road_link": -1, "side": side, "a_node": join[a], "b_node": join[b],
                                  "time": join["metres"] / 1000 / CONNECTOR_KPH * 60, "distance": join["metres"] / 1000,
                                  "capacity": CONNECTOR_CAPACITY, "road_class": "connector",
                                  **{f"toll_{c}": 0.0 for c in CLASSES}}))
    network = pd.concat(rows, ignore_index=True)
    network["time"] = network["time"].clip(lower=1e-3)
    network.insert(0, "link_id", np.arange(1, len(network) + 1))
    network["direction"] = 1
    tunnel_queue(network, links, report)
    graph = Graph()
    graph.network = network
    present = sorted(set(network["a_node"]) & set(centroid.values()))
    graph.prepare_graph(np.array(present))
    graph.set_graph("time")
    graph.set_skimming(["time", "distance"])
    graph.set_blocked_centroid_flows(True)
    report.append(f"路网：{int((network['road_link'] > 0).sum()):,} 个行车方向、{len(join):,} 条分区接驳；"
                  f"{len(present)}/{len(ids)} 个分区接入路网")
    return graph, network


def demand(ids: list[str]) -> dict[str, np.ndarray]:
    am, goods = np.load(AM_PEAK), np.load(GOODS)
    if [str(z) for z in am["zones"]] != ids or [str(z) for z in goods["zones"]] != ids:
        raise RuntimeError("zone orders differ between the peak-hour and goods matrices")
    return {"car": am["V_PV"] + goods["V_BOUNDARY_CAR"], "taxi": am["V_TAXI"],
            "goods_light": goods["V_GOODS_LIGHT"], "goods_heavy": goods["V_GOODS_HEAVY"],
            "coach": am["V_SPB"] + goods["V_BOUNDARY_COACH"]}


def matrix(name: str, values: np.ndarray, centroids: np.ndarray) -> AequilibraeMatrix:
    """A class's trips between the zones the graph has (centroid k is zone k - 1)."""
    keep = centroids - 1
    m = AequilibraeMatrix()
    m.create_empty(memory_only=True, zones=len(centroids), matrix_names=[name])
    m.index[:] = centroids
    m.matrix[name][:, :] = np.nan_to_num(values[np.ix_(keep, keep)].astype(float))
    m.computational_view([name])
    return m


def assign(graph: Graph, network: pd.DataFrame, trips: dict, vot: dict, preload: pd.DataFrame) -> pd.DataFrame:
    graph.network["capacity"] = network["capacity"].to_numpy()
    graph.network["alpha"] = network["alpha"].to_numpy()
    graph.network["beta"] = network["beta"].to_numpy()
    graph.prepare_graph(graph.centroids)
    graph.set_graph("time")
    graph.set_blocked_centroid_flows(True)
    classes = []
    for name, values in trips.items():
        tc = TrafficClass(name, graph, matrix(name, values, np.asarray(graph.centroids)))
        tc.set_vot(vot[name])
        tc.set_fixed_cost(f"toll_{name}")  # each class pays its own gazetted toll (pipeline/15)
        classes.append(tc)
    run = TrafficAssignment()
    run.set_classes(classes)
    run.set_vdf("BPR")
    run.set_vdf_parameters({"alpha": "alpha", "beta": "beta"})
    run.set_capacity_field("capacity")
    run.set_time_field("time")
    run.add_preload(preload, "buses")
    run.set_algorithm("bfw")
    run.max_iter = MAX_ITERATIONS
    run.rgap_target = RGAP
    run.execute()
    result = run.results()
    out = pd.DataFrame({"link_id": result.index})
    for name in trips:
        out[name] = result[f"{name}_ab"].to_numpy() if f"{name}_ab" in result else result[f"{name}_tot"].to_numpy()
    out["congested_time"] = result["Congested_Time_AB"].to_numpy() if "Congested_Time_AB" in result else np.nan
    info = run.report()
    return out.set_index("link_id"), info


def main() -> None:
    report, flags = [], []
    am = np.load(AM_PEAK)
    ids = [str(z) for z in am["zones"]]
    vot = values_of_time(report)
    graph, network = build_graph(ids, report)
    trips = demand(ids)
    keep = np.asarray(graph.centroids) - 1
    lost = sum(v.sum() - v[np.ix_(keep, keep)].sum() for v in trips.values())
    report.append("8-9 时车次：" + "、".join(f"{k} {v.sum():,.0f}" for k, v in trips.items())
                  + f"；起讫点不在路网上的 {lost:,.0f}（没有道路的离岛）" + ("" if lost < 100 else "  ← 需复核"))

    buses = pd.read_parquet(BUSES)
    side_of = network[network["road_link"] > 0].set_index(["road_link", "side"])["link_id"]
    preload_rows = []
    for side in ("ab", "ba"):
        count = buses["bus_" + side] + buses["minibus_" + side]
        keyed = pd.MultiIndex.from_arrays([buses["link_id"], [side] * len(buses)])
        ids_here = side_of.reindex(keyed).to_numpy()
        preload_rows.append(pd.DataFrame({"link_id": ids_here, "direction": 1, "preload": count.to_numpy(),
                                          "bus": buses["bus_" + side].to_numpy()}))
    preload = pd.concat(preload_rows).dropna(subset=["link_id"])
    preload["link_id"] = preload["link_id"].astype(int)
    preload = preload.groupby("link_id", as_index=False).agg(direction=("direction", "first"), preload=("preload", "sum"),
                                                              bus=("bus", "sum"))

    network = network.set_index("link_id", drop=False)
    network["design_flow"] = network["capacity"]
    for attempt in (1, 2):
        print(f"第 {attempt} 次分配…", flush=True)
        flows, info = assign(graph, network.reset_index(drop=True), trips, vot, preload[["link_id", "direction", "preload"]])
        flows = flows.join(preload.set_index("link_id")[["preload", "bus"]]).fillna({"preload": 0.0, "bus": 0.0})
        flows["total"] = flows[list(trips)].sum(axis=1) + flows["preload"]
        heavy = flows["goods_heavy"] + flows["coach"] + flows["bus"]
        share = np.divide(heavy, flows["total"], out=np.zeros(len(flows)), where=flows["total"] > 0)
        cut = np.zeros(len(flows))
        for above, reduction in HEAVY_REDUCTION:
            cut = np.where((share > above) & (cut == 0), reduction, cut)
        road = network.loc[flows.index, "road_link"].to_numpy() > 0
        busy = road & (flows["total"].to_numpy() > 100)  # a share on a handful of vehicles means nothing
        cut = np.where(busy, cut, 0.0)
        new_capacity = network.loc[flows.index, "design_flow"].to_numpy() * (1 - cut)
        changed = np.abs(new_capacity - network.loc[flows.index, "capacity"].to_numpy()).sum()
        converged = info["rgap"].iloc[-1] if "rgap" in info else float("nan")
        report.append(f"第 {attempt} 次分配：{len(info)} 次迭代，相对间隙 {converged:.1e}"
                      + ("" if converged <= RGAP * 1.5 else "  ← 未收敛") + "；"
                      f"重型车 >15% 的路段 {int(((share > 0.15) & busy).sum()):,} 个、>25% 的 {int(((share > 0.25) & busy).sum()):,} 个")
        if attempt == 1 and changed > 0:
            network.loc[flows.index, "capacity"] = new_capacity
            continue
        break

    # Link table in the network's own terms.
    rows = network.loc[flows.index]
    table = flows.assign(road_link=rows["road_link"].to_numpy(), side=rows["side"].to_numpy(),
                         capacity=rows["capacity"].to_numpy(), free_time=rows["time"].to_numpy(),
                         distance=rows["distance"].to_numpy(), heavy_share=share,
                         alpha=rows["alpha"].to_numpy(), beta=rows["beta"].to_numpy())   # BPR alpha per link (tunnel chains boosted, see tunnel_queue)
    table["vc"] = table["total"] / table["capacity"]
    table = table[table["road_link"] > 0]
    table.to_parquet(OUTPUT)
    vkm = (table["total"] * table["distance"]).sum()
    over = (table["vc"] > 1.0).mean()
    report.append(f"8-9 时车公里 {vkm / 1e6:.2f} 百万；超过设计流量的路段方向 {over:.1%}；"
                  f"v/c 最高：" + "；".join(f"{r.road_link}{r.side} {r.vc:.2f}" for r in table.nlargest(5, "vc").itertuples()))

    # Census comparison: counted directions whose AM peak hour is 08:00-09:00.
    census = json.loads(STATIONS.read_text(encoding="utf-8"))
    records = pd.DataFrame(census["records"])
    records = records[records["year"] == CENSUS_YEAR]
    matched = pd.read_parquet(CENSUS_LINKS)
    by_side = table.reset_index().set_index(["road_link", "side"])
    modelled = matched.assign(flow=[by_side["total"].get((r.link_id, r.side), 0.0) for r in matched.itertuples()])
    modelled = modelled.groupby(["station", "direction"], as_index=False)["flow"].sum()
    exact = records[records["am_peak_hour"] == PEAK_BAND][["station", "direction", "link", "road_type", "am_peak_flow"]]
    compare = exact.merge(modelled, on=["station", "direction"])
    compare["geh"] = np.sqrt(2 * (compare["flow"] - compare["am_peak_flow"]) ** 2 / (compare["flow"] + compare["am_peak_flow"]))
    good = float((compare["geh"] < 5).mean())
    ratio = compare["flow"].sum() / compare["am_peak_flow"].sum()
    report.append(f"GEH（{len(compare)} 个 8-9 时为高峰的计数方向）：GEH<5 的 {good:.0%}（目标 {GEH_TARGET:.0%}）；"
                  f"模型/普查 合计 {ratio:.2f}" + ("" if good >= GEH_TARGET else "  ← 需复核"))
    if good < GEH_TARGET:
        flags.append("GEH")
    for kind, group in compare.groupby("road_type"):
        report.append(f"  {kind}：{len(group)} 个方向，模型/普查 {group['flow'].sum() / group['am_peak_flow'].sum():.2f}，"
                      f"GEH<5 {np.mean(group['geh'] < 5):.0%}")

    # Corridors. Where parallel crossings compete, what matters for route choice - and for any travel
    # time the dispatch model reads off - is how the corridor's traffic splits between them. The count
    # here is every station's two-way 08:00-09:00 flow (AADT x the hour's share of the day), so a
    # station whose own peak hour is not 08:00-09:00 still counts.
    profile_all = {h["station"]: h["weekday_pct"][8] for h in census["hourly"] if h["year"] == CENSUS_YEAR}
    crossings = []
    for station, group in records.groupby("station"):
        sides = matched[matched["station"] == station]
        if station not in profile_all or len(sides) == 0 or group["aadt"].isna().any():
            continue
        crossings.append({"station": station, "link": group["link"].iloc[0],
                          "observed": group["aadt"].sum() * profile_all[station] / 100,
                          "modelled": sum(by_side["total"].get((r.link_id, r.side), 0.0) for r in sides.itertuples())})
    crossings = pd.DataFrame(crossings)
    corridor_rows, corridor_geh = [], []
    for name, pattern in CORRIDORS.items():
        part = crossings[crossings["link"].str.contains(pattern, regex=True, na=False)]
        if part.empty:
            continue
        geh = np.sqrt(2 * (part["modelled"] - part["observed"]) ** 2 / (part["modelled"] + part["observed"]))
        corridor_geh.extend(geh.tolist())
        worst = part.assign(geh=geh).nlargest(1, "geh").iloc[0]
        corridor_rows.append({"corridor": name, "stations": len(part), "observed": part["observed"].sum(),
                              "modelled": part["modelled"].sum(), "geh_under_5": float((geh < 5).mean())})
        report.append(f"  走廊 {name}：{len(part)} 站，模型/普查 {part['modelled'].sum() / part['observed'].sum():.2f}，"
                      f"GEH<5 {np.mean(geh < 5):.0%}；最偏的一站 {worst['link'][:40]} "
                      f"普查 {worst['observed']:,.0f} 模型 {worst['modelled']:,.0f}")
    corridor_good = float(np.mean(np.array(corridor_geh) < 5)) if corridor_geh else float("nan")
    report.append(f"走廊合计（收费权重 {TOLL_WEIGHT:.2f}" + "".join(f"，{k} {v:.2f}" for k, v in CLASS_TOLL_WEIGHT.items()) + f"）：{len(corridor_geh)} 站，GEH<5 {corridor_good:.0%}（目标 60%）"
                  + ("" if corridor_good >= 0.60 else "  ← 需复核"))
    if corridor_good < 0.60:
        flags.append("走廊分流")

    # By class at the core stations: two-way 08:00-09:00 flow x the OCC mix.
    profile = {h["station"]: h["weekday_pct"][8] for h in census["hourly"] if h["year"] == CENSUS_YEAR}
    mix = {o["station"]: o["hours"][PEAK_BAND] for o in json.loads(OCCUPANCY.read_text(encoding="utf-8"))["stations"]
           if o["year"] == CENSUS_YEAR and PEAK_BAND in o["hours"]}
    classes = {"car": ["private_car", "motorcycle"], "taxi": ["taxi"], "goods_light": ["goods_light"],
               "goods_heavy": ["goods_medium_heavy"], "coach": ["non_franchised_bus", "private_light_bus"],
               "bus": ["franchised_bus_single", "franchised_bus_double", "public_light_bus"]}
    per_class = {k: [0.0, 0.0] for k in classes}
    for station, group in records.groupby("station"):
        sides = matched[matched["station"] == station]
        if station not in mix or station not in profile or set(sides["direction"]) != set(group["direction"]) \
                or group["aadt"].isna().any():
            continue
        two_way = group["aadt"].sum() * profile[station] / 100
        for k, names in classes.items():
            column = "preload" if k == "bus" else k
            per_class[k][0] += sum(by_side[column].get((r.link_id, r.side), 0.0) for r in sides.itertuples())
            per_class[k][1] += two_way * sum(mix[station][n]["share_pct"] for n in names) / 100
    report.append("核心站按车种（模型/普查，8-9 时两方向）：" + "、".join(
        f"{k} {v[0] / v[1]:.2f}" for k, v in per_class.items() if v[1] > 0))

    # One class must not take over a road. Taxis are 28% of the peak hour's vehicles, so a carriageway
    # where they are more than half of the traffic is a sign that something in route choice has gone
    # one-sided - which is exactly how a taxi toll weight of 1.0 was caught, at 98% on Tai Po Road.
    busy = table[table["total"] > TAXI_SHARE_MIN_FLOW]
    share = busy["taxi"] / busy["total"]
    over = int((share > TAXI_SHARE_LIMIT).sum())
    report.append(f"单一车种占比：的士占比超过 {TAXI_SHARE_LIMIT:.0%} 的路段方向 {over} 个"
                  f"（流量 > {TAXI_SHARE_MIN_FLOW}），最高 {share.max():.0%}"
                  + ("" if over <= TAXI_SHARE_ALLOWED else f"  ← 需复核（容许 {TAXI_SHARE_ALLOWED}）"))
    if over > TAXI_SHARE_ALLOWED:
        flags.append("的士占比")

    AUDIT.write_text(json.dumps({
        "values_of_time": vot, "bpr": BPR, "tunnel_queue_min": TUNNEL_QUEUE_MIN, "toll_weight": TOLL_WEIGHT, "class_toll_weight": CLASS_TOLL_WEIGHT, "vehicle_km": vkm,
        "geh_under_5": good, "corridor_geh_under_5": corridor_good, "corridors": corridor_rows, "flow_ratio": ratio,
        "per_class_ratio": {k: v[0] / v[1] for k, v in per_class.items() if v[1] > 0},
        "compare": compare.round(1).to_dict(orient="records"), "flags": flags, "report": report,
    }, ensure_ascii=False, indent=1, default=float), encoding="utf-8")
    print(f"-> {OUTPUT.relative_to(ROOT)}")
    for line in report:
        print("   " + line)


if __name__ == "__main__":
    main()
