"""Parse two Transport Department digest tables into reusable JSON time series.

Input : data/raw/td-digest/2606_table21s.xls
            Table 2.1S sheets (a) and (b): annual and monthly average daily
            passenger journeys by public transport operator, in thousands
        data/raw/td-digest/2606_table41a.xls
            Table 4.1(a), sheet (3): annual and monthly taxi registrations/licences
Output: data/model/td-digest-series.json
            all Table 2.1S patronage columns plus annual taxi fleet series
        data/web/td-digest-audit.json
            the six checks required by task-30-td-digest-series.md

Method. Both workbooks are read with ``header=None``. English labels are found by
searching cell contents, repeated sub-total columns are resolved within the ranges
between named operator columns, and the year/month column is found from the
``Year/Month`` label plus month-like values. Annual and monthly rows are then
identified from their contents; no data-row number is fixed in the code. Blank year
cells in the monthly block inherit the latest year. A structural guard checks that
every numeric transport column in each data block has been mapped.

Known limitations. The parser deliberately relies on the English labels published in
the digest. It tolerates footnote-number and whitespace changes, but a renamed or
new operator raises an error instead of being silently omitted. Dash cells are stored
as 0.0; source numeric values are stored as floats without rounding.

Run from the project root:
    .venv\\Scripts\\python.exe pipeline\\30_td_digest_series.py
"""

from __future__ import annotations

import json
import math
import numbers
import re
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "td-digest"
TABLE_21S = RAW / "2606_table21s.xls"
TABLE_41A = RAW / "2606_table41a.xls"
OUTPUT = ROOT / "data" / "model" / "td-digest-series.json"
AUDIT = ROOT / "data" / "web" / "td-digest-audit.json"

SOURCE = "Transport Department, Monthly Traffic and Transport Digest"
EXPECTED_EDITION = "202606"
SOURCE_FILES = [
    "data/raw/td-digest/2606_table21s.xls",
    "data/raw/td-digest/2606_table41a.xls",
]

EXPECTED_TAXI = {
    "2021": 762.328052,
    "2022": 711.112638,
    "2023": 727.947575,
    "2024": 682.645795,
    "2025": 676.105332,
}
EXPECTED_2025_LICENSED = {
    "urban": 14941.0,
    "new_territories": 2679.0,
    "lantau": 75.0,
    "total": 17695.0,
}
HIGH_LEVEL_MODES = [
    "Franchised Buses",
    "Railways",
    "Public Light Buses",
    "Ferries",
    "Taxis",
    "Residents' Services",
    "MTR Buses (Northwest New Territories)",
]


def normalized(value: object) -> str:
    """Normalize a header cell while retaining meaningful English wording."""
    if pd.isna(value):
        return ""
    text = str(value).replace("“", "").replace("”", "").replace('"', "")
    text = re.sub(r"\(\s*\d+\s*\)", "", text)
    text = re.sub(r"\s+", " ", text).strip().casefold()
    return text


def is_number(value: object) -> bool:
    return isinstance(value, numbers.Real) and not isinstance(value, bool) and math.isfinite(float(value))


def integer_like(value: object, low: int, high: int) -> int | None:
    if not is_number(value):
        return None
    number = float(value)
    integer = int(number)
    return integer if number == integer and low <= integer <= high else None


def find_exact_cell(
    frame: pd.DataFrame,
    label: str,
    last_row: int | None = None,
    first_column: int = 0,
    last_column: int | None = None,
) -> tuple[int, int]:
    """Find one normalized exact label in a bounded header region."""
    wanted = normalized(label)
    row_stop = len(frame) if last_row is None else last_row + 1
    column_stop = frame.shape[1] if last_column is None else last_column
    matches = [
        (row, column)
        for row in range(row_stop)
        for column in range(first_column, column_stop)
        if normalized(frame.iat[row, column]) == wanted
    ]
    if len(matches) != 1:
        raise RuntimeError(f"expected one {label!r} cell, found {matches}")
    return matches[0]


