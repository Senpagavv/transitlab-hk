"""Add universities and hospitals - the attractors hiding inside the unclassified floor area.

Input : CSDI, Education Bureau "Higher Education Institutions" (campus points)
        Hospital Authority open data, hospitals and clinics (facility points)
        EDB enrolment by level of education (post-secondary control total)
        data/raw/buildings/building-stock.parquet
Output: data/web/zones-institutions.geojson   tertiary places and hospital floor area per zone
        data/web/zones-institutions-audit.json

Why this step exists: checking the two sides of the model against each other showed exactly what was
missing. The census counts 1,044,577 students but the school layer only placed 805,059 of them, and
the census counts 2,659,073 people with a fixed workplace while floor area only accounted for
2,365,867 jobs. Both gaps point at the same buildings - campuses, hospitals and government offices
sit in the 134 million m2 that the Buildings Department does not register, because it records
private buildings only.

A building is treated as institutional when its own name says so, or when it is unclassified and
stands next to a campus or hospital. Buildings that already have a use are never taken, so a private
block beside a hospital stays private.

Run from the project root (about 2 minutes):
    uv run python pipeline/12_zone_institutions.py
"""

import csv
import io
import json
import time
from pathlib import Path

import geopandas as gpd
import httpx
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
BUILDINGS = ROOT / "data" / "raw" / "buildings" / "building-stock.parquet"
ZONES = ROOT / "data" / "web" / "zones.geojson"
RAW = ROOT / "data" / "raw" / "institutions"
OUTPUT = ROOT / "data" / "web" / "zones-institutions.geojson"
AUDIT = ROOT / "data" / "web" / "zones-institutions-audit.json"

HEADERS = {"User-Agent": "TransitLabHK/0.1 (student hackathon prototype)"}
WGS84, HK80 = "EPSG:4326", "EPSG:2326"

HEI_SERVICE = "https://portal.csdi.gov.hk/server/rest/services/common/edb_rcd_1629267205213_58940/FeatureServer"
HA_FACILITIES = {
    "hospital": "https://www.ha.org.hk/opendata/facility-hosp.json",
    "clinic": "https://www.ha.org.hk/opendata/facility-sop.json",
    "clinic_fm": "https://www.ha.org.hk/opendata/facility-fmc.json",
}
ENROLMENT_URL = "https://www.edb.gov.hk/attachment/en/about-edb/publications-stat/figures/enrol-by-level-sex_EN.csv"
POST_SECONDARY_COLUMN = "Post_Secondary (Thousands)"

# Hospital grounds, and the size of block an institution occupies. Tuned against the checks at the
# bottom: a wider radius sweeps in the public housing estates that stand next to most campuses, and
# a footprint/storey filter is what separates a low-rise institutional block from a housing tower.
HOSPITAL_M = 150
MIN_FOOTPRINT_M2 = 1000
MAX_STOREYS = 15

# "College" in Hong Kong usually means a secondary school - Wah Yan College, Hoh Fuk Tong College -
# and "Pok Oi Hospital" is a charity that runs schools, so neither word can be used on its own.
TERTIARY_NAME = r"universit|polytechnic|大學|大学"
HOSPITAL_NAME = r"\bhospital\b|醫院|医院"
NOT_HOSPITAL = r"college|school|中學|中学|小學|小学|substation|變電|变电|quarters|hostel|宿舍"

# Sanity bands for the checks at the end, from planning practice.
M2_PER_STUDENT = (8, 40)
M2_PER_BED = (60, 200)
PUBLIC_BEDS = 30_000  # Hospital Authority beds, for the floor-area-per-bed check


def get(url: str, params: dict | None = None, attempts: int = 4) -> httpx.Response:
    for attempt in range(attempts):
        try:
            response = httpx.get(url, params=params, headers=HEADERS, timeout=180, follow_redirects=True)
            response.raise_for_status()
            return response
        except Exception as error:
            if attempt == attempts - 1:
                raise
            print(f"   retry {attempt + 1}: {type(error).__name__}", flush=True)
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


