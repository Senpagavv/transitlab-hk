"""Step 4a: the weekday morning peak hour, 08:00-09:00, in 2026 - people by mode, and the vehicles
they put on the road.

Input : data/model/mode-split-2026.npz          daily trips by purpose and mode, production -> attraction (pipeline/23)
        data/model/parameters-tcs2022.json       TCS 2022 Figure 3.3 and 3.3.8-9 (pipeline/20)
        data/web/traffic/atc-occupancy.json      Annual Traffic Census: 08:00-09:00 vehicle mix and people
                                                 per vehicle, core stations weighted by AADT (pipeline/07)
        data/model/skim-car-freeflow.npz         car kilometres, for the vehicle-km check (pipeline/17)
        data/web/traffic/atc-stations.json       census hourly profiles, for how peaked cars and taxis are (pipeline/07)
Output: data/model/am-peak-2026.npz              origin -> destination, 08:00-09:00, zones as in pipeline/23:
                                                   P_PV, P_TAXI, P_PT, P_SPB   people
                                                   V_PV, V_TAXI, V_SPB         vehicles
        data/web/am-peak-audit.json

Why one hour. Roads are designed and checked on their peak hour (TPDM Volume 2, 2.4.1.1: "The
operating condition of a road is normally assessed by comparing its peak hourly flow against its
design hourly flow"), and the census that assignment is compared with reports each station's peak
hour. 08:00-09:00 is the busiest hour for all trips in TCS 2022 (3.3.7) and the AM peak hour at 192
of the 356 counted directions in 2024 (104 are 09:00-10:00, 60 are 07:00-08:00).

How much of the day falls in the hour. TCS Figure 3.3 gives, for each purpose, the share of the
day's trips in every hour (read from the chart's drawing in pipeline/20). A purpose's share in
08:00-09:00 divided by its share of the whole day is the fraction of its daily trips in the hour:
work 21%, school 12%, other 6%, non-home-based 8%.

Which way they run. The daily matrices count a round trip twice, both legs from the home zone to
the destination zone. In the morning nearly everything leaves home:
  work   - 42% of home-to-work trips are made in the hour (3.3.8). With half of the work trips going
           to work, that is 0.42 x 0.5 = 0.210 of the daily matrix - against the 0.212 Figure 3.3 puts
           in the hour for work in both directions. So 99% of the hour's work trips go to work;
           the rest are night shifts going home.
  school - all towards school. (64% of home-to-school trips are in 07:00-08:00 (3.3.9), which is 36%
           of the day's school trips - Figure 3.3 shows 36% in that hour too, so the earlier hour
           is also all one way.)
  other  - the report gives no split. 70% leave home is assumed: the rest are mainly parents and
           helpers coming back from taking children to school (07:00-08:00 carries 3.4% of the
           day's trips as school trips). To be checked against the census's counts by direction.
  non-home-based - already origin to destination, half each way.
Cross-boundary trips follow the purpose they borrowed mode choice from: students as school,
others as "other", half each way (their spread over Hong Kong is itself a placeholder, pipeline/22).

People to vehicles. The census's core stations count the vehicle mix and the people in each
vehicle, driver included, hour by hour (the "OCC" sheet). Stations are weighted by their weekday
AADT so that busy roads count for more, as they do in vehicle-kilometres.
  private vehicle - TCS "private vehicle" covers cars and motorcycles; people / (their weighted
                    occupancy), driver included - the driver makes the trip too.
  taxi            - the driver is not a trip-maker, so passengers per taxi = occupancy - 1. That
                    average includes taxis cruising empty, so the vehicles come out with the empty
                    running already in them, spread along the paid trips.
  special purpose - school, residents' and employees' coaches: private light buses and
                    non-franchised buses (the census does not separate tour coaches from them).
How peaked cars and taxis are. TCS has one hourly profile for all modes, and it is mostly public
transport commuters. On the roads the census counts a flatter morning: at the core stations 08:00-
09:00 carries about 7% of a weekday's private cars and taxis, where the TCS profile gives them
11% (and school and residents' coaches, mostly on the road before 08:00, likewise). So the peak-hour private vehicle and taxi trips are scaled to the census's share of each
class's day (the daily totals stay as mode choice set them), and the people taken off them are
added to public transport, so the hour still holds Figure 3.3's share of the day's trips.
Franchised buses and public light buses are not converted from trips: they run to timetables and
go on the roads as a fixed load (the next script), and goods vehicles come from their own survey.

Run from the project root (seconds):
    uv run python pipeline/24_peak_hour.py
"""