def combined_header(frame: pd.DataFrame, column: int, last_row: int) -> str:
    return " ".join(
        part for part in (normalized(frame.iat[row, column]) for row in range(last_row + 1)) if part
    )


def find_combined_column(frame: pd.DataFrame, phrases: tuple[str, ...], last_row: int) -> int:
    """Find a column whose multi-row header contains all requested phrases."""
    wanted = tuple(normalized(phrase) for phrase in phrases)
    matches = [
        column
        for column in range(frame.shape[1])
        if all(phrase in combined_header(frame, column, last_row) for phrase in wanted)
    ]
    if len(matches) != 1:
        raise RuntimeError(f"expected one header column for {phrases}, found {matches}")
    return matches[0]


def find_subtotal_column(frame: pd.DataFrame, first_column: int, last_column: int, last_row: int) -> int:
    _, column = find_exact_cell(
        frame,
        "Sub-total",
        last_row=last_row,
        first_column=first_column,
        last_column=last_column,
    )
    return column


def locate_patronage_columns(frame_a: pd.DataFrame, frame_b: pd.DataFrame) -> tuple[dict[str, int], dict[str, int]]:
    """Locate every passenger-journey value column from English header text."""
    header_a, _ = find_exact_cell(frame_a, "Year/Month")
    header_b, _ = find_exact_cell(frame_b, "Year/Month")

    columns_a = {
        "KMB": find_exact_cell(frame_a, "KMB", header_a)[1],
        "Citybus": find_exact_cell(frame_a, "Citybus", header_a)[1],
        "NWFB": find_exact_cell(frame_a, "NWFB", header_a)[1],
        "LWB": find_exact_cell(frame_a, "LWB", header_a)[1],
        "NLB": find_exact_cell(frame_a, "NLB", header_a)[1],
        "MTR Lines": find_combined_column(frame_a, ("MTR Lines",), header_a),
        "AEL": find_combined_column(frame_a, ("AEL",), header_a),
        "Light Rail": find_combined_column(frame_a, ("Light Rail",), header_a),
        "Hongkong Tramways": find_combined_column(frame_a, ("Hongkong", "Tramways"), header_a),
    }
    columns_a["Franchised Buses"] = find_subtotal_column(
        frame_a, columns_a["KMB"], columns_a["MTR Lines"], header_a
    )
    columns_a["Railways"] = find_subtotal_column(
        frame_a, columns_a["MTR Lines"], frame_a.shape[1], header_a
    )

    columns_b = {
        "GMB": find_exact_cell(frame_b, "GMB", header_b)[1],
        "RMB": find_exact_cell(frame_b, "RMB", header_b)[1],
        "Sun Ferry": find_combined_column(frame_b, ("Sun Ferry",), header_b),
        "Star Ferry": find_combined_column(frame_b, ("Star", "Ferry"), header_b),
        "Other Licensed Ferries": find_combined_column(frame_b, ("Other Licensed", "Ferries"), header_b),
        "Taxis": find_exact_cell(frame_b, "Taxis", header_b)[1],
        "Residents' Services": find_combined_column(frame_b, ("Residents'", "Services"), header_b),
        "MTR Buses (Northwest New Territories)": find_combined_column(
            frame_b, ("MTR Buses", "Northwest New Territories"), header_b
        ),
        "Total": find_exact_cell(frame_b, "Total", header_b)[1],
    }
    columns_b["Public Light Buses"] = find_subtotal_column(
        frame_b, columns_b["GMB"], columns_b["Sun Ferry"], header_b
    )
    columns_b["Ferries"] = find_subtotal_column(
        frame_b, columns_b["Sun Ferry"], columns_b["Taxis"], header_b
    )

    if len(set(columns_a.values())) != len(columns_a) or len(set(columns_b.values())) != len(columns_b):
        raise RuntimeError("two patronage labels resolved to the same value column")
    return columns_a, columns_b


