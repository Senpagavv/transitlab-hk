"""Step 3 of the four-step model: how each trip travels - private vehicle, taxi, public transport or
special purpose bus - on a weekday in 2026.

Input : data/model/trip-distribution-2026.npz     trips by purpose between every pair of zones (pipeline/22)
        data/model/trip-ends-2026.parquet         zone order, districts, control points (pipeline/21)
        data/model/landuse-2026.parquet           households by type of housing (pipeline/16)
        data/model/skim-car-freeflow.npz          car minutes, kilometres and tolls (pipeline/17)
        data/model/skim-active-transit.npz        public transport door-to-door minutes (pipeline/18)
        data/model/parameters-tcs2022.json        TCS 2022: values of time, car availability, boardings by
                                                  mode and purpose, stated mode switching (pipeline/20)
        data/raw/socioeconomic/csd_130-06606.json C&SD median monthly household income (values of time to 2026)
        data/raw/fares/mtr_lines_fares.csv        MTR Corporation fare table (adult Octopus)
        data/raw/fares/taxi-fare-urban.json       Transport Department urban taxi fare scale
        data/raw/gtfs_community/hk.gtfs.zip       station positions, to fit fares to distance
        data/web/cross-boundary.json              control point positions (pipeline/13)
        data/web/traffic/atc-occupancy.json       Annual Traffic Census vehicle mix and people per vehicle (pipeline/07)
Output: data/model/mode-split-2026.npz            trips by purpose and mode between every pair of zones
        data/web/mode-choice-audit.json

The structure follows the government's own model (TPDM Volume 1, 1.4.5.16): households with and
without a private vehicle are kept apart, each chooses among the modes open to it by generalised
cost - minutes, plus money divided by that group's value of time - and the choice is a logit.

  who has a car  - TCS Table 4.2 gives the share of households with a private vehicle by type of
                   housing (public rental 5.5%, subsidised sale 12.1%, private 25.1%); each zone's
                   mix of the three comes from the census (its "public" households are public
                   rental only; subsidised sale is what is left after public rental and private).
                   The result is scaled to TCS Table A.4, district by district.
  what it costs  - private vehicle: driving time + a 5-minute walk at each end (TCS E.2.19) + tolls;
                   taxi: driving time + the metered urban fare (Transport Department scale) + the
                   tunnel tolls, which in Hong Kong the passenger pays on top of the meter (TD's
                   fare page: HK$25 plus a HK$25 return toll at each of the three harbour crossings,
                   HK$28 at Tai Lam, HK$20 at Tate's Cairn, HK$8 elsewhere). The skim carries the
                   private car toll (HK$40/40/60 at the harbour, HK$45 at Tai Lam, the same HK$8 and
                   HK$20 elsewhere), which is within about a quarter of what the passenger pays, so
                   it is used as it stands rather than skimmed a second time;
                   public transport: door-to-door time + a fare fitted to the MTR fare table by
                   distance; special purpose bus (school and residents' coaches): driving time.
                   Parking, fuel and the wait for a taxi or coach vary too little from place to
                   place to be told apart from each mode's own constant, which absorbs them.
  what time is   - TCS Table E.6 values of time (2022 prices), raised to 2026 with median household
    worth          income, as TPDM 1.4.6.11 prescribes ("in line with incomes").
  who has a car, - TCS Table 4.2 also shows that larger households have cars more often, so more
    per person     PEOPLE than households live with one (21% against 17%). Household shares are turned
                   into shares of people with that factor - without it, even every car household using
                   its car for every trip could not reach the survey's 20.5% of other-purpose trips.
  how sensitive  - one coefficient on generalised minutes, fitted to TCS Table 5.2: 24% of people
                   would switch mode if their usual trip took 15 minutes longer, 56% at 30, 59% at 45.
                   The survey's "switch" includes switching within public transport (bus to MTR),
                   which this step does not see, so the fit is checked again in assignment against
                   cars counted on the harbour crossings and screenlines. (A first fit that also
                   estimated a "no alternative" share ran off to an implausible 0.275 per minute.)
  how many       - each mode's constant, per purpose, is set so that the trips on it match TCS Table
                   A.3 (a private vehicle, taxi or coach trip is one boarding; public transport takes
                   what remains of each purpose's trips).
  how far by     - with the whole metered fare turned into minutes at the average value of time,
    taxi           taxis only won trips under 3 km (mean 2.5 km). Two independent figures say taxi
                   trips are two to three times longer:
                   * the Annual Traffic Census counts taxis as 25% of private vehicle + taxi traffic
                     at its core stations (16 hours, 2024, stations weighted by AADT) - the model
                     gave 10%;
                   * the taxi trade's own figures (LegCo brief, file ref. TLB CR 1/5581/00, 14 May
                     2024, Annex B: about HK$36,000-45,000 meter revenue per driver-shift a month in
                     2023, two shifts, ~18,100 taxis; LegCo Research Office ISSH03/2025: 729,000
                     passengers a day in 2023; both in data/raw/taxi/) give about HK$60 a passenger,
                     6-7 km a hire at the 2023 scale - a rough figure (shifts per taxi and people per
                     hire are assumed), used only as a check.
                   Fitted (2026-09-18): weight 0.35, taxis 25.4% of vehicle-km, mean taxi trip
                   5.8 km (private vehicle 10.4 km); the time sensitivity moved from 0.062 to 0.060.
                   Taxi riders weigh the fare less than the average person of their group: they are
                   the ones with the higher values of time, groups split the fare, and some trips are
                   paid by employers. One weight on the taxi fare is fitted so that taxis carry the
                   census's share of vehicle-km (people -> vehicles with the census's people per
                   vehicle), and the resulting mean trip length is checked against the trade's
                   figure. The census stations are mostly on main roads, which short taxi trips use
                   less, so the share is checked again station by station after assignment.

Walking and cycling are not in this step: they are estimated separately (decided 2026-09-17).
Cross-boundary trips use the no-car choice of the purpose closest to them (students: school; the
rest: other) - an assumption until the Cross-boundary Travel Survey is brought in.
Driving times are free-flow here; congested times from assignment replace them in the feedback loop.

Run from the project root (a minute or two):
    uv run python pipeline/23_mode_choice.py
"""

