"""Missions made from data, not written by hand, and how a play is scored step by step.

Three templates (docs/design/game-v2-missions.md):
  commute  - the morning-peak public-transport flows between districts that are both big and slow
  gov      - a railway the government has announced (data/raw/planned-railways): beat it
  growth   - a scenario that adds residents (scenario.py)
Each mission has a measurable goal that the 0.03 s estimate (transit only, base demand) can show while
the player draws, and that the full model confirms on "opening day".
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
from pathlib import Path

import numpy as np

from . import network, transit
from .base import RAW
from .params import Params

PLANNED = RAW / "planned-railways" / "planned_railways.geojson"
# heavy-rail projects that can be played as "beat the government" (smart-green systems are a different mode)
# (lines that mainly serve future development areas or Shenzhen - NOLE, NOLS, HSWRL, TKOS - have almost no 2026
#  demand in the model, so they would be unfair rivals here; they belong with growth missions later)
GOV_PROJECTS = ["NOL", "CRL", "NENT", "TMS", "TCL"]
GOV_HEADWAY = 4.0
# interchanges the government line relies on that are still being built in 2026: represented by riding on to
# the next existing station of that line (e.g. Kwu Tung East Rail station -> on to Sheung Shui), as surface
# track so it costs little
GOV_LINK_ON = {"NOL": [(114.127861, 22.501383, "上水（经在建的古洞站转东铁线）")]}
BEND_SKIP_M = 150.0
UNIT_FOR_BUDGET = 28.0          # 亿/km used only to size a commute mission's budget


def _round_up(x: float, step: float) -> float:
    return float(np.ceil(x / step) * step)


class Missions:
    def __init__(self, base, places, params: Params | None = None) -> None:
        self.base, self.places = base, places
        self.params = params or Params()
        self.per_min = self.params.value("D.route_split_per_min")
        self.items: dict[str, dict] = {}
        self.focus: dict[str, tuple[np.ndarray, np.ndarray]] = {}
        self.benchmarks: dict[str, dict] = {}
        self._gov()
        self._commute()
        self._growth()

    # ---------- the measurable goal ----------
    def flows(self, key: str) -> np.ndarray:
        """Peak-hour public-transport flows the mission is judged on (470 x 470)."""
        m = self.items[key]
        if m.get("scenario"):
            from . import run as R
            ref = R._REF.get(m["scenario"])
            if ref:
                return ref[0]["peak"]["P_PT"]
        return self.base.peak0["P_PT"]

    def target(self, key: str, saving: np.ndarray, flows: np.ndarray | None = None) -> dict:
        """Average door-to-door minutes over the mission's focus pairs, before and after."""
        o, d = self.focus[key]
        f = (self.flows(key) if flows is None else flows)[np.ix_(o, d)]
        c = self.base.cost22[np.ix_(o, d)]
        ok = np.isfinite(c) & (f > 0)
        w = np.where(ok, f, 0.0)
        before = float((w * np.where(ok, c, 0)).sum() / max(w.sum(), 1e-9))
        gain = float((w * saving[np.ix_(o, d)]).sum() / max(w.sum(), 1e-9))
        return {"before": round(before, 1), "after": round(before - gain, 1), "saved": round(gain, 2),
                "people": round(float(w.sum()))}

    # ---------- fast estimate for any design (also used for the government lines) ----------
    def quick(self, design: dict, key: str | None) -> dict:
        b = self.base
        net = network.build(design, b, self.params)
        if not any(len(l["stations"]) >= 2 for l in net.lines):
            return {"ok": False}
        paths = network.Paths(net, b, self.params)
        flows = self.flows(key) if key else b.peak0["P_PT"]
        tr = transit.assign(paths, flows, b.cost22, self.per_min, iterations=3)
        ok = (tr["share"] > 0) & np.isfinite(b.cost22) & np.isfinite(tr["T"])
        saving = np.zeros_like(b.cost22)
        saving[ok] = tr["share"][ok] * np.maximum(b.cost22[ok] - tr["T"][ok], 0)
        pf = b.pt_daily_factor
        st_board = np.zeros(len(net.stations))
        np.add.at(st_board, paths.node_phys, tr["boards"])
        cost = network.cost(net, self.params)
        out = {"ok": True, "riders_peak": round(tr["trips"]), "riders_day": round(tr["trips"] * pf),
               "hours_saved_day": round(float((flows * saving).sum()) * pf / 60),
               "capex_yi": round(cost["total"], 1), "km": round(sum(l["length_m"] for l in net.lines) / 1000, 2),
               "interchanges": [s["existing"]["name"] for s in net.stations if s["existing"]],
               "stations": [{"lon": s["lon"], "lat": s["lat"], "boardings_day": round(float(st_board[k] * pf)),
                             "existing": bool(s["existing"])} for k, s in enumerate(net.stations)],
               "sections": [], "stories": self.stories(flows, saving, tr["T"])}
        for k, lk in enumerate(net.links):
            a, c = net.nodes[lk["from"]][1], net.nodes[lk["to"]][1]
            cap = net.lines[lk["line"]]["capacity"]
            out["sections"].append({"line": lk["line"], "a": a, "b": c, "load": round(float(max(tr["vol"][2 * k], tr["vol"][2 * k + 1]))),
                                    "lf": round(float(max(tr["vol"][2 * k], tr["vol"][2 * k + 1]) / cap), 2)})
        if key:
            out["target"] = self.target(key, saving, flows)
        return out

    def stories(self, flows: np.ndarray, saving: np.ndarray, T: np.ndarray, top: int = 4) -> list[dict]:
        """Real zone-to-zone flows that gain the most - the people behind the numbers."""
        b, n = self.base, self.base.n
        score = flows[:n, :n] * saving[:n, :n]
        out = []
        for flat in np.argsort(score, axis=None)[::-1][: top * 6]:
            i, j = divmod(int(flat), n)
            if saving[i, j] < 3 or flows[i, j] < 20:
                continue
            if any(s["o"] == i or s["d"] == j for s in out):
                continue
            zi, zj = self.places.zones[i], self.places.zones[j]
            out.append({"o": i, "d": j, "from": zi["label"], "to": zj["label"], "lon": zi["lon"], "lat": zi["lat"],
                        "people_peak": round(float(flows[i, j])), "before": round(float(b.cost22[i, j])),
                        "after": round(float(b.cost22[i, j] - saving[i, j]))})
            if len(out) == top:
                break
        return out

    # ---------- template: beat the government ----------
    def _gov(self) -> None:
        b = self.base
        g = json.loads(PLANNED.read_text(encoding="utf-8"))
        projects = {p["project_id"]: p for p in g.get("projects", [])} if isinstance(g.get("projects"), list) else g.get("projects", {})
        feats = g["features"]
        for pid in GOV_PROJECTS:
            lines = [f for f in feats if f["geometry"] and f["geometry"]["type"] == "LineString"
                     and f["properties"]["project_id"] == pid and f["properties"].get("enabled_by_default", True)]
            if not lines:
                continue
            design_lines, names = [], []
            for lf in lines:
                lid = lf["properties"]["line_id"]
                coords = lf["geometry"]["coordinates"]
                xy = np.array([b.to_grid.transform(lon, lat) for lon, lat in coords])
                seg = np.hypot(*np.diff(xy, axis=0).T)
                chain = np.concatenate([[0], np.cumsum(seg)])
                pts = []
                for f in feats:
                    p = f["properties"]
                    if not f["geometry"] or f["geometry"]["type"] != "Point" or lid not in (p.get("line_ids") or []):
                        continue
                    lon, lat = f["geometry"]["coordinates"]
                    x, y = b.to_grid.transform(lon, lat)
                    if not len(b.zone_geo.sindex.query(__import__("shapely").geometry.Point(x, y), predicate="within")):
                        continue          # outside Hong Kong (Shenzhen end) - the model has no zones there
                    k = int(np.argmin(np.hypot(xy[:, 0] - x, xy[:, 1] - y)))
                    pts.append((chain[k], {"lon": lon, "lat": lat, "kind": "station", "name": p.get("name_zh")}))
                if len(pts) < 2:
                    continue
                pts.sort(key=lambda t: t[0])
                lo, hi = pts[0][0], pts[-1][0]
                for k, (lon, lat) in enumerate(coords):          # bends of the published alignment between its stations
                    if lo < chain[k] < hi and min(abs(chain[k] - c) for c, _ in pts) > BEND_SKIP_M:
                        pts.append((chain[k], {"lon": lon, "lat": lat, "kind": "bend"}))
                pts.sort(key=lambda t: t[0])
                extra = [{"lon": lon, "lat": lat, "kind": "station", "name": nm} for lon, lat, nm in GOV_LINK_ON.get(pid, [])]
                types = [None] * (len(pts) - 1) + ["surface"] * len(extra)
                design_lines.append({"id": lid, "segment_types": types, "name": lf["properties"].get("name_zh", lid), "headway_min": GOV_HEADWAY,
                                     "points": [p for _, p in pts] + extra})
                names.append(lf["properties"].get("name_zh", lid))
            if not design_lines:
                continue
            design = {"lines": design_lines}
            q = self.quick(design, None)
            if not q.get("ok"):
                continue
            meta = projects.get(pid, {}) if isinstance(projects, dict) else {}
            p0 = lines[0]["properties"]
            key = f"g-{pid}"
            name = meta.get("name_zh") or p0.get("name_zh", pid)
            budget = _round_up(q["capex_yi"] * 1.1, 10)
            n_st = sum(1 for l in design_lines for p in l["points"] if p["kind"] == "station")
            when = f"，目标 {meta['opening'].split('；')[0]}" if meta.get("opening") else ""
            self.items[key] = {
                "id": key, "kind": "gov", "title": f"打败政府方案：{name}",
                "story": f"政府已公布「{name}」（{p0.get('status', '')}{when}；按公布的示意走线约 {q['km']:.1f} 公里、{n_st} 个站）。"
                         f"同样的造价单价、{budget:.0f} 亿预算，你能修一条更多人坐、更划算的线吗？",
                "budget_yi": budget, "metric": {"type": "riders", "label": "每天坐新线", "goal": q["riders_day"],
                                                "unit": "人次/天", "before": 0},
                "gov": {"project": pid, "name": name, "status": p0.get("status"), "design": design, "quick": q,
                        "official_cost": meta.get("cost"), "opening": meta.get("opening"),
                        "length_note": p0.get("published_project_length")},
                "view": self._view_of(design),
            }
            o = np.zeros(b.n_all, bool)
            o[:] = True
            self.focus[key] = (o, o.copy())

    def _view_of(self, design: dict) -> list:
        lons = [p["lon"] for l in design["lines"] for p in l["points"]]
        lats = [p["lat"] for l in design["lines"] for p in l["points"]]
        return [[min(lats), min(lons)], [max(lats), max(lons)]]

    # ---------- template: big and slow commuting flows ----------
    def _commute(self, top: int = 8) -> None:
        b, pl = self.base, self.places
        n = b.n
        P = b.peak0["P_PT"][:n, :n]
        C = b.cost22[:n, :n]
        ok = np.isfinite(C)
        dist = np.array([z["district"] for z in pl.zones])
        names = sorted(set(dist))
        idx = np.array([names.index(d) for d in dist])
        cand = []
        for a in range(len(names)):
            for c in range(len(names)):
                if a == c:
                    continue
                o, d = idx == a, idx == c
                f = P[np.ix_(o, d)]
                t = C[np.ix_(o, d)]
                good = ok[np.ix_(o, d)]
                F = float(f[good].sum())
                if F < 2500:
                    continue
                T = float((f[good] * t[good]).sum() / F)
                if T < 45:
                    continue
                cand.append((F * (T - 35), a, c, F, T))
        cand.sort(reverse=True)
        road = np.array([z.get("road_access", True) for z in pl.zones], bool)
        used, per_origin = set(), {}
        for _, a, c, F, T in cand:
            if (c, a) in used or len(used) >= top or per_origin.get(a, 0) >= 2:
                continue
            used.add((a, c))
            per_origin[a] = per_origin.get(a, 0) + 1
            o_all, d_all = np.nonzero(idx == a)[0], np.nonzero(idx == c)[0]
            fo = P[np.ix_(o_all, d_all)].sum(axis=1)
            fd = P[np.ix_(o_all, d_all)].sum(axis=0)

            def core(zones, f, radius, share=0.7, most=8):
                """A compact cluster around the busiest zone: what one line could reasonably serve."""
                f = np.where(road[zones], f, 0.0)          # islands without roads are ferry trips, not a railway's job
                seed = zones[int(np.argmax(f))]
                near = np.hypot(b.zone_x[zones] - b.zone_x[seed], b.zone_y[zones] - b.zone_y[seed]) <= radius
                z, w = zones[near], f[near]
                order = np.argsort(w)[::-1]
                cum = np.cumsum(w[order]) / max(w.sum(), 1e-9)
                return z[order[: min(int(np.searchsorted(cum, share)) + 1, most)]]

            oz, dz = core(o_all, fo, 3500), core(d_all, fd, 2500)
            om = np.zeros(b.n_all, bool); om[oz] = True
            dm = np.zeros(b.n_all, bool); dm[dz] = True
            key = f"c-{a}-{c}"
            self.items[key] = {"id": key}
            self.focus[key] = (om, dm)
            tg = self.target(key, np.zeros_like(b.cost22))
            goal = max(4.0, round(0.12 * tg["before"]))
            w_o = P[np.ix_(oz, dz)].sum(axis=1)
            w_d = P[np.ix_(oz, dz)].sum(axis=0)
            ox, oy = np.average(b.zone_x[oz], weights=w_o + 1e-9), np.average(b.zone_y[oz], weights=w_o + 1e-9)
            dx, dy = np.average(b.zone_x[dz], weights=w_d + 1e-9), np.average(b.zone_y[dz], weights=w_d + 1e-9)
            km = float(np.hypot(dx - ox, dy - oy) / 1000)
            budget = _round_up(km * 1.3 * UNIT_FOR_BUDGET + 6 * self.params.value("G.cost_station"), 50)
            o_lab = "、".join(pl.zones[z]["label"] for z in oz[:3])
            d_lab = "、".join(pl.zones[z]["label"] for z in dz[:3])
            olon, olat = b.to_ll.transform(ox, oy)
            dlon, dlat = b.to_ll.transform(dx, dy)
            self.items[key] = {
                "id": key, "kind": "commute", "title": f"{names[a]} → {names[c]}：上班太远",
                "story": f"每个工作日早上 8–9 点，就有约 {tg['people']:,} 人从{o_lab}等地坐公交去{d_lab}等地，平均要 {tg['before']:.0f} 分钟。"
                         f"给你 {budget:.0f} 亿，让他们平均少 {goal:.0f} 分钟。",
                "budget_yi": budget,
                "metric": {"type": "time", "label": "这批人的平均通勤", "before": tg["before"], "goal": goal, "unit": "分钟"},
                "focus": {"origin": [pl.zones[z]["zone"] for z in oz], "dest": [pl.zones[z]["zone"] for z in dz],
                          "arrow": [[olat, olon], [dlat, dlon]], "people": tg["people"]},
                "view": [[min(olat, dlat) - 0.02, min(olon, dlon) - 0.02], [max(olat, dlat) + 0.02, max(olon, dlon) + 0.02]],
            }

    # ---------- template: growth (scenario) ----------
    def _growth(self) -> None:
        from .scenario import SCENARIOS
        b = self.base
        for skey, sc in SCENARIOS.items():
            key = f"s-{skey}"
            nm = np.zeros(b.n_all, bool)
            nm[: b.n] = b.landuse["district"].isin(sc["districts"]).to_numpy()
            self.items[key] = {"id": key, "scenario": skey}
            self.focus[key] = (nm, np.ones(b.n_all, bool))
            goal = 4.0
            self.items[key] = {
                "id": key, "kind": "growth", "scenario": skey, "title": sc["title"], "story": sc["story"],
                "budget_yi": float(sc["budget_yi"]),
                "metric": {"type": "time", "label": "北都居民的平均公交出行", "before": None, "goal": goal, "unit": "分钟"},
                "focus": {"origin": [self.places.zones[z]["zone"] for z in np.nonzero(nm[: b.n])[0]], "dest": [], "arrow": None},
                "view": [[22.40, 113.95], [22.56, 114.20]],
            }

    # ---------- which one is today's ----------
    def daily(self) -> str:
        keys = sorted(self.items)
        return keys[dt.date.today().toordinal() % len(keys)]

    def public(self, key: str) -> dict:
        m = dict(self.items[key])
        if m.get("gov"):
            g = dict(m["gov"])
            g["benchmark"] = self.benchmarks.get(key)
            m["gov"] = g
        if m["kind"] == "growth" and m["metric"]["before"] is None:
            from . import run as R
            if m["scenario"] in R._REF:
                m = {**m, "metric": {**m["metric"], "before": self.target(key, np.zeros_like(self.base.cost22))["before"]}}
        return m

    def listing(self) -> list[dict]:
        return [{"id": k, "kind": m["kind"], "title": m["title"], "budget_yi": m["budget_yi"]}
                for k, m in sorted(self.items.items(), key=lambda kv: (kv[1]["kind"], kv[0]))]


