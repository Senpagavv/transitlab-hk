"""Step 2 of the four-step model: where each zone's trips go, on a weekday in 2026.

Input : data/model/trip-ends-2026.parquet        productions and attractions by purpose (pipeline/21)
        data/model/skim-active-transit.npz       door-to-door public transport times (pipeline/18)
        data/model/landuse-2026.parquet          zone order and districts (pipeline/16)
        data/model/parameters-tcs2022.json       the survey's journey times and trip movements (pipeline/20)
        data/web/cross-boundary.json             where each control point meets the network (pipeline/13)
Output: data/model/trip-distribution-2026.npz    one production-attraction matrix per purpose
        data/web/trip-distribution-audit.json

Method: a gravity model per purpose. Trips from zone i to zone j are
    T_ij = a_i * P_i * b_j * A_j * K_ij * exp(-beta * c_ij)
with a_i and b_j found by balancing (Furness) so that every zone sends exactly the trips step 1 gave
it and receives exactly the trips step 1 gave it - like balancing a pipe network whose node flows are
fixed. beta says how quickly people give up on a destination as it gets further away.

The cost c_ij is the public transport door-to-door time. More than eight in ten mechanised trips in
Hong Kong are on public transport, and the car matrix is still free-flow with no parking or walking
time, so it would make every place look closer than it is. This is a first pass: once mode choice
exists, its combined cost (the logsum) replaces this and the two steps are iterated to agreement.

Calibration, against three things TCS 2022 measured:
  how long - the mean journey time by purpose (work 48, school 39, other 36 minutes, all modes) and
             by mode (public transport 45 of an overall 42), so public transport work trips take
             48 x 45/42 minutes and so on. These are the times people REPORTED. Taken at face value
             against the engine's times, work trips could not be made long enough even with no decay
             at all, and trips across the harbour came out at 29% of the total against 15.9%.
             Reported door-to-door times include finding the stop, crowding and a margin; the engine's
             do not. So the targets are divided by one factor r, the same for every purpose, keeping
             the survey's work : school : other proportions.
  where    - trips between Hong Kong Island, Kowloon and the New Territories (Table 3.4). Whatever r
             is, crossing the harbour stays more popular in the model than in the survey: tolls and
             fares make people avoid it beyond what time explains. K_ij = K for every pair on
             opposite sides of the harbour (1 elsewhere), and K is set so that the cross-harbour
             share equals the survey's.
  staying  - the share of each main area's trips that stay inside it (Table 3.5).
r is the value that best reproduces the other four movements of Table 3.4 and the ten areas of
Table 3.5 together; K is solved for each r tried. Two fitted numbers for fifteen observations.
(2026-09-18: r = 1.28, K = 0.62. Table 3.5's "trips to or from" was tested three ways; counting a
trip once if either end is in the area fits the survey by far the best - 4.8 points against 14-15.)

Area factors (decided 2026-09-26, replacing the 2026-09-18 decision to leave it visible): Sha Tin/Ma On
Shan kept 21% of its trips inside against the survey's 31%, and the surplus showed up on both Lion
Rock Tunnel (+24%) and the East Rail line (+44%). The areas that missed low are the ones a fast rail
line puts close to Kowloon (Sha Tin: Kowloon 1.74 times as far as its own area; Tuen Mun, which
matched, 2.59); a gamma-shaped decay did not help. The likely cause is crowding the transit times do
not carry - but pipeline/39 has no crowding model yet, so each Table 3.5 main area now gets one
intra-area factor, fitted after r (odds update, harbour factor and decays refitted each round) until
every area is within half a point. The factors stand in for that missing crowding: when crowded
times are fed back, refit and expect them to move toward 1.

Cross-boundary trips are fixed at the control point (Immigration counts them there) and spread over
Hong Kong with the other-purpose decay and the harbour factor - a placeholder until the Planning
Department's Cross-boundary Travel Survey is brought in.

Run from the project root (a few minutes - each r tried rebalances every purpose several times):
    uv run python pipeline/22_trip_distribution.py
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "data" / "model"
WEB = ROOT / "data" / "web"
TRIP_ENDS = MODEL / "trip-ends-2026.parquet"
TRANSIT = MODEL / "skim-active-transit.npz"
LANDUSE = MODEL / "landuse-2026.parquet"
PARAMETERS = MODEL / "parameters-tcs2022.json"
CROSS_BOUNDARY = WEB / "cross-boundary.json"
OUTPUT = MODEL / "trip-distribution-2026.npz"
AUDIT = WEB / "trip-distribution-audit.json"

PURPOSES = ["HBW", "HBS", "HBO", "NHB"]
CROSSING = ["CBS", "CBR", "CBV"]
MEAN_TIME_KEY = {"HBW": "HBW", "HBS": "HBS", "HBO": "HBO_NHB", "NHB": "HBO_NHB"}
# Getting from a road control point to the zone it hangs off (Shenzhen Bay's port is 5.8 km away,
# across the bridge), at a bus's pace on an expressway.
CONNECTOR_KPH = 40.0
BALANCE_TOLERANCE = 1e-4  # largest relative row error accepted from the balancing
BETA_RANGE = (0.001, 0.5)
SCALE_RANGE = (1.0, 1.6)  # reported over engine time; 1.0 is "the survey's times as they are"
HARBOUR_RANGE = (0.2, 1.0)
REGION_TOLERANCE = 0.15  # a modelled regional movement this far from Table 3.4 is reported
CONTAINMENT_TOLERANCE = 0.10  # an area's self-containment this many points from Table 3.5 is reported
# Table 3.5 fitted directly (2026-09-26): one intra-area factor per main area. Without it Sha Tin/Ma On Shan kept
# 21% of its trips inside against the survey's 31%, and the surplus showed up on both Lion Rock Tunnel (+24%)
# and the East Rail line (+44%) - too many Sha Tin people going to Kowloon, whichever way they travelled.
AREA_ROUNDS = 12
AREA_TOLERANCE = 0.005       # stop when every main area is within half a point of Table 3.5, or stops improving
# Hong Kong Island gets no factor: its trips either stay on the island or cross the harbour, so its
# self-containment and the cross-harbour share are one constraint seen from two sides, and the harbour
# factor K already fits it. Given one of its own, the two factors pull against each other round after
# round (tried: the island's factor climbed to 1.79 while K rose from 0.62 to 0.82, with the island still
# at 48% against 49% - the last point is the island's trip-end total, pipeline/21, not distribution).
HONG_KONG_ISLAND = {"Central & Western", "Wan Chai", "Eastern", "Southern"}
KOWLOON = {"Yau Ma Tei", "Mong Kok", "Sham Shui Po", "Kowloon City", "Kwun Tong", "Wong Tai Sin"}
# Table 3.5's main areas, built from the survey's broad districts.
MAIN_AREAS = {
    "Hong Kong Island": HONG_KONG_ISLAND,
    "Kowloon": KOWLOON,
    "Tsuen Wan/Kwai Tsing": {"Tsuen Wan", "Kwai Chung", "Tsing Yi"},
    "Tuen Mun": {"Tuen Mun"},
    "Yuen Long/Tin Shui Wai": {"Yuen Long", "Tin Shui Wai"},
    "Fanling/Sheung Shui": {"Fanling/Sheung Shui"},
    "Tai Po": {"Tai Po"},
    "Sha Tin/Ma On Shan": {"Sha Tin", "Ma On Shan"},
    "Tseung Kwan O": {"Tseung Kwan O"},
    "North Lantau": {"North Lantau"},
}
AREA_FITTED = [a for a in MAIN_AREAS if a != "Hong Kong Island"]


def costs(zones: pd.DataFrame, external: pd.DataFrame) -> tuple[np.ndarray, list[str]]:
    """Public transport minutes between every pair of zones, control points included."""
    skim = np.load(TRANSIT, allow_pickle=True)
    order = [str(z) for z in skim["zones"]]
    if order != zones.index.tolist():
        raise RuntimeError("the transit matrix is not in the land-use table's zone order - rerun pipeline/18")
    inner = skim["transit_min"].astype(float)

    points = {p["point"]: p for p in json.loads(CROSS_BOUNDARY.read_text(encoding="utf-8"))["control_points"]}
    n, m = len(order), len(external)
    cost = np.full((n + m, n + m), np.inf)
    cost[:n, :n] = inner
    for k, (zone, row) in enumerate(external.iterrows()):
        host = order.index(row["host_zone"])
        extra = points[zone.removeprefix("X:")]["zone_distance_m"] / 1000 / CONNECTOR_KPH * 60
        cost[n + k, :n] = inner[host] + extra
        cost[:n, n + k] = inner[:, host] + extra
    return cost, order + external.index.tolist()


def furness(productions: np.ndarray, attractions: np.ndarray, weight: np.ndarray,
            iterations: int = 500) -> tuple[np.ndarray, float]:
    """Balance a seed matrix to the given row and column totals."""
    b = np.ones(len(attractions))
    for _ in range(iterations):
        supply = weight @ b
        a = np.divide(productions, supply, out=np.zeros_like(productions), where=supply > 0)
        demand = weight.T @ a
        b = np.divide(attractions, demand, out=np.zeros_like(attractions), where=demand > 0)
        error = np.max(np.abs(a * (weight @ b) - productions) / np.maximum(productions, 1))
        if error < BALANCE_TOLERANCE:
            break
    return a[:, None] * weight * b[None, :], float(error)


def singly(productions: np.ndarray, attractions: np.ndarray, weight: np.ndarray) -> np.ndarray:
    """Spread each origin's trips over destinations in proportion to attraction times decay."""
    seed = weight * attractions[None, :]
    total = seed.sum(axis=1, keepdims=True)
    return np.divide(seed, total, out=np.zeros_like(seed), where=total > 0) * productions[:, None]


