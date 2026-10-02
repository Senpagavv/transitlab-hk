"""Everything the game engine needs from the calibrated base model, loaded once.

The engine never re-fits anything: it re-runs the base model's own steps (pipeline/22 distribution,
pipeline/23 mode choice, pipeline/24 peak hour) with their calibrated parameters, once for the base and
once for the player's design, and adds the DIFFERENCE to the base files. With no design the difference is
exactly zero, so the game always starts from the validated 2026 base.
"""
from __future__ import annotations

import importlib.util
import json
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
MODEL, WEB, RAW = ROOT / "data" / "model", ROOT / "data" / "web", ROOT / "data" / "raw"
CONNECTOR_KPH = 25.0          # pipeline/17 and 27
WATER_CODES = (0, 91)         # sea, reservoir (pipeline/36 land-use grid)
HILL_CODES = (71, 72, 73, 74)  # woodland, shrubland, grassland, badland: hills - a line through them is in tunnel
URBAN_CODES = (1, 2, 3, 11, 21, 22, 23, 31, 32, 41, 42, 43, 44, 51, 52, 53, 54)  # built-up: a city line is underground
RAIL_LINES = ["EAL", "TWL", "KTL", "ISL", "TKL", "TML", "TCL", "SIL", "AEL", "DRL"]


