"""Build the routable road network the assignment step runs on.

Input : data/raw/road-network/RdNet_IRNP.gdb.zip  (Transport Department, Road Network 2nd Generation)
        data/web/zones.geojson                    455 model zones
        data/model/building-trip-ends.parquet     trip ends per building (pipeline/21 - run it first)
Output: data/model/road-links.parquet        one row per link, with speed, capacity, toll
        data/model/road-nodes.parquet        junctions
        data/model/road-turns.parquet        banned turns
        data/model/road-connectors.parquet   how each zone joins the network
        data/model/zone-centres.parquet      where each zone's trips start and end, for every mode
        data/web/road-network-audit.json

What the Transport Department's file already settles, and what it does not:

  topology   - settled. Every centreline ends at a junction: the 36,471 centrelines have 27,319
               distinct endpoints and the INTERSECTION layer has 27,320 junctions. Links are joined
               only where endpoints coincide, so a flyover crossing over a road is not joined to it.
  direction  - settled, but not the way it reads. TRAVEL_DIRECTION 1 is TWO-WAY and 3 is ONE-WAY
               along the way the line is drawn. Taking it the other way round leaves the network only
               58.9% strongly connected - half of Hong Kong unable to reach the other half - against
               97.7% this way. Three checks agree: Pedder Street, Wyndham Street and Tung Choi Street
               are all one-way on the ground and all coded 3, with not one segment coded 1; and of
               the traffic detectors that sit unambiguously on a single code-3 centreline, 90% travel
               the way the line is drawn and none travel against it. Getting this backwards produces
               a model that runs, reports no error, and is wrong everywhere.
  speed      - partly. The SPEED_LIMIT layer covers 9% of centrelines and contains 30, 70, 80, 100
               and 110 km/h but no 50 - because 50 is Hong Kong's general limit and only exceptions
               are posted. An unlisted road is therefore 50, not unknown.
  turns      - settled. 11,051 banned turns, keyed on the centreline's OBJECTID. Most are U-turns
               (both edges the same).
  tolls      - settled, and worth having: the three harbour crossings and Tai Lam run on time-varying
               tolls since 2023, from HK$20 off-peak rising in two-minute steps to the peak rate.
               Toll differences are the strongest price signal on Hong Kong's road network.
               Each tunnel is drawn as two one-way tubes running opposite ways, both with ELEVATION
               -1. The toll goes on the longest underground link in EACH direction, so a car pays
               once per passage whichever way it goes. (Putting it on the single longest link let
               half of all Kowloon-to-Island trips cross the harbour free - caught by the car skim's
               check that every such trip pays.)
  lanes      - NOT in the data (none of its 17 layers has a lane count; only bus-only lanes are
               drawn). OpenStreetMap carries them for 97% of Hong Kong's main roads by length, so each
               centreline takes the lanes and the road class of the OpenStreetMap way running along
               it (see add_lanes). Where OpenStreetMap has the road but no lane count, a default for
               its class is used; where it has no matching road at all, the class comes from the speed
               limit. Every link records which of these it got. The traffic detectors, which report
               lane by lane, are the independent check (pipeline/15b).
  capacity   - NOT in the data either. TPDM Volume 2 Table 2.4.1.1 gives design flows by road type
               and carriageway (veh/hour; allowing for 15% heavy vehicles): an expressway carries
               3,000 / 4,700 / 6,300 an hour on 2 / 3 / 4 lanes a direction, a primary distributor
               1,400 a lane on a dual carriageway, a district distributor 1,400-2,200 on a whole
               two-lane road, a local road 800 two-way. Capacity per direction is that table applied
               to each link's class and lanes. It is still the model's main supply-side assumption,
               and what calibration against the 193 traffic census stations will adjust.

Run from the project root (about 3 minutes):
    uv run python pipeline/15_road_network.py
"""

import json
import os
import re
import warnings
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parents[1]
GDB = "/vsizip/" + os.path.abspath(ROOT / "data" / "raw" / "road-network" / "RdNet_IRNP.gdb.zip").replace("\\", "/") + "/RdNet_IRNP.gdb"
ZONES = ROOT / "data" / "web" / "zones.geojson"
OUT = ROOT / "data" / "model"
AUDIT = ROOT / "data" / "web" / "road-network-audit.json"
TRIP_ENDS = OUT / "building-trip-ends.parquet"  # pipeline/21
CENTRES = OUT / "zone-centres.parquet"

HK80, WGS84 = "EPSG:2326", "EPSG:4326"
SNAP_CM = 2  # endpoints are joined when they agree to this many decimals of a metre
MEDOID_CHUNK = 500  # buildings per block when measuring distances for a zone centre

DEFAULT_SPEED_KPH = 50  # Hong Kong's general speed limit, which the file does not record