def mean_cost(trips: np.ndarray, cost: np.ndarray) -> float:
    finite = np.isfinite(cost)
    return float((trips[finite] * cost[finite]).sum() / trips[finite].sum())


class Model:
    """Everything the calibration needs, loaded once."""

    def __init__(self) -> None:
        self.params = json.loads(PARAMETERS.read_text(encoding="utf-8"))
        ends = pd.read_parquet(TRIP_ENDS).set_index("zone")
        order = pd.read_parquet(LANDUSE)["zone"].astype(str).tolist()
        external = ends[ends["external"]]
        self.cost, self.ids = costs(ends.loc[order], external)
        self.ends = ends.loc[self.ids]
        self.broad = np.array(ends.loc[order, "broad"].tolist() + ["external"] * len(external))
        self.region = np.where(np.isin(self.broad, list(HONG_KONG_ISLAND)), "HKI",
                               np.where(np.isin(self.broad, list(KOWLOON)), "KLN",
                                        np.where(self.broad == "external", "EXT", "NT")))
        island = self.region == "HKI"
        rest = np.isin(self.region, ["KLN", "NT", "EXT"])  # the boundary crossings are all north of it
        self.across = (island[:, None] & rest[None, :]) | (rest[:, None] & island[None, :])
        self.reachable = np.isfinite(self.cost)
        self.finite_cost = np.where(self.reachable, self.cost, 0.0)
        times = self.params["mean_journey_time_min"]
        self.transit_share = times["public_transport"] / times["all"]
        movements = self.params["regional_movements"]
        self.survey_regions = {k: movements[k] / movements["total"] for k in regional_keys()}
        self.survey_containment = {a: self.params["self_containment_pct"][a] / 100 for a in MAIN_AREAS}
        self.area_k = {a: 1.0 for a in MAIN_AREAS}
        self.inside = {a: np.isin(self.broad, list(m)) for a, m in MAIN_AREAS.items()}
        self.area_factor = np.ones_like(self.cost)

    def update_area(self) -> None:
        """Trips that start and end in the same main area are made more attractive by that area's factor."""
        self.area_factor = np.ones_like(self.cost)
        for a, inside in self.inside.items():
            self.area_factor[np.ix_(inside, inside)] = self.area_k[a]

    def target(self, purpose: str, scale: float) -> float:
        return self.params["mean_journey_time_min"][MEAN_TIME_KEY[purpose]] * self.transit_share / scale

    def seed(self, beta: float, harbour: float) -> np.ndarray:
        decay = np.where(self.reachable, np.exp(-beta * self.finite_cost), 0.0)
        return decay * np.where(self.across, harbour, 1.0) * self.area_factor

    def calibrate(self, purpose: str, scale: float, harbour: float) -> tuple[float, np.ndarray, float]:
        """The decay at which the balanced matrix's mean time equals the target (bisection, log scale)."""
        productions = self.ends[f"P_{purpose}"].to_numpy(dtype=float)
        attractions = self.ends[f"A_{purpose}"].to_numpy(dtype=float)
        target = self.target(purpose, scale)
        low, high = BETA_RANGE
        while high / low > 1.002:
            beta = (low * high) ** 0.5
            trips, error = furness(productions, attractions, self.seed(beta, harbour))
            if mean_cost(trips, self.cost) > target:
                low = beta  # trips too long: decay faster
            else:
                high = beta
        return beta, trips, error

    def distribute(self, scale: float, harbour: float) -> tuple[dict, dict]:
        matrices, fitted = {}, {}
        for purpose in PURPOSES:
            beta, trips, error = self.calibrate(purpose, scale, harbour)
            matrices[purpose] = trips
            fitted[purpose] = {"beta": beta, "error": error}
        return matrices, fitted

    def cross_harbour_share(self, matrices: dict) -> float:
        total = sum(matrices[p] for p in PURPOSES)
        return float(total[self.across].sum() / total.sum())

    def with_harbour(self, scale: float) -> tuple[float, dict, dict]:
        """For one time scale, the harbour factor that gives the survey's cross-harbour share."""
        wanted = self.survey_regions["cross_harbour"]
        low, high = HARBOUR_RANGE
        matrices, fitted = self.distribute(scale, high)
        if self.cross_harbour_share(matrices) <= wanted:
            return high, matrices, fitted  # no harbour penalty needed
        for _ in range(12):
            harbour = (low + high) / 2
            matrices, fitted = self.distribute(scale, harbour)
            if self.cross_harbour_share(matrices) > wanted:
                high = harbour
            else:
                low = harbour
        return harbour, matrices, fitted

    def misfit(self, matrices: dict) -> tuple[float, dict, dict]:
        """Root mean square gap, in percentage points, over Table 3.4 (less the fitted row) and 3.5."""
        total = sum(matrices[p] for p in PURPOSES)
        regions = regional(total, self.region)
        shares = {k: v / sum(regions.values()) for k, v in regions.items()}
        contained = containment(total, self.broad)
        gaps = [shares[k] - self.survey_regions[k] for k in shares if k != "cross_harbour"]
        gaps += [contained[a] - self.survey_containment[a] for a in MAIN_AREAS]
        return float(np.sqrt(np.mean(np.square(gaps))) * 100), shares, contained


