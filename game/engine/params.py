"""Engine parameters, read from the confidence registry (model/registry/data_tiers.toml).

Every number the engine uses that is not computed from the base data comes from the registry, with its
confidence tier, so results can carry the tier of their weakest input. Parameters still being researched
(status to_research) have a `provisional` demo value and are treated as tier D.
"""
from __future__ import annotations

import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "model" / "registry" / "data_tiers.toml"
TIER_ORDER = "ABCD"


class Params:
    def __init__(self) -> None:
        items = tomllib.loads(REGISTRY.read_text(encoding="utf-8"))["item"]
        self.items = {i["id"]: i for i in items}

    def num(self, pid: str) -> tuple[float, str]:
        """(value, tier) for a numeric parameter; provisional demo values count as tier D."""
        item = self.items[pid]
        value = item.get("value")
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return float(value), item["tier"]
        if "provisional" in item:
            return float(item["provisional"]), "D"
        raise KeyError(f"{pid} has no numeric value in the registry")

    def value(self, pid: str) -> float:
        return self.num(pid)[0]

    def tier(self, pid: str) -> str:
        return self.num(pid)[1]


def weakest(*tiers: str) -> str:
    """A result is only as trustworthy as its weakest input."""
    return max(tiers, key=TIER_ORDER.index) if tiers else "A"


# Engine settings that are modelling choices rather than data (documented here, tier in brackets).
_kin = Params().items["G.train_kinematics"]["value"]                # G.train_kinematics (C, task 44)
TRAIN = {"v_max_kmh": float(_kin["v_max_kmh"]), "accel_ms2": float(_kin["accel_ms2"]), "dwell_min": float(_kin["dwell_s"]) / 60}
CARS_PER_TRAIN = 8          # MTR urban lines run 8-car trains (East Rail 9): turns cost per car-km into per train-km
WALK = {"catchment_m": 800.0, "speed_kmh": 4.5, "detour": 1.25, "max_m": 1200.0}   # G.walk_catchment (D)
DEFAULT_HEADWAY_MIN = 3.0
STATION_SNAP_M = 150.0      # a new station this close to an existing one is the same station (interchange)
SHARED_STATION_M = 100.0    # two new stations this close are one interchange between new lines
TRANSFER_WALK_MIN = 2.0     # walk inside an interchange, on top of the transfer penalty
ANNUAL_DAYS = 300           # weekday-equivalent days a year (same as the prototype)
CONSTRUCTION_YEARS = 5
