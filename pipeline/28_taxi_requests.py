"""Step 4b: expand the 2026 weekday taxi passenger matrices into individual requests for a full day.

Input : data/model/mode-split-2026.npz
            seven daily taxi passenger matrices, production -> attraction, and their zone order
        data/model/parameters-tcs2022.json
            TCS 2022 hourly profiles and peak-hour direction controls
        data/web/traffic/atc-occupancy.json
            Annual Traffic Census hourly taxi shares at core stations
        data/web/traffic/atc-stations.json
            station hourly profiles and weekday AADT, used to build the census reference shape
        data/model/building-trip-ends.parquet
            building coordinates and trip-end weights
        data/model/zone-centres.parquet
            fallback coordinates for the 455 internal zones
        data/model/trip-ends-2026.parquet
            external control-point coordinates and host zones
        data/model/skim-car-freeflow.npz
            shortest-path distance matrix for the mean-trip-distance check
        data/web/am-peak-audit.json
            calibrated 08:00 taxi vehicles and taxi passengers per vehicle
        data/web/mode-choice-audit.json
            calibrated mean taxi trip distance
        data/web/cross-boundary.json
            external-zone connector distance used to extend the 455-zone car skim
Output: data/model/taxi-requests-2026.parquet
            one row per request: id, second of day, origin/destination zone and coordinate,
            purpose, and passenger count
        data/web/taxi-requests-audit.json

Method. For each purpose, the daily matrix is first split across 24 hours by the matching TCS 2022
profile. Before Poisson sampling, the 24 hourly totals are recalibrated to the 2024 Annual Traffic
Census taxi passenger-flow shape: station flow x taxi share x taxi occupancy. This changes hourly
totals while preserving the purpose mix within each hour and the all-purpose daily total. Each
production-attraction cell is then turned into an actual origin-destination expectation by
the direction share for that hour. A Poisson count is drawn for every purpose-hour-zone pair; given
the count, request seconds are sampled uniformly within the hour. This is the standard conditional
construction of a homogeneous Poisson process. Each endpoint is sampled from positive building
``trip_ends`` weights in its zone. For HBW/HBS/HBO the known home endpoint is sampled specifically
from buildings with ``home == True``. Internal zones without usable buildings fall back to the zone
centre; external zones use their control-point coordinate from trip-ends-2026.

Demand scale. The TCS 2022 control in parameters-tcs2022.json is 838,000 weekday taxi boardings,
which is the source of the project's "about 0.84 million" survey figure. Transport Department's
2024 published all-week daily average is 682,000 taxi passengers (also recorded in the project's
2026-09-21 AV/P2P research note). The weekday survey/model can be higher because the scopes differ
and the mode-choice model may include app-hailed trips. DEMAND_SCALE therefore defaults to 1.0:
the script does not silently force the model to the 682,000 control. Because the generated 2026
matrices are versioned project outputs, their live four- and seven-purpose totals are computed and
printed in the audit rather than frozen in this documentation. Change this constant explicitly for
a scenario using another demand basis.

Known limitations.
* 【推断】Only 08:00 home->work and 18:00 work->home direction controls exist. HBW direction shares
  between and around those hours are linearly interpolated on a repeating 24-hour cycle.
* HBS, HBO, NHB and cross-boundary direction rules deliberately follow pipeline/24_peak_hour.py:
  HBS/CBS are production->attraction, HBO is 70% production->attraction, and NHB/CBR/CBV are 50%.
  Applying the school peak assumption all day is weak because no return-hour control is published.
* The TCS profile is based on journey midpoint, used here as request time because no pickup-time
  profile is available. It supplies the within-hour purpose mix, while the ATC-derived shape sets
  each hour's total.
* ATC occupancy has only 07:00-23:00. 【推断】Hours 00:00-07:00 use the 07:00-08:00 taxi share and
  occupancy; 23:00-24:00 uses 22:00-23:00, exactly as required by the second-version task.
* ``flow x share x occupancy`` at count stations is proportional to passenger-km rather than trip
  count. Different hourly mean trip lengths can therefore bias the shape.
* Building weights are generic trip ends, not purpose-specific pickup/drop-off weights. Every
  request has one passenger; shared hires are not modelled.

Run from the project root (typically under one minute):
    uv run python pipeline/28_taxi_requests.py
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "data" / "model"
WEB = ROOT / "data" / "web"
MODE_SPLIT = MODEL / "mode-split-2026.npz"
PARAMETERS = MODEL / "parameters-tcs2022.json"
OCCUPANCY = WEB / "traffic" / "atc-occupancy.json"
STATIONS = WEB / "traffic" / "atc-stations.json"
BUILDINGS = MODEL / "building-trip-ends.parquet"
CENTRES = MODEL / "zone-centres.parquet"
TRIP_ENDS = MODEL / "trip-ends-2026.parquet"
CAR_SKIM = MODEL / "skim-car-freeflow.npz"
AM_PEAK_AUDIT = WEB / "am-peak-audit.json"
MODE_CHOICE_AUDIT = WEB / "mode-choice-audit.json"
CROSS_BOUNDARY = WEB / "cross-boundary.json"

OUTPUT = MODEL / "taxi-requests-2026.parquet"
AUDIT = WEB / "taxi-requests-audit.json"

SEED = 20260923
DEMAND_SCALE = 1.0
CENSUS_YEAR = 2024
MAX_PARQUET_BYTES = 200 * 1024 * 1024
PURPOSES = ["HBW", "HBS", "HBO", "NHB", "CBS", "CBR", "CBV"]
LOCAL_PURPOSES = ["HBW", "HBS", "HBO", "NHB"]  # the four pipeline/23 measures its trip length over
PROFILE_KEY = {
    "HBW": "HBW",
    "HBS": "HBS",
    "HBO": "HBO",
    "NHB": "NHB_EB",
    "CBS": "HBS",
    "CBR": "HBO",
    "CBV": "HBO",
}


def load_inputs() -> tuple[dict, dict[str, np.ndarray], np.ndarray, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Load and validate the model inputs without writing to the project."""
    params = json.loads(PARAMETERS.read_text(encoding="utf-8"))
    with np.load(MODE_SPLIT) as source:
        zones = source["zones"].astype(str)
        matrices = {p: source[f"T_{p}_TAXI"].astype(np.float64) for p in PURPOSES}

    if len(set(zones)) != len(zones):
        raise RuntimeError("mode-split zone ids are not unique")
    for purpose, matrix in matrices.items():
        if matrix.shape != (len(zones), len(zones)):
            raise RuntimeError(f"T_{purpose}_TAXI has shape {matrix.shape}, expected {(len(zones), len(zones))}")
        if not np.isfinite(matrix).all() or (matrix < 0).any():
            raise RuntimeError(f"T_{purpose}_TAXI contains non-finite or negative values")

    buildings = pd.read_parquet(BUILDINGS)
    centres = pd.read_parquet(CENTRES)
    trip_ends = pd.read_parquet(TRIP_ENDS)
    return params, matrices, zones, buildings, centres, trip_ends