def regional_keys() -> list[str]:
    return ["within_hong_kong_island", "cross_harbour", "within_kowloon", "kowloon_nt", "within_nt"]


def regional(trips: np.ndarray, region: np.ndarray) -> dict[str, float]:
    """Table 3.4's five movements, counting both directions of every production-attraction pair."""
    def between(a: set, b: set) -> float:
        rows = np.isin(region, list(a))
        cols = np.isin(region, list(b))
        if a == b:
            return float(trips[np.ix_(rows, cols)].sum())
        return float(trips[np.ix_(rows, cols)].sum() + trips[np.ix_(cols, rows)].sum())

    island, kowloon, nt = {"HKI"}, {"KLN"}, {"NT"}
    return dict(zip(regional_keys(), [
        between(island, island), between(island, kowloon | nt), between(kowloon, kowloon),
        between(kowloon, nt), between(nt, nt),
    ]))


def containment(trips: np.ndarray, broad: np.ndarray) -> dict[str, float]:
    """Trips inside each main area as a share of all trips to or from it."""
    shares = {}
    for area, members in MAIN_AREAS.items():
        inside = np.isin(broad, list(members))
        within = trips[np.ix_(inside, inside)].sum()
        touching = trips[inside].sum() + trips[:, inside].sum() - within
        shares[area] = float(within / touching) if touching else float("nan")
    return shares


