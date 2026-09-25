"""Read the behavioural parameters the model needs out of the Travel Characteristics Survey 2022.

Input : data/raw/tcs/tcs2022_eng.pdf   Transport Department, Travel Characteristics Survey 2022 -
                                       Final Report (2025 version), downloaded 2026-09-18 from
        https://www.td.gov.hk/filemanager/en/content_5349/tcs2022_eng.pdf
Output: data/model/parameters-tcs2022.json   every value with the table and page it came from
        data/web/tcs-parameters-audit.json

TCS 2022 is the household survey the government's own Comprehensive Transport Study model is
calibrated on. Its raw database is not public; these published tables are what there is:

  Table 3.3  trip rates by purpose           -> trip generation
  Table E.2  weekday mechanised trips         -> control totals for generation (12.36 million)
  3.3.11-13  mean journey time, overall, by mode and by purpose   -> calibrating trip distribution
  Table 3.4  trips between Hong Kong Island, Kowloon and the NT   -> checking trip distribution
  Table 3.5  share of trips that stay within each main area      -> checking trip distribution
  Table 3.6  boardings by mode                -> the mode-choice calibration target
  Table E.6  behavioural value of time        -> turns tolls and fares into minutes
  Table 4.2  private vehicle availability     -> which households can choose to drive
  Table 5.1  maximum acceptable waiting time  -> a check on the transit skim's waiting

and from the appendix volume (tcs2022app_eng.pdf), by the 26 broad districts of its Figure A.1:

  Table A.1  households, population, resident workers and students  -> district trip rates
  Table A.2  trip productions and attractions by purpose              -> where trips end
  Table A.3  daily boardings by mode and purpose                      -> mode choice targets
  Table A.4  households with a private vehicle, by district           -> car availability

Numbers are parsed from the report's own text rather than typed in, and the parts are checked
against the report's totals, so a misread shows up as a failure. Table E.6 comes out of the PDF with
its columns interleaved, so its values are written here with their page and each one is checked to
be present in that page's text.

  E.2.19     mean walk between a trip end and the mechanised mode (5 min)  -> the walk end of a car trip
  Table 5.2  who would switch mode if their trip took 15/30/45 min longer   -> how sensitive mode choice is
  Figure 3.3 share of the day's trips in each hour, by purpose             -> the peak hour of a daily matrix
  3.3.8-9    share of home-to-work / home-to-school trips in their peak hour -> which way peak trips run

Figure 3.3 is a chart with no table behind it in the report, but the PDF keeps it as vector drawing:
each purpose is a filled area whose top edge passes through the 24 hourly values, stacked. The
values are read from those coordinates against the chart's own gridlines (2% to 14%), so they are
the plotted numbers rather than a reading by eye.

What the report does not give: a walking speed. The Transport Planning and Design Manual (Volume 6,
10.4.2.2) treats 300-500 m and 10-15 minutes as the same walking regime, i.e. 2-3 km/h measured in a
straight line; the walking network (pipeline/18) gives a median of 2.8 km/h on that measure.

"Mechanised" trips leave out trips made entirely on foot; walking has to be handled separately.

Run from the project root (a few seconds):
    uv run python pipeline/20_behaviour_parameters.py
"""

import ctypes
import json
import re
from pathlib import Path

import pypdfium2
import pypdfium2.raw as pdfium_raw
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / "data" / "raw" / "tcs" / "tcs2022_eng.pdf"
APPENDIX = ROOT / "data" / "raw" / "tcs" / "tcs2022app_eng.pdf"
OUTPUT = ROOT / "data" / "model" / "parameters-tcs2022.json"
AUDIT = ROOT / "data" / "web" / "tcs-parameters-audit.json"

PURPOSES = {
    "HBW": "Home-Based Work (HBW)",
    "HBS": "Home-Based School (HBS)",
    "HBO": "Home-Based Others (HBO)",
    "NHB_EB": "Non-Home Based (NHB) +\nEmployers’ Business (EB)",
}
RATES = {
    "HBW": ("HBW Trips per employed person", "employed person"),
    "HBS": ("HBS Trips per student", "student"),
    "HBO": ("HBO Trips per person", "person"),
    "NHB_EB": ("NHB+EB Trips per person", "person"),
}
BOARDING_MODES = ["Rail", "MTR", "LRT", "Franchised Bus", "PLB", "Private Vehicle", "SPB", "Taxi", "Tram", "Ferry"]
# Table E.6, cents per minute at 2022 prices (page E-9). Checked against the page text below.
VALUE_OF_TIME = {
    "pv_available": {"HBW": 132, "HBS": 103, "HBO_NHB": 101, "all": 113},
    "no_pv": {"HBW": 87, "HBS": 68, "HBO_NHB": 79, "all": 82},
    "overall": 90,
}
HOUSING = {"public_rental": "Public Rental Housing", "subsidised_sale": "Subsidised Sale Housing",
           "private": "Private Housing"}
