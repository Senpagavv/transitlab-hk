"""Step 5a: what it takes to serve the day's taxi demand, against the fleet Hong Kong actually has.

Input : data/model/taxi-requests-2026.parquet   one row per request, with hour and both ends (pipeline/28)
        data/model/skim-car-freeflow.npz        zone to zone minutes and kilometres (pipeline/17)
        data/web/traffic/atc-stations.json      the census, for the hourly shape of taxi traffic (pipeline/07)
        data/web/traffic/atc-occupancy.json     the census's taxi share and persons per taxi, by hour
        data/model/road-speeds-hourly.parquet   measured speeds, for the slowdown in each hour (pipeline/15d)
        data/model/road-links.parquet           link lengths, to weight those speeds
        data/model/td-digest-series.json        the licensed taxi fleet, by year (pipeline/30)
Output: data/model/taxi-fleet-hourly.parquet    per hour: requests, occupied vehicle hours and kilometres,
                                                and the fleet that implies at each occupancy rate
        data/web/fleet-supply-audit.json

Why. Every claim of the form "N self-driving cars could do the work of M taxis" needs a denominator:
how many vehicles are on the road now, and how much of their running is actually carrying someone.
The first half of that is published. The second half is the interesting one, and it is the thing a
dispatched fleet removes.

What can and cannot be derived here. Careful: pipeline/23 sets the mean taxi trip to 8.5 km by
dividing the vehicle kilometres the census counts by the passenger journeys the Transport Department
publishes. Turning round and calling the gap between those two "empty running" would be circular -
the model was built assuming there is none. Breaking the circle needs one measurement this project
does not have: either the average hire's party size (the census gives 0.98 persons per taxi in the
stream, including empty ones, so occupied share = 0.98 / party size), or the paid kilometres per taxi
per day from the Transport Department's taximeter reading surveys, which the 2024 fare review paper
mentions but does not publish. So OCCUPANCY_RATES below is a stated range, not a result, and every
fleet number here is reported against each of them.

Method.
  1. Each request's occupied time and distance come from the free-flow car skim. That understates
     the peak, so the hourly measured speeds (pipeline/15d) give a slowdown factor per hour.
  2. Occupied vehicle hours in an hour = the sum of those times. A taxi can only be in one place, so
     that sum IS the number of taxis busy carrying someone throughout that hour.
  3. Taxis on the road = busy taxis / occupancy rate. Compared with the licensed fleet.

Run from the project root (about half a minute):
    uv run python pipeline/29_fleet_supply.py
"""

import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "data" / "model"
WEB = ROOT / "data" / "web"
REQUESTS = MODEL / "taxi-requests-2026.parquet"
CAR_SKIM = MODEL / "skim-car-freeflow.npz"
SPEEDS = MODEL / "road-speeds-hourly.parquet"
STATIONS = WEB / "traffic" / "atc-stations.json"
OCCUPANCY = WEB / "traffic" / "atc-occupancy.json"
OUTPUT = MODEL / "taxi-fleet-hourly.parquet"
AUDIT = WEB / "fleet-supply-audit.json"
TD_DIGEST = MODEL / "td-digest-series.json"

CENSUS_YEAR = 2024


def latest_taxi_fleet() -> tuple[str, dict]:
    """Read the latest annual taxi fleet published by pipeline/30."""
    if not TD_DIGEST.exists():
        raise RuntimeError(f"missing {TD_DIGEST.relative_to(ROOT)} - 先跑 pipeline/30")
    annual = json.loads(TD_DIGEST.read_text(encoding="utf-8"))["taxi_fleet"]["annual"]
    year = max(annual, key=int)
    return year, annual[year]


FLEET_YEAR, _FLEET_LATEST = latest_taxi_fleet()
FLEET = {kind: int(_FLEET_LATEST[kind]["licensed"])
         for kind in ("urban", "new_territories", "lantau")}
FLEET_REGISTERED = int(_FLEET_LATEST["total"]["registered"])
# The share of a taxi's time on the road that is carrying a passenger. Not derivable here (see the
# docstring); these are the range the answer is reported over. The middle one is what the census's
# 0.98 persons per taxi implies if the average hire carries 1.4 people.
OCCUPANCY_RATES = (0.55, 0.70, 0.85)
SHIFT_HOURS = 20.0  # a two-shift taxi is available about this long; used only to sanity-check km/day
# Share of the licensed fleet actually on the road in the busiest hour. Not every taxi runs every day,
# and the morning shift change falls near the peak. An assumption, and the one that turns the fleet's
# size into a floor under the occupancy rate - so the floor is only as good as this number.
ON_ROAD_AT_PEAK = 0.80
BOARDING_MIN = 1.0  # picking up and setting down, on top of the travelled time


