"""Which road link, and which way along it, each Annual Traffic Census station counts.

Input : data/web/traffic/atc-stations.json       station points, road names and counted directions (pipeline/07)
        data/model/road-links.parquet, road-nodes.parquet   the road network (pipeline/15)
Output: data/model/census-links.parquet          station, direction -> link_id, side ("ab"/"ba"); one row per
                                                 carriageway - sum over rows for a direction
        data/web/census-links-audit.json

The census is what assignment is judged against (GEH, TPDM / DMRB practice), so every counted
direction needs the one link side its count belongs to. Distance alone is not enough:
  - the two halves of a dual carriageway or the two tubes of a tunnel can be further apart than the
    station is from either (the Eastern Harbour Crossing's tubes);
  - a station on a flyover sits over the road below it (East Kowloon Corridor over Chatham Road North).
So the census's own road name is used first: the station's link text ("KWAI TSING RD & TSING YI S
BRIDGE (from ...)") is expanded ("RD" -> "ROAD") and compared with the network's street names within
SEARCH_M (NAME_REACH_M for a station at a toll plaza, before its tunnel starts); only if no link of
that name is near does the nearest link within NEAREST_M stand in - which is right for the new
roads the network names after the highway they carry (Stonecutters Bridge on Tsing Sha Highway,
Lung Shan Tunnel on Heung Yuen Wai Highway, Tseung Kwan O - Lam Tin Tunnel on Tseung Lam Highway).
Distances are to the real centrelines, not the straight line between a link's end nodes: a tunnel
link is kilometres long and its chord can pass hundreds of metres from the bore.
A census station counts every lane of each direction, and the network draws some roads as several
parallel one-way carriageways (Queensway eastbound: a link with 294 buses an hour beside one with
22; Harcourt Road westbound: two links 17 m apart). So a line SCREEN_M either side of the station,
square to the road, is laid across it, and every link of that name it cuts, travelling within 90
degrees of a counted direction ("North Bound", ...), belongs to that direction - a modelled count is
the sum over them. A direction the line does not reach (a tube further away) takes the nearest
such side. Where a station's two directions land on sides that do not run opposite ways, the
match is flagged.

Run from the project root (seconds):
    uv run python pipeline/15c_census_links.py
"""

import json
import os
import re
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import LineString

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "data" / "model"
STATIONS = ROOT / "data" / "web" / "traffic" / "atc-stations.json"
GDB = "/vsizip/" + os.path.abspath(ROOT / "data" / "raw" / "road-network" / "RdNet_IRNP.gdb.zip").replace("\\", "/") + "/RdNet_IRNP.gdb"
OUTPUT = MODEL / "census-links.parquet"
AUDIT = ROOT / "data" / "web" / "census-links-audit.json"

SEARCH_M = 100  # links of the station's own road this close count
NAME_REACH_M = 300  # ... or, if none, this close (a station at a toll plaza, before the tunnel starts)
NEAREST_M = 30  # failing a name, the nearest link this close
HEADING_SPAN_M = 10  # the road's heading is read over this length around the station
SCREEN_M = 40  # half-length of the line across the road that collects its parallel carriageways
BOUND = {"North Bound": 0, "East Bound": 90, "South Bound": 180, "West Bound": 270}
WORDS = {"RD": "ROAD", "ST": "STREET", "AVE": "AVENUE", "HWY": "HIGHWAY", "C": "CENTRAL", "W": "WEST",
         "E": "EAST", "N": "NORTH", "S": "SOUTH", "INT": "INTERCHANGE", "TUNL": "TUNNEL", "BR": "BRIDGE"}


