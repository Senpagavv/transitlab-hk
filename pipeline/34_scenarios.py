"""Step 5e: the two scenarios that ask whether the lever has to be pulled in pairs.

Input : the same as pipeline/32, plus data/model/deployment-scenarios.parquet for its baseline
Output: data/model/extra-scenarios.parquet   the same per-hour columns, plus kind / taxi_fleet /
                                             from_hour / to_hour
        data/web/extra-scenarios-audit.json

Why. pipeline/32 answered "put N self-driving cars in one district" and the answer was almost
nothing: 1,200 cars took a tenth of the district's trips, 14% of them busy in the worst hour, the
wait down by 36 seconds. The reason is not that the cars are bad - it is that 17,695 taxis are
already everywhere, so there is always one closer. Adding supply to a saturated market buys little.

If that is right, the two things worth trying both change something ELSE at the same time:

  time_window  run the cars only at night, when taxi supply thins out and demand is low enough that
               the nearest taxi is not nearby. Same fleet, eight hours instead of twenty-four.
  quota_swap   licences in, licences out: N self-driving cars in the district AND N taxi licences
               withdrawn from the whole territory. This is the only scenario here where the total
               number of vehicles does not go up, so it is the only one that can be called a policy
               rather than an addition.

The quota swap is deliberately unfair to itself: the cars are confined to one district while the
taxis they replace were serving everywhere, so the rest of Hong Kong loses supply and gains nothing.
If it still comes out ahead in the district without hurting the rest, that is worth knowing; if it
does not, that is worth knowing sooner.

Run from the project root (about five minutes):
    uv run python pipeline/34_scenarios.py
"""

import importlib.util
import json
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd

import fleet_sim

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "data" / "model"
WEB = ROOT / "data" / "web"
DEPLOYMENT = MODEL / "deployment-scenarios.parquet"
OUTPUT = MODEL / "extra-scenarios.parquet"
AUDIT = WEB / "extra-scenarios-audit.json"

SEED = 20260923
MAX_WAIT_MIN, MAX_PICKUP_MIN, BOARDING_MIN = 15.0, 20.0, 1.0
NIGHT = (22, 6)  # [start, end), wrapping midnight: the hours the MTR is shut or thinning out
NIGHT_FLEETS = (300, 1200)
SWAP_FLEETS = (600, 1200, 2400)  # cars in, the same number of taxi licences out


def deployment_module():
    """pipeline/32 already knows how to load everything; borrow it rather than copy it."""
    spec = importlib.util.spec_from_file_location("deployment", ROOT / "pipeline" / "32_deployment_scenario.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(kind: str, area: str, mask: np.ndarray, av_fleet: int, taxi_fleet: int,
        hours: tuple[int, int], data: tuple) -> pd.DataFrame:
    """One scenario, in the same per-hour shape pipeline/32 writes."""
    requests, minutes, kilometres, factor = data
    fleets = [fleet_sim.Fleet("taxi", taxi_fleet)]
    if av_fleet:
        fleets.append(fleet_sim.Fleet("av", av_fleet, area=mask, hours=hours))
    result = fleet_sim.simulate(requests, minutes, kilometres, factor, fleets, seed=SEED,
                                zones=len(mask), max_wait_min=MAX_WAIT_MIN,
                                max_pickup_min=MAX_PICKUP_MIN, boarding_min=BOARDING_MIN, watch=mask)
    h = result.hourly
    zeros = np.zeros(24)
    watched = h["served_watched"].to_numpy()
    served = (h["served_taxi"] + (h["served_av"] if "served_av" in h else 0)).to_numpy()
    return pd.DataFrame({
        "kind": kind, "area": area, "av_fleet": av_fleet, "taxi_fleet": taxi_fleet,
        "from_hour": hours[0], "to_hour": hours[1], "hour": np.arange(24, dtype=np.int64),
        "requests_in_area": h["requests_watched"].astype(np.int64),
        "requests_total": h["requests"].astype(np.int64),
        "served_av": (h["served_av"] if "served_av" in h else zeros).astype(np.int64),
        "served_taxi": h["served_taxi"].astype(np.int64),
        "gave_up": h["gave_up"].astype(np.int64),
        "wait_in_area_min": np.divide(h["wait_sum_watched"], watched, out=zeros.copy(), where=watched > 0),
        "wait_total_min": np.divide(h["wait_sum"], served, out=zeros.copy(), where=served > 0),
        "av_empty_km": h["empty_km_av"] if "empty_km_av" in h else zeros,
        "av_paid_km": h["paid_km_av"] if "paid_km_av" in h else zeros,
        "taxi_empty_km": h["empty_km_taxi"], "taxi_paid_km": h["paid_km_taxi"],
        "av_busy": (h["busy_min_av"] if "busy_min_av" in h else zeros) / 60,
        "taxi_busy": h["busy_min_taxi"] / 60,
        "av_outside_area": (h["outside_av"] if "outside_av" in h else zeros).astype(np.int64),
    })


def night_hours(frame: pd.DataFrame) -> pd.Series:
    start, end = NIGHT
    return (frame["hour"] >= start) | (frame["hour"] < end)