WAITING = {"taxi": "Taxi", "light_bus": "Public Light Bus", "franchised_bus": "Franchised Bus",
           "rail_tram": "Rail (MTR/LRT) and Tram", "ferry": "Ferry"}
# Figure A.1, in the report's order, with the spellings the two tables use.
BROAD_DISTRICTS = {
    "Central & Western": r"Central & Western", "Wan Chai": r"Wan Chai", "Eastern": r"Eastern",
    "Southern": r"Southern", "Yau Ma Tei": r"Yau Ma Tei", "Mong Kok": r"Mong Kok",
    "Sham Shui Po": r"Sham Shui Po", "Kowloon City": r"Kowloon City", "Kwun Tong": r"Kwun Tong",
    "Wong Tai Sin": r"Wong Tai Sin", "Tsuen Wan": r"Tsuen Wan", "Kwai Chung": r"Kwai Chung",
    "Tsing Yi": r"Tsing Yi", "Tuen Mun": r"Tuen Mun", "Yuen Long": r"Yuen Long",
    "Tin Shui Wai": r"Tin Shui Wai", "Tai Po": r"Tai Po", "Fanling/Sheung Shui": r"Fanling/ ?Sheung Shui",
    "Sha Tin": r"Sha Tin", "Ma On Shan": r"Ma On Shan", "Tseung Kwan O": r"Ts(?:eu|ue)ng Kwan O",
    "North Lantau": r"North Lantau", "NWNT": r"NWNT \(Other Area\)", "NENT": r"NENT \(Other Area\)",
    "SENT": r"SENT \(Other Area\)", "SWNT": r"SWNT \(Other Area\)",
}
SUBTOTALS = {  # Table A.1's subtotal rows and the districts under each
    "Subtotal - Hong Kong Island": list(BROAD_DISTRICTS)[:4],
    "Subtotal - Kowloon": list(BROAD_DISTRICTS)[4:10],
    "Subtotal - New Towns": list(BROAD_DISTRICTS)[10:22],
    "Subtotal - NT (Other Area)": list(BROAD_DISTRICTS)[22:],
    "Territory Total": list(BROAD_DISTRICTS),
}
MOVEMENTS = ["within_hong_kong_island", "cross_harbour", "within_kowloon", "kowloon_nt", "within_nt"]
MAIN_AREAS = ["Hong Kong Island", "Kowloon", "Tsuen Wan/Kwai Tsing", "Tuen Mun", "Yuen Long/Tin Shui Wai",
              "Fanling/Sheung Shui", "Tai Po", "Sha Tin/Ma On Shan", "Tseung Kwan O", "North Lantau"]
# Sentences of section 3.3 that carry journey times; the text breaks words across lines ("w as").
JOURNEY_TIMES = {
    "all": r"mean journey time was estimated to be (\d+) minutes",
    "private_vehicle_taxi": r"private vehicle/taxi trips was (\d+) minutes",
    "public_transport": r"public transport \(excluding taxi\) trips w ?as (\d+) minutes",
    "HBW": r"HBW trips on average took the longest journey time with a mean of (\d+) minutes",
    "HBS": r"HBS trips with a mean journey time of (\d+) minutes",
    "HBO_NHB": r"other purposes generally had a shorter journey time with a mean of about (\d+) minutes",
}
DURATION_SHARES = (r"about half \((\d+)%\) of the mechanised trips were completed within half an hour, ?(\d+)% ?"
                   r"took ?between half an hour and one hour, while the remaining (\d+)% exceeded one hour")
PROFILE_COLOURS = {(152, 27, 30): "HBW", (162, 218, 219): "HBS", (163, 147, 131): "HBO", (24, 54, 93): "NHB_EB"}
GRIDLINE_COLOUR = (191, 191, 191)
A1_FIELDS = ["households", "population", "workers", "students"]
A2_FIELDS = [f"{purpose}_{end}" for purpose in ("HBW", "HBS", "HBO", "NHB_EB", "all") for end in ("prod", "att")]


def pages(pdf: Path = PDF) -> list[str]:
    return [page.extract_text() for page in PdfReader(pdf).pages]


