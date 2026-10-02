"""Who rides the new lines in the morning peak, and how crowded they get.

For every pair of zones the new lines offer one more way to travel (board at the best station, ride,
transfer if needed, alight at the best station). Travellers split between the old way and the new way
by how many minutes the new way saves (a smooth logit, not all-or-nothing), the riders are loaded on
the new lines, crowded sections feel slower, and this is repeated with averaging (method of successive
averages) until loads settle.
"""
from __future__ import annotations

import numpy as np

from .network import Paths

CUTOFF_MIN = 10.0   # a new way more than 10 minutes slower than the old way gets nobody


def crowding(load_factor: np.ndarray) -> np.ndarray:
    """P.crowding_factor: perceived in-vehicle time multiplier by load / capacity."""
    lf = np.asarray(load_factor, float)
    return np.where(lf <= 0.8, 1.0, np.where(lf <= 1.2, 1 + 1.5 * (lf - 0.8), 1.6 + 4 * (lf - 1.2)))


def shares(T_new: np.ndarray, T_old: np.ndarray, per_min: float) -> np.ndarray:
    gap = np.where(np.isfinite(T_new), T_new - np.where(np.isfinite(T_old), T_old, 1e3), np.inf)
    s = np.where(gap < CUTOFF_MIN, 1 / (1 + np.exp(np.clip(per_min * gap, -50, 50))), 0.0)
    np.fill_diagonal(s, 0.0)
    return s


def load(paths: Paths, flow: np.ndarray, n_star: np.ndarray, m_star: np.ndarray) -> dict:
    """Put the riders of every zone pair on their path between boarding node n* and alighting node m*."""
    N = paths.N
    F = np.bincount((n_star * N + m_star).ravel(), weights=flow.ravel(), minlength=N * N).reshape(N, N)
    vol = np.zeros(len(paths.base_ride))
    boards = np.zeros(N)     # boardings at each line-node (first boarding plus transfers onto it)
    alights = np.zeros(N)
    transfers = 0.0
    for n, m in zip(*np.nonzero(F > 1e-9)):
        f = F[n, m]
        boards[n] += f
        alights[m] += f
        for e in paths.path_links(n, m):
            a, b, kind = paths.edges[e]
            if kind >= 0:
                vol[kind] += f
            else:
                boards[b] += f
                alights[a] += f
                transfers += f
    return {"vol": vol, "boards": boards, "alights": alights, "transfers": transfers, "trips": float(F.sum())}


def assign(paths: Paths, pt_peak: np.ndarray, T_old: np.ndarray, per_min: float, iterations: int = 6,
           start_vol: np.ndarray | None = None) -> dict:
    """Morning-peak loading of the new lines with crowding, by successive averages."""
    vol = np.zeros_like(paths.base_ride) if start_vol is None else start_vol.copy()
    gaps = []
    for k in range(1, iterations + 1):
        ride = paths.base_ride * crowding(vol / paths.capacity)
        D = paths.station_times(ride)
        T, n_star, m_star = paths.via(D)
        s = shares(T, T_old, per_min)
        res = load(paths, pt_peak * s, n_star, m_star)
        gaps.append(float(np.abs(res["vol"] - vol).sum() / max(res["vol"].sum(), 1.0)))
        vol = vol + (res["vol"] - vol) / k
    ride = paths.base_ride * crowding(vol / paths.capacity)
    D = paths.station_times(ride)
    T, n_star, m_star = paths.via(D)
    s = shares(T, T_old, per_min)
    res = load(paths, pt_peak * s, n_star, m_star)
    res.update({"vol": vol, "ride": ride, "T": T, "share": s, "gaps": gaps,
                "load_factor": vol / paths.capacity})
    return res