def hourly_slowdown(report: list[str]) -> np.ndarray:
    """Measured travel time in each hour over the free-flow time, from the detectors (pipeline/15d)."""
    speeds = pd.read_parquet(SPEEDS, columns=["link_id", "hour", "speed", "source"])
    lengths = pd.read_parquet(MODEL / "road-links.parquet", columns=["link_id", "length_m"])
    speeds = speeds.merge(lengths, on="link_id", how="left")
    measured = speeds[(speeds["source"] == "detector") & speeds["length_m"].notna() & (speeds["speed"] > 0)]
    if measured.empty:
        raise RuntimeError("no detector rows in road-speeds-hourly.parquet - rerun pipeline/15d")
    # Length-weighted harmonic mean speed: the right average when what is added up is time.
    def mean_speed(frame: pd.DataFrame) -> pd.Series:
        return frame.groupby("hour").apply(lambda g: g["length_m"].sum() / (g["length_m"] / g["speed"]).sum())
    by_hour = mean_speed(measured)
    free = by_hour.loc[[2, 3, 4]].mean()  # the quietest hours stand for free flow
    factor = (free / by_hour).reindex(range(24)).fillna(1.0).clip(lower=1.0).to_numpy()
    report.append(f"拥堵折算（探测器实测，长度加权调和平均）：夜间自由流 {free:.0f} 公里/小时；"
                  f"行程时间放大倍数 8 时 {factor[8]:.2f}、12 时 {factor[12]:.2f}、18 时 {factor[18]:.2f}、3 时 {factor[3]:.2f}")
    return factor


def census_taxi_shape(report: list[str]) -> np.ndarray:
    """The census's own hourly shape of taxi traffic, as an independent check on the request profile."""
    census = json.loads(STATIONS.read_text(encoding="utf-8"))
    records = pd.DataFrame(census["records"])
    records = records[(records["year"] == CENSUS_YEAR) & records["aadt"].notna()]
    aadt = records.groupby("station")["aadt"].sum()
    profile = {h["station"]: h["weekday_pct"] for h in census["hourly"] if h["year"] == CENSUS_YEAR}
    occupancy = {o["station"]: o["hours"] for o in json.loads(OCCUPANCY.read_text(encoding="utf-8"))["stations"]
                 if o["year"] == CENSUS_YEAR}
    bands = [f"{h:02d}00-{h + 1:02d}00" for h in range(24)]
    flow = np.zeros(24)
    for station, total in aadt.items():
        if station not in profile or station not in occupancy:
            continue
        hours = occupancy[station]
        for h in range(24):
            band = bands[h] if bands[h] in hours else (bands[7] if h < 7 else bands[22])
            share = hours.get(band, {}).get("taxi", {}).get("share_pct")
            if share is not None:
                flow[h] += total * profile[station][h] / 100 * share / 100
    shape = flow / flow.sum()
    report.append(f"普查的士车流形状（{len(occupancy)} 个核心站）：早高峰 8 时占全日 {shape[8]:.1%}、"
                  f"18 时 {shape[18]:.1%}、3 时 {shape[3]:.1%}；07 时前与 23 时用最近时段外推")
    return shape