def split_numbers(text: str, count: int, fits) -> list[float]:
    """Read `count` numbers printed with a space for the thousands separator ("1 048 739" is 1048, 739).

    Every way of grouping the digits is tried, and the one grouping the table's own totals agree
    with is kept - more than one, or none, is an error rather than a guess.
    """
    tokens = text.split()

    def ways(start: int, left: int):
        if left == 0:
            if start == len(tokens):
                yield []
            return
        for take in (1, 2, 3):  # a number is 1-3 digits, then up to two groups of exactly 3
            part = tokens[start:start + take]
            if len(part) < take or (take > 1 and (len(part[0]) > 3 or any(len(t) != 3 for t in part[1:]))):
                break
            if part[0].startswith("0") and part[0] != "0":
                break
            for rest in ways(start + take, left - 1):
                yield [float("".join(part))] + rest

    readings = [way for way in ways(0, count) if fits(way)]
    if len(readings) != 1:
        raise RuntimeError(f"{len(readings)} readings of '{text}'")
    return readings[0]


def row(body: str, label: str, next_labels: str) -> str:
    """The text of one table row: everything between its label and the next row's label."""
    match = re.search(rf"\n{label} (.+?)\n(?:{next_labels})", body + "\n", flags=re.S)
    if not match:
        raise RuntimeError(f"row '{label}' not found")
    return match.group(1)


def broad_district_tables(report: list[str]) -> dict:
    """Tables A.1 and A.2 of the appendix, by broad district, checked against their own totals."""
    text = pages(APPENDIX)
    flagged = len(report)
    patterns = {**BROAD_DISTRICTS, **{name: re.escape(name) for name in SUBTOTALS}}
    anything = "|".join(patterns.values()) + "|Notes|Page|$"
    page, body = page_with(text, "Table A.1 Key Demographic Characteristics by Broad District")
    within = lambda w: w[1] > w[0] and w[1] > w[2] > w[3] and 1.5 < w[1] / w[0] < 5 and all(v % 100 == 0 for v in w)
    a1 = {name: dict(zip(A1_FIELDS, split_numbers(row(body, pattern, anything), 4, within)))
          for name, pattern in patterns.items()}
    for total, members in SUBTOTALS.items():
        for field in A1_FIELDS:
            gap = abs(sum(a1[m][field] for m in members) - a1[total][field])
            if gap > 100 * len(members):  # each figure is rounded to the hundred
                report.append(f"表 A.1 {total} {field}：各区相加差 {gap:,.0f}  ← 需复核")

    page2, body2 = page_with(text, "Table A.2 Daily Person Trip Productions and Attractions by Broad District")

    def balanced(w):  # the four purposes add up to "all purposes", at each end, within rounding
        return all(abs(sum(w[2 * k + end] for k in range(4)) - w[8 + end]) <= 2 for end in (0, 1))

    a2 = {name: dict(zip(A2_FIELDS, (v * 1000 for v in split_numbers(row(body2, pattern, anything), 10, balanced))))
          for name, pattern in {**BROAD_DISTRICTS, "Territory Total": "Territory Total"}.items()}
    for field in A2_FIELDS:
        gap = abs(sum(a2[m][field] for m in BROAD_DISTRICTS) - a2["Territory Total"][field])
        if gap > 1000 * len(BROAD_DISTRICTS) / 2:
            report.append(f"表 A.2 {field}：26 区相加差 {gap:,.0f}  ← 需复核")

    # Table A.4: households with a private vehicle (car or motorcycle) available, by district.
    page4, body4 = page_with(text, "Table A.4 Proportion of Households with Private Vehicles Available")
    a4 = {}
    for name, pattern in {**BROAD_DISTRICTS, "Territory Total": "Territory Total"}.items():
        match = re.search(rf"\n{pattern} ((?:[\d.]+% ){{7}}[\d.]+%)", body4)
        if not match:
            raise RuntimeError(f"Table A.4: row '{name}' not found")
        values = [float(v) for v in re.findall(r"([\d.]+)%", match.group(1))]
        car, motorcycle, total = values[3], values[6], values[7]
        # A household with both a car and a motorcycle counts once in the total.
        if not max(car, motorcycle) - 0.15 <= total <= car + motorcycle + 0.15:
            report.append(f"表 A.4 {name}：合计 {total}% 不在私家车 {car}% 与两者之和 {car + motorcycle:.1f}% 之间  ← 需复核")
        a4[name] = {"pv_available_pct": total, "car_available_pct": car}
    report.append(f"有车家庭（附录 A.4，第 {page4} 页）：26 区 {min(v['pv_available_pct'] for k, v in a4.items() if k != 'Territory Total')}%"
                  f"–{max(v['pv_available_pct'] for k, v in a4.items() if k != 'Territory Total')}%，全港 {a4['Territory Total']['pv_available_pct']}%")

    districts = {name: {**a1[name], **a2[name], **a4[name]} for name in BROAD_DISTRICTS}
    problems = [line for line in report[flagged:] if "需复核" in line]
    checked = "均与小计、总计核对通过" if not problems else "有项目与合计不符（见上）"
    report.append(f"分区表（附录 A.1、A.2、A.4，第 {page}、{page2}、{page4} 页）：26 区的住户、人口、就业、学生、有车家庭与各目的出行"
                  f"产生/吸引{checked}；各区每名就业者上班出行 "
                  f"{min(d['HBW_prod'] / d['workers'] for d in districts.values()):.2f}–"
                  f"{max(d['HBW_prod'] / d['workers'] for d in districts.values()):.2f}（全港 1.36）")
    return {"districts": districts,
            "territory": {**a1["Territory Total"], **a2["Territory Total"], **a4["Territory Total"]},
            "tables": "A.1, A.2, A.4", "pages": [page, page2, page4], "source": APPENDIX.name}


