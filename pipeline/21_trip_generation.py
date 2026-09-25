"""Step 1 of the four-step model: the trips each zone sends and receives on a weekday in 2026.

Input : data/model/landuse-2026.parquet          455 zones: people, floor area, school places (pipeline/16)
        data/web/zones-attraction.geojson        the same zones' 2021 census counts (pipeline/10)
        data/raw/projections/table_15.csv        Planning Department, population by TPU group, 2021-2027
        data/model/parameters-tcs2022.json       TCS 2022, with its appendix Tables A.1 and A.2 (pipeline/20)
        data/raw/tpedm/tpedm-2021-based.geojson  Planning Department, Territorial Population and Employment
                                                 Data Matrix (2021-based): employment by district, 2021 and 2026
        data/web/cross-boundary.json             weekday crossings by control point (pipeline/13)
        data/raw/buildings/buildings-classified.parquet
Output: data/model/trip-ends-2026.parquet        productions and attractions by purpose for every zone,
                                                 plus one external zone per boundary control point
        data/model/building-trip-ends.parquet    the same trip ends spread over buildings; pipeline/15
                                                 places each zone's centre with it
        data/web/trip-generation-audit.json

Scope: mechanised trips, i.e. everything but trips made wholly on foot or by bicycle, because that is
what TCS 2022 counts (walk-only and cycling totals are not published: too under-reported to expand).
Walking and cycling are added at mode choice, as estimates (decided 2026-09-17).

The survey is the calibration. TCS 2022 Table A.2 gives trip productions and attractions for each of
26 "broad districts", and every number here is tied to it:

  where    - zones are assigned to broad districts from Figure A.1: District Council districts, with
             Yau Tsim Mong, Kwai Tsing and the New Territories districts split into new towns and
             "other areas" by census zone. The assignment is checked by population, district by district,
             against the survey's own Table A.1 (and it corrected the first guesses - see broad_district()).
  produce  - each district's own survey rates: trips per resident worker (HBW), student (HBS) and
             person (HBO), applied to 2026 counts. The survey defines workers and students differently
             from the census counts this model carries - by a steady factor, checked district by
             district - so each purpose's rates are moved onto this model's counts by one
             territory-wide factor.
  attract  - how a district's attractions spread over its zones is estimated from Hong Kong's data,
             not borrowed: non-negative least squares of each district's attractions on its floor area
             by use, school places and people (26 districts). Jobs are estimated the same way from the
             Planning Department's employment by district (18 districts), which replaces the unsourced
             floor space per job used so far. Each district's attractions are then scaled to Table A.2
             exactly, so the regression decides only the split within a district.
  grow     - 2022 to 2026: productions follow each zone's own workers, students and people; job
             attractions follow the Planning Department's district employment trend; the rest follow
             each zone's weights. Attractions are finally scaled to productions, purpose by purpose.

TCS 2022 was surveyed while the boundary was closed (it reopened in February 2023), so crossings are
missing from it and are added as three extra purposes, each control point an external zone:
  CBS  cross-boundary students (Education Bureau), twice a day, to school places of their level;
  CBR  other Hong Kong residents crossing (Immigration), to and from homes;
  CBV  visitors (Immigration), to and from shops and hotels.

Assumptions, reported as such: crossing residents live in Hong Kong; visitors go where retail and hotel
floor area is; the employment projection's 2021-2026 district trend (Yuen Long +56%) has happened.

Run from the project root (under a minute):
    uv run python pipeline/21_trip_generation.py
"""

import json
import re
from pathlib import Path

import geopandas as gpd
import httpx
import numpy as np
import pandas as pd
from scipy.optimize import nnls

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "data" / "model"
WEB = ROOT / "data" / "web"
LANDUSE = MODEL / "landuse-2026.parquet"
CENSUS_2021 = WEB / "zones-attraction.geojson"
TABLE_15 = ROOT / "data" / "raw" / "projections" / "table_15.csv"
PARAMETERS = MODEL / "parameters-tcs2022.json"
TPEDM = ROOT / "data" / "raw" / "tpedm" / "tpedm-2021-based.geojson"
CROSS_BOUNDARY = WEB / "cross-boundary.json"
BUILDINGS = ROOT / "data" / "raw" / "buildings" / "buildings-classified.parquet"
OUTPUT = MODEL / "trip-ends-2026.parquet"
BUILDING_OUTPUT = MODEL / "building-trip-ends.parquet"
AUDIT = WEB / "trip-generation-audit.json"