OSM = ROOT / "data" / "raw" / "osm" / "hong-kong-latest.osm.pbf"
GDAL_TMP = ROOT / "data" / "cache" / "gdal-tmp"  # GDAL's OSM reader fails under a non-ASCII temp path
LANE_MATCH_M = 12  # an OpenStreetMap way further than this from a centreline's middle is not the same road
LANE_ANGLE = 30  # degrees: parallel (or anti-parallel) within this counts as running along it
# OpenStreetMap road types -> the road types of TPDM Volume 2 Table 2.4.1.1.
ROAD_CLASS = {
    "motorway": "expressway", "motorway_link": "expressway", "trunk": "expressway", "trunk_link": "expressway",
    "primary": "primary", "primary_link": "primary",
    "secondary": "district", "secondary_link": "district", "tertiary": "district", "tertiary_link": "district",
    "unclassified": "local", "residential": "local", "service": "local", "living_street": "local", "road": "local",
}
# Lanes a direction when OpenStreetMap knows the road but not its lanes (the commonest case per class).
DEFAULT_LANES = {"expressway": 2, "primary": 2, "district": 1, "local": 1}
# TPDM Volume 2 Table 2.4.1.1, veh/hour in one direction, by class and lanes in that direction.
#   expressway/trunk: dual 2 / 3 / 4 lanes = 3000 / 4700 / 6300 (1575 for each lane beyond);
#     a single-lane slip road is taken at the dual 2-lane rate per lane
#   primary distributor: dual carriageway 1400 a lane (2800 on 2, 4200 on 3); undivided, 2000 two-way
#     on a 7.3 m two-lane road (1000 a direction) and 2400-2600 a direction on four lanes (1250 a lane)
#   district distributor: 1700 two-way on a 7.3 m two-lane road (850 a lane), 1900-2000 a direction
#     on four lanes (975 a lane)
#   local road: 800 two-way on two lanes (400 a lane) - the table's note on loading and standing vehicles
EXPRESSWAY_CAPACITY = {1: 1500, 2: 3000, 3: 4700, 4: 6300}
EXPRESSWAY_NAMES = r"\b(?:HIGHWAY|TUNNEL|CORRIDOR|BYPASS|LINK|CROSSING|BRIDGE)$"  # see reconcile_class

# Toll facilities, matched to the street names the centrelines carry.
TOLL_ROADS = {
    "CROSS HARBOUR TUNNEL": "Cross Harbour Tunnel",
    "EASTERN HARBOUR CROSSING": "Eastern Harbour Crossing",
    "WESTERN HARBOUR CROSSING": "Western Harbour Crossing",
    "ABERDEEN TUNNEL": "Aberdeen Tunnel",
    "LION ROCK TUNNEL ROAD": "Lion Rock Tunnel",
    "SHING MUN TUNNEL": "Shing Mun Tunnels",
    "SHING MUN TUNNEL ROAD": "Shing Mun Tunnels",
    "TATE'S CAIRN TUNNEL": "Tate's Cairn Tunnel",
    "TSING SHA HIGHWAY": "Tsing Sha Control Area (Eagle's Nest Tunnel and Sha Tin Heights Tunnel)",
    "TSING LONG HIGHWAY": "Tai Lam Tunnel",  # Route 3 Country Park Section, where the tunnel runs
}
# The same tunnel appears twice in the toll table, once for its back-up toll point.
TOLL_ALIASES = {"Western Harbour Crossing (Backup Toll Point)": "Western Harbour Crossing"}
PEAK_TIME = "08:30:00"  # the AM peak hour the model is built for
PRIVATE_CAR = "PC"
# What each class the assignment carries pays. The toll tables code vehicles as PC private car,
# TA taxi, MC motorcycle, LGV/MGV/HGV light/medium/heavy goods, LB light bus, SD/DD single/double
# deck bus; the time-varying table (the harbour crossings and Tai Lam) has only MC, PC, TA and OTH,
# so everything else falls back to OTH. Coaches are the census's non-franchised buses and private
# light buses, 72% to 28% of the two in the 08:00-09:00 mix, so their toll is that blend.
TOLL_CLASSES = {"car": [("PC", 1.0)], "taxi": [("TA", 1.0)], "goods_light": [("LGV", 1.0)],
                "goods_heavy": [("MGV", 1.0)], "coach": [("SD", 0.72), ("LB", 0.28)]}
VARYING_FALLBACK = "OTH"  # the class the time-varying table uses for everything but MC, PC and TA
# A taxi passenger pays the toll, and at the three harbour crossings a second time for the return
# journey - unless the taxi was hired at a cross-harbour stand or is not crossing back (Transport
# Department, Taxi Fare of Hong Kong: "$25 (amount of toll) + $25 (return toll)").
RETURN_TOLL = {"Cross Harbour Tunnel", "Eastern Harbour Crossing", "Western Harbour Crossing"}
CONNECTORS_PER_ZONE = 3
# A zone with no junction inside it or within this distance of its edge has no road access. Cheung
# Chau, Peng Chau and Lamma are like this: hanging them off the nearest junction anyway built a 6 km
# road across the sea, and the car skim then happily drove from Cheung Chau to Central.
ISOLATION_M = 300
# A connector is a straight walk/drive from the zone centre to a junction. It must not cross the sea or a
# reservoir: zones that wrap round a bay (Penny's Bay, Tolo Harbour coves, Clear Water Bay) had picked
# junctions on the far shore (9/25 check: 11 of 1,267 connectors crossed 30-534 m of water). Water comes
# from the Planning Department's 10 m land-use grid (pipeline/36; code 0 = sea, 91 = reservoir).
LAND_GRID = ROOT / "data" / "raw" / "landuse" / "luhk2024_codes.tif"
WET_LIMIT_M = 30
_LAND: dict = {}


def node_key(x: float, y: float) -> tuple:
    return (round(x, SNAP_CM), round(y, SNAP_CM))


