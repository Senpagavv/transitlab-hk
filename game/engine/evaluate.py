"""The ledger: who rides, how much time and carbon it saves, what it costs, whether it pays back -
each line with the confidence tier of its weakest input, plus plain-language reasons.

Time savings use the rule of half (old and new trips averaged, times the change in minutes) with the
base model's own values of time, so a design is judged by the same model that was validated.
"""
from __future__ import annotations

import numpy as np

from .network import TYPES, cost
from .params import ANNUAL_DAYS, CARS_PER_TRAIN, CONSTRUCTION_YEARS, weakest

PEAK_HOURS, OFFPEAK_HOURS = 4, 14     # D.service_pattern: peak headway 4 h a day, half as often for 14 h
TIERS = {
    "riders": ["D.route_split_per_min", "P.crowding_factor", "P.transfer_penalty_min", "G.train_kinematics", "G.walk_catchment"],
    "time": ["P.vot", "D.route_split_per_min", "P.crowding_factor", "G.train_kinematics"],
    "capex": ["G.cost_tunnel_km", "G.cost_viaduct_km", "G.cost_atgrade_km", "G.cost_station"],
    "opex": ["G.opex_car_km"],
    "carbon": ["G.emission_factor_vehicle", "G.grid_factor", "D.train_energy_kwh_km", "G.carbon_price"],
    "land": ["D.land_capture_share", "G.price_premium"],
    "npv": ["G.discount_rate", "D.appraisal_years"],
}


def tier_of(params, ids: list[str]) -> str:
    tiers = []
    for pid in ids:
        item = params.items.get(pid, {})
        if "provisional" in item:
            tiers.append("D")
        else:
            tiers.append(item.get("tier", "D"))
    return weakest(*tiers)


def fin(a: np.ndarray) -> np.ndarray:
    return np.where(np.isfinite(a), a, 0.0)