def find_period_columns(frame: pd.DataFrame, first_metric_column: int) -> tuple[int, int, int]:
    """Find the Year/Month header and infer the month column from month-like data."""
    header_row, year_column = find_exact_cell(frame, "Year/Month")
    candidates = range(year_column + 1, first_metric_column)
    scores = {
        column: sum(
            integer_like(frame.iat[row, column], 1, 12) is not None
            for row in range(header_row + 1, len(frame))
        )
        for column in candidates
    }
    if not scores or max(scores.values()) < 12:
        raise RuntimeError("could not infer a month column with at least 12 month values")
    best_score = max(scores.values())
    winners = [column for column, score in scores.items() if score == best_score]
    if len(winners) != 1:
        raise RuntimeError(f"ambiguous month columns: {scores}")
    return header_row, year_column, winners[0]


def period_rows(
    frame: pd.DataFrame,
    value_columns: dict[str, int],
) -> tuple[dict[str, int], dict[str, int], int, int]:
    """Locate annual/monthly data rows, forward-filling years only in the month block."""
    first_metric = min(value_columns.values())
    header_row, year_column, month_column = find_period_columns(frame, first_metric)
    annual: dict[str, int] = {}
    monthly: dict[str, int] = {}
    current_year: int | None = None
    for row in range(header_row + 1, len(frame)):
        row_year = integer_like(frame.iat[row, year_column], 1900, 2100)
        if row_year is not None:
            current_year = row_year
        month = integer_like(frame.iat[row, month_column], 1, 12)
        has_value = any(
            is_number(frame.iat[row, column]) or normalized(frame.iat[row, column]) in {"-", "—"}
            for column in value_columns.values()
        )
        if month is not None and current_year is not None and has_value:
            key = f"{current_year:04d}-{month:02d}"
            if key in monthly:
                raise RuntimeError(f"duplicate monthly row {key}")
            monthly[key] = row
        elif row_year is not None and has_value:
            key = str(row_year)
            if key in annual:
                raise RuntimeError(f"duplicate annual row {key}")
            annual[key] = row
    if not annual or not monthly:
        raise RuntimeError("annual or monthly data block was not found")
    return annual, monthly, year_column, month_column


def value_as_float(value: object, context: str) -> float:
    if is_number(value):
        return float(value)
    if normalized(value) in {"-", "—"}:
        return 0.0
    raise RuntimeError(f"non-numeric value at {context}: {value!r}")


def validate_numeric_coverage(
    frame: pd.DataFrame,
    rows: list[int],
    value_columns: dict[str, int],
    year_column: int,
    month_column: int,
    ignored_columns: set[int] | None = None,
) -> None:
    """Raise if a numeric data column is not represented in the output mapping."""
    ignored = {year_column, month_column} | (ignored_columns or set())
    observed = {
        column
        for column in range(frame.shape[1])
        if column not in ignored and any(is_number(frame.iat[row, column]) for row in rows)
    }
    mapped = set(value_columns.values())
    if observed != mapped:
        raise RuntimeError(
            f"numeric-column coverage mismatch: unmapped={sorted(observed - mapped)}, "
            f"mapped_without_data={sorted(mapped - observed)}"
        )


def parse_patronage_sheet(
    frame: pd.DataFrame,
    columns: dict[str, int],
    ignored_columns: set[int] | None = None,
) -> tuple[dict[str, dict[str, float]], dict[str, dict[str, float]]]:
    annual_rows, monthly_rows, year_column, month_column = period_rows(frame, columns)
    validate_numeric_coverage(
        frame,
        list(annual_rows.values()) + list(monthly_rows.values()),
        columns,
        year_column,
        month_column,
        ignored_columns,
    )

    def parse(rows: dict[str, int]) -> dict[str, dict[str, float]]:
        return {
            period: {
                key: value_as_float(frame.iat[row, column], f"{period}/{key}")
                for key, column in columns.items()
            }
            for period, row in rows.items()
        }

    return parse(annual_rows), parse(monthly_rows)


