"""Build the 2026 land-use table - the one input trip generation reads.

Input : data/web/zones.geojson               455 model zones, 2021 census counts (pipeline/14)
        data/web/zones-census.geojson        the 211 census zones they were split from
        data/web/zones-attraction.geojson    floor area by use (pipeline/10)
        data/web/zones-schools.geojson       school places (pipeline/11)
        data/web/zones-institutions.geojson  tertiary places and hospital floor area (pipeline/12)
        data/raw/projections/table_15.csv    Planning Department, population by TPU group, 2021-2027
        data/raw/projections/table_7.csv     Planning Department, population by district and age, 2021-2031
        data/raw/projections/table_1.csv     Planning Department, population by district, 2021-2031
        data/raw/projections/csd_110-01002.json   Census and Statistics Department, mid-year population by
                                             single year of age (web table 110-01002)
Output: data/model/landuse-2026.parquet      one row per model zone
        data/web/landuse-2026-audit.json

Why 2026: the project's base year is the present (decided 2026-09-16). Floor area, school places
and cross-boundary demand are already current; only the census people are from 2021.

How the population is rolled forward:
  total   - Table 15 gives each of the 211 census zones its own 2021 and 2026 figure. The TPU groups
            in that table are the census zones: 166 carry the same three-digit code, and the 45 merged
            groups ("121, 123 & 124") are the census zone named after their first code plus "S"
            (121S). Every one of the 211 matches the census within 50 people - the table rounds to
            the nearest hundred - which is what confirms the mapping.
  inside  - a census zone's growth is spread over its model zones in proportion to their share of
            it. Those shares came from dwelling floor area in the August 2026 building layer, so a
            zone like 286 (Kai Tak, 42,600 -> 120,800) puts its new residents in the new towers,
            not in the old ones.
  ages    - Hong Kong is ageing faster than it is growing, so age bands are not scaled with the
            total. Each band follows its district's growth from Table 7, relative to the district
            total, and the bands are then made to add up to the zone's 2026 population. A zone
            that straddles two districts takes each in proportion to its homes there.
  district- census zones follow planning units, not District Council boundaries. Districts are
            taken from where each zone's homes stand, which brings all 18 district totals within
            about 1% of Table 1 (placing whole zones by one point left Tsuen Wan 32% short).
  workers - follow the zone's working-age population (15-64), students its school-age population
            (0-24), rather than the total - otherwise an ageing district would be credited with
            more commuters than it has.

  actual  - the projection was made in 2023 and has since run ahead of what happened: +0.8% by mid-2025
            and +1.0% by mid-2026 against the Census and Statistics Department's own estimates (2023:
            -0.5%, 2024: +0.04%). C&SD has published a mid-2026 estimate (provisional), so each age
            band is pulled onto it territory-wide. The projection still decides WHERE people live;
            C&SD decides how many there are and how old.

Assumptions that remain, and are reported as such: household size and where people commute to
are carried forward from 2021 unchanged.

Run from the project root (under a minute):
    uv run python pipeline/16_landuse_2026.py
"""

import json
import re
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "data" / "web"
PROJ = ROOT / "data" / "raw" / "projections"
DISTRICTS = ROOT / "data" / "raw" / "boundaries" / "districts_18.json"
OUTPUT = ROOT / "data" / "model" / "landuse-2026.parquet"
AUDIT = WEB / "landuse-2026-audit.json"
BUILDINGS = ROOT / "data" / "raw" / "buildings" / "buildings-classified.parquet"
CSD_AGES = PROJ / "csd_110-01002.json"
CSD_PERIOD = "202606"  # mid-2026

BASE, TARGET = "2021", "2026"
HK80 = "EPSG:2326"
ROUNDING_SLACK = 50  # Table 15 rounds to the nearest hundred