def hourly_profiles(params: dict) -> dict[str, np.ndarray]:
    """Return purpose-specific profiles normalized to one over the day."""
    result = {}
    for purpose, key in PROFILE_KEY.items():
        values = np.asarray(params["hourly_profile_pct"][key], dtype=np.float64)
        if values.shape != (24,) or not np.isfinite(values).all() or (values < 0).any() or values.sum() <= 0:
            raise RuntimeError(f"invalid 24-hour profile for {purpose}: {key}")
        result[purpose] = values / values.sum()
    return result


def direction_shares(params: dict, profiles: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """Share of each hour's demand that runs production -> attraction."""
    controls = params["peak_hour_direction_pct"]
    hbw = profiles["HBW"]
    at_0800 = controls["home_to_work_0800"] / 100 * 0.5 / hbw[8]
    at_1800 = 1 - controls["work_to_home_1800"] / 100 * 0.5 / hbw[18]
    if not (0 <= at_0800 <= 1 and 0 <= at_1800 <= 1):
        raise RuntimeError("HBW peak direction controls imply a share outside [0, 1]")

    # 【推断】Linearly interpolate 08:00 -> 18:00, then 18:00 -> next day's 08:00.
    hbw_direction = np.empty(24, dtype=np.float64)
    for hour in range(24):
        if 8 <= hour <= 18:
            hbw_direction[hour] = at_0800 + (at_1800 - at_0800) * (hour - 8) / 10
        elif hour < 8:
            hbw_direction[hour] = at_1800 + (at_0800 - at_1800) * (hour + 6) / 14
        else:
            hbw_direction[hour] = at_1800 + (at_0800 - at_1800) * (hour - 18) / 14

    return {
        "HBW": hbw_direction,
        "HBS": np.ones(24),
        "HBO": np.full(24, 0.70),
        "NHB": np.full(24, 0.50),
        "CBS": np.ones(24),
        "CBR": np.full(24, 0.50),
        "CBV": np.full(24, 0.50),
    }


def endpoint_data(
    zones: np.ndarray,
    buildings: pd.DataFrame,
    centres: pd.DataFrame,
    trip_ends: pd.DataFrame,
) -> tuple[
    list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray] | None],
    list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray] | None],
    np.ndarray,
    np.ndarray,
]:
    """Prepare general/home building CDFs and complete fallback coordinates."""
    zone_index = {zone: i for i, zone in enumerate(zones)}
    valid = (
        buildings["zone"].astype(str).isin(zone_index)
        & buildings["trip_ends"].gt(0)
        & np.isfinite(buildings["trip_ends"])
        & np.isfinite(buildings["lon"])
        & np.isfinite(buildings["lat"])
    )
    usable = buildings.loc[valid, ["zone", "lon", "lat", "trip_ends", "home"]].copy()
    usable["zone"] = usable["zone"].astype(str)

    building_options: list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray] | None] = [None] * len(zones)
    home_options: list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray] | None] = [None] * len(zones)
    for zone, rows in usable.groupby("zone", sort=False):
        weights = rows["trip_ends"].to_numpy(dtype=np.float64)
        cdf = np.cumsum(weights / weights.sum())
        cdf[-1] = 1.0
        building_options[zone_index[zone]] = (
            rows["lon"].to_numpy(dtype=np.float64),
            rows["lat"].to_numpy(dtype=np.float64),
            cdf,
            rows["home"].to_numpy(dtype=bool),
        )
        home_rows = rows.loc[rows["home"]]
        if not home_rows.empty:
            home_weights = home_rows["trip_ends"].to_numpy(dtype=np.float64)
            home_cdf = np.cumsum(home_weights / home_weights.sum())
            home_cdf[-1] = 1.0
            home_options[zone_index[zone]] = (
                home_rows["lon"].to_numpy(dtype=np.float64),
                home_rows["lat"].to_numpy(dtype=np.float64),
                home_cdf,
                np.ones(len(home_rows), dtype=bool),
            )

    fallback = {
        str(row.zone): (float(row.lon), float(row.lat))
        for row in centres.itertuples(index=False)
        if np.isfinite(row.lon) and np.isfinite(row.lat)
    }
    for row in trip_ends.loc[trip_ends["external"]].itertuples(index=False):
        if np.isfinite(row.lon) and np.isfinite(row.lat):
            fallback[str(row.zone)] = (float(row.lon), float(row.lat))
    missing = [zone for zone in zones if zone not in fallback]
    if missing:
        raise RuntimeError(f"zones without a fallback coordinate: {missing}")
    fallback_lon = np.asarray([fallback[z][0] for z in zones], dtype=np.float64)
    fallback_lat = np.asarray([fallback[z][1] for z in zones], dtype=np.float64)
    return building_options, home_options, fallback_lon, fallback_lat


