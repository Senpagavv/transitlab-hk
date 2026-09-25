"""Step 4c: goods vehicles, and the cars and coaches coming over the boundary, on a weekday in 2026 -
daily and in the morning peak hour (08:00-09:00).

Input : data/raw/tcs/gvtcs2011_eng.txt, gvtcs2011_eng.pdf   Transport Department, Survey on Goods
                                          Vehicle Trip Characteristics 2011 (GVTCS), final report
        data/raw/tcs/gvtcs2011app_eng.txt  its appendix (pdftotext -table): A.2 trip ends by district, A.3 rates
        data/raw/td-digest/1112_table41a.txt   TD Monthly Traffic and Transport Digest, Dec 2011, Table 4.1(a)
        data/raw/td-digest/2606_table41a.xls   the same table, June 2026 (licensed goods vehicles)
        data/raw/td-digest/2606_table81[a-f].xls   June 2026 digest, Table 8.1: vehicles through each land crossing
        data/model/landuse-2026.parquet, trip-ends-2026.parquet   zones, floor space, households (pipeline/16, 21)
        data/model/skim-car-freeflow.npz, trip-distribution-2026.npz   car minutes; cross-boundary people (pipeline/17, 22)
        data/model/parameters-tcs2022.json       TCS hourly profile, for the boundary cars (pipeline/20)
        data/web/cross-boundary.json, traffic/atc-occupancy.json   control points (13); census vehicle mix (07)
Output: data/model/goods-2026.npz   zones; D_<class> daily and V_<class> 08:00-09:00 vehicle trips, origin ->
                                    destination, for GOODS_LIGHT (van-type and other light goods vehicles),
                                    GOODS_HEAVY (medium, heavy, container), BOUNDARY_CAR, BOUNDARY_COACH
        data/web/goods-audit.json

Goods vehicles. GVTCS is the survey the government's own goods model rests on. It gives, for 2011:
  Table A.2  trip origins and destinations in each of the 26 broad districts (the TCS districts), for
             van-type light goods vehicles, other light goods vehicles, and medium/heavy/container
             vehicles together - the control totals here;
  Table A.3  trips per flat and per 100 m2 of floor space by land use and region - they spread each
             district's trips over its zones;
  4.3        mean journey times: vans and light goods 24-25 min, heavy 34, container 41, all 27;
  Table 4.3  trips between Hong Kong Island, Kowloon, the New Territories and the boundary - the
             check on distribution;
  Figure 4.2 each vehicle type's share of the day's trips by hour. It is a picture in the PDF, so it
             is read pixel by pixel against its own gridlines (the check: the shares it gives for
             10:00-12:00 and 14:00-16:00 against the 20% and 17% the text states).
2011 is grown to 2026 by the licensed fleet (TD digest Table 4.1(a)): light goods vehicles 70,359
-> 67,756, medium and heavy 40,805 -> 38,914 (medium fell, heavy doubled; the survey's A.2 groups
them with container vehicles, so they are grown together). Trips per vehicle are held at 2011's.
Boundary goods traffic is not grown but taken from TD's 2026 counts at each crossing (Table 8.1).

Distribution is a doubly constrained gravity model per vehicle group on free-flow car minutes, as
in step 2: reported journey times are longer than free-flow ones by one factor rho (congestion,
loading, finding a kerb), the same for every group, and crossing the harbour is discounted by a
factor K (tolls). K is set so the cross-harbour share matches Table 4.3; rho fits the rest of Table
4.3 and the light goods vehicle-km implied by the fleet and its annual mileage together (Table 4.3
alone pushed rho to 3.4 and left vans at 0.69 of that mileage; see misfit in main).

Boundary cars and coaches. Since 2023 private cars cross in numbers ("Northbound Travel for Hong
Kong Vehicles", Guangdong vehicles southbound): about 13,000 each way a day. Mode choice gives
cross-boundary travellers no car, so they are added here as vehicles, from TD's counts at each road
crossing (average day of the latest 12 months - weekday and all-day traffic are the same on the
Shenzhen Bay Bridge, census station 5040), spread over Hong Kong like the travellers through that
crossing (pipeline/22), and put in the peak hour with TCS's "other purpose" profile (a placeholder).
Shuttle buses are left out: they turn round at the boundary facility.

Run from the project root (a few minutes):
    uv run python pipeline/26_goods_and_boundary_vehicles.py
"""

import calendar
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd
import pypdfium2
import pypdfium2.raw as pdfium_raw

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
MODEL = ROOT / "data" / "model"
WEB = ROOT / "data" / "web"
GVTCS_TEXT = RAW / "tcs" / "gvtcs2011_eng.txt"
GVTCS_PDF = RAW / "tcs" / "gvtcs2011_eng.pdf"
APPENDIX = RAW / "tcs" / "gvtcs2011app_eng.txt"
DIGEST_2011 = RAW / "td-digest" / "1112_table41a.txt"
DIGEST_FLEET = RAW / "td-digest" / "2606_table41a.xls"
DIGEST_CROSSINGS = RAW / "td-digest" / "2606_table81{}.xls"
LANDUSE = MODEL / "landuse-2026.parquet"
TRIP_ENDS = MODEL / "trip-ends-2026.parquet"
CAR = MODEL / "skim-car-freeflow.npz"
DISTRIBUTION = MODEL / "trip-distribution-2026.npz"
PARAMETERS = MODEL / "parameters-tcs2022.json"
CROSS_BOUNDARY = WEB / "cross-boundary.json"
OCCUPANCY = WEB / "traffic" / "atc-occupancy.json"
OUTPUT = MODEL / "goods-2026.npz"
AUDIT = WEB / "goods-audit.json"