def main() -> None:
    report, flags = [], []
    requests = pd.read_parquet(REQUESTS, columns=["time_sec", "origin_zone", "destination_zone", "purpose"])
    skim = np.load(CAR_SKIM)
    ids = [str(z) for z in skim["zones"]]
    index = {z: i for i, z in enumerate(ids)}
    o = requests["origin_zone"].astype(str).map(index)
    d = requests["destination_zone"].astype(str).map(index)
    inside = o.notna() & d.notna()
    coverage = float(inside.mean())
    rows = requests[inside].copy()
    oi, di = o[inside].astype(int).to_numpy(), d[inside].astype(int).to_numpy()
    rows["hour"] = (rows["time_sec"] // 3600).astype(int)
    rows["km"] = skim["distance_km"][oi, di]
    rows["min"] = skim["time_min"][oi, di]
    report.append(f"请求 {len(requests):,} 条，其中两端都在 455 个分区内的 {len(rows):,} 条（{coverage:.1%}）；"
                  f"其余是跨境出行，口岸不在小汽车矩阵里，按同比例放大计入总量")

    factor = hourly_slowdown(report)
    rows["busy_min"] = rows["min"] * factor[rows["hour"].to_numpy()] + BOARDING_MIN
    scale = 1 / coverage  # cross-boundary legs are longer, so this understates them; said in the audit
    hourly = rows.groupby("hour").agg(requests=("km", "size"), veh_km=("km", "sum"), veh_min=("busy_min", "sum"))
    hourly = hourly.reindex(range(24)).fillna(0.0) * scale
    hourly["busy_taxis"] = hourly["veh_min"] / 60
    for rate in OCCUPANCY_RATES:
        hourly[f"on_road_at_{int(rate * 100)}"] = hourly["busy_taxis"] / rate
    hourly.insert(0, "hour", hourly.index)

    fleet = sum(FLEET.values())
    peak_hour = int(hourly["busy_taxis"].idxmax())
    daily_km = float(hourly["veh_km"].sum())
    report.append(f"载客运行：全日 {daily_km / 1e6:.2f} 百万车公里、{hourly['veh_min'].sum() / 60 / 1e3:.1f} 千车小时；"
                  f"最忙的一小时是 {peak_hour}:00，同时载客的车 {hourly['busy_taxis'].max():,.0f} 辆")
    report.append(f"领牌车队 {fleet:,} 辆（运输署月报 {FLEET_YEAR} 年；市区 {FLEET['urban']:,}、"
                  f"新界 {FLEET['new_territories']:,}、"
                  f"大屿山 {FLEET['lantau']}；登记配额 {FLEET_REGISTERED:,} 自 1994 年冻结）")
    for rate in OCCUPANCY_RATES:
        column = f"on_road_at_{int(rate * 100)}"
        peak = float(hourly[column].max())
        report.append(f"  载客率 {rate:.0%}：最忙一小时需要 {peak:,.0f} 辆在路上（占领牌车队 {peak / fleet:.0%}）；"
                      f"全日行驶 {daily_km / rate / fleet:,.0f} 公里/辆")

    # Checks.
    shape = census_taxi_shape(report)
    modelled = (hourly["requests"] / hourly["requests"].sum()).to_numpy()
    gap = float(np.abs(modelled - shape).max())
    report.append(f"核对一：请求的逐小时形状 vs 普查的士车流形状，最大差 {gap * 100:.1f} 个百分点（容许 3）"
                  + ("" if gap <= 0.03 else "  ← 需复核"))
    if gap > 0.03:
        flags.append("hourly shape")

    per_taxi = daily_km / OCCUPANCY_RATES[1] / fleet
    plausible = 150 <= per_taxi <= 500
    report.append(f"核对二：每辆的士每日行驶 {per_taxi:,.0f} 公里（载客率 {OCCUPANCY_RATES[1]:.0%}，"
                  f"两班制约 {SHIFT_HOURS:.0f} 小时在路上，合理带 150–500）" + ("" if plausible else "  ← 需复核"))
    if not plausible:
        flags.append("km per taxi")

    # The fleet is finite, and that alone rules out the lower occupancy rates.
    busiest = float(hourly["busy_taxis"].max())
    floor = busiest / (fleet * ON_ROAD_AT_PEAK)
    report.append(f"核对三（反推载客率的下界）：{peak_hour}:00 同时载客 {busiest:,.0f} 辆；车队 {fleet:,} 辆、"
                  f"高峰时段假设 {ON_ROAD_AT_PEAK:.0%} 在路上 = {fleet * ON_ROAD_AT_PEAK:,.0f} 辆可用，"
                  f"所以**载客率不可能低于 {floor:.0%}**" + ("" if floor < 1 else "  ← 需复核：需求超过车队能力"))
    if floor >= 1:
        flags.append("demand exceeds fleet")

    report.append("⚠️ 空驶率不是这里算出来的：模型的 8.5 公里平均行程本身就是用「普查车公里 ÷ 运输署载客人次」"
                  "反推的，再用两者之差当空驶就是循环论证。但上面两条核对把它夹住了——"
                  f"车队容量给出下界 {floor:.0%}，每车日行驶里程的合理带（150–500 公里）给出另一侧的约束。"
                  "要真正定死，需要一个本工程没有的量：每程平均载客人数，或运输署计价表读数调查的载客公里。")

    # Not rounded. Several of these columns are derived from each other - busy_taxis is veh_min / 60,
    # on_road_at_r is busy_taxis / r - and rounding a binary file buys nothing while breaking those
    # identities by more than they are worth. A test caught it at one decimal and again at six.
    hourly.to_parquet(OUTPUT, index=False)
    AUDIT.write_text(json.dumps({
        "fleet": FLEET, "fleet_licensed": fleet, "fleet_registered": FLEET_REGISTERED,
        "occupancy_rates": list(OCCUPANCY_RATES), "coverage": round(coverage, 4),
        "daily_occupied_veh_km": daily_km, "peak_hour": peak_hour,
        "hourly": hourly.round(2).to_dict(orient="records"),
        "flags": flags, "report": report,
    }, ensure_ascii=False, indent=1, default=float), encoding="utf-8")
    print(f"-> {OUTPUT.relative_to(ROOT)}")
    for line in report:
        print("   " + line)


if __name__ == "__main__":
    main()
