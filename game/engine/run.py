"""One play: the player's lines (and station-area development) through the whole four-step model.

Each round:
  1. transit  - new door-to-door times through the new lines, riders loaded, crowding (transit.py)
  2. demand   - where trips go (pipeline/22) and which mode (pipeline/23) with the new times and the
                current road congestion, then the 08:00-09:00 hour (pipeline/24)
  3. roads    - the change in cars put on the real road network, new congestion (road.py)
Rounds repeat with averaging until the numbers settle. Everything is added to the base as a difference,
so with nothing built the result is exactly the validated 2026 base.
"""
from __future__ import annotations

import time

import numpy as np

from . import network, road, scenario, transit
from .base import get_base
from .evaluate import evaluate
from .params import Params
from .places import get_places

ROUNDS = 4
CAR_MODES = ("PV", "TAXI", "SPB")


def vehicles(peak: dict) -> np.ndarray:
    return sum(peak[f"V_{m}"] for m in CAR_MODES)


@np.errstate(invalid="ignore")
def solve(base, params, paths, ends, label, progress, rounds: int = ROUNDS) -> dict:
    per_min = params.value("D.route_split_per_min")
    saving = np.zeros_like(base.cost22)
    delay = base.delay23.copy()
    peak = base.peak0
    road_extra, tr_vol, tr = None, None, None
    v0 = vehicles(base.peak0)
    history = []
    for r in range(1, rounds + 1):
        t = time.time()
        if paths is not None and paths.N >= 2:
            tr = transit.assign(paths, peak["P_PT"], base.cost22, per_min, iterations=6 if r == 1 else 3, start_vol=tr_vol)
            tr_vol = tr["vol"]
            ok = (tr["share"] > 0) & np.isfinite(base.cost22) & np.isfinite(tr["T"])
            gain = np.zeros_like(saving)
            gain[ok] = tr["share"][ok] * np.maximum(base.cost22[ok] - tr["T"][ok], 0)
            saving = saving + (gain - saving) / r
        progress(label, r, "transit", tr)
        dist_new = base.distribute(base.cost22 - saving, ends)
        dist = {p: np.maximum(base.trips_file[f"T_{p}"] + dist_new[p] - base.dist0[p], 0)
                for p in base.purposes + list(base.crossing)}
        pt = np.maximum(base.pt23 - saving, 0.5)
        split = base.split(dist, pt, delay)
        mode = {k: np.maximum(base.mode_file[k] + split[k] - base.split0[k], 0) for k in base.split0}
        peak = base.peak(mode)
        progress(label, r, "demand", None)
        rd = road.assign(base, vehicles(peak) - v0, start=road_extra)
        road_extra = rd["extra"]
        new_delay = road.delay_from(base, rd["skim"])
        delay = np.where(np.isfinite(delay), delay + (np.where(np.isfinite(new_delay), new_delay, delay) - delay) / r, delay)
        history.append({"round": r, "seconds": round(time.time() - t, 1),
                        "riders_peak": round(tr["trips"]) if tr else 0,
                        "pt_peak": round(float(peak["P_PT"].sum())),
                        "cars_peak": round(float(vehicles(peak).sum() - v0.sum()))})
        progress(label, r, "road", history[-1])
    return {"dist": dist, "mode": mode, "peak": peak, "pt": pt, "saving": saving, "delay": delay, "road": rd,
            "transit": tr, "history": history, "ends": ends}


def base_state(base) -> dict:
    r = base.road
    return {"dist": {p: base.trips_file[f"T_{p}"] for p in base.purposes + list(base.crossing)},
            "mode": base.mode_file, "peak": base.peak0, "pt": base.pt23, "saving": np.zeros_like(base.cost22),
            "delay": base.delay23, "road": {"vol": r["vol"], "time": r["time0"], "skim": base.car_skim0},
            "transit": None, "history": [], "ends": base.ends}


def station_names(net) -> list[str]:
    places = get_places()
    by_id = {r["id"]: r["name_zh"] for r in places.existing}
    names, seen = [], {}
    for st in net.stations:
        if st["existing"]:
            name = by_id.get(st["existing"]["id"], st["existing"]["name"])
        else:
            name = st.get("name") or places.zones[st["zone"]]["label"].removesuffix("站一带").removesuffix("一带")
            name += "（新）"
        seen[name] = seen.get(name, 0) + 1
        names.append(name if seen[name] == 1 else f"{name}{seen[name]}")
    return names


_REF: dict = {}


def reference(base, params, key, rates, progress) -> tuple[dict, dict]:
    """The world without the player's lines: the 2026 base, or the scenario with nothing built (cached)."""
    if not key:
        return base_state(base), {}
    if key not in _REF:
        ends, info = scenario.scenario_ends(base, key, rates)
        _REF[key] = (solve(base, params, None, ends, "ref", progress), info)
    return _REF[key]


def run(design: dict, scenario_key: str | None = None, progress=None, mission: str | None = None, flags: dict | None = None) -> dict:
    progress = progress or (lambda *a: None)
    t0 = time.time()
    base, params = get_base(), Params()
    rates = scenario.Rates(base)
    ref, info = reference(base, params, scenario_key, rates, progress)
    net = network.build(design, base, params)
    if net.problems and not any(len(l["stations"]) >= 2 for l in net.lines):
        return {"ok": False, "problems": net.problems}
    paths = network.Paths(net, base, params)
    ends = ref["ends"].copy()
    built = scenario.developments(base, ends, net, rates)
    out = solve(base, params, paths, ends, "design", progress)
    labels = [z["label"] for z in get_places().zones]
    result = evaluate(base, params, net, paths, ref, out, built, scenario_key, info, station_names(net), labels)
    if mission:
        from .missions import get_missions, score
        result["mission"] = score(get_missions(), mission, result, out["saving"], flags or {})
    result["seconds"] = round(time.time() - t0, 1)
    result["history"] = out["history"]
    return result
