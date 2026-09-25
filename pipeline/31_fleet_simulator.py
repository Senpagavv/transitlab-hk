"""Step 5b: run a taxi or robotaxi fleet against the day's requests, minute by minute.

Input : data/model/taxi-requests-2026.parquet   717,198 requests with their second of day and both
                                                ends, for a 2026 weekday (pipeline/28)
        data/model/skim-car-freeflow.npz        zone to zone free-flow minutes and kilometres (pipeline/17)
        data/model/road-speeds-hourly.parquet   measured speeds, for the slowdown in each hour (pipeline/15d)
        data/model/trip-ends-2026.parquet       which zone each boundary crossing hangs off
        data/model/road-links.parquet           link lengths, to weight those speeds
        data/model/td-digest-series.json        the licensed taxi fleet, by year (pipeline/30)
        data/web/fleet-supply-audit.json        what pipeline/29 says the fleet is busy doing
Output: data/model/fleet-simulation-2026.parquet  per hour: requests, served, waits, and the kilometres
                                                  run with and without a passenger
        data/web/fleet-simulation-audit.json
        data/web/fleet-scenarios.json    what the map and the scenario panel read

Why. Everything up to here says how many trips there are and how long they take. Nothing says how
many vehicles it takes to serve them, how long people wait, or how far a vehicle drives empty to
reach the next fare - and those are the three numbers any case for a dispatched fleet rests on.
This is also the first step whose answer is not calibrated to anything: it is a consequence of the
demand and the network, which is what makes it worth checking against pipeline/29's bound.

Method. A vehicle is idle in a zone, or busy for a stretch of minutes and then idle in another zone.
Every minute:
  1. Requests whose time has come join the queue; anyone waiting longer than MAX_WAIT_MIN gives up.
  2. Waiting requests are matched to idle vehicles, longest-waiting first, each to the nearest idle
     vehicle by travel time. This is greedy rather than optimal: with thousands of idle vehicles the
     two agree closely, and greedy is what a dispatcher can actually run in real time.
  3. A matched vehicle drives empty to the pickup, then carries the passenger, and is idle again at
     the destination. Both legs use the free-flow skim scaled by the hour's measured slowdown.
Vehicles that end a trip simply wait where they are: there is no rebalancing in this version, which
is the pessimistic end for waiting time and the optimistic end for empty kilometres.

The boundary crossings have no road network of their own, so a request at one is treated as being in
the zone the crossing hangs off (pipeline/13's host zone).

Run from the project root (about a minute):
    uv run python pipeline/31_fleet_simulator.py
"""

import json
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # fleet_sim sits beside this file

import numpy as np
import pandas as pd

import fleet_sim

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "data" / "model"
WEB = ROOT / "data" / "web"
REQUESTS = MODEL / "taxi-requests-2026.parquet"
CAR_SKIM = MODEL / "skim-car-freeflow.npz"
SPEEDS = MODEL / "road-speeds-hourly.parquet"
TRIP_ENDS = MODEL / "trip-ends-2026.parquet"
SUPPLY_AUDIT = WEB / "fleet-supply-audit.json"
OUTPUT = MODEL / "fleet-simulation-2026.parquet"
AUDIT = WEB / "fleet-simulation-audit.json"
SCENARIOS = WEB / "fleet-scenarios.json"
TD_DIGEST = MODEL / "td-digest-series.json"


def latest_licensed_fleet() -> tuple[str, int]:
    """Read the latest annual licensed taxi total published by pipeline/30."""
    if not TD_DIGEST.exists():
        raise RuntimeError(f"missing {TD_DIGEST.relative_to(ROOT)} - 先跑 pipeline/30")
    annual = json.loads(TD_DIGEST.read_text(encoding="utf-8"))["taxi_fleet"]["annual"]
    year = max(annual, key=int)
    return year, int(annual[year]["total"]["licensed"])