def turn(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


def normalise(name: str) -> str:
    name = re.sub(r"<[^>]*>", " ", name.upper())
    name = re.sub(r"[^A-Z0-9' ]", " ", name)
    tokens = [t for t in name.split() if t != "FO"]  # "FO" marks a flyover
    return " ".join(WORDS.get(t, t) for t in tokens)


def census_names(link_text: str) -> list[str]:
    """The road names in a station's description: before "(from", split on "&", and each also
    without a section after a dash ("CENTRAL-WANCHAI BYPASS – CENTRAL SECTION")."""
    road = re.split(r"\(from", link_text or "")[0]
    names = []
    for part in road.split("&"):
        names.append(normalise(part))
        head = re.split(r"\s[-–]\s", part)[0]
        names.append(normalise(head))
    return [n for n in dict.fromkeys(names) if n]


def named(street, names: list[str]) -> bool:
    """Same road, spaces ignored ("CENTRAL-WANCHAI BYPASS" is "CENTRAL-WAN CHAI BYPASS TUNNEL")."""
    street = normalise(street).replace(" ", "") if isinstance(street, str) and street != "-99" else ""
    squashed = [n.replace(" ", "") for n in names]
    return bool(street) and any(street.startswith(n) or n.startswith(street) for n in squashed)


def link_shapes() -> gpd.GeoDataFrame:
    """Every routable link with its real centreline (pipeline/15 numbered the exploded centrelines
    in file order; a long tunnel's straight chord can pass hundreds of metres from its bore)."""
    lines = gpd.read_file(GDB, layer="CENTERLINE", engine="pyogrio", fid_as_index=True, columns=[])
    lines = lines.explode(index_parts=False)
    links = pd.read_parquet(MODEL / "road-links.parquet")
    if len(lines) != len(links) or not np.allclose(lines.geometry.length.to_numpy()[:500],
                                                   links["length_m"].to_numpy()[:500], atol=0.05):
        raise RuntimeError("centrelines differ from pipeline/15's links - rerun pipeline/15")
    shaped = gpd.GeoDataFrame(links, geometry=lines.geometry.to_numpy(), crs="EPSG:2326")
    return shaped[shaped["routable"]].reset_index(drop=True)


def local_heading(line, point) -> float:
    """Direction a -> b of a centreline where it passes the point, clockwise from north."""
    s = line.project(point)
    p1 = line.interpolate(max(0.0, s - HEADING_SPAN_M / 2))
    p2 = line.interpolate(min(line.length, s + HEADING_SPAN_M / 2))
    return float(np.degrees(np.arctan2(p2.x - p1.x, p2.y - p1.y)) % 360)


def screen_crossings(links: gpd.GeoDataFrame, pool: dict[int, float], point) -> list[tuple]:
    """Link sides of the station's road cut by a line through the station square to the road:
    (link index, side, heading of travel there, crossing point)."""
    if not pool:
        return []
    nearest = min(pool, key=pool.get)
    across = np.radians(local_heading(links.geometry.iloc[nearest], point) + 90)
    dx, dy = np.sin(across) * SCREEN_M, np.cos(across) * SCREEN_M
    screen = LineString([(point.x - dx, point.y - dy), (point.x + dx, point.y + dy)])
    cuts = []
    for j in pool:
        line = links.geometry.iloc[j]
        hit = line.intersection(screen)
        for q in getattr(hit, "geoms", [hit]):
            if q.is_empty or q.geom_type != "Point":
                continue
            h = local_heading(line, q)
            if links.at[j, "direction"] in (0, 1):
                cuts.append((j, "ab", h, q))
            if links.at[j, "direction"] in (0, -1):
                cuts.append((j, "ba", (h + 180) % 360, q))
    return cuts


def main() -> None:
    records = pd.DataFrame(json.loads(STATIONS.read_text(encoding="utf-8"))["records"])
    records = records[records["lon"].notna()].sort_values("year").groupby(["station", "direction"]).last().reset_index()
    links = link_shapes()
    index = links.sindex
    points = gpd.GeoSeries(gpd.points_from_xy(records["lon"], records["lat"]), crs="EPSG:4326").to_crs("EPSG:2326")
    records["point"] = points.to_numpy()

    rows, flags = [], []
    for station, group in records.groupby("station"):
        point = group["point"].iloc[0]
        names = census_names(group["link"].iloc[0])
        dist = {int(j): float(links.geometry.iloc[j].distance(point)) for j in index.query(point.buffer(NAME_REACH_M))}
        by_name = {}
        for reach in (SEARCH_M, NAME_REACH_M):
            by_name = {j: d for j, d in dist.items() if d <= reach and named(links.at[j, "street"], names)}
            if by_name:
                break
        dist = {j: d for j, d in dist.items() if d <= SEARCH_M}
        pool, how = (by_name, "name") if by_name else ({j: d for j, d in dist.items() if d <= NEAREST_M}, "nearest")
        sides = []
        for j, d in pool.items():
            direction = links.at[j, "direction"]
            h = local_heading(links.geometry.iloc[j], point)
            if direction in (0, 1):
                sides.append((j, "ab", h, d))
            if direction in (0, -1):
                sides.append((j, "ba", (h + 180) % 360, d))
        crossing = screen_crossings(links, pool, point)
        chosen = {}
        for label in group["direction"]:
            if label not in BOUND:
                flags.append(f"{station} {label}: 方向不明")
                continue
            across = [c for c in crossing if turn(c[2], BOUND[label]) < 90]
            if across:  # every carriageway of the road this way, where the screen line cuts it
                picked, where = [], []
                for j, side, h, q in across:
                    if all(q.distance(w) > 1.0 for w in where):  # a cut at a node touches two links
                        picked.append((j, side, h, pool[j]))
                        where.append(q)
                matched = how + "+screen"
            else:
                fits = [s for s in sides if turn(s[2], BOUND[label]) < 90]
                if not fits:
                    flags.append(f"{station} {label}: {SEARCH_M} 米内没有朝这个方向的路段（{how}）")
                    continue
                picked = [min(fits, key=lambda s: (round(s[3] / 5), turn(s[2], BOUND[label])))]
                matched = how
            chosen[label] = picked[0][:3]
            for j, side, h, d in picked:
                rows.append({"station": int(station), "direction": label, "link_id": int(links.at[j, "link_id"]),
                             "side": side, "street": links.at[j, "street"], "distance_m": round(d, 1),
                             "matched_by": matched, "carriageways": len(picked), "census_road": " / ".join(names)})
        if len(chosen) == 2:
            (j1, s1, h1), (j2, s2, h2) = chosen.values()
            if turn(h1, h2) < 120:
                flags.append(f"{station}: 两个方向落在不对向的路段（{h1:.0f}° / {h2:.0f}°）")

    table = pd.DataFrame(rows)
    table.to_parquet(OUTPUT, index=False)
    stations = records["station"].nunique()
    directions = table.drop_duplicates(["station", "direction"])
    report = [
        f"普查站 {stations} 个、计数方向 {len(records)} 个，配到 {len(directions)} 个方向"
        f"（按路名 {int(directions['matched_by'].str.startswith('name').sum())}，"
        f"按最近 {int(directions['matched_by'].str.startswith('nearest').sum())}；"
        f"断面线切到 {int(directions['matched_by'].str.endswith('screen').sum())}）；"
        f"一个方向含多条并行车道的 {int((directions['carriageways'] > 1).sum())} 个，共 {len(table)} 个路段方向",
        f"站点到所配路段的距离：中位 {table['distance_m'].median():.0f} 米，最大 {table['distance_m'].max():.0f} 米",
        f"未配上或方向存疑 {len(flags)} 项（容许 5%）" + ("" if len(flags) <= 0.05 * len(records) else "  ← 需复核"),
    ] + [f"  {f}" for f in flags]
    AUDIT.write_text(json.dumps({"report": report, "flags": flags}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"-> {OUTPUT.relative_to(ROOT)}")
    for line in report:
        print("   " + line)


if __name__ == "__main__":
    main()