def score(missions: Missions, key: str, result: dict, saving: np.ndarray, flags: dict) -> dict:
    """Final score out of 100 once the full model has run (steps of docs/design/game-v2-missions.md)."""
    m = missions.items[key]
    L = result["ledger"]
    steps = []

    def add(name, pts, mx, note):
        steps.append({"name": name, "points": round(float(pts), 1), "max": mx, "note": note})

    add("看清问题", 5 if flags.get("looked") else 0, 5, "打开了热力图或问题区")
    grades = flags.get("grades") or []
    good = sum(g in ("A", "B") for g in grades) / max(len(grades), 1)
    add("好站位", 10 * min(1.0, good / 0.5), 10, f"{sum(g in ('A', 'B') for g in grades)}/{len(grades)} 个新站是 A/B 级")
    inter = any(s["interchange"] for s in result["stations"])
    add("接上港铁", 10 if inter else 0, 10, "有换乘站" if inter else "没有接上现有港铁")
    if m["metric"]["type"] == "time":
        tg = missions.target(key, saving)
        prog = tg["saved"] / m["metric"]["goal"]
        add("完成目标", 30 * min(1.0, max(prog, 0)), 30, f"平均 {tg['before']:.1f} → {tg['after']:.1f} 分钟（目标少 {m['metric']['goal']:.0f}）")
    else:
        bench0 = missions.benchmarks.get(key)
        goal = bench0["riders_day"] if bench0 else m["metric"]["goal"]
        prog = L["riders_day"] / max(goal, 1)
        add("完成目标", 30 * min(1.0, prog), 30, f"每天 {L['riders_day']:,} 人次（政府方案{'完整模型' if bench0 else '快算'} {goal:,}）")
    within = L["capex_yi"] <= m["budget_yi"]
    add("不超预算", 10 if within else 0, 10, f"造价 {L['capex_yi']:.0f} / 预算 {m['budget_yi']:.0f} 亿")
    dev = bool(result.get("built"))
    add("铁路+物业", 5 if dev else 0, 5, "站旁有开发" if dev else "没有站旁开发")
    bcr = L["bcr"] or 0
    add("账算得过来", 15 * float(np.clip((bcr - 0.1) / 0.9, 0, 1)), 15, f"效益/成本 {bcr:.2f}（每花 1 元换回 1 元满分）")
    bench = missions.benchmarks.get(key)
    if bench:
        beat_r = L["riders_day"] > bench["riders_day"]
        beat_n = L["npv_yi"] > bench["npv_yi"]
        add("打败政府方案", 15 if beat_r and beat_n else 8 if beat_r or beat_n else 0, 15,
            f"客流 {L['riders_day']:,} vs {bench['riders_day']:,}；净收益 {L['npv_yi']:.0f} vs {bench['npv_yi']:.0f} 亿")
        third = beat_r and beat_n
    else:
        km = sum(l["km"] for l in result["lines"]) or 1
        per_km = L["riders_day"] / km
        add("每公里客流", 15 * min(1.0, per_km / 12000), 15, f"每公里每天 {per_km:,.0f} 人次")
        third = bcr >= 1
    total = sum(s["points"] for s in steps)
    stars = int(prog >= 1) + int(within) + int(third)
    return {"total": round(total, 1), "stars": stars, "steps": steps, "progress": round(float(prog), 2),
            "benchmark": bench}