def fit_scale(model: Model) -> tuple[float, float, dict, dict, list]:
    """Golden-section search over the time scale, the harbour factor solved at every step."""
    tried = {}

    def evaluate(scale: float):
        if scale not in tried:
            harbour, matrices, fitted = model.with_harbour(scale)
            error = model.misfit(matrices)[0]
            tried[scale] = (error, harbour, matrices, fitted)
            print(f"   r = {scale:.3f}: K = {harbour:.3f}，两表误差 {error:.2f} 个百分点", flush=True)
        return tried[scale][0]

    low, high = SCALE_RANGE
    golden = (5 ** 0.5 - 1) / 2
    a, b = high - golden * (high - low), low + golden * (high - low)
    while high - low > 0.01:
        if evaluate(a) < evaluate(b):
            high, b = b, a
            a = high - golden * (high - low)
        else:
            low, a = a, b
            b = low + golden * (high - low)
    best = min(tried, key=lambda s: tried[s][0])
    error, harbour, matrices, fitted = tried[best]
    history = [{"scale": round(s, 4), "harbour": round(v[1], 4), "misfit_pts": round(v[0], 3)}
               for s, v in sorted(tried.items())]
    return best, harbour, matrices, fitted, history


def main() -> None:
    model = Model()
    report, flags = [], []
    print("拟合时间换算系数 r 与过海系数 K …", flush=True)
    scale, harbour, matrices, fitted, history = fit_scale(model)
    # Table 3.5: raise or lower each main area's intra-area factor by the ratio of the survey's odds of a
    # trip staying inside to the model's, refit the harbour factor and the decays, until every area is
    # within AREA_TOLERANCE. The time scale r stays as fitted above.
    before = model.misfit(matrices)[2]
    last = float("inf")
    for round_ in range(1, AREA_ROUNDS + 1):
        contained = model.misfit(matrices)[2]
        worst = max(abs(contained[a] - model.survey_containment[a]) for a in AREA_FITTED)
        print(f"   区内系数第 {round_} 轮：自给率最大偏差 {worst * 100:.1f} 个百分点", flush=True)
        if worst < AREA_TOLERANCE or last - worst < 0.001:
            break
        last = worst
        for a in AREA_FITTED:
            t, m = model.survey_containment[a], contained[a]
            model.area_k[a] *= (t / (1 - t)) / (m / (1 - m))
        model.update_area()
        harbour, matrices, fitted = model.with_harbour(scale)
    misfit, shares, contained = model.misfit(matrices)
    report.append("区内系数（表 3.5 自给率逐区对准；同一主要地区内的出行吸引力再乘这个数）：" + "；".join(
        f"{a} {model.area_k[a]:.2f}（{before[a]:.0%} → {contained[a]:.0%}，调查 {model.survey_containment[a]:.0%}）"
        for a in MAIN_AREAS))

    summary = {}
    for purpose in PURPOSES:
        trips, beta, error = matrices[purpose], fitted[purpose]["beta"], fitted[purpose]["error"]
        penalty = np.log(1 / harbour) / beta
        summary[purpose] = {"beta": round(beta, 5), "target_min": round(model.target(purpose, scale), 1),
                            "modelled_min": round(mean_cost(trips, model.cost), 1),
                            "harbour_penalty_min": round(penalty, 1), "balance_error": error,
                            "intrazonal_share": round(float(np.trace(trips) / trips.sum()), 4)}
        report.append(f"{purpose}：β = {beta:.4f}/分钟，公交平均 {mean_cost(trips, model.cost):.1f} 分钟"
                      f"（调查自报 {model.params['mean_journey_time_min'][MEAN_TIME_KEY[purpose]]} × "
                      f"{model.transit_share:.3f} ÷ r）；过海相当于多 {penalty:.0f} 分钟；区内 {np.trace(trips) / trips.sum():.1%}；"
                      f"配平误差 {error:.1e}" + ("" if error < BALANCE_TOLERANCE * 10 else "  ← 需复核"))
        if error >= BALANCE_TOLERANCE * 10:
            flags.append(f"{purpose} balance")
    report.insert(0, f"拟合：自报 ÷ 引擎时间 r = {scale:.3f}，过海系数 K = {harbour:.3f}（过海出行吸引力再乘 K）；"
                     f"表 3.4 其余四项与表 3.5 十区的均方根误差 {misfit:.1f} 个百分点"
                     + ("；r 落在搜索边界，需复核" if min(abs(scale - s) for s in SCALE_RANGE) < 0.02 else ""))
    if min(abs(scale - s) for s in SCALE_RANGE) < 0.02:
        flags.append("scale at bound")

    # Cross-boundary: fixed at the control point, spread by attraction, other-purpose decay and harbour.
    seed = model.seed(fitted["HBO"]["beta"], harbour)
    for purpose in CROSSING:
        productions = model.ends[f"P_{purpose}"].to_numpy(dtype=float)
        attractions = model.ends[f"A_{purpose}"].to_numpy(dtype=float)
        matrices[purpose] = singly(productions, attractions, seed)
        lost = productions.sum() - matrices[purpose].sum()
        report.append(f"{purpose}：{matrices[purpose].sum():,.0f} 人次从口岸分到全港，公交平均 "
                      f"{mean_cost(matrices[purpose], model.cost):.0f} 分钟"
                      + (f"；未分出 {lost:,.0f}  ← 需复核" if lost > 1 else ""))
        if lost > 1:
            flags.append(f"{purpose} unassigned")

    lines = []
    for key, share in shares.items():
        observed = model.survey_regions[key]
        gap = share / observed - 1
        lines.append(f"{key} {share:.1%}（调查 {observed:.1%}，{gap:+.0%}）")
        if abs(gap) > REGION_TOLERANCE:
            flags.append(f"region {key}")
    report.append("地域间出行占比（表 3.4；过海一项用于定 K）：" + "；".join(lines)
                  + ("" if not any(f.startswith("region") for f in flags) else f"  ← 超过 ±{REGION_TOLERANCE:.0%}，需复核"))
    off = {a: contained[a] - model.survey_containment[a] for a in MAIN_AREAS
           if abs(contained[a] - model.survey_containment[a]) > CONTAINMENT_TOLERANCE}
    report.append("自给率（表 3.5）：" + "；".join(
        f"{a} {contained[a]:.0%}（调查 {model.survey_containment[a]:.0%}）" for a in MAIN_AREAS)
        + ("" if not off else f"；相差超过 {CONTAINMENT_TOLERANCE:.0%}：{list(off)}  ← 需复核"))
    if off:
        flags.append("containment")

    mechanised = sum(matrices[p] for p in PURPOSES)
    finite = model.reachable
    engine = {"up_to_30": model.cost * scale <= 30, "30_to_60": (model.cost * scale > 30) & (model.cost * scale <= 60),
              "over_60": model.cost * scale > 60}
    total = mechanised[finite].sum()
    bands = {k: float(mechanised[mask & finite].sum() / total) for k, mask in engine.items()}
    tcs = model.params["journey_time_shares_pct"]
    report.append("出行时间分布（公交时间 × r，换回自报尺度；调查为全部方式，仅作参考）："
                  + "、".join(f"{k} {v:.0%}（调查 {tcs[k]}%）" for k, v in bands.items()))
    unreached = sum(float(matrices[p][~finite].sum()) for p in matrices)
    report.append(f"不可达的小区对上分到的出行 {unreached:,.0f}" + ("" if unreached < 1 else "  ← 需复核"))
    if unreached >= 1:
        flags.append("unreachable")

    np.savez_compressed(OUTPUT, zones=np.array(model.ids),
                        **{f"T_{p}": m.astype(np.float32) for p, m in matrices.items()})
    AUDIT.write_text(json.dumps({
        "method": "doubly constrained gravity per purpose, exponential decay on public transport time, "
                  "one harbour factor, one intra-area factor per Table 3.5 main area; "
                  "cross-boundary singly constrained at the control point",
        "time_scale_r": round(scale, 4), "harbour_factor_k": round(harbour, 4), "misfit_pts": round(misfit, 3),
        "area_factors": {a: round(k, 4) for a, k in model.area_k.items()},
        "search": history, "purposes": summary,
        "regional_movements_share": {k: round(v, 4) for k, v in shares.items()},
        "self_containment": {k: round(v, 4) for k, v in contained.items()},
        "journey_time_shares": {k: round(v, 4) for k, v in bands.items()},
        "flags": flags, "report": report,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"-> {OUTPUT.relative_to(ROOT)}  ({len(model.ids)} zones, {len(matrices)} purposes)")
    for line in report:
        print("   " + line)
    if flags:
        print("   需复核：" + ", ".join(flags))


if __name__ == "__main__":
    main()