WGS84, HK80 = "EPSG:4326", "EPSG:2326"
CENSUS_YEAR, SURVEY_YEAR, BASE_YEAR = 2021, 2022, 2026
PURPOSES = ["HBW", "HBS", "HBO", "NHB"]  # NHB is the survey's "NHB + EB"
CROSSING = ["CBS", "CBR", "CBV"]

# Figure A.1 of the TCS 2022 appendix. The first reading of the map was corrected by Table A.1's
# populations: Olympian City (254) belongs to Sham Shui Po (without it Sham Shui Po came out 4% over
# and Yau Tsim Mong 7% under), Ma Wan (975) to North Lantau and Discovery Bay to the other areas
# (Tsuen Wan 6% under, the south-west other areas 20% over), Queen's Hill (634) to the north-east
# other areas rather than Fanling (18% over), and the Sai Kung part of Lam Tin (293S) to Kwun Tong.
SAME_NAME = {
    "Central and Western": "Central & Western", "Wan Chai": "Wan Chai", "Eastern": "Eastern",
    "Southern": "Southern", "Sham Shui Po": "Sham Shui Po", "Kowloon City": "Kowloon City",
    "Kwun Tong": "Kwun Tong", "Wong Tai Sin": "Wong Tai Sin",
}
MONG_KOK = {"221", "222", "227", "229"}
TSING_YI = {"350", "351"}
TIN_SHUI_WAI = {"510", "514"}
YUEN_LONG_TOWN = {"524", "525", "526", "527", "528", "529"}
FANLING = {"624S", "625", "626", "627", "628"}
TAI_PO_TOWN = {"722S", "723", "725", "726", "729"}
TSEUNG_KWAN_O = {"833", "835", "836", "837", "838", "839"}
POPULATION_TOLERANCE = 0.08  # survey household population against this model's 2022 population
RATE_CONSISTENCY = 0.15  # a district's own count against the survey's, after the definition factor
# Differences that were traced to their cause. Queen's Hill (census zone 634) filled up during 2022:
# Table 15 has it at 18,500 people in 2021 and 46,500 in 2022. Without it, this model's north-east
# has 31% fewer people than the survey; with it, 8% more - so the survey counted about 37,000 of its
# people, four in five. Young families moved in first, so students are further apart (+20%) than
# people. The rates used are the survey's and the counts this model's 2026 ones, so the difference
# stays in this check and does not reach the output.
EXPLAINED = {"NENT": "皇后山 2022 年入伙，调查只计入约八成居民（已核实）"}

FLOOR = ["gfa_office", "gfa_retail", "gfa_industrial", "gfa_hotel", "gfa_other", "gfa_unclassified",
         "gfa_residential_ancillary"]
INSTITUTIONS = ["places_school", "places_tertiary", "gfa_hospital"]
# What each district-level regression may use. Everything is offered; the fit keeps what Hong Kong's
# districts support and sets the rest to zero.
EXPLAIN = {
    "HBS_att": ["places_school", "places_tertiary"],
    "HBO_att": FLOOR + INSTITUTIONS + ["population"],
    "NHB_att": FLOOR + ["population"],
    "NHB_prod": FLOOR + ["population"],
    "jobs": FLOOR + INSTITUTIONS + ["population"],
}
BUILDING_USE = {  # floor-area variable -> the building use it was summed from (pipeline/10)
    "gfa_office": "office", "gfa_retail": "retail", "gfa_industrial": "industrial", "gfa_hotel": "hotel",
    "gfa_other": "other", "gfa_unclassified": "unclassified", "gfa_residential_ancillary": "residential_ancillary",
}
SQM_PER_JOB_RANGE = {"gfa_office": (10, 60), "gfa_retail": (10, 80), "gfa_hotel": (15, 150)}
MIN_FIT = 0.7  # R-squared below this is reported for review
CROSSING_LEVELS = {"Kindergarten": "places_kindergarten", "Primary": "places_primary", "Secondary": "places_secondary"}
STUDENT_LEVELS = "https://www.edb.gov.hk/attachment/datagovhk/Number_of_cross_boundary_students_land_en.csv"
STUDENT_LEVELS_RAW = ROOT / "data" / "raw" / "cross-boundary" / "students-by-point-and-level.csv"
HEADERS = {"User-Agent": "TransitLabHK/0.1 (student hackathon prototype)"}