def merge_periods(
    left: dict[str, dict[str, float]],
    right: dict[str, dict[str, float]],
) -> dict[str, dict[str, float]]:
    if set(left) != set(right):
        raise RuntimeError(f"table halves have different periods: {sorted(left)} vs {sorted(right)}")
    merged: dict[str, dict[str, float]] = {}
    for period in sorted(left):
        overlap = set(left[period]) & set(right[period])
        if overlap:
            raise RuntimeError(f"duplicate patronage fields in {period}: {sorted(overlap)}")
        merged[period] = {**left[period], **right[period]}
    return merged


def locate_fleet_columns(frame: pd.DataFrame) -> dict[str, dict[str, int]]:
    """Locate the four taxi groups and their three value columns by header text."""
    header_row, _ = find_exact_cell(frame, "Year/Month")
    groups = {
        "urban": find_exact_cell(frame, "Urban", header_row)[1],
        "new_territories": find_exact_cell(frame, "New Territories", header_row)[1],
        "lantau": find_exact_cell(frame, "Lantau", header_row)[1],
        "total": find_exact_cell(frame, "Sub-total", header_row)[1],
    }
    ordered = sorted((column, name) for name, column in groups.items())
    fields = {
        "first_registration": "First Registration",
        "registered": "Total Registration",
        "licensed": "Total Licensed",
    }
    result: dict[str, dict[str, int]] = {}
    for position, (start, name) in enumerate(ordered):
        stop = ordered[position + 1][0] if position + 1 < len(ordered) else frame.shape[1]
        result[name] = {
            field: find_exact_cell(
                frame,
                label,
                last_row=header_row,
                first_column=start,
                last_column=stop,
            )[1]
            for field, label in fields.items()
        }
    return result


def parse_taxi_fleet(frame: pd.DataFrame) -> dict[str, dict[str, dict[str, float]]]:
    nested = locate_fleet_columns(frame)
    flat = {
        f"{group}.{field}": column
        for group, fields in nested.items()
        for field, column in fields.items()
    }
    annual_rows, monthly_rows, year_column, month_column = period_rows(frame, flat)
    validate_numeric_coverage(
        frame,
        list(annual_rows.values()) + list(monthly_rows.values()),
        flat,
        year_column,
        month_column,
    )
    return {
        year: {
            group: {
                field: value_as_float(frame.iat[row, column], f"{year}/{group}/{field}")
                for field, column in fields.items()
            }
            for group, fields in nested.items()
        }
        for year, row in annual_rows.items()
    }


def extract_edition(frames: list[pd.DataFrame]) -> str:
    editions = {
        str(int(value))
        for frame in frames
        for value in frame.to_numpy().ravel()
        if integer_like(value, 200001, 209912) is not None
    }
    if editions != {EXPECTED_EDITION}:
        raise RuntimeError(f"unexpected digest edition markers: {sorted(editions)}")
    return next(iter(editions))