@np.errstate(invalid="ignore")
def evaluate(base, params, net, paths, ref, out, built, key, info, names, zone_labels) -> dict:
    tr = out["transit"]
    N = paths.N
    days = ANNUAL_DAYS
    pf = base.pt_daily_factor

    # ---------- riders ----------
    riders_peak = tr["trips"] if tr else 0.0
    riders_day = riders_peak * pf
    st_board = np.zeros(len(net.stations))
    if tr:
        np.add.at(st_board, paths.node_phys, tr["boards"])
    lines = []
    for li, line in enumerate(net.lines):
        secs = []
        for k, lk in enumerate(net.links):
            if lk["line"] != li:
                continue
            a, b = net.nodes[lk["from"]][1], net.nodes[lk["to"]][1]
            fw, bw = (tr["vol"][2 * k], tr["vol"][2 * k + 1]) if tr else (0.0, 0.0)
            secs.append({"from": names[a], "to": names[b], "km": round(lk["length_m"] / 1000, 2),
                         "minutes": round(lk["minutes"], 1), "load_ab": round(fw), "load_ba": round(bw),
                         "capacity": round(line["capacity"]), "load_factor": round(max(fw, bw) / line["capacity"], 2)})
        nodes = [n for n, (l2, _) in enumerate(net.nodes) if l2 == li]
        boards = float(tr["boards"][nodes].sum()) if tr else 0.0
        lines.append({"name": line["name"], "km": round(line["length_m"] / 1000, 1), "stations": len(line["stations"]),
                      "headway": line["headway"], "capacity": round(line["capacity"]), "sections": secs,
                      "boardings_peak": round(boards), "boardings_day": round(boards * pf),
                      "max_load_factor": max([s["load_factor"] for s in secs], default=0.0),
                      "end_to_end_min": round(sum(s["minutes"] for s in secs), 1)})

    # ---------- time: rule of half, daily ----------
    vot = base.vot
    mins_pt = mins_car = money = 0.0
    by_zone = np.zeros(base.n)
    for p in base.purposes + list(base.crossing):
        like = base.crossing.get(p, p)
        a0, a1 = ref["mode"][f"T_{p}_PT"], out["mode"][f"T_{p}_PT"]
        gain = 0.5 * (a0 + a1) * fin(ref["pt"] - out["pt"])
        mins_pt += gain.sum()
        money += gain.sum() * vot[f"{like}_nopv"]
        np.add.at(by_zone, base.host, gain.sum(axis=1))
        w = base.choice.delay_weight.get(like, 0.0)
        for m in ("PV", "TAXI"):
            c0, c1 = ref["mode"][f"T_{p}_{m}"], out["mode"][f"T_{p}_{m}"]
            g = 0.5 * (c0 + c1) * w * fin(ref["delay"] - out["delay"])
            mins_car += g.sum()
            money += g.sum() * vot[f"{like}_pv"]
            np.add.at(by_zone, base.host, g.sum(axis=1))
    benefit_time = money * days / 1e8                 # HK$ 100 million a year

    # ---------- roads and carbon ----------
    r0, r1 = ref["road"], out["road"]
    km = base.road["km"]
    vehkm_peak = float(((r1["vol"] - r0["vol"]) * km).sum())
    veh_peak = float(sum(out["peak"][f"V_{m}"].sum() - ref["peak"][f"V_{m}"].sum() for m in ("PV", "TAXI", "SPB")))
    delay_hours = float(((r1["vol"] * (r1["time"] - base.road["t0"])).sum() - (r0["vol"] * (r0["time"] - base.road["t0"])).sum()) / 60)
    vehkm_year = vehkm_peak * base.car_daily_factor * days
    ef = params.value("G.emission_factor_vehicle")
    grid = params.items["G.grid_factor"]["value"]
    island = {"Central and Western", "Wan Chai", "Eastern", "Southern"}       # supplied by HK Electric, the rest by CLP
    train_km_year, co2_train_t = 0.0, 0.0
    for l in net.lines:
        if len(l["stations"]) < 2:
            continue
        km_year = 2 * l["length_m"] / 1000 * (PEAK_HOURS * 60 / l["headway"] + OFFPEAK_HOURS * 60 / (2 * l["headway"])) * 365
        on_island = np.mean([base.landuse["district"].iloc[net.stations[s]["zone"]] in island for s in l["stations"]])
        factor = on_island * grid["HK_Electric_2025"] + (1 - on_island) * grid["CLP_HK_2025"]
        train_km_year += km_year
        co2_train_t += km_year * params.value("D.train_energy_kwh_km") * factor / 1000
    co2_road_t = vehkm_year * ef / 1000
    co2_t = co2_road_t + co2_train_t                  # negative = less carbon
    carbon_value = -co2_t * params.value("G.carbon_price") / 1e8

    # ---------- money ----------
    capex = cost(net, params)
    opex = train_km_year * CARS_PER_TRAIN * params.value("G.opex_car_km") / 1e8
    capture = params.value("D.land_capture_share")
    land = 0.0
    for d in built:
        price = base.prices["dom_price_m2"].iloc[d["zone"]]
        price = float(price) if np.isfinite(price) else float(base.prices["dom_price_m2"].median())
        d["value_yi"] = (d["residential_m2"] + d["office_m2"]) * price / 1e8
        land += d["value_yi"] * capture
    r = params.value("G.discount_rate")
    Y = int(params.value("D.appraisal_years"))
    C = CONSTRUCTION_YEARS
    years = np.arange(1, Y + 1)
    disc = (1 + r) ** -years
    cap_flow = np.where(years <= C, capex["total"] / C, 0.0)
    run_ = years > C
    ben_flow = np.where(run_, benefit_time + carbon_value, 0.0) + np.where(years == C, land, 0.0)
    cost_flow = cap_flow + np.where(run_, opex, 0.0)
    pv_ben, pv_cost = float((ben_flow * disc).sum()), float((cost_flow * disc).sum())
    npv = pv_ben - pv_cost
    cum = np.cumsum(ben_flow - cost_flow)
    after = np.nonzero(cum >= 0)[0]
    payback = int(years[after[0]]) if len(after) and cum[-1] >= 0 else None
    tiers = {k: tier_of(params, v) for k, v in TIERS.items()}
    tier_all = weakest(*tiers.values())

    # ---------- who gains ----------
    top = np.argsort(by_zone)[::-1][:8]
    gainers = [{"zone": base.inner[z], "label": zone_labels[z], "minutes_day": round(float(by_zone[z])), "lon": float(base.zone_lon[z]),
                "lat": float(base.zone_lat[z])} for z in top if by_zone[z] > 0]
    zone_gain = [{"lon": round(float(base.zone_lon[z]), 5), "lat": round(float(base.zone_lat[z]), 5),
                  "hours_day": round(float(by_zone[z]) / 60, 1)} for z in np.nonzero(np.abs(by_zone) > 600)[0]]

    stations = []
    for s, st in enumerate(net.stations):
        stations.append({"name": names[s], "lon": st["lon"], "lat": st["lat"], "interchange": bool(st["existing"]),
                         "boardings_peak": round(float(st_board[s])), "boardings_day": round(float(st_board[s] * pf)),
                         "dev": st.get("dev")})

    ledger = {
        "riders_day": round(riders_day), "riders_peak": round(riders_peak),
        "transfers_peak": round(tr["transfers"]) if tr else 0,
        "interchange_share": round(float(sum(st_board[s] for s, st in enumerate(net.stations) if st["existing"]) / max(st_board.sum(), 1)), 2),
        "pt_hours_saved_day": round(mins_pt / 60), "car_hours_saved_day": round(mins_car / 60),
        "benefit_time_yi": round(benefit_time, 2), "cars_peak": round(veh_peak), "delay_hours_peak": round(delay_hours),
        "vehkm_year": round(vehkm_year), "co2_t_year": round(co2_t), "co2_road_t": round(co2_road_t),
        "co2_train_t": round(co2_train_t), "carbon_value_yi": round(carbon_value, 3),
        "capex_yi": round(capex["total"], 1), "capex_by_type": {TYPES[t][0]: round(v, 1) for t, v in capex["by_type"].items()},
        "km_by_type": {TYPES[t][0]: round(v, 2) for t, v in capex["km"].items()}, "capex_stations_yi": round(capex["stations"], 1),
        "opex_yi_year": round(opex, 2), "train_km_year": round(train_km_year), "land_yi": round(land, 1),
        "pv_benefit_yi": round(pv_ben, 1), "pv_cost_yi": round(pv_cost, 1), "npv_yi": round(npv, 1),
        "bcr": round(pv_ben / pv_cost, 2) if pv_cost > 0 else None, "payback_year": payback,
        "years": Y, "discount": r, "tiers": tiers, "tier": tier_all,
    }
    result = {"ok": True, "ledger": ledger, "lines": lines, "stations": stations, "gainers": gainers,
              "zone_gain": zone_gain, "built": [{k: (round(v) if isinstance(v, float) else v) for k, v in d.items()} for d in built],
              "problems": net.problems, "segments": [{"line": s["line"], "type": s["type"], "km": round(s["length_m"] / 1000, 2),
                                                     "water": round(s["profile"]["water"], 2)} for s in net.segments]}
    result["why"] = reasons(result, net, paths)
    if key:
        result["score"] = score(base, ref, out, ledger, lines, info, key)
    return result


