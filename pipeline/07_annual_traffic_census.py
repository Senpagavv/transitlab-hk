"""Parse the Annual Traffic Census into one tidy table of observed road flows.

Input : data/raw/atc/ATC_TRAFFIC_DATA.zip  (Transport Department, Traffic Flow Census)
          one Excel per counting station (S####.xls), screenline and cordon, for 2018-2024
        data/raw/atc/ATC_IRNP.gdb.zip      (station points, 1,694 of them)
Output: data/web/traffic/atc-stations.json  (station, year, direction -> AADT, peak hour flows)
        data/web/traffic/atc-occupancy.json (core stations: each hour's vehicle mix and people per
                                             vehicle, from the "OCC" sheet; plus an AADT-weighted
                                             summary for 08:00-09:00 and the 16 counted hours)

These are the counts the Transport Department itself surveys, and they are what a transport model
is calibrated against: modelled peak-hour flows are compared with "One-way flow at AM/PM peak"
here, and the 11 screenlines give corridor totals.

Each station file holds, per direction: AADT (all day / Mon-Fri / Sat / Sun), the peak hour and
its one-way flow, the share of commercial vehicles and the share of heavy vehicles in each peak
hour ("T - %": medium/heavy goods vehicles and buses - at station 5030 the OCC sheet's goods M&H
10.6% + buses 6.0% against T 15.3% / 17.8%); and per station, the share of the day's two-way
traffic in each hour. With that profile every station gives a two-way 08:00-09:00 flow, not only
those whose peak hour it is.

Run from the project root (about 2 minutes):
    uv run python pipeline/07_annual_traffic_census.py
"""

import io
import json
import re
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
ATC_ZIP = ROOT / "data" / "raw" / "atc" / "ATC_TRAFFIC_DATA.zip"
STATION_GDB = "/vsizip/" + str((ROOT / "data" / "raw" / "atc" / "ATC_IRNP.gdb.zip").as_posix()) + "/ATC_IRNP.gdb"
OUTPUT = ROOT / "data" / "web" / "traffic" / "atc-stations.json"

YEARS = range(2018, 2025)
DIRECTION_ROW = re.compile(r"^(NORTH|SOUTH|EAST|WEST|UP|DOWN)\s*BOUND", re.I)
FIELDS = {  # row label -> output name (Mon-Fri column is the one models are calibrated on)
    "A.A.D.T.": "aadt",
    "AM Peak Hour": "am_peak_hour",
    "One-way flow at AM peak": "am_peak_flow",
    "PM Peak Hour": "pm_peak_hour",
    "One-way flow at PM peak": "pm_peak_flow",
    "Prop.of commercial vehicles": "commercial_pct",
    "T - % (AM)": "am_heavy_pct",  # heavy vehicles (medium/heavy goods, buses) in the AM peak hour
    "T - % (PM)": "pm_heavy_pct",
}
# Section 1's hourly table: hour mid-points 0.5 .. 23.5 in column 9, then the share of the day's
# two-way traffic in that hour for four kinds of day. The labels are only in the chart, not the
# cells; column 11 is Monday-Friday - checked in main() against the peak-hour flows, which it
# reproduces - and column 10 all days.
HOUR_COLUMN, WEEKDAY_COLUMN, ALL_DAYS_COLUMN = 9, 11, 10
# The OCC sheet's ten columns, left to right (checked against its two header rows).
VEHICLE_CLASSES = ["motorcycle", "private_car", "taxi", "private_light_bus", "public_light_bus",
                   "goods_light", "goods_medium_heavy", "non_franchised_bus", "franchised_bus_single",
                   "franchised_bus_double"]
OCCUPANCY = ROOT / "data" / "web" / "traffic" / "atc-occupancy.json"
SUMMARY_BANDS = ["0800-0900", "16 hours"]  # the modelled peak hour, and 07:00-23:00 for the daily mix


