"""Build the attraction side of the model: how much of each kind of floor area sits in each zone.

Input : data/raw/buildings/building-stock.parquet   every building, with floor area (pipeline/09)
        data/raw/buildings/bd-building-usage.csv    Buildings Department, what each private building is used for
        data/raw/boundaries/districts_18.json       the 18 districts, for checking against official totals
        data/raw/rvd/*.csv                          Rating and Valuation Department floor area by district
        data/web/zones.geojson                      the 211 model zones (pipeline/08)
Output: data/web/zones-attraction.geojson           floor area by use per zone
        data/web/zones-attraction-audit.json        every check in docs/data-audit-checklist.md, with results
        data/raw/buildings/buildings-classified.parquet  every building with its use, zone, district and
            whether people live in it (the one definition of a home, which pipelines 14, 16 and 21 read)
            - kept because splitting the zone system (pipeline/14) has to re-add floor area over the
              new zones, and re-deriving the use of 222,354 buildings each time would be wasteful

Why floor area and not jobs: Hong Kong publishes no employment figures at zone level. Every census
table and every re-publication of one gives working population by place of RESIDENCE (checked against
the ArcGIS "by Place of Work" layer - its values are identical to the residence table, field for
field). TPDM Volume 1 Annex D does not need jobs: it gives attraction as pcu/hr per 100 m2 of office
or shop floor area, per flat, per hotel room. Floor area is therefore the quantity to build on, and
it is measured rather than modelled.

The Buildings Department records cover private buildings only, so public housing, schools, hospitals
and government offices get no use from them. What is left over is labelled and reported rather than
guessed at - the audit below says how much floor area that is.

Run from the project root (about 2 minutes):
    uv run python pipeline/10_zone_attraction.py
"""

import csv
import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
BUILDINGS = ROOT / "data" / "raw" / "buildings" / "building-stock.parquet"
BD_USAGE = ROOT / "data" / "raw" / "buildings" / "bd-building-usage.csv"
DISTRICTS = ROOT / "data" / "raw" / "boundaries" / "districts_18.json"
RVD = ROOT / "data" / "raw" / "rvd"
ZONES = ROOT / "data" / "web" / "zones.geojson"
OUTPUT = ROOT / "data" / "web" / "zones-attraction.geojson"
AUDIT = ROOT / "data" / "web" / "zones-attraction-audit.json"
CLASSIFIED = ROOT / "data" / "raw" / "buildings" / "buildings-classified.parquet"

HK80 = "EPSG:2326"
WGS84 = "EPSG:4326"
MATCH_M = 60  # a Buildings Department address point further than this from a building is not a match

# What the Buildings Department calls a building -> what the model needs it for.
USE_CLASSES = {
    "Residential/Composite": "residential",
    "Office/Commercial": "office_commercial",
    "Industrial": "industrial",
    "Others": "other",
}
# Hotels are registered as "Office/Commercial" but carry their own attraction rate in TPDM Annex D
# (per room, not per 100 m2), and they are absent from the RVD commercial stock, so they are pulled
# out by name. The check below turns the result into m2 per room and compares it with the official
# room count - hotels run about 60-70 m2 of gross floor area per room.
HOTEL_NAME = r"\bhotel\b|\bresort\b|\binn\b|\bhostel\b|guest ?house|酒店|賓館|旅館|渡假"
HOTEL_ROOMS = ROOT / "data" / "raw" / "hotels" / "hotel-rooms-by-district.csv"

# A podium under a residential tower is not flats, but neither is it mostly shops: at 33 million m2
# it is nearly three times Hong Kong's entire private commercial stock, because it is mainly car
# parking, clubhouses and plant. It is kept apart as ancillary floor area, which the model must not
# charge a shop's attraction rate against. The real malls - Elements, Telford Plaza - are registered
# as Office/Commercial and are handled by the office/shop split below.
PODIUM = "Podium"