AGE_BANDS = {
    "age_0_14": ["0 - 4", "5 - 9", "10 - 14"],
    "age_15_24": ["15 - 19", "20 - 24"],
    "age_25_44": ["25 - 29", "30 - 34", "35 - 39", "40 - 44"],
    "age_45_64": ["45 - 49", "50 - 54", "55 - 59", "60 - 64"],
    "age_65_plus": ["65 - 69", "70 - 74", "75 - 79", "80 - 84", ">= 85"],
}
WORKING_AGE = ["age_15_24", "age_25_44", "age_45_64"]
SCHOOL_AGE = ["age_0_14", "age_15_24"]
# Which 2026 driver each census count follows.
FOLLOWS = {
    "population": "population",
    "households": "population", "households_public": "population", "households_private": "population",
    "workers": "working_age", "labour_force": "working_age",
    "work_same_zone": "working_age", "work_hk_island": "working_age", "work_kowloon": "working_age",
    "work_nt": "working_age", "work_at_home": "working_age", "work_outside_hk": "working_age",
    "work_no_fixed_place": "working_age",
    "students": "school_age", "study_same_zone": "school_age", "study_hk_island": "school_age",
    "study_kowloon": "school_age", "study_nt": "school_age",
}
HK_DISTRICTS = [
    "Central and Western", "Wan Chai", "Eastern", "Southern", "Yau Tsim Mong", "Sham Shui Po",
    "Kowloon City", "Wong Tai Sin", "Kwun Tong", "Kwai Tsing", "Tsuen Wan", "Tuen Mun",
    "Yuen Long", "North", "Tai Po", "Sha Tin", "Sai Kung", "Islands",
]


def zone_code(label: str) -> str:
    codes = re.findall(r"\d{3}", label)
    return codes[0] if len(codes) == 1 else codes[0] + "S"


def tpu_projection() -> pd.DataFrame:
    table = pd.read_csv(PROJ / "table_15.csv", dtype=str)
    table.columns = ["area", "tpu"] + list(table.columns[2:])
    table = table.dropna(subset=["tpu"])
    table["zone"] = table["tpu"].map(zone_code)
    if not table["zone"].is_unique:
        raise RuntimeError("Table 15 groups no longer map one-to-one onto census zones")
    for year in (BASE, TARGET):
        table[year] = table[year].str.replace(",", "").astype(float)
    return table.set_index("zone")[["tpu", BASE, TARGET]]


def district_age_growth() -> tuple[pd.DataFrame, dict]:
    """Per district and band: how much faster (or slower) the band grows than the district."""
    table = pd.read_csv(PROJ / "table_7.csv", dtype=str)
    table.columns = ["district_zh", "district", "age"] + list(table.columns[3:])
    table["district"] = table["district"].str.strip()
    table["age"] = table["age"].str.strip()
    for year in (BASE, TARGET):
        table[year] = pd.to_numeric(table[year].str.replace(",", ""), errors="coerce")

    missing = sorted(set(HK_DISTRICTS) - set(table["district"]))
    if missing:
        raise RuntimeError(f"Table 7 no longer lists these districts: {missing}")

    rows, totals = [], {}
    for district in HK_DISTRICTS:
        here = table[table["district"] == district]
        total = here[here["age"].str.contains("All Age", na=False)]
        base_total, target_total = float(total[BASE].iloc[0]), float(total[TARGET].iloc[0])
        totals[district] = {band: {} for band in AGE_BANDS}
        for band, groups in AGE_BANDS.items():
            part = here[here["age"].isin(groups)]
            if len(part) != len(groups):
                raise RuntimeError(f"Table 7: {district} is missing age groups for {band}")
            base, target = float(part[BASE].sum()), float(part[TARGET].sum())
            totals[district][band] = {BASE: base, TARGET: target}
            rows.append({"district": district, "band": band,
                         "relative": (target / base) / (target_total / base_total)})
    return pd.DataFrame(rows).pivot(index="district", columns="band", values="relative"), totals


def district_totals() -> dict[str, float]:
    table = pd.read_csv(PROJ / "table_1.csv", dtype=str)
    table.columns = ["district_zh", "district"] + list(table.columns[2:])
    table["district"] = table["district"].str.strip()
    return {d: float(table.loc[table["district"] == d, TARGET].iloc[0].replace(",", ""))
            for d in HK_DISTRICTS}


def csd_bands() -> tuple[dict[str, float], float]:
    """C&SD's mid-2026 population in the model's age bands, land only, and the whole-territory total."""
    table = pd.DataFrame(json.loads(CSD_AGES.read_text(encoding="utf-8"))["dataSet"])
    rows = table[(table["SEXDesc"] == "Total") & (table["sv"] == "POP") & (table["period"] == CSD_PERIOD)
                 & table["svDesc"].str.contains("Number")]
    if rows.empty:
        raise RuntimeError(f"C&SD table 110-01002 has no {CSD_PERIOD} figures")
    figure = rows.set_index("AGEDesc")["figure"].astype(float) * 1000
    whole = float(figure["Total"])

    def age(label: str) -> int:
        return 85 if label.startswith("≥") else int(label)

    single = figure.drop("Total")
    limits = {"age_0_14": (0, 14), "age_15_24": (15, 24), "age_25_44": (25, 44),
              "age_45_64": (45, 64), "age_65_plus": (65, 200)}
    bands = {band: float(single[[lo <= age(a) <= hi for a in single.index]].sum())
             for band, (lo, hi) in limits.items()}
    if abs(sum(bands.values()) - whole) > 500:  # the table rounds to hundreds
        raise RuntimeError("C&SD single-year ages do not add up to the published total")

    # The projection's land figures leave out the ~1,100 marine population; so must this.
    table1 = pd.read_csv(PROJ / "table_1.csv", dtype=str)
    table1.columns = ["zh", "en"] + list(table1.columns[2:])
    land = float(table1.loc[table1["en"].str.strip() == "Land Total", TARGET].iloc[0].replace(",", ""))
    territory = float(table1.loc[table1["en"].str.strip() == "Whole Territory", TARGET].iloc[0].replace(",", ""))
    return {band: value * land / territory for band, value in bands.items()}, whole


