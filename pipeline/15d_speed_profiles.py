"""Hour-by-hour road speeds, measured: what the detectors saw, spread over the whole network.

Input : data/web/traffic/observed-YYYY-MM-DD.json   hourly speed and flow per detector, one file per
                                                    day sampled (pipeline/05; 20 weekdays as of 2026-09)
        data/web/traffic/detectors.json             detector positions and the direction each faces
        data/model/road-links.parquet               the network (pipeline/15)
        data/raw/road-network/RdNet_IRNP.gdb.zip    the real centrelines, to place detectors properly
Output: data/model/road-speeds-hourly.parquet       link_id, side, hour -> speed, source, limit_kph
        data/web/road-speeds-audit.json

Why. Until now every link ran at its posted limit (50 km/h where nothing is posted), the same at
3 a.m. and at 8:30 a.m. That is wrong in both directions: an expressway at 08:00 is slower than its
limit, while a 50 km/h primary road at night is measured at 67 km/h. Route choice, and any dispatch
model built on travel times, depends on getting this right.

Method.
  1. Each detector is placed on the link side it watches: the nearest centreline within SNAP_M whose
     direction of travel agrees with the detector's own compass direction (within HEADING_TOLERANCE).
  2. For each detector and hour, the speed is the median over all days sampled - a median, so one
     accident or one closed lane does not move it.
  3. Detectors sit on strategic roads only (7.1% of the network's length), so the rest is filled
     in by a factor: for each road class and posted limit, the median of measured speed / posted
     limit, hour by hour. A 70 km/h expressway at 08:00 runs at 0.91 of its limit; a 50 km/h primary
     road at 02:00 runs at 1.34 of it.
  4. A link with its own detector uses the measured speed; every other link uses its class factor.

What this is not. Detectors measure speed at one point in the middle of a link, so they miss the
delay at junctions - which is where most of Hong Kong's urban congestion actually happens. These
speeds are therefore right for expressways and trunk roads, and optimistic for local streets. The
assignment (pipeline/27) is what adds junction-free congestion through the BPR curve; this file
gives it a measured starting point rather than the posted limit.

Run from the project root (about a minute):
    uv run python pipeline/15d_speed_profiles.py
"""

import json
import os
import re
import warnings
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "data" / "model"
TRAFFIC = ROOT / "data" / "web" / "traffic"
GDB = "/vsizip/" + os.path.abspath(ROOT / "data" / "raw" / "road-network" / "RdNet_IRNP.gdb.zip").replace("\\", "/") + "/RdNet_IRNP.gdb"
OUTPUT = MODEL / "road-speeds-hourly.parquet"
AUDIT = ROOT / "data" / "web" / "road-speeds-audit.json"

SNAP_M = 30  # a detector further than this from a road running its way is dropped
HEADING_TOLERANCE = 67.5  # degrees between the detector's direction and the road's
HEADING_SPAN_M = 10  # the road's heading is read over this length around the detector
MIN_DAYS = 5  # an hour needs this many days measured before its median is used
NIGHT_HOURS = (1, 2, 3, 4)  # free-flow reference: the quietest hours
COMPASS = {"North": 0, "North East": 45, "East": 90, "South East": 135, "South": 180,
           "South West": 225, "West": 270, "North West": 315}
BOUND = {"North": 0, "East": 90, "South": 180, "West": 270}
FLOOR_KPH = 5.0  # a measured speed below this is a fault, not traffic
CEILING_RATIO = 1.25  # ... and so is one this far above the posted limit
ROAD_WORDS = {"RD": "ROAD", "ST": "STREET", "AVE": "AVENUE", "HWY": "HIGHWAY", "N": "NORTH", "S": "SOUTH",
              "E": "EAST", "W": "WEST"}


