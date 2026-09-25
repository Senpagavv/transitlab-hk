"""Build observed hourly traffic profiles from the Transport Department's road detectors.

Input : DATA.GOV.HK "Traffic Data of Strategic / Major Roads"
        - detector locations (CSV, ~807 detectors with coordinates)
        - raw speed/volume/occupancy XML, one snapshot per ~30 s, archived since mid-2021:
          https://api.data.gov.hk/v1/historical-archive/  (get-file redirects to app.data.gov.hk)
Output: data/web/traffic/observed-<date>.json  (hourly volume and speed per detector)
        data/web/traffic/detectors.json         (detector locations, written once)

This is *measured* traffic, not model output: it covers the strategic and major roads where the
detectors sit, and counts vehicles only. Everything else on the map comes from the transport model
and must stay visually distinct.

Each snapshot holds two 30-second periods. Sampling a few snapshots per hour is enough for an
hourly profile: hourly flow = mean vehicles per 30 s x 120.

Run from the project root (about 3 minutes per day sampled):
    uv run python pipeline/05_traffic_detectors.py 2026-09-09            # one weekday
    uv run python pipeline/05_traffic_detectors.py 2026-09-09 --every 15 # denser sampling
"""

import argparse
import asyncio
import csv
import json
import statistics
import sys
import time
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "cache" / "td-traffic"
OUT = ROOT / "data" / "web" / "traffic"

DETECTOR_INFO_URL = (
    "https://static.data.gov.hk/td/traffic-data-strategic-major-roads/info/traffic_speed_volume_occ_info.csv"
)
RAW_XML_URL = "https://resource.data.one.gov.hk/td/traffic-detectors/rawSpeedVol-all.xml"
ARCHIVE_URL = "https://app.data.gov.hk/v1/historical-archive/get-file"  # api.* returns a JSON pointer, app.* the file
VERSIONS_URL = "https://api.data.gov.hk/v1/historical-archive/list-file-versions"
USER_AGENT = "TransitLabHK/0.1 (student hackathon prototype)"

HOURS = range(0, 24)
MAX_RATE = 2.0  # requests per second
CONCURRENCY = 3


async def fetch_snapshot(client: httpx.AsyncClient, stamp: str) -> bytes | None:
    """One archived snapshot, cached on disk (they are immutable)."""
    cached = CACHE / f"{stamp}.xml"
    if cached.exists():
        return cached.read_bytes()
    resp = await client.get(ARCHIVE_URL, params={"url": RAW_XML_URL, "time": stamp}, follow_redirects=True)
    if resp.status_code != 200 or not resp.content.startswith(b"<?xml"):
        return None
    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_bytes(resp.content)
    return resp.content


def parse_snapshot(xml_bytes: bytes) -> dict[str, tuple[int, float]]:
    """detector id -> (vehicles counted in the snapshot, mean speed) using valid lanes only."""
    root = ET.fromstring(xml_bytes)
    readings: dict[str, tuple[int, list[float]]] = {}
    for detector in root.findall(".//detector"):
        det_id = detector.findtext("detector_id")
        if not det_id:
            continue
        volume, speeds = readings.get(det_id, (0, []))
        for lane in detector.findall(".//lane"):
            if lane.findtext("valid") != "Y":
                continue
            volume += int(lane.findtext("volume") or 0)
            speed = lane.findtext("speed")
            if speed:
                speeds.append(float(speed))
        readings[det_id] = (volume, speeds)
    return {k: (v, statistics.mean(s) if s else 0.0) for k, (v, s) in readings.items()}


def load_detectors() -> list[dict]:
    path = CACHE / "detectors.csv"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        resp = httpx.get(DETECTOR_INFO_URL, timeout=60, headers={"User-Agent": USER_AGENT})
        resp.raise_for_status()
        path.write_bytes(resp.content)
    rows = list(csv.DictReader(path.read_text(encoding="utf-8-sig").splitlines()))
    return [
        {
            "id": r["AID_ID_Number"],
            "district": r["District"],
            "road_en": r["Road_EN"].strip(),
            "road_zh": r["Road_TC"].strip(),
            "direction": r["Direction"],
            "lon": round(float(r["Longitude"]), 6),
            "lat": round(float(r["Latitude"]), 6),
        }
        for r in rows
        if r.get("Longitude") and r.get("Latitude")
    ]


def available_stamps(day: date) -> list[str]:
    """Timestamps actually archived for that day (they are irregular, roughly every 1-2 minutes)."""
    resp = httpx.get(
        VERSIONS_URL,
        params={"url": RAW_XML_URL, "start": f"{day:%Y%m%d}", "end": f"{day:%Y%m%d}"},
        timeout=120,
        headers={"User-Agent": USER_AGENT},
    )
    resp.raise_for_status()
    return sorted(resp.json().get("timestamps", []))


