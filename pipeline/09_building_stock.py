"""Download Hong Kong's building stock - the quantity the attraction side of the model is built on.

Input : CSDI FeatureServer, Lands Department "Building" layer (landsd_rcd_1637211194312_35158)
Output: data/raw/buildings/building-stock.parquet  (one row per building, with floor area)

Why this layer: TPDM Volume 1 Annex D expresses trip attraction as rates per unit of development -
per 100 m2 of office/shop floor area, per flat, per hotel room. Hong Kong publishes no employment
figures at zone level (checked: the census tables and their ArcGIS re-publications are all by place
of RESIDENCE), so floor area is what the attraction side has to be built on, and this is the only
public dataset that covers every permanent building in Hong Kong with a height.

Floor area = footprint area x storeys. Storeys is published for 54k buildings; for the rest it is
derived from the height, using what the buildings that publish both say:
  low-rise  - under 15 m, the usual storey count of published buildings of the same footprint band
              and the same whole metre of height. A single metres-per-storey ratio got village houses
              wrong: 36,000 small houses 8-9 m tall came out as two storeys, and nine in ten of the
              published ones that size have three.
  otherwise - height divided by a storey height fitted per footprint band.

Heights are metres above Principal Datum, so a building's own height is TopHeight - BaseHeight
(the highest TopHeight in the file is 957 m - a hut on top of Tai Mo Shan).

Only Tower and Podium are real buildings; Temporary Structure and Open-sided Structure are sheds,
canopies and covered walkways, and are counted in the report but carry no floor area.

Run from the project root (about 5 minutes, ~75 requests):
    uv run python pipeline/09_building_stock.py
"""

import time
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "raw" / "buildings" / "building-stock.parquet"

SERVICE = (
    "https://portal.csdi.gov.hk/server/rest/services/common/"
    "landsd_rcd_1637211194312_35158/FeatureServer/0/query"
)
# The default python-httpx user agent is blocked by the CSDI portal.
HEADERS = {"User-Agent": "TransitLabHK/0.1 (student hackathon prototype)"}
PAGE = 3000  # the service's maxRecordCount
FIELDS = "OBJECTID,BuildingBlockType,Storeys,StoreysInBasement,TopHeight,BaseHeight,Shape__Area,BuildingNameEN,BuildingNameTC"
REAL_BUILDINGS = "BuildingBlockType IN ('Tower','Podium')"

RAW = ROOT / "data" / "raw" / "buildings" / "building-stock-raw.parquet"

MAX_STOREYS = 120  # ICC, the tallest, has 108 floors; anything above is a data error
# A published storey count outside this many metres per storey contradicts the building's own
# height and is treated as a data error (one record claims 41 storeys in 14.1 m).
CREDIBLE_STOREY_M = (2.0, 8.0)
# Floor-to-floor rises with the size of the building - a shopping mall, terminal or logistics
# block has far taller floors than a flat. The bands are fitted below, not assumed.
FOOTPRINT_BANDS = [0, 100, 300, 1000, 3000, 10000, float("inf")]
BAND_NAMES = ["<100", "100-300", "300-1k", "1k-3k", "3k-10k", ">10k"]
DEFAULT_STOREY_M = 3.3  # fallback if a band has too few buildings to fit
LOW_RISE_M = 15.0  # below this height storeys come from the published-building lookup
LOOKUP_MIN = 50  # published buildings a (band, metre) cell needs before it is used


def fetch(params: dict, attempts: int = 4) -> dict:
    for attempt in range(attempts):
        try:
            response = httpx.get(SERVICE, params=params, headers=HEADERS, timeout=180)
            response.raise_for_status()
            payload = response.json()
            if "error" in payload:
                raise RuntimeError(payload["error"])
            return payload
        except Exception as error:
            if attempt == attempts - 1:
                raise
            print(f"   retry {attempt + 1}: {type(error).__name__}", flush=True)
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


