"""Live traffic from the Transport Department's road detectors on strategic and major roads.

Source: DATA.GOV.HK "Traffic Data of Strategic / Major Roads" - one XML with every detector's
speed, volume and occupancy per 30-second period. Measured, not modelled.

Timing (checked 2026-09-16): the file is rewritten about every 3 minutes and its readings lag the
clock by 3-5 minutes; a CDN caches it for 60 s. So this service refreshes at most once a minute and
sends an If-None-Match header, which keeps the 700 KB download to once per real update.

The browser gets a compact list: position, flow, speed, a congestion level and each lane's own
reading (the feed reports lane by lane: fast, middle, slow). Congestion compares the current speed
with that detector's own free-flow reference speed.
"""

import json
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import httpx
from pydantic import BaseModel

LIVE_URL = "https://resource.data.one.gov.hk/td/traffic-detectors/rawSpeedVol-all.xml"
USER_AGENT = "TransitLabHK/0.1 (student hackathon prototype)"
SOURCE = "Transport Department, Traffic Data of Strategic / Major Roads (DATA.GOV.HK)"
REFRESH_SECONDS = 60
PERIOD_SECONDS = 30  # each reading counts vehicles over 30 seconds
MIN_FREE_FLOW_KPH = 30.0  # floor for the reference speed, so a slow-sited detector is not "always jammed"


class LiveLane(BaseModel):
    name: str  # as the feed names it: "Fast Lane", "Middle Lane 1", "Slow Lane"
    vehicles_per_hour: int
    speed_kph: float | None
    occupancy_pct: float | None  # share of the 30 s the detector had a vehicle over it


class LiveDetector(BaseModel):
    id: str
    lon: float
    lat: float
    road_zh: str
    road_en: str
    direction: str
    vehicles_per_hour: int
    speed_kph: float | None  # the average vehicle's speed across all valid lanes
    free_flow_kph: float | None
    congestion: float | None  # 0 = free flowing, 1 = stopped
    lanes: list[LiveLane] = []


class LiveTrafficSnapshot(BaseModel):
    observed_at: str
    source: str
    detectors: list[LiveDetector]


def free_flow_speeds(observed_day_file: Path) -> dict[str, float]:
    """Each detector's reference speed: the fastest hourly average in a full day of observations."""
    if not observed_day_file.exists():
        return {}
    day = json.loads(observed_day_file.read_text(encoding="utf-8"))
    speeds = {}
    for detector in day.get("detectors", []):
        hourly = [s for s in detector.get("speed_kph", []) if s]
        if hourly:
            speeds[detector["id"]] = max(max(hourly), MIN_FREE_FLOW_KPH)
    return speeds


Reading = tuple[int, float | None, list[LiveLane]]


def _number(text: str | None) -> float | None:
    try:
        return float(text) if text not in (None, "") else None
    except ValueError:
        return None


def parse_live_xml(xml_bytes: bytes) -> tuple[str, dict[str, Reading]]:
    """Returns (period end time, {detector id: (vehicles per hour, speed, lanes)}) for the latest period.

    The feed reports every lane separately. The detector's speed is the average VEHICLE's speed -
    lanes weighted by how many vehicles they carried - because a near-empty fast lane doing 80 km/h
    beside a queueing slow lane is not a road moving at 65. With no vehicles at all in the period,
    the lanes' own speed readings are averaged instead.
    """
    root = ET.fromstring(xml_bytes)
    periods = root.findall(".//period")
    if not periods:
        raise ValueError("no periods in traffic feed")
    latest = periods[-1]
    observed_at = f"{root.findtext('date', '')}T{latest.findtext('period_to', '')}"
    per_hour = 3600 // PERIOD_SECONDS

    readings: dict[str, Reading] = {}
    for detector in latest.findall(".//detector"):
        det_id = detector.findtext("detector_id")
        if not det_id:
            continue
        lanes = []
        for lane in detector.findall(".//lane"):
            if lane.findtext("valid") != "Y":
                continue
            volume = int(_number(lane.findtext("volume")) or 0)
            lanes.append(LiveLane(
                name=lane.findtext("lane_id") or "",
                vehicles_per_hour=volume * per_hour,
                speed_kph=_number(lane.findtext("speed")),
                occupancy_pct=_number(lane.findtext("occupancy")),
            ))
        timed = [lane for lane in lanes if lane.speed_kph is not None]
        weight = sum(lane.vehicles_per_hour for lane in timed)
        if weight:
            speed = sum(lane.speed_kph * lane.vehicles_per_hour for lane in timed) / weight
        else:
            speed = sum(lane.speed_kph for lane in timed) / len(timed) if timed else None
        readings[det_id] = (sum(lane.vehicles_per_hour for lane in lanes), speed, lanes)
    return observed_at, readings


class LiveTraffic:
    def __init__(self, detectors_file: Path, observed_day_file: Path, client: httpx.AsyncClient | None = None):
        self._detectors = {
            d["id"]: d for d in json.loads(detectors_file.read_text(encoding="utf-8"))
        } if detectors_file.exists() else {}
        self._free_flow = free_flow_speeds(observed_day_file)
        self._client = client or httpx.AsyncClient(timeout=60, headers={"User-Agent": USER_AGENT})
        self._snapshot: LiveTrafficSnapshot | None = None
        self._fetched_at = 0.0
        self._etag: str | None = None

    @property
    def detector_count(self) -> int:
        return len(self._detectors)

    async def snapshot(self, now: float | None = None) -> LiveTrafficSnapshot:
        now = time.monotonic() if now is None else now
        if self._snapshot and now - self._fetched_at < REFRESH_SECONDS:
            return self._snapshot

        headers = {"If-None-Match": self._etag} if self._etag else {}
        resp = await self._client.get(LIVE_URL, headers=headers)
        self._fetched_at = now
        if resp.status_code == 304 and self._snapshot:  # unchanged upstream
            return self._snapshot
        resp.raise_for_status()
        self._etag = resp.headers.get("etag")
        self._snapshot = self._build(*parse_live_xml(resp.content))
        return self._snapshot

    def _build(self, observed_at: str, readings: dict[str, Reading]) -> LiveTrafficSnapshot:
        detectors = []
        for det_id, (flow, speed, lanes) in readings.items():
            meta = self._detectors.get(det_id)
            if not meta:
                continue  # detector not in the published location list
            free_flow = self._free_flow.get(det_id)
            congestion = None
            if speed is not None and free_flow:
                congestion = round(min(1.0, max(0.0, 1 - speed / free_flow)), 3)
            detectors.append(
                LiveDetector(
                    id=det_id,
                    lon=meta["lon"],
                    lat=meta["lat"],
                    road_zh=meta["road_zh"],
                    road_en=meta["road_en"],
                    direction=meta["direction"],
                    vehicles_per_hour=flow,
                    speed_kph=round(speed, 1) if speed is not None else None,
                    free_flow_kph=round(free_flow, 1) if free_flow else None,
                    congestion=congestion,
                    lanes=lanes,
                )
            )
        return LiveTrafficSnapshot(observed_at=observed_at, source=SOURCE, detectors=detectors)

    async def aclose(self) -> None:
        await self._client.aclose()