def broad_district(district: str, census_zone: str) -> str:
    if district in SAME_NAME:
        return SAME_NAME[district]
    if district == "Yau Tsim Mong":
        if census_zone == "254":
            return "Sham Shui Po"
        return "Mong Kok" if census_zone in MONG_KOK else "Yau Ma Tei"
    if district == "Kwai Tsing":
        return "Tsing Yi" if census_zone in TSING_YI else "Kwai Chung"
    if district == "Tsuen Wan":
        return "North Lantau" if census_zone == "975" else "Tsuen Wan"
    if district == "Tuen Mun":
        return "NWNT" if census_zone in {"441", "442"} else "Tuen Mun"
    if district == "Yuen Long":
        if census_zone in TIN_SHUI_WAI:
            return "Tin Shui Wai"
        return "Yuen Long" if census_zone in YUEN_LONG_TOWN else "NWNT"
    if district == "North":  # Yuen Long's planning units that reach into North district are NWNT
        if census_zone.startswith("5"):
            return "NWNT"
        return "Fanling/Sheung Shui" if census_zone in FANLING else "NENT"
    if district == "Tai Po":
        if census_zone == "757":
            return "Ma On Shan"
        return "Tai Po" if census_zone in TAI_PO_TOWN else "NENT"
    if district == "Sha Tin":
        return "Ma On Shan" if census_zone == "757" else "Sha Tin"
    if district == "Sai Kung":
        if census_zone.startswith("2"):
            return "Kwun Tong"
        return "Tseung Kwan O" if census_zone in TSEUNG_KWAN_O else "SENT"
    if district == "Islands":
        return "North Lantau" if census_zone == "950S" else "SWNT"
    raise ValueError(f"no broad district rule for {district}")


def zone_code(label: str) -> str:
    codes = re.findall(r"\d{3}", label)
    return codes[0] if len(codes) == 1 else codes[0] + "S"


def load_zones() -> pd.DataFrame:
    """Each zone's people in the census, survey and base years, and what it contains."""
    zones = pd.read_parquet(LANDUSE).set_index("zone")
    census = gpd.read_file(CENSUS_2021).set_index("zone")
    table = pd.read_csv(TABLE_15, dtype=str)
    table.columns = ["area", "tpu"] + list(table.columns[2:])
    table = table.dropna(subset=["tpu"])
    table.index = table["tpu"].map(zone_code)
    counts = {year: table[year].str.replace(",", "").astype(float) for year in (str(CENSUS_YEAR), str(SURVEY_YEAR))}
    growth = counts[str(SURVEY_YEAR)] / counts[str(CENSUS_YEAR)]
    if zones["census_zone"].map(growth).isna().any():
        raise RuntimeError("census zones missing from Table 15")

    zones["broad"] = [broad_district(d, c) for d, c in zip(zones["district"], zones["census_zone"])]
    zones["population_2022"] = zones["population_2021"] * zones["census_zone"].map(growth)
    # Workers and students are only known for 2021 (census) and 2026 (pipeline/16). In 2022 their
    # number follows that year's population - a straight line from 2021 to 2026 missed Queen's Hill,
    # whose people arrived in 2022, and gave the north-east 20% too many work trips per worker - while
    # their share of the population moves steadily between the two years.
    step = (SURVEY_YEAR - CENSUS_YEAR) / (BASE_YEAR - CENSUS_YEAR)
    for field in ("workers", "students"):
        before = census[field].reindex(zones.index).astype(float)
        share_2021 = before / zones["population_2021"].replace(0, np.nan)
        share_2026 = zones[field] / zones["population"].replace(0, np.nan)
        share_2022 = share_2021 * (share_2026 / share_2021) ** step
        straight = before + (zones[field] - before) * step
        zones[f"{field}_2022"] = (share_2022 * zones["population_2022"]).where(
            share_2021.gt(0) & share_2026.gt(0), straight)
    zones["places_school"] = zones[["places_kindergarten", "places_primary", "places_secondary",
                                    "places_special"]].sum(axis=1)
    return zones


