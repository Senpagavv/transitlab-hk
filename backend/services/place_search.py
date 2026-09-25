"""Resolve free-text place names with the HK Lands Department Location Search API.

The API is free, needs no key, and returns coordinates in HK 1980 Grid (EPSG:2326).
The web map uses WGS84 longitude/latitude (EPSG:4326), so every result is converted here.

A single request takes ~1.5 s: ~0.75 s for the TLS handshake and ~0.8 s of server time.
LocationSearch keeps one HTTP client open (no repeated handshakes) and caches answers.
"""

from collections import OrderedDict

import httpx
from pyproj import Transformer

from backend.models import Place

LOCATION_SEARCH_URL = "https://www.map.gov.hk/gs/api/v1.0.0/locationSearch"
SOURCE_NAME = "LandsD Location Search API"
# The API's firewall rejects the default "python-httpx" User-Agent (HTTP 403); identify the app instead.
USER_AGENT = "TransitLabHK/0.1 (student hackathon prototype)"

_HK80_TO_WGS84 = Transformer.from_crs("EPSG:2326", "EPSG:4326", always_xy=True)


def to_place(item: dict) -> Place:
    lon, lat = _HK80_TO_WGS84.transform(item["x"], item["y"])
    return Place(
        name_zh=item.get("nameZH", ""),
        name_en=item.get("nameEN", ""),
        address_zh=item.get("addressZH", ""),
        district_zh=item.get("districtZH", ""),
        lon=round(lon, 6),
        lat=round(lat, 6),
        source=SOURCE_NAME,
    )


def unique_places(items: list[dict], limit: int) -> list[Place]:
    """Convert API items, dropping repeats of the same name at the same spot (the API often returns duplicates)."""
    places: list[Place] = []
    seen: set[tuple[str, float, float]] = set()
    for item in items:
        place = to_place(item)
        key = (place.name_zh, place.lon, place.lat)
        if key in seen:
            continue
        seen.add(key)
        places.append(place)
        if len(places) == limit:
            break
    return places


class LocationSearch:
    def __init__(self, client: httpx.AsyncClient | None = None, cache_size: int = 512):
        self._client = client or httpx.AsyncClient(timeout=10, headers={"User-Agent": USER_AGENT})
        self._cache: OrderedDict[tuple[str, int], list[Place]] = OrderedDict()
        self._cache_size = cache_size

    async def search(self, query: str, limit: int = 8) -> list[Place]:
        key = (query, limit)
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key]

        resp = await self._client.get(LOCATION_SEARCH_URL, params={"q": query})
        if resp.status_code == 500:
            # The API answers 500 (instead of an empty list) when nothing matches.
            # Not cached, because a real outage looks the same.
            return []
        resp.raise_for_status()

        places = unique_places(resp.json(), limit)
        self._cache[key] = places
        if len(self._cache) > self._cache_size:
            self._cache.popitem(last=False)
        return places

    async def aclose(self) -> None:
        await self._client.aclose()