# ---------- government benchmarks: the full model on each announced line, cached on disk ----------
CACHE = Path(__file__).resolve().parents[1] / ".cache" / "benchmarks.json"


def signature() -> str:
    h = hashlib.sha1()
    h.update(Params().items.__repr__().encode("utf-8"))
    for f in sorted(Path(__file__).parent.glob("*.py")):
        h.update(f.read_bytes())
    h.update(PLANNED.read_bytes())
    return h.hexdigest()[:16]


def load_benchmarks(missions: Missions) -> None:
    if CACHE.exists():
        data = json.loads(CACHE.read_text(encoding="utf-8"))
        if data.get("signature") == signature():
            missions.benchmarks.update(data["items"])


def compute_benchmarks(missions: Missions, progress=None) -> None:
    from . import run as R
    sig = signature()
    for key, m in missions.items.items():
        if m["kind"] != "gov" or key in missions.benchmarks:
            continue
        res = R.run(m["gov"]["design"], None)
        if not res.get("ok"):
            continue
        L = res["ledger"]
        missions.benchmarks[key] = {"riders_day": L["riders_day"], "npv_yi": L["npv_yi"], "bcr": L["bcr"],
                                    "capex_yi": L["capex_yi"], "hours_saved_day": L["pt_hours_saved_day"] + L["car_hours_saved_day"],
                                    "cars_peak": L["cars_peak"], "co2_t_year": L["co2_t_year"]}
        CACHE.parent.mkdir(exist_ok=True)
        CACHE.write_text(json.dumps({"signature": sig, "items": missions.benchmarks}, ensure_ascii=False), encoding="utf-8")
        if progress:
            progress(key)


_M: Missions | None = None


def get_missions() -> Missions:
    global _M
    if _M is None:
        from .base import get_base
        from .places import get_places
        _M = Missions(get_base(), get_places())
        load_benchmarks(_M)
    return _M