def boardings_by_purpose(report: list[str]) -> dict:
    """Table A.3: daily boardings ('000) by mode and purpose, checked against its own totals."""
    text = pages(APPENDIX)
    page, body = page_with(text, "Table A.3 Number of Daily Boardings by Transport Mode and Trip Purpose")
    modes = ["MTR", "LRT", "Tram", "Ferry", "PLB", "Franchised Bus", "Private Vehicle", "Taxi", "SPB", "Total"]
    adds_up = lambda w: abs(sum(w[:4]) - w[4]) <= 2
    table = {}
    for mode in modes:
        match = re.search(rf"\n{re.escape(mode)} ([\d ]+)\n", body + "\n")
        if not match:
            raise RuntimeError(f"Table A.3: row '{mode}' not found")
        values = split_numbers(match.group(1), 5, adds_up)
        table[mode] = dict(zip(["HBW", "HBS", "HBO", "NHB_EB", "all"], (v * 1000 for v in values)))
    columns_ok = all(abs(sum(table[m][c] for m in modes[:-1]) - table["Total"][c]) <= 5000
                     for c in ["HBW", "HBS", "HBO", "NHB_EB", "all"])
    report.append(f"乘车次数（附录 A.3，第 {page} 页）：全日 {table['Total']['all'] / 1e6:.2f} 百万次；"
                  f"私家车 {table['Private Vehicle']['all'] / 1e3:,.0f} 千、的士 {table['Taxi']['all'] / 1e3:,.0f} 千、"
                  f"校车等 {table['SPB']['all'] / 1e3:,.0f} 千（上学出行的 {table['SPB']['HBS'] / table['Total']['HBS']:.0%}）；"
                  + ("行列合计核对通过" if columns_ok else "列合计不符  ← 需复核"))
    return {**table, "unit": "boardings per weekday", "table": "A.3", "page": page, "source": APPENDIX.name}