def check_districts(zones: pd.DataFrame, survey: pd.DataFrame, report: list[str], flags: list[str]) -> dict:
    """The zone-to-district assignment, tested against the survey's own household population."""
    modelled = zones.groupby("broad")["population_2022"].sum()
    missing = set(survey.index) ^ set(modelled.index)
    if missing:
        raise RuntimeError(f"broad districts without a match: {missing}")
    ratio = survey["population"] / modelled.reindex(survey.index)
    off = ratio[(ratio - 1).abs() > POPULATION_TOLERANCE]
    report.append(f"大区划分：26 个大区全部对上；调查住户人口 ÷ 本模型 2022 年人口 {ratio.min():.3f}–{ratio.max():.3f}"
                  f"（容许 ±{POPULATION_TOLERANCE:.0%}）"
                  + ("" if off.empty else f"；超出：{off.round(3).to_dict()}  ← 需复核"))
    if not off.empty:
        flags.append("broad districts")
    return ratio.round(4).to_dict()


def productions(zones: pd.DataFrame, survey: pd.DataFrame, report: list[str], flags: list[str]) -> dict:
    """Home-based productions: each district's 2022 trips per unit, applied to 2026 units."""
    rates = {}
    for purpose, field in {"HBW": "workers", "HBS": "students", "HBO": "population"}.items():
        base_2026 = zones["population"] if field == "population" else zones[field]
        ours = zones.groupby("broad")[f"{field}_2022"].sum().reindex(survey.index)
        # The survey's rates are behaviour and are kept district by district. Its worker and student
        # counts are defined differently from the census ones, by a steady factor, so the rates are
        # moved onto this model's counts by one territory-wide factor - not district by district,
        # which would turn timing differences (Queen's Hill filling up during the survey) into
        # differences in behaviour.
        definition = survey[field].sum() / ours.sum()
        per_unit = survey[f"{purpose}_prod"] / survey[field] * definition
        zones[f"P_{purpose}"] = zones["broad"].map(per_unit) * base_2026
        rates[purpose] = {"per_unit": per_unit.round(4).to_dict(), "definition_factor": round(definition, 4)}

        # Check: a district whose own count differs from the survey's by much more than the factor
        # is a counting or assignment error on one side.
        relative = (ours / survey[field]) * definition - 1
        beyond = relative[relative.abs() > RATE_CONSISTENCY]
        known = {d: v for d, v in beyond.items() if d in EXPLAINED}
        odd = beyond.drop(list(known))
        report.append(f"产生 {purpose}：调查分区出行率 × 口径系数 {definition:.3f}"
                      f"（本模型{ {'workers': '就业者', 'students': '学生', 'population': '人口'}[field] }与调查定义之比）；"
                      f"2022 各区合计与调查相差 {relative.min():+.1%} 至 {relative.max():+.1%}"
                      + "".join(f"；{d} {v:+.1%}：{EXPLAINED[d]}" for d, v in known.items())
                      + ("" if odd.empty else f"；超过 ±{RATE_CONSISTENCY:.0%}：{odd.round(3).to_dict()}  ← 需复核"))
        if not odd.empty:
            flags.append(f"{purpose} bases")
        report.append(f"产生 {purpose}（每{ {'workers': '名就业者', 'students': '名学生', 'population': '人'}[field] }）："
                      f"各区 {per_unit.min():.2f}–{per_unit.max():.2f}；2022 合计 {survey[f'{purpose}_prod'].sum():,.0f} → "
                      f"2026 {zones[f'P_{purpose}'].sum():,.0f}（{zones[f'P_{purpose}'].sum() / survey[f'{purpose}_prod'].sum() - 1:+.1%}）")
    return rates


def design(zones: pd.DataFrame, population: str) -> pd.DataFrame:
    return zones[FLOOR + INSTITUTIONS].fillna(0.0).assign(population=zones[population])


def fit(frame: pd.DataFrame, target: pd.Series, columns: list[str]) -> tuple[pd.Series, float, pd.Series]:
    """Non-negative least squares on district totals; columns are scaled so none dominates the solver."""
    x = frame[columns].to_numpy(dtype=float)
    y = target.reindex(frame.index).to_numpy(dtype=float)
    scale = x.max(axis=0)
    scale[scale == 0] = 1.0
    solution, _ = nnls(x / scale, y)
    coef = pd.Series(solution / scale, index=columns)
    predicted = x @ coef.to_numpy()
    r2 = 1 - ((y - predicted) ** 2).sum() / ((y - y.mean()) ** 2).sum()
    return coef, float(r2), pd.Series(predicted / y, index=frame.index)