def sample_points(
    indices: np.ndarray,
    prefer_home: np.ndarray,
    rng: np.random.Generator,
    building_options: list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray] | None],
    home_options: list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray] | None],
    fallback_lon: np.ndarray,
    fallback_lat: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Sample coordinates; home endpoints use home buildings when available."""
    lon = fallback_lon[indices].copy()
    lat = fallback_lat[indices].copy()
    on_building = np.zeros(len(indices), dtype=bool)
    on_home_building = np.zeros(len(indices), dtype=bool)
    order = np.argsort(indices, kind="stable")
    sorted_indices = indices[order]
    boundaries = np.flatnonzero(np.diff(sorted_indices)) + 1
    starts = np.r_[0, boundaries]
    stops = np.r_[boundaries, len(indices)]
    for start, stop in zip(starts, stops):
        zone = int(sorted_indices[start])
        zone_positions = order[start:stop]
        for wants_home in (False, True):
            positions = zone_positions[prefer_home[zone_positions] == wants_home]
            if not len(positions):
                continue
            options = home_options[zone] if wants_home and home_options[zone] is not None else building_options[zone]
            if options is None:
                continue
            building_lon, building_lat, cdf, building_home = options
            chosen = np.searchsorted(cdf, rng.random(len(positions)), side="right")
            lon[positions] = building_lon[chosen]
            lat[positions] = building_lat[chosen]
            on_building[positions] = True
            on_home_building[positions] = building_home[chosen]
    return lon, lat, on_building, on_home_building


def generate_requests(
    zones: np.ndarray,
    matrices: dict[str, np.ndarray],
    profiles: dict[str, np.ndarray],
    directions: dict[str, np.ndarray],
    building_options: list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray] | None],
    home_options: list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray] | None],
    fallback_lon: np.ndarray,
    fallback_lat: np.ndarray,
) -> tuple[pd.DataFrame, dict]:
    """Generate one reproducible full-day request table and generation diagnostics."""
    rng = np.random.default_rng(SEED)
    origin_parts: list[np.ndarray] = []
    destination_parts: list[np.ndarray] = []
    time_parts: list[np.ndarray] = []
    purpose_parts: list[np.ndarray] = []
    home_purpose_parts: list[np.ndarray] = []
    home_at_origin_parts: list[np.ndarray] = []

    for purpose_number, purpose in enumerate(PURPOSES):
        daily = matrices[purpose]
        for hour in range(24):
            share = profiles[purpose][hour]
            direction = directions[purpose][hour]
            forward = DEMAND_SCALE * share * direction * daily
            reverse = DEMAND_SCALE * share * (1 - direction) * daily.T
            expectation = forward + reverse
            counts = rng.poisson(expectation)
            rows, columns = np.nonzero(counts)
            if len(rows) == 0:
                continue
            repeats = counts[rows, columns]
            origin = np.repeat(rows, repeats).astype(np.uint16, copy=False)
            destination = np.repeat(columns, repeats).astype(np.uint16, copy=False)
            number = len(origin)
            is_home_purpose = purpose in {"HBW", "HBS", "HBO"}
            if is_home_purpose:
                forward_probability = np.repeat(
                    forward[rows, columns] / expectation[rows, columns], repeats
                )
                home_at_origin = rng.random(number) < forward_probability
            else:
                home_at_origin = np.zeros(number, dtype=bool)
            origin_parts.append(origin)
            destination_parts.append(destination)
            time_parts.append((hour * 3600 + rng.integers(0, 3600, number)).astype(np.int32))
            purpose_parts.append(np.full(number, purpose_number, dtype=np.uint8))
            home_purpose_parts.append(np.full(number, is_home_purpose, dtype=bool))
            home_at_origin_parts.append(home_at_origin)

    origin_index = np.concatenate(origin_parts)
    destination_index = np.concatenate(destination_parts)
    seconds = np.concatenate(time_parts)
    purpose_index = np.concatenate(purpose_parts)
    home_purpose = np.concatenate(home_purpose_parts)
    home_at_origin = np.concatenate(home_at_origin_parts)
    home_at_destination = home_purpose & ~home_at_origin
    origin_lon, origin_lat, origin_building, origin_home_building = sample_points(
        origin_index, home_at_origin, rng, building_options, home_options, fallback_lon, fallback_lat
    )
    destination_lon, destination_lat, destination_building, destination_home_building = sample_points(
        destination_index, home_at_destination, rng, building_options, home_options, fallback_lon, fallback_lat
    )

    chronological = np.argsort(seconds, kind="stable")
    origin_index = origin_index[chronological]
    destination_index = destination_index[chronological]
    seconds = seconds[chronological]
    purpose_index = purpose_index[chronological]
    origin_lon = origin_lon[chronological]
    origin_lat = origin_lat[chronological]
    destination_lon = destination_lon[chronological]
    destination_lat = destination_lat[chronological]
    origin_building = origin_building[chronological]
    destination_building = destination_building[chronological]
    origin_home_building = origin_home_building[chronological]
    destination_home_building = destination_home_building[chronological]
    home_purpose = home_purpose[chronological]
    home_at_origin = home_at_origin[chronological]
    home_at_destination = home_at_destination[chronological]

    requests = pd.DataFrame({
        "request_id": np.arange(1, len(seconds) + 1, dtype=np.int64),
        "time_sec": seconds,
        "origin_zone": pd.Categorical(zones[origin_index], categories=zones.tolist()),
        "origin_lon": origin_lon,
        "origin_lat": origin_lat,
        "destination_zone": pd.Categorical(zones[destination_index], categories=zones.tolist()),
        "destination_lon": destination_lon,
        "destination_lat": destination_lat,
        "purpose": pd.Categorical(np.asarray(PURPOSES)[purpose_index], categories=PURPOSES),
        "passengers": np.ones(len(seconds), dtype=np.uint8),
    })
    internal_zone = ~np.char.startswith(zones.astype(str), "X:")
    origin_centre_fallback = ~origin_building & internal_zone[origin_index]
    destination_centre_fallback = ~destination_building & internal_zone[destination_index]
    home_on_home_building = (
        (home_at_origin & origin_home_building)
        | (home_at_destination & destination_home_building)
    )
    diagnostics = {
        "origin_index": origin_index,
        "destination_index": destination_index,
        "hourly_counts": np.bincount(seconds // 3600, minlength=24),
        "origin_building_count": int(origin_building.sum()),
        "destination_building_count": int(destination_building.sum()),
        "both_buildings_count": int((origin_building & destination_building).sum()),
        "home_endpoint_count": int(home_purpose.sum()),
        "home_on_home_building_count": int(home_on_home_building.sum()),
        "internal_centre_fallback_endpoints": int(
            origin_centre_fallback.sum() + destination_centre_fallback.sum()
        ),
        "requests_with_internal_centre_fallback": int(
            (origin_centre_fallback | destination_centre_fallback).sum()
        ),
    }
    return requests, diagnostics


def census_taxi_hourly_shape() -> dict:
    """Build the required 24-hour ATC taxi passenger-flow shape."""
    stations = json.loads(STATIONS.read_text(encoding="utf-8"))
    occupancy = json.loads(OCCUPANCY.read_text(encoding="utf-8"))
    profile = {
        row["station"]: np.asarray(row["weekday_pct"], dtype=np.float64)
        for row in stations["hourly"]
        if row["year"] == CENSUS_YEAR
    }
    aadt: dict[int, float] = {}
    for row in stations["records"]:
        if row["year"] == CENSUS_YEAR and isinstance(row.get("aadt"), (int, float)):
            aadt[row["station"]] = aadt.get(row["station"], 0.0) + row["aadt"]
    sheets = {
        row["station"]: row for row in occupancy["stations"]
        if row["year"] == CENSUS_YEAR and row["station"] in profile and row["station"] in aadt
    }
    flow = np.zeros(24, dtype=np.float64)
    taxi_share = np.zeros(24, dtype=np.float64)
    taxi_occupancy = np.zeros(24, dtype=np.float64)
    person = np.zeros(24, dtype=np.float64)
    for hour in range(24):
        # Version 2 correction: never use the "16 hours" OCC summary. The task explicitly
        # carries 07:00 values back to 00:00-07:00 and 22:00 values forward to 23:00-24:00.
        source_hour = 7 if hour <= 6 else 22 if hour == 23 else hour
        band = f"{source_hour:02d}00-{source_hour + 1:02d}00"
        weights = np.asarray(
            [aadt[station] * profile[station][hour] / 100 for station in sheets],
            dtype=np.float64,
        )
        shares = np.asarray(
            [sheets[station]["hours"][band]["taxi"]["share_pct"] / 100 for station in sheets],
            dtype=np.float64,
        )
        occupancies = np.asarray(
            [sheets[station]["hours"][band]["taxi"]["occupancy"] for station in sheets],
            dtype=np.float64,
        )
        if weights.sum() <= 0:
            raise RuntimeError(f"zero ATC traffic weight at hour {hour}")
        flow[hour] = weights.sum()
        taxi_share[hour] = np.average(shares, weights=weights)
        taxi_occupancy[hour] = np.average(occupancies, weights=weights)
        person[hour] = flow[hour] * taxi_share[hour] * taxi_occupancy[hour]
    if not sheets or person.sum() <= 0:
        raise RuntimeError("no matched 2024 ATC stations for the taxi hourly reference")
    return {
        "shape": person / person.sum(),
        "flow": flow,
        "taxi_share": taxi_share,
        "taxi_occupancy": taxi_occupancy,
        "person_index": person,
        "matched_stations": len(sheets),
        "assumed_hours": [0, 1, 2, 3, 4, 5, 6, 23],
    }


def recalibrate_hourly_profiles(
    matrices: dict[str, np.ndarray],
    base_profiles: dict[str, np.ndarray],
    census_shape: np.ndarray,
) -> tuple[dict[str, np.ndarray], dict]:
    """Reweight hourly totals to ATC without changing the purpose mix within an hour."""
    totals = {purpose: float(matrices[purpose].sum(dtype=np.float64)) for purpose in PURPOSES}
    tcs_hour = sum(totals[purpose] * base_profiles[purpose] for purpose in PURPOSES)
    factors = np.zeros(24, dtype=np.float64)
    nonzero = tcs_hour > 0
    factors[nonzero] = census_shape[nonzero] * tcs_hour.sum() / tcs_hour[nonzero]
    adjusted = {purpose: base_profiles[purpose] * factors for purpose in PURPOSES}
    adjusted_total = sum(totals[purpose] * adjusted[purpose].sum() for purpose in PURPOSES)
    if not np.isclose(adjusted_total, tcs_hour.sum(), rtol=0, atol=1e-6):
        raise RuntimeError("hourly recalibration did not preserve the all-purpose daily total")
    return adjusted, {
        "tcs_hour": tcs_hour,
        "factors": factors,
        "zero_tcs_hours": np.flatnonzero(~nonzero).astype(int).tolist(),
        "adjusted_expected_hour": census_shape * tcs_hour.sum(),
    }


def baseline_hourly_counts(
    matrices: dict[str, np.ndarray],
    base_profiles: dict[str, np.ndarray],
    directions: dict[str, np.ndarray],
) -> np.ndarray:
    """Reproduce version 1's hourly Poisson counts for the required before/after table."""
    rng = np.random.default_rng(SEED)
    hourly = np.zeros(24, dtype=np.int64)
    for purpose in PURPOSES:
        daily = matrices[purpose]
        for hour in range(24):
            share = base_profiles[purpose][hour]
            direction = directions[purpose][hour]
            expectation = DEMAND_SCALE * share * (direction * daily + (1 - direction) * daily.T)
            counts = rng.poisson(expectation)
            number = int(counts.sum())
            hourly[hour] += number
            if number:
                # Version 1 drew request seconds after every Poisson matrix; advance the same stream.
                rng.integers(0, 3600, number)
    return hourly


