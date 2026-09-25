import asyncio

import httpx

from backend.services.place_search import LocationSearch, to_place, unique_places

SHA_TIN_STATION = {"nameZH": "沙田站", "nameEN": "Sha Tin Station", "districtZH": "沙田區", "x": 837700.0, "y": 826450.0}


def test_hk80_grid_is_converted_to_wgs84():
    # Kwu Tung, as returned by the Location Search API (HK 1980 Grid metres).
    place = to_place({"nameZH": "古洞", "nameEN": "Kwu Tung", "districtZH": "北區", "x": 828799.0, "y": 840507.0})

    assert place.name_zh == "古洞"
    assert place.kind == "place"
    assert 114.08 < place.lon < 114.12
    assert 22.49 < place.lat < 22.52


def test_duplicate_results_are_dropped_and_limit_applies():
    other = {**SHA_TIN_STATION, "nameZH": "沙田站巴士總站", "x": 837650.0}
    third = {**SHA_TIN_STATION, "nameZH": "沙田公園", "x": 837900.0}

    places = unique_places([SHA_TIN_STATION, SHA_TIN_STATION, other, SHA_TIN_STATION, third], limit=2)

    assert [p.name_zh for p in places] == ["沙田站", "沙田站巴士總站"]


def run_search(handler, queries: list[str]) -> tuple[list[list], int]:
    calls = 0

    def counting_handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return handler(request)

    async def go():
        search = LocationSearch(client=httpx.AsyncClient(transport=httpx.MockTransport(counting_handler)))
        try:
            return [await search.search(q) for q in queries]
        finally:
            await search.aclose()

    return asyncio.run(go()), calls


def test_api_500_means_no_match_and_is_not_cached():
    results, calls = run_search(lambda req: httpx.Response(500), ["zzqq", "zzqq"])

    assert results == [[], []]
    assert calls == 2


def test_repeated_query_is_served_from_cache():
    results, calls = run_search(lambda req: httpx.Response(200, json=[SHA_TIN_STATION]), ["沙田", "沙田"])

    assert [p.name_zh for p in results[1]] == ["沙田站"]
    assert calls == 1
