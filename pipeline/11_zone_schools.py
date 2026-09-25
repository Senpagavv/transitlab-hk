"""Put school places into each zone - the attractor behind every education trip in the model.

Input : CSDI, Education Bureau "School Location and Information" (16 layers, one per school type)
        EDB tab0307 / tab0407, student enrolment by district and grade
Output: data/web/zones-schools.geojson       school places per zone, by level
        data/raw/schools/schools.parquet     every school, located

The school locations are measured: EDB publishes a point for each school. The number of places is
not published per school, so the enrolment EDB publishes for each district is shared among the
schools in that district. The district totals are therefore exact and the split within a district
is an estimate - the audit below says so, and the map has to say so too.

Education trips matter more in Hong Kong than the floor-area attractors: the 2021 census counts
students as a separate group with their own destinations (data/web/zones.geojson carries
study_same_zone / study_hk_island / study_kowloon / study_nt), which is what this layer is
calibrated against once the distribution step runs.

Run from the project root (about 2 minutes):
    uv run python pipeline/11_zone_schools.py
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
ZONES = ROOT / "data" / "web" / "zones.geojson"
RAW = ROOT / "data" / "raw" / "schools"
OUTPUT = ROOT / "data" / "web" / "zones-schools.geojson"
AUDIT = ROOT / "data" / "web" / "zones-schools-audit.json"

HEADERS = {"User-Agent": "TransitLabHK/0.1 (student hackathon prototype)"}
WGS84 = "EPSG:4326"
HK80 = "EPSG:2326"

# Every school type EDB publishes a location layer for, and the level the model needs it at.
SCHOOL_LAYERS = {
    "edb_rcd_1629267205213_46994": ("Kindergartens", "kindergarten"),
    "edb_rcd_1629267205213_2165": ("Kindergarten-cum-child Care Centres", "kindergarten"),
    "edb_rcd_1629267205213_6391": ("Aided Primary Schools", "primary"),
    "edb_rcd_1629267205213_74992": ("Government Primary Schools", "primary"),
    "edb_rcd_1629267205213_77942": ("Direct Subsidy Scheme Primary Schools", "primary"),
    "edb_rcd_1629267205213_95112": ("Private Primary Schools", "primary"),
    "edb_rcd_1629267205213_10118": ("English Schools Foundation (Primary)", "primary"),
    "edb_rcd_1629267205213_1928": ("International Schools (Primary)", "primary"),
    "edb_rcd_1629267205213_53323": ("Aided Secondary Schools", "secondary"),
    "edb_rcd_1629267205213_92681": ("Government Secondary Schools", "secondary"),
    "edb_rcd_1629267205213_87907": ("Direct Subsidy Scheme Secondary Schools", "secondary"),
    "edb_rcd_1629267205213_23500": ("Private Secondary Schools (Day/Evening)", "secondary"),
    "edb_rcd_1629267205213_94310": ("Caput Secondary Schools", "secondary"),
    "edb_rcd_1629267205213_1378": ("English Schools Foundation (Secondary)", "secondary"),
    "edb_rcd_1629267205213_63457": ("International Schools (Secondary)", "secondary"),
    "edb_rcd_1629267205213_7733": ("Aided Special Schools", "special"),
}
ENROLMENT = {
    "primary": "https://www.edb.gov.hk/attachment/en/about-edb/publications-stat/figures/tab0307_en.csv",
    "secondary": "https://www.edb.gov.hk/attachment/en/about-edb/publications-stat/figures/tab0407_en.csv",
}
# EDB gives no district split for kindergartens, so this territory total is shared over the
# kindergartens that are located. It is the published 2025/26 pre-primary enrolment, not an
# assumption - an earlier guess of 140,000 here was 21% too high.
KINDERGARTEN_URL = "https://www.edb.gov.hk/attachment/en/about-edb/publications-stat/figures/enrol-by-level-sex_EN.csv"
KINDERGARTEN_COLUMN = "Pre_Primary (Thousands)"

# The EDB tables carry an "All Districts" row and three region subtotals above the 18 districts.
# Adding every row up counts each pupil three times, so only these rows may be read.
HK_DISTRICTS = {
    "Central & Western": "Central And Western", "Wan Chai": "Wan Chai", "Eastern": "Eastern",
    "Southern": "Southern", "Yau Tsim Mong": "Yau Tsim Mong", "Sham Shui Po": "Sham Shui Po",
    "Kowloon City": "Kowloon City", "Wong Tai Sin": "Wong Tai Sin", "Kwun Tong": "Kwun Tong",
    "Kwai Tsing": "Kwai Tsing", "Tsuen Wan": "Tsuen Wan", "Tuen Mun": "Tuen Mun",
    "Yuen Long": "Yuen Long", "North": "North", "Tai Po": "Tai Po", "Sha Tin": "Sha Tin",
    "Sai Kung": "Sai Kung", "Islands": "Islands",
}


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


def fetch_schools() -> pd.DataFrame:
    rows: list[dict] = []
    for dataset, (label, level) in SCHOOL_LAYERS.items():
        service = f"https://portal.csdi.gov.hk/server/rest/services/common/{dataset}/FeatureServer"
        layer = get(service, {"f": "json"}).json()["layers"][0]["id"]
        page = get(
            f"{service}/{layer}/query",
            {"where": "1=1", "outFields": "NAME_EN,NAME_TC,ADDRESS_EN,SEARCH03_EN,LATITUDE,LONGITUDE",
             "returnGeometry": "false", "f": "json", "resultRecordCount": 4000},
        ).json()
        found = page.get("features", [])
        for feature in found:
            attributes = feature["attributes"]
            rows.append({
                "name_en": attributes.get("NAME_EN"),
                "name_zh": attributes.get("NAME_TC"),
                "district": (attributes.get("SEARCH03_EN") or "").strip().title(),
                "level": level,
                "type": label,
                "lat": attributes.get("LATITUDE"),
                "lon": attributes.get("LONGITUDE"),
            })
        print(f"   {label:<42} {len(found):>5}", flush=True)
    return pd.DataFrame(rows)


def fetch_enrolment(url: str) -> dict[str, float]:
    """District -> students. Only the 18 district rows; the subtotals above them are skipped."""
    text = get(url).content.decode("utf-8-sig", "replace")
    rows = [row for row in csv.reader(io.StringIO(text)) if row and any(c.strip() for c in row)]
    header = [name.strip() for name in rows[0]]
    total_at = next((i for i, name in enumerate(header) if name.lower() in ("all grades", "total")), 1)

    enrolment: dict[str, float] = {}
    published = 0.0
    for row in rows[1:]:
        label = " ".join(row[0].split())
        value = row[total_at].replace(",", "").strip()
        try:
            students = float(value)
        except ValueError:
            continue
        if label == "All Districts":
            published = students
            continue
        if label in HK_DISTRICTS:
            enrolment[HK_DISTRICTS[label]] = students

    counted = sum(enrolment.values())
    if published and abs(counted - published) / published > 0.01:
        raise RuntimeError(f"{url}: 18 districts sum to {counted:,.0f}, table says {published:,.0f}")
    print(f"   {len(enrolment)} 个区合计 {counted:,.0f}，与表中总计 {published:,.0f} 相符")
    return enrolment


def pre_primary_total() -> float:
    """Territory-wide pre-primary enrolment for the latest school year, in people."""
    text = get(KINDERGARTEN_URL).content.decode("utf-8-sig", "replace")
    rows = [row for row in csv.DictReader(io.StringIO(text)) if row.get("Sex", "").strip() == "Total"]
    latest = rows[-1]
    return float(latest[KINDERGARTEN_COLUMN]) * 1000


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    schools = fetch_schools()
    schools = schools.dropna(subset=["lat", "lon"])
    # A kindergarten that also runs a child care centre appears in both EDB layers at one address.
    before = len(schools)
    schools = schools.drop_duplicates(subset=["level", "lat", "lon", "name_en"], keep="first")
    print(f"{len(schools):,} schools located（同址重复登记去重 {before - len(schools)} 所）")

    places: dict[str, dict[str, float]] = {}
    for level, url in ENROLMENT.items():
        places[level] = fetch_enrolment(url)
        print(f"   {level}: {sum(places[level].values()):,.0f} 名学生，{len(places[level])} 个区")

    # Share each district's enrolment over the schools of that level in the district.
    schools["places"] = 0.0
    for level, by_district in places.items():
        at_level = schools["level"].eq(level)
        for district, students in by_district.items():
            here = at_level & schools["district"].eq(district)
            if here.any():
                schools.loc[here, "places"] = students / here.sum()
    kindergartens = schools["level"].eq("kindergarten")
    if kindergartens.any():
        total = pre_primary_total()
        print(f"   kindergarten: {total:,.0f} 名学生（全港总数，教育局按学历分类表）")
        places["kindergarten"] = {"All Districts": total}
        schools.loc[kindergartens, "places"] = total / kindergartens.sum()

    located = gpd.GeoDataFrame(
        schools, geometry=gpd.points_from_xy(schools["lon"], schools["lat"]), crs=WGS84
    ).to_crs(HK80)
    zones = gpd.read_file(ZONES).to_crs(HK80)
    joined = gpd.sjoin(located, zones[["zone", "geometry"]], how="left", predicate="within")
    joined = joined[~joined.index.duplicated(keep="first")]
    schools["zone"] = joined["zone"].values
    schools.to_parquet(RAW / "schools.parquet", index=False)

    inside = schools.dropna(subset=["zone"])
    by_zone = inside.pivot_table(index="zone", columns="level", values="places", aggfunc="sum", fill_value=0.0)
    by_zone = by_zone.rename(columns=lambda c: f"places_{c}")
    by_zone["schools"] = inside.groupby("zone").size()
    by_zone["places_total"] = by_zone[[c for c in by_zone.columns if c.startswith("places_")]].sum(axis=1)

    zones = zones.merge(by_zone, left_on="zone", right_index=True, how="left")
    filled = [c for c in zones.columns if c.startswith("places_") or c == "schools"]
    zones[filled] = zones[filled].fillna(0).round(0)
    zones.to_crs(WGS84).to_file(OUTPUT, driver="GeoJSON", coordinate_precision=6)

    # --- audit (docs/data-audit-checklist.md) -------------------------------------------------
    official = {level: sum(values.values()) for level, values in places.items()}
    ours = {level: float(inside.loc[inside["level"].eq(level), "places"].sum()) for level in official}
    report = [
        f"总量比对：" + "，".join(
            f"{level} 官方 {official[level]:,.0f} / 已落区 {ours[level]:,.0f}"
            f"（{ours[level] / official[level]:.1%}）" for level in official
        ),
        f"空间覆盖：{int((zones['schools'] > 0).sum())}/{len(zones)} 个小区有学校，"
        f"{len(schools) - len(inside)} 所学校落在小区外",
        "缺失值语义：学额非逐校公布，按区内学校平均分摊；区总量准确，区内分布为估算",
        f"粒度：单区最多 {int(zones['schools'].max())} 所学校、{zones['places_total'].max():,.0f} 个学额",
        "实测vs估算：学校位置与类别为实测（教育局），学额为估算",
    ]
    AUDIT.write_text(json.dumps({
        "sources": {
            "locations": "Education Bureau, School Location and Information (CSDI, 16 layers)",
            "enrolment": "Education Bureau, tab0307 / tab0407 student enrolment by district and grade",
        },
        "official_totals": official,
        "allocated": ours,
        "schools": len(schools),
        "schools_in_zones": len(inside),
        "report": report,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n-> {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size / 1e6:.1f} MB)")
    for line in report:
        print("   " + line)
    for row in zones.nlargest(3, "places_total").itertuples():
        print(f"   学额最多: 小区 {row.zone} {row.places_total:,.0f} 个学额（{row.schools:.0f} 所学校）")


if __name__ == "__main__":
    main()