import io
import json
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "data" / "model"
RAW = ROOT / "data" / "raw"
WEB = ROOT / "data" / "web"
DISTRIBUTION = MODEL / "trip-distribution-2026.npz"
TRIP_ENDS = MODEL / "trip-ends-2026.parquet"
LANDUSE = MODEL / "landuse-2026.parquet"
CAR = MODEL / "skim-car-freeflow.npz"
TRANSIT = MODEL / "skim-active-transit.npz"
PARAMETERS = MODEL / "parameters-tcs2022.json"
INCOME = RAW / "socioeconomic" / "csd_130-06606.json"
HOUSEHOLD_SIZE = RAW / "socioeconomic" / "csd_130-06601.json"
AVERAGE_SIZE = RAW / "socioeconomic" / "csd_130-06806.json"
MTR_FARES = RAW / "fares" / "mtr_lines_fares.csv"
TAXI_FARE = RAW / "fares" / "taxi-fare-urban.json"
STATIONS = RAW / "gtfs_community" / "hk.gtfs.zip"
CROSS_BOUNDARY = WEB / "cross-boundary.json"
CENTRES = MODEL / "zone-centres.parquet"
OCCUPANCY = WEB / "traffic" / "atc-occupancy.json"
TD_DIGEST = MODEL / "td-digest-series.json"
OUTPUT = MODEL / "mode-split-2026.npz"
AUDIT = WEB / "mode-choice-audit.json"

PURPOSES = ["HBW", "HBS", "HBO", "NHB"]
MODES = ["PV", "TAXI", "PT", "SPB"]
TARGET_ROWS = {"PV": "Private Vehicle", "TAXI": "Taxi", "SPB": "SPB"}
# Taxi trips are anchored to the Transport Department's own count, not to the 2022 survey. The survey
# was taken when taxis carried 711,000 passengers a day; by 2025 that was 676,105 (Monthly Traffic and
# Transport Digest, Table 2.1S, "average daily passenger journeys": 2021 762,328 / 2022 711,113 /
# 2023 727,948 / 2024 682,646 / 2025 676,105 - a tenth of the trade gone in four years, and then a
# turn back up: the twelve months to June 2026 average 687,995, which is why td_taxi_daily() below
# reads the series pipeline/30 parses rather than carrying a number somebody typed in). Taking the
# survey's share unchanged puts 44% more taxi trips on the road than the Department counts, and since
# the taxi fare weight below is fitted to the census's share of vehicle kilometres, the model made up
# for it by shortening every trip: 5.8 km, about HK$69 on the urban scale, against a real average fare
# nearer HK$95. Anchoring the number of trips and refitting the fare weight fixes both at once -
# fewer, longer trips, the same vehicle kilometres the census counts.
TD_TAXI_MONTHS = 12  # the anchor is the latest this many months, which takes the seasons out of it
WEEKDAY_FACTOR = 1.0418  # census 2024: weekday AADT / all-day AADT over 356 counted directions
# Cross-boundary taxi is not set by these targets - those purposes borrow a home-grown purpose's
# choice - and it barely moves when the local targets do: cutting local taxi by 29% took only 7% off
# it, because a trip to the boundary has few alternatives. So it is subtracted from the anchor as a
# measured quantity rather than scaled with the rest. main() checks it has not drifted.
TAXI_CROSS_BOUNDARY = 134_300  # weekday person trips, measured on the previous run


def td_taxi_daily() -> tuple[float, str, str]:
    """Taxi passenger journeys a day, the Transport Department's own count (pipeline/30).

    Read rather than written down: the digest is published monthly, and a number typed into this file
    goes stale without anyone noticing. The 2025 annual average was 676,105; the twelve months to
    June 2026 average 687,995, because patronage turned back up - which a hard-coded constant
    would have missed.
    """
    series = json.loads(TD_DIGEST.read_text(encoding="utf-8"))["patronage_thousand_per_day"]["monthly"]
    months = sorted(series)[-TD_TAXI_MONTHS:]
    if len(months) < TD_TAXI_MONTHS:
        raise RuntimeError(f"only {len(months)} months in td-digest-series.json - rerun pipeline/30")
    return sum(series[m]["Taxis"] for m in months) * 1000 / len(months), months[0], months[-1]