GROUPS = ["van", "lgv", "heavy"]  # the three column pairs of Table A.2
CLASS_OF = {"van": "GOODS_LIGHT", "lgv": "GOODS_LIGHT", "heavy": "GOODS_HEAVY"}
HONG_KONG_ISLAND = {"Central & Western", "Wan Chai", "Eastern", "Southern"}
KOWLOON = {"Yau Ma Tei", "Mong Kok", "Sham Shui Po", "Kowloon City", "Kwun Tong", "Wong Tai Sin"}
# Licensed goods vehicles at the end of 2011 (TD digest, Dec 2011, Table 4.1(a); each checked below
# to be printed in the table): light, medium, heavy.
FLEET_2011 = {"light": 70_359, "medium": 37_150, "heavy": 3_655}
# TD Table 8.1 sheet for each road crossing, and a word its title must contain.
CROSSINGS = {"a": ("Man Kam To", "Man Kam To"), "b": ("Sha Tau Kok", "Sha Tau Kok"), "c": ("Lok Ma Chau", "Lok Ma Chau"),
             "d": ("Shenzhen Bay", "Shenzhen Bay"), "e": ("Hong Kong-Zhuhai-Macao Bridge", "Zhuhai"),
             "f": ("Heung Yuen Wai", "Heung Yuen Wai")}
WEEKDAY_FACTOR = 1.0  # Shenzhen Bay Bridge (census 5040): Mon-Fri AADT / all-day AADT = 0.99-1.00
PEAK = 8
CONNECTOR_KPH = 40.0  # control point to the zone it hangs off, as in pipelines 22 and 23
RHO_RANGE = (1.0, 4.0)
HARBOUR_RANGE = (0.1, 1.5)
BALANCE_TOLERANCE = 1e-4
REGION_TOLERANCE = 0.05  # largest gap accepted in a Table 4.3 share


def number(text: str) -> float:
    return 0.0 if text.strip() in ("*", "-", "N/A") else float(text.replace(",", "").replace(" ", ""))


def appendix_trip_ends(report: list[str]) -> pd.DataFrame:
    """Table A.2: weekday goods vehicle trip origins and destinations by broad district and group."""
    text = APPENDIX.read_text(encoding="utf-8", errors="replace")
    start = text.rindex("Table A.2")  # the last mention is the table; the first is the list of tables
    table = text[start:text.index("Table A.3", start)]
    table = table[table.index("Central & Western"):]
    cell = r"([\d,]+|\*)"
    rows = {}
    for line in table.splitlines():
        match = re.match(r"^\s*([A-Z][A-Za-z&/ \-]+?)\s{2,}" + r"\s+".join([cell] * 8) + r"\s*$", line)
        if match:
            name = re.sub(r"^Rural ", "", re.sub(r"/\s+", "/", match.group(1).strip()))
            rows[name] = [number(v) for v in match.groups()[1:]]
    columns = [f"{g}_{end}" for g in GROUPS + ["all"] for end in ("O", "D")]
    frame = pd.DataFrame(rows, index=columns).T
    whole = frame.loc["Whole Territory"]
    parts = frame.drop(index=[i for i in frame.index if i.startswith("Subtotal") or i == "Whole Territory"])
    gap = (parts.sum() - whole).abs().max()
    groups_add = (parts[[f"{g}_O" for g in GROUPS]].sum(axis=1) - parts["all_O"]).abs().max()
    # Every cell is rounded to the hundred: 27 rows can drift at most 27 x 50 from the printed total,
    # three groups 3 x 50 from their row's total. A misread column is off by thousands.
    ok = len(parts) == 27 and gap <= 50 * len(parts) and groups_add <= 150
    report.append(f"附录 A.2（26 区 + 口岸）：各区加总与全港合计最大差 {gap:,.0f}（表内四舍五入到百，容许 {50 * len(parts):,}；口岸 * 为 <50），"
                  f"三组相加与合计最大差 {groups_add:,.0f}；全港 {whole['all_O']:,.0f} 车次/工作日"
                  + ("" if ok else "  ← 需复核"))
    if not ok:
        raise RuntimeError("Table A.2 did not parse cleanly")
    return parts.rename(index={"Boundary Control Points": "BCP"})


def appendix_rates(report: list[str]) -> dict:
    """Table A.3: trips produced and attracted per unit, by land use and region."""
    text = APPENDIX.read_text(encoding="utf-8", errors="replace")
    start = text.rindex("Table A.3")
    table = text[start:text.index("Table A.4", start)]
    uses = {"Tertiary": ("gfa_tertiary", 100), "Private Residential": ("flats_private", 1),
            "Public Housing": ("flats_public", 1), "Subsidised Sale Flats": ("flats_subsidised", 1),
            "Retail": ("gfa_retail", 100), "Hotel": ("gfa_hotel", 100), "Industrial": ("gfa_industrial", 100),
            "Office": ("gfa_office", 100)}
    rates = {}
    for line in table.splitlines():
        for use, (column, per) in uses.items():
            match = re.match(rf"^{use}\s+per [\w ]+?\s{{2,}}(.*)$", line.strip())
            if match:
                values = [None if v == "-" else float(v) for v in match.group(1).split()]
                if len(values) != 8:
                    raise RuntimeError(f"Table A.3 row {use}: {values}")
                whole = values[6:8]
                for k, region in enumerate(["HKI", "KLN", "NT"]):
                    pro, att = values[2 * k], values[2 * k + 1]
                    rates.setdefault(region, {})[column] = ((pro if pro is not None else whole[0]) / per,
                                                            (att if att is not None else whole[1]) / per)
    if any(len(r) != len(uses) for r in rates.values()) or len(rates) != 3:
        raise RuntimeError(f"Table A.3 parsed incompletely: {rates}")
    report.append("附录 A.3 出行率（按港岛/九龙/新界）：零售每百平方米 " + "/".join(
        f"{rates[r]['gfa_retail'][0] * 100:.2f}" for r in ("HKI", "KLN", "NT")) + "，工业 " + "/".join(
        f"{rates[r]['gfa_industrial'][0] * 100:.2f}" for r in ("HKI", "KLN", "NT")) + "（产生）；幼稚园、中小学没有楼面数据，未计，由各区总数吸收")
    return rates