def calibrate(targets: pd.DataFrame, actual: dict[str, float]) -> pd.DataFrame:
    """Pull every age band onto C&SD's estimate; the counts that follow a band move with it."""
    before = targets.copy()
    for band in AGE_BANDS:
        targets[band] = targets[band] * actual[band] / targets[band].sum()
    targets["population"] = targets[list(AGE_BANDS)].sum(axis=1)
    ratios = {
        "population": targets["population"] / before["population"],
        "working_age": targets[WORKING_AGE].sum(axis=1) / before[WORKING_AGE].sum(axis=1),
        "school_age": targets[SCHOOL_AGE].sum(axis=1) / before[SCHOOL_AGE].sum(axis=1),
    }
    for field, driver in FOLLOWS.items():
        if field != "population":
            targets[field] = targets[field] * ratios[driver].replace([np.inf, -np.inf], np.nan).fillna(1.0)
    return targets


def largest_remainder(total: float, weights: np.ndarray) -> np.ndarray:
    """Split an integer count by weight so that the parts add back to exactly the whole."""
    total = int(round(total))
    if total <= 0 or weights.sum() <= 0:
        return np.zeros(len(weights), dtype=int)
    exact = weights / weights.sum() * total
    whole = np.floor(exact).astype(int)
    short = total - whole.sum()
    if short > 0:
        whole[np.argsort(-(exact - whole))[:short]] += 1
    return whole