def cell(value):
    if pd.isna(value):
        return None
    if isinstance(value, str):
        value = value.strip()
        return None if value in {"", "-"} else value
    return round(float(value), 2) if float(value) % 1 else int(value)


def row_cells(row) -> list:
    """Non-empty cells in order: the workbooks pad with blank columns that move between years."""
    return [v for v in row.tolist() if pd.notna(v) and str(v).strip() != ""]


def parse_station(sheet: pd.DataFrame, year: int, station_hint: int | None = None) -> list[dict]:
    """A station workbook's main sheet -> a record per direction (values run: all-day, Mon-Fri, Sat, Sun)."""

    header = {}
    for _, row in sheet.head(6).iterrows():
        cells = [str(v).strip() for v in row_cells(row)]
        for i, value in enumerate(cells[:-1]):
            if value in ("CORE STATION", "LINK", "ROAD NETWORK", "ROAD TYPE"):
                header[value] = cells[i + 1]

    station = header.get("CORE STATION") or station_hint
    if not station:
        return []

    records, current = [], None
    for _, row in sheet.iterrows():
        cells = row_cells(row)
        if not cells:
            continue
        label = str(cells[0]).strip()
        values = cells[1:]
        if DIRECTION_ROW.match(label):
            current = {
                "station": int(float(station)),
                "year": year,
                "direction": label.title(),
                "link": header.get("LINK"),
                "road_network": header.get("ROAD NETWORK"),
                "road_type": header.get("ROAD TYPE"),
            }
            records.append(current)
            continue
        if not values:
            continue
        if current is None:
            if not any(label.startswith(prefix) for prefix in FIELDS):
                continue
            # Stations counted in one direction only leave the direction row blank.
            current = {
                "station": int(float(station)),
                "year": year,
                "direction": "Unspecified",
                "link": header.get("LINK"),
                "road_network": header.get("ROAD NETWORK"),
                "road_type": header.get("ROAD TYPE"),
            }
            records.append(current)
        for prefix, name in FIELDS.items():
            if not label.startswith(prefix):
                continue
            # Stations surveyed in one direction only leave the second block unlabelled and full of
            # dashes, so never let an empty cell overwrite a value already read.
            weekday = cell(values[1]) if len(values) > 1 else cell(values[0])  # Mon-Fri column
            if weekday is not None:
                current[name] = weekday
            if name == "aadt" and cell(values[0]) is not None:
                current["aadt_allday"] = cell(values[0])
    return [r for r in records if r.get("aadt") or r.get("am_peak_flow")]


def parse_hourly(sheet: pd.DataFrame, year: int, station: int) -> dict | None:
    """Share of the day's two-way traffic in each hour, Monday-Friday and all days (section 1)."""
    weekday, all_days = [None] * 24, [None] * 24
    for _, row in sheet.iterrows():
        if len(row) <= WEEKDAY_COLUMN:
            break
        hour = pd.to_numeric(row.iloc[HOUR_COLUMN], errors="coerce")
        if pd.isna(hour) or hour % 1 != 0.5 or not 0 < hour < 24:
            continue
        values = pd.to_numeric(row.iloc[[ALL_DAYS_COLUMN, WEEKDAY_COLUMN]], errors="coerce")
        if values.notna().all():
            all_days[int(hour)], weekday[int(hour)] = round(float(values.iloc[0]), 3), round(float(values.iloc[1]), 3)
    if any(v is None for v in weekday):
        return None
    return {"station": station, "year": year, "weekday_pct": weekday, "all_days_pct": all_days}


