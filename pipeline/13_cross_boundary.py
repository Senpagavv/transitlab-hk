"""Cross-boundary travel: the control points, as external zones of the model.

Input : Immigration Department, daily passenger traffic by control point (2021-01 onwards, daily)
        Education Bureau, cross-boundary students, and which control point each one uses
Output: data/web/cross-boundary.json        control points, typical weekday demand, the zone each sits in
        data/web/cross-boundary-audit.json

A Hong Kong model that stops at the boundary is wrong about the north of the territory. Hundreds of
thousands of people cross every day, tens of thousands of children live in Shenzhen and go to school
in Sheung Shui, Yuen Long and Tuen Mun, and the 2021 census already counts 49,311 residents whose
workplace is outside Hong Kong (zones.geojson, work_outside_hk).

The four-step model handles this the standard way: each control point becomes an external zone.
Trips are produced and attracted there like any other zone, so they load onto the roads and railways
that actually carry them - Lo Wu onto the East Rail line, Shenzhen Bay onto Route 10 and the
Shenzhen Bay Bridge, the airport onto the North Lantau Highway.

The passenger figures are measured: Immigration counts every crossing. They are also live - the file
is updated daily, so this pipeline can be re-run to refresh the demand without touching the model.

Run from the project root (about a minute):
    uv run python pipeline/13_cross_boundary.py
"""

import io
import json
import time
from pathlib import Path

import geopandas as gpd
import httpx
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
ZONES = ROOT / "data" / "web" / "zones.geojson"
RAW = ROOT / "data" / "raw" / "cross-boundary"
OUTPUT = ROOT / "data" / "web" / "cross-boundary.json"
AUDIT = ROOT / "data" / "web" / "cross-boundary-audit.json"

HEADERS = {"User-Agent": "TransitLabHK/0.1 (student hackathon prototype)"}
WGS84, HK80 = "EPSG:4326", "EPSG:2326"

PASSENGERS = "https://www.immd.gov.hk/opendata/eng/transport/immigration_clearance/statistics_on_daily_passenger_traffic.csv"
STUDENTS_BY_POINT = "https://www.edb.gov.hk/attachment/datagovhk/Number_of_cross_boundary_students_land_en.csv"
STUDENTS_TOTAL = "https://www.edb.gov.hk/attachment/datagovhk/Number_of_cross_boundary_students_en.csv"

RECENT_WEEKS = 12  # how far back a "typical weekday" is averaged over

# EDB spells the control points differently from Immigration, and one name is a prefix of another -
# matching "Lok Ma Chau" by prefix swallows the Spur Line's children too, which is how this table
# first came out with more cross-boundary pupils allocated than exist.
EDB_POINT_NAMES = {
    "Lo Wu Control Point": "Lo Wu",
    "Lok Ma Chau Spur Line Control Point": "Lok Ma Chau Spur Line",
    "Lok Ma Chau Control Point": "Lok Ma Chau",
    "Man Kam To Control Point": "Man Kam To",
    "Sha Tau Kok Chung Ying Street": "Sha Tau Kok",
    "Shenzhen Bay Control Point": "Shenzhen Bay",
    "Heung Yuen Wai Control Point": "Heung Yuen Wai",
    "Hong Kong-Zhuhai-Macao Bridge (HZMB) Hong Kong Port": "Hong Kong-Zhuhai-Macao Bridge",
    "Express Rail Link West Kowloon Station": "Express Rail Link West Kowloon",
}