def expanded_car_km(zones: np.ndarray, trip_ends: pd.DataFrame) -> tuple[np.ndarray, str]:
    """Extend the 455-zone car-distance skim to the 15 external control points as pipeline/23 does."""
    with np.load(CAR_SKIM) as source:
        key = "km" if "km" in source.files else "distance_km"
        order = source["zones"].astype(str).tolist()
        inner = source[key].astype(np.float64)
    if order != zones[:len(order)].tolist():
        raise RuntimeError("car skim and taxi matrix zone orders differ")
    rows = trip_ends.copy()
    rows["zone"] = rows["zone"].astype(str)
    rows = rows.set_index("zone")
    points = {
        f"X:{row['point']}": row
        for row in json.loads(CROSS_BOUNDARY.read_text(encoding="utf-8"))["control_points"]
    }
    full = np.full((len(zones), len(zones)), np.inf, dtype=np.float64)
    full[:len(order), :len(order)] = inner
    for external_index, zone in enumerate(zones[len(order):], start=len(order)):
        host = order.index(str(rows.at[zone, "host_zone"]))
        extra = float(points[zone]["zone_distance_m"]) / 1000
        full[external_index, :len(order)] = inner[host] + extra
        full[:len(order), external_index] = inner[:, host] + extra
    return full, key


