"""Split the 211 census zones into the ~460 zones the model actually runs on.

Input : data/web/zones-census.geojson                    211 census zones (pipeline/08)
        data/raw/buildings/buildings-classified.parquet  222,354 buildings with use and floor area
        data/raw/gtfs_community/hk.gtfs.zip              rail stations, to seed the splits
Output: data/web/zones.geojson                           the model zone system
        data/web/zones-split-audit.json

Why: the official Comprehensive Transport Study model uses 454 traffic zones. The published census
units give 211, and the largest holds 277,731 people - a zone that size averages away everything a
transport model is meant to see, because a trip from one end of it to the other is recorded as not
moving at all. TPDM Volume 1 (1.4.5.5) asks for zones that match rail station catchments of 500 m to
1 km, which 211 zones cannot do.

How the split is made: population is not spread evenly over a zone, it sits in buildings. Each zone
is divided around clusters of dwelling floor area, seeded at rail stations where the zone has any,
and every census figure is then shared between the parts in proportion to the dwelling floor area
they contain. Across the 211 zones dwelling floor area explains 93% of the variance in population
(r = 0.965), which is what makes this defensible rather than arbitrary.

"Dwelling floor area" has to include public housing and village houses, which the Buildings
Department does not register - without them every public estate and most villages would be handed
zero population. Which buildings count as homes is decided once, in pipeline/10 (the "dwelling"
column); the audit below turns the result into floor area per household, which should be near the
70-90 m2 a Hong Kong flat plus its share of common area runs to.

Run from the project root (about 3 minutes):
    uv run python pipeline/14_split_zones.py
"""

import io
import json
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from shapely.geometry import MultiPoint
from sklearn.cluster import KMeans

ROOT = Path(__file__).resolve().parents[1]
CENSUS = ROOT / "data" / "web" / "zones-census.geojson"
BUILDINGS = ROOT / "data" / "raw" / "buildings" / "buildings-classified.parquet"
GTFS = ROOT / "data" / "raw" / "gtfs_community" / "hk.gtfs.zip"
OUTPUT = ROOT / "data" / "web" / "zones.geojson"
AUDIT = ROOT / "data" / "web" / "zones-split-audit.json"

HK80, WGS84 = "EPSG:2326", "EPSG:4326"
TARGET_POPULATION = 18_000  # chosen to land near the 454 zones the official model uses
MIN_BUILDINGS_PER_PART = 8  # a part with fewer buildings than this is not worth separating
# A part with fewer people than this, and little else in it, is not worth separating either: the
# first split left zones of 36 to 111 people on the hills above Ma On Shan and Tai Tam, one of them
# out of reach of any road. Parts with real non-residential floor area stay, however few live
# there - the Kwai Chung container terminals (66 residents) and Cathay City are zones of their own.
MIN_PART_POPULATION = 500
MIN_PART_OTHER_GFA_M2 = 50_000
RAIL_ROUTE_TYPES = {0, 1}  # GTFS: 0 light rail and tram, 1 metro
SEED = 20260916  # k-means starts from a random draw; fixing it keeps the zone system reproducible

# Census counts are shared out in proportion to dwelling floor area. Averages and rates cannot be
# shared - they are recomputed from the counts afterwards.
COUNT_FIELDS = [
    "population", "age_0_14", "age_15_24", "age_25_44", "age_45_64", "age_65_plus", "workers",
    "labour_force", "students", "households", "households_public", "households_private",
    "work_same_zone", "work_hk_island", "work_kowloon", "work_nt", "work_at_home",
    "work_outside_hk", "work_no_fixed_place", "study_same_zone", "study_hk_island",
    "study_kowloon", "study_nt",
]