def build_links() -> tuple[pd.DataFrame, pd.DataFrame]:
    lines = gpd.read_file(GDB, layer="CENTERLINE", engine="pyogrio", fid_as_index=True)
    lines["objectid"] = lines.index  # the OBJECTID the TURN layer refers to
    lines = lines.explode(index_parts=False)
    print(f"{len(lines):,} 条中心线")

    ends = [(list(g.coords)[0], list(g.coords)[-1]) for g in lines.geometry]
    keys: dict[tuple, int] = {}
    a_nodes, b_nodes = [], []
    for start, finish in ends:
        for point, bucket in ((start, a_nodes), (finish, b_nodes)):
            key = node_key(point[0], point[1])
            bucket.append(keys.setdefault(key, len(keys)))

    links = pd.DataFrame({
        "link_id": np.arange(1, len(lines) + 1),
        "objectid": lines["objectid"].to_numpy(),
        "a_node": a_nodes,
        "b_node": b_nodes,
        "length_m": lines.geometry.length.to_numpy().round(2),
        "street": lines["STREET_ENAME"].to_numpy(),
        "route_num": lines["ROUTE_NUM"].to_numpy(),
        "elevation": lines["ELEVATION"].to_numpy(),
        "route_id": lines["ROUTE_ID"].to_numpy(),
        "bearing": [
            float(np.degrees(np.arctan2(g.coords[-1][0] - g.coords[0][0], g.coords[-1][1] - g.coords[0][1])) % 360)
            for g in lines.geometry
        ],
        # AequilibraE: 0 both ways, 1 a->b only. TRAVEL_DIRECTION 1 is the two-way code (see above).
        "direction": np.where(lines["TRAVEL_DIRECTION"].to_numpy() == 1, 0, 1),
    })
    # 331 estate loops and roundabouts are drawn as one closed line that returns to the junction it
    # left. A shortest path can never use such a link - it would pay the cost and arrive where it
    # started - so they are kept in the table for traceability but left out of the routing graph.
    # They are local access roads inside zones, which a zone-based model does not route on anyway.
    links["routable"] = links["a_node"].ne(links["b_node"])

    nodes = pd.DataFrame(
        [{"node_id": index, "x": key[0], "y": key[1]} for key, index in keys.items()]
    )
    return links, nodes, list(lines.geometry)


def osm_roads() -> gpd.GeoDataFrame:
    """OpenStreetMap roads a car can use, with their lane counts and which way they run."""
    GDAL_TMP.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("CPL_TMPDIR", str(GDAL_TMP))
    frame = gpd.read_file(OSM, layer="lines", engine="pyogrio", columns=["highway", "other_tags"],
                          where="highway IS NOT NULL")
    frame = frame[frame["highway"].isin(ROAD_CLASS)].to_crs(HK80).reset_index(drop=True)
    tags = frame["other_tags"].fillna("")
    tag = lambda key: tags.str.extract(rf'"{re.escape(key)}"=>"([^"]*)"')[0]
    for key, column in (("lanes", "lanes"), ("lanes:forward", "forward"), ("lanes:backward", "backward")):
        frame[column] = pd.to_numeric(tag(key).str.extract(r"(\d+)")[0], errors="coerce")
    oneway = tag("oneway").fillna("")
    implied = frame["highway"].isin(["motorway", "motorway_link"]) | tag("junction").eq("roundabout")
    frame["reverse"] = oneway.eq("-1")
    frame["oneway"] = oneway.isin(["yes", "true", "1", "-1"]) | (implied & ~oneway.isin(["no", "false", "0"]))
    frame["road_class"] = frame["highway"].map(ROAD_CLASS)
    return frame


def local_heading(line, along: float) -> float:
    a, b = line.interpolate(max(0.0, along - 5)), line.interpolate(min(line.length, along + 5))
    return float(np.degrees(np.arctan2(b.x - a.x, b.y - a.y)) % 360)


def capacity(road_class: str, lanes: float, divided: bool) -> float:
    """Design flow in one direction, veh/hour (TPDM Volume 2 Table 2.4.1.1)."""
    n = max(1, int(round(lanes)))
    if road_class == "expressway":
        return EXPRESSWAY_CAPACITY.get(n, 6300 + 1575 * (n - 4))
    if road_class == "primary":
        return 1400 * n if divided else (1000 if n == 1 else 1250 * n)
    if road_class == "district":
        return 850 if n == 1 else 975 * n
    return 400 * n