import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "data" / "model"
WEB = ROOT / "data" / "web"
MODE_SPLIT = MODEL / "mode-split-2026.npz"
PARAMETERS = MODEL / "parameters-tcs2022.json"
OCCUPANCY = WEB / "traffic" / "atc-occupancy.json"
CAR = MODEL / "skim-car-freeflow.npz"
OUTPUT = MODEL / "am-peak-2026.npz"
AUDIT = WEB / "am-peak-audit.json"

PEAK = 8  # 08:00-09:00
PEAK_BAND = "0800-0900"
MODES = ["PV", "TAXI", "PT", "SPB"]
PROFILE_KEY = {"HBW": "HBW", "HBS": "HBS", "HBO": "HBO", "NHB": "NHB_EB"}
# Share of the hour's trips that run production -> attraction (home -> destination).
HBO_FROM_HOME = 0.70  # assumed; see the docstring
# Cross-boundary purposes: (the purpose whose timing they take, share running production -> attraction).
CROSSING = {"CBS": "HBS", "CBR": "HBO", "CBV": "HBO"}
VEHICLE_CLASSES = {  # model class -> census classes, and whether the driver is one of the trip-makers
    "PV": (["private_car", "motorcycle"], True),
    "TAXI": (["taxi"], False),
    "SPB": (["private_light_bus", "non_franchised_bus"], True),
}
CENSUS_YEAR = 2024
PEAK_FROM_CENSUS = ["PV", "TAXI", "SPB"]  # classes whose peak-hour share the census sets (see census_peak_share)
STATIONS = WEB / "traffic" / "atc-stations.json"


def peak_fractions(params: dict) -> tuple[dict, dict]:
    """Each purpose's fraction of daily trips in the peak hour, and the share of those leaving home."""
    profile = params["hourly_profile_pct"]
    direction = params["peak_hour_direction_pct"]
    fraction = {p: profile[k][PEAK] / sum(profile[k]) for p, k in PROFILE_KEY.items()}
    to_work = direction["home_to_work_0800"] / 100 * 0.5  # of the daily matrix, which holds both legs
    from_home = {
        "HBW": min(1.0, to_work / fraction["HBW"]),
        "HBS": 1.0,
        "HBO": HBO_FROM_HOME,
        "NHB": 0.5,
    }
    for purpose, like in CROSSING.items():
        fraction[purpose] = fraction[like]
        from_home[purpose] = 1.0 if like == "HBS" else 0.5
    return fraction, from_home


def census_occupancy(band: str = PEAK_BAND) -> tuple[dict, dict]:
    """Trip-makers per vehicle by model class, and the census vehicle mix, for one band of hours."""
    s = json.loads(OCCUPANCY.read_text(encoding="utf-8"))["summary"][str(CENSUS_YEAR)][band]
    per_vehicle = {}
    for name, (classes, driver_travels) in VEHICLE_CLASSES.items():
        share = sum(s["share"][c] for c in classes)
        people = sum(s["share"][c] * s["occupancy"][c] for c in classes)
        per_vehicle[name] = people / share - (0 if driver_travels else 1)
    return per_vehicle, {"shares": s["share"], "stations": s["stations"], "year": CENSUS_YEAR}