def audit_series(series: dict) -> dict:
    annual = series["patronage_thousand_per_day"]["annual"]
    monthly = series["patronage_thousand_per_day"]["monthly"]
    fleet = series["taxi_fleet"]["annual"]

    actual_taxi = {year: annual[year]["Taxis"] for year in EXPECTED_TAXI}
    taxi_pass = all(round(actual_taxi[year], 6) == expected for year, expected in EXPECTED_TAXI.items())

    actual_licensed = {
        group: fleet["2025"][group]["licensed"] for group in EXPECTED_2025_LICENSED
    }
    licensed_pass = actual_licensed == EXPECTED_2025_LICENSED

    mode_sum_checks = {}
    for year, values in annual.items():
        mode_sum = sum(values[mode] for mode in HIGH_LEVEL_MODES)
        total = values["Total"]
        error = abs(mode_sum - total) / total
        mode_sum_checks[year] = {
            "mode_sum": mode_sum,
            "reported_total": total,
            "relative_error": error,
        }
    mode_sum_pass = all(item["relative_error"] < 0.005 for item in mode_sum_checks.values())

    monthly_years: dict[str, list[str]] = {}
    for period in monthly:
        monthly_years.setdefault(period[:4], []).append(period)
    full_years = [
        year
        for year, periods in monthly_years.items()
        if year in annual and {int(period[5:]) for period in periods} == set(range(1, 13))
    ]
    monthly_average_checks = {}
    for year in sorted(full_years):
        periods = sorted(monthly_years[year])
        by_metric = {}
        for metric, annual_value in annual[year].items():
            monthly_mean = sum(monthly[period][metric] for period in periods) / 12
            if annual_value == 0:
                error = 0.0 if monthly_mean == 0 else math.inf
            else:
                error = abs(monthly_mean - annual_value) / abs(annual_value)
            by_metric[metric] = {
                "monthly_arithmetic_mean": monthly_mean,
                "annual": annual_value,
                "relative_error": error,
            }
        monthly_average_checks[year] = by_metric
    monthly_average_pass = bool(monthly_average_checks) and all(
        item["relative_error"] < 0.02
        for by_metric in monthly_average_checks.values()
        for item in by_metric.values()
    )

    registration_values = {
        year: fleet[year]["total"]["registered"] for year in EXPECTED_TAXI
    }
    registration_pass = all(value == 18163.0 for value in registration_values.values())

    annual_count = len(annual)
    monthly_count = len(monthly)
    coverage_pass = annual_count >= 5 and monthly_count >= 12

    check_pass = {
        "1_taxi_annual_2021_2025": taxi_pass,
        "2_taxi_licensed_2025": licensed_pass,
        "3_annual_mode_sum_vs_total": mode_sum_pass,
        "4_monthly_mean_vs_annual": monthly_average_pass,
        "5_total_registration_quota": registration_pass,
        "6_period_coverage": coverage_pass,
    }
    flags = [name for name, passed in check_pass.items() if not passed]

    def outcome(passed: bool) -> str:
        return ("通过" if passed else "未通过") + ("" if passed else "  ← 需复核")

    taxi_actual_text = "、".join(f"{year} {actual_taxi[year]:.6f}" for year in EXPECTED_TAXI)
    taxi_expected_text = "、".join(f"{year} {value:.6f}" for year, value in EXPECTED_TAXI.items())
    licensed_actual_text = "/".join(f"{actual_licensed[group]:.0f}" for group in EXPECTED_2025_LICENSED)
    licensed_expected_text = "/".join(f"{value:.0f}" for value in EXPECTED_2025_LICENSED.values())
    max_mode_error = max(item["relative_error"] for item in mode_sum_checks.values())
    max_monthly_error = max(
        item["relative_error"]
        for by_metric in monthly_average_checks.values()
        for item in by_metric.values()
    ) if monthly_average_checks else math.inf
    registration_text = "、".join(f"{year} {value:.0f}" for year, value in registration_values.items())

    report = [
        f"1. 2021–2025 的士年度值：实测 {taxi_actual_text}；期望 {taxi_expected_text}；"
        f"阈值小数点后 6 位完全相等；{outcome(taxi_pass)}",
        f"2. 2025 的士领牌数（市区/新界/大屿山/合计）：实测 {licensed_actual_text}；"
        f"期望 {licensed_expected_text}；阈值完全相等；{outcome(licensed_pass)}",
        f"3. 年度各方式之和 vs Total：实测 2021–2025 最大相对误差 {max_mode_error:.6%}；"
        f"期望每年 <0.5%；{outcome(mode_sum_pass)}",
        f"4. 完整年度的逐月算术平均 vs 年度值：实测 {','.join(sorted(full_years)) or '无完整年度'} "
        f"最大相对误差 {max_monthly_error:.6%}；期望每年每列 <2%；{outcome(monthly_average_pass)}",
        f"5. 2021–2025 合计登记数：实测 {registration_text}；期望每年 18,163；"
        f"阈值完全相等；{outcome(registration_pass)}",
        f"6. 解析期数：实测年度 {annual_count} 个、月份 {monthly_count} 个；"
        f"期望年度 ≥5、月份 ≥12；{outcome(coverage_pass)}",
    ]

    return {
        "checks": {
            "1_taxi_annual_2021_2025": {
                "actual": actual_taxi,
                "expected": EXPECTED_TAXI,
                "comparison": "equal after rounding source values to 6 decimal places",
                "pass": taxi_pass,
            },
            "2_taxi_licensed_2025": {
                "actual": actual_licensed,
                "expected": EXPECTED_2025_LICENSED,
                "pass": licensed_pass,
            },
            "3_annual_mode_sum_vs_total": {
                "by_year": mode_sum_checks,
                "threshold_exclusive": 0.005,
                "pass": mode_sum_pass,
            },
            "4_monthly_mean_vs_annual": {
                "calculation": "unweighted arithmetic mean of 12 monthly daily averages",
                "full_years": sorted(full_years),
                "by_year_and_metric": monthly_average_checks,
                "threshold_exclusive": 0.02,
                "pass": monthly_average_pass,
            },
            "5_total_registration_quota": {
                "actual": registration_values,
                "expected_each_year": 18163.0,
                "pass": registration_pass,
            },
            "6_period_coverage": {
                "annual_periods": sorted(annual),
                "monthly_periods": sorted(monthly),
                "annual_count": annual_count,
                "monthly_count": monthly_count,
                "minimum_annual": 5,
                "minimum_monthly": 12,
                "pass": coverage_pass,
            },
        },
        "flags": flags,
        "report": report,
    }