def logical_digest(frame: pd.DataFrame) -> str:
    """Hash ordered logical values and dtypes, independent of Parquet metadata."""
    hashed_rows = pd.util.hash_pandas_object(frame, index=False, categorize=True).to_numpy()
    digest = hashlib.sha256()
    digest.update("|".join(f"{name}:{dtype}" for name, dtype in frame.dtypes.items()).encode("utf-8"))
    digest.update(hashed_rows.tobytes())
    return digest.hexdigest()


def round_list(values: np.ndarray, digits: int = 6) -> list[float]:
    return [round(float(value), digits) for value in values]


def json_default(value: object) -> object:
    """Convert NumPy scalar/array values to standard JSON values."""
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, np.ndarray):
        return value.tolist()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def audit_requests(
    requests: pd.DataFrame,
    diagnostics: dict,
    matrices: dict[str, np.ndarray],
    census: dict,
    recalibration: dict,
    directions: dict[str, np.ndarray],
    am_peak: dict,
    mode_choice: dict,
    car_km: np.ndarray,
    distance_key: str,
    old_hourly: np.ndarray,
    digest_one: str,
    digest_two: str,
    exact_repeat: bool,
    parquet_scope: str,
    parquet_rows: int,
    parquet_bytes: int,
) -> dict:
    """Apply the second-version task's nine checks without substituting any of them."""
    matrix_unscaled = sum(float(matrix.sum(dtype=np.float64)) for matrix in matrices.values())
    matrix_scaled = matrix_unscaled * DEMAND_SCALE
    local_unscaled = sum(float(matrices[p].sum(dtype=np.float64)) for p in ["HBW", "HBS", "HBO", "NHB"])
    request_total = len(requests)

    # 1. Daily request total.
    total_error = abs(request_total - matrix_scaled) / matrix_scaled
    total_pass = total_error < 0.01

    request_hourly = diagnostics["hourly_counts"].astype(np.float64)
    request_shape = request_hourly / request_hourly.sum()
    census_shape = census["shape"]

    # 2. Implied 08:00 taxi vehicles against the calibrated peak-hour audit.
    people_per_vehicle = float(am_peak["people_per_vehicle"]["TAXI"])
    target_peak_vehicles = float(am_peak["vehicles"]["TAXI"])
    implied_peak_vehicles = request_hourly[8] / people_per_vehicle
    peak_vehicle_error = abs(implied_peak_vehicles - target_peak_vehicles) / target_peak_vehicles
    peak_vehicle_pass = peak_vehicle_error < 0.05

    # 3. Every hourly request share against the recalibration target.
    hourly_error = np.abs(request_shape - census_shape) / census_shape
    hourly_pass_by_hour = hourly_error < 0.10
    hourly_pass = bool(hourly_pass_by_hour.all())

    # 4. Internal accounting identity.
    hourly_sum = int(request_hourly.sum())
    hourly_sum_pass = hourly_sum == request_total

    # 5. Request-weighted shortest-path distance, using the same expanded skim as pipeline/23.
    # pipeline/23 measures it over the four home-grown purposes only, so this must too - the
    # cross-boundary legs are much longer and comparing all seven against that target would pass on
    # the strength of two errors cancelling (9.3 km against 8.5, when like for like is 8.5 against 8.5).
    distances = car_km[diagnostics["origin_index"], diagnostics["destination_index"]]
    local = np.isin(requests["purpose"].to_numpy(), LOCAL_PURPOSES)
    finite_distance = np.isfinite(distances) & local
    mean_trip_km = float(distances[finite_distance].mean())
    all_purpose_trip_km = float(distances[np.isfinite(distances)].mean())
    target_trip_km = float(mode_choice["mean_trip_km"]["TAXI"])
    mean_trip_error = abs(mean_trip_km - target_trip_km) / target_trip_km
    mean_trip_pass = mean_trip_error < 0.10

    # 6. Home endpoints of the three home-based purposes.
    home_endpoint_share = (
        diagnostics["home_on_home_building_count"] / diagnostics["home_endpoint_count"]
    )
    home_endpoint_pass = home_endpoint_share > 0.95

    # 7. A request is counted once if either internal endpoint fell back to its zone centre.
    centre_fallback_share = diagnostics["requests_with_internal_centre_fallback"] / request_total
    centre_fallback_pass = centre_fallback_share < 0.02

    # 8. Exact logical equality across independent runs.
    reproducibility_pass = exact_repeat

    # 9. Reporting-only diagnostics. The explicit missing-OCC rule defines the eight hours as
    # 00:00-07:00 (hours 0..6) plus 23:00-24:00 (hour 23).
    same_zone_share = float(
        np.mean(diagnostics["origin_index"] == diagnostics["destination_index"])
    )
    assumed_hours = census["assumed_hours"]
    assumed_hour_counts = {f"{hour:02d}:00": int(request_hourly[hour]) for hour in assumed_hours}

    expected_counts = census_shape * request_total
    hourly_comparison = [
        {
            "hour": hour,
            "before_requests": int(old_hourly[hour]),
            "after_requests": int(request_hourly[hour]),
            "census_required_requests": round(float(expected_counts[hour]), 3),
            "relative_error": round(float(hourly_error[hour]), 6),
            "pass": bool(hourly_pass_by_hour[hour]),
        }
        for hour in range(24)
    ]

    checks = {
        "1_daily_total": total_pass,
        "2_am_peak_vehicles": peak_vehicle_pass,
        "3_hourly_shape": hourly_pass,
        "4_hourly_sum": hourly_sum_pass,
        "5_mean_trip_km": mean_trip_pass,
        "6_home_building": home_endpoint_pass,
        "7_zone_centre_fallback": centre_fallback_pass,
        "8_reproducibility": reproducibility_pass,
    }
    flags = [name for name, passed in checks.items() if not passed]

    def result(passed: bool) -> str:
        return ("通过" if passed else "未通过") + ("" if passed else "  ← 需复核")

    failed_hours = [f"{hour:02d}:00" for hour in range(24) if not hourly_pass_by_hour[hour]]
    report = [
        f"1. 全日请求总数：实测 {request_total:,}，目标 {matrix_scaled:,.1f}，相对误差 {total_error:.3%}；"
        f"阈值 <1%；{result(total_pass)}",
        f"2. 08:00 桶折算车次：实测 {request_hourly[8]:,.0f} / {people_per_vehicle:.3f} = "
        f"{implied_peak_vehicles:,.1f}，目标 {target_peak_vehicles:,.0f}，相对误差 {peak_vehicle_error:.3%}；"
        f"阈值 <5%；{result(peak_vehicle_pass)}",
        f"3. 逐小时请求占比：实测 {int(hourly_pass_by_hour.sum())}/24 小时相对误差 <10%，"
        f"最大 {hourly_error.max():.3%}，未达标 {', '.join(failed_hours) or '无'}；"
        f"阈值每小时 <10%；{result(hourly_pass)}",
        f"4. 24 小时请求数之和：实测 {hourly_sum:,}，全日请求总数 {request_total:,}；"
        f"阈值必须完全相等；{result(hourly_sum_pass)}",
        f"5. 请求加权平均行程距离（本地四目的，与 pipeline/23 同口径）：实测 {mean_trip_km:.3f} 公里，"
        f"目标 {target_trip_km:.3f} 公里，相对误差 {mean_trip_error:.3%}；阈值 <10%；{result(mean_trip_pass)}"
        f"（含跨境七目的为 {all_purpose_trip_km:.3f} 公里，跨境段长得多，仅作参考）",
        f"6. HBW/HBS/HBO 家端落在 home=True 建筑：实测 "
        f"{diagnostics['home_on_home_building_count']:,}/{diagnostics['home_endpoint_count']:,} = "
        f"{home_endpoint_share:.3%}；阈值 >95%；{result(home_endpoint_pass)}",
        f"7. 小区中心兜底请求（不含 15 个口岸）：实测 "
        f"{diagnostics['requests_with_internal_centre_fallback']:,}/{request_total:,} = "
        f"{centre_fallback_share:.3%}；阈值 <2%；{result(centre_fallback_pass)}",
        f"8. 固定种子 {SEED} 两次独立运行：实测 "
        f"{'逐值一致' if exact_repeat else '不一致'}，SHA-256 {digest_one} / {digest_two}；"
        f"阈值必须一致；{result(reproducibility_pass)}",
        f"9. 仅报告：起终点同区请求占比 {same_zone_share:.3%}；阈值无；"
        + "外推影响的 8 个小时请求数 "
        + "、".join(f"{hour} {count:,}" for hour, count in assumed_hour_counts.items()),
        "普查 OCC 缺失时段假设：00:00–06:00 使用 0700-0800，23:00 使用 2200-2300；"
        "受影响小时为 00:00、01:00、02:00、03:00、04:00、05:00、06:00、23:00。",
        '`flow × share × occ` 是"经过普查站的的士乘客人次流"，严格说正比于**人公里**而不是**人次**；',
        "若各小时的平均行程长度不同会有偏差。这里作为时段形状使用，其准确性由第 3、5 两项自查约束。",
        f"TCS 重标定：tcs_hour 为 0 的小时 {len(recalibration['zero_tcs_hours'])} 个"
        f"（{recalibration['zero_tcs_hours'] or '无'}）。",
        "逐小时对照表：小时 | 改前请求数 | 改后请求数 | 普查形状要求请求数 | 相对误差",
    ]
    report.extend(
        f"   {row['hour']:02d}:00 | {row['before_requests']:,} | {row['after_requests']:,} | "
        f"{row['census_required_requests']:,.1f} | {row['relative_error']:.3%}"
        for row in hourly_comparison
    )
    report.append(f"输出：{parquet_scope}，{parquet_rows:,} 行，{parquet_bytes / 1024 / 1024:.1f} MiB")

    return {
        "period": "weekday 00:00-24:00, 2026",
        "seed": SEED,
        "demand_scale": DEMAND_SCALE,
        "matrix_totals": {
            "local_four_purposes_unscaled": round(local_unscaled, 3),
            "seven_purposes_unscaled": round(matrix_unscaled, 3),
            "seven_purposes_scaled": round(matrix_scaled, 3),
            "by_purpose_unscaled": {
                purpose: round(float(matrices[purpose].sum(dtype=np.float64)), 3)
                for purpose in PURPOSES
            },
        },
        "census_hourly_shape": {
            "method": "flow * AADT-and-hourly-flow-weighted taxi share * similarly weighted taxi occupancy",
            "matched_stations": census["matched_stations"],
            "flow": round_list(census["flow"], 3),
            "taxi_share": round_list(census["taxi_share"], 6),
            "taxi_occupancy": round_list(census["taxi_occupancy"], 4),
            "person_index": round_list(census["person_index"], 3),
            "normalized_share": round_list(census_shape, 8),
            "occupancy_assumed_hours": assumed_hours,
        },
        "hourly_recalibration": {
            "tcs_hour_before": round_list(recalibration["tcs_hour"], 3),
            "factor": round_list(recalibration["factors"], 6),
            "expected_after": round_list(recalibration["adjusted_expected_hour"], 3),
            "zero_tcs_hours": recalibration["zero_tcs_hours"],
        },
        "direction_from_production_share": {
            purpose: round_list(values, 4) for purpose, values in directions.items()
        },
        "checks": {
            "1_daily_total": {
                "requests": request_total,
                "matrix_people_scaled": round(matrix_scaled, 3),
                "relative_error": round(float(total_error), 6),
                "threshold_exclusive": 0.01,
                "pass": total_pass,
            },
            "2_am_peak_vehicles": {
                "hour_08_requests": int(request_hourly[8]),
                "people_per_vehicle_TAXI": people_per_vehicle,
                "implied_vehicles": round(float(implied_peak_vehicles), 3),
                "target_vehicles": target_peak_vehicles,
                "relative_error": round(float(peak_vehicle_error), 6),
                "threshold_exclusive": 0.05,
                "pass": peak_vehicle_pass,
            },
            "3_hourly_shape": {
                "request_count": diagnostics["hourly_counts"].astype(int).tolist(),
                "request_share": round_list(request_shape, 8),
                "census_hour_share": round_list(census_shape, 8),
                "relative_error": round_list(hourly_error, 6),
                "pass_by_hour": hourly_pass_by_hour.tolist(),
                "threshold_exclusive": 0.10,
                "pass": hourly_pass,
            },
            "4_hourly_sum": {
                "hourly_sum": hourly_sum,
                "request_total": request_total,
                "pass": hourly_sum_pass,
            },
            "5_mean_trip_km": {
                "scope": "local four purposes, as pipeline/23",
                "mean_trip_km": round(mean_trip_km, 6),
                "all_purpose_trip_km": round(all_purpose_trip_km, 6),
                "target_trip_km": target_trip_km,
                "relative_error": round(mean_trip_error, 6),
                "finite_request_share": round(float(finite_distance.mean()), 6),
                "skim_array": distance_key,
                "threshold_exclusive": 0.10,
                "pass": mean_trip_pass,
            },
            "6_home_building": {
                "home_endpoints_on_home_buildings": diagnostics["home_on_home_building_count"],
                "home_endpoints": diagnostics["home_endpoint_count"],
                "share": round(home_endpoint_share, 6),
                "threshold_exclusive_lower": 0.95,
                "pass": home_endpoint_pass,
            },
            "7_zone_centre_fallback": {
                "requests_with_internal_zone_centre_fallback": diagnostics["requests_with_internal_centre_fallback"],
                "request_total": request_total,
                "request_share": round(centre_fallback_share, 6),
                "internal_zone_centre_fallback_endpoints": diagnostics["internal_centre_fallback_endpoints"],
                "threshold_exclusive": 0.02,
                "pass": centre_fallback_pass,
            },
            "8_reproducibility": {
                "logical_sha256_run_1": digest_one,
                "logical_sha256_run_2": digest_two,
                "dataframe_exact_equality": exact_repeat,
                "pass": reproducibility_pass,
            },
            "9_reporting_only": {
                "same_zone_request_share": round(same_zone_share, 6),
                "assumed_hour_request_count": assumed_hour_counts,
                "threshold": None,
            },
        },
        "hourly_comparison": hourly_comparison,
        "parquet": {
            "scope": parquet_scope,
            "rows": parquet_rows,
            "bytes": parquet_bytes,
            "limit_bytes": MAX_PARQUET_BYTES,
        },
        "assumptions": [
            "【推断】HBW 方向在 08:00 与 18:00 控制点之间及跨午夜按 24 小时循环线性插值。",
            "HBS/CBS 全天按产生端到吸引端；HBO 70%；NHB/CBR/CBV 50%，沿用 pipeline/24_peak_hour.py。",
            "OCC 00:00-07:00 使用 07:00-08:00 的士占比与载客人数；23:00-24:00 使用 22:00-23:00。",
            "flow × share × occ 作为小时形状，严格口径更接近人公里而非人次。",
            "家端按 home=True 建筑的 trip_ends 权重抽样；其他端点沿用全部建筑的 trip_ends 权重。",
            "每个请求一名乘客；没有把多人合乘折成一张订单。",
        ],
        "task_interpretations": [
            "任务表第 9 条写“00:00–06:00 八个小时”；按前文明确的 OCC 缺失规则，报告小时 0–6 加 23，共八个。",
        ],
        "deviations_from_task": [
            "除逐小时重标定外，还把 HBW/HBS/HBO 的已知家端限定为按 trip_ends 权重抽取 home=True 建筑；"
            "上一版使用通用建筑池，无法正确实现本版第 6 项验收。"
        ],
        "flags": flags,
        "report": report,
    }


