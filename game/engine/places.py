"""What the map shows before anything is built: where people live and work, how far they are from the
railway, the main flows, and a "station card" for any point - so a player can see why a station is good.

Residents and jobs of each zone are spread over the zone's own homes and workplaces on the Planning
Department 10 m land-use grid (residents on residential cells, jobs on commercial / industrial /
institutional cells), then summed on a 50 m grid. A station's catchment is everything within 800 m.
"""
from __future__ import annotations

import io
import json

import numpy as np

from .base import WEB

CELL = 50                       # metres, catchment grid
HOME_CODES = (1, 2, 3)
WORK_CODES = (11, 21, 22, 23, 31)
CATCHMENT_M = 800.0
GRADE_TEXT = {"A": "很好", "B": "不错", "C": "一般", "D": "偏弱"}


class Places:
    def __init__(self, base) -> None:
        self.base = base
        self._grids()
        self._existing()
        self._zones()

    # ---------- residents and jobs on a 50 m grid ----------
    def _grids(self) -> None:
        from rasterio import features
        b = self.base
        codes = b.land_codes
        label = features.rasterize(((g, k + 1) for k, g in enumerate(b.zone_geo.geometry)), out_shape=codes.shape,
                                   transform=b.land_tf, fill=0, dtype="int32")
        n = b.n
        pop = b.ends["population"].to_numpy(float)[:n]
        jobs = b.ends["jobs"].to_numpy(float)[:n]
        land = codes > 0
        home = np.isin(codes, HOME_CODES)
        work = np.isin(codes, WORK_CODES)

        k = CELL // 10
        H, W = codes.shape
        nyc, nxc = H // k, W // k

        def spread(values: np.ndarray, mask: np.ndarray) -> np.ndarray:
            """Each zone's total spread evenly over its cells of `mask` (or all its land if it has none)."""
            cells = np.bincount(label[mask], minlength=n + 1)[1:]
            fallback = np.bincount(label[land], minlength=n + 1)[1:]
            use_fb = np.concatenate([[False], cells == 0])
            per = np.concatenate([[0.0], np.where(cells > 0, values / np.maximum(cells, 1),
                                                  values / np.maximum(fallback, 1))])
            take = np.flatnonzero(((mask & ~use_fb[label]) | (land & use_fb[label])) & (label > 0))
            r, c = take // W, take % W
            keep = (r // k < nyc) & (c // k < nxc)
            take, r, c = take[keep], r[keep], c[keep]
            out = np.bincount((r // k) * nxc + c // k, weights=per[label.ravel()[take]], minlength=nyc * nxc)
            return out.reshape(nyc, nxc)

        self.pop = spread(pop, home)
        self.jobs = spread(jobs, work)
        tf = b.land_tf
        self.x0, self.y1 = tf.c, tf.f
        self.nx, self.ny = self.pop.shape[1], self.pop.shape[0]
        self.cx = self.x0 + (np.arange(self.nx) + 0.5) * CELL
        self.cy = self.y1 - (np.arange(self.ny) + 0.5) * CELL

    def around(self, x: float, y: float, radius: float = CATCHMENT_M) -> tuple[float, float]:
        c0, c1 = int((x - radius - self.x0) // CELL), int((x + radius - self.x0) // CELL) + 1
        r0, r1 = int((self.y1 - y - radius) // CELL), int((self.y1 - y + radius) // CELL) + 1
        c0, r0 = max(c0, 0), max(r0, 0)
        c1, r1 = min(c1, self.nx), min(r1, self.ny)
        if c0 >= c1 or r0 >= r1:
            return 0.0, 0.0
        dx = self.cx[c0:c1][None, :] - x
        dy = self.cy[r0:r1][:, None] - y
        inside = dx * dx + dy * dy <= radius * radius
        return float(self.pop[r0:r1, c0:c1][inside].sum()), float(self.jobs[r0:r1, c0:c1][inside].sum())

    # ---------- existing stations: names, catchments, the yardstick for grades ----------
    def _existing(self) -> None:
        b = self.base
        places = json.loads((WEB / "places.json").read_text(encoding="utf-8"))["places"]
        mtr = [p for p in places if p["kind"] == "mtr"]
        mx, my = b.to_grid.transform([p["lon"] for p in mtr], [p["lat"] for p in mtr])
        rows = []
        for _, s in b.stations.iterrows():
            d = np.hypot(np.asarray(mx) - s["x"], np.asarray(my) - s["y"])
            k = int(np.argmin(d))
            name_zh = mtr[k]["name_zh"].removesuffix("站") if d[k] < 400 else s["name_en"]
            pop, jobs = self.around(s["x"], s["y"])
            rows.append({"id": s["id"], "name_zh": name_zh, "name_en": s["name_en"], "lon": s["lon"], "lat": s["lat"],
                         "lines": list(s["lines"]), "pop": round(pop), "jobs": round(jobs)})
        self.existing = rows
        self.yard = np.sort([r["pop"] + r["jobs"] for r in rows])
        sx, sy = b.stations["x"].to_numpy(), b.stations["y"].to_numpy()
        # cells within 800 m of an existing station
        near = np.zeros_like(self.pop, bool)
        for x, y in zip(sx, sy):
            c0, c1 = max(int((x - CATCHMENT_M - self.x0) // CELL), 0), min(int((x + CATCHMENT_M - self.x0) // CELL) + 1, self.nx)
            r0, r1 = max(int((self.y1 - y - CATCHMENT_M) // CELL), 0), min(int((self.y1 - y + CATCHMENT_M) // CELL) + 1, self.ny)
            dx = self.cx[c0:c1][None, :] - x
            dy = self.cy[r0:r1][:, None] - y
            near[r0:r1, c0:c1] |= dx * dx + dy * dy <= CATCHMENT_M ** 2
        self.near_rail = near

    def grade(self, total: float) -> tuple[str, int]:
        pct = int(round(100 * np.searchsorted(self.yard, total) / len(self.yard)))
        g = "A" if pct >= 75 else "B" if pct >= 50 else "C" if pct >= 25 else "D"
        return g, pct

    def probe(self, lon: float, lat: float) -> dict:
        """Station card for a point."""
        b = self.base
        x, y = b.to_grid.transform(lon, lat)
        pop, jobs = self.around(x, y)
        g, pct = self.grade(pop + jobs)
        alike = min(self.existing, key=lambda r: abs(np.log1p(r["pop"] + r["jobs"]) - np.log1p(pop + jobs)))
        d = np.hypot(b.stations["x"].to_numpy() - x, b.stations["y"].to_numpy() - y)
        k = int(np.argmin(d))
        z = b.zone_at(x, y)
        r, c = int((self.y1 - y) // 10), int((x - self.x0) // 10)
        code = int(b.land_codes[min(max(r, 0), b.land_codes.shape[0] - 1), min(max(c, 0), b.land_codes.shape[1] - 1)])
        zone = self.zones[z]
        unserved_pop, unserved_jobs = self.unserved_around(x, y)
        return {"lon": lon, "lat": lat, "pop": round(pop), "jobs": round(jobs), "grade": g, "grade_text": GRADE_TEXT[g],
                "percentile": pct, "alike": alike["name_zh"], "alike_total": alike["pop"] + alike["jobs"],
                "nearest": self.existing[k]["name_zh"], "nearest_m": round(float(d[k])),
                "snap": self.existing[k]["name_zh"] if d[k] < 150 else None,
                "far_from_rail_pop": round(unserved_pop), "far_from_rail_jobs": round(unserved_jobs),
                "on_water": code in (0, 91), "zone": zone["zone"], "zone_label": zone["label"], "district": zone["district"],
                "price_m2": zone["price_m2"]}

    def unserved_around(self, x: float, y: float) -> tuple[float, float]:
        c0, c1 = max(int((x - CATCHMENT_M - self.x0) // CELL), 0), min(int((x + CATCHMENT_M - self.x0) // CELL) + 1, self.nx)
        r0, r1 = max(int((self.y1 - y - CATCHMENT_M) // CELL), 0), min(int((self.y1 - y + CATCHMENT_M) // CELL) + 1, self.ny)
        if c0 >= c1 or r0 >= r1:
            return 0.0, 0.0
        dx = self.cx[c0:c1][None, :] - x
        dy = self.cy[r0:r1][:, None] - y
        inside = (dx * dx + dy * dy <= CATCHMENT_M ** 2) & ~self.near_rail[r0:r1, c0:c1]
        return float(self.pop[r0:r1, c0:c1][inside].sum()), float(self.jobs[r0:r1, c0:c1][inside].sum())

    # ---------- zones for search, labels and the result maps ----------
    def _zones(self) -> None:
        b = self.base
        geo = json.loads((WEB / "zones-2026.geojson").read_text(encoding="utf-8"))
        props = {f["properties"]["zone"]: f["properties"] for f in geo["features"]}
        price = b.prices["dom_price_m2"]
        price = price.fillna(price.median())
        self.zones = []
        for k, z in enumerate(b.inner):
            p = props.get(z, {})
            self.zones.append({"zone": z, "label": p.get("label", z), "district": p.get("district", ""),
                               "lon": round(float(b.zone_lon[k]), 6), "lat": round(float(b.zone_lat[k]), 6),
                               "pop": int(b.ends["population"].iloc[k]), "jobs": int(b.ends["jobs"].iloc[k]),
                               "price_m2": round(float(price.iloc[k])), "road_access": bool(p.get("road_access", True))})

    def corridors(self, P_PT: np.ndarray, top: int = 12) -> list[dict]:
        """Biggest morning-peak public-transport flows between districts."""
        b = self.base
        dist = [z["district"] for z in self.zones]
        names = sorted(set(dist))
        idx = np.array([names.index(d) for d in dist])
        m = np.zeros((len(names), len(names)))
        np.add.at(m, (idx[:, None], idx[None, :]), P_PT[: b.n, : b.n])
        pop = b.ends["population"].to_numpy(float)[: b.n] + 1
        centre = {}
        for d in range(len(names)):
            w = pop[idx == d]
            centre[d] = (float(np.average(b.zone_lon[idx == d], weights=w)), float(np.average(b.zone_lat[idx == d], weights=w)))
        np.fill_diagonal(m, 0)
        lon = np.array([centre[d][0] for d in range(len(names))])
        lat = np.array([centre[d][1] for d in range(len(names))])
        km = np.hypot((lon[:, None] - lon[None, :]) * 102.7, (lat[:, None] - lat[None, :]) * 110.6)
        out = []
        for flat in np.argsort(m * km, axis=None)[::-1][:top]:   # many people going far: what a railway is for
            i, j = divmod(int(flat), len(names))
            out.append({"from": names[i], "to": names[j], "people": round(float(m[i, j])), "km": round(float(km[i, j]), 1),
                        "from_lon": centre[i][0], "from_lat": centre[i][1], "to_lon": centre[j][0], "to_lat": centre[j][1]})
        return out

    # ---------- heat layers as PNG images in Web Mercator ----------
    def layer_bounds(self) -> list[list[float]]:
        b = self.base
        lon0, lat0 = b.to_ll.transform(self.x0, self.y1 - self.ny * CELL)
        lon1, lat1 = b.to_ll.transform(self.x0 + self.nx * CELL, self.y1)
        return [[lat0, lon0], [lat1, lon1]]

    def layer_png(self, name: str) -> bytes:
        from PIL import Image
        b = self.base
        if name == "pop":
            grid, rgb = self.pop, (214, 69, 65)
        elif name == "jobs":
            grid, rgb = self.jobs, (52, 101, 164)
        else:
            grid, rgb = np.where(self.near_rail, 0.0, self.pop + self.jobs), (230, 126, 34)
        (lat0, lon0), (lat1, lon1) = self.layer_bounds()
        W = 1100
        merc = lambda lat: np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))
        my0, my1 = merc(lat0), merc(lat1)
        H = int(W * (my1 - my0) / np.radians(lon1 - lon0))
        lons = lon0 + (np.arange(W) + 0.5) / W * (lon1 - lon0)
        mys = my1 - (np.arange(H) + 0.5) / H * (my1 - my0)
        lats = np.degrees(2 * np.arctan(np.exp(mys)) - np.pi / 2)
        LON, LAT = np.meshgrid(lons, lats)
        X, Y = b.to_grid.transform(LON, LAT)
        c = ((X - self.x0) // CELL).astype(int)
        r = ((self.y1 - Y) // CELL).astype(int)
        ok = (c >= 0) & (c < self.nx) & (r >= 0) & (r < self.ny)
        # density per km2 smoothed over ~150 m so single blocks do not flicker
        from scipy.ndimage import uniform_filter
        dens = uniform_filter(grid, size=3) / (CELL * CELL / 1e6)
        v = np.where(ok, dens[np.clip(r, 0, self.ny - 1), np.clip(c, 0, self.nx - 1)], 0.0)
        level = np.clip(np.log10(np.maximum(v, 1)) - 3, 0, 2) / 2          # 1,000 to 100,000 per km2
        alpha = np.where(v > 1000, 40 + 175 * level, 0).astype(np.uint8)
        img = np.zeros((H, W, 4), np.uint8)
        img[..., 0], img[..., 1], img[..., 2], img[..., 3] = rgb[0], rgb[1], rgb[2], alpha
        buf = io.BytesIO()
        Image.fromarray(img, "RGBA").save(buf, "PNG", optimize=True)
        return buf.getvalue()


_PLACES: Places | None = None


def get_places() -> Places:
    global _PLACES
    if _PLACES is None:
        from .base import get_base
        _PLACES = Places(get_base())
    return _PLACES