# Where each control point is, and which side of the boundary it faces. Coordinates are checked in
# the audit by looking at which district the point lands in - Lo Wu must come out in North District.
CONTROL_POINTS = {
    "Lo Wu": {"zh": "罗湖", "lon": 114.1133, "lat": 22.5281, "mode": "rail", "expect": "North"},
    "Lok Ma Chau Spur Line": {"zh": "落马洲支线", "lon": 114.0656, "lat": 22.5144, "mode": "rail", "expect": "Yuen Long"},
    "Lok Ma Chau": {"zh": "落马洲", "lon": 114.0742, "lat": 22.5117, "mode": "road", "expect": "Yuen Long"},
    "Man Kam To": {"zh": "文锦渡", "lon": 114.1256, "lat": 22.5411, "mode": "road", "expect": "North"},
    "Sha Tau Kok": {"zh": "沙头角", "lon": 114.2211, "lat": 22.5433, "mode": "road", "expect": "North"},
    "Shenzhen Bay": {"zh": "深圳湾", "lon": 113.9350, "lat": 22.4986, "mode": "road", "expect": "Yuen Long"},
    "Heung Yuen Wai": {"zh": "莲塘/香园围", "lon": 114.1614, "lat": 22.5486, "mode": "road", "expect": "North"},
    "Hong Kong-Zhuhai-Macao Bridge": {"zh": "港珠澳大桥", "lon": 113.9386, "lat": 22.3061, "mode": "road", "expect": "Islands"},
    "Express Rail Link West Kowloon": {"zh": "高铁西九龙", "lon": 114.1656, "lat": 22.3036, "mode": "rail", "expect": "Yau Tsim Mong"},
    "Airport": {"zh": "机场", "lon": 113.9146, "lat": 22.3089, "mode": "air", "expect": "Islands"},
    "China Ferry Terminal": {"zh": "中国客运码头", "lon": 114.1686, "lat": 22.2969, "mode": "sea", "expect": "Yau Tsim Mong"},
    "Macao Ferry Terminal": {"zh": "港澳码头", "lon": 114.1519, "lat": 22.2892, "mode": "sea", "expect": "Central and Western"},
    "Tuen Mun Ferry Terminal": {"zh": "屯门码头", "lon": 113.9719, "lat": 22.3728, "mode": "sea", "expect": "Tuen Mun"},
    "Kai Tak Cruise Terminal": {"zh": "启德邮轮码头", "lon": 114.2136, "lat": 22.3061, "mode": "sea", "expect": "Kowloon City"},
    "Harbour Control": {"zh": "港口管制", "lon": 114.1706, "lat": 22.2942, "mode": "sea", "expect": "Yau Tsim Mong"},
}


def get(url: str, attempts: int = 4) -> httpx.Response:
    for attempt in range(attempts):
        try:
            response = httpx.get(url, headers=HEADERS, timeout=300, follow_redirects=True)
            response.raise_for_status()
            return response
        except Exception as error:
            if attempt == attempts - 1:
                raise
            print(f"   retry {attempt + 1}: {type(error).__name__}", flush=True)
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


def typical_weekday() -> tuple[pd.DataFrame, str, str]:
    """Average weekday crossings per control point over the most recent weeks."""
    text = get(PASSENGERS).content.decode("utf-8-sig", "replace")
    frame = pd.read_csv(io.StringIO(text))
    frame.columns = [c.strip() for c in frame.columns]
    frame = frame.rename(columns={
        "Control Point": "point", "Arrival / Departure": "direction",
        "Hong Kong Residents": "hk_residents", "Mainland Visitors": "mainland_visitors",
        "Other Visitors": "other_visitors", "Total": "total",
    })
    frame["Date"] = pd.to_datetime(frame["Date"], format="%d-%m-%Y", errors="coerce")
    frame = frame.dropna(subset=["Date"])

    latest = frame["Date"].max()
    window = frame[frame["Date"] > latest - pd.Timedelta(weeks=RECENT_WEEKS)]
    weekdays = window[window["Date"].dt.dayofweek < 5]
    days = weekdays["Date"].nunique()

    counts = ["hk_residents", "mainland_visitors", "other_visitors", "total"]
    for column in counts:
        weekdays[column] = pd.to_numeric(weekdays[column], errors="coerce").fillna(0)
    daily = (
        weekdays.groupby(["point", "direction"])[counts].sum() / days
    ).round(0).reset_index()
    print(f"   最近 {RECENT_WEEKS} 周共 {days} 个工作日，数据截至 {latest:%Y-%m-%d}")
    return daily, f"{latest:%Y-%m-%d}", str(days)


