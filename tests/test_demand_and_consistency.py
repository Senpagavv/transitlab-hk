import json
import re
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq
import pytest


ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "data" / "model"
WEB = ROOT / "data" / "web"

TD_DIGEST = MODEL / "td-digest-series.json"
SUPPLY = MODEL / "taxi-fleet-hourly.parquet"
REQUESTS = MODEL / "taxi-requests-2026.parquet"
SUPPLY_AUDIT = WEB / "fleet-supply-audit.json"
SIMULATION_AUDIT = WEB / "fleet-simulation-audit.json"
MODE_CHOICE_AUDIT = WEB / "mode-choice-audit.json"
REQUESTS_AUDIT = WEB / "taxi-requests-audit.json"
ASSIGNMENT_AUDIT = WEB / "assignment-audit.json"
CORRIDOR_DIAGNOSIS = WEB / "corridor-diagnosis.json"

HIGH_LEVEL_MODES = (
    "Franchised Buses",
    "Railways",
    "Public Light Buses",
    "Ferries",
    "Taxis",
    "Residents' Services",
    "MTR Buses (Northwest New Territories)",
)
FLEET_GROUPS = ("urban", "new_territories", "lantau")


def require(*paths: Path) -> None:
    missing = [str(path.relative_to(ROOT)) for path in paths if not path.exists()]
    if missing:
        pytest.skip("尚未生成产物：" + "、".join(missing))


def read_json(path: Path) -> dict:
    require(path)
    return json.loads(path.read_text(encoding="utf-8"))


def relative_error(actual: float, expected: float) -> float:
    if expected == 0:
        return 0.0 if actual == 0 else float("inf")
    return abs(actual - expected) / abs(expected)


@pytest.fixture(scope="session")
def series() -> dict:
    return read_json(TD_DIGEST)


@pytest.fixture(scope="session")
def supply() -> pd.DataFrame:
    require(SUPPLY)
    return pd.read_parquet(SUPPLY)


@pytest.fixture(scope="session")
def request_count() -> int:
    require(REQUESTS)
    return pq.ParquetFile(REQUESTS).metadata.num_rows


def test_annual_mode_sum_matches_total(series):
    annual = series["patronage_thousand_per_day"]["annual"]
    for year, values in annual.items():
        mode_sum = sum(values[mode] for mode in HIGH_LEVEL_MODES)
        assert relative_error(mode_sum, values["Total"]) < 0.005, year


def test_full_year_monthly_means_match_annual_values(series):
    patronage = series["patronage_thousand_per_day"]
    annual, monthly = patronage["annual"], patronage["monthly"]
    full_years = []
    for year in sorted(annual, key=int):
        periods = [period for period in monthly if int(period.split("-")[0]) == int(year)]
        if {int(period.split("-")[1]) for period in periods} != set(range(1, 13)):
            continue
        full_years.append(year)
        for metric, annual_value in annual[year].items():
            mean = sum(monthly[period][metric] for period in periods) / 12
            assert relative_error(mean, annual_value) < 0.02, (year, metric, mean, annual_value)
    if not full_years:
        pytest.skip("月报序列暂无完整的 12 个月年度")


def test_fleet_registered_total_equals_category_sum(series):
    for year, fleet in series["taxi_fleet"]["annual"].items():
        assert fleet["total"]["registered"] == sum(
            fleet[group]["registered"] for group in FLEET_GROUPS
        ), year


def test_fleet_licensed_never_exceeds_registered(series):
    for year, fleet in series["taxi_fleet"]["annual"].items():
        for group in (*FLEET_GROUPS, "total"):
            assert fleet[group]["licensed"] <= fleet[group]["registered"], (year, group)


def test_registered_fleet_quota_is_constant(series):
    annual = series["taxi_fleet"]["annual"]
    assert len({fleet["total"]["registered"] for fleet in annual.values()}) == 1


def test_yearly_field_sets_are_consistent(series):
    patronage = series["patronage_thousand_per_day"]
    annual = patronage["annual"]
    monthly = patronage["monthly"]
    fleet = series["taxi_fleet"]["annual"]
    expected_patronage = set(next(iter(annual.values())))
    for period, values in {**annual, **monthly}.items():
        assert set(values) == expected_patronage, period
    expected_fleet_groups = set(next(iter(fleet.values())))
    expected_fleet_fields = {
        group: set(next(iter(fleet.values()))[group]) for group in expected_fleet_groups
    }
    for year, groups in fleet.items():
        assert set(groups) == expected_fleet_groups, year
        for group in expected_fleet_groups:
            assert set(groups[group]) == expected_fleet_fields[group], (year, group)


