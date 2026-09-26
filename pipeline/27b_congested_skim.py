"""Feedback: how much longer each zone-to-zone car trip takes in the congestion the assignment found.

Input : data/model/assignment-am-2026.parquet     each road direction's free-flow and congested minutes (pipeline/27)
        data/model/road-links.parquet, road-connectors.parquet, skim-car-freeflow.npz   (pipeline/15, 17)
        data/model/parameters-tcs2022.json        trips by hour of day, by purpose (pipeline/20, TCS 2022 Fig 3.3)
        data/web/traffic/atc-stations.json        traffic by hour of day at the census stations (pipeline/07)
        data/model/am-peak-2026.npz               car trips, to weight the convergence measure (pipeline/24)
Output: data/model/skim-car-am-delay.npz          zone x zone extra minutes, and a weight per purpose
        data/web/congestion-feedback-audit.json

Why: mode choice (pipeline/23) decided who drives from free-flow car times - an empty road at 8 a.m.
through Lion Rock Tunnel. People who know the tunnel queues take the train instead, so the model put
13-33% too many cars into the tunnel corridors, and no amount of queueing in the assignment could push
them out again (every route across those screenlines is a tunnel). The standard four-step cure is to
feed the congested times back into mode choice and go round until demand and times agree.

What goes back:
  car minutes for mode choice = free-flow minutes (pipeline/17) + weight(purpose) x AM-peak delay
  - AM-peak delay = shortest congested time - shortest free-flow time, on the same graph, so the
    two graphs' small differences from pipeline/17 cancel. A round trip meets the morning queue one way
    and the evening queue the other, so the delay is the average of the two directions.
  - weight(purpose) = how much of the AM peak hour's delay that purpose's trips meet over the day:
    sum over hours of (the purpose's share of trips in the hour) x (traffic in the hour / traffic
    at 8-9)^4 - BPR delay grows with flow to the fourth power. Traffic by hour is the median of the
    2024 census stations; trips by hour are the survey's (HBW, HBS, HBO, and NHB_EB for NHB).
  Averaging: round k keeps (k-1)/k of the old delay and takes 1/k of the new (the method of
  successive averages), so the rounds settle instead of swinging.

Run from the project root, after pipeline/27 (about a minute):
    uv run python pipeline/27b_congested_skim.py            next round (averages with the last)
    uv run python pipeline/27b_congested_skim.py --reset    start over (first round)
    uv run python pipeline/27b_congested_skim.py --check    only measure: do demand and times agree yet? (writes the audit)
The loop itself (23 -> 24 -> 27 -> 27b, until it settles) is pipeline/feedback_loop.py.
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
MODEL, WEB = ROOT / "data" / "model", ROOT / "data" / "web"
ASSIGNMENT = MODEL / "assignment-am-2026.parquet"
FREEFLOW = MODEL / "skim-car-freeflow.npz"
PARAMETERS = MODEL / "parameters-tcs2022.json"
STATIONS = WEB / "traffic" / "atc-stations.json"
PEAK = MODEL / "am-peak-2026.npz"
OUTPUT = MODEL / "skim-car-am-delay.npz"
AUDIT = WEB / "congestion-feedback-audit.json"
CONNECTOR_KPH = 25            # same as pipeline/17 and 27
CENSUS_YEAR = 2024
PURPOSE_PROFILE = {"HBW": "HBW", "HBS": "HBS", "HBO": "HBO", "NHB": "NHB_EB"}
SETTLED_GAP = 0.05            # settled when the delay the assignment produces is within 5% of the one mode choice used


def purpose_weights(report: list) -> dict:
    census = json.loads(STATIONS.read_text(encoding="utf-8"))
    hourly = np.median([r["weekday_pct"] for r in census["hourly"] if r["year"] == CENSUS_YEAR and r.get("weekday_pct")], axis=0)
    relative = (hourly / hourly[8]) ** 4
    profile = json.loads(PARAMETERS.read_text(encoding="utf-8"))["hourly_profile_pct"]
    weights = {}
    for purpose, key in PURPOSE_PROFILE.items():
        share = np.asarray(profile[key], float)
        weights[purpose] = round(float((share / share.sum() * relative).sum()), 3)
    report.append("各目的一天里遇到的塞车（早高峰 8-9 时延误的倍数）：" + "、".join(f"{p} {w:.2f}" for p, w in weights.items())
                  + f"；各小时塞车 = (该小时车流 / 8-9 时车流)^4，车流取 {CENSUS_YEAR} 年普查站中位（中午约为早高峰的 0.5）")
    return weights


def shortest(zones: list[str], congested: bool) -> np.ndarray:
    from scipy.sparse import csr_matrix
    from scipy.sparse.csgraph import dijkstra
    links = pd.read_parquet(MODEL / "road-links.parquet").set_index("link_id")
    a = pd.read_parquet(ASSIGNMENT)
    a = a[a["road_link"] > 0]
    ends = links.loc[a["road_link"], ["a_node", "b_node"]].to_numpy()
    fwd = (a["side"] == "ab").to_numpy()
    n_road = int(links[["a_node", "b_node"]].to_numpy().max()) + 1
    n = len(zones)
    origin = {z: n_road + k for k, z in enumerate(zones)}
    dest = {z: n_road + n + k for k, z in enumerate(zones)}
    con = pd.read_parquet(MODEL / "road-connectors.parquet")
    con = con[con["zone"].isin(origin)]
    c_min = (con["metres"] / 1000 / CONNECTOR_KPH * 60).clip(lower=1e-3).to_numpy()
    road_min = (a["congested_time"] if congested else a["free_time"]).clip(lower=1e-3).to_numpy()
    e = pd.DataFrame({
        "s": np.concatenate([np.where(fwd, ends[:, 0], ends[:, 1]), con["zone"].map(origin), con["node_id"]]).astype(int),
        "d": np.concatenate([np.where(fwd, ends[:, 1], ends[:, 0]), con["node_id"], con["zone"].map(dest)]).astype(int),
        "w": np.concatenate([road_min, c_min, c_min]),
    }).groupby(["s", "d"], as_index=False)["w"].min()   # a sparse matrix would add parallel links together
    size = n_road + 2 * n
    m = csr_matrix((e["w"], (e["s"], e["d"])), shape=(size, size))
    t = dijkstra(m, directed=True, indices=[origin[z] for z in zones])[:, [dest[z] for z in zones]]
    np.fill_diagonal(t, 0)
    return t


def car_trips(zones: list[str]) -> np.ndarray:
    peak = np.load(PEAK)
    pos = {str(z): k for k, z in enumerate(peak["zones"])}
    idx = np.array([pos[z] for z in zones])
    return (peak["V_PV"] + peak["V_TAXI"])[np.ix_(idx, idx)].astype(float)


def main() -> None:
    reset, check = "--reset" in sys.argv, "--check" in sys.argv
    report = []
    zones = [str(z) for z in np.load(FREEFLOW)["zones"]]
    weights = purpose_weights(report)
    free, jam = shortest(zones, False), shortest(zones, True)
    both = np.isfinite(free) & np.isfinite(jam)
    delay = np.where(both, np.maximum(np.where(both, jam, 0) - np.where(both, free, 0), 0.0), 0.0)
    delay = 0.5 * (delay + delay.T)   # morning queue one way, evening queue the other

    history = []
    if OUTPUT.exists() and not reset:
        old = np.load(OUTPUT)
        if [str(z) for z in old["zones"]] != zones:
            raise RuntimeError("zone order changed since the last round: run with --reset")
        history = json.loads(str(old["history"]))
        in_use = old["delay_min"]
    else:
        in_use = np.zeros_like(delay)
    cars = car_trips(zones)
    reach = cars > 0
    mean = lambda m: float((cars * m)[reach].sum() / cars[reach].sum())
    # Do demand and times agree? The delay this assignment produces vs the delay mode choice was given.
    disagree = float((cars * np.abs(delay - in_use))[reach].sum() / max((cars * delay)[reach].sum(), 1e-9))
    settled = bool(history) and disagree < SETTLED_GAP
    if check:
        report.append(f"核对（{len(history)} 轮后）：这次分配的早高峰延误每车次 {mean(delay):.2f} 分钟，方式选择用的 {mean(in_use):.2f} 分钟，"
                      f"相差 {disagree:.1%}" + ("（已稳定）" if settled else f"（未到 {SETTLED_GAP:.0%}）"))
    else:
        k = len(history) + 1
        averaged = in_use + (delay - in_use) / k
        history.append({"round": k, "delay_from_assignment": round(mean(delay), 3), "delay_in_use_before": round(mean(in_use), 3),
                        "delay_averaged": round(mean(averaged), 3), "disagreement": round(disagree, 4)})
        np.savez_compressed(OUTPUT, zones=np.array(zones), delay_min=averaged, weights=json.dumps(weights),
                            history=json.dumps(history))
        report.append(f"第 {k} 轮：这次分配的早高峰延误每车次 {mean(delay):.2f} 分钟（两方向平均），方式选择原来用 {mean(in_use):.2f}，"
                      f"相差 {disagree:.1%}；历次平均后改用 {mean(averaged):.2f} 分钟")
        worst = np.unravel_index(np.argmax(np.where(reach, averaged, 0)), averaged.shape)
        report.append(f"延误最大的有车往来的分区对：{zones[worst[0]]} ↔ {zones[worst[1]]} {averaged[worst]:.1f} 分钟")
    AUDIT.write_text(json.dumps({"method": "拥堵开车时间回代方式选择（逐次平均）", "weights": weights, "history": history,
                                 "last_disagreement": round(disagree, 4), "settled": settled, "settled_gap": SETTLED_GAP,
                                 "flags": [] if (settled or not check) else ["congestion feedback not settled"],
                                 "report": report}, ensure_ascii=False, indent=1), encoding="utf-8")
    for line in report:
        print("   " + line)
    if not check:
        print(f"-> {OUTPUT.relative_to(ROOT)}、{AUDIT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