def turn(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


def detector_direction(detector: dict) -> float | None:
    """Which way the detector's traffic runs, in degrees (pipeline/15b's rule: the name wins)."""
    compass = COMPASS.get(detector.get("direction") or "")
    word = re.search(r"(North|South|East|West)\s*\w*bound", detector.get("road_en") or "")
    if word and (compass is None or turn(compass, BOUND[word.group(1)]) > 90):
        return BOUND[word.group(1)]
    return compass


def road_name(text: str) -> str:
    """The road a detector names ("Wong Chuk Hang Road near ... - Eastbound" -> "WONGCHUKHANGROAD")."""
    head = re.split(r"\s+near\s+|\s+-\s+|,", (text or "").upper())[0]
    head = re.sub(r"[^A-Z0-9 ]", " ", head)
    return "".join(ROAD_WORDS.get(w, w) for w in head.split())


def links_with_shapes() -> gpd.GeoDataFrame:
    lines = gpd.read_file(GDB, layer="CENTERLINE", engine="pyogrio", fid_as_index=True, columns=[]).explode(index_parts=False)
    links = pd.read_parquet(MODEL / "road-links.parquet")
    if len(lines) != len(links):
        raise RuntimeError("centrelines differ from pipeline/15's links - rerun pipeline/15")
    shaped = gpd.GeoDataFrame(links, geometry=lines.geometry.to_numpy(), crs="EPSG:2326")
    return shaped[shaped["routable"]].reset_index(drop=True)


def local_heading(line, point) -> float:
    s = line.project(point)
    p1 = line.interpolate(max(0.0, s - HEADING_SPAN_M / 2))
    p2 = line.interpolate(min(line.length, s + HEADING_SPAN_M / 2))
    return float(np.degrees(np.arctan2(p2.x - p1.x, p2.y - p1.y)) % 360)


def measured_speeds(report: list[str]) -> pd.DataFrame:
    """Median speed per detector and hour, over every day sampled."""
    days = sorted(TRAFFIC.glob("observed-*.json"))
    if not days:
        raise RuntimeError("no observed-*.json: run pipeline/05 for a few weekdays first")
    rows = []
    for day in days:
        data = json.loads(day.read_text(encoding="utf-8"))
        weekday = data.get("weekday", "")
        for detector in data["detectors"]:
            for hour, speed in enumerate(detector["speed_kph"]):
                if speed:
                    rows.append((detector["id"], hour, float(speed), data["date"], weekday))
    frame = pd.DataFrame(rows, columns=["id", "hour", "speed", "date", "weekday"])
    weekends = frame["weekday"].isin(["Saturday", "Sunday"])
    frame = frame[~weekends]  # weekday profile; weekend days are kept in the files for later
    median = frame.groupby(["id", "hour"]).agg(speed=("speed", "median"), days=("date", "nunique")).reset_index()
    median = median[median["days"] >= MIN_DAYS]
    report.append(f"探测器实测：{len(days)} 天（工作日 {frame['date'].nunique()} 天）、{median['id'].nunique()} 个探测器、"
                  f"{len(median):,} 个「探测器 × 小时」中位数（至少 {MIN_DAYS} 天才采用）")
    return median


def place_detectors(links: gpd.GeoDataFrame, report: list[str]) -> pd.DataFrame:
    """Each detector -> the link side it watches."""
    detectors = json.loads((TRAFFIC / "detectors.json").read_text(encoding="utf-8"))
    detectors = detectors["detectors"] if isinstance(detectors, dict) else detectors
    points = gpd.GeoSeries(gpd.points_from_xy([d["lon"] for d in detectors], [d["lat"] for d in detectors]),
                           crs="EPSG:4326").to_crs("EPSG:2326")
    index = links.sindex
    rows, unplaced = [], 0
    for detector, point in zip(detectors, points):
        wanted = detector_direction(detector)
        best = None
        for j in index.query(point.buffer(SNAP_M)):
            line = links.geometry.iloc[j]
            distance = line.distance(point)
            if distance > SNAP_M:
                continue
            heading = local_heading(line, point)
            direction = links.at[j, "direction"]
            for side, travel in (("ab", heading), ("ba", (heading + 180) % 360)):
                if side == "ba" and direction != 0:
                    continue
                if wanted is not None and turn(travel, wanted) > HEADING_TOLERANCE:
                    continue
                if best is None or distance < best[2]:
                    best = (int(links.at[j, "link_id"]), side, distance)
        if best is None:
            unplaced += 1
            continue
        street = links.set_index("link_id").at[best[0], "street"] if best[0] in set(links["link_id"]) else None
        same_road = bool(street) and road_name(str(street)) and road_name(detector.get("road_en", "")).startswith(road_name(str(street))[:6])
        rows.append({"id": detector["id"], "link_id": best[0], "side": best[1], "metres": round(best[2], 1),
                     "same_road": same_road})
    placed = pd.DataFrame(rows)
    report.append(f"探测器落到路段：{len(placed)}/{len(detectors)}（{SNAP_M} 米内、走向一致）；未能落位 {unplaced} 个；"
                  f"其中路名也对得上的 {int(placed['same_road'].sum())} 个——只有这些用来推算同类道路的车速比例")
    return placed


def class_factors(measured: pd.DataFrame, placed: pd.DataFrame, links: pd.DataFrame,
                  report: list[str]) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Measured speed over posted limit, by road class, limit and hour."""
    attributes = links.set_index("link_id")[["road_class", "speed_kph", "speed_posted", "length_m"]]
    joined = measured.merge(placed, on="id").join(attributes, on="link_id")
    joined["ratio"] = joined["speed"] / joined["speed_kph"]
    # Only detectors whose own road name matches the link's set the class factors: the rest may have
    # snapped to a service road beside the expressway, and would drag the class's speed up.
    joined = joined[joined["same_road"] & (joined["speed"] >= FLOOR_KPH) & (joined["ratio"] <= CEILING_RATIO)]
    factors = (joined.groupby(["road_class", "speed_kph", "hour"])
               .agg(ratio=("ratio", "median"), detectors=("id", "nunique")).reset_index())
    # A class and limit with too few detectors borrows the class's overall factor for that hour.
    thin = factors["detectors"] < 3
    by_class = joined.groupby(["road_class", "hour"])["ratio"].median().rename("class_ratio")
    factors = factors.join(by_class, on=["road_class", "hour"])
    factors["ratio"] = np.where(thin, factors["class_ratio"].fillna(factors["ratio"]), factors["ratio"])
    shown = factors[(factors["hour"].isin([3, 8, 18])) & (factors["detectors"] >= 3)]
    report.append("实测车速 ÷ 法定限速（中位，探测器 ≥3 个）：" + "；".join(
        f"{r.road_class} 限速 {r.speed_kph:.0f}：3 时 {factors.query('road_class == @r.road_class and speed_kph == @r.speed_kph and hour == 3')['ratio'].iloc[0]:.2f}、"
        f"8 时 {factors.query('road_class == @r.road_class and speed_kph == @r.speed_kph and hour == 8')['ratio'].iloc[0]:.2f}"
        for r in shown[shown["hour"] == 8].itertuples()))
    return factors, joined


def main() -> None:
    report, flags = [], []
    links = links_with_shapes()
    measured = measured_speeds(report)
    placed = place_detectors(links, report)
    factors, joined = class_factors(measured, placed, links, report)

    # Every link side, every hour: the detector's own speed where there is one, the class factor elsewhere.
    sides = []
    for side, keep in (("ab", links["direction"].isin([0, 1])), ("ba", links["direction"] == 0)):
        part = links.loc[keep, ["link_id", "road_class", "speed_kph", "length_m"]].copy()
        part["side"] = side
        sides.append(part)
    network = pd.concat(sides, ignore_index=True)
    hours = pd.DataFrame({"hour": range(24)})
    grid = network.merge(hours, how="cross")
    grid = grid.merge(factors[["road_class", "speed_kph", "hour", "ratio"]], on=["road_class", "speed_kph", "hour"], how="left")
    fallback = factors.groupby(["road_class", "hour"])["ratio"].median().rename("class_ratio")
    grid = grid.join(fallback, on=["road_class", "hour"])
    grid["ratio"] = grid["ratio"].fillna(grid["class_ratio"]).fillna(1.0)
    grid["ratio"] = grid["ratio"].clip(upper=CEILING_RATIO)
    grid["speed"] = (grid["speed_kph"] * grid["ratio"]).clip(lower=FLOOR_KPH)
    grid["source"] = "class factor"

    own = measured.merge(placed[placed["same_road"]], on="id")[["link_id", "side", "hour", "speed"]]
    own = own.groupby(["link_id", "side", "hour"], as_index=False)["speed"].median()
    grid = grid.merge(own.rename(columns={"speed": "measured"}), on=["link_id", "side", "hour"], how="left")
    has = grid["measured"].notna()
    grid.loc[has, "speed"] = grid.loc[has, "measured"]
    grid.loc[has, "source"] = "detector"
    grid["speed"] = grid["speed"].round(1)

    out = grid[["link_id", "side", "hour", "speed", "source", "speed_kph"]].rename(columns={"speed_kph": "limit_kph"})
    out.to_parquet(OUTPUT, index=False)

    measured_length = links.set_index("link_id").loc[placed["link_id"].unique(), "length_m"].sum()
    report.append(f"覆盖：{measured_length / links['length_m'].sum():.1%} 的路网长度有自己的探测器，其余按同类道路的比例推算；"
                  f"输出 {len(out):,} 行（路段方向 × 24 小时）")
    peak = out[out["hour"] == 8]
    night = out[out["hour"] == 3]
    by_class = pd.DataFrame({"早高峰": peak.groupby("limit_kph")["speed"].median(),
                             "凌晨": night.groupby("limit_kph")["speed"].median()})
    report.append("各限速下的中位车速（公里/小时）：" + "；".join(
        f"限速 {int(k)}：8 时 {r['早高峰']:.0f}、3 时 {r['凌晨']:.0f}" for k, r in by_class.iterrows()))

    # Checks the detectors did not set.
    free_flow_gap = (night.groupby("limit_kph")["speed"].median() / night.groupby("limit_kph")["limit_kph"].median())
    slow = float(peak["speed"].median())
    ok = 10 <= slow <= 70
    report.append(f"核对：凌晨车速 ÷ 限速 = " + "、".join(f"{int(k)}：{v:.2f}" for k, v in free_flow_gap.items())
                  + f"；早高峰全网中位车速 {slow:.0f} 公里/小时" + ("" if ok else "  ← 需复核"))
    if not ok:
        flags.append("peak speed")
    urban = out[(out["hour"] == 8) & (out["limit_kph"] == 50)]["speed"].median()
    report.append(f"⚠️ 已知局限：探测器测的是路段中间的点速，不含路口延误，所以市区街道（限速 50，早高峰中位 "
                  f"{urban:.0f} 公里/小时）偏乐观；路口延误由分配步骤的流量-延误曲线补上")

    AUDIT.write_text(json.dumps({"detectors_placed": len(placed), "rows": len(out),
                                 "coverage_by_length": round(float(measured_length / links["length_m"].sum()), 4),
                                 "factors": factors.round(3).to_dict(orient="records"),
                                 "flags": flags, "report": report}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"-> {OUTPUT.relative_to(ROOT)}")
    for line in report:
        print("   " + line)


if __name__ == "__main__":
    main()