def main() -> None:
    deployment = deployment_module()
    requests, minutes, kilometres, masks, _ = deployment.load()
    data = (requests, minutes, kilometres, deployment.slowdown())
    taxi_fleet = deployment.TAXI_FLEET
    report, flags, tables = [], [], []
    report.append(f"请求 {len(requests):,} 条；的士车队 {taxi_fleet:,} 辆；"
                  f"夜间窗口 {NIGHT[0]}:00–{NIGHT[1]}:00；随机种子 {SEED}")

    for area, mask in masks.items():
        for size in NIGHT_FLEETS:
            print(f"夜间：{area}，无人车 {size:,} 辆…", flush=True)
            tables.append(run("time_window", area, mask, size, taxi_fleet, NIGHT, data))
        for size in SWAP_FLEETS:
            print(f"配额联动：{area}，无人车 {size:,} 进、的士牌 {size:,} 出…", flush=True)
            tables.append(run("quota_swap", area, mask, size, taxi_fleet - size, (0, 24), data))
    table = pd.concat(tables, ignore_index=True)

    # The comparison is against pipeline/32's own runs: same requests, same seed, same everything
    # except the rule being tested.
    base = pd.read_parquet(DEPLOYMENT)
    whole_day = {(a, f): g for (a, f), g in base.groupby(["area", "av_fleet"])}

    def day(frame: pd.DataFrame) -> dict:
        served = frame["served_av"].sum() + frame["served_taxi"].sum()
        av_km = frame["av_empty_km"].sum() + frame["av_paid_km"].sum()
        return {
            "av_share": float(frame["served_av"].sum() / frame["requests_in_area"].sum()),
            "wait_area": float((frame["wait_in_area_min"] * (frame["served_av"] + frame["served_taxi"])).sum() / served),
            "wait_all": float((frame["wait_total_min"] * (frame["served_av"] + frame["served_taxi"])).sum() / served),
            "gave_up": int(frame["gave_up"].sum()),
            "total_km": float(av_km + frame["taxi_empty_km"].sum() + frame["taxi_paid_km"].sum()),
            "av_busy_peak": float(frame["av_busy"].max()),
        }

    report.append("【夜间窗口】只在 22:00–06:00 运营，和同样车队全天运营相比：")
    for area in masks:
        for size in NIGHT_FLEETS:
            night = table[(table["kind"] == "time_window") & (table["area"] == area) & (table["av_fleet"] == size)]
            all_day = whole_day.get((area, size))
            n, a = day(night), day(all_day) if all_day is not None else None
            nights_only = night[night_hours(night)]
            share = float(nights_only["served_av"].sum() / max(nights_only["requests_in_area"].sum(), 1))
            report.append(f"  {area} {size:,} 辆：夜间时段接走区内 {share:.1%}（全天口径 {n['av_share']:.1%}）、"
                          f"夜间最忙一小时用了 {n['av_busy_peak'] / size:.0%} 的车"
                          + (f"；全天运营同规模是接走 {a['av_share']:.1%}、用 {a['av_busy_peak'] / size:.0%}" if a else ""))

    report.append(f"【配额联动】无人车进 N 辆、的士牌同时退 N 辆（总车辆数不增），和 {taxi_fleet:,} 辆纯的士相比：")
    for area in masks:
        zero = whole_day.get((area, 0))
        base_day = day(zero) if zero is not None else None
        for size in SWAP_FLEETS:
            swap = table[(table["kind"] == "quota_swap") & (table["area"] == area) & (table["av_fleet"] == size)]
            s = day(swap)
            if not base_day:
                continue
            report.append(f"  {area} 换 {size:,} 辆：区内等待 {base_day['wait_area']:.2f} → {s['wait_area']:.2f} 分、"
                          f"全港等待 {base_day['wait_all']:.2f} → {s['wait_all']:.2f} 分、"
                          f"放弃 {base_day['gave_up']:,} → {s['gave_up']:,} 单、"
                          f"总车公里 {s['total_km'] / base_day['total_km'] - 1:+.2%}")

    # Checks.
    checks = {}
    outside = table[(table["kind"] == "time_window") & ~night_hours(table)]["served_av"].sum()
    checks["夜间车队在窗口外接单"] = {"实测": int(outside), "阈值": "必须为 0", "通过": outside == 0}
    balance = table.groupby(["kind", "area", "av_fleet"]).apply(
        lambda g: int(g["served_av"].sum() + g["served_taxi"].sum() + g["gave_up"].sum() - g["requests_total"].sum()))
    checks["全天服务与请求平账"] = {"实测": int(balance.abs().max()), "阈值": "完全相等", "通过": bool(balance.abs().max() == 0)}
    busy = ((table["av_busy"] <= table["av_fleet"] + 1e-9) & (table["taxi_busy"] <= table["taxi_fleet"] + 1e-9)).all()
    checks["在跑车辆不超过车队数"] = {"实测": bool(busy), "阈值": "无例外", "通过": bool(busy)}
    paid = table.groupby(["kind", "area", "av_fleet"])[["av_paid_km", "taxi_paid_km"]].sum().sum(axis=1)
    spread = float(paid.max() / paid.min() - 1)
    checks["各情景载客里程稳定"] = {"实测": f"{spread:.3%}", "阈值": "<2%", "通过": spread < 0.02}
    for name, c in checks.items():
        report.append(f"核对 {name}：实测 {c['实测']}；阈值 {c['阈值']}；{'通过' if c['通过'] else '未通过  ← 需复核'}")
        if not c["通过"]:
            flags.append(name)

    table.to_parquet(OUTPUT, index=False)
    AUDIT.write_text(json.dumps({
        "night_window": list(NIGHT), "night_fleets": list(NIGHT_FLEETS), "swap_fleets": list(SWAP_FLEETS),
        "taxi_fleet": taxi_fleet, "seed": SEED, "checks": checks, "flags": flags, "report": report,
    }, ensure_ascii=False, indent=1, default=float), encoding="utf-8")
    print(f"-> {OUTPUT.relative_to(ROOT)}（{len(table)} 行）")
    for line in report:
        print("   " + line)


if __name__ == "__main__":
    main()