def journeys(text: list[str], trips: dict, report: list[str]) -> dict:
    """How long trips take and where they go: the targets trip distribution is calibrated to."""
    page, body = page_with(text, "Table 3.4 Major Trip Movements of Mechanised Trips")
    flat = re.sub(r"\s+", " ", body)
    times = {}
    for key, pattern in JOURNEY_TIMES.items():
        match = re.search(pattern, flat)
        if not match:
            raise RuntimeError(f"journey time '{key}' not found on page {page}")
        times[key] = int(match.group(1))
    shares = [int(v) for v in re.search(DURATION_SHARES, flat).groups()]

    table = flat.split("Table 3.4 Major Trip Movements of Mechanised Trips")[1].split("3.3.15")[0]
    rows = re.findall(r"(\d{1,2} \d{3}|\d{1,3}) (\d+)% (-?\d+)%", table)
    if len(rows) != len(MOVEMENTS) + 1:
        raise RuntimeError(f"Table 3.4: expected {len(MOVEMENTS) + 1} rows, read {len(rows)}")
    movements = {key: number(count) * 1000 for key, (count, _, _) in zip(MOVEMENTS, rows)}
    total = number(rows[-1][0]) * 1000

    page35, body35 = page_with(text, "Table 3.5 Comparison of the Degree of Self-Containment by")
    contained = {}
    for area in MAIN_AREAS:
        match = re.search(rf"\n{re.escape(area)} (\d+)% (\d+)%", body35)
        if not match:
            raise RuntimeError(f"Table 3.5: '{area}' not found")
        contained[area] = int(match.group(2))

    adds_up = abs(sum(movements.values()) - total) <= 3000 and abs(total - sum(trips.values())) < 1000
    report.append(f"出行时间（3.3.11–13，第 {page} 页）：全部 {times['all']} 分钟（私家车/的士 {times['private_vehicle_taxi']}、"
                  f"公共交通 {times['public_transport']}）；上班 {times['HBW']}、上学 {times['HBS']}、其他 {times['HBO_NHB']}；"
                  f"30 分钟内 {shares[0]}%、30–60 分钟 {shares[1]}%、超过 1 小时 {shares[2]}%"
                  + ("" if abs(sum(shares) - 100) <= 2 else "  ← 三段相加不是 100%，需复核"))
    report.append(f"地域间出行（表 3.4）：港岛内 {movements['within_hong_kong_island'] / 1e6:.2f} 百万、过海 "
                  f"{movements['cross_harbour'] / 1e6:.2f}、九龙内 {movements['within_kowloon'] / 1e6:.2f}、九龙↔新界 "
                  f"{movements['kowloon_nt'] / 1e6:.2f}、新界内 {movements['within_nt'] / 1e6:.2f}"
                  + ("，相加等于总计与表 3.3" if adds_up else "  ← 与总计不符，需复核"))
    report.append(f"自给率（表 3.5，第 {page35} 页）：" + "、".join(f"{a} {v}%" for a, v in contained.items()))
    return {
        "mean_journey_time_min": {**times, "section": "3.3.11-3.3.13", "page": page},
        "journey_time_shares_pct": {"up_to_30": shares[0], "30_to_60": shares[1], "over_60": shares[2], "page": page},
        "regional_movements": {**movements, "total": total, "table": "3.4", "page": page,
                               "note": "cross_harbour is every trip between Hong Kong Island and the rest: "
                                       "the five rows add up to the territory total"},
        "self_containment_pct": {**contained, "table": "3.5", "page": page35,
                                 "definition": "intra-area trips as a share of all trips to or from the area; "
                                               "main areas as defined in TCS 2011"},
    }


def page_with(text: list[str], heading: str) -> tuple[int, str]:
    """The last page carrying a table heading (the first hit is usually the list of tables)."""
    hits = [i for i, page in enumerate(text) if heading in page]
    if not hits:
        raise RuntimeError(f"'{heading}' not found in the report")
    return hits[-1] + 1, text[hits[-1]]


def number(value: str) -> float:
    return float(value.replace(" ", ""))


def path_points(obj) -> list[tuple[float, float]]:
    """A drawn path's points in page coordinates."""
    a, b, c, d, e, f = obj.get_matrix().get()
    points = []
    for i in range(pdfium_raw.FPDFPath_CountSegments(obj.raw)):
        segment = pdfium_raw.FPDFPath_GetPathSegment(obj.raw, i)
        x, y = ctypes.c_float(), ctypes.c_float()
        pdfium_raw.FPDFPathSegment_GetPoint(segment, ctypes.byref(x), ctypes.byref(y))
        points.append((a * x.value + c * y.value + e, b * x.value + d * y.value + f))
    return points


def fill_colour(obj) -> tuple[int, int, int]:
    r, g, b, alpha = (ctypes.c_uint() for _ in range(4))
    pdfium_raw.FPDFPageObj_GetFillColor(obj.raw, *(ctypes.byref(v) for v in (r, g, b, alpha)))
    return r.value, g.value, b.value