def reasons(res: dict, net, paths) -> list[dict]:
    """Plain-language cards explaining the result."""
    L, out = res["ledger"], []
    km_total = sum(l["km"] for l in res["lines"]) or 1
    per_km = L["riders_day"] / km_total
    if per_km >= 12000:
        out.append({"kind": "good", "text": f"每公里每天约 {per_km:,.0f} 人次坐新线，线路用得很满。"})
    elif per_km < 4000:
        out.append({"kind": "bad", "text": f"每公里每天只有约 {per_km:,.0f} 人次坐新线：车站周边人少，或者新线没比原来的走法快多少。"})
    tunnel = L["capex_by_type"].get("隧道", 0)
    if L["capex_yi"] > 0 and tunnel / L["capex_yi"] > 0.6:
        out.append({"kind": "info", "text": f"造价的 {tunnel / L['capex_yi']:.0%} 花在隧道上（市区地下、过海或穿山）。郊区空地可以改高架，便宜一半。"})
    hot = [l for l in res["lines"] if l["max_load_factor"] > 1.0]
    for l in hot:
        sec = max(l["sections"], key=lambda s: s["load_factor"])
        out.append({"kind": "bad", "text": f"{l['name']} 最挤的一段（{sec['from']}→{sec['to']}）早高峰载客率 {sec['load_factor']:.0%}，"
                                           f"车太挤会让人改走别的路。可以把班次加密。"})
    if not any(st["interchange"] for st in res["stations"]):
        out.append({"kind": "bad", "text": "新线没有接上现有港铁（150 米内没有现有站），乘客没法直接换乘，很多人用不上。"})
    else:
        out.append({"kind": "good", "text": "新线和现有港铁有换乘站，乘客可以接驳到全港网络。"})
    if L["cars_peak"] < -200:
        out.append({"kind": "good", "text": f"早高峰路上少了约 {-L['cars_peak']:,} 辆车，全港塞车少了约 {max(-L['delay_hours_peak'], 0):,} 车·小时。"})
    elif L["cars_peak"] > 200:
        out.append({"kind": "info", "text": f"早高峰路上多了约 {L['cars_peak']:,} 辆车：站旁新开发带来的新出行，有一部分开车。"})
    if L["bcr"] is not None:
        if L["bcr"] >= 1:
            out.append({"kind": "good", "text": f"按 {L['years']} 年算，每花 1 元换回 {L['bcr']:.2f} 元的好处。"})
        else:
            out.append({"kind": "bad", "text": f"按 {L['years']} 年算，每花 1 元只换回 {L['bcr']:.2f} 元的好处。试试把站放到人多的地方、少挖隧道，或者在站旁开发。"})
    if res["gainers"]:
        out.append({"kind": "info", "text": "最受益的地方：" + "、".join(g["label"] for g in res["gainers"][:4]) + "。"})
    return out