def census_peak_share() -> dict:
    """Share of each class's weekday traffic in 08:00-09:00 at the core stations: the station's hourly
    share of its two-way AADT x the OCC sheet's share of the class in that hour (the 16-hour share at
    night, when the OCC sheet does not count), summed over stations."""
    census = json.loads(STATIONS.read_text(encoding="utf-8"))
    profile = {h["station"]: h["weekday_pct"] for h in census["hourly"] if h["year"] == CENSUS_YEAR}
    aadt: dict[int, float] = {}
    for r in census["records"]:
        if r["year"] == CENSUS_YEAR and isinstance(r.get("aadt"), (int, float)):
            aadt[r["station"]] = aadt.get(r["station"], 0) + r["aadt"]
    sheets = [o for o in json.loads(OCCUPANCY.read_text(encoding="utf-8"))["stations"]
              if o["year"] == CENSUS_YEAR and o["station"] in profile and o["station"] in aadt]
    shares = {}
    for m in PEAK_FROM_CENSUS:
        classes = VEHICLE_CLASSES[m][0]
        peak = day = 0.0
        for sheet in sheets:
            s = sheet["station"]
            for hour in range(24):
                band = f"{hour:02d}00-{hour + 1:02d}00"
                mix = sheet["hours"].get(band) or sheet["hours"]["16 hours"]
                v = aadt[s] * profile[s][hour] / 100 * sum(mix[c]["share_pct"] for c in classes) / 100
                day += v
                peak += v if band == PEAK_BAND else 0.0
        shares[m] = peak / day
    return shares


