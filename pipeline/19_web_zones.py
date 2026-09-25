"""Put the model zones (455) on the website, with names a person can read.

Input : data/web/zones.geojson                       zone shapes (pipeline/14)
        data/model/landuse-2026.parquet              the 2026 figures the model runs on (pipeline/16)
        data/model/zone-centres.parquet              each zone's activity centre (pipeline/15)
        data/model/trip-ends-2026.parquet            jobs and weekday trips (pipeline/21)
        data/web/road-network-audit.json             which zones have no road access
        data/web/places.json                         MTR and light rail stations (pipeline/01)
        data/raw/buildings/buildings-classified.parquet   named buildings, for zones without a station
        data/raw/boundaries/districts_18.json        Chinese district names
        data/raw/placenames/*.geojson                Lands Department official place names (2026-06)
Output: data/web/zones-2026.geojson                  shapes + the figures the map panel shows
        data/web/zones-2026-audit.json

The model's zone codes ("756S.4") mean nothing to a reader, so each zone gets the first of these
that it has, converted to simplified Chinese:
  1. the rail station inside it nearest its activity centre ("沙田站一带") - the splits were seeded
     at stations, so many zones have one of their own;
  2. its housing estate, from the bus stops inside it or its largest named building, cut at the
     estate ("葵芳邨葵信楼" -> "葵芳邨") - a block's own name means nothing to anyone outside it;
  3. the island it is, when the largest piece of land in the zone carries an official island name
     (Cheung Chau, Peng Chau and Lamma have no buses, and were otherwise named after a random house);
  4. the most common bus-stop place that is not a road ("小沥源", "昂船洲军营");
  5. an official place name inside it - town, area, village, hill ("梅子林", "柏架山");
  6. its largest named building, and last its district.

Every figure here comes straight from the land-use table; nothing is recomputed, so what the map
shows is exactly what the model reads. The panel marks which figures are projections or estimates.

Run from the project root (under a minute):
    uv run python pipeline/19_web_zones.py
"""

import json
import re
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from opencc import OpenCC

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "data" / "web"
MODEL = ROOT / "data" / "model"
OUTPUT = WEB / "zones-2026.geojson"
AUDIT = WEB / "zones-2026-audit.json"

HK80, WGS84 = "EPSG:2326", "EPSG:4326"
STATION_KINDS = {"mtr", "light_rail"}
SIMPLIFY_M = 8
to_simplified = OpenCC("t2s").convert


def station_names(zones: gpd.GeoDataFrame, centres: gpd.GeoSeries) -> dict[str, str]:
    places = json.loads((WEB / "places.json").read_text(encoding="utf-8"))["places"]
    stations = pd.DataFrame([p for p in places if p["kind"] in STATION_KINDS])
    points = gpd.GeoDataFrame(
        stations, geometry=gpd.points_from_xy(stations["lon"], stations["lat"]), crs=WGS84
    ).to_crs(HK80)
    inside = gpd.sjoin(points, zones[["zone", "geometry"]], how="inner", predicate="within")
    names = {}
    for zone, group in inside.groupby("zone"):
        nearest = group.geometry.distance(centres[zone]).idxmin()
        names[zone] = to_simplified(group.at[nearest, "name_zh"])
    return names


# "花园" is as often a park ("观塘海滨花园") and "城" a district ("九龙城") as a housing estate.
ESTATE = re.compile(r"^(.+?(?:邨|苑|新村))")
ROAD = re.compile(r"(路|道|街|里|巷|桥|径|隧道|公路|交汇处|迴旋处|回旋处)$")


def stop_names(zones: gpd.GeoDataFrame) -> tuple[dict[str, str], dict[str, str]]:
    """Estate names, and failing that other local place names, from the bus and minibus stops.

    Stops are named after what people get off for - "葵芳邨葵信楼", "小沥源" - which is how residents
    would name the area. A public housing block's own name ("葵信楼") is not, so estate names are cut
    at the estate ("葵芳邨"). Road names ("兴芳路") are skipped: they say where, not what.
    """
    places = json.loads((WEB / "places.json").read_text(encoding="utf-8"))["places"]
    stops = pd.DataFrame([p for p in places if p["kind"] in ("bus_stop", "minibus_stop")])
    stops["place"] = stops["name_zh"].str.split(r"[,，]").str[0].str.strip().map(to_simplified)
    points = gpd.GeoDataFrame(stops, geometry=gpd.points_from_xy(stops["lon"], stops["lat"]), crs=WGS84)
    inside = gpd.sjoin(points.to_crs(HK80), zones[["zone", "geometry"]], how="inner", predicate="within")

    estates, others = {}, {}
    for zone, group in inside.groupby("zone"):
        found = group["place"].str.extract(ESTATE)[0].dropna()
        if len(found):
            estates[zone] = found.value_counts().index[0]
        local = group["place"][~group["place"].str.contains(ROAD) & ~group["place"].str.contains("总站")]
        if len(local):
            others[zone] = local.value_counts().index[0]
    return estates, others