def cross_boundary_students() -> tuple[pd.DataFrame, float]:
    """Cross-boundary schoolchildren, by the control point they use, for the latest school year."""
    text = get(STUDENTS_BY_POINT).content.decode("utf-8-sig", "replace")
    frame = pd.read_csv(io.StringIO(text))
    frame.columns = [c.strip() for c in frame.columns]
    frame = frame.rename(columns={"School Year": "year", "Control Point": "point",
                                  "School Level": "level", "No. of Students": "students"})
    frame["students"] = pd.to_numeric(frame["students"], errors="coerce").fillna(0)
    latest = sorted(frame["year"].dropna().unique())[-1]
    frame = frame[frame["year"] == latest]
    unknown = sorted(set(frame["point"].dropna()) - set(EDB_POINT_NAMES))
    if unknown:
        raise RuntimeError(f"教育局新增了未知口岸名，请补进 EDB_POINT_NAMES: {unknown}")
    frame["point"] = frame["point"].map(EDB_POINT_NAMES)
    by_point = frame.groupby(["point", "level"])["students"].sum().reset_index()

    published = pd.read_csv(io.StringIO(get(STUDENTS_TOTAL).content.decode("utf-8-sig", "replace")))
    published.columns = [c.strip() for c in published.columns]
    published = published[published["School Year"] == latest]
    total = pd.to_numeric(published["No. of Students"], errors="coerce").sum()
    print(f"   {latest} 学年跨境学童：口岸表合计 {by_point['students'].sum():,.0f}，总表 {total:,.0f}")
    return by_point, float(total)


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    daily, as_of, days = typical_weekday()
    students, student_total = cross_boundary_students()
    daily.to_parquet(RAW / "daily-passengers.parquet", index=False)

    zones = gpd.read_file(ZONES).to_crs(HK80)
    points = gpd.GeoDataFrame(
        [{"point": name, **meta} for name, meta in CONTROL_POINTS.items()],
        geometry=gpd.points_from_xy(
            [m["lon"] for m in CONTROL_POINTS.values()], [m["lat"] for m in CONTROL_POINTS.values()]
        ),
        crs=WGS84,
    ).to_crs(HK80)
    # A control point sits on the boundary itself, so it can fall just outside every zone polygon.
    placed = gpd.sjoin_nearest(points, zones[["zone", "geometry"]], how="left", distance_col="metres")
    placed = placed[~placed.index.duplicated(keep="first")]

    records = []
    for row in placed.itertuples():
        here = daily[daily["point"] == row.point]
        arrival = here[here["direction"] == "Arrival"]
        departure = here[here["direction"] == "Departure"]
        student_here = students.loc[students["point"].eq(row.point), "students"].sum()
        records.append({
            "point": row.point,
            "name_zh": row.zh,
            "mode": row.mode,
            "lon": CONTROL_POINTS[row.point]["lon"],
            "lat": CONTROL_POINTS[row.point]["lat"],
            "zone": row.zone,
            "zone_distance_m": round(float(row.metres), 1),
            "weekday_arrivals": float(arrival["total"].sum()),
            "weekday_departures": float(departure["total"].sum()),
            "weekday_hk_residents": float(here["hk_residents"].sum()),
            "weekday_visitors": float(here["mainland_visitors"].sum() + here["other_visitors"].sum()),
            "cross_boundary_students": float(student_here),
        })
    records.sort(key=lambda r: -(r["weekday_arrivals"] + r["weekday_departures"]))
    total_crossings = sum(r["weekday_arrivals"] + r["weekday_departures"] for r in records)

    OUTPUT.write_text(json.dumps({
        "source": "Immigration Department daily passenger traffic; EDB cross-boundary students",
        "as_of": as_of,
        "basis": f"{RECENT_WEEKS} 周内 {days} 个工作日的平均值",
        "weekday_crossings": round(total_crossings),
        "control_points": records,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    # --- audit ------------------------------------------------------------------------------
    named = set(daily["point"].unique())
    unknown = sorted(named - set(CONTROL_POINTS))
    missing = sorted(set(CONTROL_POINTS) - named)
    districts = gpd.read_file(ROOT / "data" / "raw" / "boundaries" / "districts_18.json").to_crs(HK80)
    districts["district"] = districts["District"].str.replace(" District", "", regex=False).str.strip()
    where = gpd.sjoin_nearest(points, districts[["district", "geometry"]], how="left")
    where = where[~where.index.duplicated(keep="first")]
    wrong = [f"{r.point}: 落在 {r.district}，应为 {r.expect}"
             for r in where.itertuples() if r.district != r.expect]

    report = [
        f"总量：典型工作日跨境人次 {total_crossings:,.0f}（双向，截至 {as_of}）",
        f"口岸覆盖：入境处数据有 {len(named)} 个口岸，已定位 {len(CONTROL_POINTS)} 个"
        + (f"；未收录 {unknown}" if unknown else "；全部收录"),
        f"坐标校验：{'全部落在预期行政区' if not wrong else '有偏差 → ' + '；'.join(wrong)}",
        f"跨境学童：{student_total:,.0f} 名，已按口岸分配 {sum(r['cross_boundary_students'] for r in records):,.0f} 名",
        "缺失值语义：口岸不在任何小区多边形内属正常（位于边界上），按最近小区挂接",
        "实测vs估算：过境人次与学童数为实测（入境处/教育局逐日与逐年公布）；口岸坐标为人工录入并经行政区校验",
        "时效性：入境处文件每日更新，重跑本脚本即可刷新，无需改模型",
    ]
    if missing:
        report.append(f"注意：以下口岸在入境处数据中无记录（可能已关闭或改名）：{missing}")
    AUDIT.write_text(json.dumps({"report": report, "unknown_points": unknown,
                                 "coordinate_mismatches": wrong}, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n-> {OUTPUT.relative_to(ROOT)}")
    for line in report:
        print("   " + line)
    print()
    for record in records[:8]:
        crossings = record["weekday_arrivals"] + record["weekday_departures"]
        print(f"   {record['name_zh']:<12}{crossings:>9,.0f} 人次/工作日  "
              f"学童 {record['cross_boundary_students']:>6,.0f}  小区 {record['zone']}")


if __name__ == "__main__":
    main()
