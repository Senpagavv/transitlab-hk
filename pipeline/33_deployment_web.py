"""Step 5d: the scenario results in one file the website can read.

Input : data/model/deployment-scenarios.parquet   per area, fleet and hour (pipeline/32)
        data/model/extra-scenarios.parquet         night window and quota swap (pipeline/34)
        data/web/fleet-scenarios.json              the fleet-size curve (pipeline/31)
Output: data/web/deployment-scenarios.json         what /api/fleet/deployment serves

Why a separate step. The simulators write parquet, which a browser cannot read, and each of them
knows only its own scenarios. This is the one place that decides the shape the website sees, so that
adding a scenario later does not change that shape - the `kind` field is what tells them apart:

    deployment   N self-driving cars licensed to pick up inside one district, taxis unchanged
    time_window  the same, but the cars only operate between `from_hour` and `to_hour`
    quota_swap   N self-driving cars in, M taxi licences out

All three exist now (pipeline/32 writes the first, pipeline/34 the other two) and land in the same
list; the website tells them apart by `kind`, and must treat one it does not know as "show it, group
it by kind" rather than fail - that is what lets a new scenario arrive without a front-end change.

Run from the project root (a second):
    uv run python pipeline/33_deployment_web.py
"""

import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "data" / "model"
WEB = ROOT / "data" / "web"
DEPLOYMENT = MODEL / "deployment-scenarios.parquet"
EXTRA = MODEL / "extra-scenarios.parquet"  # night window and quota swap (pipeline/34)
FLEET_SCENARIOS = WEB / "fleet-scenarios.json"
OUTPUT = WEB / "deployment-scenarios.json"

# Carried through to the website so the caveats travel with the numbers rather than living in a
# document nobody opens. The first four are pipeline/31's; the last two belong to the deployment run.
LIMITS = [
    "没有空车再平衡：车送完客在原地等",
    "这一版的车不休息也不充电；代价见 pipeline/35：司机换更要多 17% 的车，电动充电不占额外车辆",
    "需求固定，等待变短会拉来的新需求没有建模",
    "分区级派单，同区内接客距离算 0",
    "区域牌照只限制「在哪接客」，不限制车停在哪，所以车会漂出投放区",
    "投放情景（deployment、time_window）里的士车队保持不变，算的是「加车」；只有 quota_swap 是「换车」",
]


def summarise(rows: pd.DataFrame) -> dict:
    """One scenario's whole day, in the terms the panel shows."""
    requests_area = float(rows["requests_in_area"].sum())
    served_av = float(rows["served_av"].sum())
    av_km = float(rows["av_empty_km"].sum() + rows["av_paid_km"].sum())
    total_km = av_km + float(rows["taxi_empty_km"].sum() + rows["taxi_paid_km"].sum())
    served = rows["served_av"] + rows["served_taxi"]
    return {
        "requests_in_area": round(requests_area),
        "requests_total": round(float(rows["requests_total"].sum())),
        "served_av": round(served_av),
        "av_share_in_area": round(served_av / requests_area, 4) if requests_area else 0.0,
        # Weighted by the trips each hour actually served, not a mean of means.
        "wait_in_area_min": round(float((rows["wait_in_area_min"] * rows["served_av"].add(rows["served_taxi"])).sum()
                                        / served.sum()), 3) if served.sum() else 0.0,
        "wait_total_min": round(float((rows["wait_total_min"] * served).sum() / served.sum()), 3) if served.sum() else 0.0,
        "av_vehicle_km": round(av_km),
        "total_vehicle_km": round(total_km),
        "av_empty_share": round(float(rows["av_empty_km"].sum()) / av_km, 4) if av_km else 0.0,
        "av_busy_peak": round(float(rows["av_busy"].max()), 1),
        "av_outside_area_peak": round(float(rows["av_outside_area"].max()), 1),
    }


def main() -> None:
    if not DEPLOYMENT.exists():
        raise RuntimeError("缺 data/model/deployment-scenarios.parquet - 先跑 pipeline/32")
    table = pd.read_parquet(DEPLOYMENT)
    fleet = json.loads(FLEET_SCENARIOS.read_text(encoding="utf-8")) if FLEET_SCENARIOS.exists() else {}
    taxi_fleet = int(fleet.get("base_fleet", 0))

    # pipeline/32 writes one kind; pipeline/34 writes the others with three extra columns. Bring them
    # to the same shape here so the website sees one list and tells them apart by `kind`.
    table = table.assign(kind="deployment", taxi_fleet=taxi_fleet, from_hour=0, to_hour=24)
    if EXTRA.exists():
        table = pd.concat([table, pd.read_parquet(EXTRA)], ignore_index=True)

    keys = ["kind", "area", "av_fleet", "taxi_fleet", "from_hour", "to_hour"]
    scenarios = []
    for values, rows in table.groupby(keys, sort=True):
        rows = rows.sort_values("hour")
        scenario = {k: (v if isinstance(v, str) else int(v)) for k, v in zip(keys, values)}
        scenario["summary"] = summarise(rows)
        scenario["hourly"] = rows.drop(columns=keys).round(3).to_dict(orient="records")
        scenarios.append(scenario)

    # Each area's own baseline is its av_fleet = 0 deployment run - no cars, full taxi fleet - so
    # every scenario, whatever its kind, is measured against the same "today".
    baselines = {s["area"]: s["summary"] for s in scenarios
                 if s["kind"] == "deployment" and s["av_fleet"] == 0}
    for s in scenarios:
        base = baselines.get(s["area"])
        if not base:
            continue
        s["vs_baseline"] = {
            "wait_in_area_min": round(s["summary"]["wait_in_area_min"] - base["wait_in_area_min"], 3),
            "total_vehicle_km_pct": round(s["summary"]["total_vehicle_km"] / base["total_vehicle_km"] - 1, 5)
            if base["total_vehicle_km"] else 0.0,
        }

    areas = sorted({s["area"] for s in scenarios})
    OUTPUT.write_text(json.dumps({
        "note": "pipeline/33_deployment_web.py；情景来自 pipeline/32，基准车队来自 pipeline/31",
        "areas": areas,
        "kinds": sorted({s["kind"] for s in scenarios}),
        "taxi_fleet": taxi_fleet,
        "scenarios": scenarios,
        "limits": LIMITS,
    }, ensure_ascii=False, indent=1, default=float), encoding="utf-8")

    print(f"-> {OUTPUT.relative_to(ROOT)}（{OUTPUT.stat().st_size / 1024:.0f} KB）")
    print(f"   {len(scenarios)} 个情景、{len(areas)} 个区域、种类 {sorted({s['kind'] for s in scenarios})}；"
          f"的士车队 {taxi_fleet:,} 辆")
    for kind in sorted({s["kind"] for s in scenarios}):
        best = max((s for s in scenarios if s["kind"] == kind), key=lambda s: s["av_fleet"])
        print(f"   {kind} 最大规模：{best['area']} 无人车 {best['av_fleet']:,} 辆、的士 {best['taxi_fleet']:,} 辆、"
              f"{best['from_hour']}–{best['to_hour']} 时：接走区内 {best['summary']['av_share_in_area']:.1%}、"
              f"区内等待 {best['summary']['wait_in_area_min']:.2f} 分、"
              f"较基准 {best.get('vs_baseline', {}).get('wait_in_area_min', 0):+.2f} 分")


if __name__ == "__main__":
    main()
