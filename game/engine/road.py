"""Cars that change because of the design, put back on the real road network.

Incremental assignment: the base morning-peak volumes (pipeline/27, an equilibrium) stay as they are, and
only the CHANGE in car, taxi and coach trips is loaded on the current fastest routes; times follow the
same BPR curves (pipeline/15e), and a few rounds of averaging keep it stable. With no change in trips the
volumes, times and car skim are exactly the base.
"""
from __future__ import annotations

import numpy as np
from scipy.sparse.csgraph import dijkstra

EPS = 0.01   # vehicles per hour below which a zone pair is not loaded


def to_inner(base, m: np.ndarray) -> np.ndarray:
    """470 x 470 -> 455 x 455, control points added to their host zone."""
    out = np.zeros((base.n, base.n))
    np.add.at(out, (base.host[:, None], base.host[None, :]), m)
    return out


def aon(base, road_time: np.ndarray, trips: np.ndarray) -> np.ndarray:
    """All-or-nothing load of `trips` (455 x 455, may be negative) on the fastest routes at `road_time`."""
    r = base.road
    g, edge_of = base.graph(road_time)
    keys = np.fromiter((s * r["n_nodes"] + d for s, d in edge_of), np.int64, len(edge_of))
    eids = np.fromiter(edge_of.values(), np.int64, len(edge_of))
    order = np.argsort(keys)
    keys, eids = keys[order], eids[order]
    rows = np.nonzero(np.abs(trips).sum(axis=1) > EPS)[0]
    load = np.zeros(len(r["src"]))
    if not len(rows):
        return load[: r["n_road"]]
    _, pred = dijkstra(g, directed=True, indices=r["origin"][rows], return_predecessors=True)
    oi, dj = np.nonzero(np.abs(trips[rows]) > EPS)
    w = trips[rows][oi, dj]
    cur = r["dest"][dj].astype(np.int64)
    target = r["origin"][rows][oi]
    reach = pred[oi, cur] >= 0
    oi, cur, w, target = oi[reach], cur[reach], w[reach], target[reach]
    while len(cur):
        p = pred[oi, cur].astype(np.int64)
        k = np.searchsorted(keys, p * r["n_nodes"] + cur)
        load += np.bincount(eids[k], weights=w, minlength=len(load))
        cur = p
        go = cur != target
        oi, cur, w, target = oi[go], cur[go], w[go], target[go]
    return load[: r["n_road"]]


def assign(base, d_vehicles: np.ndarray, start: np.ndarray | None = None, iterations: int = 3) -> dict:
    """Base volumes plus the change in vehicles (470 x 470 per hour), averaged over a few rounds."""
    r = base.road
    trips = to_inner(base, d_vehicles)
    extra = np.zeros(r["n_road"]) if start is None else start.copy()
    if np.abs(trips).sum() < EPS:
        return {"extra": extra * 0, "vol": r["vol"].copy(), "time": r["time0"].copy(), "skim": base.car_skim0.copy()}
    for k in range(1, iterations + 1):
        vol = np.maximum(r["vol"] + extra, 0)
        aux = aon(base, base.bpr(vol), trips)
        extra = extra + (aux - extra) / k
    vol = np.maximum(r["vol"] + extra, 0)
    time = base.bpr(vol)
    return {"extra": extra, "vol": vol, "time": time, "skim": base.car_skim(time)}


@np.errstate(invalid="ignore")
def delay_from(base, skim: np.ndarray) -> np.ndarray:
    """pipeline/23's car delay with the change in the congested car skim added (control points via hosts)."""
    d = np.where(np.isfinite(skim) & np.isfinite(base.car_skim0), skim - base.car_skim0, 0.0)
    d470 = d[np.ix_(base.host, base.host)]
    np.fill_diagonal(d470, 0.0)
    return np.where(np.isfinite(base.delay23), np.maximum(base.delay23 + d470, 0.0), base.delay23)