def main() -> None:
    if DEMAND_SCALE <= 0:
        raise RuntimeError("DEMAND_SCALE must be positive")
    params, matrices, zones, buildings, centres, trip_ends = load_inputs()
    base_profiles = hourly_profiles(params)
    directions = direction_shares(params, base_profiles)
    census = census_taxi_hourly_shape()
    profiles, recalibration = recalibrate_hourly_profiles(
        matrices, base_profiles, census["shape"]
    )
    old_hourly = baseline_hourly_counts(matrices, base_profiles, directions)
    building_options, home_options, fallback_lon, fallback_lat = endpoint_data(
        zones, buildings, centres, trip_ends
    )
    car_km, distance_key = expanded_car_km(zones, trip_ends)
    am_peak = json.loads(AM_PEAK_AUDIT.read_text(encoding="utf-8"))
    mode_choice = json.loads(MODE_CHOICE_AUDIT.read_text(encoding="utf-8"))

    requests, diagnostics = generate_requests(
        zones, matrices, profiles, directions, building_options, home_options,
        fallback_lon, fallback_lat
    )
    digest_one = logical_digest(requests)
    repeated, repeated_diagnostics = generate_requests(
        zones, matrices, profiles, directions, building_options, home_options,
        fallback_lon, fallback_lat
    )
    digest_two = logical_digest(repeated)
    exact_repeat = (
        requests.equals(repeated)
        and digest_one == digest_two
        and all(
            np.array_equal(diagnostics[key], repeated_diagnostics[key])
            for key in ["origin_index", "destination_index", "hourly_counts"]
        )
        and all(
            diagnostics[key] == repeated_diagnostics[key]
            for key in diagnostics
            if key not in {"origin_index", "destination_index", "hourly_counts"}
        )
    )
    del repeated, repeated_diagnostics

    requests.to_parquet(OUTPUT, index=False, compression="zstd")
    parquet_scope = "全天 00:00-24:00"
    written_rows = len(requests)
    if OUTPUT.stat().st_size > MAX_PARQUET_BYTES:
        written = requests.loc[requests["time_sec"] >= 6 * 3600]
        written.to_parquet(OUTPUT, index=False, compression="zstd")
        parquet_scope = "06:00-24:00（全天文件超过 200 MiB，按任务要求截取）"
        written_rows = len(written)
    parquet_bytes = OUTPUT.stat().st_size

    audit = audit_requests(
        requests=requests,
        diagnostics=diagnostics,
        matrices=matrices,
        census=census,
        recalibration=recalibration,
        directions=directions,
        am_peak=am_peak,
        mode_choice=mode_choice,
        car_km=car_km,
        distance_key=distance_key,
        old_hourly=old_hourly,
        digest_one=digest_one,
        digest_two=digest_two,
        exact_repeat=exact_repeat,
        parquet_scope=parquet_scope,
        parquet_rows=written_rows,
        parquet_bytes=parquet_bytes,
    )
    AUDIT.write_text(
        json.dumps(audit, ensure_ascii=False, indent=1, default=json_default),
        encoding="utf-8",
    )

    terminal_lines = [
        f"-> {OUTPUT}",
        f"-> {AUDIT}",
        "全天的士叫车需求生成器：自查报告",
        *("   " + line for line in audit["report"]),
    ]
    print("\n".join(terminal_lines))


if __name__ == "__main__":
    main()