def fetch_campuses() -> pd.DataFrame:
    layer = get(HEI_SERVICE, {"f": "json"}).json()["layers"][0]["id"]
    page = get(f"{HEI_SERVICE}/{layer}/query",
               {"where": "1=1", "outFields": "NAME_EN,NAME_TC,LATITUDE,LONGITUDE",
                "returnGeometry": "false", "f": "json", "resultRecordCount": 2000}).json()
    rows = [{"name_en": f["attributes"].get("NAME_EN"), "name_zh": f["attributes"].get("NAME_TC"),
             "lat": f["attributes"].get("LATITUDE"), "lon": f["attributes"].get("LONGITUDE"),
             "kind": "tertiary"} for f in page.get("features", [])]
    return pd.DataFrame(rows).dropna(subset=["lat", "lon"])


def fetch_health() -> pd.DataFrame:
    rows: list[dict] = []
    for kind, url in HA_FACILITIES.items():
        for entry in get(url).json():
            latitude, longitude = entry.get("latitude"), entry.get("longitude")
            if latitude in (None, "") or longitude in (None, ""):
                continue
            rows.append({"name_en": entry.get("institution_eng"), "name_zh": entry.get("institution_tc"),
                         "lat": float(latitude), "lon": float(longitude),
                         "kind": "hospital" if kind == "hospital" else "clinic"})
        print(f"   {kind:<12} {sum(1 for r in rows if r['kind'].startswith(kind[:6])):>4}")
    return pd.DataFrame(rows)


def post_secondary_total() -> float:
    text = get(ENROLMENT_URL).content.decode("utf-8-sig", "replace")
    rows = [r for r in csv.DictReader(io.StringIO(text)) if r.get("Sex", "").strip() == "Total"]
    latest = next(r for r in reversed(rows) if r[POST_SECONDARY_COLUMN].strip())
    return float(latest[POST_SECONDARY_COLUMN]) * 1000