def describe(coef: pd.Series) -> str:
    kept = coef[coef > 0]
    return "、".join(f"{name.replace('gfa_', '').replace('places_', '')} {value:.3g}" for name, value in kept.items())


def jobs(zones: pd.DataFrame, report: list[str], flags: list[str]) -> tuple[pd.Series, dict]:
    """Jobs per zone in 2026, from the Planning Department's employment by district."""
    matrix = gpd.read_file(TPEDM)
    employment = matrix.assign(district=matrix["Name_Eng"].replace({"Central & Western": "Central and Western"}))
    employment = employment.set_index("district")[["Y2021_Empl", "Y2026_Empl"]].astype(float)
    if set(employment.index) != set(zones["district"]):
        raise RuntimeError("employment districts do not match the zones' districts")

    by_district = design(zones, "population_2021").groupby(zones["district"]).sum()
    coef, r2, ratio = fit(by_district, employment["Y2021_Empl"], EXPLAIN["jobs"])
    per_job = {name: 1 / value for name, value in coef.items() if value > 0 and name in FLOOR}
    odd = {name: round(value, 1) for name, value in per_job.items()
           if name in SQM_PER_JOB_RANGE and not SQM_PER_JOB_RANGE[name][0] <= value <= SQM_PER_JOB_RANGE[name][1]}
    report.append(f"岗位（规划署 18 区 2021 年就业回归，R² {r2:.3f}）：每个岗位占楼面 "
                  + "、".join(f"{k.replace('gfa_', '')} {v:.0f} m²" for k, v in per_job.items())
                  + f"；另每名居民 {coef['population']:.3f} 个在家附近的岗位（学校、诊所、屋苑服务、家务等）"
                  + ("" if not odd else f"；超出常见范围 {odd}  ← 需复核"))
    if odd or r2 < MIN_FIT:
        flags.append("jobs")

    index = design(zones, "population") @ coef
    scale = employment["Y2026_Empl"] / index.groupby(zones["district"]).sum()
    estimate = index * zones["district"].map(scale)
    fixed = zones["workers"].sum() - zones["work_at_home"].sum() - zones["work_no_fixed_place"].sum() \
        - zones["work_outside_hk"].sum()
    trend = employment["Y2026_Empl"] / employment["Y2021_Empl"] - 1
    report.append(f"岗位 2026：按规划署分区推算 {estimate.sum():,.0f}（2021 年 {employment['Y2021_Empl'].sum():,.0f}）；"
                  f"本模型有固定工作地点的就业居民 {fixed:,.0f}；增长最快的区 "
                  + "、".join(f"{d} {v:+.0%}" for d, v in trend.sort_values(ascending=False).head(3).items())
                  + "（规划推算，实际可能尚未达到）")
    return estimate, {"coefficients": coef.round(6).to_dict(), "r2": round(r2, 4),
                      "sqm_per_job": {k: round(v, 1) for k, v in per_job.items()},
                      "predicted_over_observed": ratio.round(3).to_dict(),
                      "district_trend_2021_2026": trend.round(4).to_dict()}