# Homes. The Buildings Department registers private housing only; public estates, village houses and
# government quarters come through as "unclassified". Among those a building is a home if it is
#   - a tower of three storeys or more on a footprint under 2,000 m2 (a public housing block), or
#   - a village house: a tower of 40-150 m2 and two storeys or more. A New Territories Exempted House
#     is at most 65.03 m2 and three storeys, and the published counts show that most 7-8 m houses have
#     two. Requiring three storeys left 33,000 village houses out, most of the rural New Territories;
# unless its name says it is something else. Without the names, 404 schools, 104 stations and some
# 600 other facilities - 6 million m2 - were counted as flats.
LARGE_HOME_MAX_M2 = 2000
VILLAGE_HOUSE_M2 = (40, 150)
NOT_A_HOME = (r"SCHOOL|COLLEGE|KINDERGARTEN|UNIVERSITY|SUB-?STATION|PUMP|TREATMENT|LANDFILL|REFUSE|TOILET|"
              r"LATRINE|CHURCH|CHAPEL|TEMPLE|MOSQUE|MONASTERY|CLINIC|HOSPITAL|MARKET|FACTORY|WAREHOUSE|"
              r"GODOWN|DEPOT|PRISON|CORRECTIONAL|LABORATORY|MUSEUM|LIBRARY|STADIUM|\bMTR\b|"
              r"學校|書院|幼稚園|變電|泵|污水|廁所|教堂|廟|診所|醫院|街市|工廠|貨倉|車廠|監獄")
# These words name a facility unless the rest of the name says it is housing ("Wah Ming House").
PROBABLY_NOT_A_HOME = r"STATION|CENTRE|CENTER|COMPLEX|HALL|OFFICE|PLANT|WORKS|STORE|GARAGE|PAVILION|TERMINAL|PIER|RECEPTION|RESERVOIR"
HOME_NAME = r"HOUSE|COURT|BLOCK|GARDEN|VILLA|ESTATE|MANSION|TOWER|TERRACE|LODGE|VILLAGE|QUARTERS|APARTMENT|RESIDENCE|HEIGHTS|邨|苑|閣|村|宿舍"

# RVD publishes these separately; together they are what "office_commercial" and "industrial" cover.
RVD_TABLES = {
    "office": ["office"],
    "retail": ["commercial"],
    "industrial": ["flatted_factory", "industrial_office", "specialised_factory", "storage"],
}
# The RVD tables also carry region subtotals (HONG KONG, KOWLOON, ...) and, for offices, a second
# breakdown into sub-districts (Central, Sheung Wan, ...). Only these 18 rows may be added up.
HK_DISTRICTS = [
    "Central and Western", "Wan Chai", "Eastern", "Southern",
    "Yau Tsim Mong", "Sham Shui Po", "Kowloon City", "Wong Tai Sin", "Kwun Tong",
    "Kwai Tsing", "Tsuen Wan", "Tuen Mun", "Yuen Long", "North", "Tai Po", "Sha Tin",
    "Sai Kung", "Islands",
]


def rvd_stock(name: str) -> dict[str, float]:
    """Floor area at 2024 year-end by district, in square metres. '-' means none, not unpublished."""
    rows = list(csv.reader((RVD / f"{name}.csv").open(encoding="utf-8-sig")))
    header = next(i for i, row in enumerate(rows) if any("Stock at 2024" in c for c in row))
    column = next(i for i, c in enumerate(rows[header]) if "Stock at 2024" in c)
    stock = {}
    for row in rows[header + 1:]:
        if not row or not row[0].strip():
            continue
        value = row[column].strip().replace(",", "")
        stock[" ".join(row[0].split())] = 0.0 if value in ("-", "") else float(value)
    return stock


def load_buildings() -> gpd.GeoDataFrame:
    frame = pd.read_parquet(BUILDINGS)
    return gpd.GeoDataFrame(
        frame,
        geometry=gpd.points_from_xy(frame["lon"], frame["lat"]),
        crs=WGS84,
    ).to_crs(HK80)


def load_bd_usage() -> gpd.GeoDataFrame:
    frame = pd.read_csv(BD_USAGE, usecols=["NSEARCH5_E", "SEARCH1_E", "LATITUDE", "LONGITUDE"])
    frame = frame.dropna(subset=["LATITUDE", "LONGITUDE"])
    frame["use"] = frame["NSEARCH5_E"].map(USE_CLASSES).fillna("other")
    return gpd.GeoDataFrame(
        frame,
        geometry=gpd.points_from_xy(frame["LONGITUDE"], frame["LATITUDE"]),
        crs=WGS84,
    ).to_crs(HK80)