def add_lanes(links: pd.DataFrame, shapes: list) -> dict:
    """Lanes in each direction, and the road class, from the OpenStreetMap way along each centreline."""
    osm = osm_roads()
    tree = shapely.STRtree(osm.geometry.values)
    middles = [s.interpolate(0.5, normalized=True) for s in shapes]
    pairs = tree.query(middles, predicate="dwithin", distance=LANE_MATCH_M)
    best: dict[int, tuple] = {}
    for link, way in zip(*pairs):
        shape, road = shapes[link], osm.geometry.iloc[way]
        distance = road.distance(middles[link])
        own = local_heading(shape, shape.length / 2)
        theirs = local_heading(road, road.project(middles[link]))
        angle = abs((own - theirs + 180) % 360 - 180)
        if LANE_ANGLE < angle < 180 - LANE_ANGLE:
            continue  # crossing it, not running along it
        if link not in best or distance < best[link][1]:
            best[link] = (way, distance, angle <= LANE_ANGLE)

    ab, ba, road_class, source, conflicts = [], [], [], [], 0
    for i, link in enumerate(links.itertuples()):
        match = best.get(i)
        if match is None:
            # No OpenStreetMap road here: the class from the speed limit, the lanes from the class.
            cls = "expressway" if link.speed_kph >= 70 else "district"
            lanes_ab = lanes_ba = DEFAULT_LANES[cls]
            origin = "speed limit"
        else:
            way, _, same = match
            road = osm.iloc[way]
            cls = road["road_class"]
            along_way = same != bool(road["reverse"])  # does the way's traffic run a->b?
            if road["oneway"]:
                lanes = road["lanes"] if pd.notna(road["lanes"]) else DEFAULT_LANES[cls]
                lanes_ab = lanes_ba = lanes
                if link.direction == 1 and not along_way:
                    conflicts += 1  # the two maps disagree on which way the road runs
                origin = "osm lanes" if pd.notna(road["lanes"]) else "osm class"
            elif pd.notna(road["forward"]) or pd.notna(road["backward"]):
                forward = road["forward"] if pd.notna(road["forward"]) else road["backward"]
                backward = road["backward"] if pd.notna(road["backward"]) else road["forward"]
                lanes_ab, lanes_ba = (forward, backward) if same else (backward, forward)
                origin = "osm lanes"
            elif pd.notna(road["lanes"]):
                total = int(road["lanes"])
                lanes_ab, lanes_ba = max(1, (total + 1) // 2), max(1, total // 2)
                if not same:
                    lanes_ab, lanes_ba = lanes_ba, lanes_ab
                origin = "osm lanes split"
            else:
                lanes_ab = lanes_ba = DEFAULT_LANES[cls]
                origin = "osm class"
        ab.append(lanes_ab)
        ba.append(lanes_ba)
        road_class.append(cls)
        source.append(origin)

    links["road_class"] = road_class
    links["lanes_ab"] = np.array(ab, dtype=float).clip(1, 8).astype(int)
    links["lanes_ba"] = np.where(links["direction"].eq(0), np.array(ba, dtype=float).clip(1, 8), 0).astype(int)
    links["lanes_source"] = source
    corrected = reconcile_class(links)
    divided = links["direction"].eq(1)
    links["capacity_ab_veh_hr"] = [capacity(c, n, d) for c, n, d in zip(links["road_class"], links["lanes_ab"], divided)]
    links["capacity_ba_veh_hr"] = [capacity(c, n, False) if n else 0.0 for c, n in zip(links["road_class"], links["lanes_ba"])]
    length = links["length_m"]
    shares = (length.groupby(links["lanes_source"]).sum() / length.sum()).round(4).to_dict()
    return {"matched_share_by_length": round(float(length[[i in best for i in range(len(links))]].sum() / length.sum()), 4),
            "lanes_source_share_by_length": shares, "direction_conflicts": conflicts,
            "osm_ways": len(osm), "class_corrected": corrected}


def reconcile_class(links: pd.DataFrame) -> dict:
    """Overrule an OpenStreetMap class that the Transport Department's own data contradicts.

    Twelve metres catches the wrong way now and then - a toll plaza lane or a service road beside
    the main line - and a "local" road gets 400 veh/h a lane: the first assignment put 2,565
    vehicles an hour through one Cross Harbour Tunnel link that way, and loaded Tsing Sha Highway,
    Cheung Tsing Highway and Lantau Link at 3-4 times capacity. The network knows better, and is
    used only as far as it knows:
      - a posted limit of 70 km/h or more is an expressway (or its ramp), whatever OSM says;
      - a "local" link on a strategic route (ROUTE_NUM) or named ...HIGHWAY, TUNNEL, CORRIDOR,
        BYPASS, LINK, CROSSING or BRIDGE is at least a primary road - not an expressway: strategic
        routes run through 50 km/h streets (Kwun Tong Road) and Hiram's Highway is a country road;
      - any other "local" link on a named street whose length is mostly a higher class takes the
        street's class (Prince Edward Road West).
    Lanes that came from the class default are reset to the new class's default; lanes OSM tags are kept.
    """
    rank = {"local": 0, "district": 1, "primary": 2, "expressway": 3}
    defaulted = links["lanes_source"].isin(["osm class", "speed limit"])
    before = links["road_class"].copy()
    street = links["street"].astype(str).str.strip()
    named = ~street.isin(["-99", "nan", "None", ""])
    fast = links["speed_posted"] & (links["speed_kph"] >= 70)
    links.loc[fast, "road_class"] = "expressway"
    local = links["road_class"].eq("local")
    strategic = local & (links["route_num"].notna() | (named & street.str.contains(EXPRESSWAY_NAMES, regex=True)))
    links.loc[strategic, "road_class"] = "primary"

    by_length = links[named].groupby([street[named], links.loc[named, "road_class"]])["length_m"].sum()
    majority = by_length.groupby(level=0).idxmax().map(lambda key: key[1])
    street_class = street.map(majority)
    promote = named & links["road_class"].eq("local") & street_class.notna() & \
        (street_class.map(rank).fillna(0) > rank["local"])
    links.loc[promote, "road_class"] = street_class[promote]
    strategic = fast | strategic

    changed = links["road_class"] != before
    reset = changed & defaulted
    for side in ("lanes_ab", "lanes_ba"):
        new = links.loc[reset, "road_class"].map(DEFAULT_LANES)
        links.loc[reset, side] = np.where(links.loc[reset, side] > 0, new, 0)
    return {"by_network": int((changed & strategic).sum()), "by_street": int((changed & promote & ~strategic).sum()),
            "length_km": round(float(links.loc[changed, "length_m"].sum() / 1000), 1),
            "lanes_reset": int(reset.sum())}


def add_speed_and_capacity(links: pd.DataFrame) -> None:
    posted = gpd.read_file(GDB, layer="SPEED_LIMIT", engine="pyogrio",
                           columns=["ROAD_ROUTE_ID", "SPEED_LIMIT"])
    speed = (
        posted.assign(kph=posted["SPEED_LIMIT"].str.extract(r"(\d+)").astype(float))
        .groupby("ROAD_ROUTE_ID")["kph"].max()
    )
    links["speed_kph"] = links["route_id"].map(speed)
    links["speed_posted"] = links["speed_kph"].notna()
    links["speed_kph"] = links["speed_kph"].fillna(DEFAULT_SPEED_KPH)
    links["free_flow_min"] = (links["length_m"] / 1000 / links["speed_kph"] * 60).round(4)


def add_tolls(links: pd.DataFrame) -> dict:
    fixed = gpd.read_file(GDB, layer="TUN_BRIDGE_TOLL", engine="pyogrio")
    varying = gpd.read_file(GDB, layer="TUN_BRIDGE_TV_TOLL", engine="pyogrio")

    in_force = (varying["DAY_OF_WEEK"].eq("A")  # A is the weekday schedule
                & (varying["START_TIME"].astype(str) <= PEAK_TIME)
                & (varying["END_TIME"].astype(str) >= PEAK_TIME))

    def rates(code: str) -> dict[str, float]:
        """What one vehicle class pays at each facility at the modelled peak."""
        out = fixed[fixed["VEHICLE_CLASS_DESCRIPTION"].eq(code)].groupby("TUNNEL_BRIDGE_NAME")["GAZETTED_TOLL"].max().to_dict()
        varies = varying["VEHICLE_CLASS_DESCRIPTION"].eq(code if code in ("MC", "PC", "TA") else VARYING_FALLBACK)
        # A time-varying toll replaces the fixed one; take the rate in force at the modelled peak.
        for name, rate in varying[in_force & varies].groupby("TUNNEL_BRIDGE_NAME")["GAZETTED_TOLL"].max().items():
            out[name] = float(rate)
        return {k: float(v) for k, v in out.items()}

    by_class = {}
    for name, parts in TOLL_CLASSES.items():
        blend: dict[str, float] = {}
        for code, share in parts:
            for facility, rate in rates(code).items():
                blend[facility] = blend.get(facility, 0.0) + share * rate
        if name == "taxi":
            blend = {f: r * 2 if f in RETURN_TOLL or TOLL_ALIASES.get(f) in RETURN_TOLL else r
                     for f, r in blend.items()}
        by_class[name] = blend
    tolls = by_class["car"]

    street = links["street"].fillna("").str.upper()
    links["toll_hkd"] = 0.0
    for name in TOLL_CLASSES:
        links[f"toll_{name}_hkd"] = 0.0
    links["toll_facility"] = None
    by_facility: dict[str, list[str]] = {}
    for road, facility in TOLL_ROADS.items():
        by_facility.setdefault(facility, []).append(road)

    bores_found = {}
    for facility, roads in by_facility.items():
        rate = tolls.get(facility)
        here = street.isin(roads)
        if rate is None or not here.any():
            continue
        links.loc[here, "toll_facility"] = facility
        underground = here & links["elevation"].lt(0)
        pool = links[underground] if underground.any() else links[here]

        one_way = pool[pool["direction"] == 1]
        charged = []
        if len(one_way):
            # Split the tubes by heading: within 90 degrees of the longest tube is one direction.
            longest = one_way.loc[one_way["length_m"].idxmax()]
            turn = (one_way["bearing"] - longest["bearing"] + 180) % 360 - 180
            for group in (one_way[turn.abs() <= 90], one_way[turn.abs() > 90]):
                if len(group):
                    charged.append(group["length_m"].idxmax())
        two_way = pool[pool["direction"] == 0]
        if len(two_way):
            charged.append(two_way["length_m"].idxmax())  # AequilibraE charges both directions
        links.loc[charged, "toll_hkd"] = float(rate)
        for name in TOLL_CLASSES:
            links.loc[charged, f"toll_{name}_hkd"] = float(by_class[name].get(facility, rate))
        bores_found[facility] = len(charged)

    matched = set(links["toll_facility"].dropna())
    unmatched = sorted(name for name in tolls
                       if name not in matched and TOLL_ALIASES.get(name, name) not in matched)
    return {"tolls_applied": tolls, "by_class": by_class, "unmatched_facilities": unmatched,
            "charged_links": bores_found}


def build_turns(links: pd.DataFrame) -> pd.DataFrame:
    turns = gpd.read_file(GDB, layer="TURN", engine="pyogrio",
                          columns=["EDGE1FID", "EDGE2FID", "EDGE3FID", "NO_TURN", "TURN_ID"])
    by_objectid = links.set_index("objectid")["link_id"]
    frame = pd.DataFrame({
        "from_link": turns["EDGE1FID"].map(by_objectid),
        "to_link": turns["EDGE2FID"].map(by_objectid),
        "via_link": turns["EDGE3FID"].map(by_objectid),
        "banned": turns["NO_TURN"].eq(-1),
    }).dropna(subset=["from_link", "to_link"])
    frame["u_turn"] = frame["from_link"].eq(frame["to_link"])
    return frame.astype({"from_link": int, "to_link": int})


def activity_centres(zones: gpd.GeoDataFrame) -> gpd.GeoSeries:
    """Where each zone's trips start and end: the building closest, on average, to all of them.

    Every building carries the trips pipeline/21 expects there - homes their residents' trips,
    offices, shops and factories theirs - and the centre is the building with the least
    trip-weighted distance to all the others (a weighted medoid).

    The geometric centre of a large zone can sit on a hillside (Sha Tin's 756S.4, 33,000 people, was
    anchored 3 km from the nearest junction). The next rule - floor area, averaged, snapped to the
    nearest building - weighed a warehouse like a tower block of flats: Tsang Tsui's centre landed
    among the ash lagoons 2.4 km from the village where its 2,300 people live, and the only bus
    there runs hourly from 9 a.m. An average of two clusters can also fall on the empty ground
    between them; a medoid always sits in the heavier one.
    """
    if not TRIP_ENDS.exists():
        raise SystemExit("run pipeline/21_trip_generation.py first: zone centres are placed by its trip ends")
    frame = pd.read_parquet(TRIP_ENDS)
    frame = frame[frame["zone"].isin(zones["zone"]) & frame["trip_ends"].gt(0)]
    points = gpd.GeoSeries(gpd.points_from_xy(frame["lon"], frame["lat"]), crs=WGS84).to_crs(HK80)
    frame = frame.assign(x=points.x.to_numpy(), y=points.y.to_numpy())

    centres = {}
    for zone, group in frame.groupby("zone"):
        xy = group[["x", "y"]].to_numpy()
        weight = group["trip_ends"].to_numpy()
        cost = np.concatenate([
            (np.hypot(xy[i:i + MEDOID_CHUNK, None, 0] - xy[None, :, 0],
                      xy[i:i + MEDOID_CHUNK, None, 1] - xy[None, :, 1]) * weight).sum(axis=1)
            for i in range(0, len(xy), MEDOID_CHUNK)
        ])
        centres[zone] = tuple(xy[int(np.argmin(cost))])

    fallback = gpd.GeoSeries(
        gpd.points_from_xy(zones["centroid_lon"], zones["centroid_lat"]), crs=WGS84
    ).to_crs(HK80)
    fallback.index = zones["zone"].to_numpy()
    return gpd.GeoSeries(
        [shapely.Point(centres[z]) if z in centres else fallback[z] for z in zones["zone"]],
        index=zones["zone"].to_numpy(), crs=HK80,
    )


def water_metres(ax, ay, bx, by) -> np.ndarray:
    """Metres of sea or reservoir crossed by straight segments (HK1980 grid), sampled every 10 m."""
    import rasterio
    if "grid" not in _LAND:
        with rasterio.open(LAND_GRID) as src:
            _LAND["grid"] = (src.read(1), src.transform)
    codes, transform = _LAND["grid"]
    ax, ay, bx, by = map(np.asarray, (ax, ay, bx, by))
    length = np.hypot(bx - ax, by - ay)
    steps = np.maximum(2, np.ceil(length / 10).astype(int))
    wet = np.zeros(len(ax))
    for k in range(1, int(steps.max())):
        f = np.where(k < steps, k / steps, np.nan)
        on = ~np.isnan(f)
        x, y = ax + (bx - ax) * np.nan_to_num(f), ay + (by - ay) * np.nan_to_num(f)
        r, c = rasterio.transform.rowcol(transform, x, y)
        r = np.clip(np.asarray(r), 0, codes.shape[0] - 1)
        c = np.clip(np.asarray(c), 0, codes.shape[1] - 1)
        wet += on * np.isin(codes[r, c], (0, 91)) * (length / steps)
    return wet


def build_connectors(links: pd.DataFrame, nodes: pd.DataFrame) -> tuple[pd.DataFrame, list[str], pd.Series, dict]:
    """Join every zone to the network at a few well-separated junctions near where its activity is,
    never across the sea or a reservoir."""
    zones = gpd.read_file(ZONES).to_crs(HK80)
    points = gpd.GeoDataFrame(nodes, geometry=gpd.points_from_xy(nodes["x"], nodes["y"]), crs=HK80)

    # Junctions where two or more routable links meet; a dead end is a poor place to load a zone.
    routable = links[links["routable"]]
    degree = pd.concat([routable["a_node"], routable["b_node"]]).value_counts()
    points["degree"] = points["node_id"].map(degree).fillna(0)
    real = points[points["degree"] >= 2]
    centres = activity_centres(zones)
    outline = zones.set_index("zone").geometry

    # How far each centre moved since the last run - the car and transit matrices must be rebuilt
    # after any real move, because they start and end at these points.
    moved = pd.Series(0.0, index=centres.index)
    if CENTRES.exists():
        before = pd.read_parquet(CENTRES).set_index("zone").reindex(centres.index)
        moved = np.hypot(before["x"] - centres.x, before["y"] - centres.y).fillna(np.inf)

    # Every mode's matrix starts and ends at these points, so car and transit times compare fairly.
    lonlat = centres.to_crs(WGS84)
    pd.DataFrame({
        "zone": centres.index, "x": centres.x.round(2).to_numpy(), "y": centres.y.round(2).to_numpy(),
        "lon": lonlat.x.round(6).to_numpy(), "lat": lonlat.y.round(6).to_numpy(),
    }).to_parquet(CENTRES, index=False)

    inside = gpd.sjoin(real, zones[["zone", "geometry"]], how="inner", predicate="within")
    rows, isolated, wet_fallback, skipped = [], [], [], 0
    for zone in zones["zone"]:
        centre = centres[zone]
        group = inside[inside["zone"] == zone]
        if group.empty:
            near = real[real.geometry.distance(outline[zone]) <= ISOLATION_M]
            if near.empty:
                isolated.append(zone)
                continue
            group = near
        group = group.assign(metres=group.geometry.distance(centre)).sort_values("metres")
        if LAND_GRID.exists():
            wet = water_metres(np.full(len(group), centre.x), np.full(len(group), centre.y), group["x"], group["y"])
            dry = group[wet <= WET_LIMIT_M]
            skipped += int((wet > WET_LIMIT_M).sum())
            if dry.empty:
                # The zone's own junctions are all across water (a village on a bay): try the ones just outside it.
                near = real[real.geometry.distance(outline[zone]) <= ISOLATION_M]
                near = near.assign(metres=near.geometry.distance(centre)).sort_values("metres")
                wet = water_metres(np.full(len(near), centre.x), np.full(len(near), centre.y), near["x"], near["y"])
                dry = near[wet <= WET_LIMIT_M]
            if dry.empty:
                wet_fallback.append(zone)   # nothing reachable on dry land: keep the nearest, and say so
            else:
                group = dry
        chosen, taken = [], []
        for row in group.itertuples():
            # Spread the connectors out rather than stacking them on one junction.
            if any(np.hypot(row.x - x, row.y - y) < 250 for x, y in taken):
                continue
            chosen.append(row)
            taken.append((row.x, row.y))
            if len(chosen) == CONNECTORS_PER_ZONE:
                break
        for row in chosen:
            rows.append({"zone": zone, "node_id": int(row.node_id), "metres": round(float(row.metres), 1)})
    water = {"grid": LAND_GRID.exists(), "candidates_skipped": skipped, "zones_without_dry_connector": wet_fallback}
    return pd.DataFrame(rows), isolated, moved, water


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    links, nodes, shapes = build_links()
    add_speed_and_capacity(links)
    lane_report = add_lanes(links, shapes)
    toll_report = add_tolls(links)
    turns = build_turns(links)
    connectors, isolated, moved, water = build_connectors(links, nodes)

    links.to_parquet(OUT / "road-links.parquet", index=False)
    nodes.to_parquet(OUT / "road-nodes.parquet", index=False)
    turns.to_parquet(OUT / "road-turns.parquet", index=False)
    connectors.to_parquet(OUT / "road-connectors.parquet", index=False)

    # --- audit --------------------------------------------------------------------------------
    size = len(nodes)
    graph_links = links[links["routable"]]
    both = graph_links["direction"].eq(0)
    rows = np.concatenate([graph_links["a_node"], graph_links.loc[both, "b_node"]])
    cols = np.concatenate([graph_links["b_node"], graph_links.loc[both, "a_node"]])
    graph = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(size, size))
    count, labels = connected_components(graph, directed=True, connection="strong")
    biggest = np.bincount(labels).max()

    zones = gpd.read_file(ZONES)
    reachable = connectors["node_id"].map(pd.Series(labels)).eq(np.bincount(labels).argmax())
    zones_on_main = connectors.loc[reachable, "zone"].nunique()
    landuse_path = OUT / "landuse-2026.parquet"
    people = (pd.read_parquet(landuse_path).set_index("zone")["population"]
              if landuse_path.exists() else pd.Series(dtype=float))
    isolated_people = int(people.reindex(isolated).fillna(0).sum())

    check_failed = biggest / size < 0.90
    one_direction = [f for f, n in toll_report["charged_links"].items() if n < 2]
    report = [
        f"规模：{len(links):,} 条路段，{len(nodes):,} 个节点，{links['length_m'].sum() / 1000:,.0f} 公里；"
        f"单向路段 {int((links['direction'] == 1).sum()):,} 条；"
        f"闭环支路 {int((~links['routable']).sum())} 条（{links.loc[~links['routable'], 'length_m'].sum() / 1000:.0f} 公里）"
        f"不参与路由",
        f"连通性：强连通分量 {count:,} 个，最大的含 {biggest:,} 个节点（{biggest / size:.1%}）"
        + ("  ← 低于 90%，方向编码或拓扑有误，需复核" if check_failed else ""),
        f"接驳：{len(connectors):,} 个接驳点覆盖 {connectors['zone'].nunique()}/{len(zones)} 个小区，"
        f"其中 {zones_on_main} 个接到最大连通分量；接驳距离（从出行端点加权的小区中心起）中位 "
        f"{connectors['metres'].median():.0f} 米，90% 分位 {connectors['metres'].quantile(0.9):.0f} 米",
        f"小区中心（出行端点加权中位点）与上次相比：{int(moved.between(1, np.inf, inclusive='neither').sum())} 个移动，"
        f"超过 500 米的 {int(moved.between(500, np.inf, inclusive='neither').sum())} 个"
        + (f"（最远 {', '.join(f'{z} {m:.0f} 米' for z, m in far.head(6).items())}）"
           if not (far := moved[np.isfinite(moved) & (moved > 500)].sort_values(ascending=False)).empty else "")
        + (f"；新编号 {int(np.isinf(moved).sum())} 个" if np.isinf(moved).any() else "")
        + ("；公交与小汽车矩阵需重算（pipeline/17、18）" if (moved > 1).any() else ""),
        (f"接驳不跨水：跳过直线跨海或水塘超过 {WET_LIMIT_M} 米的候选路口 {water['candidates_skipped']} 个；"
         f"找不到陆路路口、只能保留跨水接驳的小区 {len(water['zones_without_dry_connector'])} 个"
         f"（{', '.join(water['zones_without_dry_connector']) or '无'}）"
         + ("" if not water["zones_without_dry_connector"] else "  ← 需复核")
         if water["grid"] else "接驳不跨水：缺土地用途格网（先跑 pipeline/36），未检查  ← 需复核"),
        f"无公路连接：{len(isolated)} 个小区（{', '.join(isolated) or '无'}），共 {isolated_people:,} 人，"
        f"小汽车不可达，靠渡轮进出（由公交矩阵处理）",
        f"限速：{int(links['speed_posted'].sum()):,} 条有公布限速（{links['speed_posted'].mean():.1%}），"
        f"其余按香港法定默认 {DEFAULT_SPEED_KPH} km/h（SPEED_LIMIT 图层不含 50，即只记录例外）",
        f"转向限制：{len(turns):,} 条可挂到路段（原始 11,051 条），其中禁止掉头 {int(turns['u_turn'].sum()):,} 条",
        f"收费：{len(toll_report['charged_links'])} 个收费设施、{int((links['toll_hkd'] > 0).sum())} 个收费路段"
        + (f"（只有一个方向收费：{one_direction}  ← 需复核）" if one_direction else "（每个设施两个方向都收费）")
        + "，"
        + "；".join(f"{k} {v:.0f} 元" for k, v in sorted(toll_report['tolls_applied'].items()))
        + (f"；未能匹配路段：{toll_report['unmatched_facilities']}" if toll_report["unmatched_facilities"] else ""),
        "分车种收费（8:30 时点，元）：" + "；".join(
            f"{facility}：" + "、".join(f"{name} {toll_report['by_class'][name].get(facility, 0):.0f}"
                                        for name in TOLL_CLASSES)
            for facility in sorted(toll_report["charged_links"]))
        + "。的士过海是「隧道费 + 回程费」（运输署的士车资表），货车与旅游巴在分时段收费的隧道按 OTH 计",
        f"车道：{lane_report['matched_share_by_length']:.1%} 的路网长度匹配到 OpenStreetMap 道路；车道数来源（按长度）"
        + "、".join(f"{k} {v:.1%}" for k, v in sorted(lane_report["lanes_source_share_by_length"].items(), key=lambda kv: -kv[1]))
        + f"；两图单行方向相反 {lane_report['direction_conflicts']} 段"
        + f"；按运输署资料纠正等级 {lane_report['class_corrected']['by_network']} 段（限速 ≥70 为快速公路，策略性干道/路名的支路升主干路）+ "
          f"{lane_report['class_corrected']['by_street']} 段（同名道路），共 {lane_report['class_corrected']['length_km']} 公里"
        + f"；道路等级（按长度）" + "、".join(
            f"{k} {v:.0%}" for k, v in (links.groupby("road_class")["length_m"].sum() / links["length_m"].sum()).sort_values(ascending=False).items()),
        f"通行能力（TPDM 第二册表 2.4.1.1，辆/小时/方向）：快速公路中位 "
        f"{links.loc[links['road_class'].eq('expressway'), 'capacity_ab_veh_hr'].median():,.0f}，"
        f"主要干路 {links.loc[links['road_class'].eq('primary'), 'capacity_ab_veh_hr'].median():,.0f}，"
        f"区内干路 {links.loc[links['road_class'].eq('district'), 'capacity_ab_veh_hr'].median():,.0f}，"
        f"地方道路 {links.loc[links['road_class'].eq('local'), 'capacity_ab_veh_hr'].median():,.0f}",
        "实测vs估算：几何、方向、限速、转向限制、收费为实测（运输署）；车道数与道路等级取自 OpenStreetMap（主干道 97% 有标注，"
        "缺标注者按等级默认），通行能力按 TPDM 第二册设计流量表计算，仍是模型最大的供给端假设，待用普查站校准",
    ]
    AUDIT.write_text(json.dumps({
        "source": "Transport Department, Road Network (2nd Generation), via CSDI",
        "links": len(links), "nodes": len(nodes), "turns": len(turns),
        "strongly_connected_components": int(count),
        "road_isolated_zones": isolated,
        "connector_water_check": water,
        "flags": ([] if water["grid"] and not water["zones_without_dry_connector"] else ["connectors across water"]),
        "largest_component_share": round(float(biggest / size), 4),
        "tolls": toll_report,
        "lanes": lane_report,
        "capacity_source": "TPDM Volume 2 Table 2.4.1.1 design flows (veh/hour, one direction)",
        "report": report,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n-> {(OUT / 'road-links.parquet').relative_to(ROOT)} 等 4 个文件")
    for line in report:
        print("   " + line)


if __name__ == "__main__":
    main()