VOT_KEY = {"HBW": "HBW", "HBS": "HBS", "HBO": "HBO_NHB", "NHB": "HBO_NHB"}
TRIPS_KEY = {"HBW": "HBW", "HBS": "HBS", "HBO": "HBO", "NHB": "NHB_EB"}
# Cross-boundary purposes borrow the no-car choice of the nearest home-grown purpose.
CROSSING = {"CBS": "HBS", "CBR": "HBO", "CBV": "HBO"}
SURVEY_YEAR, BASE_YEAR = 2022, 2026
CONNECTOR_KPH = 40.0  # control point to its host zone, as in pipeline/22
SENSITIVITY_RANGE = (0.01, 0.20)  # per generalised minute
SWITCHING_TOLERANCE = 0.10  # root mean square gap to Table 5.2 accepted
PEOPLE_SHARE_CAP = 0.97  # a zone where nearly everyone lives with a car still has a few who do not
ASC_TOLERANCE = 1e-4  # relative gap between modelled and target trips per mode
CENSUS_YEAR = 2024
TAXI_WEIGHT_RANGE = (0.05, 1.0)  # share of the metered fare a taxi rider weighs, at the group's value of time
# Mean taxi trip. Two ways to it: the trade's own revenue figures say 6-7 km (see the docstring), and
# the Department's 676,105 passengers a day against the vehicle kilometres the census counts says
# about 8-9 km. Anything outside this band means the fit went wrong.
TAXI_TRIP_KM = (5.0, 11.0)


def expand(inner: np.ndarray, order: list[str], ids: list[str], hosts: dict[str, str],
           extra: dict[str, float]) -> np.ndarray:
    """A zone-by-zone matrix widened to the control points, through the zone each hangs off."""
    n = len(order)
    full = np.full((len(ids), len(ids)), np.inf)
    full[:n, :n] = inner
    for k, zone in enumerate(ids[n:], start=n):
        host = order.index(hosts[zone])
        full[k, :n] = inner[host] + extra[zone]
        full[:n, k] = inner[:, host] + extra[zone]
    return full


def person_factor(params: dict, report: list[str]) -> float:
    """How much more common a car is per person than per household.

    Larger households have cars more often (TCS Table 4.2: one person 7.0%, five or more 34.7%), so
    the share of PEOPLE living with a car is higher than the share of households. Weighted by the
    C&SD household size distribution of the survey year, with the size of the "five or more" group
    taken from the published average household size.
    """
    rates = {int(k): v for k, v in params["pv_availability_pct"]["by_household_size"].items()}
    sizes = json.loads(HOUSEHOLD_SIZE.read_text(encoding="utf-8"))["dataSet"]
    count = {r["HHSIZE"]: r["figure"] for r in sizes
             if r["freq"] == "Y" and r["period"] == str(SURVEY_YEAR) and r["svDesc"].startswith("No.")}
    average = next(r["figure"] for r in json.loads(AVERAGE_SIZE.read_text(encoding="utf-8"))["dataSet"]
                   if r["freq"] == "Y" and r["period"] == str(SURVEY_YEAR) and r["DCDesc"] == "Total")
    households = {1: count[1], 2: count[2], 3: count[3], 4: count[4], 5: count["5_and_over"]}
    people = {s: households[s] * s for s in (1, 2, 3, 4)}
    people[5] = average * count[""] - sum(people.values())
    per_household = sum(households[s] * rates[s] for s in households) / sum(households.values())
    per_person = sum(people[s] * rates[s] for s in people) / sum(people.values())
    factor = per_person / per_household
    report.append(f"人口加权：有车住户 {per_household:.1f}%，住在有车家庭的人 {per_person:.1f}%（表 4.2 按家庭人数 × "
                  f"统计处 {SURVEY_YEAR} 年住户人数分布，5 人及以上户均 {people[5] / households[5]:.1f} 人）→ 系数 {factor:.3f}")
    return factor


def pv_share(ends: pd.DataFrame, params: dict, report: list[str]) -> pd.Series:
    """Share of each zone's PEOPLE living in a household with a private vehicle.

    Household shares by type of housing, scaled to TCS Table A.4 district by district, then turned
    into shares of people with the household-size factor.
    """
    zones = pd.read_parquet(LANDUSE).set_index("zone")
    rates = params["pv_availability_pct"]
    public = zones["households_public"].astype(float)            # census: public rental housing
    private = zones["households_private"].astype(float)          # census: private permanent housing
    subsidised = (zones["households"] - public - private).clip(lower=0).astype(float)  # the rest
    cars = (public * rates["public_rental"]["private_vehicle"] + subsidised * rates["subsidised_sale"]["private_vehicle"]
            + private * rates["private"]["private_vehicle"]) / 100
    raw = (cars / zones["households"].replace(0, np.nan)).fillna(0.0)

    broad = ends.loc[zones.index, "broad"]
    survey = pd.Series({d: v["pv_available_pct"] / 100 for d, v in params["broad_districts"]["districts"].items()})
    modelled = cars.groupby(broad).sum() / zones["households"].groupby(broad).sum()
    scale = (survey / modelled).reindex(broad).to_numpy()
    households = (raw * scale).clip(0, 1)
    territory = float((households * zones["households"]).sum() / zones["households"].sum())
    report.append(f"有车家庭：按公屋 {rates['public_rental']['private_vehicle']}% / 资助出售 "
                  f"{rates['subsidised_sale']['private_vehicle']}% / 私人 {rates['private']['private_vehicle']}%（表 4.2）"
                  f"按住房构成推算，再按 26 区对齐表 A.4（区系数 {scale.min():.2f}–{scale.max():.2f}）；"
                  f"全港住户 {territory:.1%}（调查 {params['broad_districts']['territory']['pv_available_pct']}%）")
    factor = person_factor(params, report)
    people = (households * factor).clip(0, PEOPLE_SHARE_CAP)
    capped = int((households * factor > PEOPLE_SHARE_CAP).sum())
    if capped:
        report.append(f"有车人口比例封顶 {PEOPLE_SHARE_CAP:.0%} 的小区 {capped} 个")
    return people