def score(base, ref, out, L, lines, info, key) -> dict:
    """Scenario score out of 100: commute of the new residents, fewer cars, the money, and use."""
    from .scenario import SCENARIOS
    sc = SCENARIOS[key]
    nm = np.zeros(base.n_all, bool)
    nm[: base.n] = info["nm_mask"]

    def commute(state):
        t = state["mode"]["T_HBW_PT"][nm]
        return float((t * fin(state["pt"][nm])).sum() / max(t.sum(), 1))

    def car_share(state):
        car = sum(state["mode"][f"T_{p}_{m}"][nm].sum() for p in ("HBW", "HBO", "HBS") for m in ("PV", "TAXI"))
        allm = sum(state["mode"][f"T_{p}_{m}"][nm].sum() for p in ("HBW", "HBO", "HBS") for m in base.modes)
        return float(car / max(allm, 1))

    c0, c1 = commute(ref), commute(out)
    k0, k1 = car_share(ref), car_share(out)
    saved = c0 - c1
    fewer = (k0 - k1) / max(k0, 1e-9)
    km = sum(l["km"] for l in lines) or 1
    per_km = L["riders_day"] / km
    bcr = L["bcr"] or 0.0
    parts = [
        {"name": "北都居民通勤更快", "points": 30 * float(np.clip(saved / 4, 0, 1)), "max": 30,
         "value": f"北都居民每趟公交上班平均省 {saved:.1f} 分钟（{c0:.1f} → {c1:.1f} 分钟）"},
        {"name": "少开车", "points": 15 * float(np.clip(fewer / 0.08, 0, 1)), "max": 15,
         "value": f"北都居民出行开车的比例 {k0:.1%} → {k1:.1%}"},
        {"name": "账算得过来", "points": 40 * float(np.clip((bcr - 0.2) / 1.0, 0, 1)), "max": 40,
         "value": f"效益/成本 = {bcr:.2f}（1.2 以上满分）"},
        {"name": "新线有人坐", "points": 15 * float(np.clip(per_km / 12000, 0, 1)), "max": 15,
         "value": f"每公里每天 {per_km:,.0f} 人次（1.2 万以上满分）"},
    ]
    total = sum(p["points"] for p in parts)
    over = L["capex_yi"] > sc["budget_yi"]
    if over:
        total *= 0.7
    grade = "S" if total >= 85 else "A" if total >= 70 else "B" if total >= 55 else "C" if total >= 40 else "D"
    for p in parts:
        p["points"] = round(p["points"], 1)
    return {"total": round(total, 1), "grade": grade, "parts": parts, "over_budget": over, "budget_yi": sc["budget_yi"],
            "commute_before": round(c0, 1), "commute_after": round(c1, 1)}