def survey_facts(report: list[str]) -> dict:
    """Table 4.1 trips by type, 4.3 journey times, Table 4.3 regional movements, Table E.4 annual km."""
    text = GVTCS_TEXT.read_text(encoding="utf-8", errors="replace")
    flat = re.sub(r"\s+", " ", text)
    trips = {}
    for name in ("Van-type LGV", "LGV", "MGV", "HGV", "Container Vehicle"):
        match = re.search(rf"(?:^|\n){name} ([\d,]+) ([\d,]+) (\d+)%", text)
        trips[name] = number(match.group(1)) + number(match.group(2))
    light = re.search(r"mean journey time of (\d+) to (\d+) minutes", flat)
    heavy = re.search(r"mean journey times for HGVs and container vehicle trips were (\d+) and (\d+) minutes", flat)
    overall = float(re.search(r"The mean journey time was (\d+) minutes", flat).group(1))
    light_min = (float(light.group(1)) + float(light.group(2))) / 2
    hgv_min, container_min = float(heavy.group(1)), float(heavy.group(2))
    total = sum(trips.values())
    mgv_min = (overall * total - light_min * (trips["Van-type LGV"] + trips["LGV"]) - hgv_min * trips["HGV"]
               - container_min * trips["Container Vehicle"]) / trips["MGV"]
    heavy_min = (mgv_min * trips["MGV"] + hgv_min * trips["HGV"] + container_min * trips["Container Vehicle"]) / (
        trips["MGV"] + trips["HGV"] + trips["Container Vehicle"])
    report.append(f"平均行程时间（4.3，自报）：厢式与轻型 {light_min:.1f} 分钟、重型 {hgv_min:.0f}、货柜 {container_min:.0f}、"
                  f"全部 {overall:.0f} → 反推中型 {mgv_min:.1f}，中重型合计 {heavy_min:.1f}"
                  + ("" if light_min < mgv_min < container_min else "  ← 需复核"))
    block = text[text.index("Table 4.3 Major Trip Movements", text.index("4.4.1")):]
    matrix = {}
    for label in ("HKI", "Kowloon", "NT", "BCP"):
        match = re.search(rf"\n{label} ([\d,]+|N/A) ([\d,]+|N/A) ([\d,]+|N/A) ([\d,]+|N/A) ([\d,]+)", block)
        matrix[label] = [number(v) for v in match.groups()[:4]]
    regions = pd.DataFrame(matrix, index=["HKI", "Kowloon", "NT", "BCP"]).T  # rows: from, columns: to
    if abs(regions.values.sum() - total) > 500:
        raise RuntimeError("Table 4.3 does not add up to the survey total")
    km = {}
    table_e4 = text[text.index("Table E.4"):]
    for name in ("Van-type LGV", "LGV", "MGV", "HGV", "Container Vehicle"):
        match = re.search(rf"\n{name} ([\d,]+) ([\d,]+)", table_e4)
        km[name] = number(match.group(2))  # 2011
    return {"trips": trips, "minutes": {"van": light_min, "lgv": light_min, "heavy": heavy_min},
            "regions": regions, "annual_km": km}


