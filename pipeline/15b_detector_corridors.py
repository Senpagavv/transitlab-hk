"""Join the traffic detectors into continuous lines along the roads they measure, for the live map.

Input : data/raw/road-network/RdNet_IRNP.gdb.zip   centreline shapes (Transport Department)
        data/model/road-links.parquet, road-nodes.parquet   the directed road network (pipeline/15)
        data/web/traffic/detectors.json            detector positions and travel directions (pipeline/05)
Output: data/web/traffic/detector-corridors.json   continuous lines, each vertex tied to the two
                                                   detectors around it (WGS84)

The first version (pipeline/06) coloured 500 m of street around each detector, one stretch per
detector, shifted sideways by a guess at the direction. On the map that read as a patchwork of short,
overlapping pieces. This one follows the traffic:

  snap    - each detector goes onto the directed road link nearest to it that runs the way its
            traffic does, within 67.5 degrees (see travel_direction: the feed's compass reading, or
            the "Northbound"-type word in its name where the two disagree). Dual carriageways are
            two one-way roads a few tens of metres apart, so a wrong direction snaps a detector onto
            the opposite carriageway - which first produced lines running north-south-north;
  follow  - from each detector the network is searched downstream for the next detector, no more
            than MAX_GAP_M away, no more than DETOUR x the straight line and turned by no more than
            MAX_BEND degrees (so a line does not loop through a slip road onto another road); each
            detector keeps at most one successor and one predecessor, the nearest. Joined detectors
            often carry different road names - a road changes name along its length (Lion Rock
            Tunnel Road becomes Sha Tin Road) - which is why names are not required to match;
  join    - chains of detectors become single lines: the links between them in order, plus
            END_M of road before the first and after the last;
  blend   - every vertex records the detectors before and after it and how far along it is between
            them, so the browser can shade the line smoothly from one reading to the next.

Both directions of a two-way street share one centreline; the browser draws each line on the left
of its own direction of travel (Hong Kong drives on the left), so they sit side by side.

Run from the project root, after pipeline/15 (about a minute):
    uv run python pipeline/15b_detector_corridors.py
"""

import json
import os
import re
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from shapely.geometry import LineString, Point

ROOT = Path(__file__).resolve().parents[1]
GDB = "/vsizip/" + os.path.abspath(ROOT / "data" / "raw" / "road-network" / "RdNet_IRNP.gdb.zip").replace("\\", "/") + "/RdNet_IRNP.gdb"
MODEL = ROOT / "data" / "model"
DETECTORS = ROOT / "data" / "web" / "traffic" / "detectors.json"
OUTPUT = ROOT / "data" / "web" / "traffic" / "detector-corridors.json"
AUDIT = ROOT / "data" / "web" / "detector-corridors-audit.json"
LIVE_FEED = "https://resource.data.one.gov.hk/td/traffic-detectors/rawSpeedVol-all.xml"
LANE_SNAPSHOT = ROOT / "data" / "raw" / "traffic" / "rawSpeedVol-lanes.xml"  # one reading, kept for the lane check
LANE_AGREEMENT_MIN = 0.8  # share of detectors whose lane count the road network must match within one lane

HK80, WGS84 = "EPSG:2326", "EPSG:4326"
SNAP_M = 40  # a detector further than this from a road running its way is left as a dot
HEADING_TOLERANCE = 67.5  # degrees between the detector's compass direction and the road's
MAX_GAP_M = 2500  # two detectors further apart than this along the road are not joined
DETOUR = 1.35  # road distance over straight distance allowed between joined detectors
# Largest change of direction between two joined detectors. Without it Kwun Tong Bypass eastbound
# was joined, through a slip road, to Kwun Tong Road westbound.
MAX_BEND = 120
END_M = 250  # road drawn before the first and after the last detector of a line
SIMPLIFY_M = 2.5
COMPASS = {"North": 0, "North East": 45, "East": 90, "South East": 135, "South": 180,
           "South West": 225, "West": 270, "North West": 315}