PLACE_RANK = {"Town": 0, "Area": 1, "Village": 2, "Hill": 3, "Peninsula": 4, "Pass": 5}


def official_names(zones: gpd.GeoDataFrame, centres: gpd.GeoSeries) -> tuple[dict[str, str], dict[str, str]]:
    """Island names, and other official place names, from the Lands Department gazetteer."""
    folder = ROOT / "data" / "raw" / "placenames"
    points = gpd.read_file(folder / "GEO_PLACE_NAME.geojson")
    names = pd.DataFrame([f["properties"] for f in
                          json.loads((folder / "PLACE_NAME.geojson").read_text(encoding="utf-8"))["features"]])
    names = names[names["NAME_STATUS"] == "Official"]
    places = points.merge(names[["GEO_NAME_ID", "NAME_TC"]], on="GEO_NAME_ID").to_crs(HK80)
    inside = gpd.sjoin(places, zones[["zone", "geometry"]], how="inner", predicate="within")

    outline = zones.set_index("zone").geometry
    islands, others = {}, {}
    for zone, group in inside.groupby("zone"):
        shape = outline[zone]
        main = max(shape.geoms, key=lambda part: part.area) if shape.geom_type == "MultiPolygon" else shape
        on_main = group[group.geometry.within(main)]
        isle = on_main[on_main["PLACE_TYPE"] == "Island"]
        if len(isle):
            nearest = isle.geometry.distance(main.centroid).idxmin()
            islands[zone] = to_simplified(isle.at[nearest, "NAME_TC"])
        ranked = group[group["PLACE_TYPE"].isin(PLACE_RANK)].copy()
        if len(ranked):
            ranked["rank"] = ranked["PLACE_TYPE"].map(PLACE_RANK)
            ranked["metres"] = ranked.geometry.distance(centres[zone])
            best = ranked.sort_values(["rank", "metres"]).iloc[0]
            others[zone] = to_simplified(best["NAME_TC"])
    return islands, others


def building_names(zone_ids: list[str]) -> dict[str, str]:
    frame = pd.read_parquet(ROOT / "data" / "raw" / "buildings" / "buildings-classified.parquet")
    named = frame.dropna(subset=["BuildingNameTC", "zone"])
    named = named[named["zone"].isin(zone_ids) & named["BuildingNameTC"].str.strip().ne("")]
    biggest = named.sort_values("gfa_m2", ascending=False).drop_duplicates("zone")
    return {row.zone: to_simplified(row.BuildingNameTC.strip()) for row in biggest.itertuples()}


def district_names() -> dict[str, str]:
    frame = gpd.read_file(ROOT / "data" / "raw" / "boundaries" / "districts_18.json")
    english = frame["District"].str.replace(" District", "", regex=False).str.strip()
    return dict(zip(english, frame["地區"].map(to_simplified)))


