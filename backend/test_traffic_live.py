import asyncio
import json

import httpx

from backend.services.traffic_live import LiveTraffic, free_flow_speeds, parse_live_xml

FEED = b"""<?xml version="1.0" encoding="utf-8"?>
<raw_speed_volume_list><date>2026-09-16</date><periods>
 <period><period_from>12:40:00</period_from><period_to>12:40:30</period_to><detectors>
  <detector><detector_id>AID001</detector_id><lanes>
   <lane><lane_id>Fast Lane</lane_id><speed>20</speed><volume>9</volume><valid>Y</valid></lane>
  </lanes></detector>
 </detectors></period>
 <period><period_from>12:40:30</period_from><period_to>12:41:00</period_to><detectors>
  <detector><detector_id>AID001</detector_id><lanes>
   <lane><lane_id>Fast Lane</lane_id><speed>30</speed><occupancy>12</occupancy><volume>10</volume><valid>Y</valid></lane>
   <lane><lane_id>Slow Lane</lane_id><speed>50</speed><occupancy>4</occupancy><volume>5</volume><valid>Y</valid></lane>
   <lane><lane_id>Broken</lane_id><speed>99</speed><volume>99</volume><valid>N</valid></lane>
  </lanes></detector>
  <detector><detector_id>UNKNOWN</detector_id><lanes>
   <lane><lane_id>Fast Lane</lane_id><speed>60</speed><volume>1</volume><valid>Y</valid></lane>
  </lanes></detector>
  <detector><detector_id>EMPTY</detector_id><lanes>
   <lane><lane_id>Fast Lane</lane_id><speed>70</speed><volume>0</volume><valid>Y</valid></lane>
   <lane><lane_id>Slow Lane</lane_id><speed>50</speed><volume>0</volume><valid>Y</valid></lane>
  </lanes></detector>
 </detectors></period>
</periods></raw_speed_volume_list>"""


def write_inputs(tmp_path):
    detectors = tmp_path / "detectors.json"
    detectors.write_text(
        json.dumps(
            [{"id": "AID001", "district": "Sha Tin", "road_en": "Tolo Highway", "road_zh": "吐露港公路",
              "direction": "North", "lon": 114.18, "lat": 22.38}]
        ),
        encoding="utf-8",
    )
    day = tmp_path / "observed.json"
    day.write_text(
        json.dumps({"detectors": [{"id": "AID001", "speed_kph": [80, 75, None, 60]}]}),
        encoding="utf-8",
    )
    return detectors, day


def test_latest_period_is_used_and_invalid_lanes_ignored():
    observed_at, readings = parse_live_xml(FEED)

    assert observed_at == "2026-09-16T12:41:00"
    flow, speed, lanes = readings["AID001"]
    # 10 + 5 vehicles in 30 s -> x120 per hour
    assert flow == 1800
    # the speed of the average vehicle: 10 at 30 km/h and 5 at 50 km/h, not the mean of the lanes
    assert round(speed, 1) == 36.7
    assert [(lane.name, lane.vehicles_per_hour, lane.speed_kph, lane.occupancy_pct) for lane in lanes] == [
        ("Fast Lane", 1200, 30.0, 12.0),
        ("Slow Lane", 600, 50.0, 4.0),
    ]


def test_empty_road_falls_back_to_the_lanes_own_speeds():
    _, readings = parse_live_xml(FEED)

    flow, speed, lanes = readings["EMPTY"]
    assert (flow, speed, len(lanes)) == (0, 60.0, 2)


def test_free_flow_speed_is_the_fastest_hour_observed():
    class Tmp:
        pass

    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as d:
        _, day = write_inputs(Path(d))
        assert free_flow_speeds(day) == {"AID001": 80}


def test_snapshot_joins_locations_and_scores_congestion(tmp_path):
    detectors, day = write_inputs(tmp_path)
    transport = httpx.MockTransport(lambda req: httpx.Response(200, content=FEED, headers={"etag": "v1"}))
    live = LiveTraffic(detectors, day, client=httpx.AsyncClient(transport=transport))

    snapshot = asyncio.run(live.snapshot(now=0))

    assert snapshot.observed_at == "2026-09-16T12:41:00"
    assert [d.id for d in snapshot.detectors] == ["AID001"]  # unknown detector dropped
    detector = snapshot.detectors[0]
    assert (detector.vehicles_per_hour, detector.speed_kph, detector.free_flow_kph) == (1800, 36.7, 80.0)
    assert detector.congestion == 0.542  # 36.7 of a free-flow 80 km/h
    assert detector.road_zh == "吐露港公路"
    assert [lane.name for lane in detector.lanes] == ["Fast Lane", "Slow Lane"]


def test_upstream_is_polled_at_most_once_a_minute(tmp_path):
    detectors, day = write_inputs(tmp_path)
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.headers.get("if-none-match"))
        if calls[-1] == "v1":
            return httpx.Response(304)
        return httpx.Response(200, content=FEED, headers={"etag": "v1"})

    live = LiveTraffic(detectors, day, client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))

    async def go():
        await live.snapshot(now=0)
        await live.snapshot(now=30)  # within the refresh window: served from memory
        await live.snapshot(now=61)  # past it: asks upstream, which answers "not modified"
        await live.aclose()

    asyncio.run(go())
    assert calls == [None, "v1"]
