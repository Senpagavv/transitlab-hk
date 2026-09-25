"""Build the local place index used for instant search suggestions.

Input : data/raw/gtfs_community/hk.gtfs.zip
        Source: https://github.com/wheelstransit/hongkong-community-gtfs (feed https://feed.justusewheels.com/)
        Data licence: ODbL (attribution required). Downloaded 2026-09-15.
Output: data/web/places.json  (MTR stations, light rail stops, ferry piers, bus and minibus stops)

Run from the project root:
    uv run python pipeline/01_build_place_index.py
"""

import csv
import io
import json
import zipfile
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GTFS_ZIP = ROOT / "data" / "raw" / "gtfs_community" / "hk.gtfs.zip"
OUTPUT = ROOT / "data" / "web" / "places.json"
SOURCE = "Hong Kong Community GTFS (ODbL)"

# Stops with the same name within this grid cell (~200 m) are merged: one road stop
# usually appears several times (each direction, each operator).
MERGE_CELL_DEG = 0.002


def clean(text: str) -> str:
    """Collapse full-width and repeated spaces (some source names contain them)."""
    return " ".join(text.replace("　", " ").split())


def read_csv(archive: zipfile.ZipFile, name: str) -> list[dict]:
    with archive.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")))


def classify(stop: dict) -> str | None:
    stop_id, location_type = stop["stop_id"], stop["location_type"]
    if stop_id.startswith("MTR-"):
        return "mtr" if location_type == "1" else None  # skip platforms and entrances
    if location_type != "0":
        return None
    if stop_id.startswith("LR"):
        return "light_rail"
    if stop_id.startswith("FERRY-"):
        return "ferry"
    if stop_id.startswith("GMB-"):
        return "minibus_stop"
    if stop_id.split("-")[0] in {"KMB", "CTB", "NLB", "MTRB"}:
        return "bus_stop"
    return None


def with_station_suffix(name_zh: str, name_en: str) -> tuple[str, str]:
    zh = name_zh if name_zh.endswith("站") else f"{name_zh}站"
    en = name_en if name_en.lower().endswith(("station", "stop")) else f"{name_en} Station"
    return zh, en


def build() -> list[dict]:
    with zipfile.ZipFile(GTFS_ZIP) as archive:
        stops = read_csv(archive, "stops.txt")
        zh_names = {
            t["record_id"]: clean(t["translation"])
            for t in read_csv(archive, "translations.txt")
            if t["table_name"] == "stops.txt" and t["field_name"] == "stop_name" and t["language"] == "zh-Hant"
        }

    groups: dict[tuple, list[dict]] = defaultdict(list)
    for stop in stops:
        kind = classify(stop)
        if kind is None:
            continue
        name_en = clean(stop["stop_name"])
        name_zh = zh_names.get(stop["stop_id"], "") or name_en
        if kind in {"mtr", "light_rail"}:
            name_zh, name_en = with_station_suffix(name_zh, name_en)
        lon, lat = float(stop["stop_lon"]), float(stop["stop_lat"])
        cell = (round(lon / MERGE_CELL_DEG), round(lat / MERGE_CELL_DEG))
        groups[(kind, name_zh, cell)].append({"name_en": name_en, "lon": lon, "lat": lat})

    places = []
    for (kind, name_zh, _cell), members in groups.items():
        places.append(
            {
                "name_zh": name_zh,
                "name_en": members[0]["name_en"],
                "kind": kind,
                "lon": round(sum(m["lon"] for m in members) / len(members), 6),
                "lat": round(sum(m["lat"] for m in members) / len(members), 6),
            }
        )
    places.sort(key=lambda p: (p["kind"], p["name_zh"]))
    return places


def main() -> None:
    places = build()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {"source": SOURCE, "generated": date.today().isoformat(), "places": places}
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    counts = defaultdict(int)
    for p in places:
        counts[p["kind"]] += 1
    print(f"Wrote {len(places)} places to {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size / 1024:.0f} KB)")
    print(dict(counts))


if __name__ == "__main__":
    main()