def main() -> None:
    shapes = gpd.read_file(WEB / "zones.geojson")[["zone", "geometry"]].to_crs(HK80)
    table = pd.read_parquet(MODEL / "landuse-2026.parquet").set_index("zone")
    trips = pd.read_parquet(MODEL / "trip-ends-2026.parquet").set_index("zone")
    trips = trips[~trips["external"]]
    mechanised = ["HBW", "HBS", "HBO", "NHB"]
    crossing = ["CBS", "CBR", "CBV"]
    centres_frame = pd.read_parquet(MODEL / "zone-centres.parquet").set_index("zone")
    centres = gpd.GeoSeries(
        gpd.points_from_xy(centres_frame["x"], centres_frame["y"]), index=centres_frame.index, crs=HK80
    )
    isolated = set(json.loads((WEB / "road-network-audit.json").read_text(encoding="utf-8"))
                   .get("road_isolated_zones", []))
    zone_ids = shapes["zone"].tolist()

    by_station = station_names(shapes, centres)
    by_estate, by_place = stop_names(shapes)
    by_island, by_official = official_names(shapes, centres)
    by_building = building_names(zone_ids)
    district_zh = district_names()

    def label(zone: str) -> tuple[str, str]:
        if zone in by_station:
            return f"{by_station[zone]}一带", "station"
        if zone in by_estate:
            return by_estate[zone], "estate"
        building = by_building.get(zone, "")
        estate = ESTATE.match(building)
        if estate:
            return estate.group(1), "estate"
        if zone in by_island:
            return by_island[zone], "island"
        if zone in by_place:
            return by_place[zone], "place"
        if zone in by_official:
            return by_official[zone], "official"
        if building:
            return building, "building"
        return district_zh.get(table.at[zone, "district"], "未命名"), "district"

    schools = [c for c in ("places_kindergarten", "places_primary", "places_secondary") if c in table]
    jobs = [c for c in ("gfa_office", "gfa_retail", "gfa_industrial", "gfa_hotel") if c in table]
    rows = []
    for zone in zone_ids:
        t = table.loc[zone]
        name, source = label(zone)
        area = float(t["area_km2"]) or np.nan
        rows.append({
            "zone": zone,
            "label": name,
            "label_source": source,
            "district": district_zh.get(t["district"], t["district"]),
            "population": int(t["population"]),
            "population_2021": int(t["population_2021"]),
            "growth_pct": round((t["population"] / t["population_2021"] - 1) * 100, 1)
            if t["population_2021"] else None,
            "density": round(t["population"] / area) if area else None,
            "households": int(t["households"]),
            "workers": int(t["workers"]),
            "students": int(t["students"]),
            "elderly_pct": round(t["age_65_plus"] / t["population"] * 100, 1) if t["population"] else None,
            "floor_jobs_m2": round(float(sum(t[c] for c in jobs))),
            "floor_office_m2": round(float(t.get("gfa_office", 0))),
            "floor_retail_m2": round(float(t.get("gfa_retail", 0))),
            "floor_industrial_m2": round(float(t.get("gfa_industrial", 0))),
            "floor_jobs_density": round(float(sum(t[c] for c in jobs)) / area) if area else None,
            "school_places": int(sum(t[c] for c in schools)),
            "tertiary_places": int(t.get("places_tertiary", 0)),
            "hospital_m2": round(float(t.get("gfa_hospital", 0))),
            "jobs": round(float(trips.at[zone, "jobs"])),
            "jobs_density": round(float(trips.at[zone, "jobs"]) / area) if area else None,
            "trips_out": round(float(sum(trips.at[zone, f"P_{p}"] for p in mechanised))),
            "trips_in": round(float(sum(trips.at[zone, f"A_{p}"] for p in mechanised))),
            "trips_crossing": round(float(sum(trips.at[zone, f"A_{p}"] for p in crossing))),
            "area_km2": round(area, 3),
            "road_access": zone not in isolated,
        })
    frame = pd.DataFrame(rows).replace({np.nan: None})
    out = gpd.GeoDataFrame(frame, geometry=shapes.geometry.simplify(SIMPLIFY_M).to_numpy(), crs=HK80)
    out.to_crs(WGS84).to_file(OUTPUT, driver="GeoJSON", coordinate_precision=5)

    # --- audit --------------------------------------------------------------------------------
    report = []
    same = int(out["population"].sum()) == int(table["population"].sum())
    report.append(f"与模型一致：网页人口合计 {int(out['population'].sum()):,}"
                  + ("，与 2026 土地利用表完全相同" if same else "，与土地利用表不符  ← 需复核"))
    trips_same = abs(out["trips_in"].sum() - trips[[f"A_{p}" for p in mechanised]].sum().sum()) < len(out)
    report.append(f"出行：网页每日到达合计 {out['trips_in'].sum():,.0f}、岗位 {out['jobs'].sum():,.0f}"
                  + ("，与出行生成结果一致" if trips_same else "，与出行生成结果不符  ← 需复核"))
    sources = out["label_source"].value_counts().to_dict()
    report.append(f"命名：铁路站 {sources.get('station', 0)} 个、屋邨/屋苑 {sources.get('estate', 0)} 个、"
                  f"岛名 {sources.get('island', 0)} 个、车站地名 {sources.get('place', 0)} 个、"
                  f"官方地名 {sources.get('official', 0)} 个、楼座名 {sources.get('building', 0)} 个、"
                  f"行政区 {sources.get('district', 0)} 个")
    repeats = int(out["label"].duplicated(keep=False).sum())
    report.append(f"同名小区 {repeats} 个（面板同时显示小区编号，可区分）")
    report.append(f"无公路小区 {int((~out['road_access']).sum())} 个，面板中标注")
    valid = bool(out.geometry.is_valid.all())
    report.append(f"几何：简化 {SIMPLIFY_M} 米后全部有效 {valid}；文件 {OUTPUT.stat().st_size / 1e6:.2f} MB")
    AUDIT.write_text(json.dumps({"report": report}, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"-> {OUTPUT.relative_to(ROOT)}")
    for line in report:
        print("   " + line)
    print("   样例：" + "；".join(f"{r.zone}={r.label}" for r in out.sample(6, random_state=1).itertuples()))


if __name__ == "__main__":
    main()