def tag_buildings(buildings: gpd.GeoDataFrame, facilities: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Mark the buildings that are a hospital, and the ones that are a university's own."""
    names = buildings["BuildingNameEN"].fillna("") + " " + buildings["BuildingNameTC"].fillna("")
    buildings["institution"] = None

    hospital_named = names.str.contains(HOSPITAL_NAME, case=False, na=False) & ~names.str.contains(
        NOT_HOSPITAL, case=False, na=False)
    buildings.loc[hospital_named, "institution"] = "hospital"
    buildings.loc[names.str.contains(TERTIARY_NAME, case=False, na=False), "institution"] = "tertiary"

    # Hospital grounds: an institutional block is wide and low, a housing tower is narrow and tall.
    wards = facilities[facilities["kind"].eq("hospital")]
    if not wards.empty:
        near = gpd.sjoin_nearest(buildings[["geometry"]], wards[["geometry"]], how="left",
                                 max_distance=HOSPITAL_M, distance_col="metres")
        near = near[~near.index.duplicated(keep="first")]
        on_site = (
            near["metres"].notna().reindex(buildings.index, fill_value=False)
            & buildings["institution"].isna()
            & buildings["footprint_m2"].gt(MIN_FOOTPRINT_M2)
            & buildings["storeys"].lt(MAX_STOREYS)
        )
        buildings.loc[on_site, "institution"] = "hospital"
    return buildings


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    campuses = fetch_campuses()
    health = fetch_health()
    facilities = pd.concat([campuses, health], ignore_index=True)
    facilities.to_parquet(RAW / "facilities.parquet", index=False)
    print(f"{len(campuses)} 所专上院校，{len(health)} 个医疗设施")

    frame = pd.read_parquet(BUILDINGS)
    buildings = gpd.GeoDataFrame(frame, geometry=gpd.points_from_xy(frame["lon"], frame["lat"]), crs=WGS84).to_crs(HK80)
    located = gpd.GeoDataFrame(
        facilities, geometry=gpd.points_from_xy(facilities["lon"], facilities["lat"]), crs=WGS84
    ).to_crs(HK80)

    buildings = tag_buildings(buildings, located)
    tagged = buildings[buildings["institution"].notna()]
    print(f"   认定机构建筑 {len(tagged):,} 栋，{tagged['gfa_m2'].sum() / 1e6:.1f} 百万 m2")

    zones = gpd.read_file(ZONES).to_crs(HK80)
    joined = gpd.sjoin(buildings, zones[["zone", "geometry"]], how="left", predicate="within")
    joined = joined[~joined.index.duplicated(keep="first")]
    buildings["zone"] = joined["zone"]

    by_zone = (
        buildings.dropna(subset=["zone", "institution"])
        .pivot_table(index="zone", columns="institution", values="gfa_m2", aggfunc="sum", fill_value=0.0)
        .rename(columns=lambda c: f"gfa_{c}")
    )

    # Post-secondary places. Campus extents cannot be measured - most of the 122 institutions rent
    # floors in commercial buildings that are already classified - so students are spread over zones
    # by weight, not by floor area: the floor area of buildings a university has put its name on,
    # plus a share for each institution located in the zone. Only the relative weights matter.
    students = post_secondary_total()
    campus_points = facilities[facilities["kind"].eq("tertiary")].copy()
    campus_points = gpd.GeoDataFrame(
        campus_points, geometry=gpd.points_from_xy(campus_points["lon"], campus_points["lat"]), crs=WGS84
    ).to_crs(HK80)
    where = gpd.sjoin(campus_points, zones[["zone", "geometry"]], how="left", predicate="within")
    per_zone_points = where.groupby("zone").size()

    named_gfa = by_zone.get("gfa_tertiary", pd.Series(dtype=float))
    weight = named_gfa.reindex(by_zone.index).fillna(0.0)
    weight = weight / weight.sum() if weight.sum() else weight
    points_weight = per_zone_points.reindex(by_zone.index).fillna(0.0)
    points_weight = points_weight / points_weight.sum() if points_weight.sum() else points_weight
    combined = (weight + points_weight).reindex(by_zone.index).fillna(0.0)
    by_zone["places_tertiary"] = (combined / combined.sum() * students).round(0) if combined.sum() else 0.0

    zones = zones.merge(by_zone, left_on="zone", right_index=True, how="left")
    added = [c for c in zones.columns if c.startswith("gfa_") or c.startswith("places_")]
    zones[added] = zones[added].fillna(0).round(0)
    zones.to_crs(WGS84).to_file(OUTPUT, driver="GeoJSON", coordinate_precision=6)

    # --- audit ------------------------------------------------------------------------------
    tertiary_total = float(zones.get("gfa_tertiary", pd.Series([0])).sum())
    hospital_total = float(zones.get("gfa_hospital", pd.Series([0])).sum())
    per_student = tertiary_total / students if students else 0
    per_bed = hospital_total / PUBLIC_BEDS
    report = [
        f"总量比对 专上：官方 {students:,.0f} 名学生已全部落区（{zones['places_tertiary'].sum():,.0f}）。"
        f"校园范围无法实测（院校多为租用商业楼层），此处 {tertiary_total / 1e6:.1f} 百万 m2 只作分配权重，"
        f"不代表校园楼面",
        f"总量比对 医院：医管局约 {PUBLIC_BEDS:,} 张床位，医疗楼面 {hospital_total / 1e6:.1f} 百万 m2 "
        f"= 每床 {per_bed:.0f} m2（规划常见 {M2_PER_BED[0]}-{M2_PER_BED[1]}）"
        + ("" if M2_PER_BED[0] <= per_bed <= M2_PER_BED[1] else "  ← 超出范围，需复核"),
        f"空间覆盖：{int((zones.get('places_tertiary', pd.Series([0])) > 0).sum())} 个小区有专上院校，"
        f"{int((zones.get('gfa_hospital', pd.Series([0])) > 0).sum())} 个小区有医疗设施",
        "缺失值语义：只认定原本无用途的建筑，已登记用途的私人楼宇不会被改写",
        "实测vs估算：设施位置与建筑楼面为实测；哪栋楼属于校园、以及学额如何分配为估算",
    ]
    AUDIT.write_text(json.dumps({
        "sources": {
            "campuses": "Education Bureau, Higher Education Institutions (CSDI)",
            "health": "Hospital Authority open data, hospital and clinic lists",
            "enrolment": "Education Bureau, student enrolment by level of education",
        },
        "post_secondary_students": students,
        "gfa_tertiary_m2": round(tertiary_total),
        "gfa_hospital_m2": round(hospital_total),
        "m2_per_student": round(per_student, 1),
        "m2_per_bed": round(per_bed, 1),
        "report": report,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n-> {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size / 1e6:.1f} MB)")
    for line in report:
        print("   " + line)


if __name__ == "__main__":
    main()