def _pipeline(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "pipeline" / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Base:
    def __init__(self) -> None:
        self.td = _pipeline("game_p22", "22_trip_distribution.py")
        self.mc = _pipeline("game_p23", "23_mode_choice.py")
        self.pk = _pipeline("game_p24", "24_peak_hour.py")
        self._demand()
        self._peak()
        self._road()
        self._zones()
        self._stations()
        self._land()

    # ---------- demand: distribution (22) and mode choice (23) ----------
    def _demand(self) -> None:
        dist = json.loads((WEB / "trip-distribution-audit.json").read_text(encoding="utf-8"))
        self.dist_model = m = self.td.Model()
        m.area_k.update(dist["area_factors"])
        m.update_area()
        self.beta = {p: dist["purposes"][p]["beta"] for p in self.td.PURPOSES}
        self.harbour = dist["harbour_factor_k"]
        self.ids = list(m.ids)                       # 470: 455 zones + 15 control points
        self.n_all = len(self.ids)
        self.inner = [z for z in self.ids if not z.startswith("X:")]
        self.n = len(self.inner)                     # 455
        self.host = np.arange(self.n_all)            # control point -> index of its host zone
        ends = m.ends
        for k, z in enumerate(self.ids):
            if z.startswith("X:"):
                self.host[k] = self.ids.index(ends.at[z, "host_zone"])
        self.cost22 = m.cost.copy()                  # 470 x 470 base transit minutes (pipeline/22's own)
        self.ends = ends.copy()
        self.trips_file = dict(np.load(MODEL / "trip-distribution-2026.npz"))
        self.mode_file = dict(np.load(MODEL / "mode-split-2026.npz"))

        mc = json.loads((WEB / "mode-choice-audit.json").read_text(encoding="utf-8"))
        self.choice = self.mc.Choice([])
        self.choice.taxi_weight = mc["taxi_fare_weight"]
        self.theta = mc["sensitivity_per_min"]
        self.constants = mc["constants"]
        self.pt23 = self.choice.pt_min.copy()        # 470 x 470 base transit minutes (pipeline/23's own)
        self.delay23 = self.choice.car_delay.copy()
        self.vot = mc["values_of_time_hkd_per_min"]
        self.purposes = list(self.td.PURPOSES)       # HBW HBS HBO NHB
        self.crossing = dict(self.mc.CROSSING)        # CBS -> HBS ...
        self.modes = list(self.mc.MODES)             # PV TAXI PT SPB

        # Base run of both models with the base inputs: the reference the design is compared with.
        self.dist0 = self.distribute(self.cost22, self.ends)
        self.split0 = self.split(self.trips_file, self.pt23, self.delay23)

    def distribute(self, cost: np.ndarray, ends: pd.DataFrame) -> dict[str, np.ndarray]:
        """pipeline/22 with its calibrated decay, harbour and area factors (no re-fitting)."""
        m = self.dist_model
        m.cost = cost
        m.reachable = np.isfinite(cost)
        m.finite_cost = np.where(m.reachable, cost, 0.0)
        out = {}
        for p in self.purposes:
            out[p], _ = self.td.furness(ends[f"P_{p}"].to_numpy(float), ends[f"A_{p}"].to_numpy(float),
                                        m.seed(self.beta[p], self.harbour))
        seed = m.seed(self.beta["HBO"], self.harbour)
        for p in self.td.CROSSING:
            out[p] = self.td.singly(ends[f"P_{p}"].to_numpy(float), ends[f"A_{p}"].to_numpy(float), seed)
        return out

    def split(self, trips: dict, pt: np.ndarray, delay: np.ndarray) -> dict[str, np.ndarray]:
        """pipeline/23 with its calibrated constants and sensitivity; returns T_<purpose>_<mode> daily."""
        c = self.choice
        c.trips = {p: np.asarray(trips[f"T_{p}"] if f"T_{p}" in trips else trips[p], float)
                   for p in self.purposes + list(self.crossing)}
        c.pt_min, c.car_delay = pt, delay
        out = {}
        for p in self.purposes:
            s = c.split(p, self.constants[p], self.theta)
            for mode in self.modes:
                out[f"T_{p}_{mode}"] = s[mode]
        for p, like in self.crossing.items():
            prob = c.probabilities(c.costs(like, "nopv"), self.constants[like], self.theta, "nopv")
            for mode in self.modes:
                out[f"T_{p}_{mode}"] = c.trips[p] * prob[mode]
        return out

    # ---------- daily -> 08:00-09:00 (24), with the base's census scale factors held fixed ----------
    def _peak(self) -> None:
        pk = self.pk
        params = json.loads((MODEL / "parameters-tcs2022.json").read_text(encoding="utf-8"))
        self.fraction, self.from_home = pk.peak_fractions(params)
        self.per_vehicle, _ = pk.census_occupancy()
        per_vehicle_day, _ = pk.census_occupancy("16 hours")
        counted = pk.census_peak_share()
        people = self._people(self.mode_file)
        self.scale, moved = {}, 0.0
        for mode in pk.PEAK_FROM_CENSUS:
            day = sum(self.mode_file[f"T_{p}_{mode}"].sum() for p in self.purposes + list(self.crossing)) / per_vehicle_day[mode]
            share = (people[mode] / self.per_vehicle[mode]).sum() / day
            self.scale[mode] = counted[mode] / share
            moved += people[mode].sum() * (1 - self.scale[mode])
        self.scale["PT"] = 1 + moved / people["PT"].sum()
        daily_pt = sum(self.mode_file[f"T_{p}_PT"].sum() for p in self.purposes + list(self.crossing))
        self.pt_daily_factor = daily_pt / (people["PT"].sum() * self.scale["PT"])
        car_day = sum(self.mode_file[f"T_{p}_{m}"].sum() for p in self.purposes + list(self.crossing) for m in ("PV", "TAXI"))
        self.car_daily_factor = car_day / sum(people[m].sum() * self.scale[m] for m in ("PV", "TAXI"))
        self.peak0 = self.peak(self.mode_file)

    def _people(self, daily: dict) -> dict[str, np.ndarray]:
        people = {m: np.zeros((self.n_all, self.n_all)) for m in self.modes}
        for p in self.purposes + list(self.crossing):
            f, d = self.fraction[p], self.from_home[p]
            for mode in self.modes:
                t = np.asarray(daily[f"T_{p}_{mode}"], float)
                people[mode] += f * (d * t + (1 - d) * t.T)
        return people

    def peak(self, daily: dict) -> dict[str, np.ndarray]:
        people = self._people(daily)
        out = {}
        for mode in self.modes:
            out[f"P_{mode}"] = people[mode] * self.scale.get(mode, 1.0)
        for mode in ("PV", "TAXI", "SPB"):
            out[f"V_{mode}"] = out[f"P_{mode}"] / self.per_vehicle[mode]
        return out

    # ---------- road network with the AM-peak assignment (27) ----------
    def _road(self) -> None:
        links = pd.read_parquet(MODEL / "road-links.parquet").set_index("link_id")
        a = pd.read_parquet(MODEL / "assignment-am-2026.parquet")
        a = a[a["road_link"] > 0].reset_index(drop=True)
        ends = links.loc[a["road_link"], ["a_node", "b_node"]].to_numpy()
        fwd = (a["side"] == "ab").to_numpy()
        n_nodes = int(links[["a_node", "b_node"]].to_numpy().max()) + 1
        zone_idx = {z: k for k, z in enumerate(self.inner)}
        con = pd.read_parquet(MODEL / "road-connectors.parquet")
        con = con[con["zone"].isin(zone_idx)]
        origin = n_nodes + np.arange(self.n)
        dest = n_nodes + self.n + np.arange(self.n)
        c_min = (con["metres"] / 1000 / CONNECTOR_KPH * 60).clip(lower=1e-3).to_numpy()
        zi = con["zone"].map(zone_idx).to_numpy()
        self.road = {
            "n_nodes": n_nodes + 2 * self.n, "n_road": len(a), "origin": origin, "dest": dest,
            "src": np.concatenate([np.where(fwd, ends[:, 0], ends[:, 1]), origin[zi], con["node_id"].to_numpy()]).astype(np.int64),
            "dst": np.concatenate([np.where(fwd, ends[:, 1], ends[:, 0]), con["node_id"].to_numpy(), dest[zi]]).astype(np.int64),
            "t0": a["free_time"].to_numpy(float), "cap": a["capacity"].to_numpy(float),
            "vol": a["total"].to_numpy(float), "alpha": a["alpha"].to_numpy(float), "beta": a["beta"].to_numpy(float),
            "km": a["distance"].to_numpy(float), "conn_min": np.concatenate([c_min, c_min]),
        }
        r = self.road
        r["time0"] = self.bpr(r["vol"])
        self.car_skim0 = self.car_skim(r["time0"])

    def bpr(self, vol: np.ndarray) -> np.ndarray:
        r = self.road
        return r["t0"] * (1 + r["alpha"] * (np.maximum(vol, 0) / r["cap"]) ** r["beta"])

    def weights(self, road_time: np.ndarray) -> np.ndarray:
        return np.concatenate([np.maximum(road_time, 1e-3), self.road["conn_min"]])

    def graph(self, road_time: np.ndarray):
        from scipy.sparse import csr_matrix
        r = self.road
        w = self.weights(road_time)
        # parallel links between the same pair of nodes: keep the fastest (a sparse matrix would add them)
        frame = pd.DataFrame({"s": r["src"], "d": r["dst"], "w": w, "e": np.arange(len(w))})
        best = frame.loc[frame.groupby(["s", "d"])["w"].idxmin()]
        g = csr_matrix((best["w"].to_numpy(), (best["s"].to_numpy(), best["d"].to_numpy())), shape=(r["n_nodes"], r["n_nodes"]))
        edge_of = {(s, d): e for s, d, e in zip(best["s"], best["d"], best["e"])}
        return g, edge_of

    def car_skim(self, road_time: np.ndarray) -> np.ndarray:
        from scipy.sparse.csgraph import dijkstra
        g, _ = self.graph(road_time)
        r = self.road
        t = dijkstra(g, directed=True, indices=r["origin"])[:, r["dest"]]
        np.fill_diagonal(t, 0)
        return t

    # ---------- zones: centres, outlines, attributes ----------
    def _zones(self) -> None:
        from pyproj import Transformer
        centres = pd.read_parquet(MODEL / "zone-centres.parquet").set_index("zone").reindex(self.inner)
        self.zone_x, self.zone_y = centres["x"].to_numpy(float), centres["y"].to_numpy(float)
        self.zone_lon, self.zone_lat = centres["lon"].to_numpy(float), centres["lat"].to_numpy(float)
        self.to_grid = Transformer.from_crs("EPSG:4326", "EPSG:2326", always_xy=True)
        self.to_ll = Transformer.from_crs("EPSG:2326", "EPSG:4326", always_xy=True)
        land = pd.read_parquet(MODEL / "landuse-2026.parquet").set_index("zone").reindex(self.inner)
        self.landuse = land
        self.trip_ends = self.ends.loc[self.inner]
        zoning = pd.read_parquet(MODEL / "zoning-capacity.parquet").set_index("zone").reindex(self.inner)
        self.zoning = zoning
        self.prices = pd.read_parquet(MODEL / "property-values-2026.parquet").set_index("zone").reindex(self.inner)
        import geopandas as gpd
        self.zone_geo = gpd.read_file(WEB / "zones-2026.geojson").set_index("zone").reindex(self.inner).to_crs("EPSG:2326")

    def zone_at(self, x: float, y: float) -> int:
        """Index of the zone containing (x, y) in HK1980 grid metres, or the nearest zone centre."""
        from shapely.geometry import Point
        point = Point(x, y)
        hit = self.zone_geo.sindex.query(point, predicate="within")
        if len(hit):
            return int(hit[0])
        return int(np.argmin(np.hypot(self.zone_x - x, self.zone_y - y)))

    # ---------- existing rail stations (for interchanges) ----------
    def _stations(self) -> None:
        z = zipfile.ZipFile(RAW / "gtfs_merged" / "hk-merged.gtfs.zip")
        routes = pd.read_csv(z.open("routes.txt"), dtype=str)
        rail = routes[routes["route_type"] == "1"]
        trips = pd.read_csv(z.open("trips.txt"), dtype=str, usecols=["route_id", "trip_id"])
        trips = trips[trips["route_id"].isin(rail["route_id"])]
        stops = pd.read_csv(z.open("stops.txt"), dtype=str)
        times = pd.read_csv(z.open("stop_times.txt"), dtype=str, usecols=["trip_id", "stop_id"])
        times = times[times["trip_id"].isin(trips["trip_id"])].merge(trips, on="trip_id").drop_duplicates(["route_id", "stop_id"])
        stops = stops.set_index("stop_id")
        times["station"] = times["stop_id"].map(lambda s: stops.at[s, "parent_station"] if isinstance(stops.at[s, "parent_station"], str) else s)
        times["line"] = times["route_id"].str.replace("osm:MTR-", "", regex=False)
        rows = []
        for station, group in times.groupby("station"):
            st = stops.loc[station]
            lon, lat = float(st["stop_lon"]), float(st["stop_lat"])
            x, y = self.to_grid.transform(lon, lat)
            rows.append({"id": station, "name_en": st["stop_name"], "lon": lon, "lat": lat, "x": x, "y": y,
                         "lines": sorted(set(group["line"]) & set(RAIL_LINES))})
        st = pd.DataFrame(rows)
        st = st[st["lines"].map(len) > 0].reset_index(drop=True)
        st["zone"] = [self.zone_at(x, y) for x, y in zip(st["x"], st["y"])]
        self.stations = st

    # ---------- land-use grid: water / hills / city along a segment ----------
    def _land(self) -> None:
        import rasterio
        with rasterio.open(RAW / "landuse" / "luhk2024_codes.tif") as src:
            self.land_codes, self.land_tf = src.read(1), src.transform

    def land_profile(self, x0: float, y0: float, x1: float, y1: float, step: float = 20.0) -> dict:
        """Shares of a straight segment over water, hills and built-up land."""
        import rasterio
        n = max(2, int(np.hypot(x1 - x0, y1 - y0) / step))
        f = (np.arange(n) + 0.5) / n
        rows, cols = rasterio.transform.rowcol(self.land_tf, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f)
        rows = np.clip(np.asarray(rows), 0, self.land_codes.shape[0] - 1)
        cols = np.clip(np.asarray(cols), 0, self.land_codes.shape[1] - 1)
        c = self.land_codes[rows, cols]
        return {"water": float(np.isin(c, WATER_CODES).mean()), "hill": float(np.isin(c, HILL_CODES).mean()),
                "urban": float(np.isin(c, URBAN_CODES).mean())}


_BASE: Base | None = None


def get_base() -> Base:
    global _BASE
    if _BASE is None:
        _BASE = Base()
    return _BASE