def count(where: str) -> int:
    return fetch({"where": where, "returnCountOnly": "true", "f": "json"})["count"]


def download() -> pd.DataFrame:
    total = count(REAL_BUILDINGS)
    print(f"{count('1=1'):,} buildings in the layer, {total:,} of them towers and podiums")

    rows: list[dict] = []
    offset = 0
    while offset < total:
        page = fetch(
            {
                "where": REAL_BUILDINGS,
                "outFields": FIELDS,
                "returnGeometry": "false",
                "returnCentroid": "true",  # the point is enough to place a building in a zone
                "outSR": "4326",
                "orderByFields": "OBJECTID ASC",
                "resultOffset": offset,
                "resultRecordCount": PAGE,
                "f": "json",
            }
        )
        features = page.get("features", [])
        if not features:
            break
        for feature in features:
            centroid = feature.get("centroid") or {}
            rows.append({**feature["attributes"], "lon": centroid.get("x"), "lat": centroid.get("y")})
        offset += len(features)
        print(f"   {offset:,}/{total:,}", end="\r", flush=True)
    print(f"   {len(rows):,} buildings downloaded" + " " * 20)
    return pd.DataFrame(rows)


def credible_published(buildings: pd.DataFrame) -> pd.DataFrame:
    """Buildings whose published storey count agrees with their own height."""
    known = buildings[buildings["storeys_published"].notna() & buildings["height_m"].gt(0)].copy()
    known["metres_per_storey"] = known["height_m"] / known["storeys_published"]
    low, high = CREDIBLE_STOREY_M
    return known[known["metres_per_storey"].between(low, high)]


def low_rise_storeys(buildings: pd.DataFrame, credible: pd.DataFrame) -> pd.Series:
    """Storeys of low buildings: the median published count for the same footprint band and metre."""
    low = credible[credible["height_m"] < LOW_RISE_M]
    cells = low.groupby(["band", "metre"], observed=True)["storeys_published"].agg(["median", "size"])
    cells = cells[cells["size"] >= LOOKUP_MIN]
    lookup = np.floor(cells["median"] + 0.5)
    keys = pd.MultiIndex.from_arrays([buildings["band"].astype(str), buildings["metre"]])
    lookup.index = pd.MultiIndex.from_arrays([lookup.index.get_level_values(0).astype(str),
                                              lookup.index.get_level_values(1)])
    found = pd.Series(lookup.reindex(keys).to_numpy(), index=buildings.index)
    print(f"   低层楼宇查表：{len(cells)} 个（占地档, 米）格，覆盖 {found.notna().sum():,} 栋")
    return found.where(buildings["height_m"] < LOW_RISE_M)


def storey_heights(buildings: pd.DataFrame) -> pd.Series:
    """Metres per storey per size band, fitted on buildings that publish a credible storey count."""
    known = buildings[buildings["storeys_published"].notna() & buildings["height_m"].gt(0)]
    credible = credible_published(buildings)
    dropped = len(known) - len(credible)
    print(f"   storey heights fitted on {len(credible):,} buildings "
          f"({dropped:,} published counts contradict the building's own height and are dropped)")

    fitted = credible.groupby("band", observed=True)["metres_per_storey"].median()
    fitted = fitted.reindex(BAND_NAMES)
    thin = fitted.isna() | (credible.groupby("band", observed=True).size().reindex(BAND_NAMES) < 50)
    fitted = fitted.where(~thin, DEFAULT_STOREY_M)
    for band, metres in fitted.items():
        print(f"      占地 {band:>8} m2 -> {metres:.2f} m/层")
    return fitted