def pick_stamps(day: date, every_minutes: int, tries: int = 4) -> list[list[str]]:
    """For each target time, a few nearby timestamps to try.

    The version listing and the stored files do not match exactly - roughly half the listed
    timestamps answer 404 - so each target keeps several candidates, tried nearest first.
    """
    stamps = available_stamps(day)
    if not stamps:
        sys.exit(f"No archived snapshots for {day}; the archive starts in mid-2021.")
    minutes = {s: int(s[9:11]) * 60 + int(s[11:13]) for s in stamps}
    used: set[str] = set()
    targets = []
    for target in range(0, 24 * 60, every_minutes):
        nearby = sorted(
            (s for s in stamps if s not in used and abs(minutes[s] - target) <= every_minutes),
            key=lambda s: abs(minutes[s] - target),
        )[:tries]
        if nearby:
            used.update(nearby)
            targets.append(nearby)
    return targets


async def collect(day: date, every_minutes: int) -> dict:
    targets = pick_stamps(day, every_minutes)
    volumes: dict[str, dict[int, list[int]]] = defaultdict(lambda: defaultdict(list))
    speeds: dict[str, dict[int, list[float]]] = defaultdict(lambda: defaultdict(list))
    missing = 0
    started = time.monotonic()

    limits = httpx.Limits(max_connections=CONCURRENCY)
    async with httpx.AsyncClient(timeout=120, headers={"User-Agent": USER_AGENT}, limits=limits) as client:
        queue: asyncio.Queue[list[str]] = asyncio.Queue()
        for candidates in targets:
            queue.put_nowait(candidates)
        next_slot = time.monotonic()
        lock = asyncio.Lock()

        async def worker() -> None:
            nonlocal missing, next_slot
            while not queue.empty():
                candidates = queue.get_nowait()
                data, stamp = None, candidates[0]
                for candidate in candidates:  # nearest first; some listed snapshots 404
                    async with lock:  # keep the request rate polite
                        now = time.monotonic()
                        slot = max(now, next_slot)
                        next_slot = slot + 1 / MAX_RATE
                    await asyncio.sleep(slot - time.monotonic())
                    data = await fetch_snapshot(client, candidate)
                    if data:
                        stamp = candidate
                        break
                if not data:
                    missing += 1
                    continue
                hour = int(stamp[9:11])
                for det_id, (volume, speed) in parse_snapshot(data).items():
                    volumes[det_id][hour].append(volume)
                    if speed:
                        speeds[det_id][hour].append(speed)
                done = len(targets) - queue.qsize()
                if done % 20 == 0:
                    print(f"  {done}/{len(targets)} time slots, {missing} missing, {time.monotonic() - started:.0f}s", flush=True)

        await asyncio.gather(*(worker() for _ in range(CONCURRENCY)))

    detectors = []
    for det_id, by_hour in volumes.items():
        hourly = [round(statistics.mean(by_hour[h]) * 120) if by_hour.get(h) else None for h in HOURS]
        hourly_speed = [round(statistics.mean(speeds[det_id][h])) if speeds[det_id].get(h) else None for h in HOURS]
        # How many 30-second samples back each hour: few samples mean a noisy hourly figure.
        samples = [len(by_hour.get(h, [])) for h in HOURS]
        detectors.append(
            {"id": det_id, "vehicles_per_hour": hourly, "speed_kph": hourly_speed, "samples_per_hour": samples}
        )
    return {
        "date": day.isoformat(),
        "weekday": day.strftime("%A"),
        "sampled_every_minutes": every_minutes,
        "snapshots_used": len(targets) - missing,
        "source": "Transport Department, Traffic Data of Strategic / Major Roads (DATA.GOV.HK)",
        "note": "Measured vehicle counts at detectors; hourly flow = mean vehicles per 30 s x 120.",
        "detectors": sorted(detectors, key=lambda d: d["id"]),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("day", help="date to sample, e.g. 2026-09-09 (pick a normal weekday)")
    parser.add_argument("--every", type=int, default=30, help="minutes between snapshots (default 30)")
    args = parser.parse_args()
    day = datetime.strptime(args.day, "%Y-%m-%d").date()
    if day >= date.today():
        sys.exit("Pick a past date: the archive only holds days up to yesterday.")

    OUT.mkdir(parents=True, exist_ok=True)
    detectors_path = OUT / "detectors.json"
    if not detectors_path.exists():
        detectors = load_detectors()
        detectors_path.write_text(json.dumps(detectors, ensure_ascii=False), encoding="utf-8")
        print(f"{len(detectors)} detector locations -> {detectors_path.relative_to(ROOT)}")

    print(f"Sampling {day} every {args.every} min ...", flush=True)
    result = asyncio.run(collect(day, args.every))
    target = OUT / f"observed-{day:%Y-%m-%d}.json"
    target.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    busiest = sorted(result["detectors"], key=lambda d: -max((v or 0) for v in d["vehicles_per_hour"]))[:3]
    print(f"{len(result['detectors'])} detectors, {result['snapshots_used']} snapshots -> {target.relative_to(ROOT)} ({target.stat().st_size / 1e6:.1f} MB)")
    for det in busiest:
        peak = max((v or 0) for v in det["vehicles_per_hour"])
        hour = det["vehicles_per_hour"].index(peak)
        print(f"  busiest: {det['id']} {peak} veh/h at {hour:02d}:00")


if __name__ == "__main__":
    main()
