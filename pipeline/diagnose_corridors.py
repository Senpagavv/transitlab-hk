"""Read-only diagnosis of the existing 08:00-09:00 road assignment.

Run from any directory with ``python pipeline/diagnose_corridors.py``. Only the
diagnosis JSON is written; assignment, census, and audit inputs are never changed.
The all-network GEH follows pipeline/27's exact-peak *direction* comparison,
while station, corridor, and vehicle-class rows use two-way 08:00-09:00 flows.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
CENSUS_YEAR = 2024
PEAK_BAND = "0800-0900"

# Copied verbatim from pipeline/27_road_assignment.py.
CORRIDORS = {
    "过海": r"CROSS HARBOUR TUNNEL \(|EASTERN HARBOUR CROSSING \(|WESTERN HARBOUR CROSSING \(",
    "沙田－九龙": r"LION ROCK TUNNEL \(|TATE'S CAIRN TUNNEL \(|EAGLE'S NEST TUNNEL \(",
    "屯门－荃湾": r"TAI LAM TUNNEL|TING KAU BRIDGE \(|TUEN MUN RD \(",
    "将军澳": r"TSEUNG KWAN O TUNNEL \(|TSEUNG KWAN O - LAM TIN",
    "大屿山": r"LANTAU LINK \(|TUEN MUN CHEK LAP KOK",
}

# Copied verbatim from pipeline/27's core-station comparison.
CLASSES = {"car": ["private_car", "motorcycle"], "taxi": ["taxi"], "goods_light": ["goods_light"],
           "goods_heavy": ["goods_medium_heavy"], "coach": ["non_franchised_bus", "private_light_bus"],
           "bus": ["franchised_bus_single", "franchised_bus_double", "public_light_bus"]}


def ratio(modelled: float, observed: float) -> float | None:
    return float(modelled / observed) if observed > 0 else None


def geh(modelled: float, observed: float) -> float | None:
    total = modelled + observed
    return float(math.sqrt(2 * (modelled - observed) ** 2 / total)) if total > 0 else None


def check(condition: bool, number: int, detail: str) -> None:
    if not condition:
        raise AssertionError(f"自查 {number} 未通过：{detail}")
    print(f"自查 {number} 通过：{detail}")


def build(root: Path) -> tuple[dict, list[str]]:
    model = root / "data" / "model"
    web = root / "data" / "web"
    table = pd.read_parquet(model / "assignment-am-2026.parquet")
    matched = pd.read_parquet(model / "census-links.parquet")
    census = json.loads((web / "traffic" / "atc-stations.json").read_text(encoding="utf-8"))
    occupancy = json.loads((web / "traffic" / "atc-occupancy.json").read_text(encoding="utf-8"))
    audit = json.loads((web / "assignment-audit.json").read_text(encoding="utf-8"))
    records = pd.DataFrame(census["records"])
    records = records[records["year"] == CENSUS_YEAR]
    profile = {h["station"]: h["weekday_pct"][8] for h in census["hourly"] if h["year"] == CENSUS_YEAR}
    mix = {o["station"]: o["hours"][PEAK_BAND] for o in occupancy["stations"]
           if o["year"] == CENSUS_YEAR and PEAK_BAND in o["hours"]}

    # pipeline/27 indexes the assignment by road_link + side, and sums every
    # matched carriageway for a counted direction. A single station can have
    # several rows per direction (notably the Eastern Harbour Crossing).
    by_side = table.reset_index().set_index(["road_link", "side"])
    mapped = matched.copy()
    for column in ("total", "car", "taxi", "goods_light", "goods_heavy", "coach", "preload"):
        mapped[column] = [float(by_side[column].get((r.link_id, r.side), 0.0))
                          for r in matched.itertuples()]

    # Exact same all-network GEH comparison as pipeline/27: one-way counts
    # whose *own* AM peak is 08:00-09:00, using am_peak_flow.
    modelled_directions = mapped.groupby(["station", "direction"], as_index=False)["total"].sum()
    exact = records[records["am_peak_hour"] == PEAK_BAND][
        ["station", "direction", "link", "road_type", "am_peak_flow"]]
    compare = exact.merge(modelled_directions, on=["station", "direction"])
    compare["geh"] = np.sqrt(2 * (compare["total"] - compare["am_peak_flow"]) ** 2 /
                             (compare["total"] + compare["am_peak_flow"]))
    network_good = float((compare["geh"] < 5).mean())

    by_station = []
    for station, group in records.groupby("station"):
        sides = mapped[mapped["station"] == station]
        # A two-way station is comparable only when all its counted directions
        # have matches. This also matches pipeline/27's OCC eligibility rule.
        if (station not in profile or sides.empty or group["aadt"].isna().any()
                or set(sides["direction"]) != set(group["direction"])):
            continue
        observed = float(group["aadt"].sum() * profile[station] / 100)
        modelled = float(sides["total"].sum())
        per_class = None
        worst_class = None
        if station in mix:
            per_class = {}
            for name, occ_names in CLASSES.items():
                column = "preload" if name == "bus" else name
                class_modelled = float(sides[column].sum())
                class_observed = float(observed * sum(mix[station][n]["share_pct"] for n in occ_names) / 100)
                per_class[name] = {"modelled": class_modelled, "observed": class_observed,
                                   "ratio": ratio(class_modelled, class_observed)}
            eligible = [(name, values) for name, values in per_class.items() if values["observed"] > 50]
            if eligible:
                worst_class = max(eligible, key=lambda item: abs(item[1]["ratio"] - 1))[0]
        by_station.append({"station": int(station), "link": group["link"].iloc[0],
                           "road_type": group["road_type"].iloc[0], "observed": observed,
                           "modelled": modelled, "ratio": ratio(modelled, observed),
                           "geh": geh(modelled, observed), "by_class": per_class,
                           "worst_class": worst_class})

    stations = pd.DataFrame([{k: row[k] for k in ("station", "link", "road_type", "observed", "modelled", "geh")}
                             for row in by_station])
    by_corridor = []
    corridor_gehs = []
    for name, pattern in CORRIDORS.items():
        part = stations[stations["link"].str.contains(pattern, regex=True, na=False)]
        if part.empty:
            continue
        observed = float(part["observed"].sum())
        modelled = float(part["modelled"].sum())
        geh_values = part["geh"].to_numpy()
        corridor_gehs.extend(geh_values.tolist())
        worst = part.loc[part["geh"].idxmax()]
        # Match total volumes before measuring route-choice / internal split.
        internal = float(np.abs(part["modelled"] - part["observed"] * modelled / observed).sum() / observed)
        by_corridor.append({"corridor": name, "stations": int(len(part)), "observed": observed,
                            "modelled": modelled, "ratio": ratio(modelled, observed),
                            "geh_under_5": float(np.mean(geh_values < 5)),
                            "内部分流偏差": internal,
                            "worst_station": {"station": int(worst["station"]), "link": worst["link"],
                                              "observed": float(worst["observed"]),
                                              "modelled": float(worst["modelled"]),
                                              "geh": float(worst["geh"])}})
    corridor_good = float(np.mean(np.array(corridor_gehs) < 5))

    by_class = {}
    core = [row for row in by_station if row["by_class"] is not None]
    for name in CLASSES:
        observed = sum(row["by_class"][name]["observed"] for row in core)
        modelled = sum(row["by_class"][name]["modelled"] for row in core)
        worst = sorted(core, key=lambda row: abs(row["by_class"][name]["modelled"] -
                                               row["by_class"][name]["observed"]), reverse=True)[:5]
        by_class[name] = {"modelled": float(modelled), "observed": float(observed),
                          "ratio": ratio(modelled, observed),
                          "worst_stations": [{"station": row["station"], "link": row["link"],
                                              **row["by_class"][name],
                                              "difference": row["by_class"][name]["modelled"] -
                                                            row["by_class"][name]["observed"]}
                                             for row in worst]}

    # All-network and road-type summaries use the exact-peak direction sample,
    # so the printed GEH is directly comparable with assignment-audit.json.
    road_ratios = {kind: float(group["total"].sum() / group["am_peak_flow"].sum())
                   for kind, group in compare.groupby("road_type")}
    widest = max(by_corridor, key=lambda row: row["内部分流偏差"])
    class_worst = max(by_class, key=lambda name: abs(by_class[name]["ratio"] - 1))
    class_sites = by_class[class_worst]["worst_stations"][:3]
    summary = [
        f"全网 {len(compare)} 个 8–9 时为高峰的计数方向，GEH<5 为 {network_good:.1%}；"
        f"走廊 {len(corridor_gehs)} 站，GEH<5 为 {corridor_good:.1%}（目标 60%）。",
        f"{widest['corridor']}走廊的内部分流偏差最大，为 {widest['内部分流偏差']:.1%}；"
        f"模型总量较普查{('高' if widest['ratio'] >= 1 else '低')} "
        f"{abs(widest['ratio'] - 1):.1%}，对齐总量后仍有上述站间偏差。",
        f"核心站偏差最大的车种是 {class_worst}（模型/普查 {by_class[class_worst]['ratio']:.2f}），"
        f"按车辆数差额主要在 " + "、".join(f"{site['station']} 站（{site['difference']:+.0f} 辆）"
                                     for site in class_sites) + "。",
        "按道路类型，模型/普查为 " + "、".join(f"{kind} {value:.2f}" for kind, value in road_ratios.items()) + "。",
    ]
    if "LOCAL DISTRIBUTOR" in road_ratios:
        summary.append(f"支路（LOCAL DISTRIBUTOR）模型/普查 {road_ratios['LOCAL DISTRIBUTOR']:.2f}；"
                       "接驳线抽象了最后一公里，支路偏低是宏观模型的口径限制，不视为分配缺陷。")

    # The six acceptance checks are intentionally separate.
    task_checks = [
        (1, abs(network_good - audit["geh_under_5"]) < 0.02,
         f"全网 GEH<5 {network_good:.4%}，audit {audit['geh_under_5']:.4%}，差 < 2 个百分点"),
        (2, abs(corridor_good - audit["corridor_geh_under_5"]) < 0.02,
         f"走廊 GEH<5 {corridor_good:.4%}，audit {audit['corridor_geh_under_5']:.4%}，差 < 2 个百分点"),
        (3, set(by_class) == set(audit["per_class_ratio"]) and all(
            abs(by_class[name]["ratio"] - audit["per_class_ratio"][name]) /
            abs(audit["per_class_ratio"][name]) < 0.05 for name in CLASSES),
         "各车种比值相对 audit 每项差 < 5%：" + "、".join(
             f"{name} {by_class[name]['ratio']:.4f}/{audit['per_class_ratio'][name]:.4f}" for name in CLASSES)),
        (4, len(by_station) >= 150, f"by_station {len(by_station)} 站 ≥ 150"),
        (5, sum(row["stations"] for row in by_corridor) <= len(by_station),
         f"走廊站数之和 {sum(row['stations'] for row in by_corridor)} ≤ by_station {len(by_station)}"),
        (6, all(0 <= row["内部分流偏差"] <= 2 for row in by_corridor),
         "各走廊内部分流偏差均在 [0, 2]：" + "、".join(
             f"{row['corridor']} {row['内部分流偏差']:.4f}" for row in by_corridor)),
    ]
    for number, passed, detail in task_checks:
        check(passed, number, detail)
    return {"by_station": by_station, "by_corridor": by_corridor,
            "by_class": by_class, "summary": summary}, summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT, help="project root")
    parser.add_argument("--output", type=Path, help="diagnosis JSON path")
    args = parser.parse_args()
    result, summary = build(args.root)
    output = args.output or args.root / "data" / "web" / "corridor-diagnosis.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"-> {output}")
    for line in summary:
        print(line)


if __name__ == "__main__":
    main()
