"""Step 5f: what a shift change and a battery do to the fleet the city needs.

Input : the same as pipeline/31, through its loader
Output: data/model/duty-scenarios.parquet    per rule, fleet size and hour
        data/web/duty-audit.json

Why. Every fleet number this project has published - 12,000 to serve the day, 2,400 licences swapped -
comes from a simulator whose vehicles never stop. They take no break, change no driver and never
charge. That makes those numbers a floor, and the floor is the thing a reader should be told and an
assessor will ask about. This step puts the two stops in and measures how far the floor moves.

The two stops are not the same kind of thing, and the data says so.

  A driver's break. Hong Kong taxis run two shifts, so a taxi is not on the road for roughly four
  hours of the day - handover, meals, rest. It is NOT a synchronised event: the census's hourly taxi
  traffic is flat from 07:00 to 22:00, between 1.2 and 1.4 times the daily mean, with no dip anywhere
  near a plausible handover hour. So the model gives each vehicle its own break at its own minute,
  which is what produces a flat profile with a steady share of the fleet away at any moment.

  A battery. Usage-driven: drive until the range is used, then stand still. Where a taxi's break is
  the same every day whatever it does, a self-driving car in a busy district charges more often than
  one in a quiet one - which is exactly why it cannot be folded into the same parameter.

Both are pessimistic as modelled: the break is taken wherever the vehicle is, the charge happens at
the passenger's destination with no detour to a charger and no queue for one. A real operator would
schedule both better. The numbers here are therefore an upper bound on the damage.

Run from the project root (about ten minutes):
    uv run python pipeline/35_duty_and_charging.py
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
OUTPUT = MODEL / "duty-scenarios.parquet"
AUDIT = WEB / "duty-audit.json"

SEED = 20260923
MAX_WAIT_MIN, MAX_PICKUP_MIN, BOARDING_MIN = 15.0, 20.0, 1.0
FLEET_SWEEP = (17_695, 14_000, 12_000, 10_000, 8_000)

# A two-shift taxi is on the road about twenty hours of the twenty-four: handover between the two
# drivers, meals, rest. Four hours off, at each vehicle's own time.
TAXI_BREAK_MIN = 240.0
# A self-driving car of the kind being licensed now: a 60-80 kWh battery doing about 5 km a kWh, so
# 300 km of range, and 45 minutes on a fast charger to be useful again. Both are round numbers, and
# the sweep below is there because they are.
AV_RANGE_KM, AV_RECHARGE_MIN = 300.0, 45.0
# How far the answer moves if those two round numbers are wrong.
RANGE_SWEEP = (200.0, 300.0, 450.0)

RULES = {
    "不休息": {},                                              # pipeline/31's world, for comparison
    "司机换更": {"break_min": TAXI_BREAK_MIN},
    "电动充电": {"range_km": AV_RANGE_KM, "recharge_min": AV_RECHARGE_MIN},
}


def base_module():
    """pipeline/31 already loads the requests, the skim and the slowdown; borrow it."""
    spec = importlib.util.spec_from_file_location("base", ROOT / "pipeline" / "31_fleet_simulator.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(rule: str, size: int, settings: dict, data: tuple, zones: int) -> pd.DataFrame:
    requests, minutes, kilometres, factor = data
    fleet = fleet_sim.Fleet("fleet", size, **settings)
    result = fleet_sim.simulate(requests, minutes, kilometres, factor, [fleet], seed=SEED, zones=zones,
                                max_wait_min=MAX_WAIT_MIN, max_pickup_min=MAX_PICKUP_MIN,
                                boarding_min=BOARDING_MIN)
    h = result.hourly
    served = h["served_total"].to_numpy()
    return pd.DataFrame({
        "rule": rule, "fleet": size, "hour": np.arange(24, dtype=np.int64),
        "range_km": settings.get("range_km") or 0.0,
        "requests": h["requests"].astype(np.int64), "served": h["served_fleet"].astype(np.int64),
        "gave_up": h["gave_up"].astype(np.int64),
        "wait_min": np.divide(h["wait_sum"], served, out=np.zeros(24), where=served > 0),
        "empty_km": h["empty_km_fleet"], "paid_km": h["paid_km_fleet"],
        "busy": h["busy_min_fleet"] / 60, "off_road": h["off_road_fleet"] / 60,
        "charges": h["charges_fleet"].astype(np.int64),
    })


def day(rows: pd.DataFrame) -> dict:
    served = rows["served"].sum()
    return {"served_share": float(served / rows["requests"].sum()),
            "wait_min": float((rows["wait_min"] * rows["served"]).sum() / served) if served else 0.0,
            "busy_peak": float(rows["busy"].max()), "off_peak": float(rows["off_road"].max()),
            "charges": int(rows["charges"].sum())}


def smallest(table: pd.DataFrame, rule: str) -> int | None:
    """The smallest fleet that still keeps the promise: 95% served, five minutes' wait."""
    good = [f for f in sorted(table[table["rule"] == rule]["fleet"].unique())
            if (lambda d: d["served_share"] >= 0.95 and d["wait_min"] <= 5.0)(
                day(table[(table["rule"] == rule) & (table["fleet"] == f)]))]
    return min(good) if good else None