def attractions(zones: pd.DataFrame, survey: pd.DataFrame, job_estimate: pd.Series,
                report: list[str], flags: list[str]) -> dict:
    """Spread each district's 2022 attractions over its zones, grow them to 2026, balance to productions."""
    fits = {}
    before = design(zones, "population_2022")
    after = design(zones, "population")
    districts = before.groupby(zones["broad"]).sum()

    weights = {}
    for target in ("HBS_att", "HBO_att", "NHB_att", "NHB_prod"):
        columns = EXPLAIN[target]
        coef, r2, ratio = fit(districts, survey[target], columns)
        weights[target] = (before[columns] @ coef, after[columns] @ coef, coef)
        worst = ratio.sort_values()
        fits[target] = {"coefficients": coef.round(6).to_dict(), "r2": round(r2, 4),
                        "predicted_over_observed": ratio.round(3).to_dict()}
        report.append(f"吸引权重 {target}（26 区回归，R² {r2:.3f}）：{describe(coef)}；偏差最大 "
                      f"{worst.index[0]} {worst.iloc[0]:.2f}、{worst.index[-1]} {worst.iloc[-1]:.2f}"
                      + ("（只决定区内分配，区总量取调查值）" if r2 >= MIN_FIT else "  ← 需复核"))
        if r2 < MIN_FIT:
            flags.append(target)

    # Jobs: the 2022 level is the 2026 estimate taken back along its district's trend.
    matrix = gpd.read_file(TPEDM).assign(district=lambda f: f["Name_Eng"].replace({"Central & Western": "Central and Western"}))
    growth = matrix.set_index("district")["Y2026_Empl"] / matrix.set_index("district")["Y2021_Empl"]
    back = zones["district"].map(growth) ** ((BASE_YEAR - SURVEY_YEAR) / (BASE_YEAR - CENSUS_YEAR))
    weights["HBW_att"] = (job_estimate / back, job_estimate, None)

    for target, (w_2022, w_2026, _) in weights.items():
        total_2022 = w_2022.groupby(zones["broad"]).sum()
        empty = survey[target][(total_2022.reindex(survey.index) <= 0) & (survey[target] > 0)]
        if not empty.empty:
            raise RuntimeError(f"{target}: districts with trips but no weight: {list(empty.index)}")
        per_weight = survey[target] / total_2022.reindex(survey.index)
        column = ("P_" if target.endswith("prod") else "A_") + target.split("_")[0]
        zones[column] = zones["broad"].map(per_weight) * w_2026

    # NHB trips are made by the population at large; the survey's total grows with it.
    nhb_total = survey["NHB_prod"].sum() * zones["population"].sum() / zones["population_2022"].sum()
    zones["P_NHB"] *= nhb_total / zones["P_NHB"].sum()
    balance = {}
    for purpose in PURPOSES:
        factor = zones[f"P_{purpose}"].sum() / zones[f"A_{purpose}"].sum()
        zones[f"A_{purpose}"] *= factor
        balance[purpose] = round(factor, 4)
    report.append("配平（吸引量按产生量缩放的倍数）：" + "、".join(f"{k} {v:.3f}" for k, v in balance.items())
                  + ("；HBW < 1：规划岗位增长快于本地就业居民（人口老化），差额由跨境与输入劳工填补"
                     if balance["HBW"] < 1 else ""))
    if any(abs(v - 1) > 0.15 for v in balance.values()):
        flags.append("balance")
    return {"fits": fits, "balance_factors": balance}


def student_levels() -> dict[str, dict[str, float]]:
    """Cross-boundary students by control point and school level, latest school year (EDB)."""
    if not STUDENT_LEVELS_RAW.exists():
        response = httpx.get(STUDENT_LEVELS, headers=HEADERS, timeout=60, follow_redirects=True)
        response.raise_for_status()
        STUDENT_LEVELS_RAW.write_bytes(response.content)
    table = pd.read_csv(STUDENT_LEVELS_RAW, usecols=[0, 1, 2, 4], encoding="utf-8-sig")
    table.columns = ["year", "point", "level", "students"]
    table = table[table["year"] == table["year"].max()]
    table["level"] = table["level"].str.extract(r"^(Kindergarten|Primary|Secondary)")[0]
    return {point: group.groupby("level")["students"].sum().to_dict() for point, group in table.groupby("point")}