def main() -> None:
    params = json.loads(PARAMETERS.read_text(encoding="utf-8"))
    daily = np.load(MODE_SPLIT)
    zones = daily["zones"]
    fraction, from_home = peak_fractions(params)
    report, flags = [], []

    people = {m: np.zeros((len(zones), len(zones))) for m in MODES}
    purposes = sorted({k.split("_")[1] for k in daily.files if k.startswith("T_")},
                      key=lambda p: list(fraction).index(p))
    by_purpose = {}
    for purpose in purposes:
        f, d = fraction[purpose], from_home[purpose]
        for m in MODES:
            t = daily[f"T_{purpose}_{m}"].astype(np.float64)
            people[m] += f * (d * t + (1 - d) * t.T)
        by_purpose[purpose] = f * sum(daily[f"T_{purpose}_{m}"].sum() for m in MODES)
        report.append(f"{purpose}：全日 {f:.1%} 在 8-9 时，其中 {d:.0%} 由家（产生端）出发")

    all_daily = sum(daily[k].sum() for k in daily.files if k.startswith("T_"))
    home_grown = sum(daily[k].sum() for k in daily.files if k.startswith("T_") and k.split("_")[1] in PROFILE_KEY)
    in_hour = sum(by_purpose[p] for p in PROFILE_KEY)
    figure = sum(params["hourly_profile_pct"][k][PEAK] for k in PROFILE_KEY.values()) / 100
    report.append(f"8-9 时机动化出行 {sum(by_purpose.values()) / 1e6:.2f} 百万（全日 {all_daily / 1e6:.2f} 百万）；"
                  f"本地四类目的占全日 {in_hour / home_grown:.1%}，图 3.3 为 {figure:.1%}"
                  + ("" if abs(in_hour / home_grown - figure) < 0.005 else "  ← 需复核"))
    if abs(in_hour / home_grown - figure) >= 0.005:
        flags.append("peak share")
    report.append("8-9 时按方式（人次）：" + "、".join(f"{m} {people[m].sum() / 1e3:,.0f} 千" for m in MODES))

    per_vehicle, census = census_occupancy()
    vehicles = {m: people[m] / per_vehicle[m] for m in VEHICLE_CLASSES}

    # Cars and taxis are less peaked than TCS's all-mode profile makes them: take the census's own
    # share of each class's day in 08:00-09:00, and give the difference to public transport so the
    # hour keeps TCS's total.
    per_vehicle_day, _ = census_occupancy("16 hours")
    counted = census_peak_share()
    moved = 0.0
    for m in PEAK_FROM_CENSUS:
        day = sum(daily[f"T_{p}_{m}"].sum() for p in purposes) / per_vehicle_day[m]
        model_share = vehicles[m].sum() / day
        scale = counted[m] / model_share
        moved += people[m].sum() * (1 - scale)
        report.append(f"{m} 8-9 时占全日车次：出行调查时段比例得 {model_share:.1%}，普查 {counted[m]:.1%} → 按普查 ×{scale:.2f}")
        vehicles[m] *= scale
        people[m] *= scale
    people["PT"] *= 1 + moved / people["PT"].sum()
    report.append(f"移给公共交通 {moved:,.0f} 人次（8-9 时总人次仍为图 3.3 的比例）；公共交通 8-9 时 {people['PT'].sum() / 1e3:,.0f} 千人次")
    report.append(f"每车人数（{census['year']} 年运输署年度交通普查 8-9 时，{census['stations']} 个核心站，按站日均车流加权）："
                  + "、".join(f"{m} {v:.2f}" for m, v in per_vehicle.items())
                  + "（私家车含司机；的士不含司机、已含空车巡游）")
    report.append("8-9 时车辆（车次）：" + "、".join(f"{m} {v.sum() / 1e3:,.1f} 千" for m, v in vehicles.items()))

    # Check the census did not set: the vehicle-km mix of private vehicles and taxis against the census's mix.
    car = np.load(CAR)
    n = len(car["zones"])
    if list(car["zones"]) != list(zones[:n]):
        raise RuntimeError("car skim and mode split zone orders differ")
    km = car["distance_km"]
    reach = np.isfinite(km)
    vkm = {m: (vehicles[m][:n, :n][reach] * km[reach]).sum() for m in ("PV", "TAXI")}
    shares = census["shares"]
    counted_pv = shares["private_car"] + shares["motorcycle"]
    counted = shares["taxi"] / (counted_pv + shares["taxi"])
    modelled = vkm["TAXI"] / (vkm["PV"] + vkm["TAXI"])
    report.append(f"核对：的士占（私家车 + 的士）车公里 模型 {modelled:.0%}，普查站车流 {counted:.0%}"
                  "（普查站多在干道，市区短途的士较少经过；分配后按站再比）"
                  + ("" if abs(modelled - counted) < 0.10 else "  ← 需复核"))
    if abs(modelled - counted) >= 0.10:
        flags.append("taxi share")
    report.append("普查 8-9 时车种组成：" + "、".join(f"{c} {v:.1%}" for c, v in shares.items()))

    np.savez_compressed(OUTPUT, zones=zones,
                        **{f"P_{m}": people[m].astype(np.float32) for m in MODES},
                        **{f"V_{m}": vehicles[m].astype(np.float32) for m in VEHICLE_CLASSES})
    AUDIT.write_text(json.dumps({
        "period": "weekday 08:00-09:00, 2026",
        "fraction_of_daily": {p: round(v, 4) for p, v in fraction.items()},
        "from_home_share": {p: round(v, 3) for p, v in from_home.items()},
        "assumed": {"HBO_from_home": HBO_FROM_HOME},
        "people_per_vehicle": {m: round(v, 3) for m, v in per_vehicle.items()},
        "census_vehicle_mix": {c: round(v, 4) for c, v in shares.items()},
        "people": {m: round(float(people[m].sum())) for m in MODES},
        "vehicles": {m: round(float(v.sum())) for m, v in vehicles.items()},
        "flags": flags, "report": report,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"-> {OUTPUT.relative_to(ROOT)}")
    for line in report:
        print("   " + line)


if __name__ == "__main__":
    main()
