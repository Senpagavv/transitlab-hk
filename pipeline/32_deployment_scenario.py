"""Step 5c: simulate regional AV deployment alongside Hong Kong's licensed taxi fleet.

Input : data/model/taxi-requests-2026.parquet   one row per request
        data/model/skim-car-freeflow.npz        zone-to-zone minutes and kilometres
        data/model/road-speeds-hourly.parquet   measured hourly road speeds
        data/model/road-links.parquet            link lengths used to weight speeds
        data/model/trip-ends-2026.parquet        districts and external-zone host mappings
        data/model/td-digest-series.json         latest licensed taxi fleet
Output: data/model/deployment-scenarios.parquet  area x AV fleet x hour results
        data/web/deployment-audit.json            ten required validation checks

This extends pipeline/31 without changing it: taxis can take any request, while an AV can only take
a request whose mapped origin is inside its licensed deployment area. Dispatch remains minute by
minute, longest-waiting first, to the nearest eligible idle vehicle.

The four limitations inherited from pipeline/31 are material: there is no empty-vehicle rebalancing;
vehicles do not take shifts, breaks, or charging stops; demand does not respond to changed waits;
and dispatch is zonal, so a pickup within the same zone has zero distance. This is a regional fleet
addition, not pipeline/31's whole-Hong-Kong fleet replacement, so its minimum-fleet conclusion must
not be transferred to these scenarios.

Run from the project root:
    uv run python pipeline/32_deployment_scenario.py
"""

import json
import time
import warnings
import sys
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
ROAD_LINKS = MODEL / "road-links.parquet"
TRIP_ENDS = MODEL / "trip-ends-2026.parquet"
TD_DIGEST = MODEL / "td-digest-series.json"
OUTPUT = MODEL / "deployment-scenarios.parquet"
AUDIT = WEB / "deployment-audit.json"

# 离岛是31缩小车队最先放弃的地方（最差分区接单率只剩37%），而且机场是全港最适合先行的封闭场景；
# 观塘是密集市区，作为对照。
DEPLOY_AREAS = {
    "离岛（东涌 + 机场）": ["Islands"],
    "观塘": ["Kwun Tong"],
}
AV_FLEET_SWEEP = (0, 100, 300, 600, 1200)
MAX_WAIT_MIN = 15.0
MAX_PICKUP_MIN = 20.0
BOARDING_MIN = 1.0
SEED = 20260923

OUTPUT_COLUMNS = [
    "area", "av_fleet", "hour", "requests_in_area", "requests_total", "served_av",
    "served_taxi", "gave_up", "wait_in_area_min", "wait_total_min", "av_empty_km",
    "av_paid_km", "taxi_empty_km", "taxi_paid_km", "av_busy", "taxi_busy",
    "av_outside_area",
]


def latest_licensed_fleet() -> tuple[str, int]:
    """Read the latest licensed taxi total, using the same source and rule as pipelines 29 and 31."""
    if not TD_DIGEST.exists():
        raise RuntimeError(f"missing {TD_DIGEST.relative_to(ROOT)} - 先跑 pipeline/30")
    annual = json.loads(TD_DIGEST.read_text(encoding="utf-8"))["taxi_fleet"]["annual"]
    year = max(annual, key=int)
    return year, int(annual[year]["total"]["licensed"])


FLEET_YEAR, TAXI_FLEET = latest_licensed_fleet()


def slowdown() -> np.ndarray:
    """Travel time in each hour over free flow, copied from pipeline/31's rule."""
    speeds = pd.read_parquet(SPEEDS, columns=["link_id", "hour", "speed", "source"])
    lengths = pd.read_parquet(ROAD_LINKS, columns=["link_id", "length_m"])
    speeds = speeds.merge(lengths, on="link_id", how="left")
    measured = speeds[
        (speeds["source"] == "detector") & speeds["length_m"].notna() & (speeds["speed"] > 0)
    ]
    by_hour = measured.groupby("hour").apply(
        lambda group: group["length_m"].sum() / (group["length_m"] / group["speed"]).sum()
    )
    free = by_hour.loc[[2, 3, 4]].mean()
    return (free / by_hour).reindex(range(24)).fillna(1.0).clip(lower=1.0).to_numpy()


