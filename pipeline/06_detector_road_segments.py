"""Match each traffic detector to the stretch of road it measures, so the map can colour roads.

SUPERSEDED (2026-09-18) by pipeline/15b_detector_corridors.py, which joins the detectors into
continuous lines along the directed road network. Nothing reads this script's output any more; it
is kept as the record of the first approach and why it looked patchy (see 15b's docstring).

Input : data/raw/road-network/RdNet_IRNP.gdb.zip  (Transport Department, Road Network 2nd Generation)
        data/web/traffic/detectors.json           (detector locations, from pipeline/05)
Output: data/web/traffic/detector-roads.json      (one road stretch per detector, WGS84)

The detector feed gives a reading at a point. Drawing dots says little about which road is busy, so
each detector is snapped to the nearest road centreline and then extended along the same street for
STRETCH_M in each direction - that stretch is what gets coloured on the map.

Centrelines are tiny pieces (10-20 m each), so a stretch is many pieces merged into one line.
Opposite directions of the same road match the same centrelines, so each stretch is shifted
sideways by OFFSET_M to keep both directions visible.

Run from the project root (about a minute):
    uv run python pipeline/06_detector_road_segments.py
"""

import json
from pathlib import Path

import geopandas as gpd
import numpy as np
from shapely.geometry import LineString, MultiLineString
from shapely.ops import linemerge, substring

ROOT = Path(__file__).resolve().parents[1]
ROAD_GDB = "/vsizip/" + str((ROOT / "data" / "raw" / "road-network" / "RdNet_IRNP.gdb.zip").as_posix()) + "/RdNet_IRNP.gdb"
DETECTORS = ROOT / "data" / "web" / "traffic" / "detectors.json"
OUTPUT = ROOT / "data" / "web" / "traffic" / "detector-roads.json"

HK80 = "EPSG:2326"  # metres, so distances below are real metres
WGS84 = "EPSG:4326"
SNAP_M = 45  # a detector further than this from any centreline is left unmatched
STRETCH_M = 250  # how far the coloured stretch runs each way from the detector
OFFSET_M = 5  # sideways shift so both directions of a road stay visible
SIMPLIFY_M = 3


def load_detectors() -> gpd.GeoDataFrame:
    records = json.loads(DETECTORS.read_text(encoding="utf-8"))
    frame = gpd.GeoDataFrame(
        records,
        geometry=gpd.points_from_xy([r["lon"] for r in records], [r["lat"] for r in records]),
        crs=WGS84,
    )
    return frame.to_crs(HK80)


def road_stretch(roads: gpd.GeoDataFrame, point, street_code) -> LineString | None:
    """Merge the centrelines of one street near the detector into a single line."""
    nearby = roads[(roads["ST_CODE"] == street_code) & (roads.distance(point) <= STRETCH_M)]
    if nearby.empty:
        return None
    merged = linemerge(MultiLineString([geom for geom in nearby.geometry if not geom.is_empty]))
    parts = list(merged.geoms) if isinstance(merged, MultiLineString) else [merged]
    # Keep the piece the detector actually sits on, trimmed to STRETCH_M either side.
    line = min(parts, key=lambda p: p.distance(point))
    along = line.project(point)
    return substring(line, max(0, along - STRETCH_M), min(line.length, along + STRETCH_M))


def shift_sideways(line: LineString, metres: float) -> LineString:
    """Offset a line sideways; keeps the two directions of a road from drawing on top of each other."""
    try:
        shifted = line.parallel_offset(abs(metres), "left" if metres >= 0 else "right", join_style=2)
    except Exception:
        return line
    if shifted.is_empty:
        return line
    if isinstance(shifted, MultiLineString):
        shifted = max(shifted.geoms, key=lambda p: p.length)
    return shifted


def main() -> None:
    detectors = load_detectors()
    roads = gpd.read_file(ROAD_GDB, layer="CENTERLINE", columns=["ST_CODE", "STREET_ENAME"], engine="pyogrio")
    roads = roads.to_crs(HK80)
    roads = roads[roads.geometry.notna() & (roads["ST_CODE"].notna())]
    roads = roads.explode(index_parts=False)  # the file stores MultiLineStrings of single pieces
    print(f"{len(detectors)} detectors, {len(roads)} centreline pieces")

    # Nearest centreline for each detector, to learn which street it sits on.
    matched = gpd.sjoin_nearest(detectors, roads[["ST_CODE", "geometry"]], how="left", max_distance=SNAP_M, distance_col="snap_m")

    features = []
    unmatched = []
    for _, det in matched.iterrows():
        if np.isnan(det.get("snap_m", np.nan)):
            unmatched.append(det["id"])
            continue
        stretch = road_stretch(roads, det.geometry, det["ST_CODE"])
        if stretch is None or stretch.length < 20:
            unmatched.append(det["id"])
            continue
        # Northbound/eastbound on one side, the opposite direction on the other.
        side = 1 if any(c in (det["direction"] or "") for c in ("North", "East")) else -1
        stretch = shift_sideways(stretch, side * OFFSET_M).simplify(SIMPLIFY_M)
        line = gpd.GeoSeries([stretch], crs=HK80).to_crs(WGS84).iloc[0]
        features.append(
            {
                "id": det["id"],
                "road_zh": det["road_zh"],
                "direction": det["direction"],
                "snap_m": round(float(det["snap_m"]), 1),
                "path": [[round(x, 6), round(y, 6)] for x, y in line.coords],
            }
        )

    OUTPUT.write_text(
        json.dumps(
            {
                "source": "Transport Department Road Network (2nd Generation) + traffic detector locations",
                "stretch_metres": STRETCH_M,
                "roads": features,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    lengths = [len(f["path"]) for f in features]
    print(f"{len(features)} road stretches -> {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size / 1e6:.2f} MB)")
    print(f"  points per stretch: median {int(np.median(lengths))}, max {max(lengths)}")
    print(f"  unmatched detectors: {len(unmatched)}" + (f" (e.g. {unmatched[:3]})" if unmatched else ""))


if __name__ == "__main__":
    main()