FLEET_YEAR, FLEET = latest_licensed_fleet()
MAX_WAIT_MIN = 15.0  # a rider who has waited this long gives up and goes another way
MAX_PICKUP_MIN = 20.0  # no dispatcher sends a car further away than this
BOARDING_MIN = 1.0  # picking up and setting down, as pipeline/29
STEP_MIN = 1  # the dispatcher runs once a minute
SEED = 20260923
# What pipeline/29's two bounds leave for the share of running that is empty: an occupancy rate of
# 65% to 85% means 15% to 35% of the kilometres are run without a passenger.
EMPTY_SHARE_BAND = (0.15, 0.35)
# Fleet sizes to try once the base run is done.
FLEET_SWEEP = (14_000, 12_000, 10_000, 8_000, 6_000)
SMALL_FLEET = 8_000  # the size the map shows beside the base run, chosen because service breaks there


def slowdown() -> np.ndarray:
    """Travel time in each hour over free flow, from the detectors (same rule as pipeline/29)."""
    speeds = pd.read_parquet(SPEEDS, columns=["link_id", "hour", "speed", "source"])
    lengths = pd.read_parquet(MODEL / "road-links.parquet", columns=["link_id", "length_m"])
    speeds = speeds.merge(lengths, on="link_id", how="left")
    measured = speeds[(speeds["source"] == "detector") & speeds["length_m"].notna() & (speeds["speed"] > 0)]
    by_hour = measured.groupby("hour").apply(lambda g: g["length_m"].sum() / (g["length_m"] / g["speed"]).sum())
    free = by_hour.loc[[2, 3, 4]].mean()
    return (free / by_hour).reindex(range(24)).fillna(1.0).clip(lower=1.0).to_numpy()