def main() -> None:
    frame_a = pd.read_excel(TABLE_21S, sheet_name="T2.1s(a)", header=None)
    frame_b = pd.read_excel(TABLE_21S, sheet_name="T2.1s(b)", header=None)
    fleet_frame = pd.read_excel(TABLE_41A, sheet_name="T4.1a(3)", header=None)

    columns_a, columns_b = locate_patronage_columns(frame_a, frame_b)
    days_column = find_combined_column(frame_b, ("No. of Days", "Year/Month"), find_exact_cell(frame_b, "Year/Month")[0])
    annual_a, monthly_a = parse_patronage_sheet(frame_a, columns_a)
    annual_b, monthly_b = parse_patronage_sheet(frame_b, columns_b, {days_column})
    annual = merge_periods(annual_a, annual_b)
    monthly = merge_periods(monthly_a, monthly_b)
    taxi_fleet = parse_taxi_fleet(fleet_frame)

    series = {
        "source": SOURCE,
        "edition": extract_edition([frame_a, frame_b, fleet_frame]),
        "files": SOURCE_FILES,
        "patronage_thousand_per_day": {
            "unit": "thousand passenger journeys per day, all days",
            "table": "2.1S",
            "annual": annual,
            "monthly": monthly,
        },
        "taxi_fleet": {
            "table": "4.1(a)",
            "annual": taxi_fleet,
        },
    }
    audit = audit_series(series)

    OUTPUT.write_text(json.dumps(series, ensure_ascii=False, indent=1), encoding="utf-8")
    AUDIT.write_text(json.dumps(audit, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"-> {OUTPUT.relative_to(ROOT)}")
    print(f"-> {AUDIT.relative_to(ROOT)}")
    print("运输署月报序列：自查报告")
    for line in audit["report"]:
        print("   " + line)


if __name__ == "__main__":
    main()