def main() -> None:
    if RAW.exists():
        buildings = pd.read_parquet(RAW)
        print(f"{len(buildings):,} buildings from the cached download ({RAW.relative_to(ROOT)})")
    else:
        buildings = download()
        RAW.parent.mkdir(parents=True, exist_ok=True)
        buildings.to_parquet(RAW, index=False)

    buildings = buildings.rename(columns={"Storeys": "storeys_published", "Shape__Area": "footprint_m2"})
    buildings["height_m"] = (buildings["TopHeight"] - buildings["BaseHeight"]).round(1)
    buildings["band"] = pd.cut(buildings["footprint_m2"], FOOTPRINT_BANDS, labels=BAND_NAMES)

    metres = storey_heights(buildings)
    per_storey = buildings["band"].map(metres).astype(float).fillna(DEFAULT_STOREY_M)
    by_ratio = (buildings["height_m"] / per_storey).round().clip(1, MAX_STOREYS)
    buildings["metre"] = np.floor(buildings["height_m"])
    by_lookup = low_rise_storeys(buildings, credible_published(buildings))
    buildings["storeys_from_height"] = by_lookup.fillna(by_ratio).clip(1, MAX_STOREYS)

    # Keep a published storey count only where the building's own height agrees with it.
    low, high = CREDIBLE_STOREY_M
    implied = buildings["height_m"] / buildings["storeys_published"]
    trusted = buildings["storeys_published"].notna() & implied.between(low, high)
    buildings["storeys"] = buildings["storeys_from_height"].where(~trusted, buildings["storeys_published"])
    buildings["storeys"] = buildings["storeys"].clip(1, MAX_STOREYS)
    buildings["storeys_source"] = np.where(trusted, "published", "from height")
    buildings["gfa_m2"] = (buildings["footprint_m2"] * buildings["storeys"]).round(0)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    keep = [
        "OBJECTID", "BuildingBlockType", "BuildingNameEN", "BuildingNameTC",
        "lon", "lat", "footprint_m2", "height_m", "storeys", "storeys_source", "gfa_m2",
    ]
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    buildings[keep].to_parquet(OUTPUT, index=False)

    # --- audit (docs/data-audit-checklist.md) -------------------------------------------------
    missing_height = buildings["height_m"].isna().sum()
    missing_point = buildings["lon"].isna().sum()
    published = (buildings["storeys_source"] == "published").sum()
    print(f"\n-> {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size / 1e6:.1f} MB)")
    print(f"   楼面面积合计 {buildings['gfa_m2'].sum() / 1e6:,.0f} 百万平方米，占地 {buildings['footprint_m2'].sum() / 1e6:,.1f} 平方公里")
    print(f"   层数：{published:,} 栋为官方公布（{published / len(buildings):.0%}），其余 {len(buildings) - published:,} 栋按高度推算")
    print(f"   缺高度 {missing_height:,} 栋，缺坐标 {missing_point:,} 栋")
    print(f"   最高 {buildings['storeys'].max():.0f} 层，中位 {buildings['storeys'].median():.0f} 层")

    # How wrong the height estimate would be, measured on the buildings that publish a storey count.
    known = buildings[buildings["storeys_published"].notna() & buildings["storeys_from_height"].notna()]
    error = (known["storeys_from_height"] - known["storeys_published"]).abs()
    within = (error <= 2).mean()
    print(f"   推算校验（{len(known):,} 栋有公布层数）：误差中位 {error.median():.1f} 层，{within:.0%} 在 ±2 层内")
    low = known[known["height_m"] < LOW_RISE_M]
    exact = (low["storeys_from_height"] == low["storeys_published"]).mean()
    exact_ratio = (by_ratio.loc[low.index] == low["storeys_published"]).mean()
    print(f"   低层（<{LOW_RISE_M:.0f} m，{len(low):,} 栋）层数完全正确：查表 {exact:.0%}，单一层高比例 {exact_ratio:.0%}")

    tallest = buildings.nlargest(5, "gfa_m2")
    for row in tallest.itertuples():
        name = next((n for n in (row.BuildingNameEN, row.BuildingNameTC) if isinstance(n, str) and n), "(未命名)")
        print(f"   最大: {name[:40]} {row.gfa_m2 / 1e3:,.0f} 千平方米（{row.storeys:.0f} 层）")


if __name__ == "__main__":
    main()
