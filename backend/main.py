"""TransitLab HK backend.

Start from the project root:
    uv run uvicorn backend.main:app --reload --port 8000
Interactive API docs: http://127.0.0.1:8000/docs
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from backend.models import Place
from backend.services.basemap_cache import BasemapCache
from backend.services.place_index import PlaceIndex
from backend.services.place_search import LocationSearch
from backend.services.traffic_live import LiveTraffic, LiveTrafficSnapshot

load_dotenv()

ROOT = Path(__file__).resolve().parents[1]
PLACE_INDEX_PATH = ROOT / "data" / "web" / "places.json"
BASEMAP_CACHE_DIR = ROOT / "data" / "cache" / "landsd"
BASEMAP_BUILD_DIR = ROOT / "data" / "build" / "basemap"
TRAFFIC_DIR = ROOT / "data" / "web" / "traffic"

log = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.place_index = PlaceIndex.from_file(PLACE_INDEX_PATH)
    if not len(app.state.place_index):
        log.warning("Place index missing or empty: run `uv run python pipeline/01_build_place_index.py`")
    app.state.location_search = LocationSearch()
    app.state.basemap_cache = BasemapCache(BASEMAP_CACHE_DIR)
    observed_days = sorted(TRAFFIC_DIR.glob("observed-*.json"))
    app.state.live_traffic = LiveTraffic(
        TRAFFIC_DIR / "detectors.json",
        observed_days[-1] if observed_days else TRAFFIC_DIR / "missing.json",
    )
    if not app.state.live_traffic.detector_count:
        log.warning("Detector locations missing: run `uv run python pipeline/05_traffic_detectors.py <date>`")
    yield
    await app.state.location_search.aclose()
    await app.state.basemap_cache.aclose()
    await app.state.live_traffic.aclose()


app = FastAPI(title="TransitLab HK API", version="0.1.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=2000)  # the traffic snapshot compresses ~7x

# Packaged basemap (pipeline/04), served like a static web host would (with HTTP range requests),
# so the deployment setup can be tested locally with /?basemap=pmtiles.
app.mount("/api/basemap-pmtiles", StaticFiles(directory=BASEMAP_BUILD_DIR, check_dir=False), name="basemap-pmtiles")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/places/suggest", response_model=list[Place])
def suggest(request: Request, q: str = Query(..., min_length=1, max_length=100)) -> list[Place]:
    """Instant suggestions from the local transit index (stations and stops)."""
    return request.app.state.place_index.suggest(q, limit=6)


@app.get("/api/search", response_model=list[Place])
async def search(request: Request, q: str = Query(..., min_length=1, max_length=100)) -> list[Place]:
    """Slower but broader search (buildings, addresses, facilities) via the Lands Department API."""
    try:
        return await request.app.state.location_search.search(q, limit=6)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Location Search API unavailable: {exc}") from exc


@app.get("/api/basemap/{path:path}")
async def basemap(request: Request, path: str) -> Response:
    """Lands Department basemap tiles, fonts and sprites, served through the local disk cache."""
    try:
        file = await request.app.state.basemap_cache.get(path)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Basemap service unavailable: {exc}") from exc
    headers = {"Cache-Control": "public, max-age=604800", "X-Basemap-Cache": "hit" if file.from_cache else "miss"}
    if file.empty:
        return Response(status_code=204, headers=headers)
    return Response(content=file.content, media_type=file.media_type, headers=headers)


@app.get("/api/traffic/corridors")
def traffic_corridors() -> Response:
    """Detectors joined into continuous lines along the roads (built by pipeline/15b)."""
    path = TRAFFIC_DIR / "detector-corridors.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Run pipeline/15b_detector_corridors.py first")
    return Response(content=path.read_bytes(), media_type="application/json",
                    headers={"Cache-Control": "public, max-age=3600"})


@app.get("/api/fleet/scenarios")
def fleet_scenarios() -> Response:
    """What a dispatched fleet does with the day's taxi demand (built by pipeline/31): the service
    level at each fleet size, the hour-by-hour picture, and the same per zone."""
    path = ROOT / "data" / "web" / "fleet-scenarios.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Run pipeline/31_fleet_simulator.py first")
    return Response(content=path.read_bytes(), media_type="application/json",
                    headers={"Cache-Control": "public, max-age=3600"})


@app.get("/api/fleet/deployment")
def fleet_deployment() -> Response:
    """Area deployment scenarios built by pipeline/32 and pipeline/33."""
    path = ROOT / "data" / "web" / "deployment-scenarios.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Run pipeline/32 and pipeline/33 first")
    return Response(content=path.read_bytes(), media_type="application/json",
                    headers={"Cache-Control": "public, max-age=3600"})


@app.get("/api/zones")
def zones() -> Response:
    """The model zones (455) with their 2026 figures (built by pipeline/19), for the zone map layer."""
    path = ROOT / "data" / "web" / "zones-2026.geojson"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Run pipeline/19_web_zones.py first")
    return Response(content=path.read_bytes(), media_type="application/geo+json",
                    headers={"Cache-Control": "public, max-age=3600"})


@app.get("/api/traffic/live", response_model=LiveTrafficSnapshot)
async def traffic_live(request: Request) -> LiveTrafficSnapshot:
    """Measured speed and flow at the Transport Department's road detectors, refreshed ~every 3 min."""
    try:
        return await request.app.state.live_traffic.snapshot()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"Traffic feed unavailable: {exc}") from exc
