import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "data" / "model"
WEB = ROOT / "data" / "web"

REQUESTS = MODEL / "taxi-requests-2026.parquet"
SUPPLY = MODEL / "taxi-fleet-hourly.parquet"
SIMULATION = MODEL / "fleet-simulation-2026.parquet"
SCENARIOS = WEB / "fleet-scenarios.json"
SIMULATION_AUDIT = WEB / "fleet-simulation-audit.json"
MODE_SPLIT = MODEL / "mode-split-2026.npz"


def require(*paths: Path) -> None:
    missing = [str(path.relative_to(ROOT)) for path in paths if not path.exists()]
    if missing:
        pytest.skip("尚未生成产物：" + "、".join(missing))


@pytest.fixture(scope="session")
def requests() -> pd.DataFrame:
    require(REQUESTS)
    return pd.read_parquet(REQUESTS)


@pytest.fixture(scope="session")
def mode_split():
    require(MODE_SPLIT)
    with np.load(MODE_SPLIT) as source:
        yield source


@pytest.fixture(scope="session")
def simulation() -> pd.DataFrame:
    require(SIMULATION)
    return pd.read_parquet(SIMULATION)


def test_request_count_matches_seven_taxi_matrices(requests, mode_split):
    taxi_matrices = [f"T_{purpose}_TAXI" for purpose in ("HBW", "HBS", "HBO", "NHB", "CBS", "CBR", "CBV")]
    expected = sum(float(mode_split[name].sum()) for name in taxi_matrices)

    assert abs(len(requests) - expected) / expected < 0.01


def test_request_times_are_within_one_day(requests):
    assert requests["time_sec"].between(0, 86_400, inclusive="left").all()


def test_request_coordinates_are_within_hong_kong(requests):
    assert requests["origin_lon"].between(113.8, 114.5).all()
    assert requests["destination_lon"].between(113.8, 114.5).all()
    assert requests["origin_lat"].between(22.1, 22.6).all()
    assert requests["destination_lat"].between(22.1, 22.6).all()


def test_request_zones_exist_in_mode_split(requests, mode_split):
    zones = {str(zone) for zone in mode_split["zones"]}

    assert set(requests["origin_zone"].astype(str)) <= zones
    assert set(requests["destination_zone"].astype(str)) <= zones


def test_hourly_completed_requests_do_not_exceed_arrivals(simulation):
    # Per hour this need not hold: arrivals are counted when they come in, services and give-ups when
    # they happen, so a request that waits across the hour lands in two different rows. Cumulatively
    # it must hold - nothing can be served before it has been asked for.
    done = (simulation["served"] + simulation["gave_up"]).cumsum()

    assert (done <= simulation["requests"].cumsum() + 1e-9).all()


def test_all_requests_are_resolved_by_end_of_day(simulation):
    assert simulation["served"].sum() + simulation["gave_up"].sum() == simulation["requests"].sum()


def test_busy_vehicles_never_exceed_fleet(simulation):
    require(SIMULATION_AUDIT)
    audit = json.loads(SIMULATION_AUDIT.read_text(encoding="utf-8"))

    assert (simulation["vehicles_busy"] <= audit["fleet"]).all()


def test_kilometres_and_empty_share_are_consistent(simulation):
    assert (simulation[["empty_km", "paid_km"]] >= 0).all().all()
    denominator = simulation["empty_km"] + simulation["paid_km"]
    expected = simulation["empty_km"] / denominator

    assert np.allclose(simulation["empty_share"], expected, atol=1e-6, rtol=0, equal_nan=True)


def test_smaller_fleets_do_not_improve_service():
    require(SCENARIOS)
    sweep = sorted(json.loads(SCENARIOS.read_text(encoding="utf-8"))["sweep"],
                   key=lambda row: row["fleet"], reverse=True)

    for larger, smaller in zip(sweep, sweep[1:]):
        # 容许 1% 数值噪声，但缩小车队不应提高接单率或缩短等待。
        assert smaller["served_share"] <= larger["served_share"] * 1.01
        assert smaller["mean_wait_min"] >= larger["mean_wait_min"] * 0.99


def test_simulator_busy_peak_exceeds_occupied_only_peak(simulation):
    require(SUPPLY)
    supply = pd.read_parquet(SUPPLY, columns=["busy_taxis"])
    occupied_peak = float(supply["busy_taxis"].max())
    simulated_peak = float(simulation["vehicles_busy"].max())
    gap = simulated_peak / occupied_peak - 1

    assert occupied_peak < simulated_peak
    assert 0 <= gap <= 0.60
