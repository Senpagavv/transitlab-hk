"""The player's new lines: geometry, construction type and cost, running times, and new door-to-door times.

Design (from the browser):
    {"lines": [{"id": "L1", "name": "...", "headway_min": 3, "train_capacity": 2000,
                "points": [{"lon": .., "lat": .., "kind": "station" | "bend"}, ...],
                "segment_types": [null | "tunnel" | "viaduct" | "surface", ...]}],   # one per point pair
     "developments": [{"station": "L1:2", "residential_m2": .., "office_m2": .., "retail_m2": ..}]}
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .params import (DEFAULT_HEADWAY_MIN, SHARED_STATION_M, STATION_SNAP_M, TRAIN, TRANSFER_WALK_MIN, WALK,
                     Params)

TYPES = {"tunnel": ("隧道", "G.cost_tunnel_km"), "viaduct": ("高架", "G.cost_viaduct_km"), "surface": ("地面", "G.cost_atgrade_km")}


def suggest_type(profile: dict) -> str:
    """Sea or hills -> tunnel; built-up city -> underground; open land -> viaduct."""
    if profile["water"] > 0.05 or profile["hill"] > 0.35 or profile["urban"] > 0.5:
        return "tunnel"
    return "viaduct"


def run_minutes(metres: float) -> float:
    """Station-to-station running time: accelerate, cruise, brake (no dwell)."""
    v = TRAIN["v_max_kmh"] / 3.6
    a = TRAIN["accel_ms2"]
    d_acc = v * v / a                     # accelerating plus braking distance
    if metres >= d_acc:
        return (metres / v + v / a) / 60
    return 2 * np.sqrt(metres / a) / 60


@dataclass
class Network:
    stations: list = field(default_factory=list)   # physical stations: dict(x, y, lon, lat, zone, existing, name, lines)
    nodes: list = field(default_factory=list)      # (line index, physical station index)
    segments: list = field(default_factory=list)   # drawn segments between consecutive points (cost)
    links: list = field(default_factory=list)      # in-vehicle links between consecutive stations (both directions)
    lines: list = field(default_factory=list)
    problems: list = field(default_factory=list)


def build(design: dict, base, params: Params) -> Network:
    net = Network()

    def station_index(x: float, y: float, lon: float, lat: float) -> int:
        for k, s in enumerate(net.stations):
            if np.hypot(s["x"] - x, s["y"] - y) < SHARED_STATION_M:
                return k
        d = np.hypot(base.stations["x"] - x, base.stations["y"] - y)
        near = int(np.argmin(d))
        existing = None
        if d[near] < STATION_SNAP_M:
            row = base.stations.iloc[near]
            existing = {"id": row["id"], "name": row["name_en"], "lines": row["lines"]}
            x, y, lon, lat = row["x"], row["y"], row["lon"], row["lat"]
        net.stations.append({"x": x, "y": y, "lon": lon, "lat": lat, "zone": base.zone_at(x, y),
                             "existing": existing, "lines": []})
        return len(net.stations) - 1

    for li, line in enumerate(design.get("lines", [])):
        pts = line.get("points", [])
        headway = float(line.get("headway_min") or DEFAULT_HEADWAY_MIN)
        cap_train = float(line.get("train_capacity") or params.value("G.train_capacity"))
        info = {"id": line.get("id", f"L{li + 1}"), "name": line.get("name", f"线路 {li + 1}"), "headway": headway,
                "capacity": 60 / headway * cap_train, "train_capacity": cap_train, "stations": [], "length_m": 0.0}
        xy = [base.to_grid.transform(p["lon"], p["lat"]) for p in pts]
        kinds = [p.get("kind", "station") for p in pts]
        if kinds and kinds[0] != "station":
            kinds[0] = "station"
        if kinds and kinds[-1] != "station":
            kinds[-1] = "station"
        overrides = list(line.get("segment_types") or [])
        station_seq, since_last = [], 0.0
        for k, ((x, y), kind) in enumerate(zip(xy, kinds)):
            if k > 0:
                x0, y0 = xy[k - 1]
                length = float(np.hypot(x - x0, y - y0))
                prof = base.land_profile(x0, y0, x, y)
                t = overrides[k - 1] if k - 1 < len(overrides) and overrides[k - 1] in TYPES else suggest_type(prof)
                net.segments.append({"line": li, "index": k - 1, "length_m": length, "type": t,
                                     "suggested": suggest_type(prof), "profile": prof})
                info["length_m"] += length
                since_last += length
            if kind == "station":
                s = station_index(x, y, pts[k]["lon"], pts[k]["lat"])
                if pts[k].get("dev"):
                    net.stations[s]["dev"] = pts[k]["dev"]
                if pts[k].get("name"):
                    net.stations[s]["name"] = pts[k]["name"]
                if station_seq and station_seq[-1][0] == s:
                    continue
                if station_seq:
                    net.links.append({"line": li, "from": station_seq[-1][1], "to": len(net.nodes),
                                      "length_m": since_last, "minutes": run_minutes(since_last) + TRAIN["dwell_min"]})
                net.nodes.append((li, s))
                net.stations[s]["lines"].append(li)
                station_seq.append((s, len(net.nodes) - 1))
                since_last = 0.0
        info["stations"] = [s for s, _ in station_seq]
        if len(station_seq) < 2:
            net.problems.append(f"{info['name']}：至少要两个车站")
        net.lines.append(info)
    return net


def cost(net: Network, params: Params) -> dict:
    """Capital cost (HK$ 100 million) by construction type plus stations."""
    by_type = {t: 0.0 for t in TYPES}
    km = {t: 0.0 for t in TYPES}
    for seg in net.segments:
        unit = params.value(TYPES[seg["type"]][1])
        by_type[seg["type"]] += seg["length_m"] / 1000 * unit
        km[seg["type"]] += seg["length_m"] / 1000
    stations = len(net.stations) * params.value("G.cost_station")
    tiers = [params.tier(TYPES[t][1]) for t in TYPES] + [params.tier("G.cost_station")]
    return {"by_type": by_type, "km": km, "stations": stations, "total": sum(by_type.values()) + stations,
            "tier": max(tiers, key="ABCD".index)}


class Paths:
    """New door-to-door transit times through the new lines (min-plus composition with the base times)."""

    def __init__(self, net: Network, base, params: Params) -> None:
        self.net, self.base = net, base
        n_all = base.n_all
        S, N = len(net.stations), len(net.nodes)
        self.S, self.N = S, N
        host = base.host
        transfer_pen = params.value("P.transfer_penalty_min")
        walk_speed = WALK["speed_kmh"] * 1000 / 60      # m/min

        # access/egress between every zone (control points via their host zone) and every new station:
        #  - walk straight there if it is close (<= 1.2 km after detour), or
        #  - the base door-to-door time to the station's zone, then the walk to the platform. At a station
        #    on the existing network the base time already ends with the walk from that station to the
        #    zone centre, so it is taken off again and only the interchange walk is added.
        zx, zy = base.zone_x[host], base.zone_y[host]
        external = np.arange(n_all) >= base.n
        A = np.full((n_all, S), np.inf)
        E = np.full((S, n_all), np.inf)
        for s, st in enumerate(net.stations):
            dist = np.hypot(zx - st["x"], zy - st["y"]) * WALK["detour"]
            walk = np.where((dist <= WALK["max_m"]) & ~external, dist / walk_speed, np.inf)
            z = st["zone"]
            w_zs = min(np.hypot(base.zone_x[z] - st["x"], base.zone_y[z] - st["y"]) * WALK["detour"] / walk_speed, 20.0)
            # control points keep their own time to the host zone (base.cost22 rows/columns, not the host's)
            to_z, from_z = base.cost22[:, z].copy(), base.cost22[z, :].copy()
            own = (np.arange(n_all) == z)
            to_z[own] = from_z[own] = 0.0
            if st["existing"]:
                via_in = np.maximum(to_z - w_zs, 0) + TRANSFER_WALK_MIN
                via_out = np.maximum(from_z - w_zs, 0) + TRANSFER_WALK_MIN
                via_in[own] = via_out[own] = w_zs
            else:
                via_in, via_out = to_z + w_zs, from_z + w_zs
            A[:, s] = np.minimum(walk, via_in)
            E[s, :] = np.minimum(walk, via_out)
        self.A_phys, self.E_phys = A, E
        self.walk_speed = walk_speed
        self.transfer_pen = transfer_pen
        self.node_line = np.array([li for li, _ in net.nodes], int)
        self.node_phys = np.array([s for _, s in net.nodes], int)
        self.wait = np.array([net.lines[li]["headway"] / 2 for li in self.node_line])
        self.base_ride = np.repeat([lk["minutes"] for lk in net.links], 2).astype(float)
        self.capacity = np.repeat([net.lines[lk["line"]]["capacity"] for lk in net.links], 2).astype(float)

    def station_times(self, ride: np.ndarray):
        """All-pairs times between line-nodes (riding + transfers, no first wait); paths for loading.

        ride: minutes on each directed link, link k forwards at 2k and backwards at 2k + 1.
        """
        from scipy.sparse import csr_matrix
        from scipy.sparse.csgraph import shortest_path
        N = self.N
        rows, cols, w, kind = [], [], [], []
        for k, lk in enumerate(self.net.links):
            for d, (a, b) in enumerate(((lk["from"], lk["to"]), (lk["to"], lk["from"]))):
                rows.append(a); cols.append(b); w.append(ride[2 * k + d]); kind.append(2 * k + d)
        for a in range(N):
            for b in range(N):
                if a != b and self.node_phys[a] == self.node_phys[b]:
                    rows.append(a); cols.append(b); w.append(TRANSFER_WALK_MIN + self.transfer_pen + self.wait[b]); kind.append(-1)
        self.edges = list(zip(rows, cols, kind))
        g = csr_matrix((np.maximum(w, 1e-4), (rows, cols)), shape=(N, N)) if rows else csr_matrix((N, N))
        D, pred = shortest_path(g, directed=True, return_predecessors=True)
        same = self.node_phys[:, None] == self.node_phys[None, :]
        D[same] = np.inf                      # must ride: no "walk through a station" paths
        self.pred = pred
        self.edge_index = {(a, b): i for i, (a, b, _) in enumerate(self.edges)}
        return D

    def via(self, D: np.ndarray, block: int = 40):
        """T_via[i, j] = min over boarding node n, alighting node m of A[i,n] + wait + D[n,m] + E[m,j]."""
        A = self.A_phys[:, self.node_phys] + self.wait[None, :]       # n_all x N
        E = self.E_phys[self.node_phys, :]                              # N x n_all
        n_all = A.shape[0]
        M1 = np.full((n_all, self.N), np.inf)
        board = np.zeros((n_all, self.N), int)
        for m in range(self.N):
            tot = A + D[:, m][None, :]
            board[:, m] = np.argmin(tot, axis=1)
            M1[:, m] = tot[np.arange(n_all), board[:, m]]
        T = np.full((n_all, n_all), np.inf)
        alight = np.zeros((n_all, n_all), int)
        for i0 in range(0, n_all, block):
            tot = M1[i0:i0 + block, :, None] + E[None, :, :]
            alight[i0:i0 + block] = np.argmin(tot, axis=1)
            T[i0:i0 + block] = np.take_along_axis(tot, alight[i0:i0 + block][:, None, :], axis=1)[:, 0, :]
        n_star = np.take_along_axis(board, alight, axis=1)
        return T, n_star, alight

    def path_links(self, n: int, m: int) -> list[int]:
        """Edge indices (into self.edges) on the stored shortest path from node n to node m."""
        out, cur, guard = [], m, 0
        while cur != n and cur >= 0 and guard < 10_000:
            p = self.pred[n, cur]
            if p < 0:
                return []
            out.append(self.edge_index[(p, cur)])
            cur, guard = p, guard + 1
        return out[::-1]