def crossings(zones: pd.DataFrame, report: list[str], flags: list[str]) -> pd.DataFrame:
    """External zones at the control points, and the Hong Kong ends of their trips."""
    data = json.loads(CROSS_BOUNDARY.read_text(encoding="utf-8"))
    try:
        levels = student_levels()
    except Exception as error:  # the mix only steers which schools; the totals come from pipeline/13
        levels = {}
        report.append(f"跨境学童学段构成下载失败（{error}），按全港学位分配  ← 需复核")
        flags.append("student levels")
    rows, uncounted = [], {}
    for point in data["control_points"]:
        students = 2 * point["cross_boundary_students"]  # into Hong Kong in the morning and back out
        residents = point["weekday_hk_residents"] - students
        if residents < 0 and point["weekday_hk_residents"] == 0:
            # Sha Tau Kok's control point is closed; its pupils cross at Chung Ying Street, which
            # Immigration's daily figures do not include. They are extra to the published total.
            uncounted[point["point"]] = students
            residents = 0.0
        elif residents < 0:
            raise RuntimeError(f"{point['point']}: more student crossings than resident crossings")
        rows.append({"zone": f"X:{point['point']}", "name": point["name_zh"], "mode": point["mode"],
                     "lon": point["lon"], "lat": point["lat"], "host_zone": point["zone"],
                     "P_CBS": students, "P_CBR": residents, "P_CBV": point["weekday_visitors"]})
    external = pd.DataFrame(rows).set_index("zone")
    crossings_total = external[["P_CBS", "P_CBR", "P_CBV"]].sum().sum()
    # Each point's residents and visitors are rounded averages: allow one crossing per point.
    if abs(crossings_total - sum(uncounted.values()) - data["weekday_crossings"]) > len(external):
        raise RuntimeError("crossings do not add up to the Immigration total")

    # Students go to places of their own level, in proportion to the mix at the points they use.
    mix = pd.Series(0.0, index=list(CROSSING_LEVELS))
    for point, by_level in levels.items():
        for level, count in by_level.items():
            mix[level] += count
    mix = mix / mix.sum() if mix.sum() > 0 else pd.Series(1 / 3, index=list(CROSSING_LEVELS))
    school = sum(mix[level] * zones[field] / zones[field].sum() for level, field in CROSSING_LEVELS.items())
    homes = zones["population"]
    visits = zones["gfa_retail"] + zones["gfa_hotel"]
    for purpose, weight in {"CBS": school, "CBR": homes, "CBV": visits}.items():
        zones[f"A_{purpose}"] = weight / weight.sum() * external[f"P_{purpose}"].sum()
    report.append(f"跨境（外部小区 {len(external)} 个）：学童往返 {external['P_CBS'].sum():,.0f}（学段 "
                  + "、".join(f"{k} {v:.0%}" for k, v in mix.items()) + f"）、其他香港居民 {external['P_CBR'].sum():,.0f}、"
                  f"访客 {external['P_CBV'].sum():,.0f}，合计 {crossings_total:,.0f} = 入境处工作日过境人次 "
                  f"{data['weekday_crossings']:,.0f}"
                  + "".join(f" + {name}学童 {count:,.0f}（入境处统计之外）" for name, count in uncounted.items())
                  + "；居民一端按人口、访客一端按零售+酒店楼面分配（假设）")
    return external


def building_trip_ends(zones: pd.DataFrame, fits: dict, job_fit: dict) -> pd.DataFrame:
    """Trip ends per building: what happens at homes goes to homes, the rest to floor space by use.

    School places, tertiary places and hospital floor area are points or parts of buildings this layer
    does not separate, so their share of trips is left out of the placing (not out of the totals).
    """
    frame = pd.read_parquet(BUILDINGS).dropna(subset=["zone"])
    frame = frame[frame["zone"].isin(zones.index) & frame["gfa_m2"].gt(0)].copy()
    frame["home"] = frame["dwelling"]  # pipeline/10 decides which buildings are homes
    home_gfa = frame["gfa_m2"].where(frame["home"], 0.0)
    home_share = home_gfa / home_gfa.groupby(frame["zone"]).transform("sum").replace(0, np.nan)

    # Per zone: trip ends that belong at homes, and trip ends per square metre of each use.
    at_home = zones[[f"P_{p}" for p in ("HBW", "HBS", "HBO")]].sum(axis=1) + zones["A_CBR"]
    per_sqm = pd.DataFrame(0.0, index=zones.index, columns=list(BUILDING_USE))
    parts = {"HBO": fits["HBO_att"]["coefficients"], "NHB": fits["NHB_att"]["coefficients"],
             "NHB_P": fits["NHB_prod"]["coefficients"], "HBW": job_fit["coefficients"]}
    for key, coef in parts.items():
        column = "P_NHB" if key == "NHB_P" else f"A_{key}"
        coef = pd.Series(coef)
        population = "population"
        weight = design(zones, population)[coef.index] @ coef
        per_unit = (zones[column] / weight.replace(0, np.nan)).fillna(0.0)
        at_home += per_unit * coef.get("population", 0.0) * zones["population"]
        for variable in BUILDING_USE:
            per_sqm[variable] += per_unit * coef.get(variable, 0.0)
    visits = zones["A_CBV"] / (zones["gfa_retail"] + zones["gfa_hotel"]).replace(0, np.nan)
    per_sqm["gfa_retail"] += visits.fillna(0.0)
    per_sqm["gfa_hotel"] += visits.fillna(0.0)

    use_to_variable = {use: variable for variable, use in BUILDING_USE.items()}
    rate = [per_sqm.at[zone, use_to_variable[use]] if use in use_to_variable else 0.0
            for zone, use in zip(frame["zone"], frame["use"])]
    frame["trip_ends"] = frame["gfa_m2"] * np.array(rate) \
        + home_share.fillna(0.0) * frame["zone"].map(at_home)
    return frame[["OBJECTID", "zone", "use", "home", "lon", "lat", "gfa_m2", "trip_ends"]]


