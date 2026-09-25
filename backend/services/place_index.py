"""Instant place suggestions from a local index of transit stations and stops.

The index file is built by pipeline/01_build_place_index.py. Matching ignores
simplified/traditional Chinese differences, letter case and spaces.
"""

import json
from pathlib import Path

from opencc import OpenCC

from backend.models import Place

# Stations are more useful suggestions than individual bus stops with the same name.
KIND_PRIORITY = {"mtr": 0, "light_rail": 1, "ferry": 2, "bus_stop": 3, "minibus_stop": 4, "place": 5}

_to_simplified = OpenCC("t2s")


def normalize(text: str) -> str:
    return _to_simplified.convert(text).lower().replace(" ", "")


def match_tier(key: str, query: str) -> int | None:
    """0 = exact, 1 = prefix, 2 = substring, None = no match."""
    if not key:
        return None
    if key == query:
        return 0
    if key.startswith(query):
        return 1
    if query in key:
        return 2
    return None


class PlaceIndex:
    def __init__(self, places: list[Place]):
        self._entries = [(place, normalize(place.name_zh), normalize(place.name_en)) for place in places]

    def __len__(self) -> int:
        return len(self._entries)

    @classmethod
    def from_file(cls, path: Path) -> "PlaceIndex":
        if not path.exists():
            return cls([])
        data = json.loads(path.read_text(encoding="utf-8"))
        source = data["source"]
        return cls([Place(**item, source=source) for item in data["places"]])

    def suggest(self, query: str, limit: int = 8) -> list[Place]:
        q = normalize(query)
        if not q:
            return []
        ranked = []
        for place, zh_key, en_key in self._entries:
            tiers = [t for t in (match_tier(zh_key, q), match_tier(en_key, q)) if t is not None]
            if tiers:
                ranked.append((min(tiers), KIND_PRIORITY[place.kind], len(place.name_zh), place))
        ranked.sort(key=lambda r: r[:3])

        # The same stop name often exists at several spots; one suggestion per name is enough.
        results: list[Place] = []
        seen: set[tuple[str, str]] = set()
        for *_, place in ranked:
            key = (place.name_zh, place.kind)
            if key not in seen:
                seen.add(key)
                results.append(place)
                if len(results) == limit:
                    break
        return results