def hourly_profiles(page: int, report: list[str]) -> dict:
    """Figure 3.3, read from its drawing: % of the day's mechanised trips, by purpose and starting hour."""
    drawing = pypdfium2.PdfDocument(PDF)[page - 1]
    tops, gridlines = {}, None
    for obj in drawing.get_objects(max_depth=5):
        if obj.type != pdfium_raw.FPDF_PAGEOBJ_PATH:
            continue
        points, colour = path_points(obj), fill_colour(obj)
        closed = len(points) >= 48 and abs(points[0][0] - points[-1][0]) + abs(points[0][1] - points[-1][1]) < 0.01
        if colour in PROFILE_COLOURS and closed:  # the x-axis ticks share NHB's navy but are not a closed area
            if PROFILE_COLOURS[colour] in tops:
                raise RuntimeError(f"Figure 3.3: two areas coloured {colour}")
            tops[PROFILE_COLOURS[colour]] = points[:24]  # the top edge, 0000 to 2300; the rest runs back along the bottom
        elif colour == GRIDLINE_COLOUR and len(points) == 14:
            gridlines = sorted({round(y, 2) for _, y in points})
    if len(tops) != 4 or not gridlines or len(gridlines) != 7:
        raise RuntimeError(f"Figure 3.3 not recognised on page {page}: {sorted(tops)}, gridlines {gridlines}")
    # The gridlines are 2%, 4%, ..., 14%; a straight line through all seven sets the scale. They sit
    # up to 0.1 pt off it (drawn snapped to the printer's grid), about 0.01 of a percentage point.
    levels = [2 * (i + 1) for i in range(7)]
    mean_v, mean_y = sum(levels) / 7, sum(gridlines) / 7
    per_pct = (sum((v - mean_v) * (y - mean_y) for v, y in zip(levels, gridlines))
               / sum((v - mean_v) ** 2 for v in levels))
    zero = mean_y - per_pct * mean_v
    off = max(abs(zero + per_pct * v - y) for v, y in zip(levels, gridlines))
    if off > 0.2:
        raise RuntimeError(f"Figure 3.3 gridlines are not evenly spaced (worst {off:.2f} pt)")

    stacked = {name: [(y - zero) / per_pct for _, y in points] for name, points in tops.items()}
    profiles, below = {}, [0.0] * 24
    for name in sorted(stacked, key=lambda n: sum(stacked[n])):  # bottom layer first
        profiles[name] = [round(max(0.0, top - under), 3) for top, under in zip(stacked[name], below)]
        below = stacked[name]
    hours = [round(x) for x, _ in tops["HBW"]]
    if any(b <= a for a, b in zip(hours, hours[1:])):
        raise RuntimeError("Figure 3.3 points are not in hour order")
    return {purpose: profiles[purpose] for purpose in PROFILE_COLOURS.values()}


