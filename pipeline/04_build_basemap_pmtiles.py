"""Pack the cached Lands Department basemap into compressed PMTiles archives for web hosting.

Input : data/cache/landsd/  (filled by pipeline/03_prewarm_basemap_cache.py or by browsing)
Output: data/build/basemap/
          hk-landsd-base.pmtiles       vector basemap, zoom 9-15
          hk-landsd-label-tc.pmtiles   Traditional Chinese labels, zoom 9-15
          hk-landsd-raster.pmtiles     label-free raster placeholder, zoom 9-13
          resources/...                fonts and sprites (small static files)

Why PMTiles: thousands of small tile files are awkward to upload and many static hosts limit file
counts. A PMTiles archive is one file that the browser reads with HTTP range requests (only the
bytes of the tiles it needs), so it can sit on any static host or object storage (e.g. Cloudflare
R2, Tencent Cloud COS). Vector tiles are gzip-compressed inside the archive, and identical tiles
(open sea, empty land) are stored once.

Attribution (CSDI terms): credit the Government of the HKSAR / CSDI Portal as the data source and
show "Map from Lands Department" with the Lands Department logo on the map.

Run from the project root:
    uv run --with pmtiles python pipeline/04_build_basemap_pmtiles.py
"""

import gzip
import json
import random
import shutil
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from pmtiles.reader import MmapSource, Reader
from pmtiles.tile import Compression, TileType, tileid_to_zxy, zxy_to_tileid
from pmtiles.writer import Writer

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "cache" / "landsd"
OUT = ROOT / "data" / "build" / "basemap"

HK_BBOX = (113.82, 22.13, 114.45, 22.58)  # west, south, east, north
ATTRIBUTION = "Map from Lands Department. Data: Government of the HKSAR, CSDI Portal."


@dataclass
class Tileset:
    name: str
    folder: str  # inside the cache
    order: str  # directory order below the zoom folder: "yx" = {z}/{y}/{x}, "xy" = {z}/{x}/{y}
    suffix: str
    tile_type: TileType
    gzip_tiles: bool


TILESETS = [
    Tileset("hk-landsd-base", "vt/basemap/WGS84/tile", "yx", ".pbf", TileType.MVT, True),
    Tileset("hk-landsd-label-tc", "vt/label/hk/tc/WGS84/tile", "yx", ".pbf", TileType.MVT, True),
    Tileset("hk-landsd-raster", "xyz/basemap/wgs84", "xy", ".png", TileType.PNG, False),
]
RESOURCE_FOLDERS = ["vt/basemap/WGS84/resources", "vt/label/hk/tc/WGS84/resources"]


def cached_tiles(tileset: Tileset) -> dict[int, Path]:
    tiles = {}
    for path in (CACHE / tileset.folder).glob(f"*/*/*{tileset.suffix}"):
        z = int(path.parent.parent.name)
        a, b = int(path.parent.name), int(path.stem)
        x, y = (b, a) if tileset.order == "yx" else (a, b)
        tiles[zxy_to_tileid(z, x, y)] = path
    return tiles


def build(tileset: Tileset) -> dict:
    tiles = cached_tiles(tileset)
    if not tiles:
        return {"name": tileset.name, "tiles": 0}
    target = OUT / f"{tileset.name}.pmtiles"
    raw_bytes = 0
    with open(target, "wb") as f:
        writer = Writer(f)
        for tile_id in sorted(tiles):  # ascending ids keep the archive "clustered" (faster reads)
            data = tiles[tile_id].read_bytes()
            raw_bytes += len(data)
            writer.write_tile(tile_id, gzip.compress(data, compresslevel=9, mtime=0) if tileset.gzip_tiles else data)
        west, south, east, north = HK_BBOX
        writer.finalize(
            {
                "tile_type": tileset.tile_type,
                "tile_compression": Compression.GZIP if tileset.gzip_tiles else Compression.NONE,
                "min_lon_e7": int(west * 1e7),
                "min_lat_e7": int(south * 1e7),
                "max_lon_e7": int(east * 1e7),
                "max_lat_e7": int(north * 1e7),
                "center_zoom": 11,
                "center_lon_e7": int(114.12 * 1e7),
                "center_lat_e7": int(22.36 * 1e7),
            },
            {
                "name": tileset.name,
                "attribution": ATTRIBUTION,
                "source": "https://mapapi.geodata.gov.hk/gs/api/v1.0.0/" + tileset.folder,
                "generated": date.today().isoformat(),
            },
        )
    return {"name": tileset.name, "tiles": len(tiles), "raw_mb": raw_bytes / 1e6, "archive_mb": target.stat().st_size / 1e6, "files": tiles, "target": target}


def verify(result: dict, tileset: Tileset, samples: int = 200) -> int:
    """Read random tiles back from the archive and compare them with the cached originals."""
    ids = random.sample(sorted(result["files"]), min(samples, result["tiles"]))
    with open(result["target"], "rb") as f:
        reader = Reader(MmapSource(f))
        for tile_id in ids:
            z, x, y = tileid_to_zxy(tile_id)
            stored = reader.get(z, x, y)
            if tileset.gzip_tiles:
                stored = gzip.decompress(stored)
            if stored != result["files"][tile_id].read_bytes():
                raise SystemExit(f"Mismatch in {tileset.name} at {z}/{x}/{y}")
    return len(ids)


def copy_resources() -> float:
    size = 0
    for folder in RESOURCE_FOLDERS:
        for path in (CACHE / folder).rglob("*"):
            if path.is_file() and not path.name.endswith((".empty", ".part")):
                target = OUT / "resources" / path.relative_to(CACHE)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, target)
                size += path.stat().st_size
    return size / 1e6


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {"generated": date.today().isoformat(), "attribution": ATTRIBUTION, "archives": []}
    for tileset in TILESETS:
        result = build(tileset)
        if not result["tiles"]:
            print(f"{tileset.name}: no cached tiles, skipped")
            continue
        checked = verify(result, tileset)
        print(
            f"{tileset.name}: {result['tiles']} tiles, {result['raw_mb']:.1f} MB raw -> "
            f"{result['archive_mb']:.1f} MB archive ({result['archive_mb'] / result['raw_mb']:.0%}), "
            f"{checked} tiles verified"
        )
        manifest["archives"].append({k: result[k] for k in ("name", "tiles", "raw_mb", "archive_mb")})
    manifest["resources_mb"] = copy_resources()
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    total = sum(a["archive_mb"] for a in manifest["archives"]) + manifest["resources_mb"]
    print(f"resources (fonts, sprites): {manifest['resources_mb']:.1f} MB")
    print(f"Total to upload: {total:.1f} MB in {len(manifest['archives'])} archives + resources -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