def hourly_profile(report: list[str]) -> dict:
    """Figure 4.2, read from the embedded picture: % of the day's goods vehicle trips by starting hour,
    stacked van, light, medium, heavy, container from the bottom."""
    pdf = pypdfium2.PdfDocument(GVTCS_PDF)
    pages = [i for i in range(len(pdf)) if "Hourly Profiles of Goods Vehicle Trips" in pdf[i].get_textpage().get_text_range()]
    page = pdf[pages[-1]]
    pictures = [obj for obj in page.get_objects(max_depth=5) if obj.type == pdfium_raw.FPDF_PAGEOBJ_IMAGE]
    picture = max(pictures, key=lambda o: o.get_bitmap(render=False).width)
    img = np.asarray(picture.get_bitmap(render=False).to_pil().convert("RGB")).astype(int)
    colours = {"van": (0, 32, 96), "lgv": (146, 208, 80), "mgv": (112, 48, 160), "hgv": (204, 204, 0),
               "container": (192, 0, 0)}

    def painted(block, name):
        return np.abs(block - np.array(colours[name])).sum(axis=-1) <= 40

    white = np.where((img == 255).all(axis=2).any(axis=1))[0]
    legend_bottom = white.max() + 2  # the legend is the only white in the picture
    # A gridline is black wherever the background shows (the areas are drawn over it) and has
    # background just above and below it; the frame outside the plot is black too, with none.
    black = (img.sum(axis=2) < 60).sum(axis=1)
    background = (np.abs(img - np.array([238, 236, 225])).sum(axis=2) < 12).sum(axis=1)
    lines = [y for y in range(legend_bottom, img.shape[0] - 2)
             if black[y] >= 100 and black[y] > 9 * background[y] and background[y - 2] > 100 and background[y + 2] > 100]
    if len(lines) != 5:
        raise RuntimeError(f"Figure 4.2: expected the 2%-10% gridlines, found rows {lines}")
    levels = np.array([10, 8, 6, 4, 2], float)
    slope, zero = np.polyfit(levels, np.array(lines, float), 1)
    area = np.zeros(img.shape[:2], bool)
    for name in colours:
        area |= painted(img, name)
    columns = np.where(area[int(zero) - 80:int(zero)].any(axis=0))[0]
    x0, x23 = columns.min(), columns.max()
    values = {name: [] for name in colours}
    for hour in range(24):
        x = int(np.clip(round(x0 + hour * (x23 - x0) / 23), x0 + 1, x23 - 1))
        strip = img[:, x - 1:x + 2]
        below = zero
        for name in colours:  # bottom to top
            hit = np.where(painted(strip, name).any(axis=1))[0]
            hit = hit[hit >= legend_bottom]
            if len(hit) == 0:
                values[name].append(0.0)
                continue
            values[name].append(max(0.0, (below - hit.min()) / -slope))
            below = hit.min()
    total = [sum(values[n][h] for n in colours) for h in range(24)]
    text = re.sub(r"\s+", " ", GVTCS_TEXT.read_text(encoding="utf-8", errors="replace"))
    stated = re.search(r"These two peak periods accounted for (\d+)% and (\d+)% of the daily trip total", text)
    morning, afternoon = total[10] + total[11], total[14] + total[15]
    ok = (abs(sum(total) - 100) < 1.5 and abs(morning - int(stated.group(1))) < 1 and abs(afternoon - int(stated.group(2))) < 1)
    report.append(f"图 4.2（位图逐像素读取）：全日合计 {sum(total):.1f}%；10-12 时 {morning:.1f}%、14-16 时 {afternoon:.1f}%"
                  f"（正文 {stated.group(1)}% 和 {stated.group(2)}%）；8-9 时 {total[PEAK]:.1f}%" + ("" if ok else "  ← 需复核"))
    if not ok:
        raise RuntimeError("Figure 4.2 was not read correctly")
    return values


def fleet_growth(report: list[str]) -> dict:
    """Licensed goods vehicles, end of 2011 against the latest month of the 2026 digest."""
    printed = DIGEST_2011.read_text(encoding="utf-8", errors="replace")
    for name, count in FLEET_2011.items():
        if f"{count:,}".replace(",", " ") not in printed:
            raise RuntimeError(f"{name} goods vehicles {count} not found in the Dec 2011 digest table")
    sheets = pd.read_excel(DIGEST_FLEET, sheet_name=None, header=None)
    sheet = next(s for s in sheets.values() if "Goods Vehicles" in " ".join(str(v) for v in s.values.ravel()))
    rows = []
    for _, row in sheet.iterrows():
        numbers = [v for v in row.tolist() if isinstance(v, (int, float)) and not pd.isna(v)]
        if len(numbers) == 13 and 1 <= numbers[0] <= 12:
            rows.append(numbers)
    latest = rows[-1]
    now = {"light": latest[3], "medium": latest[6], "heavy": latest[9]}
    if abs(sum(now.values()) - latest[12]) > 1:
        raise RuntimeError("licensed goods vehicles do not add up in the 2026 digest")
    growth = {"light": now["light"] / FLEET_2011["light"],
              "heavy": (now["medium"] + now["heavy"]) / (FLEET_2011["medium"] + FLEET_2011["heavy"])}
    report.append(f"领牌货车 2011 年底 → 2026 最新月：轻型 {FLEET_2011['light']:,} → {now['light']:,.0f}（×{growth['light']:.3f}）、"
                  f"中型 {FLEET_2011['medium']:,} → {now['medium']:,.0f}、重型 {FLEET_2011['heavy']:,} → {now['heavy']:,.0f}"
                  f"（中重型合计 ×{growth['heavy']:.3f}）；每车出行次数按 2011 年不变")
    return {"growth": growth, "fleet": now}


