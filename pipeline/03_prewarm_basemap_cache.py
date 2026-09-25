"""Pre-download the Lands Department basemap for all of Hong Kong into the local disk cache.

Fills data/cache/landsd/ - the same cache the backend serves /api/basemap from - so every area is
fast on first view and the map works offline. Downloads politely: at most MAX_RATE requests per
second, a few at a time, lowest zoom first. Files already cached are skipped, so the script can be
stopped (Ctrl+C) and re-run at any time.

Scope (Hong Kong bounding box):
  - vector basemap and Traditional Chinese label tiles, zoom 9-15 (about 3,500 tiles each)
  - label-free raster placeholder tiles, zoom 9-13
  - sprites, and the font ranges MapLibre requests (Chinese characters are drawn locally)

Terms: CSDI data may be downloaded, reproduced and distributed, commercially or not, with the
Government and the CSDI Portal credited as the source (portal.csdi.gov.hk/csdi-webpage/doc/TNC).
The Map API asks to avoid large numbers of requests in a short period, hence the rate limit.

Run from the project root (about an hour the first time):
    uv run python pipeline/03_prewarm_basemap_cache.py
"""

import asyncio
import math
import sys
import time
from collections import Counter
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.services.basemap_cache import EMPTY_SUFFIX, BasemapCache  # noqa: E402

CACHE_DIR = ROOT / "data" / "cache" / "landsd"
FAILURES_FILE = ROOT / "data" / "cache" / "prewarm-failures.txt"

HK_BBOX = (113.82, 22.13, 114.45, 22.58)  # west, south, east, north
VECTOR_ZOOMS = range(9, 16)
RASTER_ZOOMS = range(9, 14)
MAX_RATE = 2.5  # requests per second
CONCURRENCY = 3
RETRIES = 3

VECTOR_SOURCES = ["vt/basemap/WGS84/tile/{z}/{y}/{x}.pbf", "vt/label/hk/tc/WGS84/tile/{z}/{y}/{x}.pbf"]
RASTER_SOURCE = "xyz/basemap/wgs84/{z}/{x}/{y}.png"
FONTS = {
    "vt/label/hk/tc/WGS84/resources/fonts": ["CYanHeiHK Bold", "CYanHeiHK Regular", "Source Han Sans SC Bold"],
    "vt/basemap/WGS84/resources/fonts": ["Arial Regular"],
}
# Basic Latin, Latin-1/Extended, general punctuation, CJK punctuation, full-width forms.
FONT_RANGES = [(0, 255), (256, 511), (8192, 8447), (12288, 12543), (65280, 65535)]
SPRITES = [f"vt/basemap/WGS84/resources/sprites/sprite{s}" for s in (".json", ".png", "@2x.json", "@2x.png")]


def tile_range(z: int):
    west, south, east, north = HK_BBOX
    n = 2**z

    def tile_y(lat: float) -> int:
        return int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)

    xs = range(int((west + 180) / 360 * n), int((east + 180) / 360 * n) + 1)
    ys = range(tile_y(north), tile_y(south) + 1)
    return [(x, y) for y in ys for x in xs]


def build_jobs() -> list[str]:
    jobs = list(SPRITES)
    jobs += [f"{base}/{font}/{lo}-{hi}.pbf" for base, fonts in FONTS.items() for font in fonts for lo, hi in FONT_RANGES]
    for z in VECTOR_ZOOMS:  # lowest zoom first: a partial run already helps overview maps
        coords = tile_range(z)
        if z in RASTER_ZOOMS:
            jobs += [RASTER_SOURCE.format(z=z, x=x, y=y) for x, y in coords]
        for source in VECTOR_SOURCES:
            jobs += [source.format(z=z, x=x, y=y) for x, y in coords]
    return jobs


def is_cached(cache: BasemapCache, path: str) -> bool:
    target = cache.local_path(path)
    return target.exists() or target.with_name(target.name + EMPTY_SUFFIX).exists()


class RateLimiter:
    """Spaces request starts at least 1/rate seconds apart across all workers."""

    def __init__(self, rate: float):
        self.interval = 1 / rate
        self.next_slot = time.monotonic()
        self.lock = asyncio.Lock()

    async def wait(self) -> None:
        async with self.lock:
            now = time.monotonic()
            slot = max(now, self.next_slot)
            self.next_slot = slot + self.interval
        await asyncio.sleep(slot - now)


async def main() -> None:
    cache = BasemapCache(CACHE_DIR)
    jobs = build_jobs()
    pending = [path for path in jobs if not is_cached(cache, path)]
    print(
        f"{len(jobs)} files in scope, {len(jobs) - len(pending)} already cached, "
        f"{len(pending)} to download (about {len(pending) / MAX_RATE / 60:.0f} min at {MAX_RATE}/s)",
        flush=True,
    )

    queue: asyncio.Queue[str] = asyncio.Queue()
    for path in pending:
        queue.put_nowait(path)
    limiter = RateLimiter(MAX_RATE)
    stats: Counter[str] = Counter()
    failures: list[str] = []
    started = time.monotonic()

    async def fetch(path: str) -> None:
        for attempt in range(1, RETRIES + 1):
            await limiter.wait()
            try:
                file = await cache.get(path)
                stats["empty" if file.empty else "downloaded"] += 1
                stats["bytes"] += len(file.content)
                return
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 404:
                    stats["not_found"] += 1
                    return
                error = f"HTTP {exc.response.status_code}"
            except httpx.HTTPError as exc:
                error = repr(exc)
            if attempt == RETRIES:
                failures.append(f"{path}\t{error}")
                return
            await asyncio.sleep(2**attempt)

    async def worker() -> None:
        while not queue.empty():
            await fetch(queue.get_nowait())
            stats["done"] += 1
            if stats["done"] % 100 == 0 or stats["done"] == len(pending):
                elapsed = time.monotonic() - started
                remaining = (len(pending) - stats["done"]) * elapsed / stats["done"]
                print(
                    f"{stats['done']}/{len(pending)}  downloaded {stats['downloaded']}  empty {stats['empty']}  "
                    f"failed {len(failures)}  {stats['bytes'] / 1e6:.0f} MB  "
                    f"elapsed {elapsed / 60:.1f} min  ETA {remaining / 60:.1f} min",
                    flush=True,
                )

    try:
        await asyncio.gather(*(worker() for _ in range(CONCURRENCY)))
    finally:
        await cache.aclose()

    FAILURES_FILE.parent.mkdir(parents=True, exist_ok=True)
    FAILURES_FILE.write_text("\n".join(failures), encoding="utf-8")
    print(
        f"Done in {(time.monotonic() - started) / 60:.1f} min: {stats['downloaded']} downloaded, "
        f"{stats['empty']} empty, {stats['not_found']} not available, {len(failures)} failed "
        f"(re-run to retry; list in {FAILURES_FILE.relative_to(ROOT)})",
        flush=True,
    )


if __name__ == "__main__":
    asyncio.run(main())