def values_of_time(params: dict, report: list[str]) -> dict:
    """HK$ per minute in 2026, by purpose and car availability."""
    income = json.loads(INCOME.read_text(encoding="utf-8"))["dataSet"]
    total = [r for r in income if r["HHSIZEDesc"] == "Total"]
    survey = next(r["figure"] for r in total if r["freq"] == "Y" and r["period"] == str(SURVEY_YEAR))
    latest = sorted((r for r in total if r["freq"] == "Q" and r["period"].startswith(str(BASE_YEAR))),
                    key=lambda r: r["period"])
    if not latest:
        raise RuntimeError(f"no {BASE_YEAR} quarters in the income table - refresh it")
    base = float(np.mean([r["figure"] for r in latest]))
    growth = base / survey
    table = params["value_of_time_cents_per_min_2022"]
    vot = {(p, seg): table[key][VOT_KEY[p]] / 100 * growth
           for p in PURPOSES for seg, key in (("pv", "pv_available"), ("nopv", "no_pv"))}
    report.append(f"时间价值：表 E.6（2022 年价格）× 住户入息中位数 {survey:,.0f} → {base:,.0f} 元"
                  f"（{latest[0]['period']}–{latest[-1]['period']}，+{growth - 1:.1%}）；有车家庭上班 "
                  f"{vot[('HBW', 'pv')]:.2f} 元/分钟，无车家庭上班 {vot[('HBW', 'nopv')]:.2f} 元/分钟")
    return vot


def fare_by_distance(report: list[str]) -> tuple[float, float]:
    """Adult Octopus MTR fare against the straight-line distance between the two stations."""
    fares = pd.read_csv(MTR_FARES)
    feed = zipfile.ZipFile(STATIONS)
    stops = pd.read_csv(io.BytesIO(feed.read("stops.txt")))
    stations = stops[stops["location_type"] == 1]
    key = lambda name: name.lower().replace(" station", "").replace("-", " ").strip()
    where = {key(r.stop_name): (r.stop_lon, r.stop_lat) for r in stations.itertuples()}
    fares = fares[fares["SRC_STATION_ID"] != fares["DEST_STATION_ID"]].copy()
    fares["a"] = fares["SRC_STATION_NAME"].map(lambda n: where.get(key(n)))
    fares["b"] = fares["DEST_STATION_NAME"].map(lambda n: where.get(key(n)))
    fares = fares.dropna(subset=["a", "b"])
    lon1, lat1 = np.array(fares["a"].tolist()).T
    lon2, lat2 = np.array(fares["b"].tolist()).T
    km = np.hypot((lon2 - lon1) * 111.32 * np.cos(np.radians(22.35)), (lat2 - lat1) * 110.57)
    price = fares["OCT_ADT_FARE"].to_numpy(dtype=float)
    # Airport Express and the cross-boundary stations price a different product; fit the network fares.
    ordinary = price < np.quantile(price, 0.98)
    slope, intercept = np.polyfit(km[ordinary], price[ordinary], 1)
    fitted = intercept + slope * km[ordinary]
    r2 = 1 - ((price[ordinary] - fitted) ** 2).sum() / ((price[ordinary] - price[ordinary].mean()) ** 2).sum()
    report.append(f"车费：港铁成人八达通车费 ≈ {intercept:.2f} + {slope:.2f} × 直线公里（{int(ordinary.sum()):,} 对车站，"
                  f"R² {r2:.2f}），用作全部公共交通的车费近似；巴士、小巴按同一关系，属假设")
    return intercept, slope


def taxi_fare(km: np.ndarray) -> np.ndarray:
    scale = json.loads(TAXI_FARE.read_text(encoding="utf-8"))
    steps = np.maximum(0.0, (km - scale["flag_fall_km"]) * 1000 / scale["step_m"])
    low = scale["flag_fall_hkd"] + steps * scale["step_hkd_below_threshold"]
    steps_to_threshold = (scale["threshold_hkd"] - scale["flag_fall_hkd"]) / scale["step_hkd_below_threshold"]
    high = scale["threshold_hkd"] + (steps - steps_to_threshold) * scale["step_hkd_above_threshold"]
    return np.where(low <= scale["threshold_hkd"], low, high)