def dwelling_buildings(census: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Buildings people live in (pipeline/10 decides which), each placed in its census zone.

    The census zone is found here, from the building's position. The file also carries a "zone",
    but pipeline/10 fills that with the MODEL zones once they exist: matching census zone ids
    against it finds no buildings in any zone that was split, and those zones silently stop being
    split on the next run.
    """
    frame = pd.read_parquet(BUILDINGS)
    frame = frame[frame["dwelling"]]
    points = gpd.GeoDataFrame(
        frame[["gfa_m2", "lon", "lat"]],
        geometry=gpd.points_from_xy(frame["lon"], frame["lat"]),
        crs=WGS84,
    ).to_crs(HK80)
    placed = gpd.sjoin(points, census[["zone", "geometry"]], how="inner", predicate="within")
    return placed[~placed.index.duplicated(keep="first")].drop(columns="index_right")


def rail_stations() -> gpd.GeoDataFrame:
    archive = zipfile.ZipFile(GTFS)
    routes = pd.read_csv(io.BytesIO(archive.read("routes.txt")))
    trips = pd.read_csv(io.BytesIO(archive.read("trips.txt")), usecols=["route_id", "trip_id"])
    times = pd.read_csv(io.BytesIO(archive.read("stop_times.txt")), usecols=["trip_id", "stop_id"])
    stops = pd.read_csv(io.BytesIO(archive.read("stops.txt")),
                        usecols=["stop_id", "stop_name", "parent_station", "stop_lat", "stop_lon"])

    rail_routes = routes.loc[routes["route_type"].isin(RAIL_ROUTE_TYPES), "route_id"]
    rail_trips = trips.loc[trips["route_id"].isin(rail_routes), "trip_id"]
    rail_stops = times.loc[times["trip_id"].isin(rail_trips), "stop_id"].unique()
    stations = stops[stops["stop_id"].isin(rail_stops)].dropna(subset=["stop_lat", "stop_lon"])
    # Every MTR platform is its own stop, all of them named "Platform 1" to "Platform 8", with the
    # station itself in parent_station - grouping by stop_name collapses 98 stations into 7. Light
    # rail stops carry their real name and no parent, so fall back to the name there.
    stations["station"] = stations["parent_station"].fillna(stations["stop_name"])
    stations = stations.groupby("station", as_index=False)[["stop_lat", "stop_lon"]].mean()
    return gpd.GeoDataFrame(
        stations,
        geometry=gpd.points_from_xy(stations["stop_lon"], stations["stop_lat"]),
        crs=WGS84,
    ).to_crs(HK80)


def largest_remainder(total: float, shares: np.ndarray) -> np.ndarray:
    """Split an integer count by share so that the parts add back to exactly the original."""
    if total <= 0 or shares.sum() <= 0:
        return np.zeros(len(shares), dtype=int)
    exact = shares / shares.sum() * total
    whole = np.floor(exact).astype(int)
    remaining = int(round(total)) - whole.sum()
    if remaining > 0:
        order = np.argsort(-(exact - whole))
        whole[order[:remaining]] += 1
    return whole


def other_floor_area(census: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Every non-residential building, as a point with its floor area, in its census zone."""
    frame = pd.read_parquet(BUILDINGS)
    frame = frame[~frame["dwelling"] & frame["use"].ne("residential_ancillary")]
    points = gpd.GeoDataFrame(
        frame[["gfa_m2"]], geometry=gpd.points_from_xy(frame["lon"], frame["lat"]), crs=WGS84,
    ).to_crs(HK80)
    placed = gpd.sjoin(points, census[["zone", "geometry"]], how="inner", predicate="within")
    return placed[~placed.index.duplicated(keep="first")].drop(columns="index_right")


def too_small(zone, shapes: list, weights: np.ndarray, others: gpd.GeoDataFrame) -> bool:
    """Whether any part would hold hardly anyone and hardly anything."""
    people = weights / weights.sum() * (zone.population or 0)
    for share, shape in zip(people, shapes):
        if shape is None or shape.is_empty or share >= MIN_PART_POPULATION:
            continue
        floor = others.loc[others.geometry.within(shape), "gfa_m2"].sum()
        if floor < MIN_PART_OTHER_GFA_M2:
            return True
    return False


def split_one(zone, buildings: gpd.GeoDataFrame, stations: gpd.GeoDataFrame, parts: int):
    """Cluster a zone's dwellings into `parts` groups and return (labels, centres)."""
    points = np.column_stack([buildings.geometry.x, buildings.geometry.y])
    weights = buildings["gfa_m2"].to_numpy(dtype=float)

    # Start from the rail stations inside the zone: TPDM asks for zones that match station catchments.
    inside = stations[stations.geometry.within(zone)]
    seeds = np.column_stack([inside.geometry.x, inside.geometry.y])[:parts]
    if len(seeds) < parts:
        # Fill the remaining seeds with the dwellings furthest from the ones already chosen.
        chosen = list(seeds)
        for _ in range(parts - len(seeds)):
            if chosen:
                distance = np.min(np.linalg.norm(points[:, None, :] - np.array(chosen)[None, :, :], axis=2), axis=1)
            else:
                distance = np.linalg.norm(points - points.mean(axis=0), axis=1)
            chosen.append(points[int(np.argmax(distance * weights**0.25))])
        seeds = np.array(chosen)

    model = KMeans(n_clusters=parts, init=seeds, n_init=1, random_state=SEED)
    labels = model.fit_predict(points, sample_weight=weights)
    return labels, model.cluster_centers_


def carve(zone, centres: np.ndarray) -> list:
    """Cut the zone polygon along the boundaries half-way between the cluster centres."""
    cells = shapely.voronoi_polygons(MultiPoint([tuple(c) for c in centres]), extend_to=zone.envelope)
    pieces = []
    for centre in centres:
        point = shapely.Point(centre)
        cell = next((c for c in cells.geoms if c.covers(point)), None)
        pieces.append(zone.intersection(cell).buffer(0) if cell is not None else None)
    return pieces


def main() -> None:
    census = gpd.read_file(CENSUS).to_crs(HK80)
    buildings = dwelling_buildings(census)
    others = other_floor_area(census)
    stations = rail_stations()
    print(f"{len(census)} 个普查小区，{len(buildings):,} 栋住宅建筑，{len(stations)} 个铁路站")

    rows = []
    unsplit = []
    merged = []
    for zone in census.itertuples():
        here = buildings[buildings["zone"] == zone.zone]
        wanted = max(1, int(round((zone.population or 0) / TARGET_POPULATION)))
        parts = min(wanted, max(1, len(here) // MIN_BUILDINGS_PER_PART))
        first = parts
        while parts > 1 and len(here) >= parts:
            labels, centres = split_one(zone.geometry, here, stations, parts)
            shapes = carve(zone.geometry, centres)
            weights = np.array([here.loc[labels == i, "gfa_m2"].sum() for i in range(parts)])
            if not too_small(zone, shapes, weights, others):
                break
            parts -= 1  # one part fewer, clustered afresh
        if parts < first:
            merged.append((zone.zone, first, parts))
        if parts <= 1 or len(here) < parts:
            if wanted > 1 and first <= 1:
                unsplit.append((zone.zone, zone.population, len(here)))
            labels, shapes, weights = np.zeros(len(here), dtype=int), [zone.geometry], np.array([1.0])
            parts = 1

        counts = {field: largest_remainder(getattr(zone, field, 0) or 0, weights) for field in COUNT_FIELDS}
        for index, shape in enumerate(shapes):
            if shape is None or shape.is_empty:
                continue
            rows.append({
                "zone": zone.zone if parts == 1 else f"{zone.zone}.{index + 1}",
                "census_zone": zone.zone,
                "name_zh": zone.name_zh,
                "dwelling_gfa_m2": round(float(weights[index]), 0) if parts > 1 else None,
                **{field: int(values[index]) for field, values in counts.items()},
                "geometry": shape,
            })

    model = gpd.GeoDataFrame(rows, geometry="geometry", crs=HK80)
    # Where the model hangs this zone off the network. A Voronoi cell can be cut into pieces by the
    # shape of the parent zone, and the centroid of a shape in several pieces can land outside all of
    # them, so the point is taken inside the largest piece.
    largest = model.geometry.apply(
        lambda g: max(g.geoms, key=lambda p: p.area) if g.geom_type == "MultiPolygon" else g)
    anchor = gpd.GeoSeries(largest, crs=HK80).representative_point().to_crs(WGS84)
    model["centroid_lon"] = anchor.x.round(6)
    model["centroid_lat"] = anchor.y.round(6)

    model["area_km2"] = (model.area / 1e6).round(3)
    model["density_per_km2"] = (model["population"] / model["area_km2"]).replace([np.inf, -np.inf], 0).round(0)
    model["household_size"] = (model["population"] / model["households"]).replace([np.inf, -np.inf], 0).round(2)
    model.loc[model["households"].eq(0), "household_size"] = 0

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    model.to_crs(WGS84).to_file(OUTPUT, driver="GeoJSON", coordinate_precision=6)

    # --- audit (docs/data-audit-checklist.md) -------------------------------------------------
    report = []
    exact = all(int(model[field].sum()) == int(census[field].sum()) for field in COUNT_FIELDS if field in census)
    report.append(
        f"总量守恒：{len(COUNT_FIELDS)} 个普查计数字段拆分前后"
        + ("完全相等（逐字段整数核对）" if exact else "有出入 ← 必须修复")
    )
    report.append(f"粒度：{len(census)} → {len(model)} 个小区（官方 CTS 为 454 个）；"
                  f"最大小区人口 {model['population'].max():,.0f}（原 {census['population'].max():,.0f}）")
    over = int((model["population"] > 50_000).sum())
    report.append(f"仍超过 5 万人的小区 {over} 个")
    per_household = buildings["gfa_m2"].sum() / census["households"].sum()
    report.append(f"住宅楼面：{len(buildings):,} 栋落在普查小区内，每户 {per_household:.0f} m²"
                  + ("（香港一户连公用面积约 70-90 m²）" if 60 <= per_household <= 100 else "  ← 需复核"))

    valid = bool(model.geometry.is_valid.all())
    multi = int((model.geometry.geom_type == "MultiPolygon").sum())
    inherited = set(census.loc[census.geometry.geom_type == "MultiPolygon", "zone"])
    made_here = int((model.geometry.geom_type.eq("MultiPolygon") & ~model["census_zone"].isin(inherited)).sum())
    inside = bool(gpd.GeoSeries(
        gpd.points_from_xy(model["centroid_lon"], model["centroid_lat"]), crs=WGS84
    ).to_crs(HK80).within(model.geometry).all())
    report.append(
        f"几何：全部有效 {valid}；非连续小区 {multi} 个（其中 {multi - made_here} 个继承自原普查小区的离岛，"
        f"{made_here} 个为切分产生的边角碎片）；接驳形心全部落在小区内 {inside}"
    )

    centroids = model.to_crs(HK80).geometry.centroid
    within_km = centroids.apply(lambda p: stations.distance(p).min() <= 1000)
    by_people = float((model.loc[within_km, "population"].sum()) / model["population"].sum())
    report.append(
        f"铁路集水区：{within_km.mean():.0%} 的小区形心在铁路站 1 公里内，"
        f"覆盖 {by_people:.0%} 的人口（TPDM 1.4.5.5 要求小区对齐 500m-1km 集水）"
    )

    zero = int((model["population"] == 0).sum())
    report.append(f"异常值：人口为零的小区 {zero} 个；人口为负 {int((model['population'] < 0).sum())} 个")
    if unsplit:
        report.append(f"因建筑物太少而未能按目标拆分的小区 {len(unsplit)} 个：{unsplit[:5]}")
    smallest = model.nsmallest(3, "population")
    report.append(f"碎片：{len(merged)} 个普查小区因切出不足 {MIN_PART_POPULATION} 人且无其他用途的碎片而少切一份"
                  + (f"（{', '.join(f'{z} {a}→{b}' for z, a, b in merged)}）" if merged else "")
                  + "；现最小的小区 " + "、".join(f"{r.zone} {r.population} 人" for r in smallest.itertuples()))
    report.append("实测vs估算：小区边界与内部人口分配为估算（按住宅楼面），"
                  "原普查小区的合计值为实测且完全保留")

    AUDIT.write_text(json.dumps({
        "method": "weighted k-means on dwelling floor area, seeded at rail stations, Voronoi carve",
        "target_population": TARGET_POPULATION,
        "census_zones": len(census),
        "model_zones": len(model),
        "totals_preserved": exact,
        "report": report,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n-> {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size / 1e6:.1f} MB)")
    for line in report:
        print("   " + line)


if __name__ == "__main__":
    main()