def load() -> tuple[pd.DataFrame, np.ndarray, np.ndarray, dict[str, np.ndarray], list[str]]:
    """Load and map requests; external X: zones take their host zone's matrix index and district."""
    with np.load(CAR_SKIM) as skim:
        zone_ids = [str(zone) for zone in skim["zones"]]
        minutes = np.nan_to_num(skim["time_min"], nan=999.0, posinf=999.0)
        kilometres = np.nan_to_num(skim["distance_km"], nan=0.0, posinf=0.0)

    zone_index = {zone: i for i, zone in enumerate(zone_ids)}
    ends = pd.read_parquet(TRIP_ENDS, columns=["zone", "district", "external", "host_zone"])
    internal = ends[~ends["external"]].copy()
    districts = internal.set_index(internal["zone"].astype(str))["district"].to_dict()
    for row in ends[ends["external"]].itertuples():
        zone_index[str(row.zone)] = zone_index[str(row.host_zone)]

    missing_districts = sorted({district for values in DEPLOY_AREAS.values() for district in values}
                               - set(internal["district"].dropna().astype(str)))
    if missing_districts:
        raise RuntimeError(f"trip-ends-2026.parquet 没有这些 district：{missing_districts}")

    requests = pd.read_parquet(REQUESTS, columns=["time_sec", "origin_zone", "destination_zone"])
    origins = requests["origin_zone"].astype(str).map(zone_index)
    destinations = requests["destination_zone"].astype(str).map(zone_index)
    keep = origins.notna() & destinations.notna()
    requests = requests[keep].copy()
    requests["o"] = origins[keep].astype(np.int32).to_numpy()
    requests["d"] = destinations[keep].astype(np.int32).to_numpy()
    requests["minute"] = (requests["time_sec"] // 60).astype(np.int32)
    requests = requests.sort_values("minute").reset_index(drop=True)

    zone_districts = np.asarray([districts.get(zone) for zone in zone_ids], dtype=object)
    area_masks = {
        area: np.isin(zone_districts, district_names)
        for area, district_names in DEPLOY_AREAS.items()
    }
    for area, mask in area_masks.items():
        if not mask.any():
            raise RuntimeError(f"投放区 {area} 没有匹配任何汽车矩阵分区")
    return requests, minutes, kilometres, area_masks, zone_ids


def simulate(
    area: str,
    area_mask: np.ndarray,
    av_fleet: int,
    requests: pd.DataFrame,
    minutes: np.ndarray,
    kilometres: np.ndarray,
    factor: np.ndarray,
    *,
    pure_taxi: bool = False,
) -> tuple[pd.DataFrame, dict[str, object]]:
    """Run one area/fleet scenario through fleet_sim.

    ``pure_taxi`` is check 1's independent path: it hands the simulator ONE fleet, so none of the
    two-fleet bookkeeping runs at all, and the licensed area survives only as a watch mask. If that
    path and the av_fleet=0 path still agree, the second fleet has not leaked into the answer.
    """
    if pure_taxi and av_fleet:
        raise ValueError("pure_taxi reference requires av_fleet=0")

    fleets = [fleet_sim.Fleet("taxi", TAXI_FLEET)]
    if not pure_taxi:
        fleets.append(fleet_sim.Fleet("av", av_fleet, area=area_mask))
    result = fleet_sim.simulate(
        requests, minutes, kilometres, factor, fleets, seed=SEED, zones=len(area_mask),
        max_wait_min=MAX_WAIT_MIN, max_pickup_min=MAX_PICKUP_MIN, boarding_min=BOARDING_MIN,
        watch=area_mask)
    h = result.hourly
    served_in_area = h["served_watched"].to_numpy()
    served_total = (h["served_taxi"] + (h["served_av"] if "served_av" in h else 0)).to_numpy()
    zeros = np.zeros(24)
    table = pd.DataFrame({
        "area": area,
        "av_fleet": av_fleet,
        "hour": np.arange(24, dtype=np.int64),
        "requests_in_area": h["requests_watched"].astype(np.int64),
        "requests_total": h["requests"].astype(np.int64),
        "served_av": (h["served_av"] if "served_av" in h else zeros).astype(np.int64),
        "served_taxi": h["served_taxi"].astype(np.int64),
        "gave_up": h["gave_up"].astype(np.int64),
        "wait_in_area_min": np.divide(h["wait_sum_watched"], served_in_area, out=zeros.copy(),
                                      where=served_in_area > 0),
        "wait_total_min": np.divide(h["wait_sum"], served_total, out=zeros.copy(), where=served_total > 0),
        "av_empty_km": h["empty_km_av"] if "empty_km_av" in h else zeros,
        "av_paid_km": h["paid_km_av"] if "paid_km_av" in h else zeros,
        "taxi_empty_km": h["empty_km_taxi"],
        "taxi_paid_km": h["paid_km_taxi"],
        "av_busy": (h["busy_min_av"] if "busy_min_av" in h else zeros) / 60,
        "taxi_busy": h["busy_min_taxi"] / 60,
        "av_outside_area": (h["outside_av"] if "outside_av" in h else zeros).astype(np.int64),
    })[OUTPUT_COLUMNS]
    diagnostics: dict[str, object] = {
        "served_in_area": served_in_area,
        "unresolved": result.left_waiting,
        # fleet_sim refuses to match a request a fleet may not take, and counts any that slip through.
        "av_origin_violations": result.violations,
    }
    return table, diagnostics


def run_all(
    label: str,
    requests: pd.DataFrame,
    minutes: np.ndarray,
    kilometres: np.ndarray,
    factor: np.ndarray,
    area_masks: dict[str, np.ndarray],
) -> tuple[pd.DataFrame, dict[tuple[str, int], dict[str, object]]]:
    """Run all ten scenarios from fresh seeded state."""
    tables: list[pd.DataFrame] = []
    diagnostics: dict[tuple[str, int], dict[str, object]] = {}
    for area, area_mask in area_masks.items():
        for av_fleet in AV_FLEET_SWEEP:
            started = time.perf_counter()
            table, detail = simulate(
                area, area_mask, av_fleet, requests, minutes, kilometres, factor
            )
            tables.append(table)
            diagnostics[(area, av_fleet)] = detail
            print(
                f"{label}：{area}，无人车 {av_fleet:,} 辆，完成 "
                f"({time.perf_counter() - started:.1f} 秒)",
                flush=True,
            )
    return pd.concat(tables, ignore_index=True), diagnostics


def daily_area_wait(
    table: pd.DataFrame, diagnostics: dict[tuple[str, int], dict[str, object]]
) -> float:
    key = (str(table["area"].iloc[0]), int(table["av_fleet"].iloc[0]))
    served = np.asarray(diagnostics[key]["served_in_area"])
    return float(np.average(table["wait_in_area_min"], weights=served)) if served.sum() else 0.0


def add_check(
    checks: dict[str, dict[str, object]],
    flags: list[str],
    report: list[str],
    number: int,
    key: str,
    name: str,
    actual: object,
    threshold: str,
    passed: bool,
) -> None:
    """Store one required check and its exact Chinese report line."""
    checks[f"{number}_{key}"] = {
        "name": name,
        "actual": actual,
        "threshold": threshold,
        "pass": bool(passed),
    }
    line = f"{number}. {name}：实测 {actual}；阈值 {threshold}；{'通过' if passed else '未通过'}"
    if not passed:
        line += "  ← 需复核"
        flags.append(f"{number}. {name}")
    report.append(line)


def audit_results(
    results: pd.DataFrame,
    repeated: pd.DataFrame,
    diagnostics: dict[tuple[str, int], dict[str, object]],
    references: dict[str, pd.DataFrame],
) -> tuple[dict[str, dict[str, object]], list[str], list[str]]:
    """Implement the task's ten checks in their original order without substitutions."""
    checks: dict[str, dict[str, object]] = {}
    flags: list[str] = []
    report: list[str] = []

    zero_equal: dict[str, bool] = {}
    for area, reference in references.items():
        observed = results[(results["area"] == area) & (results["av_fleet"] == 0)].reset_index(drop=True)
        zero_equal[area] = observed.equals(reference.reset_index(drop=True))
    add_check(
        checks, flags, report, 1, "av_zero_equals_taxi_baseline",
        "av_fleet=0 与纯的士基准逐值一致", zero_equal, "每一列完全相等",
        all(zero_equal.values()),
    )

    scenario_groups = list(results.groupby(["area", "av_fleet"], sort=False))
    balances = {
        f"{area}/{av_fleet}": int((group["served_av"] + group["served_taxi"]
                                   + group["gave_up"]).sum() - group["requests_total"].sum())
        for (area, av_fleet), group in scenario_groups
    }
    add_check(
        checks, flags, report, 2, "daily_balance", "全天服务与请求平账",
        {"通过情景": sum(value == 0 for value in balances.values()), "总情景": len(balances),
         "最大绝对差": max(abs(value) for value in balances.values())},
        "served_av + served_taxi + gave_up = requests_total（完全相等）",
        all(value == 0 for value in balances.values()),
    )

    prefix_excess = {}
    for (area, av_fleet), group in scenario_groups:
        completed = (group["served_av"] + group["served_taxi"] + group["gave_up"]).cumsum()
        excess = int((completed - group["requests_total"].cumsum()).max())
        prefix_excess[f"{area}/{av_fleet}"] = excess
    add_check(
        checks, flags, report, 3, "hourly_prefix", "逐小时前缀完成数不超过请求数",
        {"最大超额": max(prefix_excess.values()), "例外数": sum(v > 0 for v in prefix_excess.values())},
        "无例外", all(value <= 0 for value in prefix_excess.values()),
    )

    origin_violations = sum(
        int(detail["av_origin_violations"]) for detail in diagnostics.values()
    )
    add_check(
        checks, flags, report, 4, "av_origins", "无人车只服务投放区内起点",
        {"违规请求": origin_violations, "派单时断言": True}, "无例外",
        origin_violations == 0,
    )

    av_over = float((results["av_busy"] - results["av_fleet"]).max())
    taxi_over = float((results["taxi_busy"] - TAXI_FLEET).max())
    add_check(
        checks, flags, report, 5, "busy_within_fleet", "每小时在跑车辆不超过车队数",
        {"无人车最大超额": round(av_over, 6), "的士最大超额": round(taxi_over, 6)},
        f"av_busy ≤ av_fleet 且 taxi_busy ≤ {TAXI_FLEET:,}",
        av_over <= 1e-9 and taxi_over <= 1e-9,
    )

    monotonic_rows = []
    monotonic_pass = True
    for area in DEPLOY_AREAS:
        previous_served = None
        previous_wait = None
        for av_fleet in AV_FLEET_SWEEP:
            group = results[(results["area"] == area) & (results["av_fleet"] == av_fleet)]
            served_av = int(group["served_av"].sum())
            wait = daily_area_wait(group, diagnostics)
            if previous_served is not None:
                served_ok = served_av >= previous_served * 0.99
                wait_ok = wait <= previous_wait * 1.01
                monotonic_pass &= served_ok and wait_ok
                monotonic_rows.append({
                    "area": area, "from": previous_fleet, "to": av_fleet,
                    "served_av_ratio": None if previous_served == 0 else round(served_av / previous_served, 6),
                    "wait_ratio": None if previous_wait == 0 else round(wait / previous_wait, 6),
                    "pass": bool(served_ok and wait_ok),
                })
            previous_fleet, previous_served, previous_wait = av_fleet, served_av, wait
    add_check(
        checks, flags, report, 6, "monotonicity", "无人车越多，served_av不降且区内等待不升",
        {"通过相邻比较": sum(row["pass"] for row in monotonic_rows),
         "总相邻比较": len(monotonic_rows)}, "允许1%噪声", monotonic_pass,
    )
    checks["6_monotonicity"]["comparisons"] = monotonic_rows

    kilometre_columns = ["av_empty_km", "av_paid_km", "taxi_empty_km", "taxi_paid_km"]
    nonnegative = bool((results[kilometre_columns] >= 0).all().all())
    paid_spreads = {}
    for area in DEPLOY_AREAS:
        totals = []
        for av_fleet in AV_FLEET_SWEEP:
            group = results[(results["area"] == area) & (results["av_fleet"] == av_fleet)]
            totals.append(float((group["av_paid_km"] + group["taxi_paid_km"]).sum()))
        paid_spreads[area] = (max(totals) - min(totals)) / min(totals) if min(totals) else 0.0
    paid_pass = max(paid_spreads.values()) < 0.02
    add_check(
        checks, flags, report, 7, "kilometres", "里程非负且各情景载客里程稳定",
        {"四项里程均非负": nonnegative,
         "各区最大载客里程差": {area: f"{spread:.4%}" for area, spread in paid_spreads.items()}},
        "四项里程≥0；各区情景间载客里程差<2%", nonnegative and paid_pass,
    )

    vkm_changes = {}
    for area in DEPLOY_AREAS:
        area_rows = results[results["area"] == area]
        baseline_rows = area_rows[area_rows["av_fleet"] == 0]
        baseline = float(baseline_rows[kilometre_columns].sum().sum())
        vkm_changes[area] = {}
        for av_fleet in AV_FLEET_SWEEP:
            group = area_rows[area_rows["av_fleet"] == av_fleet]
            total = float(group[kilometre_columns].sum().sum())
            vkm_changes[area][str(av_fleet)] = f"{total / baseline - 1:+.3%}"
    add_check(
        checks, flags, report, 8, "total_vkm_change", "总车公里随无人车增加的变化",
        vkm_changes, "—（只打印，不设阈值）", True,
    )

    outside_shares = {}
    for area in DEPLOY_AREAS:
        outside_shares[area] = {}
        for av_fleet in AV_FLEET_SWEEP:
            group = results[(results["area"] == area) & (results["av_fleet"] == av_fleet)]
            share = float(group["av_outside_area"].max() / av_fleet) if av_fleet else 0.0
            outside_shares[area][str(av_fleet)] = f"{share:.2%}"
    add_check(
        checks, flags, report, 9, "av_outside_area", "停在投放区外的无人车占比（全天最大值）",
        outside_shares, "—（只打印，不设阈值）", True,
    )

    deterministic = results.equals(repeated)
    add_check(
        checks, flags, report, 10, "determinism", "固定种子两次独立运行逐值一致",
        {"逐值一致": deterministic, "比较行数": len(results), "比较列数": len(results.columns)},
        "必须一致", deterministic,
    )
    return checks, flags, report


def main() -> None:
    started = time.perf_counter()
    factor = slowdown()
    requests, minutes, kilometres, area_masks, zone_ids = load()
    print(
        f"输入：请求 {len(requests):,} 条，分区 {len(zone_ids)} 个；的士车队 {TAXI_FLEET:,} 辆"
        f"（运输署月报 {FLEET_YEAR} 年）；随机种子 {SEED}",
        flush=True,
    )

    first, diagnostics = run_all(
        "独立运行1", requests, minutes, kilometres, factor, area_masks
    )
    second, _ = run_all(
        "独立运行2", requests, minutes, kilometres, factor, area_masks
    )

    references = {}
    for area, area_mask in area_masks.items():
        reference, _ = simulate(
            area, area_mask, 0, requests, minutes, kilometres, factor, pure_taxi=True
        )
        references[area] = reference

    checks, flags, report = audit_results(first, second, diagnostics, references)
    first.to_parquet(OUTPUT, index=False)
    AUDIT.write_text(
        json.dumps(
            {"checks": checks, "flags": flags, "report": report},
            ensure_ascii=False,
            indent=1,
            default=lambda value: value.item() if isinstance(value, np.generic) else str(value),
        ),
        encoding="utf-8",
    )

    print(f"-> {OUTPUT.relative_to(ROOT)}（{len(first):,} 行）")
    print(f"-> {AUDIT.relative_to(ROOT)}")
    for line in report:
        print("   " + line)
    elapsed = time.perf_counter() - started
    print(f"全部情景、两次独立运行及纯的士基准用时 {elapsed:.1f} 秒（{elapsed / 60:.1f} 分钟）")


if __name__ == "__main__":
    main()
