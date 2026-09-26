"""How much traffic slows the roads, measured: fit the BPR congestion curve to Hong Kong's detectors.

Input : data/web/traffic/observed-YYYY-MM-DD.json   hourly flow and speed per detector (pipeline/05; weekdays used)
        data/model/road-links.parquet               capacities (pipeline/15)
        (detectors are placed on links by pipeline/15d's place_detectors: same road, same direction, within 30 m)
Output: data/model/bpr-parameters.json              alpha, beta for pipeline/27
        data/web/bpr-calibration-audit.json

The assignment's travel time on a road is  free-flow time x (1 + alpha x (flow / capacity)^beta).
The textbook values (alpha 0.15, beta 4) keep a road at almost free-flow speed until it is nearly full:
at half its capacity it is 1% slower. Hong Kong's detectors disagree - at half capacity they are
already 9% slower, at capacity 38% (weekday medians per detector and hour, 24 weekdays, 680 detectors;
time ratio = the detector's night speed / its speed that hour). With the textbook curve the model
had the morning peak only 6% slower than the night on the detector roads, against 20% measured, so
people in the model had little reason to avoid congested routes or to leave the car at home.

Fit: the detector-hours are binned by flow / capacity (0.1 wide, bins with at least 20); alpha is
the weighted least-squares fit to the bins' MEAN time ratio (the travel time people plan on includes
the bad days), with beta fixed at 2. Left free, beta comes out near 1.3 - but detectors measure spot
speed in mid-link and miss the queues at junctions and merges, which is where delay grows fastest near
capacity; a beta that low would also let the assignment pile traffic onto full roads. Beta 2 keeps
the capacity restraint (1.5 x capacity costs 85% more time) and fits the bins within 3%.
Detectors sit almost all on expressways (637 of 680), so the one curve is used for every road class;
urban junction delay is, if anything, steeper still.

Run from the project root (about a minute), after pipeline/05 and 15:
    uv run python pipeline/15e_bpr_calibration.py
"""
import importlib.util
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
TRAFFIC = ROOT / "data" / "web" / "traffic"
OUTPUT = ROOT / "data" / "model" / "bpr-parameters.json"
AUDIT = ROOT / "data" / "web" / "bpr-calibration-audit.json"
BETA = 2.0
NIGHT = (1, 4)          # hours whose median speed is the detector's free-flow speed
MIN_BIN = 20


def placed_detectors(report: list) -> pd.DataFrame:
    spec = importlib.util.spec_from_file_location("speeds", ROOT / "pipeline" / "15d_speed_profiles.py")
    speeds = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(speeds)
    placed = speeds.place_detectors(speeds.links_with_shapes(), report)
    return placed[placed["same_road"]]


def main() -> None:
    report, flags = [], []
    rows, days = [], 0
    for path in sorted(TRAFFIC.glob("observed-*.json")):
        day = json.loads(path.read_text(encoding="utf-8"))
        if day["weekday"] in ("Saturday", "Sunday"):
            continue
        days += 1
        for det in day["detectors"]:
            for h in range(24):
                rows.append((det["id"], h, det["vehicles_per_hour"][h], det["speed_kph"][h]))
    obs = pd.DataFrame(rows, columns=["id", "hour", "flow", "speed"]).dropna()
    med = obs.groupby(["id", "hour"])[["flow", "speed"]].median().reset_index()
    links = pd.read_parquet(ROOT / "data" / "model" / "road-links.parquet").set_index("link_id")
    d = med.merge(placed_detectors(report)[["id", "link_id", "side"]], on="id")
    d["capacity"] = np.where(d["side"] == "ab", links.loc[d["link_id"], "capacity_ab_veh_hr"], links.loc[d["link_id"], "capacity_ba_veh_hr"])
    d["road_class"] = links.loc[d["link_id"], "road_class"].to_numpy()
    free = d[d["hour"].between(*NIGHT)].groupby("id")["speed"].median().rename("free_kph")
    d = d.join(free, on="id")
    d["x"], d["y"] = d["flow"] / d["capacity"], d["free_kph"] / d["speed"]
    d = d[(d["speed"] > 3) & (d["flow"] > 0) & d["y"].notna()]

    bins = d.assign(bin=pd.cut(d["x"], np.arange(0, 3.01, 0.1))).groupby("bin", observed=True).agg(
        n=("y", "size"), x=("x", "median"), y_mean=("y", "mean"), y_median=("y", "median"))
    bins = bins[bins["n"] >= MIN_BIN]
    X, w = bins["x"] ** BETA, bins["n"]
    alpha = float((w * X * (bins["y_mean"] - 1)).sum() / (w * X * X).sum())
    fitted = 1 + alpha * X
    rmse = float(np.sqrt((w * (fitted - bins["y_mean"]) ** 2).sum() / w.sum()))
    old = 1 + 0.15 * bins["x"] ** 4
    rmse_old = float(np.sqrt((w * (old - bins["y_mean"]) ** 2).sum() / w.sum()))

    report.append(f"探测器：{days} 个工作日、{d['id'].nunique()} 个探测器（按等级 "
                  + "、".join(f"{k} {v}" for k, v in d.groupby("road_class")["id"].nunique().items())
                  + f"）、{len(d):,} 个探测器-小时；塞车倍数 = 该探测器深夜 {NIGHT[0]}-{NIGHT[1]} 时车速中位 / 该小时车速")
    report.append(f"拟合（beta 固定 {BETA:g}，按车流/通行能力分组的平均塞车倍数加权最小二乘）：alpha = {alpha:.3f}，"
                  f"加权均方根误差 {rmse:.3f}（原来 0.15/4 为 {rmse_old:.3f}）")
    report.append("实测 vs 新公式 vs 原公式（车流/通行能力 → 行程时间倍数）：" + "；".join(
        f"{r.x:.2f} → {r.y_mean:.2f} / {1 + alpha * r.x ** BETA:.2f} / {1 + 0.15 * r.x ** 4:.2f}"
        for r in bins.itertuples() if round(r.x, 1) in (0.3, 0.5, 0.7, 0.9, 1.0, 1.2)))
    if rmse > 0.05:
        flags.append("BPR fit error above 5%")
    OUTPUT.write_text(json.dumps({"alpha": round(alpha, 4), "beta": BETA, "source": "pipeline/15e_bpr_calibration.py"},
                                 indent=1), encoding="utf-8")
    AUDIT.write_text(json.dumps({"alpha": round(alpha, 4), "beta": BETA, "rmse": round(rmse, 4), "rmse_textbook": round(rmse_old, 4),
                                 "days": days, "detectors": int(d["id"].nunique()),
                                 "bins": bins.round(4).reset_index(drop=True).to_dict("records"),
                                 "flags": flags, "report": report}, ensure_ascii=False, indent=1), encoding="utf-8")
    for line in report:
        print("   " + line)
    print(f"-> {OUTPUT.relative_to(ROOT)}、{AUDIT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