def crossing_traffic(report: list[str]) -> pd.DataFrame:
    """Average daily vehicles into and out of Hong Kong at each road crossing, latest 12 months."""
    rows = []
    for letter, (point, word) in CROSSINGS.items():
        sheet = pd.read_excel(str(DIGEST_CROSSINGS).format(letter), header=None)
        title = " ".join(str(v) for v in sheet.head(8).values.ravel() if isinstance(v, str))
        if word not in title:
            raise RuntimeError(f"Table 8.1({letter}) is not {point}: {title[:80]}")

        def row_with(text, after=0):  # the tables start a different number of rows down
            return next(i for i in range(after, len(sheet)) if any(
                isinstance(v, str) and v.strip().startswith(text) for v in sheet.iloc[i].tolist()))

        at = row_with("Private Car")
        header, bounds = sheet.iloc[at].tolist(), sheet.iloc[row_with("Inward", at)].tolist()

        def pair(label):
            start = next(i for i, v in enumerate(header) if isinstance(v, str) and v.strip().startswith(label))
            inward = next(i for i in range(start, len(bounds)) if str(bounds[i]).strip().startswith("Inward"))
            outward = next(i for i in range(inward + 1, len(bounds)) if str(bounds[i]).strip().startswith("Outward"))
            return inward, outward

        columns = {"car": pair("Private Car"), "coach": pair("Coach"), "goods": pair("Goods Vehicle")}
        year, months = None, []
        for _, row in sheet.iloc[at + 2:].iterrows():
            first, second = row.iloc[0], row.iloc[1]
            if isinstance(first, (int, float)) and not pd.isna(first) and 2000 < first < 2100 and pd.isna(second):
                continue  # an annual row
            text = str(first).strip()
            if re.fullmatch(r"\d{4}", text) or re.fullmatch(r"\d{4}\.0", text):
                year = int(float(text))
            month = pd.to_numeric(second, errors="coerce")
            if year and not pd.isna(month) and 1 <= month <= 12:
                values = {k: [pd.to_numeric(row.iloc[i], errors="coerce") for i in c] for k, c in columns.items()}
                if all(not pd.isna(v) for pair_ in values.values() for v in pair_):
                    months.append((year, int(month), values))
        months = months[-12:]
        days = sum(calendar.monthrange(y, m)[1] for y, m, _ in months)
        record = {"point": point, "months": f"{months[0][0]}-{months[0][1]:02d}..{months[-1][0]}-{months[-1][1]:02d}"}
        for kind in columns:
            record[f"{kind}_in"] = sum(v[kind][0] for _, _, v in months) / days * WEEKDAY_FACTOR
            record[f"{kind}_out"] = sum(v[kind][1] for _, _, v in months) / days * WEEKDAY_FACTOR
        rows.append(record)
    frame = pd.DataFrame(rows).set_index("point")
    report.append(f"跨境车辆（运输署表 8.1，{frame['months'].iloc[0]} 日均，入/出境）：私家车 {frame['car_in'].sum():,.0f}/{frame['car_out'].sum():,.0f}、"
                  f"旅游巴士 {frame['coach_in'].sum():,.0f}/{frame['coach_out'].sum():,.0f}、货车 {frame['goods_in'].sum():,.0f}/{frame['goods_out'].sum():,.0f}；"
                  + "、".join(f"{p} 私家车 {r.car_in + r.car_out:,.0f}" for p, r in frame.iterrows() if r.car_in + r.car_out > 0))
    return frame


def expand(inner: np.ndarray, order: list[str], ids: list[str], hosts: dict, extra: dict) -> np.ndarray:
    """A zone-by-zone matrix widened to the control points, through the zone each hangs off."""
    n = len(order)
    full = np.full((len(ids), len(ids)), np.inf)
    full[:n, :n] = inner
    for k, zone in enumerate(ids[n:], start=n):
        host = order.index(hosts[zone])
        full[k, :n] = inner[host] + extra[zone]
        full[:n, k] = inner[:, host] + extra[zone]
    return full


def furness(origins: np.ndarray, destinations: np.ndarray, weight: np.ndarray) -> np.ndarray:
    b = np.ones(len(destinations))
    for _ in range(500):
        supply = weight @ b
        a = np.divide(origins, supply, out=np.zeros_like(origins), where=supply > 0)
        demand = weight.T @ a
        b = np.divide(destinations, demand, out=np.zeros_like(destinations), where=demand > 0)
        if np.max(np.abs(a * (weight @ b) - origins) / np.maximum(origins, 1)) < BALANCE_TOLERANCE:
            break
    return a[:, None] * weight * b[None, :]