BOUND = {"North": 0, "East": 90, "South": 180, "West": 270}
OPPOSITE = {("North", "South"), ("South", "North"), ("East", "West"), ("West", "East")}


def bound(detector: dict) -> str | None:
    """The direction word in the detector's name ("... - Northbound"), if it has one."""
    match = re.search(r"(North|South|East|West)\s*\w*bound", detector.get("road_en") or "")
    return match.group(1) if match else None


def travel_direction(detector: dict) -> float | None:
    """Which way the detector's traffic runs, in degrees.

    The feed gives a compass direction and the name carries a word like "Northbound". On one-way
    roads, where only one answer is possible, both are right nineteen times in twenty. They
    disagree for 10 of 807 detectors, and there the word agrees with the rest of the detector's
    numbered series (San Tin Highway's northbound detectors 90073-90085, one with the compass
    reading "South") - so the word wins a disagreement; otherwise the finer compass is used.
    """
    compass = COMPASS.get(detector.get("direction") or "")
    word = bound(detector)
    if word is not None and (compass is None or turn(compass, BOUND[word]) > 90):
        return BOUND[word]
    return compass


def heading(a, b) -> float:
    return float(np.degrees(np.arctan2(b[0] - a[0], b[1] - a[1])) % 360)


def turn(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


def load_edges() -> pd.DataFrame:
    """Directed edges of the routable network, each with its shape in travel order."""
    lines = gpd.read_file(GDB, layer="CENTERLINE", engine="pyogrio", fid_as_index=True, columns=[])
    lines = lines.explode(index_parts=False)  # exactly as pipeline/15 numbered its links
    links = pd.read_parquet(MODEL / "road-links.parquet")
    if len(lines) != len(links):
        raise RuntimeError("centreline count differs from pipeline/15's links - rerun pipeline/15")
    shapes = [list(g.coords) for g in lines.geometry]
    if not np.allclose([LineString(s).length for s in shapes[:500]], links["length_m"].to_numpy()[:500], atol=0.05):
        raise RuntimeError("centreline order differs from pipeline/15's links")
    rows = []
    for link, shape in zip(links.itertuples(), shapes):
        if not link.routable:
            continue
        rows.append((link.a_node, link.b_node, shape, link.length_m, link.lanes_ab, link.lanes_source))
        if link.direction == 0:  # two-way: the same centreline, walked backwards
            rows.append((link.b_node, link.a_node, shape[::-1], link.length_m, link.lanes_ba, link.lanes_source))
    edges = pd.DataFrame(rows, columns=["a", "b", "shape", "length", "lanes", "lanes_source"])
    edges["line"] = [LineString(s) for s in edges["shape"]]
    return edges


def snap(detectors: list[dict], edges: pd.DataFrame) -> pd.DataFrame:
    """The directed edge each detector sits on, and how far along it."""
    frame = gpd.GeoDataFrame(edges[["a", "b", "length"]], geometry=edges["line"], crs=HK80)
    points = gpd.GeoSeries(gpd.points_from_xy([d["lon"] for d in detectors], [d["lat"] for d in detectors]),
                           crs=WGS84).to_crs(HK80)
    index = frame.sindex
    rows = []
    for detector, point in zip(detectors, points):
        wanted = travel_direction(detector)
        best = None
        for e in index.query(point.buffer(SNAP_M)):
            line = frame.geometry.iloc[e]
            distance = line.distance(point)
            if distance > SNAP_M:
                continue
            along = line.project(point)
            here = line.interpolate(max(0.0, along - 5)), line.interpolate(min(line.length, along + 5))
            direction = heading((here[0].x, here[0].y), (here[1].x, here[1].y))
            if wanted is not None and turn(direction, wanted) > HEADING_TOLERANCE:
                continue
            if best is None or distance < best[1]:
                best = (e, distance, along, direction)
        if best:
            rows.append({"id": detector["id"], "edge": best[0], "snap_m": best[1], "along": best[2],
                         "heading": best[3], "x": point.x, "y": point.y, "bound": bound(detector)})
    return pd.DataFrame(rows).set_index("id")


def successors(snapped: pd.DataFrame, edges: pd.DataFrame, nodes: int) -> dict[str, tuple[str, float, list]]:
    """For each detector, the nearest detector downstream that the same traffic reaches."""
    # Parallel links between two junctions: keep the shortest, as the balancing graph would.
    shortest = edges.reset_index().sort_values("length").drop_duplicates(["a", "b"])
    graph = csr_matrix((shortest["length"], (shortest["a"], shortest["b"])), shape=(nodes, nodes))
    edge_of = dict(zip(zip(shortest["a"], shortest["b"]), shortest["index"]))
    ids = snapped.index.to_numpy()
    edge = snapped["edge"].to_numpy()
    along = snapped["along"].to_numpy()
    x, y = snapped["x"].to_numpy(), snapped["y"].to_numpy()
    heading_of = snapped["heading"].to_numpy()
    labels = snapped["bound"].tolist()
    length = edges["length"].to_numpy()[edge]
    entry = edges["a"].to_numpy()[edge]  # where each detector's edge begins
    leave = edges["b"].to_numpy()[edge]  # where it ends
    distance, previous = dijkstra(graph, indices=leave, limit=MAX_GAP_M, return_predecessors=True)

    found = {}
    for k in range(len(ids)):
        gap = (length[k] - along[k]) + distance[k, entry] + along
        same = (edge == edge[k]) & (along > along[k])
        gap = np.where(same, along - along[k], gap)
        straight = np.hypot(x - x[k], y - y[k])
        bend = np.abs((heading_of - heading_of[k] + 180) % 360 - 180)
        opposed = np.array([(labels[k], other) in OPPOSITE for other in labels])
        ok = (np.isfinite(gap) & (gap > 0) & (gap <= MAX_GAP_M) & (gap <= DETOUR * straight + 50)
              & (bend <= MAX_BEND) & ~opposed)
        ok[k] = False
        if not ok.any():
            continue
        j = int(np.flatnonzero(ok)[np.argmin(gap[ok])])
        path = []
        if not same[j]:
            node = entry[j]
            while node != leave[k]:
                parent = previous[k, node]
                path.append(edge_of[(parent, node)])
                node = parent
            path = path[::-1]
        found[ids[k]] = (ids[j], float(gap[j]), path)
    # A detector reached from two others keeps the nearer one.
    kept, taken = {}, {}
    for detector, (other, gap, path) in sorted(found.items(), key=lambda item: item[1][1]):
        if other in taken:
            continue
        kept[detector] = (other, gap, path)
        taken[other] = detector
    return kept


def extend(edges: pd.DataFrame, start_edge: int, from_along: float, metres: float, forward: bool,
           used: set, out_of: dict, into: dict) -> list:
    """Coordinates continuing END_M along the road, choosing the straightest way at each junction."""
    coords, edge, along, left = [], start_edge, from_along, metres
    while left > 0:
        line = edges.at[edge, "line"]
        piece = (LineString(line.coords).length - along) if forward else along
        take = min(piece, left)
        part = [line.interpolate(d) for d in (np.linspace(along, along + take, 6) if forward
                                                else np.linspace(along, along - take, 6))]
        coords.extend((p.x, p.y) for p in part)
        left -= take
        if left <= 0:
            break
        used.add(edge)
        shape = edges.at[edge, "shape"]
        direction = heading(shape[-2], shape[-1]) if forward else heading(shape[1], shape[0])
        node = edges.at[edge, "b"] if forward else edges.at[edge, "a"]
        options = [e for e in (out_of.get(node, []) if forward else into.get(node, []))
                   if e not in used and edges.at[e, "a" if forward else "b"] != edges.at[edge, "b" if forward else "a"]]
        if not options:
            break

        def bend(e):
            s = edges.at[e, "shape"]
            return turn(direction, heading(s[0], s[1]) if forward else heading(s[-1], s[-2]))

        edge = min(options, key=bend)
        if bend(edge) > 60:
            break
        along = 0.0 if forward else edges.at[edge, "line"].length
    return coords


def detector_lanes() -> dict[str, int]:
    """How many lanes each detector reports on (the live feed lists them one by one)."""
    import xml.etree.ElementTree as ET

    import httpx

    if not LANE_SNAPSHOT.exists():
        LANE_SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
        response = httpx.get(LIVE_FEED, timeout=60, headers={"User-Agent": "TransitLabHK/0.1"})
        response.raise_for_status()
        LANE_SNAPSHOT.write_bytes(response.content)
    root = ET.parse(LANE_SNAPSHOT).getroot()
    lanes: dict[str, set] = {}
    for detector in root.iter("detector"):
        names = lanes.setdefault(detector.findtext("detector_id"), set())
        names.update(lane.findtext("lane_id") for lane in detector.iter("lane"))
    return {k: len(v) for k, v in lanes.items() if v}


def lane_check(snapped: pd.DataFrame, edges: pd.DataFrame) -> tuple[list[str], dict]:
    """The lanes the road network gives each detector's road against the lanes the detector counts."""
    measured = detector_lanes()
    rows = []
    for detector, row in snapped.iterrows():
        if detector in measured:
            edge = edges.loc[int(row["edge"])]
            rows.append((measured[detector], int(edge["lanes"]), edge["lanes_source"]))
    frame = pd.DataFrame(rows, columns=["measured", "network", "source"])
    gap = frame["network"] - frame["measured"]
    exact, within = float((gap == 0).mean()), float((gap.abs() <= 1).mean())
    by_source = {s: {"detectors": int(len(g)), "exact": round(float((g["network"] == g["measured"]).mean()), 3)}
                 for s, g in frame.groupby("source")}
    report = [f"车道核对：{len(frame)} 个探测器实测车道数 vs 路网车道数，完全一致 {exact:.0%}，相差不超过 1 条 {within:.0%}"
              f"（路网偏少 {float((gap < 0).mean()):.0%}、偏多 {float((gap > 0).mean()):.0%}）；按来源完全一致："
              + "、".join(f"{s} {v['exact']:.0%}（{v['detectors']} 个）" for s, v in by_source.items())
              + ("" if within >= LANE_AGREEMENT_MIN else f"  ← 低于 {LANE_AGREEMENT_MIN:.0%}，需复核")]
    return report, {"detectors": len(frame), "exact": round(exact, 4), "within_one": round(within, 4),
                    "by_source": by_source}


def main() -> None:
    detectors = json.loads(DETECTORS.read_text(encoding="utf-8"))
    edges = load_edges()
    nodes = int(pd.read_parquet(MODEL / "road-nodes.parquet")["node_id"].max()) + 1
    snapped = snap(detectors, edges)
    print(f"{len(detectors)} 个探测器，{len(snapped)} 个吸附到行车方向一致的路段", flush=True)
    links = successors(snapped, edges, nodes)
    predecessor = {other: detector for detector, (other, _, _) in links.items()}
    out_of, into = edges.groupby("a").indices, edges.groupby("b").indices

    corridors, dots = [], []
    heads = [d for d in snapped.index if d not in predecessor]
    for head in heads:
        chain, detector = [head], head
        while detector in links and links[detector][0] not in chain:
            detector = links[detector][0]
            chain.append(detector)
        used: set = set()
        first, last = snapped.loc[chain[0]], snapped.loc[chain[-1]]
        before = extend(edges, int(first["edge"]), float(first["along"]), END_M, False, used, out_of, into)[::-1]
        coords = list(before)
        marks = [(chain[0], len(coords))]  # detector, index of its vertex
        for here, there in zip(chain, chain[1:]):
            row, target = snapped.loc[here], snapped.loc[there]
            _, _, path = links[here]
            own = edges.at[int(row["edge"]), "line"]
            if int(row["edge"]) == int(target["edge"]):
                pieces = [own.interpolate(d) for d in np.linspace(row["along"], target["along"], 6)]
                coords.extend((p.x, p.y) for p in pieces)
            else:
                coords.extend((p.x, p.y) for p in (own.interpolate(d) for d in np.linspace(row["along"], own.length, 4)))
                for e in path:
                    coords.extend(edges.at[e, "shape"])
                end = edges.at[int(target["edge"]), "line"]
                coords.extend((p.x, p.y) for p in (end.interpolate(d) for d in np.linspace(0, target["along"], 4)))
            marks.append((there, len(coords) - 1))
        after = extend(edges, int(last["edge"]), float(last["along"]), END_M, True, used, out_of, into)
        coords.extend(after)
        if len(coords) < 2 or LineString(coords).length < 20:
            dots.extend(chain)  # nothing to draw a line along: shown as a dot
            continue

        # Blend weights by distance along the line, then simplify and keep the weights of what stays.
        line = LineString(coords)
        distances = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(np.array(coords), axis=0).T))])
        at = [(d, distances[i]) for d, i in marks]
        simple = line.simplify(SIMPLIFY_M)
        kept = [line.project(Point(x, y)) for x, y in simple.coords]
        vertex_a, vertex_b, vertex_t = [], [], []
        for s in kept:
            before_marks = [k for k, (_, d) in enumerate(at) if d <= s + 1e-6]
            after_marks = [k for k, (_, d) in enumerate(at) if d >= s - 1e-6]
            a = before_marks[-1] if before_marks else 0
            b = after_marks[0] if after_marks else len(at) - 1
            span = at[b][1] - at[a][1]
            vertex_a.append(a)
            vertex_b.append(b)
            vertex_t.append(round(float((s - at[a][1]) / span), 3) if span > 0 else 0.0)
        shape = gpd.GeoSeries([simple], crs=HK80).to_crs(WGS84).iloc[0]
        corridors.append({
            "detectors": [d for d, _ in at],
            "path": [[round(x, 6), round(y, 6)] for x, y in shape.coords],
            "a": vertex_a, "b": vertex_b, "t": vertex_t,
            "length_m": round(line.length),
        })

    # A line through one detector is not a line. Drawn, it is a 250 m stub that reads as a smudge on
    # the map, and it claims the reading holds along a stretch of road when all we know is the point.
    # Those detectors join the ones that could not be snapped at all, and the map shows them as dots.
    alone = [c["detectors"][0] for c in corridors if len(c["detectors"]) == 1]
    corridors = [c for c in corridors if len(c["detectors"]) > 1]
    loose = [d["id"] for d in detectors if d["id"] not in snapped.index] + dots + alone
    joined = sum(len(c["detectors"]) for c in corridors if len(c["detectors"]) > 1)
    lengths = [c["length_m"] for c in corridors]
    OUTPUT.write_text(json.dumps({
        "source": "Transport Department Road Network (2nd Generation) + traffic detector locations",
        "corridors": corridors, "unmatched": loose,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"-> {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size / 1e6:.2f} MB)")
    print(f"   {len(corridors)} 条线（每条都连起 ≥2 个探测器；只含 1 个的 {len(alone)} 条已改为画点）"
          f"，共 {joined} 个探测器（{joined / len(snapped):.0%}）；总长 {sum(lengths) / 1000:,.0f} km，"
          f"最长 {max(lengths) / 1000:.1f} km")
    print(f"   未能吸附（显示为点）：{len(loose)} 个" + (f"，例如 {loose[:4]}" if loose else ""))
    report, lanes = lane_check(snapped, edges)
    AUDIT.write_text(json.dumps({"lanes": lanes, "report": report}, ensure_ascii=False, indent=1), encoding="utf-8")
    for line in report:
        print("   " + line)


if __name__ == "__main__":
    main()
