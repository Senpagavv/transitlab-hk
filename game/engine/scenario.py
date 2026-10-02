"""Scenario questions, and station-area development, as changes to the zones' trip ends.

New residents and jobs change where trips start and end; the change is made with the base's own trip
rates (pipeline/21 output divided by residents or jobs), so a new home makes trips like the homes around it.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .base import MODEL

HOME_BASED = ("HBW", "HBS", "HBO")
FURNESS = ("HBW", "HBS", "HBO", "NHB")   # doubly constrained in pipeline/22: attractions follow productions

# Station-area development packages (gross floor area, m2) - tier D, a typical MTR property package size
DEV = {
    "home": {"zh": "住宅为主", "residential_m2": 400_000, "office_m2": 0},
    "office": {"zh": "写字楼/商场为主", "residential_m2": 0, "office_m2": 250_000},
    "mixed": {"zh": "住宅+商业", "residential_m2": 250_000, "office_m2": 100_000},
}

SCENARIOS = {
    "north": {
        "title": "北都人口大增",
        "story": "2033 年，北部都会区（元朗、北区）新建屋苑陆续入伙，多住了 20 万人；但大部分工作岗位还在市区。"
                 "早上这些新居民怎么去上班？请在预算内修线，让他们通勤更快、少开车，账也要算得过来。",
        "districts": ["Yuen Long", "North"],
        "add_residents": 200_000,
        "budget_yi": 1500,
    },
}


class Rates:
    """Trip rates per resident and per job, from the base trip ends (zone's own where it has enough people)."""

    def __init__(self, base) -> None:
        e = base.ends.iloc[: base.n]
        self.pop = e["population"].to_numpy(float)
        self.jobs = e["jobs"].to_numpy(float)
        self.e = e
        land = base.landuse
        self.res_m2_per_person = float(land["gfa_residential"].sum() / land["population"].sum())
        floor_jobs = land[["gfa_office", "gfa_retail", "gfa_hotel", "gfa_industrial"]].sum(axis=1)
        self.m2_per_job = float(floor_jobs.sum() / self.jobs.sum())

    def per_resident(self, col: str, z: int) -> float:
        if self.pop[z] >= 2000:
            return float(self.e[col].iloc[z] / self.pop[z])
        return float(self.e[col].sum() / self.pop.sum())

    def per_job(self, col: str, z: int) -> float:
        if self.jobs[z] >= 2000:
            return float(self.e[col].iloc[z] / self.jobs[z])
        return float(self.e[col].sum() / self.jobs.sum())


def add_people(ends: pd.DataFrame, rates: Rates, z: int, residents: float, jobs: float) -> None:
    """Add residents and jobs to inner zone z (in place)."""
    row = ends.index[z]
    for p in HOME_BASED:
        ends.at[row, f"P_{p}"] += residents * rates.per_resident(f"P_{p}", z)
    ends.at[row, "A_HBW"] += jobs * rates.per_job("A_HBW", z)
    for col in ("A_HBO", "P_NHB", "A_NHB"):
        ends.at[row, col] += jobs * rates.per_job(col, z)
    ends.at[row, "population"] += residents
    ends.at[row, "jobs"] += jobs


def balance(ends: pd.DataFrame, ref: pd.DataFrame) -> None:
    """Attractions follow productions: total attractions change by as much as total productions did."""
    for p in FURNESS:
        a = ends[f"A_{p}"].sum()
        if a > 0:
            ends[f"A_{p}"] *= (ref[f"A_{p}"].sum() + ends[f"P_{p}"].sum() - ref[f"P_{p}"].sum()) / a


def scenario_ends(base, key: str | None, rates: Rates) -> tuple[pd.DataFrame, dict]:
    ends = base.ends.copy()
    info = {"zones": []}
    if not key:
        return ends, info
    sc = SCENARIOS[key]
    land = base.landuse
    zoning = pd.read_parquet(MODEL / "zoning-capacity.parquet").set_index("zone").reindex(base.inner)
    inside = land["district"].isin(sc["districts"]).to_numpy()
    spare = np.clip(zoning["domestic_cap_m2"].fillna(0).to_numpy() - land["gfa_residential"].fillna(0).to_numpy(), 0, None)
    spare = np.where(inside, spare, 0.0)
    share = spare / spare.sum()
    for z in np.nonzero(share > 0)[0]:
        add_people(ends, rates, int(z), sc["add_residents"] * share[z], 0.0)
        info["zones"].append({"zone": base.inner[z], "residents": round(sc["add_residents"] * share[z])})
    balance(ends, base.ends)
    info["nm_mask"] = inside
    return ends, info


def developments(base, ends: pd.DataFrame, net, rates: Rates) -> list[dict]:
    """Apply the station-area packages chosen on the new stations; returns what was built where."""
    built, ref = [], ends.copy()
    for s, st in enumerate(net.stations):
        dev = DEV.get(st.get("dev") or "")
        if not dev:
            continue
        z = st["zone"]
        residents = dev["residential_m2"] / rates.res_m2_per_person
        jobs = dev["office_m2"] / rates.m2_per_job
        add_people(ends, rates, z, residents, jobs)
        built.append({"station": s, "zone": z, "kind": st["dev"], "residents": residents, "jobs": jobs,
                      "residential_m2": dev["residential_m2"], "office_m2": dev["office_m2"]})
    if built:
        balance(ends, ref)
    return built