def main() -> None:
    text = pages()
    report, params = [], {"source": "Transport Department, Travel Characteristics Survey 2022, Final Report (2025 version)",
                          "url": "https://www.td.gov.hk/filemanager/en/content_5349/tcs2022_eng.pdf"}

    # Table 3.3: trips by purpose and trip rates.
    page, body = page_with(text, "Table 3.3 Comparison of Weekday Mechanised Trips by Trip")
    trips = {}
    for key, label in PURPOSES.items():
        match = re.search(re.escape(label) + r"\s+([\d ]+?000)\s+([\d ]+?000)", body)
        trips[key] = number(match.group(2))
    total = number(re.search(r"Total\s+([\d ]+?000)\s+([\d ]+?000)", body).group(2))
    rates = {}
    for key, (label, unit) in RATES.items():
        match = re.search(re.escape(label) + r"\s+([\d.]+)\s+([\d.]+)", body)
        rates[key] = {"trips": float(match.group(2)), "per": unit}
    overall = float(re.search(r"Trips per person\s+([\d.]+)\s+([\d.]+)\s", body.split("Average Daily")[1]).group(2))
    params["weekday_mechanised_trips"] = {**trips, "total": total, "table": "3.3", "page": page}
    params["trip_rates"] = {**rates, "all_purposes_per_person": overall, "table": "3.3", "page": page}
    report.append(f"出行总量（表 3.3，第 {page} 页）：各目的相加 {sum(trips.values()):,.0f} vs 报告总计 {total:,.0f}"
                  + ("，一致" if abs(sum(trips.values()) - total) < 1000 else "  ← 需复核"))
    report.append("出行率：" + "；".join(f"{k} 每{v['per']} {v['trips']}" for k, v in rates.items())
                  + f"；全体每人 {overall}")

    params.update(journeys(text, trips, report))

    # Table 3.6: share of boardings by mode.
    page, body = page_with(text, "Table 3.6 Distribution of Boardings by Transport Mode")
    shares = {}
    for mode in BOARDING_MODES:
        match = re.search(rf"\n{re.escape(mode)} (\d+)% (\d+)% (\d+)%", body)
        shares[mode] = {"all": int(match.group(1)), "HBW": int(match.group(2)), "HBS": int(match.group(3))}
    params["boarding_shares_pct"] = {**shares, "table": "3.6", "page": page}
    top = [m for m in BOARDING_MODES if m not in ("MTR", "LRT")]
    sums = {col: sum(shares[m][col] for m in top) for col in ("all", "HBW", "HBS")}
    report.append(f"乘车方式占比（表 3.6，第 {page} 页）：各方式相加 " + "，".join(f"{k} {v}%" for k, v in sums.items())
                  + ("（四舍五入容许 ±2）" if all(abs(v - 100) <= 2 for v in sums.values()) else "  ← 需复核")
                  + f"；铁路 = 港铁 + 轻铁：{shares['Rail']['all']} = {shares['MTR']['all']} + {shares['LRT']['all']}"
                  + ("" if shares["Rail"]["all"] == shares["MTR"]["all"] + shares["LRT"]["all"] else "  ← 需复核"))

    # Table E.6: value of time, checked against its page.
    page, body = page_with(text, "Table E.6 Behavioural Values of Time by Private Vehicle")
    flat = re.sub(r"\s+", " ", body)
    values = [VALUE_OF_TIME["overall"]] + [v for group in ("pv_available", "no_pv") for v in VALUE_OF_TIME[group].values()]
    missing = [v for v in values if not re.search(rf"(?<!\d){v}(?!\d)", flat)]
    params["value_of_time_cents_per_min_2022"] = {**VALUE_OF_TIME, "table": "E.6", "page": page}
    report.append(f"时间价值（表 E.6，第 {page} 页，仙/分钟，2022 年价格）：有车家庭上班 {VALUE_OF_TIME['pv_available']['HBW']}、"
                  f"无车家庭上班 {VALUE_OF_TIME['no_pv']['HBW']}、全体 {VALUE_OF_TIME['overall']}"
                  + ("；数值均在该页原文中出现" if not missing else f"；原文找不到 {missing}  ← 需复核"))

    # Table 4.2: private vehicle availability by housing type.
    page, body = page_with(text, "Table 4.2 PV Availability by Household Characteristics")
    availability = {}
    for key, label in HOUSING.items():
        match = re.search(re.escape(label) + r" ([\d.]+)% ([\d.]+)% ([\d.]+)%", body)
        availability[key] = {"car": float(match.group(1)), "motorcycle": float(match.group(2)),
                             "private_vehicle": float(match.group(3))}
    sizes = {}
    for size, label in {1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five or more"}.items():
        match = re.search(rf"\n{label} ([\d.]+)% ([\d.]+)% ([\d.]+)%", body)
        sizes[size] = float(match.group(3))
    availability["by_household_size"] = sizes  # 5 = five or more persons
    overall_pv = re.search(r"Overall ([\d.]+)% ([\d.]+)% ([\d.]+)%", body)
    availability["overall"] = {"car": float(overall_pv.group(1)), "private_vehicle": float(overall_pv.group(3))}
    params["pv_availability_pct"] = {**availability, "table": "4.2", "page": page}
    report.append(f"有车家庭比例（表 4.2，第 {page} 页）：公屋 {availability['public_rental']['private_vehicle']}%、"
                  f"资助出售 {availability['subsidised_sale']['private_vehicle']}%、私人住宅 {availability['private']['private_vehicle']}%、"
                  f"全港 {availability['overall']['private_vehicle']}%")

    # Table 5.1: stated maximum acceptable waiting time.
    page, body = page_with(text, "Table 5.1 Stated Maximum Acceptable Waiting Time")
    waiting = {}
    for key, label in WAITING.items():
        match = re.search(rf"\n{re.escape(label)} (\d+) (\d+)", body)
        waiting[key] = int(match.group(2))
    params["max_acceptable_wait_min"] = {**waiting, "table": "5.1", "page": page}
    report.append("可接受最长候车（表 5.1）：" + "、".join(f"{k} {v} 分钟" for k, v in waiting.items()))

    params["broad_districts"] = broad_district_tables(report)
    params["boardings_by_mode_purpose"] = boardings_by_purpose(report)
    territory = params["broad_districts"]["territory"]
    agree = all(abs(territory[f"{k}_prod"] - trips[k]) < 1000 for k in PURPOSES)
    report.append("附录 A.2 全港合计与正文表 3.3 " + ("一致" if agree else "不一致  ← 需复核"))

    # E.2.19: the walk at either end of a mechanised trip; Table 5.2: stated switching.
    page, body = page_with(text, "E.2.19 The mean walking time from trip origin")
    flat = re.sub(r"\s+", " ", body)
    access = re.search(r"E\.2\.19 The mean walking time from trip origin to access a mechanised transport mode, "
                       r"or from the alighting point of a mechanised transport mode to trip ?destination ?was (\d+) minutes",
                       flat)
    interchange = re.search(r"The mean walking time was (\d+) minutes", flat)
    params["access_walk_min"] = {"per_trip_end": int(access.group(1)), "interchange": int(interchange.group(1)),
                                 "section": "E.2.19", "page": page}
    page52, body52 = page_with(text, "Table 5.2 Impact of Assumed Increases in Journey Time have")
    flat52 = re.sub(r"\s+", " ", body52)
    switch = re.search(r"Switch to other transport modes (\d+)% (\d+)% (\d+)%", flat52)
    stay = re.search(r"No change would be made (\d+)% (\d+)% (\d+)%", flat52)
    params["stated_mode_switching_pct"] = {
        "extra_minutes": [15, 30, 45], "switch_mode": [int(v) for v in switch.groups()],
        "no_change": [int(v) for v in stay.groups()], "table": "5.2", "page": page52,
        "question": "respondents aged 15+, weekday peak periods, assumed increase on top of the usual journey time",
    }
    report.append(f"步行接驳（E.2.19）：每端平均 {params['access_walk_min']['per_trip_end']} 分钟，换乘平均 "
                  f"{params['access_walk_min']['interchange']} 分钟；方式转移（表 5.2）：出行时间多 15/30/45 分钟时改用其他方式 "
                  + "/".join(f"{v}%" for v in params["stated_mode_switching_pct"]["switch_mode"]))

    # Figure 3.3 and 3.3.7-9: when in the day trips are made, and which way the peak-hour ones run.
    page33, body33 = page_with(text, "Figure 3.3 Hourly Profiles of Mechanised Trips")
    profiles = hourly_profiles(page33, report)
    flat33 = re.sub(r"\s+", " ", body33)
    peaks = re.search(r"The two peak hours accounted for about (\d+)% and (\d+)% of the daily trip total", flat33)
    commute = re.search(r"(\d+)% of the home-to-work trips were made during the morning peak hour \(8:00 – 9:00 a\.m\.\) "
                        r"while (\d+)% of the work-to-home trips were made during the evening peak hour", flat33)
    school = re.search(r"For the home to school direction, (\d+)% of the trips were made during 7:00 – 8:00 a\.m\.", flat33)
    params["hourly_profile_pct"] = {
        "hours": list(range(24)), **profiles, "unit": "% of all weekday mechanised trips, by starting hour",
        "note": "trip-making time = mid-point of departure and arrival", "figure": "3.3", "page": page33,
    }
    params["peak_hour_direction_pct"] = {
        "home_to_work_0800": int(commute.group(1)), "work_to_home_1800": int(commute.group(2)),
        "home_to_school_0700": int(school.group(1)), "section": "3.3.8-3.3.9", "page": page33,
    }
    by_hour = [sum(profiles[p][h] for p in profiles) for h in range(24)]
    shares = {p: sum(v) for p, v in profiles.items()}
    stated = {p: params["weekday_mechanised_trips"][p] / params["weekday_mechanised_trips"]["total"] * 100
              for p in profiles}
    worst = max(abs(shares[p] - stated[p]) for p in profiles)
    peaks_ok = abs(by_hour[8] - int(peaks.group(1))) < 0.5 and abs(by_hour[18] - int(peaks.group(2))) < 0.5
    report.append(f"逐时分布（图 3.3，从矢量图形读出）：全日合计 {sum(by_hour):.1f}%；8-9 时 {by_hour[8]:.1f}%、18-19 时 "
                  f"{by_hour[18]:.1f}%（正文约 {peaks.group(1)}% 和 {peaks.group(2)}%）"
                  + ("" if peaks_ok and abs(sum(by_hour) - 100) < 1 else "  ← 需复核"))
    report.append("  各目的占全日比例（图）vs 表 3.3：" + "、".join(f"{p} {shares[p]:.1f}/{stated[p]:.1f}" for p in profiles)
                  + ("" if worst < 1.0 else "  ← 需复核"))
    report.append(f"  8-9 时各目的：" + "、".join(f"{p} {profiles[p][8]:.2f}%" for p in profiles)
                  + f"；上班方向 {commute.group(1)}% 在 8-9 时，上学方向 {school.group(1)}% 在 7-8 时")

    report.append("仍缺出处：步行速度（报告未提供，改以 TPDM 第 6 册 10.4.2.2 核对）；机动化出行不含纯步行")
    params["not_in_report"] = ["walking speed", "walk-only trips"]

    OUTPUT.write_text(json.dumps(params, ensure_ascii=False, indent=1), encoding="utf-8")
    AUDIT.write_text(json.dumps({"report": report}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"-> {OUTPUT.relative_to(ROOT)}")
    for line in report:
        print("   " + line)


if __name__ == "__main__":
    main()