class Choice:
    """Generalised costs, utilities and calibration for every purpose and car-availability group."""

    def __init__(self, report: list[str]) -> None:
        self.params = json.loads(PARAMETERS.read_text(encoding="utf-8"))
        demand = np.load(DISTRIBUTION, allow_pickle=True)
        self.ids = [str(z) for z in demand["zones"]]
        self.trips = {k[2:]: demand[k].astype(float) for k in demand.files if k.startswith("T_")}
        ends = pd.read_parquet(TRIP_ENDS).set_index("zone").loc[self.ids]
        car = np.load(CAR, allow_pickle=True)
        transit = np.load(TRANSIT, allow_pickle=True)
        order = [str(z) for z in car["zones"]]
        if order != [str(z) for z in transit["zones"]] or order != self.ids[:len(order)]:
            raise RuntimeError("skims and trip matrices are not in the same zone order")
        points = {f"X:{p['point']}": p for p in json.loads(CROSS_BOUNDARY.read_text(encoding="utf-8"))["control_points"]}
        external = [z for z in self.ids if z.startswith("X:")]
        hosts = {z: ends.at[z, "host_zone"] for z in external}
        km = {z: points[z]["zone_distance_m"] / 1000 for z in external}
        minutes = {z: km[z] / CONNECTOR_KPH * 60 for z in external}
        zero = {z: 0.0 for z in external}
        self.car_min = expand(car["time_min"].astype(float), order, self.ids, hosts, minutes)
        self.car_km = expand(car["distance_km"].astype(float), order, self.ids, hosts, km)
        self.toll = expand(car["toll_hkd"].astype(float), order, self.ids, hosts, zero)
        self.pt_min = expand(transit["transit_min"].astype(float), order, self.ids, hosts, minutes)

        self.walk_end = self.params["access_walk_min"]["per_trip_end"]
        self.vot = values_of_time(self.params, report)
        a, b = fare_by_distance(report)
        # Fares are fitted to straight-line distance, and measured the same way here - the road
        # distance would leave Cheung Chau, Peng Chau and Lamma (no roads) without a fare at all.
        centres = pd.read_parquet(CENTRES).set_index("zone").reindex(order)
        lon = np.concatenate([centres["lon"].to_numpy(), [points[z]["lon"] for z in external]])
        lat = np.concatenate([centres["lat"].to_numpy(), [points[z]["lat"] for z in external]])
        straight = np.hypot((lon[:, None] - lon[None, :]) * 111.32 * np.cos(np.radians(22.35)),
                            (lat[:, None] - lat[None, :]) * 110.57)
        self.pt_fare = a + b * straight
        self.taxi_fare = taxi_fare(np.where(np.isfinite(self.car_km), self.car_km, 0.0))
        self.taxi_weight = 1.0  # fitted in main() to the census's taxi traffic
        share = pv_share(ends.loc[order], self.params, report)
        self.pv = np.concatenate([share.reindex(order).to_numpy(), np.zeros(len(external))])
        self.targets = self.mode_targets(report)

    def mode_targets(self, report: list[str]) -> dict:
        """Trips per purpose and mode that the constants must reproduce (TCS Table A.3 and 3.3)."""
        boardings = self.params["boardings_by_mode_purpose"]
        survey_trips = self.params["weekday_mechanised_trips"]
        targets = {}
        for purpose in PURPOSES:
            column = TRIPS_KEY[purpose]
            share = {m: boardings[row][column] / survey_trips[column] for m, row in TARGET_ROWS.items()}
            share["PT"] = 1 - sum(share.values())
            total = self.trips[purpose].sum()
            targets[purpose] = {m: share[m] * total for m in MODES}

        # Anchor taxi to the Transport Department's count; public transport takes up the difference,
        # which is where the trade says its lost trips went.
        survey_taxi = sum(targets[p]["TAXI"] for p in PURPOSES)
        daily, first_month, last_month = td_taxi_daily()
        self.td_taxi_daily = daily
        anchor = daily * WEEKDAY_FACTOR - TAXI_CROSS_BOUNDARY
        self.taxi_anchor_factor = anchor / survey_taxi
        for purpose in PURPOSES:
            moved = targets[purpose]["TAXI"] * (1 - self.taxi_anchor_factor)
            targets[purpose]["TAXI"] -= moved
            targets[purpose]["PT"] += moved
        report.append(
            f"的士出行锚定到运输署月报表 2.1S：{first_month}–{last_month} 共 {TD_TAXI_MONTHS} 个月平均每日乘客 {daily:,.0f} 人次 × 工作日系数 "
            f"{WEEKDAY_FACTOR:.4f} − 跨境 {TAXI_CROSS_BOUNDARY:,} = 本地目标 {anchor:,.0f}；"
            f"调查（附录 A.3）为 {survey_taxi:,.0f}，缩放 {self.taxi_anchor_factor:.3f}，差额 "
            f"{survey_taxi - anchor:,.0f} 人次全部计入公共交通。"
            "调查在 2022 年做，当时的士每日 711,113 人次；2024 年跌到 682,646、2025 年 676,105，2026 年又回升")
        report.append("方式目标（附录 A.3 乘车次数 ÷ 表 3.3 出行数，的士已按上一行锚定；私家车/的士/校车一程即一次乘车）："
                      + "；".join(f"{p} " + "/".join(f"{m} {targets[p][m] / self.trips[p].sum():.1%}" for m in MODES)
                                 for p in PURPOSES))
        return targets

    def costs(self, purpose: str, group: str) -> dict[str, np.ndarray]:
        """Generalised minutes by mode for one purpose and car-availability group."""
        vot = self.vot[(purpose, group)]
        return {
            "PV": self.car_min + 2 * self.walk_end + self.toll / vot,
            "TAXI": self.car_min + self.taxi_weight * (self.taxi_fare + self.toll) / vot,
            "PT": self.pt_min + self.pt_fare / vot,
            "SPB": self.car_min,
        }

    def probabilities(self, costs: dict, constants: dict, sensitivity: float, group: str,
                      extra: dict | None = None) -> dict[str, np.ndarray]:
        modes = MODES if group == "pv" else [m for m in MODES if m != "PV"]
        utility = {}
        for m in modes:
            cost = costs[m] + (extra or {}).get(m, 0.0)
            utility[m] = np.where(np.isfinite(cost), constants[m] - sensitivity * np.where(np.isfinite(cost), cost, 0), -np.inf)
        top = np.max(np.stack(list(utility.values())), axis=0)
        top = np.where(np.isfinite(top), top, 0.0)
        weights = {m: np.exp(u - top) for m, u in utility.items()}
        total = sum(weights.values())
        return {m: np.divide(weights.get(m, 0.0) * 1.0, total, out=np.zeros_like(total), where=total > 0)
                for m in MODES}

    def split(self, purpose: str, constants: dict, sensitivity: float) -> dict[str, np.ndarray]:
        """Trips by mode for one purpose, both groups added."""
        trips = self.trips[purpose]
        share = self.pv[:, None]  # by the production end: the home, or for NHB the origin
        out = {m: np.zeros_like(trips) for m in MODES}
        for group, weight in (("pv", share), ("nopv", 1 - share)):
            probability = self.probabilities(self.costs(purpose, group), constants, sensitivity, group)
            for m in MODES:
                out[m] += trips * weight * probability[m]
        return out

    def calibrate_constants(self, purpose: str, sensitivity: float) -> tuple[dict, dict, float]:
        constants = {m: 0.0 for m in MODES}
        for _ in range(200):
            split = self.split(purpose, constants, sensitivity)
            gap = 0.0
            for m in MODES:
                modelled = split[m].sum()
                target = self.targets[purpose][m]
                gap = max(gap, abs(modelled - target) / target)
                if m != "PT":
                    constants[m] += np.log(target / modelled)
            if gap < ASC_TOLERANCE:
                break
        return constants, split, gap

    def taxi_vehicle_km_share(self, splits: dict, per_pv: float, per_taxi: float) -> float:
        """Taxis' share of private vehicle + taxi vehicle-km, on the shortest free-flow routes."""
        reach = np.isfinite(self.car_km)
        vkm = {m: sum((splits[p][m][reach] * self.car_km[reach]).sum() for p in splits) / per
               for m, per in (("PV", per_pv), ("TAXI", per_taxi))}
        return vkm["TAXI"] / (vkm["PV"] + vkm["TAXI"])

    def mean_km(self, trips: np.ndarray) -> float:
        reach = np.isfinite(self.car_km)
        return float((trips[reach] * self.car_km[reach]).sum() / trips[reach].sum())

    def switching(self, sensitivity: float, constants: dict, extra_minutes: float) -> float:
        """Share of commuting trips whose mode would change if it took `extra_minutes` longer.

        In a logit model someone who chose mode m keeps it after m worsens with probability
        P_m(worse) / P_m(now), so the share switching is 1 - sum(P_m(worse)) over the trips' modes.
        """
        moved, total = 0.0, 0.0
        for purpose in ("HBW", "HBS"):
            trips = self.trips[purpose]
            for group, weight in (("pv", self.pv[:, None]), ("nopv", 1 - self.pv[:, None])):
                costs = self.costs(purpose, group)
                now = self.probabilities(costs, constants[purpose], sensitivity, group)
                for m in MODES:
                    if not now[m].any():
                        continue
                    worse = self.probabilities(costs, constants[purpose], sensitivity, group, {m: extra_minutes})
                    moved += (trips * weight * (now[m] - worse[m])).sum()
                total += (trips * weight).sum()
        return moved / total