def parse_occupancy(sheet: pd.DataFrame | None, year: int, station: int) -> dict | None:
    """The "OCC" sheet of a core station: each hour's vehicle mix and people per vehicle.

    Rows come in pairs, "Pro" (share of the hour's vehicles, %) and "Ocp" (people per vehicle,
    driver included), for ten vehicle classes, both directions combined; a "16 hours" pair closes
    the sheet. Only core stations have the sheet (136 of 215 in 2024).
    """
    if sheet is None:
        return None
    hours, hour = {}, None
    for _, row in sheet.iterrows():
        cells = row.tolist()
        labels = [i for i, v in enumerate(cells) if isinstance(v, str) and v.strip() in ("Pro", "Ocp")]
        if not labels:
            continue
        at = labels[0]
        kind = cells[at].strip()
        if kind == "Pro":
            hour = str(cells[0]).strip() if pd.notna(cells[0]) else None
        numbers = [float(v) for v in cells[at + 1:] if isinstance(v, (int, float)) and pd.notna(v)]
        if hour is None or len(numbers) < len(VEHICLE_CLASSES):
            continue
        entry = hours.setdefault(hour, {})
        for name, value in zip(VEHICLE_CLASSES, numbers):
            entry.setdefault(name, {})["share_pct" if kind == "Pro" else "occupancy"] = value
    return {"station": station, "year": year, "hours": hours} if hours else None


def occupancy_summary(occupancy: list[dict], records: list[dict]) -> dict:
    """Per year and band: the vehicle mix and people per vehicle over all core stations, each
    weighted by its weekday AADT (both directions)."""
    aadt: dict[tuple[int, int], float] = {}
    for r in records:
        if isinstance(r.get("aadt"), (int, float)):
            key = (r["year"], r["station"])
            aadt[key] = aadt.get(key, 0) + r["aadt"]
    summary: dict = {}
    for sheet in occupancy:
        weight = aadt.get((sheet["year"], sheet["station"]))
        if not weight:
            continue
        for band in SUMMARY_BANDS:
            values = sheet["hours"].get(band)
            if not values or not sum(v.get("share_pct", 0) for v in values.values()):
                continue
            s = summary.setdefault(str(sheet["year"]), {}).setdefault(
                band, {"stations": 0, "vehicles": {c: 0.0 for c in VEHICLE_CLASSES}, "people": {c: 0.0 for c in VEHICLE_CLASSES}})
            s["stations"] += 1
            for c, v in values.items():
                counted = weight * v.get("share_pct", 0) / 100
                s["vehicles"][c] += counted
                s["people"][c] += counted * v.get("occupancy", 0)
    for year in summary.values():
        for band, s in year.items():
            total = sum(s["vehicles"].values())
            year[band] = {"stations": s["stations"],
                          "share": {c: round(v / total, 4) for c, v in s["vehicles"].items()},
                          "occupancy": {c: round(s["people"][c] / v, 3) if v else None for c, v in s["vehicles"].items()}}
    return summary


def station_points() -> dict[int, tuple[float, float]]:
    points = gpd.read_file(STATION_GDB, layer="ATC_STATION_PT", engine="pyogrio").to_crs("EPSG:4326")
    return {
        int(row.ATC_STATION_NO): (round(row.geometry.x, 6), round(row.geometry.y, 6))
        for row in points.itertuples()
        if pd.notna(row.ATC_STATION_NO)
    }