def main() -> None:
    params = json.loads(PARAMETERS.read_text(encoding="utf-8"))
    survey = pd.DataFrame(params["broad_districts"]["districts"]).T.astype(float)
    survey = survey.rename(columns={"NHB_EB_prod": "NHB_prod", "NHB_EB_att": "NHB_att"})
    report, flags = [], []

    zones = load_zones()
    district_check = check_districts(zones, survey, report, flags)
    rates = productions(zones, survey, report, flags)
    job_estimate, job_fit = jobs(zones, report, flags)
    zones["jobs"] = job_estimate
    attraction = attractions(zones, survey, job_estimate, report, flags)
    external = crossings(zones, report, flags)

    columns = [f"{end}_{p}" for p in PURPOSES + CROSSING for end in ("P", "A")]
    internal = zones.assign(P_CBS=0.0, P_CBR=0.0, P_CBV=0.0)
    for column in columns:
        if column not in external:
            external[column] = 0.0
    table = pd.concat([
        internal[["district", "broad", "population", "workers", "students", "jobs"] + columns].assign(external=False),
        external[["name", "mode", "lon", "lat", "host_zone"] + columns].assign(external=True),
    ])
    table.index.name = "zone"
    values = table[columns]
    if values.isna().any().any() or (values < 0).any().any():
        raise RuntimeError("trip ends contain gaps or negative values")

    totals = {c: round(float(values[c].sum())) for c in columns}
    mechanised = sum(totals[f"P_{p}"] for p in PURPOSES)
    report.insert(0, f"2026 工作日机动化出行 {mechanised:,.0f}（2022 调查 {params['weekday_mechanised_trips']['total']:,.0f}，"
                     f"{mechanised / params['weekday_mechanised_trips']['total'] - 1:+.1%}），另跨境 "
                     f"{sum(totals[f'P_{p}'] for p in CROSSING):,.0f}")
    top = table.loc[~table["external"], [f"A_{p}" for p in PURPOSES]].sum(axis=1).sort_values(ascending=False)
    report.append("吸引最多的小区：" + "、".join(f"{z} {v / 1000:.0f}k" for z, v in top.head(6).items()))

    buildings = building_trip_ends(zones, attraction["fits"], job_fit)
    placed = buildings.groupby("zone")["trip_ends"].sum()
    share = placed.sum() / values.loc[~table["external"], [f"P_{p}" for p in PURPOSES]
                                      + [f"A_{p}" for p in PURPOSES + CROSSING]].sum().sum()
    no_weight = sorted(set(zones.index) - set(placed[placed > 0].index))
    report.append(f"楼宇出行端点（供 pipeline/15 定小区中心）：落到楼宇的占全部端点 {share:.0%}"
                  "（学校、大专、医院的端点不参与定位）；没有任何权重的小区 "
                  + (", ".join(no_weight) if no_weight else "无"))

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    table.reset_index().to_parquet(OUTPUT, index=False)
    buildings.to_parquet(BUILDING_OUTPUT, index=False)
    AUDIT.write_text(json.dumps({
        "source": params["source"], "scope": "weekday mechanised trips, 2026, plus boundary crossings",
        "totals": totals, "broad_district_population_ratio": district_check, "production_rates_2022": rates,
        "jobs": job_fit, "attractions": attraction, "flags": flags, "report": report,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"-> {OUTPUT.relative_to(ROOT)}  ({len(table)} zones, {int(table['external'].sum())} external)")
    print(f"-> {BUILDING_OUTPUT.relative_to(ROOT)}")
    for line in report:
        print("   " + line)
    if flags:
        print("   需复核：" + ", ".join(flags))


if __name__ == "__main__":
    main()