class Goods:
    """Trip ends, costs and the gravity model for the three goods vehicle groups."""

    def __init__(self, report: list[str]) -> None:
        self.facts = survey_facts(report)
        districts = appendix_trip_ends(report)
        rates = appendix_rates(report)
        growth = fleet_growth(report)
        self.fleet = growth
        self.crossings = crossing_traffic(report)

        land = pd.read_parquet(LANDUSE).set_index("zone")
        ends = pd.read_parquet(TRIP_ENDS).set_index("zone")
        demand = np.load(DISTRIBUTION, allow_pickle=True)
        self.ids = [str(z) for z in demand["zones"]]
        order = [str(z) for z in land.index]
        external = self.ids[len(order):]
        car = np.load(CAR, allow_pickle=True)
        if [str(z) for z in car["zones"]] != order or self.ids[:len(order)] != order:
            raise RuntimeError("zone orders differ between the land-use table, car skim and trip matrices")
        points = {f"X:{p['point']}": p for p in json.loads(CROSS_BOUNDARY.read_text(encoding="utf-8"))["control_points"]}
        hosts = {z: ends.at[z, "host_zone"] for z in external}
        minutes = {z: points[z]["zone_distance_m"] / 1000 / CONNECTOR_KPH * 60 for z in external}
        self.cost = expand(car["time_min"].astype(float), order, self.ids, hosts, minutes)
        km = {z: points[z]["zone_distance_m"] / 1000 for z in external}
        self.km = expand(car["distance_km"].astype(float), order, self.ids, hosts, km)
        self.n = len(order)

        broad = ends.loc[order, "broad"].to_numpy()
        region = np.where(np.isin(broad, list(HONG_KONG_ISLAND)), "HKI", np.where(np.isin(broad, list(KOWLOON)), "KLN", "NT"))
        self.region = np.concatenate([region, ["BCP"] * len(external)])
        quantity = pd.DataFrame({
            "flats_private": land["households_private"], "flats_public": land["households_public"],
            "flats_subsidised": (land["households"] - land["households_public"] - land["households_private"]).clip(lower=0),
            "gfa_retail": land["gfa_retail"], "gfa_hotel": land["gfa_hotel"], "gfa_industrial": land["gfa_industrial"],
            "gfa_office": land["gfa_office"], "gfa_tertiary": land["gfa_tertiary"]}).fillna(0.0)
        produced = np.array([sum(rates[r][c][0] * quantity.iloc[i][c] for c in quantity) for i, r in enumerate(region)])
        attracted = np.array([sum(rates[r][c][1] * quantity.iloc[i][c] for c in quantity) for i, r in enumerate(region)])
        # Zones no road reaches (Lamma, Cheung Chau, Peng Chau) take no goods vehicle trips.
        reach = np.isfinite(self.cost[:self.n, :self.n]).sum(axis=1) > 1
        produced, attracted = produced * reach, attracted * reach

        self.origins, self.destinations = {}, {}
        scale = {"van": growth["growth"]["light"], "lgv": growth["growth"]["light"], "heavy": growth["growth"]["heavy"]}
        mix = districts.loc["BCP"]
        for g in GROUPS:
            o, d = np.zeros(len(self.ids)), np.zeros(len(self.ids))
            for district, row in districts.drop(index="BCP").iterrows():
                inside = broad == district
                if not inside.any():
                    raise RuntimeError(f"no zone in district {district}")
                for target, raw, column in ((o, produced, f"{g}_O"), (d, attracted, f"{g}_D")):
                    weight = raw[inside] if raw[inside].sum() > 0 else land["population"].to_numpy()[inside]
                    target[:self.n][inside] = weight / weight.sum() * row[column] * scale[g]
            # The boundary: 2026 counts at each crossing, split by group as the 2011 boundary trips were.
            for k, zone in enumerate(external, start=self.n):
                point = zone.removeprefix("X:")
                if point in self.crossings.index:
                    o[k] = self.crossings.at[point, "goods_in"] * mix[f"{g}_O"] / sum(mix[f"{h}_O"] for h in GROUPS)
                    d[k] = self.crossings.at[point, "goods_out"] * mix[f"{g}_D"] / sum(mix[f"{h}_D"] for h in GROUPS)
            d *= o.sum() / d.sum()  # growth and the new boundary counts leave origins and destinations a little apart
            self.origins[g], self.destinations[g] = o, d
        inside_2011 = districts.drop(index="BCP")[[f"{g}_O" for g in GROUPS]].values.sum()
        report.append(f"2026 工作日货车出行：厢式 {self.origins['van'].sum():,.0f}、轻型 {self.origins['lgv'].sum():,.0f}、"
                      f"中重型 {self.origins['heavy'].sum():,.0f}（2011 年 A.2 区内合计 {inside_2011:,.0f}）；"
                      f"没有道路的分区 {int((~reach).sum())} 个不计货车")
        island = self.region == "HKI"
        self.across = island[:, None] != island[None, :]
        self.finite = np.isfinite(self.cost)

    def distribute(self, g: str, beta: float, harbour: float) -> np.ndarray:
        weight = np.where(self.finite, np.exp(-beta * np.where(self.finite, self.cost, 0)), 0.0)
        weight = weight * np.where(self.across, harbour, 1.0)
        return furness(self.origins[g], self.destinations[g], weight)

    def mean_minutes(self, trips: np.ndarray) -> float:
        return float((trips[self.finite] * self.cost[self.finite]).sum() / trips[self.finite].sum())

    def fit_beta(self, g: str, target: float, harbour: float) -> tuple[float, np.ndarray]:
        low, high = np.log(1e-3), np.log(1.0)
        for _ in range(30):
            mid = (low + high) / 2
            trips = self.distribute(g, np.exp(mid), harbour)
            low, high = (low, mid) if self.mean_minutes(trips) < target else (mid, high)
        beta = np.exp((low + high) / 2)
        return beta, self.distribute(g, beta, harbour)

    def model(self, rho: float, harbour: float, rho_heavy: float | None = None) -> dict:
        """rho_heavy: medium/heavy vehicles' own rho (None = the same as the light groups)."""
        return {g: self.fit_beta(g, self.facts["minutes"][g] / (rho_heavy if g == "heavy" and rho_heavy else rho), harbour)
                for g in GROUPS}

    def regional(self, result: dict) -> pd.DataFrame:
        total = sum(trips for _, trips in result.values())
        labels = ["HKI", "KLN", "NT", "BCP"]
        return pd.DataFrame([[total[np.ix_(self.region == a, self.region == b)].sum() for b in labels] for a in labels],
                            index=labels, columns=labels)

    def survey_shares(self) -> pd.DataFrame:
        survey = self.facts["regions"].rename(index={"Kowloon": "KLN"}, columns={"Kowloon": "KLN"})
        return survey / survey.values.sum()


