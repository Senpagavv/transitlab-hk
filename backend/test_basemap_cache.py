import asyncio

import httpx
import pytest

from backend.services.basemap_cache import BasemapCache

TILE = "vt/basemap/WGS84/tile/15/14285/26775.pbf"


def make_cache(tmp_path, handler):
    calls = []

    def counting(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return handler(request)

    cache = BasemapCache(tmp_path, client=httpx.AsyncClient(transport=httpx.MockTransport(counting)))
    return cache, calls


def fetch_twice(cache, path):
    async def go():
        try:
            return [await cache.get(path), await cache.get(path)]
        finally:
            await cache.aclose()

    return asyncio.run(go())


def test_first_request_fetches_and_stores_second_is_served_from_disk(tmp_path):
    cache, calls = make_cache(tmp_path, lambda req: httpx.Response(200, content=b"tile-bytes"))

    first, second = fetch_twice(cache, TILE)

    assert (first.content, first.from_cache) == (b"tile-bytes", False)
    assert (second.content, second.from_cache) == (b"tile-bytes", True)
    assert second.media_type == "application/x-protobuf"
    assert calls == ["https://mapapi.geodata.gov.hk/gs/api/v1.0.0/" + TILE]


def test_empty_tiles_are_remembered(tmp_path):
    cache, calls = make_cache(tmp_path, lambda req: httpx.Response(204))

    first, second = fetch_twice(cache, "vt/basemap/WGS84/tile/16/1/1.pbf")

    assert first.empty and second.empty and second.from_cache
    assert len(calls) == 1


def test_font_paths_with_spaces_are_allowed(tmp_path):
    cache, calls = make_cache(tmp_path, lambda req: httpx.Response(200, content=b"glyphs"))

    first, _ = fetch_twice(cache, "vt/label/hk/tc/WGS84/resources/fonts/CYanHeiHK Bold/0-255.pbf")

    assert first.content == b"glyphs"
    assert calls[0].endswith("fonts/CYanHeiHK%20Bold/0-255.pbf")


@pytest.mark.parametrize(
    "path",
    ["vt/other/tile/1/1/1.pbf", "vt/basemap/WGS84/../../../secret.txt", "https://example.com/x", ""],
)
def test_only_basemap_paths_are_allowed(tmp_path, path):
    cache, calls = make_cache(tmp_path, lambda req: httpx.Response(200, content=b"x"))

    with pytest.raises(ValueError):
        asyncio.run(cache.get(path))
    assert calls == []


def test_upstream_errors_are_not_cached(tmp_path):
    cache, calls = make_cache(tmp_path, lambda req: httpx.Response(503))

    async def go():
        for _ in range(2):
            with pytest.raises(httpx.HTTPStatusError):
                await cache.get(TILE)
        await cache.aclose()

    asyncio.run(go())
    assert len(calls) == 2