def load(report: list[str]) -> tuple[pd.DataFrame, np.ndarray, np.ndarray, int]:
    skim = np.load(CAR_SKIM)
    ids = [str(z) for z in skim["zones"]]
    index = {z: i for i, z in enumerate(ids)}
    ends = pd.read_parquet(TRIP_ENDS, columns=["zone", "external", "host_zone"])
    for row in ends[ends["external"]].itertuples():
        index[str(row.zone)] = index[str(row.host_zone)]  # a crossing sits in the zone it hangs off

    requests = pd.read_parquet(REQUESTS, columns=["time_sec", "origin_zone", "destination_zone"])
    o = requests["origin_zone"].astype(str).map(index)
    d = requests["destination_zone"].astype(str).map(index)
    keep = o.notna() & d.notna()
    requests = requests[keep].copy()
    requests["o"] = o[keep].astype(np.int32).to_numpy()
    requests["d"] = d[keep].astype(np.int32).to_numpy()
    requests["minute"] = (requests["time_sec"] // 60).astype(np.int32)
    requests = requests.sort_values("minute").reset_index(drop=True)

    minutes = np.nan_to_num(skim["time_min"], nan=999.0, posinf=999.0)
    kilometres = np.nan_to_num(skim["distance_km"], nan=0.0, posinf=0.0)
    report.append(f"请求 {len(requests):,} 条（口岸按其挂靠小区处理）；分区 {len(ids)} 个；"
                  f"领牌车队 {FLEET:,} 辆（运输署月报 {FLEET_YEAR} 年）；每 {STEP_MIN} 分钟派一次单，"
                  f"等待超过 {MAX_WAIT_MIN:.0f} 分钟放弃")
    return requests, minutes, kilometres, len(ids)


def simulate(requests: pd.DataFrame, minutes: np.ndarray, kilometres: np.ndarray, zones: int,
             factor: np.ndarray, report: list[str], fleet: int = FLEET) -> tuple[pd.DataFrame, pd.DataFrame]:
    """One fleet, licensed everywhere, all day - the simplest case fleet_sim knows."""
    result = fleet_sim.simulate(
        requests, minutes, kilometres, factor, [fleet_sim.Fleet("taxi", fleet)],
        seed=SEED, zones=zones, max_wait_min=MAX_WAIT_MIN, max_pickup_min=MAX_PICKUP_MIN,
        boarding_min=BOARDING_MIN)
    h = result.hourly
    served = h["served_total"].to_numpy()
    table = pd.DataFrame({
        "hour": range(24),
        "requests": h["requests"], "served": h["served_taxi"], "gave_up": h["gave_up"],
        "mean_wait_min": np.divide(h["wait_sum"], served, out=np.zeros(24), where=served > 0),
        "max_wait_min": h["max_wait"],
        "empty_km": h["empty_km_taxi"], "paid_km": h["paid_km_taxi"],
        "vehicles_busy": h["busy_min_taxi"] / 60,
    })
    table["empty_share"] = table["empty_km"] / (table["empty_km"] + table["paid_km"]).replace(0, np.nan)

    by_zone = result.by_zone
    by_zone["mean_wait_min"] = np.divide(by_zone["wait_sum"], by_zone["served"],
                                         out=np.zeros(zones), where=by_zone["served"] > 0)
    by_zone["served_share"] = np.divide(by_zone["served"], by_zone["requests"],
                                        out=np.zeros(zones), where=by_zone["requests"] > 0)
    if report:
        report.append(f"收工时还在等的 {result.left_waiting:,} 条"
                      + ("" if result.left_waiting < 500 else "  ← 需复核"))
    return table, by_zone


def main() -> None:
    report, flags = [], []
    factor = slowdown()
    requests, minutes, kilometres, zones = load(report)
    table, by_zone = simulate(requests, minutes, kilometres, zones, factor, report)

    served, asked = table["served"].sum(), table["requests"].sum()
    empty, paid = table["empty_km"].sum(), table["paid_km"].sum()
    empty_share = empty / (empty + paid)
    wait = float((table["mean_wait_min"] * table["served"]).sum() / served)
    peak = int(table["vehicles_busy"].idxmax())
    report.append(f"服务水平：接到 {served:,.0f}/{asked:,.0f} 单（{served / asked:.1%}），"
                  f"放弃 {table['gave_up'].sum():,.0f} 单；平均等待 {wait:.1f} 分钟，"
                  f"最忙的 {peak}:00 平均等待 {table.loc[peak, 'mean_wait_min']:.1f} 分钟")
    report.append(f"里程：载客 {paid / 1e6:.2f} 百万公里、空驶 {empty / 1e6:.2f} 百万公里，"
                  f"空驶占 {empty_share:.1%}；最忙一小时 {table['vehicles_busy'].max():,.0f} 辆在跑"
                  f"（车队 {FLEET:,}，占 {table['vehicles_busy'].max() / FLEET:.0%}）")

    # The band is what today's cruising taxis do, not a target. A dispatched vehicle waits where it
    # is instead of driving around looking for a fare, so it must come out at or below the band's
    # bottom; coming out above it would mean the dispatcher is worse than cruising.
    low, high = EMPTY_SHARE_BAND
    better = empty_share <= low
    report.append(f"核对一：调度车队空驶占 {empty_share:.1%}；今天的巡游的士按 pipeline/29 夹出来是 "
                  f"{low:.0%}–{high:.0%}。调度车不巡游、只在原地等派单，所以应当不高于 {low:.0%}"
                  + ("" if better else "  ← 需复核：调度反而比巡游差"))
    if not better:
        flags.append("empty share")
    saving = (np.array(EMPTY_SHARE_BAND) - empty_share) / (1 - np.array(EMPTY_SHARE_BAND))
    report.append(f"  → 同样的车队、同样的需求，调度省下的车公里介于 {saving[0]:.0%} 到 {saving[1]:.0%} 之间"
                  f"（取决于今天真实空驶率落在区间的哪一端）")

    ok = served / asked >= 0.95
    report.append(f"核对二：接单率 {served / asked:.1%}（目标 ≥95%；低了说明 {FLEET:,} 辆不够，"
                  f"高了说明需求或行程时间偏低）" + ("" if ok else "  ← 需复核"))
    if not ok:
        flags.append("served share")

    supply = json.loads(SUPPLY_AUDIT.read_text(encoding="utf-8"))
    busy_29 = max(r["busy_taxis"] for r in supply["hourly"])
    gap = abs(table["vehicles_busy"].max() / busy_29 - 1)
    report.append(f"核对三：最忙一小时在跑的车 {table['vehicles_busy'].max():,.0f} 辆，pipeline/29 只算载客时间时是 "
                  f"{busy_29:,.0f} 辆，差 {gap:+.0%}（模拟多出来的就是接客空驶和上下客时间）"
                  + ("" if 0 <= gap <= 0.6 else "  ← 需复核"))
    if not 0 <= gap <= 0.6:
        flags.append("busy vehicles")

    # How small can the fleet get before service breaks? This is the question the whole project is
    # for, and the answer is a consequence of the demand, not a parameter.
    # The base run is the first point on the curve, so the panel can draw it in one series.
    sweep = [{"fleet": FLEET, "served_share": float(served / asked), "mean_wait_min": wait,
              "empty_share": float(empty_share), "peak_busy": float(table["vehicles_busy"].max())}]
    small_zones = by_zone
    for size in FLEET_SWEEP:
        trial, trial_zones = simulate(requests, minutes, kilometres, zones, factor, [], fleet=size)
        if size == SMALL_FLEET:
            small_zones = trial_zones
        got, want = trial["served"].sum(), trial["requests"].sum()
        sweep.append({"fleet": size, "served_share": float(got / want),
                      "mean_wait_min": float((trial["mean_wait_min"] * trial["served"]).sum() / got),
                      "empty_share": float(trial["empty_km"].sum() / (trial["empty_km"].sum() + trial["paid_km"].sum())),
                      "peak_busy": float(trial["vehicles_busy"].max())})
    report.append("车队规模扫描（同样的 70 万单需求）：" + "；".join(
        f"{r['fleet']:,} 辆 → 接单 {r['served_share']:.1%}、等待 {r['mean_wait_min']:.1f} 分、空驶 {r['empty_share']:.0%}"
        for r in sweep))
    enough = [r for r in sweep if r["served_share"] >= 0.95 and r["mean_wait_min"] <= 5.0]
    if enough:
        best = min(enough, key=lambda r: r["fleet"])
        report.append(f"  → 接单率 ≥95% 且平均等待 ≤5 分钟的最小车队是 **{best['fleet']:,} 辆**，"
                      f"比现有领牌车队 {FLEET:,} 辆少 {1 - best['fleet'] / FLEET:.0%}")

    # Everything the map and the scenario panel need, in one file (backend serves it at
    # /api/fleet/scenarios). Zones are pipeline/17's 455, the same ids the zone layer uses.
    zone_ids = [str(z) for z in np.load(CAR_SKIM)["zones"]]
    def zone_rows(frame: pd.DataFrame) -> list[dict]:
        keep = frame[frame["requests"] > 0]
        return [{"zone": zone_ids[i], "requests": int(r.requests), "served_share": round(r.served_share, 4),
                 "mean_wait_min": round(r.mean_wait_min, 2)} for i, r in zip(keep.index, keep.itertuples())]
    SCENARIOS.write_text(json.dumps({
        "note": "pipeline/31_fleet_simulator.py; 需求来自 pipeline/28，车队来自 pipeline/29",
        "base_fleet": FLEET, "max_wait_min": MAX_WAIT_MIN,
        "hourly": table.round(2).to_dict(orient="records"),
        "sweep": sweep,
        "zones": {"base": zone_rows(by_zone), "small": zone_rows(small_zones), "small_fleet": SMALL_FLEET},
        "limits": ["没有空车再平衡：车送完客在原地等",
                   "这一版的车不休息也不充电；两者的代价已由 pipeline/35 量化："
                   "司机换更要多 17% 的车（12,000 → 14,000），电动充电在这个规模上不占额外车辆",
                   "需求固定，等待变短会拉来的新需求没有建模",
                   "分区级派单，同区内接客距离算 0"],
    }, ensure_ascii=False, indent=1, default=float), encoding="utf-8")

    table.to_parquet(OUTPUT, index=False)  # not rounded: empty_share is derived from the two km columns
    AUDIT.write_text(json.dumps({
        "fleet": FLEET, "max_wait_min": MAX_WAIT_MIN, "max_pickup_min": MAX_PICKUP_MIN, "seed": SEED,
        "served": float(served), "requests": float(asked), "empty_share": float(empty_share), "sweep": sweep,
        "mean_wait_min": wait, "hourly": table.round(3).to_dict(orient="records"),
        "flags": flags, "report": report,
    }, ensure_ascii=False, indent=1, default=float), encoding="utf-8")
    print(f"-> {OUTPUT.relative_to(ROOT)}")
    for line in report:
        print("   " + line)


if __name__ == "__main__":
    main()
