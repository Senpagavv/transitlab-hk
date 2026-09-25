"""Build the model's zone system from the 2021 Population Census small zones.

Input : data/raw/census/stpug_2021.geojson
        (C&SD via CSDI: 2021 Population Census, Statistics and Boundaries of Small Tertiary
        Planning Unit Groups - 211 zones, 208 attributes each)
Output: data/web/zones-census.geojson  simplified boundaries + the attributes the model needs
        (pipeline/14 splits these into the ~460 zones the model runs on, written to zones.geojson)
        data/web/zones-meta.json what each field means and where it comes from

Why these zones: TPDM Volume 1 (1.4.5.5) requires traffic zones to be compatible with census
enumeration units so census data can be used directly. The CTS model uses 454 zones; the published
census small-zone groups give 211, which is the finest split that comes with published statistics.

Fields kept (production side of the four-step model, plus what distribution needs):
  people      : population, age bands, working population, students
  households  : count, average size, income bands, public/private housing
  commuting   : where residents work / study (same zone, HK Island, Kowloon, NT, home, outside HK)
Employment by place of work (the attraction side) comes from a separate census table - pipeline/09.

Run from the project root (about a minute):
    uv run python pipeline/08_build_zones.py
"""

import json
from pathlib import Path

import geopandas as gpd

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "raw" / "census" / "stpug_2021.geojson"
OUTPUT = ROOT / "data" / "web" / "zones-census.geojson"
META = ROOT / "data" / "web" / "zones-meta.json"

HK80 = "EPSG:2326"  # metres, for areas
SIMPLIFY_M = 15  # boundaries are for display; the model uses the attributes, not the outline

FIELDS = {
    # id and names
    "stpug": ("zone", "小区编号"),
    "stpug_eng": ("name_en", "小区名称（英文）"),
    "stpug_chi": ("name_zh", "小区名称（中文）"),
    # people
    "t_pop": ("population", "总人口"),
    "age_1": ("age_0_14", "0-14 岁"),
    "age_2": ("age_15_24", "15-24 岁"),
    "age_3": ("age_25_44", "25-44 岁"),
    "age_4": ("age_45_64", "45-64 岁"),
    "age_5": ("age_65_plus", "65 岁及以上"),
    "t_wp": ("workers", "工作人口（按居住地）"),
    "t_lf": ("labour_force", "劳动人口"),
    "nwp_st": ("students", "学生（非工作人口中）"),
    # households
    "dh": ("households", "住户数"),
    "adhz": ("household_size", "平均住户人数"),
    "dh_pub": ("households_public", "公营房屋住户"),
    "dh_pri": ("households_private", "私人房屋住户"),
    # where residents work: the observed commuting pattern, used to calibrate trip distribution
    "plw_same": ("work_same_zone", "在本小区工作"),
    "plw_diff_hk": ("work_hk_island", "在港岛工作"),
    "plw_diff_kln": ("work_kowloon", "在九龙工作"),
    "plw_diff_nt": ("work_nt", "在新界工作"),
    "plw_hm": ("work_at_home", "在家工作"),
    "plw_out": ("work_outside_hk", "在香港以外工作"),
    "plw_nofix": ("work_no_fixed_place", "无固定工作地点"),
    # where residents study
    "pls_same": ("study_same_zone", "在本小区就学"),
    "pls_diff_hk": ("study_hk_island", "在港岛就学"),
    "pls_diff_kln": ("study_kowloon", "在九龙就学"),
    "pls_diff_nt": ("study_nt", "在新界就学"),
}


# Counts where the census prints "-" to mean "none here" (e.g. a zone with no public housing);
# for averages and rates "-" means the figure is not published, which must stay empty.
COUNT_FIELDS = {
    "population", "age_0_14", "age_15_24", "age_25_44", "age_45_64", "age_65_plus", "workers",
    "labour_force", "students", "households", "households_public", "households_private",
    "work_same_zone", "work_hk_island", "work_kowloon", "work_nt", "work_at_home",
    "work_outside_hk", "work_no_fixed_place", "study_same_zone", "study_hk_island",
    "study_kowloon", "study_nt",
}


def number(value, field: str = ""):
    """Census tables use '-' for a zero count, and for figures that are not published."""
    if value in (None, "", "-", "N.A."):
        return 0 if field in COUNT_FIELDS else None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return value
    return int(number) if number.is_integer() else round(number, 2)


def main() -> None:
    zones = gpd.read_file(SOURCE)
    print(f"{len(zones)} census zones, {len(zones.columns) - 1} attributes")

    kept = gpd.GeoDataFrame(
        {new: zones[old].map(lambda v, f=new: number(v, f)) for old, (new, _) in FIELDS.items() if old in zones.columns},
        geometry=zones.geometry,
        crs=zones.crs,
    )

    metric = kept.to_crs(HK80)
    kept["area_km2"] = (metric.area / 1e6).round(3)
    kept["density_per_km2"] = (kept["population"] / kept["area_km2"]).round(0)
    kept.geometry = metric.simplify(SIMPLIFY_M).to_crs(zones.crs)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    kept.to_file(OUTPUT, driver="GeoJSON", coordinate_precision=6)
    META.write_text(
        json.dumps(
            {
                "source": "2021 Population Census, Small Tertiary Planning Unit Groups (C&SD via CSDI)",
                "zones": len(kept),
                "note": "Boundaries simplified to 15 m for display; attributes are unmodified census figures.",
                "fields": {new: label for new, label in FIELDS.values()},
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )

    total_pop = kept["population"].sum()
    total_workers = kept["workers"].sum()
    print(f"-> {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size / 1e6:.1f} MB)")
    print(f"   人口合计 {total_pop:,.0f}（2021 普查全港约 741 万）")
    print(f"   工作人口 {total_workers:,.0f}，住户 {kept['households'].sum():,.0f}，学生 {kept['students'].sum():,.0f}")
    densest = kept.nlargest(3, "density_per_km2")
    for row in densest.itertuples():
        print(f"   最密: {row.name_zh} {row.density_per_km2:,.0f} 人/平方公里（{row.population:,} 人）")


if __name__ == "__main__":
    main()