def census_taxi_share(report: list[str]) -> tuple[float, float, float]:
    """The census's taxi share of private vehicle + taxi traffic over its 16 counted hours, and the
    trip-makers each carries (a private vehicle's driver makes the trip; a taxi's does not)."""
    s = json.loads(OCCUPANCY.read_text(encoding="utf-8"))["summary"][str(CENSUS_YEAR)]["16 hours"]
    share, occupancy = s["share"], s["occupancy"]
    private = share["private_car"] + share["motorcycle"]
    per_pv = (share["private_car"] * occupancy["private_car"] + share["motorcycle"] * occupancy["motorcycle"]) / private
    per_taxi = occupancy["taxi"] - 1
    taxi = share["taxi"] / (private + share["taxi"])
    report.append(f"年度交通普查 {CENSUS_YEAR}（{s['stations']} 个核心站，16 小时，按日均车流加权）：的士占（私家车 + 电单车 + 的士）"
                  f"{taxi:.1%}；每辆私家车/电单车 {per_pv:.2f} 人（含司机），每辆的士 {per_taxi:.2f} 名乘客（含空车巡游）")
    return taxi, per_pv, per_taxi


def golden_search(misfit, low: float, high: float, tolerance: float) -> float:
    golden = (5 ** 0.5 - 1) / 2
    tried = {}

    def f(x: float) -> float:
        tried[x] = misfit(x)
        return tried[x]

    a, b = high - golden * (high - low), low + golden * (high - low)
    fa, fb = f(a), f(b)
    while high - low > tolerance:
        if fa < fb:
            high, b, fb = b, a, fa
            a = high - golden * (high - low)
            fa = f(a)
        else:
            low, a, fa = a, b, fb
            b = low + golden * (high - low)
            fb = f(b)
    return min(tried, key=tried.get)