def main() -> None:
    coords = station_points()
    records: list[dict] = []
    occupancy: list[dict] = []
    hourly: list[dict] = []
    outer = zipfile.ZipFile(ATC_ZIP)

    for year in YEARS:
        entry = f"ATC_TRAFFIC_DATA/{year}.zip"
        if entry not in outer.namelist():
            print(f"{year}: not in the archive, skipped")
            continue
        inner = zipfile.ZipFile(io.BytesIO(outer.read(entry)))
        station_files = [n for n in inner.namelist() if re.search(r"/S\d+\.xls$", n)]
        year_records, year_occupancy = [], 0
        for name in station_files:
            hint = int(re.search(r"/S(\d+)\.xls$", name).group(1))
            book = pd.read_excel(io.BytesIO(inner.read(name)), sheet_name=None, header=None)
            main_sheet = next(iter(book.values()))
            year_records.extend(parse_station(main_sheet, year, hint))
            profile = parse_hourly(main_sheet, year, hint)
            if profile:
                hourly.append(profile)
            mix = parse_occupancy(next((f for n, f in book.items() if "OCC" in str(n)), None), year, hint)
            if mix:
                occupancy.append(mix)
                year_occupancy += 1
        records.extend(year_records)
        print(f"{year}: {len(station_files)} station files -> {len(year_records)} direction records, "
              f"{year_occupancy} vehicle-mix sheets", flush=True)

    for record in records:
        lonlat = coords.get(record["station"])
        if lonlat:
            record["lon"], record["lat"] = lonlat

    located = sum(1 for r in records if "lon" in r)
    OUTPUT.write_text(
        json.dumps(
            {
                "source": "Transport Department, Annual Traffic Census (Traffic Flow Census, DATA.GOV.HK)",
                "note": "Figures are Monday-Friday averages; aadt_allday is the all-day average. "
                        "hourly: share of the day's two-way traffic in each hour (weekday = Mon-Fri).",
                "years": [min(r["year"] for r in records), max(r["year"] for r in records)],
                "records": records,
                "hourly": hourly,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    stations = {r["station"] for r in records}
    print(f"\n{len(records)} records, {len(stations)} stations, {located} with coordinates")
    print(f"-> {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size / 1e6:.2f} MB)")
    # The weekday column must turn two-way AADT into the peak hour both directions report.
    profile = {(h["station"], h["year"]): h["weekday_pct"] for h in hourly}
    gaps = []
    for (station, year), group in pd.DataFrame(records).groupby(["station", "year"]):
        hours = group["am_peak_hour"].astype(str)
        if (station, year) not in profile or len(group) != 2 or hours.nunique() != 1:
            continue
        if not re.fullmatch(r"\d{4}-\d{4}", hours.iloc[0]) or group[["aadt", "am_peak_flow"]].isna().any().any():
            continue
        estimate = group["aadt"].sum() * profile[(station, year)][int(hours.iloc[0][:2])] / 100
        gaps.append(abs(estimate / group["am_peak_flow"].sum() - 1))
    gaps = np.array(gaps)
    print(f"hourly profiles: {len(hourly)} station-years; weekday column x two-way AADT gives the two-way AM "
          f"peak flow within 2% at {np.mean(gaps < 0.02):.0%} of {len(gaps)} station-years (median gap "
          f"{np.median(gaps):.1%})" + ("" if np.mean(gaps < 0.02) > 0.9 else "  <- CHECK"))

    summary = occupancy_summary(occupancy, records)
    OCCUPANCY.write_text(json.dumps({
        "source": "Transport Department, Annual Traffic Census - vehicle classification and occupancy (OCC sheet)",
        "note": "share_pct = share of the hour's vehicles; occupancy = people per vehicle, driver included; "
                "both directions combined. summary: stations weighted by weekday AADT (both directions), "
                "so busy roads count for more, as they do in vehicle-kilometres",
        "classes": VEHICLE_CLASSES, "summary": summary, "stations": occupancy,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    newest = max(summary, key=int)
    print(f"-> {OCCUPANCY.relative_to(ROOT)}: {len(occupancy)} station-years")
    for band in SUMMARY_BANDS:
        s = summary[newest][band]
        print(f"   {newest} {band}（{s['stations']} 站，按日均车流加权）：" + "、".join(
            f"{c} {s['share'][c]:.1%}×{s['occupancy'][c]:.2f}人" for c in ("private_car", "taxi", "goods_light", "goods_medium_heavy")))

    latest = [r for r in records if r["year"] == max(r["year"] for r in records) and r.get("aadt")]
    for record in sorted(latest, key=lambda r: -(r["aadt"] or 0))[:5]:
        print(f"  busiest {record['year']}: station {record['station']} {record['direction']} "
              f"AADT {record['aadt']:,} - {(record['link'] or '')[:46]}")


if __name__ == "__main__":
    main()