def assign_use(buildings: gpd.GeoDataFrame, usage: gpd.GeoDataFrame) -> pd.Series:
    """Give each building the use of the nearest Buildings Department address point."""
    matched = gpd.sjoin_nearest(
        buildings[["geometry"]], usage[["use", "geometry"]],
        how="left", max_distance=MATCH_M, distance_col="match_m",
    )
    # One building can sit near several address points (a block with many entrances); take the first.
    matched = matched[~matched.index.duplicated(keep="first")]
    return matched["use"].reindex(buildings.index)


def refine_uses(buildings: gpd.GeoDataFrame) -> None:
    """Split the Buildings Department's broad classes into what TPDM Annex D charges rates against.

    Three corrections, each of which the district-by-district check against RVD made visible:
      hotels   - registered as Office/Commercial, but RVD's commercial stock excludes them, which is
                 why Tsim Sha Tsui, Central and Wan Chai came out around twice the official figure;
      podiums  - a podium under a residential tower is a mall, so its floor area is retail, not flats;
      office vs shop - the Buildings Department does not separate them, so the combined floor area in
                 each district is split in the ratio RVD publishes for that district.
    """
    names = buildings["BuildingNameEN"].fillna("") + " " + buildings["BuildingNameTC"].fillna("")
    hotels = names.str.contains(HOTEL_NAME, case=False, regex=True, na=False)
    buildings.loc[hotels, "use"] = "hotel"

    podium = buildings["BuildingBlockType"].eq(PODIUM)
    buildings.loc[podium & buildings["use"].eq("residential"), "use"] = "residential_ancillary"

    # Offices and shops, split district by district on the RVD ratio for that district.
    office_stock = rvd_stock("office")
    retail_stock = rvd_stock("commercial")
    combined = buildings["use"].eq("office_commercial")
    for district in HK_DISTRICTS:
        here = combined & buildings["district"].eq(district)
        if not here.any():
            continue
        office, retail = office_stock.get(district, 0.0), retail_stock.get(district, 0.0)
        share = office / (office + retail) if (office + retail) else 0.5
        # Largest buildings first are the offices; the rest are shops. Keeps whole buildings intact.
        order = buildings.loc[here, "gfa_m2"].sort_values(ascending=False)
        target = share * order.sum()
        cutoff = order.cumsum().searchsorted(target) + 1
        buildings.loc[order.index[:cutoff], "use"] = "office"
        buildings.loc[order.index[cutoff:], "use"] = "retail"
    buildings.loc[buildings["use"].eq("office_commercial"), "use"] = "retail"


def mark_homes(buildings: gpd.GeoDataFrame) -> dict:
    """Decide which buildings people live in; return what the name and village-house rules changed."""
    names = (buildings["BuildingNameEN"].fillna("") + " " + buildings["BuildingNameTC"].fillna("")).str.upper()
    facility = names.str.contains(NOT_A_HOME, regex=True) | (
        names.str.contains(PROBABLY_NOT_A_HOME, regex=True) & ~names.str.contains(HOME_NAME, regex=True))
    open_use = buildings["use"].eq("unclassified") & buildings["BuildingBlockType"].eq("Tower")
    block = buildings["storeys"].ge(3) & buildings["footprint_m2"].lt(LARGE_HOME_MAX_M2)
    village = buildings["footprint_m2"].between(*VILLAGE_HOUSE_M2) & buildings["storeys"].ge(2)
    buildings["dwelling"] = buildings["use"].eq("residential") | (open_use & ~facility & (block | village))

    old_rule = buildings["use"].eq("residential") | (open_use & block)
    added = buildings["dwelling"] & ~old_rule
    removed = old_rule & ~buildings["dwelling"]
    return {
        "dwelling_buildings": int(buildings["dwelling"].sum()),
        "dwelling_gfa_m2": round(float(buildings.loc[buildings["dwelling"], "gfa_m2"].sum())),
        "village_houses_added": int(added.sum()),
        "village_gfa_added_m2": round(float(buildings.loc[added, "gfa_m2"].sum())),
        "facilities_removed": int(removed.sum()),
        "facility_gfa_removed_m2": round(float(buildings.loc[removed, "gfa_m2"].sum())),
    }