def main() -> None:
    report, flags = [], []
    choice = Choice(report)
    stated = choice.params["stated_mode_switching_pct"]
    extras, observed = stated["extra_minutes"], np.array(stated["switch_mode"]) / 100
    taxi_target, per_pv, per_taxi = census_taxi_share(report)
    tried = {}

    def misfit(sensitivity: float) -> float:
        # Constants are recalibrated at every sensitivity tried: the survey question is asked of
        # people making the trips the model actually has on each mode.
        constants = {p: choice.calibrate_constants(p, sensitivity)[0] for p in ("HBW", "HBS")}
        modelled = np.array([choice.switching(sensitivity, constants, e) for e in extras])
        tried[sensitivity] = (float(np.sqrt(np.mean((modelled - observed) ** 2))), modelled)
        print(f"   {sensitivity:.4f}: " + " / ".join(f"{m:.0%}" for m in modelled), flush=True)
        return tried[sensitivity][0]

    def taxi_share(weight: float, sensitivity: float) -> float:
        choice.taxi_weight = weight
        splits = {p: choice.calibrate_constants(p, sensitivity)[1] for p in PURPOSES}
        return choice.taxi_vehicle_km_share(splits, per_pv, per_taxi)

    def fit_taxi_weight(sensitivity: float) -> float:
        """The weight on the taxi fare at which taxis carry the census's share of vehicle-km. A heavier
        weight keeps taxis to shorter trips, so the share falls as the weight rises: bisect."""
        low, high = TAXI_WEIGHT_RANGE
        if taxi_share(high, sensitivity) >= taxi_target:
            return high
        if taxi_share(low, sensitivity) < taxi_target:
            return low
        while high / low > 1.01:
            mid = (low * high) ** 0.5
            share = taxi_share(mid, sensitivity)
            print(f"   的士车费权重 {mid:.3f}：车公里占比 {share:.1%}", flush=True)
            low, high = (mid, high) if share > taxi_target else (low, mid)
        return (low * high) ** 0.5

    # The two fits touch each other a little (taxi trips are 7% of the total), so alternate until
    # neither moves.
    sensitivity, window = None, SENSITIVITY_RANGE
    for round_ in range(1, 4):
        print(f"第 {round_} 轮：拟合时间敏感度（表 5.2）…", flush=True)
        tried.clear()
        new_sensitivity = golden_search(misfit, *window, 0.002)
        print(f"第 {round_} 轮：拟合的士车费权重（普查车公里占比 {taxi_target:.1%}）…", flush=True)
        old_weight = choice.taxi_weight
        choice.taxi_weight = fit_taxi_weight(new_sensitivity)
        settled = (sensitivity is not None and abs(new_sensitivity - sensitivity) < 0.003
                   and abs(choice.taxi_weight - old_weight) < 0.02)
        sensitivity = new_sensitivity
        window = (max(SENSITIVITY_RANGE[0], sensitivity - 0.02), min(SENSITIVITY_RANGE[1], sensitivity + 0.02))
        if settled:
            break
    else:
        flags.append("sensitivity and taxi weight not settled")
    misfit(sensitivity)
    error, modelled = tried[sensitivity]
    captive = 0.0
    report.append(f"时间敏感度 {sensitivity:.3f}/广义分钟（拟合表 5.2 三点）：出行时间多 "
                  + "、".join(f"{e} 分钟改用其他方式 {m:.0%}（调查 {o:.0%}）" for e, m, o in zip(extras, modelled, observed))
                  + f"；均方根误差 {error:.1%}。调查的「改用其他方式」也包括公共交通内部的转换（如巴士改港铁），"
                  "本步只分主方式，第四步要用过海与屏障线车流量复核"
                  + ("" if error < SWITCHING_TOLERANCE else "  ← 需复核"))
    if error >= SWITCHING_TOLERANCE:
        flags.append("sensitivity")
    if min(abs(sensitivity - s) for s in SENSITIVITY_RANGE) < 0.005:
        flags.append("sensitivity at bound")

    matrices, constants_all = {}, {}
    for purpose in PURPOSES:
        constants, split, gap = choice.calibrate_constants(purpose, sensitivity)
        constants_all[purpose] = {m: round(v, 4) for m, v in constants.items()}
        for m in MODES:
            matrices[f"{purpose}_{m}"] = split[m]
        shares = {m: split[m].sum() / choice.trips[purpose].sum() for m in MODES}
        report.append(f"{purpose}：" + "、".join(f"{m} {shares[m]:.1%}" for m in MODES)
                      + f"；常数 " + "、".join(f"{m} {constants[m]:+.2f}" for m in MODES if m != "PT")
                      + f"（公共交通为 0）；与目标最大偏差 {gap:.1e}" + ("" if gap < 1e-3 else "  ← 需复核"))
        if gap >= 1e-3:
            flags.append(f"{purpose} constants")

    for purpose, like in CROSSING.items():
        trips = choice.trips[purpose]
        probability = choice.probabilities(choice.costs(like, "nopv"), constants_all[like], sensitivity, "nopv")
        for m in MODES:
            matrices[f"{purpose}_{m}"] = trips * probability[m]
        report.append(f"{purpose}（借用 {like} 无车家庭的选择）：" + "、".join(
            f"{m} {matrices[f'{purpose}_{m}'].sum() / trips.sum():.1%}" for m in MODES if matrices[f"{purpose}_{m}"].sum() > 0))

    # Checks that the calibration did not see.
    local_taxi = sum(matrices[f"{p}_TAXI"].sum() for p in PURPOSES)
    boundary_taxi = sum(matrices[f"{p}_TAXI"].sum() for p in CROSSING)
    td_daily, _, _ = td_taxi_daily()
    hit = (local_taxi + boundary_taxi) / WEEKDAY_FACTOR
    off_boundary = abs(boundary_taxi / TAXI_CROSS_BOUNDARY - 1) > 0.05
    off_total = abs(hit / td_daily - 1) > 0.03
    report.append(f"的士锚定复核：本地 {local_taxi:,.0f} + 跨境 {boundary_taxi:,.0f} = {local_taxi + boundary_taxi:,.0f} 人次，"
                  f"折回全日 {hit:,.0f}，运输署 {td_daily:,.0f}（差 {hit / td_daily - 1:+.1%}，容许 3%）；"
                  f"跨境的士 {boundary_taxi:,.0f}（常量 {TAXI_CROSS_BOUNDARY:,}，容许 5%）"
                  + ("" if not (off_boundary or off_total) else "  ← 需复核"))
    if off_total:
        flags.append("taxi anchor total")
    if off_boundary:
        flags.append("taxi cross-boundary")

    total = {m: sum(matrices[f"{p}_{m}"].sum() for p in PURPOSES) for m in MODES}
    all_trips = sum(total.values())
    report.append("全部机动化出行：" + "、".join(f"{m} {v / 1e6:.2f} 百万（{v / all_trips:.1%}）" for m, v in total.items()))
    lost = sum(choice.trips[p].sum() for p in PURPOSES) - all_trips
    report.append(f"未能分配方式的出行 {lost:,.0f}" + ("" if abs(lost) < 1 else "  ← 需复核"))
    if abs(lost) >= 1:
        flags.append("unassigned")
    splits = {p: {m: matrices[f"{p}_{m}"] for m in MODES} for p in PURPOSES}
    share = choice.taxi_vehicle_km_share(splits, per_pv, per_taxi)
    taxi_km = choice.mean_km(sum(matrices[f"{p}_TAXI"] for p in PURPOSES))
    pv_km = choice.mean_km(sum(matrices[f"{p}_PV"] for p in PURPOSES))
    at_bound = min(abs(choice.taxi_weight - w) for w in TAXI_WEIGHT_RANGE) < 0.01
    report.append(f"的士车费权重 {choice.taxi_weight:.2f}（乘客按「车费 + 隧道费」的这一比例计入广义成本；"
                  f"香港的隧道费由乘客付，过海另加一程回程费）：的士占车公里 {share:.1%}，"
                  f"普查 {taxi_target:.1%}" + ("  ← 需复核（到达边界）" if at_bound else ""))
    in_band = TAXI_TRIP_KM[0] <= taxi_km <= TAXI_TRIP_KM[1]
    report.append(f"平均出行距离（最短行车路线）：的士 {taxi_km:.1f} 公里、私家车 {pv_km:.1f} 公里；"
                  f"由的士营业收入推算的每程约 6-7 公里" + ("" if in_band else "  ← 需复核"))
    if at_bound:
        flags.append("taxi weight at bound")
    if not in_band:
        flags.append("taxi trip length")
    finite = np.isfinite(choice.car_min) & np.isfinite(choice.pt_min)
    for mode, cost in (("PV", choice.car_min + 2 * choice.walk_end), ("PT", choice.pt_min)):
        trips = sum(matrices[f"{p}_{mode}"] for p in PURPOSES)
        mean = (trips[finite] * cost[finite]).sum() / trips[finite].sum()
        report.append(f"{mode} 出行的平均时间（引擎，{'自由流、含两端步行' if mode == 'PV' else '门到门'}）{mean:.0f} 分钟；"
                      f"调查自报 {choice.params['mean_journey_time_min']['private_vehicle_taxi' if mode == 'PV' else 'public_transport']} 分钟"
                      f"（{'分配后换成拥堵时间' if mode == 'PV' else '自报约为引擎的 1.28 倍，见第二步'}）")

    np.savez_compressed(OUTPUT, zones=np.array(choice.ids),
                        **{f"T_{k}": v.astype(np.float32) for k, v in matrices.items()})
    AUDIT.write_text(json.dumps({
        "method": "logit by purpose and car availability on generalised minutes; sensitivity fitted to TCS "
                  "Table 5.2, constants to TCS Table A.3",
        "sensitivity_per_min": sensitivity, "captive_share": captive, "constants": constants_all,
        "taxi_fare_weight": round(choice.taxi_weight, 4), "taxi_vehicle_km_share": round(share, 4),
        "census_taxi_share": round(taxi_target, 4), "mean_trip_km": {"TAXI": round(taxi_km, 2), "PV": round(pv_km, 2)},
        "values_of_time_hkd_per_min": {f"{p}_{g}": round(v, 3) for (p, g), v in choice.vot.items()},
        "targets": {p: {m: round(v) for m, v in t.items()} for p, t in choice.targets.items()},
        "flags": flags, "report": report,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"-> {OUTPUT.relative_to(ROOT)}")
    for line in report:
        print("   " + line)
    if flags:
        print("   需复核：" + ", ".join(flags))


if __name__ == "__main__":
    main()