def district_shares(model: gpd.GeoDataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """How each zone's housing is split between districts, by dwelling floor area.

    Census zones follow planning units, not District Council boundaries, and some straddle two
    districts. Placing a whole zone by a single representative point sent Tsuen Wan's hillside zones
    to Kwai Tsing and Kwun Tong's to Sai Kung (Tsuen Wan came out 32% short). Buildings are points
    with exact positions, so the split is taken from where the homes actually are.
    """
    buildings = pd.read_parquet(BUILDINGS)
    homes = buildings[buildings["dwelling"]].dropna(subset=["zone", "district"])
    by_model = homes.pivot_table(index="zone", columns="district", values="gfa_m2", aggfunc="sum", fill_value=0.0)
    by_model = by_model.reindex(model["zone"]).fillna(0.0)
    census_of = model.set_index("zone")["census_zone"]
    by_census = by_model.groupby(census_of).sum()
    normalise = lambda frame: frame.div(frame.sum(axis=1).replace(0, np.nan), axis=0).fillna(0.0)
    return normalise(by_model), normalise(by_census)


def roll_forward(census: gpd.GeoDataFrame, projection: pd.DataFrame,
                 relative: pd.DataFrame, shares: pd.DataFrame) -> pd.DataFrame:
    """2026 figures for each of the 211 census zones."""
    out = []
    for zone in census.itertuples():
        growth = projection.loc[zone.zone, TARGET] / projection.loc[zone.zone, BASE]
        share = shares.loc[zone.zone] if zone.zone in shares.index else pd.Series(dtype=float)
        share = share[share > 0]
        district = share.idxmax() if len(share) else None
        population = float(zone.population) * growth

        # A zone spanning two districts takes each district's ageing in proportion to its homes there.
        age_shift = {b: float((share * relative.loc[share.index, b]).sum()) if len(share) else 1.0
                     for b in AGE_BANDS}
        bands = np.array([float(getattr(zone, b)) * growth * age_shift[b] for b in AGE_BANDS])
        bands = bands / bands.sum() * population if bands.sum() else bands
        row = {"zone": zone.zone, "district": district, "growth": growth, "population": population}
        row.update(dict(zip(AGE_BANDS, bands)))

        working_2021 = sum(float(getattr(zone, b)) for b in WORKING_AGE)
        school_2021 = sum(float(getattr(zone, b)) for b in SCHOOL_AGE)
        drivers = {
            "population": growth,
            "working_age": (sum(row[b] for b in WORKING_AGE) / working_2021) if working_2021 else growth,
            "school_age": (sum(row[b] for b in SCHOOL_AGE) / school_2021) if school_2021 else growth,
        }
        for field, driver in FOLLOWS.items():
            if field != "population":
                row[field] = float(getattr(zone, field)) * drivers[driver]
        out.append(row)
    return pd.DataFrame(out).set_index("zone")


def spread(model: gpd.GeoDataFrame, targets: pd.DataFrame) -> pd.DataFrame:
    """Share each census zone's 2026 figures over its model zones, keeping totals exact."""
    fields = ["population", *AGE_BANDS, *[f for f in FOLLOWS if f != "population"]]
    result = pd.DataFrame(index=model.index, columns=fields, dtype=float)
    for census_zone, parts in model.groupby("census_zone"):
        for field in fields:
            weights = parts[field].to_numpy(dtype=float)
            if weights.sum() <= 0:
                weights = parts["population"].to_numpy(dtype=float)
            result.loc[parts.index, field] = largest_remainder(targets.loc[census_zone, field], weights)
    return result.astype(int)


def main() -> None:
    model = gpd.read_file(WEB / "zones.geojson")
    census = gpd.read_file(WEB / "zones-census.geojson")
    projection = tpu_projection()
    relative, age_totals = district_age_growth()
    model_shares, census_shares = district_shares(model)

    # Mapping check before anything is built on it.
    joined = census.set_index("zone")[["population"]].join(projection, how="outer")
    unmatched = joined[joined["tpu"].isna() | joined["population"].isna()]
    worst = float((joined[BASE] - joined["population"]).abs().max())
    if len(unmatched) or worst > ROUNDING_SLACK:
        raise RuntimeError(f"Table 15 does not line up with the census zones "
                           f"({len(unmatched)} unmatched, worst gap {worst:.0f})")

    targets = roll_forward(census, projection, relative, census_shares)
    projected = targets.copy()
    actual_bands, csd_whole = csd_bands()
    targets = calibrate(targets, actual_bands)
    model = model.set_index("zone")
    rolled = spread(model, targets)

    table = pd.DataFrame(index=model.index)
    table["census_zone"] = model["census_zone"]
    dominant = model_shares.replace(0, np.nan).idxmax(axis=1)
    table["district"] = dominant.reindex(model.index)
    table["population_2021"] = model["population"]
    for field in rolled.columns:
        table[field] = rolled[field]
    table["household_size"] = (table["population"] / table["households"].replace(0, np.nan)).round(2)
    table["area_km2"] = model["area_km2"]
    table["centroid_lon"] = model["centroid_lon"]
    table["centroid_lat"] = model["centroid_lat"]

    # The attraction side is already current (buildings August 2026, schools 2025/26).
    for name, prefix in (("zones-attraction", "gfa_"), ("zones-schools", "places_"),
                         ("zones-institutions", ("gfa_", "places_"))):
        layer = gpd.read_file(WEB / f"{name}.geojson").set_index("zone")
        columns = [c for c in layer.columns if c.startswith(prefix) and c not in table.columns]
        table = table.join(layer[columns].astype(float))
        if "schools" in layer.columns and "schools" not in table.columns:
            table["schools"] = layer["schools"].astype(int)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    table.reset_index().to_parquet(OUTPUT, index=False)

    # --- audit (docs/data-audit-checklist.md) -------------------------------------------------
    report = []
    land_total = float(pd.read_csv(PROJ / "table_15.csv", dtype=str).iloc[-1, -2].replace(",", ""))
    ours = int(table["population"].sum())
    target_total = sum(actual_bands.values())
    gap = abs(ours - target_total) / target_total
    report.append(f"总量比对：2026 人口 {ours:,} vs 统计处 2026 年中估计（临时数，扣除水上人口）"
                  f"{target_total:,.0f}（差 {gap:.2%}）" + ("" if gap < 0.001 else "  ← 超出范围，需复核"))
    report.append(f"推算回测：规划署 2026 推算（陆上 {land_total:,.0f}）比统计处实际高 "
                  f"{land_total / target_total - 1:+.2%}，已按统计处校准；规划署只决定人住在哪里")

    official = district_totals()
    # Each zone's people are counted in each district in proportion to its homes there. After the
    # calibration the totals differ from Table 1 by design, so districts are compared as shares.
    by_district = model_shares.reindex(table.index).fillna(0.0).mul(table["population"], axis=0).sum()
    by_district = by_district / by_district.sum() * sum(official.values())
    worst_d = max(HK_DISTRICTS, key=lambda d: abs(by_district.get(d, 0) - official[d]) / official[d])
    worst_gap = abs(by_district.get(worst_d, 0) - official[worst_d]) / official[worst_d]
    report.append(f"分区比对（按占全港比例）：18 区对规划署表 1，最大偏差 {worst_d} {worst_gap:.2%}"
                  + ("" if worst_gap < 0.02 else "  ← 超出范围，需复核"))

    elderly = float(table["age_65_plus"].sum())
    elderly_official = actual_bands["age_65_plus"]
    elderly_projected = sum(age_totals[d]["age_65_plus"][TARGET] for d in HK_DISTRICTS)
    e_gap = abs(elderly - elderly_official) / elderly_official
    report.append(f"老龄化：2026 年 65 岁以上 {elderly:,.0f} vs 统计处 {elderly_official:,.0f}（差 {e_gap:.1%}；"
                  f"规划署当年推算 {elderly_projected:,.0f}）；"
                  f"占比 {table['age_65_plus'].sum() / ours:.1%}（2021 为 "
                  f"{model['age_65_plus'].sum() / model['population'].sum():.1%}）"
                  + ("" if e_gap < 0.03 else "  ← 超出范围，需复核"))

    workers_2021 = int(model["workers"].sum())
    report.append(f"工作人口：{workers_2021:,} → {int(table['workers'].sum()):,}"
                  f"（跟随 15-64 岁人口，总人口 +{ours / model['population'].sum() - 1:.1%}）")

    exact = all(abs(table[f].sum() - targets[f].sum()) <= len(targets) for f in rolled.columns)
    report.append("守恒：每个普查小区的 2026 数值拆到模型小区后逐字段合计不变" if exact
                  else "守恒：拆分后合计有出入  ← 需复核")

    # Does the 2026 population sit where the 2026 buildings are? It should, better than 2021 did.
    buildings = pd.read_parquet(BUILDINGS)
    dwelling = buildings[buildings["dwelling"]].groupby("zone")["gfa_m2"].sum()
    fit = pd.DataFrame({"gfa": dwelling, "p2021": model["population"], "p2026": table["population"]}).dropna()
    r2021 = float(np.corrcoef(fit["gfa"], fit["p2021"])[0, 1])
    r2026 = float(np.corrcoef(fit["gfa"], fit["p2026"])[0, 1])
    report.append(f"自洽：住宅楼面(2026-08)与人口的相关系数 2021 {r2021:.3f} → 2026 {r2026:.3f}"
                  + ("（同期数据更吻合，基准年选择一致）" if r2026 >= r2021 else "  ← 2026 反而更差，需复核"))

    named = buildings.dropna(subset=["BuildingNameEN"]).sort_values("gfa_m2", ascending=False)
    growth = targets.sort_values("growth", ascending=False).head(5)
    lines = []
    for zone, row in growth.iterrows():
        inside = named[named["zone"].isin(model.index[model["census_zone"] == zone])]
        hint = ", ".join(inside["BuildingNameEN"].head(2).str.title())
        lines.append(f"{zone}（{row['district']}，×{row['growth']:.2f}：{hint or '无命名建筑'}）")
    report.append("增长热点（带最大的命名建筑，便于核实）：" + "；".join(lines))

    report.append("缺失值语义：零人口的模型小区保持零；学额/楼面缺失按零处理（该小区确无此类设施）")
    report.append("实测vs估算：2026 全港及各年龄段总数为统计处年中估计（临时数）；各小区分布依规划署推算与住宅楼面估算；"
                  "户均人数与通勤去向沿用 2021 普查，属假设")

    AUDIT.write_text(json.dumps({
        "sources": {
            "projection": "Planning Department, Projections of Population Distribution 2023-2031, Tables 1, 7, 15",
            "census": "2021 Population Census via pipeline/08 and pipeline/14",
        },
        "base_year": BASE, "target_year": TARGET,
        "population_2026": ours, "planning_department_land_total": land_total,
        "csd_mid_2026_whole_territory": csd_whole, "csd_status": "provisional",
        "projection_before_calibration": int(round(projected["population"].sum())),
        "report": report,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"-> {OUTPUT.relative_to(ROOT)}  {len(table)} 个小区 × {len(table.columns)} 个字段")
    for line in report:
        print("   " + line)


if __name__ == "__main__":
    main()