def hotel_check(buildings: gpd.GeoDataFrame) -> dict:
    """Our hotel floor area against the official room count: a hotel runs 60-70 m2 per room."""
    rows = list(csv.reader(HOTEL_ROOMS.open(encoding="utf-8-sig")))
    year, values = rows[1][0], rows[1][1:]
    rooms = sum(int(v) for v in values if v.strip().isdigit())
    gfa = float(buildings.loc[buildings["use"].eq("hotel"), "gfa_m2"].sum())
    return {"year": year, "official_rooms": rooms, "our_gfa_m2": round(gfa),
            "m2_per_room": round(gfa / rooms, 1) if rooms else None}


def main() -> None:
    zones = gpd.read_file(ZONES).to_crs(HK80)
    districts = gpd.read_file(DISTRICTS).to_crs(HK80)
    # "Yuen Long District" here, "Yuen Long" in the RVD tables.
    districts["district"] = districts["District"].str.replace(" District", "", regex=False).str.strip()
    district_field = "district"
    buildings = load_buildings()
    usage = load_bd_usage()
    print(f"{len(buildings):,} buildings, {len(usage):,} Buildings Department records, "
          f"{len(zones)} zones, {len(districts)} districts")

    buildings["use"] = assign_use(buildings, usage)
    unmatched_gfa = buildings.loc[buildings["use"].isna(), "gfa_m2"].sum()
    buildings["use"] = buildings["use"].fillna("unclassified")
    print(f"   用途已匹配：{(buildings['use'] != 'unclassified').mean():.1%} 的楼宇，"
          f"{1 - unmatched_gfa / buildings['gfa_m2'].sum():.1%} 的楼面面积")

    # Place every building in a zone and a district.
    in_zone = gpd.sjoin(buildings, zones[["zone", "geometry"]], how="left", predicate="within")
    in_zone = in_zone[~in_zone.index.duplicated(keep="first")]
    buildings["zone"] = in_zone["zone"]
    in_district = gpd.sjoin(buildings, districts[[district_field, "geometry"]], how="left", predicate="within")
    in_district = in_district[~in_district.index.duplicated(keep="first")]
    buildings["district"] = in_district[district_field]

    outside = buildings["zone"].isna()
    print(f"   落在小区外的楼宇 {outside.sum():,} 栋（{buildings.loc[outside, 'gfa_m2'].sum() / 1e6:.1f} 百万 m2）")

    refine_uses(buildings)
    homes = mark_homes(buildings)

    keep = ["OBJECTID", "BuildingBlockType", "BuildingNameEN", "BuildingNameTC", "lon", "lat",
            "footprint_m2", "height_m", "storeys", "gfa_m2", "use", "dwelling", "zone", "district"]
    pd.DataFrame(buildings[keep]).to_parquet(CLASSIFIED, index=False)
    print(f"   逐栋分类已存 {CLASSIFIED.relative_to(ROOT)}")

    # --- floor area by zone and use ---------------------------------------------------------
    by_zone = (
        buildings.dropna(subset=["zone"])
        .pivot_table(index="zone", columns="use", values="gfa_m2", aggfunc="sum", fill_value=0.0)
        .rename(columns=lambda c: f"gfa_{c}")
    )
    by_zone["gfa_total"] = by_zone.sum(axis=1)
    by_zone["buildings"] = buildings.dropna(subset=["zone"]).groupby("zone").size()

    zones = zones.merge(by_zone, left_on="zone", right_index=True, how="left")
    gfa_columns = [c for c in zones.columns if c.startswith("gfa_")] + ["buildings"]
    zones[gfa_columns] = zones[gfa_columns].fillna(0).round(0)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    zones.to_crs(WGS84).to_file(OUTPUT, driver="GeoJSON", coordinate_precision=6)

    # --- audit ------------------------------------------------------------------------------
    checks = audit(buildings, zones, unmatched_gfa)
    checks["homes"] = homes
    checks["report"].append(
        f"住宅判定：{homes['dwelling_buildings']:,} 栋、{homes['dwelling_gfa_m2'] / 1e6:,.1f} 百万 m²；"
        f"比旧规则多认村屋 {homes['village_houses_added']:,} 栋（{homes['village_gfa_added_m2'] / 1e6:.1f} 百万 m²），"
        f"按名称剔除设施 {homes['facilities_removed']:,} 栋（{homes['facility_gfa_removed_m2'] / 1e6:.1f} 百万 m²）")
    AUDIT.write_text(json.dumps(checks, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n-> {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size / 1e6:.1f} MB)")
    for line in checks["report"]:
        print("   " + line)


def audit(buildings: gpd.GeoDataFrame, zones: gpd.GeoDataFrame, unmatched_gfa: float) -> dict:
    """The checks in docs/data-audit-checklist.md, run on what was just built."""
    report: list[str] = []
    results: dict = {}

    # 1. Totals against the Rating and Valuation Department, district by district.
    comparisons = {}
    for use, tables in RVD_TABLES.items():
        official = dict.fromkeys(HK_DISTRICTS, 0.0)
        for table in tables:
            stock = rvd_stock(table)
            for district in HK_DISTRICTS:
                official[district] += stock.get(district, 0.0)
        ours = buildings[buildings["use"] == use].groupby("district")["gfa_m2"].sum()
        rows = []
        for district in HK_DISTRICTS:
            area, match = float(ours.get(district, 0.0)), official[district]
            if match == 0:
                continue
            rows.append({"district": district, "ours_gfa_m2": round(area), "rvd_ifa_m2": round(match),
                         "ratio": round(area / match, 2)})
        ratios = [r["ratio"] for r in rows]
        comparisons[use] = {"districts": rows, "median_ratio": round(float(np.median(ratios)), 2) if ratios else None}
        if ratios:
            report.append(
                f"总量比对 {use}: 我们的毛楼面 / RVD 内部楼面 中位 {np.median(ratios):.2f} 倍"
                f"（{len(ratios)} 个区；毛楼面本就大于内部楼面，合理区间约 1.2-1.5）"
            )
    results["totals_vs_rvd"] = comparisons

    hotels = hotel_check(buildings)
    results["hotels_vs_official"] = hotels
    report.append(
        f"总量比对 hotel: 官方 {hotels['year']} 年 {hotels['official_rooms']:,} 间客房，"
        f"我们 {hotels['our_gfa_m2'] / 1e6:.2f} 百万 m2 = 每间 {hotels['m2_per_room']} m2（酒店业常见 60-70）"
    )

    # 2. Spatial coverage.
    with_buildings = (zones["buildings"] > 0).sum()
    results["coverage"] = {"zones": len(zones), "zones_with_buildings": int(with_buildings)}
    report.append(f"空间覆盖：{with_buildings}/{len(zones)} 个小区有建筑物")

    # 3. Missing-value semantics: what "unclassified" means, and how much of it there is.
    share = unmatched_gfa / buildings["gfa_m2"].sum()
    results["unclassified"] = {"gfa_m2": round(unmatched_gfa), "share": round(float(share), 3),
                              "meaning": "未在屋宇署私人楼宇纪录中，主要为公营房屋、学校、医院、政府建筑及乡村屋宇"}
    report.append(f"缺失值语义：{share:.1%} 的楼面面积无用途（非缺漏，是屋宇署只登记私人楼宇）")

    # 4. Granularity.
    biggest = zones.nlargest(1, "gfa_total").iloc[0]
    results["granularity"] = {"largest_zone": str(biggest["zone"]), "gfa_m2": float(biggest["gfa_total"])}
    report.append(f"粒度：单区最大楼面 {biggest['gfa_total'] / 1e6:.1f} 百万 m2（小区 {biggest['zone']}）")

    # 6. Outliers.
    impossible = int((zones["gfa_total"] < 0).sum())
    results["outliers"] = {"negative_zones": impossible}
    report.append(f"异常值：楼面为负的小区 {impossible} 个")

    # 8. Measured vs modelled.
    published = float((buildings["storeys_source"] == "published").mean())
    results["measured_vs_modelled"] = {
        "footprint": "实测（地政总署建筑物图层）",
        "storeys_published_share": round(published, 3),
        "storeys_rest": "按建筑物自身高度推算",
        "use": "实测（屋宇署登记用途），未覆盖部分标为 unclassified",
    }
    report.append(f"实测vs估算：占地与高度为实测；层数 {published:.0%} 为公布值，其余按高度推算")

    results["report"] = report
    results["sources"] = {
        "buildings": "Lands Department, Building (CSDI landsd_rcd_1637211194312_35158)",
        "usage": "Buildings Department, Building information and age records (CSDI)",
        "rvd": "Rating and Valuation Department, stock by district at 2024 year-end",
        "districts": "Home Affairs Department, 18 district boundaries",
    }
    return results


if __name__ == "__main__":
    main()