def main() -> None:
    report, flags = [], []
    goods = Goods(report)
    survey = goods.survey_shares()
    cross_target = float(survey.loc["HKI"].drop("HKI").sum() + survey["HKI"].drop("HKI").sum())
    tried = {}

    def with_harbour(rho: float, rho_heavy: float | None = None) -> tuple[float, dict]:
        low, high = HARBOUR_RANGE
        for _ in range(14):
            mid = (low + high) / 2
            result = goods.model(rho, mid, rho_heavy)
            share = goods.regional(result)
            share = share / share.values.sum()
            crossing = float(share.loc["HKI"].drop("HKI").sum() + share["HKI"].drop("HKI").sum())
            low, high = (mid, high) if crossing < cross_target else (low, mid)
        harbour = (low + high) / 2
        return harbour, goods.model(rho, harbour, rho_heavy)

    # Two targets, not one. Table 4.3 (shares between Hong Kong Island, Kowloon, the New Territories and the
    # boundary) says little about how far a van goes inside a region: fitted on it alone, rho ran to 3.4 and
    # light goods vehicles covered only 0.69 of the vehicle-km their fleet and annual mileage imply (TD Table
    # E.4). The mileage evidence is for light goods vehicles only, and medium/heavy vehicles already matched
    # the census counts on the assigned network (0.99; one shared rho pushed them to 1.22 and made the
    # corridor fit worse - handoff, 9/25). So, in two stages:
    #   1. rho for everyone from Table 4.3 alone, as before; medium/heavy vehicles keep it;
    #   2. with that fixed for them, the light groups' rho fits Table 4.3 and the light goods vehicle-km
    #      together: the Table 4.3 misfit counted per percentage point, the vehicle-km per 15% (the mileage
    #      target is an all-days average that also counts cross-boundary legs).
    light_fleet = goods.fleet["fleet"]["light"]
    trips_2011, annual = goods.facts["trips"], goods.facts["annual_km"]
    light_km = (annual["Van-type LGV"] * trips_2011["Van-type LGV"] + annual["LGV"] * trips_2011["LGV"]) / (
        trips_2011["Van-type LGV"] + trips_2011["LGV"])
    vkm_target = light_fleet * light_km / 365
    reach_km = np.isfinite(goods.km)

    def misfit(rho: float, rho_heavy: float | None, with_vkm: bool) -> float:
        harbour, result = with_harbour(rho, rho_heavy)
        share = goods.regional(result)
        share = share / share.values.sum()
        gap = (share - survey).abs()
        gap.loc["BCP", "BCP"] = 0.0
        light = result["van"][1] + result["lgv"][1]
        vkm_ratio = float((light[reach_km] * goods.km[reach_km]).sum()) / vkm_target
        rmse = float(np.sqrt((gap.values ** 2).sum() / 15))
        score = float(np.hypot(rmse / 0.01, np.log(vkm_ratio) / 0.15)) if with_vkm else rmse
        tried[(rho, rho_heavy)] = (score, harbour, result, share)
        print(f"   rho {rho:.3f}（中重型 {rho_heavy or rho:.3f}）：K {harbour:.3f}，表 4.3 最大差 {gap.values.max():.3f}，"
              f"轻型货车车公里 / 目标 {vkm_ratio:.2f}", flush=True)
        return score

    def golden_search(f) -> float:
        low, high = RHO_RANGE
        golden = (5 ** 0.5 - 1) / 2
        a, b = high - golden * (high - low), low + golden * (high - low)
        fa, fb = f(a), f(b)
        while high - low > 0.02:
            if fa < fb:
                high, b, fb = b, a, fa
                a = high - golden * (high - low)
                fa = f(a)
            else:
                low, a, fa = a, b, fb
                b = low + golden * (high - low)
                fb = f(b)
        return a if fa < fb else b

    print("第 1 步：只用表 4.3 拟合 rho（中重型货车用这个）…", flush=True)
    rho_heavy = golden_search(lambda r: misfit(r, None, False))
    print("第 2 步：中重型固定，轻型货车 rho 同时拟合表 4.3 与车公里 …", flush=True)
    rho = golden_search(lambda r: misfit(r, rho_heavy, True))
    error, harbour, result, share = tried[(rho, rho_heavy)]
    gap = (share - survey).abs()
    gap.loc["BCP", "BCP"] = 0.0
    report.append(f"分布：轻型货车 rho = {rho:.2f}（同时拟合表 4.3 与轻型货车车公里）、中重型 rho = {rho_heavy:.2f}（只拟合表 4.3）；"
                  f"rho = 自报时间 ÷ 自由流时间，私家车只算开车部分为 (31 - 10) ÷ (20 - 10) ≈ 2.1；过海系数 K = {harbour:.2f}；"
                  f"β：" + "、".join(f"{g} {result[g][0]:.3f}" for g in GROUPS)
                  + ("  ← 需复核（到达边界）" if min(abs(r - b) for r in (rho, rho_heavy) for b in RHO_RANGE) < 0.03 else ""))
    report.append("表 4.3 地域间比例（模型 2026 / 调查 2011）：" + "；".join(
        f"{a}→{b} {share.loc[a, b]:.1%}/{survey.loc[a, b]:.1%}" for a in share.index for b in share.columns
        if not (a == "BCP" and b == "BCP")) + f"；最大差 {gap.values.max():.1%}"
                  + ("" if gap.values.max() < REGION_TOLERANCE else "  ← 需复核"))
    if gap.values.max() >= REGION_TOLERANCE:
        flags.append("regional movements")

    # Peak hour, and the boundary cars and coaches.
    profile = hourly_profile(report)
    heavy_types = ["mgv", "hgv", "container"]
    fraction = {g: profile[g][PEAK] / sum(profile[g]) for g in ("van", "lgv")}
    fraction["heavy"] = sum(profile[t][PEAK] for t in heavy_types) / sum(sum(profile[t]) for t in heavy_types)
    daily = {"GOODS_LIGHT": result["van"][1] + result["lgv"][1], "GOODS_HEAVY": result["heavy"][1]}
    peak = {"GOODS_LIGHT": result["van"][1] * fraction["van"] + result["lgv"][1] * fraction["lgv"],
            "GOODS_HEAVY": result["heavy"][1] * fraction["heavy"]}
    report.append("8-9 时占各组全日：" + "、".join(f"{g} {f:.1%}" for g, f in fraction.items())
                  + f"；8-9 时货车 轻型 {peak['GOODS_LIGHT'].sum():,.0f}、中重型 {peak['GOODS_HEAVY'].sum():,.0f} 车次")

    params = json.loads(PARAMETERS.read_text(encoding="utf-8"))
    other = params["hourly_profile_pct"]["HBO"]
    other_fraction = other[PEAK] / sum(other)
    demand = np.load(DISTRIBUTION, allow_pickle=True)
    people = {"car": demand["T_CBR"].astype(float) + demand["T_CBV"].astype(float), "coach": demand["T_CBV"].astype(float)}
    for kind, name in (("car", "BOUNDARY_CAR"), ("coach", "BOUNDARY_COACH")):
        trips = np.zeros((len(goods.ids), len(goods.ids)))
        for k, zone in enumerate(goods.ids[goods.n:], start=goods.n):
            point = zone.removeprefix("X:")
            if point not in goods.crossings.index:
                continue
            spread = people[kind][k, :goods.n]
            if spread.sum() == 0:
                spread = people["car"][k, :goods.n]
            if spread.sum() == 0:  # Sha Tau Kok: no travellers counted, and no cars either
                continue
            spread = spread / spread.sum()
            trips[k, :goods.n] += goods.crossings.at[point, f"{kind}_in"] * spread
            trips[:goods.n, k] += goods.crossings.at[point, f"{kind}_out"] * spread
        daily[name], peak[name] = trips, trips * other_fraction
    report.append(f"跨境私家车 全日 {daily['BOUNDARY_CAR'].sum():,.0f}、8-9 时 {peak['BOUNDARY_CAR'].sum():,.0f}；旅游巴士 全日 "
                  f"{daily['BOUNDARY_COACH'].sum():,.0f}、8-9 时 {peak['BOUNDARY_COACH'].sum():,.0f}（按「其他目的」时段比例 "
                  f"{other_fraction:.1%}，占位）")

    # Checks the fit did not see.
    reach = np.isfinite(goods.km)
    vkm = {name: float((m[reach] * goods.km[reach]).sum()) for name, m in daily.items()}
    trips = goods.facts["trips"]
    annual = goods.facts["annual_km"]
    light_fleet = goods.fleet["fleet"]["light"]
    light_km = (annual["Van-type LGV"] * trips["Van-type LGV"] + annual["LGV"] * trips["LGV"]) / (trips["Van-type LGV"] + trips["LGV"])
    expected = light_fleet * light_km / 365
    ratio = vkm["GOODS_LIGHT"] / expected
    report.append(f"核对：轻型货车每日车公里 模型 {vkm['GOODS_LIGHT'] / 1e6:.2f} 百万（最短路），按表 E.4 每车年行驶 {light_km:,.0f} 公里 × "
                  f"领牌 {light_fleet:,.0f} ÷ 365 = {expected / 1e6:.2f} 百万（后者含周末、含跨境段，应略低于工作日）；比值 {ratio:.2f}"
                  + ("" if 0.7 <= ratio <= 1.6 else "  ← 需复核"))
    if not 0.7 <= ratio <= 1.6:
        flags.append("light goods vehicle-km")
    mean = {g: goods.mean_minutes(result[g][1]) for g in GROUPS}
    report.append("平均自由流时间：" + "、".join(f"{g} {mean[g]:.1f} 分钟（自报 {goods.facts['minutes'][g]:.1f}）" for g in GROUPS))
    census = json.loads(OCCUPANCY.read_text(encoding="utf-8"))["summary"]["2024"]["0800-0900"]["share"]
    am = np.load(MODEL / "am-peak-2026.npz")
    n = goods.n
    free = np.isfinite(goods.km[:n, :n])
    peak_vkm = {name: float((m[:n, :n][free] * goods.km[:n, :n][free]).sum()) for name, m in
                {"PV": am["V_PV"], "TAXI": am["V_TAXI"], "GOODS_LIGHT": peak["GOODS_LIGHT"], "GOODS_HEAVY": peak["GOODS_HEAVY"]}.items()}
    total = sum(peak_vkm.values())
    counted = {"PV": census["private_car"] + census["motorcycle"], "TAXI": census["taxi"],
               "GOODS_LIGHT": census["goods_light"], "GOODS_HEAVY": census["goods_medium_heavy"]}
    counted_total = sum(counted.values())
    report.append("8-9 时车公里组成（私家车/的士/轻型货车/中重型货车，模型 vs 普查站）：" + "、".join(
        f"{k} {peak_vkm[k] / total:.0%}/{counted[k] / counted_total:.0%}" for k in counted)
        + "（普查站多在干道；分配后按站再比）")
    for k in ("GOODS_LIGHT", "GOODS_HEAVY"):
        modelled, seen = peak_vkm[k] / total, counted[k] / counted_total
        if not 0.5 <= modelled / seen <= 2.0:
            flags.append(f"{k} share")
            report[-1] += "  ← 需复核"

    np.savez_compressed(OUTPUT, zones=np.array(goods.ids),
                        **{f"D_{k}": v.astype(np.float32) for k, v in daily.items()},
                        **{f"V_{k}": v.astype(np.float32) for k, v in peak.items()})
    AUDIT.write_text(json.dumps({
        "rho": rho, "rho_heavy": rho_heavy, "harbour": harbour, "beta": {g: result[g][0] for g in GROUPS},
        "peak_fraction": fraction, "fleet_growth": goods.fleet["growth"],
        "daily": {k: round(float(v.sum())) for k, v in daily.items()},
        "peak": {k: round(float(v.sum())) for k, v in peak.items()},
        "crossings": goods.crossings.round(1).reset_index().to_dict(orient="records"),
        "flags": flags, "report": report}, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(f"-> {OUTPUT.relative_to(ROOT)}")
    for line in report:
        print("   " + line)
    if flags:
        print("   需复核：" + ", ".join(flags))


if __name__ == "__main__":
    main()