def test_supply_has_one_row_for_each_hour(supply):
    assert len(supply) == 24
    assert set(supply["hour"]) == set(range(24))
    assert supply["hour"].is_unique


def test_busy_taxis_equals_vehicle_minutes_divided_by_60(supply):
    error = (supply["busy_taxis"] - supply["veh_min"] / 60).abs()
    assert (error < 1e-6).all(), f"最大绝对误差 {error.max():.9f}"


def test_on_road_fleet_matches_column_occupancy_rate(supply):
    rate_columns = [column for column in supply if re.fullmatch(r"on_road_at_\d+", column)]
    assert rate_columns, "没有 on_road_at_<载客率> 列"
    for column in rate_columns:
        rate = int(column.rsplit("_", 1)[-1]) / 100
        assert 0 < rate <= 1, column
        error = (supply[column] - supply["busy_taxis"] / rate).abs()
        assert (error < 1e-6).all(), f"{column} 最大绝对误差 {error.max():.9f}"


def test_supply_inputs_are_nonnegative(supply):
    assert supply[["veh_km", "veh_min", "requests"]].ge(0).all().all()


def test_hourly_supply_requests_match_request_rows(supply, request_count):
    assert request_count > 0
    assert relative_error(supply["requests"].sum(), request_count) < 0.01


def test_supply_audit_fleet_licensed_equals_category_sum():
    audit = read_json(SUPPLY_AUDIT)
    assert audit["fleet_licensed"] == sum(audit["fleet"].values())


def test_licensed_fleet_matches_across_outputs(series):
    require(SUPPLY_AUDIT, SIMULATION_AUDIT)
    annual = series["taxi_fleet"]["annual"]
    latest = annual[max(annual, key=int)]["total"]["licensed"]
    supply_audit = read_json(SUPPLY_AUDIT)
    simulation_audit = read_json(SIMULATION_AUDIT)
    assert latest == supply_audit["fleet_licensed"] == simulation_audit["fleet"]


def test_taxi_daily_patronage_matches_mode_choice_anchor(series):
    monthly = series["patronage_thousand_per_day"]["monthly"]
    periods = sorted(monthly, key=lambda period: tuple(map(int, period.split("-"))))[-12:]
    assert len(periods) == 12, "运输署月报不足 12 个月"
    td_daily = sum(monthly[period]["Taxis"] for period in periods) * 1000 / 12
    audit = read_json(MODE_CHOICE_AUDIT)
    line = next((line for line in audit["report"] if line.startswith("的士锚定复核：")), None)
    assert line is not None, f"找不到的士锚定复核行；报告原文：{audit['report']}"
    match = re.search(r"运输署\s*([\d,]+(?:\.\d+)?)", line)
    assert match is not None, f"无法从锚定复核行提取运输署值：{line}"
    reported = float(match.group(1).replace(",", ""))
    assert relative_error(reported, td_daily) < 0.001, (line, td_daily)


def test_request_count_matches_audits(request_count):
    require(REQUESTS_AUDIT, SIMULATION_AUDIT)
    requests_audit = read_json(REQUESTS_AUDIT)
    simulation_audit = read_json(SIMULATION_AUDIT)
    assert request_count > 0
    assert relative_error(requests_audit["parquet"]["rows"], request_count) < 0.001
    assert relative_error(simulation_audit["requests"], request_count) < 0.001


def test_corridor_geh_share_matches_diagnosis():
    require(ASSIGNMENT_AUDIT, CORRIDOR_DIAGNOSIS)
    assignment = read_json(ASSIGNMENT_AUDIT)
    corridors = read_json(CORRIDOR_DIAGNOSIS)["by_corridor"]
    stations = sum(row["stations"] for row in corridors)
    assert stations > 0
    recomputed = sum(row["stations"] * row["geh_under_5"] for row in corridors) / stations
    assert abs(recomputed - assignment["corridor_geh_under_5"]) < 0.02