def main() -> None:
    base = base_module()
    report, flags = [], []
    requests, minutes, kilometres, zones = base.load(report)
    data = (requests, minutes, kilometres, base.slowdown())
    report.append(f"规则：{'、'.join(RULES)}；车队扫描 {FLEET_SWEEP}；"
                  f"换更每车每日 {TAXI_BREAK_MIN:.0f} 分钟（时点随机错开）；"
                  f"充电 {AV_RANGE_KM:.0f} 公里续航、{AV_RECHARGE_MIN:.0f} 分钟")

    tables = []
    for rule, settings in RULES.items():
        for size in FLEET_SWEEP:
            print(f"{rule}：{size:,} 辆…", flush=True)
            tables.append(run(rule, size, settings, data, zones))
    # How much the two round numbers in the battery matter, at one fleet size.
    for reach in RANGE_SWEEP:
        if reach == AV_RANGE_KM:
            continue
        print(f"续航 {reach:.0f} 公里：12,000 辆…", flush=True)
        tables.append(run(f"电动充电 {reach:.0f}km", 12_000,
                          {"range_km": reach, "recharge_min": AV_RECHARGE_MIN}, data, zones))
    table = pd.concat(tables, ignore_index=True)

    floor = smallest(table, "不休息")
    for rule in RULES:
        line = []
        for size in FLEET_SWEEP:
            d = day(table[(table["rule"] == rule) & (table["fleet"] == size)])
            line.append(f"{size:,} 辆 接单 {d['served_share']:.1%}、等待 {d['wait_min']:.1f} 分")
        need = smallest(table, rule)
        report.append(f"【{rule}】" + "；".join(line))
        report.append(f"  → 最小达标车队 " + (f"**{need:,} 辆**" if need else "扫描范围内没有达标的")
                      + (f"，比「不休息」多 {need / floor - 1:+.0%}" if need and floor else ""))

    charged = table[table["rule"] == "电动充电"]
    for size in FLEET_SWEEP:
        d = day(charged[charged["fleet"] == size])
        if d["charges"]:
            report.append(f"  充电：{size:,} 辆全天充 {d['charges']:,} 次，最忙一小时 {d['off_peak']:.0f} 辆在充"
                          f"（占车队 {d['off_peak'] / size:.0%}）")
            break
    for reach in RANGE_SWEEP:
        rule = "电动充电" if reach == AV_RANGE_KM else f"电动充电 {reach:.0f}km"
        rows = table[(table["rule"] == rule) & (table["fleet"] == 12_000)]
        if not rows.empty:
            d = day(rows)
            report.append(f"  续航 {reach:.0f} 公里、12,000 辆：接单 {d['served_share']:.1%}、"
                          f"等待 {d['wait_min']:.1f} 分、全天充 {d['charges']:,} 次")

    # Checks.
    checks = {}
    base_rows = table[table["rule"] == "不休息"]
    checks["不休息规则与 pipeline/31 一致"] = {
        "实测": f"{day(base_rows[base_rows['fleet'] == 17_695])['wait_min']:.2f} 分",
        "阈值": "与 31 的 17,695 辆结果同为 2.0–2.2 分", "通过": 2.0 <= day(base_rows[base_rows["fleet"] == 17_695])["wait_min"] <= 2.2}
    off = table[table["rule"] == "不休息"]["off_road"].max()
    checks["不休息规则没有车离线"] = {"实测": float(off), "阈值": "必须为 0", "通过": off == 0}
    shift = table[table["rule"] == "司机换更"]
    share = float(shift[shift["fleet"] == 17_695]["off_road"].mean() / 17_695)
    expected = TAXI_BREAK_MIN / 1440
    checks["换更离线比例"] = {"实测": f"{share:.1%}", "阈值": f"接近 {expected:.1%}（每日 {TAXI_BREAK_MIN:.0f} 分钟 ÷ 1440）",
                        "通过": abs(share - expected) < 0.02}
    charge_rows = table[table["rule"] == "电动充电"]
    km = float(charge_rows[charge_rows["fleet"] == 12_000][["empty_km", "paid_km"]].sum().sum())
    want = km / AV_RANGE_KM
    got = int(charge_rows[charge_rows["fleet"] == 12_000]["charges"].sum())
    # Exact reasoning beats a tolerance: a vehicle charges every full range it drives, and ends the
    # day part way through one more, so the count is at most the mileage implies and at least that
    # many less one per vehicle.
    checks["充电次数与行驶里程相符"] = {
        "实测": f"{got:,} 次；里程推算上限 {want:,.0f} 次，下限 {want - 12_000:,.0f} 次（每车最多少充一次）",
        "阈值": "落在 [上限 − 车队数, 上限] 之间",
        "通过": bool(want - 12_000 <= got <= want)}
    for name, c in checks.items():
        report.append(f"核对 {name}：实测 {c['实测']}；阈值 {c['阈值']}；{'通过' if c['通过'] else '未通过  ← 需复核'}")
        if not c["通过"]:
            flags.append(name)

    table.to_parquet(OUTPUT, index=False)
    AUDIT.write_text(json.dumps({
        "rules": {k: v for k, v in RULES.items()}, "fleet_sweep": list(FLEET_SWEEP),
        "taxi_break_min": TAXI_BREAK_MIN, "av_range_km": AV_RANGE_KM, "av_recharge_min": AV_RECHARGE_MIN,
        "smallest_fleet": {rule: smallest(table, rule) for rule in RULES},
        "checks": checks, "flags": flags, "report": report,
    }, ensure_ascii=False, indent=1, default=float), encoding="utf-8")
    print(f"-> {OUTPUT.relative_to(ROOT)}（{len(table)} 行）")
    for line in report:
        print("   " + line)


if __name__ == "__main__":
    main()
